/**
 * Member subagent lifecycle: spawn a continuable child per member, deliver
 * task turns and step-boundary messages, and observe its activity.
 *
 * Members are durable continuable subagents of the captain, so a member keeps
 * its conversation across turns and across harness restarts: the captain
 * queues its next turn through {@link deliverToMember}, it works through its turn
 * (updating team state through the `agent_teams_*` tools), and becomes idle
 * again. Its final assistant message is not readable programmatically, so the
 * member persists its report into the captain's mailbox and the task records,
 * which the captain reads through `agent_teams_status`.
 * @module dsh-agent-teams/members
 */
import type { Context } from '@deepseek-ai/cordis';
import { type Agent, type ModelSelection } from '@deepseek-ai/dsh-agent';
import type { Session } from '@deepseek-ai/dsh-session';
import { type SessionFormatBearer } from './harness-compat.ts';
import type { MemberToolFilter } from './tool-policies.ts';
import { type TeamMember, type TeamState, type TeamTask } from './types.ts';
/** Persona snapshot of a profile protocol; the full text lives on team.json. */
export declare const PERSONA_PROTOCOL_MAX_CHARS = 400;
/** Runtime knobs for member spawning, resolved from plugin config. */
export interface MemberRuntimeConfig {
    /** Registered `ctx.subagents` provider name (must support continuable + persona). */
    provider: string;
    /** Child delegation depth cap (0 forbids delegation entirely). */
    maxDepth?: number;
    /** Plugin-wide execution prompt. */
    executionPrompt?: string;
    /** Plugin-wide fallback route. */
    fallback?: {
        provider: string;
        model: string;
    };
}
/** Durable provider/model/reasoning snapshot for one member. */
export interface MemberLlmSelection {
    /** Registered LLM provider route. */
    provider: string;
    /** Provider-owned model id. */
    model: string;
    /** Adapter-owned reasoning effort, absent when the target has no explicit/default effort. */
    reasoningEffort?: string;
    /** Configured second-choice route. */
    fallback?: {
        provider: string;
        model: string;
    };
}
/** Optional member-level route requested by the captain. */
export interface MemberLlmSelectionRequest {
    /** Explicit LLM provider route; requires an explicit model. */
    provider?: string;
    /** Explicit model id; otherwise the plugin default or captain model is used. */
    model?: string;
    /** Plugin-level member model default. */
    defaultModel?: string;
    /** Configured member LLM provider, paired with `defaultModel` (issue #189). */
    defaultProvider?: string;
    /** Explicit reasoning effort; "default" selects the target model's default effort. */
    reasoningEffort?: string;
    /** Configured fallback route. */
    fallback?: {
        provider: string;
        model: string;
    };
}
/** A composed member route plus where each half came from. */
export interface MemberRouteResolution {
    readonly provider: {
        readonly value: string;
        readonly source: 'request' | 'config' | 'captain';
    };
    readonly model: {
        readonly value: string;
        readonly source: 'request' | 'config' | 'captain';
    };
    /**
     * Whether the provider half was *derived* rather than named. Only a
     * model-only plugin default may have its owner looked up in the provider
     * catalogs; a provider or model the caller named is never re-pointed.
     */
    readonly derivedProvider: boolean;
}
/**
 * Compose one member route from request, plugin configuration and the captain
 * session, without performing any I/O. This is the single place where the
 * precedence between the captain's route and a configured member default is
 * decided, so a configured model can never be silently paired with whichever
 * provider the captain happens to sit on (issue #189).
 *
 * Precedence: explicit request > plugin configuration > captain session. Model
 * ids are used verbatim: a `/` inside a model id is part of that id and is
 * never treated as a provider separator.
 *
 * `derivedProvider` is true only for a bare configured `memberModel` with no
 * provider anywhere, which is the one shape whose owner must come from the
 * provider catalogs.
 * @param request - the captain-supplied and plugin-configured route halves.
 * @param captain - the captain's current session route.
 * @returns the composed route, or `undefined` when a half cannot be determined.
 */
export declare function composeMemberRoute(request: Pick<MemberLlmSelectionRequest, 'provider' | 'model' | 'defaultModel' | 'defaultProvider'>, captain: {
    readonly provider: string;
    readonly model: string;
}): MemberRouteResolution | undefined;
/** Process-local bridge between spawn admission and synchronous child setup. */
export interface MemberSelectionRuntime {
    /** Trusted fresh-child admission, before the durable member id is written. */
    isPendingMember(agent: Agent): boolean;
    /** Make one selection visible while Harness materializes the fresh child. */
    withPending<T>(parentSessionId: string, label: string, selection: MemberLlmSelection, operation: () => Promise<T>, setup?: TeamMember['runtimeSetup']): Promise<T>;
    /**
     * Look up the live mutable selection ref for one member, so a runtime
     * hot-swap can mutate `ref.current` and have the next LLM request pick up
     * the new route. Returns undefined when the member's child context is not
     * currently resident (cold member, or the member was removed).
     */
    getSelectionRef(teamId: string, memberName: string): {
        current: ModelSelection;
        assembled?: ModelSelection;
    } | undefined;
}
/**
 * Validate a resolved roster against every provider catalog before any child
 * session is created. Catalogs are advisory when empty (some adapters accept
 * dynamic model ids), but a non-empty catalog is authoritative enough to
 * catch a typo that would otherwise boot a child and fail on its first turn.
 */
