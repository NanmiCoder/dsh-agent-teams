---
name: dsh-plugin-development
description: 开发、维护、分发和验证 DeepSeek Harness (DSH) 插件的执行型 Skill。覆盖 host/client 形态判断、bundle/profile 契约、Service 与函数插件、工具、HTTP、持久化、slot、Conversation Node、客户端构建、HMR、GitHub 安装和真实组合验证。
metadata:
  version: "3.1.0"
  date: "2026-08-13"
  reference: "https://github.com/NanmiCoder/dsh-agent-teams"
---

# DSH 插件开发

这是正式版导向的执行清单。先判断运行面，再选择官方模板，实现后必须从真实组合和用户安装路径验证。不要把某个项目的偶然实现当成框架契约。

## 1. 开始前

1. 用 `pwd`、`git rev-parse --show-toplevel`、`git status --short --branch` 确认项目与用户改动。
2. 读取 `package.json`、`cordis.patch.yml`、`tsconfig*.json`、构建配置、相关 `src/` 和测试。
3. 不覆盖用户改动，不操作用户明确排除的 profile、端口或实例。
4. 判断最小运行面：
   - 工具、system prompt、HTTP、持久化、provider：host。
   - slot、Conversation Node、浏览器状态和浮层：client。
   - host 能力且需要 Web 可视化：host + client。
   - 没有 Web 需求：不要声明 `dsh.client`，也不要构建 client bundle。
5. 写下插件唯一职责、依赖的 service、贡献的配置行、持久化 owner 和用户可见验证面，再开始编码。

## 2. 证据与官方参考

### 2.1 取证顺序

行为不确定时按顺序取证，不猜：

1. 当前项目及已安装 `node_modules/@deepseek-ai/*` 的 `package.json`、exports、types、README。
2. 环境明确提供的 DeepSeek Harness checkout；只读分析，不修改。
3. 克隆官方仓库取证（见 §2.3）。
4. 信息仍不足时，以当前正式版 exports/types 为边界，选择可安全失败的最小实现并标注假设。

不要写死本机绝对路径，也不要访问或转述未授权的私有仓库内容。

### 2.2 官方模板选择

若提供了 Harness checkout（环境提供或按 §2.3 克隆），优先按插件形态阅读这些模板；路径以 checkout 根目录为基准：

| 目标 | 主参考 | 学习重点 |
|---|---|---|
| Host Service / HTTP | `packages/host/webserver` | `Service`、`static Config`、`Service.init`、route disposer、连接清理 |
| 最小 client 插件 | `packages/client/ui-message-feedback` | `inject`、`apply`、locale、per-session controller、slot 注册与清理 |
| Slot / Conversation Node | `packages/client/ui-conversation` + `packages/client/ui-slots` | `SlotMap`、slot kind/scope、children 认领、keyed node renderer |
| Bundle 分层 | `packages/bundle/base` + `packages/bundle/web-app` | 顶层 patch 数组、行 id 覆盖、整段 config 替换、加载顺序 |
| 简单持久化 backend | `packages/storage/storage-json` | register → disposer → close、显式 root、并发打开门禁 |
| 崩溃安全日志 | `packages/session/session-persistence-jsonl` | 原子发布、fsync、并发 no-clobber、torn-tail 处理 |
| 工具插件 | `packages/fs/tool-fs` | `defineTool`、schema、render、可选能力挂载 |
| Client 测试 | `packages/test-support/client-runtime` | jsdom、SlotTestRuntime、mount/dispose、fake service |

复杂插件只用于补证据，不作为起步模板。若要委派只读调研，提示词必须要求给出文件、行区间、契约与最小建议。

### 2.3 官方仓库兜底层

官方仓库 `https://github.com/deepseek-ai/deepseek-harness` 是公开、MIT 许可的可引用证据源（默认分支 `master`；开发者预览阶段无 release tag，不 pin 版本）。需要兜底取证时：

