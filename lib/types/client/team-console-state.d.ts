/**
 * Independent data plane for the global AgentTeams console.
 *
 * The console reads the same host route as the conversation surfaces, but it
 * deliberately owns its snapshot, ETags, and polling timer. It never writes the
 * shared activity-monitor snapshot used by the floating panel and right tab.
 * @module dsh-agent-teams/client/team-console-state
 */
import type { ActivityTeam } from './activity-monitor.ts';
/** Live route aggregated across every workspace (no `session` scope). */
export declare const CONSOLE_LIVE_URL = "/plugins/dsh-agent-teams/state?summary=1";
/** Archived route aggregated across every workspace (no `session` scope). */
export declare const CONSOLE_ARCHIVE_URL = "/plugins/dsh-agent-teams/state?archived=1";
/** Cadence while any non-archived team exists. */
export declare const CONSOLE_ACTIVE_POLL_MS = 1000;
/** Cadence for a pure-history or empty console. */
export declare const CONSOLE_IDLE_POLL_MS = 5000;
/** Browser key for the last workspace filter and team selection. */
export declare const CONSOLE_SELECTION_STORAGE_KEY = "agent-teams:console:selection";
export type ConsoleConnectionStatus = 'loading' | 'ready' | 'error';
/** One team row addressed by workspace + captain session + team id. */
export interface ConsoleTeamRow {
    /** Stable key; the same team id in two workspaces must not collide. */
    readonly key: string;
    readonly team: ActivityTeam;
    /** True for archive rows; these render with `TeamSection historic`. */
    readonly historic: boolean;
}
/** Snapshot exposed to the console UI through React's external-store shape. */
export interface TeamConsoleSnapshot {
    readonly status: ConsoleConnectionStatus;
    readonly live: readonly ActivityTeam[];
    readonly archivedTeams: readonly ActivityTeam[];
    readonly rows: readonly ConsoleTeamRow[];
    readonly workspaces: readonly string[];
    /** Null means all workspaces. */
    readonly workspaceFilter: string | null;
    /** Effective selection inside the current filter, or null. */
    readonly selectedKey: string | null;
    /** Null until the first successful response. */
    readonly updatedAt: number | null;
    /** Last failure marker; the last successful rows remain visible. */
    readonly error: string | null;
}
/** Partial response applied by the console poller. */
export interface ConsoleSnapshotUpdate {
    readonly live?: readonly ActivityTeam[];
    readonly archived?: readonly ActivityTeam[];
}
export interface ConsoleStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem?(key: string): void;
}
/**
 * Console identity key. The workspace and captain session are required: a
 * `teamId` alone is not unique across workspaces or session generations.
 * @param team - durable team row.
 * @returns JSON tuple stable in storage and in DOM data attributes.
 */
export declare function teamRecordKey(team: Pick<ActivityTeam, 'workspace' | 'captainSessionId' | 'teamId'>): string;
/** Build live-first rows, dropping a duplicate archive row for the same key. */
export declare function buildConsoleRows(live: readonly ActivityTeam[], archived: readonly ActivityTeam[]): readonly ConsoleTeamRow[];
/** Console-owned selection and connection state. */
export interface TeamConsoleState {
    getSnapshot(): TeamConsoleSnapshot;
    subscribe(listener: () => void): () => void;
    /** Mark the first load without hiding an existing snapshot. */
    begin(): void;
    /** Record poller health; failures never clear the last rows. */
    status(value: Exclude<ConsoleConnectionStatus, 'loading'>): void;
    /** Apply live/archive rows and mark the snapshot ready. */
    apply(update: ConsoleSnapshotUpdate): void;
    setWorkspaceFilter(workspace: string | null): void;
    selectTeam(key: string | null): void;
    /** Rows owned by one route, for ETag validation. */
    getRows(field: 'live' | 'archived'): readonly ActivityTeam[] | undefined;
}
/**
 * Create the console store. Persistence is injectable so tests can verify the
 * reload contract without touching a browser origin.
 * @param options - storage override, storage key, and clock for tests.
 * @returns independent console state.
 */
export declare function createTeamConsoleState(options?: {
    readonly storage?: ConsoleStorage | null;
    readonly storageKey?: string;
    readonly now?: () => number;
}): TeamConsoleState;
export type TeamConsoleStore = ReturnType<typeof createTeamConsoleState>;
/** Injectable browser primitives used by the console poller and its tests. */
export interface ConsolePollingRuntime {
    readonly fetchState?: (url: string, init: {
        readonly cache: 'no-store';
        readonly signal: AbortSignal;
        readonly headers?: Readonly<Record<string, string>>;
    }) => Promise<ConsoleFetchResponse>;
    readonly schedule?: (callback: () => void, intervalMs: number) => unknown;
    readonly cancel?: (timer: unknown) => void;
    readonly onStatus?: (status: Exclude<ConsoleConnectionStatus, 'loading'>) => void;
    readonly publish?: (update: ConsoleSnapshotUpdate) => void;
    /** Read back the console rows so a tag is only sent for the displayed body. */
    readonly getRows?: (field: 'live' | 'archived') => readonly ActivityTeam[] | undefined;
    readonly activePollMs?: number;
    readonly idlePollMs?: number;
}
interface ConsoleFetchResponse {
    readonly ok: boolean;
    readonly status?: number;
    readonly headers?: {
        get(name: string): string | null;
    };
    json(): Promise<unknown>;
}
/** Handle returned by one console polling loop. */
export interface ConsolePollingController {
    /** Immediate first pass, exposed for verification and deterministic tests. */
    readonly firstTick: Promise<void>;
    /** Fetch immediately without waiting for the scheduled cadence. */
    requestNow(): Promise<void>;
    /** Stop the timer and abort the in-flight requests. */
    stop(): void;
}
/**
 * Start the console's independent polling loop.
 *
 * Live rows drive a 1s cadence; a pure archive or empty console falls back to
 * 5s. Both routes use ETags, and a stopped controller discards late responses.
 * @param runtime - injectable browser primitives.
 * @returns controller for the mount's lifetime.
 */
export declare function startConsolePolling(runtime?: ConsolePollingRuntime): ConsolePollingController;
export {};
