# 宿主兼容与仓库维护实施记录（2026-09-06）

本轮将社区维护 skills、兼容代码、依赖策略、真实宿主验收和 GitHub issue/PR 处理一起落地。候选插件版本为 `0.1.16-rc.1`，目标渠道为 `next`；准备代码和候选不等于已经发布。

## 结论与版本政策

普通用户的默认验收目标是 **Harness 0.1.2-rc.1**。这仍是 RC，不是 GA。Alpha.5 是主动选择的预览目标，Alpha.2 作为旧预览保留。支持范围是三个精确版本，不能把 `^0.1.2-alpha.2` 或“后续版本”当成运行保证。上游 Harness 的 npm 标签归上游维护；本仓库可以控制自己的渠道、安装说明和发布门禁。

初查与提交前复核时 Harness npm `latest` 和 `next` 都指向 rc.1，`alpha` 指向 Alpha.5；插件 `latest` 却是只明确适配 Alpha.2 的 0.1.15。单独把宿主 CLI 固定到 Alpha.2 仍会解析出 rc.1 间接分包。开发基线从 Alpha.2 切到 rc.1 时也发现 23 个残留 Alpha.2 peer 分包，导致真实导出缺失。这解释了为什么只看版本字符串或只改一个依赖经常反复出问题。

现在 `compatibility.json` 驱动开发校验和 CI matrix；开发依赖全部精确固定，并通过整组 overrides 与 frozen lockfile 约束。只读 doctor 检查实际依赖路径、完整宿主分包、缺失的运行依赖、重复 DSH/Cordis 身份和 profile 插件版本。alpha/beta/rc 插件统一走 `next`，无后缀 `latest` 必须在推荐宿主及完整矩阵上通过。

## PR #130 为什么不能直接作为最终修复

