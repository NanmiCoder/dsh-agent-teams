/**
 * AgentTeams activity panel: the top-right floater monitoring every team.
 *
 * Modeled on the Claude Code desktop SessionActivityPanel: a fixed glass
 * panel at the top-right corner. On wide viewports it cooperatively makes the
 * conversation column yield space; narrow viewports keep overlay mode. It
 * polls the host `/plugins/dsh-agent-teams/state` route for
 * server-side snapshots (durable files + live subagent activity), with a
 * collapsed badge that auto-expands once when activity appears. Archived
 * teams stay available for the owning conversation after live work ends.
 *
 * The floater mounts through a body portal (no top-right slot exists in the
 * web shell); it is not a conversation node — the in-conversation panel was
 * removed in favor of this always-available monitor.
 * @module dsh-agent-teams/client/activity
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  IconBranchOutline16, IconCloseOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ObservableSnapshot, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import {
  activityPanelExpandedForSession,
  compactDagLayout,
  COMPACT_DAG_NODE_HEIGHT,
  COMPACT_DAG_NODE_WIDTH,
  dependencyFocusTaskId,
  relatedTaskIds,
  usesParallelTaskGrid,
} from './activity-model.ts'
import {
  getActivityMonitorTargetsSnapshot,
  getActivitySnapshotsSnapshot,
  startActivityPolling,
  subscribeActivityMonitorTargets,
  subscribeActivitySnapshots,
  type ActivityMember,
  type ActivityTask,
  type ActivityTeam,
} from './activity-monitor.ts'
import { ACTION_ART, LEAD_ART, memberArtUrl } from './artwork.ts'
import { OPEN_PANEL_EVENT } from './AgentTeamsCard.tsx'
import type { AgentTeamsCardData } from './agent-teams-card-definition.ts'
import css from './ActivityPanel.module.css'

/** Grace before the panel collapses once no team remains. */
const AUTOCLOSE_GRACE_MS = 2000
/**
 * Page-settle window after mount: activity restored on page load only shows
 * the collapsed badge, so the panel never yanks the conversation column
 * right after load. New activity after this window auto-expands as usual.
 */
const AUTO_OPEN_SETTLE_MS = 4000
/** Root marker shared with the panel CSS while the portal is expanded. */
const PANEL_OPEN_ATTRIBUTE = 'data-agent-teams-panel-open'

/** Initial-letter fallback for unmatched roles. */
function memberInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?'
}

function stableHash(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

const ACCENTS = [
  'var(--dsw-alias-state-business-primary)',
  'var(--dsw-alias-state-success)',
  'var(--dsw-alias-state-danger)',
  'var(--dsw-alias-state-warning)',
  'var(--dsw-alias-label-tertiary)',
] as const

function accentOf(id: string): string {
  return ACCENTS[stableHash(id) % ACCENTS.length] ?? ACCENTS[0]
}

/** Badge text follows the raw task status (finer than the 4 visual states):
 * claimed/pending/failed/cancelled keep their own labels and colors. */
const TASK_STATUS_LABEL: Record<string, string> = {
  pending: 'Available',
  claimed: 'Claimed',
  in_progress: 'In progress',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

function taskStatusLabel(status: string): string {
  return TASK_STATUS_LABEL[status] ?? status
}

/** Badge/bar coloring key: visual state, widened for terminal statuses. */
function taskTone(state: ActivityTask['state'], status: string): string {
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return state
}

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg className={css.chevron} data-open={open} width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M3.5 2l3 3-3 3" />
    </svg>
  )
}

function WorkGlyph({ active }: { readonly active: boolean }) {
  return (
    <svg className={css.workGlyph} data-active={active} width="11" height="11" viewBox="0 0 11 11" fill="currentColor" aria-hidden>
      {[[0, 0], [4.2, 0], [8.4, 0], [0, 4.2], [4.2, 4.2], [8.4, 4.2]].map(([x, y], index) => (
        <rect key={`${x}:${y}`} x={x} y={y} width="2.6" height="2.6" rx=".6" style={{ animationDelay: `${index * 0.15}s` }} />
      ))}
    </svg>
  )
}

