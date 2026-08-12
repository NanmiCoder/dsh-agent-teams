/**
 * The `agent_teams_*` model-facing tools.
 *
 * The captain (the agent that created the team) orchestrates: members are
 * continuable subagents it spawns and wakes. Members share the same tools and
 * drive their own task state, mirroring the Claude Code AgentTeams flow:
 * create team → add members → create tasks with dependencies → claim/assign →
 * work → report → status → delete.
 * @module dsh-agent-teams/tools
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { join } from 'node:path';
import { appendTeamEvent, captainSessionOf } from "./events.js";
import { appendMailbox, archiveTeamDir, CAPTAIN_KEY, createMessage, createTeamDir, findTeamByCaptain, readMailbox, readTeam, sanitizeKey, transitionError, unsatisfiedDependencies, withTeamLock, writeTeam, } from "./state.js";
import { deliverToMember, interruptMember, memberActivity, spawnMember, } from "./members.js";
/** The caller agent, or a loud failure for non-agent callers. */
function requireCaptain(exec) {
    if (!exec.agent) {
        throw new Error('agent_teams tools require a calling agent (exec.agent was undefined)');
    }
    return exec.agent;
}
/** The captain's workspace directory (team state root parent). */
function workspaceOf(agent) {
    return agent.session.header.cwd ?? process.cwd();
}
/** Resolved absolute state root. */
function stateRootOf(workspace, config) {
    return join(workspace, config.stateDir);
}
/** The team this captain currently leads, or a loud failure. */
async function requireTeam(workspace, config, captain) {
    const team = await findTeamByCaptain(stateRootOf(workspace, config), captain.id);
    if (team === undefined) {
        throw new Error('you are not leading any team yet — call agent_teams_create first');
    }
    return team;
}
/** Look up one live (non-removed) member by display name. */
function requireMember(team, name) {
    const member = team.members.find((candidate) => candidate.name === name && candidate.status !== 'removed');
    if (member === undefined) {
        throw new Error(`no active member named "${name}" in team "${team.name}"`);
    }
    return member;
}
/** Look up one task by id. */
function requireTask(team, taskId) {
    const task = team.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) {
        throw new Error(`no task "${taskId}" in team "${team.name}" — use agent_teams_status to list tasks`);
    }
    return task;
}
/**
 * Register every `agent_teams_*` tool into the shared tools registry.
 * @param ctx - the plugin context (injects `tools`).
 * @param config - resolved tool config.
 */
