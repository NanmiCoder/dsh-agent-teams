/**
 * Member subagent lifecycle: spawn a continuable child per member, deliver
 * task turns and step-boundary messages, and observe its activity.
 *
 * Members are durable continuable subagents of the captain, so a member keeps
 * its conversation across turns and across harness restarts: the captain
 * queues its next turn through {@link deliverToMember}, it works through its turn
 * (updating team state through the `agent_teams_*` tools), and becomes idle
 * again. Its final assistant message is not readable programmatically, so the
 * member persists its report into the captain's mailbox and the task records,
 * which the captain reads through `agent_teams_status`.
 * @module dsh-agent-teams/members
 */
import { installModelSelection } from '@deepseek-ai/dsh-agent';
// Declaration merge only: makes ctx.subagents visible.
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent';
import { createUserMessage, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { join } from 'node:path';
import { agentTeamsSource, observedSessionFormatVersion, guardSubagentCreation, startMember, usesManagedActivations, guardSubagentDelivery, installContinuableMemberSetup, memberToolFilter, queueMemberPrompt, restrictableToolNames, startMemberWithLenientFilter, steerMemberPrompt, sessionOwnEvents } from "./harness-compat.js";
import { markMailboxDelivered, appendMailbox, CAPTAIN_KEY, createMessage, readRetiredMemberIds, readTeamSync, readTeam, releaseMailboxDelivery, withTeamLock, writeTeam } from "./state.js";
import { mailboxPrompt } from "./mailbox.js";
import { nearestLiveLead } from "./lineage.js";
import { appendTeamEvent, captainSessionOf } from "./events.js";
import { isPmMemberName } from "./tool-names.js";
import { TERMINAL_TASK_STATUSES } from "./types.js";
/** Persona snapshot of a profile protocol; the full text lives on team.json. */
export const PERSONA_PROTOCOL_MAX_CHARS = 400;
/**
 * Restore the SessionId brand on a value that round-tripped through the
 * durable team file. The brand is erased by JSON serialization; the value
 * originated from `startContinuable`/`agent.id`, so this cast is the boundary
 * restoration, not a new assertion.
 */
function brandedSessionId(value) {
    return value;
}
/**
 * Compose one member route from request, plugin configuration and the captain
 * session, without performing any I/O. This is the single place where the
 * precedence between the captain's route and a configured member default is
 * decided, so a configured model can never be silently paired with whichever
 * provider the captain happens to sit on (issue #189).
 *
 * Precedence: explicit request > plugin configuration > captain session. Model
 * ids are used verbatim: a `/` inside a model id is part of that id and is
 * never treated as a provider separator.
 *
 * `derivedProvider` is true only for a bare configured `memberModel` with no
 * provider anywhere, which is the one shape whose owner must come from the
 * provider catalogs.
 * @param request - the captain-supplied and plugin-configured route halves.
 * @param captain - the captain's current session route.
 * @returns the composed route, or `undefined` when a half cannot be determined.
 */
export function composeMemberRoute(request, captain) {
    const explicitProvider = request.provider?.trim();
    const explicitModel = request.model?.trim();
    const configuredModel = request.defaultModel?.trim();
    const configuredProvider = request.defaultProvider?.trim();
    if (explicitProvider !== undefined && explicitModel === undefined)
        return undefined;
    if (explicitProvider === '' || explicitModel === '' || configuredModel === '' || configuredProvider === '')
        return undefined;
    const providerValue = explicitProvider ?? configuredProvider ?? captain.provider;
    const providerSource = explicitProvider !== undefined ? 'request' : configuredProvider !== undefined ? 'config' : 'captain';
    const modelValue = explicitModel ?? configuredModel ?? captain.model;
    const modelSource = explicitModel !== undefined ? 'request' : configuredModel !== undefined ? 'config' : 'captain';
    return {
        provider: { value: providerValue, source: providerSource },
        model: { value: modelValue, source: modelSource },
        // A named provider is authoritative, and a named model keeps the route the
        // caller asked for. Only a model-only plugin default is allowed to have its
        // owner discovered from the catalogs.
        derivedProvider: providerSource === 'captain' && modelSource === 'config',
    };
}
/**
 * Validate a resolved roster against every provider catalog before any child
 * session is created. Catalogs are advisory when empty (some adapters accept
 * dynamic model ids), but a non-empty catalog is authoritative enough to
 * catch a typo that would otherwise boot a child and fail on its first turn.
 */
export async function validateMemberLlmSelections(ctx, selections, signal) {
    const catalogs = new Map();
    for (const selection of selections) {
        if (signal?.aborted === true)
            throw signal.reason ?? new Error('member model validation was cancelled');
        let catalog = catalogs.get(selection.provider);
        if (catalog === undefined) {
            catalog = await ctx.llm.listModels(selection.provider);
            catalogs.set(selection.provider, catalog);
        }
        if (catalog.length === 0 || catalog.some((model) => model.id === selection.model))
            continue;
        const available = catalog.slice(0, 8).map((model) => model.id).join(', ');
        throw new Error(`unknown member model "${selection.model}" for provider "${selection.provider}"`
            + `${available === '' ? '' : ` (available: ${available}${catalog.length > 8 ? ', …' : ''})`}`);
    }
}
const MEMBER_LABEL_PREFIX = 'agent-teams:';
const FALLBACK_FAILURE_CODES = new Set(['QUOTA', 'RATE_LIMIT', 'AUTH', 'MISSING_CREDENTIAL', 'NO_ADAPTER']);
export function isFallbackFailureCode(code) {
    return FALLBACK_FAILURE_CODES.has(code);
}
/** Pure state transition used by the request-error handler and TDD tests. */
export function selectFallbackRoute(current, fallback, failureCode, alreadySwitched) {
    if (alreadySwitched || fallback === undefined || !isFallbackFailureCode(failureCode)) {
        return { retry: false, switched: alreadySwitched, selection: current };
    }
    return { retry: true, switched: true, selection: fallback };
}
/** Deliver a durable member report to the live captain at its next model step. */
export function steerCaptainReport(captain, from, content, receipt) {
    try {
        captain.steer(createUserMessage({
            content: [{ type: 'text', text: receipt ?? `AgentTeams message from member ${from}:\n\n${content}` }],
            source: agentTeamsSource({ kind: 'agent-teams' }, observedSessionFormatVersion(captain)),
        }));
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Classify a final member turn failure against the durable record. Pure, so the
 * policy is testable without a lock or a Harness.
 *
 * A failure may only mutate the attempt the plugin actually observed. When that
 * attempt is gone — the member moved on to newer work, the task was
 * reassigned to a newer attempt, or the member generation was replaced — the
 * late error carries no authority and stays silent. When the failure belongs to
 * the current generation but its work already settled, the task and member are
 * left exactly as they are and only a durable captain note is added: otherwise
 * an operator cannot tell a clean run from one whose member's last turn died
 * (429, auth failure, crash) after the delivery landed (issue #205).
 * @param observed - the live member/task capability captured at the error event.
 * @param current - the current durable member record and open task, if any.
 * @returns the disposition for this failure.
 */
export function classifyMemberFailure(observed, current) {
    const member = current.member;
    // Only the exact member generation observed at the error event may report it.
    // A replaced generation (same name, new session id) or a member record that is
    // gone cannot be failed by that child's late error.
    if (member === undefined || member.id !== observed.memberId)
        return 'ignored';
    const task = current.task;
    if (task === undefined) {
        // No open attempt is owned by this generation any more, so nothing here may
        // be mutated — but the failure itself must still be recorded. `working` is
        // NOT evidence of newer work: `syncMemberStatus` writes it as soon as the
        // turn runs, while a task completed earlier in that same turn leaves no open
        // attempt behind (the reporter's run A). Only a *concrete* superseded open
        // attempt — the branch below — or a replaced generation may stay silent.
        return 'noted_settled';
    }
    if (task.id !== observed.task?.id || task.attemptId !== observed.task?.attemptId
        || task.attempt !== observed.task?.attempt)
        return 'ignored';
    return 'failed_attempt';
}
/**
 * The surviving durable record of the capability observed at the error event,
 * or `undefined` when there is nothing honest to say about it.
 *
 * A task is only described as *settled* when its durable status is terminal
 * (`completed`/`failed`/`cancelled`). A non-terminal record — for example a task
 * that was claimed and then unclaimed or reassigned while the error was queued —
 * must fall back to the plain "no open attempt" wording instead of implying a
 * delivery landed.
 */
export function settledTaskRecord(observed, tasks) {
    if (observed === undefined)
        return undefined;
    const record = tasks.find(candidate => candidate.id === observed.id);
    if (record === undefined)
        return undefined;
    return TERMINAL_TASK_STATUSES.includes(record.status) ? record : undefined;
}
/**
 * Build the durable captain note for one recorded failure. Pure, so the wording
 * boundaries are testable without a lock or a Harness.
 * @param memberName - the member that failed.
 * @param summary - the failure message plus its code.
 * @param disposition - what the failure was allowed to do.
 * @param task - the open attempt that was failed, when there was one.
 * @param settledRecord - the terminal record of the observed task, when it exists.
 * @returns the exact message the captain will read.
 */
export function memberFailureMessage(memberName, summary, disposition, task, settledRecord) {
    const head = `Member "${memberName}" hit an unrecoverable turn failure: ${summary}.`;
    if (disposition === 'failed_attempt' && task !== undefined) {
        return `${head} Task ${task.id} ("${task.subject}") was marked failed; reassign it or retry when ready.`;
    }
    if (settledRecord === undefined) {
        return disposition === 'noted_settled'
            ? `${head} No open attempt was owned; no task state was changed.`
            : `${head} No open attempt was owned.`;
    }
    // Only a completed record supports a claim about delivered work. A failed or
    // cancelled record is described by its actual closed state.
    return settledRecord.status === 'completed'
        ? `${head} Task ${settledRecord.id} ("${settledRecord.subject}") had already completed; its state and output were left unchanged. This member's last turn died after its work landed.`
        : `${head} Task ${settledRecord.id} ("${settledRecord.subject}") was already closed as ${settledRecord.status}; its record was left unchanged. This member's last turn died after that task had closed.`;
}
/** Record a final turn failure, never an intermediate request retry. */
export async function failMemberOpenAttempt(ctx, stateRoot, teamId, memberName, failure, fallbackSession, observed) {
    const summary = `${failure.message} (code ${failure.code})`;
    const lockKey = `team:${stateRoot}:${teamId}`;
    const prepared = await withTeamLock(lockKey, async () => {
        const team = await readTeam(stateRoot, teamId);
        if (team === undefined || team.halted === true || team.captainSessionId !== observed.captainSessionId)
            return;
        const member = team.members.find(candidate => candidate.name === memberName && candidate.id === observed.memberId);
        const task = team.tasks.find(candidate => candidate.assignee === memberName
            && (candidate.status === 'claimed' || candidate.status === 'in_progress'));
        // A reassign, completion, or recreated member may win the lock while the
        // final error is queued. Only the capability observed at that event may fail.
        const disposition = classifyMemberFailure(observed, {
            member,
            task,
            observedRecord: observed.task === undefined
                ? undefined
                : team.tasks.find(candidate => candidate.id === observed.task.id),
        });
        if (disposition === 'ignored')
            return;
        if (disposition === 'failed_attempt' && task !== undefined) {
            task.status = 'failed';
            task.output = summary;
            task.updatedAt = Date.now();
        }
        if (member !== undefined && ctx.agents.get(brandedSessionId(member.id))?.status !== 'running')
            member.status = 'idle';
        // Only a terminal record of the observed task may be described, and only a
        // completed one supports a claim about delivered work. Anything else — a
        // never-assigned member, or a record left pending/claimed while the error was
        // queued — gets the plain "no open attempt" wording.
        const settledRecord = disposition === 'noted_settled'
            ? settledTaskRecord(observed.task, team.tasks)
            : undefined;
        const message = {
            ...createMessage(memberName, CAPTAIN_KEY, memberFailureMessage(memberName, summary, disposition, task, settledRecord)),
            deliveryClaimedAt: Date.now(),
        };
        if (disposition === 'failed_attempt')
            await writeTeam(stateRoot, team);
        await appendMailbox(stateRoot, team.id, CAPTAIN_KEY, message);
        if (disposition === 'failed_attempt' && task !== undefined) {
            appendTeamEvent(ctx, captainSessionOf(ctx, team.captainSessionId, fallbackSession), 'agent-teams/task-updated', {
                teamId, taskId: task.id, status: task.status, assignee: memberName, output: task.output,
            });
        }
        appendTeamEvent(ctx, captainSessionOf(ctx, team.captainSessionId, fallbackSession), 'agent-teams/message-sent', {
            teamId: team.id,
            messageId: message.id,
            from: memberName,
            to: CAPTAIN_KEY,
            content: message.content,
            ts: message.ts,
        });
        return { captainSessionId: team.captainSessionId, message };
    });
    if (prepared === undefined)
        return false;
    // Use the same lease/acknowledgment contract as send_message, outside the
    // team lock: steering can synchronously start another agent turn.
    const captain = nearestLiveLead(ctx, { captainSessionId: prepared.captainSessionId });
    const delivered = captain !== undefined && steerCaptainReport(captain, memberName, prepared.message.content, mailboxPrompt(teamId, CAPTAIN_KEY, [prepared.message]));
    await withTeamLock(lockKey, () => delivered
        ? markMailboxDelivered(stateRoot, teamId, CAPTAIN_KEY, [prepared.message.id])
        : releaseMailboxDelivery(stateRoot, teamId, CAPTAIN_KEY, [prepared.message.id]));
    return true;
}
async function updateFallbackState(stateRoot, teamId, memberName, fallback, ctx) {
    await withTeamLock(`team:${stateRoot}:${teamId}`, async () => {
        const team = await readTeam(stateRoot, teamId);
        if (team === undefined)
            return;
        const member = team.members.find(candidate => candidate.name === memberName);
        if (member === undefined)
            return;
        member.activeProvider = fallback.provider;
        member.activeModel = fallback.model;
        member.fallbackActive = true;
        await writeTeam(stateRoot, team);
    });
    void ctx;
}
function pendingSelectionKey(parentSessionId, label) {
    return `${parentSessionId}\u0000${label}`;
}
function selectionFromMember(member) {
    if (member?.provider === undefined || member.model === undefined)
        return undefined;
    const provider = (member.activeProvider ?? member.provider).trim();
    const model = (member.activeModel ?? member.model).trim();
    if (provider === '' || model === '')
        return undefined;
    // Effort ids belong to the original model. After a fallback, its own
    // provider default remains authoritative, including after cold recovery.
    const reasoningEffort = member.fallbackActive === true ? undefined : member.reasoningEffort?.trim();
    return {
        provider,
        model,
        ...reasoningEffort === undefined || reasoningEffort === '' ? {} : { reasoningEffort },
        ...member.fallback === undefined || member.fallbackActive === true ? {} : { fallback: member.fallback },
    };
}
function modelSelection(selection) {
    return {
        provider: selection.provider,
        model: selection.model,
        ...selection.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) },
    };
}
/**
 * Resolve one member's complete model selection. Ordinary members snapshot the
 * captain's current request route and reasoning effort. When provider or model
 * changes, effort is intentionally omitted so the target model materializes
 * its own default instead of receiving an adapter-owned id from another route.
 * An explicit effort overrides either policy; the sentinel "default" also
 * selects the target model's default. The final effort is validated against
 * the target model before a child is created.
 *
 * A configured `memberModel` is a route preference, not a blind model-id
 * override: it is paired with `memberLlmProvider` (or its own `provider/model`
 * form) when configured, and when only a bare model id is configured it is
 * adopted by the captain's provider only if that provider actually advertises
 * it. Otherwise the catalog decides: exactly one advertising provider wins,
 * none or several produce an actionable error listing them (issue #189). A
 * provider the caller *named* — explicitly or via configuration — is never
 * silently switched away from.
 */
export async function resolveMemberLlmSelection(ctx, captain, request, signal) {
    const explicitProvider = request.provider?.trim();
    const explicitModel = request.model?.trim();
    const defaultModel = request.defaultModel?.trim();
    const defaultProvider = request.defaultProvider?.trim();
    const explicitEffort = request.reasoningEffort?.trim();
    const fallback = request.fallback;
    if (request.provider !== undefined && explicitProvider === '') {
        throw new Error('member LLM provider must not be empty');
    }
    if (request.model !== undefined && explicitModel === '') {
        throw new Error('member model must not be empty');
    }
    if (request.defaultModel !== undefined && defaultModel === '') {
        throw new Error('configured memberModel must not be empty');
    }
    if (request.defaultProvider !== undefined && defaultProvider === '') {
        throw new Error('configured memberLlmProvider must not be empty');
    }
    if (request.reasoningEffort !== undefined && explicitEffort === '') {
        throw new Error('member reasoning effort must not be empty');
    }
    // An explicit provider needs an explicit model; `memberModel` is used
    // verbatim, so a `/` inside a model id is never a provider separator.
    if (explicitProvider !== undefined && explicitModel === undefined) {
        throw new Error('an explicit member LLM provider requires an explicit member model');
    }
    const current = captain.session.requestHeader()?.config;
    const currentProvider = current?.provider ?? captain.options.provider;
    const currentModel = current?.model ?? captain.options.model;
    if (currentProvider === undefined || currentModel === undefined) {
        throw new Error('cannot resolve the member LLM route from the current captain session');
    }
    // The plugin-wide default only applies where the caller did not choose a
    // model. `request.defaultModel` belongs to the plugin configuration; a
    // request-level `model` is a user choice and is never re-routed.
    const composed = composeMemberRoute({
        provider: request.provider,
        model: request.model,
        defaultModel: defaultModel,
        defaultProvider: defaultProvider,
    }, { provider: currentProvider, model: currentModel });
    if (composed === undefined) {
        throw new Error('cannot resolve the member LLM route from the current captain session');
    }
    // Only a bare configured `memberModel` may have its owner resolved from the
    // catalogs. A named provider (explicit or configured) is authoritative — a
    // model it does not advertise is a hard error, never a silent switch — and a
    // model the caller named keeps that caller's route.
    const provider = composed.derivedProvider
        ? await resolveMemberModelOwner(ctx, currentProvider, composed.model.value, signal)
        : composed.provider.value;
    // Effort ids belong to one exact provider/model capability. Preserve the
    // captain's effort only on the same route; a changed route must resolve its
    // own default. Explicit effort still wins, while "default" forces that
    // target-default behavior even when the route did not change.
    const model = composed.model.value;
    const sameRoute = provider === currentProvider && model === currentModel;
    const reasoningEffort = explicitEffort === undefined
        ? sameRoute
            ? current?.reasoningEffort
            : undefined
        : explicitEffort === 'default'
            ? undefined
            : ReasoningEffortId(explicitEffort);
    let resolved;
    try {
        resolved = await ctx.llm.resolveCallConfig({
            provider,
            model,
            ...reasoningEffort === undefined
                ? {}
                : { reasoningEffort },
        }, signal);
    }
    catch (error) {
        throw new Error(describeMemberRouteFailure(provider, model, error), { cause: error });
    }
    return {
        provider: resolved.provider,
        model: resolved.model,
        ...resolved.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: String(resolved.reasoningEffort) },
        ...fallback === undefined ? {} : { fallback },
    };
}
/**
 * Pick the provider that owns a configured bare model id when the captain's
 * provider does not advertise it. Only an unambiguous owner is accepted: zero
 * advertising providers and several advertising providers both fail with the
 * catalog, because guessing between real providers changes which account and
 * quota the user's members run on (issue #189).
 * @returns the resolved provider id.
 */
async function resolveMemberModelOwner(ctx, captainProvider, model, signal) {
    // Enumeration is optional: an adapter that cannot list its providers must not
    // turn a resolvable route into a crash. Such a route keeps the captain's
    // provider and lets the durable adapter report the real failure.
    const listProviders = ctx.llm.listProviders;
    if (typeof listProviders !== 'function')
        return captainProvider;
    const owners = [];
    for (const provider of listProviders.call(ctx.llm)) {
        if (signal?.aborted === true)
            throw signal.reason ?? new Error('member model resolution was cancelled');
        const catalog = await ctx.llm.listModels(provider.id);
        if (catalog.length === 0)
            continue;
        if (catalog.some((candidate) => candidate.id === model))
            owners.push(provider.id);
    }
    if (owners.includes(captainProvider))
        return captainProvider;
    if (owners.length === 1)
        return owners[0];
    if (owners.length === 0) {
        throw new Error(`no configured provider advertises the member model "${model}".`
            + ` The captain's provider "${captainProvider}" does not serve it either.`
            + ' Name the owner explicitly with memberLlmProvider, or pass provider + model to agent_teams_add_member.');
    }
    throw new Error(`the member model "${model}" is advertised by ${owners.length} providers (${owners.join(', ')}),`
        + ' so its owner is ambiguous. Name it explicitly with memberLlmProvider, or pass provider + model to agent_teams_add_member.');
}
/** Turn a raw adapter failure into an actionable, route-naming error. */
function describeMemberRouteFailure(provider, model, error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    const hint = code === 'UNKNOWN_MODEL' || code === 'NO_ADAPTER' || code === 'INVALID_CONFIG'
        ? ` The member route was composed from the captain's session and the plugin configuration;`
            + ' set memberLlmProvider when the configured member model belongs to a'
            + " different provider than the captain's session."
        : '';
    return `cannot use the member LLM route "${provider}/${model}": ${message}${code === '' ? '' : ` (code ${code})`}.${hint}`;
}
/**
 * Install the member selection bridge for every fresh or cold-resumed
 * continuable child. Fresh creation reads the pending in-memory selection;
 * cold resume restores the same selection from the owning team's durable
 * record. Legacy members without a complete saved route retain Harness's
 * descriptor provider/model behavior.
 */
export function installMemberSelectionRuntime(ctx, stateDir, onFailureSettled) {
    const pending = new Map();
    const pendingSetup = new Map();
    // Active selection refs keyed by `${teamId}\u0000${memberName}`. Each entry
    // is the mutable ref object installed on the member's child context, so a
    // runtime hot-swap (agent_teams_set_member_model) can mutate
    // `selectionRef.current` and have the next LLM request pick up the new route
    // without destroying the member session. Entries are removed on dispose.
    const activeSelectionRefs = new Map();
    installContinuableMemberSetup(ctx, (childCtx, child) => {
        const descriptor = foldSubagentDescriptor(sessionOwnEvents(child.session));
        if (descriptor?.mode !== 'continuable' || !descriptor.label.startsWith(MEMBER_LABEL_PREFIX)) {
            return () => undefined;
        }
        const parentSessionId = child.session.header.parentSession;
        if (parentSessionId === undefined)
            return () => undefined;
        const identity = descriptor.label.slice(MEMBER_LABEL_PREFIX.length);
        const separator = identity.indexOf(':');
        if (separator < 1 || separator === identity.length - 1)
            return () => undefined;
        const teamId = identity.slice(0, separator);
        const memberName = identity.slice(separator + 1);
        const workspace = child.session.header.cwd ?? process.cwd();
        const stateRoot = join(workspace, stateDir);
        const key = pendingSelectionKey(parentSessionId, descriptor.label);
        // Internal settlement wakeups bypass the public delivery guard. Recheck
        // exact durable membership on every proposed step, including cold resume.
        const disposeAdmission = childCtx.on('agent/pre-step', async (payload, next) => {
            if (payload.agent.id !== child.id)
                return next();
            const admitted = await withTeamLock(`team:${stateRoot}:${teamId}`, async () => {
                const team = await readTeam(stateRoot, teamId);
                return team?.captainSessionId === parentSessionId && team.phase !== 'staged' && team.halted !== true
                    && team.members.some(member => member.id === child.id && member.name === memberName && member.status !== 'removed' && member.stopping !== true)
                    && !team.tasks.some(task => task.reassigning === true && task.assignee === memberName);
            });
            if (!admitted)
                return { kind: 'reject' };
            return next();
        });
        // New activations no longer persist persona/toolFilter in host descriptors.
        // Install them before the first request, and restore the exact saved values
        // after a cold resume. Historical descriptors remain owned by Harness.
        const savedTeam = pending.has(key) ? undefined : readTeamSync(stateRoot, teamId);
        const savedMember = savedTeam?.captainSessionId === parentSessionId
            ? savedTeam.members.find(member => member.id === child.id && member.name === memberName)
            : undefined;
        const setup = pendingSetup.get(key) ?? savedMember?.runtimeSetup;
        if (usesManagedActivations(ctx.subagents) && savedMember !== undefined
            && setup === undefined && descriptor.toolFilter === undefined) {
            disposeAdmission();
            throw new Error('agent-teams: saved member runtime setup is missing; refusing an unrestricted resume');
        }
        let disposeSetup = () => undefined;
        if (usesManagedActivations(ctx.subagents) && setup !== undefined) {
            try {
                const stopFilter = childCtx.tools.restrict(setup.toolFilter);
                try {
                    const stopPersona = childCtx.systemPrompt.section({
                        name: 'deployment:persona-prefix',
                        order: childCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
                        text: setup.persona,
                    });
                    disposeSetup = () => { stopPersona(); stopFilter(); };
                }
                catch (error) {
                    stopFilter();
                    throw error;
                }
            }
            catch (error) {
                disposeAdmission();
                throw error;
            }
        }
        const cleanupAdmission = () => { disposeSetup(); disposeAdmission(); };
        let selection = pending.get(key);
        if (selection === undefined) {
            const team = readTeamSync(stateRoot, teamId);
            if (team?.captainSessionId !== parentSessionId)
                return cleanupAdmission;
            const durableMember = team.members.find(member => member.name === memberName);
            selection = selectionFromMember(durableMember);
            if (selection !== undefined && (descriptor.agentProvider !== durableMember?.provider || descriptor.agentModel !== durableMember?.model)) {
                throw new Error(`agent-teams: saved model route for member "${memberName}" does not match its subagent descriptor`);
            }
        }
        let lastFailedTurn;
        // Harness emits agent/error only after request recovery is exhausted. In
        // particular, llm-retry's "always" policy calls downstream request-error
        // listeners before it retries; that waterfall cannot declare a turn dead.
        const disposeFailure = childCtx.on('agent/error', async (payload) => {
            if (payload.agent.id !== child.id || payload.turn === lastFailedTurn)
                return;
            lastFailedTurn = payload.turn;
            try {
                // Capture the attempt synchronously at the event, before any lock wait
                // can let a captain reassign it or replace the member/team generation.
                const snapshot = readTeamSync(stateRoot, teamId);
                if (snapshot?.captainSessionId !== parentSessionId)
                    return;
                const member = snapshot.members.find(item => item.id === child.id && item.name === memberName && item.status !== 'removed');
                if (member === undefined)
                    return;
                const task = snapshot.tasks.find(item => item.assignee === memberName
                    && (item.status === 'claimed' || item.status === 'in_progress'));
                const failure = payload.error instanceof LlmError ? payload.error.failure : {
                    code: 'UNKNOWN',
                    message: payload.error instanceof Error ? payload.error.message : String(payload.error),
                };
                const recorded = await failMemberOpenAttempt(ctx, stateRoot, teamId, memberName, failure, child.session, {
                    captainSessionId: parentSessionId, memberId: child.id, task,
                });
                if (!recorded)
                    return;
                // The final-error event precedes driver quiescence. Observe the real
                // lifecycle and kick explicitly even if its idle event was missed.
                // Never force an active Agent's status to idle or retry the failed task.
                await child.whenIdle();
                await withTeamLock(`team:${stateRoot}:${teamId}`, async () => {
                    const team = await readTeam(stateRoot, teamId);
                    const current = team?.members.find(item => item.id === child.id && item.name === memberName && item.status !== 'removed');
                    if (team?.captainSessionId !== parentSessionId || current === undefined || child.status !== 'idle')
                        return;
                    if (current.status !== 'idle') {
                        current.status = 'idle';
                        await writeTeam(stateRoot, team);
                    }
                });
                await onFailureSettled?.(workspace, teamId, memberName);
            }
            catch (error) {
                ctx.logger.warn(`agent-teams: failed to record member turn failure: ${String(error)}`);
            }
        });
        // Legacy teams still need failure reporting even without a saved route.
        if (selection === undefined)
            return () => { disposeFailure(); cleanupAdmission(); };
        const selectionRef = { current: modelSelection(selection), assembled: undefined };
        // Register the selection ref so agent_teams_set_member_model can hot-swap
        // the route at runtime by mutating selectionRef.current. The key combines
        // team id and member name; the member name is the canonical display name
        // from the durable team record, not the child session id.
        const selectionRefKey = `${teamId}\u0000${memberName}`;
        activeSelectionRefs.set(selectionRefKey, selectionRef);
        const disposeSelection = installModelSelection(childCtx, selectionRef);
        const fallback = selection.fallback;
        let switched = false;
        const disposeFallback = childCtx.on('agent/request-error', async (payload, next) => {
            if (payload.agent.id !== child.id || payload.signal.aborted)
                return next();
            const transition = selectFallbackRoute(selectionRef.current ?? { provider: selection.provider, model: selection.model }, fallback, payload.failure.code, switched);
            // selectFallbackRoute only retries when a fallback route exists; the
            // explicit guard narrows that fact for the compiler.
            if (fallback !== undefined && transition.retry) {
                switched = transition.switched;
                selectionRef.current = transition.selection;
                // Request recovery repeats buildRequest inside the current step; it
                // does not re-run prompt assembly. Override that captured route too,
                // otherwise the authorized retry would hit the failed primary again.
                selectionRef.assembled = transition.selection;
                await updateFallbackState(stateRoot, teamId, memberName, fallback, ctx).catch((error) => {
                    ctx.logger.warn(`agent-teams: failed to persist fallback route: ${String(error)}`);
                });
                ctx.logger.warn(`agent-teams: member ${child.id} switching to fallback ${fallback.provider}/${fallback.model} after ${payload.failure.code}`);
                return { kind: 'retry' };
            }
            return next();
        });
        return () => {
            disposeFallback();
            disposeSelection();
            activeSelectionRefs.delete(selectionRefKey);
            disposeFailure();
            cleanupAdmission();
        };
    });
    return {
        isPendingMember(agent) {
            const parent = agent.session.header.parentSession;
            const descriptor = foldSubagentDescriptor(sessionOwnEvents(agent.session));
            return parent !== undefined && descriptor?.mode === 'continuable'
                && pending.has(pendingSelectionKey(parent, descriptor.label));
        },
        getSelectionRef(teamId, memberName) {
            return activeSelectionRefs.get(`${teamId}\u0000${memberName}`);
        },
        async withPending(parentSessionId, label, selection, operation, setup) {
            const key = pendingSelectionKey(parentSessionId, label);
            if (pending.has(key)) {
                throw new Error(`member model selection is already pending for "${label}"`);
            }
            pending.set(key, selection);
            if (setup !== undefined)
                pendingSetup.set(key, setup);
            try {
                return await operation();
            }
            finally {
                pending.delete(key);
                pendingSetup.delete(key);
            }
        },
    };
}
function configuredExecutionPrompt(member, config) {
    const prompt = member.executionPrompt?.trim() || config.executionPrompt?.trim();
    return prompt === undefined || prompt === '' ? undefined : prompt;
}
function truncatedPersonaProtocol(protocol) {
    if (protocol === undefined || protocol.trim() === '')
        return '(none)';
    if (protocol.length <= PERSONA_PROTOCOL_MAX_CHARS)
        return protocol;
    return `${protocol.slice(0, PERSONA_PROTOCOL_MAX_CHARS)}… [truncated]`;
}
function assignedNonTerminalCount(team, memberName) {
    return team.tasks.filter(task => (task.assignee === memberName && !TERMINAL_TASK_STATUSES.includes(task.status))).length;
}
/**
 * The member's system prompt (persona), shadowing the deployment persona for
 * that child. Self-contained: it replaces the whole persona section.
 * Frozen at spawn: draft must already carry the Team goal and profile protocol.
 * @param team - the team the member joined.
 * @param member - the member record (name/role are read before spawning).
 * @param stateDir - configured state directory, so the member can locate the
 *   team files with its own file tools.
 */
export function memberPersona(team, member, stateDir, executionPrompt) {
    const goal = team.description?.trim() || '(not provided)';
    const injectedPrompt = member.executionPrompt?.trim() || executionPrompt?.trim();
    const protocol = truncatedPersonaProtocol(team.profile?.protocol);
    const isPm = isPmMemberName(member.name);
    if (isPm) {
        return `You are ${member.name}, the PM (project manager) of the multi-agent team "${team.name}" running inside DeepSeek Harness AgentTeams. The captain leads the team; you are the captain's scheduling proxy — an independent member that manages task flow on the captain's behalf${member.role ? ` with the role: ${member.role}` : ''}.

Team context:
- Team id: ${team.id}
- Your name inside the team (use it as \`from\`/identity): ${member.name}
- Team goal: ${goal}
- Profile protocol: ${protocol}
${injectedPrompt === undefined || injectedPrompt === '' ? '' : `- Execution guidance:
${injectedPrompt}
`}- The team state lives under ${stateDir}/${team.id}/ (team.json and inbox/*.jsonl). You may inspect these files read-only for diagnostics, but never edit them directly; use the agent_teams_* tools so JSON escaping and concurrent updates stay safe.
- The captain and your teammates reach you through messages. Coordination arrives at your nearest model step.

PM scheduling rules:
1. You may call agent_teams_create_task to create tasks, agent_teams_reassign_task to assign/retry tasks, and agent_teams_amend_task to fix wrong contracts. These are the same tools the captain uses; you act as the captain's delegate for task scheduling.
2. You may call agent_teams_set_member_model to hot-swap a member's model at runtime without destroying the member's session or losing context.
3. You receive observation copies of inter-member messages (marked [observation]) so you can track coordination and spot errors. Do not reply to observation copies — they are read-only. Intervene only when you detect a problem (e.g. a member is stuck, a task contract is wrong, a dependency is blocked).
4. You are still a member: use agent_teams_claim_task / agent_teams_update_task for your own tasks, and agent_teams_send_message to communicate. You may also be assigned tasks yourself.
5. Do NOT create or delete teams, add/remove members, approve plans, or resume halted teams — those remain captain-only operations.
6. When you create or reassign a task, the shared scheduler dispatches it automatically. Do not busy-poll; end your turn after scheduling and let members work.
7. Quality-gate kinds carry a contract (kind, objective, inScope, acceptance, verify). When amending a contract, provide a clear reason; the amendment is recorded in the task's revisions ledger.`;
    }
    return `You are ${member.name}, a member of the multi-agent team "${team.name}" running inside DeepSeek Harness AgentTeams. The captain leads the team; you are a worker member${member.role ? ` with the role: ${member.role}` : ''}.

Team context:
- Team id: ${team.id}
- Your name inside the team (use it as \`from\`/identity): ${member.name}
- Team goal: ${goal}
- Profile protocol: ${protocol}
${injectedPrompt === undefined || injectedPrompt === '' ? '' : `- Execution guidance:
${injectedPrompt}
`}- The team state lives under ${stateDir}/${team.id}/ (team.json and inbox/*.jsonl). You may inspect these files read-only for diagnostics, but never edit them directly; use the agent_teams_* tools so JSON escaping and concurrent updates stay safe.
- The captain and your teammates reach you through messages. Coordination arrives at your nearest model step. Apply it to your current attempt; a task assignment starts a separate turn.
When you receive a task, treat the assignment prompt's dependency results as source material. Do not ignore them.

Working rules:
1. When you receive a task assignment, call agent_teams_claim_task with the task id. Keep the returned attempt_id: include it in every agent_teams_update_task call for that execution attempt. Then mark the task in_progress.
2. Work thoroughly with your available tools; do not cut corners.
3. When finishing a task:
   - use status=completed only when the task's success criteria are satisfied;
   - use status=failed when blocking findings or validation failures mean downstream work must not proceed;
   - include a concise output in either case;
   - a stale-attempt rejection means the captain reassigned or took over the task; stop touching that task and wait for new work.
   claimed cannot jump to completed. Mark in_progress first, then completed or failed.
   Include attempt_id on every update. Then report once as described below and become idle.
4. Send one short report with agent_teams_send_message (to=captain) when you complete a task or hit a blocker. Include source_task_id and source_attempt_id in task reports; a stale source rejection means stop, never relabel an old result with a new attempt. The captain is also your parent: this single message satisfies both reporting duties. Do not repeat it through the native send_message tool or send acknowledgments that add no new information.
5. To ask a teammate something, use agent_teams_send_message with to=<teammate name>; the message lands in their mailbox and wakes them directly — teammates talk to each other without the captain in the loop. The same applies to the captain (to=captain).
6. After your turn becomes idle, the shared task scheduler may assign your next ready task automatically. Never claim a second task while you still own unfinished work.
7. If you already own an open attempt (claimed or in_progress) and receive mail, treat it as guidance for that same attempt_id unless the mail explicitly tells you to stop or fail. Do not claim a new task in that turn.
8. Do not start a teammate's assigned task. Do not privately tell the next-stage member to start; the scheduler assigns unlocked work after you become idle.
9. You are a worker: do not create or delete teams, reassign tasks, or add/remove members — that is the captain's job.
10. Quality-gate kinds carry a contract (kind, objective, inScope, acceptance, verify). Stay inside inScope. Do not mark your own implementation as review pass. Review/requirements complete only with verdict=pass; needs_revision/reject must fail with findings. Mail is not a formal next review. Completed work must not be repeated to attach late evidence: call update_task on the original task with its attempt_id and acceptanceResults/commandsRun/evidence_note; supplements are append-only and cannot change its verdict.`;
}
/**
 * The initial user message delivered when the member is created.
 * Counts non-terminal tasks already assigned to this member on the in-memory draft.
 * @param team - the team the member joined.
 * @param memberName - canonical member name used to count assigned pending work.
 */
export function memberWelcome(team, memberName) {
    const assigned = assignedNonTerminalCount(team, memberName);
    return `You have joined the team "${team.name}" as a member. Wait for an automatic assignment or a captain message.
Current team status: ${team.tasks.length} task(s), ${assigned} pending task(s) assigned to you.
Do not start work until the scheduler or captain assigns a task in this turn.`;
}
/**
 * Spawn one member as a durable continuable subagent of the captain and fill
 * `member.id` with its child session id. On failure nothing is persisted.
 * @param ctx - the plugin context (injects `subagents`).
 * @param config - member runtime knobs.
 * @param selections - fresh/cold child model-selection bridge.
 * @param llmSelection - resolved provider/model/reasoning snapshot.
 * @param captain - the exact live captain agent (the calling agent).
 * @param team - the team record (read-only here).
 * @param member - the member draft whose `id` is filled on success.
 * @param stateDir - configured state directory (for the persona).
 * @param signal - caller cancellation, forwarded to the start.
 * @param initialPrompt - first turn text; the welcome message when omitted.
 * @param resolvedFilter - the member's effective tool filter (a selected
 *   policy, or the legacy captain-only filter when the member has none). The
 *   caller resolves it so `spawnMember` forwards exactly one immutable filter
 *   to `startContinuable`.
 * @param relaxableDeny - deny names the lenient retry may drop for this
 *   member; the caller narrows it for a policy member so a name the owner
 *   declared is never silently removed.
 */
export async function spawnMember(ctx, config, selections, llmSelection, captain, team, member, stateDir, signal, initialPrompt, resolvedFilter, relaxableDeny) {
    // Fail loud at the first use: provider registration is a sibling plugin's
    // effect and may settle after this plugin mounts. Capability checks here
    // mirror what startContinuable would reject, with an actionable error.
    const provider = ctx.subagents.getProvider(config.provider);
    if (provider === undefined) {
        throw new Error(`agent-teams: no subagent provider "${config.provider}" is registered (available: ${ctx.subagents.list().join(', ') || 'none'}) — `
            + 'check that the subagent provider row (e.g. subagent-spawn) is mounted in the composition');
    }
    if (provider.prepareContinuable === undefined) {
        throw new Error(`agent-teams: provider "${config.provider}" does not support continuable members`);
    }
    const legacyCapabilities = provider.capabilities;
    if (!usesManagedActivations(ctx.subagents) && !legacyCapabilities.persona) {
        throw new Error(`agent-teams: provider "${config.provider}" cannot apply a member persona`);
    }
    if (!usesManagedActivations(ctx.subagents) && !legacyCapabilities.toolFilter) {
        throw new Error(`agent-teams: provider "${config.provider}" cannot restrict captain-only tools for members`);
    }
    const label = `${MEMBER_LABEL_PREFIX}${team.id}:${member.name}`;
    // The legacy filter of a member without a configured tool policy: the
    // captain-only deny list plus the depth entries this host registers.
    // PM members keep their scheduling tools (PM_EXTRA_TOOL_NAMES) via the
    // memberName-aware resolver even without a configured policy.
    const requestedFilter = resolvedFilter ?? memberToolFilter(config.maxDepth, restrictableToolNames(captain), member.name);
    // The lenient retry may drop names this host reports unknown; keep the exact
    // filter the host accepted for the durable member setup.
    let acceptedFilter = requestedFilter;
    const start = await startMemberWithLenientFilter(toolFilter => {
        acceptedFilter = toolFilter;
        const setup = { persona: memberPersona(team, member, stateDir, config.executionPrompt), toolFilter };
        return selections.withPending(captain.id, label, llmSelection, () => startMember(ctx.subagents, {
            provider: config.provider,
            label,
            request: {
                prompt: [{ type: 'text', text: initialPrompt ?? memberWelcome(team, member.name) }],
                parent: captain,
                persona: memberPersona(team, member, stateDir, config.executionPrompt),
                // Depth deny entries name host tools; resolve them against the
                // running host's registry so a renamed delegation tool cannot abort
                // the spawn (see memberToolFilter). Depth is still enforced by the
                // parent-chain guard installed at plugin mount. A filter the host
                // still rejects is retried without the names it reported.
                toolFilter,
                agentOptions: {
                    provider: llmSelection.provider,
                    model: llmSelection.model,
                    ...llmSelection.reasoningEffort === undefined
                        ? {}
                        : { reasoningEffort: ReasoningEffortId(llmSelection.reasoningEffort) },
                },
                // Harness request.maxDepth caps the absolute depth of THIS creation;
                // it is not inherited by later delegations. The guard below enforces
                // the configured member-relative descendant budget instead.
            },
            signal,
        }), setup);
    }, requestedFilter, relaxableDeny);
    member.id = start.childId;
    if (usesManagedActivations(ctx.subagents)) {
        member.runtimeSetup = { persona: memberPersona(team, member, stateDir, config.executionPrompt), toolFilter: acceptedFilter };
    }
    // Only a policy member carries a persisted filter snapshot; a member without
    // a policy keeps its public record shape. Legacy descriptors or runtimeSetup
    // restore the filter on cold resume, depending on the host generation.
    if (member.toolFilter !== undefined)
        member.toolFilter = { ...acceptedFilter };
}
/**
 * Deliver one message to a member as its next FIFO turn. Best effort: a
 * failure (member gone or not continuable) is logged and reported as `false`
 * so the caller can decide (mailbox delivery still happened).
 *
 * Any team sender can route through this helper: the captain is the direct
 * parent of every member, and the caller passes the captain's live Agent
 * (its own when the captain calls, the registry-resolved one when a member
 * sends) — mirroring the Claude Code mailbox model where the writer writes
 * the target's inbox and the target picks it up on its own.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captain - the exact live captain agent (the member's direct parent).
 * @param childId - the member's durable child session id.
 * @param text - the message content.
 * @param signal - caller cancellation, forwarded to the delivery.
 * @returns whether the member inbox accepted the message.
 */
export async function deliverToMember(ctx, captain, childId, text, signal, mode = 'queue') {
    try {
        const content = [{ type: 'text', text }];
        if (mode === 'steer')
            await steerMemberPrompt(ctx.subagents, captain, brandedSessionId(childId), content, signal, ctx.agents.get(brandedSessionId(childId)));
        else
            await queueMemberPrompt(ctx.subagents, captain, brandedSessionId(childId), content, signal);
        return true;
    }
    catch (error) {
        ctx.logger.warn(`agent-teams: prompt delivery to member ${childId} failed: ${String(error)}`);
        return false;
    }
}
/**
 * Request cancellation of one live member's current turn. Best effort, fire
 * and return; the target may keep running until it observes the signal.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captain - the exact live captain agent (the member's parent).
 * @param childId - the member's durable child session id.
 */
export function interruptMember(ctx, captain, childId) {
    try {
        ctx.subagents.interrupt(brandedSessionId(childId), { kind: 'ancestor', agent: captain });
    }
    catch (error) {
        ctx.logger.warn(`agent-teams: interrupt of member ${childId} failed: ${String(error)}`);
    }
}
/**
 * Install the missing per-child retirement boundary above Harness rc.6.
 *
 * Upstream `interrupt()` deliberately preserves continuable sessions and the
 * upstream seam exposes no targeted forget/retire method. The durable
 * AgentTeams index therefore rejects every inbox delivery before it can cold-resume a
 * retired member. Catalog rows deliberately remain discoverable: Harness rc.8
 * uses the direct-child catalog to authorize historical transcript reads and
 * `openSubagent()`, so filtering those rows would make an archived member's
 * persisted conversation inaccessible. Exact ids keep unrelated subagents
 * untouched while the delivery boundary still prevents further model turns.
 */
export function installRetiredMemberGuard(ctx, stateDir) {
    guardSubagentDelivery(ctx, async (parent, childId) => {
        const retired = await readRetiredMemberIds(join(parent.session.header.cwd ?? process.cwd(), stateDir));
        return retired.has(childId);
    });
}
/** Bound all descendant creation, including renamed tools and code-runtime calls. */
export function installMemberDelegationGuard(ctx, stateDir, maxDepth) {
    let active = true;
    const check = (parent) => {
        if (!active)
            return;
        let ancestor = parent;
        let depth = 1;
        while (ancestor !== undefined) {
            const descriptor = foldSubagentDescriptor(sessionOwnEvents(ancestor.session));
            if (descriptor?.label?.startsWith(MEMBER_LABEL_PREFIX)) {
                const identity = descriptor.label.slice(MEMBER_LABEL_PREFIX.length);
                const separator = identity.indexOf(':');
                let team;
                try {
                    team = readTeamSync(join(ancestor.session.header.cwd ?? process.cwd(), stateDir), identity.slice(0, separator));
                }
                catch (error) {
                    // Distinguish "team state unreadable" (e.g. a corrupt team.json) from
                    // the guarded rejections below: reject with an actionable message
                    // instead of leaking the raw parse error through subagents.start.
                    throw new Error(`AgentTeams delegation guard could not read the team state of "${identity.slice(0, separator)}" (its team.json may be corrupt or unreadable): ${String(error)}`);
                }
                const member = team?.members.find(item => item.id === ancestor.id && item.name === identity.slice(separator + 1));
                if (member === undefined || member.status === 'removed' || member.stopping === true || team?.halted === true)
                    throw new Error('AgentTeams member is no longer admitting delegated work');
                if (depth > maxDepth)
                    throw new Error(`AgentTeams member delegation limit (${maxDepth}) reached; report to the captain instead of spawning another agent`);
                return;
            }
            const parentId = ancestor.session.header.parentSession;
            ancestor = parentId === undefined ? undefined : ctx.agents.get(parentId);
            depth++;
        }
    };
    guardSubagentCreation(ctx, check);
    ctx.effect(() => () => { active = false; }, 'agent-teams: delegation guard lifetime');
}
/**
 * Snapshot the real driver activity for durable member ids.
 *
 * The team record is the membership authority, so this path intentionally no
 * longer depends on `listChildren()`'s versioned projection shape. Harness
 * rc.8 changed those rows to branded `SessionId` values plus residency-only
 * `activity`; neither is needed to answer whether the live Agent driver is
 * running, idle, or absent/ready.
 * @param ctx - the plugin context (injects `agents`).
 * @param memberIds - child ids restored from the durable team record.
 * @returns child id → live activity.
 */
export function memberActivity(ctx, memberIds) {
    const activity = new Map();
    for (const id of memberIds) {
        if (id === '')
            continue;
        const live = ctx.agents.get(brandedSessionId(id));
        activity.set(id, live === undefined ? 'ready' : live.status);
    }
    return activity;
}
