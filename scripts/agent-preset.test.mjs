/**
 * Agent-preset member + member-model default regressions.
 *
 * Pins four contracts:
 *  1. a member with `agentPreset` starts under that host preset (the preset,
 *     not prompt text, is its identity) — `request.agentPreset` reaches
 *     `startActivation` and no persona shadows it;
 *  2. a member without `agentPreset` keeps the unchanged persona-text path;
 *  3. an unknown/unloadable preset fails loud and leaves no half-spawned member;
 *  4. a member whose route nobody names takes
 *     `magpie/group/deepseek-v4.1-flash-1017` + `reasoningEffort=max`, while an
 *     explicit route/effort (tool argument or profile row) still wins.
 *
 * Imports the built `lib/` output, so `pnpm build` must run first (the same
 * order CONTRIBUTING.md documents for `pnpm verify`).
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DEFAULT_MEMBER_LLM_SELECTION, installMemberSelectionRuntime, resolveMemberLlmSelection, spawnMember } from '../lib/members.js'
import { Config, readPlanMemberAgentPreset } from '../lib/index.js'
import { selectedAgentPreset, startMember } from '../lib/harness-compat.js'
import { resolveTeamProfile } from '../lib/profiles.js'
import { createTeamDir, readTeam } from '../lib/state.js'
import { registerAgentTeamsTools } from '../lib/tools.js'

const signal = new AbortController().signal
const captain = {
  id: 'captain-session',
  options: { provider: 'captain-provider', model: 'captain-model' },
  session: { requestHeader: () => ({ config: { provider: 'captain-provider', model: 'captain-model', reasoningEffort: 'high' } }) },
}

function teamOf(members = []) {
  return { id: 'team', name: 'Team', captainSessionId: captain.id, description: 'goal', createdAt: 1, taskSeq: 0, members, tasks: [] }
}

function memberDraft(extra = {}) {
  return { id: '', name: 'worker', role: 'engineer', joinedAt: 1, status: 'idle', ...extra }
}

function llmContext() {
  const calls = []
  return {
    calls,
    ctx: {
      llm: {
        async resolveCallConfig(config) {
          calls.push(config)
          return { ...config }
        },
      },
    },
  }
}

function managedProvider(overrides = {}) {
  return {
    prepareContinuable() {},
    capabilities: { persona: true, toolFilter: true, agentPreset: true, ...overrides },
    inheritsParentContext: false,
  }
}

/** A managed host (`startActivation` present) that records every start spec. */
function managedHost(provider = managedProvider(), reject) {
  const starts = []
  const ctx = {
    subagents: {
      getProvider: () => provider,
      list: () => ['spawn'],
      async startActivation(spec) {
        starts.push(spec)
        if (reject !== undefined) throw reject
        return { childId: 'child-1', result: Promise.resolve({}) }
      },
    },
  }
  const selections = { withPending: async (_parent, _label, _selection, run) => run() }
  return { ctx, starts, selections }
}

async function spawn(host, member, llmSelection = DEFAULT_MEMBER_LLM_SELECTION, config = { provider: 'spawn', maxDepth: 0 }) {
  await spawnMember(host.ctx, config, host.selections, llmSelection, captain, teamOf([member]), member, '.agent-teams', signal)
}

// ---------------------------------------------------------------------------
// 1. member model default / override
// ---------------------------------------------------------------------------

test('a member whose route nobody names takes magpie/group/deepseek-v4.1-flash-1017 at effort max', async () => {
  assert.deepEqual(DEFAULT_MEMBER_LLM_SELECTION, {
    provider: 'magpie',
    model: 'group/deepseek-v4.1-flash-1017',
    reasoningEffort: 'max',
  })
  const { ctx, calls } = llmContext()
  const selection = await resolveMemberLlmSelection(ctx, captain, {})
  assert.deepEqual(selection, { provider: 'magpie', model: 'group/deepseek-v4.1-flash-1017', reasoningEffort: 'max' })
  assert.deepEqual(calls, [{ provider: 'magpie', model: 'group/deepseek-v4.1-flash-1017', reasoningEffort: 'max' }],
    'the built-in default is validated through the adapter, not assumed')
})

