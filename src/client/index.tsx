/** Browser plugin for the AgentTeams activity floater and conversation card. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the official browser locale service into ClientContext.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Conversation folding is target-neutral; keyed Chat rendering is owned by
// ui-chat, whose declaration is loaded above.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// The frame-level overlay is declared by ui-layout. This import is type-only;
// ctx.slots.inject below owns the runtime wait for the declaration.
import type { MainPanelId, UsePanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
// Official model catalog/directory service. The staged roster reads its
// provider/model/effort metadata without mutating the captain's own selection.
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { ActivitySurface, WorkspaceActivity, createWorkspaceBridge, TEAM_TAB_ID, TEAM_TAB_KIND } from './WorkspaceActivity.tsx'
import { TeamChatEntry, TeamTurnCard } from './TeamChatEntry.tsx'
import { createWorkspaceState } from './workspace-state.ts'
import { AgentTeamsCard, type AgentTeamsCardInjected } from './AgentTeamsCard.tsx'
import { agentTeamsCardDefinition } from './agent-teams-card-definition.ts'
import { ConsoleReturnButton, TeamConsole, CONSOLE_PANEL_ID, type ConsoleReturnInjected, type TeamConsoleInjected } from './TeamConsole.tsx'
import { createTeamConsoleState } from './team-console-state.ts'
import { createConsoleReturnTarget } from './session-navigation.ts'
import { IconTeamsConsole } from './icons.tsx'
import {
  AGENT_TEAMS_LOCALE_NAMESPACE, en, zh, type AgentTeamsLocaleKey,
} from './locales.ts'
import { openAgentTeamMember, type AgentTeamsLayoutNavigator, type AgentTeamsWorkspaceNavigator } from './session-navigation.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** AgentTeams conversation card and activity monitor copy. */
    agentTeams: AgentTeamsLocaleKey
  }
}

/** Required services: conversation nodes, slots, sessions navigation, and locale. */
export const inject = ['uiConversation', 'slots', 'sessions', 'locale', 'modelDirectories', 'layout']

/** The host supplies this hook for the lifetime of a 0.1.5 root slot. */
interface PanelNavigationProps {
  usePanelInfo?: UsePanelInfo
}
const useLegacyPanelInfo: UsePanelInfo = select => select({ activePanelId: null })

/** The replayed user message is the canonical transcript entry. */
function HiddenAgentTeamsCommand(): null {
  return null
}

/**
 * Register the activity monitor in the shell's additive overlay and the
 * in-conversation team card. The card's activity button re-opens a folded
 * monitor via a window event — the recovery path for an old session.
 */
