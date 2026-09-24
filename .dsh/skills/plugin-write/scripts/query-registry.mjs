#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadNamingPolicy, validateNamingManifest } from './validate-names.mjs'

export const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/oh-my-dsh/dsh-plugin-registry/main/registry/index.json'
export const REGISTRY_CONTRACT = 'dsh-plugin-registry/v2'
export const REGISTRY_INDEX_SCHEMA_URL = 'https://raw.githubusercontent.com/oh-my-dsh/dsh-plugin-registry/main/registry/schema/plugin-index.schema.json'

export const MAX_INDEX_BYTES = 5 * 1024 * 1024
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const coordinatePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/
const namePattern = /^[^\s\u0000-\u001f\u007f]{1,192}$/u
const scopePattern = /^(?:root|agent|unknown|isolated:[a-z0-9]+(?:-[a-z0-9]+)*)$/
const sourcePathPattern = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)[^\u0000-\u001f\u007f\\?#]+\.json$/u
const packagePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const pluginStatuses = new Set(['active', 'deprecated', 'archived'])
const routeKinds = new Set(['exact', 'prefix', 'upgrade'])
const scopedKinds = ['services', 'tools', 'commands', 'skillProviders', 'settingsNamespaces']
const requiredClaimKinds = [
  'pluginNames',
  'loaderIds',
  ...scopedKinds,
  'skills',
  'events',
  'routes',
]
const indexDigests = new WeakMap()

export class RegistryQueryInputError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'RegistryQueryInputError'
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(path, message) {
  throw new RegistryQueryInputError(`${path} ${message}`)
}

function checkObject(value, path, { allowed, required = allowed } = {}) {
  if (!isObject(value)) invalid(path, 'must be an object')
  for (const key of required) {
    if (!Object.hasOwn(value, key)) invalid(`${path}.${key}`, 'is required')
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(`${path}.${key}`, 'is not supported by the v2 contract')
  }
}

function checkString(value, path, { pattern, maxLength = 512 } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    invalid(path, `must be a non-empty string up to ${maxLength} characters`)
  }
  if (pattern && !pattern.test(value)) invalid(path, 'has an invalid format')
}

function checkOptionalString(value, path, options) {
  if (value !== undefined) checkString(value, path, options)
}

function duplicateKey(seen, key, path, description) {
  if (seen.has(key)) invalid(path, `duplicates ${description}`)
  seen.add(key)
}

function compareText(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0))
  const rightPoints = Array.from(right, (character) => character.codePointAt(0))
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let offset = 0; offset < length; offset += 1) {
    if (leftPoints[offset] !== rightPoints[offset]) return leftPoints[offset] < rightPoints[offset] ? -1 : 1
  }
  return leftPoints.length === rightPoints.length ? 0 : leftPoints.length < rightPoints.length ? -1 : 1
}

function repositoryParts(repository) {
  try {
    const url = new URL(repository)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password
      || url.port || url.search || url.hash) return undefined
    const segments = url.pathname.replace(/^\/|\/$/g, '').split('/')
    if (
      segments.length !== 2
      || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(segments[0])
      || !/^[A-Za-z0-9._-]{1,100}$/.test(segments[1])
      || segments[1] === '.'
      || segments[1] === '..'
    ) return undefined
    return { owner: segments[0].toLowerCase() }
  } catch {
    return undefined
  }
}

function parseSemver(value) {
  if (typeof value !== 'string' || value.length > 128) return undefined
  const match = semverPattern.exec(value)
  if (!match) return undefined
  const prerelease = match[4] ? match[4].split('.') : []
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) return undefined
  return {
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease,
  }
}

