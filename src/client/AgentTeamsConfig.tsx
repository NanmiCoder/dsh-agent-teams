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

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  SettingsForm,
  SettingsFormModel,
  SettingsValueField,
  settingsNumberField,
  type SettingsFieldSpec,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { AGENT_TEAMS_LOCALE_NAMESPACE } from './locales.ts'
import css from './AgentTeamsConfig.module.css'

/** The profile entry id this bundle's `cordis.patch.yml` row declares. */
export const AGENT_TEAMS_CONFIG_ENTRY = 'agent-teams'
/** The bundle key `plugins.bundle.config` dispatches on (the npm package name). */
export const AGENT_TEAMS_BUNDLE_CONFIG_KEY = '@nanmicoder/dsh-agent-teams'
/** The one Config field this page edits. */
export const MAX_MEMBERS_FIELD = 'maxMembers'

/** Accepted values and staged edit state this page renders. */
export interface AgentTeamsConfigState extends SettingsFormShell {
  readonly maxMembers: SettingsFieldState
}

/** What the page's slot registration injects into the renderer. */
export interface AgentTeamsConfigFace {
  hooks: { configCard: SnapshotStore<AgentTeamsConfigState> }
  edit: SettingsFormActions['edit']
  resetField: SettingsFormActions['resetField']
  save: SettingsFormActions['save']
  discard: SettingsFormActions['discard']
}

/** Framework props of the bundle configuration page. */
export type AgentTeamsConfigProps =
  PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<'agentTeams'>
  & InjectFace<AgentTeamsConfigFace>

/**
 * One whole-number field constrained to the Config schema's `natural().min(1)`.
 * Empty drafts clear the override; any other draft that is not a safe integer
 * at or above 1 blocks the save instead of being silently rewritten.
 *
 * @returns The numeric field spec with the roster floor applied.
 */
function maxMembersField(): SettingsFieldSpec {
  const numeric = settingsNumberField(MAX_MEMBERS_FIELD)
  return {
    ...numeric,
    parse: (text) => {
      const write = numeric.parse(text)
      if (write?.kind !== 'set') return write
      const value = write.value
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && !Object.is(value, -0) ? write : undefined
    },
  }
}

/**
 * Bind the `agent-teams` entry form to one staged numeric field.
 *
 * @param scope - Host-owned configuration form for this plugin entry.
 * @returns The bound snapshot and the form's edit/save/discard actions.
 */
export function createAgentTeamsConfig(scope: ConfigForm<Record<string, unknown>>) {
  const form = new SettingsFormModel<Record<string, unknown>>(scope, [maxMembersField()])
  const configCard: SnapshotStore<AgentTeamsConfigState> = form.bind(() => ({
    ...form.shell(),
    maxMembers: form.field(MAX_MEMBERS_FIELD),
  }))
  return {
    configCard,
    actions: form.actions(),
    dispose: () => form.dispose(),
  }
}

/**
 * Render the bundle configuration page. `SettingsForm` owns availability,
 * read-only copy, and the single save/discard boundary; the field below only
 * stages text and reports its validation state.
 */
export function AgentTeamsConfig({ t, useConfigCard, edit, resetField, save, discard }: AgentTeamsConfigProps) {
  const state = useConfigCard(snapshot => snapshot)
  return (
    <SettingsForm
      labels={{
        unavailable: t('config.unavailable'),
        readOnly: t('config.readOnly'),
        saveFailed: t('config.saveFailed'),
        save: t('config.save'),
        saving: t('config.saving'),
      }}
      state={state}
      onSave={save}
      onDiscard={discard}
    >
      <div className={css.section}>
        <SettingsValueField
          id="agent-teams-max-members"
          label={t('config.maxMembers')}
          hint={t('config.maxMembersHint')}
          overriddenLabel={t('config.overridden')}
          resetLabel={t('config.reset')}
          invalidLabel={t('config.invalid')}
          numeric
          disabled={!state.writable || state.saving}
          {...state.maxMembers}
          onEdit={(text) => edit(MAX_MEMBERS_FIELD, text)}
          onReset={() => resetField(MAX_MEMBERS_FIELD)}
        />
      </div>
    </SettingsForm>
  )
}

/**
 * Register the bundle configuration page on the Plugins page. The page exists
 * only while the Host serves this plugin's settings namespace; it writes
 * through the shared form queue, so the Host's Config validation and revision
 * fence stay authoritative.
 *
 * @param ctx - AgentTeams client plugin context.
 */
export function installAgentTeamsConfigPage(ctx: ClientContext): void {
  const card = createAgentTeamsConfig(ctx.configForms.get<Record<string, unknown>>(AGENT_TEAMS_CONFIG_ENTRY))
  ctx.effect(() => () => card.dispose(), 'agent-teams: config form subscription')
  ctx.effect(
    () => ctx.configForms.whileServed([AGENT_TEAMS_CONFIG_ENTRY], () => ctx.slots.register({
      name: 'plugins.bundle.config',
      key: AGENT_TEAMS_BUNDLE_CONFIG_KEY,
      locale: AGENT_TEAMS_LOCALE_NAMESPACE,
      inject: () => ({
        hooks: { configCard: card.configCard },
        ...card.actions,
      }),
    }, AgentTeamsConfig)),
    'agent-teams: plugin configuration page',
  )
}