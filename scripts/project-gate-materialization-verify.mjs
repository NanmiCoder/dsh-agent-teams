import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const sourceMode = process.env.DSH_SOURCE_VALIDATE === '1'
const libRoot = sourceMode ? join(process.cwd(), 'src') : (process.env.DSH_VALIDATION_LIB ?? join(process.cwd(), 'lib'))
const load = (name) => import(pathToFileURL(join(libRoot, sourceMode && name.endsWith('.js') ? name.slice(0, -3) + '.ts' : name)).href)

const project = await load('project.js')
const state = await load('state.js')
const toolsModule = await load('tools.js')

let passed = 0
let failed = 0
function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log('  PASS  ' + label)
  } else {
    failed += 1
    console.error('  FAIL  ' + label + (detail ? ': ' + detail : ''))
  }
}

async function rejects(label, operation, expected = undefined) {
  try {
    await operation()
    check(label, false, 'operation unexpectedly succeeded')
    return false
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const matches = expected === undefined || expected.test(message)
    check(label, matches, matches ? '' : 'unexpected error: ' + message)
    return matches
  }
}

function toolExecutor(tool) {
  if (tool === undefined) throw new Error('tool registration returned no tool')
  if (typeof tool.execute === 'function') return (input, context) => tool.execute(input, context)
  if (typeof tool.handler === 'function') return (input, context) => tool.handler(input, context)
  if (typeof tool.callback === 'function') return (input, context) => tool.callback(input, context)
  throw new Error('registered tool has no execute/handler/callback function: ' + Object.keys(tool).join(', '))
}

function pickTool(registry, ...names) {
  for (const name of names) {
    const tool = registry.get(name)
    if (tool !== undefined) return tool
  }
  throw new Error('missing required tool; tried: ' + names.join(', ') + '; registered: ' + [...registry.keys()].join(', '))
}

function captainContext(root, id) {
  return {
    agent: { id, session: { header: { cwd: root } } },
    logger: console,
  }
}

function approvedProjectState(root) {
  const value = project.createInitialProjectState({
    id: 'materialization-project',
    title: 'Materialization regression',
    goal: 'Verify project gate binding reaches durable team state',
    mode: 'greenfield',
    now: 1,
  })
  value.requirement = {
    id: 'req-materialization',
    title: 'Bound requirement',
    statement: 'Persist and enforce project task binding',
    scope: ['project task creation'],
    outOfScope: [],
    acceptanceCriteria: ['binding survives reload'],
    clarificationIds: [],
    riskIds: [],
    status: 'approved',
    version: 1,
    updatedAt: 1,
    approvalDecision: {
      actor: 'materialization-user',
      source: 'host_user',
      mode: 'host_capability',
      timestamp: 1,
      targetVersion: 1,
      sessionId: 'materialization-captain',
      userId: 'materialization-user',
      projectId: 'materialization-project',
      decisionType: 'requirement_approve',
      capabilityId: 'materialization-requirement-approval',
      contentHash: 'materialization-requirement-hash',
      issuedAt: 0,
      expiresAt: 999999,
    },
  }
  value.design = {
    id: 'design-materialization',
    title: 'Bound design',
    summary: 'Use the durable team record as the execution binding',
    architecture: ['tool layer', 'durable state'],
    moduleBoundaries: ['project gate'],
    interfaces: ['agent tools'],
    dataModel: ['team.json'],
    tradeoffs: ['legacy compatibility remains available without a project'],
    migrationStrategy: ['none'],
    testStrategy: ['materialization regression'],
    requirementId: 'req-materialization',
    status: 'approved',
    version: 1,
    updatedAt: 1,
    approvalDecision: {
      actor: 'materialization-user',
      source: 'host_user',
      mode: 'host_capability',
      timestamp: 1,
      targetVersion: 1,
      sessionId: 'materialization-captain',
      userId: 'materialization-user',
      projectId: 'materialization-project',
      decisionType: 'design_approve',
      capabilityId: 'materialization-design-approval',
      contentHash: 'materialization-design-hash',
      issuedAt: 0,
      expiresAt: 999999,
    },
  }
  return project.writeProjectState(root, value).then(() => value)
}

async function readRawTeam(root, teamId) {
  return JSON.parse(await readFile(join(root, '.agent-teams', teamId, 'team.json'), 'utf8'))
}

