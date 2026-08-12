# dsh-agent-teams

DeepSeek Harness 的 AgentTeams 插件：安装后，任何会话只需一句自然语言（例如"用 AgentTeams 调研一下 XX"），即可驱动一个**多智能体团队**协作完成目标，并在 Web GUI 右上角实时看到团队活动面板（队长 → 成员 → 各自正在跑的任务）。

核心语义忠实移植自 Claude Code 的 AgentTeams：

1. **创建团队** — 由"队长"（当前会话的 agent）创建团队；
2. **成员** — 队长通过 `agent_teams_add_member` 拉成员入队，每个成员是一个**可续聊的子代理**（continuable subagent，跨轮次、跨重启持久）；
3. **任务** — 队长拆解目标为任务，任务之间可声明**依赖**（依赖未完成的任务不可领取）；
4. **消息** — 队长 ↔ 成员、成员 ↔ 成员均可收发消息：消息**直达收件人邮箱并唤醒对方**（与 Claude Code 邮箱模型一致，无队长中转）。

## 界面预览

![AgentTeams 活动面板](assets/ui.png)

右上角活动面板：成员块（小鲸鱼职业头像 · 状态 · 进度）+ 每个成员下方直接挂其任务栈（当前任务高亮、6 态徽章、依赖提示），底部为队长收件箱预览。对话流中另有轻量团队卡片（成员一览 + 重新激活面板入口）。

## 工作原理

`dsh-agent-teams` 复用 DSH 的能力接缝（capability seam），不依赖 workflow 引擎：

| DSH 能力 | AgentTeams 用法 |
|---|---|
| `ctx.tools` 注册表 | 注册 9 个 `agent_teams_*` 工具（与 `tool-workflow` 同一注册路径） |
| `ctx.subagents.startContinuable()` | 创建成员：durable 可续聊子代理，带成员 persona |
| `ctx.subagents.followup()` | 唤醒收件成员（消息进入其下一轮次） |
| `ctx.subagents.listChildren()` | 查询成员实时活动（running / inactive） |
| `ctx.systemPrompt.section()` | 注册"AgentTeams 使用策略"提示段 |
| `ctx.httpServer.register()` | 活动面板数据路由 `/plugins/dsh-agent-teams/state` + 鲸鱼图片静态服务 |
| 文件系统 | 团队状态持久化在 `<workspace>/.agent-teams/<teamId>/` |

数据链路：工具执行 → 磁盘状态（真相源）→ host 快照路由 → 浮层 1s 轮询渲染；会话日志同时写入 `agent-teams/*` 事件（审计/重放/复盘）。

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
| `agent_teams_add_member` | 拉成员入队（spawn 可续聊子代理 + 成员 persona） |
| `agent_teams_remove_member` | 移除成员（尽力打断其当前轮次） |
| `agent_teams_create_task` | 创建任务，支持 `dependencies` 依赖声明与 `assignee` 指派 |
| `agent_teams_claim_task` | 领取任务（校验依赖；队长可代领，成员只能领自己的/未指派的） |
| `agent_teams_update_task` | 推进任务状态并写入 `output` 结果 |
| `agent_teams_send_message` | 任意成员→任意成员/队长：消息直达对方邮箱并唤醒对方（无队长转发；拒绝冒名 `from`） |
| `agent_teams_status` | 团队全景：成员活动、任务清单、队长邮箱、各成员待读消息 |
| `agent_teams_delete` | 结束团队：打断成员，团队目录**归档保留**（任务与依赖图、邮箱完整留存） |

## 安装

```sh
cd /path/to/dsh-agent-teams && pnpm build     # 产出 lib/ 与 lib/client.js
dsh plugin --profile web add /absolute/path/to/dsh-agent-teams
```

`dsh plugin` 会把包 pnpm 安装进 profile 并自动加入 `dsh.profile.bundles` 层列表（`cordis.patch.yml` 经 `dsh.bundle.patch` 声明）。插件行挂载在 host 组合层：工具进全局 `tools` 注册表、使用策略进全局 system prompt、浏览器入口进 `window.__DSH_BOOT__` 名册——该 profile 下**所有会话**可用。发布到 npm 后直接 `dsh plugin --profile web add dsh-agent-teams`。

