/**
 * AgentTeams workbench panel: the compact in-conversation workbench for one
 * team, modeled on the Claude Code desktop AgentTeamsCanvas/Workbench.
 *
 * Top: the captain formation — the Team Lead card and one member card per
 * teammate (occupation avatar, name, role, live state dot, task progress,
 * unread badge). Below: the task DAG in dependency lanes (each dependency
 * depth owns one left-to-right column; cards are absolutely positioned and
 * SVG edges connect dependents to dependencies). Bottom: a collapsible
 * message feed (assignment / peer / report categories).
 * @module dsh-agent-teams/client/panel
 */

import { useMemo, useState } from 'react'
import { StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { shallowEqual } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AgentTeamsKey } from './locales.ts'
import {
  TASK_HEIGHT, TASK_WIDTH,
  type AgentTeamsWorkbenchData, type WorkbenchMessageData,
  type WorkbenchTaskData, type WorkbenchTaskState,
} from './agent-teams-definition.ts'
import css from './AgentTeamsWorkbenchPanel.module.css'

/** Navigation action injected from the plugin's own SessionsService access. */
export interface AgentTeamsInjected {
  readonly openSession: (id: SessionId) => void
}

/** Complete keyed Chat renderer props. */
export type AgentTeamsWorkbenchPanelProps =
  PropsRuntime<'conversation.chat.node', 'agent-teams'>
  & PropsLocale<'agentTeams'>
  & AgentTeamsInjected

const STATUS_KEYS = {
  running: 'status.running',
  deleted: 'status.deleted',
} as const satisfies Record<'running' | 'deleted', AgentTeamsKey>

const TASK_STATE_KEYS = {
  blocked: 'task.state.blocked',
  open: 'task.state.open',
  running: 'task.state.running',
  completed: 'task.state.completed',
} as const satisfies Record<WorkbenchTaskState, AgentTeamsKey>

/** Occupation emoji per role keyword (Claude Code desktop avatar analog). */
const ROLE_ICONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/resear|analys|investig|explor|data|study|研究|分析|数据|调查|探索/, '🔬'],
  [/engineer|dev\b|server|backend|\bapi\b|runtime|watcher|contract|工程|后端|服务|接口/, '🛠️'],
  [/\bqa\b|test|verif|quality/, '🧪'],
  [/design|\bui\b|\bux\b|front|theme|accessib|设计|前端|主题/, '🎨'],
  [/secur|audit|risk|threat|review|安全|审计|审查|风险/, '🛡️'],
  [/docs|writer|product|spec|coordin|撰写|文案|写作|文档|协调/, '📝'],
  [/release|\bbuild\b|deploy|\bops\b|\bci\b|ship/, '🚀'],
]

