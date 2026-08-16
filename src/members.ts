/**
 * Member subagent lifecycle: spawn a continuable child per member, deliver
 * messages into its FIFO inbox, and observe its activity.
 *
 * Members are durable continuable subagents of the captain, so a member keeps
 * its conversation across turns and across harness restarts: the captain
 * wakes it with {@link ctx.subagents.followup}, it works through its turn
 * (updating team state through the `agent_teams_*` tools), and becomes idle
 * again. Its final assistant message is not readable programmatically, so the
 * member persists its report into the captain's mailbox and the task records,
 * which the captain reads through `agent_teams_status`.
 * @module dsh-agent-teams/members
 */

import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type ModelSelection } from '@deepseek-ai/dsh-agent'
// Declaration merge only: makes ctx.subagents visible.
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { join } from 'node:path'
import { readTeamSync } from './state.ts'
import type { TeamMember, TeamState } from './types.ts'

/** Captain-only AgentTeams tools hidden from newly spawned members. */
const MEMBER_DENIED_TOOLS = [
  'agent_teams_create',
  'agent_teams_add_member',
  'agent_teams_remove_member',
  'agent_teams_reassign_task',
  'agent_teams_create_task',
  'agent_teams_delete',
] as const

/**
 * Restore the SessionId brand on a value that round-tripped through the
 * durable team file. The brand is erased by JSON serialization; the value
 * originated from `startContinuable`/`agent.id`, so this cast is the boundary
 * restoration, not a new assertion.
 */
function brandedSessionId(value: string): SessionId {
  return value as SessionId
}

/** Runtime knobs for member spawning, resolved from plugin config. */
export interface MemberRuntimeConfig {
  /** Registered `ctx.subagents` provider name (must support continuable + persona). */
  provider: string
  /** Child delegation depth cap (0 forbids delegation entirely). */
  maxDepth?: number
}

/** Durable provider/model/reasoning snapshot for one member. */
export interface MemberLlmSelection {
  /** Registered LLM provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, absent when the target has no explicit/default effort. */
  reasoningEffort?: string
}

/** Optional member-level route requested by the captain. */
export interface MemberLlmSelectionRequest {
  /** Explicit LLM provider route; requires an explicit model. */
  provider?: string
  /** Explicit model id; otherwise the plugin default or captain model is used. */
  model?: string
  /** Plugin-level member model default. */
  defaultModel?: string
}

/** Process-local bridge between spawn admission and synchronous child setup. */
export interface MemberSelectionRuntime {
  /** Make one selection visible while Harness materializes the fresh child. */
  withPending<T>(
    parentSessionId: string,
    label: string,
    selection: MemberLlmSelection,
    operation: () => Promise<T>,
  ): Promise<T>
}

const MEMBER_LABEL_PREFIX = 'agent-teams:'

function pendingSelectionKey(parentSessionId: string, label: string): string {
  return `${parentSessionId}\u0000${label}`
}

function selectionFromMember(member: TeamMember | undefined): MemberLlmSelection | undefined {
  if (member?.provider === undefined || member.model === undefined) return undefined
  const provider = member.provider.trim()
  const model = member.model.trim()
  if (provider === '' || model === '') return undefined
  const reasoningEffort = member.reasoningEffort?.trim()
  return {
    provider,
    model,
    ...reasoningEffort === undefined || reasoningEffort === '' ? {} : { reasoningEffort },
  }
}

function modelSelection(selection: MemberLlmSelection): ModelSelection {
  return {
    provider: selection.provider,
    model: selection.model,
    ...selection.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) },
  }
}

/**
 * Resolve one member's complete model selection. Ordinary members snapshot the
 * captain's current request route and reasoning effort. An explicit member
 * provider/model or plugin-level model replaces only that route; the current
 * captain effort remains the inherited policy and is validated against the
 * target model before a child is created.
 */
