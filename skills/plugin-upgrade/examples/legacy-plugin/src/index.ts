// legacy-plugin: static fixture only. Do not execute or publish.
// It deliberately contains legacy coupling and incorrect wrapper assumptions.

import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
// Touchpoint #5: private Host/Web Client path removed by UI decomposition.
import { SessionView } from '@deepseek-ai/dsh-session-view/internal'

export function activate(ctx: any) {
  // #2 Producer of an external informational durable event.
  // alpha.1 removed the ignorable marker; alpha.2 restored its producer/persistence contract.
  ctx.emit('session/event', {
    type: 'legacy/informational-note',
    ignorable: true,
    payload: { text: 'fixture' },
  })
  ctx.on('session/event', (event: any /* SessionEvent */) => {
    console.log('[legacy] session event:', event.type)
  })

  // #3 Legacy Host APIProxy calls.
  ctx.register('rename-session', async ({ id, title }: any) => {
    const apiProxy = await ctx.get('apiProxy')
    await apiProxy.invoke('session.rename', { id, title })
  })
  ctx.register('list-providers', async () => {
    const apiProxy = await ctx.get('apiProxy')
    return apiProxy.invoke('llm.providers')
  })

  // #4 Hard-coded Host/profile path.
  ctx.register('write-note', async ({ text }: any) => {
    const profileDir = join(homedir(), '.dsh', 'profiles', 'default')
    writeFileSync(join(profileDir, 'legacy-note.txt'), text)
  })

  // #5 Private UI/command registration.
  ctx.contributes.registerCommand('legacy.openView', () => {
    return new SessionView({ enhanced: true })
  })

  // #6 Private loopback HTTP bridge that bypasses the Host Gateway authentication model.
  // The function is never invoked; the fixture must remain static-only.
  function startLegacyBridge() {
    const server = createServer((_request, response) => {
      response.end('legacy')
    })
    server.listen(43121, '127.0.0.1') // http://localhost:43121/api/legacy
    return server
  }
  void startLegacyBridge

  // #7 Deliberately wrong wrapper assumption: treats headless stdout as JSONL.
  ctx.register('headless-ask', ({ prompt }: any) =>
    new Promise((resolve) => {
      const child = spawn('dsh', ['--profile', 'headless', prompt])
      let result = ''
      child.stdout.on('data', (line: Buffer) => {
        const event = JSON.parse(line.toString())
        if (event.type === 'final') result = event.text
      })
      child.on('close', () => resolve(result))
    })
  )
}
