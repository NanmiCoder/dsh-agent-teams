// The polling scope cache must never answer from stale bytes: a team record is
// written through a temporary file plus a rename, so a rewrite changes the
// inode/size/mtime stamp and the next probe has to read the record again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TeamScopeCache } from '../lib/team-scope-cache.js'

async function tempTeamFile(t) {
  const root = await mkdtemp(join(tmpdir(), 'scope-cache-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'team.json')
  await writeFile(file, JSON.stringify({ id: 'team', captainSessionId: 'session-a' }))
  return { root, file }
}

test('a file that was never parsed has no cached scope', async (t) => {
  const { file } = await tempTeamFile(t)
  assert.equal(await new TeamScopeCache().matches(file, 'session-a'), undefined)
})

test('a missing file has no cached scope', async (t) => {
  const { root } = await tempTeamFile(t)
  assert.equal(await new TeamScopeCache().matches(join(root, 'absent.json'), 'session-a'), undefined)
})

test('a remembered record answers matching and non-matching scopes', async (t) => {
  const { file } = await tempTeamFile(t)
  const cache = new TeamScopeCache()
  await cache.remember(file, 'session-a')
  assert.equal(cache.size, 1)
  assert.equal(await cache.matches(file, 'session-a'), true)
  assert.equal(await cache.matches(file, 'session-b'), false)
})

test('an atomic rewrite invalidates the remembered scope', async (t) => {
  const { file } = await tempTeamFile(t)
  const cache = new TeamScopeCache()
  await cache.remember(file, 'session-a')
  const temporary = `${file}.tmp`
  await writeFile(temporary, JSON.stringify({ id: 'team', captainSessionId: 'session-b' }))
  await rename(temporary, file)
  assert.equal(await cache.matches(file, 'session-a'), undefined)
  await cache.remember(file, 'session-b')
  assert.equal(await cache.matches(file, 'session-b'), true)
})

test('the cache stays bounded instead of growing with every team ever seen', async (t) => {
  const { root } = await tempTeamFile(t)
  const cache = new TeamScopeCache(2)
  for (const name of ['a', 'b', 'c']) {
    const file = join(root, `${name}.json`)
    await writeFile(file, '{}')
    await cache.remember(file, 'session-a')
  }
  assert.equal(cache.size, 1)
})
