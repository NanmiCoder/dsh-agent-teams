/**
 * Named team-profile templates: config types, normalization, invocation
 * parsing, and prompt rendering.
 *
 * Pure functions only — no I/O, no spawn. Runtime create/spawn stays in
 * `tools.ts`; this module only turns a config map + a profile name into a
 * validated, topologically ordered template (or parses `--profile` flags).
 *
 * @module dsh-agent-teams/profiles
 */

import { CAPTAIN_KEY, sanitizeKey } from './state.ts'

/** Hard cap on named profiles so the usage prompt cannot grow without bound. */
export const MAX_TEAM_PROFILES = 16
/** Hard cap on seed tasks per profile. The software-delivery example has 13. */
export const MAX_PROFILE_TASKS = 32
/** Protocol excerpt length in the usage / prompt listing. */
export const PROFILE_PROTOCOL_PROMPT_LIMIT = 240

const PROFILE_KEYS = ['description', 'protocol', 'executionPrompt', 'fallback', 'members', 'tasks', 'taskPlanning', 'reviewPolicy'] as const
const REVIEW_POLICY_KEYS = ['requirementsMinRounds', 'requirementsMaxRounds', 'codeMaxRounds', 'maxRepairAttempts', 'requiredReviewers'] as const
const MEMBER_KEYS = ['name', 'role', 'provider', 'model', 'reasoning_effort', 'executionPrompt', 'fallback'] as const
const FALLBACK_KEYS = ['provider', 'model'] as const
const TASK_KEYS = ['id', 'subject', 'description', 'assignee', 'dependencies'] as const

/** One member row in a named team-profile template (unresolved). */
export interface TeamModelFallbackConfig {
  provider: string
  model: string
}

export interface TeamProfileMemberConfig {
  name: string
  role?: string
  provider?: string
  model?: string
  reasoning_effort?: string
  executionPrompt?: string
  fallback?: TeamModelFallbackConfig
}

/** One seed-task row in a named team-profile template (unresolved). */
export interface TeamProfileTaskConfig {
  id: string
  subject: string
  description?: string
  assignee?: string
  dependencies?: string[]
}

/** One named team-profile template from plugin config. */
export interface TeamProfileConfig {
  description?: string
  protocol?: string
  executionPrompt?: string
  fallback?: TeamModelFallbackConfig
  members: TeamProfileMemberConfig[]
  /**
   * `captain` means the profile supplies people and guardrails only; the
   * Captain derives the task graph from the user's goal at runtime.
   * `seed` preserves a fixed template workflow for explicitly scripted teams.
   */
  taskPlanning?: 'captain' | 'seed'
  tasks?: TeamProfileTaskConfig[]
  reviewPolicy?: import('./types.ts').ReviewPolicy
}

/** A profile member after trim / pairing / reserved-name checks. */
export interface NormalizedProfileMember {
  name: string
  role?: string
  provider?: string
  model?: string
  reasoningEffort?: string
  executionPrompt?: string
  fallback?: TeamModelFallbackConfig
}

/** A profile seed task after assignee canonicalization; `sourceIndex` is the YAML order. */
export interface NormalizedProfileTask {
  id: string
  subject: string
  description?: string
  assignee?: string
  dependencies: string[]
  sourceIndex: number
}

/** A fully validated, topologically ordered team profile. */
export interface NormalizedTeamProfile {
  name: string
  description?: string
  protocol?: string
  executionPrompt?: string
  fallback?: TeamModelFallbackConfig
  taskPlanning: 'captain' | 'seed'
  members: NormalizedProfileMember[]
  tasks: NormalizedProfileTask[]
  reviewPolicy?: import('./types.ts').ReviewPolicy
}

/** The goal + optional named profile extracted from a slash / gesture line. */
export interface AgentTeamsInvocation {
  goal: string
  profile?: string
}

/** One configured profile after key trim, for listing / lookup. */
export interface ListedTeamProfile {
  name: string
  config: TeamProfileConfig
}

/**
 * Trim every profile key once, reject empty / colliding keys, and reject
 * more than {@link MAX_TEAM_PROFILES} entries. Does not validate profile
 * bodies — that belongs to {@link resolveTeamProfile}.
 */
