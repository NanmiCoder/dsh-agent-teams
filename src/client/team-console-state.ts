/**
 * Independent data plane for the global AgentTeams console.
 *
 * The console reads the same host route as the conversation surfaces, but it
 * deliberately owns its snapshot, ETags, and polling timer. It never writes the
 * shared activity-monitor snapshot used by the floating panel and right tab.
 * @module dsh-agent-teams/client/team-console-state
 */

import type { ActivityTeam } from './activity-monitor.ts'

/** Live route aggregated across every workspace (no `session` scope). */
export const CONSOLE_LIVE_URL = '/plugins/dsh-agent-teams/state?summary=1'
/** Archived route aggregated across every workspace (no `session` scope). */
export const CONSOLE_ARCHIVE_URL = '/plugins/dsh-agent-teams/state?archived=1'
/** Cadence while any non-archived team exists. */
export const CONSOLE_ACTIVE_POLL_MS = 1000
/** Cadence for a pure-history or empty console. */
export const CONSOLE_IDLE_POLL_MS = 5000
/** Browser key for the last workspace filter and team selection. */
export const CONSOLE_SELECTION_STORAGE_KEY = 'agent-teams:console:selection'

export type ConsoleConnectionStatus = 'loading' | 'ready' | 'error'

/** One team row addressed by workspace + captain session + team id. */
export interface ConsoleTeamRow {
  /** Stable key; the same team id in two workspaces must not collide. */
  readonly key: string
  readonly team: ActivityTeam
  /** True for archive rows; these render with `TeamSection historic`. */
  readonly historic: boolean
}

/** Snapshot exposed to the console UI through React's external-store shape. */
export interface TeamConsoleSnapshot {
  readonly status: ConsoleConnectionStatus
  readonly live: readonly ActivityTeam[]
  readonly archivedTeams: readonly ActivityTeam[]
  readonly rows: readonly ConsoleTeamRow[]
  readonly workspaces: readonly string[]
  /** Null means all workspaces. */
  readonly workspaceFilter: string | null
  /** Effective selection inside the current filter, or null. */
  readonly selectedKey: string | null
  /** Null until the first successful response. */
  readonly updatedAt: number | null
  /** Last failure marker; the last successful rows remain visible. */
  readonly error: string | null
}

/** Partial response applied by the console poller. */
export interface ConsoleSnapshotUpdate {
  readonly live?: readonly ActivityTeam[]
  readonly archived?: readonly ActivityTeam[]
}

export interface ConsoleStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

interface StoredConsoleSelection {
  readonly workspace?: unknown
  readonly teamKey?: unknown
}

/**
 * Console identity key. The workspace and captain session are required: a
 * `teamId` alone is not unique across workspaces or session generations.
 * @param team - durable team row.
 * @returns JSON tuple stable in storage and in DOM data attributes.
 */
export function teamRecordKey(team: Pick<ActivityTeam, 'workspace' | 'captainSessionId' | 'teamId'>): string {
  return JSON.stringify([team.workspace, team.captainSessionId, team.teamId])
}

/** Build live-first rows, dropping a duplicate archive row for the same key. */
export function buildConsoleRows(
  live: readonly ActivityTeam[],
  archived: readonly ActivityTeam[],
): readonly ConsoleTeamRow[] {
  const rows: ConsoleTeamRow[] = []
  const seen = new Set<string>()
  const append = (teams: readonly ActivityTeam[], historic: boolean): void => {
    for (const team of teams) {
      const key = teamRecordKey(team)
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ key, team, historic })
    }
  }
  append(live, false)
  append(archived, true)
  return rows
}

function workspaceNames(rows: readonly ConsoleTeamRow[]): readonly string[] {
  return [...new Set(rows.map((row) => row.team.workspace))].sort((a, b) => a.localeCompare(b))
}

function visibleRows(rows: readonly ConsoleTeamRow[], filter: string | null): readonly ConsoleTeamRow[] {
  return filter === null ? rows : rows.filter((row) => row.team.workspace === filter)
}

