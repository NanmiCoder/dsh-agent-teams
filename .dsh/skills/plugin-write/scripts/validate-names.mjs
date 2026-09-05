#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_POLICY_FILE = resolve(scriptDir, '..', 'references', 'naming-policy.v1.json')

const ROOT_KEYS = new Set(['$schema', 'schemaVersion', 'policy', 'plugin', 'names'])
const PLUGIN_KEYS = new Set(['namespace', 'name', 'coordinate', 'packageName'])
const SURFACE_NAMES = [
  'pluginNames',
  'loaderIds',
  'services',
  'tools',
  'commands',
  'skills',
  'skillProviders',
  'events',
  'settingsNamespaces',
  'routes',
]
const NON_EMPTY_SURFACES = new Set(['pluginNames', 'loaderIds'])

export class NamingInputError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'NamingInputError'
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function addError(errors, path, code, message) {
  errors.push({ path, code, message })
}

function validateKeys(value, allowed, required, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, 'type', 'must be an object')
    return false
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addError(errors, `${path}.${key}`, 'unknown-property', 'is not allowed')
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) addError(errors, `${path}.${key}`, 'required', 'is required')
  }
  return true
}

function validatePolicyShape(policy, source) {
  if (!isObject(policy)) throw new NamingInputError(`Naming policy must be an object: ${source}`)
  if (typeof policy.id !== 'string' || !policy.id) throw new NamingInputError(`Naming policy has no id: ${source}`)
  if (!Number.isInteger(policy.schemaVersion)) {
    throw new NamingInputError(`Naming policy has an invalid schemaVersion: ${source}`)
  }
  if (!isObject(policy.surfaces)) throw new NamingInputError(`Naming policy has no surfaces: ${source}`)
  for (const surface of ['namespace', 'pluginName', 'packageName', ...SURFACE_NAMES]) {
    const rule = policy.surfaces[surface]
    if (!isObject(rule) || typeof rule.pattern !== 'string'
      || (rule.maxLength !== undefined && !Number.isInteger(rule.maxLength))
      || (rule.recommendedPattern !== undefined && typeof rule.recommendedPattern !== 'string')
      || (rule.recommendedMaxLength !== undefined && !Number.isInteger(rule.recommendedMaxLength))) {
      throw new NamingInputError(`Naming policy has an invalid ${surface} rule: ${source}`)
    }
    try {
      new RegExp(rule.pattern, 'u')
      if (rule.recommendedPattern !== undefined) new RegExp(rule.recommendedPattern, 'u')
    } catch (error) {
      throw new NamingInputError(`Naming policy has an invalid ${surface} regex: ${error.message}`, { cause: error })
    }
  }
  if (!isObject(policy.collisionSemantics)) {
    throw new NamingInputError(`Naming policy has no collisionSemantics: ${source}`)
  }
  for (const surface of SURFACE_NAMES) {
    if (typeof policy.collisionSemantics[surface] !== 'string') {
      throw new NamingInputError(`Naming policy has no collision semantics for ${surface}: ${source}`)
    }
  }
}

export async function loadNamingPolicy(policyPath = DEFAULT_POLICY_FILE) {
  const absolute = resolve(policyPath)
  let text
  try {
    text = await readFile(absolute, 'utf8')
  } catch (error) {
    throw new NamingInputError(`Cannot read naming policy ${absolute}: ${error.message}`, { cause: error })
  }
  let policy
  try {
    policy = JSON.parse(text)
  } catch (error) {
    throw new NamingInputError(`Cannot parse naming policy ${absolute}: ${error.message}`, { cause: error })
  }
  validatePolicyShape(policy, absolute)
  return policy
}

function validateString(value, rule, path, errors) {
  if (typeof value !== 'string') {
    addError(errors, path, 'type', 'must be a string')
    return false
  }
  if (rule.maxLength !== undefined && value.length > rule.maxLength) {
    addError(errors, path, 'max-length', `must be at most ${rule.maxLength} characters`)
  }
  if (!new RegExp(rule.pattern, 'u').test(value)) {
    addError(errors, path, 'pattern', `must match ${rule.pattern}`)
    return false
  }
  return true
}

function validateRecommendation(value, rule, path, warnings) {
  if (typeof value !== 'string') return
  if (rule.recommendedMaxLength !== undefined && value.length > rule.recommendedMaxLength) {
    addError(warnings, path, 'recommended-max-length', `should be at most ${rule.recommendedMaxLength} characters`)
  }
  if (rule.recommendedPattern !== undefined && !new RegExp(rule.recommendedPattern, 'u').test(value)) {
    addError(warnings, path, 'recommended-pattern', `should match ${rule.recommendedPattern}`)
  }
}

function kebabToCamel(value) {
  const parts = value.split('-')
  return parts[0] + parts.slice(1).map((part) => part[0].toUpperCase() + part.slice(1)).join('')
}

function hasDelimitedPrefix(value, base, separator) {
  return value === base || value.startsWith(`${base}${separator}`)
}