export declare function validateMemberLlmSelections(ctx: Context, selections: readonly MemberLlmSelection[], signal?: AbortSignal): Promise<void>;
export declare function isFallbackFailureCode(code: string): boolean;
/** Pure state transition used by the request-error handler and TDD tests. */
export declare function selectFallbackRoute(current: {
    provider: string;
    model: string;
}, fallback: {
    provider: string;
    model: string;
} | undefined, failureCode: string, alreadySwitched: boolean): {
    retry: boolean;
    switched: boolean;
    selection: {
        provider: string;
        model: string;
    };
};
/** Deliver a durable member report to the live captain at its next model step. */
export declare function steerCaptainReport(captain: Pick<Agent, 'steer'> & SessionFormatBearer, from: string, content: string, receipt?: string): boolean;
interface FailedMemberAttempt {
    readonly captainSessionId: string;
    readonly memberId: string;
    readonly task?: Pick<TeamTask, 'id' | 'attempt' | 'attemptId'>;
}
/** How a final member turn failure relates to the durable record. */
export type MemberFailureDisposition = 
/** A live observed attempt was failed and its task marked failed. */
'failed_attempt'
/** The work had already settled; only a durable captain note was added. */
 | 'noted_settled'
/** No record: stale generation, superseded attempt, retired member, or no team. */
 | 'ignored';
/**
 * Classify a final member turn failure against the durable record. Pure, so the
 * policy is testable without a lock or a Harness.
 *
 * A failure may only mutate the attempt the plugin actually observed. When that
 * attempt is gone — the member moved on to newer work, the task was
 * reassigned to a newer attempt, or the member generation was replaced — the
 * late error carries no authority and stays silent. When the failure belongs to
 * the current generation but its work already settled, the task and member are
 * left exactly as they are and only a durable captain note is added: otherwise
 * an operator cannot tell a clean run from one whose member's last turn died
 * (429, auth failure, crash) after the delivery landed (issue #205).
 * @param observed - the live member/task capability captured at the error event.
 * @param current - the current durable member record and open task, if any.
 * @returns the disposition for this failure.
 */
export declare function classifyMemberFailure(observed: FailedMemberAttempt, current: {
    readonly member?: Pick<TeamMember, 'id' | 'status'> | undefined;
    readonly task?: Pick<TeamTask, 'id' | 'attempt' | 'attemptId'> | undefined;
    /** The durable record of the task the observation referred to, settled or not. */
    readonly observedRecord?: Pick<TeamTask, 'id' | 'status' | 'subject'> | undefined;
}): MemberFailureDisposition;
/**
 * The surviving durable record of the capability observed at the error event,
 * or `undefined` when there is nothing honest to say about it.
 *
 * A task is only described as *settled* when its durable status is terminal
 * (`completed`/`failed`/`cancelled`). A non-terminal record — for example a task
 * that was claimed and then unclaimed or reassigned while the error was queued —
 * must fall back to the plain "no open attempt" wording instead of implying a
 * delivery landed.
 */
export declare function settledTaskRecord(observed: Pick<TeamTask, 'id'> | undefined, tasks: readonly Pick<TeamTask, 'id' | 'status' | 'subject'>[]): Pick<TeamTask, 'id' | 'status' | 'subject'> | undefined;
/**
 * Build the durable captain note for one recorded failure. Pure, so the wording
 * boundaries are testable without a lock or a Harness.
 * @param memberName - the member that failed.
 * @param summary - the failure message plus its code.
 * @param disposition - what the failure was allowed to do.
 * @param task - the open attempt that was failed, when there was one.
 * @param settledRecord - the terminal record of the observed task, when it exists.
 * @returns the exact message the captain will read.
 */
export declare function memberFailureMessage(memberName: string, summary: string, disposition: MemberFailureDisposition, task: Pick<TeamTask, 'id' | 'subject'> | undefined, settledRecord: Pick<TeamTask, 'id' | 'status' | 'subject'> | undefined): string;
/** Record a final turn failure, never an intermediate request retry. */
export declare function failMemberOpenAttempt(ctx: Context, stateRoot: string, teamId: string, memberName: string, failure: {
    readonly code: string;
    readonly message: string;
}, fallbackSession: Session, observed: FailedMemberAttempt): Promise<boolean>;
/**
 * Resolve one member's complete model selection. Ordinary members snapshot the
 * captain's current request route and reasoning effort. When provider or model
 * changes, effort is intentionally omitted so the target model materializes
 * its own default instead of receiving an adapter-owned id from another route.
 * An explicit effort overrides either policy; the sentinel "default" also
 * selects the target model's default. The final effort is validated against
 * the target model before a child is created.
 *
 * A configured `memberModel` is a route preference, not a blind model-id
 * override: it is paired with `memberLlmProvider` (or its own `provider/model`
 * form) when configured, and when only a bare model id is configured it is
 * adopted by the captain's provider only if that provider actually advertises
 * it. Otherwise the catalog decides: exactly one advertising provider wins,
 * none or several produce an actionable error listing them (issue #189). A
 * provider the caller *named* — explicitly or via configuration — is never
 * silently switched away from.
 */
