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

import type { Context } from '@deepseek-ai/cordis'

/**
 * The slice of the workspace registry this cleanup needs. Declared locally so
 * the module stays usable in a profile that never mounts the web surface.
 */
interface SessionArchiver {
  archiveSession?(sessionId: string, options?: { readonly stopActivity?: boolean }): Promise<void>
}

/** Service keys the workspace registry may be registered under, newest first. */
const WORKSPACE_KEYS = ['workspaceRegistry', 'workspace'] as const

/**
 * Resolve the host's archive entry point.
 * @param ctx - the plugin context.
 * @returns an archive function, or `undefined` when the host composes none.
 */
function sessionArchiver(ctx: Context): ((sessionId: string) => Promise<void>) | undefined {
  const registry = (ctx.get(WORKSPACE_KEYS[0]) ?? ctx.get(WORKSPACE_KEYS[1])) as SessionArchiver | undefined
  const archive = registry?.archiveSession
  if (typeof archive !== 'function') return undefined
  // `stopActivity` writes the archive first and then asks providers to stop the
  // session's work, so a still-running member cannot reject the archive. The
  // delete path already drained activations; this only covers the leftovers.
  return (sessionId) => archive.call(registry, sessionId, { stopActivity: true })
}

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
export async function archiveMemberSessions(ctx: Context, sessionIds: readonly string[]): Promise<number> {
  const archive = sessionArchiver(ctx)
  if (archive === undefined) return 0
  let archived = 0
  for (const id of new Set(sessionIds)) {
    const sessionId = id.trim()
    if (sessionId === '') continue
    try {
      await archive(sessionId)
      archived += 1
    } catch (error: unknown) {
      ctx.logger.warn(`agent-teams: could not archive member session ${sessionId}: ${String(error)}`)
    }
  }
  return archived
}
