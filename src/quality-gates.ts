/**
 * Pure quality-gate rules: contracts, path audit, completion, follow-up,
 * coverage, and resume. Tools and persistence call these; they do not I/O.
 * @module dsh-agent-teams/quality-gates
 */

import {
  FINDING_SEVERITIES,
  REVIEW_VERDICTS,
  TASK_KINDS,
  TERMINAL_TASK_STATUSES,
  type AcceptanceResult,
  type ArtifactDigest,
  type ArtifactScopeGap,
  type ArtifactSnapshot,
  type CommandResult,
  type FindingSeverity,
  type ReviewFinding,
  type ReviewPolicy,
  type ReviewVerdict,
  type TaskKind,
  type TaskEvidence,
  type TaskRevision,
  type TaskStatus,
  type TeamState,
  type TeamTask,
} from './types.ts'

const QUALITY_KINDS: readonly TaskKind[] = [
  'requirements',
  'implementation',
  'verification',
  'review',
  'repair',
  'integration',
]

const WRITE_KINDS: readonly TaskKind[] = ['implementation', 'repair']
const OPEN_STATUSES: readonly TaskStatus[] = ['pending', 'claimed', 'in_progress']
const DEFAULT_REVIEW_POLICY: Required<Pick<
  ReviewPolicy,
  'requirementsMinRounds' | 'requirementsMaxRounds' | 'codeMaxRounds' | 'maxRepairAttempts'
>> = {
  requirementsMinRounds: 1,
  requirementsMaxRounds: 4,
  codeMaxRounds: 3,
  maxRepairAttempts: 2,
}

export type PathClassification = 'in_scope' | 'out_of_scope' | 'undeclared' | 'illegal'

export interface CreateTaskInput {
  subject: string
  description?: string
  dependencies?: string[]
  assignee?: string
  kind?: TaskKind
  round?: number
  objective?: string
  inScope?: string[]
  outOfScope?: string[]
  acceptance?: string[]
  verify?: string[]
  deliverables?: string[]
  nonGoals?: string[]
  reviewedTaskId?: string
  sourceTaskId?: string
  sourceFindingIds?: string[]
  coverageOf?: string[]
  resume?: boolean
  resumeReason?: string
}

export interface ValidateCreateTaskResult {
  ok: boolean
  error?: string
  kind?: TaskKind
  task?: Partial<TeamTask>
  team?: TeamState
}

export interface QualityCompletionUpdate {
  status?: TaskStatus
  output?: string
  verdict?: ReviewVerdict
  findings?: ReviewFinding[]
  changedPaths?: string[]
  acceptanceResults?: AcceptanceResult[]
  commandsRun?: CommandResult[]
}

export interface QualityCompletionResult {
  ok: boolean
  error?: string
  requiredStatus?: TaskStatus
}

export interface PlannedFollowUpTask {
  id?: string
  kind: TaskKind
  subject?: string
  description?: string
  assignee?: string
  dependencies?: string[]
  round?: number
  objective?: string
  inScope?: string[]
  outOfScope?: string[]
  acceptance?: string[]
  verify?: string[]
  sourceTaskId?: string
  sourceFindingIds?: string[]
  findingSourceTaskIds?: string[]
  reviewedTaskId?: string
  /**
   * Paths whose current bytes the generated contract was derived from. The
   * caller snapshots them so the work order can later be marked stale.
   */
  contractPaths?: string[]
}

export interface PlanQualityFollowUpResult {
  created: PlannedFollowUpTask[]
  tasks: PlannedFollowUpTask[]
  escalated?: boolean
  status?: 'escalated'
  /** Why the automatic loop stopped; surfaced to the captain. */
  reason?: string
  /** Findings that were refused as contract material (default-excluded paths). */
  excludedFindings?: string[]
}

export interface CoverageRow {
  goal_item: string
  task_ids: string[]
  status: 'missing' | 'in_progress' | 'passed' | 'blocked'
  evidence?: string
}

export interface DeliveryResult {
  ok: boolean
  blockers: string[]
  /**
   * Non-blocking observations: gates that legitimately drifted because a later
   * revision superseded them, and generated work orders whose cited files
   * moved on. Delivery is still allowed, but never silently.
   */
  warnings: string[]
}

/**
 * Current workspace bytes handed to the delivery check. The rules stay pure:
 * the caller (which owns the workspace path) reads the digests and passes them
 * in. Omit it when no workspace is available — the attempt-level staleness
 * checks still run, and content checks simply cannot be made.
 */
export interface ScopeEntry {
  path: string
  present: boolean
}

export interface DeliveryAudit {
  /** Current bytes of the paths recorded by verdicts and work orders. */
  artifacts?: readonly ArtifactDigest[]
  /**
   * Current contents of the scope patterns recorded verdicts bound. A path that
   * appears here but not in the verdict's recorded artifacts was never
   * reviewed, so a broad scope cannot silently absorb it.
   */
  expandedScope?: readonly ScopeEntry[]
  /**
   * Parts of the *current* read that could not be completed (expansion cap,
   * unreadable directory or file, illegal pattern). A non-empty list means the
   * audit itself is incomplete, so no verdict may be confirmed from it.
   */
  gaps?: readonly ArtifactScopeGap[]
}

export interface ResumeTeamResult {
  ok?: boolean
  status: 'resumed' | 'already_running' | 'rejected'
  team?: TeamState
  error?: string
}

export type QualityLoopState = 'running' | 'halted' | 'escalated' | 'deliverable' | 'blocked'

export interface QualityLoopSnapshot {
  state: QualityLoopState
  halted: boolean
  escalated: boolean
  deliverable: boolean
  summary: string
  /** Non-blocking gate observations (stale verdicts and work orders). */
  warnings: string[]
}

export interface QualityGraphDraft {
  subject: string
  kind: TaskKind
  assignee?: string
  dependencies: string[]
  objective: string
  acceptance: string[]
  inScope?: string[]
  verify?: string[]
  coverageOf?: string[]
}

export const DEFAULT_REVIEW_ACCEPTANCE = [
  'The latest implementation meets the user goal',
  'No unresolved blocker or high findings',
] as const

export const DEFAULT_REVIEW_OBJECTIVE = 'Review whether the latest implementation satisfies the user goal'

const GATE_TEST_CONTRACT = /needs[_ ]revision|拒绝路径|verdict\s*=\s*needs_revision|cannot complete|不能完成|触发拒绝/iu

export function taskKindOf(task: Pick<TeamTask, 'kind'> | undefined): TaskKind {
  return task?.kind ?? 'work'
}

export function isQualityKind(kind: TaskKind | undefined): boolean {
  return kind !== undefined && kind !== 'work' && (QUALITY_KINDS as readonly string[]).includes(kind)
}

export function resolveReviewPolicy(policy: ReviewPolicy | undefined): Required<typeof DEFAULT_REVIEW_POLICY> & ReviewPolicy {
  return {
    ...DEFAULT_REVIEW_POLICY,
    ...policy,
    requirementsMinRounds: policy?.requirementsMinRounds ?? DEFAULT_REVIEW_POLICY.requirementsMinRounds,
    requirementsMaxRounds: policy?.requirementsMaxRounds ?? DEFAULT_REVIEW_POLICY.requirementsMaxRounds,
    codeMaxRounds: policy?.codeMaxRounds ?? DEFAULT_REVIEW_POLICY.codeMaxRounds,
    maxRepairAttempts: policy?.maxRepairAttempts ?? DEFAULT_REVIEW_POLICY.maxRepairAttempts,
  }
}

export function isReviewPolicy(value: unknown): value is ReviewPolicy {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  const numbers = ['requirementsMinRounds', 'requirementsMaxRounds', 'codeMaxRounds', 'maxRepairAttempts'] as const
  for (const key of numbers) {
    const item = value[key]
    if (item === undefined) continue
    if (!Number.isSafeInteger(item) || (item as number) < 1) return false
  }
  const min = (value['requirementsMinRounds'] as number | undefined) ?? DEFAULT_REVIEW_POLICY.requirementsMinRounds
  const max = (value['requirementsMaxRounds'] as number | undefined) ?? DEFAULT_REVIEW_POLICY.requirementsMaxRounds
  if (min > max) return false
  if (value['requiredReviewers'] !== undefined) {
    if (!Array.isArray(value['requiredReviewers'])) return false
    if (!value['requiredReviewers'].every((item) => typeof item === 'string' && item.trim() !== '')) return false
  }
  const allowed = new Set([...numbers, 'requiredReviewers'])
  return Object.keys(value).every((key) => allowed.has(key))
}

/** Normalize a workspace-relative POSIX path. `undefined` means illegal. */
export function normalizeWorkspacePath(path: string): string | undefined {
  if (typeof path !== 'string') return undefined
  const trimmed = path.trim()
  if (trimmed === '') return undefined
  if (trimmed.startsWith('~') || /^[A-Za-z]:/.test(trimmed)) return undefined
  const posix = trimmed.replaceAll('\\', '/')
  if (posix.startsWith('/')) return undefined
  const parts: string[] = []
  for (const part of posix.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') return undefined
    parts.push(part)
  }
  return parts.join('/')
}

