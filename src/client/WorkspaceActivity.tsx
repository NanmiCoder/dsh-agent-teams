/** Native workspace content; discovery remains mounted independently of tab lifetime. */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { ActivityPanel, TeamSection, historicCardTeam, type ActivityPanelProps } from './ActivityPanel.tsx'
import { OPEN_PANEL_EVENT } from './AgentTeamsCard.tsx'
import type { AgentTeamsCardData } from './agent-teams-card-definition.ts'
import { currentSessionId } from './session-navigation.ts'
import { getActivityMonitorTargetsSnapshot, getActivitySnapshotsSnapshot, startActivityPolling, subscribeActivityMonitorTargets, subscribeActivitySnapshots, updateActivitySnapshots } from './activity-monitor.ts'
import { createTeamDiscovery, type WorkspaceActivityState } from './workspace-state.ts'
import css from './WorkspaceActivity.module.css'

export const TEAM_TAB_KIND = 'agent-teams'
export const TEAM_TAB_ID = '@nanmicoder/dsh-agent-teams/activity'

/** Optional host integration is observable so installing/removing it also switches the fallback. */
export function createWorkspaceBridge() {
  let sidebar: ISidebarRight | undefined
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => sidebar,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(value: ISidebarRight | undefined) { sidebar = value; for (const listener of listeners) listener() },
  }
}

export function ActivitySurface({ bridge, state, ...props }: ActivityPanelProps & {
  bridge: ReturnType<typeof createWorkspaceBridge>
  state: WorkspaceActivityState
}) {
  const sidebar = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot)
  return sidebar === undefined ? <ActivityPanel {...props} /> : <WorkspaceMonitor {...props} sidebar={sidebar} state={state} />
}

function WorkspaceMonitor({ sessionsList, sidebar, state }: ActivityPanelProps & {
  sidebar: ISidebarRight
  state: WorkspaceActivityState
}) {
  const current = currentSessionId(useSyncExternalStore(sessionsList.subscribe, sessionsList.getSnapshot))
  const targets = useSyncExternalStore(subscribeActivityMonitorTargets, getActivityMonitorTargetsSnapshot)
  const currentTargets = useMemo(() => targets.filter(target => target.sessionId === current), [targets, current])
  // One discovery tracker per visit, outside polling effects restarted by card registration.
  const discover = useMemo(() => createTeamDiscovery(), [current])
  useEffect(() => {
    if (current === undefined) return
    state.status(current, 'loading')
    const controller = startActivityPolling(currentTargets, {
      discoverySessionId: current,
      onStatus(status) {
        state.status(current, status)
      },
      publishSnapshots(update) {
        updateActivitySnapshots(update)
        if (update.teams === undefined) return
        const added = discover(update.teams.filter(team => team.captainSessionId === current))
        // Do not replace a file/terminal, or navigate a session whose surface is not bound.
        if (added !== undefined && sidebar.mounted.getSnapshot() === current && !sidebar.isExpanded()) {
          state.select(current, added)
          sidebar.openTab(TEAM_TAB_KIND)
        }
      },
    })
    return () => { controller.stop() }
  }, [current, currentTargets, discover, sidebar, state])
  useEffect(() => {
    const open = (event: Event): void => {
      if (current === undefined || sidebar.mounted.getSnapshot() !== current) return
      const data = (event as CustomEvent<AgentTeamsCardData>).detail
      if (data?.captainSessionId && data.captainSessionId !== current) return
      if (data?.teamId) state.remember(current, data)
      sidebar.openTab(TEAM_TAB_KIND)
    }
    window.addEventListener(OPEN_PANEL_EVENT, open)
    return () => { window.removeEventListener(OPEN_PANEL_EVENT, open) }
  }, [current, sidebar, state])
  return null
}

export type WorkspaceActivityProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'agentTeams'> & {
  state: WorkspaceActivityState
  modelDirectories: ActivityPanelProps['modelDirectories']
  openMember: ActivityPanelProps['openMember']
}

export function WorkspaceActivity({ sessionId, useTabInfo, t, state, modelDirectories, openMember }: WorkspaceActivityProps) {
  const { tab } = useTabInfo()
  const snapshots = useSyncExternalStore(subscribeActivitySnapshots, getActivitySnapshotsSnapshot)
  const local = useSyncExternalStore(state.subscribe, state.getSnapshot)
  const [retry, setRetry] = useState(0)
  const live = snapshots.teams.filter(team => team.captainSessionId === sessionId)
  const archived = snapshots.archivedTeams.filter(team => team.captainSessionId === sessionId && !live.some(item => item.teamId === team.teamId))
  const historic = [...local.history.values()].filter(team => team.captainSessionId === sessionId
    && !live.some(item => item.teamId === team.teamId) && !archived.some(item => item.teamId === team.teamId))
    .map(team => historicCardTeam(team, sessionId))
  const records = [...live, ...archived, ...historic]
  const selected = records.find(team => team.teamId === local.selected.get(sessionId)) ?? records[0]
  const history = selected !== undefined && !live.includes(selected)
  const status = local.statuses.get(sessionId) ?? 'loading'
  // Explicit reconnect is bounded and cleaned up; ordinary polling is owned by the monitor.
  useEffect(() => {
    if (retry === 0 || !tab.visible) return
    const controller = startActivityPolling([], { discoverySessionId: sessionId, onStatus: value => state.status(sessionId, value) })
    void controller.firstTick.finally(() => { controller.stop() })
    return () => { controller.stop() }
  }, [retry, sessionId, state, tab.visible])
  const backToChat = (): void => {
    // Closing this occurrence does not cancel a team or destroy other workspace tabs.
    tab.actions.close()
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-composer-card] [contenteditable="true"][role="textbox"], [data-composer-card] textarea')?.focus())
  }
  return (
    <div className={css.root} data-agent-teams-workspace data-session-id={sessionId}>
      <div className={css.content}>
        {status === 'error' && <div className={css.error} role="alert"><span>{t('workspace.error')}</span><button onClick={() => setRetry(value => value + 1)}>{t('workspace.retry')}</button></div>}
        {records.length > 1 && <nav className={css.selector} aria-label={t('workspace.title')}>
          {records.map(team => <button key={team.teamId} aria-pressed={selected?.teamId === team.teamId} onClick={() => state.select(sessionId, team.teamId)}>{team.name}<span>{t(live.includes(team) ? 'workspace.current' : 'workspace.history')}</span></button>)}
        </nav>}
        {selected === undefined ? status === 'loading' ? <div className={css.skeleton} role="status" aria-label={t('workspace.loading')}><i /><i /><i /></div> : <section className={css.empty}>
          <span className={css.emptyMark} aria-hidden>↳</span>
          <h3>{t('workspace.emptyTitle')}</h3><p>{t('workspace.emptyBody')}</p>
          <button onClick={backToChat}>{t('workspace.back')}</button>
        </section> : <>
          <TeamSection key={`${sessionId}:${selected.teamId}`} team={selected} workspace historic={history}
            modelDirectory={selected.phase === 'staged' ? modelDirectories.directoryFor(sessionId) : undefined}
            onContinuePlanning={backToChat} onDiscarded={backToChat} onNavigate={openMember} t={t} />
        </>}
      </div>
    </div>
  )
}
