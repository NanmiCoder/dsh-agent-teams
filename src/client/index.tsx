/** Browser plugin for the AgentTeams activity floater and conversation card. */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { createRoot } from 'react-dom/client'
import type { BetterSidebarService } from 'dsh-better-sidebar'
// Module-loading import: the card registers into the conversation chat-node
// slot, whose keyed renderer map lives in the ui-conversation contract.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ActivityPanel } from './ActivityPanel.tsx'
import { AgentTeamsCard, type AgentTeamsCardInjected, OPEN_PANEL_EVENT } from './AgentTeamsCard.tsx'
import { agentTeamsCardDefinition } from './agent-teams-card-definition.ts'

/** Required services: conversation nodes, slots, and sessions navigation. */
export const inject = ['conversationEvents', 'slots', 'sessions']

/**
 * Mount the activity panel. When DSH Better Sidebar is present, the panel is
 * registered as its own "Agent Teams" tab and the body-portal floater is
 * skipped; otherwise the original floater keeps working as the fallback.
 */
export function apply(ctx: ClientContext): void {
  const betterSidebar = ctx.get('betterSidebar') as BetterSidebarService | undefined

  if (betterSidebar === undefined) {
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
  } else {
    const disposeTab = betterSidebar.registerTab({
      id: 'agent-teams',
      title: 'Agent Teams',
      order: 70,
      single: true,
      component: () => (
        <ActivityPanel
          sessionsList={ctx.sessions.list}
          openSession={(id: SessionId) => { ctx.sessions.open(id) }}
          embedded
        />
      ),
    })
    ctx.effect(() => disposeTab, 'agent-teams: better-sidebar tab')

    // The in-conversation card still dispatches this event to summon the
    // activity panel; route it to the sidebar tab in embedded mode.
    const openPanel = (): void => { betterSidebar.openTab({ type: 'agent-teams' }) }
    window.addEventListener(OPEN_PANEL_EVENT, openPanel)
    ctx.effect(() => () => {
      window.removeEventListener(OPEN_PANEL_EVENT, openPanel)
    }, 'agent-teams: open sidebar tab')
  }

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
