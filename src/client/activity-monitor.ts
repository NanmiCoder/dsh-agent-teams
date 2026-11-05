/** Shared, demand-driven state for the AgentTeams browser monitor. */

/** One member row of a host snapshot. */
export interface ActivityMember {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly executionPrompt?: string
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
  readonly description?: string
  readonly status: string
  readonly state: 'blocked' | 'open' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled'
  readonly assignee: string
  readonly model?: string
  readonly dependencies: readonly string[]
  readonly depth: number
  readonly kind?: string
  readonly round?: number
  readonly verdict?: string
  /**
   * Server-side audit of this task's verdict against the current bytes. Set
   * when the recorded pass (or its generated work order) no longer describes
   * the workspace, so the panel cannot render a bare green verdict.
   */
  readonly verdictStale?: string
  /** Durable last-write stamp; drives the finished-member ordering (issue #192). */
  readonly updatedAt?: number
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
  readonly phase: 'staged' | 'running'
  readonly planReviewState?: 'awaiting_review' | 'awaiting_feedback'
  readonly halted?: boolean
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
// Keep recent successful visits during reconnects without retaining every
// conversation's activity and full archive for the life of the tab.
const MAX_RETAINED_SCOPES = 8
const scopedSnapshots = {
  teams: new Map<string, readonly ActivityTeam[]>(),
  archivedTeams: new Map<string, readonly ActivityTeam[]>(),
}

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

/** Read the rows owned by one route and optional scope for ETag comparison. */
export function getPublishedActivityRows(
  field: keyof ActivitySnapshots,
  scope?: string,
): readonly ActivityTeam[] | undefined {
  return scope === undefined ? activitySnapshots[field] : scopedSnapshots[field].get(scope)
}

function replaceActivityRows(
  field: keyof ActivitySnapshots,
  rows: readonly ActivityTeam[] | undefined,
  scope: string | undefined,
): readonly ActivityTeam[] {
  const current = activitySnapshots[field]
  if (rows === undefined) return current
  const recent = scopedSnapshots[field]
  if (scope === undefined) {
    recent.clear()
    return rows
  }
  const previous = recent.get(scope)
  recent.delete(scope)
  recent.set(scope, rows)
  const oldest = recent.size > MAX_RETAINED_SCOPES ? recent.keys().next().value : undefined
  if (oldest !== undefined) recent.delete(oldest)
  if (previous === rows) return current
  const otherRows = current.filter(team => team.captainSessionId !== scope && team.captainSessionId !== oldest)
  return otherRows.length === current.length && rows.length === 0 ? current : [...otherRows, ...rows]
}

/** Publish full state-route responses or replace the rows for just one captain. */
export function updateActivitySnapshots(update: Partial<ActivitySnapshots>, scope?: string): void {
  const next = {
    teams: replaceActivityRows('teams', update.teams, scope),
    archivedTeams: replaceActivityRows('archivedTeams', update.archivedTeams, scope),
  }
  if (next.teams === activitySnapshots.teams && next.archivedTeams === activitySnapshots.archivedTeams) return
  activitySnapshots = next
  for (const listener of snapshotListeners) listener()
}

/** Poll cadence for the live host snapshot route. */
export const ACTIVITY_POLL_MS = 1000
/**
 * Low-frequency probe cadence while a cardless discovery session still owns
 * no team. The probe keeps the panel able to pick up a team created later in
 * that session (e.g. a run_code-wrapped agent_teams_create) without turning
 * every ordinary session into a one-second filesystem scan.
 */
export const ACTIVITY_PROBE_MS = 5000
/** Host route serving live and archived team snapshots. */
export const ACTIVITY_STATE_URL = '/plugins/dsh-agent-teams/state'
export const ACTIVITY_HALT_URL = '/plugins/dsh-agent-teams/halt'

interface ActivityFetchResponse {
  readonly ok: boolean
  readonly status?: number
  readonly headers?: { get(name: string): string | null }
  json(): Promise<unknown>
}

interface PublishedActivitySnapshot {
  readonly teams: readonly ActivityTeam[]
  readonly tag: string | undefined
}

async function readActivityTeams(response: ActivityFetchResponse, scope: string | undefined): Promise<readonly ActivityTeam[]> {
  if (!response.ok) throw new Error('Activity unavailable')
  const body = (await response.json()) as { teams?: unknown } | null
  if (!Array.isArray(body?.teams) || body.teams.some(team =>
    typeof team?.teamId !== 'string' || typeof team?.captainSessionId !== 'string')) {
    throw new Error('Invalid activity response')
  }
  const teams = body.teams as readonly ActivityTeam[]
  // Older hosts can ignore the query and send every team's row.
  return scope === undefined ? teams : teams.filter(team => team.captainSessionId === scope)
}

/** Injectable browser primitives used by the poll controller and its tests. */
export interface ActivityPollingRuntime {
  /** Connection health for views; never clears the last successful snapshot. */
  readonly onStatus?: (status: 'ready' | 'error') => void
  /**
   * Current captain session to discover after a cold client/host restart.
   * This one-time scope restores teams whose older conversation log has no
   * AgentTeams card capable of registering an explicit monitor target.
   */
  readonly discoverySessionId?: string
  readonly fetchState?: (
    url: string,
    init: {
      readonly cache: 'no-store'
      readonly signal: AbortSignal
      readonly headers?: Readonly<Record<string, string>>
    },
  ) => Promise<ActivityFetchResponse>
  readonly schedule?: (callback: () => void, intervalMs: number) => unknown
  readonly cancel?: (timer: unknown) => void
  readonly publishSnapshots?: (update: Partial<ActivitySnapshots>, scope?: string) => void
  /** Read back the shared store when supplying a custom publisher for it. */
  readonly getPublishedRows?: typeof getPublishedActivityRows
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
 * With neither targets nor a discovery session this is deliberately inert.
 * Explicit card targets poll at the live cadence from the start. A discovery
 * session performs an immediate live+archive restore pass, then — while it
 * still owns no team — probes on a low-frequency cadence, so a team created
 * later in that session (e.g. a run_code-wrapped agent_teams_create) is
 * discovered without a manual reload, without turning every ordinary session
 * into a one-second filesystem scan. The moment a team for the discovery
 * session appears, the controller upgrades to the live one-second cadence for
 * the rest of its lifetime. The caller — the session view, which stops the
 * controller when the session is no longer current — bounds the lifetime, and
 * archive state is refreshed when a target or a previously discovered live
 * team disappears.
 */
export function startActivityPolling(
  monitorTargets: readonly ActivityMonitorTarget[],
  runtime: ActivityPollingRuntime = {},
): ActivityPollingController {
  const discoverySessionId = runtime.discoverySessionId?.trim()
  if (monitorTargets.length === 0 && (discoverySessionId === undefined || discoverySessionId === '')) {
    return { firstTick: Promise.resolve(), stop: () => {} }
  }
  const fetchState = runtime.fetchState ?? ((url, init) => fetch(url, init))
  const schedule = runtime.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs))
  const cancel = runtime.cancel ?? ((timer) => { clearInterval(timer as ReturnType<typeof setInterval>) })
  const publishSnapshots = runtime.publishSnapshots ?? updateActivitySnapshots
  const getPublishedRows = runtime.getPublishedRows
    ?? (runtime.publishSnapshots === undefined ? getPublishedActivityRows : undefined)
  const settleTargets = runtime.settleTargets ?? settleActivityMonitorTargets
  const owners = new Set(monitorTargets.map(target => target.sessionId))
  if (discoverySessionId) owners.add(discoverySessionId)
  const scope = owners.size === 1 ? owners.values().next().value : undefined
  const sessionQuery = scope ? new URLSearchParams({ session: scope }).toString() : ''
  const liveUrl = sessionQuery === '' ? ACTIVITY_STATE_URL : `${ACTIVITY_STATE_URL}?${sessionQuery}&summary=1`
  const archiveUrl = `${ACTIVITY_STATE_URL}?archived=1${sessionQuery === '' ? '' : `&${sessionQuery}`}`
  const conditionalHeaders = (tag: string | undefined) =>
    tag === undefined ? {} : { headers: { 'if-none-match': tag } }
  // A manual retry can publish to the same store. A 304 only validates the
  // body this controller applied, so send its tag while that body is shown.
  const stillPublished = (field: keyof ActivitySnapshots, snapshot: PublishedActivitySnapshot | undefined) =>
    getPublishedRows === undefined || getPublishedRows(field, scope) === snapshot?.teams
  let cancelled = false
  let inFlight = false
  // Explicit card targets are demanded work: start at the live cadence. A
  // discovery session starts probing low-frequency and upgrades on detection.
  let hot = monitorTargets.length > 0
  let discoveredLiveKeys = new Set<string>()
  // Archive work stays pending after a failed request, even when the next live
  // request is a 304 and does not publish or recompute the live snapshot.
  let archiveRefreshPending = Boolean(discoverySessionId)
  let missingTargets: ReadonlySet<string> = new Set()
  let publishedLive: PublishedActivitySnapshot | undefined
  let publishedArchive: PublishedActivitySnapshot | undefined
  let controller: AbortController | undefined
  let timer: unknown
  const intervalMs = (): number => (hot ? ACTIVITY_POLL_MS : ACTIVITY_PROBE_MS)
  const reschedule = (): void => {
    cancel(timer)
    timer = schedule(() => { void tick() }, intervalMs())
  }
  const tick = async (): Promise<void> => {
    if (inFlight || cancelled) return
    inFlight = true
    controller = new AbortController()
    try {
      const liveTag = stillPublished('teams', publishedLive) ? publishedLive?.tag : undefined
      const liveResponse = await fetchState(liveUrl, {
        cache: 'no-store',
        signal: controller.signal,
        ...conditionalHeaders(liveTag),
      })
      if (cancelled) return
      if (liveResponse.status !== 304 || liveTag === undefined) {
        const liveTeams = await readActivityTeams(liveResponse, scope)
        if (cancelled) return
        publishSnapshots({ teams: liveTeams }, scope)
        if (cancelled) return
        publishedLive = { teams: liveTeams, tag: liveResponse.headers?.get('etag') ?? undefined }

        const previousDiscoveredKeys = discoveredLiveKeys
        discoveredLiveKeys = new Set(discoverySessionId
          ? liveTeams.filter(team => team.captainSessionId === discoverySessionId).map(team => team.teamId)
          : [])
        archiveRefreshPending ||= [...previousDiscoveredKeys].some(teamId => !discoveredLiveKeys.has(teamId))
        missingTargets = new Set(monitorTargets.filter(target => !liveTeams.some(team =>
          team.captainSessionId === target.sessionId && team.teamId === target.teamId,
        )).map(target => target.key))
        // A discovery session found its first team: keep the live cadence.
        if (!hot && discoveredLiveKeys.size > 0) {
          hot = true
          reschedule()
        }
      } else if (!stillPublished('teams', publishedLive)) {
        // A concurrent write landed while the conditional request was in flight.
        return
      }
      runtime.onStatus?.('ready')
      const archiveReplaced = publishedArchive !== undefined && !stillPublished('archivedTeams', publishedArchive)
      if (cancelled || (missingTargets.size === 0 && !archiveRefreshPending && !archiveReplaced)) return

      // Archives are immutable per team generation. A successful fallback
      // retires every missing explicit target, including legacy cards whose
      // host archive no longer exists; a discovery session that already
      // upgraded keeps polling, and a still-probing one keeps probing, so a
      // team created later in the same session stays discoverable.
      const archiveTag = archiveReplaced ? undefined : publishedArchive?.tag
      const archivedResponse = await fetchState(archiveUrl, {
        cache: 'no-store',
        signal: controller.signal,
        ...conditionalHeaders(archiveTag),
      })
      if (cancelled) return
      if (archivedResponse.status !== 304 || archiveTag === undefined) {
        const archivedTeams = await readActivityTeams(archivedResponse, scope)
        if (cancelled) return
        publishSnapshots({ archivedTeams }, scope)
        if (cancelled) return
        publishedArchive = { teams: archivedTeams, tag: archivedResponse.headers?.get('etag') ?? undefined }
      } else if (!stillPublished('archivedTeams', publishedArchive)) {
        return
      }
      archiveRefreshPending = false
      const settled = missingTargets
      missingTargets = new Set()
      settleTargets(settled)
    } catch (error: unknown) {
      if ((error as { name?: unknown })?.name === 'AbortError') return
      if (!cancelled) runtime.onStatus?.('error')
      // Host restarting; keep the last snapshot and retry on the next tick.
    } finally {
      inFlight = false
    }
  }
  const firstTick = tick()
  if (timer === undefined) timer = schedule(() => { void tick() }, intervalMs())
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