export declare function resolveMemberLlmSelection(ctx: Context, captain: Agent, request: MemberLlmSelectionRequest, signal?: AbortSignal): Promise<MemberLlmSelection>;
/**
 * Install the member selection bridge for every fresh or cold-resumed
 * continuable child. Fresh creation reads the pending in-memory selection;
 * cold resume restores the same selection from the owning team's durable
 * record. Legacy members without a complete saved route retain Harness's
 * descriptor provider/model behavior.
 */
export declare function installMemberSelectionRuntime(ctx: Context, stateDir: string, onFailureSettled?: (workspace: string, teamId: string, memberName: string) => Promise<void>): MemberSelectionRuntime;
/**
 * The member's system prompt (persona), shadowing the deployment persona for
 * that child. Self-contained: it replaces the whole persona section.
 * Frozen at spawn: draft must already carry the Team goal and profile protocol.
 * @param team - the team the member joined.
 * @param member - the member record (name/role are read before spawning).
 * @param stateDir - configured state directory, so the member can locate the
 *   team files with its own file tools.
 */
export declare function memberPersona(team: TeamState, member: TeamMember, stateDir: string, executionPrompt?: string): string;
/**
 * The initial user message delivered when the member is created.
 * Counts non-terminal tasks already assigned to this member on the in-memory draft.
 * @param team - the team the member joined.
 * @param memberName - canonical member name used to count assigned pending work.
 */
export declare function memberWelcome(team: TeamState, memberName: string): string;
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
 * @param initialPrompt - first turn text; the welcome message when omitted.
 * @param resolvedFilter - the member's effective tool filter (a selected
 *   policy, or the legacy captain-only filter when the member has none). The
 *   caller resolves it so `spawnMember` forwards exactly one immutable filter
 *   to `startContinuable`.
 * @param relaxableDeny - deny names the lenient retry may drop for this
 *   member; the caller narrows it for a policy member so a name the owner
 *   declared is never silently removed.
 */
export declare function spawnMember(ctx: Context, config: MemberRuntimeConfig, selections: MemberSelectionRuntime, llmSelection: MemberLlmSelection, captain: Agent, team: TeamState, member: TeamMember, stateDir: string, signal: AbortSignal, initialPrompt?: string, resolvedFilter?: MemberToolFilter, relaxableDeny?: readonly string[]): Promise<void>;
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
export declare function deliverToMember(ctx: Context, captain: Agent, childId: string, text: string, signal: AbortSignal, mode?: 'queue' | 'steer'): Promise<boolean>;
/**
 * Request cancellation of one live member's current turn. Best effort, fire
 * and return; the target may keep running until it observes the signal.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captain - the exact live captain agent (the member's parent).
 * @param childId - the member's durable child session id.
 */
export declare function interruptMember(ctx: Context, captain: Agent, childId: string): void;
/**
 * Install the missing per-child retirement boundary above Harness rc.6.
 *
 * Upstream `interrupt()` deliberately preserves continuable sessions and the
 * upstream seam exposes no targeted forget/retire method. The durable
 * AgentTeams index therefore rejects every inbox delivery before it can cold-resume a
 * retired member. Catalog rows deliberately remain discoverable: Harness rc.8
 * uses the direct-child catalog to authorize historical transcript reads and
 * `openSubagent()`, so filtering those rows would make an archived member's
 * persisted conversation inaccessible. Exact ids keep unrelated subagents
 * untouched while the delivery boundary still prevents further model turns.
 */
export declare function installRetiredMemberGuard(ctx: Context, stateDir: string): void;
/** Bound all descendant creation, including renamed tools and code-runtime calls. */
export declare function installMemberDelegationGuard(ctx: Context, stateDir: string, maxDepth: number): void;
/**
 * Snapshot the real driver activity for durable member ids.
 *
 * The team record is the membership authority, so this path intentionally no
 * longer depends on `listChildren()`'s versioned projection shape. Harness
 * rc.8 changed those rows to branded `SessionId` values plus residency-only
 * `activity`; neither is needed to answer whether the live Agent driver is
 * running, idle, or absent/ready.
 * @param ctx - the plugin context (injects `agents`).
 * @param memberIds - child ids restored from the durable team record.
 * @returns child id → live activity.
 */
export declare function memberActivity(ctx: Context, memberIds: readonly string[]): Map<string, 'running' | 'idle' | 'ready'>;
export {};
