# DSH Version-Adaptation Implementation Reference

Use this file to adapt a Harness version while writing or modifying a plugin, without loading another Skill. Do not treat historical examples as the target contract. The exact target tag's source, type declarations, release notes, and reproducible runtime behavior are authoritative.

## 1. Lock the Baseline and Target

1. Read the repository rules and inspect the workspace, branch, and uncommitted changes. Do not automatically stash, reset, or clean.
2. Record the exact from/to tags, resolved version, Node version, package manager, and lockfile.
3. Record the installation track: registry, Git checkout, workspace or junction, or copied installation.
4. Keep the package manifest, community manifest, and Profile composition separate. Never overwrite unknown fields by writing back a whole object.

## 2. Build the Version-Migration Ledger

Read release notes and target source edge by edge in actual version order. Never infer order from filenames. Read the full corridor first, then fold intermediate removals, restorations, and renames so implementation targets only the final net state.

| from → to | Type | Evidence | Touchpoint | Target state | Validation |
|---|---|---|---|---|---|
|  | `breaking` / `behavior` / `capability` | tag, source, or release notes | #1–#7 |  |  |

- `breaking`: implementation is required. If the user has not authorized writes, present the plan, risk, and rollback path first.
- `behavior`: the code may still build, but it needs a regression test for the new semantics.
- `capability`: recommend it only; do not adopt it automatically.
- When any version edge or API coordinate is missing, mark it "unverified" and do not modify from memory.

## 3. Scan Seven Touchpoint Classes

Scan tracked source, tests, scripts, CI, and root configuration. Exclude generated output, vendor directories, and `node_modules`.

| Touchpoint | What to inspect | Suggested search |
|---|---|---|
| #1 Source patch | Host paths, monkey patches, and patch targets | `cordis.patch.yml|patchedDependencies|patch-package|monkey` |
| #2 Events | Internal event names, persistence, reload, and transport | `SessionEvent|session/event|ctx.on|subscribe` |
| #3 Services and Remote | Package entries and error semantics across Host, Web Client, and Plugin faces | `ctx.remote|ctx.get|@Remote|/internal` |
| #4 Host filesystem | Direct access to `DSH_HOME`, Profiles, or session data | `DSH_HOME|profiles|homedir|readFile|writeFile` |
| #5 UI, commands, and tools | Registration entries, Schemas, renderers, unload, and HMR | `registerCommand|registerView|ctx.tools|ctx.effect` |
| #6 Custom channels | Authentication, ports, and teardown for HTTP, WS, RPC, and DOM/CSS channels | `createServer|WebSocket|MutationObserver|localhost` |
| #7 Subprocesses and output | argv, cwd, env, cancellation, exit codes, and stdout/stderr ownership | `child_process|spawn|execa|headless|--profile` |

Inspect permissions and approvals, packaging and dependencies, and privacy or data egress separately. Zero hits across all seven classes is only a heuristic result. Still inspect dependencies and imports, then run build, real mounting, and a functional smoke test.

## 4. Implement and Validate

1. Group modifications by seam and record the affected files, evidence, target behavior, and regression test for each group.
2. Modify only paths owned by the plugin. Do not change Harness core to hide a compatibility problem.
3. Inspect the dependency graph and lockfile to ensure DSH packages do not mix cohorts.
4. Run typecheck, build, and regressions for every affected touchpoint.
5. Install the built artifact into an isolated Profile running the exact target version. Validate cold start, entry activation, and that Cordis services do not remain pending, then complete one message → tool → reply flow or an equivalent core flow.
6. If claiming cross-cohort compatibility, repeat runtime validation with the same artifact on every claimed version.

In the final report, separate completed work, skipped items, unverified boundaries, rollback baseline, and residual risk. Never describe static green checks as proof that the exact target version runs successfully.
