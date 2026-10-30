import { jsx as _jsx } from "react/jsx-runtime";
import { SettingsForm, SettingsFormModel, SettingsValueField, settingsNumberField, } from '@deepseek-ai/dsh-client-ui-primitives';
import { AGENT_TEAMS_LOCALE_NAMESPACE } from "./locales.js";
import css from './AgentTeamsConfig.module.css';
/** The profile entry id this bundle's `cordis.patch.yml` row declares. */
export const AGENT_TEAMS_CONFIG_ENTRY = 'agent-teams';
/** The bundle key `plugins.bundle.config` dispatches on (the npm package name). */
export const AGENT_TEAMS_BUNDLE_CONFIG_KEY = '@nanmicoder/dsh-agent-teams';
/** The one Config field this page edits. */
export const MAX_MEMBERS_FIELD = 'maxMembers';
/**
 * One whole-number field constrained to the Config schema's `natural().min(1)`.
 * Empty drafts clear the override; any other draft that is not a safe integer
 * at or above 1 blocks the save instead of being silently rewritten.
 *
 * @returns The numeric field spec with the roster floor applied.
 */
function maxMembersField() {
    const numeric = settingsNumberField(MAX_MEMBERS_FIELD);
    return {
        ...numeric,
        parse: (text) => {
            const write = numeric.parse(text);
            if (write?.kind !== 'set')
                return write;
            const value = write.value;
            return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && !Object.is(value, -0) ? write : undefined;
        },
    };
}
/**
 * Bind the `agent-teams` entry form to one staged numeric field.
 *
 * @param scope - Host-owned configuration form for this plugin entry.
 * @returns The bound snapshot and the form's edit/save/discard actions.
 */
export function createAgentTeamsConfig(scope) {
    const form = new SettingsFormModel(scope, [maxMembersField()]);
    const configCard = form.bind(() => ({
        ...form.shell(),
        maxMembers: form.field(MAX_MEMBERS_FIELD),
    }));
    return {
        configCard,
        actions: form.actions(),
        dispose: () => form.dispose(),
    };
}
/**
 * Render the bundle configuration page. `SettingsForm` owns availability,
 * read-only copy, and the single save/discard boundary; the field below only
 * stages text and reports its validation state.
 */
export function AgentTeamsConfig({ t, useConfigCard, edit, resetField, save, discard }) {
    const state = useConfigCard(snapshot => snapshot);
    return (_jsx(SettingsForm, { labels: {
            unavailable: t('config.unavailable'),
            readOnly: t('config.readOnly'),
            saveFailed: t('config.saveFailed'),
            save: t('config.save'),
            saving: t('config.saving'),
        }, state: state, onSave: save, onDiscard: discard, children: _jsx("div", { className: css.section, children: _jsx(SettingsValueField, { id: "agent-teams-max-members", label: t('config.maxMembers'), hint: t('config.maxMembersHint'), overriddenLabel: t('config.overridden'), resetLabel: t('config.reset'), invalidLabel: t('config.invalid'), numeric: true, disabled: !state.writable || state.saving, ...state.maxMembers, onEdit: (text) => edit(MAX_MEMBERS_FIELD, text), onReset: () => resetField(MAX_MEMBERS_FIELD) }) }) }));
}
/**
 * Register the bundle configuration page on the Plugins page. The page exists
 * only while the Host serves this plugin's settings namespace; it writes
 * through the shared form queue, so the Host's Config validation and revision
 * fence stay authoritative.
 *
 * @param ctx - AgentTeams client plugin context.
 */
export function installAgentTeamsConfigPage(ctx) {
    const card = createAgentTeamsConfig(ctx.configForms.get(AGENT_TEAMS_CONFIG_ENTRY));
    ctx.effect(() => () => card.dispose(), 'agent-teams: config form subscription');
    ctx.effect(() => ctx.configForms.whileServed([AGENT_TEAMS_CONFIG_ENTRY], () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: AGENT_TEAMS_BUNDLE_CONFIG_KEY,
        locale: AGENT_TEAMS_LOCALE_NAMESPACE,
        inject: () => ({
            hooks: { configCard: card.configCard },
            ...card.actions,
        }),
    }, AgentTeamsConfig)), 'agent-teams: plugin configuration page');
}
