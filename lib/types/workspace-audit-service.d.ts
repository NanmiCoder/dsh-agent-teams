/** Bounded, lifecycle-owned execution of current-byte audits off the host thread. */
import type { Context } from '@deepseek-ai/cordis';
import { type DeliveryAudit } from './quality-gates.ts';
import type { TeamState } from './types.ts';
/** Execution limits; callers cannot turn these into a successful partial audit. */
export interface WorkspaceAuditOptions {
    workerUrl?: URL;
    timeoutMs?: number;
    maxPending?: number;
}
/**
 * One lazy, reusable worker per plugin owner. Identical requests may share a
 * queued audit until it is dispatched. Every later request needs a read that
 * starts after it arrives.
 */
export declare class WorkspaceAuditService {
    private readonly options;
    private worker;
    private active;
    private timer;
    private idleTimer;
    private readonly jobs;
    private readonly queue;
    private sequence;
    private closed;
    constructor(options?: WorkspaceAuditOptions);
    audit(workspace: string, team: TeamState, stateRoot?: string): Promise<DeliveryAudit>;
    private pump;
    private finish;
    private failWorker;
    /** Unload cancels active/queued work; late replies can never restore a pass. */
    dispose(): Promise<void>;
}
/** Share tools/panel work and release the worker with its Cordis owner. */
export declare function workspaceAuditor(ctx: Context): WorkspaceAuditService;
