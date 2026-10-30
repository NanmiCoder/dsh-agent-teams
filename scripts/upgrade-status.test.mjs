import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { inspectUpgradeStatus, fetchUpgradeStatus } from './upgrade-status.mjs'
import { policy } from './compatibility.mjs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const fixture = () => ({ hostTags: { latest: policy.recommendedHost, next: '0.2.1-rc.3' }, pluginManifest: structuredClone(pkg) })

test('a known supported and published combination has no declaration gap', () => {
  const result = inspectUpgradeStatus(fixture())
  assert.equal(result.needsAttention, false)
  assert.deepEqual(result.unpublishedSupport, [])
})

test('a published exact allowlist that rejects the host channels is reported as blocking users', () => {
  // The 0.1.27 shape: npm latest moved to 0.2.1-rc.5 and the plugin could not be installed.
  const input = fixture()
  input.hostTags = { latest: '0.2.1-rc.5', next: '0.2.1-rc.5' }
  delete input.pluginManifest.engines.dsh
  for (const name of Object.keys(input.pluginManifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) input.pluginManifest.peerDependencies[name] = policy.supportedHosts.map(host => host.version).join(' || ')
  }
  const result = inspectUpgradeStatus(input)
  assert.equal(result.needsAttention, true)
  assert.deepEqual(result.blockedChannels, [{ channel: 'latest', version: '0.2.1-rc.5' }, { channel: 'next', version: '0.2.1-rc.5' }])
  assert.deepEqual(result.unpublishedSupport, [])
  assert.deepEqual(result.unrecognizedDeclarations, [])
})

test('same plugin version does not hide support merged into source but absent on npm', () => {
  const input = fixture()
  input.pluginManifest.engines.dsh = '>=0.2.1-rc.1'
  const result = inspectUpgradeStatus(input)
  assert.equal(result.pluginVersion, pkg.version)
  assert.equal(result.needsAttention, true)
  assert.deepEqual(result.blockedChannels, [])
  assert.ok(result.unpublishedSupport.includes('0.2.0-rc.2'))
  assert.ok(!result.unpublishedSupport.includes('0.2.1-rc.3'))
})

test('a new upstream host is installable but still asks maintainers to run the matrix', () => {
  const input = fixture(), before = structuredClone(policy)
  input.hostTags.next = '0.2.1-rc.999'
  const result = inspectUpgradeStatus(input)
  assert.equal(result.needsAttention, true)
  assert.deepEqual(result.blockedChannels, [])
  assert.deepEqual(result.unverifiedChannels, [{ channel: 'next', version: '0.2.1-rc.999' }])
  assert.deepEqual(policy, before)
})

test('engines precedence, missing declarations and unfamiliar ranges cannot report a false all-clear', () => {
  for (const dsh of [null, '^0.2.1-rc.2', '>=0.2.1-rc.2 <0.3.0', '0.2.1-rc.2']) {
    const input = fixture()
    input.pluginManifest.engines.dsh = dsh
    const result = inspectUpgradeStatus(input)
    assert.equal(result.needsAttention, true)
    if (dsh !== '0.2.1-rc.2') assert.deepEqual(result.unrecognizedDeclarations, ['engines.dsh'])
    else assert.ok(result.unpublishedSupport.includes('0.2.1-rc.3'))
  }
  // Without engines.dsh (hosts before 0.2.1-alpha.4 and older manifests) every DSH peer must be readable.
  const input = fixture()
  delete input.pluginManifest.engines.dsh
  assert.equal(inspectUpgradeStatus(input).needsAttention, false, '* peers accept every host')
  delete input.pluginManifest.peerDependencies['@deepseek-ai/dsh-agent']
  assert.deepEqual(inspectUpgradeStatus(input).unrecognizedDeclarations, ['@deepseek-ai/dsh-agent'])
})

test('registry errors, invalid JSON and wrong identities fail instead of becoming a green empty status', async () => {
  for (const input of [ { ...fixture(), hostTags: {} }, { ...fixture(), hostTags: { latest: policy.recommendedHost } }, { ...fixture(), hostTags: { next: '0.2.1-rc.3' } }, { ...fixture(), pluginManifest: { name: 'other', version: pkg.version } } ]) {
    assert.throws(() => inspectUpgradeStatus(input))
  }
  await assert.rejects(fetchUpgradeStatus(async () => ({ ok: false, status: 503 })), /HTTP 503/)
  await assert.rejects(fetchUpgradeStatus(async () => ({ ok: true, json: async () => { throw new Error('Invalid JSON') } })), /Invalid JSON/)
  const requests = []
  const result = await fetchUpgradeStatus(async url => {
    requests.push(url)
    return { ok: true, json: async () => url.endsWith('dist-tags') ? fixture().hostTags : fixture().pluginManifest }
  })
  assert.equal(result.needsAttention, false)
  assert.equal(requests.length, 2)
  assert.ok(requests.every(url => url.startsWith('https://registry.npmjs.org/')))
})
