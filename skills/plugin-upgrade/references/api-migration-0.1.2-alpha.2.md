# API Migration in Practice · 0.1.1-rc.2 → 0.1.2-alpha.2

> Audience: an interface ledger for plugin authors. It answers three things: which
> interfaces changed, how legacy patterns fail, and what the target version's best
> practice is. Installation flows, product feature lists, and UI changes are not
> covered here.
>
> Exact corridor: `dsh-v0.1.1-rc.2`
> (`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`) → `dsh-v0.1.2-alpha.1`
> (`cd5ef8148158c3a752a658978873241fdf8e2bbc`) → `dsh-v0.1.2-alpha.2`
> (`0a53fb55bea101816fa226bb964ae2bed71c343b`).
>
> Version status: as of 2026-08-30, the latest tag in the upstream `0.1.2` series is
> `dsh-v0.1.2-alpha.2`; there is no `dsh-v0.1.2` final tag yet. Once the final release
> ships, package exports, declared types, implementations, and tests must be re-checked;
> this document must not be directly marked as a final compatibility conclusion.

## Table of contents

- One-page conclusion
- API-01 · APIProxy migrates by runtime plane to domain services or the `ctx.remote` projection
  - Minimal correct patterns for Host / Web Client
  - Web Client consumer ledger
  - Best practice
  - Verification by face
- API-02 · `RemoteResult` version boundaries and the alpha.2 `RemoteError`
  - Version attribution first
  - Current consumer pattern
  - Current Remote owner pattern
  - Best practice
  - Verification
- API-03 · Settings helper removal and provider-owned lifecycle
  - Before the upgrade
  - After the upgrade
  - Best practice
  - Verification
- API-04 · Fixed Host facts consolidated on `ctx.remote.$host`
  - The alpha.2 pattern
  - Best practice
  - Verification
- API-05 · `SessionEvent.ignorable` is restored, but the third-party write surface is still incomplete
  - The dangerous legacy pattern
  - Best practice
  - Verification
- API-06 · The Headless argv and process output contract
  - Correct invocation and interpretation
  - Best practice
  - Minimal stub matrix
- API-07 · Package export ≠ artifact presence
  - Best practice
  - Verification
- API-08 · `cordis.patch.yml` is composition, not a source patch
  - Best practice
  - Verification
- API-09 · Plugin inventory gains an optional `agentPresets`
  - Best practice
  - Verification
- API-10 · Web Client runtime unbundling, keyed chat snapshots, and command attachment parameters
  - Exact mapping
  - Type composition and dependency ownership
  - Verification
- CFG-01 · Code Mode migrated exactly to PTC mode
  - Exact ledger
- Structure the skill should use for this kind of migration report
  - <API name>
- Minimal validation ladder

## One-Page Conclusion

| API surface | Old pattern | Symptoms of the old pattern on the target version | alpha.2 best practice |
|---|---|---|---|
| Host APIProxy consumer | APIProxy / `executeRemote(...)` | `apiProxy` is gone; mechanically switching to `remote` hangs forever | Skip the Client gateway and directly inject the owning domain service confirmed at the target tag, e.g. `llm` / `settings` |
| Web Client APIProxy consumer | APIProxy / `executeRemote(...)` | The old package/service is gone; guessing the namespace or method wrong fails assembly | Use the generated `ctx.remote.<namespace>.<method>` and declare `remote` plus the specific namespace injections |
| Unary failure | Only `try/catch`; parse `message`; `instanceof` | `ok: false` treated as success; misses across bundles; error-code branches stop working | Branch on `result.ok` first, then handle by `result.error.code`; use `isRemoteFailure` only at catch boundaries such as streams/explicit throws |
| Failure classes | `TypertRemoteFailure` / `TypertLookupFailure` / `RemoteStreamError` | Removed exports or typecheck failures; unprefixed codes no longer match | Owners throw `RemoteError('<domain>/<reason>', message, details)`; details narrow by code |
| Settings namespace | `settingsNamespace('x')` | `TS2305` / “no exported member” | Use a grammar-conforming string literal directly, e.g. `const NS = 'my-plugin'` |
| Settings lifecycle | Standalone `installSettingsSection(...)` | Removed export; renaming alone loses the provider attach/detach lifecycle | Call `settingsCtx.settings.installSection(owner, ...)` inside `ctx.inject(['settings'], ...)` |
| Host facts | Inject `connection` and read the generation snapshot | Coupled to the transport lifecycle; alpha.2 already has a formal entry point | Read `ctx.remote.$host.home/isLoopback`; respond to `connection/reset` on reconnect |
| SessionEvent | Seeing that alpha.2 restored `ignorable`, directly `Session.append()` custom events | Writes succeed live, but the whole session is refused on cold load because the events have no marker | alpha.2 only restores the envelope field; the public `Session.append()` cannot set it yet, so out-of-repo plugins switch to their own sidecar/store |
| Headless process | `dsh headless`, `-p`, JSONL stdout, non-empty stderr means failure | argv not accepted, JSON parse fails, successful tasks misreported | `dsh --profile headless "task"`; stdout is the final text, stderr is reasoning/diagnostics, and the exit code is authoritative |
| Package subpath | Seeing `exports["./src/*"]`, import directly | The published package may not contain `src` at all; runtime module not found | Check exports, `files`, and the actual packed artifact together; prefer stable entry points such as `.` / `/client` |
| `cordis.patch.yml` | Treat by filename as a source patch | False positives that generate wrong migration tasks | Handle as the official Profile composition overlay first; classify as a source patch only when host source is really replaced |
| Structured questions answerer | `userQuestions.registerProvider({ ask })` | attach throws `TypeError`; questions go unanswered (`NO_PROVIDER`) | `ctx.on('user-questions/request', (req, next) => answer)`; an `ask()` without an agent dispatches on the service's own ctx, and listeners on other entries of the same fiber tree do not receive it (see [DSH-0.1.2-A1-20](v0.1.2-alpha.1.md)) |
| Type export drift | `CallId` / `JsonValue` / `collectSessionTitleMessages` / `todo/write` type declarations | typecheck fails in bulk with TS2305 / TS2614 | Migrate per the ledger: `ToolCallId` (dsh-llm root export), `@deepseek-ai/dsh-util-values`, local same-semantics folding, local event-map merging (see [rollup R-11](rollup-0.1.2.md)) |
| Web Client runtime | Import types from the removed `dsh-client-runtime/client` and read the flat `nodes[]` via `useSession` | Package gone; selectors become `any`; tests still build the old array; Host commands are one argument short | Compose types per owning package; read via `useChat` with `order + nodes.get()`; Host `commands.execute` takes an explicit `[]` when there are no images |

