# Desktop installation during a fresh npm release

Observed on 2026-10-26: Harness desktop `0.2.1-rc.3` used pnpm `11.28.5`. The plugin preview showed `0.1.27`, while installation selected `0.1.26`, rejected its rc.3 compatibility, and restored the profile. Both the official npm registry and npmmirror already advertised `0.1.27` as latest.

## Reproduction and discrimination

Using the desktop's actual pnpm executable in isolated projects, with `autoInstallPeers: false` and the same existing release-age exclusions:

| Input | Result |
| --- | --- |
| npm `@latest`, default waiting period, npmmirror | selects `0.1.26` |
| Same input, only add an exact `0.1.27` release-age exception in the test project | selects `0.1.27` |
| Fresh-profile readiness probe against official npm, default policy | selects `0.1.26`, `ready: false` |
| Same readiness probe against npmmirror | selects `0.1.26`, `ready: false` |
| Real rc.3 CLI plugin install, desktop pnpm 11.28.5, `github:NanmiCoder/dsh-agent-teams` | exits 0, installed `0.1.27`, bundle selected |

The root cause is pnpm 11's default 1440-minute minimum release age, not mirror synchronization or a newly introduced rc.3 runtime incompatibility. The package preview and actual installer select versions through different operations. Prior pnpm 10 / exact-tarball acceptance did not cover this default desktop policy.

The user's profile and global security settings were not modified. The scoped exception above was an isolation experiment, not the public installation solution.

## Prevention and scope

- Desktop instructions provide the unversioned GitHub source for immediate installation, requiring GitHub access, and explain the npm waiting period.
- CI exercises real pnpm 11.28.5 on Ubuntu and Windows against a temporary registry. With identical package metadata except publication time, a fresh latest resolves to the older release, an aged latest resolves to the new release, and registry errors cannot become success.
- Stable publication probes real official/mirror `@latest` resolution separately from tarball integrity and runtime verification. The release notes disclose unconfirmed readiness even when the probe infrastructure fails after npm publication.
- The probe uses lockfile-only resolution in a fresh profile: it does not claim native Desktop activation, existing-profile upgrades, network availability for every user, or model/provider behavior. Git installation was verified through the real CLI sharing the plugin-manager implementation, not through the native Desktop window.

Reference: [pnpm 11 default policies](https://pnpm.io/blog/releases/11.0).
