import assert from 'node:assert/strict'
import test from 'node:test'
import { installAgentTeamsGestureBoundary } from '../lib/command.js'

/**
 * The activation directive is injected into a live turn, so its message source becomes a
 * durable record in the Session log. A bespoke `source.kind` is outside the released format
 * vocabulary that older generations audit during migration, which made every historical
 * session containing one impossible to open after a host upgrade. The directive must
 * therefore use the plugin source shape this package already uses on its delivery paths.
 */
function injectDirective(text, profiles = {}) {
  const registrations = []
  installAgentTeamsGestureBoundary({ on: (name, handler) => registrations.push([name, handler]) }, () => profiles)
  const [registered] = registrations
  assert.equal(registered?.[0], 'agent/pre-step')
  const messages = [{
    id: 'm1', role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text }],
  }]
  return registered[1]({ messages, signal: new AbortController().signal }, async () => ({ kind: 'continue', messages }))
}

test('the injected activation directive uses the supported plugin source, never a bespoke kind', async () => {
  const decision = await injectDirective('/agent-teams implement the plan')
  assert.equal(decision.kind, 'enter')
  const injected = decision.messages.at(-1)
  assert.deepEqual(injected.source, { kind: 'plugin', plugin: 'dsh-agent-teams' })
  assert.match(injected.content[0].text, /Goal: implement the plan/u)
})

test('the unknown-profile directive uses the same supported source', async () => {
  const decision = await injectDirective('/agent-teams --profile missing do it')
  assert.equal(decision.kind, 'enter')
  const injected = decision.messages.at(-1)
  assert.deepEqual(injected.source, { kind: 'plugin', plugin: 'dsh-agent-teams' })
  assert.match(injected.content[0].text, /does not exist/u)
})

test('a turn without the AgentTeams gesture is left untouched', async () => {
  const decision = await injectDirective('an ordinary question')
  assert.equal(decision.kind, 'continue')
  assert.equal(decision.messages.length, 1)
})
