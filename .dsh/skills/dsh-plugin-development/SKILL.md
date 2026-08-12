---
name: dsh-plugin-development
description: 从零开发一个 DeepSeek Harness (DSH) 插件的完整方法论——bundle 插件骨架（dsh.bundle + dsh.client 双运行面）、host/client 架构（工具/路由/事件 + slots/浏览器浮层/对话流节点）、client bundle 与 HMR 协议、安装、README 写作规范与分层验证（离线冒烟 / 真实 e2e / ego-browser GUI）。由 dsh-agent-teams 插件与当前 DSH 源码蒸馏。当用户要求"开发 DSH 插件 / DeepSeek Harness 插件 / dsh bundle / 给 DSH web 加面板或工具"时使用。
metadata:
  version: "1.1.0"
  date: "2026-08-12"
  source: "当前 dsh-agent-teams 仓库；DeepSeek Harness 源码 checkout（由使用者环境提供）"
---

# 开发一个 DeepSeek Harness (DSH) 插件

本 skill 教 coding agent 从零开发一个 DSH 插件，并把它做对、做完、验证完。以 `dsh-agent-teams`（多智能体团队协作插件：host 工具 + 右上角活动面板 + 对话流卡片 + 归档复盘）为完整样例，提炼出可复用的开发流程、README 规范与验证方法。

**参考代码**：
- 成品样例：当前仓库根目录（`package.json` / `cordis.patch.yml` / `tsconfig*.json` / `tsdown.config.ts` / `src/` / `scripts/verify.mjs` / `README.md`）
- DSH 源码仓库：使用者环境中的 DeepSeek Harness checkout；先按当前会话提供的 checkout 路径定位，再读取 `packages/workflow/tool-workflow`、`packages/client/tsdown.client.ts`、`packages/client/modules/src/index.ts`、`packages/client/ui-workflow-run` 等入口。不要写死个人绝对路径。

**三个章节**：一、开发流程（骨架/host/client/构建安装/踩坑）；二、README 规范；三、验证方法（四层金字塔）。先读第一章动手，写完 README 对照第二章，最后按第三章验证。

---

## 从零开发一个 DeepSeek Harness（DSH）插件

> 本文是 dsh-agent-teams 插件（host 工具 + 浏览器活动面板 + 对话流卡片）开发全过程的经验蒸馏。
> 覆盖 bundle 插件从骨架、host 面、client 面、构建安装到踩坑修复的完整流程，供 coding agent 直接照做。
> 参考实现：`dsh-agent-teams`（成品）、DSH 仓库 `packages/workflow/tool-workflow`（工具插件模板）、
> `packages/client/tsdown.client.ts`（client bundle 协议）、`packages/bundle/base|cordis.patch.yml`（host 组合）、
> `packages/client/modules/src/index.ts`（浏览器名册扫描）、`packages/client/ui-workflow-run`（对话流 UI 模板）。

## 0. 全景：一个 DSH bundle 插件是什么

一个可安装插件 = 一个 npm 包，同时扮演两个角色：

- **host 面**（Node）：包根的 `lib/index.js`，作为组合树里的一行插件挂载，注册工具、服务、HTTP 路由、会话事件。
- **client 面**（浏览器）：包子路径 `./client`（`lib/client.js`），被 `dsh-client-modules` 扫描进
  `window.__DSH_BOOT__` 名册，在浏览器里作为 cordis 插件跑 `apply(ctx)`，渲染 UI。

安装 = `dsh plugin --profile <profile> add <包路径或包名>`：pnpm 装进 profile，并把包加入
profile manifest 的 `dsh.profile.bundles` 层列表；bundle 的 `cordis.patch.yml` 作为补丁层把插件行插进组合树。
**plugin add 后需要重启该 profile**，因为 package manifest/bundles 层和 client package metadata 在进程内缓存；
但服务已启动后的用户 `cordis.patch.yml` 文件由 boot HMR 事务性重读，能够更新配置并挂载/移除 patch 行。

## 1. 插件形态与项目骨架

```
dsh-my-plugin/
├── package.json          # dsh.bundle + dsh.client + exports
├── cordis.patch.yml      # 向 host 组合插入插件行
├── tsconfig.json         # host 编译（排除 src/client）
├── tsconfig.client.json  # client 编译（jsx: react-jsx）
├── tsdown.config.ts      # client bundle 构建（复刻 tsdown.client.ts 协议）
├── src/
│   ├── index.ts          # host 入口：name/inject/Config/apply
│   ├── tools.ts          # 工具注册（可选，大插件拆文件）
│   ├── events.ts         # 会话事件写入（可选）
│   ├── event-types.ts    # 事件类型 + SessionEventMap 合并（零 import！）
│   ├── snapshot.ts       # host 侧数据组装（可选）
│   ├── state.ts          # 文件持久化（可选）
│   └── client/
│       ├── index.tsx     # 浏览器入口（必须是 .tsx 才能写 JSX！）
│       ├── XxxPanel.tsx  # UI 组件
│       ├── *.module.css
│       └── artwork.ts    # 共享纯逻辑（可选）
├── assets/               # 随包分发的静态资源（白名单路由服务）
└── scripts/verify.mjs    # 离线冒烟验证
```

### 1.1 package.json 要素（每个字段为什么存在）

```jsonc
{
  "name": "dsh-my-plugin",
  "type": "module",                          // ESM 全栈
  "main": "lib/index.js",                    // host 入口（tsc 产物）
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["lib", "assets", "cordis.patch.yml", "README.md"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },   // bundle 声明：patch 挂 host 行
    "client": { "inject": ["@deepseek-ai/dsh-client-runtime"], "platform": "web" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json && tsc -p tsconfig.client.json && tsdown",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit"
  }
}
```

- `exports["./client"]` 是名册扫描的硬要求：`client-modules` 读 `exports["./client"]` 找浏览器 bundle
  （`clientExportOf` 支持 string 或带 string `default` 的一层条件对象；`types` 仅供 TypeScript，不参与运行时解析），
  缺失直接拒绝该包。
- `dsh.bundle.patch` 让 `dsh plugin add` 的 reconcile 认出这是 bundle 并加入 bundles 层。
- `dsh.client` 是当前源码的唯一权威 client manifest；`platform` 必须是 `"web"`，`inject` 是包名依赖边。
  `client-modules` 会严格校验它与 `exports["./client"]`，并对包元数据（包括“不属于 client 插件”的负结论）
  做进程级缓存，因此新增/删除 client 声明后必须重启 host。历史 profile 如仍依赖顶层 `dshClient`，应先以
  目标部署源码实查后再做兼容声明，不要把双声明当成新插件模板。
- `peerDependencies`：host 侧依赖（`@deepseek-ai/dsh-tools`、`dsh-session`、`dsh-subagent`…）+ 浏览器侧
  （`@deepseek-ai/dsh-client-runtime`、`dsh-client-ui-slots`、`react`）全部 peer，运行时从 profile 的
  `node_modules`（healProfilesModuleFallback 扁平目录）解析，不重复安装。
- `files` 必须含 `lib`、`cordis.patch.yml`；有静态资源加 `assets/...`。

### 1.2 cordis.patch.yml：一行插件进组合

```yaml
# bundle 补丁：顶层 YAML 数组，insert 追加组合行
- insert:
    - id: my-plugin            # 行 id（全局唯一）
      name: dsh-my-plugin      # 包名（client-modules 按它解析 package.json）
      config:                  # 可选：传入插件的 Config
        someOption: value
```

要点：`name` 必须等于包名（名册扫描 `require.resolve('<name>/package.json')`）；行挂在 host 组合，
工具注册进全局 `tools` 注册表，因此该 profile 下所有会话可用，不需要 realm。

### 1.3 tsconfig：host 与 client 必须两个 program