export function registerAgentTeamsTools(ctx, config) {
    ctx.tools.register(defineTool({
        name: 'agent_teams_create',
        description: 'Create a new AgentTeams team: you (the calling agent) become the captain. A captain leads one team at a time; create tasks and members afterwards with agent_teams_add_member and agent_teams_create_task.',
        parameters: {
            name: { type: 'string', required: true, description: 'Name for the new team (used as its stable id).' },
            description: { type: 'string', description: 'Team purpose / the goal the team will work on.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    team_id: { type: 'string', required: true },
                    team_name: { type: 'string', required: true },
                    state_dir: { type: 'string', required: true },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Team "${value.team_name}" created (id ${value.team_id}) under ${value.state_dir}. You are the captain.`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const teamId = sanitizeKey(args.name);
            return withTeamLock(teamId, async () => {
                const existing = await readTeam(stateRoot, teamId);
                if (existing?.captainSessionId === captain.id) {
                    throw new Error(`you already lead team "${existing.name}" — delete it first (agent_teams_delete) or reuse it`);
                }
                if (existing !== undefined) {
                    throw new Error(`team id "${teamId}" is taken by another captain — pick a different team name`);
                }
                const state = {
                    name: args.name.trim(),
                    id: teamId,
                    description: args.description,
                    captainSessionId: captain.id,
                    createdAt: Date.now(),
                    members: [],
                    tasks: [],
                    taskSeq: 0,
                };
                await createTeamDir(stateRoot, state);
                appendTeamEvent(ctx, captain.session, 'agent-teams/team-created', {
                    teamId: state.id,
                    captainSessionId: captain.id,
                    name: state.name,
                    ...state.description !== undefined ? { description: state.description } : {},
                });
                return { team_id: state.id, team_name: state.name, state_dir: join(stateRoot, state.id) };
            });
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_add_member',
        description: 'Add a member to your team: spawns a durable continuable subagent with a member persona. The member waits for your messages and works on assigned tasks; it can message you and teammates. One team per captain, members are capped by config.',
        parameters: {
            name: { type: 'string', required: true, description: 'Unique member name inside the team.' },
            role: { type: 'string', description: 'Role of the member (e.g. researcher, engineer, reviewer).' },
            model: { type: 'string', description: 'Optional model override for this member (defaults to the captain\'s model).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    member_name: { type: 'string', required: true },
                    member_id: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Member "${value.member_name}" added (subagent id ${value.member_id}, status ${value.status}).`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireTeam(workspace, config, captain);
            return withTeamLock(team.id, async () => {
                const fresh = await readTeam(stateRoot, team.id) ?? team;
                const memberKey = sanitizeKey(args.name);
                if (fresh.members.some((candidate) => sanitizeKey(candidate.name) === memberKey && candidate.status !== 'removed')) {
                    throw new Error(`member "${args.name}" already exists in team "${fresh.name}"`);
                }
                if (fresh.members.filter((candidate) => candidate.status !== 'removed').length >= config.maxMembers) {
                    throw new Error(`team "${fresh.name}" is at its member cap (${config.maxMembers})`);
                }
                const member = {
                    id: '',
                    name: args.name.trim(),
                    role: args.role,
                    model: args.model,
                    joinedAt: Date.now(),
                    status: 'idle',
                };
                await spawnMember(ctx, memberRuntime(config), captain, fresh, member, config.stateDir, exec.signal);
                fresh.members.push(member);
                await writeTeam(stateRoot, fresh);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/member-added', {
                    teamId: fresh.id,
                    memberId: member.id,
                    name: member.name,
                    ...member.role !== undefined ? { role: member.role } : {},
                });
                return { member_name: member.name, member_id: member.id, status: member.status };
            });
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_remove_member',
        description: 'Remove a member from your team: interrupts its live turn (best effort) and marks it removed. Its mailbox and past task outputs stay on disk.',
        parameters: {
            name: { type: 'string', required: true, description: 'Name of the member to remove.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    member_name: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Member "${value.member_name}" removed (status ${value.status}).`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireTeam(workspace, config, captain);
            return withTeamLock(team.id, async () => {
                const fresh = await readTeam(stateRoot, team.id) ?? team;
                const member = requireMember(fresh, args.name);
                if (member.id !== '')
                    interruptMember(ctx, captain, member.id);
                member.status = 'removed';
                await writeTeam(stateRoot, fresh);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/member-removed', {
                    teamId: fresh.id,
                    memberId: member.id,
                });
                return { member_name: member.name, status: member.status };
            });
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_create_task',
        description: 'Create a task in your team\'s task list. Tasks can depend on other tasks (dependencies): a task is only claimable once every dependency is completed. Optionally assign it to a member, who still claims it before working.',
        parameters: {
            subject: { type: 'string', required: true, description: 'Brief title for the task.' },
            description: { type: 'string', description: 'What needs to be done, in detail.' },
            dependencies: {
                type: 'array',
                items: { type: 'string' },
                description: 'Task ids this task depends on (must be completed before this task can be claimed).',
            },
            assignee: { type: 'string', description: 'Optional member name this task is intended for.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    task_id: { type: 'string', required: true },
                    subject: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    assignee: { type: 'string' },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Task "${value.subject}" created as ${value.task_id} (status ${value.status}${value.assignee ? `, assigned to ${value.assignee}` : ''}).`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireTeam(workspace, config, captain);
            return withTeamLock(team.id, async () => {
                const fresh = await readTeam(stateRoot, team.id) ?? team;
                const dependencies = args.dependencies ?? [];
                for (const dependency of dependencies) {
                    if (!fresh.tasks.some((task) => task.id === dependency)) {
                        throw new Error(`dependency "${dependency}" does not exist in team "${fresh.name}"`);
                    }
                }
                if (args.assignee !== undefined)
                    requireMember(fresh, args.assignee);
                const task = {
                    id: `t${fresh.taskSeq + 1}`,
                    subject: args.subject,
                    description: args.description,
                    status: 'pending',
                    assignee: args.assignee,
                    dependencies,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                };
                fresh.taskSeq += 1;
                fresh.tasks.push(task);
                await writeTeam(stateRoot, fresh);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/task-created', {
                    teamId: fresh.id,
                    taskId: task.id,
                    subject: task.subject,
                    dependencies: task.dependencies,
                    ...task.assignee !== undefined ? { assignee: task.assignee } : {},
                });
                return {
                    task_id: task.id,
                    subject: task.subject,
                    status: task.status,
                    ...task.assignee !== undefined ? { assignee: task.assignee } : {},
                };
            });
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_claim_task',
        description: 'Claim a task for a member (or for yourself when you are the member). Blocked while any dependency is unfinished — the error lists the pending dependencies. The captain may claim on behalf of an assignee; a member may only claim tasks assigned to it (or unassigned).',
        parameters: {
            task_id: { type: 'string', required: true, description: 'The task id to claim.' },
            assignee: { type: 'string', description: 'Member to claim for (captain only; defaults to the task\'s assignee).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    task_id: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    assignee: { type: 'string', required: true },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Task ${value.task_id} claimed by ${value.assignee} (status ${value.status}).`,
                }],
        },
        async execute(args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireTeam(workspace, config, caller);
            const isCaptain = team.captainSessionId === caller.id;
            return withTeamLock(team.id, async () => {
                const fresh = await readTeam(stateRoot, team.id) ?? team;
                const task = requireTask(fresh, args.task_id);
                const pending = unsatisfiedDependencies(fresh.tasks, task.dependencies);
                if (pending.length > 0) {
                    throw new Error(`task ${task.id} is blocked by unfinished dependencies: ${pending.join(', ')} — complete them first`);
                }
                if (task.status === 'claimed' || task.status === 'in_progress') {
                    return { task_id: task.id, status: task.status, assignee: task.assignee ?? '' };
                }
                const transition = transitionError(task.status, 'claimed');
                if (transition !== undefined)
                    throw new Error(transition);
                let assignee = task.assignee;
                if (isCaptain) {
                    if (args.assignee !== undefined) {
                        requireMember(fresh, args.assignee);
                        assignee = args.assignee;
                    }
                    else if (assignee === undefined) {
                        throw new Error('claiming an unassigned task needs an assignee (claim on behalf of a member)');
                    }
                }
                else {
                    const mine = memberNameOf(fresh, caller.id);
                    if (mine === undefined)
                        throw new Error('only team members can claim tasks');
                    if (assignee !== undefined && assignee !== mine) {
                        throw new Error(`task ${task.id} is assigned to "${assignee}", not you`);
                    }
                    assignee = mine;
                }
                task.status = 'claimed';
                task.assignee = assignee;
                task.updatedAt = Date.now();
                await writeTeam(stateRoot, fresh);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
                    teamId: fresh.id,
                    taskId: task.id,
                    status: task.status,
                    assignee: task.assignee,
                });
                return { task_id: task.id, status: task.status, assignee: task.assignee ?? '' };
            });
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_update_task',
        description: 'Update a task\'s status and/or write its output. Transitions: claimed → in_progress → completed|failed|cancelled (pending may also be cancelled). The captain may update any task; a member may only update tasks assigned to it. Set output when completing or failing a task.',
        parameters: {
            task_id: { type: 'string', required: true, description: 'The task id to update.' },
            status: {
                type: 'string',
                enum: ['in_progress', 'completed', 'failed', 'cancelled'],
                description: 'New status (in_progress, completed, failed, cancelled).',
            },
            output: { type: 'string', description: 'Result summary; set when completing or failing.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    task_id: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    output: { type: 'string' },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Task ${value.task_id} → ${value.status}${value.output !== undefined ? `\nOutput: ${value.output}` : ''}`,
                }],
        },
        async execute(args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireTeam(workspace, config, caller);
            const isCaptain = team.captainSessionId === caller.id;
            return withTeamLock(team.id, async () => {
                const fresh = await readTeam(stateRoot, team.id) ?? team;
                const task = requireTask(fresh, args.task_id);
                if (!isCaptain) {
                    const mine = memberNameOf(fresh, caller.id);
                    if (task.assignee !== mine) {
                        throw new Error(`task ${task.id} is assigned to "${task.assignee ?? 'nobody'}", not you`);
                    }
                }
                if (args.status !== undefined) {
                    const transition = transitionError(task.status, args.status);
                    if (transition !== undefined)
                        throw new Error(transition);
                    task.status = args.status;
                }
                if (args.output !== undefined)
                    task.output = args.output;
                task.updatedAt = Date.now();
                await writeTeam(stateRoot, fresh);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
                    teamId: fresh.id,
                    taskId: task.id,
                    status: task.status,
                    ...task.assignee !== undefined ? { assignee: task.assignee } : {},
                    ...task.output !== undefined ? { output: task.output } : {},
                });
                return {
                    task_id: task.id,
                    status: task.status,
                    ...task.output !== undefined ? { output: task.output } : {},
                };
            });
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_send_message',
        description: 'Send a message to the captain or to a teammate. Messages go straight into the recipient\'s mailbox; when the captain agent is online the plugin also wakes the recipient so it acts immediately (member recipients get the message as their next turn; the captain sees it at its next turn). No relay is involved: teammates talk to each other directly, exactly like the Claude Code AgentTeams mailbox model.',
        parameters: {
            to: { type: 'string', required: true, description: 'Recipient: "captain" or a member name.' },
            content: { type: 'string', required: true, description: 'The message text.' },
            from: { type: 'string', description: 'Sender (defaults to the caller: the captain, or the calling member).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    message_id: { type: 'string', required: true },
                    from: { type: 'string', required: true },
                    to: { type: 'string', required: true },
                    delivered: { type: 'string', required: true, description: 'wake (recipient woken) or mailbox (waiting in the inbox; captain offline).' },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Message ${value.message_id} ${value.from} → ${value.to} delivered via ${value.delivered}.`,
                }],
        },
        async execute(args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireTeam(workspace, config, caller);
            const isCaptain = team.captainSessionId === caller.id;
            const callerIdentity = isCaptain ? CAPTAIN_KEY : memberNameOf(team, caller.id) ?? CAPTAIN_KEY;
            // `from` may only be the caller's own identity: impersonating another
            // member (or the captain) would poison the mailbox and event records.
            if (args.from !== undefined && args.from !== callerIdentity) {
                throw new Error(`agent_teams_send_message: "from" must be your own identity ("${callerIdentity}"), not "${args.from}"`);
            }
            const from = callerIdentity;
            const to = args.to.trim();
            // The captain is the direct parent of every member, so only its Agent
            // can wake a member (followup) or reach the main inbox. When the captain
            // is online the plugin proxies the wake on its behalf; when it is not,
            // the message stays in the mailbox until the captain's next operation.
            const captain = ctx.agents.get(team.captainSessionId);
            if (to === CAPTAIN_KEY) {
                // Any sender may mail the captain. Deliver into its inbox so the
                // captain acts on it at its next turn (Claude Code equivalent: the
                // captain polls its own mailbox).
                const message = createMessage(from, CAPTAIN_KEY, args.content);
                await withTeamLock(team.id, async () => {
                    await appendMailbox(stateRoot, team.id, CAPTAIN_KEY, message);
                });
                appendTeamEvent(ctx, captainSessionOf(ctx, team.captainSessionId, caller.session), 'agent-teams/message-sent', {
                    teamId: team.id,
                    messageId: message.id,
                    from,
                    to: CAPTAIN_KEY,
                    content: args.content,
                    ts: message.ts,
                });
                let delivered = 'mailbox';
                if (captain !== undefined && !isCaptain) {
                    captain.send(createUserMessage({
                        content: [{ type: 'text', text: `AgentTeams message from member ${from}:\n\n${args.content}` }],
                        source: { kind: 'plugin', plugin: 'dsh-agent-teams' },
                    }), 'next-turn', true);
                    delivered = 'wake';
                }
                return { message_id: message.id, from, to: CAPTAIN_KEY, delivered };
            }
            return withTeamLock(team.id, async () => {
                const fresh = await readTeam(stateRoot, team.id) ?? team;
                const recipient = requireMember(fresh, to);
                const message = createMessage(from, recipient.name, args.content);
                await appendMailbox(stateRoot, fresh.id, recipient.name, message);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/message-sent', {
                    teamId: fresh.id,
                    messageId: message.id,
                    from,
                    to: recipient.name,
                    content: args.content,
                    ts: message.ts,
                });
                let delivered = 'mailbox';
                // Any sender → member: write the mailbox (direct, like Claude Code),
                // then wake the member through the captain's parent authority.
                if (captain !== undefined && recipient.id !== '') {
                    const text = from === CAPTAIN_KEY
                        ? args.content
                        : `Message from team member ${from}:\n\n${args.content}`;
                    const accepted = await deliverToMember(ctx, captain, recipient.id, text, exec.signal);
                    delivered = accepted ? 'wake' : 'mailbox';
                }
                return { message_id: message.id, from, to: recipient.name, delivered };
            });
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_status',
        description: 'Full team snapshot: members (with live subagent activity), tasks with status/assignee/dependencies/output, and the captain\'s mailbox plus pending mailboxes of members. Poll this to watch members work; a member is `running` while working and `inactive` when idle.',
        parameters: {},
        output: {
            schema: { type: 'object', additionalProperties: true, properties: {} },
            render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
        },
        async execute(_args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireTeam(workspace, config, captain);
            const activity = await memberActivity(ctx, team.captainSessionId);
            const members = team.members
                .filter((member) => member.status !== 'removed')
                .map((member) => ({
                name: member.name,
                role: member.role ?? '',
                model: member.model ?? '',
                status: member.status,
                activity: member.id !== '' ? (activity.get(member.id) ?? 'unknown') : 'unspawned',
            }));
            const tasks = team.tasks.map((task) => ({
                id: task.id,
                subject: task.subject,
                status: task.status,
                assignee: task.assignee ?? '',
                dependencies: task.dependencies,
                ...task.output !== undefined ? { output: task.output } : {},
            }));
            const captainInbox = await readMailbox(stateRoot, team.id, CAPTAIN_KEY);
            const memberInboxes = {};
            for (const member of members) {
                const messages = await readMailbox(stateRoot, team.id, member.name);
                if (messages.length > 0) {
                    memberInboxes[member.name] = {
                        count: messages.length,
                        latest: messages[messages.length - 1]?.content.slice(0, 200) ?? '',
                    };
                }
            }
            return {
                team_id: team.id,
                team_name: team.name,
                description: team.description ?? '',
                members,
                tasks,
                captain_inbox: captainInbox.slice(-10).map((message) => ({
                    from: message.from,
                    content: message.content,
                    ts: message.ts,
                })),
                member_inboxes: memberInboxes,
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'agent_teams_delete',
        description: 'End your team: interrupts all members (best effort) and deletes the team\'s state directory (team file, tasks, mailboxes). Use when the team\'s work is done or abandoned.',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    deleted: { type: 'boolean', required: true },
                    team_name: { type: 'string', required: true },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Team "${value.team_name}" deleted.`,
                }],
        },
        async execute(_args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireTeam(workspace, config, captain);
            await withTeamLock(team.id, async () => {
                const fresh = await readTeam(stateRoot, team.id) ?? team;
                for (const member of fresh.members) {
                    if (member.status !== 'removed' && member.id !== '')
                        interruptMember(ctx, captain, member.id);
                }
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-deleted', {
                    teamId: fresh.id,
                });
                // Archive, not delete: tasks (with their dependency graph) and the
                // mailboxes stay on disk for later review and dependency rebuilds.
                await archiveTeamDir(stateRoot, fresh.id);
            });
            return { deleted: true, team_name: team.name };
        },
    }));
}
/** The member's display name for a caller that is one of the team members. */
function memberNameOf(team, agentId) {
    return team.members.find((member) => member.id === agentId)?.name;
}
/** Build the `memberRuntime` config handed to member helpers. */
function memberRuntime(config) {
    return {
        provider: config.memberProvider,
        model: config.memberModel,
        maxDepth: config.memberMaxDepth,
    };
}
/** Render the status snapshot as compact text for the model. */
function renderStatus(value) {
    const team = value;
    const lines = [
        `Team "${team.team_name}"${team.description ? ` — ${team.description}` : ''}`,
        `Members (${team.members.length}):`,
        ...team.members.map((member) => `  - ${member.name} [${member.role}] ${member.status}/${member.activity}`),
        `Tasks (${team.tasks.length}):`,
        ...team.tasks.map((task) => {
            const deps = task.dependencies.length > 0 ? ` (deps: ${task.dependencies.join(',')})` : '';
            const output = task.output !== undefined ? `\n      output: ${task.output.slice(0, 300)}` : '';
            return `  - ${task.id} [${task.status}] ${task.subject} → ${task.assignee || 'unassigned'}${deps}${output}`;
        }),
        `Captain inbox (${team.captain_inbox.length}):`,
        ...team.captain_inbox.map((message) => `  - [${message.from}] ${message.content.slice(0, 200)}`),
    ];
    for (const [name, inbox] of Object.entries(team.member_inboxes)) {
        lines.push(`Member inbox ${name} (${inbox.count}): latest — ${inbox.latest.slice(0, 120)}`);
    }
    return lines.join('\n');
}
