# Static-migration precision checklist (0.1.2-alpha.2 cohort)

Apply this checklist to the alpha.2 migration corridor. For another target or
continued support for older hosts, follow that corridor's net dependency and API
contracts instead of applying these cohort checks unchanged.

## Landing discipline — where your work goes (read this first)

Two different read-only rules apply, and mixing them stalls the migration:

- The **verification** layer is read-only with respect to its subject: run checks
  against a copy or an isolated profile; never mutate a tree just to test it.
- The **migration** itself is hands-on by definition: in author-migrate mode you
  edit the target repository (or the evaluation fixture, e.g. `/app/fixture/`)
  **directly**, and you write the required report under the designated output
  path (e.g. `/app/agent-output/<task>/`) before the deadline.
- **Read-only scan tasks are the exception**: when the task statement says the
  fixture must stay unchanged, the fixture stays untouched and the **report is
  the deliverable** — write it to the designated output path early, not after
  all analysis is perfect. A missing report scores zero regardless of the
  analysis done; an imperfect report on disk beats a perfect one in your head.

Do not build the migration in a scratch directory and forget to land it: a
correct patch that never reaches the fixture reads as "unchanged" and scores
zero, and a missing report is graded as zero regardless of the work done.
Scratch space (`/tmp`, worktrees) is for verification scripts only — the
migration product lives in the fixture.


Compiled from community-verified migration failures where the plugin booted but the
static migration was still judged incomplete. A bootable plugin with an imprecise
static migration is not done: reviews cap it well below full credit. Check every
item before declaring the static layer complete.

## Peer version floors — exact values, not newer carets

The cohort pins some peers to exact carets. Resolving one patch newer is a miss,
not an improvement:

| Peer | Required | Common wrong value |
|---|---|---|
| `@deepseek-ai/cordis` | `^4.0.1` | `^4.0.2` |

Also required: no bare `cordis` key survives anywhere in the peer block; no `-rc`
suffix survives; every `@deepseek-ai/dsh-*` peer floor sits on the target cohort
(`^0.1.2-alpha.1` or later within the cohort), with no legacy provider left behind.

## `dsh.client.inject` is an exact recomposition, not a subset

For Web Client plugins, recompose the removed `dsh-client-runtime` dependency
by capability. These are candidate owners to inspect, not a mandatory inject
list; static platform libraries and type-only dependencies need not be runtime
module edges:

| Capability you use | Candidate owner |
|---|---|
| UI primitives (self-drawn panels, controls) | `@deepseek-ai/dsh-client-ui-primitives` |
| UI slots (mounting into host slot points) | `@deepseek-ai/dsh-client-ui-slots` |
| Locale / i18n | `@deepseek-ai/dsh-client-locale` |
| Settings plugins tab | `@deepseek-ai/dsh-client-ui-settings-plugins` |
| Snapshot / client store | `@deepseek-ai/dsh-client-store` |
| Session list / controller | `@deepseek-ai/dsh-api-session-controller` |
| Sidebar | `@deepseek-ai/dsh-client-ui-sidebar` |
| Renderer/slots implementation | `@deepseek-ai/dsh-client-ui-renderer` |

**`dsh.client.inject` records runtime module dependencies.** Use the plugin's
product shape to identify candidate owners, then check the target host's module
table, composition, and actual service consumption. Neither a type-only import
nor a value import from a static platform library proves a required inject edge:

| Product shape | Candidate owner to verify |
|---|---|
| Self-drawn panel / controls / tree UI | `@deepseek-ai/dsh-client-ui-primitives` |
| Mounts into a host slot point | `@deepseek-ai/dsh-client-ui-slots` |
| Own strings / i18n | `@deepseek-ai/dsh-client-locale` |
| Settings tab page | `@deepseek-ai/dsh-client-ui-settings-plugins` |
| Sidebar mount | `@deepseek-ai/dsh-client-ui-sidebar` |
| Composer / dock surface | `@deepseek-ai/dsh-client-ui-conversation` |
| Hosts the renderer/slots service itself | `@deepseek-ai/dsh-client-ui-renderer` |

**The renderer's double role decides both lists.** After the split, the slots
service lives in `ui-renderer`:

- A plugin that **consumes** slots needs the renderer-owned Context declarations
  in its type graph. An explicit type-only import is one way to make that
  dependency visible when no other import already brings in the augmentation:

  ```ts
  // Makes the renderer-owned ctx.slots declaration available to TypeScript.
  import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
  ```

  This import is erased from JavaScript: it cannot load a module, register a
  service, or resolve a runtime wait on `slots`. Keep the owning package in
  peers for the consumed types. For a pending `slots` service, inspect the
  renderer's activation in the real client composition and the consumer's
  service-level `export const inject`; adding a type-only import is not a boot
  fix. Do not add renderer to package-level `dsh.client.inject` solely because
  of this type import.
- A plugin that **hosts** the renderer/slots service for others must arrange the
  real renderer module's activation in the client composition. Verify the
  resulting module edges and service availability with a cold boot.

The type graph and runtime service graph require separate checks. The target
renderer provides `slots` in its runtime implementation; TypeScript module
augmentation only describes that service.

