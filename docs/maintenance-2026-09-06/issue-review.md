# 41 个 Issue 的逐项事实复核与评论草案

起始输入为主任务抓取的 41 个 open issue；本轮重新查询 GitHub 后为 40 个 open，#89 已随 #90 合并自动关闭。主任务已合并9个外部PR并同步至 `f18676d`，核心rc.1适配仍在实施，尚不能声称新兼容包已发布。

本文只作事实复核和评论草案，未对外写入。关闭重复/问答不等于修复完成；含独立验收条件的功能和故障继续开放。所有评论在实际发送前应由主任务根据已完成检查更新，尤其 #106/#125/#78。

## 重要核查结果

- #78 的工具描述仍与 usage 提示矛盾，不能把现有 no-busy-poll 一句视为完整修复；已通知主任务。
- #54 的名字差异属实，但精确 rc.1 CLI 未发现所称官方 plugin check；不凭未核实规则更名。
- #79/#77 有历史修复提交、已发布版本及本轮通过的相关回归，可限定原症状关闭。
- #17 当前 npm badge 实测正常返回 v0.1.15。
- #114 的上游 compaction 模块确实存在且 base 默认启用，但还需真实成员继承/状态保留验证。
- #62 持久探针/Parallel Emission、#97 全局并发、#59 工具策略、#70 附件等仍是独立功能，不能通过版本升级宣称完成。

## 操作总览

