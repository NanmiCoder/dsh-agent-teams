# Issue #159 修复与关闭依据（2026-09-25，本地未发布）

问题：[GitHub #159](https://github.com/NanmiCoder/dsh-agent-teams/issues/159)。历史复现见 [原调查](README.md)，新增行为见 [接口约定](task-evidence-and-messages.md)。原调查保留当时结果，本报告记录后续代码修复。

## 结论与覆盖范围

原始“几十条消息积压到下一轮”的机制已由 `68fe529d602b1eea1f1ecaee99857d20a4f94be0` 修复，首次包含于 0.1.18。相同探针在 0.1.17 复现 40 条消息全部 nextTurn、提前已读，在 0.1.18/0.1.20 验证 nextStep 投递及消费后确认。

本次补齐仍会诱发返工和混淆的路径：

| Issue 现象 | 验证与处理 |
| --- | --- |
| P1/S1 同成员重派无效 | 三个已发布版本都能生成新 attempt 并撤销旧执行资格，没有把未复现现象宣称为新修复。 |
| P2 指定负责人未生效 | 发布包探针保留 assignee；未复现，原证据保留。 |
| P3/P4 pending 无法领取、调度 | 用状态机、真实 Harness 调度与真实模型继续任务检查；受依赖阻塞的任务仍应保持阻塞。 |
| P5/S3 完成后证据无法补录 | 新增归属到作者和 attempt 的追加式证据；重复提交幂等，不改原结论、完成时间或重新执行。 |
| P7/C3 重复汇报、过期结果 | 标记消息来源任务/attempt/status；实时投递及邮箱回退均过滤失效消息；完全相同报告复用 ID、不再唤醒。 |
| S2 未启动的阻塞任务不能取消 | 原修复及现有回归覆盖；继续保留上游失败不能解锁下游的规则。 |
| S5 自动修复卡不透明 | 队长收到新 repair/review ID、负责人和依赖变更；拒绝对同一来源、同组 findings 重复创建开放 repair。 |
| 后续评论中的旧结果串入新任务 | 新 attempt 清空原结构化验收数据，避免旧成功证据让新执行通过门禁；投递恢复失败则完整回滚原进度。 |

明确边界：已经进入模型历史的文本无法撤回；不同措辞的报告不做语义去重；兼容旧调用时只能推导消息来源，新提示要求显式 source 字段。没有拿到报告者原业务工作区，因此验收针对可复现机制和真实执行流程，不声称还原了所有原始对话。

## 验收

候选包仍标记 0.1.20，但这是未发布开发构建；不是 npm 上的 0.1.20。SHA-256：`8ad18fd760776072ac5e8ba22baf928a5383ef643237e36f2be39ca754e43d5f`。精确 Harness 为 `0.1.5-rc.1`，解析依赖包含 231 个同版本 DSH 包。

真实 API 验收使用 `deepseek-official/deepseek-flash`，CLI/Agent cwd 明确为 `/tmp`，任务在 `/tmp/issue159-fix-20260925/` 下真实读写文件、执行命令。工具执行不由脚本预编排，外部检查报告文件、实际哈希、任务状态和成员工具来源。

| 检查 | 结果 |
| --- | --- |
| `pnpm build`、完整 `pnpm verify` | 通过，包含新增 9 个专项测试及工具级回归。 |
| 精确真实 Harness 10 场景 | 全通过；此层使用受控模型 fixture，与下列真实 API 测试区分。 |
| 真实 Flash：三成员审查、24 条提醒、完成后独立哈希补录 | 通过，60 请求，105.071 秒，0 工具错误，仅原三项任务。 |
| 真实 Flash：新进程恢复、原成员后续复核 | 通过，17 请求，47.766 秒，原团队/成员保留，恰好新增一项任务，原三份补录仍有效。 |
| 真实 Flash：审查失败→自动修复→复审 | 通过，51 请求，76.626 秒。一次模型漏填 acceptanceResults.status，被拒绝后自行补齐；没有把错误当成功。 |

保留 [全部验收记录与文件哈希](fix-verification/manifest.json)，包括真实请求 trace、运行 manifest、构建/验证日志和失败先行测试。初次真实测试的失败也保留在 `initial-failed-trial.json`：等价 shasum 命令被过严 oracle 误判、task_id 被误当接收任务。随后 oracle 仍核对实际文件哈希，消息参数改为明确的 source_task_id/source_attempt_id，再对最终候选包重新验收，未修改旧结果。

复跑真实 API 的入口（runtime 为已有精确安装，baseline 为 npm 发布包，candidate 为本地打包文件）：

```sh
node scripts/harness-model-benchmark.mjs --case issue159 \
  --runtime-dir "$RUNTIME" --baseline-artifact "$BASELINE" \
  --candidate-artifact "$CANDIDATE" --report-dir "$REPORT" \
  --agent-cwd /tmp --only candidate --timeout-ms 420000 --max-requests 120
# 同一 REPORT 中将 --only 改成 candidate-cold，启动新进程恢复已有团队。
node scripts/harness-issue-verify.mjs --scenario repair-conflict \
  --runtime-dir "$RUNTIME" --artifact "$CANDIDATE" \
  --report-dir "$REPAIR_REPORT" --agent-cwd /tmp
```

## 后续关闭说明草稿

原消息积压根因已在 0.1.18 修复；本次进一步解决终态证据补录、过期任务报告、相同报告重复唤醒、旧验收证据跨 attempt 复用，以及自动修复任务不透明的问题。回归与 `/tmp` 下真实 DeepSeek Flash 的压力、冷恢复、自动修复流程均通过。发布包含本次修复的版本后，可据此说明修复范围并关闭 #159。

本次只提交并合入本地 main；不推送、不发版，也不提前关闭远端 issue。
