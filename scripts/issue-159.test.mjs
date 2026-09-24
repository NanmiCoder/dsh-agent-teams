import test from 'node:test'
import assert from 'node:assert/strict'
import { beginTaskAttempt, invalidateTaskAttempt } from '../lib/state.js'
import { appendTaskEvidence, hasValidQualityTaskFields, evaluateQualityCompletion, validateCreateTask } from '../lib/quality-gates.js'
import { isCurrentMail } from '../lib/mailbox.js'

const task = () => ({ id:'t1', subject:'repair', assignee:'worker', status:'failed', attempt:1, attemptId:'old', dependencies:[], createdAt:1, updatedAt:2, kind:'repair', sourceTaskId:'source', sourceFindingIds:['F1'], objective:'Fix parser', inScope:['src/'], acceptance:['works'], verify:['test'], output:'old result', verdict:'pass', findings:[], changedPaths:['src/a'], acceptanceResults:[{criterion:'works',status:'passed'}], commandsRun:[{command:'test',status:'passed'}] })
test('retry cannot complete using evidence or verdict from the previous attempt', () => {
 const t=task();invalidateTaskAttempt(t,'worker',true);beginTaskAttempt(t,'worker');t.status='in_progress';
 assert.equal(t.verdict,undefined)
 assert.equal(t.commandsRun,undefined)
 assert.equal(evaluateQualityCompletion(t,{status:'completed'}).ok,false)
})
test('source attempt revocation invalidates queued reports, including captain reports', () => {
 const t=task();const team={tasks:[t]};const mail={id:'m',from:'worker',to:'captain',content:'old result',ts:1,sourceTaskId:'t1',sourceAttemptId:'old'};
 assert.equal(isCurrentMail(team,mail),true)
 invalidateTaskAttempt(t,'worker',true)
 assert.equal(isCurrentMail(team,mail),false)
})
test('captain cannot create a duplicate repair for the same unresolved findings', () => {
 const existing=task();existing.status='pending';
 const team={tasks:[{id:'source',status:'completed'},existing]};
 const result=validateCreateTask(team,{...existing,subject:'duplicate',dependencies:['t1']});
 assert.equal(result.ok,false);assert.match(result.error,/t1/)
})

test('a queued progress message is superseded by a terminal result, but the actual terminal report survives', () => {
 const t=task();t.status='in_progress';const team={tasks:[t]};
 const mail={from:'worker',to:'captain',sourceTaskId:'t1',sourceAttemptId:'old',sourceTaskStatus:'in_progress'};
 assert.equal(isCurrentMail(team,mail),true);t.status='cancelled';assert.equal(isCurrentMail(team,mail),false)
 assert.equal(isCurrentMail(team,{...mail,sourceTaskStatus:'cancelled'}),true)
})

test('supplements retain author, attempt and old result without reopening a failed gate', () => {
 const t=task(), before=structuredClone(t);
 const input={commandsRun:[{command:'late-check',status:'failed',exitCode:1,evidence:'new observation'}],acceptanceResults:[{criterion:'edge case',status:'failed'}],evidence_note:' Follow-up '};
 assert.equal(appendTaskEvidence(t,input,'worker'),true)
 assert.equal(t.supplementalEvidence[0].by,'worker');assert.equal(t.supplementalEvidence[0].attemptId,'old')
 assert.equal(t.supplementalEvidence[0].note,'Follow-up')
 assert.deepEqual({...t,supplementalEvidence:undefined},{...before,supplementalEvidence:undefined})
 assert.equal(appendTaskEvidence(t,input,'worker'),false)
 assert.equal(appendTaskEvidence(t,{commandsRun:[{evidence:'new observation',exitCode:1,status:'failed',command:'late-check'}]},'worker'),false)
 assert.equal(t.supplementalEvidence.length,1)
 assert.equal(appendTaskEvidence(t,{evidence_note:'Captain independently verified'},'captain'),true)
 assert.equal(hasValidQualityTaskFields(JSON.parse(JSON.stringify(t))),true)
 const n=t.supplementalEvidence.length;assert.throws(()=>appendTaskEvidence(t,{commandsRun:[{command:'bad',status:'maybe'}]},'worker'),/invalid/)
 assert.equal(t.supplementalEvidence.length,n)
})
test('terminal immutable fields cannot be silently changed even with unchanged status/output', () => {
 for (const change of [{status:'completed'},{output:'overwrite'},{verdict:'reject'},{findings:[{id:'new'}]},{changedPaths:['elsewhere']}]) {
  const t=task(),before=structuredClone(t);assert.throws(()=>appendTaskEvidence(t,change,'captain'),/immutable/);assert.deepEqual(t,before)
 }
})
test('retry preserves attributed historical supplements but does not reuse them as gate evidence', () => {
 const t=task();appendTaskEvidence(t,{evidence_note:'failed attempt inspection'},'worker');const entry=structuredClone(t.supplementalEvidence[0]);
 beginTaskAttempt(t,'worker');assert.deepEqual(t.supplementalEvidence,[entry]);assert.notEqual(t.attemptId,entry.attemptId)
 t.status='in_progress';assert.equal(evaluateQualityCompletion(t,{status:'completed'}).ok,false)
})
test('malformed persisted supplements are rejected', () => {
 for(const item of [null,{}, {at:1,by:'worker',attempt:1}, {at:1,by:'worker',attempt:-1,note:'x'},{at:1,by:'',attempt:1,note:'x'},{at:1,by:'worker',attempt:1,commandsRun:[{}]}]) {
  assert.equal(hasValidQualityTaskFields({...task(),supplementalEvidence:[item]}),false)
 }
})

test('durable mailbox fallback discards revoked source reports for captain and peers', async t => {
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {createTeamDir,appendMailbox,readMailbox}=await import('../lib/state.js');const {readCurrentMailbox}=await import('../lib/mailbox.js');
 const root=await mkdtemp(join(tmpdir(),'issue159-mail-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const team={id:'team',name:'team',captainSessionId:'captain',createdAt:1,taskSeq:1,members:[{name:'worker',id:'worker',status:'idle',joinedAt:1},{name:'peer',id:'peer',status:'idle',joinedAt:1}],tasks:[{...task(),attemptId:'new'}]};
 await createTeamDir(root,team);
 for(const to of ['captain','peer']) {
  const old={id:'old-'+to,from:'worker',to,content:'obsolete',ts:1,sourceTaskId:'t1',sourceAttemptId:'old'};
  const current={...old,id:'new-'+to,content:'current',sourceAttemptId:'new'};
  await appendMailbox(root,'team',to,old);await appendMailbox(root,'team',to,current);
  assert.deepEqual((await readCurrentMailbox(root,'team',to)).map(m=>m.id),[current.id]);
  assert.ok((await readMailbox(root,'team',to)).find(m=>m.id===old.id).discardedAt)
 }
})
