---
name: plugin-write
description: Use when creating a DeepSeek Harness plugin, choosing public names for a new external DSH plugin, validating a dsh-plugin.naming.json manifest, checking reviewed central registrations for known conflicts, or creating a workspace package inside the deepseek-harness repository. Covers the full workflow from repository-mode and plugin-form selection through separate offline naming validation, optional online registry lookup, and package validation. Routes tool, LLM adapter, hook, service, and configuration forms to their corresponding references while separating upstream-monorepo rules from external-package rules. For an existing plugin crossing Harness versions, use this Skill's built-in version-adaptation workflow before implementing against the exact target contract.
---

# Write DeepSeek Harness Plugins

Create a plugin package. First classify the repository mode and plugin form, then read the matching reference files, and finally validate the published entry with the smallest set of gates that covers the change.

## Select the Repository Mode First

| Target | Rules to apply |
|---|---|
| A package inside the official `deepseek-harness` monorepo | Use the in-repository package, tsconfig, documentation, and root-gate rules below. |
| An externally installable DSH plugin | Preserve that repository's package layout and scripts. Use only packages and exports published by the exact target DSH version. Do not copy `private`, workspace versions, root tsconfig registration, or monorepo-only README gates. |
| An existing plugin being adapted to a new DSH host | Read [`references/version-adaptation.md`](references/version-adaptation.md), build the complete version corridor, and run the seven-class touchpoint preflight. If a change is `breaking` and the user has not yet authorized implementation, present the migration plan and wait for confirmation. After authorization, complete the version adaptation before using this Skill's form references. Form examples must never override target source, type declarations, or release notes. |

Derive Cordis, Schemastery, and DSH package names and version ranges from the manifest of the exact target version. Current examples use scoped `@deepseek-ai/*` identifiers. Older targets may differ and must follow their own published contracts.

For every new external plugin, read [`references/naming-conventions.md`](references/naming-conventions.md) before choosing public identifiers. Create `dsh-plugin.naming.json` at the plugin repository root and run the bundled read-only validator before final package validation. Treat compatibility errors as target-contract failures and prefix warnings as community recommendations; use `--strict` only when the plugin adopts the collision-resistant profile. This is not an official Harness manifest or a global reservation. For an existing external plugin, report naming deviations but preserve published names unless the user explicitly authorizes a compatibility-breaking rename. Packages inside the official monorepo follow the exact target checkout instead of this external naming profile.

After the offline declaration passes, read [`references/registry-check.md`](references/registry-check.md) and run the separate central lookup when public network access is available. Supply the exact target Harness version. Treat a completed no-match result only as “no reviewed match”; treat timeout, malformed data, unsupported contract, or network failure as “unknown/not checked.” Never let the online lookup modify the local manifest, automatically rename a published surface, or turn an automated discovery candidate into a reservation. A formal reservation exists only after a source-backed entry is reviewed and merged in the central registry.

## Then Classify the Plugin Form

| Required capability | Form | Reference |
|---|---|---|
| Model-callable tools for reading files, running commands, or searching the Web | Tool plugin | `references/tool-plugin.md` |
| A new model provider | LLM adapter plugin | `references/llm-adapter-plugin.md` |
| Request, tool, or turn interception for permissions, policy, metrics, or telemetry | Hook plugin | `references/hook-plugin.md` |
| A capability consumed by other plugins through `ctx` | Service plugin | `references/service-plugin.md` |
| User-configurable behavior supplied through `cordis.yml` | Config plugin | `references/config-plugin.md` |

A plugin may combine forms freely, such as a configurable tool plugin or a service that also registers tools. Every included form still has to satisfy its own contract. When a requirement does not match one of the five forms above, map it to an existing extension point and write a plugin that registers there. Never modify the Agent loop directly.

| Goal | Mechanism |
|---|---|
| Add a model-callable capability | Register it on `ctx.tools` |
| Add a model provider | Register an adapter on `ctx.llm` |
| Provide a different capability set for one session | Assemble it in an Agent preset |
| Add Shell execution | Implement and register a `ctx.bash` backend |
| Add persistent terminal execution | Register a `ctx.pty` backend and load `dsh-tool-pty` |
| Add human commands | Register them on `ctx.commands` |
| Add background tasks | Register them on `ctx.tasks` |
| Add filesystem access or policy | Implement a `ctx.fs` provider or listen for `fs/*` policy events |
| Constrain launched processes | Use a `ctx.sandbox` backend |
| Intercept requests, tools, or turns | Use `agent/*` or `tools/*` events; `agent/turn-stopping` is the turn-stopping event |
| Add model-visible context | Call `agent.inject()` |
| Add UI or editor integration | Drive `ctx.agents` and render from `session/event` |
| Add Web-client conversation nodes | Register a `ConversationNodeDefinition` and keyed renderers |
| Add persistent session state | Extend `SessionEventMap`, then render and replay from the log |
| Fork a live session | Call `ctx.sessions.fork(source, boundary?, childSessionId?)` |
| Scope registrations to one Agent | Use that Agent's `agent.ctx` |

## Package Checklist

