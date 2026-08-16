/**
 * Team state persistence and pure team-logic rules.
 *
 * State lives on disk under `<workspace>/<stateDir>/<teamId>/`:
 * - `team.json` — the durable {@link TeamState} record
 * - `inbox/<agentKey>.jsonl` — one JSONL mailbox per agent (`captain` or a
 *   member name), mirroring the Claude Code AgentTeams mailbox layout
 *
 * All mutations run through an in-process per-team queue so read-modify-write
 * stays serial; `fs/promises` is used directly because the plugin owns this
 * bookkeeping (host-plane state, like session persistence) and the abstract
 * `fs` service offers no directory deletion.
 * @module dsh-agent-teams/state
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskStatus, TeamMember, TeamMessage, TeamState, TeamTask } from './types.ts'

/** Mailbox key of the captain. */
export const CAPTAIN_KEY = 'captain'
/** A crashed live-delivery attempt becomes retryable after this interval. */
const MAILBOX_DELIVERY_LEASE_MS = 60_000

/** In-process per-team mutation queues (promise chains). */
const locks = new Map<string, Promise<unknown>>()

/**
 * Serialize mutations of one team across the whole process.
 * @param key - the team id (or any mutation scope).
 * @param fn - the mutation to run exclusively.
 * @returns the mutation's result.
 */
export async function withTeamLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  locks.set(key, previous.then(() => gate))
  await previous
  try {
    return await fn()
  } finally {
    release()
  }
}

/** Longest key emitted before truncating and appending a digest. */
const MAX_KEY_LENGTH = 48

/** Short stable digest, used to keep otherwise-colliding keys distinct. */
function keyDigest(name: string): string {
  return createHash('sha256').update(name).digest('hex').slice(0, 8)
}

/**
 * Fold a free-form name into a safe path/key segment.
 *
 * Unicode letters and digits survive, so CJK/Cyrillic/Greek names stay
 * distinct and readable; everything else — spaces, punctuation, path
 * separators, control characters — folds to `-`. An ASCII-only whitelist
 * mapped *every* non-Latin name onto one shared fallback, which silently
 * merged their mailboxes and rejected the second such member as a duplicate.
 *
 * A name with no letters or digits at all (pure emoji or punctuation) cannot
 * yield a readable key, so it gets a digest rather than a shared constant.
 * Over-long names are truncated with a digest appended, so names sharing a
 * long prefix stay distinct and the result stays within filesystem limits
 * (CJK costs 3 bytes per character in UTF-8).
 *
 * @param name - any user-supplied name.
 * @returns a non-empty key safe as a single path segment.
 */
export function sanitizeKey(name: string): string {
  const cleaned = name.normalize('NFC').trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  if (cleaned === '') return `k-${keyDigest(name)}`
  const points = [...cleaned]
  if (points.length > MAX_KEY_LENGTH) {
    return `${points.slice(0, MAX_KEY_LENGTH).join('')}-${keyDigest(name)}`
  }
  return cleaned
}

/**
 * Whether `dependencies` are all satisfied (every named task exists and
 * completed) for the given task list.
 * @param tasks - the team's tasks.
 * @param dependencies - task ids the candidate depends on.
 * @returns the ids that are still unsatisfied, empty when claimable.
 */
export function unsatisfiedDependencies(tasks: TeamTask[], dependencies: string[]): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  return dependencies.filter((id) => byId.get(id)?.status !== 'completed')
}

/**
 * The allowed task status transitions, keyed by current status.
 * Terminal statuses have no outgoing transitions.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['claimed', 'cancelled'],
  claimed: ['in_progress', 'failed', 'cancelled'],
  in_progress: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
}

/**
 * Validate one task status transition.
 * @param current - the task's current status.
 * @param next - the requested status.
 * @returns the transition error, or undefined when allowed.
 */
export function transitionError(current: TaskStatus, next: TaskStatus): string | undefined {
  if (current === next) return undefined
  if (!TASK_TRANSITIONS[current].includes(next)) {
    return `task status cannot move from "${current}" to "${next}"`
  }
  return undefined
}