## API-01 · APIProxy migrates by runtime plane to domain services or the `ctx.remote` projection

- **Applies to**: Web Client, Host integrations, or startup wrapper layers that consume the old APIProxy directly.
- **How it breaks**: the old APIProxy package/service no longer exists. On the Host side, mechanically replacing `apiProxy` with `remote` waits forever on a service that only exists on the Client face; a Web Client that copies the wire route from the design notes is likely to write properties that do not exist at the target tag, such as `ctx.remote.sessionTitle.rename`.
- **Core rule**: determine the runtime plane first. Host plugins skip the Client gateway and directly inject the owning domain service behind the old call; only the Web Client uses the consumer projection generated at the target tag, without assembling `namespace/method` strings itself. On alpha.2, the Client API Remotes assembly comes from `@deepseek-ai/dsh-api-remotes/client`.

### Minimal correct patterns for Host / Web Client

The Host side uses the owning domain service directly; in the example below, `llm` / `listProviders()` already has an executable contract, and every other legacy APIProxy call must be confirmed item by item against the target tag — do not reverse-engineer it from the Client Remote table:

```ts
export const inject = ['llm']

export function listHostProviders(ctx) {
  if (!ctx?.llm || typeof ctx.llm.listProviders !== 'function') {
    throw new TypeError('Host fixture requires the llm domain service')
  }
  return ctx.llm.listProviders()
}
```

The Web Client side uses the generated projection:

```ts
import type { Context } from '@deepseek-ai/cordis'
// 类型合并：让当前编译 face 看见 ctx.remote 的已选择 namespaces。
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'

export const inject = ['remote', 'remote.session']

export async function renameSession(
  ctx: Context,
  sessionId: SessionId,
  title: string,
): Promise<void> {
  const result = await ctx.remote.session.rename({ sessionId, title })
  if (!result.ok) throw result.error
}
```

The actual path here is `ctx.remote.session.rename(...)`; `sessionTitle/rename` in the alpha.1 architecture notes is design-process text and cannot override the implementation, generated projection, and consumer tests at the same tag.

### Web Client consumer ledger

The table below applies only to the Web Client's generated projection. Host calls must confirm the owning domain service item by item against the target tag; do not derive Host service keys or methods from this table.

| rc.2 / legacy consumer operation | alpha.2 consumer projection | Migration notes |
|---|---|---|
| `connection.api.sessions.rename({ sessionId, title })` | `ctx.remote.session.rename({ sessionId, title })` | `ctx.remote.sessionTitle.rename` does not exist |
| `ctx.remote.commands.list(sessionId)` | Path unchanged | Already a Remote in rc.2; the consumer passes the Session id, and the Host scope resolves the Agent |
| `ctx.remote.commands.execute(sessionId, line, images)` | Path unchanged | Already a Remote in rc.2; `images` is required — pass `[]` when there are no images |
| `connection.api.llm.providers({})` | `ctx.remote.llm.listProviders()` and `.listConfigurableProviders()` | The two calls each return a `RemoteResult`; combine the live and configurable directories by provider id |
| `llm.discoverModels` | `ctx.remote.llm.discoverModels(settingsNs, request)` | Does not write settings/credentials; returns candidate models |
| `llm.models` | `ctx.remote.session.modelCatalog()` | Moved from the LLM domain to the Session domain |
| `credentials.describe` | `ctx.remote.credentials.describe(refs)` | Returns description info, not secret values |
| `credentials.set/unset` | `ctx.remote.credentials.set(ref, value)` / `.unset(ref)` | Secrets only cross the line in the write direction |
| `settings.describe` | `ctx.remote.settings.describe()` | Returns a redacted namespace view |
| `settings.update/replace/mutate` | `.update(ns, patch, expectedRevision)` / `.replace(ns, section, expectedRevision)` / `.mutate(ns, ops, expectedRevision)` | Strictly positional; pass `undefined` explicitly even without CAS; do not overwrite unknown fields with a whole-object replacement |
| `settings.openDocument` | `ctx.remote.settings.openSettingsDocument(signal)` | The native open capability is owned by the Host |
| `agentPreset.read` | `ctx.remote.agentPresets.read(id)` | The consumer method name is `read` |
| `agentPreset.copy` | `ctx.remote.agentPresets.copy(from, id, name?)` | `name` is optional; the success value is `void` — the preset id the old APIProxy returned no longer exists |
| `connection.api.agentPresets.remove({ agentPreset: id })` | `ctx.remote.agentPresets.deletePreset(id)` | Renamed exactly to `deletePreset`; the argument also changed from an object to a string |
| `agentPreset.openDocument` | `ctx.remote.settings.openAgentPresetDirectory(id, signal)` | Moved to the Settings domain |
| `subagent.interrupt` | `ctx.remote.subagents.interruptByParent(childId, parentId, 'continuable')` | Preserves durable parent authority |
| `connection.api.workspace.list({})` | raw: `ctx.remote.workspace.follow(signal)` | Now a baseline/delta stream; ordinary UI should prefer the `ctx.workspaces` projection |
| `workspace.insertSessionBefore` | `ctx.remote.workspace.insertSessionBefore(request)` | Unary mutation; handle the `RemoteResult` |
| `workspace.archiveSession` | `ctx.remote.workspace.archiveSession(request)` | Unary mutation; handle the `RemoteResult` |
| `connection.api.skills.list({ sessionId }, signal)` | `ctx.remote.skills.list({ sessionId }, signal)` | Reads the catalog without activating a cold Agent |
| `ctx.remote.fileReferences.list(sessionId, query, signal)` | Path unchanged | Already a Remote in rc.2; the owner moved to the Session Controller adapter |
| `connection.api.host.openPath({ path })` | `ctx.remote.session.openWorkspacePath({ path })` | The path is first resolved as a workspace by a Session-aware client |
| `connection.hostDescription.getSnapshot()?.home` | `ctx.remote.$host.home` / `.isLoopback` | `$host` is a plain facts getter, not a unary RemoteResult |
| `session.export` | `GET/HEAD /api/session.export` | A streaming Fetch route, not a JSON Remote; still subject to browser session/Host/Origin authentication |