export function listConfiguredProfiles(
  profiles: Record<string, TeamProfileConfig> | undefined | null,
): ListedTeamProfile[] {
  const record = asProfilesRecord(profiles)
  const keys = Object.keys(record)
  if (keys.length > MAX_TEAM_PROFILES) {
    throw new Error(`too many AgentTeams profiles (${keys.length}); the limit is ${MAX_TEAM_PROFILES}`)
  }
  const seen = new Map<string, string>()
  const listed: ListedTeamProfile[] = []
  for (const rawKey of keys) {
    const name = rawKey.trim()
    if (name === '') {
      throw new Error('configured AgentTeams profiles include an empty key')
    }
    const previous = seen.get(name)
    if (previous !== undefined) {
      throw new Error(`configured AgentTeams profiles have duplicate key "${name}"`)
    }
    seen.set(name, rawKey)
    listed.push({ name, config: record[rawKey] as TeamProfileConfig })
  }
  return listed
}

/**
 * Render the usage-prompt listing. One line per profile: name, member count,
 * task count, protocol excerpt (at most 240 characters). Returns `''` when
 * nothing is configured so callers can omit the capability entirely.
 */
export function formatProfilesForPrompt(
  profiles: Record<string, TeamProfileConfig> | undefined | null,
): string {
  const listed = listConfiguredProfiles(profiles)
  if (listed.length === 0) return ''
  const lines = [
    'Configured team profiles (pass profile= to agent_teams_create):',
    ...listed.map((entry) => formatProfileListingLine(entry)),
  ]
  return lines.join('\n')
}

/**
 * Walk `rawInput` from the front and eat standalone profile flags. Only
 * `--profile <name>`, `--profile=<name>`, and `profile=<name>` count; the
 * first ordinary token stops the scan so a mid-sentence `profile=` stays in
 * the goal. A leading ordinary token is never treated as a profile name.
 *
 * `--profile "name"` strips one matching pair of quotes. Repeat flags and a
 * `--profile` with no name throw.
 */
export function parseProfileInvocation(rawInput: string): AgentTeamsInvocation {
  const tokens = tokenize(rawInput)
  let index = 0
  let profile: string | undefined
  while (index < tokens.length) {
    const token = tokens[index]
    if (token === undefined) break
    const parsed = parseLeadingProfileFlag(token, tokens[index + 1])
    if (parsed === undefined) break
    if (profile !== undefined) {
      throw new Error('duplicate AgentTeams profile flag')
    }
    profile = parsed.name
    index += parsed.consumed
  }
  const goal = tokens.slice(index).join(' ')
  return profile === undefined ? { goal } : { goal, profile }
}

/**
 * Normalize and pre-validate one named profile. Failures throw before any
 * caller should create a directory or spawn members.
 */
export function resolveTeamProfile(
  profiles: Record<string, TeamProfileConfig>,
  profileName: string,
  maxMembers: number,
): NormalizedTeamProfile {
  const listed = listConfiguredProfiles(profiles)
  const name = profileName.trim()
  if (name === '') {
    throw new Error('AgentTeams profile name must be a non-empty string')
  }
  const match = listed.find((entry) => entry.name === name)
  if (match === undefined) {
    const available = listed.map((entry) => entry.name)
    const shown = available.length === 0 ? '(none)' : available.join(', ')
    throw new Error(`unknown AgentTeams profile "${name}" — configured profiles: ${shown}`)
  }
  return normalizeListedProfile(match, maxMembers)
}

function formatProfileListingLine(entry: ListedTeamProfile): string {
  const memberCount = Array.isArray(entry.config.members) ? entry.config.members.length : 0
  const planning = resolveProfileTaskPlanning(entry.config)
  const graph = planning === 'captain'
    ? 'captain planning'
    : countLabel(Array.isArray(entry.config.tasks) ? entry.config.tasks.length : 0, 'task')
  const counts = `(${countLabel(memberCount, 'member')}, ${graph})`
  const summary = protocolSummary(entry.config.protocol)
  return summary === undefined
    ? `- ${entry.name} ${counts}`
    : `- ${entry.name} ${counts}: ${summary}`
}

