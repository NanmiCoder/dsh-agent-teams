/**
 * The audited Harness 0.1.2 / 0.1.5 / 0.1.7 subagent boundary. Keep version-specific shapes
 * here: API presence alone is not a promise of support for future versions.
 *
 * Alpha.2 owns followup/registerContinuableSetup; Alpha.5 and rc.1 own a
 * host-only FIFO queue; 0.1.5 uses a queue/steer deliverer. Both emit
 * synchronous agent/session-start with the explicit Agent. Their public
 * sendMessage instead steers a running Agent and must never carry team jobs.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, MessageId, MessageSource } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as dshSession from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SubagentError } from '@deepseek-ai/dsh-subagent'
import { BUILTIN_DENY_TOOLS, resolveMemberToolFilter, type MemberToolFilter } from './tool-policies.ts'

/**
 * Exact protocol exported by dsh-subagent/internal in Alpha.5 and rc.1.
 * That subpath does not exist in Alpha.2, so importing it statically prevents
 * the plugin from loading there. This small adapter uses the same process-
 * stable symbol and call signature as upstream queueHostSubagentPrompt.
 * Source: packages/subagent/subagent/src/internal.ts at dsh-v0.1.2-rc.1.
 */
const hostPromptQueue = Symbol.for('dsh.subagent.queuePrompt')
// 0.1.5 keeps queueHostSubagentPrompt but replaces its symbol with this
// delivery-mode-aware implementation (packages/subagent/subagent/src/internal.ts).
const hostPromptDeliver = Symbol.for('dsh.subagent.deliverPrompt')
type Setup = (childCtx: Context, child: Agent) => () => void
type LegacySetup = (childCtx: Context & { agent?: Agent }) => () => void
type Followup = (parent: Agent, childId: SessionId, content: ContentBlock[], options: {
  source: MessageSource; signal: AbortSignal
}) => Promise<MessageId>
type Queue = (parent: Agent, childId: SessionId, content: ContentBlock[], source: MessageSource, signal: AbortSignal) => Promise<MessageId>
type Deliver = (parent: Agent, childId: SessionId, content: ContentBlock[], source: MessageSource, signal: AbortSignal, delivery: 'queue' | 'steer') => Promise<MessageId>
type Send = (sender: Agent, targetId: SessionId, content: ContentBlock[], options: { signal: AbortSignal }) => Promise<MessageId>
interface RuntimeBoundary {
  followup?: Followup
  registerContinuableSetup?: (setup: LegacySetup) => () => void
  sendMessage?: Send
  [hostPromptQueue]?: Queue
  [hostPromptDeliver]?: Deliver
}

function boundary(runtime: Context['subagents']): RuntimeBoundary {
  return runtime as unknown as RuntimeBoundary
}

function unsupported(detail: string): never {
  throw new Error(`agent-teams: unsupported Harness subagent contract (${detail}); use an explicitly tested Harness version and a coherent dependency installation`)
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'agent-teams': { readonly kind: 'agent-teams' }
  }
}

/** Package identity a released plugin-wrapper source names on older hosts. */
export const AGENT_TEAMS_PLUGIN_NAME = '@nanmicoder/dsh-agent-teams'

/**
 * First stored format generation whose migration edges admit producer-owned
 * source kinds. The released v2→v3 payload audit validates every message source
 * against a closed list of released kinds, so a stored format older than this
 * must carry a released source or the whole session becomes unreadable once a
 * newer host opens it (#160).
 */
export const RELEASED_SOURCE_VOCABULARY_VERSION = 3

/** Source kinds this plugin mints on a host whose stored format admits them. */
export type AgentTeamsSource =
  | { readonly kind: 'agent-teams' }
  | { readonly kind: 'agent-teams-command'; readonly goal?: string; readonly profile?: string }

/** Anything that exposes the stored format generation on its live session header. */
export interface SessionFormatBearer {
  readonly session?: { readonly header?: { readonly version?: unknown } } | undefined
}

