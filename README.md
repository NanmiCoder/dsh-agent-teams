# dsh-agent-teams

DeepSeek Harness 的 AgentTeams 插件：安装后，任何会话都可以用一句自然语言（例如“用 AgentTeams 调研一下 XX”）驱动一个多智能体团队协作完成目标，并在 Web GUI 的对话流里实时看到团队树状监测面板（Team Lead → 成员 → 各自正在跑的任务）。

核心语义忠实移植自 Claude Code 的 AgentTeams：

1. **创建团队** — 由“队长”（当前会话的 agent）创建团队；
2. **成员** — 队长通过 `agent_teams_add_member` 拉成员进团队，每个成员是一个**可续聊的子代理**（continuable subagent，同一会话、跨轮次、跨重启持久）；
3. **任务** — 队长拆解目标为任务，任务之间可声明依赖（依赖未完成的任务不可领取）；
4. **消息** — 队长 ↔ 成员、成员 ↔ 成员都可以收发消息：消息**直达收件人邮箱并唤醒收件人**（与 Claude Code 邮箱模型一致，无队长中转；DSH 中唤醒由插件以队长身份代理，对成员透明）。

## 工作原理

### 与 DSH workflow 的关系

`dsh-agent-teams` 复用了 DSH 的能力接缝（capability seam）而不是 workflow 引擎：

| DSH 能力 | AgentTeams 用法 |
|---|---|
| `ctx.tools` 注册表 | 注册 9 个 `agent_teams_*` 工具（与 `tool-workflow` 同一注册路径） |
| `ctx.subagents.startContinuable()` | 创建成员：生成一个 durable 的可续聊子代理，带成员 persona |
| `ctx.subagents.followup()` | 队长给成员投递任务/消息（进入该成员的下一轮次） |
| `ctx.subagents.listChildren()` | 查询成员当前活动状态（running / inactive） |
| `ctx.systemPrompt.section()` | 注册“AgentTeams 使用策略”提示段，让模型知道何时、如何用这套工具 |
| 文件系统 | 团队状态持久化在 `<workspace>/.agent-teams/<teamId>/` |

成员与 Claude Code 的 in-process teammate 一样“等待工作”：任何成员（含队长）发消息 → 收件成员醒来跑完整一轮（用 `agent_teams_*` 工具更新任务状态、写结果）→ 进入 idle。成员的最终回复对插件不可编程读取，因此成员把报告写入队长邮箱（`inbox/captain.jsonl`）与任务记录，队长用 `agent_teams_status` 轮询读取。

### Web UI：右上角活动面板

面板形态参考 **Claude Code 桌面端活动面板**（claude-code-haha 未提交分支：`desktop/src/components/activity/SessionActivityPanel.tsx` + `desktop/src/components/agentTeams/` 工作台），按"服务器快照 + 客户端轮询"模式实现：

1. **host 侧**：每次团队状态变更仍向队长会话写入 `agent-teams/*` 会话事件（日志完整、可重放）；同时注册只读 HTTP 路由 `GET /plugins/dsh-agent-teams/state`（`src/snapshot.ts`），从**磁盘真相**（team.json / 任务 / 邮箱）组装快照并附上成员实时活动（`subagents.listChildren`）——与 Claude Code 桌面 watcher 一致，面板不受"模型跳过工具仪式"影响。
2. **浏览器侧**（`src/client/ActivityPanel.tsx`，body-portal 挂载，因为 Web shell 无右上角槽位）：**fixed 右上角玻璃浮层**（top 64 / right 24 / 372px / blur 18px / hairline 边框），1s 轮询快照路由：
   - **收起态**：右上角小浮标（团队数 + 活动状态点脉冲），点开展开；
   - **小鲸鱼形象**：队长/成员头像为 DeepSeek 小鲸鱼职业插画（`assets/agent-teams/`，host 路由 `/plugins/dsh-agent-teams/assets/<name>.png` 服务），按角色关键词匹配 8 张角色图（研究员/工程师/QA/设计/安全/数据分析/文档/队长），未匹配回退首字母；成员头像右下角叠加**状态动作小图**（工作中=敲键盘浮动动画 / 空闲=打盹呼吸 / 未知=思考摆动），收到未读消息时头像外圈光晕动画；全部动画遵循 `prefers-reduced-motion`。
   - **展开态**：`AgentTeams 活动` 面板——每个团队一节：👑 队名 + 统计（成员/任务/消息）+ `● n 工作中` live 徽章；**成员块**（职业头像 · 名字 · 角色 · 状态 · 进度 · 未读角标，点击打开成员子会话并**立即收起面板**），**每个成员块下方直接挂其任务栈**（当前任务置顶高亮 + 状态徽章按 6 态细粒度：待领取/已认领/进行中/已完成/失败/已取消 + 依赖提示如 `← t1 · alice`；空闲成员显示状态行：等待任务/等待收尾/等待依赖）；无主任务进"待认领"块；队长收件箱最近消息预览；
   - **自动行为**：出现团队时自动展开一次；团队全部消失后 2s 自动收起；`prefers-reduced-motion` 降级。

