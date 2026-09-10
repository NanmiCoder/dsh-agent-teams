import {readFileSync,writeFileSync} from 'node:fs';
export const name='migration-evidence';export const inject=['sessionPersistence'];
export function apply(ctx){void(async()=>{await ctx.get('loader').await(); const rows=[];
for(const id of JSON.parse(readFileSync(process.env.MIGRATION_IDS,'utf8'))){
const r=await ctx.sessionPersistence.open(id,'read');const data=await r.read();rows.push({id,version:r.header.version,parent:r.header.parentSession,events:data.events.length,subagentDescriptors:data.events.filter(e=>e.type==='subagent/descriptor').length});if(r.header.version!==3)throw Error('Expected v3');await r.close();
const w=await ctx.sessionPersistence.open(id,'write');await w.flush();await w.close();
const reopened=await ctx.sessionPersistence.open(id,'read');if((await reopened.read()).events.length!==data.events.length)throw Error('Event count changed');await reopened.close();}
writeFileSync(process.env.MIGRATION_RESULT,JSON.stringify({passed:true,rows},null,2));ctx.get('appExit')(0);
})().catch(error=>{console.error(error);ctx.get('appExit')(1)});}
