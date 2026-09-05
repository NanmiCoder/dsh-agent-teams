# Host / Web Client face contract fixtures

These dependency-free modules make one migration boundary executable:

- [`host-domain.mjs`](host-domain.mjs): a Host plugin injects the owning `llm` domain service and never reads `ctx.remote`;
- [`client-remote.mjs`](client-remote.mjs): a Web Client consumes `ctx.remote`, handles ordinary failures through `RemoteResult`, treats cancellation as terminal, and preserves other failures;
- [`check.mjs`](check.mjs): proves both control flows and that assembly/programming rejects are not swallowed.

Run directly:

```sh
node skills/plugin-upgrade/examples/face-contracts/check.mjs
```

The fixture deliberately has no DSH dependency: it proves the documented branching contract, not package names,
descriptor arguments, Loader activation, or browser composition. Those still require fixed-tag source checks and the
real profile/product smoke required by `plugin-upgrade`.
