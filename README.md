# dsh-agent-teams

DeepSeek Harness 的 AgentTeams 插件：安装后，任何会话都可以用一句自然语言（例如“用 AgentTeams 调研一下 XX”）驱动一个多智能体团队协作完成目标，并在 Web GUI 的对话流里实时看到团队树状监测面板（Team Lead → 成员 → 各自正在跑的任务）。

核心语义忠实移植自 Claude Code 的 AgentTeams：

1. **创建团队** — 由“队长”（当前会话的 agent）创建团队；
2. **成员** — 队长通过 `agent_teams_add_member` 拉成员进团队，每个成员是一个**可续聊的子代理**（continuable subagent，同一会话、跨轮次、跨重启持久）；
3. **任务** — 队长拆解目标为任务，任务之间可声明依赖（依赖未完成的任务不可领取）；
4. **消息** — 队长 ↔ 成员、成员 ↔ 成员都可以收发消息（文件邮箱 + 队长唤醒投递）。

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

成员与 Claude Code 的 in-process teammate 一样“等待工作”：队长发消息 → 成员醒来跑完整一轮（用 `agent_teams_*` 工具更新任务状态、写结果）→ 进入 idle。成员的最终回复对插件不可编程读取，因此成员把报告写入队长邮箱（`inbox/captain.jsonl`）与任务记录，队长用 `agent_teams_status` 轮询读取。

### Web UI：对话流里的团队树监测面板

UI 完全复刻 DSH workflow Web UI（`dsh-client-ui-workflow-run`）的实现链路，包是同一个 dual-face 插件：

1. **host 侧**（`src/events.ts`）：每次团队状态变更（建队/加人/移除/建任务/任务流转/删队），向**队长会话**写入一条 `agent-teams/*` 会话事件（`src/event-types.ts` 声明合并 `SessionEventMap`）。成员执行的操作也统一落回队长会话，所以监测面始终是队长的对话流。
2. **浏览器侧**（`src/client/`，通过 package.json 的 `dsh.client` manifest 进入 `window.__DSH_BOOT__` 浏览器名册）：一个 Conversation Node（`agent-teams-definition.ts`）按 `seq` 确定性重放这些事件，fold 出团队状态；`AgentTeamsTreePanel.tsx` 把状态投影成横向树渲染到 `conversation.chat.node` 槽位——顶部是队长（Team Lead）卡片，树线往下挂一排成员卡片，每个成员卡片列出它当前未完成的任务（带状态徽章，进行中置顶），成员正在工作时状态点高亮（复用 `useSessions` 会话快照判断子代理是否 running）。

数据流与 workflow 面板完全一致：工具执行 → `session.append` → 会话日志（可持久化、可重放）→ 前端 Conversation Node 折叠 → 树状渲染。没有任何独立 RPC 通道。

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
| `agent_teams_send_message` | 队长→成员（投递并唤醒）；成员→队长/成员间（写入邮箱，队长转发） |
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

插件内置的提示段会指导模型按协议执行：建团队 → 按角色拉成员 → 拆任务并声明依赖 → 领取并唤醒成员 → 轮询 `agent_teams_status`、转发消息、收集产出 → 汇报后 `agent_teams_delete`。

## 验证

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

- 成员只有在被队长消息唤醒后才行动（没有常驻轮询）；成员之间没有直接的实时聊天，消息经邮箱 + 队长转发。
- 一个队长同时只能带一个团队（与 Claude Code AgentTeams 一致）。
- 成员 persona 替换了部署默认 persona；成员仍拥有完整工具集（bash/fs/web 等）。
- 团队状态为文件级持久化，多进程同时操作同一团队不保证一致（同一 dsh 进程内已用锁串行化）。
- 浏览器端面板依赖会话日志事件（`agent-teams/*`）重放；旧会话若在插件安装前已存在，其历史事件不可回溯。

## License

MIT
