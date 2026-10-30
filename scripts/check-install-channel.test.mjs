import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import test from 'node:test'
import { checkInstallChannel } from './check-install-channel.mjs'

// Use the exact desktop pnpm supplied by CI; never silently skip this regression.
const pnpmCli = process.env.DESKTOP_PNPM_CLI
assert.ok(pnpmCli, 'DESKTOP_PNPM_CLI must point at pnpm 11.28.5/bin/pnpm.mjs')

test('desktop pnpm latest is not ready until the release ages; no policy exemption is added', async () => {
  let matured = false, unavailable = false
  const name = '@nanmicoder/dsh-agent-teams'
  const server = createServer((request, response) => {
    if (unavailable) { response.writeHead(503).end('unavailable'); return }
    if (decodeURIComponent(request.url).split('?')[0] !== `/${name}`) { response.writeHead(404).end(); return }
    const registry = `http://127.0.0.1:${server.address().port}`
    const integrity = 'sha512-' + createHash('sha512').update('resolution-only').digest('base64')
    const old = new Date(Date.now() - 3 * 86400000).toISOString()
    const recent = new Date(Date.now() - (matured ? 2 * 86400000 : 60000)).toISOString()
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ name, 'dist-tags': { latest: '1.0.1' }, time: { created: old, modified: recent, '1.0.0': old, '1.0.1': recent }, versions: Object.fromEntries(['1.0.0', '1.0.1'].map(version => [version, { name, version, dist: { tarball: `${registry}/package-${version}.tgz`, integrity } }])) }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const input = { pnpmCli, registry: `http://127.0.0.1:${server.address().port}`, expectedVersion: '1.0.1' }
  try {
    const fresh = await checkInstallChannel(input)
    assert.equal(fresh.pnpmVersion, '11.28.5')
    assert.equal(fresh.resolvedVersion, '1.0.0')
    assert.equal(fresh.ready, false)
    matured = true
    const aged = await checkInstallChannel(input)
    assert.equal(aged.resolvedVersion, '1.0.1')
    assert.equal(aged.ready, true)
    unavailable = true
    await assert.rejects(checkInstallChannel(input), /resolution failed/i)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
