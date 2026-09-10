---
name: plugin-runtime-debug
description: Use when an installed DSH Web plugin misbehaves only at runtime in the browser — paste/attachment/composer features that work once then fail, chips or panels showing stale placeholder state, update chips claiming the wrong version — and the fix must be diagnosed against the exact host API semantics rather than guessed from names. Also use when reviewing a plugin's calls into input-machine or facade verbs (insert, consume, remove, subscribe) before a release.
---

# Debug DSH Web Plugin Runtime Behavior

External Web plugins call host client APIs whose contracts live in the DSH
source tree, not in the plugin's own types. When behavior diverges from
intent at runtime, the failure is almost always a misread contract — and the
diagnosis must come from the host source, never from the API's name.

## The standing rule: read the verb's contract in the host source first

Before changing any call into a host API, open the implementing package in
the DSH source checkout (`~/.dsh/source/current`, or the vendored copy) and
read the actual method — its doc comment, its guards, and the types it
compares against. Repeat for every value the plugin passes. Three questions
cover most incidents:

1. **Which text does an offset count into?** When a verb takes a span or an
   offset, find out what string those numbers index. Published snapshot
   fields and internal editor projections are not always the same string; a
   plugin that feeds one representation's offsets into a verb whose guard
   compares against another representation fails silently — the call returns
   `false` or no-ops, nothing throws.
2. **What does one "unit" weigh in each representation?** If the document
   contains opaque inline units (chips, tokens, attachments), check whether a
   unit occupies the same width in the published field as in the projection
   the verb guards. When widths differ, offsets are only correct while no
   unit exists — verify what the first call succeeding and every later call
   failing tells you.
3. **When the verb declines, who notices?** A boolean-returning verb that
   fails silently turns into a downstream state bug: the caller deletes its
   own bookkeeping anyway, and the UI renders a "missing/unavailable"
   placeholder next to an object that never went away. Audit every call site
   for the "fire, ignore the result, clean up state anyway" shape.

## Symptom families and where they point

- **First interaction works, every subsequent one errors** — state written by
  the earlier call changed the mapping between what the plugin computes and
  what the verb expects. Compare the two representations before and after
  one insertion; derive the correction from the unit widths in the host
  source, then apply the same derivation at *every* call site that passes
  offsets, not just the crashing one.
- **A removal button leaves the row behind with a placeholder label** — the
  removal verb declined (see question 3) while bookkeeping was already
  dropped. Confirm with the verb's return value, and only retire the
  bookkeeping after the removal actually applied.
- **Derived UI shows stale or phantom entries** — find the authoritative
  source of the fact and derive the view from it. A plugin-side cache with a
  subscription that retires entries on any transient snapshot (an empty
  moment during reconcile/remount) will drop live entries; prefer reading the
  live published state at decision time and treat the cache as an accelerator
  only.
- **Update/version chips report a wrong "latest"** — remote tag and raw-file
  endpoints are CDN-cached and lag minutes behind a real push. Never present
  a fetched remote value as ground truth when it can be older than the
  running build; decide "current vs update" against the running version and
  display the newer of the two.
