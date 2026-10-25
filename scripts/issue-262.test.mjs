// #262: preserve claimed as a lifecycle fact, across snapshot and actual panel rendering.
// SSR stubs only unrelated host UI imports and CSS modules. It is not a browser/Windows test.
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { assembleTeamSnapshot } from '../lib/snapshot.js'
import { beginTaskAttempt, taskVisualState, writeTeam, readTeam } from '../lib/state.js'
import { zh, en } from '../lib/client/locales.js'

const hook = registerHooks({ resolve(specifier, context, next) {
  let source
  if (specifier.endsWith('.module.css')) source = 'export default new Proxy({}, {get: (_, key) => key})'
  if (context.parentURL?.endsWith('/client/ActivityPanel.js')) {
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') source = 'export const Modal = () => null'
    if (specifier === './AgentTeamsCard.js') source = 'export const OPEN_PANEL_EVENT = "test-open"'
    if (specifier === './StagingPlanEditor.js') source = 'export const StagingPlanEditor = () => null'
  }
  return source === undefined ? next(specifier, context) : { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
}})
const { TeamSection } = await import('../lib/client/ActivityPanel.js')
hook.deregister()
const translate = dict => (key, values = {}) => dict[key].replace(/\{(\w+)\}/g, (_, name) => String(values[name]))
const render = (team, dict = en, extra = {}) => renderToStaticMarkup(React.createElement(TeamSection, {
  team, t: translate(dict), onNavigate() {}, ...extra,
}))
const baseTask = (id, status = 'pending', dependencies = []) => ({ id, subject: `Task ${id}`, status, dependencies, createdAt: 1, updatedAt: 1 })

async function snapshot(t, liveStatus = 'running') {
  const root = await mkdtemp(join(tmpdir(), 'issue262-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const state = { id: 'test', name: 'Test', captainSessionId: 'captain', createdAt: 1, taskSeq: 3,
    members: [{ id: 'member', name: 'worker', status: 'working', joinedAt: 1 }],
    tasks: [baseTask('t1'), baseTask('t2'), baseTask('t3', 'pending', ['t1'])] }
  beginTaskAttempt(state.tasks[0], 'worker')
  await mkdir(join(root, 'test', 'inbox'), { recursive: true })
  await writeTeam(root, state)
  const ctx = { agents: { get: () => liveStatus === 'absent' ? undefined : { status: liveStatus } }, logger: { warn() {} } }
  const before = await readTeam(root, 'test')
  const projected = await assembleTeamSnapshot(ctx, root, root, before)
  assert.deepEqual(await readTeam(root, 'test'), before, 'projection must not mutate durable status/attempt')
  return { projected, root, ctx, state: before }
}

for (const status of ['running', 'idle', 'absent']) test(`claimed remains distinct with a ${status} owner`, async t => {
  const { projected } = await snapshot(t, status)
  assert.deepEqual(projected.tasks.map(task => [task.status, task.state]), [
    ['claimed', 'claimed'], ['pending', 'open'], ['pending', 'blocked'],
  ])
})

test('snapshot reaches sidebar and workspace legends, summary, DAG and assignment chips', async t => {
  const { projected } = await snapshot(t)
  for (const dict of [en, zh]) for (const workspace of [false, true]) {
    const html = render(projected, dict, { workspace })
    if (process.env.ISSUE262_CAPTURE_DIR && dict === en && workspace) await writeFile(join(process.env.ISSUE262_CAPTURE_DIR, 'panel.html'), html)
    assert.match(html, /data-task-id="t1" data-state="claimed"/)
    assert.match(html, new RegExp(`<span data-state="claimed">■ ${dict === en ? 'Claimed 1' : '已认领 1'}</span>`))
    assert.match(html, new RegExp(dict === en ? 'Claimed: t1' : '已认领：t1'))
    assert.doesNotMatch(html, new RegExp(dict === en ? 'Ready: t1' : 't1.*等待领取'))
    assert.match(html, new RegExp(`<span class="dagClaimedState">${dict['task.status.claimed']}</span>`))
    assert.match(html, /data-task-id="t2" data-state="open"/)
    assert.match(html, /data-task-id="t3" data-state="blocked"/)
    assert.match(html, /class="assignmentChip"[^>]*data-state="claimed"/)
  }
})

test('in_progress and terminal states keep their meanings', async t => {
  const { projected } = await snapshot(t)
  for (const [status, visual] of [['in_progress', 'running'], ['completed', 'completed'], ['failed', 'failed'], ['cancelled', 'cancelled']]) {
    assert.equal(taskVisualState(status, ['t3'], []), visual)
    const team = { ...projected, tasks: [{ ...projected.tasks[0], status, state: visual, dependencies: [] }] }
    const html = render(team)
    assert.match(html, new RegExp(`data-task-id="t1" data-state="${visual}"`))
    assert.match(html, new RegExp(`In progress ${status === 'in_progress' ? 1 : 0}`))
    assert.doesNotMatch(html, /Claimed 1|Claimed: t1/)
  }
})

test('discarded staged plans never claim an active task', async t => {
  const { projected } = await snapshot(t)
  const html = render({ ...projected, phase: 'staged' }, en, { historic: true })
  assert.match(html, /data-task-id="t1" data-state="cancelled"/)
  assert.doesNotMatch(html, /Claimed 1|Claimed: t1/)
})

test('claimed precedence and mixed failed work do not masquerade as blocked or settled', async t => {
  assert.equal(taskVisualState('claimed', ['waiting'], [baseTask('waiting')]), 'claimed')
  const { projected } = await snapshot(t)
  const team = { ...projected, tasks: [projected.tasks[0], { ...projected.tasks[1], status: 'failed', state: 'failed' }] }
  const html = render(team)
  assert.match(html, /Claimed: t1/)
  assert.doesNotMatch(html, /automatic loop has stopped/)
})
