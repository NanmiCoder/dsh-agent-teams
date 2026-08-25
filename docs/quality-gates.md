# AgentTeams 质量门禁与多轮审查实现文档

> 状态：已实现（本文件是唯一执行规格）
> 读者：新开窗口的实现 Agent。只按本文实现，不要再发明需求，不要先写代码再补测试。
> 仓库：当前工作区根目录。不要从本机绝对路径推断工作区。
> 基线：`feat/captain-planning-team-stop` 上的 Captain 动态规划、DAG 调度、`attempt_id`、失败阻断、停止整队。
> 本文把“多轮需求/代码审查直到通过”从 prompt 协议升级为机器可判定状态。

## 0. 一句话目标

把 AgentTeams 从“可靠的多 Agent 任务调度底座”升级为“带结构化任务合同、审查结论、自动修复链、强制 TDD 和范围门禁的交付系统”。

“直到共识”在本仓库的官方定义不是“几个 Agent 都说没问题”，而是：

```text
所有必需门禁都通过
+ 所有 acceptance 通过
+ 没有 blocker / high finding
+ 最新实现版本已被独立 Reviewer 审查
+ 声明的验证命令通过
+ 修改范围合法
```

## 1. 当前基线：已经有什么，还缺什么

### 1.1 已经有、必须复用

| 能力 | 位置 | 必须保持 |
|---|---|---|
| 任务状态机 `pending → claimed → in_progress → completed\|failed\|cancelled` | `src/types.ts`、`src/state.ts` | 终态只读；`claimed` 不能直接 `completed` |
| 依赖只认上游 `completed` | `unsatisfiedDependencies()` | `failed` / `cancelled` 永远不解锁下游 |
| `attempt` + `attemptId` | `beginTaskAttempt()` / `update_task` | 迟到写入必须继续被拒绝 |
| Captain 动态规划 | `taskPlanning: captain` | 不要改回固定 seed DAG 才能审查 |
| 并行 ready tasks | `src/scheduler.ts` | 无真实依赖仍可并行 |
| 停止整队 | `haltTeamWork()`、`POST /plugins/dsh-agent-teams/halt` | 停止仍不删除团队 |
| 现有验证入口 | `pnpm typecheck`、`pnpm build`、`pnpm verify` | 新检查必须挂进 `pnpm verify` |

### 1.2 当前缺口（必须修）

1. `TeamTask` 只有 `subject` + 可选 `description`，没有合同、范围、验收、验证。
2. 审查只是 `role` 字符串；调度器不知道这是 review。
3. `completed` 无条件放行。Reviewer 可以写“仍有重大分歧”却标 `completed`。
4. 审查失败后不会自动生成 `repair-N` / `review-N+1`。
5. 没有 `round`、`maxReviewRounds`、finding 生命周期。
6. 没有 `changed_paths`，无法审计越界修改。
7. `create_task` 会静默解除 `halted`，存在误恢复风险。
8. 现有测试覆盖调度，不覆盖质量门禁。本需求必须先写失败测试。

## 2. 可以做 / 不可以做

### 2.1 可以做

- 给任务增加结构化合同、`kind`、`round`、`verdict`、`findings`、`changedPaths`、`verify`。
- 让 `create_task` / `update_task` 按合同和 verdict 拒绝非法完成。
- 审查失败后自动创建 repair 任务和下一轮独立 review 任务。
- 给 profile 增加审查策略配置：最少轮数、最大轮数、必需 reviewer。
- 完成时记录 `changed_paths`、`acceptance_results`、`commands_run`。
- 用 git/工作区 diff 做完成时范围审计。
- 把 `create_task` 自动 unhalt 改成显式 `resume`。
- 增加 Captain coverage matrix / 阶段汇总。
- 增加强制 TDD 脚本，并让 `pnpm verify` 运行它。
- 更新 `docs/usage.md`、`README.md`、`README_ZH.md` 中与本功能直接相关的说明。
- 复用现有 DAG、attempt、mailbox、halt、scheduler。

### 2.2 不可以做