- **A whole slot's UI silently vanishes after a release** — a throwing
  expression inside a slot component (classically a dangling identifier:
  another component's state variable referenced out of scope) is caught by
  the framework's slot-level error boundary, which unmounts the entire
  entry; the error is console-only, so users just report "the chips/panel
  are gone". Two latency mechanisms hide it from the author: an `||`
  short-circuit keeps the expression unevaluated until the left operand is
  false, and components that early-return on the empty state never evaluate
  it until real data renders. Do not blame the newest diff by default —
  bisect by rollback or a minimal render mount with data present, check
  whether the throwing line shipped earlier, and fix by removing the
  reference (scope any such state locally). Cheap hardening for slot
  components: defensive reads (`x?.items ?? []`) and optional-chained DOM
  access (`target.closest?.()`) — inside an error boundary any throw costs
  the whole slot.
- **Repo edits never reach the GUI / EBUSY under the profile's node_modules** —
  first determine the install mode: `Get-Item <profile>/node_modules/<pkg> |
  Select LinkType, Target` (or the `link:<path>` marker in cordis.patch.yml).
  A Junction/link install means the repo working tree IS the installed copy —
  no copy step exists or is needed, and Copy-Item into node_modules is a
  no-op at best. The EBUSY holder is the running dsh host process (closing
  the browser does not release it), and the browser can still serve a cached
  client bundle after the host restarts. Activation for a link-installed
  lib-only plugin: fully stop the host, restart `dsh web`, hard-refresh,
  then verify the loaded version marker. Never rename-aside files under an
  unresolved path: through a junction "two" directories are one, and the
  rename moves the only copy. A source-launched host (`pnpm dsh web` in the
  harness checkout) adds two constraints: the client bundle combo is
  assembled once at boot (no HMR rebuilds it — every plugin edit needs a
  full host restart), and on Windows the listener port stays bound by the
  dying tree unless you stop the whole process tree
  (`taskkill /PID <pid> /T /F`), or the next boot dies on EADDRINUSE.
- **One plugin with raw ESM in its client bundle takes every plugin down,
  and the error names an innocent entry** — the host concatenates all client
  bundles into one classic `<script>` combo; a single top-level `import`
  anywhere makes the whole multi-megabyte combo fail to compile, zero
  plugins register, and the browser surfaces `failed to import loader
  entry <first-entry>` — the first awaited entry (often
  `dsh-typert-registry`, itself perfectly fine), not the culprit. Do not
  chase the named entry: bisect the profile's `insert` rows (or point the
  suspect bundle through `node --check`) until the combo loads again. The
  client half is not a bare ESM module — it must register through
  `window.__ModuleLoader__.load({ id, factory })`, pull react inside the
  factory via `require("react")`, and export `inject`/`apply`.


- **Phantom pixels at the right edges of a terminal sprite (outline, Z symbols, hearts), and ghost pixels surviving frame switches** — two half-block ANSI rendering defects, both invisible in the frame data: (a) a half-filled cell (upper-half block with only one half colored) sets the foreground but leaves the SGR background from the PREVIOUS cell set — SGR persists across cells, so the stale background paints a phantom pixel into the empty half; reset it explicitly (ESC[49m on every half-filled cell). (b) rows trimmed at their trailing transparent cells let a NARROWER frame leave the previous frame's pixels to the right of the trim — paint every row across the full sprite width (transparent cells as plain spaces) and close with an erase-to-EOL (ESC[K). And pin the frame data itself: hand-ported sprite frames drift from the source art a few cells at a time (a regression over an excerpt misses it) — digest every frame against the source and assert the digests.
- **A head/UI process hangs for minutes (or until the CI timeout) after its work is done** — a rescheduling timer chain (an animation planner that re-arms setTimeout forever while mounted) keeps the event loop alive on hosts that mount the component without ever unmounting it (probe and test hosts; a GitHub job defaults to a 6h timeout). The interactive TUI stays alive on its TTY/stdin handles regardless — so unref the chain (timer.unref()): the probes drain and exit, real sessions lose nothing. Suspect this whenever enabling a feature flips previously-finishing jobs into timeouts.


## Workflow

1. Reproduce once and capture the exact user-visible strings (toast text,
   chip labels, console output) — they are the contract of the bug report.
2. Map each string to the code path that emitted it; identify the host verb
   at the boundary.
3. Open the host source for that verb; answer the three standing questions.
4. State the mismatch precisely (which representation, which guard, which
   call sites) before writing any fix; if you cannot state it, you have not
   read enough source.
5. Fix every call site that passes representation-dependent values, not only
   the reported symptom; the same mismatch usually breaks two features
   through two different verbs.
6. Prove the fix with the interaction sequence that failed: repeat the
   action twice in a row and assert both attempts behave identically, and
   assert the removal path clears every view of the object.
7. For lib-only plugin bundles (no build step): keep hand-inlined version
   constants in sync with `package.json`, syntax-check the bundle
   (`node --check`), and verify in the browser after a hard refresh — the
   served artifact is the file you edited.