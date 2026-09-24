---
name: plugin-upgrade
description: Use for DSH plugin compatibility, migration, upgrade, regression, or post-upgrade diagnosis, including read-only review of already-migrated plugin source and version-boundary, API, dependency, activation, or runtime compatibility problems. Inspection and diagnosis stay read-only; show a plan and obtain confirmation before any configuration, dependency, or source write.
---

English | [简体中文](SKILL.zh-CN.md)

# plugin-upgrade

Safely handle three task types: read-only update inspection, installed-plugin upgrades, and DSH host version compatibility migration. If user intent is unclear, confirm the mode first; never let "help me check for updates" slide into installing or changing code.

Note: the version cards and reference docs under `references/` are in English; card IDs and cited commands are language-neutral.

## Step 0: choose a mode

| Mode | User intent | Default allowed action |
|---|---|---|
| A · inspect | Check for updates or assess impact from a DSH release | Read-only investigation and report; then stop |
| B · update | Upgrade an installed plugin to an explicit version | Plan and confirm before changing composition or dependencies |
| C · author-migrate | Upgrade a plugin author's source repository for a newer DSH host | Baseline, build the version corridor and touchpoint inventory, then implement the approved migration |

This skill does not handle "upgrade DSH core only and leave the plugins alone," and it must not modify DSH core to conceal plugin incompatibility.

## Global DSH host upgrades (agent discipline)

Upgrading the dsh host itself (`npm install -g @deepseek-ai/dsh@…`) is not Mode B/C plugin
work — and when the requesting agent runs INSIDE a dsh session it is structurally fatal:
the session IS the host process, npm removes/replaces the very package tree it executes
from, the host dies mid-install (the tool call never returns), and the interrupted install
leaves package content present WITHOUT regenerated shims — the `dsh` command itself is
gone until an external pinned re-install repairs it. Never execute the global host
upgrade from inside a session on that host; hand the user the external procedure:

1. fully stop every dsh process (a running host holds native-module file locks → EBUSY;
   a browser refresh is not a host stop);
2. from an EXTERNAL terminal, run the pinned install
   `npm install -g @deepseek-ai/dsh@<exact-version>` (a bare package name resolves to the
   `latest` dist-tag and can silently downgrade to an older line);
3. restart `dsh web`, hard-refresh the browser, verify version markers and plugins.

Because the host is fully stopped before npm runs, nothing crashes mid-install — a crash
during the upgrade is a signature of doing it wrong, not a risk to tolerate. If an install
was already interrupted: repair from an external shell by re-running the pinned formal
install (never hand-copy package directories or hand-write shims).

## Shared read-only preparation

1. Read the target repository's rules such as `AGENTS.md` / `CLAUDE.md`; check branch, HEAD, working tree, and submodules. Stop and report unfamiliar changes or untracked files; never auto-stash, reset, clean, or checkout.
2. Record source identity and installation identity separately: registry package, Git checkout, workspace/junction, or copied install; record the source repository/URL, Git SHA, actual package name, the plugin's own version, the declared/resolved DSH dependency cohort, and current DSH/Node versions. A plugin release version (for example `0.6.4 → 0.7.0-alpha.0`) is not the DSH host corridor (`0.1.0-rc.6 → 0.1.2-alpha.4`). GitHub owner/repo and registry scope/package are independent coordinates — do not derive or rewrite one from the other.
3. Preserve file ownership boundaries:
   - `package.json` / lockfile: package and dependencies;
   - `dsh-plugin.json`: community-standard manifest (if adopted);
   - `cordis.patch.yml` / `agent.cordis.yml` / legacy `cordis.yml`: profile composition;
   - resolved config: runtime composition result, used for verification only; never write the whole object back.
