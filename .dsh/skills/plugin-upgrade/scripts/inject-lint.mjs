#!/usr/bin/env node
// Read-only alpha.2 residue/peer checks. Import scans do not derive runtime inject.
// Usage: node inject-lint.mjs <plugin-dir>
// Exit 0 with a JSON report; invalid/unreadable input exits 2.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const ROOT = process.argv[2];
if (!ROOT) { console.error('Usage: node inject-lint.mjs <plugin-dir>'); process.exit(2) }

const CLIENT_MODULES = new Set([
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-settings-plugins',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-ui-conversation',
]);
const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const CONFIG = /\.(?:json|ya?ml|lock)$/;
const OLD_RUNTIME = /@deepseek-ai\/dsh-client-runtime(?![A-Za-z0-9_-])/;

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, acc);
    else if (entry.isFile() && (CODE.test(entry.name) || CONFIG.test(entry.name))) acc.push(path);
  }
  return acc;
}

// Preserve string literals while removing ordinary comments from the import scan.
// This is a source heuristic, not a TypeScript/data-flow parser.
function withoutComments(src) {
  return src.replace(/'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (token) => token.startsWith('//') || token.startsWith('/*') ? ' ' : token);
}

try {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('package.json must contain an object');
  const declared = pkg?.dsh?.client?.inject ?? [];
  if (!Array.isArray(declared) || declared.some((id) => typeof id !== 'string' || !id)) {
    throw new Error('dsh.client.inject must be an array of package names');
  }
  const declaredInject = [...new Set(declared)].sort();
  const peers = pkg.peerDependencies ?? {};
  if (!peers || typeof peers !== 'object' || Array.isArray(peers)) throw new Error('peerDependencies must contain an object');
  const imported = new Set();
  const runtimeRefs = [];
  const rawWebServerRouteFiles = [];

  for (const file of walk(ROOT)) {
    const src = readFileSync(file, 'utf8');
    if (OLD_RUNTIME.test(src)) runtimeRefs.push(file);
    if (!CODE.test(basename(file))) continue;
    const code = withoutComments(src);
    for (const match of code.matchAll(/from\s+['"](@deepseek-ai\/[^'"]+)['"]|import\s+['"](@deepseek-ai\/[^'"]+)['"]/g)) {
      const spec = match[1] ?? match[2];
      const owner = spec.split('/').slice(0, 2).join('/');
      // Value and type-only imports both need peers; neither proves an inject edge.
      if (CLIENT_MODULES.has(owner)) imported.add(owner);
    }
    if (/ctx\s*\.\s*webServer\s*\.\s*register(?:Upgrade)?\s*\(/.test(code)) rawWebServerRouteFiles.push(file);
  }

  const hasPeer = (id) => typeof peers[id] === 'string' && peers[id].trim().length > 0;
  const peersMissingForInject = declaredInject.filter((id) => !hasPeer(id));
  const peersMissingForImports = [...imported].sort().filter((id) => !hasPeer(id));
  const cordis = peers['@deepseek-ai/cordis'] ?? null;
  const needsFix = runtimeRefs.length > 0 || cordis !== '^4.0.1'
    || peersMissingForInject.length > 0 || peersMissingForImports.length > 0;

  console.log(JSON.stringify({
    importedClientModules: [...imported].sort(),
    declaredInject,
    peersMissingForInject,
    peersMissingForImports,
    cordisPeer: cordis,
    cordisOk: cordis === '^4.0.1',
    runtimeRefsLeft: runtimeRefs,
    rawWebServerRouteFiles,
    // A route can already call requestRejection, even via a helper. Never infer
    // authentication or require a protocol rewrite from a registration regex.
    routeReviewRequired: rawWebServerRouteFiles.length > 0,
    verdict: needsFix ? 'FIX-REQUIRED' : rawWebServerRouteFiles.length > 0 ? 'REVIEW-REQUIRED' : 'OK',
  }, null, 2));
} catch (error) {
  console.error(`inject-lint: ${error.message}`);
  process.exitCode = 2;
}
