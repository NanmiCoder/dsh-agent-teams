/**
 * The delivery branch is the last place a rejected dispatch could stay silent.
 *
 * `dispatch-visibility-tdd.mjs` pins the durable shape of a recorded rejection.
 * This script pins the dispatch decision itself, through the real tool surface:
 * a member that is already spawned takes the `deliverToMember` branch, and that
 * function swallows its own failure into a `logger.warn` that no web/desktop
 * host displays. Without a record there, the captain sees exactly the symptom
 * this work exists to end — an idle member, a task the scheduler rolled back to
 * `pending`, and an `attempt` counter that only climbs — just reached through
 * delivery instead of a guard.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTeamDir, readTeam } from '../lib/state.js'
import { registerAgentTeamsTools } from '../lib/tools.js'

const CAPTAIN = 'captain-session'
const MEMBER = 'worker-session'
const TEAM = 'dispatch-delivery'

/** A team whose only member is already spawned, so dispatch must deliver. */
function teamFixture() {
  return {
    id: TEAM,
    name: TEAM,
    description: 'why a delivered prompt was refused',
    captainSessionId: CAPTAIN,
    createdAt: 1,
    taskSeq: 1,
    phase: 'running',
    members: [{ id: MEMBER, name: 'worker', role: 'engineer', provider: 'fake', model: 'm', joinedAt: 1, status: 'idle' }],
    tasks: [{ id: 't1', subject: 'work', status: 'pending', dependencies: [], assignee: 'worker', kind: 'work', attempt: 0, createdAt: 1, updatedAt: 1 }],
  }
}

/**
 * Register the real tools over the smallest context the plugin installs against,
 * and drive them the way a captain does: one `agent_teams_status` call, which is
 * also what kicks the scheduler into dispatching.
 */
async function harness(t) {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-dispatch-delivery-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const stateDir = '.agent-teams'
  const stateRoot = join(workspace, stateDir)
  await createTeamDir(stateRoot, teamFixture())

  const delivery = { reject: true }
  const warnings = []
  const definitions = new Map()
  const captain = { id: CAPTAIN, status: 'idle', session: { header: { cwd: workspace }, append() {} } }
  const member = { id: MEMBER, status: 'idle', session: { header: { cwd: workspace, parentSession: CAPTAIN }, append() {} } }
  const ctx = {
    logger: { debug() {}, warn(message) { warnings.push(message) } },
    agents: { get: id => (id === CAPTAIN ? captain : id === MEMBER ? member : undefined) },
    on: () => () => {},
    effect: setup => { const dispose = setup(); return typeof dispose === 'function' ? dispose : () => {} },
    subagents: {
      // The host refuses the queued prompt, which is the rejection under test.
      followup() {
        if (delivery.reject) throw new Error('host rejected the queued prompt')
        return 'accepted'
      },
      registerContinuableSetup() {},
    },
    tools: { register: definition => definitions.set(definition.name, definition) },
  }
  registerAgentTeamsTools(ctx, { stateDir, memberProvider: 'fake', memberMaxDepth: 1, maxMembers: 8, profiles: {} })
  const status = definitions.get('agent_teams_status')
  return {
    delivery,
    warnings,
    status: () => status.execute({}, { agent: captain, signal: new AbortController().signal }),
    render: value => status.output.render({}, value).map(part => part.text).join('\n'),
    state: () => readTeam(stateRoot, TEAM),
  }
}

await test('a rejected delivery to a spawned member records why', async t => {
  const h = await harness(t)
  const value = await h.status()
  const team = await h.state()

  assert.equal(team?.lastDispatchError?.member, 'worker')
  assert.match(team.lastDispatchError.reason, /delivery to "worker" was rejected/)
  assert.equal(value.last_dispatch_error?.member, 'worker', 'the status result has to carry it')
  assert.match(h.render(value), /Last dispatch rejection: worker/, 'and it has to render above the roster')

  // The scheduler's rollback is what makes this silence expensive: the attempt
  // is spent, the capability is cleared, and the next tick repeats it.
  const task = team.tasks.find(item => item.id === 't1')
  assert.equal(task.status, 'pending')
  assert.equal(task.attemptId, undefined)
  assert.equal(task.attempt, 1, 'the attempt counter is spent and never comes back')
})

await test('a delivered prompt clears the rejection it superseded', async t => {
  const h = await harness(t)
  await h.status()
  assert.notEqual((await h.state())?.lastDispatchError, undefined, 'the first delivery is refused')

  h.delivery.reject = false
  const value = await h.status()
  assert.equal((await h.state())?.lastDispatchError, undefined, 'a successful dispatch must clear the stale reason')
  assert.equal(value.last_dispatch_error, undefined)
  assert.doesNotMatch(h.render(value), /Last dispatch rejection:/)
})
