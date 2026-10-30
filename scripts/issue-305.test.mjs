// #305: Running-team task creation missed the non-empty subject gate used by staged graphs and edits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateCreateTask } from '../lib/quality-gates.js'
import { createTeamDir, readTeam } from '../lib/state.js'
import { registerAgentTeamsTools } from '../lib/tools.js'

function runningTeam() {
  return {
    id: 'test', name: 'Test', captainSessionId: 'captain', createdAt: 1,
    phase: 'running', members: [], taskSeq: 1,
    tasks: [{ id: 't1', subject: 'Existing task', status: 'pending', dependencies: [], createdAt: 1, updatedAt: 1 }],
  }
}

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), 'issue-305-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const stateDir = '.agent-teams'
  const stateRoot = join(workspace, stateDir)
  const team = runningTeam()
  await createTeamDir(stateRoot, team)
  const noop = () => {}
  const captain = {
    id: 'captain', status: 'idle',
    session: { id: 'captain', header: { cwd: workspace, seedLength: 0 }, events: [], append: noop },
  }
  const definitions = []
  registerAgentTeamsTools({
    on: () => noop, effect: setup => setup(), logger: { warn: noop, debug: noop },
    tools: { register: definition => definitions.push(definition) },
    agents: { get: id => id === captain.id ? captain : undefined },
    subagents: { followup: async () => {}, registerContinuableSetup: () => noop },
  }, { stateDir, memberProvider: 'spawn', memberMaxDepth: 1, maxMembers: 8, profiles: {} })
  const tool = definitions.find(definition => definition.name === 'agent_teams_create_task')
  assert.ok(tool)
  return {
    load: () => readTeam(stateRoot, team.id),
    create: subject => tool.execute({ subject }, {
      agent: captain, callId: 'blank-subject-test', signal: new AbortController().signal,
    }),
  }
}

for (const [name, subject] of [['empty', ''], ['whitespace-only', '   ']]) {
  test(`running team rejects ${name} subject without changing tasks or taskSeq`, async t => {
    const { load, create } = await fixture(t)
    const before = await load()
    await assert.rejects(() => create(subject), { message: 'task subject must not be empty' })
    const after = await load()
    assert.deepEqual(after.tasks, before.tasks)
    assert.equal(after.taskSeq, before.taskSeq)
  })
}

test('running team creates a valid subject verbatim', async t => {
  const { load, create } = await fixture(t)
  const before = await load()
  const subject = '  Keep this subject verbatim  '
  const result = await create(subject)
  assert.equal(result.subject, subject)
  assert.equal(result.task_id, `t${before.taskSeq + 1}`)
  const after = await load()
  assert.equal(after.taskSeq, before.taskSeq + 1)
  assert.equal(after.tasks.length, before.tasks.length + 1)
  assert.deepEqual(after.tasks.slice(0, -1), before.tasks)
  assert.equal(after.tasks.at(-1).subject, subject)
  assert.equal(after.tasks.at(-1).id, result.task_id)
})

test('validateCreateTask rejects blank and non-string subjects early', () => {
  for (const subject of ['', '   ', undefined, null, 42]) {
    assert.deepEqual(validateCreateTask(runningTeam(), { subject, kind: 'verification' }), {
      ok: false, error: 'task subject must not be empty',
    })
  }
})
