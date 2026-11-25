/**
 * Independent data plane for the global AgentTeams console.
 *
 * The console reads the same host route as the conversation surfaces, but it
 * deliberately owns its snapshot, ETags, and polling timer. It never writes the
 * shared activity-monitor snapshot used by the floating panel and right tab.
 * @module dsh-agent-teams/client/team-console-state
 */
/** Live route aggregated across every workspace (no `session` scope). */
export const CONSOLE_LIVE_URL = '/plugins/dsh-agent-teams/state?summary=1';
/** Archived route aggregated across every workspace (no `session` scope). */
export const CONSOLE_ARCHIVE_URL = '/plugins/dsh-agent-teams/state?archived=1';
/** Cadence while any non-archived team exists. */
export const CONSOLE_ACTIVE_POLL_MS = 1000;
/** Cadence for a pure-history or empty console. */
export const CONSOLE_IDLE_POLL_MS = 5000;
/** Browser key for the last workspace filter and team selection. */
export const CONSOLE_SELECTION_STORAGE_KEY = 'agent-teams:console:selection';
/**
 * Console identity key. The workspace and captain session are required: a
 * `teamId` alone is not unique across workspaces or session generations.
 * @param team - durable team row.
 * @returns JSON tuple stable in storage and in DOM data attributes.
 */
export function teamRecordKey(team) {
    return JSON.stringify([team.workspace, team.captainSessionId, team.teamId]);
}
/** Build live-first rows, dropping a duplicate archive row for the same key. */
export function buildConsoleRows(live, archived) {
    const rows = [];
    const seen = new Set();
    const append = (teams, historic) => {
        for (const team of teams) {
            const key = teamRecordKey(team);
            if (seen.has(key))
                continue;
            seen.add(key);
            rows.push({ key, team, historic });
        }
    };
    append(live, false);
    append(archived, true);
    return rows;
}
function workspaceNames(rows) {
    return [...new Set(rows.map((row) => row.team.workspace))].sort((a, b) => a.localeCompare(b));
}
function visibleRows(rows, filter) {
    return filter === null ? rows : rows.filter((row) => row.team.workspace === filter);
}
/** Keep the preferred team when it is visible; otherwise select the first row. */
function effectiveSelection(rows, filter, preferredKey) {
    const visible = visibleRows(rows, filter);
    if (preferredKey !== null && visible.some((row) => row.key === preferredKey))
        return preferredKey;
    return visible[0]?.key ?? null;
}
function browserStorage() {
    try {
        return typeof localStorage === 'undefined' ? undefined : localStorage;
    }
    catch {
        return undefined;
    }
}
function readStoredSelection(storage, key) {
    if (storage === undefined)
        return { workspace: null, teamKey: null };
    try {
        const raw = storage.getItem(key);
        if (raw === null || raw === '')
            return { workspace: null, teamKey: null };
        const parsed = JSON.parse(raw);
        return {
            workspace: typeof parsed?.workspace === 'string' ? parsed.workspace : null,
            teamKey: typeof parsed?.teamKey === 'string' ? parsed.teamKey : null,
        };
    }
    catch {
        return { workspace: null, teamKey: null };
    }
}
function sameSnapshot(left, right) {
    return left.status === right.status
        && left.live === right.live
        && left.archivedTeams === right.archivedTeams
        && left.rows === right.rows
        && left.workspaces === right.workspaces
        && left.workspaceFilter === right.workspaceFilter
        && left.selectedKey === right.selectedKey
        && left.updatedAt === right.updatedAt
        && left.error === right.error;
}
/**
 * Create the console store. Persistence is injectable so tests can verify the
 * reload contract without touching a browser origin.
 * @param options - storage override, storage key, and clock for tests.
 * @returns independent console state.
 */
