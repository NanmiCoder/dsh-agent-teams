import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Global, read-only AgentTeams console registered as a main panel. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { TeamSection } from "./ActivityPanel.js";
import { TeamList, WorkspaceFilter, consoleWorkspaceLabel } from "./TeamList.js";
import { IconPanelLeftOutline16, IconWarningOutline16 } from "./icons.js";
import { LEAD_ART } from "./artwork.js";
import { startConsolePolling } from "./team-console-state.js";
import css from './TeamConsole.module.css';
/** Sidebar list id and main-panel key; they must stay identical. */
export const CONSOLE_PANEL_ID = 'agent-teams-console';
function ConsoleEmpty({ mark, title, body, action }) {
    return (_jsxs("section", { className: css.empty, "data-console-empty": true, children: [_jsx("span", { className: css.emptyMark, "aria-hidden": true, children: mark }), _jsx("h2", { children: title }), _jsx("p", { children: body }), action !== undefined && _jsx("button", { type: "button", onClick: action.run, children: action.label })] }));
}
function ConsoleLoading({ t }) {
    return (_jsxs("div", { className: css.skeleton, role: "status", "aria-label": t('console.loading'), children: [_jsx("i", {}), _jsx("i", {}), _jsx("i", {})] }));
}
/**
 * The console view. Polling is owned by this mounted panel only: it starts
 * while the main key is selected and the document is visible, and every
 * controller is stopped on cleanup, panel switch, or unmount.
 */
export function TeamConsole({ state, openMember, navigation, usePanelInfo, t }) {
    const active = usePanelInfo((info) => info.activePanelId === CONSOLE_PANEL_ID);
    const snapshot = useSyncExternalStore(state.subscribe, state.getSnapshot);
    const [retry, setRetry] = useState(0);
    const [pageVisible, setPageVisible] = useState(() => (typeof document === 'undefined' || document.visibilityState !== 'hidden'));
    useEffect(() => {
        if (typeof document === 'undefined')
            return;
        const onChange = () => { setPageVisible(document.visibilityState !== 'hidden'); };
        document.addEventListener('visibilitychange', onChange);
        return () => { document.removeEventListener('visibilitychange', onChange); };
    }, []);
    useEffect(() => {
        if (!active || !pageVisible)
            return;
        state.begin();
        const controller = startConsolePolling({
            onStatus: (status) => { state.status(status); },
            publish: (update) => { state.apply(update); },
            getRows: state.getRows,
        });
        return () => { controller.stop(); };
    }, [active, pageVisible, retry, state]);
    // Selecting the console is itself a completed return; do not keep a stale
    // "back" button on an unrelated member transcript later.
    useEffect(() => {
        if (active)
            navigation.clear();
    }, [active, navigation]);
    const counts = new Map();
    for (const row of snapshot.rows) {
        counts.set(row.team.workspace, (counts.get(row.team.workspace) ?? 0) + 1);
    }
    const visibleRows = snapshot.workspaceFilter === null
        ? snapshot.rows
        : snapshot.rows.filter((row) => row.team.workspace === snapshot.workspaceFilter);
    const selected = visibleRows.find((row) => row.key === snapshot.selectedKey);
    const statusLabel = snapshot.status === 'loading'
        ? t('console.loading')
        : snapshot.status === 'error'
            ? t('console.offline')
            : t('console.live');
    return (_jsxs("div", { className: css.root, "data-agent-teams-console": true, "data-console-status": snapshot.status, "data-console-active": active || undefined, children: [_jsxs("header", { className: css.head, children: [_jsxs("div", { className: css.heading, children: [_jsx("img", { src: LEAD_ART, alt: "", "aria-hidden": true }), _jsxs("div", { children: [_jsx("span", { className: css.eyebrow, children: t('console.eyebrow') }), _jsx("h1", { children: t('console.title') }), _jsx("p", { children: t('console.subtitle') })] })] }), _jsxs("span", { className: css.connection, "data-status": snapshot.status, children: [_jsx("i", { "aria-hidden": true }), statusLabel] })] }), snapshot.status === 'error' && (_jsxs("div", { className: css.error, role: "alert", "data-console-error": true, children: [_jsx(IconWarningOutline16, {}), _jsx("span", { children: t('console.error') }), _jsx("button", { type: "button", onClick: () => { setRetry((value) => value + 1); }, children: t('console.retry') })] })), _jsxs("div", { className: css.body, children: [_jsxs("aside", { className: css.rail, children: [_jsx(WorkspaceFilter, { workspaces: snapshot.workspaces, counts: counts, total: snapshot.rows.length, value: snapshot.workspaceFilter, onChange: (workspace) => { state.setWorkspaceFilter(workspace); }, t: t }), visibleRows.length > 0 && (_jsx(TeamList, { rows: visibleRows, selectedKey: snapshot.selectedKey, onSelect: (key) => { state.selectTeam(key); }, t: t }))] }), _jsxs("main", { className: css.detail, children: [snapshot.rows.length === 0 && snapshot.status === 'loading' && _jsx(ConsoleLoading, { t: t }), snapshot.rows.length === 0 && snapshot.status === 'error' && (_jsx(ConsoleEmpty, { mark: "!", title: t('console.errorTitle'), body: t('console.errorBody'), action: { label: t('console.retry'), run: () => { setRetry((value) => value + 1); } } })), snapshot.rows.length === 0 && snapshot.status === 'ready' && (_jsx(ConsoleEmpty, { mark: "\u21B3", title: t('console.emptyTitle'), body: t('console.emptyBody') })), snapshot.rows.length > 0 && visibleRows.length === 0 && (_jsx(ConsoleEmpty, { mark: "\u2315", title: t('console.emptyWorkspaceTitle'), body: t('console.emptyWorkspaceBody'), action: { label: t('console.showAll'), run: () => { state.setWorkspaceFilter(null); } } })), selected !== undefined && (_jsxs("section", { className: css.detailSection, "data-console-detail": true, children: [_jsxs("header", { className: css.detailHead, children: [_jsx("span", { children: consoleWorkspaceLabel(selected.team.workspace, t) }), _jsx("span", { children: t('console.readOnly') })] }), _jsx(TeamSection, { team: selected.team, workspace: true, historic: selected.historic, readOnly: true, onNavigate: (parentId, childId) => { openMember(parentId, childId, selected.key); }, t: t }, selected.key)] }))] })] })] }));
}
/** Header action shown only on the member transcript opened from the console. */
export function ConsoleReturnButton({ sessionId, navigation, openConsole, t }) {
    const target = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
    if (target === undefined || target.memberSessionId !== sessionId)
        return null;
    return (_jsxs("button", { type: "button", className: css.returnButton, "data-console-return": true, title: t('console.returnHint'), onClick: () => {
            if (openConsole(target.panelId))
                navigation.clear();
        }, children: [_jsx(IconPanelLeftOutline16, {}), t('console.return')] }));
}
