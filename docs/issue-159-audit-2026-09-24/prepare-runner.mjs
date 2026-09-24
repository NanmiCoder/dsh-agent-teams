// Prepare isolated diagnostic fixtures without changing production or standard tests.
import { cpSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
if (!process.argv[2]) throw Error('Pass a fresh output directory');
const target = resolve(process.argv[2]);
if (existsSync(target)) throw Error('Output already exists; choose a fresh directory');
cpSync(resolve(here, '../../scripts'), target, { recursive: true });
copyFileSync(join(here, 'probe-fixture.mjs'), join(target, 'fixtures/harness-runtime-stability.mjs'));
copyFileSync(join(here, 'real-model-case.mjs'), join(target, 'fixtures/harness-model-case.mjs'));
const runner = join(target, 'harness-runtime-verify.mjs');
let text = readFileSync(runner, 'utf8');
const oldAssertions = '...Object.fromEntries(checks.map(check => [check, trace.some(x => x.event === `stability-${check}-passed`)]))';
const oldEvidence = 'trace.filter(x => checks.some(check => x.event === `stability-${check}-passed`))';
if (!text.includes(oldAssertions) || !text.includes(oldEvidence)) throw Error('Runtime runner changed; review the integration seams');
text = text.replace(oldAssertions, "probeCompleted:trace.some(x=>x.event==='probe-complete')")
  .replace(oldEvidence, "trace.filter(x => x.event.startsWith('probe-') && x.event!=='probe-tool-result')");
writeFileSync(runner, text);
console.log(target);
