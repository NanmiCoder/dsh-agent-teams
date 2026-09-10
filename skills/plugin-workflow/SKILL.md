---
name: plugin-workflow
description: Coordinate multiple DeepSeek Harness plugin Skills across inspection, migration, runtime debugging, heavy dependencies, testing, naming, and release. Use for a guided lifecycle workflow, a pre-run capability menu, or several DSH plugin operations with one status report. Preserve the user's selected scope and existing authorization across stages.
---

# Coordinate the DSH Plugin Lifecycle

Act as the workflow controller. Let the user choose outcomes and optional proof before execution, route each selected stage to its owning Skill, preserve one phase ledger, and return one evidence-backed report. Do not copy the detailed rules of an owning Skill into this Skill.

## Show the pre-run menu first

When the user has not explicitly selected a workflow, present the workflow and capability
tables below before running any phase. Match the user's language, mark `health-check` as the
recommended first-run choice, and wait for a selection. A recommendation is not a selection:
do not silently default to `health-check`, start discovery, or execute a capability.

Accept a workflow number, workflow ID, or unambiguous natural-language outcome. Let the user
add or remove capabilities in the same reply, for example `3 + docker-smoke + browser-check`.
Briefly identify which selected capabilities are read-only and which will later cross a
confirmation boundary.

The bundled planner renders the same deterministic menu and remains read-only:

```sh
node <plugin-workflow-skill>/scripts/plan-workflow.mjs
# Equivalent explicit form:
node <plugin-workflow-skill>/scripts/plan-workflow.mjs --menu
```

If the user already selected an outcome and supplied enough context, preserve that choice and
continue without showing the menu again.

## Continue with read-only discovery

Inspect only enough context to make the choices concrete:

1. Read repository instructions and inspect Git status without changing it.
2. Identify whether the target is the DSH monorepo, an external plugin source repository, an installed plugin, or a packed artifact.
3. Record the plugin source identity, current DSH version, requested target version, package manager, available scripts, plugin surfaces, and existing naming declaration.
4. Mark missing inputs as `unknown`. Do not install dependencies, run package scripts, start containers, edit files, or query a remote registry during discovery.

## Choose one workflow

| Workflow | Outcome | Default stages |
|---|---|---|
| `health-check` | Read-only plugin and upgrade-risk report | discovery, optional DSH audit, seven-touchpoint scan |
| `upgrade-target` | Upgrade an installed plugin to an explicit version | discovery, upgrade, static checks, rollback record |
| `compatibility-migration` | Adapt plugin source to an exact DSH target | discovery, DSH audit, seven-touchpoint migration, static and runtime tests |
| `test-only` | Validate an existing source tree or artifact | discovery, selected test levels, report |
| `naming-registry` | Validate identifiers and optionally check or register a cloud ID | discovery, offline naming, registry query, optional registration |
| `package-release` | Prepare and optionally publish a release | discovery, required test gates, pack, consumer smoke, optional publication |
| `full-lifecycle` | Migrate, validate, name, package, and optionally publish | all applicable stages in dependency order |
| `runtime-debug` | Diagnose and fix Web Client runtime behavior | runtime diagnosis/fix, static, functional and browser proof, rollback |
| `heavy-dependency` | Integrate a lazy-loaded Web Client dependency | integration, static, functional and browser proof, rollback, package inspection |

The last two workflows require the `web-client` surface. They can also be added as
capabilities to a migration. Use `health-check` for a read-only investigation; a
request to diagnose a symptom does not by itself select a fix workflow.

Then let the user include or exclude these capabilities. Recommend the smallest set that proves their stated outcome and state which recommended items are still unselected.

| Capability | Choice | Default |
|---|---|---|
| DSH version compatibility audit | `dsh-audit` | On for compatibility migration; otherwise off |
| Seven-touchpoint plugin scan | `touchpoint-scan` | On for health checks and migrations |
| Typecheck, unit tests, and build | `static-tests` | On after source changes and before packaging |
| Exact-version Docker cold start | `docker-smoke` | On for migrations and release candidates when Docker is available |
| One real functional path | `functional-probe` | On for migrations and releases |
| Browser validation | `browser-check` | On only for Web Client or UI surfaces |
| Offline naming declaration validation | `naming-local` | On for new external plugins; otherwise opt-in |
| Central cloud registry lookup | `registry-query` | Off until selected; read-only |
| Central cloud ID registration | `registry-register` | Off; requires reviewed external publication |
| Rollback rehearsal or recipe | `rollback` | Recipe on for every write workflow; rehearsal is opt-in |
| Build and inspect a package artifact | `package-artifact` | On for package/release and full lifecycle workflows |
| Publish an artifact or release | `release` | Off unless external release intent is explicit |
| Diagnose and fix Web Client runtime behavior | `runtime-debug` | Off unless selected; requires static, functional and browser proof plus rollback |
| Integrate a heavy browser dependency | `heavy-dependency` | Off unless selected; requires the same proof plus package inspection |

After the user chooses, normalize the selection with the bundled read-only planner. Read [`references/workflow-selection.schema.json`](references/workflow-selection.schema.json) when another tool needs to produce the input JSON.