export function pathMatchesScope(path: string, pattern: string): boolean {
  const normalizedPath = normalizeWorkspacePath(path)
  if (normalizedPath === undefined) return false
  const rawPattern = pattern.trim().replaceAll('\\', '/')
  if (rawPattern.startsWith('~') || rawPattern.startsWith('/') || /^[A-Za-z]:/.test(rawPattern)) return false
  const directory = rawPattern.endsWith('/')
  const normalizedPattern = normalizeWorkspacePath(rawPattern)
  if (normalizedPattern === undefined) {
    if (directory && (rawPattern === './' || rawPattern === '/' || rawPattern === '.')) return true
    return false
  }
  if (directory || rawPattern === './' || rawPattern === '.') {
    if (normalizedPattern === '') return true
    return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`)
  }
  return normalizedPath === normalizedPattern
}

/**
 * Paths no quality contract may claim: version control, harness/plugin state,
 * secrets and private keys. Exported because the completion gate and contract
 * generation (including the artifact reader that must not walk into
 * `.agent-teams/`, `secrets/` or `.env*`) have to share exactly one predicate.
 */
export function isDefaultExcludedPath(path: string): boolean {
  const normalized = normalizeWorkspacePath(path)
  if (normalized === undefined) return false
  const segments = normalized.split('/')
  const base = segments[segments.length - 1] ?? ''
  if (segments[0] === '.git' || segments[0] === '.dsh' || segments[0] === '.agent-teams') return true
  if (base === '.env' || base.startsWith('.env.')) return true
  if (segments.includes('secrets')) return true
  if (base.startsWith('id_rsa')) return true
  return false
}

function isDefaultExcluded(path: string): boolean {
  return isDefaultExcludedPath(path)
}

export function classifyChangedPath(
  path: string,
  inScope: readonly string[] = [],
  outOfScope: readonly string[] = [],
): PathClassification {
  if (normalizeWorkspacePath(path) === undefined) return 'illegal'
  if (isDefaultExcluded(path)) return 'out_of_scope'
  if (outOfScope.some((pattern) => pathMatchesScope(path, pattern))) return 'out_of_scope'
  if (inScope.some((pattern) => pathMatchesScope(path, pattern))) return 'in_scope'
  return 'undeclared'
}

export function collectChangedPaths(gitStatusText: string): string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const rawLine of gitStatusText.split(/\r?\n/u)) {
    const line = rawLine.trimEnd()
    if (line.trim() === '') continue
    let candidate = line
    const rename = /->\s+(\S+)$/u.exec(line)
    if (/^[ MADRCU?!]{1,2}\s+/u.test(line)) {
      candidate = rename?.[1] ?? line.replace(/^[ MADRCU?!]{1,2}\s+/u, '')
    }
    const cleaned = candidate.replace(/^"|"$/gu, '').trim()
    const normalized = normalizeWorkspacePath(cleaned)
    if (normalized === undefined || seen.has(normalized)) continue
    seen.add(normalized)
    paths.push(normalized)
  }
  return paths
}

export function inScopeOverlap(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): string[] {
  if (left === undefined || right === undefined) return []
  const hits: string[] = []
  for (const a of left) {
    for (const b of right) {
      if (pathMatchesScope(a, b) || pathMatchesScope(b, a) || a === b) {
        if (!hits.includes(a)) hits.push(a)
      }
    }
  }
  return hits
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function nonemptyStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonemptyString)
}

function dependencyClosureContains(
  tasks: readonly TeamTask[],
  dependencies: readonly string[],
  targetId: string,
): boolean {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const pending = [...dependencies]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const id = pending.pop()
    if (id === undefined || visited.has(id)) continue
    if (id === targetId) return true
    visited.add(id)
    pending.push(...(byId.get(id)?.dependencies ?? []))
  }
  return false
}

export function validateCreateTask(team: TeamState, input: CreateTaskInput): ValidateCreateTaskResult {
  const kind = input.kind ?? 'work'
  if (!(TASK_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: `unknown task kind "${String(kind)}"` }
  }
  if (!nonemptyString(input.subject)) {
    return { ok: false, error: 'task subject must not be empty' }
  }

  if (team.halted === true) {
    const reason = input.resumeReason?.trim() ?? ''
    if (input.resume !== true || reason === '') {
      return { ok: false, error: 'team is halted; resume with a non-empty reason before create_task' }
    }
  }

  if (isQualityKind(kind)) {
    if (!nonemptyString(input.objective)) {
      return { ok: false, error: `${kind} tasks require a non-empty objective` }
    }
    if (!nonemptyStringList(input.acceptance)) {
      return { ok: false, error: `${kind} tasks require at least one acceptance criterion` }
    }
  }
  if (WRITE_KINDS.includes(kind)) {
    if (!nonemptyStringList(input.inScope)) {
      return { ok: false, error: `${kind} tasks require a non-empty inScope` }
    }
    if (!nonemptyStringList(input.verify)) {
      return { ok: false, error: `${kind} tasks require a non-empty verify list` }
    }
  }
  if (kind === 'review') {
    if (!nonemptyString(input.reviewedTaskId)) {
      return { ok: false, error: 'review tasks require reviewedTaskId' }
    }
    if (!team.tasks.some((item) => item.id === input.reviewedTaskId)) {
      return { ok: false, error: `reviewed task "${input.reviewedTaskId}" does not exist` }
    }
  }
  if (kind === 'repair') {
    if (!nonemptyString(input.sourceTaskId) || !nonemptyStringList(input.sourceFindingIds)) {
      return { ok: false, error: 'repair tasks require sourceTaskId and at least one sourceFindingId' }
    }
    if (!team.tasks.some((item) => item.id === input.sourceTaskId)) {
      return { ok: false, error: `source task "${input.sourceTaskId}" does not exist` }
    }
    const duplicate = team.tasks.find(item => taskKindOf(item) === 'repair'
      && OPEN_STATUSES.includes(item.status) && item.sourceTaskId === input.sourceTaskId
      && findingKey(item.sourceFindingIds ?? []) === findingKey(input.sourceFindingIds ?? []))
    if (duplicate !== undefined) return { ok: false, error: `repair task ${duplicate.id} already covers these findings; use that task instead of creating duplicate work` }

  }

  const dependencies = input.dependencies ?? []
  for (const dependency of dependencies) {
    const upstream = team.tasks.find((item) => item.id === dependency)
    if (upstream === undefined) {
      return { ok: false, error: `dependency "${dependency}" does not exist` }
    }
    if ((kind === 'repair' || kind === 'review') && (upstream.status === 'failed' || upstream.status === 'cancelled')) {
      return { ok: false, error: `${kind} must not depend on ${upstream.status} task "${dependency}"` }
    }
  }

  if (WRITE_KINDS.includes(kind) && nonemptyStringList(input.inScope)) {
    for (const other of team.tasks) {
      if (!WRITE_KINDS.includes(taskKindOf(other))) continue
      if (!OPEN_STATUSES.includes(other.status)) continue
      if (dependencies.includes(other.id) || other.dependencies.includes('pending-new')) continue
      if (dependencies.includes(other.id)) continue
      const overlap = inScopeOverlap(input.inScope, other.inScope)
      if (overlap.length > 0) {
        return {
          ok: false,
          error: `inScope overlaps ${other.id} at ${overlap.join(', ')}; serialize these tasks or split the paths`,
        }
      }
    }
  }

  if (kind === 'implementation') {
    const requirements = team.tasks.filter((item) => taskKindOf(item) === 'requirements')
    const passed = requirements.some((item) => item.status === 'completed' && item.verdict === 'pass')
    const behindRequirements = requirements.some((item) => (
      dependencyClosureContains(team.tasks, dependencies, item.id)
    ))
    // Planning an implementation is safe in either approval mode when its
    // dependency chain fences execution behind requirements. Scheduling and
    // claiming still wait for successful dependency completion.
    if (requirements.length > 0 && !passed && !behindRequirements) {
      return {
        ok: false,
        error: 'implementation must depend on a requirements task until requirements completes with verdict=pass',
      }
    }
  }

  const nextTeam = team.halted === true && input.resume === true
    ? { ...team, halted: false, haltedAt: undefined }
    : team
  return {
    ok: true,
    kind,
    team: nextTeam,
    task: {
      subject: input.subject,
      kind,
      ...input.description === undefined ? {} : { description: input.description },
      ...input.assignee === undefined ? {} : { assignee: input.assignee },
      dependencies,
      ...input.round === undefined ? {} : { round: input.round },
      ...input.objective === undefined ? {} : { objective: input.objective },
      ...input.inScope === undefined ? {} : { inScope: input.inScope },
      ...input.outOfScope === undefined ? {} : { outOfScope: input.outOfScope },
      ...input.acceptance === undefined ? {} : { acceptance: input.acceptance },
      ...input.verify === undefined ? {} : { verify: input.verify },
      ...input.deliverables === undefined ? {} : { deliverables: input.deliverables },
      ...input.nonGoals === undefined ? {} : { nonGoals: input.nonGoals },
      ...input.reviewedTaskId === undefined ? {} : { reviewedTaskId: input.reviewedTaskId },
      ...input.sourceTaskId === undefined ? {} : { sourceTaskId: input.sourceTaskId },
      ...input.sourceFindingIds === undefined ? {} : { sourceFindingIds: input.sourceFindingIds },
      ...input.coverageOf === undefined ? {} : { coverageOf: input.coverageOf },
    },
  }
}

const STATUS_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['claimed', 'cancelled'],
  claimed: ['in_progress', 'failed', 'cancelled'],
  in_progress: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
}

function openHighFindings(findings: readonly ReviewFinding[] | undefined): ReviewFinding[] {
  return (findings ?? []).filter((finding) => (
    finding.resolved !== true && (finding.severity === 'high' || finding.severity === 'blocker')
  ))
}

function acceptanceCovered(required: readonly string[] | undefined, results: readonly AcceptanceResult[] | undefined): boolean {
  if (results === undefined) return false
  const byCriterion = new Map(results.map((item) => [item.criterion, item]))
  if ((required ?? []).every((criterion) => byCriterion.get(criterion)?.status === 'passed')) return true
  // Structured result arrays naturally preserve the contract order. Accept a
  // same-length all-pass report even when a model paraphrases punctuation or
  // whitespace in `criterion`; verification evidence remains independently
  // required below. This avoids turning display text into an opaque id.
  return results.length === (required ?? []).length && results.every((item) => item.status === 'passed')
}

function verifyCovered(required: readonly string[] | undefined, results: readonly CommandResult[] | undefined): boolean {
  if (results === undefined) return false
  const byCommand = new Map(results.map((item) => [item.command, item]))
  if ((required ?? []).every((command) => byCommand.get(command)?.status === 'passed')) return true
  return results.length === (required ?? []).length && results.every((item) => item.status === 'passed')
}

export function evaluateQualityCompletion(
  task: TeamTask,
  update: QualityCompletionUpdate,
): QualityCompletionResult {
  const nextStatus = update.status
  if (nextStatus !== undefined && nextStatus !== task.status) {
    if (!STATUS_TRANSITIONS[task.status].includes(nextStatus)) {
      return { ok: false, error: `task status cannot move from "${task.status}" to "${nextStatus}"` }
    }
  }

  const kind = taskKindOf(task)
  if (kind === 'work') return { ok: true }

  const verdict = update.verdict ?? task.verdict
  const findings = update.findings ?? task.findings
  if (kind === 'review' || kind === 'requirements') {
    if (nextStatus === 'completed') {
      if (verdict === undefined) return { ok: false, error: `${kind} cannot complete without verdict=pass` }
      if (verdict !== 'pass') return { ok: false, error: `${kind} with verdict=${verdict} cannot complete` }
      if (openHighFindings(findings).length > 0) {
        return { ok: false, error: `${kind} pass cannot leave unresolved high/blocker findings` }
      }
    }
    if (nextStatus === 'failed' && (verdict === 'needs_revision' || verdict === 'reject')) {
      if ((findings ?? []).length < 1) {
        return { ok: false, error: `${kind} ${verdict} requires at least one finding` }
      }
    }
    return { ok: true }
  }

  if (kind === 'implementation' || kind === 'repair' || kind === 'verification' || kind === 'integration') {
    const commands = update.commandsRun ?? task.commandsRun
    if (commands?.some((item) => item.status === 'failed') === true) {
      if (nextStatus === 'completed') {
        return { ok: false, error: 'verify failure must fail the task', requiredStatus: 'failed' }
      }
    }
    if (nextStatus !== 'completed') return { ok: true }
    const acceptanceResults = update.acceptanceResults ?? task.acceptanceResults
    if (acceptanceResults === undefined || !acceptanceCovered(task.acceptance, acceptanceResults)) {
      return { ok: false, error: `${kind} completion requires passed acceptanceResults for every acceptance item` }
    }
    if (commands === undefined || !verifyCovered(task.verify, commands)) {
      return { ok: false, error: `${kind} completion requires a passed commandsRun entry for every verify command` }
    }
    if (kind === 'implementation' || kind === 'repair') {
      const changed = update.changedPaths ?? task.changedPaths
      if (changed === undefined) {
        return { ok: false, error: `${kind} completion requires changedPaths` }
      }
      for (const path of changed) {
        const classification = classifyChangedPath(path, task.inScope ?? [], task.outOfScope ?? [])
        if (classification !== 'in_scope') {
          return { ok: false, error: `${kind} cannot complete: ${path} is ${classification}` }
        }
      }
    }
  }
  return { ok: true }
}

function unresolvedFindings(task: TeamTask): ReviewFinding[] {
  return (task.findings ?? []).filter((finding) => finding.resolved !== true)
}

function findingKey(ids: readonly string[]): string {
  return [...ids].sort().join(',')
}

/**
 * Path-like tokens worth considering as repair-scope candidates. Two shapes:
 * slash paths (`src/parser.ts`, `docs/guide.md`) and bare filenames with a
 * known code/doc extension (`README.md`, `wc.js`). An optional `:line`
 * suffix is tolerated and stripped. The extension allowlist keeps version
 * tokens (`v0.1.17`), hex hashes, and prose out of the derived scope.
 */
const REPAIR_SCOPE_PATH_PATTERN = /(?:[A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)+|[\w.\-]+\.(?:tsx?|jsx?|mjs|cjs|json|md|txt|ya?ml|py|rs|go|java|html?|css|scss|sh|ps1|toml|xml|sql))(?::\d+)?/gu
const REPAIR_SCOPE_LINE_SUFFIX = /:\d+$/

/**
 * Derive the repair round's inScope from the findings that caused it.
 *
 * `finding.file` records where the problem was OBSERVED, but the fix often
 * targets a different file named in `requiredFix` (docs vs sample data,
 * config vs code). Deriving the scope from both keeps the auto-generated
 * repair contract satisfiable; deriving from `file` alone can produce a
 * contract where the acceptance ("edit README.md") names a path the scope
 * forbids, so no honest completion exists and the repair dead-locks.
 *
 * Absolute and otherwise illegal paths are dropped (they can never match
 * workspace-relative scope patterns anyway), and so are paths the completion
 * gate refuses by default (`secrets/` segments, `.env*`, `.git`, `.dsh`,
 * `id_rsa*` — issue #183). `classifyChangedPath` checks that default-exclusion
 * set BEFORE inScope, so collecting such a path here would generate a contract
 * that demands an edit the gate calls `out_of_scope`: no honest completion
 * exists and the repair burns its rounds. Contract generation and the
 * completion gate must agree; the exemption channel stays the user-configured
 * outOfScope list, never a reviewer's finding.
 *
 * When nothing legal remains, the source task's own inScope is kept as the
 * fallback. Over-inclusion is accepted otherwise: inScope is an audit upper
 * bound, and the requiredFix text still tells the implementer what to touch.
 * Keep every remaining derived path until the generator resolves inherited
 * exclusions; filtering those first would silently discard a required fix
 * target.
 */
export function repairScopeFromFindings(
  findings: readonly ReviewFinding[],
  fallback: string[] | undefined,
): string[] | undefined {
  const derived: string[] = []
  for (const finding of findings) {
    for (const path of findingDerivedPaths(finding)) {
      if (isDefaultExcludedPath(path) || derived.includes(path)) continue
      derived.push(path)
    }
  }
  return derived.length > 0 ? derived : fallback === undefined ? undefined : [...new Set(fallback)]
}

/**
 * Every workspace-relative path one finding names, before any exclusion rule:
 * the observed file plus the fix targets referenced by `requiredFix`.
 */
export function findingDerivedPaths(finding: ReviewFinding): string[] {
  const paths: string[] = []
  const push = (raw: string): void => {
    const normalized = normalizeWorkspacePath(raw.replace(REPAIR_SCOPE_LINE_SUFFIX, ''))
    if (normalized === undefined || paths.includes(normalized)) return
    paths.push(normalized)
  }
  if (nonemptyString(finding.file)) push(finding.file)
  for (const match of finding.requiredFix.matchAll(REPAIR_SCOPE_PATH_PATTERN)) push(match[0])
  return paths
}

/**
 * Findings whose every cited path is default-excluded. They cannot become an
 * honest repair contract (see {@link repairScopeFromFindings}), so they are
 * surfaced to the captain instead of silently disappearing or dead-locking a
 * member. A finding that names no path at all is NOT excluded: it simply falls
 * back to the judged task's own scope, exactly as before.
 */
export function excludedFindingsOf(
  findings: readonly ReviewFinding[],
  pathExists?: (path: string) => boolean,
): ReviewFinding[] {
  return findings.filter((finding) => {
    const paths = findingDerivedPaths(finding)
    if (paths.length === 0) return false
    const own = normalizeWorkspacePath(finding.file ?? '')
    return paths.every((path) => {
      if (isDefaultExcludedPath(path)) return true
      // A path extracted from prose that does not exist is not something the
      // workspace can act on (real run: "console/stream write" became a
      // repair scope while the finding's actual target was excluded). The
      // finding's own `file` always counts, so "create this new file" stays
      // actionable.
      if (pathExists === undefined || path === own) return false
      return !pathExists(path)
    })
  })
}

/** Captain-only amendment payload: replacement values for contract fields. */
export interface ContractAmendmentInput {
  objective?: string
  acceptance?: string[]
  verify?: string[]
  inScope?: string[]
  outOfScope?: string[]
}

export interface AmendTaskContractResult {
  ok: boolean
  error?: string
  task?: TeamTask
  revision?: TaskRevision
}

const AMENDABLE_CONTRACT_FIELDS = ['objective', 'acceptance', 'verify', 'inScope', 'outOfScope'] as const

/**
 * Controlled contract amendment (the pure rule; tooling keeps it
 * captain-only). When a quality contract is wrong — a verify command that
 * cannot pass, an inScope that forbids the file the objective names — the
 * worker has no honest completion and either dead-locks or games the gate.
 * Instead the captain may fix the contract mid-flight: every amendment is
 * recorded on the task as a {@link TaskRevision} (previous values + reason),
 * and once a review/requirements task has passed judgment on this task the
 * contract is frozen. Amendments replace whole fields (lists are full
 * replacements, not deltas); the implementer re-reads the amended contract
 * before its next quality gate. Completion gates need no special casing:
 * they read the task's current fields, so they naturally evaluate the
 * amended contract.
 */
export function amendTaskContract(
  team: TeamState,
  task: TeamTask,
  input: ContractAmendmentInput,
  by: string,
  reason: string,
): AmendTaskContractResult {
  if (!nonemptyString(by)) return { ok: false, error: 'contract amendment requires a non-empty author identity' }
  if (!nonemptyString(reason)) return { ok: false, error: 'contract amendment requires a non-empty reason' }
  if (TERMINAL_TASK_STATUSES.includes(task.status)) {
    return { ok: false, error: `task ${task.id} is ${task.status}; terminal contracts are immutable` }
  }
  if (taskKindOf(task) === 'work') {
    return { ok: false, error: `task ${task.id} has kind=work and no contract to amend` }
  }
  if (!AMENDABLE_CONTRACT_FIELDS.some((field) => input[field] !== undefined)) {
    return { ok: false, error: `amendment requires at least one of: ${AMENDABLE_CONTRACT_FIELDS.join(', ')}` }
  }
  const next: Record<string, unknown> = {}
  const previous: Record<string, unknown> = {}
  if (input.objective !== undefined) {
    if (!nonemptyString(input.objective)) {
      return { ok: false, error: 'amended objective must be a non-empty string' }
    }
    next['objective'] = input.objective
    previous['objective'] = task.objective
  }
  for (const field of ['acceptance', 'verify'] as const) {
    const value = input[field]
    if (value === undefined) continue
    if (!nonemptyStringList(value)) {
      return { ok: false, error: `amended ${field} must be a non-empty list of non-empty strings` }
    }
    next[field] = value
    previous[field] = task[field]
  }
  for (const field of ['inScope', 'outOfScope'] as const) {
    const value = input[field]
    if (value === undefined) continue
    if (!nonemptyStringList(value)) {
      return { ok: false, error: `amended ${field} must be a non-empty list of non-empty strings` }
    }
    for (const entry of value) {
      if (normalizeWorkspacePath(entry) === undefined) {
        return {
          ok: false,
          error: `amended ${field} entry "${entry}" is not a workspace-relative path (absolute paths and ".." can never match scope patterns)`,
        }
      }
    }
    next[field] = value
    previous[field] = task[field]
  }
  const reviewPassed = team.tasks.some((item) => (
    (taskKindOf(item) === 'review' || taskKindOf(item) === 'requirements')
    && item.reviewedTaskId === task.id
    && item.verdict === 'pass'
  ))
  if (reviewPassed) {
    return { ok: false, error: `task ${task.id} already passed review; its contract is frozen` }
  }
  const revision: TaskRevision = {
    at: Date.now(),
    by,
    reason,
    fields: Object.keys(next),
    previous,
  }
  return {
    ok: true,
    revision,
    task: {
      ...task,
      ...next,
      revisions: [...(task.revisions ?? []), revision],
      updatedAt: Date.now(),
    } as TeamTask,
  }
}


const CAPTAIN_ASSIGNEE = 'captain'
const OPEN_FOLLOW_UP_STATUSES: readonly TaskStatus[] = ['pending', 'claimed', 'in_progress']

function schedulableAssignee(preferred: string | undefined, team: TeamState, forbidden?: string): string | undefined {
  if (preferred !== undefined && preferred !== CAPTAIN_ASSIGNEE && preferred !== forbidden) {
    const live = team.members.find((member) => member.name === preferred && member.status !== 'removed')
    if (live !== undefined) return live.name
  }
  return team.members.find((member) => (
    member.status !== 'removed'
    && member.name !== CAPTAIN_ASSIGNEE
    && member.name !== forbidden
  ))?.name
}

function countRepairAttempts(team: TeamState, sourceTaskId: string, findingIds: readonly string[]): number {
  const key = findingKey(findingIds)
  return team.tasks.filter((item) => (
    taskKindOf(item) === 'repair'
    && item.sourceTaskId === sourceTaskId
    && findingKey(item.sourceFindingIds ?? []) === key
  )).length
}

function hasOpenFollowUp(team: TeamState, sourceTaskId: string, findingIds: readonly string[]): boolean {
  const key = findingKey(findingIds)
  return team.tasks.some((item) => (
    taskKindOf(item) === 'repair'
    && item.sourceTaskId === sourceTaskId
    && findingKey(item.sourceFindingIds ?? []) === key
    && OPEN_FOLLOW_UP_STATUSES.includes(item.status)
  ))
}

/** Drop previous-round exclusions that intersect this generated repair's scope. */
function withoutScopeConflicts(
  outOfScope: readonly string[] | undefined,
  inScope: readonly string[] | undefined,
): string[] | undefined {
  if (outOfScope === undefined) return undefined
  const conflicting = new Set(inScopeOverlap(outOfScope, inScope ?? []))
  return outOfScope.filter((pattern) => !conflicting.has(pattern))
}

/**
 * Line anchors (`file.ts:42`, `deliver.go:503-505`) cannot survive an edit
 * anywhere above them, so generated text never asserts one. Callers locate the
 * cited code by content anchor instead. Fully anchored numbers (`12:30`, a
 * version, a URL port) are left alone.
 */
const LINE_ANCHOR_PATTERN = /(?<!\/\/)(?<=[A-Za-z_./\\-][A-Za-z0-9_./\\-]*):\d+(?:-\d+)?\b/gu

/** Remove drifting line anchors from generated contract text. */
export function stripLineAnchors(text: string): string {
  return text.replaceAll(LINE_ANCHOR_PATTERN, '')
}

/**
 * Acceptance items derived from a failed verification: the concrete failures
 * the member must resolve. A verification carries no review findings, so the
 * generator uses the evidence the task itself recorded.
 */
function verificationFailureAcceptance(closed: TeamTask): string[] {
  const items: string[] = []
  for (const result of closed.acceptanceResults ?? []) {
    if (result.status === 'failed') items.push(`Satisfy the failed acceptance item recorded by ${closed.id}: ${stripLineAnchors(result.criterion)}`)
  }
  for (const command of closed.commandsRun ?? []) {
    if (command.status !== 'failed') continue
    items.push(`Make \`${command.command}\` pass (it failed${command.exitCode === undefined ? '' : ` with exit code ${command.exitCode}`})`)
  }
  if (items.length === 0) {
    items.push(`Resolve what failed in ${closed.id}${closed.output === undefined ? '' : `: ${closed.output.slice(0, 200)}`}`)
  }
  return items
}

