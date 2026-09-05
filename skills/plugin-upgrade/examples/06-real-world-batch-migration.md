# 示例 06：六个真实插件的批量迁移实录（0.1.1-rc.1 → 0.1.2-alpha.1）

简体中文 | [English](06-real-world-batch-migration.en.md)

**场景**: 6 个已发布的 Web UI 插件（像素宠物 / 进度条 / 输入历史 / 小游戏合集 / 粘贴输入 / 文件追踪）从 `dsh-v0.1.1-rc.1` 批量迁移到 `dsh-v0.1.2-alpha.1`。三种典型形态都覆盖到了：读快照 + 注册 slot 的重灾型、自包含 DOM 的零成本型、仅需清理声明的微小型。

**影响触点**: #3 客户端导入（`dsh-client-runtime` 移除）、快照读取（`ConversationSnapshot` → views）、slot 注册（`ctx.slots.inject`）、`package.json` 的 `dsh.client.inject` 声明

**复杂度**: ⭐⭐⭐

**运行平面**: Web Client 为主（类型导入 / 快照读取 / slot 注册 / 打包声明）；无 host API 迁移，仅附 host 半段生效方式的说明（见常见错误 6）

**素材来源**: 社区迁移实践（2026-08-28 完成迁移，实机 boot 验证 + 单测回归）——[deepseek-harness discussion #5120](https://github.com/deepseek-ai/deepseek-harness/discussions/5120#discussioncomment-18208001)，六个插件仓库见文末。

> 走廊覆盖说明: 走廊现已覆盖 `dsh-v0.1.1-rc.1 → dsh-v0.1.2-alpha.2`（本示例写作时 rc.1 → rc.2 段尚无卡片，后由 [v0.1.1-rc.2.md](../references/v0.1.1-rc.2.md) 补齐，3 张卡，`DSH-0.1.1-R2` 前缀）。文中 client-runtime 移除、`ctx.slots.inject`、`views.get('chat')?.legacy` 等技术声明写作时为本示例一手来源；同一批插件后续跟随 0.1.2 列车至 rc.1 的零代码追车记录见文末「后续」一节；主题最接近的现有卡片为 DSH-0.1.2-A1-03 · 会话视图工程大幅拆分。

---

## 迁移结果总览

| 插件 | 形态 | 迁移量级 | 实际改动 |
|---|---|---|---|
| dsh-ui-whale v0.3.4→v0.3.5 | 读快照 + slot | 中 | 8 文件 +141/−99：类型导入、`legacy` 投影、slot 注册 |
| dsh-ui-progress v0.9.3→v0.9.4 | 读快照 + slot | 中 | 同上 + 回合结束判定改走新时间线 |
| dsh-input-history v0.1.3→v0.1.4 | 读快照 | 中 | 快照字段迁 `legacy` |
| dsh-minigames v0.3.5→v0.3.7 | 自包含 body portal | ≈0 | 仅重跑 203 个单测 + 实机验证 |
| dsh-paste-input v0.1.5→v0.1.6 | vanilla lib（无 src） | 小 | 清理 `dsh.client.inject` 里已删除的 `dsh-client-runtime` 声明 |
| dsh-file-trace | 直接基于 0.1.2 新写 | — | 可作 0.1.2 新 API 正面样例 |

**先判断插件类型再动手**：自包含 DOM 插件基本零成本，别照着重灾型流程走冤枉路。

---

## 升级前

```typescript
// src/client/index.ts（0.1.1-rc.1）
import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'

export function apply(ctx: ClientContext): void {
  ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'whale', order: 10 },
    WhalePet,
  )
}
```

```typescript
// WhalePet.tsx —— 旧平铺快照字段
const { nodes, partial, runningCalls, turnEnds } = conversationSnapshot
```

```json
// package.json
{
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["dsh-client-runtime", "dsh-client-ui-chat"]
    }
  },
  "devDependencies": {
    "@deepseek-ai/dsh-client-runtime": "link:../.dsh/source/0811/packages/client/runtime"
  }
}
```

---

## 升级后

```typescript
// src/client/index.ts（0.1.2-alpha.1）
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// ctx.slots 类型来自 renderer 包——记得把它加进 devDependencies
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'whale', order: 10 },
    WhalePet,
  ))
}
```

```typescript
// WhalePet.tsx —— 先整体迁到 legacy 兼容投影（两步走的第一步）
const chat = conversationSnapshot.views.get('chat')
const { nodes, partial, runningCalls } = chat?.legacy ?? EMPTY_PROJECTION
// 回合时间线在新位置：chat?.timeline；生命周期字段（running 等）改经 useSession 座读取
```

```json
// package.json —— inject 清掉已删除的包，devDeps 换 link 指向
{
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["dsh-client-ui-chat"]
    }
  },
  "devDependencies": {
    "@deepseek-ai/dsh-client-ui-renderer": "link:../.dsh/source/current/packages/client/ui-renderer"
  }
}
```

---

## 迁移步骤

1. **环境**：0.1.2-alpha.1 不在 npm（latest 是 0.1.1-rc.2），需源码 checkout + `pnpm install && pnpm run build`；`~/.dsh/source/current` junction 指向源码 checkout，插件 devDeps 统一 link 过去。动手前备份 `~/.dsh`。
2. **全局替换类型导入**：`dsh-client-runtime/client` → `@deepseek-ai/cordis`；删 `dsh.client.inject` 与 devDependencies 里的旧声明（漏删启动直接报服务缺失）。
3. **快照读取改 views**：旧平铺字段全部经 `views.get('chat')?.legacy` 投影读——先全量迁 legacy 保证能跑，稳定后再逐字段迁 views/timeline。
4. **生命周期拆分**：`running` 等改走 `useSession` 座；组件 props 用 `useSession` + `useConversation` 双座。
5. slot 注册改 `ctx.slots.inject(name, () => ctx.slots.register(...))`；`ctx.slots` 类型需引入 `@deepseek-ai/dsh-client-ui-renderer/client`。
6. `pnpm run clean && pnpm run build && pnpm run typecheck && pnpm run test`——必须 clean，见常见错误 1。
7. **实机验证**：`dsh --profile web` + 浏览器硬刷新；host 半段有改动必须重启 dsh（client 硬刷新即可）。通过后在 README 声明兼容矩阵（旧行保留、标注对应 DSH 版本）并发新 tag。

---

## 验证

```sh
# 残留引用检查
grep -r "dsh-client-runtime" src/ package.json
# 预期：无输出（vanilla lib 插件还要 grep lib/）

# 干净构建 + 全量检查
pnpm run clean && pnpm run build && pnpm run typecheck && pnpm run test

# 实机 boot 组合验证：dsh --profile web 起来后硬刷新，
# 逐项确认插件 UI 正常渲染、快照数据（流式/工具状态）有值、slot 位置正确
```

本次实录的验证记录：6 个插件同日实机 boot 验证通过；minigames 203 个单测全绿；whale/progress 各 34/39 个单测全绿。

---

## 常见错误

### 错误 1: typecheck 报不相干的老错误（如 `MISSING_EXPORT resolveSessionPreset`）

**原因**: 增量 tsbuildinfo 假阳性——改了源码但类型检查被旧缓存骗过。

**解决**: `pnpm run clean` 后重新 build。迁移期间每次验证前都 clean 一次。

### 错误 2: 启动报服务缺失，但代码里根本没引用 `dsh-client-runtime`

**原因**: `package.json` 的 `dsh.client.inject` 残留旧声明。

**解决**: grep package.json 而不只是 src/。

### 错误 3: 构建期报「Did you mean {'>'}」类诡异解析错

**原因**: oxc/vite 解析器比 tsc 严格——未闭合标签、跨行三元 + 箭头函数都会炸。

**解决**: 按解析器提示回炉重写该表达式（预计算变量、拆语句），别绕。

### 错误 4: 测试文件迁移后编译失败

**原因**: 0.1.2 里 fiber 的 `dispose` 变 readonly（测试不能再赋值模拟）；测试文件里 `as` 断言在 JSX 解析路径上不支持。

**解决**: readonly 字段改间接观察；`as` 改变量预收窄。

### 错误 5: 新环境装插件报 node-pty 等构建脚本被拒

**原因**: pnpm 11 默认拦截依赖构建脚本。

**解决**: 在 profile 目录 `pnpm approve-builds --all`（建议写进插件 README）。

### 错误 6: 改完代码刷新页面没变化 / host 行为像旧版

**原因**: client 半段硬刷新即生效，host 半段必须重启 dsh。

**解决**: 判断改动落点：进了 `lib/index.js`（host）→ 重启；只进 `lib/client.js` → 硬刷新。

---

## 附：alpha 阶段的健壮性建议

给 client `apply` 包一层兼容自诊断（检查 `ctx.slots.inject` / `ctx.locale.register` 等关键能力，缺失时渲染修复指引横幅而非抛异常）。alpha 阶段 DSH 与插件版本错配频繁，这层兜底能把「黑屏崩溃」变成「一条可读的升级提示」，本次 6 个插件全部内置。

## 后续：跟随 0.1.2 列车到 rc.1（2026-09-04）

alpha.1 落地后，DSH 又相继发布 alpha.2 / alpha.3 / alpha.4 / alpha.5 / rc.1，同一批六个插件逐边跟进，最终全部声明兼容 `dsh-v0.1.2-alpha.1`~`alpha.5`、`rc.1`。这段「追列车」的经历与本例开头的迁移风暴正好互补：迁移的核心是判断改什么，追车的核心是**确认什么都不用改之后仍然按流程验证发布**。

### 结果：本批插件在 alpha.1 之后无需兼容性源码改动

| DSH 边 | 插件侧源码改动 | 发布动作 |
|---|---|---|
| alpha.2 / alpha.3 | 无（alpha.2 的 peer 清理（A2-03）等卡片不要求本批插件迁移；alpha.3 有 [A3-01 设置卡片能力](../references/v0.1.2-alpha.3.md)，属可选新增，本批无需采用） | 兼容区间直接扩到 `~alpha.3`，随功能版本一起发 |
| alpha.4 | 无（A4 破坏性卡片集中在 host/SDK 面：`send_message`、`Session.events`→`seq` 等） | 按插件形态完成验证（见下文流程）后各发一个「声明支持」patch 版 |
| alpha.5 | 无（含宿主 bug 修复及 [A5-01 / A5-02 存储域新增能力](../references/v0.1.2-alpha.5.md)，如 `compatibleVersions`、`invalidRecords`；均不要求本批插件迁移） | 同上 |
| rc.1 | 无（252 文件全是版本号提交，见 [v0.1.2-rc.1.md](../references/v0.1.2-rc.1.md)） | 同上 + 实机 rc.1 boot 验证（Windows） |

各插件终态（README 兼容矩阵可查）：whale v0.3.13 / progress v0.9.12 / input-history v0.1.8 / minigames v0.3.14 / paste-input v0.1.18 / file-trace v0.3.1。

### 每条边的「声明支持」例行流程

1. 读该边走廊卡，确认本批插件没有必须迁移的触点（client UI 插件重点看 client / renderer / inject 面；可选新增能力单独判断是否采用）。
2. 宿主源码 checkout 切到目标 tag，安装依赖并重构建；确认插件的源码依赖链接也指向该目标，再开始插件构建和验证。
3. bump patch；README 兼容矩阵**追加一行**（旧行保留、标注对应 DSH 版本区间，验证结果待完成后填写）；安装提示词里的 tag 路由同步更新（见 plugin-release references 的 §8 版本路由与 §10 更新提示词自足性）。
4. 按插件形态执行最终验证：有源码构建脚本的插件在版本号、提示词更新后运行 `pnpm run build && pnpm run typecheck && pnpm run test`（增量缓存按项目清理流程处理，见常见错误 1）；paste-input 直接维护 `lib/`，没有这些脚本，改跑 `node --check lib/index.js && node --check lib/client.js`，并核对产物中的版本常量和更新提示词。
5. 核对最终 `lib/client.js` 中的版本常量、提示词 tag 与待发布版本一致；重启目标宿主 + 浏览器硬刷新，实机验证这批最终产物（client/host 半段生效方式区别见常见错误 6）。验证通过后填写兼容矩阵的实际结果。
6. 提交版本号、提示词、最终产物和文档 → 打 tag → 推全部镜像 → **逐镜像核验远端 SHA 与 tag 指向**（§9：文档引用的每个 tag 必须存在于每个镜像）。

### 追列车新踩的坑（本例原文未覆盖）

- **版本常量在构建期烧录**：插件源码里 `import pkg from '../../package.json'` 取到的版本号会随打包**烧进 `lib/client.js`**。只 bump `package.json` 而不重新构建就发 tag，tag 内容自相矛盾——内置更新提示拿产物里的旧版本号对比远端新 tag，装了最新版也永远提示「可更新」。必须先更新版本号和提示词，再重新构建；发 tag 前核对产物中的版本常量与提示词 tag，并将最终产物一并提交。
- **dist-tag 漂移**：追车期间 umbrella 包 npm `latest` 从 `0.1.1-rc.2` 漂到 `0.1.2-rc.1`（2026-09-04 实测），不带版本的 `npm i -g @deepseek-ai/dsh` 装到的内容随时间变化——验证环境必须**钉精确版本**（rc.1 走廊卡的 npm channels 小节有逐 tag 实测记录）。
- **纯版本号边不能跳过验证**：rc.1 这类上游零差异边最容易直接声明兼容——仍然要按插件形态完成验证：源码插件跑 build/typecheck/test，直接维护 lib 的插件做产物语法与内容检查，两类都要实机 boot（本批实机验证在 dsh-v0.1.2-rc.1 + Windows 通过）。

## 插件仓库

- https://github.com/lhh010/dsh-ui-whale （v0.3.5 完成迁移）
- https://github.com/lhh010/dsh-ui-progress （v0.9.4）
- https://github.com/lhh010/dsh-input-history （v0.1.4）
- https://github.com/lhh010/dsh-minigames （v0.3.7）
- https://github.com/lhh010/dsh-paste-input （v0.1.6）
- https://github.com/lhh010/dsh-file-trace （基于 0.1.2-alpha.1 新写）

截至 2026-09-04，六插件均已声明兼容 `dsh-v0.1.2-rc.1`（终态版本见「后续」一节）。
