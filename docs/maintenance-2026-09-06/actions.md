# 2026-09-06 维护执行记录

本文记录已发生的 GitHub 操作。审查基线是 25 个开放 PR 与 41 个开放 issue；#89 随 #90 合并自动关闭，因此开始逐条回复时为 40 个开放 issue。来源为 [PR 逐条复核](./pr-review.md)、[41 个 issue 事实复核](./issue-review.md) 和 [前一日调查快照](../compatibility-audit-2026-09-05/README.md)。这些原始审查文档保留调查时态，实际处理状态以下表和 GitHub 操作链接为准。

所有写入前重新读取对应条目及讨论，未发现需要调整的新增回复；评论和关闭按条执行。处理结果从 GitHub API 回执提取，下表保存可长期回查的评论、审核和合并链接，不把本机临时文件路径作为长期证据。没有新增标签、修改协作者权限、操作第三方仓库或接受推广合作。

## 本批结果

- PR：22 个已执行，包含 9 个合并并致谢、10 个具体的 Request changes 审核和 3 个说明原因后关闭。#119、#124、#130 的重叠贡献等待统一适配的最终验收及替代提交链接。
- Issue：28 个已逐条回复，其中新关闭 10 个、保持开放 17 个，另为已自动关闭的 #89 补充感谢与验证边界。其余 13 个保留到最终验收后处理。
- “已回复”“已合并”“已发布”“已验证”分别记录。关闭问答、推广邀请或重复讨论不表示一个功能已经交付；仍需复现信息和独立功能验收的条目保持开放。

## 25 个 PR

9 个独立贡献使用原 PR 合并，保留提交作者与 merge commit；#86 的恢复修复还完成了撤销修复后准确变红的验证。具体差异与检查边界见逐条审核链接。

