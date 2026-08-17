/** Browser plugin for the AgentTeams activity floater and conversation card. */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { createRoot, type Root } from 'react-dom/client'
import type { BetterSidebarService } from 'dsh-better-sidebar'
// Module-loading import: the card registers into the conversation chat-node
// slot, whose keyed renderer map lives in the ui-conversation contract.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ActivityPanel } from './ActivityPanel.tsx'
import { AgentTeamsCard, type AgentTeamsCardInjected, OPEN_PANEL_EVENT } from './AgentTeamsCard.tsx'
import { agentTeamsCardDefinition } from './agent-teams-card-definition.ts'

/** Required services: conversation nodes, slots, and sessions navigation. */
export const inject = ['conversationEvents', 'slots', 'sessions']

const TAB_ID = 'agent-teams'
const HEAL_INTERVAL_MS = 1000

/**
 * Mount the activity panel. When DSH Better Sidebar is present, the panel is
 * registered as its own "Agent Teams" tab and the body-portal floater is
 * skipped; otherwise the original floater keeps working as the fallback.
 *
 * The tab registration self-heals: Better Sidebar may be mounted after this
 * plugin, or a persisted tab can be restored before the registration lands.
 * A lightweight check re-registers the descriptor whenever the tab type is
 * missing, so the "plugin not loaded" placeholder cannot stay on screen.
 */
export function apply(ctx: ClientContext): void {
  let disposeTab: (() => void) | undefined
  let portalRoot: Root | undefined
  let portalHost: HTMLDivElement | undefined
  let mode: 'portal' | 'tab' = 'portal'

  const mountPortal = (): void => {
    if (mode === 'portal') return
    portalHost = document.createElement('div')
    portalHost.dataset.agentTeamsHost = ''
    document.body.appendChild(portalHost)
    portalRoot = createRoot(portalHost)
    portalRoot.render(<ActivityPanel
      sessionsList={ctx.sessions.list}
      openSession={(id: SessionId) => { ctx.sessions.open(id) }}
    />)
    mode = 'portal'
  }

  const unmountPortal = (): void => {
    if (portalRoot !== undefined) {
      portalRoot.unmount()
      portalRoot = undefined
    }
    portalHost?.remove()
    portalHost = undefined
  }

  const registerTab = (service: BetterSidebarService): void => {
    if (service.getTab(TAB_ID) !== undefined) return
    disposeTab?.()
    disposeTab = service.registerTab({
      id: TAB_ID,
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
  }

  const heal = (): void => {
    const service = ctx.get('betterSidebar') as BetterSidebarService | undefined
    if (service === undefined) {
      mountPortal()
      return
    }
    if (mode === 'portal') {
      unmountPortal()
      mode = 'tab'
    }
    try {
      registerTab(service)
    } catch (error) {
      console.warn('[agent-teams] better-sidebar tab registration failed:', error)
    }
  }

  // The in-conversation card still dispatches this event to summon the
  // activity panel; route it to the sidebar tab in embedded mode.
  const openPanel = (): void => {
    const service = ctx.get('betterSidebar') as BetterSidebarService | undefined
    service?.openTab({ type: TAB_ID })
  }
  window.addEventListener(OPEN_PANEL_EVENT, openPanel)

  heal()
  const timer = window.setInterval(heal, HEAL_INTERVAL_MS)

  // Conversation card/slot registration is best-effort: a duplicate/race in
  // one of those steps must not dispose the plugin and orphan the sidebar tab.
  try {
    ctx.conversationEvents.register(agentTeamsCardDefinition)
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'agent-teams',
      inject: (): AgentTeamsCardInjected => ({
        openSession: (id: SessionId) => { ctx.sessions.open(id) },
        currentSessionId: () => ctx.sessions.list.getSnapshot().current,
      }),
    }, AgentTeamsCard))
  } catch (error) {
    console.warn('[agent-teams] conversation card registration failed:', error)
  }

  ctx.effect(() => () => {
    window.clearInterval(timer)
    window.removeEventListener(OPEN_PANEL_EVENT, openPanel)
    disposeTab?.()
    unmountPortal()
  }, 'agent-teams: activity panel lifecycle')
}
