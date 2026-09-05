# legacy-plugin · Static Fixture for the Seven Touchpoints

English | [简体中文](README.md)

This is a static fixture that deliberately contains legacy coupling and wrong assumptions, used to verify that [pre-flight.md](../../references/pre-flight.md) can detect all seven touchpoints. It is not an installable plugin — by design it must not be executed, must not be published, and cannot compile.

When the repository's `node scripts/validate.mjs` runs, the validator scans this directory (excluding this README) using [pre-flight-patterns.json](../../references/pre-flight-patterns.json), and each of the seven touchpoints must be hit at least once.

| Touchpoint | Hit location |
|---|---|
| #1 Source patch | [patch.yml](patch.yml) · [apply-patch.mjs](scripts/apply-patch.mjs); `cordis.patch.yml` itself is a composition negative control |
| #2 Internal/persistent events | [src/index.ts](src/index.ts) · external informational SessionEvent producer |
| #3 Internal service/Remote | [src/index.ts](src/index.ts) · `ctx.get('apiProxy')` |
| #4 Host filesystem | [src/index.ts](src/index.ts) · hardcoded `~/.dsh/profiles/default` |
| #5 Internal UI/commands | [src/index.ts](src/index.ts) · internal import + `registerCommand` |
| #6 Custom channel | [src/index.ts](src/index.ts) · loopback HTTP `/api/legacy` |
| #7 Subprocess/output | [src/index.ts](src/index.ts) · [apply-patch.mjs](scripts/apply-patch.mjs) · wrong assumption that stdout is JSONL |

Related cards use full IDs (e.g. `DSH-0.1.2-A1-01`, `DSH-0.1.2-A2-02`). This fixture only proves that the scan patterns have known positive samples; it does not prove that zero hits from a scan means there is no host coupling.
