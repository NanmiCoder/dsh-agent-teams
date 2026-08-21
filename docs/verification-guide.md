## Verifying a DSH plugin actually works (hands-on)

> This document is distilled from the complete verification journey of the dsh-agent-teams plugin (multi-agent team collaboration + Web UI activity panel).
> Every command has actually been executed; every layer has its pitfalls, marked at the corresponding step. Principle: **never touch a running instance — verify on an independent profile / independent port / temporary directory, then clean up**.

### Verification pyramid overview

Four layers bottom-up; pass one layer before moving to the next; any failure must be fixed before continuing:

1. **Offline**: dual-program typecheck + build + smoke script (pure logic, temp dirs, self-cleaning)
2. **Composition**: `dsh --profile <scratch> --dump-config` verifies the bundle patch composes into the config tree (no boot, no touching instances)
3. **Real e2e**: independent headless profile + real LLM task + on-disk/event checks
4. **GUI**: independent web instance + ego-browser driving a real browser (roster → routes → DOM probes → screenshots)

---

### 1. Offline verification

#### 1.1 Dual-program typecheck

DSH plugins usually have both a **host side** (Node: tools, routes) and a **browser side** (React components, Conversation Node). Both pull in mutually conflicting type declarations (typical: the host-side `dsh-session` index declares `Context.sessions: SessionStore`, conflicting with the browser runtime's same-named `ISessions`), so **they must be split into two independent tsc programs**:

```jsonc
// tsconfig.json (host): include src, exclude ["src/client"]
// tsconfig.client.json: extends ./tsconfig.json + jsx react-jsx + lib DOM + types []
//     include ["src/client", "src/event-types.ts", "src/css-modules.d.ts"]
```

```sh
tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit   # both must be 0 errors
```

Pitfalls (all actually hit):
- **`.ts` files don't parse JSX**: a client entry with JSX must be named `index.tsx` (`index.ts` treats `<Component` as a less-than sign and reports `TS1005 '>' expected`, independent of the jsx config).
- **`declare module` merging needs the target module loaded first**: before `declare module '@deepseek-ai/dsh-session/types'` can extend `SessionEventMap`, that module must already exist in the program — add `import type {} from '...'` at the top of the file (a type import loads the module declarations and is erased from the output).
- **Narrowing fails inside closures**: `match.event.data.x` used inside a `.map((m) => ...)` callback does not retain discriminated-union narrowing — extract `const x = match.event.data.x` after the guard and use the local.
- **Type link targets**: links at `profiles/node_modules/@deepseek-ai/*` are unstable (staging snapshots may be old builds declaring `module 'cordis'` instead of the rescoped `'@deepseek-ai/cordis'`). During development, link `node_modules/@deepseek-ai/<pkg>` directly to the **checkout source package directory** (its `lib/types` is the correctly-declared build); if the client package's lib is stale (missing `Context` declaration merge), prefer linking to the same-version staging build of the running instance, or map the source directly.

#### 1.2 Build (tsc + tsdown client bundle)

```jsonc
// package.json scripts
"build": "tsc -p tsconfig.json && tsc -p tsconfig.client.json && tsdown",
"typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit",
"verify": "node scripts/verify.mjs"
```

- tsc produces `lib/` (host executable ESM) and `lib/types/` (declarations)
- `tsdown` bundles `lib/client/index.js` into the browser bundle `lib/client.js` (protocol: CJS closure-factory, `window.__ModuleLoader__.load({ id, factory })`; externalizes platform modules react / `@deepseek-ai/dsh-client-*`; CSS Modules inlined via lightningcss and injected as `<style data-plugin>`)
- Post-build smoke: `node -e "import('./lib/index.js').then(m => console.log(Object.keys(m)))"` should show `name/inject/Config/apply`

Pitfall: the current DSH preset rebases from `lib/types/...` back to `src/...`; external plugins should implement their own emitted layout and not mechanically hardcode any `/lib/`. tsdown 0.22 deprecates `external/noExternal`, but the current checkout preset still uses them; before migrating to `deps.neverBundle/alwaysBundle`, verify the function-matching semantics — don't treat a warning as permanently ignorable.

#### 1.3 Smoke script (scripts/verify.mjs)

Zero dependencies, self-cleaning temp dirs, pure logic that can be tested. Template (copy the skeleton as-is):

```js
#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { /* the pure functions under test */ } from '../lib/state.js'

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`)
  else { failures += 1; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

// 1) Pure rules: state-machine transitions, dependency gating, sanitize — assert input and output
// 2) File persistence: mkdtemp temp root → createTeamDir/readTeam/mailbox round-trip →
//    archive/delete → finally { rm(stateRoot, { recursive: true, force: true }) }
// 3) State functions: import from lib/ (e.g. taskVisualState/taskDepthsById), build fixtures and assert
// 4) Browser fold: import('../lib/client/xxx.js') to run pure fold logic directly (no React)

if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exit(1) }
console.log('\nall checks passed')
```

Requirements: assertion labels must match the input and condition; cover missing dependencies, empty dirs, terminal-status transition rejections, and clean up temp dirs in `finally`. For UI-related pure projections, also assert stage ordering, natural id ordering, non-finite depth fallback, upstream/downstream inclusion, sibling exclusion, and cycle safety. Run `pnpm verify` before CI/commit.

#### 1.4 Composition check: dump-config (no boot, no touching instances)

Verify the bundle patch composes into the config tree with an **independent scratch profile**:

```sh
# Manually construct the scratch profile (no need to go through pnpm)
mkdir -p ~/.dsh/profiles/agent-teams-check/node_modules
ln -sfn /absolute/path/to/plugin ~/.dsh/profiles/agent-teams-check/node_modules/<pkg>
cat > ~/.dsh/profiles/agent-teams-check/package.json <<'EOF'
{ "name": "dsh-profile-check", "private": true, "dependencies": {},
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "<pkg>"] } } }
EOF
printf '[]\n' > ~/.dsh/profiles/agent-teams-check/cordis.patch.yml   # must be a top-level array!

