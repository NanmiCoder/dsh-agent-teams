# AgentTeams 固定协议与业务工具

AgentTeams 保留原有 13 个业务工具，删除 `agent_teams_open`。精简的核心规则从首次请求起固定在 system 中，创建、批准、继续、暂停或归档团队都不切换这段提示词和工具定义。无需加载工具，也没有额外的激活调用。

这项修改针对两个问题：

- #146：已有团队时继续当前工作，按需用 `agent_teams_status` 查状态，避免重复创建成员和任务。即使模型误调用 create，错误也引导它继续已有团队，不再提示先结束旧团队。创建权限与防止重复建队的保护仍然保留。
- #138：精简固定说明，并按队长/成员身份提供需要的团队工具。没有通过中途增加工具、替换 system 来节省初始请求字节。

| 会话身份 | 固定团队工具 | 固定 system 内容 |
|---|---|---|
| 普通会话、队长、冷恢复的队长 | 原有 13 个业务工具 | 触发边界、审批、协作、attempt、质量门禁、暂停/恢复、收尾规则及已配置模板目录 |
| 成员 | claim、update、send_message、status | 成员规则和原有 persona |

普通编程/研究工具照常保留。成员身份来自持久化成员 ID、退休成员索引或插件正在执行的可信成员创建登记，不凭可自由填写的 label 判断。工具限制同时适用于原生 schema 和 PTC SDK，不能解除用户或 preset 的限制。

Slash command、明确的自然语言请求和已有团队续聊均直接适用核心协议。解释、否定或引用 AgentTeams 本身不构成开工请求。无团队时创建 staged 计划并等待审批；已有团队继续工作。模板目录固定包含名称、人数、规划模式和最多 240 字符的协议/用途摘要，最多列出 16 个模板。完整配置在创建团队时读取并冻结到团队状态中，目录摘要不替代完整配置。

核心规则不依赖工具结果，因此旧 13 工具白名单可以直接规划，代码模式丢弃返回值、结果被裁剪或会话历史被压缩后仍能读到规则。HMR 清理插件资源并恢复会话身份；部署新版本或修改配置本身可能改变前缀，稳定性约束针对同一版本和配置下的业务生命周期。

## 为什么撤回渐进加载

早期实现先暴露 open，再增加业务工具并替换 system。用户的长会话实测显示切换后缓存读显著下降，因此已撤回。随后保留 open 作为查询辅助工具也没有必要：当前状态已有 status，模板已有固定目录。最终直接删除 open，避免重复功能和额外模型往返。

本插件保证业务状态不主动改写 system/tools；这不能保证供应商的每次缓存命中。请求字节数也不等于 token、缓存命中率或费用，不能凭工具数量声称成本降低。

## Web 批准通知

Web 的 Approve & Run 提交批准并启动调度后，通过 `captain.steer` 追加插件来源的控制消息。队长空闲时开始一轮，运行时在后续步骤收到消息。消息说明已经批准，不要再次批准或重复派工；处理报告/用户工作后，在只剩等待时结束轮次，成员报告自动唤醒队长。模型自己调用 approve 已有工具返回，不额外发第二份通知。

批准通知失败会记录日志，已经提交的批准不会被误报成失败；当前没有跨进程持久化重试保证。

## 验证标准与证据

`pnpm verify:capabilities` 使用真实 scoped registry、prompt assembly 和 WorkerThreadCodeRuntime，覆盖固定规则、13 工具直接业务调用、重复创建保留原团队、用户 restriction、取消/失败、可信成员身份、暂停、冷恢复、HMR、PTC/both SDK 和实际结果裁剪。

`scripts/harness-runtime-verify.mjs` 将打包产物安装到隔离 profile，通过发布版 CLI 和真实 Loader 启动。只有外部 LLM 是确定性 fixture；工具、会话、持久化、调度和成员创建均走生产实现。

- `progressive-entry` 保留历史场景名，覆盖中文/英文自然语言、原始 slash、宿主 command registry、profile alias、`--profile` 六条路径。模型请求只包含 13 个团队工具，直接创建 staged 计划。测试继续已有计划、显式批准、成员执行和回报、归档、普通续聊和归档后状态检查。自然语言路径先进行 30 轮普通对话，再逐次检查 system/tools 哈希不变。
- `protocol-compatibility` 用 13 工具白名单直接使用模板、恢复同一会话，并调用宿主 `compactNow` 后修改原计划。另一条路径用真实代码运行时丢弃 status 返回、实际裁剪和压缩，再修改并归档同一团队。逐次检查核心规则和前缀。
- `web-approval` 通过真实 HTTP 路由和宿主鉴权批准，检查批准通知、队长结束等待轮次、成员报告再次唤醒，以及重复/失败批准不产生成功通知。
- 保留 lifecycle、fallback、failure、captain-idle-wakeup 和两组冷恢复场景。

```sh
pnpm build
pnpm verify
pnpm pack --pack-destination /tmp/agentteams-artifacts
node scripts/harness-runtime-verify.mjs \
  --host-version 0.1.2-rc.1 \
  --artifact /tmp/agentteams-artifacts/nanmicoder-dsh-agent-teams-0.1.16-rc.3.tgz \
  --report-dir /tmp/agentteams-runtime-rc1
```

对 `compatibility.json` 每个支持版本使用独立 runtime/report 目录验证同一产物。报告保留请求快照、请求哈希、产物/fixture 哈希和业务断言。确定性 fixture 证明链路与请求内容，不证明真实模型理解或业务质量。

删除 open 后的验证结果见 [no-open-verification.json](./no-open-verification.json)。真实模型使用隔离的小应用，外部检查三名成员报告、任务状态、实际写入来源、队长汇总顺序和源文件字节。单个真实案例不能证明任意业务、长期费用或统计成功率相等。

[旧固定协议报告](./progressive-loading-verification.json)和[先前真实模型对照](./agent-teams-real-model-verification.json)是仍包含 open 的历史产物证据，不代表当前 13 工具版本。删除 open 的本地验证记录使用暂未升号的 `0.1.16-rc.1` 开发包，以 SHA-256 区分，不能与 npm 上的 rc.1 混淆。本次发布版本为 `0.1.16-rc.3`，GitHub Actions 会重新打包并验证该发布版本的同一份产物。
