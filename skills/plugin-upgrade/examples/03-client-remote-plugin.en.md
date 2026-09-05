# Example 03: Web Client Using RemoteResult

English | [简体中文](03-client-remote-plugin.md)

**Scenario**: A browser-side `dsh.client` plugin calls Host Remote. This path differs from direct Host domain-service access.

**Touchpoints**: #3 service/Remote Complexity: ⭐⭐

## Client-Plane Contract

Client plugins declare the `remote` contribution required by the target version and call the generated `ctx.remote.<namespace>`.
Ordinary business/carrier failures return `RemoteResult`; assembly/programming errors can still reject.

See the executable code in [`face-contracts/client-remote.mjs`](face-contracts/client-remote.mjs):

- `ok: true` returns the value;
- `gateway/cancelled` ends the current operation without retrying;
- other Remote failures propagate upward, keeping the original object, `code`, and `details`;
- rejects such as an unmounted method are not folded into business results.

Example call:

```js
const result = await ctx.remote.llm.listProviders()
if (!result.ok) {
  if (result.error.code === 'gateway/cancelled') return
  throw result.error
}
return result.value
```

The exact namespace, parameters, and `inject` declaration must be confirmed from the generated Remote types at the target tag, not inferred from this
example. If the plugin actually runs on the Host plane, use [Example 02](02-host-side-plugin.md) and do not inject
`remote`.

## Verification

```sh
node skills/plugin-upgrade/examples/face-contracts/check.mjs
```

The tests cover success, cancel-without-retry, Remote failure identity preservation, and assembly reject propagation. You must still install into the
Web profile of the exact target DSH and verify the Loader, the browser bundle, and one real call.

## Sources

- [DSH-0.1.2-A1-01](../references/v0.1.2-alpha.1.md)
- [DSH-0.1.2-A2-02](../references/v0.1.2-alpha.2.md)
