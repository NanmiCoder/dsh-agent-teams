/** Project-level tools for long-lived software engineering work. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, win32 } from 'node:path'
import { readTeam } from './state.ts'
import { buildCoverageMatrix, canDeclareDelivery, projectTaskBindingError } from './quality-gates.ts'
import {
  DEFAULT_PROJECT_STATE_DIR,
  assertImplementationPlanningAllowed,
  assertProjectTeamBinding,
  consumeProjectDecisionCapability,
  createInitialProjectState,
  discoverProject,
  projectDecisionContentHash,
  projectGateSummary,
  projectWorkItemStatusFromTeam,
  createProjectStateIfAbsent,
  readProjectState,
  summarizeProjectState,
  updateProjectState,
  validateProjectDecisionCapability,
  writeProjectState,
  type ProjectState,
  type ProjectDecisionCapabilityClaims,
  type ProjectDecisionCapabilityProvider,
  type ProjectDecisionCapabilityRequest,
  type ProjectDecisionMetadata,
  type ProjectWorkItem,
  type ProjectWorkItemStatus,
} from './project.ts'

function canonicalExistingPath(value: string, label: string): string {
  try {
    return realpathSync.native(value)
  } catch (error: unknown) {
    throw new Error(label + ' must be an existing accessible directory: ' + String(error))
  }
}

function isContainedPath(root: string, candidate: string): boolean {
  // realpathSync.native() gives canonical paths. On Windows, normalize
  // separators and drive-letter case before checking the descendant boundary.
  const rootKey = process.platform === 'win32' ? win32.normalize(root).toLowerCase() : resolve(root)
  const candidateKey = process.platform === 'win32' ? win32.normalize(candidate).toLowerCase() : resolve(candidate)
  const relativePath = process.platform === 'win32'
    ? win32.relative(rootKey, candidateKey)
    : relative(rootKey, candidateKey)
  const normalizedRelative = relativePath.replace(/\\/gu, '/')
  return normalizedRelative === ''
    || (!isAbsolute(relativePath)
      && !win32.isAbsolute(relativePath)
      && normalizedRelative !== '..'
      && !normalizedRelative.startsWith('../'))
}

/** Resolve a project root only inside the canonical session workspace. */
export function projectRootOf(input: string | undefined, exec: ToolRunContext): string {
  const workspaceValue = exec.agent?.session.header.cwd
  if (typeof workspaceValue !== 'string' || workspaceValue.trim() === '') {
    throw new Error('project root authorization requires a trusted session workspace')
  }
  const workspaceInput = workspaceValue.trim()
  if (!isAbsolute(workspaceInput) && !win32.isAbsolute(workspaceInput)) {
    throw new Error('project root authorization requires an absolute session workspace')
  }

  const workspace = canonicalExistingPath(workspaceInput, 'session workspace')
  const explicit = input?.trim()
  if (explicit === undefined || explicit === '') return workspace
  if (explicit.includes('\0')) throw new Error('project_root must not contain NUL characters')
  if (explicit.split(/[\\/]+/u).some((segment) => segment === '..')) {
    throw new Error('project_root must not contain parent traversal segments')
  }
  // Drive-relative paths such as C:folder are ambiguous on Windows and must
  // not be interpreted relative to an inherited process drive/current dir.
  if (/^[A-Za-z]:/u.test(explicit) && !win32.isAbsolute(explicit) && !isAbsolute(explicit)) {
    throw new Error('project_root must not be a drive-relative path')
  }

  const candidateInput = isAbsolute(explicit) || win32.isAbsolute(explicit)
    ? explicit
    : resolve(workspace, explicit)
  const candidate = canonicalExistingPath(candidateInput, 'project_root')
  if (!isContainedPath(workspace, candidate)) {
    throw new Error('project_root must remain inside the canonical session workspace')
  }
  return candidate
}

function projectResult(root: string, state: ProjectState): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify({
    project_root: root,
    project: {
      id: state.id,
      title: state.title,
      goal: state.goal,
      lifecycle: state.lifecycle,
      phase: state.phase,
      context: state.context,
      requirement: state.requirement,
      clarifications: state.clarifications ?? [],
      design: state.design,
      milestones: state.milestones,
      work_items: state.workItems,
      decisions: state.decisions,
      risks: state.risks,
      updated_at: state.updatedAt,
    },
    gates: projectGateSummary(state),
    summary: summarizeProjectState(state),
  })) as Record<string, JsonValue>
}

function jsonObject(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>
}

/** Build an actionable project-management report from durable state and live team projections. */
export function projectReportDetails(
  state: ProjectState,
  executionLinks: readonly Record<string, JsonValue>[] = [],
): Record<string, JsonValue> {
  const summary = summarizeProjectState(state)
  const workItemsByStatus = Object.fromEntries(
    Object.keys(summary.counts).map((status) => [status, state.workItems.filter((item) => item.status === status)]),
  )
  return jsonObject({
    work_items_by_status: workItemsByStatus,
    pending_decisions: state.decisions.filter((decision) => decision.status === 'pending'),
    open_clarifications: (state.clarifications ?? []).filter((clarification) => clarification.status === 'open'),
    risks: state.risks,
    execution_links: executionLinks,
  })
}

