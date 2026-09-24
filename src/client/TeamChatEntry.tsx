/** Session-owned entry points: a persistent title action and a durable turn card. */
import { useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { AgentTeamsSummary, openActivityPanel, type AgentTeamsCardInjected } from './AgentTeamsCard.tsx'
import { getActivitySnapshotsSnapshot, subscribeActivitySnapshots } from './activity-monitor.ts'
import { teamCardsForTurn } from './agent-teams-card-definition.ts'
import { LEAD_ART } from './artwork.ts'
import css from './AgentTeamsCard.module.css'

export function TeamChatEntry({ sessionId, t }: PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'agentTeams'>) {
  const { teams, archivedTeams } = useSyncExternalStore(subscribeActivitySnapshots, getActivitySnapshotsSnapshot)
  const team = [...teams, ...archivedTeams].find(team => team.captainSessionId === sessionId)
  if (!team) return null
  return <button className={css.chatEntry} data-team-chat-entry type="button" title={t('workspace.focus')}
    onClick={() => openActivityPanel({ teamId: team.teamId, captainSessionId: sessionId, teamName: team.name, members: team.members })}>
    <img src={LEAD_ART} alt="" aria-hidden />{t('workspace.focus')}
  </button>
}

export function TeamTurnCard({ sessionId, turn, useChat, t, openMember }: PropsRuntime<'conversation.chat.turnTail'> & PropsLocale<'agentTeams'> & AgentTeamsCardInjected) {
  const nodes = useChat(snapshot => snapshot.nodes)
  const cards = teamCardsForTurn(nodes.values(), turn.turn)
  if (turn.status !== 'closed' || cards.length === 0) return null
  return <div className={css.turnCards} data-team-turn-cards>{cards.map(node => <AgentTeamsSummary key={node.key}
    data={node.data as import('./agent-teams-card-definition.ts').AgentTeamsCardData}
    sessionId={sessionId} t={t} openMember={openMember} />)}</div>
}