```jsonc
// tsconfig.json —— host
{
  "compilerOptions": {
    "module": "NodeNext", "moduleResolution": "NodeNext",
    "lib": ["ES2022"], "strict": true, "noUncheckedIndexedAccess": true,
    "declaration": true, "declarationDir": "lib/types", "outDir": "lib", "rootDir": "src",
    "allowImportingTsExtensions": true, "rewriteRelativeImportExtensions": true,  // TS 5.7+，.ts 导入重写为 .js
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["src/client"]     // host program 绝不编译 client
}
```

```jsonc
// tsconfig.client.json —— client（extends host，覆盖）
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",          // 必须
    "types": []                  // 浏览器环境无 node 类型
  },
  "include": ["src/client", "src/event-types.ts", "src/css-modules.d.ts"],
  "exclude": []
}
```

为什么必须拆（详见 3.1）：host 侧 `dsh-session` 的 index 声明 `Context.sessions: SessionStore`，
浏览器侧 `dsh-client-runtime` 声明 `Context.sessions: ISessions`——同名成员类型冲突，同一 program
内二者必居其一（skipLibCheck 吞掉冲突后取先声明者）。拆开后 host program 只见 host 声明、
client program 只见浏览器声明，互不污染。

## 2. host 侧开发

### 2.1 函数插件四要素

DSH 的函数插件是命名导出 `name/inject/Config/apply`（无 default export）：

```ts
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// 声明合并 only：让 ctx.subagents / ctx.systemPrompt 等类型可见（见 2.3）
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'my-plugin'
export const inject = ['tools', 'subagents', 'systemPrompt', 'agents', 'httpServer', 'workspace']

export interface Config { stateDir?: string }
export const Config: z<Config> = z.object({ stateDir: z.string().default('.agent-teams') })

export function apply(ctx: Context, config: Config): void {
  // 注册工具、prompt section、HTTP 路由……全部在 apply 里
}
```

- `inject` 声明依赖的服务；`ctx.<name>` 只有在 inject 里声明的服务才可用。
- `Config` 用 `@deepseek-ai/schemastery` 的 `z.object` 描述，Loader 负责默认值。
- `import type {} from '<包>'` 是**声明合并触发器**：DSH 各包通过 `declare module '@deepseek-ai/cordis'`
  扩展 `Context`，必须把该包加载进 program 才能看见对应成员。

### 2.2 工具注册（defineTool，模板：tool-workflow）

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'

ctx.tools.register(defineTool({
  name: 'my_tool',
  description: '……模型看到的完整契约……',
  parameters: {
    arg: { type: 'string', required: true, description: '……' },
    status: { type: 'string', enum: ['a', 'b'], description: '……' },  // enum 让类型推断精确
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  },
  async execute(args, exec) {
    const caller = exec.agent            // 调用者 Agent（父会话归属、cwd、session）
    if (!caller) throw new Error('requires a calling agent')
    // ……业务逻辑，返回符合 output.schema 的 JSON 值……
    return { ok: true }
  },
}))
```

关键经验：
- `parameters` 是 DSL 属性描述对象（每个 key 一个 schema）；`output.schema` 是普通 JSON Schema。
- `exec.agent` 是调用者的 Agent：`agent.session.header.cwd` 是工作区（团队状态落盘位置）、
  `agent.session` 是可 append 事件的会话、`agent.id` 是会话 id。子代理编排（`subagents.startContinuable`
  等）都要求传 `parent: exec.agent`。
- 工具的 `description` 就是模型契约，写清楚"何时用/怎么用"；配合 `ctx.systemPrompt.section()`
  注册使用策略（tool-workflow 的做法：`order: 115` 附近）。

### 2.3 服务注入与"fail-loud 时机"

```ts
// 挂载时校验要小心：provider 注册是兄弟插件行的 effect（Loader 并发激活），
// 可能晚于你的 apply。不要在 apply 里校验 provider 存在——移到第一次真正使用的地方。
const provider = ctx.subagents.getProvider(config.memberProvider)   // ← 在 spawn 时做，不在 apply 做
```

`inject` 只等**服务**（service 已提供），不等**provider 注册**（同服务下的另一行插件的 effect）。
任何"依赖兄弟插件行为"的校验都必须延迟到首次使用（最早可解析点），否则并发激活下随机失败
（见踩坑 5.1）。

### 2.4 HTTP 路由（活动面板数据通道）

```ts
import { readFile } from 'node:fs/promises'

