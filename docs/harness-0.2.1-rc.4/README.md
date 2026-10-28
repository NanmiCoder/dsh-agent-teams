# Harness 0.2.1-rc.4 compatibility

The published `0.1.27` artifact enumerates exact peer versions up to rc.3, so the rc.4 host rejects installation before activation ([#316](https://github.com/NanmiCoder/dsh-agent-teams/issues/316)). This change adds rc.4 as an exact `preview` target. The recommended host and the development cohort stay on rc.2; promoting rc.4 is a release decision.

## Source audit

- rc.3: `1f81c047fc48fa190a683e469daa699857e9afe8` (`dsh-v0.2.1-rc.3`).
- rc.4: `504a01a9578abc2c6f1fb896b1dc322c9fe24f66` (`dsh-v0.2.1-rc.4`).
- Nine commits including the release: MCP resource-listing and DeepSeek-account catalog diagnostics moved off ACP stdout (`dsh-mcp-client`, `dsh-llm-deepseek-account`, plus an ACP e2e test), and View-tab tooltip fixes in `dsh-client-ui-conversation`.
- Tooltips now appear only for overflowing labels. The More-views button label no longer names the current view, so the internal locale key `session.moreViewsCurrent` was removed. AgentTeams imports neither MCP package nor that locale key; its use of `dsh-client-ui-conversation/client` (card definition and type-only imports) is unaffected.

The rc.3 and rc.4 npm tarballs were downloaded and compared for all 25 DSH packages AgentTeams declares (peers + dev cohort), plus `dsh-plugin-manager`, `dsh-app-boot`, `dsh-client-ui-sidebar-right`, `dsh-client-ui-workspace`, `dsh-llm-retry` and `dsh-workspace` (28 distinct packages total). Only `dsh-client-ui-conversation` differs beyond package.json version strings: its README and `lib/client.js` / `lib/types/client/locales.d.ts` reflect the tooltip change above. Every package.json differs only in its own and internal `0.2.1-rc.x` version strings.

## Verification

The unmodified `0.1.27` npm tarball (SHA-256 `2e4798ac5b34d2ea46bc4b7e835ba339413f585409707d4c3dce6ce9cd31cb76`) was rejected by the rc.4 CLI plugin manager in a fresh isolated profile (`installation rejected: ... incompatible with dsh 0.2.1-rc.4`), reproducing #316. Before this change `pnpm check:upstream` reported the host `next` channel (`0.2.1-rc.4`) as unverified; afterwards the only remaining gap is that the published plugin does not declare rc.4 yet.

Local macOS arm64 validation passed with pnpm 10.33.0 and Node 26 (CI uses Node 24): `pnpm install --frozen-lockfile`, `pnpm sync:compatibility`, typecheck, build and full `pnpm verify`. `harness-runtime-verify.mjs` passed all ten scenarios and the real plugin-manager install without an exemption on rc.4 (296-package cohort), rc.3 (296) and rc.2 (295) from the same tarball. Candidate SHA-256: `c959753defc4b4521d066ae49448eae421eff85e5f0df852cabd978c3d70f42e` (`0.1.27` sources with this change, built locally). Any later integration still requires its own final-head CI.

Real provider credentials, native desktop interaction and migration of existing user data are outside the isolated fixture coverage. Do not equate these checks with a manual desktop acceptance test.

## Recovery

Existing published artifacts and tags are immutable. Until a release includes rc.4, stay on rc.3 (preview) or rc.2 with `0.1.27`; do not bypass host compatibility checks.
