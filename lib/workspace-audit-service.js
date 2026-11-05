import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { deliveryArtifactPaths, deliveryScopePatterns } from "./quality-gates.js";
import { readTeam } from "./state.js";
function incomplete(reason) {
    return { artifacts: [], expandedScope: [], gaps: [{ pattern: '(workspace audit)', reason }] };
}
function isAudit(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const audit = value;
    return Array.isArray(audit.artifacts)
        && audit.artifacts.every(item => typeof item?.path === 'string' && typeof item.present === 'boolean'
            && (item.present !== true || (typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256))))
        && Array.isArray(audit.expandedScope)
        && audit.expandedScope.every(item => typeof item?.path === 'string' && typeof item.present === 'boolean')
        && (audit.gaps === undefined || (Array.isArray(audit.gaps)
            && audit.gaps.every(gap => typeof gap?.pattern === 'string' && typeof gap.reason === 'string')));
}
/**
 * One lazy, reusable worker per plugin owner. Identical requests may share a
 * queued audit until it is dispatched. Every later request needs a read that
 * starts after it arrives.
 */
export class WorkspaceAuditService {
    options;
    worker;
    active;
    timer;
    idleTimer;
    jobs = new Set();
    queue = [];
    sequence = 0;
    closed = false;
    constructor(options = {}) {
        this.options = options;
    }
    audit(workspace, team, stateRoot = join(workspace, '.agent-teams')) {
        if (this.closed)
            return Promise.resolve(incomplete('workspace audit service was disposed; retry after reload'));
        if (deliveryArtifactPaths(team).length === 0 && deliveryScopePatterns(team).length === 0) {
            return Promise.resolve({ artifacts: [], expandedScope: [] });
        }
        const source = JSON.stringify(team);
        const key = `${resolve(workspace)}\0${resolve(stateRoot)}\0${team.id}\0${createHash('sha256').update(source).digest('hex')}`;
        const existing = this.queue.find(job => job.key === key);
        if (existing !== undefined)
            return existing.promise;
        if (this.jobs.size >= (this.options.maxPending ?? 16)) {
            return Promise.resolve(incomplete('workspace audit queue is full; retry instead of treating unaudited bytes as verified'));
        }
        let complete;
        const promise = new Promise(done => { complete = done; });
        const job = { id: ++this.sequence, key, workspace, stateRoot, source, team: JSON.parse(source), promise, complete };
        this.jobs.add(job);
        this.queue.push(job);
        this.pump();
        return promise;
    }
    pump() {
        if (this.closed || this.active !== undefined || this.queue.length === 0)
            return;
        clearTimeout(this.idleTimer);
        this.idleTimer = undefined;
        const job = this.queue.shift();
        this.active = job;
        try {
            if (this.worker === undefined) {
                const worker = new Worker(this.options.workerUrl ?? new URL('./workspace-audit-worker.js', import.meta.url));
                this.worker = worker;
                worker.on('message', (message) => {
                    if (this.worker !== worker)
                        return;
                    const reply = message;
                    if (reply === null || typeof reply !== 'object' || reply.id !== this.active?.id) {
                        this.failWorker('workspace audit worker returned an invalid response');
                        return;
                    }
                    const current = this.active;
                    this.active = undefined;
                    clearTimeout(this.timer);
                    this.timer = undefined;
                    worker.unref();
                    const audit = isAudit(reply.audit)
                        ? reply.audit
                        : incomplete(typeof reply.error === 'string' ? `workspace audit failed: ${reply.error}` : 'workspace audit worker returned incomplete evidence');
                    void this.finish(current, audit);
                    this.pump();
                    if (this.active === undefined) {
                        this.idleTimer = setTimeout(() => {
                            if (this.worker === worker && this.active === undefined) {
                                this.worker = undefined;
                                void worker.terminate();
                            }
                        }, 10_000);
                        this.idleTimer.unref();
                    }
                });
                worker.on('error', error => { if (this.worker === worker)
                    this.failWorker(`workspace audit worker failed: ${error.message}`); });
                worker.on('exit', code => { if (this.worker === worker)
                    this.failWorker(`workspace audit worker exited (${code}) before completing its evidence`); });
            }
            this.worker.ref();
            this.timer = setTimeout(() => this.failWorker('workspace audit timed out; current bytes could not be verified'), this.options.timeoutMs ?? 120_000);
            this.worker.postMessage({ id: job.id, workspace: job.workspace, team: job.team });
        }
        catch (error) {
            this.failWorker(`workspace audit could not start: ${String(error)}`);
        }
    }
    async finish(job, audit) {
        try {
            // Hashing yields the host thread, so a newer task attempt, edit, archive
            // or replacement team can win while the worker is running. Never apply
            // the old answer to that new record, even when its artifact paths match.
            const current = await readTeam(job.stateRoot, job.team.id);
            if (current === undefined || JSON.stringify(current) !== job.source) {
                audit = { ...audit, gaps: [...audit.gaps ?? [], { pattern: '(team revision)', reason: 'team state changed during the workspace audit; retry the current revision' }] };
            }
        }
        catch (error) {
            audit = { ...audit, gaps: [...audit.gaps ?? [], { pattern: '(team revision)', reason: `team state could not be revalidated after the workspace audit: ${String(error)}` }] };
        }
        if (!this.jobs.delete(job))
            return;
        job.complete(this.closed ? incomplete('workspace audit service was disposed before its result could be applied') : audit);
    }
    failWorker(reason) {
        const worker = this.worker;
        this.worker = undefined;
        this.active = undefined;
        clearTimeout(this.timer);
        clearTimeout(this.idleTimer);
        this.timer = undefined;
        this.idleTimer = undefined;
        this.queue.length = 0;
        for (const job of this.jobs)
            job.complete(incomplete(reason));
        this.jobs.clear();
        return worker?.terminate();
    }
    /** Unload cancels active/queued work; late replies can never restore a pass. */
    async dispose() {
        this.closed = true;
        await this.failWorker('workspace audit was cancelled when its owner unloaded');
    }
}
const owners = new WeakMap();
/** Share tools/panel work and release the worker with its Cordis owner. */
export function workspaceAuditor(ctx) {
    let service = owners.get(ctx);
    if (service !== undefined)
        return service;
    service = new WorkspaceAuditService();
    owners.set(ctx, service);
    const owned = service;
    ctx.effect(() => () => {
        // A reloaded Cordis fiber gets a new Context. Keep this disposed owner's
        // service so a late callback cannot start new work after unload.
        return owned.dispose();
    }, 'agent-teams: workspace audit worker');
    return service;
}
