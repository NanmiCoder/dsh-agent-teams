---
name: dsh-plugin-development
description: An execution-oriented Skill for developing, maintaining, distributing, and verifying DeepSeek Harness (DSH) plugins. Covers host/client shape detection, bundle/profile contracts, Service and function plugins, tools, HTTP, persistence, slots, Conversation Nodes, client builds, HMR, GitHub installation, and real composition verification.
metadata:
  version: "3.1.0"
  date: "2026-08-13"
  reference: "https://github.com/NanmiCoder/dsh-agent-teams"
---

# DSH Plugin Development

This is an execution checklist oriented to the release version. First determine the runtime surface, then choose the official template; after implementing, you must verify against a real composition and the user install path. Don't treat one project's incidental implementation as a framework contract.

## 1. Before you start

1. Use `pwd`, `git rev-parse --show-toplevel`, `git status --short --branch` to confirm the project and the user's changes.
2. Read `package.json`, `cordis.patch.yml`, `tsconfig*.json`, build config, relevant `src/`, and tests.
3. Don't overwrite the user's changes; don't touch profiles, ports, or instances the user explicitly excluded.
4. Determine the minimal runtime surface:
   - tools, system prompt, HTTP, persistence, provider: host.
   - slots, Conversation Nodes, browser state and floaters: client.
   - host capabilities needing Web visualization: host + client.
   - no Web need: don't declare `dsh.client` and don't build a client bundle.
5. Write down the plugin's single responsibility, the services it depends on, the config rows it contributes, the persistence owner, and the user-visible verification surface before coding.

## 2. Evidence and official references

### 2.1 Evidence-gathering order

When behavior is uncertain, gather evidence in order — don't guess:

1. `package.json`, exports, types, README of the current project and installed `node_modules/@deepseek-ai/*`.
2. The DeepSeek Harness checkout explicitly provided by the environment; read-only analysis, no modification.
3. Clone the official repository for evidence (see §2.3).
4. If information is still insufficient, use the current release exports/types as the boundary, choose a minimal implementation that fails safely, and annotate the assumptions.

Don't hardcode local absolute paths, and don't access or relay unauthorized private-repository content.

### 2.2 Choosing official templates

If a Harness checkout is available (provided by the environment or cloned per §2.3), read these templates by plugin shape first; paths are relative to the checkout root:

| Goal | Primary reference | Learning focus |
|---|---|---|
| Host Service / HTTP | `packages/host/webserver` | `Service`, `static Config`, `Service.init`, route disposer, connection cleanup |
| Minimal client plugin | `packages/client/ui-message-feedback` | `inject`, `apply`, locale, per-session controller, slot registration and cleanup |
| Slot / Conversation Node | `packages/client/ui-conversation` + `packages/client/ui-slots` | `SlotMap`, slot kind/scope, children claiming, keyed node renderer |
| Bundle layering | `packages/bundle/base` + `packages/bundle/web-app` | top-level patch arrays, row id overrides, whole-section config replacement, load order |
| Simple persistence backend | `packages/storage/storage-json` | register → disposer → close, explicit root, concurrent-open gating |
| Crash-safe logging | `packages/session/session-persistence-jsonl` | atomic publish, fsync, concurrent no-clobber, torn-tail handling |
| Tool plugin | `packages/fs/tool-fs` | `defineTool`, schema, render, optional capability mounting |
| Client testing | `packages/test-support/client-runtime` | jsdom, SlotTestRuntime, mount/dispose, fake services |

Complex plugins are only supplementary evidence, not starter templates. When delegating read-only research, the prompt must require files, line ranges, contracts, and minimal suggestions.

### 2.3 Official repository fallback

The official repository `https://github.com/deepseek-ai/deepseek-harness` is a public, MIT-licensed, citable evidence source (default branch `master`; developer preview has no release tags, so no version pinning). When fallback evidence is needed:

1. Pick a temp directory: use one provided by the user or environment, e.g. `SCRATCH="$(mktemp -d)"`; don't hardcode local absolute paths.
2. Reuse an existing checkout: if `$SCRATCH/dsh-official` already exists, `git remote -v` points to the official repo, and the root contains `AGENTS.md` and `LICENSE`, reuse it; to update: `git -C "$SCRATCH/dsh-official" fetch --depth 1 origin master && git -C "$SCRATCH/dsh-official" reset --hard origin/master` (or delete and re-clone). Keep only this one directory per task to avoid repeated clones.
3. Shallow clone (read-only evidence, no `pnpm install` needed):

   ```sh
   git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git "$SCRATCH/dsh-official"
   ```

