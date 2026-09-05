# Migration hygiene · version-independent toolchain pitfalls

> First-hand record from a batch migration of 6 real plugins (rc.1 → 0.1.2-alpha.1, see [example 06](../examples/06-real-world-batch-migration.md)). None of these pitfalls belongs to a version card — any of them can cost a migrator half an hour or more on any corridor segment.

## 1. Incremental tsbuildinfo false positives

Symptom: after editing source, typecheck reports old errors unrelated to the change (e.g. TS2305), or the oxc/rolldown build reports a `MISSING_EXPORT`-class missing export (that is a build-cache false positive, not a tsc error), or the incremental check passes outright and the real error chain only surfaces after a clean.

Fix: always run `pnpm run clean` before build during migration validation. On a suspicious TS2305/TS2614-class missing export, clean first to rule out the cache, then grep the real references (see the [A1-21 field note](v0.1.2-alpha.1.md)).

## 2. The oxc / vite parser is stricter than tsc

Symptom: tsc passes, but the build reports a "Did you mean {'>'}"-class parse error. Known triggers: unclosed JSX tags, arrow functions inside multi-line ternary expressions.

Fix: rewrite the expression as the parser suggests — precompute a variable, split the statement. Do not work around it, and do not treat a passing tsc as sufficient.

## 3. Which plane a change takes effect in: client hard refresh vs host restart

Symptom: after changing code, a browser refresh shows no change, or the host still behaves like the old version.

Rule: a change landing in `lib/client.js` (client half) takes effect on a browser hard refresh; a change landing in `lib/index.js` (host half) requires restarting dsh. This corresponds to the plane view in [host-plane-probes.md](host-plane-probes.md): decide the plugin shape and where the change lands first, then pick the validation action.

## 4. pnpm blocks dependency build scripts (default since 10.0)

Symptom: installing the plugin in a fresh environment fails with a build rejection such as node-pty.

Fix: run `pnpm approve-builds --all` in the profile directory. Plugin READMEs should state this step explicitly.

## 5. readonly and as-in-JSX in test code

Symptom: after migration, test files fail to compile while the source typechecks clean.

Known triggers: fields such as `dispose` on the fiber become readonly (tests can no longer assign mocks — switch to indirect observation); `as` assertions in test files are unsupported on the JSX parsing path (pre-narrow into a variable instead).

## Validation discipline

Run the full chain for every migration change: `pnpm run clean && pnpm run build && pnpm run typecheck && pnpm run test`, then boot for real (`dsh --profile web` + hard refresh; restart when the host half changed). Conclusions from incremental checks alone are not trustworthy — see item 1.
