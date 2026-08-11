#!/usr/bin/env node
/**
 * Offline smoke verification for dsh-agent-teams.
 *
 * Runs the pure team-logic rules and the on-disk persistence flow against a
 * throwaway temp directory. Requires a prior `pnpm build` (lib/ present).
 * Does not touch any running DSH instance or profile.
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

console.log('4/4 done')
if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall checks passed')
