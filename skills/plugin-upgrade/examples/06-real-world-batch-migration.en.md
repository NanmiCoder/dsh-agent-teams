# Example 06: Real-World Batch Migration of Six Plugins (0.1.1-rc.1 → 0.1.2-alpha.1)

English | [简体中文](06-real-world-batch-migration.md)

**Scenario**: Six published Web UI plugins (pixel pet / progress bar / input history / minigame collection / paste input / file tracing) batch-migrated from `dsh-v0.1.1-rc.1` to `dsh-v0.1.2-alpha.1`. All three typical shapes are covered: the snapshot-reading + slot-registering heavy type, the self-contained-DOM zero-cost type, and the declaration-cleanup-only minimal type.

**Touchpoints**: #3 client imports (`dsh-client-runtime` removal), snapshot reads (`ConversationSnapshot` → views), slot registration (`ctx.slots.inject`), `package.json` `dsh.client.inject` declarations

**Complexity**: ⭐⭐⭐

**Plane**: primarily Web Client (type imports / snapshot reads / slot registration / packaging declarations); no host API migration — only a note on how host-half changes take effect (see Error 6)

**Sources**: Community migration practice (migration completed 2026-08-28, verified by real boot + unit-test regression) — [deepseek-harness discussion #5120](https://github.com/deepseek-ai/deepseek-harness/discussions/5120#discussioncomment-18208001); the six plugin repositories are listed at the bottom.

> Corridor coverage note: the corridor now covers `dsh-v0.1.1-rc.1 → dsh-v0.1.2-alpha.2` (when this example was written the rc.1 → rc.2 segment had no cards; it was later filled by [v0.1.1-rc.2.md](../references/v0.1.1-rc.2.md), 3 cards, `DSH-0.1.1-R2` prefix). The technical claims in this example (client-runtime removal, `ctx.slots.inject`, `views.get('chat')?.legacy`, etc.) were first-hand sources at the time of writing; the same fleet's later zero-code ride of the 0.1.2 train up to rc.1 is recorded in the "Follow-up" section at the end; the closest existing card is DSH-0.1.2-A1-03 · 会话视图工程大幅拆分 (session-view engineering split).

---

## Migration Result Overview

| Plugin | Shape | Effort | Actual change |
|---|---|---|---|
| dsh-ui-whale v0.3.4→v0.3.5 | snapshot + slot | medium | 8 files +141/−99: type imports, `legacy` projection, slot registration |
| dsh-ui-progress v0.9.3→v0.9.4 | snapshot + slot | medium | same as above + turn-end detection moved to the new timeline |
| dsh-input-history v0.1.3→v0.1.4 | snapshot | medium | snapshot fields moved to `legacy` |
| dsh-minigames v0.3.5→v0.3.7 | self-contained body portal | ≈0 | just re-ran 203 unit tests + live verification |
| dsh-paste-input v0.1.5→v0.1.6 | vanilla lib (no src/) | small | removed the deleted `dsh-client-runtime` declaration from `dsh.client.inject` |
| dsh-file-trace | written directly on 0.1.2 | — | usable as a positive sample of the 0.1.2 APIs |

**Classify your plugin before starting**: self-contained DOM plugins cost nearly nothing — don't put yourself through the heavy-type workflow.

---

## Before

```typescript
// src/client/index.ts (0.1.1-rc.1)
import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'

export function apply(ctx: ClientContext): void {
  ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'whale', order: 10 },
    WhalePet,
  )
}
```

```typescript
// WhalePet.tsx — old flat snapshot fields
const { nodes, partial, runningCalls, turnEnds } = conversationSnapshot
```

```json
// package.json
{
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["dsh-client-runtime", "dsh-client-ui-chat"]
    }
  },
  "devDependencies": {
    "@deepseek-ai/dsh-client-runtime": "link:../.dsh/source/0811/packages/client/runtime"
  }
}
```

---

## After

```typescript
// src/client/index.ts (0.1.2-alpha.1)
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// ctx.slots types come from the renderer package — remember to add it to devDependencies
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'whale', order: 10 },
    WhalePet,
  ))
}
```

```typescript
// WhalePet.tsx — move everything to the legacy projection first (step one of a two-step plan)
const chat = conversationSnapshot.views.get('chat')
const { nodes, partial, runningCalls } = chat?.legacy ?? EMPTY_PROJECTION
// Turn timeline now lives at chat?.timeline; lifecycle fields (running etc.) move to the useSession seat
```

```json
// package.json — clean the deleted package out of inject; repoint the devDeps link
{
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["dsh-client-ui-chat"]
    }
  },
  "devDependencies": {
    "@deepseek-ai/dsh-client-ui-renderer": "link:../.dsh/source/current/packages/client/ui-renderer"
  }
}
```

---

## Migration Steps

1. **Environment**: 0.1.2-alpha.1 is not on npm (latest is 0.1.1-rc.2) — check out the source, `pnpm install && pnpm run build`; point the `~/.dsh/source/current` junction at the checkout and link plugin devDeps through it. Back up `~/.dsh` before touching anything.
2. **Replace type imports globally**: `dsh-client-runtime/client` → `@deepseek-ai/cordis`; delete the old declaration from `dsh.client.inject` and devDependencies (a leftover fails boot with a missing-service error).
3. **Snapshot reads via views**: all old flat fields read through `views.get('chat')?.legacy` — move everything to legacy first so it runs, then migrate field by field to views/timeline once stable.
4. **Lifecycle split**: `running` and friends go through the `useSession` seat; component props combine `useSession` + `useConversation`.
5. Slot registration becomes `ctx.slots.inject(name, () => ctx.slots.register(...))`; pull in `@deepseek-ai/dsh-client-ui-renderer/client` for the `ctx.slots` types.
6. `pnpm run clean && pnpm run build && pnpm run typecheck && pnpm run test` — the clean is mandatory, see pitfall 1.
7. **Live verification**: `dsh --profile web` + browser hard refresh; restart dsh if the host half changed (client half only needs a hard refresh). Then declare the compatibility matrix in the README (keep old rows, annotated per DSH version) and cut a new tag.

---

## Verification

```sh
# leftover-reference check
grep -r "dsh-client-runtime" src/ package.json
# expected: no output (vanilla-lib plugins should also grep lib/)

# clean build + full checks
pnpm run clean && pnpm run build && pnpm run typecheck && pnpm run test

# live boot verification: start dsh --profile web, hard-refresh the browser,
# and confirm plugin UI renders, snapshot data (streaming/tool state) is non-empty, slots land correctly
```

Verification records from this migration: all six plugins passed same-day live boot verification; minigames 203 unit tests green; whale/progress 34/39 unit tests green.

---

## Common Errors

### Error 1: typecheck reports unrelated old errors (e.g. `MISSING_EXPORT resolveSessionPreset`)

**Cause**: stale incremental tsbuildinfo — source changed but the check was fooled by the old cache.

**Fix**: `pnpm run clean` and rebuild. Clean before every verification pass during a migration.

### Error 2: boot fails with a missing-service error, yet nothing references `dsh-client-runtime` in code

**Cause**: a leftover declaration in `package.json` `dsh.client.inject`.

**Fix**: grep package.json, not just src/.

### Error 3: cryptic parse errors during build like "Did you mean {'>'}"

**Cause**: the oxc/vite parser is stricter than tsc — unclosed tags, or a ternary with an arrow function spanning lines, both blow up.

**Fix**: rewrite the expression as the parser suggests (precompute variables, split statements); don't fight it.

### Error 4: test files fail to compile after the migration

**Cause**: in 0.1.2 fiber `dispose` became readonly (tests can no longer assign it to simulate); `as` assertions in test files are unsupported on the JSX parse path.

**Fix**: observe readonly fields indirectly; replace `as` with pre-narrowed variables.

### Error 5: plugin install on a fresh environment fails with build-scripts-blocked errors (node-pty etc.)

**Cause**: pnpm 11 blocks dependency build scripts by default.

**Fix**: run `pnpm approve-builds --all` in the profile directory (worth documenting in the plugin README).

### Error 6: code changes don't show after a refresh, or the host behaves like the old version

**Cause**: the client half takes effect on a hard refresh, the host half requires a dsh restart.

**Fix**: check where the change landed: into `lib/index.js` (host) → restart; only `lib/client.js` → hard refresh.

---

## Appendix: robustness advice for the alpha phase

Wrap the client `apply` in a compatibility self-check (probe key capabilities like `ctx.slots.inject` / `ctx.locale.register`; render a remediation banner instead of throwing). DSH/plugin version mismatches are frequent during alphas — this turns "black-screen crash" into "one readable upgrade hint". All six plugins here ship it.

## Follow-up: riding the 0.1.2 train to rc.1 (2026-09-04)

After the alpha.1 landing, DSH shipped alpha.2 / alpha.3 / alpha.4 / alpha.5 / rc.1 in succession, and the same six plugins followed edge by edge until all of them declare compatibility with `dsh-v0.1.2-alpha.1`–`alpha.5`, `rc.1`. This follow-through is the complement of the migration storm at the top of this example: migration is about deciding *what to change*; riding the train is about **confirming nothing needs changing — and still verifying and releasing by the book**.

### Outcome: no compatibility source changes for this fleet after alpha.1

| DSH edge | Plugin source changes | Release action |
|---|---|---|
| alpha.2 / alpha.3 | None (the alpha.2 peer cleanup (A2-03) and other cards require no migration for this fleet; alpha.3 has the optional [A3-01 settings-card capability](../references/v0.1.2-alpha.3.md), which this fleet does not need to adopt) | Compatibility range extended straight to `~alpha.3`, shipped with feature releases |
| alpha.4 | None (the A4 breaking cards sit on the host/SDK plane: `send_message`, `Session.events` → `seq`, …) | One "declare support" patch release each, after verification appropriate to each plugin's shape (see the routine below) |
| alpha.5 | None (a host bug fix plus the [A5-01 / A5-02 storage-domain capabilities](../references/v0.1.2-alpha.5.md), including `compatibleVersions` and `invalidRecords`; none requires this fleet to migrate) | Same |
| rc.1 | None (252 files, all version bumps — see [v0.1.2-rc.1.md](../references/v0.1.2-rc.1.md)) | Same + real-host rc.1 boot verification (Windows) |

Final plugin states (visible in each README compatibility matrix): whale v0.3.13 / progress v0.9.12 / input-history v0.1.8 / minigames v0.3.14 / paste-input v0.1.18 / file-trace v0.3.1.

### The per-edge "declare support" routine

1. Read that edge's corridor cards and confirm no touchpoint requires this fleet to migrate (client-UI plugins focus on the client / renderer / inject surfaces; decide separately whether to adopt optional capabilities).
2. Switch the harness source checkout to the target tag, install dependencies, and rebuild; confirm the plugin's source dependency links also point to that target before building and checking the plugin.
3. Bump the patch version; **append a row** to the README compatibility matrix (keep old rows, note the DSH version range, and leave verification results pending until complete); update the tag routing in the install prompt (see plugin-release references §8 version routing and §10 self-sufficient update prompts).
4. Run final checks appropriate to the plugin's shape: for plugins with source build scripts, run `pnpm run build && pnpm run typecheck && pnpm run test` after updating the version and prompt (clear incremental caches using the project's cleanup procedure — see common error 1); paste-input maintains `lib/` directly and has none of those scripts, so run `node --check lib/index.js && node --check lib/client.js` and inspect the artifact's version constants and update prompt instead.
5. Verify that the final `lib/client.js` version constant and prompt tag match the intended release; restart the target host + hard-refresh the browser and verify these final artifacts on the real host (the client/host effective-mode split is common error 6). Fill in the matrix's actual results after verification passes.
6. Commit the version, prompt, final artifacts, and docs → tag → push to every mirror → **verify the remote SHA and tag target on each mirror** (§9: every tag the docs reference must exist on every mirror).

