/**
 * Long-lived software project context and state.
 *
 * This module is deliberately independent from the AgentTeams execution
 * state. AgentTeams owns one team run under .agent-teams; this module owns
 * the project facts that must survive many team runs under .agent-project.
 */

import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFile, readFile, readdir, rename } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { readDurableText, withFileLock, writeDurableText } from './state.ts'

export const PROJECT_STATE_VERSION = 3 as const
export const PROJECT_STATE_MIGRATIONS = [1, 2] as const
export const DEFAULT_PROJECT_STATE_DIR = '.agent-project'

export type ProjectMode = 'greenfield' | 'brownfield'
export type ProjectLifecycle = 'new' | 'discovery' | 'active' | 'paused' | 'blocked' | 'completed' | 'cancelled'
export type ProjectPhase = 'discovery' | 'clarification' | 'design' | 'planning' | 'implementation' | 'verification' | 'acceptance' | 'maintenance'
export type ProjectWorkItemStatus =
  | 'not_started'
  | 'in_progress'
  | 'implemented_not_accepted'
  | 'accepted'
  | 'delivered'
  | 'completed'
  | 'blocked'
  | 'waiting_for_user'
  | 'failed_verification'
  | 'failed_review'

export type ProjectDecisionStatus = 'pending' | 'decided' | 'rejected'
export type ProjectMilestoneStatus = 'planned' | 'active' | 'completed' | 'blocked' | 'cancelled'

export type ProjectGateStatus = 'draft' | 'approved' | 'rejected'

/** Project decisions that require a host-issued user confirmation. */
export type ProjectDecisionType = 'requirement_approve' | 'design_approve' | 'work_item_accept' | 'work_item_deliver'

/** Provenance recorded for a project decision. */
export type ProjectDecisionSource = 'host_user' | 'legacy_captain' | 'captain'

/** Request sent to the host confirmation adapter. No model-supplied token is used. */
export interface ProjectDecisionCapabilityRequest {
  projectId: string
  sessionId: string
  decisionType: ProjectDecisionType
  targetVersion: number
  contentHash: string
  now: number
}

/** Claims returned only after the host verifies its opaque user event/token. */
export interface ProjectDecisionCapabilityClaims {
  capabilityId: string
  userId: string
  sessionId: string
  projectId: string
  decisionType: ProjectDecisionType
  targetVersion: number
  contentHash: string
  issuedAt: number
  expiresAt: number
}

/** Host execution context passed out-of-band to the confirmation adapter. */
export interface ProjectDecisionCapabilityExecution {
  sessionId: string
  execution: unknown
}

/**
 * Host integration seam for real user confirmation. The implementation must
 * verify an opaque host-issued event/token and return its claims. The plugin
 * has no fallback that accepts model arguments as authorization.
 */
export interface ProjectDecisionCapabilityProvider {
  verify(
    request: ProjectDecisionCapabilityRequest,
    execution: ProjectDecisionCapabilityExecution,
  ): Promise<ProjectDecisionCapabilityClaims | undefined>
}

/**
 * Stable, host-visible content used when a decision capability is issued.
 * The host must sign/record the hash of the same canonical value; callers
 * must never provide the hash as an authorization argument.
 */
export function projectDecisionContentHash(content: unknown): string {
  return createHash('sha256').update(stableProjectJson(content)).digest('hex')
}

export interface ProjectDecisionMetadata {
  actor: string
  source: ProjectDecisionSource
  timestamp: number
  targetVersion: number
  sessionId: string
  /** Host capability decisions are the only trusted project evidence. */
  mode?: 'host_capability' | 'legacy_compat'
  userId?: string
  projectId?: string
  decisionType?: ProjectDecisionType
  capabilityId?: string
  contentHash?: string
  issuedAt?: number
  expiresAt?: number
  rationale?: string
}

/** Durable replay record for a consumed host capability. */
export interface ProjectDecisionCapabilityUse {
  capabilityId: string
  userId: string
  sessionId: string
  projectId: string
  decisionType: ProjectDecisionType
  targetVersion: number
  contentHash: string
  consumedAt: number
}

export interface ProjectRequirement {
  id: string
  title: string
  statement: string
  scope: string[]
  outOfScope: string[]
  acceptanceCriteria: string[]
  clarificationIds: string[]
  riskIds: string[]
  status: ProjectGateStatus
  version: number
  updatedAt: number
  approvalDecision?: ProjectDecisionMetadata
}

export interface ProjectClarification {
  id: string
  question: string
  options: string[]
  answer?: string
  status: 'open' | 'answered' | 'dismissed'
  askedAt: number
  answeredAt?: number
}

export interface ProjectDesign {
  id: string
  title: string
  summary: string
  architecture: string[]
  moduleBoundaries: string[]
  interfaces: string[]
  dataModel: string[]
  tradeoffs: string[]
  migrationStrategy: string[]
  testStrategy: string[]
  requirementId?: string
  status: ProjectGateStatus
  version: number
  updatedAt: number
  approvalDecision?: ProjectDecisionMetadata
}

export interface ProjectBaselineEvidence {
  capturedAt: number
  mode: ProjectMode
  status: 'ready' | 'pending_decision'
  reason: string
  hasGit: boolean
  gitDirty: boolean
  gitBranch?: string
  gitHead?: string
  changedPaths: string[]
  topLevelEntries: string[]
  manifests: string[]
  buildCommands: string[]
  testCommands: string[]
  architectureEvidence: string[]
}

