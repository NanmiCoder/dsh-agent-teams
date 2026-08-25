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
  acknowledgeMailbox,
  appendMailbox,
  archiveTeamDir,
  beginTaskAttempt,
  CAPTAIN_KEY,
  createMessage,
  createTeamDir,
  findTeamByCaptain,
  findTeamByParticipant,
  cancelUnfinishedTask,
  invalidateTaskAttempt,
  readUnreadMailbox,
  recordRetiredMemberIds,
  releaseMailboxDelivery,
  readTeam,
  sanitizeKey,
  transitionError,
  unsatisfiedDependencies,
  withTeamLock,
  writeTeam,
  removeTeamDir,
  validateCreateTask,
  evaluateQualityCompletion,
  planQualityFollowUp,
  resumeTeamState,
  buildCoverageMatrix,
  canDeclareDelivery,
  describeQualityLoop,
  defaultQualityDeliveryGraph,
  hasValidQualityTaskFields,
  sanitizeReviewAcceptance,
  sanitizeReviewObjective,
  taskKindOf,
} from './state.ts'
import type { AcceptanceResult, CommandResult, ReviewFinding, ReviewVerdict, TaskKind } from './types.ts'
import {
  deliverToMember,
  installRetiredMemberGuard,
  installMemberSelectionRuntime,
  interruptMember,
  memberActivity,
  resolveMemberLlmSelection,
  spawnMember,
  type MemberRuntimeConfig,
} from './members.ts'
import { TERMINAL_TASK_STATUSES, type TeamMember, type TeamState, type TeamTask } from './types.ts'
import { installTeamScheduler } from './scheduler.ts'
import { resolveTeamProfile } from './profiles.ts'

