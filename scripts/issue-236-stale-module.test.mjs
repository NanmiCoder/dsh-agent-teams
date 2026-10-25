// Direct-module regression for #236. Only the plugin's imported format constant
// is fault-injected; this is not a mixed-install or CLI Loader end-to-end test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

await test('live format 4 survives a resolved module reporting format 0', () => {
  const root = resolve(import.meta.dirname, '..');
  const probe = String.raw`
    import assert from 'node:assert/strict';
    import { createRequire, registerHooks } from 'node:module';
    import { pathToFileURL } from 'node:url';
    import { join } from 'node:path';
    const root = process.argv[1];
    const url = name => pathToFileURL(join(root, 'lib', name + '.js')).href;
    const compatUrl = url('harness-compat');
    let injected = 0;
    const hook = registerHooks({resolve(specifier, context, nextResolve) {
      const actual = nextResolve(specifier, context);
      if (specifier !== '@deepseek-ai/dsh-session' || context.parentURL !== compatUrl) return actual;
      injected++;
      return {url: 'data:text/javascript,' + encodeURIComponent(
        'export * from ' + JSON.stringify(actual.url) + '; export const SESSION_FORMAT_VERSION = 0;'
      ), shortCircuit: true};
    }});
    try {
      const compat = await import(compatUrl);
      assert.equal(injected, 1, 'the stale-constant seam must actually be exercised');
      assert.equal(compat.hostSessionFormatVersion(), 0);
      assert.equal(compat.hostSessionFormatVersion(4), 4, 'the live format must outrank the stale module');
      const modern = {kind:'agent-teams'};
      const legacy = {kind:'plugin',plugin:'@nanmicoder/dsh-agent-teams'};
      const agent = {session:{header:{version:4}}};
      assert.equal(compat.observedSessionFormatVersion(agent), 4);
      assert.deepEqual(compat.agentTeamsSource(modern, 4), modern);
      assert.deepEqual(compat.agentTeamsSource(modern, 2), legacy);
      assert.deepEqual(compat.agentTeamsSource(modern), legacy);

      const {installAgentTeamsGestureBoundary} = await import(url('command'));
      const require = createRequire(pathToFileURL(join(root, 'package.json')));
      const {createUserMessage} = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
      let listener;
      installAgentTeamsGestureBoundary({on(event, callback) {
        assert.equal(event, 'agent/pre-step'); listener = callback;
      }});
      const messages = [createUserMessage({content:[{type:'text',text:'/agent-teams inspect this task'}],source:{kind:'user'}})];
      const result = await listener({agent,messages,signal:new AbortController().signal}, async()=>({kind:'enter',messages}));
      assert.equal(result.kind, 'enter');
      assert.equal(result.messages.at(-1).source.kind, 'agent-teams-command', 'gesture must pass the live observation');

      const queued = [];
      const runtime = {[Symbol.for('dsh.subagent.deliverPrompt')](_parent,_child,_content,source) {queued.push(source);return 'message-id'}};
      await compat.queueMemberPrompt(runtime,agent,'child',[{type:'text',text:'job'}],new AbortController().signal);
      await compat.steerMemberPrompt(runtime,agent,'child',[{type:'text',text:'coordination'}],new AbortController().signal,agent);
      assert.deepEqual(queued,[modern,modern], 'both member delivery paths must observe the live session');
      console.log('ISSUE_236_STALE_MODULE_OK');
    } finally { hook.deregister(); }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe, root], {encoding:'utf8',timeout:30000});
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.match(result.stdout, /ISSUE_236_STALE_MODULE_OK/);
});