export interface ProjectDiscovery {
  mode: ProjectMode
  hasGit: boolean
  meaningfulEntries: string[]
  manifests: string[]
  gitDirty: boolean
  gitBranch?: string
  gitHead?: string
  changedPaths: string[]
  baselineStatus: 'ready' | 'pending_decision'
  baselineReason: string
  buildCommands: string[]
  testCommands: string[]
  architectureEvidence: string[]
}

export interface ProjectContext {
  mode: ProjectMode
  summary: string
  techStack: string[]
  buildCommands: string[]
  testCommands: string[]
  constraints: string[]
  discoveredAt: number
  baseline?: ProjectBaselineEvidence
}

export interface ProjectDecision {
  id: string
  question: string
  status: ProjectDecisionStatus
  answer?: string
  decidedAt?: number
}

export interface ProjectMilestone {
  id: string
  title: string
  status: ProjectMilestoneStatus
  workItemIds: string[]
}

export interface ProjectWorkItem {
  id: string
  title: string
  status: ProjectWorkItemStatus
  requirementPath?: string
  designPath?: string
  requirementId?: string
  designId?: string
  teamId?: string
  taskIds?: string[]
  /** Version bound to acceptance and delivery decisions. */
  version?: number
  acceptanceNote?: string
  acceptedAt?: number
  deliveredAt?: number
  acceptanceDecision?: ProjectDecisionMetadata
  deliveryDecision?: ProjectDecisionMetadata
  updatedAt: number
}

export interface ProjectState {
  schemaVersion: typeof PROJECT_STATE_VERSION
  /** Monotonic revision used for cross-process compare-and-swap writes. */
  revision: number
  id: string
  title: string
  goal: string
  lifecycle: ProjectLifecycle
  phase: ProjectPhase
  context: ProjectContext
  requirement?: ProjectRequirement
  clarifications?: ProjectClarification[]
  design?: ProjectDesign
  decisions: ProjectDecision[]
  milestones: ProjectMilestone[]
  workItems: ProjectWorkItem[]
  risks: string[]
  /** Capability ids already consumed; survives process restarts to prevent replay. */
  usedDecisionCapabilities?: ProjectDecisionCapabilityUse[]
  createdAt: number
  updatedAt: number
}

export interface ProjectStatusSummary {
  lifecycle: ProjectLifecycle
  phase: ProjectPhase
  totalWorkItems: number
  counts: Record<ProjectWorkItemStatus, number>
  pendingDecisionCount: number
  blockedMilestoneCount: number
  riskCount: number
  updatedAt: number
}

export interface CreateProjectInput {
  id: string
  title: string
  goal: string
  mode: ProjectMode
  now?: number
  discovery?: ProjectDiscovery
}

export interface ProjectGateSummary {
  requirement: ProjectGateStatus | 'missing'
  design: ProjectGateStatus | 'missing'
  canPlanImplementation: boolean
}

export interface ProjectExecutionTaskSnapshot {
  id: string
  status: string
  dependencies: string[]
  kind?: string
  verdict?: string
}

export interface ProjectExecutionSnapshot {
  halted?: boolean
  tasks: ProjectExecutionTaskSnapshot[]
}

/** Project-level projection of an AgentTeams execution snapshot. */
export function projectWorkItemStatusFromTeam(
  team: ProjectExecutionSnapshot,
  taskIds: readonly string[] = [],
): ProjectWorkItemStatus {
  const selected = taskIds.length === 0
    ? team.tasks
    : team.tasks.filter((task) => taskIds.includes(task.id))
  if (selected.length === 0) return 'not_started'
  const selectedIds = new Set(selected.map((task) => task.id))
  const failed = selected.filter((task) => task.status === 'failed')
  if (failed.some((task) => task.kind === 'review' || task.verdict === 'needs_revision' || task.verdict === 'reject')) return 'failed_review'
  if (failed.length > 0) return 'failed_verification'
  if (team.halted === true) return 'waiting_for_user'
  if (selected.some((task) => task.status === 'claimed' || task.status === 'in_progress')) return 'in_progress'
  const pending = selected.filter((task) => task.status === 'pending')
  if (pending.length > 0) {
    const blocked = pending.some((task) => task.dependencies.some((dependency) => (
      selectedIds.has(dependency) && selected.find((candidate) => candidate.id === dependency)?.status !== 'completed'
    )))
    return blocked ? 'blocked' : 'not_started'
  }
  if (selected.some((task) => task.status === 'cancelled')) return 'blocked'
  if (selected.every((task) => task.status === 'completed')) return 'implemented_not_accepted'
  return 'in_progress'
}

const PROJECT_WORK_ITEM_STATUSES: readonly ProjectWorkItemStatus[] = [
  'not_started',
  'in_progress',
  'implemented_not_accepted',
  'accepted',
  'delivered',
  'completed',
  'blocked',
  'waiting_for_user',
  'failed_verification',
  'failed_review',
]

const IGNORED_ENTRIES = new Set([
  '.agent-project',
  '.agent-teams',
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  'node_modules',
  'dist',
  'build',
  'target',
  '__pycache__',
])

const MANIFEST_NAMES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  'composer.json',
  'Gemfile',
  'mix.exs',
])

const projectLocks = new Map<string, Promise<unknown>>()

