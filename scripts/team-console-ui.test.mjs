import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { en } from '../lib/client/locales.js'

const hook = registerHooks({
  resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('.module.css')) source = 'export default new Proxy({}, { get: (_, key) => key })'
    if (context.parentURL?.endsWith('/client/ActivityPanel.js')) {
      if (specifier === '@deepseek-ai/dsh-client-ui-primitives') source = 'export const Modal = () => null'
      if (specifier === './AgentTeamsCard.js') source = 'export const OPEN_PANEL_EVENT = "test-open"'
      if (specifier === './StagingPlanEditor.js') source = 'export const StagingPlanEditor = () => null'
    }
    return source === undefined
      ? next(specifier, context)
      : { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
  },
})
const { TeamSection } = await import('../lib/client/ActivityPanel.js')
const { TeamList, WorkspaceFilter } = await import('../lib/client/TeamList.js')
hook.deregister()

const t = (key, values = {}) => en[key].replace(/\{(\w+)\}/g, (_, name) => String(values[name]))

function team(workspace, teamId, overrides = {}) {
  return {
    workspace,
    teamId,
    captainSessionId: 'captain',
    name: `${workspace} crew`,
    phase: 'running',
    members: [{
      id: 'member-1', name: 'Developer', role: 'engineer', activity: 'working',
      progress: 0, done: 0, total: 1, currentTask: 't1', unread: 0, status: 'working',
    }],
    tasks: [{ id: 't1', subject: 'Implement', status: 'in_progress', state: 'running', assignee: 'Developer', dependencies: [], depth: 0 }],
    messageCount: 0,
    captainInbox: [],
    ...overrides,
  }
}

test('team list groups by workspace and marks archive rows as history', () => {
  const live = team('A', 'same')
  const archived = team('B', 'same', { name: 'B crew' })
  const rows = [
    { key: JSON.stringify(['A', 'captain', 'same']), team: live, historic: false },
    { key: JSON.stringify(['B', 'captain', 'same']), team: archived, historic: true },
  ]
  const html = renderToStaticMarkup(React.createElement(TeamList, {
    rows, selectedKey: rows[0].key, onSelect() {}, t,
  }))
  assert.match(html, /data-workspace="A"/)
  assert.match(html, /data-workspace="B"/)
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /data-console-team-state="history"/)
  assert.ok(html.includes(en['console.history']))
  assert.ok(html.includes(en['console.progress'].replace('{completed}', '0').replace('{total}', '1')))
})

test('workspace filter is hidden for one workspace and exposes counts otherwise', () => {
  const single = renderToStaticMarkup(React.createElement(WorkspaceFilter, {
    workspaces: ['A'], counts: new Map([['A', 1]]), total: 1, value: null, onChange() {}, t,
  }))
  assert.equal(single, '')

  const multi = renderToStaticMarkup(React.createElement(WorkspaceFilter, {
    workspaces: ['A', 'B'],
    counts: new Map([['A', 2], ['B', 1]]),
    total: 3,
    value: 'B',
    onChange() {},
    t,
  }))
  assert.match(multi, /data-console-workspace-filter/)
  assert.ok(multi.includes(en['console.allWorkspaces']))
  assert.match(multi, /aria-pressed="true"[^>]*data-workspace="B"|data-workspace="B"[^>]*aria-pressed="true"/)
})

test('read-only console details keep member navigation but hide stop and staging controls', () => {
  const html = renderToStaticMarkup(React.createElement(TeamSection, {
    team: team('A', 'live'),
    workspace: true,
    readOnly: true,
    onNavigate() {},
    t,
  }))
  assert.match(html, /data-workspace-team="true"/)
  assert.doesNotMatch(html, /teamStopButton/)
  assert.doesNotMatch(html, /data-plan-approve|data-plan-continue|data-plan-discard/)
  assert.ok(html.includes('Developer'))

  const historic = renderToStaticMarkup(React.createElement(TeamSection, {
    team: team('A', 'old'),
    workspace: true,
    historic: true,
    readOnly: true,
    onNavigate() {},
    t,
  }))
  assert.ok(historic.includes(en['team.ended']))
})
