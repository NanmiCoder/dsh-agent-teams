/**
 * AgentTeams activity panel: the top-right floater monitoring every team.
 *
 * Modeled on the Claude Code desktop SessionActivityPanel: a fixed glass
 * overlay at the top-right corner (out-of-flow, never squeezing the
 * conversation), polling the host `/plugins/dsh-agent-teams/state` route for
 * server-side snapshots (durable files + live subagent activity), with a
 * collapsed badge that auto-expands once when activity appears and collapses
 * 2s after the last team disappears.
 *
 * The floater mounts through a body portal (no top-right slot exists in the
 * web shell); it is not a conversation node — the in-conversation panel was
 * removed in favor of this always-available monitor.
 * @module dsh-agent-teams/client/activity
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ObservableSnapshot, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { ACTION_ART, LEAD_ART, memberArtUrl } from './artwork.ts'
import { OPEN_PANEL_EVENT } from './AgentTeamsCard.tsx'
import type { AgentTeamsCardData } from './agent-teams-card-definition.ts'
import css from './ActivityPanel.module.css'

/** Poll cadence for the host snapshot route. */
const POLL_MS = 1000
/** Grace before the panel collapses once no team remains. */
const AUTOCLOSE_GRACE_MS = 2000
/** Host route serving team snapshots. */
const STATE_URL = '/plugins/dsh-agent-teams/state'

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
    <button type="button" className={css.badge} data-busy={busy} onClick={onClick} aria-label="AgentTeams 活动">
      <span className={css.badgeDot} data-busy={busy} aria-hidden />
      <span className={css.badgeCount}>{count}</span>
    </button>
  )
}