/** Build the read-only Web payload for one registered workspace project. */
export async function projectWorkspaceSnapshot(
  projectRoot: string,
  workspaceTitle: string,
  teamStateDir = '.agent-teams',
): Promise<Record<string, JsonValue> | undefined> {
  const state = await readProjectState(projectRoot, DEFAULT_PROJECT_STATE_DIR)
  if (state === undefined) return undefined
  let executionLinks: Array<Record<string, JsonValue>> = []
  try {
    executionLinks = await projectExecutionLinks(projectRoot, state, teamStateDir)
  } catch {
    // A malformed or unavailable team run must not hide the durable project.
  }
  return jsonObject({
    workspace: workspaceTitle,
    status: state,
    report: projectReportDetails(state, executionLinks),
    execution_links: executionLinks,
  })
}

function validateTeamStateDir(teamStateDir: string): void {
  if (teamStateDir.trim() === '' || teamStateDir.split(/[\/]/u).includes('..') || /^[A-Za-z]:[\/]/u.test(teamStateDir) || teamStateDir.startsWith('/') || teamStateDir.startsWith('\\')) {
    throw new Error('team_state_dir must be a non-empty relative path below the project workspace')
  }
}

/** Read live execution projections for every project work item linked to a team. */
export async function projectExecutionLinks(
  projectRoot: string,
  state: ProjectState,
  teamStateDir = '.agent-teams',
): Promise<Array<Record<string, JsonValue>>> {
  const teamStateRoot = resolve(projectRoot, teamStateDir)
  const links: Array<Record<string, JsonValue>> = []
  for (const item of state.workItems) {
    if (item.teamId === undefined) continue
    const taskIds = item.taskIds ?? []
    let team: Awaited<ReturnType<typeof readTeam>>
    try {
      team = await readTeam(teamStateRoot, item.teamId)
    } catch {
      links.push({
        work_item_id: item.id,
        team_id: item.teamId,
        task_ids: taskIds,
        team_found: false,
        team_state_error: 'corrupt',
        task_count: 0,
        completed_task_count: 0,
        projected_status: 'blocked',
      })
      continue
    }
    if (team === undefined) {
      links.push({
        work_item_id: item.id,
        team_id: item.teamId,
        task_ids: taskIds,
        team_found: false,
        team_state_error: 'missing',
        link_status: 'link_invalid',
        task_count: 0,
        completed_task_count: 0,
        projected_status: 'blocked',
      })
      continue
    }
    try {
      if (team.projectId === undefined) throw new Error('project Work Item points to an unbound Legacy Team')
      assertProjectTeamBinding(state, team)
    } catch (error) {
      links.push({
        work_item_id: item.id,
        team_id: item.teamId,
        task_ids: taskIds,
        team_found: true,
        team_state_error: 'binding_invalid',
        link_status: 'link_invalid',
        binding_error: error instanceof Error ? error.message : String(error),
        team_halted: team.halted === true,
        task_count: 0,
        completed_task_count: 0,
        projected_status: 'blocked',
      })
      continue
    }
    const selected = taskIds.length === 0 ? team.tasks : team.tasks.filter((task) => taskIds.includes(task.id))
    const missingTaskIds = taskIds.filter((taskId) => !team.tasks.some((task) => task.id === taskId))
    const taskBindingError = selected.map((task) => projectTaskBindingError(team, task)).find((error) => error !== undefined)
    const linkInvalid = missingTaskIds.length > 0 || taskBindingError !== undefined
    links.push({
      work_item_id: item.id,
      team_id: item.teamId,
      task_ids: taskIds,
      team_found: true,
      link_status: linkInvalid ? 'link_invalid' : 'linked',
      ...(missingTaskIds.length === 0 ? {} : { missing_task_ids: missingTaskIds }),
      ...(taskBindingError === undefined ? {} : { task_state_error: taskBindingError }),
      team_halted: team.halted === true,
      task_count: selected.length,
      completed_task_count: selected.filter((task) => task.status === 'completed').length,
      projected_status: linkInvalid ? 'blocked' : projectWorkItemStatusFromTeam(team, taskIds),
    })
  }
  return links
}

/** Create or refresh the durable project link for a team when a team is created. */
export async function ensureProjectWorkItemForTeam(
  projectRoot: string,
  teamId: string,
  title: string,
  taskIds: readonly string[] = [],
): Promise<ProjectState | undefined> {
  const current = await readProjectState(projectRoot, DEFAULT_PROJECT_STATE_DIR)
  if (current === undefined) return undefined
  const uniqueTaskIds = [...new Set(taskIds)]
  return updateProjectState(projectRoot, (state) => {
    let item = state.workItems.find((candidate) => candidate.teamId === teamId)
    if (item === undefined) {
      item = state.workItems.find((candidate) => candidate.id === 'team-' + teamId)
    }
    if (item === undefined) {
      item = {
        id: 'team-' + teamId,
        title: title.trim() || teamId,
        status: 'not_started',
        requirementId: state.requirement?.id,
        designId: state.design?.id,
        teamId,
        taskIds: uniqueTaskIds,
        updatedAt: Date.now(),
      }
      state.workItems.push(item)
    } else {
      if (item.teamId !== undefined && item.teamId !== teamId) {
        throw new Error('project Work Item ' + item.id + ' is already linked to team ' + item.teamId)
      }
      item.teamId = teamId
      item.taskIds = uniqueTaskIds
      if (title.trim() !== '') item.title = title.trim()
      item.updatedAt = Date.now()
    }
    return state
  })
}

