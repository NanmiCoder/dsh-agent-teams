# publish-playbook · Packaging, publishing, and distribution recipes

> Load-on-demand operational recipes that carry on the decision flow of [../SKILL.md](../SKILL.md).
> All conclusions come from two rounds of real publishing practice across the 17 plugin repositories
> in the omdsh-dev organization (rc.2 → alpha.1 → alpha.2); where a scenario is not covered,
> defer to primary sources and mark the item as pending confirmation.

## Unpublished cohort installation (recipe R-01)

0.1.2-alpha.* is published on GitHub only; npm lookups return 404. Isolated installation on the consumer side:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git /tmp/dsh-build
cd /tmp/dsh-build && git checkout dsh-v0.1.2-alpha.2
pnpm install && pnpm run build
mkdir -p ~/.dsh-cohorts/0.1.2-alpha.2
pnpm -r exec pnpm pack --pack-destination ~/.dsh-cohorts/0.1.2-alpha.2
```

In the manifest, write the range as `^0.1.2-alpha.2` and pin it to a `file:` tarball with `overrides`; once the official release is out, removing the overrides returns resolution to the registry.

> **To be confirmed (single field report, not reproduced)**: with third-party peers present, pnpm 11.9.0
> resolves the transitive dependencies of `file:` tarballs by bypassing overrides and looking for a
> nonexistent version on the registry; the report says pinning `packageManager: pnpm@11.24.0` resolves
> it correctly. Reproduce minimally in the target repository before adopting it, and backfill the
> conclusion once verified.

## Dual-compatibility pattern (core strategy for the alpha era)

Public repositories use the npm release line (currently 0.1.1-rc.2) as the type baseline for devDependencies, while the code must also run on the local harness at the GitHub tag. For APIs with signature drift, compromise as: "the npm release line's types are authoritative; the alpha runtime semantics stay unchanged". Real case: the third argument of `rpc.handle` was removed starting with 0.1.2-alpha.1 (authentication is now handled uniformly by the connection), but the rc.2 types still require it:

```ts
// The devDependencies baseline is the npm release line (rc.2), whose handle() type requires the
// third argument; harness handle() ignores that argument since 0.1.2-alpha.1. Keeping it lets the
// repository typecheck against rc.2 types while the alpha runtime behavior stays unchanged.
const dispose = connection.rpc.handle(
  '/tariff',
  handler,
  { authority: 'loopback' },
)
```

- Use this compromise only for APIs with **signature drift where the runtime ignores the extra argument**; APIs with semantic changes must be migrated via the version cards of
  [plugin-upgrade](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/skills/plugin-upgrade/SKILL.md), never silently compromised;
- Type-only imports (`import type`) are erased at compile time and carry no runtime cost across cohorts;
- Never write local junction/file: absolute paths into a committed manifest.

## CI and release gates (unpublished cohort)

- Materialize the cohort tarballs through the actions cache (keyed by the manifest hash), shared by all pnpm consumer jobs, so that machine-specific paths recorded in a frozen lockfile do not leave a clean runner without the store;
- `pnpm/action-setup` does not pin `version`, making `packageManager` the single version source;
- Add an `NPM_PUBLISH_ENABLED` switch to the release workflow: tag-triggered runs still execute the full gate and smoke, but skip `npm publish` until the cohort is officially released.

## Release semantic gate recipe (release workflow)

Before publishing, run the following checks in order; stop on any failure (the four invariants of Step 4 in the SKILL):

```sh
VERSION="$(node -p "require('./package.json').version")"
# 1) GitHub Release tag must equal v${VERSION}
[ "$RELEASE_TAG" = "v$VERSION" ] || { echo "tag mismatch"; exit 1; }
# 2) prerelease state must match ('-' comes before '+' build metadata)
V_PRERELEASE="$(node -e 'console.log(process.argv[1].split("+")[0].includes("-") ? "true" : "false")' "$VERSION")"
[ "$RELEASE_PRERELEASE" = "$V_PRERELEASE" ] || { echo "prerelease state mismatch"; exit 1; }
# 3) dist-tag routing: prereleases only go to a project-declared non-latest tag (NEXT_TAG is chosen by the project); only stable goes to latest
if [ "$RELEASE_PRERELEASE" = "true" ]; then NPM_TAG="$NEXT_TAG"; else NPM_TAG="latest"; fi
# 4) before a stable publish, refuse to move latest backwards to a lower version (semver comparison)
if [ "$NPM_TAG" = "latest" ]; then
  CURRENT="$(npm view "$PKG" dist-tags.latest 2>/dev/null || echo 0.0.0)"
  node -e "const semver=require('semver'); if (semver.lt(process.argv[1], process.argv[2])) { console.error('refusing to move latest backwards'); process.exit(1) }" "$VERSION" "$CURRENT"