dsh --profile agent-teams-check --dump-config | grep -A 4 "id: agent-teams"
```

- `--dump-config` is **offline composition** (`composeEntries` applies the patch layers), no service boot, no touching running instances
- Output should show `- id: <plugin row>` with its config
- Pitfall: a non-top-level-array `cordis.patch.yml` reports "must be a top-level YAML array". Custom profiles composing web-app can directly take app-level `--host/--port`; `--patch` is an auditable, pinned approach, but not the only entry point.

---

### 2. Real e2e verification (independent profile + real LLM)

#### 2.1 Install into an independent profile

```sh
# headless template auto-initializes; pnpm link semantics + auto-reconcile into dsh.profile.bundles
dsh plugin --profile headless add /absolute/path/to/plugin
dsh --profile headless --dump-config   # confirm the composition tree contains the plugin row
```

A first real run usually exposes **mount-timing bugs** immediately: under Loader concurrent activation, sibling plugins (e.g. the `subagent-spawn` provider registration) may not have finished when your plugin's `apply` runs — **move fail-loud validation at mount time to the first use point** (e.g. check `ctx.subagents.getProvider(name)` at the first member spawn), and make the error actionable.

#### 2.2 Designing the real LLM task

```sh
mkdir -p /tmp/agent-teams-e2e && cd /tmp/agent-teams-e2e
dsh --profile headless "Use AgentTeams for a small task: create a team 'title brainstorm', add 2 members (alice does research, bob does writing), create 2 tasks (t2 depends on t1) assigned to them, wake them, and finally consolidate the output. Keep tasks small — each member does one simple task."
```

Design points (control tokens and decidability):
- **Keep tasks small**: explicitly say "tasks should be small / each member does one simple task" (member spawn + multiple tool calls can run 1–3 minutes)
- **Explicitly require the plugin flow**: name the tools and order to call (create team → add members → create dependent tasks → wake → consolidate), otherwise the model may skip it
- Run in a **dedicated working directory** (`/tmp/...`) so on-disk artifacts are predictable; run in the background (`run_in_background`) and collect with `task_output --wait`
- Success criteria: the task output contains the full flow narrative (team/members/tasks/output/delete team), and the **event stream landed on disk** (see 2.3)

#### 2.3 On-disk checks (the data truth)

```sh
# Team state files (headless cwd = invocation dir; archived/emptied after team deletion)
ls -la /tmp/agent-teams-e2e/.agent-teams/

# Session logs: one dir per session; member sub-sessions are separate uuid dirs
ls -lt ~/.dsh/sessions/--private-tmp-agent-teams-e2e--/