- 不要新建另一套 workflow 引擎。
- 不要做 Issue #72 的 Staging / Approve & Run / 规划期 GUI 审批。
- 不要把“几个 Agent 互相说 OK”做成终止条件。
- 不要让实现者批准自己的实现或修复。
- 不要让 review / test 任务默认拥有写代码权限语义。第一版至少要在合同和完成审计上禁止；不要假装已经拦截了全部 bash/fs。
- 不要让 repair 任务依赖 `failed` 的 review 任务。
- 不要用 `reassign_task` 重跑旧 review 来代替新建 `review-N+1`。`beginTaskAttempt()` 会清掉旧 output。
- 不要把 `send_message` 当成正式下一轮审查。邮件没有门禁。
- 不要复活 `failed` / `cancelled` 任务。终态只读；下一轮必须新建任务。
- 不要修改 `~/.dsh/profiles/web/cordis.patch.yml`，除非用户本窗口明确要求。
- 不要提交或推送 `docs/multi-role-profiles.md`、`docs/personal-kb-delivery/`。
- 不要 commit / push / 开 PR，除非用户明确要求。
- 不要启动替换 Web GUI 的新服务器。
- 不要做真实部署，也不要自动执行生产发布。
- 不要把 Prompt 里的“禁止改其他文件”宣传成硬安全边界。第一版只保证完成时审计和拒绝 `completed`。
- 不要在没有 host 统一写入拦截接口时，伪造“成员写工具越界立刻失败”。
- 不要一次做独立 git worktree 隔离。那是后续 PR，不在本需求范围。
- 不要为了本功能改官方 DSH checkout。
- 不要扩大到重构无关 UI、面板动画、图片资源。

## 3. 边界和职责

### 3.1 系统职责

系统必须机器强制：

- 没有合同的实现/修复任务不能创建。
- 没有验收证据的任务不能 `completed`。
- review / requirements 没有 `verdict=pass` 不能 `completed`。
- `needs_revision` / `reject` 不能解锁下游。
- 越界 `changed_paths` 不能 `completed`。
- 验证命令失败只能 `failed`。
- 审查失败自动开 repair + 下一轮 review，直到通过或达到上限。
- 达到 `maxReviewRounds` 后停止自动循环，升级给 Captain / 用户。
- halted 团队默认不能被普通 `create_task` 恢复。

系统不保证：

- 成员在执行中完全无法用 bash 改范围外文件。
- 模型一定写出高质量代码。
- 用户已经在 GUI 里预审过 DAG。

### 3.2 Captain 职责

- 根据用户目标画最小任务图。
- 先建需求/验收任务，再创建实现任务。
- 输出 coverage matrix：用户每个约束至少映射到一个任务。
- 不自己批准实现，除非用户明确要求 Captain 接管。
- 超轮次或出现契约不清时，向用户升级，而不是无限互审。
- 用户只要汇报、不要继续执行时，不得 `create_task`，必须用 status / 已有结果回答。

### 3.3 成员职责

| 角色 | 可以做 | 不可以做 |
|---|---|---|
| requirements-analyst | 产出目标、范围、验收、open questions | 写实现代码；自己宣布需求已收敛 |
| requirements-challenger | 找遗漏、歧义、冲突 | 直接改需求合同为最终版；写实现 |
| implementer | 只改 `inScope` 内文件；跑 `verify` | 改 `outOfScope`；批准自己的实现 |
| test-engineer | 补测试、跑验证、报告失败 | 用测试失败当通过；扩大产品范围 |
| correctness-reviewer | 只读审查逻辑正确性 | 直接改代码；审查自己刚写的实现 |
| security-reviewer | 只读审查权限/注入/泄露 | 直接改代码 |
| scope-reviewer | 对照合同和 `changed_paths` 查越界 | 放过未入账改动 |
| integrator | 最终验证、汇总证据 | 在审查未通过时宣布交付 |
| fixer / repair | 只修指定 findings | 顺手做 `outOfScope`；自己把 review 标 pass |

### 3.4 用户职责

- 提供目标和约束。
- 确认有歧义的 open questions。
- 明确要求停止或恢复团队。
- 真实部署必须由用户确认。

## 4. 产品流程

```text
用户目标
  ↓
requirements-round-1
  ↓
requirements-challenge
  ↓
requirements 收敛？
  ├─ open questions 未关 → 不能创建实现任务
  └─ verdict=pass
       ↓
coverage matrix 完整
       ↓
implementation
       ↓
verification
       ↓
correctness / security / scope 并行 review
       ↓
全部 pass？
  ├─ 否 → repair-round-N（不依赖 failed review）
  │         ↓
  │       verification
  │         ↓
  │       review-round-N+1（必须针对最新 attempt）
  │         ↓
  │       超过 maxReviewRounds？
  │         ├─ 是 → 升级 Captain / 用户，停止自动循环
  │         └─ 否 → 继续
  └─ 是
       ↓
integration / 最终验证
       ↓
范围审计 + coverage matrix
       ↓
交付
```