ctx.effect(() => ctx.httpServer.register({
  kind: 'exact',                       // 或 'prefix'
  path: '/plugins/my-plugin/state',
  handler: async (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ... }))
  },
}), 'my-plugin: state route')
```

- `httpServer.register` 返回 disposer，必须包在 `ctx.effect(..., 'label')` 里（HMR 安全）。
- 静态资源路由务必做**白名单**（防路径穿越）：`decodeURIComponent` 要包 try（畸形编码 404 而非 400），
  用 `split('/').pop()` 剥离路径后查 Set，再 `join`。
- 客户端轮询是外部插件可用的朴素数据通道；使用 `cache: 'no-store'`、in-flight 防重叠、响应形状校验、
  unmount/cancelled 防护，并在 host 暂时重启或请求失败时保留最后一份成功快照。仅在代码确实实现后才声称
  `document.hidden` 暂停；不要把计划中的优化写成已实现契约。

### 2.5 状态持久化（文件 + 进程内锁）

```ts
// 团队状态 = workspace 下 .agent-teams/<teamId>/team.json + inbox/*.jsonl
// 用 node:fs/promises 直接读写（插件自有簿记，不走沙箱 fs 服务；fs 服务无删除 API）
const locks = new Map<string, Promise<unknown>>()
export async function withTeamLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  locks.set(key, previous.then(() => gate))
  await previous
  try { return await fn() } finally { release() }
}
```

- 读-改-写必须串行化：同一进程内用 promise 链互斥（key 建议含 workspace，避免跨 workspace 同名串行）。
- 事件/模型可能绕过工具仪式（直接写文件），面板类 UI 应以磁盘为真相源（host 快照），
  而不是事件重放（事件用于对话流节点与审计）。

### 2.6 会话事件写入（对话流 UI 的数据源）

```ts
// event-types.ts —— 事件类型 + SessionEventMap 合并，必须零 import！
export interface AgentTeamsTeamCreatedData { readonly teamId: string; readonly name: string }
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap { 'my-plugin/team-created': AgentTeamsTeamCreatedData }
}
```

```ts
// events.ts —— 写入
import type { Session, SessionEventMap } from '@deepseek-ai/dsh-session/types'
session.append(type, data)   // type 必须已并入 SessionEventMap
```

- `SessionEventMap` 是 merge-extensible：`declare module '@deepseek-ai/dsh-session/types'` 合并即可，
  浏览器端 Conversation Node 会按 `seq` 确定性重放这些事件。
- **event-types.ts 必须零 import**：它同时被 host 与 client 两个 program 加载；一旦 import 了
  host 侧包（如 `dsh-session` 的 index），client program 的声明合并就被污染（见 3.1/5.3）。
- append 目标：把事件写进"队长会话"（而非调用者），成员操作也统一落回队长会话，保证单一监控面；
  队长不可达时回退调用者会话。`session.append` 会抛，包一层 try/warn 降级。

## 3. client 侧开发

### 3.1 为什么必须拆两个 tsc program

`dsh-session`（host）的 index 声明 `Context.sessions: SessionStore`；`dsh-client-runtime`（浏览器）
声明 `Context.sessions: ISessions`。二者都是 `declare module '@deepseek-ai/cordis' { interface Context }`
的同名成员，同一 program 内必然冲突（skipLibCheck 吞错后取先声明者，表现为 `ctx.sessions.open`
"Property 'open' does not exist on type 'SessionStore'"）。

拆开后的规则：

- host program：`include: ["src"]`，`exclude: ["src/client"]`；只链接 host 包类型。
- client program：`include: ["src/client", "src/event-types.ts", ...]`；**不能编译任何 import 了
  host 侧 index 的文件**（这就是 event-types 零 import 的原因；client 文件只 import 浏览器侧包和
  event-types 的类型）。
- `declare module '@deepseek-ai/dsh-session/types'` 的合并只需 `dsh-session/types` 子路径被加载
  （子路径文件不包含 host 的 Context 合并，安全）。

### 3.2 扩展名坑：`.tsx` 才能写 JSX

TS 只在 `.tsx` 文件里解析 JSX。插件入口一旦包含 `root.render(<XxxPanel .../>)`，
文件必须是 `src/client/index.tsx`（输出仍是 `lib/client/index.js`）。写成 `.ts` 会得到
成串的 `TS1005 '>' expected`，与配置无关，纯扩展名问题（见踩坑 5.4）。

### 3.3 client bundle 协议（tsdown，复刻 tsdown.client.ts）

浏览器加载的不是源码，而是 `/plugins/<id>/client.js`——一个 **CJS closure-factory**：

```js
window.__ModuleLoader__.load({
  id: "dsh-my-plugin",
  factory: (require) => { /* ... */ return module.exports }
})
```

`tsdown.config.ts` 关键配置（抄自仓库 `packages/client/tsdown.client.ts` 的 `clientConfig`）：

```ts
export default {
  name: 'dsh-my-plugin/client',
  entry: { client: 'lib/client/index.js' },   // tsc client program 产物
  outDir: 'lib', format: 'cjs', platform: 'browser',
  dts: false, sourcemap: true, clean: false,
  external: [...PLATFORM_MODULES, '@deepseek-ai/dsh-client-runtime/client'],
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), /* import.meta.env 同理 */ },
  noExternal: (id) => (EXTERNALS.includes(id) ? undefined : true),
  plugins: [
    // purity gate：@deepseek-ai 非 external/非内联安全包的值导入直接 build error
    // （跨插件值导入会内联重复实例或要模块表答不出的 specifier）
    { name: 'purity', resolveId(source) { /* @deepseek-ai 检查 */ } },
    // CSS Modules 内联：lightningcss 编译 + <style data-plugin> 注入 + class map
    { name: 'css-modules', resolveId(source, importer) { /* .module.css → 虚拟 id */ },
      async load(virtualId) { /* transform + 注入逻辑，sourceAssetPath 需 lib→src 映射（见 5.7） */ } },
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-my-plugin", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}
```

- `CLIENT_EXTERNALS` = 平台模块表（react、react-dom、react/jsx-runtime、@deepseek-ai/cordis、
  dsh-client-ui-slots、dsh-client-web-react、dsh-client-ui-primitives 等）+ 运行时 store 豁免
  `@deepseek-ai/dsh-client-runtime/client`。平台列表会演进，优先从目标 checkout 的
  `packages/client/web/src/platform.ts`/`tsdown.client.ts` 复制，不要长期维护手写快照。
- 浏览器端只能 import：平台模块（external）+ 类型（编译期擦除）+ 当前 preset 允许的内联安全包
  （`@deepseek-ai/dsh-(session|llm|tools|brand|host-apiproxy)`）；跨插件值协作走 cordis service。
- `dsh.client.inject` 是 package graph/prefetch/HMR 元数据，**不是 apply 顺序保证**。依赖 slot declaration 时
  用 `ctx.slots.inject(name, factory)` 等待 seat 出现；依赖 service 时仍以 client plugin 的 `export const inject`
  和 cordis fiber 注入为准。
- 依赖 `tsdown@0.22` + `lightningcss`，pnpm 安装即可。

### 3.4 选择正确的 UI 接缝：slot 优先，body portal 兜底

先读当前 `packages/client/ui-*/src/client/contract/slots.ts`，不要凭记忆判断“没有 slot”。当前对话界面已有
`conversation.session.header.actions`（会话头操作）、`conversation.input.dock`（输入框上方堆叠条）、
`conversation.composer.dock`、`conversation.input.left/right`、`conversation.chat.node` 等稳定接缝。
**能落入语义正确 slot 就优先注册 slot**；只有跨会话、固定在 shell 角落、且确实没有对应 seat 的全局面板，
才使用 body portal + fixed 定位。右上角全局活动监控就是后一类：

```tsx
// src/client/index.tsx
import { createRoot } from 'react-dom/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

export const inject = ['sessions']

export function apply(ctx: ClientContext): void {
  const host = document.createElement('div')
  host.dataset.myPluginHost = ''
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(<ActivityPanel openSession={(id: SessionId) => { ctx.sessions.open(id) }} />)
  ctx.effect(() => () => { root.unmount(); host.remove() }, 'my-plugin: panel')
}
```

- `ctx.sessions.list` 是 `ObservableSnapshot<SessionListState>`（含 `current` 当前会话 id）——
  浮层组件用 `useSyncExternalStore(sessionsList.subscribe, sessionsList.getSnapshot)` 订阅。
- portal host、React root、window/document 监听器、全局 attribute/class 都必须由 effect 清理；HMR 会真实卸载并重挂
  client fiber，残留 DOM、监听器或 `<style>` 会形成重复 UI。
- 数据轮询遵循 §2.4 的边界纪律；若面板有自动展开/宽限收起，显式建模“是否自动开过/是否曾有活动”，
  用户主动导航时同步收起，不要依赖轮询延迟。

#### 3.4.1 浮层与主工作区协作，而不是永远遮挡

固定浮层宽到会遮住 transcript/composer 时，桌面端可以让主对话列礼让空间；不要移动左侧导航，也不要依赖
CSS Modules 的 hash 类名：

```tsx
useEffect(() => {
  const root = document.documentElement
  if (open) root.setAttribute('data-my-plugin-panel-open', '')
  else root.removeAttribute('data-my-plugin-panel-open')
  return () => { root.removeAttribute('data-my-plugin-panel-open') }
}, [open])
```

```css
:global(html) {
  --my-panel-width: 388px;
  --my-panel-shift: calc(var(--my-panel-width) + 18px + 14px);
}
:global(html[data-my-plugin-panel-open]) :global([data-phase='active']) {
  box-sizing: border-box;
  padding-right: var(--my-panel-shift);
}
:global([data-phase='active']) {
  transition: padding-right 360ms cubic-bezier(.22, 1, .36, 1);
}
@media (max-width: 960px) {
  :global(html[data-my-plugin-panel-open]) :global([data-phase='active']) { padding-right: 0; }
}
@media (prefers-reduced-motion: reduce) {
  :global([data-phase='active']) { transition: none; }
}
```

`[data-phase='active']` 是当前 ConversationRoot 的稳定 data 属性；如果上游移除它，布局协作应安全退化成 overlay。
宽屏验证面板与 composer 的几何重叠为 0；窄屏保留 overlay，避免把主内容压到不可用。

#### 3.4.2 关系型活动 UI 与可访问交互

- 任务/成员关系不要只靠颜色：明确画出 captain→member 派工、task→dependent 阶段，并同时显示文字状态。
- 把拓扑投影拆为浏览器无关纯函数（按 depth 分阶段、上下游链计算），自然排序 id，非有限 depth 回退 0，
  遍历必须 cycle-safe；这样 `verify.mjs` 可直接 import `lib/client/*.js` 测试。
- hover 只能是预览；点击固定链路时单独维护 `pinnedId`，`aria-pressed` 只描述被固定的源节点，二次点击或
  `Escape` 取消。键盘 focus/blur 与 mouse enter/leave 行为对等。
- icon-only button 有 `aria-label`，关系区有 section label，装饰图用 `alt="" aria-hidden`，所有交互有
  `:focus-visible`，自主动画/过渡覆盖 `prefers-reduced-motion`。

### 3.5 对话流节点（Conversation Node，模板：ui-workflow-run）

对话流内嵌 UI = 注册一个 Conversation Node（浏览器端 cordis）：

```ts
// agent-teams-card-definition.ts
import type { ChatConversationViewNode, ConversationNodeContext,
  ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
// 声明合并的两个关键 type-only import（见 5.3）：
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'   // 加载 ChatNodeDataMap 模块
import type {} from '@deepseek-ai/dsh-session/types'                  // 加载 SessionEventMap 模块

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap { 'my-plugin': MyCardData }               // 渲染器 keyed 数据映射
}

export const myDefinition: ConversationNodeDefinition<MyState> = {
  kind: 'my-plugin',
  target: 'chat',
  match: (event) => { /* 从事件里提取稳定业务 id + start/update 角色 */ },
  start: (ctx, match) => { /* 首个事件建 state */ },
  update: (ctx, match) => { /* 按 seq 递增折叠 state；嵌套闭包内取 data 先提局部变量（见 5.5） */ },
  buildViewNode: (ctx) => ({ /* 投影最终数据 */ }),
}
```

```tsx
// index.tsx 注册
ctx.conversationEvents.register(myDefinition)
ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
  name: 'conversation.chat.node', key: 'my-plugin',
  inject: () => ({ openSession: (id) => ctx.sessions.open(id) }),
}, MyCardComponent))
```

- Conversation Node 是**事件流确定性重放**：`match` 挑事件、`start/update` 按 seq 折叠、`buildViewNode`
  投影——因此对话流节点天然支持"历史会话复盘"（旧日志重放即恢复）。
- 组件是普通 React 组件，props 四件套（`PropsRuntime<'conversation.chat.node','my-plugin'>` 等）。

## 4. 构建与安装

### 4.1 构建链

```sh
pnpm build   # tsc host → tsc client → tsdown（client.js）
```

- tsc 需要 **5.7+**：`rewriteRelativeImportExtensions` 让源码里的 `./x.ts` 导入在产物里重写为
  `.js`（否则 emit 报 TS5096/TS5023，见踩坑 5.6）。
- tsdown 输出 `lib/client.js`（CJS closure-factory）+ sourcemap；host 侧 tsc 产物直接可用
  （`lib/index.js` 等）。

### 4.2 开发期类型链接（在 DSH checkout 之外开发时）

DSH 包不在 npm registry 发布（pre-release），开发期把依赖符号链接进项目 node_modules：

```sh
mkdir -p node_modules/@deepseek-ai
ln -sfn /path/to/DSH/vendor/cordis           node_modules/@deepseek-ai/cordis
ln -sfn /path/to/DSH/packages/core/session   node_modules/@deepseek-ai/dsh-session
ln -sfn /path/to/DSH/packages/core/tools     node_modules/@deepseek-ai/dsh-tools
# ...以及你 import 的每个 dsh-* 包（host 侧链 checkout 的 packages/<group>/<pkg>）
```

注意两个陷阱：

- **必须链接到源码 checkout 的构建产物**（`packages/<pkg>/lib/types`），不要链到运行实例的
  staging 目录——staging 快照可能是旧构建（`declare module 'cordis'` 而非
  `'@deepseek-ai/cordis'`，声明合并不生效）。
- checkout 的 `lib` 可能过期（源码更新但未重建）——症状是类型缺失；此时补链或改用源码
  `paths` 映射。client 侧包同理。

### 4.3 安装到 profile

```sh
pnpm build
dsh plugin --profile web add /absolute/path/to/dsh-agent-teams   # 本地路径；npm 包名亦可
# 重启 dsh（web 或 headless）后生效
```

- `dsh plugin` 在 profile 目录跑 pnpm + 把带 `dsh.bundle` 声明的依赖 reconcile 进 bundles 层。
- 独立测试 profile 是安全的验证环境（不碰运行实例）：headless 模板自动初始化。

### 4.4 离线验证（不启动服务）

```sh
node scripts/verify.mjs   # 纯逻辑 + 文件持久化冒烟（临时目录自清理）
dsh --profile <scratch> --dump-config   # 验证组合树里出现插件行（离线，不 boot）
```

- 纯逻辑（状态机、依赖深度、fold、布局）提取成无 ctx 依赖的纯函数，verify 脚本直接 import
  `lib/*.js` 断言；`withTeamLock` 包裹的写路径在临时目录跑真实文件往返。

## 5. 踩坑清单（按开发顺序，全部实战遇到）

### 5.1 provider 注册晚于插件 mount

- **现象**：首次启动随机报 `no subagent provider "spawn" is registered`，headless 必现。
- **根因**：`subagent-spawn` 行的 provider 注册是兄弟插件 effect，Loader 并发激活下可能晚于你的
  `apply`；`inject` 只等服务（subagents service 存在），不等 provider。
- **解决**：不在 apply 校验 provider；在首次 `spawnMember` 时 `getProvider` 校验并抛可操作错误
  （"最早可解析点 fail-loud"）。

### 5.2 浏览器名册不收录插件（manifest / export / 构建产物）

- **现象**：`window.__DSH_BOOT__` 里没有条目，或 host 启动时报 client bundle composition error。
- **当前源码契约**：`packages/client/modules/src/index.ts` 读取 `package.json.dsh.client`，要求
  `platform: "web"`，并要求 `exports["./client"]` 是 string 或带 string `default` 的一层条件对象；
  bundle 文件缺失时会聚合报错并提示先 build。
- **缓存边界**：包元数据和负结论按 package name 缓存且不失效；新增/删除 `dsh.client`、修改 export、
  修正 manifest/export 后重启 host。用户 patch 文件里的增删行由 config HMR 处理；只有 package roster/bundles
  manifest 改动需要重启。`lib/client.js` 内容变化进入 client HMR 重建链。
- **兼容原则**：若必须支持旧部署，先读那个部署的 `client-modules` 源码/构建产物确认字段，再做兼容；
  不要默认给所有新插件添加非权威的顶层 `dshClient`。

### 5.3 `declare module` 合并不生效（TS2664 / 类型 union 不含你的事件）

- **现象**：`declare module '@deepseek-ai/dsh-session/types'` 合并后，`match(event)` 的
  `event.type` union 里没有你的事件；`declare module '@deepseek-ai/dsh-client-ui-conversation/client'`
  报 `TS2664: Invalid module name in augmentation`。
- **根因**：模块增强只对**已加载进 program** 的模块生效；纯 `declare module` 文件零 import 时
  目标模块从未被加载。
- **解决**：在合并文件顶部加 `import type {} from '<目标模块>'`（加载模块、编译期擦除、不进 bundle）。
  这也是 event-types.ts 必须零 import、但 definition 文件可以带 type-only import 的原因。

### 5.4 JSX 报成串语法错误

- **现象**：`root.render(<XxxPanel .../>)` 报 `TS1005 '>' expected` 等一长串，改 jsx 配置、换 tsc
  版本均无效。
- **根因**：入口文件是 `index.ts`——TS 只在 `.tsx` 里解析 JSX，`<` 被当小于号。
- **解决**：含 JSX 的文件一律 `.tsx`（`src/client/index.tsx`），输出名不变（tsc 输出 `.js`）。

### 5.5 嵌套闭包内判别联合窄化失效

- **现象**：`if (event.type === 'x') { ...arr.map(() => event.data.field) }` 报
  `Property 'field' does not exist`。
- **根因**：函数参数（`match`）的窄化在嵌套箭头函数（`.map` 回调）内不保留（TS 只对 const
  变量在闭包内保留窄化）。
- **解决**：守卫后先 `const field = match.event.data.field` 提取，闭包内用局部变量。

### 5.6 tsc emit 报 TS5096/TS5023

- **现象**：`typecheck`（--noEmit）通过，`tsc` emit 报
  `TS5096: allowImportingTsExtensions can only be used with noEmit` +
  `TS5023: unknown option rewriteRelativeImportExtensions`。
- **根因**：TypeScript 版本 < 5.7（`rewriteRelativeImportExtensions` 是 5.7 新增；旧版
  `allowImportingTsExtensions` 只允许 noEmit）。
- **解决**：`typescript@^5.9`（pnpm add -D typescript@^5.9.0）。另外 pnpm add 可能把链接的
  typescript 换成旧版，装完 `tsc --version` 确认。

### 5.7 tsdown CSS 报 ENOENT（module.css 找不到）

- **现象**：`ENOENT: no such file or directory, open './Xxx.module.css'`。
- **根因**：抄 tsdown.client.ts 时漏了 `sourceAssetPath` 的 lib→src 回退：tsc 产物在 `lib/client/`，
  但 css 源在 `src/client/`；仓库实现把 `lib/` 前缀重映射为 `src/`。
- **解决**：resolveId 找不到 emitted 路径时，把路径中的 `/lib/` 段替换为 `/src/` 再查一次。

### 5.8 其他实战备忘

- **轮询竞态**：1s setInterval + fetch 可能重叠乱序——in-flight 标志或序号，只应用最新。
- **响应形状校验**：`body.teams ?? []` 不够——`Array.isArray(body.teams)` 防 200 但形状异常时闪烁。
- **闭包内 setState 与事件监听**：window 事件监听器里读“最新 current”用 ref，并在 effect 中同步 ref；
  不要在 render 阶段写 ref，避免并发渲染的 aborted render 泄露值。
- **导航即收起**：点击跳转子会话时同步 `setOpen(false)`，不要等自动收起宽限（用户感知 1s 延迟）。
- **删除即归档**：复盘类数据（任务/依赖/消息）删除时归档（`archive/` 子目录），不要物理删除；
  归档目录由活动扫描排除，另开 `?archived=1` 查询。
- **会话跟随**：全局浮层必须按“当前会话”过滤（`SessionListState.current` + `captainSessionId`）；
  `current === undefined` 时不显示团队，避免初始加载泄漏其他会话活动。
- **历史数据使用复合身份**：业务 id 若来自可重复名称（如 sanitize 后的 team name）就不具备全局唯一性；
  historic/archived Map、restore match、live/historic dedup 必须以 `${ownerSessionId}:${businessId}` 为键。
  旧事件缺 owner 时，可在“卡片激活面板”的时刻用当前会话作为兼容归属，并立即固化该复合键。
- **异步卸载防护**：轮询、归档 fetch、timeout 和事件监听都要 cancelled/disposer；React 18 的卸载后
  setState 即使只是 no-op，也不应作为资源生命周期策略。

## 6. 验证金字塔（从快到慢）

1. `pnpm typecheck`（双 program）→ 2. `pnpm build` → 3. `node scripts/verify.mjs`（纯逻辑/文件往返）
   → 4. `dsh --profile <scratch> --dump-config`（组合树含插件行）→ 5. headless 真实任务
   （`dsh --profile headless "…"`，需 DEEPSEEK_API_KEY）→ 6. 独立 web 实例
   （`dsh --profile <web+插件> --patch <port>` + curl 探名册/路由）→ 7. ego-browser 驱动真实浏览器
   GUI 端到端（跑任务、DOM 探针断言面板/卡片/动画）。

验证全程使用**独立 profile/独立端口**，不触碰正在运行的实例。

---

## 二、README 写作规范



> 给 coding agent 写 DeepSeek Harness 插件 README 时照做的章节模板与写作规则。
> 提炼自 `dsh-agent-teams` 成品 README 的多轮迭代（功能/原理/UI/工具/安装/配置/使用/验证/限制全结构），并对照 DSH 仓库内包 README 的风格（`packages/preset`、`packages/bundle`、`packages/client/ui-workflow-run`：精炼、表格化）。

### 0. 语言与篇幅策略

- **独立插件项目**（面向安装用户，如 `dsh-agent-teams`）：中文为主，命令、工具名、标识符、字段名保留英文；解释性句子用中文。
- **DSH 仓库内包**（`packages/*/README.md`）：英文为主，一段话简介 + 分节 + 表格，每节不超过几段；仓库内 README 是给维护者/协作者的，不需要"安装/使用"教程。
- 本文模板两种场景同构：结构顺序不变，语言与详略按读者切换。
- 篇幅：独立插件 README 200–400 行封顶；超过说明某节在堆砌实现细节（见 §2 避免清单）。

### 1. 结构模板（一级标题顺序）

| 顺序 | 章节 | 写什么 | 不写什么 |
|---|---|---|---|
| 1 | 简介（标题下一段） | 一句话价值（安装后用户能做什么）+ 3–5 条核心特性（黑体关键词） | 版本历史、Roadmap、致谢 |
| 2 | `## 工作原理` | 能力接缝表格 + 数据流一句话 + 状态机一句话（见 §2） | 架构图、贴源码、实现细节堆砌 |
| 3 | `## Web UI`（如有） | 面板形态、挂载位置、交互要点、数据链路 | 每个 CSS 类、动画参数逐条 |
| 4 | `## 工具一览` | 表格：工具名 | 作用（一句话，含关键语义/边界） | 工具参数 schema 全量 |
| 5 | `## 安装` | 命令 + 生效时机（重启/HMR）+ 备选方式 | 构建链内部原理 |
| 6 | `## 配置` | 配置项表格 + 一段 YAML 示例 | 每个配置的源码出处 |
| 7 | `## 使用` | 一段话 + 1 条可直接复制的示例指令 | 完整对话脚本 |
| 8 | `## 验证` | 三层：0 真实已验记录 / 1 离线 / 2 端到端（见 §4） | 把"未验证"写成"已验证" |
| 9 | `## 已知限制` | 每条 = 现象 + 原因/影响 + 缓解（见 §5） | 自我批评、无缓解的抱怨 |
| 10 | `## License` | 许可证名 | — |

