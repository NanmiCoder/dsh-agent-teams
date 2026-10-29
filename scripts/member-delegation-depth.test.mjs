// Member delegation depth: AgentTeams bounds a member-relative budget
// (`memberMaxDepth`), while the Host bounds absolute delegation depth
// (`subagent.maxDepth`, default 1). A member already occupies Host depth 1, so
// the two gates disagree by construction and the Host refusal used to surface
// as the bare `subagent depth 2 exceeds maxDepth 1`.
//
// These cases pin the behaviour that makes that state actionable:
//   T1 the Host refusal is translated (numbers, setting path, member, cause)
//   T2 every other failure passes through untouched
//   T3 `memberMaxDepth: 0` keeps the plugin's own existing message
//   T4/T5 the spawn-time advisory fires only for an unreachable configuration
//   T6/T7 the Host capability probes degrade instead of throwing
//
// The fixture mirrors scripts/corrupt-teamjson.test.mjs: a real team.json under
// a temporary state directory, a member session carrying the AgentTeams
// descriptor label, and a fake subagents runtime whose creation APIs already
// exist before the guard wraps them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { delegationAdvisory, installMemberDelegationGuard } from '../lib/members.js'
import { hostDelegationBudget, hostDelegationDepth, isHostDepthRefusal } from '../lib/harness-compat.js'

const { SUBAGENT_DESCRIPTOR_VERSION } = await import('@deepseek-ai/dsh-subagent')

const STATE_DIR = '.agent-teams'
const CAPTAIN_ID = 'captain-session-0001'
const MEMBER_ID = 'member-session-0001'
const MEMBER_NAME = 'verifier'
const TEAM_ID = 'team-a'
const NOW = 1_700_000_000_000

const validTeam = (overrides = {}) => ({
  id: TEAM_ID,
  name: 'Delegation Depth Team',
  captainSessionId: CAPTAIN_ID,
  createdAt: NOW,
  members: [{ id: MEMBER_ID, name: MEMBER_NAME, role: 'engineer', joinedAt: NOW, status: 'idle' }],
  tasks: [],
  taskSeq: 0,
  ...overrides,
})

async function workspaceWith(team) {
  const root = await mkdtemp(join(tmpdir(), 'member-delegation-depth-'))
  const stateRoot = join(root, STATE_DIR)
  await mkdir(join(stateRoot, TEAM_ID, 'inbox'), { recursive: true })
  await writeFile(join(stateRoot, TEAM_ID, 'team.json'), JSON.stringify(team, null, 2))
  return { root }
}

function memberSession(cwd) {
  return {
    header: { cwd },
    ownEvents: () => [{
      type: 'subagent/descriptor',
      data: { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 'in-process', label: `agent-teams:${TEAM_ID}:${MEMBER_NAME}` },
    }],
  }
}

const hostRefusal = () => Object.assign(new Error('subagent depth 2 exceeds maxDepth 1'), {
  name: 'SubagentDepthError', attemptedDepth: 2, maxDepth: 1,
})

/**
 * Mount the guard over a fake Host runtime. The Host creation API must exist
 * before installation because the guard only wraps available methods.
 * @param root - workspace root holding the state directory.
 * @param maxDepth - configured member-relative budget.
 * @param failure - what every Host creation call throws.
 */
function mount(root, maxDepth, failure) {
  const host = { calls: 0 }
  const runtime = {
    start: async () => ({ childId: 'child' }),
    startContinuable: async () => ({ childId: 'child' }),
    startActivation: async () => { host.calls++; throw failure() },
  }
  const ctx = { subagents: runtime, agents: { get: () => undefined }, effect: f => f() }
  installMemberDelegationGuard(ctx, STATE_DIR, maxDepth)
  return { runtime, host, parent: { id: MEMBER_ID, session: memberSession(root) } }
}

const activation = parent => ({ request: { parent }, delivery: 'parent' })

