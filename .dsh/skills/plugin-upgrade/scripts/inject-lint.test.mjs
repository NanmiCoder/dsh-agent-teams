import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT = fileURLToPath(new URL('./inject-lint.mjs', import.meta.url));
const CORDIS = '@deepseek-ai/cordis';
const RENDERER = '@deepseek-ai/dsh-client-ui-renderer';
const STORE = '@deepseek-ai/dsh-client-store';
const OLD = '@deepseek-ai/dsh-client-runtime';

function fixture(t, { peers = {}, inject = [], files = {}, fields = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'inject-lint-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = { name: 'test-plugin', peerDependencies: { [CORDIS]: '^4.0.1', ...peers }, dsh: { client: { inject } }, ...fields };
  const content = { 'package.json': JSON.stringify(pkg), 'src/client.ts': 'export const inject = [];\n', ...files };
  for (const [path, source] of Object.entries(content)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}

function invoke(root) {
  return spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8', timeout: 10_000 });
}

function lint(root) {
  const result = invoke(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

function snapshot(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return [path, readFileSync(path).toString('base64')];
    }).sort(([a], [b]) => a.localeCompare(b));
}

test('a type-only renderer import needs its peer without creating a runtime inject edge', (t) => {
  const root = fixture(t, {
    peers: { [RENDERER]: '^0.1.2-alpha.2' },
    files: { 'src/client.ts': `import type {} from '${RENDERER}/client';\nexport const inject = ['slots'];\n` },
  });
  const before = snapshot(root);
  const report = lint(root);
  assert.equal(report.verdict, 'OK');
  assert.deepEqual(report.declaredInject, []);
  assert.deepEqual(report.importedClientModules, [RENDERER]);
  assert.deepEqual(report.peersMissingForImports, []);
  assert.equal('derivedInject' in report, false);
  assert.deepEqual(snapshot(root), before, 'lint must not change the plugin tree');
});

test('missing type-only peers fail the verdict', (t) => {
  const report = lint(fixture(t, { files: { 'src/client.ts': `import type {} from '${RENDERER}/client';` } }));
  assert.deepEqual(report.peersMissingForImports, [RENDERER]);
  assert.equal(report.verdict, 'FIX-REQUIRED');
});

test('static-library value imports do not require an inferred inject edge', (t) => {
  const report = lint(fixture(t, {
    peers: { [STORE]: '^0.1.2-alpha.2' },
    files: { 'src/client.ts': `import { createSnapshotStore } from '${STORE}';\nexport { createSnapshotStore };` },
  }));
  assert.equal(report.verdict, 'OK');
  assert.deepEqual(report.declaredInject, []);
});

test('a missing peer for an imported and injected module cannot receive OK', (t) => {
  const report = lint(fixture(t, {
    inject: [STORE],
    files: { 'src/client.ts': `export { createSnapshotStore } from '${STORE}';` },
  }));
  assert.deepEqual(report.peersMissingForInject, [STORE]);
  assert.deepEqual(report.peersMissingForImports, [STORE]);
  assert.equal(report.verdict, 'FIX-REQUIRED');
});

test('declared runtime modules require peers even without source imports', (t) => {
  const report = lint(fixture(t, { inject: ['@example/runtime-provider'] }));
  assert.deepEqual(report.peersMissingForInject, ['@example/runtime-provider']);
  assert.equal(report.verdict, 'FIX-REQUIRED');
});

test('host inject is not mixed into the client module surface', (t) => {
  const report = lint(fixture(t, { fields: { dsh: { inject: ['webServer'] }, inject: ['connection'] } }));
  assert.deepEqual(report.declaredInject, []);
  assert.deepEqual(report.peersMissingForInject, []);
  assert.equal(report.verdict, 'OK');
});

for (const location of ['dependencies', 'peerDependencies', 'dsh.client.inject']) {
  test(`removed runtime in ${location} fails without a source import`, (t) => {
    const options = location === 'dsh.client.inject' ? { inject: [OLD] }
      : { fields: { [location]: { [CORDIS]: '^4.0.1', [OLD]: '^0.1.1-rc.2' } } };
    const root = fixture(t, options);
    const report = lint(root);
    assert.ok(report.runtimeRefsLeft.includes(join(root, 'package.json')));
    assert.equal(report.verdict, 'FIX-REQUIRED');
  });
}

for (const [file, content] of Object.entries({
  'package-lock.json': JSON.stringify({ packages: { [`node_modules/${OLD}`]: { version: '0.1.1-rc.2' } } }),
  'npm-shrinkwrap.json': JSON.stringify({ dependencies: { [OLD]: { version: '0.1.1-rc.2' } } }),
  'pnpm-lock.yaml': `packages:\n  '${OLD}@0.1.1-rc.2': {resolution: {integrity: test}}\n`,
  'yarn.lock': `"${OLD}@^0.1.1-rc.2":\n  version "0.1.1-rc.2"\n`,
  'bun.lock': JSON.stringify({ packages: { [OLD]: [`${OLD}@0.1.1-rc.2`] } }),
  'dist/plugin-manifest.json': JSON.stringify({ dsh: { client: { inject: [OLD] } } }),
  'packages/nested/package.json': JSON.stringify({ peerDependencies: { [OLD]: '^0.1.1-rc.2' } }),
  'src/types.d.ts': `export type { ISessions } from '${OLD}/client';\n`,
})) {
  test(`removed runtime in ${file} fails the verdict`, (t) => {
    const root = fixture(t, { files: { [file]: content } });
    const report = lint(root);
    assert.ok(report.runtimeRefsLeft.includes(join(root, file)));
    assert.equal(report.verdict, 'FIX-REQUIRED');
  });
}

for (const guard of [true, false]) {
  test(`${guard ? 'guarded' : 'unguarded'} raw HTTP routes require auth review, not an automatic RPC rewrite`, (t) => {
    const root = fixture(t, { files: { 'src/host.ts': `
      export const inject = ['webServer', 'connection'];
      export function apply(ctx) {
        ctx.webServer.register({ kind: 'exact', path: '/download', handler(req, res) {
          ${guard ? `const rejection = ctx.connection.requestRejection(req);
          if (rejection !== undefined) { res.writeHead(rejection); res.end(); return; }` : ''}
          res.setHeader('Content-Type', 'application/octet-stream');
          res.end('download');
        }});
      }` } });
    const report = lint(root);
    assert.equal(report.verdict, 'REVIEW-REQUIRED');
    assert.equal(report.routeReviewRequired, true);
    assert.deepEqual(report.rawWebServerRouteFiles, [join(root, 'src/host.ts')]);
  });
}

test('a guard elsewhere in a file does not prove protection for every route', (t) => {
  const report = lint(fixture(t, { files: { 'src/host.ts': `
    function checkOtherRequest(ctx, req) { return ctx.connection.requestRejection(req); }
    export function apply(ctx) { ctx.webServer.registerUpgrade({path:'/events', handler() {}}); }
  ` } }));
  assert.equal(report.verdict, 'REVIEW-REQUIRED');
});

test('commented imports/routes and similarly named packages do not create findings', (t) => {
  const report = lint(fixture(t, { files: { 'src/client.ts': `
    // import type {} from '${RENDERER}/client';
    /* ctx.webServer.register({}); */
    import { extra } from '${STORE}-extras';
    export { extra };
  ` } }));
  assert.deepEqual(report.importedClientModules, []);
  assert.deepEqual(report.rawWebServerRouteFiles, []);
  assert.equal(report.verdict, 'OK');
});

test('dependency/git trees and symlinks are not traversed', (t) => {
  const root = fixture(t, { files: {
    'node_modules/old/index.js': `import '${OLD}';`,
    '.git/hooks/pre-commit': `import '${OLD}';`,
  } });
  symlinkSync(root, join(root, 'loop'));
  assert.equal(lint(root).verdict, 'OK');
});

test('the alpha.2 Cordis check still affects the verdict', (t) => {
  const report = lint(fixture(t, { peers: { [CORDIS]: '^4.0.2' } }));
  assert.equal(report.cordisOk, false);
  assert.equal(report.verdict, 'FIX-REQUIRED');
});

for (const [name, manifest] of [['malformed JSON', '{'], ['invalid inject', JSON.stringify({ dsh: { client: { inject: 'wrong' } } })]]) {
  test(`${name} exits nonzero instead of producing a successful report`, (t) => {
    const result = invoke(fixture(t, { files: { 'package.json': manifest } }));
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /inject-lint:/);
  });
}
