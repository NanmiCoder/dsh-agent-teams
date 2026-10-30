/**
 * AgentTeams plugin configuration: the team roster cap, edited from the
 * Plugins page's bundle form.
 *
 * The DSH settings service exposes every Loader entry's Config schema, but no
 * shipped client auto-generates a page from it (`dsh-settings` reports
 * `autoGenerate` for clients that may; none does yet). A bundle therefore has
 * to register its own `plugins.bundle.config` page. The numeric control and
 * the staged save/discard frame are the official primitives, so this page
 * validates the same way the Subagent limits page does: a safe whole number
 * of 1 or more. The Host still validates the complete Config before writing.
 *
 * Registration is gated on the `agent-teams` settings namespace with
 * `configForms.whileServed`, so a deployment without the settings service
 * never shows a dead configuration page. This page edits only `maxMembers`;
 * every other Config field keeps the `cordis.patch.yml` editing path.
 *
 * @module dsh-agent-teams/client/config
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type SettingsFieldState, type SettingsFormActions, type SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives';
/** The profile entry id this bundle's `cordis.patch.yml` row declares. */
export declare const AGENT_TEAMS_CONFIG_ENTRY = "agent-teams";
/** The bundle key `plugins.bundle.config` dispatches on (the npm package name). */
export declare const AGENT_TEAMS_BUNDLE_CONFIG_KEY = "@nanmicoder/dsh-agent-teams";
/** The one Config field this page edits. */
export declare const MAX_MEMBERS_FIELD = "maxMembers";
/** Accepted values and staged edit state this page renders. */
export interface AgentTeamsConfigState extends SettingsFormShell {
    readonly maxMembers: SettingsFieldState;
}
/** What the page's slot registration injects into the renderer. */
export interface AgentTeamsConfigFace {
    hooks: {
        configCard: SnapshotStore<AgentTeamsConfigState>;
    };
    edit: SettingsFormActions['edit'];
    resetField: SettingsFormActions['resetField'];
    save: SettingsFormActions['save'];
    discard: SettingsFormActions['discard'];
}
/** Framework props of the bundle configuration page. */
export type AgentTeamsConfigProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<'agentTeams'> & InjectFace<AgentTeamsConfigFace>;
/**
 * Bind the `agent-teams` entry form to one staged numeric field.
 *
 * @param scope - Host-owned configuration form for this plugin entry.
 * @returns The bound snapshot and the form's edit/save/discard actions.
 */
export declare function createAgentTeamsConfig(scope: ConfigForm<Record<string, unknown>>): {
    configCard: SnapshotStore<AgentTeamsConfigState>;
    actions: SettingsFormActions;
    dispose: () => void;
};
/**
 * Render the bundle configuration page. `SettingsForm` owns availability,
 * read-only copy, and the single save/discard boundary; the field below only
 * stages text and reports its validation state.
 */
export declare function AgentTeamsConfig({ t, useConfigCard, edit, resetField, save, discard }: AgentTeamsConfigProps): import("react").JSX.Element;
/**
 * Register the bundle configuration page on the Plugins page. The page exists
 * only while the Host serves this plugin's settings namespace; it writes
 * through the shared form queue, so the Host's Config validation and revision
 * fence stay authoritative.
 *
 * @param ctx - AgentTeams client plugin context.
 */
export declare function installAgentTeamsConfigPage(ctx: ClientContext): void;
