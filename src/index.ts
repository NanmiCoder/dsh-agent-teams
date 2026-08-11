/**
 * AgentTeams for DeepSeek Harness.
 *
 * A host-plane plugin that registers the `agent_teams_*` tools and one usage
 * section into the global system prompt. After installation any session can
 * run multi-agent teamwork through natural language ("用 AgentTeams 做 X"):
 * the model creates a team (it becomes the captain), spawns members as
 * durable continuable subagents, breaks the goal into tasks with
 * dependencies, wakes members with messages, relays reports, and collects
 * results.
 *
 * Installation (bundle): `dsh plugin --profile <name> add dsh-agent-teams`
 * (or a local path). The bundle patch mounts this plugin row into the host
 * composition; the tools register into the shared `tools` registry and the
 * usage section into the global system prompt, so the plugin needs no realm.
 *
 * @module dsh-agent-teams
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Declaration merge only: makes ctx.subagents and ctx.systemPrompt visible.
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { registerAgentTeamsTools, type ToolsConfig } from './tools.ts'

export const name = 'agent-teams'
export const inject = ['tools', 'subagents', 'systemPrompt']

/** Plugin configuration. */
export interface Config {
  /**
   * State directory name under the captain's workspace; team state lives at
   * `<workspace>/<stateDir>/<teamId>/` (default `.agent-teams`).
   */
  stateDir?: string
  /** `ctx.subagents` provider used to spawn members; must support continuable children and personas (default `spawn`). */
  memberProvider?: string
  /** Optional model override applied to every member. */
  memberModel?: string
  /** Member delegation depth cap (default `1`; `0` forbids delegation entirely). */
  memberMaxDepth?: number
  /** Team size cap in members (default `8`). */
  maxMembers?: number
  /** Prompt-section order for the usage policy (default `117`, after delegation policy). */
  promptSectionOrder?: number
}

export const Config: z<Config> = z.object({
  stateDir: z.string().default('.agent-teams'),
  memberProvider: z.string().default('spawn'),
  memberModel: z.string(),
  memberMaxDepth: z.natural().default(1),
  maxMembers: z.natural().min(1).default(8),
  promptSectionOrder: z.natural().default(117),
})

/** The model-facing usage policy: when and how to drive AgentTeams. */
function usageSectionText(toolNames: string): string {
  return `When the user asks to run something with AgentTeams (e.g. "用 AgentTeams 做 X"), you are the captain of a multi-agent team. Follow this protocol:
1. Call agent_teams_create with a team name and the goal as description. You become the captain and may lead one team at a time.
2. Call agent_teams_add_member once per role the goal needs (researcher, engineer, reviewer, ...). Members are durable subagents: they wait for your messages, then work a full turn.
3. Break the goal into tasks with agent_teams_create_task; wire dependencies between tasks (a task is claimable only when its dependencies are completed). Assign each task to a member when it fits a role.
4. Dispatch work: claim each assigned task (agent_teams_claim_task with assignee) and wake the member with agent_teams_send_message naming its task id and instructions. One task per message keeps turns focused.
5. Poll agent_teams_status until members are idle; relay member-to-member messages (agent_teams_send_message with from=<sender>) and collect completed tasks' outputs. If a member reports a blocker, reassign the task or adjust the plan.
6. Present the team's results to the user, then agent_teams_delete the team unless the user wants to keep working with it.

Tools: ${toolNames}`
}

export function apply(ctx: Context, config: Config): void {
  const resolved: ToolsConfig = {
    stateDir: config.stateDir ?? '.agent-teams',
    memberProvider: config.memberProvider ?? 'spawn',
    memberModel: config.memberModel,
    memberMaxDepth: config.memberMaxDepth ?? 1,
    maxMembers: config.maxMembers ?? 8,
  }

  // Fail loud at mount: a provider without continuable/persona capabilities
  // would reject every member spawn at runtime instead.
  const provider = ctx.subagents.getProvider(resolved.memberProvider)
  if (provider === undefined) {
    throw new Error(
      `agent-teams: no subagent provider "${resolved.memberProvider}" is registered — pick one of: ${ctx.subagents.list().join(', ')}`,
    )
  }
  if (provider.prepareContinuable === undefined) {
    throw new Error(`agent-teams: provider "${resolved.memberProvider}" does not support continuable members`)
  }
  if (!provider.capabilities.persona) {
    throw new Error(`agent-teams: provider "${resolved.memberProvider}" cannot apply a member persona`)
  }

  const toolNames = [
    'agent_teams_create',
    'agent_teams_add_member',
    'agent_teams_remove_member',
    'agent_teams_create_task',
    'agent_teams_claim_task',
    'agent_teams_update_task',
    'agent_teams_send_message',
    'agent_teams_status',
    'agent_teams_delete',
  ].join(', ')
  ctx.systemPrompt.section({
    name: 'agent-teams:usage',
    order: config.promptSectionOrder ?? 117,
    text: usageSectionText(toolNames),
  })

  registerAgentTeamsTools(ctx, resolved)
}