### Best practice

1. First confirm which face the code runs on: Host, Web Client, or an ordinary Cordis plugin.
2. The Host directly injects the owning domain service and does not declare `remote`, which only exists on the Client face; do not pull Host-only packages into the Client bundle either.
3. Client contributions explicitly declare `remote` and the `remote.<namespace>` actually used; do not rely on another plugin having mounted first.
4. Defer to the target tag's package exports, `.d.ts`, implementation, and consumer tests; architecture notes only explain intent and are not a substitute for the generated API.
5. For streams such as `workspace.follow`, use the reconnect/snapshot adapter the owning package already provides; ordinary UI uses `ctx.workspaces` for the list projection and Workspace CRUD, and must not reimplement the generation baseline, mutation echo/race handling, or a timed `list()`. `connectWorkspace` / `startSession` / `pickDirectory` / directory browse are not on that face after the Client Runtime split — they live on `ctx.uiWorkspace` ([DSH-0.1.2-A1-32](v0.1.2-alpha.1.md)).

### Verification by face

Host:

- In a real Host profile at the pinned target tag, verify the entry is active, does not wait for `remote`, and execute one corresponding domain method;
- `examples/face-contracts` only proves the injection and control-flow boundary, not Loader activation or real service assembly.

Web Client:

- Typecheck must use the real `Context` and the generated projection; do not mask error paths with `ctx: any`;
- Every unary hit covers at least `ok: true` and one domain error code; calls that support `AbortSignal` additionally cover cancellation;
- Verify that an unmounted Remote contribution surfaces an explicit assembly error instead of hanging forever;
- Streams cover the opening snapshot, deltas, cancellation, carrier reconnect, and teardown.

- **Source**:
  [alpha.2 SessionController actual Remote methods](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/api/session-controller/src/index.ts) ·
  [alpha.2 API Remotes Client assembly](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/api/remotes/src/client/index.ts) ·
  [alpha.2 Workspace Remote owner](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/api/workspace-controller/src/index.ts) ·
  [alpha.2 actual rename consumer](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/api/session-controller/src/client/sessions/session.ts) ·
  [Host / Web Client face contracts in this repo](../examples/face-contracts/README.md)

## API-02 · `RemoteResult` version boundaries and the alpha.2 `RemoteError`

- **Applies to**: Clients that consume `ctx.remote`, and Host plugins that define/forward Remotes.
- **How it breaks**:
  - Handling business failures only with `catch` treats `{ ok: false }` as an ordinary success and keeps going;
  - An alpha.1 owner-side wrapper/catch that still reads `error.failure.code` gets `undefined` after switching to the alpha.2 `RemoteError`;
  - `instanceof RemoteError` misses across bundles, workers, or realms;
  - Importing `TypertRemoteFailure`, `TypertLookupFailure`, or `RemoteStreamError` fails typecheck;
  - Continuing to match unprefixed legacy codes such as `internal`, `cancelled`, or `session-not-found` falls into the default branch.

### Version attribution first

`RemoteResult<T>` already existed in alpha.1: generated unary Remotes resolve to `{ ok: true, value } | { ok: false, error }`. The alpha.2 breaking change unifies the failure vocabulary: `RemoteFailure` becomes a `RemoteError` union narrowed by code, codes become `<domain>/<reason>`, and the old wrapper/stream error surface is removed. Do not write “start handling `result.ok`” as if it were an alpha.2-only migration. Unary consumers should already read `result.error.code` in alpha.1; what changed is that owners/catches no longer read through the old wrapper's `.failure`.

