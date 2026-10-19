/** Stable, agent-scoped presentation. Business authority stays in the tools. */
import { onAgentReady } from "./harness-compat.js";
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readTeamSync, readRetiredMemberIdsSync } from "./state.js";
import { leadIdentityOf, teamLeadMatch } from "./lineage.js";
import { MEMBER_TOOL_NAMES, PM_EXTRA_TOOL_NAMES, TEAM_TOOL_NAMES, isPmMemberName } from "./tool-names.js";
export const TEAM_ACTIVATION_PROMPT = 'AgentTeams (Agent Teams) provides multi-agent team collaboration. Apply these rules when the user requests it (including /agent-teams) or when continuing an existing team. Mentioning, quoting, discussing, or declining AgentTeams alone is not a request to start work.';
export const TEAM_MEMBER_PROMPT = 'You are an AgentTeams member. Follow your assigned member persona and task contract. Use agent_teams_claim_task, agent_teams_update_task, agent_teams_send_message and agent_teams_status for your own work. Include the current attempt_id in updates; report completion or failure to the captain. Do not create, approve, edit or resume a team. If your durable membership is unavailable, report that to the parent instead of creating a replacement.';
export const TEAM_PM_PROMPT = 'You are an AgentTeams PM (project manager) member. In addition to the member tools (claim_task, update_task, send_message, status), you may use agent_teams_create_task, agent_teams_reassign_task, agent_teams_amend_task and agent_teams_set_member_model to schedule work on the captain\'s behalf. You receive observation copies of inter-member messages — do not reply to them; intervene only when you detect a problem. Do not create, approve, edit or resume a team, and do not add or remove members. If your durable membership is unavailable, report that to the parent instead of creating a replacement.';
function stateRoot(agent, config) {
    return join(agent.session.header.cwd ?? process.cwd(), config.stateDir);
}
/** Synchronous startup/HMR hydration must finish before the first assembly. */
function currentTeam(ctx, agent, config) {
    const lead = leadIdentityOf(ctx, agent.session);
    const root = stateRoot(agent, config);
    let entries;
    try {
        entries = readdirSync(root, { withFileTypes: true });
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
    let found;
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'archive')
            continue;
        const team = readTeamSync(root, entry.name);
        if (team === undefined || (!teamLeadMatch(team, lead)
            && !team.members.some(member => member.id === agent.id)))
            continue;
        if (found !== undefined)
            throw new Error('ambiguous AgentTeams membership');
        found = team;
    }
    return found;
}
/** Call once, after all business definitions have registered. Never per member. */
export function installTeamCapabilities(ctx, config) {
    const states = new WeakMap();
    const active = new Set();
    let mounted = true;
    // Snapshot policy once: profiles, team state, and tool results must never
    // rewrite this prefix or control whether core instructions are available.
    const captainPrompt = `${TEAM_ACTIVATION_PROMPT}\n\n${config.captainPrompt()}`;
    function attach(agent) {
        const prior = states.get(agent);
        if (prior !== undefined)
            return prior;
        if (!mounted)
            throw new Error('AgentTeams capability provider is disposed');
        // Determine a member's role before its first request and retain it for the
        // lifetime of this scope. Team creation/archive must never rewrite the
        // captain's system/tools prefix, even after a long ordinary conversation.
        let member = config.isPendingMember(agent);
        let isPm = false;
        try {
            member ||= readRetiredMemberIdsSync(stateRoot(agent, config)).has(agent.id);
            const team = currentTeam(ctx, agent, config);
            member ||= team !== undefined && !teamLeadMatch(team, leadIdentityOf(ctx, agent.session));
            // The PM scheduling proxy keeps its extra tools (create_task, reassign_task,
            // amend_task, set_member_model) despite being a member.
            if (member && team !== undefined) {
                const memberRecord = team.members.find(m => m.id === agent.id && m.status !== 'removed');
                isPm = memberRecord !== undefined && isPmMemberName(memberRecord.name);
            }
        }
        catch (error) {
            // Unrelated damaged state must not disable ordinary conversation.
            // Business tools still validate durable team state before acting.
            ctx.logger.warn(`agent-teams: capability hydration failed: ${String(error)}`);
        }
        const state = { member, pm: isPm, dispose: () => undefined };
        let revoke;
        let disposed = false;
        let releaseLifetime;
        state.dispose = () => {
            if (disposed)
                return;
            disposed = true;
            revoke?.();
            releaseLifetime?.();
            states.delete(agent);
            active.delete(state);
        };
        states.set(agent, state);
        active.add(state);
        try {
            if (member)
                revoke = agent.ctx.tools.restrict({
                    deny: TEAM_TOOL_NAMES.filter(name => !MEMBER_TOOL_NAMES.includes(name)
                        && !(isPm && PM_EXTRA_TOOL_NAMES.includes(name))),
                });
            releaseLifetime = agent.ctx.effect(() => state.dispose, 'agent-teams: capability lifetime');
            return state;
        }
        catch (error) {
            state.dispose();
            throw error;
        }
    }
    ctx.systemPrompt.section({
        name: 'agent-teams:usage', order: config.order ?? 117,
        text: ({ agent }) => {
            const exposure = agent !== undefined ? states.get(agent) : undefined;
            if (exposure?.member)
                return exposure.pm ? TEAM_PM_PROMPT : TEAM_MEMBER_PROMPT;
            return captainPrompt;
        },
    });
    onAgentReady(ctx, agent => { attach(agent); });
    ctx.effect(() => () => {
        mounted = false;
        for (const state of [...active])
            state.dispose();
    }, 'agent-teams: capability scopes');
    for (const agent of ctx.agents.list())
        attach(agent);
}
