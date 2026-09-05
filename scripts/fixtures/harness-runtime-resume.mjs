/** Test-only driver mounted by the real published CLI after a cold restart. */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
export const name = 'runtime-lab-cold-resume';
export const inject = ['agents', 'sessions'];
export function apply(ctx) {
    void (async () => {
        await ctx.get('loader').await();
        const handle = await ctx.agents.resume({ resumeSessionId: process.env.LAB_PARENT_SESSION, agentOptions: { provider: 'runtime-lab', model: 'fixture-model' } });
        ctx.effect(() => () => handle.dispose());
        await handle.agent.whenIdle();
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'COLD_RESTORE_FIXTURE' }], source: { kind: 'user' } }));
        await handle.agent.whenIdle();
        for (const agent of ctx.agents.list()) {
            await agent.whenIdle();
            await ctx.sessions.flush(agent.session);
        }
        process.stdout.write('COLD_RESTORE_DRIVER_DONE\n');
        ctx.get('appExit')(0);
    })().catch(error => { process.stderr.write(String(error) + '\n'); ctx.get('appExit')(1); });
}
