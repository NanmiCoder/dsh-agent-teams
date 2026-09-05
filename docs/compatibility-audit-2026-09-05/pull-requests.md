# AgentTeams PR 积压审查与统一迁移建议

审查时间：2026-09-05。审查对象为 `NanmiCoder/dsh-agent-teams` 的全部 **25 个 open PR**，GitHub main = `232a338fc9a0d393f118912386f67e7f3a6c67d6`。用户本地工作树 HEAD = `da2e2e49242c6ecd7e801a74dba0c8268a0a2f81`；审查以远端 main 和每个 PR 的真实 head 为准，没有把工作区误当成最新代码。未修改工作区源码、未提交、未留言、未合并或关闭 PR。

方法：GitHub API 获取 PR 元数据、逐文件 diff；git 获取 PR refs，计算真实 merge-base；读取上游 `dsh-v0.1.2-rc.1` / `dsh-v0.1.2-alpha.2` 源码核对合同；#118 在隔离 archive 做 npm pack 文件清单验证。#130 的动态复现沿用前轮报告 `/tmp/dsh-pr130-review.uy7EDv/REVIEW.md`，本轮没有重新执行全部宿主/模型/UI验收。

## 核心判断

1. **这些 PR 不能按编号逐个合并。** #119、#124、#130 重写同一个成员生命周期与消息边界，而且目标版本、消息语义、旧版保留策略不同。应把它们作为同一迁移工作项的候选实现，合成一个明确针对已发布 rc.1 的方案；完成后才能把原 PR 标为已整合。
2. **#124 最值得借用生命周期方案，#130 不能直接作最终补丁。** #124 保留了模型选择、失败处理、备用模型和冷恢复桥；rc.1 tag 源码支持它采用的 `agent/session-start` 和 `Session.ownEvents()`。但 internal 队列是额外兼容面，不能从 alpha.5 测试推导 rc.1 或所有后续版本已兼容。
3. **发布治理比多写几处 feature detection 更紧急。** 当前全部 25 个 open PR 的 `statusCheckRollup` 都为空；main 只有 `.github/workflows/publish.yml`，没有面向每个 PR 的 CI 工作流。GitHub 的 `CLEAN` 仅是可合并性，不能理解为测试通过。
4. **几个标题/正文已经不能代表真实 head。** #93 的前端 API 改动已被 main 独立完成；#119 正文所说的依赖升级与测试替身迁移不在当前 diff；#86 正文仍说 registry 消失应重派，实际补丁已经反过来保护正常释放的 parked attempt；#48 不只改提示词，还放宽任务依赖验证。必须按当前 diff 审核和重写描述。

## 统一兼容 PR 的取舍

### 三份成员适配 PR