# Event stream (zstd-compressed; decompress with zstdcat and count agent-teams/* events)
zstdcat ~/.dsh/sessions/<ws>/session-<id>/session.jsonl.zstd \
  | grep -o '"type":"agent-teams/[^"]*"' | sort | uniq -c
# Expected: team-created ×1, member-added ×2, task-created ×2, task-updated ×N,
#       message-sent ×N, team-deleted ×1 (counts match the flow 1:1)
```

The event stream is the data source for the UI and replay — **event counts that don't match the flow steps are a bug** (e.g. missing events when a member skips the `update_task` ritual; distinguish this from disk truth).

---

### 3. GUI verification (ego-browser + independent web instance)

#### 3.1 Start an independent web instance (never touch the user's running instance)

```sh
# Fresh install (beta npm flow; peers resolve from the beta registry):
npx -p @deepseek-ai/dsh@0.0.1-rc.1 dsh plugin --profile agent-teams-beta add @deepseek-ai/dsh-base
npx -p @deepseek-ai/dsh@0.0.1-rc.1 dsh plugin --profile agent-teams-beta add @deepseek-ai/dsh-web-app
npx -p @deepseek-ai/dsh@0.0.1-rc.1 dsh plugin --profile agent-teams-beta add /abs/path/to/dsh-agent-teams
# Start (managed background task, keep the task id; CLI and bundle share the same channel):
npx -p @deepseek-ai/dsh@0.0.1-rc.1 dsh --profile agent-teams-beta --host 127.0.0.1 --port 3081
# curl only after you see the exact URL
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3081/
```

- Custom profiles composing web-app can directly take app-level `--host/--port`; `--patch` can also pin the webserver config.
- **Version-alignment pitfall**: the default npx CLI is rc.2 (next channel), while `dsh plugin add` installs latest (rc.1) by default — mixing them makes rc.2-only `ui-plugin-config` wait for `settingsScope`, which only rc.2 provides, and the page reports "Failed to load plugins". Pin the CLI to `@0.0.1-rc.1` (aligned with the latest bundle), or upgrade everything to `next`.
- The beta registry's `latest` (rc.1) and `next` (rc.2) have different service keys (`httpServer` vs `webServer`) — the plugin is dual-key compatible, so spot-check both channels.
- Client HMR needs a watcher continuously rebuilding `lib/client.js`; otherwise refresh the page after `pnpm build`. Only host/package manifest/profile bundle changes require a restart.
- apps/web shell/ordinary packages don't go through client-plugin HMR; don't start a standalone Vite server to replace the DSH GUI.

#### 3.2 Roster and route liveness

```sh
# The browser roster must contain the plugin (client-modules scans packages declaring dsh.client in the composition tree)
curl -s http://127.0.0.1:3081/ | python3 -c "
import sys, json, re
html = sys.stdin.read()
m = re.search(r'window.__DSH_BOOT__ = (.*?)</script>', html, re.S)
g = json.loads(m.group(1))
print(any('agent-teams' in e['id'] for e in g.get('entries', [])))
"
# Client bundle and custom data routes
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3081/plugins/<pkg>/client.js
curl -s http://127.0.0.1:3081/plugins/<pkg>/state
curl -s "http://127.0.0.1:3081/plugins/<pkg>/state?archived=1"
```

Pitfall: the current source reads package.json `dsh.client` and requires a valid `exports["./client"]` plus an actual bundle; malformed declarations or missing bundles fail loud. Negative package-metadata conclusions don't expire on their own — restart the host after fixing the manifest/export.

#### 3.3 DOM probes (ego-browser)

```js
// Each heredoc reuses the task space first + opens/reuses a tab
const task = await useOrCreateTaskSpace('agent-teams webui test')
await openOrReuseTab('http://127.0.0.1:3081', { wait: true, timeout: 30 })

