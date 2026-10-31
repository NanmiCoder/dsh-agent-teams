// #330: the browser poll must not resend every team of every workspace, and an
// unchanged snapshot must cost no body. Server-side coverage for the scoped
// summary route, the conditional response and duplicate-workspace removal.
// The client half (scoped URL, 304 handling, hidden cadence) is covered in
// scripts/verify.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectActivityResponse } from '../lib/index.js'
import { assembleTeamSnapshot, collectArchivedTeamsActivity, collectTeamsActivity } from '../lib/snapshot.js'
import { archiveTeamDir, readTeam, writeTeam } from '../lib/state.js'
import { dedupeByRealPath, ifNoneMatchAccepts, jsonEtag, writeJsonWithEtag } from '../lib/web-routes.js'

const ctx = { agents: { get: () => undefined }, logger: { warn() {} } }
const taskText = 'task context '.repeat(40)
const memberText = 'member prompt '.repeat(20)

function taskOf(id, description) {
  return { id, subject: `Task ${id}`, description, status: 'pending', dependencies: [], createdAt: 1, updatedAt: 1 }
}

function teamOf(id, captainSessionId, extra = {}) {
  return {
    id,
    name: `Team ${id}`,
    captainSessionId,
    createdAt: 1,
    taskSeq: 2,
    members: [{
      id: `${id}-member`,
      name: 'worker',
      role: 'worker',
      status: 'idle',
      joinedAt: 1,
      executionPrompt: memberText,
    }],
    tasks: [taskOf('t1', taskText), taskOf('t2', taskText)],
    ...extra,
  }
}

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'issue330-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/** Persist one team; writeTeam expects the team directory to exist. */
async function writeTeamTree(root, state) {
  await mkdir(join(root, state.id, 'inbox'), { recursive: true })
  await writeTeam(root, state)
}

test('the polling projection drops editing-only text but keeps panel state', async (t) => {
  const root = await tempRoot(t)
  await writeTeamTree(root, teamOf('running', 'captain'))
  const state = await readTeam(root, 'running')
  assert.ok(state !== undefined)
  const full = await assembleTeamSnapshot(ctx, root, root, state)
  const summary = await assembleTeamSnapshot(ctx, root, root, state, { summary: true })
  assert.equal(full.tasks[0].description, taskText)
  assert.equal(full.members[0].executionPrompt, memberText)
  assert.equal(summary.tasks[0].description, undefined)
  assert.equal(summary.members[0].executionPrompt, undefined)
  // Everything the panel actually renders must survive the projection.
  assert.deepEqual(
    summary.tasks.map((task) => [task.id, task.subject, task.state, task.assignee]),
    full.tasks.map((task) => [task.id, task.subject, task.state, task.assignee]),
  )
  assert.deepEqual(
    summary.members.map((member) => [member.name, member.activity, member.progress, member.currentTask]),
    full.members.map((member) => [member.name, member.activity, member.progress, member.currentTask]),
  )
  assert.ok(JSON.stringify(full).length > JSON.stringify(summary).length)
})

test('a staged plan keeps the editing text the staging editor renders', async (t) => {
  const root = await tempRoot(t)
  await writeTeamTree(root, teamOf('staged', 'captain', { phase: 'staged' }))
  const state = await readTeam(root, 'staged')
  assert.ok(state !== undefined)
  const summary = await assembleTeamSnapshot(ctx, root, root, state, { summary: true })
  assert.equal(summary.tasks[0].description, taskText)
  assert.equal(summary.members[0].executionPrompt, memberText)
})

test('the collector keeps only the requested captain session', async (t) => {
  const root = await tempRoot(t)
  await writeTeamTree(root, teamOf('mine', 'captain-a'))
  await writeTeamTree(root, teamOf('other', 'captain-b'))
  const scoped = await collectTeamsActivity(ctx, [{ workspace: 'w', stateRoot: root }], {
    captainSessionId: 'captain-a',
    summary: true,
  })
  assert.deepEqual(scoped.map((team) => team.teamId), ['mine'])
  assert.equal(scoped[0].tasks[0].description, undefined)
  const all = await collectTeamsActivity(ctx, [{ workspace: 'w', stateRoot: root }])
  assert.deepEqual(all.map((team) => team.teamId).sort(), ['mine', 'other'])
  assert.equal(all.find((team) => team.teamId === 'other').tasks[0].description, taskText)
})

