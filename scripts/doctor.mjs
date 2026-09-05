#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { policy, serverRuntimePeers, validatePolicy } from './compatibility.mjs'

function manifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function locatePackage(name, from) {
  let directory = resolve(from)
  for (;;) {
    const candidate = join(directory, 'node_modules', name, 'package.json')
    if (existsSync(candidate)) return realpathSync(candidate)
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

/** Inspect manifests only; never execute packages or read credentials/configuration. */
export function inspectInstallation(hostRoot, profileRoot) {
  const allowed = validatePolicy(policy)
  const root = resolve(hostRoot)
  const own = join(root, 'package.json')
  const hostPath = existsSync(own) && manifest(own).name === '@deepseek-ai/dsh'
    ? realpathSync(own) : locatePackage('@deepseek-ai/dsh', root)
  if (!hostPath) throw new Error('Cannot locate @deepseek-ai/dsh; pass --host-root for the actual CLI or embedded Desktop package directory')
  const host = manifest(hostPath)
  const visited = new Set()
  const packages = []
  const sharedRuntimes = []
  const missing = []
  function walk(path) {
    path = realpathSync(path)
    if (visited.has(path)) return
    visited.add(path)
    const pkg = manifest(path)
    if (pkg.name === '@deepseek-ai/dsh' || pkg.name?.startsWith('@deepseek-ai/dsh-')) {
      packages.push({ name: pkg.name, version: pkg.version, path: dirname(path) })
    }
    if (pkg.name === '@deepseek-ai/cordis') sharedRuntimes.push({ name: pkg.name, path: dirname(path) })
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })) {
      const dependency = locatePackage(name, dirname(path))
      if (dependency) walk(dependency)
      else if ((name.startsWith('@deepseek-ai/dsh-') || name === '@deepseek-ai/cordis') && !(name in (pkg.optionalDependencies ?? {}))
          && pkg.peerDependenciesMeta?.[name]?.optional !== true) missing.push(name)
    }
  }
  walk(hostPath)
  let plugin
  if (profileRoot) {
    const path = locatePackage('@nanmicoder/dsh-agent-teams', resolve(profileRoot))
    if (!path) missing.push('@nanmicoder/dsh-agent-teams (profile)')
    else {
      const pkg = manifest(path)
      plugin = { version: pkg.version, path: dirname(path) }
      // Follow normal transitive requirements and optional resolved peers, then
      // check the server's actual value imports even when marked optional.
      walk(path)
      for (const name of serverRuntimePeers) {
        const dependency = locatePackage(name, dirname(path))
        if (dependency) walk(dependency)
        else missing.push(`${name} (plugin runtime)`)
      }
    }
  }
  const mixed = packages.filter(pkg => pkg.version !== host.version)
  const problems = []
  const policyPackage = manifest(new URL('../package.json', import.meta.url))
  if (plugin && plugin.version !== policyPackage.version) {
    problems.push(`Installed plugin ${plugin.version} differs from this policy's plugin ${policyPackage.version}; verify its own host compatibility`)
  }
  if (!allowed.includes(host.version)) problems.push(`Unsupported host ${host.version}; recommended target is ${policy.recommendedHost}`)
  if (mixed.length) problems.push(`${mixed.length} resolved DSH packages differ from host ${host.version}`)
  if (missing.length) problems.push(`Missing packages: ${[...new Set(missing)].join(', ')}`)
  const identities = new Map()
  for (const pkg of [...packages, ...sharedRuntimes]) {
    const paths = identities.get(pkg.name) ?? new Set()
    paths.add(pkg.path)
    identities.set(pkg.name, paths)
  }
  const duplicates = [...identities].filter(([, paths]) => paths.size > 1).map(([name]) => name)
  if (duplicates.length) problems.push(`Multiple resolved identities: ${duplicates.join(', ')}`)
  return {
    ok: problems.length === 0,
    host: { version: host.version, path: dirname(hostPath) },
    ...(plugin ? { plugin } : {}),
    checkedPackages: packages.length, supportedHosts: allowed,
    problems, packages,
    limits: ['Checks files resolved from the supplied roots; does not identify the running process or prove plugin behavior.'],
  }
}

// npm bin entries and macOS temporary directories may reach this module via
// symlinks; Node canonicalizes import.meta.url but preserves argv[1].
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    let hostRoot = process.cwd()
    let profileRoot
    let json = false
    for (let index = 2; index < process.argv.length; index++) {
      const arg = process.argv[index]
      if (arg === '--json') json = true
      else if (arg === '--host-root' || arg === '--profile-root') {
        const value = process.argv[++index]
        if (!value || value.startsWith('--')) throw new Error(`${arg} requires a directory`)
        if (arg === '--host-root') hostRoot = value
        else profileRoot = value
      } else throw new Error('Usage: dsh-agent-teams-doctor [--host-root dir] [--profile-root dir] [--json]')
    }
    const result = inspectInstallation(hostRoot, profileRoot)
    console.log(json ? JSON.stringify(result, null, 2) : [
      `Harness: ${result.host.version} (${result.host.path})`,
      `DSH package identities checked: ${result.checkedPackages}`,
      ...result.problems.map(problem => `FAIL: ${problem}`),
      result.ok ? 'Dependency inspection passed.' : 'Use one supported host version and a matching locked profile.',
      ...result.limits,
    ].join('\n'))
    if (!result.ok) process.exitCode = 1
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
