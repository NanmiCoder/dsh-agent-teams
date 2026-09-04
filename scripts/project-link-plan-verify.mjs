import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const project = await import('../lib/project.js')
const state = await import('../lib/state.js')
const toolsModule = await import('../lib/tools.js')

let passed = 0
function check(label, condition, detail = '') {
  if (!condition) throw new Error('FAIL: ' + label + (detail ? ': ' + detail : ''))
  passed += 1
}
async function rejects(label, operation, pattern) {
  try {
    await operation()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    check(label, pattern.test(message), message)
    return
  }
  throw new Error('FAIL: ' + label + ': operation unexpectedly succeeded')
}
function executor(tool) {
  if (typeof tool.execute === 'function') return tool.execute.bind(tool)
  if (typeof tool.handler === 'function') return tool.handler.bind(tool)
  if (typeof tool.callback === 'function') return tool.callback.bind(tool)
  throw new Error('tool has no executable callback')
}
function find(registry, name) {
  const tool = registry.get(name)
  if (tool === undefined) throw new Error('missing tool: ' + name)
  return executor(tool)
}
function captain(root, id) {
  return { agent: { id, session: { header: { cwd: root } } }, logger: console }
}
function member(root, id = 'engineer') {
  return { agent: { id, session: { header: { cwd: root } } }, logger: console }
}
function registerTools() {
  const registered = new Map()
  const host = {
    tools: { register(tool) { registered.set(tool.name, tool) } },
    logger: console,
    agents: new Map(),
    subagents: {
      registerContinuableSetup() {},
      getProvider() { return undefined },
      list() { return [] },
      startContinuable() { throw new Error('member spawning must not be reached') },
      followup() { throw new Error('followup is not part of this verification') },
      interrupt() {},
    },
    effect(setup) {
      const cleanup = setup()
      return typeof cleanup === 'function' ? cleanup : () => {}
    },
    on() { return () => {} },
  }
  toolsModule.registerAgentTeamsTools(host, {
    stateDir: '.agent-teams',
    memberProvider: 'spawn',
    maxMembers: 8,
    profiles: {},
    logger: console,
    tools: host.tools,
  })
  return registered
}
async function approvedProject(root) {
  const value = project.createInitialProjectState({
    id: 'link-project',
    title: 'Link project',
    goal: 'verify project Team association and staged gates',
    mode: 'greenfield',
    now: 1,
  })
  value.requirement = {
    id: 'req-link',
    title: 'Requirement',
    statement: 'Link Teams before execution',
    scope: ['execution'],
    outOfScope: [],
    acceptanceCriteria: ['the Team link is durable'],
    clarificationIds: [],
    riskIds: [],
    status: 'approved',
    version: 1,
    updatedAt: 1, approvalDecision: { actor: 'fixture-user', source: 'host_user', mode: 'host_capability', timestamp: 1, targetVersion: 1, sessionId: 'fixture-captain', userId: 'fixture-user', projectId: 'link-project', decisionType: 'requirement_approve', capabilityId: 'link-plan-requirement-approval', contentHash: 'link-plan-requirement-approval-hash', issuedAt: 0, expiresAt: 999999 },
  }
  value.design = {
    id: 'design-link',
    title: 'Design',
    summary: 'Fail closed until the Work Item link exists',
    architecture: ['tools'],
    moduleBoundaries: ['project link'],
    interfaces: ['AgentTeams tools'],
    dataModel: ['team.json', 'status.json'],
    tradeoffs: ['legacy compatibility remains available without a project'],
    migrationStrategy: ['none'],
    testStrategy: ['tool-level regression'],
    requirementId: 'req-link',
    status: 'approved',
    version: 1,
    updatedAt: 1, approvalDecision: { actor: 'fixture-user', source: 'host_user', mode: 'host_capability', timestamp: 1, targetVersion: 1, sessionId: 'fixture-captain', userId: 'fixture-user', projectId: 'link-project', decisionType: 'design_approve', capabilityId: 'link-plan-design-approval', contentHash: 'link-plan-design-approval-hash', issuedAt: 0, expiresAt: 999999 },
  }
  await project.writeProjectState(root, value)
  return value
}
async function createRawTeam(root, id, projectFields, tasks = [], memberId = '') {
  const team = {
    name: id,
    id,
    ...projectFields,
    phase: 'staged',
    planReviewState: 'awaiting_review',
    ...projectFields.projectId === undefined ? {} : { projectLinkState: projectFields.projectLinkState ?? 'linked' },
    captainSessionId: id + '-captain',
    createdAt: 1,
    members: [{ id: memberId, name: 'engineer', joinedAt: 1, status: 'idle' }],
    tasks,
    taskSeq: tasks.length,
  }
  // The durable boundary rejects malformed Project Teams.  For the reverse
  // kind=work test, create a valid bound Team first and exercise the real tool
  // entry that attempts to add the forbidden task.
  await state.createTeamDir(join(root, '.agent-teams'), team)
  return team
}
async function readRawTeam(root, teamId) {
  return JSON.parse(await readFile(join(root, '.agent-teams', teamId, 'team.json'), 'utf8'))
}

