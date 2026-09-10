# Tools in this directory

Four executables live here, with very different safety postures — read the
verifier's note before running it on anything you do not trust:

- **`plan-migration.mjs` — read-only migration planner.** Turns the existing pre-flight patterns and version-card metadata into a deterministic first-pass plan. It never writes the target repository and has no output-file option.
- **`verify-runtime.mjs` — runtime verifier (NOT read-only).** Installs the plugin into an isolated temp profile and cold-boots it with a dead model endpoint to verify activation end-to-end, reporting failure attribution. It really installs and runs plugin code (including npm/git lifecycle scripts) with the caller's permissions — it is NOT a sandbox; run it inside a throwaway Docker container when verifying third-party plugins you do not fully trust. POSIX only. Self-check: `verify-runtime.check.mjs` (wired into `npm test`).
- **`inject-lint.mjs` — alpha.2 residue/peer check (read-only).** Checks removed `dsh-client-runtime` references in source, JSON/YAML manifests and text lockfiles, the checklist's Cordis peer floor, and peer completeness for declared client inject modules and recognized imports. Reports raw WebServer registrations for manual auth review; does not derive inject from imports or prescribe RPC rewrites. See its report contract below. Self-check: `node --test skills/plugin-upgrade/scripts/inject-lint.test.mjs` (wired into `npm test`).
- **`ghost-host-check.mjs` — running-host generation check (read-only on disk).** Executable form of pre-flight step 1.5: compares the host process's start time against the checkout's last change (a process that predates the change is a ghost still running the old code), verifies the argv actually resolves into the checkout (symlinks followed), and optionally sends one unauthenticated probe to classify the wire generation by the reply — never by a version number, and unknown replies stay unknown. `node skills/plugin-upgrade/scripts/ghost-host-check.mjs <hostPid> <checkoutDir> [port]`; exit 1 = ghost, so shell gates can consume it directly. Complements `verify-runtime.mjs`: that one cold-boots a fresh host, this one interrogates an existing one. POSIX only. Self-check: `ghost-host-check.check.mjs` (wired into the repo validator).

All four live inside `skills/plugin-upgrade/` so that installers that copy only the skill directory (`npx skills add`, `gemini skills install --path skills`, Cursor) ship them together with the cards they read.

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


## Inject lint report contract

```sh
node skills/plugin-upgrade/scripts/inject-lint.mjs /path/to/plugin
```

Run on one package root for the alpha.2 checklist. The command reads the root
`package.json`, source (`.js/.jsx/.ts/.tsx/.mjs/.cjs/.mts/.cts`), JSON/YAML
(including nested/generated manifests), and text lockfiles (`package-lock.json`,
`npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`). It skips
`node_modules`, `.git` and symlinks; binary lockfiles are not inspected.

- `declaredInject` contains only `dsh.client.inject`, never the host inject list.
- `importedClientModules` inventories recognized static import/re-export owners,
  including type-only imports. It is a source heuristic, not a complete parser;
  dynamic/computed imports and unrecognized modules still need manual review.
- `peersMissingForInject` and `peersMissingForImports` both affect the verdict.
- `runtimeRefsLeft` includes removed-package references in code and config.
- `rawWebServerRouteFiles` and `routeReviewRequired` ask for review of the actual
  auth guard and protocol. A guard can live in a helper; regex hits cannot prove
  protection, guard ordering, or a need to rewrite the route as RPC.

`verdict` is `FIX-REQUIRED` for a residue/peer failure, `REVIEW-REQUIRED` when
only raw-route review remains, otherwise `OK` for these checks. `OK` does not
prove the inject graph is complete or that a plugin boots. Import-derived
`derivedInject`, `missingFromInject` and `extraInInject` judgments are intentionally
not emitted: type-only and static-library imports do not establish runtime edges.

A completed scan exits 0 and emits one JSON report, including when its verdict
requires work. Invalid/unreadable input exits 2; callers must inspect both the
exit status and `verdict`. Build, typecheck and real profile/route checks remain
separate validation layers.
