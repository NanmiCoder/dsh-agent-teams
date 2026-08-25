/** Captain-chat banner: the team is still working, even when the captain is idle. */

import { useCallback, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { teamIsActive, teamProgressSummary } from './activity-model.ts'
import {
  ACTIVITY_HALT_URL,
  getActivitySnapshotsSnapshot,
  subscribeActivitySnapshots,
} from './activity-monitor.ts'
import css from './TeamProgressBanner.module.css'
import type { AgentTeamsTranslate } from './locales.ts'

export type TeamProgressBannerProps =
  PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'agentTeams'>

function bannerDetail(t: AgentTeamsTranslate, working: number, detail: string, taskCount: number): string {
  if (working > 0 && detail !== '') return t('banner.workingDetail', { count: working, detail })
  if (working > 0) return t('banner.working', { count: working })
  if (taskCount === 0) return t('banner.planning')
  return t('banner.waiting')
}

export function TeamProgressBanner({ sessionId, t }: TeamProgressBannerProps) {
  const snapshots = useSyncExternalStore(subscribeActivitySnapshots, getActivitySnapshotsSnapshot)
  const owner = sessionId?.trim() ?? ''
  // A halted snapshot is still needed while the stop request drains live child
  // activations (and to show a retryable error if that drain fails).
  const team = owner === '' ? undefined : snapshots.teams.find((candidate) => candidate.captainSessionId === owner)
  const [stopping, setStopping] = useState(false)
  const [failed, setFailed] = useState(false)
  const stopTeam = useCallback(async () => {
    if (team === undefined || stopping) return
    setStopping(true)
    setFailed(false)
    try {
      const response = await fetch(ACTIVITY_HALT_URL, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, teamId: team.teamId }),
      })
      if (!response.ok) throw new Error(`halt failed: ${response.status}`)
    } catch {
      setFailed(true)
    } finally {
      setStopping(false)
    }
  }, [sessionId, stopping, team])
  // The host marks a team halted before draining its member activations so the
  // scheduler cannot race in new work. Keep this banner mounted during that
  // drain: its disappearance therefore means the stop request has completed,
  // rather than merely that durable task state was cancelled.
  if (team === undefined || (!teamIsActive(team) && !stopping && !failed)) return null
  const summary = teamProgressSummary(team, t('format.listSeparator'))
  return (
    <div className={css.root} data-agent-teams-banner data-team-id={team.teamId}>
      <div className={css.copy}>
        <span className={css.title}>{t('banner.title')}</span>
        <span className={css.detail}>{bannerDetail(t, summary.working, summary.detail, team.tasks.length)}</span>
      </div>
      <button
        type="button"
        className={css.stop}
        disabled={stopping}
        onClick={() => { void stopTeam() }}
      >
        {stopping ? t('banner.stopping') : t('banner.stop')}
      </button>
      {failed ? <span className={css.error}>{t('banner.stopFailed')}</span> : null}
    </div>
  )
}
