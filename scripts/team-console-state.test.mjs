import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONSOLE_ACTIVE_POLL_MS,
  CONSOLE_IDLE_POLL_MS,
  buildConsoleRows,
  createTeamConsoleState,
  startConsolePolling,
  teamRecordKey,
} from '../lib/client/team-console-state.js'

function team(workspace, teamId, overrides = {}) {
  return {
    workspace,
    teamId,
    captainSessionId: 'captain',
    name: `${workspace}/${teamId}`,
    phase: 'running',
    members: [],
    tasks: [],
    messageCount: 0,
    captainInbox: [],
    ...overrides,
  }
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
    read: key => values.get(key),
  }
}

function jsonResponse(body, tag) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...tag === undefined ? {} : { etag: tag },
    },
  })
}

function scriptedPoller(responses) {
  let tick
  const requests = []
  const published = []
  const statuses = []
  const intervals = []
  const poll = startConsolePolling({
    async fetchState(url, init) {
      requests.push({ url, tag: init.headers?.['if-none-match'] })
      const response = responses.shift()
      assert.notEqual(response, undefined, `unexpected request to ${url}`)
      return typeof response === 'function' ? response() : response
    },
    schedule(callback, intervalMs) {
      tick = callback
      intervals.push(intervalMs)
      return intervals.length
    },
    cancel() {},
    publish(update) { published.push(update) },
    onStatus(status) { statuses.push(status) },
  })
  return {
    poll,
    requests,
    published,
    statuses,
    intervals,
    async advance() {
      tick()
      await new Promise(resolve => setImmediate(resolve))
      await new Promise(resolve => setImmediate(resolve))
    },
  }
}

test('console identity includes workspace, captain session, and team id', () => {
  const left = team('workspace-a', 'same-team')
  const right = team('workspace-b', 'same-team')
  const nextGeneration = team('workspace-a', 'same-team', { captainSessionId: 'captain-2' })
  assert.notEqual(teamRecordKey(left), teamRecordKey(right))
  assert.notEqual(teamRecordKey(left), teamRecordKey(nextGeneration))
  assert.equal(buildConsoleRows([left, right], []).length, 2)
  assert.equal(buildConsoleRows([left], [{ ...left, name: 'archived duplicate' }]).length, 1)
  assert.equal(buildConsoleRows([left], [{ ...left }])[0].historic, false)
})

test('loading, ready, error, and empty states preserve the last snapshot', () => {
  const state = createTeamConsoleState({ storage: null, now: () => 42 })
  let notifications = 0
  state.subscribe(() => { notifications += 1 })
  assert.equal(state.getSnapshot().status, 'loading')
  state.begin()
  assert.equal(state.getSnapshot().status, 'loading')

  state.apply({ live: [team('A', 'one')] })
  assert.equal(state.getSnapshot().status, 'ready')
  assert.equal(state.getSnapshot().updatedAt, 42)
  assert.equal(state.getSnapshot().rows.length, 1)
  assert.deepEqual(state.getSnapshot().workspaces, ['A'])

  state.status('error')
  assert.equal(state.getSnapshot().status, 'error')
  assert.equal(state.getSnapshot().error, 'unavailable')
  assert.equal(state.getSnapshot().rows.length, 1, 'an error must not erase the last rows')

  state.status('ready')
  assert.equal(state.getSnapshot().status, 'ready')
  assert.equal(state.getSnapshot().error, null)

  state.apply({ live: [] })
  assert.equal(state.getSnapshot().status, 'ready')
  assert.equal(state.getSnapshot().rows.length, 0)
  assert.ok(notifications > 0)
})

