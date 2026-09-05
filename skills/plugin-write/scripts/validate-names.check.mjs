import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  DEFAULT_POLICY_FILE,
  NamingInputError,
  loadNamingPolicy,
  renderText,
  validateManifestFile,
  validateNamingManifest,
} from './validate-names.mjs'

function validManifest() {
  return {
    $schema: './plugin-naming.schema.json',
    schemaVersion: 1,
    policy: 'dsh-plugin-naming/v1',
    plugin: {
      namespace: 'alice',
      name: 'web-search',
      coordinate: 'alice/web-search',
      packageName: '@alice/dsh-web-search',
    },
    names: {
      pluginNames: ['web-search'],
      loaderIds: ['alice-web-search'],
      services: ['aliceWebSearchIndex'],
      tools: ['alice_web_search_query'],
      commands: ['alice-web-search-refresh'],
      skills: ['alice-web-search'],
      skillProviders: ['alice-web-search-filesystem'],
      events: ['alice-web-search/ready'],
      settingsNamespaces: ['alice-web-search'],
      routes: [{ kind: 'exact', path: '/api/plugins/alice-web-search/query' }],
    },
  }
}

function officialStyleManifest() {
  return {
    schemaVersion: 1,
    policy: 'dsh-plugin-naming/v1',
    plugin: {
      namespace: 'alice',
      name: 'hello-plugin',
      coordinate: 'alice/hello-plugin',
      packageName: 'dsh-hello-plugin',
    },
    names: {
      pluginNames: ['hello-plugin'],
      loaderIds: ['hello'],
      services: ['metrics'],
      tools: ['greet'],
      commands: ['plan'],
      skills: ['hello-plugin'],
      skillProviders: ['hello-filesystem'],
      events: ['hello-plugin/ready'],
      settingsNamespaces: ['my-plugin'],
      routes: [{ kind: 'exact', path: '/hello' }],
    },
  }
}

function codes(issues) {
  return new Set(issues.map((issue) => issue.code))
}

