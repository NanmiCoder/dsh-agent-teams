import { jsx as _jsx } from "react/jsx-runtime";
import { createRoot } from 'react-dom/client';
import { ActivityPanel } from "./ActivityPanel.js";
import { AgentTeamsCard } from "./AgentTeamsCard.js";
import { agentTeamsCardDefinition } from "./agent-teams-card-definition.js";
/** Required services: conversation nodes, slots, and sessions navigation. */
export const inject = ['conversationEvents', 'slots', 'sessions'];
/**
 * Mount the floater through a body portal (the web shell has no top-right
 * slot) and register the in-conversation team card, whose "activity panel"
 * button re-activates the floater via a window event — the recovery path
 * for a closed floater or a re-opened session.
 */
export function apply(ctx) {
    const host = document.createElement('div');
    host.dataset.agentTeamsHost = '';
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(_jsx(ActivityPanel, { sessionsList: ctx.sessions.list, openSession: (id) => { ctx.sessions.open(id); } }));
    ctx.effect(() => () => {
        root.unmount();
        host.remove();
    }, 'agent-teams: activity panel');
    ctx.conversationEvents.register(agentTeamsCardDefinition);
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
        name: 'conversation.chat.node',
        key: 'agent-teams',
        inject: () => ({
            openSession: (id) => { ctx.sessions.open(id); },
            currentSessionId: () => ctx.sessions.list.getSnapshot().current,
        }),
    }, AgentTeamsCard));
}
