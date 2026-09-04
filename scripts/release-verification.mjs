#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, relative, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidenceOutput = join(root, '.release-verification', 'release-evidence.json')
const evidenceSchemaVersion = 2
if (process.env.DSH_RELEASE_VERIFY_NESTED === '1') {
  console.log('release-verification: nested snapshot invocation skipped')
  process.exit(0)
}

const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-release-'))
const snapshot = join(tempRoot, 'source-snapshot')
const pnpmStore = join(tempRoot, 'pnpm-store')
const npmCache = join(tempRoot, 'npm-cache')
const packDirectory = join(tempRoot, 'pack')
const profile = join(tempRoot, 'clean-profile')
await Promise.all([mkdir(pnpmStore), mkdir(npmCache), mkdir(packDirectory), mkdir(profile)])

// The fixed snapshot must install development dependencies because the
// verification scripts import the Harness test/runtime peers. Do not let a
// host-level NODE_ENV=production silently create an incomplete verification
// environment.
const childEnv = {
  ...process.env,
  CI: '1',
  NODE_ENV: 'development',
  npm_config_production: 'false',
  DSH_RELEASE_VERIFY_NESTED: '1',
  npm_config_cache: npmCache,
  npm_config_update_notifier: 'false',
}
function cliCandidates(name) {
  const pathEntries = (process.env.Path ?? process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const candidates = []
  if (name === 'pnpm') {
    for (const entry of pathEntries) candidates.push(join(entry, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'))
  }
  if (name === 'npm') {
    candidates.push(join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    for (const entry of pathEntries) candidates.push(join(entry, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  }
  return candidates
}
function invocation(name, args) {
  if (process.platform === 'win32' && (name === 'pnpm' || name === 'npm')) {
    const cli = cliCandidates(name).find((candidate) => existsSync(candidate))
    if (cli === undefined) throw new Error('unable to locate the ' + name + ' JavaScript CLI from PATH')
    return { file: process.execPath, args: [cli, ...args] }
  }
  return { file: name, args }
}
function run(name, args, cwd, capture = true) {
  return new Promise((resolveRun, rejectRun) => {
    const command = invocation(name, args)
    // Always capture child output so a failed release step leaves actionable
    // evidence. For the previously streaming calls, mirror the same output to
    // the parent process while retaining it for the error record.
    const child = spawn(command.file, command.args, { cwd, env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      if (!capture) process.stdout.write(text)
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      if (!capture) process.stderr.write(text)
    })
    child.once('error', rejectRun)
    child.once('close', (code) => {
      if (code !== 0) { rejectRun(new Error(name + ' ' + args.join(' ') + ' exited ' + String(code) + '\n' + (stdout + '\n' + stderr).slice(-8000))); return }
      resolveRun({ stdout, stderr })
    })
  })
}
async function hashFile(path) { return createHash('sha256').update(await readFile(path)).digest('hex') }
async function listFiles(directory) {
  const result = []
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) result.push(path)
    }
  }
  await visit(directory)
  return result.sort()
}
function excluded(path) {
  const normalized = relative(root, path).replaceAll('\\', '/')
  const first = normalized.split('/')[0]
  return ['.git', 'node_modules', 'lib', '.agent-teams', '.agent-project', '.release-verification', '.pnpm-store'].includes(first)
    || normalized.startsWith('.acceptance-dsh.') || normalized.endsWith('.tgz')
}
async function makeSnapshot() {
  await cp(root, snapshot, { recursive: true, filter: (path) => path === root || !excluded(path) })
  const files = await listFiles(snapshot)
  assert(!files.some((path) => /[\\/]node_modules[\\/]/u.test(path)))
  assert(!files.some((path) => /[\\/]lib[\\/]/u.test(path)))
  const digest = createHash('sha256')
  for (const path of files) digest.update(relative(snapshot, path).replaceAll('\\', '/') + '\0' + await hashFile(path) + '\n')
  return { fileCount: files.length, digest: digest.digest('hex') }
}
async function auditLogs() {
  const patterns = [
    { name: 'url-token', expression: /https?:\/\/[^\s]+(?:[?&](?:token|access_token)=|token=)/iu },
    { name: 'credential', expression: /(?:authorization|bearer|cookie|secret)\s*[:=]/iu },
  ]
  const findings = []
  for (const name of ['.acceptance-dsh.stdout.log', '.acceptance-dsh.stderr.log']) {
    try {
      const path = join(root, name)
      const content = await readFile(path, 'utf8')
      findings.push({ path: name, length: content.length, sha256: await hashFile(path), matched: patterns.filter((pattern) => pattern.expression.test(content)).map((pattern) => pattern.name) })
    } catch { findings.push({ path: name, present: false, matched: [] }) }
  }
  return findings
}
async function worktreeEvidence() {
  try {
    const head = (await run('git', ['rev-parse', 'HEAD'], root)).stdout.trim()
    const status = (await run('git', ['status', '--porcelain=v1'], root)).stdout
    return { head, status, clean: status.trim() === '' }
  } catch (error) { return { available: false, error: String(error), clean: false } }
}
async function frozenInstallWithWindowsFallback(cwd) {
  try {
    await run('pnpm', ['install', '--frozen-lockfile', '--prod=false', '--force', '--store-dir=' + pnpmStore], cwd, false)
    return 'executed'
  } catch (error) {
    if (process.platform !== 'win32') throw error
    console.warn('WARN pnpm lifecycle install failed on Windows; retrying with --ignore-scripts and recording the fallback')
    await run('pnpm', ['install', '--frozen-lockfile', '--prod=false', '--ignore-scripts', '--force', '--store-dir=' + pnpmStore], cwd, false)
    return 'skipped-on-windows-fallback'
  }
}

function addBlocker(reason, details = {}) {
  evidence.blockers.push({ reason, ...details })
}

const evidence = {
  schemaVersion: evidenceSchemaVersion,
  startedAt: new Date().toISOString(), workspace: root, node: process.version, platform: process.platform,
  packageVersion: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version,
  worktree: await worktreeEvidence(), acceptanceLogs: await auditLogs(), steps: {}, blockers: [], status: 'running',
}
if (!evidence.worktree.clean) addBlocker('dirty-worktree', { status: evidence.worktree.status })

try {
  evidence.steps.snapshot = await makeSnapshot()
  console.log('PASS fixed source snapshot: ' + evidence.steps.snapshot.fileCount + ' files, digest ' + evidence.steps.snapshot.digest)

  const lifecycleScripts = await frozenInstallWithWindowsFallback(snapshot)
  evidence.steps.frozenInstall = { passed: true, lifecycleScripts, store: 'temporary-writable' }
  console.log('PASS pnpm install --frozen-lockfile with temporary writable store (lifecycleScripts=' + lifecycleScripts + ')')

  const buildStartedAt = Date.now()
  await run('pnpm', ['build'], snapshot, false)
  const builtFiles = await listFiles(join(snapshot, 'lib'))
  assert(builtFiles.length > 0)
  const builtStats = await Promise.all(builtFiles.map((path) => stat(path)))
  assert(builtStats.every((item) => item.mtimeMs >= buildStartedAt - 2000), 'lib contains files older than this build')
  evidence.steps.build = { passed: true, sourceSnapshotDigest: evidence.steps.snapshot.digest, libFileCount: builtFiles.length }
  console.log('PASS build generated lib from fixed snapshot; old lib was excluded')

  await run('pnpm', ['verify'], snapshot, false)
  evidence.steps.verify = 'passed'
  console.log('PASS pnpm verify in fixed snapshot')

  const packed = await run('npm', ['pack', '--json', '--cache', npmCache, '--pack-destination', packDirectory], snapshot)
  const metadata = JSON.parse(packed.stdout.slice(packed.stdout.indexOf('[')))
  const tarballName = metadata[0]?.filename
  assert(typeof tarballName === 'string' && tarballName !== '')
  const packageFiles = metadata[0].files.map((file) => file.path.replaceAll('\\', '/'))
  const forbiddenFiles = packageFiles.filter((path) => /(^|\/)(src|scripts|docs|node_modules|\.git)(\/|$)|(^|\/)\.acceptance-dsh\.[^/]+\.log$|\.log$|\.tgz$/iu.test(path))
  assert.deepEqual(forbiddenFiles, [], 'forbidden release files found: ' + forbiddenFiles.join(', '))
  evidence.steps.pack = { passed: true, tarball: tarballName, fileCount: packageFiles.length, forbiddenFiles }
  console.log('PASS npm pack with temporary cache: ' + tarballName + ' (' + packageFiles.length + ' files)')

  const tarball = join(packDirectory, tarballName)
  // The plugin declares the Harness runtime as optional peer dependencies, but
  // the published bundle imports several of them at module evaluation time.
  // npm therefore will not materialize them merely via --include=peer when
  // they are marked optional. Install the declared peers explicitly into the
  // clean profile so the smoke test models a real host-provided runtime.
  const snapshotPackage = JSON.parse(await readFile(join(snapshot, 'package.json'), 'utf8'))
  const runtimePeerSpecs = Object.entries(snapshotPackage.peerDependencies ?? {})
    .map(([name, version]) => name + '@' + version)
  await run('npm', [
    'install', '--prefix', profile, '--no-save', '--no-package-lock',
    '--ignore-scripts', '--no-audit', '--no-fund', '--include=peer',
    '--cache', npmCache, tarball, ...runtimePeerSpecs,
  ], root, false)
  const packageSegments = snapshotPackage.name.split('/')
  const installedRoot = packageSegments[0].startsWith('@')
    ? join(profile, 'node_modules', packageSegments[0], packageSegments[1])
    : join(profile, 'node_modules', packageSegments[0])
  await stat(join(installedRoot, 'lib', 'index.js')); await stat(join(installedRoot, 'lib', 'client.js'))
  evidence.steps.cleanProfileInstall = {
    passed: true,
    installedRoot: 'clean-profile/node_modules/@nanmicoder/dsh-agent-teams',
    explicitRuntimePeerCount: runtimePeerSpecs.length,
  }
  console.log('PASS tarball installed into clean temporary profile')

  const installedPackage = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'))
  const installedIndex = await import(pathToFileURL(join(installedRoot, 'lib', 'index.js')).href)
  const installedProject = await import(pathToFileURL(join(installedRoot, 'lib', 'project.js')).href)
  const installedProjectTools = await import(pathToFileURL(join(installedRoot, 'lib', 'project-tools.js')).href)
  const installedWebRoutes = await import(pathToFileURL(join(installedRoot, 'lib', 'web-routes.js')).href)
  assert.equal(installedIndex.name, 'agent-teams')
  const smokeWorkspace = await mkdtemp(join(tempRoot, 'smoke-workspace-'))
  const registeredTools = new Map()
  installedProjectTools.registerProjectTools({ tools: { register(tool) { registeredTools.set(tool.name, tool) } } })
  const smokeExec = { agent: { id: 'release-smoke-captain', session: { header: { cwd: smokeWorkspace } } } }
  const initTool = registeredTools.get('agent_project_init'); const statusTool = registeredTools.get('agent_project_status')
  assert(initTool && statusTool)
  assert.equal((await initTool.execute({ id: 'release-smoke', title: 'Release smoke', goal: 'verify installed tools' }, smokeExec)).status, 'initialized')
  assert.equal((await statusTool.execute({}, smokeExec)).status, 'ready')
  assert.equal((await installedProjectTools.projectWorkspaceSnapshot(smokeWorkspace, 'release-smoke')).status.id, 'release-smoke')
  assert.equal((await installedProject.readProjectState(smokeWorkspace)).id, 'release-smoke')
  let registeredRoute
  const routeHost = { register(route) { registeredRoute = route; return () => undefined } }
  const authHost = installedWebRoutes.authenticatedWebRoutes(routeHost, () => undefined)
  assert(authHost && typeof authHost.register === 'function')
  authHost.register({ path: '/release-smoke', async handler() {} }); assert.equal(registeredRoute.path, '/release-smoke')
  assert((await readFile(join(installedRoot, 'lib', 'client.js'), 'utf8')).includes(snapshotPackage.name))
  evidence.steps.installedSmoke = { passed: true, packageVersion: installedPackage.version, coldImport: true, projectTools: true, projectRouteProjection: true, projectRecovery: true, authenticatedRouteRegistration: true, clientBundle: true }
  console.log('PASS installed tarball cold import, project tools, project route, recovery, auth route registration, and client bundle smoke')

  let hostAvailable = false; try { await run('dsh', ['--version'], root); hostAvailable = true } catch { hostAvailable = false }
  evidence.steps.realHarness = hostAvailable ? 'CLI available; real profile/UI launch remains host-owned and was not started by this non-destructive gate' : 'dsh CLI unavailable; real Harness/profile/UI cold-start remains host-owned'
  console.log((hostAvailable ? 'INFO' : 'SKIP') + ' real Harness/UI launch: ' + evidence.steps.realHarness)
} catch (error) {
  evidence.failure = error instanceof Error ? error.message : String(error)
  const reason = /EACCES|ECONN|ENOTFOUND|ETIMEDOUT|registry|network/i.test(evidence.failure)
    ? 'network-or-permission'
    : 'release-pipeline-step-failed'
  addBlocker(reason, { message: evidence.failure })
  console.error('FAIL release verification: ' + evidence.failure)
  process.exitCode = 1
} finally {
  const logFindings = evidence.acceptanceLogs.filter((item) => item.matched?.length > 0)
  evidence.acceptanceLogGate = logFindings.length === 0 ? 'passed' : 'blocked-token-pattern'
  evidence.reproducibilityGate = evidence.worktree.clean ? 'passed' : 'blocked-dirty-worktree-snapshot-captured'
  if (logFindings.length > 0) {
    addBlocker('acceptance-log-token-pattern', { files: logFindings.map((item) => item.path), matched: logFindings.map((item) => item.matched) })
    console.error('BLOCKED acceptance log hygiene: invalidate the host token before sharing or publishing, then securely redact or remove the local log.')
    process.exitCode = 2
  }
  if (!evidence.worktree.clean) {
    console.error('BLOCKED reproducibility release gate: worktree is dirty; fixed snapshot evidence was captured but no clean release commit exists.')
    process.exitCode = 3
  }
  evidence.status = evidence.blockers.length === 0 ? 'passed' : 'blocked'
  evidence.finishedAt = new Date().toISOString(); await mkdir(dirname(evidenceOutput), { recursive: true }); await writeFile(evidenceOutput, JSON.stringify(evidence, null, 2) + '\n', 'utf8'); console.log('release evidence: ' + evidenceOutput); await rm(tempRoot, { recursive: true, force: true })
}
