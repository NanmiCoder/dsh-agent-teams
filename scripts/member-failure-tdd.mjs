/** Terminal member failures, composed with Harness's actual retry plugin. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { apply as installRetry } from '@deepseek-ai/dsh-llm-retry'
import { queueSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import { installMemberSelectionRuntime } from '../lib/members.js'
import { installTeamScheduler } from '../lib/scheduler.js'
import { appendMailbox, createMessage, createTeamDir, readTeam, readMailbox, readUnreadMailbox, withTeamLock, writeTeam } from '../lib/state.js'

async function eventually(predicate) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return
    await delay(10)
  }
  assert.fail('terminal failure did not settle')
}

async function fixture(t, { captainStatus = 'idle', fallback, captainOffline = false, rejectDelivery = false } = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-member-failure-'))
  const pendingFailures = []
  let settleOnCleanup = () => {}
  t.after(async () => {
    settleOnCleanup()
    await Promise.all(pendingFailures)
    await rm(workspace, { recursive: true, force: true })
  })
  const stateRoot = join(workspace, '.agent-teams')
  const listeners = new Map()
  const steers = []
  const deliveries = []
  const warnings = []
  const sessionEvents = []
  const captain = {
    id: 'captain', status: captainStatus,
    session: { append() {} },
    steer(message) {
      if (rejectDelivery) throw new Error('captain cannot receive')
      steers.push(message)
    },
  }
  let resolveIdle
  const idle = new Promise(resolve => { resolveIdle = resolve })
  const childListeners = new Map()
  const child = {
    id: 'worker-session', status: 'running',
    whenIdle: () => child.status === 'idle' ? Promise.resolve() : idle,
    session: {
      header: { cwd: workspace, parentSession: captain.id },
      ownEvents: () => [{ type: 'subagent/descriptor', data: {
        version: 3, mode: 'continuable', provider: 'spawn', label: 'agent-teams:team:worker',
        agentProvider: 'fake', agentModel: 'primary',
      } }],
      append(type, data) { sessionEvents.push({ type, data }) },
    },
    // alpha.5 bridge reads this member id from the payload; keep the branded
    // SessionId shape of the real runtime (`ctx.agents.get(id)` uses it).
    ctx: {
      on(name, listener) { childListeners.set(name, listener); return () => childListeners.delete(name) },
    },
  }
  Object.defineProperty(child, Symbol.toPrimitive, { value: () => child.id })
  child.ctx.agent = child
  await createTeamDir(stateRoot, {
    id: 'team', name: 'Team', captainSessionId: captain.id, createdAt: 1, taskSeq: 1,
    members: [{ id: child.id, name: 'worker', status: 'working', joinedAt: 1, provider: 'fake', model: 'primary' }],
    tasks: [{ id: 't1', subject: 'work', assignee: 'worker', status: 'in_progress', dependencies: [], attempt: 1, attemptId: 'a1', createdAt: 1, updatedAt: 1 }],
  })
  // alpha.5: the bridge installs from the global `agent/session-start` event.
  let sessionStart
  const ctx = {
    logger: { debug() {}, warn(message) { warnings.push(message) } },
    agents: { get(id) { return id === child.id ? child : id === captain.id && !captainOffline ? captain : undefined } },
    on(name, listener) { if (name === 'agent/session-start') sessionStart = listener; return () => {} },
    subagents: {
      // alpha.5 Queue seam: deliveries go through the symbol-keyed host prompt queue.
      async [queueSubagentPrompt](_captain, id, content) { deliveries.push({ id, content }); return 'accepted' },
    },
  }
  const scheduler = installTeamScheduler(ctx, { stateDir: '.agent-teams' })
  const runtime = installMemberSelectionRuntime(ctx, '.agent-teams', (workspace, teamId, memberName) => (
    scheduler.kickMember(workspace, teamId, memberName)
  ))
  await runtime.withPending(captain.id, 'agent-teams:team:worker', {
    provider: 'fake', model: 'primary', ...fallback ? { fallback } : {},
  }, () => sessionStart({ agent: child }))
  let retryHandler
  let projection
  let retryState = {}
  const retryDisposers = []
  installRetry({
    logger: ctx.logger,
    sessionProjections: { register(value) { projection = value }, stateOf() { return retryState } },
    on(_name, listener) { retryHandler = listener; return () => {} },
    effect(setup) { retryDisposers.push(setup()) },
  })
  t.after(async () => { for (const dispose of retryDisposers) await dispose() })
  child.session.append = (type, data) => {
    sessionEvents.push({ type, data })
    retryState = projection.apply(retryState, { type, data })
  }
  const failure = { code: 'STREAM_CLOSED', message: 'SSE stream ended without [DONE]' }
  const payload = (policy, code = failure.code, signal = new AbortController().signal) => ({
    agent: child, turn: 1, step: 0, provider: 'fake', failure: { ...failure, code }, retryPolicy: policy, signal,
  })
  const memberError = (value, next = async () => undefined) => childListeners.get('agent/request-error')?.(value, next) ?? next()
  const settleSilently = () => {
    // The real driver settles after emitting agent/error. Deliberately omit
    // agent/status so recovery cannot depend on that edge reaching the plugin.
    child.status = 'idle'
    resolveIdle()
  }
  settleOnCleanup = settleSilently
  return {
    stateRoot, steers, deliveries, warnings, listeners, child, sessionEvents, memberError, payload, settleSilently,
    state: () => readTeam(stateRoot, 'team'),
    mailbox: () => readMailbox(stateRoot, 'team', 'captain'),
    unread: () => readUnreadMailbox(stateRoot, 'team', 'captain'),
    retry: (policy, code) => { const value = payload(policy, code); return retryHandler(value, () => memberError(value)) },
    terminal({ settle = true, turn = 1 } = {}) {
      pendingFailures.push(childListeners.get('agent/error')?.({ agent: child, turn, step: 0, error: new LlmError(failure.message, failure.code) }))
      if (settle) settleSilently()
    },
  }
}

const normal = { mode: 'normal', maxRetries: 1, retryableCodes: ['STREAM_CLOSED'], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 }
const always = { mode: 'always', initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 }

await test('always retry keeps the owned task open and sends no false failure report', async t => {
  const h = await fixture(t)
  assert.deepEqual(await h.retry(always), { kind: 'retry' })
  assert.equal((await h.state()).tasks[0].status, 'in_progress')
  assert.equal((await h.mailbox()).length, 0)
})

await test('request handler delegates recovery and leaves exhausted requests open until final error', async t => {
  const h = await fixture(t)
  let delegated = 0
  assert.deepEqual(await h.memberError(h.payload(undefined), async () => { delegated++; return { kind: 'retry' } }), { kind: 'retry' })
  assert.equal(delegated, 1)
  assert.deepEqual(await h.retry(normal), { kind: 'retry' })
  assert.equal(await h.retry(normal), undefined)
  assert.equal((await h.state()).tasks[0].status, 'in_progress')
})

await test('fallback recovers once and exhausted fallback still delegates without failing the task', async t => {
  const h = await fixture(t, { fallback: { provider: 'backup', model: 'backup-model' } })
  assert.deepEqual(await h.memberError(h.payload(undefined, 'AUTH')), { kind: 'retry' })
  assert.deepEqual(await h.memberError(h.payload(undefined, 'RATE_LIMIT'), async () => ({ kind: 'retry' })), { kind: 'retry' })
  assert.equal((await h.state()).tasks[0].status, 'in_progress')
})

await test('aborted request does not fail a task or consume its fallback route', async t => {
  const h = await fixture(t, { fallback: { provider: 'backup', model: 'backup-model' } })
  const abort = new AbortController()
  abort.abort()
  assert.equal(await h.memberError(h.payload(undefined, 'AUTH', abort.signal)), undefined)
  assert.deepEqual(await h.memberError(h.payload(undefined, 'AUTH')), { kind: 'retry' })
  assert.equal((await h.state()).tasks[0].status, 'in_progress')
})

for (const captainStatus of ['idle', 'running']) {
  await test(`final failure notifies ${captainStatus} captain once and flushes without an idle event`, async t => {
    const h = await fixture(t, { captainStatus })
    await appendMailbox(h.stateRoot, 'team', 'worker', createMessage('captain', 'worker', 'status please'))
    h.terminal()
    h.terminal()
    await eventually(async () => (await h.state()).tasks[0].status === 'failed' && h.steers.length === 1 && h.deliveries.length === 1)
    assert.equal((await h.state()).tasks[0].attemptId, 'a1')
    assert.match((await h.state()).tasks[0].output, /STREAM_CLOSED/)
    assert.equal((await h.state()).members[0].status, 'idle')
    assert.match(JSON.stringify(h.steers[0]), /t1/)
    assert.match(JSON.stringify(h.steers[0]), /STREAM_CLOSED/)
    await eventually(async () => (await h.unread()).length === 0)
    assert.equal((await h.mailbox()).length, 1)
    assert.equal((await readUnreadMailbox(h.stateRoot, 'team', 'worker')).length, 0)
    assert.equal(h.warnings.length, 0)
  })
}

await test('report a final error immediately but do not dispatch while the driver is still running', async t => {
  const h = await fixture(t)
  await appendMailbox(h.stateRoot, 'team', 'worker', createMessage('captain', 'worker', 'status please'))
  h.terminal({ settle: false })
  await eventually(async () => (await h.state()).tasks[0].status === 'failed' && h.steers.length === 1)
  assert.equal(h.child.status, 'running')
  assert.equal((await h.state()).members[0].status, 'working')
  assert.equal(h.deliveries.length, 0)
  h.settleSilently()
  await eventually(() => h.deliveries.length === 1)
  assert.equal((await h.state()).members[0].status, 'idle')
})

for (const options of [{ captainOffline: true }, { rejectDelivery: true }]) {
  await test(`unavailable captain keeps failure notification readable: ${JSON.stringify(options)}`, async t => {
    const h = await fixture(t, options)
    h.terminal()
    await eventually(async () => (await h.unread()).length === 1)
    assert.equal((await h.state()).tasks[0].status, 'failed')
    assert.equal(h.steers.length, 0)
  })
}

await test('a queued error cannot fail a newer attempt created before it gets the team lock', async t => {
  const h = await fixture(t)
  let release
  let locked
  const ready = new Promise(resolve => { locked = resolve })
  const lock = withTeamLock(`team:${h.stateRoot}:team`, async () => {
    locked()
    await new Promise(resolve => { release = resolve })
    const team = await h.state()
    team.tasks[0].attempt = 2
    team.tasks[0].attemptId = 'a2'
    await writeTeam(h.stateRoot, team)
  })
  await ready
  h.terminal()
  release()
  await lock
  await withTeamLock(`team:${h.stateRoot}:team`, async () => {})
  assert.equal((await h.state()).tasks[0].status, 'in_progress')
  assert.equal((await h.state()).tasks[0].attemptId, 'a2')
  assert.equal((await h.mailbox()).length, 0)
})