需求讨论轮数由 profile 配置，不写死“所有任务必须 3 轮”。小任务可以 1 轮通过；高风险任务可以要求最少 2 轮。

## 5. 数据模型

在现有 `TeamTask` / `TeamState` / `TeamProfileSnapshot` 上扩展。不要另起状态文件，除非现有 `team.json` 放不下 ledger；第一版 ledger 可以先作为任务 output + status 投影。

### 5.1 枚举

```ts
type TaskKind =
  | 'requirements'
  | 'implementation'
  | 'verification'
  | 'review'
  | 'repair'
  | 'integration'
  | 'work' // 兼容旧任务；没有质量门禁的普通工作

type ReviewVerdict =
  | 'pass'
  | 'needs_revision'
  | 'reject'

type FindingSeverity =
  | 'low'
  | 'medium'
  | 'high'
  | 'blocker'
```

### 5.2 任务新增字段

```ts
interface ReviewFinding {
  id: string                 // 稳定 id，例如 SEC-001
  severity: FindingSeverity
  file?: string
  line?: number
  problem: string
  requiredFix: string
  resolved?: boolean
}

interface AcceptanceResult {
  criterion: string
  status: 'passed' | 'failed'
  evidence?: string
}

interface CommandResult {
  command: string
  status: 'passed' | 'failed'
  exitCode?: number
  evidence?: string
}

interface TeamTask {
  // 现有字段保持不变
  kind?: TaskKind
  round?: number
  verdict?: ReviewVerdict
  findings?: ReviewFinding[]
  objective?: string
  inScope?: string[]
  outOfScope?: string[]
  acceptance?: string[]
  verify?: string[]
  deliverables?: string[]
  nonGoals?: string[]
  changedPaths?: string[]
  acceptanceResults?: AcceptanceResult[]
  commandsRun?: CommandResult[]
  reviewedTaskId?: string
  reviewedAttempt?: number
  sourceTaskId?: string        // repair 对应的实现/上一轮产物
  sourceFindingIds?: string[]
  coverageOf?: string[]        // 覆盖的用户约束/目标条目
}
```

旧任务没有这些字段时：

- `kind` 缺省视为 `'work'`。
- `'work'` 保持旧行为，避免破坏已有团队和测试。
- 新创建的 `requirements` / `implementation` / `verification` / `review` / `repair` / `integration` 必须走新门禁。

### 5.3 团队 / profile 新增字段

```ts
interface ReviewPolicy {
  requirementsMinRounds?: number // 默认 1
  requirementsMaxRounds?: number // 默认 4
  codeMaxRounds?: number         // 默认 3
  maxRepairAttempts?: number     // 默认 2
  requiredReviewers?: string[]   // 例如 ['correctness', 'security', 'scope']
}

interface TeamState {
  // 现有字段
  reviewPolicy?: ReviewPolicy
}

interface TeamProfileConfig {
  // 现有字段
  reviewPolicy?: ReviewPolicy
}
```

配置校验：

- 所有轮数必须是正整数。
- `min <= max`。
- `requiredReviewers` 只能是已知角色别名或成员名。
- 未知字段继续按现有 profile allowlist 拒绝。

### 5.4 持久化校验

`isTeamTask()` / `isTeamState()` 必须接受并校验新可选字段：

- 枚举值非法则拒绝整份 `team.json`。
- 空字符串 `objective` / 空 `inScope` 项非法。
- `round` 若存在必须是 `>= 1` 的安全整数。
- `findings[].id` 非空且同一任务内不重复。

旧文件缺字段必须仍能 cold-resume。

## 6. 机器规则

这些规则必须由工具/状态机执行，不能只写进 persona。

### 6.1 创建任务

`agent_teams_create_task` 增加可选参数：

```ts
{
  subject: string
  description?: string
  dependencies?: string[]
  assignee?: string
  kind?: TaskKind
  round?: number
  objective?: string
  inScope?: string[]
  outOfScope?: string[]
  acceptance?: string[]
  verify?: string[]
  deliverables?: string[]
  nonGoals?: string[]
  reviewedTaskId?: string
  sourceTaskId?: string
  sourceFindingIds?: string[]
  coverageOf?: string[]
  resume?: boolean
  resumeReason?: string
}
```