function compareNumericIdentifiers(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  return left === right ? 0 : left < right ? -1 : 1
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0
  if (!left.length) return 1
  if (!right.length) return -1
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1
    if (right[index] === undefined) return 1
    const leftNumeric = /^\d+$/.test(left[index])
    const rightNumeric = /^\d+$/.test(right[index])
    if (leftNumeric && rightNumeric) {
      const comparison = compareNumericIdentifiers(left[index], right[index])
      if (comparison) return comparison
    }
    if (leftNumeric && !rightNumeric) return -1
    if (!leftNumeric && rightNumeric) return 1
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1
  }
  return 0
}

function compareSemver(leftValue, rightValue) {
  const left = parseSemver(leftValue)
  const right = parseSemver(rightValue)
  if (!left || !right) throw new RegistryQueryInputError('registry contains an invalid Harness semantic version')
  for (const field of ['major', 'minor', 'patch']) {
    const comparison = compareNumericIdentifiers(left[field], right[field])
    if (comparison) return comparison
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

function supportsHarnessVersion(plugin, version) {
  if (!version) return true
  const range = plugin.compatibility.harness
  return compareSemver(range.min, version) <= 0 && (!range.maxExclusive || compareSemver(version, range.maxExclusive) < 0)
}

function validateNamedClaims(value, path) {
  if (!Array.isArray(value)) invalid(path, 'must be an array')
  const seen = new Set()
  for (let offset = 0; offset < value.length; offset += 1) {
    checkString(value[offset], `${path}[${offset}]`, { pattern: namePattern, maxLength: 192 })
    duplicateKey(seen, value[offset], `${path}[${offset}]`, `name ${JSON.stringify(value[offset])}`)
  }
}

function validateScopedClaims(value, path) {
  if (!Array.isArray(value)) invalid(path, 'must be an array')
  const seen = new Set()
  for (let offset = 0; offset < value.length; offset += 1) {
    const claimPath = `${path}[${offset}]`
    const claim = value[offset]
    checkObject(claim, claimPath, { allowed: ['name', 'scope'] })
    checkString(claim.name, `${claimPath}.name`, { pattern: namePattern, maxLength: 192 })
    checkString(claim.scope, `${claimPath}.scope`, { pattern: scopePattern, maxLength: 128 })
    duplicateKey(seen, `${claim.name}\u0000${claim.scope}`, claimPath, 'the same name and scope')
  }
}

function validateClaims(claims, path) {
  checkObject(claims, path, { allowed: requiredClaimKinds })
  validateNamedClaims(claims.pluginNames, `${path}.pluginNames`)
  if (claims.pluginNames.length === 0) invalid(`${path}.pluginNames`, 'must contain at least one item')
  for (const kind of scopedKinds) validateScopedClaims(claims[kind], `${path}.${kind}`)

  if (!Array.isArray(claims.loaderIds)) invalid(`${path}.loaderIds`, 'must be an array')
  if (claims.loaderIds.length === 0) invalid(`${path}.loaderIds`, 'must contain at least one item')
  const loaders = new Set()
  for (let offset = 0; offset < claims.loaderIds.length; offset += 1) {
    const claimPath = `${path}.loaderIds[${offset}]`
    const claim = claims.loaderIds[offset]
    checkObject(claim, claimPath, { allowed: ['name', 'composition', 'layer', 'overrideIntent'] })
    checkString(claim.name, `${claimPath}.name`, { pattern: namePattern, maxLength: 192 })
    checkString(claim.composition, `${claimPath}.composition`, { pattern: scopePattern, maxLength: 128 })
    if (!Number.isInteger(claim.layer) || claim.layer < 0 || claim.layer > 1024) invalid(`${claimPath}.layer`, 'must be an integer from 0 to 1024')
    if (!['none', 'replace'].includes(claim.overrideIntent)) invalid(`${claimPath}.overrideIntent`, 'must be none or replace')
    duplicateKey(loaders, `${claim.name}\u0000${claim.composition}\u0000${claim.layer}`, claimPath,
      'the same Loader name, composition, and layer')
  }

  if (!Array.isArray(claims.skills)) invalid(`${path}.skills`, 'must be an array')
  const skills = new Set()
  for (let offset = 0; offset < claims.skills.length; offset += 1) {
    const claimPath = `${path}.skills[${offset}]`
    const claim = claims.skills[offset]
    checkObject(claim, claimPath, { allowed: ['name', 'scope', 'provider', 'rank'] })
    checkString(claim.name, `${claimPath}.name`, { pattern: namePattern, maxLength: 192 })
    checkString(claim.scope, `${claimPath}.scope`, { pattern: scopePattern, maxLength: 128 })
    checkString(claim.provider, `${claimPath}.provider`, { pattern: namePattern, maxLength: 192 })
    if (!Number.isInteger(claim.rank) || claim.rank < -1_000_000 || claim.rank > 1_000_000) {
      invalid(`${claimPath}.rank`, 'must be an integer from -1000000 to 1000000')
    }
    duplicateKey(skills, `${claim.name}\u0000${claim.scope}\u0000${claim.provider}\u0000${claim.rank}`, claimPath,
      'the same Skill selection claim')
  }

  if (!Array.isArray(claims.events)) invalid(`${path}.events`, 'must be an array')
  const events = new Set()
  for (let offset = 0; offset < claims.events.length; offset += 1) {
    const claimPath = `${path}.events[${offset}]`
    const claim = claims.events[offset]
    checkObject(claim, claimPath, { allowed: ['name', 'scope', 'role', 'schema'] })
    checkString(claim.name, `${claimPath}.name`, { pattern: namePattern, maxLength: 192 })
    checkString(claim.scope, `${claimPath}.scope`, { pattern: scopePattern, maxLength: 128 })
    if (!['publisher', 'consumer', 'both'].includes(claim.role)) invalid(`${claimPath}.role`, 'must be publisher, consumer, or both')
    if (claim.schema !== null) checkString(claim.schema, `${claimPath}.schema`, { maxLength: 512 })
    duplicateKey(events, `${claim.name}\u0000${claim.scope}\u0000${claim.role}`, claimPath,
      'the same event name, scope, and role')
  }

  if (!Array.isArray(claims.routes)) invalid(`${path}.routes`, 'must be an array')
  const routes = new Set()
  for (let offset = 0; offset < claims.routes.length; offset += 1) {
    const claimPath = `${path}.routes[${offset}]`
    const claim = claims.routes[offset]
    checkObject(claim, claimPath, { allowed: ['kind', 'path', 'scope'] })
    if (!routeKinds.has(claim.kind)) invalid(`${claimPath}.kind`, 'must be exact, prefix, or upgrade')
    checkString(claim.path, `${claimPath}.path`, { pattern: /^\/[^?#\s]*[^/?#\s]$/, maxLength: 256 })
    checkString(claim.scope, `${claimPath}.scope`, { pattern: scopePattern, maxLength: 128 })
    duplicateKey(routes, `${claim.kind}\u0000${claim.path}\u0000${claim.scope}`, claimPath,
      'the same route kind, path, and scope')
  }
}

function validateRegistration(registration, path) {
  checkObject(registration, path, {
    allowed: ['$schema', 'schemaVersion', 'plugin', 'source', 'compatibility', 'claims', 'manifestPath'],
    required: ['schemaVersion', 'plugin', 'source', 'compatibility', 'claims', 'manifestPath'],
  })
  checkOptionalString(registration.$schema, `${path}.$schema`)
  if (registration.schemaVersion !== 2) invalid(`${path}.schemaVersion`, 'must be 2')

  checkObject(registration.plugin, `${path}.plugin`, {
    allowed: ['id', 'displayName', 'repository', 'package', 'release', 'status'],
    required: ['id', 'repository', 'package', 'status'],
  })
  const plugin = registration.plugin
  checkString(plugin.id, `${path}.plugin.id`, { pattern: coordinatePattern, maxLength: 127 })
  checkOptionalString(plugin.displayName, `${path}.plugin.displayName`, { maxLength: 128 })
  checkString(plugin.repository, `${path}.plugin.repository`)
  const repository = repositoryParts(plugin.repository)
  if (!repository) invalid(`${path}.plugin.repository`, 'must be a canonical https://github.com/<owner>/<repo> URL')
  const namespace = plugin.id.split('/')[0]
  if (repository.owner !== namespace) invalid(`${path}.plugin.repository`, `GitHub owner must match plugin namespace ${JSON.stringify(namespace)}`)
  checkString(plugin.package, `${path}.plugin.package`, { pattern: packagePattern, maxLength: 214 })
  checkOptionalString(plugin.release, `${path}.plugin.release`, { maxLength: 128 })
  if (plugin.release !== undefined && !parseSemver(plugin.release)) {
    invalid(`${path}.plugin.release`, 'must be a valid semantic version')
  }
  if (!pluginStatuses.has(plugin.status)) invalid(`${path}.plugin.status`, 'must be active, deprecated, or archived')

  checkObject(registration.source, `${path}.source`, { allowed: ['commit', 'namingManifest'] })
  checkString(registration.source.commit, `${path}.source.commit`, { pattern: /^[0-9a-f]{40}$/, maxLength: 40 })
  checkString(registration.source.namingManifest, `${path}.source.namingManifest`, { pattern: sourcePathPattern, maxLength: 512 })

  checkObject(registration.compatibility, `${path}.compatibility`, { allowed: ['harness'] })
  checkObject(registration.compatibility.harness, `${path}.compatibility.harness`, {
    allowed: ['min', 'maxExclusive'],
    required: ['min'],
  })
  const harness = registration.compatibility.harness
  if (!parseSemver(harness.min)) invalid(`${path}.compatibility.harness.min`, 'must be a valid semantic version')
  if (harness.maxExclusive !== undefined && !parseSemver(harness.maxExclusive)) {
    invalid(`${path}.compatibility.harness.maxExclusive`, 'must be a valid semantic version')
  }
  if (harness.maxExclusive && compareSemver(harness.min, harness.maxExclusive) >= 0) {
    invalid(`${path}.compatibility.harness.maxExclusive`, 'must be greater than min')
  }

  validateClaims(registration.claims, `${path}.claims`)
  checkString(registration.manifestPath, `${path}.manifestPath`, { pattern: sourcePathPattern, maxLength: 512 })
}

function validateIndex(index) {
  if (!isObject(index) || index.schemaVersion !== 2 || index.contract !== REGISTRY_CONTRACT || !Array.isArray(index.plugins)) {
    throw new RegistryQueryInputError(`registry index must use ${REGISTRY_CONTRACT}`)
  }
  checkObject(index, 'index', {
    allowed: ['$schema', 'schemaVersion', 'contract', 'source', 'plugins'],
    required: ['schemaVersion', 'contract', 'source', 'plugins'],
  })
  if (index.$schema !== undefined && index.$schema !== REGISTRY_INDEX_SCHEMA_URL) {
    invalid('index.$schema', `must be ${REGISTRY_INDEX_SCHEMA_URL}`)
  }
  if (index.source !== 'registry/entries') invalid('index.source', 'must be registry/entries')
  if (!Array.isArray(index.plugins)) invalid('index.plugins', 'must be an array')
  const coordinates = new Set()
  const manifestPaths = new Set()
  const duplicateCoordinates = new Set()
  const duplicateManifestPaths = new Set()
  let previousCoordinate
  for (let offset = 0; offset < index.plugins.length; offset += 1) {
    const plugin = index.plugins[offset]
    const path = `index.plugins[${offset}]`
    validateRegistration(plugin, path)
    if (coordinates.has(plugin.plugin.id)) duplicateCoordinates.add(plugin.plugin.id)
    if (manifestPaths.has(plugin.manifestPath)) duplicateManifestPaths.add(plugin.manifestPath)
    if (previousCoordinate !== undefined && compareText(plugin.plugin.id, previousCoordinate) < 0) {
      invalid(`${path}.plugin.id`, 'plugins must be sorted by plugin.id')
    }
    coordinates.add(plugin.plugin.id)
    manifestPaths.add(plugin.manifestPath)
    previousCoordinate = plugin.plugin.id
  }
  if (duplicateCoordinates.size || duplicateManifestPaths.size) {
    const details = [
      ...[...duplicateCoordinates].sort(compareText).map((value) => `coordinate ${JSON.stringify(value)}`),
      ...[...duplicateManifestPaths].sort(compareText).map((value) => `manifestPath ${JSON.stringify(value)}`),
    ]
    invalid('index.plugins', `duplicates ${details.join(' and ')}`)
  }
  return index
}

function contentLength(response) {
  const raw = response.headers?.get?.('content-length')
  if (raw === null || raw === undefined) return undefined
  if (!/^\d+$/.test(raw)) throw new RegistryQueryInputError('registry index has an invalid Content-Length header')
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) throw new RegistryQueryInputError('registry index has an invalid Content-Length header')
  return value
}

async function readBoundedChunks(iterable) {
  const chunks = []
  let length = 0
  for await (const value of iterable) {
    if (!(value instanceof Uint8Array)) throw new RegistryQueryInputError('registry response body yielded a non-byte chunk')
    length += value.byteLength
    if (length > MAX_INDEX_BYTES) throw new RegistryQueryInputError('registry index is too large')
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
  }
  return Buffer.concat(chunks, length)
}

async function readBoundedResponse(response) {
  const declaredLength = contentLength(response)
  if (declaredLength !== undefined && declaredLength > MAX_INDEX_BYTES) throw new RegistryQueryInputError('registry index is too large')
  const body = response.body
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader()
    try {
      return await readBoundedChunks({
        async *[Symbol.asyncIterator]() {
          while (true) {
            const { done, value } = await reader.read()
            if (done) return
            yield value
          }
        },
      })
    } catch (error) {
      await reader.cancel(error).catch(() => {})
      throw error
    }
  }
  if (body && typeof body[Symbol.asyncIterator] === 'function') return readBoundedChunks(body)
  throw new RegistryQueryInputError('registry response body is not stream-readable; bounded fallback refused')
}

function proxyDiagnostic() {
  const proxyVariables = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']
    .filter((name) => process.env[name])
  const proxyEnabled = process.execArgv.includes('--use-env-proxy') || process.env.NODE_USE_ENV_PROXY === '1'
  if (!proxyVariables.length || proxyEnabled) return ''
  const major = Number(process.versions.node.split('.')[0])
  return major >= 24
    ? `; proxy environment detected (${proxyVariables.join(', ')}). Retry Node 24+ with --use-env-proxy before this script`
    : `; proxy environment detected (${proxyVariables.join(', ')}), but Node ${major} fetch does not automatically use it. Use Node 24+ with --use-env-proxy, an approved --registry-url mirror, or --index`
}

export async function readRegistryIndex({ indexPath, registryUrl = DEFAULT_REGISTRY_URL, fetchImpl = fetch } = {}) {
  let bytes
  if (indexPath) {
    try {
      const absolute = resolve(indexPath)
      const metadata = await stat(absolute)
      if (metadata.size > MAX_INDEX_BYTES) throw new RegistryQueryInputError('registry index is too large')
      bytes = await readFile(absolute)
      if (bytes.byteLength > MAX_INDEX_BYTES) throw new RegistryQueryInputError('registry index is too large')
    } catch (error) {
      if (error instanceof RegistryQueryInputError) throw error
      throw new RegistryQueryInputError(`cannot read registry index ${resolve(indexPath)}: ${error.message}`, { cause: error })
    }
  } else {
    let response
    try {
      response = await fetchImpl(registryUrl, {
        headers: { accept: 'application/json', 'user-agent': 'dsh-plugin-write-registry-query' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      throw new RegistryQueryInputError(`registry query unavailable: ${error.message}${proxyDiagnostic()}`, { cause: error })
    }
    if (!response.ok) throw new RegistryQueryInputError(`registry query unavailable: HTTP ${response.status} ${response.statusText}`)
    try {
      bytes = await readBoundedResponse(response)
    } catch (error) {
      if (error instanceof RegistryQueryInputError) throw error
      throw new RegistryQueryInputError(`registry query unavailable while reading the response: ${error.message}${proxyDiagnostic()}`, { cause: error })
    }
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const index = validateIndex(JSON.parse(text))
    indexDigests.set(index, createHash('sha256').update(bytes).digest('hex'))
    return index
  } catch (error) {
    if (error instanceof RegistryQueryInputError) throw error
    throw new RegistryQueryInputError(`cannot parse registry index: ${error.message}`, { cause: error })
  }
}

function centralNames(plugin) {
  return {
    pluginNames: [...plugin.claims.pluginNames].sort(compareText),
    loaderIds: plugin.claims.loaderIds.map((claim) => claim.name).sort(compareText),
    services: plugin.claims.services.map((claim) => claim.name).sort(compareText),
    tools: plugin.claims.tools.map((claim) => claim.name).sort(compareText),
    commands: plugin.claims.commands.map((claim) => claim.name).sort(compareText),
    skills: plugin.claims.skills.map((claim) => claim.name).sort(compareText),
    skillProviders: plugin.claims.skillProviders.map((claim) => claim.name).sort(compareText),
    events: plugin.claims.events.map((claim) => claim.name).sort(compareText),
    settingsNamespaces: plugin.claims.settingsNamespaces.map((claim) => claim.name).sort(compareText),
    routes: plugin.claims.routes.map((claim) => `${claim.kind}\u0000${claim.path}`).sort(compareText),
  }
}

function localNames(manifest) {
  return {
    ...Object.fromEntries(requiredClaimKinds.filter((kind) => kind !== 'routes').map((kind) => [kind, [...manifest.names[kind]].sort(compareText)])),
    routes: manifest.names.routes.map((claim) => `${claim.kind}\u0000${claim.path}`).sort(compareText),
  }
}

function pluginSummary(plugin) {
  return {
    id: plugin.plugin.id,
    repository: plugin.plugin.repository,
    status: plugin.plugin.status,
    manifestPath: plugin.manifestPath,
    harness: plugin.compatibility.harness,
  }
}

function pushMatch(matches, plugin, severity, kind, claim, reason, context) {
  const existing = matches.find((match) => match.severity === severity && match.kind === kind && match.claim === claim && match.reason === reason)
  const registration = { ...pluginSummary(plugin), context }
  if (existing) existing.registrations.push(registration)
  else matches.push({ severity, kind, claim, reason, registrations: [registration] })
}

export function checkNamingAgainstIndex(manifest, index, { harnessVersion } = {}) {
  if (harnessVersion && !parseSemver(harnessVersion)) {
    throw new RegistryQueryInputError('--harness-version must be a semantic version such as 0.1.2-alpha.2')
  }
  validateIndex(index)
  const coordinate = manifest.plugin.coordinate
  const eligible = index.plugins.filter((plugin) => supportsHarnessVersion(plugin, harnessVersion))
  const registeredInRange = eligible.find((plugin) => plugin.plugin.id === coordinate)
  const registered = registeredInRange ?? index.plugins.find((plugin) => plugin.plugin.id === coordinate)
  const matches = []
  if (registered) {
    if (registered.plugin.package !== manifest.plugin.packageName) {
      pushMatch(matches, registered, 'error', 'registration', coordinate, 'registered package differs from the local naming declaration')
    }
    const local = localNames(manifest)
    const central = centralNames(registered)
    for (const kind of requiredClaimKinds) {
      if (JSON.stringify(local[kind]) !== JSON.stringify(central[kind])) {
        pushMatch(matches, registered, 'warning', kind, coordinate, 'the reviewed registration is stale relative to the local naming declaration')
      }
    }
  }

  for (const plugin of index.plugins) {
    if (plugin.plugin.id === coordinate) continue
    if (plugin.plugin.package === manifest.plugin.packageName) {
      pushMatch(matches, plugin, plugin.plugin.status === 'archived' ? 'notice' : 'warning', 'packages', manifest.plugin.packageName,
        'another reviewed coordinate declares the same package; package identity is independent of Harness runtime range')
    }
  }

  for (const plugin of eligible) {
    if (plugin.plugin.id === coordinate) continue
    const archived = plugin.plugin.status === 'archived'
    for (const name of manifest.names.pluginNames) {
      if (plugin.claims.pluginNames.includes(name)) {
        pushMatch(matches, plugin, 'notice', 'pluginNames', name,
          'plugin module names are indexed for discovery but are not global exclusive IDs')
      }
    }
    for (const name of manifest.names.loaderIds) {
      for (const claim of plugin.claims.loaderIds.filter((candidate) => candidate.name === name)) {
        pushMatch(matches, plugin, archived ? 'notice' : 'warning', 'loaderIds', name,
          'Loader composition, layer, and replacement intent must be compared in a full registration', claim)
      }
    }
    for (const kind of scopedKinds) {
      for (const name of manifest.names[kind]) {
        for (const claim of plugin.claims[kind].filter((candidate) => candidate.name === name)) {
          pushMatch(matches, plugin, archived ? 'notice' : 'warning', kind, name,
            'the local naming manifest has no runtime scope; review the registered scope before composing plugins', claim)
        }
      }
    }
    for (const name of manifest.names.skills) {
      for (const claim of plugin.claims.skills.filter((candidate) => candidate.name === name)) {
        pushMatch(matches, plugin, archived ? 'notice' : 'warning', 'skills', name,
          'Skill selection depends on scope, provider, rank, and local order', claim)
      }
    }
    for (const name of manifest.names.events) {
      for (const claim of plugin.claims.events.filter((candidate) => candidate.name === name)) {
        pushMatch(matches, plugin, 'notice', 'events', name,
          'events are shared channels; compare publisher roles and schemas instead of treating the name as exclusive', claim)
      }
    }
    for (const route of manifest.names.routes) {
      for (const claim of plugin.claims.routes.filter((candidate) => candidate.kind === route.kind && candidate.path === route.path)) {
        pushMatch(matches, plugin, archived ? 'notice' : 'warning', 'routes', `${route.kind} ${route.path}`,
          'the same route kind and path may collide in an overlapping router scope', claim)
      }
    }
  }
  for (const match of matches) {
    match.registrations.sort((left, right) => compareText(left.id, right.id) || compareText(left.manifestPath, right.manifestPath))
  }
  matches.sort((left, right) =>
    compareText(left.severity, right.severity) || compareText(left.kind, right.kind) || compareText(left.claim, right.claim),
  )
  return {
    status: 'checked',
    contract: REGISTRY_CONTRACT,
    indexSha256: indexDigests.get(index) ?? null,
    coordinate,
    harnessVersion: harnessVersion ?? null,
    registration: registered
      ? {
          ...pluginSummary(registered),
          appliesToHarnessVersion: harnessVersion ? registeredInRange !== undefined : null,
        }
      : null,
    matches,
    summary: {
      errors: matches.filter((match) => match.severity === 'error').length,
      warnings: matches.filter((match) => match.severity === 'warning').length,
      notices: matches.filter((match) => match.severity === 'notice').length,
    },
  }
}

export async function queryManifestFile({ manifestPath, indexPath, registryUrl, harnessVersion, fetchImpl } = {}) {
  const absolute = resolve(manifestPath)
  let manifest
  try {
    manifest = JSON.parse(await readFile(absolute, 'utf8'))
  } catch (error) {
    throw new RegistryQueryInputError(`cannot read naming manifest ${absolute}: ${error.message}`, { cause: error })
  }
  const policy = await loadNamingPolicy()
  const validation = validateNamingManifest(manifest, policy)
  if (!validation.valid) {
    throw new RegistryQueryInputError(`local naming validation failed: ${validation.errors.map((error) => `${error.path} [${error.code}] ${error.message}`).join('; ')}`)
  }
  const index = await readRegistryIndex({ indexPath, registryUrl, fetchImpl })
  return checkNamingAgainstIndex(manifest, index, { harnessVersion })
}

export function renderRegistryQuery(result, source) {
  const registration = result.registration
    ? `${result.registration.status} at ${result.registration.repository}${
        result.registration.appliesToHarnessVersion === false
          ? '; requested Harness version is outside the registered range'
          : ''
      }`
    : 'not present in the reviewed registry'
  const lines = [
    `Registry checked: ${result.coordinate} (${result.contract})`,
    `- Source: ${source}`,
    `- Index SHA-256: ${result.indexSha256 ?? 'unavailable for an in-memory index'}`,
    `- Harness version: ${result.harnessVersion ?? 'not supplied; all registered ranges were considered'}`,
    `- Registration: ${registration}`,
  ]
  if (!result.matches.length) lines.push('- No reviewed cross-plugin matches found. This is not a global uniqueness proof.')
  for (const match of result.matches) {
    lines.push(`- ${match.severity.toUpperCase()} ${match.kind} ${JSON.stringify(match.claim)}: ${match.reason}; registrations: ${match.registrations.map((entry) => entry.id).join(', ')}`)
  }
  return lines.join('\n')
}

function parseArgs(args) {
  const options = { format: 'text', strict: false, registryUrl: DEFAULT_REGISTRY_URL }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') return { help: true }
    if (argument === '--strict') {
      options.strict = true
      continue
    }
    if (!['--manifest', '--index', '--registry-url', '--harness-version', '--format'].includes(argument)) {
      throw new RegistryQueryInputError(`unknown argument: ${argument}`)
    }
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new RegistryQueryInputError(`${argument} requires a value`)
    const key = argument === '--manifest'
      ? 'manifestPath'
      : argument === '--index'
        ? 'indexPath'
        : argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    options[key] = value
  }
  if (!options.manifestPath) throw new RegistryQueryInputError('--manifest is required')
  if (!['text', 'json'].includes(options.format)) throw new RegistryQueryInputError('--format must be text or json')
  if (options.indexPath) options.registryUrl = undefined
  return options
}

function usage() {
  return [
    'Usage: node query-registry.mjs --manifest <dsh-plugin.naming.json> [--harness-version <semver>] [--registry-url <url> | --index <path>] [--format text|json] [--strict]',
    '',
    'Performs a read-only phase-two lookup against reviewed central registrations.',
    'No match is not a global uniqueness proof. Query failure is unknown, never available.',
  ].join('\n')
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) {
  let format = 'text'
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      console.log(usage())
    } else {
      format = options.format
      const result = await queryManifestFile(options)
      const source = options.indexPath ? resolve(options.indexPath) : options.registryUrl
      console.log(options.format === 'json' ? JSON.stringify({ ...result, source }, null, 2) : renderRegistryQuery(result, source))
      if (result.summary.errors > 0 || (options.strict && result.summary.warnings > 0)) process.exitCode = 1
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (format === 'json') console.error(JSON.stringify({ status: 'unavailable', error: message }))
    else {
      console.error(`Registry query unavailable: ${message}`)
      console.error(usage())
    }
    process.exitCode = 2
  }
}