function stableHash(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

/** Pick a stable occupation glyph for a member from name + role. */
function memberIcon(name: string, role: string): string {
  const identity = `${name} ${role}`.toLowerCase()
  for (const [pattern, icon] of ROLE_ICONS) {
    if (pattern.test(identity)) return icon
  }
  return name.trim().slice(0, 1).toUpperCase() || '?'
}

/** Stable accent color for a member card (hash of id over a token-safe set). */
const ACCENTS = [
  'var(--dsw-alias-bg-fill-business)',
  'var(--dsw-alias-bg-fill-success)',
  'var(--dsw-alias-bg-fill-danger)',
  'var(--dsw-alias-bg-fill-warning)',
  'var(--dsw-alias-bg-fill-neutral)',
] as const

function accentOf(id: string): string {
  return ACCENTS[stableHash(id) % ACCENTS.length] ?? ACCENTS[0]
}

function dotState(running: boolean, deleted: boolean): StateDotState {
  if (deleted) return 'warning'
  return running ? 'ongoing' : 'done'
}

/** The dependency chain of a task: its dependencies plus its dependents. */
function dependencyChain(taskId: string, tasks: readonly WorkbenchTaskData[]): Set<string> {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const chain = new Set<string>([taskId])
  const visit = (id: string): void => {
    const task = byId.get(id)
    if (task === undefined) return
    for (const dependency of task.dependencies) {
      if (!chain.has(dependency)) {
        chain.add(dependency)
        visit(dependency)
      }
    }
  }
  visit(taskId)
  for (const task of tasks) {
    if (task.dependencies.includes(taskId) && !chain.has(task.id)) {
      chain.add(task.id)
      visit(task.id)
    }
  }
  return chain
}

// ── formation ─────────────────────────────────────────────────────────────

function MemberCard({ data, running, unread, onOpen, t }: {
  readonly data: AgentTeamsWorkbenchData['members'][number]
  readonly running: boolean
  readonly unread: boolean
  readonly onOpen: (id: SessionId) => void
  readonly t: AgentTeamsWorkbenchPanelProps['t']
}) {
  return (
    <div className={css.memberCard} data-member-running={running}>
      <span className={css.avatar} style={{ background: accentOf(data.id) }} data-avatar="member">
        {memberIcon(data.name, data.role)}
      </span>
      <div className={css.memberBody}>
        <button
          type="button"
          className={css.memberName}
          aria-label={t('member.open', { name: data.name })}
          onClick={() => { onOpen(data.id as SessionId) }}
        >
          {data.name}
        </button>
        <span className={css.memberMeta}>
          <StateDot state={dotState(running, false)} />
          <span>{running ? t('member.working') : t('member.idle')}</span>
          {data.role !== '' && (
            <>
              <span className={css.separator} aria-hidden />
              <span className={css.memberRole}>{t('member.role', { role: data.role })}</span>
            </>
          )}
        </span>
        <span className={css.memberProgress} aria-label={`${data.done}/${data.total}`}>
          <span
            className={css.memberProgressFill}
            style={{ width: `${data.progress}%` }}
            data-progress={data.progress}
          />
        </span>
        <span className={css.memberTaskLine}>
          <span className={css.memberTaskLabel}>{t('member.current')}</span>
          <span className={css.memberTaskId}>{data.currentTask === '' ? '—' : data.currentTask}</span>
          <span className={css.memberTaskCount}>{data.done}/{data.total}</span>
        </span>
      </div>
      {unread && <span className={css.unreadBadge} aria-label="unread" />}
    </div>
  )
}

function Formation({ data, runningIds, openSession, t }: {
  readonly data: AgentTeamsWorkbenchData
  readonly runningIds: ReadonlySet<string>
  readonly openSession: (id: SessionId) => void
  readonly t: AgentTeamsWorkbenchPanelProps['t']
}) {
  return (
    <div className={css.formation}>
      <div className={css.captainCard} data-team-status={data.status}>
        <span className={css.avatar} style={{ background: 'var(--dsw-alias-bg-fill-business)' }} data-avatar="captain">
          👑
        </span>
        <div className={css.captainBody}>
          <span className={css.captainName} data-captain-name>{t('title', { name: data.teamName })}</span>
          <span className={css.captainMeta}>
            <StateDot state={dotState(false, data.status === 'deleted')} />
            <span>{t(STATUS_KEYS[data.status])}</span>
            <span className={css.separator} aria-hidden />
            <span>{t(data.members.length !== 1 ? 'members.other' : 'members.one', { count: data.members.length })}</span>
          </span>
        </div>
      </div>
      {data.members.length > 0 && (
        <div className={css.membersRow}>
          {data.members.map(member => (
            <MemberCard
              key={member.id}
              data={member}
              running={runningIds.has(member.id)}
              unread={member.unread > 0}
              onOpen={openSession}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── task lanes ────────────────────────────────────────────────────────────

function TaskCard({ task, focused, dimmed, onHover, onLeave, t }: {
  readonly task: WorkbenchTaskData
  readonly focused: boolean
  readonly dimmed: boolean
  readonly onHover: (id: string) => void
  readonly onLeave: () => void
  readonly t: AgentTeamsWorkbenchPanelProps['t']
}) {
  return (
    <button
      type="button"
      className={css.taskCard}
      data-task-state={task.state}
      data-chain-active={focused}
      style={{
        left: task.x,
        top: task.y,
        opacity: dimmed ? 0.35 : task.state === 'blocked' ? 0.72 : 1,
      }}
      onMouseEnter={() => { onHover(task.id) }}
      onMouseLeave={onLeave}
      onFocus={() => { onHover(task.id) }}
      onBlur={onLeave}
    >
      <span className={css.taskHead}>
        <span className={css.taskId} data-task-id>{task.id}</span>
        <span className={css.taskBadge} data-task-state={task.state}>{t(TASK_STATE_KEYS[task.state])}</span>
      </span>
      <span className={css.taskSubject} data-task-subject>{task.subject}</span>
      <span className={css.taskFoot}>
        <span className={css.taskOwner} data-task-owner>{task.assignee === '' ? '·' : task.assignee}</span>
        <span className={css.taskDeps}>
          {task.dependencies.length > 0
            ? t('task.dependsOn', { deps: task.dependencies.map(id => id.replace(/^t/i, '#')).join(',') })
            : t('task.start')}
        </span>
      </span>
      {task.state === 'running' && (
        <span className={css.taskProgress} data-progress="indeterminate" />
      )}
    </button>
  )
}

function TaskLanes({ data, focusedTaskId, onHover, onLeave, t }: {
  readonly data: AgentTeamsWorkbenchData
  readonly focusedTaskId: string | null
  readonly onHover: (id: string) => void
  readonly onLeave: () => void
  readonly t: AgentTeamsWorkbenchPanelProps['t']
}) {
  const chain = focusedTaskId === null ? null : dependencyChain(focusedTaskId, data.tasks)
  const byId = useMemo(
    () => new Map(data.tasks.map((task) => [task.id, task])),
    [data.tasks],
  )
  const edges: Array<{ from: WorkbenchTaskData; to: WorkbenchTaskData }> = []
  for (const task of data.tasks) {
    for (const dependencyId of task.dependencies) {
      const dependency = byId.get(dependencyId)
      if (dependency !== undefined) edges.push({ from: dependency, to: task })
    }
  }
  return (
    <div className={css.taskArea} style={{ width: data.width, height: data.height }}>
      {data.lanes.map((lane) => (
        <div
          key={lane.depth}
          className={css.lane}
          style={{ left: lane.x, top: lane.y, width: lane.width, height: lane.height }}
          data-lane={lane.depth}
        >
          <span className={css.laneLabel} data-lane-label>{lane.depth === 0 ? 'Ⅰ' : 'Ⅱ'}</span>
        </div>
      ))}
      <svg className={css.edges} width={data.width} height={data.height} aria-hidden>
        {edges.map(({ from, to }) => {
          const satisfied = from.state === 'completed'
          const x1 = from.x + 4
          const y1 = from.y + TASK_HEIGHT / 2
          const x2 = to.x + TASK_WIDTH - 4
          const y2 = to.y + TASK_HEIGHT / 2
          const midX = (x1 + x2) / 2
          return (
            <path
              key={`${from.id}-${to.id}`}
              d={`M ${x1},${y1} C ${midX},${y1} ${midX},${y2} ${x2},${y2}`}
              className={css.edge}
              data-satisfied={satisfied}
            />
          )
        })}
      </svg>
      {data.tasks.map(task => (
        <TaskCard
          key={task.id}
          task={task}
          focused={chain?.has(task.id) ?? false}
          dimmed={chain !== null && !chain.has(task.id)}
          onHover={onHover}
          onLeave={onLeave}
          t={t}
        />
      ))}
    </div>
  )
}

// ── message feed ──────────────────────────────────────────────────────────

type FeedCategory = 'assignment' | 'peer' | 'report' | 'system'

const FEED_CATEGORY_KEYS = {
  assignment: 'feed.category.assignment',
  peer: 'feed.category.peer',
  report: 'feed.category.report',
  system: 'feed.category.system',
} as const satisfies Record<FeedCategory, AgentTeamsKey>

function feedCategory(message: WorkbenchMessageData, captain: string): FeedCategory {
  if (message.from === captain && message.to !== captain) return 'assignment'
  if (message.to === captain) return 'report'
  if (message.from === captain && message.to === captain) return 'system'
  return 'peer'
}

function FeedRow({ message, category, t }: {
  readonly message: WorkbenchMessageData
  readonly category: FeedCategory
  readonly t: AgentTeamsWorkbenchPanelProps['t']
}) {
  return (
    <div className={css.feedRow} data-feed-category={category}>
      <span className={css.feedBadge} data-feed-category={category}>{t(FEED_CATEGORY_KEYS[category])}</span>
      <span className={css.feedRoute}>{message.from} → {message.to}</span>
      <span className={css.feedContent} title={message.content}>{message.content}</span>
    </div>
  )
}

/** Render one durable team as a compact in-conversation workbench. */
export function AgentTeamsWorkbenchPanel({ node, useSessions, openSession, t }: AgentTeamsWorkbenchPanelProps) {
  const data = node.data as AgentTeamsWorkbenchData
  const [feedOpen, setFeedOpen] = useState(false)
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
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
  const captainKey = 'captain'
  const feed = feedOpen
    ? data.messages.map(message => ({ message, category: feedCategory(message, captainKey) })).reverse()
    : []
  return (
    <section className={css.root} data-agent-teams-workbench data-team-status={data.status}>
      <Formation data={data} runningIds={runningIds} openSession={openSession} t={t} />
      {data.tasks.length > 0 ? (
        <TaskLanes
          data={data}
          focusedTaskId={focusedTaskId}
          onHover={setFocusedTaskId}
          onLeave={() => { setFocusedTaskId(null) }}
          t={t}
        />
      ) : (
        <span className={css.empty} data-team-empty>{t('task.none')}</span>
      )}
      <button
        type="button"
        className={css.feedToggle}
        data-feed-open={feedOpen}
        onClick={() => { setFeedOpen(value => !value) }}
      >
        <span>{t('feed.title', { count: data.messages.length })}</span>
        <span className={css.feedToggleAction}>{feedOpen ? t('feed.hide') : t('feed.show')}</span>
      </button>
      {feedOpen && (
        <div className={css.feed} data-feed>
          {feed.length === 0
            ? <span className={css.feedEmpty}>{t('feed.empty')}</span>
            : feed.map(({ message, category }) => (
              <FeedRow key={message.id} message={message} category={category} t={t} />
            ))}
        </div>
      )}
    </section>
  )
}
