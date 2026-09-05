# DSH Version-Migration Testing Reference

Use this file to design Harness version-migration regressions without another Skill. The goal is to prove that the published artifact works on the exact target version, not merely that the source passes typechecking.

## 1. Build the Migration Test Ledger

1. Record the exact from/to tags, the declared and resolved DSH/Node versions, the lockfile, and the installation track.
2. Read the release notes, source, and type declarations for every intermediate version in their actual version order, then fold them into the target version's net state.
3. Classify changes as `breaking`, `behavior`, or `capability`. The first two classes must enter the regression matrix. Test a `capability` only when the plugin adopts it.
4. Mark a missing primary source or version edge as "unverified". Never turn a mock result into a compatibility conclusion.

| Version edge | Change | Type | Affected files | Regression assertion | Runtime proof |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

## 2. Scan Touchpoints and Map Assertions

Scan tracked source, tests, scripts, CI, and root configuration. Exclude generated output, vendor directories, and `node_modules`.

| Touchpoint | Suggested search | Minimum regression assertion |
|---|---|---|
| #1 Source patch | `cordis.patch.yml|patchedDependencies|patch-package|monkey` | The patch applies to the target upstream file or has been replaced by a public seam. Upstream-coordinate drift must turn the test red. |
| #2 Events | `SessionEvent|session/event|ctx.on|subscribe` | Producer, persistence, reload, transport, and observer agree on the new semantics. Unknown required events are not silently dropped. |
| #3 Services and Remote | `ctx.remote|ctx.get|@Remote|/internal` | Cover success, known business failures, unknown failures, cancellation, and assembly defects. Do not replace the production face with an in-process fake. |
| #4 Host filesystem | `DSH_HOME|profiles|homedir|readFile|writeFile` | Read and write only the isolated target Profile, preserve correct path and data ownership, and keep unauthorized files byte-identical. |
| #5 UI, commands, and tools | `registerCommand|registerView|ctx.tools|ctx.effect` | Use the real Loader to prove registration visibility, correct Schema/rendering, unload cleanup, and no duplicate registration under HMR. |
| #6 Custom channels | `createServer|WebSocket|MutationObserver|localhost` | Validate authentication, Host/Origin, port lifecycle, disconnect/reconnect, and teardown. Loopback does not waive authentication. |
| #7 Subprocesses and output | `child_process|spawn|execa|headless|--profile` | Assert argv, cwd, env, cancellation, exit code, stdout/stderr classification, and teardown, not merely that the process starts. |

Cover permissions and approvals, peer dependencies and packaged artifacts, and privacy or data-egress concerns separately. Zero hits across all seven classes does not prove compatibility. Dependency resolution, build, real mounting, and the core behavior still require validation.

## 3. Validate in Increasing Order of Proof Strength

1. **Dependencies and static checks**: confirm that the lockfile and dependency graph contain no unintended cohort, then pass typecheck, build, and static checks.
2. **Change-level regressions**: give every `breaking` or `behavior` entry at least one assertion that turns red when the regression returns.
3. **Real composition**: start a test Profile through the real Loader and mock only expensive or nondeterministic boundaries.
4. **Exact target runtime**: install the packaged artifact, cold-start it, confirm entry activation and that services do not remain pending, then complete one message → tool → reply flow or an equivalent specialized flow.
5. **Published entry**: run the built `bin` or non-default entry under native Node and cover module resolution, exit codes, and shutdown races.
6. **Cross-cohort claim**: when one artifact claims to support multiple host versions, repeat levels 3–5 on every claimed version.

Typechecking, config parsing, mock Contexts, and credential-free pipelines are not runtime compatibility proof. List every unavailable provider credential, operating system, browser, PTY, or destructive data migration as an unverified boundary.

## 4. Re-Verify Old Artifacts In Place (Same-Payload Control)

After the upgrade, take output produced *before* it — old session messages, stored renders, earlier exports — and re-verify it in place on the new version. The payload is identical by construction, so any change isolates to the layer that interprets it. This is the cheapest control experiment available: no new fixture, no new session, one reload.

Two rules from a measured case (2026-08-31, empty-table forensics against a 0.1.2-alpha.2 host):

1. **When a third-party plugin owns the rendering, the new host version is not the first suspect.** A message surface that broke "after the upgrade" turned out to be a third-party UI widget dropping data during extraction; the host's own markdown pipeline, driven with the real parse chain, reproduced all seven table-syntax variants correctly. Attribution flipped only when the same old message was re-rendered in place after upgrading the widget — same payload, 1 row × 0 cells before, 17 rows × 51 cells after. Without the in-place control, the bug would have been filed upstream against the wrong owner.
2. **Change one layer at a time and re-check the same artifact between steps.** In-place re-verification of unchanged payloads turns "which layer broke it" from an argument into a bisect: host upgrade first, re-check; renderer upgrade next, re-check. The artifact never changes, so every diff belongs to exactly one step.

Full case write-up with the forensic chain: [dsh-assembler migration ledger, "empty-table" section](https://github.com/TT-Wang/dsh-assembler/blob/main/docs/research/dsh-alpha2-migration.md).
