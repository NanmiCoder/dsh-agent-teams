# Software Engineering AgentTeams 路线图

文档角色：本文件是可执行的阶段路线图。Agent 应按阶段推进，不跨阶段扩大范围。

## 当前状态

    project: software-engineering-agent-teams
    phase: phase-5-ui-release
    status: in_progress
    next_phase: phase-5-release-readiness
    repository: https://github.com/DengDengBei/projectflow-agent-teams
    upstream: https://github.com/NanmiCoder/dsh-agent-teams

## 里程碑

| ID | 名称 | 目标 | 状态 |
|---|---|---|---|
| M0 | 立项与边界 | 定位、非目标、架构边界、验收场景 | 已完成 |
| M1 | 项目上下文 | Greenfield / Brownfield 初始化和持久化状态 | 已完成 |
| M2 | 需求与设计门 | 澄清、规格、设计、用户确认和变更 | 已完成 |
| M3 | 执行集成 | 确认设计接入 AgentTeams DAG 和质量门 | 已完成 |
| M4 | 验证与验收 | 项目级验证、Review、验收、报告和恢复 | 已完成 |
| M5 | UI 与发布 | 项目总览、文档、兼容矩阵和发布 | 进行中 |

## M1 任务草案

| ID | 任务 | 依赖 | 完成条件 |
|---|---|---|---|
| M1-T1 | 定义项目上下文和状态类型 | 无 | 类型、枚举和迁移规则有测试 |
| M1-T2 | 实现项目状态持久化读写 | M1-T1 | 原子写入、损坏文件错误和初始化有测试 |
| M1-T3 | 实现项目发现协议 | M1-T1 | 区分空项目和已有项目，并保存发现结果 |
| M1-T4 | 注册项目初始化和状态工具 | M1-T2, M1-T3 | Captain 可调用且不破坏旧 AgentTeams |
| M1-T5 | 实现状态查询和项目报告 | M1-T2 | 能回答完成、进行中、未验收、阻塞和待决策 |
| M1-T6 | 端到端验证和文档 | M1-T4, M1-T5 | build、typecheck、verify 和最小 Harness 流程通过 |

## M1 已完成部分

- 已定义通用项目状态、生命周期、阶段、决策、里程碑和 work item 类型。
- 已实现 Greenfield / Brownfield 工作区发现。
- 已实现 .agent-project/status.json 的校验、原子写入、读取和进程内串行更新。
- 已实现项目状态摘要，能够区分实现完成、未验收、阻塞和待用户决策。
- 已将基础测试接入现有离线验证流程。

## M1 当前未完成部分

- 尚未把项目状态工具注册到 AgentTeams 的 Captain 工具集。
- 尚未把项目发现、需求澄清和状态协议注入 Captain 的系统提示。
- 尚未把 work item 与 AgentTeams team run 建立正式关联。
- 尚未实现项目状态的用户可见查询命令或项目总览 UI。

M1 的项目状态工具、项目发现和基础 Captain 协议已经接入；上述剩余项不阻塞进入 M2。

## M2 当前状态

