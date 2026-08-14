/**
 * AgentTeams activity panel: the top-right floater monitoring every team.
 *
 * Modeled on the Claude Code desktop SessionActivityPanel: a fixed glass
 * panel at the top-right corner. On wide viewports it cooperatively makes the
 * conversation column yield space; narrow viewports keep overlay mode. It
 * polls the host `/plugins/dsh-agent-teams/state` route for
 * server-side snapshots (durable files + live subagent activity), with a
 * collapsed badge that auto-expands once when activity appears. Archived
 * teams stay available for the owning conversation after live work ends.
 *
 * The floater mounts through a body portal (no top-right slot exists in the
 * web shell); it is not a conversation node — the in-conversation panel was
 * removed in favor of this always-available monitor.
 * @module dsh-agent-teams/client/activity
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ObservableSnapshot, SessionListState } from '@deepseek-ai/dsh-client-runtime/client';
/** One member row of a host snapshot. */
export interface ActivityMember {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly activity: 'working' | 'idle' | 'unknown';
    readonly progress: number;
    readonly done: number;
    readonly total: number;
    readonly currentTask: string;
    readonly unread: number;
}
/** One task row of a host snapshot. */
export interface ActivityTask {
    readonly id: string;
    readonly subject: string;
    readonly status: string;
    readonly state: 'blocked' | 'open' | 'running' | 'completed';
    readonly assignee: string;
    readonly dependencies: readonly string[];
    readonly depth: number;
}
/** One captain-inbox preview row. */
export interface ActivityMessage {
    readonly from: string;
    readonly content: string;
}
/** One team snapshot (mirrors the host TeamActivitySnapshot). */
export interface ActivityTeam {
    readonly workspace: string;
    readonly teamId: string;
    readonly name: string;
    readonly description?: string;
    readonly captainSessionId: string;
    readonly members: readonly ActivityMember[];
    readonly tasks: readonly ActivityTask[];
    readonly messageCount: number;
    readonly captainInbox: readonly ActivityMessage[];
}
/** The top-right activity floater. Teams follow the current session: live
 * snapshots and historic card summaries are only shown while their captain
 * session is the one currently open. */
export declare function ActivityPanel({ sessionsList, openSession }: {
    readonly sessionsList: ObservableSnapshot<SessionListState>;
    readonly openSession: (id: SessionId) => void;
}): import("react").JSX.Element | null;