1. 选临时目录：用用户或环境提供的目录，例如 `SCRATCH="$(mktemp -d)"`；不要写死本机绝对路径。
2. 复用已有 checkout：若 `$SCRATCH/dsh-official` 已存在，且 `git remote -v` 指向官方、根目录含 `AGENTS.md` 与 `LICENSE`，直接复用；需要更新时 `git -C "$SCRATCH/dsh-official" fetch --depth 1 origin master && git -C "$SCRATCH/dsh-official" reset --hard origin/master`（或删除后重克隆）。同一任务只维护这一个目录，避免反复克隆。
3. 浅克隆（只读取证，无需 `pnpm install`）：

   ```sh
   git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git "$SCRATCH/dsh-official"
   ```

4. 只克隆官方 `deepseek-ai/deepseek-harness`；不要访问或转述未授权的私有仓库内容。对克隆内容同样只读分析，不修改。

进入后定位：

1. 先读根 `AGENTS.md`（`CLAUDE.md` 是它的符号链接）：仓库布局、命令与约定一次讲清，是官方给 agent 的入口。
2. 再用 `packages/README.md` 的 group 表确认目标包位于哪个 `packages/<group>/<pkg>`。
3. 按 §2.2 模板表读对应包的 `README.md` 与 `src/`；取证结论给出文件与行区间。

演进兜底：官方仓库处于开发者预览、迭代极快、无兼容承诺、无 release tag，§2.2 的模板路径只是索引，一切以当前 checkout 的实际代码为准；路径或名称漂移时，用 `packages/README.md` 定位新位置并回报修正，不要凭旧文档猜。需要复现一致证据时记录 `git rev-parse HEAD`。

## 3. Bundle、Profile 与 package 契约

### 3.1 两个概念

- **Bundle** 是作者分发的包：`package.json.dsh.bundle.patch` 指向配置层。
- **Profile** 是用户运行的组合：`$DSH_HOME/profiles/<name>/package.json.dsh.profile.bundles` 保存有序 bundle 列表。
- 插件作者写 bundle；`dsh plugin` 创建和维护 profile。不要手写用户 profile manifest。

### 3.2 最小双面 package

```jsonc
{
  "name": "dsh-my-plugin",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md"], // 目录或显式清单均可；官方仓库常用显式文件清单
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-runtime"]
    }
  }
}
```

规则：

- Host-only 包删除 `./client` 与 `dsh.client`。
- Client 包必须同时有 `dsh.client.platform: "web"` 和真实存在的 `exports["./client"]`。
- `dsh.client.inject` 是随图下发的信息性元数据（预检展示 / HMR diff 用），不决定 client fiber 的激活顺序；预取由 `dsh.client.immediately` 驱动，真正的依赖等待来自 client bundle 导出的 `export const inject`（§5.1），两者互不替代。
- `dsh.client.immediately` 是仅供启动关键入口使用的可选预取标记；普通第三方插件不要默认开启。
- 当前权威字段是 `dsh.client`；历史兼容字段只有在目标正式部署仍明确读取时才添加。
- exports、`files` 和 Git/发布产物必须一致；任何入口都不能指向不存在的文件。
- DSH、Cordis、React 等共享运行时优先声明为 peer，避免复制 runtime identity；版本范围从目标正式版 package metadata 取证。

### 3.3 Patch 层

`cordis.patch.yml` 必须是顶层数组：

```yaml
- insert:
    - id: my-plugin
      name: dsh-my-plugin
      config: {}
```

注意：

