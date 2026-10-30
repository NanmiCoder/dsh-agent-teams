import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const policy = JSON.parse(readFileSync(new URL('../compatibility.json', import.meta.url), 'utf8'))
// JSON is valid YAML and keeps this shipped diagnostic dependency-free.
export const workspacePolicy = JSON.parse(readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8'))

// Contract consumed by the published server entry and client module table.
// Keeping this independent from package.json catches accidentally deleted peers.
export const requiredHostPeers = [
  '@deepseek-ai/cordis', '@deepseek-ai/schemastery', 'react',
  ...[
    'agent', 'api-session-controller', 'client-connection', 'client-locale',
    'client-store', 'client-ui-chat', 'client-ui-conversation', 'client-ui-layout',
    'client-ui-model-selection', 'client-ui-primitives', 'client-ui-renderer',
    'client-ui-session', 'client-ui-slots', 'commands', 'llm', 'session',
    'session-projection', 'subagent', 'system-prompt', 'tools', 'util-values',
  ].map(name => `@deepseek-ai/dsh-${name}`),
]

// These are value imports of the server entry, so optional-peer metadata does
// not make an unresolved installation executable. Client services can instead
// be supplied by the host's browser module table.
export const serverRuntimePeers = [
  '@deepseek-ai/schemastery', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-subagent', '@deepseek-ai/dsh-tools',
]

const isDshPackage = name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')

/** semver precedence for the x.y.z[-alpha|beta|rc.N] versions DSH publishes; undefined for anything else. */
export function compareHostVersions(left, right) {
  const parse = version => {
    const match = typeof version === 'string' && /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(version)
    return match && { core: match.slice(1, 4).map(Number), tag: match[4], number: Number(match[5]) }
  }
  const a = parse(left), b = parse(right)
  if (!a || !b) return undefined
  for (let index = 0; index < 3; index++) if (a.core[index] !== b.core[index]) return Math.sign(a.core[index] - b.core[index])
  if (a.tag === b.tag) return a.tag ? Math.sign(a.number - b.number) : 0
  if (!a.tag || !b.tag) return a.tag ? -1 : 1
  return a.tag < b.tag ? -1 : 1
}

/**
 * Oldest declared host, source candidates included. Every later host may install the plugin, including
 * hosts released after this package. Removing the oldest tested host therefore raises the requirement.
 */
export function minimumHost(input = policy) {
  return declaredHostVersions(input).sort(compareHostVersions)[0]
}

/**
 * The published install requirement, written to `engines.dsh`. The official installer reads that field
 * before peers (since 0.2.1-alpha.4) and evaluates it with includePrerelease, so later RC/alpha hosts pass.
 * supportedHosts is the tested CI matrix, not an allowlist: enumerating it blocked every new host release.
 */
export function hostRequirement(input = policy) {
  return `>=${minimumHost(input)}`
}

/**
 * Every DSH peer is `*`. Older installers that read peers (0.1.7-rc.1 to 0.2.1-alpha.3) use includePrerelease,
 * but npm checks peers without it: `>=0.1.2-alpha.2` rejects 0.2.1-rc.3 there, while npm accepts `*` explicitly.
 * Host packages are still listed so loaders resolve them from the host installation.
 */
export const HOST_PEER_RANGE = '*'

export function validatePolicy(input) {
  if (input.schemaVersion !== 1 || input.previewTag !== 'next') throw new Error('Unsupported compatibility policy')
  const hosts = input.supportedHosts
  if (!Array.isArray(hosts) || hosts.length === 0) throw new Error('supportedHosts must list exact tested host targets')
  const versions = new Set()
  for (const host of hosts) {
    if (typeof host.version !== 'string' || !/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(host.version)
        || host.version.trim() !== host.version || versions.has(host.version)
        || !['recommended', 'preview', 'legacy'].includes(host.track)) {
      throw new Error('Host targets must be unique exact versions with an explicit track')
    }
    versions.add(host.version)
    if (host.platforms !== undefined && (!Array.isArray(host.platforms)
        || !host.platforms.includes('ubuntu-latest')
        || new Set(host.platforms).size !== host.platforms.length
        || host.platforms.some(platform => !['ubuntu-latest', 'windows-latest'].includes(platform)))) {
      throw new Error('Host platforms must include Ubuntu and only unique supported CI platforms')
    }
    if (host.legacyDirectInstallReason !== undefined && (typeof host.legacyDirectInstallReason !== 'string'
        || !host.legacyDirectInstallReason.trim())) {
      throw new Error('Legacy direct-install coverage requires an explicit reason')
    }
  }
  const recommended = hosts.filter(host => host.track === 'recommended')
  if (recommended.length !== 1 || recommended[0].version !== input.recommendedHost) throw new Error('Exactly one recommended host is required')
  if (/-(alpha|beta)\./.test(input.recommendedHost)) throw new Error('Alpha/beta hosts cannot be the ordinary-user recommendation')
  const candidates = input.sourceCandidates ?? []
  if (!Array.isArray(candidates)) throw new Error('sourceCandidates must be an array')
  for (const candidate of candidates) {
    if (typeof candidate.version !== 'string' || candidate.version.trim() !== candidate.version
        || !/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(candidate.version)
        || versions.has(candidate.version)
        || candidate.repository !== 'https://github.com/deepseek-ai/deepseek-harness'
        || typeof candidate.commit !== 'string' || candidate.commit.length !== 40 || !/^[a-f0-9]{40}$/.test(candidate.commit)
        || typeof candidate.evidence !== 'string' || !candidate.evidence.startsWith('docs/')) {
      throw new Error('Source candidates require a unique exact version, official repository, commit and evidence')
    }
    versions.add(candidate.version)
  }
  // Only published targets enter the npm download/CI matrix.
  return hosts.map(host => host.version)
}

export function declaredHostVersions(input = policy) {
  return [...validatePolicy(input), ...(input.sourceCandidates ?? []).map(candidate => candidate.version)]
}

/** Explicit maintenance operation: derive engines.dsh and DSH peers from the oldest declared host. */
export function generateHostPeers(pkg, input = policy, workspace = workspacePolicy) {
  const generated = structuredClone(pkg)
  // A deleted import declaration is a different defect; do not hide it during synchronization.
  for (const name of requiredHostPeers) {
    if (typeof generated.peerDependencies?.[name] !== 'string') throw new Error(`Missing required host peer declaration: ${name}`)
  }
  for (const name of Object.keys(generated.peerDependencies)) {
    if (isDshPackage(name)) generated.peerDependencies[name] = HOST_PEER_RANGE
  }
  generated.engines = { ...generated.engines, dsh: hostRequirement(input) }
  validatePackageCompatibility(generated, input, workspace)
  return generated
}

export function validatePackageCompatibility(pkg, input = policy, workspace = workspacePolicy) {
  const versions = validatePolicy(input)
  const requirement = hostRequirement(input)
  for (const name of requiredHostPeers) {
    if (typeof pkg.peerDependencies?.[name] !== 'string' || pkg.peerDependencies[name].trim() === '') {
      throw new Error(`Missing required host peer declaration: ${name}`)
    }
  }
  const baseline = pkg.devDependencies?.['@deepseek-ai/dsh']
  if (!versions.includes(baseline)) throw new Error('Development host must be an exact supported target')
  for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
    if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) {
      if (version !== baseline) throw new Error(`${name} must match the exact development host ${baseline}`)
    }
  }
  if (pkg.pnpm?.overrides) throw new Error('Move pnpm.overrides to pnpm-workspace.yaml for pnpm 11')
  const overrides = workspace.overrides ?? {}
  const dshNames = Object.keys(pkg.devDependencies ?? {}).filter(name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
  for (const name of dshNames) {
    if (overrides[name] !== baseline) throw new Error(`${name} requires an exact pnpm override to ${baseline}`)
  }
  for (const [name, version] of Object.entries(overrides)) {
    if (name.includes('@deepseek-ai/dsh')) {
      if (!/^@deepseek-ai\/dsh(?:-[a-z0-9-]+)?$/.test(name)) {
        throw new Error(`${name} override must use a bare DSH package name, without ranges or parent selectors`)
      }
      if (version !== baseline) throw new Error(`${name} override must match the development host ${baseline}`)
    }
  }
  // An upper bound or version list here rejects every host released after the plugin.
  if (pkg.engines?.dsh !== requirement) {
    throw new Error(`engines.dsh must be ${requirement}; an upper bound or version list rejects future hosts`)
  }
  for (const [name, declared] of Object.entries(pkg.peerDependencies ?? {})) {
    if (isDshPackage(name) && declared !== HOST_PEER_RANGE) {
      throw new Error(`${name} peer range must be ${HOST_PEER_RANGE}; ranges reject prerelease hosts under npm or future hosts`)
    }
  }
  return versions
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  if (process.argv.length === 3 && process.argv[2] === '--write-peers') {
    const generated = generateHostPeers(pkg)
    if (JSON.stringify(generated) !== JSON.stringify(pkg)) {
      // Keep the manifest ASCII-only, as checked in (the author name is \u-escaped).
      const text = JSON.stringify(generated, null, 2).replace(/[\u0080-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
      writeFileSync(new URL('../package.json', import.meta.url), text + '\n')
    }
    console.log(`Generated engines.dsh ${hostRequirement()} and DSH peers ${HOST_PEER_RANGE} from compatibility.json; tested targets unchanged.`)
    process.exit(0)
  }
  const hosts = validatePackageCompatibility(pkg)
  if (process.argv[2] === '--github-output') console.log(`hosts=${JSON.stringify(hosts)}`)
  else if (process.argv.length === 2) console.log(`Compatibility targets: ${hosts.join(', ')}`)
  else throw new Error('Usage: node scripts/compatibility.mjs [--github-output | --write-peers]')
}
