/** Published-artifact Web approval regression. Only the external model is scripted.
 * The driver sends one user message, one successful authenticated HTTP approval,
 * and two rejected boundary requests. A model response gate keeps the member
 * silent until the captain acknowledges Web approval and becomes idle, so the
 * approval and member-report wakeups cannot conflate.
 */
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';

const events = [];
const handledControlMessages = new Set();
let callSequence = 0;
let releaseMember;
const memberGate = new Promise(resolve => { releaseMember = resolve; });
const model = { provider: 'runtime-lab', id: 'fixture-model', name: 'Web approval fixture', context: { contextWindow: 262144 }, defaultMaxTokens: 8192, reasoning: { efforts: [{ id: 'low', name: 'low' }, { id: 'high', name: 'high' }], defaultEffort: 'low' } };
function record(data) {
    const event = { ...data, order: events.length, time: Date.now() };
    events.push(event);
    appendFileSync(process.env.LAB_TRACE, JSON.stringify(event) + '\n');
    return event;
}
function textChunks(text) {
    return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }, { type: 'finish', reason: { kind: 'stop' } }];
}
function call(name, args) {
    const id = ToolCallId('web-approval-' + (++callSequence)), arguments_ = JSON.stringify(args);
    return [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: arguments_ }, { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: arguments_ } }, { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }, { type: 'finish', reason: { kind: 'tool-calls' } }];
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
async function waitFor(predicate, description) {
    const deadline = Date.now() + 25000;
    while (!predicate()) {
        assert.ok(Date.now() < deadline, 'Timed out: ' + description);
        await new Promise(resolve => setTimeout(resolve, 25));
    }
}
class WebApprovalAdapter extends LlmAdapter {
    async listModels() { return [model]; }
    async resolveModel(provider, id) { return { ...model, provider, id }; }
    async *stream(options) {
        const system = options.system ?? options.messages.filter(message => message.role === 'system').flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n');
        if (options.purpose) { yield* textChunks('Web approval lab'); return; }
        const blocks = options.messages.flatMap(message => message.content ?? []);
        const calls = blocks.filter(block => block.type === 'tool-call');
        const names = calls.map(block => block.name);
        const userText = options.messages.filter(message => message.role === 'user').flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n');
        const toolText = blocks.filter(block => block.type === 'tool-result').flatMap(block => block.content?.filter(content => content.type === 'text').map(content => content.text) ?? []).join('\n');
        const failed = blocks.find(block => block.type === 'tool-result' && block.isError);
        assert.equal(failed, undefined, 'Real workflow tool failed: ' + JSON.stringify(failed));
        const isMember = system?.includes('WEB_APPROVAL_MEMBER') === true;
        record({ event: 'web-request', sessionId: options.sessionId, isMember, model: options.model, reasoningEffort: options.reasoningEffort, system: system, tools: options.tools, messages: options.messages });
        const pluginMessages = options.messages.filter(message => message.role === 'user' && message.source?.kind === 'plugin' && message.source.plugin === 'dsh-agent-teams');
        const messageText = message => message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
        const approvals = pluginMessages.filter(message => messageText(message).includes('The user approved the staged AgentTeams plan') && messageText(message).includes('from the pre-run review UI.'));
        const reports = pluginMessages.filter(message => messageText(message).includes('AgentTeams message from member worker:') && messageText(message).includes('WEB_MEMBER_REPORT_OK'));
        assert.ok(approvals.length <= 1, 'The Web route must not queue duplicate approval messages');
        assert.ok(reports.length <= 1, 'A single member report must not be delivered twice');
        const approvalNotice = approvals.find(message => !handledControlMessages.has(message.id));
        const reportNotice = reports.find(message => !handledControlMessages.has(message.id));
        let chunks;
        if (isMember) {
            // This gates only external LLM output, never agent/scheduler/HTTP code.
            await memberGate;
            options.signal?.throwIfAborted();
            if (!userText.includes('AgentTeams automatic task assignment')) chunks = textChunks('WEB_MEMBER_READY');
            else if (!names.includes('agent_teams_claim_task')) chunks = call('agent_teams_claim_task', { task_id: 't1' });
            else if (calls.filter(block => block.name === 'agent_teams_update_task').length < 2) {
                const attempt = toolText.match(/attempt_id ([^,\s)]+)/)?.[1];
                assert.ok(attempt, 'Claim result must expose the real task attempt');
                chunks = call('agent_teams_update_task', { task_id: 't1', status: names.includes('agent_teams_update_task') ? 'completed' : 'in_progress', output: 'WEB_MEMBER_TASK_DONE', attempt_id: attempt });
            }
            else if (!names.includes('agent_teams_send_message')) chunks = call('agent_teams_send_message', { to: 'captain', content: 'WEB_MEMBER_REPORT_OK' });
            else chunks = textChunks('WEB_MEMBER_DONE');
        }
        else if (!names.includes('agent_teams_create')) chunks = call('agent_teams_create', { name: 'runtime-lab', description: 'Web approval regression', approval: 'required' });
        else if (!names.includes('agent_teams_add_member')) chunks = call('agent_teams_add_member', { name: 'worker', role: 'WEB_APPROVAL_MEMBER', executionPrompt: 'WEB_APPROVAL_MEMBER: complete the assigned task and report.', reasoning_effort: 'high' });
        else if (!names.includes('agent_teams_create_task')) chunks = call('agent_teams_create_task', { subject: 'Web approval task', description: 'Complete the deterministic task after human approval', assignee: 'worker' });
        else if (reportNotice) {
            handledControlMessages.add(reportNotice.id);
            record({ event: 'web-captain-report-wake', sessionId: options.sessionId, messageId: reportNotice.id, source: reportNotice.source });
            chunks = textChunks('WEB_CAPTAIN_REPORT_RECEIVED');
        }
        else if (approvalNotice) {
            handledControlMessages.add(approvalNotice.id);
            record({ event: 'web-captain-approval-wake', sessionId: options.sessionId, messageId: approvalNotice.id, source: approvalNotice.source });
            chunks = textChunks('WEB_CAPTAIN_APPROVAL_ACKNOWLEDGED_AND_YIELDED');
        }
        else if (options.messages.at(-1)?.source?.kind === 'subagent-settled') {
            // Host bootstrap completion is a distinct pre-existing notification,
            // not another Web approval. Historical approval text is not a trigger.
            record({ event: 'web-host-settled-notice', sessionId: options.sessionId, source: options.messages.at(-1).source });
            chunks = textChunks('WEB_CAPTAIN_MEMBER_READY_NOTICE');
        }
        else chunks = textChunks('WEB_PLAN_STAGED');
        for (const chunk of chunks) {
            options.signal?.throwIfAborted();
            if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
                assert.ok((options.tools ?? []).some(tool => tool.name === chunk.block.name), 'Model called a hidden tool: ' + chunk.block.name);
                record({ event: 'web-model-tool-call', sessionId: options.sessionId, isMember, name: chunk.block.name, arguments: chunk.block.arguments });
            }
            yield chunk;
        }
    }
}
export const name = 'runtime-lab-web-approval';
export const inject = ['llm', 'agents', 'sessions', 'webServer', 'connection', 'workspaceRegistry'];
export function apply(ctx) {
    ctx.llm.registerAdapter(['runtime-lab'], new WebApprovalAdapter());
    // The real browser auth service owns token exchange and cookie verification.
    // An index shell is sufficient; the product approval route remains untouched.
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/', handler(req, res) {
        if (!ctx.connection.authorizeIndex(req, res)) return;
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('Web approval fixture');
    } }));
    void (async () => {
        await ctx.get('loader').await();
        const handle = await ctx.agents.create({ sessionId: 'session-' + randomUUID(), meta: { cwd: process.cwd() }, agentOptions: { provider: 'runtime-lab', model: 'fixture-model' } });
        ctx.effect(() => () => handle.dispose());
        const captain = handle.agent;
        await captain.whenIdle();
        record({ event: 'web-driver-user-message', sessionId: captain.id });
        captain.followup(createUserMessage({ content: [{ type: 'text', text: 'Prepare an AgentTeams plan with one worker and one task. Wait for my approval in the review UI before running it.' }], source: { kind: 'user' } }));
        await captain.whenIdle();
        const statePath = join(process.cwd(), '.agent-teams/runtime-lab/team.json');
        const readTeam = () => JSON.parse(readFileSync(statePath, 'utf8'));
        const staged = readTeam();
        assert.equal(staged.phase, 'staged');
        assert.equal(staged.captainSessionId, captain.id);
        assert.equal(staged.members.length, 1);
        assert.equal(staged.members[0].id, '');
        assert.equal(staged.tasks.length, 1);
        assert.equal(events.filter(event => event.event === 'web-request' && event.isMember).length, 0);
        record({ event: 'web-staged-idle', sessionId: captain.id, status: captain.status, teamId: staged.id });

        const baseUrl = `http://127.0.0.1:${ctx.webServer.port}`;
        const auth = await fetch(ctx.connection.authenticatedUrl(baseUrl), { redirect: 'manual', signal: AbortSignal.timeout(10000) });
        assert.equal(auth.status, 303, 'The real browser token exchange must issue a cookie');
        const cookie = auth.headers.get('set-cookie')?.split(';', 1)[0];
        assert.ok(cookie, 'The real connection must mint a browser cookie');
        const postApproval = teamId => fetch(baseUrl + '/plugins/dsh-agent-teams/plan', { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl, cookie }, body: JSON.stringify({ sessionId: captain.id, teamId, action: 'approve' }), signal: AbortSignal.timeout(10000) });
        const beforeInvalidRequests = events.filter(event => event.event === 'web-request' && !event.isMember).length;
        const invalid = await postApproval('missing-team-' + randomUUID());
        const invalidResponse = await invalid.json();
        assert.equal(invalid.status, 404, JSON.stringify(invalidResponse));
        await captain.whenIdle();
        assert.equal(events.filter(event => event.event === 'web-captain-approval-wake').length, 0);
        assert.equal(events.filter(event => event.event === 'web-request' && !event.isMember).length, beforeInvalidRequests, 'Invalid approval must not wake the captain');
        assert.equal(readTeam().phase, 'staged');
        record({ event: 'web-http-invalid-team-rejected', sessionId: captain.id, status: invalid.status });
        record({ event: 'web-http-approval-start', sessionId: captain.id, teamId: staged.id });
        const approval = await postApproval(staged.id);
        const response = await approval.json();
        assert.equal(approval.status, 200, JSON.stringify(response));
        assert.equal(response.ok, true);
        assert.equal(response.phase, 'running');
        record({ event: 'web-http-approved', sessionId: captain.id, status: approval.status, response });
        await waitFor(() => events.some(event => event.event === 'web-captain-approval-wake'), 'HTTP approval must wake the idle captain without a second user message');
        await captain.whenIdle();
        assert.equal(captain.status, 'idle');
        assert.equal(events.filter(event => event.event === 'web-captain-report-wake').length, 0);
        assert.notEqual(readTeam().tasks[0].status, 'completed');
        record({ event: 'web-approved-idle', sessionId: captain.id, status: captain.status });
        const beforeRepeatRequests = events.filter(event => event.event === 'web-request' && !event.isMember).length;
        const repeat = await postApproval(staged.id);
        const repeatResponse = await repeat.json();
        assert.equal(repeat.status, 409, JSON.stringify(repeatResponse));
        await captain.whenIdle();
        assert.equal(events.filter(event => event.event === 'web-captain-approval-wake').length, 1);
        assert.equal(events.filter(event => event.event === 'web-request' && !event.isMember).length, beforeRepeatRequests, 'Rejected repeat approval must not wake the captain');
        assert.equal(readTeam().phase, 'running');
        record({ event: 'web-http-repeat-rejected', sessionId: captain.id, status: repeat.status });
        record({ event: 'web-member-output-released' });
        releaseMember();
        await waitFor(() => events.some(event => event.event === 'web-captain-report-wake'), 'A real member report must wake the idle captain');
        for (const agent of ctx.agents.list()) {
            await agent.whenIdle();
            await ctx.sessions.flush(agent.session);
        }
        await captain.whenIdle();
        const completed = readTeam();
        assert.equal(completed.id, staged.id);
        assert.equal(completed.members.length, 1);
        assert.ok(completed.members[0].id);
        assert.equal(completed.tasks.length, 1);
        assert.equal(completed.tasks[0].status, 'completed');
        assert.equal(completed.tasks[0].output, 'WEB_MEMBER_TASK_DONE');
        const modelCalls = events.filter(event => event.event === 'web-model-tool-call');
        assert.equal(modelCalls[0].name, 'agent_teams_create');
        assert.ok(events.filter(event => event.event === 'web-request').every(event => !event.tools.some(tool => tool.name === 'agent_teams_open')));
        assert.equal(modelCalls.filter(event => event.name === 'agent_teams_approve' || event.name === 'agent_teams_status').length, 0, 'No duplicate approval or status polling');
        assert.equal(modelCalls.filter(event => event.name === 'agent_teams_create').length, 1);
        assert.equal(modelCalls.filter(event => event.name === 'agent_teams_add_member').length, 1);
        assert.equal(modelCalls.filter(event => event.name === 'agent_teams_create_task').length, 1);
        assert.equal(events.filter(event => event.event === 'web-captain-approval-wake').length, 1);
        assert.equal(events.filter(event => event.event === 'web-captain-report-wake').length, 1);
        const captainRequests = events.filter(event => event.event === 'web-request' && !event.isMember);
        const systemSha256 = sha256(captainRequests[0].system ?? ''), toolsSha256 = sha256(JSON.stringify(captainRequests[0].tools ?? []));
        assert.ok(captainRequests.every(request => sha256(request.system ?? '') === systemSha256), 'Captain system must remain stable across staging, Web approval, and reports');
        assert.ok(captainRequests.every(request => sha256(JSON.stringify(request.tools ?? [])) === toolsSha256), 'Captain tool schemas must remain stable across the complete Web workflow');
        const memberRequests = events.filter(event => event.event === 'web-request' && event.isMember);
        assert.ok(memberRequests.length > 0);
        const memberTools = ['agent_teams_claim_task', 'agent_teams_update_task', 'agent_teams_send_message', 'agent_teams_status'].sort();
        for (const request of memberRequests) assert.deepEqual(request.tools.filter(tool => tool.name.startsWith('agent_teams_')).map(tool => tool.name).sort(), memberTools, 'Every real member request must expose exactly the four member tools');
        record({ event: 'web-headers-stable', sessionId: captain.id, systemSha256, toolsSha256, captainRequests: captainRequests.length, memberRequests: memberRequests.length, memberTeamToolCount: memberTools.length });
        record({ event: 'web-approval-passed', sessionId: captain.id, teamId: completed.id, memberId: completed.members[0].id, taskStatus: completed.tasks[0].status, captainRequests: captainRequests.length });
        process.stdout.write('WEB_APPROVAL_OK\n');
        ctx.get('appExit')(0);
    })().catch(error => {
        releaseMember();
        process.stderr.write(String(error.stack ?? error) + '\n');
        ctx.get('appExit')(1);
    });
}