/** Public lookup used by activation text and status rendering. */
export function resolveProfileTaskPlanning(config: TeamProfileConfig | undefined): 'captain' | 'seed' {
  return config?.taskPlanning === 'captain' ? 'captain' : 'seed'
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function protocolSummary(protocol: string | undefined): string | undefined {
  if (typeof protocol !== 'string') return undefined
  const collapsed = protocol.trim().replace(/\s+/gu, ' ')
  if (collapsed === '') return undefined
  return collapsed.length <= PROFILE_PROTOCOL_PROMPT_LIMIT
    ? collapsed
    : collapsed.slice(0, PROFILE_PROTOCOL_PROMPT_LIMIT)
}

function tokenize(rawInput: string): string[] {
  const trimmed = rawInput.trim()
  if (trimmed === '') return []
  return trimmed.split(/\s+/u)
}

function parseLeadingProfileFlag(
  token: string,
  nextToken: string | undefined,
): { name: string; consumed: number } | undefined {
  if (token === '--profile') {
    if (nextToken === undefined) {
      throw new Error('--profile flag is missing a profile name')
    }
    return { name: readProfileToken(nextToken), consumed: 2 }
  }
  if (token.startsWith('--profile=')) {
    return { name: readProfileToken(token.slice('--profile='.length)), consumed: 1 }
  }
  if (token.startsWith('profile=')) {
    return { name: readProfileToken(token.slice('profile='.length)), consumed: 1 }
  }
  return undefined
}

function readProfileToken(raw: string): string {
  const name = stripOneQuotePair(raw).trim()
  if (name === '') {
    throw new Error('--profile flag is missing a profile name')
  }
  return name
}

/** Strip a single matching pair of `"` or `'` quotes; leave unmatched quotes alone. */
function stripOneQuotePair(value: string): string {
  if (value.length < 2) return value
  const first = value.at(0)
  const last = value.at(-1)
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1)
  }
  return value
}

function normalizeListedProfile(
  listed: ListedTeamProfile,
  maxMembers: number,
): NormalizedTeamProfile {
  const path = `profiles.${listed.name}`
  const raw = asRecord(listed.config, path)
  assertAllowedKeys(raw, PROFILE_KEYS, path)

  const description = optionalNonEmptyString(raw['description'], `${path}.description`)
  const protocol = optionalNonEmptyString(raw['protocol'], `${path}.protocol`)
  const executionPrompt = optionalNonEmptyString(raw['executionPrompt'], `${path}.executionPrompt`)
  const fallback = normalizeFallback(raw['fallback'], `${path}.fallback`)
  const taskPlanning = normalizeTaskPlanning(raw['taskPlanning'], `${path}.taskPlanning`)
  const reviewPolicy = normalizeReviewPolicy(raw['reviewPolicy'], `${path}.reviewPolicy`)
  const membersRaw = raw['members']
  if (!Array.isArray(membersRaw) || membersRaw.length === 0) {
    throw new Error(`AgentTeams profile "${listed.name}" has no members`)
  }
  if (membersRaw.length > maxMembers) {
    throw new Error(
      `profile "${listed.name}" has ${membersRaw.length} members but maxMembers is ${maxMembers}`,
    )
  }

  const members: NormalizedProfileMember[] = []
  const memberByName = new Map<string, NormalizedProfileMember>()
  const memberByKey = new Map<string, NormalizedProfileMember>()
  for (let index = 0; index < membersRaw.length; index += 1) {
    const member = normalizeMember(membersRaw[index], `${path}.members[${index}]`, listed.name)
    const key = sanitizeKey(member.name)
    const colliding = memberByKey.get(key)
    if (colliding !== undefined) {
      throw new Error(
        `profile members "${colliding.name}" and "${member.name}" collapse to the same name`,
      )
    }
    memberByName.set(member.name, member)
    memberByKey.set(key, member)
    members.push(member)
  }

  const tasksRaw = raw['tasks']
  if (tasksRaw === undefined) {
    return omitUndefined({
      name: listed.name,
      description,
      protocol,
      executionPrompt,
      fallback,
      taskPlanning,
      reviewPolicy,
      members,
      tasks: [],
    })
  }
  if (!Array.isArray(tasksRaw)) {
    throw new Error(`profiles.${listed.name}.tasks must be an array`)
  }
  if (tasksRaw.length > MAX_PROFILE_TASKS) {
    throw new Error(
      `profile "${listed.name}" has ${tasksRaw.length} tasks but the limit is ${MAX_PROFILE_TASKS}`,
    )
  }

  const requireAssignee = tasksRaw.length > 0
  const draftTasks: NormalizedProfileTask[] = []
  const taskById = new Map<string, NormalizedProfileTask>()
  const taskByKey = new Map<string, NormalizedProfileTask>()
  for (let index = 0; index < tasksRaw.length; index += 1) {
    const task = normalizeTask(
      tasksRaw[index],
      `${path}.tasks[${index}]`,
      listed.name,
      index,
      memberByName,
      memberByKey,
      requireAssignee,
    )
    const collidingId = taskById.get(task.id)
    if (collidingId !== undefined) {
      throw new Error(`profile "${listed.name}" has duplicate task id "${task.id}"`)
    }
    const key = sanitizeKey(task.id)
    const collidingKey = taskByKey.get(key)
    if (collidingKey !== undefined) {
      throw new Error(
        `profile tasks "${collidingKey.id}" and "${task.id}" collapse to the same id`,
      )
    }
    taskById.set(task.id, task)
    taskByKey.set(key, task)
    draftTasks.push(task)
  }

  const tasks = topoSortTasks(draftTasks, listed.name)
  return omitUndefined({
    name: listed.name,
    description,
    protocol,
    executionPrompt,
    fallback,
    taskPlanning,
    reviewPolicy,
    members,
    tasks: taskPlanning === 'captain' ? [] : tasks,
  })
}

