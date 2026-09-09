/** Published CLI + Loader entry benchmark. Only the LLM is deterministic.
 * Tests transport and business behavior; it does not measure model intent accuracy.
 */
import assert from 'node:assert/strict';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export const name = 'runtime-lab-progressive-entry';
export const inject = ['agents', 'sessions', 'commands', 'systemPrompt'];
export function apply(ctx) {
    void (async () => {
        await ctx.get('loader').await();
        const trace = () => readFileSync(process.env.LAB_TRACE, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
        const create = async label => {
            const cwd = join(process.cwd(), label);
            mkdirSync(cwd, { recursive: true });
            const handle = await ctx.agents.create({ sessionId: 'session-' + randomUUID(), meta: { cwd }, agentOptions: { provider: 'runtime-lab', model: 'fixture-model' } });
            ctx.effect(() => () => handle.dispose());
            await handle.agent.whenIdle();
            return { agent: handle.agent, cwd };
        };
        const send = async (agent, text) => {
            agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
            await agent.whenIdle();
        };
        const teamNames = async agent => (await ctx.systemPrompt.assemble({ agent, scope: agent })).tools.map(t => t.name).filter(n => n.startsWith('agent_teams_'));
        const measure = async (agent, role) => {
            const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent });
            const teamTools = assembly.tools.filter(t => t.name.startsWith('agent_teams_'));
            appendFileSync(process.env.LAB_TRACE, JSON.stringify({ event: 'exposure-budget', role,
                teamPromptBytes: Buffer.byteLength(assembly.sections.find(s => s.name === 'agent-teams:usage')?.text ?? ''),
                teamSchemaBytes: Buffer.byteLength(JSON.stringify(teamTools)), teamToolCount: teamTools.length }) + '\n');
        };
        const ordinary = await create('ordinary');
        await measure(ordinary.agent, 'captain-idle');
        for (const text of [
            'ENTRY_NO_ACTIVATION: What is 2 + 2?',
            'ENTRY_NO_ACTIVATION: Explain what AgentTeams means.',
            'ENTRY_NO_ACTIVATION: Do not use AgentTeams; answer directly.',
            'ENTRY_NO_ACTIVATION: Translate this quote: "use AgentTeams to research this".',
        ]) await send(ordinary.agent, text);
        assert.equal((await teamNames(ordinary.agent)).length, 13);
        assert.equal(existsSync(join(ordinary.cwd, '.agent-teams/runtime-lab/team.json')), false);
        const cases = [
            ['natural', 'Use AgentTeams to plan this task.', false],
            ['natural-zh', '请使用 Agent Teams 团队协作来规划这个任务。', false],
            ['raw-slash', '/agent-teams plan this task', false],
            ['command', '/agent-teams plan this task', true],
            ['profile-command', '/agent-teams-demo-profile plan this task', true],
            ['profile-raw', '/agent-teams --profile demo-profile plan this task', false],
        ];
        for (const [label, input, command] of cases) {
            const { agent, cwd } = await create(label);
            if (label === 'natural') for (let i = 0; i < 30; i++) await send(agent, `ENTRY_NO_ACTIVATION: Ordinary conversation turn ${i}.`);
            if (command) {
                const execution = await ctx.commands.execute(agent, input, [], new AbortController().signal);
                assert.equal(execution?.result.kind, 'success');
                await agent.whenIdle();
            } else await send(agent, input);
            const statePath = join(cwd, '.agent-teams/runtime-lab/team.json');
            const before = readFileSync(statePath, 'utf8'), staged = JSON.parse(before);
            assert.equal(staged.phase, 'staged');
            assert.equal(staged.tasks.length, 1);
            assert.equal(staged.members.length, 1);
            assert.ok(staged.members.every(m => !m.id));
            const requests = trace().filter(x => x.event === 'request' && !x.purpose && x.sessionId === agent.id).slice(label === 'natural' ? 30 : 0);
            assert.equal(requests[0].toolNames.filter(n => n.startsWith('agent_teams_')).length, 13);
            const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent });
            assert.match(assembly.sections.find(s => s.name === 'agent-teams:usage')?.text ?? '', /Tasks carry attempt_id/);
            assert.doesNotMatch(requests[1].lastToolText, /"instructions":/);
            assert.equal(requests[1].called[0], 'agent_teams_create');
            assert.ok(requests.every(request => !request.toolNames.includes('agent_teams_open')));
            assert.equal(requests[1].toolNames.filter(n => n.startsWith('agent_teams_')).length, 13);
            if (input.startsWith('/')) assert.match(requests[0].userText, /Inspect existing team state with agent_teams_status/);
            assert.equal((await teamNames(ordinary.agent)).length, 13);
            await measure(agent, label.startsWith('profile') ? 'captain-profile' : 'captain');
            await send(agent, 'REOPEN_ENTRY: inspect the existing AgentTeams plan.');
            assert.equal(readFileSync(statePath, 'utf8'), before);
            await send(agent, 'APPROVE_ENTRY: I approve this plan. Start it now.');
            const completed = JSON.parse(readFileSync(statePath, 'utf8'));
            assert.equal(completed.phase, 'running');
            assert.equal(completed.tasks[0].status, 'completed');
            assert.ok(completed.members[0].id);
            const memberRequests = trace().filter(x => x.event === 'request' && !x.purpose && x.sessionId === completed.members[0].id);
            assert.ok(memberRequests.length > 0);
            for (const request of memberRequests) assert.deepEqual(request.toolNames.filter(n => n.startsWith('agent_teams_')).sort(), ['agent_teams_claim_task', 'agent_teams_send_message', 'agent_teams_status', 'agent_teams_update_task']);
            await send(agent, 'END_ENTRY: End and archive this team.');
            assert.equal(existsSync(statePath), false);
            await send(agent, 'ENTRY_NO_ACTIVATION: Back to ordinary conversation.');
            await send(agent, 'INSPECT_ENDED_ENTRY: Inspect whether any AgentTeams team remains.');
            assert.equal(existsSync(statePath), false);
            const budgets = trace().filter(x => x.event === 'request-budget' && !x.purpose && x.sessionId === agent.id);
            assert.ok(budgets.length > (label === 'natural' ? 35 : 5));
            assert.equal(new Set(budgets.map(x => x.systemSha256)).size, 1, `${label}: system prefix changed`);
            assert.equal(new Set(budgets.map(x => x.toolsSha256)).size, 1, `${label}: tools prefix changed`);
            appendFileSync(process.env.LAB_TRACE, JSON.stringify({ event: 'stable-prefix-passed', label, requests: budgets.length, precedingOrdinaryTurns: label === 'natural' ? 30 : 0, systemSha256: budgets[0].systemSha256, toolsSha256: budgets[0].toolsSha256 }) + '\n');
            appendFileSync(process.env.LAB_TRACE, JSON.stringify({ event: 'entry-case-passed', label, captain: agent.id, member: completed.members[0].id }) + '\n');
        }
        for (const agent of ctx.agents.list()) { await agent.whenIdle(); await ctx.sessions.flush(agent.session); }
        process.stdout.write('PROGRESSIVE_ENTRY_OK\n');
        ctx.get('appExit')(0);
    })().catch(error => { process.stderr.write(String(error.stack ?? error) + '\n'); ctx.get('appExit')(1); });
}
