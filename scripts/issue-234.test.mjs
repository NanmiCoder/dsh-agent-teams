// Issue #234 regression: a gateway-materialized empty `plan` shell must count
// as "not provided".
//
// Some model gateways materialize optional object parameters instead of
// omitting them, so a call that only passed `profile: "dev-team"` arrives
// carrying `plan: { members: [], tasks: [] }`, or one placeholder member whose
// every field is blank — both shapes were observed on one installation with
// such a gateway. `agent_teams_create` used to treat that shell as an inline
// plan, so every profile-only call died on `choose either a configured profile
// or an inline plan`.
//
// These cases drive the REAL tool execution path: a real Cordis Context +
// `ToolRuntime` dispatch the registered `agent_teams_create`, so the declared
// parameter schema validates every call exactly like production, while the
// surrounding host services (llm routing, subagent runtime) stay minimal fakes.
// Positive cases assert the staged `team.json` really landed with the profile
// roster; the mutual-exclusion guard and the inline-plan branch are pinned too,
// so the normalization cannot silently widen the "not provided" bucket.
//
// Semantic choice (deliberate): this mirrors issue #99's "a materialized blank
// equals not provided" invariant. A blank profile plus an empty shell therefore
// falls into the existing plain empty-team branch instead of gaining a new
// error message.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { registerAgentTeamsTools } from '../lib/tools.js'
import { readTeam, sanitizeKey, writeTeam } from '../lib/state.js'

const requireTools = createRequire(import.meta.resolve('@deepseek-ai/dsh-tools'))
const { createScope } = await import(pathToFileURL(requireTools.resolve('@deepseek-ai/dsh-scope')).href)

const PROFILE = 'issue-234-team'
const PROFILES = {
  [PROFILE]: {
    members: [{ name: 'fixer', role: 'engineer' }],
    tasks: [{ id: 'seed-1', subject: 'apply the fix', assignee: 'fixer' }],
  },
}

/** The two shells real gateways produced, plus a genuine inline plan. */
const EMPTY_ARRAY_SHELL = { members: [], tasks: [] }
const PLACEHOLDER_MEMBER_SHELL = {
  members: [{ name: '', role: '', provider: '', model: '', reasoning_effort: '' }],
  tasks: [],
}
const REAL_PLAN = {
  members: [{ name: 'scout', role: 'analyst' }],
  tasks: [{ id: 't1', subject: 'survey the roster', assignee: 'scout' }],
}

/**
 * Mount the real tool runtime over the shipped `agent_teams_create`.
 * @returns the dispatch helper plus real on-disk team readers.
 */
async function mount() {
  const workspace = await mkdtemp(join(tmpdir(), 'agentteams-234-'))
  const host = new Context()
  const prompt = host.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await prompt.await()
  const runtime = host.plugin(ToolRuntime, { mode: 'native' })
  await runtime.await()
  const definitions = []
  const agents = []
  const noop = () => {}
  registerAgentTeamsTools({
    on: () => noop,
    effect: setup => setup(),
    logger: { warn: noop, debug: noop },
    tools: { register: definition => definitions.push(definition) },
    agents: { get: id => agents.find(agent => agent.id === id) },
    llm: { async resolveCallConfig(config) { return config }, async listModels() { return [] } },
    subagents: { followup: async () => {}, registerContinuableSetup: () => noop },
  }, { stateDir: '.agent-teams', memberProvider: 'spawn', memberMaxDepth: 1, maxMembers: 8, profiles: PROFILES })
  let owned
  const business = host.plugin({
    inject: ['tools'],
    apply(ctx) {
      owned = ctx
      for (const definition of definitions) ctx.tools.register(definition)
      ctx.provide('agents', { list: () => agents })
    },
  })
  await business.await()
  let seq = 0
  const createCaptain = id => {
    const events = []
    const agent = {
      id,
      status: 'idle',
      options: { provider: 'fake', model: 'fake-model' },
      session: {
        id,
        header: { cwd: workspace, seedLength: 0 },
        events,
        inheritedEventCount: 0,
        get seq() { return events.length },
        snapshotEvents: () => events.slice(),
        eventAt: index => events[index],
        requestHeader: () => ({ config: { provider: 'fake', model: 'fake-model' } }),
        append(type, data) { const event = { seq: events.length, type, data }; events.push(event); return event },
      },
    }
    const scope = createScope(owned, agent)
    agent.ctx = scope.ctx
    agents.push(agent)
    return agent
  }
  const execute = (agent, args) => host.tools.execute({
    name: 'agent_teams_create',
    arguments: args,
    callId: `issue-234-${++seq}`,
    agent,
    signal: new AbortController().signal,
  })
  /** Dispatch any registered tool through the same real runtime path. */
  const executeTool = (agent, name, args) => host.tools.execute({
    name,
    arguments: args,
    callId: `issue-234-${name}-${++seq}`,
    agent,
    signal: new AbortController().signal,
  })
  const stateRoot = join(workspace, '.agent-teams')
  const loadTeam = teamId => readTeam(stateRoot, teamId)
  const saveTeam = team => writeTeam(stateRoot, team)
  const teamPath = teamId => join(workspace, '.agent-teams', teamId, 'team.json')
  const readCreated = async teamId => JSON.parse(await readFile(teamPath(teamId), 'utf8'))
  const exists = async teamId => {
    try {
      await readFile(teamPath(teamId), 'utf8')
      return true
    } catch {
      return false
    }
  }
  return {
    createCaptain,
    execute,
    executeTool,
    loadTeam,
    saveTeam,
    readCreated,
    exists,
    dispose: () => rm(workspace, { recursive: true, force: true }),
  }
}

