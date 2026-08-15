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
  IconBranchOutline16, IconChevronRightOutline14, IconCloseOutline16,
  StateDot, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ObservableSnapshot, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import {
  activityPanelExpandedForSession,
  dependencyFocusTaskId,
  relatedTaskIds,
  taskStages,
} from './activity-model.ts'
import { ACTION_ART, LEAD_ART, memberArtUrl } from './artwork.ts'
import { OPEN_PANEL_EVENT } from './AgentTeamsCard.tsx'
import type { AgentTeamsCardData } from './agent-teams-card-definition.ts'
import css from './ActivityPanel.module.css'

/** Poll cadence for the host snapshot route. */
const POLL_MS = 1000
/** Grace before the panel collapses once no team remains. */
const AUTOCLOSE_GRACE_MS = 2000
/**
 * Page-settle window after mount: activity restored on page load only shows
 * the collapsed badge, so the panel never yanks the conversation column
 * right after load. New activity after this window auto-expands as usual.
 */
const AUTO_OPEN_SETTLE_MS = 4000
/** Host route serving team snapshots. */
const STATE_URL = '/plugins/dsh-agent-teams/state'
/** Root marker shared with the panel CSS while the portal is expanded. */
const PANEL_OPEN_ATTRIBUTE = 'data-agent-teams-panel-open'

/** One member row of a host snapshot. */
export interface ActivityMember {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly activity: 'working' | 'idle' | 'unknown'
  readonly progress: number
  readonly done: number
  readonly total: number
  readonly currentTask: string
  readonly unread: number
}

/** One task row of a host snapshot. */
export interface ActivityTask {
  readonly id: string
  readonly subject: string
  readonly status: string
  readonly state: 'blocked' | 'open' | 'running' | 'completed'
  readonly assignee: string
  readonly dependencies: readonly string[]
  readonly depth: number
}

/** One captain-inbox preview row. */
export interface ActivityMessage {
  readonly from: string
  readonly content: string
}

/** One team snapshot (mirrors the host TeamActivitySnapshot). */
export interface ActivityTeam {
  readonly workspace: string
  readonly teamId: string
  readonly name: string
  readonly description?: string
  readonly captainSessionId: string
  readonly members: readonly ActivityMember[]
  readonly tasks: readonly ActivityTask[]
  readonly messageCount: number
  readonly captainInbox: readonly ActivityMessage[]
}

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
  pending: '待领取',
  claimed: '已认领',
  in_progress: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
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

/** Collapsed badge: an always-visible corner pill while any team exists. */
function CollapsedBadge({ count, busy, onClick }: {
  readonly count: number
  readonly busy: boolean
  readonly onClick: () => void
}) {
  return (
    <button type="button" className={css.badge} data-busy={busy} onClick={onClick} aria-label={`AgentTeams 活动，${count} 个团队`}>
      <span className={css.badgeDot} data-busy={busy} aria-hidden />
      <span className={css.badgeCount}>{count}</span>
    </button>
  )
}

function memberDotState(member: ActivityMember, tasks: readonly ActivityTask[]): StateDotState {
  const owned = tasks.filter((task) => task.assignee === member.name)
  if (member.activity === 'working') return 'ongoing'
  if (owned.some((task) => task.status === 'failed')) return 'error'
  if (owned.length > 0 && owned.every((task) => task.status === 'completed')) return 'done'
  return 'warning'
}

function memberStateLabel(member: ActivityMember, tasks: readonly ActivityTask[]): string {
  const owned = tasks.filter((task) => task.assignee === member.name)
  if (member.activity === 'working') return '工作中'
  if (owned.some((task) => task.status === 'failed')) return '有失败'
  if (owned.some((task) => task.state === 'blocked')) return '等待'
  if (owned.length > 0 && owned.every((task) => task.status === 'completed')) return '已交付'
  if (owned.length > 0) return '待执行'
  return '待派工'
}