type ProjectStateRecord = Record<string, unknown>
type ProjectMigration = (value: ProjectStateRecord) => ProjectStateRecord

const projectMigrations = new Map<number, ProjectMigration>([
  [1, (value) => ({ ...value, schemaVersion: 2, revision: value.revision === undefined ? 0 : value.revision })],
  [2, (value) => ({
    ...value,
    schemaVersion: 3,
    context: {
      ...(isRecord(value.context) ? value.context : {}),
      baseline: isRecord(value.context) && isRecord(value.context.baseline)
        ? value.context.baseline
        : {
            capturedAt: Date.now(),
            mode: isRecord(value.context) && value.context.mode === 'brownfield' ? 'brownfield' : 'greenfield',
            status: isRecord(value.context) && value.context.mode === 'brownfield' ? 'pending_decision' : 'ready',
            reason: 'Legacy project migrated without auditable Brownfield baseline evidence',
            hasGit: isRecord(value.context) && value.context.mode === 'brownfield',
            gitDirty: false,
            changedPaths: [],
            topLevelEntries: [],
            manifests: [],
            buildCommands: [],
            testCommands: [],
            architectureEvidence: [],
          },
    },
  })],
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stableProjectJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('decision content must contain only finite numbers')
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return '[' + value.map((entry) => stableProjectJson(entry)).join(',') + ']'
  if (isRecord(value)) {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableProjectJson(value[key])).join(',') + '}'
  }
  throw new Error('decision content must be JSON data')
}

/** Return errors for claims returned by the trusted host adapter. */
export function validateProjectDecisionCapability(
  value: unknown,
  request: ProjectDecisionCapabilityRequest,
  now: number,
  used: readonly ProjectDecisionCapabilityUse[] = [],
): string[] {
  const errors: string[] = []
  if (!isRecord(value)) return ['capability claims must be an object']
  for (const field of ['capabilityId', 'userId', 'sessionId', 'projectId', 'contentHash'] as const) {
    if (typeof value[field] !== 'string' || value[field].trim() === '') errors.push('capability.' + field + ' must be a non-empty string')
  }
  if (!isOneOf(value.decisionType, ['requirement_approve', 'design_approve', 'work_item_accept', 'work_item_deliver'])) errors.push('capability.decisionType is invalid')
  for (const field of ['targetVersion', 'issuedAt', 'expiresAt'] as const) {
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) errors.push('capability.' + field + ' must be a finite number')
  }
  if (typeof value.targetVersion === 'number' && (!Number.isSafeInteger(value.targetVersion) || value.targetVersion < 1)) errors.push('capability.targetVersion must be a positive integer')
  if (typeof value.issuedAt === 'number' && typeof value.expiresAt === 'number') {
    if (value.expiresAt <= value.issuedAt) errors.push('capability.expiresAt must be after issuedAt')
    if (value.issuedAt > now) errors.push('capability.issuedAt is in the future')
    if (value.expiresAt <= now) errors.push('capability has expired')
  }
  if (typeof value.capabilityId === 'string' && used.some((item) => item.capabilityId === value.capabilityId)) errors.push('capability has already been consumed')
  const comparisons: Array<[keyof ProjectDecisionCapabilityClaims, unknown]> = [
    ['sessionId', request.sessionId],
    ['projectId', request.projectId],
    ['decisionType', request.decisionType],
    ['targetVersion', request.targetVersion],
    ['contentHash', request.contentHash],
  ]
  for (const [field, expected] of comparisons) {
    if (value[field] !== expected) errors.push('capability.' + field + ' does not match the current decision request')
  }
  return errors
}

/** Atomically append a consumed capability to the durable project state. */
export function consumeProjectDecisionCapability(
  state: ProjectState,
  claims: ProjectDecisionCapabilityClaims,
  now: number,
): void {
  const used = state.usedDecisionCapabilities ?? (state.usedDecisionCapabilities = [])
  if (used.some((item) => item.capabilityId === claims.capabilityId)) throw new Error('capability has already been consumed')
  used.push({
    capabilityId: claims.capabilityId,
    userId: claims.userId,
    sessionId: claims.sessionId,
    projectId: claims.projectId,
    decisionType: claims.decisionType,
    targetVersion: claims.targetVersion,
    contentHash: claims.contentHash,
    consumedAt: now,
  })
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T)
}

function validateProjectRequirement(value: unknown): string[] {
  if (!isRecord(value)) return ['requirement must be an object']
  const errors: string[] = []
  for (const field of ['id', 'title', 'statement'] as const) {
    if (typeof value[field] !== 'string' || value[field].trim() === '') errors.push('requirement.' + field + ' must be a non-empty string')
  }
  for (const field of ['scope', 'outOfScope', 'acceptanceCriteria', 'clarificationIds', 'riskIds'] as const) {
    if (!isStringArray(value[field])) errors.push('requirement.' + field + ' must be a string array')
  }
  if (!isOneOf(value.status, ['draft', 'approved', 'rejected'])) errors.push('requirement.status is invalid')
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) errors.push('requirement.version must be a positive integer')
  if (typeof value.updatedAt !== 'number') errors.push('requirement.updatedAt must be a number')
  if (value.approvalDecision !== undefined) errors.push(...validateProjectDecisionMetadata(value.approvalDecision, 'requirement.approvalDecision'))
  return errors
}

