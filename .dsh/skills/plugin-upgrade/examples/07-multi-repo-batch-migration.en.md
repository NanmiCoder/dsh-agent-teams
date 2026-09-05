# Example 07: Batch Migration Runbook for 17 Tool Plugins Across Three Version Steps

English | [简体中文](07-multi-repo-batch-migration.md)

**Scenario**: Seventeen tool/diagnostic plugin repositories in the omdsh-dev organization (calculator/json/time/encoding/diff/stat/schema/markdown/csv/regex, security-audit, session-health, plugin-check, plugin-dev, tariff, sandbox-micro, toolkit) batch-adapted to host upgrades across three consecutive version steps: `0.1.0-rc.8 → 0.1.1-rc.2 → 0.1.2-alpha.1 → 0.1.2-alpha.2`. This complements [Example 06](06-real-world-batch-migration.md) (the technical migration record of six Web Client plugins): this example focuses on **process management across N repositories** — sync audits, batch gates, commit and push, profile wrap-up — and defers every technical touchpoint to the corridor cards and [migration-hygiene](../references/migration-hygiene.md) instead of repeating them here.

**Plane**: primarily Host tool plugins; includes one custom RPC channel plugin (tariff) and profile dependency management.

**Complexity**: ⭐⭐⭐ (process management) + ⭐ (code touchpoints, see cards)

## Process Overview

| Stage | Action | Basis |
|---|---|---|
| 1 Inventory | Record HEAD/remote/baseline per repo; fetch + `--ff-only` audit | Common error 1 below |
| 2 Baseline | devDependencies on the npm release line, wide peer ranges, dual-compatible code | [publish-playbook](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/skills/plugin-release/references/publish-playbook.md) dual-compatibility section |
| 3 Batch edits | Minimal diff per repo: version bump / doc baseline / touchpoint code | Corridor cards + batch check loop |
| 4 Commit and push | Uniform message template; push per repo; on failure rebase then `--force-with-lease` | Common errors 2/3 |
| 5 Profile wrap-up | `pnpm update` re-resolves the GitHub install track; keep the three rename sites in sync | [profile-dependency-management](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/skills/plugin-release/references/profile-dependency-management.md) |
| 6 Real verification | Cold boot of the target tag + all manifest entries active + one real behavior | Tiered verification checklist |

## 1. Inventory: Sync-State Audit

```sh
for d in plugins/*; do
  (cd "$d" && git fetch origin && \
   git rev-parse HEAD > /tmp/before && \
   git pull --ff-only origin main && \
   git rev-parse HEAD > /tmp/after && \
   printf '%s %s\n' "$d" "$(diff -q /tmp/before /tmp/after >/dev/null && echo same || echo UPDATED)")
done
```

**Common error 1 — `same` does not mean the author has updated**: a `same` pull result only says your local checkout is up to date; it says nothing about whether the remote repository does or does not carry this round's adaptation commit. In practice, `dsh-tool-diff` printed `same` during one migration round while its adaptation commit had actually been pushed **later** than the other repositories'; if you take "fully updated" at face value and start, that repository gets skipped. The audit verdict must be based on whether each repository's last commit belongs to this round of adaptation — not on pull output.

## 2. Baseline: npm Release-Line Types + Local Harness Verification

The alpha line is not on npm, so public repositories keep their devDependencies on the npm release line (`^0.1.1-rc.2` at the time) and use wide peer ranges (`<0.2.0`) to cover the unpublished cohort; code against signature-drifted APIs uses the dual-compatibility pattern (see the `rpc.handle` case in [publish-playbook](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/skills/plugin-release/references/publish-playbook.md)), so typecheck works after `npm install` on any machine and the alpha runtime behavior stays unchanged.

## 3. Batch Edits and Batch Gates

- Version/doc-baseline edits go through scripted batch replacement plus a per-repo diff review (never blindly global-replace semantic words like `code` — see [card A1-06](../references/v0.1.2-alpha.1.md));
- Run the full gate loop (typecheck + test + build) per repo. **Windows note**: call npm as `npm.cmd` in batch scripts; PowerShell 5.1 resolves `npm` to `npm.ps1` and scrambles the arguments (`Unknown command: "pm"`);
- Don't use `& $array @anotherArray`-style invocation in batch scripts (PowerShell 5.1 flattens the arrays into a single command name); write the command out directly per branch.

## 4. Commit and Push

- Message templates match the repository history: `chore(dsh): align devDependencies with dsh <v> and rebuild lib` / `fix(dsh): <touchpoint description> for harness <v>` / `docs(dsh): note harness <v> validation`;
- Push `git push origin main` per repo; on failure:

```sh
git pull --rebase origin main          # GIT_EDITOR=true prevents the editor from hanging
git push --force-with-lease origin main
```

- **Common error 2 — resolving rebase conflicts**: when this round's adaptation conflicts with a late-arriving remote commit on the same file, resolve the conflict in favor of "this round's baseline is the final state" (in practice: the alpha.2 doc baseline overrode the late alpha.1 commit). Re-verify per repo before pushing.
- **Common error 3 — two-dot diff (`git diff a b`) misreads other people's changes**: judging what a PR/commit "deleted or reverted" requires a three-dot comparison (`git diff main...branch`); a two-dot diff (`git diff a b`) renders "the branch has not caught up with main's additions" as deletions. Two false reports occurred in practice — an undeleted skill read as deleted, and un-reverted card wording read as reverted — both from misreading the direction of a two-dot diff (`git diff a b`).

## 5. Profile Wrap-Up

Per [profile-dependency-management](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/skills/plugin-release/references/profile-dependency-management.md): run `pnpm update` to re-resolve dependencies on the GitHub install track and cross-check the lockfile commits; when a package is renamed, keep the three sites in sync and remove leftover directory junctions.

## 6. Real Verification (Run at Every Version Step)

1. Cold-boot the target tag; every entry of this plugin in `pluginInventory/list` is `active`, none `pending`;
2. Custom-channel smoke: 401 without authentication / 200 after the token is consumed ([DSH-0.1.2-A1-08 · Web/API channel authentication](../references/v0.1.2-alpha.1.md));
3. One real behavior: run a headless task that makes the model call this plugin's tool (e.g. calculator computing something), and check the final stdout text and the stderr reasoning attribution ([DSH-0.1.2-A1-05 · headless output semantics](../references/v0.1.2-alpha.1.md));
4. Archive results: keep a "version → per-repo commits → verification results" record for every version step, as the inventory baseline for the next version step.

## Relationship to Other Materials in This Repository

- Technical touchpoints and cards: see [v0.1.1-rc.2](../references/v0.1.1-rc.2.md), [alpha.1](../references/v0.1.2-alpha.1.md), [alpha.2](../references/v0.1.2-alpha.2.md), and [rollup](../references/rollup-0.1.2.md);
- Toolchain pitfalls: [migration-hygiene](../references/migration-hygiene.md) (not repeated here);
- Release/distribution surface: [publish-playbook](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/skills/plugin-release/references/publish-playbook.md) and [profile-dependency-management](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/skills/plugin-release/references/profile-dependency-management.md).
