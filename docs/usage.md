# 使用指南（详细）

本文档收纳 dsh-agent-teams 的详细使用内容：工作原理、Web UI 行为、工具一览、配置与已知限制。README 只保留简介与快速上手。

## 工作原理

`dsh-agent-teams` 复用 DSH 的能力接缝（capability seam），不依赖 workflow 引擎：

| DSH 能力 | AgentTeams 用法 |
|---|---|
| `ctx.tools` 注册表 | 注册 11 个 `agent_teams_*` 工具（与 `tool-workflow` 同一注册路径） |
| `ctx.subagents.startContinuable()` | 创建成员：durable 可续聊子代理，带成员 persona |
| `ctx.subagents.followup()` | 唤醒收件成员（消息进入其下一轮次） |
| 持久化团队成员表 + `ctx.agents` | 前者保存 durable 成员身份，后者提供真实 `running / idle / ready` 活动状态（不依赖易变的子代理目录投影） |
| `agent/status` | 成员进入 idle 后触发共享任务池自动续领与下一轮唤醒 |
| `ctx.systemPrompt.section()` | 注册"AgentTeams 使用策略"提示段 |
| Web server 路由注册 | 活动面板数据路由 `/plugins/dsh-agent-teams/state` + 鲸鱼图片静态服务（`webServer`/`httpServer` 双键兼容，见下） |
| 文件系统 | 团队状态持久化在 `<workspace>/.agent-teams/<teamId>/` |

数据链路：工具执行 → 磁盘状态（真相源）→ host 快照路由 → 浮层 1s 轮询渲染；会话日志同时写入 `agent-teams/*` 事件（审计/重放/复盘）。

> **内测版本兼容**：npm `latest`（`0.0.1-rc.1`）的服务键仍是 `ctx.httpServer` / `ctx.workspace`，后续 `next`（`rc.2`）重命名为 `ctx.webServer` / `ctx.workspaceRegistry`。插件对两组键都做了探测（新键优先、旧键回退，`internal/service` 事件同时监听两组），两个版本都能注册路由。

### Web UI

- **跟随宿主语言**：插件注册独立的 `agentTeams` locale namespace，并通过 Slot 的官方 `locale` seat 获取翻译函数；对话卡片、活动面板、动态状态摘要、历史标识和无障碍文案都会随 Harness 在简体中文/英文之间实时切换。英文是缺失词条的官方回退语言，插件不读取 DOM 猜测语言，也不修改宿主源码。
- **右上角活动面板**（`shell.overlay` 非模态浮层）：团队创建后自动展开；默认停靠在会话右侧，高度随内容增长，达到视口安全上限后才在面板内部滚动，不用空白填满屏幕。面板可切换为浮动窗口后拖拽，停靠态支持左边缘调宽，浮动态还支持底边和右下角调整大小；只有用户主动纵向缩放后才固定浮动态高度。位置、手动尺寸和停靠模式会在刷新后恢复；标题栏的收起按钮会折叠为右上角小浮标（团队数 + 活动脉冲点）。每个团队展示队长、分段总进度、状态统计、可折叠成员树和紧凑任务 DAG。DAG 以真实 SVG 曲线连接依赖，悬停或键盘聚焦可预览完整上下游链，点击固定，`Esc` 取消；选中节点会显示负责人、未满足前置、下游解锁信息和该任务使用的模型。运行中的任务节点与派工标签会直接标出模型短名，成员行保留完整 `provider/model`。成员行展示职业头像、角色、实时状态和任务标签，点击可打开成员子会话。
- **小鲸鱼形象**：队长/成员头像为 DeepSeek 小鲸鱼职业插画（`assets/agent-teams/`，8 角色 + 6 动作），按角色关键词匹配；状态动作小图随成员状态切换并带动画（工作浮动 / 空闲呼吸 / 未知思考），未读消息头像外圈光晕；遵循 `prefers-reduced-motion`。
- **会话跟随**：面板只显示**当前会话**的团队（按 captainSessionId 匹配）；新建会话面板自动收起，切回团队会话恢复。
- **对话流卡片**：团队创建时对话流出现轻量卡片（成员一览、点击跳转成员会话、"活动面板"按钮可重新激活已关闭的浮层）。
- **历史复盘**：`agent_teams_delete` 将团队**归档保留**（`<stateRoot>/archive/<teamId>/`，成员、任务、依赖图和邮箱完整留存）；结束团队时成员会被标记为 removed，但仍保留在 Harness 的子代理目录中供历史会话寻址，后续唤醒则继续被拒绝。历史快照保留整支队伍，并以空闲/已交付状态展示。即使旧会话没有对话流卡片，重启后选择该队长会话也会做一次轻量冷发现，恢复成员树与 DAG；点击成员可打开其持久化会话记录。

