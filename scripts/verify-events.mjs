#!/usr/bin/env node
/**
 * Offline regression coverage for the session event write-guard (issue #8).
 *
 * Background: the plugin used to write `agent-teams/*` events into the
 * captain's Session unconditionally. The harness session reader refuses any
 * log containing an event type outside its hard-coded
 * `KNOWN_SESSION_EVENT_TYPES` unless the event is marked ignorable
 * (`SessionFormatUnsupportedError`), which made every session that used
 * AgentTeams unreadable. The upstream fix (aace29c, `lib/events.js`) guards
 * the write side: events are only appended when the running harness already
 * recognizes their type, and session write failures are contained.
 *
 * This script pins that guard so it cannot regress. It stubs
 * `@deepseek-ai/dsh-session` with a loader hook (the repo intentionally does
 * not install `@deepseek-ai/*` packages — see .npmrc), so it runs in a clean
 * checkout with zero dependencies:
 *
 *   node scripts/verify-events.mjs
 */

import { register } from 'node:module';

// Must run before the first import of lib/events.js (it imports
// '@deepseek-ai/dsh-session' at module top level).
register('./mock-dsh-session-loader.mjs', import.meta.url);

// lib/ is generated — see scripts/verify.mjs: "Requires a prior pnpm build".
let events;
try {
  events = await import('../lib/events.js');
} catch (error) {
  console.error(`lib/ is missing or not built — run \`pnpm build\` first (${String(error).split('\n')[0]})`);
  process.exit(1);
}

const { appendTeamEvent, captainSessionOf } = events;

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** The full agent-teams event vocabulary written by this plugin. */
const AGENT_TEAMS_EVENT_TYPES = [
  'agent-teams/team-created',
  'agent-teams/member-added',
  'agent-teams/member-removed',
  'agent-teams/task-created',
  'agent-teams/task-updated',
  'agent-teams/message-sent',
  'agent-teams/team-deleted',
];

const calls = [];
const session = { append: (type, data) => calls.push([type, data]) };
const ctx = { logger: { debug: () => {}, warn: () => {} } };

console.log('dsh-agent-teams session event write-guard regression (#8)')

console.log('1/4 out-of-repo event types are never written')
for (const type of AGENT_TEAMS_EVENT_TYPES) {
  appendTeamEvent(ctx, session, type, {});
}
check(
  'all 7 agent-teams/* types are omitted from the session log',
  calls.length === 0,
  `expected no appends, got ${calls.length}`,
)

console.log('2/4 harness-recognized types are still written')
appendTeamEvent(ctx, session, 'tool-workflow/run-started', { seq: 1 })
check(
  'known first-party type is written',
  calls.length === 1 && calls[0][0] === 'tool-workflow/run-started',
  `expected one append of the known type, got ${JSON.stringify(calls)}`,
)
appendTeamEvent(ctx, session, 'some-other/custom-type', {})
check('unknown custom type is omitted too', calls.length === 1)

console.log('3/4 session write failures are contained')
let threw = false
const throwingSession = {
  append: () => {
    throw new Error('durable record failed')
  },
}
try {
  appendTeamEvent(ctx, throwingSession, 'tool-workflow/run-started', {})
} catch {
  threw = true
}
check('append failure does not escape appendTeamEvent', !threw)

console.log('4/4 captain session resolution')
const fallback = { id: 'fallback' }
const liveSession = { id: 'live' }
check(
  'offline captain falls back to the caller session',
  captainSessionOf({ agents: { get: () => undefined } }, 'sess-captain', fallback) === fallback,
)
check(
  'live captain session wins over the fallback',
  captainSessionOf({ agents: { get: () => ({ session: liveSession }) } }, 'sess-captain', fallback) === liveSession,
)

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall checks passed')