/** Keep the preferred team when it is visible; otherwise select the first row. */
function effectiveSelection(
  rows: readonly ConsoleTeamRow[],
  filter: string | null,
  preferredKey: string | null,
): string | null {
  const visible = visibleRows(rows, filter)
  if (preferredKey !== null && visible.some((row) => row.key === preferredKey)) return preferredKey
  return visible[0]?.key ?? null
}

function browserStorage(): ConsoleStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function readStoredSelection(storage: ConsoleStorage | undefined, key: string): {
  readonly workspace: string | null
  readonly teamKey: string | null
} {
  if (storage === undefined) return { workspace: null, teamKey: null }
  try {
    const raw = storage.getItem(key)
    if (raw === null || raw === '') return { workspace: null, teamKey: null }
    const parsed = JSON.parse(raw) as StoredConsoleSelection | null
    return {
      workspace: typeof parsed?.workspace === 'string' ? parsed.workspace : null,
      teamKey: typeof parsed?.teamKey === 'string' ? parsed.teamKey : null,
    }
  } catch {
    return { workspace: null, teamKey: null }
  }
}

function sameSnapshot(left: TeamConsoleSnapshot, right: TeamConsoleSnapshot): boolean {
  return left.status === right.status
    && left.live === right.live
    && left.archivedTeams === right.archivedTeams
    && left.rows === right.rows
    && left.workspaces === right.workspaces
    && left.workspaceFilter === right.workspaceFilter
    && left.selectedKey === right.selectedKey
    && left.updatedAt === right.updatedAt
    && left.error === right.error
}

/** Console-owned selection and connection state. */
export interface TeamConsoleState {
  getSnapshot(): TeamConsoleSnapshot
  subscribe(listener: () => void): () => void
  /** Mark the first load without hiding an existing snapshot. */
  begin(): void
  /** Record poller health; failures never clear the last rows. */
  status(value: Exclude<ConsoleConnectionStatus, 'loading'>): void
  /** Apply live/archive rows and mark the snapshot ready. */
  apply(update: ConsoleSnapshotUpdate): void
  setWorkspaceFilter(workspace: string | null): void
  selectTeam(key: string | null): void
  /** Rows owned by one route, for ETag validation. */
  getRows(field: 'live' | 'archived'): readonly ActivityTeam[] | undefined
}

/**
 * Create the console store. Persistence is injectable so tests can verify the
 * reload contract without touching a browser origin.
 * @param options - storage override, storage key, and clock for tests.
 * @returns independent console state.
 */