/** Activate the task's current generation for one owner and return its capability id. */
export function activateTaskAttempt(task: TeamTask, assignee: string): string {
  const attemptId = randomUUID()
  task.status = 'claimed'
  task.assignee = assignee
  task.attemptId = attemptId
  task.handoffId = undefined
  task.reassigning = false
  task.output = undefined
  task.updatedAt = Date.now()
  return attemptId
}

/** Start a fresh task generation for one owner. */
export function beginTaskAttempt(task: TeamTask, assignee: string): string {
  task.attempt = (task.attempt ?? 0) + 1
  return activateTaskAttempt(task, assignee)
}

/**
 * Revoke the current worker immediately. Clearing its capability makes old
 * updates stale; a separate handoff generation serializes async quiescence.
 */
export function invalidateTaskAttempt(
  task: TeamTask,
  nextAssignee?: string,
  reassigning = false,
): void {
  task.attemptId = undefined
  task.handoffId = randomUUID()
  task.status = 'pending'
  task.assignee = nextAssignee
  task.reassigning = reassigning
  task.output = undefined
  task.updatedAt = Date.now()
}

/**
 * Create the team directory structure and the initial team record.
 * @param stateRoot - resolved absolute state root directory.
 * @param state - the initial team record.
 */
export async function createTeamDir(stateRoot: string, state: TeamState): Promise<void> {
  const dir = join(stateRoot, state.id)
  await mkdir(join(dir, 'inbox'), { recursive: true })
  await atomicWriteText(join(dir, 'team.json'), JSON.stringify(state, null, 2))
}

/**
 * Read one team record; `undefined` when absent.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team's sanitized id.
 */
