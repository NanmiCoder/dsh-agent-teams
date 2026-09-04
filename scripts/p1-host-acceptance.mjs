import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const evidenceDir = join(root, 'docs', 'evidence');
const reportPath = join(evidenceDir, 'p1-host-acceptance-latest.md');
const timeoutMs = Number(process.env.P1_ACCEPTANCE_TIMEOUT_MS || 180000);
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const packageScripts = packageJson.scripts || {};
const deterministicResults = [];

function run(command, args, label, options = {}) {
  return new Promise((resolveResult) => {
    const useShell = options.shell ?? (process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'));
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...(options.env || {}) }, shell: useShell, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs || timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => { clearTimeout(timer); resolveResult({ label, code: null, timedOut, stdout, stderr: stderr + error.message }); });
    child.once('close', (code, signal) => { clearTimeout(timer); resolveResult({ label, code, signal, timedOut, stdout, stderr }); });
  });
}

function record(result) {
  deterministicResults.push(result);
  const status = result.timedOut ? 'TIMEOUT' : result.code === 0 ? 'PASS' : 'FAIL';
  console.log('[' + status + '] ' + result.label + ' (exit=' + (result.code ?? 'spawn-error') + ')');
  if (status !== 'PASS') { const output = (result.stdout + result.stderr).trim(); if (output) console.log(output.slice(-12000)); }
}

function deterministicNames() {
  const preferred = ['verify:product-e2e', 'verify:project-persistence', 'verify:project-route', 'verify:project-gate-enforcement', 'verify:project-gate-materialization', 'verify:brownfield', 'verify:migration', 'verify:upgrade', 'verify:rollback'];
  return preferred.filter((name) => typeof packageScripts[name] === 'string' && !name.includes('release'));
}

async function runDeterministic() {
  const names = deterministicNames();
  if (names.length === 0) { record({ label: 'deterministic entry-point discovery', code: 2, timedOut: false, stdout: '', stderr: 'No supported deterministic verification entry point was found.' }); return; }
  for (const name of names) record(await run(pnpm, [name], 'deterministic ' + name));
}

const hostChecks = [
  { id: 'real-harness', title: '真实 Harness', commandEnv: 'P1_REAL_HARNESS_CMD', evidenceEnv: 'P1_REAL_HARNESS_EVIDENCE', scenarios: 'Greenfield；Brownfield dirty/clean；澄清；需求/设计确认；DAG；Review needs_revision → repair/re-review；accept/deliver；冷启动；迁移/回滚' },
  { id: 'real-browser', title: '真实浏览器 UI', commandEnv: 'P1_REAL_BROWSER_CMD', evidenceEnv: 'P1_REAL_BROWSER_EVIDENCE', scenarios: '真实 Captain 交互、用户确认、门禁展示、进度和交付结果；需要浏览器 trace 或录屏' },
  { id: 'real-model', title: '真实模型', commandEnv: 'P1_REAL_MODEL_CMD', evidenceEnv: 'P1_REAL_MODEL_EVIDENCE', scenarios: '自然语言目标理解、关键歧义提问、需求/设计产出、Review 修复；需要请求/响应审计和模型版本' },
  { id: 'upgrade-rollback', title: '升级/回滚', commandEnv: 'P1_UPGRADE_ROLLBACK_CMD', evidenceEnv: 'P1_UPGRADE_ROLLBACK_EVIDENCE', scenarios: '旧 project/team schema 迁移、备份、迁移失败隔离、恢复、回滚后冷启动和再次读写' },
];

function evidencePath(value) { if (!value) return ''; return isAbsolute(value) ? value : resolve(root, value); }

