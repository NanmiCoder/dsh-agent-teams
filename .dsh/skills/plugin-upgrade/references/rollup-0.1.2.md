# Rollup · 0.1.1 → 0.1.2 Corridor

> Status: based on `dsh-v0.1.2-rc.1` (first release candidate of the 0.1.2 series). The 0.1.2 final release is not out yet — measured on npm dist-tags on 2026-09-04, `next` = `0.1.2-rc.1`, `alpha` = `0.1.2-alpha.5`, and the umbrella `@deepseek-ai/dsh` `latest` has moved to `0.1.2-rc.1` (a bare `npm install -g @deepseek-ai/dsh` now lands on this RC; pin `@0.1.1-rc.2` to stay on the 0.1.1 line) — the `@deepseek-ai/dsh-*` sub-packages still have `latest` at `0.0.1-rc.1` / `0.1.0-rc.6`, so install sub-packages with an explicit version or the `alpha`/`next` tag (the alpha.3→alpha.4 edge is carded in [v0.1.2-alpha.4.md](v0.1.2-alpha.4.md), the alpha.4→alpha.5 edge in [v0.1.2-alpha.5.md](v0.1.2-alpha.5.md), and the alpha.5→rc.1 edge in [v0.1.2-rc.1.md](v0.1.2-rc.1.md)). Once the final release ships, this file must be re-verified and promoted against the final tag (the original caveat in [issue #1](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/issues/1)).
> Scope: this file does not repeat the version cards. Each change is governed by its card; this file only covers corridor-level increments — cross-cohort coexistence, unpublished-cohort installation, CI/release coupling, pre-migration inventory and baseline attribution, boot-race handling, the three install-channel pitfalls, type-surface export drift, the host's own safety boundary, and the layered validation checklist.
> Card format: see [README.md](README.md). Touchpoint numbers correspond to the [pre-flight checklist](pre-flight.md).

## Table of contents

- How to use this rollup
- Card index (by touchpoint)
- Remote call error flow
- Corridor-level increments
  - R-01 · Target cohort dependency packages not fully published to npm
  - R-02 · Cross-cohort coexistence (old host cannot upgrade to an unpublished cohort)
  - R-03 · Third-party prebuilt plugins don't fit your shim
  - R-04 · CI and release pipeline coupling
  - R-05 · Pre-migration inventory of removed-package consumers
  - R-06 · Pre-migration baseline attribution — establish the exemption list first, then migrate
  - R-07 · Service boot race: bounded retry — no delay, no inject wait
  - R-08 · The three install-channel pitfalls: mirror lag, pnpm 11 supply-chain rules, peer-floor prerelease semantics
  - R-09 · The `link:` local install track for adding a plugin to a profile
  - R-10 · New precondition for mounting a shipped preset on a base-only profile (Host-scope services and same-name shadowing)
  - R-11 · 0.1.2 type-surface export drift (ledger not in the release notes)
  - R-12 · The upgrade target may be the currently running host
  - R-13 · After client product copy moves to localized seats, plugins that anchor to host UI by displayed text fail silently
- Layered validation checklist
- Rollback
- Pending confirmation

## How to use this rollup

0. Before starting the migration, collect the baseline per R-06 (i.e., layer 0 of the layered validation checklist);
1. First run [pre-flight.md](pre-flight.md) to find the touchpoint classes you hit;
2. Read the full corridor along `from → to` and compute the net state first: [v0.1.2-alpha.1.md](v0.1.2-alpha.1.md) → [v0.1.2-alpha.2.md](v0.1.2-alpha.2.md) → [v0.1.2-alpha.3.md](v0.1.2-alpha.3.md) → [v0.1.2-alpha.4.md](v0.1.2-alpha.4.md) → [v0.1.2-alpha.5.md](v0.1.2-alpha.5.md) → [v0.1.2-rc.1.md](v0.1.2-rc.1.md) (per-file card counts are in the [README.md](README.md) index; the alpha.2→alpha.3 edge has zero cards, alpha.3→alpha.4 has six, alpha.4→alpha.5 has three, alpha.5→rc.1 has zero);
3. Return to this file for corridor-level problems — these span single versions and are not covered by the cards;
4. Finish with the layered validation checklist at the end of this file.

## Card index (by touchpoint)

| Touchpoint | Related cards |
|---|---|
| #1 source patches | [DSH-0.1.2-A1-03](v0.1.2-alpha.1.md) |
| #2 events / persistent events | [DSH-0.1.2-A1-02](v0.1.2-alpha.1.md) → [DSH-0.1.2-A2-01](v0.1.2-alpha.2.md), also [DSH-0.1.2-A1-06](v0.1.2-alpha.1.md) |
| #3 services / Remote | [DSH-0.1.2-A1-01](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-06](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-11](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-20](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-21](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-22](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-30](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-31](v0.1.2-alpha.1.md), [DSH-0.1.2-A2-02](v0.1.2-alpha.2.md), [DSH-0.1.2-A2-05](v0.1.2-alpha.2.md), [DSH-0.1.2-A2-06](v0.1.2-alpha.2.md), [DSH-0.1.2-A2-08](v0.1.2-alpha.2.md), [DSH-0.1.2-A2-10](v0.1.2-alpha.2.md), [DSH-0.1.2-A1-25](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-27](v0.1.2-alpha.1.md) |
| #4 host directory read/write | [DSH-0.1.2-A1-04](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-13](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-21](v0.1.2-alpha.1.md) |
| #5 UI / commands / tools | [DSH-0.1.2-A1-03](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-06](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-09](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-10](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-11](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-29](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-26](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-28](v0.1.2-alpha.1.md) |
| #6 custom HTTP/WS/RPC/DOM/CSS | [DSH-0.1.2-A1-08](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-28](v0.1.2-alpha.1.md) |
| #7 subprocess / stdout / stderr | [DSH-0.1.2-A1-04](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-05](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-06](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-13](v0.1.2-alpha.1.md), [DSH-0.1.2-A2-04](v0.1.2-alpha.2.md) |
| #6/#7 Web startup and acceptance | [DSH-0.1.2-A1-19](v0.1.2-alpha.1.md) (auth URL, boot resource discovery, and real mount) |
| Special surfaces | permissions [DSH-0.1.2-A1-07](v0.1.2-alpha.1.md); privacy [DSH-0.1.2-A1-12](v0.1.2-alpha.1.md) / [DSH-0.1.2-A1-14](v0.1.2-alpha.1.md) / [DSH-0.1.2-A1-23](v0.1.2-alpha.1.md); packaging [DSH-0.1.2-A1-24](v0.1.2-alpha.1.md) / [DSH-0.1.2-A2-03](v0.1.2-alpha.2.md) |

> For cross-version revert-style changes, read the full corridor before touching anything: a field or its semantics may be removed in an intermediate version and restored in a later one
> (the canonical example is `ignorable`, removed by [DSH-0.1.2-A1-02](v0.1.2-alpha.1.md) and restored by [DSH-0.1.2-A2-01](v0.1.2-alpha.2.md)).
> When migrating, fold the corridor into its net state before modifying source — do not delete once for alpha.1 and then add it back for alpha.2;
> if the final target restores that semantics, defensive code in old-version adaptations should be removed rather than kept.

## Remote call error flow

Follows on from [DSH-0.1.2-A1-01](v0.1.2-alpha.1.md) and
[DSH-0.1.2-A2-02](v0.1.2-alpha.2.md). Unary Remote has returned
`Promise<RemoteResult<T>>` since rc.2; what alpha.2 changes is the `error` type and the error-code namespace: business/transport failures surface as `ok: false`; assembly/programming errors — wrong argument count, unmounted methods, a missing
Context adapter — can still reject, and should be exposed for fixing rather than swallowed and retried.

```typescript
const result = await ctx.remote.session.list({ limit: 10 })
if (!result.ok) {
  switch (result.error.code) {
    case 'gateway/cancelled':
      return // 结束或传播取消，不重试、不报通用错误
    case 'session/not-found':
      return null
    default:
      // 保留 code/details 并上报；仅明确瞬态、幂等且策略允许时重试
      throw result.error
  }
}
return result.value
```

Only when an upper layer catches the value from the explicit `throw result.error` should you use
`isRemoteFailure` (from `@deepseek-ai/dsh-api-gateway/client`) to tell a Remote failure from a local
defect; local defects keep propagating. Never use `instanceof RemoteError` across realms. `gateway/internal`
and unknown codes do not prove the request never executed; by default keep the original `code`/`details` and report them — do not blind-retry.

Source: [DSH-0.1.2-A2-02](v0.1.2-alpha.2.md) and
[ctx-remote-failure-vocabulary](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/.agents/notes/implemented/architecture/2026-08-28-ctx-remote-failure-vocabulary.md).

## Corridor-level increments

The following problems span single versions or fall outside the cards; they come from community practice ([discussion #5120](https://github.com/deepseek-ai/deepseek-harness/discussions/5120), the dsh-web migration of about 20 packages) and migration-pipeline experience.

### R-01 · Target cohort dependency packages not fully published to npm

- **Type**: process
- **Symptoms**: the root package or dist-tag being available does not mean every internal cohort package the plugin depends on directly has been published; enter this recipe only when an actual registry query reports a missing package.
- **Migration recipe**: record the exact missing package names/versions first. After confirming the registry is truly unavailable, build from the official tag in an isolated worktree and run `pnpm pack`, pinning to `file:` tarballs via `overrides`; do not describe every `0.1.2-alpha.*` as 404 wholesale.

  ```sh
  git clone https://github.com/deepseek-ai/deepseek-harness.git /tmp/dsh-build
  cd /tmp/dsh-build && git checkout dsh-v0.1.2-alpha.4
  pnpm install && pnpm run build
  mkdir -p ~/.dsh-cohorts/0.1.2-alpha.4
  pnpm -r exec pnpm pack --pack-destination ~/.dsh-cohorts/0.1.2-alpha.4
  ```

  In the manifest, write the range as `^0.1.2-alpha.4`; once the final release ships, deleting the overrides section returns to registry resolution.
- **Note (pending confirmation)**: the pnpm version pin below comes from a single field report and has not been reproduced in other repositories — the report says `11.9.0` bypasses overrides for file: tarball transitive dependencies when third-party peers are present, looking for nonexistent versions on the registry; pinning `packageManager: pnpm@11.24.0` resolves correctly. Before adopting it, run a minimal reproduction in the target repository; once verified, backfill the results and promote this entry (keep it in sync with the "Pending confirmation" section at the end of this file).
- **npm reality** (2026-08-31): on npm, the `@deepseek-ai/dsh-*` packages only have `0.1.1-rc.1`, `0.1.1-rc.2`, and `0.1.2-alpha.2`; alpha.1 was never published. rc.2 → alpha.1 can only be built from a GitHub tag; for the alpha.2 target, query the registry first. (Update: `0.1.2-alpha.3` and `0.1.2-alpha.4` are published under the `alpha` dist-tag — `alpha` resolves to alpha.4 as of 2026-09-02 — so the cohort steps above use the alpha.4 tag; the unpublished-cohort flow below stays as the fallback for any version the registry lacks.)
- **Verify-only, no install** ([dsh-TUI #622](https://github.com/ccch1mneyyy/dsh-TUI/pull/622)): keep the install baseline at rc.2; CI checks out the upstream tag and runs `tsc --noEmit` with the `paths` mapping from its `tsconfig.base.json` pointing at the source. This proves the type surface; runtime is verified separately — [dsh-TUI #647](https://github.com/ccch1mneyyy/dsh-TUI/pull/647) kept this lane even after going npm on alpha.2.
- **Verification**: `pnpm list --depth 0 | grep @deepseek-ai` all points at the target version, with no mixture.
- **Source**: item 1 of [#5120](https://github.com/deepseek-ai/deepseek-harness/discussions/5120). Not covered by the official release notes; community practice.

### R-02 · Cross-cohort coexistence (old host cannot upgrade to an unpublished cohort)

- **Type**: breaking (combined effect)
- **Symptoms**: an rc.2 host cannot be upgraded to an unpublished alpha, so the plugin must run on both cohorts. Two hard couplings surface: a client bundle that hard-`require`s platform modules during evaluation reports `missed the module table` on hosts that have no module-table entry for them; services registered only on the new host get written into a hard `inject` list, leaving the entry permanently `pending (waiting for service: …)` on old hosts.
- **Migration recipe**: one artifact + runtime resolution of the cohort surface.

  ```typescript
  // 共享 build 预设里生成 shim：不再 externalize 值导入，求值期用注入的 require 解析
  function resolveStoreEngine() {
    // 说明符拼接构造，避免被静态 external 扫描标记
    const platform = ['@deepseek-ai', 'dsh-client-store'].join('/')
    const legacy = ['@deepseek-ai', 'dsh-client-runtime', 'client'].join('/')
    try { return require(platform) } catch { return require(legacy) }
  }
  ```

  Only forward the shared value surface — cohort-specific exports must never be re-exported, otherwise new value imports fail at build time with missing-export instead of breaking silently. Type imports stay as before (erased at compile time).

  Take injected services out of the hard inject list and probe them at the use site; the cordis `remote` proxy throws for uninjected properties instead of returning undefined, so you must try/catch and fall back:

  ```typescript
  let presets
  try { presets = ctx.remote.agentPresets } catch { presets = undefined }
  const roster = presets ?? ctx.connection.api.agentPresets
  ```

- **Host-plane (Cordis composition) equivalent**: keep the artifact unchanged and put the cohort differences into `!!js` probes in `cordis.patch.yml` — the three forms (subpath resolve, reading preset files, probing package directories) and the two disciplines are in [host-plane-probes.md](host-plane-probes.md) ([dsh-TUI #622](https://github.com/ccch1mneyyy/dsh-TUI/pull/622)).
- **Rejected alternatives**: per-consumer try/catch duplicated through the source; emitting different artifacts per host cohort (reintroduces stateful builds); hard-waiting on inject wait (old hosts pending forever).
- **Verification**: link the same artifact to both an old host and a new host, and run one cold boot + one full conversation round on each.
- **Source**: items 3 and 4 of [#5120](https://github.com/deepseek-ai/deepseek-harness/discussions/5120).

### R-03 · Third-party prebuilt plugins don't fit your shim

- **Type**: breaking
- **Symptoms**: prebuilt npm content enters the profile, hard-requires the old specifier, and hits `missed the module table` on the new host just the same. Since you don't build it, the build preset's shim can't help.
- **Migration recipe**: keep `pnpm patch` (`patchedDependencies`) in the repository and rewrite that one require as the same dual-cohort probe. Don't forget the profile's parent-layer link — the link script may point the link back at the unpatched instance; it needs to point at the `patch_hash=…` instance.
- **Verification**: cold boot after patching and confirm the plugin's UI contribution points are visible and usable.
- **Source**: item 7 of [#5120](https://github.com/deepseek-ai/deepseek-harness/discussions/5120).

### R-04 · CI and release pipeline coupling

- **Type**: process
- **Symptoms**: once overrides point at file: tarballs, the frozen lockfile records machine-dependent absolute paths, and every runner's `pnpm install --frozen-lockfile` is missing the store. Also, while the cohort is unpublished, a version tag that triggers npm publish ships a package whose `@deepseek-ai/*` ranges cannot resolve from the registry — and that is irreversible for that version.
- **Migration recipe**:
  - Add a script that materializes the tarball store on any machine (resolves overrides; exits immediately if the store already exists), backing all pnpm-consuming jobs with an actions cache keyed by the `pnpm-workspace.yaml` (or `package.json`) hash;
  - Drop the `version` input from `pnpm/action-setup` so `packageManager` becomes the single source of version, avoiding conflicts with the pin;
  - Add an `NPM_PUBLISH_ENABLED` switch to the release workflow: tags still run all gates and smoke, but skip npm publish until the cohort ships officially;
  - **dist-tag for the plugin's own releases** (measured 2026-08-30): publish plugin versions that adapt an alpha cohort under a prerelease number (e.g. `0.18.0-alpha.0`) to the npm **`alpha` dist-tag**, keeping `latest` for the stable-host compatibility line — otherwise stable-host users get auto-upgraded to a new version with incompatible peers. The release workflow can pick `--tag alpha|latest` automatically from whether the version contains `-`;
  - CI mount lanes pin a dsh CLI version matching the target cohort, and write `minimumReleaseAgeExclude` when bootstrapping scratch profiles (see R-08), so CI on the first day after an alpha release does not fail by refusing to install fresh packages.
- **Verification**: `--frozen-lockfile` install succeeds on a clean runner; a tag rehearsal confirms no publish is produced.
- **Source**: items 8 and 9 of [#5120](https://github.com/deepseek-ai/deepseek-harness/discussions/5120).

### R-05 · Pre-migration inventory of removed-package consumers

- **Type**: process
- **Symptoms**: a plugin that builds only because it depends on a removed SDK package (continuing from [DSH-0.1.2-A1-01](v0.1.2-alpha.1.md)) is discovered mid-migration to be unbuildable and can only be retired along with the migration.
- **Migration recipe**: before migrating, run an inventory of "which removed packages are imported" across all plugins, and schedule "must retire" and "migratable" separately instead of discovering them mid-migration.
- **List of removed packages** (compared by the `name` in each tag's `packages/*/*/package.json`, 2026-08-31): rc.2 → alpha.1 removes 5 — `@deepseek-ai/dsh-acp-demo`, `dsh-acp-snapshot`, `dsh-client-runtime`, `dsh-host-apiproxy`, `dsh-sdk-jsonrpc-demo` — and adds 25. alpha.1 → alpha.2 removes none and adds `dsh-client-ui-schedule`, `dsh-deque`, `dsh-util-time`, `dsh-util-values`. Start the inventory by grepping these 5 names.
- **Verification**: the inventory matches the actual migration results, with no new retirement items discovered mid-way.
- **Source**: item 10 of [#5120](https://github.com/deepseek-ai/deepseek-harness/discussions/5120).

### R-06 · Pre-migration baseline attribution — establish the exemption list first, then migrate

- **Type**: process
- **Symptoms**: the plugin repository already has failures before the migration (tests/typecheck already red on the old cohort). After the migration the
   mechanical suite is all red, and you cannot tell "introduced by the migration" from "already there": fixing pre-existing failures along the way pollutes
   the migration diff and masks real regressions; not fixing and not reporting misattributes pre-existing failures to the migration. Both directions have
   actually happened: a clean tree with a red suite was reported as a regression; a dirty tree with green gates masked a runtime break (the layered validation
   checklist in this file targets the latter; this entry targets the former).
- **Migration recipe**:
  1. Before any migration writes, run the mechanical suite (build / typecheck / tests) in the repository's own dependency state (no target-cohort pin, no target
     env vars) and record the failure list and failure fingerprints — this is the baseline. Also pin down environment evidence: `HEAD`, working-tree state,
     lockfile hash, resolved dependency and tool versions, full commands and exit codes (timestamps are only auxiliary — the migration may be fully edited
     before its first commit, so timestamps cannot prove order).
  2. Baseline failures go into a do-not-fix exemption list: never fix pre-existing failures along the way during the migration — that belongs in another PR.
  3. After the migration, compare failure fingerprints (aggregated by command, test identifier, normalized path, and diagnostic message; bare error lines are
     only an approximation — moved lines and stack changes introduce noise): only failures new relative to the baseline count as migration failures; the test
     list must not shrink without justification (removing tests so the set gets smaller is not turning green).
  4. Fix loop (if entered): each round's input = the diff report + newly added failures (not full logs) + the fix history + the baseline exemption list; make
     minimal changes and stop as soon as new failures hit zero — pre-existing failures are out by definition.
  5. The final report follows the fixed sections of "Validation and reporting" in SKILL.md: pre-existing comes from the baseline (untouched, not attributed to
     this migration); migration-introduced changes are listed per touchpoint under "Completed"; residual host patches, together with upstream issue/PR links,
     go under "Pending/residual risk" (source format per the card spec in [README.md](README.md)).
- **Verification**: the baseline is collected before any migration writes (per the recorded environment evidence such as `HEAD`/lockfile hash); the final
  diff contains no incidental fixes to baseline-failing files; the report can answer "did this failure already exist before the migration" for every failure.
- **Source**: the pre-migration baseline stage of the dsh-migrate-bot unattended pipeline (a local extension on top of mechanical pin →
  A/B review → fix loop → patch report, dedicated to failure attribution; that stage had not been pushed publicly at the time of writing — re-check this
  description once it is public; see "Pending confirmation" at the end of this file). [#5120](https://github.com/deepseek-ai/deepseek-harness/discussions/5120)
  does not cover this practice; they are complementary: #5120 proves "all-green static gates ≠ runtime green", and this entry solves the other half
  — "static red ≠ the migration's fault".

### R-07 · Service boot race: bounded retry — no delay, no inject wait

- **Type**: process
- **Symptoms**: the plugin polls a dependent service immediately at startup and races the host's service-ready window; cold boot shows a
  `service-unavailable` loop. Layer 4 of the layered validation checklist requires observing this symptom but gives no handling recipe —
  this entry fills the gap.
- **Migration recipe**: only for the scenario where startup polls a dependent service expected to become ready, and the polled operation is read-only and idempotent:
  apply bounded retry to `code: 'service-unavailable'` — about 5 attempts with 2-second backoff, with caps on both total attempts and total duration, and retry
  parameters overridable by injection (for testability); after exhaustion, fail explicitly and report instead of waiting forever. The retry preconditions are the
  same as SKILL.md's safety boundaries: the error is retryable, the operation is idempotent, and policy allows. If the service does not exist on that cohort at all
  (permanently missing, not not-ready), use R-02's runtime-probe fallback rather than retrying.
- **Rejected alternatives**: blindly delaying the first poll (masks the race instead of solving it); putting the service back into inject wait
  (entry permanently `pending` on old cohorts, see R-02).
- **Verification**: no `service-unavailable` loop in the cold-boot logs; the injected retry policy takes effect in tests.
- **Source**: [#5120](https://github.com/deepseek-ai/deepseek-harness/discussions/5120)
  item 6 (dsh-web migration record, boot-race handling; the post mentions a decision note
  `2026-08-28-task-board-roster-poll-boot-race.md`, for which no public copy was located in the repository, so no direct link is attached).
  The recipe comes from the original post's author, zhu1090093659, recorded here in rollup format with thanks.

### R-08 · The three install-channel pitfalls: mirror lag, pnpm 11 supply-chain rules, peer-floor prerelease semantics

- **Type**: process
- **Symptoms**: cohort packages **are published** (on the npm `alpha` dist-tag since alpha.2) yet still fail to install or install uncleanly, through three independent mechanisms:
  1. Third-party mirrors (npmmirror and the like) lag fresh `@deepseek-ai/*` publications (transitive dependencies included) by hours or more, and installs report E404/ETARGET;
  2. pnpm 11's default `minimumReleaseAge` (the 24h supply-chain rule) refuses packages released less than a day ago — running a lane on the day an alpha ships hits this for sure; another trigger is an old lockfile pinned to versions that have vanished from the registry (e.g. `@deepseek-ai/*@0.0.1-rc.1`) or dependencies on `link:` local packages, reporting the same kind of 404/refusal;
  3. when the peer floor is written as an old range like `^0.1.0-rc.8`, npm semver's prerelease matching rules (the comparator must share the same tuple and carry a prerelease) judge it **not to match** `0.1.2-alpha.2` — install-time peer warning/refusal, regardless of actual host compatibility.
- **Migration recipe**:
  - Mirror lag: both CLI installs and pnpm inside profiles explicitly use the official registry via `export npm_config_registry=https://registry.npmjs.org`;
  - Supply-chain rules: prefer **per-scope exemption** over globally disabling — the consuming workspace (the repository root **and** the `pnpm-workspace.yaml` of scratch/user profiles) adds `minimumReleaseAgeExclude: ['@deepseek-ai/*', <your plugin name>]`; when an old lockfile pins vanished versions, delete `pnpm-lock.yaml` and regenerate; `minimumReleaseAge: 0` relaxes supply-chain protection repo-wide and is a last resort only;
  - Peer floor: when bumping cohorts, explicitly rewrite it to `^0.1.2-alpha.2` (after the rewrite, the install-time `Issues with peer dependencies` warning disappears and can serve as the landed signal).
- **Verification**: `pnpm list --depth 0 | grep @deepseek-ai` all points at the target version; `npm view @deepseek-ai/dsh dist-tags` confirms the target version's dist-tag matches the install channel; the install log has no peer warnings.
- **Source**: measured (2026-08-30, dsh-better-sidebar [PR #472](https://github.com/omdsh-dev/DSH-better-sidebar/pull/472): mirror E404, CI dependency exemption working on the day of the alpha release, warnings gone after the peer-floor rewrite). **Not covered by the official release notes**; community practice.

### R-09 · The `link:` local install track for adding a plugin to a profile

- **Type**: process
- **Symptoms**: when a cohort is not published to npm, [R-01](#r-01--target-cohort-dependency-packages-not-fully-published-to-npm) covers the plugin repository's dependencies on `@deepseek-ai/*`; the plugin itself also has to be installed into a profile for staging verification, and registry installation is equally unavailable (registry-side pitfalls — mirror lag, pnpm supply-chain rules, peer prerelease semantics — are covered in the install-channel-pitfalls entry).
- **Migration recipe**: use `link:` for profile-level dependencies — write `"<plugin package name>": "link:<absolute path to the plugin directory>"` into the `dependencies` of `profiles/<name>/package.json`, and `pnpm install` creates a junction. Two things go with it: the composition row's `name` uses the bare package name ([DSH-0.1.2-A1-26](v0.1.2-alpha.1.md)); verification always starts a separate staging instance (`dsh --profile <name> --port 30xx`, with the token printed to stdout) and never touches the production instance. Install-track resolution facts and GitHub-track pitfalls are in the plugin-release skill's "profile dependency management recipe" (#67).
- **Verification**: the junction is created; `dsh --profile <name> --dump-config` shows the correct row name with nothing pending; the boot graph includes the plugin; functional e2e passes.
- **Source**: community practice (dsh-input-history 0.1.1 → 0.2.0 migration, 2026-08); the install-track facts come from plugin-release's profile dependency management recipe (#67, merged 2026-08-31).

### R-10 · New precondition for mounting a shipped preset on a base-only profile (Host-scope services and same-name shadowing)

- **Type**: behavior
- **Symptoms**: on a profile that composes only `dsh-base` (+ your own bundle), mounting the shipped `standard` preset fails: `tool-subagent: modelSelectionSettings requires @deepseek-ai/dsh-tool-subagent/model-selection-settings in the Host scope`; and when you try to shadow the shipped preset with a same-named empty preset in a custom root, the shadowing does not take effect — discovery order favors shipped.
- **Migration recipe**:
  - Host composition (the bundle's `cordis.patch.yml`) needs one more line, `@deepseek-ai/dsh-tool-subagent/model-selection-settings` (the official web-app bundle has this line, `dsh-base` does not):

    ```yaml
    - insert:
        - id: subagent-model-selection-settings
          name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
    ```

  - When a test/controlled surface wants its own same-named preset, add `includeShippedRoot: false` to the agent-presets configuration; otherwise the same-named row in the custom root is shadowed by the shipped row.
- **Verification**: a base-only profile cold-boots without the "startup default preset did not take effect" warning and `composedPreset` returns standard; with `includeShippedRoot: false` the custom same-named preset is what gets mounted (not the shipped version).
- **Source**: [alpha.2 discovery.ts health check](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/preset/agent-presets/src/discovery.ts) · [the alpha.2 standard preset's tool-subagent row](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/preset/agent-presets/presets/standard/agent.cordis.yml) · [the official web-app bundle's host row](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/bundle/web-app/cordis.patch.yml) · dsh-tui measurement (2026-08-30, cordis.patch.yml + preset-join composition test)

### R-11 · 0.1.2 type-surface export drift (ledger not in the release notes)

- **Type**: breaking (typecheck surface)
- **Symptoms**: several types/functions directly importable in rc.2 move packages or leave the public surface by alpha.2, and typecheck fails in bulk with TS2305/TS2614; runtime does not necessarily break in sync — this is "static drift".
- **Migration recipe** (ledger; exports compared from npm tarballs on 2026-08-30, completed against the source of the three tags on 2026-08-31; each row marks which edge it happens on):

  | Old | New |
  |---|---|
  | `CallId` from `@deepseek-ai/dsh-llm` (rc.2 → alpha.1, `src/brand.ts:31`) | `ToolCallId` (same package, root export, branded) |
  | `ClientContext` / `SessionId` / `ConversationNode` / `CommandRowProps` from the removed `dsh-client-runtime/client` (rc.2 → alpha.1) | moved to Cordis `Context`, `@deepseek-ai/dsh-session/types`, `dsh-client-ui-conversation/client`, and `dsh-client-ui-chat/client` respectively; do type-only augmentation per owning package — see [API-10](api-migration-0.1.2-alpha.2.md#api-10--web-client-runtime-unbundling-keyed-chat-snapshots-and-command-attachment-parameters) |
  | `useSession` reading `ConversationSnapshot.nodes[]` (rc.2 → alpha.1) | on alpha.2 use `useChat`, keeping order via `ChatSnapshot.order` with `nodes.get(id)`; alpha.2-only code must not treat `legacy.nodes` as the primary data surface |
  | Host `ctx.commands.execute(agent, line, signal)` (rc.2 → alpha.1) | `ctx.commands.execute(agent, line, images, signal)`; pass `[]` explicitly when there are no images |
  | `JsonValue`, `isJsonValue`, `snapshotJsonValue` from `@deepseek-ai/dsh-session`, plus `dsh-tools`' re-export of `JsonValue` (alpha.1 → alpha.2) | the new package `@deepseek-ai/dsh-util-values` (add it as a direct dependency — see [DSH-0.1.2-A2-03](v0.1.2-alpha.2.md)) |
  | `deepFreeze`, `assertNever` from `@deepseek-ai/dsh-llm` (alpha.1 → alpha.2) | `@deepseek-ai/dsh-util-values` |
  | `collectSessionTitleMessages` from `@deepseek-ai/dsh-session-title` (alpha.1 → alpha.2, made private at `src/index.ts:167`) | moved off the public surface — fold locally with rc.2-equivalent semantics (the text of the first `user/message` whose `source.kind === 'user'`) or use `foldSessionTitle` |
  | the `SessionEventMap` type declaration for `'todo/write'` (rc.2 → alpha.1; rc.2 switches directly at `core/session/src/invariant.ts:150`) | merged only inside `@deepseek-ai/dsh-tool-todo`; if you don't depend on that package, add a local `declare module '@deepseek-ai/dsh-session/types'` matching the official `TodoItem` structure (the runtime event vocabulary is unchanged and `known-event-types` still lists it) |
  | `settingsNamespace()`, `installSettingsSection()`, `deepEqualJson()` from `@deepseek-ai/dsh-settings` (alpha.1 → alpha.2) | all deleted. Namespaces become plain string literals validated at compile time by `SettingsProvider.register<const Namespace extends string, T>(ns: Namespace & SettingsNamespaceInput<Namespace>, …)` (`src/index.ts:419`); `installSettingsSection` → `SettingsProvider.installSection(owner, ns, schema, entry, hooks)`; `deepEqualJson` → `dsh-util-values`. To have one source compile on both alpha.1 and alpha.2, write constants as `'my-ns' as SettingsNamespace` — the brand exists only at the type level; the runtime value is the same |
  | `InvalidPresetIdError`, `PresetExistsError`, `PresetNotWritableError`, `PresetLockedError`, `PresetMountError`, `UnknownPresetError`, `AgentPresetError`, `AgentPresetErrorDetailsMap` from `@deepseek-ai/dsh-agent-presets` (alpha.1 → alpha.2) | deleted, replaced by `RemoteError<'agent-preset/not-found' \| 'agent-preset/invalid' \| 'agent-preset/read-only' \| 'agent-preset/locked'>` (`src/types.ts:37-43`); switch `instanceof XxxError` to branching on `code` — see [DSH-0.1.2-A2-02](v0.1.2-alpha.2.md) |
  | `LlmModelDiscoveryError` from `@deepseek-ai/dsh-llm` (code `model-discovery-failed`; alpha.1 → alpha.2) | `RemoteError<'llm/model-discovery-rejected'>` (`src/types.ts:261`) |
  | `FIRST_PARTY_SECTION_ORDER`, `PERSONA_ORDER` from `@deepseek-ai/dsh-system-prompt` (alpha.1 → alpha.2) | deleted, replaced by `systemPrompt.getSectionOrder(name)` / `getContextOrder(name)` (parameter types `PromptSectionOrderName` / `PromptContextOrderName`) |
  | `TypertRemoteFailure`, `TypertLookupFailure` from `@deepseek-ai/dsh-typert-protocol`; `RemoteStreamError` from `@deepseek-ai/dsh-api-gateway/client`; `RpcErrorDetailsMap`, `RpcErrorCode`, `RpcError` from `@deepseek-ai/dsh-client-connection` (alpha.1 → alpha.2) | deleted, unified into `RemoteError` — see [DSH-0.1.2-A2-02](v0.1.2-alpha.2.md) |

- **Verification**: typecheck all green without relying on `@ts-ignore`; locally merged declarations match the official structures field by field; the runtime event flow is the same as rc.2.
- **Source**: comparison of each package's `0.1.2-alpha.2` tarball exports + [alpha.2 todo tool types.ts](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/todo/tool-todo/src/types.ts) · [alpha.2 `dsh-util-values`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/util/values/src/index.ts) · [alpha.2 settings `register` signature](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/settings/settings/src/index.ts) · [alpha.2 agent-presets error codes](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/preset/agent-presets/src/types.ts) · [alpha.2 system-prompt](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/core/system-prompt/src/index.ts) · [alpha.2 llm types](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/llm/llm/src/types.ts) · [rc.2 `CallId`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/packages/llm/llm/src/brand.ts) · dsh-tui measurement (2026-08-30) · [dsh-TUI #647](https://github.com/ccch1mneyyy/dsh-TUI/pull/647) (`settingsNamespace` is the only compile break in alpha.1 → alpha.2)

### R-12 · The upgrade target may be the currently running host

- **Type**: security
- **Symptoms**:
   When developing or upgrading plugins inside DSH itself, the plugin, preset, runtime component, or dependency being modified may also be part of the Harness that is currently running.

   As a result, ordinary upgrade operations can directly affect the runtime environment that is executing the upgrade task itself — for example, stopping or restarting DSH, modifying the preset currently in use, modifying the Harness runtime, or uninstalling a plugin the current runtime depends on.

- **Migration recipe**:
   Before performing an operation that could affect the running host, first confirm whether the upgrade target belongs to the current session / profile / Harness host.

   At minimum, confirm:
   1. whether the target plugin is running in the current profile;
   2. whether the target preset is the preset the current Agent uses;
   3. whether the runtime / dependency being modified underpins the current Harness;
   4. whether the plugin about to be uninstalled is still depended on by the current runtime.

   If the target also belongs to the currently running host, the Agent must not unconditionally perform operations that could take the host down. Hand control back to the user for confirmation, or complete recovery through an external / manual path.

   For operations like `stop → start`, treat the whole switch as one atomic operation where possible, and make sure an independent recovery path exists.

- **Verification**:
   Before the upgrade, be able to identify the dependency relationship between the current Harness and the upgrade target.

   For operations that may affect the host, confirm:
   - the current host is not directly uninstalled or broken while it still depends on the target;
   - the restart operation has a clear recovery entry point;
   - there is still an independent way to recover or roll back if the host fails.

   This entry is a pre-upgrade safety check; "the plugin loaded successfully" is not a sufficient verification condition.

- **Source**:
   The background of the community upgrade discussion in [DeepSeek Harness Discussion #5120](https://github.com/deepseek-ai/deepseek-harness/discussions/5120), plus observations from earlier plugin development and upgrades done inside DSH itself.

### R-13 · After client product copy moves to localized seats, plugins that anchor to host UI by displayed text fail silently

- **Type**: behavior (combined effect)
- **Symptoms**: this corridor moves almost all client-package product copy to typed `t` / dictionaries (client-locale full rollout). Buttons, navigation, and preset labels in the host UI that were previously hardcoded/fixed English now render per locale (e.g. "Session log" → "Session 日志", the permission preset "Full access" → "完全权限", `access.fullLabel` removed, `access.preset.readOnly/workspaceWrite/fullAccess` added). Any plugin that locates/matches host UI **by the displayed text of host controls** no longer hits with the default-language regex → the lookup returns `null` → injected items (share entries, labels, etc.) disappear silently, with no error and no console exception.
- **Migration recipe**:
  1. When locating host-UI containers, **prefer stable slot / data-slot anchors** (e.g. `[data-slot="conversation.session.header.utilities"]`) over displayed text;
  2. when text matching is truly needed, **cover all language variants** (e.g. `/session\s*(?:log|日志)/i`) and constrain the length/scope so unrelated buttons are not matched;
  3. after injection, **explicitly assert the injected item actually renders** (present, non-empty, same row), turning "lookup returns null → element silently missing" into an observable failure;
  4. UI plugins that provide localized resources should register through the host's public language seat instead of a self-built i18n patch — see [DSH-0.1.2-A1-10](v0.1.2-alpha.1.md).
- **Verification**: switch to a non-English language and hard-refresh, then assert the injected item still appears in the host tool area, sits in the same row as host buttons, and is clickable; run it once in Chinese and once in English.
- **Source**: [client-locale-full-rollout note](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/.agents/notes/implemented/architecture/2026-07-30-client-locale-full-rollout.md) · [alpha.2 `HeaderAction.tsx` (`t('header.action')`)](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/session-query/session-log-export/src/client/HeaderAction.tsx) · [alpha.2 `PermissionSelect.tsx` (`access.preset.*`)](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/client/ui-conversation/src/client/skeleton/PermissionSelect.tsx) · [alpha.2 `locales.ts` (access copy)](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/client/ui-conversation/src/client/locales.ts)

## Layered validation checklist

Run in order (layer 0 only collects the baseline and sets no pass threshold); from then on, do not proceed to the next layer until the previous one passes:

0. **Baseline (before touching the migration)**: run the mechanical suite in the repository's own dependency state and record failure fingerprints and the exemption
   list (see R-06). Layers 2 and 3 (static and card-level unit tests) judge failure as "new relative to baseline"; the other layers have no corresponding baseline and keep their own absolute thresholds.
1. **Dependency resolution**: `pnpm list --depth 0 | grep @deepseek-ai` versions consistent; scan the full lockfile and confirm there is no old cohort, no removed `dsh-client-runtime`, and no accidentally retained old peer provider.
2. **Static**: typecheck + build. Note that all-green static checks cannot prove the wire contract — parameter drift at the descriptor layer is silent at this layer ([DSH-0.1.2-A1-01](v0.1.2-alpha.1.md)).
3. **Card-level unit tests**: at least one assertion per hit touchpoint. Remote call sites cover the known business codes on `ok: false`, the unknown-code fallback, and the gateway-layer catch branch; test doubles encode the same descriptor table and fail when keys are extra or missing, turning drift into a test-failure event. Also guard against "silent error swallowing": a call site that catches the error leaves the UI blank forever while every smoke stays green (a real instance is in the field note of [DSH-0.1.2-A1-30](v0.1.2-alpha.1.md)) — the contract shape must be pinned down by unit tests, and an empty UI counts as a failure in validation.
4. **Real cold boot**: one full conversation round (send message → tool call → reply). Observe the logs for no `missed the module table`, no `service-unavailable` loop, and no entry `pending`. Web Client plugins additionally follow [DSH-0.1.2-A1-19](v0.1.2-alpha.1.md): exchange the printed token URL for the cookie, read the boot entry, request the host's advertised resources, and verify bundle registration, real mount, remove, and page errors; check the registration id against the package name per [DSH-0.1.2-A1-26](v0.1.2-alpha.1.md). The alternative form of this layer that runs deterministically without an API key is the **mount smoke**: `pnpm build && pnpm pack` produces a tarball → a pinned CLI installs it into a fresh scratch profile with `dsh plugin --profile web add file:<tarball>` → start keyless `dsh web --port 0` → Playwright headless rendering scans tab by tab (asserting mount markers, no pageerror/console errors, and lazy chunks delivered correctly). Reference implementation: [dsh-better-sidebar e2e-mount.sh](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/scripts/e2e-mount.sh).
5. **Cross-cohort** (if R-02 was applied): run step 4 once on the old host and once on the new host.
6. **Headless** (if #7 is hit): compare exit codes and stdout/stderr content classification ([DSH-0.1.2-A1-05](v0.1.2-alpha.1.md)).

## Rollback

1. Before upgrading, record branch/HEAD, resolved versions, the lockfile, and hashes of the configuration that will change; stop if there are unfamiliar modifications;
2. migrate in a dedicated branch/worktree; never auto-stash, reset, clean, or checkout user files;
3. tarball-overrides rollback restores only the configuration and lockfile paths explicitly owned by this task, and shows the diff and obtains confirmation before executing;
4. arbitrary side effects of third-party lifecycle scripts cannot be promised rollback via Git; list residual risks truthfully;
5. if the problem originates from a host upgrade, prefer switching back to the recorded host version rather than blindly widening the plugin's dual-version branching.

## Pending confirmation

- The 0.1.2 final release's dist-tag, final tag name, and differences from the rc.1/alpha.5 content — all entries in this file must be re-reviewed after the release (rc.1, the first candidate, is on the `next` channel since 2026-09-03 and carries zero edge changes over alpha.5; see [v0.1.2-rc.1.md](v0.1.2-rc.1.md));
- R-01/R-02's pnpm version sensitivity and R-07's retry parameters (~5 attempts / 2-second backoff) both come from a single field report and have not been reproduced in other repositories;
- R-06's baseline-stage implementation has not been pushed publicly yet; re-check its source description once it is public. R-06 is an unverified practice (single-pipeline source, no multi-repository reproduction): step 0 of Mode C is the strongly recommended default action, adjustable to the target repository's actual situation.