### 2. 工作原理怎么写

**开篇用能力接缝表格**（这是 DSH 插件的架构语言——一切皆插件、能力即接缝）：

```markdown
`<插件名>` 复用了 DSH 的能力接缝（capability seam）而不是重新发明：

| DSH 能力 | 插件用法 |
|---|---|
| `ctx.tools` 注册表 | 注册 N 个 `xxx_*` 工具（与 `tool-workflow` 同一注册路径） |
| `ctx.subagents.startContinuable()` | 创建成员：durable 可续聊子代理 |
| `ctx.systemPrompt.section()` | 注册使用策略提示段 |
| `ctx.httpServer.register()` | 提供面板数据路由 `/plugins/xxx/state` |
| 文件系统 | 状态持久化在 `<workspace>/.xxx/<id>/` |
```

- 表格列出**真正用到的能力**，每行"DSH 能力 → 插件用途"一句话；这是读者判断"这个插件怎么融入 DSH"的最快路径。
- 表格后补**数据流一句话**："工具执行 → 磁盘状态（真相源）→ host 快照路由 → 浮层轮询渲染。会话日志事件继续写入（重放/审计）。"（一个方向链，不要画 ASCII 大图。）
- **状态机一句话**："任务状态机：`pending → claimed → in_progress → completed | failed | cancelled`，状态迁移在白名单内校验。"（能一句话压缩的状态机绝不用多段。）
- 需要引用文件时只给**入口路径**（如 `src/snapshot.ts`），不贴代码。
- **避免**：架构图（ASCII/plantuml）、实现细节堆砌（锁、队列、重试策略）、重复仓库 AGENTS.md 已有的通用机制解释。

