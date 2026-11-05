// Issue #336: ordinary state polling must not hash workspace bytes on the
// host thread. These tests use the shipped JS entries and real disk state.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp, { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { readArtifactScope } from '../lib/artifacts.js'
import { collectTeamsActivity } from '../lib/snapshot.js'
import { appendMailbox, createMessage, readMailbox, readTeam, writeTeam } from '../lib/state.js'
import { canDeclareDelivery } from '../lib/quality-gates.js'
import { registerAgentTeamsTools } from '../lib/tools.js'
import { workspaceAuditor } from '../lib/workspace-audit-service.js'
import { auditTeamWorkspace } from '../lib/workspace-audit.js'

async function fixture() {
  const workspace = await mkdtemp(join(tmpdir(), 'agentteams-336-'))
  const stateRoot = join(workspace, '.agent-teams')
  const file = join(workspace, 'outputs', 'mask.bin')
  await mkdir(join(workspace, 'outputs'), { recursive: true })
  await writeFile(file, Buffer.alloc(128 * 1024, 65))
  const before = new Date(Date.now() - 10000)
  fs.utimesSync(file, before, before)
  const artifacts = readArtifactScope(workspace, ['outputs/']).artifacts
  const now = Date.now()
  const team = {
    id: 'test', name: 'test', captainSessionId: 'captain', createdAt: now, taskSeq: 2,
    members: [], tasks: [
      { id: 't1', subject: 'Generate mask', kind: 'implementation', status: 'completed', dependencies: [], createdAt: now, updatedAt: now, attempt: 1, objective: 'Generate mask', inScope: ['outputs/'], verify: ['generate mask'], acceptance: ['mask exists'], changedPaths: ['outputs/mask.bin'], acceptanceResults: [{ criterion: 'mask exists', status: 'passed' }], commandsRun: [{ command: 'generate mask', status: 'passed', exitCode: 0 }] },
      { id: 't2', subject: 'Review mask', kind: 'review', status: 'completed', dependencies: ['t1'], createdAt: now, updatedAt: now, attempt: 1, verdict: 'pass', reviewedTaskId: 't1', reviewedAttempt: 1, objective: 'Review mask', acceptance: ['no blockers'], reviewedArtifacts: artifacts, reviewedScope: ['outputs/'] },
    ],
  }
  await mkdir(join(stateRoot, team.id, 'inbox'), { recursive: true })
  await writeTeam(stateRoot, team)
  const dispose = []
  const ctx = { agents: { get() {} }, logger: { warn(message) { throw new Error(message) } }, effect(setup) { const cleanup = setup(); if (cleanup) dispose.push(cleanup); return () => {} } }
  const roots = [{ workspace: 'fixture', workspacePath: workspace, stateRoot }]
  return { workspace, stateRoot, file, team, ctx, roots, async dispose() { for (const cleanup of dispose) await cleanup(); await rm(workspace, { recursive: true, force: true }) } }
}

test('#336 state polling hashes on a worker while retaining a passing byte-bound review', async () => {
  const f = await fixture()
  const original = { openSync: fs.openSync, readSync: fs.readSync, closeSync: fs.closeSync }
  const handles = new Set()
  let hostBytesRead = 0
  fs.openSync = function(path, ...args) { const fd = original.openSync.call(this, path, ...args); if (String(path) === f.file) handles.add(fd); return fd }
  fs.readSync = function(fd, ...args) { const read = original.readSync.call(this, fd, ...args); if (handles.has(fd)) hostBytesRead += read; return read }
  fs.closeSync = function(fd) { handles.delete(fd); return original.closeSync.call(this, fd) }
  syncBuiltinESMExports()
  try {
    const [snapshot] = await collectTeamsActivity(f.ctx, f.roots)
    assert.equal(snapshot.delivery.ok, true)
    assert.equal(snapshot.deliverable, true)
    assert.equal(hostBytesRead, 0, 'state polling performed synchronous artifact reads on the host event loop')
  } finally {
    Object.assign(fs, original); syncBuiltinESMExports(); await f.dispose()
  }
})

