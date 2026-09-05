# AgentTeams 最近 30 个 Issue：事实清单与根因归并

核查日期：2026-09-05。范围：按创建时间倒序，GitHub `issues?state=all` 中排除 pull request 后的最近 30 个 Issue，即 #97–#134 中的 30 条；创建时间覆盖 2026-08-29 03:41 UTC 至 2026-09-05 06:42 UTC。快照状态为 21 open、9 closed。已逐条读取正文，并读取所有有评论条目的全部评论。没有修改 GitHub Issue、评论或产品代码。

本报告是 Issue 证据审计；“强”表示报告含明确组合、错误/代码证据或维护者验证，不表示本审计重跑了该组合。远端 main 快照为 `232a338fc9a0d393f118912386f67e7f3a6c67d6`；本地工作区当时仍为 `da2e2e4`，因此修复状态以远端提交和 Issue 评论共同判断，不以本地旧文件推断。

## 可以直接得出的结论

30 条里，14 条以宿主 API 代际或发布渠道为主要问题，另有 2 条启动故障缺少版本/具体服务证据，不能直接并入兼容故障。其余为 6 条业务/安全/调度问题，1 条 Windows 验证环境问题，5 条功能建议，以及 2 条信息不足的报告。

版本故障集中在两个 API 断点：

1. 客户端 `conversationEvents → uiConversation`。旧插件装新宿主会等不到前者；0.1.15 装旧宿主会等不到后者。更新一端可能修好一组用户、打坏另一组用户。#107 把两种相反方向的事故混在一个帖子里。
2. 子代理创建/消息/会话生命周期重构。`registerContinuableSetup` 消失导致 boot 失败；绕过它以后 `followup → sendMessage` 和会话事件 API 变化还可能使团队“界面可开、实际不工作”。不能把“能启动”作为兼容验收。

渠道管理是放大器：0.1.15 面向已验收的 Harness Alpha.2，却以无 prerelease 后缀的版本号发布到插件 `latest`；老宿主可能通过插件更新或其他插件安装中的依赖处理拿到它。#126 直接要求调整这一政策；#107、#113、#128 提供实际用户影响。

## 逐条事实表

证据等级：**强**=明确版本与日志/具体复现/维护者验证；**中**=详细陈述但关键日志或独立验证不足；**弱**=标题/泛化症状，缺版本、步骤或根因证据。证据等级针对本行的根因判断；不同子结论可能有不同强度。所有关于历史支持组合的结论都是维护者记录，本次没有复跑历史宿主。