### Current consumer pattern

```ts
const result = await ctx.remote.session.rename({ sessionId, title })

if (!result.ok) {
  switch (result.error.code) {
    case 'gateway/cancelled':
      // 结束当前操作，或沿调用链传播取消；不要包装成通用失败后重试。
      return
    case 'session/not-found':
      showSessionMissing(result.error.details.sessionId)
      return
    case 'session/agent-busy':
      showBusyState()
      return
    default:
      // 保留 code/details；未知码与 gateway/internal 默认不自动重试。
      reportRemoteFailure(result.error)
      return
  }
}

useRenamedSession(result.value)
```

Ordinary business, carrier, and cancellation failures land in `ok: false`. Assembly or local programming errors — arity, an unmounted method, a missing Context adapter — can still reject; do not use a broad catch to dress those defects up as retryable business errors.

When a unary consumer deliberately `throw`s `result.error`, or a stream throws a terminal Remote failure, the outer catch boundary uses a structural guard:

```ts
import { isRemoteFailure } from '@deepseek-ai/dsh-api-gateway/client'

try {
  await operationThatMayThrowRemoteFailure()
} catch (error) {
  if (isRemoteFailure(error)) {
    handleByCode(error.code, error.details)
    return
  }
  throw error
}
```

### Current Remote owner pattern

```ts
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'my-plugin/not-found': { readonly id: string }
  }
}

throw new RemoteError(
  'my-plugin/not-found',
  `item "${id}" was not found`,
  { id },
)
```

### Best practice

1. Always branch on `code`; do not parse `message` and do not rely on class identity.
2. Declare codes in the lowest common package visible to every producer; name them `<domain>/<reason>`.
3. `gateway/cancelled` ends or propagates cancellation; `gateway/internal` and unknown codes keep the original diagnostics and report them, with no retry by default.
4. Retry only when all three hold: the error code is explicitly transient, the operation is idempotent, and user policy allows it. Write operations must not be blindly replayed because of transport uncertainty.
5. Test doubles use the real `RemoteError`/`RemoteResult` shapes and do not return plain objects with only a `message`. `RemoteError` is a real `Error`; when asserting code/details prefer `toMatchObject` — do not treat it as the old plain literal object and compare for exact equality.

### Verification

- Consumer: success, domain failure, `gateway/cancelled`, `gateway/internal`, unknown code;
- Owner: module augmentation of code/details narrows correctly;
- Boundary: an explicitly thrown `result.error` is recognized by `isRemoteFailure`; ordinary Errors pass through unchanged;
- Cross-bundle/worker tests do not use `instanceof`.

- **Source**:
  [alpha.1 existing `RemoteResult<T>` definition](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/packages/typert/protocol/src/types.ts) ·
  [alpha.2 RemoteError vocabulary decision](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/.agents/notes/implemented/architecture/2026-08-28-ctx-remote-failure-vocabulary.md) ·
  [alpha.2 `RemoteError` implementation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/typert/protocol/src/remote-error.ts)

## API-03 · Settings helper removal and provider-owned lifecycle

- **Applies to**: Host/settings consumer plugins that import `@deepseek-ai/dsh-settings`.
- **How it breaks**:
  - `import { settingsNamespace } ...` or `import { installSettingsSection } ...` reports a removed export;
  - Mechanically replacing `installSettingsSection(...)` with the same-named method without placing it inside `ctx.inject(['settings'], ...)` breaks the optional provider attach/detach;
  - Continuing to import `deepEqualJson` from `@deepseek-ai/dsh-settings` fails; it moved to `@deepseek-ai/dsh-util-values`.

### Before the upgrade

```ts
import {
  installSettingsSection,
  settingsNamespace,
} from '@deepseek-ai/dsh-settings'

const NS = settingsNamespace('my-plugin')
installSettingsSection(ctx, NS, Config, config, hooks)
```

### After the upgrade

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'

const NS = 'my-plugin'
interface Config {
  enabled: boolean
}
const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
})

export function apply(ctx: Context, config: Config): void {
  let current = () => config
  let registered = config

  const refreshRegistrationFacts = (): void => {
    const next = current()
    if (deepEqualJson(registered, next)) return
    // 在这里替换真正捕获了配置快照的注册事实。
    registered = next
  }

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, NS, Config, config, {
      setSource: (source) => {
        current = source
      },
      onChange: refreshRegistrationFacts,
    })
  })
}
```

### Best practice

1. Namespaces start with a lowercase letter and contain only lowercase letters, digits, and `-` after that; string literals are checked at the TypeScript layer, dynamic strings at runtime.
2. Do not use `as SettingsNamespace` to bypass the grammar; pass a literal directly and keep the inference.
3. Pass the consuming plugin's own `ctx` as `owner`; the object the method is called on is the currently attached `settingsCtx.settings`. The two are not the same lifecycle role.
4. `setSource` saves the current authoritative getter; after the provider detaches, the helper falls back to the composition entry. `onChange` only rebuilds registration facts that genuinely depend on the config.
5. For JSON equality/value helpers, import from the owning util package; do not rely on the Settings package's historical incidental re-exports.

### Verification

- Typecheck no longer references the three removed exports;
- A valid literal registers successfully; an invalid dynamic namespace throws `TypeError`;
- On settings provider attach, read the resolved scope; on detach, fall back to the composition entry;
- After the consumer itself unloads, no wrong fallback runs; disposers and watchers do not leak.

- **Source**:
  [alpha.1 Settings entry point](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/packages/settings/settings/src/index.ts) ·
  [alpha.2 Settings entry point](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/settings/settings/src/index.ts) ·
  [alpha.2 official Settings README](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/settings/settings/README.md)

> A compatibility layer is not the official interface: DSH Desktop may currently restore
> these deprecated helpers temporarily through a local compatibility patch. A plugin that
> typechecks/runs inside the Desktop checkout does not prove it is compatible with the
> unpatched official alpha.2; migration and release verification must additionally use the
> pure official package artifact.

## API-04 · Fixed Host facts consolidated on `ctx.remote.$host`

- **Applies to**: Plugins in the Web Client that inject `connection` only to read the Host home or loopback status.
- **How it breaks**: back-projecting `$host` to alpha.1 fails typecheck; continuing to read the generation store on alpha.2 may work, but makes business packages depend on the carrier's internal lifecycle.

### The alpha.2 pattern

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'

export const inject = ['remote']

export function apply(ctx: Context): void {
  const refreshHostDependentState = (): void => {
    const { home, isLoopback } = ctx.remote.$host
    // home 在第一个 ready frame 前可以是 undefined；在这里刷新依赖这些 facts 的状态。
    void home
    void isLoopback
  }

  refreshHostDependentState()
  ctx.on('connection/reset', refreshHostDependentState)
}
```

