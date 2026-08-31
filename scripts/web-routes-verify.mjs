#!/usr/bin/env node
/** Exercise raw plugin routes through alpha.2's real browser-auth service. */
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { apply as installConnection } from '@deepseek-ai/dsh-client-connection'
import { authenticatedWebRoutes } from '../lib/web-routes.js'

const ctx = new Context()
const routes = new Map()
const server = createServer((req, res) => {
  if (req.url.startsWith('/?token=')) {
    ctx.connection.authorizeIndex(req, res)
    return
  }
  const route = routes.get(req.url)
  if (!route) { res.writeHead(404); res.end(); return }
  Promise.resolve(route.handler(req, res)).catch(() => {
    res.writeHead(500); res.end()
  })
})
const webServer = {
  register(route) {
    assert(!routes.has(route.path), `duplicate route: ${route.path}`)
    routes.set(route.path, route)
    return () => routes.delete(route.path)
  },
}
// Only persistence is replaced: actual token exchange, signed cookies,
// Host/Origin validation, and HTTP requests all use the target implementation.
let credentialRecord
ctx.provide('credentials', {
  async modifyRecord(_key, update) {
    credentialRecord = await update(credentialRecord) ?? credentialRecord
    return credentialRecord
  },
})
ctx.provide('webServer', webServer)
let gate
let calls = 0
const paths = ['/plugins/dsh-agent-teams/state', '/plugins/dsh-agent-teams/plan']
const routePlugin = {
  name: 'agent-teams-auth-test',
  apply(owner) {
    const protectedRoutes = authenticatedWebRoutes(webServer, () => gate)
    for (const path of paths) {
      owner.effect(() => protectedRoutes.register({
        kind: 'exact', path,
        async handler(_req, res) {
          calls += 1
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        },
      }))
    }
  },
}

try {
  await installConnection(ctx, {})
  gate = ctx.connection
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const fiber = ctx.plugin(routePlugin)
  await fiber.inertia
  for (const path of paths) {
    const response = await fetch(base + path, { method: path.endsWith('/plan') ? 'POST' : 'GET' })
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { error: 'unauthorized' })
  }
  assert.equal(calls, 0, 'unauthenticated requests must not read or mutate team state')

  const exchange = await fetch(gate.authenticatedUrl(base), { redirect: 'manual' })
  assert.equal(exchange.status, 303)
  const cookie = exchange.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert(cookie, 'real Connection must issue a browser cookie')
  for (const path of paths) {
    const response = await fetch(base + path, {
      method: path.endsWith('/plan') ? 'POST' : 'GET', headers: { cookie, origin: base },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  }
  assert.equal(calls, 2)
  for (const headers of [
    { cookie, origin: 'https://untrusted.invalid' },
    { cookie, 'sec-fetch-site': 'cross-site' },
    { cookie, host: 'untrusted.invalid' },
  ]) {
    // node:http preserves an explicitly hostile Host; Fetch may replace it.
    const status = await new Promise((resolve, reject) => {
      const req = request(base + paths[1], { method: 'POST', headers }, response => {
        response.resume()
        response.on('end', () => resolve(response.statusCode))
      })
      req.on('error', reject)
      req.end()
    })
    assert.equal(status, 403, `reject ${Object.keys(headers).filter(key => key !== 'cookie').join(', ')}`)
  }
  assert.equal(calls, 2, 'rejected origins must not enter the mutation handler')

  gate = undefined
  const unavailable = await fetch(base + paths[0], { headers: { cookie } })
  assert.equal(unavailable.status, 503)
  await unavailable.arrayBuffer()
  assert.equal(calls, 2, 'missing Connection must fail closed')

  await fiber.dispose()
  assert(paths.every(path => !routes.has(path)), 'unload removes every owned route')
  gate = ctx.connection
  const reloaded = ctx.plugin(routePlugin)
  await reloaded.inertia
  assert(paths.every(path => routes.has(path)), 'reload restores exactly one registration')
  await reloaded.dispose()
  console.log('PASS Web routes: real alpha.2 authentication, trusted origins, fail-closed startup, disposal and reload')
} finally {
  await ctx.fiber.dispose()
  server.closeAllConnections()
  if (server.listening) await new Promise(resolve => server.close(resolve))
}
