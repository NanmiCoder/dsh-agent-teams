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

const root = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-phase4-'))
try {
  const state = project.createInitialProjectState({ id: 'phase4', title: 'Phase 4', goal: 'verification and acceptance', mode: 'greenfield', now: 1 })
  state.requirement = { id: 'req', title: 'Requirement', statement: 'Build it', scope: ['feature'], outOfScope: [], acceptanceCriteria: ['works'], clarificationIds: [], riskIds: [], status: 'approved', version: 1, updatedAt: 1, approvalDecision: { actor: 'phase4-user', source: 'host_user', mode: 'host_capability', timestamp: 1, targetVersion: 1, sessionId: 'phase4-captain', userId: 'phase4-user', projectId: 'phase4', decisionType: 'requirement_approve', capabilityId: 'phase4-requirement', contentHash: 'phase4-requirement-hash', issuedAt: 0, expiresAt: 999999 } }
  state.design = { id: 'design', title: 'Design', summary: 'Simple', architecture: ['layered'], moduleBoundaries: ['feature'], interfaces: ['tools'], dataModel: ['status'], tradeoffs: ['small'], migrationStrategy: ['none'], testStrategy: ['offline'], requirementId: 'req', status: 'approved', version: 1, updatedAt: 1, approvalDecision: { actor: 'phase4-user', source: 'host_user', mode: 'host_capability', timestamp: 1, targetVersion: 1, sessionId: 'phase4-captain', userId: 'phase4-user', projectId: 'phase4', decisionType: 'design_approve', capabilityId: 'phase4-design', contentHash: 'phase4-design-hash', issuedAt: 0, expiresAt: 999999 } }
  state.clarifications = [{ id: 'c1', question: 'Choose', options: ['A', 'B'], status: 'open', askedAt: 1 }]
  state.decisions.push({ id: 'd1', question: 'Choose release mode', status: 'pending' })
  state.risks.push('Review may require repair')
  state.workItems.push(
    { id: 'wi-not-accepted', title: 'Waiting', status: 'implemented_not_accepted', updatedAt: 1 },
    { id: 'wi-delivered', title: 'Delivered', status: 'delivered', acceptedAt: 2, deliveredAt: 3, updatedAt: 3 },
    { id: 'wi-review', title: 'Review failure', status: 'failed_review', updatedAt: 1 },
  )
  await project.writeProjectState(root, state)

  const teamRoot = join(root, '.agent-teams', 'team-real')
  await mkdir(teamRoot, { recursive: true })
  await writeFile(join(teamRoot, 'team.json'), JSON.stringify({
    id: 'team-real', name: 'Real team', projectId: 'phase4', projectRequirementId: 'req', projectRequirementVersion: 1, projectDesignId: 'design', projectDesignVersion: 1, projectLinkState: 'linked', captainSessionId: 'captain', createdAt: 1, members: [], taskSeq: 2,
    tasks: [
      { id: 'review-1', subject: 'Review', status: 'completed', kind: 'review', verdict: 'pass', dependencies: [], createdAt: 1, updatedAt: 1 },
      { id: 'repair-1', subject: 'Repair', status: 'in_progress', kind: 'repair', projectId: 'phase4', requirementId: 'req', requirementVersion: 1, designId: 'design', designVersion: 1, dependencies: ['review-1'], createdAt: 1, updatedAt: 1 },
    ],
  }))
  await projectTools.ensureProjectWorkItemForTeam(root, 'team-real', 'Real team', ['review-1', 'repair-1'])
  const loaded = await project.readProjectState(root)
  const links = await projectTools.projectExecutionLinks(root, loaded, '.agent-teams')
  const report = projectTools.projectReportDetails(loaded, links)
  check('report groups Work Items by status', report.work_items_by_status.implemented_not_accepted.length === 1 && report.work_items_by_status.delivered.length === 1 && report.work_items_by_status.failed_review.length === 1)
  check('report includes decisions, clarifications, risks, and execution links', report.pending_decisions.length === 1 && report.open_clarifications.length === 1 && report.risks.length === 1 && report.execution_links.length === 1)
  check('repair execution projects to in_progress', links[0].projected_status === 'in_progress' && links[0].completed_task_count === 1)

  check('failed Review projects to failed_review', project.projectWorkItemStatusFromTeam({ tasks: [{ id: 'review-1', status: 'failed', kind: 'review', verdict: 'needs_revision', dependencies: [] }] }, ['review-1']) === 'failed_review')
  check('repair round projects to in_progress', project.projectWorkItemStatusFromTeam({ tasks: [{ id: 'review-1', status: 'completed', kind: 'review', verdict: 'pass', dependencies: [] }, { id: 'repair-1', status: 'in_progress', kind: 'repair', dependencies: ['review-1'] }] }, ['review-1', 'repair-1']) === 'in_progress')

  const restarted = await project.readProjectState(root)
  const reviewItem = restarted.workItems.find((item) => item.id === 'wi-delivered')
  reviewItem.status = 'failed_review'
  reviewItem.acceptanceNote = 'Repair required before re-acceptance'
  delete reviewItem.acceptedAt
  delete reviewItem.deliveredAt
  await project.writeProjectState(root, restarted)
  const restored = (await project.readProjectState(root)).workItems.find((item) => item.id === 'wi-delivered')
  check('restart restores Review failure without stale delivery evidence', restored.status === 'failed_review' && restored.acceptedAt === undefined && restored.deliveredAt === undefined)

  await project.updateProjectState(root, (current) => {
    const clarification = current.clarifications?.find((item) => item.id === 'c1')
    if (clarification !== undefined) clarification.status = 'dismissed'
  })
  const registered = new Map()
  projectTools.registerProjectTools({ tools: { register(tool) { registered.set(tool.name, tool) } } })
  await registered.get('agent_project_work_item_update').execute({ project_root: root, id: 'wi-tool', title: 'Tool acceptance', status: 'implemented_not_accepted', requirement_id: 'req', design_id: 'design' }, { agent: { session: { header: { cwd: root } } } })
  let bypassRejected = false
  try { await registered.get('agent_project_work_item_update').execute({ project_root: root, id: 'wi-tool', title: 'Tool acceptance', status: 'accepted' }, { agent: { session: { header: { cwd: root } } } }) } catch { bypassRejected = true }
  await registered.get('agent_project_work_item_accept').execute({ project_root: root, id: 'wi-tool', action: 'accept', decision: { source: 'legacy_compat', target_version: 1, rationale: 'Approved by user' }, note: 'Approved by user' }, { agent: { id: 'captain-phase4', session: { id: 'session-phase4', header: { cwd: root } } } })
  await registered.get('agent_project_work_item_accept').execute({ project_root: root, id: 'wi-tool', action: 'deliver', decision: { source: 'legacy_compat', target_version: 2, rationale: 'Released' }, note: 'Released' }, { agent: { id: 'captain-phase4', session: { id: 'session-phase4', header: { cwd: root } } } })
  const toolItem = (await project.readProjectState(root)).workItems.find((item) => item.id === 'wi-tool')
  check('acceptance tool enforces accept then deliver', bypassRejected && toolItem.status === 'delivered' && toolItem.acceptedAt !== undefined && toolItem.deliveredAt !== undefined && toolItem.acceptanceNote === 'Released')
  const toolReport = await registered.get('agent_project_report').execute({ project_root: root, team_state_dir: '.agent-teams' }, { agent: { session: { header: { cwd: root } } } })
  check('agent_project_report returns status buckets', toolReport.report.work_items_by_status.delivered.length === 1 && toolReport.report.work_items_by_status.failed_review.length === 2)

  const toolContext = { agent: { session: { header: { cwd: root } } } }
  await registered.get('agent_project_clarification').execute({
    project_root: root,
    action: 'ask',
    id: 'c2',
    question: 'Which verification scope should be retained?',
    options: ['Tools only', 'Full integration'],
  }, toolContext)
  await registered.get('agent_project_clarification').execute({
    project_root: root,
    action: 'answer',
    id: 'c2',
    answer: 'Tools only',
  }, toolContext)
  await registered.get('agent_project_requirement_update').execute({
    project_root: root,
    id: 'req-tool',
    title: 'Tool requirement',
    statement: 'Keep clarification links durable',
    acceptance_criteria: ['links survive updates'],
    clarification_ids: ['c1', 'c2'],
    status: 'draft',
  }, toolContext)
  const firstRequirement = (await project.readProjectState(root)).requirement
  check(
    'requirement tool writes clarification_ids and persists them as clarificationIds',
    firstRequirement?.id === 'req-tool'
      && firstRequirement.status === 'draft'
      && JSON.stringify(firstRequirement.clarificationIds) === JSON.stringify(['c1', 'c2']),
  )

  await registered.get('agent_project_requirement_update').execute({
    project_root: root,
    id: 'req-tool-v2',
    title: 'Updated tool requirement',
    statement: 'Keep clarification links durable after edits',
    acceptance_criteria: ['links survive updates', 'unknown links are rejected'],
    status: 'draft',
  }, toolContext)
  const retainedRequirement = (await project.readProjectState(root)).requirement
  check(
    'requirement update preserves clarificationIds when clarification_ids is omitted',
    retainedRequirement?.id === 'req-tool-v2'
      && JSON.stringify(retainedRequirement.clarificationIds) === JSON.stringify(['c1', 'c2']),
  )

  let unknownClarificationRejected = false
  try {
    await registered.get('agent_project_requirement_update').execute({
      project_root: root,
      id: 'req-invalid',
      title: 'Invalid tool requirement',
      statement: 'This must not be persisted',
      acceptance_criteria: ['never writes'],
      clarification_ids: ['missing-clarification'],
      status: 'draft',
    }, toolContext)
  } catch {
    unknownClarificationRejected = true
  }
  const afterUnknownRequirement = (await project.readProjectState(root)).requirement
  check(
    'requirement tool rejects unknown clarification IDs without overwriting the draft',
    unknownClarificationRejected
      && afterUnknownRequirement?.id === 'req-tool-v2'
      && JSON.stringify(afterUnknownRequirement.clarificationIds) === JSON.stringify(['c1', 'c2']),
  )
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) process.exit(1)
console.log('phase4 verification checks passed')
