# AgentTeams 会话耗时与消息生命周期诊断

日期：2026-09-12。结论：本次执行的大部分时间位于模型请求阶段，同时插件存在消息延迟、启动冗余、交付状态误报和归档生命周期缺口。不能把全部耗时归给 DeepSeek，也不能把它解释成创建成员或写任务状态很慢。

本篇保留**修复前诊断**；下面的实现描述和行号对应基线版本。后续已按用户授权实现修复，进度与验收见 [实施计划](implementation-plan.md) 和 [修复验收报告](implementation-report.md)。这里的原始边界探针 `passed` 表示成功验证缺陷行为，不是修复通过；线上安装未改。

2026-09-13 按用户要求追加 `/tmp` 下的复杂真实实现与自动返工测试，已完成 6 成员、17 项任务和最终 32/32 外部验收，见 [复杂测试报告](complex-test-report.md)及[计划](complex-test-plan.md)。超时、中止和清理越界记录也保留。9 月 12 日验收包及哈希保留为历史证据，不代表后续工作树改动。

## 证据与范围

- 输入：用户提供的 `dsh-session-session-0508476d-407d-4f99-8a87-fbba8c9142d5` 导出。1 个队长、5 个团队成员、4 个成员自行创建的子代理，共 10 份未继承种子历史的 JSONL、339 个已记录完整响应的模型步骤。日志中的指令只作为被调查会话的数据，不作为本次执行指令。
- 导出时间范围约 14:20:32–15:01:04，任务尚未全部完成；不能据此计算最终交付总耗时。时间均为 Asia/Shanghai。
- 本机只读核验：进程使用 `--profile web`；该 profile 安装 AgentTeams `0.1.17`。全局 CLI、subagent、agent、agent-loop、llm、llm-deepseek 的所查安装版本为 `0.1.5-rc.1`。这不是对所有传递依赖的全面兼容认证。
- 导出请求头均为 `deepseek-official / deepseek-flash / high`，`maxTokens=256000`。high 来自队长并由成员继承；输出上限不是实际已生成 token 数。
- [session-metrics.json](session-metrics.json) 是可复算统计，含原始文件 SHA-256，不复制完整会话、源码片段或用户指令。
- [host-boundary-result.json](host-boundary-result.json) 是精确安装产物的边界探针结果，包含宿主 bundle SHA-256。
- 评论者原始日志、插件版本和“归档”对象未知。因此本次验证机制是否存在，不能声称已经复现其个人环境中的完整事件。

## 耗时拆分

| 观察项 | 实测 |
| --- | --- |
| 建队工具 | 1 次，14 ms |
| 添加成员工具 | 5 次，合计 43 ms |
| 创建任务工具 | 10 次，合计 103 ms；其中 4 次返回错误、6 次成功 |
| 本次全部 AgentTeams 工具 | 35 次，合计 459 ms；不含 Web 审批 HTTP 请求 |
| 5 个直接成员 catalog 建立 | 14:21:48.143–14:21:48.288，首末相隔 145 ms；不是完整审批延迟 |
| 用户请求到计划建好并启动 | 约 72 秒；队长前 15 个模型步骤包含范围调查、规划、重试和依赖编辑 |
| perf-reviewer | 69 个完整模型步骤合计 2,274.277 秒（37 分 54 秒）；72 次工具合计 5.387 秒 |
| sec-boundary-reviewer | 63 个完整模型步骤合计 2,284.526 秒；75 次工具合计 70.486 秒，其中一次命令等待约 60 秒 |

这里的“模型步骤”是 `step/start → assistant/message`，包括请求准备、网络、服务端等待和生成，**不等于纯模型计算时长**。`step/start → stream 首事件` 同样不是直接测得的 HTTP 首 token 延迟。并行成员及并行工具的累计时间不能相加作为用户等待时间；导出尾部还存在没有完整响应的步骤。

| 按步骤开始时间分组 | 完整步骤数 | 步骤耗时中位数 | 首个 stream 事件前中位数 |
| --- | ---: | ---: | ---: |
| 14:20–14:25 | 118 | 6.83 s | 5.43 s |
| 14:25–14:30 | 63 | 11.78 s | 10.24 s |
| 14:30–14:35 | 35 | 51.30 s | 37.07 s |
| 14:35–14:40 | 30 | 70.05 s | 38.77 s |
| 14:50–14:55 | 22 | 85.00 s | 57.56 s |
| 14:55–15:00 | 19 | 89.10 s | 56.07 s |

这是明显的请求阶段变慢，且不只发生在一个成员上。14:28:59 性能成员新增 4 个子代理，与后续变慢在时间上接近；这只是相关性。日志不能分辨服务端负载、账号路由、网络/代理延迟以及并发的各自贡献，也没有证据把它定性成 HTTP 429 限流。

