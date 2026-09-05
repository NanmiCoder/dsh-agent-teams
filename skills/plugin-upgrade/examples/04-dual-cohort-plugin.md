# 示例 04：dsh-mnemon 的 rc.2 / alpha.1 双 cohort 兼容实录

简体中文 | [English](04-dual-cohort-plugin.en.md)

> 本文记录 `omdsh-dev/dsh-mnemon` 在 2026-08-27 至 2026-08-28 完成的真实迁移。
> 它是固定提交的实测记录，不是本仓库可执行的 fixture，也不表示所有双 cohort 差异都能无分支处理。

## 身份、平面与版本

- 插件：`dsh-mnemon`，迁移代码完成时为 `0.3.4`，随后随
  [`v0.3.5`](https://github.com/omdsh-dev/dsh-mnemon/releases/tag/v0.3.5) 发布。
- 已发布基线：DSH [`dsh-v0.1.1-rc.2`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.1-rc.2)
  （commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`），由 npm registry 与 lockfile 提供。
- 源码预览目标：DSH [`dsh-v0.1.2-alpha.1`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.1)
  （commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`）；alpha.1 未发布到 npm，验证时从官方 tag 构建。
- 插件证据：初次适配 commit
  [`30d7476`](https://github.com/omdsh-dev/dsh-mnemon/commit/30d7476ba58f86e417959aae64d4dd3fb80f0434)，
  rc.2 兼容修正 commit
  [`b50a504`](https://github.com/omdsh-dev/dsh-mnemon/commit/b50a504dbe738aa359cd6ef8e4fd790ed9c19a10)，
  合并记录 [PR #105](https://github.com/omdsh-dev/dsh-mnemon/pull/105)。
- 运行平面：Host（自定义 Connection RPC、设置与权限）、Web Client（runtime/Workspace/slot/locale 类型面）和
  Headless/发布验证；不是普通 Cordis plugin 的单平面迁移。
- 命中触点：#3 services/RPC、#5 Web UI/客户端依赖、#6 自定义 RPC/认证通道、#7 源码构建与
  Headless 验证；另命中 packaging/dependency 与 security/config 特殊面。

相关卡片与 rollup：

| 命中 | 适用面 | 依据 |
|---|---|---|
| `dsh-client-runtime` 移除、Client/Workspace 所有权拆分 | Web Client | `DSH-0.1.2-A1-25`、`DSH-0.1.2-A1-32` |
| Session view、slot 与客户端类型归属变化 | Web Client | `DSH-0.1.2-A1-03` |
| 逐 channel authority 改为统一浏览器会话认证 | Host 自定义 Connection RPC | `DSH-0.1.2-A1-08` |
| alpha.1 只能从源码构建，同时保留 rc.2 用户 | dependency/CI | `R-01`、`R-02`、`R-04` |
| Web 验收不能由 Headless 或资源 200 代替 | Web acceptance | `DSH-0.1.2-A1-19` |

完整卡片见 [0.1.2-alpha.1 card set](../references/v0.1.2-alpha.1.md)，跨 cohort 规则见
[0.1.2 rollup](../references/rollup-0.1.2.md)。

## 为什么第一次“全绿”仍不能合并

初次适配完成了 client runtime 拆分、Workspace snapshot、locale/slot 和 Host RPC 新接口迁移，
并增加 alpha 源码 CI。该实现针对 alpha.1 的构建与当时测试链通过，但它删除了
`connection.rpc.handle(channel, handler, options)` 的第三个 authority 参数，并一并删除了
`remoteAccess` 配置。

这在 alpha.1 合理：目标实现的 `handle` 只有两个形参，所有 channel 都走统一的浏览器会话认证。
但 npm 安装基线仍是 rc.2；其真实实现直接读取 `options.authority`。用真实 rc.2
`HostConnectionService` 复现时，省略参数会在 Web Host 注册 route 前抛出：

```text
TypeError: Cannot read properties of undefined (reading 'authority')
```

原验证链漏掉它有两个原因：

1. RPC 单测使用的 mock 接受两参数调用，没有编码 rc.2 的必需 options 契约；
2. Headless profile 不提供 Web `connection`，所以真实 Headless 激活无法覆盖 Web RPC 注册。

固定一手来源：rc.2 的
[`HostConnectionRpc.handle`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/packages/client/connection/src/rpc.ts)
要求 options，且
[`HostConnectionService.register`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/packages/client/connection/src/rpc-host.ts)
读取 `options.authority`；alpha.1 的
[`HostConnectionRpc.handle`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/packages/client/connection/src/rpc.ts)
和
[`HostConnectionService`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/packages/client/connection/src/rpc-host.ts)
只消费前两个参数。

## 最终的单实现兼容策略

最终实现没有解析 DSH 版本、检查 `function.length` 或增加 capability 分支，而是使用两代真实
JavaScript 实现共同支持的调用超集：

- 总是传 rc.2 所需的 `{ authority }` 第三参数；
- rc.2 读取它，继续区分 `loopback` 与 `trusted-host`；
- alpha.1 的双参数实现按 JavaScript 语义忽略多余参数，并继续应用统一浏览器认证；
- `remoteAccess` 继续作为 rc.2 的启动期安全配置存在，不允许 Web 设置自行修改；alpha.1 接受该配置用于
  前进/回滚兼容，但不把它当作 alpha transport 的权限开关。

固定实现见
[`src/contracts.ts`](https://github.com/omdsh-dev/dsh-mnemon/blob/b50a504dbe738aa359cd6ef8e4fd790ed9c19a10/src/contracts.ts)、
[`src/rpc.ts`](https://github.com/omdsh-dev/dsh-mnemon/blob/b50a504dbe738aa359cd6ef8e4fd790ed9c19a10/src/rpc.ts) 和
[`src/settings.ts`](https://github.com/omdsh-dev/dsh-mnemon/blob/b50a504dbe738aa359cd6ef8e4fd790ed9c19a10/src/settings.ts)。
真实实现回归测试见
[`tests/dsh-connection-compat.spec.ts`](https://github.com/omdsh-dev/dsh-mnemon/blob/b50a504dbe738aa359cd6ef8e4fd790ed9c19a10/tests/dsh-connection-compat.spec.ts)。

这个策略只适用于已证明“多余参数被新实现安全忽略、旧语义仍由旧实现消费”的接口；若两代语义互斥，
仍应使用明确的 adapter/capability 分流，而不是为了无分支而隐藏差异。

## 可逆的 source overlay

插件的 `package.json` 和 lockfile 保持 rc.2 registry 基线。alpha.1 lane 在隔离 checkout 构建官方源码后，
仅把需要验证的 `@deepseek-ai/*` package 输出临时链接到 `node_modules`。链接脚本在任何写操作前：

1. 校验 DSH 根版本、每个 package name/version 和已构建的 `lib/`；
2. 记录所有原 registry symlink，并以独占方式写 restore record；
3. 全部预检通过后才替换链接；
4. 验证完成后逐项恢复并删除 restore record。

固定实现见
[`scripts/link-dsh-source.mjs`](https://github.com/omdsh-dev/dsh-mnemon/blob/b50a504dbe738aa359cd6ef8e4fd790ed9c19a10/scripts/link-dsh-source.mjs)。
这避免了把未发布 alpha 写进 lockfile，也避免链接一半失败后留下混合 cohort。

## 实际验证矩阵

| Lane | 实际执行 | 结果 |
|---|---|---|
| rc.2 本地 registry | 恢复 registry links 后执行 `pnpm run verify` | 49 个测试文件、524 项通过，1 项 Windows-only 跳过 |
| alpha.1 本地 source overlay | 官方 tag `build:lib` → link → 同一 `pnpm run verify` → restore | 同为 49 个测试文件、524 项通过，恢复后确认 rc.2 registry 状态 |
| 真实 Web 注册契约 | 当前 lane 的真实 `HostConnectionService` 注册 Mnemon route | 同一三参数调用在 rc.2 被消费、在 alpha.1 被忽略，route 均完成注册 |
| rc.2 CI | Ubuntu Node 22.19/24；Windows Node 24 的类型、定向集成、确定性构建与 package checks | 全部通过 |
| alpha.1 CI | Node 24 构建官方 tag、overlay package 输出、运行完整 verify | 通过 |
| verify 内部层 | typecheck、测试、两次确定性构建、真实隔离 Headless profile、package contents/public entries、publint、attw | 通过 |

对应时点在 dsh-mnemon 仓库中执行的核心流程为：

```sh
# rc.2 registry baseline
pnpm install --frozen-lockfile
pnpm run verify

# in an isolated official dsh-v0.1.2-alpha.1 checkout
pnpm install --frozen-lockfile
pnpm run build:lib

# back in dsh-mnemon at b50a504
DSH_SOURCE_ROOT=<absolute-alpha-checkout> pnpm run dsh:link-source
pnpm run verify
pnpm run dsh:restore-registry
pnpm run verify
```

## 已证明与未证明

**已证明**：同一插件源码、配置 schema 和 RPC 注册实现能在 rc.2 registry 与精确 alpha.1 source
package 输出下通过完整验证；rc.2 的旧权限语义被保留；overlay 可恢复；发布制品检查通过。

**未证明**：本次 PR 没有在两个 cohort 上安装同一个预先打好的 bit-identical tarball 后做完整产品浏览器
mount；没有覆盖真实 Provider/API 凭据；Windows lane 没有运行 Linux lane 的全部测试。真实 Connection 测试证明
Web route 注册契约，但不能替代 [DSH-0.1.2-A1-19](../references/v0.1.2-alpha.1.md) 要求的 token→Cookie、
boot manifest、bundle load、DOM marker 和 page-error 浏览器验收。

## Benchmark 转化与防泄漏边界

该事故已被提炼为可执行的 [H11-dual-cohort-rpc](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/benchmark/tasks/H11-dual-cohort-rpc/README.md)：
grader 会分别调用锁定的 rc.2 与 alpha.2 已发布 `HostConnectionService`，验证真实 route 注册、两种
`remoteAccess` 配置的 authority 向量，以及实现没有版本、arity 或失败重试分支。alpha.2 只在这个
固定的双参数 seam 上替代未发布的 alpha.1；这不表示两版整体等价。

本页已经包含答案，因此 H11 的 with-skill 评测必须挂载本贡献之前的固定 skill commit
`7d33bf4c492da250c94f48aebd29bb16877d7a36`，不能使用当前 skill 目录。任务 provenance 记录了
物化命令、多模型三次重复建议和未验证边界；本贡献不把尚未执行的模型分数写成结果。

## 可复用结论

1. 双 cohort 完成条件是“新目标通过且现有可安装基线不回归”，不是只让 source preview 编译。
2. Mock 必须编码旧版真实的必需参数；Headless 通过不能证明 Web 注册通过。
3. 被新 Host 忽略的旧配置不应自动删除；只要旧 cohort 仍受支持，它的安全语义仍是产品契约。
4. 无分支兼容优先寻找经过真实实现验证的调用超集；不能从 TypeScript 签名相似直接推断。
5. 未发布 cohort 应使用原子、可逆的 source/package overlay，保持发布 lockfile 可安装。
6. 报告要分开说明 Host、Web Client、Headless 和 packed artifact 各自证明了什么。