function validateProjectDecisionMetadata(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [path + ' must be an object']
  const errors: string[] = []
  if (typeof value.actor !== 'string' || value.actor.trim() === '') errors.push(path + '.actor must be a non-empty string')
  if (!isOneOf(value.source, ['host_user', 'legacy_captain', 'captain'])) errors.push(path + '.source is invalid')
  if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) errors.push(path + '.timestamp must be a finite number')
  if (typeof value.targetVersion !== 'number' || !Number.isInteger(value.targetVersion) || value.targetVersion < 1) errors.push(path + '.targetVersion must be a positive integer')
  if (typeof value.sessionId !== 'string' || value.sessionId.trim() === '') errors.push(path + '.sessionId must be a non-empty string')
  if (value.source === 'host_user') {
    if (value.mode !== 'host_capability') errors.push(path + '.mode must be host_capability for host_user decisions')
    for (const field of ['userId', 'projectId', 'capabilityId', 'contentHash'] as const) {
      if (typeof value[field] !== 'string' || value[field].trim() === '') errors.push(path + '.' + field + ' must be a non-empty string for host_user decisions')
    }
    if (!isOneOf(value.decisionType, ['requirement_approve', 'design_approve', 'work_item_accept', 'work_item_deliver'])) errors.push(path + '.decisionType is invalid for host_user decisions')
    for (const field of ['issuedAt', 'expiresAt'] as const) {
      if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) errors.push(path + '.' + field + ' must be a finite number for host_user decisions')
    }
  }
  if (value.rationale !== undefined && (typeof value.rationale !== 'string' || value.rationale.trim() === '')) errors.push(path + '.rationale must be a non-empty string when present')
  return errors
}

function validateProjectDecisionCapabilityUse(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [path + ' must be an object']
  const errors: string[] = []
  for (const field of ['capabilityId', 'userId', 'sessionId', 'projectId', 'contentHash'] as const) {
    if (typeof value[field] !== 'string' || value[field].trim() === '') errors.push(path + '.' + field + ' must be a non-empty string')
  }
  if (!isOneOf(value.decisionType, ['requirement_approve', 'design_approve', 'work_item_accept', 'work_item_deliver'])) errors.push(path + '.decisionType is invalid')
  if (typeof value.targetVersion !== 'number' || !Number.isSafeInteger(value.targetVersion) || value.targetVersion < 1) errors.push(path + '.targetVersion must be a positive integer')
  if (typeof value.consumedAt !== 'number' || !Number.isFinite(value.consumedAt)) errors.push(path + '.consumedAt must be a finite number')
  return errors
}

function validateProjectClarifications(value: unknown): string[] {
  if (!Array.isArray(value)) return ['clarifications must be an array']
  const errors: string[] = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) { errors.push('clarifications[' + index + '] must be an object'); continue }
    if (typeof item.id !== 'string' || item.id.trim() === '') errors.push('clarifications[' + index + '].id must be non-empty')
    if (typeof item.question !== 'string' || item.question.trim() === '') errors.push('clarifications[' + index + '].question must be non-empty')
    if (!isStringArray(item.options)) errors.push('clarifications[' + index + '].options must be a string array')
    if (item.answer !== undefined && typeof item.answer !== 'string') errors.push('clarifications[' + index + '].answer must be a string')
    if (!isOneOf(item.status, ['open', 'answered', 'dismissed'])) errors.push('clarifications[' + index + '].status is invalid')
    if (typeof item.askedAt !== 'number') errors.push('clarifications[' + index + '].askedAt must be a number')
    if (item.answeredAt !== undefined && typeof item.answeredAt !== 'number') errors.push('clarifications[' + index + '].answeredAt must be a number')
  }
  return errors
}

function validateProjectDesign(value: unknown): string[] {
  if (!isRecord(value)) return ['design must be an object']
  const errors: string[] = []
  for (const field of ['id', 'title', 'summary'] as const) {
    if (typeof value[field] !== 'string' || value[field].trim() === '') errors.push('design.' + field + ' must be a non-empty string')
  }
  for (const field of ['architecture', 'moduleBoundaries', 'interfaces', 'dataModel', 'tradeoffs', 'migrationStrategy', 'testStrategy'] as const) {
    if (!isStringArray(value[field])) errors.push('design.' + field + ' must be a string array')
  }
  if (value.requirementId !== undefined && (typeof value.requirementId !== 'string' || value.requirementId.trim() === '')) errors.push('design.requirementId must be a non-empty string')
  if (!isOneOf(value.status, ['draft', 'approved', 'rejected'])) errors.push('design.status is invalid')
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) errors.push('design.version must be a positive integer')
  if (typeof value.updatedAt !== 'number') errors.push('design.updatedAt must be a number')
  if (value.approvalDecision !== undefined) errors.push(...validateProjectDecisionMetadata(value.approvalDecision, 'design.approvalDecision'))
  return errors
}

function projectStateDir(projectRoot: string, stateDir = DEFAULT_PROJECT_STATE_DIR): string {
  if (isAbsolute(stateDir) || stateDir.split(/[\\/]/u).includes('..')) {
    throw new Error('project state directory must be relative to the workspace')
  }
  return resolve(projectRoot, stateDir)
}

function projectStatePath(projectRoot: string, stateDir = DEFAULT_PROJECT_STATE_DIR): string {
  return join(projectStateDir(projectRoot, stateDir), 'status.json')
}


