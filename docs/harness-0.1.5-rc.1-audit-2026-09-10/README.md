# AgentTeams 适配 DeepSeek Harness 0.1.5-rc.1
> 后续状态：本审查下述结论针对旧基线。适配已在本地候选 `0.1.17-rc.1` 实现；最终包的四版本矩阵、Ego Lite 真实 API 与会话迁移证据见 [实现验收](../releases/v0.1.17-rc.1/README.md)。npm 发布与远端验收状态见实现验收目录的 publication.md。

审查日期：2026-09-10。结论：**当前 AgentTeams 0.1.16-rc.3 不能直接宣称支持 0.1.5-rc.1。至少两个宿主接口阻塞已经由精确 tag 源码确认；此外需要适配 Web 主面板导航，并验证会话迁移。Skills 已升级，但其迁移卡还未覆盖目标版本。**

## 版本与证据

- AgentTeams 工作树基线：`502dd6c6bb1d0f59cb5f902cda4b68494e7aedf4`，开始时干净、detached HEAD；开发与推荐宿主为 `0.1.2-rc.1`，另支持 `0.1.2-alpha.5`、`0.1.2-alpha.2`。
- Source mode：使用用户指定的 `$HOME/workspace/github/deepseek-harness`，工作树干净；没有切换、拉取或修改宿主源码。
- From：`dsh-v0.1.2-rc.1` / `a66e4702047846cdaa10c66c9d3df3951f5ea70d`。
- To：`dsh-v0.1.5-rc.1` / `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`。
- merge-base 等于 From，区间无基线漂移。共 1,486 个提交、995 个非合并提交；6,766 文件、+208,222 / −58,150 行。Git 对大量删除/新增跳过穷举 rename detection，关键迁移项另用两端源码核对。
- npm 查询确认 umbrella 包已发布，`latest` / `next` 均为 `0.1.5-rc.1`；24 个当前直接开发 DSH 依赖均有该精确版本。查询结果含包完整性摘要及依赖见 [npm-direct-packages.json](npm-direct-packages.json)。这是 registry 元数据，**没有安装、解析或验收目标运行时全闭包**。
- 原始 commits、reverts、files、diffstat、完整 diff、CHANGELOG 与本报告位于宿主 `tmp/0.1.2rc1-to-0.1.5rc1/`。未做前一区间的变化密度比较。
- 官方发布：[0.1.5-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)。以下上游链接均锁定目标 tag；前态由 From tag 同路径读取，移除项经两树复核。

## 1. 必须先改：子代理任务投递入口

影响：插件启动、队员唤醒、任务排队、shutdown 拦截。

`src/harness-compat.ts:22` 硬编码 `Symbol.for('dsh.subagent.queuePrompt')`，在 `installContinuableMemberSetup()` 检查它，在 `queueMemberPrompt()` 调用它，并在 `guardSubagentDelivery()` 包装它。新宿主删除旧 symbol，改为 `Symbol.for('dsh.subagent.deliverPrompt')`；第六个参数为 `delivery: 'queue' | 'steer'`。因此现有第 63 行会抛出 `unsupported Harness subagent contract`，不能仅通过放宽 peer 修复。

官方 `queueHostSubagentPrompt()` 辅助函数的参数签名保留，内部改调新 symbol 并显式传 `'queue'`；新增 `steerHostSubagentPrompt()`。公共 `sendMessage()` 仍表示 steer，不能拿它替代团队任务队列。[上游 internal.ts](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/subagent/subagent/src/internal.ts)。

**适配：** 将宿主差异集中在 `harness-compat.ts`。保留现有已支持版本的路径；新分支调用 deliver symbol 时明确传 `'queue'`，guard 同时拦截新入口的 queue/steer 两种投递和公共 sendMessage，并正确恢复 descriptor；不能留下退休队员的旁路。评估使用官方 helper 时，需考虑 Alpha.2 没有 `/internal` 导出，不能加顶层静态 import 导致旧版本启动失败。投递入口仍是 internal API，之后的每次宿主升级都需要重新核验。

验收：空闲队员唤醒、繁忙队员排入后续轮次、保留 source attribution、取消只影响接收前工作、冷恢复、shutdown 后拒绝旧任务、插件 dispose/HMR 恢复原方法。

## 2. 必须改：队员初始化显式接收 Agent

影响：队员模型与推理力度、fallback、失败收尾。

宿主删除 Cordis `Context.agent?: Agent` 和 `Agent.ctx` 上的 agent own-property，`AgentSetup` 由 `(agentCtx)` 改为 `(agentCtx, agent)`。AgentTeams `src/members.ts:365` 仍用 `childCtx.agent`；`harness-compat.ts:74` 只把 `agent.ctx` 交给 setup。即使修好投递入口，这段初始化也无法正常定位队员。[上游 Agent API](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/core/agent/src/index.ts)、[Agent 实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/core/agent-loop/src/agent.ts)。

