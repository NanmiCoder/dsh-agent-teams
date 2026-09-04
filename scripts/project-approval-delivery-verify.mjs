import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const sourceMode = process.env.DSH_SOURCE_VALIDATE === '1'
const libRoot = sourceMode ? join(process.cwd(), 'src') : (process.env.DSH_VALIDATION_LIB ?? join(process.cwd(), 'lib'))
const load = (name) => import(pathToFileURL(join(libRoot, sourceMode && name.endsWith('.js') ? name.slice(0, -3) + '.ts' : name)).href)
const project = await load('project.js')
const projectTools = await load('project-tools.js')

let failures = 0
function check(label, condition) {
  if (condition) console.log('  PASS  ' + label)
  else { failures += 1; console.error('  FAIL  ' + label) }
}
async function rejects(label, operation) {
  let rejected = false
  try { await operation() } catch { rejected = true }
  check(label, rejected)
}
function captainContext(root) {
  return { agent: { id: 'captain-session', session: { header: { cwd: root } } } }
}
function memberContext(root) {
  return { agent: { id: 'member-session', session: { header: { cwd: root, parentSession: 'captain-session' } } } }
}
function decision(targetVersion, rationale = 'Captain reviewed the current artifact') {
  return { source: 'legacy_compat', target_version: targetVersion, rationale }
}
function hostMetadata(decisionType, targetVersion) {
  return {
    actor: 'user-1', source: 'host_user', mode: 'host_capability', timestamp: 1,
    targetVersion, sessionId: 'captain-session', userId: 'user-1', projectId: 'legacy-fixture',
    decisionType, capabilityId: decisionType + '-' + targetVersion, contentHash: 'fixture-hash', issuedAt: 0, expiresAt: 999999,
  }
}
function hostProvider({ mode = 'valid', capabilityId } = {}) {
  return {
    async verify(request) {
      if (mode === 'forged') return { capabilityId: 'forged', userId: 'attacker', sessionId: request.sessionId, projectId: request.projectId, decisionType: request.decisionType, targetVersion: request.targetVersion, contentHash: 'forged', issuedAt: request.now - 1, expiresAt: request.now + 60000 }
      return {
        capabilityId: capabilityId ?? request.decisionType,
        userId: 'user-1',
        sessionId: mode === 'wrong-session' ? 'other-session' : request.sessionId,
        projectId: mode === 'wrong-project' ? request.projectId + '-other' : request.projectId,
        decisionType: mode === 'wrong-type' ? 'design_approve' : request.decisionType,
        targetVersion: mode === 'wrong-version' ? request.targetVersion + 1 : request.targetVersion,
        contentHash: mode === 'wrong-hash' ? 'wrong-payload-hash' : request.contentHash,
        issuedAt: mode === 'future-issued-at' ? request.now + 1 : request.now - 1,
        expiresAt: mode === 'expired' ? request.now - 1 : request.now + 60000,
      }
    },
  }
}
function approvedRequirement(projectId = 'fixture') {
  return { id: 'req', title: 'Requirement', statement: 'Build it', scope: ['feature'], outOfScope: [], acceptanceCriteria: ['works'], clarificationIds: [], riskIds: [], status: 'approved', version: 1, updatedAt: 1, approvalDecision: { actor: 'user-1', source: 'host_user', mode: 'host_capability', timestamp: 1, targetVersion: 1, sessionId: 'captain-session', userId: 'user-1', projectId, decisionType: 'requirement_approve', capabilityId: 'fixture-requirement-' + projectId, contentHash: 'fixture-requirement-hash', issuedAt: 0, expiresAt: 999999 } }
}
function approvedDesign(projectId = 'fixture') {
  return { id: 'design', title: 'Design', summary: 'Simple', architecture: ['layered'], moduleBoundaries: ['feature'], interfaces: ['tools'], dataModel: ['status'], tradeoffs: ['small'], migrationStrategy: ['none'], testStrategy: ['offline'], requirementId: 'req', status: 'approved', version: 1, updatedAt: 1, approvalDecision: { actor: 'user-1', source: 'host_user', mode: 'host_capability', timestamp: 1, targetVersion: 1, sessionId: 'captain-session', userId: 'user-1', projectId, decisionType: 'design_approve', capabilityId: 'fixture-design-' + projectId, contentHash: 'fixture-design-hash', issuedAt: 0, expiresAt: 999999 } }
}
function passingTeam(id = 'team-pass') {
  const base = { dependencies: [], createdAt: 1, updatedAt: 1 }
  return {
    id, name: 'Passing team', captainSessionId: 'captain-session', createdAt: 1, taskSeq: 3, members: [],
    tasks: [
      { ...base, id: 'requirements-1', subject: 'Requirements', status: 'completed', kind: 'requirements', verdict: 'pass', objective: 'Confirm requirements', acceptance: ['requirements are clear'], coverageOf: ['works'] },
      { ...base, id: 'implementation-1', subject: 'Implementation', status: 'completed', kind: 'implementation', objective: 'Implement the feature', acceptance: ['feature works'], verify: ['node --version'], inScope: ['src/feature.ts'], coverageOf: ['works'], changedPaths: ['src/feature.ts'], acceptanceResults: [{ criterion: 'feature works', status: 'passed', evidence: 'test passed' }], commandsRun: [{ command: 'node --version', status: 'passed', exitCode: 0 }] },
      { ...base, id: 'review-1', subject: 'Review', status: 'completed', kind: 'review', verdict: 'pass', objective: 'Review the feature', acceptance: ['no blockers'], reviewedTaskId: 'implementation-1', coverageOf: ['works'], findings: [] },
    ],
  }
}
function blockedTeam() {
  const team = passingTeam('team-blocked')
  team.tasks[1].status = 'in_progress'
  return team
}

