/** Real-model business driver: observes native calls and never emits model output. */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { freshPrompt, coldPrompt, evaluate, verifySeededBehavior, modelMetrics } from './fixture-model-case.mjs';
export const name = 'agentteams-real-model-benchmark';
export const inject = ['llm', 'agents', 'sessions'];
export function apply(ctx) {
    const config = JSON.parse(readFileSync(process.env.AGENTTEAMS_BENCH_CONFIG, 'utf8'));
    const events = [], startedAt = Date.now();
    const fixtureHashes=Object.fromEntries([['driver',new URL(import.meta.url)],['case',new URL('./fixture-model-case.mjs',import.meta.url)]].map(([name,url])=>[name,createHash('sha256').update(readFileSync(url)).digest('hex')]));
    let requestCount = 0, captainId;
    const record = data => { const event = { ...data, order: events.length, elapsedMs: Date.now() - startedAt }; events.push(event); appendFileSync(config.trace, JSON.stringify(event) + '\n'); };
    ctx.on('tools/result', (exec, result) => {
        record({ event: 'tool-result', sessionId: exec.agent?.id, name: exec.name, arguments: exec.arguments, isError: result.isError });
    });
    ctx.on('llm/stream', async function* (options, next) {
        const request = ++requestCount;
        if (request > config.maxRequests) throw Error('Real-model benchmark request limit reached');
        record({ event: 'model-request', request, sessionId: options.sessionId, provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort, purpose: options.purpose, systemSha256: createHash('sha256').update(options.system ?? '').digest('hex'), systemBytes: Buffer.byteLength(options.system ?? ''), toolsSha256: createHash('sha256').update(JSON.stringify(options.tools ?? [])).digest('hex'), teamTools: options.tools?.filter(tool => tool.name.startsWith('agent_teams_')).map(tool => tool.name) });
        let response = '';
        try {
            for await (const chunk of next()) {
                if (chunk.type === 'usage') record({ event: 'model-usage', request, usage: chunk.usage });
                if (chunk.type === 'text-delta') response += chunk.text;
                yield chunk;
            }
            record({ event: 'model-response', request, sessionId: options.sessionId, text: response.slice(0,20000) });
        } catch (error) {
            record({ event: 'model-error', request, code: error.failure?.code, status: error.failure?.status, message: String(error.message).slice(0,500) });
            throw error;
        }
    });
    void (async () => {
        await ctx.get('loader').await();
        const handle = config.phase === 'cold'
            ? await ctx.agents.resume({ resumeSessionId: config.previous.captainId, agentOptions: config.model })
            : await ctx.agents.create({ sessionId: 'session-' + randomUUID(), meta: { cwd: config.workspace }, agentOptions: config.model });
        ctx.effect(() => () => handle.dispose());
        const captain = handle.agent;
        captainId = captain.id;
        await captain.whenIdle();
        record({ event: 'benchmark-user-input', sessionId: captain.id, phase: config.phase });
        captain.followup(createUserMessage({ content: [{ type: 'text', text: config.phase === 'cold' ? coldPrompt : freshPrompt }], source: { kind: 'user' } }));
        const deadline = startedAt + config.timeoutMs;
        let idleSince, outcome;
        while (Date.now() < deadline) {
            outcome = evaluate(config.workspace, captain.id, events, config.phase, config.previous);
            const allIdle = ctx.agents.list().every(agent => agent.status === 'idle');
            if (allIdle) idleSince ??= Date.now(); else idleSince = undefined;
            if (outcome.passed && allIdle && Date.now() - idleSince >= 500) break;
            if (idleSince && Date.now() - idleSince > 10000) break;
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        outcome = evaluate(config.workspace, captain.id, events, config.phase, config.previous);
        const external = await verifySeededBehavior(config.workspace);
        const passed = outcome.passed && external.sourceUnchanged && external.repeatedProductScans && external.unsafeHtmlEcho && external.validInputStillDisabled;
        for (const agent of ctx.agents.list()) { if (agent.status !== 'idle') agent.cancel({ kind: 'user' }); await agent.whenIdle(); await ctx.sessions.flush(agent.session); }
        const result = { passed, phase: config.phase, provider: config.model.provider, model: config.model.model, reasoningEffort: config.model.reasoningEffort, elapsedMs: Date.now() - startedAt, requests: requestCount, ...outcome, external, fixtureHashes, metrics:modelMetrics(events,captain.id), modelErrors: events.filter(event => event.event === 'model-error'), actualUsage: events.filter(event => event.event === 'model-usage').map(event => event.usage) };
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