1. **Create an in-repository package** — Only in the official monorepo, create `packages/<group>/<pkg>/` with `package.json`, `tsconfig.json`, `src/index.ts`, and `README.md`. Copy `packages/core/tools/package.json` from the target checkout, then adjust its name, description, and dependencies. Preserve target-version invariants: `private: true`; the root package `version`; `type: module`; `main: "lib/index.js"`; `types: "lib/types/index.d.ts"`; both `types` and `default` in `exports["."]` pointing to `lib`; the same target Cordis range in peer and development dependencies; every DSH peer dependency mirrored in development dependencies; the target Schemastery package declared in `dependencies`; and the target `files` layout plus package-specific runtime artifacts. CLI application packages must include the built `bin`. Do not publish undeclared source or stale artifacts. Follow relative-import conventions from the target checkout. Prefer an existing group with the matching role. A new group is only a container, and the package must sit exactly one level below it.

2. **Register an in-repository package** — Only in the official monorepo, add the package to the Host or Client aggregate exactly as required by the development guide in the target checkout. A normal package belongs to one aggregate only. Do not copy historical exceptions or file lists without checking the target version. External plugins must never modify Harness root configuration.

3. **Create an external package** — Preserve the existing package manager and build system. For a new plugin, apply the external naming policy and include a validated `dsh-plugin.naming.json`; for an existing plugin, do not silently rename public surfaces. Keep `main`, `types`, `exports`, `files`, optional `bin`, packaged-composition or Profile metadata, and the packed tarball consistent. Declare every runtime dependency explicitly and mirror the DSH peer dependencies needed for compilation in development dependencies. Do not make a publishable external plugin `private` or give it workspace version ranges merely because an in-repository template does so.

4. **Choose the package topology** — For a replaceable capability, split service definition, provider, and consumer into separate packages only when they will evolve independently. Keep a single-purpose plugin in one package.

5. **Write the in-repository package README** — Only when required by the target monorepo, put package-specific service APIs, configuration, events, extension points, and design notes first. End the README with the canonical "Model Experience" ordering and "Known Limitations" section from the target checkout. Describe each direct, conditional, capped, lifecycle, or auxiliary-model surface in its own H3 with the following three H4 sections, each containing a prose paragraph. Quote stable text owned by the package. For a tool Schema surface, describe only differences not already present in the generated tool catalog. Under "KV Cache Impact," distinguish append-only growth, stable repeated prefixes, replacement of earlier request tokens, and independent model requests. Then list the package changes that invalidate reuse.

   ````markdown
   ## Model Experience

   ### Request Surface and Activation Conditions

   #### What the Model Sees

   Name the exact data-dependent field, link to the generated catalog with an anchor, or introduce the verbatim text below.

   ##### Place the Verbatim Field Text Here When Needed

   ```markdown
   Copy any stable system-prompt body or other long nongenerated literal exactly from source.
   ```

   #### Token Impact

   State whether the impact is fixed, conditional, retained, replaced, capped, or has zero direct token impact.

   #### KV Cache Impact

   Describe append-only, prefix-stable, replacement, or independent behavior, including exact conditions that may invalidate reuse.

   ## Known Limitations and Deferred Work

   - **Consumer-visible gap** — State the exact missing operation or condition, its consequence, and any maintainer constraint.
   ````

6. **Validate** — For a new external plugin, first run `node <plugin-write-skill>/scripts/validate-names.mjs --manifest ./dsh-plugin.naming.json`; add `--strict` only for the collision-resistant community profile. After it passes, run `node <plugin-write-skill>/scripts/query-registry.mjs --manifest ./dsh-plugin.naming.json --harness-version <exact-semver>` when network access is available, and report an unavailable query as unknown rather than available. Then run the applicable validation block below, focused checks, and coverage gate required by the changed behavior.

## Rules While Writing

- Treat every registration as an effect. Register through `ctx` helpers or `ctx.effect()` with a disposer, and make plugin unload clean up every event listener, tool, timer, and other resource.
- Add new behavior at documented extension points. Do not modify `agent-loop`.
- Give public service methods and typed events JSDoc with `@param` and `@returns`. Define typed events through declaration merging on the target Cordis `Events` interface, and document the dispatch mode with `@mode`.
- Do not hard-code tunable values. Any value that may differ across deployments must be a validated `Config` field changeable through `cordis.yml`.
- Everything the model sees must be reconstructible from the session log.
- Fail explicitly on configuration errors. Never silently skip a missing referenced object. Validate at parser, configuration, wiring, and process boundaries instead of trusting an in-process typed caller.

## Validation

For packages inside the official Harness monorepo, use current root commands from the target checkout. The names below are examples only; confirm they exist before running them:

```sh
pnpm install            # Register the workspace
pnpm run doc-sync
pnpm run constraints && pnpm run typecheck && pnpm run lint
pnpm run build && pnpm run hygiene
```

For an external plugin, use its own install, typecheck, test, static-check, and build commands. Pack the publishable artifact, inspect its contents, and load it into an isolated Profile running the exact target DSH. For an upgrade, cold-start it and complete one message → tool → reply flow or an equivalent core flow. Report every provider, operating-system, UI, or credential boundary that remains uncovered.

Select tests from the changed surface: unit-test logic; run the repository's coverage gate; run real-API end-to-end tests when provider credentials are available and execution is authorized; use credential-free snapshots for model-, protocol-, or user-visible behavior; and use a real-composition test for user-visible plugins. A package `bin` entry also needs a built-artifact smoke test under native Node. Complete the minimum sufficient test set under these rules without loading another Skill.

See [`references/README.md`](references/README.md) for the reference index.
