/**
 * Navigation into durable AgentTeams member transcripts.
 *
 * Harness 0.1.7 owns Session navigation in the Workspace UI domain:
 * `ISessions` lost `open`/`openSubagent`/`subagentAddress` ("navigation belongs
 * to view owners") and `UiWorkspace.openSession(target)` accepts the
 * `SessionId | SubagentAddress` union directly. That removes the runtime
 * feature-detection this module used to carry: the address is always the
 * durable direct-parent address, so a member transcript is always reachable.
 * @module dsh-agent-teams/client/session-navigation
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'

/** Layout owner actions used to reveal the Conversation panel for the target. */
export interface AgentTeamsLayoutNavigator {
  selectPanel?(panelId: null): void
  beginNavigation?(): AbortSignal
}

/** Narrow Workspace face used by the activity panel and team card. */
export type AgentTeamsSessionNavigator = Pick<UiWorkspace, 'openSession'>

/**
 * Open one member's persisted transcript.
 *
 * The member is a continuable direct child of the captain, so the exact
 * parent/child address is always known and never needs discovery through a
 * catalog. Navigation supersedes any earlier request, so a stale layout token
 * cancels the selection instead of yanking the UI to an abandoned target.
 */
export function openAgentTeamMember(
  sessions: AgentTeamsSessionNavigator,
  parentSessionId: SessionId,
  childSessionId: SessionId,
  layout?: AgentTeamsLayoutNavigator,
): 'subagent' | 'cancelled' {
  const navigation = layout?.beginNavigation?.()
  if (navigation?.aborted === true) return 'cancelled'
  const address: SubagentAddress = { parentSessionId, childSessionId, mode: 'continuable' }
  sessions.openSession(address)
  layout?.selectPanel?.(null)
  return 'subagent'
}
