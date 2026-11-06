# Protocol field notes on rc.2 (0.1.25)

This is a field report, not a compatibility claim: one real two-member team run on the published `0.1.25` artifact against host `0.2.1-rc.2`, recording what the task board, the claims and the quality gates actually did. It documents behaviour that is easy to misread from the tool descriptions, and two workflow consequences that cost us a full day.

## Environment

- Plugin `0.1.25`, host `0.2.1-rc.2` (Desktop bundle; the same `0.1.25` install gate described in [this directory's README](./README.md)).
- Windows 11, Node 24, default `maxMembers` (8), one captain session, two members: one implementation worker and one read-only reviewer.
- Real provider, no deterministic fixture. Four tasks: implementation → verification → gate implementation → review.
- No plugin source changes; nothing in this report required a patched build.

## Confirmed on this run

1. **Dependency gating is enforced, not advisory.** A verification task declaring `dependencies: [t1]` had no `attempt_id` while `t1` was `in_progress`, and was claimed **27 ms** after `t1` reached `completed`. Nothing on the captain side nudged it.

2. **Staging is a real gate.** `createdAt → approvedAt` was **69.3 s**; no member was spawned and no task was claimed during that window. With `approval: "required"` the plan is inert until approved.

3. **`inScope` / `outOfScope` govern claiming and completion bookkeeping — not the filesystem.** A write to a path outside a task's `inScope` succeeds. Listing that path in `changedPaths` is then rejected: `implementation cannot complete: <path> is undeclared`. The same path, left unclaimed, is surfaced by the closeout audit as an unclaimed change and makes it exit non-zero. Treat the fields as a contract the captain can audit, not as a sandbox.

4. **A verdict is bound to the revision it judged.** After the artifact directory recorded by a `pass` verdict was deleted, the captain's `delivery` state refused to advertise that task and named the drifted paths instead of keeping the stale pass. The binding works in both directions: it protects the review, and it cannot be quietly outlived.

5. **Structured verdicts are mandatory.** Completing a `review` / `verification` task without `acceptanceResults`, `commandsRun` and `verdict` is refused. This is the field that made "show me the reading, show me the image" unnecessary once the cards were written to use it.

6. **A review card cannot be claimed before its dependency completes**, even when the member is idle and the card is assigned.

## Two consequences worth documenting upstream

**Keep `inScope` on files a human or agent can actually read, not on build output.** A scope that cannot be enumerated completely becomes an explicit `ArtifactScopeGap` (`MAX_EXPANDED_ARTIFACTS = 200` in `lib/artifacts.js`). In our run a 428-file `dist-verify-writer/` produced such a gap; after the intermediate build directories were cleaned up, no verdict any longer bound the current bytes, and `delivery` stayed blocked while the captain still held a `pass`. Gap-as-evidence is the right default (a silently truncated list would let changes escape), but it means a gapped snapshot permanently blocks delivery: there is currently no way for the captain to re-bind or supersede it short of a new round. Excluding common build-output directories by default, or allowing an explicit re-bind after cleanup, would close that dead end.

**mtime and VCS status are not change signals.** A rollback restored a file to a byte-identical state with a fresh mtime, which an mtime-based criterion reports as dirty. Conversely, in a workspace whose sources are untracked, `git status --porcelain` collapses an entire tree into a single `??  path/` line and `git diff` is empty, so a git-based criterion passes vacuously. Path + size + sha256, or a file listing under `--untracked-files=all`, held up; VCS status did not.

## Not covered

Native desktop UI interaction, provider flakiness under load, more than eight members, more than one team per captain session (the second `create` is refused by design), and Windows path-length edge cases. None of these should be inferred from this report.
