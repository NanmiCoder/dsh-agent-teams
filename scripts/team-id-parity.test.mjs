import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeKey } from '../lib/state.js'
import { parseAgentTeamsCreateArgs } from '../lib/client/agent-teams-card-definition.js'

// The conversation card recomputes the team id from the create-call `name`
// because the fold only owns the request arguments. That recompute must stay
// character-for-character compatible with the server's sanitizeKey on the
// reproducible domain, or the card can never match its live team (#203:
// `数据团队` degraded to `team` and every lookup missed).

const names = [
  '数据团队',
  'チーム1',
  'Équipe A',
  'Ops -- core',
  'research',
]

for (const name of names) {
  test(`card team id matches the server id for ${JSON.stringify(name)}`, () => {
    const parsed = parseAgentTeamsCreateArgs(JSON.stringify({ name }))
    assert.notEqual(parsed, undefined)
    assert.equal(parsed.teamId, sanitizeKey(name))
  })
}

test('the card still parses create args without an id-able name (fallback id)', () => {
  const parsed = parseAgentTeamsCreateArgs(JSON.stringify({ name: '!!!' }))
  assert.notEqual(parsed, undefined)
  assert.equal(parsed.name, '!!!')
  // Server resolves this domain to `k-<digest>`; the card keeps its legacy
  // `team` placeholder there (documented residual divergence, #203).
  assert.equal(parsed.teamId, 'team')
})