test('T1: the Host depth refusal becomes an actionable AgentTeams error', async t => {
  const { root } = await workspaceWith(validTeam())
  t.after(() => rm(root, { recursive: true, force: true }))
  const failure = hostRefusal()
  const { runtime, host, parent } = mount(root, 1, () => failure)
  await assert.rejects(
    runtime.startActivation(activation(parent)),
    error => {
      assert.match(error.message, /Maximum recursion depth/, 'must name the Host setting')
      assert.match(error.message, /Plugins → Subagent/, 'must name the UI path')
      assert.match(error.message, /at least 2/, 'must state the required depth')
      assert.match(error.message, new RegExp(MEMBER_NAME), 'must name the delegating member')
      assert.match(error.message, /subagent depth 2 exceeds maxDepth 1/, 'must keep the Host text')
      assert.equal(error.cause, failure, 'the Host error must be preserved as the cause')
      return true
    },
  )
  assert.equal(host.calls, 1, 'the Host must still be the authority that rejects')
})

test('T2: non-depth failures pass through untouched', async t => {
  const { root } = await workspaceWith(validTeam())
  t.after(() => rm(root, { recursive: true, force: true }))
  const { runtime, parent } = mount(root, 1, () => new Error('quota exceeded'))
  await assert.rejects(runtime.startActivation(activation(parent)), error => {
    assert.equal(error.message, 'quota exceeded')
    assert.doesNotMatch(error.message, /Maximum recursion depth/)
    assert.equal(error.cause, undefined)
    return true
  })
})

test('T3: memberMaxDepth 0 keeps the plugin limit message and never calls the Host', async t => {
  const { root } = await workspaceWith(validTeam())
  t.after(() => rm(root, { recursive: true, force: true }))
  const { runtime, host, parent } = mount(root, 0, hostRefusal)
  await assert.rejects(runtime.startActivation(activation(parent)), /AgentTeams member delegation limit \(0\) reached/)
  assert.equal(host.calls, 0, 'the plugin guard must decide before the Host runs')
})

test('T4: the spawn advisory explains a member budget the Host cannot admit', () => {
  const advisory = delegationAdvisory({ memberMaxDepth: 1, memberDepth: 1, hostMaxDepth: 1, memberName: MEMBER_NAME })
  assert.equal(typeof advisory, 'string')
  assert.match(advisory, /subagent\.maxDepth/)
  assert.match(advisory, /at least 2/)
  assert.match(advisory, new RegExp(MEMBER_NAME))
})

test('T5: the spawn advisory stays silent for coherent or unknown configurations', () => {
  assert.equal(delegationAdvisory({ memberMaxDepth: 0, memberDepth: 1, hostMaxDepth: 1 }), undefined,
    'delegation disabled is not a misconfiguration')
  assert.equal(delegationAdvisory({ memberMaxDepth: 1, memberDepth: 1, hostMaxDepth: undefined }), undefined,
    'an unreadable Host budget cannot be judged')
  assert.equal(delegationAdvisory({ memberMaxDepth: 1, memberDepth: 1, hostMaxDepth: 2 }), undefined,
    'a budget that admits one child is coherent')
})

test('T6: an unavailable or invalid Host budget probe degrades to undefined', () => {
  assert.equal(hostDelegationBudget({}), undefined, 'missing API')
  assert.equal(hostDelegationBudget({ resolveMaxDepth() { throw new Error('unavailable') } }), undefined, 'throwing API')
  assert.equal(hostDelegationBudget({ resolveMaxDepth() { return 'provider-managed' } }), undefined, 'provider-managed')
  assert.equal(hostDelegationBudget({ resolveMaxDepth() { return 2 } }), 2, 'a numeric Host setting is reported')
})

test('T7: agent depth falls back to the persisted header without the Host function', () => {
  assert.equal(hostDelegationDepth({ session: { header: { delegationDepth: 1 } } }), 1)
  assert.equal(hostDelegationDepth({ session: { header: {} } }), 0)
})

test('T8: a class name alone is not a depth refusal', () => {
  assert.equal(isHostDepthRefusal(Object.assign(new Error('opaque'), { name: 'SubagentDepthError' })), false,
    'the numeric fields are part of the contract')
  assert.equal(isHostDepthRefusal(hostRefusal()), true)
})
