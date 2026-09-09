# v0.1.16-rc.3 发布验收

`@nanmicoder/dsh-agent-teams@0.1.16-rc.3` 已通过 tag 触发的 [Publish Package Action](https://github.com/NanmiCoder/dsh-agent-teams/actions/runs/34353925675) 发布到 npm `next`，并生成 [GitHub 预发布](https://github.com/NanmiCoder/dsh-agent-teams/releases/tag/v0.1.16-rc.3)。发布源为 `bf17f93d35ef75964e96333ff644ab2c9c57b3cb`；此目录是在发布完成后归档的回执，不包含在该 tag 的 npm 包中。

## 发布与产物

- [8 个 Action 任务全部通过](./action-summary.json)：Ubuntu 和 Windows 检查、三个精确 Harness 版本、完整兼容性汇总、npm publish、GitHub release。
- [官方 registry 核验](./npm-identity.json)：`next = 0.1.16-rc.3`，`latest = 0.1.15`，`alpha = 0.1.15-alpha.1`。
- [GitHub 回执](./github-release.json)：`prerelease = true`，`draft = false`。
- 正式 tarball 的 SHA-256 为 `4584cf9b4b2270f7c907cb862d2134d4624f69b45ad5d5f8c31de7a80bbd45f0`；与 Action 验收包逐字节一致，SHA-512 integrity 和 SHA-1 shasum 均匹配 registry。

此前的 [rc.2 发布 Action](https://github.com/NanmiCoder/dsh-agent-teams/actions/runs/34352468598) 因 Windows 动态 ESM import 使用磁盘路径而失败，没有发布 npm rc.2 或 GitHub Release。保留原 tag；rc.3 将测试和 benchmark runner 改为 file URL。随后 main CI 暴露生命周期测试对 20 毫秒完成调度的假设，已改为等待真实投递，并以延迟投递覆盖回归。业务代码没有因这两项测试修正而变化。

## 同一候选包的宿主矩阵

三个 Ubuntu / Node 24.20.0 宿主分别通过 9 个场景：生命周期、生命周期冷恢复、fallback、fallback 冷恢复、失败收尾、队长 idle 唤醒、六种业务入口、Web 审批、工具白名单及历史压缩兼容。所有报告绑定同一 tarball SHA-256 和测试文件摘要。

| Harness | 精确 DSH 分包数量 | 结果与依赖闭包 |
| --- | --- | --- |
| 0.1.2-rc.1 | 214 | [结果](./ci/0.1.2-rc.1/result.json) / [闭包](./ci/0.1.2-rc.1/cohort.json) |
| 0.1.2-alpha.5 | 214 | [结果](./ci/0.1.2-alpha.5/result.json) / [闭包](./ci/0.1.2-alpha.5/cohort.json) |
| 0.1.2-alpha.2 | 215 | [结果](./ci/0.1.2-alpha.2/result.json) / [闭包](./ci/0.1.2-alpha.2/cohort.json) |

模型是确定性外部适配器；CLI、Loader、插件、工具、成员、消息和持久化使用真实宿主实现。Windows CI 覆盖 typecheck/build/verify，不代表 Windows/Desktop 完整业务实测。

## npm 消费复验

从官方 registry 下载正式 tarball，在 `/tmp` 下的测试专用 runtime/profile 中重新安装，使用真实 Harness `0.1.2-rc.1`、macOS arm64、Node 26.7.0 运行：

- [生命周期和冷恢复](./consumer/result.json) 通过，包含成员执行、推理设置、完成状态、二次唤醒、忙时消息 FIFO 和同一成员恢复；测试进程正常退出。
- [214 个 DSH 分包](./consumer/cohort.json) 版本一致，[安装后的 doctor](./consumer/doctor.json) 返回 `ok = true`。
- [91 个安装文件](./consumer/installed-artifact-match.json) 与正式 tarball 全部逐字节匹配。
- [请求工具清单](./consumer/tool-exposure.json) 确认队长 13 个团队工具、成员 4 个，保留普通编程工具，未暴露 `agent_teams_open`。

此消费测试使用确定性模型，不是一次新的真实供应商 API 测试；没有修改用户实际 profile。

## 发布前真实模型与浏览器证据

[源代码关联](./source-acceptance-link.json) 确认发布源与 `7468f992c3195f6a1c7d7905c239fc7fbca3fcfc` 的生产源码、配置和 assets 未变。此前的[真实模型验收](../../no-open-verification.json)完成了三成员审查，以及带历史 `open` 调用的旧会话续聊；后者保留原团队和三名成员，仅增加一项任务。

[产物差异](./candidate-vs-source-acceptance.json)表明运行时文件和 assets 字节一致，仅客户端 bundle 的构建路径注释与两组 CSS module 前缀随 CI 路径变化；对这三项精确替换后客户端内容完全一致。其余差异是版本及发布文档。

[Ego Browser 实测](./browser-source-smoke.json)使用同一业务代码的本地 rc.2 候选包、真实 Harness `0.1.2-rc.1` Web 和确定性模型，在 `/tmp` 工作区完成了卡片/活动面板渲染、点击批准、队长收到通知、成员执行及显示完成。成功流程通过 SDK 创建 session 和注册 `/tmp`，没有使用 workspace 选择器。[测试服务、浏览器和自建团队已清理](./browser-cleanup.json)。这份浏览器记录属于发布前候选，不冒充正式 npm 包的再次浏览器实测。

固定插件前缀避免团队生命周期造成的 system/tools 变化；不保证供应商缓存必然命中，也不证明总费用下降或各类业务成功率相同。原始验收记录中列出的未覆盖项是当时范围，后续浏览器及正式发布证据由本目录补充。

## Issue 处理

[#138](https://github.com/NanmiCoder/dsh-agent-teams/issues/138#issuecomment-5602265451) 与 [#146](https://github.com/NanmiCoder/dsh-agent-teams/issues/146#issuecomment-5602266378) 已在发布及消费验证完成后说明修正范围并关闭，见[状态回执](./issues.json)。团队锁清理 PR #143 已包含在本版，但并未据此关闭更广泛的 OOM 或其他不相关问题。
