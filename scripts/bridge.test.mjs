import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { installAgentTeamsBridge } from '../lib/bridge-runtime.js'
import { archiveTeamDir, createTeamDir, writeTeam } from '../lib/state.js'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function team(captainSessionId = 'captain-a') {
  return {
    id: 'bridge-team',
    name: 'Bridge Team',
    description: 'exercise the public projection',
    captainSessionId,
    createdAt: 1,
    phase: 'staged',
    planReviewState: 'awaiting_review',
    halted: false,
    members: [{
      id: '', name: 'builder', role: 'implementation', joinedAt: 2, status: 'idle',
      provider: 'fake', model: 'fake-model',
    }],
    tasks: [{
      id: 't1', subject: 'Build', description: 'Implement it', status: 'pending',
      assignee: 'builder', dependencies: [], attempt: 0, createdAt: 3, updatedAt: 3,
    }],
    taskSeq: 1,
  }
}

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-teams-bridge-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const stateRoot = join(workspace, '.agent-teams')
  const agents = new Map([
    ['captain-a', { id: 'captain-a', session: { header: { cwd: workspace } } }],
    ['captain-b', { id: 'captain-b', session: { header: { cwd: workspace } } }],
    ['captain-no-workspace', { id: 'captain-no-workspace', session: { header: {} } }],
  ])
  const warnings = []
  const ctx = new Context()
  const disposeAgents = ctx.provide('agents', { get: id => agents.get(id) })
  t.after(disposeAgents)
  let publisher
  const fiber = ctx.plugin((pluginCtx) => {
    pluginCtx.logger.warn = message => warnings.push(String(message))
    publisher = installAgentTeamsBridge(pluginCtx, { stateDir: '.agent-teams' })
  })
  await fiber
  t.after(() => fiber.dispose())
  assert.ok(publisher, 'the test plugin keeps its internal publisher on its own context')
  return { workspace, stateRoot, agents, warnings, ctx, fiber, publisher, bridge: ctx.agentTeamsBridge }
}

test('package exposes the stable bridge subpath and build outputs', () => {
  assert.deepEqual(packageJson.exports['./bridge'], {
    types: './lib/types/bridge.d.ts',
    default: './lib/bridge.js',
  })
  assert.doesNotThrow(() => readFileSync(new URL('../lib/bridge.js', import.meta.url)))
  assert.doesNotThrow(() => readFileSync(new URL('../lib/types/bridge.d.ts', import.meta.url)))
})

test('Cordis service follows the owning fiber lifecycle', async (t) => {
  const { ctx, fiber, bridge } = await fixture(t)
  assert.equal(bridge.apiVersion, 1)
  assert.deepEqual(
    Object.keys(bridge).sort(),
    ['apiVersion', 'getTeamForCaptain', 'subscribeTeamEvents'],
    'the public service surface is read-only',
  )
  assert.equal(Object.isFrozen(bridge), true)
  await fiber.dispose()
  assert.equal(ctx.get('agentTeamsBridge'), undefined)
})

test('projection is a detached deeply immutable disk snapshot and never guesses a workspace', async (t) => {
  const { stateRoot, agents, bridge } = await fixture(t)
  const durable = team()
  await createTeamDir(stateRoot, durable)
  const projection = await bridge.getTeamForCaptain('captain-a')
  assert.equal(projection?.id, durable.id)
  assert.equal(projection?.phase, 'staged')
  assert.equal(Object.isFrozen(projection), true)
  assert.equal(Object.isFrozen(projection.members), true)
  assert.equal(Object.isFrozen(projection.members[0]), true)
  assert.equal(Object.isFrozen(projection.tasks[0].dependencies), true)
  assert.throws(() => { projection.members[0].name = 'mutated' }, TypeError)
  durable.members[0].name = 'changed only in caller memory'
  assert.equal(projection.members[0].name, 'builder')
  assert.equal(await bridge.getTeamForCaptain('captain-no-workspace'), null)
  agents.delete('captain-a')
  assert.equal(await bridge.getTeamForCaptain('captain-a'), null)
})

