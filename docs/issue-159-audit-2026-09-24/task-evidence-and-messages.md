# #159 后续修复：任务证据与消息约定（未发布）

本文描述本地开发分支的新行为；npm 0.1.20 仍是调查报告中的旧行为。

## 完成后补录，不重新执行

任务原负责人可以用原 task_id、attempt_id 调用 `agent_teams_update_task`，追加 `commandsRun`、`acceptanceResults` 或 `evidence_note`。队长也可以给终态任务追加自己的观察，不需要先接管任务。

```json
{
  "task_id": "t9",
  "attempt_id": "当前有效的执行凭据",
  "status": "completed",
  "commandsRun": [{"command": "node verify.mjs", "status": "passed", "exitCode": 0, "evidence": "完成后的独立复核结果"}],
  "evidence_note": "这是补充证据，原始结论不变。"
}
```

证据保存在 `supplementalEvidence`，包含作者、时间和原执行轮次；`agent_teams_status` 可读取。相同作者、相同 attempt 的相同证据重复提交只保存一次；并非把整个数组替换掉。

原 output、status、verdict、findings、changedPaths 不可覆盖；原验收数据和完成时间也不变。改变这些字段会明确报错，不能假成功。补录失败观察不会把原门禁自动改成通过或失败；需要新的工作时，由队长明确创建后续任务。重试失败/取消任务时，新 attempt 的验收数据从空开始，历史补录仍保留原作者与轮次。恢复投递失败时回滚原 capability 和原进度，避免吞掉部分证据。

## 给消息标注来源

成员任务消息可以带 `source_task_id`、`source_attempt_id`；它们指发送者任务，不是接收者任务。队长普通指导只填 `to` 和 `content`。

```json
{
  "to": "captain",
  "source_task_id": "t9",
  "source_attempt_id": "当前有效的执行凭据",
  "content": "t9 已完成；正式结果及补充证据已保存。"
}
```

两个 source 字段必须一起提供，且必须匹配发送者当前拥有的有效 attempt。未提供时，为兼容已有调用，插件会从发送者当前/最近执行任务推导；新成员提示会要求显式提供。不要把旧结果换成新 attempt_id 后重发。

收件方在实际模型步骤和 status 邮箱回退两条路径都检查来源与接收任务代际。来源被撤销，或旧的进行中消息已被来源终态取代时，会标记丢弃；新终态报告仍可以送达。已经进入模型历史的文字无法撤回，因此结果必须以当前任务状态为准。

相同发送者、正文、来源代际和接收代际的重复发送复用同一消息 ID，不再次唤醒。无任务上下文的普通聊天只对仍未读的相同消息去重，已读后可以再次发送。不同内容不会做语义合并，也不会把一个新任务自动猜成另一个任务的替代品。

## 自动修复通知

失败审查生成 repair/review 后，队长会收到持久化通知，包含新任务 ID、负责人、依赖和被改写的下游依赖；审查工具返回值也包含该摘要。不要再手工建同一张修复卡。相同 sourceTaskId 和同一组 sourceFindingIds 已有开放 repair 时，create_task 会指出已有任务 ID 并拒绝重复建卡。

轮次上限、失败任务不能解锁下游、同成员重派撤销旧执行资格等原有约束继续生效。
