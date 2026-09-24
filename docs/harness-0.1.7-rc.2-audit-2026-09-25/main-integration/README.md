# 与本地 main 的整合审查

共同基线 `87c95c9`。适配工作基于 `1487f33`（#193），提交为 `be01513`；本地 main 为 `9f11fa4`。相对共同基线，main 新增一笔 #159 业务修复提交，包含较多历史验收资料；当前分支还保留 main 尚未包含的 #193 完成成员折叠与排序。

## 影响判断

| main 新增行为 | 与 Harness 适配的交点 | 整合处理 |
| --- | --- | --- |
| 报告绑定来源 task/attempt/status，过滤撤销的报告 | 新宿主消息来源 kind、会话 ownEvents 与投递 admission | 保留 main 的过滤规则；继续通过 onAgentReady 和 agent-teams 来源接入宿主 |
| 相同报告不重复唤醒队长 | steer、持久邮箱和 next-step 投递 | 保留去重；真实宿主 stability 检查重复发送零额外唤醒 |
| 终态证据追加、归属作者和 attempt、幂等补录 | 消息/工具结果格式；#193 完成时间排序 | 保留追加式证据和原 updatedAt；不会把补录时间当作任务完成时间 |
| 新 attempt 清理旧结果；恢复投递失败回滚原结果 | 新 agent/created 启动 admission 和旧宿主恢复 | 保留 main 状态机；在七个宿主重跑生命周期/失败/稳定性 |
| 自动 repair/review 通知、拒绝同 findings 重复 repair | 队长实时通知、工具结果返回新 follow_up 字段 | 保留通知与去重，在新版 Harness 另跑真实 Flash 质量闭环 |
| #159 新静态和真实宿主测试 | 本次工具 role:tool / legacy tool-result 兼容夹具 | 保留新增检查和两代结果归一化；两边测试入口全部保留 |

Git 自动合并没有文本冲突。源码复核确认 main 的 mailbox、quality-gates、scheduler、state、types 与其原提交一致；members/tools 相对 main 只增加本次宿主消息来源适配。没有用一方文件覆盖另一方业务。18 个客户端 JS/资源文件与此前已做浏览器验收的候选逐字节一致；本次未重复浏览器操作，不把旧浏览器记录说成新跑的。

## 整合后重新验证

- frozen lockfile 安装、build、完整 verify 通过；含 #159、#193 和新版 Harness 回归。
- 同一新候选包：7 个精确宿主 × 10 场景全部通过，包含新增 terminal-evidence / report-retry 断言。见 [matrix.json](matrix.json) 与各 runtime 报告。
- 真实 deepseek-official/deepseek-flash，CLI/Agent cwd 为 `/tmp`，业务工作区在 `/tmp/agent-teams-main-integration/flash/candidate/workspace`：三成员审查、24 条提醒、完成后独立哈希补录，通过，46 请求 / 101.756 秒。
- 新进程恢复同一团队：原成员和补录证据保留，只新增一项复核，通过，18 请求；详见 [冷恢复结果](flash-candidate-cold.json)。

- 真实 Flash 质量闭环：审查失败 → 自动生成 repair/review → 原成员返工 → 独立复审，通过，59 请求 / 89.586 秒。见 [返工结果](flash-repair.json)。三项真实模型验收共 123 请求，均无模型 API 错误。

实际包摘要与源码父提交见 [manifest.json](manifest.json)。这些是整合后重新获得的证据；上级目录中的旧七版本/复杂业务报告仍保留为适配阶段历史，不能冒充当前合并产物的测试。

本次范围为插件仓库本地 main 整合，不修改官方 Harness 源码、不推送、不发版。主工作区已有未跟踪的分析文档予以保留。