### 3. 安装与配置

**安装命令必须可复制**（绝对路径/明确 cd）：

```markdown
```sh
cd /path/to/<plugin>
pnpm build            # 产出 lib/
dsh plugin --profile web add /absolute/path/to/<plugin>
```
```

- 一句话说明安装后发生什么（`dsh plugin` 安装进 profile 并加入 `dsh.profile.bundles` 层列表；bundle patch 挂载主机组合行）。
- **必须写生效时机**："> 注意：`dsh plugin` 修改的是该 profile 的 `package.json`/manifest；**重启 dsh 服务后**插件才会加载。"
- 配置节用**表格 + 一段 YAML 示例**：

```markdown
| 字段 | 默认值 | 说明 |
|---|---|---|
| `stateDir` | `.agent-teams` | 状态目录名（工作区下） |
| `memberProvider` | `spawn` | 成员子代理 provider |
| `memberMaxDepth` | `1` | 成员再委派深度上限（`0` = 禁止） |
```

- **兼容性/部署差异放引用注释块**（可复用模式④），但必须以目标部署源码为证据：

```markdown
> 兼容性说明：本插件面向的 DSH checkout 以 package.json `dsh.client` +
> `exports["./client"]` 发现浏览器 bundle；若部署版本不同，请先核对其 client-modules 实现。
```