/**
 * Stored format generation observed on a live session, when the host exposes it.
 *
 * The module constant is only a fallback: a plugin can resolve a *nested*
 * `@deepseek-ai/dsh-session` copy that belongs to a different host generation
 * than the process loading it (a profile whose lockfile pins the DSH package
 * line, a Desktop shell with an embedded core, a duplicated store). That copy
 * then reports the wrong generation — 0 on a v4 host — which selects the
 * retired `plugin` wrapper and makes every durable AgentTeams message fail the
 * host's own admission check (#236). The live session header belongs to the
 * host that persists the message, so it outranks the resolved module.
 */
export function observedSessionFormatVersion(subject?: SessionFormatBearer): number | undefined {
  const version = subject?.session?.header?.version
  return typeof version === 'number' && Number.isSafeInteger(version) && version >= 0 ? version : undefined
}

/**
 * Stored session format generation of the running host; 0 when neither the live
 * session nor the resolved module exposes one.
 * @param observed - a live session observation; preferred over the module constant.
 */
export function hostSessionFormatVersion(observed?: number): number {
  if (typeof observed === 'number' && Number.isSafeInteger(observed) && observed >= 0) return observed
  const version = (dshSession as unknown as { SESSION_FORMAT_VERSION?: number }).SESSION_FORMAT_VERSION
  return typeof version === 'number' && Number.isSafeInteger(version) && version >= 0 ? version : 0
}

/**
 * Source for one AgentTeams-authored message on the running host.
 *
 * Current hosts mint producer-owned kinds: the Harness documents message
 * sources as a merge-extensible vocabulary without a catch-all, so this plugin
 * declares its own. Hosts that still store a pre-v3 generation are a different
 * contract — their released v2→v3 migration rejects any source outside the
 * released vocabulary, which is exactly how a plugin kind written on an older
 * supported host poisons its session log for every later host. On those hosts
 * the released plugin wrapper is used instead; the goal and profile already
 * travel in the message text.
 * @param modern - the producer-owned source to use where the host admits it.
 * @param observed - the live session's stored format generation, when callers
 * have the owning agent at hand. Never trust the resolved module alone: on a
 * host whose profile pins another DSH line it reports a retired generation and
 * the v4 writer rejects the wrapper (#236).
 * @returns a source accepted by the running host and by its migration chain.
 */
export function agentTeamsSource(modern: AgentTeamsSource, observed?: number): MessageSource {
  if (hostSessionFormatVersion(observed) >= RELEASED_SOURCE_VOCABULARY_VERSION) return modern
  // Released-format hosts persist plugin-authored messages as this wrapper; the
  // current vocabulary retired it, so the cast stays confined to this branch
  // and `modern` is the only shape a current host ever sees.
  return { kind: 'plugin', plugin: AGENT_TEAMS_PLUGIN_NAME } as unknown as MessageSource
}

/**
 * 0.1.6 moved startup admission to serial agent/created. Older created events
 * have no source and precede session-start; ignore those until the old hook.
 * Keep the removed event's type confined to this audited compatibility seam.
 */
export function onAgentReady(ctx: Context, listener: (agent: Agent, vetoable: boolean) => void): () => void {
  const stopCreated = ctx.on('agent/created', payload => {
    if ('source' in payload) listener(payload.agent, true)
    return undefined
  })
  const legacy = ctx as unknown as {
    on(name: 'agent/session-start', listener: (payload: { agent: Agent }) => void): () => void
  }
  const stopLegacy = legacy.on('agent/session-start', ({ agent }) => listener(agent, false))
  return () => { stopCreated(); stopLegacy() }
}

/** Read child-owned history, excluding any descriptor inherited from a parent. */
export function sessionOwnEvents(session: Session): readonly SessionEvent[] {
  const current = session as unknown as { ownEvents?: () => readonly SessionEvent[] }
  if (typeof current.ownEvents === 'function') return current.ownEvents.call(session)
  const legacy = session as unknown as { events?: readonly SessionEvent[]; header: { seedLength?: number } }
  if (!Array.isArray(legacy.events)) return unsupported('missing ownEvents/legacy session log')
  return legacy.events.slice(legacy.header.seedLength ?? 0)
}

