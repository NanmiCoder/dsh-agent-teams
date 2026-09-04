/**
 * Repeatable product-flow evidence for the long-lived project mode.
 *
 * This uses a recorded deterministic model and the real project tools. It
 * does not claim general external-LLM or real-browser coverage. Those release
 * boundaries are reported explicitly as fail-closed below.
 */

import { spawn } from 'node:child_process'
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
const evidence = {
  suite: 'product-flow-e2e',
  model: 'recorded-deterministic-model',
  turns: [],
  toolCalls: [],
  harness: [],
  releaseBoundary: {
    externalLlmNaturalLanguage: 'fail-closed: not exercised by this local suite',
    realHarnessConfirmation: 'fail-closed: deterministic adapter only',
    realBrowserUi: 'fail-closed: projection tested; browser interaction not exercised',
  },
}

function check(label, condition, detail = '') {
  if (condition) console.log('  PASS  ' + label)
  else {
    failures += 1
    console.error('  FAIL  ' + label + (detail ? ' — ' + detail : ''))
  }
}

function context(root, id = 'captain-product-e2e') {
  return { agent: { id, session: { id: 'session-product-e2e', header: { cwd: root } } } }
}

function deterministicHostProvider() {
  let sequence = 0
  return {
    async verify(request) {
      const capabilityId = 'recorded-capability-' + (++sequence) + '-' + request.decisionType
      evidence.toolCalls.push({ name: 'host_confirmation.verify', decisionType: request.decisionType })
      return {
        capabilityId,
        userId: 'recorded-user',
        sessionId: request.sessionId,
        projectId: request.projectId,
        decisionType: request.decisionType,
        targetVersion: request.targetVersion,
        contentHash: request.contentHash,
        issuedAt: request.now - 1,
        expiresAt: request.now + 60_000,
      }
    },
  }
}

function baseTask(id, subject, dependencies = []) {
  return { id, subject, dependencies, createdAt: 1, updatedAt: 1 }
}

function recordedTeam(projectId, repaired) {
  const requirements = {
    ...baseTask('requirements-1', 'Clarify and confirm requirements'),
    status: 'completed', kind: 'requirements', verdict: 'pass',
    objective: 'Record an implementable requirement', acceptance: ['requirements are clear'], coverageOf: ['feature works', 'regression is covered'],
  }
  const implementation = {
    ...baseTask('implementation-1', 'Implement the approved feature', ['requirements-1']),
    status: 'completed', kind: 'implementation', objective: 'Implement the approved feature',
    acceptance: ['feature works'], verify: ['node --version'], inScope: ['src/feature.ts'], coverageOf: ['feature works', 'regression is covered'],
    changedPaths: ['src/feature.ts'], acceptanceResults: [{ criterion: 'feature works', status: 'passed', evidence: 'recorded test passed' }],
    commandsRun: [{ command: 'node --version', status: 'passed', exitCode: 0 }],
  }
  const failedReview = {
    ...baseTask('review-1', 'Review the implementation', ['implementation-1']),
    status: 'failed', kind: 'review', verdict: 'needs_revision', objective: 'Review the implementation',
    acceptance: ['no high findings'], reviewedTaskId: 'implementation-1', coverageOf: ['feature works', 'regression is covered'],
    findings: [{ id: 'finding-1', severity: 'high', problem: 'Missing regression assertion', requiredFix: 'Add a regression assertion' }],
  }
  const repair = {
    ...baseTask('repair-1', 'Repair the review finding', ['implementation-1']),
    status: 'completed', kind: 'repair', objective: 'Address the review finding', acceptance: ['finding is repaired'],
    verify: ['node --version'], inScope: ['src/feature.ts'], coverageOf: ['feature works', 'regression is covered'], changedPaths: ['src/feature.ts'],
    output: 'Recorded repair completed',
    acceptanceResults: [{ criterion: 'finding is repaired', status: 'passed', evidence: 'recorded repair test passed' }],
    commandsRun: [{ command: 'node --version', status: 'passed', exitCode: 0 }],
  }
  const reReview = {
    ...baseTask('review-2', 'Re-review the repaired implementation', ['repair-1']),
    status: 'completed', kind: 'review', verdict: 'pass', objective: 'Re-review the repaired implementation',
    acceptance: ['no high findings'], reviewedTaskId: 'repair-1', coverageOf: ['feature works', 'regression is covered'], findings: [], output: 'Recorded re-review passed',
  }
  const tasks = (repaired ? [requirements, implementation, repair, reReview] : [requirements, implementation, failedReview]).map((task) => ({
    ...task,
    projectId,
    requirementId: 'requirement-e2e',
    requirementVersion: 1,
    designId: 'design-e2e',
    designVersion: 1,
  }))
  return {
    id: 'team-product-e2e', name: 'Product E2E team', captainSessionId: 'captain-product-e2e',
    projectId, projectRequirementId: 'requirement-e2e', projectRequirementVersion: 1,
    projectDesignId: 'design-e2e', projectDesignVersion: 1, projectLinkState: 'linked',
    createdAt: 1, updatedAt: 1, taskSeq: tasks.length, members: [], tasks,
  }
}

