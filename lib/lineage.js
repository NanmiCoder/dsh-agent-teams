/** Maximum fork-chain depth resolved for one identity (cycle- and length-bounded). */
export const LINEAGE_MAX_DEPTH = 32;
/**
 * Official optional service access. `ctx.get` is the reflection accessor for a
 * service a plugin does not declare in `inject`; a missing service yields
 * `undefined` instead of a contract error, and a getter that still refuses is
 * contained here.
 */
function optionalService(ctx, name) {
    const get = ctx.get;
    if (typeof get !== 'function')
        return undefined;
    try {
        return get.call(ctx, name);
    }
    catch {
        return undefined;
    }
}
/** Ancestry this process already resolved for one session. */
const ancestryCache = new Map();
/** The live session for one id: resident agent first, then the live session store. */
export function liveSession(ctx, id) {
    const branded = id;
    const agent = ctx.agents.get(branded);
    if (agent !== undefined)
        return agent.session;
    return optionalService(ctx, 'sessions')?.get?.(branded);
}
/** Whether one session is a top-level conversation rather than a subagent child. */
export function isTopLevelSession(session) {
    return session.header.origin !== 'subagent' && (session.header.delegationDepth ?? 0) === 0;
}
/** Durable parent of one session id: the live header, else the stored header. */
async function durableParent(ctx, id) {
    const live = liveSession(ctx, id);
    if (live !== undefined)
        return live.header.parentSession;
    const persistence = optionalService(ctx, 'sessionPersistence');
    try {
        const snapshot = await persistence?.stat?.(id);
        const parent = snapshot?.header?.parentSession;
        return parent;
    }
    catch {
        // Unreadable stored metadata ends this chain; authorization then fails
        // closed on the identity the caller itself provides.
        return undefined;
    }
}
/**
 * Durable ancestry of one session, nearest first. The calling session's own
 * header supplies the first hop; later hops come from resident sessions or
 * stored headers, so a fork resolves through sessions that are not loaded.
 * @param ctx - the plugin context (injects `agents`).
 * @param session - the calling session.
 * @returns ancestor session ids, bounded by {@link LINEAGE_MAX_DEPTH}.
 */
export async function resolveAncestry(ctx, session) {
    const ancestry = [];
    const seen = new Set([session.id]);
    let parent = session.header.parentSession;
    while (parent !== undefined && ancestry.length < LINEAGE_MAX_DEPTH && !seen.has(parent)) {
        seen.add(parent);
        ancestry.push(parent);
        parent = await durableParent(ctx, parent);
    }
    ancestryCache.set(session.id, ancestry);
    return ancestry;
}
/**
 * Ancestry resolvable without awaiting: the calling session's durable first
 * hop, then resident sessions, then whatever the async resolver cached.
 */
