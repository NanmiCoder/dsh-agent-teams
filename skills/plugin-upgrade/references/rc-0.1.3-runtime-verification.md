# Plugin runtime verification across the 0.1.2-rc.1 / 0.1.3-alpha.2 corridor (2026-09-08)

Runtime companion to the corridor cards: five real top-tier plugins,
`verify-runtime`-style isolated-profile cold boots, three hosts
(0.1.2-alpha.2 historical / 0.1.2-rc.1 `latest` / 0.1.3-alpha.2 `alpha`).
Judged on host-side activation signals only (`MISSING_CREDENTIAL` after tree
load = alive; exit codes not a criterion). Zero model calls.

| Plugin | 0.1.2-alpha.2 | 0.1.2-rc.1 | 0.1.3-alpha.2 |
|---|---|---|---|
| titanwings/distilly (24k★) | pass | **pass** | **pass** |
| liustack/modlens | pass | **pass** | **pass** |
| Q00/ouroboros (5.7k★) | pass | **pass** | **pass** |
| anywhere-labs/dsh-desktop (22k★) | fail/not-listed | **fail/not-listed** | **fail/not-listed** |
| zhu1090093659/dsh-web-ui (6.5k★) | fail/not-listed | **fail/not-listed** | **fail/install-failed** |

## Findings

1. **The plugin survival surface is stable across all three hosts.** Every
   plugin that activated on 0.1.2-alpha.2 also activates on rc.1 and
   0.1.3-alpha.2; every failure persists. This runtime-measures the corridor
   cards' claim that 0.1.3's breaking changes are session-layer, not
   plugin-facing — for these five plugins the claim holds.
2. **One regression signal: dsh-web-ui degrades on 0.1.3-alpha.2**
   (`not-listed` → `install-failed`). The install layer — not registration —
   is the new failure point, consistent with a dependency-surface change in
   the 0.1.3 cohort (e.g. new peer floors). Worth a targeted look before
   0.1.3 stabilizes.
3. **dsh-desktop's not-listed failure persists across three generations**
   (22k★; `dsh plugin add` succeeds, the entry never registers). The
   registration-layer gap H26 (benchmark) is distilled from remains unfixed
   on `latest`.

## Environment

Host network for image builds (the runner's container DNS is flaky);
`@deepseek-ai/dsh` installed per image from npmjs (`latest`=0.1.2-rc.1,
`alpha`=0.1.3-alpha.2; note: a registry mirror lagged behind on
`dsh-spill-policy@0.1.3-alpha.2`, so the official registry is required for
0.1.3 images). Git-URL plugin installs; per-plugin throwaway containers;
`pnpm@11.24.0`; `node:24-bookworm`. Raw per-plugin JSON/logs preserved on the
runner (`e-corridor/results-<version>/`).
