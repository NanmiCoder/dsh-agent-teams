# Software Engineering AgentTeams 项目立项书

文档角色：本文件是本项目的产品定位、设计边界和长期开发基线。任何参与本项目的 AI Agent 在修改代码前都必须阅读本文件。

## 1. 项目定位

本项目基于 DeepSeek Harness 的 dsh-agent-teams 二次开发，目标是构建一个通用、可长期运行的软件工程 Agent Teams 插件。

项目同时支持：

- Greenfield：从零开始的新项目。
- Brownfield：已有代码库上的持续开发、维护和演进。

用户用自然语言描述目标。Captain 作为项目负责人，负责项目发现、需求澄清、方案设计、任务规划、多 Agent 实施、验证、Review、验收和进度记录。

本项目不绑定 RuoYi、Java、Vue 或任何具体技术栈。RuoYi 只是后续验证场景之一。

## 2. 核心用户体验

用户提出目标后，系统按以下流程工作：

1. 分析当前项目上下文。
2. 判断是空项目还是已有项目。
3. 识别会影响实现的关键歧义。
4. 只向用户提出必要的选择题或澄清问题。
5. 形成需求规格、范围、非目标和验收标准。
6. 形成技术设计、风险和任务建议。
7. 等待用户确认需求和设计。
8. 将确认结果转换为里程碑、任务和依赖图。
9. 使用 AgentTeams 组织多个专业 Agent 开发。
10. 自动执行验证、Review、修复和复审。
11. 等待用户验收并记录交付结果。
12. 持久化项目状态，进入下一轮迭代。

用户不需要手写完整需求文档，也不需要手工管理每个 Agent；用户只在业务选择、架构取舍、高风险变更和最终验收等关键节点介入。

## 3. 产品目标

系统必须让用户能够：

1. 在空项目或已有代码库中发起自然语言目标。
2. 得到项目上下文分析，而不是让 Agent 盲目编码。
3. 通过少量关键选择完成需求对齐。
4. 审阅需求、设计、任务和验收标准。
5. 确认后自动启动有依赖关系的 Agent Team。
6. 随时查看已完成、进行中、已实现未验收、阻塞、待决策和未开始事项。
7. 在测试或 Review 失败时进入修复和复审，而不是错误地宣布完成。
8. 重启 DeepSeek Harness 后继续项目，不丢失长期项目事实。

## 4. 非目标

- 不重写现有 AgentTeams 的成员调度、任务 DAG、attempt、恢复和质量门核心。
- 不复制 Software Company 的大量虚拟部门、展示型角色和复杂动画。
- 不把 RuoYi、Java、Vue 或其他框架写死在核心逻辑中。
- 第一阶段不实现独立的在线项目管理 SaaS、多人后台或远程执行集群。
- 不自动执行生产部署、破坏性数据操作或不可逆基础设施变更。
- 不把 Prompt 中的约束伪装成硬安全边界；关键规则必须由工具或状态机执行。

## 5. 设计原则

### 5.1 Captain 是唯一项目负责人

Captain 负责项目目标、需求、设计、计划、状态汇总和用户沟通。成员 Agent 负责专业任务，不各自维护一套项目真相。

### 5.2 先对齐，再实施

需求或设计没有通过确认门时，不得创建实现任务，也不得让开发 Agent 修改代码。

### 5.3 机器规则优先

状态转换、依赖解锁、质量门、完成条件和高风险操作必须由工具或状态模型约束，不能只写在角色 Prompt 中。

### 5.4 文档与代码同仓

长期项目事实保存在项目工作区中，能够被 Git 审查、Harness 重启恢复和后续 Agent 阅读。

### 5.5 增量兼容上游

优先复用现有 dsh-agent-teams 扩展点，新增能力放在独立模块中，避免无必要修改调度核心，保持 fork 可同步上游。

### 5.6 关键点打扰用户

普通编码、测试和 Review 自动推进；只有影响业务、架构、安全、数据、范围或交付的决策才暂停询问用户。

### 5.7 Greenfield 与 Brownfield 对等

空项目建立架构基线，已有项目识别现状和约束；两者在项目发现后进入同一套需求、设计、执行和验收生命周期。

## 6. 生命周期

项目生命周期：

new -> discovery -> active -> paused -> completed

active 也可能进入 blocked 或 cancelled。

需求或交付单元生命周期：

intake -> clarifying -> specified -> designed -> awaiting_approval -> planned -> implementing -> verifying -> reviewing -> awaiting_acceptance -> accepted -> delivered

任务状态继续复用 AgentTeams 现有状态机。必须明确以下区别：

- 代码写完不等于实现任务完成。
- 测试通过不等于用户验收完成。
- Review 通过不等于已发布。

## 7. 用户决策门

### 7.1 需求确认门

确认目标、范围、非目标、关键业务规则、验收标准和未决风险。

### 7.2 设计确认门

确认架构、模块边界、数据模型、接口、关键取舍、迁移策略、测试策略和任务范围。

### 7.3 交付确认门

确认实现、验证、Review、已知问题、未验收项以及是否交付或发布。

## 8. 必须请求用户决策的情况

- 业务规则存在两种以上合理解释。
- 会改变公共架构、数据模型、权限或安全边界。
- 需求范围扩大，或与已确认决策冲突。
- 需要删除数据、迁移生产数据、发布或修改生产配置。
- 测试或 Review 达到最大修复轮次。
- 任务阻塞，Captain 无法从现有约束中安全推导方案。