export function sessionAncestry(ctx, session) {
    const cached = ancestryCache.get(session.id);
    if (cached !== undefined)
        return cached;
    const ancestry = [];
    const seen = new Set([session.id]);
    let parent = session.header.parentSession;
    while (parent !== undefined && ancestry.length < LINEAGE_MAX_DEPTH && !seen.has(parent)) {
        seen.add(parent);
        ancestry.push(parent);
        parent = liveSession(ctx, parent)?.header.parentSession;
    }
    return ancestry;
}
/** Resolve one session's lead identity synchronously (prompt-assembly path). */
export function leadIdentityOf(ctx, session) {
    return {
        sessionId: session.id,
        ancestry: sessionAncestry(ctx, session),
        inheritsLead: isTopLevelSession(session),
    };
}
/** Resolve one session's lead identity durably (authorization paths). */
export async function leadIdentityOfAsync(ctx, session) {
    return {
        sessionId: session.id,
        ancestry: await resolveAncestry(ctx, session),
        inheritsLead: isTopLevelSession(session),
    };
}
/** Whether one identity leads (or inherits the lead of) a team's recorded captain. */
export function teamLeadMatch(team, lead) {
    const members = team.members ?? [];
    // A listed member is never a lead, retired or not: a member session is a
    // subagent child of its captain, so its parent chain contains the captain id
    // too, and membership revocation must never hand that session lead authority.
    // Member participation itself stays governed by the removed filter in the
    // team lookups.
    if (members.some(member => member.id === lead.sessionId))
        return false;
    if (team.captainSessionId === lead.sessionId)
        return true;
    // An explicitly authorized lead session (via adopt) matches by exact id,
    // and its fork descendants inherit that authority through the ancestry chain.
    if (team.authorizedLeads?.includes(lead.sessionId) === true)
        return true;
    if (!lead.inheritsLead)
        return false;
    // Descending from a member (a fork of one) is not lead identity either.
    if (members.some(member => lead.ancestry.includes(member.id)))
        return false;
    if (lead.ancestry.includes(team.captainSessionId))
        return true;
    // A fork descendant of an authorized lead inherits the lead authority.
    if (team.authorizedLeads !== undefined && lead.ancestry.some(id => team.authorizedLeads.includes(id)))
        return true;
    return false;
}
/**
 * Whether one live session id leads a team: the recorded captain itself, or a
 * top-level fork descendant of it. Members never match through their parent
 * chain, and a member's fork does not match either.
 */
export function sessionLeadsTeam(ctx, team, sessionId) {
    if (team.members?.some(member => member.id === sessionId) === true)
        return false;
    if (team.captainSessionId === sessionId)
        return true;
    if (team.authorizedLeads?.includes(sessionId) === true)
        return true;
    const session = liveSession(ctx, sessionId);
    return session !== undefined && teamLeadMatch(team, leadIdentityOf(ctx, session));
}
/** Durable {@link sessionLeadsTeam}: resolves the caller's chain through stored headers. */
export async function sessionLeadsTeamAsync(ctx, team, sessionId) {
    if (team.members?.some(member => member.id === sessionId) === true)
        return false;
    if (team.captainSessionId === sessionId)
        return true;
    if (team.authorizedLeads?.includes(sessionId) === true)
        return true;
    const session = liveSession(ctx, sessionId);
    return session !== undefined && teamLeadMatch(team, await leadIdentityOfAsync(ctx, session));
}
/**
 * Nearest live lead session of a team: the recorded captain while it is
 * resident, otherwise the closest live fork descendant of it. Captain-directed
 * reports use this so a human working in a fork still receives them, while the
 * durable mail record stays addressed to the recorded captain.
 * @param ctx - the plugin context (injects `agents`).
 * @param team - current team state.
 * @returns the live lead agent, or undefined when no lead session is resident.
 */
export function nearestLiveLead(ctx, team, live) {
    // The recorded captain is the delivery parent whenever it is resident; a
    // registry without `list` (or with rows the lineage cannot read) only means
    // the fork fallback is unavailable, never that this lookup fails.
    const exact = ctx.agents.get(team.captainSessionId);
    if (exact !== undefined)
        return exact;
    let candidates;
    try {
        candidates = live ?? ctx.agents.list();
    }
    catch {
        return undefined;
    }
    let best;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const agent of candidates) {
        try {
            const identity = leadIdentityOf(ctx, agent.session);
            if (!teamLeadMatch(team, identity))
                continue;
            const distance = identity.ancestry.indexOf(team.captainSessionId);
            if (distance < 0 || distance >= bestDistance)
                continue;
            best = agent;
            bestDistance = distance;
        }
        catch {
            continue;
        }
    }
    return best;
}
/**
 * Diagnostic note for a caller that matched no team but is a fork, so an
 * operator can distinguish "no team exists" from "a team exists that this
 * session does not lead".
 */
export function forkLineageNote(session) {
    const parent = session.header.parentSession;
    if (parent === undefined)
        return '';
    return ` (this session is a fork of ${parent}; no active team in this workspace is led by that session or by a lead session in its lineage)`;
}