**适配：** 内部 Setup 改为显式 `(childCtx, child)`；现代 `agent/session-start` 已携带 `agent`，直接传入；Alpha.2 legacy 分支独立桥接旧上下文。不能用 `ctx.agents.initiator` 代替 child，它可能是因果发起者 parent。`ToolRunContext.agent` 仍存在，`src/tools.ts` 的 `exec.agent` 不应机械删除。

验收：第一条请求就命中指定 provider/model/effort，fallback 的实际请求切换正确，cold resume 恢复同一模型路由，初始化失败阻断默认模型执行，失败状态持久化与调度解锁。新宿主新增的 model-change notice 不能替代真实请求证据。

## 3. Web 导航行为需要适配

影响：成员跳转、活动面板显示。以下故障是源码推导，尚未浏览器复现。

新宿主将 `sessions.current` 与全局主面板分开。`ILayout.selectPanel(null)` 才显示 Conversation；`beginNavigation()` 可防止过期异步导航抢焦点。`shell.overlay` 在全局面板下仍然渲染。官方 `UiWorkspace.openSession()` 同时调用 `sessions.open(id)` 和 `layout.selectPanel(null)`。[布局服务](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/client/ui-layout/src/client/service.ts)、[官方导航](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/client/ui-workspace/src/client/navigation.ts)。

AgentTeams `src/client/ActivityPanel.tsx:788` 只订阅当前 Session，显示筛选也只据此判断；`session-navigation.ts:36` 刷新后只调用 `openSubagent`。可能出现全局面板被团队浮层覆盖，或成员 Session 已切换但主区域仍停留在全局面板。

**适配：** 使用新版 `usePanelInfo` 在非 Conversation 面板隐藏活动面板；成员跳转完成时回到 Conversation；在刷新前开始 navigation，提交前检查取消信号。旧宿主通过独立兼容适配保持现有行为。

验收：队长→全局面板→成员、刷新期间转到其他页面、深层队员和历史会话导航、回放卡片、重连与深浅主题。交互式验证依项目规则使用 Ego Lite。

## 4. 会话格式 0 → 3：有迁移链，需要数据验收

影响：session data、cold resume、回退。

`SESSION_FORMAT_VERSION` 从 0 变为 3；官方 catalog 内置 codecs 0/1/2/3 和相邻迁移 0→1→2→3。因此不能报为“所有旧会话无法读取”。`open(id, 'read')` 可准备内存迁移结果；`open(id, 'write')` 发布迁移后的新版本日志。v0 为 `session.jsonl`，v3 为 `session.v3.jsonl`（可另带压缩后缀），迁移过程不删除旧源文件。[catalog](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/session/session-format-catalog/src/generated.ts)、[JSONL open](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/session/session-persistence-jsonl/src/index.ts)、[发布迁移文件](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/session/session-persistence-jsonl/src/generation.ts)。

但冻结的历史迁移清单仍拒绝未知历史事件，即使标记 ignorable；部分历史形态也有显式拒绝。AgentTeams `src/events.ts:46` 已检查 `KNOWN_SESSION_EVENT_TYPES`，官方两版本都不认识 `agent-teams/*`，应保留跳过机制；不要修改宿主集合强行写入。曾手动写入自定义事件的历史日志需单独测试。[v0 验证器](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/session/session-format-v0-to-v1/src/validation.ts)。

**适配：** 隔离宿主与 profile，用旧队长、队员日志及 `.agent-teams` 状态副本验证 read→write migration、cold resume、父子 descriptor、任务恢复、损坏日志拒绝。保留 v0 文件不等于支持降级：旧宿主可能读到旧分支而丢失 v3 后续记录，不能让两版共享同一份生产数据。

## 5. 其他外部变化与未命中项

