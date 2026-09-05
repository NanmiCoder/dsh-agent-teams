import assert from 'node:assert/strict'
import test from 'node:test'
import { compareSemver, parseSemver, validateRelease } from './verify-release.mjs'

const stable = {
  version: '1.2.3',
  releaseTag: 'v1.2.3',
  releasePrerelease: false,
  npmDistTag: 'latest',
  currentLatest: '1.2.2',
}

const prerelease = {
  version: '1.2.3-rc.1',
  releaseTag: 'v1.2.3-rc.1',
  releasePrerelease: true,
  npmDistTag: 'next',
}

test('parseSemver validates prerelease identifiers and ignores build metadata', () => {
  assert.equal(parseSemver('v1.2.3'), null)
  assert.equal(parseSemver('1.2.3-rc.01'), null)
  assert.equal(parseSemver('1.2.3-rc.1+build.7')?.prerelease.join('.'), 'rc.1')
  assert.equal(parseSemver('999999999999999999999.2.3'), null)
})

test('compareSemver follows semver prerelease ordering', () => {
  assert.equal(compareSemver(parseSemver('1.0.0-rc.1'), parseSemver('1.0.0-rc.2')), -1)
  assert.equal(compareSemver(parseSemver('1.0.0-rc.2'), parseSemver('1.0.0')), -1)
  assert.equal(compareSemver(parseSemver('1.0.0'), parseSemver('1.0.0+build.1')), 0)
})

test('validateRelease accepts stable and prerelease publications', () => {
  assert.deepEqual(validateRelease(stable), {
    version: '1.2.3',
    releasePrerelease: false,
    npmDistTag: 'latest',
  })
  assert.deepEqual(validateRelease(prerelease), {
    version: '1.2.3-rc.1',
    releasePrerelease: true,
    npmDistTag: 'next',
  })
})

test('validateRelease rejects tag and prerelease mismatches', () => {
  assert.throws(() => validateRelease({ ...stable, releaseTag: 'v1.2.4' }), /release tag/)
  assert.throws(() => validateRelease({ ...stable, releasePrerelease: true }), /prerelease state/)
  assert.throws(() => validateRelease({ ...prerelease, releasePrerelease: false }), /prerelease state/)
})

test('validateRelease rejects incorrect dist-tags', () => {
  assert.throws(() => validateRelease({ ...prerelease, npmDistTag: 'latest' }), /must not publish to latest/)
  assert.throws(() => validateRelease({ ...stable, npmDistTag: 'next' }), /must publish to latest/)
})

test('validateRelease refuses stable downgrades and invalid inputs', () => {
  assert.throws(() => validateRelease({ ...stable, version: '1.2.1', releaseTag: 'v1.2.1' }), /lower than current latest/)
  assert.throws(() => validateRelease({ ...stable, currentLatest: undefined }), /currentLatest/)
  assert.throws(() => validateRelease({ ...stable, releasePrerelease: 'no' }), /true or false/)
  assert.throws(() => validateRelease({ ...stable, version: '1.2' }), /valid semver/)
})
