# AgentTeams 0.1.17-rc.1 / Harness 0.1.5-rc.1 验收

日期：2026-09-10。本地功能验收已完成；本版通过 tag `v0.1.17-rc.1` 触发 GitHub Actions，发布到 npm `next`。发布后的远端运行、最终 tarball 和 npm 消费者验收另记于本目录 `publication.md`。

目标宿主固定为 `@deepseek-ai/dsh@0.1.5-rc.1`，官方 tag `dsh-v0.1.5-rc.1` / `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`。插件基线 `502dd6c6bb1d0f59cb5f902cda4b68494e7aedf4`，实现分支 `codex/harness-015-support`。初始接口审查见 [审查报告](../../harness-0.1.5-rc.1-audit-2026-09-10/README.md)。

## 实现

- 子代理兼容层支持 `dsh.subagent.deliverPrompt`，团队工作显式使用 `queue`；退休成员 guard 覆盖 queue、steer、sendMessage，并在 dispose/HMR 恢复原方法。保留旧 queue 与 Alpha.2 followup 分支。
- 成员初始化显式传递 child Agent，适应新版删除 `Context.agent`；首轮模型、推理力度、fallback、失败收尾与 cold resume 保持有效。
- Web 成员导航选择 Conversation、取消过期导航；全局主面板隐藏团队浮层；返回聊天聚焦新版 contenteditable 输入框，同时保留旧 textarea 兼容。
- 推荐宿主、精确 peers、开发依赖、完整 overrides 与锁文件同步到目标版本。保持另外三个已验证宿主。
- 9 个维护 skills 更新到上游 `ecab245c6c1831c51b0240aca13573b94a6e525e`；增加锁定 commit 的更新器，默认预览、校验本地文件哈希、保护本地修改。见 [更新方式](../../../skills/README.md)。

## 发布前本地产物的验证

发布前本地候选 tarball SHA-256：`208dd0cdf235b4e7b788b8df7c25bb9041f41525f9d857fa3e82978513962147`。详见 [产物信息](artifact.json)。发布准备仅修改 README/发布说明；CI 会重新打包并对其最终产物运行全部矩阵，最终发布摘要不使用这个旧 tarball 的哈希。真实网页最终轮、以下四个矩阵与本机安装均使用这份产物；[安装文件逐项比对](installed-artifact.json) 检查包内全部文件。

`pnpm build`、`pnpm typecheck`、完整 `pnpm verify`、`pnpm test:skills-updater` 与 `git diff --check` 通过。完整日志在 `/tmp/agent-teams-015-validation/final-*.log`。

| 精确宿主 | 真实 CLI Loader + 脚本模型回归 |
| --- | --- |
| `0.1.5-rc.1` | [9/9 通过](runtime-0.1.5-rc.1.json) |
| `0.1.2-rc.1` | [9/9 通过](runtime-0.1.2-rc.1.json) |
| `0.1.2-alpha.5` | [9/9 通过](runtime-0.1.2-alpha.5.json) |
| `0.1.2-alpha.2` | [9/9 通过](runtime-0.1.2-alpha.2.json) |

每份结果记录宿主闭包及 artifact/test 文件哈希。9 项为 lifecycle、lifecycle cold restore、fallback、fallback cold restore、failure、captain idle wakeup、progressive entry、Web approval、protocol compatibility。宿主来自精确 npm 产物，模型是确定性测试 fixture；不能把该矩阵称作真实 API 验证。新增 deliver 模式另由契约、生命周期和成员失败测试覆盖。

新版真实请求把 system 放入消息序列、PTC 事件改名为 `tool/ptc-dispatch`；同步修正了测试 fixture 的观察逻辑。旧 fixture 造成的初次失败保留在临时目录，最终矩阵全部重新运行。

## Ego Lite 真实模型与真实 API

按用户要求，在 Ego Lite 自建 Space 5（`AgentTeams Harness 0.1.5 validation`），工作目录 `/tmp/agent-teams-015-validation/browser-real/workspace`，没有打开文件选择框。通过真实 workspace registry 预先登记临时目录，再从网页富文本输入框发送自然语言任务。