/** Collapsed badge: an always-visible corner pill while any team exists. */
function CollapsedBadge({ count, busy, onClick }: {
  readonly count: number
  readonly busy: boolean
  readonly onClick: () => void
}) {
  return (
    <button type="button" className={css.badge} data-busy={busy} onClick={onClick} aria-label={`AgentTeams activity, ${count} team${count === 1 ? '' : 's'}`}>
      <span className={css.badgeDot} data-busy={busy} aria-hidden />
      <span className={css.badgeCount}>{count}</span>
    </button>
  )
}

function memberStateLabel(member: ActivityMember, tasks: readonly ActivityTask[], historic: boolean): string {
  const owned = tasks.filter((task) => task.assignee === member.name)
  if (member.activity === 'working') return 'Working'
  if (owned.some((task) => task.status === 'failed')) return 'Has failures'
  if (owned.some((task) => task.state === 'blocked')) return 'Waiting'
  if (owned.length > 0 && owned.every((task) => task.status === 'completed')) return 'Delivered'
  if (member.status === 'removed') return historic ? 'Left team' : 'Removed'
  if (owned.length > 0) return 'Pending'
  return 'Unassigned'
}

function memberStatusText(member: ActivityMember, tasks: readonly ActivityTask[]): string {
  const owned = tasks.filter((task) => task.assignee === member.name)
  const current = owned.find((task) => task.id === member.currentTask)
  const blocked = owned.find((task) => task.state === 'blocked')
  if (member.activity === 'working' && current !== undefined) return `Working on ${current.id}`
  if (member.activity === 'working') return 'Processing assigned tasks'
  if (blocked !== undefined) {
    const dependency = tasks.find((task) => blocked.dependencies.includes(task.id) && task.state !== 'completed')
    if (dependency !== undefined) return `Waiting on ${dependency.id} · ${dependency.assignee || 'unclaimed'}`
    return 'Waiting on prerequisites'
  }
  if (member.total === 0) return 'Waiting for captain'
  if (member.done === member.total) return 'Tasks delivered'
  return member.activity === 'idle' ? 'Ready to continue' : 'Status unknown'
}

