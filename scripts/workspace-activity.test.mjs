import assert from 'node:assert/strict'
import test from 'node:test'
import {createWorkspaceState,createTeamDiscovery} from '../lib/client/workspace-state.js'
import {getActivitySnapshotsSnapshot, getPublishedActivityRows, startActivityPolling, updateActivitySnapshots} from '../lib/client/activity-monitor.js'

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

function scriptedPoller(targets, discoverySessionId, responses, runtime = {}) {
  let tick
  const requests = [], snapshots = [], statuses = [], settled = []
  const poll = startActivityPolling(targets, {
    discoverySessionId,
    async fetchState(url, init) {
      const request = { url, tag: init.headers?.['if-none-match'] }
      requests.push(request)
      const response = responses.shift()
      return typeof response === 'function' ? response(request) : response
    },
    schedule(callback) { tick = callback; return 1 },
    cancel() {},
    publishSnapshots(update) { snapshots.push(update) },
    onStatus(status) { statuses.push(status) },
    settleTargets(keys) { settled.push([...keys]) },
    ...runtime,
  })
  return {
    poll, requests, snapshots, statuses, settled,
    async advance() { tick(); await new Promise(resolve => setImmediate(resolve)) },
  }
}

function stateResponse(teams, tag) {
  return Response.json({ teams }, { headers: tag === undefined ? {} : { etag: tag } })
}

test('a poll is scoped only when every discovery and card target has one owner', async () => {
  const sessionId = 'captain+A/&'
  const team = { teamId: 'team', captainSessionId: sessionId }
  const target = { teamId: team.teamId, sessionId, key: 'card' }
  const scoped = scriptedPoller([target], sessionId, [stateResponse([team]), stateResponse([])])
  const mixed = scriptedPoller([target], 'another-captain', [stateResponse([team]), stateResponse([])])
  try {
    await Promise.all([scoped.poll.firstTick, mixed.poll.firstTick])
    const [live, archived] = scoped.requests.map(({ url }) => new URL(url, 'http://fixture').searchParams)
    assert.equal(live.get('session'), sessionId)
    assert.equal(live.get('summary'), '1')
    assert.equal(archived.get('session'), sessionId)
    assert.equal(archived.get('archived'), '1')
    assert.equal(archived.has('summary'), false)
    assert.deepEqual(mixed.requests.map(({ url }) => url), [
      '/plugins/dsh-agent-teams/state', '/plugins/dsh-agent-teams/state?archived=1',
    ])
  } finally {
    scoped.poll.stop()
    mixed.poll.stop()
  }
})

test('a truncated or invalid body never becomes the held validator', async () => {
  const tag = 'W/"live"'
  const lab = scriptedPoller([], 'captain', [
    new Response('{"teams":', { headers: { etag: tag } }),
    stateResponse([null], tag),
    stateResponse([], tag), stateResponse([], 'W/"archive"'),
    new Response(null, { status: 304 }),
  ])
  try {
    await lab.poll.firstTick
    await lab.advance()
    await lab.advance()
    await lab.advance()
    assert.deepEqual(lab.requests.map(({ tag }) => tag), [undefined, undefined, undefined, undefined, tag])
    assert.deepEqual(lab.snapshots, [{ teams: [] }, { archivedTeams: [] }])
    assert.deepEqual(lab.statuses, ['error', 'error', 'ready', 'ready'])
  } finally { lab.poll.stop() }
})

test('304 still retries initial archive discovery and settles the missing card', async () => {
  const history = { teamId: 'finished', captainSessionId: 'captain' }
  const target = { teamId: history.teamId, sessionId: history.captainSessionId, key: 'card' }
  const lab = scriptedPoller([target], 'captain', [
    stateResponse([], 'W/"live"'), new Response(null, { status: 503 }),
    new Response(null, { status: 304 }), stateResponse([history], 'W/"archive"'),
    new Response(null, { status: 304 }),
  ])
  try {
    await lab.poll.firstTick
    await lab.advance()
    await lab.advance()
    assert.deepEqual(lab.requests.map(({ tag }) => tag), [undefined, undefined, 'W/"live"', undefined, 'W/"live"'])
    assert.deepEqual(lab.snapshots, [{ teams: [] }, { archivedTeams: [history] }])
    assert.deepEqual(lab.settled, [['card']])
  } finally { lab.poll.stop() }
})

test('304 retries an archive refresh after a previously live team disappears', async () => {
  const team = { teamId: 'running', captainSessionId: 'captain' }
  const lab = scriptedPoller([], 'captain', [
    stateResponse([team], 'W/"running"'), stateResponse([], 'W/"empty-archive"'),
    stateResponse([], 'W/"finished"'), new Response(null, { status: 503 }),
    new Response(null, { status: 304 }), stateResponse([team], 'W/"archived"'),
    new Response(null, { status: 304 }),
  ])
  try {
    await lab.poll.firstTick
    await lab.advance()
    await lab.advance()
    await lab.advance()
    assert.deepEqual(lab.requests.map(({ tag }) => tag), [
      undefined, undefined, 'W/"running"', 'W/"empty-archive"', 'W/"finished"', 'W/"empty-archive"', 'W/"finished"',
    ])
    assert.deepEqual(lab.snapshots, [{ teams: [team] }, { archivedTeams: [] }, { teams: [] }, { archivedTeams: [team] }])
  } finally { lab.poll.stop() }
})

