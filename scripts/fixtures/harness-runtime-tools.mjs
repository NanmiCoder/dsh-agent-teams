import assert from 'node:assert/strict';

export async function executeTool(tools, input) {
    // Harness 0.2.2 delegates raw model-call batches to the installed executor.
    if (typeof tools.selectExecutor !== 'function') return tools.execute(input);
    const { name, arguments: args, callId, agent, signal } = input;
    const { results } = await tools.execute({
        calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }], agent, signal,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].callId, callId);
    return results[0].result;
}