async function runHostCheck(check) {
  const command = process.env[check.commandEnv];
  const evidence = evidencePath(process.env[check.evidenceEnv]);
  if (process.env.P1_RUN_REAL_HOST !== '1') return { ...check, status: 'BLOCKED', reason: '未启用真实宿主执行；必须显式设置 P1_RUN_REAL_HOST=1。', evidence };
  if (!command) return { ...check, status: 'BLOCKED', reason: '缺少 ' + check.commandEnv + '；不能伪造宿主通过。', evidence };
  const result = await run(command, [], 'host ' + check.id, { shell: true });
  let hasEvidence = false;
  try { hasEvidence = Boolean(evidence && existsSync(evidence) && readFileSync(evidence, 'utf8').trim()); } catch { hasEvidence = false; }
  if (result.code !== 0 || result.timedOut) return { ...check, status: 'FAIL', reason: '宿主命令未成功完成（exit=' + (result.code ?? 'spawn-error') + '）。', evidence, result };
  if (!hasEvidence) return { ...check, status: 'BLOCKED', reason: '命令成功但缺少非空证据文件；命令成功不等于可发布证据。', evidence, result };
  return { ...check, status: 'PASS', reason: '宿主命令和非空证据文件均已提供；仍需人工核对证据内容与版本绑定。', evidence, result };
}

await runDeterministic();
const hostResults = [];
for (const check of hostChecks) hostResults.push(await runHostCheck(check));
for (const host of hostResults) console.log('[' + host.status + '] ' + host.title + ': ' + host.reason);

const deterministicFailed = deterministicResults.some((result) => result.code !== 0 || result.timedOut);
const hostFailed = hostResults.some((result) => result.status === 'FAIL');
const hostBlocked = hostResults.some((result) => result.status === 'BLOCKED');
mkdirSync(evidenceDir, { recursive: true });
const report = [
  '# P1 真实宿主验收证据', '',
  '生成时间：' + new Date().toISOString(),
  '工作区：' + root, '',
  '本报告由 scripts/p1-host-acceptance.mjs 生成。它不替代真实宿主证据，不调用 scripts/release-verification.mjs，也不删除 acceptance 日志。未在当前环境验证的能力保持 BLOCKED。', '',
  '## 本地 deterministic Harness', '',
  '| 检查 | 退出码 | 状态 |', '| --- | ---: | --- |',
  ...deterministicResults.map((result) => '| ' + result.label + ' | ' + (result.code ?? 'spawn-error') + ' | ' + (result.timedOut ? 'TIMEOUT' : result.code === 0 ? 'PASS' : 'FAIL') + ' |'), '',
  'deterministic 结果只证明当前 fixture/本地 Harness 的行为，不推导真实浏览器、真实模型、真实宿主确认或升级/回滚已经通过。', '',
  '## 真实宿主证据', '',
  '| 能力 | 状态 | 覆盖场景 | 证据 |', '| --- | --- | --- | --- |',
  ...hostResults.map((host) => '| ' + host.title + ' | ' + host.status + ' | ' + host.scenarios + ' | ' + host.reason + (host.evidence ? ' 路径：' + host.evidence : '') + ' |'), '',
  '## 发布判定', '',
  '- deterministic Harness：' + (deterministicFailed ? 'FAIL' : 'PASS'),
  '- 真实宿主证据：' + (hostFailed ? 'FAIL' : hostBlocked ? 'BLOCKED' : 'PASS'),
  '- P1 总体：' + (deterministicFailed || hostFailed ? 'NO-GO' : hostBlocked ? 'BLOCKED / NO-GO' : 'CONDITIONALLY READY FOR HUMAN REVIEW'), '',
  '真实宿主执行必须提供受控 Harness、浏览器 trace/录屏、模型请求与响应审计、迁移前后快照及回滚后冷启动日志；缺任一项不得改写为 PASS。',
];
writeFileSync(reportPath, report.join('\n') + '\n', 'utf8');
console.log('Evidence report: ' + relative(root, reportPath));
if (deterministicFailed || hostFailed) process.exitCode = 1; else if (hostBlocked) process.exitCode = 2;
