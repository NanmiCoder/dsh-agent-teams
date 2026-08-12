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
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client';
/** Final keyed Chat payload for the team summary card. */
export interface AgentTeamsCardData {
    readonly teamId: string;
    /** The captain session that owns this team (panel follows it). */
    readonly captainSessionId: string;
    readonly teamName: string;
    readonly members: readonly {
        readonly id: string;
        readonly name: string;
        readonly role: string;
    }[];
}
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
    interface ChatNodeDataMap {
        /** Lightweight team summary card anchoring the conversation. */
        'agent-teams': AgentTeamsCardData;
    }
}
/** Folded member record. */
interface AgentTeamsMemberState {
    readonly id: string;
    readonly name: string;
    readonly role?: string;
    readonly removed?: boolean;
}
/** Folded team record (the node's business state). */
export interface AgentTeamsNodeState {
    readonly teamId: string;
    readonly captainSessionId: string;
    readonly name: string;
    readonly members: readonly AgentTeamsMemberState[];
}
/** Durable `agent-teams/*` events folded into one keyed Chat node. */
export declare const agentTeamsCardDefinition: ConversationNodeDefinition<AgentTeamsNodeState>;
export {};
