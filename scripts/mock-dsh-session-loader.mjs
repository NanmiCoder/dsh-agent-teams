/**
 * Minimal ESM loader stub for `@deepseek-ai/dsh-session`, used only by
 * scripts/verify-events.mjs.
 *
 * This repo deliberately does not install `@deepseek-ai/*` packages as
 * dependencies (see .npmrc: they are provided by the DSH runtime), so the
 * real session module is not resolvable in a clean checkout. The event
 * write-guard in lib/events.js only depends on the harness exposing a mutable
 * `KNOWN_SESSION_EVENT_TYPES` Set (the same contract the real module
 * satisfies on builds >= rc.5), so a stub with the same shape exercises the
 * guard exactly as the runtime does.
 *
 * The stub models a harness that recognizes only first-party
 * `tool-workflow/*` / `agent/*` event types and does NOT recognize the
 * out-of-repo `agent-teams/*` vocabulary — the exact scenario of issue #8.
 */
const MOCK_URL = 'mock:dsh-session';

const STUB_SOURCE = `
export const KNOWN_SESSION_EVENT_TYPES = new Set([
  'tool-workflow/run-started',
  'tool-workflow/run-completed',
  'agent/created',
]);
`;

/** @type {import('node:module').ResolveHook} */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/dsh-session') {
    return { url: MOCK_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

/** @type {import('node:module').LoadHook} */
export async function load(url, context, nextLoad) {
  if (url === MOCK_URL) {
    return { format: 'module', source: STUB_SOURCE, shortCircuit: true };
  }
  return nextLoad(url, context);
}
