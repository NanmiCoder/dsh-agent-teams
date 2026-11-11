import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm';
import { executeTool } from './fixture-tools.mjs';

export const name = 'runtime-lab-reroute';
export const inject = ['agents', 'sessions', 'tools'];
export function apply(ctx) {
    void (async () => {
        await ctx.get('loader').await();
        const sessionId = 'session-' + randomUUID();
        const handle = await ctx.agents.create({ sessionId, meta: { cwd: process.cwd() }, agentOptions: { provider: 'runtime-lab', model: 'fixture-model' } });
        ctx.effect(() => () => handle.dispose());
        const captain = handle.agent;
        await captain.whenIdle();
        let callSeq = 0;
        const execute = (name, args) => executeTool(ctx.tools, { name: `agent_teams_${name}`, arguments: args, callId: ToolCallId(`reroute-${++callSeq}`), agent: captain, signal: new AbortController().signal });
        const teamPath = join(process.cwd(), '.agent-teams/runtime-lab/team.json');
        const check = async (name, args) => {
            const result = await execute(name, args);
            assert.equal(result.isError, false, `${name}: ${JSON.stringify(result)}`);
            return result;
        };
        await check('create', { name: 'runtime-lab', description: 'same-process route update fixture', approval: 'required' });
        await check('add_member', { name: 'worker', role: 'MEMBER_FIXTURE', executionPrompt: 'MEMBER_FIXTURE: complete assigned work.', provider: 'runtime-lab', model: 'fixture-model', reasoning_effort: 'low' });
        await check('create_task', { subject: 'Reroute member request', description: 'Keep one task attempt while changing the spawned worker route.', assignee: 'worker' });
        await check('approve', { confirmation: 'Fixture approves the deterministic staged team.' });
        const tracePath = process.env.LAB_TRACE;
        const trace = () => existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline && !trace().some(x => x.event === 'reroute-first-request-paused')) await new Promise(resolve => setTimeout(resolve, 10));
        const paused = trace().find(x => x.event === 'reroute-first-request-paused');
        assert.ok(paused, 'member made its first real model request');
        const before = JSON.parse(readFileSync(teamPath, 'utf8'));
        const worker = before.members.find(member => member.name === 'worker');
        assert.ok(worker?.id, 'the worker was spawned before rerouting');
        await check('edit_plan', { operations: [{ action: 'update_member', member_name: 'worker', provider: 'runtime-lab', model: 'fixture-rerouted', reasoning_effort: 'high' }] });
        const after = JSON.parse(readFileSync(teamPath, 'utf8'));
        assert.equal(after.members.find(member => member.name === 'worker')?.id, worker.id);
        mkdirSync(join(process.cwd(), '.agent-teams/runtime-lab'), { recursive: true });
        writeFileSync(process.env.LAB_RELEASE_FILE, 'release');
        captain.followup(createUserMessage({ content: [{ type: 'text', text: 'Observe the reroute fixture result.' }], source: { kind: 'user' } }));
        const waitDeadline = Date.now() + 30000;
        while (Date.now() < waitDeadline) {
            await captain.whenIdle();
            const state = JSON.parse(readFileSync(teamPath, 'utf8'));
            if (state.tasks.some(task => task.status === 'completed')) break;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        const state = JSON.parse(readFileSync(teamPath, 'utf8'));
        const task = state.tasks.find(item => item.id === 't1');
        const requests = trace().filter(x => x.event === 'request' && x.isMember && !x.purpose);
        const next = requests.find(request => request.model === 'fixture-rerouted');
        const attemptId = task?.attemptId;
        assert.ok(next, 'the next member request used the edited model');
        assert.equal(next.reasoningEffort, 'high');
        assert.equal(next.sessionId, worker.id, 'the same spawned member session made the next request');
        assert.equal(task.status, 'completed');
        assert.ok(attemptId, 'the task retained an attempt capability');
        appendFileSync(tracePath, JSON.stringify({ event: 'reroute-first-attempt', memberId: worker.id, sessionId: paused.sessionId, attemptId, attempt: task.attempt }) + '\n');
        assert.equal(paused.sessionId, next.sessionId);
        assert.equal(task.attempt, 1);
        process.stdout.write('REROUTE_RUNTIME_OK\n');
        ctx.get('appExit')(0);
    })().catch(error => { process.stderr.write(String(error.stack ?? error) + '\n'); ctx.get('appExit')(1); });
}
