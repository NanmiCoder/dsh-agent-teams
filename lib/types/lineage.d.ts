/**
 * Durable session lineage for team identity.
 *
 * Forking is a first-class DSH operation: the fork receives a new session id
 * and records the source session as `header.parentSession`. Team identity must
 * therefore be resolved along that chain, or a captain that continues in its
 * own fork stops matching the team it leads (#176). Membership keeps its exact
 * id match: a member is a subagent child of its captain, so its parent chain
 * also contains the captain and must never be read as lead identity. Only a
 * top-level conversation may inherit lead identity from an ancestor.
 *
 * Authorization paths resolve the chain durably: a hop is read from the live
 * session when that session is resident and from the persistence service's
 * stored header otherwise, so a fork still resolves its team while an
 * intermediate session (or the original captain) is not loaded. The
 * synchronous prompt-assembly path uses the calling session's own durable
 * header plus resolvable live hops; failing to resolve there only leaves the
 * default captain-side prompt in place — every tool re-authorizes
 * asynchronously.
 * @module dsh-agent-teams/lineage
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session } from '@deepseek-ai/dsh-session';
/** Maximum fork-chain depth resolved for one identity (cycle- and length-bounded). */
export declare const LINEAGE_MAX_DEPTH = 32;
/** One calling session's durable identity as the team lookups need it. */
export interface LeadIdentity {
    /** The calling session id. */
    readonly sessionId: string;
    /** Ancestor session ids reachable through `header.parentSession`, nearest first. */
    readonly ancestry: readonly string[];
    /** Whether this session may inherit lead identity from an ancestor at all. */
    readonly inheritsLead: boolean;
}
/** The live session for one id: resident agent first, then the live session store. */
export declare function liveSession(ctx: Context, id: string): Session | undefined;
/** Whether one session is a top-level conversation rather than a subagent child. */
export declare function isTopLevelSession(session: Session): boolean;
/**
 * Durable ancestry of one session, nearest first. The calling session's own
 * header supplies the first hop; later hops come from resident sessions or
 * stored headers, so a fork resolves through sessions that are not loaded.
 * @param ctx - the plugin context (injects `agents`).
 * @param session - the calling session.
 * @returns ancestor session ids, bounded by {@link LINEAGE_MAX_DEPTH}.
 */
export declare function resolveAncestry(ctx: Context, session: Session): Promise<readonly string[]>;
/**
 * Ancestry resolvable without awaiting: the calling session's durable first
 * hop, then resident sessions, then whatever the async resolver cached.
 */
export declare function sessionAncestry(ctx: Context, session: Session): readonly string[];
/** Resolve one session's lead identity synchronously (prompt-assembly path). */
export declare function leadIdentityOf(ctx: Context, session: Session): LeadIdentity;
/** Resolve one session's lead identity durably (authorization paths). */
export declare function leadIdentityOfAsync(ctx: Context, session: Session): Promise<LeadIdentity>;
/** The lead-relevant view of a team record. */
export interface LeadScopedTeam {
    readonly captainSessionId: string;
    /** Present on real team state; omitting it keeps the pure exact-id contract. */
    readonly members?: readonly {
        readonly id: string;
        readonly status?: string;
    }[];
    /**
     * Session ids explicitly authorized to lead this team (via `agent_teams_adopt`),
     * in addition to the original captain and its fork descendants.
     */
    readonly authorizedLeads?: readonly string[];
}
/** Whether one identity leads (or inherits the lead of) a team's recorded captain. */
export declare function teamLeadMatch(team: LeadScopedTeam, lead: LeadIdentity): boolean;
/**
 * Whether one live session id leads a team: the recorded captain itself, or a
 * top-level fork descendant of it. Members never match through their parent
 * chain, and a member's fork does not match either.
 */
export declare function sessionLeadsTeam(ctx: Context, team: LeadScopedTeam, sessionId: string): boolean;
/** Durable {@link sessionLeadsTeam}: resolves the caller's chain through stored headers. */
export declare function sessionLeadsTeamAsync(ctx: Context, team: LeadScopedTeam, sessionId: string): Promise<boolean>;
/**
 * Nearest live lead session of a team: the recorded captain while it is
 * resident, otherwise the closest live fork descendant of it. Captain-directed
 * reports use this so a human working in a fork still receives them, while the
 * durable mail record stays addressed to the recorded captain.
 * @param ctx - the plugin context (injects `agents`).
 * @param team - current team state.
 * @returns the live lead agent, or undefined when no lead session is resident.
 */
export declare function nearestLiveLead(ctx: Context, team: LeadScopedTeam, live?: readonly Agent[]): Agent | undefined;
/**
 * Diagnostic note for a caller that matched no team but is a fork, so an
 * operator can distinguish "no team exists" from "a team exists that this
 * session does not lead".
 */
export declare function forkLineageNote(session: Session): string;