function memberStatusText(member: ActivityMember, tasks: readonly ActivityTask[]): string {
  const owned = tasks.filter((task) => task.assignee === member.name)
  const current = owned.find((task) => task.id === member.currentTask)
  const blocked = owned.find((task) => task.state === 'blocked')
  if (member.activity === 'working' && current !== undefined) return `正在执行 ${current.id}`
  if (member.activity === 'working') return '正在处理已派任务'
  if (blocked !== undefined) {
    const dependency = tasks.find((task) => blocked.dependencies.includes(task.id) && task.state !== 'completed')
    if (dependency !== undefined) return `等待 ${dependency.id} · ${dependency.assignee || '待认领'}`
    return '等待前置任务'
  }
  if (member.total === 0) return '等待队长派工'
  if (member.done === member.total) return '任务已交付'
  return member.activity === 'idle' ? '待继续执行' : '状态未知'
}

function dependencyLabel(task: ActivityTask, tasks: readonly ActivityTask[]): string {
  return task.dependencies.map((id) => {
    const dependency = tasks.find((candidate) => candidate.id === id)
    return dependency?.assignee ? `${id}·${dependency.assignee}` : id
  }).join('、')
}

function TaskNode({ task, tasks, focused, dimmed, pinned, onPin, onHover, onFocusChange }: {
  readonly task: ActivityTask
  readonly tasks: readonly ActivityTask[]
  readonly focused: boolean
  readonly dimmed: boolean
  readonly pinned: boolean
  readonly onPin: (id: string) => void
  readonly onHover: (id: string | null) => void
  readonly onFocusChange: (id: string | null) => void
}) {
  const tone = taskTone(task.state, task.status)
  return (
    <button
      type="button"
      className={css.taskNode}
      data-task-id={task.id}
      data-state={tone}
      data-focused={focused}
      data-dimmed={dimmed}
      aria-pressed={pinned}
      title={`${task.id} · ${task.subject}（悬停高亮依赖链 · 点击固定）`}
      onClick={() => { onPin(task.id) }}
      onMouseEnter={() => { onHover(task.id) }}
      onMouseLeave={() => { onHover(null) }}
      onFocus={() => { onFocusChange(task.id) }}
      onBlur={() => { onFocusChange(null) }}
    >
      <span className={css.taskNodeHead}>
        <span className={css.taskId}>{task.id}</span>
        <span className={css.taskBadge} data-state={tone}>{taskStatusLabel(task.status)}</span>
      </span>
      <span className={css.taskSubject}>{task.subject}</span>
      <span className={css.taskRoute}>
        <span className={css.taskOwner}>{task.assignee || '待认领'}</span>
        {task.dependencies.length === 0
          ? <span className={css.taskStart}>起点</span>
          : <span className={css.taskDeps}>依赖 {dependencyLabel(task, tasks)}</span>}
      </span>
    </button>
  )
}

