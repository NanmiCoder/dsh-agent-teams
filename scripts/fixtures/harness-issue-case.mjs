/** Real-provider issue regression. Files and native model/tool events are the oracle. */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
export const scenario = 'repair-conflict';
const spawnCase = ['renamed', 'disabled'].includes(scenario);
export const sources = spawnCase ? { 'input.txt': 'REAL_MEMBER_OK\n' } : scenario === 'amend' ? {
  'docs/note.txt': 'unchanged\n',
  'check-result.mjs': "import{readFileSync}from'node:fs';import assert from'node:assert/strict';assert.equal(readFileSync('src/result.txt','utf8').trim(),'AMEND_OK');\n",
} : {
  'data/sample.txt': 'hello world\n', 'README.md': '3 words\n',
  'check-data.mjs': "import{readFileSync}from'node:fs';import assert from'node:assert/strict';assert.equal(readFileSync('data/sample.txt','utf8'),'hello world\\n');\n",
};
const guard = '请用AgentTeams执行真实验证，立即运行无需审批。所有文件操作限制在消息开头指定的项目目录，给成员传递完整目录。队长不代写文件，不绕过契约，不读取项目以外的文件或插件配置。保留团队以便复核。禁止在agent_teams_create中使用plan参数；先仅建空团队再添加成员，必须用agent_teams_create_task并显式传kind创建任务，禁止创建占位work任务。创建review前核实其reviewedTaskId指向kind=implementation的SEED任务，不得指向work任务。';
export const freshPrompt = guard + (spawnCase
  ? '只添加一位worker成员，创建且仅创建一个普通work任务。worker读取input.txt并将其内容原样写入output.txt，实际验证字节相同，完成任务并报告。队长等待成员完成后结束。'
  : scenario === 'amend'
  ? '只添加worker成员。创建implementation任务[AMEND]，objective=Write src/result.txt with AMEND_OK，inScope=["docs/"]，acceptance=["src/result.txt contains AMEND_OK"]，verify=["node check-result.mjs"]。这是故意错误的范围。队长必须调用agent_teams_amend_task将inScope全量替换为["src/result.txt"]，reason="Objective targets src/result.txt but original scope only allows docs"。不要取消或重建任务。通知worker读取修订后的契约，写文件、真实运行验证，并用真实changedFiles及验收证据完成原任务。'
  : '仅两个成员worker和reviewer。先创建implementation任务[SEED]分配worker，inScope=["data/sample.txt"]，' + (scenario === 'repair-conflict' ? 'outOfScope=["README.md"]（只对SEED有效，后续修复应允许README.md），' : '') + 'acceptance=["data/sample.txt has hello world"]，verify=["node check-data.mjs"]。要求保留seed内容运行验证后完成，changedFiles可以为空。再创建review任务[REVIEW]分配reviewer，依赖并reviewedTaskId指向[SEED]；objective=Review README accuracy，acceptance=["README accurately describes data/sample.txt"]。reviewer独立读两文件，确认错误后必须提交failed+needs_revision和high finding：id=F_DOC，file=data/sample.txt，problem=README incorrectly describes the sample，requiredFix=Edit README.md so its complete text is the literal string 2 words followed by a newline. Keep data/sample.txt unchanged. 等系统自动生成repair，禁止手工创建repair、调用amend_task或队长改文件。worker执行自动repair，修改README.md为2 words，真实运行验证并使用changedFiles=["README.md"]提交。reviewer完成自动复审，问题解决应pass并标记原finding resolved=true。遇到阻碍如实报告，不绕过契约。');
export const coldPrompt = freshPrompt;
function teamIn(workspace, captainId) {
  const root = join(workspace, '.agent-teams');
  if (!existsSync(root)) return undefined;
  return readdirSync(root).flatMap(id => { const p=join(root,id,'team.json'); return existsSync(p)?[JSON.parse(readFileSync(p,'utf8'))]:[]; }).find(t=>t.captainSessionId===captainId);
}
export function evaluate(workspace, captainId, events) {
  const team=teamIn(workspace,captainId), tasks=team?.tasks??[];
  const members=events.filter(e=>e.event==='model-request'&&e.sessionId!==captainId&&!e.purpose);
  const checks={realMember:members.length>0,membersCannotAmend:members.every(e=>!e.teamTools?.includes('agent_teams_amend_task'))};
  if(spawnCase){checks.memberStarted=team?.members.length===1&&!!team.members[0].id;checks.taskCompleted=tasks.length===1&&tasks[0].status==='completed';}
  else if(scenario==='amend'){
    const task=tasks.find(t=>t.subject.includes('[AMEND]'));
    checks.sameTaskCompleted=task?.status==='completed';checks.revisionPersisted=task?.revisions?.some(r=>r.previous?.inScope?.includes('docs/'))===true;
    checks.amendCalled=events.some(e=>e.event==='tool-result'&&e.name==='agent_teams_amend_task'&&!e.isError);
  }else{
    const repair=tasks.find(t=>t.kind==='repair');
    const source=tasks.find(t=>t.id===repair?.sourceTaskId);
    checks.correctSource=source?.kind==='implementation';
    if(scenario==='repair-conflict')checks.originalExclusionPresent=source?.outOfScope?.includes('README.md')===true;
    checks.automaticRepair=!!repair&&!events.some(e=>e.event==='tool-result'&&e.name==='agent_teams_create_task'&&e.arguments?.kind==='repair');
    checks.scopeIncludesTarget=repair?.inScope?.includes('README.md')===true;
    checks.noInheritedExclusion=!repair?.outOfScope?.includes('README.md');
    checks.repairCompleted=repair?.status==='completed';checks.reviewCompleted=tasks.some(t=>t.kind==='review'&&t.verdict==='pass'&&t.status==='completed');
  }
  return {passed:Object.values(checks).every(Boolean),checks,team:team?{captainId,teamId:team.id,tasks,members:team.members}:undefined};
}
export async function verifySeededBehavior(workspace) {
  const read=p=>existsSync(join(workspace,p))?readFileSync(join(workspace,p),'utf8'):null;
  const unchanged=Object.entries(sources).filter(([p])=>p!=='README.md').every(([p,s])=>read(p)===s);
  return {passed:unchanged&&(spawnCase?read('output.txt')===sources['input.txt']:scenario==='amend'?read('src/result.txt')?.trim()==='AMEND_OK':read('README.md')?.trim()==='2 words'),seedUnchanged:unchanged};
}
export function modelMetrics(events,captainId){return{requests:events.filter(e=>e.event==='model-request').length,memberRequests:events.filter(e=>e.event==='model-request'&&e.sessionId!==captainId&&!e.purpose).length};}
