import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * AgentTeams activity panel: the top-right floater monitoring every team.
 *
 * Modeled on the Claude Code desktop SessionActivityPanel: a fixed glass
 * panel at the top-right corner. On wide viewports it cooperatively makes the
 * conversation column yield space; narrow viewports keep overlay mode. It
 * polls the host `/plugins/dsh-agent-teams/state` route for
 * server-side snapshots (durable files + live subagent activity), with a
 * collapsed badge that auto-expands once when activity appears and collapses
 * 2s after the last team disappears.
 *
 * The floater mounts through a body portal (no top-right slot exists in the
 * web shell); it is not a conversation node — the in-conversation panel was
 * removed in favor of this always-available monitor.
 * @module dsh-agent-teams/client/activity
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { IconBranchOutline16, IconChevronRightOutline14, IconCloseOutline16, StateDot, } from '@deepseek-ai/dsh-client-ui-primitives';
import { relatedTaskIds, taskStages } from "./activity-model.js";
import { ACTION_ART, LEAD_ART, memberArtUrl } from "./artwork.js";
import { OPEN_PANEL_EVENT } from "./AgentTeamsCard.js";
import css from './ActivityPanel.module.css';
/** Poll cadence for the host snapshot route. */
const POLL_MS = 1000;
/** Grace before the panel collapses once no team remains. */
const AUTOCLOSE_GRACE_MS = 2000;
/**
 * Page-settle window after mount: activity restored on page load only shows
 * the collapsed badge, so the panel never yanks the conversation column
 * right after load. New activity after this window auto-expands as usual.
 */
const AUTO_OPEN_SETTLE_MS = 4000;
/** Host route serving team snapshots. */
const STATE_URL = '/plugins/dsh-agent-teams/state';
/** Root marker shared with the panel CSS while the portal is expanded. */
const PANEL_OPEN_ATTRIBUTE = 'data-agent-teams-panel-open';
/** Initial-letter fallback for unmatched roles. */
function memberInitial(name) {
    return name.trim().slice(0, 1).toUpperCase() || '?';
}
function stableHash(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    }
    return Math.abs(hash);
}
const ACCENTS = [
    'var(--dsw-alias-state-business-primary)',
    'var(--dsw-alias-state-success)',
    'var(--dsw-alias-state-danger)',
    'var(--dsw-alias-state-warning)',
    'var(--dsw-alias-label-tertiary)',
];
function accentOf(id) {
    return ACCENTS[stableHash(id) % ACCENTS.length] ?? ACCENTS[0];
}
/** Badge text follows the raw task status (finer than the 4 visual states):
 * claimed/pending/failed/cancelled keep their own labels and colors. */