test('an explicit tool-argument route and effort override the built-in default', async () => {
  const { ctx, calls } = llmContext()
  const selection = await resolveMemberLlmSelection(ctx, captain, {
    provider: 'other-provider',
    model: 'other-model',
    reasoningEffort: 'high',
  })
  assert.deepEqual(selection, { provider: 'other-provider', model: 'other-model', reasoningEffort: 'high' })
  assert.deepEqual(calls.at(-1), { provider: 'other-provider', model: 'other-model', reasoningEffort: 'high' })
})

test('a configured member route (profile/config default) overrides the built-in default', async () => {
  const { ctx } = llmContext()
  const selection = await resolveMemberLlmSelection(ctx, captain, {
    defaultProvider: 'configured-provider',
    defaultModel: 'configured-model',
  })
  assert.equal(selection.provider, 'configured-provider')
  assert.equal(selection.model, 'configured-model')
  assert.notEqual(selection.model, DEFAULT_MEMBER_LLM_SELECTION.model)
})

test('an explicit reasoning effort wins over the built-in max, and "default" opts out', async () => {
  const { ctx, calls } = llmContext()
  const explicit = await resolveMemberLlmSelection(ctx, captain, { reasoningEffort: 'high' })
  assert.equal(explicit.reasoningEffort, 'high')
  assert.deepEqual(calls.at(-1), { provider: 'magpie', model: 'group/deepseek-v4.1-flash-1017', reasoningEffort: 'high' })

  const sentinel = await resolveMemberLlmSelection(ctx, captain, { reasoningEffort: 'default' })
  assert.equal(sentinel.reasoningEffort, undefined)
  assert.equal('reasoningEffort' in calls.at(-1), false, 'the sentinel asks the adapter for the target model default')
})

test('a default route the adapter rejects fails loud with the route named', async () => {
  const ctx = {
    llm: {
      async resolveCallConfig() {
        const error = new Error('provider/model route magpie/group/deepseek-v4.1-flash-1017 does not support reasoning effort "max"')
        error.code = 'UNSUPPORTED_REASONING_EFFORT'
        throw error
      },
    },
  }
  await assert.rejects(resolveMemberLlmSelection(ctx, captain, {}), /magpie\/group\/deepseek-v4\.1-flash-1017.*max|does not support reasoning effort "max"/)
})

// ---------------------------------------------------------------------------
// 2. agentPreset injection through spawnMember / startMember
// ---------------------------------------------------------------------------

test('spawnMember sends agentPreset to startActivation and omits the persona text', async () => {
  const host = managedHost()
  const member = memberDraft({ agentPreset: 'reviewer-preset' })
  await spawn(host, member)
  assert.equal(host.starts.length, 1)
  const spec = host.starts[0]
  assert.equal(spec.request.agentPreset, 'reviewer-preset', 'the host mounts the named preset into the child scope')
  assert.equal('persona' in spec.request, false, 'a mounted preset must not be shadowed by prompt-text identity')
  assert.deepEqual(Object.keys(spec.request).sort(), ['agentOptions', 'agentPreset', 'parent', 'prompt'],
    'the managed start request carries the preset and no persona/toolFilter the host would strip')
  assert.deepEqual(spec.request.agentOptions, {
    provider: DEFAULT_MEMBER_LLM_SELECTION.provider,
    model: DEFAULT_MEMBER_LLM_SELECTION.model,
    reasoningEffort: DEFAULT_MEMBER_LLM_SELECTION.reasoningEffort,
  })
  assert.ok(member.runtimeSetup?.toolFilter.deny.includes('agent_teams_create'), 'the member tool filter still applies under a preset')
  assert.equal(spec.delivery, 'parent')
  assert.equal(member.id, 'child-1')
  assert.equal(member.runtimeSetup?.persona.includes('worker'), true, 'the durable setup keeps a last-resort identity')
})

