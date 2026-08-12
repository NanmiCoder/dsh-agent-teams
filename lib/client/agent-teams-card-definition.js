/**
 * AgentTeams conversation card: a lightweight in-conversation summary shown
 * when a team is created — the captain's name, the member roster with whale
 * avatars, and an entry point that re-activates the top-right activity
 * panel (useful after the floater was closed, or when re-opening an old
 * session for review).
 *
 * The fold replays the durable `agent-teams/*` session events (the same
 * event family the activity panel's server snapshots are derived from), so
 * the card survives restarts and appears in any session whose log carries
 * the team's events.
 * @module dsh-agent-teams/client/card
 */
function updateMemberAdded(state, data) {
    if (state.members.some((member) => member.id === data.memberId))
        return state;
    return {
        ...state,
        members: [...state.members, {
                id: data.memberId,
                name: data.name,
                ...data.role !== undefined ? { role: data.role } : {},
            }],
    };
}
/** Durable `agent-teams/*` events folded into one keyed Chat node. */
export const agentTeamsCardDefinition = {
    kind: 'agent-teams',
    target: 'chat',
    match: (event) => {
        if (event.type === 'agent-teams/team-created')
            return { id: String(event.data.teamId), role: 'start' };
        if (event.type === 'agent-teams/member-added' || event.type === 'agent-teams/member-removed') {
            return { id: String(event.data.teamId), role: 'update' };
        }
        return null;
    },
    start: (_context, match) => {
        if (match.event.type !== 'agent-teams/team-created') {
            throw new Error('agent-teams card start requires agent-teams/team-created');
        }
        // Older logs predate captainSessionId on the event; the card then has no
        // owner and only shows for a matching historic injection.
        return { teamId: match.event.data.teamId, captainSessionId: match.event.data.captainSessionId ?? '', name: match.event.data.name, members: [] };
    },
    update: (context, match) => {
        if (match.event.type === 'agent-teams/member-added')
            return updateMemberAdded(context.state, match.event.data);
        if (match.event.type === 'agent-teams/member-removed') {
            const removedMemberId = match.event.data.memberId;
            return {
                ...context.state,
                members: context.state.members.map((member) => member.id === removedMemberId
                    ? { ...member, removed: true }
                    : member),
            };
        }
        return context.state;
    },
    buildViewNode: (context) => {
        if (context.start === undefined)
            return null;
        const state = context.state;
        return {
            key: context.key,
            kind: 'agent-teams',
            id: context.id,
            target: 'chat',
            anchorSeq: context.start.event.seq,
            location: context.start.location,
            visibility: 'visible',
            data: {
                teamId: state.teamId,
                captainSessionId: state.captainSessionId,
                teamName: state.name,
                members: state.members
                    .filter((member) => member.removed !== true)
                    .map((member) => ({
                    id: member.id,
                    name: member.name,
                    role: member.role ?? '',
                })),
            },
        };
    },
};