function projectLockPath(projectRoot: string, stateDir = DEFAULT_PROJECT_STATE_DIR): string {
  return join(projectStateDir(projectRoot, stateDir), '.project.lock')
}

/** Apply every known project-state migration, failing closed on an unknown gap. */
export function migrateProjectState(value: unknown): unknown {
  if (!isRecord(value)) throw new Error('project state must be a JSON object before migration')
  let current: ProjectStateRecord = { ...value }
  const version = current.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version)) throw new Error('project state schemaVersion must be an integer')
  if (version > PROJECT_STATE_VERSION || version < 1) throw new Error('unsupported project state schemaVersion: ' + String(version))
  while (current.schemaVersion !== PROJECT_STATE_VERSION) {
    const migration = projectMigrations.get(current.schemaVersion as number)
    if (migration === undefined) throw new Error('missing project state migration from schemaVersion ' + String(current.schemaVersion))
    current = migration(current)
  }
  return current
}

/** Serialize mutations for one project within the current DSH process. */
export async function withProjectLock<T>(projectRoot: string, fn: () => Promise<T>, stateDir = DEFAULT_PROJECT_STATE_DIR): Promise<T> {
  const key = resolve(projectRoot) + ":" + stateDir
  const previous = projectLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => { release = resolveGate })
  const current = previous.then(() => gate)
  projectLocks.set(key, current)
  await previous
  try {
    return await withFileLock(projectLockPath(projectRoot, stateDir), fn)
  } finally {
    release()
    if (projectLocks.get(key) === current) projectLocks.delete(key)
  }
}

/** Discover whether a workspace is empty or already contains a project. */
export async function discoverProject(projectRoot: string): Promise<ProjectDiscovery> {
  const entries = await readdir(projectRoot, { withFileTypes: true })
  const meaningfulEntries = entries
    .map((entry) => entry.name)
    .filter((name) => !IGNORED_ENTRIES.has(name))
    .sort((left, right) => left.localeCompare(right))
  const manifests = meaningfulEntries.filter((name) => MANIFEST_NAMES.has(name))
  const hasGit = entries.some((entry) => entry.name === '.git')
  let gitDirty = false
  let gitBranch: string | undefined
  let gitHead: string | undefined
  let changedPaths: string[] = []
  if (hasGit) {
    try {
      const status = execFileSync('git', ['-C', projectRoot, 'status', '--porcelain=v1', '--branch'], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 })
      const lines = status.split(String.fromCharCode(10)).map((line) => line.replace(String.fromCharCode(13), '')).filter(Boolean)
      const branch = lines.find((line) => line.startsWith('## '))
      gitBranch = branch?.slice(3).split('...')[0] || undefined
      changedPaths = lines.filter((line) => !line.startsWith('## ')).map((line) => line.slice(3).trim()).filter(Boolean)
      gitDirty = changedPaths.length > 0
      try { gitHead = execFileSync('git', ['-C', projectRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim() || undefined } catch { /* empty repository */ }
    } catch {
      gitDirty = true
      changedPaths = ['<git-status-unavailable>']
    }
  }
  const buildCommands = new Set<string>()
  const testCommands = new Set<string>()
  const packageManager = meaningfulEntries.includes('pnpm-lock.yaml') ? 'pnpm' : meaningfulEntries.includes('yarn.lock') ? 'yarn' : 'npm'
  if (manifests.includes('package.json')) {
    try {
      const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> }
      for (const name of Object.keys(manifest.scripts ?? {})) {
        if (/^(build|compile|bundle)(:|$)/.test(name)) buildCommands.add(packageManager + ' run ' + name)
        if (/^(test|verify|check)(:|$)/.test(name)) testCommands.add(packageManager + ' run ' + name)
      }
    } catch { /* malformed manifests remain visible through missing-entry evidence */ }
  }
  if (manifests.includes('pyproject.toml') || manifests.includes('requirements.txt')) { buildCommands.add('python -m build'); testCommands.add('python -m pytest') }
  if (manifests.includes('Cargo.toml')) { buildCommands.add('cargo build'); testCommands.add('cargo test') }
  if (manifests.includes('go.mod')) { buildCommands.add('go build ./...'); testCommands.add('go test ./...') }
  const architectureEvidence = meaningfulEntries.filter((name) => /^(src|app|apps|packages|lib|test|tests|docs|cmd|internal|crates|services)$/.test(name)).map((name) => 'top-level:' + name)
  architectureEvidence.push(...manifests.map((name) => 'manifest:' + name))
  if (gitBranch) architectureEvidence.push('git-branch:' + gitBranch)
  if (gitDirty) architectureEvidence.push('git-dirty:uncommitted-changes-present')
  const mode = meaningfulEntries.length === 0 ? 'greenfield' : 'brownfield'
  const baselineStatus = mode === 'greenfield' ? 'ready' : gitDirty || buildCommands.size === 0 || testCommands.size === 0 || architectureEvidence.length === 0 ? 'pending_decision' : 'ready'
  const baselineReason = mode === 'greenfield'
    ? 'Empty workspace; no pre-existing implementation baseline requires takeover review'
    : gitDirty
      ? 'Git working tree is dirty; uncommitted changes require explicit baseline review before implementation'
      : buildCommands.size === 0 || testCommands.size === 0
        ? 'Build or test entry point was not discovered; baseline is incomplete and requires a decision'
        : 'Git, manifest, build, test, and top-level architecture evidence were discovered'
  return {
    mode,
    hasGit,
    meaningfulEntries,
    manifests,
    gitDirty,
    gitBranch,
    gitHead,
    changedPaths,
    baselineStatus,
    baselineReason,
    buildCommands: [...buildCommands].sort(),
    testCommands: [...testCommands].sort(),
    architectureEvidence: [...new Set(architectureEvidence)].sort(),
  }
}

