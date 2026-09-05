# 示例 02：Host 平面插件改为领域服务直连

简体中文 | [English](02-host-side-plugin.en.md)

**场景**：0.1.1 插件在 Host 平面注入 `apiProxy`，用于读取模型提供方；升级后入口永久
`pending (waiting for service: apiProxy)`。

**影响触点**：#3 服务探测　复杂度：⭐⭐

## 为什么不能改成 `ctx.remote`

`apiProxy` 是旧 Host 平面门面；`ctx.remote` 是 Web Client 平面门面。两者不是同一运行时，
把 `inject: ['apiProxy']` 对号替换为 `inject: ['remote']` 只会从等待一个不存在的服务变成
等待另一个不存在的服务。

Host 插件应直接注入 owning domain service。容器实测的 provider 场景是：

```js
// 0.1.1
export const inject = ['apiProxy']
const providers = await ctx.apiProxy.llm.providers()

// 0.1.2-alpha.2 Host plane
export const inject = ['llm']
const providers = ctx.llm.listProviders()
```

可执行控制流以 [`face-contracts/host-domain.mjs`](face-contracts/host-domain.mjs) 为唯一代码源；
测试会给 `ctx.remote` 安装一个抛错 getter，证明 Host 路径不会访问 Client face。

## 迁移步骤

1. 判定运行平面；本例是 Host entry，不是 `dsh.client` 浏览器插件；
2. 删除 `@deepseek-ai/dsh-host-apiproxy` 依赖和 `apiProxy` inject；
3. 从目标 tag 的 owning package/类型确认领域服务与方法；本例经真实容器验证为 `llm` / `listProviders()`；
4. 添加 `inject: ['llm']`，调用 `ctx.llm.listProviders()`；
5. 用真实 profile 验证 entry activate、服务不 pending，并执行该领域方法。

## 验证

```sh
node skills/plugin-upgrade/examples/face-contracts/check.mjs
```

该依赖零 fixture 只防止 Host/Client 平面再次写反；它不能替代固定 tag 的 build 或真实 DSH
profile。产品级实测与正控见
[`benchmark/validation-report-2026-08-30.md`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/benchmark/results/validation-report-2026-08-30.md)。

## 来源

- [DSH-0.1.2-A1-01](../references/v0.1.2-alpha.1.md)
- [容器全链验证](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/benchmark/results/validation-report-2026-08-30.md)