for (const [label, plan] of [['an empty-array shell', EMPTY_ARRAY_SHELL], ['a placeholder-member shell', PLACEHOLDER_MEMBER_SHELL]]) {
  await test(`a profile with ${label} creates the configured profile team (issue #234)`, async () => {
    const fixture = await mount()
    try {
      const captain = fixture.createCaptain(`captain-shell-${sanitizeKey(label)}`)
      const result = await fixture.execute(captain, {
        name: `Shell ${sanitizeKey(label)}`,
        description: 'gateway materialized an optional plan parameter',
        approval: 'required',
        profile: PROFILE,
        plan,
      })
      assert.equal(result.isError, false, JSON.stringify(result))
      assert.doesNotMatch(JSON.stringify(result), /choose either a configured profile or an inline plan/)
      assert.equal(result.value.profile, PROFILE)
      // The profile branch really ran: the configured roster is on disk, staged.
      const team = await fixture.readCreated(result.value.team_id)
      assert.equal(team.phase, 'staged')
      assert.equal(team.profile.name, PROFILE)
      assert.deepEqual(team.members.map(member => member.name), ['fixer'])
      assert.deepEqual(team.tasks.map(task => task.profileSeedId), ['seed-1'])
    } finally {
      await fixture.dispose()
    }
  })
}

await test('a profile with a real inline plan still trips the mutual-exclusion guard (issue #234)', async () => {
  const fixture = await mount()
  try {
    const captain = fixture.createCaptain('captain-real-plan-with-profile')
    const result = await fixture.execute(captain, {
      name: 'Real Plan With Profile',
      approval: 'required',
      profile: PROFILE,
      plan: REAL_PLAN,
    })
    assert.equal(result.isError, true, JSON.stringify(result))
    assert.match(JSON.stringify(result), /choose either a configured profile or an inline plan/)
    assert.equal(await fixture.exists(sanitizeKey('Real Plan With Profile')), false)
  } finally {
    await fixture.dispose()
  }
})

await test('a substantive member plus empty tasks is a real plan, not a shell (issue #234)', async () => {
  const fixture = await mount()
  try {
    const captain = fixture.createCaptain('captain-member-with-empty-tasks')
    const result = await fixture.execute(captain, {
      name: 'Member Without Tasks',
      approval: 'required',
      profile: PROFILE,
      plan: { members: REAL_PLAN.members, tasks: [] },
    })
    assert.equal(result.isError, true, JSON.stringify(result))
    assert.match(JSON.stringify(result), /choose either a configured profile or an inline plan/)
  } finally {
    await fixture.dispose()
  }
})

await test('a real inline plan without a profile still builds the inline roster (issue #234)', async () => {
  const fixture = await mount()
  try {
    const captain = fixture.createCaptain('captain-inline-plan')
    const result = await fixture.execute(captain, {
      name: 'Inline Plan',
      approval: 'required',
      plan: REAL_PLAN,
    })
    assert.equal(result.isError, false, JSON.stringify(result))
    assert.equal(result.value.profile, undefined)
    const team = await fixture.readCreated(result.value.team_id)
    assert.equal(team.profile, undefined)
    assert.deepEqual(team.members.map(member => member.name), ['scout'])
    assert.deepEqual(team.tasks.map(task => task.profileSeedId), ['t1'])
  } finally {
    await fixture.dispose()
  }
})

