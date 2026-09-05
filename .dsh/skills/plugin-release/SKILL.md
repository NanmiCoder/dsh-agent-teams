---
name: plugin-release
description: Package, publish, and distribute DeepSeek Harness (DSH) plugins — npm pack artifact validation, GitHub/npm/hub release-track selection, tarball overrides installs for the unpublished cohort (0.1.2-alpha.*), and CI/release gates with rollback. Use when publishing a plugin, packing a tarball, wiring a plugin into a profile/hub, or installing an alpha version that is not on npm; show a plan and obtain user confirmation before any publish action.
---

English | [简体中文](SKILL.zh-CN.md)

# plugin-release

Ship developed, tested plugins safely. Publishing is a one-way outbound action — **show a plan and obtain confirmation before any actual publish or tag push**; this skill does not decide version numbers for you, and it never bumps versions automatically.

## Step 0: confirm the target version and release track

| Release track | Applies to | Key facts |
|---|---|---|
| GitHub direct install | `dsh plugin --profile <p> add github:owner/repo` | Consumers resolve the default-branch HEAD; publishing = pushing to main — **run the full gate before pushing** |
| npm registry | `npm publish` | Official release line only; alpha/rc-prefixed `@deepseek-ai/*` versions are **not guaranteed** on npm — verify with `npm view <pkg> versions` before publishing |
| hub listing | register in the hub catalog | Registration is a separate action and does not replace packaging validation |
| collection | member plugins vendored into a pack artifact | Follow the owning collection repository's own process |

The unpublished cohort (for example a cohort version that was never published to npm — alpha.1 was GitHub-only; alpha.2 through alpha.4 are published under the `alpha` dist-tag) goes through the overrides flow in [references/publish-playbook.md](references/publish-playbook.md). **Do not** look for versions that do not exist on npm, and do not switch package managers because of it.

## Step 1: pack and validate the artifact

1. Use the repository's single package manager and lockfile (`package-lock.json` → npm, `pnpm-lock.yaml` → pnpm);
2. Run the full gate (see Step 3), then `npm pack` / `pnpm pack`;
3. Unpack and validate: `files` covers every runtime relative import and asset; no `.ts` leftovers in the artifact; the manifest files such as `cordis.patch.yml` / `dsh.plugin.json` / `SKILL.md` are all present;
4. Install the tarball into an isolated profile for consumption validation (the plugin's row appears in `dsh --profile compat --dump-config` → the tool is genuinely registered and executes).

## Step 2: version dependency baseline (alpha era)

- devDependencies use the **npm release line** (currently 0.1.1-rc.2) as the type baseline, so a public repository typechecks after `npm install` on any machine;
- peer ranges use a wide range (such as `<0.2.0`) to cover unpublished alphas/rcs;
- when code must stay compatible with both the local harness (GitHub tag) and the npm release line, use the **dual-compatibility pattern**: keep the shape that the npm release line's types require, while the alpha runtime semantics remain unchanged (see the "dual-compatibility pattern" section of the playbook);
- never write local absolute paths (junction/file:) into a committed package.json.

## Step 3: release gate (layer by layer; a lower layer must pass before the next one)

1. Dependency resolution: the lockfile changes only as expected; no mixed cohorts;
2. Static: typecheck + plugin tests + build;
3. Real mount: cold-boot the target host on an isolated profile **pinned to an exact DSH tag** (never let a mutable master/main masquerade as acceptance), with the entry active and no service left pending. Web Client plugins must additionally verify: the host-advertised resources (the bundle entry from the boot manifest/boot list) are reachable, the bundle registers successfully, the DOM mount completes, and there are no page errors — looking at `--dump-config` alone does not complete this layer;
4. Behavior: one core path actually executes (for tool plugins: one message → tool → response; or an equivalent dedicated flow);
5. Wrapper: verify exit codes and stdout/stderr attribution.

## Step 4: release semantic gate (stop publishing if any check fails)

1. The GitHub Release tag must equal `v${package.json.version}`;
2. Whether the version carries a prerelease suffix (the segment after `-`, before the `+` build metadata) must match the GitHub Release's prerelease status;
3. Prereleases may only go to a **project-declared non-latest dist-tag** (the name is chosen by the project, such as `next` or `alpha` — the skill does not hard-code a specific name); only stable versions without a suffix go to `latest`;
4. Before a stable publish, query the current `latest` (`npm view <pkg> dist-tags.latest`) and refuse to publish when the semver is lower than the existing latest, to prevent moving latest backwards to a lower version.

## Step 5: publish and rollback

- Before publishing: clean commit + tag; record the lockfile and composition baseline hashes;
- After publishing: reinstall once as a consumer and smoke-test;
- Rollback: prefer reverting the release (delete the tag / re-point at the old commit); do not publish a "works on both sides" patch to paper over the problem;
- For unpublished-cohort CI, see the "CI and release gates" section of the playbook (cohort store caching, the `NPM_PUBLISH_ENABLED` switch).

## Safety boundaries

- Show a plan and obtain confirmation before any publish / tag push / hub registration write; never bump versions automatically;
- Never publish artifacts containing credentials, `.npmrc` contents, session logs, or private paths;
- Do not switch package managers or rewrite a different lockfile; on failure, roll back only the paths owned by this run and report residue.

## References

| File | Contents |
|---|---|
| [references/publish-playbook.md](references/publish-playbook.md) | Unpublished-cohort installation, dual-compatibility pattern, CI/release gates, real pitfall list, and rollback recipes |
| [references/profile-dependency-management.md](references/profile-dependency-management.md) | Profile install/update recipes: github dependency lock caching, three-place sync on package rename, junction cleanup, and host-upgrade linkage |
