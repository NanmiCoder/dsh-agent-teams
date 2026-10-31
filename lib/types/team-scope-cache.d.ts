/**
 * Per-file captain-session cache for the activity poll scope filter.
 *
 * The polling route only needs `captainSessionId` to decide whether a team
 * belongs to the requested session, but reading that field means parsing the
 * whole team record — a long-lived state root holds tens of MB of task
 * descriptions, and the poll runs once per second (GitHub #330).
 *
 * A team record is written atomically: every write goes through a temporary
 * file and a rename, so the inode, size and mtime change together. Those three
 * values therefore identify the exact bytes that were parsed, and a record
 * whose stamp still matches can be skipped without being read.
 *
 * `captainSessionId` is written once, when the team is created, and no code
 * path rewrites it. A racing rewrite can only change the stamp, which makes
 * the entry stale rather than wrong.
 *
 * @module dsh-agent-teams/team-scope-cache
 */
/** Durable identity of one parsed `team.json` plus its captain session. */
export interface TeamScopeStamp {
    readonly ino: number;
    readonly size: number;
    readonly mtimeMs: number;
    readonly captainSessionId: string;
}
/** Default ceiling for the number of remembered records. */
export declare const TEAM_SCOPE_CACHE_LIMIT = 4096;
/** Bounded cache of `team.json` path to parsed captain session. */
export declare class TeamScopeCache {
    private readonly limit;
    private readonly entries;
    constructor(limit?: number);
    /** Number of remembered records. */
    get size(): number;
    /**
     * Whether the cached entry still describes `file`.
     * @param file - absolute path of the `team.json` to probe.
     * @param captainSessionId - the session the current request is scoped to.
     * @returns `undefined` when no entry can answer (missing or changed file),
     * otherwise whether the record belongs to that session.
     */
    matches(file: string, captainSessionId: string): Promise<boolean | undefined>;
    /**
     * Remember the session of a record that was just parsed from `file`.
     * @param file - absolute path of the parsed `team.json`.
     * @param captainSessionId - the session recorded in that file.
     */
    remember(file: string, captainSessionId: string): Promise<void>;
    /** Forget every remembered record. */
    clear(): void;
}
/** Process-wide cache shared by every polling request. */
export declare const teamScopeCache: TeamScopeCache;