/** Install before the first request, including cold resume, with HMR cleanup. */
export function installContinuableMemberSetup(ctx: Context, setup: Setup): void {
  const runtime = boundary(ctx.subagents)
  if (typeof runtime.registerContinuableSetup === 'function') {
    // Upstream owns this registration with this.ctx.effect. Cordis resolves
    // that ctx to the accessing plugin, so its disposal revokes installations
    // even while the subagents service and child Agents remain live.
    runtime.registerContinuableSetup.call(ctx.subagents, (childCtx) => {
      if (childCtx.agent === undefined) return unsupported('legacy setup lacks child Agent')
      return setup(childCtx, childCtx.agent)
    })
    return
  }
  if ((typeof runtime[hostPromptQueue] !== 'function' && typeof runtime[hostPromptDeliver] !== 'function') || typeof runtime.sendMessage !== 'function') {
    return unsupported('missing continuable setup and modern host queue')
  }
  const installed = new WeakSet<Agent>()
  const active = new Set<() => void>()
  ctx.effect(() => {
    const stop = onAgentReady(ctx, (agent, vetoable) => {
      if (installed.has(agent)) return
      // Deliberately synchronous: awaiting here loses the first-request race.
      let teardown: () => void
      try {
        teardown = setup(agent.ctx, agent)
      } catch (error: unknown) {
        if (vetoable) throw error
        // session-start is a notification: Harness logs a thrown listener and
        // still admits the first prompt. Reject request assembly explicitly so
        // a malformed saved route cannot silently execute on a default model.
        const failure = new Error(`agent-teams: member initialization failed: ${String(error)}`, { cause: error })
        ctx.logger.warn(failure.message)
        teardown = agent.ctx.on('agent/request', () => { throw failure })
      }
      installed.add(agent)
      let disposed = false
      const dispose = (): void => {
        if (disposed) return
        disposed = true
        active.delete(dispose)
        installed.delete(agent)
        teardown()
      }
      active.add(dispose)
      // Listeners contributed to agent.ctx already follow its lifetime. Also
      // release our bookkeeping and remove them if this plugin is reloaded.
      try {
        agent.ctx.effect(() => dispose, 'agent-teams: child compatibility setup')
      } catch (error) {
        dispose()
        throw error
      }
    })
    return () => {
      stop()
      for (const dispose of [...active]) dispose()
    }
  }, 'agent-teams: member lifecycle compatibility')
}

/** Queue a distinct host-authored turn; never substitute model-message steer. */
export async function queueMemberPrompt(
  runtime: Context['subagents'], parent: Agent, childId: SessionId,
  content: ContentBlock[], signal: AbortSignal,
): Promise<MessageId> {
  const host = boundary(runtime)
  const source = agentTeamsSource({ kind: 'agent-teams' }, observedSessionFormatVersion(parent))
  if (typeof host.followup === 'function') {
    return host.followup.call(runtime, parent, childId, content, { source, signal })
  }
  const deliver = host[hostPromptDeliver]
  if (typeof deliver === 'function') return deliver.call(runtime, parent, childId, content, source, signal, 'queue')
  const queue = host[hostPromptQueue]
  if (typeof queue !== 'function') return unsupported('missing host FIFO delivery')
  return queue.call(runtime, parent, childId, content, source, signal)
}

/** Coordination joins the nearest step, including waking an idle/cold child. */
export async function steerMemberPrompt(
  runtime: Context['subagents'], parent: Agent, childId: SessionId,
  content: ContentBlock[], signal: AbortSignal, live?: Agent,
): Promise<MessageId> {
  const host = boundary(runtime)
  const source = agentTeamsSource({ kind: 'agent-teams' }, observedSessionFormatVersion(live ?? parent))
  const deliver = host[hostPromptDeliver]
  if (typeof deliver === 'function') return deliver.call(runtime, parent, childId, content, source, signal, 'steer')
  if (typeof host.sendMessage === 'function') return host.sendMessage.call(runtime, parent, childId, content, { signal })
  if (typeof host.followup === 'function') {
    if (live === undefined) return queueMemberPrompt(runtime, parent, childId, content, signal)
    if (live.id !== childId || live.session.header.parentSession !== parent.id) throw new Error('invalid member steering authority')
    signal.throwIfAborted()
    const message = createUserMessage({ content, source })
    live.steer(message)
    return message.id
  }
  return unsupported('missing step-boundary message delivery')
}