async function writeTeam(root, team) {
  const teamRoot = join(root, '.agent-teams', team.id)
  await mkdir(teamRoot, { recursive: true })
  await writeFile(join(teamRoot, 'team.json'), JSON.stringify(team, null, 2))
}

function dependencyOrderIsComplete(team) {
  const byId = new Map(team.tasks.map((task) => [task.id, task]))
  return team.tasks.every((task) => task.dependencies.every((id) => byId.get(id)?.status === 'completed'))
}

class RecordedModel {
  constructor(root, tools) {
    this.root = root
    this.tools = tools
  }

  intent(text) {
    if (/empty workspace|greenfield/i.test(text)) return 'greenfield-init'
    if (/brownfield/i.test(text)) return 'brownfield-init'
    if (/clarification/i.test(text) && /unresolved|ask/i.test(text)) return 'clarification-ask'
    if (/answer|choose sqlite/i.test(text)) return 'clarification-answer'
    if (/draft.*requirement/i.test(text)) return 'requirement-draft'
    if (/confirm.*requirement/i.test(text)) return 'requirement-approve'
    if (/draft.*design/i.test(text)) return 'design-draft'
    if (/approve.*design/i.test(text)) return 'design-approve'
    if (/implementation gate|approved.*DAG/i.test(text)) return 'implementation-gate'
    if (/needs revision/i.test(text)) return 'review-needs-revision'
    if (/repair.*re-review/i.test(text)) return 'repair-rereview'
    if (/accept/i.test(text)) return 'accept'
    if (/deliver/i.test(text)) return 'deliver'
    return 'unrecognized'
  }

  async turn(text, operation) {
    const intent = this.intent(text)
    evidence.turns.push({ user: text, intent })
    if (intent === 'unrecognized') throw new Error('recorded model could not classify: ' + text)
    return operation()
  }

  async tool(name, args) {
    const tool = this.tools.get(name)
    if (tool === undefined) throw new Error('missing project tool: ' + name)
    const result = await tool.execute(args, context(this.root))
    evidence.toolCalls.push({ name, status: result?.status ?? 'ok' })
    return result
  }
}

async function runNode(script, args = []) {
  const nodeArgs = sourceMode ? ['--experimental-strip-types', script, ...args] : [script, ...args]
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, nodeArgs, { cwd: process.cwd(), env: process.env })
  let stdout = ''
  let stderr = ''
  let settled = false
    const timeoutMs = script.includes('stress-verify') ? 180_000 : 60_000
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error('child verification timed out after ' + timeoutMs + 'ms: ' + script + '\\nstdout=' + stdout + '\\nstderr=' + stderr))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ code, signal, stdout, stderr })
    })
  })
}

function outputMarkersAreOrdered(output, markers) {
  let previous = -1
  for (const marker of markers) {
    const position = output.indexOf(marker)
    if (position < 0 || position < previous) return false
    previous = position
  }
  return true
}

