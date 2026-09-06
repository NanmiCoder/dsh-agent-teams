/** Internal implementation of the public AgentTeams Bridge service. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { join } from 'node:path'
import type {
  AgentTeamsBridge,
  TeamLifecycleEvent,
  TeamProjection,
  TeamTaskProjection,
} from './bridge.ts'
import { findTeamByCaptain, readArchivedTeam, readTeam } from './state.ts'
import type { TeamState, TeamTask } from './types.ts'

export type ActiveBridgeEventType = Exclude<TeamLifecycleEvent['type'], 'team-archived'>
export type ActiveBridgeEventArgs =
  | readonly [type: 'task-updated', stateRoot: string, teamId: string, taskId: string]
  | readonly [type: Exclude<ActiveBridgeEventType, 'task-updated'>, stateRoot: string, teamId: string]

/** Internal write-side of the event bus; never installed on the Cordis context. */
export interface AgentTeamsBridgeEventPublisher {
  publishActive(...args: ActiveBridgeEventArgs): Promise<void>
  publishArchived(stateRoot: string, teamId: string): Promise<void>
}

interface BridgeConfig {
  readonly stateDir: string
}

type Listener = (event: TeamLifecycleEvent) => void
interface ListenerRegistration {
  readonly listener: Listener
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? typeof (value as { then?: unknown }).then === 'function'
    : false
}

function freezeTask(task: TeamTask): TeamTaskProjection {
  return Object.freeze({
    id: task.id,
    subject: task.subject,
    ...task.description === undefined ? {} : { description: task.description },
    status: task.status,
    ...task.assignee === undefined ? {} : { assignee: task.assignee },
    dependencies: Object.freeze([...task.dependencies]),
    ...task.output === undefined ? {} : { output: task.output },
    ...task.attempt === undefined ? {} : { attempt: task.attempt },
    ...task.attemptId === undefined ? {} : { attemptId: task.attemptId },
    ...task.kind === undefined ? {} : { kind: task.kind },
    ...task.round === undefined ? {} : { round: task.round },
    ...task.verdict === undefined ? {} : { verdict: task.verdict },
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  })
}

/** Convert mutable internal state into a detached, deeply frozen public view. */
export function projectTeam(team: TeamState): TeamProjection {
  const members = team.members.map(member => Object.freeze({
    id: member.id,
    name: member.name,
    ...member.role === undefined ? {} : { role: member.role },
    ...member.provider === undefined ? {} : { provider: member.provider },
    ...member.model === undefined ? {} : { model: member.model },
    ...member.reasoningEffort === undefined ? {} : { reasoningEffort: member.reasoningEffort },
    joinedAt: member.joinedAt,
    status: member.status,
  }))
  return Object.freeze({
    id: team.id,
    name: team.name,
    ...team.description === undefined ? {} : { description: team.description },
    captainSessionId: team.captainSessionId,
    phase: team.phase ?? 'running',
    halted: team.halted === true,
    approvedAt: team.approvedAt,
    createdAt: team.createdAt,
    members: Object.freeze(members),
    tasks: Object.freeze(team.tasks.map(freezeTask)),
  })
}

/** Register the public service and return its private event write-side. */
export function installAgentTeamsBridge(ctx: Context, config: BridgeConfig): AgentTeamsBridgeEventPublisher {
  const listenersByCaptain = new Map<string, Set<ListenerRegistration>>()
  const publish = (type: TeamLifecycleEvent['type'], state: TeamState, taskId?: string): void => {
    const team = projectTeam(state)
    let event: TeamLifecycleEvent
    if (type === 'task-updated') {
      const task = team.tasks.find(candidate => candidate.id === taskId)
      if (task === undefined) return
      event = Object.freeze({
        apiVersion: 1,
        teamId: team.id,
        captainSessionId: team.captainSessionId,
        type,
        team,
        task,
      })
    } else {
      event = Object.freeze({
        apiVersion: 1,
        teamId: team.id,
        captainSessionId: team.captainSessionId,
        type,
        team,
      }) as TeamLifecycleEvent
    }
    for (const registration of [...(listenersByCaptain.get(team.captainSessionId) ?? [])]) {
      try {
        const result = (registration.listener as (value: TeamLifecycleEvent) => unknown)(event)
        if (isPromiseLike(result)) {
          void Promise.resolve(result).catch((error: unknown) => {
            ctx.logger.warn(`agent-teams bridge listener failed after ${type}: ${String(error)}`)
          })
        }
      } catch (error: unknown) {
        ctx.logger.warn(`agent-teams bridge listener failed after ${type}: ${String(error)}`)
      }
    }
  }

  const bridge: AgentTeamsBridge = Object.freeze({
    apiVersion: 1 as const,
    async getTeamForCaptain(captainSessionId: string): Promise<TeamProjection | null> {
      const captain = ctx.agents.get(captainSessionId as SessionId)
      const workspace = captain?.session.header.cwd
      if (workspace === undefined || workspace.trim() === '') return null
      const team = await findTeamByCaptain(join(workspace, config.stateDir), captainSessionId)
      return team === undefined ? null : projectTeam(team)
    },
    subscribeTeamEvents(captainSessionId: string, listener: Listener): () => void {
      const listeners = listenersByCaptain.get(captainSessionId) ?? new Set<ListenerRegistration>()
      const registration = { listener }
      listeners.add(registration)
      listenersByCaptain.set(captainSessionId, listeners)
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        listeners.delete(registration)
        if (listeners.size === 0) listenersByCaptain.delete(captainSessionId)
      }
    },
  })
  ctx.provide('agentTeamsBridge', bridge)

  return {
    publishActive: async (...args) => {
      const [type, stateRoot, teamId, taskId] = args
      try {
        const team = await readTeam(stateRoot, teamId)
        if (team === undefined) return
        if (type === 'team-approved' && (
          team.phase !== 'running'
          || team.members.some(member => member.status !== 'removed' && member.id === '')
        )) return
        publish(type, team, taskId)
      } catch (error: unknown) {
        ctx.logger.warn(`agent-teams bridge projection failed after ${type}: ${String(error)}`)
      }
    },
    publishArchived: async (stateRoot, teamId) => {
      try {
        const team = await readArchivedTeam(stateRoot, teamId)
        if (team === undefined) return
        publish('team-archived', team)
      } catch (error: unknown) {
        ctx.logger.warn(`agent-teams bridge projection failed after team-archived: ${String(error)}`)
      }
    },
  }
}