function normalizeTaskPlanning(value: unknown, path: string): 'captain' | 'seed' {
  if (value === undefined) return 'seed'
  if (value === 'captain' || value === 'seed') return value
  throw new Error(`${path} must be "captain" or "seed"`)
}

function normalizeReviewPolicy(value: unknown, path: string): import('./types.ts').ReviewPolicy | undefined {
  if (value === undefined) return undefined
  const raw = asRecord(value, path)
  assertAllowedKeys(raw, REVIEW_POLICY_KEYS, path)
  const requirementsMinRounds = optionalPositiveInt(raw['requirementsMinRounds'], `${path}.requirementsMinRounds`)
  const requirementsMaxRounds = optionalPositiveInt(raw['requirementsMaxRounds'], `${path}.requirementsMaxRounds`)
  const codeMaxRounds = optionalPositiveInt(raw['codeMaxRounds'], `${path}.codeMaxRounds`)
  const maxRepairAttempts = optionalPositiveInt(raw['maxRepairAttempts'], `${path}.maxRepairAttempts`)
  if (
    requirementsMinRounds !== undefined
    && requirementsMaxRounds !== undefined
    && requirementsMinRounds > requirementsMaxRounds
  ) {
    throw new Error(`${path}.requirementsMinRounds must be <= requirementsMaxRounds`)
  }
  let requiredReviewers: string[] | undefined
  if (raw['requiredReviewers'] !== undefined) {
    if (!Array.isArray(raw['requiredReviewers'])) {
      throw new Error(`${path}.requiredReviewers must be an array of strings`)
    }
    requiredReviewers = raw['requiredReviewers'].map((item, index) => {
      if (typeof item !== 'string' || item.trim() === '') {
        throw new Error(`${path}.requiredReviewers[${index}] must be a non-empty string`)
      }
      return item.trim()
    })
  }
  return omitUndefined({
    requirementsMinRounds,
    requirementsMaxRounds,
    codeMaxRounds,
    maxRepairAttempts,
    requiredReviewers,
  })
}