for (const pauseAt of ['live', 'archive']) {
  test(`a delayed Retry ${pauseAt} response cannot pin an outdated shared snapshot`, async () => {
    const initial = getActivitySnapshotsSnapshot()
    const moved = { teamId: 'moving', captainSessionId: 'captain' }
    const oldLive = [moved]
    const newLive = [{ teamId: 'new', captainSessionId: 'captain' }]
    const liveTag = 'W/"new-live"', archiveTag = 'W/"new-archive"'
    const revalidate = (teams, tag) => request => request.tag === tag
      ? new Response(null, { status: 304 }) : stateResponse(teams, tag)
    const resident = scriptedPoller([], 'captain', [
      stateResponse(oldLive, 'W/"old-live"'), stateResponse([], 'W/"old-archive"'),
      stateResponse(newLive, liveTag), stateResponse([moved], archiveTag),
      revalidate(newLive, liveTag), revalidate([moved], archiveTag), revalidate(newLive, liveTag),
    ], pauseAt === 'live' ? { publishSnapshots: undefined } : {
      publishSnapshots: (update, scope) => updateActivitySnapshots(update, scope),
      getPublishedRows: getPublishedActivityRows,
    })
    let retry
    try {
      await resident.poll.firstTick
      const delayed = Promise.withResolvers()
      const requestedArchive = Promise.withResolvers()
      retry = scriptedPoller([], 'captain', [
        pauseAt === 'live' ? delayed.promise : stateResponse(oldLive, 'W/"old-live"'),
        () => {
          requestedArchive.resolve()
          return pauseAt === 'archive' ? delayed.promise : stateResponse([], 'W/"old-archive"')
        },
      ], { publishSnapshots: undefined })
      if (pauseAt === 'archive') await requestedArchive.promise
      await resident.advance()
      assert.deepEqual(getActivitySnapshotsSnapshot(), { teams: newLive, archivedTeams: [moved] })
      delayed.resolve(pauseAt === 'live'
        ? stateResponse(oldLive, 'W/"old-live"') : stateResponse([], 'W/"old-archive"'))
      await retry.poll.firstTick
      retry.poll.stop()
      assert.deepEqual(getActivitySnapshotsSnapshot(), { teams: pauseAt === 'live' ? oldLive : newLive, archivedTeams: [] })

      await resident.advance()
      const recovered = getActivitySnapshotsSnapshot()
      assert.deepEqual(recovered, { teams: newLive, archivedTeams: [moved] })
      await resident.advance()
      assert.equal(getActivitySnapshotsSnapshot(), recovered, 'an unchanged tick publishes nothing')
      assert.deepEqual(resident.requests.slice(4).map(({ tag }) => tag), [
        pauseAt === 'live' ? undefined : liveTag, undefined, liveTag,
      ])
    } finally {
      retry?.poll.stop()
      resident.poll.stop()
      updateActivitySnapshots(initial)
    }
  })
}

test('a stopped controller cannot publish its delayed archive response', async () => {
  const initial = getActivitySnapshotsSnapshot()
  const delayed = Promise.withResolvers()
  const requested = Promise.withResolvers()
  const lab = scriptedPoller([], 'captain', [
    stateResponse([], 'W/"live"'),
    () => { requested.resolve(); return delayed.promise },
  ], { publishSnapshots: undefined })
  try {
    await requested.promise
    lab.poll.stop()
    const shown = getActivitySnapshotsSnapshot()
    delayed.resolve(stateResponse([{ teamId: 'history', captainSessionId: 'captain' }], 'W/"archive"'))
    await lab.poll.firstTick
    assert.equal(getActivitySnapshotsSnapshot(), shown)
  } finally {
    lab.poll.stop()
    updateActivitySnapshots(initial)
  }
})

test('switching back during a restart keeps the last successful live and archived rows', async () => {
  const initial = getActivitySnapshotsSnapshot()
  const a = { captainSessionId: 'captain-a', teamId: 'live-a' }
  const b = { captainSessionId: 'captain-b', teamId: 'live-b' }
  const archivedA = { ...a, teamId: 'history-a' }
  const archivedB = { ...b, teamId: 'history-b' }
  const controllers = []
  async function visit(owner, responses) {
    const lab = scriptedPoller([], owner, responses, { publishSnapshots: undefined })
    controllers.push(lab.poll)
    await lab.poll.firstTick
    return lab
  }
  try {
    updateActivitySnapshots({ teams: [], archivedTeams: [] })
    const firstA = await visit(a.captainSessionId, [stateResponse([a]), stateResponse([archivedA])])
    firstA.poll.stop()
    const firstB = await visit(b.captainSessionId, [stateResponse([b]), stateResponse([archivedB])])
    firstB.poll.stop()
    const returned = await visit(a.captainSessionId, [
      () => { throw new Error('host restarting') }, stateResponse([]), stateResponse([]),
    ])
    assert.deepEqual(returned.statuses, ['error'])
    assert.deepEqual(getActivitySnapshotsSnapshot(), { teams: [a, b], archivedTeams: [archivedA, archivedB] })
    await returned.advance()
    assert.deepEqual(getActivitySnapshotsSnapshot(), { teams: [b], archivedTeams: [archivedB] })
  } finally {
    for (const controller of controllers) controller.stop()
    updateActivitySnapshots(initial)
  }
})

