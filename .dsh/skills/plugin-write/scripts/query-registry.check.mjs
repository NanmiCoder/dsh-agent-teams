import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadNamingPolicy } from './validate-names.mjs'
import {
  DEFAULT_REGISTRY_URL,
  MAX_INDEX_BYTES,
  REGISTRY_CONTRACT,
  REGISTRY_INDEX_SCHEMA_URL,
  RegistryQueryInputError,
  checkNamingAgainstIndex,
  queryManifestFile,
  readRegistryIndex,
  renderRegistryQuery,
} from './query-registry.mjs'

function namingManifest(namespace = 'bob') {
  const base = `${namespace}-web-search`
  return {
    schemaVersion: 1,
    policy: 'dsh-plugin-naming/v1',
    plugin: {
      namespace,
      name: 'web-search',
      coordinate: `${namespace}/web-search`,
      packageName: `@${namespace}/dsh-web-search`,
    },
    names: {
      pluginNames: ['web-search'],
      loaderIds: [base],
      services: [`${namespace}WebSearchIndex`],
      tools: [`${namespace}_web_search_query`],
      commands: [`${base}-refresh`],
      skills: [base],
      skillProviders: [`${base}-filesystem`],
      events: [`${base}/ready`],
      settingsNamespaces: [base],
      routes: [{ kind: 'exact', path: `/api/plugins/${base}/query` }],
    },
  }
}

function registration(namespace = 'alice', overrides = {}) {
  const naming = namingManifest(namespace)
  const base = `${namespace}-web-search`
  const value = {
    schemaVersion: 2,
    plugin: {
      id: `${namespace}/web-search`,
      repository: `https://github.com/${namespace}/dsh-web-search`,
      package: naming.plugin.packageName,
      status: 'active',
    },
    source: {
      commit: '0123456789abcdef0123456789abcdef01234567',
      namingManifest: 'dsh-plugin.naming.json',
    },
    compatibility: { harness: { min: '0.1.2-alpha.2', maxExclusive: '0.2.0' } },
    claims: {
      pluginNames: naming.names.pluginNames,
      loaderIds: [{ name: base, composition: 'root', layer: 0, overrideIntent: 'none' }],
      services: [{ name: naming.names.services[0], scope: 'root' }],
      tools: [{ name: naming.names.tools[0], scope: 'agent' }],
      commands: [{ name: naming.names.commands[0], scope: 'root' }],
      skills: [{ name: naming.names.skills[0], scope: 'root', provider: naming.names.skillProviders[0], rank: 0 }],
      skillProviders: [{ name: naming.names.skillProviders[0], scope: 'root' }],
      events: [{ name: naming.names.events[0], scope: 'root', role: 'publisher', schema: `urn:${base}:ready:v1` }],
      settingsNamespaces: [{ name: naming.names.settingsNamespaces[0], scope: 'root' }],
      routes: [{ ...naming.names.routes[0], scope: 'root' }],
    },
    manifestPath: `registry/entries/${namespace}/web-search.json`,
  }
  return {
    ...value,
    ...overrides,
    plugin: { ...value.plugin, ...(overrides.plugin ?? {}) },
    compatibility: {
      ...value.compatibility,
      ...(overrides.compatibility ?? {}),
      harness: { ...value.compatibility.harness, ...(overrides.compatibility?.harness ?? {}) },
    },
    claims: { ...value.claims, ...(overrides.claims ?? {}) },
  }
}

function index(plugins) {
  return {
    $schema: REGISTRY_INDEX_SCHEMA_URL,
    schemaVersion: 2,
    contract: REGISTRY_CONTRACT,
    source: 'registry/entries',
    plugins,
  }
}

function assertInvalidIndex(candidate, mutate, pattern) {
  const value = index([registration('alice')])
  mutate(value)
  assert.throws(
    () => checkNamingAgainstIndex(candidate, value),
    (error) => error instanceof RegistryQueryInputError && pattern.test(error.message),
  )
}

function runCli(args) {
  const script = fileURLToPath(new URL('./query-registry.mjs', import.meta.url))
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code, signal) => resolvePromise({ code, signal, stdout, stderr }))
  })
}

