import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { inspectInstallation } from './doctor.mjs'
import { policy, workspacePolicy, requiredHostPeers, validatePolicy, validatePackageCompatibility, declaredHostVersions } from './compatibility.mjs'

const sourcePolicy = { ...policy, sourceCandidates: [{ version: '0.2.0', repository: 'https://github.com/deepseek-ai/deepseek-harness', commit: '21638c56315ae6a2b552d6091945d3144c9af32e', evidence: 'docs/harness-0.2.0-pre-adaptation/README.md' }] }

test('source candidates pass the peer gate without entering the published download matrix', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  for (const name of Object.keys(pkg.peerDependencies)) if (name.startsWith('@deepseek-ai/dsh-')) pkg.peerDependencies[name] += ' || 0.2.0'
  assert.ok(declaredHostVersions(sourcePolicy).includes('0.2.0'))
  assert.ok(!validatePackageCompatibility(pkg, sourcePolicy).includes('0.2.0'))
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
  pkg.peerDependencies['@deepseek-ai/dsh-agent'] = pkg.peerDependencies['@deepseek-ai/dsh-agent'].replace(' || 0.2.0', '')
  assert.throws(() => validatePackageCompatibility(pkg, sourcePolicy), /source candidates/)
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
  assert.match(inspectInstallation(root).problems.join(), /Unsupported host/)
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
  assert.ok(validatePolicy(policy).includes('0.2.1-rc.2'))
  assert.ok(validatePolicy(policy).includes('0.2.1-rc.1'))
  assert.ok(validatePolicy(policy).includes('0.2.0-rc.2'))
  assert.ok(!declaredHostVersions().includes('0.2.0'))
})
