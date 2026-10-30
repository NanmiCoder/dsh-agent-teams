import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { inspectInstallation } from './doctor.mjs'
import {
  policy, workspacePolicy, requiredHostPeers, validatePolicy, validatePackageCompatibility, declaredHostVersions, generateHostPeers,
  compareHostVersions, minimumHost, hostRequirement, HOST_PEER_RANGE,
} from './compatibility.mjs'

// The official installer's own check (semver with includePrerelease), not a reimplementation.
const fromHost = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
const appBoot = fromHost.resolve('@deepseek-ai/dsh-app-boot')
const { evaluatePluginCompatibility } = await import(pathToFileURL(appBoot).href)
const semver = createRequire(appBoot)('semver')
const readPackage = () => JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const dshPeers = pkg => Object.keys(pkg.peerDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-'))
// Hosts from 0.1.7-rc.1 to 0.2.1-alpha.3 have the same check but do not read engines.dsh.
const withoutEngines = pkg => ({ ...pkg, engines: { node: pkg.engines.node } })

test('hosts released after the plugin pass the official install check; older hosts do not', () => {
  const pkg = readPackage()
  for (const version of [...validatePolicy(policy), '0.2.1-rc.4', '0.2.1-rc.5', '0.2.2-alpha.2', '0.3.0', '1.0.0-rc.1']) {
    assert.equal(evaluatePluginCompatibility(pkg, {}, version), undefined, `${version} must be installable`)
    assert.equal(evaluatePluginCompatibility(withoutEngines(pkg), {}, version), undefined, `${version} must pass a peer-reading installer`)
  }
  for (const version of ['0.1.0-rc.8', '0.1.1-rc.2', '0.1.2-alpha.1']) {
    assert.deepEqual(evaluatePluginCompatibility(pkg, {}, version).requirements, { 'engines.dsh': '>=0.1.2-alpha.2' }, `${version} predates the oldest tested host`)
  }
})

test('DSH peers stay * because npm checks ranges without prereleases', () => {
  const pkg = readPackage()
  assert.equal(dshPeers(pkg).length, 21)
  for (const name of dshPeers(pkg)) assert.equal(pkg.peerDependencies[name], HOST_PEER_RANGE)
  // npm's peer validation is semver.satisfies(version, range, loose): a lower bound rejects tested hosts,
  // and npm accepts * without consulting semver. The official installer accepts both.
  assert.equal(semver.satisfies('0.2.1-rc.3', hostRequirement(), true), false)
  assert.equal(semver.satisfies('0.2.1-rc.3', hostRequirement(), { includePrerelease: true }), true)
  for (const range of [hostRequirement(), '>=0.1.2-alpha.2 <0.3.0', '^0.2.1-rc.2', validatePolicy(policy).join(' || ')]) {
    const ranged = structuredClone(pkg)
    ranged.peerDependencies['@deepseek-ai/dsh-agent'] = range
    assert.throws(() => validatePackageCompatibility(ranged), /peer range must be \*/)
  }
})

test('the 0.1.27 exact allowlist is rejected because it blocked every later host', () => {
  const allowlist = withoutEngines(readPackage())
  for (const name of dshPeers(allowlist)) allowlist.peerDependencies[name] = validatePolicy(policy).join(' || ')
  assert.ok(evaluatePluginCompatibility(allowlist, {}, '0.2.1-rc.5'), 'the old declaration reproduces the reported failure')
  assert.throws(() => validatePackageCompatibility(allowlist), /engines\.dsh must be >=0\.1\.2-alpha\.2/)
  for (const dsh of ['*', '>=0.1.0', '>=0.1.2-alpha.2 <0.3.0', policy.recommendedHost, validatePolicy(policy).join(' || '), null]) {
    const pkg = readPackage()
    pkg.engines.dsh = dsh
    assert.throws(() => validatePackageCompatibility(pkg), /engines\.dsh/)
  }
})

test('testing a new host changes the CI matrix, not the published requirement', () => {
  const original = readPackage()
  const newer = { ...structuredClone(policy), supportedHosts: [{ version: '0.2.1-rc.999', track: 'preview' }, ...policy.supportedHosts] }
  assert.deepEqual(generateHostPeers(original, newer), original)
  assert.doesNotThrow(() => validatePackageCompatibility(original, newer))
  // Qualifying an older host lowers the requirement; dropping the oldest tested host raises it.
  const older = { ...structuredClone(policy), supportedHosts: [...policy.supportedHosts, { version: '0.1.1-rc.2', track: 'legacy' }] }
  const dropped = { ...structuredClone(policy), supportedHosts: policy.supportedHosts.filter(host => host.version !== '0.1.2-alpha.2') }
  assert.equal(hostRequirement(dropped), '>=0.1.2-alpha.5')
  const saved = structuredClone(older)
  assert.throws(() => validatePackageCompatibility(original, older), /engines\.dsh/)
  const generated = generateHostPeers(original, older)
  assert.doesNotThrow(() => validatePackageCompatibility(generated, older))
  assert.deepEqual(older, saved, 'Generating metadata must not modify targets')
  assert.deepEqual(generateHostPeers(generated, older), generated, 'Idempotent generation')
  assert.equal(generated.engines.dsh, '>=0.1.1-rc.2')
  assert.deepEqual({ ...generated, engines: original.engines }, original, 'No peer, dependency baseline, scripts or other metadata changes')
  const missing = structuredClone(original)
  delete missing.peerDependencies['@deepseek-ai/dsh-agent']
  assert.throws(() => generateHostPeers(missing, older), /Missing required/)
  const mixed = structuredClone(original)
  mixed.devDependencies['@deepseek-ai/dsh-agent'] = '0.1.2-alpha.2'
  assert.throws(() => generateHostPeers(mixed, older), /exact development host/)
})

test('synchronizing from the 0.1.27 manifest keeps the checked-in ASCII escapes', t => {
  // Canonical path: the script only runs its CLI branch when argv[1] matches import.meta.url.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-teams-sync-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  for (const file of ['scripts/compatibility.mjs', 'compatibility.json', 'pnpm-workspace.yaml']) {
    writeFileSync(join(root, file), readFileSync(new URL(`../${file}`, import.meta.url)))
  }
  const old = withoutEngines(readPackage())
  for (const name of dshPeers(old)) old.peerDependencies[name] = validatePolicy(policy).join(' || ')
  writeFileSync(join(root, 'package.json'), JSON.stringify(old, null, 2).replace(/[\u0080-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) + '\n')
  const run = spawnSync(process.execPath, [join(root, 'scripts/compatibility.mjs'), '--write-peers'], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /Generated engines\.dsh >=0\.1\.2-alpha\.2/)
  const synced = readFileSync(join(root, 'package.json'), 'utf8')
  assert.ok(synced === readFileSync(new URL('../package.json', import.meta.url), 'utf8'), 'sync output must equal the checked-in manifest byte for byte')
})

test('host versions order like semver prereleases', () => {
  const ordered = ['0.1.2-alpha.2', '0.1.2-alpha.10', '0.1.2-beta.1', '0.1.2-rc.1', '0.1.2', '0.1.10-alpha.1', '0.2.1-rc.5', '1.0.0']
  for (let i = 1; i < ordered.length; i++) {
    assert.equal(compareHostVersions(ordered[i - 1], ordered[i]), -1, `${ordered[i - 1]} < ${ordered[i]}`)
    assert.equal(compareHostVersions(ordered[i], ordered[i - 1]), 1)
  }
  assert.equal(compareHostVersions('0.2.1-rc.5', '0.2.1-rc.5'), 0)
  for (const invalid of ['latest', '0.2.1-dev.1', '0.2', undefined]) assert.equal(compareHostVersions(invalid, '0.2.1'), undefined)
  assert.equal(minimumHost(), '0.1.2-alpha.2')
  assert.equal(hostRequirement(), '>=0.1.2-alpha.2')
})

const sourcePolicy = { ...policy, sourceCandidates: [{ version: '0.2.0', repository: 'https://github.com/deepseek-ai/deepseek-harness', commit: '21638c56315ae6a2b552d6091945d3144c9af32e', evidence: 'docs/harness-0.2.0-pre-adaptation/README.md' }] }

test('source candidates are covered by the requirement without entering the published download matrix', () => {
  const pkg = readPackage()
  assert.ok(declaredHostVersions(sourcePolicy).includes('0.2.0'))
  assert.ok(!validatePackageCompatibility(pkg, sourcePolicy).includes('0.2.0'))
  assert.equal(evaluatePluginCompatibility(pkg, {}, '0.2.0'), undefined)
  // A candidate older than every tested host lowers the requirement instead of passing doctor while uninstallable.
  const olderCandidate = { ...sourcePolicy, sourceCandidates: [{ ...sourcePolicy.sourceCandidates[0], version: '0.1.1-rc.3' }] }
  assert.equal(hostRequirement(olderCandidate), '>=0.1.1-rc.3')
  assert.throws(() => validatePackageCompatibility(pkg, olderCandidate), /engines\.dsh/)
  const matrix = spawnSync(process.execPath, [fileURLToPath(new URL('./compatibility.mjs', import.meta.url)), '--github-output'], { encoding: 'utf8' })
  assert.equal(matrix.status, 0, matrix.stderr)
  assert.ok(!JSON.parse(matrix.stdout.trim().slice('hosts='.length)).includes('0.2.0'))
  for (const sourceCandidates of [
    [...sourcePolicy.sourceCandidates, sourcePolicy.sourceCandidates[0]],
    [{ ...sourcePolicy.sourceCandidates[0], version: '^0.2.0' }],
    [{ ...sourcePolicy.sourceCandidates[0], version: '0.2.0\n' }],
    [{ ...sourcePolicy.sourceCandidates[0], commit: 'master' }],
    [{ ...sourcePolicy.sourceCandidates[0], version: policy.recommendedHost }],
  ]) assert.throws(() => validatePolicy({ ...policy, sourceCandidates }), /Source candidates/)
})

test('doctor distinguishes source-preview acceptance from released host validation', t => {
  const root = mkdtempSync(join(tmpdir(), 'agent-teams-doctor-source-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0' }))
  const result = inspectInstallation(root, undefined, sourcePolicy)
  assert.equal(result.ok, true)
  assert.equal(result.validation.kind, 'source-preview')
  assert.equal(result.validation.sourceCommitVerified, false)
  assert.equal(result.validation.commit, sourcePolicy.sourceCandidates[0].commit)
  assert.ok(!result.supportedHosts.includes('0.2.0'))
  assert.match(result.limits.join(), /does not verify that the installed release matches/)
})