4. Only clone the official `deepseek-ai/deepseek-harness`; don't access or relay unauthorized private-repository content. Analyze the clone read-only too, no modification.

Once inside, orient:

1. Read the root `AGENTS.md` first (`CLAUDE.md` is its symlink): repo layout, commands, and conventions in one go — it's the official agent entry point.
2. Use the group table in `packages/README.md` to confirm which `packages/<group>/<pkg>` the target package lives in.
3. Read the corresponding package's `README.md` and `src/` per the §2.2 template table; evidence conclusions give files and line ranges.

Evolution fallback: the official repo is in developer preview, iterating extremely fast, with no compatibility promises and no release tags; the §2.2 template paths are only an index — everything defers to the actual code in the current checkout; when paths or names drift, locate the new position with `packages/README.md` and report the correction, don't guess from old docs. Record `git rev-parse HEAD` when reproducible evidence is needed.

## 3. Bundle, Profile, and package contracts

### 3.1 Two concepts

- A **Bundle** is the package the author distributes: `package.json.dsh.bundle.patch` points to a config layer.
- A **Profile** is the composition the user runs: `$DSH_HOME/profiles/<name>/package.json.dsh.profile.bundles` holds the ordered bundle list.
- Plugin authors write bundles; `dsh plugin` creates and maintains profiles. Don't hand-edit user profile manifests.

### 3.2 Minimal two-sided package

```jsonc
{
  "name": "dsh-my-plugin",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md"], // either directories or explicit lists; the official repo commonly uses explicit file lists
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-runtime"]
    }
  }
}
```

Rules:

- Host-only packages remove `./client` and `dsh.client`.
- Client packages must have both `dsh.client.platform: "web"` and a really existing `exports["./client"]`.
- `dsh.client.inject` is informational metadata sent with the graph (for preflight display / HMR diffs); it doesn't decide the client fiber's activation order; prefetch is driven by `dsh.client.immediately`, and the real dependency wait comes from the `export const inject` the client bundle exports (§5.1) — the two don't replace each other.
- `dsh.client.immediately` is an optional prefetch marker only for boot-critical entry points; ordinary third-party plugins shouldn't enable it by default.
- The current authoritative field is `dsh.client`; legacy compatibility fields are only added when the target release deployment explicitly still reads them.
- exports, `files`, and Git/publish artifacts must be consistent; no entry may point at a nonexistent file.
- Shared runtimes like DSH, Cordis, React should be declared as peers first to avoid duplicated runtime identity; version ranges come from evidence in the target release package metadata.

### 3.3 Patch layers

`cordis.patch.yml` must be a top-level array:

```yaml
- insert:
    - id: my-plugin
      name: dsh-my-plugin
      config: {}
```

Notes:

- `id` is the stable row identity in the config tree; `name` is a Node-resolvable package name or export path.
- Later layers override earlier ones by `id`; the target row's `config` is whole-section replacement, not a deep merge, so restate the needed keys when overriding.
- Effective order is profile bundles → profile `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → command-line `--patch`; the latter wins.
- A package without `dsh.bundle` only becomes an ordinary dependency, never automatically a profile layer.

## 4. Host-side implementation

### 4.1 Function plugins

An ordinary plugin usually exports:

```ts
export const name = 'my-plugin'
export const inject = ['tools']
export interface Config { enabled: boolean }
export const Config = z.object({ enabled: z.boolean().default(true) })
export function apply(ctx: Context, config: Config): void {}
```

- `z` is imported from `@deepseek-ai/schemastery` (not zod); `static Config = Config` references the exported schema, equivalent to the official inline `static Config: z<Config> = z.object({...})`.
- `inject` is a required service; when unsatisfied the fiber stays pending and the framework activates it once the service is ready — don't simulate dependency injection with polling.
- Config defaults go in the schema; any value a deployment might need to change should be config, not a source constant.
- Optional services use `ctx.get()` checks or lazy mounting via `ctx.inject([...], childCtx => ...)`; don't race sibling providers inside `apply()`.

### 4.2 Service plugins

When a plugin provides a stable service, reference `host/webserver`:

```ts
export class MyService extends Service {
  static Config = Config
  constructor(ctx: Context, config: Config) {
    super(ctx, 'myService')
  }
  async [Service.init](): Promise<void> {}
}
```

- The constructor declares the service key; async startup goes in `Service.init`.
- Init failures should fail the fiber and be reported by the starter, not swallowed as composition errors.
- Registration methods return disposers; the party owning the resource is responsible for closing it.

### 4.3 Effect ownership

All long-lived resources must belong to the current fiber:

- routes, listeners, watchers, timers, React roots, DOM, sockets, temporary services must all be cleanable.
- Use `ctx.on()` or `ctx.effect(() => disposer, label)`.
- Disposer order is usually: stop external entry points / unregister registries → wait for or cancel in-flight work → close resources.
- For services that bind later, use "try immediately + retry on service event/`ctx.inject` + idempotent guard", don't register twice.

### 4.4 Tools

Use `ctx.tools.register(defineTool(...))`:

- `description` must state when to call, necessary prerequisites, failure semantics, and side effects.
- Both `parameters` and `output.schema` use the `@deepseek-ai/dsh-tools` value-schema DSL (a supported JSON Schema subset after compilation): `parameters` is an implicitly open object root, required fields inline `required: true`; `output.schema` declares the canonical return value and is validated at registration by `assertSupportedJsonSchema`. They are two faces of the same DSL, not two languages.
- `output.render` gives the model stable, compact, decidable text.
- Get the current session, workspace, and owner from `exec.agent`, never guess from global process state.
- Async work observes or forwards `exec.signal`; write operations need idempotency, locks, or conflict strategies.

### 4.5 HTTP

- Inject the current release Web server service and decouple with a minimal structured interface.
- Routes register via `ctx.effect(() => ctx.webServer.register({ kind: 'exact' | 'prefix', path, handler }))`; duplicate (kind, path) throws.
- State interfaces set cache policy explicitly: sensitive or real-time snapshots prefer `Cache-Control: no-store`, revalidatable resources use `no-cache`; static assets use an explicit allowlist and correct content type.
- path decoding, request-body parsing, and handler rejections must all convert to explicit 4xx/5xx, never become unhandled rejections.
- exact routes, longest prefixes, and fallback ownership must not conflict; unknown plugin assets return 404, never fall into the SPA fallback.
- For permissions or local capabilities, use minimal exposure, loopback/trust boundaries, and method allowlists.

### 4.6 Persistence and concurrency

First decide whether to reuse the release storage/session persistence service or own a separate medium. Either way:

- Paths are configured explicitly; don't scatter user data with `process.cwd()` defaults.
- State has clear isolation dimensions by workspace, session, owner, or business id.
- Read-modify-write on the same resource is serialized; concurrent creation uses no-clobber semantics.
- Human-readable JSON uses same-directory temp file + fsync + atomic publish; append logs handle torn tails. Concurrent creation uses the `link()`+`unlink()` no-clobber protocol, not `rename()` silent overwrites.
- Registry backend cleanup order is unregister, then close.
- Recovery and HMR must not assume creation events replay; explicitly scan and backfill existing objects when needed.

## 5. Client-side implementation

### 5.1 Minimal entry

```ts
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