| 面向 | 已确认净变化 | 对 AgentTeams 的动作 |
| --- | --- | --- |
| Session wire | `seedLength?`→`isSeeded:boolean`；`ChunkRowEvent/SessionChunkRun` 删除；replace `start/end`→`startSeq/endSeq`；新增 assistant-stream | 官方宿主/浏览器依赖同版；本项目不自写旧 wire decoder，验收卡片回放与实时更新 |
| canonical events | 删除 `assistant/chunk`，`assistant/message` 新增 stream，新增 system/message 和 assistant/attempt；tool/code-dispatch→tool/ptc-dispatch | 当前生产代码没有直接依赖这些旧字段；保持官方 assembler 和事件防护 |
| 存储 API | prepare/load/coordinator 改为 SessionHandle + create/open/flush；`Session.fromRestore` 新必需 eventState | 生产代码无直接调用；若迁移测试夹具使用旧 API，单独更新 |
| UI 导出 | 旧 details 槽及 MessageText 等删除 | 本项目使用的 shell.overlay、chat node、commandview 均保留，不做无关重写 |
| Connection Fetch | 新 requestBody 策略必填、支持 POST；Remote producer context 新必需 agentId | 本项目使用 raw webServer.register，不把 Fetch route 新字段强加进来 |
| persona | text/persona 配置拆分为 prefix/suffix，PERSONA_SECTION 移除 | 本项目 patch 无旧键；subagent 参数 persona 不是同一字段，禁止全局替换 |
| 默认工具/模型 | str_replace_editor 包保留，但 base/sdk-minimal 默认挂载移除；默认模型 deepseek-v4-flash→deepseek-flash | 重测默认模型继承与探针工具预期；仅自定义 preset 有需求时显式挂载 |
| CLI/profile | desktop profile 归 Electron 专管；新增 --from-default-profile | 候选使用独立 web profile；Desktop 另验，不从 CLI 管理 desktop |
| manifest | app-boot 的 manifest 类型搬到 dsh-package-manifest | 当前生产源码无直接导入；既有 dsh.bundle.patch / dsh.client 格式保留 |
| 遥测 | FULL 删除；类默认 DISABLED→FEEDBACK_ONLY，反馈采集包括历史 | 自定义加载需审阅；默认 bundle 原本就是反馈模式，不描述为自动全量上传 |

Session wire 证据：[session-controller/types.ts](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/api/session-controller/src/types.ts)。CLI/config 证据：[CLI args](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/apps/cli/src/args.ts)、[base patch](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/bundle/base/cordis.patch.yml)。

## 6. Reverts（回退）

检索区间内 revert 提交并复核两端行为，未确认撤销 From 已有用户功能的 revert；这不表示没有 breaking change。

| 提交 | 结论 |
| --- | --- |
| 58956c1a8a Mermaid/Graphviz 等代码围栏预览 | 两端均无相应 preview 文件，区间内新增再撤销 |
| 92b3b02622 visualizer | 两端均无 packages/visualizer，区间内新增再撤销 |
| e974a655a0 same-session message editing | 两端 controller 均无该 edit Remote，区间内新增再撤销 |
| 8d06ebb5ac 撤销删除 str_replace_editor | 两端包仍在，但默认挂载的净删除仍需考虑 |
| 13daefe073 telemetry proxy | revert 后文件恢复到 From 对应 blob，两端均用 OTLPLogExporter；FULL 模式删除是另一净变化 |
| 0125f9019e、faa33c0ffa | 在途 pwsh/Desktop 与 Windows Python CI 撤回，不据标题推定 AgentTeams API 回退 |

## 7. 已确认保留的接口

- `Agent.followup/steer/inject/whenIdle`、`agent/status/error/pre-step/session-start` 的显式 Agent payload 保留。
- `Session.ownEvents()`、`requestHeader()?.config`、`installModelSelection()` 签名保留。
- SDK client/protocol/server 的 `src` 两端无差异；不能把领域 Session wire 变化描述成 JSON-RPC 协议全面替换。Python SDK API 源码亦无变化，平台 runtime 启动实现另有调整。
- `packages/host/webserver/src` 两端无差异；`HostConnectionService.requestRejection` 签名与 401/403 鉴权含义保留，现有 HTTP 防护无需重写。
- `ISessions.open/openSubagent/subagentAddress/refreshSubagents`、ConversationNodeDefinition、ModelDirectory/Resolver 的已消费接口保留。
- SQLite persistence 包在两 tag 都已不存在：不是本区间新删，也没有可比较的 SCHEMA_VERSION；session-query-sqlite 是另一模块。

## 8. 接口摘要

| API 面 | 0.1.2-rc.1 | 0.1.5-rc.1 | 判定 |
| --- | --- | --- | --- |
| subagent 内部投递 | queuePrompt symbol，5 参数 | deliverPrompt symbol，6 参数 | 直接阻塞 |
| Context.agent / AgentSetup | 可选 agent / 1 参数 | 移除 / 显式 2 参数 | 直接阻塞 |
| Session 格式 | 0 | 3，带相邻迁移链 | 有条件迁移 |
| SQLite persistence schema | 包已不存在 | 包已不存在 | 本区间无变更 |
| SDK JSON-RPC 源码 | 原接口 | src 无差异 | 保留；领域 wire 另计 |
| Session wire | chunks、旧 replace 字段 | stream、seq replace | 不可假定新旧客户端混用 |
| HTTP 原始路由/鉴权 | register + requestRejection | 接口保留 | 当前接入可保留 |
| Web navigation | 当前 session 主要决定内容 | 全局面板独立 | 行为需适配 |
| CLI bin / bundle manifest | dsh / bundle.patch + client | 保留，新增配置能力 | 安装格式基本保留 |
| 模型可见工具 | 默认 editor 等 | 默认集合调整 | 探针需核验 |

