import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTeamDir, createMessage, appendMailbox, readMailbox, readUnreadMailbox, readPendingMailbox, markMailboxDelivered, writeTeam } from '../lib/state.js'
import { canDeclareDelivery } from '../lib/quality-gates.js'
import { installMailboxAdmission, mailboxPrompt } from '../lib/mailbox.js'
import { installMemberSelectionRuntime, installMemberDelegationGuard } from '../lib/members.js'
import { steerMemberPrompt } from '../lib/harness-compat.js'

function team() { return { id: 'team', name: 'Team', captainSessionId: 'captain', createdAt: 1, taskSeq: 1,
  members: [{ id: 'worker', name: 'worker', joinedAt: 1, status: 'working' }],
  tasks: [{ id: 't1', subject: 'Work', assignee: 'worker', status: 'in_progress', attempt: 1, attemptId: 'a1', dependencies: [], createdAt: 1, updatedAt: 1 }],
} }
async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), 'teams-stability-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const root = join(workspace, '.agent-teams'), state = team()
  await createTeamDir(root, state)
  const handlers = new Map()
  const ctx = { on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name) }, effect(fn) { return fn() }, logger: { warn() {} } }
  return { root, workspace, state, ctx, handlers }
}

await test('work, empty, staged, halted and escalated teams cannot falsely declare delivery', () => {
  const state = team()
  for (const status of ['pending', 'claimed', 'in_progress', 'failed']) {
    state.tasks[0].status = status
    assert.equal(canDeclareDelivery(state).ok, false, status)
  }
  state.tasks[0].status = 'completed'
  assert.equal(canDeclareDelivery(state).ok, true)
  for (const extra of [{ phase: 'staged' }, { halted: true }, { escalated: true }, { tasks: [] }]) assert.equal(canDeclareDelivery({ ...state, ...extra }).ok, false)
})

await test('inbox acceptance leaves 32 messages unread; one admitted step consumes them exactly once', async t => {
  const h = await fixture(t)
  installMailboxAdmission(h.ctx, '.agent-teams')
  const messages = Array.from({ length: 32 }, (_, n) => ({ ...createMessage('captain', 'worker', `guidance-${n}`), taskId: 't1', attemptId: 'a1' }))
  for (const message of messages) await appendMailbox(h.root, 'team', 'worker', message)
  await markMailboxDelivered(h.root, 'team', 'worker', messages.map(m => m.id))
  assert.equal((await readUnreadMailbox(h.root, 'team', 'worker')).length, 32)
  assert.equal((await readPendingMailbox(h.root, 'team', 'worker')).length, 0, 'delivered input must not be redelivered by fallback')
  const input = { id: 'host-message', content: [{ type: 'text', text: mailboxPrompt('team', 'worker', messages) }] }
  const payload = { agent: { id: 'worker', session: { header: { cwd: h.workspace }, ownEvents: () => [] } } }
  const admit = () => h.handlers.get('agent/pre-step')(payload, async () => ({ kind: 'enter', messages: [input] }))
  await h.handlers.get('agent/pre-step')(payload, async () => ({ kind: 'reject' }))
  assert.equal((await readUnreadMailbox(h.root, 'team', 'worker')).length, 32, 'rejected step is not consumption')
  assert.equal((await admit()).messages.length, 1)
  assert.equal((await readUnreadMailbox(h.root, 'team', 'worker')).length, 0)
  assert.equal((await admit()).kind, 'reject', 'duplicate wake spends no model call')
  payload.turn = 7
  payload.agent.session.ownEvents = () => [{ type: 'turn/start', data: { turn: 7 } }, { type: 'step/start', data: { turn: 7, step: 1 } }]
  assert.deepEqual(await admit(), { kind: 'enter', messages: [] }, 'already-read mail must not interrupt a pending tool-result continuation')
})

await test('old-generation guidance is discarded while current mail survives the same batch', async t => {
  const h = await fixture(t)
  installMailboxAdmission(h.ctx, '.agent-teams')
  const stale = { ...createMessage('captain', 'worker', 'STALE'), taskId: 't1', attemptId: 'old' }
  const current = { ...createMessage('captain', 'worker', 'CURRENT'), taskId: 't1', attemptId: 'a1' }
  for (const message of [stale, current]) await appendMailbox(h.root, 'team', 'worker', message)
  const decision = await h.handlers.get('agent/pre-step')({ agent: { id: 'worker', session: { header: { cwd: h.workspace }, ownEvents: () => [] } } }, async () => ({ kind: 'enter', messages: [{ content: [{ type: 'text', text: 'Agent captain sent a message:' }, { type: 'text', text: mailboxPrompt('team', 'worker', [stale, current]) }] }] }))
  assert.match(decision.messages[0].content[0].text, /CURRENT/)
  assert.doesNotMatch(decision.messages[0].content[0].text, /STALE/)
  const rows = await readMailbox(h.root, 'team', 'worker')
  assert.ok(rows[0].discardedAt); assert.equal(rows[0].readAt, undefined); assert.ok(rows[1].readAt)
})

