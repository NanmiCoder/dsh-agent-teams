# Config Plugin Reference

Accept user configuration supplied through `cordis.yml`.

> Target-version guard: this document is a form reference, not version-migration authority. Verify every package identifier, export, Loader rule, and configuration capability against the exact target Harness checkout. For an upgrade, build the migration ledger from [`version-adaptation.md`](version-adaptation.md) first, then follow the observed target behavior.

## Shape

Export a `Config` type and a same-named Schemastery Schema. Declare defaults directly on Schema fields:

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  greeting: string
  maxRetries: number
  verbose?: boolean
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
  verbose: Schema.boolean().default(false),
})

export function apply(ctx: Context, config: Config) {
  // Use validated, type-safe user values or Schema defaults.
}
```

Consumers provide values under `config` on the plugin row in `cordis.yml`. During load, Cordis validates user values against the exported Schema and fills defaults. Do not export a plain object as `Config`; it does not implement the Standard Schema interface Cordis requires. Use Schemastery for stronger validation: `Schema.string().required()`, `Schema.number().default(30000)`, and `Schema.union(['fast', 'accurate']).default('fast')`. The Schema runs during plugin load. Invalid configuration must fail loading with an actionable error.

## Rules

- **Do not hard-code tunable values.** A value that two deployments may want to set differently must be a configuration field. Ask whether the value can change through `cordis.yml` without modifying code. `DEFAULT_*` constants and test hooks do not count as configurable. Keep protocol constants, external specifications, and security invariants fixed.
- **Fail explicitly on invalid configuration.** Express self-contained constraints in the Schema so invalid configuration fails during plugin loading. Reference services or registered resources through dependency injection with `inject`, not through the Schema.
- **Use `!!js`, never `!js`, only under plugin `config`.** Loader metadata is static: `id`, `name`, `group`, `disabled`, `inject`, `intercept`, and `isolate` must remain literals. Therefore `disabled: !!js ...` creates a truthy object and always disables the entry. When environment selection changes which plugins mount, use explicit configuration overlays.
- **Credentials must not become configuration values.** Use the environment-variable fallback from the target Schemastery package, then pass it through `cordis.yml` with `!!js process.env.MY_KEY`; or use a named credential reference resolved per operation through `ctx.credentials`. Never inline credentials or read arbitrary credential files in code.
- **Prefer explicit behavior at package boundaries.** Resolve defaults in an explicit implementation-owned `resolve(request): Spec` step. Never hide them behind `?? default` inside `run()`.
- **HMR works automatically.** A configuration change hot-replaces the plugin: the framework unloads the old instance and loads the new instance. Because registrations are effects, contributions from the old instance are cleaned up automatically.

## Validation

Unit-test Schema acceptance and rejection: valid values, invalid values, missing required fields, and applied defaults. Assert that bad configuration makes loading fail explicitly instead of being silently skipped. Because the Schema sits on the package's published entry, run both a built-entry check and a real-composition check. A package `bin` must run its built entry under native Node, and the process must exit nonzero when required configuration is truly missing. In the Harness monorepo, satisfy its per-file coverage gate. In an external repository, satisfy its declared coverage gate.
