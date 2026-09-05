import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseLstart, judgeGhost, classifyProbeReply, argvReferencesCheckout } from './ghost-host-check.mjs'

export async function runGhostHostChecks() {
  // `ps -o lstart=` parsing (local time, "Mon Aug 31 16:59:06 2026").
  const started = parseLstart('Mon Aug 31 16:59:06 2026')
  assert.equal(started.getFullYear(), 2026)
  assert.equal(started.getMonth(), 7)
  assert.equal(started.getDate(), 31)
  assert.equal(started.getHours(), 16)
  assert.equal(started.getSeconds(), 6)

  // Localized ps output must surface as Invalid Date (main() exits 2 on it, never 1 — #94 review).
  assert.equal(Number.isNaN(parseLstart('mar. 31 août 16:59:06 2026').getTime()), true, 'non-English lstart must not silently parse')

  // Ghost verdict: started before the checkout's last change ⇒ ghost.
  assert.equal(judgeGhost(new Date('2026-08-26T06:13:49Z'), new Date('2026-08-30T13:37:53Z')), true, 'older process must be a ghost')
  assert.equal(judgeGhost(new Date('2026-08-31T08:59:06Z'), new Date('2026-08-30T13:37:53Z')), false, 'newer process must not be a ghost')

  // Probe classification is by reply, never by version number; unknown stays unknown.
  assert.equal(classifyProbeReply(401, null), 'new-wire')
  assert.equal(classifyProbeReply(200, { result: { ok: true } }), 'old-wire')
  assert.equal(classifyProbeReply(200, { unexpected: 'shape' }), 'unknown')
  assert.equal(classifyProbeReply(500, null), 'unknown')

  // argv ↔ checkout matching follows symlinks and treats unresolvable paths as non-matches.
  const table = {
    '/home/u/.dsh/source/current/apps/cli/src/bin.ts': '/real/checkout/apps/cli/src/bin.ts',
    '/usr/local/bin/node': '/usr/local/bin/node',
  }
  const resolvePath = (p) => {
    if (p in table) return table[p]
    throw new Error('ENOENT')
  }
  assert.equal(argvReferencesCheckout('node /home/u/.dsh/source/current/apps/cli/src/bin.ts web', '/real/checkout', resolvePath), true, 'symlinked argv must resolve into the checkout')
  assert.equal(argvReferencesCheckout('/usr/local/bin/node server.js', '/real/checkout', resolvePath), false)
  assert.equal(argvReferencesCheckout('no absolute paths here', '/real/checkout', resolvePath), false)
}

const isMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()
if (isMain) {
  await runGhostHostChecks()
  console.log('Ghost-host checks OK: lstart parsing, ghost verdict, probe tri-state, argv-checkout resolution')
}
