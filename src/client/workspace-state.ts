/** Plugin-instance state shared by the monitor and any number of native tabs. */
import type { AgentTeamsCardData } from './agent-teams-card-definition.ts'
import type { ActivityTeam } from './activity-monitor.ts'

export type ConnectionStatus = 'loading' | 'ready' | 'error'
export interface WorkspaceSnapshot {
  readonly statuses: ReadonlyMap<string, ConnectionStatus>
  readonly history: ReadonlyMap<string, AgentTeamsCardData>
  readonly selected: ReadonlyMap<string, string>
}

export function createWorkspaceState() {
  let snapshot: WorkspaceSnapshot = { statuses: new Map(), history: new Map(), selected: new Map() }
  const listeners = new Set<() => void>()
  const publish = (next: WorkspaceSnapshot): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    status(session: string, status: ConnectionStatus) {
      if (snapshot.statuses.get(session) === status) return
      publish({ ...snapshot, statuses: new Map(snapshot.statuses).set(session, status) })
    },
    select(session: string, team: string) {
      if (snapshot.selected.get(session) === team) return
      publish({ ...snapshot, selected: new Map(snapshot.selected).set(session, team) })
    },
    remember(session: string, data: AgentTeamsCardData) {
      const owner = data.captainSessionId || session
      if (owner !== session) return
      publish({ ...snapshot,
        history: new Map(snapshot.history).set(`${owner}:${data.teamId}`, { ...data, captainSessionId: owner }),
        selected: new Map(snapshot.selected).set(owner, data.teamId),
      })
    },
  }
}
export type WorkspaceActivityState = ReturnType<typeof createWorkspaceState>

/** Records restored at mount never reopen a closed tab; new teams are announced once. */
export function createTeamDiscovery() {
  let restored = false
  let known = new Set<string>()
  return (teams: readonly ActivityTeam[]): string | undefined => {
    const added = restored ? teams.find(team => !known.has(team.teamId))?.teamId : undefined
    known = new Set(teams.map(team => team.teamId))
    restored = true
    return added
  }
}
