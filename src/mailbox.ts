/** Durable delivery receipts and execution-generation filtering at step admission. */
import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { acknowledgeMailbox, CAPTAIN_KEY, discardMailboxMessages, findTeamByCaptain, readMailbox, readTeam, sanitizeKey, withTeamLock } from './state.ts'
import type { TeamMessage, TeamState } from './types.ts'
import { sessionOwnEvents } from './harness-compat.ts'

const PREFIX = 'AgentTeams inbox receipt: '

export function isCurrentMail(team: TeamState, message: TeamMessage): boolean {
  if (message.discardedAt !== undefined) return false
  if (message.attemptId === undefined) return true
  return team.tasks.some(task => task.id === message.taskId && task.attemptId === message.attemptId
    && task.assignee === message.to && (task.status === 'claimed' || task.status === 'in_progress'))
}

function mailboxBody(recipient: string, messages: readonly TeamMessage[]): string {
  return messages.map(message => recipient === CAPTAIN_KEY
      ? `AgentTeams message from member ${message.from}:\n\n${message.content}`
      : `AgentTeams message from ${message.from}${message.attemptId === undefined ? '' : ` for task ${message.taskId}, attempt_id ${message.attemptId}`}:\n\n${message.content}`).join('\n\n')
}

export function mailboxPrompt(teamId: string, recipient: string, messages: readonly TeamMessage[]): string {
  return PREFIX + JSON.stringify({ teamId, recipient, ids: messages.map(message => message.id) }) + '\n\n' + mailboxBody(recipient, messages)
}

interface Receipt { teamId: string; recipient: string; ids: string[] }
function parseReceipt(text: string): Receipt | undefined {
  if (!text.startsWith(PREFIX)) return undefined
  try {
    const value: unknown = JSON.parse(text.slice(PREFIX.length).split('\n')[0]!)
    if (typeof value !== 'object' || value === null) return undefined
    const raw = value as Record<string, unknown>
    if (typeof raw['teamId'] !== 'string' || typeof raw['recipient'] !== 'string'
      || !Array.isArray(raw['ids']) || !raw['ids'].every(id => typeof id === 'string')) return undefined
    if (raw['teamId'] !== sanitizeKey(raw['teamId'])) return undefined
    return { teamId: raw['teamId'], recipient: raw['recipient'], ids: raw['ids'] as string[] }
  } catch { return undefined }
}

/** Only messages actually admitted to this recipient's step become read. */
export function installMailboxAdmission(ctx: Context, stateDir: string): void {
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const root = join(payload.agent.session.header.cwd ?? process.cwd(), stateDir)
    // The native runtime also wakes a parent when a background activation
    // settles. A successfully delivered Team report already carries that
    // result. Keep abnormal endings and missing reports as fallback signals.
    const successfulSettlements = new Set(decision.messages.flatMap(input => {
      const source = input.source
      return source?.kind === 'subagent-settled'
        && source.summary === `Background subagent ${source.senderSessionId} finished and will do no further work unless you send it more.`
        ? [source.senderSessionId as string] : []
    }))
    const redundantSettlements = new Set<string>()
    if (successfulSettlements.size > 0) {
      const owned = await findTeamByCaptain(root, payload.agent.id)
      if (owned !== undefined) await withTeamLock(`team:${root}:${owned.id}`, async () => {
        const team = await readTeam(root, owned.id)
        if (team?.captainSessionId !== payload.agent.id || team.halted) return
        const reports = await readMailbox(root, team.id, CAPTAIN_KEY)
        for (const member of team.members) {
          if (!successfulSettlements.has(member.id) || member.status === 'removed' || member.stopping) continue
          const tasks = team.tasks.filter(task => task.assignee === member.name)
          if (tasks.some(task => task.status === 'claimed' || task.status === 'in_progress')) continue
          const latest = tasks.filter(task => (task.attempt ?? 0) > 0 || task.status === 'completed').sort((a, b) => b.updatedAt - a.updatedAt)[0]
          if (latest?.status === 'completed' && reports.some(report => report.from === member.name && report.ts >= latest.updatedAt
            && report.discardedAt === undefined && (report.deliveredAt !== undefined || report.readAt !== undefined))) {
            redundantSettlements.add(member.id)
          }
        }
      })
    }
    const batches = new Map<string, { receipt: Receipt; ids: Set<string>; current: Map<string, TeamMessage> }>()
    const inputs = decision.messages.map(input => {
      // Alpha.5/0.1.2-rc.1 public steering prepends a native sender block.
      // The host-authored receipt remains a separate text block after it.
      const receipt = input.content.flatMap(block => block.type === 'text' ? [parseReceipt(block.text)] : []).find(value => value !== undefined)
      if (receipt === undefined) return { input }
      const key = JSON.stringify([receipt.teamId, receipt.recipient])
      let batch = batches.get(key)
      if (batch === undefined) { batch = { receipt, ids: new Set(), current: new Map() }; batches.set(key, batch) }
      for (const id of receipt.ids) batch.ids.add(id)
      return { input, receipt, batch }
    })
    // One read/acknowledgement per recipient per step, even for a large burst.
    for (const batch of batches.values()) {
      const { receipt } = batch
      await withTeamLock(`team:${root}:${receipt.teamId}`, async () => {
        const team = await readTeam(root, receipt.teamId)
        if (team === undefined) return
        const recipientId = receipt.recipient === CAPTAIN_KEY ? team.captainSessionId
          : team.members.find(member => member.name === receipt.recipient && member.status !== 'removed' && member.stopping !== true)?.id
        if (recipientId !== payload.agent.id) return
        const selected = (await readMailbox(root, team.id, receipt.recipient)).filter(message => batch.ids.has(message.id))
        const current = selected.filter(message => message.readAt === undefined && isCurrentMail(team, message))
        await discardMailboxMessages(root, team.id, receipt.recipient, selected.filter(message => !isCurrentMail(team, message)).map(message => message.id))
        await acknowledgeMailbox(root, team.id, receipt.recipient, current.map(message => message.id))
        batch.current = new Map(current.map(message => [message.id, message]))
      })
    }
    const admitted = []
    for (const { input, receipt, batch } of inputs) {
      if (input.source?.kind === 'subagent-settled' && redundantSettlements.has(input.source.senderSessionId)
        && input.source.summary === `Background subagent ${input.source.senderSessionId} finished and will do no further work unless you send it more.`) continue
      if (receipt === undefined || batch === undefined) { admitted.push(input); continue }
      const messages = []
      for (const id of receipt.ids) {
        const message = batch.current.get(id)
        if (message === undefined) continue
        batch.current.delete(id)
        messages.push(message)
      }
      if (messages.length > 0) admitted.push({ ...input, content: [{ type: 'text' as const, text: mailboxBody(receipt.recipient, messages) }] })
    }
    // Reject only a new turn whose sole trigger was obsolete mail. During an
    // existing turn, a status tool may have consumed this same mail already;
    // dropping its duplicate must not block the pending tool-result response.
    if (decision.messages.length > 0 && admitted.length === 0) {
      const events = sessionOwnEvents(payload.agent.session)
      let continuing = false
      for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i]!
        if (event.type === 'step/start' && event.data.turn === payload.turn) { continuing = true; break }
        if (event.type === 'turn/start') break
      }
      if (!continuing) return { kind: 'reject' }
    }
    return { ...decision, messages: admitted }
  })
}
