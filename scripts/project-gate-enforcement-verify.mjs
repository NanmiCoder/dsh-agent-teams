import { assertImplementationPlanningAllowed } from '../lib/project.js'
import { planQualityFollowUp, projectTaskBindingError, validateCreateTask } from '../lib/quality-gates.js'

let passed = 0
function check(name, condition) {
  if (!condition) throw new Error('FAIL: ' + name)
  passed += 1
}
function rejects(fn) {
  try { fn() } catch { return true }
  return false
}

const binding = { projectId: 'project-1', projectRequirementId: 'req-1', projectRequirementVersion: 2, projectDesignId: 'design-1', projectDesignVersion: 3 }
const contract = { subject: 'implementation', kind: 'implementation', objective: 'implement the approved slice', acceptance: ['the slice works'], inScope: ['src/feature.ts'], verify: ['pnpm test'] }
const boundInput = { ...contract, projectId: binding.projectId, requirementId: binding.projectRequirementId, requirementVersion: binding.projectRequirementVersion, designId: binding.projectDesignId, designVersion: binding.projectDesignVersion }
const team = { name: 'project-team', id: 'project-team', ...binding, captainSessionId: 'captain', createdAt: 1, members: [], tasks: [], taskSeq: 0 }

check('unapproved project rejects implementation planning', rejects(() => assertImplementationPlanningAllowed({ requirement: { status: 'draft' }, design: { status: 'approved' }, clarifications: [] })))
check('missing project binding rejects execution task', validateCreateTask(team, contract).ok === false)
check('wrong project binding rejects execution task', validateCreateTask(team, { ...boundInput, designVersion: 99 }).ok === false)
check('matching approved binding allows execution task', validateCreateTask(team, boundInput).ok === true)

const legacyTeam = { name: 'legacy', id: 'legacy', captainSessionId: 'captain', createdAt: 1, members: [], tasks: [], taskSeq: 0 }
check('legacy kind=work remains compatible', validateCreateTask(legacyTeam, { subject: 'legacy work', kind: 'work' }).ok === true)
check('bound kind=work is rejected at task creation', validateCreateTask(team, { subject: 'project work', kind: 'work' }).ok === false)
check('bound omitted kind is rejected at task creation', validateCreateTask(team, { subject: 'implicit project work' }).ok === false)

const source = { id: 't1', subject: 'implementation', status: 'completed', dependencies: [], ...boundInput, createdAt: 1, updatedAt: 1 }
const review = { id: 't2', subject: 'review', status: 'failed', kind: 'review', reviewedTaskId: 't1', verdict: 'needs_revision', findings: [{ id: 'F1', severity: 'high', problem: 'bug', requiredFix: 'fix bug' }], dependencies: ['t1'], createdAt: 2, updatedAt: 2 }
const repairTeam = { ...team, tasks: [source, review], taskSeq: 2 }
const planned = planQualityFollowUp(repairTeam, review)
check('automatic repair inherits project binding', planned.created[0]?.projectId === binding.projectId && planned.created[0]?.requirementVersion === binding.projectRequirementVersion && planned.created[0]?.designVersion === binding.projectDesignVersion)
const oldTask = { ...source, requirementVersion: 1 }
const reopenedTeam = { ...team, projectRequirementVersion: 3 }
check('reopened requirement rejects old task binding', projectTaskBindingError(reopenedTeam, oldTask) !== undefined)
const boundWork = { id: 't-work', subject: 'project work', kind: 'work', status: 'pending', dependencies: [], createdAt: 1, updatedAt: 1 }
check('bound kind=work is rejected by existing-task gates', projectTaskBindingError(team, boundWork) !== undefined)

console.log('project-gate-enforcement-verify: ' + passed + ' assertions passed')