function DependencyMap({ tasks }: { readonly tasks: readonly ActivityTask[] }) {
  const [hoverTaskId, setHoverTaskId] = useState<string | null>(null)
  const [keyboardTaskId, setKeyboardTaskId] = useState<string | null>(null)
  const [pinnedTaskId, setPinnedTaskId] = useState<string | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusedTaskId = dependencyFocusTaskId(pinnedTaskId, keyboardTaskId, hoverTaskId)
  const stages = useMemo(() => taskStages(tasks), [tasks])
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
  return (
    <section className={css.dependencySection} aria-label="任务依赖链" data-dependency-map>
      <header className={css.sectionHead}>
        <span className={css.sectionTitle}><IconBranchOutline16 /> 任务依赖</span>
        <span className={css.sectionHint}>{pinnedTaskId === null ? '悬停高亮依赖链 · 点击固定' : `${pinnedTaskId} 已固定 · Esc 取消`}</span>
      </header>
      <div className={css.stageFlow}>
        {stages.map((stage, index) => (
          <div key={stage.depth} className={css.stageGroup} data-depth={stage.depth}>
            {index > 0 && (
              <span className={css.stageConnector} aria-hidden>
                <span className={css.stageLine} />
                <IconChevronRightOutline14 />
              </span>
            )}
            <div className={css.stageColumn}>
              <span className={css.stageLabel}>
                {stage.depth === 0 ? '起点' : `依赖层 ${stage.depth}`}
                <span>{stage.tasks.length}</span>
              </span>
              <div className={css.stageTasks}>
                {stage.tasks.map((task) => (
                  <TaskNode
                    key={task.id}
                    task={task}
                    tasks={tasks}
                    focused={related?.has(task.id) ?? false}
                    dimmed={related !== null && !related.has(task.id)}
                    pinned={pinnedTaskId === task.id}
                    onPin={(id) => { setPinnedTaskId((current) => current === id ? null : id) }}
                    onHover={scheduleHover}
                    onFocusChange={setKeyboardTaskId}
                  />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function TeamSection({ team, onNavigate, historic = false }: {
  readonly team: ActivityTeam
  /** Navigate to a member transcript (floater hides immediately). */
  readonly onNavigate: (id: SessionId) => void
  readonly historic?: boolean
}) {
  const busyCount = team.members.filter((member) => member.activity === 'working').length
  const assignedCount = team.tasks.filter((task) => task.assignee !== '').length
  const completedCount = team.tasks.filter((task) => task.status === 'completed').length
  const allCompleted = team.tasks.length > 0 && completedCount === team.tasks.length
  const unclaimed = team.tasks.filter((task) => {
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return false
    if (task.assignee === '') return true
    return !team.members.some((member) => member.name === task.assignee)
  })
  return (
    <section className={css.team} data-team-id={team.teamId}>
      <header className={css.teamHead}>
        <span className={css.teamName} title={team.name}>{team.name}</span>
        {historic && <span className={css.historicPill}>已结束</span>}
        <span className={css.teamStats}>
          <span data-stat="members">{team.members.length} 成员</span>
          <span data-stat="tasks">{completedCount}/{team.tasks.length} 完成</span>
          <span data-stat="messages">{team.messageCount} 消息</span>
        </span>
      </header>

      <section className={css.delegationSection} aria-label="队长派工关系" data-delegation-map>
        <div className={css.captainNode}>
          <span className={css.captainAvatar}>
            <img className={css.leadAvatar} src={LEAD_ART} alt="" aria-hidden />
          </span>
          <span className={css.captainInfo}>
            <span className={css.captainLine}>
              <span className={css.captainName}>队长</span>
              <span className={css.captainRole}>拆解 · 派发 · 汇总</span>
            </span>
            <span className={css.captainSummary}>已派发 {assignedCount} 项任务给 {team.members.length} 名成员</span>
          </span>
          <span className={css.captainState} data-busy={busyCount > 0}>
            <StateDot state={busyCount > 0 ? 'ongoing' : allCompleted ? 'done' : 'warning'} />
            {busyCount > 0 ? `${busyCount} 人执行中` : allCompleted ? '已收齐' : '等待回报'}
          </span>
        </div>

        <div className={css.delegationTree}>
          {team.members.length === 0 && <span className={css.emptyHint}>暂无成员，等待队长组建团队</span>}
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
                        <StateDot state={memberDotState(member, team.tasks)} />
                        {memberStateLabel(member, team.tasks)}
                      </span>
                    </span>
                    <span className={css.memberStatusLine}>{memberStatusText(member, team.tasks)}</span>
                  </span>
                  <span className={css.memberCount}>{member.done}/{member.total}</span>
                </button>
                <div className={css.assignmentLine}>
                  <span className={css.assignmentLabel}>队长派发</span>
                  <span className={css.assignmentTasks}>
                    {owned.length === 0
                      ? <span className={css.taskEmpty}>暂无任务</span>
                      : owned.map((task) => (
                        <span key={task.id} className={css.assignmentChip} data-state={taskTone(task.state, task.status)} title={task.subject}>
                          {task.id}
                        </span>
                      ))}
                  </span>
                  {member.unread > 0 && <span className={css.unreadPill}>{member.unread} 条消息</span>}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <DependencyMap tasks={team.tasks} />

      {unclaimed.length > 0 && (
        <section className={css.unclaimed} aria-label="待认领任务">
          <span className={css.unclaimedTitle}>待队长认领或改派</span>
          <span className={css.assignmentTasks}>
            {unclaimed.map((task) => (
              <span key={task.id} className={css.assignmentChip} data-state={taskTone(task.state, task.status)} title={task.subject}>
                {task.id} · {task.assignee || '未分配'}
              </span>
            ))}
          </span>
        </section>
      )}

      {team.captainInbox.length > 0 && (
        <section className={css.inbox} aria-label="成员回报队长">
          <header className={css.sectionHead}>
            <span className={css.sectionTitle}>成员回报</span>
            <span className={css.sectionHint}>流向队长</span>
          </header>
          {team.captainInbox.slice(-2).map((message, index) => (
            <div key={index} className={css.inboxRow}>
              <span className={css.inboxRoute}>{message.from}<IconChevronRightOutline14 />队长</span>
              <span className={css.inboxContent} title={message.content}>{message.content}</span>
            </div>
          ))}
        </section>
      )}
    </section>
  )
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
  const [teams, setTeams] = useState<readonly ActivityTeam[]>([])
  const [archivedTeams, setArchivedTeams] = useState<readonly ActivityTeam[]>([])
  const [open, setOpen] = useState(false)
  const [openOwner, setOpenOwner] = useState<SessionId | undefined>()
  const [autoOpened, setAutoOpened] = useState(false)
  const [wasActive, setWasActive] = useState(false)
  const [historic, setHistoric] = useState<ReadonlyMap<string, { data: AgentTeamsCardData; owner: string }>>(new Map())
  const current = useSyncExternalStore(
    sessionsList.subscribe,
    sessionsList.getSnapshot,
  ).current
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
    let cancelled = false
    let inFlight = false
    const tick = async (): Promise<void> => {
      if (inFlight || cancelled) return
      inFlight = true
      try {
        const [liveResponse, archivedResponse] = await Promise.all([
          fetch(STATE_URL, { cache: 'no-store' }),
          fetch(`${STATE_URL}?archived=1`, { cache: 'no-store' }),
        ])
        if (liveResponse.ok) {
          const body = (await liveResponse.json()) as { teams?: unknown }
          if (!cancelled && Array.isArray(body.teams)) setTeams(body.teams as readonly ActivityTeam[])
        }
        if (archivedResponse.ok) {
          const body = (await archivedResponse.json()) as { teams?: unknown }
          if (!cancelled && Array.isArray(body.teams)) setArchivedTeams(body.teams as readonly ActivityTeam[])
        }
      } catch {
        // Host restarting; keep the last snapshot.
      } finally {
        inFlight = false
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

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
              AgentTeams 活动
              <span className={css.panelDot} data-busy={busy} aria-hidden />
            </span>
            <button
              type="button"
              className={css.closeButton}
              onClick={() => {
                setOpen(false)
                setOpenOwner(undefined)
              }}
              aria-label="关闭"
            >
              <IconCloseOutline16 />
            </button>
          </header>
          <div className={css.teams}>
            {visibleCount === 0
              ? <span className={css.emptyHint}>暂无团队活动</span>
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
                    <section key={teamKey} className={css.team} data-team-id={team.teamId} data-historic>
                      <header className={css.teamHead}>
                        <span className={css.teamName} title={team.teamName}>
                          <img className={css.leadAvatar} src={LEAD_ART} alt="" aria-hidden /> {team.teamName}
                        </span>
                        <span className={css.historicPill}>已结束</span>
                      </header>
                      <div className={css.members}>
                        {team.members.map((member) => (
                          <button
                            type="button"
                            key={member.id}
                            className={css.memberRow}
                            data-activity="idle"
                            onClick={() => { if (member.id !== '') navigateToSession(member.id as SessionId) }}
                          >
                            <span className={css.memberAvatar}>
                              {memberArtUrl(member.name, member.role) !== null ? (
                                <img className={css.memberArt} src={memberArtUrl(member.name, member.role) ?? ''} alt="" aria-hidden />
                              ) : (
                                <span className={css.memberInitial} style={{ background: accentOf(member.id) }}>{memberInitial(member.name)}</span>
                              )}
                            </span>
                            <span className={css.memberInfo}>
                              <span className={css.memberLine}>
                                <span className={css.memberName}>{member.name}</span>
                                {member.role !== '' && <span className={css.memberRole}>{member.role}</span>}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
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