[#130](https://github.com/NanmiCoder/dsh-agent-teams/pull/130) 找到了成员消息入口变化，但简单 fallback 到公开 `sendMessage` 会将原 FIFO 任务投递变成忙碌时 steer。旧方法还必须保留 receiver；跳过缺失的 setup 则会同时丢失模型设置、fallback 和失败处理。

统一实现采用 #124 的同步 session-start、ownEvents 和 host FIFO 方向，吸收 #119/#130 的迁移分析及复现，补上 Alpha.2 加载、方法 receiver、retired 成员所有消息入口、生命周期清理及失败时停止请求。三个原 PR 的作者和来源记录在发布说明及处理清单中。精确官方源码和分包证据见 [合同审查](./host-contract-review.md)及 [源码摘要](./host-contract-evidence.json)。

真实测试继续发现了两处既有 fallback 漏洞：手动 add_member 没保存 fallback 配置；同一 step 的请求重试没有重新 assemble，仍使用旧模型快照。两处均加入回归并修复，不能用之前的 mock 通过代替这些真实结果。

## 社区流程落地

已固定引入 `oh-my-dsh/dsh-plugin-upgrade-skill` 的 `cd4d497588cdd4f16300622779b62a78fe803169`，保留 MIT 和 115 个上游文件摘要，包含 9 个 skills。规范源是 `skills/`，`.dsh/skills` 为完整同步副本，`.agents/skills` 通过相对链接发现。本地适用规则单独记录，未改写上游指导。

已检查其迁移卡、benchmarks 和更新测试：它们帮助选择审查路径，不是本插件的产品验收，也不会保证扫描零命中就没有接口风险。细节见 [skills 研究](../upgrade-skill-study-2026-09-06/README.md)、[维护流程](../maintenance-workflow.md)和 [贡献指南](../../CONTRIBUTING.md)。

## 验证证据

最终候选在 macOS arm64 / Node 24.20.0 的三宿主验收全部通过：18 段、126 个断言。完整结果见 [Alpha.2](./runtime-alpha2.json)、[Alpha.5](./runtime-alpha5.json) 和 [rc.1](./runtime-rc1.json)，实际闭包分别为 215、214、214 个同版本 DSH 包。

候选 tgz SHA-256：`6325e972566092bb0ec07d6065113ebd0fcf5877e475b2961dc8b049c2a2654c`。各报告也记录测试入口及 fixtures 的文件摘要。最终安装命令又发现并修复了 npm bin 符号链接导致 doctor 空跑的问题；真正安装的 bin 在三版本 profile 中均输出有效 JSON 并返回成功。确定性 Web 截图对应上一包，最终包只有 doctor 入口变化，产品 lib/assets 字节完全一致，随后再次通过三宿主完整矩阵；真实 API Web 补验使用最终包。测试使用真正的 npm 宿主、CLI、profile、AgentTeams 产物、工具、队员和会话；仅外部模型适配器返回确定性内容，不使用真实账号凭据。

| 场景 | 验证内容 |
| --- | --- |
| lifecycle | 产品入口建队和成员完成任务；忙碌时两条消息保持 FIFO；显式 high reasoning；成员二次唤醒 |
| lifecycle-cold-restore | 新进程恢复同一个成员、模型和推理力度 |
| fallback | 真实 AUTH 请求错误切换备用路由；清除主模型的力度选择 |
| fallback-cold-restore | 冷恢复后继续备用模型，不回退到失败主模型 |
| failure | 无备用路由时失败落盘并完成队长侧收尾 |
| captain-idle-wakeup | driver 只发一次初始请求；队长先 idle，成员完成后通过真实消息唤醒同一队长 |

类型检查、构建、完整 verify、真实 HTTP 请求上限与鉴权、安装诊断、发布元数据和 skill 同步检查均通过，日志已归档在本目录。Ego Browser 在 Alpha.5 和最终 rc.1 包中通过真实输入创建团队、完成任务并显示面板；检查了模型徽章、浮动/停靠、面板缩放及深色主题。Alpha.5 的面板从 388×530 调整为 499×620，收起后再次打开保留尺寸。CI 进一步要求 Ubuntu 与 Windows 静态检查、三个 Ubuntu 宿主运行检查全部成功；每个宿主安装同一个 tgz，汇总检查每份报告的版本、文件摘要和全部六个场景，发布使用同一个产物。

[真实 API 补验](./real-api/summary.json)已在三宿主通过（41 次请求、33 个断言）：使用用户既有的 `deepseek-official/deepseek-v4-flash` 路由，直接在 `/tmp` 执行（macOS 规范路径为 `/private/tmp`）。Alpha.2、Alpha.5、rc.1 分别有 12、15、14 次真实请求；每个版本都由模型建队，成员 claim → in_progress → completed 并报告，队长首次 yield 后收到包含成员报告的真实请求、确认独立计算得到的 385。driver 只发送一次初始提示，没有写入假任务结果。凭据仅在测试子进程内存传递，不复制到仓库或报告。

最后又从 Ego Browser 向 rc.1 Web 的已有 `/tmp` 工作区输入一次验收指令，真实模型完成建队、worker 领取和交付、消息上报、队长等待后唤醒与核对，活动面板显示 `1/1 完成`。没有打开目录选择框，也没有 driver 追加提示。界面和模型徽章见 [真实 API Web 截图](./web-real-api-rc1.png)；精简记录见 [Web 验收结果](./real-api/web-rc1/result.json)。

真实模型可选择调用宿主原生工具，Alpha.5 还通过计算命令复核答案；这组测试证明真实用户流程，不声称隔离所有通知入口。通知边界由前述确定性场景单独验证。首轮隔离 profile 缺少 package.version，被真实插件清单扩展在 HTTP 前拒绝；补齐测试元数据后才计入成功，未关闭该扩展或把前置错误当 API 成功。

[CI 最终验收](./ci/run.json)的六个检查全部成功：Ubuntu/Windows 完整构建与 verify、三个 Ubuntu 真宿主矩阵和汇总门禁。整合 PR [#135](https://github.com/NanmiCoder/dsh-agent-teams/pull/135) 已合入主线 `ae2ef8342b7b9c02fd2868847d6c7b148d394145`。

CI 首轮 Ubuntu 全部检查通过；Windows 暴露归档锁测试固定 80ms 的时间竞赛，已改为在第一次真实 OS rename 拒绝后握手释放锁，再要求产品重试成功。只改测试，未调整产品重试期限。CI 构建包与本地验收包有路径相关的 CSS module hash 差异；[逐文件比较](./ci-artifact-comparison.json)确认仅 client.js 的两个 CSS 前缀和构建路径注释变化，其他 84 个文件字节一致。CI 的宿主矩阵和发布始终使用同一个 CI 产物。

测试边界明确保留：确定性模型测试本身不是实际 provider API 验证；macOS CLI/Web 通过不等于任意 Windows/Desktop 壳版本通过；本次未改写真实用户历史日志，也没有将 OOM 报告或尚未实现的功能标成已修复。

## GitHub 处理

[实际处理清单](./actions.md)记录 25 个原有 PR 和 41 个 issue 的审查与执行链接；[PR 审查快照](./pr-review.md)和 [issue 审查快照](./issue-review.md)保留决策理由。9 个独立贡献保留原提交合入 main。重叠适配在统一实现中溯源；需要重基、拆分或补验收的功能 PR 留待作者继续。已修复、已合并、已发布和已验证分别说明。

新旧会话迁移工具、结构化附件、工具策略、多跳 fallback、预算、Sidebar 等需求保留开放；重复报告并入主跟踪时保留独有触发条件。不能把清空 issue 列表当作维护完成。