## 9. 目标架构

DeepSeek Harness

└── Software Engineering AgentTeams
    ├── Project Manager Layer
    │   ├── Project discovery
    │   ├── Requirement clarification
    │   ├── Specification and design
    │   ├── Decision and approval gates
    │   ├── Milestone and roadmap status
    │   └── Progress and acceptance reporting
    └── AgentTeams Execution Layer
        ├── Captain and member routing
        ├── Dependency-aware task scheduler
        ├── Durable mailbox and attempts
        ├── Quality gates and repair / re-review
        ├── Halt / resume / archive
        └── Activity panel and team snapshots

### 9.1 现有能力与新增能力边界

| 能力 | 现有 AgentTeams | 本项目处理方式 |
|---|---|---|
| 成员创建、唤醒和路由 | 已有 | 复用 |
| 任务依赖 DAG | 已有 | 由项目计划生成任务 |
| attempt、恢复和归档 | 已有 | 复用 |
| 质量门和修复复审 | 已有 | 增加项目级交付映射 |
| staged plan 审批 | 已有 | 与需求和设计确认衔接 |
| 项目发现 | 通用能力不足 | 新增 |
| 需求澄清 | 仅有通用 Prompt | 新增结构化协议 |
| 设计和决策记录 | 无长期项目层 | 新增 |
| 里程碑和路线图 | 无项目级层 | 新增 |
| 项目进度汇总 | 目前是团队级 | 增加项目和需求级投影 |
| 用户验收 | 质量门部分覆盖 | 新增独立状态和记录 |

## 10. 持久化边界

现有 .agent-teams/ 保存一次 Agent Team 的运行状态；新增项目管理层保存长期项目事实。两者不能混为一谈。

建议项目目录：

    .agent-project/
    ├── project.yaml
    ├── context.md
    ├── architecture.md
    ├── conventions.md
    ├── decisions.md
    ├── roadmap.md
    ├── status.json
    ├── requirements/
    ├── designs/
    ├── acceptance/
    └── reports/

实体关系：Project -> Milestone -> Work Item / Requirement -> Design -> Agent Team Run -> Task -> Attempt。

项目级状态至少必须区分：

- completed
- in_progress
- implemented_not_accepted
- blocked
- not_started
- waiting_for_user
- failed_verification
- failed_review

## 11. Agent 职责

### Captain / Project Lead

维护目标、范围、决策和状态；分析项目上下文；提出关键问题；产出需求、设计、任务和验收标准；在确认门前阻止实施；生成最小可行 DAG；监控风险、阻塞和质量门；向用户汇报真实状态。

### Product Analyst

把自然语言目标转换为用户场景、范围、非目标和验收标准；发现歧义、冲突和缺失约束；不写实现代码，不自行宣布需求收敛。

### Architect

分析已有架构或设计新架构；明确模块边界、数据流、接口和关键取舍；标识迁移、兼容、安全和性能风险；不替代用户做高影响业务决策。

### Developer / Specialist

只处理任务合同规定的范围；遵循项目上下文和已确认决策；运行验证命令；不批准自己的实现。

### QA / Reviewer

独立验证功能、边界、回归和验收条件；只报告可行动问题；测试或 Review 失败时进入修复和复审，不解锁下游交付。

## 12. 第一阶段范围

### P0：项目接管与基线

- 支持命令或自然语言触发项目初始化。
- 区分空项目和已有代码库。
- 生成项目管理文件。
- 记录技术栈、目录结构、构建和测试入口、现有约束。
- 用户可以修订或确认项目基线。

### P0：需求与设计门

- 结构化需求输入和澄清问题。
- 记录待决问题和用户选择。
- 生成需求规格、非目标、验收标准和风险。
- 生成技术设计和任务建议。
- 未通过需求和设计确认不得创建 implementation 任务。
- 用户返回修改时更新同一份草案，不静默创建重复项目。

### P0：项目级计划和状态

- 创建里程碑和 work item。
- 将确认设计转换为 AgentTeams DAG。
- 聚合团队状态到项目级状态文件。
- 支持查询完成、进行中、未验收、阻塞、待决策和未开始事项。
- 保存需求、设计、验收和进度报告。

### P1：工程护栏

变更影响分析、关键目录风险标记、数据库 / 权限 / 安全 / 生产配置升级、完成时变更范围检查、项目级报告和历史复盘。

### P2：体验增强

项目总览面板、里程碑时间线、需求和设计差异视图、可配置团队模板、多项目切换和归档。

## 13. 明确不做的事情

- 不为每个技术栈创建独立插件。
- 不在第一阶段重做 AgentTeams 活动面板。
- 不把项目管理状态藏在聊天记录里。
- 不用单一百分比替代未验收或阻塞状态。
- 不允许多个 Agent 随意修改同一项目状态而没有统一入口。
- 未经用户明确要求，不提交、推送、创建 PR 或执行真实部署。

## 14. 立项决议

- 项目类型：通用软件工程 Agent Teams 插件。
- 基础仓库：https://github.com/DengDengBei/dsh-agent-teams-ddb
- 上游仓库：https://github.com/NanmiCoder/dsh-agent-teams
- 许可证：MIT。
- 当前阶段：Phase 0，立项与边界已确认。
- 下一阶段：Phase 1，项目上下文与状态模型。
- 当前不做：RuoYi 专用逻辑、Software Company 式部门模拟、独立复杂 UI、生产部署自动化。

