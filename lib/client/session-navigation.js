/** Version-tolerant navigation into durable AgentTeams member transcripts. */
/** Newer sessions retain view ownership instead of publishing list.current. */
export function currentSessionId(state) {
    if ('current' in state)
        return state.current;
    return Object.values(state.byId).find(row => (row.retainedBy?.mainView ?? 0) > 0)?.id;
}
/**
 * Open one member's persisted transcript.
 *
 * Harness rc.8 intentionally removed cold subagents from the ordinary session
 * list. They must first be rediscovered in their parent's catalog, then opened
 * with the exact parent/child/mode address. Older runtimes have only `open()`;
 * the fallback preserves ordinary-session navigation. New layouts also select
 * the Conversation panel and cancel catalog refreshes superseded by navigation.
 */
export async function openAgentTeamMember(sessions, parentSessionId, childSessionId, layout, workspace) {
    if (sessions.open === undefined && workspace !== undefined) {
        workspace.openSession({ parentSessionId, childSessionId, mode: 'continuable' });
        return 'subagent';
    }
    const navigation = layout?.beginNavigation?.();
    if (sessions.openSubagent === undefined || sessions.refreshSubagents === undefined) {
        if (sessions.open === undefined)
            throw new Error('Harness does not expose session navigation');
        sessions.open(childSessionId);
        layout?.selectPanel?.(null);
        return 'session';
    }
    await sessions.refreshSubagents(parentSessionId);
    if (navigation?.aborted)
        return 'cancelled';
    const retained = sessions.subagentAddress?.(childSessionId);
    sessions.openSubagent(retained?.parentSessionId === parentSessionId
        ? retained
        : { parentSessionId, childSessionId, mode: 'continuable' });
    layout?.selectPanel?.(null);
    return 'subagent';
}
/**
 * Remember the console page while a member transcript is open.
 *
 * This is deliberately not browser history: the plugin only needs the exact
 * panel and team it came from, and restores that selection even after the
 * member session has replaced the conversation several times.
 * @returns a small external-store-shaped target.
 */
export function createConsoleReturnTarget() {
    let target;
    const listeners = new Set();
    const publish = (next) => {
        if (target === next)
            return;
        target = next;
        for (const listener of listeners)
            listener();
    };
    return {
        getSnapshot: () => target,
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        remember(next) {
            publish(next);
        },
        clear() {
            publish(undefined);
        },
    };
}
