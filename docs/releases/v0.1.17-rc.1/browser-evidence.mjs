
import {appendFileSync} from 'node:fs';
export const name='agentteams-browser-evidence';
export const inject=['workspaceRegistry','llm','tools'];
export function apply(ctx) {
 const record=data=>appendFileSync(process.env.BROWSER_EVIDENCE,JSON.stringify({...data,time:Date.now()})+'\n');
 let request=0;
 ctx.on('llm/stream',async function* (options,next) {
  const id=++request;record({event:'model-request',id,sessionId:options.sessionId,provider:options.provider,model:options.model,reasoningEffort:options.reasoningEffort,purpose:options.purpose,tools:options.tools?.map(t=>t.name)});
  try {for await (const chunk of next()) {if(chunk.type==='usage')record({event:'model-usage',id,usage:chunk.usage});yield chunk;} record({event:'model-completed',id});}
  catch(error){record({event:'model-error',id,code:error.code,cause:error.cause?.message});throw error;}
 });
 ctx.on('tools/result',(exec,result)=>record({event:'tool-result',sessionId:exec.agent?.id,name:exec.name,isError:result.isError}));
 void ctx.workspaceRegistry.create(process.cwd(),'AgentTeams 0.1.5 实测').then(workspace=>record({event:'workspace-ready',id:workspace.id,path:process.cwd()}));
}