const TASK_STATUS_LABEL = {
    pending: '待领取',
    claimed: '已认领',
    in_progress: '进行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
};
function taskStatusLabel(status) {
    return TASK_STATUS_LABEL[status] ?? status;
}
/** Badge/bar coloring key: visual state, widened for terminal statuses. */
function taskTone(state, status) {
    if (status === 'failed')
        return 'failed';
    if (status === 'cancelled')
        return 'cancelled';
    return state;
}
/** Collapsed badge: an always-visible corner pill while any team exists. */
function CollapsedBadge({ count, busy, onClick }) {
    return (_jsxs("button", { type: "button", className: css.badge, "data-busy": busy, onClick: onClick, "aria-label": `AgentTeams 活动，${count} 个团队`, children: [_jsx("span", { className: css.badgeDot, "data-busy": busy, "aria-hidden": true }), _jsx("span", { className: css.badgeCount, children: count })] }));
}
function memberDotState(member, tasks) {
    const owned = tasks.filter((task) => task.assignee === member.name);
    if (member.activity === 'working')
        return 'ongoing';
    if (owned.some((task) => task.status === 'failed'))
        return 'error';
    if (owned.length > 0 && owned.every((task) => task.status === 'completed'))
        return 'done';
    return 'warning';
}
function memberStateLabel(member, tasks) {
    const owned = tasks.filter((task) => task.assignee === member.name);
    if (member.activity === 'working')
        return '工作中';
    if (owned.some((task) => task.status === 'failed'))
        return '有失败';
    if (owned.some((task) => task.state === 'blocked'))
        return '等待';
    if (owned.length > 0 && owned.every((task) => task.status === 'completed'))
        return '已交付';
    if (owned.length > 0)
        return '待执行';
    return '待派工';
}
function memberStatusText(member, tasks) {
    const owned = tasks.filter((task) => task.assignee === member.name);
    const current = owned.find((task) => task.id === member.currentTask);
    const blocked = owned.find((task) => task.state === 'blocked');
    if (member.activity === 'working' && current !== undefined)
        return `正在执行 ${current.id}`;
    if (member.activity === 'working')
        return '正在处理已派任务';
    if (blocked !== undefined) {
        const dependency = tasks.find((task) => blocked.dependencies.includes(task.id) && task.state !== 'completed');
        if (dependency !== undefined)
            return `等待 ${dependency.id} · ${dependency.assignee || '待认领'}`;
        return '等待前置任务';
    }
    if (member.total === 0)
        return '等待队长派工';
    if (member.done === member.total)
        return '任务已交付';
    return member.activity === 'idle' ? '待继续执行' : '状态未知';
}
function dependencyLabel(task, tasks) {
    return task.dependencies.map((id) => {
        const dependency = tasks.find((candidate) => candidate.id === id);
        return dependency?.assignee ? `${id}·${dependency.assignee}` : id;
    }).join('、');
}
function TaskNode({ task, tasks, focused, dimmed, pinned, onPin, onPreview }) {
    const tone = taskTone(task.state, task.status);
    return (_jsxs("button", { type: "button", className: css.taskNode, "data-task-id": task.id, "data-state": tone, "data-focused": focused, "data-dimmed": dimmed, "aria-pressed": pinned, title: `${task.id} · ${task.subject}（点击固定依赖链）`, onClick: () => { onPin(task.id); }, onMouseEnter: () => { onPreview(task.id); }, onMouseLeave: () => { onPreview(null); }, onFocus: () => { onPreview(task.id); }, onBlur: () => { onPreview(null); }, children: [_jsxs("span", { className: css.taskNodeHead, children: [_jsx("span", { className: css.taskId, children: task.id }), _jsx("span", { className: css.taskBadge, "data-state": tone, children: taskStatusLabel(task.status) })] }), _jsx("span", { className: css.taskSubject, children: task.subject }), _jsxs("span", { className: css.taskRoute, children: [_jsx("span", { className: css.taskOwner, children: task.assignee || '待认领' }), task.dependencies.length === 0
                        ? _jsx("span", { className: css.taskStart, children: "\u8D77\u70B9" })
                        : _jsxs("span", { className: css.taskDeps, children: ["\u4F9D\u8D56 ", dependencyLabel(task, tasks)] })] })] }));
}
function DependencyMap({ tasks }) {
    const [previewTaskId, setPreviewTaskId] = useState(null);
    const [pinnedTaskId, setPinnedTaskId] = useState(null);
    const focusedTaskId = pinnedTaskId ?? previewTaskId;
    const stages = useMemo(() => taskStages(tasks), [tasks]);
    const related = useMemo(() => focusedTaskId === null ? null : relatedTaskIds(focusedTaskId, tasks), [focusedTaskId, tasks]);
    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.key === 'Escape')
                setPinnedTaskId(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => { window.removeEventListener('keydown', onKeyDown); };
    }, []);
    if (tasks.length === 0)
        return null;
    return (_jsxs("section", { className: css.dependencySection, "aria-label": "\u4EFB\u52A1\u4F9D\u8D56\u94FE", "data-dependency-map": true, children: [_jsxs("header", { className: css.sectionHead, children: [_jsxs("span", { className: css.sectionTitle, children: [_jsx(IconBranchOutline16, {}), " \u4EFB\u52A1\u4F9D\u8D56"] }), _jsx("span", { className: css.sectionHint, children: pinnedTaskId === null ? '悬停预览 · 点击固定' : `${pinnedTaskId} 已固定 · Esc 取消` })] }), _jsx("div", { className: css.stageFlow, children: stages.map((stage, index) => (_jsxs("div", { className: css.stageGroup, "data-depth": stage.depth, children: [index > 0 && (_jsxs("span", { className: css.stageConnector, "aria-hidden": true, children: [_jsx("span", { className: css.stageLine }), _jsx(IconChevronRightOutline14, {})] })), _jsxs("div", { className: css.stageColumn, children: [_jsxs("span", { className: css.stageLabel, children: [stage.depth === 0 ? '起点' : `依赖层 ${stage.depth}`, _jsx("span", { children: stage.tasks.length })] }), _jsx("div", { className: css.stageTasks, children: stage.tasks.map((task) => (_jsx(TaskNode, { task: task, tasks: tasks, focused: related?.has(task.id) ?? false, dimmed: related !== null && !related.has(task.id), pinned: pinnedTaskId === task.id, onPin: (id) => { setPinnedTaskId((current) => current === id ? null : id); }, onPreview: setPreviewTaskId }, task.id))) })] })] }, stage.depth))) })] }));
}
function TeamSection({ team, onNavigate }) {
    const busyCount = team.members.filter((member) => member.activity === 'working').length;
    const assignedCount = team.tasks.filter((task) => task.assignee !== '').length;
    const completedCount = team.tasks.filter((task) => task.status === 'completed').length;
    const allCompleted = team.tasks.length > 0 && completedCount === team.tasks.length;
    const unclaimed = team.tasks.filter((task) => {
        if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')
            return false;
        if (task.assignee === '')
            return true;
        return !team.members.some((member) => member.name === task.assignee);
    });
    return (_jsxs("section", { className: css.team, "data-team-id": team.teamId, children: [_jsxs("header", { className: css.teamHead, children: [_jsx("span", { className: css.teamName, title: team.name, children: team.name }), _jsxs("span", { className: css.teamStats, children: [_jsxs("span", { "data-stat": "members", children: [team.members.length, " \u6210\u5458"] }), _jsxs("span", { "data-stat": "tasks", children: [completedCount, "/", team.tasks.length, " \u5B8C\u6210"] }), _jsxs("span", { "data-stat": "messages", children: [team.messageCount, " \u6D88\u606F"] })] })] }), _jsxs("section", { className: css.delegationSection, "aria-label": "\u961F\u957F\u6D3E\u5DE5\u5173\u7CFB", "data-delegation-map": true, children: [_jsxs("div", { className: css.captainNode, children: [_jsx("span", { className: css.captainAvatar, children: _jsx("img", { className: css.leadAvatar, src: LEAD_ART, alt: "", "aria-hidden": true }) }), _jsxs("span", { className: css.captainInfo, children: [_jsxs("span", { className: css.captainLine, children: [_jsx("span", { className: css.captainName, children: "\u961F\u957F" }), _jsx("span", { className: css.captainRole, children: "\u62C6\u89E3 \u00B7 \u6D3E\u53D1 \u00B7 \u6C47\u603B" })] }), _jsxs("span", { className: css.captainSummary, children: ["\u5DF2\u6D3E\u53D1 ", assignedCount, " \u9879\u4EFB\u52A1\u7ED9 ", team.members.length, " \u540D\u6210\u5458"] })] }), _jsxs("span", { className: css.captainState, "data-busy": busyCount > 0, children: [_jsx(StateDot, { state: busyCount > 0 ? 'ongoing' : allCompleted ? 'done' : 'warning' }), busyCount > 0 ? `${busyCount} 人执行中` : allCompleted ? '已收齐' : '等待回报'] })] }), _jsxs("div", { className: css.delegationTree, children: [team.members.length === 0 && _jsx("span", { className: css.emptyHint, children: "\u6682\u65E0\u6210\u5458\uFF0C\u7B49\u5F85\u961F\u957F\u7EC4\u5EFA\u56E2\u961F" }), team.members.map((member) => {
                                const owned = team.tasks.filter((task) => task.assignee === member.name);
                                return (_jsxs("div", { className: css.memberBlock, "data-activity": member.activity, children: [_jsx("span", { className: css.memberBranch, "aria-hidden": true, children: _jsx("span", {}) }), _jsxs("button", { type: "button", className: css.memberRow, "data-activity": member.activity, onClick: () => { if (member.id !== '')
                                                onNavigate(member.id); }, children: [_jsxs("span", { className: css.memberAvatar, "data-unread": member.unread > 0, children: [memberArtUrl(member.name, member.role) !== null ? (_jsx("img", { className: css.memberArt, src: memberArtUrl(member.name, member.role) ?? '', alt: "", "aria-hidden": true })) : (_jsx("span", { className: css.memberInitial, style: { background: accentOf(member.id) }, children: memberInitial(member.name) })), _jsx("img", { className: css.stateArt, "data-activity": member.activity, src: ACTION_ART[member.activity], alt: "", "aria-hidden": true })] }), _jsxs("span", { className: css.memberInfo, children: [_jsxs("span", { className: css.memberLine, children: [_jsx("span", { className: css.memberName, children: member.name }), member.role !== '' && _jsx("span", { className: css.memberRole, children: member.role }), _jsxs("span", { className: css.memberState, "data-activity": member.activity, children: [_jsx(StateDot, { state: memberDotState(member, team.tasks) }), memberStateLabel(member, team.tasks)] })] }), _jsx("span", { className: css.memberStatusLine, children: memberStatusText(member, team.tasks) })] }), _jsxs("span", { className: css.memberCount, children: [member.done, "/", member.total] })] }), _jsxs("div", { className: css.assignmentLine, children: [_jsx("span", { className: css.assignmentLabel, children: "\u961F\u957F\u6D3E\u53D1" }), _jsx("span", { className: css.assignmentTasks, children: owned.length === 0
                                                        ? _jsx("span", { className: css.taskEmpty, children: "\u6682\u65E0\u4EFB\u52A1" })
                                                        : owned.map((task) => (_jsx("span", { className: css.assignmentChip, "data-state": taskTone(task.state, task.status), title: task.subject, children: task.id }, task.id))) }), member.unread > 0 && _jsxs("span", { className: css.unreadPill, children: [member.unread, " \u6761\u6D88\u606F"] })] })] }, member.id));
                            })] })] }), _jsx(DependencyMap, { tasks: team.tasks }), unclaimed.length > 0 && (_jsxs("section", { className: css.unclaimed, "aria-label": "\u5F85\u8BA4\u9886\u4EFB\u52A1", children: [_jsx("span", { className: css.unclaimedTitle, children: "\u5F85\u961F\u957F\u8BA4\u9886\u6216\u6539\u6D3E" }), _jsx("span", { className: css.assignmentTasks, children: unclaimed.map((task) => (_jsxs("span", { className: css.assignmentChip, "data-state": taskTone(task.state, task.status), title: task.subject, children: [task.id, " \u00B7 ", task.assignee || '未分配'] }, task.id))) })] })), team.captainInbox.length > 0 && (_jsxs("section", { className: css.inbox, "aria-label": "\u6210\u5458\u56DE\u62A5\u961F\u957F", children: [_jsxs("header", { className: css.sectionHead, children: [_jsx("span", { className: css.sectionTitle, children: "\u6210\u5458\u56DE\u62A5" }), _jsx("span", { className: css.sectionHint, children: "\u6D41\u5411\u961F\u957F" })] }), team.captainInbox.slice(-2).map((message, index) => (_jsxs("div", { className: css.inboxRow, children: [_jsxs("span", { className: css.inboxRoute, children: [message.from, _jsx(IconChevronRightOutline14, {}), "\u961F\u957F"] }), _jsx("span", { className: css.inboxContent, title: message.content, children: message.content })] }, index)))] }))] }));
}
/** The top-right activity floater. Teams follow the current session: live
 * snapshots and historic card summaries are only shown while their captain
 * session is the one currently open. */