创建规则：

1. `kind` 缺省为 `'work'`，兼容旧调用。
2. `kind` 为 `implementation` / `repair` / `verification` / `review` / `requirements` / `integration` 时：
   - 必须有非空 `objective`。
   - 必须有非空 `acceptance`（至少 1 条）。
3. `implementation` / `repair` 还必须有非空 `inScope` 和非空 `verify`。
4. `review` 必须有 `reviewedTaskId`，且目标任务存在。
5. `repair` 必须有 `sourceTaskId` 和至少 1 个 `sourceFindingIds`。
6. `repair` / 下一轮 `review` 的 `dependencies` 不得包含 `failed` / `cancelled` 任务。
7. 同一团队内，两个同时 `pending|claimed|in_progress` 的 `implementation|repair` 任务，若 `inScope` 路径集合相交，拒绝创建或要求加依赖。第一版：相交则拒绝并行创建，错误信息必须指出冲突路径和另一个 task id。
8. 团队 `halted=true` 时：
   - 默认拒绝 `create_task`。
   - 只有 `resume=true` 且 `resumeReason` 非空时才清除 `halted/haltedAt` 并创建任务。
   - 不得因为普通创建而静默恢复。
9. 需求未收敛时，Captain 协议和工具层都要挡实现：
   - 若团队已有 `kind=requirements` 任务，且没有一条 `completed + verdict=pass`，拒绝创建 `implementation`。
   - 若完全没有 requirements 任务，允许创建；这是兼容无质量配置的旧用法。质量 profile 必须先建 requirements。

### 6.2 更新 / 完成任务

`agent_teams_update_task` 增加可选结构化参数，或允许 `output` 旁路解析一份 JSON。优先显式参数，不要只靠自由文本：

```ts
{
  verdict?: ReviewVerdict
  findings?: ReviewFinding[]
  changedPaths?: string[]
  acceptanceResults?: AcceptanceResult[]
  commandsRun?: CommandResult[]
}
```

完成规则：

1. 现有状态机不变：`claimed` 不能直接 `completed`。
2. `kind=requirements|review`：
   - `completed` 仅当 `verdict=pass`。
   - `verdict=needs_revision|reject` 必须 `failed`，且 `findings` 至少 1 条。
   - 缺少 `verdict` 时拒绝 `completed` 和“口头通过”。
   - `pass` 时不得残留未解决的 `blocker|high` finding。
3. `kind=implementation|repair|verification|integration`：
   - `completed` 必须带齐 `acceptanceResults`，且每条 acceptance 都有对应 `passed`。
   - 必须带 `commandsRun`，覆盖任务 `verify` 中的每一条，且全部 `passed`。
   - `implementation|repair` 必须带 `changedPaths`。
   - 任一 `changedPaths` 落在 `outOfScope`，或不能证明属于 `inScope`，只能 `failed`。
   - 验证失败只能 `failed`。
4. `output` 仍然保存，供人和下游阅读；但结构化字段才是门禁真相。
5. 成员仍必须提交当前 `attempt_id`。
6. 实现者不能把自己的实现任务标成 review pass。review 任务必须由 review 角色 / 被指派的 reviewer 完成。

路径匹配规则（第一版，必须写成纯函数并单测）：

```text
inScope / outOfScope 使用工作区相对 POSIX 路径。
支持精确文件和目录前缀：
  src/foo.ts     只匹配该文件
  src/foo/       匹配该目录及其子路径
禁止匹配到仓库外、绝对路径、.. 逃逸。
outOfScope 优先于 inScope。
未声明路径对 implementation/repair 视为越界。
```

默认硬排除，即使没写进 `outOfScope`：

```text
~/.dsh/
.git/
**/.env
**/.env.*
**/secrets/**
**/id_rsa*
其他 git 仓库根
```

第一版完成审计以调用方提交的 `changedPaths` 为输入；生命周期测试可再加一个纯函数 `collectChangedPaths(gitStatusText)` 解析 `git status --short` / `git diff --name-only`。不要在单元测试里依赖真实 git 仓库，除非放在临时目录。

### 6.3 自动修复 / 复审