/** Guard all resumable delivery paths, preserving the native service receiver. */
export function guardSubagentDelivery(
  ctx: Context, isRetired: (sender: Agent, targetId: SessionId) => Promise<boolean>,
): void {
  const runtime = ctx.subagents
  const host = boundary(runtime)
  const legacy = host.followup
  const queue = host[hostPromptQueue]
  const deliver = host[hostPromptDeliver]
  const send = host.sendMessage
  if (typeof legacy !== 'function' && ((typeof queue !== 'function' && typeof deliver !== 'function') || typeof send !== 'function')) {
    return unsupported('cannot install complete retired-member guard')
  }
  ctx.effect(() => {
    const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>([
      ['followup', Object.getOwnPropertyDescriptor(host, 'followup')],
      [hostPromptQueue, Object.getOwnPropertyDescriptor(host, hostPromptQueue)],
      [hostPromptDeliver, Object.getOwnPropertyDescriptor(host, hostPromptDeliver)],
      ['sendMessage', Object.getOwnPropertyDescriptor(host, 'sendMessage')],
    ])
    let active = true
    const check = async (sender: Agent, targetId: SessionId): Promise<void> => {
      if (active && await isRetired(sender, targetId)) {
        throw new SubagentError(`AgentTeams member "${targetId}" was retired and cannot be resumed`, 'NOT_RESUMABLE')
      }
    }
    const guardedLegacy: Followup = async (parent, childId, content, options) => {
      await check(parent, childId)
      return legacy!.call(runtime, parent, childId, content, options)
    }
    const guardedQueue: Queue = async (parent, childId, content, source, signal) => {
      await check(parent, childId)
      return queue!.call(runtime, parent, childId, content, source, signal)
    }
    const guardedSend: Send = async (sender, targetId, content, options) => {
      await check(sender, targetId)
      return send!.call(runtime, sender, targetId, content, options)
    }
    const guardedDeliver: Deliver = async (parent, childId, content, source, signal, delivery) => {
      await check(parent, childId)
      return deliver!.call(runtime, parent, childId, content, source, signal, delivery)
    }
    if (typeof legacy === 'function') host.followup = guardedLegacy
    if (typeof queue === 'function') host[hostPromptQueue] = guardedQueue
    if (typeof deliver === 'function') host[hostPromptDeliver] = guardedDeliver
    if (typeof send === 'function') host.sendMessage = guardedSend
    // Cordis wraps method reads in fresh Proxies. Compare the actual own
    // descriptor to restore only our contribution, including prototype methods.
    const restore = (key: PropertyKey, installed: unknown): void => {
      if (Object.getOwnPropertyDescriptor(host, key)?.value !== installed) return
      const original = descriptors.get(key)
      if (original === undefined) Reflect.deleteProperty(host, key)
      else Object.defineProperty(host, key, original)
    }
    return () => {
      active = false
      if (typeof legacy === 'function') restore('followup', guardedLegacy)
      if (typeof queue === 'function') restore(hostPromptQueue, guardedQueue)
      if (typeof deliver === 'function') restore(hostPromptDeliver, guardedDeliver)
      if (typeof send === 'function') restore('sendMessage', guardedSend)
    }
  }, 'agent-teams: retired member guard')
}

/** Structural shape of the host tool registry view (dsh-tools `view()`). */
interface ToolsRegistryView {
  restrictableNames?: ReadonlySet<string>
}

/**
 * Names the host's `tools.restrict()` would admit for this agent's layer
 * chain, or undefined when the host does not expose its registry view.
 * restrict() rejects unknown names with a hard error, so the spawn path must
 * check entries against this view before forwarding them. Source:
 * dsh-tools view()/restrict() in 0.1.5-rc.1; older Harness generations lack
 * the surface and keep the verbatim list.
 */