export function createTeamConsoleState(options: {
  readonly storage?: ConsoleStorage | null
  readonly storageKey?: string
  readonly now?: () => number
} = {}): TeamConsoleState {
  const storage = options.storage === undefined ? browserStorage() : options.storage ?? undefined
  const storageKey = options.storageKey ?? CONSOLE_SELECTION_STORAGE_KEY
  const now = options.now ?? (() => Date.now())
  const stored = readStoredSelection(storage, storageKey)
  let preferredKey = stored.teamKey
  let snapshot: TeamConsoleSnapshot = {
    status: 'loading',
    live: [],
    archivedTeams: [],
    rows: [],
    workspaces: [],
    workspaceFilter: stored.workspace,
    selectedKey: null,
    updatedAt: null,
    error: null,
  }
  const listeners = new Set<() => void>()

  const commit = (patch: Partial<TeamConsoleSnapshot>): void => {
    const live = patch.live ?? snapshot.live
    const archivedTeams = patch.archivedTeams ?? snapshot.archivedTeams
    const rows = patch.rows ?? (
      live === snapshot.live && archivedTeams === snapshot.archivedTeams
        ? snapshot.rows
        : buildConsoleRows(live, archivedTeams)
    )
    const workspaceFilter = patch.workspaceFilter === undefined ? snapshot.workspaceFilter : patch.workspaceFilter
    const selectedKey = patch.selectedKey === undefined
      ? effectiveSelection(rows, workspaceFilter, preferredKey)
      : patch.selectedKey
    const next: TeamConsoleSnapshot = {
      status: patch.status ?? snapshot.status,
      live,
      archivedTeams,
      rows,
      workspaces: patch.workspaces ?? (rows === snapshot.rows ? snapshot.workspaces : workspaceNames(rows)),
      workspaceFilter,
      selectedKey,
      updatedAt: patch.updatedAt === undefined ? snapshot.updatedAt : patch.updatedAt,
      error: patch.error === undefined ? snapshot.error : patch.error,
    }
    if (sameSnapshot(snapshot, next)) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  const persist = (): void => {
    if (storage === undefined) return
    try {
      storage.setItem(storageKey, JSON.stringify({
        workspace: snapshot.workspaceFilter,
        teamKey: preferredKey,
      }))
    } catch {
      // Selection persistence is best-effort; a restricted origin must not break the console.
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    begin() {
      if (snapshot.updatedAt !== null) return
      commit({ status: 'loading', error: null })
    },
    status(value) {
      if (value === 'ready') commit({ status: 'ready', error: null })
      else commit({ status: 'error', error: snapshot.error ?? 'unavailable' })
    },
    apply(update) {
      if (update.live === undefined && update.archived === undefined) return
      commit({
        live: update.live ?? snapshot.live,
        archivedTeams: update.archived ?? snapshot.archivedTeams,
        status: 'ready',
        error: null,
        updatedAt: now(),
      })
    },
    setWorkspaceFilter(workspace) {
      if (snapshot.workspaceFilter === workspace) return
      commit({ workspaceFilter: workspace })
      persist()
    },
    selectTeam(key) {
      preferredKey = key
      commit({})
      persist()
    },
    getRows(field) {
      return field === 'live' ? snapshot.live : snapshot.archivedTeams
    },
  }
}

export type TeamConsoleStore = ReturnType<typeof createTeamConsoleState>

/** Injectable browser primitives used by the console poller and its tests. */
export interface ConsolePollingRuntime {
  readonly fetchState?: (
    url: string,
    init: {
      readonly cache: 'no-store'
      readonly signal: AbortSignal
      readonly headers?: Readonly<Record<string, string>>
    },
  ) => Promise<ConsoleFetchResponse>
  readonly schedule?: (callback: () => void, intervalMs: number) => unknown
  readonly cancel?: (timer: unknown) => void
  readonly onStatus?: (status: Exclude<ConsoleConnectionStatus, 'loading'>) => void
  readonly publish?: (update: ConsoleSnapshotUpdate) => void
  /** Read back the console rows so a tag is only sent for the displayed body. */
  readonly getRows?: (field: 'live' | 'archived') => readonly ActivityTeam[] | undefined
  readonly activePollMs?: number
  readonly idlePollMs?: number
}

interface ConsoleFetchResponse {
  readonly ok: boolean
  readonly status?: number
  readonly headers?: { get(name: string): string | null }
  json(): Promise<unknown>
}

interface PublishedConsoleRows {
  readonly teams: readonly ActivityTeam[]
  readonly tag: string | undefined
}

type FetchOutcome =
  | { readonly notModified: true }
  | { readonly notModified: false; readonly teams: readonly ActivityTeam[]; readonly tag: string | undefined }

function isAbort(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'AbortError'
}

function readConsoleTeams(response: ConsoleFetchResponse): Promise<readonly ActivityTeam[]> {
  if (!response.ok) throw new Error('Team console unavailable')
  return response.json().then((body: unknown) => {
    const teams = (body as { teams?: unknown } | null)?.teams
    if (!Array.isArray(teams) || teams.some((team) => (
      typeof team?.teamId !== 'string' || typeof team?.captainSessionId !== 'string'
    ))) {
      throw new Error('Invalid team console response')
    }
    return (teams as readonly ActivityTeam[]).map((team) => ({
      ...team,
      workspace: typeof team.workspace === 'string' ? team.workspace : '',
    }))
  })
}

/** Handle returned by one console polling loop. */
export interface ConsolePollingController {
  /** Immediate first pass, exposed for verification and deterministic tests. */
  readonly firstTick: Promise<void>
  /** Fetch immediately without waiting for the scheduled cadence. */
  requestNow(): Promise<void>
  /** Stop the timer and abort the in-flight requests. */
  stop(): void
}

/**
 * Start the console's independent polling loop.
 *
 * Live rows drive a 1s cadence; a pure archive or empty console falls back to
 * 5s. Both routes use ETags, and a stopped controller discards late responses.
 * @param runtime - injectable browser primitives.
 * @returns controller for the mount's lifetime.
 */
export function startConsolePolling(runtime: ConsolePollingRuntime = {}): ConsolePollingController {
  const fetchState = runtime.fetchState ?? ((url, init) => fetch(url, init))
  const schedule = runtime.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs))
  const cancel = runtime.cancel ?? ((timer) => { clearInterval(timer as ReturnType<typeof setInterval>) })
  const publish = runtime.publish ?? (() => {})
  const getRows = runtime.getRows
  const activePollMs = runtime.activePollMs ?? CONSOLE_ACTIVE_POLL_MS
  const idlePollMs = runtime.idlePollMs ?? CONSOLE_IDLE_POLL_MS

  let cancelled = false
  let inFlight = false
  let generation = 0
  let controller: AbortController | undefined
  let timer: unknown
  let publishedLive: PublishedConsoleRows | undefined
  let publishedArchive: PublishedConsoleRows | undefined

  const stillPublished = (field: 'live' | 'archived', rows: PublishedConsoleRows | undefined): boolean =>
    getRows === undefined || getRows(field) === rows?.teams

  const fetchRows = async (
    url: string,
    tag: string | undefined,
    signal: AbortSignal,
  ): Promise<FetchOutcome> => {
    const response = await fetchState(url, {
      cache: 'no-store',
      signal,
      ...tag === undefined ? {} : { headers: { 'if-none-match': tag } },
    })
    if (response.status === 304) return { notModified: true }
    const teams = await readConsoleTeams(response)
    return { notModified: false, teams, tag: response.headers?.get('etag') ?? undefined }
  }

  const reschedule = (): void => {
    if (cancelled) return
    if (timer !== undefined) cancel(timer)
    const hasLive = (publishedLive?.teams.length ?? 0) > 0
    timer = schedule(() => { void tick() }, hasLive ? activePollMs : idlePollMs)
  }

  const tick = async (): Promise<void> => {
    if (inFlight || cancelled) return
    inFlight = true
    const current = ++generation
    const request = new AbortController()
    controller = request
    const liveTag = stillPublished('live', publishedLive) ? publishedLive?.tag : undefined
    const archiveTag = stillPublished('archived', publishedArchive) ? publishedArchive?.tag : undefined
    try {
      const [liveResult, archiveResult] = await Promise.allSettled([
        fetchRows(CONSOLE_LIVE_URL, liveTag, request.signal),
        fetchRows(CONSOLE_ARCHIVE_URL, archiveTag, request.signal),
      ])
      if (cancelled || current !== generation) return
      let failed = false

      if (liveResult.status === 'fulfilled') {
        if (!liveResult.value.notModified) {
          publishedLive = { teams: liveResult.value.teams, tag: liveResult.value.tag }
          publish({ live: liveResult.value.teams })
        }
      } else if (!isAbort(liveResult.reason)) {
        failed = true
      }

      if (archiveResult.status === 'fulfilled') {
        if (!archiveResult.value.notModified) {
          publishedArchive = { teams: archiveResult.value.teams, tag: archiveResult.value.tag }
          publish({ archived: archiveResult.value.teams })
        }
      } else if (!isAbort(archiveResult.reason)) {
        failed = true
      }

      runtime.onStatus?.(failed ? 'error' : 'ready')
    } catch (error: unknown) {
      if (!cancelled && !isAbort(error)) runtime.onStatus?.('error')
    } finally {
      inFlight = false
      if (!cancelled) reschedule()
    }
  }

  timer = schedule(() => { void tick() }, activePollMs)
  const firstTick = tick()
  return {
    firstTick,
    requestNow: () => tick(),
    stop() {
      if (cancelled) return
      cancelled = true
      controller?.abort()
      cancel(timer)
      timer = undefined
    },
  }
}