/** Create a new project record before requirements work begins. */
export function createInitialProjectState(input: CreateProjectInput): ProjectState {
  const id = input.id.trim()
  const title = input.title.trim()
  const goal = input.goal.trim()
  if (id === '' || title === '' || goal === '') throw new Error('project id, title, and goal are required')
  const now = input.now ?? Date.now()
  return {
    schemaVersion: PROJECT_STATE_VERSION,
    revision: 0,
    id,
    title,
    goal,
    lifecycle: 'discovery',
    phase: 'discovery',
    context: {
      mode: input.mode,
      summary: '',
      techStack: [],
      buildCommands: input.discovery?.buildCommands ?? [],
      testCommands: input.discovery?.testCommands ?? [],
      constraints: [],
      discoveredAt: now,
      baseline: input.discovery === undefined ? undefined : {
        capturedAt: now,
        mode: input.discovery.mode,
        status: input.discovery.baselineStatus,
        reason: input.discovery.baselineReason,
        hasGit: input.discovery.hasGit,
        gitDirty: input.discovery.gitDirty,
        gitBranch: input.discovery.gitBranch,
        gitHead: input.discovery.gitHead,
        changedPaths: input.discovery.changedPaths,
        topLevelEntries: input.discovery.meaningfulEntries,
        manifests: input.discovery.manifests,
        buildCommands: input.discovery.buildCommands,
        testCommands: input.discovery.testCommands,
        architectureEvidence: input.discovery.architectureEvidence,
      },
    },
    clarifications: [],
      decisions: input.discovery?.baselineStatus === 'pending_decision'
        ? [{ id: 'brownfield-baseline', question: input.discovery.baselineReason, status: 'pending' }]
        : [],
    milestones: [],
    workItems: [],
    risks: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function projectGateSummary(state: ProjectState): ProjectGateSummary {
  const requirement = state.requirement?.status ?? 'missing'
  const design = state.design?.status ?? 'missing'
  const hasOpenClarification = (state.clarifications ?? []).some((item) => item.status === 'open')
  const requirementApproval = state.requirement?.approvalDecision
  const designApproval = state.design?.approvalDecision
  const trustedRequirementApproval = requirementApproval?.source === 'host_user'
    && requirementApproval.mode === 'host_capability'
    && requirementApproval.projectId === state.id
    && requirementApproval.decisionType === 'requirement_approve'
    && requirementApproval.targetVersion === state.requirement?.version
  const trustedDesignApproval = designApproval?.source === 'host_user'
    && designApproval.mode === 'host_capability'
    && designApproval.projectId === state.id
    && designApproval.decisionType === 'design_approve'
    && designApproval.targetVersion === state.design?.version
  return {
    requirement,
    design,
    canPlanImplementation: requirement === 'approved' && design === 'approved' && trustedRequirementApproval && trustedDesignApproval && !hasOpenClarification,
  }
}

export function assertProjectBaselineResolved(state: ProjectState): void {
  if (state.context.baseline?.mode === 'brownfield' && state.context.baseline.status !== 'ready') {
    throw new Error('brownfield baseline is pending decision; review Git changes and baseline evidence before implementation')
  }
}

/** Validate the durable binding between a project and an AgentTeams record. */
export function assertProjectTeamBinding(project: ProjectState, team: {
  projectId?: string
  projectRequirementId?: string
  projectRequirementVersion?: number
  projectDesignId?: string
  projectDesignVersion?: number
  projectLinkState?: string
}): void {
  if (team.projectId === undefined) return
  if (team.projectId !== project.id) throw new Error('project Team binding mismatch: project id')
  if (team.projectRequirementId !== project.requirement?.id || team.projectRequirementVersion !== project.requirement?.version) throw new Error('project Team binding mismatch: requirement')
  if (team.projectDesignId !== project.design?.id || team.projectDesignVersion !== project.design?.version) throw new Error('project Team binding mismatch: design')
  // A bound Project Team must have an explicit successful Work Item link.
  // Missing metadata is an old or incomplete binding, not Legacy compatibility.
  if (team.projectLinkState !== 'linked') throw new Error('project Team binding mismatch: link state')
  const linkedWorkItem = project.workItems.find((item) => item.teamId === (team as { id?: string }).id)
  if (linkedWorkItem === undefined) throw new Error('project Team has no associated Project Work Item')
  if (linkedWorkItem.requirementId !== team.projectRequirementId || linkedWorkItem.designId !== team.projectDesignId) {
    throw new Error('project Work Item binding mismatch: requirement/design')
  }
}

export function assertImplementationPlanningAllowed(state: ProjectState): void {
  assertProjectBaselineResolved(state)
  const gates = projectGateSummary(state)
  if (!gates.canPlanImplementation) {
    throw new Error('implementation planning requires approved requirements and design (requirement=' + gates.requirement + ', design=' + gates.design + ')')
  }
}

/** Return validation errors without mutating the candidate value. */
export function validateProjectState(value: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(value)) return ['state must be a JSON object']
  if (value.schemaVersion !== PROJECT_STATE_VERSION) errors.push('unsupported schemaVersion')
  if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0) errors.push('revision must be a non-negative integer')
  for (const field of ['id', 'title', 'goal'] as const) {
    if (typeof value[field] !== 'string' || value[field].trim() === '') errors.push(field + ' must be a non-empty string')
  }
  if (!isOneOf(value.lifecycle, ['new', 'discovery', 'active', 'paused', 'blocked', 'completed', 'cancelled'])) errors.push('invalid lifecycle')
  if (!isOneOf(value.phase, ['discovery', 'clarification', 'design', 'planning', 'implementation', 'verification', 'acceptance', 'maintenance'])) errors.push('invalid phase')
  if (!isRecord(value.context)) errors.push('context must be an object')
  else {
    if (!isOneOf(value.context.mode, ['greenfield', 'brownfield'])) errors.push('invalid context.mode')
    for (const field of ['summary'] as const) if (typeof value.context[field] !== 'string') errors.push('context.' + field + ' must be a string')
    for (const field of ['techStack', 'buildCommands', 'testCommands', 'constraints'] as const) if (!isStringArray(value.context[field])) errors.push('context.' + field + ' must be a string array')
    if (typeof value.context.discoveredAt !== 'number') errors.push('context.discoveredAt must be a number')
    if (value.context.baseline !== undefined) {
      const baseline = value.context.baseline
      if (!isRecord(baseline)) errors.push('context.baseline must be an object')
      else {
        if (!isOneOf(baseline.mode, ['greenfield', 'brownfield'])) errors.push('context.baseline.mode is invalid')
        if (!isOneOf(baseline.status, ['ready', 'pending_decision'])) errors.push('context.baseline.status is invalid')
        for (const field of ['changedPaths', 'topLevelEntries', 'manifests', 'buildCommands', 'testCommands', 'architectureEvidence'] as const) if (!isStringArray(baseline[field])) errors.push('context.baseline.' + field + ' must be a string array')
      }
    }
  }
  if (value.requirement !== undefined) errors.push(...validateProjectRequirement(value.requirement))
  if (value.clarifications !== undefined) errors.push(...validateProjectClarifications(value.clarifications))
  if (value.design !== undefined) errors.push(...validateProjectDesign(value.design))
  if (!Array.isArray(value.decisions)) errors.push('decisions must be an array')
  if (!Array.isArray(value.milestones)) errors.push('milestones must be an array')
  if (!Array.isArray(value.workItems)) errors.push('workItems must be an array')
  if (!isStringArray(value.risks)) errors.push('risks must be a string array')
  if (value.usedDecisionCapabilities !== undefined) {
    if (!Array.isArray(value.usedDecisionCapabilities)) errors.push('usedDecisionCapabilities must be an array')
    else for (const [index, capability] of value.usedDecisionCapabilities.entries()) errors.push(...validateProjectDecisionCapabilityUse(capability, 'usedDecisionCapabilities[' + index + ']'))
  }
  if (typeof value.createdAt !== 'number') errors.push('createdAt must be a number')
  if (typeof value.updatedAt !== 'number') errors.push('updatedAt must be a number')
  if (Array.isArray(value.workItems)) {
    for (const [index, item] of value.workItems.entries()) {
      if (!isRecord(item)) { errors.push('workItems[' + index + '] must be an object'); continue }
      if (typeof item.id !== 'string' || item.id.trim() === '') errors.push('workItems[' + index + '].id must be non-empty')
      if (typeof item.title !== 'string' || item.title.trim() === '') errors.push('workItems[' + index + '].title must be non-empty')
      if (!isOneOf(item.status, PROJECT_WORK_ITEM_STATUSES)) errors.push('workItems[' + index + '].status is invalid')
      if (item.requirementId !== undefined && (typeof item.requirementId !== 'string' || item.requirementId.trim() === '')) errors.push('workItems[' + index + '].requirementId must be a non-empty string')
      if (item.designId !== undefined && (typeof item.designId !== 'string' || item.designId.trim() === '')) errors.push('workItems[' + index + '].designId must be a non-empty string')
      if (item.teamId !== undefined && (typeof item.teamId !== 'string' || item.teamId.trim() === '')) errors.push('workItems[' + index + '].teamId must be a non-empty string')
      if (item.taskIds !== undefined && !isStringArray(item.taskIds)) errors.push('workItems[' + index + '].taskIds must be a string array')
      if (item.version !== undefined && (typeof item.version !== 'number' || !Number.isInteger(item.version) || item.version < 1)) errors.push('workItems[' + index + '].version must be a positive integer')
      if (item.acceptanceNote !== undefined && (typeof item.acceptanceNote !== 'string' || item.acceptanceNote.trim() === '')) errors.push('workItems[' + index + '].acceptanceNote must be a non-empty string')
      if (item.acceptedAt !== undefined && typeof item.acceptedAt !== 'number') errors.push('workItems[' + index + '].acceptedAt must be a number')
      if (item.deliveredAt !== undefined && typeof item.deliveredAt !== 'number') errors.push('workItems[' + index + '].deliveredAt must be a number')
      if (item.acceptanceDecision !== undefined) errors.push(...validateProjectDecisionMetadata(item.acceptanceDecision, 'workItems[' + index + '].acceptanceDecision'))
      if (item.deliveryDecision !== undefined) errors.push(...validateProjectDecisionMetadata(item.deliveryDecision, 'workItems[' + index + '].deliveryDecision'))
      if (typeof item.updatedAt !== 'number') errors.push('workItems[' + index + '].updatedAt must be a number')
    }
  }
  return errors
}

