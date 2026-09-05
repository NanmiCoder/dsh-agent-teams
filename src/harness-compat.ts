/**
 * The audited Harness 0.1.2 subagent boundary. Keep version-specific shapes
 * here: API presence alone is not a promise of support for future versions.
 *
 * Alpha.2 owns followup/registerContinuableSetup; Alpha.5 and rc.1 own a
 * host-only FIFO queue and synchronous agent/session-start. Their public
 * sendMessage instead steers a running Agent and must never carry team jobs.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, MessageId, MessageSource } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SubagentError } from '@deepseek-ai/dsh-subagent'

/**
 * Exact protocol exported by dsh-subagent/internal in Alpha.5 and rc.1.
 * That subpath does not exist in Alpha.2, so importing it statically prevents
 * the plugin from loading there. This small adapter uses the same process-
 * stable symbol and call signature as upstream queueHostSubagentPrompt.
 * Source: packages/subagent/subagent/src/internal.ts at dsh-v0.1.2-rc.1.
 */
const hostPromptQueue = Symbol.for('dsh.subagent.queuePrompt')
type Setup = (childCtx: Context) => () => void
type Followup = (parent: Agent, childId: SessionId, content: ContentBlock[], options: {
  source: MessageSource; signal: AbortSignal
}) => Promise<MessageId>
type Queue = (parent: Agent, childId: SessionId, content: ContentBlock[], source: MessageSource, signal: AbortSignal) => Promise<MessageId>
type Send = (sender: Agent, targetId: SessionId, content: ContentBlock[], options: { signal: AbortSignal }) => Promise<MessageId>
interface RuntimeBoundary {
  followup?: Followup
  registerContinuableSetup?: (setup: Setup) => () => void
  sendMessage?: Send
  [hostPromptQueue]?: Queue
}

function boundary(runtime: Context['subagents']): RuntimeBoundary {
  return runtime as unknown as RuntimeBoundary
}

function unsupported(detail: string): never {
  throw new Error(`agent-teams: unsupported Harness subagent contract (${detail}); use an explicitly tested Harness version and a coherent dependency installation`)
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
    runtime.registerContinuableSetup.call(ctx.subagents, setup)
    return
  }
  if (typeof runtime[hostPromptQueue] !== 'function' || typeof runtime.sendMessage !== 'function') {
    return unsupported('missing continuable setup and modern host queue')
  }
  const installed = new WeakSet<Agent>()
  const active = new Set<() => void>()
  ctx.effect(() => {
    const stop = ctx.on('agent/session-start', ({ agent }) => {
      if (installed.has(agent)) return
      // Deliberately synchronous: awaiting here loses the first-request race.
      let teardown: () => void
      try {
        teardown = setup(agent.ctx)
      } catch (error: unknown) {
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
  const source: MessageSource = { kind: 'plugin', plugin: 'dsh-agent-teams' }
  if (typeof host.followup === 'function') {
    return host.followup.call(runtime, parent, childId, content, { source, signal })
  }
  const queue = host[hostPromptQueue]
  if (typeof queue !== 'function') return unsupported('missing host FIFO delivery')
  return queue.call(runtime, parent, childId, content, source, signal)
}

/** Guard all resumable delivery paths, preserving the native service receiver. */
export function guardSubagentDelivery(
  ctx: Context, isRetired: (sender: Agent, targetId: SessionId) => Promise<boolean>,
): void {
  const runtime = ctx.subagents
  const host = boundary(runtime)
  const legacy = host.followup
  const queue = host[hostPromptQueue]
  const send = host.sendMessage
  if (typeof legacy !== 'function' && (typeof queue !== 'function' || typeof send !== 'function')) {
    return unsupported('cannot install complete retired-member guard')
  }
  ctx.effect(() => {
    const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>([
      ['followup', Object.getOwnPropertyDescriptor(host, 'followup')],
      [hostPromptQueue, Object.getOwnPropertyDescriptor(host, hostPromptQueue)],
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
    if (typeof legacy === 'function') host.followup = guardedLegacy
    if (typeof queue === 'function') host[hostPromptQueue] = guardedQueue
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
      if (typeof send === 'function') restore('sendMessage', guardedSend)
    }
  }, 'agent-teams: retired member guard')
}
