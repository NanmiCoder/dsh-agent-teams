// #272: notify the captain once when a resident member parks an open attempt.
import test from 'node:test'
import assert from 'node:assert/strict'
import fsPromises, { mkdtemp, rm } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installTeamScheduler } from '../lib/scheduler.js'
import { acknowledgeMailbox, beginTaskAttempt, createTeamDir, readMailbox, readTeam, withTeamLock, writeTeam } from '../lib/state.js'

async function eventually(predicate) {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('timed out waiting for scheduler settlement')
}

async function fixture(t, status = 'in_progress', dispatch = async () => {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'issue272-'))
  const root = join(workspace, '.agent-teams')
  const lockKey = `team:${root}:test`
  const session = id => ({ id, header: { cwd: workspace, seedLength: 0 }, events: [], append() {} })
  const captain = { id: 'captain-session', session: session('captain-session'), steers: [],
    steer(message) { this.steers.push(message) } }
  const member = { id: 'member-session', session: session('member-session'), status: 'running' }
  const agents = new Map([[captain.id, captain], [member.id, member]])
  const dispatches = []
  const warnings = []
  let listeners
  let scheduler
  const load = () => readTeam(root, 'test')
  const mail = async () => (await readMailbox(root, 'test', 'captain')).filter(message =>
    message.from === 'alpha' && message.sourceTaskId === 't1' && message.content.includes('Scheduling is parked'))
  const update = change => withTeamLock(lockKey, async () => {
    const team = await load()
    change(team)
    await writeTeam(root, team)
  })
  const install = () => {
    listeners = new Map()
    scheduler = installTeamScheduler({
      agents: { get: id => agents.get(id), list: () => [...agents.values()] },
      on(name, listener) { listeners.set(name, listener) },
      logger: { debug() {}, warn(message) { warnings.push(message) } },
    }, {
      stateDir: '.agent-teams',
      async dispatch(_captain, _teamId, _name, text) {
        dispatches.push(text)
        await dispatch()
        member.status = 'running'
        return true
      },
    })
  }
  const publish = status => {
    member.status = status
    listeners.get('agent/status')({ agent: member, status })
  }
  const kick = () => scheduler.kickMember(workspace, 'test', 'alpha')
  const idleBarrier = async () => {
    await eventually(async () => (await load()).members[0].status === 'idle')
    await withTeamLock(lockKey, load)
    await eventually(async () => (await mail()).every(message => message.deliveryClaimedAt === undefined))
    await kick()
  }
  const notice = async (attemptId = 'first-capability') => {
    await eventually(async () => (await mail()).some(message => message.sourceAttemptId === attemptId
      && message.deliveredAt !== undefined) && captain.steers.length > 0)
    await idleBarrier()
  }
  const read = () => withTeamLock(lockKey, async () => {
    await acknowledgeMailbox(root, 'test', 'captain', (await mail()).map(message => message.id))
  })
  const now = Date.now()
  await createTeamDir(root, {
    id: 'test', name: 'Test', captainSessionId: captain.id, createdAt: now, taskSeq: 2,
    members: [{ id: member.id, name: 'alpha', status: 'working', joinedAt: now }],
    tasks: [
      { id: 't1', subject: 'open work', status, assignee: 'alpha', dependencies: [],
        attempt: 1, attemptId: 'first-capability', createdAt: now, updatedAt: now },
      { id: 't2', subject: 'dependent work', status: 'pending', assignee: 'alpha',
        dependencies: ['t1'], createdAt: now, updatedAt: now },
    ],
  })
  install()
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true })
    assert.deepEqual(warnings, [])
  })
  return { captain, member, agents, dispatches, warnings, teamFile: join(root, 'test', 'team.json'),
    load, mail, update, install, publish, kick, idleBarrier, notice, read }
}

test('open claimed and in_progress attempts send one actionable captain notice', async t => {
  for (const status of ['claimed', 'in_progress']) {
    const f = await fixture(t, status)
    const before = (await f.load()).tasks
    f.publish('idle')
    await f.notice()
    const messages = await f.mail()
    assert.equal(messages.length, 1)
    assert.equal(f.captain.steers.length, 1)
    const message = messages[0]
    assert.equal(message.id, `parked-attempt:${JSON.stringify([f.member.id, 't1', 'first-capability'])}`)
    assert.equal(message.sourceAttemptId, 'first-capability')
    assert.equal(message.sourceTaskStatus, status)
    assert.equal(message.taskId, undefined)
    assert.equal(message.attemptId, undefined)
    assert.equal(message.readAt, undefined)
    const receipt = JSON.stringify(f.captain.steers[0])
    for (const text of ['alpha', 't1', 'attempt 1', 'first-capability', 'agent_teams_reassign_task', 'AgentTeams inbox receipt:']) {
      assert.ok(message.content.includes(text) || text === 'AgentTeams inbox receipt:')
      assert.ok(receipt.includes(text))
    }
    assert.deepEqual((await f.load()).tasks, before)
    assert.equal(f.dispatches.length, 0)
  }
})

