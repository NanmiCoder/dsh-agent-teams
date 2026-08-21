# Developing a DeepSeek Harness (DSH) plugin from scratch

> This document distills the full development experience of the dsh-agent-teams plugin (host tools + browser activity panel + conversation card).
> It covers the complete flow of a bundle plugin — skeleton, host side, client side, build, install, and pitfall fixes — so a coding agent can follow it directly.
> Reference implementations: `dsh-agent-teams` (the finished product), DSH repo `packages/workflow/tool-workflow` (tool plugin template),
> `packages/client/tsdown.client.ts` (client bundle protocol), `packages/bundle/base|cordis.patch.yml` (host composition),
> `packages/client/modules/src/index.ts` (browser roster scan), `packages/client/ui-workflow-run` (conversation UI template).

## 0. Overview: what a DSH bundle plugin is

An installable plugin = an npm package playing two roles at once:

- **Host side** (Node): the package root's `lib/index.js`, mounted as one plugin row in the composition tree, registers tools, services, HTTP routes, and session events.
- **Client side** (browser): the package subpath `./client` (`lib/client.js`), scanned by `dsh-client-modules` into the
  `window.__DSH_BOOT__` roster, runs `apply(ctx)` in the browser as a cordis plugin, and renders UI.

Installation = `dsh plugin --profile <profile> add <package path or name>`: pnpm installs it into the profile and adds the package to
the profile manifest's `dsh.profile.bundles` layer list; the bundle's `cordis.patch.yml` acts as a patch layer inserting the plugin row into the composition tree.
**After `plugin add` you must restart the profile**, because the package manifest/bundles layer and client package metadata are cached in-process;
however, a user `cordis.patch.yml` while the service is already running is re-read transactionally by boot HMR, and can update config and mount/unmount patch rows.

## 1. Plugin shape and project skeleton

```
dsh-my-plugin/
├── package.json          # dsh.bundle + dsh.client + exports
├── cordis.patch.yml      # inserts the plugin row into the host composition
├── tsconfig.json         # host compile (excludes src/client)
├── tsconfig.client.json  # client compile (jsx: react-jsx)
├── tsdown.config.ts      # client bundle build (replicates the tsdown.client.ts protocol)
├── src/
│   ├── index.ts          # host entry: name/inject/Config/apply
│   ├── tools.ts          # tool registration (optional, large plugins split files)
│   ├── events.ts         # session event writing (optional)
│   ├── event-types.ts    # event types + SessionEventMap merge (zero imports!)
│   ├── snapshot.ts       # host-side data assembly (optional)
│   ├── state.ts          # file persistence (optional)
│   └── client/
│       ├── index.tsx     # browser entry (must be .tsx to write JSX!)
│       ├── XxxPanel.tsx  # UI components
│       ├── *.module.css
│       └── artwork.ts    # shared pure logic (optional)
├── assets/               # static assets shipped with the package (allowlisted route serving)
└── scripts/verify.mjs    # offline smoke verification
```

### 1.1 package.json essentials (why each field exists)

```jsonc
{
  "name": "dsh-my-plugin",
  "type": "module",                          // ESM full-stack
  "main": "lib/index.js",                    // host entry (tsc output)
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["lib", "assets", "cordis.patch.yml", "README.md"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },   // bundle declaration: the patch mounts the host row
    "client": { "inject": ["@deepseek-ai/dsh-client-runtime"], "platform": "web" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json && tsc -p tsconfig.client.json && tsdown",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit"
  }
}
```

