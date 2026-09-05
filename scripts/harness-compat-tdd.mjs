/** Native service dispatch plus targeted compatibility lifecycle regressions.
 * Real full-CLI/composition validation is recorded separately by the host lab.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { guardSubagentDelivery, installContinuableMemberSetup, queueMemberPrompt, sessionOwnEvents } from '../lib/harness-compat.js'
import { installMemberSelectionRuntime, spawnMember } from '../lib/members.js'
import { createTeamDir } from '../lib/state.js'

const queueKey = Symbol.for('dsh.subagent.queuePrompt')
const signal = new AbortController().signal
const source = { kind: 'plugin', plugin: 'dsh-agent-teams' }
const content = [{ type: 'text', text: 'next distinct turn' }]

function scope(extra = {}) {
  const listeners = new Map()
  const effects = []
  const ctx = {
    ...extra, listeners,
    logger: { warn() {} },
    on(name, fn) {
      const set = listeners.get(name) ?? new Set()
      listeners.set(name, set)
      set.add(fn)
      return () => set.delete(fn)
    },
    effect(setup) { const dispose = setup(); effects.push(dispose); return dispose },
    emit(name, payload) { for (const fn of [...listeners.get(name) ?? []]) fn(payload) },
    dispose() { for (const dispose of effects.splice(0).reverse()) dispose() },
  }
  return ctx
}

function modernRuntime() {
  return { [queueKey]() {}, sendMessage() {} }
}

function child({ workspace = process.cwd(), effort, inherited = false } = {}) {
  const descriptor = { type: 'subagent/descriptor', data: {
    version: 3, mode: 'continuable', provider: 'spawn', label: 'agent-teams:team:worker',
    agentProvider: 'primary', agentModel: 'model',
  } }
  const agent = {
    id: 'member-id', status: 'idle', whenIdle: async () => {},
    options: { provider: 'primary', model: 'model', reasoningEffort: effort },
    session: { header: { cwd: workspace, parentSession: 'captain' }, ownEvents: () => inherited ? [] : [descriptor] },
  }
  agent.ctx = scope({ agent })
  return agent
}

async function selection(agent) {
  for (const assemble of agent.ctx.listeners.get('system-prompt/assemble') ?? []) {
    await assemble({}, {}, async () => ({ variables: {} }))
  }
  return requestSelection(agent)
}

async function requestSelection(agent) {
  let config = { provider: 'inherited', model: 'parent-model', reasoningEffort: 'low' }
  for (const request of agent.ctx.listeners.get('agent/request') ?? []) {
    const previous = config
    config = await request({ agent }, async () => previous)
  }
  return config
}

await test('native SubagentRuntime keeps its receiver through FIFO delivery and retirement guard', async t => {
  const host = new Context()
  const fiber = host.plugin(SubagentRuntime)
  t.after(() => fiber.dispose())
  await fiber.await()
  const runtime = host.subagents
  assert.ok(runtime)
  if (typeof runtime.registerContinuableSetup === 'function') {
    // The real implementation reads this.ctx and this.setupRegistry. Its
    // internal ctx.effect must belong to the caller plugin, not the service.
    let installed = 0
    let disposed = 0
    const caller = host.plugin({ inject: ['subagents'], apply(ctx) {
      installContinuableMemberSetup(ctx, () => { installed++; return () => { disposed++ } })
    } })
    t.after(() => caller.dispose())
    await caller.await()
    const firstChild = scope()
    runtime.setupRegistry.apply(firstChild).commit()
    assert.deepEqual({ installed, disposed }, { installed: 1, disposed: 0 })
    await caller.dispose()
    assert.deepEqual({ installed, disposed }, { installed: 1, disposed: 1 })
    const laterChild = scope()
    runtime.setupRegistry.apply(laterChild).commit()
    assert.equal(installed, 1)
    firstChild.dispose()
    laterChild.dispose()
    assert.equal(disposed, 1)
  }
  const accepted = []
  const manager = {
    async followup(parent, id, body, options) {
      assert.equal(this, manager)
      accepted.push({ path: 'followup', parent, id, body, source: options.source })
      return 'accepted'
    },
    async queuePrompt(parent, id, body, provenance) {
      assert.equal(this, manager)
      accepted.push({ path: 'queue', parent, id, body, source: provenance })
      return 'accepted'
    },
    async sendMessage(parent, id, body) {
      assert.equal(this, manager)
      accepted.push({ path: 'steer', parent, id, body })
      return 'steered'
    },
  }
  // Only the downstream continuation manager is replaced. The real Cordis
  // service method still executes this.requireContinuations(), unlike old fakes.
  runtime.continuations = manager
  const captain = { id: 'captain', session: { header: {} } }
  const ctx = scope({ subagents: runtime })
  const methodKey = typeof runtime.followup === 'function' ? 'followup' : queueKey
  const before = Object.getOwnPropertyDescriptor(runtime, methodKey)
  guardSubagentDelivery(ctx, async (_sender, id) => id === 'retired')
  assert.equal(await queueMemberPrompt(runtime, captain, 'active', content, signal), 'accepted')
  assert.deepEqual(accepted[0].source, source)
  assert.notEqual(accepted[0].path, 'steer')
  await assert.rejects(queueMemberPrompt(runtime, captain, 'retired', content, signal), { code: 'NOT_RESUMABLE' })
  if (typeof runtime.sendMessage === 'function') {
    await assert.rejects(runtime.sendMessage(captain, 'retired', content, { signal }), { code: 'NOT_RESUMABLE' })
    assert.equal(await runtime.sendMessage(captain, 'unrelated', content, { signal }), 'steered')
  }
  ctx.dispose()
  assert.deepEqual(Object.getOwnPropertyDescriptor(runtime, methodKey), before)
  assert.equal(await queueMemberPrompt(runtime, captain, 'retired', content, signal), 'accepted')
})

await test('modern queue and public messaging are both guarded, including nested HMR disposal', async () => {
  const calls = []
  const runtime = {
    [queueKey](...args) { assert.equal(this, runtime); calls.push(['queue', ...args]); return Promise.resolve('queued') },
    sendMessage(...args) { assert.equal(this, runtime); calls.push(['steer', ...args]); return Promise.resolve('steered') },
  }
  const captain = { id: 'captain' }
  const first = scope({ subagents: runtime })
  const second = scope({ subagents: runtime })
  guardSubagentDelivery(first, async (_sender, id) => id === 'retired-first')
  guardSubagentDelivery(second, async (_sender, id) => id === 'retired-second')
  await assert.rejects(queueMemberPrompt(runtime, captain, 'retired-first', content, signal), { code: 'NOT_RESUMABLE' })
  await assert.rejects(runtime.sendMessage(captain, 'retired-second', content, { signal }), { code: 'NOT_RESUMABLE' })
  first.dispose()
  assert.equal(await queueMemberPrompt(runtime, captain, 'retired-first', content, signal), 'queued')
  second.dispose()
  assert.equal(await queueMemberPrompt(runtime, captain, 'retired-second', content, signal), 'queued')
  assert.ok(calls.every(([path]) => path === 'queue'))
})

await test('unsupported queue-only or send-only contract fails explicitly', async () => {
  const runtime = { sendMessage() { assert.fail('must never substitute steer') } }
  assert.throws(() => installContinuableMemberSetup(scope({ subagents: runtime }), () => () => {}), /unsupported Harness/)
  assert.throws(() => guardSubagentDelivery(scope({ subagents: runtime }), async () => false), /unsupported Harness/)
  await assert.rejects(queueMemberPrompt(runtime, {}, 'child', content, signal), /missing host FIFO/)
  assert.throws(() => sessionOwnEvents({ header: {} }), /missing ownEvents/)
})

await test('legacy session history excludes its inherited prefix; modern uses ownEvents receiver', () => {
  const inherited = { type: 'subagent/descriptor', data: { label: 'foreign' } }
  const own = { type: 'subagent/descriptor', data: { label: 'member' } }
  assert.deepEqual(sessionOwnEvents({ header: { seedLength: 1 }, events: [inherited, own] }), [own])
  const session = { header: {}, ownEvents() { assert.equal(this, session); return [own] } }
  assert.deepEqual(sessionOwnEvents(session), [own])
})

await test('synchronous modern setup selects the first request, deduplicates events, and disposes for HMR', async () => {
  const ctx = scope({ subagents: modernRuntime() })
  const bridge = installMemberSelectionRuntime(ctx, '.agent-teams')
  const agent = child()
  await bridge.withPending('captain', 'agent-teams:team:worker', {
    provider: 'selected', model: 'selected-model', reasoningEffort: 'high',
  }, async () => {
    ctx.emit('agent/session-start', { agent, source: 'startup' })
    assert.equal(agent.ctx.listeners.get('agent/request').size, 1)
    ctx.emit('agent/session-start', { agent, source: 'compact' })
    assert.equal(agent.ctx.listeners.get('agent/request').size, 1)
    assert.deepEqual(await selection(agent), { provider: 'selected', model: 'selected-model', reasoningEffort: 'high' })
  })
  ctx.dispose()
  assert.equal(agent.ctx.listeners.get('agent/request').size, 0)
  assert.equal(agent.ctx.listeners.get('agent/error').size, 0)
  agent.ctx.dispose()
})

await test('child disposal releases lifecycle contributions and permits a same-id resumed Agent', async () => {
  const ctx = scope({ subagents: modernRuntime() })
  let setups = 0
  let disposals = 0
  installContinuableMemberSetup(ctx, () => { setups++; return () => { disposals++ } })
  const first = child()
  ctx.emit('agent/session-start', { agent: first })
  first.ctx.dispose()
  assert.equal(disposals, 1)
  const second = child()
  ctx.emit('agent/session-start', { agent: second, source: 'resume' })
  assert.equal(setups, 2)
  ctx.dispose()
  assert.equal(disposals, 2)
  second.ctx.dispose()
  assert.equal(disposals, 2)
})

await test('setup exception blocks request instead of being swallowed by session-start dispatch', async () => {
  const ctx = scope({ subagents: modernRuntime() })
  installContinuableMemberSetup(ctx, () => { throw new Error('damaged durable model route') })
  const agent = child()
  ctx.emit('agent/session-start', { agent })
  await assert.rejects(selection(agent), /member initialization failed.*damaged durable model route/)
  ctx.dispose()
  assert.equal(agent.ctx.listeners.get('agent/request').size, 0)
})

await test('a child inheriting another member descriptor does not acquire member selection or failure hooks', () => {
  const ctx = scope({ subagents: modernRuntime() })
  installMemberSelectionRuntime(ctx, '.agent-teams')
  const agent = child({ inherited: true })
  ctx.emit('agent/session-start', { agent })
  assert.equal(agent.ctx.listeners.size, 0)
  const foreign = child()
  foreign.session.ownEvents = () => [{ type: 'subagent/descriptor', data: {
    version: 3, mode: 'continuable', provider: 'spawn', label: 'external-research-worker',
    agentProvider: 'primary', agentModel: 'model',
  } }]
  ctx.emit('agent/session-start', { agent: foreign })
  assert.equal(foreign.ctx.listeners.size, 0)
  ctx.dispose()
})

for (const fallbackActive of [false, true]) {
  await test(`cold resume restores route and effort coherently (fallbackActive=${fallbackActive})`, async t => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-teams-compat-'))
    t.after(() => rm(workspace, { recursive: true, force: true }))
    await createTeamDir(join(workspace, '.agent-teams'), {
      id: 'team', name: 'Team', captainSessionId: 'captain', createdAt: 1, taskSeq: 0, tasks: [],
      members: [{ id: 'member-id', name: 'worker', status: 'idle', joinedAt: 1,
        provider: 'primary', model: 'model', reasoningEffort: 'high',
        fallback: { provider: 'backup', model: 'backup-model' }, fallbackActive,
        ...(fallbackActive ? { activeProvider: 'backup', activeModel: 'backup-model' } : {}),
      }],
    })
    const ctx = scope({ subagents: modernRuntime() })
    t.after(() => ctx.dispose())
    installMemberSelectionRuntime(ctx, '.agent-teams')
    const agent = child({ workspace })
    ctx.emit('agent/session-start', { agent, source: 'resume' })
    assert.deepEqual(await selection(agent), fallbackActive
      ? { provider: 'backup', model: 'backup-model' }
      : { provider: 'primary', model: 'model', reasoningEffort: 'high' })
    if (fallbackActive) {
      let delegated = 0
      const handler = [...agent.ctx.listeners.get('agent/request-error')][0]
      assert.equal(await handler({ agent, signal, failure: { code: 'AUTH' } }, async () => { delegated++ }), undefined)
      assert.equal(delegated, 1)
    } else {
      const handler = [...agent.ctx.listeners.get('agent/request-error')][0]
      assert.deepEqual(await handler({ agent, signal, failure: { code: 'AUTH' } }, async () => undefined), { kind: 'retry' })
      // Harness retries inside the SAME step, without assembling the prompt
      // again. The accepted fallback must replace the captured request route.
      assert.deepEqual(await requestSelection(agent), { provider: 'backup', model: 'backup-model' })
    }
  })
}

await test('spawn explicitly passes reasoning effort, preserving persona and tool filters', async () => {
  let received
  const ctx = { subagents: {
    getProvider: () => ({ prepareContinuable() {}, capabilities: { persona: true, toolFilter: true } }),
    startContinuable: async spec => { received = spec; return { childId: 'child' } },
  } }
  const captain = { id: 'captain' }
  const team = { id: 'team', name: 'Team', captainSessionId: captain.id, members: [], tasks: [], createdAt: 1, taskSeq: 0 }
  const member = { id: '', name: 'worker', role: 'engineer', joinedAt: 1, status: 'idle' }
  await spawnMember(ctx, { provider: 'spawn' }, { withPending: (_p, _l, _s, run) => run() },
    { provider: 'chosen', model: 'model', reasoningEffort: 'high' }, captain, team, member, '.agent-teams', signal)
  assert.deepEqual(received.request.agentOptions, { provider: 'chosen', model: 'model', reasoningEffort: 'high' })
  assert.match(received.request.persona, /engineer/)
  assert.ok(received.request.toolFilter.deny.includes('agent_teams_create'))
  assert.equal(member.id, 'child')
})
