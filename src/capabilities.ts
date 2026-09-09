/** Stable, agent-scoped presentation. Business authority stays in the tools. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { findTeamByParticipant, readTeamSync, readRetiredMemberIdsSync } from './state.ts'
import type { TeamProfileSummary } from './profiles.ts'
import type { TeamState } from './types.ts'
import { MEMBER_TOOL_NAMES, OPEN_TEAM_TOOL, TEAM_TOOL_NAMES } from './tool-names.ts'

export const TEAM_DISCOVERY_PROMPT = 'AgentTeams (Agent Teams) provides multi-agent team collaboration. Apply the following team rules when the user requests it (including /agent-teams) or when continuing an existing team. Mentioning, quoting, discussing, or declining AgentTeams alone is not a request to start work. The core protocol below is already available. agent_teams_open is an optional read-only helper for team status and configured profile summaries; if unavailable, use agent_teams_status or the existing business tools. In code mode print or return any helper data you need to inspect before planning. Opening never creates, approves, resumes, or schedules work.'
export const TEAM_MEMBER_PROMPT = 'You are an AgentTeams member. Follow your assigned member persona and task contract. Use agent_teams_claim_task, agent_teams_update_task, agent_teams_send_message and agent_teams_status for your own work. Include the current attempt_id in updates; report completion or failure to the captain. Do not create, approve, edit or resume a team. If your durable membership is unavailable, report that to the parent instead of creating a replacement.'

interface Exposure {
  member: boolean
  dispose: () => void
}

interface CapabilityConfig {
  stateDir: string
  isPendingMember: (agent: Agent) => boolean
  profileCatalog: () => readonly TeamProfileSummary[]
  captainPrompt: () => string
  order?: number
}

function stateRoot(agent: Agent, config: CapabilityConfig): string {
  return join(agent.session.header.cwd ?? process.cwd(), config.stateDir)
}

/** Synchronous startup/HMR hydration must finish before the first assembly. */
function currentTeam(agent: Agent, config: CapabilityConfig): TeamState | undefined {
  const root = stateRoot(agent, config)
  let entries
  try { entries = readdirSync(root, { withFileTypes: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let found: TeamState | undefined
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'archive') continue
    const team = readTeamSync(root, entry.name)
    if (team === undefined || (team.captainSessionId !== agent.id
      && !team.members.some(member => member.id === agent.id))) continue
    if (found !== undefined) throw new Error('ambiguous AgentTeams membership')
    found = team
  }
  return found
}

function nextAction(team: TeamState | undefined): string {
  if (team === undefined) return 'No current team. For a new goal call agent_teams_create with approval="required", build the staged plan, then wait for user review. Use automatic approval only if the user explicitly requested immediate execution.'
  if (team.halted === true) return 'This team is halted. Preserve it; resume only on an explicit user request using agent_teams_resume with a reason. Do not create a replacement merely because it is stopped.'
  if (team.phase === 'staged') return 'Continue this existing staged plan. Do not recreate its members or tasks. Respect its review state and wait for explicit approval before execution.'
  return 'You already have a team. Continue its work without calling create. If the user explicitly wants a separate new goal, handle ending the old team first; do not silently discard or replace existing work.'
}

/** Call once, after all business definitions have registered. Never per member. */
export function installTeamCapabilities(ctx: Context, config: CapabilityConfig): void {
  const states = new WeakMap<Agent, Exposure>()
  const active = new Set<Exposure>()
  let mounted = true
  // Snapshot policy once: profiles, team state, and tool results must never
  // rewrite this prefix or control whether core instructions are available.
  const captainPrompt = `${TEAM_DISCOVERY_PROMPT}\n\n${config.captainPrompt()}`

  function attach(agent: Agent): Exposure {
    const prior = states.get(agent)
    if (prior !== undefined) return prior
    if (!mounted) throw new Error('AgentTeams capability provider is disposed')
    // Determine a member's role before its first request and retain it for the
    // lifetime of this scope. Team creation/archive must never rewrite the
    // captain's system/tools prefix, even after a long ordinary conversation.
    let member = config.isPendingMember(agent)
    try {
      member ||= readRetiredMemberIdsSync(stateRoot(agent, config)).has(agent.id)
      const team = currentTeam(agent, config)
      member ||= team !== undefined && team.captainSessionId !== agent.id
    } catch (error) {
      // Unrelated damaged state must not disable ordinary conversation.
      // Explicit open still reports its read error instead of replacing work.
      ctx.logger.warn(`agent-teams: capability hydration failed: ${String(error)}`)
    }
    const state: Exposure = { member, dispose: () => undefined }
    let revoke: (() => void) | undefined
    let disposed = false
    let releaseLifetime: (() => void) | undefined
    state.dispose = () => {
      if (disposed) return
      disposed = true
      revoke?.()
      releaseLifetime?.()
      states.delete(agent)
      active.delete(state)
    }
    states.set(agent, state)
    active.add(state)
    try {
      if (member) revoke = agent.ctx.tools.restrict({
        deny: [...TEAM_TOOL_NAMES.filter(name => !MEMBER_TOOL_NAMES.includes(name)), OPEN_TEAM_TOOL],
      })
      releaseLifetime = agent.ctx.effect(() => state.dispose, 'agent-teams: capability lifetime')
      return state
    } catch (error) { state.dispose(); throw error }
  }

  ctx.tools.register(defineTool({
    name: OPEN_TEAM_TOOL,
    description: 'Optional read-only AgentTeams helper: inspect the current team and available profile purposes, roster sizes and planning modes. Core team instructions are already in the system prompt; direct business tools remain usable without opening. Does not create, approve, resume, stop, or schedule work.',
    parameters: { profile: { type: 'string', description: 'Optional configured team profile requested by the user.' } },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('agent_teams_open requires a calling agent')
      exec.signal.throwIfAborted()
      const profile = args.profile?.trim() || undefined
      const profiles = config.profileCatalog()
      if (profile !== undefined && !profiles.some(item => item.name === profile)) throw new Error(`unknown AgentTeams profile "${profile}"`)
      const team = await findTeamByParticipant(stateRoot(agent, config), agent.id)
      exec.signal.throwIfAborted()
      const state = attach(agent)
      if (state.member || (team !== undefined && team.captainSessionId !== agent.id)) {
        throw new Error('AgentTeams members use their assigned tools; only the captain opens team planning')
      }
      const profileConflict = team !== undefined && profile !== undefined && profile !== team.profile?.name
      return {
        role: 'captain',
        next: profileConflict ? 'The requested profile differs from the current team. Opening has not switched it. Preserve the current team unless the user already explicitly requested ending it for a new goal; otherwise clarify that choice before replacing it.' : nextAction(team),
        profiles: profiles.filter(item => profile === undefined || item.name === profile).map(item => ({ ...item })),
        ...profile === undefined ? {} : { requested_profile: profile },
        ...profileConflict ? { profile_conflict: true } : {},
        ...team === undefined ? {} : { team: {
          id: team.id, name: team.name, phase: team.phase ?? 'running', halted: team.halted === true,
          ...team.phase === 'staged' ? { review: team.planReviewState ?? 'awaiting_review' } : {},
          members: team.members.filter(member => member.status !== 'removed').length,
          tasks: team.tasks.length,
          unfinished: team.tasks.filter(task => !['completed', 'failed', 'cancelled'].includes(task.status)).length,
          ...team.profile === undefined ? {} : { profile: team.profile.name },
        } },
      }
    },
  }))

  ctx.systemPrompt.section({
    name: 'agent-teams:usage', order: config.order ?? 117,
    text: ({ agent }) => {
      return agent !== undefined && states.get(agent)?.member ? TEAM_MEMBER_PROMPT : captainPrompt
    },
  })
  ctx.on('agent/session-start', ({ agent }) => { attach(agent) })
  ctx.effect(() => () => {
    mounted = false
    for (const state of [...active]) state.dispose()
  }, 'agent-teams: capability scopes')
  for (const agent of ctx.agents.list()) attach(agent)
}