/**
 * What the generator tells the member about a work order it derived from
 * someone else's findings. The plugin cannot verify a finding's claims (a
 * target count, a symbol that still exists, an action the product supports),
 * and says so instead of lending them authority.
 */
function generatedRepairDescription(
  closed: TeamTask,
  excluded: readonly ReviewFinding[],
): string {
  const lines = [
    `Auto-generated repair round derived from the findings of ${closed.id} (${taskKindOf(closed)}).`,
    'The plugin did not verify the finding text: line numbers were removed because an edit anywhere above them invalidates them, and claims such as a target count, a symbol that still exists, or an action the product supports are the reporter\'s, not confirmed facts. Locate the cited code by content anchor (symbol, string, call site) and check every acceptance item against the current workspace before editing; if an item is already satisfied or impossible as written, report that instead of forcing a change.',
  ]
  if (excluded.length > 0) {
    lines.push(`Excluded from this contract on purpose: ${excluded.map((finding) => finding.file ?? finding.id).join(', ')} — the completion gate refuses those paths by default, so they need a human decision rather than a member edit.`)
  }
  return lines.join(' ')
}

export interface PlanQualityFollowUpOptions {
  /**
   * Whether a derived path exists in the workspace. Used only to classify a
   * finding as excluded-only; without it every derived path counts.
   */
  pathExists?: (path: string) => boolean
}