export async function resolveMemberLlmSelection(
  ctx: Context,
  captain: Agent,
  request: MemberLlmSelectionRequest,
  signal?: AbortSignal,
): Promise<MemberLlmSelection> {
  const explicitProvider = request.provider?.trim()
  const explicitModel = request.model?.trim()
  const defaultModel = request.defaultModel?.trim()
  if (request.provider !== undefined && explicitProvider === '') {
    throw new Error('member LLM provider must not be empty')
  }
  if (request.model !== undefined && explicitModel === '') {
    throw new Error('member model must not be empty')
  }
  if (request.defaultModel !== undefined && defaultModel === '') {
    throw new Error('configured memberModel must not be empty')
  }
  if (explicitProvider !== undefined && explicitModel === undefined) {
    throw new Error('an explicit member LLM provider requires an explicit member model')
  }

  const current = captain.session.requestHeader()?.config
  const provider = explicitProvider ?? current?.provider ?? captain.options.provider
  const model = explicitModel ?? defaultModel ?? current?.model ?? captain.options.model
  if (provider === undefined || model === undefined) {
    throw new Error('cannot resolve the member LLM route from the current captain session')
  }

  const resolved = await ctx.llm.resolveCallConfig({
    provider,
    model,
    ...current?.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: current.reasoningEffort },
  }, signal)
  return {
    provider: resolved.provider,
    model: resolved.model,
    ...resolved.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: String(resolved.reasoningEffort) },
  }
}

/**
 * Install the member selection bridge for every fresh or cold-resumed
 * continuable child. Fresh creation reads the pending in-memory selection;
 * cold resume restores the same selection from the owning team's durable
 * record. Legacy members without a complete saved route retain Harness's
 * descriptor provider/model behavior.
 */
export function installMemberSelectionRuntime(ctx: Context, stateDir: string): MemberSelectionRuntime {
  const pending = new Map<string, MemberLlmSelection>()
  ctx.subagents.registerContinuableSetup((childCtx) => {
    const child = childCtx.agent
    if (child === undefined) return () => undefined
    const suffix = child.session.events.slice(child.session.header.seedLength ?? 0)
    const descriptor = foldSubagentDescriptor(suffix)
    if (descriptor?.mode !== 'continuable' || !descriptor.label.startsWith(MEMBER_LABEL_PREFIX)) {
      return () => undefined
    }

    const parentSessionId = child.session.header.parentSession
    if (parentSessionId === undefined) return () => undefined
    const key = pendingSelectionKey(parentSessionId, descriptor.label)
    let selection = pending.get(key)
    if (selection === undefined) {
      const identity = descriptor.label.slice(MEMBER_LABEL_PREFIX.length)
      const separator = identity.indexOf(':')
      if (separator < 1 || separator === identity.length - 1) return () => undefined
      const teamId = identity.slice(0, separator)
      const memberName = identity.slice(separator + 1)
      const workspace = child.session.header.cwd ?? process.cwd()
      const team = readTeamSync(join(workspace, stateDir), teamId)
      if (team?.captainSessionId !== parentSessionId) return () => undefined
      selection = selectionFromMember(team.members.find(member => member.name === memberName))
      // An old team record has no provider/reasoning snapshot. Its durable
      // Harness descriptor still restores provider/model, so leave it alone.
      if (selection === undefined) return () => undefined
      if (descriptor.agentProvider !== selection.provider || descriptor.agentModel !== selection.model) {
        throw new Error(
          `agent-teams: saved model route for member "${memberName}" does not match its subagent descriptor`,
        )
      }
    }

    return installModelSelection(childCtx, {
      current: modelSelection(selection),
      assembled: undefined,
    })
  })

  return {
    async withPending<T>(
      parentSessionId: string,
      label: string,
      selection: MemberLlmSelection,
      operation: () => Promise<T>,
    ): Promise<T> {
      const key = pendingSelectionKey(parentSessionId, label)
      if (pending.has(key)) {
        throw new Error(`member model selection is already pending for "${label}"`)
      }
      pending.set(key, selection)
      try {
        return await operation()
      } finally {
        pending.delete(key)
      }
    },
  }
}