- `id` 是配置树中稳定的行身份；`name` 是 Node 可解析的包名或导出路径。
- 后层按 `id` 覆盖前层；目标行的 `config` 是整段替换，不是深合并，因此覆盖时要重述所需键。
- 生效顺序是 profile bundles → profile `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → 命令行 `--patch`；后者获胜。
- 包没有 `dsh.bundle` 时只会成为普通依赖，不会自动成为 profile 层。

## 4. Host 面实现

### 4.1 函数插件

普通插件通常导出：

```ts
export const name = 'my-plugin'
export const inject = ['tools']
export interface Config { enabled: boolean }
export const Config = z.object({ enabled: z.boolean().default(true) })
export function apply(ctx: Context, config: Config): void {}
```

- `z` 从 `@deepseek-ai/schemastery` 导入（不是 zod）；`static Config = Config` 引用导出的 schema，与官方内联的 `static Config: z<Config> = z.object({...})` 等价。
- `inject` 是必需 service；未满足时 fiber 保持 pending，框架会在服务就绪后激活，不要用轮询模拟依赖注入。
- Config 默认值放 schema；任何部署可能需要改变的值都应成为配置，而不是源码常量。
- 可选 service 用 `ctx.get()` 判断或 `ctx.inject([...], childCtx => ...)` 惰性挂载；不要在 `apply()` 中抢跑兄弟 provider。

### 4.2 Service 插件

当插件提供稳定 service 时，参考 `host/webserver`：

```ts
export class MyService extends Service {
  static Config = Config
  constructor(ctx: Context, config: Config) {
    super(ctx, 'myService')
  }
  async [Service.init](): Promise<void> {}
}
```

- 构造器声明 service key；异步启动放在 `Service.init`。
- 初始化失败应让 fiber 失败并由启动方报告，不要吞掉组合错误。
- 注册方法返回 disposer；拥有资源的一方负责关闭资源。

### 4.3 Effect 所有权

所有长生命周期资源必须归当前 fiber：

- route、listener、watcher、timer、React root、DOM、socket、临时 service 都必须可清理。
- 用 `ctx.on()` 或 `ctx.effect(() => disposer, label)`。
- disposer 顺序通常是：停止外部入口/注销 registry → 等待或取消在途工作 → 关闭资源。
- 需要服务后绑定时，用“立即尝试 + service 事件/`ctx.inject` 重试 + 幂等 guard”，不要重复注册。

### 4.4 工具

使用 `ctx.tools.register(defineTool(...))`：

- `description` 写清何时调用、必要前置条件、失败语义和副作用。
- `parameters` 与 `output.schema` 都用 `@deepseek-ai/dsh-tools` 的 value-schema DSL（编译后是受支持的 JSON Schema 子集）：`parameters` 是隐式开放对象根、必填用属性内联 `required: true`；`output.schema` 声明 canonical 返回值并在注册时被 `assertSupportedJsonSchema` 强制校验。二者是同一 DSL 的两个面，不是两套语言。
- `output.render` 给模型稳定、紧凑、可判定的文本。
- 从 `exec.agent` 获取当前会话、工作区和 owner，不从全局进程状态猜。
- 异步工作观察或转发 `exec.signal`；写操作要有幂等、锁或冲突策略。

### 4.5 HTTP

- 注入当前正式版 Web server service，并用结构化最小接口降低耦合。
- 路由通过 `ctx.effect(() => ctx.webServer.register({ kind: 'exact' | 'prefix', path, handler }))` 注册；重复 (kind, path) 会抛错。
- 状态接口显式设置缓存策略：敏感或实时快照优先 `Cache-Control: no-store`，可重验证资源使用 `no-cache`；静态资源使用明确白名单和正确 content type。
- path decode、请求体解析和 handler rejection 都要转成明确 4xx/5xx，不能成为未处理 rejection。
- exact route、最长 prefix、fallback 的所有权不能冲突；未知插件资源返回 404，不落入 SPA fallback。
- 涉及权限或本机能力时采用最小暴露、回环/信任边界和方法白名单。

### 4.6 持久化与并发

先判断应复用正式版 storage/session persistence service，还是插件拥有独立介质。无论哪种：

- 路径配置显式指定；不要用 `process.cwd()` 默认值散落用户数据。
- 状态按 workspace、session、owner 或业务 id 建立清晰隔离维度。
- 同一资源的读改写串行化；并发创建采用 no-clobber 语义。
- 人可读 JSON 要用同目录临时文件 + fsync + 原子发布；追加日志要处理 torn tail。并发创建用 `link()`+`unlink()` 的 no-clobber 协议，勿用 `rename()` 静默覆盖。
- Registry backend 的清理顺序是 unregister 再 close。
- 恢复与 HMR 不能假设创建事件会重放；需要时显式扫描和回填已有对象。

## 5. Client 面实现

### 5.1 最小入口

```ts
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