### 4. 验证章节规范（三层）

验证章节是插件 README 信任度的核心，必须**分层 + 诚实标注"已验/待验"**：

| 层 | 标题 | 内容 | 前置条件 |
|---|---|---|---|
| 0 | `### 0. 已在独立实例上真实验证` | 已真实跑通的验证清单（模型名、命令、产物证据），**每项都是发生过的事实** | 已实际执行过 |
| 1 | `### 1. 离线验证（不需要启动任何服务）` | 可复制的构建/冒烟/组合验证命令 | 无 |
| 2 | `### 2. 端到端验证（需要重启服务，请自行安排在合适时机）` | 给用户的 GUI/headless 验证步骤 | 用户安排时机 |

- **0 层记录清单模板**（照此粒度记录）：
  - headless profile 端到端：`dsh --profile headless "…"`（CLI 没有 `run` 子命令）
  - 落盘/日志验证：会话日志含完整事件流（列出事件名与次数，如 `team-created ×1, member-added ×2…`）
  - UI 加载链路：浏览器名册含插件、`GET /plugins/xxx/client.js → 200`、数据路由返回形状
  - GUI 端到端：驱动真实浏览器后的面板行为（自动展开、状态更新、收起），附截图路径
- **命令规范**：全部可直接复制（`cd /path/…` 开头、注释标注预期输出如"应看到 xxx 行"）；声明"不会触碰正在运行的 profile / 不 boot 服务"的验证要写明。
- **原则**：0 层只写真实发生过的；1 层是开发者的自检入口；2 层留给用户在自己实例上复现——三个层次缺一不可，混写会毁掉信任。

### 5. 已知限制怎么写

- 每条限制 = **现象 + 原因/影响 + 缓解**，一条 bullet 内说完。例：
  - "成员只有在收到消息（被唤醒）后才行动，没有常驻轮询；……队长离线时消息留在邮箱、待队长下次操作时投递。"（现象 → 影响 → 缓解路径）
  - "成员（模型）不总是严格走工具'仪式'（如完成时不调 `update_task`）——面板如实反映事件流，可能与磁盘真相有短暂偏差；队长以 `agent_teams_status`/文件为准汇总。"
- **为什么重要**：限制节是"行为契约的负空间"——它提前回答用户必然遇到的问题（"为什么任务显示还没完成？"），防止把设计取舍误读成 bug；也是后续迭代的 TODO 清单来源。
- 写**真实限制**而非套话：设计取舍（文件级持久化、单队长单团队）、环境依赖（slot 不覆盖全局角落时
  portal 自管几何；宽屏可与主列协作让位，窄屏仍 overlay）、模型行为（不守仪式）、边界（旧会话无历史事件）。
- 每条给**缓解或指引**（"以 status 为准""待队长下次操作投递"），不写无解的抱怨。

### 6. 五条可复用模式（自 `dsh-agent-teams` 提炼）

1. **能力接缝表开篇**：架构解释永远从"DSH 能力 | 插件用法"表格开始——比任何叙述都快地建立"它怎么融入 DSH"的心智模型。
2. **验证命令全部可复制**：`cd /path/to/…` + 绝对路径 + 注释标注预期输出；用户可以直接粘贴执行，而不是"看图理解"。
3. **兼容性/部署差异用引用注释块**（`> 兼容性说明：…`）：把"为什么 package.json 有两个字段""为什么需要重启"这类一次性背景从正文隔离，正文保持干净。
4. **状态机与数据流用一句话压缩**：状态流转一行写完、数据链路一个箭头链写完——能一句话表达的状态机绝不用多段，需要展开的细节放代码/文件引用。
5. **"真实已验"放在验证章节最前并诚实分级**：0 层（我已验证，带证据）→ 1 层（离线自检）→ 2 层（你来自测）——信任来自分清"我跑过"与"你去跑"。

### 7. 完成检查清单

- [ ] 简介一句话回答了"装了这个插件用户能做什么"
- [ ] 工作原理以能力接缝表格开头，数据流/状态机各一句话
- [ ] 安装命令可直接复制，且写明了生效时机（重启）
- [ ] 配置有字段/默认值/说明表格
- [ ] 验证分三层，0 层只含真实发生过的验证（带命令与证据）
- [ ] 已知限制每条含缓解路径
- [ ] 没有贴源码、没有架构大图、没有把实现细节当卖点

---

## 三、验证方法（四层金字塔）

## 验证 DSH 插件真的可用（实战方法）

> 本文从 dsh-agent-teams 插件（多智能体团队协作 + Web UI 活动面板）的完整验证历程蒸馏而来。
> 全部命令都真实执行过；每一层都踩过坑，坑已标注在对应步骤。原则：**不碰正在运行的实例，验证在独立 profile / 独立端口 / 临时目录上进行，测完清理**。

### 验证金字塔总览

自底向上四层，每层通过再进下一层；任何一层失败都要先修再继续：

1. **离线**：双 program typecheck + 构建 + 冒烟脚本（纯逻辑、临时目录、自清理）
2. **组合**：`dsh --profile <scratch> --dump-config` 验证 bundle 补丁能组合进配置树（不 boot、不碰实例）
3. **真实端到端**：独立 headless profile + 真实 LLM 任务 + 落盘/事件检查
4. **GUI**：独立 web 实例 + ego-browser 驱动真实浏览器（名册 → 路由 → DOM 探针 → 截图）

---

### 1. 离线验证

#### 1.1 双 program typecheck

DSH 插件往往同时有 **host 侧**（Node：工具、路由）与**浏览器侧**（React 组件、Conversation Node）。两边会拉进互相冲突的类型声明（典型：host 侧 `dsh-session` 的 index 声明 `Context.sessions: SessionStore`，与浏览器 runtime 的 `ISessions` 同名冲突），**必须拆成两个独立 tsc program**：

```jsonc
// tsconfig.json（host）：include src，exclude ["src/client"]
// tsconfig.client.json：extends ./tsconfig.json + jsx react-jsx + lib DOM + types []
//     include ["src/client", "src/event-types.ts", "src/css-modules.d.ts"]
```

```sh
tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit   # 两个都要 0 错误
```

坑（都真实踩过）：
- **`.ts` 文件不解析 JSX**：客户端入口含 JSX 必须命名为 `index.tsx`（`index.ts` 会把 `<Component` 当小于号报 `TS1005 '>' expected`，且与 jsx 配置无关）。
- **`declare module` 合并需要目标模块先被加载**：`declare module '@deepseek-ai/dsh-session/types'` 扩展 `SessionEventMap` 前，该模块必须已作为模块存在于 program 中——在文件顶部加 `import type {} from '...'`（类型导入会加载模块声明，产物中被擦除）。
- **闭包内窄化失效**：`match.event.data.x` 在 `.map((m) => ...)` 回调里使用时，判别联合窄化不保留——先在守卫后提取 `const x = match.event.data.x` 再用。
- **类型链接目标**：`profiles/node_modules/@deepseek-ai/*` 的链接指向不稳定（staging 快照可能是旧构建，声明 `module 'cordis'` 而非 rescoped 的 `'@deepseek-ai/cordis'`）。开发时把 `node_modules/@deepseek-ai/<pkg>` 直接链接到 **checkout 源码包的目录**（其 `lib/types` 是声明正确的构建）；若 client 包 lib 过期（缺 `Context` 声明合并），优先链接到运行实例同版本的 staging 构建，或直接映射源码。

