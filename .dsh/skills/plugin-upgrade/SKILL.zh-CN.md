[English](SKILL.md) | 简体中文

# plugin-upgrade

安全完成三类任务：只读更新检查、已安装插件升级、DSH 宿主版本兼容迁移。若用户意图
不明确，先确认模式；不要从“帮我看看更新”自行滑入安装或改代码。

## 第 0 步：选择模式

| 模式 | 用户意图 | 允许的默认动作 |
|---|---|---|
| A · inspect | 检查更新、判断是否受某版 DSH 影响 | 只读调查与报告；完成后停止 |
| B · update | 把已安装插件升级到明确版本 | 先计划和确认，再改 composition/依赖 |
| C · author-migrate | 插件作者把自己源码仓适配到新版 DSH 宿主 | 先跑基线、建版本走廊和触点清单，再实施已授权迁移 |

本 skill 不负责“只升级 DSH core 且不处理插件”；也不允许修改 DSH core 来掩盖插件兼容
问题。

## 全局 DSH 宿主升级（代理纪律）

升级 dsh 宿主本身（`npm install -g @deepseek-ai/dsh@…`）不属于模式 B/C 的插件工作——而且当发起请求的代理本身就运行在 dsh 会话**内部**时，这是结构性致命操作：会话就是宿主进程，npm 会拆除它正在执行的包树，宿主在安装中途死亡（工具调用不会有结果返回），中断的安装留下「包内容在、shim 未重新生成」的残缺状态——`dsh` 命令本身失效，只能靠外部钉版本的重新安装修复。绝不要在运行于该宿主上的会话内部执行全局宿主升级；把外部流程交给用户：

1. 完全停止所有 dsh 进程（运行中的宿主持有原生模块文件锁 → EBUSY；刷新浏览器不等于停止宿主）；
2. 在**外部**终端执行钉版本的安装 `npm install -g @deepseek-ai/dsh@<精确版本>`（裸包名会解析到 `latest` dist-tag，可能静默降级到旧线）；
3. 重启 `dsh web`、浏览器硬刷新，核验版本标记与插件。

因为 npm 运行前宿主已完全停止，安装中途不会有任何进程崩溃——升级过程中的崩溃是做错了的标志，而不是需要容忍的风险。若安装已被中断：在外部 shell 重跑钉版本的正式安装修复（绝不手动复制包目录或手写 shim）。

## 通用只读准备

1. 阅读目标仓库的 `AGENTS.md` / `CLAUDE.md` 等规则；检查 branch、HEAD、working tree、
   submodule。发现陌生修改或未跟踪文件就停止并报告，不自动 stash/reset/clean/checkout。
2. 分开记录代码来源与安装身份：registry 包、Git checkout、workspace/junction 或复制安装；
   记录来源仓库/URL、Git SHA、实际包名、插件自身版本、declared/resolved DSH 依赖 cohort
   与当前 DSH/Node 版本。插件发版版本（如 `0.6.4 → 0.7.0-alpha.0`）不是 DSH 宿主走廊
   （如 `0.1.0-rc.6 → 0.1.2-alpha.4`）。GitHub
   owner/repo 与 registry scope/package 是独立坐标，不能从前者推导或改写后者。
3. 区分文件所有权：
   - `package.json` / lockfile：包与依赖；
   - `dsh-plugin.json`：社区标准 manifest（若采用）；
   - `cordis.patch.yml` / `agent.cordis.yml` / 历史 `cordis.yml`：profile composition；
   - resolved config：运行时组合结果，只用于核对，不整对象回写。
4. 核对目标版本来源、tag/包名、兼容范围、release notes、安装脚本与已知 breaking changes。
   不读取、打印或提交 token、`.npmrc` 内容、凭据或会话日志。
5. 记录回滚基线：当前 HEAD/包版本、lockfile 与将改配置的 hash/路径；说明失败后如何恢复
   本次明确路径，不要承诺回滚第三方安装脚本的任意副作用。