test('the archived collector applies the same scope and projection', async (t) => {
  const root = await tempRoot(t)
  await writeTeamTree(root, teamOf('archived-mine', 'captain-a'))
  await writeTeamTree(root, teamOf('archived-other', 'captain-b'))
  await archiveTeamDir(root, 'archived-mine')
  await archiveTeamDir(root, 'archived-other')
  const scoped = await collectArchivedTeamsActivity(ctx, [{ workspace: 'w', stateRoot: root }], {
    captainSessionId: 'captain-a',
    summary: true,
  })
  assert.deepEqual(scoped.map((team) => team.teamId), ['archived-mine'])
  assert.equal(scoped[0].tasks[0].description, undefined)
})

test('the state route response is scoped, summarized and deduplicated', async (t) => {
  const root = await tempRoot(t)
  // The route resolves each workspace's state directory under its own path.
  const stateRoot = join(root, '.agent-teams')
  await writeTeamTree(stateRoot, teamOf('mine', 'captain-a'))
  await writeTeamTree(stateRoot, teamOf('other', 'captain-b'))
  // Two workspace registrations for one directory must not duplicate teams.
  const registry = { list: () => [{ title: 'first', path: root }, { title: 'second', path: root }] }
  const scopedBody = await collectActivityResponse(
    ctx,
    registry,
    '.agent-teams',
    new URL('http://x/plugins/dsh-agent-teams/state?summary=1&session=captain-a'),
  )
  const scoped = JSON.parse(scopedBody)
  assert.deepEqual(scoped.teams.map((team) => team.teamId), ['mine'])
  assert.equal(scoped.teams[0].workspace, 'first')
  assert.equal(scoped.teams[0].tasks[0].description, undefined)
  const fullBody = await collectActivityResponse(
    ctx,
    registry,
    '.agent-teams',
    new URL('http://x/plugins/dsh-agent-teams/state'),
  )
  const full = JSON.parse(fullBody)
  assert.deepEqual(full.teams.map((team) => team.teamId).sort(), ['mine', 'other'])
  assert.equal(full.teams.every((team) => team.tasks[0].description === taskText), true)
  assert.ok(scopedBody.length * 2 < fullBody.length)
})

test('an unchanged JSON body answers 304 and keeps its validator', () => {
  const body = '{"teams":[]}'
  const etag = jsonEtag(body)
  assert.equal(ifNoneMatchAccepts(undefined, etag), false)
  assert.equal(ifNoneMatchAccepts('*', etag), true)
  assert.equal(ifNoneMatchAccepts(etag, etag), true)
  assert.equal(ifNoneMatchAccepts(etag.replace(/^W\//, ''), etag), true)
  assert.equal(ifNoneMatchAccepts('W/"stale"', etag), false)
  const respond = (headers) => {
    const result = { status: 0, headers: {}, body: '' }
    writeJsonWithEtag({ headers }, {
      writeHead(status, values) {
        result.status = status
        result.headers = values
      },
      end(value) {
        result.body = value ?? ''
      },
    }, body)
    return result
  }
  const first = respond({})
  assert.equal(first.status, 200)
  assert.equal(first.body, body)
  assert.equal(first.headers.etag, etag)
  const second = respond({ 'if-none-match': first.headers.etag })
  assert.equal(second.status, 304)
  assert.equal(second.body, '')
  assert.equal(second.headers.etag, etag)
})

test('duplicate workspace roots collapse to one real directory', async (t) => {
  const root = await tempRoot(t)
  const directory = join(root, 'workspace')
  await mkdir(directory, { recursive: true })
  const roots = [{ title: 'a', path: directory }, { title: 'b', path: directory }]
  assert.deepEqual(
    (await dedupeByRealPath(roots, (item) => item.path)).map((item) => item.title),
    ['a'],
  )
  // A missing directory still dedupes by its resolved path.
  const absent = join(root, 'absent')
  assert.equal((await dedupeByRealPath([{ path: absent }, { path: absent }], (item) => item.path)).length, 1)
  // A symlinked registration resolves to the directory it points at.
  const alias = join(root, 'alias')
  try {
    await symlink(directory, alias, 'dir')
  } catch {
    // Windows without the symlink privilege: the real-path cases above still apply.
    return
  }
  assert.equal((await dedupeByRealPath([{ path: directory }, { path: alias }], (item) => item.path)).length, 1)
})
