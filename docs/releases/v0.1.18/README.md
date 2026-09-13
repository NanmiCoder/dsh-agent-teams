# v0.1.18 发布验收

2026-09-13 已发布到 npm `latest`，源码提交 `68fe529d602b1eea1f1ecaee99857d20a4f94be0`。

- [发布 Action](https://github.com/NanmiCoder/dsh-agent-teams/actions/runs/34741251212)：成功，Ubuntu / Windows 静态检查及四版本宿主各 10 个场景全部通过。
- [main Verify](https://github.com/NanmiCoder/dsh-agent-teams/actions/runs/34741249648)：成功。
- [GitHub Release](https://github.com/NanmiCoder/dsh-agent-teams/releases/tag/v0.1.18)：已发布，非草稿、非预发布。
- 官方 npm registry 确认 `latest=0.1.18`；`next=0.1.17-rc.1`、`alpha=0.1.15-alpha.1` 未变。
- 从官方 registry 下载的精确版本与发布 Action 验收候选逐字节一致，SHA-256：`f6c1950f66744fa5aa27f6f8d9f56df58fe144a16a2e32e765be2b5dc38f57ee`。包含 96 个文件，不含测试报告、会话日志或凭据。

发布后将 npm 包装入隔离的 `0.1.5-rc.1` 宿主，再跑完整回归。首轮 9/10 通过；Web 审批场景在测试收尾的 `ctx.sessions.flush` 处出现 `SessionHandleClosedError`，未到达最终断言。原始结果及 stderr 保留。未改源码、包或断言，在新隔离 profile 单独复跑 Web 审批后通过。不能将首轮记录改写成全部通过；测试收尾的会话关闭/flush 竞态仍是已知测试稳定性限制。

CI 四宿主为 `0.1.5-rc.1`、`0.1.2-rc.1`、`0.1.2-alpha.5`、`0.1.2-alpha.2`，模型为确定性 fixture，Harness CLI、插件、会话与工具为实际运行。发布后复验同样使用 fixture，没有重复调用真实 API。此前六成员、十七任务真实 DeepSeek 测试、外部 32 项断言及限制见[完整报告](../../session-latency-audit-2026-09-12/complex-test-report.md)。本次发布没有新增浏览器或 Windows Desktop GUI 验证，保留此前 UI 验收边界。

本地 main 已快进合并当前 worktree，原 main 已提交的修复全部保留。main 中未跟踪的历史分析文档保持原状，未混入发布。