## 模式 A · inspect（只读）

输出：当前/可用版本、来源、兼容范围、breaking changes、建议目标、风险与验证计划。不得
改文件、安装依赖、执行 lifecycle script、`git pull` 或切换版本。用户若决定执行，再进入
模式 B 或 C 并单独确认。

## 模式 B · update（升级已安装插件）

1. 按实际解析的包身份与安装轨选择唯一更新方式；有 lockfile 时只使用对应包管理器，不混用
   npm/pnpm/bun，也不为匹配 GitHub owner 而改写 registry 包名。
2. 生成变更计划：精确目标版本、将执行的命令、会改的文件、可能执行的生命周期脚本、
   配置迁移和回滚步骤。
3. 任何写入或安装前取得用户明确确认；即使没有 breaking change 也一样。
4. 在独立 branch/worktree 中做最小修改；配置用路径级 patch，保留未知字段。Git 来源先
   fetch/比较明确 tag 或 commit，不对脏工作区直接 `git pull`。
5. 安装依赖成功不等于 DSH 已启用插件；核对目标 profile 的 composition 确实解析到目标包，
   若存在则移除本次升级拥有的旧来源行，并确认运行时 entry active。
6. 按“验证与报告”执行；失败时只恢复本次拥有的路径并报告残留副作用。

## 模式 C · author-migrate（插件作者升级源码仓）

0. 先跑 baseline：在仓库自身依赖状态（不 pin 目标、不设目标 env）运行机械套件
   （build / typecheck / tests；属运行包脚本，先按安全边界展示将执行的命令并取得
   确认），记录 pre-existing 失败为豁免清单（做法见
   [references/rollup-0.1.2.md](references/rollup-0.1.2.md) R-06，后续走廊同理）。
   迁移不得新增或恶化失败；pre-existing 失败按 baseline 豁免。
1. 用精确 tag 确认 from/to；按 [references/README.md](references/README.md) 的
   `from → to` 元数据连接版本走廊，禁止按文件名字典序。起点早于最早卡片时，将缺失段标为
   unsupported gap，改用精确 tag 源码、packed 声明和可复现测试取证，不能假装后续卡片覆盖它。
2. 先读完整走廊并计算最终净状态。字段在中间版本删除、目标版又恢复时，不先删再加。
3. 按 [pre-flight.md](references/pre-flight.md) 扫描七类触点：源码 patch、事件、服务/
   Remote、宿主文件系统、UI/命令/工具、自建通道、子进程/输出。可先运行只读
   [migration planner](scripts/README.md) 生成路径/行号与候选卡，但结果仍是
   启发式；零命中仍须检查依赖/导入并跑 build 与真实挂载。
4. 只保留与命中触点和实际 face（Host/Web Client/普通 plugin）相交的卡片。卡片是 curated
   清单，不是完整 API diff；缺走廊边或 API 坐标时标 unsupported/待确认，不凭记忆改。
5. 生成按 Host / Web Client seam 分组的源码迁移计划，列命中文件、卡片、目标行为与测试；
   取得确认后再在独立 branch/worktree 实施。`package.json` 与 lockfile 必须保持精确且同一
   DSH cohort；安装成功但旧新 peer 混装不算完成。selector 或 callback 意外变成 `any` 时，
   临时用 `skipLibCheck: false` 做一次诊断，并把实际声明所有者补成直接依赖。`capability`
   卡仅建议，不自动采用。
6. 兼容修改通过后，单独确定并修改插件自身 SemVer；核对 packed 文件名和 packed manifest
   都是该插件版本，不能误把宿主 DSH 版本当成插件发版版本。涉及删除
   `dsh-client-runtime`、keyed chat snapshot、命令执行签名或 Workspace 导航
   （`connectWorkspace` / `pickDirectory`）时，使用
   [alpha.2 API ledger](references/api-migration-0.1.2-alpha.2.md) 与
   [DSH-0.1.2-A1-32](references/v0.1.2-alpha.1.md)。

