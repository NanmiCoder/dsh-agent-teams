/** Built worker entry: no Harness service instances cross the thread boundary. */
import { parentPort } from 'node:worker_threads';
import { auditTeamWorkspace } from "./workspace-audit.js";
parentPort?.on('message', (job) => {
    try {
        parentPort?.postMessage({ id: job.id, audit: auditTeamWorkspace(job.workspace, job.team) });
    }
    catch (error) {
        parentPort?.postMessage({ id: job.id, error: String(error) });
    }
});