test('status reads and acknowledges only mail belonging to the authorized participants', async () => {
  const f = await fixture()
  const makeAgent = (id, origin) => ({
    id, status: 'idle', options: { provider: 'fixture', model: 'fixture' },
    session: {
      id, header: { cwd: f.workspace, seedLength: 0, origin }, events: [], append() {},
      requestHeader() { return { config: { provider: 'fixture', model: 'fixture' } } },
    },
  })
  const captain = makeAgent(f.team.captainSessionId)
  const member = makeAgent('member-old', 'subagent')
  const replacement = makeAgent('captain-new')
  const agents = new Map([captain, member, replacement].map(agent => [agent.id, agent]))
  const tools = new Map()
  const ctx = {
    ...f.ctx,
    agents: { get: id => agents.get(id), list: () => [] },
    logger: { ...f.ctx.logger, debug() {} },
    on() { return () => {} },
    tools: { register: tool => tools.set(tool.name, tool) },
    subagents: {
      registerContinuableSetup() {}, list: () => ['spawn'],
      getProvider: () => ({ prepareContinuable() {}, capabilities: { persona: true, toolFilter: true } }),
      async listChildren() { return [] }, async listDescendants() { return [] },
      async drainContinuableChildren() {}, async followup() {}, interrupt() {},
    },
  }
  const call = (name, agent, args = {}) => tools.get(`agent_teams_${name}`).execute(args, { agent, signal: new AbortController().signal })
  const roster = id => [{ id, name: 'worker', joinedAt: f.team.createdAt, status: 'idle' }]
  const captainStarted = Promise.withResolvers(), memberStarted = Promise.withResolvers()
  const release = Promise.withResolvers(), starts = [captainStarted, memberStarted]
  let captainStatus, memberStatus
  try {
    await writeTeam(f.stateRoot, { ...f.team, members: roster(member.id) })
    const deliveredMail = (from, to, content) => ({ ...createMessage(from, to, content), deliveredAt: Date.now() })
    const captainMail = deliveredMail('worker', 'captain', 'Captain report')
    const memberMail = deliveredMail('captain', 'worker', 'Member report')
    await appendMailbox(f.stateRoot, f.team.id, 'captain', captainMail)
    await appendMailbox(f.stateRoot, f.team.id, 'worker', memberMail)
    await appendFile(join(f.stateRoot, f.team.id, 'inbox', 'worker.jsonl'), '{invalid}\n')
    registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', memberMaxDepth: 1, maxMembers: 8, profiles: {} })
    const service = workspaceAuditor(ctx)
    const audit = service.audit.bind(service)
    service.audit = async (...args) => {
      starts.shift()?.resolve()
      await release.promise
      return audit(...args)
    }

    captainStatus = call('status', captain)
    await Promise.race([captainStarted.promise, captainStatus.then(() => { throw Error('captain status did not audit') })])
    memberStatus = call('status', member)
    await Promise.race([memberStarted.promise, memberStatus.then(() => { throw Error('member status did not audit') })])
    for (const mail of [captainMail, memberMail]) {
      assert.deepEqual(await readMailbox(f.stateRoot, f.team.id, mail.to), [mail])
    }
    assert.equal((await call('delete', captain)).deleted, true)
    await call('create', replacement, { name: f.team.name, description: 'Replacement team' })
    const nextTeam = await readTeam(f.stateRoot, f.team.id)
    assert.equal(nextTeam.captainSessionId, replacement.id)
    await writeTeam(f.stateRoot, { ...nextTeam, members: roster('member-new') })
    const nextCaptain = deliveredMail('worker', 'captain', 'Replacement captain report')
    const nextMember = deliveredMail('captain', 'worker', 'Replacement member report')
    await appendMailbox(f.stateRoot, f.team.id, 'captain', nextCaptain)
    await appendMailbox(f.stateRoot, f.team.id, 'worker', nextMember)
    release.resolve()

    const [lead, worker] = await Promise.all([captainStatus, memberStatus])
    assert.deepEqual(lead.captain_inbox.map(mail => mail.content), [captainMail.content])
    assert.deepEqual(lead.member_inboxes.worker, { count: 1, latest: memberMail.content })
    assert.deepEqual(worker.captain_inbox, [])
    assert.deepEqual(worker.member_inbox.map(mail => mail.content), [memberMail.content])
    assert.deepEqual(worker.mailbox_warnings, ['worker mailbox line 2'])
    assert.equal(lead.delivery.ok, false)
    assert.equal(worker.delivery.ok, false)
    for (const mail of [nextCaptain, nextMember]) {
      assert.deepEqual(await readMailbox(f.stateRoot, f.team.id, mail.to), [mail])
    }
    for (const mail of [captainMail, memberMail]) {
      const [record] = await readMailbox(join(f.stateRoot, 'archive'), f.team.id, mail.to)
      assert.equal(record.id, mail.id)
      assert.equal(record.readAt, undefined)
    }
    const current = await call('status', replacement)
    assert.deepEqual(current.captain_inbox.map(mail => mail.content), [nextCaptain.content])
    const [read] = await readMailbox(f.stateRoot, f.team.id, 'captain')
    assert.equal(typeof read.readAt, 'number')
  } finally {
    release.resolve()
    await Promise.allSettled([captainStatus, memberStatus])
    await f.dispose()
  }
})