test('workspace filter and team selection survive a reload without leaking across workspaces', () => {
  const storage = memoryStorage()
  const options = { storage, storageKey: 'console-selection', now: () => 1 }
  const first = createTeamConsoleState(options)
  const a = team('A', 'same')
  const b = team('B', 'same')
  first.apply({ live: [a, b] })
  assert.equal(first.getSnapshot().selectedKey, teamRecordKey(a))

  first.selectTeam(teamRecordKey(b))
  first.setWorkspaceFilter('B')
  assert.equal(first.getSnapshot().selectedKey, teamRecordKey(b))

  const reloaded = createTeamConsoleState(options)
  assert.equal(reloaded.getSnapshot().workspaceFilter, 'B')
  assert.equal(reloaded.getSnapshot().selectedKey, null)
  reloaded.apply({ live: [a, b] })
  assert.equal(reloaded.getSnapshot().selectedKey, teamRecordKey(b))

  reloaded.setWorkspaceFilter('A')
  assert.equal(reloaded.getSnapshot().selectedKey, teamRecordKey(a))
  assert.equal(reloaded.getSnapshot().rows.length, 2)
  reloaded.setWorkspaceFilter(null)
  assert.equal(reloaded.getSnapshot().selectedKey, teamRecordKey(b), 'the preferred team returns when its filter does')
})

test('304 responses keep the snapshot and only send tags for the displayed body', async () => {
  const live = team('A', 'live')
  const scripted = scriptedPoller([
    jsonResponse({ teams: [live] }, '"live-1"'),
    jsonResponse({ teams: [] }, '"archive-1"'),
    new Response(null, { status: 304 }),
    new Response(null, { status: 304 }),
  ])
  await scripted.poll.firstTick
  assert.equal(scripted.published.length, 2)
  assert.equal(scripted.statuses.at(-1), 'ready')
  assert.deepEqual(scripted.requests.map(request => request.url), [
    '/plugins/dsh-agent-teams/state?summary=1',
    '/plugins/dsh-agent-teams/state?archived=1',
  ])

  await scripted.advance()
  assert.equal(scripted.published.length, 2, '304 must not publish a replacement body')
  assert.equal(scripted.requests[2].tag, '"live-1"')
  assert.equal(scripted.requests[3].tag, '"archive-1"')
  assert.equal(scripted.statuses.at(-1), 'ready')
  scripted.poll.stop()
})

test('poll cadence is 1s with live teams and 5s for history or empty state', async () => {
  const live = scriptedPoller([
    jsonResponse({ teams: [team('A', 'live')] }),
    jsonResponse({ teams: [] }),
  ])
  await live.poll.firstTick
  assert.equal(live.intervals.at(-1), CONSOLE_ACTIVE_POLL_MS)
  live.poll.stop()

  const empty = scriptedPoller([
    jsonResponse({ teams: [] }),
    jsonResponse({ teams: [team('A', 'old')] }),
  ])
  await empty.poll.firstTick
  assert.equal(empty.intervals.at(-1), CONSOLE_IDLE_POLL_MS)
  empty.poll.stop()
})

test('invalid responses report an error without publishing', async () => {
  const invalid = scriptedPoller([
    jsonResponse({ invalid: true }),
    jsonResponse({ teams: [] }),
  ])
  await invalid.poll.firstTick
  assert.equal(invalid.published.length, 1, 'the valid archive response may still publish')
  assert.equal(invalid.statuses.at(-1), 'error')
  invalid.poll.stop()
})

test('stopping the console discards a late response', async () => {
  let resolveLive
  let resolveArchive
  const published = []
  const statuses = []
  const poll = startConsolePolling({
    fetchState(url) {
      return new Promise((resolve) => {
        if (url.includes('archived')) resolveArchive = resolve
        else resolveLive = resolve
      })
    },
    schedule: () => 1,
    cancel() {},
    publish(update) { published.push(update) },
    onStatus(status) { statuses.push(status) },
  })
  poll.stop()
  resolveLive(jsonResponse({ teams: [team('A', 'late')] }))
  resolveArchive(jsonResponse({ teams: [] }))
  await poll.firstTick
  assert.deepEqual(published, [])
  assert.deepEqual(statuses, [])
})