function assertValidProjectState(value: unknown): asserts value is ProjectState {
  const errors = validateProjectState(value)
  if (errors.length > 0) throw new Error('invalid project state: ' + errors.join('; '))
}

function parseProjectState(raw: string, path: string): { state: ProjectState; migrated: boolean } {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('project state is not valid JSON: ' + path) }
  const originalVersion = isRecord(parsed) ? parsed.schemaVersion : undefined
  const migrated = migrateProjectState(parsed)
  assertValidProjectState(migrated)
  return { state: migrated as ProjectState, migrated: originalVersion !== PROJECT_STATE_VERSION }
}

async function readProjectStateUnlocked(projectRoot: string, stateDir = DEFAULT_PROJECT_STATE_DIR): Promise<ProjectState | undefined> {
  const path = projectStatePath(projectRoot, stateDir)
  const raw = await readDurableText(path, (candidate) => {
    try { parseProjectState(candidate, path); return true } catch { return false }
  }, path)
  if (raw === undefined) return undefined
  return parseProjectState(raw, path).state
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await writeDurableText(path, content)
}

/** Write a validated project state below the workspace. */
export async function writeProjectState(projectRoot: string, state: ProjectState, stateDir = DEFAULT_PROJECT_STATE_DIR): Promise<void> {
  await withFileLock(projectLockPath(projectRoot, stateDir), async () => {
    const current = await readProjectStateUnlocked(projectRoot, stateDir)
    if (current !== undefined && current.revision !== state.revision) throw new Error('concurrent project state update')
    const next: ProjectState = { ...state, schemaVersion: PROJECT_STATE_VERSION, revision: (current?.revision ?? state.revision ?? 0) + 1 }
    assertValidProjectState(next)
    await atomicWrite(projectStatePath(projectRoot, stateDir), JSON.stringify(next, null, 2) + '\n')
    state.revision = next.revision
  })
}