await test('a blank profile plus an empty shell equals "neither provided" (issue #234)', async () => {
  const fixture = await mount()
  try {
    const captain = fixture.createCaptain('captain-blank-profile-shell')
    const result = await fixture.execute(captain, {
      name: 'Blank Profile Shell',
      approval: 'required',
      profile: '',
      plan: EMPTY_ARRAY_SHELL,
    })
    // Same invariant as issue #99: the materialized blank counts as omitted, so
    // the existing plain empty-team branch handles it — no new error text.
    assert.equal(result.isError, false, JSON.stringify(result))
    assert.doesNotMatch(JSON.stringify(result), /choose either a configured profile or an inline plan/)
    const team = await fixture.readCreated(result.value.team_id)
    assert.equal(team.profile, undefined)
    assert.deepEqual(team.members, [])
    assert.deepEqual(team.tasks, [])
  } finally {
    await fixture.dispose()
  }
})

/**
 * Mount a running team with one spawned member ("fixer"), a sibling member
 * ("scout") and the tasks the claim_task cases below need. Real gateways
 * materialize the deprecated `assignee` argument, so the claim path is driven
 * with the exact shapes a model sends.
 * @param extraTasks - additional tasks appended to the fixture roster.
 * @returns the fixture plus the captain / member / sibling agents.
 */
async function mountRunningTeam(extraTasks = []) {
  const fixture = await mount()
  const captain = fixture.createCaptain('captain-claim')
  const fixer = fixture.createCaptain('member-fixer')
  const scout = fixture.createCaptain('member-scout')
  const created = await fixture.execute(captain, { name: 'Claim Team', approval: 'required', profile: PROFILE })
  assert.equal(created.isError, false, JSON.stringify(created))
  const team = await fixture.loadTeam(created.value.team_id)
  const now = Date.now()
  const task = (id, subject, assignee, status, extra = {}) => ({
    id,
    subject,
    status,
    assignee,
    dependencies: [],
    attempt: 0,
    createdAt: now,
    updatedAt: now,
    ...extra,
  })
  team.phase = 'running'
  delete team.planReviewState
  team.members = [
    { ...team.members[0], id: fixer.id },
    { id: scout.id, name: 'scout', role: 'analyst', provider: 'fake', model: 'fake-model', joinedAt: now, status: 'idle' },
  ]
  team.tasks = [
    task('t1', 'member task', 'fixer', 'pending'),
    task('t2', 'other member task', 'scout', 'pending'),
    task('t3', 'captain takeover', 'captain', 'claimed', { attempt: 1, attemptId: 'captain-attempt-1' }),
    ...extraTasks,
  ]
  team.taskSeq = team.tasks.length
  await fixture.saveTeam(team)
  return { fixture, captain, fixer, scout, teamId: team.id }
}

await test('a member claim ignores a blank or self-named materialized assignee (issue #234 follow-up)', async () => {
  const { fixture, fixer, teamId } = await mountRunningTeam()
  try {
    const blank = await fixture.executeTool(fixer, 'agent_teams_claim_task', { task_id: 't1', assignee: '' })
    assert.equal(blank.isError, false, JSON.stringify(blank))
    assert.doesNotMatch(JSON.stringify(blank), /members cannot set assignee when claiming a task/)
    assert.equal(blank.value.assignee, 'fixer')
    assert.equal(blank.value.status, 'claimed')
    assert.equal(typeof blank.value.attempt_id, 'string')
    let team = await fixture.loadTeam(teamId)
    assert.equal(team.tasks.find(entry => entry.id === 't1').status, 'claimed')
    assert.equal(team.tasks.find(entry => entry.id === 't1').attemptId, blank.value.attempt_id)

    // Restating the caller's own member name asks for exactly what a claim does;
    // the retry the gateway produced must return the same attempt, not an error.
    const selfNamed = await fixture.executeTool(fixer, 'agent_teams_claim_task', { task_id: 't1', assignee: 'fixer' })
    assert.equal(selfNamed.isError, false, JSON.stringify(selfNamed))
    assert.doesNotMatch(JSON.stringify(selfNamed), /members cannot set assignee when claiming a task/)
    assert.equal(selfNamed.value.assignee, 'fixer')
    assert.equal(selfNamed.value.attempt_id, blank.value.attempt_id)

    const padded = await fixture.executeTool(fixer, 'agent_teams_claim_task', { task_id: 't1', assignee: '  fixer  ' })
    assert.equal(padded.isError, false, JSON.stringify(padded))
    assert.equal(padded.value.attempt_id, blank.value.attempt_id)

    team = await fixture.loadTeam(teamId)
    assert.equal(team.tasks.find(entry => entry.id === 't1').assignee, 'fixer')
  } finally {
    await fixture.dispose()
  }
})