#### 1.2 构建（tsc + tsdown client bundle）

```jsonc
// package.json scripts
"build": "tsc -p tsconfig.json && tsc -p tsconfig.client.json && tsdown",
"typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit",
"verify": "node scripts/verify.mjs"
```

- tsc 产出 `lib/`（host 可执行 ESM）与 `lib/types/`（声明）
- `tsdown` 把 `lib/client/index.js` 打包成浏览器 bundle `lib/client.js`（协议：CJS closure-factory，`window.__ModuleLoader__.load({ id, factory })`；外部化平台模块 react / `@deepseek-ai/dsh-client-*`；CSS Modules 经 lightningcss 内联并注入 `<style data-plugin>`）
- 构建后冒烟：`node -e "import('./lib/index.js').then(m => console.log(Object.keys(m)))"` 应看到 `name/inject/Config/apply`

坑：tsdown 的 CSS 插件必须把 emitted entry 的路径回退映射到 `src/`；当前 DSH preset 从
`lib/types/...` rebase 到 `src/...`（外部插件若 tsc 输出布局不同，应按自己的目录边界实现，不能机械写死 `/lib/`）。
当前 checkout 的 `packages/client/tsdown.client.ts` 仍使用 `external/noExternal`，而 tsdown 0.22 会提示弃用；
不要只写“warning 可忽略”：新插件可在验证 `deps.neverBundle/alwaysBundle` 的函数匹配语义后迁移，未验证前保持
与当前 DSH preset 一致，并把 warning 记录为待上游统一的构建债务。

#### 1.3 冒烟脚本（scripts/verify.mjs）

零依赖、临时目录自清理、纯逻辑可测。模板（直接照抄骨架）：

```js
#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { /* 被测的纯函数 */ } from '../lib/state.js'

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`)
  else { failures += 1; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

// 1) 纯规则：状态机迁移、依赖门禁、sanitize——输入输出都写成断言
// 2) 文件持久化：mkdtemp 临时根 → createTeamDir/readTeam/mailbox 往返 →
//    归档/删除 → finally { rm(stateRoot, { recursive: true, force: true }) }
// 3) 状态函数：从 lib/ 导入（如 taskVisualState/taskDepthsById），构造 fixtures 断言
// 4) 浏览器 fold：import('../lib/client/xxx.js') 直接跑纯 fold 逻辑（不依赖 React）

if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exit(1) }
console.log('\nall checks passed')
```

要求：**断言 label 必须与输入和条件一致**（错误 label 会让通过的测试也误导维护者）；覆盖边界（缺失依赖、
空目录、终态拒绝迁移）、临时目录一定清理（`finally`）。关系 UI 的纯投影至少断言：stage/depth 顺序、自然 id
排序、非有限 depth 回退、focused task 的 upstream/downstream 包含、sibling 排除、cycle safety。
`pnpm verify` 进 CI/提交前。

#### 1.4 组合验证：dump-config（不 boot、不碰实例）

用**独立 scratch profile** 验证 bundle 补丁能组合进配置树：

```sh
# 手动构造 scratch profile（不必走 pnpm）
mkdir -p ~/.dsh/profiles/agent-teams-check/node_modules
ln -sfn /absolute/path/to/plugin ~/.dsh/profiles/agent-teams-check/node_modules/<pkg>
cat > ~/.dsh/profiles/agent-teams-check/package.json <<'EOF'
{ "name": "dsh-profile-check", "private": true, "dependencies": {},
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "<pkg>"] } } }
EOF
printf '[]\n' > ~/.dsh/profiles/agent-teams-check/cordis.patch.yml   # 必须是顶层数组！

dsh --profile agent-teams-check --dump-config | grep -A 4 "id: agent-teams"
```

- `--dump-config` **离线组合**（`composeEntries` 应用 patch 层），不 boot 服务、不动运行实例
- 输出应看到 `- id: <插件行>` 与其 config
- 坑：`cordis.patch.yml` 不是顶层数组会报 "must be a top-level YAML array"。`--host/--port` 是 web startup
  读取的 app-level pass-through flag，只要自定义 profile 组合了 web-app 就可直接使用；`--patch` 仍适合把端口配置
  固化成可审计的测试输入，但不是唯一方式。

---

### 2. 真实端到端验证（独立 profile + 真实 LLM）

#### 2.1 安装到独立 profile

```sh
# headless 模板自动初始化；pnpm link 语义 + 自动 reconcile 进 dsh.profile.bundles
dsh plugin --profile headless add /absolute/path/to/plugin
dsh --profile headless --dump-config   # 确认组合树含插件行
```

首次真实运行通常立刻暴露 **mount 时序 bug**：Loader 并发激活下，插件 apply 时兄弟插件（如 `subagent-spawn` 的 provider 注册）可能尚未完成——**mount 时的 fail-loud 校验要移到首次使用点**（如第一次 spawn 成员时再 `ctx.subagents.getProvider(name)` 校验），错误信息要可操作。

#### 2.2 真实 LLM 任务设计

```sh
mkdir -p /tmp/agent-teams-e2e && cd /tmp/agent-teams-e2e
dsh --profile headless "用 AgentTeams 完成一个小任务：创建团队'标题方案'，加 2 个成员（alice 负责研究，bob 负责撰写），创建 2 个任务（t2 依赖 t1）分配给他们，唤醒他们完成，最后汇总产出。任务要小，每个成员只做一个简单任务。"
```

设计要点（控制 token 与可判定性）：
- **任务要小**：明确写"任务要小/每个成员只做一个简单任务"（成员 spawn + 多轮工具调用会跑 1–3 分钟）
- **明确要求走插件流程**：点名要调用的工具与顺序（创建团队→加成员→建依赖任务→唤醒→汇总），否则模型可能跳过
- 在**专用工作目录**跑（`/tmp/...`），落盘产物可预期；后台运行（`run_in_background`）并 `task_output --wait` 收集
- 判定成功：任务输出包含完整流程叙述（建队/成员/任务/产出/删队），且**事件流落盘**（见 2.3）

#### 2.3 落盘检查（数据真相）

```sh
# 团队状态文件（headless 的 cwd = 调用目录；团队删除后会归档/清空）
ls -la /tmp/agent-teams-e2e/.agent-teams/

# 会话日志：每个会话一个目录，成员子会话是独立 uuid 目录
ls -lt ~/.dsh/sessions/--private-tmp-agent-teams-e2e--/

# 事件流（zstd 压缩，用 zstdcat 解压后数 agent-teams/* 事件）
zstdcat ~/.dsh/sessions/<ws>/session-<id>/session.jsonl.zstd \
  | grep -o '"type":"agent-teams/[^"]*"' | sort | uniq -c
# 预期：team-created ×1, member-added ×2, task-created ×2, task-updated ×N,
#       message-sent ×N, team-deleted ×1（数量与流程一一对应）
```

事件流是 UI 与重放的数据源——**事件数量与流程步骤对不上就是 bug**（如成员没走 `update_task` 仪式时事件缺失，要与磁盘真相区分）。

---

### 3. GUI 验证（ego-browser + 独立 web 实例）

#### 3.1 启动独立 web 实例（不触碰用户指定的运行实例）

```sh
cat > /tmp/agent-teams-web.patch.yml <<'EOF'
- id: webserver
  config:
    host: 127.0.0.1
    port: 3081