test('#336 path/scope overlap reads the file once within each audit, and every later audit reads again', async () => {
  const f = await fixture()
  const absolute = fs.realpathSync(f.file)
  const original = fs.openSync
  let opens = 0
  fs.openSync = function(path, ...args) { if (String(path) === absolute || String(path) === f.file) opens++; return original.call(this, path, ...args) }
  syncBuiltinESMExports()
  try {
    assert.equal(canDeclareDelivery(f.team, auditTeamWorkspace(f.workspace, f.team)).ok, true)
    assert.equal(opens, 1)
    assert.equal(canDeclareDelivery(f.team, auditTeamWorkspace(f.workspace, f.team)).ok, true)
    assert.equal(opens, 2, 'completed digests must not be reused by later audits')
  } finally { fs.openSync = original; syncBuiltinESMExports(); await f.dispose() }
})

test('#336 the next poll detects same-size rewrites with a restored mtime and no team.json edit', async () => {
  const f = await fixture()
  try {
    assert.equal((await collectTeamsActivity(f.ctx, f.roots))[0].delivery.ok, true)
    const before = fs.statSync(f.file)
    const teamBytes = fs.readFileSync(join(f.stateRoot, f.team.id, 'team.json'))
    await writeFile(f.file, Buffer.alloc(before.size, 66))
    fs.utimesSync(f.file, before.atime, before.mtime)
    assert.equal(fs.statSync(f.file).mtimeMs, before.mtimeMs)
    assert.deepEqual(fs.readFileSync(join(f.stateRoot, f.team.id, 'team.json')), teamBytes)
    const [snapshot] = await collectTeamsActivity(f.ctx, f.roots)
    assert.equal(snapshot.delivery.ok, false)
    assert.equal(snapshot.deliverable, false)
    assert.match(snapshot.tasks.find(t => t.id === 't2').verdictStale, /changed/)
  } finally { await f.dispose() }
})

test('#336 a poll after an artifact edit cannot join a result awaiting team revalidation', { timeout: 5000 }, async () => {
  const f = await fixture()
  const stateFile = join(f.stateRoot, f.team.id, 'team.json')
  const originalRead = fsp.readFile
  const revalidating = Promise.withResolvers()
  const resumeRevalidation = Promise.withResolvers()
  const submittedSecond = Promise.withResolvers()
  let reads = 0
  let submissions = 0
  const service = workspaceAuditor(f.ctx)
  const audit = service.audit.bind(service)
  service.audit = (...args) => {
    const result = audit(...args)
    if (++submissions === 2) submittedSecond.resolve()
    return result
  }
  fsp.readFile = async function(path, ...args) {
    if (path === stateFile && ++reads === 2) {
      revalidating.resolve()
      await resumeRevalidation.promise
    }
    return originalRead.call(this, path, ...args)
  }
  syncBuiltinESMExports()
  try {
    const first = collectTeamsActivity(f.ctx, f.roots, 'captain', true)
    await revalidating.promise
    await writeFile(f.file, Buffer.alloc(128 * 1024, 66))
    const second = collectTeamsActivity(f.ctx, f.roots, 'captain', true)
    await submittedSecond.promise
    resumeRevalidation.resolve()
    const [[before], [after]] = await Promise.all([first, second])
    assert.equal(before.delivery.ok, true)
    assert.equal(after.delivery.ok, false)
    assert.equal(after.deliverable, false)
    assert.match(after.tasks.find(task => task.id === 't2').verdictStale, /changed/)
  } finally {
    resumeRevalidation.resolve()
    fsp.readFile = originalRead
    syncBuiltinESMExports()
    await f.dispose()
  }
})

