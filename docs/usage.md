# 使用指南（详细）

本文档收纳 dsh-agent-teams 的详细使用内容：工作原理、Web UI 行为、工具一览、配置与已知限制。README 只保留简介与快速上手。

## 工作原理

`dsh-agent-teams` 复用 DSH 的能力接缝（capability seam），不依赖 workflow 引擎：

| DSH 能力 | AgentTeams 用法 |
|---|---|
| `ctx.tools` 注册表 | 注册 9 个 `agent_teams_*` 工具（与 `tool-workflow` 同一注册路径） |
| `ctx.subagents.startContinuable()` | 创建成员：durable 可续聊子代理；成员协议可放在系统 persona 或首条用户消息 |
| `ctx.subagents.followup()` | 唤醒收件成员（消息进入其下一轮次） |
| `ctx.subagents.listChildren()` | 查询成员实时活动（running / inactive） |
| `ctx.systemPrompt.section()` | 注册"AgentTeams 使用策略"提示段 |
| Web server 路由注册 | 活动面板数据路由 `/plugins/dsh-agent-teams/state` + 鲸鱼图片静态服务（`webServer`/`httpServer` 双键兼容，见下） |
| 文件系统 | 团队状态持久化在 `<workspace>/.agent-teams/<teamId>/` |

数据链路：工具执行 → 磁盘状态（真相源）→ host 快照路由 → 浮层 1s 轮询渲染；会话日志同时写入 `agent-teams/*` 事件（审计/重放/复盘）。

> **内测版本兼容**：npm `latest`（`0.0.1-rc.1`）的服务键仍是 `ctx.httpServer` / `ctx.workspace`，后续 `next`（`rc.2`）重命名为 `ctx.webServer` / `ctx.workspaceRegistry`。插件对两组键都做了探测（新键优先、旧键回退，`internal/service` 事件同时监听两组），两个版本都能注册路由。

### Web UI

- **右上角活动面板**（body-portal 浮层，参考 Claude Code 桌面端 SessionActivityPanel）：团队创建后自动展开；每个团队一节——👑 队名 + 统计 + `● n 工作中`；**成员块**（职业头像 · 名字 · 角色 · 状态 · 进度 · 未读角标，点击打开成员子会话并立即收起面板），块下直接挂**任务栈**（当前任务置顶高亮 + 6 态徽章：待领取/已认领/进行中/已完成/失败/已取消 + 依赖提示 `← t1 · alice`）；无主任务进"待认领"块；底部队长收件箱预览。收起态为右上角小浮标（团队数 + 活动脉冲点）。
- **小鲸鱼形象**：队长/成员头像为 DeepSeek 小鲸鱼职业插画（`assets/agent-teams/`，8 角色 + 6 动作），按角色关键词匹配；状态动作小图随成员状态切换并带动画（工作浮动 / 空闲呼吸 / 未知思考），未读消息头像外圈光晕；遵循 `prefers-reduced-motion`。
- **会话跟随**：面板只显示**当前会话**的团队（按 captainSessionId 匹配）；新建会话面板自动收起，切回团队会话恢复。
- **对话流卡片**：团队创建时对话流出现轻量卡片（成员一览、点击跳转成员会话、"活动面板"按钮可重新激活已关闭的浮层）。
- **历史复盘**：`agent_teams_delete` 将团队**归档保留**（`<stateRoot>/archive/<teamId>/`，任务与依赖图、邮箱完整留存）；打开历史会话点卡片即可恢复完整团队（成员 + 任务栈 + 依赖 + 消息），供重建任务依赖关系。

### 团队状态文件

```
<workspace>/.agent-teams/<teamId>/
├── team.json            # 团队记录：成员、任务（含依赖）、任务序号
└── inbox/
    ├── captain.jsonl    # 队长邮箱（成员 → 队长）
    └── <member>.jsonl   # 每个成员一个邮箱（JSONL）
```

任务状态机：`pending → claimed → in_progress → completed | failed | cancelled`；迁移白名单校验；领取前校验依赖（未完成依赖报错列出）。

## 工具一览

