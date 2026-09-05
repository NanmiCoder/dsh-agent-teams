#!/usr/bin/env node
/** Real published Harness product-entry verification. Only the model is a fixture.
 * Usage: node scripts/harness-runtime-verify.mjs --host-version <exact>
 *   --artifact <package.tgz> --report-dir <isolated-directory>
 * Optional: --runtime-dir <already prepared directory> --prepare-only
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, symlinkSync } from 'node:fs';
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
const scenarios = ['lifecycle', 'fallback', 'failure', 'captain-idle-wakeup'];
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
const environment = (extra = {}) => ({ PATH: process.env.PATH, LANG: process.env.LANG ?? 'en_US.UTF-8', HOME: join(report, 'user-home'), TMPDIR: join(report, 'tmp'), npm_config_userconfig: '/dev/null', npm_config_registry: registry, ...extra });
mkdirSync(join(report, 'user-home'), { recursive: true });
mkdirSync(join(report, 'tmp'), { recursive: true });
async function command(argv, cwd, env, label, timeoutMs = 900000) {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
    const lock = JSON.parse(readFileSync(join(runtime, 'package-lock.json'), 'utf8')), cohort = [];
    for (const [path, entry] of Object.entries(lock.packages)) {
        if (!/node_modules\/@deepseek-ai\/dsh(?:-[^/]+)?$/.test(path))
            continue;
        const installed = JSON.parse(readFileSync(join(runtime, path, 'package.json'), 'utf8'));
        if (entry.version !== version || installed.version !== version)
            throw Error(`Mixed host cohort ${path}: lock ${entry.version}, disk ${installed.version}, expected ${version}`);
        cohort.push({ path, name: installed.name, version: entry.version, integrity: entry.integrity });
    }
    if (!cohort.some(x => x.name === '@deepseek-ai/dsh'))
        throw Error('No actual Harness installation');
    const result = { version, count: cohort.length, lockSha256: hash(join(runtime, 'package-lock.json')), cohort };
    json(join(report, 'cohort.json'), result);
    return result;
}
const testFiles = Object.fromEntries(['harness-runtime-verify.mjs', 'fixtures/harness-runtime-llm.mjs', 'fixtures/harness-runtime-resume.mjs', 'fixtures/harness-runtime-idle.mjs'].map(path => [path, hash(join(dirname(fileURLToPath(import.meta.url)), path))]));
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
const install = await command(['npm', 'install', '--prefer-online', '--no-audit', '--no-fund', '--registry=' + registry, '--userconfig=/dev/null'], runtime, environment({ 'npm_config_cache': process.env.npm_config_cache ?? join(report, 'npm-cache') }), 'install');
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
const runs = [];
for (const scenario of (flags.has('--scenario') ? [flags.get('--scenario')] : scenarios)) {
    const home = join(report, scenario, 'home'), profile = join(home, 'profiles', 'headless'), workspace = join(report, scenario, 'workspace');
    mkdirSync(profile, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(profile, 'node_modules/@nanmicoder'), { recursive: true });
    symlinkSync(join(runtime, 'node_modules/@nanmicoder/dsh-agent-teams'), join(profile, 'node_modules/@nanmicoder/dsh-agent-teams'), 'dir');
    json(join(profile, 'package.json'), { name: 'runtime-test-profile', version: '0.0.0', private: true, type: 'module', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@nanmicoder/dsh-agent-teams'], patchReload: 'startup' } } });
    copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/harness-runtime-llm.mjs'), join(profile, 'fixture-llm.mjs'));
    writeFileSync(join(profile, 'cordis.patch.yml'), `- id: llm-deepseek\n  disabled: true\n- id: llm-pi-ai\n  disabled: true\n- id: agent-default-model\n  config:\n    provider: runtime-lab\n    model: fixture-model\n- insert:\n    - id: runtime-lab-fixture\n      name: './fixture-llm.mjs'\n`);
    if (scenario === 'fallback')
        writeFileSync(join(profile, 'cordis.patch.yml'), readFileSync(join(profile, 'cordis.patch.yml'), 'utf8') + '- id: agent-teams\n  config:\n    stateDir: .agent-teams\n    memberProvider: spawn\n    fallback:\n      provider: runtime-lab\n      model: fixture-fallback\n');
    if (scenario === 'captain-idle-wakeup') {
        copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/harness-runtime-idle.mjs'), join(profile, 'fixture-idle.mjs'));
        writeFileSync(join(profile, 'cordis.patch.yml'), readFileSync(join(profile, 'cordis.patch.yml'), 'utf8') + '- id: headless-startup\n  disabled: true\n- id: headless-runner\n  disabled: true\n- insert:\n    - id: runtime-lab-idle-captain\n      name: ./fixture-idle.mjs\n');
    }
    const tracePath = join(report, scenario, 'trace.jsonl');
    const result = await command([process.execPath, join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'headless', 'Run the authorized deterministic AgentTeams fixture immediately.'], workspace, environment({ DSH_HOME: home, DSH_PERMISSION_MODE: 'danger-full-access', DSH_TELEMETRY_DISABLED: '1', LAB_TRACE: tracePath, LAB_TEAMS: '1', LAB_SCENARIO: scenario }), scenario, 90000);
    const trace = existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
    const statePath = join(workspace, '.agent-teams/runtime-lab/team.json'), state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : undefined;
    const requests = trace.filter(x => x.event === 'request' && x.purpose === undefined), memberRequests = requests.filter(x => x.isMember);
    const isFailure = scenario === 'failure';
    const assertions = { exit0: result.code === 0 && !result.timedOut, productMarker: result.stdout.includes(isFailure ? 'AGENTTEAMS_EXPECTED_FAILURE_OK' : scenario === 'captain-idle-wakeup' ? 'CAPTAIN_IDLE_WAKEUP_OK' : 'AGENTTEAMS_PRODUCT_TURN_OK'), pluginToolsVisible: requests.some(x => x.toolNames.includes('agent_teams_create')), memberExecuted: memberRequests.length > 0, explicitReasoning: memberRequests.length > 0 && memberRequests.some(x => x.model !== 'fixture-fallback') && memberRequests.filter(x => x.model !== 'fixture-fallback').every(x => x.reasoningEffort === 'high'), taskTerminal: state?.tasks?.find(t => t.id === 't1')?.status === (isFailure ? 'failed' : 'completed') };
    if (!isFailure && scenario !== 'captain-idle-wakeup')
        assertions.secondWake = memberRequests.some(x => x.userText.includes('SECOND_WAKE_FIXTURE'));
    if (scenario === 'captain-idle-wakeup') {
        const idle = trace.find(x => x.event === 'captain-idle-observed');
        const notified = trace.find(x => x.event === 'captain-notified-after-yield');
        assertions.captainActuallyYielded = idle?.status === 'idle';
        assertions.notifiedAfterIdle = Boolean(idle && notified && idle.time < notified.time && idle.sessionId === notified.sessionId);
    }
    if (scenario === 'lifecycle') {
        const withBoth = memberRequests.find(x => x.userText.includes('FIFO_FIRST') && x.userText.includes('FIFO_SECOND'));
        assertions.fifoMessageOrder = Boolean(withBoth && withBoth.userText.indexOf('FIFO_FIRST') < withBoth.userText.indexOf('FIFO_SECOND'));
        const firstMember = memberRequests[0], firstResponse = trace.find(x => x.event === 'response' && x.isMember);
        const busySend = trace.find(x => x.event === 'request' && !x.isMember && x.called.includes('agent_teams_send_message'));
        assertions.messagesSentWhileBusy = Boolean(firstMember && firstResponse && busySend && firstMember.time <= busySend.time && busySend.time < firstResponse.time);
    }
    if (scenario === 'fallback') {
        assertions.fallbackActivated = memberRequests.some(x => x.model === 'fixture-fallback') && state?.members?.some(m => m.fallbackActive && m.activeModel === 'fixture-fallback');
        assertions.fallbackReasoningReset = memberRequests.some(x => x.model === 'fixture-fallback') && memberRequests.filter(x => x.model === 'fixture-fallback').every(x => x.reasoningEffort === 'low');
    }
    const passed = Object.values(assertions).every(Boolean);
    runs.push({ scenario, passed, exit: { code: result.code, signal: result.signal, timedOut: result.timedOut }, assertions, requests: requests.length, memberRequests: memberRequests.length });
    if (state)
        json(join(report, scenario, 'team-evidence.json'), state);
    if (passed && !isFailure && scenario !== 'captain-idle-wakeup') {
        copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/harness-runtime-resume.mjs'), join(profile, 'fixture-resume.mjs'));
        writeFileSync(join(profile, 'cordis.patch.yml'), readFileSync(join(profile, 'cordis.patch.yml'), 'utf8') + '- id: headless-startup\n  disabled: true\n- id: headless-runner\n  disabled: true\n- insert:\n    - id: runtime-lab-cold-resume\n      name: ./fixture-resume.mjs\n');
        const coldTrace = join(report, scenario, 'cold-trace.jsonl');
        const cold = await command([process.execPath, join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'headless'], workspace, environment({ DSH_HOME: home, DSH_PERMISSION_MODE: 'danger-full-access', DSH_TELEMETRY_DISABLED: '1', LAB_TRACE: coldTrace, LAB_TEAMS: '1', LAB_COLD: '1', LAB_SCENARIO: scenario, LAB_PARENT_SESSION: state.captainSessionId }), scenario + '-cold', 90000);
        const coldEvents = existsSync(coldTrace) ? readFileSync(coldTrace, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
        const coldMember = coldEvents.find(x => x.event === 'cold-member-completed');
        const coldAssertions = { exit0: cold.code === 0 && !cold.timedOut, driverCompleted: cold.stdout.includes('COLD_RESTORE_DRIVER_DONE'), sameMemberRestored: coldMember?.sessionId === state.members.find(m => m.name === 'worker')?.id, routeRestored: coldMember?.model === (scenario === 'fallback' ? 'fixture-fallback' : 'fixture-model'), reasoningRestored: coldMember?.reasoningEffort === (scenario === 'fallback' ? 'low' : 'high') };
        runs.push({ scenario: scenario + '-cold-restore', passed: Object.values(coldAssertions).every(Boolean), assertions: coldAssertions, exit: { code: cold.code, signal: cold.signal, timedOut: cold.timedOut } });
    }
}
const passed = runs.every(x => x.passed);
json(join(report, 'result.json'), { passed, version, artifactSha256: artifactSha, pluginVersion: plugin.version, testFiles, node: process.version, platform: process.platform, arch: process.arch, cohortCount: cohort.count, runs, unverified: ['real provider APIs and credentials', 'browser interaction', 'other operating systems', 'native terminal execution', 'live user-data migration'] });
console.log(JSON.stringify({ passed, version, report, runs }, null, 2));
process.exitCode = passed ? 0 : 1;
