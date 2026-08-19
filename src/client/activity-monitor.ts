/** Shared, demand-driven state for the AgentTeams browser monitor. */

/** One member row of a host snapshot. */
export interface ActivityMember {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly status?: 'idle' | 'working' | 'removed'
  readonly activity: 'working' | 'idle' | 'unknown'
  readonly progress: number
  readonly done: number
  readonly total: number
  readonly currentTask: string
  readonly unread: number
}

/** One task row of a host snapshot. */
export interface ActivityTask {
  readonly id: string
  readonly subject: string
  readonly status: string
  readonly state: 'blocked' | 'open' | 'running' | 'completed'
  readonly assignee: string
  readonly dependencies: readonly string[]
  readonly depth: number
}

/** One captain-inbox preview row. */
export interface ActivityMessage {
  readonly from: string
  readonly content: string
}

/** One team snapshot (mirrors the host TeamActivitySnapshot). */
export interface ActivityTeam {
  readonly workspace: string
  readonly teamId: string
  readonly name: string
  readonly description?: string
  readonly captainSessionId: string
  readonly members: readonly ActivityMember[]
  readonly tasks: readonly ActivityTask[]
  readonly messageCount: number
  readonly captainInbox: readonly ActivityMessage[]
}

/** A successfully-created conversation card that currently needs updates. */
export interface ActivityMonitorTarget {
  readonly key: string
  readonly sessionId: string
  readonly teamId: string
}

/** Latest shared response data for both the floater and conversation cards. */
export interface ActivitySnapshots {
  readonly teams: readonly ActivityTeam[]
  readonly archivedTeams: readonly ActivityTeam[]
}

interface RegisteredTarget extends ActivityMonitorTarget {
  refs: number
  active: boolean
}

const targets = new Map<string, RegisteredTarget>()
const targetListeners = new Set<() => void>()
const snapshotListeners = new Set<() => void>()
let targetSnapshot: readonly ActivityMonitorTarget[] = []
let activitySnapshots: ActivitySnapshots = { teams: [], archivedTeams: [] }

function targetKey(sessionId: string, teamId: string): string {
  return `${sessionId}\u0000${teamId}`
}

function publishTargets(): void {
  targetSnapshot = [...targets.values()]
    .filter((target) => target.active)
    .map(({ key, sessionId, teamId }) => ({ key, sessionId, teamId }))
  for (const listener of targetListeners) listener()
}

/** Subscribe to the active monitor-target list (React external-store shape). */
export function subscribeActivityMonitorTargets(listener: () => void): () => void {
  targetListeners.add(listener)
  return () => { targetListeners.delete(listener) }
}

/** Read the stable active-target snapshot. */
export function getActivityMonitorTargetsSnapshot(): readonly ActivityMonitorTarget[] {
  return targetSnapshot
}

/**
 * Register one successful AgentTeams card as a monitoring demand.
 *
 * The returned cleanup is reference-counted so multiple cards and React
 * StrictMode remounts cannot stop another card's monitor.
 */
export function monitorAgentTeam(sessionId: string, teamId: string): () => void {
  const owner = sessionId.trim()
  const id = teamId.trim()
  if (owner === '' || id === '') return () => {}
  const key = targetKey(owner, id)
  const existing = targets.get(key)
  if (existing === undefined) {
    targets.set(key, { key, sessionId: owner, teamId: id, refs: 1, active: true })
    publishTargets()
  } else {
    existing.refs += 1
    if (!existing.active) {
      existing.active = true
      publishTargets()
    }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    const current = targets.get(key)
    if (current === undefined) return
    current.refs -= 1
    if (current.refs <= 0) {
      targets.delete(key)
      if (current.active) publishTargets()
    }
  }
}

/** Stop polling targets whose final archived snapshot has been captured. */
export function settleActivityMonitorTargets(keys: ReadonlySet<string>): void {
  let changed = false
  for (const key of keys) {
    const target = targets.get(key)
    if (target?.active !== true) continue
    target.active = false
    changed = true
  }
  if (changed) publishTargets()
}

/** Subscribe to the shared live/archive snapshot. */
export function subscribeActivitySnapshots(listener: () => void): () => void {
  snapshotListeners.add(listener)
  return () => { snapshotListeners.delete(listener) }
}

/** Read the stable shared live/archive snapshot. */
export function getActivitySnapshotsSnapshot(): ActivitySnapshots {
  return activitySnapshots
}

