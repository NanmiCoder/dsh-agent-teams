/** Version-tolerant navigation into durable AgentTeams member transcripts. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'

/** Narrow sessions-service face used by the activity panel and team card. */
export interface AgentTeamsSessionNavigator {
  /** Legacy/ordinary session navigation. */
  open(id: SessionId): void
  /** rc.8 addressed subagent navigation. */
  openSubagent?(address: SubagentAddress): void
  /** Refresh the exact parent's durable direct-child catalog. */
  refreshSubagents?(parentSessionId: SessionId): Promise<void>
  /** Reuse an address already retained by the client runtime when available. */
  subagentAddress?(id: SessionId): SubagentAddress | undefined
}

/**
 * Open one member's persisted transcript.
 *
 * Harness rc.8 intentionally removed cold subagents from the ordinary session
 * list. They must first be rediscovered in their parent's catalog, then opened
 * with the exact parent/child/mode address. Older runtimes have only `open()`;
 * the fallback preserves the plugin's rc.6 peer range.
 */
export async function openAgentTeamMember(
  sessions: AgentTeamsSessionNavigator,
  parentSessionId: SessionId,
  childSessionId: SessionId,
): Promise<'subagent' | 'session'> {
  if (sessions.openSubagent === undefined || sessions.refreshSubagents === undefined) {
    sessions.open(childSessionId)
    return 'session'
  }

  await sessions.refreshSubagents(parentSessionId)
  const retained = sessions.subagentAddress?.(childSessionId)
  sessions.openSubagent(retained?.parentSessionId === parentSessionId
    ? retained
    : { parentSessionId, childSessionId, mode: 'continuable' })
  return 'subagent'
}

/**
 * Focus the host composer textarea after the activity panel yields.
 *
 * The composer card is a host private surface (`[data-composer-card]`). Keep
 * the selector in one place so a missing node cannot throw, and so a future
 * host API can replace this without hunting call sites.
 */
export function focusComposer(root: ParentNode | null | undefined = typeof document === 'undefined' ? undefined : document): boolean {
  if (root === null || root === undefined) return false
  const textarea = root.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')
  if (textarea === null) return false
  textarea.focus()
  return true
}
