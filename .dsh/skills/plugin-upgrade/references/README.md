# references/ · reference material loaded on demand

> `SKILL.md` keeps only the decision flow; version facts and scan patterns live here and load on demand.

## Version corridor index

Build corridors along the `from → to` directed edges in the table, never by filename
order — lexicographically, `alpha.10` sorts before `alpha.2`. When the target spans
multiple versions, read the full corridor and compute the final net state before touching
source: if a field is removed in alpha.1 and restored in alpha.2, do not delete and re-add it.

| Order | Card file | from | to | Cards | Status / coverage |
|---|---|---|---|---:|---|
| 0 | [v0.1.1-rc.1.md](v0.1.1-rc.1.md) | `dsh-v0.1.0-rc.8` | `dsh-v0.1.1-rc.1` | 9 | draft / curated (vlln plugin migrations: repository-plugins mechanism removal, `dshClient`→`dsh.client` manifest merge, client-modules scan → bundle `dsh.client`, strict inject + weak `ctx.get`, session event contract (`type` not `kind`), self-rendering client session aggregation, `tasks.peek` removal, 0812 service renames — `httpServer`→`webServer`, `tasks`→`jobs`; corridor is the closest published-tag alignment for the internal 0810–0812 snapshot window, upstream review may reassign) |
| 1 | [v0.1.1-rc.2.md](v0.1.1-rc.2.md) | `dsh-v0.1.1-rc.1` | `dsh-v0.1.1-rc.2` | 3 | reviewed / curated |
| 2 | [v0.1.2-alpha.1.md](v0.1.2-alpha.1.md) | `dsh-v0.1.1-rc.2` | `dsh-v0.1.2-alpha.1` | 28 | reviewed / curated |
| 3 | [v0.1.2-alpha.2.md](v0.1.2-alpha.2.md) | `dsh-v0.1.2-alpha.1` | `dsh-v0.1.2-alpha.2` | 8 | reviewed / curated |
| 4 | [v0.1.2-alpha.3.md](v0.1.2-alpha.3.md) | `dsh-v0.1.2-alpha.2` | `dsh-v0.1.2-alpha.3` | 2 | reviewed / curated (one opt-in breaking removal: the SQLite Session-persistence provider (`session-persistence-sqlite`) — retained databases need an older build to export; one additive capability: `settings.plugin.item` keyed-slot settings card, first real-world integrations) |
| 5 | [v0.1.2-alpha.4.md](v0.1.2-alpha.4.md) | `dsh-v0.1.2-alpha.3` | `dsh-v0.1.2-alpha.4` | 6 | reviewed / curated |
| 6 | [v0.1.2-alpha.5.md](v0.1.2-alpha.5.md) | `dsh-v0.1.2-alpha.4` | `dsh-v0.1.2-alpha.5` | 3 | reviewed / curated |
| 7 | [v0.1.2-rc.1.md](v0.1.2-rc.1.md) | `dsh-v0.1.2-alpha.5` | `dsh-v0.1.2-rc.1` | 0 | reviewed / curated |
| 8 | [v0.1.3-alpha.1.md](v0.1.3-alpha.1.md) | `dsh-v0.1.2-rc.1` | `dsh-v0.1.3-alpha.1` | 8 | draft / curated (session-log corridor A1-01/02 + Windows install on the fs-ext native build A1-03 + A1-04/05/06 host-plane/policy cards + A1-07/08 unpublished-cohort source-launch recipe and composer/read_image runtime re-verification; release tarball measured, tag alignment pending) |
| 9 | [v0.1.3-alpha.2.md](v0.1.3-alpha.2.md) | `dsh-v0.1.3-alpha.1` | `dsh-v0.1.3-alpha.2` | 5 | draft / curated (persona `text`/`persona` config splits into prefix + suffix with `PERSONA_SECTION` removed, `SubprocessHandle.pid` removal, base bundle drops the `tool-str-replace-editor` default row, launcher `runCli()`/`import.meta.main`, pi-ai `^0.84.2`→`^0.85.1`; first 0.1.3 build on npm — alpha.1 items debut for npm upgrades, read the [alpha.1 corridor](v0.1.3-alpha.1.md) first) |
| 10 | [v0.1.5-alpha.1.md](v0.1.5-alpha.1.md) | `dsh-v0.1.3-alpha.2` | `dsh-v0.1.5-alpha.1` | 20 | draft / curated (version-jump edge: the tag/npm corridor goes straight from 0.1.3-alpha.2 to 0.1.5-alpha.1; Session log format V3 via the new `session-format-v2-to-v3` with `EpochHeader.system` removed and no downgrade read, `ctx.agent` removed with explicit `AgentSetup(agentCtx, agent)`/`parentAgent`, `Inbox` becomes a type interface at `agent.inbox`, tighter session-event payload validation, PTC vocabulary rename, `token-meter` export removal + `contextBreakdown` stateVersion 4, system prompts move into message history, forwarded scoped Remote events must carry the Agent, CLI rejects the `desktop` profile, `--from-default-profile`/`loadProfileDirectory()`, the `workspaceFiles`/`readByteRange`/`/api/file` file surface, `goal/activation-changed`, the `fs-ext`→`node-addon-system` packaging change, the Web Client `details`→`rightbar` rework and injection-surface signature changes, new right-sidebar/resource extension points, file links opening in the sidebar, the `tool-subagent` scoped-preset requirement, and the host SSH/directory-picker/instruction-discovery seam changes) |
| 11 | [v0.1.5-alpha.2.md](v0.1.5-alpha.2.md) | `dsh-v0.1.5-alpha.1` | `dsh-v0.1.5-alpha.2` | 24 | draft / curated (`workspaceFiles` drops the `Agent` parameter for a Typert `workspaceFileScope`, unconfined file reads with `maxFileBytes` + `readAll`/`readRelated`, `conversation` moves under root-scoped `main` with `sidebar.panellist`, shell-only minimal profiles, two non-ignorable session events (`deliverables/presented`, `subagent/catalog`), `dsh-llm-pi-ai` config/type changes, scope-aware tool guidance, `present`/reveal delivery surface, document previews + `ui-sidebar-textpreview`→`ui-sidebar-documentpreview`, new `chunked-list`/`tool-present` packages, MCP pagination-cursor rejection, session-format-status doc; plus 12 client/packaging cards: `rightbar` becomes root-scoped with `rightbar.session` and the layout service/store is rewritten, `client-resources` drops `reload`, `ui-primitives` file-type icons replace `DocumentFileIcon`, `ui-dockkit` contract drift, `ui-message-feedback` injected surface rewrite, `ui-workspace` navigation service, `ChatFileMentions.forClosing` + deliverables turn tail, browser-only deps move to `devDependencies`, `ctx.documentPreviews` registry, `ActionSpec` commands, `command-feedback` subpaths + Host Remote, sidebar-right lazy default pages/close rules; on npm since 2026-09-09) |
| 12 | [v0.1.5-rc.1.md](v0.1.5-rc.1.md) | `dsh-v0.1.5-alpha.2` | `dsh-v0.1.5-rc.1` | 5 | draft / curated (base default agent model id moves to `deepseek-flash`; the adapter catalog gains V41 Flash with image input, `systemPromptUpdate: 'in-history'` and no gateway probe; document renderers gain a required `scrollportRef`; sidebar guide entries gain an optional `description`; negative evidence plus a 17-repository fleet verification record. This edge is 17 commits) |
| 13 | [v0.1.5-rc.2.md](v0.1.5-rc.2.md) | `dsh-v0.1.5-rc.1` | `dsh-v0.1.5-rc.2` | 6 | draft / curated (Web Client face only: the feedback surface's injected contract loses `toggle`/`acknowledge` and `openDialog` gains a required `rating`, both ratings now confirm in the dialog and a failed submission becomes a 6s warning toast, `FileTypeIcon`'s 48 code-category icons move to the design-export artwork injected as markup with per-instance `dsh-code-icon-*` ids, the completed-turn footer and file-section spacing become a documented 20/16/20px contract, and `service-stability` is re-labelled `Stability and speed` / `稳定性和速度`; no Host-plane package carries a behavior change — 272 of the 334 changed files are version strings; corridor order 13 because rows 10–12 for `0.1.3-alpha.2→0.1.5-alpha.1`, `0.1.5-alpha.1→0.1.5-alpha.2` and `0.1.5-alpha.2→0.1.5-rc.1` land with #197/#199/#204) |
| 14 | [v0.1.6-alpha.1.md](v0.1.6-alpha.1.md) | `dsh-v0.1.5-rc.2` | `dsh-v0.1.6-alpha.1` | 38 | draft / curated (the widest edge carded here so far: 800 commits, 4015 changed files, 307 of them `package.json` version strings. Host: `agent/session-start` deleted and `agent/created` becomes a serial awaited event carrying `source`/`signal`, startup strictness moves to `auditStartupEntries` so a resolved `Loader.create()` no longer proves activation, `Session.eventAt()`/`snapshotEvents()`/`ownEvents()` are deprecated and lint-protected, `ctx.sessions.registerMessageProjection()` arrives with a refusal for content-rewriting events that lack a registered pure interpreter, and `session-log-deepseek` uploads by default. Runtime: `ctx.codeRuntime` → `ctx.ptcRuntime` with `CodeRuntime` → `PtcRuntime` and `run(request)` split into `resolve(request)` + `run(spec)`; `SandboxProvider.confine` and `ShellExecutor.start` become asynchronous; subprocess providers must implement `terminalEnvironment()` and may serve a control channel; `workflow-ptc` replaces the worker-thread workflow provider and requires a PTC runtime plus sandbox policy; the MCP client moves to the 2.0 SDK; new `ctx.mcpResources` and the `ctx.ssh` execution world. LLM: the adapter image budget now reports `IMAGE_OFFLOAD_REQUIRED` instead of projecting images, `deepseek-official` defaults to the Anthropic Messages protocol, request images move to the v41 token grid, token-meter and both context projections bump `stateVersion` to 5, `AssistantProvenance` → `AssistantProviderMetadata`. Web Client: context "provenance" becomes "producer" and assistant "provenance" becomes "provider metadata", `CommandClaim` requires `name`, the composer permission control moves to the new `conversation.input.permission` slot, right-sidebar guide entries require `id` with a keyed `sidebar.right.tab.guide.entry` slot, `ConnectionIndicator` loses `reconnectLabel`, diffs become context-aware, and the standalone `?fixture` page mode is replaced by the client assembly tier. Composition and packaging: the base swaps `workflow-worker-thread` for a `ptc-runtime` + `workflow-ptc` pair, mounts `image-offload` (whose `image/offload` event is required on read) and `mcp-resources`, disables `tool-ralph` by default, the Web app bundle drops the `code-runtime` row and mounts three new rows, the workspace ledger adds 22 packages and retires 7, headless gains `--session-id`/`--json`, the public package manifest type is rebuilt, experimental packages publish by default behind an empty denylist, and the `node-addon-require-builtin` floor moves `^0.1.4` → `^0.1.6`; negative evidence records that `SESSION_FORMAT_VERSION` (3), the engine floor and the launcher CLI grammar did not move) |
| — | [rollup-0.1.2.md](rollup-0.1.2.md) | `dsh-v0.1.1-rc.2` → `dsh-v0.1.2-rc.1` full corridor | rollup | non-card file: corridor-level increment (cross-cohort coexistence, unpublished-cohort installation, `RemoteResult` error flow, pre-migration baseline attribution, bounded retry for boot race, base-only preset precondition, type-surface export drift, host-self safety boundary, three install-channel pitfalls, layered validation checklist); based on rc.1, subject to final-release review |
| — | [rc-0.1.3-runtime-verification.md](rc-0.1.3-runtime-verification.md) | `dsh-v0.1.2-alpha.2` → `dsh-v0.1.3-alpha.2` runtime companion | runtime record | non-card file: plugin runtime verification across rc.1 / 0.1.3-alpha.2 (five real plugins, isolated-profile cold boots — survival surface stable; dsh-web-ui degrades to install-failed on 0.1.3-alpha.2) |

`curated` means only the identified plugin-relevant changes are included, not a complete
API diff. When a corridor edge is missing, stop the automatic migration and report the gap
to the user; one-off upstream research for the current task and adding cards to this
repository are two different activities — the latter must not become an implicit side
effect of modifying the user's plugin.

Companion material:

- [pre-flight.md](pre-flight.md): the seven-class touchpoint self-check and the migration-task summary template;
- [pre-flight-patterns.json](pre-flight-patterns.json): source of truth for the regexes used by executable checks;
- [api-migration-0.1.2-alpha.2.md](api-migration-0.1.2-alpha.2.md): the precise migration ledger for rc.2→alpha.2 when API, Remote, Settings, events, Headless, packaging, or composition interfaces are hit;
- [host-plane-probes.md](host-plane-probes.md): three ways for the host plane to run dual-cohort probes in `cordis.patch.yml`;
- [migration-hygiene.md](migration-hygiene.md): version-independent toolchain pitfalls (tsbuildinfo false positives, oxc parsing strictness, the plane a change takes effect in, pnpm interception, test syntax);
- [troubleshooting.md](troubleshooting.md): post-migration symptom → root cause → card lookup;
- [precision-checklist.md](precision-checklist.md): alpha.2 static-migration precision checklist — peer floors, runtime module composition versus type declarations, locale pairing, channel authentication with protocol preservation, landing discipline and citations; pairs with `inject-lint` for residue/peer checks;
- [examples/legacy-plugin/](../examples/legacy-plugin/): static fixture for the seven touchpoint classes.

## Card file metadata

Each `vX.Y.Z-<suffix>.md` declares, in its frontmatter:

```yaml
---
kind: dsh-version-card-set
schema: 1
from: dsh-v0.1.2-alpha.1
to: dsh-v0.1.2-alpha.2
status: reviewed
coverage: curated
cardCount: 4
idPrefix: DSH-0.1.2-A2
verifiedAt: 2026-08-30
---
```

Version order is determined by `from`/`to`; `cardCount`, the ID prefix, and the required
fields are checked by the repository's validation scripts.

## Single-card format

```markdown
### DSH-0.1.2-A2-01 · Title

- **Type**: breaking | behavior | capability | fix | security | privacy
- **Applies to**: client / server plugin / profile wrapper / packaging, etc.
- **Touchpoints**: #1…#7, or "none (packaging/privacy surface)"
- **Action level**: required | required-if-hit | required-if-target-is-… | conditional | optional | informational
- **Symptoms**: what breaks or changes after the upgrade
- **Migration recipe**: checkable steps; old→new ledger (where applicable)
- **Verification**: how to prove the final behavior, not just that installation succeeded
- **Source**: primary source pinned to a fixed release tag / commit
- **Field note** (optional): reproducible real-world migration differences, noting date, plugin, platform, and version
```

Rules:

1. The ID must include the full host version and be unique within the repository;
2. every card cites at least one primary source; when same-version material exists, prefer pinning to the same tag;
3. when release notes give direction only, without API coordinates, the recipe must require re-checking the target tag's types — do not invent interfaces;
4. cross-version rollbacks/restores are cross-referenced by full ID;
5. when local observation conflicts with a primary source, reproduce first and record the difference side by side; never silently overwrite either side.