/** Read a project state; undefined means the workspace has not been initialized. */
export async function createProjectStateIfAbsent(
  projectRoot: string,
  state: ProjectState,
  stateDir = DEFAULT_PROJECT_STATE_DIR,
): Promise<{ created: boolean; state: ProjectState }> {
  return withProjectLock(projectRoot, async () => {
    const existing = await readProjectState(projectRoot, stateDir)
    if (existing !== undefined) return { created: false, state: existing }
    const initialState: ProjectState = { ...state, schemaVersion: PROJECT_STATE_VERSION, revision: 0 }
    await writeProjectState(projectRoot, initialState, stateDir)
    return { created: true, state: initialState }
  }, stateDir)
}
export async function readProjectState(projectRoot: string, stateDir = DEFAULT_PROJECT_STATE_DIR): Promise<ProjectState | undefined> {
  return withFileLock(projectLockPath(projectRoot, stateDir), async () => {
    const path = projectStatePath(projectRoot, stateDir)
    const raw = await readDurableText(path, (candidate) => {
      try { parseProjectState(candidate, path); return true } catch { return false }
    }, path)
    if (raw === undefined) return undefined
    const parsed = parseProjectState(raw, path)
    if (parsed.migrated) {
      await copyFile(path, path + '.migration-' + Date.now() + '.bak').catch(() => undefined)
      const next: ProjectState = { ...parsed.state, revision: parsed.state.revision + 1 }
      assertValidProjectState(next)
      await atomicWrite(path, JSON.stringify(next, null, 2) + '\n')
      return next
    }
    return parsed.state
  })
}

/** Mutate and persist one project state under the process-local project lock. */
export async function updateProjectState(
  projectRoot: string,
  mutator: (state: ProjectState) => ProjectState | void | Promise<ProjectState | void>,
  stateDir = DEFAULT_PROJECT_STATE_DIR,
): Promise<ProjectState> {
  return withProjectLock(projectRoot, async () => {
    const current = await readProjectState(projectRoot, stateDir)
    if (current === undefined) throw new Error('project is not initialized: ' + resolve(projectRoot))
    const result = await mutator(current)
    const next = result ?? current
    next.updatedAt = Date.now()
    await writeProjectState(projectRoot, next, stateDir)
    return next
  }, stateDir)
}

/** Build a stable project-level status summary for reports and future UI. */
export function summarizeProjectState(state: ProjectState): ProjectStatusSummary {
  const counts = Object.fromEntries(PROJECT_WORK_ITEM_STATUSES.map((status) => [status, 0])) as Record<ProjectWorkItemStatus, number>
  for (const item of state.workItems) counts[item.status] += 1
  return {
    lifecycle: state.lifecycle,
    phase: state.phase,
    totalWorkItems: state.workItems.length,
    counts,
    pendingDecisionCount: state.decisions.filter((decision) => decision.status === 'pending').length,
    blockedMilestoneCount: state.milestones.filter((milestone) => milestone.status === 'blocked').length,
    riskCount: state.risks.length,
    updatedAt: state.updatedAt,
  }
}