// Components must expose data-* probe attributes (data-agent-teams-activity / data-task-state / data-member-running ...)
const probe = await js(String.raw`(() => {
  const panel = document.querySelector('[data-agent-teams-activity]')
  if (!panel) return { panel: false }
  return {
    panel: true,
    teamName: panel.querySelector('[class*="teamName"]')?.textContent ?? '',
    delegationMap: !!panel.querySelector('[data-delegation-map]'),
    dependencyMap: !!panel.querySelector('[data-dependency-map]'),
    focusedTasks: [...panel.querySelectorAll('[data-task-id][data-focused="true"]')].map(n => n.getAttribute('data-task-id')),
    pinnedTasks: [...panel.querySelectorAll('[data-task-id][aria-pressed="true"]')].map(n => n.getAttribute('data-task-id')),
    artLoaded: [...panel.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0),
    mainShift: getComputedStyle(document.querySelector('[data-phase="active"]')).paddingRight,
  }
})()`)
cliLog(JSON.stringify(probe, null, 1))
```

Pitfalls:
- **snapshotText's `@N` refs go stale on every snapshot**: re-run `snapshotText()` to get a fresh ref before filling inputs/clicking buttons; when no exact ref exists, fall back to `aria-label` or button text (`.match(/\[ref=(\d+), loc=[^\]]*send[^\]]*\]/)`)
- **composer selectors change**: the placeholder may change from "describe what you want to build" to "message the agent" — list all textboxes first, then target precisely
- CSS-module substring selectors are easy to over-match; probes should prefer stable `data-*`, role, and aria attributes.
- Verify hover preview, click pin, second click/`Escape` unpin; `aria-pressed` lands only on the pin source task, the focused chain excludes siblings.
- On wide screens assert main padding is non-zero and panel/composer overlap is 0; at ≤960px padding returns to 0 with no body horizontal overflow; when closing, sample intermediate frames to confirm no jump-cut.
- The card activation event can be simulated with a CustomEvent, but keep at least one real button path. Use browser wait/re-probe for polling states, not shell sleep busy-waiting.

#### 3.4 Screenshot archive

```js
await captureScreenshot('/tmp/agent-teams-panel.png')   // returns the file path
```

Save one screenshot per key state (running / terminal / archived review) for human visual checks; DOM probe text evidence and screenshots complement each other (probes are assertions, screenshots are manual inspection).

---

### 4. Verification discipline

- **Never touch the user-specified running instance**: first identify its profile/URL; when the user says "don't touch instance X", do not curl, restart, or bypass-check it.
- **Full-chain rerun**: typecheck → build → verify → diff check; decide hot-swap vs page reload by HMR conditions; only host/package manifest/profile bundle changes require restart.
- **Background tasks traceable**: start with a managed background task and save the task id; if the user didn't ask to keep it, stop it precisely by that id, avoiding broad `pkill -f`.
- Reuse the ego-browser task space per target and close it when done; only delete the exact temp paths this task created.
- commit/push per user authorization; when the user asks for a commit, report the hash; don't push unless asked.

---

### 5. Verification checklist template (copyable)

```markdown
## Verification checklist: <plugin name>

### Build and offline
- [ ] pnpm typecheck        # host + client dual program, both 0 errors
- [ ] pnpm build             # lib/ + lib/client.js (closure-factory) artifacts
- [ ] node -e "import('./lib/index.js')..."  # exports name/inject/Config/apply
- [ ] pnpm verify            # all smoke checks PASS (pure rules/persistence/state functions/fold)
- [ ] dsh --profile agent-teams-check --dump-config | grep "id: <plugin>"   # composition tree contains the plugin row

### Real e2e (independent headless profile)
- [ ] dsh plugin --profile headless add /abs/path/<pkg>
- [ ] dsh --profile headless "<small task, explicitly requiring the plugin flow>"
- [ ] task output contains the full flow narrative (team/members/tasks/output/delete team)
- [ ] on disk: .agent-teams state files exist (or archived as expected)
- [ ] zstdcat session log: agent-teams/* event counts match the flow 1:1

### GUI (independent web instance 3081 + ego-browser)
- [ ] dsh --profile agent-teams-web --patch port.patch.yml starts, index 200
- [ ] window.__DSH_BOOT__ roster contains the plugin (if not, check dsh.client + ./client export + bundle)
- [ ] /plugins/<pkg>/client.js 200; custom routes (state/assets) 200 with correct content
- [ ] run a task in a new session → panel/card appear (DOM probe data-* assertions pass)
- [ ] key interaction loops (jump-hide/session-follow/archive review) probed item by item
- [ ] screenshots archived (running/terminal/review)

### Cleanup and wrap-up
- [ ] stop the independent instance with the saved background task id (unless the user asked to keep it)
- [ ] completeTaskSpace(keep: false); only delete temp paths this task created
- [ ] did not touch other running instances the user specified
- [ ] commit per user authorization; no push unless asked
```