### 团队状态文件

```
<workspace>/.agent-teams/<teamId>/
├── team.json            # 团队记录：成员、任务（含依赖）、任务序号
└── inbox/
    ├── captain.jsonl    # 队长邮箱（成员 → 队长）
    └── <member>.jsonl   # 每个成员一个邮箱（JSONL）
```

任务状态机：`pending → claimed → in_progress → completed | failed | cancelled`。每次执行携带单调 `attempt` + 唯一 `attemptId`；转派先使旧 attempt 失效，再中断并等待旧成员安静，因此迟到更新无法覆盖新结果。领取前校验依赖，并禁止成员同时拥有两个未完成任务。

旧 `kind=work` 任务仍可用自由文本完成。质量 kind（`requirements` / `implementation` / `verification` / `review` / `repair` / `integration`）走结构化合同：创建时要有 objective 和 acceptance；实现/修复还要有 `inScope` 与 `verify`。`review` / `requirements` 只有 `verdict=pass` 才能 `completed`；`needs_revision` / `reject` 必须 `failed`，并带至少一条 finding。审查失败后系统自动创建不依赖 failed review 的 repair + 下一轮 review。第一版范围控制是完成时审计（对照调用方提交的 `changedPaths`），不是 host 写入拦截。halted 团队不能被普通 `create_task` 静默恢复，必须 `agent_teams_resume` 或 `create_task({ resume, resumeReason })`。质量模式下人只提供目标和约束；默认任务顺序是 requirements → implementation → verification → review → integration，审查合同审的是实现是否过关，不要把“请提交 needs_revision”写进任务。`halted` 表示人停止了团队，`escalated` 只表示自动循环到上限，两者不是一回事。详情见 `docs/quality-gates.md`。

## 工具一览

| 工具 | 作用 |
|---|---|
| `agent_teams_create` | 创建团队，调用者成为队长（一个队长同时只带一个团队） |
| `agent_teams_add_member` | 拉成员入队（spawn 可续聊子代理 + 成员 persona） |
| `agent_teams_remove_member` | 安全移除成员：撤销 attempt、回收其未完成任务、等待中断收敛后重新调度 |
| `agent_teams_create_task` | 创建任务，支持合同字段、`dependencies`、`assignee`；halted 时默认拒绝，除非显式 `resume` |
| `agent_teams_reassign_task` | 原子重试/转派任务；`assignee=captain` 表示队长安全接管 |
| `agent_teams_claim_task` | 领取任务（校验依赖；队长可代领，成员只能领自己的/未指派的） |
| `agent_teams_update_task` | 携带当前 `attempt_id` 推进任务；质量 kind 按 verdict / acceptanceResults / commandsRun / changedPaths 拒绝非法 completed |
| `agent_teams_send_message` | 任意成员→任意成员/队长：消息直达对方邮箱并唤醒对方（无队长转发；拒绝冒名 `from`） |
| `agent_teams_status` | 团队全景：kind/round/verdict、coverage matrix、escalated、halt/resume 状态 |
| `agent_teams_resume` | 显式恢复 halted 团队，必须带非空 reason；不重建已取消任务 |
| `agent_teams_delete` | 结束团队：打断成员，团队目录**归档保留**（任务与依赖图、邮箱完整留存） |