| 工具 | 作用 |
|---|---|
| `agent_teams_create` | 创建团队，调用者成为队长（一个队长同时只带一个团队） |
| `agent_teams_add_member` | 拉成员入队（spawn 可续聊子代理 + 可配置的成员协议注入） |
| `agent_teams_remove_member` | 移除成员（尽力打断其当前轮次） |
| `agent_teams_create_task` | 创建任务，支持 `dependencies` 依赖声明与 `assignee` 指派 |
| `agent_teams_claim_task` | 领取任务（校验依赖；队长可代领，成员只能领自己的/未指派的） |
| `agent_teams_update_task` | 推进任务状态并写入 `output` 结果 |
| `agent_teams_send_message` | 任意成员→任意成员/队长：消息直达对方邮箱并唤醒对方（无队长转发；拒绝冒名 `from`） |
| `agent_teams_status` | 团队全景：成员活动、任务清单、队长邮箱、各成员待读消息 |
| `agent_teams_delete` | 结束团队：打断成员，团队目录**归档保留**（任务与依赖图、邮箱完整留存） |

`agent_teams_add_member` 默认不需要模型参数：它会快照队长当前请求真正生效的 LLM provider、model 与思考强度。用户明确要求某个角色使用其他模型时，可以同时传入可选的 `provider` + `model`；只覆盖 `model` 时沿用队长当前 LLM provider。插件不会为每个成员发起二次选择或弹窗，也不暴露逐成员思考强度参数。

## 配置

在 profile 的 `cordis.patch.yml` 中覆盖：

```yaml
- id: agent-teams
  config:
    stateDir: .agent-teams        # 团队状态目录名（工作区下）
    memberProvider: spawn         # 子代理运行后端（spawn / fork），不是 LLM provider
    memberModel: deepseek-v4      # 可选：成员模型覆盖
    memberMaxDepth: 1             # 成员再委派深度上限（0 = 禁止）
    memberPersonaPlacement: system # system（默认）或 prompt
    maxMembers: 8                 # 团队人数上限
```

最终优先级为：成员显式 `provider` + `model` / `model` → `memberModel` → 队长当前路由。思考强度默认继承队长当前值，并在目标 provider/model 上创建前校验；不兼容时成员创建会明确失败。最终生效的 provider/model/思考强度会写入 `team.json`，供状态查询和成员冷恢复使用。

`memberPersonaPlacement: system` 保持原行为：成员协议作为 scoped persona 覆盖部署 persona。`prompt` 将同一份成员协议放进首条用户消息，不发送子 Agent `request.persona`，因此 Anchored Standard、梁神模式等依赖精确首轮系统提示的 preset 可以原样完成轨迹锚定；协议仍随会话历史持久化并参与续聊。

## 使用协议

插件提示段会指导模型按协议执行：建团队 → 按角色拉成员 → 拆任务并声明依赖 → 领取并唤醒成员 → 轮询 `agent_teams_status` 收集产出 → 汇报后 `agent_teams_delete`。成员之间可以直接互发消息（`agent_teams_send_message` 直达对方邮箱并唤醒对方），无需队长中转。

## 已知限制

- 成员在收到消息（被唤醒）后才行动，没有常驻轮询；队长离线时消息留在邮箱、待队长下次操作时投递。
- 一个队长同时只能带一个团队（与 Claude Code AgentTeams 一致）。
- `memberPersonaPlacement: system` 会替换部署默认 persona；`prompt` 会保留 preset persona，并把成员协议持久化在首条用户消息中。成员仍拥有完整工具集（bash/fs/web 等）。
- 团队状态为文件级持久化，多进程同时操作同一团队不保证一致（同一 dsh 进程内已用锁串行化）。
- 活动面板读磁盘真相（1s 轮询），与会话日志事件流相互独立。
- 右上角浮层通过 body portal 挂载；宽屏展开时主对话列平滑向左礼让空间，窄屏退回 overlay 模式，左侧导航保持不动。
- 成员（模型）不总是严格走工具"仪式"（如完成时不调 `agent_teams_update_task`）——面板如实反映磁盘真相，队长以 `agent_teams_status`/文件为准汇总。

## 验证

- 离线冒烟：`pnpm build && pnpm typecheck && node scripts/verify.mjs`；组合验证 `dsh --profile agent-teams-check --dump-config`
- 真实 e2e：`dsh plugin --profile headless add <path>` 后 `dsh --profile headless "用 AgentTeams …"`，核对 `.agent-teams/` 状态文件与会话日志事件流
- GUI：独立实例 + ego-browser（详见 `verification-guide.md`）