## 安全边界

- 所有写文件、安装、拉取/切换版本、运行包脚本的动作都要先展示并确认；
- 不自动 stash/reset/clean/强制更新，不覆盖用户或其他 Agent 的工作；
- 不泄露凭据；诊断只报告是否配置及非敏感版本/来源；
- 不把未知 `gateway/internal` 或其他失败默认重试；仅在错误可重试、操作幂等且策略允许时重试；
- 迁移方式不能由一手来源或可复现行为高置信确定时，停止自动修改并标「待确认」；
- 本地观察与一手来源冲突时并列记录、复现并上报，不静默选择一方。

## 验证与报告

至少按适用层级验证：

1. 依赖解析：对应包管理器、lockfile 与依赖图只发生预期变化；扫描完整 lockfile 中的旧
   DSH cohort 和已删除包，不能只看顶层依赖；
2. 启用解析：目标 profile 的 composition 指向预期包身份，且无旧来源或重复 row；
3. 静态：build、typecheck、插件测试；
4. 运行时：真实 DSH profile 冷启动、entry activate、依赖/提供的 Cordis service 不停在
   pending——[verify-runtime.mjs](scripts/verify-runtime.mjs) 在隔离 profile 里端到端执行该层并输出失败归因（plugin-code / dependency-resolution / profile-config / dsh-runtime）；Web Client 插件还要用打印出的 token URL 换 Cookie，读取宿主 boot manifest，
   请求宿主公告的客户端产物并证明注册/挂载，不能把裸 HTTP 200 当完成；
5. 行为：执行一条插件核心路径；宿主迁移至少完成一次消息→工具→回复，或等价专用流程；
6. 包装器：核对退出码、stdout、stderr、取消与 teardown。

报告固定分为：

- **pre-existing**（模式 C 且已跑 baseline 时；其余模式注明「未采集」）：来自
  baseline 的失败清单（未触碰、不归因于本次迁移）；
- **已完成**：版本、文件、卡片与验证；
- **跳过**：未命中或不适用及依据；
- **待确认/残留风险**：缺来源、未跑平台、生命周期脚本副作用；
- **回滚**：已记录基线与可恢复路径；
- **建议**：可选 capability 和迁到公开 seam 的后续工作。

## 参考材料

