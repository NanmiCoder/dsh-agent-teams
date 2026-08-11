/** Browser plugin for durable AgentTeams tree Conversation Nodes. */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AgentTeamsTreePanel, type AgentTeamsInjected } from './AgentTeamsTreePanel.tsx'
import { en, NS, type AgentTeamsKey, zh } from './locales.ts'
import { agentTeamsRunDefinition } from './agent-teams-definition.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Durable AgentTeams tree node copy. */
    agentTeams: AgentTeamsKey
  }
}

/** Required services for Definition, keyed renderer, navigation, and copy. */
export const inject = ['conversationEvents', 'slots', 'sessions', 'locale']

/** Register the Definition, dictionary, and keyed Chat renderer. */
export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(agentTeamsRunDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'agent-teams: dictionaries')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'agent-teams',
    locale: NS,
    inject: (): AgentTeamsInjected => ({
      openSession: (id: SessionId) => { ctx.sessions.open(id) },
    }),
  }, AgentTeamsTreePanel))
}
