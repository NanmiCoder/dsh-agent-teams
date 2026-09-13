import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBenchmarkShellScope} from './harness-benchmark-scope.mjs';
const root='/tmp/agentteams-case/workspace';
test('rejects the observed background-cd cleanup and broad process termination',()=>{
  for(const command of [
    `cd ${root} && mkdir -p .verify && ( node server.mjs ) & SERVER_PID=$!\nkill $SERVER_PID; rm -rf .verify data`,
    `cd ${root} && pkill -f 'node serve.mjs'`,
    `cd ${root} && killall node`,
    'rm -rf .verify data',
    'cd /tmp && rm -rf data',
  ]) assert.throws(()=>assertBenchmarkShellScope(command,root));
});
test('allows foreground project commands and stderr redirection',()=>{
  for(const command of [`cd ${root} && npm test 2>&1 | tail -12`, `cd -- '${root}'\nnode --input-type=module <<'EOF'\nconst ok=true;\nEOF`, `cd "${root}"; node tests/once.mjs`]) {
    assert.doesNotThrow(()=>assertBenchmarkShellScope(command,root));
  }
});
