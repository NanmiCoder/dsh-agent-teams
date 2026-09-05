import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildReport,
  classifyFailure,
  parseMemoryBytes,
  redactLogs,
  renderMarkdown,
  validateConfig,
} from './docker-release-smoke.mjs'

const validConfig = {
  schema: 1,
  image: 'node:24-bookworm',
  dshVersion: '0.1.2-alpha.2',
  pnpmVersion: '11.24.0',
  profile: 'web',
  startCommand: ['dsh', 'web', '--no-open'],
  readyPattern: 'dsh web:',
  timeoutSeconds: 60,
  shutdownGraceSeconds: 5,
  probeCommand: [],
}

test('validateConfig accepts a pinned smoke configuration', () => {
  assert.deepEqual(validateConfig(validConfig), validConfig)
})

test('validateConfig rejects mutable and ranged targets', () => {
  assert.throws(() => validateConfig({ ...validConfig, image: 'node:latest' }), /latest/)
  assert.throws(() => validateConfig({ ...validConfig, dshVersion: '^0.1.2' }), /exact version/)
  assert.throws(() => validateConfig({ ...validConfig, startCommand: 'dsh web' }), /argv array/)
})

test('parseMemoryBytes handles Docker binary and decimal units', () => {
  assert.equal(parseMemoryBytes('12.5MiB / 1GiB'), 13_107_200)
  assert.equal(parseMemoryBytes('2 GB / 4 GB'), 2_000_000_000)
  assert.equal(parseMemoryBytes('not available'), null)
})

test('redactLogs removes common credential forms', () => {
  const source = [
    'Authorization: Bearer abc.def',
    '_authToken="npm-secret"',
    'DEEPSEEK_API_KEY=provider-secret',
    '{"accessToken": "json-secret"}',
    'dbPassword: hunter2',
    '--token command-secret',
  ].join('\n')
  const result = redactLogs(source)
  assert.equal(result.redactions, 6)
  for (const secret of ['abc.def', 'npm-secret', 'provider-secret', 'json-secret', 'hunter2', 'command-secret']) {
    assert.equal(result.text.includes(secret), false)
  }
})

test('classifyFailure maps setup, install, startup, probe, and infrastructure failures', () => {
  assert.equal(classifyFailure({ status: 'failed', failure: { phase: 'install-toolchain' } }, 1), 'host-setup')
  assert.equal(classifyFailure({ status: 'failed', failure: { phase: 'verify-pnpm-version' } }, 1), 'host-setup')
  assert.equal(classifyFailure({ status: 'failed', failure: { phase: 'install-plugin' } }, 1), 'plugin-install')
  assert.equal(classifyFailure({ status: 'failed', failure: { phase: 'cold-start' } }, 1), 'startup')
  assert.equal(classifyFailure({ status: 'failed', failure: { phase: 'probe' } }, 1), 'probe')
  assert.equal(classifyFailure(null, null, new Error('Docker unavailable')), 'infrastructure')
  assert.equal(classifyFailure({ status: 'passed' }, 0), null)
})

test('buildReport and renderMarkdown include metrics but not command secrets', () => {
  const report = buildReport({
    config: { ...validConfig, probeCommand: ['curl', '--token', 'probe-secret'] },
    artifact: { name: 'plugin.tgz', sizeBytes: 42, sha256: 'abc123' },
    dockerServerVersion: '29.6.1',
    containerImageId: 'sha256:image',
    containerExitCode: 0,
    containerResult: {
      status: 'passed',
      steps: [{ name: 'cold-start', status: 'passed', exitCode: null, durationMs: 123 }],
    },
    elapsedMs: 456,
    peakMemoryBytes: 1024 * 1024,
    peakCpuPercent: 3.5,
    resourceSamples: 2,
    stdout: 'ready TOKEN=log-secret',
    stderr: '',
  })
  const markdown = renderMarkdown(report)
  assert.equal(report.status, 'passed')
  assert.deepEqual(report.target.probeCommand, ['curl', '--token', '[REDACTED]'])
  assert.equal(JSON.stringify(report).includes('probe-secret'), false)
  assert.equal(markdown.includes('log-secret'), false)
  assert.match(markdown, /Peak memory: 1\.00 MiB/)
  assert.match(markdown, /cold-start/)
})
