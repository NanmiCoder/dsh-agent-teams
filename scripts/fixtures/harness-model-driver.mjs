/** Real-model business driver: observes native calls and never emits model output. */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import * as benchmarkCase from './fixture-model-case.mjs';
import { assertBenchmarkShellScope } from './fixture-benchmark-scope.mjs';
const { freshPrompt, coldPrompt, coldPromptFor, finishPrompt, resumeColdPrompt, resumeColdPromptFor, evaluate, verifySeededBehavior, modelMetrics } = benchmarkCase;
export const name = 'agentteams-real-model-benchmark';
export const inject = ['llm', 'agents', 'sessions', 'tools'];
export function apply(ctx) {
    const config = JSON.parse(readFileSync(process.env.AGENTTEAMS_BENCH_CONFIG, 'utf8'));
    const priorEvents = config.priorTrace ? readFileSync(config.priorTrace,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    const events = [], startedAt = Date.now();
    const fixtureHashes=Object.fromEntries([['driver',new URL(import.meta.url)],['case',new URL('./fixture-model-case.mjs',import.meta.url)]].map(([name,url])=>[name,createHash('sha256').update(readFileSync(url)).digest('hex')]));
    let requestCount = 0, captainId, cancelStreaming;
    const record = data => { const event = { ...data, order: events.length, elapsedMs: Date.now() - startedAt }; events.push(event); appendFileSync(config.trace, JSON.stringify(event) + '\n'); };
    ctx.on('tools/execute', async (exec, next) => {
        if(config.caseName==='complex'&&exec.name==='bash') assertBenchmarkShellScope(exec.arguments?.command,config.workspace);
        return next();
    });
    ctx.on('tools/result', (exec, result) => {
        record({ event: 'tool-result', sessionId: exec.agent?.id, name: exec.name, arguments: exec.arguments, isError: result.isError });
    });
    ctx.on('llm/stream', async function* (options, next) {
        const request = ++requestCount;
        if (request > config.maxRequests) throw Error('Real-model benchmark request limit reached');
        record({ event: 'model-request', request, sessionId: options.sessionId, provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort, purpose: options.purpose, systemSha256: createHash('sha256').update(options.system ?? options.messages.filter(message => message.role === 'system').flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n')).digest('hex'), systemBytes: Buffer.byteLength(options.system ?? options.messages.filter(message => message.role === 'system').flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n')), toolsSha256: createHash('sha256').update(JSON.stringify(options.tools ?? [])).digest('hex'), teamTools: options.tools?.filter(tool => tool.name.startsWith('agent_teams_')).map(tool => tool.name) });
        let response = '', firstChunk = true;
        const requestStartedAt = Date.now();
        try {
            for await (const chunk of next()) {
                if (firstChunk && ['text-delta','reasoning-delta','tool-call-delta'].includes(chunk.type)) { firstChunk = false; record({ event: 'model-first-chunk', request, latencyMs: Date.now() - requestStartedAt }); if (config.phase === 'cancel') queueMicrotask(() => cancelStreaming?.()); }
                if (chunk.type === 'finish') record({ event:'model-finish',request,reason:chunk.reason });
                if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') record({ event:'model-tool-call',request,sessionId:options.sessionId,name:chunk.block.name,arguments:chunk.block.arguments });
                if (chunk.type === 'usage') record({ event: 'model-usage', request, usage: chunk.usage });
                if (chunk.type === 'text-delta') response += chunk.text;
                yield chunk;
            }
            record({ event: 'model-response', request, sessionId: options.sessionId, text: response.slice(0,20000), durationMs: Date.now() - requestStartedAt });
        } catch (error) {
            record({ event: 'model-error', request, code: error.failure?.code, status: error.failure?.status, message: String(error.message).slice(0,500) });
            throw error;
        }
    });
    void (async () => {
        await ctx.get('loader').await();
        const handle = config.phase !== 'fresh'
            ? await ctx.agents.resume({ resumeSessionId: config.previous.captainId, agentOptions: config.model })
            : await ctx.agents.create({ sessionId: 'session-' + randomUUID(), meta: { cwd: config.agentCwd ?? config.workspace }, agentOptions: config.model });
        ctx.effect(() => () => handle.dispose());
        const captain = handle.agent;
        captainId = captain.id;
        await captain.whenIdle();
        if (config.phase === 'cancel') {
            cancelStreaming = () => { record({ event: 'stream-cancel-requested', sessionId: captain.id }); captain.cancel({ kind: 'user' }); };
            captain.followup(createUserMessage({ content: [{ type: 'text', text: '本次只测试流式输出中断。请持续输出从 1 到 10000 的整数，每行一个。不调用工具，不修改文件或团队状态。' }], source: { kind: 'user' } }));
            let timer;
            try { await Promise.race([captain.whenIdle(), new Promise((_,reject) => { timer = setTimeout(() => reject(Error('Streaming cancellation timed out')), config.timeoutMs); })]); } finally { clearTimeout(timer); }
            const passed = events.some(e => e.event === 'model-first-chunk') && events.some(e => e.event === 'stream-cancel-requested') && captain.status === 'idle';
            await ctx.sessions.flush(captain.session);
            writeFileSync(config.result, JSON.stringify({ passed, phase: config.phase, provider: config.model.provider, model: config.model.model, elapsedMs: Date.now() - startedAt, requests: requestCount, checks: { realProviderChunkObserved: events.some(e=>e.event === 'model-first-chunk'), cancelledWhileStreaming: events.some(e=>e.event === 'stream-cancel-requested'), captainIdle: captain.status === 'idle' } }, null, 2) + '\n');
            process.stdout.write(passed ? 'REAL_MODEL_CANCELLATION_PASS\n' : 'REAL_MODEL_CANCELLATION_FAIL\n');
            ctx.get('appExit')(passed ? 0 : 1);
            return;
        }
        record({ event: 'benchmark-user-input', sessionId: captain.id, phase: config.phase });
        const selectedPrompt = config.phase==='cold' ? (coldPromptFor?.(config.previous?.coldPlan)??coldPrompt)
            : config.phase==='cold-resume' ? (resumeColdPromptFor?.(config.previous?.coldPlan)??resumeColdPrompt)
            : config.phase==='finish' ? finishPrompt : freshPrompt;
        const prompt = (config.agentCwd && config.agentCwd !== config.workspace ? `Harness 工作目录是 ${config.agentCwd}；本次任务项目在 ${config.workspace}。下面所有相对路径都相对于该项目目录，读写时使用完整路径或先 cd 到该项目。报告中的 path 字段仍保留项目相对路径。成员任务也必须传递这一项目范围。不要操作其他目录。\n\n` : '') + selectedPrompt;
        captain.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }));
        const deadline = startedAt + config.timeoutMs;
        let idleSince, outcome, lastState;
        while (Date.now() < deadline) {
            outcome = evaluate(config.workspace, captain.id, [...priorEvents,...events], config.phase, config.previous);
            const snapshot = JSON.stringify({team:outcome.team,agents:ctx.agents.list().map(a=>({id:a.id,status:a.status}))});
            if(snapshot!==lastState){lastState=snapshot;record({event:'benchmark-state',...JSON.parse(snapshot)});}
            const allIdle = ctx.agents.list().every(agent => agent.status === 'idle');
            if (allIdle) idleSince ??= Date.now(); else idleSince = undefined;
            if (outcome.passed && allIdle && Date.now() - idleSince >= 500) break;
            if (idleSince && Date.now() - idleSince > 10000) break;
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        outcome = evaluate(config.workspace, captain.id, [...priorEvents,...events], config.phase, config.previous);
        const external = await verifySeededBehavior(config.workspace);
        const passed = outcome.passed && (external.passed ?? (external.sourceUnchanged && external.repeatedProductScans && external.unsafeHtmlEcho && external.validInputStillDisabled));
        for (const agent of ctx.agents.list()) { if (agent.status !== 'idle') agent.cancel({ kind: 'user' }); await agent.whenIdle(); if (ctx.sessions.get(agent.id) === agent.session) await ctx.sessions.flush(agent.session); }
        const result = { passed, phase: config.phase, provider: config.model.provider, model: config.model.model, reasoningEffort: config.model.reasoningEffort, elapsedMs: Date.now() - startedAt, requests: requestCount, ...outcome, external, fixtureHashes, priorEvidence: config.priorTrace ? {path:config.priorTrace,sha256:createHash('sha256').update(readFileSync(config.priorTrace)).digest('hex'),events:priorEvents.length} : undefined, metrics:modelMetrics(events,captain.id), modelErrors: events.filter(event => event.event === 'model-error'), actualUsage: events.filter(event => event.event === 'model-usage').map(event => event.usage) };
        result.passed = passed;
        writeFileSync(config.result, JSON.stringify(result, null, 2) + '\n');
        record({ event: 'benchmark-finished', passed });
        process.stdout.write(passed ? 'REAL_MODEL_BUSINESS_PASS\n' : 'REAL_MODEL_BUSINESS_FAIL\n');
        ctx.get('appExit')(passed ? 0 : 1);
    })().catch(error => {
        const result = { passed: false, phase: config.phase, captainId, requests: requestCount, elapsedMs: Date.now() - startedAt, error: String(error.message).slice(0,500), modelErrors: events.filter(event => event.event === 'model-error') };
        writeFileSync(config.result, JSON.stringify(result, null, 2) + '\n');
        process.stderr.write('Real model benchmark failed; see result.json\n');
        ctx.get('appExit')(1);
    });
}
