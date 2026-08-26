/** Pure relationship projections used by the AgentTeams activity panel. */

/** Minimum task shape needed to derive dependency relationships. */
export interface RelationshipTask {
  readonly id: string
  readonly dependencies: readonly string[]
  readonly depth: number
}

/** One dependency-depth stage in stable display order. */
export interface RelationshipStage<T extends RelationshipTask> {
  readonly depth: number
  readonly tasks: readonly T[]
}

/** Geometry used by the compact task DAG in the activity panel. */
export interface CompactDagNode<T extends RelationshipTask> {
  readonly task: T
  readonly x: number
  readonly y: number
}

/** One dependency edge routed between two compact DAG nodes. */
export interface CompactDagEdge {
  readonly from: string
  readonly to: string
  readonly path: string
}

/** Complete, scrollable compact DAG projection. */
export interface CompactDagLayout<T extends RelationshipTask> {
  readonly width: number
  readonly height: number
  readonly nodes: readonly CompactDagNode<T>[]
  readonly edges: readonly CompactDagEdge[]
}

/** Reference-panel geometry: narrow nodes with enough room for curved edges. */
export const COMPACT_DAG_NODE_WIDTH = 92
export const COMPACT_DAG_NODE_HEIGHT = 30
export const COMPACT_DAG_COLUMN_GAP = 26
export const COMPACT_DAG_ROW_GAP = 8

/** Compact `provider/model` route, or just the model when the provider is absent. */
export function memberRouteLabel(member: { readonly provider?: string; readonly model?: string } | undefined): string {
  if (member === undefined) return ''
  const provider = member.provider?.trim() ?? ''
  const model = member.model?.trim() ?? ''
  if (provider !== '' && model !== '') return `${provider}/${model}`
  return model
}

/**
 * Compact route shown on a running task. Prefer the task's own snapshot
 * field; fall back to the assignee member when older hosts omit it.
 */
export function taskModelLabel(
  task: { readonly model?: string; readonly assignee: string },
  members: readonly { readonly name: string; readonly provider?: string; readonly model?: string }[],
): string {
  const direct = task.model?.trim() ?? ''
  if (direct !== '') return direct
  return memberRouteLabel(members.find((candidate) => candidate.name === task.assignee))
}

/** Short model id for tight DAG/chip surfaces (`openai/gpt-5.6-sol` → `gpt-5.6-sol`). */
export function compactModelLabel(route: string): string {
  const trimmed = route.trim()
  if (trimmed === '') return ''
  const slash = trimmed.lastIndexOf('/')
  return slash === -1 ? trimmed : trimmed.slice(slash + 1)
}

/** A live team the current captain still owns and has not halted. */
export function liveCaptainTeam<T extends { readonly captainSessionId: string; readonly halted?: boolean }>(
  teams: readonly T[],
  sessionId: string | undefined,
): T | undefined {
  const owner = sessionId?.trim() ?? ''
  if (owner === '') return undefined
  return teams.find((team) => team.captainSessionId === owner && team.halted !== true)
}

/** Whether the captain chat should keep showing the in-progress banner. */
export function teamIsActive(team: {
  readonly phase?: string
  readonly halted?: boolean
  readonly members: readonly { readonly status?: string; readonly activity?: string }[]
  readonly tasks: readonly { readonly status: string }[]
}): boolean {
  if (team.halted === true || team.phase === 'staged') return false
  if (team.members.some((member) => member.activity === 'working' || member.status === 'working')) return true
  if (team.tasks.some((task) => task.status === 'pending' || task.status === 'claimed' || task.status === 'in_progress')) return true
  return team.members.length > 0 && team.tasks.length === 0
}

/** Compact banner copy: running members, otherwise the current planning state. */
export function teamProgressSummary(
  team: {
    readonly members: readonly { readonly name: string; readonly status?: string; readonly activity?: string; readonly currentTask?: string }[]
    readonly tasks: readonly { readonly id: string; readonly subject: string; readonly status: string }[]
  },
  separator: string,
): { readonly working: number; readonly detail: string } {
  const workingMembers = team.members.filter((member) => member.activity === 'working' || member.status === 'working')
  const runningTasks = team.tasks.filter((task) => task.status === 'claimed' || task.status === 'in_progress')
  const labels = runningTasks.map((task) => task.subject.trim() || task.id).filter((label) => label !== '')
  if (workingMembers.length > 0 || labels.length > 0) {
    return {
      working: Math.max(workingMembers.length, labels.length),
      detail: labels.slice(0, 2).join(separator),
    }
  }
  if (team.tasks.length === 0) return { working: 0, detail: '' }
  return { working: 0, detail: '' }
}

/** Use a fill-width grid when the task graph has no real dependency edges. */
export function usesParallelTaskGrid<T extends RelationshipTask>(tasks: readonly T[]): boolean {
  if (tasks.length === 0) return false
  const taskIds = new Set(tasks.map((task) => task.id))
  return tasks.every((task) => task.dependencies.every((dependency) => !taskIds.has(dependency)))
}

/**
 * Whether an expanded activity panel still belongs to the current session.
 *
 * The panel is mounted in the root-scoped shell overlay, so React does not
 * remount it when the conversation route changes. Ownership keeps an expanded
 * panel from leaking onto the new-session screen (or another conversation)
 * while its local open state is being reset.
 */
export function activityPanelExpandedForSession(
  open: boolean,
  owner: string | undefined,
  current: string | undefined,
): boolean {
  return open && owner !== undefined && owner === current
}

