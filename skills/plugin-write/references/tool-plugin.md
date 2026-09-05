# Tool Plugin Reference

A tool is a model-callable capability registered on `ctx.tools`. In target versions that provide this contract, its Schema is added automatically to system-prompt assembly. If the target version contains `packages/bash/tool-bash`, use it as a reference implementation.

> Target-version guard: this document is a form reference, not version-migration authority. Verify the tool registry, Schema, events, renderers, and Code Mode bridge against the exact target Harness checkout. For an upgrade, build the migration ledger from [`version-adaptation.md`](version-adaptation.md) first, then follow the observed target behavior.

## Shape

```ts
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read a file from disk.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path' },
      limit: { type: 'number' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
    },
  }))
}
```

The registry also accepts a raw JSON Schema `ToolDefinition`; MCP-origin tools enter this way. `defineTool` is the typed helper. Before `execute` runs, it validates `arguments` against the unified parameter Schema and derives the `execute` types from that Schema.

## The `execute()` Contract

- **Parameters are validated for you.** Before `execute` runs, `defineTool` validates model-generated `arguments`, including types, required keys, literal constraints, exact discriminated unions, and nested values, so the arguments inside `execute` satisfy the inferred type. Still check constraints that the DSL cannot express, such as nonempty strings, positive numbers, and cross-field rules. Raw JSON Schema tools registered directly own their input validation.
- **Registration borrows a read-only definition.** Do not mutate the Schema or replace callbacks after registration. To hot-swap a tool, dispose the owning effect and register a replacement. Mutable state captured by callbacks remains ordinary plugin state.
- **Execution identity is protected.** The registry materializes `arguments` as independent lossless JSON, freezes it before policy begins, and assigns an opaque `exec.token`. `callId`, `name`, `arguments`, `agent`, `token`, the caller-owned `signal`, and the optional outer transport `parent` token remain immutable throughout dispatch. Treat `args` as read-only input. Only around-dispatch wrappers receive a mutable view; they may replace and restore the required `exec.signal` to impose deadlines, but they cannot remove it.
- **Declare and return one canonical JSON value.** `output.schema` is a value Schema whose root may be an object, array, scalar, or null. `execute` returns only the inferred value. The registry snapshots it into lossless JSON, validates and freezes it, and then passes it to `output.render(args, value)`. Do not return content blocks from the body or force callers to parse IDs and fields from prose.
- **Throwing or returning an invalid value both produce `isError`.** The registry captures exceptions and bounds Schema, renderer, metadata-projector, and lossless-JSON failures before observers run. Throw infrastructure failures. Represent successful domain outcomes as canonical values, even when the renderer must explain an undesirable state such as a nonzero process exit.
- **Honor `exec.signal`.** Cancel in-flight work when the signal aborts.
- **Project persisted card data through optional `output.presentationMeta`.** It derives replayable JSON from the same canonical value. Core persists it on `tool/result` and passes it to `presentResult`, allowing cards that need result-stage facts to replay without persisting the canonical value itself.
- **Use `exec.agent` for asynchronous notifications.** `agent.inject({ content, source: { kind: 'plugin', plugin: '<name>' } })` appends persistent context visible to the next model request. It does not wake the Agent; an idle Agent remains idle. Guard an already-disposed Agent with try/catch.

## Long-Running Work

Control `run_in_background` through provider configuration, then register work with `ctx.tasks.start({ kind, label, owner: exec.agent, run })`. Before the provider body runs, the registry rejects a pre-aborted call. At runtime it validates ownership and control-plane availability, starts `run()`, and provides an ID, session fence, generic control tools, notifications, and owner cleanup. A successful background branch returns a typed canonical handle such as `{ kind: 'background', taskId }`. The renderer may keep a human-readable explanation, but Code Mode must never parse the ID from that prose. The provider must expose synchronous `cancel`, a never-rejecting `done` that completes after cleanup, and optionally a consuming `readOutput` with bounded output. After `ctx.tasks.start()` publishes the ID, use the task-owned cancellation signal instead of `exec.signal`: outer-call cancellation then stops only the wait and does not kill published work. `task_kill`, owner disposal, and service teardown own that lifecycle. Foreground work remains bound to `exec.signal`.