/**
 * The member's system prompt (persona), shadowing the deployment persona for
 * that child. Self-contained: it replaces the whole persona section.
 * @param team - the team the member joined.
 * @param member - the member record (name/role are read before spawning).
 * @param stateDir - configured state directory, so the member can locate the
 *   team files with its own file tools.
 */
export function memberPersona(team: TeamState, member: TeamMember, stateDir: string): string {
  return `You are ${member.name}, a member of the multi-agent team "${team.name}" running inside DeepSeek Harness AgentTeams. The captain leads the team; you are a worker member${member.role ? ` with the role: ${member.role}` : ''}.

Team context:
- Team id: ${team.id}
- Your name inside the team (use it as \`from\`/identity): ${member.name}
- The team state lives under ${stateDir}/${team.id}/ (team.json and inbox/*.jsonl). You may inspect these files read-only for diagnostics, but never edit them directly; use the agent_teams_* tools so JSON escaping and concurrent updates stay safe.
- The captain and your teammates reach you through messages. Each message you receive is a new turn: act on it and end your turn with a concise reply.

Working rules:
1. When you receive a task assignment, call agent_teams_claim_task with the task id. Keep the returned attempt_id: include it in every agent_teams_update_task call for that execution attempt. Then mark the task in_progress.
2. Work thoroughly with your available tools; do not cut corners.
3. When finished, call agent_teams_update_task with the same attempt_id, status=completed, and a concise \`output\` summarizing what you did and the key results. A stale-attempt rejection means the captain reassigned or took over the task; stop touching that task and wait for new work.
4. Send a short report to the captain with agent_teams_send_message (to=captain) when you complete a task or hit a blocker.
5. To ask a teammate something, use agent_teams_send_message with to=<teammate name>; the message lands in their mailbox and wakes them directly — teammates talk to each other without the captain in the loop. The same applies to the captain (to=captain).
6. After your turn becomes idle, the shared task scheduler may assign your next ready task automatically. Never claim a second task while you still own unfinished work.
7. You are a worker: do not create or delete teams, reassign tasks, or add/remove members — that is the captain's job.`
}

/**
 * The initial user message delivered when the member is created.
 * @param team - the team the member joined.
 */
export function memberWelcome(team: TeamState): string {
  return `You have joined the team "${team.name}" as a member. The captain will send you tasks and messages; wait for instructions. Current team status: ${team.tasks.length} task(s), none assigned to you yet.`
}

/**
 * Spawn one member as a durable continuable subagent of the captain and fill
 * `member.id` with its child session id. On failure nothing is persisted.
 * @param ctx - the plugin context (injects `subagents`).
 * @param config - member runtime knobs.
 * @param selections - fresh/cold child model-selection bridge.
 * @param llmSelection - resolved provider/model/reasoning snapshot.
 * @param captain - the exact live captain agent (the calling agent).
 * @param team - the team record (read-only here).
 * @param member - the member draft whose `id` is filled on success.
 * @param stateDir - configured state directory (for the persona).
 * @param signal - caller cancellation, forwarded to the start.
 */
