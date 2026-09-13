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
    assert.equal(failed, undefined, `Real tool failed: ${JSON.stringify(failed)}`);
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
    await run(cmd('create', { name: 'stability', description: 'Stability regression', approval: 'required' }), cmd('add_member', { name: 'worker' }), cmd('add_member', { name: 'blocked' }), cmd('create_task', { subject: 'Long working turn', assignee: 'worker' }), cmd('create_task', { subject: 'Dependency blocked task', assignee: 'blocked', dependencies: ['t1'] }));
    assert.equal(requests.filter(r => r.sessionId !== captainId).length, 0, 'staged roster must not call a model');
    await run(cmd('approve', { confirmation: 'User approved the deterministic test plan' }));
    const workerId = state().members.find(m => m.name === 'worker').id;
    await until(() => gates.has(workerId), 'first actual assignment');
    assert.equal(state().members.find(m => m.name === 'blocked').id, '', 'dependency-blocked member must stay dormant');
    const first = requests.find(r => r.sessionId === workerId);
    assert.match(first.userText, /AgentTeams automatic task assignment/);
    assert.doesNotMatch(first.userText, /You have joined/);
    assert.match(first.userText, /Long working turn/);
    assert.equal(requests.filter(r => r.sessionId !== captainId).length, 1, 'only ready worker may call model');
    record({ event: 'stability-lazy-start-passed', readyRequests: 1, blockedRequests: 0, welcomeRequests: 0 });
    await run(cmd('edit_plan', { operations: [{ action: 'update_task', task_id: 't2', description: 'Corrected pending contract before execution', dependencies: ['t1'] }] }),
      cmd('create_task', { subject: 'Abandoned planning mistake', assignee: 'blocked', dependencies: ['t1'] }),
      cmd('update_task', { task_id: 't3', status: 'cancelled', output: 'Captain cancelled before the first attempt.' }));
    assert.equal(state().tasks[1].description, 'Corrected pending contract before execution');
    assert.equal(state().tasks[1].status, 'pending');
    assert.equal(state().tasks[2].status, 'cancelled');
    assert.equal(state().tasks[2].attempt, 0);
    assert.equal(state().members.find(m => m.name === 'blocked').id, '');
    assert.equal(requests.filter(r => r.sessionId !== captainId).length, 1);
    record({ event: 'stability-running-plan-correction-passed', pendingEdit: true, captainCancellation: true, blockedRequests: 0 });
    await run(...Array.from({ length: 32 }, (_, i) => cmd('send_message', { to: 'worker', content: `GUIDANCE_${i}` })));
    assert.equal(mail('worker').filter(m => m.deliveredAt && !m.readAt).length, 32, 'accepted input must remain unread before a step');
    const worker = ctx.agents.get(workerId);
    assert.equal(worker.inbox.nextTurn.length, 0, 'coordination must not wait for turn completion');
    assert.equal(worker.inbox.nextStep.length, 32);
    gates.get(workerId)();
    await until(() => requests.filter(r => r.sessionId === workerId).length === 2 && gates.has(workerId), 'second working step');
    const second = requests.filter(r => r.sessionId === workerId)[1];
    assert.match(second.userText, /GUIDANCE_0/); assert.match(second.userText, /GUIDANCE_31/);
    assert.equal(mail('worker').filter(m => m.readAt).length, 32);
    record({ event: 'stability-steering-passed', queuedMessages: 32, modelStepsUntilConsumed: 1 });
    // A status tool can read inbox mail before the queued receipt reaches the
    // next step. Filtering that duplicate must preserve the active turn.
    await run(cmd('send_message', { to: 'worker', content: 'STATUS_RECEIPT_RACE' }));
    memberResponses.set(workerId, { name: 'agent_teams_status', args: {} });
    gates.get(workerId)();
    await until(() => requests.filter(r => r.sessionId === workerId).length === 3 && gates.has(workerId), 'tool continuation after already-read receipt');
    assert.match(JSON.stringify(requests.filter(r => r.sessionId === workerId).at(-1).messages), /STATUS_RECEIPT_RACE/);
    assert.equal(mail('worker').filter(m => !m.readAt).length, 0);
    record({ event: 'stability-read-receipt-continuation-passed', modelContinued: true });
    // Drain a still-running attempt with unconsumed guidance, then resume the
    // same durable member with a new generation. Old guidance must disappear.
    await run(cmd('send_message', { to: 'worker', content: 'STALE_GUIDANCE_MUST_NOT_RUN' }));
    const previousAttempt = state().tasks[0].attemptId;
    await run(cmd('reassign_task', { task_id: 't1', assignee: 'worker', reason: 'Replace the working attempt' }));
    await until(() => gates.has(workerId), 'same member cold-resumed after drain');
    assert.equal(state().members.find(m => m.name === 'worker').id, workerId);
    assert.notEqual(state().tasks[0].attemptId, previousAttempt);
    assert.doesNotMatch(requests.filter(r => r.sessionId === workerId).at(-1).userText, /STALE_GUIDANCE_MUST_NOT_RUN/);
    record({ event: 'stability-reassign-passed', sameMember: true, staleInputExcluded: true });
    const liveWorker = ctx.agents.get(workerId);
    const start = (parent, label) => ctx.subagents.startContinuable({ provider: 'spawn', label, request: { parent, prompt: [{ type: 'text', text: label }], maxDepth: 3, agentOptions: { provider: 'runtime-lab', model: 'fixture-model' } }, signal: new AbortController().signal });
    const grandchild = await start(liveWorker, 'historical-nested-branch');
    const sibling = await start(captain.agent, 'unrelated-sibling');
    await until(() => gates.has(grandchild.childId) && gates.has(sibling.childId), 'concurrent independent branches');
    const grandAgent = ctx.agents.get(grandchild.childId), siblingAgent = ctx.agents.get(sibling.childId);
    await run(...Array.from({ length: 32 }, (_, i) => cmd('send_message', { to: 'worker', content: `ARCHIVED_${i}` })));
    const callsBefore = requests.filter(r => r.sessionId !== captainId && r.sessionId !== sibling.childId).length;
    await run(cmd('delete'));
    assert.equal(existsSync(file), false);
    assert.ok(existsSync(join(root, 'archive/stability/team.json')));
    assert.equal(ctx.agents.get(workerId), undefined);
    assert.equal(ctx.agents.get(grandchild.childId), undefined);
    assert.equal(liveWorker.inbox.nextTurn.length + liveWorker.inbox.nextStep.length, 0);
    assert.equal(grandAgent.inbox.nextTurn.length + grandAgent.inbox.nextStep.length, 0);
    assert.equal(siblingAgent.status, 'running', 'unrelated sibling must survive selected teardown');
    const content = [{ type: 'text', text: 'MUST_NOT_RESUME_ARCHIVED_MEMBER' }], signal = new AbortController().signal;
    const runtime = ctx.subagents;
    await assert.rejects(() => typeof runtime.followup === 'function' ? runtime.followup(captain.agent, workerId, content, { source: { kind: 'user' }, signal })
      : typeof runtime[Symbol.for('dsh.subagent.deliverPrompt')] === 'function' ? runtime[Symbol.for('dsh.subagent.deliverPrompt')](captain.agent, workerId, content, { kind: 'user' }, signal, 'queue')
      : runtime[Symbol.for('dsh.subagent.queuePrompt')](captain.agent, workerId, content, { kind: 'user' }, signal), /retired/);
    assert.equal(requests.filter(r => r.sessionId !== captainId && r.sessionId !== sibling.childId).length, callsBefore);
    await ctx.subagents.drainContinuableChildren(captain.agent, [sibling.childId]);
    await captain.agent.whenIdle();
    record({ event: 'stability-archive-passed', pendingMessagesCleared: 32, descendantsStopped: true, siblingPreserved: true, retiredResumeRejected: true });
    const beforeBatchRequests = requests.filter(r => r.sessionId !== captainId).length;
    const plan = { members: Array.from({ length: 5 }, (_, i) => ({ name: `member-${i}` })), tasks: Array.from({ length: 6 }, (_, i) => ({ id: `local-${i}`, subject: `Work ${i}`, assignee: `member-${i % 5}`, dependencies: i === 0 ? [] : [`local-${i - 1}`] })) };
    await run(cmd('create', { name: 'batch-plan', description: 'Five members and six tasks in one planning call', approval: 'required', plan }));
    const batch = JSON.parse(readFileSync(join(root, 'batch-plan/team.json'), 'utf8'));
    assert.equal(batch.members.length, 5); assert.equal(batch.tasks.length, 6);
    assert.ok(batch.members.every(m => m.id === '')); assert.ok(batch.tasks.every(t => t.status === 'pending'));
    assert.equal(batch.tasks[5].dependencies[0], batch.tasks[4].id);
    assert.equal(requests.filter(r => r.sessionId !== captainId).length, beforeBatchRequests);
    record({ event: 'stability-batch-plan-passed', members: 5, tasks: 6, setupToolCalls: 1, previousEquivalentToolCalls: 12, memberModelRequests: 0 });
    await run(cmd('delete'));
    await run(cmd('create', { name: 'settlement', description: 'One completion report, one parent wake', plan: { members: [{ name: 'worker' }], tasks: [{ id: 'job', subject: 'Report and finish', assignee: 'worker' }] } }));
    const settledFile = join(root, 'settlement/team.json');
    const settledState = () => JSON.parse(readFileSync(settledFile, 'utf8'));
    const settledId = settledState().members[0].id;
    await until(() => gates.has(settledId), 'settlement worker ready');
    const attempt = settledState().tasks[0].attemptId;
    for (const update of [{ name: 'agent_teams_update_task', args: { task_id: 't1', attempt_id: attempt, status: 'in_progress' } },
      { name: 'agent_teams_update_task', args: { task_id: 't1', attempt_id: attempt, status: 'completed', output: 'Task result is complete.' } }]) {
      memberResponses.set(settledId, update); gates.get(settledId)();
      await until(() => gates.has(settledId), 'next settlement worker step');
    }
    const parentBeforeReport = requests.filter(r => r.sessionId === captainId).length;
    memberResponses.set(settledId, { name: 'agent_teams_send_message', args: { to: 'captain', content: 'Task t1 completed with verified result.' } });
    gates.get(settledId)();
    await until(() => gates.has(settledId) && requests.filter(r => r.sessionId === captainId).length > parentBeforeReport, 'completion report wakes parent');
    await captain.agent.whenIdle();
    const parentAfterReport = requests.filter(r => r.sessionId === captainId).length;
    const settledAgent = ctx.agents.get(settledId);
    memberResponses.set(settledId, { finish: true }); gates.get(settledId)();
    await settledAgent.whenIdle();
    await until(() => ctx.agents.get(settledId) === undefined, 'native activation settles');
    await captain.agent.whenIdle();
    assert.equal(requests.filter(r => r.sessionId === captainId).length, parentAfterReport, 'a delivered completion must not wake the parent again');
    record({ event: 'stability-settlement-dedup-passed', reportWakes: parentAfterReport - parentBeforeReport, duplicateModelRequests: 0 });
    await run(cmd('delete'));
    await ctx.sessions.flush(captain.agent.session);
    await captain.dispose();
    process.stdout.write('STABILITY_OK\n'); ctx.get('appExit')(0);
  })().catch(error => { process.stderr.write(String(error.stack ?? error) + '\n'); ctx.get('appExit')(1); });
}
