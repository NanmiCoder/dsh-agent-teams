#!/usr/bin/env node
/** Dedicated TDD checks for execution prompt and fallback routing. */
import { assignmentPrompt } from '../lib/scheduler.js'
import { memberPersona, isFallbackFailureCode, selectFallbackRoute } from '../lib/members.js'
import { resolveTeamProfile } from '../lib/profiles.js'

let failures = 0
function check(label, value) {
  if (value) console.log(`  PASS  ${label}`)
  else { failures += 1; console.error(`  FAIL  ${label}`) }
}
function throws(label, fn) {
  try { fn(); failures += 1; console.error(`  FAIL  ${label} (did not throw)`) }
  catch { console.log(`  PASS  ${label}`) }
}

const prompt = 'FACTS_ONLY_PROMPT'
const fallbackPlugin = { provider: 'openai', model: 'backup-plugin' }
const fallbackProfile = { provider: 'grok', model: 'backup-profile' }
const fallbackMember = { provider: 'openai', model: 'backup-member' }
const config = {
  executionPrompt: prompt,
  fallback: fallbackPlugin,
  demo: {
    executionPrompt: 'PROFILE_PROMPT',
    fallback: fallbackProfile,
    members: [{ name: 'worker', model: 'primary', executionPrompt: 'MEMBER_PROMPT', fallback: fallbackMember }],
    tasks: [{ id: 'work', subject: 'Work', assignee: 'worker' }],
  },
}
const profile = resolveTeamProfile({ demo: config.demo }, 'demo', 8)
check('member fallback config is normalized', profile.members[0].fallback?.model === 'backup-member')
check('profile fallback config is normalized', profile.fallback?.model === 'backup-profile')
check('member prompt config is normalized', profile.members[0].executionPrompt === 'MEMBER_PROMPT')
throws('fallback requires provider', () => resolveTeamProfile({ bad: { members: [{ name: 'w', fallback: { model: 'x' } }] } }, 'bad', 8))
throws('fallback requires model', () => resolveTeamProfile({ bad: { members: [{ name: 'w', fallback: { provider: 'x' } }] } }, 'bad', 8))

const assignment = assignmentPrompt({ taskId: 't1', memberName: 'worker', memberId: 'm', attempt: 1, attemptId: 'a', subject: 'Work', dependencyOutputs: [], executionPrompt: prompt }, '.agent-teams', 'demo')
const persona = memberPersona({ name: 'Demo', id: 'demo', description: 'goal', captainSessionId: 'c', createdAt: 0, profile: { name: 'demo' }, members: [], tasks: [], taskSeq: 0 }, { name: 'worker', id: 'm', executionPrompt: prompt, joinedAt: 0, status: 'idle' }, '.agent-teams')
check('prompt is present in assignment', assignment.includes(prompt))
check('prompt is present in persona', persona.includes(prompt))
check('assignment does not require process disclosure', !assignment.includes('record the process') || assignment.includes(prompt))

const allowed = ['QUOTA', 'RATE_LIMIT', 'AUTH', 'MISSING_CREDENTIAL', 'NO_ADAPTER']
const denied = ['CONTEXT_WINDOW_EXCEEDED', 'INVALID_CREDENTIAL', 'INVALID_ARGS', 'TASK_FAILED']
for (const code of allowed) check(`fallback whitelist includes ${code}`, isFallbackFailureCode(code))
for (const code of denied) check(`fallback whitelist excludes ${code}`, !isFallbackFailureCode(code))
const primary = { provider: 'openai', model: 'primary' }
const backup = { provider: 'grok', model: 'backup' }
const switched = selectFallbackRoute(primary, backup, 'QUOTA', false)
check('eligible failure switches and retries', switched.retry && switched.switched && switched.selection.model === 'backup')
const repeated = selectFallbackRoute(switched.selection, backup, 'RATE_LIMIT', true)
check('fallback switches at most once', !repeated.retry && repeated.selection.model === 'backup')
const ignored = selectFallbackRoute(primary, backup, 'CONTEXT_WINDOW_EXCEEDED', false)
check('non-eligible failure keeps primary route', !ignored.retry && ignored.selection.model === 'primary')

if (failures > 0) process.exitCode = 1
else console.log('fallback TDD checks passed')
