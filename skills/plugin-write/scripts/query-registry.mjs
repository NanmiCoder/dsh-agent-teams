#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadNamingPolicy, validateNamingManifest } from './validate-names.mjs'

export const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/oh-my-dsh/dsh-plugin-registry/main/registry/index.json'
export const REGISTRY_CONTRACT = 'dsh-plugin-registry/v2'

const MAX_INDEX_BYTES = 5 * 1024 * 1024
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const scopedKinds = ['services', 'tools', 'commands', 'skillProviders', 'settingsNamespaces']
const requiredClaimKinds = [
  'pluginNames',
  'loaderIds',
  ...scopedKinds,
  'skills',
  'events',
  'routes',
]

export class RegistryQueryInputError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'RegistryQueryInputError'
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSemver(value) {
  const match = semverPattern.exec(value)
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0
  if (!left.length) return 1
  if (!right.length) return -1
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1
    if (right[index] === undefined) return 1
    const leftNumber = /^\d+$/.test(left[index]) ? Number(left[index]) : undefined
    const rightNumber = /^\d+$/.test(right[index]) ? Number(right[index]) : undefined
    if (leftNumber !== undefined && rightNumber !== undefined && leftNumber !== rightNumber) {
      return leftNumber < rightNumber ? -1 : 1
    }
    if (leftNumber !== undefined && rightNumber === undefined) return -1
    if (leftNumber === undefined && rightNumber !== undefined) return 1
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1
  }
  return 0
}

function compareSemver(leftValue, rightValue) {
  const left = parseSemver(leftValue)
  const right = parseSemver(rightValue)
  if (!left || !right) throw new RegistryQueryInputError('registry contains an invalid Harness semantic version')
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

function supportsHarnessVersion(plugin, version) {
  if (!version) return true
  const range = plugin.compatibility.harness
  return compareSemver(range.min, version) <= 0 && (!range.maxExclusive || compareSemver(version, range.maxExclusive) < 0)
}

function validateIndex(index) {
  if (!isObject(index) || index.schemaVersion !== 2 || index.contract !== REGISTRY_CONTRACT || !Array.isArray(index.plugins)) {
    throw new RegistryQueryInputError(`registry index must use ${REGISTRY_CONTRACT}`)
  }
  for (let offset = 0; offset < index.plugins.length; offset += 1) {
    const plugin = index.plugins[offset]
    const path = `index.plugins[${offset}]`
    if (!isObject(plugin?.plugin) || typeof plugin.plugin.id !== 'string' || typeof plugin.plugin.repository !== 'string'
      || typeof plugin.plugin.package !== 'string' || typeof plugin.plugin.status !== 'string') {
      throw new RegistryQueryInputError(`${path}.plugin is invalid`)
    }
    if (!isObject(plugin.compatibility?.harness) || !parseSemver(plugin.compatibility.harness.min)
      || (plugin.compatibility.harness.maxExclusive !== undefined && !parseSemver(plugin.compatibility.harness.maxExclusive))) {
      throw new RegistryQueryInputError(`${path}.compatibility.harness is invalid`)
    }
    if (plugin.compatibility.harness.maxExclusive
      && compareSemver(plugin.compatibility.harness.min, plugin.compatibility.harness.maxExclusive) >= 0) {
      throw new RegistryQueryInputError(`${path}.compatibility.harness is empty`)
    }
    if (!isObject(plugin.claims)) throw new RegistryQueryInputError(`${path}.claims is invalid`)
    for (const kind of requiredClaimKinds) {
      if (!Array.isArray(plugin.claims[kind])) throw new RegistryQueryInputError(`${path}.claims.${kind} must be an array`)
    }
    if (!plugin.claims.loaderIds.every((claim) => isObject(claim) && typeof claim.name === 'string')) {
      throw new RegistryQueryInputError(`${path}.claims.loaderIds is invalid`)
    }
    for (const kind of [...scopedKinds, 'skills', 'events']) {
      if (!plugin.claims[kind].every((claim) => isObject(claim) && typeof claim.name === 'string')) {
        throw new RegistryQueryInputError(`${path}.claims.${kind} is invalid`)
      }
    }
    if (!plugin.claims.routes.every((claim) => isObject(claim) && typeof claim.kind === 'string' && typeof claim.path === 'string')) {
      throw new RegistryQueryInputError(`${path}.claims.routes is invalid`)
    }
  }
  return index
}

async function readBoundedResponse(response) {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_INDEX_BYTES) throw new RegistryQueryInputError('registry index is too large')
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_INDEX_BYTES) throw new RegistryQueryInputError('registry index is too large')
  return text
}