\`in_progress\`。本阶段已开始落地需求草案、澄清问题、设计草案和需求/设计确认门。

当前工具：\`agent_project_clarification\`、\`agent_project_requirement_update\`、\`agent_project_design_update\`、\`agent_project_gate\`。
实现任务规划必须通过 \`agent_project_gate(action="assert_implementation_allowed")\`。

## M1 交付门

1. 旧版 AgentTeams 团队状态仍能读取。
2. 项目状态文件损坏时给出明确错误，不静默覆盖。
3. 空项目和已有项目的初始化路径都能验证。
4. 状态至少能区分 implemented_not_accepted 和 completed。
5. 项目状态查询不依赖 UI，命令行或 Agent 工具也能读取。
6. pnpm typecheck、pnpm build 和现有 pnpm verify 通过。

## M2 交付门

1. 需求澄清问题可以持久化。
2. 用户选择后不重复询问同一已解决问题。
3. 设计确认前不能创建实现任务。
4. 设计修改会影响同一 work item，而不是隐式创建重复团队。
5. 需求、设计、范围、验收标准和风险可被成员 Agent 读取。

## M3 交付门

## M3 当前状态

`in_progress`。本阶段已开始把确认后的设计映射到项目 Work Item 和 AgentTeams 执行记录。

当前工具：`agent_project_work_item_update`、`agent_project_work_item_sync`。
Work Item 可以记录 `requirement_id`、`design_id`、`team_id` 和 `task_ids`，并区分计划中、执行中、已实现未验收、阻塞和失败验证/Review。
`agent_project_work_item_sync` 会读取关联 team 的任务 DAG，把执行结果投影回项目状态；不会把代码完成误报为用户已验收。

1. 确认后的设计可生成最小任务 DAG。
2. 只有真实依赖才阻塞任务；独立任务可以并行。
3. 任务合同包含目标、范围、验收和验证命令。
4. 任务失败或 Review 失败不会解锁下游交付。
5. team run 与 work item 可追踪关联。

## M4 交付门

1. 能区分实现、验证、Review、用户验收和交付。
2. 测试或 Review 失败会产生修复和复审流程。
3. 达到最大修复轮次后向用户升级。
4. 重启 Harness 后状态可恢复。
5. 项目报告包含完成、进行中、未验收、阻塞、待决策和风险。

## M4 当前状态

第四阶段已建立项目级验收边界和管理报告基础：

1. implemented_not_accepted 只能通过用户明确确认进入 accepted。
2. 只有 accepted 才能进入 delivered；执行任务完成不会自动越过人工验收。
3. agent_project_report 聚合 Work Item 状态、待决策、风险和关联 AgentTeams 实时投影。
4. 已完成工具级闭环验证、Review/修复轮次投影、重启恢复和验收证据清理验证。
5. 专用回归脚本为 scripts/project-phase4-verify.mjs；报告分桶覆盖未验收、已交付、Review 失败、待决策、澄清问题、风险和执行关联。

## M5 当前状态

已完成第一批项目总览能力：只读项目状态路由、项目进度面板、需求/设计门状态、Work Item 状态聚合、待决策/澄清/风险提示。面板只读，状态变更仍必须通过项目工具完成。

## M5 交付门

第一批项目总览交付门：

1. [x] 只读项目状态路由读取 .agent-project/status.json，并附带关联 .agent-teams 的执行投影。
2. [x] Web 面板展示项目阶段、需求/设计门、Work Item 状态统计、待验收、阻塞、Review/验证失败、待决策、澄清和风险。
3. [x] 面板不直接修改任何项目或团队状态；状态变更仍通过项目工具完成。
4. [x] 中英文文档说明长期项目状态层、验收边界和运行目录分工。
5. [x] 类型检查、第四阶段源码回归、Web 路由回归、发布元数据检查和隔离客户端打包通过。
6. [x] 项目总览数据组装有离线回归，且已接入 pnpm verify。

后续发布就绪工作：补充更细的时间线/多项目交互、真实 Harness Web 冷启动验收，以及在锁定的 lib 释放后执行标准 pnpm build && pnpm verify。

## 变更规则

- 新需求先进入项目层，不直接改现有终态任务。
- 影响已确认设计时，必须产生影响分析并更新相关任务。
- 终态任务不复活；修复和新一轮 Review 使用新任务。
- 影响上游兼容性的改动必须单独记录。
- M1 未完成前不做项目总览 UI，不做复杂角色系统。
- 未经用户明确要求，不提交、不推送、不创建 PR。

## 发布状态校准（2026-09-04）

“已实现”表示代码或离线验证已落地，不等于全流程产品已经获得正式上线证据。当前任务级调度、质量门、Review/修复循环和持久化恢复已有较强离线验证；项目级需求/设计门、审批/交付和 Captain 协议已有机器规则与回归脚本，并纳入主 `verify` 链。真实 Harness/真实模型自然语言 E2E、Brownfield 深度接管、升级迁移/回滚、多进程共享工作区和通用平台矩阵仍未完成发布级证明。当前发布候选限定为 Harness `0.1.2-alpha.2` 的内部 Alpha / 受控评估，正式生产上线保持未批准。
