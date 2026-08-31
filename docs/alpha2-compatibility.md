# DeepSeek Harness Alpha.2 compatibility

Validated on 2026-08-31 against `@deepseek-ai/dsh@0.1.2-alpha.2`, macOS arm64,
Node.js 26.7.0 and pnpm 10.33.0. The starting plugin was 0.1.14 at
`5fe388f1a30da7b1374294b25bd6f8ad74ab6aa5`, built against 0.1.0-rc.8.
The migration ships as **0.1.15**, on npm's default **latest** channel.
It does not upgrade a user's running host. Validation used isolated dependency
installs and packaged builds, with `/tmp` as the business workspace. Existing
daily profiles and their linked build outputs were preserved. Reinstall
dependencies and rebuild a source-linked plugin when moving its profile to
Alpha.2. Do not load the Alpha.2 client into an old RC host.

## Cause and migration

Alpha.2 removes `dsh-client-runtime` and changes the service that owns
conversation event registration. The old client required `conversationEvents`,
which the new host does not provide. Updating dependency versions alone leaves
the browser plugin waiting for an unavailable service.

| Touchpoint | Change / verification |
| --- | --- |
| Imports and types | Context now comes from Cordis; snapshots from client-store; session state from api-session-controller; subagent addresses from subagent/client; JsonValue from util-values. Both TypeScript projects pass against Alpha.2. |
| Plugin assembly | Remove client-runtime from the client injection metadata; declare the current session and Chat packages; require `uiConversation`. The published-format tarball loads in clean Web and headless profiles. |
| Conversation / UI | Register with `ctx.uiConversation.events`; Chat node types and the keyed data map belong to ui-chat/client. Replayed real tool events render the team card, activity panel and dependency graph. |
| Lifecycle | Browser routes remain optional in headless mode. Route disposal and re-registration are exercised with a real Cordis fiber. |
| Session / subagents | Keep the existing first-party tool-event card fold; do not introduce unknown durable events. Use the target's `SUBAGENT_DESCRIPTOR_VERSION` in replay fixtures. Real members spawn, resume, complete dependent tasks and report. |
| Authentication | Raw webServer routes do not inherit the host's authentication fence. Wrap state, plan, halt and artwork handlers with Connection.requestRejection; return 503 if Connection is absent, 401 for unauthenticated requests and 403 for rejected hosts/origins. |
| Build / package | Pin DSH development packages and the CLI to the same exact Alpha.2 version. The fresh lockfile avoids mixed RC/Alpha dependency graphs. Build the browser factory without the removed runtime external, then install the tarball through `dsh plugin`. |

The source migration targets Alpha.2. Older RC hosts, future Alpha releases,
Windows/Linux and alternative LLM providers are not claimed as validated.
The repository's development skills and their `.dsh` mirror are unchanged.

## Existing users and release boundary

This migration does not automatically upgrade Harness and does not contain a
dual-version adapter. Users on older hosts should retain the published
`0.1.14` plugin instead of installing this Alpha.2 build. Source-based users
must also update, rebuild and restart the Harness instance they actually run.

The optional peer dependencies describe expected APIs, not an enforced
host-version check. An incompatible host may accept the package installation
and then fail to activate the client or serve its routes. Successful package
installation alone is not evidence of compatibility.

The default plugin release follows the current supported Harness developer
preview: **latest=0.1.15**, for Harness **0.1.2-alpha.2**. Older hosts must pin
a compatible historical plugin version, such as 0.1.14 for 0.1.0-rc.8.
The host's prerelease suffix does not determine the plugin's release channel.
Both `publishConfig.tag` and GitHub Actions select `latest` for 0.1.15;
the metadata check rejects mismatched plugin-version/channel pairs. GitHub
publishes 0.1.15 as a regular release and makes it the latest release.
This replaces the initial opt-in-only policy used for 0.1.15-alpha.1;
that historical package remains available without being the recommended install.
Supporting both host generations in one build would require an explicit
adapter and validation against both runtime versions. The
[README](../README.md#install) includes host upgrade, old-version pinning,
source-checkout and rollback instructions.

## Verification

The original source passed its old dependency suite. After migration:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm build
pnpm verify
pnpm pack --pack-destination /tmp
```

`pnpm verify` includes `verify:web-routes`. That regression test uses the real
Alpha.2 Connection implementation and real HTTP requests, replacing only the
credential persistence store with an in-memory store. It checks token-to-cookie
authentication, successful reads/mutations, hostile Host/Origin and cross-site
rejection, fail-closed startup, and disposal/reload. Temporarily removing the
authentication wrapper makes the test fail (HTTP 200 instead of 401).

### Real API and browser checks

The packaged plugin was installed into isolated profiles using the exact
Alpha.2 CLI. Both product entry points ran with working directory `/tmp`;
no new workspace was selected. Existing credentials were consumed by the host
credential provider without printing their values. No scripted model was used
for these results. The provider was `deepseek-official`, model
`deepseek-v4-flash`, thinking disabled, with a 4096-token response limit.

- Headless product entry: team `alpha2-real-api-0831-check`, with calculator
  and reviewer members. Calculator completed `17 * 23 = 391`; the dependent
  reviewer independently checked `17 * 20 + 17 * 3 = 340 + 51 = 391`.
  Both tasks were verified as completed by reading the team's on-disk state
  outside the model. The process exited successfully.
- The model initially supplied a nonexistent dependency ID. The tool rejected
  it, and the model corrected it to the actual task ID. This was a recovered
  model error, not a silent success or an ignored validation failure.
- Cold Web startup replayed the headless session. Ego Browser verified the
  team card, `2/2` completed activity view, dependency graph and navigation to
  the reviewer's persisted conversation.
- Anonymous browser requests to the state, plan and halt endpoints returned
  401. Authenticated state requests succeeded.
- A separate real Web turn used `/agent-teams` in the existing `/tmp`
  workspace to create `alpha2-web-plan-0831`. Before approval, its sole checker
  member had no spawned child ID and its task remained pending. The official
  model catalog supplied the member's provider, model and reasoning selection.
- Edited that plan's task title in the Web form and verified the saved title
  on disk while the member remained unspawned. Clicking **Confirm & Start**
  changed the plan to running, created the checker child, and completed the
  task through the real API with output `19 + 24 = 43`. The completed state
  and edited title were independently checked on disk.

These checks cover the compatibility seams above, not every possible task,
provider, failure mode or production deployment. Existing user profiles and
project analysis documents were not modified by the verification.

A second release acceptance run used three real members to produce and
independently review an order-settlement JSON and HTML report. It exercised
human plan revision, invalid dependency rejection, member continuation,
interruption, discard, live locales/themes and 390px browser layouts.
See the [business and UI acceptance record](./alpha2-release-acceptance.md),
including recovered model mistakes and the limits of the environment.

## Upstream reference

- [Alpha.2 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2)
- [Upgrade workflow](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill)

The installed Alpha.2 packages, their declarations and their shipped runtime
code were used to verify the exact contracts rather than relying on `latest`
tags across independently published packages.