export function restrictableToolNames(agent: Agent): ReadonlySet<string> | undefined {
  const tools = (agent?.ctx as unknown as { tools?: { view?: (scope?: unknown) => ToolsRegistryView } })?.tools
  if (typeof tools?.view !== 'function') return undefined
  try {
    const names = tools.view.call(tools, agent.ctx)?.restrictableNames
    return names instanceof Set ? names : undefined
  } catch {
    return undefined
  }
}

/**
 * Member `toolFilter` for one spawn. Captain-only names are registered by
 * this plugin itself and always resolvable; the depth-related entries name
 * HOST tools and are only known under some compositions, so they must be
 * resolved against the running host's registry: the delegation tool name is
 * host configuration (dsh-tool-subagent `toolName`, default `subagent`,
 * renamed per composition, e.g. `subagent_fork` in web-style profiles), and
 * forwarding a name the host dropped aborts every member spawn (#163, #164).
 * Depth enforcement itself does not depend on these names —
 * installMemberDelegationGuard bounds descendant creation by parent chain.
 *
 * This is the legacy filter of a member without a configured tool policy; a
 * selected policy resolves through `resolveMemberToolFilter` instead (#59).
 */
export function memberToolFilter(maxDepth: number | undefined, knownTools: ReadonlySet<string> | undefined): MemberToolFilter {
  return resolveMemberToolFilter(undefined, { maxDepth, knownTools })
}

/**
 * Names a `tools.restrict()` rejection reported as unknown, or an empty list
 * for every other failure. The host names the offenders verbatim
 * (`tools.restrict() names unknown global tool "x"; known global tools: …`);
 * only that report may relax a filter (#164, #166).
 */
function unknownToolNames(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error)
  if (!message.includes('unknown global tool')) return []
  return [...message.matchAll(/"([^"]+)"/g)].map(match => match[1] as string)
}

/**
 * Start one member, dropping only the built-in filter names the host reports
 * as unknown and retrying.
 *
 * Resolving the filter against the registry view ({@link memberToolFilter})
 * only covers hosts that expose one. A rejected filter still leaves the member
 * without a session for the lifetime of the team, so the start must survive the
 * cases that resolution cannot see — no registry view, a name that is known but
 * not restrictable, a composition that mounted differently than expected. The
 * host names the offenders in its rejection, so the relaxable ones are removed
 * and the start retried.
 *
 * Only `relaxableDeny` names may be dropped, and only from `deny`. The default
 * is exactly the built-in captain-only and depth entries (#163/#164); a name an
 * owner-declared tool policy contributed is never removed, because silently
 * spawning a member with a different filter than the owner declared is contract
 * drift, not recovery. Dropping a denied name the host does not register
 * changes nothing; dropping an allowed name would loosen the policy, so `allow`
 * is never relaxed and the four required coordination tools can never be
 * removed.
 * @param start - performs one start attempt for the given `toolFilter`.
 * @param filter - the filter to attempt first.
 * @param relaxableDeny - built-in deny names the retry may drop.
 * @returns the started member.
 */
export async function startMemberWithLenientFilter<T>(
  start: (filter: MemberToolFilter) => Promise<T>,
  filter: MemberToolFilter,
  relaxableDeny: readonly string[] = BUILTIN_DENY_TOOLS,
): Promise<T> {
  const current: MemberToolFilter = {
    ...filter.allow === undefined ? {} : { allow: [...filter.allow] },
    deny: [...filter.deny],
  }
  for (;;) {
    try {
      return await start(current)
    } catch (error: unknown) {
      const unknown = unknownToolNames(error)
      if (unknown.length === 0) throw error
      const droppable = unknown.filter(name => relaxableDeny.includes(name) && current.deny.includes(name))
      if (droppable.length === 0) throw error
      current.deny = current.deny.filter(name => !droppable.includes(name))
    }
  }
}
