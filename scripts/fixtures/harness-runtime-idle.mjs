/** Real CLI driver that keeps the host alive after the captain yields.
 * Exactly one followup is initiated here. All later captain turns must be
 * initiated by the installed plugin / host notification path.
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
export const name = 'runtime-lab-idle-captain';
export const inject = ['agents', 'sessions'];
export function apply(ctx) {
    void (async () => {
        await ctx.get('loader').await();
        const handle = await ctx.agents.create({ sessionId: 'session-' + randomUUID(), meta: { cwd: process.cwd() }, agentOptions: { provider: 'runtime-lab', model: 'fixture-model' } });
        ctx.effect(() => () => handle.dispose());
        await handle.agent.whenIdle();
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Run the authorized deterministic AgentTeams fixture immediately.' }], source: { kind: 'user' } }));
        await handle.agent.whenIdle();
        appendFileSync(process.env.LAB_TRACE, JSON.stringify({ event: 'captain-idle-observed', sessionId: handle.agent.id, status: handle.agent.status, time: Date.now() }) + '\n');
        const deadline = Date.now() + 30000;
        let notified = false;
        while (Date.now() < deadline) {
            const events = existsSync(process.env.LAB_TRACE) ? readFileSync(process.env.LAB_TRACE, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
            if (events.some(x => x.event === 'captain-notified-after-yield')) {
                notified = true;
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!notified)
            throw Error('Captain did not wake after yielding; no further driver followup was sent');
        for (const agent of ctx.agents.list()) {
            await agent.whenIdle();
            await ctx.sessions.flush(agent.session);
        }
        process.stdout.write('CAPTAIN_IDLE_WAKEUP_OK\n');
        ctx.get('appExit')(0);
    })().catch(error => { process.stderr.write(String(error) + '\n'); ctx.get('appExit')(1); });
}