`agent_teams_add_member` 默认不需要模型参数：成员沿用队长当前 LLM provider/model 时，会一并快照队长当前思考强度。用户明确要求某个角色使用其他模型时，可以同时传入可选的 `provider` + `model`；只覆盖 `model` 时沿用队长当前 LLM provider。provider 或 model 任一改变时，思考强度自动使用目标模型默认档；用户明确要求某个成员使用特定强度时，可以传入可选的 `reasoning_effort`（目标模型支持的档位 id，或 `"default"` 表示强制使用模型自身默认档）。插件不会为每个成员发起二次选择或弹窗。

## 配置

在 profile 的 `cordis.patch.yml` 中覆盖：

```yaml
- id: agent-teams
  config:
    stateDir: .agent-teams        # 团队状态目录名（工作区下）
    memberProvider: spawn         # 子代理运行后端（spawn / fork），不是 LLM provider
    memberModel: deepseek-v4      # 可选：成员模型覆盖
    memberMaxDepth: 1             # 成员再委派深度上限（0 = 禁止）
    maxMembers: 8                 # 团队人数上限
    executionPrompt: |            # 注入成员 persona 与每次任务派工
      The document does not need to record the process; it should only record facts, unless I explicitly request the process to be recorded.
      The product interface should present the intended outcome, not reveal the reasoning process.
    fallback:                     # 主模型不可用时的第二选择
      provider: openai
      model: gpt-5.5
```

最终优先级为：成员显式 `provider` + `model` / `model` → `memberModel` → 队长当前路由。成员沿用队长当前 provider/model 时继承队长的思考强度；provider 或 model 任一改变时自动使用目标模型的默认档。显式 `reasoning_effort`（目标模型支持的档位 id，或 `"default"`）优先，并在目标 provider/model 上创建前校验；不兼容时成员创建会明确失败。最终生效的 provider/model/思考强度会写入 `team.json`，供状态查询和成员冷恢复使用。

## 使用协议

插件提示段会指导模型按两阶段协议执行：创建 staged 团队 → 写入可编辑成员占位 → 拆任务并声明依赖 → 等待用户审查 → **Approve & Run** 后原子创建成员并启动调度 → 队长监控/引导 → 汇报后 `agent_teams_delete`。staged 阶段没有子会话、不会领取任务。只有用户明确要求跳过审查时才使用 `approval: automatic`。成员之间可以直接互发消息，无需队长中转。驻留成员在中断或正常结束一轮后若仍持有 `claimed/in_progress` 任务，该 attempt 会停驻；只有显式重试/转派/接管才会撤销它。

## 命名多角色 profiles

在 profile 的 `cordis.patch.yml` 中配置 `profiles`。每个模板都会定义成员阵容；`taskPlanning: captain` 只提供阵容与门禁，由 Captain 根据目标动态建任务图；省略该字段或设为 `seed` 时，仍会展开固定任务种子。例如：

```yaml
profiles:
  demo-delivery:
    description: 交付一个小功能
    protocol: 先讨论需求，再实现、审查、测试和发布准备；未经确认不得部署。
    members:
      - name: analyst
        model: gpt-5.6-sol
        role: 分析需求
      - name: implementer
        model: gpt-5.6-terra
        role: 实现方案
    tasks:
      - id: requirements
        subject: 需求讨论
        assignee: analyst
      - id: implementation
        subject: 实现方案
        assignee: implementer
        dependencies: [requirements]
```

通过 `/agent-teams --profile demo-delivery 实现这个功能` 显式点名模板；不要使用首 token 隐式 profile。seed 模式提供模板任务，captain 模式只提供阵容与约束，由 Captain 在 staged 阶段设计 DAG。面板允许编辑成员 provider/model/reasoning/角色提示词和任务负责人/依赖，批准前不会创建成员或派工。依赖 output 会传给下游；failed 的审查/测试不会解锁后续，自动 repair/review 不依赖 failed review。`memberProvider` 是 spawn/fork 后端，不是模型 provider。

## Captain 动态规划与停止整队

推荐的 profile 配置只提供成员阵容、模型路由和交付门禁，不预先规定用户目标的完整 DAG：

