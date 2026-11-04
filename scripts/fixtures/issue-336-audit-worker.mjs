// Only scheduling/failure delivery is controlled; successful evidence is read
// by the same real auditor as the shipped worker.
import { parentPort } from 'node:worker_threads'
import { appendFileSync, existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { auditTeamWorkspace } from '../../lib/workspace-audit.js'
const url = new URL(import.meta.url)
const mode = url.searchParams.get('mode')
parentPort.on('message', async job => {
  if (mode === 'crash') throw new Error('controlled worker crash')
  if (mode === 'exit') process.exit(1)
  if (mode === 'invalid') { parentPort.postMessage({ id: job.id, audit: {} }); return }
  if (mode === 'hang') return
  const audit = auditTeamWorkspace(job.workspace, job.team)
  appendFileSync(url.searchParams.get('started'), JSON.stringify({ id: job.id }) + '\n')
  while (!existsSync(url.searchParams.get('release'))) await delay(2)
  parentPort.postMessage({ id: job.id, audit })
})