export function planQualityFollowUp(
  team: TeamState,
  closed: TeamTask,
  options: PlanQualityFollowUpOptions = {},
): PlanQualityFollowUpResult {
  const empty = { created: [] as PlannedFollowUpTask[], tasks: [] as PlannedFollowUpTask[] }
  const escalate = (reason: string): PlanQualityFollowUpResult => ({ ...empty, escalated: true, status: 'escalated', reason })
  const kind = taskKindOf(closed)
  if (closed.status !== 'failed') return empty
  if (kind === 'review' || kind === 'requirements') {
    if (closed.verdict === 'reject') return escalate(`${closed.id} returned verdict=reject; automatic repair is not a substitute for a human decision`)
    if (closed.verdict !== 'needs_revision') return empty
  } else if (kind !== 'verification') {
    // Both quality gates share the findings → repair → re-check contract, so
    // a failed verification self-heals exactly like a failed review (#175B).
    return empty
  }

  const policy = resolveReviewPolicy(team.reviewPolicy)
  const currentRound = closed.round ?? 1
  const nextRound = currentRound + 1
  const maxRounds = kind === 'requirements' ? policy.requirementsMaxRounds : policy.codeMaxRounds
  if (nextRound > maxRounds) return escalate(`${closed.id} reached the ${kind} round ceiling (${maxRounds}); the loop cannot open round ${nextRound}`)

  if (kind === 'requirements') {
    const next: PlannedFollowUpTask = {
      kind: 'requirements',
      subject: `requirements-round-${nextRound}`,
      assignee: closed.assignee,
      dependencies: [],
      round: nextRound,
      objective: sanitizeReviewObjective(closed.objective, 'Converge remaining open questions'),
      acceptance: sanitizeReviewAcceptance(unresolvedFindings(closed).map((finding) => finding.requiredFix)),
    }
    return { created: [next], tasks: [next] }
  }

  const target = reviewedTargetOf(team, closed)
  const sourceId = closed.reviewedTaskId ?? closed.sourceTaskId ?? target?.id
  if (sourceId === undefined) return empty
  const source = team.tasks.find((item) => item.id === sourceId)
  const findings = unresolvedFindings(closed)
  const excluded = excludedFindingsOf(findings, options.pathExists)
  const actionable = findings.filter((finding) => !excluded.includes(finding))
  if (findings.length > 0 && actionable.length === 0) {
    return {
      ...empty,
      escalated: true,
      status: 'escalated',
      reason: `every finding of ${closed.id} cites only default-excluded paths (${excluded.map((finding) => finding.file ?? finding.id).join(', ')}); the completion gate classifies those out_of_scope, so no honest repair contract exists — a human must decide`,
      excludedFindings: excluded.map((finding) => finding.id),
    }
  }
  const findingIds = actionable.map((finding) => finding.id)
  if (hasOpenFollowUp(team, sourceId, findingIds)) return empty
  if (countRepairAttempts(team, sourceId, findingIds) >= policy.maxRepairAttempts) {
    return escalate(`${sourceId} already used ${policy.maxRepairAttempts} automatic repair attempts for these findings`)
  }

  // inScope is derived from the actionable findings below: the observed file
  // plus any workspace-relative paths referenced by the requiredFix
  // instructions, minus everything the completion gate refuses by default.
  const repairScope = repairScopeFromFindings(actionable, source?.inScope)
  const verifyCommands = source?.verify ?? closed.verify
  const implementer = schedulableAssignee(source?.assignee, team)
  // The causal edge to the failed gate is recorded explicitly: it cannot be a
  // `dependencies` entry, because a failed task never reaches `completed` and
  // `unsatisfiedDependencies` would then make this repair unclaimable forever.
  const repairDependencies = [sourceId]
  const repair: PlannedFollowUpTask = {
    id: `repair-round-${nextRound}`,
    kind: 'repair',
    subject: `repair-round-${nextRound}`,
    description: generatedRepairDescription(closed, excluded),
    assignee: implementer,
    dependencies: repairDependencies,
    round: nextRound,
    objective: source?.objective ?? closed.objective ?? `Fix findings from ${sourceId}`,
    inScope: repairScope,
    outOfScope: withoutScopeConflicts(source?.outOfScope, repairScope),
    verify: verifyCommands,
    acceptance: actionable.length > 0
      ? actionable.map((finding) => stripLineAnchors(finding.requiredFix))
      : verificationFailureAcceptance(closed),
    sourceTaskId: sourceId,
    sourceFindingIds: findingIds,
    findingSourceTaskIds: [closed.id],
    contractPaths: repairScope,
  }
  const checker = schedulableAssignee(
    closed.assignee !== implementer ? closed.assignee : undefined,
    team,
    implementer,
  )
  const recheck: PlannedFollowUpTask = kind === 'verification'
    ? {
      id: `verification-round-${nextRound}`,
      kind: 'verification',
      subject: `verification-round-${nextRound}`,
      assignee: checker,
      dependencies: [repair.id ?? `repair-round-${nextRound}`],
      round: nextRound,
      objective: closed.objective ?? `Re-verify ${sourceId} after ${repair.id ?? `repair-round-${nextRound}`}`,
      acceptance: sanitizeReviewAcceptance(closed.acceptance),
      verify: verifyCommands,
    }
    : {
      id: `review-round-${nextRound}`,
      kind: 'review',
      subject: `review-round-${nextRound}`,
      assignee: checker,
      dependencies: [repair.id ?? `repair-round-${nextRound}`],
      round: nextRound,
      objective: sanitizeReviewObjective(closed.objective, DEFAULT_REVIEW_OBJECTIVE),
      acceptance: sanitizeReviewAcceptance(closed.acceptance),
      reviewedTaskId: repair.id,
    }
  const result: PlanQualityFollowUpResult = { created: [repair, recheck], tasks: [repair, recheck] }
  if (excluded.length > 0) result.excludedFindings = excluded.map((finding) => finding.id)
  return result
}

export function buildCoverageMatrix(goalItems: readonly string[], tasks: readonly TeamTask[]): CoverageRow[] {
  return goalItems.map((goalItem) => {
    const covering = tasks.filter((item) => item.coverageOf?.includes(goalItem))
    const taskIds = covering.map((item) => item.id)
    if (covering.length === 0) return { goal_item: goalItem, task_ids: taskIds, status: 'missing' }
    if (covering.some((item) => item.status === 'failed' || item.status === 'cancelled')) {
      return { goal_item: goalItem, task_ids: taskIds, status: 'blocked' }
    }
    if (covering.every((item) => item.status === 'completed')) {
      return { goal_item: goalItem, task_ids: taskIds, status: 'passed' }
    }
    return { goal_item: goalItem, task_ids: taskIds, status: 'in_progress' }
  })
}

/* ------------------------------------------------------------------------ *
 * Content-bound verdicts (issue #161) and generated work orders (issue #174) *
 * ------------------------------------------------------------------------ */

const VERDICT_KINDS: readonly TaskKind[] = ['review', 'requirements', 'verification']

/** Kinds whose completion is a verdict about a revision. */
export function isVerdictKind(kind: TaskKind | undefined): boolean {
  return kind !== undefined && (VERDICT_KINDS as readonly string[]).includes(kind)
}

function shortDigest(value: string | undefined): string {
  return value === undefined || value === '' ? 'absent' : value.slice(0, 8)
}

/**
 * Compare recorded bytes against the bytes on disk now. Every returned entry
 * is a reason a verdict or a work order no longer describes the workspace.
 * "Cannot be read" is reported as its own reason: a permission error is not a
 * match, and a partial read is not proof of an unchanged file.
 */
/** One reason an artifact set no longer describes the workspace. */
export interface ArtifactDriftDetail {
  /** The implicated path, when the reason is about one concrete file. */
  path?: string
  message: string
}

/**
 * Compare recorded bytes against the bytes on disk now, keeping the path each
 * reason belongs to. "Cannot be read" is reported as its own reason: a
 * permission error is not a match, and a partial read is not proof of an
 * unchanged file.
 */
export function artifactDriftDetails(
  recorded: readonly ArtifactDigest[] | undefined,
  current: readonly ArtifactDigest[] | undefined,
): ArtifactDriftDetail[] {
  if (recorded === undefined || recorded.length === 0 || current === undefined) return []
  const now = new Map(current.map((item) => [item.path, item]))
  const drift: ArtifactDriftDetail[] = []
  for (const before of recorded) {
    const after = now.get(before.path)
    if (after === undefined) {
      drift.push({ path: before.path, message: `${before.path} was not in the current workspace snapshot` })
      continue
    }
    if (after.unreadable === true) {
      drift.push({ path: after.path, message: `${after.path} cannot be read now (${after.reason ?? 'unknown error'}), so its recorded bytes cannot be confirmed` })
      continue
    }
    if (before.unreadable === true) {
      drift.push({ path: before.path, message: `${before.path} was not readable when this evidence was recorded (${before.reason ?? 'unknown error'}), so it never covered those bytes` })
      continue
    }
    if (before.present !== after.present) {
      drift.push({
        path: before.path,
        message: after.present
          ? `${before.path} was absent when recorded and now exists`
          : `${before.path} was deleted after it was recorded`,
      })
      continue
    }
    if (before.present && after.present && before.sha256 !== after.sha256) {
      drift.push({ path: before.path, message: `${before.path} changed (sha256 ${shortDigest(before.sha256)} -> ${shortDigest(after.sha256)})` })
    }
  }
  return drift
}

/** Message-only view of {@link artifactDriftDetails}. */
export function artifactDrift(
  recorded: readonly ArtifactDigest[] | undefined,
  current: readonly ArtifactDigest[] | undefined,
): string[] {
  return artifactDriftDetails(recorded, current).map((detail) => detail.message)
}

