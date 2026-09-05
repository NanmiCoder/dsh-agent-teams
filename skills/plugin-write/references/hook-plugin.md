# Hook Plugin Reference

A hook plugin intercepts documented extension points without modifying the Agent loop, for example permission gates, sandbox or planning policy, deadlines, retries, metrics, telemetry, and request routing. A "native hook" is an ordinary Cordis plugin registered at an interception point; it does not require an external protocol.

> Target-version guard: this document is a form reference, not version-migration authority. Verify every event name, dispatch mode, type, and Loader rule against the exact target Harness checkout. For an upgrade, build the migration ledger from [`version-adaptation.md`](version-adaptation.md) first, then follow the observed target behavior.

## Waterfall Semantics

`ctx.waterfall` is around middleware. A listener receives `(...args, next)`. Calling `next()` delegates to the next service and may wrap its result. Returning without calling `next()` short-circuits the chain. Values flow through the return value of `next()`. Cooperative listeners typically modify a shared request or decision object and then delegate. A listener may also replace the result completely, in which case downstream listeners see only the replacement. Use `prepend: true` only when the listener must execute before ordinary registrations. For single-decision events, short-circuiting is intentional: a policy listener that owns the decision may return without calling `next()`. A listener that only annotates or observes must delegate. Omitting `next()` silently takes over the flow, so never omit it accidentally. Dispatch mode is part of an event's public contract. Other modes include `emit` for broadcast, `bail` for the first non-`undefined` value, and `serial` for ordered execution, but interception points use waterfall.

## Select the Extension Point

| Goal | Extension point |
|---|---|
| Apply allow, deny, or ask policy to a tool call | `tools/pre-execute`, returning a typed `PreToolDecision` |
| Apply a final monotonic denial that later listeners cannot undo | `ctx.tools.guard()` |
| Wrap dispatch lifecycle for timeouts, retries, or metrics | `tools/execute`, which may replace only `exec.signal` |
| Transform the result, replace presentation, block the result, or append model-visible context | `tools/post-execute` |
| Observe the immutable normalized result for audit or capture | `tools/result` |
| Intercept a request, step, or turn | `agent/*` events; `agent/turn-stopping` is the turn-stopping event |
| Short-circuit or route a model call | `llm/stream` waterfall |
| Enforce a monotonic conclude-turn policy | Call `ToolExecution.concludeTurn()` from a terminal tool |

Tool-pipeline order is `tools/pre-execute` waterfall, monotonic guards, `tools/execute` and `tools/post-execute` waterfalls, then the tool-owned `finalizeContent` and `tools/result`. A denied call or unanswered approval skips the tool body. `tools/result` observes a frozen lossless-JSON result. `tools/post-execute` runs before normalization and may transform the result or append context.

## Permission-Gate Template

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

declare function isAllowed(exec: ToolExecution): Promise<boolean>

export const name = 'permission-gate'

export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!(await isAllowed(exec))) {
      return { kind: 'deny', reason: 'Denied by policy.' }
    }
    return next()
  })
}
```

Typed decisions include `{ kind: 'allow' }`, `{ kind: 'deny', reason }`, and `{ kind: 'ask', ... }`. `ask` opens a one-shot request through `ctx.approval`; deny when approval is absent or cannot answer. This waterfall is a reorderable policy layer for sandbox, permission, and planning plugins. Use `ctx.tools.guard()` when an invariant needs a final monotonic denial that later listeners cannot undo. Use `tools/execute` when a plugin must wrap actual dispatch lifecycle for timeouts, retries, or metrics and may replace only `exec.signal`. Use `tools/post-execute` for explicit result transformation, and `tools/result` for controlled observation of the immutable final result.

## Rules

- A listener registered through `ctx.on()` is an effect and is removed automatically when the plugin unloads. Base every registration and cleanup on effects.
- Prefer events for interception and policy. Prefer service methods for direct capability calls.
- Do not embed deployment policy in tools. Put policy in hook plugins so it can be reordered and applied across tool families without coupling a tool to one policy service.
- Scoped listeners filter dispatch. Register on `agent.ctx` to scope policy to one Agent. When the Agent is disposed, contributions from `agent.ctx` are revoked in awaitable cleanup order.
- Define typed events through declaration merging on the target Cordis `Events` interface and document the dispatch mode with `@mode`. Harness event names use `namespace/action`, such as `tools/pre-execute`, `agent/request`, and `agent/turn-stopping`.

## Validation

Unit-test decision logic, covering every decision kind plus short-circuit and delegation paths. Use a real-composition test to prove that the permission gate actually blocks the call and that a denied call creates no side effects. A guard test is useful only if the regression truly makes it fail. When the exact target contract requires a bundled or composition module without `inject` to use named exports, add `expect('default' in mod).toBe(false)` and an `unwrapExports` round-trip assertion, then prove it fails when the regression is introduced. Do not apply this guard to default plugin objects or `Service` classes supported by the target version. Add a credential-free snapshot in the same change for model- or user-visible behavior.