export async function spawnMember(
  ctx: Context,
  config: MemberRuntimeConfig,
  selections: MemberSelectionRuntime,
  llmSelection: MemberLlmSelection,
  captain: Agent,
  team: TeamState,
  member: TeamMember,
  stateDir: string,
  signal: AbortSignal,
): Promise<void> {
  // Fail loud at the first use: provider registration is a sibling plugin's
  // effect and may settle after this plugin mounts. Capability checks here
  // mirror what startContinuable would reject, with an actionable error.
  const provider = ctx.subagents.getProvider(config.provider)
  if (provider === undefined) {
    throw new Error(
      `agent-teams: no subagent provider "${config.provider}" is registered (available: ${ctx.subagents.list().join(', ') || 'none'}) — `
      + 'check that the subagent provider row (e.g. subagent-spawn) is mounted in the composition',
    )
  }
  if (provider.prepareContinuable === undefined) {
    throw new Error(`agent-teams: provider "${config.provider}" does not support continuable members`)
  }
  if (!provider.capabilities.persona) {
    throw new Error(`agent-teams: provider "${config.provider}" cannot apply a member persona`)
  }
  if (!provider.capabilities.toolFilter) {
    throw new Error(`agent-teams: provider "${config.provider}" cannot restrict captain-only tools for members`)
  }
  const label = `${MEMBER_LABEL_PREFIX}${team.id}:${member.name}`
  const start = await selections.withPending(captain.id, label, llmSelection, () => (
    ctx.subagents.startContinuable({
      provider: config.provider,
      label,
      request: {
        prompt: [{ type: 'text', text: memberWelcome(team) }],
        parent: captain,
        persona: memberPersona(team, member, stateDir),
        toolFilter: { deny: [...MEMBER_DENIED_TOOLS] },
        agentOptions: {
          provider: llmSelection.provider,
          model: llmSelection.model,
        },
        ...config.maxDepth !== undefined ? { maxDepth: config.maxDepth } : {},
      },
      signal,
    })
  ))
  member.id = start.childId
}

/**
 * Deliver one message to a member as its next FIFO turn. Best effort: a
 * failure (member gone or not continuable) is logged and reported as `false`
 * so the caller can decide (mailbox delivery still happened).
 *
 * Any team sender can route through this helper: the captain is the direct
 * parent of every member, and the caller passes the captain's live Agent
 * (its own when the captain calls, the registry-resolved one when a member
 * sends) — mirroring the Claude Code mailbox model where the writer writes
 * the target's inbox and the target picks it up on its own.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captain - the exact live captain agent (the member's direct parent).
 * @param childId - the member's durable child session id.
 * @param text - the message content.
 * @param signal - caller cancellation, forwarded to the delivery.
 * @returns whether the member inbox accepted the message.
 */
export async function deliverToMember(
  ctx: Context,
  captain: Agent,
  childId: string,
  text: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    await ctx.subagents.followup(captain, brandedSessionId(childId), [{ type: 'text', text }], {
      source: { kind: 'plugin', plugin: 'dsh-agent-teams' },
      signal,
    })
    return true
  } catch (error: unknown) {
    ctx.logger.warn(`agent-teams: followup to member ${childId} failed: ${String(error)}`)
    return false
  }
}

/**
 * Request cancellation of one live member's current turn. Best effort, fire
 * and return; the target may keep running until it observes the signal.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captain - the exact live captain agent (the member's parent).
 * @param childId - the member's durable child session id.
 */
export function interruptMember(ctx: Context, captain: Agent, childId: string): void {
  try {
    ctx.subagents.interrupt(brandedSessionId(childId), { kind: 'ancestor', agent: captain })
  } catch (error: unknown) {
    ctx.logger.warn(`agent-teams: interrupt of member ${childId} failed: ${String(error)}`)
  }
}

/**
 * Snapshot each direct continuable child's real driver activity under the
 * captain's session. `listChildren().activity` is only session residency, so
 * live children are refined through the Agent registry exactly like Harness's
 * shipped `list_agents` tool.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captainSessionId - the captain's session id.
 * @returns child id → activity, missing entries are unknown children.
 */
export async function memberActivity(
  ctx: Context,
  captainSessionId: string,
): Promise<Map<string, 'running' | 'idle' | 'ready'>> {
  const entries = await ctx.subagents.listChildren(brandedSessionId(captainSessionId))
  const activity = new Map<string, 'running' | 'idle' | 'ready'>()
  for (const entry of entries) {
    if (entry.kind !== 'child') continue
    const live = ctx.agents.get(entry.id)
    activity.set(entry.id, live === undefined ? 'ready' : live.status)
  }
  return activity
}