/** Resolved plugin config consumed by the tools. */
export interface ToolsConfig {
  /** State directory name under the captain's workspace. */
  stateDir: string
  /** Member subagent provider name. */
  memberProvider: string
  /** Optional member model override. */
  memberModel?: string
  /** Prompt injected into member personas and assignments. */
  executionPrompt?: string
  /** Plugin fallback route. */
  fallback?: import('./profiles.ts').TeamModelFallbackConfig
  /** Member delegation depth cap. */
  memberMaxDepth?: number
  /** Team size cap (members). */
  maxMembers: number
  /** Named team profiles from the active DSH profile. */
  profiles: Record<string, import('./profiles.ts').TeamProfileConfig>
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

function memberOpenTask(team: TeamState, memberName: string, exceptTaskId?: string): TeamTask | undefined {
  return team.tasks.find(task => task.id !== exceptTaskId
    && task.assignee === memberName
    && (task.status === 'claimed' || task.status === 'in_progress'))
}

async function waitForMemberIdle(ctx: Context, member: TeamMember, signal: AbortSignal): Promise<void> {
  if (member.id === '') return
  const live = ctx.agents.get(member.id as SessionId)
  if (live === undefined) return
  if (signal.aborted) throw signal.reason
  let onAbort!: () => void
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('task reassignment was cancelled'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    await Promise.race([live.whenIdle(), aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** Stop every currently-resident member activation for one halted team.
 *
 * Interrupt requests only cancel the member's current model turn and retain its
 * activation. Draining the selected direct children is the stronger lifecycle
 * boundary: it waits for the activation handles to release, so a child cannot
 * keep executing after the captain-chat Stop control has reported success.
 */
async function stopTeamMemberActivations(
  ctx: Context,
  captain: Agent,
  members: readonly TeamMember[],
  signal?: AbortSignal,
): Promise<void> {
  const activeMembers = members.filter((member) => member.id !== '' && member.status !== 'removed')
  const memberIds = activeMembers.map((member) => member.id as SessionId)
  if (memberIds.length === 0) return

  for (const memberId of memberIds) interruptMember(ctx, captain, memberId)
  // `drainContinuableChildren` is available in the current runtime and releases
  // the selected activation handles. Keep the quiescence fallback for pre-rc.8
  // hosts, where interrupt is the strongest available lifecycle operation.
  const runtime = ctx.subagents as typeof ctx.subagents & {
    drainContinuableChildren?: (parent: Agent, childIds: readonly SessionId[]) => Promise<void>
  }
  if (runtime.drainContinuableChildren !== undefined) {
    try {
      await runtime.drainContinuableChildren(captain, memberIds)
      return
    } catch (error: unknown) {
      // Do not claim the browser action stopped work when the runtime could not
      // release all selected child activations. The HTTP route surfaces this
      // failure instead of returning a false successful stop.
      ctx.logger.warn(`agent-teams: failed to drain halted members: ${String(error)}`)
      throw error
    }
  }
  const fallbackSignal = signal ?? new AbortController().signal
  const results = await Promise.allSettled(activeMembers.map((member) => waitForMemberIdle(ctx, member, fallbackSignal)))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}

export async function haltTeamWork(input: {
  ctx: Context
  stateRoot: string
  teamId: string
  captain: Agent
  signal?: AbortSignal
}): Promise<{ teamName: string; cancelledTasks: number; alreadyHalted: boolean }> {
  const halted = await withTeamLock(teamLockKey(input.stateRoot, input.teamId), async () => {
    const fresh = await requireFreshCaptainTeam(input.stateRoot, input.teamId, input.captain.id)
    if (fresh.halted === true) {
      return {
        teamName: fresh.name,
        cancelledTasks: fresh.tasks.filter((task) => task.status === 'cancelled').length,
        alreadyHalted: true,
        members: fresh.members.filter((member) => member.id !== '' && member.status !== 'removed').map((member) => ({ ...member })),
      }
    }
    const now = Date.now()
    let cancelledTasks = 0
    for (const task of fresh.tasks) {
      if (TERMINAL_TASK_STATUSES.includes(task.status)) continue
      cancelUnfinishedTask(task, 'Stopped from the captain chat.')
      cancelledTasks += 1
    }
    for (const member of fresh.members) {
      if (member.status === 'removed') continue
      member.status = 'idle'
    }
    fresh.halted = true
    fresh.haltedAt = now
    await writeTeam(input.stateRoot, fresh)
    appendTeamEvent(input.ctx, captainSessionOf(input.ctx, fresh.captainSessionId, input.captain.session), 'agent-teams/team-halted', {
      teamId: fresh.id,
      cancelledTasks,
    })
    return {
      teamName: fresh.name,
      cancelledTasks,
      alreadyHalted: false,
      members: fresh.members.filter((member) => member.id !== '' && member.status !== 'removed').map((member) => ({ ...member })),
    }
  })
  await stopTeamMemberActivations(input.ctx, input.captain, halted.members, input.signal)
  return {
    teamName: halted.teamName,
    cancelledTasks: halted.cancelledTasks,
    alreadyHalted: halted.alreadyHalted,
  }
}

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
  installRetiredMemberGuard(ctx, config.stateDir)
  const memberSelections = installMemberSelectionRuntime(ctx, config.stateDir)
  const scheduler = installTeamScheduler(ctx, { stateDir: config.stateDir, executionPrompt: config.executionPrompt })

  ctx.tools.register(defineTool({
    name: 'agent_teams_create',
    description: 'Create a team. Optional profile expands the configured roster in one in-process transactional create. Seed-planning profiles expand their template tasks; captain-planning profiles instantiate the fixed quality graph requirements → implementation → verification → review → integration from the goal. If profile is omitted, create an empty team and add members/tasks afterwards. If profile is set, do not recreate the same members. A successful create means the team now exists on disk; do not retry create for the same captain.',
    parameters: {
      name: { type: 'string', required: true, description: 'Name for the new team (used as its stable id).' },
      description: { type: 'string', description: 'Team purpose / the goal the team will work on.' },
      profile: { type: 'string', description: 'Optional configured profile name.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          team_id: { type: 'string', required: true },
          team_name: { type: 'string', required: true },
          state_dir: { type: 'string', required: true },
          profile: { type: 'string' },
          task_planning: { type: 'string' },
          members: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { member_name: { type: 'string', required: true }, member_id: { type: 'string', required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, reasoning_effort: { type: 'string' }, status: { type: 'string', required: true } } } },
          tasks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { task_id: { type: 'string', required: true }, seed_id: { type: 'string', required: true }, subject: { type: 'string', required: true }, status: { type: 'string', required: true }, kind: { type: 'string' }, assignee: { type: 'string' }, dependencies: { type: 'array', items: { type: 'string' }, required: true } } } },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Team "${value.team_name}" created (id ${value.team_id}) under ${value.state_dir}. You are the captain${value.task_planning === 'captain' ? '. This profile instantiated the default quality graph; guide it, do not recreate it manually.' : ''}.`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const teamName = args.name.trim()
      if (teamName === '') throw new Error('team name must not be empty')
      const teamId = sanitizeKey(teamName)
      const profileName = args.profile?.trim()
      if (args.profile !== undefined && profileName === '') {
        throw new Error('AgentTeams profile name must not be empty')
      }
      const created = await withTeamLock(captainLockKey(stateRoot, captain.id), async () => {
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
          if (profileName === undefined) {
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
            return { committed: true as const, state }
          }
          return initializeProfileTeam({
            ctx,
            config,
            memberSelections,
            captain,
            exec,
            stateRoot,
            teamName,
            teamId,
            profileName,
            description: args.description,
          })
        })
      })
      if (created.committed) {
        try {
          await scheduler.kickTeam(workspace, created.state.id, captain)
        } catch (error: unknown) {
          ctx.logger.warn(`agent-teams: post-create kick failed for "${created.state.id}": ${String(error)}`)
        }
        try {
          appendTeamEvent(ctx, captain.session, 'agent-teams/team-created', {
            teamId: created.state.id,
            captainSessionId: captain.id,
            name: created.state.name,
            ...created.state.description !== undefined ? { description: created.state.description } : {},
            ...created.state.profile?.name === undefined ? {} : { profile: created.state.profile.name },
          })
          for (const member of created.state.members) {
            appendTeamEvent(ctx, captain.session, 'agent-teams/member-added', {
              teamId: created.state.id,
              memberId: member.id,
              name: member.name,
              ...member.role === undefined ? {} : { role: member.role },
            })
          }
          for (const task of created.state.tasks) {
            appendTeamEvent(ctx, captain.session, 'agent-teams/task-created', {
              teamId: created.state.id,
              taskId: task.id,
              subject: task.subject,
              dependencies: task.dependencies,
              ...task.assignee === undefined ? {} : { assignee: task.assignee },
            })
          }
        } catch (error: unknown) {
          ctx.logger.warn(`agent-teams: post-create events failed for "${created.state.id}": ${String(error)}`)
        }
      }
      const persisted = await readTeam(stateRoot, created.state.id).catch(() => undefined)
      const snapshot = persisted ?? created.state
      if (snapshot.profile === undefined) {
        return {
          team_id: snapshot.id,
          team_name: snapshot.name,
          state_dir: join(stateRoot, snapshot.id),
        }
      }
      return {
        team_id: snapshot.id,
        team_name: snapshot.name,
        state_dir: join(stateRoot, snapshot.id),
        profile: snapshot.profile.name,
        task_planning: snapshot.profile.taskPlanning ?? 'seed',
        members: snapshot.members.map((member) => ({
          member_name: member.name,
          member_id: member.id,
          provider: member.provider ?? '',
          model: member.model ?? '',
          ...member.reasoningEffort === undefined ? {} : { reasoning_effort: member.reasoningEffort },
          status: member.status,
        })),
        tasks: snapshot.tasks.map((task) => ({
          task_id: task.id,
          seed_id: task.profileSeedId ?? '',
          subject: task.subject,
          status: task.status,
          ...task.kind === undefined ? {} : { kind: task.kind },
          ...task.assignee === undefined ? {} : { assignee: task.assignee },
          dependencies: task.dependencies,
        })),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_add_member',
    description: 'Add a durable continuable member. By default it snapshots the captain\'s current LLM route and effort. Supply provider/model only for an explicitly requested role-specific route; a changed provider or model automatically uses the target model\'s default effort. Set reasoning_effort only to request one of the target model\'s supported ids explicitly (or "default" to force its default). The member waits for messages, works on assigned tasks, and can message the team.',
    parameters: {
      name: { type: 'string', required: true, description: 'Unique member name inside the team.' },
      role: { type: 'string', description: 'Role of the member (e.g. researcher, engineer, reviewer).' },
      provider: { type: 'string', description: 'Optional LLM provider route. Use only when the user explicitly requests a different provider; requires model.' },
      model: { type: 'string', description: 'Optional model override. Omit for the captain\'s current model (or the configured memberModel default).' },
      reasoning_effort: { type: 'string', description: 'Optional reasoning effort override: one of the target model\'s supported effort ids, or "default" to force its default. When omitted, the captain\'s effort is inherited only for the same provider/model; a changed route uses the target default.' },
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
      const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
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
          reasoningEffort: args.reasoning_effort,
          fallback: config.fallback,
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
        try {
          await writeTeam(stateRoot, fresh)
        } catch (error: unknown) {
          // The continuable child is already live, but the durable team record
          // never saw it. Retire the orphan so it disappears from subagent
          // listings and cannot be resumed, then surface the write failure.
          if (member.id !== '') {
            await recordRetiredMemberIds(stateRoot, [member.id]).catch(() => undefined)
            interruptMember(ctx, captain, member.id)
          }
          throw error
        }
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
      await scheduler.kickMember(workspace, team.id, created.member_name, captain)
      return created
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_remove_member',
    description: 'Remove a member safely: revoke its current attempts, return all unfinished owned tasks to the shared pending pool, interrupt its live turn, and mark it removed.',
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
          requeued_tasks: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Member "${value.member_name}" removed (status ${value.status}); requeued tasks: ${value.requeued_tasks.join(', ') || 'none'}.`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const member = requireMember(fresh, args.name)
        const requeued: string[] = []
        for (const task of fresh.tasks) {
          if (task.assignee !== member.name || task.status === 'completed') continue
          invalidateTaskAttempt(task)
          task.reassigning = false
          requeued.push(task.id)
        }
        member.status = 'removed'
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/member-removed', {
          teamId: fresh.id,
          memberId: member.id,
        })
        return { member: { ...member }, requeued }
      })
      if (revoked.member.id !== '') {
        await recordRetiredMemberIds(stateRoot, [revoked.member.id])
        interruptMember(ctx, captain, revoked.member.id)
        await waitForMemberIdle(ctx, revoked.member, exec.signal)
      }
      await scheduler.kickTeam(workspace, team.id, captain)
      return {
        member_name: revoked.member.name,
        status: revoked.member.status,
        requeued_tasks: revoked.requeued,
      }
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
      kind: {
        type: 'string',
        enum: ['work', 'requirements', 'implementation', 'verification', 'review', 'repair', 'integration'],
        description: 'Task kind. Defaults to work (legacy, no quality gates). Quality kinds require a contract.',
      },
      round: { type: 'number', description: '1-based review / requirements / repair round.' },
      objective: { type: 'string', description: 'Required non-empty objective for quality kinds.' },
      inScope: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative POSIX paths this task may change.' },
      outOfScope: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative POSIX paths this task must not change.' },
      acceptance: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria. Required for quality kinds.' },
      verify: { type: 'array', items: { type: 'string' }, description: 'Verification commands. Required for implementation/repair.' },
      deliverables: { type: 'array', items: { type: 'string' }, description: 'Expected deliverable paths or names.' },
      nonGoals: { type: 'array', items: { type: 'string' }, description: 'Explicit non-goals.' },
      reviewedTaskId: { type: 'string', description: 'Task being reviewed. Required for kind=review.' },
      sourceTaskId: { type: 'string', description: 'Source implementation/artifact. Required for kind=repair.' },
      sourceFindingIds: { type: 'array', items: { type: 'string' }, description: 'Finding ids this repair must close.' },
      coverageOf: { type: 'array', items: { type: 'string' }, description: 'User-constraint / goal items this task covers.' },
      resume: { type: 'boolean', description: 'If true, clear halted in the same lock before creating the task.' },
      resumeReason: { type: 'string', description: 'Required non-empty reason when resume=true.' },
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
      const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const gate = validateCreateTask(fresh, {
          subject: args.subject,
          description: args.description,
          dependencies: args.dependencies,
          assignee: args.assignee,
          kind: args.kind as TaskKind | undefined,
          round: args.round,
          objective: args.objective,
          inScope: args.inScope,
          outOfScope: args.outOfScope,
          acceptance: args.acceptance,
          verify: args.verify,
          deliverables: args.deliverables,
          nonGoals: args.nonGoals,
          reviewedTaskId: args.reviewedTaskId,
          sourceTaskId: args.sourceTaskId,
          sourceFindingIds: args.sourceFindingIds,
          coverageOf: args.coverageOf,
          resume: args.resume,
          resumeReason: args.resumeReason,
        })
        if (!gate.ok) throw new Error(gate.error ?? 'create_task rejected by quality gates')
        if (fresh.halted === true) {
          const resumed = resumeTeamState(fresh, args.resumeReason ?? '')
          if (resumed.status !== 'resumed' || resumed.team === undefined) {
            throw new Error(resumed.error ?? 'team is halted; call agent_teams_resume or pass resume=true with resumeReason')
          }
          fresh.halted = false
          fresh.haltedAt = undefined
          appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-resumed', {
            teamId: fresh.id,
            reason: args.resumeReason ?? '',
          })
        }
        const dependencies = args.dependencies ?? []
        for (const dependency of dependencies) {
          if (!fresh.tasks.some((task) => task.id === dependency)) {
            throw new Error(`dependency "${dependency}" does not exist in team "${fresh.name}"`)
          }
        }
        if (args.assignee !== undefined) requireMember(fresh, args.assignee)
        const kind = gate.kind ?? 'work'
        const objective = kind === 'review' || kind === 'requirements'
          ? sanitizeReviewObjective(args.objective)
          : args.objective
        const acceptance = kind === 'review' || kind === 'requirements'
          ? sanitizeReviewAcceptance(args.acceptance)
          : args.acceptance
        const task: TeamTask = {
          id: `t${fresh.taskSeq + 1}`,
          subject: args.subject,
          description: args.description,
          status: 'pending',
          assignee: args.assignee,
          dependencies,
          attempt: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          kind,
          ...args.round === undefined ? {} : { round: args.round },
          ...objective === undefined ? {} : { objective },
          ...args.inScope === undefined ? {} : { inScope: args.inScope },
          ...args.outOfScope === undefined ? {} : { outOfScope: args.outOfScope },
          ...acceptance === undefined ? {} : { acceptance },
          ...args.verify === undefined ? {} : { verify: args.verify },
          ...args.deliverables === undefined ? {} : { deliverables: args.deliverables },
          ...args.nonGoals === undefined ? {} : { nonGoals: args.nonGoals },
          ...args.reviewedTaskId === undefined ? {} : { reviewedTaskId: args.reviewedTaskId },
          ...args.sourceTaskId === undefined ? {} : { sourceTaskId: args.sourceTaskId },
          ...args.sourceFindingIds === undefined ? {} : { sourceFindingIds: args.sourceFindingIds },
          ...args.coverageOf === undefined ? {} : { coverageOf: args.coverageOf },
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
          ...task.kind === undefined ? {} : { kind: task.kind },
          ...task.round === undefined ? {} : { round: task.round },
        })
        return {
          task_id: task.id,
          subject: task.subject,
          status: task.status,
          ...task.assignee !== undefined ? { assignee: task.assignee } : {},
        }
      })
      await scheduler.kickTeam(workspace, team.id, captain)
      return created
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_reassign_task',
    description: 'Atomically retry, reassign, or let the captain take over any unfinished/failed task. The old attempt is revoked before its member is interrupted, so late updates cannot overwrite the new owner. Use assignee="captain" for captain takeover.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Task to retry/reassign.' },
      assignee: { type: 'string', required: true, description: 'Active member name, or "captain" for captain takeover.' },
      reason: { type: 'string', description: 'Why the task is being retried or reassigned.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          previous_assignee: { type: 'string', required: true },
          assignee: { type: 'string', required: true },
          status: { type: 'string', required: true },
          attempt: { type: 'number', required: true },
          attempt_id: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} reassigned ${value.previous_assignee || 'unassigned'} → ${value.assignee} (attempt ${value.attempt}, status ${value.status}${value.attempt_id ? `, attempt_id ${value.attempt_id}` : ''}).`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const target = args.assignee.trim()
      if (target === '') throw new Error('reassignment assignee must not be empty')

      const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const task = requireTask(fresh, args.task_id)
        if (task.status === 'completed') throw new Error(`completed task ${task.id} is immutable and cannot be reassigned`)
        if (task.reassigning === true) throw new Error(`task ${task.id} is already being reassigned`)
        const targetMember = target === CAPTAIN_KEY ? undefined : requireMember(fresh, target)
        if (targetMember !== undefined) {
          const busy = memberOpenTask(fresh, targetMember.name, task.id)
          if (busy !== undefined) {
            throw new Error(`member "${targetMember.name}" is busy with ${busy.id}; finish or reassign it first`)
          }
        }
        const previousAssignee = task.assignee ?? ''
        const previousMember = (task.status !== 'claimed' && task.status !== 'in_progress')
          || task.assignee === undefined || task.assignee === CAPTAIN_KEY
          ? undefined
          : fresh.members.find(member => member.name === task.assignee && member.status !== 'removed')
        invalidateTaskAttempt(task, target, true)
        await writeTeam(stateRoot, fresh)
        return {
          previousAssignee,
          previousMember: previousMember === undefined ? undefined : { ...previousMember },
          handoffId: task.handoffId,
        }
      })

      let quiescenceError: unknown
      if (revoked.previousMember !== undefined) {
        interruptMember(ctx, captain, revoked.previousMember.id)
        try {
          await waitForMemberIdle(ctx, revoked.previousMember, exec.signal)
        } catch (error: unknown) {
          quiescenceError = error
        }
      }

      await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const task = requireTask(fresh, args.task_id)
        if (task.handoffId !== revoked.handoffId || task.assignee !== target || task.reassigning !== true) {
          throw new Error(`task ${task.id} changed during reassignment; refusing to overwrite the newer state`)
        }
        task.reassigning = false
        if (quiescenceError === undefined && target === CAPTAIN_KEY) beginTaskAttempt(task, CAPTAIN_KEY)
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captain.session, 'agent-teams/task-updated', {
          teamId: fresh.id,
          taskId: task.id,
          status: task.status,
          assignee: task.assignee,
          ...args.reason === undefined ? {} : { output: `Reassigned: ${args.reason}` },
        })
      })
      if (quiescenceError !== undefined) throw quiescenceError
      if (target !== CAPTAIN_KEY) await scheduler.kickMember(workspace, team.id, target, captain)
      const current = await readTeam(stateRoot, team.id)
      const task = current === undefined ? undefined : requireTask(current, args.task_id)
      if (task === undefined) throw new Error(`team "${team.name}" ended during reassignment`)
      return {
        task_id: task.id,
        previous_assignee: revoked.previousAssignee,
        assignee: task.assignee ?? '',
        status: task.status,
        attempt: task.attempt ?? 0,
        ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_claim_task',
    description: 'Claim one ready task for a member (or yourself). A member cannot own a second unfinished task. The returned attempt_id is required for that member\'s updates and becomes stale after retry/reassignment.',
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
          attempt: { type: 'number', required: true },
          attempt_id: { type: 'string' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} claimed by ${value.assignee} (attempt ${value.attempt}${value.attempt_id ? `, attempt_id ${value.attempt_id}` : ''}, status ${value.status}).`,
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
        if (task.reassigning === true) {
          throw new Error(`task ${task.id} is being reassigned; wait for the handoff to finish`)
        }
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
          return {
            task_id: task.id,
            status: task.status,
            assignee,
            attempt: task.attempt ?? 0,
            ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
          }
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
        const busy = memberOpenTask(fresh, assignee, task.id)
        if (busy !== undefined) {
          throw new Error(`member "${assignee}" is busy with ${busy.id}; finish or reassign it first`)
        }
        const attemptId = beginTaskAttempt(task, assignee)
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
          teamId: fresh.id,
          taskId: task.id,
          status: task.status,
          assignee: task.assignee,
        })
        return {
          task_id: task.id,
          status: task.status,
          assignee: task.assignee ?? '',
          attempt: task.attempt ?? 0,
          attempt_id: attemptId,
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_update_task',
    description: 'Update a task status/output. Members must supply the current attempt_id returned by claim_task; stale attempts are rejected after takeover/reassignment. Terminal results are immutable. A captain must use reassign_task(assignee="captain") before updating member-owned work.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'The task id to update.' },
      status: {
        type: 'string',
        enum: ['in_progress', 'completed', 'failed', 'cancelled'],
        description: 'New status (in_progress, completed, failed, cancelled).',
      },
      output: { type: 'string', description: 'Result summary; set when completing or failing.' },
      attempt_id: { type: 'string', description: 'Current execution capability returned by claim_task (required for members when present on the task).' },
      verdict: {
        type: 'string',
        enum: ['pass', 'needs_revision', 'reject'],
        description: 'Required for completing requirements/review. needs_revision and reject must fail the task.',
      },
      findings: {
        type: 'array',
        items: { type: 'object', additionalProperties: true, properties: {} },
        description: 'Structured review findings. Required when verdict is needs_revision or reject.',
      },
      changedPaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Workspace-relative POSIX paths changed by this implementation/repair.',
      },
      acceptanceResults: {
        type: 'array',
        items: { type: 'object', additionalProperties: true, properties: {} },
        description: 'Acceptance evidence. Quality kinds require a passed result for every acceptance item.',
      },
      commandsRun: {
        type: 'array',
        items: { type: 'object', additionalProperties: true, properties: {} },
        description: 'Verification command evidence. Must cover every verify command.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          output: { type: 'string' },
          attempt: { type: 'number', required: true },
          attempt_id: { type: 'string' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} attempt ${value.attempt} → ${value.status}${value.output !== undefined ? `\nOutput: ${value.output}` : ''}`,
      }],
    },
    async execute(args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireParticipantTeam(workspace, config, caller)
      const updated = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
        const task = requireTask(fresh, args.task_id)
        if (identity.kind === 'captain'
          && task.assignee !== undefined
          && task.assignee !== CAPTAIN_KEY) {
          throw new Error(`task ${task.id} is owned by member "${task.assignee}"; call agent_teams_reassign_task with assignee="captain" before takeover`)
        }
        if (identity.kind === 'member') {
          if (task.assignee !== identity.name) {
            throw new Error(`task ${task.id} is assigned to "${task.assignee ?? 'nobody'}", not you`)
          }
          if (task.attemptId !== undefined && args.attempt_id !== task.attemptId) {
            throw new Error(`stale attempt for task ${task.id}: expected the current attempt_id; stop work and request fresh assignment`)
          }
        }
        if (TERMINAL_TASK_STATUSES.includes(task.status)) {
          const sameStatus = args.status === undefined || args.status === task.status
          const sameOutput = args.output === undefined || args.output === task.output
          if (!sameStatus || !sameOutput) {
            throw new Error(`terminal task ${task.id} is immutable; use agent_teams_reassign_task to retry failed/cancelled work`)
          }
          return {
            task_id: task.id,
            status: task.status,
            attempt: task.attempt ?? 0,
            ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
            ...task.output !== undefined ? { output: task.output } : {},
          }
        }
        const findings = parseFindings(args.findings)
        const acceptanceResults = parseAcceptanceResults(args.acceptanceResults)
        const commandsRun = parseCommandResults(args.commandsRun)
        const gate = evaluateQualityCompletion(task, {
          status: args.status,
          output: args.output,
          verdict: args.verdict as ReviewVerdict | undefined,
          findings,
          changedPaths: args.changedPaths,
          acceptanceResults,
          commandsRun,
        })
        if (!gate.ok) throw new Error(gate.error ?? 'update_task rejected by quality gates')
        if (args.status !== undefined) {
          const transition = transitionError(task.status, args.status)
          if (transition !== undefined) throw new Error(transition)
          task.status = args.status
        }
        if (args.output !== undefined) task.output = args.output
        if (args.verdict !== undefined) task.verdict = args.verdict as ReviewVerdict
        if (findings !== undefined) task.findings = findings
        if (args.changedPaths !== undefined) task.changedPaths = args.changedPaths
        if (acceptanceResults !== undefined) task.acceptanceResults = acceptanceResults
        if (commandsRun !== undefined) task.commandsRun = commandsRun
        task.updatedAt = Date.now()
        const followUp = (task.status === 'failed' && (task.verdict === 'needs_revision' || task.verdict === 'reject'))
          ? applyQualityFollowUp(fresh, task)
          : undefined
        if (followUp?.escalated === true) {
          await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, createMessage(
            CAPTAIN_KEY,
            CAPTAIN_KEY,
            `Quality-gate loop escalated after ${task.id} (${task.kind ?? 'review'} verdict=${task.verdict}). Automatic repair/review stopped.`,
          ))
        }
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
          teamId: fresh.id,
          taskId: task.id,
          status: task.status,
          ...task.assignee !== undefined ? { assignee: task.assignee } : {},
          ...task.output !== undefined ? { output: task.output } : {},
          ...task.verdict === undefined ? {} : { verdict: task.verdict },
          ...task.round === undefined ? {} : { round: task.round },
        })
        for (const created of followUp?.created ?? []) {
          appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-created', {
            teamId: fresh.id,
            taskId: created.id,
            subject: created.subject,
            dependencies: created.dependencies,
            ...created.assignee === undefined ? {} : { assignee: created.assignee },
            ...created.kind === undefined ? {} : { kind: created.kind },
            ...created.round === undefined ? {} : { round: created.round },
          })
        }
        return {
          task_id: task.id,
          status: task.status,
          attempt: task.attempt ?? 0,
          ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
          ...task.output !== undefined ? { output: task.output } : {},
        }
      })
      await scheduler.kickTeam(workspace, team.id, team.captainSessionId === caller.id ? caller : undefined)
      return updated
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
          const message = { ...createMessage(from, CAPTAIN_KEY, args.content), deliveryClaimedAt: Date.now() }
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
        if (fresh.halted === true) {
          throw new Error(`team "${fresh.name}" is halted; call agent_teams_resume before waking a member`)
        }
        const recipient = requireMember(fresh, to)
        const message = { ...createMessage(from, recipient.name, args.content), deliveryClaimedAt: Date.now() }
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
        if (delivered === 'live') {
          await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
            acknowledgeMailbox(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])
          ))
        } else {
          await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
            releaseMailboxDelivery(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])
          ))
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
        if (accepted) {
          await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
            acknowledgeMailbox(stateRoot, prepared.fresh.id, prepared.recipient.name, [prepared.message.id])
          ))
        }
      }
      if (delivered === 'mailbox') {
        await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
          releaseMailboxDelivery(stateRoot, prepared.fresh.id, prepared.recipient.name, [prepared.message.id])
        ))
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
      if (located.captainSessionId === caller.id) {
        await scheduler.kickTeam(workspace, located.id, caller)
      }
      const { team, identity } = await withTeamLock(
        teamLockKey(stateRoot, located.id),
        () => requireFreshParticipant(stateRoot, located.id, caller.id),
      )
      const activity = memberActivity(ctx, team.members.map((member) => member.id))
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
        attempt: task.attempt ?? 0,
        attempt_id: task.attemptId ?? '',
        reassigning: task.reassigning === true,
        kind: taskKindOf(task),
        ...task.round === undefined ? {} : { round: task.round },
        ...task.verdict === undefined ? {} : { verdict: task.verdict },
        findings_open: (task.findings ?? []).filter((finding) => finding.resolved !== true).length,
        ...task.profileSeedId === undefined ? {} : { seed_id: task.profileSeedId },
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
        ? await readUnreadMailbox(stateRoot, team.id, CAPTAIN_KEY, reportMalformed(CAPTAIN_KEY))
        : []
      const memberInboxes: Record<string, { count: number; latest: string }> = {}
      const visibleMembers = identity.kind === 'captain'
        ? members
        : members.filter((member) => member.name === identity.name)
      for (const member of visibleMembers) {
        const messages = await readUnreadMailbox(
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
      const coverage = buildCoverageMatrix(
        [...new Set(team.tasks.flatMap((item) => item.coverageOf ?? []))],
        team.tasks,
      ).map((row) => ({
        goal_item: row.goal_item,
        task_ids: [...row.task_ids],
        status: row.status,
        ...row.evidence === undefined ? {} : { evidence: row.evidence },
      }))
      const deliveryCheck = canDeclareDelivery(team)
      const delivery = { ok: deliveryCheck.ok, blockers: [...deliveryCheck.blockers] }
      const loop = describeQualityLoop(team)
      const result = {
        team_id: team.id,
        team_name: team.name,
        description: team.description ?? '',
        halted: loop.halted,
        escalated: loop.escalated,
        loop_state: loop.state,
        loop_summary: loop.summary,
        deliverable: loop.deliverable,
        coverage,
        delivery,
        ...team.profile === undefined ? {} : {
          profile: {
            name: team.profile.name,
            ...team.profile.protocol === undefined
              ? {}
              : { protocol: team.profile.protocol.slice(0, 240) },
            ...team.profile.taskPlanning === undefined ? {} : { task_planning: team.profile.taskPlanning },
          },
        },
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
      const acknowledged = identity.kind === 'captain'
        ? captainInbox.map(message => message.id)
        : await readUnreadMailbox(stateRoot, team.id, identity.name).then(messages => messages.map(message => message.id))
      if (acknowledged.length > 0) {
        await withTeamLock(teamLockKey(stateRoot, team.id), () => (
          acknowledgeMailbox(stateRoot, team.id, identity.kind === 'captain' ? CAPTAIN_KEY : identity.name, acknowledged)
        ))
      }
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_resume',
    description: 'Explicitly resume a halted team. Requires a non-empty reason. Does not recreate cancelled tasks; only still-pending work is scheduled.',
    parameters: {
      reason: { type: 'string', required: true, description: 'Why the team is being resumed.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          team_id: { type: 'string', required: true },
          reason: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'already_running'
          ? `Team ${value.team_id} is already running.`
          : `Team ${value.team_id} resumed (${value.reason}).`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const result = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const resumed = resumeTeamState(fresh, args.reason)
        if (resumed.status === 'rejected') throw new Error(resumed.error ?? 'resume rejected')
        if (resumed.status === 'resumed') {
          fresh.halted = false
          fresh.haltedAt = undefined
          await writeTeam(stateRoot, fresh)
          appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-resumed', {
            teamId: fresh.id,
            reason: args.reason,
          })
        }
        return {
          status: resumed.status,
          team_id: fresh.id,
          reason: args.reason,
        }
      })
      if (result.status === 'resumed') await scheduler.kickTeam(workspace, team.id, captain)
      return result
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
      const members = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        // Include previously removed members so deleting a pre-fix team also
        // retires durable catalog entries left behind by remove_member.
        const roster = fresh.members.map(member => ({ ...member }))
        for (const member of fresh.members) {
          if (member.status === 'removed') continue
          member.status = 'removed'
          for (const task of fresh.tasks) {
            if (task.assignee === member.name && task.status !== 'completed') invalidateTaskAttempt(task)
          }
        }
        await writeTeam(stateRoot, fresh)
        return roster
      })
      await recordRetiredMemberIds(stateRoot, members.map(member => member.id))
      for (const member of members) {
        if (member.id === '') continue
        interruptMember(ctx, captain, member.id)
      }
      const quiescence = await Promise.allSettled(members.map(member => waitForMemberIdle(ctx, member, exec.signal)))
      for (const result of quiescence) {
        if (result.status === 'rejected') {
          ctx.logger.warn(`agent-teams: member did not quiesce cleanly before team archive: ${String(result.reason)}`)
        }
      }
      await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
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

function normalizedRoleTerms(member: Pick<TeamMember, 'name' | 'role'>): string[] {
  return `${member.name} ${member.role ?? ''}`
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean)
}

function uniqueRoleAssignee(members: readonly Pick<TeamMember, 'name' | 'role'>[], aliases: readonly string[]): string | undefined {
  for (const alias of aliases) {
    const matched = members.filter((member) => normalizedRoleTerms(member).includes(alias))
    if (matched.length === 1) return matched[0]?.name
    // A higher-priority role term that names several members is ambiguous;
    // do not quietly pick a lower-priority, less-specific match.
    if (matched.length > 1) return undefined
  }
  return undefined
}

/** Instantiate the fixed quality graph that captain-planning profiles deliver. */
function instantiateCaptainQualityTasks(
  goal: string,
  members: readonly Pick<TeamMember, 'name' | 'role'>[],
  now: number,
): TeamTask[] {
  const graph = defaultQualityDeliveryGraph({
    goal,
    analyst: uniqueRoleAssignee(members, ['analyst', 'requirements', 'researcher']),
    implementer: uniqueRoleAssignee(members, ['implementer', 'developer']),
    tester: uniqueRoleAssignee(members, ['tester', 'test', 'verification']),
    reviewer: uniqueRoleAssignee(members, ['reviewer', 'review', 'auditor']),
    integrator: uniqueRoleAssignee(members, ['integrator', 'integration', 'release', 'lead']),
  })
  const idBySubject = new Map(graph.map((item, index) => [item.subject, `t${index + 1}`] as const))
  const tasks = graph.map((item, index): TeamTask => {
    const id = `t${index + 1}`
    const task: TeamTask = {
      id,
      profileSeedId: item.subject,
      subject: item.subject,
      description: item.objective,
      status: 'pending',
      ...item.assignee === undefined ? {} : { assignee: item.assignee },
      dependencies: item.dependencies.map((dependency) => idBySubject.get(dependency) ?? dependency),
      attempt: 0,
      kind: item.kind,
      round: 1,
      objective: item.objective,
      acceptance: [...item.acceptance],
      ...item.inScope === undefined ? {} : { inScope: [...item.inScope] },
      ...item.verify === undefined ? {} : { verify: [...item.verify] },
      ...item.coverageOf === undefined ? {} : { coverageOf: [...item.coverageOf] },
      ...item.kind === 'review' ? { reviewedTaskId: idBySubject.get('implementation')! } : {},
      createdAt: now,
      updatedAt: now,
    }
    if (!hasValidQualityTaskFields({ ...task })) throw new Error(`default quality graph emitted invalid task "${item.subject}"`)
    return task
  })
  const implementation = tasks.find((task) => task.kind === 'implementation')
  const review = tasks.find((task) => task.kind === 'review')
  if (implementation === undefined || review?.reviewedTaskId !== implementation.id) {
    throw new Error('default quality graph failed to link its review to implementation')
  }
  return tasks
}

async function initializeProfileTeam(input: {
  ctx: Context
  config: ToolsConfig
  memberSelections: ReturnType<typeof installMemberSelectionRuntime>
  captain: Agent
  exec: ToolRunContext
  stateRoot: string
  teamName: string
  teamId: string
  profileName: string
  description?: string
}): Promise<{ committed: true; state: TeamState }> {
  const profile = resolveTeamProfile(input.config.profiles, input.profileName, input.config.maxMembers)
  const selections: Awaited<ReturnType<typeof resolveMemberLlmSelection>>[] = []
  for (const template of profile.members) {
    selections.push(await resolveMemberLlmSelection(input.ctx, input.captain, {
      provider: template.provider,
      model: template.model,
      defaultModel: input.config.memberModel,
      reasoningEffort: template.reasoningEffort,
      fallback: template.fallback ?? profile.fallback ?? input.config.fallback,
    }, input.exec.signal))
  }
  const now = Date.now()
  const generatedTasks = profile.taskPlanning === 'captain'
    ? instantiateCaptainQualityTasks(input.description ?? input.teamName, profile.members, now)
    : undefined
  const seedToActual = new Map(profile.tasks.map((template, index) => [template.id, `t${index + 1}`] as const))
  const draft: TeamState = {
    name: input.teamName,
    id: input.teamId,
    description: input.description,
    profile: {
      name: profile.name,
      ...profile.description === undefined ? {} : { description: profile.description },
      ...profile.protocol === undefined ? {} : { protocol: profile.protocol },
      ...profile.executionPrompt === undefined ? {} : { executionPrompt: profile.executionPrompt },
      ...profile.fallback === undefined ? {} : { fallback: profile.fallback },
      taskPlanning: profile.taskPlanning,
      ...profile.reviewPolicy === undefined ? {} : { reviewPolicy: profile.reviewPolicy },
    },
    ...profile.reviewPolicy === undefined ? {} : { reviewPolicy: profile.reviewPolicy },
    captainSessionId: input.captain.id,
    createdAt: now,
    members: profile.members.map((template, index) => {
      const selection = selections[index]!
      return {
        id: '',
        name: template.name,
        role: template.role,
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
        executionPrompt: template.executionPrompt ?? profile.executionPrompt ?? input.config.executionPrompt,
        ...selection.fallback === undefined ? {} : { fallback: selection.fallback },
        joinedAt: now,
        status: 'idle' as const,
      }
    }),
    tasks: generatedTasks ?? profile.tasks.map((template, index) => ({
      id: `t${index + 1}`,
      profileSeedId: template.id,
      subject: template.subject,
      description: template.description,
      status: 'pending' as const,
      assignee: template.assignee,
      dependencies: template.dependencies.map((dependency) => seedToActual.get(dependency) ?? dependency),
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    })),
    taskSeq: generatedTasks?.length ?? profile.tasks.length,
  }
  const spawned: TeamMember[] = []
  try {
    for (const member of draft.members) {
      const selection = selections[spawned.length]!
      await spawnMember(
        input.ctx,
        memberRuntime(input.config),
        input.memberSelections,
        selection,
        input.captain,
        draft,
        member,
        input.config.stateDir,
        input.exec.signal,
      )
      spawned.push(member)
    }
    if (draft.members.some((member) => member.id === '')) {
      throw new Error(`failed to initialize profile "${profile.name}": a spawned member is missing its child id`)
    }
    await createTeamDir(input.stateRoot, draft)
    return { committed: true, state: draft }
  } catch (error: unknown) {
    const cleanupErrors: unknown[] = []
    try {
      await removeTeamDir(input.stateRoot, draft.id)
    } catch (cleanupError: unknown) {
      cleanupErrors.push(cleanupError)
    }
    try {
      await recordRetiredMemberIds(input.stateRoot, spawned.map((member) => member.id))
    } catch (cleanupError: unknown) {
      cleanupErrors.push(cleanupError)
    }
    for (const member of spawned) {
      try {
        interruptMember(input.ctx, input.captain, member.id)
      } catch (cleanupError: unknown) {
        cleanupErrors.push(cleanupError)
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], `failed to initialize profile "${profile.name}"`)
    }
    throw error
  }
}

function parseFindings(value: unknown): ReviewFinding[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('findings must be an array')
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`findings[${index}] must be an object`)
    }
    const raw = item as Record<string, unknown>
    if (typeof raw['id'] !== 'string' || raw['id'].trim() === '') throw new Error(`findings[${index}].id is required`)
    if (raw['severity'] !== 'low' && raw['severity'] !== 'medium' && raw['severity'] !== 'high' && raw['severity'] !== 'blocker') {
      throw new Error(`findings[${index}].severity is invalid`)
    }
    if (typeof raw['problem'] !== 'string' || raw['problem'].trim() === '') throw new Error(`findings[${index}].problem is required`)
    if (typeof raw['requiredFix'] !== 'string' || raw['requiredFix'].trim() === '') throw new Error(`findings[${index}].requiredFix is required`)
    return {
      id: raw['id'].trim(),
      severity: raw['severity'],
      problem: raw['problem'],
      requiredFix: raw['requiredFix'],
      ...typeof raw['file'] === 'string' ? { file: raw['file'] } : {},
      ...typeof raw['line'] === 'number' ? { line: raw['line'] } : {},
      ...typeof raw['resolved'] === 'boolean' ? { resolved: raw['resolved'] } : {},
    }
  })
}

function parseAcceptanceResults(value: unknown): AcceptanceResult[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('acceptanceResults must be an array')
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`acceptanceResults[${index}] must be an object`)
    }
    const raw = item as Record<string, unknown>
    if (typeof raw['criterion'] !== 'string' || raw['criterion'].trim() === '') {
      throw new Error(`acceptanceResults[${index}].criterion is required`)
    }
    if (raw['status'] !== 'passed' && raw['status'] !== 'failed') {
      throw new Error(`acceptanceResults[${index}].status must be passed or failed`)
    }
    return {
      criterion: raw['criterion'],
      status: raw['status'],
      ...typeof raw['evidence'] === 'string' ? { evidence: raw['evidence'] } : {},
    }
  })
}

function parseCommandResults(value: unknown): CommandResult[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('commandsRun must be an array')
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`commandsRun[${index}] must be an object`)
    }
    const raw = item as Record<string, unknown>
    if (typeof raw['command'] !== 'string' || raw['command'].trim() === '') {
      throw new Error(`commandsRun[${index}].command is required`)
    }
    if (raw['status'] !== 'passed' && raw['status'] !== 'failed') {
      throw new Error(`commandsRun[${index}].status must be passed or failed`)
    }
    return {
      command: raw['command'],
      status: raw['status'],
      ...typeof raw['exitCode'] === 'number' ? { exitCode: raw['exitCode'] } : {},
      ...typeof raw['evidence'] === 'string' ? { evidence: raw['evidence'] } : {},
    }
  })
}

function applyQualityFollowUp(team: TeamState, closed: TeamTask): { created: TeamTask[]; escalated: boolean } {
  const planned = planQualityFollowUp(team, closed)
  if (planned.escalated === true) team.escalated = true
  const created: TeamTask[] = []
  const now = Date.now()
  const idBySubject = new Map<string, string>()
  for (const draft of planned.created) {
    team.taskSeq += 1
    const id = `t${team.taskSeq}`
    if (draft.id !== undefined) idBySubject.set(draft.id, id)
    if (draft.subject !== undefined) idBySubject.set(draft.subject, id)
    const dependencies = (draft.dependencies ?? []).map((dependency) => {
      if (team.tasks.some((item) => item.id === dependency)) return dependency
      return idBySubject.get(dependency) ?? dependency
    })
    const next: TeamTask = {
      id,
      subject: draft.subject ?? `${draft.kind}-round-${draft.round ?? 1}`,
      status: 'pending',
      assignee: draft.assignee,
      dependencies,
      attempt: 0,
      createdAt: now,
      updatedAt: now,
      kind: draft.kind,
      ...draft.round === undefined ? {} : { round: draft.round },
      ...draft.objective === undefined ? {} : { objective: draft.objective },
      ...draft.inScope === undefined ? {} : { inScope: draft.inScope },
      ...draft.outOfScope === undefined ? {} : { outOfScope: draft.outOfScope },
      ...draft.acceptance === undefined ? {} : { acceptance: draft.acceptance },
      ...draft.verify === undefined ? {} : { verify: draft.verify },
      ...draft.sourceTaskId === undefined ? {} : { sourceTaskId: draft.sourceTaskId },
      ...draft.sourceFindingIds === undefined ? {} : { sourceFindingIds: draft.sourceFindingIds },
      ...draft.reviewedTaskId === undefined ? {} : { reviewedTaskId: idBySubject.get(draft.reviewedTaskId) ?? draft.reviewedTaskId },
    }
    team.tasks.push(next)
    created.push(next)
  }
  return { created, escalated: planned.escalated === true }
}

/** Build the `memberRuntime` config handed to member helpers. */
function memberRuntime(config: ToolsConfig): MemberRuntimeConfig {
  return {
    provider: config.memberProvider,
    maxDepth: config.memberMaxDepth,
    executionPrompt: config.executionPrompt,
    fallback: config.fallback,
  }
}

/** Render the status snapshot as compact text for the model. */
function renderStatus(value: JsonValue): string {
  const team = value as {
    team_name: string
    description?: string
    profile?: { name: string; protocol?: string; task_planning?: string }
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
    tasks: { id: string; subject: string; status: string; assignee: string; dependencies: string[]; attempt: number; attempt_id: string; reassigning: boolean; seed_id?: string; output?: string; kind?: string; round?: number; verdict?: string; findings_open?: number }[]
    captain_inbox: { from: string; content: string }[]
    member_inboxes: Record<string, { count: number; latest: string }>
    mailbox_warnings: string[]
    mailbox_warning_count: number
    halted?: boolean
    escalated?: boolean
    loop_state?: string
    loop_summary?: string
    deliverable?: boolean
    coverage?: { goal_item: string; status: string; task_ids: string[] }[]
    delivery?: { ok: boolean; blockers: string[] }
  }
  const flags = [
    team.halted ? 'halted' : undefined,
    team.escalated ? 'escalated' : undefined,
    team.deliverable ? 'deliverable' : undefined,
    team.loop_state && team.loop_state !== 'running' && team.loop_state !== 'halted' && team.loop_state !== 'escalated'
      ? team.loop_state
      : undefined,
  ].filter((item): item is string => item !== undefined)
  const lines: string[] = [
    `Team "${team.team_name}"${team.description ? ` — ${team.description}` : ''}${flags.length > 0 ? ` [${flags.join(', ')}]` : ''}`,
    ...team.profile === undefined ? [] : [`Profile: ${team.profile.name}${team.profile.task_planning ? ` [${team.profile.task_planning}]` : ''}${team.profile.protocol ? ` — ${team.profile.protocol}` : ''}`],
    ...team.loop_summary ? [`Loop: ${team.loop_state ?? ''} — ${team.loop_summary}`.replace(/^Loop:  — /u, 'Loop: ')] : [],
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
      const handoff = task.reassigning ? ' (reassigning)' : ''
      const seed = task.seed_id === undefined || task.seed_id === '' ? '' : ` seed ${task.seed_id}`
      const kind = task.kind ? ` ${task.kind}` : ''
      const round = task.round === undefined ? '' : ` r${task.round}`
      const verdict = task.verdict === undefined ? '' : ` verdict ${task.verdict}`
      return `  - ${task.id} [${task.status}]${kind}${round}${verdict} attempt ${task.attempt}${handoff}${seed} ${task.subject} → ${task.assignee || 'unassigned'}${deps}${output}`
    }),
    ...team.coverage === undefined || team.coverage.length === 0 ? [] : [
      'Coverage:',
      ...team.coverage.map((row) => `  - ${row.goal_item}: ${row.status} (${row.task_ids.join(',') || 'none'})`),
    ],
    ...team.delivery === undefined ? [] : [
      `Delivery: ${team.delivery.ok ? 'ok' : `blocked (${team.delivery.blockers.join('; ')})`}`,
    ],
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