function hasCamelPrefix(value, base) {
  if (value === base) return true
  return value.startsWith(base) && /^[A-Z0-9]/u.test(value.slice(base.length, base.length + 1))
}

function isReservedNamespace(namespace, prefixes) {
  return prefixes.some((prefix) => namespace === prefix || namespace.startsWith(`${prefix}-`))
}

function validateSurfaceList(names, surface, policy, errors, warnings) {
  const path = `$.names.${surface}`
  const values = names[surface]
  if (!Array.isArray(values)) {
    addError(errors, path, 'type', 'must be an array')
    return []
  }
  if (NON_EMPTY_SURFACES.has(surface) && values.length === 0) {
    addError(errors, path, 'min-items', 'must declare at least one value')
  }
  const seen = new Set()
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    const itemPath = `${path}[${index}]`
    let duplicateKey = value
    if (surface === 'routes') {
      const routeOk = validateKeys(
        value,
        new Set(['kind', 'path']),
        ['kind', 'path'],
        itemPath,
        errors,
      )
      if (!routeOk) continue
      if (!['exact', 'prefix', 'upgrade'].includes(value.kind)) {
        addError(errors, `${itemPath}.kind`, 'enum', 'must be exact, prefix, or upgrade')
      }
      validateString(value.path, policy.surfaces.routes, `${itemPath}.path`, errors)
      validateRecommendation(value.path, policy.surfaces.routes, `${itemPath}.path`, warnings)
      duplicateKey = `${value.kind}:${value.path}`
    } else {
      validateString(value, policy.surfaces[surface], itemPath, errors)
      validateRecommendation(value, policy.surfaces[surface], itemPath, warnings)
    }
    if (typeof duplicateKey === 'string') {
      if (seen.has(duplicateKey)) addError(errors, itemPath, 'duplicate', `duplicates ${JSON.stringify(duplicateKey)}`)
      seen.add(duplicateKey)
    }
  }
  return values
}

function validateOwnership(values, surface, bases, policy, errors, warnings) {
  const path = `$.names.${surface}`
  const reserved = new Set(policy.reservedExactNames?.[surface] ?? [])
  const knownBuiltIns = new Set(policy.knownBuiltInExactNames?.[surface] ?? [])
  for (let index = 0; index < values.length; index += 1) {
    const declared = values[index]
    const value = surface === 'routes' && isObject(declared) ? declared.path : declared
    if (typeof value !== 'string') continue
    const itemPath = surface === 'routes' ? `${path}[${index}].path` : `${path}[${index}]`
    if (reserved.has(value)) addError(errors, itemPath, 'reserved-name', `${JSON.stringify(value)} is reserved`)
    if (knownBuiltIns.has(value)) {
      addError(warnings, itemPath, 'known-built-in', `${JSON.stringify(value)} is built into the verified Harness baseline`)
    }

    if (surface === 'pluginNames') continue

    let owned = true
    if (surface === 'services') owned = hasCamelPrefix(value, bases.camel)
    else if (surface === 'tools') owned = hasDelimitedPrefix(value, bases.snake, '_')
    else if (surface === 'events') owned = value.startsWith(`${bases.kebab}/`)
    else if (surface === 'routes') owned = value === bases.route || value.startsWith(`${bases.route}/`)
    else owned = hasDelimitedPrefix(value, bases.kebab, '-')

    if (!owned) {
      const expected = surface === 'services'
        ? bases.camel
        : surface === 'tools'
          ? bases.snake
          : surface === 'routes'
            ? bases.route
            : bases.kebab
      addError(warnings, itemPath, 'recommended-prefix', `does not use the collision-resistant prefix ${JSON.stringify(expected)}`)
    }
  }
}