export async function readTeam(stateRoot: string, teamId: string): Promise<TeamState | undefined> {
  try {
    const raw = await readFile(join(stateRoot, teamId, 'team.json'), 'utf8')
    const value: unknown = JSON.parse(stripLeadingBom(raw))
    if (!isTeamState(value, teamId)) {
      throw new Error(`invalid AgentTeams state in team "${teamId}"`)
    }
    return value
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

/**
 * Synchronously read one team record while a continuable child is being
 * composed. Harness requires child setup contributions to be synchronous;
 * this narrow boundary lets a cold-resumed member restore its durable model
 * selection before its first request can be published.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team's sanitized id.
 * @returns the team record, or `undefined` when absent.
 */
export function readTeamSync(stateRoot: string, teamId: string): TeamState | undefined {
  try {
    const raw = readFileSync(join(stateRoot, teamId, 'team.json'), 'utf8')
    const value: unknown = JSON.parse(stripLeadingBom(raw))
    if (!isTeamState(value, teamId)) {
      throw new Error(`invalid AgentTeams state in team "${teamId}"`)
    }
    return value
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

/**
 * Persist one team record (inside the caller's lock).
 * @param stateRoot - resolved absolute state root directory.
 * @param state - the record to persist.
 */
export async function writeTeam(stateRoot: string, state: TeamState): Promise<void> {
  await atomicWriteText(join(stateRoot, state.id, 'team.json'), JSON.stringify(state, null, 2))
}

/**
 * Find the team owned by one captain session (at most one per captain).
 * @param stateRoot - resolved absolute state root directory.
 * @param captainSessionId - the owning session id.
 * @returns the team record, or undefined when the captain leads no team.
 */
export async function findTeamByCaptain(
  stateRoot: string,
  captainSessionId: string,
): Promise<TeamState | undefined> {
  let entries
  try {
    entries = await readdir(stateRoot, { withFileTypes: true })
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
  let found: TeamState | undefined
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const team = await readTeam(stateRoot, entry.name)
    if (team?.captainSessionId === captainSessionId) {
      if (found !== undefined && found.id !== team.id) {
        throw new Error(`captain session leads multiple active teams ("${found.id}", "${team.id}"); archive one before continuing`)
      }
      found = team
    }
  }
  return found
}

/**
 * Find the team in which one session is an active participant.
 * Captains match `captainSessionId`; members match their durable child session
 * id. Removed members no longer have access to team-scoped tools.
 * @param stateRoot - resolved absolute state root directory.
 * @param agentSessionId - calling captain/member session id.
 * @returns the team record, or undefined when the caller belongs to no team.
 */
export async function findTeamByParticipant(
  stateRoot: string,
  agentSessionId: string,
): Promise<TeamState | undefined> {
  let entries
  try {
    entries = await readdir(stateRoot, { withFileTypes: true })
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
  let found: TeamState | undefined
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const team = await readTeam(stateRoot, entry.name)
    const participates = team?.captainSessionId === agentSessionId
      || team?.members.some((member) => member.id === agentSessionId && member.status !== 'removed') === true
    if (participates && team !== undefined) {
      if (found !== undefined && found.id !== team.id) {
        throw new Error(`agent session belongs to multiple active teams ("${found.id}", "${team.id}"); the target team is ambiguous`)
      }
      found = team
    }
  }
  return found
}

/** Build a fresh message record. */
export function createMessage(from: string, to: string, content: string): TeamMessage {
  return { id: randomUUID(), from, to, content, ts: Date.now() }
}

/**
 * Append one message to an agent's mailbox (JSONL).
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 * @param agentKey - `captain` or a member name.
 * @param message - the message to append.
 */
export async function appendMailbox(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  message: TeamMessage,
): Promise<void> {
  const file = join(stateRoot, teamId, 'inbox', `${sanitizeKey(agentKey)}.jsonl`)
  await mkdir(join(stateRoot, teamId, 'inbox'), { recursive: true })
  let existing = ''
  try {
    existing = await readFile(file, 'utf8')
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
      throw error
    }
  }
  const separator = existing !== '' && !existing.endsWith('\n') ? '\n' : ''
  await atomicWriteText(file, `${existing}${separator}${JSON.stringify(message)}\n`)
}

/**
 * Read one agent's whole mailbox, oldest first.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 * @param agentKey - `captain` or a member name.
 * @param onMalformedLine - optional diagnostic hook; malformed records are
 * skipped so one manually damaged line cannot make the whole team unreadable.
 * @returns the messages, empty when the mailbox does not exist yet.
 */
export async function readMailbox(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  onMalformedLine?: (lineNumber: number, error: unknown) => void,
): Promise<TeamMessage[]> {
  const file = join(stateRoot, teamId, 'inbox', `${sanitizeKey(agentKey)}.jsonl`)
  try {
    const raw = await readFile(file, 'utf8')
    const messages: TeamMessage[] = []
    for (const [index, rawLine] of raw.split('\n').entries()) {
      const line = stripLeadingBom(rawLine)
      if (line.trim() === '') continue
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        onMalformedLine?.(index + 1, new Error('invalid JSON'))
        continue
      }
      if (!isTeamMessage(value)) {
        onMalformedLine?.(index + 1, new Error('invalid message shape'))
        continue
      }
      messages.push(value)
    }
    return messages
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

/** Read only messages that have not been acknowledged by their recipient. */
export async function readUnreadMailbox(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  onMalformedLine?: (lineNumber: number, error: unknown) => void,
): Promise<TeamMessage[]> {
  const now = Date.now()
  return (await readMailbox(stateRoot, teamId, agentKey, onMalformedLine))
    .filter(message => message.readAt === undefined
      && (message.deliveryClaimedAt === undefined
        || now - message.deliveryClaimedAt >= MAILBOX_DELIVERY_LEASE_MS))
}

async function mutateMailbox(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  messageIds: readonly string[],
  mutate: (message: TeamMessage) => TeamMessage,
): Promise<void> {
  if (messageIds.length === 0) return
  const file = join(stateRoot, teamId, 'inbox', `${sanitizeKey(agentKey)}.jsonl`)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const selected = new Set(messageIds)
  const lines = raw.split('\n').map((rawLine) => {
    const line = stripLeadingBom(rawLine)
    if (line.trim() === '') return rawLine
    try {
      const value: unknown = JSON.parse(line)
      if (!isTeamMessage(value) || !selected.has(value.id)) return rawLine
      return JSON.stringify(mutate(value))
    } catch {
      return rawLine
    }
  })
  await atomicWriteText(file, lines.join('\n'))
}

/** Lease selected fallback messages to one delivery path. */
export async function claimMailboxDelivery(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  messageIds: readonly string[],
): Promise<void> {
  const now = Date.now()
  await mutateMailbox(stateRoot, teamId, agentKey, messageIds, message => ({
    ...message,
    deliveryClaimedAt: now,
  }))
}

/** Release a failed delivery lease so the scheduler can retry it later. */
export async function releaseMailboxDelivery(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  messageIds: readonly string[],
): Promise<void> {
  await mutateMailbox(stateRoot, teamId, agentKey, messageIds, (message) => {
    const { deliveryClaimedAt: _claimed, ...released } = message
    return released
  })
}

/**
 * Mark selected durable mailbox records delivered/read while preserving
 * malformed lines for diagnostics. Callers serialize this with the team lock.
 */
export async function acknowledgeMailbox(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  messageIds: readonly string[],
): Promise<void> {
  const now = Date.now()
  await mutateMailbox(stateRoot, teamId, agentKey, messageIds, (message) => {
    const { deliveryClaimedAt: _claimed, ...rest } = message
    return {
      ...rest,
      deliveredAt: message.deliveredAt ?? now,
      readAt: message.readAt ?? now,
    }
  })
}

/** Remove the optional UTF-8 BOM some editors prepend to JSON text. */
function stripLeadingBom(value: string): string {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value
}

/** Atomically replace one UTF-8 state file from a same-directory temp file. */
async function atomicWriteText(file: string, content: string): Promise<void> {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, file)
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Whether a parsed JSON value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a value is an optional string. */
function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

/** Whether a value is a finite timestamp/counter number. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Validate one member record at the durable JSON boundary. */
function isTeamMember(value: unknown): value is TeamMember {
  if (!isRecord(value)) return false
  return typeof value['id'] === 'string'
    && typeof value['name'] === 'string'
    && value['name'].trim() !== ''
    && isOptionalString(value['role'])
    && isOptionalString(value['provider'])
    && isOptionalString(value['model'])
    && isOptionalString(value['reasoningEffort'])
    && isFiniteNumber(value['joinedAt'])
    && (value['status'] === 'idle' || value['status'] === 'working' || value['status'] === 'removed')
}

/** Validate one task record at the durable JSON boundary. */
function isTeamTask(value: unknown): value is TeamTask {
  if (!isRecord(value)) return false
  return typeof value['id'] === 'string'
    && typeof value['subject'] === 'string'
    && isOptionalString(value['description'])
    && (value['status'] === 'pending'
      || value['status'] === 'claimed'
      || value['status'] === 'in_progress'
      || value['status'] === 'completed'
      || value['status'] === 'failed'
      || value['status'] === 'cancelled')
    && isOptionalString(value['assignee'])
    && Array.isArray(value['dependencies'])
    && value['dependencies'].every((dependency) => typeof dependency === 'string')
    && isOptionalString(value['output'])
    && (value['attempt'] === undefined
      || (Number.isSafeInteger(value['attempt']) && (value['attempt'] as number) >= 0))
    && isOptionalString(value['attemptId'])
    && isOptionalString(value['handoffId'])
    && (value['reassigning'] === undefined || typeof value['reassigning'] === 'boolean')
    && isFiniteNumber(value['createdAt'])
    && isFiniteNumber(value['updatedAt'])
}

/** Validate the full team record before it can participate in authorization. */
function isTeamState(value: unknown, expectedId: string): value is TeamState {
  if (!isRecord(value)) return false
  const validShape = value['id'] === expectedId
    && typeof value['name'] === 'string'
    && value['name'].trim() !== ''
    && isOptionalString(value['description'])
    && typeof value['captainSessionId'] === 'string'
    && value['captainSessionId'] !== ''
    && isFiniteNumber(value['createdAt'])
    && Array.isArray(value['members'])
    && value['members'].every(isTeamMember)
    && Array.isArray(value['tasks'])
    && value['tasks'].every(isTeamTask)
    && Number.isSafeInteger(value['taskSeq'])
    && (value['taskSeq'] as number) >= 0
  if (!validShape) return false

  const members = value['members'] as TeamMember[]
  const tasks = value['tasks'] as TeamTask[]
  const memberIds = new Set<string>()
  const memberKeys = new Set<string>()
  for (const member of members) {
    const key = sanitizeKey(member.name)
    if (member.id === '' || key === CAPTAIN_KEY || memberIds.has(member.id) || memberKeys.has(key)) return false
    memberIds.add(member.id)
    memberKeys.add(key)
  }
  const taskIds = new Set<string>()
  for (const task of tasks) {
    if (task.id === '' || taskIds.has(task.id)) return false
    taskIds.add(task.id)
  }
  return true
}

/** Validate a mailbox record so later rendering cannot crash on `{}`/`null`. */
function isTeamMessage(value: unknown): value is TeamMessage {
  if (!isRecord(value)) return false
  return typeof value['id'] === 'string'
    && typeof value['from'] === 'string'
    && typeof value['to'] === 'string'
    && typeof value['content'] === 'string'
    && isFiniteNumber(value['ts'])
    && (value['deliveryClaimedAt'] === undefined || isFiniteNumber(value['deliveryClaimedAt']))
    && (value['deliveredAt'] === undefined || isFiniteNumber(value['deliveredAt']))
    && (value['readAt'] === undefined || isFiniteNumber(value['readAt']))
}

/**
 * Remove a team's whole directory (members should be interrupted first).
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export async function removeTeamDir(stateRoot: string, teamId: string): Promise<void> {
  await rm(join(stateRoot, teamId), { recursive: true, force: true })
}

/**
 * Archive a team instead of deleting it: the whole directory (team.json with
 * tasks and dependency graph, plus the mailboxes) moves under
 * `<stateRoot>/archive/<teamId>/` so later sessions can review how tasks were
 * planned and rebuild dependency relationships. The archive directory has no
 * team.json of its own, so the live activity scan skips it naturally.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export async function archiveTeamDir(stateRoot: string, teamId: string): Promise<void> {
  const archiveRoot = join(stateRoot, 'archive')
  await mkdir(archiveRoot, { recursive: true })
  await rename(join(stateRoot, teamId), join(archiveRoot, teamId))
}

/**
 * Read one archived team (already moved under `archive/`), or undefined when
 * it was never archived.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export async function readArchivedTeam(stateRoot: string, teamId: string): Promise<TeamState | undefined> {
  return readTeam(join(stateRoot, 'archive'), teamId)
}

/**
 * List every archived team id under the state root.
 * @param stateRoot - resolved absolute state root directory.
 * @returns the archived team ids, empty when the archive does not exist.
 */
export async function listArchivedTeamIds(stateRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(join(stateRoot, 'archive'), { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

// ── activity snapshot (server-side, like the Claude Code desktop watcher) ──

/** Visual task state for the activity panel. */
export type VisualTaskState = 'blocked' | 'open' | 'running' | 'completed'

/**
 * The visual state of one task: `running` while in_progress, `completed`
 * when done, `blocked` while any dependency is unfinished, else `open`.
 */
export function taskVisualState(
  status: string,
  dependencies: readonly string[],
  tasks: readonly TeamTask[],
): VisualTaskState {
  if (status === 'completed') return 'completed'
  if (status === 'in_progress') return 'running'
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const openDependency = dependencies.some((dependencyId) => {
    const dependency = byId.get(dependencyId)
    return dependency !== undefined && dependency.status !== 'completed'
  })
  return openDependency ? 'blocked' : 'open'
}

/**
 * Longest dependency path depth per task id (each depth = one lane column).
 */
export function taskDepthsById(tasks: readonly TeamTask[]): Map<string, number> {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const depths = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (taskId: string): number => {
    const cached = depths.get(taskId)
    if (cached !== undefined) return cached
    if (visiting.has(taskId)) return 0
    const task = byId.get(taskId)
    if (task === undefined) return 0
    visiting.add(taskId)
    const dependencies = task.dependencies
      .filter((dependencyId) => byId.has(dependencyId))
      .sort()
    const depth = dependencies.length === 0
      ? 0
      : 1 + Math.max(...dependencies.map(depthOf))
    visiting.delete(taskId)
    depths.set(taskId, depth)
    return depth
  }
  for (const task of tasks) depthOf(task.id)
  return depths
}
