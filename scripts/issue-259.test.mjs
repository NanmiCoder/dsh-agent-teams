// #259: deduplicate status flags while preserving first-occurrence order.
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerAgentTeamsTools } from '../lib/tools.js'

// Capture tool definitions as in capabilities.test.mjs; exercise the public output renderer.
const definitions = []
const noop = () => {}
registerAgentTeamsTools({
  on: () => noop,
  effect: setup => setup(),
  logger: { warn: noop, debug: noop },
  tools: { register: definition => definitions.push(definition) },
  agents: { get: () => undefined },
  subagents: { followup: async () => {}, registerContinuableSetup: () => noop },
}, { stateDir: '.agent-teams', memberProvider: 'spawn', memberMaxDepth: 1, maxMembers: 8, profiles: {}, toolPolicies: {} })
const status = definitions.find(definition => definition.name === 'agent_teams_status')
assert.ok(status, 'status tool must be registered')

function renderHeader(flags) {
  const blocks = status.output.render({}, {
    team_name: 'Test',
    viewer: 'captain',
    members: [],
    tasks: [],
    captain_inbox: [],
    member_inboxes: {},
    mailbox_warnings: [],
    mailbox_warning_count: 0,
    ...flags,
  })
  assert.equal(blocks[0].type, 'text')
  return blocks[0].text.split('\n')[0]
}

test('status renders exactly one deliverable flag when both state fields set it', () => {
  assert.equal(renderHeader({ deliverable: true, loop_state: 'deliverable' }), 'Team "Test" [deliverable]')
})

test('status preserves all distinct flags in their original order', () => {
  assert.equal(renderHeader({ halted: true, escalated: true, deliverable: true, loop_state: 'blocked' }),
    'Team "Test" [halted, escalated, deliverable, blocked]')
})
