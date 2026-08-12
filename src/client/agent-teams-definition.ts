/**
 * AgentTeams Conversation Node: folds the durable `agent-teams/*` session
 * events into one keyed chat node and projects a compact workbench — the
 * captain formation, members with progress, and a dependency-lane DAG of
 * tasks — for the renderer.
 *
 * The layout model is ported from the Claude Code desktop AgentTeams
 * workbench (AgentTeamsCanvas/agentTeamsModel): task depth is its longest
 * dependency path, each depth owns one left-to-right lane, and a task's
 * visual state derives from status plus dependencies (blocked while any
 * dependency is unfinished).
 *
 * The fold is deterministic replay of the session log: `match` reads one
 * event, `start`/`update` fold in ascending `seq` order.
 * @module dsh-agent-teams/client/definition
 */

import type {
  ChatConversationViewNode, ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AgentTeamsMemberAddedData, AgentTeamsMemberRemovedData,
  AgentTeamsMessageSentData, AgentTeamsTaskCreatedData,
  AgentTeamsTaskUpdatedData, AgentTeamsTeamCreatedData,
} from '../event-types.ts'

/** Team tree lifecycle status shown in the panel. */
export type AgentTeamsTreeStatus = 'running' | 'deleted'

/** Visual task state: derives from status plus dependency completion. */
export type WorkbenchTaskState = 'blocked' | 'open' | 'running' | 'completed'

/** One positioned task card in the DAG lanes. */
export interface WorkbenchTaskData {
  readonly id: string
  readonly subject: string
  readonly state: WorkbenchTaskState
  /** Raw task status (`pending`/`claimed`/`in_progress`/`completed`/…). */
  readonly status: string
  readonly assignee: string
  readonly dependencies: readonly string[]
  readonly depth: number
  readonly x: number
  readonly y: number
  /** Sequence of the event that started this task (current-task tiebreak). */
  readonly startedSeq: number
}

/** One dependency lane (one depth column). */
export interface WorkbenchLaneData {
  readonly depth: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly count: number
}

/** One member card in the formation row. */
export interface WorkbenchMemberData {
  readonly id: string
  readonly name: string
  readonly role: string
  /** Completed ÷ owned tasks, 0..100. */
  readonly progress: number
  readonly done: number
  readonly total: number
  /** The task the member is on right now ('' when idle). */
  readonly currentTask: string
  /** Unread messages addressed to this member. */
  readonly unread: number
}

/** One mailbox message (from the `agent-teams/message-sent` events). */
export interface WorkbenchMessageData {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly content: string
  readonly ts: number
}

/** Final keyed Chat payload for one team workbench. */
export interface AgentTeamsWorkbenchData {
  readonly teamName: string
  readonly status: AgentTeamsTreeStatus
  readonly members: readonly WorkbenchMemberData[]
  readonly lanes: readonly WorkbenchLaneData[]
  readonly tasks: readonly WorkbenchTaskData[]
  readonly messages: readonly WorkbenchMessageData[]
  readonly width: number
  readonly height: number
  readonly taskAreaY: number
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Durable team workbench: captain formation, members, task DAG, messages. */
    'agent-teams': AgentTeamsWorkbenchData
  }
}

/** Folded member record. */
export interface AgentTeamsMemberState {
  readonly id: string
  readonly name: string
  readonly role?: string
  readonly removed?: boolean
}

/** Folded task record. */
export interface AgentTeamsTaskState {
  readonly id: string
  readonly subject: string
  readonly status: string
  readonly assignee?: string
  readonly dependencies: readonly string[]
  readonly output?: string
  readonly startedSeq: number
}

/** Folded message record. */
export interface AgentTeamsMessageState {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly content: string
  readonly ts: number
}

/** Folded team record (the node's business state). */
export interface AgentTeamsNodeState {
  readonly teamId: string
  readonly name: string
  readonly description?: string
  readonly members: readonly AgentTeamsMemberState[]
  readonly tasks: readonly AgentTeamsTaskState[]
  readonly messages: readonly AgentTeamsMessageState[]
  readonly deleted?: boolean
}

// ── layout constants (compact workbench, conversation-card scale) ─────────

/** Task card size (shared with the renderer's edge math). */
export const TASK_WIDTH = 152
export const TASK_HEIGHT = 62

const LANE_WIDTH = 168
const LANE_GAP = 12
const HORIZONTAL_PADDING = 16
const TASK_TOP = 10
const ROW_GAP = 10
const AREA_TOP_PADDING = 6

