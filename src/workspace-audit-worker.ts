/** Built worker entry: no Harness service instances cross the thread boundary. */
import { parentPort } from 'node:worker_threads'
import { auditTeamWorkspace } from './workspace-audit.ts'
import type { TeamState } from './types.ts'

parentPort?.on('message', (job: { id: number; workspace: string; team: TeamState }) => {
  try {
    parentPort?.postMessage({ id: job.id, audit: auditTeamWorkspace(job.workspace, job.team) })
  } catch (error) {
    parentPort?.postMessage({ id: job.id, error: String(error) })
  }
})