test('repeated idle and re-parking do not repeat a notice even after it is read', async t => {
  const f = await fixture(t, 'claimed')
  f.publish('idle')
  f.publish('idle')
  f.publish('idle')
  await f.notice()
  for (const read of [false, true]) {
    if (read) await f.read()
    f.publish('running')
    await eventually(async () => (await f.load()).members[0].status === 'working')
    await f.update(team => { team.tasks[0].status = 'in_progress' })
    f.publish('idle')
    await f.idleBarrier()
    await Promise.all([f.kick(), f.kick(), f.kick()])
    const messages = await f.mail()
    assert.equal(messages.length, 1)
    assert.equal(f.captain.steers.length, 1)
    assert.equal(messages[0].readAt !== undefined, read)
    assert.equal((await f.load()).tasks[0].attemptId, 'first-capability')
    assert.equal(f.dispatches.length, 0)
  }
})

test('a reassigned attempt gets one new notice for its new capability', async t => {
  const f = await fixture(t)
  f.publish('idle')
  await f.notice()
  f.publish('running')
  await eventually(async () => (await f.load()).members[0].status === 'working')
  let attemptId
  // Model the committed generation produced by an explicit same-member reassignment.
  await f.update(team => { attemptId = beginTaskAttempt(team.tasks[0], 'alpha') })
  assert.equal((await f.mail()).length, 1)
  f.publish('idle')
  await f.notice(attemptId)
  const messages = await f.mail()
  assert.equal(messages.length, 2)
  assert.deepEqual(messages.map(message => message.sourceAttemptId), ['first-capability', attemptId])
  assert.notEqual(messages[0].id, messages[1].id)
  assert.equal(f.captain.steers.length, 2)
  assert.ok(messages[1].content.includes('attempt 2'))
  assert.ok(JSON.stringify(f.captain.steers[1]).includes(attemptId))
  assert.equal((await f.load()).tasks[0].attemptId, attemptId)
  assert.equal(f.dispatches.length, 0)
})

test('normal completion stays silent and releases dependent work', async t => {
  const f = await fixture(t)
  await f.update(team => { team.tasks[0].status = 'completed'; team.tasks[0].output = 'done' })
  f.publish('idle')
  await eventually(async () => (await f.load()).tasks[1].status === 'claimed' && f.dispatches.length === 1)
  assert.equal((await f.mail()).length, 0)
  assert.equal(f.captain.steers.length, 0)
  assert.ok(f.dispatches[0].includes('Task: t2 '))
  assert.equal((await f.load()).tasks[0].output, 'done')
})

test('halted, stopping and no-open-task idle observations stay silent', async t => {
  for (const guard of ['halted', 'stopping', 'no-open-task']) {
    const f = await fixture(t)
    await f.update(team => {
      if (guard === 'halted') team.halted = true
      else if (guard === 'stopping') team.members[0].stopping = true
      else team.tasks = []
    })
    f.publish('idle')
    await f.idleBarrier()
    assert.equal((await f.mail()).length, 0, guard)
    assert.equal(f.captain.steers.length, 0, guard)
    assert.equal(f.dispatches.length, 0, guard)
  }
})

test('team-write failure leaves the parked notice retryable', async t => {
  const f = await fixture(t)
  const originalWriteFile = fsPromises.writeFile
  let failed = false
  try {
    // Like verify.mjs, patch the builtin and synchronize its named ESM exports.
    // Fail the temp write once, before atomic replacement can fall back.
    fsPromises.writeFile = async (file, ...args) => {
      if (!failed && typeof file === 'string' && file.startsWith(`${f.teamFile}.`) && file.endsWith('.tmp')) {
        failed = true
        throw new Error('injected team-write failure')
      }
      return originalWriteFile(file, ...args)
    }
    syncBuiltinESMExports()
    f.publish('idle')
    await eventually(() => f.warnings.length === 1)
    assert.equal(failed, true)
    assert.match(f.warnings.shift(), /injected team-write failure/)
    assert.equal((await f.load()).members[0].status, 'working')
    assert.equal((await f.mail()).length, 0)
    assert.equal(f.captain.steers.length, 0)
  } finally {
    fsPromises.writeFile = originalWriteFile
    syncBuiltinESMExports()
  }
  f.publish('idle')
  await f.notice()
  assert.equal((await f.mail()).length, 1)
  assert.equal(f.captain.steers.length, 1)
  assert.equal(f.dispatches.length, 0)
})

