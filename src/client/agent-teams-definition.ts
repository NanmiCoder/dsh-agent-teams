/**
 * AgentTeams Conversation Node: folds the durable `agent-teams/*` session
 * events into one keyed chat node and projects a horizontal tree
 * (captain → members → current tasks) for the renderer.
 *
 * The fold is deterministic replay of the session log: `match` reads one
 * event, `start`/`update` fold in ascending `seq` order, exactly like the
 * workflow-run node.
 * @module dsh-agent-teams/client/definition
 */

import type {
  ChatConversationViewNode, ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AgentTeamsMemberAddedData, AgentTeamsMemberRemovedData,
  AgentTeamsTaskCreatedData, AgentTeamsTaskUpdatedData,
  AgentTeamsTeamCreatedData,
} from '../event-types.ts'

/** Team tree lifecycle status shown in the panel. */
export type AgentTeamsTreeStatus = 'running' | 'deleted'

/** One task as displayed under a member. */
export interface AgentTeamsTreeTask {
  readonly id: string
  readonly subject: string
  readonly status: string
}

/** One member as displayed under the captain. */
export interface AgentTeamsTreeMember {
  readonly id: string
  readonly name: string
  readonly role: string
  /** Tasks currently assigned to this member and not yet finished. */
  readonly currentTasks: readonly AgentTeamsTreeTask[]
}

/** Final keyed Chat payload for one team. */
export interface AgentTeamsTreeData {
  readonly teamName: string
  readonly status: AgentTeamsTreeStatus
  readonly members: readonly AgentTeamsTreeMember[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Durable team tree: captain, members, and their current tasks. */
    'agent-teams': AgentTeamsTreeData
  }
}

/** Folded member record. */
interface AgentTeamsMemberState {
  readonly id: string
  readonly name: string
  readonly role?: string
  readonly removed?: boolean
}

/** Folded task record. */
interface AgentTeamsTaskState {
  readonly id: string
  readonly subject: string
  readonly status: string
  readonly assignee?: string
  readonly dependencies: readonly string[]
  readonly output?: string
}

/** Folded team record (the node's business state). */
export interface AgentTeamsNodeState {
  readonly teamId: string
  readonly name: string
  readonly description?: string
  readonly members: readonly AgentTeamsMemberState[]
  readonly tasks: readonly AgentTeamsTaskState[]
  readonly deleted?: boolean
}

/** Task statuses that keep a task visible under its member. */
const ACTIVE_TASK_STATUSES: readonly string[] = ['pending', 'claimed', 'in_progress']

function taskProjection(task: AgentTeamsTaskState): AgentTeamsTreeTask {
  return { id: task.id, subject: task.subject, status: task.status }
}

/** Rank active statuses so in_progress tasks lead a member's list. */
function activeRank(status: string): number {
  switch (status) {
    case 'in_progress': return 0
    case 'claimed': return 1
    default: return 2
  }
}

/**
 * Project the folded state into the renderer tree: one captain root and one
 * member node per live member, each carrying its unfinished assigned tasks.
 */
export function projectTree(state: AgentTeamsNodeState): AgentTeamsTreeData {
  const members = state.members
    .filter(member => member.removed !== true)
    .map(member => {
      const currentTasks = state.tasks
        .filter(task => task.assignee === member.name && ACTIVE_TASK_STATUSES.includes(task.status))
        .sort((a, b) => activeRank(a.status) - activeRank(b.status))
        .map(taskProjection)
      return {
        id: member.id,
        name: member.name,
        role: member.role ?? '',
        currentTasks,
      }
    })
  return {
    teamName: state.name,
    status: state.deleted === true ? 'deleted' : 'running',
    members,
  }
}

/** Start event must be the team creation. */
function startState(data: AgentTeamsTeamCreatedData): AgentTeamsNodeState {
  return {
    teamId: data.teamId,
    name: data.name,
    ...data.description !== undefined ? { description: data.description } : {},
    members: [],
    tasks: [],
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
    }],
  }
}

function updateTaskUpdated(state: AgentTeamsNodeState, data: AgentTeamsTaskUpdatedData): AgentTeamsNodeState {
  return {
    ...state,
    tasks: state.tasks.map(task => task.id === data.taskId
      ? {
        ...task,
        status: data.status,
        ...data.assignee !== undefined ? { assignee: data.assignee } : {},
        ...data.output !== undefined ? { output: data.output } : {},
      }
      : task),
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
    if (match.event.type === 'agent-teams/member-added') return updateMemberAdded(context.state, match.event.data)
    if (match.event.type === 'agent-teams/member-removed') return updateMemberRemoved(context.state, match.event.data)
    if (match.event.type === 'agent-teams/task-created') return updateTaskCreated(context.state, match.event.data)
    if (match.event.type === 'agent-teams/task-updated') return updateTaskUpdated(context.state, match.event.data)
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
      data: projectTree(state),
    }
  },
}