```sh
node <plugin-workflow-skill>/scripts/plan-workflow.mjs \
  --workflow compatibility-migration \
  --include registry-query \
  --exclude browser-check \
  --surface ordinary-plugin
```

Use `--format json` for automation, or `--selection <selection.json>` for a persisted input that follows the schema. Calling the planner without a selection prints the menu instead of creating a default plan. The planner validates conflicts and required dependencies, emits deterministic phase IDs and confirmation boundaries, and never executes the selected phases. Treat its output as the initial ledger, not as user approval.

Do not treat `registry-query` as a reservation. Do not treat `registry-register` as required for local plugin use. A local plugin and the central registry may share a display name; only concrete identifiers on the same runtime surface can conflict, and the naming owner must report those exact matches.

## Build the phase ledger

Create one row per selected or dependency-required stage before execution:

| Phase | Capability | Owner | Status | Evidence or blocker |
|---|---|---|---|---|
| `P01` | discovery | `plugin-workflow` | `selected` | target and source identity |

Use only these status values:

- `selected`: chosen and not yet completed;
- `completed`: finished with evidence;
- `blocked`: attempted or required but unable to proceed;
- `skipped`: applicable but deliberately not run;
- `not_applicable`: irrelevant to the detected plugin surface or workflow.

Never turn an unavailable or unselected check into `completed`. When a phase is blocked, mark dependent phases `blocked` or `skipped` with the dependency reason and continue only with independent, authorized phases.

## Route each stage to its owner

Before executing a stage, load and follow its owning Skill. If the owner is unavailable, mark the phase `blocked`; do not recreate its implementation from memory.

| Stage | Owning Skill | Boundary |
|---|---|---|
| Installed update or source compatibility migration | `$plugin-upgrade` | Inspect first; check authorization for config, dependency, or source changes |
| New plugin code or offline naming declaration | `$plugin-write` | Follow the exact target Harness contract |
| Static, runtime, Docker, functional, or browser validation | `$plugin-test` | Select the minimum sufficient levels and preserve evidence |
| Package, release gates, publication, and release rollback | `$plugin-release` | Check the publication destination and authorization |
| DSH host version-to-version evidence | `$dsh-upgrade-audit` | Keep generated evidence separate from plugin source changes |
| Web Client runtime diagnosis and repair | `$plugin-runtime-debug` | Establish the exact host contract and reproduce the failing interaction |
| Lazy-loaded browser dependency integration | `$plugin-heavy-dep` | Own chunk loading, host route, fallback and markup handling |

Keep one owner per phase. When runtime debugging and dependency integration overlap,
record the diagnosed contract and let the integration owner consume it instead of
starting a competing rewrite. Reuse the selected target version and source identity
across owners. If a later owner changes source, dependencies or the package artifact,
invalidate the earlier verification that depended on those inputs and rerun it.

Run stages in dependency order:

1. discovery and source identity;
2. DSH audit when selected;
3. upgrade or implementation changes, then selected runtime repair or dependency integration;
4. offline naming and optional registry query;
5. static tests;
6. Docker, functional, and browser proof;
7. release preparation and artifact inspection;
8. external registration or publication.

Skip stages that are not selected unless an owning Skill makes them a hard gate for a later selected stage. In that case, add the gate to the ledger, explain why it is required, and obtain any needed confirmation before running it.

## Preserve authorization across three boundaries

Group planned actions by boundary and check each against the user's request and
higher-priority instructions. Existing explicit authorization applies to the same
scope when handing off to another Skill; do not ask again merely because the owner
changed. A generated plan grants no authorization, and authorization for source edits
does not implicitly authorize publication. Ask only when a required action is outside
the authorization already supplied.

1. **Repository writes**: show exact files, intended changes, and rollback scope before editing source, configuration, manifests, or lockfiles.
2. **Dependency and runtime execution**: show package-manager commands, lifecycle-script risk, containers, services, browsers, credentials, and expected generated outputs before installs or nontrivial runtime tests. Ordinary read-only Git and file inspection does not need confirmation.
3. **External publication**: identify the exact destination and payload for commits, tags, registry PRs, npm artifacts, or hub/collection changes, and confirm that this action is within the user's authorization.

If a selected phase crosses more than one boundary, check each boundary when it becomes actionable. Never request or expose secrets merely to complete a phase.

## Maintain and report evidence

Update the ledger after every phase, including failures and explicit skips. Keep exact versions, source SHAs, commands, exit codes, report paths, and uncovered boundaries. Before finishing, verify that every selected capability has a terminal status.

Return one report containing:

1. workflow and capability selection;
2. source and target identities;
3. final phase ledger;
4. changes made and commits created;
5. test and registry evidence;
6. blocked, skipped, and unverified boundaries;
7. rollback instructions limited to paths owned by this workflow;
8. publication state, clearly distinguishing local validation, no reviewed registry match, reviewed registration, and released artifacts.

Do not summarize a partial cold start as functional compatibility, a registry no-match as a reserved ID, or a prepared artifact as published.