test('idle during an in-flight dispatch does not announce the new attempt as parked', async t => {
  let release
  const delivery = new Promise(resolve => { release = resolve })
  const f = await fixture(t, 'in_progress', () => delivery)
  f.member.status = 'idle'
  const kicking = f.kick()
  let attemptId
  try {
    await eventually(() => f.dispatches.length === 1)
    attemptId = (await f.load()).tasks[0].attemptId
    assert.notEqual(attemptId, 'first-capability')
    f.publish('idle')
    await eventually(async () => (await f.load()).members[0].status === 'idle')
    // Wait for the status lock, but not its kick queued behind the gated delivery.
    await f.update(() => {})
    assert.equal((await f.mail()).length, 0)
    assert.equal(f.captain.steers.length, 0)
    // Delivery starts the run before returning; let that edge settle before
    // the duplicate idle's queued kick and post-kick notice check can finish.
    f.publish('running')
    await eventually(async () => (await f.load()).members[0].status === 'working')
  } finally {
    release()
    await kicking
  }
  await f.kick()
  await f.update(() => {})
  assert.equal((await f.mail()).length, 0)
  assert.equal(f.captain.steers.length, 0)
  f.publish('idle')
  await f.notice(attemptId)
  const messages = await f.mail()
  assert.equal(messages.length, 1)
  assert.equal(messages[0].sourceAttemptId, attemptId)
  assert.equal(f.captain.steers.length, 1)
  assert.equal(f.dispatches.length, 1)
})

test('idle while a team-tool kick is queued still notifies once', async t => {
  for (const settled of ['parked', 'working', 'rotated']) {
    const f = await fixture(t)
    const originalReadFile = fsPromises.readFile
    let release
    let blocked = false
    let attemptId = 'first-capability'
    const gate = new Promise(resolve => { release = resolve })
    // Hold the team-tool kick's first read after it has entered the member lane.
    fsPromises.readFile = async (file, ...args) => {
      if (!blocked && file === f.teamFile) {
        blocked = true
        await gate
      }
      return originalReadFile(file, ...args)
    }
    syncBuiltinESMExports()
    const kicking = f.kick()
    try {
      await eventually(() => blocked)
      f.publish('idle')
      await eventually(async () => (await f.load()).members[0].status === 'idle')
      await f.update(() => {})
      assert.equal((await f.mail()).length, 0, 'notice must wait for the member lane')
      assert.equal(f.captain.steers.length, 0)
      if (settled !== 'parked') {
        // Model a concurrent delivery or handoff winning before the lane drains.
        // Do not publish running: retain the old park marker to isolate each guard.
        f.member.status = 'running'
        await f.update(team => {
          if (settled === 'working') team.members[0].status = 'working'
          else attemptId = beginTaskAttempt(team.tasks[0], 'alpha')
        })
      }
    } finally {
      fsPromises.readFile = originalReadFile
      syncBuiltinESMExports()
      release()
      await kicking
    }
    await f.kick()
    await f.update(() => {})
    if (settled !== 'parked') {
      assert.equal((await f.mail()).length, 0, settled)
      assert.equal(f.captain.steers.length, 0, settled)
      f.publish('idle')
    }
    await f.notice(attemptId)
    assert.equal((await f.mail()).length, 1, settled)
    assert.equal((await f.mail())[0].sourceAttemptId, attemptId)
    assert.equal(f.captain.steers.length, 1, settled)
    assert.equal(f.dispatches.length, 0, settled)
  }
})

test('an offline captain notice never steers a member fork as the lead', async t => {
  const f = await fixture(t)
  f.agents.delete(f.captain.id)
  f.member.session.header.origin = 'subagent'
  f.member.session.header.parentSession = f.captain.id
  const fork = {
    id: 'member-fork',
    session: { id: 'member-fork', header: { parentSession: f.member.id } },
    steers: [],
    steer(message) { this.steers.push(message) },
  }
  f.agents.set(fork.id, fork)
  f.publish('idle')
  await eventually(async () => {
    const messages = await f.mail()
    return messages.length === 1 && messages[0].deliveryClaimedAt === undefined
  })
  assert.equal(fork.steers.length, 0)
  assert.equal(f.captain.steers.length, 0)
  assert.equal((await f.mail())[0].deliveredAt, undefined)
  assert.equal((await f.load()).tasks[0].attemptId, 'first-capability')
  assert.equal(f.dispatches.length, 0)
})

test('persisted mailbox history dedupes after scheduler replacement', async t => {
  for (const read of [false, true]) {
    const f = await fixture(t)
    f.publish('idle')
    await f.notice()
    if (read) await f.read()
    const before = await f.mail()
    await f.update(team => { team.members[0].status = 'working' })
    f.install()
    f.publish('idle')
    await f.idleBarrier()
    assert.deepEqual(await f.mail(), before)
    assert.equal(f.captain.steers.length, 1)
    assert.equal((await f.load()).tasks[0].attemptId, 'first-capability')
    assert.equal(f.dispatches.length, 0)
  }
})