export function apply(ctx: ClientContext): void {
  const bridge = createWorkspaceBridge()
  const state = createWorkspaceState()
  const consoleState = createTeamConsoleState()
  const consoleNavigation = createConsoleReturnTarget()
  ctx.effect(
    () => ctx.locale.register(AGENT_TEAMS_LOCALE_NAMESPACE, { zh, en }),
    'agent-teams: dictionaries',
  )
  const openMember = (parentId: SessionId, childId: SessionId): void => {
    void openAgentTeamMember(ctx.sessions, parentId, childId, ctx.layout as AgentTeamsLayoutNavigator, ctx.get('uiWorkspace') as AgentTeamsWorkspaceNavigator | undefined).catch((error: unknown) => {
      console.warn(`agent-teams: failed to open member transcript ${childId}: ${String(error)}`)
    })
  }
  const openConsole = (panelId: string): boolean => {
    try {
      if (typeof ctx.layout.selectPanel !== 'function') return false
      ctx.layout.selectPanel(panelId as MainPanelId)
      return true
    } catch (error: unknown) {
      console.warn(`agent-teams: failed to open console panel ${panelId}: ${String(error)}`)
      return false
    }
  }
  const openConsoleMember = (parentId: SessionId, childId: SessionId, teamKey: string): void => {
    // Remember the exact console page before navigation replaces the main panel.
    consoleNavigation.remember({ panelId: CONSOLE_PANEL_ID, teamKey, memberSessionId: childId })
    openMember(parentId, childId)
  }
  const ConsolePanelIcon = ({ size, active }: PropsRuntime<'sidebar.panellist'>) => (
    <IconTeamsConsole size={size} active={active} />
  )
  const Panel = ({ t, usePanelInfo }: PropsLocale<'agentTeams'> & PanelNavigationProps) => {
    // A host's standard hook set is fixed for this mounted plugin instance.
    const usePanel = usePanelInfo ?? useLegacyPanelInfo
    const conversationVisible = usePanel(panel => panel.activePanelId === null)
    return (
    <ActivitySurface
      bridge={bridge}
      state={state}
      conversationVisible={conversationVisible}
      sessionsList={ctx.sessions.list}
      modelDirectories={ctx.modelDirectories}
      openMember={openMember}
      t={t}
    />
    )
  }
  // Optional service scope keeps legacy hosts working and removes every native
  // contribution when the host provider disappears (including HMR).
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (native) => {
    const t = native.locale.bind(AGENT_TEAMS_LOCALE_NAMESPACE)
    native.effect(() => native.sidebarRightTabs.register({
      id: TEAM_TAB_ID, kind: TEAM_TAB_KIND,
      title: () => t('workspace.title'),
    }))
    native.slots.inject('conversation.session.header.actions', () => native.slots.register({
      name: 'conversation.session.header.actions', id: 'agent-teams-entry', order: 50,
      locale: AGENT_TEAMS_LOCALE_NAMESPACE,
    }, TeamChatEntry))
    native.slots.inject('conversation.chat.turnTail', () => native.slots.register({
      name: 'conversation.chat.turnTail', id: 'agent-teams-summary', order: 50,
      locale: AGENT_TEAMS_LOCALE_NAMESPACE,
      inject: () => ({ openMember }),
    }, TeamTurnCard))
    native.slots.inject('sidebar.right.pane.tab', () => {
      const dispose = native.slots.register({
        name: 'sidebar.right.pane.tab', key: TEAM_TAB_ID,
        locale: AGENT_TEAMS_LOCALE_NAMESPACE,
        inject: () => ({ state, modelDirectories: native.modelDirectories, openMember }),
      }, WorkspaceActivity)
      bridge.set(native.sidebarRight)
      return () => { bridge.set(undefined); dispose() }
    })
  })

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'agent-teams-activity',
    order: 80,
    label: 'AgentTeams activity',
    locale: AGENT_TEAMS_LOCALE_NAMESPACE,
  }, Panel))

  // Global console. Both surfaces are gated by the host's sidebar panel list;
  // older hosts (or a missing main keyed slot) simply keep the existing card,
  // floater, and right-tab behavior without registering anything here.
  ctx.slots.inject('sidebar.panellist', () => {
    const disposeEntry = ctx.slots.register({
      name: 'sidebar.panellist',
      id: CONSOLE_PANEL_ID,
      order: 20,
      label: () => ctx.locale.bind(AGENT_TEAMS_LOCALE_NAMESPACE)('console.navLabel'),
    }, ConsolePanelIcon)
    const disposeMain = ctx.slots.inject('main', () => {
      const disposePanel = ctx.slots.register({
        name: 'main',
        key: CONSOLE_PANEL_ID,
        locale: AGENT_TEAMS_LOCALE_NAMESPACE,
        inject: (): TeamConsoleInjected => ({
          state: consoleState,
          openMember: openConsoleMember,
          navigation: consoleNavigation,
        }),
      }, TeamConsole)
      const disposeReturn = ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'agent-teams-console-return',
        order: 51,
        locale: AGENT_TEAMS_LOCALE_NAMESPACE,
        inject: (): ConsoleReturnInjected => ({ navigation: consoleNavigation, openConsole }),
      }, ConsoleReturnButton))
      return [disposePanel, disposeReturn]
    })
    return [disposeEntry, disposeMain]
  })

  // The host command is only the slash-menu/admission surface. Its input is
  // replayed as the visible user message, so the generic result row would be
  // a duplicate placed before that message by command lifecycle ordering.
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: 'agent-teams',
  }, HiddenAgentTeamsCommand))

  ctx.uiConversation.events.register(agentTeamsCardDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'agent-teams',
    locale: AGENT_TEAMS_LOCALE_NAMESPACE,
    inject: (): AgentTeamsCardInjected => ({
      openMember, workspaceBridge: bridge,
    }),
  }, AgentTeamsCard))
}