| Issue | 建议动作 | 当前状态 |
| --- | --- | --- |
| [#134](https://github.com/NanmiCoder/dsh-agent-teams/issues/134) | `close_duplicate` | OPEN |
| [#133](https://github.com/NanmiCoder/dsh-agent-teams/issues/133) | `keep_needs_info` | OPEN |
| [#132](https://github.com/NanmiCoder/dsh-agent-teams/issues/132) | `keep_fix` | OPEN |
| [#131](https://github.com/NanmiCoder/dsh-agent-teams/issues/131) | `keep_fix` | OPEN |
| [#128](https://github.com/NanmiCoder/dsh-agent-teams/issues/128) | `keep_fix` | OPEN |
| [#127](https://github.com/NanmiCoder/dsh-agent-teams/issues/127) | `keep_fix` | OPEN |
| [#126](https://github.com/NanmiCoder/dsh-agent-teams/issues/126) | `keep_fix` | OPEN |
| [#125](https://github.com/NanmiCoder/dsh-agent-teams/issues/125) | `keep_fix` | OPEN |
| [#123](https://github.com/NanmiCoder/dsh-agent-teams/issues/123) | `keep_fix` | OPEN |
| [#121](https://github.com/NanmiCoder/dsh-agent-teams/issues/121) | `keep_feature` | OPEN |
| [#120](https://github.com/NanmiCoder/dsh-agent-teams/issues/120) | `keep_fix` | OPEN |
| [#117](https://github.com/NanmiCoder/dsh-agent-teams/issues/117) | `keep_needs_info` | OPEN |
| [#116](https://github.com/NanmiCoder/dsh-agent-teams/issues/116) | `close_out_of_scope` | OPEN |
| [#114](https://github.com/NanmiCoder/dsh-agent-teams/issues/114) | `keep_feature` | OPEN |
| [#113](https://github.com/NanmiCoder/dsh-agent-teams/issues/113) | `keep_fix` | OPEN |
| [#111](https://github.com/NanmiCoder/dsh-agent-teams/issues/111) | `keep_needs_info` | OPEN |
| [#107](https://github.com/NanmiCoder/dsh-agent-teams/issues/107) | `keep_fix` | OPEN |
| [#106](https://github.com/NanmiCoder/dsh-agent-teams/issues/106) | `keep_fix` | OPEN |
| [#103](https://github.com/NanmiCoder/dsh-agent-teams/issues/103) | `keep_fix` | OPEN |
| [#101](https://github.com/NanmiCoder/dsh-agent-teams/issues/101) | `keep_feature` | OPEN |
| [#97](https://github.com/NanmiCoder/dsh-agent-teams/issues/97) | `keep_feature` | OPEN |
| [#96](https://github.com/NanmiCoder/dsh-agent-teams/issues/96) | `keep_feature` | OPEN |
| [#89](https://github.com/NanmiCoder/dsh-agent-teams/issues/89) | `already_closed` | CLOSED |
| [#88](https://github.com/NanmiCoder/dsh-agent-teams/issues/88) | `close_answered` | OPEN |
| [#81](https://github.com/NanmiCoder/dsh-agent-teams/issues/81) | `close_answered` | OPEN |
| [#79](https://github.com/NanmiCoder/dsh-agent-teams/issues/79) | `close_resolved` | OPEN |
| [#78](https://github.com/NanmiCoder/dsh-agent-teams/issues/78) | `keep_fix` | OPEN |
| [#77](https://github.com/NanmiCoder/dsh-agent-teams/issues/77) | `close_resolved` | OPEN |
| [#76](https://github.com/NanmiCoder/dsh-agent-teams/issues/76) | `keep_feature` | OPEN |
| [#71](https://github.com/NanmiCoder/dsh-agent-teams/issues/71) | `keep_feature` | OPEN |
| [#70](https://github.com/NanmiCoder/dsh-agent-teams/issues/70) | `keep_feature` | OPEN |
| [#68](https://github.com/NanmiCoder/dsh-agent-teams/issues/68) | `close_answered` | OPEN |
| [#62](https://github.com/NanmiCoder/dsh-agent-teams/issues/62) | `keep_feature` | OPEN |
| [#59](https://github.com/NanmiCoder/dsh-agent-teams/issues/59) | `keep_feature` | OPEN |
| [#58](https://github.com/NanmiCoder/dsh-agent-teams/issues/58) | `keep_feature` | OPEN |
| [#54](https://github.com/NanmiCoder/dsh-agent-teams/issues/54) | `keep_needs_info` | OPEN |
| [#43](https://github.com/NanmiCoder/dsh-agent-teams/issues/43) | `close_duplicate` | OPEN |
| [#42](https://github.com/NanmiCoder/dsh-agent-teams/issues/42) | `close_answered` | OPEN |
| [#19](https://github.com/NanmiCoder/dsh-agent-teams/issues/19) | `keep_fix` | OPEN |
| [#17](https://github.com/NanmiCoder/dsh-agent-teams/issues/17) | `close_resolved` | OPEN |
| [#11](https://github.com/NanmiCoder/dsh-agent-teams/issues/11) | `close_answered` | OPEN |

## [#134 cannot restart after install the plugin](https://github.com/NanmiCoder/dsh-agent-teams/issues/134)

- 事实：与 #120 同一报告人的同一 registerContinuableSetup Windows 堆栈；Node24.20.0，仍缺精确核心/插件版本。
- 动作：`close_duplicate`。
- 关闭/验收条件：并入 #120/#127；关闭原因只能duplicate，不能resolved；保留Windows启动验收。

可发送评论：

> Thanks for the log. This is the same removed registerContinuableSetup entry reported in #120; we are tracking the complete host migration in #127. I am consolidating this duplicate here, not marking the runtime failure fixed. Please follow those issues for the verified package/host combination; your Windows startup case remains part of the acceptance checklist.


## [#133 模块新增的预设无法删除，尽管修改了dsh的配置文件中的的预设但是每个新会话的新预设还是mathv4](https://github.com/NanmiCoder/dsh-agent-teams/issues/133)

- 事实：只有标题，body空；仓库src/index.ts、command.ts、cordis.patch.yml没有内置 mathv4 常量，无法判定预设来自AgentTeams或宿主profile。
- 动作：`keep_needs_info`。
- 关闭/验收条件：需实际profile、宿主/插件版本、配置中相关预设片段与复现步骤；不得索要整份含key配置。

可发送评论：

> 目前还不能判断 mathv4 来自 AgentTeams 团队配置，还是宿主/其他插件的默认 Agent preset。请补充宿主核心和插件版本、使用的 profile、修改配置的步骤，以及只包含该预设的脱敏配置片段。仓库当前没有内置 mathv4 默认值，先保留 issue 继续定位配置来源。


## [#132 Harness 0.1.2-rc.1 (public npm) fails to boot: ctx.subagents.registerContinuableSetup is not a function — no installable version works (0.1.15/0.1.14 verified, 0.1.13 source has same call)](https://github.com/NanmiCoder/dsh-agent-teams/issues/132)

- 事实：明确rc.1+插件0.1.15/0.1.14实测boot失败；0.1.13仅查源码。“所有可安装版本不行”证据不覆盖全部历史版本。
- 动作：`keep_fix`。
- 关闭/验收条件：按 #127 验收真实rc.1产品入口、队员回合/模型/失败/恢复；不能仅skip setup。

可发送评论：

> Thanks for the precise rc.1 reproduction. We confirmed the lifecycle API break and are integrating #119/#124/#130 under #127. Skipping registerContinuableSetup alone also skips model selection, fallback and failure handling, so it is not the final fix. The acceptance run will cover a clean npm artifact, real boot and a complete team exercise; until that is published, blindly downgrading only the plugin is not a reliable rc.1 recovery path.


## [#131 DeepSeek Harness 0.1.2-rc.1 兼容：ctx.subagents.followup 已改名 sendMessage，队长消息无法送达队员](https://github.com/NanmiCoder/dsh-agent-teams/issues/131)

- 事实：rc.1 mailbox投递但队员不醒；PR130同head已证方法this回归和no-op生命周期。sendMessage运行中为steer，不是简单重命名FIFO。
- 动作：`keep_fix`。
- 关闭/验收条件：idle/running/cold三态投递；同attempt、顺序、成员回报、退役防唤醒；统一PR发布后才resolved。

可发送评论：

> 已确认消息入口变化，也感谢 #130 的定位。补充一个合同差异：新的 sendMessage 在成员运行中采用 steer，旧 followup 的 host 投递是独立排队回合，不能只按重命名替换。我们会把 mailbox 落盘、实时投递、成员新回合和最终回报分别验收，并与生命周期修复一起交付；当前还不能把 #130 当成全部功能无损的修复。


## [#128 0.1.15 breaks Deepseek-Harness-Desktop (embedded dsh 0.1.1-rc.1): pending uiConversation; auto-upgrade via package ranges makes it worse](https://github.com/NanmiCoder/dsh-agent-teams/issues/128)

- 事实：报告Desktop内置0.1.1rc1+插件0.1.15缺uiConversation；回退0.1.5恢复为报告人A/B。#131消息补丁不能补旧client缺service。
- 动作：`keep_fix`。
- 关闭/验收条件：旧RC精确支持/回退组合、Desktop实际内核、range连带升级、profilemanifest与lock清单；不把CLI更新当Desktop更新。

可发送评论：

> Thanks for the A/B report. The direct failure here is the older desktop runtime missing uiConversation; the message patch in #131 does not address that client contract. We are separating the legacy-host installation guidance from the new rc.1 migration and tightening the published support matrix. Please retain the working exact plugin pin for that embedded runtime until a verified upgrade pair is available; updating the global CLI does not update the desktop app’s embedded core.


## [#127 适配一下0.1.2-rc.1](https://github.com/NanmiCoder/dsh-agent-teams/issues/127)

- 事实：主跟踪rc.1生命周期API；caret满足rc1但接口不同；#119/#124/#130应统一处理。
- 动作：`keep_fix`。
- 关闭/验收条件：精确npmtarball+闭包、启动、fresh/cold/fork、FIFO/steer、力度fallback失败收尾、UI/auth，及不支持版本诊断。

可发送评论：

> 把这里作为 0.1.2-rc.1 完整适配的主跟踪。范围不仅是 boot：还包括成员消息、冷恢复、模型/推理力度、fallback、失败收尾和客户端服务。我们已审查 #119/#124/#130，会统一整合并保留贡献；peer 范围和发布渠道将以实际宿主验证结果为准，版本号满足 semver 不再等同于已支持。修复包和验收记录准备好后会在这里更新。


## [#126 建议：npm上不要把对应dsh alpha版本的设置为latest](https://github.com/NanmiCoder/dsh-agent-teams/issues/126)

- 事实：插件0.1.15无后缀但仅Alpha.2验收即latest；宿主latest/next是rc1，没有GA。改tag不能撤销已有caret可选版本。
- 动作：`keep_fix`。
- 关闭/验收条件：提交支持清单+releasegate，普通用户默认已验收组合、Alpha显式optin，先next验证；发布后复查registrydisttags。

可发送评论：

> 这个反馈会落实到发布门禁：普通用户默认使用我们实际验收过的宿主/插件组合，Alpha 支持放到显式选择的预览渠道。也不会盲目跟随宿主 latest，因为它只是可变标签。除了 npm dist-tag，还会处理 package 范围、现有 profile 锁版和升级诊断，防止已经写入的宽范围继续选到不匹配版本。渠道调整与实际发布结果会分别记录。


## [#125 [Bug] captain 代成员 claim 后未唤醒，任务可停在 claimed 并产生 attempt_id 轮换](https://github.com/NanmiCoder/dsh-agent-teams/issues/125)

- 事实：明确rc1+0.1.15，captain代成员claim返回attempt但未可靠dispatch；独立于#131投递故障。
- 动作：`keep_fix`。
- 关闭/验收条件：主任务选择禁止captain代成员claim、要求reassign；验证拒绝发生于持久化前、成员自claim可用、attempt不轮换。

可发送评论：

> 这个入口会单独修复，不能只按 #131 的消息问题合并掉。我们采用明确语义：成员自行 claim 已投递任务；队长要指定或重新唤醒成员时走安全的 reassign 流程，不允许只替成员写入 claimed 状态。回归会检查拒绝时状态不变、成员自 claim 正常，以及返回/投递的 attempt_id 保持一致。完成实际宿主验证后再关闭。


## [#123 [bug] 不兼容宿主 dsh 0.1.2-alpha.5：boot 阶段 `ctx.subagents.registerContinuableSetup is not a function`，导致整个 dsh web 插件树加载失败](https://github.com/NanmiCoder/dsh-agent-teams/issues/123)

- 事实：主贴alpha5API+PR124；评论另有Desktop2.0.5内置rc1和旧默认插件0.1.8两层故障；renderer可用不代表server成功。
- 动作：`keep_fix`。
- 关闭/验收条件：alpha5和rc1分别验证；Desktop壳/内核/profile分开记录。未有真实Desktop验收不能宣称支持2.0.5。

可发送评论：

> 感谢源码分析和 #124，session-start、ownEvents 与 host FIFO 的迁移方向已纳入统一实现。Desktop 2.0.5 的补充案例也会单独记录：壳版本、内置核心和 profile 插件必须分别核对。仅守卫 setup 或仅 renderer 成功不足以证明功能完整，我们会继续验证模型选择、失败收尾和冷恢复；未实际测试的 Desktop 组合会明确标注。


## [#121 [feat] 可以把图标加个替换的功能，让客户自由替换不同角色对应的图标吗](https://github.com/NanmiCoder/dsh-agent-teams/issues/121)

- 事实：图标自由替换需求已有PR67候选；PR67与main冲突，含上传/代理非纯CSS。
- 动作：`keep_feature`。
- 关闭/验收条件：PR67重基，role/member/captain优先级，旧状态兼容、上传/代理、未配置fallback与浏览器验证。

可发送评论：

> 已有关联贡献 #67，覆盖角色、队长和成员头像配置。这个功能会单独保留；该 PR 还需要重基到新的宿主适配，并完成上传、远程图片代理及旧团队状态兼容验证。默认角色图会继续作为未配置时的回退，不会为了这项功能改变现有团队流程。


## [#120 0.1.15 在 dsh 0.1.2-alpha.5 下无法加载：ctx.subagents.registerContinuableSetup 已不存在](https://github.com/NanmiCoder/dsh-agent-teams/issues/120)

- 事实：精确alpha5+0.1.15，Windows10 Node24.18，Web/CLIboot失败，多独立报告。断点alpha4始。
- 动作：`keep_fix`。
- 关闭/验收条件：显式alpha4/alpha5支持边界；不能无限声明alpha4+；真实公开包完整闭包，unsupported入口可诊断。

可发送评论：

> 已确认 alpha.4 起旧 setup 钩子被移除，alpha.5 也受影响。我们会按精确版本验证并发布支持范围，而不是承诺无限的“alpha.4+”。这次会同时迁移消息和会话生命周期，避免只让 boot 通过后团队仍不能执行。Windows/CLI 报告已保留在 #127 的验收清单中。


## [#117 Describe the bug 使用多Agent团队任务后，Node进程内存只涨不跌，多次任务后触发OOM崩溃。](https://github.com/NanmiCoder/dsh-agent-teams/issues/117)

- 事实：只有OOM/RSS上涨症状，无host/plugin/OS/任务次数/堆指标。
- 动作：`keep_needs_info`。
- 关闭/验收条件：可复现多轮队伍创建执行归档，固定并发模型，heapUsed/RSS/idle后趋势，存活listeners/agents等；不能凭RSS不降认定泄漏。

可发送评论：

> 先保留为独立资源问题。请补充宿主核心/插件版本、系统和 Node 版本、队员数、重复多少轮后出现 OOM，以及开始/执行结束/空闲后的 RSS 与 heapUsed 数值。我们需要区分会话历史保留、V8 保留的内存页和无法释放的对象；只看 RSS 不回落还不足以定位泄漏。请不要上传带 API key 或完整对话内容的配置/转储。


## [#116 Add OrcaRouter as an optional AI provider](https://github.com/NanmiCoder/dsh-agent-teams/issues/116)

- 事实：第三方provider+商业合作邀请；AgentTeams只路由已注册Harnessprovider/model，不拥有底层OpenAIadapter。
- 动作：`close_out_of_scope`。
- 关闭/验收条件：如需provider实现应在Harnessproviderplugin，验证chat/tool/stream/error/usage；不授权收入分成合作。

可发送评论：

> Thanks for the proposal. AgentTeams routes members to providers and models already registered in DeepSeek Harness; it does not implement the underlying provider adapters. An optional OrcaRouter adapter should therefore be contributed at that layer, after which AgentTeams can select its registered route. We are closing this provider-specific integration request here; this does not enter the partner or revenue-share program.


## [#114 Feature Request: Prevent long-running AgentTeams members from accumulating excessive context](https://github.com/NanmiCoder/dsh-agent-teams/issues/114)

- 事实：独立长上下文需求。精确rc1上游已有compaction-basic，默认base启用，默认阈值0.8保留0.16，另有tool-result-pruner；子代理实际继承未在本轮验证。
- 动作：`keep_feature`。
- 关闭/验收条件：真实continuable长turn/compact，任务/attempt/mailbox/冷热恢复不丢；记录模型窗口继承，不造第二引擎。

可发送评论：

> The exact rc.1 Harness source already provides compaction-basic and tool-result pruning, and its base composition enables automatic compaction. We should verify that continuable members inherit that composition correctly before adding another compaction engine. This issue remains open for the AgentTeams-specific checks: preserving the current task, attempt capability, recent messages and recovery state across compaction. The presence of the upstream module alone is not a completed acceptance test.


## [#113 can't load](https://github.com/NanmiCoder/dsh-agent-teams/issues/113)

- 事实：明确旧0.1.1rc2+0.1.15缺uiConversation；前维护者真实rc2+0.1.10精确锁版测试存在。
- 动作：`keep_fix`。
- 关闭/验收条件：旧组合安装文档与升级门禁；本轮未复测旧RC。新的rc1修复不能自动解释旧RC兼容。

可发送评论：

> This is an older-host/newer-plugin mismatch: Harness 0.1.1-rc.2 does not provide the uiConversation service required by plugin 0.1.15. The previously verified legacy combination is 0.1.1-rc.2 with plugin 0.1.10, pinned using --save-exact as documented in #107. We are adding clearer compatibility and installation gates; the new 0.1.2-rc.1 work does not mean every older RC automatically becomes compatible.


## [#111 An error message prevented deepseek-harness-desktop from starting.](https://github.com/NanmiCoder/dsh-agent-teams/issues/111)

- 事实：堆栈首错误属于git-graph settings.installSection，AgentTeamsrenderer后续无消息；缺确切core/plugin版本。
- 动作：`keep_needs_info`。
- 关闭/验收条件：只启AgentTeams的隔离profile与多插件对照，Desktopcore版本/完整pendingservice；不误归属别的plugin。

可发送评论：

> Thanks for the log. The concrete TypeError shown is in the git-graph plugin (settings.installSection); the AgentTeams renderer failure has no underlying message yet. Please provide the desktop version, embedded Harness version and AgentTeams version, plus a startup result from a separate profile containing AgentTeams without other third-party plugins. That will distinguish an AgentTeams compatibility issue from a shared startup failure.


## [#107 DSH 从 0.1.1-rc.2  更新到了 0.1.2-alpha.1，插件无法使用](https://github.com/NanmiCoder/dsh-agent-teams/issues/107)

- 事实：聚合多类：旧插件配alpha1缺conversationEvents、新插件配旧rc2缺uiConversation、auto-mode/settings导出缺失、alpha4setup；不能一锅close。
- 动作：`keep_fix`。
- 关闭/验收条件：作为历史汇总入口写矩阵链接；明确已验Alpha2/0.1.15、旧rc2/0.1.10历史边界；新版本待published。

可发送评论：

> 这里已经包含几种不同组合的问题：旧插件配新宿主缺 conversationEvents，新插件配旧宿主缺 uiConversation，还有其他插件的导出变化与 alpha.4 后的 setup 变化。我们会把精确支持组合、profile 锁版和诊断统一到安装说明；新 rc.1 运行时问题集中在 #127 跟踪。不会再用“只升级插件 latest”作为所有场景的通用答案，Desktop 内置核心也会单独核对。


## [#106 [Security] Web 路由（/state /hal /plan /assets）缺少 loopback/设备校验围栏](https://github.com/NanmiCoder/dsh-agent-teams/issues/106)

- 事实：bf50b49/0.1.15已全路由Connection围栏，评论自行勘误；/halt确无bodylimit。
- 动作：`keep_fix`。
- 关闭/验收条件：主任务补halt cap与413、同源/配对/未授权/缺服务failsclosed、dispose重载，保留authgate。

可发送评论：

> 感谢报告及后续勘误。0.1.15 已经通过宿主 Connection 保护这些路由；当前仍需补齐的是 /halt 的请求体大小上限。我们会修复这个剩余点，并同时回归未授权来源、合法配对请求、超大请求和缺少鉴权服务时的关闭行为，避免兼容适配把现有围栏撤掉。完成请求级测试后再将本 issue 标为已解决。


## [#103 [Bug] Scheduler regenerates attemptId for idle member owning open task, causing stale attempt errors](https://github.com/NanmiCoder/dsh-agent-teams/issues/103)

- 事实：早先0.1.13有parkedguard；新#86已merge，补disposed/失败回滚/coldonce；本轮红绿证实但报告没实际版本。
- 动作：`keep_fix`。
- 关闭/验收条件：新矩阵下重复kick/idle/registrydisposal/失败投递不换attempt，重启cold有一次rotation为设计；发布后报告人版本确认。

可发送评论：

> #86 已合入主线，补充了 disposed 成员、冷恢复仅一次和投递失败恢复原 attempt 的处理。我们做了红绿验证：撤掉 scheduler 修复后新增恢复断言会失败，补丁下通过。仍需在新宿主和发布包上复测；也请补充实际安装的宿主/插件版本，以区分旧版无 guard 与当前恢复入口的问题。


## [#101 Feature Request: Optional dsh-better-sidebar Integration for the Activity Panel](https://github.com/NanmiCoder/dsh-agent-teams/issues/101)

- 事实：可选Sidebar复用面板需求，与PR38和issue43重叠；43还要求独立隐藏会话卡/浮窗。
- 动作：`keep_feature`。
- 关闭/验收条件：保持optionalpeer、不安装时shelloverlay、单实例tab、session切换/HMR；可选卡片/浮窗开关单列不默认删除。

可发送评论：

> Thanks for the clear optional-integration proposal. We are consolidating it with PR #38 and the presentation-toggle request in #43. The desired boundary is shared panel content with an optional Sidebar host, while the current shell.overlay path continues to work without that plugin. The existing PR needs rebasing to the current client and session APIs; tab focus, single-instance behavior, reload and card/floater visibility will be tested separately.


## [#97 希望增加：全局并发限制 (maxConcurrentWorkers) 并支持限流后自动恢复](https://github.com/NanmiCoder/dsh-agent-teams/issues/97)

- 事实：7角色2并发真实需求，maxMembers不等并发budget；429与insufficientquota不同，#86只防重派循环无预算。
- 动作：`keep_feature`。
- 关闭/验收条件：独立设计总/每provider预算，公平队列、释放、冷热恢复、429boundedbackoff、quota终止/fallback；不承诺队员并发=API请求并发。

可发送评论：

> 这个需求会保留为独立调度增强。maxMembers 限制的是角色数量，不能代替并发预算；#86 解决重复恢复，也没有提供全局并发上限。后续需要把并发许可、队列公平性和失败释放一起实现，并区分可退避的 429 与需要更换配额/路由的 insufficient_quota，避免把两者都无限重试。


## [#96 太烧token，能做成Agent 预设吗？](https://github.com/NanmiCoder/dsh-agent-teams/issues/96)

- 事实：现有TeamProfiles/显式command激活，但bundle仍全profile注册工具与usage；团队模板不等Hostpreset按需tools。
- 动作：`keep_feature`。
- 关闭/验收条件：核对宿主preset工具可见性，非团队会话tokenbaseline，激活后完整工具/团队恢复；不以已有profiles宣称完成。

可发送评论：

> 目前已有可复用的团队 profile，但它主要保存角色和任务模板，并不等于只在某个宿主 Agent preset 中加载工具。你提出的是“非团队会话不要承担整套工具提示词成本”，这个需求成立。会与 #59 的工具策略、#78 的轮询成本分开评估，验证按需可见性后再确定实现方式。


## [#89 clean-build.mjs fails on Windows: endsWith('/lib') never matches backslash path](https://github.com/NanmiCoder/dsh-agent-teams/issues/89)

- 事实：PR90已由主任务merge，GitHub自动CLOSED，2026-09-05T16:14:14Z；本轮win32/path算法与组合build验证。
- 动作：`already_closed`。
- 关闭/验收条件：原生Windows CI独立；无需重复close，可附checks事实。

可发送评论：

> Fixed in main by #90. The guard now uses basename while retaining the exact parent-directory check. We verified the Windows/POSIX path cases and the current build/verification suite; native Windows CI remains a separate platform check. Thanks for the precise reproduction.


## [#88 是否接受更多开发者参与](https://github.com/NanmiCoder/dsh-agent-teams/issues/88)

- 事实：参与渠道提问和+1，非bug；用户明确鼓励外部贡献。
- 动作：`close_answered`。
- 关闭/验收条件：友好说明PR入口、现技能/验证要求；不擅授collaborator/triage权限。

可发送评论：

> 欢迎参与。这轮已合入多位贡献者的独立修复，也会保留兼容 PR 的来源和贡献记录。可以从现有 issue 认领一个边界清楚的改动，先说明目标宿主版本和复现，再提交小范围 PR 与相应验证；仓库中的开发文档和维护 skills 会作为共同流程。这里作为参与渠道问答先关闭，具体任务直接在对应 issue/PR 继续讨论。


## [#81 这个是像Workbuddy里面的团队一样运作的吗？](https://github.com/NanmiCoder/dsh-agent-teams/issues/81)

- 事实：产品机制问题；只解释本项目可验证架构，不断言Workbuddy实现。
- 动作：`close_answered`。
- 关闭/验收条件：提供简短当前工作流，避免竞品未经研究对比。

可发送评论：

> 可以把它理解为“一个队长协调多个成员”：先生成可审批的团队计划和任务依赖图，批准后成员作为持久子代理执行，调度器分配就绪任务，成员通过消息和任务结果协作，Web 面板显示进度。它基于 DeepSeek Harness 的子代理、会话和模型服务运行。这里先按使用方式问答关闭；若有具体想对照的行为，可以单独描述场景。


## [#79 任务完成后再次打开对话，页面会自己弹出来。](https://github.com/NanmiCoder/dsh-agent-teams/issues/79)

- 事实：03d5f40随0.1.14已有恢复时保持折叠；当前verify旧team/archived/newteam/autoonce四场景通过。
- 动作：`close_resolved`。
- 关闭/验收条件：仅针对原“重开对话自动展开”症状；新host加载问题另线；如有新复现可重开。

可发送评论：

> 这个原始行为已由 03d5f40 修复并随 0.1.14 发布：重新打开会话时恢复出的旧团队保持折叠，只有恢复完成后新出现的活跃团队会自动展开一次。本轮也重新通过了旧会话、归档会话及新团队展开的回归检查，因此关闭该问题。安装时仍请使用与实际宿主匹配的插件版本；若匹配组合中仍复现，可带步骤重开。


## [#78 创建了任务之后，子agent可能是长耗时任务，主agent的轮询时间间隔周期延长，不断快速轮询浪费和污染上下文](https://github.com/NanmiCoder/dsh-agent-teams/issues/78)

- 事实：确认status工具描述仍鼓励Poll，usage禁止busy-poll；Webpoll不进模型上下文。#87历史PR提出同一替换。
- 动作：`keep_fix`。
- 关闭/验收条件：主任务改描述/协议一致+实际idle队长被通知唤醒，不禁用诊断status，不改UIpoll代替模型优化。

可发送评论：

> 已确认这里仍有一处矛盾：usage 要求不要忙轮询，但 status 工具描述还写着“Poll this to watch progress”。这轮会统一为通知驱动、按需诊断的表述，并验证队长结束回合后仍能收到成员报告。Web 面板的刷新不会追加模型上下文，因此不会靠单纯降低界面刷新频率来冒充这项修复。


## [#77 显示bug，不应该出现无tasks的Subagent吧，而且还有白色进度条](https://github.com/NanmiCoder/dsh-agent-teams/issues/77)

- 事实：412c151随0.1.14修复并行captain接管孤立claimed，增加captain显示；当前lifecycle覆盖singleactive takeover/回池。
- 动作：`close_resolved`。
- 关闭/验收条件：原截图推断原因由历史评论及代码支持；同场景仍复现需版本/步骤，纯白bar额外主题未知需分开。

可发送评论：

> 原报告对应的并行队长接管问题已在 412c151 修复并随 0.1.14 发布：同时只允许一个队长接管，接管任务进入执行状态，队长空闲后未完成任务可回池，面板也会显示队长名下任务。本轮相关生命周期检查通过，先关闭这个已修场景。如果现在仍出现“有任务却显示 No tasks”，请带匹配的宿主/插件版本和切换会话步骤重开；颜色问题可另附截图定位。


## [#76 子代理在额度耗尽时缺少降级 / 兜底机制，导致协作进度断裂](https://github.com/NanmiCoder/dsh-agent-teams/issues/76)

- 事实：0.1.14已有单跳fallback与状态持久化，#110主线失败收尾，#86防恢复风暴；无多跳chain/provider退避/budget工具。
- 动作：`keep_feature`。
- 关闭/验收条件：统一host保证已有fallback不被setupno-op禁用；remainingchain预算单独验收，quota非必可重试。

可发送评论：

> 当前已有单跳 fallback（可在成员或 profile 配置 provider/model），主线也补了最终失败落盘、队长通知和恢复节流。本轮会确保这些能力在新宿主上继续工作。你提出的有序多跳链、按 provider 的退避窗口和预算工具仍未实现，因此 issue 保持开放；会把这些增强与已存在的单跳兜底分开记录。


## [#71 issue3-斜杠命令分发.md](https://github.com/NanmiCoder/dsh-agent-teams/issues/71)

- 事实：当前已有主command和配置profile别名；rc1CommandDescriptor description/input.hint是plainstring，无locale namespace字段。
- 动作：`keep_feature`。
- 关闭/验收条件：多技能分发属hostdispatcher边界；命令locale需上游contract，不往不存在field塞key；现profilealiases可说明。

可发送评论：

> 当前除了 /agent-teams，还会为配置的团队 profile 注册快捷命令；通用的多技能分发仍属于宿主命令层。我们核对了 0.1.2-rc.1 的 CommandDescriptor，description 和 input.hint 仍是普通字符串，没有 locale namespace 字段，因此不能直接把翻译 key 当描述传入。保留命令本地化需求，并在宿主提供合同后接入；不会将它误当成团队调度故障。


## [#70 issue2-消息附件.md](https://github.com/NanmiCoder/dsh-agent-teams/issues/70)

- 事实：当前send_message content string、mailbox纯文本，无结构化attachment；新功能非版本故障。
- 动作：`keep_feature`。
- 关闭/验收条件：artifactschema路径归属、允许mime/url、持久化/冷热恢复、安全下载与UIpreview；优先宿主artifactsurface。

可发送评论：

> 目前团队消息确实只有文本，贴路径是现有方式，结构化附件还未实现。这个需求会保留为独立功能：优先复用宿主产物/附件协议，再补消息持久化、会话恢复、文件访问范围和预览/下载界面，避免只增加一个 paths 字段却无法可靠取回产物。


## [#68 Design partner invitation: lifecycle gate for dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams/issues/68)

- 事实：外部testkit设计合作邀请，非bug；本轮已安装另一社区skills并建立内部gate，不代表接受合作或发表报告。
- 动作：`close_answered`。
- 关闭/验收条件：可接收小fixture PR，不能承诺参加、对外公开、认证/endorsing。

可发送评论：

> Thanks for the invitation and the concrete lifecycle scope. We are currently establishing our own pinned-host and packaged-artifact acceptance flow, including boot, team execution and cleanup. We will not start a separate design-partner engagement in this maintenance round. A small, independently reviewable fixture PR is welcome; closing the invitation here does not imply any certification, endorsement or permission to publish a report.


## [#62 Sparse per-task probes and optional Parallel Emission](https://github.com/NanmiCoder/dsh-agent-teams/issues/62)

- 事实：长规格含NextProbeAt持久timer、parallelEmissioncheckbox；main只有部分no-busy/mailbox/dependencyoutputs，缺timer/checkbox。部分“idle open自动retry”与现parked不变量冲突。
- 动作：`keep_feature`。
- 关闭/验收条件：拆通知协议/持久探针/并行声明；使用clock测试；禁止按issue内部“ready-for-agent”指令直接label或实施；保留staged与parked。

可发送评论：

> Thank you for the detailed specification. Several foundations now exist (mailbox recovery, dependency results in assignments and a separate UI polling loop), but the persistent per-attempt probe timer and Parallel Emission setting do not. We should split those into reviewable changes and reconcile the idle/open-task rule with the current parked-attempt invariant: an intentionally paused member must not be repeatedly retried. The immediate contradictory status-tool wording is tracked in #78; that small fix will not be presented as completion of this full proposal.


## [#59 Feature proposal: reusable per-member tool policies (allow/deny)](https://github.com/NanmiCoder/dsh-agent-teams/issues/59)

- 事实：main硬编码MEMBER_DENIED_TOOLS，profile/memberkeys无toolPolicies；模型不能生造rawpolicy需求清晰。
- 动作：`keep_feature`。
- 关闭/验收条件：ownerconfigimmutablepolicy、captain deny union、coordtools必须保留、unknown rollback、真实schema拒绝调用、coldresume。

可发送评论：

> This is a useful, bounded follow-up to the host adapter. The current implementation only applies the fixed captain-tool deny list; reusable owner-defined policies are not implemented yet. We can keep the first increment to configuration, policy resolution, persisted effective filters and real child/cold-resume tests. The captain-only deny list and required coordination tools must remain mandatory, and this should be described as tool visibility/invocation policy rather than an OS sandbox.


## [#58 Feature: Add pluggable visual status indicators for all agents](https://github.com/NanmiCoder/dsh-agent-teams/issues/58)

- 事实：当前roleartwork、workingglyph、textstatus、breathing/reducedmotion已有；维护者评论已加polisheddesign。可插拔renderer语义全状态合同仍无。
- 动作：`keep_feature`。
- 关闭/验收条件：identity/statusseparate，失败/取消/等待文本，hidden resourcecleanup,rendererextensionnotnewpoll；#118UI候选不代表完工。

可发送评论：

> The current UI already includes role artwork, working indicators, text labels and reduced-motion handling, and the earlier visual refresh is in main. The remaining part of this proposal is the reusable/pluggable status presentation contract, including intentional waiting, failure and cancellation states. We will keep that scope separate from custom avatars (#67/#121), reuse the existing monitor updates and avoid another animation polling loop.


## [#54 插件模块导出的 name（`agent-teams`）与包名（`@nanmicoder/dsh-agent-teams`）不一致](https://github.com/NanmiCoder/dsh-agent-teams/issues/54)

- 事实：导出agent-teams与npm不同属实，patch name正确；精确rc1plugin.ts只是pnpmforwarder，未找到所称官方plugin check。
- 动作：`keep_needs_info`。
- 关闭/验收条件：请给check命令来源/版本/输出；若改一致性要验证Cordis重复加载、entryid和hotreload，不能凭unverifiedcontract破坏兼容。

可发送评论：

> 两处名字不同的现象属实，不过还需要核实“官方 dsh plugin check 强制二者相同”这项依据：我们检查的 0.1.2-rc.1 CLI 中，plugin 子命令主要透传 pnpm，没有找到该校验命令。请补充具体工具来源、宿主版本和校验输出。命名一致性可以改进，但更改前会验证 Cordis 的加载/重复激活行为，不把尚未确认的规则直接当成运行故障。


## [#43 Suggestion: dock the AgentTeams activity panel into dsh-better-sidebar tabs (with patch)](https://github.com/NanmiCoder/dsh-agent-teams/issues/43)

- 事实：Sidebar同#101/#38，独有card+floater独立隐藏config诉求。
- 动作：`close_duplicate`。
- 关闭/验收条件：先把独有toggle验收登记#101，再close duplicate；不要丢需求或无条件默认隐藏历史卡。

可发送评论：

> Thanks for the patch and for identifying the overlap with #38. We are consolidating the integration in #101, including your additional request to control conversation-card and floater visibility independently from tab registration. I am closing this duplicate discussion after carrying that requirement forward; it is not a claim that the Sidebar feature has shipped. The current client APIs and optional-plugin fallback still need acceptance coverage.


## [#42 List dsh-agent-teams on DSH Directory?](https://github.com/NanmiCoder/dsh-agent-teams/issues/42)

- 事实：目录收录邀请，要求到第三方repo提交表单，不是代码缺陷。
- 动作：`close_answered`。
- 关闭/验收条件：不提交额外目录issue、不acceptendorsement；礼貌答复关闭邀请。

可发送评论：

> Thanks for the invitation. We are focusing this maintenance round on compatibility and release validation, so we are not submitting to another directory as part of this issue. The project metadata remains available in the public README/package manifest. Closing this invitation to keep the tracker focused on actionable repository work.


## [#19 [反馈] agent-teams/* 事件导致历史会话重启后无法加载：确认 0.1.0 已修复，但存量会话建议提供迁移工具](https://github.com/NanmiCoder/dsh-agent-teams/issues/19)

- 事实：已写日志修复与新写防护不同；#21自检绿但本轮3合法JSON漏修；历史73会话报告是用户证据非本轮。
- 动作：`keep_fix`。
- 关闭/验收条件：默认dryrun、backup/atomic/按envelope/真实oldreader和rc1replay、无非目标变更、幂等；不动真实用户日志。

可发送评论：

> 新写入防护已经存在，但不会自动修复旧日志，因此这个问题继续开放。我们重新审查了 #21：它的自测通过，但按字符串判断会漏掉一些合法事件（例如 data 中含 ignorable 字段）。迁移工具会先补默认诊断、自动备份和按事件信封判定，再用真实宿主 reader 校验；不会直接把全目录原地改写作为默认升级步骤。


## [#17 readme文件有笔误](https://github.com/NanmiCoder/dsh-agent-teams/issues/17)

- 事实：当前README scopednpm链接正确，HTTP核验badge返回<title>npm:v0.1.15</title>，已不是package not found。
- 动作：`close_resolved`。
- 关闭/验收条件：仅当前徽章恢复；无需代码更改，不代表宿主兼容状态。

可发送评论：

> 已检查当前 README 的 npm 链接和徽章，徽章现在正常返回 v0.1.15，没有再出现 package not found。这个旧显示问题先关闭；感谢提醒。


## [#11 Featured in awesome-deepseek-harness 🐋](https://github.com/NanmiCoder/dsh-agent-teams/issues/11)

- 事实：awesome列表信息通知明确noactionneeded，无代码问题。
- 动作：`close_answered`。
- 关闭/验收条件：礼貌感谢，无自动star或跨repo发消息。

可发送评论：

> Thanks for including AgentTeams and for the heads-up. No repository change is needed for this notification, so I am closing it to keep the tracker focused on actionable work.

## 证据来源

- `/tmp/dsh-implementation-20260906/open-issues.json`：41条正文及全部已抓取评论。
- `/tmp/dsh-issue-status-20260906.json`：本轮重新查询40条open的metadata，评论数量与输入一致。
- `/tmp/dsh-pr-actions-20260906.md`：25PR精确head及独立验证。
- `/tmp/dsh-pr-validation-20260906/verify.log`、`/tmp/dsh-pr-86-validation-20260906/lifecycle.log`：当前main的小PR组合与scheduler修复检查。
- 官方宿主 `dsh-v0.1.2-rc.1` 的 `apps/cli/src/plugin.ts`、`packages/interaction/commands/src/types.ts`、`packages/compaction/compaction-basic/README.md`。
