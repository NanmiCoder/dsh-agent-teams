/** Progressive, agent-scoped presentation. Business authority stays in the tools. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { findTeamByParticipant, readTeamSync, readRetiredMemberIdsSync } from './state.ts'
import type { TeamState } from './types.ts'
import { MEMBER_TOOL_NAMES, OPEN_TEAM_TOOL, TEAM_TOOL_NAMES } from './tool-names.ts'

export const TEAM_DISCOVERY_PROMPT = 'AgentTeams (Agent Teams) provides multi-agent team collaboration. When the user requests it, including /agent-teams, first call agent_teams_open to load the team tools and read the current team summary. Mentioning, quoting, discussing, or declining AgentTeams alone is not a request to use it. Opening does not create a team or start work.'
export const TEAM_MEMBER_PROMPT = 'You are an AgentTeams member. Follow your assigned member persona and task contract. Use agent_teams_claim_task, agent_teams_update_task, agent_teams_send_message and agent_teams_status for your own work. Include the current attempt_id in updates; report completion or failure to the captain. Do not create, approve, edit or resume a team. If your durable membership is unavailable, report that to the parent instead of creating a replacement.'

type Role = 'discovery' | 'captain' | 'member'
interface Exposure {
  agent: Agent
  role: Role
  opened: boolean
  member: boolean
  teamId?: string
  profile?: string
  revoke?: () => void
  dispose: () => void
}

interface CapabilityConfig {
  stateDir: string
  isPendingMember: (agent: Agent) => boolean
  profileNames: () => readonly string[]
  captainPrompt: (profile?: string) => string
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

  function present(state: Exposure, role: Role): void {
    if (state.role === role && state.revoke !== undefined) return
    const deny = role === 'captain' ? [] : TEAM_TOOL_NAMES.filter(name => role === 'discovery' || !MEMBER_TOOL_NAMES.includes(name))
    const names: string[] = [...deny, ...role === 'member' ? [OPEN_TEAM_TOOL] : []]
    // Install the new mask before lifting our old one. Other owners' masks
    // remain in place; never register scoped copies to bypass their denial.
    const revoke = names.length === 0 ? () => undefined : state.agent.ctx.tools.restrict({ deny: names })
    state.revoke?.()
    state.revoke = revoke
    state.role = role
  }

  function refresh(state: Exposure): void {
    let team: TeamState | undefined
    try {
      state.member ||= config.isPendingMember(state.agent) || readRetiredMemberIdsSync(stateRoot(state.agent, config)).has(state.agent.id)
      team = currentTeam(state.agent, config)
    } catch (error) {
      // Ordinary conversation must remain usable when unrelated state is
      // corrupt. The explicit open tool surfaces the read failure to callers.
      ctx.logger.warn(`agent-teams: capability hydration failed: ${String(error)}`)
      present(state, state.member ? 'member' : 'discovery')
      return
    }
    if (team !== undefined) {
      state.teamId = team.id
      state.profile = team.profile?.name
      state.member = team.captainSessionId !== state.agent.id
      present(state, state.member ? 'member' : 'captain')
    } else {
      if (state.teamId !== undefined) state.opened = false
      state.teamId = undefined
      present(state, state.member ? 'member' : state.opened ? 'captain' : 'discovery')
    }
  }

  function attach(agent: Agent): Exposure {
    const prior = states.get(agent)
    if (prior !== undefined) return prior
    if (!mounted) throw new Error('AgentTeams capability provider is disposed')
    const state: Exposure = { agent, role: 'discovery', opened: false, member: config.isPendingMember(agent), dispose: () => undefined }
    let disposed = false
    let releaseLifetime: (() => void) | undefined
    state.dispose = () => {
      if (disposed) return
      disposed = true
      state.revoke?.()
      releaseLifetime?.()
      states.delete(agent)
      active.delete(state)
    }
    states.set(agent, state)
    active.add(state)
    try {
      refresh(state)
      releaseLifetime = agent.ctx.effect(() => state.dispose, 'agent-teams: capability lifetime')
      return state
    } catch (error) { state.dispose(); throw error }
  }

  ctx.tools.register(defineTool({
    name: OPEN_TEAM_TOOL,
    description: 'Load AgentTeams tools when the user requests AgentTeams / Agent Teams or multi-agent team collaboration. Call this first for natural-language or /agent-teams requests. Reads the current team summary; does not create, approve, resume, stop, or schedule work.',
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
      const profiles = config.profileNames()
      if (profile !== undefined && !profiles.includes(profile)) throw new Error(`unknown AgentTeams profile "${profile}"`)
      const team = await findTeamByParticipant(stateRoot(agent, config), agent.id)
      exec.signal.throwIfAborted()
      const state = attach(agent)
      if (state.member || (team !== undefined && team.captainSessionId !== agent.id)) {
        throw new Error('AgentTeams members use their assigned tools; only the captain opens team planning')
      }
      state.opened = true
      state.teamId = team?.id
      state.profile = team === undefined ? profile : team.profile?.name
      present(state, 'captain')
      const profileConflict = team !== undefined && profile !== undefined && profile !== team.profile?.name
      return {
        role: 'captain',
        next: profileConflict ? 'The requested profile differs from the current team. Opening has not switched it. Preserve the current team unless the user already explicitly requested ending it for a new goal; otherwise clarify that choice before replacing it.' : nextAction(team),
        ...profile === undefined ? { profiles: [...profiles] } : { requested_profile: profile },
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
      const state = agent === undefined ? undefined : states.get(agent)
      if (state?.role === 'member') return TEAM_MEMBER_PROMPT
      if (state?.role === 'captain') return config.captainPrompt(state.profile)
      return TEAM_DISCOVERY_PROMPT
    },
  })
  ctx.on('agent/session-start', ({ agent }) => { attach(agent) })
  ctx.on('tools/result', (exec) => {
    if (exec.agent === undefined || !['agent_teams_create', 'agent_teams_delete'].includes(exec.name)) return
    const state = states.get(exec.agent)
    if (state === undefined) return
    // A create/delete may both commit within one batch, including PTC child
    // dispatches. Drop the temporary open latch even if later result policy
    // rejects a committed side effect. Durable state decides the role at idle.
    state.opened = false
    try {
      const team = currentTeam(exec.agent, config)
      if (team !== undefined) { state.teamId = team.id; state.profile = team.profile?.name }
    } catch (error) { ctx.logger.warn(`agent-teams: capability observation failed: ${String(error)}`) }
    return undefined
  })
  // Safe boundaries: do not revoke tools in the middle of a model's batch.
  ctx.on('agent/inbox/claimed', ({ agent }) => { refresh(attach(agent)) })
  ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') refresh(attach(agent)) })
  ctx.effect(() => () => {
    mounted = false
    for (const state of [...active]) state.dispose()
  }, 'agent-teams: capability scopes')
  for (const agent of ctx.agents.list()) attach(agent)
}