function runCli(args) {
  const validatorPath = fileURLToPath(new URL('./validate-names.mjs', import.meta.url))
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [validatorPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
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

export async function runNamingValidatorChecks() {
  const policy = await loadNamingPolicy()
  const accepted = validateNamingManifest(validManifest(), policy)
  assert.equal(accepted.valid, true)
  assert.equal(accepted.coordinate, 'alice/web-search')
  assert.equal(accepted.declarationCount, 10)
  assert.equal(accepted.warnings.length, 0)
  assert.match(renderText({ ...accepted, policy: policy.id }), /^Naming compatible:/)

  const officialStyle = validateNamingManifest(officialStyleManifest(), policy)
  assert.equal(officialStyle.valid, true, 'Official tutorial-style short names must remain compatible')
  assert(officialStyle.warnings.some((warning) => warning.code === 'recommended-prefix'))

  const invalid = validManifest()
  invalid.extra = true
  invalid.plugin.namespace = 'dsh-community'
  invalid.plugin.coordinate = 'dsh-community/not-web-search'
  invalid.plugin.packageName = 'Not A Package'
  invalid.names.services = ['search']
  invalid.names.tools = ['run_code']
  invalid.names.commands = ['dsh-community-web-search', 'dsh-community-web-search']
  invalid.names.skillProviders = ['runtime']
  invalid.names.routes = [{ kind: 'exact', path: '/api/search' }]
  const rejected = validateNamingManifest(invalid, policy)
  assert.equal(rejected.valid, false)
  for (const code of [
    'unknown-property',
    'coordinate-mismatch',
    'pattern',
    'reserved-name',
    'duplicate',
  ]) {
    assert(codes(rejected.errors).has(code), `Expected rejection code ${code}`)
  }
  assert(rejected.errors.some(
    (error) => error.path === '$.names.skillProviders[0]' && error.code === 'reserved-name',
  ))
  assert(codes(rejected.warnings).has('reserved-namespace'))
  assert(codes(rejected.warnings).has('known-built-in'))
  assert(codes(rejected.warnings).has('recommended-prefix'))

  const malformedNames = validManifest()
  malformedNames.names.commands = ['alice.web.search']
  const malformedResult = validateNamingManifest(malformedNames, policy)
  assert(malformedResult.errors.some(
    (error) => error.path === '$.names.commands[0]' && error.code === 'pattern',
  ))

  const nonRecommendedNames = validManifest()
  nonRecommendedNames.names.tools = ['alice_web_search_']
  nonRecommendedNames.names.events = ['alice-web-search/ready-']
  nonRecommendedNames.names.settingsNamespaces = ['alice--web-search']
  const nonRecommendedResult = validateNamingManifest(nonRecommendedNames, policy)
  assert.equal(nonRecommendedResult.valid, true)
  for (const path of ['$.names.tools[0]', '$.names.events[0]', '$.names.settingsNamespaces[0]']) {
    assert(nonRecommendedResult.warnings.some(
      (warning) => warning.path === path && warning.code === 'recommended-pattern',
    ), `Expected community-style warning at ${path}`)
  }

  const root = await mkdtemp(join(tmpdir(), 'dsh-naming-'))
  try {
    const manifestPath = join(root, 'dsh-plugin.naming.json')
    const content = `${JSON.stringify(validManifest(), null, 2)}\n`
    await writeFile(manifestPath, content)
    const before = await readFile(manifestPath, 'utf8')
    const fileResult = await validateManifestFile({ manifestPath })
    const after = await readFile(manifestPath, 'utf8')
    assert.equal(fileResult.valid, true)
    assert.equal(after, before, 'Naming validator must not modify the manifest')

    const cliAccepted = await runCli(['--manifest', manifestPath, '--format', 'json', '--strict'])
    assert.equal(cliAccepted.code, 0)
    assert.equal(cliAccepted.signal, null)
    assert.equal(cliAccepted.stderr, '')
    assert.equal(JSON.parse(cliAccepted.stdout).strictValid, true)

    await writeFile(manifestPath, `${JSON.stringify(officialStyleManifest(), null, 2)}\n`)
    const cliCompatible = await runCli(['--manifest', manifestPath])
    assert.equal(cliCompatible.code, 0)
    assert.match(cliCompatible.stdout, /WARN .*recommended-prefix/)
    const cliStrictWarning = await runCli(['--manifest', manifestPath, '--strict'])
    assert.equal(cliStrictWarning.code, 1)
    assert.match(cliStrictWarning.stdout, /Strict naming validation failed/)

    const invalidManifest = validManifest()
    invalidManifest.names.loaderIds = ['Web Search']
    await writeFile(manifestPath, `${JSON.stringify(invalidManifest, null, 2)}\n`)
    const cliRejected = await runCli(['--manifest', manifestPath])
    assert.equal(cliRejected.code, 1)
    assert.match(cliRejected.stdout, /pattern/)
    assert.equal(cliRejected.stderr, '')

    await writeFile(manifestPath, '{ invalid json')
    await assert.rejects(
      validateManifestFile({ manifestPath }),
      (error) => error instanceof NamingInputError && /Cannot parse naming manifest/.test(error.message),
    )
    const cliInputError = await runCli(['--manifest', manifestPath])
    assert.equal(cliInputError.code, 2)
    assert.match(cliInputError.stderr, /Naming input error: Cannot parse naming manifest/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }

  const schemaPath = resolve(dirname(DEFAULT_POLICY_FILE), 'plugin-naming.schema.json')
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
  assert.equal(schema.properties.schemaVersion.const, policy.schemaVersion)
  assert.equal(schema.properties.policy.const, policy.id)
  assert.deepEqual(schema.properties.names.required, Object.keys(validManifest().names))
  assert.equal(schema.$defs.nonEmptyPluginNameList.minItems, 1)
  assert.equal(schema.$defs.nonEmptyLoaderIdList.minItems, 1)
  assert.equal(schema.properties.plugin.properties.namespace.pattern, policy.surfaces.namespace.pattern)
  assert.equal(schema.properties.plugin.properties.namespace.maxLength, policy.surfaces.namespace.maxLength)
  assert.equal(schema.properties.plugin.properties.name.pattern, policy.surfaces.pluginName.pattern)
  assert.equal(schema.properties.plugin.properties.name.maxLength, policy.surfaces.pluginName.maxLength)
  assert.equal(schema.properties.plugin.properties.packageName.pattern, policy.surfaces.packageName.pattern)
  assert.equal(schema.properties.plugin.properties.packageName.maxLength, policy.surfaces.packageName.maxLength)
  const surfaceDefinitions = {
    pluginNames: 'nonEmptyPluginNameList',
    loaderIds: 'nonEmptyLoaderIdList',
    services: 'serviceList',
    tools: 'toolList',
    commands: 'commandList',
    skills: 'skillList',
    skillProviders: 'skillProviderList',
    events: 'eventList',
    settingsNamespaces: 'settingsNamespaceList',
  }
  for (const [surface, definition] of Object.entries(surfaceDefinitions)) {
    assert.equal(schema.$defs[definition].items.pattern, policy.surfaces[surface].pattern)
    assert.equal(schema.$defs[definition].items.maxLength, policy.surfaces[surface].maxLength)
  }
  assert.equal(schema.$defs.routeList.items.properties.path.pattern, policy.surfaces.routes.pattern)
  assert.equal(schema.$defs.routeList.items.properties.path.maxLength, policy.surfaces.routes.maxLength)
  assert.deepEqual(schema.$defs.routeList.items.properties.kind.enum, ['exact', 'prefix', 'upgrade'])
  assert.deepEqual(Object.keys(policy.collisionSemantics), Object.keys(validManifest().names))
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) {
  await runNamingValidatorChecks()
  console.log('Naming validator checks OK: official compatibility, strict recommendations, collision semantics, schema, read-only behavior, CLI exits 0/1/2')
}