当 `kind=review|requirements` 以 `failed` 且 `verdict=needs_revision` 结束：

系统自动创建：

```text
repair-round-(N+1)
  kind=repair
  assignee=原实现者或 source task 的 assignee
  sourceTaskId=被审任务
  sourceFindingIds=未解决 findings
  dependencies=[sourceTaskId]   // 成功产物，不是 failed review
  round=N+1
  inScope=从 findings.file 收窄；若没有 file 则继承 source.inScope
  verify=继承 source.verify
  acceptance=每个 finding 的 requiredFix

review-round-(N+1)
  kind=review
  assignee=原 reviewer，不得改成实现者
  reviewedTaskId=新 repair 任务
  reviewedAttempt=repair 完成后的 attempt
  dependencies=[repair-round-(N+1)]
  round=N+1
```

若原任务是 `requirements`，自动创建的是下一轮 requirements / challenge，而不是代码 repair。命名保持 `requirements-round-N`。

自动创建前检查：

- `round + 1 <= maxRounds`。
- 同一 `sourceTaskId + finding set + reviewer` 未超过 `maxRepairAttempts`。
- 超限后：
  - 不再自动建任务。
  - 给 Captain 发一条 mailbox / steer 消息。
  - status 中出现 `escalated: true` 或等价字段。
  - 团队不自动 halt，除非用户停止。

`verdict=reject`：

- 不自动修复。
- 升级 Captain / 用户。
- 下游保持锁定。

### 6.4 调度

保持现有 scheduler：

- 只派 `pending` 且依赖全部 `completed` 的任务。
- mailbox 仍优先于新任务。
- halted 仍不派工。
- 自动创建的 repair / review 只是普通任务，不要为它们发明新调度器。

assignment prompt / persona 必须补上：

- 当前 `kind` / `round` / `objective` / `inScope` / `acceptance` / `verify`。
- review 只能 `pass` / `needs_revision` / `reject`。
- 完成必须走结构化字段。
- 只改本任务范围。
- 不要把邮件当成正式下一轮审查。

这些 prompt 是辅助，不是门禁本身。

### 6.5 恢复语义

新增工具：

```text
agent_teams_resume
```

参数：

```ts
{
  reason: string   // required, 非空
}
```

行为：

- 仅 Captain 可调用。
- 团队未 halt 时返回 `already_running`，不报致命错误。
- 团队已 halt 时清除 `halted/haltedAt`，然后 `kickTeam`。
- 不自动重建被取消的旧任务。
- 恢复后只调度仍然 `pending` 的任务；halt 时已被标 `cancelled` 的任务保持 cancelled。

`create_task` 不再隐式 unhalt。若 Captain 需要“恢复并创建下一阶段任务”，应先 `resume` 再 `create_task`，或使用 `create_task({ resume: true, resumeReason })` 作为同一锁内的便捷入口。两种入口语义必须一致，并有测试。

### 6.6 Coverage matrix

Captain 或系统在 status 中投影：

```ts
{
  goal_item: string
  task_ids: string[]
  status: 'missing' | 'in_progress' | 'passed' | 'blocked'
  evidence?: string
}
```

规则：

- 质量模式下，用户目标拆出的每条约束都应出现。
- 存在 `missing` 时，status / finalize 不得声称项目完成。
- 第一版允许 Captain 通过任务 `coverageOf` 声明覆盖关系；系统检查“是否有任务声明覆盖”，不解析自然语言目标。
- 必须提供一个纯函数：输入目标条目 + 任务列表，输出 matrix。

### 6.7 最终交付

不要新增独立“发布”工具。交付条件是 Captain 向用户汇报前必须能从 status 看出：

- 所有必需 `requirements` / `implementation` / `verification` / `review` / `integration` 都是 `completed`。
- 所有 review `verdict=pass`。
- 没有未处理 `failed` 且没有对应 repair。
- 没有 `missing` coverage。
- 没有未入账越界路径。

可提供纯函数 `canDeclareDelivery(team): { ok: boolean; blockers: string[] }`。Captain 协议要求：`ok=false` 时不得向用户宣布完成。

## 7. 工具与事件

### 7.1 现有工具改动