async function coldResume(root) {
  const restored = await project.readProjectState(root)
  const snapshot = await projectTools.projectWorkspaceSnapshot(root, 'Cold-start restored workspace')
  const registered = new Map()
  projectTools.registerProjectTools({ tools: { register(tool) { registered.set(tool.name, tool) } } })
  const status = await registered.get('agent_project_status').execute({ project_root: root }, context(root))
  const item = restored?.workItems.find((candidate) => candidate.id === 'work-item-e2e')
  const delivered = snapshot?.report?.work_items_by_status?.delivered
  check('cold-start restores durable delivered project state', item?.status === 'delivered')
  check('cold-start tool status reads the restored project', status?.status === 'ready')
  check('cold-start UI projection exposes the delivered bucket', Array.isArray(delivered) && delivered.length === 1)
  check('cold-start UI projection retains the linked execution', Array.isArray(snapshot?.execution_links) && snapshot.execution_links.length === 1)
  console.log('product-flow-e2e cold-resume checks passed')
  process.exit(failures > 0 ? 1 : 0)
}

if (process.argv[2] === '--cold-resume') await coldResume(process.argv[3])

const root = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-product-e2e-'))
const brownfieldRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-product-brownfield-'))
try {
  const registered = new Map()
  projectTools.registerProjectTools(
    { tools: { register(tool) { registered.set(tool.name, tool) } } },
    { decisionCapabilityProvider: deterministicHostProvider() },
  )
  const model = new RecordedModel(root, registered)

  const init = await model.turn(
    'Start a long-lived project in this empty workspace and classify it as Greenfield.',
    () => model.tool('agent_project_init', { project_root: root, id: 'greenfield-e2e', title: 'Product E2E', goal: 'Ship a reviewed feature' }),
  )
  check('natural-language Greenfield turn persists discovery', init.discovery?.mode === 'greenfield' && init.status === 'initialized')
  const initialStatus = await model.tool('agent_project_status', { project_root: root })
  check('Greenfield status is available before planning', initialStatus.status === 'ready')

  await model.turn(
    'Ask the user an unresolved clarification about storage.',
    () => model.tool('agent_project_clarification', { project_root: root, action: 'ask', id: 'storage-backend', question: 'Which storage backend should the feature use?', options: ['SQLite', 'Postgres'] }),
  )
  await model.turn(
    'The user answers the clarification: choose SQLite.',
    () => model.tool('agent_project_clarification', { project_root: root, action: 'answer', id: 'storage-backend', answer: 'SQLite' }),
  )
  let state = await project.readProjectState(root)
  check('clarification question and answer are durable', state?.clarifications?.[0]?.status === 'answered' && state.clarifications[0].answer === 'SQLite')

  const requirement = {
    project_root: root, id: 'requirement-e2e', title: 'Reviewed feature requirement',
    statement: 'Build the SQLite-backed feature', scope: ['src/feature.ts'], out_of_scope: ['deployment'],
    acceptance_criteria: ['feature works', 'regression is covered'], clarification_ids: ['storage-backend'],
  }
  await model.turn('Draft the requirement from the clarified goal.', () => model.tool('agent_project_requirement_update', { ...requirement, status: 'draft' }))
  await model.turn('I explicitly confirm the requirement draft for this project.', () => model.tool('agent_project_requirement_update', { ...requirement, status: 'approved' }))
  state = await project.readProjectState(root)
  check('user confirmation creates host-capability requirement evidence', state?.requirement?.status === 'approved' && state.requirement.approvalDecision?.mode === 'host_capability')

  const design = {
    project_root: root, id: 'design-e2e', title: 'SQLite feature design', summary: 'Layered feature design',
    architecture: ['application layer', 'SQLite adapter'], module_boundaries: ['src/feature.ts'],
    interfaces: ['feature service'], data_model: ['feature row'], tradeoffs: ['local durability'],
    migration_strategy: ['none'], test_strategy: ['deterministic offline E2E'],
  }
  await model.turn('Draft the design for the approved requirement.', () => model.tool('agent_project_design_update', { ...design, status: 'draft' }))
  await model.turn('I explicitly approve the design for implementation.', () => model.tool('agent_project_design_update', { ...design, status: 'approved' }))
  const gate = await model.turn('The requirement and design are approved; assert the implementation gate before the approved DAG.', () => model.tool('agent_project_gate', { project_root: root, action: 'assert_implementation_allowed' }))
  check('design approval opens the implementation gate', gate.gates?.canPlanImplementation === true)

  await writeTeam(root, recordedTeam('greenfield-e2e', false))
  await model.tool('agent_project_work_item_update', {
    project_root: root, id: 'work-item-e2e', title: 'Deliver the SQLite feature', status: 'in_progress',
    requirement_id: 'requirement-e2e', design_id: 'design-e2e', team_id: 'team-product-e2e',
    task_ids: ['requirements-1', 'implementation-1', 'review-1'],
  })
  await model.turn('The implementation DAG ran and the review needs revision.', () => model.tool('agent_project_work_item_sync', { project_root: root, id: 'work-item-e2e', team_state_dir: '.agent-teams' }))
  state = await project.readProjectState(root)
  check('DAG execution projects Review needs_revision', state?.workItems.find((item) => item.id === 'work-item-e2e')?.status === 'failed_review')
  const failedTeam = recordedTeam('greenfield-e2e', false)
  check('recorded Harness DAG captures needs_revision after prerequisites', dependencyOrderIsComplete(failedTeam) && failedTeam.tasks.find((task) => task.id === 'review-1')?.verdict === 'needs_revision')

  await writeTeam(root, recordedTeam('greenfield-e2e', true))
  await model.turn('Repair the finding and run the repair re-review before acceptance.', async () => {
    evidence.harness.push({ event: 'repair/re-review', taskIds: ['repair-1', 'review-2'] })
    await model.tool('agent_project_work_item_update', {
      project_root: root, id: 'work-item-e2e', title: 'Deliver the SQLite feature', status: 'implemented_not_accepted',
      requirement_id: 'requirement-e2e', design_id: 'design-e2e', team_id: 'team-product-e2e',
      task_ids: ['requirements-1', 'implementation-1', 'repair-1', 'review-2'],
    })
    return model.tool('agent_project_work_item_sync', { project_root: root, id: 'work-item-e2e', team_state_dir: '.agent-teams' })
  })
  state = await project.readProjectState(root)
  const repairedTeam = recordedTeam('greenfield-e2e', true)
  check('repair and re-review produce a passing current DAG', dependencyOrderIsComplete(repairedTeam) && repairedTeam.tasks.find((task) => task.id === 'review-2')?.verdict === 'pass')
  check('re-review leaves the Work Item implemented_not_accepted', state?.workItems.find((item) => item.id === 'work-item-e2e')?.status === 'implemented_not_accepted')

  await model.turn('I accept the reviewed implementation after inspecting the evidence.', () => model.tool('agent_project_work_item_accept', { project_root: root, id: 'work-item-e2e', action: 'accept', note: 'Recorded user acceptance after re-review' }))
  state = await project.readProjectState(root)
  check('accept is a separate host-confirmed transition', state?.workItems.find((item) => item.id === 'work-item-e2e')?.status === 'accepted' && state.workItems[0].acceptanceDecision?.mode === 'host_capability')
  await model.turn('Deliver the accepted feature to the controlled Alpha channel.', () => model.tool('agent_project_work_item_accept', { project_root: root, id: 'work-item-e2e', action: 'deliver', note: 'Recorded delivery to controlled Alpha' }))
  state = await project.readProjectState(root)
  check('deliver requires prior acceptance and records a second decision', state?.workItems.find((item) => item.id === 'work-item-e2e')?.status === 'delivered' && state.workItems[0].deliveryDecision?.mode === 'host_capability')

  const snapshot = await projectTools.projectWorkspaceSnapshot(root, 'Product E2E workspace')
  check('UI projection exposes delivered Work Item and execution link', Array.isArray(snapshot?.report?.work_items_by_status?.delivered) && snapshot.report.work_items_by_status.delivered.length === 1 && snapshot.execution_links?.length === 1)

  const lifecycle = await runNode('scripts/lifecycle-verify.mjs')
  const lifecycleText = lifecycle.stdout + lifecycle.stderr
  const downstream = lifecycleText.includes('completing dependencies dispatches the downstream task')
  const repairRereview = lifecycleText.includes('needs_revision opens repair and next review')
  const downstreamSequence = outputMarkersAreOrdered(lifecycleText, [
    'dependency gate stays pending before both branches complete',
    'completing dependencies dispatches the downstream task',
  ])
  const repairRereviewSequence = outputMarkersAreOrdered(lifecycleText, [
    'review needs_revision cannot complete',
    'needs_revision opens repair and next review',
  ])
  const phase4 = await runNode('scripts/project-phase4-verify.mjs')
  const phase4Text = phase4.stdout + phase4.stderr
  const phase4RepairExecution = phase4Text.includes('PASS  repair execution projects to in_progress')
  const phase4RepairRound = phase4Text.includes('PASS  repair round projects to in_progress')
  const phase4Completed = phase4Text.includes('phase4 verification checks passed')
  check('deterministic Harness lifecycle proves downstream DAG dispatch', lifecycle.code === 0 && downstream)
  check('deterministic Harness lifecycle proves needs_revision repair/re-review', lifecycle.code === 0 && repairRereview)
  check('deterministic Harness lifecycle preserves downstream dispatch order', lifecycle.code === 0 && downstreamSequence)
  check('deterministic Harness lifecycle preserves repair/re-review order', lifecycle.code === 0 && repairRereviewSequence)
  check('project Phase 4 real verification proves repair status projection',
    phase4.code === 0 && phase4RepairExecution && phase4RepairRound && phase4Completed)
  evidence.harness.push({ suite: 'scripts/lifecycle-verify.mjs', code: lifecycle.code, downstream, repairRereview, downstreamSequence, repairRereviewSequence })
  evidence.harness.push({ suite: 'scripts/project-phase4-verify.mjs', code: phase4.code, repairExecution: phase4RepairExecution, repairRound: phase4RepairRound, completed: phase4Completed })

  const stress = await runNode('scripts/stress-verify.mjs')
  const stressText = stress.stdout + stress.stderr
  const coldRestart = stressText.includes('cold runtime restart redelivers every durable open task with a fresh attempt')
  check('deterministic Harness stress proves AgentTeams cold-start recovery', stress.code === 0 && coldRestart)
  evidence.harness.push({ suite: 'scripts/stress-verify.mjs', code: stress.code, coldRestart })

  const cold = await runNode('scripts/product-e2e-verify.mjs', ['--cold-resume', root])
  check('fresh Node process restores project/tool/UI state', cold.code === 0 && cold.stdout.includes('cold-resume checks passed'))
  check('cold-start evidence is explicit about its local boundary', evidence.releaseBoundary.externalLlmNaturalLanguage.startsWith('fail-closed'))

  await writeFile(join(brownfieldRoot, 'package.json'), '{"name":"recorded-brownfield"}\n')
  await mkdir(join(brownfieldRoot, 'src'), { recursive: true })
  await writeFile(join(brownfieldRoot, 'src', 'index.ts'), 'export const existing = true\n')
  const brownModel = new RecordedModel(brownfieldRoot, registered)
  const brown = await brownModel.turn(
    'Take over this existing Brownfield workspace and inspect its baseline.',
    () => brownModel.tool('agent_project_init', { project_root: brownfieldRoot, id: 'brownfield-e2e', title: 'Brownfield E2E', goal: 'Take over existing code' }),
  )
  check('natural-language Brownfield takeover records baseline evidence', brown.discovery?.mode === 'brownfield' && brown.discovery.manifests.includes('package.json') && brown.discovery.architectureEvidence.includes('top-level:src'))

  console.log('release boundary: external LLM, real browser UI, and real host confirmation remain FAIL-CLOSED')
  console.log('product-flow-e2e checks completed with ' + failures + ' failure(s)')
} finally {
  await rm(root, { recursive: true, force: true })
  await rm(brownfieldRoot, { recursive: true, force: true })
}

if (failures > 0) process.exit(1)
console.log('product-flow-e2e checks passed')
