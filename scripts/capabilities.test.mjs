import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SystemPrompt, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { installTeamCapabilities, TEAM_DISCOVERY_PROMPT, TEAM_MEMBER_PROMPT } from '../lib/capabilities.js'
import { TEAM_TOOL_NAMES, MEMBER_TOOL_NAMES } from '../lib/tool-names.js'
import { usageSectionText } from '../lib/index.js'
import { registerAgentTeamsTools } from '../lib/tools.js'
import { createTeamDir, archiveTeamDir, recordRetiredMemberIds } from '../lib/state.js'

const requireTools = createRequire(import.meta.resolve('@deepseek-ai/dsh-tools'))
const { createScope } = await import(requireTools.resolve('@deepseek-ai/dsh-scope'))

test('progressive loading uses real scoped registry and prompt assembly', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-teams-capabilities-'))
  const stateRoot = join(workspace, '.agent-teams')
  const host = new Context()
  const prompt = host.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await prompt.await()
  const tools = host.plugin(ToolRuntime, { mode: 'native' })
  await tools.await()
  const agents = []
  const scopes = []
  const noop = () => {}
  const definitions = []
  let owned
  registerAgentTeamsTools({
    on: () => noop, effect: setup => setup(), logger: { warn: noop, debug: noop },
    tools: { register: definition => definitions.push(definition) },
    agents: { get: id => agents.find(agent => agent.id === id) },
    subagents: { followup: async () => {}, registerContinuableSetup: () => noop },
  }, { stateDir: '.agent-teams', memberProvider: 'spawn', memberMaxDepth: 1, maxMembers: 8, profiles: {} })
  const business = host.plugin({ inject: ['tools'], apply(ctx) {
    owned = ctx
    for (const definition of definitions) ctx.tools.register(definition)
    ctx.provide('agents', { list: () => agents })
    ctx.provide('codeRuntime', { language: 'typescript' })
  } })
  await business.await()
  const createAgent = (id, parentSession, events = []) => {
    const agent = { id, status: 'idle', session: { header: { cwd: workspace, parentSession, seedLength: 0 }, events } }
    const scope = createScope(owned, agent)
    agent.ctx = scope.ctx.extend({ agent })
    agents.push(agent)
    scopes.push(scope)
    return agent
  }
  const a = createAgent('captain-a'), b = createAgent('ordinary-b')
  const pendingMembers = new Set()
  const options = { stateDir: '.agent-teams', isPendingMember: agent => pendingMembers.has(agent.id), profileNames: () => ['demo'], captainPrompt: profile => usageSectionText(TEAM_TOOL_NAMES.join(', ')) + (profile ? '\nSELECTED_PROFILE:' + profile : '') }
  const plugin = { inject: ['tools', 'systemPrompt', 'agents'], apply(ctx) { installTeamCapabilities(ctx, options) } }
  let fiber = host.plugin(plugin)
  await fiber.await()
  const assemble = agent => host.systemPrompt.assemble({ agent, scope: agent })
  const names = async agent => (await assemble(agent)).tools.map(tool => tool.name)
  const open = (agent, args = {}, signal = new AbortController().signal) => host.tools.get('agent_teams_open', agent).execute(args, { agent, signal })
  const team = { id: 'saved', name: 'Saved', captainSessionId: a.id, createdAt: 1, members: [], tasks: [], taskSeq: 0, phase: 'staged' }
  try {
    await t.test('unrelated conversation has only discovery, not captain instructions or schemas', async () => {
      assert.deepEqual(await names(a), ['agent_teams_open'])
      assert.equal(renderPrompt(await assemble(a)), TEAM_DISCOVERY_PROMPT)
      assert.ok(JSON.stringify((await assemble(a)).tools).length < 1000)
      assert.ok(Buffer.byteLength(TEAM_DISCOVERY_PROMPT) < 600)
      t.diagnostic(JSON.stringify({ role: 'discovery', promptBytes: Buffer.byteLength(TEAM_DISCOVERY_PROMPT), schemaBytes: Buffer.byteLength(JSON.stringify((await assemble(a)).tools)) }))
    })
    await t.test('cancellation and invalid profiles leave the scope unactivated', async () => {
      const controller = new AbortController()
      const pending = open(a, {}, controller.signal)
      controller.abort()
      await assert.rejects(pending)
      await assert.rejects(open(a, { profile: 'missing' }), /unknown AgentTeams profile/)
      assert.deepEqual(await names(a), ['agent_teams_open'])
    })
    await t.test('open activates A while preserving B and independently owned restrictions', async () => {
      const userDeny = a.ctx.tools.restrict({ deny: ['agent_teams_delete'] })
      const result = await open(a, { profile: 'demo' })
      assert.match(result.next, /No current team/)
      assert.ok((await names(a)).includes('agent_teams_create'))
      assert.ok(!(await names(a)).includes('agent_teams_delete'))
      assert.deepEqual(await names(b), ['agent_teams_open'])
      assert.match(renderPrompt(await assemble(a)), /Tasks carry attempt_id/)
      userDeny()
    })
    await t.test('opening existing paused work is idempotent and does not mutate or wake it', async () => {
      await createTeamDir(stateRoot, { ...team, phase: 'running', halted: true })
      await writeFile(join(stateRoot, team.id, 'inbox/captain.jsonl'), 'pending mail\n')
      const file = join(stateRoot, team.id, 'team.json')
      const before = await readFile(file, 'utf8')
      const first = await open(a), second = await open(a)
      assert.deepEqual(first, second)
      assert.equal(first.team.id, team.id)
      assert.match(first.next, /halted/)
      assert.equal(await readFile(file, 'utf8'), before)
      assert.equal(await readFile(join(stateRoot, team.id, 'inbox/captain.jsonl'), 'utf8'), 'pending mail\n')
    })
    await t.test('fresh child is restricted to member tools before its id has been persisted', async () => {
      pendingMembers.add('child')
      const member = createAgent('child', a.id, [{ type: 'subagent/descriptor', data: {
        version: 3, mode: 'continuable', provider: 'spawn', label: 'agent-teams:saved:worker', agentProvider: 'fake', agentModel: 'fake',
      } }])
      host.emit('agent/session-start', { agent: member, source: 'startup' })
      pendingMembers.delete('child')
      assert.deepEqual((await names(member)).sort(), [...MEMBER_TOOL_NAMES].sort())
      assert.equal(renderPrompt(await assemble(member)), TEAM_MEMBER_PROMPT)
      assert.equal(host.tools.get('agent_teams_open', member), undefined)
      assert.equal(host.tools.get('agent_teams_approve', member), undefined)
      assert.ok(Buffer.byteLength(TEAM_MEMBER_PROMPT) < 600)
      t.diagnostic(JSON.stringify({ role: 'member', promptBytes: Buffer.byteLength(TEAM_MEMBER_PROMPT), schemaBytes: Buffer.byteLength(JSON.stringify((await assemble(member)).tools)) }))
    })
    await t.test('an ordinary subagent label cannot impersonate durable or pending membership', async () => {
      const child = createAgent('ordinary-child', a.id, [{ type: 'subagent/descriptor', data: {
        version: 3, mode: 'continuable', provider: 'spawn', label: 'agent-teams:saved:worker', agentProvider: 'fake', agentModel: 'fake',
      } }])
      host.emit('agent/session-start', { agent: child, source: 'startup' })
      assert.deepEqual(await names(child), ['agent_teams_open'])
    })
    await t.test('a retired member cannot acquire the captain entry on cold resume', async () => {
      await recordRetiredMemberIds(stateRoot, ['retired-child'])
      const child = createAgent('retired-child', a.id)
      host.emit('agent/session-start', { agent: child, source: 'resume' })
      assert.deepEqual((await names(child)).sort(), [...MEMBER_TOOL_NAMES].sort())
    })
    await t.test('PTC and both modes hide business SDK declarations in unrelated scopes', async () => {
      for (const mode of ['ptc', 'both']) {
        const restore = b.ctx.tools.presentAs(mode)
        const assembly = await assemble(b)
        const sdk = assembly.sections.find(section => section.name === 'tools:sdk').text
        assert.match(sdk, /agent_teams_open/)
        for (const name of TEAM_TOOL_NAMES) assert.ok(!sdk.includes(name), name)
        restore()
      }
    })
    await t.test('HMR removes old masks and restores persisted participants in existing scopes', async () => {
      await fiber.dispose()
      assert.equal(host.tools.get('agent_teams_open', b), undefined)
      assert.equal((await names(b)).length, 13)
      fiber = host.plugin(plugin)
      await fiber.await()
      assert.equal((await names(a)).length, 14)
      assert.deepEqual(await names(b), ['agent_teams_open'])
    })
    await t.test('a cold captain loads its durable role before its first request', async () => {
      const cold = createAgent(a.id)
      host.emit('agent/session-start', { agent: cold, source: 'resume' })
      assert.equal((await names(cold)).length, 14)
      assert.match(renderPrompt(await assemble(cold)), /continue that team/)
    })
    await t.test('archive revokes only at the idle boundary, not during a tool batch', async () => {
      await archiveTeamDir(stateRoot, team.id)
      assert.equal((await names(a)).length, 14)
      host.emit('agent/status', { agent: a, status: 'idle' })
      assert.deepEqual(await names(a), ['agent_teams_open'])
    })
    await t.test('a halted draft and a profile conflict give accurate continuation instructions', async () => {
      await createTeamDir(stateRoot, { ...team, halted: true })
      assert.match((await open(a)).next, /halted/)
      const result = await open(a, { profile: 'demo' })
      assert.equal(result.profile_conflict, true)
      assert.equal(result.requested_profile, 'demo')
      assert.match(result.next, /has not switched/)
      assert.doesNotMatch(renderPrompt(await assemble(a)), /SELECTED_PROFILE:demo/)
      await archiveTeamDir(stateRoot, team.id)
      host.emit('agent/status', { agent: a, status: 'idle' })
    })
    await t.test('create and archive in one batch drops the open latch for native and nested dispatch', async () => {
      for (const nested of [false, true]) {
        await open(a)
        const exec = name => host.tools.execute({ name, arguments: name === 'agent_teams_create' ? { name: 'Saved', approval: 'required' } : {}, callId: name + '-test', agent: a, signal: new AbortController().signal, ...(nested ? { parent: {} } : {}) })
        const created = await exec('agent_teams_create')
        assert.equal(created.isError, false, JSON.stringify(created))
        const archived = await exec('agent_teams_delete')
        assert.equal(archived.isError, false, JSON.stringify(archived))
        assert.equal((await names(a)).length, 14)
        host.emit('agent/status', { agent: a, status: 'idle' })
        assert.deepEqual(await names(a), ['agent_teams_open'])
      }
    })
    await t.test('read failure cannot half-activate the discovery scope', async () => {
      await mkdir(join(stateRoot, 'broken'))
      await writeFile(join(stateRoot, 'broken/team.json'), '{broken')
      await assert.rejects(open(b))
      assert.deepEqual(await names(b), ['agent_teams_open'])
    })
  } finally {
    await fiber.dispose()
    for (const scope of scopes.reverse()) await scope.dispose()
    await business.dispose(); await tools.dispose(); await prompt.dispose()
    await rm(workspace, { recursive: true, force: true })
  }
})
