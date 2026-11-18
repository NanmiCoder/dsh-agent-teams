import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [installDir, target, archive, reportPath] = process.argv.slice(2);
const report = resolve(reportPath);
const home = join(report, 'home');
const profile = join(home, 'profiles', 'desktop');
const workspace = join(report, 'workspace');
for (const dir of [profile, workspace]) mkdirSync(dir, { recursive: true });
const windows = process.platform === 'win32';
const resources = windows ? join(installDir, 'resources') : join(installDir, 'Contents', 'Resources');
const executable = windows ? join(installDir, 'DeepSeek Harness.exe') : join(installDir, 'Contents', 'MacOS', 'DeepSeek Harness');
const runtime = join(resources, 'app.asar', 'dsh');
const host = (...path) => join(runtime, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', ...path);
const support = join(resources, 'runtime');
const primary = join(support, 'primary-runtime');
const bundledPnpm = join(primary, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs');
const evidence = join(report, 'approval.json');
const env = {
    ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1', DSH_TELEMETRY_DISABLED: '1',
    LAB_DESKTOP_WORKSPACE: workspace, LAB_DESKTOP_RESULT: evidence,
};
const cli = (args) => execFileSync(executable, ['--expose-internals', host('cli.js'), ...args], {
    cwd: workspace, env, encoding: 'utf8', timeout: 120_000, windowsHide: true,
});

const version = cli(['--version']).trim();
assert.equal(version, target);
writeFileSync(join(report, 'identity.json'), JSON.stringify({
    platform: process.platform, arch: process.arch, version,
    pluginSha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
}, null, 2));
writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-desktop-runtime', private: true, type: 'module',
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
}));
writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n');
try {
    const installOutput = cli(['plugin', '--profile', 'desktop', 'add', '--save-exact', '@nanmicoder/dsh-agent-teams@0.1.31']);
    writeFileSync(join(report, 'plugin-install.log'), installOutput);
} catch (error) {
    writeFileSync(join(report, 'plugin-install.log'), String(error.stdout ?? '') + String(error.stderr ?? ''));
    throw error;
}
const packagePath = join(profile, 'node_modules', '@nanmicoder', 'dsh-agent-teams', 'package.json');
assert.equal(JSON.parse(readFileSync(packagePath, 'utf8')).version, '0.1.31');
copyFileSync(new URL('./fixtures/harness-desktop-approval.mjs', import.meta.url), join(profile, 'fixture-desktop.mjs'));
writeFileSync(join(profile, 'cordis.patch.yml'), `- id: llm-deepseek
  disabled: true
- id: llm-pi-ai
  disabled: true
- id: agent-default-model
  config:
    provider: desktop-audit
    model: fixture
- insert:
    - id: desktop-audit-approval
      name: ./fixture-desktop.mjs
`);
const child = spawn(executable, [
    '--expose-internals', host('index.js'), runtime, profile, primary, bundledPnpm, join(support, 'bin'),
], { cwd: profile, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
let output = '', errors = '', startup = 'waiting';
child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
child.stderr.setEncoding('utf8').on('data', chunk => { errors += chunk; });
child.on('message', message => {
    if (message.type === 'ready') startup = 'ready';
    if (message.type === 'fatal') startup = `fatal: ${message.diagnostic ?? message.message}`;
});
const exit = new Promise(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', error => resolve({ error: String(error) }));
});
try {
    for (let elapsed = 0; elapsed < 120_000; elapsed += 250) {
        if (existsSync(evidence)) break;
        const stopped = await Promise.race([exit, new Promise(resolve => setTimeout(() => resolve(false), 250))]);
        if (stopped !== false) throw new Error(`Desktop Host exited before approval: ${JSON.stringify(stopped)} (${startup})`);
    }
    assert.ok(existsSync(evidence), `Desktop approval timed out (${startup})`);
    const result = JSON.parse(readFileSync(evidence, 'utf8'));
    console.log(JSON.stringify(result, null, 2));
    assert.equal(result.passed, true, 'Desktop approval and member execution');
} finally {
    if (child.connected) child.send({ type: 'shutdown' }, () => {});
    const force = setTimeout(() => child.kill(), 6_000);
    force.unref();
    await exit;
    clearTimeout(force);
    writeFileSync(join(report, 'host.stdout.log'), output);
    writeFileSync(join(report, 'host.stderr.log'), errors);
}
