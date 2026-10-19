# Harness 0.2.1-rc.2 compatibility

The published `0.1.24` and `0.1.24-rc.1` artifacts omit rc.2 in exact peer requirements, so the host rejects installation before activation. `0.1.25` adds rc.2, retains rc.1 and moves the development cohort to rc.2.

## Source audit

- rc.1: `1600d8a1e140dcde43a1a0941940a0480712c011`.
- rc.2: `687f282e8625c6b8d11ff58211a90524be2e4317` (`dsh-v0.2.1-rc.2`).
- Nine commits including merges. Changes concern release versions, DeepSeek web APIs/settings and a temporary model label. No source changes in agent, session, subagent, tools, system-prompt or plugin-manager contracts used by AgentTeams. The rc.1 activation adapter remains applicable.
- Official npm rc.2 resolves a complete 295-package DSH cohort. Pin the full closure; a CLI version alone is insufficient.

## Verification

The unmodified 0.1.24 official npm tarball was rejected by the rc.2 CLI plugin manager in a fresh isolated profile, reproducing the desktop error with no exemption active. The runtime runner now performs a real CLI plugin-manager add in a separate rc.2 profile, without `allow-version`, in addition to its existing lifecycle, recovery, failure, entry, web approval, protocol and stability scenarios. CI runs the exact supported-host matrix and Ubuntu/Windows checks before npm publication.

Real provider credentials, native desktop interaction and migration of existing user data are outside the isolated fixture coverage. Do not equate these checks with a manual desktop acceptance test.

Local macOS validation passed: build, typecheck, full `pnpm verify`, all ten runtime/recovery scenarios and the additional plugin-manager install check. Candidate SHA-256: `492b08fbf6e5cbc2ce8370846118e8cc65a06be95464ebab16bc8629c0b3b990`. The installation gate accepted the exact 0.1.25 package without an exemption. CI/publication results must be checked separately.

## Recovery

Existing published artifacts and tags are immutable. Upgrade to 0.1.25 on rc.2; do not bypass host compatibility checks. A rollback to 0.1.24 requires a supported host such as rc.1 and separate care for user data.
