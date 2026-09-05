# Troubleshooting · post-migration symptom lookup

> Quick-reference table for tracing symptoms back to root causes and their cards, for debugging after Mode C migrations. It is not a decision flow, nor a complete fault catalog: root-cause confirmation still rests on the card recipes and the target tag's source; symptoms not listed here return to the pre-flight touchpoints and the layered validation checklist for layer-by-layer triage.

| Symptom | Most likely root cause | Card to check first |
|---|---|---|
| Panel/floating ball silently disappears, the plugin is absent from the boot graph, usually with no error at all | `dsh.client.inject` still references a removed package (phantom dependency), so the row never enters the graph; or the registration id / assembly row name does not match the package name; or the plugin is `disabled: true` at the patch layer | [DSH-0.1.2-A1-25](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-26](v0.1.2-alpha.1.md) |
| Startup assertion `loaded without registering "<id>"` | the client bundle's registration id (`__ModuleLoader__.load` id / tsdown banner `PLUGIN_ID`) ≠ package.json `name`, or the assembly row's `name` is not the bare package name | [DSH-0.1.2-A1-26](v0.1.2-alpha.1.md) |
| `web boot: N entries did not activate`, `waiting for service: apiProxy` | 0.1.2 removed the ApiProxy transport layer, so a row with `require: ['apiProxy']` stays pending forever; or inject still references a removed package | [DSH-0.1.2-A1-01](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-25](v0.1.2-alpha.1.md) |
| Plugin loads but features half fail, console reports a factory error | the session-content read path is broken (per-session `.nodes` snapshot removed) or the composer DOM has drifted | [DSH-0.1.2-A1-27](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-28](v0.1.2-alpha.1.md) |
| `workspaces.connectWorkspace is not a function`, or workspace connect/pick throws while the plugin still boots | `ctx.workspaces` survived the Client Runtime split as list/CRUD only; navigation and the directory picker moved to `ctx.uiWorkspace`. `baselinesReady` / `recentWorkspaceId` are gone | [DSH-0.1.2-A1-32](v0.1.2-alpha.1.md), [DSH-0.1.2-A1-25](v0.1.2-alpha.1.md) |
| Old host reports `missed the module table` | the client bundle hard-requires a module unique to the target cohort during evaluation (cross-cohort coexistence problem) | rollup [R-02](rollup-0.1.2.md) |

- **Source**: real migration of dsh-input-history 0.1.1 → 0.2.0 (2026-08); the last row comes from [discussion #5120](https://github.com/deepseek-ai/deepseek-harness/discussions/5120).