## Policy and Observation

Prefer not to embed deployment policy in tools. Selection rules: use `tools/pre-execute` for extensible allow, deny, or ask policy and return a typed decision. `ask` opens a one-shot request through `ctx.approval`; deny when approval is absent or cannot answer. Use `ctx.tools.guard()` for a final monotonic denial that later listeners cannot undo. Wrap dispatch with `tools/execute` to add deadlines, retries, or metrics. Use `tools/post-execute` to replace presentation content or the returned value, block the result, or append model-visible context. Observe the immutable normalized result with `tools/result`. Replacing content preserves programmatic access to the canonical `value`; confidentiality policy may block or replace the value. Execution order is `tools/pre-execute` waterfall, monotonic guards, `tools/execute` and `tools/post-execute` waterfalls, then the tool-owned `finalizeContent` and `tools/result`.

## User Interface Rendering

UI cards and model results are separate concerns declared through pure presentation projections. `presentCall(args)` returns an in-progress card, while `presentResult(args, { content, isError, meta? })` returns a completed card. A tool without UI presentation falls back to a generic card whose title is the tool name and whose input is the raw arguments. Card types:

- `{ card: 'generic', title, kind?, rawInput?, content?, locations? }` — The default. Set `kind` to choose an icon such as `read` or `search`. Set `locations: [{ path, line? }]` for every file touched by the tool so editors can track them.
- `{ card: 'terminal', title, description?, cwd? }` — The call itself is a Shell command, and `title` is that command.
- `{ card: 'diff', title, diffs, locations? }` — The call creates or modifies files. Use `diffs: [{ path, oldText, newText }]`; for a new file, set `oldText: null` to render an inline diff.
- `search` — A completed discovery result rebuilt from persisted `result.meta`. It may contain file-grouped matches with `shape: 'matches'` or a flat path list with `shape: 'paths'`. Include `truncated` and `total` so the UI cannot present truncated output as complete. `search` has no call view; an in-progress discovery call remains a generic card.
- `web` — A completed Web lookup distinguished by `kind: 'search' | 'fetch'`, derived from `result.meta`, and carrying no duplicate body text.

Hard rules:

- **Pure functions.** These projections run during both live streaming and session-log replay, so they must be pure functions of `args` plus the result: no I/O, session-state reads, clock, or randomness. Derive diffs from arguments. The UI adapter supplies session context; the tool does not.
- **UI-only formatting must not enter the model result.** Do not place fenced `console` blocks, diffs, or relativized paths intended only for the UI into the canonical value or native content. `output.render` owns model-visible text; `presentationMeta` and card presenters own replayable UI state.
- **`defineTool` soft-validates presentation paths.** When logged arguments are malformed or come from an older version, the wrapper returns `undefined` and uses the generic fallback instead of throwing. Presentation must never crash replay.

Neutral vocabulary lives in `dsh-tools`. Tools never import UI or transport types. `dsh-tool-fs` with generic and diff cards, and `dsh-tool-bash` with terminal cards, are reference implementations.

## Code Mode

In Code Mode, every visible registered tool is callable without extra integration as `await tools.<name>(args)`. Generated `ToolArgsMap` and `ToolOutputMap` types derive exact argument and canonical return types from the same Schemas, and calls re-enter the normal execution pipeline. After policy processing, a successful call resolves to the final canonical JSON value rather than rendered native content. A failed call rejects with a real `ToolCallError`; programs may inspect only its `name`, `toolName`, and human-readable `message`. Design `output.schema` as a useful programming API: return handles and fields directly; allow a scalar, array, or null at the root when that is the real value; and keep human explanation in `output.render`.

## Validation

Unit-test `execute` and rendering logic. For a user-visible tool, run a real-composition test that starts the plugin through `cordis.yml`. When the tool changes model-visible behavior such as a prompt Schema or tool output, or UI-visible behavior such as cards, add a credential-free snapshot in the same change. In the Harness monorepo, satisfy its per-file coverage gate. In an external repository, satisfy the coverage gate declared by that repository.