/** A partially enumerated scope is incomplete evidence, never a silent pass. */
export function gapDrift(gaps: readonly ArtifactScopeGap[] | undefined): string[] {
  return (gaps ?? []).map((gap) => `${gap.pattern}: ${gap.reason}`)
}

/**
 * The task a verdict is about: an explicit `reviewedTaskId`/`sourceTaskId`
 * first, otherwise the implementation/repair this gate depends on.
 */
export function reviewedTargetOf(team: TeamState, task: TeamTask): TeamTask | undefined {
  const explicit = task.reviewedTaskId ?? task.sourceTaskId
  if (explicit !== undefined) {
    const found = team.tasks.find((item) => item.id === explicit)
    if (found !== undefined) return found
  }
  for (const dependency of task.dependencies) {
    const candidate = team.tasks.find((item) => item.id === dependency)
    if (candidate !== undefined && (taskKindOf(candidate) === 'implementation' || taskKindOf(candidate) === 'repair')) {
      return candidate
    }
  }
  return undefined
}

/**
 * Bind a closing verdict to the revision it judged: the target's execution
 * generation plus the bytes of the paths it changed. Without this a `pass` is
 * only a task record, and delivery cannot tell that the reviewed bytes were
 * edited or deleted afterwards. `gaps` carries the parts of the reviewed scope
 * that could not be enumerated, `scope` the patterns it bound, and
 * `duringDrift` any change observed between claim and close — partial or
 * moving coverage is never read as complete.
 */
export interface ReviewBinding {
  artifacts: readonly ArtifactDigest[]
  gaps?: readonly ArtifactScopeGap[]
  scope?: readonly string[]
  duringDrift?: readonly string[]
}

export function bindReviewToRevision(team: TeamState, task: TeamTask, binding: ReviewBinding): TeamTask {
  const target = reviewedTargetOf(team, task)
  if (target === undefined || binding.artifacts.length === 0) return task
  const kind = taskKindOf(task)
  return {
    ...task,
    ...kind === 'review' || kind === 'requirements' ? { reviewedTaskId: task.reviewedTaskId ?? target.id } : {},
    reviewedAttempt: target.attempt ?? 0,
    reviewedArtifacts: binding.artifacts.map((item) => ({ ...item })),
    ...binding.gaps === undefined || binding.gaps.length === 0 ? {} : { reviewedGaps: binding.gaps.map((gap) => ({ ...gap })) },
    ...binding.scope === undefined || binding.scope.length === 0 ? {} : { reviewedScope: [...binding.scope] },
    ...binding.duringDrift === undefined || binding.duringDrift.length === 0 ? {} : { reviewedDuringDrift: [...binding.duringDrift] },
  }
}

/**
 * Scope a verdict must bind: the paths the judged task changed, otherwise the
 * scope patterns of its contract (expanded by the caller).
 */
export function verdictScopePatterns(team: TeamState, task: TeamTask): string[] {
  const lineage = verdictLineageTasks(team, task)
  // Every implementation/repair this gate transitively judges: the original
  // source AND the repairs that followed it. A pre-planned review whose edge
  // was rewired to a re-verification must still bind the bytes the original
  // source changed, otherwise a later edit to the repair's target would have
  // no valid review evidence at all (#161 x #175).
  const changed = new Set<string>()
  for (const item of lineage) {
    const kind = taskKindOf(item)
    if (kind !== 'implementation' && kind !== 'repair') continue
    for (const path of item.changedPaths ?? []) {
      const normalized = normalizeWorkspacePath(path)
      if (normalized !== undefined) changed.add(normalized)
    }
  }
  if (changed.size > 0) return [...changed]
  const scope = new Set<string>([
    ...(task.inScope ?? []),
    ...lineage.flatMap((item) => item.inScope ?? []),
  ])
  if (scope.size > 0) return [...scope]
  return (reviewedTargetOf(team, task)?.deliverables ?? [])
    .map((path) => normalizeWorkspacePath(path))
    .filter((path): path is string => path !== undefined)
}

/**
 * The artifacts a gate transitively judges: follow explicit review/source
 * links and dependency edges (a repair records the source it fixes, a
 * verification depends on the repair, a review depends on the verification).
 */
function verdictLineageTasks(team: TeamState, task: TeamTask): TeamTask[] {
  const byId = new Map(team.tasks.map((item) => [item.id, item]))
  const visited = new Set<string>()
  const queue = [...task.dependencies]
  const explicit = task.reviewedTaskId ?? task.sourceTaskId
  if (explicit !== undefined) queue.push(explicit)
  const target = reviewedTargetOf(team, task)
  if (target !== undefined && target.id !== task.id) queue.push(target.id)
  const found: TeamTask[] = []
  while (queue.length > 0) {
    const id = queue.shift() as string
    if (visited.has(id)) continue
    visited.add(id)
    const item = byId.get(id)
    if (item === undefined) continue
    found.push(item)
    queue.push(...item.dependencies)
    const link = item.reviewedTaskId ?? item.sourceTaskId
    if (link !== undefined) queue.push(link)
  }
  return found
}

/** Scope patterns recorded verdicts bound, for new-file detection. */
export function deliveryScopePatterns(team: TeamState): string[] {
  const patterns = new Set<string>()
  for (const task of team.tasks) {
    const kind = taskKindOf(task)
    if (!(VERDICT_KINDS as readonly string[]).includes(kind) || task.status !== 'completed') continue
    for (const pattern of task.reviewedScope ?? []) patterns.add(pattern)
  }
  return [...patterns]
}

function isDirectoryPattern(pattern: string): boolean {
  const trimmed = pattern.trim()
  return trimmed.endsWith('/') || trimmed === '.' || trimmed === './'
}

/** Root of the artifact lineage a gate judges (the implementation/repair chain). */
function lineageRoot(team: TeamState, task: TeamTask): string | undefined {
  let current = task
  const visited = new Set<string>()
  while (!visited.has(current.id)) {
    visited.add(current.id)
    const nextId = current.reviewedTaskId ?? current.sourceTaskId ?? current.dependencies[0]
    const next = nextId === undefined ? undefined : team.tasks.find((item) => item.id === nextId)
    if (next === undefined) break
    current = next
  }
  if (current.id === task.id) {
    const kind = taskKindOf(task)
    return kind === 'implementation' || kind === 'repair' ? task.id : undefined
  }
  return current.id
}

const VERDICT_WEIGHT: Readonly<Record<string, number>> = { verification: 1, review: 2, requirements: 2 }

/**
 * Does `candidate` cover `prior`'s evidence? A later sound verdict that either
 * depends on the prior gate or judges the same artifact lineage supersedes it,
 * so a legitimately changed revision does not block delivery forever behind an
 * old snapshot.
 */
function supersedes(team: TeamState, candidate: TeamTask, prior: TeamTask): boolean {
  if (candidate.id === prior.id || candidate.status !== 'completed') return false
  if ((VERDICT_WEIGHT[taskKindOf(candidate)] ?? 0) < (VERDICT_WEIGHT[taskKindOf(prior)] ?? 0)) return false
  if (candidate.createdAt < prior.createdAt) return false
  if (candidate.createdAt === prior.createdAt && (candidate.round ?? 0) <= (prior.round ?? 0)) return false
  if (dependencyClosureContains(team.tasks, candidate.dependencies, prior.id)) return true
  const candidateRoot = lineageRoot(team, candidate)
  return candidateRoot !== undefined && candidateRoot === lineageRoot(team, prior)
}

/** Paths whose current bytes decide whether recorded verdicts and orders hold. */
export function deliveryArtifactPaths(team: TeamState): string[] {
  const paths = new Set<string>()
  for (const task of team.tasks) {
    for (const artifact of task.reviewedArtifacts ?? []) paths.add(artifact.path)
    for (const artifact of task.contractSnapshot?.artifacts ?? []) paths.add(artifact.path)
  }
  // Legacy verdicts carry no digests; the changed paths of the task they
  // judged still let the delivery check detect a later edit by mtime.
  for (const task of team.tasks) {
    const kind = taskKindOf(task)
    if (!(VERDICT_KINDS as readonly string[]).includes(kind)) continue
    if (task.status !== 'completed') continue
    if ((task.reviewedArtifacts?.length ?? 0) > 0) continue
    for (const changed of reviewedTargetOf(team, task)?.changedPaths ?? []) {
      const normalized = normalizeWorkspacePath(changed)
      if (normalized !== undefined) paths.add(normalized)
    }
  }
  return [...paths]
}

/**
 * File mtimes carry sub-millisecond precision while task stamps are whole
 * milliseconds, so a file written in the same millisecond as the verdict would
 * otherwise read as "modified after". Only a clearly later write counts;
 * content digests are exact and need no tolerance.
 */
const MTIME_TOLERANCE_MS = 1

function verdictDrift(team: TeamState, item: TeamTask, audit: DeliveryAudit): ArtifactDriftDetail[] {
  const issues: ArtifactDriftDetail[] = []
  const target = reviewedTargetOf(team, item)
  if (target !== undefined && item.reviewedAttempt !== undefined && (target.attempt ?? 0) !== item.reviewedAttempt) {
    issues.push({ message: `${target.id} was re-attempted after this verdict (attempt ${item.reviewedAttempt} -> ${target.attempt ?? 0})` })
  }
  for (const gap of gapDrift(item.reviewedGaps)) issues.push({ message: gap })
  for (const drift of item.reviewedDuringDrift ?? []) {
    issues.push({ message: `the workspace changed while this verdict was being formed (${drift}), so it does not bind a stable revision` })
  }
  const recorded = item.reviewedArtifacts
  // A file that appeared under a bound directory scope after the verdict was
  // never reviewed: a broad scope must not quietly absorb new work.
  const recordedPaths = new Set((recorded ?? []).map((artifact) => artifact.path))
  for (const pattern of item.reviewedScope ?? []) {
    if (!isDirectoryPattern(pattern)) continue
    for (const entry of audit.expandedScope ?? []) {
      if (entry.present !== true || recordedPaths.has(entry.path)) continue
      if (!pathMatchesScope(entry.path, pattern)) continue
      issues.push({ path: entry.path, message: `${entry.path} appeared under the reviewed scope ${pattern} after the verdict and was never reviewed` })
    }
  }
  if (recorded !== undefined && recorded.length > 0) {
    issues.push(...artifactDriftDetails(recorded, audit.artifacts))
    return issues
  }
  // A record written before content-bound verdicts existed carries no digests,
  // but the revision it judged is still identifiable: the bytes the target
  // claimed to change cannot have been written after the verdict closed.
  for (const changed of target?.changedPaths ?? []) {
    const normalized = normalizeWorkspacePath(changed)
    if (normalized === undefined) continue
    const current = audit.artifacts?.find((artifact) => artifact.path === normalized)
    if (current === undefined) continue
    if (current.unreadable === true) {
      issues.push({ path: normalized, message: `${normalized} cannot be read now (${current.reason ?? 'unknown error'}), so the verdict cannot be confirmed` })
      continue
    }
    if (current.present === true && current.mtimeMs !== undefined && current.mtimeMs > item.updatedAt + MTIME_TOLERANCE_MS) {
      issues.push({ path: normalized, message: `${normalized} was modified after this verdict closed (file mtime is later than the verdict)` })
      continue
    }
    if (current.present !== true) {
      // No digest was recorded, so the plugin cannot date the disappearance:
      // the file the implementation changed is gone and the verdict cannot be
      // confirmed against it. A later sound verdict supersedes this one.
      issues.push({ path: normalized, message: `${normalized} is recorded as changed by ${target?.id ?? 'the judged task'} but no longer exists, and no digest was recorded to confirm the verdict` })
    }
  }
  return issues
}

