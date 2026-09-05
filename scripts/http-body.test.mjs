import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { readJsonRequest, RequestBodyError } from '../lib/web-routes.js'

test('HTTP body reader returns 413 without losing the response or buffering the rest', async (t) => {
  const server = createServer(async (req, res) => {
    try {
      const body = await readJsonRequest(req, 64)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    } catch (error) {
      res.writeHead(error instanceof RequestBodyError ? error.status : 500)
      res.end(error.message)
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => {
    server.closeAllConnections()
    server.close(resolve)
  }))
  const url = `http://127.0.0.1:${server.address().port}`
  // A client may keep a chunked upload open after crossing the limit. The
  // rejection must be sent immediately, without waiting for its final chunk.
  const openUpload = await new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST' }, response => {
      response.resume()
      response.on('end', () => {
        req.destroy()
        resolve(response.statusCode)
      })
    })
    req.setTimeout(2_000, () => req.destroy(new Error('oversized upload did not receive a response')))
    req.on('error', reject)
    req.write('x'.repeat(65))
  })
  assert.equal(openUpload, 413)
  const empty = await fetch(url, { method: 'POST' })
  assert.equal(empty.status, 200)
  assert.deepEqual(await empty.json(), {}, 'empty bodies retain the previous object default')
  const exact = JSON.stringify({ value: 'a'.repeat(52) })
  assert.equal(Buffer.byteLength(exact), 64)
  const valid = await fetch(url, { method: 'POST', body: exact })
  assert.equal(valid.status, 200)
  assert.deepEqual(await valid.json(), JSON.parse(exact))
  for (const body of [exact + ' ', JSON.stringify({ value: '汉'.repeat(22) }), 'x'.repeat(100_000)]) {
    const response = await fetch(url, { method: 'POST', body })
    assert.equal(response.status, 413)
    assert.match(await response.text(), /too large/)
  }
  for (const body of ['null', '[]', '"scalar"', '{']) {
    const response = await fetch(url, { method: 'POST', body })
    assert.equal(response.status, 400)
    await response.text()
  }
  const afterRejection = await fetch(url, { method: 'POST', body: '{"ok":true}' })
  assert.equal(afterRejection.status, 200)
  assert.deepEqual(await afterRejection.json(), { ok: true })
})

test('aborted body rejects and removes its buffering listeners', async () => {
  const stream = new PassThrough()
  const pending = readJsonRequest(stream)
  stream.write('{"incomplete":')
  stream.emit('aborted')
  await assert.rejects(pending, /aborted/)
  assert.equal(stream.listenerCount('data'), 0)
  stream.destroy()
})
