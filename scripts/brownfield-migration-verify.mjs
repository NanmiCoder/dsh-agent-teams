import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join } from 'node:path'

const run = promisify(execFile)
const project = await import('../lib/project.js')
const state = await import('../lib/state.js')
const roots = []
const temp = async (name) => { const base = process.env.TEMP || process.env.TMP || '.'; const root = await mkdtemp(join(base, 'dsh-' + name + '-')); roots.push(root); return root }
const check = (condition, message) => { assert.ok(condition, message); console.log('PASS ' + message) }
const git = async (cwd, ...args) => run('git', ['-C', cwd, ...args], { windowsHide: true })

try {
  const green = await temp('greenfield')
  const greenDiscovery = await project.discoverProject(green)
  check(greenDiscovery.mode === 'greenfield', 'Greenfield is identified')
  check(greenDiscovery.baselineStatus === 'ready', 'Greenfield baseline is ready')
  const greenState = project.createInitialProjectState({ id: 'green', title: 'Green', goal: 'start', mode: 'greenfield', now: Date.now(), discovery: greenDiscovery })
  check(greenState.context.baseline?.status === 'ready', 'Greenfield evidence is persisted')

  const clean = await temp('brownfield-clean')
  await mkdir(join(clean, 'src'))
  await writeFile(join(clean, 'package.json'), JSON.stringify({ scripts: { build: 'tsc', test: 'node test.js' } }, null, 2))
  await writeFile(join(clean, 'src', 'index.ts'), 'export const value = 1\n')
  await git(clean, 'init'); await git(clean, 'config', 'user.email', 'qa@example.invalid'); await git(clean, 'config', 'user.name', 'QA'); await git(clean, 'add', '.'); await git(clean, 'commit', '-m', 'baseline')
  const cleanDiscovery = await project.discoverProject(clean)
  check(cleanDiscovery.mode === 'brownfield', 'Clean Brownfield is identified')
  check(cleanDiscovery.gitDirty === false && cleanDiscovery.changedPaths.length === 0, 'Clean Brownfield Git state is clean')
  check(cleanDiscovery.buildCommands.includes('npm run build') && cleanDiscovery.testCommands.includes('npm run test'), 'Manifest build/test entry points are discovered')
  check(cleanDiscovery.architectureEvidence.includes('top-level:src') && cleanDiscovery.architectureEvidence.includes('manifest:package.json'), 'Architecture and manifest evidence is recorded')
  check(cleanDiscovery.baselineStatus === 'ready', 'Clean Brownfield baseline is ready')

  const dirty = await temp('brownfield-dirty')
  await mkdir(join(dirty, 'src')); await writeFile(join(dirty, 'package.json'), JSON.stringify({ scripts: { build: 'tsc', test: 'node test.js' } })); await writeFile(join(dirty, 'src', 'index.ts'), 'export const value = 1\n')
  await git(dirty, 'init'); await git(dirty, 'config', 'user.email', 'qa@example.invalid'); await git(dirty, 'config', 'user.name', 'QA'); await git(dirty, 'add', '.'); await git(dirty, 'commit', '-m', 'baseline'); await writeFile(join(dirty, 'src', 'index.ts'), 'export const value = 2\n')
  const dirtyDiscovery = await project.discoverProject(dirty)
  check(dirtyDiscovery.gitDirty && dirtyDiscovery.changedPaths.some((item) => item.includes('src')), 'Dirty Brownfield records uncommitted paths')
  check(dirtyDiscovery.baselineStatus === 'pending_decision', 'Dirty Brownfield produces a pending decision')
  const dirtyState = project.createInitialProjectState({ id: 'dirty', title: 'Dirty', goal: 'take over', mode: 'brownfield', now: Date.now(), discovery: dirtyDiscovery })
  assert.throws(() => project.assertProjectBaselineResolved(dirtyState), /pending decision/)
  check(dirtyState.decisions.some((item) => item.id === 'brownfield-baseline' && item.status === 'pending'), 'Dirty Brownfield persists a pending decision record')

  const legacy = await temp('legacy-project')
  const legacyState = project.createInitialProjectState({ id: 'legacy', title: 'Legacy', goal: 'migrate', mode: 'brownfield', now: Date.now(), discovery: cleanDiscovery })
  delete legacyState.context.baseline; legacyState.schemaVersion = 2
  await mkdir(join(legacy, '.agent-project'), { recursive: true }); await writeFile(join(legacy, '.agent-project', 'status.json'), JSON.stringify(legacyState))
  const migrated = await project.readProjectState(legacy)
  check(migrated.schemaVersion === project.PROJECT_STATE_VERSION, 'Old project schema migrates')
  check(migrated.context.baseline?.status === 'pending_decision', 'Migrated Brownfield without baseline remains gated')
  check((await readdir(join(legacy, '.agent-project'))).some((name) => name.includes('migration-') && name.endsWith('.bak')), 'Project migration creates a rollback backup')

  const corrupt = await temp('corrupt-project'); await mkdir(join(corrupt, '.agent-project')); await writeFile(join(corrupt, '.agent-project', 'status.json'), '{broken')
  await assert.rejects(() => project.readProjectState(corrupt), /corrupt|durable|state|JSON/)
  check((await readdir(join(corrupt, '.agent-project'))).some((name) => name.startsWith('status.json.corrupt-')), 'Corrupt project state is quarantined')

  const migrationFailure = await temp('migration-failure'); await mkdir(join(migrationFailure, '.agent-project')); await writeFile(join(migrationFailure, '.agent-project', 'status.json'), JSON.stringify({ schemaVersion: 999 }))
  await assert.rejects(() => project.readProjectState(migrationFailure), /schema|migration|corrupt|state/)
  check((await readdir(join(migrationFailure, '.agent-project'))).some((name) => name.startsWith('status.json.corrupt-')), 'Failed project migration is isolated')

  const teamRoot = await temp('legacy-team'); const teamDir = join(teamRoot, 'legacy-team'); await mkdir(teamDir, { recursive: true })
  const oldTeam = { id: 'legacy-team', name: 'Legacy', description: '', captainSessionId: 'captain', createdAt: Date.now(), members: [], tasks: [], taskSeq: 0, revision: 0 }
  await writeFile(join(teamDir, 'team.json'), JSON.stringify(oldTeam))
  const migratedTeam = await state.readTeam(teamRoot, 'legacy-team')
  check(migratedTeam.schemaVersion === state.TEAM_STATE_VERSION, 'Old TeamState schema migrates')
  const persistedTeam = JSON.parse(await readFile(join(teamDir, 'team.json'), 'utf8'))
  check(persistedTeam.schemaVersion === state.TEAM_STATE_VERSION, 'TeamState migration is persisted')

  const badTeamRoot = await temp('bad-team-schema'); const badTeamDir = join(badTeamRoot, 'bad-team'); await mkdir(badTeamDir, { recursive: true })
  await writeFile(join(badTeamDir, 'team.json'), JSON.stringify({ ...oldTeam, id: 'bad-team', schemaVersion: 999 }))
  await assert.rejects(() => state.readTeam(badTeamRoot, 'bad-team'), /schema|state|corrupt/)
  check((await readdir(badTeamDir)).some((name) => name.startsWith('team.json.corrupt-')), 'Failed TeamState migration is isolated')
  console.log('brownfield-migration-verify: PASS')
} finally {
  for (const root of roots.reverse()) await rm(root, { recursive: true, force: true }).catch(() => undefined)
}
