#!/usr/bin/env node
/**
 * Materialize two published @deepseek-ai/dsh versions for an npm-mode audit.
 *
 * Usage: node materialize-npm.mjs <versionA> <versionB> <out-dir> [--packages name1,name2] [--no-github]
 *
 * Versions accept npm versions (0.1.2-alpha.2), dsh tag spellings (dsh-v0.1.2-alpha.2),
 * or dist-tags (alpha, latest, next). Installs the CLI dependency closure (plus any
 * supplement packages, default: the SQLite persistence backend) into <out-dir>/a and
 * /b with scripts disabled, then emits a manifest diff and GitHub commit enrichment
 * when the repository is public. Prints a stats JSON to stdout; exits 1 with the
 * published version list when a requested version is not on the registry.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const CLI = '@deepseek-ai/dsh'
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const DEFAULT_SUPPLEMENTS = ['@deepseek-ai/dsh-session-persistence-sqlite']
const args = process.argv.slice(2)
const [va, vb, out] = args.filter((a) => !a.startsWith('--'))
if (!va || !vb || !out) {
  console.error('Usage: node materialize-npm.mjs <versionA> <versionB> <out-dir> [--packages name1,name2] [--no-github]')
  process.exit(2)
}
function flagValue(name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const supplements = flagValue('--packages')?.split(',') ?? DEFAULT_SUPPLEMENTS
const useGithub = !args.includes('--no-github')

/** dsh-v0.1.2-alpha.2 -> 0.1.2alpha2 (report-directory naming). */
function normalizeTag(tag) {
  const m = tag.match(/^(?:dsh-)?v?(\d+\.\d+\.\d+)(?:-(.+))?$/)
  return m ? m[1] + (m[2] ? m[2].replace(/\./g, '') : '') : tag
}

