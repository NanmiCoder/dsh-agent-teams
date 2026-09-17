#!/usr/bin/env node
/**
 * Regression tests for auto-repair inScope derivation (planQualityFollowUp).
 *
 * Incident: a review finding observed the mismatch in `data/sample.txt` but
 * its requiredFix said "edit README.md". The generated repair round declared
 * inScope from `finding.file` alone, so its acceptance ("edit README.md")
 * named a path the scope forbade — no honest completion existed and the
 * repair dead-locked (worker blocked, downstream review permanently pending).
 *
 * Issue #173: derive every required path before dropping inherited exclusions
 * that conflict with the generated repair scope. Handwritten contracts still
 * enforce outOfScope first.
 *
 * Run: node --test scripts/quality-gates-repair-scope.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyChangedPath, evaluateQualityCompletion, planQualityFollowUp, repairScopeFromFindings } from '../lib/quality-gates.js'

function finding(extra = {}) {
  return { id: 'F1', severity: 'medium', problem: 'problem', requiredFix: 'fix it', ...extra }
}

function member(name, role) {
  return { id: `member-${name}`, name, role, joinedAt: 0, status: 'idle' }
}

function teamWithSource(extra = {}) {
  return {
    name: 't', id: 't', description: '', captainSessionId: 'captain',
    createdAt: 0, taskSeq: 1,
    members: [member('implementer', 'implementer'), member('reviewer', 'reviewer')],
    tasks: [{
      id: 't1', subject: 'impl', status: 'completed', dependencies: [],
      createdAt: 0, updatedAt: 0, attempt: 1, kind: 'implementation',
      assignee: 'implementer',
      inScope: ['src/'], acceptance: ['done'], verify: ['pnpm test'],
      ...extra,
    }],
  }
}

function failedReview(extra = {}) {
  return {
    id: 't2', subject: 'review', status: 'failed', dependencies: ['t1'],
    createdAt: 0, updatedAt: 0, attempt: 1, kind: 'review', round: 1,
    assignee: 'reviewer', verdict: 'needs_revision', reviewedTaskId: 't1',
    objective: 'Review', acceptance: ['no blockers'],
    findings: [finding()],
    ...extra,
  }
}

test('repair scope includes the fix target named in requiredFix, not just the observed file', () => {
  const scope = repairScopeFromFindings(
    [finding({ file: 'data/sample.txt', requiredFix: 'change README.md:5 to "2 lines / 5 words"' })],
    ['data/sample.txt'],
  )
  assert.ok(scope.includes('README.md'), `README.md missing from ${JSON.stringify(scope)}`)
  assert.ok(scope.includes('data/sample.txt'), `observed file missing from ${JSON.stringify(scope)}`)
})

test('repair scope drops absolute paths that can never match workspace-relative patterns', () => {
  const scope = repairScopeFromFindings(
    [finding({ file: 'F:\\team\\data\\sample.txt', requiredFix: 'update README.md sample reference to 5 words' })],
    ['src/'],
  )
  assert.deepEqual(scope, ['README.md'])
})

test('repair scope falls back to the source inScope when findings name nothing legal', () => {
  const scope = repairScopeFromFindings(
    [finding({ requiredFix: 'reinstall the tool globally and retry' })],
    ['src/'],
  )
  assert.deepEqual(scope, ['src/'])
})

test('line-number suffixes are stripped from derived paths', () => {
  const scope = repairScopeFromFindings(
    [finding({ requiredFix: 'rewrite docs/guide.md:42 to match the new flow' })],
    undefined,
  )
  assert.deepEqual(scope, ['docs/guide.md'])
})

test('end-to-end: generated repair round is satisfiable for the incident shape', () => {
  const closed = failedReview({
    findings: [finding({
      file: 'data/sample.txt',
      requiredFix: 'A (recommended) change README.md to "2 lines / 5 words"; do not modify wc.js',
    })],
  })
  const result = planQualityFollowUp(teamWithSource(), closed)
  const repair = result.created.find((item) => item.kind === 'repair')
  assert.ok(repair, 'repair round must be generated')
  assert.ok(repair.inScope.includes('README.md'), `README.md missing from ${JSON.stringify(repair.inScope)}`)
  assert.ok(
    repair.acceptance.every((criterion) => criterion.length > 0),
    'acceptance must stay non-empty',
  )
})

for (const [label, source, findings, expectedScope, expectedExclusions] of [
  ['real F_DOC incident',
    { inScope: ['data/sample.txt'], outOfScope: ['README.md', 'check-data.mjs', 'reports/'] },
    [finding({ file: 'data/sample.txt', requiredFix: 'Edit README.md to contain exactly 2 words. Keep data/sample.txt unchanged.' })],
    ['data/sample.txt', 'README.md'], ['check-data.mjs', 'reports/']],
  ['directory exclusion covers observed and required paths',
    { inScope: ['src/'], outOfScope: ['deploy/', 'go.mod'] },
    [finding({ file: 'deploy/old.txt', requiredFix: 'edit deploy/new.txt and deploy/old.txt' }), finding({ file: 'deploy/old.txt' })],
    ['deploy/old.txt', 'deploy/new.txt'], ['go.mod']],
  ['fallback scope has duplicates and overlapping exclusions',
    { inScope: ['src/', 'src/'], outOfScope: ['src/private.ts', 'docs/'] },
    [finding()], ['src/'], ['docs/']],
]) {
  test(`generated repair is completable: ${label}`, () => {
    const state = teamWithSource(source)
    const original = structuredClone(state)
    const closed = failedReview({ findings })
    const result = planQualityFollowUp(state, closed)
    const repair = result.created.find((item) => item.kind === 'repair')
    assert.deepEqual(repair.inScope, expectedScope)
    assert.deepEqual(repair.outOfScope, expectedExclusions)
    assert.deepEqual(state, original, 'source contract must remain untouched')
    assert.deepEqual(repair.acceptance, findings.map((item) => item.requiredFix))
    for (const path of expectedScope) {
      const concretePath = path.endsWith('/') ? `${path}fixed.ts` : path
      assert.equal(classifyChangedPath(concretePath, repair.inScope, repair.outOfScope), 'in_scope')
      const completion = evaluateQualityCompletion({ ...repair, status: 'in_progress' }, {
        status: 'completed', changedPaths: [concretePath],
        acceptanceResults: repair.acceptance.map((criterion) => ({ criterion, status: 'passed' })),
        commandsRun: [{ command: 'pnpm test', status: 'passed', exitCode: 0 }],
      })
      assert.equal(completion.ok, true, completion.error)
    }
    assert.equal(result.created.find((item) => item.kind === 'review').reviewedTaskId, repair.id)
    for (const path of expectedExclusions) {
      assert.equal(classifyChangedPath(path, repair.inScope, repair.outOfScope), 'out_of_scope')
    }
  })
}
