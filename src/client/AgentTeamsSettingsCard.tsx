/**
 * AgentTeams settings card: the single Parallel Emission checkbox inside the
 * Plugins configuration tab. The card is registered under the
 * `settings.plugin.item` keyed slot with key `agent-teams`, so the tab pairs
 * it with the Host-side namespace of the same name without learning what the
 * namespace means (type-only slot contract).
 *
 * Type-only cross-plugin imports: the scope arrives through the cordis
 * `settingsScope` service and writes go through it too, so the client bundle
 * purity gate never sees a cross-plugin value import.
 * @module dsh-agent-teams/client/settings-card
 */

import { useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AgentTeamsSettingsCard.module.css'

/**
 * Settings namespace this card edits. Must equal the Host-side registration
 * (`AGENT_TEAMS_SETTINGS_NAMESPACE` in src/settings.ts); kept as a literal so
 * the browser bundle never value-imports the host settings module.
 */
export const AGENT_TEAMS_SETTINGS_KEY = 'agent-teams'

/** The bound `agent-teams` namespace scope handed to the card. */
export type AgentTeamsSettingsScope = SettingsScope<{ parallelToolCalls: boolean }>

/** Injected share: the scope bound on this plugin's client fiber. */
export interface AgentTeamsSettingsCardInjected {
  readonly scope: AgentTeamsSettingsScope
}

/** Complete keyed settings-card props. */
export type AgentTeamsSettingsCardProps =
  PropsRuntime<'settings.plugin.item', typeof AGENT_TEAMS_SETTINGS_KEY>
  & PropsLocale<'agentTeams'>
  & AgentTeamsSettingsCardInjected

/**
 * Render the Parallel Emission checkbox. The checkbox is disabled unless the
 * namespace is served by the Host and the settings document accepts writes
 * (non-loopback pages run in memory mode); the hint always explains what the
 * switch does and what it deliberately does not touch.
 */
export function AgentTeamsSettingsCard({ t, scope }: AgentTeamsSettingsCardProps) {
  const snapshot = useSyncExternalStore(scope.subscribe, scope.getSnapshot)
  const ready = snapshot.status === 'ready'
  const writable = ready && snapshot.writable
  const checked = snapshot.value?.parallelToolCalls === true
  return (
    <div className={css.root}>
      <label className={css.row}>
        <input
          type="checkbox"
          checked={checked}
          disabled={!writable}
          data-agent-teams-parallel={checked ? 'on' : 'off'}
          onChange={(event) => { void scope.set('parallelToolCalls', event.currentTarget.checked) }}
        />
        <span className={css.label}>{t('settings.parallel.label')}</span>
      </label>
      <p className={css.hint}>{t('settings.parallel.hint')}</p>
      {ready && !writable ? <p className={css.hint}>{t('settings.parallel.readOnly')}</p> : null}
    </div>
  )
}
