#!/usr/bin/env node
/** Reuse the real API benchmark launcher with one independent issue scenario.
 * Requires --scenario renamed|disabled|repair|repair-conflict|amend,
 * --runtime-dir, --artifact, --report-dir and an existing --agent-cwd.
 * Credentials remain in the configured local store; never copied to reports.
 */
import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const args=new Map(),allowed=['--scenario','--runtime-dir','--artifact','--report-dir','--agent-cwd'];
for(let i=2;i<process.argv.length;i+=2){if(!allowed.includes(process.argv[i])||!process.argv[i+1]||args.has(process.argv[i]))throw Error('Invalid argument');args.set(process.argv[i],process.argv[i+1]);}
for(const flag of allowed)if(!args.has(flag))throw Error(flag+' required');
const scenario=args.get('--scenario');if(!['renamed','disabled','repair','repair-conflict','amend'].includes(scenario))throw Error('Unknown scenario');
const source=dirname(fileURLToPath(import.meta.url)),report=resolve(args.get('--report-dir')),runner=join(report,'runner');
mkdirSync(join(runner,'fixtures'),{recursive:true});
for(const file of ['harness-model-benchmark.mjs','fixtures/harness-model-driver.mjs','fixtures/harness-benchmark-scope.mjs'])copyFileSync(join(source,file),join(runner,file));
writeFileSync(join(runner,'fixtures/harness-model-case.mjs'),readFileSync(join(source,'fixtures/harness-issue-case.mjs'),'utf8').replace("export const scenario = 'repair-conflict';",`export const scenario = ${JSON.stringify(scenario)};`));
let launcher=readFileSync(join(runner,'harness-model-benchmark.mjs'),'utf8');
const patch=scenario==='disabled'?"patch.push({id:'tool-subagent',disabled:true},{id:'tool-subagent-control',disabled:true});":scenario==='renamed'?"patch.push({id:'tool-subagent',name:'@deepseek-ai/dsh-tool-subagent',config:{provider:'spawn',toolName:'subagent_legacy',backgroundMode:'continuable'}});":"";
const marker="writeFileSync(join(profile,'cordis.patch.yml'),yaml.stringify(patch));";
if(!launcher.includes(marker))throw Error('Benchmark patch seam changed');
launcher=launcher.replace(marker,patch+'\n'+marker);writeFileSync(join(runner,'harness-model-benchmark.mjs'),launcher);
const artifact=resolve(args.get('--artifact'));
const child=spawn(process.execPath,[join(runner,'harness-model-benchmark.mjs'),'--runtime-dir',resolve(args.get('--runtime-dir')),'--baseline-artifact',artifact,'--candidate-artifact',artifact,'--report-dir',join(report,'run'),'--only','candidate','--agent-cwd',resolve(args.get('--agent-cwd')),'--timeout-ms','360000','--max-requests','90'],{stdio:'inherit'});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