真实 provider 为 `deepseek-official`，模型 `deepseek-v4.1-flash-expires-on-0910`，网页选定推理力度 `high`。引用本机原有凭证存储，没有把凭证复制进验收资料。测试 [观察插件](browser-evidence.mjs) 仅记录请求元数据、实际流用量与工具结果；不替换模型、不伪造回复、不修改 API 请求。

最终包在重启后恢复同一队长会话，创建 `browser-final`，安排 calc 读取 input.txt（3、5、8）并写 final-sum.txt；check 的 t2 依赖 t1，读取总和后写 final-result.md。两名真实子代理均发起官方模型请求并执行写入工具；队长实际复核后汇总，面板显示 2/2。之后按测试指令归档该团队并创建待审计划，用于输入框交互检查。

- [真实 API 验收结果](real-browser.json)、[请求与工具元数据](real-browser-trace.jsonl)、[持久化团队记录](team.json)。计数包含最终任务及后续计划交互，不是模型基准成绩；存在未产生 usage 的结束/中断流，不作为完整响应计数。
- [输入](input.txt)、[总和 16](final-sum.txt)、[PASS 报告](final-result.md)。源输入未变，t2 保留对 t1 的依赖，任务均 completed。
- [队长结果与活动面板](real-browser.png)、[成员历史页](member-transcript.png)、[完整网页文字记录](final-completed-snapshot.txt)。实际点击活动面板成员可进入对应 transcript，重启后可加载历史。
- [返回对话修改检查](composer-focus.json)：真实待审计划点击该按钮后，活动面板收起且新版 contenteditable 输入框获得焦点。
- [全局面板检查](layout.json)、[截图](global-panel.png)：通过 [测试专用 main/sidebar 插槽组件](layout-probe.js) 注册一个全局主面板，切入后活动面板与入口消失；从侧栏返回队长会话后重新出现。Settings 是弹窗，不是全局主面板。异步导航取消由自动回归覆盖。

初次真实网页请求失败于 `REQUEST_EXTENSION`：测试观察模块所在 profile 声明了 name 却未声明 version，触发官方插件清单准备校验。补齐测试 profile 元数据后恢复正常，没有关闭请求扩展来规避问题。修正后的最终真实 API 记录无模型错误。

早先另一个真实模型 headless 审查 benchmark 在请求上限 100 附近结束（记录 102 次请求）；三个成员报告完成，但队长汇总缺失，**该 benchmark 未通过**。它不是上述成功的网页小任务，也不能据此承诺模型在任意复杂任务都能自行收尾。失败结果保留在 `/tmp/agent-teams-015-validation/real-model-015/candidate/result.json`。

Ego Lite 测试空间已结束，测试宿主已停止。没有修改用户真实项目文件。

## 会话迁移

使用旧 `0.1.2-rc.1` 回归产生的队长、队员会话副本，放入独立 DSH_HOME。通过新版真实 `sessionPersistence.open` 执行 read → write → reopen：两个日志均成为 v3，父子关系与成员 descriptor 保留，重读事件数一致，原 v0 文件 SHA-256 未变。见 [结果](migration.json)、[驱动](migration-driver.mjs)。

这是两份真实样本的格式迁移验证，加上四版本各自的 cold resume 回归；没有对用户生产会话进行迁移，也不表示所有损坏/自定义历史日志都兼容，不支持新旧宿主共享可写会话目录降级。

## 安装与范围

全局 CLI 已按官方 npm 产物安装为 `0.1.5-rc.1`，native 依赖构建成功。隔离的 `agentteams-015` profile 只包含 base、web-app 与 AgentTeams，231 个宿主包检查通过；全局 CLI 启动 smoke 成功。检查摘要见 [安装文件核对](installed-artifact.json)。

标准安装命令见根目录 README。本插件验收不覆盖同一 profile 中其他第三方插件；共享旧版依赖的其他插件需分别核对。Desktop 内置核心不会随全局 CLI 自动升级。

有归档的旧会话和上述迁移样本已验证。早期版本执行删除时未保留团队归档的历史会话，目前不能从 session 日志重建完整面板；本次发布不实现该功能。宿主官方 `0.1.5-rc.1` Web UI 仍显示预览文案，实际版本以 CLI 和解析到的包为准。