test('spawnMember without agentPreset keeps the persona-text member on a managed host', async () => {
  const host = managedHost()
  const member = memberDraft()
  await spawn(host, member)
  const spec = host.starts[0]
  assert.equal('agentPreset' in spec.request, false)
  assert.match(member.runtimeSetup.persona, /You are worker/)
  assert.match(member.runtimeSetup.persona, /engineer/)
  assert.ok(member.runtimeSetup.toolFilter.deny.includes('send_message'))
  assert.equal(member.id, 'child-1')
})

test('spawnMember without agentPreset still sends the persona text on a legacy host', async () => {
  let received
  const ctx = { subagents: {
    getProvider: () => ({ prepareContinuable() {}, capabilities: { persona: true, toolFilter: true } }),
    list: () => ['spawn'],
    async startContinuable(spec) { received = spec; return { childId: 'legacy-child' } },
  } }
  const selections = { withPending: async (_p, _l, _s, run) => run() }
  const member = memberDraft()
  await spawnMember(ctx, { provider: 'spawn', maxDepth: 0 }, selections, DEFAULT_MEMBER_LLM_SELECTION, captain, teamOf([member]), member, '.agent-teams', signal)
  assert.equal('agentPreset' in received.request, false)
  assert.match(received.request.persona, /You are worker/)
  assert.ok(received.request.toolFilter.deny.includes('send_message'))
  assert.equal(member.id, 'legacy-child')
})

test('startMember forwards agentPreset on a managed host and strips persona/toolFilter', async () => {
  let received
  const runtime = {
    async startActivation(spec) {
      received = spec
      return { childId: 'child-2', result: Promise.resolve({}) }
    },
  }
  const result = await startMember(runtime, {
    provider: 'spawn',
    label: 'agent-teams:team:worker',
    signal,
    request: { parent: captain, prompt: [{ type: 'text', text: 'hi' }], persona: 'PERSONA', toolFilter: { deny: ['x'] }, agentPreset: 'reviewer-preset' },
  })
  assert.equal(result.childId, 'child-2')
  assert.equal(received.request.agentPreset, 'reviewer-preset')
  assert.equal('persona' in received.request, false)
  assert.equal('toolFilter' in received.request, false)
  assert.equal(received.delivery, 'parent')
})

test('a legacy host rejects agentPreset instead of silently dropping the preset', async () => {
  const runtime = { async startContinuable() { return { childId: 'legacy-child' } } }
  await assert.rejects(startMember(runtime, {
    provider: 'spawn',
    label: 'agent-teams:team:worker',
    signal,
    request: { parent: captain, prompt: [{ type: 'text', text: 'hi' }], agentPreset: 'reviewer-preset' },
  }), /requires the managed activation contract \(startActivation\)/)
  assert.deepEqual(await startMember(runtime, {
    provider: 'spawn',
    label: 'agent-teams:team:worker',
    signal,
    request: { parent: captain, prompt: [{ type: 'text', text: 'hi' }], persona: 'PERSONA' },
  }), { childId: 'legacy-child' }, 'the no-preset legacy path is unchanged')
})

test('a provider without independent preset support rejects the member before any start', async () => {
  const host = managedHost(managedProvider({ agentPreset: false }))
  const member = memberDraft({ agentPreset: 'reviewer-preset' })
  await assert.rejects(spawn(host, member), /cannot mount an independent agent preset/)
  assert.equal(host.starts.length, 0, 'nothing may start when the provider cannot mount the preset')
  assert.equal(member.id, '')
})

test('a provider that inherits the parent context cannot mount an independent preset', async () => {
  const host = managedHost({ ...managedProvider(), inheritsParentContext: true })
  const member = memberDraft({ agentPreset: 'reviewer-preset' })
  await assert.rejects(spawn(host, member), /inherits the parent context/)
  assert.equal(host.starts.length, 0)
})

// ---------------------------------------------------------------------------
// 3. invalid preset fails loud, nothing half-spawned
// ---------------------------------------------------------------------------

