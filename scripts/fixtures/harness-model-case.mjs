/** Independent business fixture and acceptance, never a scripted model. */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const sources = {
    'app/orders.mjs': `export function enrichOrders(orders, products) {
  return orders.map(order => ({ ...order, product: products.find(product => product.id === order.productId) }));
}
`,
    'app/comments.mjs': `export function renderComment(comment) {
  return '<article class="comment">' + comment + '</article>';
}
`,
    'app/signup.mjs': `export function wireSignup(form) {
  form.submit.disabled = true;
  form.email.addEventListener('input', () => {
    form.message.textContent = form.email.value.includes('@') ? 'Ready to submit' : 'Enter a valid email';
  });
}
`,
};
export const reviewers = ['performance', 'security', 'interaction'];
export const freshPrompt = `请使用 AgentTeams 立即执行这项审查；我明确授权跳过计划审批，不需要再次确认。
安排三位成员，名字分别为 performance、security、interaction，各自独立只读审查 app/ 中的小应用。给每人创建一项明确的审查任务，合计三项独立任务；不要增加其他成员。performance 检查性能和数据规模增长，security 检查不可信输入，interaction 检查正常用户流程能否完成。
不要修改 app/ 或其他已有文件。每位成员只新增自己的 reports/<成员名>.json，格式为 {"reviewer":"成员名","findings":[{"path":"app/文件名","symbol":"函数名","problem":"具体问题","evidence":"可复现输入、操作及错误结果","recommendation":"最小修复建议"}]}。报告至少提供一个有源码依据的真实问题；没有发现时如实报告空 findings，不要编造。允许读代码和运行临时内存探针，禁止访问工作区外文件、网络、Harness 配置或插件源代码。
队长负责委派与汇总，不代写成员报告。等待三位成员完成审查任务并回报后，新增 reports/summary.json，格式为 {"reports":["reports/performance.json","reports/security.json","reports/interaction.json"],"summary":"基于三份报告的结论"}。完成后保留团队和任务以便我继续复核，不要删除或归档。结束当前轮，成员报告会自动唤醒你。`;
export const coldPrompt = `继续当前已有 AgentTeams 团队，不要重建团队、添加或替换成员，也不要覆盖先前报告。我现在要求一次后续复核：为原 security 成员新增且仅新增一项任务，确认 app/comments.mjs 原问题是否仍存在。不要修复代码。
请让原 security 成员读取当前文件，独立执行或描述具体输入与结果，写 reports/security-followup.json，沿用之前报告 JSON 格式。队长等待该任务完成和成员回报后，写 reports/cold-summary.json，格式为 {"reports":["reports/security-followup.json"],"summary":"复核结论"}。只写这些新报告，禁止工作区外读取或网络请求，完成后继续保留当前团队。`;
const digest = text => createHash('sha256').update(text).digest('hex');
export function teamIn(workspace, captainId) {
    const root = join(workspace, '.agent-teams');
    if (!existsSync(root)) return undefined;
    const teams = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name !== 'archive').map(entry => {
        const path = join(root, entry.name, 'team.json');
        return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
    }).filter(team => team?.captainSessionId === captainId);
    if (teams.length > 1) throw Error('Captain owns more than one active team');
    return teams[0];
}
function readReport(workspace, path) {
    try { return JSON.parse(readFileSync(join(workspace, path), 'utf8')); } catch { return undefined; }
}
function text(finding) { return [finding?.problem, finding?.evidence, finding?.recommendation].join(' '); }
export function reportWrite(event, path) {
    if(event.event!=='tool-result'||event.isError) return false;
    const args=event.arguments??{};
    if(['write','write_file','edit','edit_file','str_replace_editor'].includes(event.name)) {
        const target=args.file_path??args.path??args.filePath;
        return typeof target==='string'&&(target===path||target.endsWith('/'+path));
    }
    if(event.name==='apply_patch') return new RegExp('(?:Add|Update) File: [^\\n]*'+path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:\\n|$)').test(JSON.stringify(args).replace(/\\n/g,'\n'));
    if(!['bash','pwsh'].includes(event.name)) return false;
    const command=args.command??args.cmd??'';
    const escaped=path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    // Require the report to be the mutation target, not a nearby read operand.
    const target=`["']?(?:[^\\s"']*/)?${escaped}["']?(?=[\\s;|&)]|$)`;
    return new RegExp(`(?:>>?\\s*|\\btee\\s+(?:-a\\s+)?|(?:Set-Content|Out-File)\\s+(?:-Path\\s+)?)(?:${target})`).test(command)
        ||new RegExp(`(?:writeFile(?:Sync)?|open)\\s*\\(\\s*["'](?:[^"']*/)?${escaped}["']\\s*,\\s*(?:["'][wa]|[^)]*)`).test(command)&&/writeFile|open\s*\([^)]*,\s*['"][wa]/.test(command);
}
export function modelMetrics(events,captainId) {
    const requests=events.filter(event=>event.event==='model-request'&&!event.purpose);
    const ids=[...new Set(requests.map(event=>event.sessionId))];
    const sessionHeaders=ids.map(sessionId=>{const items=requests.filter(event=>event.sessionId===sessionId);return {sessionId,role:sessionId===captainId?'captain':'member',requests:items.length,systemHashes:[...new Set(items.map(event=>event.systemSha256))],toolsHashes:[...new Set(items.map(event=>event.toolsSha256))]};});
    const latestUsage=new Map(events.filter(event=>event.event==='model-usage').map(event=>[event.request,event.usage]));
    const usage=[...latestUsage.values()];
    const sum=key=>usage.some(value=>typeof value[key]==='number')?usage.reduce((total,value)=>total+(typeof value[key]==='number'?value[key]:0),0):null;
    return {sessionHeaders,stableSessionHeaders:sessionHeaders.length>0&&sessionHeaders.every(row=>row.systemHashes.length===1&&row.toolsHashes.length===1),openCalls:events.filter(event=>event.event==='tool-result'&&event.name==='agent_teams_open').length,usageRequests:usage.length,requestsWithoutUsage:requests.filter(event=>!latestUsage.has(event.request)).map(event=>event.request),usage:{uncachedInputTokens:sum('inputTokens'),cacheReadTokens:sum('cacheReadTokens'),cacheWriteTokens:sum('cacheWriteTokens'),outputTokens:sum('outputTokens'),reasoningTokens:sum('reasoningTokens')},usageSemantics:'Harness Usage counts inputTokens as uncached input; cacheRead/cacheWrite are separate. Last usage per request; unavailable fields remain null. Requests without usage are listed and excluded from sums. No price inference.'};
}
function groundedFinding(report, reviewer) {
    if (report?.reviewer !== reviewer || !Array.isArray(report.findings)) return false;
    return report.findings.some(finding => {
        if (typeof finding.evidence !== 'string' || finding.evidence.length < 20 || typeof finding.recommendation !== 'string' || finding.recommendation.length < 5) return false;
        const combined = text(finding);
        if (reviewer === 'performance') return finding.path === 'app/orders.mjs' && finding.symbol === 'enrichOrders' && /find|遍历|查找|扫描/i.test(combined) && /O\(|复杂度|quadratic|linear|乘积|重复|n\s*[*×]\s*m/i.test(combined);
        if (reviewer === 'security') return finding.path === 'app/comments.mjs' && finding.symbol === 'renderComment' && /XSS|转义|escape|注入|injection/i.test(combined) && /<img|<script|onerror|onload|HTML/i.test(finding.evidence);
        return finding.path === 'app/signup.mjs' && finding.symbol === 'wireSignup' && /disabled|禁用|按钮/i.test(combined) && /@|有效|valid|Ready/i.test(finding.evidence);
    });
}
export async function verifySeededBehavior(workspace) {
    const hashes = {};
    for (const [path, source] of Object.entries(sources)) {
        const actual = readFileSync(join(workspace, path), 'utf8');
        hashes[path] = digest(actual);
        if (actual !== source) return { sourceUnchanged: false, hashes };
    }
    const { enrichOrders } = await import(pathToFileURL(join(workspace, 'app/orders.mjs')).href);
    const { renderComment } = await import(pathToFileURL(join(workspace, 'app/comments.mjs')).href);
    const { wireSignup } = await import(pathToFileURL(join(workspace, 'app/signup.mjs')).href);
    let reads = 0;
    const products = Array.from({ length: 200 }, (_, id) => ({ get id() { reads++; return id; } }));
    enrichOrders(Array.from({ length: 200 }, (_, productId) => ({ productId })), products);
    const payload = '<img src=x onerror=alert(1)>';
    let input;
    const form = { submit: { disabled: false }, message: { textContent: '' }, email: { value: '', addEventListener(event, callback) { if (event === 'input') input = callback; } } };
    wireSignup(form); form.email.value = 'reader@example.test'; input();
    return { sourceUnchanged: true, hashes, repeatedProductScans: reads === 20100, productIdReads: reads, unsafeHtmlEcho: renderComment(payload).includes(payload), validInputStillDisabled: form.submit.disabled === true && form.message.textContent === 'Ready to submit' };
}
export function evaluate(workspace, captainId, events, phase, previous) {
    const checks = {};
    for (const [path, source] of Object.entries(sources)) checks['source:' + path] = existsSync(join(workspace, path)) && readFileSync(join(workspace, path), 'utf8') === source;
    const team = teamIn(workspace, captainId);
    checks.oneCurrentTeam = Boolean(team);
    checks.exactRoster = Boolean(team && team.members.length === 3 && reviewers.every(name => team.members.some(member => member.name === name && member.id && member.status !== 'removed')));
    checks.running = Boolean(team && team.phase !== 'staged' && !team.halted);
    const targets = phase === 'cold' ? ['security'] : reviewers;
    const summaryPath = phase === 'cold' ? 'reports/cold-summary.json' : 'reports/summary.json';
    const reportPaths = targets.map(name => 'reports/' + name + (phase === 'cold' ? '-followup' : '') + '.json');
    for (let i = 0; i < targets.length; i++) {
        const reviewer = targets[i], path = reportPaths[i], member = team?.members.find(item => item.name === reviewer);
        checks['groundedReport:' + reviewer] = groundedFinding(readReport(workspace, path), reviewer);
        checks['memberWroteReport:' + reviewer] = Boolean(member && events.some(event => event.sessionId === member.id && reportWrite(event,path)));
        checks['taskCompleted:' + reviewer] = Boolean(team?.tasks.some(task => task.assignee === reviewer && task.status === 'completed' && (phase !== 'cold' || !previous.taskIds.includes(task.id))));
    }
    const summary = readReport(workspace, summaryPath);
    checks.summary = Boolean(summary && typeof summary.summary === 'string' && summary.summary.length >= 20 && Array.isArray(summary.reports) && reportPaths.every(path => summary.reports.includes(path)));
    const summaryWrite = events.find(event => event.sessionId === captainId && reportWrite(event,summaryPath));
    const completed = events.filter(event => event.event === 'tool-result' && event.name === 'agent_teams_update_task' && !event.isError && event.arguments?.status === 'completed');
    checks.captainSummarizedAfterCompletion = Boolean(summaryWrite && completed.length >= targets.length && completed.every(event => event.order < summaryWrite.order));
    if (phase === 'cold') {
        checks.sameTeam = team?.id === previous.teamId;
        checks.sameMembers = Boolean(team && reviewers.every(name => team.members.find(member => member.name === name)?.id === previous.memberIds[name]));
        checks.exactlyOneNewTask = Boolean(team && team.tasks.length === previous.taskIds.length + 1 && previous.taskIds.every(id => team.tasks.some(task => task.id === id)));
    } else checks.exactTaskCount = team?.tasks.length === 3;
    return { passed: Object.values(checks).every(Boolean), checks, team: team && { teamId: team.id, captainId, memberIds: Object.fromEntries(team.members.map(member => [member.name, member.id])), taskIds: team.tasks.map(task => task.id), tasks: team.tasks.map(task => ({ id: task.id, assignee: task.assignee, status: task.status })) } };
}
