/** Terminal member failures, composed with Harness's actual retry plugin. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import fsPromises, { mkdtemp, rm } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { apply as installRetry } from '@deepseek-ai/dsh-llm-retry'
import { installMemberSelectionRuntime } from '../lib/members.js'
import { installTeamScheduler } from '../lib/scheduler.js'
import { readCurrentMailbox } from '../lib/mailbox.js'
import { appendMailbox, beginTaskAttempt, createMessage, createTeamDir, readTeam, readMailbox, readUnreadMailbox, withTeamLock, writeTeam } from '../lib/state.js'

const deliveryHarness = process.argv.includes('--delivery-harness')
const modernHarness = deliveryHarness || process.argv.includes('--modern-harness')
const hostQueue = Symbol.for(deliveryHarness ? 'dsh.subagent.deliverPrompt' : 'dsh.subagent.queuePrompt')

async function eventually(predicate) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return
    await delay(10)
  }
  assert.fail('terminal failure did not settle')
}

async function fixture(t, { captainStatus = 'idle', fallback, captainOffline = false, rejectDelivery = false, nativeRecovery = false, rejectContinuation = false } = {}) {
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
  const child = {
    id: 'worker-session', status: 'running',
    steer(message) { deliveries.push({ id: this.id, content: message.content }) },
    whenIdle: () => child.status === 'idle' ? Promise.resolve() : idle,
    session: {
      header: { cwd: workspace, parentSession: captain.id, seedLength: 0 },
      events: [{ type: 'subagent/descriptor', data: {
        version: 3, mode: 'continuable', provider: 'spawn', label: 'agent-teams:team:worker',
        agentProvider: 'fake', agentModel: 'primary',
      } }],
      append(type, data) { sessionEvents.push({ type, data }) },
    },
  }
  const recovery = []
  if (nativeRecovery) {
    child.model = { select(selection) { recovery.push({ selection }) } }
    child.cancel = (cause, options) => recovery.push({ cause, options })
    child.followup = message => {
      if (rejectContinuation) throw new Error('continuation refused')
      recovery.push({ continuation: message })
    }
  }
  await createTeamDir(stateRoot, {
    id: 'team', name: 'Team', captainSessionId: captain.id, createdAt: 1, taskSeq: 1,
    members: [{ id: child.id, name: 'worker', status: 'working', joinedAt: 1, provider: 'fake', model: 'primary' }],
    tasks: [{ id: 't1', subject: 'work', assignee: 'worker', status: 'in_progress', dependencies: [], attempt: 1, attemptId: 'a1', createdAt: 1, updatedAt: 1 }],
  })
  let setup
  const rootListeners = new Map()
  const disposers = []
  const ctx = {
    logger: { debug() {}, warn(message) { warnings.push(message) } },
    agents: { list: () => [], get(id) { return id === child.id ? child : id === captain.id && !captainOffline ? captain : undefined } },
    on(name, listener) { rootListeners.set(name, listener); return () => rootListeners.delete(name) },
    effect(setup) { const dispose = setup(); disposers.push(dispose); return dispose },
    subagents: {
      registerContinuableSetup(fn) { setup = fn },
      async followup(_captain, id, content) { deliveries.push({ id, content }); return 'accepted' },
    },
  }
  if (modernHarness) {
    const oldEvents = child.session.events
    delete child.session.events
    delete child.session.header.seedLength
    child.session.ownEvents = () => oldEvents
    const followup = ctx.subagents.followup
    delete ctx.subagents.followup
    delete ctx.subagents.registerContinuableSetup
    ctx.subagents[hostQueue] = function (parent, id, content, source, signal, delivery) {
      if (deliveryHarness) assert.ok(['queue', 'steer'].includes(delivery))
      return followup.call(this, parent, id, content, { source, signal })
    }
    ctx.subagents.sendMessage = (parent, id, content) => followup.call(ctx.subagents, parent, id, content)
    setup = childCtx => {
      child.ctx = childCtx
      if (deliveryHarness) delete childCtx.agent
      rootListeners.get('agent/session-start')({ agent: child, source: 'startup' })
      return () => { for (const dispose of disposers) dispose() }
    }
  }
  const scheduler = installTeamScheduler(ctx, { stateDir: '.agent-teams' })
  const runtime = installMemberSelectionRuntime(ctx, '.agent-teams', (workspace, teamId, memberName) => (
    scheduler.kickMember(workspace, teamId, memberName)
  ))
  const dispose = await runtime.withPending(captain.id, 'agent-teams:team:worker', {
    provider: 'fake', model: 'primary', ...fallback ? { fallback } : {},
  }, () => setup({
    agent: child,
    effect(setup) { const dispose = setup(); disposers.push(dispose); return dispose },
    on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
  }))
  t.after(dispose)
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
  const memberError = (value, next = async () => undefined) => listeners.get('agent/request-error')?.(value, next) ?? next()
  const settleSilently = () => {
    // The real driver settles after emitting agent/error. Deliberately omit
    // agent/status so recovery cannot depend on that edge reaching the plugin.
    child.status = 'idle'
    resolveIdle()
  }
  settleOnCleanup = settleSilently
  return {
    stateRoot, steers, deliveries, warnings, listeners, child, sessionEvents, memberError, payload, settleSilently, recovery, dispose,
    turnEvent(type, data) {
      pendingFailures.push(listeners.get('session/event')?.(child.session, { type, data }))
    },
    state: () => readTeam(stateRoot, 'team'),
    mailbox: () => readMailbox(stateRoot, 'team', 'captain'),
    unread: () => readUnreadMailbox(stateRoot, 'team', 'captain'),
    retry: (policy, code) => { const value = payload(policy, code); return retryHandler(value, () => memberError(value)) },
    terminal({ settle = true, turn = 1 } = {}) {
      pendingFailures.push(listeners.get('agent/error')?.({ agent: child, turn, step: 0, error: new LlmError(failure.message, failure.code) }))
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

await test('native fallback continues once with default effort and reports a later terminal failure', async t => {
  const fallback = { provider: 'backup', model: 'backup-model' }
  const h = await fixture(t, { fallback, nativeRecovery: true })
  const abort = new AbortController()
  abort.abort()
  assert.equal(await h.memberError(h.payload(undefined, 'AUTH', abort.signal)), undefined)
  assert.deepEqual(h.recovery, [{ selection: { provider: 'fake', model: 'primary' } }])
  assert.equal((await h.state()).members[0].fallbackActive, undefined)
  assert.equal(await h.memberError(h.payload(undefined, 'AUTH')), undefined)
  assert.deepEqual(h.recovery[1], { selection: fallback })
  assert.deepEqual(h.recovery[2], {
    cause: { kind: 'hook', reason: 'agent-teams/model-fallback' }, options: { keepInbox: true },
  })
  assert.match(h.recovery[3].continuation.content[0].text, /Continue the current work/)
  assert.equal((await h.state()).tasks[0].status, 'in_progress')
  assert.equal((await h.mailbox()).length, 0)
  const delegated = { kind: 'retry' }
  assert.equal(await h.memberError(h.payload(undefined, 'RATE_LIMIT'), async () => delegated), delegated)
  assert.equal(h.recovery.length, 4)
  h.terminal({ turn: 2 })
  await eventually(async () => (await h.state()).tasks[0].status === 'failed' && (await h.mailbox()).length === 1)
  assert.equal((await h.state()).tasks[0].attemptId, 'a1')
})

await test('disposed setup cannot resume fallback after the team lock is released', async t => {
  const h = await fixture(t, { fallback: { provider: 'backup', model: 'backup-model' }, nativeRecovery: true })
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  const lock = withTeamLock(`team:${h.stateRoot}:team`, async () => {
    entered.resolve()
    await release.promise
  })
  await entered.promise
  const request = h.memberError(h.payload(undefined, 'AUTH'))
  h.dispose()
  release.resolve()
  await lock
  await request
  assert.deepEqual(h.recovery, [{ selection: { provider: 'fake', model: 'primary' } }])
  assert.equal((await h.state()).members[0].fallbackActive, undefined)
})

for (const cancel of ['turn', 'setup']) {
  await test(`canceling the ${cancel} during a staged fallback write preserves the saved route`, { timeout: 5000 }, async t => {
    const fallback = { provider: 'backup', model: 'backup-model' }
    const h = await fixture(t, { fallback, nativeRecovery: true })
    const prior = await h.state()
    Object.assign(prior.members[0], { activeProvider: 'fake', activeModel: 'primary', fallbackActive: false })
    await writeTeam(h.stateRoot, prior)
    const abort = new AbortController()
    const staged = Promise.withResolvers()
    const release = Promise.withResolvers()
    const target = join(h.stateRoot, 'team', 'team.json')
    const writeFile = fsPromises.writeFile
    fsPromises.writeFile = async (file, ...args) => {
      await writeFile(file, ...args)
      if (typeof file === 'string' && file.startsWith(target + '.') && file.endsWith('.tmp')) {
        staged.resolve()
        await release.promise
      }
    }
    syncBuiltinESMExports()
    try {
      const request = h.memberError(h.payload(undefined, 'AUTH', abort.signal))
      await staged.promise
      if (cancel === 'turn') abort.abort()
      else h.dispose()
      release.resolve()
      assert.equal(await request, undefined)
    } finally {
      release.resolve()
      fsPromises.writeFile = writeFile
      syncBuiltinESMExports()
    }
    assert.deepEqual(await h.state(), prior)
    assert.deepEqual(h.recovery, [{ selection: { provider: 'fake', model: 'primary' } }])
    if (cancel === 'turn') {
      // An interrupted write must leave the one-shot recovery available.
      assert.equal(await h.memberError(h.payload(undefined, 'AUTH')), undefined)
      assert.deepEqual(h.recovery[1], { selection: fallback })
      assert.equal((await h.state()).members[0].fallbackActive, true)
    }
  })
}

await test('native continuation rejection settles the open task after hook cancellation', async t => {
  const h = await fixture(t, {
    fallback: { provider: 'backup', model: 'backup-model' }, nativeRecovery: true, rejectContinuation: true,
  })
  await assert.rejects(h.memberError(h.payload(undefined, 'AUTH')), /continuation refused/)
  h.settleSilently()
  await eventually(async () => (await h.state()).tasks[0].status === 'failed' && (await h.mailbox()).length === 1)
  assert.equal((await h.state()).tasks[0].attemptId, 'a1')
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
    await eventually(async () => (await h.mailbox())[0]?.deliveredAt !== undefined)
    assert.equal((await h.unread()).length, 1, 'delivery alone does not prove consumption')
    assert.equal((await h.mailbox()).length, 1)
    assert.equal((await readUnreadMailbox(h.stateRoot, 'team', 'worker')).length, 1)
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

function outputLimitedStep(h, legacy = false) {
  h.turnEvent('step/start', { turn: 1, step: 1 })
  const chunk = { type: 'finish', reason: { kind: 'max-tokens' } }
  if (legacy) h.turnEvent('assistant/chunk', { turn: 1, step: 1, chunk })
  else h.turnEvent('assistant/message', { turn: 1, step: 1, stream: [{ type: 'chunk', chunk }] })
}

for (const legacy of [false, true]) {
  await test(`terminal output limit fails the exact open attempt and reports once (${legacy ? 'legacy chunk' : 'embedded stream'})`, async t => {
    const h = await fixture(t)
    outputLimitedStep(h, legacy)
    assert.equal((await h.state()).tasks[0].status, 'in_progress')
    assert.equal((await h.mailbox()).length, 0)
    h.turnEvent('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
    h.turnEvent('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
    h.settleSilently()
    await eventually(async () => h.steers.length === 1 && (await h.mailbox())[0]?.deliveredAt !== undefined)
    const task = (await h.state()).tasks[0]
    assert.equal(task.status, 'failed')
    assert.equal(task.attemptId, 'a1')
    assert.match(task.output, /output-token limit.*MAX_TOKENS/)
    const reports = await h.mailbox()
    assert.equal(reports.length, 1)
    assert.match(reports[0].content, /Task t1 .* was marked failed/)
    assert.equal(reports[0].sourceTaskId, 't1')
    assert.equal(reports[0].sourceAttemptId, 'a1')
    assert.equal(reports[0].sourceTaskStatus, 'failed')
  })
}

await test('replacing a failed historical attempt discards its offline output-limit report', async t => {
  const h = await fixture(t, { captainOffline: true })
  const initial = await h.state()
  delete initial.tasks[0].attemptId
  await writeTeam(h.stateRoot, initial)
  outputLimitedStep(h)
  h.turnEvent('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
  h.settleSilently()
  await eventually(async () => (await h.mailbox()).length === 1)

  const failed = await h.state()
  const task = failed.tasks[0]
  assert.equal(task.status, 'failed')
  assert.equal(task.attempt, initial.tasks[0].attempt)
  const failedAttemptId = task.attemptId
  const [report] = await readCurrentMailbox(h.stateRoot, 'team', 'captain')
  beginTaskAttempt(task, 'worker')
  await writeTeam(h.stateRoot, failed)
  assert.deepEqual(await readCurrentMailbox(h.stateRoot, 'team', 'captain'), [])
  assert.match(failedAttemptId, /^[a-f0-9-]{36}$/)
  assert.equal(report.sourceAttemptId, failedAttemptId)
})

for (const [label, reason, continues] of [
  ['a later model step', 'max-tokens', true],
  ['a cancelled turn', 'aborted', false],
  ['an ordinary parked turn', 'completed', false],
]) {
  await test(`output-limit observation keeps the attempt open after ${label}`, async t => {
    const h = await fixture(t)
    if (reason !== 'completed') outputLimitedStep(h)
    if (continues) h.turnEvent('step/start', { turn: 1, step: 2 })
    h.turnEvent('turn/end', { turn: 1, reason: { kind: reason } })
    h.settleSilently()
    await withTeamLock(`team:${h.stateRoot}:team`, async () => {})
    assert.equal((await h.state()).tasks[0].status, 'in_progress')
    assert.equal((await h.mailbox()).length, 0)
  })
}

for (const [label, update] of [
  ['replacement', { attempt: 2, attemptId: 'a2' }],
  ['completion', { status: 'completed', output: 'Recorded result' }],
]) {
  await test(`output limit cannot change or report an attempt after ${label}`, async t => {
    const h = await fixture(t)
    outputLimitedStep(h)
    const team = await h.state()
    Object.assign(team.tasks[0], update)
    await writeTeam(h.stateRoot, team)
    h.turnEvent('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
    h.settleSilently()
    await withTeamLock(`team:${h.stateRoot}:team`, async () => {})
    assert.deepEqual((await h.state()).tasks[0], team.tasks[0])
    assert.equal((await h.mailbox()).length, 0)
  })
}