function TeamSection({ team, onNavigate }: {
  readonly team: ActivityTeam
  /** Navigate to a member transcript (floater hides immediately). */
  readonly onNavigate: (id: SessionId) => void
}) {
  const busyCount = team.members.filter((member) => member.activity === 'working').length
  return (
    <section className={css.team} data-team-id={team.teamId}>
      <header className={css.teamHead}>
        <span className={css.teamName} title={team.name}><img className={css.leadAvatar} src={LEAD_ART} alt="" aria-hidden /> {team.name}</span>
        <span className={css.teamStats}>
          <span data-stat="members">{team.members.length} 成员</span>
          <span data-stat="tasks">{team.tasks.length} 任务</span>
          <span data-stat="messages">{team.messageCount} 消息</span>
        </span>
        {busyCount > 0 && <span className={css.livePill} data-live>● {busyCount} 工作中</span>}
      </header>
      <div className={css.formation}>
        {team.members.length === 0 && <span className={css.emptyHint}>暂无成员</span>}
        {team.members.map((member) => {
          const owned = team.tasks.filter((task) => task.assignee === member.name)
          const current = owned.find((task) => task.id === member.currentTask)
          const blockedTask = owned.find((task) => task.state === 'blocked')
          const doneAll = member.total > 0 && member.done === member.total
          let statusText: string
          if (member.activity === 'working' && current !== undefined) statusText = `正在执行 ${current.id}`
          else if (member.activity === 'working') statusText = '工作中'
          else if (blockedTask !== undefined) {
            const dep = team.tasks.find((t) => blockedTask.dependencies.includes(t.id) && t.state !== 'completed')
            statusText = dep !== undefined ? `等待 ${dep.id}${dep.assignee !== '' && dep.assignee !== member.name ? ` · ${dep.assignee}` : ''}` : '等待依赖'
          } else if (doneAll) statusText = '等待收尾'
          else if (member.total === 0) statusText = '等待任务'
          else statusText = member.activity === 'idle' ? '空闲' : '未知'
          return (
            <div key={member.id} className={css.memberBlock} data-activity={member.activity} style={{ borderLeftColor: accentOf(member.id) }}>
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
                  <img
                    className={css.stateArt}
                    data-activity={member.activity}
                    src={ACTION_ART[member.activity]}
                    alt=""
                    aria-hidden
                  />
                </span>
                <span className={css.memberInfo}>
                  <span className={css.memberLine}>
                    <span className={css.memberName}>{member.name}</span>
                    {member.role !== '' && <span className={css.memberRole}>{member.role}</span>}
                    <span className={css.memberState} data-activity={member.activity}>
                      {member.activity === 'working' ? '工作中' : member.activity === 'idle' ? '空闲' : '未知'}
                    </span>
                  </span>
                  <span className={css.memberProgress} aria-label={`${member.done}/${member.total}`}>
                    <span
                      className={css.memberProgressFill}
                      style={{ width: `${member.progress}%`, background: accentOf(member.id) }}
                    />
                  </span>
                  <span className={css.memberTask}>
                    <span className={css.memberStatusLine}>{statusText}</span>
                    <span className={css.memberCount}>{member.done}/{member.total}</span>
                    {member.unread > 0 && <span className={css.unreadPill}>{member.unread} 未读</span>}
                  </span>
                </span>
              </button>
              <div className={css.memberTasks}>
                {owned.length === 0 && <span className={css.taskEmpty}>暂无任务</span>}
                {owned
                  .slice()
                  .sort((left, right) => {
                    const rank = (task: ActivityTask): number => {
                      if (task.state === 'running') return 0
                      if (task.status === 'failed' || task.status === 'cancelled') return 3
                      if (task.state === 'blocked') return 2
                      return 1
                    }
                    return rank(left) - rank(right) || left.id.localeCompare(right.id, 'en', { numeric: true })
                  })
                  .map((task) => (
                    <div
                      key={task.id}
                      className={css.taskRow}
                      data-state={taskTone(task.state, task.status)}
                      data-current={task.id === member.currentTask}
                    >
                      <span className={css.taskStateBar} data-state={taskTone(task.state, task.status)} aria-hidden />
                      <span className={css.taskId}>{task.id}</span>
                      <span className={css.taskBadge} data-state={taskTone(task.state, task.status)}>
                        {taskStatusLabel(task.status)}
                      </span>
                      <span className={css.taskSubject} title={task.subject}>{task.subject}</span>
                      {task.dependencies.length > 0 && (
                        <span className={css.taskDeps} data-state={task.state}>
                          ← {task.dependencies.map((id) => {
                            const dep = team.tasks.find((t) => t.id === id)
                            return dep !== undefined && dep.assignee !== '' && dep.assignee !== member.name
                              ? `${id}·${dep.assignee}`
                              : id
                          }).join(',')}
                        </span>
                      )}
                      {task.id === member.currentTask && <span className={css.currentPill}>当前</span>}
                    </div>
                  ))}
              </div>
            </div>
          )
        })}
      </div>
      {(() => {
        const unclaimed = team.tasks.filter((task) => {
          if (task.assignee === '') return true
          return !team.members.some((member) => member.name === task.assignee)
        })
        if (unclaimed.length === 0) return null
        return (
          <div className={css.unclaimed}>
            <span className={css.unclaimedTitle}>待认领</span>
            {unclaimed.map((task) => (
              <div key={task.id} className={css.taskRow} data-state={taskTone(task.state, task.status)}>
                <span className={css.taskStateBar} data-state={taskTone(task.state, task.status)} aria-hidden />
                <span className={css.taskId}>{task.id}</span>
                <span className={css.taskBadge} data-state={taskTone(task.state, task.status)}>
                  {taskStatusLabel(task.status)}
                </span>
                <span className={css.taskSubject} title={task.subject}>{task.subject}</span>
                {task.assignee !== '' && <span className={css.taskAssignee}>原属 {task.assignee}</span>}
              </div>
            ))}
          </div>
        )
      })()}
      {team.captainInbox.length > 0 && (
        <div className={css.inbox}>
          {team.captainInbox.slice(-2).map((message, index) => (
            <div key={index} className={css.inboxRow}>
              <span className={css.inboxFrom}>{message.from}</span>
              <span className={css.inboxContent} title={message.content}>{message.content}</span>
            </div>
          ))}
        </div>
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
  const [open, setOpen] = useState(false)
  const [autoOpened, setAutoOpened] = useState(false)
  const [wasActive, setWasActive] = useState(false)
  const [historic, setHistoric] = useState<ReadonlyMap<string, { data: AgentTeamsCardData; owner: string }>>(new Map())
  const current = useSyncExternalStore(
    sessionsList.subscribe,
    sessionsList.getSnapshot,
  ).current
  const currentRef = useRef(current)
  currentRef.current = current

  useEffect(() => {
    let cancelled = false
    let inFlight = false
    const tick = async (): Promise<void> => {
      if (inFlight || cancelled) return
      inFlight = true
      try {
        const response = await fetch(STATE_URL, { cache: 'no-store' })
        if (!response.ok) return
        const body = (await response.json()) as { teams?: unknown }
        if (!cancelled && Array.isArray(body.teams)) setTeams(body.teams as readonly ActivityTeam[])
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
      setOpen(true)
      const detail = (event as CustomEvent<AgentTeamsCardData>).detail
      if (detail?.teamId !== undefined) {
        // A card from a log that predates captainSessionId belongs to the
        // session that activated it (the current one at injection time).
        const owner = detail.captainSessionId !== '' ? detail.captainSessionId : currentRef.current ?? ''
        setHistoric((previous) => {
          const next = new Map(previous)
          next.set(detail.teamId, { data: detail, owner })
          return next
        })
      }
    }
    window.addEventListener(OPEN_PANEL_EVENT, onOpenPanel)
    return () => { window.removeEventListener(OPEN_PANEL_EVENT, onOpenPanel) }
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
    () => [...historic.values()].filter(({ data, owner }) =>
      (current === undefined || owner === current)
      && !teams.some((live) => live.teamId === data.teamId),
    ),
    [historic, current, teams],
  )
  const visibleCount = visibleTeams.length + visibleHistoric.length

  useEffect(() => {
    if (visibleCount > 0) {
      setWasActive(true)
      if (!autoOpened) {
        setOpen(true)
        setAutoOpened(true)
      }
      return
    }
    if (!wasActive) return
    const timer = setTimeout(() => {
      setOpen(false)
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

  if (!hasTeams && !open) return null

  return (
    <>
      {!open && (
        <CollapsedBadge count={visibleCount} busy={busy} onClick={() => { setOpen(true) }} />
      )}
      {open && (
        <aside className={css.panel} data-agent-teams-activity>
          <header className={css.panelHead}>
            <span className={css.panelTitle}>
              AgentTeams 活动
              <span className={css.panelDot} data-busy={busy} aria-hidden />
            </span>
            <button
              type="button"
              className={css.closeButton}
              onClick={() => { setOpen(false) }}
              aria-label="关闭"
            >
              ✕
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
                  {visibleHistoric.map(({ data: team }) => (
                    <section key={team.teamId} className={css.team} data-team-id={team.teamId} data-historic>
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
                  ))}
                </>
              )}
          </div>
        </aside>
      )}
    </>
  )
}
