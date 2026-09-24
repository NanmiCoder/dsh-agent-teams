/** Real Loader, Agent loops, tools and continuation forest; only the LLM is scripted. */
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';

const requests = [], commands = [], gates = new Map(), memberResponses = new Map();
let captainId, seq = 0;
const model = { provider: 'runtime-lab', id: 'fixture-model', name: 'Stability fixture', context: { contextWindow: 262144 }, defaultMaxTokens: 8192 };
function record(data) { appendFileSync(process.env.LAB_TRACE, JSON.stringify({ ...data, time: Date.now() }) + '\n'); }
function chunks(text, tool) {
  const block = tool ? { type: 'tool-call', id: ToolCallId(`stability-${++seq}`), name: tool.name, arguments: JSON.stringify(tool.args) } : { type: 'text', text };
  return [{ type: 'block-start', index: 0, blockType: block.type }, tool ? { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments } : { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block }, { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }, { type: 'finish', reason: { kind: tool ? 'tool-calls' : 'stop' } }];
}
async function until(predicate, label) {
  const end = Date.now() + 15000;
  while (!await predicate()) { assert.ok(Date.now() < end, `Timed out: ${label}`); await new Promise(r => setTimeout(r, 10)); }
}
async function gate(id, signal) {
  signal?.throwIfAborted();
  await new Promise((resolve, reject) => {
    const abort = () => { gates.delete(id); reject(signal.reason); };
    gates.set(id, () => { signal?.removeEventListener('abort', abort); gates.delete(id); resolve(); });
    signal?.addEventListener('abort', abort, { once: true });
  });
}
class StabilityAdapter extends LlmAdapter {
  async listModels() { return [model]; }
  async resolveModel(provider, id) { return { ...model, provider, id }; }
  async *stream(options) {
    if (options.purpose) { yield* chunks('Stability lab'); return; }
    const blocks = options.messages.flatMap(m => m.content ?? []);
    const failed = blocks.find(b => b.type === 'tool-result' && b.isError);
    if (failed) record({event:'observed-tool-error',failed});
    const userText = options.messages.filter(m => m.role === 'user').flatMap(m => m.content.filter(b => b.type === 'text').map(b => b.text)).join('\n');
    const request = { event: 'stability-request', sessionId: options.sessionId, userText, messages: options.messages };
    requests.push(request); record(request);
    if (options.sessionId === captainId) { yield* chunks('CAPTAIN_IDLE', commands.shift()); return; }
    await gate(options.sessionId, options.signal);
    const tool = memberResponses.get(options.sessionId) ?? { name: 'lab_step', args: {} };
    memberResponses.delete(options.sessionId);
    yield* (tool.finish ? chunks('Closing summary of the already delivered result.') : chunks('', tool));
  }
}
export const name = 'runtime-lab-stability';
export const inject = ['llm', 'agents', 'sessions', 'subagents', 'tools'];
export function apply(ctx) {
  ctx.on('tools/result',(exec,result)=>record({event:'probe-tool-result',name:exec.name,args:exec.arguments,result}));
  ctx.llm.registerAdapter(['runtime-lab'], new StabilityAdapter());
  ctx.tools.register({ name: 'lab_step', description: 'Deterministic local step boundary', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { return 'STEP_OK'; } });
  void (async () => {
    await ctx.get('loader').await();
    const captain = await ctx.agents.create({ sessionId: 'session-' + randomUUID(), meta: { cwd: process.cwd() }, agentOptions: { provider: 'runtime-lab', model: 'fixture-model' } });
    captainId = captain.agent.id;
    const root = join(process.cwd(), '.agent-teams'), file = join(root, 'stability/team.json');
    const state = () => JSON.parse(readFileSync(file, 'utf8'));
    const mail = name => { const p = join(root, `stability/inbox/${name}.jsonl`); return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []; };
    async function run(...items) {
      commands.push(...items);
      captain.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Execute the authorized stability scenario commands.' }] }));
      await captain.agent.whenIdle();
      assert.equal(commands.length, 0, 'captain did not execute all scripted tools');
    }
    const cmd = (name, args = {}) => ({ name: `agent_teams_${name}`, args });
    await run(cmd('create', { name: 'stability', description: 'Issue 159 probes', approval: 'required' }), cmd('add_member', { name: 'worker' }), cmd('add_member', { name: 'peer' }), cmd('create_task', { subject: 'Long working turn', assignee: 'worker' }), cmd('create_task', { subject: 'Parallel peer', assignee: 'peer' }), cmd('create_task', {subject:'Dependent orphan', assignee:'peer', dependencies:['t1']}));
    record({event:'probe-staged-assignees',tasks:state().tasks.map(t=>({id:t.id,assignee:t.assignee}))});
    await run(cmd('approve', {confirmation:'Authorized regression test'}));
    const workerId=state().members.find(m=>m.name==='worker').id;
    const peerId=state().members.find(m=>m.name==='peer').id;
    await until(()=>gates.has(workerId)&&gates.has(peerId),'both working');
    for(const [id,taskId] of [[workerId,'t1'],[peerId,'t2']]) {
      const before=requests.filter(r=>r.sessionId===id).length;
      memberResponses.set(id,{name:'agent_teams_claim_task',args:{task_id:taskId}});gates.get(id)();
      await until(()=>gates.has(id)&&requests.filter(r=>r.sessionId===id).length>before,'claim before burst');
    }

    await run(...Array.from({length:20},(_,i)=>cmd('send_message',{to:'worker',content:`CAPTAIN_BURST_${i}`})));
    for(let i=0;i<20;i++) {
      const before=requests.filter(r=>r.sessionId===peerId).length;
      memberResponses.set(peerId,{name:'agent_teams_send_message',args:{to:'worker',content:`PEER_BURST_${i}`}});
      gates.get(peerId)();
      await until(()=>gates.has(peerId)&&requests.filter(r=>r.sessionId===peerId).length>before,'peer sent');
    }
    const worker=ctx.agents.get(workerId);
    record({event:'probe-burst-queued',nextStep:worker.inbox.nextStep.length,nextTurn:worker.inbox.nextTurn.length,unread:mail('worker').filter(m=>!m.readAt).length});
    const before=requests.filter(r=>r.sessionId===workerId).length;
    gates.get(workerId)();
    await until(()=>gates.has(workerId)&&requests.filter(r=>r.sessionId===workerId).length>before,'worker next step');
    const last=requests.filter(r=>r.sessionId===workerId).at(-1);
    record({event:'probe-burst-next-step',captainMessages:(last.userText.match(/CAPTAIN_BURST_\d+/g)||[]).length,peerMessages:(last.userText.match(/PEER_BURST_\d+/g)||[]).length,nextTurn:worker.inbox.nextTurn.length});
    await run(cmd('send_message',{to:'worker',content:'STALE_GUIDANCE_MUST_NOT_RUN'}));
    const previous=state().tasks[0];
    await run(cmd('reassign_task',{task_id:'t1',assignee:'worker',reason:'Refresh same member'}));
    const current=state().tasks[0];
    record({event:'probe-same-reassign',beforeAttempt:previous.attempt,afterAttempt:current.attempt,beforeId:previous.attemptId,afterId:current.attemptId,status:current.status});
    await until(()=>gates.has(workerId),'worker ready after reassign');
    record({event:'probe-stale-after-reassign',oldGuidanceInLatest:requests.filter(r=>r.sessionId===workerId).at(-1).userText.includes('STALE_GUIDANCE_MUST_NOT_RUN')});
    let beforeStep=requests.filter(r=>r.sessionId===workerId).length;
    memberResponses.set(workerId,{name:'agent_teams_update_task',args:{task_id:'t1',attempt_id:current.attemptId,status:'cancelled',output:'Cancelled upstream'}}); gates.get(workerId)();
    await until(()=>gates.has(workerId)&&requests.filter(r=>r.sessionId===workerId).length>beforeStep,'cancel upstream');
    await run(cmd('update_task',{task_id:'t3',status:'cancelled',output:'Remove orphan'}));
    record({event:'probe-cancel-dependent',upstream:state().tasks[0].status,dependent:state().tasks[2].status});
    const pt=state().tasks[1];
    for(const args of [{task_id:'t2',attempt_id:pt.attemptId,status:'in_progress'},{task_id:'t2',attempt_id:pt.attemptId,status:'completed',output:'Initial result'},{task_id:'t2',attempt_id:pt.attemptId,status:'completed',commandsRun:[{command:'SUPPLEMENTAL_EVIDENCE',status:'passed',exitCode:0}]},{task_id:'t2',attempt_id:pt.attemptId,status:'completed',output:'Supplemental result'}]) {
      const n=requests.filter(r=>r.sessionId===peerId).length;
      memberResponses.set(peerId,{name:'agent_teams_update_task',args}); gates.get(peerId)();
      await until(()=>gates.has(peerId)&&requests.filter(r=>r.sessionId===peerId).length>n,'update peer');
    }
    record({event:'probe-terminal-evidence',task:state().tasks[1]});
    record({event:'probe-complete'});
    await ctx.sessions.flush(captain.agent.session);
    await captain.dispose();
    process.stdout.write('STABILITY_OK\n'); ctx.get('appExit')(0);
  })().catch(error => { process.stderr.write(String(error.stack ?? error) + '\n'); ctx.get('appExit')(1); });
}