const root = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-approval-'))
try {
  const registered = new Map()
  projectTools.registerProjectTools({ tools: { register(tool) { registered.set(tool.name, tool) } } }, { decisionCapabilityProvider: hostProvider() })
  const context = captainContext(root)
  const state = project.createInitialProjectState({ id: 'approval', title: 'Approval', goal: 'decision metadata', mode: 'greenfield', now: 1 })
  await project.writeProjectState(root, state)
  const requirementTool = registered.get('agent_project_requirement_update')
  const designTool = registered.get('agent_project_design_update')
  const acceptTool = registered.get('agent_project_work_item_accept')

  await requirementTool.execute({ project_root: root, id: 'req', title: 'Requirement', statement: 'Build it', acceptance_criteria: ['works'], status: 'approved' }, context)
  await designTool.execute({ project_root: root, id: 'design', title: 'Design', summary: 'Simple', status: 'approved' }, context)
  const approved = await project.readProjectState(root)
  check('approval metadata is derived from a host capability', approved.requirement.approvalDecision.actor === 'user-1' && approved.requirement.approvalDecision.source === 'host_user' && approved.requirement.approvalDecision.mode === 'host_capability' && approved.design.approvalDecision.sessionId === 'captain-session')
  const noProviderRegistered = new Map()
  projectTools.registerProjectTools({ tools: { register(tool) { noProviderRegistered.set(tool.name, tool) } } })
  await rejects('production requirement approval fails closed without a host adapter', () => noProviderRegistered.get('agent_project_requirement_update').execute({ project_root: root, id: 'req2', title: 'Requirement 2', statement: 'Build it', acceptance_criteria: ['works'], status: 'approved', decision: decision(2) }, context))
  const forgedRegistered = new Map()
  projectTools.registerProjectTools({ tools: { register(tool) { forgedRegistered.set(tool.name, tool) } } }, { decisionCapabilityProvider: hostProvider({ mode: 'forged' }) })
  await rejects('forged capability is rejected', () => forgedRegistered.get('agent_project_requirement_update').execute({ project_root: root, id: 'req2', title: 'Requirement 2', statement: 'Build it', acceptance_criteria: ['works'], status: 'approved' }, context))
  const wrongSessionRegistered = new Map()
  projectTools.registerProjectTools({ tools: { register(tool) { wrongSessionRegistered.set(tool.name, tool) } } }, { decisionCapabilityProvider: hostProvider({ mode: 'wrong-session', capabilityId: 'wrong-session' }) })
  await rejects('wrong-session capability is rejected', () => wrongSessionRegistered.get('agent_project_requirement_update').execute({ project_root: root, id: 'req2', title: 'Requirement 2', statement: 'Build it', acceptance_criteria: ['works'], status: 'approved' }, context))
  const wrongVersionRegistered = new Map()
  projectTools.registerProjectTools({ tools: { register(tool) { wrongVersionRegistered.set(tool.name, tool) } } }, { decisionCapabilityProvider: hostProvider({ mode: 'wrong-version', capabilityId: 'wrong-version' }) })
  await rejects('wrong-version capability is rejected', () => wrongVersionRegistered.get('agent_project_requirement_update').execute({ project_root: root, id: 'req2', title: 'Requirement 2', statement: 'Build it', acceptance_criteria: ['works'], status: 'approved' }, context))
  const wrongProjectRegistered = new Map()
  projectTools.registerProjectTools({ tools: { register(tool) { wrongProjectRegistered.set(tool.name, tool) } } }, { decisionCapabilityProvider: hostProvider({ mode: 'wrong-project', capabilityId: 'wrong-project' }) })
  await rejects('wrong-project capability is rejected', () => wrongProjectRegistered.get('agent_project_requirement_update').execute({ project_root: root, id: 'req2', title: 'Requirement 2', statement: 'Build it', acceptance_criteria: ['works'], status: 'approved' }, context))
  const wrongTypeRegistered = new Map()
  projectTools.registerProjectTools({ tools: { register(tool) { wrongTypeRegistered.set(tool.name, tool) } } }, { decisionCapabilityProvider: hostProvider({ mode: 'wrong-type', capabilityId: 'wrong-type' }) })
  await rejects('wrong-decision-type capability is rejected', () => wrongTypeRegistered.get('agent_project_requirement_update').execute({ project_root: root, id: 'req2', title: 'Requirement 2', statement: 'Build it', acceptance_criteria: ['works'], status: 'approved' }, context))
  const wrongHashRegistered = new Map()
  projectTools.registerProjectTools({ tools: { register(tool) { wrongHashRegistered.set(tool.name, tool) } } }, { decisionCapabilityProvider: hostProvider({ mode: 'wrong-hash', capabilityId: 'wrong-hash' }) })
  await rejects('payload hash mismatch is rejected', () => wrongHashRegistered.get('agent_project_requirement_update').execute({ project_root: root, id: 'req2', title: 'Requirement 2', statement: 'Build it', acceptance_criteria: ['works'], status: 'approved' }, context))
  const futureRegistered = new Map()
  projectTools.registerProjectTools({ tools: { register(tool) { futureRegistered.set(tool.name, tool) } } }, { decisionCapabilityProvider: hostProvider({ mode: 'future-issued-at', capabilityId: 'future-issued-at' }) })
  await rejects('future-issued capability is rejected', () => futureRegistered.get('agent_project_requirement_update').execute({ project_root: root, id: 'req2', title: 'Requirement 2', statement: 'Build it', acceptance_criteria: ['works'], status: 'approved' }, context))
  const expiredRegistered = new Map()
  projectTools.registerProjectTools({ tools: { register(tool) { expiredRegistered.set(tool.name, tool) } } }, { decisionCapabilityProvider: hostProvider({ mode: 'expired', capabilityId: 'expired' }) })
  await rejects('expired capability is rejected', () => expiredRegistered.get('agent_project_requirement_update').execute({ project_root: root, id: 'req2', title: 'Requirement 2', statement: 'Build it', acceptance_criteria: ['works'], status: 'approved' }, context))

  const deliveryRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-delivery-'))
  try {
    const deliveryState = project.createInitialProjectState({ id: 'delivery', title: 'Delivery', goal: 'accept and deliver', mode: 'greenfield', now: 1 })
    deliveryState.requirement = approvedRequirement('delivery')
    deliveryState.design = approvedDesign('delivery')
    deliveryState.workItems.push({ id: 'wi', title: 'Feature', status: 'implemented_not_accepted', version: 1, teamId: 'team-blocked', taskIds: ['requirements-1', 'implementation-1', 'review-1'], updatedAt: 1 })
    await project.writeProjectState(deliveryRoot, deliveryState)
    await mkdir(join(deliveryRoot, '.agent-teams', 'team-blocked'), { recursive: true })
    await writeFile(join(deliveryRoot, '.agent-teams', 'team-blocked', 'team.json'), JSON.stringify(blockedTeam()))
    const deliveryContext = captainContext(deliveryRoot)
    await rejects('member cannot perform project acceptance', () => acceptTool.execute({ project_root: deliveryRoot, id: 'wi', action: 'accept', decision: decision(1) }, memberContext(deliveryRoot)))
    await rejects('acceptance rejects when linked Team quality delivery is blocked', () => acceptTool.execute({ project_root: deliveryRoot, id: 'wi', action: 'accept', decision: decision(1) }, deliveryContext))

    await writeFile(join(deliveryRoot, '.agent-teams', 'team-blocked', 'team.json'), JSON.stringify(passingTeam('team-blocked')))
    await acceptTool.execute({ project_root: deliveryRoot, id: 'wi', action: 'accept', note: 'Reviewed by Captain' }, deliveryContext)
    const accepted = await project.readProjectState(deliveryRoot)
    check('legal acceptance records host capability metadata and increments version', accepted.workItems[0].status === 'accepted' && accepted.workItems[0].version === 2 && accepted.workItems[0].acceptanceDecision.actor === 'user-1' && accepted.workItems[0].acceptanceDecision.source === 'host_user' && accepted.workItems[0].acceptanceDecision.mode === 'host_capability' && accepted.workItems[0].acceptedAt === accepted.workItems[0].acceptanceDecision.timestamp)
    await rejects('replayed acceptance capability is rejected', () => acceptTool.execute({ project_root: deliveryRoot, id: 'wi', action: 'accept', note: 'Replay' }, deliveryContext))
    await rejects('linked delivery fails closed without a host adapter', () => noProviderRegistered.get('agent_project_work_item_accept').execute({ project_root: deliveryRoot, id: 'wi', action: 'deliver' }, deliveryContext))
    await acceptTool.execute({ project_root: deliveryRoot, id: 'wi', action: 'deliver', note: 'Released' }, deliveryContext)
    const delivered = await project.readProjectState(deliveryRoot)
    check('delivery requires prior acceptance and records its own decision', delivered.workItems[0].status === 'delivered' && delivered.workItems[0].version === 3 && delivered.workItems[0].deliveryDecision.targetVersion === 2 && delivered.workItems[0].deliveredAt === delivered.workItems[0].deliveryDecision.timestamp)
    const replayProvider = hostProvider({ capabilityId: 'replay-delivery' })
    const replayRegistered = new Map()
    projectTools.registerProjectTools({ tools: { register(tool) { replayRegistered.set(tool.name, tool) } } }, { decisionCapabilityProvider: replayProvider })
    const replayDeliveryTool = replayRegistered.get('agent_project_work_item_accept')
    await replayDeliveryTool.execute({ project_root: deliveryRoot, id: 'wi', action: 'deliver', note: 'Second delivery audit' }, deliveryContext)
    await rejects('same delivery capability cannot be consumed twice', () => replayDeliveryTool.execute({ project_root: deliveryRoot, id: 'wi', action: 'deliver', note: 'Replay delivery audit' }, deliveryContext))
    const replayState = await project.readProjectState(deliveryRoot)
    check('consumed capability ids are durably recorded', (replayState.usedDecisionCapabilities ?? []).some((item) => item.capabilityId === 'replay-delivery'))

    const legacyRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-legacy-'))
    try {
      const legacyState = project.createInitialProjectState({ id: 'legacy', title: 'Legacy', goal: 'preserve transition semantics', mode: 'greenfield', now: 1 })
      legacyState.requirement = approvedRequirement('legacy')
      legacyState.design = approvedDesign('legacy')
      legacyState.workItems.push({ id: 'legacy-wi', title: 'Legacy feature', status: 'implemented_not_accepted', updatedAt: 1 })
      await project.writeProjectState(legacyRoot, legacyState)
      const legacyContext = captainContext(legacyRoot)
      const legacyRegistered = new Map()
      projectTools.registerProjectTools({ tools: { register(tool) { legacyRegistered.set(tool.name, tool) } } })
      const legacyAcceptTool = legacyRegistered.get('agent_project_work_item_accept')
      await legacyAcceptTool.execute({ project_root: legacyRoot, id: 'legacy-wi', action: 'accept', decision: decision(1) }, legacyContext)
      await legacyAcceptTool.execute({ project_root: legacyRoot, id: 'legacy-wi', action: 'deliver', decision: decision(2) }, legacyContext)
      const legacyDelivered = await project.readProjectState(legacyRoot)
      check('legacy unlinked Work Item is explicitly marked compatibility-only', legacyDelivered.workItems[0].status === 'delivered' && legacyDelivered.workItems[0].acceptanceDecision.source === 'legacy_captain' && legacyDelivered.workItems[0].acceptanceDecision.mode === 'legacy_compat' && legacyDelivered.workItems[0].deliveryDecision.mode === 'legacy_compat')
    } finally {
      await rm(legacyRoot, { recursive: true, force: true })
    }
  } finally {
    await rm(deliveryRoot, { recursive: true, force: true })
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) process.exit(1)
console.log('project approval/delivery verification checks passed')