test('an unknown preset rejects the spawn and leaves the member unspawned', async () => {
  const hostError = new Error('Unknown agent preset: missing-preset')
  hostError.code = 'agent-preset/not-found'
  const host = managedHost(managedProvider(), hostError)
  const member = memberDraft({ agentPreset: 'missing-preset' })
  await assert.rejects(spawn(host, member), /Unknown agent preset: missing-preset/)
  assert.equal(host.starts.length, 1, 'the host resolves the preset at start; the failure is not retried as a tool-name mismatch')
  assert.equal(member.id, '', 'a rejected start must not record a child id')
  assert.equal(member.runtimeSetup, undefined, 'a rejected start must not persist a runtime setup')
})

test('selectedAgentPreset reads only a creation-time preset selection from the child log', () => {
  const session = events => ({ ownEvents: () => events })
  const descriptor = { type: 'subagent/descriptor', data: {} }
  assert.equal(selectedAgentPreset(session([
    { type: 'agent-preset/selected', data: { agentPreset: 'reviewer-preset' } },
    descriptor,
  ])), 'reviewer-preset')
  assert.equal(selectedAgentPreset(session([
    { type: 'agent-preset/selected', data: { agentPreset: '' } },
    { type: 'agent-preset/selected', data: { agentPreset: 'later' } },
    descriptor,
  ])), undefined, 'an empty selection is not a preset')
  assert.equal(selectedAgentPreset(session([
    descriptor,
    { type: 'agent-preset/selected', data: { agentPreset: 'later-fork' } },
  ])), undefined, 'a selection appended after creation is a later fork intent, not this child identity')
  assert.equal(selectedAgentPreset(session([{ type: 'assistant/message', data: {} }])), undefined)
})

// ---------------------------------------------------------------------------
// 4. preset members do not restore the persona over the mounted preset
// ---------------------------------------------------------------------------

const deliverKey = Symbol.for('dsh.subagent.deliverPrompt')

function modernRuntime() {
  return { [deliverKey]() {}, sendMessage() {}, startActivation() {} }
}

function scope(extra = {}) {
  const listeners = new Map()
  const effects = []
  const ctx = {
    agents: { list: () => [] },
    ...extra,
    listeners,
    logger: { warn() {} },
    on(name, fn) {
      const set = listeners.get(name) ?? new Set()
      listeners.set(name, set)
      set.add(fn)
      return () => set.delete(fn)
    },
    effect(setup) { const dispose = setup(); effects.push(dispose); return dispose },
    emit(name, payload) { for (const fn of [...listeners.get(name) ?? []]) fn(payload) },
    dispose() { for (const dispose of effects.splice(0).reverse()) dispose() },
  }
  return ctx
}

function child({ workspace = process.cwd(), presetSelected = false } = {}) {
  // The host appends a creation-time preset selection BEFORE the descriptor
  // (dsh-subagent materialize: preset event, then descriptor), and the restore
  // rule treats a selection after the descriptor as a later fork intent.
  const events = presetSelected ? [{ type: 'agent-preset/selected', data: { agentPreset: 'reviewer-preset' } }] : []
  events.push({
    type: 'subagent/descriptor',
    data: { version: 3, mode: 'continuable', provider: 'spawn', label: 'agent-teams:team:worker', agentProvider: 'primary', agentModel: 'model' },
  })
  const agent = {
    id: 'member-id', status: 'idle', whenIdle: async () => {},
    options: { provider: 'primary', model: 'model' },
    session: { header: { cwd: workspace, parentSession: 'captain' }, ownEvents: () => events },
  }
  agent.ctx = scope()
  return agent
}