const TASK_ID_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function compareTaskIds(left: string, right: string): number {
  const naturalOrder = TASK_ID_COLLATOR.compare(left, right)
  if (naturalOrder !== 0) return naturalOrder
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * The visual state of one task: `running` while in_progress, `completed`
 * when done, `blocked` while any dependency is unfinished, else `open`.
 */
export function workbenchTaskState(
  task: Pick<AgentTeamsTaskState, 'status' | 'dependencies'>,
  tasksById: ReadonlyMap<string, AgentTeamsTaskState>,
): WorkbenchTaskState {
  if (task.status === 'completed') return 'completed'
  if (task.status === 'in_progress') return 'running'
  const openDependency = task.dependencies.some((dependencyId) => {
    const dependency = tasksById.get(dependencyId)
    return dependency !== undefined && dependency.status !== 'completed'
  })
  return openDependency ? 'blocked' : 'open'
}

/** Longest dependency path depth per task, with cycle/缺失 guards. */
function taskDepths(tasks: readonly AgentTeamsTaskState[]): Map<string, number> {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const depths = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (taskId: string): number => {
    const cached = depths.get(taskId)
    if (cached !== undefined) return cached
    if (visiting.has(taskId)) return 0
    const task = byId.get(taskId)
    if (task === undefined) return 0
    visiting.add(taskId)
    const dependencies = task.dependencies
      .filter((dependencyId) => byId.has(dependencyId))
      .sort(compareTaskIds)
    const depth = dependencies.length === 0
      ? 0
      : 1 + Math.max(...dependencies.map(depthOf))
    visiting.delete(taskId)
    depths.set(taskId, depth)
    return depth
  }
  for (const task of tasks) depthOf(task.id)
  return depths
}

/** Position every task into dependency lanes (depth → left-to-right column). */
export function layoutWorkbenchTasks(
  tasks: readonly AgentTeamsTaskState[],
): {
  readonly tasks: readonly WorkbenchTaskData[]
  readonly lanes: readonly WorkbenchLaneData[]
  readonly width: number
  readonly height: number
} {
  const sorted = [...tasks].sort((left, right) => compareTaskIds(left.id, right.id))
  const depths = taskDepths(sorted)
  const byLayer = new Map<number, AgentTeamsTaskState[]>()
  for (const task of sorted) {
    const depth = depths.get(task.id) ?? 0
    const layer = byLayer.get(depth)
    if (layer !== undefined) layer.push(task)
    else byLayer.set(depth, [task])
  }
  const columns = byLayer.size
  const maxRows = Math.max(0, ...Array.from(byLayer.values(), (layer) => layer.length))
  const width = HORIZONTAL_PADDING * 2
    + columns * LANE_WIDTH
    + Math.max(0, columns - 1) * LANE_GAP
  const stackHeight = maxRows === 0 ? 0 : maxRows * TASK_HEIGHT + (maxRows - 1) * ROW_GAP
  const laneHeight = TASK_TOP + stackHeight + AREA_TOP_PADDING
  const tasksById = new Map(sorted.map((task) => [task.id, task]))
  const lanes: WorkbenchLaneData[] = Array.from({ length: columns }, (_, depth) => ({
    depth,
    x: HORIZONTAL_PADDING + depth * (LANE_WIDTH + LANE_GAP),
    y: 0,
    width: LANE_WIDTH,
    height: laneHeight,
    count: byLayer.get(depth)?.length ?? 0,
  }))
  const positioned: WorkbenchTaskData[] = []
  for (const lane of lanes) {
    const layer = byLayer.get(lane.depth) ?? []
    layer.forEach((task, row) => {
      positioned.push({
        id: task.id,
        subject: task.subject,
        state: workbenchTaskState(task, tasksById),
        status: task.status,
        assignee: task.assignee ?? '',
        dependencies: task.dependencies,
        depth: lane.depth,
        x: lane.x + (LANE_WIDTH - TASK_WIDTH) / 2,
        y: TASK_TOP + row * (TASK_HEIGHT + ROW_GAP),
        startedSeq: task.startedSeq,
      })
    })
  }
  return { tasks: positioned, lanes, width, height: laneHeight }
}

/** The current task of a member: the most recently started `in_progress`. */
function currentTaskOf(
  memberName: string,
  tasks: readonly AgentTeamsTaskState[],
): string {
  let latest: AgentTeamsTaskState | undefined
  for (const task of tasks) {
    if (task.status !== 'in_progress' || task.assignee !== memberName) continue
    if (latest === undefined || task.startedSeq > latest.startedSeq) latest = task
  }
  return latest?.id ?? ''
}

/**
 * Project the folded state into the renderer workbench: formation members
 * with progress, dependency lanes, positioned tasks, and the message feed.
 */
export function projectWorkbench(state: AgentTeamsNodeState): AgentTeamsWorkbenchData {
  const members = state.members
    .filter(member => member.removed !== true)
    .map(member => {
      const owned = state.tasks.filter(task => task.assignee === member.name)
      const done = owned.filter(task => task.status === 'completed').length
      const unread = state.messages.filter(message => message.to === member.name).length
      return {
        id: member.id,
        name: member.name,
        role: member.role ?? '',
        progress: owned.length === 0 ? 0 : Math.round((done / owned.length) * 100),
        done,
        total: owned.length,
        currentTask: currentTaskOf(member.name, state.tasks),
        unread,
      }
    })
  const layout = layoutWorkbenchTasks(state.tasks)
  return {
    teamName: state.name,
    status: state.deleted === true ? 'deleted' : 'running',
    members,
    lanes: layout.lanes,
    tasks: layout.tasks,
    messages: state.messages.map(message => ({
      id: message.id,
      from: message.from,
      to: message.to,
      content: message.content,
      ts: message.ts,
    })),
    width: layout.width,
    height: layout.height,
    taskAreaY: 0,
  }
}

// ── fold ──────────────────────────────────────────────────────────────────

function startState(data: AgentTeamsTeamCreatedData): AgentTeamsNodeState {
  return {
    teamId: data.teamId,
    name: data.name,
    ...data.description !== undefined ? { description: data.description } : {},
    members: [],
    tasks: [],
    messages: [],
  }
}

function updateMemberAdded(state: AgentTeamsNodeState, data: AgentTeamsMemberAddedData): AgentTeamsNodeState {
  if (state.members.some(member => member.id === data.memberId)) return state
  return {
    ...state,
    members: [...state.members, {
      id: data.memberId,
      name: data.name,
      ...data.role !== undefined ? { role: data.role } : {},
    }],
  }
}

function updateMemberRemoved(state: AgentTeamsNodeState, data: AgentTeamsMemberRemovedData): AgentTeamsNodeState {
  return {
    ...state,
    members: state.members.map(member => member.id === data.memberId
      ? { ...member, removed: true }
      : member),
  }
}

function updateTaskCreated(state: AgentTeamsNodeState, data: AgentTeamsTaskCreatedData): AgentTeamsNodeState {
  if (state.tasks.some(task => task.id === data.taskId)) return state
  return {
    ...state,
    tasks: [...state.tasks, {
      id: data.taskId,
      subject: data.subject,
      status: 'pending',
      dependencies: data.dependencies,
      ...data.assignee !== undefined ? { assignee: data.assignee } : {},
      startedSeq: 0,
    }],
  }
}

function updateTaskUpdated(
  state: AgentTeamsNodeState,
  data: AgentTeamsTaskUpdatedData,
  seq: number,
): AgentTeamsNodeState {
  return {
    ...state,
    tasks: state.tasks.map(task => task.id === data.taskId
      ? {
        ...task,
        status: data.status,
        ...data.assignee !== undefined ? { assignee: data.assignee } : {},
        ...data.output !== undefined ? { output: data.output } : {},
        // A task that (re)enters in_progress gets the current fold sequence
        // so the renderer can tell which task the member is on right now.
        ...data.status === 'in_progress' ? { startedSeq: seq } : {},
      }
      : task),
  }
}

function updateMessageSent(state: AgentTeamsNodeState, data: AgentTeamsMessageSentData): AgentTeamsNodeState {
  if (state.messages.some(message => message.id === data.messageId)) return state
  return {
    ...state,
    messages: [...state.messages, {
      id: data.messageId,
      from: data.from,
      to: data.to,
      content: data.content,
      ts: data.ts,
    }],
  }
}

/** Durable `agent-teams/*` event family folded into one keyed Chat node. */
export const agentTeamsRunDefinition: ConversationNodeDefinition<AgentTeamsNodeState> = {
  kind: 'agent-teams',
  target: 'chat',
  match: (event) => {
    if (event.type === 'agent-teams/team-created') return { id: String(event.data.teamId), role: 'start' }
    if (event.type === 'agent-teams/member-added'
      || event.type === 'agent-teams/member-removed'
      || event.type === 'agent-teams/task-created'
      || event.type === 'agent-teams/task-updated'
      || event.type === 'agent-teams/message-sent'
      || event.type === 'agent-teams/team-deleted') {
      return { id: String(event.data.teamId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'agent-teams/team-created') {
      throw new Error('agent-teams start requires agent-teams/team-created')
    }
    return startState(match.event.data)
  },
  update: (context, match) => {
    const seq = match.event.seq
    if (match.event.type === 'agent-teams/member-added') return updateMemberAdded(context.state, match.event.data)
    if (match.event.type === 'agent-teams/member-removed') return updateMemberRemoved(context.state, match.event.data)
    if (match.event.type === 'agent-teams/task-created') return updateTaskCreated(context.state, match.event.data)
    if (match.event.type === 'agent-teams/task-updated') return updateTaskUpdated(context.state, match.event.data, seq)
    if (match.event.type === 'agent-teams/message-sent') return updateMessageSent(context.state, match.event.data)
    if (match.event.type === 'agent-teams/team-deleted') {
      return { ...context.state, deleted: true }
    }
    return context.state
  },
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.start === undefined) return null
    const state = context.state as AgentTeamsNodeState
    return {
      key: context.key,
      kind: 'agent-teams',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      data: projectWorkbench(state),
    }
  },
}
