# Upgrade Adaptation: dsh-v0.1.2-alpha.2 ← dsh-v0.1.2-alpha.1

External-compatibility audit for plugin authors, integrators, and data holders. Companion artifacts in this directory: `CHANGELOG.md` (157 commits, categorized), `commits.txt`, `files.txt` (name-status), `diffstat.txt`, `alpha1-to-alpha2.diff` (full diff).

Range: `dsh-v0.1.2-alpha.1` (2026-08-28) → `dsh-v0.1.2-alpha.2` (2026-08-30). Release commit: `3f1b46a5db` release(dsh): 0.1.2-alpha.2 (merged via PR #3334, `0a53fb55be`). 234 commits total (157 non-merge). 1,604 files changed, +27,862 / −14,050.

History is merge-base-pure: `git merge-base dsh-v0.1.2-alpha.1 dsh-v0.1.2-alpha.2` = `cd5ef81481` = alpha.1 itself (the PR #3248 merge commit). No rebase or base drift, so the range log and the tree diff describe the same change set.

## Verdict

Smaller than the previous transition (rc2→alpha1: 796 non-merge commits / 6,421 files; this one: 156 / 1,604) but with a **higher density of externally visible changes**, including the first two explicit reverts ("回滚") in this release line:

1. **`revert(session): restore ignorable event compatibility`** (`2c6ff296af`, PR #3325) — undoes alpha.1's fail-closed unknown-event vocabulary (PR #3087). Side effect: the SQLite session-store physical schema changed under it, so **alpha.2 hard-rejects every SQLite session DB written by alpha.1** (§2). JSONL logs stay compatible.
2. **`fix(web): restore localized permission labels`** (`9e1bdefc72`, PR #3326) — re-lands the localized permission labels that a prior merge dropped (web UI only).

Both projection-review reverts (`2a4f6541d6`, `842f42d7ea`) are internal plugin-registration form changes, visible only to authors hand-registering goal/permission/plan projection units.

No commit carries a `BREAKING CHANGE` footer. Breaking items below are flagged **BREAKING** with the affected consumer class.

## 1. Reverts (rollbacks relative to alpha.1)

- `2c6ff296af` Revert "Merge pull request #3087 …remove-ignorable-session-events" + `b7bccd5897` docs repair + `b7a77f4f08` merge-forward. Alpha.1 refused to interpret any log containing an unknown event type; alpha.2 restores the `ignorable` envelope marker: unknown events marked `ignorable: true` are skipped, unmarked unknown events still refuse (message now reads "…unknown to this harness **and not marked ignorable**; refusing…"). `SessionEvent` gains `ignorable?: true` (envelope validator accepts only `ignorable: true`). This is additive relaxation toward older semantics, but it repurposed the SQLite packed-row column (§2).
- `9e1bdefc72` restore localized permission labels (web UI copy only).
- `2a4f6541d6` / `842f42d7ea` projection-registration form: pre-existing goal, permission-presets, and plan-mode units go back to the `ctx.inject(['sessionProjections'], …)` child-registration form; new projection units keep required-inject direct register. Internal; no public symbol change.

## 2. SQLite session store: schema 19 → 20, hard reject both directions (BREAKING for session data)

`packages/session/session-persistence-sqlite`: `SCHEMA_VERSION` 19 → 20; `events.is_packed INTEGER NOT NULL CHECK(0,1)` becomes nullable `ignorable INTEGER CHECK(NULL/0/1)` (`ignorable=0` = packed chunk-run sentinel, `ignorable=1` = ignorable scalar, `NULL` = ordinary). `set-user-version-19.sql` deleted, `set-user-version-20.sql` added.

- `configureDatabase` throws `session database at "<path>" has schema version 19, incompatible with this build (20)` before any read. **No migration** (pre-release stance: "rejected, never migrated"). Alpha.1-created SQLite session DBs are unopenable by alpha.2; the file is untouched, so recovery is: open with the alpha.1 binary, or export externally, then let alpha.2 start a fresh store.
- Lineage for context: rc2=17 → alpha.1=19 → alpha.2=20. Every step hard-rejects; this is not a new policy, but it IS a new break relative to alpha.1 specifically.
- JSONL is unaffected: `SESSION_FORMAT_VERSION` stays 0; envelope and record encoding byte-identical when `ignorable` is absent. Alpha.2 reads every alpha.1 JSONL log identically. Asymmetry: alpha.1 cannot read alpha.2 logs that contain `ignorable`-marked events (envelope validator rejects the extra key) — intended forward-compat, not a regression.

## 3. Remote failure vocabulary converged → `RemoteError` + namespaced codes (BREAKING for RPC/web clients)

Commit `804b1ffbfc` "refactor(api): converge the Remote failure vocabulary and client surface" (+1,081 files across packages/api + packages/typert).

Wire-visible (gateway/BFF clients that match on error code strings):

- All 17 gateway codes renamed bare → namespaced: `ambiguous-endpoint` → `gateway/ambiguous-endpoint` … (`packages/api/gateway/src/types.ts`). Domain codes likewise: `bad-request` → `gateway/bad-request`, `session-not-found` → `session/not-found`, `agent-preset-not-found` → `agent-preset/not-found`, `settings-conflict` → `settings/conflict`, `credential-rejected` → `credential/rejected`, `workspace-*` → `workspace/*`, `directory-*` → `directory-picker/*`, subagent codes → `subagent/*`. New `gateway/cancelled`; `agent-preset/invalid` added, `agent-preset-invalid` removed.
- The generic `internal` wrapper around agent-preset failures is gone — unrelated failures now propagate raw as thrown errors instead of `{code:'internal'}`.
- Remote method names unchanged; no HTTP routes added or removed; one additive optional field: `SessionWireEvent.ignorable?: true`.

Compile-visible (TS consumers):

- Removed types/classes: `ClientResult`, `ClientFailure`, `transportResult` (`packages/api/session-controller/src/client/contract/result.ts` deleted), `RpcError`, `RpcErrorCode`, `RpcErrorDetailsMap` (`packages/client/connection/src/rpc.ts`), `RemoteStreamError` (`packages/api/gateway`), `sessionStreamFailure`, `SessionError`, `WorkspaceError`, `SettingsError`, `CredentialError` maps, `TypertLookupFailure`, `TypertRemoteFailure`, `LlmModelDiscoveryError` re-export, and six agent-preset error classes (`UnknownPresetError`, `PresetMountError`, `PresetLockedError`, `InvalidPresetIdError`, `PresetExistsError`, `PresetNotWritableError`) with `AgentPresetError` / `AgentPresetErrorDetailsMap`.
- Replacements (new in typert-protocol/gateway): `RemoteError` class, `remoteErrorOf()`, `RemoteFailure` / `RemoteResult`, `RemoteErrorCode`, `RemoteErrorDetailsMap` (domain owners module-augment it), `isRemoteFailure`, `RemoteHostFacts`. Discriminate by `error.code`, not `instanceof`.
- Runtime export removal: `SESSION_CONTROLLER_REMOTE_EVENTS` (`@deepseek-ai/dsh-api-session-controller/remote-events`) is now type-only; the forwarded event set itself is unchanged (`api-session/activity|added|error|removed|status`).

**Adapt:** any client narrowing failures by class or by bare code string must switch to the namespaced `RemoteErrorCode` vocabulary.

## 4. Shared primitives moved to new packages (BREAKING for importers of the old paths)

New packages: `@deepseek-ai/dsh-util-values` (`JsonValue`, `isJsonValue`, `snapshotJsonValue`, `deepEqualJson`, `assertNever`, `deepFreeze`), `@deepseek-ai/dsh-deque`, `@deepseek-ai/dsh-util-time`, plus `brandString` in `@deepseek-ai/dsh-brand`.

- `@deepseek-ai/dsh-session` root no longer exports `isJsonValue`, `snapshotJsonValue`, `JsonValue` (`src/json.ts` deleted → `packages/util/values/src/index.ts`, implementation verbatim).
- `@deepseek-ai/dsh-llm` no longer exports `assertNever` / `deepFreeze`.
- `@deepseek-ai/dsh-tools` no longer re-exports `JsonValue`; `SDK_SECTION_ORDER` const removed from `./src/*` path.
- `@deepseek-ai/dsh-settings` no longer exports `deepEqualJson`.
- Brand factories (`SessionId`, `ToolCallId`, `MessageId`) keep their names/signatures in their owning packages (now `brandString`-backed) — not removals.

## 5. Settings API rework (BREAKING for plugin authors registering settings sections)

`@deepseek-ai/dsh-settings`:

- `settingsNamespace(value)` brand function **removed**. Namespaces are plain literal strings, type-checked via `SettingsNamespaceInput`; runtime `TypeError` for names not matching `^[a-z][a-z0-9-]*$` (untyped JS strings previously passed silently — misconfiguration now fails loud).
- `installSettingsSection(ctx, ns, …)` free function **removed** → service method `SettingsProvider.installSection(ns, schema, entry, hooks)` (same `SettingsSectionHooks` type).
- Per-package namespace constants renamed (values unchanged): `AGENT_LOOP_SETTINGS_NAMESPACE`, `AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE`, `SHELL_SETTINGS_NAMESPACE`, `WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE`, `PERMISSION_SETTINGS_NAMESPACE`.
- `settings.yaml` document format unchanged.

## 6. System-prompt ordering API (BREAKING for prompt-positioning plugins)

`@deepseek-ai/dsh-system-prompt` removes `FIRST_PARTY_SECTION_ORDER` and `PERSONA_ORDER` (alpha.2 has zero remaining refs). Replacements: `SystemPrompt.getSectionOrder(name)` / `getContextOrder(name)` with exported name types `PromptSectionOrderName`, `PromptContextOrderName`; new centralized context placements `SANDBOX_POLICY: 110`, `APPROVAL_POLICY: 115`, `SUBAGENT_DELEGATION: 120`. `PERSONA_SECTION` string kept. **Rendered prompt output is byte-identical** (order values unchanged); only the accessor moved. `@deepseek-ai/dsh-persona` drops its `PERSONA_ORDER` re-export.

## 7. Session projections become a hard dependency (BREAKING for custom profiles)

`session-projection` existed at alpha.1 (dsh-base already mounted it), but alpha.2 makes `sessionProjections` a **hard injection** across the ecosystem: `agent-loop`, `agent`, `agent-instructions`, `agent-presets`, `goal`, `tool-goal`, `hooks-claude-code`, `hooks-codex`, `llm-retry`, `permission-presets`, `plan-mode`, `sandbox-policy`, `session-title`, `terminal-bash`, `time-context`, `tmux-context`, `token-meter`, `tool-session-query`, `tool-subagent`, `tool-todo` (~19 plugins, see `docs/config-catalog.md` `Requires:`).

- **Custom cordis.yml graphs / patch overlays** that mount any of these without `@deepseek-ai/dsh-session-projection` now **fail loud at load**. Shipped profiles are fine: base already mounts it; `sdk-minimal` gained the row (`packages/bundle/sdk-minimal/cordis.patch.yml`).
- Event-scan folds became projection units: `foldTeam` → `teamProjectionDefinition` (`fold.ts` renamed `projection.ts`), `foldPlanMode` → `planProjectionDefinition`, `effectivePermissionPreset`/`applyKnobEvent` → permission projection + `resolve`/`derive`, `effectiveSandboxMode` → `sandboxMode` projection unit, `collectSessionTitleMessages` → private under `titleProjectionDefinition` + new `titleInput` projection key (stateVersion 3). All fold results over unchanged logs are identical.
- New public projection type: `TurnBoundaryProjection` (`@deepseek-ai/dsh-agent`), `turnBoundaryProjectionDefinition` (`@deepseek-ai/dsh-agent-loop`, stateVersion 2). `lastTurn`/step-boundary logic reads the projection instead of scanning `session.events` — same observable values.

## 8. Connection / gateway behavior (visible to remote clients)

- Connection state machine: `reconnecting` → split `disconnected` / `connecting`; new `reconnect()` and `setNetworkAvailable()`, `onReconnectRequested` sink; stream clients now delegate retry to the Connection (`packages/client/connection`).
- Gateway heartbeat default `websocketHeartbeatIntervalMs` **30000 → 2000** with a pong deadline that terminates peers missing a pong before the next interval (`packages/api/gateway/src/index.ts`, `stream-server.ts`). Set the config key explicitly if a 30s cadence was assumed.
- `$host` RemoteHostFacts broadcast added; gateway peerDependencies trimmed to cordis only.

## 9. Web UI removals (behavior changes)

- `ConnectionBanner` → `ConnectionIndicator` / `ConnectionIndicatorState` (same package `@deepseek-ai/dsh-client-ui-primitives`).
- `AgentPresetRow` + `PresetMenu` (+ `AgentPresetRowProps`/`AgentPresetRowInjected`) removed from `@deepseek-ai/dsh-client-ui-agent-preset`; preset composition UI moved to the plugin-inventory settings tab (`ui-settings-plugin-inventory`, grouped by scope).
- `TurnUsageDisclosure` removed (per-turn usage panel collapsed into a clickable turn-tail meta line) — never package-exported; visual change only.

## 10. Publishing and distribution

- All packages: `publishConfig.access: "public"`, explicit `files` lists, and `@deepseek-ai/cordis` moved to `peerDependencies` (release gate verifies dependency faces and npm-install layout; `feat: enforce published dependency policy`, `9162bc69bd`). Vendored framework bumped: **cordis 4.0.2, cosmokit 1.8.3, schemastery 3.18.2, timer 1.1.4, loader 1.0.3, hmr 1.0.17, include 1.0.7, logger-console 1.0.2, group 1.0.2** (`release(vendor)`, `6af96785b5`) — plugin authors must match the cordis 4.0.x peer range.
- Prerelease dist-tags: dsh alpha builds publish under the `alpha` dist-tag, canary/rc under `next` (`45455aae77`); `latest` no longer receives prereleases. Update install commands (`npm i @deepseek-ai/dsh@alpha`) accordingly.
- `release.yml` gains a `dependencies` job (verify-package-dependencies + verify-npm-install-layout) gating `pack`; publish path itself unchanged (manual dispatch from a `dsh-v*` tag).
- CI now tests Node 24.9 (v1-loader window) and ships the loader shape-detection fix (vendor loader 1.0.3): `dsh web` no longer serves an empty client graph on Node 24.0–24.11.1 — an external bug fix, not a break.

## 11. Confirmed unchanged (compatibility holds)

- **SDK JSON-RPC wire protocol**: `packages/sdk/protocol` byte-identical (requests `initialize`/`session/prompt`/`shutdown`, notifications `session.event`/`session.status`/`subagent.started`/`subagent.finished`, NDJSON framing, error codes). TS and Python SDK clients interoperate with alpha.2 servers in both directions; `python/sdk` untouched apart from one runtime dep. The `sdk` profile composition is unchanged.
- **CLI**: zero command, flag, or env-var removals in `apps/cli` / `cmdline`; no preset roster changes (standard / ptc / minimal / cordis intact — presets dir byte-identical). Additions only: schedule overlay example, `agent-presets` `./display` export + `compositionInventory()` (in-process, not `@Remote`).
- **Model-visible contracts**: `run_code` name and parameter schema text unchanged; tool registry/catalog unchanged; system-prompt section names, texts, and order values byte-identical; known event vocabulary unchanged (51 types).
- **HTTP surface**: no routes added or removed anywhere; no request-payload field changes in existing routes.
- **JSONL session logs**: alpha.2 reads every alpha.1 log identically (§2).

## 12. Boundary-signature table

Mechanical boundary comparison (merge-base-verified tree diff; package maps compared with jq across all 271→275 package.json files).

| API surface | alpha.1 | alpha.2 | changed? |
|---|---|---|---|
| package.json `exports`/`files`/`bin`/`main`/`types`/`engines` maps | 271 packages | 275 packages | **Narrowed/removed: none.** Additive only: `agent-presets` +`./display`, `schedule` +`./client`, 4 new packages (`ui-schedule`, `util/values`, `util/deque`, `util/time`) |
| `SESSION_FORMAT_VERSION` (JSONL log format) | `0` | `0` | unchanged — alpha.1 JSONL logs read identically by alpha.2 |
| SQLite `SCHEMA_VERSION` (session store) | `19` | `20` | **changed — hard reject, no migration, both directions** |
| Exported symbols per changed package (`src/index.ts`, 119 files swept) | — | — | changed in ~20 packages; removals itemized in §3–§7; brand factories kept |
| SDK JSON-RPC wire (`packages/sdk/protocol`) | 3 methods + 4 notifications | identical (byte-for-byte) | unchanged — TS/Python interop holds both directions |
| Gateway/BFF error-code vocabulary | bare codes (`ambiguous-endpoint`, `session-not-found`, …) | namespaced (`gateway/*`, `session/*`, …) | **changed on the wire** (§3) |
| HTTP routes (gateway/webserver/controllers) | — | — | unchanged (0 added, 0 removed); one additive optional wire field `ignorable` on session events |
| `dsh` CLI commands/flags/env/profiles | — | — | unchanged (`apps/cli`, `boot/cmdline`: zero source changes) |
| Model-visible tool contracts (`run_code` schema, tool catalog) | — | — | unchanged |
| System-prompt output (sections, order values) | — | — | unchanged (only the ordering accessor API moved, §6) |
| Known session event vocabulary | 51 types | 51 types | unchanged + optional `ignorable` envelope marker |
| Vendored `@deepseek-ai/cordis` peer range | cordis 4.0.x (1.0.2 line) | cordis 4.0.2 | changed patch-level; peer requirement now explicit (§10) |

## Adaptation checklist

1. Hold SQLite session data? Export via alpha.1 (`session-log-export` zip is unchanged) or accept the fresh store; alpha.2 will refuse the v19 file.
2. Match Remote failures by class/bare code? → `RemoteError` + `RemoteErrorCode` (`gateway/*`, `session/*`, …) via `remoteErrorOf()` / `isRemoteFailure`.
3. Import `JsonValue`/`isJsonValue`/`snapshotJsonValue`/`assertNever`/`deepFreeze`/`deepEqualJson`? → `@deepseek-ai/dsh-util-values`.
4. Call `settingsNamespace()` / `installSettingsSection()`? → plain namespace strings + `SettingsProvider.installSection(...)`.
5. Position prompt sections with `FIRST_PARTY_SECTION_ORDER` / `PERSONA_ORDER` / `SDK_SECTION_ORDER`? → `systemPrompt.getSectionOrder(name)`.
6. Hand-compose cordis.yml with any of the ~19 projection-consuming plugins? → mount `@deepseek-ai/dsh-session-projection`.
7. Use `foldTeam` / `foldPlanMode` / `effectivePermissionPreset` / `effectiveSandboxMode` / `collectSessionTitleMessages`? → the corresponding `*ProjectionDefinition` + registry.
8. Catch `RemoteStreamError` / use `ConnectionState.reconnecting`? → `RemoteError('gateway/…')` + `disconnected`/`connecting`; note the 2s heartbeat default.
9. Import `ConnectionBanner` / `AgentPresetRow` / `PresetMenu`? → `ConnectionIndicator`; plugin-inventory composition tab.
10. Pinning `@deepseek-ai/cordis`? → 4.0.2; installing the CLI? → use the `alpha` dist-tag.
