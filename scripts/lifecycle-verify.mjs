/**
 * Adversarial production-tool conformance verification.
 *
 * This intentionally models the Harness contract where listChildren says
 * "running" for every resident child while the live Agent registry carries
 * the real idle/running state. It drives the actual compiled tool definitions
 * through a multi-member DAG, takeover, stale completion, automatic later
 * rounds, removal recovery, mailbox fallback and concurrent claims.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { haltTeamWork, registerAgentTeamsTools } from '../lib/tools.js'
import { buildActivationDirective, invokedAgentTeamsGoal, invokedAgentTeamsInvocation, installAgentTeamsGestureBoundary, profileCommandName, registerAgentTeamsCommand } from '../lib/command.js'
import { readArchivedTeam, readTeam, readUnreadMailbox } from '../lib/state.js'
import { collectArchivedTeamsActivity } from '../lib/snapshot.js'

const workspace = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-lifecycle-'))
const definitions = new Map()
const liveAgents = new Map()
const children = []
const deliveries = []
const listeners = new Map()
const failNextDelivery = new Set()
const failures = []
let childSeq = 0
let messageSeq = 0

function check(label, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL'
  console.log(`  ${status}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

function session(parentSession) {
  return {
    header: { cwd: workspace, parentSession, seedLength: 0 },
    events: [],
    append() {},
    requestHeader() {
      return { config: { provider: 'fake', model: 'fake-model', reasoningEffort: 'high' } }
    },
  }
}

function makeAgent(id, parentSession) {
  return {
    id,
    status: 'idle',
    options: { provider: 'fake', model: 'fake-model' },
    session: session(parentSession),
    followups: [],
    injections: [],
    followup(message) {
      this.followups.push(message)
    },
    steer() {},
    inject(message) {
      this.injections.push(message)
    },
    cancel(cause, options) {
      this.cancelCount = (this.cancelCount ?? 0) + 1
      this.lastCancel = { cause, options }
    },
    whenIdle() {
      return this.status === 'idle' ? Promise.resolve() : new Promise(resolve => { this._idle = resolve })
    },
  }
}

function publishStatus(subject, status) {
  subject.status = status
  if (status === 'idle') {
    subject._idle?.()
    subject._idle = undefined
  }
  for (const listener of listeners.get('agent/status') ?? []) listener({ agent: subject, status })
}

const captain = makeAgent('captain-session')
liveAgents.set(captain.id, captain)
let advertisedModels = []
// A non-AgentTeams continuable sibling must survive every team lifecycle
// operation untouched.
children.push({ id: 'foreign-session', label: 'unrelated continuable', mode: 'continuable' })

const ctx = {
  effect(setup) { return setup() },
  tools: {
    register(definition) {
      definitions.set(definition.name, definition)
    },
  },
  on(name, listener) {
    const current = listeners.get(name) ?? []
    current.push(listener)
    listeners.set(name, current)
    return () => listeners.set(name, current.filter(candidate => candidate !== listener))
  },
  agents: {
    get(id) {
      return liveAgents.get(id)
    },
  },
  llm: {
    async resolveCallConfig(config) {
      return config
    },
    async listModels(provider) {
      return advertisedModels.map(model => ({ provider, id: model, name: model }))
    },
  },
  subagents: {
    registerContinuableSetup() {
      return () => {}
    },
    getProvider(name) {
      if (name !== 'spawn') return undefined
      return { prepareContinuable() {}, capabilities: { persona: true, toolFilter: true } }
    },
    list() {
      return ['spawn']
    },
    async startContinuable(spec) {
      const id = `member-session-${++childSeq}`
      const child = makeAgent(id, captain.id)
      child.status = 'running'
      liveAgents.set(id, child)
      children.push({ id, label: spec.label, mode: 'continuable' })
      return { childId: id, messageId: `welcome-${childSeq}` }
    },
    async listChildren(parentId) {
      if (parentId !== captain.id) return []
      return children.map(child => ({
        kind: 'child', mode: child.mode, id: child.id, label: child.label,
        // Residency, intentionally not the Agent's real status.
        activity: liveAgents.has(child.id) ? 'running' : 'inactive',
        hasChildren: false,
      }))
    },
    async listDescendants(parentId) {
      return this.listChildren(parentId)
    },
    async followup(_parent, childId, content) {
      if (failNextDelivery.delete(childId)) throw new Error('injected delivery failure')
      deliveries.push({ childId, content })
      const child = liveAgents.get(childId)
      if (child) child.status = 'running'
      return `message-${++messageSeq}`
    },
    interrupt(childId) {
      const child = liveAgents.get(childId)
      if (child) {
        child.interruptCount = (child.interruptCount ?? 0) + 1
        publishStatus(child, 'idle')
      }
    },
    async drainContinuableChildren(parent, childIds) {
      for (const childId of childIds) {
        const child = liveAgents.get(childId)
        if (child) {
          child.drainCount = (child.drainCount ?? 0) + 1
          publishStatus(child, 'idle')
          liveAgents.delete(childId)
        }
      }
      void parent
    },
  },
  logger: { debug() {}, warn() {} },
}

const agentTeamsRuntime = registerAgentTeamsTools(ctx, {
  stateDir: '.agent-teams',
  memberProvider: 'spawn',
  memberMaxDepth: 1,
  maxMembers: 8,
  profiles: {
    'demo-delivery': {
      description: 'tiny delivery team',
      protocol: 'Discuss, then implement. Do not invent unanswered questions.',
      members: [
        { name: 'analyst', role: 'requirements', model: 'fake-analyst' },
        { name: 'implementer', role: 'builder', model: 'fake-implementer' },
      ],
      tasks: [
        { id: 'requirements', subject: 'Requirements', assignee: 'analyst', description: 'Write the first cut.' },
        { id: 'implement', subject: 'Implement', assignee: 'implementer', dependencies: ['requirements'], description: 'Build from the approved requirements.' },
      ],
    },
    'dynamic-delivery': {
      description: 'roster only',
      protocol: 'Plan from the goal. Do not invent unanswered questions.',
      taskPlanning: 'captain',
      members: [
        { name: 'analyst', role: 'requirements analyst', model: 'fake-analyst' },
        { name: 'implementer', role: 'implementer', model: 'fake-implementer' },
        { name: 'tester', role: 'test engineer', model: 'fake-tester' },
        { name: 'reviewer', role: 'code reviewer', model: 'fake-reviewer' },
        { name: 'release', role: 'release engineer', model: 'fake-release' },
      ],
      tasks: [],
    },
  },
})

function execFor(subject) {
  return { agent: subject, signal: new AbortController().signal }
}

async function call(name, args, subject = captain) {
  const definition = definitions.get(name)
  if (!definition) throw new Error(`missing tool ${name}`)
  return definition.execute(args, execFor(subject))
}

const teamId = 'lifecycle'
const stateRoot = join(workspace, '.agent-teams')
const state = () => readTeam(stateRoot, teamId)
const task = async id => (await state())?.tasks.find(candidate => candidate.id === id)

console.log('dsh-agent-teams lifecycle verification')

// ── /agent-teams slash command and gesture boundary ───────────────────
const commandDefinitions = new Map()
ctx.commands = {
  register(definition) {
    commandDefinitions.set(definition.name, definition)
  },
}
const liveProfiles = {
  'demo-delivery': {
    description: 'tiny delivery team',
    protocol: 'Discuss, then implement. Do not invent unanswered questions.',
    members: [
      { name: 'analyst', role: 'requirements', model: 'fake-analyst' },
      { name: 'implementer', role: 'builder', model: 'fake-implementer' },
    ],
    tasks: [
      { id: 'requirements', subject: 'Requirements', assignee: 'analyst' },
      { id: 'implement', subject: 'Implement', assignee: 'implementer', dependencies: ['requirements'] },
    ],
  },
}
registerAgentTeamsCommand(ctx, () => liveProfiles)
installAgentTeamsGestureBoundary(ctx, () => liveProfiles)

const command = commandDefinitions.get('agent-teams')
const profileCommand = commandDefinitions.get('agent-teams-demo-delivery')
check('slash command registers as /agent-teams',
  command !== undefined && typeof command.description === 'string' && command.description.length > 0)
check('slash command advertises an input hint for the menu placeholder',
  typeof command?.input?.hint === 'string' && command.input.hint.length > 0)
check('configured profile registers a concise dedicated slash command',
  profileCommand !== undefined && profileCommandName('demo-delivery') === 'agent-teams-demo-delivery'
    && typeof profileCommand.description === 'string' && profileCommand.description.includes('demo-delivery'))
check('unsafe profile names do not generate ambiguous commands',
  profileCommandName('delivery team') === undefined && profileCommandName('delivery_team') === undefined)

const bare = command.handler({
  agent: captain, rawInput: '   ', signal: new AbortController().signal, commandId: 'cmd-bare',
})
check('bare /agent-teams reports usage instead of activating',
  bare.kind === 'error' && bare.text.includes('Usage: /agent-teams')
    && captain.followups.length === 0)

const goal = 'ship a tiny CLI'
const activated = command.handler({
  agent: captain, rawInput: `  ${goal}  `, signal: new AbortController().signal, commandId: 'cmd-goal',
})
check('argued /agent-teams queues one visible user turn',
  activated.kind === 'success' && captain.followups.length === 1)
const submittedCommand = captain.followups[0]
check('slash command preserves the exact submitted line as user-authored chat',
  submittedCommand?.source?.kind === 'user'
    && submittedCommand.content.some(block => block.type === 'text'
      && block.text === `/agent-teams  ${goal}  `))
check('preserved slash command still activates through the gesture boundary',
  invokedAgentTeamsGoal([submittedCommand]) === goal)
check('activation directive names the protocol', buildActivationDirective(goal).includes('AgentTeams protocol'))
const profileGoal = 'ship the prepared release'
const profileActivated = profileCommand.handler({
  agent: captain, rawInput: ` ${profileGoal}`, signal: new AbortController().signal, commandId: 'cmd-profile-alias',
})
check('profile command queues a visible profile-specific user turn',
  profileActivated.kind === 'success' && captain.followups.length === 2
    && captain.followups[1]?.content.some(block => block.type === 'text' && block.text === `/agent-teams-demo-delivery ${profileGoal}`))

const userMessage = text => ({ id: 'm', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })
check('gesture recognizes a leading /agent-teams token',
  invokedAgentTeamsGoal([userMessage('/agent-teams ship a CLI')]) === 'ship a CLI')
check('profile command gesture selects its configured profile and goal',
  invokedAgentTeamsInvocation([userMessage('/agent-teams-demo-delivery ship a CLI')], () => liveProfiles)?.profile === 'demo-delivery'
    && invokedAgentTeamsInvocation([userMessage('/agent-teams-demo-delivery ship a CLI')], () => liveProfiles)?.goal === 'ship a CLI')
check('bare profile command gesture asks for the goal',
  invokedAgentTeamsInvocation([userMessage('/agent-teams-demo-delivery')], () => liveProfiles)?.profile === 'demo-delivery'
    && invokedAgentTeamsInvocation([userMessage('/agent-teams-demo-delivery')], () => liveProfiles)?.goal === '')
check('unknown profile command stays ordinary prose',
  invokedAgentTeamsInvocation([userMessage('/agent-teams-missing ship a CLI')], () => liveProfiles) === undefined)
check('bare gesture yields an empty goal', invokedAgentTeamsGoal([userMessage('  /agent-teams')]) === '')
check('mid-sentence mention stays ordinary prose',
  invokedAgentTeamsGoal([userMessage('how do I use /agent-teams here?')]) === undefined)
check('non-user sources cannot forge the gesture',
  invokedAgentTeamsGoal([{ ...userMessage('/agent-teams x'), source: { kind: 'plugin', plugin: 'fake' } }]) === undefined)
check('latest user gesture wins in a batch',
  invokedAgentTeamsGoal([userMessage('/agent-teams first'), userMessage('/agent-teams second')]) === 'second')
const profileOnly = command.handler({
  agent: captain, rawInput: '--profile demo-delivery', signal: new AbortController().signal, commandId: 'cmd-profile-only',
})
check('slash --profile without a goal still activates',
  profileOnly.kind === 'success' && captain.followups.length === 3)
check('profile-only activation asks for the goal',
  buildActivationDirective('', 'demo-delivery').includes('The goal was not given')
    && buildActivationDirective('', 'demo-delivery').includes('Use configured AgentTeams profile "demo-delivery"'))
check('captain-planning activation requires a staged user-reviewed graph',
  buildActivationDirective('ship it', 'dynamic-delivery', 'captain').includes('approval="required"')
    && buildActivationDirective('ship it', 'dynamic-delivery', 'captain').includes('review the Web plan')
    && buildActivationDirective('ship it', 'dynamic-delivery', 'captain').includes('run in parallel')
    && !buildActivationDirective('ship it', 'dynamic-delivery', 'captain').includes('seed tasks'))
const unknownProfile = command.handler({
  agent: captain, rawInput: '--profile missing 做X', signal: new AbortController().signal, commandId: 'cmd-unknown',
})
check('unknown slash profile reports error and does not followup',
  unknownProfile.kind === 'error' && captain.followups.length === 3)
check('leading ordinary token is never treated as a profile',
  invokedAgentTeamsInvocation([userMessage('/agent-teams research this bug')])?.goal === 'research this bug'
    && invokedAgentTeamsInvocation([userMessage('/agent-teams research this bug')])?.profile === undefined)
liveProfiles['hot-reload'] = { members: [{ name: 'solo', model: 'fake' }] }
check('command getter sees HMR profile names',
  command.handler({
    agent: captain, rawInput: '--profile hot-reload', signal: new AbortController().signal, commandId: 'cmd-hmr',
  }).kind === 'success')
delete liveProfiles['hot-reload']

try {
  const createdProfile = await call('agent_teams_create', {
    name: 'Profile Demo',
    description: 'ship a tiny demo',
    profile: 'demo-delivery',
  })
  const profileTeam = await readTeam(stateRoot, 'profile-demo')
  check('create(profile) returns profile members tasks and seed ids',
    createdProfile.profile === 'demo-delivery'
      && createdProfile.members?.length === 2
      && createdProfile.tasks?.length === 2
      && createdProfile.tasks?.[0]?.seed_id === 'requirements'
      && createdProfile.tasks?.[1]?.seed_id === 'implement')
  check('create(profile) persists snapshot members and mapped dependencies',
    profileTeam?.profile?.name === 'demo-delivery'
      && profileTeam.members.map(member => member.name).join(',') === 'analyst,implementer'
      && profileTeam.tasks[1]?.dependencies.join(',') === 't1'
      && profileTeam.tasks[1]?.assignee === 'implementer')
  const analyst = liveAgents.get(createdProfile.members[0].member_id)
  const implementer = liveAgents.get(createdProfile.members[1].member_id)
  analyst.status = 'idle'
  implementer.status = 'idle'
  await call('agent_teams_status', {})
  const afterKick = await readTeam(stateRoot, 'profile-demo')
  const firstSeed = afterKick?.tasks[0]
  check('first-stage seed is assigned only to the configured member',
    firstSeed?.status === 'claimed' && firstSeed.assignee === 'analyst'
      && deliveries.some(delivery => delivery.childId === analyst.id)
      && !deliveries.some(delivery => delivery.childId === implementer.id && String(delivery.content?.[0]?.text ?? '').includes('Implement')))
  const firstAssignment = deliveries.find(delivery => delivery.childId === analyst.id)
  const assignmentText = Array.isArray(firstAssignment?.content)
    ? firstAssignment.content.map(block => block.text ?? '').join('\n')
    : String(firstAssignment?.content ?? '')
  check('first assignment includes team goal and protocol',
    assignmentText.includes('ship a tiny demo')
      && assignmentText.includes('Discuss, then implement'))
  const analystClaim = await call('agent_teams_claim_task', { task_id: firstSeed.id }, analyst)
  await call('agent_teams_update_task', { task_id: firstSeed.id, status: 'in_progress', attempt_id: analystClaim.attempt_id }, analyst)
  await call('agent_teams_update_task', {
    task_id: firstSeed.id,
    status: 'failed',
    attempt_id: analystClaim.attempt_id,
    output: 'Need a user decision before design.',
  }, analyst)
  publishStatus(analyst, 'idle')
  publishStatus(implementer, 'idle')
  check('failed upstream does not unlock the next configured stage',
    (await readTeam(stateRoot, 'profile-demo'))?.tasks[1]?.status === 'pending'
      && !deliveries.some(delivery => delivery.childId === implementer.id && String(delivery.content?.[0]?.text ?? '').includes('Implement')))
  await call('agent_teams_reassign_task', { task_id: firstSeed.id, assignee: 'analyst', reason: 'retry after user answer' })
  const retryClaim = await call('agent_teams_claim_task', { task_id: firstSeed.id }, analyst)
  await call('agent_teams_update_task', { task_id: firstSeed.id, status: 'in_progress', attempt_id: retryClaim.attempt_id }, analyst)
  await call('agent_teams_update_task', {
    task_id: firstSeed.id,
    status: 'completed',
    attempt_id: retryClaim.attempt_id,
    output: 'Scope confirmed: ship the tiny demo.',
  }, analyst)
  publishStatus(analyst, 'idle')
  publishStatus(implementer, 'idle')
  const secondSeed = (await readTeam(stateRoot, 'profile-demo'))?.tasks[1]
  check('completed upstream dispatches the configured downstream assignee',
    secondSeed?.status === 'claimed' && secondSeed.assignee === 'implementer')
  const secondAssignment = [...deliveries].reverse().find(delivery => delivery.childId === implementer.id)
  const secondText = Array.isArray(secondAssignment?.content)
    ? secondAssignment.content.map(block => block.text ?? '').join('\n')
    : String(secondAssignment?.content ?? '')
  check('downstream assignment includes dependency output and seed id',
    secondText.includes('Scope confirmed')
      && secondText.includes('[requirements]'))
  await call('agent_teams_send_message', { to: 'implementer', content: 'stop and wait for a user answer' })
  const deliveriesAfterMail = deliveries.length
  await call('agent_teams_status', {})
  check('unread mailbox prevents a same-kick new assignment',
    deliveries.length >= deliveriesAfterMail
      && (await readTeam(stateRoot, 'profile-demo'))?.tasks[1]?.assignee === 'implementer')
  const profileStatus = await call('agent_teams_status', {})
  check('status exposes profile snapshot and task seed ids',
    profileStatus.profile?.name === 'demo-delivery'
      && profileStatus.tasks.some(item => item.seed_id === 'requirements')
      && profileStatus.tasks.some(item => item.seed_id === 'implement'))
  await call('agent_teams_delete', {})

  const deliveriesBeforeDiscard = deliveries.length
  const captainCancelsBeforeDiscard = captain.cancelCount ?? 0
  const captainInjectionsBeforeDiscard = captain.injections.length
  await call('agent_teams_create', {
    name: 'Rejected Demo',
    description: 'plan the user will reject',
    profile: 'dynamic-delivery',
    approval: 'required',
  })
  await call('agent_teams_create_task', { subject: 'should never run', assignee: 'analyst' })
  const discardedPlan = await agentTeamsRuntime.discardStagedTeam(captain, 'rejected-demo')
  const discardedArchive = await readArchivedTeam(stateRoot, 'rejected-demo')
  check('discarding a staged plan archives it without spawning or dispatching',
    discardedPlan.teamId === 'rejected-demo'
      && await readTeam(stateRoot, 'rejected-demo') === undefined
      && discardedArchive?.phase === 'staged'
      && discardedArchive.members.every(member => member.id === '')
      && discardedArchive.tasks.every(task => task.status === 'pending')
      && deliveries.length === deliveriesBeforeDiscard)
  const discardControlText = captain.injections.at(-1)?.content?.map(block => block.text ?? '').join('\n') ?? ''
  check('discard aborts the active Captain turn and parks an authoritative no-recreate context',
    (captain.cancelCount ?? 0) === captainCancelsBeforeDiscard + 1
      && captain.injections.length === captainInjectionsBeforeDiscard + 1
      && /Do not call agent_teams_create/.test(discardControlText)
      && /Wait for a later explicit user request/.test(discardControlText)
      && captain.lastCancel?.options?.keepInbox === true)

  const createdDynamic = await call('agent_teams_create', {
    name: 'Dynamic Demo',
    description: 'goal only',
    profile: 'dynamic-delivery',
    approval: 'required',
  })
  const stagedDynamic = await readTeam(stateRoot, 'dynamic-demo')
  check('captain-planning create stages only the configured roster',
    createdDynamic.profile === 'dynamic-delivery'
      && createdDynamic.task_planning === 'captain'
      && createdDynamic.phase === 'staged'
      && createdDynamic.members?.length === 5
      && createdDynamic.members.every(member => member.member_id === '')
      && createdDynamic.tasks?.length === 0
      && stagedDynamic?.profile?.taskPlanning === 'captain'
      && stagedDynamic.phase === 'staged'
      && stagedDynamic.members.every(member => member.id === '')
      && stagedDynamic.tasks.length === 0)
  const deliveriesBeforePlan = deliveries.length
  const dynamicFirst = await call('agent_teams_create_task', { subject: 'analyze goal', assignee: 'analyst' })
  const dynamicSecond = await call('agent_teams_create_task', {
    subject: 'implement result',
    assignee: 'implementer',
    dependencies: [dynamicFirst.task_id],
  })
  await agentTeamsRuntime.updateStagedPlan(captain, 'dynamic-demo', {
    action: 'update_member',
    memberName: 'reviewer',
    role: 'security reviewer',
    provider: 'fake-provider',
    model: 'fake-reviewer-updated',
    reasoningEffort: 'high',
    executionPrompt: 'Review security-sensitive changes only.',
  })
  await agentTeamsRuntime.updateStagedPlan(captain, 'dynamic-demo', {
    action: 'update_task',
    taskId: dynamicSecond.task_id,
    subject: 'implement approved result',
    description: 'Use the analyst output.',
    assignee: 'implementer',
    dependencies: [dynamicFirst.task_id],
  })
  const editedDynamic = await readTeam(stateRoot, 'dynamic-demo')
  check('staged roster and DAG are editable without spawning or dispatching',
    editedDynamic?.members.find(member => member.name === 'reviewer')?.model === 'fake-reviewer-updated'
      && editedDynamic.members.find(member => member.name === 'reviewer')?.executionPrompt === 'Review security-sensitive changes only.'
      && editedDynamic.tasks[1]?.subject === 'implement approved result'
      && editedDynamic.tasks[1]?.dependencies.join(',') === dynamicFirst.task_id
      && editedDynamic.tasks.every(item => item.status === 'pending')
      && deliveries.length === deliveriesBeforePlan)
  const obsoleteReview = await call('agent_teams_create_task', {
    subject: 'obsolete review',
    assignee: 'reviewer',
    dependencies: [dynamicFirst.task_id],
  })
  await agentTeamsRuntime.updateStagedPlan(captain, 'dynamic-demo', {
    action: 'update_task',
    taskId: dynamicSecond.task_id,
    subject: 'implement approved result',
    description: 'Use the analyst output.',
    assignee: 'implementer',
    dependencies: [obsoleteReview.task_id],
  })
  let rejectedAtomicEdit = false
  try {
    await call('agent_teams_edit_plan', {
      operations: [
        { action: 'remove_task', task_id: obsoleteReview.task_id },
        { action: 'update_task', task_id: dynamicSecond.task_id, dependencies: [dynamicFirst.task_id] },
        { action: 'remove_member', member_name: 'reviewer' },
      ],
    })
  } catch {
    rejectedAtomicEdit = true
  }
  const unchangedAfterRejectedEdit = await readTeam(stateRoot, 'dynamic-demo')
  check('invalid staged plan batches fail atomically without a partial write',
    rejectedAtomicEdit
      && unchangedAfterRejectedEdit?.tasks.some(item => item.id === obsoleteReview.task_id)
      && unchangedAfterRejectedEdit.tasks.find(item => item.id === dynamicSecond.task_id)?.dependencies.join(',') === obsoleteReview.task_id
      && unchangedAfterRejectedEdit.members.some(member => member.name === 'reviewer'))
  const captainCancelsBeforeContinue = captain.cancelCount ?? 0
  const captainFollowupsBeforeContinue = captain.followups.length
  const continuedPlan = await agentTeamsRuntime.continueStagedPlanning(captain, 'dynamic-demo')
  const waitingPlan = await readTeam(stateRoot, 'dynamic-demo')
  const feedbackControlText = captain.followups.at(-1)?.content?.map(block => block.text ?? '').join('\n') ?? ''
  check('return-to-chat cancels the planning turn and asks one question without recreating the team',
    continuedPlan.alreadyWaiting === false
      && waitingPlan?.planReviewState === 'awaiting_feedback'
      && (captain.cancelCount ?? 0) === captainCancelsBeforeContinue + 1
      && captain.followups.length === captainFollowupsBeforeContinue + 1
      && /Ask the user one concise, concrete question/.test(feedbackControlText)
      && /Do not create a replacement team/.test(feedbackControlText))
  const repeatedContinue = await agentTeamsRuntime.continueStagedPlanning(captain, 'dynamic-demo')
  check('return-to-chat is idempotent while feedback is already pending',
    repeatedContinue.alreadyWaiting === true
      && (captain.cancelCount ?? 0) === captainCancelsBeforeContinue + 1
      && captain.followups.length === captainFollowupsBeforeContinue + 1)
  const modelEditedPlan = await call('agent_teams_edit_plan', {
    operations: [
      { action: 'update_task', task_id: dynamicSecond.task_id, dependencies: [dynamicFirst.task_id] },
      { action: 'remove_task', task_id: obsoleteReview.task_id },
      { action: 'remove_member', member_name: 'reviewer' },
    ],
  })
  const modelEditedDynamic = await readTeam(stateRoot, 'dynamic-demo')
  check('captain can revise the staged DAG and roster through one model-facing atomic tool',
    modelEditedPlan.status === 'staged'
      && modelEditedPlan.tasks === 2
      && modelEditedPlan.members === 4
      && modelEditedDynamic?.tasks.every(item => item.id !== obsoleteReview.task_id)
      && modelEditedDynamic.tasks.find(item => item.id === dynamicSecond.task_id)?.dependencies.join(',') === dynamicFirst.task_id
      && modelEditedDynamic.members.every(member => member.name !== 'reviewer')
      && modelEditedDynamic.members.every(member => member.id === '')
      && modelEditedDynamic.tasks.every(item => item.status === 'pending')
      && modelEditedDynamic.planReviewState === 'awaiting_review'
      && deliveries.length === deliveriesBeforePlan)
  const approvedDynamic = await call('agent_teams_approve', { confirmation: 'user clicked Approve & Run' })
  const dynamicTeam = await readTeam(stateRoot, 'dynamic-demo')
  check('approval atomically spawns the final roster before dispatch',
    approvedDynamic.status === 'running'
      && dynamicTeam?.phase === 'running'
      && typeof dynamicTeam.approvedAt === 'number'
      && dynamicTeam.members.every(member => member.id !== '')
      && dynamicTeam.tasks[0]?.status === 'pending'
      && dynamicTeam.tasks[1]?.status === 'pending')
  for (const member of dynamicTeam.members) publishStatus(liveAgents.get(member.id), 'idle')
  await call('agent_teams_status', {})
  const dispatchedDynamic = await readTeam(stateRoot, 'dynamic-demo')
  check('approved plan dispatches only after a spawned member becomes idle',
    dispatchedDynamic?.tasks[0]?.status === 'claimed'
      && dispatchedDynamic.tasks[1]?.status === 'pending')
  const dynamicAnalyst = liveAgents.get(dynamicTeam.members.find(member => member.name === 'analyst')?.id)
  const dynamicImplementer = liveAgents.get(dynamicTeam.members.find(member => member.name === 'implementer')?.id)
  const interruptedBeforeHalt = dynamicAnalyst.interruptCount ?? 0
  const captainCancelsBeforeHalt = captain.cancelCount ?? 0
  const halt = await haltTeamWork({
    ctx,
    stateRoot,
    teamId: 'dynamic-demo',
    captain,
    signal: new AbortController().signal,
  })
  const haltedTeam = await readTeam(stateRoot, 'dynamic-demo')
  check('captain halt cancels the approved graph and keeps the team',
    halt.alreadyHalted === false
      && halt.cancelledTasks === 2
      && haltedTeam?.halted === true
      && haltedTeam.tasks.every(item => item.status === 'cancelled'))
  check('team halt cancels the captain turn while preserving queued user input',
    captain.cancelCount === captainCancelsBeforeHalt + 2
      && captain.lastCancel?.cause?.kind === 'user'
      && captain.lastCancel?.options?.keepInbox === true)
  check('captain halt interrupts and drains graph members',
    (dynamicAnalyst.interruptCount ?? 0) > interruptedBeforeHalt
      && (dynamicImplementer.interruptCount ?? 0) > 0
      && (dynamicAnalyst.drainCount ?? 0) > 0
      && (dynamicImplementer.drainCount ?? 0) > 0
      && !liveAgents.has(dynamicAnalyst.id)
      && !liveAgents.has(dynamicImplementer.id))
  const deliveriesAfterHalt = deliveries.length
  await call('agent_teams_status', {})
  check('halted team does not redispatch cancelled graph',
    deliveries.length === deliveriesAfterHalt
      && (await readTeam(stateRoot, 'dynamic-demo'))?.tasks.every(item => item.status === 'cancelled'))
  let silentCreateUnhalted = false
  try {
    await call('agent_teams_create_task', { subject: 'must stay halted' })
    silentCreateUnhalted = (await readTeam(stateRoot, 'dynamic-demo'))?.halted !== true
  } catch {
    silentCreateUnhalted = (await readTeam(stateRoot, 'dynamic-demo'))?.halted !== true
  }
  check('halted create_task does not silently resume',
    silentCreateUnhalted === false && (await readTeam(stateRoot, 'dynamic-demo'))?.halted === true)
  const resume = await call('agent_teams_resume', { reason: 'continue after user answer' })
  check('explicit resume clears halt and keeps cancelled tasks cancelled',
    resume.status === 'resumed'
      && (await readTeam(stateRoot, 'dynamic-demo'))?.halted !== true
      && (await readTeam(stateRoot, 'dynamic-demo'))?.tasks.every(item => item.status === 'cancelled'))
  await call('agent_teams_delete', {})
  const haltedArchive = await readArchivedTeam(stateRoot, 'dynamic-demo')
  check('shutdown preserves cancelled task history in the archive',
    haltedArchive?.tasks.length === 2
      && haltedArchive.tasks.every(item => item.status === 'cancelled'))

  await call('agent_teams_create', { name: 'Quality Loop', description: 'review loop' })
  await call('agent_teams_add_member', { name: 'builder', role: 'implementer' })
  await call('agent_teams_add_member', { name: 'critic', role: 'reviewer' })
  const impl = await call('agent_teams_create_task', {
    subject: 'implement parser',
    assignee: 'builder',
    kind: 'implementation',
    objective: 'Ship the parser',
    inScope: ['src/parser.ts'],
    acceptance: ['parser accepts empty input'],
    verify: ['pnpm test'],
  })
  let missingContractRejected = false
  try {
    await call('agent_teams_create_task', { subject: 'impl without contract', kind: 'implementation' })
  } catch {
    missingContractRejected = true
  }
  check('quality implementation without contract is rejected', missingContractRejected)
  const qualityTeam = await readTeam(stateRoot, 'quality-loop')
  const builder = [...liveAgents.values()].find(agent => qualityTeam?.members.some(member => member.id === agent.id && member.name === 'builder'))
  const criticMember = [...liveAgents.values()].find(agent => qualityTeam?.members.some(member => member.id === agent.id && member.name === 'critic'))
  const implClaim = await call('agent_teams_claim_task', { task_id: impl.task_id }, builder)
  await call('agent_teams_update_task', { task_id: impl.task_id, status: 'in_progress', attempt_id: implClaim.attempt_id }, builder)
  let illegalCompleteRejected = false
  try {
    await call('agent_teams_update_task', {
      task_id: impl.task_id,
      status: 'completed',
      attempt_id: implClaim.attempt_id,
      output: 'looks fine',
    }, builder)
  } catch {
    illegalCompleteRejected = true
  }
  check('illegal completed without acceptance evidence is rejected', illegalCompleteRejected)
  await call('agent_teams_update_task', {
    task_id: impl.task_id,
    status: 'completed',
    attempt_id: implClaim.attempt_id,
    output: 'parser shipped',
    changedPaths: ['src/parser.ts'],
    acceptanceResults: [{ criterion: 'parser accepts empty input', status: 'passed' }],
    commandsRun: [{ command: 'pnpm test', status: 'passed' }],
  }, builder)
  const review = await call('agent_teams_create_task', {
    subject: 'review parser',
    assignee: 'critic',
    kind: 'review',
    objective: 'Review the parser',
    acceptance: ['no blocker or high findings'],
    reviewedTaskId: impl.task_id,
  })
  const reviewClaim = await call('agent_teams_claim_task', { task_id: review.task_id }, criticMember)
  await call('agent_teams_update_task', { task_id: review.task_id, status: 'in_progress', attempt_id: reviewClaim.attempt_id }, criticMember)
  let needsRevisionCompleteRejected = false
  try {
    await call('agent_teams_update_task', {
      task_id: review.task_id,
      status: 'completed',
      attempt_id: reviewClaim.attempt_id,
      verdict: 'needs_revision',
      findings: [{ id: 'C-001', severity: 'high', problem: 'null crash', requiredFix: 'guard empty input', file: 'src/parser.ts' }],
    }, criticMember)
  } catch {
    needsRevisionCompleteRejected = true
  }
  check('review needs_revision cannot complete', needsRevisionCompleteRejected)
  await call('agent_teams_update_task', {
    task_id: review.task_id,
    status: 'failed',
    attempt_id: reviewClaim.attempt_id,
    verdict: 'needs_revision',
    findings: [{ id: 'C-001', severity: 'high', problem: 'null crash', requiredFix: 'guard empty input', file: 'src/parser.ts' }],
  }, criticMember)
  const afterReview = await readTeam(stateRoot, 'quality-loop')
  const repair = afterReview?.tasks.find(item => item.kind === 'repair')
  const nextReview = afterReview?.tasks.find(item => item.kind === 'review' && item.id !== review.task_id)
  check('needs_revision opens repair and next review',
    repair !== undefined && nextReview !== undefined
      && repair.dependencies.includes(impl.task_id)
      && !repair.dependencies.includes(review.task_id)
      && nextReview.assignee === 'critic'
      && nextReview.assignee !== 'builder')
  await call('agent_teams_delete', {})

  await call('agent_teams_create', { name: 'Lifecycle', description: 'adversarial DAG' })
  const addedAlpha = await call('agent_teams_add_member', { name: 'alpha', role: 'slow implementer' })
  const addedBeta = await call('agent_teams_add_member', { name: 'beta', role: 'researcher' })
  const addedGamma = await call('agent_teams_add_member', { name: 'gamma', role: 'reviewer' })
  const alpha = liveAgents.get(addedAlpha.member_id)
  const beta = liveAgents.get(addedBeta.member_id)
  const gamma = liveAgents.get(addedGamma.member_id)
  publishStatus(alpha, 'idle')
  publishStatus(beta, 'idle')
  publishStatus(gamma, 'idle')

  const t1 = await call('agent_teams_create_task', { subject: 'slow branch', assignee: 'alpha' })
  const firstAttempt = await task(t1.task_id)
  check('idle assigned member is claimed and woken automatically',
    firstAttempt?.status === 'claimed' && firstAttempt.assignee === 'alpha'
      && deliveries.some(delivery => delivery.childId === alpha.id))
  const alphaClaim = await call('agent_teams_claim_task', { task_id: t1.task_id }, alpha)
  check('member observes the scheduler attempt idempotently', alphaClaim.attempt_id === firstAttempt?.attemptId)
  await call('agent_teams_update_task', {
    task_id: t1.task_id, status: 'in_progress', attempt_id: alphaClaim.attempt_id,
  }, alpha)

  const t2 = await call('agent_teams_create_task', { subject: 'parallel research', assignee: 'beta' })
  const t3 = await call('agent_teams_create_task', {
    subject: 'integration gate', assignee: 'gamma', dependencies: [t1.task_id, t2.task_id],
  })
  const betaClaim = await call('agent_teams_claim_task', { task_id: t2.task_id }, beta)
  await call('agent_teams_update_task', {
    task_id: t2.task_id, status: 'in_progress', attempt_id: betaClaim.attempt_id,
  }, beta)
  check('dependency gate stays pending before both branches complete', (await task(t3.task_id))?.status === 'pending')

  // A normal turn may end while its task is intentionally parked waiting for
  // guidance, and a user can explicitly pause a running member. Neither case
  // authorizes the scheduler to revoke the live attempt. Repeated status kicks
  // must be idempotent until the captain performs an explicit reassignment.
  publishStatus(alpha, 'idle')
  await new Promise(resolve => setTimeout(resolve, 20))
  // Normal continuable settlement disposes its live AgentHandle between
  // turns. The process-local idle observation must still distinguish this
  // parked attempt from a cold process restart.
  liveAgents.delete(alpha.id)
  const deliveriesBeforeParkedKicks = deliveries.length
  await Promise.all([
    call('agent_teams_status', {}),
    call('agent_teams_status', {}),
    call('agent_teams_status', {}),
  ])
  await new Promise(resolve => setTimeout(resolve, 20))
  const parkedAlpha = await task(t1.task_id)
  check('resident idle owner keeps its open attempt across repeated scheduler kicks',
    parkedAlpha?.status === 'in_progress'
      && parkedAlpha.attempt === alphaClaim.attempt
      && parkedAlpha.attemptId === alphaClaim.attempt_id
      && deliveries.length === deliveriesBeforeParkedKicks)
  liveAgents.set(alpha.id, alpha)

  publishStatus(beta, 'idle')
  await new Promise(resolve => setTimeout(resolve, 20))
  const deliveriesBeforeResume = deliveries.length
  const resumedBeta = await call('agent_teams_send_message', {
    to: 'beta', content: 'Continue the same parked task and keep its current attempt id.',
  })
  const resumedBetaTask = await task(t2.task_id)
  check('captain message resumes a parked owner without rotating its attempt',
    resumedBeta.delivered === 'wake'
      && deliveries.length === deliveriesBeforeResume + 1
      && resumedBetaTask?.attempt === betaClaim.attempt
      && resumedBetaTask.attemptId === betaClaim.attempt_id)

  let unsafeCaptainTakeoverRejected = false
  try {
    await call('agent_teams_update_task', {
      task_id: t1.task_id, status: 'completed', output: 'captain bypassed handoff',
    })
  } catch (error) {
    unsafeCaptainTakeoverRejected = /reassign_task/.test(String(error))
  }
  check('captain cannot bypass the safe takeover protocol', unsafeCaptainTakeoverRejected)

  const takeover = await call('agent_teams_reassign_task', {
    task_id: t1.task_id, assignee: 'gamma', reason: 'alpha is stuck',
  })
  const reassigned = await task(t1.task_id)
  check('reassignment quiesces old owner and creates a new attempt',
    takeover.assignee === 'gamma' && reassigned?.status === 'claimed'
      && reassigned.attemptId !== alphaClaim.attempt_id
      && takeover.attempt === alphaClaim.attempt + 1)
  let staleRejected = false
  try {
    await call('agent_teams_update_task', {
      task_id: t1.task_id, status: 'completed', output: 'late alpha', attempt_id: alphaClaim.attempt_id,
    }, alpha)
  } catch (error) {
    staleRejected = /assigned to|stale attempt/.test(String(error))
  }
  check('old member cannot publish a late takeover result', staleRejected)

  const gammaClaim = await call('agent_teams_claim_task', { task_id: t1.task_id }, gamma)
  await call('agent_teams_update_task', {
    task_id: t1.task_id, status: 'in_progress', attempt_id: gammaClaim.attempt_id,
  }, gamma)
  await call('agent_teams_update_task', {
    task_id: t1.task_id, status: 'completed', output: 'gamma result', attempt_id: gammaClaim.attempt_id,
  }, gamma)
  await call('agent_teams_update_task', {
    task_id: t2.task_id, status: 'completed', output: 'beta result', attempt_id: betaClaim.attempt_id,
  }, beta)
  check('resumed member completes with the original parked capability',
    (await task(t2.task_id))?.status === 'completed'
      && (await task(t2.task_id))?.attemptId === betaClaim.attempt_id)
  publishStatus(beta, 'idle')
  publishStatus(gamma, 'idle')
  await new Promise(resolve => setTimeout(resolve, 20))
  const gate = await task(t3.task_id)
  check('completing dependencies dispatches the downstream task', gate?.status === 'claimed' && gate.assignee === 'gamma')
  const gateClaim = await call('agent_teams_claim_task', { task_id: t3.task_id }, gamma)
  await call('agent_teams_update_task', {
    task_id: t3.task_id, status: 'in_progress', attempt_id: gateClaim.attempt_id,
  }, gamma)
  await call('agent_teams_update_task', {
    task_id: t3.task_id, status: 'completed', output: 'integrated', attempt_id: gateClaim.attempt_id,
  }, gamma)

  publishStatus(alpha, 'idle')
  publishStatus(beta, 'idle')
  gamma.status = 'running'
  const t4 = await call('agent_teams_create_task', { subject: 'later-round assigned work', assignee: 'alpha' })
  const reused = await task(t4.task_id)
  check('previously interrupted member is reused in a later round', reused?.assignee === 'alpha' && reused.status === 'claimed')

  const t5 = await call('agent_teams_create_task', { subject: 'must wait behind alpha', assignee: 'alpha' })
  let busyRejected = false
  try {
    await call('agent_teams_claim_task', { task_id: t5.task_id }, alpha)
  } catch (error) {
    busyRejected = /busy with/.test(String(error))
  }
  check('a member cannot claim a second unfinished task', busyRejected)
  await call('agent_teams_reassign_task', {
    task_id: t5.task_id, assignee: 'captain', reason: 'close busy-check task',
  })
  await call('agent_teams_update_task', { task_id: t5.task_id, status: 'in_progress' })
  await call('agent_teams_update_task', { task_id: t5.task_id, status: 'completed', output: 'closed' })

  await call('agent_teams_remove_member', { name: 'alpha' })
  const afterRemoval = await state()
  const recovered = afterRemoval?.tasks.find(candidate => candidate.id === t4.task_id)
  check('removing a member revokes and redispatches its unfinished task',
    afterRemoval?.members.find(member => member.name === 'alpha')?.status === 'removed'
      && recovered?.assignee !== 'alpha')
  check('removing a member preserves its catalog entry for transcript history',
    (await ctx.subagents.listChildren(captain.id)).some(child => child.id === alpha.id))
  let removedFollowupRejected = false
  const deliveriesBeforeRemovedFollowup = deliveries.length
  try {
    await ctx.subagents.followup(captain, alpha.id, [{ type: 'text', text: 'must not resume' }], {
      source: { kind: 'plugin', plugin: 'verification' }, signal: new AbortController().signal,
    })
  } catch (error) {
    removedFollowupRejected = error?.code === 'NOT_RESUMABLE'
  }
  check('removing a member blocks direct followup before resume',
    removedFollowupRejected && deliveries.length === deliveriesBeforeRemovedFollowup)
  let removedRejected = false
  try {
    await call('agent_teams_update_task', {
      task_id: t4.task_id, status: 'completed', output: 'removed alpha', attempt_id: reused?.attemptId,
    }, alpha)
  } catch {
    removedRejected = true
  }
  check('removed member loses participant authorization', removedRejected)

  // Finish all work recovered from alpha so beta/gamma are free for later races.
  for (const recoveredTaskId of [t4.task_id]) {
    const current = await task(recoveredTaskId)
    if (!current?.assignee || current.status !== 'claimed') continue
    const owner = current.assignee === 'beta' ? beta : gamma
    const claim = await call('agent_teams_claim_task', { task_id: recoveredTaskId }, owner)
    await call('agent_teams_update_task', { task_id: recoveredTaskId, status: 'in_progress', attempt_id: claim.attempt_id }, owner)
    await call('agent_teams_update_task', {
      task_id: recoveredTaskId, status: 'completed', output: 'recovered', attempt_id: claim.attempt_id,
    }, owner)
  }

  gamma.status = 'idle'
  failNextDelivery.add(gamma.id)
  const fallback = await call('agent_teams_send_message', { to: 'gamma', content: 'durable fallback' })
  check('failed live message remains one unread durable fallback',
    fallback.delivered === 'mailbox' && (await readUnreadMailbox(stateRoot, teamId, 'gamma')).length === 1)
  await call('agent_teams_status', {})
  check('status kick redelivers and acknowledges fallback exactly once',
    (await readUnreadMailbox(stateRoot, teamId, 'gamma')).length === 0)

  beta.status = 'running'
  gamma.status = 'running'
  const t6 = await call('agent_teams_create_task', { subject: 'concurrent claim' })
  beta.status = 'idle'
  gamma.status = 'idle'
  const race = await Promise.allSettled([
    call('agent_teams_claim_task', { task_id: t6.task_id }, beta),
    call('agent_teams_claim_task', { task_id: t6.task_id }, gamma),
  ])
  check('concurrent claims serialize to exactly one owner',
    race.filter(result => result.status === 'fulfilled').length === 1
      && race.filter(result => result.status === 'rejected').length === 1)
  const won = race.find(result => result.status === 'fulfilled').value
  const winner = won.assignee === 'beta' ? beta : gamma
  // A successful member claim is made from a running model turn. Preserve
  // that Harness status edge before unrelated kicks can retry an idle claim.
  winner.status = 'running'
  await call('agent_teams_update_task', { task_id: t6.task_id, status: 'in_progress', attempt_id: won.attempt_id }, winner)
  await call('agent_teams_update_task', {
    task_id: t6.task_id, status: 'completed', output: 'winner', attempt_id: won.attempt_id,
  }, winner)
  let terminalRejected = false
  try {
    await call('agent_teams_update_task', {
      task_id: t6.task_id, status: 'completed', output: 'late overwrite', attempt_id: won.attempt_id,
    }, winner)
  } catch (error) {
    terminalRejected = /immutable/.test(String(error))
  }
  check('terminal output is immutable against late overwrite', terminalRejected)

  beta.status = 'idle'
  const t7 = await call('agent_teams_create_task', { subject: 'captain takeover', assignee: 'beta' })
  const betaTakeoverClaim = await call('agent_teams_claim_task', { task_id: t7.task_id }, beta)
  await call('agent_teams_update_task', {
    task_id: t7.task_id, status: 'in_progress', attempt_id: betaTakeoverClaim.attempt_id,
  }, beta)
  const captainAttempt = await call('agent_teams_reassign_task', {
    task_id: t7.task_id, assignee: 'captain', reason: 'deadline takeover',
  })
  await call('agent_teams_update_task', { task_id: t7.task_id, status: 'in_progress' })
  await call('agent_teams_update_task', { task_id: t7.task_id, status: 'completed', output: 'captain result' })
  let lateTakeoverRejected = false
  try {
    await call('agent_teams_update_task', {
      task_id: t7.task_id, status: 'completed', output: 'late beta', attempt_id: betaTakeoverClaim.attempt_id,
    }, beta)
  } catch {
    lateTakeoverRejected = true
  }
  check('captain takeover owns a fresh attempt and rejects the old member',
    captainAttempt.assignee === 'captain' && captainAttempt.attempt_id !== betaTakeoverClaim.attempt_id
      && captainAttempt.status === 'in_progress'
      && captainAttempt.attempt === betaTakeoverClaim.attempt + 1
      && lateTakeoverRejected && (await task(t7.task_id))?.output === 'captain result')

  // A captain is one execution lane, not an unlimited pseudo-member. Two
  // parallel takeovers previously produced the issue #77 state: both member
  // rows lost their tasks while two captain-owned attempts stayed parked.
  beta.status = 'idle'
  gamma.status = 'idle'
  const t8 = await call('agent_teams_create_task', { subject: 'parallel captain takeover A', assignee: 'beta' })
  const t9 = await call('agent_teams_create_task', { subject: 'parallel captain takeover B', assignee: 'gamma' })
  const betaParallelClaim = await call('agent_teams_claim_task', { task_id: t8.task_id }, beta)
  const gammaParallelClaim = await call('agent_teams_claim_task', { task_id: t9.task_id }, gamma)
  await call('agent_teams_update_task', {
    task_id: t8.task_id, status: 'in_progress', attempt_id: betaParallelClaim.attempt_id,
  }, beta)
  await call('agent_teams_update_task', {
    task_id: t9.task_id, status: 'in_progress', attempt_id: gammaParallelClaim.attempt_id,
  }, gamma)
  const captainTakeoverRace = await Promise.allSettled([
    call('agent_teams_reassign_task', {
      task_id: t8.task_id, assignee: 'captain', reason: 'parallel takeover guard A',
    }),
    call('agent_teams_reassign_task', {
      task_id: t9.task_id, assignee: 'captain', reason: 'parallel takeover guard B',
    }),
  ])
  const raceState = await state()
  check('parallel captain takeovers allow exactly one active captain task',
    captainTakeoverRace.filter(result => result.status === 'fulfilled').length === 1
      && captainTakeoverRace.filter(result => result.status === 'rejected'
        && /captain is busy with/.test(String(result.reason))).length === 1
      && raceState?.tasks.filter(candidate => candidate.assignee === 'captain'
        && (candidate.status === 'claimed' || candidate.status === 'in_progress')).length === 1)

  // If the captain ends the turn without completing that one takeover, it
  // must return to the ordinary member scheduler instead of staying white and
  // ownerless forever in the activity panel.
  publishStatus(captain, 'idle')
  await new Promise(resolve => setTimeout(resolve, 20))
  const afterCaptainIdle = await state()
  const recoveredParallel = afterCaptainIdle?.tasks.filter(candidate => (
    candidate.id === t8.task_id || candidate.id === t9.task_id
  )) ?? []
  check('unfinished captain takeover returns to a member when the captain becomes idle',
    recoveredParallel.length === 2
      && recoveredParallel.every(candidate => candidate.assignee !== 'captain')
      && recoveredParallel.every(candidate => candidate.status === 'claimed' || candidate.status === 'in_progress'))
  for (const recoveredTask of recoveredParallel) {
    const owner = recoveredTask.assignee === 'beta' ? beta : gamma
    owner.status = 'running'
    const claim = await call('agent_teams_claim_task', { task_id: recoveredTask.id }, owner)
    await call('agent_teams_update_task', {
      task_id: recoveredTask.id, status: 'in_progress', attempt_id: claim.attempt_id,
    }, owner)
    await call('agent_teams_update_task', {
      task_id: recoveredTask.id, status: 'completed', output: 'member recovered captain work', attempt_id: claim.attempt_id,
    }, owner)
  }

  beta.status = 'running'
  gamma.status = 'idle'
  const snapshot = await call('agent_teams_status', {})
  check('activity refines residency through the live Agent registry',
    snapshot.members.find(member => member.name === 'beta')?.activity === 'running'
      && snapshot.members.find(member => member.name === 'gamma')?.activity === 'idle')

  beta.status = 'idle'
  gamma.status = 'idle'
  // Exercise the storage-only ready path: deletion must deny cold resume
  // without materializing the member or spending a model turn.
  liveAgents.delete(gamma.id)
  await call('agent_teams_delete', {})
  const archived = await readArchivedTeam(stateRoot, teamId)
  check('team shutdown archives the complete durable record',
    await readTeam(stateRoot, teamId) === undefined
      && archived !== undefined)
  const archivedSnapshot = (await collectArchivedTeamsActivity(ctx, [{ workspace, stateRoot }]))
    .find(candidate => candidate.teamId === teamId)
  check('archived activity keeps every member after shutdown',
    archivedSnapshot?.members.length === 3
      && ['alpha', 'beta', 'gamma'].every(name => archivedSnapshot.members.some(member => member.name === name))
      && archivedSnapshot.members.every(member => member.activity === 'idle'))
  check('archived activity projects each member model onto assigned tasks',
    archivedSnapshot?.members.every(member => member.provider === 'fake' && member.model === 'fake-model')
      && archivedSnapshot.tasks
        .filter(task => ['alpha', 'beta', 'gamma'].includes(task.assignee))
        .every(task => task.model === 'fake/fake-model'))
  check('team shutdown keeps retired members catalog-visible for historical transcripts',
    (await ctx.subagents.listChildren(captain.id))
      .filter(child => child.kind === 'child'
        && child.mode === 'continuable'
        && child.label.startsWith('agent-teams:lifecycle:')).length === 3)
  let coldFollowupRejected = false
  const deliveriesBeforeColdFollowup = deliveries.length
  try {
    await ctx.subagents.followup(captain, gamma.id, [{ type: 'text', text: 'must stay retired' }], {
      source: { kind: 'plugin', plugin: 'verification' }, signal: new AbortController().signal,
    })
  } catch (error) {
    coldFollowupRejected = error?.code === 'NOT_RESUMABLE'
  }
  check('team shutdown blocks storage-only member cold resume',
    coldFollowupRejected && deliveries.length === deliveriesBeforeColdFollowup)
  check('team shutdown leaves unrelated continuable subagents untouched',
    (await ctx.subagents.listChildren(captain.id))
      .some(child => child.id === 'foreign-session' && child.mode === 'continuable'))
  const foreignFollowup = await ctx.subagents.followup(captain, 'foreign-session', [
    { type: 'text', text: 'unrelated work still routes' },
  ], {
    source: { kind: 'plugin', plugin: 'verification' }, signal: new AbortController().signal,
  })
  check('team shutdown leaves unrelated continuable followup untouched',
    typeof foreignFollowup === 'string'
      && deliveries.some(delivery => delivery.childId === 'foreign-session'))

  await call('agent_teams_create', {
    name: 'Atomic Approval',
    description: 'invalid route must not partially start',
    approval: 'required',
  })
  await call('agent_teams_add_member', { name: 'valid', role: 'writer', provider: 'fake', model: 'fake-model' })
  await call('agent_teams_add_member', { name: 'invalid', role: 'reviewer', provider: 'fake', model: 'typo-model' })
  await call('agent_teams_create_task', { subject: 'must remain staged', assignee: 'valid' })
  const childrenBeforeRejectedApproval = children.length
  advertisedModels = ['fake-model']
  let invalidApprovalRejected = false
  try {
    await call('agent_teams_approve', { confirmation: 'user clicked Approve & Run' })
  } catch (error) {
    invalidApprovalRejected = /unknown member model.*typo-model/i.test(String(error?.message ?? error))
  }
  const rejectedApprovalTeam = await readTeam(stateRoot, 'atomic-approval')
  check('invalid roster approval rejects before any member session is created',
    invalidApprovalRejected
      && children.length === childrenBeforeRejectedApproval
      && rejectedApprovalTeam?.phase === 'staged'
      && rejectedApprovalTeam.members.every(member => member.id === '')
      && rejectedApprovalTeam.tasks.every(item => item.status === 'pending'))
  advertisedModels = []
  await call('agent_teams_delete', {})

  await call('agent_teams_create', { name: 'Lifecycle', description: 'second generation' })
  await call('agent_teams_delete', {})
  const replacementArchive = await readArchivedTeam(stateRoot, teamId)
  check('same-name team can be recreated and archived again',
    await readTeam(stateRoot, teamId) === undefined
      && replacementArchive?.description === 'second generation')
} finally {
  await rm(workspace, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n${failures.length} lifecycle check(s) FAILED: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nall lifecycle checks passed')