## 9. 实施顺序和支持策略

1. **先收集旧基线。** 当前工作树没有 node_modules。本次没有安装或运行 AgentTeams build/typecheck/runtime，因此没有迁移前失败豁免表。实施迁移时先按旧锁文件安装，运行 `pnpm build`、`pnpm typecheck`、`pnpm verify`，保存基线。
2. **建立候选依赖环境。** 新分支/隔离 worktree 以精确 `0.1.5-rc.1` 为目标；从 registry 解析并记录完整依赖闭包，更新 devDependencies、pnpm overrides 和锁文件。旧的 217 条 DSH overrides 不能只替换版本号：新宿主增加了包，需要检查完整闭包、Cordis 身份和实际加载路径。
3. **修复宿主适配层。** 更新 Setup、queue/deliver 和 shutdown guard；修改 `members.ts` 的 Agent 来源。对应扩充 `harness-compat-tdd.mjs`、lifecycle/member-failure 探针，保留三个原支持版本回归。
4. **修复 UI 导航。** 更新 `ActivityPanel.tsx`、`session-navigation.ts` 与调用入口；补面板切换/异步导航测试，用真实 Web UI 确认推导问题。
5. **创建全新 profile 验证。** 新 CLI 支持 `dsh --profile agent-teams-015 --from-default-profile web`（目标需不存在）。仍应配合隔离的 DSH_HOME 与已固定的宿主环境；profile 独立本身不等于宿主依赖闭包独立。
6. **运行行为与产物验收。** 激活→创建团队→分工→任务依赖→队员唤醒/执行/回报；验证模型/effort/fallback、取消/失败/shutdown、冷恢复、旧日志迁移、UI 与 packed tarball 真实安装。doctor 的 unsupported 目前是正确结果；候选矩阵显式配置，不绕过校验。
7. **最后更新支持与发行元数据。** 通过后才把新宿主加入 `compatibility.json`、peer、CI 矩阵和文档，再决定是否改 recommendedHost。插件版本单独升级，宿主 npm latest 不决定插件发布渠道。本次未执行发布、提交或推送。

建议保留现有三版支持，以适配层隔离差异；若实测显示维护代价不合理，再明确讨论缩小支持矩阵。不要提前在 peer 中加入未经验证的新版本。

## 10. Skills 已完成的升级

- 来源从 `cd4d497588cdd4f16300622779b62a78fe803169` 更新为查询时 main 的 `ecab245c6c1831c51b0240aca13573b94a6e525e`；审阅后导入，9 个 skill / 120 文件，5 新增 + 15 修改，许可证及 4 个执行文件模式未变。
- 保留 `skills/` canonical、`.dsh/skills/` 镜像和 `.agents/skills/` 符号链接；项目自维护 `dsh-plugin-development` 不纳入上游清单，合计 10 skills / 121 文件。
- 新增 0.1.3-alpha.1/alpha.2 卡、SQLite 历史删除回填、precision checklist、inject-lint、workflow 编排修订。卡仍止于 **0.1.3-alpha.2**，缺失到 **0.1.5-rc.1** 的迁移段；不能一键自动迁移 AgentTeams。[上游固定 commit](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/tree/ecab245c6c1831c51b0240aca13573b94a6e525e)。
- 增加 `pnpm update:skills <upstream-checkout> <full-commit> [--apply]`：默认预览，显式 commit，保护本地修改，同时更新两份内容、模式与锁定清单；拒绝未审阅的 roster/删除/许可证变化。[项目操作说明](../../skills/README.md)。
- 通用安装可用上游推荐的 `npx skills add oh-my-dsh/dsh-plugin-upgrade-skill`；[Skills CLI](https://github.com/vercel-labs/skills) 提供 `npx skills update [skills]`。它不管理本项目自有锁定清单，因此这里采用项目更新器。
- 新 inject-lint 把 Cordis 固定检查为 `^4.0.1`，仅适用于其 alpha.2 范围；本项目 `^4.0.2` 不应因此降级。上游发布配方仍包含重打已发布 tag 的历史做法，项目规则明确不直接采用；上游文件保持原样。

## 验证与范围

已通过：`pnpm verify:skill`；更新器 5 项测试（预览、精确 blob、重复运行、本地修改保护、删除与 roster 拒绝等）；上游 inject-lint 25 项测试；workflow planner 自检。更新后再次预览应为 0 新增 / 0 修改；上游 hash/权限核验覆盖全部 120 文件。

未运行：目标依赖安装、AgentTeams build/typecheck、真实 Harness 激活、模型调用、数据迁移和浏览器回归。没有改变 AgentTeams 运行时代码、依赖版本、支持矩阵或用户 profile。结论是有源码证据的适配方案，不能充当新宿主兼容验收记录。
