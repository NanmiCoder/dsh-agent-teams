/**
 * Member subagent lifecycle: spawn a continuable child per member, deliver
 * messages into its FIFO inbox, and observe its activity.
 *
 * Members are durable continuable subagents of the captain, so a member keeps
 * its conversation across turns and across harness restarts: the captain
 * wakes it with {@link ctx.subagents.followup}, it works through its turn
 * (updating team state through the `agent_teams_*` tools), and becomes idle
 * again. Its final assistant message is not readable programmatically, so the
 * member persists its report into the captain's mailbox and the task records,
 * which the captain reads through `agent_teams_status`.
 * @module dsh-agent-teams/members
 */
import type { Context } from '@deepseek-ai/cordis';
import { type Agent } from '@deepseek-ai/dsh-agent';
import type { TeamMember, TeamState } from './types.ts';
/** Runtime knobs for member spawning, resolved from plugin config. */
export interface MemberRuntimeConfig {
    /** Registered `ctx.subagents` provider name (must support continuable + persona). */
    provider: string;
    /** Child delegation depth cap (0 forbids delegation entirely). */
    maxDepth?: number;
}
/** Durable provider/model/reasoning snapshot for one member. */
export interface MemberLlmSelection {
    /** Registered LLM provider route. */
    provider: string;
    /** Provider-owned model id. */
    model: string;
    /** Adapter-owned reasoning effort, absent when the target has no explicit/default effort. */
    reasoningEffort?: string;
}
/** Optional member-level route requested by the captain. */
export interface MemberLlmSelectionRequest {
    /** Explicit LLM provider route; requires an explicit model. */
    provider?: string;
    /** Explicit model id; otherwise the plugin default or captain model is used. */
    model?: string;
    /** Plugin-level member model default. */
    defaultModel?: string;
}
/** Process-local bridge between spawn admission and synchronous child setup. */
export interface MemberSelectionRuntime {
    /** Make one selection visible while Harness materializes the fresh child. */
    withPending<T>(parentSessionId: string, label: string, selection: MemberLlmSelection, operation: () => Promise<T>): Promise<T>;
}
/**
 * Resolve one member's complete model selection. Ordinary members snapshot the
 * captain's current request route and reasoning effort. An explicit member
 * provider/model or plugin-level model replaces only that route; the current
 * captain effort remains the inherited policy and is validated against the
 * target model before a child is created.
 */
export declare function resolveMemberLlmSelection(ctx: Context, captain: Agent, request: MemberLlmSelectionRequest, signal?: AbortSignal): Promise<MemberLlmSelection>;
/**
 * Install the member selection bridge for every fresh or cold-resumed
 * continuable child. Fresh creation reads the pending in-memory selection;
 * cold resume restores the same selection from the owning team's durable
 * record. Legacy members without a complete saved route retain Harness's
 * descriptor provider/model behavior.
 */
export declare function installMemberSelectionRuntime(ctx: Context, stateDir: string): MemberSelectionRuntime;
/**
 * The member's system prompt (persona), shadowing the deployment persona for
 * that child. Self-contained: it replaces the whole persona section.
 * @param team - the team the member joined.
 * @param member - the member record (name/role are read before spawning).
 * @param stateDir - configured state directory, so the member can locate the
 *   team files with its own file tools.
 */
export declare function memberPersona(team: TeamState, member: TeamMember, stateDir: string): string;
/**
 * The initial user message delivered when the member is created.
 * @param team - the team the member joined.
 */
export declare function memberWelcome(team: TeamState): string;
/**
 * Spawn one member as a durable continuable subagent of the captain and fill
 * `member.id` with its child session id. On failure nothing is persisted.
 * @param ctx - the plugin context (injects `subagents`).
 * @param config - member runtime knobs.
 * @param selections - fresh/cold child model-selection bridge.
 * @param llmSelection - resolved provider/model/reasoning snapshot.
 * @param captain - the exact live captain agent (the calling agent).
 * @param team - the team record (read-only here).
 * @param member - the member draft whose `id` is filled on success.
 * @param stateDir - configured state directory (for the persona).
 * @param signal - caller cancellation, forwarded to the start.
 */
export declare function spawnMember(ctx: Context, config: MemberRuntimeConfig, selections: MemberSelectionRuntime, llmSelection: MemberLlmSelection, captain: Agent, team: TeamState, member: TeamMember, stateDir: string, signal: AbortSignal): Promise<void>;
/**
 * Deliver one message to a member as its next FIFO turn. Best effort: a
 * failure (member gone or not continuable) is logged and reported as `false`
 * so the caller can decide (mailbox delivery still happened).
 *
 * Any team sender can route through this helper: the captain is the direct
 * parent of every member, and the caller passes the captain's live Agent
 * (its own when the captain calls, the registry-resolved one when a member
 * sends) — mirroring the Claude Code mailbox model where the writer writes
 * the target's inbox and the target picks it up on its own.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captain - the exact live captain agent (the member's direct parent).
 * @param childId - the member's durable child session id.
 * @param text - the message content.
 * @param signal - caller cancellation, forwarded to the delivery.
 * @returns whether the member inbox accepted the message.
 */
export declare function deliverToMember(ctx: Context, captain: Agent, childId: string, text: string, signal: AbortSignal): Promise<boolean>;
/**
 * Request cancellation of one live member's current turn. Best effort, fire
 * and return; the target may keep running until it observes the signal.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captain - the exact live captain agent (the member's parent).
 * @param childId - the member's durable child session id.
 */
export declare function interruptMember(ctx: Context, captain: Agent, childId: string): void;
/**
 * Snapshot each direct continuable child's activity under the captain's
 * session, keyed by child session id. A member that is currently running its
 * turn reports `running`; an idle member reports `inactive`.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captainSessionId - the captain's session id.
 * @returns child id → activity, missing entries are unknown children.
 */
export declare function memberActivity(ctx: Context, captainSessionId: string): Promise<Map<string, 'running' | 'inactive'>>;
