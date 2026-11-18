import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';

export const name = 'desktop-audit-approval';
export const inject = ['llm', 'agents', 'webServer', 'connection', 'workspaceRegistry'];

const model = {
    provider: 'desktop-audit', id: 'fixture', name: 'Desktop audit fixture',
    context: { contextWindow: 262144 }, defaultMaxTokens: 8192,
    reasoning: { efforts: [{ id: 'low', name: 'low' }], defaultEffort: 'low' },
};
const plan = {
    members: [
        { name: 'first', role: 'DESKTOP_AUDIT_FIRST' },
        { name: 'second', role: 'DESKTOP_AUDIT_SECOND' },
    ],
    tasks: [
        { id: 'first', subject: 'Complete the first task', assignee: 'first' },
        { id: 'second', subject: 'Complete the dependent task', assignee: 'second', dependencies: ['first'] },
    ],
};
const requests = new Set();
let sequence = 0;
const textOf = blocks => (blocks ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');

class FixtureAdapter extends LlmAdapter {
    async listModels() { return [model]; }
    async resolveModel(provider, id) { return { ...model, provider, id }; }
    async *stream(options) {
        const system = options.system ?? options.messages.filter(message => message.role === 'system')
            .map(message => textOf(message.content)).join('\n');
        const calls = options.messages.flatMap(message => message.role === 'assistant' ? message.content : [])
            .filter(block => block.type === 'tool-call');
        const results = options.messages.filter(message => message.role === 'tool');
        const userText = options.messages.filter(message => message.role === 'user').map(message => textOf(message.content)).join('\n');
        let call;
        const isMember = system.includes('DESKTOP_AUDIT_FIRST') || system.includes('DESKTOP_AUDIT_SECOND');
        if (!options.purpose && isMember) {
            requests.add(options.sessionId);
            const task = system.includes('DESKTOP_AUDIT_FIRST') ? 't1' : 't2';
            const claimed = calls.some(block => block.name === 'agent_teams_claim_task');
            const updates = calls.filter(block => block.name === 'agent_teams_update_task').length;
            if (userText.includes('AgentTeams automatic task assignment') && !claimed) {
                call = ['agent_teams_claim_task', { task_id: task }];
            } else if (claimed && updates < 2) {
                const attempt = results.map(message => textOf(message.content)).join('\n').match(/attempt_id ([^,\s)]+)/)?.[1];
                assert.ok(attempt, 'Member claim did not return an attempt id');
                call = ['agent_teams_update_task', {
                    task_id: task, attempt_id: attempt, status: updates === 0 ? 'in_progress' : 'completed',
                    output: 'Verified on the desktop host',
                }];
            }
        } else if (!options.purpose && !calls.some(block => block.name === 'agent_teams_create')) {
            call = ['agent_teams_create', { name: 'desktop-audit', approval: 'required', plan }];
        }
        if (call) {
            const [name, args] = call;
            const id = ToolCallId('desktop-audit-' + (++sequence));
            const json = JSON.stringify(args);
            yield { type: 'block-start', index: 0, blockType: 'tool-call' };
            yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: json };
            yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: json } };
        } else {
            const text = 'Desktop audit fixture';
            yield { type: 'block-start', index: 0, blockType: 'text' };
            yield { type: 'text-delta', index: 0, text };
            yield { type: 'block-end', index: 0, block: { type: 'text', text } };
        }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } };
        yield { type: 'finish', reason: { kind: call ? 'tool-calls' : 'stop' } };
    }
}

function save(result) {
    const file = process.env.LAB_DESKTOP_RESULT;
    writeFileSync(file + '.new', JSON.stringify(result, null, 2));
    renameSync(file + '.new', file);
}

export function apply(ctx) {
    ctx.llm.registerAdapter(['desktop-audit'], new FixtureAdapter());
    const workspace = process.env.LAB_DESKTOP_WORKSPACE;
    const readTeam = () => JSON.parse(readFileSync(join(workspace, '.agent-teams', 'desktop-audit', 'team.json'), 'utf8'));
    void (async () => {
        await ctx.get('loader').await();
        await ctx.workspaceRegistry.create(workspace, 'AgentTeams Desktop audit');
        const handle = await ctx.agents.create({
            sessionId: 'session-' + randomUUID(),
            meta: { cwd: workspace },
            agentOptions: { provider: model.provider, model: model.id },
        });
        ctx.effect(() => () => handle.dispose());
        const captain = handle.agent;
        await captain.whenIdle();
        captain.followup(createUserMessage({
            content: [{ type: 'text', text: 'Prepare a two-member AgentTeams plan, then wait for Web approval.' }],
            source: { kind: 'user' },
        }));
        await captain.whenIdle();
        const staged = readTeam();
        assert.equal(staged.phase, 'staged');
        assert.equal(staged.members.length, 2);
        assert.ok(staged.members.every(member => member.id === ''));
        assert.deepEqual(staged.tasks[1].dependencies, [staged.tasks[0].id]);
        assert.equal(requests.size, 0);
        const baseUrl = `http://127.0.0.1:${ctx.webServer.port}`;
        const login = await fetch(ctx.connection.authenticatedUrl(baseUrl), { redirect: 'manual', signal: AbortSignal.timeout(10000) });
        assert.equal(login.status, 303);
        const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
        assert.ok(cookie);
        const approval = await fetch(baseUrl + '/plugins/dsh-agent-teams/plan', {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseUrl, cookie },
            body: JSON.stringify({ sessionId: captain.id, teamId: staged.id, action: 'approve' }),
            signal: AbortSignal.timeout(10000),
        });
        const approved = await approval.json();
        assert.equal(approval.status, 200, JSON.stringify(approved));
        assert.equal(approved.ok, true);
        const deadline = Date.now() + 45_000;
        let team = readTeam();
        while (team.tasks.some(task => task.status !== 'completed') && Date.now() < deadline) {
            const error = team.members.find(member => typeof member.spawnError === 'string');
            if (error) throw new Error(error.spawnError);
            await new Promise(resolve => setTimeout(resolve, 50));
            team = readTeam();
        }
        assert.deepEqual(team.tasks.map(task => task.status), ['completed', 'completed']);
        assert.ok(team.members.every(member => member.id && requests.has(member.id)));
        save({ passed: true, approval: approval.status, memberModelRequests: requests.size,
            tasks: team.tasks.map(task => ({ id: task.id, status: task.status, attempt: task.attempt })) });
    })().catch(error => {
        let team;
        try { team = readTeam(); } catch {}
        save({ passed: false, error: String(error?.stack ?? error), memberModelRequests: requests.size,
            members: team?.members, tasks: team?.tasks?.map(task => ({ id: task.id, status: task.status, attempt: task.attempt })) });
    });
}
