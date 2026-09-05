# Audit Playbook

Reference for the recon dispatch template, the six recon-surface target lists, and the report skeleton. SKILL.md owns the phase sequencing; read only the section you need.

## Six standard recon surfaces

Merge or split them by interval size (SKILL.md Phase 0). The targets are the fast path; when `files.txt` or `manifest-diff.txt` shows a surface the list does not cover, extend the recon yourself.

| # | Recon surface | Targets (source mode) | Targets (npm mode) |
|---|---|---|---|
| 1 | Core API | `packages/core/**` (session, agent, agent-loop, tools, system-prompt, scope), `packages/util/**` src: export additions/removals/renames, signature changes, event maps, tool schemas, system-prompt structure | `lib/types/*.d.ts` (type surface) + `lib/*.js` (runtime constants) + package.json of packages such as `dsh-session`, `dsh-agent*`, `dsh-tools`, `dsh-system-prompt` |
| 2 | SDK & wire protocol | `packages/sdk/**`, `packages/api/remotes`, `subagent-dsh-sdk`, `bundle/sdk-app`, `bundle/sdk-minimal`: JSON-RPC methods, payload fields (new required fields = wire breakage; removals = client breakage), notifications, protocol constants, bundle composition | published lib of the corresponding `dsh-sdk-*`, `dsh-api-remotes`, `dsh-subagent-dsh-sdk` packages + the `cordis.patch.yml` of `dsh-headless`/`dsh-base` etc. in both trees |
| 3 | CLI & config | `apps/cli`, `packages/boot/**`, `packages/bundle/**`, `packages/settings/**`, `packages/credentials/**`, `packages/preset/**`, `docs/config-catalog.md`, `.github/workflows/release.yml`: commands/flags/environment variables, schemastery keys (removals/renames = config-author breakage), default values, preset roster, release flow | the `dsh` package (bin, commander definitions in lib and `--help`), `cordis.patch.yml` diffs of each bundle package, lib of `dsh-settings`/`dsh-agent-presets`, GitHub-enriched release-related commits |
| 4 | Remote / BFF | `packages/api/gateway`, `packages/api/*-controller`, `packages/client/connection`, `packages/host/webserver`: stream/journal/snapshot events, error-code vocabulary, HTTP routes, connection state machine, auth flows | published lib of `dsh-api-gateway`, `dsh-api-*-controller`, `dsh-client-connection`: error-code constants, heartbeat defaults, event names |
| 5 | Session data | `packages/session/**`, `packages/session-query/**`, `packages/core/session`, `session-format-guard.expected.e2e.ts`: the two format guards, migrate vs refuse (read the guard code, not the README), JSONL encoding, projection/query/export surface | lib constants and `resources/sql/` of `dsh-session` + supplement package `dsh-session-persistence-sqlite`, `dsh-session-query*`, `dsh-session-log-export` |
| 6 | Revert sweep | whole tree: D/R entries in `git diff --name-status` (skip tests/notes/i18n), export removals in every changed `src/index.ts`, removed CLI flags/config keys/preset/docs sections; classify each entry as "migrated" or "gone" | `reverts.txt` (enrichment) + a full pass over `manifest-diff.txt`: packages present in only one tree, packages whose exports/files/bin narrowed |

## Recon dispatch template

Dispatch a parallel batch. Every prompt carries the Phase 2 shared facts (format guards, revert list, Python line), this contract, and the targets of its recon surface.