test('cold resume of a preset member restores the tool filter but not the saved persona', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-teams-preset-resume-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const setup = { persona: 'SAVED_PERSONA', toolFilter: { deny: ['captain_only'] } }
  await createTeamDir(join(workspace, '.agent-teams'), {
    id: 'team', name: 'Team', captainSessionId: 'captain', createdAt: 1, taskSeq: 0, tasks: [],
    members: [{ id: 'member-id', name: 'worker', status: 'idle', joinedAt: 1, provider: 'primary', model: 'model', agentPreset: 'reviewer-preset', runtimeSetup: setup }],
  })
  const ctx = scope({ subagents: modernRuntime() })
  installMemberSelectionRuntime(ctx, '.agent-teams')
  const agent = child({ workspace, presetSelected: true })
  const installed = new Map()
  agent.ctx.tools = { restrict(filter) { installed.set('filter', filter); return () => installed.delete('filter') } }
  agent.ctx.systemPrompt = { getSectionOrder: () => 1, section(section) { installed.set('persona', section.text); return () => installed.delete('persona') } }
  ctx.emit('agent/created', { agent, source: 'resume' })
  assert.deepEqual(installed.get('filter'), setup.toolFilter, 'the member tool restriction outlives the preset')
  assert.equal(installed.has('persona'), false, 'a mounted preset must supply the system prompt, not the saved persona')
  ctx.dispose()
  assert.equal(installed.size, 0)
})

test('a fresh preset member never installs the persona section over the mounted preset', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-teams-preset-fresh-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const setup = { persona: 'FRESH_PERSONA', toolFilter: { deny: ['captain_only'] } }
  const ctx = scope({ subagents: modernRuntime() })
  const bridge = installMemberSelectionRuntime(ctx, '.agent-teams')
  const agent = child({ workspace, presetSelected: true })
  const installed = new Map()
  agent.ctx.tools = { restrict(filter) { installed.set('filter', filter); return () => installed.delete('filter') } }
  agent.ctx.systemPrompt = { getSectionOrder: () => 1, section(section) { installed.set('persona', section.text); return () => installed.delete('persona') } }
  await bridge.withPending('captain', 'agent-teams:team:worker', { provider: 'primary', model: 'model' }, async () => {
    ctx.emit('agent/created', { agent, source: 'create' })
  }, setup)
  assert.deepEqual(installed.get('filter'), setup.toolFilter)
  assert.equal(installed.has('persona'), false, 'the host selected a preset, so its deployment prompt owns the child prompt')
  ctx.dispose()
})

test('cold resume of a persona-only member still restores its persona (unchanged path)', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-teams-persona-resume-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const setup = { persona: 'SAVED_PERSONA', toolFilter: { deny: ['captain_only'] } }
  await createTeamDir(join(workspace, '.agent-teams'), {
    id: 'team', name: 'Team', captainSessionId: 'captain', createdAt: 1, taskSeq: 0, tasks: [],
    members: [{ id: 'member-id', name: 'worker', status: 'idle', joinedAt: 1, provider: 'primary', model: 'model', runtimeSetup: setup }],
  })
  const ctx = scope({ subagents: modernRuntime() })
  installMemberSelectionRuntime(ctx, '.agent-teams')
  const agent = child({ workspace })
  const installed = new Map()
  agent.ctx.tools = { restrict(filter) { installed.set('filter', filter); return () => installed.delete('filter') } }
  agent.ctx.systemPrompt = { getSectionOrder: () => 1, section(section) { installed.set('persona', section.text); return () => installed.delete('persona') } }
  ctx.emit('agent/created', { agent, source: 'resume' })
  assert.equal(installed.get('persona'), 'SAVED_PERSONA')
  ctx.dispose()
})

// ---------------------------------------------------------------------------
// 5. configuration surface: profile rows and tool parameters
// ---------------------------------------------------------------------------

test('a profile member may declare agentPreset; normalization trims it and omission stays absent', () => {
  const profile = resolveTeamProfile({
    review: {
      members: [
        { name: 'reviewer', role: 'reviewer', agentPreset: '  reviewer-preset  ', provider: 'p', model: 'm' },
        { name: 'writer', role: 'writer' },
      ],
      tasks: [{ id: 't1', subject: 'Review', assignee: 'reviewer' }],
    },
  }, 'review', 8)
  assert.equal(profile.members[0].agentPreset, 'reviewer-preset')
  assert.equal('agentPreset' in profile.members[1], false, 'omission is not normalized to an empty string')
})

