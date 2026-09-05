# Docker Release Smoke Test

Use this runner to test a packaged plugin artifact against one exact DSH version in an isolated Docker container. It is a focused pre-release check, not a replacement for the plugin repository's unit, integration, browser, provider, or security tests.

## Prerequisites

- Docker Engine is running with Linux containers.
- The selected image contains Node.js and `npm` and is pinned by a non-`latest` tag or a digest.
- The plugin has already been built and packed as the artifact users will install, normally with `npm pack` or `pnpm pack`.
- The container can reach the package registry while it installs the exact DSH and pnpm versions.

Do not put registry credentials, provider keys, or other secrets in the JSON config. The runner redacts common token forms from final logs, but redaction is defense in depth rather than a credential-handling mechanism.

## Configure One Target

Create the config outside this Skill directory, preferably in the operating system's temporary directory:

```json
{
  "schema": 1,
  "image": "node:24-bookworm",
  "dshVersion": "0.1.2-alpha.2",
  "pnpmVersion": "11.24.0",
  "profile": "web",
  "startCommand": ["dsh", "web", "--no-open"],
  "readyPattern": "dsh web:",
  "timeoutSeconds": 60,
  "shutdownGraceSeconds": 5,
  "probeCommand": []
}
```

All commands are argv arrays and run without a shell. `readyPattern` is a JavaScript regular expression matched against combined DSH stdout and stderr. `timeoutSeconds` is the cold-start readiness timeout. The optional `probeCommand` runs after readiness and must exit successfully; keep it empty when startup itself is the intended functional proof.

## Run

From this repository:

```sh
node skills/plugin-test/scripts/docker-release-smoke.mjs \
  --config /path/to/smoke-config.json \
  --plugin /path/to/plugin-package.tgz \
  --report-dir /path/to/report
```

Omit `--report-dir` to create a retained report directory under the operating system's temporary directory. The command prints the exact paths. The runner writes only `report.json` and `report.md` to the report directory. Raw container logs and the isolated Profile are deleted after redaction and report generation.

The process exits with `0` for a passed smoke test, `1` for a reported test failure, and `2` for invalid input or a runner error.

## What It Proves

The runner performs these operations in order:

1. Starts a fresh named container and an isolated `HOME`.
2. Installs the exact pnpm and `@deepseek-ai/dsh` versions.
3. Reads installed package metadata and rejects a different resolved DSH version.
4. Installs the packaged artifact with `dsh plugin --profile <profile> add`.
5. Cold-starts the configured real DSH entry and waits for the readiness pattern.
6. Runs the optional functional probe.
7. Requests graceful shutdown, records the container exit, and removes the container.

While the container runs, the host samples `docker stats --no-stream`. Both reports include elapsed time, peak sampled memory, peak sampled CPU, step results, the artifact SHA-256, redacted logs, and explicit unverified boundaries.

## Interpret the Report

Failure classes distinguish Docker/infrastructure errors, host setup, plugin installation, startup, probe, and teardown failures. A passing report proves only this artifact, image, DSH version, Profile, entry command, and optional probe. It does not prove real-provider behavior without credentials, browser behavior, comprehensive security, other operating systems, or other DSH versions.

Keep generated reports out of the Skill repository unless they are deliberately reviewed evidence for a separate documentation change.
