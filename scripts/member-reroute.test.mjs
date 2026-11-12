import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolveTeamProfile } from '../src/profiles.ts'
import { resolveMemberLlmSelection } from '../src/members.ts'
import { Config } from '../src/index.ts'

const tools = await readFile(new URL('../src/tools.ts', import.meta.url), 'utf8')
const members = await readFile(new URL('../src/members.ts', import.meta.url), 'utf8')
const types = await readFile(new URL('../src/types.ts', import.meta.url), 'utf8')

test('running-team route changes are limited to spawned members and route fields', () => {
  assert.match(tools, /const routeOnly = \(mutation: StagedPlanMutation\)/)
  assert.match(tools, /running team member .*has not spawned; only spawned members may be rerouted/)
  assert.match(tools, /spawned member .*supports route-only changes/)
  assert.match(tools, /requires provider, model, or reasoning_effort/)
  assert.match(tools, /member\.stopping === true \|\| fresh\.tasks\.some\(task => task\.reassigning/)
})

test('route edits merge against locked effective state and commit as a batch', () => {
  assert.match(tools, /const fresh = await requireFreshCaptainTeam\(ctx, stateRoot, teamId, captain\.id\)/)
  assert.match(tools, /const oldProvider = \(member\.activeProvider \?\? member\.provider \?\? ''\)/)
  assert.match(tools, /const oldModel = \(member\.activeModel \?\? member\.model \?\? ''\)/)
  assert.match(tools, /await writeTeam\(stateRoot, fresh\)[\s\S]{0,140}memberSelections\.updateResident/)
  assert.match(tools, /touched: \{[\s\S]*provider: operation\.provider !== undefined[\s\S]*reasoningEffort: operation\.reasoning_effort !== undefined/)
})

test('resident and cold-restored members consume the durable active route', () => {
  assert.match(members, /const provider = \(member\.activeProvider \?\? member\.provider\)/)
  assert.match(members, /member\.activeReasoningEffort\?\.trim\(\)/)
  assert.match(members, /updateResident\(memberId, selection, routeRevision\)/)
  assert.match(members, /canUpdateResident\(memberId\)/)
  assert.match(members, /nativeModel\?\.select\(nextModel\)/)
  assert.match(members, /routeRevision = nextRouteRevision[\s\S]{0,100}switched = false/)
  assert.match(types, /activeReasoningEffort\?: string/)
})

test('fallback schema and profile parser accept configured effort and reject invalid input', () => {
  assert.equal(Config({ fallback: { provider: 'backup', model: 'backup-model', reasoningEffort: 'high' } }).fallback.reasoningEffort, 'high')
  assert.throws(() => Config({ fallback: { provider: 'backup', model: 'backup-model', reasoningEffort: 7 } }), /reasoningEffort/)
  const profile = resolveTeamProfile({ demo: {
    fallback: { provider: 'backup', model: 'backup-model', reasoningEffort: 'high' },
    members: [{ name: 'worker', fallback: { provider: 'other', model: 'other-model', reasoningEffort: 'low' } }],
  } }, 'demo', 4)
  assert.deepEqual(profile.fallback, { provider: 'backup', model: 'backup-model', reasoningEffort: 'high' })
  assert.deepEqual(profile.members[0].fallback, { provider: 'other', model: 'other-model', reasoningEffort: 'low' })
  assert.throws(() => resolveTeamProfile({ bad: {
    fallback: { provider: 'backup', model: 'backup-model', reasoningEffort: '' },
    members: [{ name: 'worker' }],
  } }, 'bad', 4), /reasoningEffort must not be empty/)
  assert.throws(() => resolveTeamProfile({ bad: {
    members: [{ name: 'worker', fallback: { provider: 'backup', model: 'backup-model', reasoningEffort: 7 } }],
  } }, 'bad', 4), /reasoningEffort must be a string/)
})

test('fallback effort is validated against target and omitted fields preserve adapter defaults', async () => {
  const requests = []
  const ctx = { llm: { async resolveCallConfig(config) {
    requests.push({ ...config })
    if (config.reasoningEffort === 'unsupported') throw new Error('unsupported reasoning effort')
    return config.provider === 'backup' && config.reasoningEffort === undefined
      ? { ...config, reasoningEffort: 'adapter-default' }
      : config
  } } }
  const captain = {
    options: { provider: 'primary', model: 'primary-model' },
    session: { requestHeader: () => ({ config: { provider: 'primary', model: 'primary-model' } }) },
  }
  const selection = await resolveMemberLlmSelection(ctx, captain, {
    fallback: { provider: 'backup', model: 'backup-model', reasoningEffort: 'high' },
  })
  assert.deepEqual(requests.find(request => request.provider === 'backup'), {
    provider: 'backup', model: 'backup-model', reasoningEffort: 'high',
  })
  assert.deepEqual(selection.fallback, { provider: 'backup', model: 'backup-model', reasoningEffort: 'high' })
  await assert.rejects(resolveMemberLlmSelection(ctx, captain, {
    fallback: { provider: 'backup', model: 'backup-model', reasoningEffort: 'unsupported' },
  }), /unsupported reasoning effort/)

  const omitted = await resolveMemberLlmSelection(ctx, captain, {
    fallback: { provider: 'backup', model: 'backup-model' },
  })
  assert.deepEqual(omitted.fallback, { provider: 'backup', model: 'backup-model' })
  assert.equal(Object.hasOwn(requests.findLast(request => request.provider === 'backup'), 'reasoningEffort'), false)
})

test('fallback remains a separately persisted route and validates durable active effort', () => {
  assert.match(members, /member\.activeProvider = fallback\.provider/)
  assert.match(members, /member\.activeReasoningEffort = fallback\.reasoningEffort/)
  assert.match(members, /member\.fallbackActive = true/)
  assert.match(members, /\(member\.routeRevision \?\? 0\) !== expectedRouteRevision/)
  assert.match(members, /selectFallbackRoute\(selectionRef\.current, fallback, payload\.failure\.code, switched\)/)
  assert.match(types, /reasoningEffort\?: string/)
})