/** Publish one or both successful state-route responses. */
export function updateActivitySnapshots(update: Partial<ActivitySnapshots>): void {
  const next = {
    teams: update.teams ?? activitySnapshots.teams,
    archivedTeams: update.archivedTeams ?? activitySnapshots.archivedTeams,
  }
  if (next.teams === activitySnapshots.teams && next.archivedTeams === activitySnapshots.archivedTeams) return
  activitySnapshots = next
  for (const listener of snapshotListeners) listener()
}

/** Poll cadence for the live host snapshot route. */
export const ACTIVITY_POLL_MS = 1000
/** Host route serving live and archived team snapshots. */
export const ACTIVITY_STATE_URL = '/plugins/dsh-agent-teams/state'

interface ActivityFetchResponse {
  readonly ok: boolean
  json(): Promise<unknown>
}

/** Injectable browser primitives used by the poll controller and its tests. */
export interface ActivityPollingRuntime {
  readonly fetchState?: (
    url: string,
    init: { readonly cache: 'no-store'; readonly signal: AbortSignal },
  ) => Promise<ActivityFetchResponse>
  readonly schedule?: (callback: () => void, intervalMs: number) => unknown
  readonly cancel?: (timer: unknown) => void
  readonly publishSnapshots?: (update: Partial<ActivitySnapshots>) => void
  readonly settleTargets?: (keys: ReadonlySet<string>) => void
}

/** Handle returned by one current-session polling loop. */
export interface ActivityPollingController {
  /** The immediate first pass, exposed so offline verification can await it. */
  readonly firstTick: Promise<void>
  /** Idempotently stop the timer and abort the current request. */
  stop(): void
}

/**
 * Start the single polling loop for the current session's requested targets.
 *
 * With no targets this is deliberately inert: installing the plugin must not
 * touch the state route. Live state is polled at the normal cadence; archive
 * state is fetched only as a one-time fallback for targets no longer live.
 */
export function startActivityPolling(
  monitorTargets: readonly ActivityMonitorTarget[],
  runtime: ActivityPollingRuntime = {},
): ActivityPollingController {
  if (monitorTargets.length === 0) {
    return { firstTick: Promise.resolve(), stop: () => {} }
  }
  const fetchState = runtime.fetchState ?? ((url, init) => fetch(url, init))
  const schedule = runtime.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs))
  const cancel = runtime.cancel ?? ((timer) => { clearInterval(timer as ReturnType<typeof setInterval>) })
  const publishSnapshots = runtime.publishSnapshots ?? updateActivitySnapshots
  const settleTargets = runtime.settleTargets ?? settleActivityMonitorTargets
  let cancelled = false
  let inFlight = false
  let controller: AbortController | undefined
  const tick = async (): Promise<void> => {
    if (inFlight || cancelled) return
    inFlight = true
    controller = new AbortController()
    try {
      const liveResponse = await fetchState(ACTIVITY_STATE_URL, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!liveResponse.ok) return
      const body = (await liveResponse.json()) as { teams?: unknown }
      if (cancelled || !Array.isArray(body.teams)) return
      const liveTeams = body.teams as readonly ActivityTeam[]
      publishSnapshots({ teams: liveTeams })
      const missing = monitorTargets.filter((target) => !liveTeams.some((team) =>
        team.captainSessionId === target.sessionId && team.teamId === target.teamId,
      ))
      if (missing.length === 0) return

      // Archives are immutable. A successful fallback retires every missing
      // target, including legacy cards whose host archive no longer exists.
      const archivedResponse = await fetchState(`${ACTIVITY_STATE_URL}?archived=1`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!archivedResponse.ok) return
      const archivedBody = (await archivedResponse.json()) as { teams?: unknown }
      if (cancelled || !Array.isArray(archivedBody.teams)) return
      publishSnapshots({ archivedTeams: archivedBody.teams as readonly ActivityTeam[] })
      settleTargets(new Set(missing.map((target) => target.key)))
    } catch (error: unknown) {
      if ((error as { name?: unknown })?.name === 'AbortError') return
      // Host restarting; keep the last snapshot and retry on the next tick.
    } finally {
      inFlight = false
    }
  }
  const firstTick = tick()
  const timer = schedule(() => { void tick() }, ACTIVITY_POLL_MS)
  return {
    firstTick,
    stop: () => {
      if (cancelled) return
      cancelled = true
      controller?.abort()
      cancel(timer)
    },
  }
}