### Best practice

- `$host` is an identity-stable plain getter — not a store, no subscribe, no generation counter; do not poll it.
- To re-read after a reconnect, respond to `connection/reset` or rely on the owning domain's own invalidation.
- An alpha.1 compatibility branch may only use a generation-ready snapshot; do not share one source file between alpha.1 and alpha.2 without feature detection/compile-time isolation.

### Verification

- Before ready, `home === undefined`; after ready, it is the Host home;
- The booleans are correct for loopback and non-loopback carriers;
- A reconnect triggers exactly one business refresh; no polling timer or duplicate listeners.

- **Source**:
  [alpha.2 Gateway Client `$host` implementation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/api/gateway/src/client/index.ts) ·
  [Fixed Host facts in the Remote failure vocabulary note](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/.agents/notes/implemented/architecture/2026-08-28-ctx-remote-failure-vocabulary.md)

## API-05 · `SessionEvent.ignorable` is restored, but the third-party write surface is still incomplete

- **Applies to**: Plugins that want to persist plugin state via `SessionEventMap` augmentation + `Session.append()`, or that implement persistence/reload/transport.
- **How it breaks**: alpha.2 restores `ignorable?: true` on the event envelope, but the public `Session.append()` still only accepts `type`, `data`, and `SurfaceIntent`, which is available to surface events only; it will not write `ignorable` into the event. So an out-of-repo custom type can live-append and persist fine, yet throw `SessionFormatUnsupportedError` on the next cold load, refusing to restore the whole Session. This is a silent write / loud read that one live smoke cannot catch.

### The dangerous legacy pattern

```ts
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'my-plugin/state': { readonly value: string }
  }
}

// 这行可能成功，但 alpha.2 的 append 不会为事件写入 ignorable。
session.append('my-plugin/state', { value: 'x' })
```

The envelope semantics of `ignorable` itself are still in effect: when a reader meets an unknown type, it may continue only if that event already carries `ignorable: true`; a missing field means required. The problem is that alpha.2 does not yet offer ordinary third-party producers a supported append/registration surface, and it cannot be bypassed with casts, thawing objects, or hand-editing JSONL.

### Best practice

1. On alpha.2, out-of-repo plugins should not persist state with a custom `SessionEventMap` + `Session.append()`; use a plugin-owned sidecar/store keyed by Session id.
2. When reusing an existing known event, reuse only its real, identical semantics; do not disguise plugin state as a model-visible or core event.
3. `ignorable: true` fits only auxiliary information where a reader without that plugin does not interpret the type and can still rebuild the Session correctly. Consumers may use it when the plugin is present, but its absence must not change core/durable Session semantics.
4. Persistence/transport owners must preserve existing markers end-to-end; unknown events without a marker keep failing closed.
5. Re-evaluate third-party persistent events only after upstream ships a supported `append(..., { ignorable: true })` or another formal mechanism that persists the omission-safety marker and decides compatibility without depending on the current composition. Registering an event name alone is not enough; do not write up the field restoration as if that capability had shipped.

### Verification

- For any existing custom append, run a real persist → process restart/cold load test; do not test only live append;
- If an out-of-repo plugin on alpha.2 hits this path, treat the cold-load refusal as a migration blocker and remove that persistence scheme rather than accepting or swallowing the error;
- Persistence/transport owners still need to cover “unknown events with a marker are readable” and “unknown required events without a marker are explicitly refused”.

- **Source**:
  [alpha.2 `SessionEvent` type](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/core/session/src/types.ts) ·
  [alpha.2 `Session.append()` implementation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/core/session/src/index.ts) ·
  [cold-load unknown event guard](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/session/session-persistence/src/coordinator.ts) ·
  [implementation decision restoring ignorable](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/.agents/notes/implemented/architecture/2026-08-30-retain-ignorable-external-session-events.md)

## API-06 · The Headless argv and process output contract

- **Applies to**: CLI wrappers, CI runners, subprocess bridges, stdout/stderr parsers.
- **How it breaks**:
  - `dsh headless ...` and `dsh --profile headless -p ...` are not command shapes of the target version;
  - `JSON.parse` on stdout fails on ordinary final text;
  - Treating any non-empty stderr as failure misreports successful runs that contain reasoning;
  - Ignoring the exit code treats runs with no completed turn or direct startup failures as success.