```
# Goal
Audit external-compatibility changes between <from> and <to> in <repo/mode>. External = observable by consumers outside the repo.

# Constraints
- READ-ONLY. Source mode: `git diff <from>..<to> -- <paths>` and `git show <tag>:<path>`; npm mode: read only the two published trees `a/` and `b/`. No build, no test, no lint.
- Classify every finding: ADDED / REMOVED / CHANGED (before → after) / RENAMED. Put REMOVED first.
- Each entry carries package/path, symbol or field, change type, and impact-surface class (SDK consumers / CLI users / config authors / session data / model-visible / protocol peers / web UI / npm installers).
- Internal refactors unrelated to external compatibility (private helpers, tests, doc wording): aggregate into a single count; do not itemize.
- If unsure, say unsure; do not guess about what you have not read.

# Output
Markdown: `## <facade>` → `### REMOVED` / `### CHANGED` / `### ADDED`; end with a one-line verdict: "External-compat delta: <low/medium/high> — <one sentence>".
```

## Verification rules (Phase 4)

Recon output is leads, not findings. Before anything enters the report:

1. **Existence claims**: run `git ls-tree <tag> --name-only <dir>` on each tree, or list the two published trees. A package/export reported as "added" must not exist on the `from` side.
2. **Removal claims**: the symbol must no longer be present in `git show <to>:<path>` or `b/node_modules/...`; name the replacement when you find one, write "gone" when you do not.
3. **Value claims** (defaults, constants, schema versions): read the constant itself in both trees.
4. **Wire claims** (error codes, fields, routes): diff the file that declares them; do not read the changelog.
5. Anything unverifiable: drop it, or keep it as `[INFERENCE]` and state what evidence is missing.

## UPGRADE-ADAPTATION.md skeleton

Report language follows the user's language; the skeleton below uses the English headings of the [sample report under examples/](../examples/0.1.2alpha1-to-0.1.2alpha2/UPGRADE-ADAPTATION.md).

```markdown
# Upgrade Adaptation: <to> ← <from>

<One-sentence note for the audience. Artifact list.>

Range: `<from>` (<date>) → `<to>` (<date>). Release commit: `<sha>`. <N> commits total (<n> non-merge). <files> files changed, +<ins> / −<del>.
[npm mode adds one line: Mode: npm packages (resolved <va> -> <vb>), GitHub enrichment <status>]

History is merge-base-pure: `git merge-base <from> <to>` = <sha> = <from> itself. [If not pure: stop, explain the drift, and do not continue.]

## Verdict
<Answer the comparative question directly: more breakage? any real reverts? density vs. the previous interval. Name the 1–3 most important facts.>

## 1. Reverts (rollbacks relative to <from>)
<One numbered entry per revert: sha, subject, directional change, blast radius. When there are none, still write "none found" and explain how you looked.>

## 2..N. Breaking sections (sorted by consumer impact)
<Per recon surface: REMOVED first, **BREAKING** + consumer class, before → after, replacement, an **Adapt:** line. One line per recon surface confirmed safe.>

## Confirmed unchanged (compatibility holds)
<Interop that holds: protocol, CLI, JSONL logs, model-visible contracts. Each line carries evidence.>

## Boundary-signature table
| API surface | <from> | <to> | changed? |
|---|---|---|---|
| package.json exports/files/bin/main maps | ... | ... | ... |
| SESSION_FORMAT_VERSION | ... | ... | ... |
| SQLite SCHEMA_VERSION | ... | ... | ... |
| SDK JSON-RPC wire | ... | ... | ... |
| Gateway/BFF error codes | ... | ... | ... |
| HTTP routes | ... | ... | ... |
| dsh CLI commands/flags | ... | ... | ... |
| Model-visible tool contracts | ... | ... | ... |
| Known session event vocabulary | ... | ... | ... |

## Adaptation checklist
<Numbered, imperative, one action per item — one migration card per consumer class named above.>
```

## Reporting conventions

- Revert is directional: behavior present in `from` that a revert within the interval withdraws. A revert that restores old behavior as a fix counts; a revert of purely internal in-flight refactoring does not, unless its blast radius crosses a recon surface.
- The impact-surface classes are the report's indexing scheme: every break must name who breaks (SDK consumers / CLI users / config authors / session data / model-visible / protocol peers / web UI / npm installers).
- The boundary signature table is a summary record; the body sections are its evidence. A table row that contradicts the body = the report has a bug.
- Density comparison: when `tmp/<prev-pair>/commits.txt` exists, report the two intervals' non-merge commit counts and break counts side by side in the Verdict; take the immediately preceding pair in **chronological order**. Historical npm-mode reports may offer only `manifest-diff.txt` for comparison — say so plainly.
- npm-mode enriched `commits.txt` is subject to GitHub compare API limits: the commit list is capped at 250 entries (`truncated: true` in the stats), so a large interval's revert list may be incomplete — the report must state the coverage; when full history is needed, switch to source mode, or slice the interval into multiple compare calls.
- Handoff to `plugin-upgrade` version-change cards: the report's boundary signature table and §1 reverts feed cards directly; when adding "field notes" to a card, cite the report directory path instead of restating from memory.
