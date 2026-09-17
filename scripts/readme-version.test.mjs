import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  checkReadmeVersions,
  findPinnedInstallVersions,
  findStaleVersionReferences,
  publishedVersions,
} from './readme-version.mjs'

const KNOWN = ['0.1.17', '0.1.19', '0.1.20']

test('a README that still names an older plugin version is rejected', () => {
  const markdown = 'Install with `dsh plugin add @nanmicoder/dsh-agent-teams@0.1.17`.'
  const problems = checkReadmeVersions({ version: '0.1.20', known: KNOWN, files: { 'README.md': markdown } })
  assert.ok(
    problems.includes('README.md pins @nanmicoder/dsh-agent-teams@0.1.17 but the package is 0.1.20'),
    `expected a pinned-install problem, got ${JSON.stringify(problems)}`
  )
})

test('an older version left in prose is rejected even without an install command', () => {
  const markdown = 'The npm `latest` tag points to `0.1.17` on a fresh profile.'
  assert.deepEqual(
    findStaleVersionReferences(markdown, '0.1.20', KNOWN).map(stale => stale.version),
    ['0.1.17']
  )
})

test('older versions stay reachable through their release-notes links', () => {
  const markdown = [
    'See [v0.1.19](./release-notes/v0.1.19.md) for the previous release.',
    'See [0.1.17](./release-notes/v0.1.17.md) for an older one.',
    'See [release verification](./docs/releases/v0.1.19/README.md) for the evidence.',
  ].join('\n')
  assert.deepEqual(findStaleVersionReferences(markdown, '0.1.20', KNOWN), [])
})

test('a shorter version does not match inside a longer prerelease', () => {
  const markdown = 'Recommended host: DeepSeek Harness `0.1.5-rc.1`, plus `0.1.2-alpha.5` and `0.1.2-alpha.2`.'
  assert.deepEqual(findStaleVersionReferences(markdown, '0.1.20', ['0.1.5', '0.1.2', ...KNOWN]), [])
})

test('install commands are extracted regardless of version', () => {
  const markdown = 'add --save-exact @nanmicoder/dsh-agent-teams@0.1.16 and @nanmicoder/dsh-agent-teams@0.1.20'
  assert.deepEqual(findPinnedInstallVersions(markdown), ['0.1.16', '0.1.20'])
})

test('published versions come from the release notes themselves', () => {
  const known = publishedVersions(fileURLToPath(new URL('../release-notes', import.meta.url)))
  assert.ok(known.includes('0.1.18') && known.includes('0.1.16-rc.2'), known.join(', '))
})

test('the checked-in READMEs match the package version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const files = Object.fromEntries(
    ['README.md', 'README_ZH.md'].map(name => [name, readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')])
  )
  const known = publishedVersions(fileURLToPath(new URL('../release-notes', import.meta.url)))
  assert.deepEqual(checkReadmeVersions({ version: pkg.version, known, files }), [])
})
