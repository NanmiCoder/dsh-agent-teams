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

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  getActivitySnapshotsSnapshot,
  monitorAgentTeam,
  subscribeActivitySnapshots,
} from './activity-monitor.ts'
import type { AgentTeamsCardData } from './agent-teams-card-definition.ts'
import { LEAD_ART, resolveMemberArtwork, vendorSlug } from './artwork.ts'
import css from './AgentTeamsCard.module.css'

/** Member avatar with broken-image fallback to the initial-letter badge. */
function MemberAvatar({
  name,
  art,
}: {
  readonly name: string
  readonly art: string
}) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <span className={css.memberInitial}>{name.trim().slice(0, 1).toUpperCase() || '?'}</span>
  }
  return <img className={css.memberArt} src={art} alt="" aria-hidden onError={() => { setFailed(true) }} />
}

/** Window event name the floater listens for to open itself. */
export const OPEN_PANEL_EVENT = 'agent-teams:open-panel'

/** Navigation action injected from the plugin's own SessionsService access. */
export interface AgentTeamsCardInjected {
  readonly workspaceBridge?: { getSnapshot: () => unknown; subscribe: (listener: () => void) => () => void }
  readonly openMember: (parentId: SessionId, childId: SessionId) => void
}

/** Complete keyed Chat renderer props. */
export type AgentTeamsCardProps =
  PropsRuntime<'conversation.chat.node', 'agent-teams'>
  & PropsLocale<'agentTeams'>
  & AgentTeamsCardInjected

/** Open the matching team view, carrying this team's summary
 * so the panel can show it even when the team no longer exists on disk
 * (historical session review). */
export function openActivityPanel(data: AgentTeamsCardData): void {
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
const noWorkspace = () => undefined
const noSubscription = () => () => {}

export function AgentTeamsCard({ node, openMember, sessionId, t, workspaceBridge }: AgentTeamsCardProps) {
  const native = useSyncExternalStore(workspaceBridge?.subscribe ?? noSubscription, workspaceBridge?.getSnapshot ?? noWorkspace)
  const location = node.location
  // Closed turns render their card through the official, non-folding turn tail.
  if (native && (location.kind === 'turn' || location.kind === 'step') && location.turn.status === 'closed') return null
  return <AgentTeamsSummary data={node.data} openMember={openMember} sessionId={sessionId} t={t} />
}

export function AgentTeamsSummary({ data, openMember, sessionId, t }: AgentTeamsCardInjected & PropsLocale<'agentTeams'> & {
  data: AgentTeamsCardData; sessionId: string
}) {
  // `conversation.chat.node` is session-scoped, so its framework-owned id is
  // a stable owner even while another conversation becomes current.
  const owner = data.captainSessionId || sessionId
  const { teams, archivedTeams } = useSyncExternalStore(
    subscribeActivitySnapshots,
    getActivitySnapshotsSnapshot,
  )
  useEffect(() => {
    return monitorAgentTeam(owner, data.teamId)
  }, [data.teamId, owner])
  const snapshot = teams.find((team) => team.teamId === data.teamId && (owner === '' || team.captainSessionId === owner))
    ?? archivedTeams.find((team) => team.teamId === data.teamId && (owner === '' || team.captainSessionId === owner))
  const resolved = useMemo<AgentTeamsCardData>(() => ({
    ...data,
    captainSessionId: snapshot?.captainSessionId ?? owner,
    teamName: snapshot?.name ?? data.teamName,
    members: snapshot?.members.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      provider: member.provider,
      model: member.model,
    })) ?? data.members,
  }), [data, owner, snapshot])
  return (
    <section className={css.root} data-agent-teams-card data-team-id={resolved.teamId}>
      <header className={css.head}>
        <img className={css.leadAvatar} src={LEAD_ART} alt="" aria-hidden />
        <span className={css.teamName} title={resolved.teamName}>{resolved.teamName}</span>
        <span className={css.memberCount}>{t('card.memberCount', { count: resolved.members.length })}</span>
        <button
          type="button"
          className={css.panelButton}
          onClick={() => { openActivityPanel(resolved) }}
          aria-label={t('workspace.focus')}
          title={t('workspace.focus')}
        >
          {t('workspace.focus')}
        </button>
      </header>
      {resolved.members.length > 0 && (
        <div className={css.members}>
          {resolved.members.map((member) => {
            const vendor = vendorSlug(member)
            const resolved = resolveMemberArtwork({ name: member.name, role: member.role, vendor })
            const title = resolved.labelKey !== null
              ? `${member.name} · ${t('member.art.rolePrefix')}${t(resolved.labelKey)}`
              : resolved.isFallback
                ? `${member.name} · ${t('member.art.fallbackLabel')}`
                : member.name
            return (
              <button
                type="button"
                key={member.id || member.name}
                className={css.member}
                onClick={() => {
                  if (member.id !== '') openMember(owner as SessionId, member.id as SessionId)
                }}
                title={title}
              >
                {resolved.url !== null && <MemberAvatar name={member.name} art={resolved.url} />}
                <span className={css.memberName}>{member.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
