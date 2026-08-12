/**
 * AgentTeams conversation card: a lightweight in-conversation summary shown
 * when a team is created — the captain's name, the member roster with whale
 * avatars, and an entry point that re-activates the top-right activity
 * panel (useful after the floater was closed, or when re-opening an old
 * session for review).
 *
 * The fold replays the durable `agent-teams/*` session events (the same
 * event family the activity panel's server snapshots are derived from), so
 * the card survives restarts and appears in any session whose log carries
 * the team's events.
 * @module dsh-agent-teams/client/card
 */

import type {
  ChatConversationViewNode, ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
// Module-loading imports: the declaration merges below extend modules that
// must be present in the program — a type-only import both loads them and is
// erased from the bundle.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-session/types'
import type { AgentTeamsMemberAddedData } from '../event-types.ts'

/** Final keyed Chat payload for the team summary card. */
export interface AgentTeamsCardData {
  readonly teamId: string
  /** The captain session that owns this team (panel follows it). */
  readonly captainSessionId: string
  readonly teamName: string
  readonly members: readonly {
    readonly id: string
    readonly name: string
    readonly role: string
  }[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Lightweight team summary card anchoring the conversation. */
    'agent-teams': AgentTeamsCardData
  }
}

/** Folded member record. */
interface AgentTeamsMemberState {
  readonly id: string
  readonly name: string
  readonly role?: string
  readonly removed?: boolean
}

/** Folded team record (the node's business state). */
export interface AgentTeamsNodeState {
  readonly teamId: string
  readonly captainSessionId: string
  readonly name: string
  readonly members: readonly AgentTeamsMemberState[]
}

function updateMemberAdded(state: AgentTeamsNodeState, data: AgentTeamsMemberAddedData): AgentTeamsNodeState {
  if (state.members.some((member) => member.id === data.memberId)) return state
  return {
    ...state,
    members: [...state.members, {
      id: data.memberId,
      name: data.name,
      ...data.role !== undefined ? { role: data.role } : {},
    }],
  }
}

/** Durable `agent-teams/*` events folded into one keyed Chat node. */
export const agentTeamsCardDefinition: ConversationNodeDefinition<AgentTeamsNodeState> = {
  kind: 'agent-teams',
  target: 'chat',
  match: (event) => {
    if (event.type === 'agent-teams/team-created') return { id: String(event.data.teamId), role: 'start' }
    if (event.type === 'agent-teams/member-added' || event.type === 'agent-teams/member-removed') {
      return { id: String(event.data.teamId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'agent-teams/team-created') {
      throw new Error('agent-teams card start requires agent-teams/team-created')
    }
    // Older logs predate captainSessionId on the event; the card then has no
    // owner and only shows for a matching historic injection.
    return { teamId: match.event.data.teamId, captainSessionId: match.event.data.captainSessionId ?? '', name: match.event.data.name, members: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'agent-teams/member-added') return updateMemberAdded(context.state, match.event.data)
    if (match.event.type === 'agent-teams/member-removed') {
      const removedMemberId = match.event.data.memberId
      return {
        ...context.state,
        members: context.state.members.map((member) => member.id === removedMemberId
          ? { ...member, removed: true }
          : member),
      }
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
      data: {
        teamId: state.teamId,
        captainSessionId: state.captainSessionId,
        teamName: state.name,
        members: state.members
          .filter((member) => member.removed !== true)
          .map((member) => ({
            id: member.id,
            name: member.name,
            role: member.role ?? '',
          })),
      },
    }
  },
}
