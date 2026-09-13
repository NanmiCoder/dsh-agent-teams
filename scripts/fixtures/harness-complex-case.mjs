/** Real-model implementation benchmark. Acceptance is outside the model workspace. */
import { readFileSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { teamIn, reportWrite, modelMetrics } from './harness-model-case.mjs';
export { modelMetrics };

const spec = `# MiniFulfill: persistent order service

Use Node.js built-ins only, ESM, no dependencies. Implement the exported contracts below.
Amounts are integer cents. All public return values must be detached from internal mutable state.
Errors are Error objects with numeric status and stable string code; error prose is not prescribed.

## src/pricing.mjs
export quoteOrder(lines, catalog).
catalog is [{sku, priceCents}]; lines is a nonempty array of {sku, quantity}.
sku is a nonempty string, quantity is integer 1..1000. Merge duplicate SKUs, sort by sku;
merged quantity must also be <=1000. Reject malformed lines/catalog and unsafe arithmetic with status 400.
Unknown SKU: 404. Each catalog SKU is unique, priceCents is a nonnegative safe integer.
Return {lines:[{sku,quantity,unitPriceCents,lineTotalCents}],totalCents}.
No floating point rounding, mutation of inputs or silently ignored bad entries.

## src/inventory.mjs
export createInventory(initialStock), where initialStock maps sku to nonnegative safe integers.
Return {reserve(orderId,lines),release(orderId),snapshot()}.
reserve validates and merges quantities using the same 1..1000 rules, checks ALL lines before decrementing,
returns a stock snapshot. Unknown sku:404; insufficient stock:409; malformed input:400.
Same orderId with the same normalized lines is idempotent (even after release); changed lines:409.
release restores once and returns snapshot, unknown/repeated release is a no-op.
snapshot is a detached plain object. Invalid calls must never partially change stock.

## src/store.mjs
export async openStore(filePath), return {read(),transact(mutator)}; both methods are async.
Initial state is {orders:[]}. Missing parent directories and missing file are created on first commit.
Existing invalid JSON must fail open, never reset silently. read returns a detached copy.
transact receives a private draft and may be async. Successful mutation persists atomically via temp file
and rename; return the mutator's result. Failure rolls back without writing; queue stays usable.
Serialize overlapping transactions in one store instance. A read after a completed transact sees it.
Persistence must survive close/reopen. Never leave a partially written JSON file on normal failures.

## src/server.mjs
export async startServer({catalog,stock,dataFile,port=0}). Bind 127.0.0.1 only.
Return {url,close()}, close is async and closes the listener. Use pricing, inventory and store modules.
State orders contain {id,key,lines,totalCents,status}, status is confirmed/cancelled; id is unique string.
GET /health ->200 {ok:true}.
POST /orders: JSON {lines}, required Idempotency-Key header (1..64 letters/digits/_/-).
New order ->201 order. Same key and normalized input ->200 original order, no new reservation,
including after cancellation/restart. Same key but different input ->409.
All creation and cancellation decisions use serialized persistent state: concurrent requests must not
oversell and must not create duplicate key rows. Insufficient stock ->409; unknown SKU ->404;
invalid key/body/quantity ->400. Invalid JSON ->400. Payload >16384 bytes ->413.
GET /orders/:id ->200 order or404. POST /orders/:id/cancel ->200 cancelled order, idempotent, or404.
GET /inventory ->200 {available:{sku:quantity}}, deriving available stock from confirmed orders.
Unknown routes ->404. All responses are JSON. Errors are {error:{code,message}} and must not leak stack
traces or absolute dataFile paths. Query strings do not change route matching. Percent-decode order IDs
safely: invalid URI encoding ->400, path-like unknown IDs ->404. Do not use IDs as filesystem paths.
Restart with the same dataFile must retain orders, idempotency and cancelled inventory.

## bin/orders.mjs
node bin/orders.mjs quote CATALOG_JSON LINES_JSON -> stdout JSON quoteOrder result, exit0.
node bin/orders.mjs audit DATA_JSON -> {orderCount,activeCount,totalBookedCents}, counting only confirmed
orders in totalBookedCents. Error -> nonzero exit and stderr JSON {error:{code,message}}, not stack trace.

## Delivery
Keep SPEC.md, fixtures/*.json, tests/public-contract.test.mjs and package.json unchanged.
Add meaningful tests under tests/ (unit, concurrent HTTP and restart behavior). npm test must pass.
Add README.md with API/CLI examples and reports/release.json containing {ready:true,summary:string}.
No network except loopback requests to your own temporary server. No dependency installs.
Do not read Harness configuration, plugin source, unrelated /tmp projects or external test controllers.
All writes are confined to this project. The captain delegates implementation; members write their files.
`;
export const sources = {
  'SPEC.md': spec,
  'package.json': JSON.stringify({name:'minifulfill-benchmark',private:true,type:'module',scripts:{test:'node --test tests/*.test.mjs'}},null,2)+'\n',
  'fixtures/catalog.json': '[{"sku":"A","priceCents":199},{"sku":"B","priceCents":250},{"sku":"FREE","priceCents":0}]\n',
  'fixtures/stock.json': '{"A":20,"B":10,"FREE":5}\n',
  'fixtures/lines.json': '[{"sku":"B","quantity":1},{"sku":"A","quantity":2}]\n',
  'src/pricing.mjs': 'export function quoteOrder() { throw new Error("TODO pricing"); }\n',
  'src/inventory.mjs': 'export function createInventory() { throw new Error("TODO inventory"); }\n',
  'src/store.mjs': 'export async function openStore() { throw new Error("TODO persistence"); }\n',
  'src/server.mjs': 'export async function startServer() { throw new Error("TODO HTTP service"); }\n',
  'bin/orders.mjs': 'process.stderr.write("TODO CLI\\n"); process.exitCode=1;\n',
  'tests/public-contract.test.mjs': `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {quoteOrder} from '../src/pricing.mjs';\ntest('cents and duplicate normalization',()=>assert.deepEqual(quoteOrder([{sku:'A',quantity:1},{sku:'A',quantity:2}],[{sku:'A',priceCents:199}]),{lines:[{sku:'A',quantity:3,unitPriceCents:199,lineTotalCents:597}],totalCents:597}));\n`,
};
const members = ['pricing','inventory','storage','api','verifier','reviewer'];
const scope = '项目目录会在本消息开头给出。将完整项目路径传给每个成员，所有相对路径均基于该项目；先读 SPEC.md。每条bash命令必须以cd 完整项目路径 && 开头，不依赖上次命令的cwd；测试器会拒绝缺少此前缀的命令。临时服务使用随机空闲端口并记录自己的PID，结束时调用close或仅停止这个PID；禁止pkill/killall按名字清理进程。';
export const freshPrompt = `请用 AgentTeams 真实实现 MiniFulfill 订单服务；我授权立即运行，不需计划审批。${scope}
不是只写报告：成员必须实现代码、运行测试并交付可启动的 HTTP 服务和 CLI。使用且仅使用六个成员：pricing、inventory、storage、api、verifier、reviewer。队长不要代写源码、测试或成员报告。
一次规划以下10个初始任务，subject保留方括号标记，以后交接用实际 task_id，不能硬猜 ID：
[SPEC] requirements，reviewer，根据现有 SPEC.md 输出明确验收；不修改 SPEC。所有实现依赖此任务。
[PRICE] implementation，pricing，src/pricing.mjs。
[STOCK] implementation，inventory，src/inventory.mjs。
[STORE] implementation，storage，src/store.mjs。
[API] implementation，api，src/server.mjs，依赖 PRICE、STOCK、STORE。
[CLI] implementation，api，bin/orders.mjs，依赖 PRICE、STORE。
[UNIT] verification，verifier，为三个基础模块新增单元测试，依赖 PRICE、STOCK、STORE。
[E2E] verification，verifier，为HTTP并发、幂等、取消、重启、错误边界新增集成测试，依赖 API、CLI、UNIT。
[REVIEW] review，reviewer，独立审查整体，reviewedTaskId指向API任务，依赖E2E和API；真实有阻断问题就 failed + needs_revision + findings，让自动repair/next review处理，禁止假装pass。
[RELEASE] integration，storage，依赖REVIEW和E2E，运行完整npm test，写README.md和reports/release.json。
每次create_task都显式传入上述kind和assignee，不能只写在subject或description中；本场景不使用无负责人的共享任务池。
为quality任务提供所需objective、inScope、acceptance、verify等契约；各implementation的inScope只覆盖各自文件，避免并行写冲突。不要在已有基础模块未完成时要求单组件通过整个尚未实现的系统测试。
所有成员遵守文件所有权；reviewer只读审查代码，verifier写tests，其他成员实现自己的模块。跨模块发现问题先通过团队消息协调。接口按SPEC精确实现，不增加依赖。
每次完成使用真实测试证据与实际changedFiles，带attempt_id更新状态并报告。队长处理阻塞与汇总；等待成员时结束当前轮，消息会唤醒你，不要循环查询status或调用sleep空等。
任务全部完成、成员空闲且验收通过后结束，保留这个团队供下一轮回归复核，不归档。`;
export const coldPrompt = `继续当前已有 MiniFulfill 团队，不重建或替换成员。${scope}
我在src/pricing.mjs注入了一个受控计价回归（属于测试场景中的外部改动），原实现快照在src/pricing.before-regression.mjs。原SPEC没有改变；不要修改验收标准或测试来迁就错误。队长和reviewer不得直接修源码。
请创建一个新的review任务，subject为[REGRESSION-REVIEW]，assignee=reviewer，reviewedTaskId指向原[PRICE] implementation；独立运行具体输入确认现在的错误，若有阻断问题就failed + needs_revision，findings明确file=src/pricing.mjs、实际差异与requiredFix。
另建[ATOMIC-REVIEW] review，assignee=reviewer，reviewedTaskId指向原[API] implementation，复核上一轮实际发现的F1（这是自然缺陷，非本次注入）。外部验收已经独立复现：stock A=1时创建A1订单，把dataFile移到备份并在原路径建立目录，取消请求因持久化rename失败返回500；还原原数据文件后订单仍confirmed，但GET /inventory错误显示A=1，可以导致超卖。用你自己项目内的临时数据复现后，将此数据一致性错误作为阻断级别high，failed + needs_revision + findings；自动repair由原api成员完成，仅修src/server.mjs并复审。不要沿用上一轮medium非阻断分类，不要由reviewer直接修改源码。
紧接着创建[REGRESSION-RELEASE] integration，assignee=storage，依赖上述两个新review，验收为全部测试通过、两个缺陷实际修复，且写reports/regression-release.json {ready:true,summary:string}。在review尚未完成时就建好这个下游任务，本场景要检验插件自动重连已有依赖；不要等审查结果再建，也不要手工修改这条依赖。
不要手工创建repair或下一轮review；让插件自动生成，原pricing成员负责修复、reviewer再次验证，确认通过后storage交付。每项新任务提供完整quality契约。保留原团队/成员/旧任务记录，不新增无关任务。`;
export const finishPrompt = `继续当前已有 MiniFulfill 团队。上个进程因测试时间窗口结束而停止，保留了原任务和成员；本次是恢复原工作，不是重新规划。${scope}
检查现有任务，恢复并完成尚未交付的项目内容。不要新建团队、成员或重复初始任务；也不要因为旧任务状态为in_progress就一直等待不存在的旧进程，必要时用团队工具恢复原负责人。已经通过的实现、测试及审查保留，只处理未完成事项。队长不代写成员文件。
全部初始任务完成后，确认README.md、reports/release.json {ready:true,summary:string}和完整npm test，保留团队以供下一轮回归验证。`;
export const resumeColdPrompt = `恢复当前已有的MiniFulfill回归返工流程，不重建团队、成员或已存在的[REGRESSION-REVIEW]、[ATOMIC-REVIEW]、[REGRESSION-RELEASE]任务。${scope}
上个测试进程为修复插件错误分类而被操作者停止：成员漏传attempt_id被误报为stale，导致不必要的重新分配。当前插件已区分缺参和真正过期；每次update_task都显式带当前任务attempt_id，缺参时按工具提示补齐重试，不要重做已取得的有效证据或再次建立同名任务。
计价+1分回归已经注入，原快照仍在pricing.before-regression.mjs，不能再注入。另一个待修缺陷仍是取消请求持久化失败会提前释放库存。恢复原负责人，完成两项独立review的failed + needs_revision + high findings，再由插件自动创建repair和再审；不要手动创建repair/review后继，不修改已有下游依赖。两条自动修复和复审都通过后，原storage成员交付reports/regression-release.json和全量测试证据，保留所有团队和历史。`;

export function coldPromptFor(plan) {
  if(plan?.expectAtomicity!==false)return coldPrompt;
  return coldPrompt.split('\n').filter(line=>!line.startsWith('另建[ATOMIC-REVIEW]')).join('\n')
    .replace('依赖上述两个新review','依赖上述新review').replace('两个缺陷实际修复','计价回归实际修复');
}
export function resumeColdPromptFor(plan) {
  if(plan?.expectAtomicity!==false)return resumeColdPrompt;
  return `恢复已有MiniFulfill计价回归流程，不重建团队或成员，不重复创建[REGRESSION-REVIEW]和[REGRESSION-RELEASE]。${scope}
计价回归已经注入，快照仍在pricing.before-regression.mjs，不再注入。上轮因诊断中断，请恢复原负责人并完成原审查、自动repair、自动再审、既有下游交付。每次update_task显式带当前attempt_id，缺参时补齐重试，不重做有效证据。不要手动创建repair或修改已有交付依赖。取消原子性外部检查已经通过，不要虚构那个缺陷或增加ATOMIC-REVIEW。保留团队和历史。`;
}
export function selectColdPlan(external) {
  const atomic=external.checks?.find(check=>check.name==='failed cancellation persistence cannot release phantom inventory');
  if(!atomic||external.protectedFilesUnchanged!==true||external.checks.some(check=>check!==atomic&&!check.passed)) {
    throw Error('Continuation needs valid protected files and passing non-atomicity checks; do not inject over an unrelated failure');
  }
  if(!atomic.passed&&!atomic.error?.includes('failed commit released inventory')) throw Error('The observed failure does not establish the specific phantom-inventory defect');
  return {expectAtomicity:!atomic.passed,preflight:external};
}
export async function prepareContinuation(workspace) {
  const source=join(workspace,'src/pricing.mjs'), backup=join(workspace,'src/pricing.before-regression.mjs');
  if(existsSync(backup))throw Error('Regression already injected; refuse to overwrite evidence');
  const plan=selectColdPlan(await verifySeededBehavior(workspace));
  copyFileSync(source,backup);
  writeFileSync(source,"// Controlled benchmark regression: external change after initial delivery.\nimport {quoteOrder as before} from './pricing.before-regression.mjs';\nexport function quoteOrder(...args) { const value=before(...args); return {...value,totalCents:value.totalCents+1}; }\n");
  return plan;
}
export function evaluate(workspace,captainId,events,phase,previous) {
  const team=teamIn(workspace,captainId), tasks=team?.tasks??[], checks={};
  checks.exactRoster=Boolean(team&&team.members.length===6&&members.every(name=>team.members.some(m=>m.name===name&&m.id&&m.status!=='removed')));
  checks.teamRunning=Boolean(team&&team.phase!=='staged'&&!team.halted&&!team.escalated);
  checks.noUnfinishedTasks=tasks.length>=10&&tasks.every(t=>['completed','failed'].includes(t.status));
  checks.noFailedWork=tasks.every(t=>t.status!=='failed'||['review','requirements'].includes(t.kind));
  const regression=phase==='cold'||phase==='cold-resume';
  const releasePath=regression?'reports/regression-release.json':'reports/release.json';
  try {const r=JSON.parse(readFileSync(join(workspace,releasePath),'utf8'));checks.release=r.ready===true&&typeof r.summary==='string'&&r.summary.length>20;}catch{checks.release=false;}
  if(regression) {
    checks.sameTeam=team?.id===previous.teamId;
    checks.sameMembers=Boolean(team&&members.every(name=>team.members.find(m=>m.name===name)?.id===previous.memberIds[name]));
    const added=tasks.filter(t=>!previous.taskIds.includes(t.id));
    const review=added.find(t=>t.subject.includes('[REGRESSION-REVIEW]'));
    const repair=added.find(t=>t.kind==='repair'&&t.sourceTaskId===review?.reviewedTaskId);
    const rereview=added.find(t=>t.kind==='review'&&t.reviewedTaskId===repair?.id);
    const release=added.find(t=>t.subject.includes('[REGRESSION-RELEASE]'));
    checks.regressionDetected=review?.status==='failed'&&review.verdict==='needs_revision'&&(review.findings?.length??0)>0;
    checks.automaticRepair=repair?.status==='completed'&&repair.assignee==='pricing'&&!events.some(e=>e.event==='tool-result'&&e.name==='agent_teams_create_task'&&e.arguments?.kind==='repair');
    checks.independentRereview=rereview?.status==='completed'&&rereview.verdict==='pass'&&rereview.assignee==='reviewer';
    checks.downstreamRewired=release?.status==='completed'&&release.dependencies.includes(rereview?.id)&&!release.dependencies.includes(review?.id);
    checks.downstreamExistedBeforeFailure=events.some(e=>e.event==='benchmark-state'&&e.team?.tasks?.some(t=>t.id===release?.id&&t.dependencies.includes(review?.id))&&e.team.tasks.some(t=>t.id===review?.id&&!['completed','failed','cancelled'].includes(t.status)));
    checks.noManualDependencyRewrite=!events.some(e=>e.event==='tool-result'&&e.name==='agent_teams_edit_plan'&&e.arguments?.operations?.some(op=>op.task_id===release?.id&&op.dependencies!==undefined));
    const atomicReview=added.find(t=>t.subject.includes('[ATOMIC-REVIEW]'));
    if(previous?.coldPlan?.expectAtomicity!==false) {
    const atomicRepair=added.find(t=>t.kind==='repair'&&t.sourceTaskId===atomicReview?.reviewedTaskId);
    const atomicRereview=added.find(t=>t.kind==='review'&&t.reviewedTaskId===atomicRepair?.id);
    checks.naturalDefectReviewed=atomicReview?.status==='failed'&&atomicReview.verdict==='needs_revision';
    checks.naturalDefectAutomaticallyRepaired=atomicRepair?.status==='completed'&&atomicRepair.assignee==='api';
    checks.naturalDefectRereviewed=atomicRereview?.status==='completed'&&atomicRereview.verdict==='pass'&&atomicRereview.assignee==='reviewer';
    checks.bothReviewDependenciesRewired=release?.dependencies.includes(atomicRereview?.id)&&!release.dependencies.includes(atomicReview?.id);
    } else checks.noUnrequestedAtomicReview=atomicReview===undefined;
  }else {
    if(phase==='finish') {
      checks.sameTeam=team?.id===previous.teamId;
      checks.sameMembers=Boolean(team&&members.every(name=>team.members.find(m=>m.name===name)?.id===previous.memberIds[name]));
      checks.sameTasks=tasks.length===previous.taskIds.length&&previous.taskIds.every(id=>tasks.some(t=>t.id===id));
    }
    checks.fullDag=['SPEC','PRICE','STOCK','STORE','API','CLI','UNIT','E2E','REVIEW','RELEASE'].every(tag=>tasks.filter(t=>t.subject.includes('['+tag+']')).length===1);
    for(const [name,path] of [['pricing','src/pricing.mjs'],['inventory','src/inventory.mjs'],['storage','src/store.mjs'],['api','src/server.mjs'],['api','bin/orders.mjs']]) {
      const id=team?.members.find(m=>m.name===name)?.id;
      checks['memberWrote:'+path]=!!id&&events.some(e=>e.sessionId===id&&reportWrite(e,path));
    }
    checks.captainDidNotImplement=!events.some(e=>e.sessionId===captainId&&['src/pricing.mjs','src/inventory.mjs','src/store.mjs','src/server.mjs','bin/orders.mjs'].some(path=>reportWrite(e,path)));
  }
  return {passed:Object.values(checks).every(Boolean),checks,team:team&&{teamId:team.id,captainId,memberIds:Object.fromEntries(team.members.map(m=>[m.name,m.id])),taskIds:tasks.map(t=>t.id),tasks:tasks.map(t=>({id:t.id,subject:t.subject,kind:t.kind,assignee:t.assignee,status:t.status,dependencies:t.dependencies,verdict:t.verdict,reviewedTaskId:t.reviewedTaskId,sourceTaskId:t.sourceTaskId}))}};
}
export async function verifySeededBehavior(workspace) {
  const protectedPaths=Object.keys(sources).filter(p=>p==='SPEC.md'||p==='package.json'||p.startsWith('fixtures/')||p==='tests/public-contract.test.mjs');
  const unchanged=protectedPaths.every(p=>existsSync(join(workspace,p))&&readFileSync(join(workspace,p),'utf8')===sources[p]);
  try {
    const {stdout}=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./harness-complex-oracle.mjs',import.meta.url)),workspace],{timeout:45000,maxBuffer:2*1024*1024});
    const external=JSON.parse(stdout);
    return {...external,protectedFilesUnchanged:unchanged,passed:external.passed&&unchanged};
  }catch(error){return {passed:false,protectedFilesUnchanged:unchanged,error:String(error.message).slice(0,2000),stderr:error.stderr?.slice(-2000)};}
}
