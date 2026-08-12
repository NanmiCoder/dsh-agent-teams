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

import { useEffect, useMemo, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ACTION_ART, LEAD_ART, memberArtUrl } from './artwork.ts'
import { OPEN_PANEL_EVENT } from './AgentTeamsCard.tsx'
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

const TASK_STATE_LABEL: Record<ActivityTask['state'], string> = {
  blocked: '阻塞',
  open: '待领取',
  running: '进行中',
  completed: '已完成',
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

function TeamSection({ team, openSession }: {
  readonly team: ActivityTeam
  readonly openSession: (id: SessionId) => void
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
      <div className={css.members}>
        {team.members.length === 0 && <span className={css.emptyHint}>暂无成员</span>}
        {team.members.map((member) => (
          <button
            type="button"
            key={member.id}
            className={css.memberRow}
            data-activity={member.activity}
            onClick={() => { if (member.id !== '') openSession(member.id as SessionId) }}
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
                <span>当前</span>
                <span className={css.memberTaskId}>{member.currentTask === '' ? '—' : member.currentTask}</span>
                <span className={css.memberCount}>{member.done}/{member.total}</span>
                {member.unread > 0 && <span className={css.unreadPill}>{member.unread} 未读</span>}
              </span>
            </span>
          </button>
        ))}
      </div>
      {team.tasks.length > 0 && (
        <div className={css.tasks}>
          {team.tasks.map((task) => (
            <div key={task.id} className={css.taskRow} data-state={task.state} style={{ paddingLeft: `${Math.min(task.depth, 3) * 12 + 8}px` }}>
              <span className={css.taskStateBar} data-state={task.state} aria-hidden />
              <span className={css.taskId}>{task.id}</span>
              <span className={css.taskBadge} data-state={task.state}>{TASK_STATE_LABEL[task.state]}</span>
              <span className={css.taskSubject} title={task.subject}>{task.subject}</span>
              <span className={css.taskAssignee}>{task.assignee === '' ? '' : `→ ${task.assignee}`}</span>
            </div>
          ))}
        </div>
      )}
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

/** The top-right activity floater. */
export function ActivityPanel({ openSession }: {
  readonly openSession: (id: SessionId) => void
}) {
  const [teams, setTeams] = useState<readonly ActivityTeam[]>([])
  const [open, setOpen] = useState(false)
  const [autoOpened, setAutoOpened] = useState(false)
  const [wasActive, setWasActive] = useState(false)

  useEffect(() => {
    let cancelled = false
    const tick = async (): Promise<void> => {
      try {
        const response = await fetch(STATE_URL, { cache: 'no-store' })
        if (!response.ok) return
        const body = (await response.json()) as { teams?: readonly ActivityTeam[] }
        if (!cancelled) setTeams(body.teams ?? [])
      } catch {
        // Host restarting; keep the last snapshot.
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
    const onOpenPanel = (): void => { setOpen(true) }
    window.addEventListener(OPEN_PANEL_EVENT, onOpenPanel)
    return () => { window.removeEventListener(OPEN_PANEL_EVENT, onOpenPanel) }
  }, [])

  useEffect(() => {
    if (teams.length > 0) {
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
    }, AUTOCLOSE_GRACE_MS)
    return () => { clearTimeout(timer) }
  }, [teams, autoOpened, wasActive])

  const busy = useMemo(
    () => teams.some((team) => team.members.some((member) => member.activity === 'working')),
    [teams],
  )
  const hasTeams = teams.length > 0

  if (!hasTeams && !open) return null

  return (
    <>
      {!open && (
        <CollapsedBadge count={teams.length} busy={busy} onClick={() => { setOpen(true) }} />
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
            {teams.length === 0
              ? <span className={css.emptyHint}>暂无团队活动</span>
              : teams.map((team) => (
                <TeamSection key={team.teamId} team={team} openSession={openSession} />
              ))}
          </div>
        </aside>
      )}
    </>
  )
}
