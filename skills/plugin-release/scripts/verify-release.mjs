#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

export function parseSemver(value) {
  if (typeof value !== 'string') return null
  const match = versionPattern.exec(value)
  if (!match) return null
  const identifiers = match[4]?.split('.') ?? []
  if (identifiers.some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0'))) {
    return null
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (![major, minor, patch].every(Number.isSafeInteger)) return null
  return {
    raw: value,
    major,
    minor,
    patch,
    prerelease: identifiers,
    build: match[5]?.split('.') ?? [],
  }
}

export function compareSemver(left, right) {
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] > right[field] ? 1 : -1
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1

  const count = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < count; index += 1) {
    const a = left.prerelease[index]
    const b = right.prerelease[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue
    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) {
      const normalizedA = a.replace(/^0+(?=\d)/, '')
      const normalizedB = b.replace(/^0+(?=\d)/, '')
      if (normalizedA.length !== normalizedB.length) return normalizedA.length > normalizedB.length ? 1 : -1
      return normalizedA > normalizedB ? 1 : -1
    }
    if (aNumeric) return -1
    if (bNumeric) return 1
    return a > b ? 1 : -1
  }
  return 0
}

function parseBoolean(value, name) {
  if (value === 'true' || value === true) return true
  if (value === 'false' || value === false) return false
  throw new Error(`${name} must be true or false`)
}

export function validateRelease(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('release input must be an object')
  const version = parseSemver(input.version)
  if (!version) throw new Error('version must be a valid semver without a leading v')
  if (input.releaseTag !== `v${input.version}`) {
    throw new Error(`release tag must be v${input.version}`)
  }

  const releasePrerelease = parseBoolean(input.releasePrerelease, 'releasePrerelease')
  const isPrerelease = version.prerelease.length > 0
  if (releasePrerelease !== isPrerelease) throw new Error('release prerelease state does not match version')

  if (typeof input.npmDistTag !== 'string' || !input.npmDistTag.trim()) {
    throw new Error('npmDistTag must be a non-empty string')
  }
  if (isPrerelease && input.npmDistTag === 'latest') {
    throw new Error('prerelease versions must not publish to latest')
  }
  if (!isPrerelease && input.npmDistTag !== 'latest') {
    throw new Error('stable versions must publish to latest')
  }

  if (!isPrerelease) {
    const currentLatest = parseSemver(input.currentLatest)
    if (!currentLatest) throw new Error('currentLatest must be provided as a valid semver for stable releases')
    if (compareSemver(version, currentLatest) < 0) {
      throw new Error(`stable version ${input.version} is lower than current latest ${input.currentLatest}`)
    }
  }

  return { version: input.version, releasePrerelease: isPrerelease, npmDistTag: input.npmDistTag }
}

function parseArguments(argv) {
  const input = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') return { help: true }
    const name = argument.startsWith('--') ? argument.slice(2) : null
    const optionNames = {
      version: 'version',
      'release-tag': 'releaseTag',
      'release-prerelease': 'releasePrerelease',
      'npm-dist-tag': 'npmDistTag',
      'current-latest': 'currentLatest',
    }
    const key = optionNames[name]
    if (!key) throw new Error(`unknown argument: ${argument}`)
    const value = argv[++index]
    if (value === undefined) throw new Error(`missing value for --${name}`)
    input[key] = value
  }
  return input
}

function usage() {
  return [
    'Usage: node verify-release.mjs --version <semver> --release-tag <vsemver>',
    '  --release-prerelease <true|false> --npm-dist-tag <tag> [--current-latest <semver>]',
  ].join('\n')
}

export function main(argv = process.argv.slice(2)) {
  try {
    const input = parseArguments(argv)
    if (input.help) {
      console.log(usage())
      return 0
    }
    const result = validateRelease(input)
    console.log(`Release semantics OK: ${result.version} -> ${result.npmDistTag}`)
    return 0
  } catch (error) {
    console.error(`Release semantics failed: ${error.message}`)
    console.error(usage())
    return 1
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main()
}
