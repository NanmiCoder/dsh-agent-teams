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

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { appendTeamEvent, captainSessionOf } from './events.ts'
import {
  appendMailbox,
  archiveTeamDir,
  CAPTAIN_KEY,
  createMessage,
  createTeamDir,
  findTeamByCaptain,
  findTeamByParticipant,
  readMailbox,
  readTeam,
  sanitizeKey,
  transitionError,
  unsatisfiedDependencies,
  withTeamLock,
  writeTeam,
} from './state.ts'
import {
  deliverToMember,
  installMemberSelectionRuntime,
  interruptMember,
  memberActivity,
  resolveMemberLlmSelection,
  spawnMember,
  type MemberPersonaPlacement,
  type MemberRuntimeConfig,
} from './members.ts'
import type { TeamMember, TeamState, TeamTask } from './types.ts'

/** Resolved plugin config consumed by the tools. */
export interface ToolsConfig {
  /** State directory name under the captain's workspace. */
  stateDir: string
  /** Member subagent provider name. */
  memberProvider: string
  /** Optional member model override. */
  memberModel?: string
  /** Member delegation depth cap. */
  memberMaxDepth?: number
  /** Where each member receives its role and team protocol. */
  memberPersonaPlacement: MemberPersonaPlacement
  /** Team size cap (members). */
  maxMembers: number
}

/** The caller agent, or a loud failure for non-agent callers. */
function requireCaptain(exec: ToolRunContext): Agent {
  if (!exec.agent) {
    throw new Error('agent_teams tools require a calling agent (exec.agent was undefined)')
  }
  return exec.agent
}

/** The captain's workspace directory (team state root parent). */
function workspaceOf(agent: Agent): string {
  return agent.session.header.cwd ?? process.cwd()
}

/** Resolved absolute state root. */
function stateRootOf(workspace: string, config: ToolsConfig): string {
  return join(workspace, config.stateDir)
}

/** Process-local lock key scoped by workspace state root and team id. */
function teamLockKey(stateRoot: string, teamId: string): string {
  return `team:${stateRoot}:${teamId}`
}

/** Process-local lock key enforcing one active team per captain session. */
function captainLockKey(stateRoot: string, captainId: string): string {
  return `captain:${stateRoot}:${captainId}`
}

/** The team this captain currently leads, or a loud failure. */
async function requireCaptainTeam(workspace: string, config: ToolsConfig, captain: Agent): Promise<TeamState> {
  const team = await findTeamByCaptain(stateRootOf(workspace, config), captain.id)
  if (team === undefined) {
    throw new Error('you are not leading any team yet — call agent_teams_create first')
  }
  return team
}

/** The team this captain or active member currently participates in. */
async function requireParticipantTeam(workspace: string, config: ToolsConfig, caller: Agent): Promise<TeamState> {
  const team = await findTeamByParticipant(stateRootOf(workspace, config), caller.id)
  if (team === undefined) {
    throw new Error('you do not lead or belong to any active team yet')
  }
  return team
}

type ParticipantIdentity =
  | { kind: 'captain'; name: typeof CAPTAIN_KEY }
  | { kind: 'member'; name: string }

/** Re-derive a caller's role from fresh state while holding the team lock. */
function participantIdentityOf(team: TeamState, agentId: string): ParticipantIdentity | undefined {
  if (team.captainSessionId === agentId) return { kind: 'captain', name: CAPTAIN_KEY }
  const member = team.members.find((candidate) => candidate.id === agentId && candidate.status !== 'removed')
  return member === undefined ? undefined : { kind: 'member', name: member.name }
}

/** Fresh state for a team that still exists; never falls back to stale lookup data. */
async function requireFreshTeam(stateRoot: string, teamId: string): Promise<TeamState> {
  const fresh = await readTeam(stateRoot, teamId)
  if (fresh === undefined) throw new Error(`team "${teamId}" is no longer active`)
  return fresh
}