4. Verify the target version's source, tag/package name, compatibility range, release notes, install scripts, and known breaking changes. Never read, print, or commit tokens, `.npmrc` contents, credentials, or session logs.
5. Record the rollback baseline: current HEAD/package version, lockfile, and hashes/paths for configuration that may change. Describe recovery only for the explicit paths owned by this task; do not promise rollback of arbitrary third-party script side effects.

## Mode A · inspect (read-only)

Report: current/available versions, source, compatibility range, breaking changes, recommended target, risks, and a validation plan. Do not edit files, install dependencies, run lifecycle scripts, `git pull`, or switch versions. If the user decides to proceed, enter Mode B or C with separate confirmation.

## Mode B · update (upgrade an installed plugin)

1. Choose the single update mechanism that matches the resolved package identity and installation track; when a lockfile exists, use only its package manager — do not mix npm/pnpm/bun, and do not rewrite a registry package name to match a GitHub owner.
2. Produce a change plan: exact target version, commands to run, files that will change, lifecycle scripts that may run, configuration migration, and rollback steps.
3. Obtain explicit user confirmation before any write or install, even when no breaking change is known.
4. Make minimal changes in a dedicated branch/worktree; patch configuration by path and preserve unknown fields. For Git sources, fetch and compare an explicit tag or commit first; never `git pull` a dirty worktree.
5. Successful dependency installation does not mean DSH has enabled the plugin; verify the target profile's composition actually resolves to the target package, remove old source lines owned by this upgrade if any exist, and confirm the runtime entry is active.
6. Run "Validation and reporting"; on failure, restore only the paths owned by this task and report residual side effects.

## Mode C · author-migrate (migrate a plugin source repository with a DSH upgrade)

0. Run the baseline first: in the repository's own dependency state (no target pin, no target env) run the mechanical suite (build / typecheck / tests; these run package scripts, so first show the commands to be executed per the safety boundaries and obtain confirmation), and record pre-existing failures as an exemption list (see R-06 in [references/rollup-0.1.2.md](references/rollup-0.1.2.md); later corridors follow the same pattern). The migration must not add or worsen failures; pre-existing failures are exempted per the baseline.
1. Confirm exact from/to tags; connect version corridors by the `from → to` metadata in [references/README.md](references/README.md) — never by filename lexicographic order. If the source is older than the earliest card, mark that segment as an unsupported gap and derive it from exact-tag source, packed declarations, and reproducible tests; do not pretend a later card covers it.
2. Read the full corridor first and compute the final net state. When a field is removed in an intermediate version and restored in the target, do not delete and re-add it.
3. Scan the seven touchpoint classes per [pre-flight.md](references/pre-flight.md): source patches, events, services/Remote, host filesystem, UI/commands/tools, custom channels, subprocess/output. You may first run the read-only [migration planner](scripts/README.md) to generate paths/line numbers and candidate cards, but its results remain heuristic; zero hits still require checking dependencies/imports and running build plus a real mount.
4. Keep only cards that intersect the hit touchpoints and the actual face (Host / Web Client / ordinary plugin). Cards are a curated list, not a complete API diff; when corridor edges or API coordinates are missing, mark them unsupported/pending instead of changing things from memory.
5. Produce a source-migration plan grouped by Host/Web Client seam, listing hit files, cards, target behavior, and tests; obtain confirmation before implementing in a dedicated branch/worktree. Keep the DSH cohort exact and coherent in `package.json` and the lockfile; a successful install with mixed old/new peers is not a migration. If a selector or callback unexpectedly becomes `any`, run one diagnostic typecheck with `skipLibCheck: false` and declare the packages that own the consumed declarations directly. `capability` cards are suggestions only — never adopt them automatically.
6. After compatibility changes pass, choose and apply the plugin's own SemVer bump separately. Verify the packed filename and packed manifest both carry that plugin version; never use the DSH host version as the plugin release version by accident. For the removed `dsh-client-runtime`, keyed chat snapshots, command execution signature, or Workspace navigation (`connectWorkspace` / `pickDirectory`), use [the alpha.2 API ledger](references/api-migration-0.1.2-alpha.2.md) and [DSH-0.1.2-A1-32](references/v0.1.2-alpha.1.md).

