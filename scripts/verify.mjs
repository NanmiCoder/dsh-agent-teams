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

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CAPTAIN_KEY,
  appendMailbox,
  createMessage,
  createTeamDir,
  findTeamByCaptain,
  findTeamByParticipant,
  readMailbox,
  readTeam,
  removeTeamDir,
  sanitizeKey,
  transitionError,
  unsatisfiedDependencies,
  withTeamLock,
} from '../lib/state.js'
import {
  activityPanelExpandedForSession,
  compactDagLayout,
  COMPACT_DAG_NODE_HEIGHT,
  COMPACT_DAG_NODE_WIDTH,
  dependencyFocusTaskId,
  relatedTaskIds,
  taskStages,
  usesParallelTaskGrid,
} from '../lib/client/activity-model.js'
import { parseAgentTeamsCreateArgs } from '../lib/client/agent-teams-card-definition.js'
import { steerCaptainReport } from '../lib/tools.js'
import {
  installMemberSelectionRuntime,
  resolveMemberLlmSelection,
  spawnMember,
} from '../lib/members.js'

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

// The bundle patch's `name` is the specifier Node resolves when a profile
// loads this plugin, so it must equal the published package name. A mismatch
// only surfaces after someone installs the package (the row fails to load),
// never in local link-installed development — hence this pre-publish gate.
console.log('1/8 packaging contract')
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const patchText = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const patchName = patchText
  .split('\n')
  .filter(line => !/^\s*#/.test(line))
  .find(line => /^\s*name:\s*\S/.test(line))
  ?.match(/^\s*name:\s*(.+?)\s*$/)?.[1]
  ?.replace(/^(['"])(.*)\1$/, '$2')
check(
  'cordis.patch.yml name matches the published package name',
  patchName === pkg.name,
  `patch has ${JSON.stringify(patchName)}, package.json has ${JSON.stringify(pkg.name)}`,
)
check(
  'files[] ships the bundle patch and lib',
  ['lib', 'cordis.patch.yml'].every(entry => pkg.files?.includes(entry)),
  `files = ${JSON.stringify(pkg.files)}`,
)
check(
  'scoped package publishes publicly',
  !pkg.name.startsWith('@') || pkg.publishConfig?.access === 'public',
  'scoped packages default to restricted without publishConfig.access = "public"',
)
const requiredPeers = Object.keys(pkg.peerDependencies ?? {})
  .filter(name => pkg.peerDependenciesMeta?.[name]?.optional !== true)
check(
  'shared runtime peers are optional for standalone profile installs',
  requiredPeers.length === 0,
  `required peers trigger pnpm warnings: ${JSON.stringify(requiredPeers)}`,
)
// The browser half registers itself with __ModuleLoader__ under an id the host
// resolves by package name. A stale id here fails only in the browser — the
// host half loads fine, so every server-side check still passes.
const clientBundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const registeredId = clientBundle.match(/__ModuleLoader__\.load\(\{\s*id:\s*"([^"]*)"/)?.[1]
check(
  'client bundle registers under the package name',
  registeredId === pkg.name,
  `bundle registers ${JSON.stringify(registeredId)}, package.json has ${JSON.stringify(pkg.name)}`,
)
const activityPanelCss = await readFile(new URL('../src/client/ActivityPanel.module.css', import.meta.url), 'utf8')
const activityPanelSource = await readFile(new URL('../src/client/ActivityPanel.tsx', import.meta.url), 'utf8')
const requiredHarnessTokenBridges = [
  '--dsw-alias-line-normal: var(--dsw-static-neutral-bluish-150',
  '--dsw-alias-bg-module: var(--dsw-alias-bg-layer-1',
  '--dsw-alias-state-success: var(--dsw-alias-state-success-primary',
  '--dsw-alias-state-warning: var(--dsw-alias-state-warn-primary',
  '--dsw-alias-state-danger: var(--dsw-alias-state-error-primary',
]
check(
  'activity panel bridges the reference palette to current Harness tokens',
  requiredHarnessTokenBridges.every(token => activityPanelCss.includes(token)),
  'missing token bridges make panel fills and DAG borders transparent',
)
const requiredPanelSizing = [
  '--agent-teams-panel-min-height: 560px',
  'min-height: min(',
  'max-height: calc(100dvh - var(--agent-teams-panel-top) - var(--agent-teams-panel-bottom-gap))',
]
check(
  'activity panel grows between a stable minimum and balanced viewport maximum',
  requiredPanelSizing.every(rule => activityPanelCss.includes(rule))
    && !activityPanelCss.includes('height: min(560px'),
  'a fixed panel height leaves excessive space below tall viewports',
)
check(
  'running DAG tasks reuse the animated work glyph without losing focus context',
  activityPanelSource.includes("task.state === 'running'")
    && activityPanelSource.includes('className={css.dagRunningState}')
    && activityPanelSource.includes('<WorkGlyph active />')
    && activityPanelCss.includes(".dagNode[data-state='running'][data-dimmed='true']")
    && activityPanelCss.includes('.dagRunningState {'),
  'running work should stay visible in both normal and dependency-focus states',
)

console.log('2/8 pure rules')
check("sanitizeKey('My Team!') -> 'my-team'", sanitizeKey('My Team!') === 'my-team')
// #15: an ASCII-only whitelist folded every non-Latin name onto one constant,
// so distinct members shared a mailbox file and the second one was rejected as
// a duplicate. Keys must stay distinct for distinct names, in any script.
check("CJK names survive folding", sanitizeKey('研究员') === '研究员')
check(
  'distinct non-Latin names stay distinct',
  sanitizeKey('研究员') !== sanitizeKey('工程师')
    && sanitizeKey('データ分析') !== sanitizeKey('Данные'),
)
check(
  'names with no letters or digits get distinct keys, not a shared constant',
  sanitizeKey('!!!') !== sanitizeKey('🐳') && sanitizeKey('🐳') !== '',
)
check('folding is deterministic', sanitizeKey('🐳') === sanitizeKey('🐳'))
check(
  'long names stay inside the filesystem name limit',
  Buffer.byteLength(`${sanitizeKey('研'.repeat(300))}.jsonl`) < 255,
)
check(
  'long names sharing a prefix stay distinct',
  sanitizeKey(`${'研'.repeat(60)}a`) !== sanitizeKey(`${'研'.repeat(60)}b`),
)
check(
  'keys stay a single safe path segment',
  !/[\\/:*?"<>|]/.test(sanitizeKey('a/b\\c:d*e?f"g<h>i|j')) && !sanitizeKey('../../etc').includes('.'),
)
check('pending -> claimed allowed', transitionError('pending', 'claimed') === undefined)
check('pending -> in_progress denied', transitionError('pending', 'in_progress') !== undefined)
check('in_progress -> completed allowed', transitionError('in_progress', 'completed') === undefined)
check('completed -> in_progress denied', transitionError('completed', 'in_progress') !== undefined)
check('same status is a no-op', transitionError('failed', 'failed') === undefined)

console.log('3/8 dependency gating')
const tasks = [
  { id: 't1', status: 'completed' },
  { id: 't2', status: 'pending' },
  { id: 't3', status: 'failed' },
]
check('all-done deps satisfied', unsatisfiedDependencies(tasks, ['t1']).length === 0)
check('pending dep blocks', unsatisfiedDependencies(tasks, ['t2']).length === 1)
check('failed dep blocks too', unsatisfiedDependencies(tasks, ['t3']).length === 1)

console.log('4/8 on-disk team flow (temp dir)')
const stateRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-verify-'))
try {
  const team = {
    name: 'Verify Team',
    id: sanitizeKey('Verify Team'),
    description: 'smoke',
    captainSessionId: 'sess-captain',
    createdAt: Date.now(),
    members: [
      { id: 'sess-member', name: 'alice', joinedAt: Date.now(), status: 'idle' },
      { id: 'sess-removed', name: 'former', joinedAt: Date.now(), status: 'removed' },
    ],
    tasks: [],
    taskSeq: 0,
  }
  await createTeamDir(stateRoot, team)

  const reread = await readTeam(stateRoot, team.id)
  check('team.json round-trips', reread?.id === team.id && reread.captainSessionId === 'sess-captain')

  await writeFile(join(stateRoot, team.id, 'team.json'), `\uFEFF${JSON.stringify(team, null, 2)}`, 'utf8')
  check('team.json accepts a UTF-8 BOM', (await readTeam(stateRoot, team.id))?.id === team.id)

  const found = await findTeamByCaptain(stateRoot, 'sess-captain')
  check('findTeamByCaptain finds the team', found?.id === team.id)
  check('findTeamByCaptain ignores other captains', await findTeamByCaptain(stateRoot, 'sess-other') === undefined)
  check('findTeamByParticipant finds the captain', (await findTeamByParticipant(stateRoot, 'sess-captain'))?.id === team.id)
  check('findTeamByParticipant finds an active member', (await findTeamByParticipant(stateRoot, 'sess-member'))?.id === team.id)
  check('findTeamByParticipant rejects a removed member', await findTeamByParticipant(stateRoot, 'sess-removed') === undefined)

  const escapedContent = String.raw`save to notes\foo.md`
  const message = createMessage('alice', CAPTAIN_KEY, escapedContent)
  await withTeamLock(team.id, async () => {
    await appendMailbox(stateRoot, team.id, CAPTAIN_KEY, message)
  })
  const second = createMessage('bob', CAPTAIN_KEY, 'valid after BOM')
  const mailboxFile = join(stateRoot, team.id, 'inbox', `${CAPTAIN_KEY}.jsonl`)
  await writeFile(
    mailboxFile,
    `\uFEFF${JSON.stringify(second)}\n${String.raw`{"broken":"notes\q.md"}`}\n{}\n`,
    { encoding: 'utf8', flag: 'a' },
  )
  const malformedLines = []
  const inbox = await readMailbox(
    stateRoot,
    team.id,
    CAPTAIN_KEY,
    (lineNumber) => malformedLines.push(lineNumber),
  )
  check('mailbox append/read preserves backslashes', inbox[0]?.content === escapedContent)
  check('mailbox accepts BOM-prefixed JSONL records', inbox[1]?.content === second.content)
  check('mailbox skips malformed JSON and malformed shapes', inbox.length === 2 && malformedLines.join(',') === '3,4')
  check('missing mailbox reads empty', (await readMailbox(stateRoot, team.id, 'nobody')).length === 0)

  const duplicateCaptain = { ...team, id: 'duplicate-captain', members: [] }
  await createTeamDir(stateRoot, duplicateCaptain)
  let duplicateCaptainRejected = false
  try {
    await findTeamByCaptain(stateRoot, 'sess-captain')
  } catch {
    duplicateCaptainRejected = true
  }
  check('multiple teams for one captain fail as ambiguous', duplicateCaptainRejected)
  await removeTeamDir(stateRoot, duplicateCaptain.id)

  const duplicateMember = { ...team, id: 'duplicate-member', captainSessionId: 'sess-other-captain' }
  await createTeamDir(stateRoot, duplicateMember)
  let duplicateMemberRejected = false
  try {
    await findTeamByParticipant(stateRoot, 'sess-member')
  } catch {
    duplicateMemberRejected = true
  }
  check('multiple teams for one member fail as ambiguous', duplicateMemberRejected)
  await removeTeamDir(stateRoot, duplicateMember.id)

  const invalidId = 'invalid-shape'
  await mkdir(join(stateRoot, invalidId), { recursive: true })
  await writeFile(join(stateRoot, invalidId, 'team.json'), '{}', 'utf8')
  let invalidShapeRejected = false
  try {
    await readTeam(stateRoot, invalidId)
  } catch {
    invalidShapeRejected = true
  }
  check('invalid team.json shape is rejected at the durable boundary', invalidShapeRejected)
  await removeTeamDir(stateRoot, invalidId)

  await removeTeamDir(stateRoot, team.id)
  check('removeTeamDir removes the team', await readTeam(stateRoot, team.id) === undefined)

  // Archive keeps the team data for post-delete review.
  const archiveTeam = { ...team, id: sanitizeKey('Archive Team') }
  await createTeamDir(stateRoot, archiveTeam)
  const { archiveTeamDir, readArchivedTeam, listArchivedTeamIds } = await import('../lib/state.js')
  await archiveTeamDir(stateRoot, archiveTeam.id)
  check('archive moves the team out of live scan', await readTeam(stateRoot, archiveTeam.id) === undefined)
  check('archive keeps team.json readable', (await readArchivedTeam(stateRoot, archiveTeam.id))?.id === archiveTeam.id)
  check('archive lists the team id', (await listArchivedTeamIds(stateRoot)).includes(archiveTeam.id))
  check('archive dir skips live readTeam', await readTeam(stateRoot, 'archive') === undefined)
} finally {
  await rm(stateRoot, { recursive: true, force: true })
}

console.log('5/8 host visual-state functions (activity panel)')
const { taskVisualState, taskDepthsById } = await import('../lib/state.js')
const vtasks = [
  { id: 't1', subject: 'a', status: 'completed', assignee: 'alice', dependencies: [], createdAt: 0, updatedAt: 0 },
  { id: 't2', subject: 'b', status: 'pending', assignee: 'bob', dependencies: ['t1'], createdAt: 0, updatedAt: 0 },
  { id: 't3', subject: 'c', status: 'in_progress', assignee: 'bob', dependencies: ['t2'], createdAt: 0, updatedAt: 0 },
  { id: 't4', subject: 'd', status: 'pending', assignee: 'alice', dependencies: ['t9'], createdAt: 0, updatedAt: 0 },
]
check('completed -> completed visual state', taskVisualState('completed', [], vtasks) === 'completed')
check('in_progress -> running visual state', taskVisualState('in_progress', [], vtasks) === 'running')
check('pending with completed dep -> open', taskVisualState('pending', ['t1'], vtasks) === 'open')
check('pending with open dep -> blocked', taskVisualState('pending', ['t2'], vtasks) === 'blocked')
check('missing dependency is ignored (not blocked)', taskVisualState('pending', ['t9'], vtasks) === 'open')
const depths = taskDepthsById(vtasks)
check('t1 depth 0', depths.get('t1') === 0)
check('t2 depth 1 (longest path)', depths.get('t2') === 1)
check('t3 depth 2', depths.get('t3') === 2)
check('missing dep contributes no depth', depths.get('t4') === 0)

console.log('6/8 client relationship projections')
const projectionTasks = [
  { id: 't4', dependencies: ['t2'], depth: 2 },
  { id: 't1', dependencies: [], depth: 0 },
  { id: 't3', dependencies: ['t1'], depth: 1 },
  { id: 't2', dependencies: ['t1'], depth: 1 },
  { id: 't5', dependencies: [], depth: Number.NaN },
]
const stages = taskStages(projectionTasks)
check('task stages sort by depth', stages.map(stage => stage.depth).join(',') === '0,1,2')
check('task stages sort ids naturally', stages[1]?.tasks.map(task => task.id).join(',') === 't2,t3')
check('non-finite depth falls back to stage 0', stages[0]?.tasks.some(task => task.id === 't5') === true)
const chain = relatedTaskIds('t2', projectionTasks)
check('relationship chain includes upstream dependency', chain.has('t1'))
check('relationship chain includes focused task', chain.has('t2'))
check('relationship chain includes downstream dependent', chain.has('t4'))
check('relationship chain excludes sibling branch', !chain.has('t3'))
check(
  'pinned dependency chain wins over keyboard and hover previews',
  dependencyFocusTaskId('pinned', 'keyboard', 'hover') === 'pinned',
)
check(
  'keyboard dependency chain wins over delayed hover preview',
  dependencyFocusTaskId(null, 'keyboard', 'hover') === 'keyboard',
)
check(
  'hover dependency chain is used without a pinned or keyboard task',
  dependencyFocusTaskId(null, null, 'hover') === 'hover',
)
const cyclic = [
  { id: 'a', dependencies: ['b'], depth: 0 },
  { id: 'b', dependencies: ['a'], depth: 1 },
]
check('relationship traversal is cycle-safe', relatedTaskIds('a', cyclic).size === 2)
check('edge-free tasks switch to the fill-width parallel grid', usesParallelTaskGrid([
  { id: 't1', dependencies: [], depth: 0 },
  { id: 't2', dependencies: [], depth: 0 },
  { id: 't3', dependencies: ['missing'], depth: 0 },
]))
check('a real dependency keeps the layered DAG layout', !usesParallelTaskGrid([
  { id: 't1', dependencies: [], depth: 0 },
  { id: 't2', dependencies: ['t1'], depth: 1 },
]))
const dag = compactDagLayout(projectionTasks.filter(task => Number.isFinite(task.depth)))
check('compact DAG lays dependency depths out left-to-right',
  dag.nodes.find(node => node.task.id === 't1')?.x === 0
    && dag.nodes.find(node => node.task.id === 't2')?.x === 118
    && dag.nodes.find(node => node.task.id === 't4')?.x === 236)
check('compact DAG keeps stable rows and reference node geometry',
  dag.nodes.find(node => node.task.id === 't3')?.y === 38
    && dag.width === 328
    && dag.height === 68
    && COMPACT_DAG_NODE_WIDTH === 92
    && COMPACT_DAG_NODE_HEIGHT === 30)
check('compact DAG emits one curved SVG edge per valid dependency',
  dag.edges.length === 3
    && dag.edges.some(edge => edge.from === 't1' && edge.to === 't2' && edge.path.startsWith('M92 15C')))
check(
  'expanded activity panel belongs only to its current session',
  activityPanelExpandedForSession(true, 'session-a', 'session-a')
    && !activityPanelExpandedForSession(true, 'session-a', 'session-b')
    && !activityPanelExpandedForSession(true, 'session-a', undefined),
)
check(
  'agent team cards derive a stable id from the standard create tool call',
  JSON.stringify(parseAgentTeamsCreateArgs('{"name":" Repo Review 2W! "}'))
    === JSON.stringify({ teamId: 'repo-review-2w', name: 'Repo Review 2W!' }),
)
check('malformed create tool arguments do not create a card', parseAgentTeamsCreateArgs('{bad') === undefined)

const captainDeliveries = []
const captainSteered = steerCaptainReport(
  { steer: message => captainDeliveries.push(message) },
  'alice',
  'finished t1',
)
check(
  'member report delivery calls the live captain steer API',
  captainSteered
    && captainDeliveries.length === 1
    && captainDeliveries[0]?.content[0]?.type === 'text'
    && captainDeliveries[0]?.content[0]?.text === 'AgentTeams message from member alice:\n\nfinished t1',
)
check(
  'failed live captain delivery falls back to the durable mailbox',
  steerCaptainReport({ steer: () => { throw new Error('offline') } }, 'alice', 'finished t1') === false,
)

console.log('7/8 member model selection and continuation restore')
const captain = {
  id: 'captain-session',
  options: { provider: 'birth-provider', model: 'birth-model' },
  session: {
    requestHeader: () => ({
      config: {
        provider: 'captain-provider',
        model: 'captain-model',
        reasoningEffort: 'max',
      },
    }),
  },
}
const resolvedCalls = []
const selectionContext = {
  llm: {
    resolveCallConfig: async (config) => {
      resolvedCalls.push(config)
      return config
    },
  },
}
const inheritedSelection = await resolveMemberLlmSelection(selectionContext, captain, {})
check(
  'ordinary member snapshots the captain current route and effort',
  inheritedSelection.provider === 'captain-provider'
    && inheritedSelection.model === 'captain-model'
    && inheritedSelection.reasoningEffort === 'max',
)
const overriddenSelection = await resolveMemberLlmSelection(selectionContext, captain, {
  provider: 'other-provider',
  model: 'other-model',
})
check(
  'explicit cross-provider route keeps and validates captain effort',
  overriddenSelection.provider === 'other-provider'
    && overriddenSelection.model === 'other-model'
    && resolvedCalls.at(-1)?.reasoningEffort === 'max',
)
const defaultedSelection = await resolveMemberLlmSelection(selectionContext, captain, {
  defaultModel: 'configured-member-model',
})
check(
  'plugin memberModel overrides only the model on the current provider',
  defaultedSelection.provider === 'captain-provider'
    && defaultedSelection.model === 'configured-member-model',
)
let providerWithoutModelRejected = false
try {
  await resolveMemberLlmSelection(selectionContext, captain, { provider: 'other-provider' })
} catch {
  providerWithoutModelRejected = true
}
check('explicit provider without model is rejected', providerWithoutModelRejected)

let startSpec
const spawnMemberRecord = {
  id: '',
  name: 'backend',
  role: 'engineer',
  provider: overriddenSelection.provider,
  model: overriddenSelection.model,
  reasoningEffort: overriddenSelection.reasoningEffort,
  joinedAt: Date.now(),
  status: 'idle',
}
const spawnTeam = {
  name: 'Spawn Verify',
  id: 'spawn-verify',
  captainSessionId: captain.id,
  createdAt: Date.now(),
  members: [],
  tasks: [],
  taskSeq: 0,
}
await spawnMember(
  {
    subagents: {
      getProvider: () => ({
        prepareContinuable: () => undefined,
        capabilities: { persona: true, toolFilter: true },
      }),
      list: () => ['spawn'],
      startContinuable: async (spec) => {
        startSpec = spec
        return { childId: 'spawned-member', messageId: 'welcome-message' }
      },
    },
  },
  { provider: 'spawn', maxDepth: 1 },
  {
    withPending: async (_parentId, _label, _selection, operation) => operation(),
  },
  overriddenSelection,
  captain,
  spawnTeam,
  spawnMemberRecord,
  '.agent-teams',
  new AbortController().signal,
)
check(
  '#20: spawn receives the resolved per-member provider and model',
  startSpec?.request?.agentOptions?.provider === 'other-provider'
    && startSpec?.request?.agentOptions?.model === 'other-model'
    && spawnMemberRecord.id === 'spawned-member',
)

function descriptorEvent(label, agentProvider = 'descriptor-provider', agentModel = 'descriptor-model') {
  return {
    type: 'subagent/descriptor',
    data: {
      version: 2,
      mode: 'continuable',
      provider: 'spawn',
      label,
      agentProvider,
      agentModel,
    },
  }
}

function fakeChildContext({ label, parentSessionId, cwd, agentProvider, agentModel }) {
  const listeners = new Map()
  return {
    listeners,
    context: {
      agent: {
        session: {
          header: { parentSession: parentSessionId, cwd, seedLength: 0 },
          events: [descriptorEvent(label, agentProvider, agentModel)],
        },
      },
      on(name, listener) {
        listeners.set(name, listener)
        return () => listeners.delete(name)
      },
    },
  }
}

async function routedConfig(child) {
  const assemble = child.listeners.get('system-prompt/assemble')
  const request = child.listeners.get('agent/request')
  await assemble({}, {}, async () => ({ variables: {} }))
  return request({}, async () => ({
    provider: 'unselected-provider',
    model: 'unselected-model',
    reasoningEffort: 'low',
  }))
}

let setupMemberSelection
const selectionRuntime = installMemberSelectionRuntime({
  subagents: {
    registerContinuableSetup: (setup) => {
      setupMemberSelection = setup
      return () => undefined
    },
  },
}, '.agent-teams')
const freshChild = fakeChildContext({
  label: 'agent-teams:fresh-team:backend',
  parentSessionId: 'captain-session',
  cwd: process.cwd(),
})
let disposeFresh
await selectionRuntime.withPending(
  'captain-session',
  'agent-teams:fresh-team:backend',
  overriddenSelection,
  async () => {
    disposeFresh = setupMemberSelection(freshChild.context)
  },
)
const freshRoute = await routedConfig(freshChild)
check(
  'fresh child request receives the resolved reasoning effort',
  freshRoute.provider === 'other-provider'
    && freshRoute.model === 'other-model'
    && freshRoute.reasoningEffort === 'max',
)
disposeFresh()

const restoreWorkspace = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-selection-'))
try {
  const restoreStateRoot = join(restoreWorkspace, '.agent-teams')
  await createTeamDir(restoreStateRoot, {
    name: 'Restore Team',
    id: 'restore-team',
    captainSessionId: 'captain-session',
    createdAt: Date.now(),
    members: [{
      id: 'cold-member',
      name: 'reviewer',
      provider: 'cold-provider',
      model: 'cold-model',
      reasoningEffort: 'high',
      joinedAt: Date.now(),
      status: 'idle',
    }],
    tasks: [],
    taskSeq: 0,
  })
  const coldChild = fakeChildContext({
    label: 'agent-teams:restore-team:reviewer',
    parentSessionId: 'captain-session',
    cwd: restoreWorkspace,
    agentProvider: 'cold-provider',
    agentModel: 'cold-model',
  })
  const disposeCold = setupMemberSelection(coldChild.context)
  const coldRoute = await routedConfig(coldChild)
  check(
    'cold-resumed child restores provider, model, and reasoning from team.json',
    coldRoute.provider === 'cold-provider'
      && coldRoute.model === 'cold-model'
      && coldRoute.reasoningEffort === 'high',
  )
  disposeCold()
} finally {
  await rm(restoreWorkspace, { recursive: true, force: true })
}

console.log('8/8 state-file atomic write hardening (Windows EPERM fallback)')
// The durable state files (team.json, mailboxes, retired index) are replaced
// through `atomicWriteText` = write-temp + rename. On Windows a rename over an
// existing target throws EPERM while another process holds it open without
// FILE_SHARE_DELETE; the hardened path retries the rename a few times and then
// degrades to a direct overwrite (content-equivalent because the temp file was
// fully written). These checks pin that behavior through the injectable seam
// and, on Windows, against a real cross-process handle lock.
const atomicStateRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-atomic-'))
try {
  const {
    replaceFileAtomicOrDirect,
    writeTeam,
  } = await import('../lib/state.js')
  const epermError = () => Object.assign(
    new Error("EPERM: operation not permitted, rename '.../team.json.tmp' -> '.../team.json'"),
    { code: 'EPERM' },
  )

  let renameCalls = 0
  let fallbackWrites = 0
  let fallbackRemovals = 0
  let fallbackContent = ''
  const fallbackTarget = join(atomicStateRoot, 'forced', 'team.json')
  await replaceFileAtomicOrDirect('forced.tmp', fallbackTarget, '{"fallback":1}', {
    rename: async () => { renameCalls += 1; throw epermError() },
    writeFile: async (_file, content) => { fallbackWrites += 1; fallbackContent = content },
    remove: async () => { fallbackRemovals += 1 },
  }, { retryDelayMs: 1 })
  check(
    'persistent EPERM exhausts the rename retries (1 initial + 3 retries)',
    renameCalls === 4,
    `renameCalls = ${renameCalls}`,
  )
  check(
    'persistent EPERM falls back to a direct overwrite of the target',
    fallbackWrites === 1 && fallbackContent === '{"fallback":1}',
    `fallbackWrites = ${fallbackWrites}`,
  )
  check('the temp file is removed after the fallback write', fallbackRemovals === 1)

  let transientCalls = 0
  let transientWrites = 0
  await replaceFileAtomicOrDirect('transient.tmp', join(atomicStateRoot, 'transient', 'team.json'), '{"retried":2}', {
    rename: async () => {
      transientCalls += 1
      if (transientCalls <= 2) throw epermError()
    },
    writeFile: async (file, content) => { transientWrites += 1; await writeFile(file, content) },
    remove: async () => undefined,
  }, { retryDelayMs: 1 })
  check(
    'a transient EPERM recovers via rename retries without the fallback',
    transientCalls === 3 && transientWrites === 0,
    `renameCalls = ${transientCalls}, fallbackWrites = ${transientWrites}`,
  )

  let aggregateThrown = false
  let dualRemovals = 0
  try {
    await replaceFileAtomicOrDirect('dual.tmp', join(atomicStateRoot, 'dual', 'team.json'), 'x', {
      rename: async () => { throw epermError() },
      writeFile: async () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }) },
      remove: async () => { dualRemovals += 1 },
    }, { retryDelayMs: 1 })
  } catch (error) {
    aggregateThrown = error instanceof AggregateError
  }
  check('failure of both the atomic and the direct path raises AggregateError', aggregateThrown)
  check('the temp file is removed even after a dual failure', dualRemovals === 1)

  if (process.platform === 'win32') {
    // Real cross-process lock: hold team.json with FileShare.ReadWrite (no
    // FILE_SHARE_DELETE) from a child .NET handle, then verify the public
    // write path still persists through the direct-write fallback.
    const lockedTeam = {
      name: 'Locked Team',
      id: 'locked-team',
      captainSessionId: 'sess-lock',
      createdAt: Date.now(),
      members: [],
      tasks: [],
      taskSeq: 0,
    }
    await createTeamDir(atomicStateRoot, lockedTeam)
    const lockedJson = join(atomicStateRoot, lockedTeam.id, 'team.json')
    const { spawn } = await import('node:child_process')
    const holder = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        `$f = '${lockedJson.replaceAll("'", "''")}';
         $s = [System.IO.File]::Open($f, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite);
         [Console]::Out.WriteLine('HELD'); [Console]::Out.Flush();
         Start-Sleep -Seconds 45; $s.Dispose()`],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    const held = await new Promise((resolve, reject) => {
      let buffer = ''
      const onData = (chunk) => {
        buffer += chunk.toString()
        if (buffer.includes('HELD')) { cleanup(); resolve(true) }
      }
      const onExit = () => { cleanup(); reject(new Error('lock holder exited before arming')) }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('timed out waiting for the lock holder'))
      }, 15_000)
      function cleanup() {
        clearTimeout(timer)
        holder.stdout.off('data', onData)
        holder.off('exit', onExit)
      }
      holder.stdout.on('data', onData)
      holder.on('exit', onExit)
    })
    try {
      if (held) {
        lockedTeam.members.push({ id: 'sess-new', name: 'member', joinedAt: Date.now(), status: 'idle' })
        await writeTeam(atomicStateRoot, lockedTeam)
        const persisted = JSON.parse(await readFile(lockedJson, 'utf8'))
        const leftovers = (await readdir(join(atomicStateRoot, lockedTeam.id))).filter(name => name.endsWith('.tmp'))
        check(
          'writeTeam survives a real Windows lock without FILE_SHARE_DELETE',
          persisted.members.length === 1 && leftovers.length === 0,
          `members = ${persisted.members.length}, tmp leftovers = ${leftovers.join(', ') || 'none'}`,
        )
      }
      // Archive moves the whole team directory with `rename(source, target)`.
      // The same Windows delete-sharing EPERM applies when a file below the
      // directory is momentarily locked, so it retries the rename. A short
      // (≈150 ms) lock falls inside the retry window and must not abort the
      // archive.
      const { archiveTeamDir } = await import('../lib/state.js')
      const transientTeam = {
        name: 'Transient Lock Team',
        id: 'transient-lock',
        captainSessionId: 'sess-transient',
        createdAt: Date.now(),
        members: [],
        tasks: [],
        taskSeq: 0,
      }
      await createTeamDir(atomicStateRoot, transientTeam)
      const transientJson = join(atomicStateRoot, transientTeam.id, 'team.json')
      const flasher = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command',
          `$f = '${transientJson.replaceAll("'", "''")}';
           $s = [System.IO.File]::Open($f, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite);
           [Console]::Out.WriteLine('HELD_T'); [Console]::Out.Flush();
           Start-Sleep -Milliseconds 140; $s.Dispose()`],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      )
      const flashed = await new Promise((resolve, reject) => {
        let buffer = ''
        const onData = (chunk) => {
          buffer += chunk.toString()
          if (buffer.includes('HELD_T')) { cleanup(); resolve(true) }
        }
        const onExit = () => { cleanup(); reject(new Error('transient holder exited before arming')) }
        const timer = setTimeout(() => {
          cleanup()
          reject(new Error('timed out waiting for the transient lock holder'))
        }, 10_000)
        function cleanup() {
          clearTimeout(timer)
          flasher.stdout.off('data', onData)
          flasher.off('exit', onExit)
        }
        flasher.stdout.on('data', onData)
        flasher.on('exit', onExit)
      })
      try {
        // The flasher releases after ~140 ms; archiveTeamDir retries the
        // rename across that window, so archiving must still succeed.
        await archiveTeamDir(atomicStateRoot, transientTeam.id)
        const archived = await readFile(join(atomicStateRoot, 'archive', transientTeam.id, 'team.json'), 'utf8')
        check(
          'archiveTeamDir survives a transient Windows directory lock via rename retries',
          flashed && JSON.parse(archived).id === transientTeam.id,
        )
      } catch (error) {
        check(
          'archiveTeamDir survives a transient Windows directory lock via rename retries',
          false,
          String(error),
        )
      } finally {
        flasher.kill()
      }
    } finally {
      holder.kill()
      if (holder.exitCode === null && holder.signalCode === null) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 5_000)
          holder.once('exit', () => { clearTimeout(timer); resolve() })
        })
      }
    }
  } else {
    check('real Windows lock integration skipped on this platform', true)
  }
} finally {
  await rm(atomicStateRoot, { recursive: true, force: true }).catch(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    await rm(atomicStateRoot, { recursive: true, force: true })
  })
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall checks passed')