const registered = registerTools()
const createTeam = find(registered, 'agent_teams_create')
const editPlan = find(registered, 'agent_teams_edit_plan')
const approve = find(registered, 'agent_teams_approve')
const updateTask = find(registered, 'agent_teams_update_task')
const roots = []
try {
  const createRoot = await mkdtemp(join(tmpdir(), 'dsh-link-create-'))
  roots.push(createRoot)
  await approvedProject(createRoot)
  const created = await createTeam(
    { name: 'Linked project team', description: 'link test' },
    captain(createRoot, 'create-captain'),
  )
  const createdTeamId = created.team_id ?? created.teamId
  const createdRaw = await readRawTeam(createRoot, createdTeamId)
  const createdProject = await project.readProjectState(createRoot)
  check('project Team creation persists linked state', createdRaw.projectId === 'link-project' && createdRaw.projectLinkState === 'linked')
  check('project Team creation persists a matching Work Item', createdProject.workItems.some((item) => item.teamId === createdRaw.id))

  const addRoot = await mkdtemp(join(tmpdir(), 'dsh-link-add-'))
  roots.push(addRoot)
  await approvedProject(addRoot)
  const addTeam = await createRawTeam(addRoot, 'bound-add', {
    projectId: 'link-project',
    projectRequirementId: 'req-link',
    projectRequirementVersion: 1,
    projectDesignId: 'design-link',
    projectDesignVersion: 1,
  })
  await rejects(
    'bound staged add_task rejects implicit work',
    () => editPlan({ operations: [{ action: 'add_task', subject: 'implicit work', dependencies: [] }] }, captain(addRoot, addTeam.captainSessionId)),
    /kind|work|project/i,
  )
  check('rejected bound staged add_task is not persisted', (await readRawTeam(addRoot, addTeam.id)).tasks.length === 0)

  const badRoot = await mkdtemp(join(tmpdir(), 'dsh-link-bad-'))
  roots.push(badRoot)
  await approvedProject(badRoot)
  const badTask = {
    id: 't1',
    subject: 'bad project work',
    kind: 'work',
    status: 'pending',
    dependencies: [],
    attempt: 0,
    createdAt: 1,
    updatedAt: 1,
  }
  await rejects(
    'project Team persistence rejects kind=work before approval',
    () => createRawTeam(badRoot, 'bound-work', {
      projectId: 'link-project',
      projectRequirementId: 'req-link',
      projectRequirementVersion: 1,
      projectDesignId: 'design-link',
      projectDesignVersion: 1,
    }, [badTask]),
    /invalid initial AgentTeams state|kind|work|binding|project/i,
  )

  const reassignRoot = await mkdtemp(join(tmpdir(), 'dsh-link-reassign-'))
  roots.push(reassignRoot)
  await approvedProject(reassignRoot)
  const reassignTask = {
    id: 't1', subject: 'bound implementation', kind: 'implementation', status: 'pending',
    dependencies: [], attempt: 0, createdAt: 1, updatedAt: 1,
    projectId: 'link-project', requirementId: 'req-link', requirementVersion: 1,
    designId: 'design-link', designVersion: 1,
  }
  const pendingTeam = await createRawTeam(reassignRoot, 'pending-reassign', {
    projectId: 'link-project', projectRequirementId: 'req-link', projectRequirementVersion: 1,
    projectDesignId: 'design-link', projectDesignVersion: 1, projectLinkState: 'link_pending',
  }, [reassignTask])
  const reassign = find(registered, 'agent_teams_reassign_task')
  await rejects(
    'real reassign rejects a link_pending Project Team',
    () => reassign({ task_id: 't1', assignee: 'engineer' }, captain(reassignRoot, pendingTeam.captainSessionId)),
    /blocked|link|Project/i,
  )
  const pendingAfter = await readRawTeam(reassignRoot, pendingTeam.id)
  check('rejected reassign leaves the task unchanged', pendingAfter.tasks[0].status === 'pending' && pendingAfter.tasks[0].assignee === undefined)

  const repairRoot = await mkdtemp(join(tmpdir(), 'dsh-link-repair-'))
  roots.push(repairRoot)
  await approvedProject(repairRoot)

  const sourceTask = {
    id: 't0',
    subject: 'implement feature',
    kind: 'implementation',
    status: 'completed',
    assignee: 'engineer',
    dependencies: [],
    attempt: 0,
    createdAt: 1,
    updatedAt: 1,
    objective: 'implement the feature',
    inScope: ['src/'],
    outOfScope: [],
    acceptance: ['the feature works'],
    verify: ['node --version'],
    output: 'fixture implementation completed',
    acceptanceResults: [{ criterion: 'the feature works', status: 'passed', evidence: 'fixture implementation completed' }],
    commandsRun: [{ command: 'node --version', status: 'passed', exitCode: 0, evidence: 'fixture command passed' }],
    projectId: 'link-project',
    requirementId: 'req-link',
    requirementVersion: 1,
    designId: 'design-link',
    designVersion: 1,
  }
  const reviewTask = {
    id: 't1',
    subject: 'review implementation',
    kind: 'review',
    status: 'in_progress',
    assignee: 'captain',
    dependencies: ['t0'],
    attempt: 0,
    createdAt: 1,
    updatedAt: 1,
    objective: 'review the implementation',
    inScope: ['src/'],
    outOfScope: [],
    acceptance: ['the review identifies actionable findings'],
    verify: ['node --version'],
    reviewedTaskId: 't0',
    projectId: 'link-project',
    requirementId: 'req-link',
    requirementVersion: 1,
    designId: 'design-link',
    designVersion: 1,
  }

  const repairProject = await project.readProjectState(repairRoot)
  repairProject.workItems.push({
    id: 'work-item-repair',
    title: 'Repair-bound Work Item',
    status: 'in_progress',
    requirementId: 'req-link',
    designId: 'design-link',
    teamId: 'repair-bound',
    taskIds: ['t0', 't1'],
    version: 1,
    updatedAt: 1,
  })
  await project.writeProjectState(repairRoot, repairProject)

  const repairTeam = await createRawTeam(repairRoot, 'repair-bound', {
    projectId: 'link-project', projectRequirementId: 'req-link', projectRequirementVersion: 1,
    projectDesignId: 'design-link', projectDesignVersion: 1, projectLinkState: 'linked',
  }, [sourceTask, reviewTask], 'engineer')
  await updateTask({
    task_id: 't1', status: 'failed', verdict: 'needs_revision', output: 'finding requires repair',
    findings: [{ id: 'finding-1', severity: 'high', problem: 'implementation is incomplete', requiredFix: 'complete the missing behavior' }],
  }, captain(repairRoot, repairTeam.captainSessionId))
  const repairAfter = await readRawTeam(repairRoot, repairTeam.id)
  const materializedRepair = repairAfter.tasks.find((task) => task.kind === 'repair')
  check('real update_task repair materialization preserves Project binding', materializedRepair?.projectId === 'link-project'
    && materializedRepair?.requirementId === 'req-link' && materializedRepair?.requirementVersion === 1
    && materializedRepair?.designId === 'design-link' && materializedRepair?.designVersion === 1)

  const claim = find(registered, 'agent_teams_claim_task')
  const claimResult = await claim({ task_id: materializedRepair.id }, member(repairRoot))
  const claimedRepair = await readRawTeam(repairRoot, repairTeam.id)
  const claimed = claimedRepair.tasks.find((task) => task.id === materializedRepair.id)
  check('real claim preserves repair binding', claimed?.status === 'claimed'
    && claimed?.projectId === 'link-project' && claimed?.requirementId === 'req-link'
    && claimed?.requirementVersion === 1 && claimed?.designId === 'design-link'
    && claimed?.designVersion === 1)
  const attemptId = claimResult?.attempt_id ?? claimResult?.attemptId
  if (typeof attemptId !== 'string' || attemptId === '') throw new Error('real repair claim did not return an attempt id')
  await updateTask({ task_id: materializedRepair.id, status: 'in_progress', attempt_id: attemptId, output: 'repair execution started' }, member(repairRoot))
  const updatedRepair = await readRawTeam(repairRoot, repairTeam.id)
  const updated = updatedRepair.tasks.find((task) => task.id === materializedRepair.id)
  check('real update preserves repair binding', updated?.status === 'in_progress'
    && updated?.projectId === 'link-project' && updated?.requirementId === 'req-link'
    && updated?.requirementVersion === 1 && updated?.designId === 'design-link'
    && updated?.designVersion === 1)

  for (const [label, linkState] of [['link_pending', 'link_pending'], ['degraded', 'degraded']]) {
    const blockedRoot = await mkdtemp(join(tmpdir(), 'dsh-link-' + linkState + '-'))
    roots.push(blockedRoot)
    await approvedProject(blockedRoot)
    const blockedTeam = await createRawTeam(blockedRoot, 'blocked-' + linkState, {
      projectId: 'link-project', projectRequirementId: 'req-link', projectRequirementVersion: 1,
      projectDesignId: 'design-link', projectDesignVersion: 1, projectLinkState: linkState,
    }, [{ ...sourceTask, id: 't0', status: 'pending' }])
    await rejects('real claim rejects ' + label + ' Project Team',
      () => claim({ task_id: 't0' }, captain(blockedRoot, blockedTeam.captainSessionId)), /blocked|link|Project/i)
  }

  const missingLinkRoot = await mkdtemp(join(tmpdir(), 'dsh-link-missing-association-'))
  roots.push(missingLinkRoot)
  await approvedProject(missingLinkRoot)
  const missingLinkTeam = await createRawTeam(missingLinkRoot, 'missing-association', {
    projectId: 'link-project', projectRequirementId: 'req-link', projectRequirementVersion: 1,
    projectDesignId: 'design-link', projectDesignVersion: 1, projectLinkState: 'linked',
  }, [{ ...sourceTask, id: 't0', status: 'pending' }])
  await rejects('real claim rejects missing Project Work Item association',
    () => claim({ task_id: 't0' }, captain(missingLinkRoot, missingLinkTeam.captainSessionId)), /blocked|link|Project|association/i)

  const staleRoot = await mkdtemp(join(tmpdir(), 'dsh-link-expired-'))
  roots.push(staleRoot)
  await approvedProject(staleRoot)
  const staleProject = await project.readProjectState(staleRoot)
  staleProject.requirement.version = 2
  staleProject.workItems.push({
    id: 'work-item-stale',
    title: 'Expired binding Work Item',
    status: 'in_progress',
    requirementId: 'req-link',
    designId: 'design-link',
    teamId: 'stale-binding',
    taskIds: ['t0'],
    version: 1,
    updatedAt: 1,
  })
  await project.writeProjectState(staleRoot, staleProject)
  const staleTeam = await createRawTeam(staleRoot, 'stale-binding', {
    projectId: 'link-project', projectRequirementId: 'req-link', projectRequirementVersion: 1,
    projectDesignId: 'design-link', projectDesignVersion: 1, projectLinkState: 'linked',
  }, [{ ...sourceTask, id: 't0', status: 'pending' }])
  await rejects('real claim rejects an expired Project binding',
    () => claim({ task_id: 't0' }, captain(staleRoot, staleTeam.captainSessionId)), /blocked|version|stale|Project/i)

  const missingRoot = await mkdtemp(join(tmpdir(), 'dsh-link-missing-'))
  roots.push(missingRoot)
  await approvedProject(missingRoot)
  const goodTask = {
    id: 't1',
    subject: 'bound implementation',
    kind: 'implementation',
    objective: 'verify association before execution',
    acceptance: ['the association is durable'],
    inScope: ['src/'],
    verify: ['node --version'],
    projectId: 'link-project',
    requirementId: 'req-link',
    requirementVersion: 1,
    designId: 'design-link',
    designVersion: 1,
    status: 'pending',
    dependencies: [],
    attempt: 0,
    createdAt: 1,
    updatedAt: 1,
  }
  const missingTeam = await createRawTeam(missingRoot, 'missing-link', {
    projectId: 'link-project',
    projectRequirementId: 'req-link',
    projectRequirementVersion: 1,
    projectDesignId: 'design-link',
    projectDesignVersion: 1,
  }, [goodTask])
  await rm(join(missingRoot, '.agent-project', 'status.json'))
  await rejects(
    'approval fails closed when project link context disappears',
    () => approve({ confirmation: 'user approved' }, captain(missingRoot, missingTeam.captainSessionId)),
    /context|link|project/i,
  )
  const missingAfter = await readRawTeam(missingRoot, missingTeam.id)
  check('failed project link is persisted as link_pending without spawning', missingAfter.phase === 'staged' && missingAfter.projectLinkState === 'link_pending' && missingAfter.members[0].id === '')

  const corruptRoot = await mkdtemp(join(tmpdir(), 'dsh-link-corrupt-'))
  roots.push(corruptRoot)
  await mkdir(join(corruptRoot, '.agent-project'), { recursive: true })
  await writeFile(join(corruptRoot, '.agent-project', 'status.json'), '{broken', 'utf8')
  const corruptCaptain = captain(corruptRoot, 'corrupt-captain')
  await rejects(
    'Team creation fails closed when project state cannot be read',
    () => createTeam({ name: 'Corrupt project team', description: 'must not become silent Legacy' }, corruptCaptain),
    /project|read|safe/i,
  )
  const corruptTeam = await state.findTeamByCaptain(join(corruptRoot, '.agent-teams'), 'corrupt-captain')
  check('unreadable project state leaves a halted non-dispatchable Team', corruptTeam?.halted === true && (corruptTeam.projectLinkState === undefined || corruptTeam.projectLinkState === 'degraded'))

  const legacyRoot = await mkdtemp(join(tmpdir(), 'dsh-link-legacy-'))
  roots.push(legacyRoot)
  const legacyTeam = await createRawTeam(legacyRoot, 'legacy-staged', {})
  await editPlan({ operations: [{ action: 'add_task', subject: 'legacy work', dependencies: [] }] }, captain(legacyRoot, legacyTeam.captainSessionId))
  const legacyAfter = await readRawTeam(legacyRoot, legacyTeam.id)
  check('unbound Legacy staged add_task remains kind=work compatible', legacyAfter.projectId === undefined && legacyAfter.tasks[0]?.kind === 'work')
} finally {
  for (const root of roots) await rm(root, { recursive: true, force: true })
}
console.log('project-link-plan-verify: ' + passed + ' assertions passed')
