# 0.1.16-rc.1 发布与消费验收

`@nanmicoder/dsh-agent-teams@0.1.16-rc.1` 已通过 [Publish Package Action](https://github.com/NanmiCoder/dsh-agent-teams/actions/runs/33981644849) 发布到 npm `next`，并创建 [GitHub 预发布](https://github.com/NanmiCoder/dsh-agent-teams/releases/tag/v0.1.16-rc.1)。发布源为 `eb09334f9a76dac890a25673449a6a51d5ceffcb`，标签为 `v0.1.16-rc.1`。

## 发行结果

- [Action 回执](./action-summary.json)：Windows/Ubuntu 构建及完整 verify、三个 Ubuntu 精确宿主、汇总门禁、npm publish、GitHub release 共 8 个 job 全部成功。
- [官方 npm 回执](./npm-registry.json)：`next = 0.1.16-rc.1`，`latest = 0.1.15`，本轮没有移动默认渠道。
- [GitHub 回执](./github-release.json)：`prerelease = true`、`draft = false`。
- 正式包 SHA-256：`624bece6eabcac162d0570d487b947b93f81785ed592464ce2601f5a371d1f26`。
- 官方 registry 下载包与 Action 验收产物逐字节相同，SHA-512 integrity 和 SHA-1 也通过核对；安装后 85 个文件全部匹配。见 [来源核验](./consumer/npm-identity.json)与[安装核验](./consumer/installed-artifact-match.json)。
- 相比此前 CI 验收产物，只有两个 README 和本版发布说明变化；运行代码与 assets 字节相同。见[产物差异](./artifact-diff.json)。

## 从 npm 重新安装后的验收

使用官方 `registry.npmjs.org` 下载正式包，在独立 `/tmp` profile 中安装；实际工作区为 `/tmp`（macOS 规范路径 `/private/tmp`）。Harness `0.1.2-rc.1`、macOS arm64、Node `24.20.0`，完整 214 个 DSH 分包版本一致；真正安装的 doctor 命令返回 exit 0 / ok。详见[消费结果](./consumer/result.json)、[依赖闭包](./consumer/cohort.json)和[doctor](./consumer/doctor.json)。

真实 `deepseek-official/deepseek-v4-flash` 完成建队、成员领取/更新/完成任务、消息回报和队长确认：单条 driver 初始提示，25 次模型请求，11 个行为断言通过，耗时约 21 秒；进程正常退出。请求上限 30、超时上限 180 秒，未进行第二次 API 尝试。队长和成员各调用 status 两次，没有持续轮询。

本次模型在任务下发前启动了成员欢迎轮，产生 native ready 消息及排队提醒。首次唤醒来自宿主原生消息，随后真正的 AgentTeams 完成报告被队长消费；`firstWakeContainsAgentTeamsMemberMessage = false` 原样保留。因此本次消费验收证明正常端到端协作，不单独证明 AgentTeams 唤醒因果。该边界由发布前的独立确定性场景验证。队长也自行把答案写进任务，成员仍执行了真实算术核验；这次不是盲推理 benchmark。角色、工具次数及时间线见[请求分析](./consumer/request-analysis.json)。

凭据仅在子进程内存传递，未复制用户配置。精简记录不含凭据、完整环境和原始进程日志；[凭据扫描](./consumer/credential-scan.json)零命中，[测试进程已退出](./consumer/cleanup.json)。未修改用户 npm 配置或真实 profile。

## 安装本次预发布

先确认实际宿主为支持矩阵中的精确版本，并保持依赖闭包一致。推荐宿主目标是 `0.1.2-rc.1`；另支持已验的 `0.1.2-alpha.5` 和 `0.1.2-alpha.2`。在实际使用的 profile 中安装（以下为 `web`）：

```sh
dsh plugin --profile web add --save-exact @nanmicoder/dsh-agent-teams@0.1.16-rc.1
```

安装后重启实际 Harness 进程并刷新 Web。旧 Desktop 内置核心不能通过升级全局 CLI 自动替换；Windows 实际宿主运行、Desktop 组合、Node 22 运行及 OOM 长期资源问题不由本次 macOS 消费结果证明。Windows CI 的通过范围是原生 runner 中的 typecheck/build/verify。Node 22 未在本轮运行，不表示不支持，也不作为原故障归因。

`next` 供显式选择的预发布用户使用；普通用户默认 `latest` 的后续稳定版本迁移继续在 [#126](https://github.com/NanmiCoder/dsh-agent-teams/issues/126) 跟踪。
