---
name: dsh-plugin-development
description: 开发、维护和验证 DeepSeek Harness (DSH) 插件的执行型 Skill。覆盖 host/client 形态判断、最小 bundle 契约、Web UI 接缝、构建与独立验证。不要求本地拥有 DSH 源码；遇到版本疑问时从当前项目、已安装包和公开参考实现取证。
metadata:
  version: "2.0.0"
  date: "2026-08-12"
  reference: "https://github.com/NanmiCoder/dsh-agent-teams"
---

# DSH 插件开发

这是执行清单，不是完整教材。先判断形态，再实现，最后验证。详细背景只在需要时读取仓库文档。

## 1. 开始前

1. 用 `pwd`、`git rev-parse --show-toplevel` 确认项目和工作区改动。
2. 读取 `package.json`、`cordis.patch.yml`、`tsconfig*.json`、`tsdown.config.ts` 和相关 `src/`。
3. 不覆盖用户已有改动，不操作用户明确排除的实例。
4. 选择最小运行面：
   - 工具、prompt、HTTP、持久化：host。
   - slot、Conversation Node、浮层：client。
   - 工具且 Web 可视化：host + client。
   - 没有 Web 需求：不要添加 client bundle。

## 2. 证据规则

不要求用户拥有 DSH 源码，也不要写死本机路径。按顺序取证：

1. 当前项目实现、测试及 `node_modules/@deepseek-ai/*` 的 exports/types/README。
2. 当前仓库中的 `dsh-agent-teams` 参考实现。
3. 仅当参考仓库**已经公开且网络可访问**时，查看：
   `https://github.com/NanmiCoder/dsh-agent-teams`。
4. 只有环境明确提供 DSH checkout 时，才进一步读取源码。

slot、manifest、HMR、Context service 或版本行为不确定时，spawn 只读 subagent：

```text
只读调研，不修改文件。先检查当前项目和已安装 @deepseek-ai 包；
信息不足时，只有在参考仓库已公开且可访问的前提下，才研究
https://github.com/NanmiCoder/dsh-agent-teams。
不要访问、转述或公开未公开的私有仓库内容。
给出证据文件/行区间、版本差异和最小建议，不推测未验证行为。
```

若仍无证据，以公开 exports/types 为边界，标注假设并选择可安全退化的实现。

## 3. 最小 bundle 契约

双运行面项目通常包含：

```text
package.json  cordis.patch.yml  tsconfig.json  tsconfig.client.json
 tsdown.config.ts  src/index.ts  src/client/index.tsx  scripts/verify.mjs
```

client 插件的关键 `package.json` 形态：

```jsonc
{
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": [] }
  }
}
```

- 无 client 面时删除 `./client` 和 `dsh.client`。
- 当前权威字段是 `dsh.client`；不要默认添加旧的顶层 `dshClient`。
- exports 必须指向真实产物；发布 files 包含 `lib`、patch、README 和所需 assets。
- DSH/React 运行时依赖优先声明为 peer，避免复制 runtime identity。
- 内测 rc 通道：peer 范围要写成 rc 通道（如 `^0.0.1-rc.1`），普通 `^0.0.1` 不匹配 `0.0.1-rc.x`。

`cordis.patch.yml` 必须是顶层数组：

```yaml
- insert:
    - id: my-plugin
      name: dsh-my-plugin
      config: {}
```

## 4. 实现红线

### TypeScript 与构建

- host/client 使用两个 tsc program，避免 Context augmentation 冲突。
- JSX 文件使用 `.tsx`；相对 TS import 需正确重写为 emitted JS。
- client bundle 优先复用本仓库 `tsdown.config.ts`，修改入口和 plugin id，不手写 loader 协议。
- 保留平台 external、purity gate、CSS Modules 注入、source path 回退和 sourcemap。

### Host