await test('reported completion suppresses only redundant native success settlements', async t => {
  const h = await fixture(t)
  installMailboxAdmission(h.ctx, '.agent-teams')
  h.state.tasks[0].status = 'completed'
  await writeTeam(h.root, h.state)
  const summary = 'Background subagent worker finished and will do no further work unless you send it more.'
  const notice = { source: { kind: 'subagent-settled', senderSessionId: 'worker', summary }, content: [{ type: 'text', text: summary }] }
  const payload = { agent: { id: 'captain', session: { header: { cwd: h.workspace }, ownEvents: () => [] } } }
  const admit = messages => h.handlers.get('agent/pre-step')(payload, async () => ({ kind: 'enter', messages }))
  assert.equal((await admit([notice])).messages.length, 1, 'unreported completion must still reach the captain')
  const report = createMessage('worker', 'captain', 'Task t1 completed; concrete result.')
  await appendMailbox(h.root, 'team', 'captain', report)
  assert.equal((await admit([notice])).messages.length, 1, 'unaccepted mailbox report must not hide the fallback')
  await markMailboxDelivered(h.root, 'team', 'captain', [report.id])
  assert.equal((await admit([notice])).kind, 'reject', 'duplicate settlement must spend no model request')
  const user = { source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue with new work' }] }
  assert.deepEqual((await admit([notice, user])).messages, [user], 'unrelated input must survive deduplication')
  for (const altered of [
    { ...notice, source: { ...notice.source, summary: 'Background subagent worker failed before it finished.' } },
    { ...notice, source: { ...notice.source, senderSessionId: 'unrelated' } },
    { ...notice, source: { kind: 'user' } },
  ]) assert.equal((await admit([altered])).messages.length, 1)
  h.state.tasks.push({ ...h.state.tasks[0], id: 't2', status: 'failed', updatedAt: Date.now() + 1 })
  h.state.taskSeq = 2
  await writeTeam(h.root, h.state)
  assert.equal((await admit([notice])).messages.length, 1, 'an older report cannot hide a newer unsuccessful task')
  h.state.tasks.pop()
  h.state.tasks[0].status = 'in_progress'
  await writeTeam(h.root, h.state)
  assert.equal((await admit([notice])).messages.length, 1, 'unfinished work still needs settlement attention')
})

await test('next-step steering preserves the native delivery modes across all three contracts', async () => {
  const signal = new AbortController().signal, calls = [], captain = { id: 'captain' }, content = [{ type: 'text', text: 'guidance' }]
  const modern = { [Symbol.for('dsh.subagent.deliverPrompt')](...args) { assert.equal(this, modern); calls.push(args.at(-1)); return 'id' } }
  await steerMemberPrompt(modern, captain, 'worker', content, signal)
  assert.deepEqual(calls, ['steer'])
  await steerMemberPrompt({ sendMessage() { calls.push('public-steer'); return 'id' } }, captain, 'worker', content, signal)
  const legacy = { followup() { calls.push('cold'); return 'id' } }
  await steerMemberPrompt(legacy, captain, 'worker', content, signal, { id: 'worker', session: { header: { parentSession: 'captain' } }, steer() { calls.push('live-steer') } })
  await steerMemberPrompt(legacy, captain, 'worker', content, signal)
  assert.deepEqual(calls, ['steer', 'public-steer', 'live-steer', 'cold'])
})

await test('internal wakeups and cold admission are rejected for stopped or retired members', async t => {
  const h = await fixture(t), hooks = new Map()
  const child = { id: 'worker', session: { header: { cwd: h.workspace, parentSession: 'captain' }, ownEvents: () => [{ type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider: 'spawn', label: 'agent-teams:team:worker' } }] } }
  let setup
  h.ctx.subagents = { registerContinuableSetup(fn) { setup = fn } }
  installMemberSelectionRuntime(h.ctx, '.agent-teams')
  setup({ agent: child, on(name, fn) { hooks.set(name, fn); return () => hooks.delete(name) } })
  const admit = () => hooks.get('agent/pre-step')({ agent: child }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal((await admit()).kind, 'enter')
  h.state.members[0].stopping = true; await writeTeam(h.root, h.state)
  assert.equal((await admit()).kind, 'reject')
  h.state.members[0].stopping = false; h.state.members[0].status = 'removed'; await writeTeam(h.root, h.state)
  assert.equal((await admit()).kind, 'reject')
  await rm(join(h.root, 'team'), { recursive: true })
  assert.equal((await admit()).kind, 'reject')
})

await test('member-relative delegation limit covers raw runtime calls and preserves unrelated siblings', async t => {
  const h = await fixture(t), handles = new Map(), created = []
  const captain = { id: 'captain', session: { header: { cwd: h.workspace }, ownEvents: () => [] } }
  const worker = { id: 'worker', session: { header: { cwd: h.workspace, parentSession: 'captain' }, ownEvents: () => [{ type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider: 'spawn', label: 'agent-teams:team:worker' } }] } }
  handles.set('captain', captain); handles.set('worker', worker)
  h.ctx.agents = { get: id => handles.get(id) }
  h.ctx.subagents = { async start(_name, request) { created.push(request.parent.id) }, async startContinuable(spec) { created.push(spec.request.parent.id) } }
  installMemberDelegationGuard(h.ctx, '.agent-teams', 0)
  await assert.rejects(h.ctx.subagents.start('spawn', { parent: worker }), /delegation limit/)
  await assert.rejects(h.ctx.subagents.startContinuable({ request: { parent: worker } }), /delegation limit/)
  await h.ctx.subagents.start('spawn', { parent: captain })
  assert.deepEqual(created, ['captain'])
})