/** A verdict whose evidence is absent altogether cannot be audited at all. */
function unboundVerdict(item: TeamTask): boolean {
  return (item.reviewedArtifacts?.length ?? 0) === 0
    && (item.reviewedGaps?.length ?? 0) === 0
    && item.reviewedAttempt === undefined
}

/**
 * Every completed verdict that claims to cover the current revision but no
 * longer does.
 *
 * A drifted review/requirements pass is the delivery evidence itself, so it
 * blocks — unless a later sound verdict covers the same lineage, which is the
 * normal shape of `pass → repair → new pass` and must converge instead of
 * blocking forever behind an old snapshot. A drifted `verification` is only a
 * warning: a later repair legitimately supersedes it, but never silently.
 * A verdict that predates content binding is reported as an unauditable gap
 * rather than being read as a pass over the current bytes.
 */
/** One audited verdict observation, attributed to the task that carries it. */
export interface VerdictAuditNote {
  taskId: string
  /**
   * `blocker` when this pass is the delivery evidence itself, `warning` when a
   * later sound verdict supersedes it or when it is an intermediate gate.
   */
  level: 'blocker' | 'warning'
  message: string
}

/**
 * Audit every completed verdict against the current revision (issue #161).
 *
 * A drifted review/requirements pass is the delivery evidence itself, so it
 * blocks — unless a later sound verdict covers the same lineage, which is the
 * normal shape of `pass → repair → new pass` and must converge instead of
 * blocking forever behind an old snapshot. A drifted `verification` or a
 * superseded pass is reported as a warning: a later repair legitimately
 * supersedes it, but never silently. A verdict that predates content binding
 * is reported as an unauditable gap rather than being read as a pass over the
 * current bytes.
 */
export function verdictAuditNotes(team: TeamState, audit: DeliveryAudit = {}): VerdictAuditNote[] {
  const notes: VerdictAuditNote[] = []
  const verdicts = team.tasks.filter((item) => {
    const kind = taskKindOf(item)
    if (!(VERDICT_KINDS as readonly string[]).includes(kind)) return false
    if (item.status !== 'completed') return false
    return !((kind === 'review' || kind === 'requirements') && item.verdict !== 'pass')
  })
  const issues = new Map<string, ArtifactDriftDetail[]>()
  for (const item of verdicts) {
    const found = verdictDrift(team, item, audit)
    if (found.length > 0) issues.set(item.id, found)
  }
  // Only a verdict that actually recorded the bytes it judged, over a complete
  // scope, and that still matches the workspace may supersede an older one. An
  // unbound (pre-fix) pass records no identity at all: it cannot "bind the
  // current bytes" and must never clear another verdict's drift.
  const sound = verdicts.filter((item) => !issues.has(item.id) && bindsRecordedRevision(team, item, audit))
  for (const item of verdicts) {
    const kind = taskKindOf(item)
    const found = issues.get(item.id)
    if (found === undefined) {
      if (unboundVerdict(item) && audit.artifacts !== undefined) {
        notes.push({
          taskId: item.id,
          level: 'warning',
          message: `${item.id} (${kind}) predates content-bound verdicts and recorded no artifact identity; delivery cannot confirm the current bytes are the revision it judged — re-review to bind them`,
        })
      }
      continue
    }
    const detail = `${item.id} (${kind}) verdict covers a revision that no longer exists: ${found.map((entry) => entry.message).join('; ')}`
    // Superseding needs the same lineage AND coverage of every drifted path or
    // gap: a narrower new review over path A must not clear an unreviewed
    // change to path B.
    const covering = sound.find((candidate) => (
      supersedes(team, candidate, item) && coversDrift(team, candidate, item, found)
    ))
    if (covering !== undefined) {
      notes.push({ taskId: item.id, level: 'warning', message: `${detail} — superseded by ${covering.id}, which binds the current bytes` })
      continue
    }
    // A drifted gate without a sound covering verdict leaves the current bytes
    // with no valid evidence, whether it is a review or a verification: the
    // only difference is what the captain has to do next.
    if (kind === 'verification') {
      notes.push({ taskId: item.id, level: 'blocker', message: `${detail} — re-verify the current bytes; no later sound verdict bound them` })
      continue
    }
    notes.push({ taskId: item.id, level: 'blocker', message: `${detail} — re-review the current bytes; do not report this revision as verified` })
  }
  return notes
}

/**
 * Does this verdict hold a real, complete, still-matching record of the bytes
 * it judged? Attempt drift, an incomplete scope, or a workspace that moved
 * while the gate was open all disqualify it.
 */
function bindsRecordedRevision(team: TeamState, item: TeamTask, audit: DeliveryAudit): boolean {
  if ((item.reviewedArtifacts?.length ?? 0) === 0) return false
  if ((item.reviewedGaps?.length ?? 0) > 0) return false
  if ((item.reviewedDuringDrift?.length ?? 0) > 0) return false
  const target = reviewedTargetOf(team, item)
  if (target !== undefined && item.reviewedAttempt !== undefined && (target.attempt ?? 0) !== item.reviewedAttempt) return false
  if (audit.artifacts === undefined) return false
  return artifactDriftDetails(item.reviewedArtifacts, audit.artifacts).length === 0
}

/**
 * A later verdict clears an older one only when it covers what actually
 * drifted: every implicated path must be among the bytes it bound. Reasons
 * that name no path (an incomplete scope, a re-attempted target, a workspace
 * that moved mid-review) are cleared only by a sound verdict about the same
 * target's current attempt.
 */
function coversDrift(
  team: TeamState,
  candidate: TeamTask,
  prior: TeamTask,
  drifted: readonly ArtifactDriftDetail[],
): boolean {
  if (drifted.length === 0) return false
  const bound = new Set((candidate.reviewedArtifacts ?? []).map((artifact) => artifact.path))
  for (const issue of drifted) {
    if (issue.path !== undefined) {
      if (!bound.has(issue.path)) return false
      continue
    }
    const candidateTarget = reviewedTargetOf(team, candidate)
    const priorTarget = reviewedTargetOf(team, prior)
    if (candidateTarget === undefined || priorTarget === undefined || candidateTarget.id !== priorTarget.id) return false
    if (candidate.reviewedAttempt !== (candidateTarget.attempt ?? 0)) return false
    if (lineageRoot(team, candidate) === undefined || lineageRoot(team, candidate) !== lineageRoot(team, prior)) return false
  }
  return true
}

function verdictBindingIssues(team: TeamState, audit: DeliveryAudit): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = []
  const warnings: string[] = []
  for (const note of verdictAuditNotes(team, audit)) {
    if (note.level === 'blocker') blockers.push(note.message)
    else warnings.push(note.message)
  }
  return { blockers, warnings }
}

/** Staleness of one auto-generated work order against the current workspace. */
export function contractStaleness(task: TeamTask, current: readonly ArtifactDigest[] | undefined): string[] {
  const snapshot: ArtifactSnapshot | undefined = task.contractSnapshot
  if (snapshot === undefined) return []
  const stale: string[] = []
  for (const gap of gapDrift(snapshot.gaps)) {
    stale.push(`${task.id} work order recorded only partial coverage (${gap}), so a change outside it would not be visible`)
  }
  if (snapshot.artifacts.length === 0 || current === undefined) return stale
  stale.push(...artifactDrift(snapshot.artifacts, current).map((item) => `${task.id} work order was generated before: ${item}`))
  return stale
}

export interface WorkOrderWarning {
  taskId: string
  message: string
}

/**
 * Open auto-generated work orders whose cited bytes moved on (issue #174).
 * A repair round's acceptance/inScope is a snapshot of the workspace at
 * finding-generation time; every later round invalidates it, and nothing used
 * to say so — a member following it literally edits the wrong line or redoes
 * work that is already done.
 */
export function workOrderWarnings(team: TeamState, current: readonly ArtifactDigest[] | undefined): WorkOrderWarning[] {
  if (current === undefined) return []
  const warnings: WorkOrderWarning[] = []
  for (const task of team.tasks) {
    if (task.contractSnapshot === undefined) continue
    if (!OPEN_FOLLOW_UP_STATUSES.includes(task.status)) continue
    const stale = contractStaleness(task, current)
    if (stale.length === 0) continue
    warnings.push({
      taskId: task.id,
      message: `${stale.join('; ')}. Its auto-generated acceptance/inScope describe the workspace as it was then: locate the cited code by content anchor, and amend the contract if the target is gone.`,
    })
  }
  return warnings
}

/** Statuses in which a repair still counts as the follow-up of a failed gate. */
const FOLLOW_UP_VISIBLE_STATUSES: readonly TaskStatus[] = ['pending', 'claimed', 'in_progress', 'completed']

/**
 * Does a repair exist that addresses this failed gate's findings? The causal
 * link can be recorded three ways, and all of them count: the repair's
 * declared source, an explicit dependency edge on the failed gate, or the
 * finding ids the repair was opened for (issue #175A — the transcript edge
 * used to be invisible to the graph, so delivery reported
 * `failed without a follow-up repair` for loops that were already closed).
 */
function hasFollowUpRepair(team: TeamState, item: TeamTask): boolean {
  const kind = taskKindOf(item)
  if (kind === 'requirements') {
    return team.tasks.some((candidate) => (
      taskKindOf(candidate) === 'requirements' && (candidate.round ?? 1) > (item.round ?? 1)
    ))
  }
  const findingIds = new Set((item.findings ?? []).map((finding) => finding.id))
  const upstreams = new Set(
    [item.id, item.reviewedTaskId ?? item.sourceTaskId].filter((id): id is string => id !== undefined),
  )
  return team.tasks.some((candidate) => {
    if (taskKindOf(candidate) !== 'repair' || !FOLLOW_UP_VISIBLE_STATUSES.includes(candidate.status)) return false
    if (candidate.sourceTaskId !== undefined && upstreams.has(candidate.sourceTaskId)) return true
    if (candidate.dependencies.includes(item.id)) return true
    if (candidate.findingSourceTaskIds?.includes(item.id) === true) return true
    return candidate.sourceFindingIds !== undefined
      && candidate.sourceFindingIds.some((findingId) => findingIds.has(findingId))
  })
}

/** Failed gates with no follow-up at all: work that genuinely remains. */
function unresolvedGates(team: TeamState): TeamTask[] {
  return team.tasks.filter((item) => isQualityKind(taskKindOf(item))
    && item.status === 'failed'
    && !hasFollowUpRepair(team, item))
}

