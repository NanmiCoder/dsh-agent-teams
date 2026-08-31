import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { releaseMetadata } from './release-metadata.mjs'

test('stable releases use latest and are not GitHub prereleases', () => {
  assert.deepEqual(releaseMetadata({ version: '0.1.15', publishConfig: { tag: 'latest' } }), {
    value: '0.1.15', dist_tag: 'latest', prerelease: false,
  })
})

for (const channel of ['alpha', 'beta', 'rc']) {
  test(`${channel} releases cannot replace latest`, () => {
    const version = `0.1.15-${channel}.1`
    const result = releaseMetadata({ version, publishConfig: { tag: channel } })
    assert.equal(result.dist_tag, channel)
    assert.equal(result.prerelease, true)
    for (const tag of [undefined, 'latest', 'wrong-channel']) {
      assert.throws(() => releaseMetadata({ version, publishConfig: { tag } }), /publishConfig.tag/)
    }
  })
}

test('reject inconsistent stable channels and unsupported version formats', () => {
  assert.throws(() => releaseMetadata({ version: '0.1.15', publishConfig: { tag: 'alpha' } }))
  for (const version of ['0.1.15-dev.1', '0.1.15-alpha.01', '0.1.15-alpha.1\n', 'v0.1.15', '0.1']) {
    assert.throws(() => releaseMetadata({ version, publishConfig: { tag: 'alpha' } }))
  }
})

test('checked-in manifest has an explicit, matching publish channel', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(releaseMetadata(pkg).dist_tag, pkg.publishConfig.tag)
})