async function main() {
  const registered = new Map()
  const registrationHost = {
    tools: { register(tool) { registered.set(tool.name, tool) } },
    logger: console,
    agents: new Map(),
    subagents: {
      registerContinuableSetup() {},
      getProvider() { return undefined },
      list() { return [] },
      startContinuable() { throw new Error('member spawning is not part of this materialization regression') },
      followup() { throw new Error('member follow-up is not part of this materialization regression') },
      interrupt() {},
    },
    effect(setup) {
      const cleanup = setup()
      return typeof cleanup === 'function' ? cleanup : () => {}
    },
    on() {
      return () => {}
    },
  }
  const register = toolsModule.registerTools ?? toolsModule.registerAgentTeamsTools ?? toolsModule.registerAgentTeamTools
  if (typeof register !== 'function') {
    throw new Error('could not find the AgentTeams tool registration export; exports: ' + Object.keys(toolsModule).join(', '))
  }
  const registrationConfig = {
    stateDir: '.agent-teams',
    logger: console,
    tools: registrationHost.tools,
  }
  await register(registrationHost, registrationConfig)

  const createTeam = toolExecutor(pickTool(registered, 'agent_teams_create', 'agent_teams_create_team'))
  const createTask = toolExecutor(pickTool(registered, 'agent_teams_create_task'))
  const claimTask = toolExecutor(pickTool(registered, 'agent_teams_claim_task', 'agent_teams_claim'))
  const updateTask = toolExecutor(pickTool(registered, 'agent_teams_update_task', 'agent_teams_update'))

  const root = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-materialization-'))
  const legacyRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-materialization-legacy-'))
  try {
    await approvedProjectState(root)
    const captain = captainContext(root, 'materialization-captain')
    const createTeamResult = await createTeam({ name: 'Materialization team', description: 'Project binding regression' }, captain)
    const teamId = createTeamResult?.teamId ?? createTeamResult?.id ?? (await state.findTeamByCaptain(join(root, '.agent-teams'), 'materialization-captain'))?.id
    if (typeof teamId !== 'string' || teamId === '') throw new Error('team creation returned no team id: ' + JSON.stringify(createTeamResult))

    const implementationInput = {
      subject: 'Bound implementation',
      kind: 'implementation',
      objective: 'Create a task whose project binding is durable',
      acceptance: ['binding is persisted and reloadable'],
      inScope: ['src/'],
      verify: ['node --version'],
      projectId: 'materialization-project',
      requirementId: 'req-materialization',
      requirementVersion: 1,
      designId: 'design-materialization',
      designVersion: 1,
    }
    const firstTaskResult = await createTask(implementationInput, captain)
    const secondTaskResult = await createTask({ ...implementationInput, subject: 'Stale implementation', inScope: ['scripts/feature-b.ts'] }, captain)
    const rawTeamAfterCreate = await readRawTeam(root, teamId)
    const boundTasks = rawTeamAfterCreate.tasks.filter((task) => task.kind === 'implementation')
    check(
      'project task creation materializes the complete binding in team.json',
      rawTeamAfterCreate.projectId === 'materialization-project'
        && rawTeamAfterCreate.projectRequirementId === 'req-materialization'
        && rawTeamAfterCreate.projectRequirementVersion === 1
        && rawTeamAfterCreate.projectDesignId === 'design-materialization'
        && rawTeamAfterCreate.projectDesignVersion === 1
        && boundTasks.length >= 2
        && boundTasks.every((task) => task.projectId === 'materialization-project'
          && task.requirementId === 'req-materialization'
          && task.requirementVersion === 1
          && task.designId === 'design-materialization'
          && task.designVersion === 1),
      JSON.stringify({ team: rawTeamAfterCreate, firstTaskResult, secondTaskResult }),
    )

    await rejects(
      'a project-bound team rejects kind=work',
      () => createTask({ subject: 'Unbound work disguised as project work', kind: 'work' }, captain),
      /project|binding|kind|legacy|implementation/i,
    )

    const legacyCaptain = captainContext(legacyRoot, 'legacy-captain')
    const legacyTeamResult = await createTeam({ name: 'Legacy team', description: 'Legacy compatibility regression' }, legacyCaptain)
    const legacyTeamId = legacyTeamResult?.teamId ?? legacyTeamResult?.id ?? (await state.findTeamByCaptain(join(legacyRoot, '.agent-teams'), 'legacy-captain'))?.id
    if (typeof legacyTeamId !== 'string' || legacyTeamId === '') throw new Error('legacy team creation returned no team id: ' + JSON.stringify(legacyTeamResult))
    const legacyTaskResult = await createTask({ subject: 'Legacy work', kind: 'work' }, legacyCaptain)
    const rawLegacyTeam = await readRawTeam(legacyRoot, legacyTeamId)
    check(
      'an unbound Legacy team still accepts kind=work',
      rawLegacyTeam.projectId === undefined
        && rawLegacyTeam.tasks.some((task) => task.kind === 'work' && task.subject === 'Legacy work')
        && legacyTaskResult !== undefined,
      JSON.stringify({ team: rawLegacyTeam, task: legacyTaskResult }),
    )

    const boundTaskIds = boundTasks.map((task) => task.id)
    if (boundTaskIds.length < 2) throw new Error('expected two bound implementation tasks for stale claim/update checks')
    const projectState = await project.readProjectState(root)
    projectState.requirement = { ...projectState.requirement, version: 2, updatedAt: 2 }
    projectState.design = { ...projectState.design, version: 2, updatedAt: 2 }
    await project.writeProjectState(root, projectState)

    const staleError = /stale|invalid|binding|version|project context|approved/i
    await rejects(
      'old-version project task claim fails closed',
      () => claimTask({ taskId: boundTaskIds[0] }, captain),
      staleError,
    )
    await rejects(
      'old-version project task update fails closed',
      () => updateTask({ taskId: boundTaskIds[1], status: 'in_progress' }, captain),
      staleError,
    )

    const rawTeamAfterStaleAttempts = await readRawTeam(root, teamId)
    const staleTasks = rawTeamAfterStaleAttempts.tasks.filter((task) => boundTaskIds.includes(task.id))
    check(
      'failed stale claim/update do not mutate the durable task records',
      staleTasks.length === 2 && staleTasks.every((task) => task.status === 'pending' && task.requirementVersion === 1 && task.designVersion === 1),
      JSON.stringify(staleTasks),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(legacyRoot, { recursive: true, force: true })
  }
}

try {
  await main()
} catch (error) {
  failed += 1
  console.error('  FAIL  materialization harness: ' + (error instanceof Error ? error.stack : String(error)))
}

console.log('project-gate-materialization-verify: ' + passed + ' passed, ' + failed + ' failed')
if (failed > 0) process.exit(1)
