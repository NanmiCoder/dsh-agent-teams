import { LlmAdapter, ToolCallId, LlmError } from '@deepseek-ai/dsh-llm';
import { appendFileSync } from 'node:fs';
let seq = 0;
let memberStarted = false;
const delayedMembers = new Set();
const model = { provider: 'runtime-lab', id: 'fixture-model', name: 'Deterministic fixture', context: { contextWindow: 262144 }, defaultMaxTokens: 8192, reasoning: { efforts: [{ id: 'low', name: 'low' }, { id: 'high', name: 'high' }], defaultEffort: 'low' } };
function record(data) { appendFileSync(process.env.LAB_TRACE, JSON.stringify({ ...data, time: Date.now() }) + '\n'); }
function textChunks(text) { return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }, { type: 'finish', reason: { kind: 'stop' } }]; }
function call(name, args) { const id = ToolCallId('lab-' + Date.now().toString(36) + '-' + (++seq)), arguments_ = JSON.stringify(args); return [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: arguments_ }, { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: arguments_ } }, { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }, { type: 'finish', reason: { kind: 'tool-calls' } }]; }
function history(options) { return options.messages.flatMap(m => m.content ?? []); }
class FixtureAdapter extends LlmAdapter {
    async listModels() { return [model, { ...model, id: 'fixture-failing' }, { ...model, id: 'fixture-fallback' }]; }
    async resolveModel(provider, id) { return { ...model, provider, id }; }
    async *stream(options) {
        const blocks = history(options), tools = blocks.filter(b => b.type === 'tool-call'), names = tools.map(b => b.name);
        const userText = options.messages.filter(m => m.role === 'user').flatMap(m => m.content.filter(b => b.type === 'text').map(b => b.text)).join('\n');
        const toolText = blocks.filter(b => b.type === 'tool-result').flatMap(b => b.content?.filter(t => t.type === 'text').map(t => t.text) ?? []).join('\n');
        const isMember = options.system?.includes('MEMBER_FIXTURE') === true;
        record({ event: 'request', sessionId: options.sessionId, purpose: options.purpose, provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort, isMember, toolNames: (options.tools ?? []).map(t => t.name), called: names, lastToolText: toolText.slice(-12000), userText: userText.slice(-6000), userMessages: options.messages.filter(m => m.role === 'user').map(m => m.content.filter(b => b.type === 'text').map(b => b.text).join('\n')) });
        let chunks;
        if (isMember && options.model === 'fixture-failing' && userText.includes('AgentTeams automatic task assignment'))
            throw new LlmError('Runtime fixture rejected primary route', 'AUTH', { status: 401 });
        if (options.purpose)
            chunks = textChunks('Runtime lab');
        else if (!process.env.LAB_TEAMS)
            chunks = textChunks('HARNESS_PRODUCT_TURN_OK');
        else if (isMember) {
            if (userText.includes('COLD_WAKE_FIXTURE')) {
                for (const chunk of textChunks('COLD_MEMBER_OK'))
                    yield chunk;
                record({ event: 'cold-member-completed', sessionId: options.sessionId, reasoningEffort: options.reasoningEffort, model: options.model });
                return;
            }
            memberStarted = true;
            if (!delayedMembers.has(options.sessionId)) {
                delayedMembers.add(options.sessionId);
                await new Promise(r => setTimeout(r, 1000));
            }
            if (!userText.includes('AgentTeams automatic task assignment') && !userText.includes('COLD_WAKE_FIXTURE'))
                chunks = textChunks('MEMBER_READY');
            else if (!names.includes('agent_teams_claim_task'))
                chunks = call('agent_teams_claim_task', { task_id: 't1' });
            else if (tools.filter(t => t.name === 'agent_teams_update_task').length < 2) {
                const attempt = toolText.match(/attempt_id ([^,\s)]+)/)?.[1];
                if (!attempt)
                    throw Error('Fixture could not read model-visible claim capability');
                chunks = call('agent_teams_update_task', { task_id: 't1', status: tools.filter(t => t.name === 'agent_teams_update_task').length === 0 ? 'in_progress' : 'completed', output: 'MEMBER_TASK_DONE', attempt_id: attempt });
            }
            else if (!names.includes('agent_teams_send_message'))
                chunks = call('agent_teams_send_message', { to: 'captain', content: 'MEMBER_REPORT_OK' });
            else if (userText.includes('SECOND_WAKE_FIXTURE'))
                chunks = textChunks('SECOND_WAKE_OK');
            else
                chunks = textChunks('MEMBER_FIRST_TURN_OK');
        }
        else if (process.env.LAB_COLD === '1') {
            if (!tools.some(t => t.name === 'agent_teams_send_message' && t.arguments.includes('COLD_WAKE_FIXTURE')))
                chunks = call('agent_teams_send_message', { to: 'worker', content: 'COLD_WAKE_FIXTURE' });
            else {
                await new Promise(r => setTimeout(r, 1000));
                chunks = textChunks('COLD_CAPTAIN_OK');
            }
        }
        else if (!names.includes('agent_teams_create'))
            chunks = call('agent_teams_create', { name: 'runtime-lab', description: 'Deterministic real Harness test', approval: 'automatic' });
        else if (!names.includes('agent_teams_add_member'))
            chunks = call('agent_teams_add_member', { name: 'worker', role: 'MEMBER_FIXTURE', executionPrompt: 'MEMBER_FIXTURE: complete the assigned task and report.', reasoning_effort: 'high', ...(process.env.LAB_SCENARIO === 'fallback' || process.env.LAB_SCENARIO === 'failure' ? { model: 'fixture-failing' } : {}) });
        else if (!names.includes('agent_teams_create_task'))
            chunks = call('agent_teams_create_task', { subject: 'Runtime fixture task', description: 'MEMBER_FIXTURE: complete the deterministic task', assignee: 'worker' });
        else if (process.env.LAB_SCENARIO === 'captain-idle-wakeup') {
            if ((toolText + userText).includes('MEMBER_REPORT_OK')) {
                record({ event: 'captain-notified-after-yield', sessionId: options.sessionId });
                chunks = textChunks('CAPTAIN_RESUMED_FROM_MEMBER_REPORT');
            }
            else
                chunks = textChunks('CAPTAIN_YIELDED_WAITING_FOR_MEMBER');
        }
        else if (process.env.LAB_SCENARIO === 'failure' && toolText.includes('AUTH'))
            chunks = textChunks('AGENTTEAMS_EXPECTED_FAILURE_OK');
        else if (process.env.LAB_SCENARIO === 'lifecycle' && !tools.some(t => t.name === 'agent_teams_send_message' && t.arguments.includes('FIFO_FIRST'))) {
            for (let i = 0; i < 100 && !memberStarted; i++)
                await new Promise(r => setTimeout(r, 20));
            chunks = call('agent_teams_send_message', { to: 'worker', content: 'FIFO_FIRST' });
        }
        else if (process.env.LAB_SCENARIO === 'lifecycle' && !tools.some(t => t.name === 'agent_teams_send_message' && t.arguments.includes('FIFO_SECOND')))
            chunks = call('agent_teams_send_message', { to: 'worker', content: 'FIFO_SECOND' });
        else if (!(toolText + userText).includes('MEMBER_REPORT_OK')) {
            await new Promise(r => setTimeout(r, 150));
            chunks = call('agent_teams_status', {});
        }
        else if (!tools.some(t => t.name === 'agent_teams_send_message' && t.arguments.includes('SECOND_WAKE_FIXTURE')))
            chunks = call('agent_teams_send_message', { to: 'worker', content: 'SECOND_WAKE_FIXTURE' });
        else {
            await new Promise(r => setTimeout(r, 800));
            chunks = textChunks('AGENTTEAMS_PRODUCT_TURN_OK');
        }
        record({ event: 'response', sessionId: options.sessionId, isMember, text: chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('') });
        for (const chunk of chunks) {
            options.signal?.throwIfAborted();
            yield chunk;
        }
    }
}
export const name = 'runtime-lab-fixture';
export const inject = ['llm'];
export function apply(ctx) { ctx.llm.registerAdapter(['runtime-lab'], new FixtureAdapter()); record({ event: 'fixture-activated' }); }
