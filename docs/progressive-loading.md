# AgentTeams 渐进加载与验证标准

普通会话只获得 `agent_teams_open` 和一段发现说明。用户明确要求使用 AgentTeams、团队协作或输入 `/agent-teams` 时，模型先调用该入口；下一次请求才包含队长业务工具和完整协议。仅解释、引用或拒绝使用 AgentTeams，不代表启动请求。

入口是只读操作：读取当前团队摘要、列出可用 profile，并调整当前 Agent 的工具可见范围。它不会创建团队、批准计划、恢复暂停、确认邮箱消息或触发调度。无团队时仍走原来的 staged 规划和显式审批流程；已有团队继续使用当前状态。模板冲突会明确返回 `requested_profile` 和 `profile_conflict`，不会静默切换模板。

| 会话身份 | 可见的 AgentTeams 工具 | 注入的协议 |
|---|---|---|
| 普通会话 | `agent_teams_open` | 简短发现说明 |
| 已打开的队长、恢复的现有队长 | 入口 + 原有 13 个业务工具 | 队长协议，以及当前选中的 profile 摘要 |
| 成员 | claim、update、send_message、status | 成员说明和原有任务 persona |

业务工具仍只注册一次。插件使用 Harness 的会话作用域 restriction 控制 schema 和 PTC SDK；打开 A 会话不会让 B 会话加载全部工具，也不会解除用户或 preset 的限制。成员身份来自持久化成员 ID、退休成员索引或插件正在执行的成员创建登记，不根据模型可自由填写的 label 判断。

首次请求前恢复已有团队身份；热重载清理旧作用域并重新恢复。create/delete 的工具执行结果用于记录生命周期，包括 PTC 嵌套调用。结束团队后，在 idle 或新输入被领取的安全边界撤销完整工具，避免打断当前工具组。仅打开入口而尚未创建团队时，本次驻留会话可继续规划；这一临时打开状态不持久化到磁盘。

## 开销口径

以无自定义 profile、Harness `0.1.2-rc.1` 的真实 ToolRuntime/SystemPrompt 组装结果测量。下表只计算插件的 usage 段和原生工具定义的 JSON UTF-8 字节，不包含宿主其他提示、任务历史或成员 persona，也不把字节换算成 token。旧值来自变更前的 `0.1.16-rc.1` 实现。

| 场景 | 原实现 | 渐进加载 |
|---|---:|---:|
| 普通会话的团队工具数 | 13 | 1 |
| 普通会话的 usage 段 | 7,057 bytes | 339 bytes |
| 普通会话的 schema | 13,348 bytes | 449 bytes |
| 成员的团队工具数 | 6 | 4 |
| 成员的全局团队 usage 段 | 7,057 bytes | 443 bytes |
| 成员的团队 schema | 6,740 bytes | 4,364 bytes |

普通会话两项固定开销合计从 20,405 降到 788 bytes，约减少 96.1%。启动团队多一次入口调用；进入团队后仍保留完整的业务 schema。这里优化的是未使用团队时的固定上下文，以及成员不需要的队长上下文。

## 回归标准

`pnpm verify:capabilities` 使用真实 scoped registry 和 prompt assembly，覆盖会话隔离、用户 restriction、取消/失败、成员身份、暂停和模板冲突、冷恢复、HMR、PTC/both SDK、以及同轮创建并结束后的撤销。

`scripts/harness-runtime-verify.mjs` 将打包产物安装进独立 profile，经发布版 CLI 和真实 Loader 启动。只替换外部 LLM，工具执行、会话、状态文件、调度和成员创建均走生产实现。所有模型发出的工具调用必须存在于该次请求的工具列表，入口必须返回成功后才继续。

新增 `progressive-entry` 场景覆盖中文和英文自然语言输入、原始 slash 文本、宿主 command registry、profile alias、`--profile`。每条路径都检查首次只加载入口、下一步加载业务工具、staged 期间没有子会话、重复打开不改动计划、后续显式批准才能派工、成员任务完成并回报。原来的 lifecycle、fallback、failure、captain-idle-wakeup 和冷恢复场景继续保留。

```sh
pnpm build
pnpm verify
pnpm pack --pack-destination /tmp/agentteams-artifacts
node scripts/harness-runtime-verify.mjs \
  --host-version 0.1.2-rc.1 \
  --artifact /tmp/agentteams-artifacts/nanmicoder-dsh-agent-teams-0.1.16-rc.1.tgz \
  --report-dir /tmp/agentteams-runtime-rc1
```

对 `compatibility.json` 中每个支持版本使用独立 report/runtime 目录重跑；CI 必须验证同一产物的全部场景。报告保存依赖 cohort、产物和 fixture 哈希、首次各角色的完整模型请求快照、请求字节计数、业务状态与断言。

脚本模型验证入口接通和业务回归，不能证明真实模型会正确识别任意表述。自然语言触发率、拒绝/引用误触发率、额外调用耗时及真实 token 成本，需要有凭据的真实模型 benchmark 单独测量；应同时包含明确请求、一般协作请求、解释、否定、引用、普通问答和多轮续聊。模型选择与供应商计费不能由脚本 fixture 的固定 usage 值推断。

## 本次验证结果

2026-09-09：`pnpm typecheck`、`pnpm build`、`pnpm verify` 和 15 项 capability 测试通过。以下三个发布版宿主使用同一份打包产物，每个宿主的 7 组场景均通过；入口组内的 6 条路径分别执行完整审批和任务回报流程。

| Harness | 校验的 DSH 包身份数 | 结果 |
|---|---:|---|
| 0.1.2-rc.1 | 214 | 7/7 |
| 0.1.2-alpha.5 | 214 | 7/7 |
| 0.1.2-alpha.2 | 215 | 7/7 |

产物 SHA-256：`2f945939e43ad5a8f9be8fd457e2f7fa4c7dd1d157550c98e760d14803e5831d`。三个宿主实际组装的 discovery 均为 339 bytes usage + 449 bytes schema。测试源码哈希与当前工作区一致；详细断言和未覆盖边界见 [verification JSON](./progressive-loading-verification.json)。
