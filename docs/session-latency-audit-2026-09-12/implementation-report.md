# AgentTeams 稳定性与启动效率：修复验收

2026-09-12。已完成用户授权的实现与验证。修复位于当前工作树，未提交、发布或更新用户运行中的 Web profile。

基线 commit 为 `2e59da1`（完整值见 [source-manifest.json](verification/source-manifest.json)），插件版本仍为 0.1.17。本地候选包 SHA-256：

`49c22d22de82831aab2d19418ad46a2355648e0965568411548431103ef4a51b`

候选产物：`/tmp/agentteams-stability/nanmicoder-dsh-agent-teams-0.1.17.tgz`。这个版本号用于本地比较，不表示 npm 上的 0.1.17 已包含修复。未更改依赖或锁文件。

## 修复内容

| 问题 | 现在的行为 | 主要实现 |
| --- | --- | --- |
| 当前任务的纠正消息等到整轮结束 | 协作消息进入最近的模型步骤；新任务继续使用独立轮次 | `harness-compat.ts`、`tools.ts`、`scheduler.ts` |
| 入队立即标已读，掩盖积压 | 分开记录 accepted/delivered 与 read；精确消息 ID 在步骤入口或实际工具展示时确认，批量去重 | 新增 `mailbox.ts`，修改 `state.ts` |
| 重分配后继续处理旧任务消息 | 消息绑定 task/attempt；重分配先撤销执行资格、清理旧输入，再启动新 attempt | `mailbox.ts`、`tools.ts` |
| 删除/移除只取消当前轮，后代与旧队列仍活着 | 统一递归 drain 所选成员分支；清空输入，等待后代释放；旧身份在步骤入口拒绝执行，包括内部唤醒和冷恢复 | `members.ts`、`tools.ts` |
| 清理失败仍可能产生错误收尾或无法重试 | 停机/交接状态先持久化；失败不宣称归档成功，支持重试已有 removed 成员及未完成交接 | `types.ts`、`tools.ts` |
| 空闲、被依赖阻塞的成员先跑欢迎轮 | 先建名单；首次收到可执行任务才创建会话，第一个模型输入直接包含任务及依赖结果 | `scheduler.ts`、`members.ts`、`tools.ts` |
| 建队、成员、任务要逐条模型调用 | `agent_teams_create({plan:{members,tasks}})` 原子创建完整名单与依赖图，校验前向引用及环路；保留现有分步工具 | `tools.ts`、`index.ts` |
| 普通 work 未完成也显示可以交付 | 普通未完成/失败任务、空团队、仅取消任务、staged/halted/escalated 状态均阻止交付 | `quality-gates.ts` |
| claim 后缺少任务详情，模型再读状态文件 | claim 的结构化及模型可见输出包含完整任务描述、契约和依赖结果；澄清 review 是团队产物门禁，普通外部代码审查使用 work | `tools.ts` |
| 成员自行增加大量后代 | 默认 `memberMaxDepth=0`，工具与运行时入口共同约束；设为 1 才允许成员的一层后代 | `index.ts`、`members.ts` |
| 同一结果通过团队消息和原生消息汇报两遍 | 明确 captain 就是 parent，只汇报一次；默认成员只开放团队消息路径 | `members.ts` |
| 多个未启动成员的 React key 都为空 | 使用成员名字作为未启动阶段的稳定 key，状态显示 idle | `AgentTeamsCard.tsx`、`snapshot.ts` |

与参考仓库对齐的是关键执行语义：先有实际工作再启动成员、在步骤边界接收协作消息、结束时关闭完整成员分支。并非照搬另一宿主的 API；这里使用四个精确 Harness 版本各自经过实测的契约。

回归过程中还修正了一个容易遗漏的竞态：状态工具可能先读取邮箱，而宿主队列中同一消息尚未进入下一步骤。此时只丢弃重复消息，必须保留正在执行任务的工具结果续步；只有新一轮完全由过期消息触发时才拒绝整轮。

## 真实 DeepSeek 验证

按用户要求，**CLI 进程和 Agent 的 cwd 均为 `/tmp`**。测试项目、团队状态及会话保存在 `/tmp/agentteams-stability/real-final/` 的专属目录，避免覆盖 `/tmp` 其他内容。使用用户既有 credential store 的引用，未复制或打印密钥；测试 profile 与日常 Web profile 隔离。