fi
npm publish --access public --tag "$NPM_TAG"
```

The no-network semantic check can be run before the publish command with values already
retrieved by the release workflow:

```sh
node skills/plugin-release/scripts/verify-release.mjs \
  --version "$VERSION" \
  --release-tag "$RELEASE_TAG" \
  --release-prerelease "$RELEASE_PRERELEASE" \
  --npm-dist-tag "$NPM_TAG" \
  --current-latest "$CURRENT_LATEST"
```

The script only validates inputs and never publishes, tags, or queries the network.

- The host acceptance matrix matches the release channel: the prerelease channel pins alpha-series tags and the stable channel pins rc-series tags — **never follow master/main to masquerade as acceptance**;
- Pre-publish smoke for Web Client plugins must cover: the bundle entry announced in the host boot manifest (`window.__DSH_BOOT__`) is reachable, the bundle registers successfully, the DOM mount completes, and there are no page errors; `--dump-config` only proves the row exists and does not replace this check;
- Auditable reference implementations: [dsh-genui#86](https://github.com/omdsh-dev/dsh-genui/pull/86),
  [dsh-annotation#40](https://github.com/omdsh-dev/dsh-annotation/pull/40) (both implement
  items 1–3 and dual-host smoke; item 4, the latest-backwards protection, is a community-suggested
  addition not present in the reference implementations).

## Real pitfall list (two rounds of practice)

| Pitfall | Symptom | Handling |
|---|---|---|
| pnpm not on PATH (corepack only) | Nested `pnpm --filter …` in build scripts fails with `'pnpm' is not recognized` | Generate a `pnpm.cmd` shim that forwards to corepack and prepend it to PATH; startup/build wrappers bootstrap the shim |
| Windows PowerShell 5.1 resolves `npm` to `npm.ps1` | Arguments get mangled (`Unknown command: "pm"`) | Wrapper scripts explicitly invoke `npm.cmd` / `pnpm.cmd` |
| `$PSScriptRoot` is empty in PowerShell 5.1 default parameter values (with `[CmdletBinding()]`) | `Join-Path` errors on an empty string | Move default-value resolution into the script body |
| PowerShell's read-only automatic variable `$Host` | Parameter name `-Host` fails to override | Rename it, e.g. to `-BindHost` |
| `git rebase --continue` blocks on the editor | Hangs without a TTY | Use `GIT_EDITOR=true` (or `core.editor=true`) before continuing |
| Remote advanced and the push is rejected | `[ahead 1, behind 1]` | `git pull --rebase`, then re-push with `--force-with-lease`; never a bare `--force` |

## Rollback recipe

1. Tag before publishing and record the lockfile/composition baseline hashes;
2. GitHub direct-install track: delete/move the tag; consumers re-point at the old commit as needed;
3. Do migrations and publishing in an isolated workspace (branch/worktree), never mixed into one commit with feature changes;
4. On failure, roll back only the paths owned by this run (tag, lockfile, manifest) and report residual side effects of third-party install scripts.

## Pending confirmation

- After the 0.1.2 final dist-tag and final tag name are published, re-verify the unpublished-cohort recipes;
- The pnpm version sensitivity (see above) comes from a single field report; keep it marked as pending confirmation until reproduced.