/** Fresh state with captain authorization rechecked inside the lock. */
async function requireFreshCaptainTeam(
  stateRoot: string,
  teamId: string,
  captainId: string,
): Promise<TeamState> {
  const fresh = await requireFreshTeam(stateRoot, teamId)
  if (fresh.captainSessionId !== captainId) {
    throw new Error(`only the captain of team "${fresh.name}" may perform this operation`)
  }
  return fresh
}

/** Fresh state and caller identity rechecked inside the lock. */
async function requireFreshParticipant(
  stateRoot: string,
  teamId: string,
  callerId: string,
): Promise<{ team: TeamState; identity: ParticipantIdentity }> {
  const fresh = await requireFreshTeam(stateRoot, teamId)
  const identity = participantIdentityOf(fresh, callerId)
  if (identity === undefined) throw new Error(`you are no longer an active participant in team "${fresh.name}"`)
  return { team: fresh, identity }
}

/** Look up one live (non-removed) member by display name. */
function requireMember(team: TeamState, name: string): TeamMember {
  const member = team.members.find((candidate) => candidate.name === name && candidate.status !== 'removed')
  if (member === undefined) {
    throw new Error(`no active member named "${name}" in team "${team.name}"`)
  }
  return member
}

/** Look up one task by id. */
function requireTask(team: TeamState, taskId: string): TeamTask {
  const task = team.tasks.find((candidate) => candidate.id === taskId)
  if (task === undefined) {
    throw new Error(`no task "${taskId}" in team "${team.name}" — use agent_teams_status to list tasks`)
  }
  return task
}

/**
 * Deliver a durable member report at the captain's nearest model boundary.
 *
 * `Agent.steer()` targets the next step while the captain is running, wakes a
 * new turn when it is idle, and lets the Agent runtime reclassify an aborted
 * activity to `next-turn`. This prevents reports from waiting behind the
 * captain's entire orchestration turn.
 */
export function steerCaptainReport(captain: Pick<Agent, 'steer'>, from: string, content: string): boolean {
  try {
    captain.steer(createUserMessage({
      content: [{ type: 'text', text: `AgentTeams message from member ${from}:\n\n${content}` }],
      source: { kind: 'plugin', plugin: 'dsh-agent-teams' },
    }))
    return true
  } catch {
    // The plugin mailbox was persisted before this best-effort live delivery.
    return false
  }
}

/**
 * Register every `agent_teams_*` tool into the shared tools registry.
 * @param ctx - the plugin context (injects `tools`).
 * @param config - resolved tool config.
 */
