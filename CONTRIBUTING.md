# Contributing to AgentTeams

Contributions are welcome: a precise reproduction, a focused fix, documentation, or a runnable host test all help. Please keep unrelated UI, installation, scheduler, and host migrations in separate PRs so each contribution can be reviewed and retained.

## Start with the actual environment

Read [the project skill guide](skills/README.md) before using a DSH lifecycle skill. The project copies take precedence over similarly named global skills. Their historical version examples are guidance, not our current compatibility policy.

Report the plugin version, actual Harness package version, OS, Node version, and profile. For Desktop, include both the application version and its embedded Harness version; upgrading a global CLI does not upgrade the embedded host. Include the error and minimal reproduction without credentials or unrelated private configuration.

[compatibility.json](compatibility.json) is the single source for supported targets and the recommended host. The current candidate targets are `0.1.2-rc.1` (recommended), `0.1.2-alpha.5` (preview), and `0.1.2-alpha.2` (legacy). A target being listed creates a test obligation; only a passing run for the actual package proves that obligation was met.

## Develop and verify a focused change

Use Node 24 and pnpm 10.33.0, matching CI:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm verify
pnpm pack --out candidate.tgz
```

Then consume that exact file through the real Harness entry point:

```sh
node scripts/harness-runtime-verify.mjs \
  --host-version 0.1.2-rc.1 \
  --artifact candidate.tgz \
  --report-dir /tmp/agent-teams-rc1-check
```

Repeat for every exact target returned by `node scripts/compatibility.mjs --github-output`, using the **same tarball** and a separate report directory. The runner pins and checks the entire DSH dependency cohort, creates isolated profiles, and replaces only the model adapter with a deterministic fixture. It needs no real API key. Its six required scenarios cover normal lifecycle, lifecycle cold recovery, fallback, fallback cold recovery, final failure, and waking a captain through a member notification after the captain has actually become idle. Each checks real plugin loading, tools, continuable members, persisted state, and the relevant messaging behavior.

PR CI runs `typecheck`, `build`, and `verify` on Ubuntu and Windows. Only after both pass does it run all three host targets on Ubuntu with the same Ubuntu-built tarball. The final gate checks every report's host version, plugin version, result, and tarball SHA-256. A build, HTTP 200, `--dump-config`, or `pack --dry-run` alone is insufficient.

These automatic tests do not prove real-provider behavior, browser interaction, or native Windows/Desktop runtime compatibility. For UI changes, include actual host/browser evidence following the project's Ego Lite browser rule. For provider-sensitive changes, record a real-provider run when credentials are available, without putting credentials in reports. State anything untested explicitly.

## Open the PR

Explain the concrete trigger, the resulting behavior, the exact tested host versions, and the relevant commands/results. Include a regression that fails without the fix when the change alters behavior; avoid tests that merely repeat a trivial implementation. Reference related issues and keep the description aligned with the final diff.

Maintainers review the current head and retain useful contributions. A small independent PR may be merged directly after its checks; overlapping compatibility PRs may be integrated together. When code is adapted or squashed, retain author attribution and link the original PR. A conflict or an outdated base is a request to rebase or narrow scope, not a reason to discard a sound contribution.

Do not overwrite vendored skill files while adapting project policy. Keep upstream files and their provenance lock intact; put local applicability in [skills/README.md](skills/README.md). Run `pnpm sync:skill` and `pnpm verify:skill` after changes to project-owned skills.

## Track issues and releases accurately

An issue can be **fixed in main**, **published**, and **verified in a specific environment** at different times. Link the commit or PR when merged, the exact package/channel when published, and the test or reporter confirmation when verified. Close a duplicate with its canonical tracking link; do not call it fixed merely because the duplicate was closed.

Please leave independent enhancements and reports missing key evidence open with a concrete next step. Release preparation follows [the maintenance workflow](docs/maintenance-workflow.md); preview packages use `next`, and `latest` requires the recommended host and the complete compatibility gate.
