/** Browser plugin for the AgentTeams top-right activity floater. */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { createRoot } from 'react-dom/client'
import { ActivityPanel } from './ActivityPanel.tsx'

/** Required services: sessions (opening a member's subagent transcript). */
export const inject = ['sessions']

/**
 * Mount the floater through a body portal: the web shell has no top-right
 * slot, so the panel owns its geometry (fixed top-right, out-of-flow),
 * following the established external-plugin floater pattern.
 */
export function apply(ctx: ClientContext): void {
  const host = document.createElement('div')
  host.dataset.agentTeamsHost = ''
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(<ActivityPanel openSession={(id: SessionId) => { ctx.sessions.open(id) }} />)
  ctx.effect(() => () => {
    root.unmount()
    host.remove()
  }, 'agent-teams: activity panel')
}