| 工具 | 改动 |
|---|---|
| `agent_teams_create_task` | 增加合同字段；halt 默认拒绝；质量 kind 强制合同；范围冲突拒绝 |
| `agent_teams_update_task` | 增加 verdict / findings / changedPaths / acceptanceResults / commandsRun；按 kind 拒绝非法 completed |
| `agent_teams_status` | 增加 kind、round、verdict、findings 摘要、coverage matrix、escalated、halt/resume 状态 |
| `agent_teams_create` | profile 可带 `reviewPolicy`；快照到 `team.profile` / `team.reviewPolicy` |

### 7.2 新工具

| 工具 | 作用 |
|---|---|
| `agent_teams_resume` | 显式恢复 halted 团队，必须带 reason |

不要新增 `submit_review` 作为第一版必做项。优先把审查结论收进 `update_task`，减少工具膨胀。如果实现时发现参数过载，可以把结构化提交抽成内部函数，不必先暴露新工具。

### 7.3 事件

扩展现有事件，不要另起 event map 文件：

- `agent-teams/task-created` 增加 `kind?`、`round?`。
- `agent-teams/task-updated` 增加 `verdict?`、`round?`。
- 新增 `agent-teams/team-resumed`：`{ teamId, reason }`。
- 自动创建 repair/review 仍走 `task-created`。

`event-types.ts` 继续保持零运行时 import。

## 8. Prompt / 文档同步

必须更新：

- `src/index.ts` 的 usage protocol：补上合同、verdict、禁止依赖 failed、显式 resume、禁止自我批准。
- `src/members.ts` persona。
- `src/scheduler.ts` assignmentPrompt。
- `docs/usage.md`。
- `README.md` / `README_ZH.md` 各加一小节，说明质量门禁存在，细节指向本文。

不要把本文全文贴进 usage prompt。prompt 只保留机器规则摘要。

## 9. 强制 TDD

这是硬门禁，不是建议。

### 9.1 顺序

每个机器规则都必须：

```text
1. 先写失败测试
2. 跑测试，确认失败原因是功能不存在或旧行为不符合本文
3. 再写最小实现
4. 再跑测试，确认变绿
5. 最后补文档和 prompt
```

禁止：

- 先实现再补测试。
- 用“以后再测”跳过门禁。
- 只测 prompt 字符串，不测工具拒绝。
- 删除或放宽已有 verify / lifecycle / stress 断言来让新功能通过。

### 9.2 测试文件

新增：

```text
scripts/quality-gates-tdd.mjs
```

风格照抄 `scripts/fallback-tdd.mjs`：

- Node ESM。
- 从 `../lib/...` 导入编译产物。
- `check(label, value)` / `throws(label, fn)`。
- 失败 `process.exitCode = 1`。

`package.json` 的 `verify` 必须改成：

```text
node scripts/verify.mjs
&& node scripts/fallback-tdd.mjs
&& node scripts/quality-gates-tdd.mjs
&& node scripts/lifecycle-verify.mjs
&& node scripts/stress-verify.mjs
&& pnpm verify:skill
```

`scripts/verify.mjs` 可补充少量纯函数断言，但质量门禁主清单必须集中在 `quality-gates-tdd.mjs`，方便对照本文。

`scripts/lifecycle-verify.mjs` 必须补工具级闭环，至少覆盖：

- 非法 completed 被拒绝。
- review `needs_revision` 自动生成 repair + next review。
- repair 不依赖 failed review。
- halted 后普通 `create_task` 不恢复。
- `resume` 后才能继续派工。
- 超 `maxReviewRounds` 不再自动建任务。

### 9.3 必须先写、必须失败的测试清单

下列 label 应当作为测试名的稳定前缀，实现时不要改意：

#### A. 合同与创建

1. `tdd.create.work-kind-remains-compatible`：旧 `create_task({subject})` 仍可创建 `kind=work`。
2. `tdd.create.implementation-requires-objective`：缺 objective 抛错。
3. `tdd.create.implementation-requires-acceptance`：缺 acceptance 抛错。
4. `tdd.create.implementation-requires-inscope-and-verify`：缺 inScope 或 verify 抛错。
5. `tdd.create.review-requires-reviewed-task`：缺 reviewedTaskId 抛错。
6. `tdd.create.repair-requires-source-and-findings`：缺 sourceTaskId / sourceFindingIds 抛错。
7. `tdd.create.repair-must-not-depend-on-failed-review`：dependencies 含 failed review 抛错。
8. `tdd.create.overlapping-inscope-rejects-parallel-ready-tasks`：两个无依赖实现任务 inScope 相交则拒绝。
9. `tdd.create.overlapping-inscope-allowed-when-serialized`：后者依赖前者时允许相交。
10. `tdd.create.implementation-blocked-until-requirements-pass`：存在未 pass 的 requirements 时拒绝创建 implementation。

