/**
 * The `agent_teams_*` model-facing tools.
 *
 * The captain (the agent that created the team) orchestrates: members are
 * continuable subagents it spawns and wakes. Members share the same tools and
 * drive their own task state, mirroring the Claude Code AgentTeams flow:
 * create team → add members → create tasks with dependencies → claim/assign →
 * work → report → status → delete.
 * @module dsh-agent-teams/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type MemberToolPolicy } from './tool-policies.ts';
import type { ArtifactSnapshot } from './types.ts';
import { type TeamState, type TeamTask } from './types.ts';
export { steerCaptainReport } from './members.ts';
/** Resolved plugin config consumed by the tools. */
export interface ToolsConfig {
    /** State directory name under the captain's workspace. */
    stateDir: string;
    /** Global memory directory for cross-workspace member memories. */
    globalMemoryDir: string;
    /** Member subagent provider name. */
    memberProvider: string;
    /** Optional member model override. */
    memberModel?: string;
    /** Optional member LLM provider, paired with `memberModel` (issue #189). */
    memberLlmProvider?: string;
    /** Prompt injected into member personas and assignments. */
    executionPrompt?: string;
    /** Plugin fallback route. */
    fallback?: import('./profiles.ts').TeamModelFallbackConfig;
    /** Member delegation depth cap. */
    memberMaxDepth?: number;
    /** Team size cap (members). */
    maxMembers: number;
    /** Named team profiles from the active DSH profile. */
    profiles: Record<string, import('./profiles.ts').TeamProfileConfig>;
    /** Owner-declared reusable member tool policies, keyed by policy id (#59). */
    toolPolicies: Record<string, MemberToolPolicy>;
}
/** Browser/UI mutations allowed while a plan is waiting for approval. */
export type StagedPlanMutation = {
    action: 'update_member';
    memberName: string;
    role?: string | null;
    provider: string;
    model: string;
    reasoningEffort?: string | null;
    executionPrompt?: string | null;
    /** Selected tool-policy id; an empty string clears it back to no policy. */
    toolPolicy?: string;
} | {
    action: 'update_task';
    taskId: string;
    subject: string;
    description?: string | null;
    assignee?: string | null;
    dependencies: string[];
} | {
    action: 'add_task';
    subject: string;
    description?: string | null;
    assignee?: string | null;
    dependencies: string[];
} | {
    action: 'remove_task';
    taskId: string;
} | {
    action: 'remove_member';
    memberName: string;
};
/** Runtime bridge shared by model-facing tools and the Web staging surface. */
export interface AgentTeamsRuntime {
    isPendingMember(agent: Agent): boolean;
    updateStagedPlan(captain: Agent, teamId: string, mutation: StagedPlanMutation, signal?: AbortSignal): Promise<TeamState>;
    updateStagedPlanBatch(captain: Agent, teamId: string, mutations: readonly StagedPlanMutation[], signal?: AbortSignal): Promise<TeamState>;
    approveStagedTeam(captain: Agent, teamId: string, signal?: AbortSignal): Promise<{
        teamId: string;
        members: number;
        tasks: number;
    }>;
    continueStagedPlanning(captain: Agent, teamId: string): Promise<{
        teamId: string;
        alreadyWaiting: boolean;
    }>;
    discardStagedTeam(captain: Agent, teamId: string): Promise<{
        teamId: string;
    }>;
    /**
     * Hot-swap one member's LLM route at runtime without destroying the member
     * session or losing context. Persists activeProvider/activeModel to team.json
     * and mutates the live selection ref when the member is resident. Shared by
     * the `agent_teams_set_member_model` tool and the Web member-model route so
     * the panel can switch a broken or slow model mid-task.
     * @param captain - the captain (or authorized lead / PM) agent.
     * @param teamId - the team id.
     * @param memberName - display name of the member whose model should change.
     * @param provider - new LLM provider id.
     * @param model - new model id under the provider.
     * @param reasoningEffort - optional reasoning effort id; omit for the model default.
     * @param signal - optional abort signal for catalog resolution.
     * @returns the previous route, the new route, and whether the live ref was swapped.
     */
    setMemberModel(captain: Agent, teamId: string, memberName: string, provider: string, model: string, reasoningEffort?: string, signal?: AbortSignal): Promise<{
        memberName: string;
        previousProvider?: string;
        previousModel?: string;
        newProvider: string;
        newModel: string;
        live: boolean;
    }>;
}
export declare function haltTeamWork(input: {
    ctx: Context;
    stateRoot: string;
    teamId: string;
    captain: Agent;
    signal?: AbortSignal;
}): Promise<{
    teamName: string;
    captainSessionId: string;
    cancelledTasks: number;
    alreadyHalted: boolean;
}>;
/** Web approval has no tool result in the captain's conversation. */
export declare function stagedPlanApprovedContext(teamName: string): string;
/** Context queued after the human rejects a staged plan. */
export declare function stagedPlanDiscardContext(teamName: string): string;
/** Model-facing continuation that turns the review UI back into a conversation. */
export declare function stagedPlanFeedbackContext(teamName: string): string;
/**
 * Register every `agent_teams_*` tool into the shared tools registry.
 * @param ctx - the plugin context (injects `tools`).
 * @param config - resolved tool config.
 */
export declare function registerAgentTeamsTools(ctx: Context, config: ToolsConfig): AgentTeamsRuntime;
export declare function applyQualityFollowUp(team: TeamState, closed: TeamTask, snapshotPaths?: (paths: readonly string[]) => ArtifactSnapshot, pathExists?: (path: string) => boolean): {
    created: TeamTask[];
    escalated: boolean;
    reason?: string;
    excludedFindings?: string[];
};