EOF
dsh --profile agent-teams-web --patch /tmp/agent-teams-web.patch.yml
# 用 managed background task 启动并读取启动输出；看到精确 URL 后再 curl，不要 sleep 猜时序
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3081/
```

- 自定义 web profile 可直接使用 app-level `--host 127.0.0.1 --port 3081`；也可用 `--patch` 固化 webserver
  配置。后者替换目标行的整个 config 时，应 restate 所需字段。
- profile 组合：base + web-app + 插件（自定义 profile 默认只有 base，需把 `@deepseek-ai/dsh-web-app` 加进 bundles）。
- client-plugin HMR 分两半：`dsh web` 已挂 host poll + SSE + 浏览器 receiver，但源码改动只有在同一 checkout
  的 `pnpm run dev:web` watcher 正在把它重建为 `lib/client.js` 时才会无刷新热换；先验证 watcher 再承诺自动更新。
- 未运行 watcher时：`pnpm build` 后刷新现有 3081 页面即可获取新 bundle；**通常不需要重启 host**。
  修改 package manifest、exports、profile bundles roster 或 host 代码时才重启独立实例；用户 patch 文件本身可热更新。
- apps/web shell 与普通 packages 不走 client-plugin HMR；重建受影响 Web artifacts 后刷新既有 URL。
  不要另起一个 Vite server 假装更新当前 DSH GUI：apps/web 需要 `dsh web` 注入 `window.__DSH_BOOT__`。

#### 3.2 名册与路由探活

```sh
# 浏览器名册必须包含插件（client-modules 扫描组合树中声明 dsh.client 的包）
curl -s http://127.0.0.1:3081/ | python3 -c "
import sys, json, re
html = sys.stdin.read()
m = re.search(r'window.__DSH_BOOT__ = (.*?)</script>', html, re.S)
g = json.loads(m.group(1))
print(any('agent-teams' in e['id'] for e in g.get('entries', [])))
"
# client bundle 与自定义数据路由
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3081/plugins/<pkg>/client.js
curl -s http://127.0.0.1:3081/plugins/<pkg>/state
curl -s "http://127.0.0.1:3081/plugins/<pkg>/state?archived=1"
```

坑：当前源码严格读取 package.json `dsh.client`，并要求 `exports["./client"]` 与实际 bundle 同时存在；
声明畸形或 bundle 缺失会在 host activation 聚合报错。包元数据负结论不会自动过期，所以修正 manifest/export 后重启 host。

#### 3.3 DOM 探针（ego-browser）

```js
// 每个 heredoc 先复用任务空间 + 打开/复用 tab
const task = await useOrCreateTaskSpace('agent-teams webui test')
await openOrReuseTab('http://127.0.0.1:3081', { wait: true, timeout: 30 })

// 组件必须挂 data-* 探针属性（data-agent-teams-activity / data-task-state / data-member-running ...）
const probe = await js(String.raw`(() => {
  const panel = document.querySelector('[data-agent-teams-activity]')
  if (!panel) return { panel: false }
  return {
    panel: true,
    teamName: panel.querySelector('[class*="teamName"]')?.textContent ?? '',
    delegationMap: !!panel.querySelector('[data-delegation-map]'),
    dependencyMap: !!panel.querySelector('[data-dependency-map]'),
    focusedTasks: [...panel.querySelectorAll('[data-task-id][data-focused="true"]')].map(n => n.getAttribute('data-task-id')),
    pinnedTasks: [...panel.querySelectorAll('[data-task-id][aria-pressed="true"]')].map(n => n.getAttribute('data-task-id')),
    artLoaded: [...panel.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0),
    mainShift: getComputedStyle(document.querySelector('[data-phase="active"]')).paddingRight,
  }
})()`)
cliLog(JSON.stringify(probe, null, 1))
```

坑：
- **snapshotText 的 `@N` ref 每次快照都会失效**：填输入框/点按钮前先重新 `snapshotText()` 取 ref；找不到精确 ref 用 `aria-label` 或按钮文本兜底（`.match(/\[ref=(\d+), loc=[^\]]*发送[^\]]*\]/)`）
- **composer 选择器会变**：placeholder 可能从"描述你想要构建的内容"变成"给智能体发消息"——先列出所有 textbox 再精确定位
- **`[class*="member"]` 这类子串选择器过宽**——探针优先用稳定 `data-*`、role、aria 属性。
- hover preview、click pin、第二次 click / `Escape` unpin 要做交互闭环；断言 `aria-pressed` 只落在 pin 源任务，
  `data-focused` 包含上下游但排除 sibling。
- 协作让位布局同时做 DOM 与几何断言：宽屏 `html[data-...-open]` 存在且 main padding 非 0，panel 与
  composer overlap 为 0；≤960px padding 回 0 且无 body 横向溢出；收起时采样中间帧确认不是瞬移。
- 验证“卡片激活面板”可 `window.dispatchEvent(new CustomEvent(...))` 模拟，但至少保留一次真实卡片按钮路径。
- 面板数据是轮询时，用 browser wait/重探等待可观察状态，不用 shell `sleep` 忙等，也不要复制运行中任务的工作。

#### 3.4 截图存档

```js
await captureScreenshot('/tmp/agent-teams-panel.png')   // 返回文件路径
```

每轮关键状态各存一张（运行中 / 终态 / 归档复盘），供人类核对视觉；DOM 探针的文本证据与截图互补（探针是断言，截图是人工目检）。

---

### 4. 验证纪律

- **绝不碰用户指定的运行实例**：先明确它的 profile/URL；所有验证使用独立 profile 与独立端口。
  用户明确说“不要管某实例”时，不对它做 curl、重启、健康检查或旁路讨论。
- **每次改动后全链路重跑**：typecheck → build → verify → diff check；client bundle 后按 HMR 条件决定
  无刷新热换或 page reload；host/package manifest/profile bundles 改动才重启独立实例，用户 patch 内容可走 config HMR。
- **后台任务必须可追踪清理**：用 managed background task 启动 server，保存 task id；结束时先判断用户是否希望
  保留测试实例，否则 `task_kill` 并收集最终状态。不要用宽泛 `pkill -f` 误杀其他实例。
- **ego-browser 任务空间按目标复用**，完成后 `completeTaskSpace(..., { keep: false })`；临时 fixture/patch/log
  只删除本任务创建的精确路径，避免 `rm /tmp/*.log` 这类广泛 glob。
- **提交/推送按用户授权**：用户要求 commit 就提交并报告 hash；未要求 push 就不 push。不要假设 remote 必须为空。

---

### 5. 验证清单模板（可复制）

```markdown
## 验证清单：<插件名>

### 构建与离线
- [ ] pnpm typecheck        # host + client 双 program 均 0 错误
- [ ] pnpm build             # lib/ + lib/client.js（closure-factory）产出
- [ ] node -e "import('./lib/index.js')..."  # 导出 name/inject/Config/apply
- [ ] pnpm verify            # 冒烟全 PASS（纯规则/持久化/状态函数/fold）
- [ ] dsh --profile agent-teams-check --dump-config | grep "id: <插件>"   # 组合树含插件行

### 真实端到端（独立 headless profile）
- [ ] dsh plugin --profile headless add /abs/path/<pkg>
- [ ] dsh --profile headless "<小任务，明确要求走插件流程>"
- [ ] 任务输出含完整流程叙述（建队/成员/任务/产出/删队）
- [ ] 落盘：.agent-teams 状态文件存在（或按预期归档）
- [ ] zstdcat 会话日志：agent-teams/* 事件数量与流程一一对应

### GUI（独立 web 实例 3081 + ego-browser）
- [ ] dsh --profile agent-teams-web --patch port.patch.yml 启动，index 200
- [ ] window.__DSH_BOOT__ 名册含插件（无则查 dsh.client + ./client export + bundle 产物）
- [ ] /plugins/<pkg>/client.js 200；自定义路由（state/assets）200 且内容正确
- [ ] 新建会话跑任务 → 面板/卡片出现（DOM 探针 data-* 断言通过）
- [ ] 关键交互闭环（跳转隐藏/会话跟随/归档复盘）逐项探针验证
- [ ] 截图存档（运行中/终态/复盘）

### 清理与收尾
- [ ] 用保存的 background task id 停止独立实例（若用户未要求保留）
- [ ] completeTaskSpace(keep: false)；仅删除本任务创建的精确临时路径
- [ ] 未操作用户指定的其他运行实例
- [ ] 按用户授权 git commit；未要求则未 push
```