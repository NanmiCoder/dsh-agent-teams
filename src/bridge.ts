/**
 * Public, read-only AgentTeams integration contract.
 *
 * Consumers should import this module through
 * `@nanmicoder/dsh-agent-teams/bridge` and inject `agentTeamsBridge` from
 * Cordis. Team mutation remains exclusively owned by the AgentTeams tools.
 * @module dsh-agent-teams/bridge
 */

/** Public API version carried by the service and every lifecycle event. */
export type AgentTeamsBridgeApiVersion = 1

/** Read-only projection of one durable team member. */
export interface TeamMemberProjection {
  readonly id: string
  readonly name: string
  readonly role?: string
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly joinedAt: number
  readonly status: 'idle' | 'working' | 'removed'
}

/** Read-only projection of one durable team task. */
export interface TeamTaskProjection {
  readonly id: string
  readonly subject: string
  readonly description?: string
  readonly status: 'pending' | 'claimed' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  readonly assignee?: string
  readonly dependencies: readonly string[]
  readonly output?: string
  readonly attempt?: number
  readonly attemptId?: string
  readonly kind?: 'requirements' | 'implementation' | 'verification' | 'review' | 'repair' | 'integration' | 'work'
  readonly round?: number
  readonly verdict?: 'pass' | 'needs_revision' | 'reject'
  readonly createdAt: number
  readonly updatedAt: number
}

/** Detached read-only snapshot of the persisted team state. */
export interface TeamProjection {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly captainSessionId: string
  readonly phase: 'staged' | 'running'
  readonly halted: boolean
  readonly approvedAt?: number
  readonly createdAt: number
  readonly members: readonly TeamMemberProjection[]
  readonly tasks: readonly TeamTaskProjection[]
}

interface TeamLifecycleEventBase {
  readonly apiVersion: AgentTeamsBridgeApiVersion
  readonly teamId: string
  readonly captainSessionId: string
}

export interface TeamStagedEvent extends TeamLifecycleEventBase {
  readonly type: 'team-staged'
  readonly team: TeamProjection
}

export interface TeamApprovedEvent extends TeamLifecycleEventBase {
  readonly type: 'team-approved'
  readonly team: TeamProjection
}

export interface TeamHaltedEvent extends TeamLifecycleEventBase {
  readonly type: 'team-halted'
  readonly team: TeamProjection
}

export interface TeamResumedEvent extends TeamLifecycleEventBase {
  readonly type: 'team-resumed'
  readonly team: TeamProjection
}

export interface TeamArchivedEvent extends TeamLifecycleEventBase {
  readonly type: 'team-archived'
  readonly team: TeamProjection
}

export interface TaskUpdatedEvent extends TeamLifecycleEventBase {
  readonly type: 'task-updated'
  readonly team: TeamProjection
  readonly task: TeamTaskProjection
}

/** Stable discriminated union of process-local lifecycle notifications. */
export type TeamLifecycleEvent =
  | TeamStagedEvent
  | TeamApprovedEvent
  | TeamHaltedEvent
  | TeamResumedEvent
  | TeamArchivedEvent
  | TaskUpdatedEvent

/** Minimal read-only service exposed on the host Cordis context. */
export interface AgentTeamsBridge {
  readonly apiVersion: 1
  getTeamForCaptain(captainSessionId: string): Promise<TeamProjection | null>
  subscribeTeamEvents(
    captainSessionId: string,
    listener: (event: TeamLifecycleEvent) => void,
  ): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Read-only AgentTeams integration surface. */
    agentTeamsBridge: AgentTeamsBridge
  }
}