function optionalPositiveInt(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${path} must be a positive integer`)
  }
  return value as number
}

function normalizeMember(
  value: unknown,
  path: string,
  profileName: string,
): NormalizedProfileMember {
  const raw = asRecord(value, path)
  assertAllowedKeys(raw, MEMBER_KEYS, path)
  const name = requiredNonEmptyString(raw['name'], `${path}.name`, `profile "${profileName}" has a member with an empty name`)
  if (isCaptainName(name)) {
    throw new Error(`member name "${name}" is reserved for the captain`)
  }
  const role = optionalNonEmptyString(raw['role'], `${path}.role`)
  const provider = optionalNonEmptyString(raw['provider'], `${path}.provider`)
  const model = optionalNonEmptyString(raw['model'], `${path}.model`)
  const reasoningEffort = optionalNonEmptyString(raw['reasoning_effort'], `${path}.reasoning_effort`)
  const executionPrompt = optionalNonEmptyString(raw['executionPrompt'], `${path}.executionPrompt`)
  const fallback = normalizeFallback(raw['fallback'], `${path}.fallback`)
  if (provider !== undefined && model === undefined) {
    throw new Error(`profile member "${name}" sets provider without model`)
  }
  return omitUndefined({ name, role, provider, model, reasoningEffort, executionPrompt, fallback })
}

function normalizeFallback(value: unknown, path: string): TeamModelFallbackConfig | undefined {
  if (value === undefined) return undefined
  const raw = asRecord(value, path)
  assertAllowedKeys(raw, FALLBACK_KEYS, path)
  const provider = requiredNonEmptyString(raw['provider'], `${path}.provider`, `${path}.provider must not be empty`)
  const model = requiredNonEmptyString(raw['model'], `${path}.model`, `${path}.model must not be empty`)
  return { provider, model }
}

function normalizeTask(
  value: unknown,
  path: string,
  profileName: string,
  sourceIndex: number,
  memberByName: Map<string, NormalizedProfileMember>,
  memberByKey: Map<string, NormalizedProfileMember>,
  requireAssignee: boolean,
): NormalizedProfileTask {
  const raw = asRecord(value, path)
  assertAllowedKeys(raw, TASK_KEYS, path)
  const id = requiredNonEmptyString(
    raw['id'],
    `${path}.id`,
    `profile "${profileName}" has a task with an empty id`,
  )
  const subject = requiredNonEmptyString(
    raw['subject'],
    `${path}.subject`,
    `profile task "${id}" is missing a subject`,
  )
  const description = optionalNonEmptyString(raw['description'], `${path}.description`)
  const dependencies = normalizeDependencies(raw['dependencies'], `${path}.dependencies`, id)
  const assignee = resolveTaskAssignee(
    raw['assignee'],
    `${path}.assignee`,
    id,
    requireAssignee,
    memberByName,
    memberByKey,
  )
  return omitUndefined({
    id,
    subject,
    description,
    assignee,
    dependencies,
    sourceIndex,
  })
}

function normalizeDependencies(value: unknown, path: string, taskId: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of task ids`)
  }
  const dependencies: string[] = []
  const seen = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (typeof item !== 'string') {
      throw new Error(`${path}[${index}] must be a string`)
    }
    const dependency = item.trim()
    if (dependency === '') {
      throw new Error(`${path}[${index}] must not be empty`)
    }
    if (dependency === taskId) {
      throw new Error(`profile task "${taskId}" cannot depend on itself`)
    }
    if (seen.has(dependency)) continue
    seen.add(dependency)
    dependencies.push(dependency)
  }
  return dependencies
}

function resolveTaskAssignee(
  value: unknown,
  path: string,
  taskId: string,
  required: boolean,
  memberByName: Map<string, NormalizedProfileMember>,
  memberByKey: Map<string, NormalizedProfileMember>,
): string | undefined {
  if (value === undefined) {
    if (required) {
      throw new Error(`profile task "${taskId}" is missing an assignee`)
    }
    return undefined
  }
  if (typeof value !== 'string') {
    throw new Error(`${path} must be a string`)
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new Error(`profile task "${taskId}" is missing an assignee`)
  }
  if (isCaptainName(trimmed)) {
    throw new Error(`profile task "${taskId}" cannot assign work to the captain`)
  }
  const exact = memberByName.get(trimmed)
  if (exact !== undefined) return exact.name
  const fuzzy = memberByKey.get(sanitizeKey(trimmed))
  if (fuzzy !== undefined) return fuzzy.name
  throw new Error(`profile task "${taskId}" assignee "${trimmed}" is not a profile member`)
}