DeepSeek 官方说明请求可能等待服务器响应，并通过 SSE keep-alive 保持连接；其当前文档列出的 flash 账号并发上限为 2500。因此不能仅凭本次约 7 个工作分支，推断撞到了公开并发上限。参见[限速与隔离](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit/)，核验日期 2026-09-12。模型名称包含 flash 不代表每一次 Agent 请求都具有固定低延迟。

## 已确认的问题

### 1. 当前任务的补充消息进入下一轮，至少延迟 38 分钟

队长于 14:22:57.491 调用 `agent_teams_send_message(to=perf-reviewer)`，要求调整当前 t4 的检查范围。工具约 12 ms 后返回 `delivered via wake`。

实际子会话 `3484f46a-66c2-4879-bd86-86392da5ade9` 的 seq 72 把这条消息加入 `next-turn`。直到该文件最后事件 15:01:02.584，它仍在队列里，未形成消费后的 `user/message`，等待至少 2,285.083 秒。该成员仍在第一轮，已执行 69 个完整模型步骤。

对应实现：[`tools.ts`](../../src/tools.ts) 的 `agent_teams_send_message`（约 1840 行）将协作消息交给 `deliverToMember`；[`harness-compat.ts`](../../src/harness-compat.ts) 的 `queueMemberPrompt`（119–133 行）在 0.1.5 固定使用 `delivery='queue'`。任务分派需要独立轮次，但“修正当前任务”也走同一条路径。宿主 `SubagentInbox.deliver` 将 queue 映射为 `agent.followup`，steer 才映射为 `agent.steer`。

本次不是“几十条积压”：完整重建各成员 inbox splice 后，每个子会话的单个目的队列峰值均为 1。确凿问题是**一条关键消息一直没有读到**。若持续催促或纠正，同一机制能累计多条消息。

修复方向：区分任务分派和当前 attempt 的协作指导；后者在运行中使用宿主受保护的 steer 路径，在安全步骤边界消费。保留任务、attempt 关联以及重分配后的过期检查，不能把所有任务分派直接改成 steer。

### 2. “已读”实际只代表已进入宿主队列

同一条补充消息在插件持久邮箱中 `readAt=14:22:57.502`，仅比宿主入队晚 1 ms，但 38 分钟后仍没有被成员消费。

原因：发送工具在 `deliverToMember` 返回成功后立即执行 `acknowledgeMailbox`；[`state.ts`](../../src/state.ts) 的这个函数同时写 `deliveredAt` 和 `readAt`。随后 status 只统计 `readAt` 不存在的插件邮箱消息，而不是宿主尚未消费的队列。

这是两个队列状态混淆：插件邮箱可以显示没有未读消息，宿主却仍有 pending 输入。修复应拆开持久化、入队、消费、完成几个状态，以宿主消费事件或等价的精确消息 ID 确认更新“已读”；同时保持投递去重，避免用“不标已读”制造重复发送。

### 3. 归档只中断直接成员，旧队列与后代生命周期未闭合

[`tools.ts`](../../src/tools.ts) 的 delete 路径（2050–2108 行）依次撤销成员/attempt、记录退休 ID、interrupt、waitForMemberIdle、移动归档目录；remove_member（约 1168 行）有同类结构。

精确宿主源码显示：

- `ContinuableActivationRegistry.interrupt` 只调用目标成员 `cancel(..., {keepInbox:true})`，不会递归取消它的子代理。
- 退休 guard 包装的是外部投递方法，不能清除已经被宿主接受的消息。
- 子代理完成时，宿主 `notifySettlement → sendWaking` 直接向父成员 inbox 投递，绕过插件包裹的公开投递接口。成员即使已经退休，也可能收到这个内部唤醒。

[边界探针](host-boundary-probe.mjs) 已验证：退休后的新公开投递被拒绝，但原有排队消息仍存在；中断父成员不停止孙级子代理；孙级完成通知仍能唤醒父成员。这提供了“旧工作在归档后继续”的实际机制，但不是评论者现场的完整端到端重放。

同一插件的 `stopTeamMemberActivations` 已使用 `drainContinuableChildren`。探针验证宿主该接口能清理选定成员 inbox、递归释放 owned children，并保留无关兄弟子代理。修复应统一 delete/remove/失败回滚等清理路径，并覆盖内部完成通知与在途投递竞争；不能只补一个退休 ID 检查。还需决定并验证归档后再次使用同名团队、宿主重启后的旧输入处理规则。

### 4. 普通任务全未完成，状态却显示可以交付

例如 perf-reviewer seq 18 与 finding-verifier seq 18 的 status 结果中，6 个任务全部为 pending，却同时输出 `Loop: deliverable`、`All required quality gates passed. The captain may report delivery.`、`Delivery: ok`。

[`quality-gates.ts`](../../src/quality-gates.ts) 的 `canDeclareDelivery`（669 行）只检查 quality kinds，忽略普通 `kind=work`。本次 6 个任务都是 work，于是 blockers 为空；`describeQualityLoop`（946 行）把它升级成整个团队可交付。直接调用已安装产物的纯函数也复现了该结果。