function stringValue(args: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = args[key]
  if (typeof value === 'string' && value.trim() !== '') return value
  if (required) throw new Error(key + ' must be a non-empty string')
  return undefined
}

function stringArrayValue(args: Record<string, unknown>, key: string): string[] {
  const value = args[key]
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && entry.trim() !== '')) {
    throw new Error(key + ' must be an array of non-empty strings')
  }
  return value.map((entry) => entry.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface ProjectToolsOptions {
  /** Host adapter backed by a real user-confirmation event/token. */
  decisionCapabilityProvider?: ProjectDecisionCapabilityProvider
}

interface ResolvedProjectDecision {
  metadata: ProjectDecisionMetadata
  claims?: ProjectDecisionCapabilityClaims
}

async function projectDecisionOf(
  args: Record<string, unknown>,
  exec: ToolRunContext,
  provider: ProjectDecisionCapabilityProvider | undefined,
  request: ProjectDecisionCapabilityRequest,
  allowLegacyCompatibility: boolean,
): Promise<ResolvedProjectDecision> {
  const agent = exec.agent
  const parentSession = agent?.session.header.parentSession
  if (agent === undefined || (typeof parentSession === 'string' && parentSession.trim() !== '')) {
    throw new Error('only the top-level Captain session may record a project decision')
  }
  if (typeof agent.id !== 'string' || agent.id.trim() === '') {
    throw new Error('Captain session has no stable actor id; project decision rejected')
  }
  if (provider !== undefined) {
    const claims = await provider.verify(request, { sessionId: agent.id, execution: agent.session })
    if (claims === undefined) throw new Error('trusted user confirmation is absent; long-lived project decision is fail-closed')
    const errors = validateProjectDecisionCapability(claims, request, request.now)
    if (errors.length > 0) throw new Error('trusted user confirmation rejected: ' + errors.join('; '))
    return {
      claims,
      metadata: {
        actor: claims.userId,
        source: 'host_user',
        mode: 'host_capability',
        timestamp: request.now,
        targetVersion: claims.targetVersion,
        sessionId: claims.sessionId,
        userId: claims.userId,
        projectId: claims.projectId,
        decisionType: claims.decisionType,
        capabilityId: claims.capabilityId,
        contentHash: claims.contentHash,
        issuedAt: claims.issuedAt,
        expiresAt: claims.expiresAt,
      },
    }
  }
  if (!allowLegacyCompatibility) throw new Error('trusted host user-confirmation adapter is unavailable; long-lived project decision is fail-closed')
  const rawDecision = args.decision
  if (!isRecord(rawDecision) || rawDecision.source !== 'legacy_compat') {
    throw new Error('legacy compatibility requires decision.source=legacy_compat and is not delivery evidence')
  }
  const targetVersion = rawDecision.target_version
  if (typeof targetVersion !== 'number' || !Number.isSafeInteger(targetVersion) || targetVersion < 1 || targetVersion !== request.targetVersion) {
    throw new Error('legacy decision.target_version must match the current target version (' + request.targetVersion + ')')
  }
  const rationale = typeof rawDecision.rationale === 'string' && rawDecision.rationale.trim() !== '' ? rawDecision.rationale.trim() : undefined
  return {
    metadata: {
      actor: agent.id,
      source: 'legacy_captain',
      mode: 'legacy_compat',
      timestamp: request.now,
      targetVersion,
      sessionId: agent.id,
      ...(rationale === undefined ? {} : { rationale }),
    },
  }
}

async function assertWorkItemCaptain(
  root: string,
  item: ProjectWorkItem,
  decision: ProjectDecisionMetadata,
  exec: ToolRunContext,
  teamStateDir: string,
): Promise<void> {
  if (item.teamId === undefined) return
  validateTeamStateDir(teamStateDir)
  const team = await readTeam(join(root, teamStateDir), item.teamId)
  if (team === undefined) throw new Error('linked AgentTeams team not found: ' + item.teamId)
  if (team.captainSessionId !== decision.sessionId || team.captainSessionId !== exec.agent?.id) {
    throw new Error('only the linked team Captain may record acceptance or delivery')
  }
}

/** One project-level gate for acceptance and delivery. */
export async function projectAcceptanceCheck(
  root: string,
  state: ProjectState,
  item: ProjectWorkItem,
  teamStateDir = '.agent-teams',
): Promise<Record<string, unknown>> {
  validateTeamStateDir(teamStateDir)
  const blockers: string[] = []
  const gates = projectGateSummary(state)
  if (!gates.canPlanImplementation && item.teamId !== undefined) blockers.push('approved requirements and design are required')

  let teamResult: Record<string, unknown> = { linked: false }
  if (item.teamId === undefined) {
    // Explicit legacy compatibility: an unlinked pre-Team Work Item may keep
    // its old transition semantics, but its legacy decision metadata is not
    // evidence for a long-lived project implementation gate.
    teamResult = { linked: false, legacy: true }
  } else {
    const team = await readTeam(join(root, teamStateDir), item.teamId)
    if (team === undefined) {
      blockers.push('linked AgentTeams team not found: ' + item.teamId)
      teamResult = { linked: true, found: false, team_id: item.teamId }
    } else {
      const taskIds = item.taskIds ?? []
      const selectedTasks = taskIds.length === 0 ? team.tasks : team.tasks.filter((task) => taskIds.includes(task.id))
      const missingTaskIds = taskIds.filter((taskId) => !team.tasks.some((task) => task.id === taskId))
      if (missingTaskIds.length > 0) blockers.push('linked task(s) not found: ' + missingTaskIds.join(', '))
      const selectedTeam = taskIds.length === 0 ? team : { ...team, tasks: selectedTasks }
      const delivery = canDeclareDelivery(selectedTeam)
      if (!delivery.ok) blockers.push(...delivery.blockers.map((blocker) => 'team quality gate: ' + blocker))
      const goalItems = state.requirement?.acceptanceCriteria ?? []
      if (goalItems.length === 0) blockers.push('approved requirements must include acceptance criteria')
      const coverage = buildCoverageMatrix(goalItems, selectedTasks)
      for (const row of coverage) {
        if (row.status !== 'passed') blockers.push('coverage ' + row.goal_item + ': ' + row.status)
      }
      teamResult = { linked: true, found: true, team_id: item.teamId, task_ids: taskIds, delivery, coverage }
    }
  }
  return { ok: blockers.length === 0, blockers, gates, team: teamResult }
}

/** Register project initialization and status tools without touching team state. */
export function registerProjectTools(ctx: Context, options: ProjectToolsOptions = {}): void {
  const decisionCapabilityProvider = options.decisionCapabilityProvider
  ctx.tools.register(defineTool({
    name: 'agent_project_init',
    description: 'Initialize the long-lived software project context for the current workspace. Use this before requirements or implementation work. Detects Greenfield versus Brownfield and persists project status separately from AgentTeams run state.',
    parameters: {
      id: { type: 'string', required: true },
      title: { type: 'string', required: true },
      goal: { type: 'string', required: true },
      project_root: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const rawArgs = args as Record<string, unknown>
      const root = projectRootOf(stringValue(rawArgs, 'project_root'), exec)
      const existing = await readProjectState(root, DEFAULT_PROJECT_STATE_DIR)
      if (existing !== undefined) return jsonObject({ status: 'already_initialized', ...projectResult(root, existing) })

      const discovery = await discoverProject(root)
      const state = createInitialProjectState({
        id: stringValue(rawArgs, 'id', true)!,
        title: stringValue(rawArgs, 'title', true)!,
        goal: stringValue(rawArgs, 'goal', true)!,
        mode: discovery.mode,
        discovery,
      })
      state.context.summary = discovery.mode === 'greenfield'
        ? 'Empty workspace detected; establish the initial project architecture before implementation.'
        : 'Existing workspace detected; inspect the current architecture and constraints before implementation.'
      state.context.constraints = discovery.hasGit
        ? ['Git repository detected; preserve existing history and conventions.']
        : []
      await writeProjectState(root, state, DEFAULT_PROJECT_STATE_DIR)
      return jsonObject({ status: 'initialized', discovery, ...projectResult(root, state) })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_project_status',
    description: 'Read the durable long-lived software project status and live execution projections for linked AgentTeams teams. Use it for progress reports and before deciding what to do next. Distinguishes implemented-but-not-accepted, accepted, delivered, blocked, waiting-for-user, and completed work.',
    parameters: {
      project_root: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const rawArgs = args as Record<string, unknown>
      const root = projectRootOf(stringValue(rawArgs, 'project_root'), exec)
      const state = await readProjectState(root, DEFAULT_PROJECT_STATE_DIR)
      if (state === undefined) return jsonObject({ status: 'not_initialized', project_root: root, discovery: await discoverProject(root) })
      const executionLinks = await projectExecutionLinks(root, state)
      return jsonObject({ status: 'ready', ...projectResult(root, state), execution_links: executionLinks, report: projectReportDetails(state, executionLinks) })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_project_report',
    description: 'Produce a project-management report from durable project state plus live linked AgentTeams execution: completed, in progress, blocked, waiting for user, failed, and not yet accepted work.',
    parameters: { project_root: { type: 'string' }, team_state_dir: { type: 'string' } },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const rawArgs = args as Record<string, unknown>
      const root = projectRootOf(stringValue(rawArgs, 'project_root'), exec)
      const state = await readProjectState(root, DEFAULT_PROJECT_STATE_DIR)
      if (state === undefined) return jsonObject({ status: 'not_initialized', project_root: root, discovery: await discoverProject(root) })
      const links = await projectExecutionLinks(root, state, stringValue(rawArgs, 'team_state_dir') ?? '.agent-teams')
      return jsonObject({ status: 'ready', generated_at: Date.now(), ...projectResult(root, state), execution_links: links, report: projectReportDetails(state, links) })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_project_clarification',
    description: 'Persist a clarification question or a user answer before requirements approval.',
    parameters: {
      project_root: { type: 'string' },
      action: { type: 'string', required: true },
      id: { type: 'string', required: true },
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' } },
      answer: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const rawArgs = args as Record<string, unknown>
      const root = projectRootOf(stringValue(rawArgs, 'project_root'), exec)
      const action = stringValue(rawArgs, 'action', true)!
      const id = stringValue(rawArgs, 'id', true)!
      const state = await updateProjectState(root, (current) => {
        const clarifications = current.clarifications ?? (current.clarifications = [])
        const existing = clarifications.find((item) => item.id === id)
        if (action === 'ask') {
          if (existing) throw new Error('clarification already exists: ' + id)
          clarifications.push({ id, question: stringValue(rawArgs, 'question', true)!, options: stringArrayValue(rawArgs, 'options'), status: 'open', askedAt: Date.now() })
          return current
        }
        if (!existing) throw new Error('clarification not found: ' + id)
        if (action === 'answer') {
          existing.answer = stringValue(rawArgs, 'answer', true)
          existing.status = 'answered'
          existing.answeredAt = Date.now()
          return current
        }
        if (action === 'dismiss') {
          existing.status = 'dismissed'
          return current
        }
        throw new Error('action must be ask, answer, or dismiss')
      })
      return jsonObject({ status: 'updated', ...projectResult(root, state) })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_project_requirement_update',
    description: 'Create or update the single requirements draft. Keep it as draft until the user explicitly confirms it.',
    parameters: {
      project_root: { type: 'string' },
      id: { type: 'string', required: true },
      title: { type: 'string', required: true },
      statement: { type: 'string', required: true },
      scope: { type: 'array', items: { type: 'string' } },
      out_of_scope: { type: 'array', items: { type: 'string' } },
      acceptance_criteria: { type: 'array', items: { type: 'string' } },
      clarification_ids: { type: 'array', items: { type: 'string' } },
      status: { type: 'string' },
      decision: { type: 'object', additionalProperties: false, properties: { source: { type: 'string' }, target_version: { type: 'number' }, rationale: { type: 'string' } } },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const rawArgs = args as Record<string, unknown>
      const root = projectRootOf(stringValue(rawArgs, 'project_root'), exec)
      const nextStatus = stringValue(rawArgs, 'status') ?? 'draft'
      if (!['draft', 'approved', 'rejected'].includes(nextStatus)) throw new Error('status must be draft, approved, or rejected')
      const existing = await readProjectState(root, DEFAULT_PROJECT_STATE_DIR)
      if (existing === undefined) throw new Error('project is not initialized; call agent_project_init first')
      const targetVersion = (existing.requirement?.version ?? 0) + 1
      const approvalRequest: ProjectDecisionCapabilityRequest = {
        projectId: existing.id,
        sessionId: exec.agent?.id ?? '',
        decisionType: 'requirement_approve',
        targetVersion,
        contentHash: projectDecisionContentHash({
          id: stringValue(rawArgs, 'id', true), title: stringValue(rawArgs, 'title', true), statement: stringValue(rawArgs, 'statement', true),
          scope: stringArrayValue(rawArgs, 'scope'), outOfScope: stringArrayValue(rawArgs, 'out_of_scope'),
          acceptanceCriteria: stringArrayValue(rawArgs, 'acceptance_criteria'),
          clarificationIds: rawArgs.clarification_ids === undefined ? (existing.requirement?.clarificationIds ?? []) : stringArrayValue(rawArgs, 'clarification_ids'),
          riskIds: existing.requirement?.riskIds ?? [], status: 'approved',
        }),
        now: Date.now(),
      }
      const approvalResolution = nextStatus === 'approved'
        ? await projectDecisionOf(rawArgs, exec, decisionCapabilityProvider, approvalRequest, false)
        : undefined
      const approvalDecision = approvalResolution?.metadata
      const state = await updateProjectState(root, (current) => {
        const previous = current.requirement
        const acceptanceCriteria = stringArrayValue(rawArgs, 'acceptance_criteria')
        const clarificationIds = rawArgs.clarification_ids === undefined
          ? undefined
          : stringArrayValue(rawArgs, 'clarification_ids')
        if (clarificationIds !== undefined) {
          const knownClarificationIds = new Set((current.clarifications ?? []).map((item) => item.id))
          const missingClarificationIds = clarificationIds.filter((id) => !knownClarificationIds.has(id))
          if (missingClarificationIds.length > 0) {
            throw new Error('clarification(s) not found: ' + missingClarificationIds.join(', '))
          }
        }
        if (nextStatus === 'approved' && acceptanceCriteria.length === 0) throw new Error('acceptance_criteria must not be empty when approving requirements')
        if (nextStatus === 'approved' && (current.clarifications ?? []).some((item) => item.status === 'open')) throw new Error('open clarifications must be answered or dismissed before approving requirements')
        const version = (previous?.version ?? 0) + 1
        if (approvalDecision !== undefined && approvalDecision.targetVersion !== version) throw new Error('requirements changed while recording the decision; retry')
        if (approvalResolution?.claims !== undefined) consumeProjectDecisionCapability(current, approvalResolution.claims, Date.now())
        current.requirement = {
          id: stringValue(rawArgs, 'id', true)!,
          title: stringValue(rawArgs, 'title', true)!,
          statement: stringValue(rawArgs, 'statement', true)!,
          scope: stringArrayValue(rawArgs, 'scope'),
          outOfScope: stringArrayValue(rawArgs, 'out_of_scope'),
          acceptanceCriteria,
          clarificationIds: clarificationIds ?? previous?.clarificationIds ?? [],
          riskIds: previous?.riskIds ?? [],
          status: nextStatus as 'draft' | 'approved' | 'rejected',
          version,
          updatedAt: Date.now(),
          ...(approvalDecision === undefined ? {} : { approvalDecision }),
        }
        if (current.design !== undefined) current.design = { ...current.design, status: 'draft', updatedAt: Date.now() }
        if (nextStatus === 'approved') current.phase = 'design'
        return current
      })
      return jsonObject({ status: 'updated', ...projectResult(root, state) })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_project_design_update',
    description: 'Create or update the single technical design draft. Approving it requires approved requirements and no open clarifications.',
    parameters: {
      project_root: { type: 'string' },
      id: { type: 'string', required: true },
      title: { type: 'string', required: true },
      summary: { type: 'string', required: true },
      architecture: { type: 'array', items: { type: 'string' } },
      module_boundaries: { type: 'array', items: { type: 'string' } },
      interfaces: { type: 'array', items: { type: 'string' } },
      data_model: { type: 'array', items: { type: 'string' } },
      tradeoffs: { type: 'array', items: { type: 'string' } },
      migration_strategy: { type: 'array', items: { type: 'string' } },
      test_strategy: { type: 'array', items: { type: 'string' } },
      status: { type: 'string' },
      decision: { type: 'object', additionalProperties: false, properties: { source: { type: 'string' }, target_version: { type: 'number' }, rationale: { type: 'string' } } },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const rawArgs = args as Record<string, unknown>
      const root = projectRootOf(stringValue(rawArgs, 'project_root'), exec)
      const nextStatus = stringValue(rawArgs, 'status') ?? 'draft'
      if (!['draft', 'approved', 'rejected'].includes(nextStatus)) throw new Error('status must be draft, approved, or rejected')
      const existing = await readProjectState(root, DEFAULT_PROJECT_STATE_DIR)
      if (existing === undefined) throw new Error('project is not initialized; call agent_project_init first')
      const targetVersion = (existing.design?.version ?? 0) + 1
      const approvalRequest: ProjectDecisionCapabilityRequest = {
        projectId: existing.id,
        sessionId: exec.agent?.id ?? '',
        decisionType: 'design_approve',
        targetVersion,
        contentHash: projectDecisionContentHash({
          id: stringValue(rawArgs, 'id', true), title: stringValue(rawArgs, 'title', true), summary: stringValue(rawArgs, 'summary', true),
          architecture: stringArrayValue(rawArgs, 'architecture'), moduleBoundaries: stringArrayValue(rawArgs, 'module_boundaries'), interfaces: stringArrayValue(rawArgs, 'interfaces'),
          dataModel: stringArrayValue(rawArgs, 'data_model'), tradeoffs: stringArrayValue(rawArgs, 'tradeoffs'), migrationStrategy: stringArrayValue(rawArgs, 'migration_strategy'),
          testStrategy: stringArrayValue(rawArgs, 'test_strategy'), requirementId: existing.requirement?.id, status: 'approved',
        }),
        now: Date.now(),
      }
      const approvalResolution = nextStatus === 'approved'
        ? await projectDecisionOf(rawArgs, exec, decisionCapabilityProvider, approvalRequest, false)
        : undefined
      const approvalDecision = approvalResolution?.metadata
      const state = await updateProjectState(root, (current) => {
        if (nextStatus === 'approved' && current.requirement?.status !== 'approved') throw new Error('requirements must be approved before approving design')
        if (nextStatus === 'approved' && (current.clarifications ?? []).some((item) => item.status === 'open')) throw new Error('open clarifications must be answered or dismissed before approving design')
        const previous = current.design
        const version = (previous?.version ?? 0) + 1
        if (approvalDecision !== undefined && approvalDecision.targetVersion !== version) throw new Error('design changed while recording the decision; retry')
        if (approvalResolution?.claims !== undefined) consumeProjectDecisionCapability(current, approvalResolution.claims, Date.now())
        current.design = {
          id: stringValue(rawArgs, 'id', true)!,
          title: stringValue(rawArgs, 'title', true)!,
          summary: stringValue(rawArgs, 'summary', true)!,
          architecture: stringArrayValue(rawArgs, 'architecture'),
          moduleBoundaries: stringArrayValue(rawArgs, 'module_boundaries'),
          interfaces: stringArrayValue(rawArgs, 'interfaces'),
          dataModel: stringArrayValue(rawArgs, 'data_model'),
          tradeoffs: stringArrayValue(rawArgs, 'tradeoffs'),
          migrationStrategy: stringArrayValue(rawArgs, 'migration_strategy'),
          testStrategy: stringArrayValue(rawArgs, 'test_strategy'),
          requirementId: current.requirement?.id,
          status: nextStatus as 'draft' | 'approved' | 'rejected',
          version,
          updatedAt: Date.now(),
          ...(approvalDecision === undefined ? {} : { approvalDecision }),
        }
        if (nextStatus === 'approved') current.phase = 'planning'
        return current
      })
      return jsonObject({ status: 'updated', ...projectResult(root, state) })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_project_gate',
    description: 'Check or enforce the requirements and design approval gate before implementation planning.',
    parameters: {
      project_root: { type: 'string' },
      action: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const rawArgs = args as Record<string, unknown>
      const root = projectRootOf(stringValue(rawArgs, 'project_root'), exec)
      const state = await readProjectState(root, DEFAULT_PROJECT_STATE_DIR)
      if (state === undefined) throw new Error('project is not initialized; call agent_project_init first')
      const action = stringValue(rawArgs, 'action') ?? 'check'
      const gates = projectGateSummary(state)
      if (action === 'assert_implementation_allowed') assertImplementationPlanningAllowed(state)
      else if (action !== 'check') throw new Error('action must be check or assert_implementation_allowed')
      return jsonObject({ status: 'ready', action, gates, ...projectResult(root, state) })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_project_work_item_update',
    description: 'Create or update one project work item and optionally link it to an AgentTeams team and task DAG. Use this after requirements/design approval to keep project progress traceable to execution.',
    parameters: {
      project_root: { type: 'string' },
      id: { type: 'string', required: true },
      title: { type: 'string', required: true },
      status: { type: 'string' },
      requirement_id: { type: 'string' },
      design_id: { type: 'string' },
      team_id: { type: 'string' },
      task_ids: { type: 'array', items: { type: 'string' } },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const rawArgs = args as Record<string, unknown>
      const root = projectRootOf(stringValue(rawArgs, 'project_root'), exec)
      const nextStatus = stringValue(rawArgs, 'status') ?? 'not_started'
      const allowedStatuses: readonly ProjectWorkItemStatus[] = [
        'not_started', 'in_progress', 'implemented_not_accepted', 'accepted', 'delivered', 'completed',
        'blocked', 'waiting_for_user', 'failed_verification', 'failed_review',
      ]
      if (!allowedStatuses.includes(nextStatus as ProjectWorkItemStatus)) throw new Error('invalid work item status: ' + nextStatus)
      if (nextStatus === 'accepted' || nextStatus === 'delivered') throw new Error('use agent_project_work_item_accept for the human acceptance boundary')
      const requirementId = stringValue(rawArgs, 'requirement_id')
      const designId = stringValue(rawArgs, 'design_id')
      const teamId = stringValue(rawArgs, 'team_id')
      const taskIds = rawArgs.task_ids === undefined ? undefined : stringArrayValue(rawArgs, 'task_ids')
      const state = await updateProjectState(root, (current) => {
        if (['in_progress', 'implemented_not_accepted', 'completed'].includes(nextStatus) && !projectGateSummary(current).canPlanImplementation) {
          throw new Error('work item execution requires approved requirements and design')
        }
        let item = current.workItems.find((candidate) => candidate.id === stringValue(rawArgs, 'id', true))
        if (item === undefined) {
          item = {
            id: stringValue(rawArgs, 'id', true)!,
            title: stringValue(rawArgs, 'title', true)!,
            status: nextStatus as ProjectWorkItemStatus,
            version: 1,
            updatedAt: Date.now(),
          }
          current.workItems.push(item)
        } else {
          item.title = stringValue(rawArgs, 'title', true)!
          item.status = nextStatus as ProjectWorkItemStatus
          item.version = (item.version ?? 1) + 1
          item.updatedAt = Date.now()
        }
        if (requirementId !== undefined) item.requirementId = requirementId
        if (designId !== undefined) item.designId = designId
        if (teamId !== undefined) item.teamId = teamId
        if (taskIds !== undefined) item.taskIds = [...new Set(taskIds)]
        return current
      })
      return jsonObject({ status: 'updated', ...projectResult(root, state) })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_project_work_item_sync',
    description: 'Read the linked AgentTeams team state and project its task DAG into the Work Item status. Completed implementation is reported as implemented_not_accepted until the user accepts it.',
    parameters: {
      project_root: { type: 'string' },
      id: { type: 'string', required: true },
      team_state_dir: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const rawArgs = args as Record<string, unknown>
      const root = projectRootOf(stringValue(rawArgs, 'project_root'), exec)
      const id = stringValue(rawArgs, 'id', true)!
      const teamStateDir = stringValue(rawArgs, 'team_state_dir') ?? '.agent-teams'
      validateTeamStateDir(teamStateDir)
      const current = await readProjectState(root, DEFAULT_PROJECT_STATE_DIR)
      if (current === undefined) throw new Error('project is not initialized; call agent_project_init first')
      const item = current.workItems.find((candidate) => candidate.id === id)
      if (item === undefined) throw new Error('work item not found: ' + id)
      if (item.teamId === undefined) throw new Error('work item is not linked to an AgentTeams team: ' + id)
      const team = await readTeam(join(root, teamStateDir), item.teamId)
      if (team === undefined) throw new Error('linked AgentTeams team not found: ' + item.teamId)
      const taskIds = item.taskIds ?? []
      const availableIds = new Set(team.tasks.map((task) => task.id))
      const missing = taskIds.filter((taskId) => !availableIds.has(taskId))
      if (missing.length > 0) throw new Error('linked task(s) not found: ' + missing.join(', '))
      const nextStatus = projectWorkItemStatusFromTeam(team, taskIds)
      const state = await updateProjectState(root, (next) => {
        const nextItem = next.workItems.find((candidate) => candidate.id === id)
        if (nextItem === undefined) throw new Error('work item disappeared during sync: ' + id)
        if (!['accepted', 'delivered', 'completed'].includes(nextItem.status)) nextItem.status = nextStatus
        nextItem.updatedAt = Date.now()
        return next
      })
      return jsonObject({ status: 'synced', work_item_id: id, team_id: item.teamId, task_ids: taskIds, projected_status: nextStatus, ...projectResult(root, state) })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_project_work_item_accept',
    description: 'Record the human acceptance boundary for an implemented project Work Item. Use action=accept after reviewing the implementation, then action=deliver when it is released or handed over. Execution completion never performs either transition automatically.',
    parameters: {
      project_root: { type: 'string' },
      id: { type: 'string', required: true },
      action: { type: 'string', required: true },
      note: { type: 'string' },
      team_state_dir: { type: 'string' },
      decision: { type: 'object', additionalProperties: false, properties: { source: { type: 'string' }, target_version: { type: 'number' }, rationale: { type: 'string' } } },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const rawArgs = args as Record<string, unknown>
      const root = projectRootOf(stringValue(rawArgs, 'project_root'), exec)
      const id = stringValue(rawArgs, 'id', true)!
      const action = stringValue(rawArgs, 'action', true)!
      const note = stringValue(rawArgs, 'note')
      const teamStateDir = stringValue(rawArgs, 'team_state_dir') ?? '.agent-teams'
      if (action !== 'accept' && action !== 'deliver') throw new Error('action must be accept or deliver')
      const current = await readProjectState(root, DEFAULT_PROJECT_STATE_DIR)
      if (current === undefined) throw new Error('project is not initialized; call agent_project_init first')
      const currentItem = current.workItems.find((candidate) => candidate.id === id)
      if (currentItem === undefined) throw new Error('work item not found: ' + id)
      const targetVersion = currentItem.version ?? 1
      const decisionRequest: ProjectDecisionCapabilityRequest = {
        projectId: current.id,
        sessionId: exec.agent?.id ?? '',
        decisionType: action === 'accept' ? 'work_item_accept' : 'work_item_deliver',
        targetVersion,
        contentHash: projectDecisionContentHash({
          workItemId: id, action, targetVersion, title: currentItem.title, status: currentItem.status,
          requirementId: currentItem.requirementId, designId: currentItem.designId, teamId: currentItem.teamId,
          taskIds: currentItem.taskIds ?? [], note: note ?? '',
        }),
        now: Date.now(),
      }
      const decisionResolution = await projectDecisionOf(rawArgs, exec, decisionCapabilityProvider, decisionRequest, currentItem.teamId === undefined)
      const decision = decisionResolution.metadata
      await assertWorkItemCaptain(root, currentItem, decision, exec, teamStateDir)
      if (action === 'accept' && !['implemented_not_accepted', 'accepted', 'completed'].includes(currentItem.status)) {
        throw new Error('work item must be implemented_not_accepted before acceptance: ' + currentItem.status)
      }
      if (action === 'deliver' && !['accepted', 'delivered'].includes(currentItem.status)) {
        throw new Error('work item must be accepted before delivery: ' + currentItem.status)
      }
      const acceptanceGate = await projectAcceptanceCheck(root, current, currentItem, teamStateDir)
      if (!acceptanceGate.ok) throw new Error('project acceptance gate blocked: ' + (acceptanceGate.blockers as string[]).join('; '))
      const state = await updateProjectState(root, (current) => {
        const item = current.workItems.find((candidate) => candidate.id === id)
        if (item === undefined) throw new Error('work item not found: ' + id)
        if ((item.version ?? 1) !== targetVersion) throw new Error('work item changed while recording the decision; retry with the new target_version')
        if (decisionResolution.claims !== undefined) consumeProjectDecisionCapability(current, decisionResolution.claims, Date.now())
        if (action === 'accept') {
          if (!['implemented_not_accepted', 'accepted', 'completed'].includes(item.status)) throw new Error('work item must be implemented_not_accepted before acceptance: ' + item.status)
          item.status = 'accepted'
          item.acceptedAt ??= decision.timestamp
          item.acceptanceDecision = decision
          if (note !== undefined) item.acceptanceNote = note
        } else {
          if (!['accepted', 'delivered'].includes(item.status)) throw new Error('work item must be accepted before delivery: ' + item.status)
          item.status = 'delivered'
          item.deliveredAt ??= decision.timestamp
          item.deliveryDecision = decision
          if (note !== undefined) item.acceptanceNote = note
        }
        item.version = (item.version ?? 1) + 1
        item.updatedAt = Date.now()
        return current
      })
      const executionLinks = await projectExecutionLinks(root, state)
      return jsonObject({ status: 'updated', action, decision, acceptance_gate: acceptanceGate, ...projectResult(root, state), execution_links: executionLinks, report: projectReportDetails(state, executionLinks) })
    },
  }))
}