export const inject = ['slots']
export function apply(ctx: ClientContext): void {}
```

- 类型贡献使用 type-only import 拉入 Context/SlotMap merge。
- client 注册、controller、listener、style 和 DOM 都必须随 client fiber dispose。
- per-session 状态按 `SessionId` 分桶；连接重置时只重同步已经读过的对象。

### 5.2 Slot 四步契约

1. **声明**：从提供 slot 的官方包拉入类型；自定义 owner 才通过 module augmentation 扩展 `SlotMap`。
2. **认领**：父 entry 的 `children` 表声明子 slot；声明即占有渲染权，不要争抢别人的 seat。
3. **注册**：owner 与贡献者的激活顺序不保证，使用 `ctx.slots.inject(key, () => ctx.slots.register({ name, children?, store?, locale?, inject?, ...kind 参数 }, Component))` 等待声明；`children` 同时是子 slot 的认领表（认领即占有渲染权）。kind 参数：keyed 必填 `key`、list 必填 `id`（可加 `order`/`label`）、chain 必填 `select`；single/keyed/list 可加 `priority` 做 cell 隐藏（同 cell 同 priority 会抛错）。向未声明 slot 直接 register 会抛错。
4. **渲染**：owner 使用 `renderSlot`/`renderSlotChain`；贡献者不 import owner 的实现组件。

选择接缝时先检查当前正式版类型。常见会话 UI 接缝包括：`conversation.session.header.actions`/`.utilities`、`conversation.view`、`conversation.chat.node`、`conversation.chat.commandview`、`conversation.chat.assistant-actions`、`conversation.chat.turnTail`、`conversation.input.dock`、`conversation.composer.dock`、`conversation.composer.bar`、`conversation.input.left`/`conversation.input.right`/`conversation.input.plan`/`conversation.input.model`。全局浮层用 `shell.overlay`（list/root），不要碰 `root` 单槽。不要仅凭旧文档写 slot 名，以当前正式版 `ui-conversation/src/client/contract/slots.ts` 的 SlotMap 为准。

### 5.3 Conversation Node

Conversation Node 是“事件折叠 + keyed slot renderer”的组合：

1. 定义共享事件类型，并 merge 到 session event map。
2. `conversationEvents.register(definition)`：
   - `match` 选择事件；
   - `start` 创建节点状态；
   - `update` 按 seq 确定性折叠；
   - `buildViewNode` 生成稳定的 view node。
3. merge `ChatNodeDataMap`/节点 kind 类型。
4. 向 `conversation.chat.node` 注册相同 key 的 renderer。

红线：

- 重放同一事件序列必须得到同一节点，不读时间、随机数或当前磁盘状态。
- `match` 返回稳定业务 id 和 `start|update` 角色；节点引擎在当前会话内使用 `conversationContextKey(kind, businessId)` 去重。跨会话持久化缓存另行把 owner session 纳入 key，不能混成引擎契约。
- 事件写入业务 owner 会话；共享 host/client 事件文件保持 type-only、最好零运行时 import，避免双 tsconfig 的 Context augmentation 相互污染。
- 磁盘/服务端快照可作为实时 UI 真相；事件流用于对话投影、审计和确定性历史，两者职责不要混淆。

### 5.4 Portal 兜底

能用语义正确的 slot 就不用 fixed portal。全应用浮层优先注册 `shell.overlay`（list/root，click-through 直到你的 entry 主动开启 pointer events）；确无全局角落 slot 时才 body portal：

- React root、host DOM、window listener、全局 attribute 都有 disposer。
- 跟随 session list，按当前 owner 过滤；导航时立即收起。
- 宽屏可让主列礼让，窄屏退回 overlay；只依赖稳定 `data-*`，不要耦合哈希 class。
- 首屏恢复的已有活动只显示徽标，避免首次请求返回后自动展开造成大幅布局位移；稳定后出现的新活动再自动展开。
- 面板限制为容器/视口的一部分高度，内容区内部滚动；窄屏单独设上限。
- 轮询使用 `no-store`、in-flight guard、响应形状校验和 unmount 防护；失败保留最后成功快照。
- 支持键盘、`:focus-visible`、`aria-*`、Escape、reduced motion；hover/focus 只预览，click 才固定状态。

## 6. TypeScript 与 Client 构建

### 6.1 双 tsc program

Host 和 client 使用两个 program；文件名可按项目布局选择，官方仓库用 `tsconfig.host.json` 与 `tsconfig.client.json` 两个聚合 program 分别做 host/client 检查：host 排除 `packages/client/*/src/**` 与 `*.client.*` 测试；client 聚合含各 client 包的 CSS module 声明、client 测试与构建脚本，共享 leaf 经 project references 进入，每个 `packages/client/*` 包还各自维护一个 composite tsconfig 做包内类型检查。JSX 使用 `.tsx` 和 `react-jsx`；相对 TS import 必须能正确重写为 emitted JS。

这样避免 host session 与 browser runtime 对同名 Context service 的 declaration merge 冲突。

### 6.2 Client bundle

优先复用当前正式版 Harness 的 client tsdown helper或已验证模板，不手写 loader 协议。产物应由构建自动包装为：

```js
window.__ModuleLoader__.load({ id, factory: (require) => { /* bundle */ } })
```

构建必须保留：

- host/client 两半产物并存（client build 不清空 host 输出）；
- sourcemap；
- CSS Modules 编译与 `style[data-plugin]` 注入；
- 从 emitted `lib/` 找回 `src/` 资源的路径回退；
- client bundle purity gate。

### 6.3 Client import 纯度

浏览器模块表只回答正式版平台 seed 模块和明确豁免。规则：

- 平台模块以正式版 `packages/client/web/src/platform.ts` 和官方 client 构建配置为准；React、Cordis、slots、web-react、primitives、attachment、schema-form 等由模块表提供。
- `@deepseek-ai/dsh-client-runtime/client` 是官方构建配置中明确标注的临时豁免，不是普通平台模块；不要把它泛化为可任意导入 runtime 值的许可。
- 纯类型 import 会被擦除，可以跨包拉入类型贡献。
- wire types、生成 remote codec 或明确 vendored 的纯库只有在官方模板允许时才 inline。
- 其他跨插件值 import 禁止；协作必须走 Cordis service/remote/slot。否则构建期纯度门或运行时 require 都会失败。

## 7. 分发、安装与生效边界

### 7.1 安装

`dsh plugin --profile <name> <args...>` 是 profile 目录里的 pnpm 转发层，成功后按安装状态和 `dsh.bundle` 对账 bundle 列表。因此支持 npm、路径、tarball 和 Git：

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile web add github:<owner>/<repo>
```

