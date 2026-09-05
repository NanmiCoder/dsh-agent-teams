import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadNamingPolicy } from './validate-names.mjs'
import {
  DEFAULT_REGISTRY_URL,
  REGISTRY_CONTRACT,
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
  return { schemaVersion: 2, contract: REGISTRY_CONTRACT, source: 'registry/entries', plugins }
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

  const futureOnly = checkNamingAgainstIndex(candidate, index([alice]), { harnessVersion: '0.2.0' })
  assert.equal(futureOnly.matches.length, 0)

  const self = checkNamingAgainstIndex(namingManifest('alice'), index([alice]), { harnessVersion: '0.1.2-alpha.2' })
  assert.equal(self.registration.id, 'alice/web-search')
  assert.equal(self.matches.length, 0)

  const stale = namingManifest('alice')
  stale.names.tools = ['alice_web_search_v2']
  const staleReport = checkNamingAgainstIndex(stale, index([alice]))
  assert(staleReport.matches.some((match) => match.reason.includes('stale')))

  const wrongPackage = namingManifest('alice')
  wrongPackage.plugin.packageName = '@alice/dsh-web-search-next'
  const wrongPackageReport = checkNamingAgainstIndex(wrongPackage, index([alice]))
  assert.equal(wrongPackageReport.summary.errors, 1)

  await assert.rejects(
    readRegistryIndex({ fetchImpl: async () => new Response('unavailable', { status: 503 }) }),
    (error) => error instanceof RegistryQueryInputError && /HTTP 503/.test(error.message),
  )
  await assert.rejects(
    readRegistryIndex({ fetchImpl: async () => new Response('{"schemaVersion":1}', { status: 200 }) }),
    (error) => error instanceof RegistryQueryInputError && /dsh-plugin-registry\/v2/.test(error.message),
  )

  const root = await mkdtemp(join(tmpdir(), 'dsh-registry-query-'))
  try {
    const manifestPath = join(root, 'dsh-plugin.naming.json')
    const indexPath = join(root, 'index.json')
    await writeFile(manifestPath, `${JSON.stringify(candidate, null, 2)}\n`)
    await writeFile(indexPath, `${JSON.stringify(index([alice]), null, 2)}\n`)
    const fileReport = await queryManifestFile({ manifestPath, indexPath, harnessVersion: '0.1.2-alpha.2' })
    assert.equal(fileReport.summary.warnings, 2)

    const ordinary = await runCli(['--manifest', manifestPath, '--index', indexPath, '--harness-version', '0.1.2-alpha.2'])
    assert.equal(ordinary.code, 0, ordinary.stderr)
    assert.match(ordinary.stdout, /Registry checked/)
    const strict = await runCli(['--manifest', manifestPath, '--index', indexPath, '--harness-version', '0.1.2-alpha.2', '--strict'])
    assert.equal(strict.code, 1)
    const unavailable = await runCli(['--manifest', manifestPath, '--registry-url', 'http://127.0.0.1:1/index.json', '--format', 'json'])
    assert.equal(unavailable.code, 2)
    assert.match(unavailable.stderr, /"status":"unavailable"/)

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
  console.log('Registry query checks OK: v2 contract, local validation gate, version filtering, contextual matches, shared-event notices, stale registration, offline fixture, CLI exits 0/1/2')
}