```yaml
profiles:
  software-delivery:
    taskPlanning: captain
    protocol: |
      用户只提供目标和约束。由 Captain 决定是否拆分、如何设置依赖、哪些工作可以并行。
      不要询问用户是否拆分、合并、串行或并行。
    members:
      - name: requirements-analyst
        provider: openai
        model: gpt-5.6-sol
        role: 分析需求和验收标准
```

`taskPlanning: captain` 时 profile 不再假设项目目录、包管理器或固定质量图；Captain 根据真实目标和 workspace 设计 DAG。若用户明确要求质量门禁，再创建带合同的 requirements → implementation → verification → review → integration 任务，并从真实项目推导 `inScope` 与 `verify`。`taskPlanning: seed` 保留固定 seed task 工作流。

执行前计划审查直接读取 Harness 的模型目录：成员模型和推理等级使用与主输入区一致的 Provider/模型元数据，不再要求手写路由。「返回对话修改」会把 staged 草案标记为等待反馈，取消尚未结束的规划轮次，并由插件上下文要求 Captain 只追问一次修改方向；用户回复后，Captain 必须通过一次 `agent_teams_edit_plan` 原子更新同一份草案，不能另建团队。「放弃本次计划」需要二次确认，随后归档草案、取消当前轮次，并保留禁止自动重建的模型上下文；仅「确认并启动团队」会创建成员和调度任务，且不再增加一次无意义的启动确认。

长任务运行期间，具体团队标题右侧会显示停止按钮。点击后需在确认框中再次确认，才会取消 Captain 当前回合、中断全部成员、取消未完成任务并停止后续调度；入口不再占用聊天输入区域。停止不会删除团队，之后的新用户消息可显式要求 `agent_teams_resume`。取消/失败任务在归档中保持原终态。

## 已知限制

- 调度是事件驱动而非常驻轮询；队长离线时无法冷恢复成员，任务和消息保留在磁盘，待队长恢复或调用状态工具后继续投递。
- 一个队长同时只能带一个团队（与 Claude Code AgentTeams 一致）。
- 成员 persona 替换部署默认 persona；成员仍拥有完整工具集（bash/fs/web 等）。
- 团队状态为文件级持久化，多进程同时操作同一团队不保证一致（同一 dsh 进程内已用锁串行化）。
- 活动面板读磁盘真相，与会话日志事件流相互独立：切换/重启后先对当前会话做一次冷发现；仅在发现活动团队或存在对话流卡片需求时保持 1s 轮询，普通会话不会常驻扫描。
- 主聊天窗的官方 Stop 只取消队长当前轮次；活动面板中具体团队的「停止团队」会在二次确认后同时取消 Captain 当前回合和全部 continuable 成员，并冻结后续调度。输入框仍可在停止完成后发送新的恢复指令。
- 右上角浮层挂载到 DeepSeek Harness `0.1.0-rc.8` 的 `shell.overlay`；宽屏停靠态让主对话列按面板实际宽度礼让空间，浮动态保持非模态覆盖，窄屏退回安全内边距 overlay 并关闭拖拽/缩放，左侧导航保持不动。
- `/agent-teams` 在 slash 菜单中的描述和输入 hint 来自 Host `CommandDefinition`；当前官方命令协议没有 locale namespace 字段，因此仍保留稳定的英文元数据。插件不会用 DOM 替换去伪造这一层翻译；待 Host 提供正式接口后再接入。
- 成员（模型）不总是严格走工具"仪式"（如完成时不调 `agent_teams_update_task`）——面板如实反映磁盘真相，队长以 `agent_teams_status`/文件为准汇总。

## 验证

- 离线与生命周期：`pnpm build && pnpm typecheck && pnpm verify`。除基础检查外，还包含 8 成员、31 节点多层 DAG（运行中扩展至 38 任务）的故障矩阵：并发接管/移除、50 次迟到写入、4 个开放任务冷重启、7 路认领竞争、40 次终态覆盖、42 条消息突发和最终归档；组合验证 `dsh --profile agent-teams-check --dump-config`
- 真实 e2e：`dsh plugin --profile headless add <path>` 后 `dsh --profile headless "用 AgentTeams …"`，核对 `.agent-teams/` 状态文件与会话日志事件流
- GUI：独立实例 + ego-browser（详见 `verification-guide.md`）
