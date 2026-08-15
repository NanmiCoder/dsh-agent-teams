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

/**
 * Whether an expanded activity panel still belongs to the current session.
 *
 * The panel is mounted through a body portal, so React does not remount it
 * when the conversation route changes. Ownership keeps an expanded panel
 * from leaking onto the new-session screen (or another conversation) while
 * its local open state is being reset.
 */
export function activityPanelExpandedForSession(
  open: boolean,
  owner: string | undefined,
  current: string | undefined,
): boolean {
  return open && owner !== undefined && owner === current
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
