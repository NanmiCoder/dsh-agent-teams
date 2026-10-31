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
import { stat } from 'node:fs/promises';
/** Default ceiling for the number of remembered records. */
export const TEAM_SCOPE_CACHE_LIMIT = 4096;
/** Bounded cache of `team.json` path to parsed captain session. */
export class TeamScopeCache {
    limit;
    entries = new Map();
    constructor(limit = TEAM_SCOPE_CACHE_LIMIT) {
        this.limit = limit;
    }
    /** Number of remembered records. */
    get size() {
        return this.entries.size;
    }
    /**
     * Whether the cached entry still describes `file`.
     * @param file - absolute path of the `team.json` to probe.
     * @param captainSessionId - the session the current request is scoped to.
     * @returns `undefined` when no entry can answer (missing or changed file),
     * otherwise whether the record belongs to that session.
     */
    async matches(file, captainSessionId) {
        let info;
        try {
            info = await stat(file);
        }
        catch {
            return undefined;
        }
        const cached = this.entries.get(file);
        if (cached === undefined)
            return undefined;
        if (cached.ino !== info.ino || cached.size !== info.size || cached.mtimeMs !== info.mtimeMs) {
            return undefined;
        }
        return cached.captainSessionId === captainSessionId;
    }
    /**
     * Remember the session of a record that was just parsed from `file`.
     * @param file - absolute path of the parsed `team.json`.
     * @param captainSessionId - the session recorded in that file.
     */
    async remember(file, captainSessionId) {
        let info;
        try {
            info = await stat(file);
        }
        catch {
            return;
        }
        // A long-lived host outlives individual teams; drop the whole map rather
        // than track eviction order for an optimization that is rebuilt on demand.
        if (this.entries.size >= this.limit)
            this.entries.clear();
        this.entries.set(file, {
            ino: info.ino,
            size: info.size,
            mtimeMs: info.mtimeMs,
            captainSessionId,
        });
    }
    /** Forget every remembered record. */
    clear() {
        this.entries.clear();
    }
}
/** Process-wide cache shared by every polling request. */
export const teamScopeCache = new TeamScopeCache();
