# 示例 03：Web Client 使用 RemoteResult

简体中文 | [English](03-client-remote-plugin.en.md)

**场景**：浏览器侧 `dsh.client` 插件调用 Host Remote。该路径与 Host 领域服务直连不同。

**影响触点**：#3 服务/Remote　复杂度：⭐⭐

## Client 平面契约

Client 插件声明目标版本要求的 `remote` contribution，并调用生成的 `ctx.remote.<namespace>`。
普通业务/载体失败返回 `RemoteResult`；装配/编程错误仍可能 reject。

可执行代码见 [`face-contracts/client-remote.mjs`](face-contracts/client-remote.mjs)：

- `ok: true` 返回 value；
- `gateway/cancelled` 结束当前操作，不重试；
- 其他 Remote failure 保留原对象、`code` 与 `details` 后向上传播；
- 方法未挂载等 reject 不会被折叠成业务结果。

示意调用：

```js
const result = await ctx.remote.llm.listProviders()
if (!result.ok) {
  if (result.error.code === 'gateway/cancelled') return
  throw result.error
}
return result.value
```

精确 namespace、参数和 `inject` 声明必须从目标 tag 的 generated Remote 类型确认，不能从本
示例推导。若插件实际运行在 Host 平面，请使用[示例 02](02-host-side-plugin.md)，不要注入
`remote`。

## 验证

```sh
node skills/plugin-upgrade/examples/face-contracts/check.mjs
```

测试覆盖成功、取消不重试、Remote failure 身份保留和 assembly reject 传播。之后仍须安装到
精确目标 DSH 的 Web profile，验证 Loader、浏览器 bundle 与一次真实调用。

## 来源

- [DSH-0.1.2-A1-01](../references/v0.1.2-alpha.1.md)
- [DSH-0.1.2-A2-02](../references/v0.1.2-alpha.2.md)