#### B. 完成门禁

11. `tdd.complete.review-without-verdict-rejected`。
12. `tdd.complete.review-needs-revision-cannot-complete`。
13. `tdd.complete.review-pass-requires-no-open-high-findings`。
14. `tdd.complete.implementation-requires-acceptance-results`。
15. `tdd.complete.implementation-requires-all-verify-commands`。
16. `tdd.complete.out-of-scope-path-cannot-complete`。
17. `tdd.complete.undeclared-path-cannot-complete`。
18. `tdd.complete.verify-failure-must-fail-task`。
19. `tdd.complete.claimed-still-cannot-jump-to-completed`。
20. `tdd.complete.work-kind-keeps-legacy-output-only-complete`：旧 work 任务仍可用自由文本完成。

#### C. 路径规则

21. `tdd.scope.file-match`。
22. `tdd.scope.directory-prefix-match`。
23. `tdd.scope.out-of-scope-wins`。
24. `tdd.scope.rejects-parent-escape`。
25. `tdd.scope.rejects-absolute-path`。
26. `tdd.scope.default-excludes-env-and-git`。

#### D. 自动循环

27. `tdd.loop.needs-revision-creates-repair-and-next-review`。
28. `tdd.loop.repair-depends-on-source-not-failed-review`。
29. `tdd.loop.next-review-assigned-to-original-reviewer`。
30. `tdd.loop.next-review-cannot-be-implementer`。
31. `tdd.loop.round-increments`。
32. `tdd.loop.stops-at-max-review-rounds`。
33. `tdd.loop.reject-does-not-autoresume`。
34. `tdd.loop.requirements-needs-revision-opens-next-requirements-round`。

#### E. halt / resume

35. `tdd.resume.create-task-does-not-unhalt`。
36. `tdd.resume.explicit-resume-clears-halt`。
37. `tdd.resume.create-with-resume-reason-unhalts`。
38. `tdd.resume.cancelled-tasks-stay-cancelled`。
39. `tdd.resume.missing-reason-rejected`。

#### F. coverage / delivery

40. `tdd.coverage.missing-item-blocks-delivery`。
41. `tdd.coverage.passed-item-requires-completed-task`。
42. `tdd.delivery.ok-only-when-all-gates-pass`。
43. `tdd.delivery.failed-review-without-repair-blocks`。

#### G. 兼容与持久化

44. `tdd.state.old-team-json-without-new-fields-still-loads`。
45. `tdd.state.invalid-verdict-rejected-at-durable-boundary`。
46. `tdd.prompt.assignment-includes-kind-scope-acceptance`。
47. `tdd.usage.mentions-explicit-resume-and-verdict`。

以上 47 条是最低集。可以多写，不能少写。少写视为需求遗漏。

### 9.4 测试替身

lifecycle 继续使用现有 fake ctx / fake agents，不要依赖真实 LLM。

TDD 脚本优先测纯函数：

- 路径匹配
- 完成校验
- 自动展开下一轮任务的纯规划函数
- coverage / delivery 判定
- resume 状态变化

工具层测试通过 `registerAgentTeamsTools` 调真实 compiled tools。

## 10. 建议的代码落点

不要为了本功能大搬目录。优先这些文件：

| 文件 | 职责 |
|---|---|
| `src/types.ts` | 新字段和枚举 |
| `src/state.ts` | 持久化校验、范围纯函数、完成校验、delivery/coverage 纯函数 |
| `src/tools.ts` | create/update/resume 门禁，自动展开下一轮 |
| `src/profiles.ts` | `reviewPolicy` 解析与 allowlist |
| `src/members.ts` | persona 增补 |
| `src/scheduler.ts` | assignment 增补合同摘要 |
| `src/event-types.ts` | 事件字段 |
| `src/index.ts` | usage protocol、Config schema、resume 工具名 |
| `src/snapshot.ts` / client status 投影 | 如 status/UI 需要显示 verdict/round |
| `scripts/quality-gates-tdd.mjs` | 强制 TDD |
| `scripts/verify.mjs` | 少量纯函数补充 |
| `scripts/lifecycle-verify.mjs` | 工具闭环 |
| `docs/usage.md`、`README.md`、`README_ZH.md` | 用户可见说明 |