数据链路：工具执行 → 磁盘状态（真相源）→ host 快照路由 → 浮层轮询渲染。会话日志事件继续写入（重放/审计）。

### 团队状态文件

```
<workspace>/.agent-teams/<teamId>/
├── team.json            # 团队记录：成员、任务、任务序号
└── inbox/
    ├── captain.jsonl    # 队长邮箱（成员 → 队长）
    └── <member>.jsonl   # 每个成员一个邮箱（JSONL）
```

任务状态机：`pending → claimed → in_progress → completed | failed | cancelled`，状态迁移在白名单内校验；领取任务前校验依赖（未完成的依赖会报错列出）。

## 工具一览

| 工具 | 作用 |
|---|---|
| `agent_teams_create` | 创建团队，调用者成为队长（一个队长同时只带一个团队） |
| `agent_teams_add_member` | 拉成员入队（spawn 可续聊子代理 + 成员 persona） |
| `agent_teams_remove_member` | 移除成员（尽力打断其当前轮次） |
| `agent_teams_create_task` | 创建任务，支持 `dependencies` 依赖声明与 `assignee` 指派 |
| `agent_teams_claim_task` | 领取任务（校验依赖；队长可代领，成员只能领自己的/未指派的） |
| `agent_teams_update_task` | 推进任务状态并写入 `output` 结果 |
| `agent_teams_send_message` | 任意成员→任意成员/队长：消息**直达对方邮箱并唤醒对方**（与 Claude Code 邮箱模型一致，无队长转发） |
| `agent_teams_status` | 团队全景：成员活动状态、任务清单、队长邮箱、各成员待读消息 |
| `agent_teams_delete` | 结束团队：打断成员、删除团队状态目录 |

## 安装

### 方式一：作为 bundle 安装（推荐，全会话生效）

```sh
cd /path/to/dsh-agent-teams
pnpm build            # 产出 lib/
# 本地路径安装到某个 profile（例如 web）：
dsh plugin --profile web add /absolute/path/to/dsh-agent-teams
```

`dsh plugin` 会把包 pnpm 安装进 profile 并自动将其加入 `dsh.profile.bundles` 层列表（包内 `cordis.patch.yml` 通过 `dsh.bundle.patch` 声明）。插件行 `agent-teams` 挂载在主机组合层，工具注册进全局 `tools` 注册表、使用策略进入全局 system prompt，因此该 profile 下**所有会话**都能用。发布到 npm 后则直接 `dsh plugin --profile web add dsh-agent-teams`。

> 注意：`dsh plugin` 修改的是该 profile 的 `package.json`/manifest；**重启 dsh 服务后**插件才会加载（HMR 观察的是 `cordis.patch.yml`，新增插件行需要重启或热更新生效）。

### 方式二：作为 agent preset（按会话挂载，可选）

把本仓库 `preset/`（如需）或自行编写的 `agent.cordis.yml` 放进 `~/.dsh/.agent-presets/<id>/` 并在该会话选中对应 preset。bundle 方式已覆盖多数场景，preset 方式按需选用。

## 配置

bundle 行可在 profile 的 `cordis.patch.yml` 中覆盖：

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

插件内置的提示段会指导模型按协议执行：建团队 → 按角色拉成员 → 拆任务并声明依赖 → 领取并唤醒成员 → 轮询 `agent_teams_status`、收集产出 → 汇报后 `agent_teams_delete`。成员之间可以直接互发消息（`agent_teams_send_message` 直达对方邮箱并唤醒对方），无需队长中转。

## 验证

### 0. 已在独立实例上真实验证（DeepSeek-V4-Flash）

以下验证已在**独立 profile**（不触碰正在运行的 web 实例）上真实跑通：