### Correct invocation and interpretation

```sh
dsh --profile headless "run the tests"
```

Launcher flags must come before the task; everything after the first non-launcher token belongs to the app/task:

```sh
dsh --profile headless --patch ./plugin.patch.yml "verify the plugin"
```

Do not write `dsh --profile headless "verify the plugin" --patch ...`; `--patch` would then go into the task text instead of being a composition overlay.

| Channel | alpha.2 contract |
|---|---|
| stdout | Final assistant text; not JSONL, no intermediate tool output |
| stderr | Non-empty reasoning deltas start with `dsh: reasoning:`; failures are `dsh: <code>: <message>` |
| exit 0 | Task completed |
| exit 1 | Abort, error, or no completed turn |

Also, `SIGINT` maps to 130; the alpha.2 supervisor maps an ordinary `SIGTERM` stop to 0. Callers should still record the termination signal instead of guessing the state from stderr text alone. `--dump-config` is a composition check that does not start the app and cannot carry task/app args.

### Best practice

1. Use argv arrays with `spawn`/`execFile`; do not shell-concatenate a user task.
2. The exit code is the success criterion; stderr is the controlled reasoning/diagnostic stream. Reasoning can be sensitive — state log retention and access scope explicitly.
3. Consume stdout and stderr concurrently; handle cancellation, signals, spawn errors, and teardown. Do not wait for process exit before reading pipes that may fill up.
4. Default verification uses a stub subprocess and does not require a real API key or model calls.

### Minimal stub matrix

| Scenario | stdout | stderr | exit | Expected |
|---|---|---|---:|---|
| Ordinary success | final text | empty | 0 | success |
| Reasoning success | final text | `dsh: reasoning: ...` | 0 | success; reasoning shown/logged separately |
| Task failure | empty or newline | `dsh: <code>: ...` | 1 | failure |
| Spawn error | none | local diagnostic | none | wrapper reports startup failure and tears down |

- **Source**:
  [alpha.2 Headless README](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/bundle/headless/README.md) ·
  [rc.2 Headless README](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/packages/bundle/headless/README.md)

## API-07 · Package export ≠ artifact presence

- **Applies to**: Plugins that import from `@deepseek-ai/*/src/*`, `/internal`, or other deep subpaths.
- **How it breaks**: checking only the source checkout's `package.json#exports` can make a path look publicly available, but the actual registry tarball does not contain the target file, so after installation you get `ERR_MODULE_NOT_FOUND`, a bundler resolution failure, or missing `.d.ts`.

The alpha.2 `@deepseek-ai/dsh-client-ui-conversation` is a typical risk signal: its export map contains `"./src/*": "./src/*"`, but `files` lists only `lib/index.js`, `lib/invariant.js`, `lib/client.js`, and `lib/types/**/*.d.ts`. So “it is in the export map” by itself does not prove the registry artifact resolves a raw source subpath.

| Break boundary | Typical symptom |
|---|---|
| File physically exists, but the subpath is not in `exports` | `ERR_PACKAGE_PATH_NOT_EXPORTED` |
| `exports` declares the target, but the target did not make it into the tarball | `ERR_MODULE_NOT_FOUND` |
| Runtime `.js` exists, but the matching types target / `.d.ts` is missing | TypeScript or bundler type-resolution failure |
| Manifest declares `dsh.bundle.patch`, but the patch did not make it into the tarball | The install is recognized, but the Loader/dump fails with a missing file when reading the overlay |

### Best practice

1. Evidence order: installed/packed artifact of the target → exports and declared types at the target tag → target implementation and tests → release notes/historical notes.
2. Prefer entry points the package owner explicitly maintains, such as `.`, `/client`, `/types`, `/remote`.
3. When a raw source seam must be kept, pin the exact target version, check the pack file list, and treat it as a high-volatility coupling; do not automatically call something private because it has `src`, nor publishable because an export map exists.
4. After typecheck and a source-checkout build pass, also run one package smoke against the actual tarball/install directory.

### Verification

- Check `package.json#exports` and `files` before building;
- Generate a pack manifest with the repository's existing package manager (for example, audit build requirements first, then run `npm pack --dry-run --json --ignore-scripts`); unknown lifecycle scripts are not executed without authorization;
- Install/resolve the actual artifact from a clean temp directory and verify that both the runtime JS and `.d.ts` exist;
- If the manifest declares `dsh.bundle.patch`, verify item by item that the target patch is also in the pack manifest and the tarball;
- Do not switch the package manager or lockfile as a side effect of the migration.

- **Source**:
  [alpha.2 ui-conversation package manifest](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/client/ui-conversation/package.json)

## API-08 · `cordis.patch.yml` is composition, not a source patch

- **Applies to**: Migration tools that scan `patch`, `patch.yml`, `cordis.patch.yml`, or Loader rows.
- **How it breaks**: judging a normal Profile composition as a monkey/source patch by filename alone leads to rebasing source hunks that do not exist, deleting valid bundle rows, or wrongly modifying host source.

### Best practice

