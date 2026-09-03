/**
 * Deterministic AgentTeams scheduler stress and restart verification.
 *
 * The actual compiled production tools are driven through eight continuable
 * members and a 31-node fan-out/fan-in DAG. Faults include two interrupted
 * attempts, member removal, stale update storms, a process-cold restart with
 * open tasks, delivery failures, a claim thundering herd, and terminal write
 * storms. The fake surface models Harness contracts; task and mailbox logic is
 * never reimplemented here.
 */

import { queueSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerAgentTeamsTools } from '../lib/tools.js'
import { readArchivedTeam, readTeam, readUnreadMailbox } from '../lib/state.js'

const workspace = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-stress-'))
const stateRoot = join(workspace, '.agent-teams')
const teamId = 'stress-matrix'
const children = []
const deliveries = []
const failures = []
const failDeliveryCount = new Map()
let childSeq = 0
let messageSeq = 0
let runtime

const memberNames = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta']

function check(label, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL'
  console.log(`  ${status}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

function session(parentSession) {
  return {
    header: { cwd: workspace, parentSession },
    events: [],
    ownEvents() {
      return this.events.slice(this.header.inheritedEventCount ?? 0)
    },
    append() {},
    requestHeader() {
      return { config: { provider: 'stress', model: 'stress-model', reasoningEffort: 'high' } }
    },
  }
}

function makeAgent(id, parentSession) {
  return {
    id,
    status: 'idle',
    options: { provider: 'stress', model: 'stress-model' },
    session: session(parentSession),
    steer() {},
    cancel() {},
    whenIdle() {
      return this.status === 'idle' ? Promise.resolve() : new Promise(resolve => { this._idle = resolve })
    },
  }
}

function mountRuntime() {
  const definitions = new Map()
  const listeners = new Map()
  const liveAgents = new Map()
  const captain = makeAgent('stress-captain')
  liveAgents.set(captain.id, captain)

  const publishStatus = (subject, status) => {
    subject.status = status
    if (status === 'idle') {
      subject._idle?.()
      subject._idle = undefined
    }
    for (const listener of listeners.get('agent/status') ?? []) listener({ agent: subject, status })
  }

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
      async listModels() {
        return []
      },
    },
    subagents: {
      getProvider(name) {
        if (name !== 'spawn') return undefined
        return { prepareContinuable() {}, capabilities: { persona: true, toolFilter: true } }
      },
      list() {
        return ['spawn']
      },
      async startContinuable(spec) {
        const id = `stress-member-${++childSeq}`
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
          // Deliberately residency-only; the plugin must refine through agents.get().
          activity: liveAgents.has(child.id) ? 'running' : 'inactive',
          hasChildren: false,
        }))
      },
      async listDescendants(parentId) {
        return this.listChildren(parentId)
      },
      async [queueSubagentPrompt](_parent, childId, content) {
        const remaining = failDeliveryCount.get(childId) ?? 0
        if (remaining > 0) {
          failDeliveryCount.set(childId, remaining - 1)
          throw new Error('injected followup failure')
        }
        let child = liveAgents.get(childId)
        if (child === undefined) {
          // Harness cold-resumes a continuable child on a waking followup.
          child = makeAgent(childId, captain.id)
          liveAgents.set(childId, child)
        }
        child.status = 'running'
        deliveries.push({ childId, content, runtime: runtime?.generation ?? 0 })
        return `message-${++messageSeq}`
      },
      interrupt(childId) {
        const child = liveAgents.get(childId)
        if (child !== undefined) publishStatus(child, 'idle')
      },
    },
    logger: { debug() {}, warn() {} },
  }

  registerAgentTeamsTools(ctx, {
    stateDir: '.agent-teams',
    memberProvider: 'spawn',
    memberMaxDepth: 1,
    maxMembers: 8,
    profiles: {},
  })

  return {
    generation: (runtime?.generation ?? 0) + 1,
    captain,
    ctx,
    definitions,
    liveAgents,
    publishStatus,
  }
}

function execFor(subject) {
  return { agent: subject, signal: new AbortController().signal }
}

async function call(name, args, subject = runtime.captain) {
  const definition = runtime.definitions.get(name)
  if (definition === undefined) throw new Error(`missing tool ${name}`)
  return definition.execute(args, execFor(subject))
}

async function state() {
  return readTeam(stateRoot, teamId)
}

async function memberRecord(name) {
  return (await state())?.members.find(member => member.name === name)
}

async function liveMember(name) {
  const record = await memberRecord(name)
  return record === undefined ? undefined : runtime.liveAgents.get(record.id)
}

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 8))
}

async function idle(subject) {
  runtime.publishStatus(subject, 'idle')
  await settle()
}

async function completeClaimed(task, outputPrefix = 'stress') {
  const owner = task.assignee === 'captain' ? runtime.captain : await liveMember(task.assignee)
  if (owner === undefined) throw new Error(`no live owner for ${task.id}/${task.assignee}`)
  const claim = await call('agent_teams_claim_task', { task_id: task.id }, owner)
  if (task.assignee === 'captain') {
    await call('agent_teams_update_task', { task_id: task.id, status: 'in_progress' }, owner)
    await call('agent_teams_update_task', {
      task_id: task.id, status: 'completed', output: `${outputPrefix}:${task.id}:${task.assignee}`,
    }, owner)
  } else {
    await call('agent_teams_update_task', {
      task_id: task.id, status: 'in_progress', attempt_id: claim.attempt_id,
    }, owner)
    await call('agent_teams_update_task', {
      task_id: task.id,
      status: 'completed',
      output: `${outputPrefix}:${task.id}:${task.assignee}:a${claim.attempt}`,
      attempt_id: claim.attempt_id,
    }, owner)
    await idle(owner)
  }
  return claim
}

async function drain(holdIds = new Set(), requiredHeld = 0) {
  const held = new Map()
  for (let round = 0; round < 400; round += 1) {
    await call('agent_teams_status', {})
    await settle()
    const snapshot = await state()
    if (snapshot === undefined) throw new Error('team disappeared during drain')

    for (const task of snapshot.tasks) {
      if (!holdIds.has(task.id) || held.has(task.id) || task.status !== 'claimed') continue
      const owner = await liveMember(task.assignee)
      if (owner === undefined) throw new Error(`held task ${task.id} has no live owner`)
      const claim = await call('agent_teams_claim_task', { task_id: task.id }, owner)
      await call('agent_teams_update_task', {
        task_id: task.id, status: 'in_progress', attempt_id: claim.attempt_id,
      }, owner)
      held.set(task.id, { owner, claim })
    }

    const fresh = await state()
    const runnable = fresh.tasks.filter(task => task.status === 'claimed' && !holdIds.has(task.id))
    if (runnable.length > 0) {
      await Promise.all(runnable.map(task => completeClaimed(task)))
      continue
    }

    const unfinished = fresh.tasks.filter(task => task.status !== 'completed')
    if (requiredHeld > 0
      && held.size >= requiredHeld
      && unfinished.every(task => held.has(task.id) || task.status === 'pending')) return held
    if (unfinished.length === 0 && requiredHeld === 0) return held
  }
  const snapshot = await state()
  throw new Error(`drain exceeded 400 rounds: ${JSON.stringify(snapshot?.tasks.map(task => ({ id: task.id, status: task.status, assignee: task.assignee, dependencies: task.dependencies })))}`)
}

function dagSpecs() {
  const specs = []
  for (let index = 1; index <= 8; index += 1) {
    specs.push({ subject: `root-${index}`, assignee: memberNames[index - 1], dependencies: [] })
  }
  for (const [subject, dependencies] of [
    ['pair-9', ['t1', 't2']], ['pair-10', ['t3', 't4']],
    ['pair-11', ['t5', 't6']], ['pair-12', ['t7', 't8']],
    ['cross-13', ['t1', 't3']], ['cross-14', ['t2', 't4']],
    ['cross-15', ['t5', 't7']], ['cross-16', ['t6', 't8']],
    ['merge-17', ['t9', 't10']], ['merge-18', ['t11', 't12']],
    ['merge-19', ['t13', 't14']], ['merge-20', ['t15', 't16']],
    ['merge-21', ['t9', 't13']], ['merge-22', ['t10', 't14']],
    ['merge-23', ['t11', 't15']], ['merge-24', ['t12', 't16']],
    ['stage-25', ['t17', 't18']], ['stage-26', ['t19', 't20']],
    ['stage-27', ['t21', 't22']], ['stage-28', ['t23', 't24']],
    ['aggregate-29', ['t25', 't26']], ['aggregate-30', ['t27', 't28']],
    ['final-31', ['t29', 't30']],
  ]) specs.push({ subject, dependencies })
  return specs
}

console.log('dsh-agent-teams complex stress verification')
runtime = mountRuntime()
try {
  await call('agent_teams_create', { name: 'Stress Matrix', description: '8 members, 31-node DAG, injected failures and cold restart' })
  for (const name of memberNames) {
    await call('agent_teams_add_member', { name, role: `${name}-specialist` })
  }

  // Keep every member unavailable while the complete graph is created. This
  // separates graph construction from the first scheduler wave.
  for (const name of memberNames) {
    const agent = await liveMember(name)
    agent.status = 'running'
  }
  for (const spec of dagSpecs()) {
    await call('agent_teams_create_task', {
      subject: spec.subject,
      dependencies: spec.dependencies,
      ...spec.assignee === undefined ? {} : { assignee: spec.assignee },
    })
  }

  await Promise.all(memberNames.map(async name => idle(await liveMember(name))))
  let snapshot = await state()
  let roots = snapshot.tasks.slice(0, 8)
  // Status notifications schedule reconciliation asynchronously. Under a busy
  // event loop, one fixed sleep can observe the wave while it is still being
  // written, so wait for the actual scheduler invariant instead of elapsed
  // wall-clock time.
  for (let round = 0; round < 100; round += 1) {
    if (roots.every(task => task.status === 'claimed')
      && new Set(roots.map(task => task.assignee)).size === 8) break
    await call('agent_teams_status', {})
    await settle()
    snapshot = await state()
    roots = snapshot.tasks.slice(0, 8)
  }
  check('first wave assigns all eight roots to eight distinct members',
    roots.every(task => task.status === 'claimed') && new Set(roots.map(task => task.assignee)).size === 8)

  const alphaOld = await liveMember('alpha')
  const betaOld = await liveMember('beta')
  const alphaClaim = await call('agent_teams_claim_task', { task_id: 't1' }, alphaOld)
  const betaClaim = await call('agent_teams_claim_task', { task_id: 't2' }, betaOld)
  await call('agent_teams_update_task', { task_id: 't1', status: 'in_progress', attempt_id: alphaClaim.attempt_id }, alphaOld)
  await call('agent_teams_update_task', { task_id: 't2', status: 'in_progress', attempt_id: betaClaim.attempt_id }, betaOld)

  // Complete the other six roots concurrently while alpha hangs and beta is
  // about to disappear. Scheduler activity continues on any unlocked branch.
  await Promise.all(roots.slice(2).map(task => completeClaimed(task, 'root-wave')))

  const [takeover, removal] = await Promise.all([
    call('agent_teams_reassign_task', {
      task_id: 't1', assignee: 'captain', reason: 'alpha injected hang',
    }),
    call('agent_teams_remove_member', { name: 'beta' }),
  ])
  check('captain takeover and member removal serialize without losing either mutation',
    takeover.attempt === 2 && takeover.assignee === 'captain'
      && removal.requeued_tasks.includes('t2'))
  await completeClaimed((await state()).tasks.find(task => task.id === 't1'), 'captain-takeover')

  const alphaReuse = await call('agent_teams_create_task', {
    subject: 'alpha-reuse-after-interrupt', assignee: 'alpha', dependencies: ['t1'],
  })

  const staleStorm = await Promise.allSettled([
    ...Array.from({ length: 25 }, () => call('agent_teams_update_task', {
      task_id: 't1', status: 'completed', output: 'late alpha storm', attempt_id: alphaClaim.attempt_id,
    }, alphaOld)),
    ...Array.from({ length: 25 }, () => call('agent_teams_update_task', {
      task_id: 't2', status: 'completed', output: 'late beta storm', attempt_id: betaClaim.attempt_id,
    }, betaOld)),
  ])
  check('50 stale/removed-owner writes are rejected during continued scheduling',
    staleStorm.every(result => result.status === 'rejected'))

  const secondFault = await drain(new Set(['t19']), 1)
  snapshot = await state()
  check('interrupted alpha is reused while the 31-node DAG keeps advancing',
    snapshot.tasks.find(task => task.id === alphaReuse.task_id)?.status === 'completed'
      && snapshot.tasks.find(task => task.id === alphaReuse.task_id)?.assignee === 'alpha')

  const held19 = secondFault.get('t19')
  const secondOwnerName = (await state()).tasks.find(task => task.id === 't19').assignee
  const secondTakeover = await call('agent_teams_reassign_task', {
    task_id: 't19', assignee: 'captain', reason: 'second injected mid-DAG hang',
  })
  await completeClaimed((await state()).tasks.find(task => task.id === 't19'), 'second-takeover')
  check('second independent takeover advances exactly one execution attempt',
    secondTakeover.attempt === held19.claim.attempt + 1)

  const secondReuse = await call('agent_teams_create_task', {
    subject: 'second-owner-reuse', assignee: secondOwnerName, dependencies: ['t19'],
  })

  const coldProbes = []
  for (const [index, assignee] of ['gamma', 'epsilon', 'zeta', 'eta'].entries()) {
    coldProbes.push(await call('agent_teams_create_task', {
      subject: `cold-restart-probe-${index + 1}`,
      assignee,
      dependencies: ['t19'],
    }))
  }

  // Hold the complete four-task stage, then discard every live member Agent
  // and plugin listener. The new runtime sees only durable team/session state.
  const heldBeforeRestart = await drain(new Set(coldProbes.map(probe => probe.task_id)), 4)
  const beforeRestart = await state()
  const openBeforeRestart = beforeRestart.tasks
    .filter(task => task.status === 'claimed' || task.status === 'in_progress')
    .map(task => ({ id: task.id, attempt: task.attempt, attemptId: task.attemptId }))
  const staleAgents = new Map()
  for (const [taskId, held] of heldBeforeRestart) staleAgents.set(taskId, held.owner)
  const previousGeneration = runtime.generation
  runtime = mountRuntime()
  await call('agent_teams_status', {})
  await settle()
  const afterRestart = await state()
  check('cold runtime restart redelivers every durable open task with a fresh attempt',
    runtime.generation === previousGeneration + 1
      && openBeforeRestart.length >= 4
      && openBeforeRestart.every(old => {
        const current = afterRestart.tasks.find(task => task.id === old.id)
        return current?.status === 'claimed'
          && current.attempt === old.attempt + 1
          && current.attemptId !== old.attemptId
      }))

  const coldStaleStorm = await Promise.allSettled(openBeforeRestart.flatMap(old => (
    Array.from({ length: 12 }, () => call('agent_teams_update_task', {
      task_id: old.id,
      status: 'completed',
      output: `late pre-restart ${old.id}`,
      attempt_id: old.attemptId,
    }, staleAgents.get(old.id)))
  )))
  check('all pre-restart attempt writes are rejected after cold recovery',
    coldStaleStorm.every(result => result.status === 'rejected'))

  await drain()
  snapshot = await state()
  check('second interrupted owner is reused after takeover',
    snapshot.tasks.find(task => task.id === secondReuse.task_id)?.status === 'completed'
      && snapshot.tasks.find(task => task.id === secondReuse.task_id)?.assignee === secondOwnerName)
  check('entire fan-out/fan-in graph reaches completion after restart',
    snapshot.tasks.length === 37 && snapshot.tasks.every(task => task.status === 'completed'))

  // Keep the scheduler out of this claim race; all seven active members then
  // hit one unassigned task through the real process-local team lock.
  const activeNames = memberNames.filter(name => name !== 'beta')
  for (const name of activeNames) {
    if (await liveMember(name) === undefined) {
      await call('agent_teams_send_message', { to: name, content: 'wake for claim-race verification' })
      await settle()
    }
    const agent = await liveMember(name)
    if (agent === undefined) throw new Error(`failed to wake ${name} for claim race`)
    agent.status = 'running'
  }
  const herdTask = await call('agent_teams_create_task', { subject: 'seven-way-claim-herd' })
  const herdAgents = await Promise.all(activeNames.map(name => liveMember(name)))
  for (const agent of herdAgents) agent.status = 'idle'
  const herd = await Promise.allSettled(herdAgents.map(agent => (
    call('agent_teams_claim_task', { task_id: herdTask.task_id }, agent)
  )))
  const herdWinners = herd.filter(result => result.status === 'fulfilled')
  check('seven-way thundering herd produces exactly one owner',
    herdWinners.length === 1 && herd.filter(result => result.status === 'rejected').length === 6)
  const herdClaim = herdWinners[0].value
  const herdWinner = await liveMember(herdClaim.assignee)
  // A successful real claim starts work immediately; model that running edge
  // before unrelated scheduler kicks can classify it as an abandoned idle claim.
  herdWinner.status = 'running'
  await call('agent_teams_update_task', {
    task_id: herdTask.task_id, status: 'in_progress', attempt_id: herdClaim.attempt_id,
  }, herdWinner)
  await call('agent_teams_update_task', {
    task_id: herdTask.task_id,
    status: 'completed',
    output: 'canonical herd result',
    attempt_id: herdClaim.attempt_id,
  }, herdWinner)

  const terminalStorm = await Promise.allSettled(Array.from({ length: 40 }, (_, index) => (
    call('agent_teams_update_task', {
      task_id: herdTask.task_id,
      status: 'completed',
      output: `conflicting terminal ${index}`,
      attempt_id: herdClaim.attempt_id,
    }, herdWinner)
  )))
  check('40 conflicting terminal writes cannot change the canonical result',
    terminalStorm.every(result => result.status === 'rejected')
      && (await state()).tasks.find(task => task.id === herdTask.task_id)?.output === 'canonical herd result')
  await idle(herdWinner)

  // One failed delivery per active recipient, mixed into a larger concurrent
  // message burst. A captain status kick must drain every fallback once.
  for (const name of activeNames) {
    const record = await memberRecord(name)
    failDeliveryCount.set(record.id, 1)
  }
  const messageBurst = await Promise.all(Array.from({ length: 42 }, (_, index) => (
    call('agent_teams_send_message', {
      to: activeNames[index % activeNames.length],
      content: `burst-${index}`,
    })
  )))
  check('message burst contains both injected fallbacks and live deliveries',
    messageBurst.some(message => message.delivered === 'mailbox')
      && messageBurst.some(message => message.delivered === 'wake'))
  for (const name of activeNames) {
    const agent = await liveMember(name)
    if (agent !== undefined) await idle(agent)
  }
  await call('agent_teams_status', {})
  await settle()
  const unreadCounts = await Promise.all(activeNames.map(name => readUnreadMailbox(stateRoot, teamId, name)))
  check('all failed message fallbacks are redelivered and acknowledged exactly once',
    unreadCounts.every(messages => messages.length === 0))

  snapshot = await state()
  const attempts = snapshot.tasks.flatMap(task => task.attemptId === undefined ? [] : [task.attemptId])
  check('final state has no duplicate current capability ids', new Set(attempts).size === attempts.length)
  check('removed beta owns no unfinished or future task',
    snapshot.members.find(member => member.name === 'beta')?.status === 'removed'
      && snapshot.tasks.every(task => task.assignee !== 'beta' || task.status === 'completed'))
  check('no task is lost, duplicated, or left nonterminal',
    snapshot.tasks.length === 38
      && new Set(snapshot.tasks.map(task => task.id)).size === 38
      && snapshot.tasks.every(task => task.status === 'completed'))

  await call('agent_teams_delete', {})
  const archived = await readArchivedTeam(stateRoot, teamId)
  check('shutdown archives all 38 completed tasks after fault recovery',
    await readTeam(stateRoot, teamId) === undefined
      && archived?.tasks.length === 38
      && archived.tasks.every(task => task.status === 'completed'))
  check('shutdown keeps all eight retired members catalog-visible for history',
    (await runtime.ctx.subagents.listChildren(runtime.captain.id))
      .filter(child => child.kind === 'child'
        && child.mode === 'continuable'
        && child.label.startsWith('agent-teams:')).length === 8)
} finally {
  await rm(workspace, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n${failures.length} stress check(s) FAILED: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nall complex stress checks passed')