GitHub 分发不要求发布 npm，但必须选择一种构建策略（Git 获取的是源码，不是构建产物）：

- **官方主推**：提供自包含 `prepare`（官方 turtle-ui 模式）；pnpm ≥10 默认拦截 Git 依赖的构建脚本，用户需在 profile 的 `pnpm-workspace.yaml` 显式 `allowBuilds` 后重跑 `add`。这会执行第三方代码，应固定 commit 并只信任已审查仓库。
- **备选（无交互安装）**：把 exports 指向的完整、最新 `lib/` 提交进 Git；用户无需执行依赖脚本，但非官方推荐路径。

README 只给经过全新 profile 验证的推荐命令。安装后重启目标 profile。

### 7.2 HMR 与重启

- client HMR 需要 `tsdown --watch` 等构建 watcher 持续重写 `lib/client.js`；host HMR 只负责 stat 检测文件变化，再通过 rev/SSE 触发 browser fiber 的 dispose/reload。
- 只有 bundle 内容变化可以 client HMR；package manifest、exports、插件集合、profile bundles 和 host 代码变化需要重启。
- 普通 build 后没有 watcher 时，刷新现有 DSH 页面。
- 不启动独立 Vite server 替代 DSH GUI；Web shell 依赖 host 注入的 `window.__DSH_BOOT__`。

