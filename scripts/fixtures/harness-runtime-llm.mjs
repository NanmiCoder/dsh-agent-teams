import { LlmAdapter, ToolCallId, LlmError } from '@deepseek-ai/dsh-llm';
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
let seq = 0;
let memberStarted = false;
const delayedMembers = new Set();
const capturedRequests = new Set();
const model = { provider: 'runtime-lab', id: 'fixture-model', name: 'Deterministic fixture', context: { contextWindow: 262144 }, defaultMaxTokens: 8192, reasoning: { efforts: [{ id: 'low', name: 'low' }, { id: 'high', name: 'high' }], defaultEffort: 'low' } };
function record(data) { appendFileSync(process.env.LAB_TRACE, JSON.stringify({ ...data, time: Date.now() }) + '\n'); }
function textChunks(text) { return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }, { type: 'finish', reason: { kind: 'stop' } }]; }
function call(name, args) { const id = ToolCallId('lab-' + Date.now().toString(36) + '-' + (++seq)), arguments_ = JSON.stringify(args); return [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: arguments_ }, { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: arguments_ } }, { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }, { type: 'finish', reason: { kind: 'tool-calls' } }]; }
function history(options) { return options.messages.flatMap(m => m.content ?? []); }
class FixtureAdapter extends LlmAdapter {
    async listModels() { return [model, { ...model, id: 'fixture-failing' }, { ...model, id: 'fixture-fallback' }]; }
    async resolveModel(provider, id) { return { ...model, provider, id }; }
    async *stream(options) {
        const system = options.system ?? options.messages.filter(message => message.role === 'system').flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n');
        const blocks = history(options), tools = blocks.filter(b => b.type === 'tool-call'), names = tools.map(b => b.name);
        const userText = options.messages.filter(m => m.role === 'user').flatMap(m => m.content.filter(b => b.type === 'text').map(b => b.text)).join('\n');
        const lastUserText = options.messages.filter(m => m.role === 'user' && m.source?.kind === 'user').map(m => m.content.filter(b => b.type === 'text').map(b => b.text).join('\n')).filter(Boolean).at(-1) ?? '';
        const currentNames = options.messages.slice(options.messages.findLastIndex(m => m.role === 'user' && m.source?.kind === 'user') + 1).flatMap(m => m.content ?? []).filter(b => b.type === 'tool-call').map(b => b.name);
        const toolText = blocks.filter(b => b.type === 'tool-result').flatMap(b => b.content?.filter(t => t.type === 'text').map(t => t.text) ?? []).join('\n');
        const isMember = system?.includes('MEMBER_FIXTURE') === true;
        const teamTools = (options.tools ?? []).filter(t => t.name.startsWith('agent_teams_'));
        const requestKey = JSON.stringify([options.purpose, isMember, teamTools.map(t => t.name)]);
        if (!capturedRequests.has(requestKey)) {
            capturedRequests.add(requestKey);
            record({ event: 'request-snapshot', purpose: options.purpose, isMember, system: system, tools: options.tools, messages: options.messages });
        }
        record({ event: 'request-budget', sessionId: options.sessionId, purpose: options.purpose, isMember,
            systemBytes: Buffer.byteLength(system ?? ''), systemSha256: createHash('sha256').update(system ?? '').digest('hex'),
            toolsSha256: createHash('sha256').update(JSON.stringify(options.tools ?? [])).digest('hex'),
            teamSchemaBytes: Buffer.byteLength(JSON.stringify(teamTools)), teamTools: teamTools.map(t => t.name) });
        record({ event: 'request', sessionId: options.sessionId, purpose: options.purpose, provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort, isMember, toolNames: (options.tools ?? []).map(t => t.name), called: names, lastToolText: toolText.slice(-12000), userText: userText.slice(-6000), userMessages: options.messages.filter(m => m.role === 'user').map(m => m.content.filter(b => b.type === 'text').map(b => b.text).join('\n')) });
        let chunks;
        if (isMember && options.model === 'fixture-failing' && userText.includes('AgentTeams automatic task assignment'))
            throw new LlmError('Runtime fixture rejected primary route', 'AUTH', { status: 401 });
        if (options.purpose)
            chunks = textChunks('Runtime lab');
        else if (!process.env.LAB_TEAMS)
            chunks = textChunks('HARNESS_PRODUCT_TURN_OK');
        else if (process.env.LAB_SCENARIO === 'progressive-entry' && lastUserText.includes('ENTRY_NO_ACTIVATION'))
            chunks = textChunks('ORDINARY_ENTRY_OK');
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
        else if (process.env.LAB_SCENARIO === 'progressive-entry' && lastUserText.includes('END_ENTRY')) {
            chunks = names.includes('agent_teams_delete') ? textChunks('ENDED_ENTRY_OK') : call('agent_teams_delete', {});
        }
        else if (process.env.LAB_SCENARIO === 'progressive-entry' && lastUserText.includes('INSPECT_ENDED_ENTRY')) {
            if (!currentNames.includes('agent_teams_status')) chunks = call('agent_teams_status', {});
            else {
                const result = blocks.filter(b => b.type === 'tool-result').at(-1);
                if (!result?.isError || !JSON.stringify(result).includes('you do not lead or belong to any active team yet'))
                    throw Error('Archived-team inspection must report no active team');
                chunks = textChunks('INSPECTED_ENDED_ENTRY_OK');
            }
        }
        else if (process.env.LAB_SCENARIO === 'progressive-entry') {
            const failed = blocks.find(b => b.type === 'tool-result' && b.isError);
            if (failed) throw Error('Entry workflow tool failed: ' + JSON.stringify(failed));
            const profile = userText.includes('demo-profile');
            if (!names.includes('agent_teams_create'))
                chunks = call('agent_teams_create', { name: 'runtime-lab', description: 'Entry workflow', approval: 'required', ...(profile ? { profile: 'demo-profile' } : {}) });
            else if (!profile && !names.includes('agent_teams_add_member'))
                chunks = call('agent_teams_add_member', { name: 'worker', role: 'MEMBER_FIXTURE', executionPrompt: 'MEMBER_FIXTURE: complete the assigned task and report.', reasoning_effort: 'high' });
            else if (!names.includes('agent_teams_create_task'))
                chunks = call('agent_teams_create_task', { subject: 'Entry task', description: 'Complete the deterministic task', assignee: 'worker' });
            else if (userText.includes('APPROVE_ENTRY')) {
                if (!names.includes('agent_teams_approve'))
                    chunks = call('agent_teams_approve', { confirmation: 'APPROVE_ENTRY: I approve this plan. Start it now.' });
                else if (!(toolText + userText).includes('MEMBER_REPORT_OK')) {
                    await new Promise(r => setTimeout(r, 150));
                    chunks = call('agent_teams_status', {});
                } else chunks = textChunks('APPROVED_ENTRY_OK');
            }
            else if (userText.includes('REOPEN_ENTRY') && !currentNames.includes('agent_teams_status'))
                chunks = call('agent_teams_status', {});
            else chunks = textChunks('STAGED_ENTRY_OK');
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
            if (chunk.type === 'block-end' && chunk.block.type === 'tool-call'
                && !(options.tools ?? []).some(t => t.name === chunk.block.name))
                throw Error('Fixture attempted a tool absent from the model request: ' + chunk.block.name);
            yield chunk;
        }
    }
}
export const name = 'runtime-lab-fixture';
export const inject = ['llm'];
export function apply(ctx) { ctx.llm.registerAdapter(['runtime-lab'], new FixtureAdapter()); record({ event: 'fixture-activated' }); }
