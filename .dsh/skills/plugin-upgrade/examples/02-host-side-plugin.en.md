# Example 02: Host-Plane Plugin Switching to Direct Domain-Service Access

English | [简体中文](02-host-side-plugin.md)

**Scenario**: A 0.1.1 plugin injects `apiProxy` on the Host plane to read the model provider; after the upgrade, the entry stays
`pending (waiting for service: apiProxy)` forever.

**Touchpoints**: #3 service probing Complexity: ⭐⭐

## Why Not Switch to `ctx.remote`

`apiProxy` is the old Host-plane facade; `ctx.remote` is the Web Client-plane facade. They are not the same runtime, so
swapping `inject: ['apiProxy']` for `inject: ['remote']` one-for-one only trades waiting for one nonexistent service for
waiting for another nonexistent service.

Host plugins should inject the owning domain service directly. The provider scenario verified in a real container:

```js
// 0.1.1
export const inject = ['apiProxy']
const providers = await ctx.apiProxy.llm.providers()

// 0.1.2-alpha.2 Host plane
export const inject = ['llm']
const providers = ctx.llm.listProviders()
```

The executable control flow has its single code source in [`face-contracts/host-domain.mjs`](face-contracts/host-domain.mjs);
the test installs a throwing getter on `ctx.remote` to prove that the Host path never accesses the Client face.

## Migration Steps

1. Determine the runtime plane; this example is a Host entry, not a `dsh.client` browser plugin;
2. Remove the `@deepseek-ai/dsh-host-apiproxy` dependency and the `apiProxy` inject;
3. Confirm the domain service and method from the owning package/types at the target tag; this example was verified in a real container as `llm` / `listProviders()`;
4. Add `inject: ['llm']` and call `ctx.llm.listProviders()`;
5. Verify with a real profile that the entry activates, the service is not pending, and the domain method executes.

## Verification

```sh
node skills/plugin-upgrade/examples/face-contracts/check.mjs
```

This zero-dependency fixture only prevents the Host/Client planes from being written backwards again; it cannot replace a build from the pinned tag or a real DSH
profile. For production-grade validation and positive controls, see
[`benchmark/validation-report-2026-08-30.md`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/benchmark/results/validation-report-2026-08-30.md).

## Sources

- [DSH-0.1.2-A1-01](../references/v0.1.2-alpha.1.md)
- [Full container-chain validation](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/benchmark/results/validation-report-2026-08-30.md)