export const inject = ['slots']
export function apply(ctx: ClientContext): void {}
```

- Type contributions use type-only imports to pull in Context/SlotMap merges.
- Client registrations, controllers, listeners, styles, and DOM must all dispose with the client fiber.
- per-session state is bucketed by `SessionId`; on connection reset, only resync objects already read.

### 5.2 The four-step slot contract

1. **Declare**: pull types in from the official package providing the slot; only custom owners extend `SlotMap` via module augmentation.
2. **Claim**: the parent entry's `children` table declares child slots; declaring claims the render right — don't fight over someone else's seat.
3. **Register**: owner and contributor activation order isn't guaranteed; use `ctx.slots.inject(key, () => ctx.slots.register({ name, children?, store?, locale?, inject?, ...kind params }, Component))` to wait for the declaration; `children` is simultaneously the claim table for child slots (claiming = owning the render right). Kind params: keyed requires `key`, list requires `id` (can add `order`/`label`), chain requires `select`; single/keyed/list can add `priority` for cell hiding (same cell + same priority throws). Registering directly to an undeclared slot throws.
4. **Render**: owners use `renderSlot`/`renderSlotChain`; contributors don't import the owner's implementation components.

Check the current release types before choosing a seam. Common session UI seams include: `conversation.session.header.actions`/`.utilities`, `conversation.view`, `conversation.chat.node`, `conversation.chat.commandview`, `conversation.chat.assistant-actions`, `conversation.chat.turnTail`, `conversation.input.dock`, `conversation.composer.dock`, `conversation.composer.bar`, `conversation.input.left`/`conversation.input.right`/`conversation.input.plan`/`conversation.input.model`. Global floaters use `shell.overlay` (list/root), never touch the `root` single slot. Don't write slot names from old docs alone — the authority is the current release `ui-conversation/src/client/contract/slots.ts` SlotMap.

### 5.3 Conversation Nodes

A Conversation Node is the combination of "event folding + keyed slot renderer":

1. Define shared event types and merge them into the session event map.
2. `conversationEvents.register(definition)`:
   - `match` selects events;
   - `start` creates node state;
   - `update` folds deterministically by seq;
   - `buildViewNode` produces a stable view node.
3. Merge `ChatNodeDataMap`/node kind types.
4. Register a renderer with the same key into `conversation.chat.node`.

Red lines:

- Replaying the same event sequence must produce the same node; don't read time, random numbers, or current disk state.
- `match` returns a stable business id and a `start|update` role; the node engine deduplicates within the current session using `conversationContextKey(kind, businessId)`. Cross-session persistent caches additionally fold the owner session into the key; don't conflate that into the engine contract.
- Events are written into the business owner session; shared host/client event files stay type-only, ideally zero runtime imports, to avoid dual-tsconfig Context augmentation cross-contamination.
- Disk/server snapshots can be the real-time UI truth; the event stream is for conversation projection, audit, and deterministic history — don't confuse the two responsibilities.

### 5.4 Portal fallback

Prefer a semantically correct slot over a fixed portal. Full-app floaters register `shell.overlay` first (list/root, click-through until your entry actively enables pointer events); only when no global corner slot exists use a body portal:

- React root, host DOM, window listeners, and global attributes all have disposers.
- Follow the session list, filter by the current owner; collapse immediately on navigation.
- On wide screens let the main column yield, narrow screens fall back to overlay; rely only on stable `data-*` attributes, don't couple to hashed classes.
- Restored activity on first paint shows only the badge, avoiding large layout shifts from auto-expanding right after the first request returns; new activity that appears after settling auto-expands.
- The panel is limited to a fraction of the container/viewport height with internal scrolling; narrow screens get their own cap.
- Polling uses `no-store`, an in-flight guard, response shape validation, and unmount protection; on failure keep the last successful snapshot.
- Support keyboard, `:focus-visible`, `aria-*`, Escape, reduced motion; hover/focus only previews, click pins state.

## 6. TypeScript and client builds

### 6.1 Dual tsc programs

Host and client use two programs; file names can follow the project layout. The official repo uses `tsconfig.host.json` and `tsconfig.client.json` as two aggregate programs for host/client checking respectively: host excludes `packages/client/*/src/**` and `*.client.*` tests; the client aggregate includes each client package's CSS module declarations, client tests, and build scripts, shared leaves enter via project references, and each `packages/client/*` package also maintains its own composite tsconfig for in-package type checking. JSX uses `.tsx` and `react-jsx`; relative TS imports must rewrite correctly to emitted JS.

This avoids declaration-merge conflicts between the host session and the browser runtime for same-named Context services.

### 6.2 Client bundles

Prefer reusing the current release Harness client tsdown helper or a verified template; don't hand-write loader protocols. The build should automatically wrap the output as:

```js
window.__ModuleLoader__.load({ id, factory: (require) => { /* bundle */ } })
```

The build must preserve:

- host/client halves coexisting (the client build doesn't clear host output);
- sourcemaps;
- CSS Modules compilation and `style[data-plugin]` injection;
- path fallback from emitted `lib/` back to `src/` assets;
- the client bundle purity gate.

### 6.3 Client import purity

The browser module table only answers release platform seed modules and explicit exemptions. Rules:

- Platform modules follow the release `packages/client/web/src/platform.ts` and official client build config; React, Cordis, slots, web-react, primitives, attachment, schema-form etc. are provided by the module table.
- `@deepseek-ai/dsh-client-runtime/client` is an explicitly marked temporary exemption in the official build config, not an ordinary platform module; don't generalize it into a license to import arbitrary runtime values.
- Pure type imports are erased and may pull in type contributions across packages.
- Wire types, generated remote codecs, or explicitly vendored pure libraries may only be inlined when official templates allow it.
- Other cross-plugin value imports are forbidden; collaboration must go through cordis services/remotes/slots. Otherwise the build-time purity gate or the runtime require fails.

## 7. Distribution, installation, and activation boundaries

### 7.1 Installation

`dsh plugin --profile <name> <args...>` is a pnpm forwarding layer in the profile directory; on success it reconciles the bundle list by install state and `dsh.bundle`. So npm, paths, tarballs, and Git are all supported:

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile web add github:<owner>/<repo>
```

GitHub distribution doesn't require publishing to npm, but you must choose a build strategy (Git fetches source, not build artifacts):

