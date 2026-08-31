#!/usr/bin/env node
/**
 * Forced TDD checklist for AgentTeams quality gates (docs/quality-gates.md §9.3).
 *
 * Imports compiled `lib/` exports. Missing functions or old tool behavior
 * must fail the matching label — do not delete or rename these prefixes.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { assignmentPrompt } from '../lib/scheduler.js'
import { applyQualityFollowUp, haltTeamWork, registerAgentTeamsTools } from '../lib/tools.js'
import { createTeamDir, readTeam } from '../lib/state.js'

const require = createRequire(import.meta.url)

let failures = 0
function check(label, value, detail = '') {
  if (value) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures += 1
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
function isMissing(error) {
  return error instanceof TypeError
    || error?.notImplemented === true
    || /is not (a )?function|is not implemented|Cannot read/i.test(String(error?.message ?? error))
}
function requireFn(fn, name) {
  if (typeof fn !== 'function') {
    throw Object.assign(new Error(`${name} is not implemented`), { notImplemented: true })
  }
  return fn
}
function throws(label, fn) {
  try {
    fn()
    failures += 1
    console.error(`  FAIL  ${label} (did not throw)`)
  } catch (error) {
    if (isMissing(error)) {
      failures += 1
      console.error(`  FAIL  ${label} (not implemented)`)
      return
    }
    console.log(`  PASS  ${label}`)
  }
}
async function throwsAsync(label, fn) {
  try {
    await fn()
    failures += 1
    console.error(`  FAIL  ${label} (did not throw)`)
  } catch (error) {
    if (isMissing(error)) {
      failures += 1
      console.error(`  FAIL  ${label} (not implemented)`)
      return
    }
    console.log(`  PASS  ${label}`)
  }
}

function loadStateApi() {
  const state = require('../lib/state.js')
  return {
    pathMatchesScope: state.pathMatchesScope,
    classifyChangedPath: state.classifyChangedPath,
    collectChangedPaths: state.collectChangedPaths,
    evaluateQualityCompletion: state.evaluateQualityCompletion,
    planQualityFollowUp: state.planQualityFollowUp,
    buildCoverageMatrix: state.buildCoverageMatrix,
    canDeclareDelivery: state.canDeclareDelivery,
    resumeTeamState: state.resumeTeamState,
    isTeamTask: state.isTeamTask,
    validateCreateTask: state.validateCreateTask,
    defaultQualityDeliveryGraph: state.defaultQualityDeliveryGraph,
    qualityPlanningPrompt: state.qualityPlanningPrompt,
    sanitizeReviewAcceptance: state.sanitizeReviewAcceptance,
    sanitizeReviewObjective: state.sanitizeReviewObjective,
    normalizeBlankOptionalTaskFields: state.normalizeBlankOptionalTaskFields,
    describeQualityLoop: state.describeQualityLoop,
  }
}

function now() {
  return 1_700_000_000_000
}

function task(partial) {
  return {
    id: 't1',
    subject: 'Task',
    status: 'in_progress',
    dependencies: [],
    createdAt: now(),
    updatedAt: now(),
    attempt: 1,
    attemptId: 'attempt-1',
    ...partial,
  }
}

function member(name, role, extra = {}) {
  return {
    id: `member-${name}`,
    name,
    role,
    joinedAt: now(),
    status: 'idle',
    ...extra,
  }
}

function team(partial = {}) {
  return {
    name: 'Quality',
    id: 'quality',
    description: 'quality-gates',
    captainSessionId: 'captain-session',
    createdAt: now(),
    members: [
      member('implementer', 'implementer'),
      member('reviewer', 'correctness-reviewer'),
    ],
    tasks: [],
    taskSeq: 0,
    reviewPolicy: {
      requirementsMinRounds: 1,
      requirementsMaxRounds: 4,
      codeMaxRounds: 3,
      maxRepairAttempts: 2,
      requiredReviewers: ['correctness', 'security', 'scope'],
    },
    ...partial,
  }
}

function implContract(extra = {}) {
  return {
    kind: 'implementation',
    objective: 'Ship the parser',
    inScope: ['src/parser.ts'],
    outOfScope: ['docs/'],
    acceptance: ['parser accepts empty input'],
    verify: ['pnpm test'],
    ...extra,
  }
}

function reviewContract(extra = {}) {
  return {
    kind: 'review',
    objective: 'Review the implementation',
    acceptance: ['no blocker or high findings'],
    reviewedTaskId: 't1',
    ...extra,
  }
}

const api = loadStateApi()

console.log('quality-gates TDD — A. create contract')

{
  const created = api.validateCreateTask?.(team(), { subject: 'legacy work' })
  check(
    'tdd.create.work-kind-remains-compatible',
    created?.ok === true && (created.task?.kind === 'work' || created.kind === 'work'),
  )
}

console.log('quality-gates TDD — A2. blank optional normalization (#99/#105)')

{
  const normalized = api.normalizeBlankOptionalTaskFields?.({
    kind: 'repair',
    subject: 'repair with blanks',
    objective: '',
    reviewedTaskId: '',
    sourceTaskId: 't1',
    sourceFindingIds: [''],
    inScope: ['', 'src/repair.ts'],
    acceptance: ['fixed'],
  })
  check(
    'tdd.normalize.blank-optional-fields-to-omitted',
    normalized?.reviewedTaskId === undefined
      && normalized?.objective === undefined
      && normalized?.sourceFindingIds === undefined
      && JSON.stringify(normalized?.inScope) === JSON.stringify(['src/repair.ts'])
      && normalized?.sourceTaskId === 't1'
      && JSON.stringify(normalized?.acceptance) === JSON.stringify(['fixed']),
  )
  const untouched = api.normalizeBlankOptionalTaskFields?.({
    reviewedTaskId: 't1',
    inScope: ['src/b.ts'],
    subject: 's',
  })
  check(
    'tdd.normalize.non-blank-values-untouched',
    untouched?.reviewedTaskId === 't1'
      && JSON.stringify(untouched?.inScope) === JSON.stringify(['src/b.ts']),
  )
  for (const invalid of [123, null, { path: 'src/private/' }]) {
    const malformed = task({ acceptance: ['', invalid, 'real criterion'] })
    const normalized = api.normalizeBlankOptionalTaskFields?.(malformed)
    check(
      `tdd.normalize.retains-invalid-list-item.${JSON.stringify(invalid)}`,
      normalized?.acceptance?.length === 2
        && normalized.acceptance[0] === invalid
        && api.isTeamTask?.(normalized) === false
        && malformed.acceptance.length === 3,
    )
  }
}

function rejectCreate(label, current, input, extraOk) {
  throws(label, () => {
    const result = requireFn(api.validateCreateTask, 'validateCreateTask')(current, input)
    if (result?.ok === false && (extraOk === undefined || extraOk(result))) {
      throw new Error('rejected as required')
    }
  })
}

rejectCreate('tdd.create.implementation-requires-objective', team(), {
  subject: 'impl',
  kind: 'implementation',
  acceptance: ['done'],
  inScope: ['src/a.ts'],
  verify: ['pnpm test'],
})

rejectCreate('tdd.create.implementation-requires-acceptance', team(), {
  subject: 'impl',
  kind: 'implementation',
  objective: 'Ship it',
  inScope: ['src/a.ts'],
  verify: ['pnpm test'],
})

rejectCreate('tdd.create.implementation-requires-inscope-and-verify', team(), {
  subject: 'impl',
  kind: 'implementation',
  objective: 'Ship it',
  acceptance: ['done'],
})

rejectCreate('tdd.create.review-requires-reviewed-task', team(), {
  subject: 'review',
  kind: 'review',
  objective: 'Review it',
  acceptance: ['pass'],
})

rejectCreate('tdd.create.repair-requires-source-and-findings', team(), {
  subject: 'repair',
  kind: 'repair',
  objective: 'Fix findings',
  acceptance: ['fixed'],
  inScope: ['src/a.ts'],
  verify: ['pnpm test'],
})

rejectCreate('tdd.create.repair-must-not-depend-on-failed-review', team({
  tasks: [
    task({ id: 't1', kind: 'implementation', status: 'completed', ...implContract() }),
    task({ id: 't2', kind: 'review', status: 'failed', verdict: 'needs_revision', reviewedTaskId: 't1' }),
  ],
  taskSeq: 2,
}), {
  subject: 'repair',
  kind: 'repair',
  objective: 'Fix findings',
  acceptance: ['fixed SEC-001'],
  inScope: ['src/parser.ts'],
  verify: ['pnpm test'],
  sourceTaskId: 't1',
  sourceFindingIds: ['SEC-001'],
  dependencies: ['t2'],
})

rejectCreate('tdd.create.overlapping-inscope-rejects-parallel-ready-tasks', team({
  tasks: [task({
    id: 't1',
    status: 'pending',
    ...implContract({ inScope: ['src/parser.ts', 'src/util.ts'] }),
  })],
  taskSeq: 1,
}), {
  subject: 'other impl',
  ...implContract({ inScope: ['src/util.ts'] }),
}, (result) => String(result.error ?? result.reason ?? '').includes('t1'))

{
  const current = team({
    tasks: [task({
      id: 't1',
      status: 'pending',
      ...implContract({ inScope: ['src/parser.ts'] }),
    })],
    taskSeq: 1,
  })
  const result = api.validateCreateTask?.(current, {
    subject: 'serialized impl',
    ...implContract({ inScope: ['src/parser.ts'] }),
    dependencies: ['t1'],
  })
  check('tdd.create.overlapping-inscope-allowed-when-serialized', result?.ok === true)
}

rejectCreate('tdd.create.implementation-blocked-until-requirements-pass', team({
  tasks: [task({
    id: 't1',
    kind: 'requirements',
    status: 'in_progress',
    objective: 'Converge requirements',
    acceptance: ['no open questions'],
  })],
  taskSeq: 1,
}), {
  subject: 'impl',
  ...implContract(),
})

{
  const requirements = task({
    id: 't1',
    kind: 'requirements',
    status: 'pending',
    objective: 'Converge requirements',
    acceptance: ['no open questions'],
  })
  const result = api.validateCreateTask?.(team({
    phase: 'staged',
    tasks: [requirements],
    taskSeq: 1,
  }), {
    subject: 'planned implementation',
    ...implContract(),
    dependencies: ['t1'],
  })
  check('tdd.create.staged-implementation-can-follow-pending-requirements', result?.ok === true)
}

rejectCreate('tdd.create.staged-implementation-must-depend-on-requirements', team({
  phase: 'staged',
  tasks: [task({
    id: 't1',
    kind: 'requirements',
    status: 'pending',
    objective: 'Converge requirements',
    acceptance: ['no open questions'],
  })],
  taskSeq: 1,
}), {
  subject: 'unsequenced implementation',
  ...implContract(),
})

console.log('quality-gates TDD — B. completion gates')

function rejectComplete(label, currentTask, update, extraOk) {
  throws(label, () => {
    const result = requireFn(api.evaluateQualityCompletion, 'evaluateQualityCompletion')(currentTask, update)
    if ((result?.ok === false || result?.requiredStatus === 'failed') && (extraOk === undefined || extraOk(result))) {
      throw new Error('rejected as required')
    }
  })
}

rejectComplete('tdd.complete.review-without-verdict-rejected', task(reviewContract()), {
  status: 'completed',
  output: 'looks good',
})

rejectComplete('tdd.complete.review-needs-revision-cannot-complete', task(reviewContract()), {
  status: 'completed',
  verdict: 'needs_revision',
  findings: [{ id: 'C-001', severity: 'medium', problem: 'bug', requiredFix: 'fix it' }],
})

rejectComplete('tdd.complete.review-pass-requires-no-open-high-findings', task(reviewContract()), {
  status: 'completed',
  verdict: 'pass',
  findings: [{ id: 'C-001', severity: 'high', problem: 'bug', requiredFix: 'fix it' }],
})

rejectComplete('tdd.complete.implementation-requires-acceptance-results', task(implContract()), {
  status: 'completed',
  changedPaths: ['src/parser.ts'],
  commandsRun: [{ command: 'pnpm test', status: 'passed' }],
})

rejectComplete('tdd.complete.implementation-requires-all-verify-commands', task(implContract({ verify: ['pnpm test', 'pnpm lint'] })), {
  status: 'completed',
  changedPaths: ['src/parser.ts'],
  acceptanceResults: [{ criterion: 'parser accepts empty input', status: 'passed' }],
  commandsRun: [{ command: 'pnpm test', status: 'passed' }],
})

rejectComplete('tdd.complete.out-of-scope-path-cannot-complete', task(implContract()), {
  status: 'completed',
  changedPaths: ['docs/secret.md'],
  acceptanceResults: [{ criterion: 'parser accepts empty input', status: 'passed' }],
  commandsRun: [{ command: 'pnpm test', status: 'passed' }],
})

rejectComplete('tdd.complete.undeclared-path-cannot-complete', task(implContract()), {
  status: 'completed',
  changedPaths: ['src/unlisted.ts'],
  acceptanceResults: [{ criterion: 'parser accepts empty input', status: 'passed' }],
  commandsRun: [{ command: 'pnpm test', status: 'passed' }],
})

rejectComplete('tdd.complete.verify-failure-must-fail-task', task(implContract()), {
  status: 'completed',
  changedPaths: ['src/parser.ts'],
  acceptanceResults: [{ criterion: 'parser accepts empty input', status: 'passed' }],
  commandsRun: [{ command: 'pnpm test', status: 'failed', exitCode: 1 }],
})

rejectComplete('tdd.complete.claimed-still-cannot-jump-to-completed', task({ kind: 'work', status: 'claimed' }), {
  status: 'completed',
  output: 'done',
})

{
  const result = api.evaluateQualityCompletion?.(
    task({ kind: 'work' }),
    { status: 'completed', output: 'free-text result is enough' },
  )
  check('tdd.complete.work-kind-keeps-legacy-output-only-complete', result?.ok === true)
}

{
  const result = api.evaluateQualityCompletion?.(task(implContract({
    acceptance: ['文档确实不含“回滚/rollback”相关章节或说明（故意遗漏）'],
    verify: ['! grep -qiE "回滚|rollback" file.md'],
  })), {
    status: 'completed',
    changedPaths: ['src/parser.ts'],
    acceptanceResults: [{ criterion: '文档确实不含回滚或 rollback 说明', status: 'passed' }],
    commandsRun: [{ command: 'grep reverse check', status: 'passed' }],
  })
  check('tdd.complete.ordered-evidence-tolerates-model-paraphrase', result?.ok === true)
}

console.log('quality-gates TDD — C. path rules')

check(
  'tdd.scope.file-match',
  api.pathMatchesScope?.('src/foo.ts', 'src/foo.ts') === true
    && api.classifyChangedPath?.('src/foo.ts', ['src/foo.ts'], []) === 'in_scope',
)
check(
  'tdd.scope.directory-prefix-match',
  api.pathMatchesScope?.('src/foo/bar.ts', 'src/foo/') === true
    && api.classifyChangedPath?.('src/foo/bar.ts', ['src/foo/'], []) === 'in_scope',
)
check(
  'tdd.scope.out-of-scope-wins',
  api.classifyChangedPath?.('src/foo/secret.ts', ['src/foo/'], ['src/foo/secret.ts']) === 'out_of_scope',
)
check(
  'tdd.scope.rejects-parent-escape',
  api.classifyChangedPath?.('../outside.ts', ['src/'], []) === 'illegal'
    || api.pathMatchesScope?.('../outside.ts', 'src/') === false,
)
check(
  'tdd.scope.rejects-absolute-path',
  api.classifyChangedPath?.('/etc/passwd', ['src/'], []) === 'illegal',
)
check(
  'tdd.scope.default-excludes-env-and-git',
  api.classifyChangedPath?.('.env', ['./'], []) === 'out_of_scope'
    && api.classifyChangedPath?.('.git/config', ['./'], []) === 'out_of_scope'
    && api.classifyChangedPath?.('pkg/.env.local', ['pkg/'], []) === 'out_of_scope',
)

console.log('quality-gates TDD — D. auto loop')

{
  const source = task({
    id: 't1',
    assignee: 'implementer',
    status: 'completed',
    attempt: 1,
    ...implContract(),
  })
  const review = task({
    id: 't2',
    assignee: 'reviewer',
    status: 'failed',
    verdict: 'needs_revision',
    round: 1,
    reviewedTaskId: 't1',
    reviewedAttempt: 1,
    findings: [{
      id: 'C-001',
      severity: 'high',
      file: 'src/parser.ts',
      problem: 'missing null check',
      requiredFix: 'guard empty input',
    }],
    ...reviewContract(),
  })
  const planned = api.planQualityFollowUp?.(team({ tasks: [source, review], taskSeq: 2 }), review)
  const created = planned?.created ?? planned?.tasks ?? []
  const repair = created.find((item) => item.kind === 'repair')
  const nextReview = created.find((item) => item.kind === 'review')
  check(
    'tdd.loop.needs-revision-creates-repair-and-next-review',
    repair !== undefined && nextReview !== undefined,
  )
  check(
    'tdd.loop.repair-depends-on-source-not-failed-review',
    Array.isArray(repair?.dependencies)
      && repair.dependencies.includes('t1')
      && !repair.dependencies.includes('t2'),
  )
  check('tdd.loop.next-review-assigned-to-original-reviewer', nextReview?.assignee === 'reviewer')
  check(
    'tdd.loop.next-review-cannot-be-implementer',
    nextReview !== undefined && nextReview.assignee !== 'implementer',
  )
  check(
    'tdd.loop.round-increments',
    repair?.round === 2 && nextReview?.round === 2,
  )
  check(
    'tdd.loop.next-review-contract-is-not-a-gate-test',
    nextReview !== undefined
      && !/needs_revision/i.test(nextReview.objective ?? '')
      && (nextReview.acceptance ?? []).every((item) => !/needs_revision/i.test(item)),
  )
}

{
  const source = task({ id: 't1', assignee: 'implementer', status: 'completed', round: 3, ...implContract() })
  const review = task({
    id: 't2',
    assignee: 'reviewer',
    status: 'failed',
    verdict: 'needs_revision',
    round: 3,
    reviewedTaskId: 't1',
    findings: [{ id: 'C-001', severity: 'high', problem: 'still broken', requiredFix: 'fix' }],
    ...reviewContract(),
  })
  const planned = api.planQualityFollowUp?.(
    team({ tasks: [source, review], taskSeq: 2, reviewPolicy: { codeMaxRounds: 3 } }),
    review,
  )
  const created = planned?.created ?? planned?.tasks ?? []
  check(
    'tdd.loop.stops-at-max-review-rounds',
    created.length === 0 && (planned?.escalated === true || planned?.status === 'escalated'),
  )
}

{
  const source = task({ id: 't1', assignee: 'implementer', status: 'completed', ...implContract() })
  const review = task({
    id: 't2',
    assignee: 'reviewer',
    status: 'failed',
    verdict: 'reject',
    reviewedTaskId: 't1',
    findings: [{ id: 'C-001', severity: 'blocker', problem: 'wrong approach', requiredFix: 'redesign' }],
    ...reviewContract(),
  })
  const planned = api.planQualityFollowUp?.(team({ tasks: [source, review], taskSeq: 2 }), review)
  const created = planned?.created ?? planned?.tasks ?? []
  check(
    'tdd.loop.reject-does-not-autoresume',
    created.length === 0 && planned?.escalated === true,
  )
}

{
  const requirements = task({
    id: 't1',
    kind: 'requirements',
    assignee: 'reviewer',
    status: 'failed',
    verdict: 'needs_revision',
    round: 1,
    objective: 'Converge requirements',
    acceptance: ['no open questions'],
    findings: [{ id: 'R-001', severity: 'high', problem: 'scope unclear', requiredFix: 'close open questions' }],
  })
  const planned = api.planQualityFollowUp?.(team({ tasks: [requirements], taskSeq: 1 }), requirements)
  const created = planned?.created ?? planned?.tasks ?? []
  check(
    'tdd.loop.requirements-needs-revision-opens-next-requirements-round',
    created.some((item) => item.kind === 'requirements' && item.round === 2)
      && !created.some((item) => item.kind === 'repair'),
  )
}

{
  const source = task({
    id: 't1',
    assignee: 'captain',
    status: 'completed',
    ...implContract(),
  })
  const review = task({
    id: 't2',
    assignee: 'reviewer',
    status: 'failed',
    verdict: 'needs_revision',
    round: 1,
    reviewedTaskId: 't1',
    findings: [{ id: 'C-001', severity: 'high', problem: 'bug', requiredFix: 'fix', file: 'src/parser.ts' }],
    ...reviewContract(),
  })
  const planned = api.planQualityFollowUp?.(team({ tasks: [source, review], taskSeq: 2 }), review)
  const created = planned?.created ?? planned?.tasks ?? []
  const repair = created.find((item) => item.kind === 'repair')
  check(
    'tdd.loop.repair-skips-captain-assignee',
    repair?.assignee === 'implementer' && repair?.assignee !== 'captain',
  )
}

{
  const source = task({ id: 't1', assignee: 'implementer', status: 'completed', ...implContract() })
  const review = task({
    id: 't2',
    assignee: 'reviewer',
    status: 'failed',
    verdict: 'needs_revision',
    round: 1,
    reviewedTaskId: 't1',
    findings: [{ id: 'C-001', severity: 'high', problem: 'bug', requiredFix: 'fix' }],
    ...reviewContract(),
  })
  const existingRepair = task({
    id: 't3',
    status: 'pending',
    assignee: 'implementer',
    sourceTaskId: 't1',
    sourceFindingIds: ['C-001'],
    dependencies: ['t1'],
    round: 2,
    ...implContract({ kind: 'repair', acceptance: ['fix'] }),
  })
  const existingReview = task({
    id: 't4',
    kind: 'review',
    status: 'pending',
    assignee: 'reviewer',
    reviewedTaskId: 't3',
    dependencies: ['t3'],
    round: 2,
    ...reviewContract(),
  })
  const planned = api.planQualityFollowUp?.(
    team({ tasks: [source, review, existingRepair, existingReview], taskSeq: 4 }),
    review,
  )
  const created = planned?.created ?? planned?.tasks ?? []
  check('tdd.loop.same-failed-review-does-not-duplicate-follow-up', created.length === 0)
}

{
  const graph = api.defaultQualityDeliveryGraph?.({
    goal: 'ship the parser',
    implementer: 'implementer',
    reviewer: 'reviewer',
    analyst: 'analyst',
  })
  check(
    'tdd.plan.default-quality-graph-order',
    Array.isArray(graph)
      && graph.map((item) => item.kind).join('>') === 'requirements>implementation>verification>review>integration'
      && graph[3]?.acceptance?.every((item) => !/needs_revision/i.test(item)) === true,
  )
  const prompt = api.qualityPlanningPrompt?.() ?? ''
  check(
    'tdd.plan.prompt-explains-staged-full-dag-and-review-rewire',
    /entire DAG while.*staged/i.test(prompt)
      && /automatically rewires.*downstream/i.test(prompt),
  )
}

{
  const source = task({ id: 't1', kind: 'implementation', status: 'completed', assignee: 'implementer', ...implContract() })
  const review = task({
    id: 't2',
    kind: 'review',
    status: 'failed',
    assignee: 'reviewer',
    dependencies: ['t1'],
    reviewedTaskId: 't1',
    round: 1,
    verdict: 'needs_revision',
    findings: [{ id: 'DOC-001', severity: 'medium', problem: 'missing rollback', requiredFix: 'add rollback', file: 'src/parser.ts' }],
    ...reviewContract(),
  })
  const integration = task({ id: 't3', kind: 'integration', status: 'pending', dependencies: ['t2'] })
  const current = team({ tasks: [source, review, integration], taskSeq: 3 })
  const followUp = applyQualityFollowUp(current, review)
  const replacement = followUp.created.at(-1)
  check(
    'tdd.loop.pending-downstream-rewired-to-new-review-gate',
    followUp.created.map((item) => item.kind).join('>') === 'repair>review'
      && replacement?.kind === 'review'
      && integration.dependencies.join(',') === replacement.id,
  )
}

{
  const cleaned = api.sanitizeReviewAcceptance?.([
    'reviewer 可领取并提交 needs_revision 触发拒绝验证',
    'The latest implementation meets the user goal',
  ])
  const objective = api.sanitizeReviewObjective?.('验证 review needs_revision 不能 completed')
  check(
    'tdd.plan.review-contract-strips-gate-tests',
    Array.isArray(cleaned)
      && cleaned.every((item) => !/needs_revision/i.test(item))
      && typeof objective === 'string'
      && !/needs_revision/i.test(objective),
  )
}

{
  const escalated = api.describeQualityLoop?.(team({
    escalated: true,
    tasks: [
      task({ id: 't1', kind: 'implementation', status: 'completed' }),
      task({ id: 't2', kind: 'review', status: 'failed', verdict: 'needs_revision' }),
    ],
  }))
  const halted = api.describeQualityLoop?.(team({ halted: true, haltedAt: now() }))
  check(
    'tdd.status.escalated-is-not-halted',
    escalated?.state === 'escalated' && escalated.halted === false && /not halt|不是 halt|ceiling/i.test(escalated.summary ?? '')
      && halted?.state === 'halted' && halted.halted === true,
  )
}

console.log('quality-gates TDD — E. halt / resume')

{
  const halted = team({ halted: true, haltedAt: now() })
  const rejected = api.validateCreateTask?.(halted, { subject: 'more work' })
  check(
    'tdd.resume.create-task-does-not-unhalt',
    rejected?.ok === false && halted.halted === true,
  )
}

{
  const halted = team({ halted: true, haltedAt: now() })
  const resumed = api.resumeTeamState?.(halted, 'user asked to continue')
  check(
    'tdd.resume.explicit-resume-clears-halt',
    resumed?.status === 'resumed' && resumed.team?.halted !== true && resumed.team?.haltedAt === undefined,
  )
}

{
  const halted = team({ halted: true, haltedAt: now() })
  const created = api.validateCreateTask?.(halted, {
    subject: 'next stage',
    resume: true,
    resumeReason: 'continue after user answer',
  })
  check(
    'tdd.resume.create-with-resume-reason-unhalts',
    created?.ok === true && (created.team?.halted !== true),
  )
}

{
  const halted = team({
    halted: true,
    haltedAt: now(),
    tasks: [task({ id: 't1', status: 'cancelled', output: 'Stopped from the captain chat.' })],
    taskSeq: 1,
  })
  const resumed = api.resumeTeamState?.(halted, 'continue')
  check(
    'tdd.resume.cancelled-tasks-stay-cancelled',
    resumed?.team?.tasks?.[0]?.status === 'cancelled',
  )
}

throws('tdd.resume.missing-reason-rejected', () => {
  const result = requireFn(api.resumeTeamState, 'resumeTeamState')(team({ halted: true, haltedAt: now() }), '')
  if (result?.ok === false || result?.status === 'rejected') throw new Error('rejected as required')
})

console.log('quality-gates TDD — F. coverage / delivery')

{
  const matrix = api.buildCoverageMatrix?.(
    ['TDD required', 'explicit resume'],
    [task({ id: 't1', kind: 'implementation', status: 'completed', coverageOf: ['TDD required'] })],
  )
  const missing = matrix?.find((row) => row.goal_item === 'explicit resume')
  const delivery = api.canDeclareDelivery?.(team({
    tasks: [task({ id: 't1', kind: 'implementation', status: 'completed', coverageOf: ['TDD required'] })],
  }))
  check(
    'tdd.coverage.missing-item-blocks-delivery',
    missing?.status === 'missing' && delivery?.ok === false,
  )
}

{
  const matrix = api.buildCoverageMatrix?.(
    ['TDD required'],
    [task({ id: 't1', kind: 'implementation', status: 'in_progress', coverageOf: ['TDD required'] })],
  )
  check(
    'tdd.coverage.passed-item-requires-completed-task',
    Array.isArray(matrix) && matrix[0]?.goal_item === 'TDD required' && matrix[0]?.status !== 'passed',
  )
}

{
  const ready = team({
    tasks: [
      task({ id: 't1', kind: 'requirements', status: 'completed', verdict: 'pass', coverageOf: ['goal'] }),
      task({ id: 't2', kind: 'implementation', status: 'completed', coverageOf: ['goal'], ...implContract() }),
      task({ id: 't3', kind: 'verification', status: 'completed' }),
      task({ id: 't4', kind: 'review', status: 'completed', verdict: 'pass', reviewedTaskId: 't2' }),
      task({ id: 't5', kind: 'integration', status: 'completed' }),
    ],
  })
  check('tdd.delivery.ok-only-when-all-gates-pass', api.canDeclareDelivery?.(ready)?.ok === true)
}

{
  const blocked = team({
    tasks: [
      task({ id: 't1', kind: 'implementation', status: 'completed', coverageOf: ['goal'] }),
      task({
        id: 't2',
        kind: 'review',
        status: 'failed',
        verdict: 'needs_revision',
        reviewedTaskId: 't1',
        findings: [{ id: 'C-001', severity: 'high', problem: 'bug', requiredFix: 'fix' }],
      }),
    ],
  })
  const result = api.canDeclareDelivery?.(blocked)
  check(
    'tdd.delivery.failed-review-without-repair-blocks',
    result?.ok === false && Array.isArray(result.blockers) && result.blockers.length > 0,
  )
}

console.log('quality-gates TDD — G. persistence / prompts')

{
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-qg-old-'))
  try {
    const legacy = {
      name: 'Legacy',
      id: 'legacy',
      captainSessionId: 'captain-session',
      createdAt: now(),
      members: [member('worker', 'engineer', { id: 'member-worker' })],
      tasks: [{
        id: 't1',
        subject: 'old work',
        status: 'pending',
        dependencies: [],
        createdAt: now(),
        updatedAt: now(),
      }],
      taskSeq: 1,
    }
    await createTeamDir(workspace, legacy)
    const loaded = await readTeam(workspace, 'legacy')
    check(
      'tdd.state.old-team-json-without-new-fields-still-loads',
      loaded?.id === 'legacy' && loaded.tasks[0]?.subject === 'old work' && loaded.tasks[0]?.kind === undefined,
    )
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

{
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-qg-bad-'))
  try {
    const invalid = team({
      id: 'invalid',
      tasks: [task({ id: 't1', kind: 'review', verdict: 'ship-it', ...reviewContract() })],
      taskSeq: 1,
    })
    let rejected = false
    try {
      await createTeamDir(workspace, invalid)
      await readTeam(workspace, 'invalid')
    } catch {
      rejected = true
    }
    check('tdd.state.invalid-verdict-rejected-at-durable-boundary', rejected === true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

{
  const prompt = assignmentPrompt({
    taskId: 't9',
    memberName: 'implementer',
    memberId: 'm',
    attempt: 1,
    attemptId: 'a',
    subject: 'Implement parser',
    description: 'Only touch the parser.',
    dependencyOutputs: [],
    kind: 'implementation',
    objective: 'Ship the parser',
    inScope: ['src/parser.ts'],
    acceptance: ['empty input returns []'],
    verify: ['pnpm test'],
    round: 1,
  }, '.agent-teams', 'quality')
  check(
    'tdd.prompt.assignment-includes-kind-scope-acceptance',
    prompt.includes('implementation')
      && prompt.includes('src/parser.ts')
      && prompt.includes('empty input returns []'),
  )
}

{
  let usage = ''
  try {
    const index = require('../lib/index.js')
    if (typeof index.usageSectionText === 'function') {
      usage = index.usageSectionText('agent_teams_resume, agent_teams_update_task')
    }
  } catch {
    usage = ''
  }
  check(
    'tdd.usage.mentions-explicit-resume-and-verdict',
    /resume/i.test(usage) && /verdict/i.test(usage),
  )
}

console.log('quality-gates TDD — tool-level closed loop')

{
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-qg-tools-'))
  const definitions = new Map()
  const liveAgents = new Map()
  const children = []
  const listeners = new Map()
  let childSeq = 0
  const captain = {
    id: 'captain-session',
    status: 'idle',
    options: { provider: 'fake', model: 'fake-model' },
    session: {
      header: { cwd: workspace, seedLength: 0 },
      events: [],
      append() {},
      requestHeader() {
        return { config: { provider: 'fake', model: 'fake-model', reasoningEffort: 'high' } }
      },
    },
    followup() {},
    steer() {},
    cancel() {},
    whenIdle() { return Promise.resolve() },
  }
  liveAgents.set(captain.id, captain)
  const ctx = {
    effect(setup) { return setup() },
    tools: {
      register(definition) { definitions.set(definition.name, definition) },
    },
    on(name, listener) {
      const current = listeners.get(name) ?? []
      current.push(listener)
      listeners.set(name, current)
      return () => listeners.set(name, current.filter((item) => item !== listener))
    },
    agents: { get(id) { return liveAgents.get(id) } },
    llm: {
      async resolveCallConfig(config) { return config },
      async listModels() { return [] },
    },
    subagents: {
      registerContinuableSetup() { return () => {} },
      getProvider(name) {
        if (name !== 'spawn') return undefined
        return { prepareContinuable() {}, capabilities: { persona: true, toolFilter: true } }
      },
      list() { return ['spawn'] },
      async startContinuable(spec) {
        const id = `member-session-${++childSeq}`
        const child = {
          id,
          status: 'idle',
          options: { provider: 'fake', model: 'fake-model' },
          session: captain.session,
          followup() {},
          steer() {},
          cancel() {},
          whenIdle() { return Promise.resolve() },
        }
        liveAgents.set(id, child)
        children.push({ id, label: spec.label })
        return { childId: id, messageId: `welcome-${childSeq}` }
      },
      async listChildren() { return children },
      async listDescendants() { return children },
      async followup() { return `message-${childSeq}` },
      interrupt() {},
    },
    logger: { debug() {}, warn() {} },
  }
  registerAgentTeamsTools(ctx, {
    stateDir: '.agent-teams',
    memberProvider: 'spawn',
    memberMaxDepth: 1,
    maxMembers: 8,
    profiles: {},
  })
  const exec = { agent: captain, signal: new AbortController().signal }
  const call = (name, args, subject = captain) => {
    const definition = definitions.get(name)
    if (!definition) throw new Error(`missing tool ${name}`)
    return definition.execute(args, { agent: subject, signal: exec.signal })
  }

  try {
    await call('agent_teams_create', { name: 'Gates', description: 'tool loop' })
    await call('agent_teams_add_member', { name: 'implementer', role: 'implementer' })
    await call('agent_teams_add_member', { name: 'reviewer', role: 'correctness-reviewer' })

    const work = await call('agent_teams_create_task', { subject: 'legacy work' })
    const persistedWork = (await readTeam(join(workspace, '.agent-teams'), 'gates'))?.tasks.find((item) => item.id === work.task_id)
    check(
      'tdd.create.work-kind-remains-compatible.tool',
      persistedWork?.kind === 'work' || persistedWork?.kind === undefined,
    )

    // Regression for #105: a model-materialized reviewedTaskId:"" (plus other
    // blank optionals) on a repair task must be normalized to omitted instead
    // of persisted into team.json, where durable-state validation would brick
    // the whole team on reload.
    const repair = await call('agent_teams_create_task', {
      subject: 'repair with blank optional',
      kind: 'repair',
      sourceTaskId: work.task_id,
      sourceFindingIds: ['F-1'],
      reviewedTaskId: '',
      objective: 'Close F-1',
      acceptance: ['F-1 fixed'],
      inScope: ['', 'src/repair.ts'],
      verify: ['', 'pnpm verify'],
    })
    const persistedRepair = (await readTeam(join(workspace, '.agent-teams'), 'gates'))?.tasks.find((item) => item.id === repair.task_id)
    check(
      'tdd.create.blank-optional-fields-normalized.tool',
      persistedRepair?.reviewedTaskId === undefined
        && persistedRepair?.objective === 'Close F-1'
        && JSON.stringify(persistedRepair?.inScope) === JSON.stringify(['src/repair.ts'])
        && JSON.stringify(persistedRepair?.verify) === JSON.stringify(['pnpm verify']),
    )
    check(
      'tdd.create.team-still-loadable-after-blank-optional.tool',
      (await readTeam(join(workspace, '.agent-teams'), 'gates'))?.id === 'gates',
    )
    await throwsAsync('tdd.create.review-blank-reviewedTaskId-rejected.tool', () => call('agent_teams_create_task', {
      subject: 'review blank id',
      kind: 'review',
      objective: 'Review it',
      acceptance: ['pass'],
      reviewedTaskId: '',
    }))

    // Regression for #99: a blank optional profile must be treated as omitted,
    // not as a hard create failure.
    const blankProfileCaptain = {
      id: 'captain-session-blank-profile',
      status: 'idle',
      options: { provider: 'fake', model: 'fake-model' },
      session: {
        header: { cwd: workspace, seedLength: 0 },
        events: [],
        append() {},
        requestHeader() {
          return { config: { provider: 'fake', model: 'fake-model', reasoningEffort: 'high' } }
        },
      },
      followup() {},
      steer() {},
      cancel() {},
      whenIdle() { return Promise.resolve() },
    }
    liveAgents.set(blankProfileCaptain.id, blankProfileCaptain)
    const blankProfileTeam = await call(
      'agent_teams_create',
      { name: 'Blank Profile', profile: '' },
      blankProfileCaptain,
    )
    check(
      'tdd.create.blank-profile-treated-as-omitted.tool',
      typeof blankProfileTeam?.team_id === 'string' && blankProfileTeam?.profile === undefined,
    )

    await throwsAsync('tdd.create.implementation-requires-objective.tool', () => call('agent_teams_create_task', {
      subject: 'impl',
      kind: 'implementation',
      acceptance: ['done'],
      inScope: ['src/a.ts'],
      verify: ['pnpm test'],
    }))

    await haltTeamWork({
      ctx,
      stateRoot: join(workspace, '.agent-teams'),
      teamId: 'gates',
      captain,
      signal: exec.signal,
    })
    const before = await readTeam(join(workspace, '.agent-teams'), 'gates')
    let createUnhalted = false
    try {
      await call('agent_teams_create_task', { subject: 'should stay halted' })
      createUnhalted = (await readTeam(join(workspace, '.agent-teams'), 'gates'))?.halted !== true
    } catch {
      createUnhalted = (await readTeam(join(workspace, '.agent-teams'), 'gates'))?.halted !== true
    }
    check(
      'tdd.resume.create-task-does-not-unhalt.tool',
      before?.halted === true && createUnhalted === false,
    )

    const resumeTool = definitions.get('agent_teams_resume')
    check('tdd.resume.explicit-resume-clears-halt.tool-exists', resumeTool !== undefined)
    if (resumeTool) {
      await resumeTool.execute({ reason: 'user asked to continue' }, exec)
      check(
        'tdd.resume.explicit-resume-clears-halt.tool',
        (await readTeam(join(workspace, '.agent-teams'), 'gates'))?.halted !== true,
      )
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

if (failures > 0) {
  console.error(`quality-gates TDD failed: ${failures} check(s)`)
  process.exitCode = 1
} else {
  console.log('quality-gates TDD checks passed')
}
