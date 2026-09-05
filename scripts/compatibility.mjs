import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const policy = JSON.parse(readFileSync(new URL('../compatibility.json', import.meta.url), 'utf8'))

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
  }
  const recommended = hosts.filter(host => host.track === 'recommended')
  if (recommended.length !== 1 || recommended[0].version !== input.recommendedHost) throw new Error('Exactly one recommended host is required')
  if (/-(alpha|beta)\./.test(input.recommendedHost)) throw new Error('Alpha/beta hosts cannot be the ordinary-user recommendation')
  return hosts.map(host => host.version)
}

export function validatePackageCompatibility(pkg, input = policy) {
  const versions = validatePolicy(input)
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
  const overrides = pkg.pnpm?.overrides ?? {}
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
  for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
    if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) {
      const declared = range.split('||').map(value => value.trim())
      if (declared.length !== versions.length || versions.some(version => !declared.includes(version))) {
        throw new Error(`${name} peer range must enumerate the supported host targets`)
      }
    }
  }
  return versions
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const hosts = validatePackageCompatibility(pkg)
  if (process.argv[2] === '--github-output') console.log(`hosts=${JSON.stringify(hosts)}`)
  else if (process.argv.length === 2) console.log(`Compatibility targets: ${hosts.join(', ')}`)
  else throw new Error('Usage: node scripts/compatibility.mjs [--github-output]')
}