- `exports["./client"]` is a hard requirement for roster scanning: `client-modules` reads `exports["./client"]` to find the browser bundle
  (string or a one-level conditions object with a string `default`; `types` doesn't participate in runtime resolution); a missing one rejects the package outright.
- `dsh.bundle.patch` lets `dsh plugin add`'s reconcile recognize this as a bundle and add it to the bundles layer.
- `dsh.client` is the authoritative client manifest in the current source; `platform` must be `"web"`. Package metadata and negative conclusions are cached by name,
  so after adding/removing a client declaration or fixing an export you must restart the host. If an older deployment differs, check its source before writing a compatibility declaration.
- `peerDependencies`: host-side deps (`@deepseek-ai/dsh-tools`, `dsh-session`, `dsh-subagent`…) plus browser-side
  (`@deepseek-ai/dsh-client-runtime`, `dsh-client-ui-slots`, `react`) are all peers, resolved at runtime from the profile's
  `node_modules` (healProfilesModuleFallback flat directory), not duplicated.
- `files` must include `lib`, `cordis.patch.yml`; add `assets/...` when there are static assets.

### 1.2 cordis.patch.yml: one row into the composition

```yaml
# bundle patch: top-level YAML array, insert appends composition rows
- insert:
    - id: my-plugin            # row id (globally unique)
      name: dsh-my-plugin      # package name (client-modules resolves package.json by it)
      config:                  # optional: config passed to the plugin
        someOption: value
```

Key points: `name` must equal the package name (roster scan does `require.resolve('<name>/package.json')`); the row mounts in the host composition,
tools register into the global `tools` registry, so all sessions under the profile can use them — no realm needed.

### 1.3 tsconfig: host and client must be two programs

```jsonc
// tsconfig.json —— host
{
  "compilerOptions": {
    "module": "NodeNext", "moduleResolution": "NodeNext",
    "lib": ["ES2022"], "strict": true, "noUncheckedIndexedAccess": true,
    "declaration": true, "declarationDir": "lib/types", "outDir": "lib", "rootDir": "src",
    "allowImportingTsExtensions": true, "rewriteRelativeImportExtensions": true,  // TS 5.7+, rewrites .ts imports to .js
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["src/client"]     // the host program never compiles client
}
```

```jsonc
// tsconfig.client.json —— client (extends host, overrides)
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",          // required
    "types": []                  // no node types in the browser
  },
  "include": ["src/client", "src/event-types.ts", "src/css-modules.d.ts"],
  "exclude": []
}
```

Why the split is required (see 3.1 for details): the host-side `dsh-session` index declares `Context.sessions: SessionStore`,
the browser-side `dsh-client-runtime` declares `Context.sessions: ISessions` — same-name member type conflicts; in one program
only one can survive (skipLibCheck swallows the conflict and keeps the first declaration). Split apart, the host program only sees host declarations,
the client program only sees browser declarations, no cross-contamination.

## 2. Host-side development

### 2.1 The four elements of a function plugin

A DSH function plugin exports named `name/inject/Config/apply` (no default export):

```ts
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Declaration merge only: make ctx.subagents / ctx.systemPrompt etc. visible (see 2.3)
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'my-plugin'
export const inject = ['tools', 'subagents', 'systemPrompt', 'agents']

export interface Config { stateDir?: string }
export const Config: z<Config> = z.object({ stateDir: z.string().default('.agent-teams') })

export function apply(ctx: Context, config: Config): void {
  // register tools, prompt sections, HTTP routes… all inside apply
}
```

> **Beta version compatibility (webServer/httpServer)**: the npm `latest` (`0.0.1-rc.1`) Web service key is `ctx.httpServer` (`HttpServerService`), later `next` (`rc.2`) renames it to `ctx.webServer` (`WebServer`); the workspace key likewise `workspace` → `workspaceRegistry`. During the transition don't hard-bind a single key name: `ctx.get('webServer') ?? ctx.get('httpServer')` (new key first, old key fallback), and listen to `internal/service` events for both key sets to re-register. The route registration shape (`register({kind, path, handler})` returning a disposer) is identical in both versions.

- `inject` declares the services you depend on; `ctx.<name>` is only available for services declared in `inject`.
- `Config` is described with `@deepseek-ai/schemastery`'s `z.object`; the Loader handles defaults.
- `import type {} from '<package>'` is the **declaration-merge trigger**: DSH packages extend `Context` via `declare module '@deepseek-ai/cordis'`,
  so that package must be loaded into the program for the members to be visible.

### 2.2 Tool registration (defineTool, template: tool-workflow)

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'

ctx.tools.register(defineTool({
  name: 'my_tool',
  description: '…the full contract the model sees…',
  parameters: {
    arg: { type: 'string', required: true, description: '…' },
    status: { type: 'string', enum: ['a', 'b'], description: '…' },  // enum makes type inference precise
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  },
  async execute(args, exec) {
    const caller = exec.agent            // caller Agent (parent session ownership, cwd, session)
    if (!caller) throw new Error('requires a calling agent')
    // …business logic, return a JSON value matching output.schema…
    return { ok: true }
  },
}))
```

Key experience:
- `parameters` is a DSL property-description object (one schema per key); `output.schema` is plain JSON Schema.
- `exec.agent` is the caller's Agent: `agent.session.header.cwd` is the workspace (where team state lands),
  `agent.session` is a session you can append events to, `agent.id` is the session id. Subagent orchestration (`subagents.startContinuable`
  etc.) requires passing `parent: exec.agent`.
- The tool's `description` is the model contract — write clearly "when to use/how to use"; pair it with `ctx.systemPrompt.section()`
  to register the usage policy (the tool-workflow approach: `order: 115` or nearby).

### 2.3 Service injection and "fail-loud timing"

```ts
// Be careful validating at mount time: provider registration is a sibling plugin row's effect (Loader concurrent activation),
// which can land after your apply. Don't validate provider existence in apply — move it to the first real use.
const provider = ctx.subagents.getProvider(config.memberProvider)   // ← do it at spawn time, not in apply
```

`inject` only waits for **services** (the service is provided), not for **provider registration** (another plugin row's effect under the same service).
Any validation that depends on sibling-plugin behavior must be deferred to first use (the earliest resolvable point), otherwise it fails randomly
under concurrent activation (see pitfall 5.1).

### 2.4 HTTP routes (the activity panel data channel)

```ts
import { readFile } from 'node:fs/promises'

// transition-period dual keys: new key first, old key fallback (see 2.1 version compatibility)
const web = (ctx.get('webServer') ?? ctx.get('httpServer')) as WebRouteHost
ctx.effect(() => web.register({
  kind: 'exact',                       // or 'prefix'
  path: '/plugins/my-plugin/state',
  handler: async (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ... }))
  },
}), 'my-plugin: state route')
```

- `register` returns a disposer that must be wrapped in `ctx.effect(..., 'label')` (HMR-safe).
- The service may bind after the plugin's `apply`: when the first registration fails, attach `ctx.on('internal/service', name => ...)` to re-register.
- Static asset routes must be **allowlisted** (against path traversal): wrap `decodeURIComponent` in try (malformed encoding → 404, not 400),
  strip the path with `split('/').pop()`, check a Set, then `join`.
- Client polling is a plain data channel usable by external plugins; use `cache: 'no-store'`, in-flight overlap protection, response shape validation,
  unmount/cancelled protection, and keep the last successful snapshot when the host restarts temporarily or a request fails.

### 2.5 State persistence (files + in-process locks)

```ts
// Team state = workspace/.agent-teams/<teamId>/team.json + inbox/*.jsonl
// Read/write directly with node:fs/promises (plugin-owned bookkeeping, not the sandbox fs service; the fs service has no delete API)
const locks = new Map<string, Promise<unknown>>()
export async function withTeamLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  locks.set(key, previous.then(() => gate))
  await previous
  try { return await fn() } finally { release() }
}
```

- Read-modify-write must be serialized: use a promise-chain mutex within one process (the key should include the workspace to avoid serializing same-named things across workspaces).
- Events/models may bypass the tool ritual (writing files directly); panel-like UIs should treat disk as the source of truth (host snapshot),
  not event replay (events are for conversation nodes and audit).

### 2.6 Session event writing (the data source for conversation UI)

```ts
// event-types.ts —— event types + SessionEventMap merge, must be zero-import!
export interface AgentTeamsTeamCreatedData { readonly teamId: string; readonly name: string }
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap { 'my-plugin/team-created': AgentTeamsTeamCreatedData }
}
```

```ts
// events.ts —— writing
import type { Session, SessionEventMap } from '@deepseek-ai/dsh-session/types'
session.append(type, data)   // type must already be merged into SessionEventMap
```

- `SessionEventMap` is merge-extensible: just `declare module '@deepseek-ai/dsh-session/types'` and merge;
  the browser-side Conversation Node replays these events deterministically by `seq`.
- **event-types.ts must be zero-import**: it's loaded by both the host and client programs; once it imports a
  host-side package (e.g. `dsh-session`'s index), the client program's declaration merge gets polluted (see 3.1/5.3).
- Append target: write events into the "captain session" (not the caller), and have member operations also land in the captain session for a single monitoring surface;
  fall back to the caller's session when the captain is unreachable. `session.append` can throw; wrap it in try/warn to degrade gracefully.

## 3. Client-side development

### 3.1 Why the two tsc programs are required

`dsh-session` (host) index declares `Context.sessions: SessionStore`; `dsh-client-runtime` (browser)
declares `Context.sessions: ISessions`. Both are same-name members of `declare module '@deepseek-ai/cordis' { interface Context }`,
so in one program they necessarily conflict (skipLibCheck swallows the error and keeps the first declaration, surfacing as `ctx.sessions.open`
"Property 'open' does not exist on type 'SessionStore'").

Rules after the split:

- host program: `include: ["src"]`, `exclude: ["src/client"]`; only links host package types.
- client program: `include: ["src/client", "src/event-types.ts", ...]`; **must not compile any file that imports a
  host-side index** (this is why event-types is zero-import; client files only import browser-side packages and event-types types).
- Merging via `declare module '@deepseek-ai/dsh-session/types'` only needs the `dsh-session/types` subpath loaded
  (the subpath file doesn't contain the host's Context merge — safe).

### 3.2 Extension pitfall: `.tsx` is the only way to write JSX

TS only parses JSX in `.tsx` files. Once a plugin entry contains `root.render(<XxxPanel .../>)`,
the file must be `src/client/index.tsx` (output is still `lib/client/index.js`). Writing it as `.ts` yields
a run of `TS1005 '>' expected` errors, unrelated to config — purely an extension issue (see pitfall 5.4).

### 3.3 Client bundle protocol (tsdown, replicating tsdown.client.ts)

The browser doesn't load source; it loads `/plugins/<id>/client.js` — a **CJS closure-factory**:

```js
window.__ModuleLoader__.load({
  id: "dsh-my-plugin",
  factory: (require) => { /* ... */ return module.exports }
})
```

Key `tsdown.config.ts` config (copied from the repo's `packages/client/tsdown.client.ts` `clientConfig`):

```ts
export default {
  name: 'dsh-my-plugin/client',
  entry: { client: 'lib/client/index.js' },   // tsc client program output
  outDir: 'lib', format: 'cjs', platform: 'browser',
  dts: false, sourcemap: true, clean: false,
  external: [...PLATFORM_MODULES, '@deepseek-ai/dsh-client-runtime/client'],
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), /* import.meta.env likewise */ },
  noExternal: (id) => (EXTERNALS.includes(id) ? undefined : true),
  plugins: [
    // purity gate: value imports of @deepseek-ai packages that are neither external nor safely inlinable → build error
    // (cross-plugin value imports inline duplicate instances or need specifiers the module table can't answer)
    { name: 'purity', resolveId(source) { /* @deepseek-ai check */ } },
    // CSS Modules inlining: lightningcss compile + <style data-plugin> injection + class map
    { name: 'css-modules', resolveId(source, importer) { /* .module.css → virtual id */ },
      async load(virtualId) { /* transform + injection logic; sourceAssetPath needs a lib→src mapping (see 5.7) */ } },
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-my-plugin", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}
```

- `CLIENT_EXTERNALS` = the platform module table + the temporary exemption `@deepseek-ai/dsh-client-runtime/client`; the platform list evolves,
  so copy it from the target checkout's `packages/client/web/src/platform.ts`/`tsdown.client.ts`.
- The browser side can only import platform modules, types, and whatever inline-safe packages the current preset allows; cross-plugin value collaboration goes through cordis services.
- `dsh.client.inject` is package-graph/prefetch/HMR metadata, not an apply-order guarantee; wait for slot declarations with
  `ctx.slots.inject()`, wait for services with the client plugin's `export const inject`.
- Requires `tsdown@0.22` + `lightningcss`; pnpm install suffices.

### 3.4 Choosing the right UI seam: slots first, body portal as fallback

First read the current `packages/client/ui-*/src/client/contract/slots.ts`. The current stable seams include
`conversation.session.header.actions`, `conversation.input.dock`, `conversation.composer.dock`,
`conversation.input.left/right`, `conversation.chat.node`, etc. Prefer registering into a semantically correct slot;
only a cross-session, shell-corner-fixed global panel with no matching seat should use a body portal + fixed positioning:

```tsx
// src/client/index.tsx
import { createRoot } from 'react-dom/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

export const inject = ['sessions']

export function apply(ctx: ClientContext): void {
  const host = document.createElement('div')
  host.dataset.myPluginHost = ''
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(<ActivityPanel openSession={(id: SessionId) => { ctx.sessions.open(id) }} />)
  ctx.effect(() => () => { root.unmount(); host.remove() }, 'my-plugin: panel')
}
```

- `ctx.sessions.list` is an `ObservableSnapshot<SessionListState>`; portal components subscribe with `useSyncExternalStore`.
- The portal host, React root, window/document listeners, and global attributes must all be effect-owned and cleaned up on HMR unmount.
- Auto-expand/grace-collapse must be modeled explicitly; close synchronously on user navigation, don't rely on polling latency.

#### 3.4.1 Floater and main workspace cooperation

When a fixed wide-screen floater covers the transcript/composer, let the conversation column yield space while keeping the sidebar still. The portal broadcasts
the open state via a global attribute; CSS only relies on the host's stable data attributes, never hashed classes:

```tsx
useEffect(() => {
  const root = document.documentElement
  if (open) root.setAttribute('data-my-plugin-panel-open', '')
  else root.removeAttribute('data-my-plugin-panel-open')
  return () => { root.removeAttribute('data-my-plugin-panel-open') }
}, [open])
```

```css
:global(html) {
  --my-panel-width: 388px;
  --my-panel-shift: calc(var(--my-panel-width) + 18px + 14px);
}
:global(html[data-my-plugin-panel-open]) :global([data-phase='active']) {
  box-sizing: border-box;
  padding-right: var(--my-panel-shift);
}
:global([data-phase='active']) {
  transition: padding-right 360ms cubic-bezier(.22, 1, .36, 1);
}
@media (max-width: 960px) {
  :global(html[data-my-plugin-panel-open]) :global([data-phase='active']) { padding-right: 0; }
}
@media (prefers-reduced-motion: reduce) {
  :global([data-phase='active']) { transition: none; }
}
```

On wide screens assert panel/composer overlap is 0; narrow screens safely degrade to overlay.

#### 3.4.2 Relationship UI and accessibility

- captain→member delegation and task dependency stages should be expressed with connectors, text, and state simultaneously — never color alone.
- Extract stage grouping and upstream/downstream chains into pure functions: naturally-sorted ids, non-finite depth fallback 0, cycle-safe traversal.
- hover only previews; click pins separately, `aria-pressed` lands only on the pin source node, second click or `Escape` cancels;
  focus/blur behavior mirrors mouse enter/leave.
- icon-only buttons have `aria-label`, sections have labels, decorative images use `alt="" aria-hidden`, interactives have `:focus-visible`,
  animations and transitions respect `prefers-reduced-motion`.

### 3.5 Conversation nodes (Conversation Node, template: ui-workflow-run)

Embedding UI in the conversation = registering a Conversation Node (browser-side cordis):

```ts
// agent-teams-card-definition.ts
import type { ChatConversationViewNode, ConversationNodeContext,
  ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
// The two key type-only imports for declaration merging (see 5.3):
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'   // loads the ChatNodeDataMap module
import type {} from '@deepseek-ai/dsh-session/types'                  // loads the SessionEventMap module

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap { 'my-plugin': MyCardData }               // renderer keyed data map
}

export const myDefinition: ConversationNodeDefinition<MyState> = {
  kind: 'my-plugin',
  target: 'chat',
  match: (event) => { /* extract a stable business id + start/update role from the event */ },
  start: (ctx, match) => { /* first event builds state */ },
  update: (ctx, match) => { /* fold state by increasing seq; extract data to locals inside nested closures (see 5.5) */ },
  buildViewNode: (ctx) => ({ /* project the final data */ }),
}
```

```tsx
// index.tsx registration
ctx.conversationEvents.register(myDefinition)
ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
  name: 'conversation.chat.node', key: 'my-plugin',
  inject: () => ({ openSession: (id) => ctx.sessions.open(id) }),
}, MyCardComponent))
```

- A Conversation Node is **deterministic event-stream replay**: `match` picks events, `start/update` fold by seq, `buildViewNode`
  projects — so conversation nodes natively support "historic session review" (replaying old logs restores them).
- Components are ordinary React components with the four-piece props (`PropsRuntime<'conversation.chat.node','my-plugin'>` etc.).

## 4. Build and install

### 4.1 Build chain

```sh
pnpm build   # tsc host → tsc client → tsdown (client.js)
```

- tsc needs **5.7+**: `rewriteRelativeImportExtensions` rewrites `./x.ts` imports in source to
  `.js` in the output (otherwise emit reports TS5096/TS5023, see pitfall 5.6).
- tsdown outputs `lib/client.js` (CJS closure-factory) + sourcemap; host-side tsc output is directly usable
  (`lib/index.js` etc.).

### 4.2 Dev-time type linking (when developing outside a DSH checkout)

DSH packages are not published to the npm registry (pre-release); during development, symlink the dependencies into the project's node_modules:

```sh
mkdir -p node_modules/@deepseek-ai
ln -sfn /path/to/DSH/vendor/cordis           node_modules/@deepseek-ai/cordis
ln -sfn /path/to/DSH/packages/core/session   node_modules/@deepseek-ai/dsh-session
ln -sfn /path/to/DSH/packages/core/tools     node_modules/@deepseek-ai/dsh-tools
# ...and every dsh-* package you import (host side links the checkout's packages/<group>/<pkg>)
```

Two traps:

- **Must link to the source checkout's build artifacts** (`packages/<pkg>/lib/types`), not the running instance's
  staging directory — staging snapshots may be old builds (`declare module 'cordis'` instead of
  `'@deepseek-ai/cordis'`, so the declaration merge doesn't take effect).
- The checkout's `lib` may be stale (source updated but not rebuilt) — symptoms are missing types; then re-link or switch to source
  `paths` mapping. Same for client-side packages.

### 4.3 Installing into a profile

```sh
pnpm build
# beta phase: dsh comes from the official npm package; install the plugin by local path or git URL (before npm publication)
npx -p @deepseek-ai/dsh dsh plugin --profile web add /absolute/path/to/dsh-agent-teams
# takes effect after restarting dsh (web or headless)
```

- `dsh plugin` runs pnpm in the profile directory and reconciles dependencies declaring `dsh.bundle` into the bundles layer.
- Beta registry: the `@deepseek-ai` scope needs an official read-only token (`.npmrc` scope auth); peer ranges must be written as
  rc channels (e.g. `^0.0.1-rc.1`), a plain `^0.0.1` doesn't match `0.0.1-rc.x` and installation fails to resolve.
- **CLI and bundle versions must be on the same channel**: the default npx CLI may be `next` (rc.2), while `dsh plugin add` installs
  `latest` (rc.1) by default — mixing them makes rc.2-only client entries (e.g. `ui-plugin-config`) wait for services only rc.2 provides
  (`settingsScope`), and the page reports "Failed to load plugins … waiting for service: settingsScope". Pin
  `npx -p @deepseek-ai/dsh@0.0.1-rc.1` (aligned with latest), or upgrade everything to `next`.
- An independent test profile is a safe verification environment (doesn't touch running instances): the headless template auto-initializes; custom profiles can be
  built from scratch with `npx -p @deepseek-ai/dsh dsh plugin --profile <name> add ...`.

### 4.4 Offline verification (no services started)

```sh
node scripts/verify.mjs   # pure logic + file persistence smoke (self-cleaning temp dirs)
dsh --profile <scratch> --dump-config   # verify the plugin row appears in the composition tree (offline, no boot)
```

- Extract pure logic (state machines, dependency depth, folds, layout) into ctx-free pure functions; the verify script imports
  `lib/*.js` directly and asserts; write paths wrapped by `withTeamLock` run real file round-trips in temp dirs.

## 5. Pitfall checklist (in development order, all actually hit)

### 5.1 Provider registration lands after plugin mount

- **Symptom**: first startup randomly reports `no subagent provider "spawn" is registered`; headless always reproduces.
- **Root cause**: the `subagent-spawn` row's provider registration is a sibling plugin effect, which under Loader concurrent activation can land after your
  `apply`; `inject` only waits for services (the subagents service exists), not providers.
- **Fix**: don't validate the provider in apply; at the first `spawnMember`, `getProvider` and throw an actionable error
  ("fail-loud at the earliest resolvable point").

### 5.2 Browser roster doesn't include the plugin (manifest / export / bundle)

- **Symptom**: no entry in `window.__DSH_BOOT__`, or the host reports a client bundle composition error at startup.
- **Current contract**: `client-modules` reads `package.json.dsh.client`, requiring `platform: "web"`, a valid
  `exports["./client"]`, and an actually existing bundle; malformed declarations or missing bundles fail loud.
- **Cache boundary**: package metadata and negative conclusions don't expire; restart the host after fixing the manifest/export. Only `lib/client.js` content changes
  enter the client HMR rebuild chain.

### 5.3 `declare module` merge doesn't take effect (TS2664 / type union missing your event)

- **Symptom**: after merging via `declare module '@deepseek-ai/dsh-session/types'`, `match(event)`'s
  `event.type` union doesn't include your event; `declare module '@deepseek-ai/dsh-client-ui-conversation/client'`
  reports `TS2664: Invalid module name in augmentation`.
- **Root cause**: module augmentation only applies to modules **already loaded into the program**; a pure `declare module` file with zero imports never loads
  the target module.
- **Fix**: add `import type {} from '<target module>'` at the top of the merging file (loads the module, erased at compile time, not in the bundle).
  This is also why event-types.ts must be zero-import but definition files may carry type-only imports.

### 5.4 JSX reported as a run of syntax errors

- **Symptom**: `root.render(<XxxPanel .../>)` reports a long run of `TS1005 '>' expected`; changing the jsx config or swapping the tsc
  version does nothing.
- **Root cause**: the entry file is `index.ts` — TS only parses JSX in `.tsx`, so `<` is treated as a less-than sign.
- **Fix**: any file containing JSX must be `.tsx` (`src/client/index.tsx`); the output name is unchanged (tsc outputs `.js`).

### 5.5 Discriminated-union narrowing fails inside nested closures

- **Symptom**: `if (event.type === 'x') { ...arr.map(() => event.data.field) }` reports
  `Property 'field' does not exist`.
- **Root cause**: narrowing of a function parameter (`match`) is not preserved inside nested arrow functions (`.map` callbacks) (TS only preserves narrowing
  for const variables inside closures).
- **Fix**: after the guard, extract `const field = match.event.data.field` first and use the local inside the closure.

### 5.6 tsc emit reports TS5096/TS5023

- **Symptom**: `typecheck` (--noEmit) passes, but `tsc` emit reports
  `TS5096: allowImportingTsExtensions can only be used with noEmit` +
  `TS5023: unknown option rewriteRelativeImportExtensions`.
- **Root cause**: TypeScript version < 5.7 (`rewriteRelativeImportExtensions` is new in 5.7; older versions'
  `allowImportingTsExtensions` only allows noEmit).
- **Fix**: `typescript@^5.9` (`pnpm add -D typescript@^5.9.0`). Also note `pnpm add` may swap a linked
  typescript for an older version — confirm with `tsc --version` after installing.

### 5.7 tsdown CSS reports ENOENT (module.css not found)

- **Symptom**: `ENOENT: no such file or directory, open './Xxx.module.css'`.
- **Root cause**: when copying tsdown.client.ts you missed `sourceAssetPath`'s lib→src fallback: tsc output lives in `lib/client/`,
  but the css source lives in `src/client/`; the repo implementation remaps the `lib/` prefix to `src/`.
- **Fix**: when resolveId can't find the emitted path, replace the `/lib/` segment in the path with `/src/` and look again.

### 5.8 Other hands-on notes

- **Polling races**: 1s setInterval + fetch can overlap out of order — use an in-flight flag or sequence number, apply only the latest.
- **Response shape validation**: `body.teams ?? []` isn't enough — `Array.isArray(body.teams)` prevents flicker on 200s with abnormal shapes.
- **setState and event listeners in closures**: window listeners should read the latest `current` via a ref, synced in an effect; don't write refs during render phase.
- **Close on navigation**: when clicking to jump to a sub-session, `setOpen(false)` synchronously — don't wait out the auto-close grace.
- **Delete = archive**: archive review data on deletion, exclude it from the live scan, query it separately via `?archived=1`.
- **Session following**: filter by `SessionListState.current + captainSessionId`; show no teams when `current === undefined`.
- **Historic data composite identity**: a repeatable business id alone can't be the historic/archived key; use
  `${ownerSessionId}:${businessId}`, and match owner the same way on restore/dedup. When old events lack an owner, pin ownership at card activation using the current session.
- **Async unmount protection**: polling, archive fetches, timeouts, and event listeners all need cancelled/disposer handling.

## 6. Verification pyramid (fast to slow)

1. `pnpm typecheck` (dual program) → 2. `pnpm build` → 3. `node scripts/verify.mjs` (pure logic/file round-trips)
   → 4. `dsh --profile <scratch> --dump-config` (composition tree contains the plugin row) → 5. headless real task
   (`dsh --profile headless "…"`, needs DEEPSEEK_API_KEY) → 6. independent web instance
   (`dsh --profile <web+plugin> --patch <port>` + curl roster/routes) → 7. ego-browser driving a real browser
   GUI e2e (run tasks, DOM probes asserting panel/card/animations).

Verification always uses **independent profiles/ports** and never touches running instances.
