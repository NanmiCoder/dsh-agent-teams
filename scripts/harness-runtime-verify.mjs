#!/usr/bin/env node
/** Real published Harness product-entry verification. Only the model is a fixture.
 * Usage: node scripts/harness-runtime-verify.mjs --host-version <exact>
 *   --artifact <package.tgz> --report-dir <isolated-directory>
 * Optional: --runtime-dir <already prepared directory> --prepare-only
 */
import { runRuntimeScenarios, runtimeScenarios, runPluginInstallation } from './harness-runtime-scenarios.mjs';
import { inspectRuntimeCohort } from './harness-runtime-cohort.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const allowedFlags = new Set(['--host-version', '--artifact', '--report-dir', '--runtime-dir', '--scenario', '--prepare-only']);
const flags = new Map();
for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (!allowedFlags.has(arg) || flags.has(arg)) throw Error('Unknown or duplicate argument ' + arg);
    if (arg === '--prepare-only')
        flags.set(arg, true);
    else if (arg.startsWith('--') && process.argv[i + 1])
        flags.set(arg, process.argv[++i]);
    else
        throw Error('Invalid argument ' + arg);
}
const scenarios = runtimeScenarios;
if (flags.has('--scenario') && !scenarios.includes(flags.get('--scenario'))) throw Error('Unknown scenario');
const version = flags.get('--host-version');
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version))
    throw Error('--host-version must be an exact version');
if (!flags.has('--report-dir'))
    throw Error('--report-dir required');
const report = resolve(flags.get('--report-dir')), runtime = resolve(flags.get('--runtime-dir') ?? join(report, 'runtime'));
mkdirSync(report, { recursive: true });
mkdirSync(runtime, { recursive: true });
const registry = 'https://registry.npmjs.org';
const isDsh = name => /^@deepseek-ai\/dsh(?:-|$)/.test(name);
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const userConfig = process.platform === 'win32' ? 'NUL' : '/dev/null';
// Native install scripts (koffi's cnoke, node-pty) need the Windows shell and
// profile directories. The fixture environment is deliberately minimal, so
// forward exactly the variables those builds read instead of the whole block.
const windowsEnvironment = process.platform === 'win32'
    ? Object.fromEntries(['LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']
        .map(name => [name, process.env[name]]).filter(([, value]) => value !== undefined))
    : {};
// The DSH CLI installs plugins through an external pnpm. Pin the shim directory
// at the front of the fixture PATH so command lookups inside the spawned shell
// resolve the same package manager this runner already uses.
const packageManagerPath = process.platform === 'win32'
    ? [join(process.env.APPDATA ?? '', 'npm')].filter(existsSync).join(';')
    : dirname(process.execPath);
const fixturePath = packageManagerPath ? packageManagerPath + (process.platform === 'win32' ? ';' : ':') + process.env.PATH : process.env.PATH;
const environment = (extra = {}) => ({ PATH: fixturePath, LANG: process.env.LANG ?? 'en_US.UTF-8', HOME: join(report, 'user-home'), TMPDIR: join(report, 'tmp'), npm_config_userconfig: userConfig, npm_config_registry: registry, ...windowsEnvironment, ...extra });
mkdirSync(join(report, 'user-home'), { recursive: true });
mkdirSync(join(report, 'tmp'), { recursive: true });
/**
 * Windows resolves `npm` only through its `npm.cmd` shim: CreateProcess appends
 * `.exe` alone, and Node refuses to launch a batch file without a shell. Route
 * the package-manager invocation through the command interpreter so the runner
 * behaves the same on every host the matrix covers.
 */
