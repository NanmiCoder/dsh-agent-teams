/**
 * Archive the host sessions of a team's members when the team ends.
 *
 * A member is a durable continuable subagent, so every generation of every
 * team leaves one host Session per member. `agent_teams_delete` archives the
 * team state under `.agent-teams/archive/<teamId>/` but has no way to reach
 * those Sessions, which then stay in the host's session corpus (and in every
 * `session/list` payload) forever (GitHub #333).
 *
 * The archive is the host's own reversible state: `unarchiveSession` returns
 * the session to the list, and the host's `agent/pre-step` gate refuses model
 * steps for an archived session until then. Transcripts are never deleted
 * here.
 *
 * @module dsh-agent-teams/member-sessions
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * Archive the given member sessions, skipping the ones the host rejects.
 *
 * Deleting a team must succeed even when the host cannot archive a session
 * (a headless profile, a session already gone, a provider failure), so every
 * failure is logged and counted as not archived instead of propagating.
 *
 * @param ctx - the plugin context.
 * @param sessionIds - member session ids from the team roster (may contain
 *   duplicates and empties; members that never spawned have an empty id).
 * @returns how many sessions the host accepted into its archive set.
 */
export declare function archiveMemberSessions(ctx: Context, sessionIds: readonly string[]): Promise<number>;
