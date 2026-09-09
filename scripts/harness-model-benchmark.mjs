#!/usr/bin/env node
/** Real-provider paired business benchmark through published CLI + Loader.
 * Does not modify an active profile, copy credentials, or script model responses.
 * Requires an already verified exact Harness runtime. Example:
 * node scripts/harness-model-benchmark.mjs --runtime-dir /tmp/runtime
 *   --baseline-artifact /tmp/old.tgz --candidate-artifact /tmp/new.tgz
 *   --report-dir /tmp/agentteams-real-ab
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sources, freshPrompt, coldPrompt } from './fixtures/harness-model-case.mjs';

const args = new Map(), allowed = new Set(['--runtime-dir','--baseline-artifact','--candidate-artifact','--report-dir','--settings','--credential-file','--only','--timeout-ms','--max-requests']);
for (let i=2;i<process.argv.length;i++) { const flag=process.argv[i]; if(!allowed.has(flag)||args.has(flag)||!process.argv[i+1]) throw Error('Invalid argument '+flag); args.set(flag,process.argv[++i]); }
for(const flag of ['--runtime-dir','--report-dir','--baseline-artifact']) if(!args.has(flag))throw Error(flag+' required');
const only=args.get('--only'); if(only&&!['baseline','candidate','upgrade'].includes(only))throw Error('Invalid --only');
if(only!=='baseline'&&!args.has('--candidate-artifact'))throw Error('--candidate-artifact required');
const runtime=resolve(args.get('--runtime-dir')), report=resolve(args.get('--report-dir'));
mkdirSync(report,{recursive:true});
const req=createRequire(join(runtime,'package.json')), yaml=req('yaml');
const credentialFile=resolve(args.get('--credential-file')??join(homedir(),'.dsh','.credentials.yaml'));
const settingsFile=resolve(args.get('--settings')??join(homedir(),'.dsh','settings.yaml'));
const settings=yaml.parse(readFileSync(settingsFile,'utf8'))??{};
const chosen=settings['agent-default-model'];
if(chosen?.provider!=='deepseek-official'||typeof chosen.model!=='string')throw Error('This benchmark requires the configured deepseek-official model; no provider is silently substituted');
const model={provider:chosen.provider,model:chosen.model,...chosen.reasoningEffort?{reasoningEffort:chosen.reasoningEffort}:{}};
const configured=settings['llm-deepseek']??{};
const credentialRef=configured.apiKeyEnv??'DEEPSEEK_API_KEY';
if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(credentialRef))throw Error('Invalid configured credential reference');
const {parseCredentialsDocument,renderFlatLayoutMigration}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-credentials-local')).href);
// Parse only to check the selected route. Values never enter artifacts or logs.
// Refuse the legacy format because the official provider would migrate it.
const credentialText=existsSync(credentialFile)?readFileSync(credentialFile,'utf8'):'';
if(renderFlatLayoutMigration(credentialText)!==undefined)throw Error('Credential store needs migration; benchmark refuses to modify it');
const credentialAvailable=Boolean(process.env[credentialRef])||parseCredentialsDocument(credentialText,credentialFile).refs.has(credentialRef);
console.log(JSON.stringify({provider:model.provider,model:model.model,credentialAvailable}));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const json=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n');
if(!credentialAvailable) { json(join(report,'result.json'),{passed:false,blocked:'Configured model credential unavailable',provider:model.provider,model:model.model});process.exit(2); }
// A URL containing a credential is never copied into a generated profile.
if(configured.baseURL) {const url=new URL(configured.baseURL);if(url.username||url.password||url.search)throw Error('Credential-bearing adapter URL cannot be persisted by benchmark');}
const adapter={apiKeyEnv:credentialRef,maxTokens:16384,...configured.baseURL?{baseURL:configured.baseURL}:{},...configured.models?{models:configured.models}:{}};
const lock=JSON.parse(readFileSync(join(runtime,'package-lock.json'),'utf8'));
const cohort=Object.entries(lock.packages).filter(([path])=>/node_modules\/@deepseek-ai\/dsh(?:-[^/]+)?$/.test(path)).map(([path,entry])=>({path,version:entry.version,disk:JSON.parse(readFileSync(join(runtime,path,'package.json'),'utf8')).version}));
const hostVersion=JSON.parse(readFileSync(join(runtime,'node_modules/@deepseek-ai/dsh/package.json'),'utf8')).version;
if(!cohort.length||cohort.some(item=>item.version!==hostVersion||item.disk!==hostVersion))throw Error('Mixed DSH runtime; prepare one exact cohort first');
const timeoutMs=Number(args.get('--timeout-ms')??900000),maxRequests=Number(args.get('--max-requests')??100);
if(!Number.isFinite(timeoutMs)||timeoutMs<1000||!Number.isInteger(maxRequests)||maxRequests<1)throw Error('Invalid benchmark limits');
const fixtures=dirname(fileURLToPath(import.meta.url));
// Freeze inputs before the first provider call: later builds or edits cannot
// silently change a subsequent phase of the same paid comparison.
const testContents=Object.fromEntries(['harness-model-benchmark.mjs','fixtures/harness-model-case.mjs','fixtures/harness-model-driver.mjs'].map(path=>[path,readFileSync(join(fixtures,path))]));
const testFiles=Object.fromEntries(Object.entries(testContents).map(([path,bytes])=>[path,createHash('sha256').update(bytes).digest('hex')]));
const artifacts=Object.fromEntries(['baseline','candidate'].filter(label=>args.has('--'+label+'-artifact')).map(label=>[label,{path:resolve(args.get('--'+label+'-artifact')),bytes:readFileSync(resolve(args.get('--'+label+'-artifact')))}]));
const manifestPath=join(report,only?'manifest-'+only+'.json':'manifest.json');
if(existsSync(manifestPath))throw Error('Benchmark manifest exists; use a fresh report directory');
json(manifestPath,{hostVersion,cohortCount:cohort.length,runtime,model,testFiles,artifacts:Object.fromEntries(Object.entries(artifacts).map(([label,item])=>[label,{path:item.path,sha256:createHash('sha256').update(item.bytes).digest('hex')}])),timeoutMs,maxRequests,seedSha256:Object.fromEntries(Object.entries(sources).map(([path,text])=>[path,createHash('sha256').update(text).digest('hex')])),inputs:{fresh:freshPrompt,cold:coldPrompt},scope:'Real configured DeepSeek adapter; exact published Harness CLI/Loader. External acceptance checks files, task status and member tool provenance. No model call order is preprogrammed.'});
const environment={PATH:process.env.PATH,LANG:process.env.LANG??'en_US.UTF-8',HOME:join(report,'user-home'),DSH_TELEMETRY_DISABLED:'1',DSH_PERMISSION_MODE:'workspace-write',...process.env[credentialRef]?{[credentialRef]:process.env[credentialRef]}:{}};
mkdirSync(environment.HOME,{recursive:true});
async function command(argv,cwd,env,label,limit=timeoutMs+30000) {
    const child=spawn(argv[0],argv.slice(1),{cwd,env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',timedOut=false;
    child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),5000).unref();},limit);
    const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});clearTimeout(timer);
    writeFileSync(join(report,label+'.stdout.log'),stdout);writeFileSync(join(report,label+'.stderr.log'),stderr);
    return {...exit,timedOut};
}
async function extract(artifact,label) {
    const target=join(report,label+'-artifact');
    if(existsSync(target))throw Error('Artifact directory already exists; use a fresh report or a new --only phase');
    mkdirSync(target,{recursive:true});
    const unpacked=await command(['tar','-xzf',artifact,'-C',target],report,environment,label+'-unpack',60000);
    if(unpacked.code!==0)throw Error('Artifact extraction failed');
    const packageDir=join(target,'package'),pkg=JSON.parse(readFileSync(join(packageDir,'package.json'),'utf8'));
    if(pkg.name!=='@nanmicoder/dsh-agent-teams')throw Error('Wrong artifact identity');
    symlinkSync(join(runtime,'node_modules'),join(packageDir,'node_modules'),'dir');
    return {packageDir,artifactSha256:hash(artifact),pluginVersion:pkg.version};
}
async function run(label,phase,artifact,existing) {
    const runDir=join(report,label);mkdirSync(runDir,{recursive:true});
    const workspace=existing?.workspace??join(runDir,'workspace'),home=existing?.home??join(runDir,'home'),profile=join(home,'profiles','headless');
    if(phase==='fresh') {
        if(existsSync(workspace))throw Error('Workspace already exists; never overwrite a completed benchmark');
        for(const [path,source] of Object.entries(sources)){mkdirSync(dirname(join(workspace,path)),{recursive:true});writeFileSync(join(workspace,path),source);}
        mkdirSync(join(workspace,'reports'),{recursive:true});
        mkdirSync(join(profile,'node_modules/@nanmicoder'),{recursive:true});
        symlinkSync(join(runtime,'node_modules/@deepseek-ai'),join(profile,'node_modules/@deepseek-ai'),'dir');
    }
    const artifactSnapshot=join(runDir,'artifact.tgz');
    if(existsSync(artifactSnapshot))throw Error('Run artifact already exists; never overwrite benchmark evidence');
    writeFileSync(artifactSnapshot,artifact.bytes);
    const extracted={...await extract(artifactSnapshot,label),sourceArtifact:artifact.path};
    const pluginLink=join(profile,'node_modules/@nanmicoder/dsh-agent-teams');
    if(existsSync(pluginLink))rmSync(pluginLink);
    symlinkSync(extracted.packageDir,pluginLink,'dir');
    json(join(profile,'package.json'),{name:'agentteams-real-model-profile',version:'0.0.0',private:true,type:'module',dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-headless','@nanmicoder/dsh-agent-teams'],patchReload:'startup'}}});
    mkdirSync(join(runDir,'executed-fixtures'),{recursive:true});
    for(const [source,target] of [['fixtures/harness-model-driver.mjs','fixture-model-driver.mjs'],['fixtures/harness-model-case.mjs','fixture-model-case.mjs']]) {
        writeFileSync(join(profile,target),testContents[source]);
        writeFileSync(join(runDir,'executed-fixtures',target),testContents[source]);
    }
    const patch=[{id:'headless-startup',disabled:true},{id:'headless-runner',disabled:true},{id:'llm-pi-ai',disabled:true},{id:'session-title-llm',disabled:true},{id:'credentials',config:{path:credentialFile,watch:false}},{id:'llm-deepseek',config:adapter},{id:'agent-default-model',config:model},{id:'approval',config:{policy:'never'}},{id:'permission',config:{defaultPreset:'benchmark-workspace',presets:{'benchmark-workspace':{sandbox:'workspace-write',approval:'never'}}}},{insert:[{id:'agentteams-real-model-benchmark',name:'./fixture-model-driver.mjs'}]}];
    writeFileSync(join(profile,'cordis.patch.yml'),yaml.stringify(patch));
    const trace=join(runDir,'trace.jsonl'),resultPath=join(runDir,'result.json'),configPath=join(runDir,'driver-config.json');
    json(configPath,{phase,model,workspace,trace,result:resultPath,timeoutMs,maxRequests,...existing?.previous?{previous:existing.previous}:{}});
    const exit=await command([process.execPath,join(runtime,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','headless'],workspace,{...environment,DSH_HOME:home,AGENTTEAMS_BENCH_CONFIG:configPath},label);
    const result=existsSync(resultPath)?JSON.parse(readFileSync(resultPath,'utf8')):{passed:false,error:'Driver did not produce a result'};
    const outcome={label,...extracted,workspace,home,...result,exit};
    outcome.passed=result.passed===true&&exit.code===0&&!exit.timedOut;
    json(join(runDir,'run.json'),outcome);
    console.log(JSON.stringify({label,passed:outcome.passed,provider:model.provider,model:model.model,requests:outcome.requests,elapsedMs:outcome.elapsedMs,checks:outcome.checks,error:outcome.error,modelErrors:outcome.modelErrors}));
    return outcome;
}
const runs=[];
if(!only||only==='baseline')runs.push(await run('baseline','fresh',artifacts.baseline));
if(!only||only==='candidate')runs.push(await run('candidate','fresh',artifacts.candidate));
if(!only||only==='upgrade') {
    const baseline=runs.find(run=>run.label==='baseline')??(existsSync(join(report,'baseline/run.json'))?JSON.parse(readFileSync(join(report,'baseline/run.json'),'utf8')):undefined);
    if(baseline?.passed&&baseline.team)runs.push(await run('upgrade','cold',artifacts.candidate,{workspace:baseline.workspace,home:baseline.home,previous:baseline.team}));
    else runs.push({label:'upgrade',passed:false,blocked:'Baseline must complete and retain its team before old-team cold-resume validation'});
}
const combined=['baseline','candidate','upgrade'].flatMap(label=>existsSync(join(report,label,'run.json'))?[JSON.parse(readFileSync(join(report,label,'run.json'),'utf8'))]:runs.filter(run=>run.label===label));
const passed=combined.every(run=>run.passed);
json(join(report,'result.json'),{passed,hostVersion,model,testFiles,runs:combined,unverified:['statistical success-rate equivalence from repeated independent trials','other providers/models','quality repair loop and mid-task pause/takeover','real browser interaction']});
process.exitCode=passed?0:1;