```sh
# ① headless profile 端到端（真实 LLM）：建队「标题方案」→ 2 成员 → 2 任务
#   （t2 依赖 t1）→ 消息唤醒 → 产出汇总 → 删队，全部成功
dsh plugin --profile headless add /absolute/path/to/dsh-agent-teams
cd /tmp && dsh run --profile headless "用 AgentTeams 帮我完成一个小任务：创建团队…"

# ② 落盘验证：队长会话日志含完整事件流
#   agent-teams/team-created ×1, member-added ×2, task-created ×2,
#   task-updated ×2, team-deleted ×1（含 agent-teams/message-sent）

# ③ 独立 web 组合（agent-teams-web = base + web-app + 本插件）端到端：
dsh run --profile agent-teams-web "用 AgentTeams 创建团队 smoke，1 个成员 1 个任务…"   # 通过

# ④ UI 加载链路（独立 web 实例，3081 端口）：
#    浏览器名册含 dsh-agent-teams（`dshClient` 旧格式兼容）
#    GET /plugins/dsh-agent-teams/client.js → 200
#    GET /plugins/dsh-agent-teams/state → {"teams":[...]}

# ⑤ GUI 端到端（ego-browser 驱动真实浏览器 + DeepSeek-V4-Flash）：
#    新建会话跑团队任务 → 右上角自动展开活动面板：
#       [AgentTeams 活动 ●]
#       👑 发布方案   2 成员 2 任务 1 消息   ● 1 工作中
#       🔬 alice 工作中 █████░░ t1   🛠 bob 空闲 ░░░░░ t2
#       t1 进行中  →  t2 阻塞（依赖缩进）
#    任务推进时面板实时更新（t1 完成 → t2 解锁 running），队长收件箱
#    显示成员完整汇报；关闭后面板缩成右上角浮标（团队数+脉冲点）；
#    团队删除后浮层自动消失（2s 宽限）。
#    截图：/tmp/agent-teams-activity-running.png / -terminal.png
```

> 兼容性说明：当前部署（staging 快照）的 `client-modules` 读取 package.json 顶层
> `dshClient` 字段（新版本读 `dsh.client`），故 package.json 同时声明两种格式。

### 1. 离线验证（不需要启动任何服务）

```sh
cd /path/to/dsh-agent-teams
pnpm build               # host 侧 lib + 浏览器侧 lib/client.js（双 tsc + tsdown）
pnpm typecheck           # 两个编译程序各自全绿
node scripts/verify.mjs  # ①任务状态机/依赖门禁 ②团队文件/邮箱持久化 ③前端树 fold 逻辑（临时目录，自清理）

# 组合验证：用独立 scratch profile 检查 bundle 补丁能否组合进配置树
# （不会触碰正在运行的 profile，也不 boot 服务，只离线 dump 配置）
dsh --profile agent-teams-check --dump-config   # 应看到 agent-teams 行
```

### 2. 端到端验证（需要重启服务，请自行安排在合适时机）

```sh
# 方式 A：headless 跑一条真实任务（不依赖 GUI）
dsh plugin --profile headless add /absolute/path/to/dsh-agent-teams
dsh run --profile headless "用 AgentTeams 帮我做一个 3 句话的网站标题方案，2 个成员，每个成员 1 个任务"

# 方式 B：GUI 验证（Web UI 监测面板）
# 1. dsh plugin --profile web add /absolute/path/to/dsh-agent-teams
# 2. 重启 dsh web（新增 bundle 与浏览器 client 行需要重启加载）
# 3. 新开会话输入：“用 AgentTeams 调研 XX”
# 4. 对话流中应出现树状监测面板：顶部 Team Lead，树线向下挂成员卡片，
#    每个成员显示正在跑的任务（进行中置顶、状态徽章、成员工作时长亮起）
# 5. 完成后检查 <workspace>/.agent-teams/<teamId>/team.json 与 inbox/ 内容；
#    前端面板数据来自会话日志中的 agent-teams/* 事件（可重放）
```

验证入口：`pnpm verify` 通过；`dsh --profile agent-teams-check --dump-config` 输出含 `agent-teams` 行；浏览器侧产物 `lib/client.js` 以 `window.__ModuleLoader__.load(...)` closure-factory 格式输出（外部化 react / ui-primitives / runtime）。

## 已知限制

- 成员只有在收到消息（被唤醒）后才行动，没有常驻轮询；成员间消息直达收件人邮箱并唤醒对方（队长在线时由插件以队长身份代理唤醒，队长不参与内容），队长离线时消息留在邮箱、待队长下次操作时投递。
- 一个队长同时只能带一个团队（与 Claude Code AgentTeams 一致）。
- 成员 persona 替换了部署默认 persona；成员仍拥有完整工具集（bash/fs/web 等）。
- 团队状态为文件级持久化，多进程同时操作同一团队不保证一致（同一 dsh 进程内已用锁串行化）。
- 活动面板读磁盘真相（1s 轮询），与会话日志事件流相互独立；旧会话/旧团队的状态文件依然可见。
- 右上角浮层为 body portal 自管几何（Web shell 无右上角槽位），不参与 shell 的布局系统。
- 成员（模型）不总是严格走工具"仪式"（如完成时不调 `agent_teams_update_task`、用 bash 直接读文件确认产出）——面板如实反映事件流，可能与磁盘真相有短暂偏差；队长以 `agent_teams_status`/文件为准汇总。

## License

MIT
