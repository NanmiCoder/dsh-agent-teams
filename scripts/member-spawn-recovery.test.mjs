import test from 'node:test'
import assert from 'node:assert/strict'
import { startMemberWithLenientFilter } from '../lib/harness-compat.js'
import { CAPTAIN_TOOL_NAMES } from '../lib/tool-names.js'

/**
 * `dsh-web-app` and the Agent Teams profile layer ship `tool-subagent` and
 * `tool-subagent-control` disabled, so `subagent` and `send_message` are absent from the
 * registry. The host applies a member's `toolFilter` through a strict `tools.restrict()`
 * that rejects an unregistered name instead of ignoring it. That rejection used to abort
 * every member start, leaving every member of every team `unspawned` with no visible reason.
 *
 * `memberToolFilter` resolves the depth entries against the host's registry view, which
 * covers the compositions that expose one. This pins the recovery path underneath it for
 * everything that resolution cannot see — no registry view, a name that is known but not
 * restrictable, a mounting difference — and it reproduces the host message shape verbatim
 * so the contract stays pinned to it:
 * `tools.restrict() names unknown global tool "x"; known global tools: …`.
 */
const hostRejection = names => new Error(
  `tools.restrict() names unknown global tool${names.length > 1 ? 's' : ''} ${names.map(name => `"${name}"`).join(', ')}; known global tools: ${CAPTAIN_TOOL_NAMES.join(', ')}`,
)

test('a member start drops the names the host rejects and succeeds', async t => {
  await t.test('the rejected names are removed and the start succeeds', async () => {
    const attempts = []
    const result = await startMemberWithLenientFilter(async filter => {
      attempts.push([...filter.deny])
      if (attempts.length === 1) throw hostRejection(['subagent', 'send_message'])
      return { childId: 'child' }
    }, { deny: [...CAPTAIN_TOOL_NAMES, 'subagent', 'send_message'] })
    assert.deepEqual(result, { childId: 'child' })
    assert.deepEqual(attempts[0], [...CAPTAIN_TOOL_NAMES, 'subagent', 'send_message'])
    assert.deepEqual(attempts[1], [...CAPTAIN_TOOL_NAMES])
  })

  await t.test('only the names the host named are dropped, not the ones it listed as known', async () => {
    const attempts = []
    await startMemberWithLenientFilter(async filter => {
      attempts.push([...filter.deny])
      if (attempts.length === 1) throw hostRejection(['subagent'])
      return 'ok'
    }, { deny: [...CAPTAIN_TOOL_NAMES, 'subagent'] })
    assert.deepEqual(attempts[1], [...CAPTAIN_TOOL_NAMES])
  })

  await t.test('each rejection removes one more name until the host accepts the filter', async () => {
    const attempts = []
    const result = await startMemberWithLenientFilter(async filter => {
      attempts.push([...filter.deny])
      if (filter.deny.includes('subagent')) throw hostRejection(['subagent'])
      if (filter.deny.includes('send_message')) throw hostRejection(['send_message'])
      return 'ok'
    }, { deny: [...CAPTAIN_TOOL_NAMES, 'subagent', 'send_message'] })
    assert.equal(result, 'ok')
    assert.equal(attempts.length, 3)
    assert.deepEqual(attempts.at(-1), [...CAPTAIN_TOOL_NAMES])
  })

  await t.test('a first attempt that already works is not retried', async () => {
    let calls = 0
    await startMemberWithLenientFilter(async () => { calls += 1; return 'ok' }, { deny: [...CAPTAIN_TOOL_NAMES] })
    assert.equal(calls, 1)
  })
})

test('a member start that failed for another reason still surfaces', async t => {
  await t.test('an unrelated start failure propagates', async () => {
    await assert.rejects(
      startMemberWithLenientFilter(async () => { throw new Error('provider "spawn" is not registered') }, { deny: [...CAPTAIN_TOOL_NAMES] }),
      /is not registered/,
    )
  })

  await t.test('a restriction error that is not an unknown-name report propagates', async () => {
    await assert.rejects(
      startMemberWithLenientFilter(async () => { throw new Error('tools.restrict() requires a scoped context') }, { deny: [...CAPTAIN_TOOL_NAMES] }),
      /requires a scoped context/,
    )
  })

  await t.test('a non-error rejection does not loop forever', async () => {
    await assert.rejects(startMemberWithLenientFilter(async () => { throw 'opaque failure' }, { deny: [...CAPTAIN_TOOL_NAMES] }))
  })

  await t.test('a rejection that names no name already in the filter does not loop forever', async () => {
    await assert.rejects(
      startMemberWithLenientFilter(async () => { throw hostRejection(['some_other_tool']) }, { deny: [...CAPTAIN_TOOL_NAMES] }),
      /unknown global tool/,
    )
  })
})
