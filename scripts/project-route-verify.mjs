import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInitialProjectState, writeProjectState } from '../src/project.ts'
import { projectWorkspaceSnapshot } from '../src/project-tools.ts'

let failures = 0
function check(label, condition) {
  if (condition) console.log('  PASS  ' + label)
  else { failures += 1; console.error('  FAIL  ' + label) }
}

const root = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-project-route-'))
try {
  check('uninitialized workspace is omitted', await projectWorkspaceSnapshot(root, 'Empty') === undefined)

  const state = createInitialProjectState({
    id: 'route-project',
    title: 'Route project',
    goal: 'verify the project overview payload',
    mode: 'greenfield',
    now: 1,
  })
  state.workItems.push({
    id: 'wi-1',
    title: 'Implement feature',
    status: 'in_progress',
    teamId: 'team-1',
    taskIds: ['task-1'],
    updatedAt: 1,
  })
  await writeProjectState(root, state)

  const teamRoot = join(root, '.agent-teams', 'team-1')
  await mkdir(teamRoot, { recursive: true })
  await writeFile(join(teamRoot, 'team.json'), JSON.stringify({
    id: 'team-1',
    name: 'Feature team',
    captainSessionId: 'captain',
    createdAt: 1,
    members: [],
    taskSeq: 1,
    tasks: [{
      id: 'task-1',
      subject: 'Implement feature',
      status: 'in_progress',
      dependencies: [],
      createdAt: 1,
      updatedAt: 1,
    }],
  }))

  const snapshot = await projectWorkspaceSnapshot(root, 'Demo workspace')
  const report = snapshot?.report
  const buckets = report?.work_items_by_status
  const links = snapshot?.execution_links
  check('snapshot includes the workspace and durable status', snapshot?.workspace === 'Demo workspace' && snapshot.status !== undefined)
  check('snapshot includes report status buckets', Array.isArray(buckets?.in_progress) && buckets.in_progress.length === 1)
  check('snapshot blocks an unbound Team linked from a Project Work Item', Array.isArray(links) && links.length === 1 && links[0].projected_status === 'blocked' && links[0].link_status === 'link_invalid')

  await writeFile(join(teamRoot, 'team.json'), '{malformed')
  const degraded = await projectWorkspaceSnapshot(root, 'Demo workspace')
  check('malformed team state does not hide durable project status', degraded !== undefined && Array.isArray(degraded.execution_links) && degraded.execution_links.length === 1 && (degraded.execution_links[0].team_state_error === 'corrupt' || degraded.execution_links[0].team_state_error === 'missing' || degraded.execution_links[0].projected_status === 'blocked'))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) process.exit(1)
console.log('project route verification checks passed')