export async function readRegistryIndex({ indexPath, registryUrl = DEFAULT_REGISTRY_URL, fetchImpl = fetch } = {}) {
  let text
  if (indexPath) {
    try {
      text = await readFile(resolve(indexPath), 'utf8')
    } catch (error) {
      throw new RegistryQueryInputError(`cannot read registry index ${resolve(indexPath)}: ${error.message}`, { cause: error })
    }
  } else {
    let response
    try {
      response = await fetchImpl(registryUrl, {
        headers: { accept: 'application/json', 'user-agent': 'dsh-plugin-write-registry-query' },
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      throw new RegistryQueryInputError(`registry query unavailable: ${error.message}`, { cause: error })
    }
    if (!response.ok) throw new RegistryQueryInputError(`registry query unavailable: HTTP ${response.status} ${response.statusText}`)
    text = await readBoundedResponse(response)
  }
  try {
    return validateIndex(JSON.parse(text))
  } catch (error) {
    if (error instanceof RegistryQueryInputError) throw error
    throw new RegistryQueryInputError(`cannot parse registry index: ${error.message}`, { cause: error })
  }
}

function centralNames(plugin) {
  return {
    pluginNames: [...plugin.claims.pluginNames].sort(),
    loaderIds: plugin.claims.loaderIds.map((claim) => claim.name).sort(),
    services: plugin.claims.services.map((claim) => claim.name).sort(),
    tools: plugin.claims.tools.map((claim) => claim.name).sort(),
    commands: plugin.claims.commands.map((claim) => claim.name).sort(),
    skills: plugin.claims.skills.map((claim) => claim.name).sort(),
    skillProviders: plugin.claims.skillProviders.map((claim) => claim.name).sort(),
    events: plugin.claims.events.map((claim) => claim.name).sort(),
    settingsNamespaces: plugin.claims.settingsNamespaces.map((claim) => claim.name).sort(),
    routes: plugin.claims.routes.map((claim) => `${claim.kind}\u0000${claim.path}`).sort(),
  }
}

function localNames(manifest) {
  return {
    ...Object.fromEntries(requiredClaimKinds.filter((kind) => kind !== 'routes').map((kind) => [kind, [...manifest.names[kind]].sort()])),
    routes: manifest.names.routes.map((claim) => `${claim.kind}\u0000${claim.path}`).sort(),
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
  const registered = eligible.find((plugin) => plugin.plugin.id === coordinate)
    ?? index.plugins.find((plugin) => plugin.plugin.id === coordinate)
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
  matches.sort((left, right) =>
    left.severity.localeCompare(right.severity) || left.kind.localeCompare(right.kind) || left.claim.localeCompare(right.claim),
  )
  return {
    status: 'checked',
    contract: REGISTRY_CONTRACT,
    coordinate,
    harnessVersion: harnessVersion ?? null,
    registration: registered ? pluginSummary(registered) : null,
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
  const lines = [
    `Registry checked: ${result.coordinate} (${result.contract})`,
    `- Source: ${source}`,
    `- Harness version: ${result.harnessVersion ?? 'not supplied; all registered ranges were considered'}`,
    `- Registration: ${result.registration ? `${result.registration.status} at ${result.registration.repository}` : 'not present in the reviewed registry'}`,
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