function topoSortTasks(tasks: NormalizedProfileTask[], profileName: string): NormalizedProfileTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!byId.has(dependency)) {
        throw new Error(`profile task "${task.id}" depends on unknown task "${dependency}"`)
      }
    }
  }

  const indegree = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const task of tasks) {
    indegree.set(task.id, 0)
    outgoing.set(task.id, [])
  }
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1)
      outgoing.get(dependency)?.push(task.id)
    }
  }

  const ready = tasks
    .filter((task) => (indegree.get(task.id) ?? 0) === 0)
    .sort((left, right) => left.sourceIndex - right.sourceIndex)
  const ordered: NormalizedProfileTask[] = []
  while (ready.length > 0) {
    const next = ready.shift()
    if (next === undefined) break
    ordered.push(next)
    for (const childId of outgoing.get(next.id) ?? []) {
      const remaining = (indegree.get(childId) ?? 0) - 1
      indegree.set(childId, remaining)
      if (remaining === 0) {
        const child = byId.get(childId)
        if (child === undefined) continue
        ready.push(child)
        ready.sort((left, right) => left.sourceIndex - right.sourceIndex)
      }
    }
  }

  if (ordered.length !== tasks.length) {
    const cyclic = tasks
      .filter((task) => !ordered.some((done) => done.id === task.id))
      .map((task) => task.id)
    throw new Error(formatCycleError(profileName, cyclic))
  }
  return ordered
}

function formatCycleError(_profileName: string, cyclic: string[]): string {
  const first = cyclic[0] ?? 'unknown'
  const second = cyclic[1]
  if (cyclic.length === 1 || second === undefined) {
    return `profile task "${first}" forms a dependency cycle`
  }
  if (cyclic.length === 2) {
    return `profile task "${first}" and "${second}" form a dependency cycle`
  }
  const head = cyclic.slice(0, -1).map((id) => `"${id}"`).join(', ')
  const tail = cyclic[cyclic.length - 1] ?? first
  return `profile tasks ${head}, and "${tail}" form a dependency cycle`
}

function isCaptainName(name: string): boolean {
  return name.trim().toLowerCase() === CAPTAIN_KEY || sanitizeKey(name) === CAPTAIN_KEY
}

function asProfilesRecord(
  profiles: Record<string, TeamProfileConfig> | undefined | null,
): Record<string, unknown> {
  if (profiles === undefined || profiles === null) return {}
  if (typeof profiles !== 'object' || Array.isArray(profiles)) {
    throw new Error('AgentTeams profiles must be an object map of named templates')
  }
  return profiles as Record<string, unknown>
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allow = new Set<string>(allowed)
  for (const key of Object.keys(value)) {
    if (allow.has(key)) continue
    const suggestion = suggestField(key, allowed)
    const hint = suggestion === undefined ? '' : `; did you mean ${suggestion}?`
    throw new Error(`${path}.${key} is unknown${hint}`)
  }
}

function suggestField(unknown: string, allowed: readonly string[]): string | undefined {
  const lower = unknown.toLowerCase()
  const exact = allowed.find((candidate) => candidate.toLowerCase() === lower)
  if (exact !== undefined) return exact
  let best: string | undefined
  let bestDistance = Infinity
  for (const candidate of allowed) {
    const distance = levenshtein(lower, candidate.toLowerCase())
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  if (best !== undefined && bestDistance <= 2) return best
  return undefined
}

function levenshtein(left: string, right: string): number {
  const rows = left.length + 1
  const cols = right.length + 1
  const grid: number[][] = []
  for (let row = 0; row < rows; row += 1) {
    const line: number[] = []
    for (let col = 0; col < cols; col += 1) {
      if (row === 0) line.push(col)
      else if (col === 0) line.push(row)
      else line.push(0)
    }
    grid.push(line)
  }
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1
      const del = (grid[row - 1]?.[col] ?? 0) + 1
      const ins = (grid[row]?.[col - 1] ?? 0) + 1
      const sub = (grid[row - 1]?.[col - 1] ?? 0) + cost
      const cell = grid[row]
      if (cell !== undefined) cell[col] = Math.min(del, ins, sub)
    }
  }
  return grid[left.length]?.[right.length] ?? 0
}

function requiredNonEmptyString(
  value: unknown,
  path: string,
  emptyMessage: string,
): string {
  if (value === undefined || typeof value !== 'string') {
    throw new Error(`${path} must be a string`)
  }
  const trimmed = value.trim()
  if (trimmed === '') throw new Error(emptyMessage)
  return trimmed
}

function optionalNonEmptyString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error(`${path} must be a string`)
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new Error(`${path} must not be empty`)
  }
  return trimmed
}

function omitUndefined<T extends object>(value: T): T {
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] === undefined) delete value[key]
  }
  return value
}