function spawnTarget(argv) {
    if (process.platform !== 'win32' || !/^npm(?:\.cmd)?$/i.test(argv[0])) return [argv[0], argv.slice(1)];
    const quote = value => /[\s&|<>^()]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
    const line = [argv[0], ...argv.slice(1)].map(quote).join(' ');
    return [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', line], true];
}
async function command(argv, cwd, env, label, timeoutMs = 900000) {
    const [file, args, verbatim] = spawnTarget(argv);
    const child = spawn(file, args, {
        cwd, env, stdio: ['ignore', 'pipe', 'pipe'],
        ...verbatim === true ? { windowsVerbatimArguments: true } : {},
    });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', x => stdout += x);
    child.stderr.on('data', x => stderr += x);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000).unref(); }, timeoutMs);
    const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => resolve({ code, signal })); });
    clearTimeout(timer);
    writeFileSync(join(report, label + '.stdout.log'), stdout);
    writeFileSync(join(report, label + '.stderr.log'), stderr);
    return { ...exit, timedOut, stdout, stderr };
}
async function exactMetadata(name) {
    const response = await fetch(registry + '/' + encodeURIComponent(name) + '/' + version, { signal: AbortSignal.timeout(60000) });
    if (!response.ok)
        throw Error(`Registry lacks coherent target ${name}@${version}: HTTP ${response.status}`);
    const pkg = await response.json();
    if (pkg.name !== name || pkg.version !== version)
        throw Error('Registry identity mismatch: ' + name);
    return pkg;
}
async function collectCohort() {
    const packages = new Map(), pending = new Set(['@deepseek-ai/dsh']);
    while (pending.size) {
        const batch = [...pending].filter(x => !packages.has(x)).slice(0, 16);
        if (!batch.length)
            break;
        for (const name of batch)
            pending.delete(name);
        const results = await Promise.all(batch.map(exactMetadata));
        for (const pkg of results) {
            packages.set(pkg.name, pkg);
            for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies }))
                if (isDsh(name) && !packages.has(name))
                    pending.add(name);
        }
    }
    return packages;
}
function verifyCohort() {
    const result = inspectRuntimeCohort(runtime, version);
    json(join(report, 'cohort.json'), result);
    return result;
}
const testFiles = Object.fromEntries(['compatibility.mjs', '../compatibility.json', 'harness-validation.mjs', 'harness-runtime-verify.mjs', 'harness-runtime-cohort.mjs', 'harness-runtime-scenarios.mjs', 'fixtures/harness-runtime-llm.mjs', 'fixtures/harness-runtime-resume.mjs', 'fixtures/harness-runtime-idle.mjs', 'fixtures/harness-runtime-entry.mjs', 'fixtures/harness-runtime-web-approval.mjs', 'fixtures/harness-runtime-protocol.mjs', 'fixtures/harness-runtime-stability.mjs', 'fixtures/harness-runtime-tools.mjs'].map(path => [path, hash(join(dirname(fileURLToPath(import.meta.url)), path))]));
let artifactSha;
const manifestPath = join(runtime, 'package.json');
let manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : undefined;
if (manifest && !['agentteams-harness-runtime-test', 'agentteams-harness-runtime-lab'].includes(manifest.name))
    throw Error('Runtime directory is not owned by this test; choose a fresh --runtime-dir');
if (manifest?.dependencies?.['@deepseek-ai/dsh'] !== version) {
    if (manifest)
        throw Error('Runtime directory belongs to a different dependency state; use a new directory');
    const cohort = await collectCohort();
    json(join(report, 'registry-cohort.json'), { capturedAt: new Date().toISOString(), registry, version, packages: [...cohort.values()].map(p => ({ name: p.name, version: p.version, gitHead: p.gitHead, dist: p.dist })) });
    manifest = { name: 'agentteams-harness-runtime-test', version: '0.0.0', private: true, type: 'module', dependencies: { '@deepseek-ai/dsh': version }, overrides: Object.fromEntries([...cohort.keys()].map(name => [name, version])) };
}
if (flags.has('--artifact')) {
    const artifact = resolve(flags.get('--artifact'));
    artifactSha = hash(artifact);
    const ownArtifact = join(report, 'artifact-' + artifactSha + '.tgz');
    copyFileSync(artifact, ownArtifact);
    manifest.dependencies['@nanmicoder/dsh-agent-teams'] = 'file:' + ownArtifact;
}
else if (!flags.has('--prepare-only'))
    throw Error('--artifact required unless --prepare-only');
json(manifestPath, manifest);
const install = await command(['npm', 'install', '--prefer-online', '--no-audit', '--no-fund', '--registry=' + registry, '--userconfig=' + userConfig], runtime, environment({ 'npm_config_cache': process.env.npm_config_cache ?? join(report, 'npm-cache') }), 'install');
if (install.code !== 0)
    throw Error('npm installation failed; see ' + join(report, 'install.stderr.log'));
const cohort = verifyCohort();
if (flags.has('--prepare-only')) {
    json(join(report, 'result.json'), { prepared: true, version, runtime, cohortCount: cohort.count });
    console.log('Prepared ' + version + ' with ' + cohort.count + ' exact DSH packages');
    process.exit(0);
}
const plugin = JSON.parse(readFileSync(join(runtime, 'node_modules/@nanmicoder/dsh-agent-teams/package.json'), 'utf8'));
if (plugin.name !== '@nanmicoder/dsh-agent-teams') throw Error('Artifact package identity does not match AgentTeams');
const runs = await runRuntimeScenarios({ report, runtime, command, environment, selectedScenarios: flags.has('--scenario') ? [flags.get('--scenario')] : scenarios });
// Exercise the same compatibility gate used by the plugin settings UI. Runtime
// fixtures alone link the package directly and cannot prove installation works.
runs.push(...await runPluginInstallation({ version, pluginVersion: plugin.version, artifact: flags.get('--artifact'), runtime, report, command, environment }));
const passed = runs.every(x => x.passed);
json(join(report, 'result.json'), { passed, version, artifactSha256: artifactSha, pluginVersion: plugin.version, testFiles, node: process.version, platform: process.platform, arch: process.arch, cohortCount: cohort.count, runs, unverified: ['real provider APIs and credentials', 'browser interaction', 'other operating systems', 'native terminal execution', 'live user-data migration'] });
console.log(JSON.stringify({ passed, version, report, runs }, null, 2));
process.exitCode = passed ? 0 : 1;
