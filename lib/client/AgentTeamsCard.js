import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { LEAD_ART, memberArtUrl } from "./artwork.js";
import css from './AgentTeamsCard.module.css';
/** Window event name the floater listens for to open itself. */
export const OPEN_PANEL_EVENT = 'agent-teams:open-panel';
/** Re-activate the top-right activity panel, carrying this team's summary
 * so the panel can show it even when the team no longer exists on disk
 * (historical session review). */
function openActivityPanel(data) {
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
export function AgentTeamsCard({ node, openSession }) {
    const data = node.data;
    return (_jsxs("section", { className: css.root, "data-agent-teams-card": true, "data-team-id": data.teamId, children: [_jsxs("header", { className: css.head, children: [_jsx("img", { className: css.leadAvatar, src: LEAD_ART, alt: "", "aria-hidden": true }), _jsx("span", { className: css.teamName, title: data.teamName, children: data.teamName }), _jsxs("span", { className: css.memberCount, children: [data.members.length, " \u540D\u6210\u5458"] }), _jsx("button", { type: "button", className: css.panelButton, onClick: () => { openActivityPanel(data); }, "aria-label": "\u6253\u5F00\u6D3B\u52A8\u9762\u677F", title: "\u6253\u5F00\u6D3B\u52A8\u9762\u677F", children: "\u6D3B\u52A8\u9762\u677F" })] }), data.members.length > 0 && (_jsx("div", { className: css.members, children: data.members.map((member) => (_jsxs("button", { type: "button", className: css.member, onClick: () => { if (member.id !== '')
                        openSession(member.id); }, title: member.role === '' ? member.name : `${member.name} · ${member.role}`, children: [memberArtUrl(member.name, member.role) !== null ? (_jsx("img", { className: css.memberArt, src: memberArtUrl(member.name, member.role) ?? '', alt: "", "aria-hidden": true })) : (_jsx("span", { className: css.memberInitial, children: member.name.trim().slice(0, 1).toUpperCase() || '?' })), _jsx("span", { className: css.memberName, children: member.name })] }, member.id))) }))] }));
}