## Safety boundaries

- Show the plan and obtain confirmation before any file write, install, version fetch/switch, or package script run;
- Never auto-stash/reset/clean/force-update, and never overwrite user or other agents' work;
- Never expose credentials; diagnostics may report only whether something is configured and non-sensitive versions/sources;
- Do not retry unknown `gateway/internal` or other failures by default; retry only when the error is retryable, the operation is idempotent, and policy allows;
- When a migration approach cannot be determined with high confidence from primary sources or reproducible behavior, stop automatic changes and mark it "pending review";
- When local observation conflicts with a primary source, record both, reproduce, and report — do not silently pick one side.

## Validation and reporting

Validate at least the applicable layers:

1. Dependency resolution: the package manager, lockfile, and dependency graph change only as expected; scan the full lockfile for the old DSH cohort and removed packages, not only top-level dependencies;
2. Enablement resolution: the target profile's composition points to the expected package identity, with no old source or duplicate rows;
3. Static: build, typecheck, and plugin tests; for the alpha.2 corridor, close out [references/precision-checklist.md](references/precision-checklist.md), keeping type declarations separate from runtime module/service activation and preserving existing channel protocols when applying the Connection auth gate;
4. Runtime: cold-start a real DSH profile; verify entry activation and that required/provided Cordis services do not remain pending — [verify-runtime.mjs](scripts/verify-runtime.mjs) runs this layer end-to-end in an isolated profile and reports failure attribution (plugin-code / dependency-resolution / profile-config / dsh-runtime). For a Web Client plugin, exchange the printed token URL for its cookie, read the host boot manifest, request the advertised client artifact, and prove registration/mount rather than accepting a bare HTTP 200;
5. Behavior: execute one core plugin path; host migrations must complete at least one message → tool → response flow, or an equivalent dedicated flow;
6. Wrapper: verify exit code, stdout, stderr, cancellation, and teardown.

Structure the report as:

- pre-existing (Mode C with the baseline run; other modes note "not collected"): the list of failures from the baseline (untouched, not attributed to this migration);
- **Completed**: versions, files, cards, and validation;
- **Skipped**: non-hits or inapplicable items with evidence;
- **Pending/residual risk**: missing sources, untested platforms, lifecycle-script side effects;
- **Rollback**: recorded baseline and recoverable paths;
- **Recommendations**: optional capabilities and follow-up work migrating to public seams.

## References