## 8. 验证矩阵

### 8.1 基线

```sh
pnpm typecheck
pnpm build
pnpm test             # package.json 声明时运行
pnpm verify           # package.json 声明时运行
git diff --check
```

先读取 `package.json.scripts`，不要假设所有仓库都有同名聚合脚本：官方 Harness 使用 `check:ci`/`check:all` 与多个 `verify-*` gate；第三方插件可自定义 `verify`。项目级 verify/check 至少覆盖：

- 纯业务规则和状态迁移；
- 临时目录中的文件往返、锁、归档/恢复；
- client 可独立测试的投影/折叠纯函数；
- canonical Skill 与镜像一致性（若项目提供镜像）。

### 8.2 Host 与真实组合

- 单元测试覆盖 schema、service、失败和 disposer。
- 有 registry/backend 接口时使用共享 contract suite。
- 不只手搓 `ctx.plugin()`：至少一个测试通过真实 Loader/patch 组合启动，断言用户可见表面。
- 先用 `dsh plugin --profile <scratch> add <pkg>` 创建非内置 scratch profile，再执行 `dsh --profile <scratch> --dump-config`，确认 bundle 层、行 id、name、config 和注入顺序；内置 `web`/`headless` profile 可由 launcher 初始化。另有 `--dump-default-config`：只打印 bundle 层、跳过用户层与 `--patch`，可作坏 `cordis.patch.yml` 时的恢复诊断。
- 真实任务使用 `dsh --profile headless "一个小而可判定的任务"`；不要发明 `dsh run` 子命令。

### 8.3 Client

- client 测试使用 jsdom lane；通过 SlotTestRuntime 或最小 fake services mount 插件。
- 断言 slot 注册、渲染、session 隔离、connection reset、dispose 后 registry/DOM/style/controller 均清理。
- 每个 registry 贡献至少有一个 HMR/dispose 安全测试。
- GUI 使用独立 web profile 和真实浏览器，验证名册、路由、交互、刷新、宽窄屏、滚动、焦点和 reduced motion。

### 8.4 从零安装与 Git 分发

1. 使用全新临时 `DSH_HOME`/profile。
2. 按 README 的精确命令安装。
3. 断言 profile dependency 与 `dsh.profile.bundles`。
4. 断言所有 exports、host/client bundle、patch 和静态资源存在。
5. `--dump-config` 必须出现插件层。
6. 启动后检查 host route、client roster 和真实 UI。

仓库仍私有时，可把待发布内容复制到临时 Git repo 并提交，再通过 `git+file://...` 安装；这能验证“Git 获取的内容”而不是当前 checkout 的未提交文件。前提：`git` 在 PATH、目录是已提交的真实 Git 仓库；若包声明了 `prepare`，还需在 profile 的 `pnpm-workspace.yaml` 加 `allowBuilds`（与 §7.1 相同门禁）。只删除本任务创建的精确临时目录。

## 9. 完成标准

完成前逐项确认：

- 运行面最小，manifest、exports、patch 与产物一致。
- 必需 inject 和可选 service 边界清楚；pending/failed 状态可诊断。
- route、registry、timer、watcher、DOM、React root 和存储均可清理。
- Conversation Node 可确定性重放，owner 与去重维度正确。
- client import 未越过模块表，host/client 类型隔离。
- 持久化有并发与崩溃语义，不依赖偶然 cwd。
- typecheck、build、verify、真实组合、从零安装和需要的 GUI 验证通过。
- README 安装命令与实际分发形态一致。
- 未执行未经授权的 commit、push、发布或 visibility 变更。