export function registerAgentTeamsTools(ctx: Context, config: ToolsConfig): void {
  const memberSelections = installMemberSelectionRuntime(ctx, config.stateDir)

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
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const teamName = args.name.trim()
      if (teamName === '') throw new Error('team name must not be empty')
      const teamId = sanitizeKey(teamName)
      return withTeamLock(captainLockKey(stateRoot, captain.id), async () => {
        const current = await findTeamByParticipant(stateRoot, captain.id)
        if (current !== undefined) {
          const relationship = current.captainSessionId === captain.id ? 'lead' : 'belong to'
          throw new Error(`you already ${relationship} team "${current.name}" — end or leave it before creating another`)
        }
        return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
          const existing = await readTeam(stateRoot, teamId)
          if (existing !== undefined) {
            throw new Error(`team id "${teamId}" is taken by another captain — pick a different team name`)
          }
          const state: TeamState = {
            name: teamName,
            id: teamId,
            description: args.description,
            captainSessionId: captain.id,
            createdAt: Date.now(),
            members: [],
            tasks: [],
            taskSeq: 0,
          }
          await createTeamDir(stateRoot, state)
          appendTeamEvent(ctx, captain.session, 'agent-teams/team-created', {
            teamId: state.id,
            captainSessionId: captain.id,
            name: state.name,
            ...state.description !== undefined ? { description: state.description } : {},
          })
          return { team_id: state.id, team_name: state.name, state_dir: join(stateRoot, state.id) }
        })
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_add_member',
    description: 'Add a durable continuable member. By default it snapshots the captain\'s current LLM provider, model, and reasoning effort with no user prompt. Supply provider/model only for an explicitly requested role-specific route. The member waits for messages, works on assigned tasks, and can message the team.',
    parameters: {
      name: { type: 'string', required: true, description: 'Unique member name inside the team.' },
      role: { type: 'string', description: 'Role of the member (e.g. researcher, engineer, reviewer).' },
      provider: { type: 'string', description: 'Optional LLM provider route. Use only when the user explicitly requests a different provider; requires model.' },
      model: { type: 'string', description: 'Optional model override. Omit for the captain\'s current model (or the configured memberModel default).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          member_name: { type: 'string', required: true },
          member_id: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          reasoning_effort: { type: 'string' },
          status: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Member "${value.member_name}" added (subagent id ${value.member_id}, ${value.provider}/${value.model}${value.reasoning_effort === undefined ? '' : `, reasoning ${value.reasoning_effort}`}, status ${value.status}).`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const memberName = args.name.trim()
        if (memberName === '') throw new Error('member name must not be empty')
        const memberKey = sanitizeKey(memberName)
        if (memberKey === CAPTAIN_KEY) {
          throw new Error(`member name "${args.name}" is reserved for the captain`)
        }
        if (fresh.members.some((candidate) => sanitizeKey(candidate.name) === memberKey)) {
          throw new Error(`member name "${args.name}" has already been used in team "${fresh.name}"`)
        }
        if (fresh.members.filter((candidate) => candidate.status !== 'removed').length >= config.maxMembers) {
          throw new Error(`team "${fresh.name}" is at its member cap (${config.maxMembers})`)
        }
        const selection = await resolveMemberLlmSelection(ctx, captain, {
          provider: args.provider,
          model: args.model,
          defaultModel: config.memberModel,
        }, exec.signal)
        const member: TeamMember = {
          id: '',
          name: memberName,
          role: args.role,
          provider: selection.provider,
          model: selection.model,
          reasoningEffort: selection.reasoningEffort,
          joinedAt: Date.now(),
          status: 'idle',
        }
        await spawnMember(
          ctx,
          memberRuntime(config),
          memberSelections,
          selection,
          captain,
          fresh,
          member,
          config.stateDir,
          exec.signal,
        )
        fresh.members.push(member)
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/member-added', {
          teamId: fresh.id,
          memberId: member.id,
          name: member.name,
          ...member.role !== undefined ? { role: member.role } : {},
        })
        return {
          member_name: member.name,
          member_id: member.id,
          provider: selection.provider,
          model: selection.model,
          ...selection.reasoningEffort === undefined
            ? {}
            : { reasoning_effort: selection.reasoningEffort },
          status: member.status,
        }
      })
    },
  }))

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
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const member = requireMember(fresh, args.name)
        if (member.id !== '') interruptMember(ctx, captain, member.id)
        member.status = 'removed'
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/member-removed', {
          teamId: fresh.id,
          memberId: member.id,
        })
        return { member_name: member.name, status: member.status }
      })
    },
  }))

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
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const dependencies = args.dependencies ?? []
        for (const dependency of dependencies) {
          if (!fresh.tasks.some((task) => task.id === dependency)) {
            throw new Error(`dependency "${dependency}" does not exist in team "${fresh.name}"`)
          }
        }
        if (args.assignee !== undefined) requireMember(fresh, args.assignee)
        const task: TeamTask = {
          id: `t${fresh.taskSeq + 1}`,
          subject: args.subject,
          description: args.description,
          status: 'pending',
          assignee: args.assignee,
          dependencies,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        fresh.taskSeq += 1
        fresh.tasks.push(task)
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/task-created', {
          teamId: fresh.id,
          taskId: task.id,
          subject: task.subject,
          dependencies: task.dependencies,
          ...task.assignee !== undefined ? { assignee: task.assignee } : {},
        })
        return {
          task_id: task.id,
          subject: task.subject,
          status: task.status,
          ...task.assignee !== undefined ? { assignee: task.assignee } : {},
        }
      })
    },
  }))

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
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireParticipantTeam(workspace, config, caller)
      return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
        const task = requireTask(fresh, args.task_id)
        let assignee = task.assignee
        if (identity.kind === 'captain') {
          if (args.assignee !== undefined) {
            requireMember(fresh, args.assignee)
            assignee = args.assignee
          }
        } else {
          if (args.assignee !== undefined) {
            throw new Error('members cannot set assignee when claiming a task')
          }
          if (assignee !== undefined && assignee !== identity.name) {
            throw new Error(`task ${task.id} is assigned to "${assignee}", not you`)
          }
          assignee = identity.name
        }
        // Authorization must happen before the idempotent return: another
        // member must not receive a false success for somebody else's task.
        if (task.status === 'claimed' || task.status === 'in_progress') {
          if (assignee === undefined || task.assignee !== assignee) {
            throw new Error(`task ${task.id} is already claimed by "${task.assignee ?? 'nobody'}"`)
          }
          return { task_id: task.id, status: task.status, assignee }
        }
        const pending = unsatisfiedDependencies(fresh.tasks, task.dependencies)
        if (pending.length > 0) {
          throw new Error(`task ${task.id} is blocked by unfinished dependencies: ${pending.join(', ')} — complete them first`)
        }
        const transition = transitionError(task.status, 'claimed')
        if (transition !== undefined) throw new Error(transition)
        if (assignee === undefined) {
          throw new Error('claiming an unassigned task needs an assignee (claim on behalf of a member)')
        }
        task.status = 'claimed'
        task.assignee = assignee
        task.updatedAt = Date.now()
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
          teamId: fresh.id,
          taskId: task.id,
          status: task.status,
          assignee: task.assignee,
        })
        return { task_id: task.id, status: task.status, assignee: task.assignee ?? '' }
      })
    },
  }))

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
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireParticipantTeam(workspace, config, caller)
      return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
        const task = requireTask(fresh, args.task_id)
        if (identity.kind === 'member') {
          if (task.assignee !== identity.name) {
            throw new Error(`task ${task.id} is assigned to "${task.assignee ?? 'nobody'}", not you`)
          }
        }
        if (args.status !== undefined) {
          const transition = transitionError(task.status, args.status)
          if (transition !== undefined) throw new Error(transition)
          task.status = args.status
        }
        if (args.output !== undefined) task.output = args.output
        task.updatedAt = Date.now()
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
          teamId: fresh.id,
          taskId: task.id,
          status: task.status,
          ...task.assignee !== undefined ? { assignee: task.assignee } : {},
          ...task.output !== undefined ? { output: task.output } : {},
        })
        return {
          task_id: task.id,
          status: task.status,
          ...task.output !== undefined ? { output: task.output } : {},
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_send_message',
    description: 'Send a message to the captain or to a teammate. Messages go straight into the recipient\'s mailbox; when the captain agent is online the plugin also schedules live delivery (member recipients get the message as their next turn; a running captain sees it at the nearest model step). No relay is involved: teammates talk to each other directly, exactly like the Claude Code AgentTeams mailbox model.',
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
          delivered: { type: 'string', required: true, description: 'live (accepted by the live captain), wake (member recipient woken), or mailbox (durable inbox only).' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Message ${value.message_id} ${value.from} → ${value.to} delivered via ${value.delivered}.`,
      }],
    },
    async execute(args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireParticipantTeam(workspace, config, caller)
      const to = args.to.trim()
      const prepared = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
        const from = identity.name
        // `from` may only be the caller's own identity: impersonating another
        // member (or the captain) would poison the mailbox and event records.
        if (args.from !== undefined && args.from !== from) {
          throw new Error(`agent_teams_send_message: "from" must be your own identity ("${from}"), not "${args.from}"`)
        }
        if (to === CAPTAIN_KEY) {
          const message = createMessage(from, CAPTAIN_KEY, args.content)
          await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, message)
          appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/message-sent', {
            teamId: fresh.id,
            messageId: message.id,
            from,
            to: CAPTAIN_KEY,
            content: args.content,
            ts: message.ts,
          })
          return { kind: 'captain' as const, fresh, identity, message, from }
        }
        const recipient = requireMember(fresh, to)
        const message = createMessage(from, recipient.name, args.content)
        await appendMailbox(stateRoot, fresh.id, recipient.name, message)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/message-sent', {
          teamId: fresh.id,
          messageId: message.id,
          from,
          to: recipient.name,
          content: args.content,
          ts: message.ts,
        })
        return { kind: 'member' as const, fresh, identity, message, from, recipient }
      })

      // Resolve the exact live captain only after releasing the state lock.
      // The plugin mailbox is already durable if live delivery cannot proceed.
      const captain = ctx.agents.get(prepared.fresh.captainSessionId as SessionId)
      if (prepared.kind === 'captain') {
        let delivered: 'live' | 'mailbox' = 'mailbox'
        if (captain !== undefined && prepared.identity.kind === 'member') {
          delivered = steerCaptainReport(captain, prepared.from, args.content) ? 'live' : 'mailbox'
        }
        return { message_id: prepared.message.id, from: prepared.from, to: CAPTAIN_KEY, delivered }
      }
      let delivered: 'wake' | 'mailbox' = 'mailbox'
      if (captain !== undefined && prepared.recipient.id !== '') {
        const senderText = prepared.from === CAPTAIN_KEY
          ? args.content
          : `Message from team member ${prepared.from}:\n\n${args.content}`
        const text = `AgentTeams state policy: inspect ${config.stateDir}/${prepared.fresh.id}/ read-only; never edit team.json or inbox files directly. Use agent_teams_* tools for team state.\n\n${senderText}`
        const accepted = await deliverToMember(ctx, captain, prepared.recipient.id, text, exec.signal)
        delivered = accepted ? 'wake' : 'mailbox'
      }
      return {
        message_id: prepared.message.id,
        from: prepared.from,
        to: prepared.recipient.name,
        delivered,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_status',
    description: 'Team snapshot: members with live activity and tasks with status/assignee/dependencies/output. Captains also see every team mailbox; members see only their own inbox. Poll this to watch progress.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
    },
    async execute(_args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller)
      const stateRoot = stateRootOf(workspace, config)
      const located = await requireParticipantTeam(workspace, config, caller)
      const { team, identity } = await withTeamLock(
        teamLockKey(stateRoot, located.id),
        () => requireFreshParticipant(stateRoot, located.id, caller.id),
      )
      const activity = await memberActivity(ctx, team.captainSessionId)
      const members = team.members
        .filter((member) => member.status !== 'removed')
        .map((member) => ({
          name: member.name,
          role: member.role ?? '',
          provider: member.provider ?? '',
          model: member.model ?? '',
          reasoning_effort: member.reasoningEffort ?? '',
          status: member.status,
          activity: member.id !== '' ? (activity.get(member.id) ?? 'unknown') : 'unspawned',
        }))
      const tasks = team.tasks.map((task) => ({
        id: task.id,
        subject: task.subject,
        status: task.status,
        assignee: task.assignee ?? '',
        dependencies: task.dependencies,
        ...task.output !== undefined ? { output: task.output } : {},
      }))
      const mailboxWarnings: string[] = []
      let mailboxWarningCount = 0
      const reportMalformed = (agentKey: string) => (lineNumber: number): void => {
        mailboxWarningCount += 1
        if (mailboxWarnings.length < 10) {
          mailboxWarnings.push(`${agentKey} mailbox line ${lineNumber}`)
        }
      }
      const captainInbox = identity.kind === 'captain'
        ? await readMailbox(stateRoot, team.id, CAPTAIN_KEY, reportMalformed(CAPTAIN_KEY))
        : []
      const memberInboxes: Record<string, { count: number; latest: string }> = {}
      const visibleMembers = identity.kind === 'captain'
        ? members
        : members.filter((member) => member.name === identity.name)
      for (const member of visibleMembers) {
        const messages = await readMailbox(
          stateRoot,
          team.id,
          member.name,
          reportMalformed(member.name),
        )
        if (messages.length > 0) {
          memberInboxes[member.name] = {
            count: messages.length,
            latest: messages[messages.length - 1]?.content.slice(0, 200) ?? '',
          }
        }
      }
      return {
        team_id: team.id,
        team_name: team.name,
        description: team.description ?? '',
        viewer: identity.name,
        members,
        tasks,
        captain_inbox: captainInbox.slice(-10).map((message) => ({
          from: message.from,
          content: message.content,
          ts: message.ts,
        })),
        member_inboxes: memberInboxes,
        mailbox_warnings: mailboxWarnings,
        mailbox_warning_count: mailboxWarningCount,
      }
    },
  }))

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
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        for (const member of fresh.members) {
          if (member.status !== 'removed' && member.id !== '') interruptMember(ctx, captain, member.id)
        }
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-deleted', {
          teamId: fresh.id,
        })
        // Archive, not delete: tasks (with their dependency graph) and the
        // mailboxes stay on disk for later review and dependency rebuilds.
        await archiveTeamDir(stateRoot, fresh.id)
      })
      return { deleted: true, team_name: team.name }
    },
  }))
}

