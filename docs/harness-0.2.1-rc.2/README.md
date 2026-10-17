# Harness 0.2.1-rc.2 适配

目标为已发布的 `0.2.1-rc.2`，对照基线为插件上一推荐宿主 `0.2.1-rc.1`。插件起点为
`6768de25aede12056a497b0a79ebf6cd8bb1e987` / `0.1.24-rc.1`，适配版本为 `0.1.25-rc.1`。
本次未修改任何参考仓库；差异全部来自 npm 官方 registry 的实际产物。

## 已核实的变化及处理

对插件依赖的 25 个 `@deepseek-ai` 包，分别下载 rc.1 与 rc.2 的 tarball 并解包后逐文件比较：

- 两个 cohort 各 760 个文件，文件集合完全相同，无新增、无删除。
- 其中 615 个 `.js` / `.d.ts` / `.mjs` / `.cjs` 文件**逐字节相同，差异数为 0**。
- 仅 21 个 `package.json` 不同，且差异只出现在 `version` 字段与把 `0.2.1-rc.1` 换成
  `0.2.1-rc.2` 的内部依赖/peer 版本串；`cordis ~4.0.5`、`schemastery ~3.18.5`、`zod 4.4.3`
  等第三方范围不变。

因此本宿主是 `0.2.1` 维护版本，插件消费的接口面没有任何变化：成员创建
（`startActivation` 与 continuable 回退）、host FIFO/steer 交付与 `sendMessage`、
`agent/created` 启动准入与旧 `agent/session-start` 兼容缝、定向子进程回收
（`drainChildren`）、`tools.view()` 可限制名与队长专用工具拒绝、子会话自有事件读取、
以及会话存储格式代次，全部保持原样。适配层 `src/harness-compat.ts` **无需修改**。

本次修改仅限版本元数据与可移植性：

- `compatibility.json`：推荐宿主改为 `0.2.1-rc.2`，`0.2.1-rc.1` 保留为 legacy。
- `package.json` / `pnpm-workspace.yaml`：peer 范围、devDependencies 与 303 条 pnpm
  overrides 全部锁定到 `0.2.1-rc.2`。
- `pnpm-lock.yaml`：重新解析，全仓库 `0.2.1-rc.1` 出现次数为 0，`0.2.1-rc.2` 为 6178 次。
- 新增 `.gitattributes`：见下节。

## Windows 构建产物可复现性

`scripts/git-artifacts.mjs` 通过哈希原始文件字节来证明已提交的 `lib/` 与构建结果一致。
仓库此前没有 `.gitattributes`，Windows 上 `core.autocrlf=true` 会把已跟踪文本文件写成 CRLF，
而提交进仓库的 stamp 来自上游 Linux 的 LF 文件，导致该检查在任何 Windows clone 上必然失败
（`Git artifacts are stale or modified`）。新增 `.gitattributes` 将已跟踪文本固定为 `eol=lf`，
摘要因此与平台无关。这是本机独立复现的问题，不改变产物内容语义。

## 验证与边界

- 改动前基线：`pnpm typecheck` 通过；`pnpm build` 与 `pnpm verify` 因上述 Windows 换行符问题失败，
  属**基线既有失败**，已按 `.gitattributes` 修复。
- 候选：`pnpm typecheck`、`pnpm build`、完整 `pnpm verify` 全部通过。
- 依赖闭包：顶层 27 个 `@deepseek-ai` 包，其中 25 个 `dsh-*` 全部为 `0.2.1-rc.2`，
  另有 `cordis 4.0.5` 与 `schemastery 3.18.5`；见[依赖闭包](cohort-0.2.1-rc.2.json)。

未验证真实模型服务、交互式浏览器、Electron 桌面安装、其他操作系统和真实用户数据迁移。
本记录只覆盖 `0.2.1-rc.1 → 0.2.1-rc.2` 这一条边，不代表对宿主全部新功能的全面审计。

重现命令：

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm build && pnpm verify
```
