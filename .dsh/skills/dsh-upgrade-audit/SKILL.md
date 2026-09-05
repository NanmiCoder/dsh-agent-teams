---
name: dsh-upgrade-audit
description: Audit external compatibility between two DSH (DeepSeek Harness) versions and detect reverts, producing an upgrade-report directory; compares git tags with a source checkout, or published npm packages without one. Use whenever the user asks to check/compare/audit two DSH versions or whether upgrading is safe — e.g. "more changes or reverts in dsh-vX -> dsh-vY", "compare the breaking changes" — even with only two version numbers and no source location. Read-only outside the report directory; npm mode installs in isolation with --ignore-scripts.
---

English | [简体中文](SKILL.zh-CN.md)

# dsh-upgrade-audit

Audit every change observable by consumers **outside the repository** between two DSH versions, and produce the set of reports the user expects. The fixed form of this problem: *relative to from, does to contain more changes or reverts?* — "more changes" means externally visible breakage (removed exports, renamed wire error codes, data formats refused on read); "revert" means behavior present in `from` deliberately withdrawn by a revert within the interval. Both need evidence: commit messages and subagent summaries are claims — only conclusions drawn after reading both trees (source files or published packages) count as evidence.

External compatibility = everything observable by consumers outside the repository: the npm package public API (exports, types, signatures, dependency surface), the `dsh` CLI (commands, flags, profiles, config keys), the wire protocol (SDK JSON-RPC, remote gateway/BFF, ACP, hooks), session data on disk (JSONL logs, SQLite stores and their version guards), the model-visible surface (tool names/schemas, system-prompt output), and the Python SDK's expectations. Internal refactors are background, not findings — aggregate and count them.

Note: report language follows the user's language (see "Output contract" below); the existing sample report under `examples/` is in English by historical convention.

## Phase 0 — Parse input and choose a mode

Input: two version identifiers (accepts `0.1.2-alpha.2`, `dsh-v0.1.2-alpha.2`, dist-tags `alpha`/`latest`/`next`). Choose the analysis mode by specificity, high to low:

1. **Context path** — the user named a deepseek-harness checkout directory in the message. Verify: root `package.json` + `packages/` + `AGENTS.md` all present.
2. **`DSH_SOURCE_PATH` environment variable** — verify the same way. (Optional `DSH_NPM_REGISTRY` overrides the npm registry.)
3. **CWD heuristic** — the current directory is itself a deepseek-harness checkout (marked the same way).
4. **npm mode** — none of the above (the default path for third-party repos): download the published packages of the two versions for analysis.

Source mode audits git tags; npm mode audits published artifacts. The audit core (recon surface, classification, verification, reporting) is shared; only the materialization and some evidence sources differ. Know npm mode's boundaries before choosing it: **the npm version set ≠ the git tag set** (e.g. `0.1.2-alpha.1` is tagged but was never published — the materialization script exits with the published list, so present the gap to the user instead of silently substituting a version pair); the CLI closure does not include every publishable package (the SQLite persistence backend is not a CLI dependency; the script installs it as a supplement package).

## Output contract

Everything lands in one directory: `tmp/<fromNorm>-to-<toNorm>/` (normalization: strip `dsh-v`, strip dots in the prerelease segment — `dsh-v0.1.2-alpha.1` → `0.1.2alpha1`). Source mode creates it inside the checkout (gitignored); npm mode creates it inside the current project. If the target directory already exists it is most likely a previously hand-made report — stop and ask first; do not overwrite.

| Artifact | Source mode | npm mode |
|---|---|---|
| `commits.txt`, `reverts.txt` | from git; reverts folded into CHANGELOG | from GitHub compare enrichment (none if private repo) |
| `files.txt`, `diffstat.txt`, full `.diff` | git tree diff | `manifest-diff.txt` (per-package manifest diff) + `a/`, `b/` published package trees |
| `CHANGELOG.md` | categorized by type, **must have a Reverts section** | generated when enrichment exists; otherwise omitted with an explicit note |
| `UPGRADE-ADAPTATION.md` | audit report (same skeleton in both modes) | same; header records mode and version provenance |

Report language follows the user's language ([examples/](examples/0.1.2alpha1-to-0.1.2alpha2/UPGRADE-ADAPTATION.md) existing report is in English, a historical convention — not mandatory).

## Phase 1 — Materialize the two trees

**Source mode** — verify purity first; a merge base that is not `from` itself means base drift: stop and report, never diff against a moving baseline:

```sh
git merge-base <from> <to>   # must equal <from>'s commit
node <skill-dir>/scripts/gen-artifacts.mjs <from> <to> tmp/<pair>
```

**npm mode**:

```sh
node <skill-dir>/scripts/materialize-npm.mjs <from> <to> tmp/<pair>
```

The script resolves both versions against the registry (missing → exit 1 with the published list — present the gap to the user), installs the `@deepseek-ai/dsh` dependency closure plus the SQLite supplement package into `a/` and `b/` with `--ignore-scripts`, produces `manifest-diff.txt` from per-package manifest diffs for every `@deepseek-ai/*` package, and enriches from the public GitHub repository (`commits.txt`, `reverts.txt`) — so revert detection works even without a source checkout.

Size the recon from the stats output: ≤40 non-merge commits → run the recon-surface checklist inline; 40–250 → merge 3–4 facades; more → all six facades. For density comparison, open the *previous* pair's `commits.txt` — the immediately preceding pair in **chronological order**, never just the newest directory in `tmp/`.

## Phase 2 — Establish shared facts first

Run once and feed to every subagent, so they do not each re-derive them:

- **Format guards** — source mode reads `SESSION_FORMAT_VERSION` on both tags (`packages/core/session/src/types.ts`) and the SQLite `SCHEMA_VERSION` (`packages/session/session-persistence-sqlite/src/schema.ts`); npm mode greps the same-named constants from the published `lib/*.js` of `dsh-session` and the supplement package. A guard that jumps with no migration path = hard data breakage; put it at the front of the report.
- **Revert list** — source mode: `git log --grep='[Rr]evert' <from>..<to>`; npm mode: the enriched `reverts.txt` (absent → revert *intent* is undetectable; say so explicitly and do only the from→to delta audit).
- **Python SDK** — source mode: diff `python/`; npm mode: outside the npm artifact scope, one sentence suffices.

## Phase 3 — Parallel facade scans

Dispatch one read-only recon agent per facade in a parallel batch, each carrying the Phase 2 shared facts and the output contract from [references/audit-playbook.md](references/audit-playbook.md): sections **REMOVED** (first — candidate breakage/reverts), **CHANGED** (before → after), **ADDED**, **RENAMED**; every entry carries package/path, symbol or field, and an impact-surface class (SDK consumers / CLI users / config authors / session data / model-visible / protocol peers / web UI / npm installers); end with a one-line verdict. The per-facade target path lists (per mode) are in the playbook.

## Phase 4 — Verify before publishing

Recon output is leads, not findings. Personally re-verify every REMOVED, revert, and wire claim: source mode with `git show <tag>:<path>` / `git ls-tree` against both tags; npm mode by reading both published trees (`a/node_modules/...` vs `b/node_modules/...`). This step has a real lesson: a recon agent once reported a package that already existed in alpha.1 as "added in alpha.2". Whatever cannot be verified is either marked `[INFERENCE]` or deleted.

## Phase 5 — Write UPGRADE-ADAPTATION.md

Per the [references/audit-playbook.md](references/audit-playbook.md) skeleton: header (range, stats, mode & provenance, source-mode purity note), **Verdict** (answer the comparative question directly), §1 reverts, breaking sections sorted by consumer impact (removals first, each annotating who breaks, with an **Adapt:** line), **Confirmed unchanged** (the parts where compatibility holds matter as much as the breaks), the boundary signature table `[API surface | from | to | changed?]`, and a numbered migration checklist. Full worked example at [examples/0.1.2alpha1-to-0.1.2alpha2/](examples/0.1.2alpha1-to-0.1.2alpha2/UPGRADE-ADAPTATION.md) (a real source-mode audit). Chat replies follow the user's language.

## Guards

- Read-only: source mode touches nothing outside `tmp/<pair>/`; npm mode writes only its own `tmp/<pair>/` and installs with `--ignore-scripts` into that directory — never install the dsh package into the host project's `node_modules`.
- Prefer tree-level facts (published files, two-tag reads); do not trust narratives inferred from logs.
- Aggregate internal irrelevant churn (tests, notes, i18n, styles) into a single count; do not itemize it.
- npm mode records its limitations honestly: no enrichment → no git history; the CLI tarball ships only `lib/` (config composition audited via each bundle package's `cordis.patch.yml` + manifest); Python SDK out of scope.
- Do not fully fan out a 20-commit range; do not inline a 500-commit range. Misjudging the scale is the main reason audits go stale or shallow.

## Relationship to plugin-upgrade

This skill produces **evidence of host-version compatibility** (report + boundary signature table); [plugin-upgrade](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/skills/plugin-upgrade/) consumes that evidence (version-change cards) to execute a single plugin's migration. Audit findings can feed a card's "field notes" directly; when adding cards to `plugin-upgrade`, cite this skill's report directory rather than restating from memory.