test('doctor runs through an installed bin symlink and reports success or failure', t => {
  const root = mkdtempSync(join(tmpdir(), 'agent-teams-doctor-bin-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const host = join(root, 'host')
  mkdirSync(host)
  writeFileSync(join(host, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: policy.recommendedHost }))
  const bin = join(root, 'dsh-agent-teams-doctor')
  symlinkSync(fileURLToPath(new URL('./doctor.mjs', import.meta.url)), bin, 'file')
  // Unix executes the installed shebang directly. Windows does not implement
  // shebangs: invoke Node with the same symlink path, retaining the argv[1]
  // versus import.meta.url regression without relying on a command shell.
  const windows = process.platform === 'win32'
  const executable = windows ? process.execPath : bin
  const args = [...(windows ? [bin] : []), '--host-root', host, '--json']
  const run = () => spawnSync(executable, args, { encoding: 'utf8', timeout: 5_000 })
  const supported = run()
  assert.equal(supported.error, undefined)
  assert.equal(supported.status, 0, supported.stderr)
  assert.match(supported.stdout, /"checkedPackages"/, 'bin must execute instead of silently importing the script')
  assert.equal(JSON.parse(supported.stdout).ok, true)
  writeFileSync(join(host, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.5' }))
  const untested = run()
  assert.equal(untested.status, 0, untested.stderr)
  assert.equal(JSON.parse(untested.stdout).validation.kind, 'untested')
  writeFileSync(join(host, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.8' }))
  const unsupported = run()
  assert.equal(unsupported.status, 1, unsupported.stderr)
  assert.equal(JSON.parse(unsupported.stdout).ok, false)
})

test('policy rejects floating targets, duplicates, and alpha recommendation', () => {
  assert.deepEqual(validatePolicy(policy), policy.supportedHosts.map(host => host.version))
  for (const version of ['latest', '^0.1.2-rc.1', '0.1.2-rc.1\n']) {
    assert.throws(() => validatePolicy({ ...policy, supportedHosts: [{ version, track: 'recommended' }] }))
  }
  assert.throws(() => validatePolicy({ ...policy, supportedHosts: [...policy.supportedHosts, policy.supportedHosts[0]] }))
  assert.throws(() => validatePackageCompatibility({ devDependencies: { '@deepseek-ai/dsh': '^0.1.2-rc.1' } }))
})

test('doctor detects transitive cohort mixing even with an exact CLI version', t => {
  const root = mkdtempSync(join(tmpdir(), 'agent-teams-doctor-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  function pkg(directory, name, version, dependencies = {}) {
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version, dependencies }))
  }
  pkg(root, '@deepseek-ai/dsh', '0.1.2-alpha.2', { '@deepseek-ai/dsh-agent': '^0.1.2-alpha.2' })
  const dependency = join(root, 'node_modules/@deepseek-ai/dsh-agent')
  pkg(dependency, '@deepseek-ai/dsh-agent', '0.1.2-rc.1')
  const mixed = inspectInstallation(root)
  assert.equal(mixed.ok, false)
  assert.equal(mixed.checkedPackages, 2)
  assert.match(mixed.problems.join(), /differ from host/)
  pkg(dependency, '@deepseek-ai/dsh-agent', '0.1.2-alpha.2')
  assert.equal(inspectInstallation(root).ok, true)
  pkg(root, '@deepseek-ai/dsh', '0.1.0-rc.8')
  assert.match(inspectInstallation(root).problems.join(), /Unsupported host 0\.1\.0-rc\.8; requires >=0\.1\.2-alpha\.2/)
  pkg(root, '@deepseek-ai/dsh', '0.2.1-dev.1')
  assert.match(inspectInstallation(root).problems.join(), /Unsupported host 0\.2\.1-dev\.1: unrecognized version format/, 'unparseable versions are not guessed')
  pkg(root, '@deepseek-ai/dsh', '0.2.2-alpha.2')
  const later = inspectInstallation(root)
  assert.equal(later.ok, true, later.problems.join())
  assert.equal(later.validation.kind, 'untested')
  assert.match(later.limits.join(), /not in this release's tested matrix/)
})

test('doctor follows profile peers and rejects duplicate runtime identities', t => {
  const root = mkdtempSync(join(tmpdir(), 'agent-teams-doctor-profile-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, data) => {
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'package.json'), JSON.stringify(data))
  }
  write(root, { name: '@deepseek-ai/dsh', version: '0.1.2-rc.1', dependencies: { '@deepseek-ai/dsh-agent': '0.1.2-rc.1' } })
  write(join(root, 'node_modules/@deepseek-ai/dsh-agent'), { name: '@deepseek-ai/dsh-agent', version: '0.1.2-rc.1' })
  const profile = join(root, 'profile')
  write(join(profile, 'node_modules/@nanmicoder/dsh-agent-teams'), {
    name: '@nanmicoder/dsh-agent-teams', version: '0.1.16-rc.1', peerDependencies: { '@deepseek-ai/dsh-agent': '0.1.2-rc.1' },
  })
  write(join(profile, 'node_modules/@deepseek-ai/dsh-agent'), { name: '@deepseek-ai/dsh-agent', version: '0.1.2-rc.1' })
  assert.match(inspectInstallation(root, profile).problems.join(), /Multiple resolved identities/)
})

test('policy rejects missing or mixed development overrides', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const workspace = structuredClone(workspacePolicy)
  assert.doesNotThrow(() => validatePackageCompatibility(pkg))
  delete workspace.overrides['@deepseek-ai/dsh-agent']
  assert.throws(() => validatePackageCompatibility(pkg, policy, workspace), /override/)
  workspace.overrides['@deepseek-ai/dsh-agent'] = '0.1.2-alpha.2'
  assert.throws(() => validatePackageCompatibility(pkg, policy, workspace), /override/)
  assert.throws(() => validatePackageCompatibility({ ...pkg, pnpm: { overrides: {} } }), /pnpm-workspace/)
})

test('policy rejects removed host peers and range-qualified or conditional DSH overrides', () => {
  const original = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  for (const name of requiredHostPeers) {
    const pkg = structuredClone(original)
    delete pkg.peerDependencies[name]
    assert.throws(() => validatePackageCompatibility(pkg), /Missing required host peer/)
  }
  for (const selector of ['parent>@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-agent@^0.1.2', '@deepseek-ai/dsh@>=0.1>react']) {
    const pkg = structuredClone(original)
    const workspace = structuredClone(workspacePolicy)
    workspace.overrides[selector] = policy.recommendedHost
    assert.throws(() => validatePackageCompatibility(pkg, policy, workspace), /bare DSH package name/)
  }
})

test('doctor reports missing nonoptional Cordis peers and required plugin imports even with optional metadata', t => {
  const root = mkdtempSync(join(tmpdir(), 'agent-teams-doctor-required-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, data) => {
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'package.json'), JSON.stringify(data))
  }
  write(root, { name: '@deepseek-ai/dsh', version: policy.recommendedHost, peerDependencies: { '@deepseek-ai/cordis': '^4.0.2' } })
  assert.match(inspectInstallation(root).problems.join(), /Missing packages.*cordis/)
  write(join(root, 'node_modules/@deepseek-ai/cordis'), { name: '@deepseek-ai/cordis', version: '4.0.2' })
  const profile = join(root, 'profile')
  write(join(profile, 'node_modules/@nanmicoder/dsh-agent-teams'), {
    name: '@nanmicoder/dsh-agent-teams', version: '0.1.16-rc.1',
    peerDependencies: { '@deepseek-ai/dsh-subagent': policy.recommendedHost },
    peerDependenciesMeta: { '@deepseek-ai/dsh-subagent': { optional: true } },
  })
  assert.match(inspectInstallation(root, profile).problems.join(), /dsh-subagent \(plugin runtime\)/)
})

test('doctor detects peer-only drift and a mismatched installed plugin', t => {
  const root = mkdtempSync(join(tmpdir(), 'agent-teams-doctor-peer-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, data) => {
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'package.json'), JSON.stringify(data))
  }
  write(root, { name: '@deepseek-ai/dsh', version: '0.1.2-rc.1', dependencies: { '@deepseek-ai/dsh-agent': '0.1.2-rc.1' } })
  write(join(root, 'node_modules/@deepseek-ai/dsh-agent'), {
    name: '@deepseek-ai/dsh-agent', version: '0.1.2-rc.1', peerDependencies: { '@deepseek-ai/dsh-session': '*' },
  })
  write(join(root, 'node_modules/@deepseek-ai/dsh-session'), { name: '@deepseek-ai/dsh-session', version: '0.1.2-alpha.2' })
  assert.match(inspectInstallation(root).problems.join(), /differ from host/)
  write(join(root, 'node_modules/@deepseek-ai/dsh-session'), { name: '@deepseek-ai/dsh-session', version: '0.1.2-rc.1' })
  assert.equal(inspectInstallation(root).ok, true)
  const profile = join(root, 'profile')
  write(join(profile, 'node_modules/@nanmicoder/dsh-agent-teams'), { name: '@nanmicoder/dsh-agent-teams', version: '0.1.15' })
  assert.match(inspectInstallation(root, profile).problems.join(), /0\.1\.15/)
})

test('released target enters the download matrix and replaces the old source prediction', () => {
  assert.equal(policy.recommendedHost, '0.2.1-rc.2')
  assert.ok(validatePolicy(policy).includes('0.2.1-rc.3'))
  assert.ok(validatePolicy(policy).includes('0.2.1-rc.2'))
  assert.ok(validatePolicy(policy).includes('0.2.1-rc.1'))
  assert.ok(validatePolicy(policy).includes('0.2.0-rc.2'))
  assert.ok(!declaredHostVersions().includes('0.2.0'))
})