真实路由为 `deepseek-official / deepseek-flash / max`，与当时本机设置一致。没有脚本生成模型回答，也没有安排模型必须按照固定工具调用顺序执行。

| 场景 | 外部验收 | 结果 |
| --- | --- | --- |
| 三成员独立代码审查 | performance/security/interaction 分别新增报告；问题必须对应已知源码缺陷并给出复现证据；由各自成员写入；三项任务完成后队长写汇总；原文件哈希不变 | 通过，96.972 秒，46 次模型请求 |
| 新进程恢复原团队 | 原 security 成员完成一项新增复核；队长写后续汇总；团队和三名成员的 ID 不变；仅新增一个任务 | 通过，37.441 秒，16 次模型请求 |
| 真实输出流中取消 | 收到真实 provider 内容块后触发取消；请求终止，队长回到 idle | 通过，1 次请求 |

最终三成员场景的进一步观察：

- 建队、三名成员和三项任务由 **1 次建队工具调用**完成，模型实际采用了 inline plan。
- 队长 15 次模型请求，成员合计 31 次；三次团队汇报，原生消息汇报 **0 次**；工具错误 **0**，模型错误 **0**。
- 首个内容块延迟中位数 **720 ms**，完整模型响应中位数 **2,388.5 ms**。这是 LLM middleware 观测值，包含调用链和网络，不是纯服务端推理时间。
- 队长及各成员的 system/tool schema 哈希在各自会话内稳定。

摘要见 [deepseek-summary.json](verification/deepseek-summary.json)，完整验收见 [首次运行](verification/deepseek-candidate-result.json)、[冷恢复](verification/deepseek-candidate-cold-result.json)、[流式取消](verification/deepseek-cancellation-result.json)。对应 manifest 保存实际产物、测试文件哈希、模型配置和输入；timings 文件保存请求、usage、工具名称与时序，省略命令参数和回答正文。

中间版本的第一次真实测试也通过（102.458 秒、54 次请求），但发现成员重复调用两套消息工具，因此继续修复并重新运行。两次模型自由执行路径不同，不能将这两个时间简单换算成稳定加速比例。这个三文件场景也不同于用户原本的大仓库审查，不能宣称原任务已从 40 分钟缩短到 97 秒。

## 故障复现与真实宿主回归

同一套新测试运行原始 HEAD 包，在“依赖阻塞成员必须保持未启动”的断言失败；候选包通过。证据：[基线失败](verification/baseline-red-result.json)、[具体断言](verification/baseline-red-assertion.log)。这是预期的红灯基线，不计入候选兼容性失败。

最终同一个 tarball 通过以下四个版本，每个版本 **10 条路径，共 40 条**。真实使用已发布 npm 包的 CLI、Loader、Agent、工具执行器、持久化和子会话运行时，仅模型输出由确定性 fixture 提供。所有宿主 DSH 分包均检查 lockfile 与磁盘上的精确版本，未混用依赖闭包。

| Harness | 已核验的 DSH 分包数 | 路径通过 | 证据 |
| --- | ---: | ---: | --- |
| 0.1.5-rc.1 | 231 | 10/10 | [结果](verification/0.1.5-rc.1-result.json)、[依赖闭包](verification/0.1.5-rc.1-cohort.json) |
| 0.1.2-rc.1 | 214 | 10/10 | [结果](verification/0.1.2-rc.1-result.json)、[依赖闭包](verification/0.1.2-rc.1-cohort.json) |
| 0.1.2-alpha.5 | 214 | 10/10 | [结果](verification/0.1.2-alpha.5-result.json)、[依赖闭包](verification/0.1.2-alpha.5-cohort.json) |
| 0.1.2-alpha.2 | 215 | 10/10 | [结果](verification/0.1.2-alpha.2-result.json)、[依赖闭包](verification/0.1.2-alpha.2-cohort.json) |

路径包括常规生命周期及冷恢复、失败路由切换及冷恢复、失败收尾、空闲队长被汇报唤醒、渐进创建与审批、真实 HTTP Web 审批、旧协议/压缩/工具输出裁剪，以及新增稳定性场景。

新增稳定性场景在每个版本验证：

