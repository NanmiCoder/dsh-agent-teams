/**
 * AgentTeams conversation card: the lightweight in-conversation summary for
 * one team — the captain's whale avatar and name, the member roster as
 * clickable whale avatars (opening the member's subagent transcript), and
 * an "activity panel" button that re-activates the top-right floater.
 *
 * The floater and this card share the `agent-teams:open-panel` window event
 * so the card can summon the panel even after it was closed (or when an old
 * session is re-opened for review).
 * @module dsh-agent-teams/client/card
 */

import { useEffect, useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ActivityTeam } from './ActivityPanel.tsx'
import type { AgentTeamsCardData } from './agent-teams-card-definition.ts'
import { LEAD_ART, memberArtUrl } from './artwork.ts'
import css from './AgentTeamsCard.module.css'

/** Window event name the floater listens for to open itself. */
export const OPEN_PANEL_EVENT = 'agent-teams:open-panel'

/** Navigation action injected from the plugin's own SessionsService access. */
export interface AgentTeamsCardInjected {
  readonly openSession: (id: SessionId) => void
  readonly currentSessionId: () => SessionId | undefined
}

/** Complete keyed Chat renderer props. */
export type AgentTeamsCardProps =
  PropsRuntime<'conversation.chat.node', 'agent-teams'>
  & PropsLocale<'agentTeams'>
  & AgentTeamsCardInjected

/** Re-activate the top-right activity panel, carrying this team's summary
 * so the panel can show it even when the team no longer exists on disk
 * (historical session review). */
function openActivityPanel(data: AgentTeamsCardData): void {
  window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, {
    detail: {
      teamId: data.teamId,
      captainSessionId: data.captainSessionId,
      teamName: data.teamName,
      members: data.members,
    },
  }))
}

/** Render one durable team as a compact conversation card. */
export function AgentTeamsCard({ node, openSession, currentSessionId }: AgentTeamsCardProps) {
  const data = node.data as AgentTeamsCardData
  const owner = data.captainSessionId || currentSessionId() || ''
  const [snapshot, setSnapshot] = useState<ActivityTeam | undefined>()
  useEffect(() => {
    let cancelled = false
    const tick = async (): Promise<void> => {
      for (const url of ['/plugins/dsh-agent-teams/state', '/plugins/dsh-agent-teams/state?archived=1']) {
        try {
          const response = await fetch(url, { cache: 'no-store' })
          if (!response.ok) continue
          const body = (await response.json()) as { teams?: readonly ActivityTeam[] }
          const found = Array.isArray(body.teams)
            ? body.teams.find((team) => team.teamId === data.teamId && (owner === '' || team.captainSessionId === owner))
            : undefined
          if (found !== undefined) {
            if (!cancelled) setSnapshot(found)
            return
          }
        } catch {
          // Host restarting; retry on the next poll.
        }
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, 1500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [data.teamId, owner])
  const resolved = useMemo<AgentTeamsCardData>(() => ({
    ...data,
    captainSessionId: snapshot?.captainSessionId ?? owner,
    teamName: snapshot?.name ?? data.teamName,
    members: snapshot?.members.map((member) => ({ id: member.id, name: member.name, role: member.role })) ?? data.members,
  }), [data, owner, snapshot])
  return (
    <section className={css.root} data-agent-teams-card data-team-id={resolved.teamId}>
      <header className={css.head}>
        <img className={css.leadAvatar} src={LEAD_ART} alt="" aria-hidden />
        <span className={css.teamName} title={resolved.teamName}>{resolved.teamName}</span>
        <span className={css.memberCount}>{resolved.members.length} 名成员</span>
        <button
          type="button"
          className={css.panelButton}
          onClick={() => { openActivityPanel(resolved) }}
          aria-label="打开活动面板"
          title="打开活动面板"
        >
          活动面板
        </button>
      </header>
      {resolved.members.length > 0 && (
        <div className={css.members}>
          {resolved.members.map((member) => (
            <button
              type="button"
              key={member.id}
              className={css.member}
              onClick={() => { if (member.id !== '') openSession(member.id as SessionId) }}
              title={member.role === '' ? member.name : `${member.name} · ${member.role}`}
            >
              {memberArtUrl(member.name, member.role) !== null ? (
                <img className={css.memberArt} src={memberArtUrl(member.name, member.role) ?? ''} alt="" aria-hidden />
              ) : (
                <span className={css.memberInitial}>{member.name.trim().slice(0, 1).toUpperCase() || '?'}</span>
              )}
              <span className={css.memberName}>{member.name}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
