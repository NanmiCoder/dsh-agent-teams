# AgentTeams subagent compatibility implementation review

Reviewed 2026-09-06 in `/Users/nanmi/workspace/myself_code/dsh-agent-teams-compat`.
Implementation: `src/harness-compat.ts`, `src/members.ts`.
Tests: `scripts/harness-compat-tdd.mjs`, lifecycle and member-failure default/`--modern-harness` modes.

## Exact primary sources

Full source hashes and peeled commits: [host-contract-evidence.json](./host-contract-evidence.json).

| Contract | Exact official source | Decision |
| --- | --- | --- |
| Legacy FIFO | `dsh-v0.1.2-alpha.2`, `packages/subagent/subagent/src/index.ts:256` | Call followup with original service receiver. |
| Legacy setup ownership | Same file, line 311 | registerContinuableSetup calls this.ctx.effect and setupRegistry.register. Cordis tracks the accessing plugin, so the returned disposer need not be re-registered. |
| Modern host FIFO | `dsh-v0.1.2-rc.1`, `packages/subagent/subagent/src/internal.ts:41,64`; `index.ts:268`; `continuation.ts:568,575` | Use the identical Symbol.for('dsh.subagent.queuePrompt') protocol/signature. Do not statically import /internal, which does not exist in Alpha.2. |
| Modern model messaging | `dsh-v0.1.2-rc.1`, `packages/subagent/subagent/src/continuation.ts:527-556` | sendMessage passes delivery:'steer', so it cannot replace FIFO jobs. Guard it against retired targets, but do not use it for AgentTeams host-authored delivery. |
| Synchronous setup | `dsh-v0.1.2-rc.1`, `packages/core/agent-loop/src/index.ts:615-632` | agent/session-start fires synchronously at publication, before the first queued prompt. Install selection/failure/fallback synchronously. |
| Non-vetoing lifecycle | `dsh-v0.1.2-rc.1`, `packages/core/agent/src/dispatch.ts:58,129` | Lifecycle notifications contain exceptions. Setup failures need an explicit request-rejection contribution to prevent accidental default-model execution. |
| Owned history | `dsh-v0.1.2-rc.1`, `packages/core/session/src/index.ts:615-616` | ownEvents excludes fork inherited events. Legacy Alpha.2 uses events.slice(header.seedLength). |
| Complete selection | Both tags, `packages/core/agent/src/model-selection.ts` | Keep installModelSelection; explicitly pass reasoningEffort in spawn options too. After a persisted fallback, do not restore the primary model's effort onto the backup route. |

Alpha.5 and rc.1 have identical SHA-256 content for all seven inspected contract source files. Their source hashes are recorded, rather than inferred from the release label alone.

## Native ownership and dispatch checks

Using the actual Alpha.2 Cordis and SubagentRuntime, create a separate plugin with inject:['subagents'], call installContinuableMemberSetup, then use the real setupRegistry.apply(...).commit():

- registered: installed=1, disposed=0;
- dispose caller plugin while service remains alive: installed=1, disposed=1;
- later activation: installed=1, disposed=1;
- runtime disposal: installed=1, disposed=1.

This confirms legacy registration follows caller lifetime and removal revokes resident contributions. The regression is included in the native test's Alpha.2 branch.

Native SubagentRuntime dispatch also exercises this.requireContinuations with only the downstream continuation manager replaced. A detached followup or queue cannot pass. Cordis wraps method property reads in fresh proxies; the guard now compares own property descriptors when restoring its contributions on disposal.

Modern scoped fixtures prove root/plugin cleanup and child cleanup independently, synchronous first-request selection, repeated-event deduplication, setup exceptions blocking requests, non-member and inherited descriptors leaving no request/failure hooks, and fallback cold recovery.

## Validation and dependency finding

- Alpha.2 baseline: typecheck/build, original and modern-shape lifecycle, original and modern-shape member-failure passed.
- rc.1 exact direct dev dependencies: typecheck/build passed, but runtime initially failed because dsh-subagent@rc.1 resolved dsh-attachment@alpha.2, which lacks admitPromptContent. Lockfile still contained 23 Alpha.2 packages. This is concrete evidence that typechecking plus top-level pins is insufficient.
- After root corrected the complete dependency cohort: rc.1 typecheck/build passed again; native/compatibility suite 11/11, modern member-failure 10/10, modern lifecycle passed.
- Real packaged CLI/composition runs are owned by the separate three-version runtime lab; the seam tests above do not claim to replace that evidence.

## Contribution attribution

- #119: concentrated SubagentSeam, explicit legacy/modern branches, cleanup intent.
- #124: synchronous agent/session-start, ownEvents and the host FIFO contract form the modern path.
- #130: runtime message capability detection and consideration of retirement guard migration.

Not adopted: bare legacy register (#119), sendMessage-as-FIFO (#119/#130), omission of failure/fallback setup (#130), static /internal import and missing-method no-op guard (#124). All version-specific handling is isolated in harness-compat.ts.
