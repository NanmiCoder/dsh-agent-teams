/**
 * The AgentTeams user-settings namespace: the single Parallel Emission switch.
 *
 * Hosts that mount the settings service let this plugin register the
 * `agent-teams` namespace with exactly one boolean, `parallelToolCalls`
 * (default `false`). When on, the captain usage section, newly spawned member
 * personas, and assignment prompts allow several `agent_teams_*` tool calls in
 * one assistant message; when off, every surface keeps the serial
 * one-tool-call protocol. The execution pool cap is a different knob owned by
 * the Agent Loop settings (`agent-loop` namespace) and is never written here.
 *
 * The namespace is registered lazily: on hosts (or headless profiles) without
 * the settings service the registration never happens, the switch reads
 * `false`, and the rest of the plugin is unaffected.
 * @module dsh-agent-teams/settings
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace this plugin registers on hosts that provide `ctx.settings`. */
export const AGENT_TEAMS_SETTINGS_NAMESPACE = 'agent-teams'

/** Shape of the registered namespace: exactly the Parallel Emission checkbox. */
export interface AgentTeamsSettings {
  /**
   * Allow several `agent_teams_*` tool calls in one assistant message.
   * Same-response calls still execute in order, so a later `create_task` may
   * depend on a task id created earlier in the same response.
   */
  parallelToolCalls: boolean
}

/** Settings schema for the `agent-teams` namespace (default: serial protocol). */
export const AgentTeamsSettingsSchema: z<AgentTeamsSettings> = z.object({
  parallelToolCalls: z.boolean().default(false),
})