1. Classify `cordis.patch.yml` by default as the official Loader composition overlay for a DSH Profile/Bundle.
2. Only enter the “source patch” migration when there is evidence such as a real diff, `patch-package`/`patchedDependencies`, a replaced host implementation, or direct writes to published artifacts.
3. Composition migrations check row, id, inject, and config-replacement semantics; source-patch migrations check the target file, semantic markers, the composed result, and behavior tests. The two use different verification paths.
4. When publishing as a Bundle, the manifest's `dsh.bundle.patch` must point to a safe in-package relative path, and that `cordis.patch.yml` must actually make it into the packed artifact; Node `exports` cannot replace this boundary.
5. When a patch row matches an existing `id`, `config` is the whole replacement, not a deep merge; later layers override earlier ones, so rewrite every config field that must be kept.

On alpha.2, composition precedence, from lowest to highest, is:

1. Bundle patches listed in the Profile manifest's `dsh.profile.bundles` (in list order);
2. `$DSH_HOME/profiles/<name>/cordis.patch.yml`;
3. `$DSH_HOME/cordis.patch.yml`;
4. `--patch` overlays given on the CLI in argv order.

Later layers win over earlier ones. That is why migrating a high-level row requires looking at the full composed result first, not just its own YAML snippet.

### Verification

- An ordinary `cordis.patch.yml` fixture must be labeled a public/negative control by the scanner;
- Real `.patch`/source replacements are recognized and classified as clean apply, needs rebase, upstreamed-remove, or obsolete/conflicting;
- An `npm pack --dry-run --json --ignore-scripts` or equivalent no-scripts pack manifest confirms that the patch the manifest points to actually exists;
- Run `dsh --profile <name> --dump-config` with an isolated Profile and check layers, row id/name, whole-config replacement, and unmatched-target diagnostics, without starting the GUI or a model;
- Do not decide risk by hit count.

- **Source**:
  [cordis.patch.yml placement in the alpha.2 Headless bundle](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/bundle/headless/README.md) ·
  [official plugin publishing and patch composition docs](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/docs/user/develop/basic/publish.md) ·
  [alpha.2 CLI Profile/Bundle layer reference](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/apps/cli/reference/README.md)

## API-09 · Plugin inventory gains an optional `agentPresets`

- **Applies to**: Client plugins that consume `pluginInventory/list`, serialize `PluginInventorySnapshot`, or use a strict closed schema.
- **How it breaks**: a decoder that rejects unknown fields fails when alpha.2 sends `agentPresets`; hand-rebuilding the whole object can silently drop that field and future extensions.

### Best practice

- Treat `agentPresets` as an optional field; when absent, keep the old `entries` view.
- Only parse `trust`, rows, and `boolean | 'conditional'` enablement when preset grouping needs to be displayed.
- Decoders stay forward-compatible with new fields; business writes back only patch the paths they own instead of overwriting the whole object.

### Verification

- The field may be absent when there is no preset roster;
- Multiple presets and conditional rows parse;
- The old `entries` behavior is unchanged, and round-trips do not drop unknown fields.

- **Source**:
  [alpha.2 PluginInventorySnapshot type](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/host/plugin-inventory/src/types.ts)

## API-10 · Web Client runtime unbundling, keyed chat snapshots, and command attachment parameters

- **Applies to**: Plugin source repositories that still depend on `@deepseek-ai/dsh-client-runtime/client`, consume session transcripts, extend chat command rows, call Workspace navigation (`connectWorkspace` / `pickDirectory`), or call the Host `ctx.commands.execute` directly.
- **How it breaks**: `dsh-client-runtime` has been removed since alpha.1. Changing `ClientContext` to the Cordis `Context` alone is not enough: the client facets merged into Context come from their owning packages; without direct type dependencies, `skipLibCheck: true` can silently propagate `useChat` selectors or callback parameters to `any`. On alpha.2, `ChatSnapshot.nodes` is a keyed store, not the old `ConversationNode[]`; Host command execution also gained image attachments between `line` and `signal`.

### Exact mapping

| rc / runtime aggregation surface | alpha.2 owning surface |
|---|---|
| `ClientContext` | `Context` from `@deepseek-ai/cordis`, plus `type {}` augmentations imported from owning packages per actual use |
| `SessionId` | `@deepseek-ai/dsh-session/types` |
| `ConversationNode` | `@deepseek-ai/dsh-client-ui-conversation/client` |
| `CommandRowProps` | `@deepseek-ai/dsh-client-ui-chat/client` |
| `useSession(session => session?.nodes)` | `useChat(chat => ...)` |
| `ConversationSnapshot.nodes[]` | Iterate `ChatSnapshot.order` in order, calling `snapshot.nodes.get(id)` per id |
| `ctx.commands.execute(agent, line, signal)` | `ctx.commands.execute(agent, line, [], signal)`; pass real attachments when there are images |
| `IWorkspaces.connectWorkspace` / `startSession` / `pickDirectory` / `listDirectory` / `createDirectory` | `ctx.uiWorkspace` from `@deepseek-ai/dsh-client-ui-workspace/client`; list/CRUD stay on `ctx.workspaces` ([DSH-0.1.2-A1-32](v0.1.2-alpha.1.md)) |
| `workspaces.list` `baselinesReady` / `recentWorkspaceId` | `phase === 'ready'` on both the workspace and session lists; recency is derived from the current session, then `updatedAt` |

`snapshot.legacy.nodes` is only for staged compatibility with an explicit dual-host requirement; it should not become the new primary data surface for alpha.2-only plugins. The minimal read shape for alpha.2-only:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'

function orderedNodes(snapshot: ChatSnapshot) {
  return snapshot.order.flatMap((id) => {
    const node = snapshot.nodes.get(id)
    return node ? [node] : []
  })
}

