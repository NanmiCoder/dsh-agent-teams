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
import { registerAgentTeamsTools } from '../lib/tools.js'
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
    steer() {},
    cancel() {},
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
      if (child) publishStatus(child, 'idle')
    },
  },
  logger: { debug() {}, warn() {} },
}

registerAgentTeamsTools(ctx, {
  stateDir: '.agent-teams',
  memberProvider: 'spawn',
  memberMaxDepth: 1,
  maxMembers: 8,
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
try {
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
  check('removing a member removes its continuable catalog entry',
    (await ctx.subagents.listChildren(captain.id)).every(child => child.id !== alpha.id))
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
      && captainAttempt.attempt === betaTakeoverClaim.attempt + 1
      && lateTakeoverRejected && (await task(t7.task_id))?.output === 'captain result')

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
  check('team shutdown retires live, cold, and previously removed members',
    (await ctx.subagents.listChildren(captain.id))
      .filter(child => child.kind === 'child'
        && child.mode === 'continuable'
        && child.label.startsWith('agent-teams:')).length === 0)
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