/** Build the `memberRuntime` config handed to member helpers. */
function memberRuntime(config: ToolsConfig): MemberRuntimeConfig {
  return {
    provider: config.memberProvider,
    maxDepth: config.memberMaxDepth,
    personaPlacement: config.memberPersonaPlacement,
  }
}

/** Render the status snapshot as compact text for the model. */
function renderStatus(value: JsonValue): string {
  const team = value as {
    team_name: string
    description?: string
    viewer: string
    members: {
      name: string
      role: string
      provider: string
      model: string
      reasoning_effort: string
      status: string
      activity: string
    }[]
    tasks: { id: string; subject: string; status: string; assignee: string; dependencies: string[]; output?: string }[]
    captain_inbox: { from: string; content: string }[]
    member_inboxes: Record<string, { count: number; latest: string }>
    mailbox_warnings: string[]
    mailbox_warning_count: number
  }
  const lines: string[] = [
    `Team "${team.team_name}"${team.description ? ` — ${team.description}` : ''}`,
    `Viewing as: ${team.viewer}`,
    `Members (${team.members.length}):`,
    ...team.members.map((member) => {
      const route = member.provider && member.model ? ` · ${member.provider}/${member.model}` : ''
      const effort = member.reasoning_effort ? ` · reasoning ${member.reasoning_effort}` : ''
      return `  - ${member.name} [${member.role}] ${member.status}/${member.activity}${route}${effort}`
    }),
    `Tasks (${team.tasks.length}):`,
    ...team.tasks.map((task) => {
      const deps = task.dependencies.length > 0 ? ` (deps: ${task.dependencies.join(',')})` : ''
      const output = task.output !== undefined ? `\n      output: ${task.output.slice(0, 300)}` : ''
      return `  - ${task.id} [${task.status}] ${task.subject} → ${task.assignee || 'unassigned'}${deps}${output}`
    }),
    `Captain inbox (${team.captain_inbox.length}):`,
    ...team.captain_inbox.map((message) => `  - [${message.from}] ${message.content.slice(0, 200)}`),
  ]
  for (const [name, inbox] of Object.entries(team.member_inboxes)) {
    lines.push(`Member inbox ${name} (${inbox.count}): latest — ${inbox.latest.slice(0, 120)}`)
  }
  if (team.mailbox_warning_count > 0) {
    lines.push(
      `Mailbox warnings (${team.mailbox_warning_count}; malformed lines were skipped; showing up to 10):`,
      ...team.mailbox_warnings.map((warning) => `  - ${warning}`),
    )
  }
  return lines.join('\n')
}