export function canDeclareDelivery(team: TeamState, audit: DeliveryAudit = {}): DeliveryResult {
  const blockers: string[] = []
  const warnings: string[] = []
  if (team.phase === 'staged') blockers.push('team plan is awaiting approval')
  if (team.halted === true) blockers.push('team is halted')
  if (team.escalated === true) blockers.push('team requires escalation resolution')
  if (team.tasks.length === 0) blockers.push('team has no completed work')
  for (const item of team.tasks.filter(item => !isQualityKind(taskKindOf(item)))) {
    if (item.status !== 'completed' && item.status !== 'cancelled') blockers.push(`${item.id} (${taskKindOf(item)}) is not completed`)
  }
  if (team.tasks.length > 0 && team.tasks.every(item => item.status === 'cancelled')) blockers.push('all work was cancelled')
  const quality = team.tasks.filter((item) => isQualityKind(taskKindOf(item)))
  const implementations = quality.filter((item) => taskKindOf(item) === 'implementation' || taskKindOf(item) === 'repair')
  const reviews = quality.filter((item) => taskKindOf(item) === 'review')

  for (const item of quality) {
    const kind = taskKindOf(item)
    if (item.status === 'completed') {
      if ((kind === 'review' || kind === 'requirements') && item.verdict !== 'pass') {
        blockers.push(`${item.id} completed without verdict=pass`)
      }
      continue
    }
    if (item.status === 'failed') {
      if (!hasFollowUpRepair(team, item)) blockers.push(`${item.id} failed without a follow-up repair`)
      continue
    }
    if (item.status === 'cancelled') continue
    blockers.push(`${item.id} (${kind}) is not completed`)
  }

  if (implementations.some((item) => item.status === 'completed') && !reviews.some((item) => item.status === 'completed' && item.verdict === 'pass')) {
    if (!blockers.some((item) => item.includes('review'))) {
      blockers.push('completed implementation has no passing review')
    }
  }

  for (const item of implementations) {
    for (const path of item.changedPaths ?? []) {
      if (classifyChangedPath(path, item.inScope ?? [], item.outOfScope ?? []) !== 'in_scope') {
        blockers.push(`${item.id} has unaudited path ${path}`)
      }
    }
  }

  const binding = verdictBindingIssues(team, audit)
  blockers.push(...binding.blockers)
  warnings.push(...binding.warnings)
  if (audit.artifacts !== undefined) {
    warnings.push(...workOrderWarnings(team, audit.artifacts).map((warning) => warning.message))
  }
  // An incomplete audit is not evidence: a scope that outgrew its cap, or a
  // path that cannot be read, must block instead of passing as a clean read.
  const auditGaps = audit.gaps ?? []
  if (auditGaps.length > 0 && (quality.length > 0 || blockers.length > 0 || audit.artifacts !== undefined)) {
    const shown = auditGaps.slice(0, 3).map((gap) => `${gap.pattern}: ${gap.reason}`)
    const more = auditGaps.length > shown.length ? ` (+${auditGaps.length - shown.length} more)` : ''
    blockers.push(`the current workspace audit is incomplete (${shown.join('; ')}${more}); no recorded verdict can be confirmed over partially enumerated or unreadable artifacts`)
  }

  return { ok: blockers.length === 0, blockers, warnings }
}

export function resumeTeamState(team: TeamState, reason: string): ResumeTeamResult {
  if (!nonemptyString(reason)) {
    return { ok: false, status: 'rejected', error: 'resume requires a non-empty reason' }
  }
  if (team.halted !== true) {
    return { ok: true, status: 'already_running', team }
  }
  return {
    ok: true,
    status: 'resumed',
    team: {
      ...team,
      halted: false,
      haltedAt: undefined,
    },
  }
}

/**
 * The durable `findings[].line` contract, shared by the write-side parser
 * (`parseFindings`) and the durable validator (`isReviewFinding`) so the two
 * cannot drift apart again (issue #188, #105 class).
 */