test('subscriptions filter captains, isolate listener failures, and dispose idempotently', async (t) => {
  const { stateRoot, warnings, bridge, publisher } = await fixture(t)
  await createTeamDir(stateRoot, team())
  const observed = []
  const disposeA = bridge.subscribeTeamEvents('captain-a', event => observed.push(event.type))
  bridge.subscribeTeamEvents('captain-a', () => { throw new Error('listener boom') })
  bridge.subscribeTeamEvents('captain-a', async () => { throw new Error('async listener boom') })
  bridge.subscribeTeamEvents('captain-b', event => observed.push(`wrong:${event.type}`))
  await publisher.publishActive('team-staged', stateRoot, 'bridge-team')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(observed, ['team-staged'])
  assert.match(warnings.join('\n'), /listener boom/)
  assert.match(warnings.join('\n'), /async listener boom/)
  disposeA()
  disposeA()
  await publisher.publishActive('team-staged', stateRoot, 'bridge-team')
  assert.deepEqual(observed, ['team-staged'])
})

test('publisher emits all lifecycle variants from durable active or archived truth', async (t) => {
  const { stateRoot, bridge, publisher } = await fixture(t)
  const durable = team()
  await createTeamDir(stateRoot, durable)
  const events = []
  bridge.subscribeTeamEvents('captain-a', event => events.push(event))

  await publisher.publishActive('team-staged', stateRoot, durable.id)
  durable.phase = 'running'
  durable.approvedAt = 10
  durable.members[0].id = 'durable-child-session'
  await writeTeam(stateRoot, durable)
  await publisher.publishActive('team-approved', stateRoot, durable.id)
  durable.halted = true
  await writeTeam(stateRoot, durable)
  await publisher.publishActive('team-halted', stateRoot, durable.id)
  durable.halted = false
  await writeTeam(stateRoot, durable)
  await publisher.publishActive('team-resumed', stateRoot, durable.id)
  durable.tasks[0].status = 'completed'
  durable.tasks[0].output = 'done'
  await writeTeam(stateRoot, durable)
  await publisher.publishActive('task-updated', stateRoot, durable.id, durable.tasks[0].id)
  await archiveTeamDir(stateRoot, durable.id)
  await publisher.publishArchived(stateRoot, durable.id)

  assert.deepEqual(events.map(event => event.type), [
    'team-staged', 'team-approved', 'team-halted', 'team-resumed', 'task-updated', 'team-archived',
  ])
  for (const event of events) {
    assert.equal(event.apiVersion, 1)
    assert.equal(event.teamId, durable.id)
    assert.equal(event.captainSessionId, 'captain-a')
  }
  const approved = events[1]
  assert.equal(approved.team.phase, 'running')
  assert.equal(approved.team.members[0].id, 'durable-child-session')
  const taskUpdated = events[4]
  assert.equal(taskUpdated.task.id, 't1')
  assert.equal(taskUpdated.task.status, 'completed')
  assert.equal(events[5].team.phase, 'running')
})

test('approved event refuses staged state and observes durable member ids', async (t) => {
  const { stateRoot, bridge, publisher } = await fixture(t)
  const durable = team()
  await createTeamDir(stateRoot, durable)
  const events = []
  bridge.subscribeTeamEvents('captain-a', event => events.push(event))
  await publisher.publishActive('team-approved', stateRoot, durable.id)
  assert.deepEqual(events, [])
  durable.phase = 'running'
  durable.members[0].id = 'durable-child-session'
  await writeTeam(stateRoot, durable)
  await publisher.publishActive('team-approved', stateRoot, durable.id)
  assert.deepEqual(events.map(event => event.type), ['team-approved'])
})

test('projection read failures are observational and cannot reject the team mutation path', async (t) => {
  const { stateRoot, warnings, publisher } = await fixture(t)
  await mkdir(join(stateRoot, 'broken-team'), { recursive: true })
  await writeFile(join(stateRoot, 'broken-team', 'team.json'), '{broken json')
  await assert.doesNotReject(publisher.publishActive('team-halted', stateRoot, 'broken-team'))
  await assert.doesNotReject(publisher.publishArchived(stateRoot, 'broken-team'))
  assert.match(warnings.join('\n'), /bridge.*projection.*failed/i)
})