test('#336 a mutation between read chunks yields incomplete evidence, not a mixed digest', async () => {
  const f = await fixture()
  const original = { openSync: fs.openSync, readSync: fs.readSync, closeSync: fs.closeSync }
  const absolute = fs.realpathSync(f.file)
  const handles = new Set()
  let changed = false
  fs.openSync = function(path, ...args) { const fd = original.openSync.call(this, path, ...args); if (String(path) === absolute || String(path) === f.file) handles.add(fd); return fd }
  fs.readSync = function(fd, ...args) {
    const read = original.readSync.call(this, fd, ...args)
    if (!changed && read > 0 && handles.has(fd)) { changed = true; fs.writeFileSync(f.file, Buffer.alloc(128 * 1024, 66)) }
    return read
  }
  fs.closeSync = function(fd) { handles.delete(fd); return original.closeSync.call(this, fd) }
  syncBuiltinESMExports()
  try {
    const audit = auditTeamWorkspace(f.workspace, f.team)
    assert(changed)
    assert.equal(audit.artifacts[0].unreadable, true)
    assert.equal(audit.artifacts[0].sha256, undefined)
    assert.equal(canDeclareDelivery(f.team, audit).ok, false)
    assert(audit.gaps.length > 0)
  } finally { Object.assign(fs, original); syncBuiltinESMExports(); await f.dispose() }
})

for (const [name, directory, audited] of [
  ['late.bin', false, true],
  ['new-results', true, true],
  ['node_modules', true, false],
  ['.env', false, false],
]) {
  test(`#336 scope membership uses audit exclusions when ${name} appears`, async () => {
    const f = await fixture()
    const outputs = join(f.workspace, 'outputs')
    const original = fs.readdirSync
    let changed = false
    fs.readdirSync = function(path, ...args) {
      const entries = original.call(this, path, ...args)
      if (!changed && path === outputs) {
        changed = true
        const added = join(outputs, name)
        if (directory) fs.mkdirSync(added)
        else fs.writeFileSync(added, 'new file')
      }
      return entries
    }
    syncBuiltinESMExports()
    try {
      const audit = auditTeamWorkspace(f.workspace, f.team)
      assert(changed)
      assert.equal(audit.gaps?.some(gap => gap.reason.includes('directory membership')) ?? false, audited)
      assert.equal(canDeclareDelivery(f.team, audit).ok, !audited)
    } finally { fs.readdirSync = original; syncBuiltinESMExports(); await f.dispose() }
  })
}

async function waitForFile(path) {
  const deadline = Date.now() + 5000
  while (!fs.existsSync(path)) { assert(Date.now() < deadline, 'worker did not reach the controlled boundary'); await delay(2) }
}

function controlledWorker(f, mode = 'barrier') {
  const url = new URL('./fixtures/issue-336-audit-worker.mjs', import.meta.url)
  const started = join(f.workspace, 'worker-started.jsonl')
  const release = join(f.workspace, 'worker-release')
  url.searchParams.set('mode', mode); url.searchParams.set('started', started); url.searchParams.set('release', release)
  // Worker file entries are converted to paths (dropping query parameters).
  // A module bootstrap preserves the controlled fixture's actual module URL.
  return { url: new URL('data:text/javascript,' + encodeURIComponent(`import ${JSON.stringify(url.href)}`)), started, release }
}

test('#336 identical queued audits share a fresh read after a dispatched job', async () => {
  const f = await fixture()
  const { WorkspaceAuditService } = await import('../lib/workspace-audit-service.js')
  const control = controlledWorker(f)
  const service = new WorkspaceAuditService({ workerUrl: control.url })
  try {
    const first = service.audit(f.workspace, f.team, f.stateRoot)
    await waitForFile(control.started)
    await writeFile(f.file, Buffer.alloc(128 * 1024, 66))
    const queued = service.audit(f.workspace, f.team, f.stateRoot)
    const joined = service.audit(f.workspace, f.team, f.stateRoot)
    assert.notEqual(queued, first)
    assert.equal(joined, queued)
    await writeFile(control.release, '')
    assert.equal(canDeclareDelivery(f.team, await first).ok, true)
    assert.equal(canDeclareDelivery(f.team, await queued).ok, false)
    assert.equal(fs.readFileSync(control.started, 'utf8').trim().split('\n').length, 2)
  } finally { await service.dispose(); await f.dispose() }
})