> **重启生效**：`dsh plugin` 修改的是 profile 的 manifest；插件在启动时组合，新增插件行需要重启 dsh 服务（HMR 只热更用户层配置）。

## 配置

在 profile 的 `cordis.patch.yml` 中覆盖：

```yaml
- id: agent-teams
  config:
    stateDir: .agent-teams        # 团队状态目录名（工作区下）
    memberProvider: spawn         # 成员子代理 provider（spawn / fork）
    memberModel: deepseek-v4      # 可选：成员模型覆盖
    memberMaxDepth: 1             # 成员再委派深度上限（0 = 禁止）
    maxMembers: 8                 # 团队人数上限
```

## 使用

安装并重启后，直接对助手说：

> 用 AgentTeams 帮我调研一下开源 RAG 框架的选型，输出对比报告

插件提示段会指导模型按协议执行：建团队 → 按角色拉成员 → 拆任务并声明依赖 → 领取并唤醒成员 → 轮询 `agent_teams_status` 收集产出 → 汇报后 `agent_teams_delete`。

## 验证

### 1. 离线验证（不需要启动任何服务）

```sh
cd /path/to/dsh-agent-teams
pnpm typecheck          # host / client 两个编译程序各自全绿
pnpm build              # tsc ×2 + tsdown（lib/ 与 lib/client.js）
node scripts/verify.mjs # 状态机/依赖门禁/文件持久化/归档/视觉状态函数冒烟（临时目录，自清理）
dsh --profile agent-teams-check --dump-config   # 组合验证：应看到 agent-teams 行（不 boot 服务）
```

### 2. 端到端验证（真实 LLM，独立 profile，不影响运行实例）

```sh
dsh plugin --profile headless add /absolute/path/to/dsh-agent-teams
cd /tmp && dsh run --profile headless "用 AgentTeams 帮我完成一个小任务：创建团队…"
# 落盘核对：<工作区>/.agent-teams/ 状态文件 + 队长会话日志事件流
#   agent-teams/team-created / member-added / task-created / task-updated /
#   message-sent / team-deleted（zstdcat session.jsonl.zstd 核对）
```

### 3. GUI 验证（ego-browser，独立 web 实例）

```sh
# 独立实例（3081 端口，--patch 覆盖 webserver.port；勿动运行中的 web profile）
dsh --profile agent-teams-web --patch /tmp/port.patch.yml
# ① 名册：页面 window.__DSH_BOOT__ 含 dsh-agent-teams（dshClient 旧格式兼容）
# ② 路由：/plugins/dsh-agent-teams/client.js、/state、/assets/team-lead.png → 200
# ③ ego-browser：新会话跑团队任务 → 右上角自动展开面板 → DOM 探针
#    （data-agent-teams-activity / memberBlock / taskRow / 图片 naturalWidth）
#    → 跳转成员立即收面板 → 删队后历史会话卡片恢复归档团队 → 截图存档
```

> 兼容性说明：当前部署（staging 快照）的 `client-modules` 读取 package.json 顶层
> `dshClient` 字段（新版本读 `dsh.client`），故 package.json 同时声明两种格式。

## 已知限制

- 成员在收到消息（被唤醒）后才行动，没有常驻轮询；队长离线时消息留在邮箱、待队长下次操作时投递。
- 一个队长同时只能带一个团队（与 Claude Code AgentTeams 一致）。
- 成员 persona 替换部署默认 persona；成员仍拥有完整工具集（bash/fs/web 等）。
- 团队状态为文件级持久化，多进程同时操作同一团队不保证一致（同一 dsh 进程内已用锁串行化）。
- 活动面板读磁盘真相（1s 轮询），与会话日志事件流相互独立。
- 右上角浮层为 body portal 自管几何（Web shell 无右上角槽位），不参与 shell 布局系统。
- 成员（模型）不总是严格走工具"仪式"（如完成时不调 `agent_teams_update_task`）——面板如实反映磁盘真相，队长以 `agent_teams_status`/文件为准汇总。

## License

MIT
