/** Global, read-only AgentTeams console registered as a main panel. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ConsoleReturnTargetStore } from './session-navigation.ts';
import type { TeamConsoleStore } from './team-console-state.ts';
/** Sidebar list id and main-panel key; they must stay identical. */
export declare const CONSOLE_PANEL_ID = "agent-teams-console";
export interface TeamConsoleInjected {
    readonly state: TeamConsoleStore;
    readonly openMember: (parentId: SessionId, childId: SessionId, teamKey: string) => void;
    readonly navigation: ConsoleReturnTargetStore;
}
export type TeamConsoleProps = PropsRuntime<'main'> & PropsLocale<'agentTeams'> & TeamConsoleInjected;
/**
 * The console view. Polling is owned by this mounted panel only: it starts
 * while the main key is selected and the document is visible, and every
 * controller is stopped on cleanup, panel switch, or unmount.
 */
export declare function TeamConsole({ state, openMember, navigation, usePanelInfo, t }: TeamConsoleProps): import("react").JSX.Element;
export interface ConsoleReturnInjected {
    readonly navigation: ConsoleReturnTargetStore;
    /** Returns true when the main panel accepted the selection. */
    readonly openConsole: (panelId: string) => boolean;
}
/** Header action shown only on the member transcript opened from the console. */
export declare function ConsoleReturnButton({ sessionId, navigation, openConsole, t }: PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'agentTeams'> & ConsoleReturnInjected): import("react").JSX.Element | null;
