import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * AgentTeams conversation card: the lightweight in-conversation summary for
 * one team — the captain's whale avatar and name, the member roster as
 * clickable whale avatars (opening the member's subagent transcript), and
 * an "activity panel" button that re-activates the top-right floater.
 *
 * The floater and this card share the `agent-teams:open-panel` window event
 * so the card can summon the panel even after it was closed (or when an old
 * session is re-opened for review).
 * @module dsh-agent-teams/client/card
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getActivitySnapshotsSnapshot, monitorAgentTeam, subscribeActivitySnapshots, } from "./activity-monitor.js";
import { LEAD_ART, resolveMemberArtwork, vendorSlug } from "./artwork.js";
import css from './AgentTeamsCard.module.css';
/** Member avatar with broken-image fallback to the initial-letter badge. */
function MemberAvatar({ name, art, }) {
    const [failed, setFailed] = useState(false);
    if (failed) {
        return _jsx("span", { className: css.memberInitial, children: name.trim().slice(0, 1).toUpperCase() || '?' });
    }
    return _jsx("img", { className: css.memberArt, src: art, alt: "", "aria-hidden": true, onError: () => { setFailed(true); } });
}
/** Window event name the floater listens for to open itself. */
export const OPEN_PANEL_EVENT = 'agent-teams:open-panel';
/** Open the matching team view, carrying this team's summary
 * so the panel can show it even when the team no longer exists on disk
 * (historical session review). */
export function openActivityPanel(data) {
    window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, {
        detail: {
            teamId: data.teamId,
            captainSessionId: data.captainSessionId,
            teamName: data.teamName,
            members: data.members,
        },
    }));
}
/** Render one durable team as a compact conversation card. */
const noWorkspace = () => undefined;
const noSubscription = () => () => { };
export function AgentTeamsCard({ node, openMember, sessionId, t, workspaceBridge }) {
    const native = useSyncExternalStore(workspaceBridge?.subscribe ?? noSubscription, workspaceBridge?.getSnapshot ?? noWorkspace);
    const location = node.location;
    // Closed turns render their card through the official, non-folding turn tail.
    if (native && (location.kind === 'turn' || location.kind === 'step') && location.turn.status === 'closed')
        return null;
    return _jsx(AgentTeamsSummary, { data: node.data, openMember: openMember, sessionId: sessionId, t: t });
}
export function AgentTeamsSummary({ data, openMember, sessionId, t }) {
    // `conversation.chat.node` is session-scoped, so its framework-owned id is
    // a stable owner even while another conversation becomes current.
    const owner = data.captainSessionId || sessionId;
    const { teams, archivedTeams } = useSyncExternalStore(subscribeActivitySnapshots, getActivitySnapshotsSnapshot);
    useEffect(() => {
        return monitorAgentTeam(owner, data.teamId);
    }, [data.teamId, owner]);
    const snapshot = teams.find((team) => team.teamId === data.teamId && (owner === '' || team.captainSessionId === owner))
        ?? archivedTeams.find((team) => team.teamId === data.teamId && (owner === '' || team.captainSessionId === owner));
    const resolved = useMemo(() => ({
        ...data,
        captainSessionId: snapshot?.captainSessionId ?? owner,
        teamName: snapshot?.name ?? data.teamName,
        members: snapshot?.members.map((member) => ({
            id: member.id,
            name: member.name,
            role: member.role,
            provider: member.provider,
            model: member.model,
        })) ?? data.members,
    }), [data, owner, snapshot]);
    return (_jsxs("section", { className: css.root, "data-agent-teams-card": true, "data-team-id": resolved.teamId, children: [_jsxs("header", { className: css.head, children: [_jsx("img", { className: css.leadAvatar, src: LEAD_ART, alt: "", "aria-hidden": true }), _jsx("span", { className: css.teamName, title: resolved.teamName, children: resolved.teamName }), _jsx("span", { className: css.memberCount, children: t('card.memberCount', { count: resolved.members.length }) }), _jsx("button", { type: "button", className: css.panelButton, onClick: () => { openActivityPanel(resolved); }, "aria-label": t('workspace.focus'), title: t('workspace.focus'), children: t('workspace.focus') })] }), resolved.members.length > 0 && (_jsx("div", { className: css.members, children: resolved.members.map((member) => {
                    const vendor = vendorSlug(member);
                    const resolved = resolveMemberArtwork({ name: member.name, role: member.role, vendor });
                    const title = resolved.labelKey !== null
                        ? `${member.name} · ${t('member.art.rolePrefix')}${t(resolved.labelKey)}`
                        : resolved.isFallback
                            ? `${member.name} · ${t('member.art.fallbackLabel')}`
                            : member.name;
                    return (_jsxs("button", { type: "button", className: css.member, onClick: () => {
                            if (member.id !== '')
                                openMember(owner, member.id);
                        }, title: title, children: [resolved.url !== null && _jsx(MemberAvatar, { name: member.name, art: resolved.url }), _jsx("span", { className: css.memberName, children: member.name })] }, member.id || member.name));
                }) }))] }));
}
