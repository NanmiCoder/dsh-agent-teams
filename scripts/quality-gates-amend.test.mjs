#!/usr/bin/env node
/**
 * Regression tests for the captain-only controlled contract amendment
 * (amendTaskContract).
 *
 * Incident (licat2023, PR #155 discussion): when a quality contract is wrong
 * — a verify command that cannot pass, or an inScope that forbids the file
 * the objective names — the worker has no honest completion: it either
 * dead-locks or games the gate (the fake-green case: implementer points
 * package.json main at the test file to pass verify). The fix is a
 * captain-only amendment that replaces contract fields mid-flight, records
 * every revision on the task (previous values + reason), and freezes the
 * contract once a review/requirements task has passed judgment.
 *
 * Run: node --test scripts/quality-gates-amend.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  amendTaskContract,
  evaluateQualityCompletion,
  hasValidQualityTaskFields,
  isTaskRevision,
} from '../lib/quality-gates.js'

function member(name, role) {
  return { id: `member-${name}`, name, role, joinedAt: 0, status: 'idle' }
}

function teamWith(tasks) {
  return {
    name: 't', id: 't', description: '', captainSessionId: 'captain',
    createdAt: 0, taskSeq: tasks.length,
    members: [member('implementer', 'implementer'), member('reviewer', 'reviewer')],
    tasks,
  }
}

function implTask(extra = {}) {
  return {
    id: 't1', subject: 'impl', status: 'in_progress', dependencies: [],
    createdAt: 0, updatedAt: 0, attempt: 1, kind: 'implementation',
    assignee: 'implementer',
    objective: 'Write the sample',
    inScope: ['docs/'],
    acceptance: ['src/amend-e2e.txt says ok'],
    verify: ['node -e "process.exit(0)"'],
    ...extra,
  }
}

function completedResults(task) {
  return {
    status: 'completed',
    changedPaths: ['src/amend-e2e.txt'],
    acceptanceResults: task.acceptance.map((criterion) => ({ criterion, status: 'passed' })),
    commandsRun: task.verify.map((command) => ({ command, status: 'passed' })),
  }
}

test('amend fixes an unsatisfiable inScope and records the revision', () => {
  const team = teamWith([implTask()])
  const before = team.tasks[0]
  const result = amendTaskContract(team, before, { inScope: ['docs/', 'src/'] }, 'captain', 'objective names src/ but inScope forbade it')
  assert.equal(result.ok, true)
  assert.deepEqual(result.task.inScope, ['docs/', 'src/'])
  assert.equal(result.task.revisions.length, 1)
  const revision = result.task.revisions[0]
  assert.ok(isTaskRevision(revision))
  assert.equal(revision.by, 'captain')
  assert.deepEqual(revision.fields, ['inScope'])
  assert.deepEqual(revision.previous.inScope, ['docs/'])
  assert.ok(revision.reason.includes('src/'))
  assert.ok(result.task.updatedAt >= before.updatedAt)
})

test('amended contract is the one the completion gate evaluates', () => {
  const team = teamWith([implTask()])
  const task = team.tasks[0]
  const blocked = evaluateQualityCompletion(task, completedResults(task))
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /src\/amend-e2e\.txt is undeclared/)
  const { ok, task: amended } = amendTaskContract(team, task, { inScope: ['docs/', 'src/'] }, 'captain', 'scope was wrong')
  assert.equal(ok, true)
  const gate = evaluateQualityCompletion(amended, completedResults(amended))
  assert.equal(gate.ok, true, `gate must evaluate the amended contract, got: ${gate.error}`)
})

test('mid-flight amendments are allowed until a review passes judgment', () => {
  const open = teamWith([implTask(), { id: 't2', subject: 'review', status: 'failed', dependencies: ['t1'], createdAt: 0, updatedAt: 0, kind: 'review', verdict: 'needs_revision', reviewedTaskId: 't1' }])
  assert.equal(amendTaskContract(open, open.tasks[0], { verify: ['node -e "process.exit(0)"'] }, 'captain', 'r1').ok, true)
  const passed = teamWith([
    implTask(),
    { id: 't2', subject: 'review', status: 'completed', dependencies: ['t1'], createdAt: 0, updatedAt: 0, kind: 'review', verdict: 'pass', reviewedTaskId: 't1' },
  ])
  const frozen = amendTaskContract(passed, passed.tasks[0], { verify: ['node -e "process.exit(1)"'] }, 'captain', 'late idea')
  assert.equal(frozen.ok, false)
  assert.match(frozen.error, /frozen/)
})

test('requirements passing judgment also freezes the contract', () => {
  const team = teamWith([
    implTask({ kind: 'implementation' }),
    { id: 't2', subject: 'requirements-round-2', status: 'completed', dependencies: [], createdAt: 0, updatedAt: 0, kind: 'requirements', round: 2, verdict: 'pass', reviewedTaskId: 't1' },
  ])
  const result = amendTaskContract(team, team.tasks[0], { objective: 'different goal' }, 'captain', 'nope')
  assert.equal(result.ok, false)
})

test('terminal tasks and work tasks have nothing amendable', () => {
  const done = teamWith([implTask({ status: 'completed' })])
  assert.equal(amendTaskContract(done, done.tasks[0], { objective: 'x' }, 'captain', 'r').ok, false)
  assert.match(amendTaskContract(done, done.tasks[0], { objective: 'x' }, 'captain', 'r').error, /terminal/)
  const work = teamWith([implTask({ kind: 'work' })])
  const result = amendTaskContract(work, work.tasks[0], { objective: 'x' }, 'captain', 'r')
  assert.equal(result.ok, false)
  assert.match(result.error, /kind=work/)
})

test('amendment requires a reason, an author, and at least one contract field', () => {
  const team = teamWith([implTask()])
  const task = team.tasks[0]
  assert.match(amendTaskContract(team, task, { objective: 'x' }, 'captain', '  ').error, /reason/)
  assert.match(amendTaskContract(team, task, { objective: 'x' }, '  ', 'r').error, /author/)
  assert.match(amendTaskContract(team, task, {}, 'captain', 'r').error, /at least one of/)
})

test('replacement values must be well-formed: non-empty strings, non-empty lists, workspace-relative paths', () => {
  const team = teamWith([implTask()])
  const task = team.tasks[0]
  assert.match(amendTaskContract(team, task, { objective: '  ' }, 'captain', 'r').error, /objective/)
  assert.match(amendTaskContract(team, task, { acceptance: [] }, 'captain', 'r').error, /acceptance/)
  assert.match(amendTaskContract(team, task, { verify: ['run', '  '] }, 'captain', 'r').error, /verify/)
  const absolute = amendTaskContract(team, task, { inScope: ['F:\\team\\src\\'] }, 'captain', 'r')
  assert.equal(absolute.ok, false)
  assert.match(absolute.error, /workspace-relative/)
  const traversal = amendTaskContract(team, task, { outOfScope: ['../secrets'] }, 'captain', 'r')
  assert.equal(traversal.ok, false)
  assert.match(traversal.error, /workspace-relative/)
})

test('revisions accumulate; previous values always snapshot the immediately prior contract', () => {
  const team = teamWith([implTask()])
  const task = team.tasks[0]
  const first = amendTaskContract(team, task, { verify: ['node -e "process.exit(1)"'] }, 'captain', 'first fix')
  assert.equal(first.ok, true)
  const second = amendTaskContract(team, first.task, { verify: ['node -e "process.exit(0)"'], objective: 'Write the sample (revised)' }, 'captain', 'second fix')
  assert.equal(second.ok, true)
  assert.equal(second.task.revisions.length, 2)
  assert.deepEqual(second.task.revisions[0].previous.verify, ['node -e "process.exit(0)"'])
  assert.deepEqual(second.task.revisions[1].previous.verify, ['node -e "process.exit(1)"'])
  assert.deepEqual(second.task.revisions[1].fields.sort(), ['objective', 'verify'])
})

test('durable-state validation accepts well-formed revisions and rejects malformed ones', () => {
  assert.equal(hasValidQualityTaskFields({ revisions: [{ at: 1, by: 'captain', reason: 'r', fields: ['inScope'], previous: { inScope: ['docs/'] } }] }), true)
  assert.equal(hasValidQualityTaskFields({ revisions: [] }), true)
  assert.equal(hasValidQualityTaskFields({ revisions: [{ at: 1, by: '', reason: 'r', fields: ['inScope'], previous: {} }] }), false)
  assert.equal(hasValidQualityTaskFields({ revisions: [{ at: 1, by: 'captain', reason: 'r', fields: [], previous: {} }] }), false)
  assert.equal(hasValidQualityTaskFields({ revisions: 'nope' }), false)
})
