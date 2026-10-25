// Issue #236 regression: the stored session format must be observed on the
// running host, not read back from a nested `@deepseek-ai/dsh-session` copy.
//
// A profile can resolve the plugin's own DSH package line while the process
// loading it runs another generation (pinned lockfile, Desktop shell with an
// embedded core, duplicated store). That copy reported SESSION_FORMAT_VERSION 0
// on a v4 host, so `agentTeamsSource()` selected the retired `plugin` wrapper
// and the host's writer rejected every durable AgentTeams message:
//
//     format v4 message requires a producer-owned source kind
//
// These cases pin the contract in both directions: a live v4 header outranks
// the resolved module, a pre-v3 header still gets the released wrapper, and a
// host that exposes no header version keeps the old fallback.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentTeamsSource, hostSessionFormatVersion, observedSessionFormatVersion } from '../lib/harness-compat.js'
import { steerCaptainReport } from '../lib/members.js'

const releasedWrapper = { kind: 'plugin', plugin: '@nanmicoder/dsh-agent-teams' }
const modern = { kind: 'agent-teams' }
const command = { kind: 'agent-teams-command', goal: 'report on the plugin' }
const captain = version => ({ session: { header: { version } }, steer() {} })

await test('a live v4 session outranks a stale resolved module constant', () => {
  const agent = captain(4)
  assert.equal(observedSessionFormatVersion(agent), 4)
  assert.equal(hostSessionFormatVersion(observedSessionFormatVersion(agent)), 4)
  assert.deepEqual(agentTeamsSource(modern, observedSessionFormatVersion(agent)), modern)
  assert.deepEqual(agentTeamsSource(command, observedSessionFormatVersion(agent)), command)
})

await test('a pre-v3 session keeps the released plugin wrapper', () => {
  assert.deepEqual(agentTeamsSource(modern, observedSessionFormatVersion(captain(2))), releasedWrapper)
})

await test('an absent observation falls back to the resolved module, unchanged', () => {
  assert.equal(observedSessionFormatVersion(undefined), undefined)
  assert.equal(observedSessionFormatVersion({}), undefined)
  assert.equal(observedSessionFormatVersion({ session: {} }), undefined)
  assert.equal(observedSessionFormatVersion({ session: { header: {} } }), undefined)
  assert.equal(observedSessionFormatVersion({ session: { header: { version: 'v4' } } }), undefined)
  const fallback = hostSessionFormatVersion()
  assert.deepEqual(
    agentTeamsSource(modern, undefined),
    fallback >= 3 ? modern : releasedWrapper,
  )
})

await test('a captain report through a real call site uses the live header', () => {
  const steered = []
  const live = {
    session: { header: { version: 4 } },
    steer(message) { steered.push(message) },
  }
  assert.equal(steerCaptainReport(live, 'member-1', 'done'), true)
  assert.equal(steered.length, 1)
  assert.deepEqual(steered[0].source, modern)
})
