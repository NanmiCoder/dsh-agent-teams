# Tools in this directory

Three executables live here, with very different safety postures — read the
verifier's note before running it on anything you do not trust:

- **`plan-migration.mjs` — read-only migration planner.** Turns the existing pre-flight patterns and version-card metadata into a deterministic first-pass plan. It never writes the target repository and has no output-file option.
- **`verify-runtime.mjs` — runtime verifier (NOT read-only).** Installs the plugin into an isolated temp profile and cold-boots it with a dead model endpoint to verify activation end-to-end, reporting failure attribution. It really installs and runs plugin code (including npm/git lifecycle scripts) with the caller's permissions — it is NOT a sandbox; run it inside a throwaway Docker container when verifying third-party plugins you do not fully trust. POSIX only. Self-check: `verify-runtime.check.mjs` (wired into `npm test`).
- **`ghost-host-check.mjs` — running-host generation check (read-only on disk).** Executable form of pre-flight step 1.5: compares the host process's start time against the checkout's last change (a process that predates the change is a ghost still running the old code), verifies the argv actually resolves into the checkout (symlinks followed), and optionally sends one unauthenticated probe to classify the wire generation by the reply — never by a version number, and unknown replies stay unknown. `node skills/plugin-upgrade/scripts/ghost-host-check.mjs <hostPid> <checkoutDir> [port]`; exit 1 = ghost, so shell gates can consume it directly. Complements `verify-runtime.mjs`: that one cold-boots a fresh host, this one interrogates an existing one. POSIX only. Self-check: `ghost-host-check.check.mjs` (wired into the repo validator).

All three live inside `skills/plugin-upgrade/` so that installers that copy only the skill directory (`npx skills add`, `gemini skills install --path skills`, Cursor) ship them together with the cards they read.

## Usage

```sh
node skills/plugin-upgrade/scripts/plan-migration.mjs \
  --root /path/to/plugin \
  --from dsh-v0.1.1-rc.2 \
  --to dsh-v0.1.2-alpha.2
```

JSON for another tool:

```sh
node skills/plugin-upgrade/scripts/plan-migration.mjs \
  --root /path/to/plugin \
  --from dsh-v0.1.1-rc.2 \
  --to dsh-v0.1.2-alpha.2 \
  --format json
```

Known touchpoints can be added without suppressing detected ones:

```sh
node skills/plugin-upgrade/scripts/plan-migration.mjs ... --touchpoints 1,5
```

## What it does

1. reads `pre-flight-patterns.json`;
2. scans code and config files (`.ts .tsx .js .jsx .mjs .cjs .json .yml .yaml .toml`, plus lockfiles/Dockerfile/Makefile) while skipping Markdown, `.git`, dependencies (including `.node_modules-delete-pending` cleanup residue), generated output, sensitive filenames and files larger than 1 MiB; on macOS it reports and skips `dataless` cloud placeholders instead of implicitly downloading them;
   hits are ranked `src/` code first, other code next, config last, then capped at `--max-hits` (default 20); the touchpoint table reports shown/total;
3. reports path, line number and pattern number only—never the matching source line;
4. resolves an exact `from → to` path through card-set frontmatter;
5. selects cards intersecting detected/manual touchpoints;
6. puts cards without numeric touchpoints into a separate manual-review list;
7. reports an unsupported corridor gap instead of inventing missing migrations.

## Exit status

| Code | Meaning |
|---:|---|
| 0 | scan and card corridor completed |
| 1 | invalid arguments or unreadable input |
| 2 | no card-set corridor reaches the target tag |

## Limits

This is an intentionally conservative heuristic:

- zero hits do not prove public-contract-only coupling;
- skipped large or macOS `dataless` files leave the plan incomplete until those files are made available and the scan is rerun;
- card sets are curated, not complete API diffs;
- it does not parse TypeScript data flow or dynamic imports;
- it does not install dependencies, contact registries, edit files or run plugin code;
- build, target-tag typecheck, real profile activation and product smoke remain mandatory.

Run the regression guard with:

```sh
node skills/plugin-upgrade/scripts/plan-migration.check.mjs
```

The guard proves read-only behavior with a before/after hash snapshot, checks #3/#5/#6/#7 detection (including removed `dsh-client-runtime` and `useSession`), resolves the rc.2→alpha.2 corridor, validates card selection/redaction, and verifies unsupported-gap handling.
