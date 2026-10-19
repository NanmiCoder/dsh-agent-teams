import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/** Native workspace content; discovery remains mounted independently of tab lifetime. */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityPanel, TeamSection, historicCardTeam } from "./ActivityPanel.js";
import { OPEN_PANEL_EVENT } from "./AgentTeamsCard.js";
import { currentSessionId } from "./session-navigation.js";
import { getActivityMonitorTargetsSnapshot, getActivitySnapshotsSnapshot, startActivityPolling, subscribeActivityMonitorTargets, subscribeActivitySnapshots, updateActivitySnapshots } from "./activity-monitor.js";
import { createTeamDiscovery } from "./workspace-state.js";
import css from './WorkspaceActivity.module.css';
export const TEAM_TAB_KIND = 'agent-teams';
export const TEAM_TAB_ID = '@nanmicoder/dsh-agent-teams/activity';
/** Optional host integration is observable so installing/removing it also switches the fallback. */
export function createWorkspaceBridge() {
    let sidebar;
    const listeners = new Set();
    return {
        getSnapshot: () => sidebar,
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        set(value) { sidebar = value; for (const listener of listeners)
            listener(); },
    };
}
export function ActivitySurface({ bridge, state, ...props }) {
    const sidebar = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
    return sidebar === undefined ? _jsx(ActivityPanel, { ...props }) : _jsx(WorkspaceMonitor, { ...props, sidebar: sidebar, state: state });
}
function WorkspaceMonitor({ sessionsList, sidebar, state }) {
    const current = currentSessionId(useSyncExternalStore(sessionsList.subscribe, sessionsList.getSnapshot));
    const targets = useSyncExternalStore(subscribeActivityMonitorTargets, getActivityMonitorTargetsSnapshot);
    const currentTargets = useMemo(() => targets.filter(target => target.sessionId === current), [targets, current]);
    // One discovery tracker per visit, outside polling effects restarted by card registration.
    const discover = useMemo(() => createTeamDiscovery(), [current]);
    useEffect(() => {
        if (current === undefined)
            return;
        state.status(current, 'loading');
        const controller = startActivityPolling(currentTargets, {
            discoverySessionId: current,
            onStatus(status) {
                state.status(current, status);
            },
            publishSnapshots(update) {
                updateActivitySnapshots(update);
                if (update.teams === undefined)
                    return;
                const added = discover(update.teams.filter(team => team.captainSessionId === current
                    || (team.authorizedLeads !== undefined && team.authorizedLeads.includes(current))));
                // Do not replace a file/terminal, or navigate a session whose surface is not bound.
                if (added !== undefined && sidebar.mounted.getSnapshot() === current && !sidebar.isExpanded()) {
                    state.select(current, added);
                    sidebar.openTab(TEAM_TAB_KIND);
                }
            },
        });
        return () => { controller.stop(); };
    }, [current, currentTargets, discover, sidebar, state]);
    useEffect(() => {
        const open = (event) => {
            if (current === undefined || sidebar.mounted.getSnapshot() !== current)
                return;
            const data = event.detail;
            if (data?.captainSessionId && data.captainSessionId !== current)
                return;
            if (data?.teamId)
                state.remember(current, data);
            sidebar.openTab(TEAM_TAB_KIND);
        };
        window.addEventListener(OPEN_PANEL_EVENT, open);
        return () => { window.removeEventListener(OPEN_PANEL_EVENT, open); };
    }, [current, sidebar, state]);
    return null;
}
export function WorkspaceActivity({ sessionId, useTabInfo, t, state, modelDirectories, openMember }) {
    const { tab } = useTabInfo();
    const snapshots = useSyncExternalStore(subscribeActivitySnapshots, getActivitySnapshotsSnapshot);
    const local = useSyncExternalStore(state.subscribe, state.getSnapshot);
    const [retry, setRetry] = useState(0);
    const live = snapshots.teams.filter(team => team.captainSessionId === sessionId
        || (team.authorizedLeads !== undefined && team.authorizedLeads.includes(sessionId)));
    const archived = snapshots.archivedTeams.filter(team => (team.captainSessionId === sessionId
        || (team.authorizedLeads !== undefined && team.authorizedLeads.includes(sessionId))) && !live.some(item => item.teamId === team.teamId));
    const historic = [...local.history.values()].filter(team => team.captainSessionId === sessionId
        && !live.some(item => item.teamId === team.teamId) && !archived.some(item => item.teamId === team.teamId))
        .map(team => historicCardTeam(team, sessionId));
    const records = [...live, ...archived, ...historic];
    const selected = records.find(team => team.teamId === local.selected.get(sessionId)) ?? records[0];
    const history = selected !== undefined && !live.includes(selected);
    const status = local.statuses.get(sessionId) ?? 'loading';
    // Explicit reconnect is bounded and cleaned up; ordinary polling is owned by the monitor.
    useEffect(() => {
        if (retry === 0 || !tab.visible)
            return;
        const controller = startActivityPolling([], { discoverySessionId: sessionId, onStatus: value => state.status(sessionId, value) });
        void controller.firstTick.finally(() => { controller.stop(); });
        return () => { controller.stop(); };
    }, [retry, sessionId, state, tab.visible]);
    const backToChat = () => {
        // Closing this occurrence does not cancel a team or destroy other workspace tabs.
        tab.actions.close();
        requestAnimationFrame(() => document.querySelector('[data-composer-card] [contenteditable="true"][role="textbox"], [data-composer-card] textarea')?.focus());
    };
    return (_jsx("div", { className: css.root, "data-agent-teams-workspace": true, "data-session-id": sessionId, children: _jsxs("div", { className: css.content, children: [status === 'error' && _jsxs("div", { className: css.error, role: "alert", children: [_jsx("span", { children: t('workspace.error') }), _jsx("button", { onClick: () => setRetry(value => value + 1), children: t('workspace.retry') })] }), records.length > 1 && _jsx("nav", { className: css.selector, "aria-label": t('workspace.title'), children: records.map(team => _jsxs("button", { "aria-pressed": selected?.teamId === team.teamId, onClick: () => state.select(sessionId, team.teamId), children: [team.name, _jsx("span", { children: t(live.includes(team) ? 'workspace.current' : 'workspace.history') })] }, team.teamId)) }), selected === undefined ? status === 'loading' ? _jsxs("div", { className: css.skeleton, role: "status", "aria-label": t('workspace.loading'), children: [_jsx("i", {}), _jsx("i", {}), _jsx("i", {})] }) : _jsxs("section", { className: css.empty, children: [_jsx("span", { className: css.emptyMark, "aria-hidden": true, children: "\u21B3" }), _jsx("h3", { children: t('workspace.emptyTitle') }), _jsx("p", { children: t('workspace.emptyBody') }), _jsx("button", { onClick: backToChat, children: t('workspace.back') })] }) : _jsx(_Fragment, { children: _jsx(TeamSection, { team: selected, workspace: true, historic: history, modelDirectory: selected.phase === 'staged' ? modelDirectories.directoryFor(sessionId) : undefined, onContinuePlanning: backToChat, onDiscarded: backToChat, onNavigate: openMember, t: t }, `${sessionId}:${selected.teamId}`) })] }) }));
}