- **Official recommendation**: provide a self-contained `prepare` (the official turtle-ui pattern); pnpm ≥10 blocks Git dependency build scripts by default, so the user must explicitly `allowBuilds` in the profile's `pnpm-workspace.yaml` and re-run `add`. This executes third-party code, so pin the commit and only trust reviewed repositories.
- **Alternative (no-interaction install)**: commit the complete, up-to-date `lib/` that exports point to into Git; users don't execute dependency scripts, but it's not the officially recommended path.

The README only gives recommended commands verified against a fresh profile. Restart the target profile after installing.

### 7.2 HMR and restarts

- Client HMR needs a build watcher like `tsdown --watch` continuously rewriting `lib/client.js`; host HMR only stat-detects file changes, then triggers browser fiber dispose/reload via rev/SSE.
- Only bundle content changes can client-HMR; package manifest, exports, plugin sets, profile bundles, and host code changes require a restart.
- After an ordinary build with no watcher, refresh the existing DSH page.
- Don't start a standalone Vite server to replace the DSH GUI; the web shell depends on the host-injected `window.__DSH_BOOT__`.

## 8. Verification matrix

### 8.1 Baseline

```sh
pnpm typecheck
pnpm build
pnpm test             # run when package.json declares it
pnpm verify           # run when package.json declares it
git diff --check
```

Read `package.json.scripts` first; don't assume every repo has same-named aggregate scripts: official Harness uses `check:ci`/`check:all` and multiple `verify-*` gates; third-party plugins may define their own `verify`. Project-level verify/check covers at least:

- pure business rules and state transitions;
- file round-trips, locks, archive/restore in temp directories;
- client-side independently testable projection/folding pure functions;
- canonical Skill and mirror consistency (when the project provides a mirror).

### 8.2 Host and real composition

- Unit tests cover schemas, services, failures, and disposers.
- Use shared contract suites when a registry/backend interface exists.
- Don't only hand-roll `ctx.plugin()`: at least one test boots via a real Loader/patch composition and asserts a user-visible surface.
- First create a non-built-in scratch profile with `dsh plugin --profile <scratch> add <pkg>`, then run `dsh --profile <scratch> --dump-config` to confirm bundle layers, row ids, names, configs, and injection order; built-in `web`/`headless` profiles can be initialized by the launcher. There's also `--dump-default-config`: prints only bundle layers, skipping user layers and `--patch`, useful as a recovery diagnostic for a broken `cordis.patch.yml`.
- Real tasks use `dsh --profile headless "a small, decidable task"`; don't invent a `dsh run` subcommand.

### 8.3 Client

- Client tests use the jsdom lane; mount the plugin via SlotTestRuntime or minimal fake services.
- Assert slot registration, rendering, session isolation, connection reset, and that registry/DOM/style/controller are all cleaned up after dispose.
- Every registry contribution has at least one HMR/dispose safety test.
- GUI uses an independent web profile and a real browser, verifying roster, routes, interactions, refresh, wide/narrow screens, scrolling, focus, and reduced motion.

### 8.4 Fresh install and Git distribution

1. Use a fresh temporary `DSH_HOME`/profile.
2. Install with the README's exact commands.
3. Assert the profile dependency and `dsh.profile.bundles`.
4. Assert all exports, host/client bundles, patches, and static assets exist.
5. `--dump-config` must show the plugin layer.
6. After startup, check the host route, client roster, and real UI.

While the repo is still private, copy the to-be-published content into a temporary Git repo and commit it, then install via `git+file://...`; this verifies "what Git fetches" rather than the current checkout's uncommitted files. Prerequisites: `git` on PATH, the directory is a committed real Git repo; if the package declares `prepare`, also add `allowBuilds` to the profile's `pnpm-workspace.yaml` (the same gate as §7.1). Only delete the exact temporary directories this task created.

## 9. Completion criteria

Confirm each item before finishing:

- Minimal runtime surface; manifest, exports, patch, and artifacts consistent.
- Required inject and optional service boundaries clear; pending/failed states diagnosable.
- Routes, registries, timers, watchers, DOM, React roots, and storage all cleanable.
- Conversation Nodes replay deterministically, with correct owner and deduplication dimensions.
- Client imports don't cross the module table; host/client types isolated.
- Persistence has concurrency and crash semantics, not dependent on incidental cwd.
- typecheck, build, verify, real composition, fresh install, and required GUI verification pass.
- README install commands match the actual distribution shape.
- No unauthorized commit, push, publish, or visibility change.