客户端最小要求：

- status / 活动面板能看到 `kind`、`round`、`verdict`。
- 不要为此重做面板布局。
- 没有这些字段的旧快照必须继续可渲染。

## 11. 实现阶段（同一需求，允许同一 PR，但必须按序）

允许一个实现窗口做完全部，但必须按这个顺序，每步先红后绿：

### Phase 0：TDD 骨架

- 新建 `scripts/quality-gates-tdd.mjs`。
- 把第 9.3 节全部断言写成失败测试。
- 把它挂进 `pnpm verify`。
- 此时 `pnpm verify` 必须失败。

### Phase 1：类型、持久化、纯函数

- 扩展类型和 `isTeamTask`.
- 实现路径匹配、完成校验、coverage、delivery 纯函数。
- 对应 TDD 变绿。

### Phase 2：create / update 门禁

- 改两个工具。
- 旧 `work` 行为保持兼容。
- 对应 TDD / lifecycle 变绿。

### Phase 3：自动循环 + resume

- 审查失败自动建下一轮。
- `agent_teams_resume`。
- 去掉 `create_task` 隐式 unhalt。
- 对应 TDD / lifecycle 变绿。

### Phase 4：prompt、status、文档

- persona / assignment / usage。
- status 投影。
- 用户文档。
- 全量 `pnpm typecheck && pnpm build && pnpm verify` 变绿。

## 12. 验收标准

完成当且仅当：

1. 第 9.3 节 47 条测试全部存在且通过。
2. `pnpm typecheck` 通过。
3. `pnpm build` 通过。
4. `pnpm verify` 通过，且包含 `quality-gates-tdd.mjs`。
5. `git diff --check` 无空白错误。
6. 旧 `work` 任务、旧 `team.json`、旧 profile seed/captain planning 仍可用。
7. Reviewer 不能再靠自由文本 `completed` 放行下游。
8. `create_task` 不再静默恢复 halted 团队。
9. 文档写明：第一版范围控制是完成时审计，不是 host 写入拦截。
10. 未改用户排除的文件，未做未授权 commit/push/PR。

## 13. 明确不在本需求内

- Staging UI / 执行前人工改 DAG / Approve & Run。
- 独立 worktree。
- Host 级 bash/fs 写入拦截。
- 人类会签投票组件。
- 自动部署。
- 多团队并行（一个 Captain 仍只能带一个团队）。
- 修改官方 DeepSeek Harness。

## 14. 新窗口执行指令

把下面整段复制到新窗口。不要删减。

```text
按 docs/quality-gates.md 完整实现 AgentTeams 质量门禁与多轮审查。

硬性约束：
1. 本文是唯一需求来源。不要发明额外功能，也不要缩成只改 prompt。
2. 强制 TDD：先写 scripts/quality-gates-tdd.mjs 的失败测试，再实现。第 9.3 节 47 条一条不能少。
3. 把该脚本挂进 package.json 的 verify。
4. 复用现有 DAG / attempt / halt / scheduler，不要新建 workflow 引擎。
5. 不要做 Staging UI、worktree、host 写入拦截、部署、commit、push、PR。
6. 不要修改 ~/.dsh/profiles/web/cordis.patch.yml。
7. 不要提交 docs/multi-role-profiles.md 和 docs/personal-kb-delivery/。
8. 旧 kind=work 必须兼容；质量 kind 才走新门禁。
9. review 只有 verdict=pass 才能 completed；needs_revision 只能 failed，并自动创建不依赖 failed review 的 repair + next review。
10. create_task 不得再静默 unhalt；必须显式 resume 或 create_task({resume, resumeReason})。
11. 完成后运行 pnpm typecheck、pnpm build、pnpm verify，并报告改了哪些文件。

执行顺序严格按文档第 11 节：Phase 0 红灯 → Phase 1–3 绿灯 → Phase 4 文档。
```

## 15. 实现时的定义优先级

如果实现中发现冲突，按这个顺序解释：

1. 本文第 2 节“不可以做”。
2. 本文第 6 节机器规则。
3. 本文第 9 节测试清单。
4. 现有状态机、attempt、failed 不解锁下游。
5. 现有 UI / 文档文案。

冲突时写进实现备注，不要静默改语义。
