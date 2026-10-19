/**
 * Team activity snapshot assembly for the activity panel.
 *
 * Server-side assembly mirrors the Claude Code desktop teamWatcher: read the
 * durable team files (the truth source) and enrich with live subagent
 * activity, so the panel always reflects the on-disk state even when a model
 * skipped a tool "ritual" (e.g. not calling update_task on completion).
 * @module dsh-agent-teams/snapshot
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MemberStatus, TeamState } from './types.ts';
/** Visual task state for the activity panel. */
export type VisualTaskState = 'blocked' | 'open' | 'running' | 'completed' | 'failed' | 'cancelled';
/** One member row of the activity snapshot. */
export interface TeamActivityMember {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    /** Effective LLM provider: the active route after a hot-swap, else the original. */
    readonly provider: string;
    /** Effective model: the active route after a hot-swap, else the original. */
    readonly model: string;
    readonly reasoningEffort: string;
    readonly executionPrompt: string;
    readonly status: MemberStatus;
    readonly activity: 'working' | 'idle' | 'unknown';
    readonly progress: number;
    readonly done: number;
    readonly total: number;
    readonly currentTask: string;
    readonly unread: number;
    /** Last member-start failure, so the panel can surface a broken member. */
    readonly spawnError?: string;
    /** Whether the fallback route is currently active (distinct from a manual switch). */
    readonly fallbackActive?: boolean;
}
/** One task row of the activity snapshot. */
export interface TeamActivityTask {
    readonly id: string;
    readonly subject: string;
    readonly description: string;
    readonly status: string;
    readonly state: VisualTaskState;
    readonly assignee: string;
    readonly model: string;
    readonly dependencies: readonly string[];
    readonly depth: number;
    readonly kind?: string;
    readonly round?: number;
    readonly verdict?: string;
    /**
     * Set when this task's verdict or auto-generated work order no longer
     * describes the current bytes; the panel must not render a bare pass badge.
     */
    readonly verdictStale?: string;
    /** Durable last-write stamp; drives the finished-member ordering (issue #192). */
    readonly updatedAt: number;
}
/** One captain-inbox preview row. */
export interface TeamActivityMessage {
    readonly from: string;
    readonly content: string;
}
/** The full panel payload for one team. */
export interface TeamActivitySnapshot {
    readonly workspace: string;
    readonly teamId: string;
    readonly name: string;
    readonly description?: string;
    readonly captainSessionId: string;
    /** Session ids that adopted this team and gained captain authority. */
    readonly authorizedLeads?: readonly string[];
    readonly phase: 'staged' | 'running';
    readonly planReviewState?: 'awaiting_review' | 'awaiting_feedback';
    readonly halted?: boolean;
    readonly members: readonly TeamActivityMember[];
    readonly tasks: readonly TeamActivityTask[];
    readonly messageCount: number;
    readonly captainInbox: readonly TeamActivityMessage[];
    /** Present when the snapshot could audit the workspace bytes. */
    readonly loopState?: string;
    readonly deliverable?: boolean;
    readonly delivery?: {
        readonly ok: boolean;
        readonly blockers: readonly string[];
        readonly warnings: readonly string[];
    };
}
/** Snapshot projection switches for live and archived teams. */
export interface TeamSnapshotOptions {
    /** Historic review must retain members that were marked removed at shutdown. */
    readonly includeRemoved?: boolean;
    /** Archived teams have no meaningful live activity after their sessions stop. */
    readonly historic?: boolean;
    /**
     * Absolute workspace path of the owning workspace. When present, the snapshot
     * audits the current bytes behind every recorded verdict, so the panel and
     * the model-facing status tool cannot report different delivery verdicts.
     */
    readonly workspacePath?: string;
}
/** Compact `provider/model` route for the activity panel, or just the model. */
export declare function memberModelRoute(member: {
    provider?: string;
    model?: string;
} | undefined): string;
/**
 * Assemble one team snapshot from its durable files plus live activity.
 * @param ctx - the plugin context (injects `subagents`, used for activity).
 * @param stateRoot - resolved absolute state root of the owning workspace.
 * @param workspace - display name of the owning workspace.
 * @param state - the durable team record.
 * @returns the panel snapshot.
 */
export declare function assembleTeamSnapshot(ctx: Context, stateRoot: string, workspace: string, state: TeamState, options?: TeamSnapshotOptions): Promise<TeamActivitySnapshot>;
/**
 * Collect every team under the given workspace state roots.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs (resolved absolute roots).
 * @returns the snapshots in stable order (workspace, then team id).
 */
export declare function collectTeamsActivity(ctx: Context, roots: readonly {
    workspace: string;
    stateRoot: string;
    workspacePath?: string;
}[]): Promise<TeamActivitySnapshot[]>;
/**
 * Collect every archived team under the given workspace state roots (the
 * `archive/` subdirectory of each state root). Used by the historic panel
 * path to restore full team detail after deletion.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs.
 * @returns the archived snapshots in stable order.
 */
export declare function collectArchivedTeamsActivity(ctx: Context, roots: readonly {
    workspace: string;
    stateRoot: string;
}[]): Promise<TeamActivitySnapshot[]>;
