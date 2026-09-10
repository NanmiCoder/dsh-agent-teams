/** Published CLI/Loader regression for fixed captain rules. Only the LLM is
 * scripted: actual tools, code runtime, pruning, compaction and restore run.
 * This proves request content and persisted effects, not real-model reasoning.
 */
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';

const businessNames = ['agent_teams_create', 'agent_teams_approve', 'agent_teams_edit_plan', 'agent_teams_add_member', 'agent_teams_remove_member', 'agent_teams_create_task', 'agent_teams_reassign_task', 'agent_teams_claim_task', 'agent_teams_update_task', 'agent_teams_send_message', 'agent_teams_status', 'agent_teams_resume', 'agent_teams_delete'];
const goal = 'Use AgentTeams to prepare a plan, then wait for my approval.';
const cases = new Map(), requests = [];
const model = { provider: 'runtime-lab', id: 'fixture-model', name: 'Protocol compatibility fixture', context: { contextWindow: 262144 }, defaultMaxTokens: 8192, reasoning: { efforts: [{ id: 'low', name: 'low' }], defaultEffort: 'low' } };
let callSequence = 0;
const hash = value => createHash('sha256').update(value).digest('hex');
function record(value) { appendFileSync(process.env.LAB_TRACE, JSON.stringify(value) + '\n'); }
function assertProtocol(system) {
    for (const rule of [/the user's goal as description/, /attempt_id/, /never approve in that planning turn/i, /Never approve your own implementation/, /depend on a failed task/, /Resume only on a later explicit user request/]) assert.match(system ?? '', rule);
}
function sessionEvents(session) {
    // Alpha.2 exposes the immutable events property; later supported hosts
    // expose snapshotEvents(). Never substitute an empty log on an unknown API.
    const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : session.events;
    assert.ok(Array.isArray(events), 'Unsupported host Session event-read API');
    return events;
}
function textChunks(text) {
    return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }, { type: 'finish', reason: { kind: 'stop' } }];
}
function call(name, args) {
    const id = ToolCallId('protocol-' + (++callSequence)), argumentText = JSON.stringify(args);
    return [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentText }, { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentText } }, { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }, { type: 'finish', reason: { kind: 'tool-calls' } }];
}
class ProtocolAdapter extends LlmAdapter {
    async listModels() { return [model]; }
    async resolveModel(provider, id) { return { ...model, provider, id }; }
    async *stream(options) {
        const system = options.system ?? options.messages.filter(message => message.role === 'system').flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n');
        if (options.purpose) {
            record({ event: 'protocol-background-request', purpose: options.purpose });
            yield* textChunks(options.purpose === 'compaction' ? 'A staged team named protocol-team has task t1 awaiting user review.' : 'Protocol lab');
            return;
        }
        const scenario = cases.get(options.sessionId);
        assert.ok(scenario, 'Unexpected live agent request');
        assertProtocol(system);
        assert.doesNotMatch(system ?? '', /agent_teams_open/);
        assert.ok(!(options.tools ?? []).some(tool => tool.name === 'agent_teams_open'));
        const blocks = options.messages.flatMap(message => message.content ?? []);
        const failed = blocks.find(block => block.type === 'tool-result' && block.isError);
        assert.equal(failed, undefined, JSON.stringify(failed));
        const resultText = blocks.filter(block => block.type === 'tool-result').flatMap(block => block.content?.filter(content => content.type === 'text').map(content => content.text) ?? []).join('\n');
        const snapshot = { event: 'protocol-request', label: scenario.label, phase: scenario.phase, step: scenario.step, sessionId: options.sessionId, system: system, tools: options.tools, messages: options.messages, systemSha256: hash(system ?? ''), toolsSha256: hash(JSON.stringify(options.tools ?? [])) };
        requests.push(snapshot); record(snapshot);
        if (!scenario.ptc && scenario.phase === 'plan' && scenario.step === 0) {
            // Anonymous names cannot convey their purpose by themselves. The
            // original thirteen-tool allowlist must still see the configured
            // directory in its FIRST request, before any business or error result.
            const north = system.split('\n').find(line => line.startsWith('- north '));
            const south = system.split('\n').find(line => line.startsWith('- south '));
            assert.match(north ?? '', /1 member, captain planning/);
            assert.match(north ?? '', /Investigate an existing codebase and design a goal-specific task DAG/);
            assert.match(south ?? '', /1 member, 1 task/);
            assert.match(south ?? '', /Apply a fixed release-readiness checklist to a prepared release/);
            assert.deepEqual(options.tools.map(tool => tool.name).sort(), [...businessNames].sort());
            record({ event: 'protocol-legacy-profile-directory', sessionId: options.sessionId, onlyOriginalTools: true, northPurposeVisible: true, southPurposeVisible: true, north, south });
        }
        if (scenario.phase === 'revise') {
            if (scenario.step++ === 0) {
                const args = { operations: [{ action: 'update_task', task_id: 't1', subject: 'Recovered task' }] };
                yield* scenario.ptc ? call('run_code', { code: `return await tools.agent_teams_edit_plan(${JSON.stringify(args)});`, description: 'Revise the existing staged task after history compaction' }) : call('agent_teams_edit_plan', args);
            } else yield* textChunks('EXISTING_PLAN_REVISED');
            return;
        }
        if (scenario.phase === 'archive') {
            if (scenario.step++ === 0) yield* scenario.ptc ? call('run_code', { code: 'return await tools.agent_teams_delete({});', description: 'Archive the team at the user request' }) : call('agent_teams_delete', {});
            else yield* textChunks('TEAM_ARCHIVED');
            return;
        }
        if (scenario.ptc && scenario.step === 1) {
            scenario.step++;
            yield* call('run_code', { code: 'await tools.agent_teams_status({}); return "STATUS_OUTPUT_DISCARDED\\n" + "historical-output ".repeat(1000);', description: 'Inspect current team status, retaining only a receipt' });
            return;
        }
        if (scenario.ptc && scenario.step === 2) {
            assert.match(resultText, /STATUS_OUTPUT_DISCARDED/);
            assert.doesNotMatch(resultText, /AgentTeams captain protocol|Tasks carry attempt_id/);
            record({ event: 'protocol-ptc-output-discarded', tool: 'agent_teams_status', sessionId: options.sessionId, systemRulesPresent: true });
        }
        const rawStep = scenario.step++;
        const step = rawStep - (scenario.ptc && rawStep > 1 ? 1 : 0);
        const actions = [
            ['agent_teams_create', { name: 'protocol-team', description: goal, approval: 'required', ...scenario.ptc ? {} : { profile: 'north' } }],
            ...scenario.ptc ? [['agent_teams_add_member', { name: 'worker', role: 'Implement the assigned task', executionPrompt: 'Complete assigned work and report.' }]] : [],
            ['agent_teams_create_task', { subject: 'Original task', description: 'A deterministic staged task', assignee: 'worker' }],
        ];
        if (step >= actions.length) { yield* textChunks('STAGED_PLAN_READY'); return; }
        const [name, args] = actions[step];
        yield* scenario.ptc ? call('run_code', { code: `return await tools.${name}(${JSON.stringify(args)});`, description: 'Build the user-reviewable staged plan' }) : call(name, args);
    }
}

