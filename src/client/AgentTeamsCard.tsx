/**
 * AgentTeams conversation card: the lightweight in-conversation summary for
 * one team — the team name and engineering-role roster (opening a member's
 * subagent transcript), and
 * an "activity panel" button that re-activates the top-right floater.
 *
 * The floater and this card share the `agent-teams:open-panel` window event
 * so the card can summon the panel even after it was closed (or when an old
 * session is re-opened for review).
 * @module dsh-agent-teams/client/card
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  getActivitySnapshotsSnapshot,
  monitorAgentTeam,
  subscribeActivitySnapshots,
} from './activity-monitor.ts'
import type { AgentTeamsCardData } from './agent-teams-card-definition.ts'
import css from './AgentTeamsCard.module.css'

const AGENT_ROLE_LABELS: Record<string, string> = {
  'requirements-designer': '需求与设计',
  'frontend-engineer': '前端工程师',
  'qa-engineer': '测试工程师',
  reviewer: '代码审查员',
  'integration-lead': '集成负责人',
  requirements: '需求与设计',
  implementation: '开发实现',
  verification: '测试验证',
  review: '代码审查',
  repair: '修复',
  integration: '集成收尾',
}

function agentRoleLabel(value: string): string {
  return AGENT_ROLE_LABELS[value] ?? value
}

/** Window event name the floater listens for to open itself. */
export const OPEN_PANEL_EVENT = 'agent-teams:open-panel'

/** Navigation action injected from the plugin's own SessionsService access. */
export interface AgentTeamsCardInjected {
  readonly openMember: (parentId: SessionId, childId: SessionId) => void
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
export function AgentTeamsCard({ node, openMember, sessionId, t }: AgentTeamsCardProps) {
  const data = node.data as AgentTeamsCardData
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
    members: snapshot?.members.map((member) => ({ id: member.id, name: member.name, role: member.role })) ?? data.members,
  }), [data, owner, snapshot])
  return (
    <section className={css.root} data-agent-teams-card data-team-id={resolved.teamId}>
      <header className={css.head}>
        <span className={css.teamName} title={resolved.teamName}>{resolved.teamName}</span>
        <span className={css.memberCount}>{t('card.memberCount', { count: resolved.members.length })}</span>
        <button
          type="button"
          className={css.panelButton}
          onClick={() => { openActivityPanel(resolved) }}
          aria-label={t('action.openActivityPanel')}
          title={t('action.openActivityPanel')}
        >
          {t('activity.panelButton')}
        </button>
      </header>
      {resolved.members.length > 0 && (
        <div className={css.members}>
          {resolved.members.map((member) => (
            <button
              type="button"
              key={member.id}
              className={css.member}
              onClick={() => {
                if (member.id !== '') openMember(owner as SessionId, member.id as SessionId)
              }}
              title={member.role === '' ? member.name : `${member.name} · ${member.role}`}
            >
              {/* Legacy member avatar retained for reference; intentionally disabled in the text-first UI.
                  <span className={css.memberInitial} data-role={member.role || undefined} aria-hidden>{member.role.trim().slice(0, 1).toUpperCase() || member.name.trim().slice(0, 1).toUpperCase() || '?'}</span>
              */}
              <span className={css.memberName}>
                <span>{agentRoleLabel(member.name)}</span>
                {member.role !== '' && <span>{agentRoleLabel(member.role)}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
