---
name: plugin-test
description: Use when writing or reviewing tests for DeepSeek Harness plugins, external DSH plugin packages, or package changes in the deepseek-harness repository. Select the minimum sufficient levels from unit tests, coverage, real-API end-to-end tests, snapshots, Web tests, real compositions, and built-artifact smoke tests. For Harness version migrations, use this Skill's built-in seven-touchpoint test workflow and validate the exact target-version runtime.
---

# Test DeepSeek Harness Plugins

Select the smallest set of test levels that proves the change is correct. Do not run the full suite by default or repeat checks that have already passed.

## Test Harness Version Migrations

When adapting an existing plugin to a new DSH host version:

1. Read [`references/version-migration-testing.md`](references/version-migration-testing.md), build a migration ledger for the exact from/to versions, and scan all seven touchpoint classes.
2. Add a targeted regression test for every applicable `breaking` or `behavior` change. A change-level test proves only that migration mapping; it does not prove the whole plugin is valid.
3. Cold-start the exact target version through the real product entry point and complete a full user turn. Typechecking, config parsing, Loader smoke tests, and mock Contexts cannot replace this runtime proof.
4. Report unavailable credentials, providers, operating systems, browsers, PTYs, and destructive-migration boundaries honestly. Do not claim comprehensive compatibility when any remain unverified.

The commands and repository paths below use test-level names from the official Harness monorepo. For external plugins, use equivalent scripts and paths from their own repositories. Do not add nonexistent Harness root commands or impose the monorepo layout on them.

## Run a Docker Release Smoke Test

For a pre-release external plugin check, read [`references/docker-release-smoke.md`](references/docker-release-smoke.md) and use the included runner on the packaged artifact. Pin one exact DSH version and a non-`latest` Node image, install the artifact into an isolated Profile, cold-start the real DSH entry, and add one argv-based functional probe when startup alone does not exercise the changed behavior.

Treat the generated JSON and Markdown as narrow evidence for that artifact and target. Report skipped providers, browsers, operating systems, security checks, and additional versions as unverified; a passing Docker smoke test does not expand its own coverage. Keep generated reports, raw logs, temporary Profiles, and Docker cache outside the Skill directory.

## Test Levels

| Level | Command | What it proves |
|---|---|---|
| Unit tests | `pnpm run test` | Runs vitest cases under each package's `tests/**` and script tests under repository `scripts/**/*.spec.ts`. Cover edge cases, error paths, event ordering, concurrency races, and contract regressions. Every registry needs an HMR-safety test: dispose the fiber that contributed the registration and assert that the resource is removed. |
| Coverage gate | `pnpm run test:coverage` | In the Harness monorepo, every file under `packages/*/*/src` must reach 100% coverage. In an external plugin, follow the coverage threshold declared by its repository. Coverage proves only that lines executed, not that the published feature actually works. |
| Real-API end-to-end tests | `pnpm run test:e2e` | Validates behavior against real provider APIs, including DeepSeek models and provider smoke tests gated by their own credentials such as `EXA_API_KEY` and `PERPLEXITY_API_KEY`. Each suite skips itself when its credential is absent so credential-free CI remains green. |
| Snapshot tests | `pnpm run test:snapshot` | Validates expected credential-free output, pinning transport contracts and presentation while using persisted logs to fix the assembled backend behavior. |
| Web browser snapshots | `pnpm run test:web` | Compares Chromium replay output with `apps/web/tests/snapshots/`. This is a required Linux PR gate. CI forces read-only `DSH_SNAPSHOT=replay` and never writes expected output. Record or refresh snapshots only locally and review every difference. |

When provider credentials are available and real-API execution is authorized, run the corresponding end-to-end tests. Do not skip them merely to save inference spend. Credential-free tests prove only that the pipeline is connected; only credentialed runs prove that the Agent can work with a real model. Based on the change, cover file-writing prompts, multi-turn sessions, tool use, and cancellation during streaming output. The highest-value smoke test starts a real example, sends one prompt, and verifies the outcome from outside the Agent. Automatic skipping keeps credential-free CI unblocked. Record every skipped provider boundary, and never request, expose, or persist credentials merely to make tests pass.

## Select Levels from the Change Surface

- Pure logic or internal helpers → run unit tests only.
- New or modified package source → run the repository's coverage gate. Apply the per-file 100% rule only when the Harness monorepo explicitly defines it.
- Model-visible behavior such as prompts, tool Schemas, tool output, or Skill directories → add a credential-free snapshot to the owning example suite, then add a real-composition test.
- Protocol-visible behavior such as ACP, JSON-RPC, or wire transport → add a credential-free snapshot to the owning example suite.
- User-visible behavior such as CLI transcripts, interactive terminals, or GUI flows → in the Harness monorepo, use `apps/cli/tests/snapshots/` or `apps/web/tests/snapshots/`; in an external plugin, use the product-entry test suite owned by that repository.
- Provider behavior such as a new adapter or real provider feature → run real-API end-to-end tests when credentials are available and execution is authorized.
- A plugin that users will actually run → execute a non-unit real-composition test as described below. Never test only a manually assembled `ctx.plugin(...)`.

