# Example: 0.1.2-alpha.1 → 0.1.2-alpha.2 audit report

A real audit report produced by this skill (source mode) in a deepseek-harness checkout, for the range `dsh-v0.1.2-alpha.1..dsh-v0.1.2-alpha.2` (234 commits, 157 of them non-merge; 1,604 files changed, +27,862 / −14,050).

It shows the full output contract:

- `UPGRADE-ADAPTATION.md` — header range stats and merge-base purity note, Verdict, §1 reverts section (with directional judgments), breaking sections sorted by consumer impact (each entry with an **Adapt:** line), Confirmed unchanged, the boundary signature table, a numbered Adaptation checklist
- `CHANGELOG.md` — commits categorized by type, **must include a Reverts section**

Mechanical artifacts (`commits.txt`, `files.txt`, `diffstat.txt`, the full `.diff`) are not committed; regenerate them in a deepseek-harness checkout when needed:

```sh
node <skill-dir>/scripts/gen-artifacts.mjs dsh-v0.1.2-alpha.1 dsh-v0.1.2-alpha.2 tmp/0.1.2alpha1-to-0.1.2alpha2
```