export function useOrderedNodes(ctx: Context) {
  return ctx.useChat((chat) => chat ? orderedNodes(chat) : [])
}
```

To read an assistant step's final node, narrow by discriminant to `type === 'assistant-step'` and then read `data.finalNode`; do not mask old array fixtures in tests with `as unknown as ChatSnapshot`.

### Type composition and dependency ownership

1. List only the client services the runtime actually needs injected by the host in `dsh.client.inject`; remove the no-longer-existing `dsh-client-runtime`.
2. The owner of any declaration the source directly imports/consumes must be the plugin's own direct dev/peer dependency. A published package's `devDependencies` are not transitively installed for consumers; for example, ui-chat's declarations reference types from `dsh-client-store`, ui primitives, session/commands/conversation, and so on.
3. Activate Context augmentation with type-only imports and add only the owning packages actually hit; do not rely on the old runtime aggregation package or accidental hoisting.
4. On first migration, run `tsc --skipLibCheck false` (or an equivalent temporary config) at least once to locate the missing declaration chain, then restore the repository's existing policy. Any newly introduced implicit `any` is a migration failure, not an ignorable warning.

### Verification

- The lockfile contains no old cohort or `dsh-client-runtime`; all DSH packages land on the exact target cohort;
- `skipLibCheck: false` diagnostics show no missing declarations; the formal typecheck/build passes with no new implicit `any`;
- Client tests use the real `ChatNodeStore` shape (`order` + keyed `get`), covering missing ids and the assistant final node; the Host command test asserts the third-argument images (`[]` when there are none);
- After packing, check the tarball name and the plugin's own version in the manifest, then run the full Web chain in an isolated profile: token→Cookie, boot entry, advertised resources, registration/mount, and remove.

**Source**: [rc.2 runtime aggregation exports](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/packages/client/runtime/src/client/index.ts) · [alpha.2 ChatSnapshot / ChatNodeStore](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/client/ui-chat/src/client/contract/snapshot.ts) · [alpha.2 `useChat` and `CommandRowProps`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/client/ui-chat/src/client/contract/slots.ts) · [alpha.2 client slot base Context augmentation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/client/ui-slots/src/index.ts) · [alpha.2 Host commands `execute`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/interaction/commands/src/index.ts) · [alpha.2 ui-chat package declarations](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/client/ui-chat/package.json)

## CFG-01 · Code Mode migrated exactly to PTC mode

- **Applies to**: Plugins/wrappers that read the tool presentation mode, preset id, dispatch type, or prompt rules.
- **How it breaks**: `tools.mode: 'code'`, preset `code`, `CodeDispatch*`, or `tools:code-only` no longer match; a global replace of `code` would also break `run_code`, parameter names, and historical events.

### Exact ledger

| Old value | New value |
|---|---|
| `tools.mode: 'code'` | `tools.mode: 'ptc'` |
| preset id/directory `code` | `ptc` |
| `tools/code-dispatch-log` | `tools/ptc-dispatch-log` |
| `CodeDispatch*` | `PtcDispatch*` |
| `tools:code-only` | `tools:ptc-only` |
| UI copy `Code Mode` | `PTC mode` / `PTC 模式` |

Unchanged: `run_code`, its `code` parameter, `CodeSdkLanguage`, `CodeRunFailedError`, the `dsh-code-runtime*` packages, the persistent `tool/code-dispatch*` events, the `tools-code-mode` plugin name, and `:code:` in sub-call ids.

- **Verification**: the target configuration accepts the new values; old Session logs still load; every remaining legacy token is explainable as an explicit keep, with no blind global replace.
- **Source**:
  [alpha.1 PTC rename ledger](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/.agents/notes/implemented/architecture/2026-08-25-rename-code-mode-to-ptc.md)

## Structure the skill should use for this kind of migration report

Do not just output “the API needs upgrading”. For every real hit, provide at least the following fields:

```markdown
### <接口名>

- 当前证据：<文件:行、当前 package/resolved version>
- 旧写法：<精确 import / signature / config>
- 会怎么炸：<typecheck diagnostic、runtime failure 或行为漂移>
- 目标写法：<精确 tag 下可编译的最小示例>
- Best practice：<lifecycle、error、face、packaging 边界>
- 验证：<成功、失败、取消、teardown 或 artifact smoke>
- 一手来源：<目标 tag 的 exports/type/source/test URL>
```

Final summary table:

| Hit location | Old interface | Typical symptom | Target interface | Required / conditional change | Verification status |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

If the actual types at the target tag conflict with this document, the target tag wins and the conflict must be flagged as a knowledge-base gap; do not break compilable code just to “fit a card”.

## Minimal validation ladder

1. **Static inventory**: exact package/resolved version, imports, exports, removed symbols, Remote namespaces, and face;
2. **typecheck/build**: use the real Context/projection, not `any`;
3. **Focused tests**: success/domain failure/cancel/assembly fault for each unary, and snapshot/reconnect/teardown for streams;
4. **Artifact smoke**: resolve entries and types from the actual pack/install artifact;
5. **Headless-safe Loader/config smoke**: use an isolated `DSH_HOME`/temporary Profile, no credentials required;
6. **Behavior verification after explicit authorization**: start a real Profile, GUI, long-running service, or model calls only when the user asks and provides the environment.

Every report must distinguish “typecheck passed”, “Loader mount passed”, and “real behavior passed”; the three are not the same completion state.
