import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
export declare const TEAM_ACTIVATION_PROMPT = "AgentTeams (Agent Teams) provides multi-agent team collaboration. Apply these rules when the user requests it (including /agent-teams) or when continuing an existing team. Mentioning, quoting, discussing, or declining AgentTeams alone is not a request to start work.";
export declare const TEAM_MEMBER_PROMPT = "You are an AgentTeams member. Follow your assigned member persona and task contract. Use agent_teams_claim_task, agent_teams_update_task, agent_teams_send_message and agent_teams_status for your own work. Include the current attempt_id in updates; report completion or failure to the captain. Do not create, approve, edit or resume a team. If your durable membership is unavailable, report that to the parent instead of creating a replacement.";
export declare const TEAM_PM_PROMPT = "You are an AgentTeams PM (project manager) member. In addition to the member tools (claim_task, update_task, send_message, status), you may use agent_teams_create_task, agent_teams_reassign_task, agent_teams_amend_task and agent_teams_set_member_model to schedule work on the captain's behalf. You receive observation copies of inter-member messages \u2014 do not reply to them; intervene only when you detect a problem. Do not create, approve, edit or resume a team, and do not add or remove members. If your durable membership is unavailable, report that to the parent instead of creating a replacement.";
interface CapabilityConfig {
    stateDir: string;
    isPendingMember: (agent: Agent) => boolean;
    captainPrompt: () => string;
    order?: number;
}
/** Call once, after all business definitions have registered. Never per member. */
export declare function installTeamCapabilities(ctx: Context, config: CapabilityConfig): void;
export {};