## When Snapshot Tests Are Mandatory

Every nontrivial model-visible, protocol-visible, or user-visible change must add or update a credential-free scenario through a runnable composition owned by the repository. Package tests, end-to-end assertions, test-only mock compositions, and PR descriptions cannot replace the complete assembled record. In the Harness monorepo, ACP snapshots live under `examples/<name>/tests/snapshots/`, headless JSONL snapshots live under `examples/headless-agent`, terminal flows live under `apps/cli/tests/snapshots/`, and browser flows live under `apps/web/tests/snapshots/`. Use the record or refresh command provided by the exact target checkout and review every generated difference. External plugins should use their own snapshot framework. If they have none, add a minimal composition that runs through the real Loader.

## Test the Real Entry Path

- User-visible plugins need a real-composition test. Start a test-only `cordis.yml` through the Loader and application or process entry point. Mock only external services or nondeterministic inputs. Assert the model-visible request or log, persisted state, or user-visible output. Do not add test options to published defaults.
- A guard test is useful only if the regression truly makes it fail. When the exact target contract requires a bundled or composition module without `inject` to use named exports, add explicit `expect('default' in mod).toBe(false)` and `unwrapExports` round-trip assertions. Prove that the test turns red when the regression is introduced and green after the fix. Do not apply this guard to default plugin objects or `Service` classes supported by the target version. Validate those forms through their actual Loader contract.
- The "real entry path" means the published artifact. A package `bin` must run its built entry under native Node to expose issues that tsx may hide, including shutdown races, module resolution, and swallowed load failures. Apply the same rule to runtime entries outside the default index and singleton modules shared across bundle compositions. In the Harness monorepo, keep its built-artifact smoke tests green, such as `packages/examples/*/tests/built-bin.e2e.ts` and `packages/code-runtime/code-runtime-worker/tests/built-lib.e2e.ts` when they exist in the target version. In an external plugin, smoke-test its packaged entry. Assert that the process exits nonzero when required configuration is truly missing.
- In the Harness monorepo, normal tests resolve through the configured source plane, while only explicit built-entry smoke tests consume build artifacts. In an external plugin, follow its resolver but still add one explicit packaged-artifact consumer so source aliases cannot hide a missing export or a second runtime singleton.
- For subprocess startup in the Harness monorepo, CI and built-test channels must use the shared launcher from the target checkout to run every example or Cordis config subprocess from built `lib/`. Never hand-write `--import tsx` for those subprocesses. Protocol and operating-system fixtures that do not load Cordis follow the current Node/TypeScript convention of the target repository. External plugins follow their own launcher but must cover the packaged artifact. Choose `src` only when source-path resolution itself is the test subject, and document that contract in the test.

## Keep Tests Effective

- Prefer real implementations over mocks. Mock only expensive or nondeterministic boundaries such as LLM adapters, networks, and clocks, while keeping everything downstream real. A handwritten fake proves only that a bridge moved bytes; it does not prove that the published tool delivers its claimed behavior. Tests for bridged tool calls should use a scripted mock model while keeping the tool and executor real.
- Verify the external world instead of trusting the Agent's report. End-to-end assertions should rerun commands or reread files outside the Agent. Checking only keywords in Agent output lets a cheating Agent pass. Assert that untouched files remain byte-for-byte identical.
- End-to-end tests must own their resources. Create the Harness inside the test and dispose it in `afterEach`, including after failure, retry, or timeout. Put shared fixtures in a normal `tests/harness.ts`, never another `*.e2e.ts`; importing a test file registers its `describe` again and duplicates real-API calls.
- Recovery tests must separate failures before and after each chunk boundary and prove that a failed chunk derives no messages or tool side effects. Cover exhaustion, cancellation, policy composition, persistence, state, wire counts, transport-close idle timeouts, and the production Loader composition.

## Commands

In the Harness monorepo, use commands that actually exist in the target checkout, such as `pnpm run test`, `test:coverage`, `test:e2e`, `test:snapshot`, and `test:web`. Confirm each script exists instead of assuming a historical command list is still valid. In an external plugin, use its own scripts, package the artifact, install it into an isolated Profile running the exact target version, and execute a cold-start plus core-path smoke test through the product entry. Run the smallest set that covers the changed surface only once. CI proves only the gates it actually defines.

See [`references/README.md`](references/README.md) for the reference index.
