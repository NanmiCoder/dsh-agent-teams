/** Browser plugin for the AgentTeams activity floater and conversation card. */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { createRoot } from 'react-dom/client'
// Module-loading import: the card registers into the conversation chat-node
// slot, whose keyed renderer map lives in the ui-conversation contract.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ActivityPanel } from './ActivityPanel.tsx'
import { AgentTeamsCard, type AgentTeamsCardInjected } from './AgentTeamsCard.tsx'
import { agentTeamsCardDefinition } from './agent-teams-card-definition.ts'

/** Required services: conversation nodes, slots, and sessions navigation. */
export const inject = ['conversationEvents', 'slots', 'sessions']

/**
 * Mount the floater through a body portal (the web shell has no top-right
 * slot) and register the in-conversation team card, whose "activity panel"
 * button re-activates the floater via a window event — the recovery path
 * for a closed floater or a re-opened session.
 */
export function apply(ctx: ClientContext): void {
  const host = document.createElement('div')
  host.dataset.agentTeamsHost = ''
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(<ActivityPanel
    sessionsList={ctx.sessions.list}
    openSession={(id: SessionId) => { ctx.sessions.open(id) }}
  />)
  ctx.effect(() => () => {
    root.unmount()
    host.remove()
  }, 'agent-teams: activity panel')

  ctx.conversationEvents.register(agentTeamsCardDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'agent-teams',
    inject: (): AgentTeamsCardInjected => ({
      openSession: (id: SessionId) => { ctx.sessions.open(id) },
      currentSessionId: () => ctx.sessions.list.getSnapshot().current,
    }),
  }, AgentTeamsCard))
}