export function createTeamConsoleState(options = {}) {
    const storage = options.storage === undefined ? browserStorage() : options.storage ?? undefined;
    const storageKey = options.storageKey ?? CONSOLE_SELECTION_STORAGE_KEY;
    const now = options.now ?? (() => Date.now());
    const stored = readStoredSelection(storage, storageKey);
    let preferredKey = stored.teamKey;
    let snapshot = {
        status: 'loading',
        live: [],
        archivedTeams: [],
        rows: [],
        workspaces: [],
        workspaceFilter: stored.workspace,
        selectedKey: null,
        updatedAt: null,
        error: null,
    };
    const listeners = new Set();
    const commit = (patch) => {
        const live = patch.live ?? snapshot.live;
        const archivedTeams = patch.archivedTeams ?? snapshot.archivedTeams;
        const rows = patch.rows ?? (live === snapshot.live && archivedTeams === snapshot.archivedTeams
            ? snapshot.rows
            : buildConsoleRows(live, archivedTeams));
        const workspaceFilter = patch.workspaceFilter === undefined ? snapshot.workspaceFilter : patch.workspaceFilter;
        const selectedKey = patch.selectedKey === undefined
            ? effectiveSelection(rows, workspaceFilter, preferredKey)
            : patch.selectedKey;
        const next = {
            status: patch.status ?? snapshot.status,
            live,
            archivedTeams,
            rows,
            workspaces: patch.workspaces ?? (rows === snapshot.rows ? snapshot.workspaces : workspaceNames(rows)),
            workspaceFilter,
            selectedKey,
            updatedAt: patch.updatedAt === undefined ? snapshot.updatedAt : patch.updatedAt,
            error: patch.error === undefined ? snapshot.error : patch.error,
        };
        if (sameSnapshot(snapshot, next))
            return;
        snapshot = next;
        for (const listener of listeners)
            listener();
    };
    const persist = () => {
        if (storage === undefined)
            return;
        try {
            storage.setItem(storageKey, JSON.stringify({
                workspace: snapshot.workspaceFilter,
                teamKey: preferredKey,
            }));
        }
        catch {
            // Selection persistence is best-effort; a restricted origin must not break the console.
        }
    };
    return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        begin() {
            if (snapshot.updatedAt !== null)
                return;
            commit({ status: 'loading', error: null });
        },
        status(value) {
            if (value === 'ready')
                commit({ status: 'ready', error: null });
            else
                commit({ status: 'error', error: snapshot.error ?? 'unavailable' });
        },
        apply(update) {
            if (update.live === undefined && update.archived === undefined)
                return;
            commit({
                live: update.live ?? snapshot.live,
                archivedTeams: update.archived ?? snapshot.archivedTeams,
                status: 'ready',
                error: null,
                updatedAt: now(),
            });
        },
        setWorkspaceFilter(workspace) {
            if (snapshot.workspaceFilter === workspace)
                return;
            commit({ workspaceFilter: workspace });
            persist();
        },
        selectTeam(key) {
            preferredKey = key;
            commit({});
            persist();
        },
        getRows(field) {
            return field === 'live' ? snapshot.live : snapshot.archivedTeams;
        },
    };
}
function isAbort(error) {
    return error?.name === 'AbortError';
}
function readConsoleTeams(response) {
    if (!response.ok)
        throw new Error('Team console unavailable');
    return response.json().then((body) => {
        const teams = body?.teams;
        if (!Array.isArray(teams) || teams.some((team) => (typeof team?.teamId !== 'string' || typeof team?.captainSessionId !== 'string'))) {
            throw new Error('Invalid team console response');
        }
        return teams.map((team) => ({
            ...team,
            workspace: typeof team.workspace === 'string' ? team.workspace : '',
        }));
    });
}
/**
 * Start the console's independent polling loop.
 *
 * Live rows drive a 1s cadence; a pure archive or empty console falls back to
 * 5s. Both routes use ETags, and a stopped controller discards late responses.
 * @param runtime - injectable browser primitives.
 * @returns controller for the mount's lifetime.
 */
export function startConsolePolling(runtime = {}) {
    const fetchState = runtime.fetchState ?? ((url, init) => fetch(url, init));
    const schedule = runtime.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs));
    const cancel = runtime.cancel ?? ((timer) => { clearInterval(timer); });
    const publish = runtime.publish ?? (() => { });
    const getRows = runtime.getRows;
    const activePollMs = runtime.activePollMs ?? CONSOLE_ACTIVE_POLL_MS;
    const idlePollMs = runtime.idlePollMs ?? CONSOLE_IDLE_POLL_MS;
    let cancelled = false;
    let inFlight = false;
    let generation = 0;
    let controller;
    let timer;
    let publishedLive;
    let publishedArchive;
    const stillPublished = (field, rows) => getRows === undefined || getRows(field) === rows?.teams;
    const fetchRows = async (url, tag, signal) => {
        const response = await fetchState(url, {
            cache: 'no-store',
            signal,
            ...tag === undefined ? {} : { headers: { 'if-none-match': tag } },
        });
        if (response.status === 304)
            return { notModified: true };
        const teams = await readConsoleTeams(response);
        return { notModified: false, teams, tag: response.headers?.get('etag') ?? undefined };
    };
    const reschedule = () => {
        if (cancelled)
            return;
        if (timer !== undefined)
            cancel(timer);
        const hasLive = (publishedLive?.teams.length ?? 0) > 0;
        timer = schedule(() => { void tick(); }, hasLive ? activePollMs : idlePollMs);
    };
    const tick = async () => {
        if (inFlight || cancelled)
            return;
        inFlight = true;
        const current = ++generation;
        const request = new AbortController();
        controller = request;
        const liveTag = stillPublished('live', publishedLive) ? publishedLive?.tag : undefined;
        const archiveTag = stillPublished('archived', publishedArchive) ? publishedArchive?.tag : undefined;
        try {
            const [liveResult, archiveResult] = await Promise.allSettled([
                fetchRows(CONSOLE_LIVE_URL, liveTag, request.signal),
                fetchRows(CONSOLE_ARCHIVE_URL, archiveTag, request.signal),
            ]);
            if (cancelled || current !== generation)
                return;
            let failed = false;
            if (liveResult.status === 'fulfilled') {
                if (!liveResult.value.notModified) {
                    publishedLive = { teams: liveResult.value.teams, tag: liveResult.value.tag };
                    publish({ live: liveResult.value.teams });
                }
            }
            else if (!isAbort(liveResult.reason)) {
                failed = true;
            }
            if (archiveResult.status === 'fulfilled') {
                if (!archiveResult.value.notModified) {
                    publishedArchive = { teams: archiveResult.value.teams, tag: archiveResult.value.tag };
                    publish({ archived: archiveResult.value.teams });
                }
            }
            else if (!isAbort(archiveResult.reason)) {
                failed = true;
            }
            runtime.onStatus?.(failed ? 'error' : 'ready');
        }
        catch (error) {
            if (!cancelled && !isAbort(error))
                runtime.onStatus?.('error');
        }
        finally {
            inFlight = false;
            if (!cancelled)
                reschedule();
        }
    };
    timer = schedule(() => { void tick(); }, activePollMs);
    const firstTick = tick();
    return {
        firstTick,
        requestNow: () => tick(),
        stop() {
            if (cancelled)
                return;
            cancelled = true;
            controller?.abort();
            cancel(timer);
            timer = undefined;
        },
    };
}