export async function runRegistryQueryChecks() {
  const policy = await loadNamingPolicy()
  assert.equal(policy.centralRegistry?.repository, 'https://github.com/oh-my-dsh/dsh-plugin-registry')
  assert.equal(policy.centralRegistry?.contract, REGISTRY_CONTRACT)
  assert.equal(policy.centralRegistry?.indexSchemaUrl, REGISTRY_INDEX_SCHEMA_URL)
  assert.equal(policy.centralRegistry?.defaultIndexUrl, DEFAULT_REGISTRY_URL)

  const alice = registration('alice')
  const candidate = namingManifest('bob')
  candidate.names.pluginNames = ['web-search']
  candidate.names.tools = ['alice_web_search_query']
  candidate.names.events = ['alice-web-search/ready']
  candidate.names.routes = [{ kind: 'exact', path: '/api/plugins/alice-web-search/query' }]
  const report = checkNamingAgainstIndex(candidate, index([alice]), { harnessVersion: '0.1.2-alpha.2' })
  assert.equal(report.status, 'checked')
  assert.equal(report.registration, null)
  assert(report.matches.some((match) => match.kind === 'tools' && match.severity === 'warning'))
  assert(report.matches.some((match) => match.kind === 'routes' && match.severity === 'warning'))
  assert(report.matches.some((match) => match.kind === 'pluginNames' && match.severity === 'notice'))
  assert(report.matches.some((match) => match.kind === 'events' && match.severity === 'notice'))
  assert.match(renderRegistryQuery(report, 'fixture-index.json'), /not a global uniqueness proof|WARNING/)

  const empty = checkNamingAgainstIndex(candidate, index([]), { harnessVersion: '0.1.2-alpha.2' })
  assert.equal(empty.status, 'checked')
  assert.equal(empty.matches.length, 0)
  const legacyIndex = index([alice])
  delete legacyIndex.$schema
  assert.equal(checkNamingAgainstIndex(candidate, legacyIndex).status, 'checked')

  assertInvalidIndex(candidate, (value) => { value.$schema = 'https://example.com/plugin-index.schema.json' }, /index\.\$schema/)
  assertInvalidIndex(candidate, (value) => { value.source = 'discovery/candidates' }, /index\.source/)
  assertInvalidIndex(candidate, (value) => { value.polluted = true }, /index\.polluted/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].polluted = true }, /index\.plugins\[0\]\.polluted/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].plugin.status = 'pending' }, /plugin\.status/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].plugin.repository = 'http:\/\/github.com\/alice\/dsh-web-search' }, /plugin\.repository/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].plugin.repository = 'https:\/\/github.com\/alice_bad\/dsh-web-search' }, /plugin\.repository/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].plugin.package = 'bad package' }, /plugin\.package/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].plugin.release = 'not-semver' }, /plugin\.release/)
  assertInvalidIndex(candidate, (value) => { delete value.plugins[0].source }, /source is required/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].source.commit = 'main' }, /source\.commit/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].source.namingManifest = '..\/secret.json' }, /source\.namingManifest/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].source.namingManifest = '.\/dsh-plugin.naming.json' }, /source\.namingManifest/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].source.namingManifest = 'dir\/\/dsh-plugin.naming.json' }, /source\.namingManifest/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].source.namingManifest = 'dsh-plugin?raw.json' }, /source\.namingManifest/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].manifestPath = '..\/entries\/alice\/web-search.json' }, /manifestPath/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].compatibility.harness.min = '0.1.2-alpha.01' }, /harness\.min/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].claims.pluginNames = [123] }, /claims\.pluginNames\[0\]/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].claims.pluginNames = [] }, /claims\.pluginNames/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].claims.loaderIds = [] }, /claims\.loaderIds/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].claims.loaderIds[0].layer = -1 }, /loaderIds\[0\]\.layer/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].claims.services[0].scope = 'global' }, /services\[0\]\.scope/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].claims.skills[0].rank = 0.5 }, /skills\[0\]\.rank/)
  assertInvalidIndex(candidate, (value) => { delete value.plugins[0].claims.events[0].schema }, /events\[0\]\.schema is required/)
  assertInvalidIndex(candidate, (value) => { value.plugins[0].claims.routes[0].kind = 'regex' }, /routes\[0\]\.kind/)

  const duplicateCoordinate = registration('alice')
  assert.throws(
    () => checkNamingAgainstIndex(candidate, index([alice, duplicateCoordinate])),
    (error) => error instanceof RegistryQueryInputError
      && /duplicates coordinate/.test(error.message)
      && /manifestPath/.test(error.message),
  )

  const legacyPath = index([alice])
  legacyPath.plugins[0].manifestPath = 'snapshots/alice-search.json'
  assert.equal(checkNamingAgainstIndex(candidate, legacyPath).status, 'checked')

  const unsorted = index([registration('bob'), registration('alice')])
  assert.throws(
    () => checkNamingAgainstIndex(candidate, unsorted),
    (error) => error instanceof RegistryQueryInputError && /sorted by plugin\.id/.test(error.message),
  )

  const futureOnly = checkNamingAgainstIndex(candidate, index([alice]), { harnessVersion: '0.2.0' })
  assert.equal(futureOnly.matches.length, 0)

  const self = checkNamingAgainstIndex(namingManifest('alice'), index([alice]), { harnessVersion: '0.1.2-alpha.2' })
  assert.equal(self.registration.id, 'alice/web-search')
  assert.equal(self.registration.appliesToHarnessVersion, true)
  assert.equal(self.matches.length, 0)

  const selfOutsideRange = checkNamingAgainstIndex(namingManifest('alice'), index([alice]), { harnessVersion: '0.2.0' })
  assert.equal(selfOutsideRange.registration.id, 'alice/web-search')
  assert.equal(selfOutsideRange.registration.appliesToHarnessVersion, false)
  assert.match(renderRegistryQuery(selfOutsideRange, 'fixture-index.json'), /outside the registered range/)

  const stale = namingManifest('alice')
  stale.names.tools = ['alice_web_search_v2']
  const staleReport = checkNamingAgainstIndex(stale, index([alice]))
  assert(staleReport.matches.some((match) => match.reason.includes('stale')))

  const wrongPackage = namingManifest('alice')
  wrongPackage.plugin.packageName = '@alice/dsh-web-search-next'
  const wrongPackageReport = checkNamingAgainstIndex(wrongPackage, index([alice]))
  assert.equal(wrongPackageReport.summary.errors, 1)

  const unicodeCandidate = namingManifest('bob')
  unicodeCandidate.names.services = ['z', 'ä', '\uE000', '\u{10000}']
  const unicodeAlice = registration('alice')
  unicodeAlice.claims.services = [{ name: 'ä', scope: 'root' }, { name: '\uE000', scope: 'root' }]
  const unicodeCarol = registration('carol')
  unicodeCarol.claims.services = [{ name: 'z', scope: 'root' }, { name: '\u{10000}', scope: 'root' }]
  const unicodeMatches = checkNamingAgainstIndex(unicodeCandidate, index([unicodeAlice, unicodeCarol]))
    .matches.filter((match) => match.kind === 'services')
  assert.deepEqual(unicodeMatches.map((match) => match.claim), ['z', 'ä', '\uE000', '\u{10000}'])

  await assert.rejects(
    readRegistryIndex({ fetchImpl: async () => new Response('unavailable', { status: 503 }) }),
    (error) => error instanceof RegistryQueryInputError && /HTTP 503/.test(error.message),
  )
  await assert.rejects(
    readRegistryIndex({ fetchImpl: async () => new Response('{"schemaVersion":1}', { status: 200 }) }),
    (error) => error instanceof RegistryQueryInputError && /dsh-plugin-registry\/v2/.test(error.message),
  )
  const remoteBytes = Buffer.from(JSON.stringify(index([alice])))
  const remoteIndex = await readRegistryIndex({ fetchImpl: async () => new Response(remoteBytes, { status: 200 }) })
  const remoteReport = checkNamingAgainstIndex(candidate, remoteIndex)
  assert.equal(remoteReport.indexSha256, createHash('sha256').update(remoteBytes).digest('hex'))
  let remaining = MAX_INDEX_BYTES + 1024 * 1024
  let cancelled = false
  const oversizedBody = new ReadableStream({
    pull(controller) {
      if (remaining === 0) return controller.close()
      const size = Math.min(64 * 1024, remaining)
      remaining -= size
      controller.enqueue(new Uint8Array(size))
    },
    cancel() {
      cancelled = true
    },
  })
  await assert.rejects(
    readRegistryIndex({ fetchImpl: async () => new Response(oversizedBody, { status: 200 }) }),
    (error) => error instanceof RegistryQueryInputError && /too large/.test(error.message),
  )
  assert.equal(cancelled, true, 'oversized chunked response must be cancelled as soon as the hard limit is crossed')
  let unsafeFallbackRead = false
  await assert.rejects(
    readRegistryIndex({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        body: null,
        text: async () => {
          unsafeFallbackRead = true
          return JSON.stringify(index([]))
        },
      }),
    }),
    (error) => error instanceof RegistryQueryInputError && /bounded fallback refused/.test(error.message),
  )
  assert.equal(unsafeFallbackRead, false, 'non-stream fallback must fail closed without buffering an unbounded body')

  const root = await mkdtemp(join(tmpdir(), 'dsh-registry-query-'))
  try {
    const manifestPath = join(root, 'dsh-plugin.naming.json')
    const indexPath = join(root, 'index.json')
    await writeFile(manifestPath, `${JSON.stringify(candidate, null, 2)}\n`)
    await writeFile(indexPath, `${JSON.stringify(index([alice]), null, 2)}\n`)
    const fileReport = await queryManifestFile({ manifestPath, indexPath, harnessVersion: '0.1.2-alpha.2' })
    assert.equal(fileReport.summary.warnings, 2)
    const indexBytes = await readFile(indexPath)
    assert.equal(fileReport.indexSha256, createHash('sha256').update(indexBytes).digest('hex'))
    assert.match(renderRegistryQuery(fileReport, indexPath), new RegExp(`Index SHA-256: ${fileReport.indexSha256}`))

    const ordinary = await runCli(['--manifest', manifestPath, '--index', indexPath, '--harness-version', '0.1.2-alpha.2'])
    assert.equal(ordinary.code, 0, ordinary.stderr)
    assert.match(ordinary.stdout, /Registry checked/)
    const strict = await runCli(['--manifest', manifestPath, '--index', indexPath, '--harness-version', '0.1.2-alpha.2', '--strict'])
    assert.equal(strict.code, 1)
    const unavailable = await runCli(['--manifest', manifestPath, '--registry-url', 'http://127.0.0.1:1/index.json', '--format', 'json'])
    assert.equal(unavailable.code, 2)
    assert.match(unavailable.stderr, /"status":"unavailable"/)
    if (Object.keys(process.env).some((name) => /^(?:https?|all)_proxy$/i.test(name))) {
      assert.match(unavailable.stderr, /--use-env-proxy|does not automatically use it/)
    }

    const polluted = index([alice])
    polluted.plugins[0].plugin.status = 'unreviewed'
    await writeFile(indexPath, `${JSON.stringify(polluted, null, 2)}\n`)
    const pollutedResult = await runCli(['--manifest', manifestPath, '--index', indexPath, '--format', 'json'])
    assert.equal(pollutedResult.code, 2)
    assert.match(pollutedResult.stderr, /"status":"unavailable"/)
    assert.match(pollutedResult.stderr, /plugin\.status/)

    await writeFile(indexPath, Buffer.alloc(MAX_INDEX_BYTES + 1, 0x20))
    const oversizedLocal = await runCli(['--manifest', manifestPath, '--index', indexPath, '--format', 'json'])
    assert.equal(oversizedLocal.code, 2)
    assert.match(oversizedLocal.stderr, /"status":"unavailable"/)
    assert.match(oversizedLocal.stderr, /too large/)

    const invalid = namingManifest('bob')
    invalid.names.loaderIds = ['has space']
    await writeFile(manifestPath, `${JSON.stringify(invalid, null, 2)}\n`)
    const invalidResult = await runCli(['--manifest', manifestPath, '--index', indexPath])
    assert.equal(invalidResult.code, 2)
    assert.match(invalidResult.stderr, /local naming validation failed/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) {
  await runRegistryQueryChecks()
  console.log('Registry query checks OK: fail-closed v2 index and entry validation, SHA-256 evidence, stable Unicode ordering, 5 MiB local/stream limits, proxy diagnostics, offline fixture, CLI exits 0/1/2')
}