function compactTaskLabel(subject: string): string {
  const withoutVerb = subject.replace(/^\s*/u, '').replace(/^\d+[-_.、\s]*/u, '')
  const head = withoutVerb.split(/[（(·：:]/u)[0]?.trim() ?? withoutVerb
  return head.length > 18 ? `${head.slice(0, 17)}…` : head
}

function taskSummary(team: ActivityTeam): string {
  const completed = team.tasks.filter((task) => task.status === 'completed')
  const running = team.tasks.filter((task) => task.state === 'running')
  const blocked = team.tasks.filter((task) => task.state === 'blocked')
  const ready = team.tasks.filter((task) => task.state === 'open' && task.status !== 'completed')
  if (team.tasks.length === 0) return 'Waiting for the captain to break down tasks'
  if (completed.length === team.tasks.length) return `All ${completed.length} tasks delivered`
  if (blocked.length > 0 && running.length > 0) {
    return `${blocked.slice(0, 3).map((task) => task.id).join(', ')}${blocked.length > 3 ? ` +${blocked.length - 3} more` : ''} waiting on prerequisites, others in progress`
  }
  if (running.length > 0) return `${running.map((task) => task.id).join(', ')} in progress`
  if (ready.length > 0) return `${ready.map((task) => task.id).join(', ')} ready to start`
  if (blocked.length > 0) return `${blocked.map((task) => task.id).join(', ')} waiting on prerequisites`
  return 'Waiting for next scheduling round'
}

function ProgressOverview({ team }: { readonly team: ActivityTeam }) {
  const running = team.tasks.filter((task) => task.state === 'running').length
  const blocked = team.tasks.filter((task) => task.state === 'blocked').length
  const completed = team.tasks.filter((task) => task.status === 'completed').length
  const summaryTone = blocked > 0 ? 'warning' : completed === team.tasks.length && team.tasks.length > 0 ? 'completed' : 'running'
  return (
    <section className={css.progressOverview} aria-label="Team overall progress" data-progress-summary>
      <span className={css.progressTitle}>Overall progress</span>
      {team.tasks.length > 0 ? (
        <span className={css.progressSegments} aria-hidden>
          {team.tasks.map((task) => <span key={task.id} data-state={taskTone(task.state, task.status)} />)}
        </span>
      ) : <span className={css.progressEmpty} />}
      <span className={css.progressLegend}>
        <span data-state="running">■ In progress {running}</span>
        <span data-state="blocked">■ Waiting on dependencies {blocked}</span>
        <span data-state="completed">■ Delivered {completed}</span>
      </span>
      <span className={css.progressSummary} data-state={summaryTone}>
        <span className={css.progressSummaryDot} />
        <span>{taskSummary(team)}</span>
      </span>
    </section>
  )
}

function DependencyMap({ tasks }: { readonly tasks: readonly ActivityTask[] }) {
  const [open, setOpen] = useState(true)
  const [hoverTaskId, setHoverTaskId] = useState<string | null>(null)
  const [keyboardTaskId, setKeyboardTaskId] = useState<string | null>(null)
  const [pinnedTaskId, setPinnedTaskId] = useState<string | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusedTaskId = dependencyFocusTaskId(pinnedTaskId, keyboardTaskId, hoverTaskId)
  const layout = useMemo(() => compactDagLayout(tasks), [tasks])
  const parallel = useMemo(() => usesParallelTaskGrid(tasks), [tasks])
  const related = useMemo(
    () => focusedTaskId === null ? null : relatedTaskIds(focusedTaskId, tasks),
    [focusedTaskId, tasks],
  )
  const scheduleHover = (id: string | null): void => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    if (id === null) {
      setHoverTaskId(null)
      return
    }
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null
      setHoverTaskId(id)
    }, 180)
  }
  useEffect(() => () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current)
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPinnedTaskId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [])
  if (tasks.length === 0) return null
  const fallbackTask = tasks.find((task) => task.state === 'blocked')
    ?? tasks.find((task) => task.state === 'running')
    ?? tasks[0]!
  const detailTask = tasks.find((task) => task.id === focusedTaskId) ?? fallbackTask
  const waitingOn = detailTask.dependencies.filter((dependency) => (
    tasks.find((task) => task.id === dependency)?.status !== 'completed'
  ))
  const dependents = tasks.filter((task) => task.dependencies.includes(detailTask.id))
  return (
    <section className={css.dependencySection} aria-label="Task dependency chain" data-dependency-map>
      <header className={css.sectionHead}>
        <button type="button" className={css.sectionToggleTitle} onClick={() => { setOpen((current) => !current) }} aria-expanded={open}>
          <Chevron open={open} /><IconBranchOutline16 /> {parallel ? 'Parallel tasks' : 'Task dependencies'}
        </button>
        <span className={css.sectionHint}>{pinnedTaskId === null
          ? parallel ? 'No ordering · click a task for details' : 'Hover to highlight the dependency chain · click to pin'
          : `${pinnedTaskId} pinned · Esc to unpin`}</span>
      </header>
      {open && (
        <>
          <div className={css.dagViewport}>
            <div
              className={css.dagCanvas}
              data-layout={parallel ? 'parallel' : 'dependency'}
              style={parallel ? undefined : { width: layout.width, height: layout.height }}
            >
              {!parallel && <svg className={css.dagEdges} width={layout.width} height={layout.height} aria-hidden>
                {layout.edges.map((edge) => {
                  const active = related !== null && related.has(edge.from) && related.has(edge.to)
                  return <path key={`${edge.from}:${edge.to}`} d={edge.path} data-active={active} data-dimmed={related !== null && !active} />
                })}
              </svg>}
              {layout.nodes.map(({ task, x, y }) => (
                <button
                  key={task.id}
                  type="button"
                  className={css.dagNode}
                  style={parallel
                    ? { height: COMPACT_DAG_NODE_HEIGHT }
                    : { left: x, top: y, width: COMPACT_DAG_NODE_WIDTH, height: COMPACT_DAG_NODE_HEIGHT }}
                  data-task-id={task.id}
                  data-state={taskTone(task.state, task.status)}
                  data-focused={related?.has(task.id) ?? false}
                  data-dimmed={related !== null && !related.has(task.id)}
                  aria-pressed={pinnedTaskId === task.id}
                  title={`${task.id} · ${task.subject}`}
                  onClick={() => { setPinnedTaskId((current) => current === task.id ? null : task.id) }}
                  onMouseEnter={() => { scheduleHover(task.id) }}
                  onMouseLeave={() => { scheduleHover(null) }}
                  onFocus={() => { setKeyboardTaskId(task.id) }}
                  onBlur={() => { setKeyboardTaskId(null) }}
                >
                  <span className={css.dagNodeHead}><span className={css.dagNodeDot} />{task.id}</span>
                  <span className={css.dagNodeLabel}>{compactTaskLabel(task.subject)}</span>
                  {task.state === 'running' && (
                    <span className={css.dagRunningState} aria-label="Running">
                      <WorkGlyph active />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <section className={css.taskDetail} data-task-detail={detailTask.id}>
            <span className={css.taskDetailHead}>
              <span className={css.taskDetailId}>{detailTask.id}</span>
              <span className={css.taskDetailSubject} title={detailTask.subject}>{detailTask.subject}</span>
              <span className={css.taskDetailBadge} data-state={taskTone(detailTask.state, detailTask.status)}>{taskStatusLabel(detailTask.status)}</span>
            </span>
            <span className={css.taskDetailLine}>
              {detailTask.assignee || 'Unclaimed'} · {detailTask.status === 'completed'
                ? 'Completed and delivered'
                : detailTask.dependencies.length === 0
                ? 'No prerequisites, can start immediately'
                : waitingOn.length === 0
                  ? 'Prerequisites ready, can start'
                  : `Waiting on ${waitingOn.join(', ')}`}
            </span>
            <span className={css.taskDetailMeta}>{dependents.length === 0 ? 'No downstream tasks' : `Completing unlocks ${dependents.map((task) => task.id).join(', ')}`}</span>
          </section>
        </>
      )}
    </section>
  )
}

function TeamSection({ team, onNavigate, historic = false }: {
  readonly team: ActivityTeam
  /** Navigate to a member transcript (floater hides immediately). */
  readonly onNavigate: (id: SessionId) => void
  readonly historic?: boolean
}) {
  const [membersOpen, setMembersOpen] = useState(true)
  const busyCount = team.members.filter((member) => member.activity === 'working').length
  const assignedCount = team.tasks.filter((task) => task.assignee !== '').length
  const completedCount = team.tasks.filter((task) => task.status === 'completed').length
  const allCompleted = team.tasks.length > 0 && completedCount === team.tasks.length
  return (
    <section className={css.team} data-team-id={team.teamId}>
      <header className={css.teamHead}>
        <span className={css.teamName} title={team.name}>{team.name}</span>
        {historic && <span className={css.historicPill}>Ended</span>}
        <span className={css.teamStats}>
          <span data-stat="members">{team.members.length} members</span>
          <span data-stat="tasks">{completedCount}/{team.tasks.length} done</span>
          <span data-stat="messages">{team.messageCount} messages</span>
        </span>
      </header>

      <section className={css.delegationSection} aria-label="Captain delegation" data-delegation-map>
        <div className={css.captainNode}>
          <span className={css.captainAvatar}>
            <img className={css.leadAvatar} src={LEAD_ART} alt="" aria-hidden />
          </span>
          <span className={css.captainInfo}>
            <span className={css.captainLine}>
              <span className={css.captainName}>Captain</span>
              <span className={css.captainRole}>Break down · Assign · Consolidate</span>
            </span>
            <span className={css.captainSummary}>Assigned {assignedCount} tasks to {team.members.length} members</span>
          </span>
          <span className={css.captainState} data-busy={busyCount > 0}>
            <WorkGlyph active={busyCount > 0} />
            {busyCount > 0 ? `${busyCount} working` : allCompleted ? 'All collected' : 'Waiting for reports'}
          </span>
        </div>

        <ProgressOverview team={team} />

        <button type="button" className={css.membersToggle} onClick={() => { setMembersOpen((current) => !current) }} aria-expanded={membersOpen} data-members-toggle>
          <span><Chevron open={membersOpen} />Members {team.members.length}</span>
          <span>{membersOpen ? 'Collapse' : 'Expand'}</span>
        </button>

        {membersOpen && <div className={css.delegationTree}>
          {team.members.length === 0 && <span className={css.emptyHint}>No members yet — waiting for the captain to build the team</span>}
          {team.members.map((member) => {
            const owned = team.tasks.filter((task) => task.assignee === member.name)
            return (
              <div key={member.id} className={css.memberBlock} data-activity={member.activity}>
                <span className={css.memberBranch} aria-hidden><span /></span>
                <button
                  type="button"
                  className={css.memberRow}
                  data-activity={member.activity}
                  onClick={() => { if (member.id !== '') onNavigate(member.id as SessionId) }}
                >
                  <span className={css.memberAvatar} data-unread={member.unread > 0}>
                    {memberArtUrl(member.name, member.role) !== null ? (
                      <img className={css.memberArt} src={memberArtUrl(member.name, member.role) ?? ''} alt="" aria-hidden />
                    ) : (
                      <span className={css.memberInitial} style={{ background: accentOf(member.id) }}>{memberInitial(member.name)}</span>
                    )}
                    <img className={css.stateArt} data-activity={member.activity} src={ACTION_ART[member.activity]} alt="" aria-hidden />
                  </span>
                  <span className={css.memberInfo}>
                    <span className={css.memberLine}>
                      <span className={css.memberName}>{member.name}</span>
                      {member.role !== '' && <span className={css.memberRole}>{member.role}</span>}
                      <span className={css.memberState} data-activity={member.activity}>
                        <WorkGlyph active={member.activity === 'working'} />
                        {memberStateLabel(member, team.tasks, historic)}
                      </span>
                    </span>
                    <span className={css.memberStatusLine}>{memberStatusText(member, team.tasks)}</span>
                  </span>
                  <span className={css.memberCount}>{member.done}/{member.total}</span>
                </button>
                <div className={css.assignmentLine}>
                  <span className={css.assignmentLabel}>Assigned by captain</span>
                  <span className={css.assignmentTasks}>
                    {owned.length === 0
                      ? <span className={css.taskEmpty}>No tasks</span>
                      : owned.map((task) => (
                        <span key={task.id} className={css.assignmentChip} data-state={taskTone(task.state, task.status)} title={task.subject}>
                          {task.id}
                        </span>
                      ))}
                  </span>
                </div>
              </div>
            )
          })}
        </div>}
      </section>

      <DependencyMap tasks={team.tasks} />
    </section>
  )
}

/** Legacy conversation cards may outlive their host archive. Project their
 * durable roster through the same rebuilt panel instead of a second UI. */
function historicCardTeam(data: AgentTeamsCardData, owner: string): ActivityTeam {
  return {
    workspace: '',
    teamId: data.teamId,
    name: data.teamName,
    captainSessionId: data.captainSessionId || owner,
    members: data.members.map((member) => ({
      ...member,
      status: 'removed',
      activity: 'idle',
      progress: 0,
      done: 0,
      total: 0,
      currentTask: '',
      unread: 0,
    })),
    tasks: [],
    messageCount: 0,
    captainInbox: [],
  }
}

/** The top-right activity floater. Teams follow the current session: live
 * snapshots and historic card summaries are only shown while their captain
 * session is the one currently open. */
export function ActivityPanel({ sessionsList, openSession }: {
  readonly sessionsList: ObservableSnapshot<SessionListState>
  readonly openSession: (id: SessionId) => void
}) {
  // Navigating to a member's subagent transcript is an explicit departure:
  // hide the floater immediately instead of waiting out the autocollapse
  // grace, so the panel never lingers over the member session.
  const navigateToSession = (id: SessionId): void => {
    setOpen(false)
    setWasActive(false)
    openSession(id)
  }
  const [open, setOpen] = useState(false)
  const [openOwner, setOpenOwner] = useState<SessionId | undefined>()
  const [autoOpened, setAutoOpened] = useState(false)
  const [wasActive, setWasActive] = useState(false)
  const [historic, setHistoric] = useState<ReadonlyMap<string, { data: AgentTeamsCardData; owner: string }>>(new Map())
  const current = useSyncExternalStore(
    sessionsList.subscribe,
    sessionsList.getSnapshot,
  ).current
  const monitorTargets = useSyncExternalStore(
    subscribeActivityMonitorTargets,
    getActivityMonitorTargetsSnapshot,
  )
  const { teams, archivedTeams } = useSyncExternalStore(
    subscribeActivitySnapshots,
    getActivitySnapshotsSnapshot,
  )
  const currentTargets = useMemo(
    () => current === undefined ? [] : monitorTargets.filter((target) => target.sessionId === current),
    [current, monitorTargets],
  )
  const currentRef = useRef(current)
  useEffect(() => { currentRef.current = current }, [current])
  const mountedAtRef = useRef(performance.now())
  const expanded = activityPanelExpandedForSession(open, openOwner, current)

  // This portal survives conversation route changes. Gate expansion by its
  // owning session during render, then clear stale state before paint. This
  // removes the old panel immediately instead of waiting for the no-team
  // autoclose grace period on the destination page.
  useLayoutEffect(() => {
    if (openOwner === undefined || openOwner === current) return
    setOpen(false)
    setOpenOwner(undefined)
    setWasActive(false)
    setAutoOpened(false)
  }, [current, openOwner])

  // The activity panel is a body portal, so announce its open state on body.
  // CSS can then make the conversation column yield space without knowing the
  // host shell's hashed module class names. Narrow viewports keep overlay mode.
  useLayoutEffect(() => {
    const root = document.documentElement
    if (expanded) root.setAttribute(PANEL_OPEN_ATTRIBUTE, '')
    else root.removeAttribute(PANEL_OPEN_ATTRIBUTE)
    return () => { root.removeAttribute(PANEL_OPEN_ATTRIBUTE) }
  }, [expanded])

  useEffect(() => {
    // Installing the plugin alone must not touch the state route. A successful
    // AgentTeams conversation card registers the demand that reaches here.
    if (currentTargets.length === 0) return
    const controller = startActivityPolling(currentTargets)
    return () => { controller.stop() }
  }, [currentTargets])

  useEffect(() => {
    const onOpenPanel = (event: Event): void => {
      const activeSession = currentRef.current
      if (activeSession === undefined) return
      setOpenOwner(activeSession)
      setOpen(true)
      const detail = (event as CustomEvent<AgentTeamsCardData>).detail
      if (detail?.teamId !== undefined) {
        // A card from a log that predates captainSessionId belongs to the
        // session that activated it (the current one at injection time).
        const owner = detail.captainSessionId !== '' ? detail.captainSessionId : currentRef.current ?? ''
        const teamKey = `${owner}:${detail.teamId}`
        setHistoric((previous) => {
          const next = new Map(previous)
          next.set(teamKey, { data: detail, owner })
          return next
        })
      }
    }
    window.addEventListener(OPEN_PANEL_EVENT, onOpenPanel)
    return () => {
      window.removeEventListener(OPEN_PANEL_EVENT, onOpenPanel)
    }
  }, [])

  // Teams follow the current session: live snapshots and historic card
  // summaries are visible only while their captain session is current.
  const visibleTeams = useMemo(
    // No current session (initial load): show nothing until one is picked,
    // so cross-session teams never leak into the floater.
    () => (current === undefined ? [] : teams.filter((team) => team.captainSessionId === current)),
    [teams, current],
  )
  const visibleHistoric = useMemo(
    () => (current === undefined ? [] : [...historic.values()].filter(({ data, owner }) =>
      owner === current && !teams.some((live) =>
        live.captainSessionId === current && live.teamId === data.teamId,
      ) && !archivedTeams.some((archived) =>
        archived.captainSessionId === current && archived.teamId === data.teamId,
      ),
    )),
    [historic, current, teams, archivedTeams],
  )
  const visibleArchived = useMemo(
    () => (current === undefined ? [] : archivedTeams.filter((team) =>
      team.captainSessionId === current && !teams.some((live) =>
        live.captainSessionId === current && live.teamId === team.teamId,
      ),
    )),
    [archivedTeams, current, teams],
  )
  const visibleCount = visibleTeams.length + visibleArchived.length + visibleHistoric.length

  useEffect(() => {
    if (visibleCount > 0) {
      setWasActive(true)
      // Auto-expand only after the page-settle window: opening (and its
      // main-column yield) right after load reads as a whole-page flicker.
      const settled = performance.now() - mountedAtRef.current >= AUTO_OPEN_SETTLE_MS
      if (!autoOpened && settled) {
        setOpenOwner(current)
        setOpen(true)
        setAutoOpened(true)
      }
      return
    }
    if (!wasActive) return
    const timer = setTimeout(() => {
      setOpen(false)
      setOpenOwner(undefined)
      setWasActive(false)
      // Re-arm auto-expand: a later activity (new team, new session) may
      // open the panel on its own again.
      setAutoOpened(false)
    }, AUTOCLOSE_GRACE_MS)
    return () => { clearTimeout(timer) }
  }, [visibleCount, autoOpened, wasActive])

  const busy = useMemo(
    () => visibleTeams.some((team) => team.members.some((member) => member.activity === 'working')),
    [visibleTeams],
  )
  const hasTeams = visibleCount > 0

  if (!hasTeams && !expanded) return null

  return (
    <>
      {!expanded && (
        <CollapsedBadge count={visibleCount} busy={busy} onClick={() => {
          if (current === undefined) return
          setOpenOwner(current)
          setOpen(true)
        }} />
      )}
      {expanded && (
        <aside className={css.panel} data-agent-teams-activity>
          <header className={css.panelHead}>
            <span className={css.panelTitle}>
              AgentTeams activity
              <span className={css.panelDot} data-busy={busy} aria-hidden />
            </span>
            <button
              type="button"
              className={css.closeButton}
              onClick={() => {
                setOpen(false)
                setOpenOwner(undefined)
              }}
              aria-label="Close"
            >
              <IconCloseOutline16 />
            </button>
          </header>
          <div className={css.teams}>
            {visibleCount === 0
              ? <span className={css.emptyHint}>No team activity</span>
              : (
                <>
                  {visibleTeams.map((team) => (
                    <TeamSection key={team.teamId} team={team} onNavigate={navigateToSession} />
                  ))}
                  {visibleArchived.map((team) => (
                    <div key={`${team.captainSessionId}:${team.teamId}`} data-team-id={team.teamId} data-historic className={css.archivedWrap}>
                      <TeamSection team={team} onNavigate={navigateToSession} historic />
                    </div>
                  ))}
                  {visibleHistoric.map(({ data: team, owner }) => {
                    const teamKey = `${owner}:${team.teamId}`
                    return (
                      <TeamSection key={teamKey} team={historicCardTeam(team, owner)} onNavigate={navigateToSession} historic />
                    )
                  })}
                </>
              )}
          </div>
        </aside>
      )}
    </>
  )
}