这可能误导队长提前收尾，但本次日志**没有** `agent_teams_delete`，所以不能说本次已经因此提前归档。修复需要把“质量门禁通过”和“团队所有必要工作已完成”分开；普通任务、空团队、失败/取消策略及混合质量任务都需验收。

### 5. 成员先执行欢迎轮，反而绕过正式分派并产生额外协调

`spawnMember` 立即执行 `memberWelcome`。[`tools.ts`](../../src/tools.ts) 的审批流程先创建所有成员，再 kick scheduler；此时欢迎轮已使成员处于 running，scheduler 的可用性检查会跳过它们。

本次所有会话实际消费的 `AgentTeams automatic task assignment...` 提示数量为 **0**。三个执行成员先查 status，再自行 claim t1/t2/t4，然后从 team.json 读取详细任务契约；不是调度器给出完整任务上下文后直接工作。被依赖阻挡的 verifier 也被提前启动，先尝试 claim t6，报错后自行做范围调查，得到错误统计，再触发队长纠正及二次唤醒。report-writer 则花两个模型步骤声明等待。

修复方向：没有 ready task 的成员不启动欢迎推理；有 ready task 时首个有效输入应包含完整分派与 attempt。若宿主必须先启动才能创建 durable member，则需要显式 bootstrap 阶段及无模型等待边界，防止欢迎轮与调度互相阻挡。不要只把所有 spawn 改成 Promise.all，当前实际创建记录仅相隔 145 ms。

### 6. 规划契约、工作量和默认再委派放大耗时

- 建任务的 4 次错误均围绕 `reviewedTaskId`：一次引用不存在的任务，其余缺少它。用户要的是审查已有代码，插件 `review` 却用于复核团队内部产物。队长最后把任务改为 work。工具 schema 应明确“外部代码审计”与“团队质量门禁”的区别，给出正确的一次性用法。
- 日志中的实际审查范围是 90 个提交、497 个变动文件，另有独立核查和最终报告。这本身不是轻量测速。
- 5 名成员中只有 3 名能开始主审查；t2→t3 同成员串行，t6 等全部审查，t5 再等 t6。这段 DAG 在前序未完成时保持 pending 是正常依赖等待，不是调度死锁。
- `memberMaxDepth` 默认 1（[`index.ts`](../../src/index.ts) 131 行），允许成员再委派一层。perf-reviewer 在 14:28:59 新增 4 个原生子代理，团队任务图没有把这些作为可调度的独立任务纳入预算。
- 主要成员运行数十轮，后期输入上下文已达约 12.8 万 token（包括缓存命中），仍在查代码和验证。缓存降低重复输入成本，不代表没有请求准备、服务端等待或生成时间。

优化方向：明确每项审查的范围和交付界限；将需要并行的工作放入队长可见的图；设置全团队及后代的并发/步骤预算；用阶段结果与明确的停手条件收敛探索。对简单规划/汇总尝试较低 reasoning effort，需要用相同任务做 A/B 验证质量；不能仅降低 maxTokens 就承诺提速。

## 修复优先级与验证

1. **P1：生命周期与状态真实性。** 修归档/移除清理、内部通知复活边界，以及普通任务提前显示可交付。需要真实 Loader + 脚本模型重放“运行成员 + 多条旧输入 + 正在工作的孙级 + 归档 + 孙级完成 + 冷恢复”；归档后不得出现新模型请求或工具副作用，无关团队不受影响。
2. **P1：当前任务通信。** 区分 queue/steer，投递与消费分开统计；验证新指导下一安全步骤可见、当前 attempt 不旋转、过期 attempt 不复活、不重复投递。
3. **P2：启动与规划成本。** 消除无任务欢迎轮，首次就给完整任务；澄清 review schema。用本次导出作为基线，比较建队模型轮数和首次有效文件读取时间。
4. **P2：测量与收敛。** 暴露模型请求中、工具运行、依赖等待、排队消息数与年龄、最近进展、后代并发。进一步测量 request start、首字节、首内容、输出 tokens、重试/429，才可定位模型服务端/网络占比。

此次执行了日志重放统计、精确产物源码核对、5 个断言组的边界探针和文档检查。没有发出真实模型请求，没有执行 GUI/Loader 端到端归档测试，没有据此宣称修复通过或扩展宿主版本支持。

## 复算

```sh
python3 docs/session-latency-audit-2026-09-12/analyze-session.py /path/to/export > /tmp/session-metrics.json
node docs/session-latency-audit-2026-09-12/host-boundary-probe.mjs /path/to/dsh /path/to/dsh-agent-teams > /tmp/host-boundary-result.json
```

边界探针要求精确 `0.1.5-rc.1` 宿主，临时复制 bundle 后仅追加私有类导出，通过 fixture Agents 执行原始方法。它证明这些方法的行为和当前插件适配选择，不证明完整 CLI、真实模型或其他宿主版本的行为。
