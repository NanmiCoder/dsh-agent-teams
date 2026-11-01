// #333: ending a team must be able to archive the member subagent sessions it
// leaves behind in the host's session store, and must never turn a host that
// cannot archive (headless profile, missing session) into a failed delete.
import test from 'node:test'
import assert from 'node:assert/strict'
import { archiveMemberSessions } from '../lib/member-sessions.js'

function fakeContext(registry) {
  const warnings = []
  return {
    ctx: {
      get: (key) => (key === 'workspaceRegistry' ? registry : undefined),
      logger: { warn: (message) => warnings.push(message) },
    },
    warnings,
  }
}

test('every distinct member session is archived once, with activity stopped', async () => {
  const calls = []
  const { ctx } = fakeContext({
    archiveSession: async (sessionId, options) => { calls.push([sessionId, options]) },
  })
  const archived = await archiveMemberSessions(ctx, ['s1', 's2', 's1', '  ', ''])
  assert.equal(archived, 2)
  assert.deepEqual(calls.map(([sessionId]) => sessionId), ['s1', 's2'])
  assert.deepEqual(calls[0][1], { stopActivity: true })
})

test('a host without an archive surface keeps deletion working', async () => {
  const { ctx } = fakeContext(undefined)
  assert.equal(await archiveMemberSessions(ctx, ['s1']), 0)
})

test('a workspace registry without archiveSession is treated as unavailable', async () => {
  const { ctx } = fakeContext({ list: () => [] })
  assert.equal(await archiveMemberSessions(ctx, ['s1']), 0)
})

test('a rejected session is logged and does not stop the rest', async () => {
  const archivedIds = []
  const { ctx, warnings } = fakeContext({
    archiveSession: async (sessionId) => {
      if (sessionId === 'running') throw new Error('session is active')
      archivedIds.push(sessionId)
    },
  })
  const archived = await archiveMemberSessions(ctx, ['running', 'idle'])
  assert.equal(archived, 1)
  assert.deepEqual(archivedIds, ['idle'])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /running/)
})

test('a roster with no spawned members archives nothing', async () => {
  const calls = []
  const { ctx } = fakeContext({ archiveSession: async (sessionId) => { calls.push(sessionId) } })
  assert.equal(await archiveMemberSessions(ctx, ['', '']), 0)
  assert.deepEqual(calls, [])
})