| PR | 本轮核对的 head | 已执行动作或待办 | 直接证据 |
| --- | --- | --- | --- |
| [#130](https://github.com/NanmiCoder/dsh-agent-teams/pull/130) fix: bridge subagent delivery API for DeepSeek Harness 0.1.2-rc.1 | `620daa33c8dd813198451fb3fdfa46bd5a3b5bd6` | Pending：统一吸收兼容思路，等待最终验收和替代提交回链 | 尚未发送最终处理评论 |
| [#124](https://github.com/NanmiCoder/dsh-agent-teams/pull/124) fix(host): 适配 DSH 0.1.2-alpha.5 的 subagents API 重构 | `098e4e97ebc08096ca76c40c03e2e906d0fd1ef6` | Pending：统一吸收兼容思路，等待最终验收和替代提交回链 | 尚未发送最终处理评论 |
| [#119](https://github.com/NanmiCoder/dsh-agent-teams/pull/119) fix: migrate subagent APIs to harness 0.1.2-alpha.4 | `cdb683e144e73a02ec829cb14554fb6cdd574eb6` | Pending：统一吸收兼容思路，等待最终验收和替代提交回链 | 尚未发送最终处理评论 |
| [#118](https://github.com/NanmiCoder/dsh-agent-teams/pull/118) client: Kimi-minimal activity panel and identity marks | `c5839ed198a8f463e3c25c69c5d6d57c7d165853` | 已 Request changes，保持开放等待作者修改 | [具体审核要求](https://github.com/NanmiCoder/dsh-agent-teams/pull/118#pullrequestreview-5122031987) |
| [#112](https://github.com/NanmiCoder/dsh-agent-teams/pull/112) Update injected services to include conversationEvents | `66ea3d4f4339331fbde12b210dad6a11822c1ce1` | 已说明原因后关闭 | [关闭说明](https://github.com/NanmiCoder/dsh-agent-teams/pull/112#issuecomment-5553175919) |
| [#93](https://github.com/NanmiCoder/dsh-agent-teams/pull/93) fix(client): use uiConversation for card registration | `67d715975b9edf1492ea254805428148720d924b` | 已合并，并回复验收范围 | [合并提交](https://github.com/NanmiCoder/dsh-agent-teams/commit/6d1b21bdade7684a5319697383a124a5731f20a7) · [评论](https://github.com/NanmiCoder/dsh-agent-teams/pull/93#issuecomment-5553177463) |
| [#90](https://github.com/NanmiCoder/dsh-agent-teams/pull/90) fix(build): make clean guard Windows-safe | `beab26a5e696e3a8e5479b84505bc9551a9b6077` | 已合并，并回复验收范围 | [合并提交](https://github.com/NanmiCoder/dsh-agent-teams/commit/bda4c7c7da36c6bcc31d05ff6d0c3f6ee0df099c) · [评论](https://github.com/NanmiCoder/dsh-agent-teams/pull/90#issuecomment-5553178759) |
| [#86](https://github.com/NanmiCoder/dsh-agent-teams/pull/86) fix: recover parked tasks after member loss | `420e7c31b2543ce9ac17f1c24f6562a82037af3e` | 已合并，并回复验收范围 | [合并提交](https://github.com/NanmiCoder/dsh-agent-teams/commit/f18676d7a8b84dea1078b3675fe380db4f2ed218) · [评论](https://github.com/NanmiCoder/dsh-agent-teams/pull/86#issuecomment-5553180404) |
| [#84](https://github.com/NanmiCoder/dsh-agent-teams/pull/84) feat: show compact member model badges | `70806fc12395b70806339bc686269056f7e45c31` | 已合并，并回复验收范围 | [合并提交](https://github.com/NanmiCoder/dsh-agent-teams/commit/850427c398144fe94d2e7bb6e4484ad81a5222d5) · [评论](https://github.com/NanmiCoder/dsh-agent-teams/pull/84#issuecomment-5553181875) |
| [#83](https://github.com/NanmiCoder/dsh-agent-teams/pull/83) fix: preserve working state color fallback | `19c62de8e5c0ea2aecfb5e064e375c05ebf0c979` | 已合并，并回复验收范围 | [合并提交](https://github.com/NanmiCoder/dsh-agent-teams/commit/1367c5eeb26f6c8de56ac423d9df3ab52a8a1b3c) · [评论](https://github.com/NanmiCoder/dsh-agent-teams/pull/83#issuecomment-5553183144) |
| [#82](https://github.com/NanmiCoder/dsh-agent-teams/pull/82) feat: make activity panel resize handles visible | `b3b46ddc5c0f278933fbef471d2e08a8e26f2066` | 已合并，并回复验收范围 | [合并提交](https://github.com/NanmiCoder/dsh-agent-teams/commit/57f1783cdca84a9c3a52dc26f5b424cf7bf38d88) · [评论](https://github.com/NanmiCoder/dsh-agent-teams/pull/82#issuecomment-5553184743) |
| [#80](https://github.com/NanmiCoder/dsh-agent-teams/pull/80) feat: add team history controls | `8117825c017aa2a33e1f2badd202c52b165ba85d` | 已 Request changes，保持开放等待作者修改 | [具体审核要求](https://github.com/NanmiCoder/dsh-agent-teams/pull/80#pullrequestreview-5122037637) |
| [#74](https://github.com/NanmiCoder/dsh-agent-teams/pull/74) test: cover rate-limit retry storm regression (#66) | `f9ad97aeb3582ab11524093c18513d8085a0170d` | 已合并，并回复验收范围 | [合并提交](https://github.com/NanmiCoder/dsh-agent-teams/commit/6fe67990fd17cbd5a88d126921b798fe2c54587c) · [评论](https://github.com/NanmiCoder/dsh-agent-teams/pull/74#issuecomment-5553186355) |
| [#67](https://github.com/NanmiCoder/dsh-agent-teams/pull/67) feat: add configurable custom avatars | `a14996eaea00017fd8ac431c815249b5855e35d4` | 已 Request changes，保持开放等待作者修改 | [具体审核要求](https://github.com/NanmiCoder/dsh-agent-teams/pull/67#pullrequestreview-5122038270) |
| [#63](https://github.com/NanmiCoder/dsh-agent-teams/pull/63) Fix grammar issue in release-notes/v0.1.11.md: nonstandard_adjective_addressed | `53b49d5b668f27b1cdd5f69d7267d96c72dc80ec` | 已合并，并回复验收范围 | [合并提交](https://github.com/NanmiCoder/dsh-agent-teams/commit/e2c50b7edfac88b992279520ce0f3fb7c08995be) · [评论](https://github.com/NanmiCoder/dsh-agent-teams/pull/63#issuecomment-5553188256) |
| [#53](https://github.com/NanmiCoder/dsh-agent-teams/pull/53) english changes | `80839436accd2728b6e40b3d3ec5ee065c5ddf47` | 已 Request changes，保持开放等待作者修改 | [具体审核要求](https://github.com/NanmiCoder/dsh-agent-teams/pull/53#pullrequestreview-5122039245) |
| [#48](https://github.com/NanmiCoder/dsh-agent-teams/pull/48)  通过消除 status 轮询和启用并行工具调用减少 token 浪费 | `3384c38a618e7fc211c18c6e4575f2240592dc55` | 已 Request changes，保持开放等待作者修改 | [具体审核要求](https://github.com/NanmiCoder/dsh-agent-teams/pull/48#pullrequestreview-5122039578) |
| [#38](https://github.com/NanmiCoder/dsh-agent-teams/pull/38) feat: embed AgentTeams activity panel in Better Sidebar tab | `9f8a43f3d23f5176e4a28efec2c9221ebfeb25e4` | 已 Request changes，保持开放等待作者修改 | [具体审核要求](https://github.com/NanmiCoder/dsh-agent-teams/pull/38#pullrequestreview-5122039788) |
| [#37](https://github.com/NanmiCoder/dsh-agent-teams/pull/37) feat: add focus mode to reduce human interruption | `edba4102f18227fa433c03e04f23adbc3e3fa4f3` | 已 Request changes，保持开放等待作者修改 | [具体审核要求](https://github.com/NanmiCoder/dsh-agent-teams/pull/37#pullrequestreview-5122040214) |
| [#34](https://github.com/NanmiCoder/dsh-agent-teams/pull/34) feat: make activity panel draggable + slow snapshot poll to 3000ms | `128b4a6d913d3b1ae5d7178da85937651e4994a8` | 已说明原因后关闭 | [关闭说明](https://github.com/NanmiCoder/dsh-agent-teams/pull/34#issuecomment-5553192153) |
| [#32](https://github.com/NanmiCoder/dsh-agent-teams/pull/32) fix: add prepare script so github: installs build lib/ | `82dda0f19f78f65ae13716166a0e6bf80b3a7a71` | 已 Request changes，保持开放等待作者修改 | [具体审核要求](https://github.com/NanmiCoder/dsh-agent-teams/pull/32#pullrequestreview-5122040968) |
| [#31](https://github.com/NanmiCoder/dsh-agent-teams/pull/31) fix: preserve preset persona for team members | `ff3369241dbf9763e34e11292823d5d78a9d8713` | 已 Request changes，保持开放等待作者修改 | [具体审核要求](https://github.com/NanmiCoder/dsh-agent-teams/pull/31#pullrequestreview-5122041458) |
| [#26](https://github.com/NanmiCoder/dsh-agent-teams/pull/26) fix: sanitize shell/subprocess call in sync-skill.mjs | `b1ad00c2f12030e25898742228d2ea82cb71afed` | 已合并，并回复验收范围 | [合并提交](https://github.com/NanmiCoder/dsh-agent-teams/commit/85c5dfc6f44726ff34d26bbcb9b5e779ad89a2e4) · [评论](https://github.com/NanmiCoder/dsh-agent-teams/pull/26#issuecomment-5553195457) |
| [#21](https://github.com/NanmiCoder/dsh-agent-teams/pull/21) fix: add session-log migration tool for pre-0.1.0 logs (Fixes #19) | `f57096fefe2f04c12fc89d634c7748dfd329d776` | 已 Request changes，保持开放等待作者修改 | [具体审核要求](https://github.com/NanmiCoder/dsh-agent-teams/pull/21#pullrequestreview-5122042120) |
| [#7](https://github.com/NanmiCoder/dsh-agent-teams/pull/7) fix(events): mark team session events ignorable so history survives unknown readers | `95c68dff9226461fa085093f2f1e9eead5e8e821` | 已说明原因后关闭 | [关闭说明](https://github.com/NanmiCoder/dsh-agent-teams/pull/7#issuecomment-5553197890) |

## 41 个 Issue

保留为开放的功能与故障已有明确下一步，不作为本轮已解决事项。#43 的独立 card/floater 开关先记入 #101，再附该评论链接关闭重复讨论；没有丢掉独有需求。

| Issue | 执行后的状态 | 处理结果或待验收事项 | 直接证据 |
| --- | --- | --- | --- |
| [#134](https://github.com/NanmiCoder/dsh-agent-teams/issues/134) cannot restart after install the plugin | Pending | 并入 #120/#127；关闭原因只能duplicate，不能resolved；保留Windows启动验收。 | 保留到最终验收后回复；未在本批关闭 |
| [#133](https://github.com/NanmiCoder/dsh-agent-teams/issues/133) 模块新增的预设无法删除，尽管修改了dsh的配置文件中的的预设但是每个新会话的新预设还是mathv4 | 开放 | 已请求必要版本/复现信息 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/133#issuecomment-5553219103) |
| [#132](https://github.com/NanmiCoder/dsh-agent-teams/issues/132) Harness 0.1.2-rc.1 (public npm) fails to boot: ctx.subagents.registerContinuableSetup is not a function — no installable version works (0.1.15/0.1.14 verified, 0.1.13 source has same call) | Pending | 按 #127 验收真实rc.1产品入口、队员回合/模型/失败/恢复；不能仅skip setup。 | 保留到最终验收后回复；未在本批关闭 |
| [#131](https://github.com/NanmiCoder/dsh-agent-teams/issues/131) DeepSeek Harness 0.1.2-rc.1 兼容：ctx.subagents.followup 已改名 sendMessage，队长消息无法送达队员 | 开放 | 已说明根因和剩余修复范围 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/131#issuecomment-5553220376) |
| [#128](https://github.com/NanmiCoder/dsh-agent-teams/issues/128) 0.1.15 breaks Deepseek-Harness-Desktop (embedded dsh 0.1.1-rc.1): pending uiConversation; auto-upgrade via package ranges makes it worse | 开放 | 已说明根因和剩余修复范围 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/128#issuecomment-5553221518) |
| [#127](https://github.com/NanmiCoder/dsh-agent-teams/issues/127) 适配一下0.1.2-rc.1 | Pending | 精确npmtarball+闭包、启动、fresh/cold/fork、FIFO/steer、力度fallback失败收尾、UI/auth，及不支持版本诊断。 | 保留到最终验收后回复；未在本批关闭 |
| [#126](https://github.com/NanmiCoder/dsh-agent-teams/issues/126) 建议：npm上不要把对应dsh alpha版本的设置为latest | 开放 | 已说明根因和剩余修复范围 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/126#issuecomment-5553222990) |
| [#125](https://github.com/NanmiCoder/dsh-agent-teams/issues/125) [Bug] captain 代成员 claim 后未唤醒，任务可停在 claimed 并产生 attempt_id 轮换 | Pending | 主任务选择禁止captain代成员claim、要求reassign；验证拒绝发生于持久化前、成员自claim可用、attempt不轮换。 | 保留到最终验收后回复；未在本批关闭 |
| [#123](https://github.com/NanmiCoder/dsh-agent-teams/issues/123) [bug] 不兼容宿主 dsh 0.1.2-alpha.5：boot 阶段 `ctx.subagents.registerContinuableSetup is not a function`，导致整个 dsh web 插件树加载失败 | Pending | alpha5和rc1分别验证；Desktop壳/内核/profile分开记录。未有真实Desktop验收不能宣称支持2.0.5。 | 保留到最终验收后回复；未在本批关闭 |
| [#121](https://github.com/NanmiCoder/dsh-agent-teams/issues/121) [feat] 可以把图标加个替换的功能，让客户自由替换不同角色对应的图标吗 | 开放 | 已保留独立功能及验收范围 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/121#issuecomment-5553224038) |
| [#120](https://github.com/NanmiCoder/dsh-agent-teams/issues/120) 0.1.15 在 dsh 0.1.2-alpha.5 下无法加载：ctx.subagents.registerContinuableSetup 已不存在 | Pending | 显式alpha4/alpha5支持边界；不能无限声明alpha4+；真实公开包完整闭包，unsupported入口可诊断。 | 保留到最终验收后回复；未在本批关闭 |
| [#117](https://github.com/NanmiCoder/dsh-agent-teams/issues/117) Describe the bug 使用多Agent团队任务后，Node进程内存只涨不跌，多次任务后触发OOM崩溃。 | Pending | 可复现多轮队伍创建执行归档，固定并发模型，heapUsed/RSS/idle后趋势，存活listeners/agents等；不能凭RSS不降认定泄漏。 | 保留到最终验收后回复；未在本批关闭 |
| [#116](https://github.com/NanmiCoder/dsh-agent-teams/issues/116) Add OrcaRouter as an optional AI provider | 已关闭 | 已说明责任边界后关闭 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/116#issuecomment-5553225569) |
| [#114](https://github.com/NanmiCoder/dsh-agent-teams/issues/114) Feature Request: Prevent long-running AgentTeams members from accumulating excessive context | 开放 | 已保留独立功能及验收范围 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/114#issuecomment-5553227936) |
| [#113](https://github.com/NanmiCoder/dsh-agent-teams/issues/113) can't load | Pending | 旧组合安装文档与升级门禁；本轮未复测旧RC。新的rc1修复不能自动解释旧RC兼容。 | 保留到最终验收后回复；未在本批关闭 |
| [#111](https://github.com/NanmiCoder/dsh-agent-teams/issues/111) An error message prevented deepseek-harness-desktop from starting. | 开放 | 已请求必要版本/复现信息 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/111#issuecomment-5553230093) |
| [#107](https://github.com/NanmiCoder/dsh-agent-teams/issues/107) DSH 从 0.1.1-rc.2  更新到了 0.1.2-alpha.1，插件无法使用 | Pending | 作为历史汇总入口写矩阵链接；明确已验Alpha2/0.1.15、旧rc2/0.1.10历史边界；新版本待published。 | 保留到最终验收后回复；未在本批关闭 |
| [#106](https://github.com/NanmiCoder/dsh-agent-teams/issues/106) [Security] Web 路由（/state /hal /plan /assets）缺少 loopback/设备校验围栏 | Pending | 主任务补halt cap与413、同源/配对/未授权/缺服务failsclosed、dispose重载，保留authgate。 | 保留到最终验收后回复；未在本批关闭 |
| [#103](https://github.com/NanmiCoder/dsh-agent-teams/issues/103) [Bug] Scheduler regenerates attemptId for idle member owning open task, causing stale attempt errors | Pending | 新矩阵下重复kick/idle/registrydisposal/失败投递不换attempt，重启cold有一次rotation为设计；发布后报告人版本确认。 | 保留到最终验收后回复；未在本批关闭 |
| [#101](https://github.com/NanmiCoder/dsh-agent-teams/issues/101) Feature Request: Optional dsh-better-sidebar Integration for the Activity Panel | 开放 | 已保留独立功能及验收范围 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/101#issuecomment-5553231726) |
| [#97](https://github.com/NanmiCoder/dsh-agent-teams/issues/97) 希望增加：全局并发限制 (maxConcurrentWorkers) 并支持限流后自动恢复 | 开放 | 已保留独立功能及验收范围 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/97#issuecomment-5553232977) |
| [#96](https://github.com/NanmiCoder/dsh-agent-teams/issues/96) 太烧token，能做成Agent 预设吗？ | 开放 | 已保留独立功能及验收范围 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/96#issuecomment-5553234461) |
| [#89](https://github.com/NanmiCoder/dsh-agent-teams/issues/89) clean-build.mjs fails on Windows: endsWith('/lib') never matches backslash path | 已关闭 | PR 已自动关闭；补充贡献致谢与验证边界 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/89#issuecomment-5553235408) |
| [#88](https://github.com/NanmiCoder/dsh-agent-teams/issues/88) 是否接受更多开发者参与 | 已关闭 | 已回答或处理通知后关闭 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/88#issuecomment-5553237003) |
| [#81](https://github.com/NanmiCoder/dsh-agent-teams/issues/81) 这个是像Workbuddy里面的团队一样运作的吗？ | 已关闭 | 已回答或处理通知后关闭 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/81#issuecomment-5553238684) |
| [#79](https://github.com/NanmiCoder/dsh-agent-teams/issues/79) 任务完成后再次打开对话，页面会自己弹出来。 | 已关闭 | 限定原报告场景已修复，已关闭 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/79#issuecomment-5553240419) |
| [#78](https://github.com/NanmiCoder/dsh-agent-teams/issues/78) 创建了任务之后，子agent可能是长耗时任务，主agent的轮询时间间隔周期延长，不断快速轮询浪费和污染上下文 | Pending | 主任务改描述/协议一致+实际idle队长被通知唤醒，不禁用诊断status，不改UIpoll代替模型优化。 | 保留到最终验收后回复；未在本批关闭 |
| [#77](https://github.com/NanmiCoder/dsh-agent-teams/issues/77) 显示bug，不应该出现无tasks的Subagent吧，而且还有白色进度条 | 已关闭 | 限定原报告场景已修复，已关闭 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/77#issuecomment-5553242365) |
| [#76](https://github.com/NanmiCoder/dsh-agent-teams/issues/76) 子代理在额度耗尽时缺少降级 / 兜底机制，导致协作进度断裂 | Pending | 统一host保证已有fallback不被setupno-op禁用；remainingchain预算单独验收，quota非必可重试。 | 保留到最终验收后回复；未在本批关闭 |
| [#71](https://github.com/NanmiCoder/dsh-agent-teams/issues/71) issue3-斜杠命令分发.md | 开放 | 已保留独立功能及验收范围 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/71#issuecomment-5553243877) |
| [#70](https://github.com/NanmiCoder/dsh-agent-teams/issues/70) issue2-消息附件.md | 开放 | 已保留独立功能及验收范围 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/70#issuecomment-5553245615) |
| [#68](https://github.com/NanmiCoder/dsh-agent-teams/issues/68) Design partner invitation: lifecycle gate for dsh-agent-teams | 已关闭 | 已回答或处理通知后关闭 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/68#issuecomment-5553247491) |
| [#62](https://github.com/NanmiCoder/dsh-agent-teams/issues/62) Sparse per-task probes and optional Parallel Emission | 开放 | 已保留独立功能及验收范围 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/62#issuecomment-5553249746) |
| [#59](https://github.com/NanmiCoder/dsh-agent-teams/issues/59) Feature proposal: reusable per-member tool policies (allow/deny) | 开放 | 已保留独立功能及验收范围 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/59#issuecomment-5553251169) |
| [#58](https://github.com/NanmiCoder/dsh-agent-teams/issues/58) Feature: Add pluggable visual status indicators for all agents | 开放 | 已保留独立功能及验收范围 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/58#issuecomment-5553252371) |
| [#54](https://github.com/NanmiCoder/dsh-agent-teams/issues/54) 插件模块导出的 name（`agent-teams`）与包名（`@nanmicoder/dsh-agent-teams`）不一致 | 开放 | 已请求必要版本/复现信息 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/54#issuecomment-5553253710) |
| [#43](https://github.com/NanmiCoder/dsh-agent-teams/issues/43) Suggestion: dock the AgentTeams activity panel into dsh-better-sidebar tabs (with patch) | 已关闭 | 独有需求已转入主跟踪，按重复关闭 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/43#issuecomment-5553255004) |
| [#42](https://github.com/NanmiCoder/dsh-agent-teams/issues/42) List dsh-agent-teams on DSH Directory? | 已关闭 | 已回答或处理通知后关闭 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/42#issuecomment-5553257023) |
| [#19](https://github.com/NanmiCoder/dsh-agent-teams/issues/19) [反馈] agent-teams/* 事件导致历史会话重启后无法加载：确认 0.1.0 已修复，但存量会话建议提供迁移工具 | 开放 | 已说明根因和剩余修复范围 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/19#issuecomment-5553259144) |
| [#17](https://github.com/NanmiCoder/dsh-agent-teams/issues/17) readme文件有笔误 | 已关闭 | 限定原报告场景已修复，已关闭 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/17#issuecomment-5553260124) |
| [#11](https://github.com/NanmiCoder/dsh-agent-teams/issues/11) Featured in awesome-deepseek-harness 🐋 | 已关闭 | 已回答或处理通知后关闭 | [实际回复](https://github.com/NanmiCoder/dsh-agent-teams/issues/11#issuecomment-5553262213) |

## 最后 3 个 PR 与 13 个 Issue 的收尾条件

- #119/#124/#130：在同一发布包完成精确宿主矩阵后，回链整合提交、验收报告以及贡献者来源；不能仅以 boot 成功宣称消息、fallback 和恢复能力完整。
- #127/#132/#123/#120/#134：分别记录 rc.1、alpha.5 与 Windows/Desktop 报告边界。#134 可按重复关闭，不能误记为原生 Windows 已验收。
- #113/#107：旧宿主安装指引与新 rc.1 支持分开说明，不能把新版本通过自动推广到所有旧 RC 或 Desktop 内置核心。
- #106/#125/#78/#103：引用各自请求体边界、claim/reassign 状态、真实 idle 通知和 attempt 恢复的检查证据，并说明修复在哪个提交和发行包中。
- #117：仍需可复现的资源数据；#76 的多跳 fallback、provider 退避和预算工具仍为独立增强，不因已有单跳 fallback 通过而全部关闭。

维护者完成这些收尾操作后，应在对应行补入真实评论、审核或提交链接，再更新计数。发布状态以 npm 实际版本与 dist-tag 为准；本执行记录本身不构成已发布声明。