| 文件 | 内容 |
|---|---|
| [references/README.md](references/README.md) | 版本走廊、卡片 schema 与维护规则 |
| [references/pre-flight.md](references/pre-flight.md) | 七类触点自查与汇总模板 |
| [references/troubleshooting.md](references/troubleshooting.md) | 迁移后症状 → 根因 → 卡片 / 走廊配方速查 |
| [references/v0.1.1-rc.1.md](references/v0.1.1-rc.1.md) | rc.8→rc.1 草稿卡：repository-plugins 机制移除、`dshClient`→`dsh.client` manifest 合并、client-modules 扫描 → bundle `dsh.client`、严格注入 + 弱 `ctx.get`、session 事件契约、自渲染 client 会话聚合、`tasks.peek` 移除、0812 服务改名（vlln 插件迁移；走廊为 0810–0812 内测快照窗口的最近公开 tag 对齐，待上游复核） |
| [references/v0.1.1-rc.2.md](references/v0.1.1-rc.2.md) | rc.1→rc.2 reviewed 卡（3 张，`DSH-0.1.1-R2`） |
| [references/v0.1.2-alpha.1.md](references/v0.1.2-alpha.1.md) | rc.2→alpha.1 curated 卡 |
| [references/v0.1.2-alpha.2.md](references/v0.1.2-alpha.2.md) | alpha.1→alpha.2 curated 卡 |
| [references/v0.1.2-alpha.3.md](references/v0.1.2-alpha.3.md) | alpha.2→alpha.3 curated 卡（2 张）：A3-01 新增 `settings.plugin.item` keyed-slot 设置卡能力（首批真实集成）；A3-02 移除可选 SQLite Session 持久化后端（opt-in 部署的旧库需用旧版导出）；含核对记录 |
| [references/v0.1.2-alpha.4.md](references/v0.1.2-alpha.4.md) | alpha.3→alpha.4 curated 卡（6 张）：`report` 工具包删除改用 `send_message`、Python code-runtime 包改名、`Session.events` 换成 `seq`/`eventAt`/`snapshotEvents`、`SessionSeq`/`SessionLogOffset` 强类型 + `seedLength`→`isSeeded`、PTC 预设不再暴露 `workflow`、base bundle 默认开 `web_fetch`；含三台真宿主核对记录 |
| [references/v0.1.2-alpha.5.md](references/v0.1.2-alpha.5.md) | alpha.4→alpha.5 curated 卡（3 张）：storage 域新增可选 `compatibleVersions` 读兼容与 `invalidRecords: 'backup-and-skip'` 兜底；修复 rc.2/alpha.3 时代旧家升级 alpha.4 后拒启/会话列表标题丢失；含 storage 层复现核对记录 |
| [references/v0.1.2-rc.1.md](references/v0.1.2-rc.1.md) | alpha.5→rc.1（0.1.2 系列首个候选版，0 张卡：纯版本号 bump、无插件面变更；含核对记录与 release notes 覆盖矩阵——把 rc.1 汇总 notes 对照到既有卡片并给出回填候选） |
| [references/v0.1.3-alpha.1.md](references/v0.1.3-alpha.1.md) | rc.1→0.1.3-alpha.1 卡（8 张，draft）：A1-01/02 session-log 走廊（release tarball 实测：v0→v1 迁移器拒读 0.1.2-alpha.x writer 日志、跨版本 resume cursor 报错，tag 对齐待上游复核）；A1-03 Windows 安装 fs-ext 原生构建失败，无 MSVC，pnpm patch 方案，单机实测；A1-04…06 钉 git tag：出站 HTTP(S)/ALL_PROXY 启动代理（`dsh-http-proxy`、`$DSH_HOME/.env` 家目录层）、Session 持久化 `SessionHandle` + 异步 `agentLoop.create()` + 每 session 锁、Session 日志格式 v2 + 相邻代迁移目录；A1-07/08 未发布 cohort 源码宿主验证配方与 composer/read_image 运行时复核 |
| [references/v0.1.3-alpha.2.md](references/v0.1.3-alpha.2.md) | 0.1.3-alpha.1→0.1.3-alpha.2 curated 卡（5 张，draft）：persona 配置拆前缀/后缀（`text`/`persona` 键与 `PERSONA_SECTION` 移除）、`SubprocessHandle.pid` 移除、base 不再默认挂 `tool-str-replace-editor`、launcher `runCli()`/`import.meta.main` 门控、pi-ai `^0.84.2`→`^0.85.1`；0.1.3 首个 npm 版本（npm 升级需先读 alpha.1 走廊） |
| [references/v0.1.5-alpha.1.md](references/v0.1.5-alpha.1.md) | 0.1.3-alpha.2→0.1.5-alpha.1 curated 卡（20 张，draft，版本号跳跃边）：Session 格式 V3（`session-format-v2-to-v3`、`EpochHeader.system` 移除、不支持降级读取）、`ctx.agent` 移除 + 显式 `AgentSetup(agentCtx, agent)`/`parentAgent`、`Inbox` 改为 `agent.inbox` 类型接口、会话事件校验收紧、PTC 改名、token-meter 导出移除 + `contextBreakdown` stateVersion 4、system prompt 入消息历史、转发的 scoped Remote 事件必须带 Agent、CLI 拒 `--profile desktop`、`--from-default-profile`/`loadProfileDirectory()`、文件面 `workspaceFiles`/`readByteRange`/`/api/file` + 文件地址助手、`goal/activation-changed` + 暂停目标拒绝模型恢复、`fs-ext`→`node-addon-system` 打包变更、Web Client `details`→`rightbar` 重构、注入面签名变化、右栏/资源扩展点、文件链接走右栏、`tool-subagent` scoped-preset 要求、host SSH/目录选择器/指令发现 seam；A1-20（真机已验证）：npm 全局原位升级后 combo 可能漏发新增 bundle 模块——一个模块缺失即导致全部 client 插件注册失败，重启宿主可自愈 roster/combo 错位 |
| [references/v0.1.5-alpha.2.md](references/v0.1.5-alpha.2.md) | 0.1.5-alpha.1→0.1.5-alpha.2 curated 卡（24 张，draft）：`workspaceFiles` 去掉 `Agent` 首参、改查 Typert `workspaceFileScope`（client resource 类型、`reload`/`restat`、`absolute` scope 授权）、文件读取不再限制在工作区根内（新增 `maxFileBytes` 上限与 `readAll`/`readRelated`）、`conversation` 槽位迁到根级 `main` 并新增 `sidebar.panellist`、minimal profile 只保留持久 shell、两个不可忽略的会话事件（`deliverables/presented`、`subagent/catalog`）、`dsh-llm-pi-ai` 配置/类型变更、工具指引按 scope 可见集生成、`present`/reveal 交付面、文档预览与 `ui-sidebar-textpreview`→`ui-sidebar-documentpreview` 改名、新增 `chunked-list`/`tool-present` 包、MCP 分页 cursor 重复即拒绝、session-format-status 文档；另有客户端/打包面 12 张：`rightbar` 变根级 + 新增 `rightbar.session`、layout service/store 重写（`selectPanel`/`beginNavigation`/`usePanelInfo`）、`client-resources` 删除 `reload`、`ui-primitives` 改 `FileTypeIcon`/`classifyFileType`、`ui-dockkit` 契约漂移、`ui-message-feedback` 注入面重写、`ui-workspace` 新增 `openSession`/`openWorkspace`/`forkSession`、`ChatFileMentions.forClosing(owner, sessionId)` 与交付 turn tail、浏览器侧依赖迁 `devDependencies`、`ctx.documentPreviews` 注册表、`ActionSpec` action 命令、`command-feedback` 子路径导出 + `sessionFeedback` Host Remote、右栏默认页延迟 seed 与关闭规则；09-09 起已上 npm |
| [references/v0.1.5-rc.1.md](references/v0.1.5-rc.1.md) | 0.1.5-alpha.2→0.1.5-rc.1 curated 卡（5 张，draft）：base 默认模型 id 改成 `deepseek-flash`；`deepseek-flash`（V41 Flash）进入适配器目录（支持图片、`systemPromptUpdate: 'in-history'`、不探测网关可用性）；文档渲染器新增必填 `scrollportRef`；侧栏 guide 条目新增可选 `description`；含"未改动面"负面证据与 17 仓库舰队核对记录。本边仅 17 个提交 |
| [references/v0.1.5-rc.2.md](references/v0.1.5-rc.2.md) | 0.1.5-rc.1→0.1.5-rc.2 draft 卡（6 张）：反馈面注入契约去掉 `toggle`/`acknowledge`、`openDialog` 新增必填 `rating`、`MessageFeedbackToggleResult` 从导出移除（取代 alpha.2 反馈卡片的注入面部分，该边仍在开放 PR 中）；点赞/点踩都改为弹窗确认，提交失败变成 6s 警告 toast；`FileTypeIcon` 的 48 个代码分类图标换成设计导出的注入式 artwork（每实例 `dsh-code-icon-*` id）；回合尾动作条与文件区间距成为 20/16/20px 书面契约；`service-stability` 中英文文案改字；并附负面证据——该边没有任何宿主面包发生行为变更（334 个文件里 272 个是版本号）。注意：npm `latest` 仍指向 0.1.5-rc.1，rc.2 在 `next` 上 |
| [references/v0.1.6-alpha.1.md](references/v0.1.6-alpha.1.md) | 0.1.5-rc.2→0.1.6-alpha.1 draft 卡（38 张，目前最宽的一条边：800 个提交 / 4015 个改动文件）。宿主面：`agent/session-start` 删除、`agent/created` 改串行且可等待、`auditStartupEntries` 取代 `assertEntries*`、会话事件同步读取弃用、新增 `registerMessageProjection()`（未注册纯解释器即拒读）、`session-log-deepseek` 默认上传。运行时：`codeRuntime`→`ptcRuntime` 且 `run` 拆成 `resolve`/`run`、`SandboxProvider.confine` 与 `ShellExecutor.start` 异步化、子进程新增 `terminalEnvironment()` 与可选控制通道、`workflow-ptc` 取代 worker-thread、MCP 升 2.0 SDK、新增 `ctx.mcpResources` 与 `ctx.ssh`。LLM：适配器改为上报 `IMAGE_OFFLOAD_REQUIRED`、`deepseek-official` 默认 Anthropic Messages 协议、图片进 v41 token 网格、投影 stateVersion 5、`AssistantProvenance`→`AssistantProviderMetadata`。客户端：provenance→producer/provider metadata、`CommandClaim.name` 必填、新增 `conversation.input.permission` 与 keyed guide slot、`ConnectionIndicator.reconnectLabel` 移除、diff 带上下文、`?fixture` 模式被装配测试层取代。打包面：base 用 `ptc-runtime`+`workflow-ptc` 换掉 `workflow-worker-thread`、默认挂载 `image-offload`（`image/offload` 必读）与 `mcp-resources`、默认关闭 `tool-ralph`、Web 包去掉 `code-runtime` 行、+22/−7 包账单、headless `--session-id`/`--json`、公共包清单重建、实验包改黑名单发布、`node-addon-require-builtin` 下限 `^0.1.4`→`^0.1.6`；并附"未改动面"负面证据（`SESSION_FORMAT_VERSION` 仍为 3、Node 下限与启动器 CLI 语法未变） |
| [references/api-migration-0.1.2-alpha.2.md](references/api-migration-0.1.2-alpha.2.md) | rc.2→alpha.2 精确接口 ledger；命中 API、Remote、Settings、事件、Headless、打包或 composition 时读取；含 client runtime 移除与 keyed chat snapshot（API-10） |
| [references/rollup-0.1.2.md](references/rollup-0.1.2.md) | 0.1.1 → 0.1.2 走廊（rollup）：跨 cohort 共存、未发布 cohort 安装、`RemoteResult` 错误流、迁移前 baseline 归因、boot race 有界重试、base-only preset 前置、类型面导出漂移、宿主自身安全边界、安装通道三坑（镜像延迟、pnpm 11 供应链规则、peer 下限 prerelease 语义）、分层验证清单；基于 rc.1，正式版需复核 |
| [references/precision-checklist.md](references/precision-checklist.md) | alpha.2 静态迁移精度清单：peer 下限、运行时模块组合与类型声明、locale 配对、通道认证与协议保留、落地纪律与引用；配合 [scripts/inject-lint.mjs](scripts/inject-lint.mjs) 做残留/peer 检查与人工路由复核候选 |
| [scripts/README.md](scripts/README.md) | 只读 migration planner：扫描目标仓库、连接卡片走廊并输出候选迁移计划 |
| [examples/legacy-plugin/](examples/legacy-plugin/) | 七类触点静态夹具（不得执行） |
| [examples/08-real-web-client-alpha2-migration.md](examples/08-real-web-client-alpha2-migration.md) | 从更早 unsupported 走廊迁移 Host + Web Client 源码的真实样本 |

规范背景：[dsh-community-standard](https://github.com/oh-my-dsh/dsh-community-standard)
负责 manifest、契约坐标与协商；本 skill 处理现有插件的实际升级，引用其分类而不重定义
规范语义。官方征集出处见 [deepseek-harness discussion #5120](https://github.com/deepseek-ai/deepseek-harness/discussions/5120)。