test('an unknown profile member key and an empty/non-string agentPreset are rejected', () => {
  const profile = members => ({ bad: { members, tasks: [{ id: 't1', subject: 'Work', assignee: members[0].name }] } })
  assert.throws(() => resolveTeamProfile(profile([{ name: 'w', agent_preset: 'x' }]), 'bad', 8), /agent_preset is unknown.*did you mean agentPreset/)
  assert.throws(() => resolveTeamProfile(profile([{ name: 'w', agentPreset: '' }]), 'bad', 8), /agentPreset must not be empty/)
  assert.throws(() => resolveTeamProfile(profile([{ name: 'w', agentPreset: '   ' }]), 'bad', 8), /agentPreset must not be empty/)
  assert.throws(() => resolveTeamProfile(profile([{ name: 'w', agentPreset: 7 }]), 'bad', 8), /agentPreset must be a string/)
})

test('the create-plan and add_member tool schemas expose agentPreset', () => {
  const definitions = []
  const noop = () => {}
  registerAgentTeamsTools({
    on: () => noop,
    effect: setup => setup(),
    logger: { warn: noop, debug: noop },
    tools: { register: definition => definitions.push(definition) },
    agents: { get: () => undefined },
    subagents: { followup: async () => {}, registerContinuableSetup: () => noop },
  }, { stateDir: '.agent-teams', memberProvider: 'spawn', memberMaxDepth: 1, maxMembers: 8, profiles: {} })

  const byName = new Map(definitions.map(definition => [definition.name, definition]))
  const addMember = byName.get('agent_teams_add_member')
  assert.ok(addMember, 'agent_teams_add_member must be registered')
  assert.equal(addMember.parameters.properties.agentPreset?.type, 'string')

  const create = byName.get('agent_teams_create')
  const planMember = create?.parameters?.properties?.plan?.properties?.members?.items?.properties
  assert.equal(planMember?.agentPreset?.type, 'string', 'a captain-planning roster row may select a preset')

  const editOperation = byName.get('agent_teams_edit_plan')?.parameters?.properties?.operations?.items?.properties
  assert.equal(editOperation?.agentPreset?.type, 'string', 'update_member may set or clear a preset')
})

test('the plugin Config schema carries a profile member agentPreset into the resolved config', () => {
  const resolved = Config({
    profiles: {
      review: {
        members: [{ name: 'reviewer', agentPreset: 'reviewer-preset' }],
        tasks: [{ id: 't1', subject: 'Review', assignee: 'reviewer' }],
      },
    },
  })
  assert.equal(resolved.profiles.review.members[0].agentPreset, 'reviewer-preset')
})

test('the Web roster payload maps agentPreset with camel-case precedence and null as clear', () => {
  assert.deepEqual(readPlanMemberAgentPreset({}), {}, 'an omitted key keeps the staged preset')
  assert.deepEqual(readPlanMemberAgentPreset({ agentPreset: 'reviewer' }), { agentPreset: 'reviewer' })
  assert.deepEqual(readPlanMemberAgentPreset({ agent_preset: 'legacy-client' }), { agentPreset: 'legacy-client' })
  assert.deepEqual(readPlanMemberAgentPreset({ agentPreset: null, agent_preset: 'stale' }), { agentPreset: '' },
    'an explicit null wins over a stale snake-case alias and clears the preset')
  assert.deepEqual(readPlanMemberAgentPreset({ agentPreset: '' }), { agentPreset: '' })
  assert.throws(() => readPlanMemberAgentPreset({ agentPreset: 7 }), /agentPreset must be a string/)
})

test('agentPreset survives the durable team.json round-trip used by cold resume', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-teams-preset-state-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const stateRoot = join(workspace, '.agent-teams')
  await createTeamDir(stateRoot, {
    id: 'team', name: 'Team', captainSessionId: captain.id, createdAt: 1, taskSeq: 0, tasks: [],
    members: [memberDraft({ agentPreset: 'reviewer-preset' })],
  })
  const read = await readTeam(stateRoot, 'team')
  assert.equal(read?.members[0]?.agentPreset, 'reviewer-preset')
})
