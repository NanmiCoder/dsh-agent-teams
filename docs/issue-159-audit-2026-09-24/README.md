# Issue #159：已发布版本复现与修复归因

调查始于 2026-09-24，结束于北京时间 2026-09-25 凌晨。macOS arm64、Node 26.7.0。调查对象：[issue #159](https://github.com/NanmiCoder/dsh-agent-teams/issues/159) 及两份附件、两条评论。没有修改生产代码、发布版本或回复/关闭 issue。

**结论：标题所述消息积压的关键机制在 0.1.17 上复现，0.1.18 与最新 0.1.20 上不再复现；有明确修复提交 `68fe529d602b1eea1f1ecaee99857d20a4f94be0`。但附件 P5/S3 的终态证据补录问题在 0.1.20 仍能复现，不能称整个 issue 全部解决。**

## 版本及测试对象

- npm `latest` 为 `@nanmicoder/dsh-agent-teams@0.1.20`，2026-09-17 06:07 UTC 发布。
- 报告称“9 月 11 日最新版本”。当天 09:47 UTC 发布的是 0.1.17；此前为 0.1.17-rc.1。报告没有给出精确安装记录，不能断言其现场一定加载了哪一个包。本轮选择 0.1.17 作旧版对照。
- 0.1.18 于 2026-09-13 05:52 UTC 发布，晚于 issue 创建时间。
- 远程 main 和本地基线均为 `87c95c94d7847e4a242cb589916adc519981175f`。
- 三个版本都直接下载 npm tarball，而非用当前源码冒充旧包。SHA-256 见 [manifest.json](manifest.json)。
- 全部产品入口试验使用真实已发布 Harness **0.1.5-rc.1**，核验了 **231 个 DSH 分包**的锁文件和磁盘版本，见 [host-cohort.json](host-cohort.json)。隔离 profile、团队数据和试验文件均在 `/tmp/issue159-20260924`。

## 同一个探针对照三份 npm 包

通过真实 CLI、Loader、Agent、工具执行器和子代理运行时执行；只把 LLM 输出替换为可控 fixture，以固定并发时序。两个成员各自领取任务后，让接收者停在一个模型请求中；队长发 20 条、另一成员发 20 条，再让接收者执行下一次模型步骤。

| 观察项 | 0.1.17 | 0.1.18 | 0.1.20 |
| --- | --- | --- | --- |
| 40 条消息进入 `nextStep` | 0 | 40 | 40 |
| 40 条消息进入 `nextTurn` | 40 | 0 | 0 |
| 消费前邮箱未读数量 | **0，提前标已读** | 40 | 40 |
| 下一模型步骤收到队长 / 队员消息 | **0 / 0** | 20 / 20 | 20 / 20 |
| 上游取消后，captain 取消未启动的下游任务 | **拒绝，仍 pending** | cancelled | cancelled |
| 活跃任务同成员改派 | attempt 1 → 2 | attempt 1 → 2 | attempt 1 → 2 |
| staged 建任务显式 assignee | 正确保留 | 正确保留 | 正确保留 |
| 完成后补交 `commandsRun` | **返回成功但未保存** | **返回成功但未保存** | **返回成功但未保存** |
| 完成后改写 output | immutable 拒绝 | immutable 拒绝 | immutable 拒绝 |

证据：[0.1.17](probe-0.1.17.json)、[0.1.18](probe-0.1.18.json)、[0.1.20](probe-0.1.20.json)。各自的 `*-events.jsonl` 保留全部探针观察与真实工具参数/结果。**JSON 中 `passed: true` 表示诊断序列完整执行，不表示该版本没有缺陷。**

旧版本明确复现了“工作还没结束，纠正消息在下一轮排队，邮箱却已无未读”的机制。它会使忙碌成员继续根据旧指令执行，直到结束当前轮才处理消息。本轮没有原报告完整会话与项目，因此不声称重放了原现场的 7 轮返工或无限死锁。

0.1.20 另外通过仓库原有的完整 stability 产品入口场景：32 条纠正在一步消费、状态工具先读回执后的续步、同成员重派清除旧指导、32 条待处理消息及活跃后代的归档清理、一次原生完成通知去重等，见 [runtime-stability.json](runtime-stability.json)。另在发布包上执行 7 项稳定性单测与 117 项生命周期检查，全部通过。

## 真实 DeepSeek 模型压力测试

使用本机既有 credential 引用，未复制或输出密钥；真实路由 `deepseek-official / deepseek-flash`。三位成员分别只读审查性能、安全和交互问题，队长与 security 成员各向 performance 发送 12 条额外提醒。没有预编排模型工具调用顺序。

- **104.322 秒，43 次模型请求；24 条额外提醒实际发送成功。**
- 三位成员分别写入自己的报告，三项任务全部完成，队长在完成后生成汇总。
- 总任务数保持 3，没有重复建卡；0 个工具错误、0 个模型错误。
- 外部验收确认报告对应真实源码问题、写入来源属于相应成员、原始 app 文件未变。
- 未观察到死锁或重复返工；这是一个真实、有限规模试验，不能证明所有大型质量管线都不会循环。

见 [结果](real-model-result.json)、[调用记录](real-model-trace.jsonl)、[运行清单](real-model-manifest.json)、[测试输入及独立验收](real-model-case.mjs)。

## 明确修复提交

[68fe529 — fix: stabilize team scheduling and prepare v0.1.18](https://github.com/NanmiCoder/dsh-agent-teams/commit/68fe529d602b1eea1f1ecaee99857d20a4f94be0)，2026-09-13，首次随 **v0.1.18** 发布。

与本问题直接有关的改动：

1. `src/harness-compat.ts` 新增 `steerMemberPrompt`；`tools.ts` 的协作消息从排队新轮次改为最近模型步骤。真实宿主 `Activation.deliver` 明确区分 `steer → agent.steer` 与 `queue → agent.followup`，不是猜测 API 名字。
2. 新增 `src/mailbox.ts`，按消息 ID 确认消费，区分 delivered/read，过滤旧 task/attempt 的消息。
3. 重派时清理旧邮箱输入、停止成员分支，保留失效 attempt 的权限隔离。
4. 已成功送达团队完成汇报后，抑制重复的原生成功 settle 唤醒。
5. 允许 captain 直接取消 `pending && attempt === 0` 的未启动成员任务，解除附件 S2 的取消死结。

[0.1.18 release notes](../../release-notes/v0.1.18.md) 也记录了这些行为。本次额外运行实际 0.1.18 包，确认它已经具有修复后的消息行为，而非只依据发布文案归因。

**归因限制：** 同成员改派的 `invalidateTaskAttempt` 早在 `8efbac8` 已存在；这次三版均从 attempt 1 到 2。附件 P1/S1 的“同成员永远 no-op”没有在本次条件下复现，不能把它单独笼统归因于 68fe529。同样，显式 assignee 三版都保留，未复现 P2 的丢失。原报告的特定 quality pipeline、旧上下文及 P3/P4/P6 的组合状态没有完整重放。

## 当前仍存在的 P5/S3

真实 member 工具调用：

```json
{"task_id":"t2","attempt_id":"<current>","status":"completed","commandsRun":[{"command":"SUPPLEMENTAL_EVIDENCE","status":"passed","exitCode":0}]}
```

在任务已 completed 时，返回 `isError: false` 和既有 output，但读取持久化 `team.json`，**没有 commandsRun**。如果把 output 改为补充内容，则返回 `terminal task t2 is immutable`。

根因位于当前 `src/tools.ts` 的 terminal 分支：只比较 status/output，若相同便提前 return，未处理新增证据字段。终态不可改写可以是设计选择，但“补交证据显示成功却静默丢弃”仍是确切残留。建议作为独立问题处理；本次只调查，未改生产逻辑。

另外，消息去重针对同一 ID 的重复投递和原生 settle。模型主动多次调用 send_message 产生的新 ID、或语义上互相矛盾的重复指令，不会自动做语义合并。附件 S5 的自动建卡可见性、C1/C2 的上下文漂移和 9 月 20 日评论的僵尸修复链，不能由这次有限测试宣称全面解决。

## 复跑

从仓库根目录执行，用全新的目录，避免覆盖历史证据：

```sh
node docs/issue-159-audit-2026-09-24/prepare-runner.mjs /tmp/issue159-runner-new
mkdir -p /tmp/issue159-artifacts-new
npm pack @nanmicoder/dsh-agent-teams@0.1.20 --ignore-scripts --pack-destination /tmp/issue159-artifacts-new
node /tmp/issue159-runner-new/harness-runtime-verify.mjs --host-version 0.1.5-rc.1 --artifact /tmp/issue159-artifacts-new/nanmicoder-dsh-agent-teams-0.1.20.tgz --scenario stability --report-dir /tmp/issue159-latest-new
```

旧版、首个修复版替换为 0.1.17/0.1.18；可以依次使用 `--runtime-dir /tmp/issue159-latest-new/runtime` 复用已核验依赖，不能并发安装到同一 runtime。标准完整稳定性场景使用仓库原始 `scripts/harness-runtime-verify.mjs`。

真实 API 压力场景（会调用现有配置的 DeepSeek API）：

```sh
node /tmp/issue159-runner-new/harness-model-benchmark.mjs --runtime-dir /tmp/issue159-latest-new/runtime --baseline-artifact /tmp/issue159-artifacts-new/nanmicoder-dsh-agent-teams-0.1.20.tgz --candidate-artifact /tmp/issue159-artifacts-new/nanmicoder-dsh-agent-teams-0.1.20.tgz --report-dir /tmp/issue159-real-new --only candidate --timeout-ms 360000 --max-requests 100
```

未验证：报告者的确切 Harness/插件安装组合、Windows/Desktop GUI、其他供应商、原始项目全部对话的逐字重放和所有异常重试交错。未动日常 profile。建议将标题的消息队列故障判为 **0.1.18 已修复、0.1.20 已复验**，同时保留/拆分终态证据补录等残留，而不是无条件关闭整个报告。
