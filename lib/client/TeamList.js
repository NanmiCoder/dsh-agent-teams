import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import css from './TeamConsole.module.css';
/** Display a workspace title without conflating an empty title with "all". */
export function consoleWorkspaceLabel(workspace, t) {
    return workspace.trim() === '' ? t('console.unknownWorkspace') : workspace;
}
function teamStatusLabel(row, t) {
    if (row.historic)
        return t('console.history');
    if (row.team.halted === true)
        return t('console.halted');
    if (row.team.phase === 'staged')
        return t('console.planning');
    return t('console.running');
}
function statusTone(row) {
    if (row.historic)
        return 'history';
    if (row.team.halted === true)
        return 'halted';
    if (row.team.phase === 'staged')
        return 'planning';
    return 'running';
}
function completedTasks(row) {
    return row.team.tasks.filter((task) => task.status === 'completed').length;
}
/** Group rows by workspace while retaining the host's live-then-archive order. */
export function groupConsoleRows(rows) {
    const groups = new Map();
    for (const row of rows) {
        const group = groups.get(row.team.workspace);
        if (group === undefined)
            groups.set(row.team.workspace, [row]);
        else
            group.push(row);
    }
    return [...groups].map(([workspace, group]) => ({ workspace, rows: group }));
}
export function WorkspaceFilter({ workspaces, counts, total, value, onChange, t }) {
    if (workspaces.length <= 1)
        return null;
    return (_jsxs("section", { className: css.filterSection, "aria-label": t('console.workspaces'), children: [_jsx("h2", { children: t('console.workspaces') }), _jsxs("div", { className: css.filterList, "data-console-workspace-filter": true, children: [_jsxs("button", { type: "button", "aria-pressed": value === null, onClick: () => { onChange(null); }, children: [_jsx("span", { children: t('console.allWorkspaces') }), _jsx("span", { className: css.filterCount, children: total })] }), workspaces.map((workspace) => (_jsxs("button", { type: "button", "aria-pressed": value === workspace, "data-workspace": workspace, onClick: () => { onChange(workspace); }, children: [_jsx("span", { children: consoleWorkspaceLabel(workspace, t) }), _jsx("span", { className: css.filterCount, children: counts.get(workspace) ?? 0 })] }, workspace)))] })] }));
}
export function TeamList({ rows, selectedKey, onSelect, t }) {
    return (_jsx("div", { className: css.teamGroups, "data-console-team-list": true, children: groupConsoleRows(rows).map((group) => (_jsxs("section", { className: css.teamGroup, "data-workspace": group.workspace, children: [_jsxs("header", { className: css.teamGroupHead, children: [_jsx("h2", { children: consoleWorkspaceLabel(group.workspace, t) }), _jsx("span", { children: t('console.teamCount', { count: group.rows.length }) })] }), _jsx("div", { className: css.teamList, children: group.rows.map((row) => {
                        const selected = row.key === selectedKey;
                        const total = row.team.tasks.length;
                        return (_jsxs("button", { type: "button", className: css.teamRow, "aria-pressed": selected, "data-console-team-key": row.key, "data-console-team-state": statusTone(row), title: row.team.name, onClick: () => { onSelect(row.key); }, children: [_jsxs("span", { className: css.teamRowTop, children: [_jsx("span", { className: css.teamName, children: row.team.name }), _jsx("span", { className: css.teamBadge, "data-tone": statusTone(row), children: teamStatusLabel(row, t) })] }), _jsxs("span", { className: css.teamMeta, children: [_jsx("span", { children: t('console.members', { count: row.team.members.length }) }), _jsx("span", { children: t('console.progress', { completed: completedTasks(row), total }) })] })] }, row.key));
                    }) })] }, group.workspace))) }));
}