function npm(...a) {
  const commandArgs = [...a, '--loglevel=error']
  if (process.platform === 'win32' && commandArgs.some((arg) => /[&|<>^()%!"`\r\n]/.test(arg))) {
    throw new Error('npm arguments contain unsupported Windows shell characters')
  }
  return execFileSync(NPM, commandArgs, {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })
}

/** Convert GitHub-style dsh-v tags to registry versions while preserving dist-tags. */
function registrySpec(spec) {
  return spec.replace(/^dsh-/, '').replace(/^v(?=\d)/, '')
}

/** Resolve a spec (version or dist-tag) against the registry; null when absent. */
function resolve(spec) {
  try {
    return { spec, resolved: JSON.parse(npm('view', `${CLI}@${registrySpec(spec)}`, 'version', '--json')) }
  } catch {
    return { spec, resolved: null }
  }
}
const published = JSON.parse(npm('view', CLI, 'versions', '--json'))
const distTags = JSON.parse(npm('view', CLI, 'dist-tags', '--json'))
const repository = npm('view', CLI, 'repository.url').trim().replace(/^git\+|\.git$/g, '')
const [a, b] = [resolve(va), resolve(vb)]
const missing = [a, b].filter((r) => !r.resolved)
if (missing.length) {
  console.log(JSON.stringify({ error: 'requested version(s) not published', requested: missing.map((m) => m.spec), published, distTags }, null, 2))
  process.exit(1)
}

function resolvePackageVersion(pkg, version) {
  try {
    return JSON.parse(npm('view', `${pkg}@${version}`, 'version', '--json'))
  } catch {
    return null
  }
}

const supplementsResolved = supplements.map((pkg) => ({
  pkg,
  resolvedA: resolvePackageVersion(pkg, a.resolved),
  resolvedB: resolvePackageVersion(pkg, b.resolved),
}))

/** Install one root: CLI closure plus the supplements available for that side. */
function materialize(root, version, side) {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-upgrade-audit-root', private: true }, null, 2) + '\n')
  const specs = [
    `${CLI}@${version}`,
    ...supplementsResolved
      .map((supplement) => ({ pkg: supplement.pkg, resolved: supplement[side] }))
      .filter((supplement) => supplement.resolved)
      .map((supplement) => `${supplement.pkg}@${supplement.resolved}`),
  ]
  const installArgs = ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error', ...specs]
  if (process.platform === 'win32' && installArgs.some((arg) => /[&|<>^()%!"`\r\n]/.test(arg))) {
    throw new Error('npm arguments contain unsupported Windows shell characters')
  }
  execFileSync(NPM, installArgs, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: process.platform === 'win32',
  })
}

materialize(join(out, 'a'), a.resolved, 'resolvedA')
materialize(join(out, 'b'), b.resolved, 'resolvedB')

/** Find scoped packages in root and nested node_modules directories. */
function scopedPkgs(root) {
  const packages = new Map()
  const visited = new Set()

  function visit(directory) {
    if (visited.has(directory)) return
    visited.add(directory)
    const modules = join(directory, 'node_modules')
    if (!existsSync(modules)) return

    const scope = join(modules, '@deepseek-ai')
    if (existsSync(scope)) {
      for (const entry of readdirSync(scope, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        const packageDirectory = join(scope, entry.name)
        if (existsSync(join(packageDirectory, 'package.json')) && !packages.has(entry.name)) {
          packages.set(entry.name, packageDirectory)
        }
      }
    }

    for (const entry of readdirSync(modules, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === '.bin') continue
      visit(join(modules, entry.name))
    }
  }

  visit(root)
  return packages
}
const pkgsA = scopedPkgs(join(out, 'a'))
const pkgsB = scopedPkgs(join(out, 'b'))
const manifestFields = ['version', 'bin', 'files', 'exports', 'dependencies', 'peerDependencies', 'main', 'types', 'engines']

let manifestDiff = `# package.json manifest diff: ${CLI} ${a.resolved} -> ${b.resolved}\n\n`
for (const name of new Set([...pkgsA.keys(), ...pkgsB.keys()].sort())) {
  const pa = pkgsA.get(name)
  const pb = pkgsB.get(name)
  const fa = pa ? JSON.parse(readFileSync(join(pa, 'package.json'), 'utf8')) : null
  const fb = pb ? JSON.parse(readFileSync(join(pb, 'package.json'), 'utf8')) : null
  if (!fa || !fb) {
    manifestDiff += `## ${name}: ${fa ? 'REMOVED in b' : 'ADDED in b'}\n\n`
    continue
  }
  const deltas = manifestFields
    .filter((f) => JSON.stringify(fa[f] ?? null) !== JSON.stringify(fb[f] ?? null))
    .map((f) => `- ${f}:\n  a: ${JSON.stringify(fa[f] ?? null)}\n  b: ${JSON.stringify(fb[f] ?? null)}`)
  if (deltas.length) manifestDiff += `## ${name} (${fa.version} -> ${fb.version})\n\n${deltas.join('\n')}\n\n`
}
writeFileSync(join(out, 'manifest-diff.txt'), manifestDiff)

/** GitHub compare enrichment: commit list + revert detection across the tag pair. */
let enrichment = { attempted: false }
if (useGithub && repository.includes('github.com')) {
  enrichment.attempted = true
  const [, owner, repo] = repository.match(/github\.com[/:]([^/]+)\/([^/]+)$/) ?? []
  if (owner) {
    const range = `dsh-v${a.resolved}...dsh-v${b.resolved}`
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/compare/${range}`)
      if (res.ok) {
        const data = await res.json()
        const commits = (data.commits ?? []).map((c) => `${c.sha.slice(0, 10)} (${c.commit.author.date.slice(0, 10)}) ${c.commit.message.split('\n')[0]}`)
        writeFileSync(join(out, 'commits.txt'), commits.join('\n') + '\n')
        const reverts = commits.filter((c) => /revert/i.test(c))
        writeFileSync(join(out, 'reverts.txt'), reverts.join('\n') + '\n')
        enrichment = {
          attempted: true,
          ok: true,
          range,
          totalCommits: data.total_commits,
          commitsListed: commits.length,
          truncated: commits.length < data.total_commits,
          reverts: reverts.length,
        }
      } else {
        enrichment = { attempted: true, ok: false, status: res.status }
      }
    } catch (e) {
      enrichment = { attempted: true, ok: false, error: String(e) }
    }
  }
}

const stats = {
  from: { requested: a.spec, resolved: a.resolved },
  to: { requested: b.spec, resolved: b.resolved },
  distTags,
  publishedVersions: published,
  outDir: out,
  supplements: supplementsResolved,
  packagesA: pkgsA.size,
  packagesB: pkgsB.size,
  packagesOnlyInA: [...pkgsA.keys()].filter((p) => !pkgsB.has(p)),
  packagesOnlyInB: [...pkgsB.keys()].filter((p) => !pkgsA.has(p)),
  github: enrichment,
  artifacts: ['a/', 'b/', 'manifest-diff.txt', ...(enrichment.ok ? ['commits.txt', 'reverts.txt'] : [])],
}
console.log(JSON.stringify(stats, null, 2))
