import assert from 'node:assert/strict'
import test from 'node:test'
import {createWorkspaceState,createTeamDiscovery} from '../lib/client/workspace-state.js'
import {startActivityPolling} from '../lib/client/activity-monitor.js'

test('restored, closed, updated and newly created teams have distinct discovery semantics',()=>{
 const discover=createTeamDiscovery()
 const a={teamId:'a'},b={teamId:'b'}
 assert.equal(discover([a]),undefined)
 assert.equal(discover([{...a,phase:'running'}]),undefined)
 assert.equal(discover([a,b]),'b')
 assert.equal(discover([a,b]),undefined)
 assert.equal(discover([]),undefined)
})
test('historical cards and selected teams remain bound to their owner',()=>{
 const state=createWorkspaceState();let count=0;const off=state.subscribe(()=>count++)
 const old={teamId:'old',captainSessionId:'',teamName:'Old',members:[]}
 state.remember('a',old)
 state.select('b','new')
 state.remember('a',{...old,teamId:'foreign',captainSessionId:'b'})
 assert.equal(state.getSnapshot().history.size,1)
 assert.equal(state.getSnapshot().history.get('a:old').captainSessionId,'a')
 assert.equal(state.getSnapshot().selected.get('a'),'old')
 assert.equal(state.getSnapshot().selected.get('b'),'new')
 state.status('a','ready');state.status('a','ready')
 assert.equal(count,3)
 off();state.status('a','error');assert.equal(count,3)
})
test('offline, invalid data and recovery report health without erasing the last snapshot',async()=>{
 let tick;let response={ok:false};const statuses=[],snapshots=[]
 const poll=startActivityPolling([],{discoverySessionId:'a',fetchState:async()=>response,
 schedule:fn=>{tick=fn;return 1},cancel:()=>{},onStatus:s=>statuses.push(s),publishSnapshots:s=>snapshots.push(s)})
 await poll.firstTick;assert.deepEqual(statuses,['error']);assert.equal(snapshots.length,0)
 response={ok:true,json:async()=>({invalid:true})};tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(statuses.at(-1),'error')
 response={ok:true,json:async()=>({teams:[]})};tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(statuses.at(-1),'ready');assert.equal(snapshots.length,2)
 poll.stop()
})
test('disposal prevents a late failed request from updating a different session',async()=>{
 let reject;const statuses=[]
 const poll=startActivityPolling([],{discoverySessionId:'a',fetchState:()=>new Promise((_,no)=>reject=no),schedule:()=>1,cancel:()=>{},onStatus:s=>statuses.push(s)})
 poll.stop();reject(new Error('offline'));await poll.firstTick;assert.deepEqual(statuses,[])
})

test('workspace DAG keeps real dependency endpoints aligned with enlarged nodes',async()=>{
 const {compactDagLayout}=await import('../lib/client/activity-model.js')
 const tasks=[{id:'implement',depth:0,dependencies:[]},{id:'review',depth:1,dependencies:['implement']}]
 const layout=compactDagLayout(tasks,{nodeWidth:164,nodeHeight:76,columnGap:36,rowGap:16})
 assert.equal(layout.width,364)
 assert.equal(layout.nodes[1].x,200)
 assert.equal(layout.edges[0].path,'M164 38C178 38,186 38,200 38')
})

test('an unchanged snapshot revalidates with its tag and skips the body',async()=>{
 let tick;const calls=[],statuses=[],snapshots=[]
 const respond=(status,etag,teams)=>({
  ok:status===200,status,
  headers:{get:(name)=>name.toLowerCase()==='etag'?etag:null},
  json:async()=>{
   // A 304 must never be parsed; if it is, this throws instead of silently passing.
   if(status===304)throw new Error('a 304 response has no body to parse')
   return {teams}
  },
 })
 let phase=0
 const poll=startActivityPolling([],{discoverySessionId:'a',
  fetchState:async(url,init)=>{
   calls.push({url,validator:init.headers?.['if-none-match']})
   if(url.includes('archived=1'))return respond(200,'"arch"',[])
   phase+=1
   return phase===1?respond(200,'"v1"',[]):respond(304,'"v1"',null)
  },
  schedule:fn=>{tick=fn;return 1},cancel:()=>{},
  onStatus:s=>statuses.push(s),publishSnapshots:s=>snapshots.push(s)})
 await poll.firstTick
 assert.equal(calls[0].validator,undefined,'the first poll has nothing to revalidate')
 assert.deepEqual(statuses,['ready'])
 const published=snapshots.length
 tick();await new Promise(resolve=>setImmediate(resolve))
 const live=calls.filter(call=>!call.url.includes('archived=1'))
 assert.equal(live[1].validator,'"v1"','the second poll revalidates with the stored tag')
 assert.equal(snapshots.length,published,'304 publishes nothing new')
 assert.deepEqual(statuses,['ready','ready'])
 poll.stop()
})
