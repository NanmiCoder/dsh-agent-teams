# Issue #336: keep artifact audits off the host event loop

`GET /plugins/dsh-agent-teams/state` audited all live teams by synchronously
reading and hashing their artifacts on the host thread. A file covered by both
recorded paths and a reviewed scope was hashed twice. Constant-memory chunks
bounded memory but did not yield the event loop.

The activity collector and `agent_teams_status` now share a lazy, owner-scoped
worker service. One worker executes audits. Identical requests can share a
queued audit until it is dispatched. The service bounds pending jobs at 16
with a 120-second active job timeout. Unload cancels work and late callbacks
keep a closed service.
Idle workers retire after ten seconds. Queue exhaustion, worker failures,
timeouts and invalid replies produce explicit audit gaps, never a partial pass.

The artifact reader shares reads only within one audit. Each scope retains its
own expansion cap, exclusions and gaps. Every subsequent audit reads the bytes
again. File descriptors are checked before and after hashing, identities are
revalidated after the combined read, and directory membership is rechecked
using the same exclusions as the scope traversal.
Changed or unreadable evidence remains incomplete. The host also rereads the
team record after worker completion; an edit, replacement attempt, archive or
corrupt record invalidates the old result.

These checks detect changes during normal reads; they do not make arbitrary
concurrent filesystem writes into an atomic workspace snapshot. Timestamp
checks invalidate evidence already read during this audit. They are not a
cross-request content cache. A stronger atomic guarantee needs a stable or
immutable artifact revision.

Measured on macOS arm64, Apple M5 Pro, Node 26.7.0, against base main
`3331b903f0e954d59ac69be1a75fd4fd7e1de20e` (0.1.28). Both sides used the
same exact installed Harness 0.2.1-rc.2 dependency cohort and production HTTP
handler, with minimal host-service substitutes. The fixture had three
workspaces, seven live teams and 200 independent artifact paths totalling
3,211,047,360 bytes. Recorded paths and reviewed scope overlapped. Files were
generated before measurement; these are not forced cold-disk measurements.

| Three repeated requests | Before | After |
| --- | ---: | ---: |
| Handler duration | 2,368.78–2,673.50 ms | 1,214.02–1,232.69 ms |
| Maximum host heartbeat gap | 2,366.44–2,667.23 ms | 6.18–11.09 ms |
| Concurrent health request latency | 2,341.09–2,642.29 ms | 26.70–28.94 ms |
| Artifact bytes read **on the host thread**, per request | 6,422,094,720 | 0 |
| Response bytes | 2,937 | 2,937 |

The static JSON responses were identical. Worker I/O was not counted by the
host-thread instrumentation. The separate deterministic regression confirms
one artifact open per audit for path/scope overlap, rather than two; a later
audit opens the artifact again. Small audited inputs also pay worker startup
cost, while teams with no audit paths/scopes avoid starting a worker.

Validation on the final source/build:

- The host-read and duplicate-read regressions both fail on the base artifact
  (262,144 host bytes instead of zero; two opens instead of one).
- `pnpm typecheck`, `pnpm build`, `pnpm verify`, `git diff --check`, and the three
  CI fixture-test files pass. The regression file has 19 passing tests,
  including same-size edits with restored mtime, read-time mutations, new scope
  files, source-record changes/archival/corruption, queue coalescing, bounded
  queues, worker failure/timeout, and Cordis unload/reload.
- The related quality-gate suite passes 68 tests, retaining cap, unreadability,
  new-file, deletion, exclusion and symlink coverage.
- The same final tgz passes real CLI/Loader Web approval and native plugin
  installation on exact Harness 0.2.1-rc.2 (295 verified host packages). The
  credential-free Web scenario checks the authenticated production state
  route, shipped worker entry, zero host artifact reads, and a changed artifact
  invalidating a review without any team.json edit.
- Candidate tgz SHA-256:
  `ad1fe1dc35a3f4e3405c2539ce53e4d5b3caf96a8da5026e3c12c923cb2b8199`.

Focused commands:

```sh
node --test scripts/issue-336.test.mjs
pnpm verify:quality-gates
pnpm pack --out /tmp/issue-336-candidate.tgz
node scripts/harness-runtime-verify.mjs --host-version 0.2.1-rc.2 \
  --artifact /tmp/issue-336-candidate.tgz --report-dir /tmp/issue-336-runtime \
  --scenario web-approval
```

The client bundle is unchanged: rebuilding CSS modules in a different absolute
checkout path changes only generated CSS hashes/region paths, so the unchanged
base client artifact was retained and the Git artifact stamp regenerated.

Native Windows/Desktop, real provider APIs, browser interaction, other host
versions and user-data migrations were not exercised locally. The existing
Windows and exact-host CI gates remain necessary. Payload projection and
conditional polling in PR #332 overlap snapshot assembly and should retain
these current-byte audits during integration.
