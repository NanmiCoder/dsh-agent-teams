/** Browser plugin for the AgentTeams activity floater and conversation card. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Required services: conversation nodes, slots, and sessions navigation. */
export declare const inject: string[];
/**
 * Mount the floater through a body portal (the web shell has no top-right
 * slot) and register the in-conversation team card, whose "activity panel"
 * button re-activates the floater via a window event — the recovery path
 * for a closed floater or a re-opened session.
 */
export declare function apply(ctx: ClientContext): void;
