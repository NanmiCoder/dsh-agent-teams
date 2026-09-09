import test from 'node:test';
import assert from 'node:assert/strict';
import { reportWrite, modelMetrics } from './harness-model-case.mjs';
const path='reports/summary.json';
const event=(name,args,isError=false)=>({event:'tool-result',name,arguments:args,isError});

test('planned, read and validation references are not summary writes',()=>{
    for(const entry of [
        event('todo_write',{todos:[{content:'新增 '+path,status:'pending'}]}),
        event('read',{file_path:path}),
        event('bash',{command:`node -e "JSON.parse(require('fs').readFileSync('${path}','utf8'))" && ls reports`}),
        event('bash',{command:`cat ${path} > reports/copy.json`}),
        event('write',{file_path:'reports/other.json',content:path}),
        event('write',{file_path:path,content:'{}'},true),
    ]) assert.equal(reportWrite(entry,path),false,entry.name+' '+JSON.stringify(entry.arguments));
});
test('successful native writes and exact shell mutation targets count',()=>{
    for(const entry of [
        event('write',{file_path:path,content:'{}'}),
        event('edit',{file_path:'/tmp/isolated/'+path,old_string:'a',new_string:'b'}),
        event('bash',{command:`cat <<'EOF' > ${path}\n{}\nEOF`}),
        event('bash',{command:`node -e "require('fs').writeFileSync('${path}','{}')"`}),
    ]) assert.equal(reportWrite(entry,path),true,entry.name+' '+JSON.stringify(entry.arguments));
});
test('metrics keep missing usage explicit and exclude purpose requests from headers',()=>{
    const metrics=modelMetrics([
        {event:'model-request',request:1,sessionId:'captain',systemSha256:'same',toolsSha256:'same'},
        {event:'model-request',request:2,sessionId:'captain',systemSha256:'same',toolsSha256:'same'},
        {event:'model-request',request:3,sessionId:'captain',purpose:'title',systemSha256:'different',toolsSha256:'different'},
        {event:'model-usage',request:1,usage:{inputTokens:10,cacheReadTokens:100}},
        {event:'model-usage',request:1,usage:{inputTokens:12,cacheReadTokens:100}},
    ],'captain');
    assert.equal(metrics.stableSessionHeaders,true);
    assert.deepEqual(metrics.requestsWithoutUsage,[2]);
    assert.equal(metrics.usage.uncachedInputTokens,12);
    assert.equal(metrics.usage.cacheWriteTokens,null);
});
