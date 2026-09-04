# AgentTeams 开发规则

文档角色：本文件面向参与本项目的所有 AI Agent，是执行规则，不是产品宣传文档。

## 开始工作前

- 用 `agent_project_clarification` 持久化关键歧义和用户选择。
- 需求统一维护在一个 requirements draft 中，修改时递增版本，不创建重复项目。
- 技术设计统一维护在一个 design draft 中，设计批准前不得启动 implementation planning。
- 只有 `agent_project_gate(action="assert_implementation_allowed")` 成功后，Captain 才能组织实现任务。
- 需求批准必须先于设计批准；需求重新打开时，设计门不再可用。

1. 阅读 docs/AI_PROJECT_CHARTER.md。
2. 阅读 docs/AI_PROJECT_ROADMAP.md。
3. 检查当前分支、工作区状态和 origin / upstream。
4. 阅读与当前任务直接相关的源码、测试和文档。
5. 确认任务属于哪个里程碑，不自行扩大范围。

## 需求和设计规则

- 用 `agent_project_clarification` 持久化关键歧义和用户选择。
- 需求统一维护在一个 requirements draft 中，修改时递增版本，不创建重复项目。
- 技术设计统一维护在一个 design draft 中，设计批准前不得启动 implementation planning。
- 只有 `agent_project_gate(action="assert_implementation_allowed")` 成功后，Captain 才能组织实现任务。
- 需求批准必须先于设计批准；需求重新打开时，设计门不再可用。

- 不要因为用户给了一句需求就直接写代码。
- 先识别项目是 Greenfield 还是 Brownfield。
- 只询问会改变实现的关键问题。
- 需求、设计、任务和验收标准必须可以互相追踪。
- 需求或设计未确认时，不得启动 implementation 任务。
- 用户修改设计时，更新原 work item，不静默创建重复任务或团队。

## Agent 角色规则

- Captain 是项目唯一总负责人。
- Product Analyst 负责澄清，不写实现代码。
- Architect 负责方案和风险，不替用户决定高影响业务规则。
- Developer 只修改任务合同规定的范围。
- QA 和 Reviewer 必须独立于被审查的实现。
- 任何 Agent 都不能把自己的实现直接宣布为最终交付。

## 任务规则

- 任务必须有明确目标、范围、验收标准和验证命令。
- 只为真实前置关系建立依赖。
- 不要通过消息绕过任务状态机。
- 不要复活 failed 或 cancelled 终态任务；创建新的修复或复审任务。
- 测试或 Review 失败不能解锁下游交付。
- 任务完成必须记录实际变更、运行过的命令和验证结果。

## 项目状态规则

至少区分以下状态：

- not_started
- in_progress
- implemented_not_accepted
- completed
- blocked
- waiting_for_user
- failed_verification
- failed_review

不要用一个百分比替代这些状态。尤其不能把代码已写完直接记录为需求已完成。

## 安全和授权规则

以下操作必须先取得用户明确确认：

- 生产部署或发布。
- 删除数据或不可逆迁移。
- 修改生产配置、凭据或权限边界。
- 推送远程仓库、创建 PR 或合并分支。
- 大范围重构或改变公共架构。

## 上游兼容规则

- 优先新增独立模块，不要无理由修改现有调度核心。
- 保持旧版 .agent-teams/ 状态可读取。
- 不把项目管理状态写入单次团队状态，除非明确建立关联字段。
- 不修改官方 DeepSeek Harness checkout。
- 每次变更都说明是否影响上游同步。

## 验证规则

修改后按影响范围执行：

1. 针对性测试。
2. pnpm typecheck。
3. pnpm build。
4. pnpm verify。
5. 最小 Harness 流程验证。

验证失败时先修复，不要把失败结果写成完成。