/** Inputs for deciding whether genuinely new live work may expand the panel. */
export interface ActivityPanelAutoExpandInput {
  readonly alreadyAutoOpened: boolean
  readonly pageSettled: boolean
  readonly restoreComplete: boolean
  readonly previousLiveTeamIds: ReadonlySet<string>
  readonly currentLiveTeamIds: readonly string[]
}

/**
 * Auto-expand only for live teams that appear after the current session's
 * initial restore pass. Replayed cards, archived teams, and live teams restored
 * while reopening a conversation must remain behind the collapsed badge.
 */
export function activityPanelShouldAutoExpand({
  alreadyAutoOpened,
  pageSettled,
  restoreComplete,
  previousLiveTeamIds,
  currentLiveTeamIds,
}: ActivityPanelAutoExpandInput): boolean {
  return !alreadyAutoOpened
    && pageSettled
    && restoreComplete
    && currentLiveTeamIds.some((teamId) => !previousLiveTeamIds.has(teamId))
}

/**
 * Resolve the task whose dependency chain should be highlighted.
 *
 * A pinned task is an explicit user choice. Keyboard focus takes precedence
 * over delayed pointer intent so an older hover timer cannot steal the active
 * chain from someone navigating the task map with the keyboard.
 */
export function dependencyFocusTaskId(
  pinnedTaskId: string | null,
  keyboardTaskId: string | null,
  hoverTaskId: string | null,
): string | null {
  return pinnedTaskId ?? keyboardTaskId ?? hoverTaskId
}

/** Group tasks by their precomputed dependency depth. */
export function taskStages<T extends RelationshipTask>(tasks: readonly T[]): readonly RelationshipStage<T>[] {
  const byDepth = new Map<number, T[]>()
  for (const task of tasks) {
    const depth = Number.isFinite(task.depth) ? Math.max(0, Math.floor(task.depth)) : 0
    const stage = byDepth.get(depth) ?? []
    stage.push(task)
    byDepth.set(depth, stage)
  }
  return [...byDepth.entries()]
    .sort(([left], [right]) => left - right)
    .map(([depth, stageTasks]) => ({
      depth,
      tasks: stageTasks.slice().sort((left, right) => left.id.localeCompare(right.id, 'en', { numeric: true })),
    }))
}

/**
 * Lay tasks out as the reference panel's compact left-to-right DAG.
 *
 * Columns are dependency-depth stages. Rows are stable task-id order within
 * each stage. Edges use cubic curves so fan-in remains readable without
 * turning every task into a large card.
 */
export function compactDagLayout<T extends RelationshipTask>(tasks: readonly T[]): CompactDagLayout<T> {
  const stages = taskStages(tasks)
  const positions = new Map<string, { x: number; y: number }>()
  const nodes: CompactDagNode<T>[] = []
  for (const [column, stage] of stages.entries()) {
    for (const [row, task] of stage.tasks.entries()) {
      const x = column * (COMPACT_DAG_NODE_WIDTH + COMPACT_DAG_COLUMN_GAP)
      const y = row * (COMPACT_DAG_NODE_HEIGHT + COMPACT_DAG_ROW_GAP)
      positions.set(task.id, { x, y })
      nodes.push({ task, x, y })
    }
  }
  const edges: CompactDagEdge[] = []
  for (const task of tasks) {
    const target = positions.get(task.id)
    if (target === undefined) continue
    for (const dependency of task.dependencies) {
      const source = positions.get(dependency)
      if (source === undefined) continue
      const x1 = source.x + COMPACT_DAG_NODE_WIDTH
      const y1 = source.y + COMPACT_DAG_NODE_HEIGHT / 2
      const x2 = target.x
      const y2 = target.y + COMPACT_DAG_NODE_HEIGHT / 2
      edges.push({
        from: dependency,
        to: task.id,
        path: `M${x1} ${y1}C${x1 + 14} ${y1},${x2 - 14} ${y2},${x2} ${y2}`,
      })
    }
  }
  const rows = Math.max(1, ...stages.map((stage) => stage.tasks.length))
  return {
    width: stages.length === 0
      ? 0
      : stages.length * COMPACT_DAG_NODE_WIDTH + (stages.length - 1) * COMPACT_DAG_COLUMN_GAP,
    height: stages.length === 0
      ? 0
      : rows * COMPACT_DAG_NODE_HEIGHT + (rows - 1) * COMPACT_DAG_ROW_GAP,
    nodes,
    edges,
  }
}

/**
 * Return the complete upstream/downstream chain around one task.
 *
 * Traversal uses both dependency directions and remains cycle-safe, so the UI
 * can highlight every handoff related to the focused task even if malformed
 * durable data contains a cycle.
 */
export function relatedTaskIds(taskId: string, tasks: readonly RelationshipTask[]): ReadonlySet<string> {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  if (!byId.has(taskId)) return new Set()
  const dependents = new Map<string, string[]>()
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      const targets = dependents.get(dependency) ?? []
      targets.push(task.id)
      dependents.set(dependency, targets)
    }
  }
  const related = new Set<string>()
  const upstreamSeen = new Set<string>()
  const downstreamSeen = new Set<string>()
  const visitUpstream = (id: string): void => {
    if (upstreamSeen.has(id)) return
    upstreamSeen.add(id)
    related.add(id)
    for (const dependency of byId.get(id)?.dependencies ?? []) visitUpstream(dependency)
  }
  const visitDownstream = (id: string): void => {
    if (downstreamSeen.has(id)) return
    downstreamSeen.add(id)
    related.add(id)
    for (const dependent of dependents.get(id) ?? []) visitDownstream(dependent)
  }
  visitUpstream(taskId)
  visitDownstream(taskId)
  return related
}
