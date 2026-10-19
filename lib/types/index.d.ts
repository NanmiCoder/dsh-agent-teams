/**
 * AgentTeams for DeepSeek Harness.
 *
 * A host-plane plugin that registers the `agent_teams_*` tools and one usage
 * agent-scoped usage section. Each session keeps a stable tool set and core
 * instructions. Existing business tools cover the complete team lifecycle.
 * After installation any session can
 * run multi-agent teamwork through natural language (e.g. "use AgentTeams to research X"):
 * the model creates a team (it becomes the captain), spawns members as
 * durable continuable subagents, breaks the goal into tasks with
 * dependencies, wakes members with messages, relays reports, and collects
 * results.
 *
 * Installation (bundle): `dsh plugin --profile <name> add @nanmicoder/dsh-agent-teams`
 * (or a local path). The bundle patch mounts this plugin row into the host
 * composition; the tools register into the shared `tools` registry and the
 * usage section into the global system prompt, so the plugin needs no realm.
 *
 * @module dsh-agent-teams
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type TeamProfileConfig } from './profiles.ts';
import { type MemberToolPolicy } from './tool-policies.ts';
export declare const name = "agent-teams";
export declare const inject: string[];
/** Plugin configuration. */
export interface Config {
    /**
     * State directory name under the captain's workspace; team state lives at
     * `<workspace>/<stateDir>/<teamId>/` (default `.agent-teams`).
     */
    stateDir?: string;
    /**
     * Global memory directory for cross-workspace member memories. Leading `~/`
     * expands to the user home. Default `~/.agent-teams-memories`.
     */
    globalMemoryDir?: string;
    /** `ctx.subagents` provider used to spawn members; must support continuable children and personas (default `spawn`). */
    memberProvider?: string;
    /**
     * Optional model override applied to every member. The id is used verbatim.
     * When the captain's provider does not advertise it, the provider that does
     * is resolved from the live catalogs (only if exactly one advertises it);
     * set `memberLlmProvider` to name the owner explicitly instead.
     */
    memberModel?: string;
    /**
     * LLM provider route that owns `memberModel`. Set this when the member model
     * is served by a different provider than the captain's session; without it
     * the captain's provider is only used if it actually advertises the model,
     * and an ambiguous or unowned model fails with the provider catalogs instead
     * of being silently paired with the captain's route (issue #189).
     * Distinct from `memberProvider`, which is the subagent runtime backend.
     */
    memberLlmProvider?: string;
    /** Prompt injected into member personas and automatic task assignments. */
    executionPrompt?: string;
    /** Plugin-wide fallback route for unavailable member models. */
    fallback?: import('./profiles.ts').TeamModelFallbackConfig;
    /** Member delegation depth cap (default `0`; `0` forbids delegation entirely). */
    memberMaxDepth?: number;
    /** Team size cap in members (default `8`). */
    maxMembers?: number;
    /** Named multi-role team profiles. */
    profiles?: Record<string, TeamProfileConfig>;
    /**
     * Reusable per-member tool policies declared by the deployment owner (#59),
     * keyed by policy id. A member selects one by id (`tool_policy` on
     * `agent_teams_add_member`, a plan member, or a profile member row); the
     * Captain model can select an existing policy but never submit raw lists.
     * `allow` keeps only the named global tools (the four coordination tools are
     * always added); `deny` removes the named global tools. Captain-only tools
     * stay denied either way.
     */
    toolPolicies?: Record<string, MemberToolPolicy>;
    /** Prompt-section order for the usage policy (default `117`, after delegation policy). */
    promptSectionOrder?: number;
    /**
     * Register the deterministic `/agent-teams` activation surfaces (the
     * closed-namespace slash command and the plain-text gesture boundary).
     * Disable to keep the natural-language trigger as the only entry point.
     */
    slashCommand?: boolean;
}
export declare const Config: z<Config>;
/** The model-facing usage policy: when and how to drive AgentTeams. */
export declare function usageSectionText(toolNames: string, profilesText?: string): string;
export declare function apply(ctx: Context, config: Config): void;