test('#336 a passing result for an older team revision is rejected after asynchronous hashing', async () => {
  const f = await fixture()
  const { WorkspaceAuditService } = await import('../lib/workspace-audit-service.js')
  const control = controlledWorker(f)
  const service = new WorkspaceAuditService({ workerUrl: control.url })
  try {
    const pending = service.audit(f.workspace, f.team, f.stateRoot)
    await waitForFile(control.started)
    await writeTeam(f.stateRoot, { ...f.team, description: 'new team revision' })
    await writeFile(control.release, '')
    const audit = await pending
    assert.equal(canDeclareDelivery(f.team, audit).ok, false)
    assert(audit.gaps.some(gap => gap.reason.includes('team state changed')))
  } finally { await service.dispose(); await f.dispose() }
})

test('#336 queue capacity and disposal explicitly block delivery instead of returning partial passes', async () => {
  const f = await fixture()
  const { WorkspaceAuditService } = await import('../lib/workspace-audit-service.js')
  const service = new WorkspaceAuditService({ workerUrl: controlledWorker(f).url, maxPending: 1 })
  try {
    const active = service.audit(f.workspace, f.team, f.stateRoot)
    const second = service.audit(f.workspace, f.team, f.stateRoot)
    assert.notEqual(second, active)
    const overflow = await second
    assert.equal(canDeclareDelivery(f.team, overflow).ok, false)
    assert(overflow.gaps.some(gap => gap.reason.includes('queue is full')))
    await service.dispose()
    assert.equal(canDeclareDelivery(f.team, await active).ok, false)
    assert.equal(canDeclareDelivery(f.team, await service.audit(f.workspace, f.team, f.stateRoot)).ok, false)
  } finally { await service.dispose(); await f.dispose() }
})

for (const change of ['archive', 'corrupt']) test(`#336 ${change} of the team record while hashing rejects the older passing result`, async () => {
  const f = await fixture()
  const { WorkspaceAuditService } = await import('../lib/workspace-audit-service.js')
  const control = controlledWorker(f)
  const service = new WorkspaceAuditService({ workerUrl: control.url })
  try {
    const pending = service.audit(f.workspace, f.team, f.stateRoot)
    await waitForFile(control.started)
    const path = join(f.stateRoot, f.team.id, 'team.json')
    if (change === 'archive') fs.renameSync(path, path + '.archived')
    else fs.writeFileSync(path, '{invalid json')
    await writeFile(control.release, '')
    const audit = await pending
    assert.equal(canDeclareDelivery(f.team, audit).ok, false)
    assert(audit.gaps.some(gap => gap.pattern === '(team revision)'))
  } finally { await service.dispose(); await f.dispose() }
})

for (const mode of ['crash', 'exit', 'invalid', 'hang']) test(`#336 worker ${mode} cannot become a passing audit`, async () => {
  const f = await fixture()
  const { WorkspaceAuditService } = await import('../lib/workspace-audit-service.js')
  const service = new WorkspaceAuditService({ workerUrl: controlledWorker(f, mode).url, timeoutMs: mode === 'hang' ? 500 : 5000 })
  try {
    const audit = await service.audit(f.workspace, f.team, f.stateRoot)
    assert.equal(canDeclareDelivery(f.team, audit).ok, false)
    assert(audit.gaps.length > 0)
    assert.match(audit.gaps[0].reason, { crash: /controlled worker crash/, exit: /exited \(1\)/, invalid: /incomplete evidence/, hang: /timed out/ }[mode])
  } finally { await service.dispose(); await f.dispose() }
})

test('#336 Cordis unload cancels its owned worker and reload gets a fresh audit service', async () => {
  const f = await fixture()
  const { workspaceAuditor } = await import('../lib/workspace-audit-service.js')
  const host = new Context()
  let service
  const plugin = { apply(ctx) { service = workspaceAuditor(ctx) } }
  try {
    const fiber = host.plugin(plugin); await fiber.inertia
    const old = service
    const pending = old.audit(f.workspace, f.team, f.stateRoot)
    await fiber.dispose()
    assert.equal(canDeclareDelivery(f.team, await pending).ok, false)
    const reloaded = host.plugin(plugin); await reloaded.inertia
    assert.notEqual(service, old)
    assert.equal(canDeclareDelivery(f.team, await service.audit(f.workspace, f.team, f.stateRoot)).ok, true)
    await reloaded.dispose()
  } finally { await host.fiber.dispose(); await f.dispose() }
})