- 导出 `name`、`inject`、`Config`、`apply`；`inject` 声明所需 service。
- 工具使用 `ctx.tools.register(defineTool(...))`，描述写清使用时机、输入和失败方式。
- 兄弟 provider 在第一次实际使用时校验，不在 `apply()` 阶段抢跑。
- route、listener、timer、DOM 都要 effect-owned 并返回 disposer。
- JSON route 使用 `no-store`；静态资源走白名单；状态读改写加 workspace/owner 维度的锁。
- 过渡期服务键兼容：服务被重命名（如 `httpServer`→`webServer`、`workspace`→`workspaceRegistry`）时，用结构化最小接口做新键优先、旧键回退，并同时监听两组的 `internal/service` 事件，不要硬绑定单一键名。

### 事件与历史

- 共享事件文件只放类型；Conversation Node 必须可确定性重放。
- 事件写入业务 owner 会话。
- 可重复业务 id 的历史 key 使用 `ownerSessionId:businessId`；restore/dedup 同维度匹配。

## 5. Web UI

先从已安装类型确认 slot。常见接缝：

- `conversation.session.header.actions`
- `conversation.chat.node`
- `conversation.input.dock` / `conversation.composer.dock`
- `conversation.input.left/right`

能用语义正确的 slot 就不用 fixed portal。全局角落确无 slot 时才 body portal，并保证 React root、DOM、监听和全局 attribute 可清理。

portal 面板还应：

- 订阅 session list，按当前 owner 过滤；导航时立即收起。
- 宽屏让主对话列礼让，窄屏退回 overlay；只依赖稳定 `data-*`。
- 轮询使用 `no-store`、in-flight guard、形状校验和 unmount 防护；失败时保留最后成功快照。
- 关系投影使用纯函数、稳定排序且 cycle-safe。
- hover/focus 只 preview，click pin；支持 `aria-pressed`、`Escape`、`:focus-visible` 和 reduced motion。

## 6. 生效边界

- `dsh plugin --profile <profile> add <pkg>` 改变 profile manifest，之后重启该 profile。
- 用户 patch 的配置/行可走 config HMR，但不要假设 package roster 同步改变。
- client HMR 需要 watcher 持续重建 `lib/client.js`；否则 build 后刷新已有 DSH 页面。
- host、package manifest、exports、profile bundles 改动需要重启。
- 不启动独立 Vite server 替代 DSH GUI；Web shell 需要 `window.__DSH_BOOT__`。

## 7. 验证

按顺序运行：

```sh
pnpm typecheck
pnpm build
pnpm verify
git diff --check
```

然后按需求增加：

1. 组合：独立 scratch profile 执行 `dsh --profile <scratch> --dump-config`。
2. 真实任务：`dsh --profile headless "一个小而可判定的插件任务"`；没有 `dsh run` 子命令。
3. GUI：独立 web profile/端口，用真实浏览器验证名册、路由、交互、宽窄屏和无障碍。
4. 从零安装：全新 profile 走 `npx -p @deepseek-ai/dsh dsh plugin --profile <name> add <本地路径|git 地址>`，再启动独立端口实例，确认名册、插件路由与面板闭环——保证用户照着 README 能装。

纪律：

- 不触碰用户排除的实例，连健康检查也不做。
- server 用 managed background task 并保存 task id；不用宽泛 `pkill -f`。
- 只删除本任务创建的精确临时路径。
- commit、push、发布和 visibility 变更必须有用户明确授权。
- 研究参考仓库不要求、也不得修改其可见性。

## 8. 按需文档与完成标准

从 Git 仓库根目录按需读取，不要一次全部加载：

- `docs/developing-dsh-plugins.md`：原理和踩坑。
- `docs/verification-guide.md`：完整验证与浏览器探针。
- `docs/readme-writing-guide.md`：README 规范。
- `docs/usage.md`：参考插件用户契约。

完成时确认：运行面最小；资源均可清理；版本假设有证据；离线验证通过；需要 GUI 时已用独立实例验证；没有公开私有代码或执行未授权操作。