export function validateNamingManifest(manifest, policy) {
  validatePolicyShape(policy, '<memory>')
  const errors = []
  const warnings = []
  const rootOk = validateKeys(manifest, ROOT_KEYS, ['schemaVersion', 'policy', 'plugin', 'names'], '$', errors)
  if (!rootOk) return { valid: false, errors, warnings, coordinate: undefined, declarationCount: 0 }

  if (manifest.schemaVersion !== policy.schemaVersion) {
    addError(errors, '$.schemaVersion', 'schema-version', `must equal ${policy.schemaVersion}`)
  }
  if (manifest.policy !== policy.id) {
    addError(errors, '$.policy', 'policy-id', `must equal ${JSON.stringify(policy.id)}`)
  }
  if (Object.hasOwn(manifest, '$schema') && typeof manifest.$schema !== 'string') {
    addError(errors, '$.$schema', 'type', 'must be a string')
  } else if (manifest.$schema === '') {
    addError(errors, '$.$schema', 'min-length', 'must not be empty')
  }

  const pluginOk = validateKeys(
    manifest.plugin,
    PLUGIN_KEYS,
    ['namespace', 'name', 'coordinate', 'packageName'],
    '$.plugin',
    errors,
  )
  let coordinate
  let bases
  if (pluginOk) {
    const namespaceOk = validateString(
      manifest.plugin.namespace,
      policy.surfaces.namespace,
      '$.plugin.namespace',
      errors,
    )
    const nameOk = validateString(
      manifest.plugin.name,
      policy.surfaces.pluginName,
      '$.plugin.name',
      errors,
    )
    if (namespaceOk && isReservedNamespace(manifest.plugin.namespace, policy.reservedNamespacePrefixes ?? [])) {
      addError(warnings, '$.plugin.namespace', 'reserved-namespace', 'resembles a publisher namespace reserved by community convention')
    }
    if (namespaceOk && nameOk) {
      const kebab = `${manifest.plugin.namespace}-${manifest.plugin.name}`
      coordinate = `${manifest.plugin.namespace}/${manifest.plugin.name}`
      bases = {
        kebab,
        snake: kebab.replaceAll('-', '_'),
        camel: kebabToCamel(kebab),
        route: `/api/plugins/${kebab}`,
      }
      if (manifest.plugin.coordinate !== coordinate) {
        addError(errors, '$.plugin.coordinate', 'coordinate-mismatch', `must equal ${JSON.stringify(coordinate)}`)
      }
    } else if (typeof manifest.plugin.coordinate !== 'string') {
      addError(errors, '$.plugin.coordinate', 'type', 'must be a string')
    }
    validateString(manifest.plugin.packageName, policy.surfaces.packageName, '$.plugin.packageName', errors)
    validateRecommendation(manifest.plugin.packageName, policy.surfaces.packageName, '$.plugin.packageName', warnings)
  }

  const namesOk = validateKeys(
    manifest.names,
    new Set(SURFACE_NAMES),
    SURFACE_NAMES,
    '$.names',
    errors,
  )
  let declarationCount = 0
  if (namesOk) {
    for (const surface of SURFACE_NAMES) {
      const values = validateSurfaceList(manifest.names, surface, policy, errors, warnings)
      declarationCount += values.length
      if (bases) validateOwnership(values, surface, bases, policy, errors, warnings)
    }
  }

  return { valid: errors.length === 0, errors, warnings, coordinate, declarationCount }
}

export async function validateManifestFile({ manifestPath, policyPath = DEFAULT_POLICY_FILE }) {
  const absoluteManifest = resolve(manifestPath)
  let text
  try {
    text = await readFile(absoluteManifest, 'utf8')
  } catch (error) {
    throw new NamingInputError(`Cannot read naming manifest ${absoluteManifest}: ${error.message}`, { cause: error })
  }
  let manifest
  try {
    manifest = JSON.parse(text)
  } catch (error) {
    throw new NamingInputError(`Cannot parse naming manifest ${absoluteManifest}: ${error.message}`, { cause: error })
  }
  const policy = await loadNamingPolicy(policyPath)
  return { ...validateNamingManifest(manifest, policy), manifestPath: absoluteManifest, policy: policy.id }
}

export function renderText(result) {
  const strictFailure = result.strict === true && result.warnings.length > 0
  const lines = []
  if (result.valid && !strictFailure) {
    lines.push(`Naming compatible: ${result.coordinate} (${result.declarationCount} declarations, ${result.policy})`)
  } else if (result.valid) {
    lines.push(`Strict naming validation failed (${result.warnings.length} recommendations):`)
  } else {
    lines.push(`Naming validation failed (${result.errors.length} errors):`)
  }
  for (const error of result.errors) lines.push(`- ERROR ${error.path} [${error.code}] ${error.message}`)
  for (const warning of result.warnings) lines.push(`- WARN ${warning.path} [${warning.code}] ${warning.message}`)
  return lines.join('\n')
}

function usage() {
  return [
    'Usage: node validate-names.mjs --manifest <path> [--policy <path>] [--format text|json] [--strict]',
    '',
    'Validates official compatibility and community collision recommendations without network access or file writes.',
  ].join('\n')
}

function parseArgs(args) {
  const options = { format: 'text', strict: false }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') return { help: true }
    if (argument === '--strict') {
      options.strict = true
      continue
    }
    if (argument === '--manifest' || argument === '--policy' || argument === '--format') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) throw new NamingInputError(`${argument} requires a value`)
      options[argument.slice(2)] = value
      index += 1
      continue
    }
    throw new NamingInputError(`Unknown argument: ${argument}`)
  }
  if (!options.manifest) throw new NamingInputError('--manifest is required')
  if (!['text', 'json'].includes(options.format)) throw new NamingInputError('--format must be text or json')
  return options
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      console.log(usage())
    } else {
      const result = await validateManifestFile({
        manifestPath: options.manifest,
        policyPath: options.policy,
      })
      const output = {
        ...result,
        strict: options.strict,
        strictValid: result.valid && (!options.strict || result.warnings.length === 0),
      }
      console.log(options.format === 'json' ? JSON.stringify(output, null, 2) : renderText(output))
      if (!output.strictValid) process.exitCode = 1
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Naming input error: ${message}`)
    console.error(usage())
    process.exitCode = 2
  }
}