test('an older full-table response updates only the requested scope and preserves another validator', async () => {
  const initial = getActivitySnapshotsSnapshot()
  updateActivitySnapshots({ teams: [], archivedTeams: [] })
  const a = { captainSessionId: 'captain-a', teamId: 'live-a' }
  const b = { captainSessionId: 'captain-b', teamId: 'live-b' }
  const archivedA = { ...a, teamId: 'history-a' }
  const archivedB = { ...b, teamId: 'history-b' }
  const tag = 'W/"scope-a"'
  const activeA = scriptedPoller([], a.captainSessionId, [
    stateResponse([a], tag), stateResponse([archivedA], 'W/"archive-a"'), new Response(null, { status: 304 }),
  ], { publishSnapshots: undefined })
  let activeB
  try {
    await activeA.poll.firstTick
    activeB = scriptedPoller([], b.captainSessionId, [
      stateResponse([{ ...a, name: 'stale' }, b]), stateResponse([{ ...archivedA, name: 'stale' }, archivedB]),
    ], { publishSnapshots: undefined })
    await activeB.poll.firstTick
    const shown = getActivitySnapshotsSnapshot()
    assert.deepEqual(shown, { teams: [a, b], archivedTeams: [archivedA, archivedB] })
    await activeA.advance()
    assert.deepEqual(activeA.requests.map(({ tag }) => tag), [undefined, undefined, tag])
    assert.equal(getActivitySnapshotsSnapshot(), shown, 'another session must not invalidate a held snapshot')
  } finally {
    activeA.poll.stop()
    activeB?.poll.stop()
    updateActivitySnapshots(initial)
  }
})

test('an unscoped poll still replaces the full result and invalidates superseded scoped tags', async () => {
  const initial = getActivitySnapshotsSnapshot()
  updateActivitySnapshots({ teams: [], archivedTeams: [] })
  const a = { captainSessionId: 'captain-a', teamId: 'live-a' }
  const c = { captainSessionId: 'captain-c', teamId: 'live-c' }
  const archivedA = { ...a, teamId: 'history-a' }
  const archivedC = { ...c, teamId: 'history-c' }
  const tag = 'W/"scope-a"'
  const activeA = scriptedPoller([], a.captainSessionId, [
    stateResponse([a], tag), stateResponse([archivedA], 'W/"archive-a"'),
    stateResponse([a], tag), stateResponse([archivedA], 'W/"archive-a"'),
  ], { publishSnapshots: undefined })
  let unscoped
  try {
    await activeA.poll.firstTick
    unscoped = scriptedPoller([
      { key: 'a', sessionId: 'captain-a', teamId: 'missing' },
      { key: 'b', sessionId: 'captain-b', teamId: 'missing' },
    ], undefined, [stateResponse([c]), stateResponse([archivedC])], { publishSnapshots: undefined })
    await unscoped.poll.firstTick
    assert.deepEqual(getActivitySnapshotsSnapshot(), { teams: [c], archivedTeams: [archivedC] })
    await activeA.advance()
    assert.deepEqual(activeA.requests.map(({ tag }) => tag), [undefined, undefined, undefined, undefined])
    assert.deepEqual(getActivitySnapshotsSnapshot(), { teams: [c, a], archivedTeams: [archivedC, archivedA] })
  } finally {
    activeA.poll.stop()
    unscoped?.poll.stop()
    updateActivitySnapshots(initial)
  }
})

test('scoped live and archived rows retain only the eight most recently published sessions', () => {
  const initial = getActivitySnapshotsSnapshot()
  function publish(index) {
    const owner = `captain-${index}`
    const row = { captainSessionId: owner, teamId: `team-${index}` }
    updateActivitySnapshots({ teams: [row], archivedTeams: [{ ...row, teamId: `history-${index}` }] }, owner)
  }
  try {
    updateActivitySnapshots({ teams: [], archivedTeams: [] })
    for (let index = 0; index < 8; index++) publish(index)
    publish(0)
    publish(8)
    const shown = getActivitySnapshotsSnapshot()
    for (const rows of [shown.teams, shown.archivedTeams]) {
      assert.deepEqual(rows.map(({ captainSessionId }) => captainSessionId), [2, 3, 4, 5, 6, 7, 0, 8].map(index => `captain-${index}`))
    }
  } finally { updateActivitySnapshots(initial) }
})