1. ready 成员首请求就是完整真实任务；blocked 成员请求数 0，欢迎轮请求数 0。
2. 工作中发送 **32 条**消息，宿主 `nextStep=32`、`nextTurn=0`；投递后仍未读，下一步骤全部消费并确认。
3. 状态工具先读消息后，重复队列回执不截断当前轮。
4. 运行中的同一成员被重新分配，drain 后以新 attempt 恢复，旧指导不进入模型输入。
5. 存在 **32 条未消费消息 + 活跃孙级分支 + 无关兄弟分支**时归档：目标输入清空、成员及后代停止、退休身份拒绝恢复，无关兄弟继续运行。
6. 五成员六任务可由 1 次工具调用创建；旧分步接口完成同一建图操作至少需要 12 次调用。该指标是工具调用数量，不等于 12 个必然串行的模型步骤。

每个版本额外保存 `*-stability-events.json`，包含已读消息续步等全部稳定性断言的完成事件。旧宿主原生 sendMessage 会添加发送者文本块，回执识别同时覆盖这一真实格式。

## 构建、功能及界面

- `pnpm build` 通过：[日志](verification/build.log)。
- `pnpm verify` 全部通过：[日志](verification/verify.log)。包括新增消息/生命周期测试、普通 work 交付、失败交接重试、原子计划校验、8 成员复杂 DAG 压力场景、三种 Harness 交付接口、路由、能力边界及兼容性检查。
- `git diff --check` 通过。
- Ego Lite 中挂载实际 AgentTeamsCard 和真实 React 开发构建：三个未启动成员同时显示、未启动成员点击不跳转、启动后跳转正确、重排后顺序正确、React 错误为 0。[浏览器结果](verification/browser-result.json)。这是隔离组件交互；完整 Web 审批后端另外由真实 Harness HTTP 场景验证。

## 复跑

在仓库根目录执行 `pnpm build`、`pnpm verify` 后打包。精确宿主验证使用新的报告目录：

```sh
npm pack --ignore-scripts --pack-destination /tmp
node scripts/harness-runtime-verify.mjs --host-version 0.1.5-rc.1 \
  --artifact /tmp/nanmicoder-dsh-agent-teams-0.1.17.tgz \
  --report-dir /tmp/agentteams-runtime-new
```

另外三个版本分别替换 `--host-version` 并使用各自独立目录。已准备好的、由此测试器创建的 runtime 可通过 `--runtime-dir` 复用；同一 runtime 不应并发安装。

真实 API 三成员场景使用现成精确 runtime、当前配置与本地包：

```sh
node scripts/harness-model-benchmark.mjs \
  --runtime-dir /tmp/agentteams-stability/runtime-0.1.5-rc.1 \
  --baseline-artifact /tmp/agentteams-stability/baseline-source/nanmicoder-dsh-agent-teams-0.1.17.tgz \
  --candidate-artifact /tmp/agentteams-stability/nanmicoder-dsh-agent-teams-0.1.17.tgz \
  --report-dir /tmp/agentteams-real-new --agent-cwd /tmp \
  --only candidate --timeout-ms 900000 --max-requests 90
```

成功后保留相同 report-dir，依次改用 `--only candidate-cold`、`--only cancellation` 验证后续行为。每个阶段只执行一次，脚本拒绝覆盖已有证据。该命令会真实调用已配置的 DeepSeek API。

## 范围与回退

没有扩展支持版本、修改日常 profile、升级全局 Harness、改写用户原始会话或参考仓库。完整测试均在 macOS arm64 / Node 26.7.0；其他系统、更多供应商、大型真实项目反复采样的成功率及服务端高负载仍未测量。原始评论者的几十条积压日志未提供，因此只能证明缺陷机制及本次修复，不冒充其现场重放。

这次消除了已确认的无效启动、延迟消息、重复汇报及归档边界问题。模型响应仍取决于任务范围、上下文、推理配置及服务状况；未设置一个会强制截断所有正常长任务的硬步骤上限，也不对服务端延迟作无依据保证。

本次源码回退限定为 [source-manifest.json](verification/source-manifest.json) 中列出的改动；不要重置整个工作树或覆盖其他人的修改。原始诊断资料可保留。

数据回退需特别注意：新逻辑允许 running 团队包含 `id=""` 的未启动成员，旧插件的状态校验不接受这一组合。未来安装候选版本后若需降级，应先通过新版本结束/归档新建的活动团队，再切换旧包；不要把新状态直接交给旧插件。现有已启动成员的 persona 与工具快照仍遵循宿主持久化语义，新的首次启动及默认汇报约束在新成员创建时生效。