Sources: [alpha.2 renderer declarations and apply](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/client/ui-renderer/src/client/index.ts),
[alpha.2 module graph contract](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/client/modules/src/client/manifest.ts),
[TypeScript type-only import semantics](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-8.html#type-only-imports-and-export).

**Locale pairing is a mandatory final check** for ANY plugin shipping
user-facing text: type-level `LocaleNamespaceMap` augmentation AND runtime
`ctx.locale.register`, both present, every time — do not skip it when the rest
of the migration feels complete.

**Peers are a superset of inject**: every module whose types or services the
plugin touches appears in `peerDependencies` on the cohort floor — including
modules used only for types.

Run `node scripts/inject-lint.mjs <fixture-dir>` (shipped with this skill) for
a residue and peer check: dead `dsh-client-runtime` references in source,
JSON/YAML manifests and text lockfiles, cordis not at `^4.0.1`, and missing
peers for declared client inject modules or recognized imports (including
type-only imports). It does not derive inject from imports. Raw WebServer
registrations are reported for manual auth review, not as mandatory rewrites.

In-source compatibility notes are not facts. A comment or memo claiming a
legacy engine package is "deprecated but present" does not make it importable
after removal — the version cards and the registry are the only source of
truth; migrate the import to the new home.

## Dead references are cleared everywhere, not just the obvious three

`dsh-client-runtime` removal means the identifier is gone from **all** of:
`dependencies`/`peerDependencies`, `dsh.client.inject`, import statements,
type-only imports and re-exports, and any lockfile or generated manifest that
still carries it. A single surviving reference (including a stale type import)
leaves the static migration incomplete even when install and boot both pass.

## Peer dependency completeness

- Touching `ContentBlock`-family values requires `@deepseek-ai/dsh-llm` in peers
  (it moved there in this cohort).
- Every genuinely optional peer carries its `peerDependenciesMeta.optional` flag,
  and the flags match reality — count them.

## Locale namespaces are declared, not implied

A plugin with its own strings registers its namespace twice: the type-level
`LocaleNamespaceMap` augmentation **and** the runtime `ctx.locale.register` call.
One without the other is incomplete. This applies to **any** plugin that ships
user-facing text — panels, sidebars, tool trees — not only locale-centric
plugins; a single hardcoded string panel still declares its namespace.

## Channel auth joins the host gate (A1-08)

A raw `ctx.webServer.register` / `registerUpgrade` route does not automatically
inherit Connection authentication. Preserve its protocol while connecting it
to the host gate, as described in [DSH-0.1.2-A1-08](v0.1.2-alpha.1.md):

- An existing HTTP/download/streaming/WS handler may keep its WebServer route
  and call `ctx.connection.requestRejection(req)` before handling protected
  data or side effects. Honor its 401/403 result and stop processing; retain
  `webServer` and add `connection` to the entry's service inject list.
- A compatible exact HTTP endpoint may use `ctx.connection.fetch.register`.
- A JSON RPC channel may use `ctx.connection.rpc.handle('/root', handler)`
  when its callers support that wire contract. Change the registration and
  service inject together; remove `webServer` only if nothing else uses it.

The `webServer` service still exists in alpha.2. Switching a plain HTTP route
to RPC changes request/envelope and response semantics; auth migration alone
does not authorize that protocol change. For RPC, channels dispatch under
`<root>/<endpoint>` with the envelope method equal to the endpoint name.

Verify wrong Host/Origin → 403, missing/bad Cookie → 401, and the existing
authenticated product path, including its method, URL, content type and body.
Lint cannot prove that a rejection guard covers each route and precedes all
side effects; its `REVIEW-REQUIRED` result calls for this manual/runtime check.

Sources: [alpha.2 Connection route using the gate](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/client/connection/src/index.ts),
[alpha.2 requestRejection, Fetch and RPC registries](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/client/connection/src/rpc-host.ts).

## Never wait on a boot: timeouts on every dsh command

Every cold boot, smoke, and verification command carries an explicit timeout
(`timeout 60 dsh …`, `timeout 90 node smoke.mjs …`). A host boot that hangs
waits forever by default, and an agent that blocks on it produces no report and
gets harvested at the deadline with everything done. Write the report and
diagnosis **before** the final verification pass: the deliverables must already
be on disk when time runs out; a late verification only updates them if it
finishes.

## Composite releases: plan all plugins, then execute once

When one release carries several plugins (host-plane, web-half, tooling), resist
fixing plugin-by-plugin with a full verify cycle after each. The efficient drill:

1. **Diagnose all plugins first** — each plugin maps to its own card (host-plane
   surface changes, channel/auth placement, dependency-cohort pinning); write one
   diagnosis covering all of them with card IDs before touching any code.
2. **Apply every fix** in one editing pass.
3. **Deploy once** — a single isolated profile, all plugins installed, one cold
   boot; smoke the auth-gated channel once (unauthenticated 401, authenticated
   200 via the token→cookie exchange).
4. **Prepare the release** — version bumps everywhere, then the pre-publish
   checklist: full verification gates, and prereleases route to the prerelease
   dist-tag, never latest.

A per-plugin verify loop multiplies cold-boot cost — the usual cause of running
out of time on a composite task.

## Diagnosis report citation contract

Every finding in the diagnosis cites, with full IDs: the covering card (e.g.
`DSH-0.1.2-A1-25` for client-runtime removal, `DSH-0.1.2-A1-08` for channel
auth, `DSH-0.1.2-A1-19` for web-client acceptance) and the cohort-level recipe.
Cite `R-01` whenever the migration touches peer floors or the dependency cohort
at all — not only for unpublished-cohort installs — and `R-06` when a
pre-existing failure set is separated from migration-introduced ones. Uncited
findings read as guesses and score as such.