| PR | 当前实际变更 | 可取用部分 | 不可直接合并的原因 | 建议 |
| --- | --- | --- | --- | --- |
| [#119](https://github.com/NanmiCoder/dsh-agent-teams/pull/119) alpha.4 | 仅 `src/members.ts` 和 `docs/usage.md`，77 行成员新增；能力探测、`sendMessage/followup`、`agent/created` 和事件读取适配 | 将宿主差异收敛到 seam 的方向、投递 `.call(seam, ...)` 保留接收对象 | Alpha.2 fallback 的 `const register = ...; register(...)` 又丢失 `this`，而上游 Alpha.2 方法依赖 `this.ctx`；真实 diff 没有正文声称的 bump deps / sync mocks；读取 `snapshotEvents()` 然后用旧 `header.seedLength` 切片不是新的 ownEvents 合同 | 吸收思路，不能原样作为多版本基础；由整合 PR 替代 |
| [#124](https://github.com/NanmiCoder/dsh-agent-teams/pull/124) alpha.5 | pin 开发依赖 alpha.5、同步新宿主测试替身、`agent/session-start`、`ownEvents()`、internal FIFO host queue 与守卫 | 三者中生命周期覆盖最完整；同步安装模型选择/错误/fallback；真实方法接收对象被保留 | 明确不兼容 alpha.4 以下；静态 import `@deepseek-ai/dsh-subagent/internal` 使旧版加载前就失败，不能靠运行时分支解决；guard 只拦队列符号，不拦 `sendMessage`；宿主方法缺失时静默取消 retirement 保证；README 未更新为新基线；`pnpm-workspace.yaml` 留着 `set this to true or false` 占位值 | 以其生命周期思路作为 rc.1 整合基础，重新建完整 rc.1 依赖闭包并验收；删除安装占位配置，补明确支持策略 |
| [#130](https://github.com/NanmiCoder/dsh-agent-teams/pull/130) rc.1 | `sendMessage/followup` 能力探测，缺 setup 时提前返回，README 声称 rc.1 已桥接 | 对消息故障定位准确，发现版本漂移导致只进 mailbox 不唤醒 | 前轮实测确认 guard 丢 `this` 破坏 Alpha.2；no-op 关闭失败上报、fallback 和指定力度；公开 `sendMessage` 是 steer，旧 followup 是独立排队回合，不能只视为重命名；没有新测试 | 禁止直接合并；保留作者复现场景与贡献，在整合 PR 中解决 |

### 上游 rc.1 合同核实

以下是源码事实，不是 PR 作者主张：

- `packages/core/agent-loop/src/index.ts:623-630` 在 session/agent 发布之后同步发出 `agent/session-start`；`packages/core/agent/src/runtime-types.ts:214-224` 描述这是首 turn 前、每次 session lifecycle 一次的同步通知。`packages/core/agent/README.md:169` 明确它不能等待异步 composition；需要等待的逻辑必须在 factory setup。因而 #124 **同步** `readTeamSync` / `installModelSelection` / 注册事件的时机有依据，但不可把它扩成 async hook 并假设宿主会等它。
- `packages/core/session/src/index.ts:615-616` 的 `ownEvents()` 正式返回 `snapshotEvents(this.inheritedEventCount)`。它消除了对旧 header `seedLength` 的依赖，适合识别子代理自己的 descriptor，尤其要验证 fork 继承前缀。
- `packages/subagent/subagent/src/continuation.ts:517-562` 的公开 `sendMessage` 是 **model-authored** 的父子相邻消息，运行中采用 **steer**，在步骤边界接收；空闲时起新 turn、缺失子代理时冷恢复。
- 同文件 `queuePrompt` 以及 `src/internal.ts:68` 的 `queueHostSubagentPrompt` 是 **host/plugin provenance**、独立 FIFO turn。是 internal 子路径，模块注释明确在 public Service Definition 之外。它保留原调度投递语义，但依赖其稳定性必须显式记账。
- `startContinuable` 会把 `agentOptions.reasoningEffort` 写进 durable descriptor；整合实现应明确传入成员的已解析推理力度，避免 descriptor 与当前 model-selection override 产生两份不同设置。
- Alpha.2 `packages/subagent/subagent/src/index.ts:311-315` 的 `registerContinuableSetup` 调用 `this.ctx.effect`。#119 裸 `register(...)` 是确定的绑定错误，不是风格问题。

对应源码可用 [rc.1 源码树](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-rc.1) 与 [Alpha.2 subagent runtime](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/subagent/subagent/src/index.ts) 复查。

### 应锁定的行为合同

建立一个独立兼容边界，以能力而非散落的版本分支表示：生命周期 attach、子事件读取、host FIFO 投递、model steer 投递、成员中断/停止、retirement、子会话导航、UI registry、Web 鉴权。业务调度不直接使用宿主可变 API。

明确列出“必须成功才能启用团队”的关键能力。失败上报、模型选择、消息投递和退休阻止不应以一个 warning/no-op 悄悄关掉后继续让 UI 显示正常。若正式不支持旧 Alpha，则在引导/安装预检阶段给出完整宿主+插件匹配信息；如果要支持两个代际，应独立入口或包，避免旧宿主导入不存在的 `/internal` 子路径。

整合测试至少覆盖：真实服务方法 `this`；fresh 与 cold-resume + fork descriptor；显式 provider/model/reasoning/fallback；重试耗尽失败落盘/队长通知/调度收尾；idle/running/cold 三种投递；队列 FIFO 与 steer 的实际语义；retired 成员经插件、公开模型 send、Web 路径都不能误恢复（按产品承诺定义）；中断后 parked attempt 不旋转；真实打包安装+首次启动+历史回放。宿主依赖需要验证完整解析闭包，不能只有一个 CLI 版本标签。

## UI 服务相反修复：#93 与 #112

- [#93](https://github.com/NanmiCoder/dsh-agent-teams/pull/93) 要从 `conversationEvents` 迁移到 `uiConversation.events`；当前 main 已在 `bf50b49` 完成。其当前 head 的有效 diff 只剩开发文档/技能镜像、字符串断言，以及与 #90 完全相同的 Windows clean guard 改动。
- [#112](https://github.com/NanmiCoder/dsh-agent-teams/pull/112) 要改回 `conversationEvents`。正文称“核心没有 uiConversation”，这只可能是其旧宿主环境的事实，不能用于当前 Alpha.2/rc.1 支持线。把它合入 main 会撤回已验收的迁移。
- 建议：保留旧宿主受支持组合的安装说明，用统一版本门禁解决用户误装；不在 main 来回改全局 inject。#93 摘取文档/校验即可，#90 独立合并；#112 由配对安装与预检取代。

## 所有 open PR 处置表

“基线”是 merge-base 当时的插件 / Harness devDependency，不是 PR 标题声称的目标。顺序是建议，不表示已经执行合并或关闭。

| PR | 目标与实际基线 | 重叠/风险/证据缺口 | 建议处置与顺序 |
| --- | --- | --- | --- |
| [#130](https://github.com/NanmiCoder/dsh-agent-teams/pull/130) | rc.1 成员消息；0.1.15 / alpha.2 | 与 #119/#124 同边界；已有实际回归复现 | P0 整合替代，不能直合 |
| [#124](https://github.com/NanmiCoder/dsh-agent-teams/pull/124) | alpha.5 API 重构；0.1.15 / alpha.2 | 生命周期最佳候选，但 internal/static import/退役入口/占位配置/文档需处理 | P0 取其生命周期做 rc.1 整合 |
| [#119](https://github.com/NanmiCoder/dsh-agent-teams/pull/119) | alpha.4；0.1.15 / alpha.2 | 正文与 diff 不符；Alpha.2 register 丢 this | P0 整合替代 |
| [#112](https://github.com/NanmiCoder/dsh-agent-teams/pull/112) | 旧 UI 服务待激活；0.1.15 / alpha.2 | 撤回当前 uiConversation；没有完整旧版包回退 | P0 不合 main，用版本诊断+旧线指引解决 |
| [#93](https://github.com/NanmiCoder/dsh-agent-teams/pull/93) | UI 服务迁移；0.1.15 / alpha.2 | 主修复已由 main 完成；当前包含 #90 相同清理修复 | P1 先处理 #90，只留文档/断言或标已整合 |
| [#90](https://github.com/NanmiCoder/dsh-agent-teams/pull/90) | Windows build guard；0.1.14 / rc.8 | 独立两行修复，用 basename 代替 `/lib` 后缀；保留 exact-parent 检查 | P1 重基并跑 Windows 构建即可优先；有利于跨平台矩阵 |
| [#86](https://github.com/NanmiCoder/dsh-agent-teams/pull/86) | parked/cold recovery；0.1.14 / rc.8 | 当前实现保留已观察 parked attempt、未观察恢复一次且失败回滚；正文仍描述旧的 registry 缺失即重派。与 #74/#110 相邻 | P1 同调度回归包重基；先修正文，跑 rc.1 disposed/idle/失败投递用例，勿按旧正文采用错误策略 |
| [#74](https://github.com/NanmiCoder/dsh-agent-teams/pull/74) | #66 限流重试风暴断言；0.1.13 / rc.8 | 只把已有 parked 场景增强为 20 次 kicks，未实际注入真实限流错误 | P1 吸收断言进 #86/兼容矩阵，与 #110 真错误事件测试并列，不宣传为独立限流策略 |
| [#118](https://github.com/NanmiCoder/dsh-agent-teams/pull/118) | UI redesign + 轮询/错误提示 + host peers 链接；0.1.15 / alpha.2 | 17 文件近 3500 行变化；混入安装生命周期；postinstall 目标未打包（下文实测）；本机 symlink 改依赖破坏可复现；重叠 #82/#83/#84/#67/#38 | P1 阻止原样发布；拆安装/加载修复与 UI，UI 等兼容基线稳定后专项浏览器验收 |
| [#83](https://github.com/NanmiCoder/dsh-agent-teams/pull/83) | working 状态颜色 fallback；0.1.13 / rc.8 | 1 CSS 行+字符串断言；不是运行时版本适配；#118 重画相同面板 | P2 低风险独立吸收；在目标宿主亮/暗色实际看一次 |
| [#82](https://github.com/NanmiCoder/dsh-agent-teams/pull/82) | resize handles 可见性；0.1.15 / alpha.2 | 既有行为上的 CSS 手柄增强；#118 同一区域重叠；现有证据多数源码/CSS 签名 | P2 统一 UI 分支吸收，验证指针/触屏/窄屏点击不被遮挡 |
| [#84](https://github.com/NanmiCoder/dsh-agent-teams/pull/84) | 模型 badge；0.1.14 / rc.8 | 纯显示，保留 route 数据；与 #118 roster 重叠 | P2 与 #82/#83 归 UI 小改，防止大 UI PR 覆盖 |
| [#80](https://github.com/NanmiCoder/dsh-agent-teams/pull/80) | 团队历史隐藏/归档/永久清理；0.1.15 / alpha.2 | 11 文件，新增危险性高于显示功能的 purge / tombstone / generation / 路由；需保留 main Connection.requestRejection 鉴权；与 #118/#67 共享 UI/状态 | P2 独立功能迭代，不能夹在版本热修复；先审持久化/权限/恢复，再 UI |
| [#67](https://github.com/NanmiCoder/dsh-agent-teams/pull/67) | 自定义头像/上传/远程代理；0.1.13 / rc.8 | 21 文件+网络代理/上传/状态字段；GitHub DIRTY；和 #118 身份图形方向重叠；当前鉴权/新宿主需重基 | P3 产品决定头像策略后单独做，不进入兼容救火发布 |
| [#63](https://github.com/NanmiCoder/dsh-agent-teams/pull/63) | 一句 release note 语法；0.1.11 / rc.8 | 一行纯文档，不解决任何宿主兼容问题 | 随时小改吸收，无需挡在队列 |
| [#53](https://github.com/NanmiCoder/dsh-agent-teams/pull/53) | 中改英；0.1.8 / rc.6 | 当前 main 已正式 locale service + zh/en 字典；此 PR 仍硬编码英文替换，会偏离现行 i18n | 不整体合；需要的文档译文抽取，UI 部分按已被现方案替代处置 |
| [#48](https://github.com/NanmiCoder/dsh-agent-teams/pull/48) | 减少 token/轮询；0.1.7 / rc.6 | GitHub DIRTY；当前 main 已 no busy-poll。真实 diff 还允许不存在依赖 ID（TODO 承认永久 pending）且 create_task 一律自称已通知，与 staged 不执行相冲突；测试命令 npm test/lint 当前也不对应实际脚本 | 不整体合；仅提炼性能实验，保留 DAG 原子校验与 staged 语义后另做 |
| [#38](https://github.com/NanmiCoder/dsh-agent-teams/pull/38) | Better Sidebar tab；0.1.6 / rc.6 | 依赖第三方服务；旧 conversationEvents/body portal 路线与新 shell.overlay/locale/session API 偏离；大 lockfile 变化 | P3 在统一 client adapter 后重新设计可选集成，不能还原旧客户端 |
| [#37](https://github.com/NanmiCoder/dsh-agent-teams/pull/37) | focus prompt 模式；0.1.5 / rc.6 | 独立产品功能；声明 default false，但 apply 用 config.focusMode ?? true，描述/调用默认不一致；无当前 staged 流程测试 | P3 重基并明确默认，不能把提示词当硬通知保证 |
| [#34](https://github.com/NanmiCoder/dsh-agent-teams/pull/34) | 面板拖动与 3s 轮询；0.1.5 / rc.6 | 当前 main 已拖动/resize/位置持久化，并有 demand-driven discovery/live polling；原状态模型已过时 | 拖动部分按已实现处理；若仍要 3s cadence，应单独评估现控制器，不合旧大块 |
| [#32](https://github.com/NanmiCoder/dsh-agent-teams/pull/32) | github: 安装补 prepare；0.1.11 / rc.8 | 仍有实际安装路径需求，但 lifecycle scripts 是否执行由包管理器/宿主决定；不是 host API 修复；与 #118 安装脚本混合 | P2 纳入发布/安装规范：优先支持 registry tarball，明确源码构建；若保留 GitHub 安装要实测真实 dsh plugin 安装且打包可复现 |
| [#31](https://github.com/NanmiCoder/dsh-agent-teams/pull/31) | prompt/system persona placement；0.1.5 / rc.6 | GitHub DIRTY；成员构造和冷恢复与 #124 重叠；需要 provider 能力、preset 继承、工具限制、first turn/cold replay 测试 | P3 单独产品能力，待成员 adapter 后实现 |
| [#26](https://github.com/NanmiCoder/dsh-agent-teams/pull/26) | argv allowlist，被声称命令注入 | 当前脚本只有 readFile/writeFile 和 includes，没有 shell/subprocess sink；正文所称高危注入证据不成立 | 不按安全漏洞优先合；可当低优先 CLI 参数验证，或说明误报关闭 |
| [#21](https://github.com/NanmiCoder/dsh-agent-teams/pull/21) | 老日志 ignorable 修补；0.1.2 / 当时 peer ^0.0.1-rc.1（未固定 dev 宿主） | 真实历史修复需求独立于新 API；脚本原地重写，只有用户手动备份说明，按 JSON 字节前缀匹配，检查任意 ignorable 字样就跳过；需真实老格式与新 reader 双验 | 独立只读诊断+显式备份迁移工具再评估；不要自动触碰所有用户会话 |
| [#7](https://github.com/NanmiCoder/dsh-agent-teams/pull/7) | 新写事件 ignorable；0.1.0 / 旧宿主 | 自述依赖当时宿主尚无 writer 参数；main 已对未知事件直接省略并用磁盘/官方工具事件视图，不再生成同类坏日志 | 原样不合；已有预防路径，历史修复由 #21 专门负责 |

## #118 可复现发布缺陷

真实 head `c5839ed198a8f463e3c25c69c5d6d57c7d165853`：

- `package.json:80-81` 在 build 后运行 `scripts/link-host-peers.mjs`，并声明相同 postinstall。
- `package.json` 的 files 白名单没有 scripts。隔离 git archive 的 `npm pack --dry-run --ignore-scripts --json` 返回清单中 **scripts 文件为 0**，`scripts/link-host-peers.mjs` 不在包中。这次验证没有构建 lib，不影响脚本是否被 files 白名单排除的结论；它不是完整插件安装验收。
- 因而普通 npm tarball 执行 postinstall 时会找不到脚本。不能因为 checkout 内 pnpm build 成功就认定 registry 包可以安装。
- 脚本 `:39-40` 自动删除每个本地 `@deepseek-ai` 依赖位置、链接到 `$DSH_HOME/profiles/node_modules`，没有核对版本。即便补进发布包，也会把 build/安装结果变成由本机 profile 决定。应把需要的开发链接做成显式 opt-in 的独立命令，并验证真实 Module 单实例问题，不放全体用户的 postinstall。

## 已合并工作必须保留

- [#110](https://github.com/NanmiCoder/dsh-agent-teams/pull/110) (`232a338`) 已补最终传输失败置败、释放成员、队长通知及恢复协调。任何新的生命周期方案必须保留；#130 的 no-op 会绕掉这整组价值。
- [#109](https://github.com/NanmiCoder/dsh-agent-teams/pull/109) (`9848c52`) 已归一空串可选字段；不要把该问题误归类为 Harness API 漂移，也不要用旧 PR 整文件覆盖 tools。
- [#75](https://github.com/NanmiCoder/dsh-agent-teams/pull/75) 以及后续 staged workflow 改造引入计划批准前不 spawn、不执行、DAG 审查与失败回滚。旧 #48/#37/#31 等合并必须按现机制重写。
- [bf50b49](https://github.com/NanmiCoder/dsh-agent-teams/commit/bf50b49e89ac92ebf6ca414221904b8cc452409b) 的 Alpha.2 迁移已覆盖包注入、UI registry、类型导入、Web 鉴权、打包与实际历史/LLM验证。rc.1 整合不是只替换 members 方法名。

## 建议的合并工作流

1. 冻结兼容救火发布的功能范围，建立一个 rc.1 迁移 PR。贡献溯源保留 #119/#124/#130，禁止三份互相覆盖的补丁顺序合并。
2. 先加 PR CI 和 clean-profile 的打包安装门禁，再纳入 #90 Windows 修复、#93 文档和必要 release 通道/诊断更改。锁定宿主完整依赖闭包和 plugin tarball。
3. 将 #86/#74 的核心不变量放入当前 #110 生命周期测试，跑每个“支持组合”，同时验证 rc.1 的真实时间顺序。测试 fake 不能只跟着新实现换名字。
4. 兼容版本稳定后再合独立 UI 小改（#82/#83/#84）；#118 拆分且移除隐式本机依赖重连。归档/头像/侧栏/人格/专注模式进入正常产品迭代。
5. 对已被替代或错误方向的 PR 写清处置理由，再关闭；关闭 issue 以具体兼容组合与复现验收为依据。此次审查没有执行这些外部动作。

不能承诺永远不再适配上游破坏性变更；可以让不支持的组合在安装/启动即得到明确诊断，让 alpha 变更先在 opt-in 通道与 CI 中暴露，而不是普通用户通过卡住的任务来发现。

## 原始审查数据

- `/tmp/dsh-open-prs-20260905.json`
- `/tmp/dsh-pr-details-20260905/{number}-detail.json` 和 `{number}-files.json`
- `/tmp/dsh-pr-checks-20260905.json`（25 个结果全部无 check runs）
- `/tmp/dsh-merged-prs-20260905.json`
- Git refs：`refs/remotes/pr-audit/{number}`（仅审查用 refs，未切换用户分支）

## Head / merge-base 快照

| PR | head | merge-base | 落后 main commits |
| --- | --- | --- | --- |
| #130 | `620daa33c8dd813198451fb3fdfa46bd5a3b5bd6` | `232a338fc9a0` | 0 |
| #124 | `098e4e97ebc08096ca76c40c03e2e906d0fd1ef6` | `232a338fc9a0` | 0 |
| #119 | `cdb683e144e73a02ec829cb14554fb6cdd574eb6` | `232a338fc9a0` | 0 |
| #118 | `c5839ed198a8f463e3c25c69c5d6d57c7d165853` | `232a338fc9a0` | 0 |
| #112 | `66ea3d4f4339331fbde12b210dad6a11822c1ce1` | `232a338fc9a0` | 0 |
| #93 | `67d715975b9edf1492ea254805428148720d924b` | `232a338fc9a0` | 0 |
| #90 | `beab26a5e696e3a8e5479b84505bc9551a9b6077` | `5fe388f1a30d` | 11 |
| #86 | `420e7c31b2543ce9ac17f1c24f6562a82037af3e` | `5fe388f1a30d` | 11 |
| #84 | `70806fc12395b70806339bc686269056f7e45c31` | `5fe388f1a30d` | 11 |
| #83 | `19c62de8e5c0ea2aecfb5e064e375c05ebf0c979` | `b84d2beac7a5` | 17 |
| #82 | `b3b46ddc5c0f278933fbef471d2e08a8e26f2066` | `232a338fc9a0` | 0 |
| #80 | `8117825c017aa2a33e1f2badd202c52b165ba85d` | `232a338fc9a0` | 0 |
| #74 | `f9ad97aeb3582ab11524093c18513d8085a0170d` | `912aae5225d3` | 26 |
| #67 | `a14996eaea00017fd8ac431c815249b5855e35d4` | `912aae5225d3` | 26 |
| #63 | `53b49d5b668f27b1cdd5f69d7267d96c72dc80ec` | `0c21e5d2f45e` | 33 |
| #53 | `80839436accd2728b6e40b3d3ec5ee065c5ddf47` | `801954dd7be6` | 43 |
| #48 | `3384c38a618e7fc211c18c6e4575f2240592dc55` | `763d88f0d506` | 47 |
| #38 | `9f8a43f3d23f5176e4a28efec2c9221ebfeb25e4` | `00857a1f1a85` | 53 |
| #37 | `edba4102f18227fa433c03e04f23adbc3e3fa4f3` | `9a743c3b4faa` | 57 |
| #34 | `128b4a6d913d3b1ae5d7178da85937651e4994a8` | `9a743c3b4faa` | 57 |
| #32 | `82dda0f19f78f65ae13716166a0e6bf80b3a7a71` | `0c21e5d2f45e` | 33 |
| #31 | `ff3369241dbf9763e34e11292823d5d78a9d8713` | `2b1141248f34` | 59 |
| #26 | `b1ad00c2f12030e25898742228d2ea82cb71afed` | `64def8cbc303` | 66 |
| #21 | `f57096fefe2f04c12fc89d634c7748dfd329d776` | `7105ba9c1784` | 73 |
| #7 | `95c68dff9226461fa085093f2f1e9eead5e8e821` | `386656b97630` | 90 |