export function ActivityPanel({ sessionsList, openSession }) {
    // Navigating to a member's subagent transcript is an explicit departure:
    // hide the floater immediately instead of waiting out the autocollapse
    // grace, so the panel never lingers over the member session.
    const navigateToSession = (id) => {
        setOpen(false);
        setWasActive(false);
        openSession(id);
    };
    const [teams, setTeams] = useState([]);
    const [open, setOpen] = useState(false);
    const [autoOpened, setAutoOpened] = useState(false);
    const [wasActive, setWasActive] = useState(false);
    const [historic, setHistoric] = useState(new Map());
    const [archived, setArchived] = useState(new Map());
    const current = useSyncExternalStore(sessionsList.subscribe, sessionsList.getSnapshot).current;
    const currentRef = useRef(current);
    useEffect(() => { currentRef.current = current; }, [current]);
    const mountedAtRef = useRef(performance.now());
    // The activity panel is a body portal, so announce its open state on body.
    // CSS can then make the conversation column yield space without knowing the
    // host shell's hashed module class names. Narrow viewports keep overlay mode.
    useEffect(() => {
        const root = document.documentElement;
        if (open)
            root.setAttribute(PANEL_OPEN_ATTRIBUTE, '');
        else
            root.removeAttribute(PANEL_OPEN_ATTRIBUTE);
        return () => { root.removeAttribute(PANEL_OPEN_ATTRIBUTE); };
    }, [open]);
    useEffect(() => {
        let cancelled = false;
        let inFlight = false;
        const tick = async () => {
            if (inFlight || cancelled)
                return;
            inFlight = true;
            try {
                const response = await fetch(STATE_URL, { cache: 'no-store' });
                if (!response.ok)
                    return;
                const body = (await response.json());
                if (!cancelled && Array.isArray(body.teams))
                    setTeams(body.teams);
            }
            catch {
                // Host restarting; keep the last snapshot.
            }
            finally {
                inFlight = false;
            }
        };
        void tick();
        const timer = setInterval(() => { void tick(); }, POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, []);
    useEffect(() => {
        let cancelled = false;
        const onOpenPanel = (event) => {
            setOpen(true);
            const detail = event.detail;
            if (detail?.teamId !== undefined) {
                // A card from a log that predates captainSessionId belongs to the
                // session that activated it (the current one at injection time).
                const owner = detail.captainSessionId !== '' ? detail.captainSessionId : currentRef.current ?? '';
                const teamKey = `${owner}:${detail.teamId}`;
                setHistoric((previous) => {
                    const next = new Map(previous);
                    next.set(teamKey, { data: detail, owner });
                    return next;
                });
                // Restore the archived team detail (tasks with their dependency
                // graph, members, mailboxes) so the panel shows the full planning.
                void fetch(`${STATE_URL}?archived=1`, { cache: 'no-store' })
                    .then((response) => (response.ok ? response.json() : null))
                    .then((body) => {
                    if (cancelled || body === null || !Array.isArray(body.teams))
                        return;
                    const found = body.teams.find((team) => team.teamId === detail?.teamId && team.captainSessionId === owner);
                    if (found !== undefined) {
                        setArchived((previous) => {
                            const next = new Map(previous);
                            next.set(teamKey, found);
                            return next;
                        });
                    }
                })
                    .catch(() => { });
            }
        };
        window.addEventListener(OPEN_PANEL_EVENT, onOpenPanel);
        return () => {
            cancelled = true;
            window.removeEventListener(OPEN_PANEL_EVENT, onOpenPanel);
        };
    }, []);
    // Teams follow the current session: live snapshots and historic card
    // summaries are visible only while their captain session is current.
    const visibleTeams = useMemo(
    // No current session (initial load): show nothing until one is picked,
    // so cross-session teams never leak into the floater.
    () => (current === undefined ? [] : teams.filter((team) => team.captainSessionId === current)), [teams, current]);
    const visibleHistoric = useMemo(() => (current === undefined ? [] : [...historic.values()].filter(({ data, owner }) => owner === current && !teams.some((live) => live.captainSessionId === current && live.teamId === data.teamId))), [historic, current, teams]);
    const visibleCount = visibleTeams.length + visibleHistoric.length;
    useEffect(() => {
        if (visibleCount > 0) {
            setWasActive(true);
            // Auto-expand only after the page-settle window: opening (and its
            // main-column yield) right after load reads as a whole-page flicker.
            const settled = performance.now() - mountedAtRef.current >= AUTO_OPEN_SETTLE_MS;
            if (!autoOpened && settled) {
                setOpen(true);
                setAutoOpened(true);
            }
            return;
        }
        if (!wasActive)
            return;
        const timer = setTimeout(() => {
            setOpen(false);
            setWasActive(false);
            // Re-arm auto-expand: a later activity (new team, new session) may
            // open the panel on its own again.
            setAutoOpened(false);
        }, AUTOCLOSE_GRACE_MS);
        return () => { clearTimeout(timer); };
    }, [visibleCount, autoOpened, wasActive]);
    const busy = useMemo(() => visibleTeams.some((team) => team.members.some((member) => member.activity === 'working')), [visibleTeams]);
    const hasTeams = visibleCount > 0;
    if (!hasTeams && !open)
        return null;
    return (_jsxs(_Fragment, { children: [!open && (_jsx(CollapsedBadge, { count: visibleCount, busy: busy, onClick: () => { setOpen(true); } })), open && (_jsxs("aside", { className: css.panel, "data-agent-teams-activity": true, children: [_jsxs("header", { className: css.panelHead, children: [_jsxs("span", { className: css.panelTitle, children: ["AgentTeams \u6D3B\u52A8", _jsx("span", { className: css.panelDot, "data-busy": busy, "aria-hidden": true })] }), _jsx("button", { type: "button", className: css.closeButton, onClick: () => { setOpen(false); }, "aria-label": "\u5173\u95ED", children: _jsx(IconCloseOutline16, {}) })] }), _jsx("div", { className: css.teams, children: visibleCount === 0
                            ? _jsx("span", { className: css.emptyHint, children: "\u6682\u65E0\u56E2\u961F\u6D3B\u52A8" })
                            : (_jsxs(_Fragment, { children: [visibleTeams.map((team) => (_jsx(TeamSection, { team: team, onNavigate: navigateToSession }, team.teamId))), visibleHistoric.map(({ data: team, owner }) => {
                                        const teamKey = `${owner}:${team.teamId}`;
                                        const archivedTeam = archived.get(teamKey);
                                        if (archivedTeam !== undefined) {
                                            return (_jsx("div", { "data-team-id": team.teamId, "data-historic": true, className: css.archivedWrap, children: _jsx(TeamSection, { team: archivedTeam, onNavigate: navigateToSession }) }, teamKey));
                                        }
                                        return (_jsxs("section", { className: css.team, "data-team-id": team.teamId, "data-historic": true, children: [_jsxs("header", { className: css.teamHead, children: [_jsxs("span", { className: css.teamName, title: team.teamName, children: [_jsx("img", { className: css.leadAvatar, src: LEAD_ART, alt: "", "aria-hidden": true }), " ", team.teamName] }), _jsx("span", { className: css.historicPill, children: "\u5DF2\u7ED3\u675F" })] }), _jsx("div", { className: css.members, children: team.members.map((member) => (_jsxs("button", { type: "button", className: css.memberRow, "data-activity": "idle", onClick: () => { if (member.id !== '')
                                                            navigateToSession(member.id); }, children: [_jsx("span", { className: css.memberAvatar, children: memberArtUrl(member.name, member.role) !== null ? (_jsx("img", { className: css.memberArt, src: memberArtUrl(member.name, member.role) ?? '', alt: "", "aria-hidden": true })) : (_jsx("span", { className: css.memberInitial, style: { background: accentOf(member.id) }, children: memberInitial(member.name) })) }), _jsx("span", { className: css.memberInfo, children: _jsxs("span", { className: css.memberLine, children: [_jsx("span", { className: css.memberName, children: member.name }), member.role !== '' && _jsx("span", { className: css.memberRole, children: member.role })] }) })] }, member.id))) })] }, teamKey));
                                    })] })) })] }))] }));
}