| Issue / 状态 | 具体版本与触发环境 | 主分类 / 根因归并 | 已有证据及边界 | 建议处置 |
|---|---|---|---|---|
| [#134 cannot restart after install the plugin](https://github.com/NanmiCoder/dsh-agent-teams/issues/134) · open | Windows；Node 24.20.0；未报宿主/插件版本 | 宿主 API：setup 钩子 | **中**。完整 boot stack 指向 `members.js:194 registerContinuableSetup`；与 #120 中同一用户的评论重复，但不能靠行号反推版本 | 作为 #132/#120 的重复现场；收集实际加载的 package 版本后归档 |
| [#133 预设无法删除](https://github.com/NanmiCoder/dsh-agent-teams/issues/133) · open | 全部未提供；新会话预设仍为 mathv4 | 证据不足：配置/业务待定 | **弱**。只有标题，正文为空 | 收集复现步骤、profile 路径、配置优先级和预设来源；不能归版本 |
| [#132 rc.1 fails to boot](https://github.com/NanmiCoder/dsh-agent-teams/issues/132) · open | dsh 0.1.2-rc.1；插件 0.1.15、另测 0.1.14；Windows；Node 22.20.0；web | 宿主 API：setup 钩子 | **强（故障）**。版本齐全、boot stack、独立 profile 降级测试；“任何可安装版本均不可用”超出了仅测试 0.1.14/15、检查 0.1.13 源码的证据 | 与 #127 合并跟踪 rc.1 完整迁移；不要继续推荐盲目降级插件 |
| [#131 rc.1 队长消息无法送达](https://github.com/NanmiCoder/dsh-agent-teams/issues/131) · open | dsh 0.1.2-rc.1；插件未单列版本，关联 #130 | 宿主 API：消息投递 | **强（症状）；中（未独立重跑）**。消息只进 mailbox，成员无新 turn，attempt 空转；明确旧 `followup` 与新 `sendMessage` 断点 | rc.1 迁移验收必须测“投递→成员新回合→状态更新”；#130 只能作为待审实现 |
| [#128 0.1.15 breaks Desktop](https://github.com/NanmiCoder/dsh-agent-teams/issues/128) · open | Desktop 内置 dsh 0.1.1-rc.1；插件 0.1.5→0.1.15，回退 0.1.5 可启动 | 旧宿主 + 新插件；渠道/依赖范围 | **中**。报告了 A/B 结果及 `pending uiConversation`，未附完整日志。正文猜测 setup API，但当前直接症状是前端缺服务 | 归入旧 RC 兼容线，明确精确锁版。评论推荐 #131 消息补丁不能证明能解决缺失 `uiConversation` |
| [#127 适配 0.1.2-rc.1](https://github.com/NanmiCoder/dsh-agent-teams/issues/127) · open | dsh/subagent 0.1.2-rc.1；插件 peer 为 `^0.1.2-alpha.2`，未单列插件版本 | 宿主 API + 声明范围过宽 | **强（断点）；中（现场）**。明确 setup 缺失，5 条评论多为 +1 或未验证 workaround | 可作为 rc.1 兼容主追踪，与 #132 共享验收；semver 满足不代表 API 相容 |
| [#126 npm latest 不应指 Alpha](https://github.com/NanmiCoder/dsh-agent-teams/issues/126) · open | 插件 Alpha 宿主适配线，未给版本 | 发布渠道政策 | **强（明确诉求）**。正文要求插件 latest 跟随 dsh latest；不是独立代码故障 | 纳入发布政策；但“跟随”应指经验证的组合，不能盲目跟随上游 dist-tag |
| [#125 captain 代 claim 未唤醒](https://github.com/NanmiCoder/dsh-agent-teams/issues/125) · open | 插件 0.1.15；dsh 0.1.2-rc.1；Web | 业务调度缺陷；可能被消息 API 故障放大 | **强（步骤）；中（根因拆分）**。明确 claim 返回 A、后续变 B、claimed 停驻，未重启即可出现 | 修好 rc.1 消息层后单独复现；保留“claim+dispatch 原子语义、同 attempt、失败回滚/显式 stalled”验收，不能按 #131 重复直接关闭 |
| [#123 alpha.5 boot failure](https://github.com/NanmiCoder/dsh-agent-teams/issues/123) · open | 主帖称插件 0.1.10–15；dsh alpha.5 `db6bdc3`；评论 Desktop 2.0.5 内置 subagent rc.1、默认插件 0.1.8 | 宿主 API：setup/message/session；Desktop 打包组合 | **强（故障）；中（兼容细节需源码复核）**。有 boot stack；评论称 0.1.15 renderer 可启动但服务端仍失败；提出 `agent/session-start`、`ownEvents()` 迁移 | 与 #120 同主断点；Desktop 必须记录壳版本+内置核心+profile插件。评论“守卫只损失模型选择”不能作为全面可用证据 |
| [#122 重启后成员不醒](https://github.com/NanmiCoder/dsh-agent-teams/issues/122) · closed | macOS Intel Web；未给具体宿主/插件版本 | 兼容问题的表象，作者归并 #131 | **强（后续归因）**。作者 09-05 明确“新版 dsh 不兼容”，指向 #131 后关闭 | 不按独立进程恢复功能重复实现；将“重启后恢复投递”保留为 rc.1 回归场景 |
| [#121 自定义角色图标](https://github.com/NanmiCoder/dsh-agent-teams/issues/121) · open | 未给版本 | 功能建议 | **明确需求**。标题+截图，没有兼容故障描述 | 独立产品 backlog，不纳入宿主迁移 |
| [#120 alpha.5 无法加载](https://github.com/NanmiCoder/dsh-agent-teams/issues/120) · open | 插件 0.1.15；dsh alpha.5；Windows 10；Node 24.18.0；Web/CLI | 宿主 API：setup 钩子 | **强**。完整组合、函数与行号，另有相同组合独立报告；影响所有加载插件树的 profile | alpha.4/5 与 rc.1 迁移可共用能力模型，但各精确版本要实测，不以“alpha.4+”无限放宽 |
| [#117 内存只涨触发 OOM](https://github.com/NanmiCoder/dsh-agent-teams/issues/117) · open | 未给宿主/插件/OS/内存指标 | 证据不足：资源泄漏/使用量待定 | **弱**。只有症状，没有 heap/RSS、回合次数、idle 后回收观测 | 增加可复现长任务、heap/RSS趋势与存活对象检查；不能断言 Harness 版本导致 |
| [#116 OrcaRouter provider](https://github.com/NanmiCoder/dsh-agent-teams/issues/116) · open | 无版本；商业 provider 集成提议 | 功能建议 | **明确需求**，非故障 | 独立讨论 provider 边界；不影响兼容修复优先级 |
| [#115 alpha.4 setup 被移除](https://github.com/NanmiCoder/dsh-agent-teams/issues/115) · closed | 插件 0.1.15；dsh alpha.4；Windows 11；Node 24.18.0；正文称 alpha.3 正常 | 宿主 API：setup + session events | **强（alpha.4）；冲突（alpha.2/.3）**。具体源码比较与故障；评论称 alpha.3 也失败，但检索包写成 `dsh-tool-subagent`，不能据此推翻 `dsh-subagent` 的支持矩阵 | 已关闭不代表发版解决；归并 #120/#123。alpha.2/.3 状态由真实 tarball与完整组合验证裁定 |
| [#114 长任务上下文膨胀](https://github.com/NanmiCoder/dsh-agent-teams/issues/114) · open | durable/continuable members；未给版本 | 功能建议：上下文生命周期 | **明确设计需求**，未提供具体版本回归 | 先确认宿主原生 compaction 能力和继承行为，插件负责传递当前任务/attempt等工作状态，避免实现第二套压缩引擎 |
| [#113 can't load](https://github.com/NanmiCoder/dsh-agent-teams/issues/113) · open | dsh 0.1.1-rc.2（正文 rc2）；插件 0.1.15 | 旧宿主 + 新插件：缺 uiConversation | **强**。明确版本及 pending 服务；5 条评论多数 +1，最后指向 #107 回退说明但称未验证 | 与 #128 共享旧 RC 处理指南；不能让用户升级插件 latest 解决 |
| [#111 Desktop 无法启动](https://github.com/NanmiCoder/dsh-agent-teams/issues/111) · open | macOS Desktop；未给壳/核心/插件版本 | 环境/生态组合；根因证据不足 | **弱（AgentTeams 根因）**。同时有 git-graph 插件 `settings.installSection` TypeError 和 AgentTeams renderer 无消息失败 | 隔离第三方插件并采集实际版本；不能把另一插件堆栈算 AgentTeams 兼容缺陷 |
| [#108 Windows verify flaky](https://github.com/NanmiCoder/dsh-agent-teams/issues/108) · closed | Windows 11 26200；Node 24.16.0；pnpm 11.21.0；插件仓库 v0.1.14/0.1.15 | 环境/测试时序 | **强**。文件锁持续约185–203ms，测试重试150ms；固定20ms等待不够。远端 main 有 `fa761ed1` 和 `6395dbfd` 对应修复 | 标为 main 已修复的测试可靠性问题；与 Harness semver 无关 |
| [#107 升级 alpha.1 后无法用](https://github.com/NanmiCoder/dsh-agent-teams/issues/107) · open | 多现场：旧插件+alpha.1；0.1.10→15+旧rc.2；另有alpha.2上auto-mode问题；后续alpha.4 setup故障 | 聚合贴：前端双向错配 + 渠道 + 多插件 + 新setup断点 | **强（多个子现场）**。维护者明确仅 Alpha.2+0.1.15 已验收，且 macOS rc.2+0.1.10 精确锁版验证通过 | 拆成问题矩阵和统一入口；保留来源链接。不能把整帖一次性标“升级0.1.15即解决” |
| [#106 Web 路由围栏](https://github.com/NanmiCoder/dsh-agent-teams/issues/106) · open | 插件 0.1.14；评论核对 0.1.15/bf50b49 | 安全/业务；一部分已修复 | **强**。后续评论修正早先判断：0.1.15 全路由已有宿主 Connection 围栏；残留 `/halt` body无上限 | 分清已解决鉴权与待做请求体上限；跨宿主适配不能因缺新 Connection 而静默放开路由 |
| [#105 reviewedTaskId空串破坏状态](https://github.com/NanmiCoder/dsh-agent-teams/issues/105) · closed | GPT-5.6-sol；未给宿主/插件确切版本 | 业务缺陷：输入/持久化校验不一致 | **强**。精确 payload、写入与读取校验路径；远端 main PR #109 合入修复 `9848c52e`，含严格校验补丁 `405327cb` | main已修复，需等发布并回归已损坏 durable state；不是换 Harness 即解决 |
| [#104 alpha.1 renderer boot](https://github.com/NanmiCoder/dsh-agent-teams/issues/104) · closed | 插件 0.1.14；host alpha.1；报告称 Desktop 2.0.4，Windows | 新宿主 + 旧插件：缺 conversationEvents | **强**。硬inject和pending根因；维护者确认0.1.15改uiConversation，但验收只有 Alpha.2/macOS | 已修接口需注明验收边界；不能将关闭解读成其原 Alpha.1/Desktop组合已实测 |
| [#103 idle重铸attemptId](https://github.com/NanmiCoder/dsh-agent-teams/issues/103) · open | 未给实际插件/宿主版本；引用lib/scheduler.js | 业务调度/可能旧版报告 | **中**。具体重复UUID机制和复现；评论指出0.1.13 `b3a2017` 已有parked闸，仍可能冷恢复/竞态 | 收集已装版本并用当前main复现；与 #125 合并设计验收，不能无条件重复旧补丁 |
| [#102 队列控制](https://github.com/NanmiCoder/dsh-agent-teams/issues/102) · closed | 未给版本 | 功能/宿主队列职责 | **中**。有队列优先级与清理需求；作者后续只写“Fixed by dsh”无具体版本 | 标记上游已处理的用户反馈；验证目标宿主公开队列能力再决定插件入口，不重复造队列 |
| [#101 Better Sidebar集成](https://github.com/NanmiCoder/dsh-agent-teams/issues/101) · open | 可选betterSidebar service；无版本 | 功能建议 | **明确需求**，提出可选服务、复用面板 | 独立功能；可以作为“可选能力不足时只关闭局部UI”的架构例子 |
| [#100 alpha.1 pending conversationEvents](https://github.com/NanmiCoder/dsh-agent-teams/issues/100) · closed | 插件0.1.14；Harness alpha.1；dsh-desktop0.7.0；Windows web profile | 新宿主 + 旧插件：前端服务/session变化 | **强**。完整版本、服务名与迁移建议；维护者已确认0.1.15在Alpha.2/macOS验收 | 与 #104 同根因，不重复实施；同样保留Desktop内置核心区别 |
| [#99 GPT空profile](https://github.com/NanmiCoder/dsh-agent-teams/issues/99) · closed | GPT-5.6-sol high；切DeepSeek v4-pro正常；插件/宿主未知 | 业务缺陷：可选参数空串 | **强（触发）；无版本归因证据**。两个用户确认；远端main #109处理 | 随下次包发布关闭交付链；与 #105 共用归一化边界 |
| [#98 安装后renderer失败](https://github.com/NanmiCoder/dsh-agent-teams/issues/98) · closed | Windows Desktop；未给壳/核心/插件版本 | 启动故障但根因不足 | **弱**。RendererStartupFailure没有缺服务名；维护者当时也明确无法确认，评论称先保留，但当前状态closed | 不能计为已证实conversationEvents故障或已验证修复；归档时写“证据不足” |
| [#97 全局并发和限流恢复](https://github.com/NanmiCoder/dsh-agent-teams/issues/97) · open | 7角色；provider限制2并发；无宿主/插件版本 | 业务调度/资源治理 | **中**。明确场景和429/quota后停驻，但无日志 | 单独并发预算/退避方案；429与insufficient_quota不能都无限自动重试；不归宿主版本迁移 |

## 每条 Issue 的整合去向

| 去向 | Issue | 边界 |
|---|---|---|
| 前端旧代/新版组合整合 | #100、#104、#107、#113、#128 | #107同时包含新版runtime和其他插件问题；旧RC组合必须精确列举，不能将rc.2+0.1.10的历史验证扩张到其他RC |
| 新版 runtime 整合 | #115、#120、#123、#127、#131、#132、#134、#122 | #134需补实际版本；#115 alpha.3证据冲突；#122作者已归并#131，保留重启测试 |
| 发布渠道政策 | #126 | 支持矩阵、明确选入Alpha、精确安装、旧profile迁移 |
| 独立业务/安全/测试修复 | #125、#103、#106、#105、#99、#108、#97 | #125需在消息层修复后再复现；#103需确认实际安装版本；#105/#99/#108是main已修复、尚未进入npm新包 |
| 独立产品功能 | #121、#116、#114、#102、#101 | #102已由报告人称上游修复，具体版本仍待核实 |
| 待补环境/复现 | #133、#117、#111、#98 | 不按兼容重复关闭：分别缺预设来源、内存证据、隔离插件环境、具体服务/版本 |

## 特别需要纠正的几种说法

- **#107 不是一个单一问题。** [维护者支持边界](https://github.com/NanmiCoder/dsh-agent-teams/issues/107#issuecomment-5474151892)明确仅验收 Alpha.2 + 0.1.15；[旧宿主受到连带更新影响](https://github.com/NanmiCoder/dsh-agent-teams/issues/107#issuecomment-5476293968)方向正相反。
- **不要把裸精确版本说成 caret range。** [一条跟进评论](https://github.com/NanmiCoder/dsh-agent-teams/issues/107#issuecomment-5477186617)称 `"0.1.15"` 后续会按 range 升到更高版本，不能据此认定 npm/pnpm 默认机制；必须核查安装器是否改写 manifest、原始 range 与 lockfile。维护者实际验证的 [--save-exact 锁版方案](https://github.com/NanmiCoder/dsh-agent-teams/issues/107#issuecomment-5476916163)更可靠。
- **`@deepseek-ai/dsh-tool-subagent` 与 `@deepseek-ai/dsh-subagent` 不能混为一谈。** [#115 跟进](https://github.com/NanmiCoder/dsh-agent-teams/issues/115#issuecomment-5512065690)用前者 tarball grep 没有某 API 来声称“所有 npm 组合均不可用”，不足以证明运行时服务的 API 不存在。其 Alpha.3 崩溃报告与[另一现场](https://github.com/NanmiCoder/dsh-agent-teams/issues/107#issuecomment-5498643761)冲突，需精确包树/实际宿主路径裁定。
- **仅 `registerContinuableSetup` guard 不等于功能无损。** [#123 评论](https://github.com/NanmiCoder/dsh-agent-teams/issues/123#issuecomment-5534203939)只充分证明客户端/boot层的改善；生命周期、模型路由、错误上报和投递要独立验收。尤其最新 main 刚合并的 #110 失败收尾功能也依赖成员生命周期挂钩，不能被一个 early return 一起关掉。
- **#122 不应再立项“重新spawn进程”修复。** [作者已归因 #131](https://github.com/NanmiCoder/dsh-agent-teams/issues/122#issuecomment-5549274724)。先修复消息API，再检验真正的重启恢复需求。
- **Issue 关闭、main 合入、npm 发布是三种状态。** 本次主审对照npm确认：最新插件仍为0.1.15，发布时间2026-08-31T05:23:05Z；随后main比发布提交da2e2e4多8条提交，#109/#110尚未进入新npm包。因此应分别标记 `fixed-in-main`、`verified-in-release`、`reporter-confirmed`。 #99/#105/#108 在 main 已有修复，npm 当前安装是否包含应另看发布审计；#115 关闭但后续同根因报告仍在增长；#98 closed 也没有确认根因的证据。

## 按根因统一处理，而不是按 Issue 各打一遍补丁

### A. 受支持宿主契约与发布渠道（覆盖 #126、#107、#113、#128，并防止其余兼容问题再扩散）

维护一个唯一的支持清单，列出实际核心精确版本、插件版本、前后端服务契约、支持的平台/profile、验收结果及交付渠道；README、package peer、CI和发布说明从这一来源生成。Desktop壳版本单独记录，不能替代内置核心版本。

普通用户用经项目验收的默认组合；Alpha使用者必须明确选入。插件`latest`不应把普通用户带进仅验证过的Alpha宿主线。上游即使把RC挂latest，也应等插件的对应组合验收，而不是自动宣布兼容。未支持组合应该有清楚诊断和恢复路径，安装程序应尽早阻止危险组合；缺少可选UI能力可以局部降级，缺少可靠消息/生命周期等核心能力不得假装启动成功。

仅改dist-tag还不够：已经存在的`^0.1.5`类范围仍可能选择更高的无后缀0.1.x版本；历史精确版本也不会因为改tag而自动变回去。迁移指南应同时覆盖精确锁版、现有profile修复、lockfile、实际加载路径和Desktop内置核心。

### B. 集中宿主适配层（覆盖 #100/#104/#107 与 #115/#120/#123/#127/#131/#132/#134）

业务层只使用稳定的内部接口，例如“注册会话卡片、读取成员自有事件、创建/恢复成员、投递消息、订阅成员错误和idle”。每一代宿主由对应适配器实现，所有能力探测只在这里进行。不要在工具、调度器、UI多处添加独立 `typeof` 补丁。

适配器返回结构化能力及支持状态；保留方法receiver，区分mailbox持久化成功与实时投递成功。队长收到“已投递”时，必须有明确语义，而不是吞异常后仅写JSONL。关键能力缺失时输出实际核心版本、插件版本、缺失能力、已验证的升级/回退组合；不能拖死整棵宿主插件树，也不能静默注册一套无法工作的业务工具。

### C. 业务不变量（#125/#103、#105/#99、#106、#97）

这些需要独立修复，不会因支持新的Harness版本自动消失。尤其 claim与dispatch必须共享同一个attempt，允许的重试要有理由与预算；输入验证和持久化读取必须接受同一状态集合；跨宿主鉴权适配不许降级为开放端点。

### D. 生命周期与资源治理（#114/#117/#102/#97）

优先复用宿主公开的压缩、队列、取消、错误和重试能力，但插件负责跨成员的并发预算与业务状态。性能问题必须先收集最小可重复场景和内存证据，不能从“上下文很大”推断成“内存泄漏”，也不能以版本升级覆盖排查。

## 最小验收矩阵建议

每个声明支持的精确宿主版本都跑已打包npm tarball的安装与运行测试，不仅跑针对一种API形状的mock或TypeScript编译。至少包含：

1. 干净profile安装、添加其他插件后重新安装、启动与重启；记录实际加载路径、锁文件、所有相关@deepseek-ai包版本。
2. 客户端卡片/面板、会话列表、成员跳转、返回队长；无永远pending的硬inject。
3. 成员创建、指定provider/model/reasoningEffort、冷恢复后保持；错误发生后的备用路由、最终失败、队长通知、释放调度。
4. 队长→成员→队长消息，成员idle后再次唤醒，重启后再次投递；消息不只进入mailbox。
5. claim→dispatch→in_progress→completed，同attempt不被无原因轮换；投递失败的可见状态与有界恢复。
6. `/state`、`/halt`、`/plan`、`/assets` 的真实认证边界与请求上限。
7. 不支持版本的清晰失败/安全禁用，不破坏宿主启动；Windows/Desktop设单独验收等级，不用macOS CLI结果冒充。

## 原始材料

- `/tmp/dsh-issue-audit-raw-20260905.json`：GitHub最近100条issue/PR API快照。
- `/tmp/dsh-issue-audit-30-20260905.json`：排除PR后的30条Issue正文快照。
- `/tmp/dsh-issue-audit-comments-20260905.json`：本范围内全部Issue评论快照。

以上只读核查产物可用于制定处置计划；未发布任何新Issue、评论、关闭操作或npm变更。