### New pitfalls hit while riding the train (not in the original example)

- **Version constants are baked at build time**: a plugin's `import pkg from '../../package.json'` version gets **baked into `lib/client.js`** at bundling. Tagging after bumping `package.json` alone ships a self-inconsistent tag — the in-plugin update chip compares the *artifact's* old version against the new remote tag and offers an update forever, even on the latest install. Update the version and prompt before rebuilding; verify the artifact's version constant and prompt tag before tagging, and commit the final artifacts together with the changes.
- **dist-tag drift**: while riding the train, the umbrella package's npm `latest` drifted from `0.1.1-rc.2` to `0.1.2-rc.1` (measured 2026-09-04), so an unpinned `npm i -g @deepseek-ai/dsh` installs different content over time — verification environments must **pin the exact version** (the rc.1 corridor card's npm-channels note has the per-tag measurements).
- **Zero-diff edges still get full verification**: a pure version-stamp edge like rc.1 invites skipping straight to the declaration — still complete the checks appropriate to each plugin: build/typecheck/test for source plugins, artifact syntax and content checks for plugins maintaining lib directly, and a real-host boot for both (this fleet verified on dsh-v0.1.2-rc.1 + Windows).

## Plugin Repositories

- https://github.com/lhh010/dsh-ui-whale (migrated at v0.3.5)
- https://github.com/lhh010/dsh-ui-progress (v0.9.4)
- https://github.com/lhh010/dsh-input-history (v0.1.4)
- https://github.com/lhh010/dsh-minigames (v0.3.7)
- https://github.com/lhh010/dsh-paste-input (v0.1.6)
- https://github.com/lhh010/dsh-file-trace (written on 0.1.2-alpha.1)

As of 2026-09-04 all six plugins declare compatibility with `dsh-v0.1.2-rc.1` (final versions in the "Follow-up" section).
