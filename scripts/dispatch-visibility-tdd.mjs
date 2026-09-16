/**
 * Durable visibility of rejected member dispatches.
 *
 * The defect this guards (#166, #168, #170): a rejected dispatch — an unknown
 * `toolFilter.deny` name, a provider that is not registered, a model route that
 * will not resolve — threw inside `dispatchMember`, was swallowed into a
 * `logger.warn` that no web/desktop host ever displays, and the scheduler rolled
 * the task back to `pending`. The captain's whole symptom was a member that
 * never left `unspawned` next to an `attempt` counter that kept climbing, which
 * is not something anyone can diagnose without patching the plugin.
 *
 * The fix records the reason on the durable team record, so `agent_teams_status`
 * — and `team.json` itself — answer "why is nobody starting?".
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearDispatchFailure, createTeamDir, readTeam, recordDispatchFailure } from '../lib/state.js'

/** The real string from the reports, so the fixture reads like the incident. */
const REASON = 'tools.restrict() names unknown global tool "subagent"'

function baseTeam() {
  return {
    name: 'dispatch-visibility',
    id: 'dispatch-visibility',
    description: 'why members do not start',
    captainSessionId: 'session-captain',
    createdAt: 1,
    members: [{ id: '', name: 'w1', role: 'engineer', provider: 'p', model: 'm', joinedAt: 1, status: 'idle' }],
    tasks: [{ id: 't1', subject: 'work', status: 'pending', dependencies: [], assignee: 'w1', kind: 'work', attempt: 1, createdAt: 1, updatedAt: 1 }],
    taskSeq: 1,
    phase: 'running',
  }
}

async function stateRootFor(t) {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-dispatch-visibility-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  return join(workspace, '.agent-teams')
}

await test('a rejected dispatch leaves a reason that outlives the turn', async (t) => {
  const stateRoot = await stateRootFor(t)
  const team = baseTeam()
  recordDispatchFailure(team, 'w1', REASON, 1234)
  assert.deepEqual(team.lastDispatchError, { at: 1234, member: 'w1', reason: REASON })

  await createTeamDir(stateRoot, team)
  const reread = await readTeam(stateRoot, team.id)
  assert.equal(reread?.lastDispatchError?.reason, REASON, 'the reason has to survive the durable round trip')
  assert.equal(reread?.lastDispatchError?.member, 'w1')
  assert.equal(reread?.lastDispatchError?.at, 1234)
})

await test('a successful dispatch clears the previous rejection', async (t) => {
  const stateRoot = await stateRootFor(t)
  const team = baseTeam()
  recordDispatchFailure(team, 'w1', REASON)
  clearDispatchFailure(team)
  assert.equal(team.lastDispatchError, undefined)

  await createTeamDir(stateRoot, team)
  const reread = await readTeam(stateRoot, team.id)
  assert.equal(reread?.lastDispatchError, undefined, 'a cleared rejection must not come back through the round trip')
})

await test('the latest rejection wins, so the record never mixes members', async (t) => {
  const stateRoot = await stateRootFor(t)
  const team = baseTeam()
  recordDispatchFailure(team, 'w1', 'first', 1)
  recordDispatchFailure(team, 'w2', 'second', 2)

  await createTeamDir(stateRoot, team)
  const reread = await readTeam(stateRoot, team.id)
  assert.deepEqual(reread?.lastDispatchError, { at: 2, member: 'w2', reason: 'second' })
})

await test('a malformed rejection fails the durable boundary instead of rendering garbage', async (t) => {
  const stateRoot = await stateRootFor(t)
  const team = baseTeam()
  const malformed = [
    { at: 'soon', member: 'w1', reason: REASON },
    { at: 1, member: 7, reason: REASON },
    { at: 1, member: 'w1' },
    {},
  ]
  for (const lastDispatchError of malformed) {
    await createTeamDir(stateRoot, { ...team, lastDispatchError })
    await assert.rejects(
      () => readTeam(stateRoot, team.id),
      /invalid AgentTeams state/,
      `expected ${JSON.stringify(lastDispatchError)} to be rejected at the durable boundary`,
    )
  }
})