| File | Purpose |
|---|---|
| [references/README.md](references/README.md) | Version corridors, card schema, and maintenance rules |
| [references/pre-flight.md](references/pre-flight.md) | Seven-class touchpoint self-check and summary template |
| [references/troubleshooting.md](references/troubleshooting.md) | Post-migration symptom → root cause → card lookup |
| [references/v0.1.1-rc.1.md](references/v0.1.1-rc.1.md) | rc.8→rc.1 draft cards: repository-plugins mechanism removal, `dshClient`→`dsh.client` manifest merge, client-modules scan → bundle `dsh.client`, strict injection + weak `ctx.get`, session event contract, self-rendering client session aggregation, `tasks.peek` removal, 0812 service renames (vlln plugin migrations; corridor is the closest published-tag alignment for the internal 0810–0812 snapshot window) |
| [references/v0.1.1-rc.2.md](references/v0.1.1-rc.2.md) | rc.1→rc.2 reviewed cards (3, `DSH-0.1.1-R2`) |
| [references/v0.1.2-alpha.1.md](references/v0.1.2-alpha.1.md) | rc.2→alpha.1 curated cards |
| [references/v0.1.2-alpha.2.md](references/v0.1.2-alpha.2.md) | alpha.1→alpha.2 curated cards |
| [references/v0.1.2-alpha.3.md](references/v0.1.2-alpha.3.md) | alpha.2→alpha.3 curated cards (2): optional SQLite Session-persistence provider removed (opt-in databases need an older build to export, DSH-0.1.2-A3-02) and additive `settings.plugin.item` keyed-slot settings card capability (DSH-0.1.2-A3-01); carries the verification record |
| [references/v0.1.2-alpha.4.md](references/v0.1.2-alpha.4.md) | alpha.3→alpha.4 curated cards (6): `report` tool package removed in favour of `send_message`, Python code-runtime package renamed, `Session.events` replaced by `seq`/`eventAt`/`snapshotEvents`, branded `SessionSeq`/`SessionLogOffset` + `seedLength`→`isSeeded`, PTC preset drops `workflow`, base bundle enables `web_fetch`; carries a three-host verification record |
| [references/v0.1.2-alpha.5.md](references/v0.1.2-alpha.5.md) | alpha.4→alpha.5 curated cards (3): storage domains gain optional `compatibleVersions` read tolerance and `invalidRecords: 'backup-and-skip'` salvage; host fix for rc.2/alpha.3-era homes that refused to boot or dropped session titles on alpha.4; carries a storage-layer reproduction record |
| [references/v0.1.2-rc.1.md](references/v0.1.2-rc.1.md) | alpha.5→rc.1, the first release candidate of the 0.1.2 series (zero cards: pure version bump, no plugin-facing changes; verification record plus a release-notes coverage matrix mapping the rc.1 summary onto the corridor cards, with backfill candidates) |
| [references/v0.1.3-alpha.1.md](references/v0.1.3-alpha.1.md) | 0.1.2-rc.1→0.1.3-alpha.1 cards (8): A1-01/A1-02 session-log corridor measured on the release-tarball build `0.1.3-alpha.1-9523542` (the v0→v1 session migrator refuses 0.1.2-alpha.x-writer logs — top-level `replayState.kind`/`version: 1`, all pre-alpha.4-writer history unloadable, fail-closed with the source artifact untouched; cross-version `resume` reports `cursor behind the last applied entry`, tag alignment pending); A1-03 Windows install fails on the `fs-ext` native build without MSVC; pnpm-patch recipe, single-host field report; A1-04…A1-06 git-tag anchored: outbound HTTP(S)/ALL_PROXY bootstrap install (`dsh-http-proxy`, `$DSH_HOME/.env` home layer), session persistence `SessionHandle` + async `agentLoop.create()` + per-session lock, Session log format v2 + released migration catalog; A1-07/A1-08 unpublished-cohort source-launch recipe + composer/read_image runtime re-verification |
| [references/v0.1.3-alpha.2.md](references/v0.1.3-alpha.2.md) | 0.1.3-alpha.1→0.1.3-alpha.2 curated cards (5): persona splits into prefix + suffix (`text`/`persona` keys and `PERSONA_SECTION` removed), `SubprocessHandle.pid` removed, base bundle drops the `tool-str-replace-editor` default row, launcher `runCli()`/`import.meta.main` gate, pi-ai `^0.84.2`→`^0.85.1`; first 0.1.3 build on npm (alpha.1 items debut for npm upgrades) |
| [references/v0.1.5-alpha.1.md](references/v0.1.5-alpha.1.md) | 0.1.3-alpha.2→0.1.5-alpha.1 curated cards (20, version-jump edge): Session log format V3 (`session-format-v2-to-v3`, `EpochHeader.system` removed, no downgrade read), `ctx.agent` removal + explicit `AgentSetup(agentCtx, agent)`/`parentAgent`, `Inbox` type interface at `agent.inbox`, tighter session-event payload validation, PTC vocabulary rename, token-meter export removal + `contextBreakdown` stateVersion 4, system prompts in message history, forwarded scoped Remote events must carry the Agent, CLI rejects `--profile desktop`, `--from-default-profile`/`loadProfileDirectory()`, `workspaceFiles`/`readByteRange`/`/api/file` file surface + file-address helpers, `goal/activation-changed` + paused-goal resume refusal, `fs-ext`→`node-addon-system` packaging, Web Client `details`→`rightbar` rework, injection-surface signature changes, right-sidebar/resource extension points, sidebar file opening, `tool-subagent` scoped-preset requirement, host SSH/directory-picker/instruction-discovery seams; A1-20 (real-host verified): an in-place npm-global upgrade can serve a client combo that omits newly-added bundle modules — one dropped module fails every client plugin's registration, and a host restart self-heals the roster/combo mismatch |
| [references/v0.1.5-alpha.2.md](references/v0.1.5-alpha.2.md) | 0.1.5-alpha.1→0.1.5-alpha.2 curated cards (24): `workspaceFiles` drops the `Agent` first parameter for a Typert `workspaceFileScope` (client resource type, `reload`/`restat`, `absolute` scope authorization), file reads leave the workspace root with a `maxFileBytes` cap and `readAll`/`readRelated`, the `conversation` slot moves under root-scoped `main` with `sidebar.panellist`, minimal profiles become persistent-shell-only, two non-ignorable session events (`deliverables/presented`, `subagent/catalog`), `dsh-llm-pi-ai` config/type changes, scope-aware tool guidance, `present`/reveal delivery surface, document previews + `ui-sidebar-textpreview`→`ui-sidebar-documentpreview`, new `chunked-list`/`tool-present` packages, MCP pagination-cursor rejection, session-format-status doc; client/packaging cards: `rightbar` root scope + `rightbar.session` and the layout service/store rewrite (`selectPanel`, `beginNavigation`, `usePanelInfo`), `client-resources` drops `reload`, `ui-primitives` `FileTypeIcon`/`classifyFileType`, `ui-dockkit` contract drift, `ui-message-feedback` injected surface, `ui-workspace` `openSession`/`openWorkspace`/`forkSession`, `ChatFileMentions.forClosing(owner, sessionId)` + deliverables turn tail, browser-only deps → `devDependencies`, `ctx.documentPreviews` registry, `ActionSpec` commands, `command-feedback` subpaths + `sessionFeedback` Host Remote, lazy sidebar default pages/close rules; on npm since 2026-09-09 |
| [references/v0.1.5-rc.1.md](references/v0.1.5-rc.1.md) | 0.1.5-alpha.2→0.1.5-rc.1 curated cards (5): the base bundle's default agent model id moves to `deepseek-flash`; `deepseek-flash` (V41 Flash) joins the adapter catalog with image input, `systemPromptUpdate: 'in-history'` and no gateway probe; document renderers gain a required `scrollportRef`; sidebar guide entries gain an optional `description`; negative evidence plus a 17-repository fleet verification record. This edge is 17 commits |
| [references/v0.1.5-rc.2.md](references/v0.1.5-rc.2.md) | 0.1.5-rc.1→0.1.5-rc.2 draft cards (6): the feedback surface's injected contract loses `toggle`/`acknowledge`, `openDialog` gains a required `rating` and `MessageFeedbackToggleResult` leaves the exports (supersedes the injected half of the alpha.2 feedback card, which is still in an open pull request); both ratings now confirm in the dialog and a failed submission becomes a 6s warning toast; `FileTypeIcon`'s 48 code-category icons move to the injected design-export artwork with per-instance `dsh-code-icon-*` ids; the completed-turn footer and file-section spacing become a 20/16/20px contract; `service-stability` is re-labelled in both languages; and the edge carries negative evidence that no Host-plane package changed (272 of its 334 files are version strings). Note: npm `latest` still resolves to 0.1.5-rc.1 — rc.2 sits on `next` |
| [references/v0.1.6-alpha.1.md](references/v0.1.6-alpha.1.md) | 0.1.5-rc.2→0.1.6-alpha.1 draft cards (38, the widest edge carded here: 800 commits / 4015 files). Host: `agent/session-start` deleted and `agent/created` becomes serial + awaited, `auditStartupEntries` replaces the `assertEntries*` pair, session event reads deprecated, `registerMessageProjection()` with a refusal when no pure interpreter is registered, `session-log-deepseek` uploads by default. Runtime: `codeRuntime`→`ptcRuntime` with a `resolve`/`run` split, async `SandboxProvider.confine` and `ShellExecutor.start`, subprocess `terminalEnvironment()` + optional control channel, `workflow-ptc` replaces the worker-thread provider, MCP 2.0 SDK, new `ctx.mcpResources` and `ctx.ssh` capabilities. LLM: adapters report `IMAGE_OFFLOAD_REQUIRED` instead of projecting images, `deepseek-official` defaults to the Anthropic Messages protocol, images move to the v41 token grid, projection `stateVersion` 5, `AssistantProvenance`→`AssistantProviderMetadata`. Web Client: producer/provider renames, required `CommandClaim.name`, new `conversation.input.permission` and keyed guide-entry slots, `ConnectionIndicator.reconnectLabel` removed, context-aware diffs, `?fixture` mode replaced by the assembly tier. Composition/packaging: base swaps `workflow-worker-thread` for `ptc-runtime` + `workflow-ptc`, mounts `image-offload` (required-on-read `image/offload`) and `mcp-resources`, disables `tool-ralph` by default, the Web bundle drops the `code-runtime` row, a +22/−7 package ledger, headless `--session-id`/`--json`, public package manifest rebuild, experimental publication flipped to a denylist, `node-addon-require-builtin` floor `^0.1.4`→`^0.1.6`; negative evidence that `SESSION_FORMAT_VERSION` (3), the engine floor and the launcher CLI grammar did not move |
| [references/api-migration-0.1.2-alpha.2.md](references/api-migration-0.1.2-alpha.2.md) | Exact rc.2→alpha.2 interface ledger; read when API, Remote, Settings, events, Headless, packaging, or composition surfaces are hit; includes the removed client runtime and keyed chat snapshots (API-10) |
| [references/rollup-0.1.2.md](references/rollup-0.1.2.md) | 0.1.1 → 0.1.2 corridor (rollup): cross-cohort coexistence, unpublished-cohort installation, `RemoteResult` error flow, pre-migration baseline attribution, bounded retry for boot race, base-only preset precondition, type-surface export drift, host-self safety boundary, install-channel pitfalls (mirror lag, pnpm 11 supply-chain rules, peer-floor prerelease semantics), and the layered validation checklist; based on rc.1 and subject to final-release review |
| [references/precision-checklist.md](references/precision-checklist.md) | Alpha.2 static-migration precision checklist: peer floors, runtime module composition versus type declarations, locale pairing, channel authentication with protocol preservation, landing discipline and citations; pair with [scripts/inject-lint.mjs](scripts/inject-lint.mjs) for residue/peer checks and manual route-review candidates |
| [scripts/README.md](scripts/README.md) | Executable helper scripts: `plan-migration` (read-only migration planner), `verify-runtime` (offline runtime contract checker), and `ghost-host-check` (ghost-host classifier for pre-flight step 1.5) |
| [examples/legacy-plugin/](examples/legacy-plugin/) | Static fixture for the seven touchpoint classes (never execute) |
| [examples/08-real-web-client-alpha2-migration.md](examples/08-real-web-client-alpha2-migration.md) | Real Host + Web Client source migration from an older unsupported corridor segment |

Normative background: [dsh-community-standard](https://github.com/oh-my-dsh/dsh-community-standard)
owns manifests, contract coordinates, and negotiation conventions; this skill handles practical upgrades of existing plugins, reusing that classification without redefining it. The official call for contributions is [deepseek-harness discussion #5120](https://github.com/deepseek-ai/deepseek-harness/discussions/5120).
