#!/usr/bin/env node
/**
 * Offline smoke verification for dsh-agent-teams.
 *
 * Runs the pure team-logic rules, the on-disk persistence flow, and the
 * browser workbench fold (events -> workbench projection) against throwaway
 * temp state. Requires a prior `pnpm build` (lib/ present). Does not touch
 * any running DSH instance or profile.
 *
 * Usage: node scripts/verify.mjs
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CAPTAIN_KEY,
  appendMailbox,
  createMessage,
  createTeamDir,
  findTeamByCaptain,
  readMailbox,
  readTeam,
  removeTeamDir,
  sanitizeKey,
  transitionError,
  unsatisfiedDependencies,
  withTeamLock,
} from '../lib/state.js'

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`)
  } else {
    failures += 1
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('dsh-agent-teams offline verification')
console.log('1/4 pure rules')
check("sanitizeKey('My Team!') -> 'my-team'", sanitizeKey('My Team!') === 'my-team')
check("sanitizeKey('!!!') falls back to 'team'", sanitizeKey('!!!') === 'team')
check('pending -> claimed allowed', transitionError('pending', 'claimed') === undefined)
check('pending -> in_progress denied', transitionError('pending', 'in_progress') !== undefined)
check('in_progress -> completed allowed', transitionError('in_progress', 'completed') === undefined)
check('completed -> in_progress denied', transitionError('completed', 'in_progress') !== undefined)
check('same status is a no-op', transitionError('failed', 'failed') === undefined)

console.log('2/4 dependency gating')
const tasks = [
  { id: 't1', status: 'completed' },
  { id: 't2', status: 'pending' },
  { id: 't3', status: 'failed' },
]
check('all-done deps satisfied', unsatisfiedDependencies(tasks, ['t1']).length === 0)
check('pending dep blocks', unsatisfiedDependencies(tasks, ['t2']).length === 1)
check('failed dep blocks too', unsatisfiedDependencies(tasks, ['t3']).length === 1)

console.log('3/4 on-disk team flow (temp dir)')
const stateRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-verify-'))
try {
  const team = {
    name: 'Verify Team',
    id: sanitizeKey('Verify Team'),
    description: 'smoke',
    captainSessionId: 'sess-captain',
    createdAt: Date.now(),
    members: [],
    tasks: [],
    taskSeq: 0,
  }
  await createTeamDir(stateRoot, team)

  const reread = await readTeam(stateRoot, team.id)
  check('team.json round-trips', reread?.id === team.id && reread.captainSessionId === 'sess-captain')

  const found = await findTeamByCaptain(stateRoot, 'sess-captain')
  check('findTeamByCaptain finds the team', found?.id === team.id)
  check('findTeamByCaptain ignores other captains', await findTeamByCaptain(stateRoot, 'sess-other') === undefined)

  const message = createMessage('alice', CAPTAIN_KEY, 'hello captain')
  await withTeamLock(team.id, async () => {
    await appendMailbox(stateRoot, team.id, CAPTAIN_KEY, message)
  })
  const inbox = await readMailbox(stateRoot, team.id, CAPTAIN_KEY)
  check('mailbox append/read round-trips', inbox.length === 1 && inbox[0].content === 'hello captain')
  check('missing mailbox reads empty', (await readMailbox(stateRoot, team.id, 'nobody')).length === 0)

  await removeTeamDir(stateRoot, team.id)
  check('removeTeamDir removes the team', await readTeam(stateRoot, team.id) === undefined)
} finally {
  await rm(stateRoot, { recursive: true, force: true })
}

console.log('4/4 client workbench fold (Conversation Node)')
const { agentTeamsRunDefinition, layoutWorkbenchTasks, projectWorkbench, workbenchTaskState } =
  await import('../lib/client/agent-teams-definition.js')
const def = agentTeamsRunDefinition
const startMatch = {
  event: { type: 'agent-teams/team-created', data: { teamId: 'demo', name: 'Demo Team' } },
  role: 'start',
  location: { kind: 'turn' },
}
const update = (state, event, seq) => def.update({ state }, { event, role: 'update', location: { kind: 'turn' }, seq })
let state = def.start({}, startMatch, undefined)
check('start seeds empty team', state.members.length === 0 && state.tasks.length === 0 && state.messages.length === 0)
state = update(state, {
  type: 'agent-teams/member-added',
  data: { teamId: 'demo', memberId: 'sess-alice', name: 'alice', role: 'researcher' },
}, 10)
state = update(state, {
  type: 'agent-teams/member-added',
  data: { teamId: 'demo', memberId: 'sess-bob', name: 'bob' },
}, 11)
check('member-added folds two members', state.members.length === 2)
state = update(state, {
  type: 'agent-teams/task-created',
  data: { teamId: 'demo', taskId: 't1', subject: '调研', dependencies: [], assignee: 'alice' },
}, 12)
state = update(state, {
  type: 'agent-teams/task-created',
  data: { teamId: 'demo', taskId: 't2', subject: '写报告', dependencies: ['t1'] },
}, 13)
state = update(state, {
  type: 'agent-teams/task-updated',
  data: { teamId: 'demo', taskId: 't1', status: 'claimed', assignee: 'alice' },
}, 14)
let bench = projectWorkbench(state)
check('workbench keeps the team name', bench.teamName === 'Demo Team')
check('workbench status running', bench.status === 'running')
check('workbench has two members', bench.members.length === 2)
check('claimed task is open (not blocked)', bench.tasks.find(t => t.id === 't1')?.state === 'open')
check('dependent task is blocked while t1 open', bench.tasks.find(t => t.id === 't2')?.state === 'blocked')
check('t2 sits one lane deeper than t1',
  (bench.tasks.find(t => t.id === 't1')?.depth ?? -1) === 0
  && (bench.tasks.find(t => t.id === 't2')?.depth ?? -1) === 1)
check('two lanes laid out', bench.lanes.length === 2)

state = update(state, {
  type: 'agent-teams/task-updated',
  data: { teamId: 'demo', taskId: 't1', status: 'in_progress', assignee: 'alice' },
}, 15)
bench = projectWorkbench(state)
check('in_progress task is running', bench.tasks.find(t => t.id === 't1')?.state === 'running')
check('alice current task is t1', bench.members.find(m => m.name === 'alice')?.currentTask === 't1')
check('t2 unlocks when t1 completed', (() => {
  const s2 = update(state, {
    type: 'agent-teams/task-updated',
    data: { teamId: 'demo', taskId: 't1', status: 'completed', output: 'done' },
  }, 16)
  const b = projectWorkbench(s2)
  return b.tasks.find(t => t.id === 't2')?.state === 'open'
})(), '')
check('alice progress is 1/1', (() => {
  const s2 = update(state, {
    type: 'agent-teams/task-updated',
    data: { teamId: 'demo', taskId: 't1', status: 'completed', output: 'done' },
  }, 16)
  const b = projectWorkbench(s2)
  const alice = b.members.find(m => m.name === 'alice')
  return alice?.done === 1 && alice?.total === 1 && alice?.progress === 100
})(), '')

state = update(state, {
  type: 'agent-teams/message-sent',
  data: { teamId: 'demo', messageId: 'm1', from: 'alice', to: 'bob', content: '帮我看看', ts: 1000 },
}, 17)
state = update(state, {
  type: 'agent-teams/message-sent',
  data: { teamId: 'demo', messageId: 'm2', from: 'bob', to: 'captain', content: '完成', ts: 1001 },
}, 18)
bench = projectWorkbench(state)
check('messages fold in order', bench.messages.length === 2 && bench.messages[0]?.from === 'alice')
check('bob unread badge counts alice message', bench.members.find(m => m.name === 'bob')?.unread === 1)
check('layout math: no overlapping cards', (() => {
  const layout = layoutWorkbenchTasks(state.tasks)
  const seen = new Set()
  for (const task of layout.tasks) {
    const key = `${task.x},${task.y}`
    if (seen.has(key)) return false
    seen.add(key)
  }
  return true
})(), '')
check('workbenchTaskState closed union', (() => {
  const s2 = update(state, {
    type: 'agent-teams/task-updated',
    data: { teamId: 'demo', taskId: 't2', status: 'completed', output: 'ok' },
  }, 19)
  return projectWorkbench(s2).tasks.every(t => ['blocked', 'open', 'running', 'completed'].includes(t.state))
})(), '')

console.log('5/5 done')
if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall checks passed')
