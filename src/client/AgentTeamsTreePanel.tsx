/**
 * AgentTeams tree panel: the horizontal tree monitor for one team.
 *
 * Layout: the captain (Team Lead) sits at the top; a stem drops to a row of
 * member cards (one per teammate); each member card lists its current
 * (unfinished) assigned tasks with status badges. Member live activity comes
 * from the sessions snapshot, exactly like the workflow-run panel.
 * @module dsh-agent-teams/client/panel
 */

import { StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { shallowEqual } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AgentTeamsKey } from './locales.ts'
import type {
  AgentTeamsTreeData, AgentTeamsTreeMember, AgentTeamsTreeStatus,
} from './agent-teams-definition.ts'
import css from './AgentTeamsTreePanel.module.css'

/** Navigation action injected from the plugin's own SessionsService access. */
export interface AgentTeamsInjected {
  readonly openSession: (id: SessionId) => void
}

/** Complete keyed Chat renderer props. */
export type AgentTeamsTreePanelProps =
  PropsRuntime<'conversation.chat.node', 'agent-teams'>
  & PropsLocale<'agentTeams'>
  & AgentTeamsInjected

const STATUS_KEYS = {
  running: 'status.running',
  deleted: 'status.deleted',
} as const satisfies Record<AgentTeamsTreeStatus, AgentTeamsKey>

const TASK_STATUS_KEYS: Record<string, AgentTeamsKey> = {
  pending: 'task.status.pending',
  claimed: 'task.status.claimed',
  in_progress: 'task.status.in_progress',
  completed: 'task.status.completed',
  failed: 'task.status.failed',
  cancelled: 'task.status.cancelled',
}

function dotState(status: AgentTeamsTreeStatus): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'deleted': return 'warning'
  }
}

function taskStatusKey(status: string): AgentTeamsKey {
  return TASK_STATUS_KEYS[status] ?? 'task.status.pending'
}

function memberCount(count: number, t: AgentTeamsTreePanelProps['t']): string {
  return t(count !== 1 ? 'members.other' : 'members.one', { count })
}

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?'
}

/** The captain root card. */
function CaptainNode({ data, t }: {
  readonly data: AgentTeamsTreeData
  readonly t: AgentTeamsTreePanelProps['t']
}) {
  return (
    <div className={css.captainCard} data-team-status={data.status}>
      <span className={css.avatar} data-avatar="captain">{t('captain').slice(0, 1)}</span>
      <span className={css.captainBody}>
        <span className={css.captainName} data-captain-name>{t('title', { name: data.teamName })}</span>
        <span className={css.captainMeta}>
          <StateDot state={dotState(data.status)} />
          <span>{t(STATUS_KEYS[data.status])}</span>
          <span className={css.separator} aria-hidden />
          <span>{memberCount(data.members.length, t)}</span>
        </span>
      </span>
    </div>
  )
}

/** One member card with its current tasks. */
function MemberNode({ member, running, openSession, t }: {
  readonly member: AgentTeamsTreeMember
  readonly running: boolean
  readonly openSession: AgentTeamsInjected['openSession']
  readonly t: AgentTeamsTreePanelProps['t']
}) {
  const tasks = member.currentTasks
  return (
    <div className={css.memberCard} data-member-running={running}>
      <div className={css.memberHead}>
        <span className={css.avatar} data-avatar="member">{initialOf(member.name)}</span>
        <span className={css.memberBody}>
          <button
            type="button"
            className={css.memberName}
            aria-label={t('member.open', { name: member.name })}
            onClick={() => { openSession(member.id as SessionId) }}
          >
            {member.name}
          </button>
          <span className={css.memberMeta}>
            <StateDot state={running ? 'ongoing' : 'done'} />
            <span>{running ? t('status.running') : t('member.idle')}</span>
            {member.role !== '' && (
              <>
                <span className={css.separator} aria-hidden />
                <span>{t('member.role', { role: member.role })}</span>
              </>
            )}
          </span>
        </span>
      </div>
      <div className={css.taskList}>
        {tasks.length === 0
          ? <span className={css.taskEmpty} data-task-empty>{t('task.none')}</span>
          : tasks.map(task => (
            <div className={css.taskRow} key={task.id} data-task-status={task.status}>
              <span className={css.taskBadge} data-task-status={task.status}>
                {t(taskStatusKey(task.status))}
              </span>
              <span className={css.taskSubject} data-task-subject>
                <span className={css.taskId}>{task.id}</span>
                {task.subject}
              </span>
            </div>
          ))}
      </div>
    </div>
  )
}

/** Render one durable team as a horizontal tree monitor. */
export function AgentTeamsTreePanel({ node, useSessions, openSession, t }: AgentTeamsTreePanelProps) {
  const data = node.data as AgentTeamsTreeData
  const runningIds = useSessions(
    sessions => new Set(
      data.members
        .filter(member => {
          const summary = sessions.byId[member.id as SessionId]
          return summary?.running === true && summary.origin === 'subagent'
        })
        .map(member => member.id),
    ),
    shallowEqual,
  )
  return (
    <section className={css.root} data-agent-teams-tree data-team-status={data.status}>
      <CaptainNode data={data} t={t} />
      {data.members.length > 0 ? (
        <>
          <div className={css.stem} aria-hidden />
          <div className={css.branchRow} aria-hidden />
          <div className={css.membersRow}>
            {data.members.map(member => (
              <div className={css.memberColumn} key={member.id}>
                <div className={css.branch} aria-hidden />
                <MemberNode
                  member={member}
                  running={runningIds.has(member.id)}
                  openSession={openSession}
                  t={t}
                />
              </div>
            ))}
          </div>
        </>
      ) : (
        <span className={css.empty} data-team-empty>{t('empty')}</span>
      )}
    </section>
  )
}