await test('a member claim still rejects redirecting the assignee at another member (issue #234 follow-up)', async () => {
  const { fixture, fixer, teamId } = await mountRunningTeam()
  try {
    const result = await fixture.executeTool(fixer, 'agent_teams_claim_task', { task_id: 't2', assignee: 'scout' })
    assert.equal(result.isError, true, JSON.stringify(result))
    assert.match(JSON.stringify(result), /members cannot set assignee when claiming a task/)
    const team = await fixture.loadTeam(teamId)
    const task = team.tasks.find(entry => entry.id === 't2')
    assert.equal(task.status, 'pending')
    assert.equal(task.assignee, 'scout')
    assert.equal(task.attemptId, undefined)
  } finally {
    await fixture.dispose()
  }
})

await test('a captain claim ignores a blank materialized assignee (issue #234 follow-up)', async () => {
  const { fixture, captain, teamId } = await mountRunningTeam()
  try {
    const result = await fixture.executeTool(captain, 'agent_teams_claim_task', { task_id: 't3', assignee: '   ' })
    assert.equal(result.isError, false, JSON.stringify(result))
    assert.doesNotMatch(JSON.stringify(result), /captains must use agent_teams_reassign_task/)
    assert.equal(result.value.assignee, 'captain')
    assert.equal(result.value.attempt_id, 'captain-attempt-1')
    const team = await fixture.loadTeam(teamId)
    assert.equal(team.tasks.find(entry => entry.id === 't3').assignee, 'captain')
  } finally {
    await fixture.dispose()
  }
})

await test('a captain claim still rejects a non-empty assignee (issue #234 follow-up)', async () => {
  const { fixture, captain } = await mountRunningTeam()
  try {
    const result = await fixture.executeTool(captain, 'agent_teams_claim_task', { task_id: 't1', assignee: 'fixer' })
    assert.equal(result.isError, true, JSON.stringify(result))
    assert.match(JSON.stringify(result), /captains must use agent_teams_reassign_task/)
  } finally {
    await fixture.dispose()
  }
})

await test('a member cannot claim a task assigned to another member (issue #234 follow-up)', async () => {
  const { fixture, fixer, teamId } = await mountRunningTeam()
  try {
    // Both gateway shapes must hit the ownership guard: a materialized blank and
    // the caller restating its own name. Neither may take scout's task.
    for (const assignee of ['', 'fixer']) {
      const before = (await fixture.loadTeam(teamId)).tasks.find(entry => entry.id === 't2')
      assert.equal(before.assignee, 'scout')
      assert.equal(before.status, 'pending')
      const result = await fixture.executeTool(fixer, 'agent_teams_claim_task', { task_id: 't2', assignee })
      assert.equal(result.isError, true, JSON.stringify(result))
      // The ownership guard names the actual owner, so the rejection is diagnosable.
      assert.match(result.error.message, /^task t2 is assigned to "scout", not you$/)
      const after = (await fixture.loadTeam(teamId)).tasks.find(entry => entry.id === 't2')
      assert.equal(after.assignee, 'scout')
      assert.equal(after.status, 'pending')
      assert.equal(after.attempt, 0)
      assert.equal(after.attemptId, undefined)
      assert.notEqual(after.assignee, 'fixer')
    }
  } finally {
    await fixture.dispose()
  }
})

await test('a captain cannot read a member attempt through a blank assignee (issue #234 follow-up)', async () => {
  // scout already holds this task, so the attempt id belongs to a member (#125).
  const { fixture, captain, teamId } = await mountRunningTeam([
    { id: 't4', subject: 'member claimed task', status: 'claimed', assignee: 'scout', dependencies: [], attempt: 1, attemptId: 'member-attempt-1', createdAt: Date.now(), updatedAt: Date.now() },
  ])
  try {
    const result = await fixture.executeTool(captain, 'agent_teams_claim_task', { task_id: 't4', assignee: '' })
    assert.equal(result.isError, true, JSON.stringify(result))
    assert.match(result.error.message, /captains must use agent_teams_reassign_task/)
    // The member's capability must not leak through the captain's read.
    assert.doesNotMatch(JSON.stringify(result), /member-attempt-1/)
    const task = (await fixture.loadTeam(teamId)).tasks.find(entry => entry.id === 't4')
    assert.equal(task.assignee, 'scout')
    assert.equal(task.status, 'claimed')
    assert.equal(task.attempt, 1)
    assert.equal(task.attemptId, 'member-attempt-1')
  } finally {
    await fixture.dispose()
  }
})
