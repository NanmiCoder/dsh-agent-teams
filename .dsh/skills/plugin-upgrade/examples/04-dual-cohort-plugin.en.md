# Example 04: dsh-mnemon Dual-Cohort Compatibility Across rc.2 and alpha.1

English | [简体中文](04-dual-cohort-plugin.md)

> This is a field record of the `omdsh-dev/dsh-mnemon` migration completed from 2026-08-27 to
> 2026-08-28. It is pinned to fixed commits, is not an executable fixture in this repository, and
> does not imply that every dual-cohort difference can be handled without a branch.

## Identity, planes, and versions

- Plugin: `dsh-mnemon`, version `0.3.4` while the compatibility change was developed, then released
  in [`v0.3.5`](https://github.com/omdsh-dev/dsh-mnemon/releases/tag/v0.3.5).
- Published baseline: DSH [`dsh-v0.1.1-rc.2`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.1-rc.2)
  (commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`), supplied by the npm registry and lockfile.
- Source-preview target: DSH [`dsh-v0.1.2-alpha.1`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.1)
  (commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`). Alpha.1 was not published to npm, so the
  official tag was built for verification.
- Plugin evidence: initial adaptation commit
  [`30d7476`](https://github.com/omdsh-dev/dsh-mnemon/commit/30d7476ba58f86e417959aae64d4dd3fb80f0434),
  rc.2 compatibility correction
  [`b50a504`](https://github.com/omdsh-dev/dsh-mnemon/commit/b50a504dbe738aa359cd6ef8e4fd790ed9c19a10),
  and merged [PR #105](https://github.com/omdsh-dev/dsh-mnemon/pull/105).
- Planes: Host (custom Connection RPC, settings, and authority), Web Client
  (runtime/Workspace/slot/locale types), plus Headless and package verification. This is not a
  single-plane ordinary Cordis plugin migration.
- Hit touchpoints: #3 services/RPC, #5 Web UI/client dependencies, #6 custom RPC/auth channels,
  and #7 source-build/Headless wrappers; also the packaging/dependency and security/config special
  surfaces.

Related cards and rollup entries:

| Hit | Applicable plane | Evidence |
|---|---|---|
| Removed `dsh-client-runtime` and split Client/Workspace ownership | Web Client | `DSH-0.1.2-A1-25`, `DSH-0.1.2-A1-32` |
| Session-view, slot, and client type ownership changes | Web Client | `DSH-0.1.2-A1-03` |
| Per-channel authority replaced by uniform browser-session authentication | Host custom Connection RPC | `DSH-0.1.2-A1-08` |
| Source-only alpha.1 while retaining rc.2 users | dependency/CI | `R-01`, `R-02`, `R-04` |
| Headless or a resource 200 cannot replace Web acceptance | Web acceptance | `DSH-0.1.2-A1-19` |

See the complete [0.1.2-alpha.1 card set](../references/v0.1.2-alpha.1.md) and the
[0.1.2 rollup](../references/rollup-0.1.2.md).

## Why the first green result was still not mergeable

The initial adaptation covered the client-runtime split, Workspace snapshot, locale/slot changes,
the new Host RPC API, and an alpha source CI lane. It built and passed the checks available against
alpha.1, but it removed the third authority argument from
`connection.rpc.handle(channel, handler, options)` and deleted the `remoteAccess` setting.

That matched alpha.1: its `handle` implementation has two parameters and every channel goes through
uniform browser-session authentication. The installable npm baseline was still rc.2, however, and
its real implementation dereferences `options.authority`. Calling the real rc.2
`HostConnectionService` without options failed before the Web Host could register the route:

```text
TypeError: Cannot read properties of undefined (reading 'authority')
```

The verification gap had two causes:

1. RPC unit-test mocks accepted a two-argument call and did not encode rc.2's required options;
2. the Headless profile has no Web `connection`, so real Headless activation cannot exercise Web RPC
   registration.

Pinned primary sources: rc.2
[`HostConnectionRpc.handle`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/packages/client/connection/src/rpc.ts)
requires options and
[`HostConnectionService.register`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/packages/client/connection/src/rpc-host.ts)
reads `options.authority`; alpha.1
[`HostConnectionRpc.handle`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/packages/client/connection/src/rpc.ts)
and
[`HostConnectionService`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/packages/client/connection/src/rpc-host.ts)
consume only the first two arguments.

## Final single-implementation compatibility strategy

The final implementation does not parse the DSH version, inspect `function.length`, or add a
capability branch. It uses a call superset supported by both real JavaScript implementations:

- always pass rc.2's trailing `{ authority }` argument;
- rc.2 consumes it and keeps its `loopback` versus `trusted-host` distinction;
- alpha.1 ignores the extra argument under JavaScript call semantics and applies uniform browser
  authentication;
- retain `remoteAccess` as an rc.2 startup-time security setting that Web settings cannot mutate.
  Alpha.1 accepts it for forward/rollback compatibility but does not treat it as a transport switch.

The pinned implementation is in
[`src/contracts.ts`](https://github.com/omdsh-dev/dsh-mnemon/blob/b50a504dbe738aa359cd6ef8e4fd790ed9c19a10/src/contracts.ts),
[`src/rpc.ts`](https://github.com/omdsh-dev/dsh-mnemon/blob/b50a504dbe738aa359cd6ef8e4fd790ed9c19a10/src/rpc.ts), and
[`src/settings.ts`](https://github.com/omdsh-dev/dsh-mnemon/blob/b50a504dbe738aa359cd6ef8e4fd790ed9c19a10/src/settings.ts).
The real-implementation regression is
[`tests/dsh-connection-compat.spec.ts`](https://github.com/omdsh-dev/dsh-mnemon/blob/b50a504dbe738aa359cd6ef8e4fd790ed9c19a10/tests/dsh-connection-compat.spec.ts).

This strategy applies only because the extra argument was proven to be harmless in the new
implementation and meaningful in the old one. When cohort semantics are mutually exclusive, use an
explicit adapter or capability split instead of hiding the difference to achieve a branch-free shape.

## Reversible source overlay

The plugin's `package.json` and lockfile remain on the rc.2 registry baseline. The alpha.1 lane builds
an isolated official checkout and temporarily links only the required `@deepseek-ai/*` package outputs
into `node_modules`. Before changing any link, its script:

1. validates the DSH root version, every package name/version, and the built `lib/` outputs;
2. records all original registry symlinks and creates the restore record exclusively;
3. replaces links only after the complete preflight succeeds;
4. restores every registry link and removes the record after verification.

See the pinned
[`scripts/link-dsh-source.mjs`](https://github.com/omdsh-dev/dsh-mnemon/blob/b50a504dbe738aa359cd6ef8e4fd790ed9c19a10/scripts/link-dsh-source.mjs).
This keeps an unpublished alpha out of the release lockfile and avoids leaving a half-linked mixed
cohort after a preflight failure.

## Actual verification matrix

| Lane | What ran | Result |
|---|---|---|
| Local rc.2 registry | `pnpm run verify` after restoring registry links | 49 test files and 524 tests passed; one Windows-only test skipped |
| Local alpha.1 source overlay | official tag `build:lib` → link → the same `pnpm run verify` → restore | the same 49 files/524 tests passed; rc.2 registry state confirmed after restore |
| Real Web registration contract | current lane's real `HostConnectionService` registers a Mnemon route | the same three-argument call is consumed by rc.2 and ignored by alpha.1; both register the route |
| rc.2 CI | Ubuntu Node 22.19/24; Windows Node 24 type, targeted integration, deterministic build, and package checks | passed |
| alpha.1 CI | Node 24 builds the official tag, overlays package outputs, and runs the full verify chain | passed |
| Layers inside `verify` | typecheck, tests, deterministic double build, real isolated Headless profile, package contents/public entries, publint, and attw | passed |

The core process actually run in the dsh-mnemon repository at that point was:

```sh
# rc.2 registry baseline
pnpm install --frozen-lockfile
pnpm run verify

# in an isolated official dsh-v0.1.2-alpha.1 checkout
pnpm install --frozen-lockfile
pnpm run build:lib

# back in dsh-mnemon at b50a504
DSH_SOURCE_ROOT=<absolute-alpha-checkout> pnpm run dsh:link-source
pnpm run verify
pnpm run dsh:restore-registry
pnpm run verify
```

## Proven and unproven boundaries

**Proven**: the same plugin source, configuration schema, and RPC registration implementation pass
the complete verification chain against both the rc.2 registry and exact alpha.1 source package
outputs; rc.2's authority semantics remain intact; the overlay restores cleanly; package gates pass.

**Not proven**: this PR did not install one pre-packed, bit-identical tarball into both cohorts and run
a complete product-browser mount; it did not use real Provider/API credentials; the Windows lane did
not run every test from the Linux lane. The real Connection test proves Web route registration, but it
does not replace the token-to-Cookie, boot-manifest, bundle-load, DOM-marker, and page-error acceptance
required by [DSH-0.1.2-A1-19](../references/v0.1.2-alpha.1.md).

## Benchmark distillation and leakage boundary

The incident is distilled into executable task
[H11-dual-cohort-rpc](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/benchmark/tasks/H11-dual-cohort-rpc/README.md). Its grader invokes
the independently locked, published rc.2 and alpha.2 `HostConnectionService` implementations and
checks real route registration, both `remoteAccess` authority vectors, and the absence of
version/arity/failure-retry branches. alpha.2 substitutes for the unpublished alpha.1 only at this
fixed two-argument seam; it is not evidence that the releases are equivalent elsewhere.

This page states the answer, so H11 with-skill trials must mount the pre-contribution skill commit
`7d33bf4c492da250c94f48aebd29bb16877d7a36`, never the current skill directory. Task provenance
records the materialization command, three-run multi-model recommendation, and unverified boundaries;
this contribution does not report model scores that have not been run.

## Transferable conclusions

1. Dual-cohort completion means the new target passes without regressing the current installable
   baseline; compiling a source preview alone is insufficient.
2. Mocks must encode the old real implementation's required parameters; Headless green does not prove
   Web registration green.
3. Do not automatically delete an old setting merely because the new Host ignores it; while the old
   cohort is supported, its security behavior remains a product contract.
4. Prefer a branch-free call superset only after both real implementations prove it safe; similar
   TypeScript signatures are not proof.
5. Test unpublished cohorts through an atomic, reversible source/package overlay while keeping the
   release lockfile installable.
6. Report separately what Host, Web Client, Headless, and packed-artifact evidence each proves.