export const name = 'runtime-lab-protocol-compatibility';
export const inject = ['llm', 'agents', 'sessions', 'systemPrompt', 'compaction', 'toolResultPruner', 'tools', 'codeRuntime'];
export function apply(ctx) {
    ctx.llm.registerAdapter(['runtime-lab'], new ProtocolAdapter());
    void (async () => {
        await ctx.get('loader').await();
        const send = async (agent, text) => {
            agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
            await agent.whenIdle();
        };
        const usage = async agent => (await ctx.systemPrompt.assemble({ agent, scope: agent })).sections.find(section => section.name === 'agent-teams:usage')?.text ?? '';
        for (const ptc of [false, true]) {
            const label = ptc ? 'ptc-discard-and-compact' : 'legacy-allowlist-cold-compact';
            const cwd = join(process.cwd(), label); mkdirSync(cwd, { recursive: true });
            let handle = await ctx.agents.create({ sessionId: 'session-' + randomUUID(), meta: { cwd }, agentOptions: { provider: 'runtime-lab', model: 'fixture-model' } });
            ctx.effect(() => () => handle.dispose());
            let agent = handle.agent; await agent.whenIdle();
            const scenario = { label, ptc, phase: 'plan', step: 0 }; cases.set(agent.id, scenario);
            let restore = ptc ? agent.ctx.tools.presentAs('ptc') : agent.ctx.tools.restrict({ allow: businessNames });
            const beforeUsage = await usage(agent); assertProtocol(beforeUsage);
            if (!ptc) {
                const exposed = (await ctx.systemPrompt.assemble({ agent, scope: agent })).tools.map(tool => tool.name);
                assert.deepEqual(exposed.sort(), [...businessNames].sort());
                assert.equal(agent.ctx.tools.get('agent_teams_open', agent), undefined);
            }
            await send(agent, goal);
            const file = join(cwd, '.agent-teams/protocol-team/team.json');
            const state = () => JSON.parse(readFileSync(file, 'utf8'));
            assert.equal(state().phase, 'staged'); assert.equal(state().tasks.length, 1); assert.equal(state().members.length, 1);
            assert.equal(state().description, goal, 'The complete user goal must survive in durable team context');
            if (!ptc) {
                assert.equal(state().profile?.name, 'north');
                assert.equal(state().profile?.taskPlanning, 'captain');
                assert.match(state().profile?.protocol ?? '', /Investigate an existing codebase/);
            }
            assert.ok(!state().members[0].id, 'Staging must not spawn a member');
            assert.equal(await usage(agent), beforeUsage);
            if (ptc) {
                assert.ok(sessionEvents(agent.session).some(event => ['tool/code-dispatch', 'tool/ptc-dispatch'].includes(event.type) && event.data.name === 'agent_teams_status'));
                const pruned = ctx.toolResultPruner.pruneSession(agent.session);
                assert.ok(sessionEvents(agent.session).some(event => event.type === 'compaction/prune'), 'Oversized PTC receipt must actually be pruned');
                record({ event: 'protocol-pruned', label, result: pruned });
            } else {
                const id = agent.id;
                await ctx.sessions.flush(agent.session); restore(); await handle.dispose();
                handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'runtime-lab', model: 'fixture-model' } });
                agent = handle.agent; await agent.whenIdle();
                restore = agent.ctx.tools.restrict({ allow: businessNames });
                assert.equal(await usage(agent), beforeUsage);
                record({ event: 'protocol-cold-restored', label, sessionId: id });
            }
            const compacted = await ctx.compaction.compactNow(agent, new AbortController().signal);
            assert.ok(compacted, 'The fixture must actually compact useful history');
            assert.ok(sessionEvents(agent.session).some(event => event.type === 'compaction/summary'));
            assert.equal(await usage(agent), beforeUsage);
            record({ event: 'protocol-compacted', label, compacted });
            scenario.phase = 'revise'; scenario.step = 0;
            await send(agent, 'Change the existing staged task t1 subject to Recovered task. Keep the same team and wait for my approval.');
            assert.equal(state().tasks[0].subject, 'Recovered task');
            assert.equal(state().tasks.length, 1); assert.equal(state().members.length, 1); assert.equal(state().phase, 'staged');
            assert.equal(await usage(agent), beforeUsage);
            const finalState = state();
            scenario.phase = 'archive'; scenario.step = 0;
            await send(agent, 'End and archive this team and its unfinished staged task.');
            assert.equal(existsSync(file), false, 'Archived team must leave active state');
            assert.equal(existsSync(join(cwd, '.agent-teams/archive/protocol-team/team.json')), true);
            assert.equal(await usage(agent), beforeUsage);
            const captured = requests.filter(request => request.sessionId === agent.id);
            assert.equal(new Set(captured.map(request => request.systemSha256)).size, 1, 'System prefix changed across planning, restore or compaction');
            assert.equal(new Set(captured.map(request => request.toolsSha256)).size, 1, 'Tools prefix changed across planning, restore or compaction');
            record({ event: 'protocol-case-passed', label, requests: captured.length, compactedHistory: true, persistedSubject: finalState.tasks[0].subject, archived: true, ...finalState.profile ? { profile: finalState.profile.name } : {} });
            restore(); await ctx.sessions.flush(agent.session); await handle.dispose();
        }
        process.stdout.write('PROTOCOL_COMPATIBILITY_OK\n');
        ctx.get('appExit')(0);
    })().catch(error => { process.stderr.write(String(error.stack ?? error) + '\n'); ctx.get('appExit')(1); });
}
