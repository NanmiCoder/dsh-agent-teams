import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { releaseMetadata } from './release-metadata.mjs'
import { policy } from './compatibility.mjs'

const fixture = (version, tag) => ({
  ...JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')),
  version, publishConfig: { tag },
})

test('stable latest requires the recommended host and bounded compatibility', () => {
  assert.deepEqual(releaseMetadata(fixture('0.1.16', 'latest')), {
    value: '0.1.16', dist_tag: 'latest', prerelease: false,
  })
  const alphaOnly = fixture('0.1.16', 'latest')
  for (const name of Object.keys(alphaOnly.devDependencies)) {
    if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) alphaOnly.devDependencies[name] = '0.1.2-alpha.2'
  }
  for (const name of Object.keys(alphaOnly.pnpm.overrides)) {
    if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) alphaOnly.pnpm.overrides[name] = '0.1.2-alpha.2'
  }
  assert.throws(() => releaseMetadata(alphaOnly), /recommended host/)
  assert.throws(() => releaseMetadata(fixture('0.1.16', 'latest'), {
    ...policy, recommendedHost: '0.1.2-alpha.2',
    supportedHosts: [{ version: '0.1.2-alpha.2', track: 'recommended' }],
  }), /Alpha\/beta/)
})

for (const suffix of ['alpha', 'beta', 'rc']) {
  test(`${suffix} candidates use next and never replace latest`, () => {
    const version = `0.1.16-${suffix}.1`
    assert.equal(releaseMetadata(fixture(version, 'next')).prerelease, true)
    for (const tag of [undefined, 'latest', suffix]) {
      assert.throws(() => releaseMetadata(fixture(version, tag)), /publishConfig.tag/)
    }
  })
}

test('reject unsupported versions and unbounded peers', () => {
  for (const version of ['0.1.16-dev.1', '0.1.16-alpha.01', '0.1.16-alpha.1\n', 'v0.1.16', '0.1']) {
    assert.throws(() => releaseMetadata(fixture(version, 'next')))
  }
  const mixed = fixture('0.1.16-rc.1', 'next')
  mixed.peerDependencies['@deepseek-ai/dsh-agent'] = '^0.1.2-alpha.2'
  assert.throws(() => releaseMetadata(mixed), /enumerate/)
})

test('checked-in candidate has consistent dependency and release metadata', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(releaseMetadata(pkg).dist_tag, pkg.publishConfig.tag)
})