export function isValidFindingLine(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

export function isReviewFinding(value: unknown): value is ReviewFinding {
  if (!isRecord(value)) return false
  return nonemptyString(value['id'])
    && (FINDING_SEVERITIES as readonly string[]).includes(value['severity'] as string)
    && nonemptyString(value['problem'])
    && nonemptyString(value['requiredFix'])
    && (value['file'] === undefined || nonemptyString(value['file']))
    && (value['line'] === undefined || isValidFindingLine(value['line']))
    && (value['resolved'] === undefined || typeof value['resolved'] === 'boolean')
}

export function isAcceptanceResult(value: unknown): value is AcceptanceResult {
  if (!isRecord(value)) return false
  return nonemptyString(value['criterion'])
    && (value['status'] === 'passed' || value['status'] === 'failed')
    && (value['evidence'] === undefined || typeof value['evidence'] === 'string')
}

export function isCommandResult(value: unknown): value is CommandResult {
  if (!isRecord(value)) return false
  return nonemptyString(value['command'])
    && (value['status'] === 'passed' || value['status'] === 'failed')
    && (value['exitCode'] === undefined || (Number.isSafeInteger(value['exitCode'])))
    && (value['evidence'] === undefined || typeof value['evidence'] === 'string')
}

export function isTaskRevision(value: unknown): value is TaskRevision {
  if (!isRecord(value)) return false
  return Number.isSafeInteger(value['at'])
    && nonemptyString(value['by'])
    && nonemptyString(value['reason'])
    && nonemptyStringList(value['fields'])
    && isRecord(value['previous'])
}

export function isArtifactDigest(value: unknown): value is ArtifactDigest {
  if (!isRecord(value)) return false
  if (!nonemptyString(value['path']) || normalizeWorkspacePath(value['path'] as string) === undefined) return false
  if (typeof value['present'] !== 'boolean') return false
  if (value['sha256'] !== undefined && !(typeof value['sha256'] === 'string' && /^[0-9a-f]{64}$/u.test(value['sha256']))) return false
  if (value['size'] !== undefined && !(Number.isSafeInteger(value['size']) && (value['size'] as number) >= 0)) return false
  if (value['mtimeMs'] !== undefined && !(typeof value['mtimeMs'] === 'number' && Number.isFinite(value['mtimeMs']))) return false
  if (value['unreadable'] !== undefined && typeof value['unreadable'] !== 'boolean') return false
  if (value['reason'] !== undefined && !nonemptyString(value['reason'])) return false
  if (value['present'] === true && value['sha256'] === undefined) return false
  return true
}

export function isArtifactScopeGap(value: unknown): value is ArtifactScopeGap {
  return isRecord(value) && nonemptyString(value['pattern']) && nonemptyString(value['reason'])
}

export function isArtifactSnapshot(value: unknown): value is ArtifactSnapshot {
  if (!isRecord(value)) return false
  if (!Number.isSafeInteger(value['at']) || (value['at'] as number) < 0) return false
  if (!Array.isArray(value['artifacts']) || !value['artifacts'].every(isArtifactDigest)) return false
  return value['gaps'] === undefined
    || (Array.isArray(value['gaps']) && value['gaps'].length > 0 && value['gaps'].every(isArtifactScopeGap))
}// Optional fields whose persisted values must be non-empty when present
// (mirrors the checks in hasValidQualityTaskFields). Some models materialize
// optional tool parameters as "" instead of omitting them (e.g. GPT-5.6
// sending reviewedTaskId:"" or profile:""), which would otherwise be written
// to team.json and then brick the whole team state on reload.
const BLANK_SENSITIVE_STRING_FIELDS = ['objective', 'reviewedTaskId', 'sourceTaskId'] as const
const BLANK_SENSITIVE_STRING_LIST_FIELDS = [
  'inScope',
  'outOfScope',
  'acceptance',
  'verify',
  'deliverables',
  'nonGoals',
  'changedPaths',
  'sourceFindingIds',
  'coverageOf',
] as const

/**
 * Normalize blank optional task fields to omitted ("blank means absent").
 * Blank string scalars are deleted; string lists have blank entries filtered
 * out, and a list that only contained blanks is omitted entirely. Non-blank
 * values and every other field are passed through untouched, so durable-state
 * validation stays strict.
 */
export function normalizeBlankOptionalTaskFields<T extends object>(task: T): T {
  const next = { ...task } as Record<string, unknown>
  for (const key of BLANK_SENSITIVE_STRING_FIELDS) {
    const value = next[key]
    if (typeof value === 'string' && value.trim() === '') delete next[key]
  }
  for (const key of BLANK_SENSITIVE_STRING_LIST_FIELDS) {
    const value = next[key]
    if (!Array.isArray(value)) continue
    const kept = value.filter((item) => !(typeof item === 'string' && item.trim() === ''))
    if (kept.length === value.length) continue
    if (kept.length === 0) delete next[key]
    else next[key] = kept
  }
  return normalizeSentinelNumericTaskFields(next) as T
}

/**
 * Numeric task fields whose durable contract is a bounded range, paired with
 * their minimum (`Number.isSafeInteger` plus the lower bound). Some models
 * materialize "no value" as a numeric sentinel (`line: -1`, `round: 0`,
 * `reviewedAttempt: -1`) that the write side used to persist verbatim and the
 * durable validator then rejected — bricking the whole team on the next read
 * (issue #188, #105 class).
 */
const SENTINEL_NUMERIC_TASK_FIELDS = [
  ['round', 1],
  ['reviewedAttempt', 0],
  ['attempt', 0],
] as const satisfies readonly (readonly [string, number])[]

/**
 * Treat an out-of-contract **numeric** sentinel as absent, including
 * `findings[].line` (contract: `isValidFindingLine`).
 *
 * Only numbers are healed. A value of any other type (`round: "oops"`,
 * `attempt: {}`, `line: "12"`) is left exactly as written and stays a hard,
 * named validation failure, so genuine corruption is never silently swallowed
 * while `-1`-style sentinels — the #188 brick — self-heal. Field order, unknown
 * fields and every in-range value are preserved.
 */
export function normalizeSentinelNumericTaskFields<T extends object>(task: T): T {
  const next = { ...task } as Record<string, unknown>
  let changed = false
  for (const [key, minimum] of SENTINEL_NUMERIC_TASK_FIELDS) {
    const value = next[key]
    if (typeof value !== 'number') continue
    if (Number.isSafeInteger(value) && value >= minimum) continue
    delete next[key]
    changed = true
  }
  if (Array.isArray(next['findings'])) {
    let findingsChanged = false
    const findings = (next['findings'] as unknown[]).map((finding) => {
      if (!isRecord(finding)) return finding
      const line = finding['line']
      if (typeof line !== 'number' || isValidFindingLine(line)) return finding
      const cleaned = { ...finding }
      delete cleaned['line']
      findingsChanged = true
      return cleaned
    })
    if (findingsChanged) {
      next['findings'] = findings
      changed = true
    }
  }
  return (changed ? next : task) as T
}

export function hasValidQualityTaskFields(value: Record<string, unknown>): boolean {
  if (value['kind'] !== undefined && !(TASK_KINDS as readonly string[]).includes(value['kind'] as string)) return false
  if (value['verdict'] !== undefined && !(REVIEW_VERDICTS as readonly string[]).includes(value['verdict'] as string)) return false
  if (value['round'] !== undefined && !(Number.isSafeInteger(value['round']) && (value['round'] as number) >= 1)) return false
  if (value['objective'] !== undefined && !nonemptyString(value['objective'])) return false
  if (value['reviewedTaskId'] !== undefined && !nonemptyString(value['reviewedTaskId'])) return false
  if (value['sourceTaskId'] !== undefined && !nonemptyString(value['sourceTaskId'])) return false
  if (value['reviewedAttempt'] !== undefined && !(Number.isSafeInteger(value['reviewedAttempt']) && (value['reviewedAttempt'] as number) >= 0)) {
    return false
  }
  const stringLists = ['inScope', 'outOfScope', 'acceptance', 'verify', 'deliverables', 'nonGoals', 'changedPaths', 'sourceFindingIds', 'findingSourceTaskIds', 'coverageOf'] as const
  for (const key of stringLists) {
    if (value[key] === undefined) continue
    if (!Array.isArray(value[key]) || !(value[key] as unknown[]).every(nonemptyString)) return false
  }
  if (value['findings'] !== undefined) {
    if (!Array.isArray(value['findings']) || !value['findings'].every(isReviewFinding)) return false
    const ids = (value['findings'] as ReviewFinding[]).map((finding) => finding.id)
    if (new Set(ids).size !== ids.length) return false
  }
  if (value['acceptanceResults'] !== undefined) {
    if (!Array.isArray(value['acceptanceResults']) || !value['acceptanceResults'].every(isAcceptanceResult)) return false
  }
  if (value['commandsRun'] !== undefined) {
    if (!Array.isArray(value['commandsRun']) || !value['commandsRun'].every(isCommandResult)) return false
  }
  if (value['supplementalEvidence'] !== undefined && (!Array.isArray(value['supplementalEvidence']) || !value['supplementalEvidence'].every(isTaskEvidence))) return false
  if (value['revisions'] !== undefined) {
    if (!Array.isArray(value['revisions']) || !value['revisions'].every(isTaskRevision)) return false
  }
  if (value['reviewedArtifacts'] !== undefined
    && (!Array.isArray(value['reviewedArtifacts']) || !value['reviewedArtifacts'].every(isArtifactDigest))) return false
  if (value['reviewedGaps'] !== undefined
    && (!Array.isArray(value['reviewedGaps']) || value['reviewedGaps'].length === 0 || !value['reviewedGaps'].every(isArtifactScopeGap))) return false
  if (value['reviewedScope'] !== undefined && !nonemptyStringList(value['reviewedScope'])) return false
  if (value['reviewedDuringDrift'] !== undefined && !nonemptyStringList(value['reviewedDuringDrift'])) return false
  if (value['contractSnapshot'] !== undefined && !isArtifactSnapshot(value['contractSnapshot'])) return false
  if (value['verdictStartSnapshot'] !== undefined && !isArtifactSnapshot(value['verdictStartSnapshot'])) return false
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === 'string' && (TASK_KINDS as readonly string[]).includes(value)
}

export function isReviewVerdict(value: unknown): value is ReviewVerdict {
  return typeof value === 'string' && (REVIEW_VERDICTS as readonly string[]).includes(value)
}

export function isFindingSeverity(value: unknown): value is FindingSeverity {
  return typeof value === 'string' && (FINDING_SEVERITIES as readonly string[]).includes(value)
}

export function looksLikeGateTestContract(value: string | undefined): boolean {
  return typeof value === 'string' && GATE_TEST_CONTRACT.test(value)
}

export function sanitizeReviewObjective(value: string | undefined, fallback = DEFAULT_REVIEW_OBJECTIVE): string {
  if (!nonemptyString(value) || looksLikeGateTestContract(value)) return fallback
  return value.trim()
}

export function sanitizeReviewAcceptance(values: readonly string[] | undefined): string[] {
  const cleaned = (values ?? []).map((item) => item.trim()).filter((item) => item !== '' && !looksLikeGateTestContract(item))
  return cleaned.length > 0 ? cleaned : [...DEFAULT_REVIEW_ACCEPTANCE]
}

export function defaultQualityDeliveryGraph(input: {
  goal: string
  implementer?: string
  reviewer?: string
  analyst?: string
  tester?: string
  integrator?: string
}): QualityGraphDraft[] {
  const goal = input.goal.trim() || 'the stated user goal'
  const analyst = input.analyst
  const implementer = input.implementer
  const tester = input.tester ?? input.implementer
  const reviewer = input.reviewer
  const integrator = input.integrator ?? input.reviewer
  return [
    {
      subject: 'requirements-round-1',
      kind: 'requirements',
      assignee: analyst,
      dependencies: [],
      objective: `Converge requirements for: ${goal}`,
      acceptance: ['Open questions are closed or explicitly deferred', 'Acceptance criteria are testable'],
      coverageOf: [goal],
    },
    {
      subject: 'implementation',
      kind: 'implementation',
      assignee: implementer,
      dependencies: ['requirements-round-1'],
      objective: `Implement the approved requirements for: ${goal}`,
      acceptance: ['The implementation matches the approved requirements'],
      inScope: ['src/'],
      verify: ['pnpm test'],
      coverageOf: [goal],
    },
    {
      subject: 'verification',
      kind: 'verification',
      assignee: tester,
      dependencies: ['implementation'],
      objective: `Verify the implementation of: ${goal}`,
      acceptance: ['Declared verification commands pass'],
      coverageOf: [goal],
    },
    {
      subject: 'review-round-1',
      kind: 'review',
      assignee: reviewer,
      dependencies: ['verification'],
      objective: DEFAULT_REVIEW_OBJECTIVE,
      acceptance: [...DEFAULT_REVIEW_ACCEPTANCE],
      coverageOf: [goal],
    },
    {
      subject: 'integration',
      kind: 'integration',
      assignee: integrator,
      dependencies: ['review-round-1'],
      objective: `Confirm the team can declare delivery for: ${goal}`,
      acceptance: ['All required quality tasks are completed with passing reviews'],
      coverageOf: [goal],
    },
  ]
}

export function qualityPlanningPrompt(): string {
  return [
    'When the user explicitly requests full quality-mode planning, use this order unless a constraint forbids a stage: requirements → implementation → verification → review → integration.',
    'Build that entire DAG while the team is staged: an implementation may be created before requirements finishes when its dependency chain includes that requirements task. This is supported; do not wait for requirements to run and do not inspect plugin source to confirm it.',
    'A staged integration task may depend on review round 1. If that review later returns needs_revision, the system automatically rewires still-pending downstream dependencies to the generated repair + next-review gate, so keep integration in the original plan instead of omitting or manually recreating it.',
    'Derive inScope and verification commands from the actual workspace or explicit profile; never assume src/ or pnpm test.',
    'Give every quality task a contract. Review acceptance must judge the latest implementation, not whether the gate rejects needs_revision.',
    'Do not write smoke-test scripts into tasks. Do not ask reviewers to submit needs_revision on purpose.',
    'Do not claim implementation or review yourself unless the user asked the captain to take over.',
    'After a failed review, wait for the automatic repair + next review. Do not recreate that loop by hand.',
    'halted means the human stopped the team; call agent_teams_resume before creating more work. escalated means the automatic review loop hit its ceiling; that is not halt.',
  ].join(' ')
}

export function describeQualityLoop(team: TeamState, audit: DeliveryAudit = {}): QualityLoopSnapshot {
  const delivery = canDeclareDelivery(team, audit)
  const warnings = [...delivery.warnings]
  if (team.halted === true) {
    return {
      state: 'halted',
      halted: true,
      escalated: team.escalated === true,
      deliverable: false,
      summary: 'Team is halted. Call agent_teams_resume with a reason before creating more work.',
      warnings,
    }
  }
  if (delivery.ok) {
    return {
      state: 'deliverable',
      halted: false,
      escalated: team.escalated === true,
      deliverable: true,
      summary: `All required work and quality gates passed. The captain may report delivery.${warnings.length === 0 ? '' : ` Warnings: ${warnings.join('; ')}`}`,
      warnings,
    }
  }
  if (team.escalated === true) {
    const unresolved = unresolvedGates(team)
    return {
      state: 'escalated',
      halted: false,
      escalated: true,
      deliverable: false,
      summary: `Automatic review/repair loop hit its ceiling. The team is still running; do not treat this as halt. Escalate to the user instead of inventing another needs_revision cycle.${unresolved.length === 0 ? '' : ` Genuinely unresolved gates: ${unresolved.map((item) => `${item.id} (${taskKindOf(item)})`).join(', ')}; any failed gate not listed here already has a follow-up repair.`}`,
      warnings,
    }
  }
  const open = team.tasks.some((item) => OPEN_STATUSES.includes(item.status))
  return {
    state: open ? 'running' : 'blocked',
    halted: false,
    escalated: false,
    deliverable: false,
    summary: open
      ? 'Work remains on the shared task list; wait for the scheduler or complete owned tasks.'
      : `Delivery is blocked: ${delivery.blockers.join('; ') || 'unresolved quality gates'}.${warnings.length === 0 ? '' : ` Warnings: ${warnings.join('; ')}`}`,
    warnings,
  }
}

export { QUALITY_KINDS, WRITE_KINDS }

/** Persisted evidence must remain loadable after process restart. */
export function isTaskEvidence(value: unknown): value is TaskEvidence {
  if (!isRecord(value)) return false
  return typeof value['at'] === 'number' && Number.isFinite(value['at'])
    && nonemptyString(value['by']) && Number.isSafeInteger(value['attempt']) && (value['attempt'] as number) >= 0
    && (value['attemptId'] === undefined || nonemptyString(value['attemptId']))
    && (value['note'] === undefined || nonemptyString(value['note']))
    && (value['acceptanceResults'] === undefined || (Array.isArray(value['acceptanceResults']) && value['acceptanceResults'].every(isAcceptanceResult)))
    && (value['commandsRun'] === undefined || (Array.isArray(value['commandsRun']) && value['commandsRun'].every(isCommandResult)))
    && (value['note'] !== undefined || (Array.isArray(value['acceptanceResults']) && value['acceptanceResults'].length > 0) || (Array.isArray(value['commandsRun']) && value['commandsRun'].length > 0))
}

/** Append observations without mutating the original result or its completion time. */
export function appendTaskEvidence(task: TeamTask, input: QualityCompletionUpdate & { evidence_note?: string }, by: string): boolean {
  if (!TERMINAL_TASK_STATUSES.includes(task.status)) throw new Error('supplemental evidence requires a terminal task')
  // Key order must not turn a retried JSON object into a different observation.
  const stable = (value: unknown): string => JSON.stringify(value, (_key, item) =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
  for (const key of ['status', 'output', 'verdict', 'findings', 'changedPaths'] as const) {
    if (input[key] !== undefined && stable(input[key]) !== stable(task[key])) {
      throw new Error(`terminal task ${task.id} is immutable: cannot change ${key}; append evidence with evidence_note, acceptanceResults or commandsRun instead. Do not reclaim or redo completed work.`)
    }
  }
  const prior = (task.supplementalEvidence ?? []).filter(row => row.by === by && row.attempt === (task.attempt ?? 0) && row.attemptId === task.attemptId)
  const freshItems = <T>(items: T[] | undefined, existing: T[]): T[] => {
    const seen = new Set(existing.map(stable))
    return (items ?? []).filter(item => { const key = stable(item); if (seen.has(key)) return false; seen.add(key); return true })
  }
  const acceptanceResults = freshItems(input.acceptanceResults, [...task.acceptanceResults ?? [], ...prior.flatMap(row => row.acceptanceResults ?? [])])
  const commandsRun = freshItems(input.commandsRun, [...task.commandsRun ?? [], ...prior.flatMap(row => row.commandsRun ?? [])])
  const trimmed = input.evidence_note?.trim()
  const note = trimmed && !prior.some(row => row.note === trimmed) ? trimmed : undefined
  if (!note && acceptanceResults.length === 0 && commandsRun.length === 0) return false
  const entry: TaskEvidence = { at: Date.now(), by, attempt: task.attempt ?? 0,
    ...task.attemptId === undefined ? {} : { attemptId: task.attemptId },
    ...note === undefined ? {} : { note },
    ...acceptanceResults.length === 0 ? {} : { acceptanceResults },
    ...commandsRun.length === 0 ? {} : { commandsRun },
  }
  if (!isTaskEvidence(entry)) throw new Error('invalid supplemental evidence')
  task.supplementalEvidence = [...task.supplementalEvidence ?? [], entry]
  return true
}
