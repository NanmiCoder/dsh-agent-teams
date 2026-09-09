# AgentTeams 按需协议与稳定前缀

队长会话从首次请求起保留原有 13 个业务工具和 `agent_teams_open`。普通问答、打开入口、创建/批准团队、归档团队和再次打开，都不改变插件提供的系统提示词与工具定义。详细协议按需追加到工具结果中。成员的四个团队工具和简短说明在首次模型请求前确定，并保持不变。

用户明确要求 AgentTeams、团队协作或输入 `/agent-teams` 时，模型先调用入口。入口读取当前团队摘要、可用 profile 名称、完整队长协议和选中 profile 的说明。它不创建团队、批准计划、恢复暂停、确认邮箱消息或触发调度。无团队时继续 staged 规划和显式审批；已有团队继续当前状态。模板冲突返回 `requested_profile` 和 `profile_conflict`，不会切换模板。重复打开会再次返回协议，便于冷恢复或压缩历史后的重新读取，也会增加相应工具结果的上下文。核心协议放在返回的最前面，含 JSON 转义的前缀不超过默认裁剪器保留的 4,096 字符；超大 profile 列表仍可能被裁剪。常规历史压缩也可能总结整个结果，固定短说明要求协议丢失后重新读取。

| 会话身份 | 固定团队工具 | 固定 system 内容 | 按需追加 |
|---|---|---|---|
| 普通会话、队长、冷恢复的队长 | 原有 13 个业务工具 + open | 简短入口和审批规则 | open 的详细协议、选中模板、当前团队摘要 |
| 成员 | claim、update、send_message、status | 简短成员规则和原有 persona | 原有任务分派与消息 |

业务工具只注册一次。成员范围同时适用于原生 schema 和 PTC SDK，不能解除其他用户或 preset 的限制。成员身份来自持久化成员 ID、退休成员索引或插件正在执行的可信成员创建登记，不凭可自由填写的 label 判断。HMR 清理旧插件资源并恢复身份；部署新版本本身可能改变前缀，稳定性约束针对同一配置下的业务生命周期。

## 为什么撤回动态工具加载

上一版在 open 后把 1 个工具变为 14 个，并替换系统提示词。虽然普通会话的插件字节数显著下降，但会改写历史之前的请求前缀。在用户提供的 DeepSeek 实测中，open 前缓存读占输入比例约 97.54%，下一步约 0.64%，再下一步恢复约 94.97%。这说明一次切换也可能损失已有长历史的缓存，不能仅按工具字节数判定省钱。

本版撤回这条路径。此前“96.1%”是旧方案的插件提示词加 schema 字节降幅，不是缓存命中率或实际费用降幅，也不再描述当前实现。

缓存仍受供应商策略、其他宿主内容、缓存过期等影响。这里只保证本插件的业务状态不会主动改写 system/tools，不能保证每次请求命中缓存。协议进入工具结果后会增加历史长度，入口也多一次调用；真实成本必须用真实供应商 usage 衡量。

## Web 批准通知

Web 的 Approve & Run 在批准提交并启动调度后，通过 `captain.steer` 追加插件来源的控制消息。队长空闲时开始一轮，运行时在后续步骤收到消息。消息明确说明已经批准，不要再次批准或重复派工；简短确认后结束轮次，成员报告自动唤醒队长。模型自己调用 approve 的路径已有工具返回，不额外发第二份通知。

这是已有 Web 路径漏通知的修复。用户提供的案例中，三个成员已启动，但导出时尚未发送团队报告，不能据此推断报告投递损坏。批准通知失败会记录日志，已经提交的批准不会被误报成失败；当前没有跨进程持久化重试保证。

## 开销口径

无自定义 profile，真实 Harness `0.1.2-rc.1` ToolRuntime/SystemPrompt 组装。仅统计插件 usage 和原生工具 JSON 的 UTF-8 字节；不含宿主其他内容、历史或成员 persona，不把字节换算成 token。

| 内容 | 优化前 | 当前实现 |
|---|---:|---:|
| 队长团队工具数 | 13 | 14 |
| 队长固定 usage | 7,057 bytes | 573 bytes |
| 队长固定 schema | 13,348 bytes | 13,879 bytes |
| 成员团队工具数 | 6 | 4 |
| 成员固定 usage | 7,057 bytes | 443 bytes |
| 成员固定 schema | 6,740 bytes | 4,364 bytes |

## 验证标准

`pnpm verify:capabilities` 使用真实 scoped registry 和 prompt assembly，覆盖固定前缀、用户 restriction、取消/失败、可信成员身份、暂停与模板冲突、冷恢复、HMR、PTC/both SDK、同批次创建/归档/重新打开，并用真实 ToolResultPruner 检查超大结果裁剪后核心协议完整保留。

`scripts/harness-runtime-verify.mjs` 将打包产物安装到隔离 profile，通过发布版 CLI 和真实 Loader 启动。仅外部 LLM 是确定性 fixture；工具、会话、持久化、调度和成员创建均走生产实现。模型调用必须存在于该次实际请求的工具列表，入口成功返回协议后才继续。

- `progressive-entry` 保留中文/英文自然语言、原始 slash、宿主 command registry、profile alias、`--profile` 六条路径。检查 staged 无子会话、只读重新打开、显式批准、成员执行和回报；再归档、普通续聊和重新打开。自然语言路径先进行 30 轮普通对话，对整段所有请求的 system 与 tools 哈希分别检查不变。
- `web-approval` 通过真实 HTTP 路由和宿主鉴权批准，检查队长自动收到批准消息、结束等待轮次、成员报告再次唤醒，以及重复/失败批准不产生成功通知。
- 保留 lifecycle、fallback、failure、captain-idle-wakeup 和两组冷恢复场景。

```sh
pnpm build
pnpm verify
pnpm pack --pack-destination /tmp/agentteams-artifacts
node scripts/harness-runtime-verify.mjs \
  --host-version 0.1.2-rc.1 \
  --artifact /tmp/agentteams-artifacts/nanmicoder-dsh-agent-teams-0.1.16-rc.1.tgz \
  --report-dir /tmp/agentteams-runtime-rc1
```

对 `compatibility.json` 每个支持版本使用独立 runtime/report 目录验证同一产物。报告保留实际请求快照、请求哈希、产物/fixture 哈希和业务断言；最新结果见 [verification JSON](./progressive-loading-verification.json)。

脚本模型证明入口与业务链路接通，不能证明真实模型对任意自然语言的触发准确率，也不测真实缓存和计费。真实模型 benchmark 应覆盖明确请求、一般协作请求、解释、否定、引用、长会话中途启用、归档后继续聊天和冷恢复；报告各请求的缓存读/未缓存输入、总成本与延迟。

## 本次验证结果

2026-09-09：`pnpm typecheck`、`pnpm build`、`pnpm verify`、16 项 capability 测试通过。核心协议含 JSON 转义为 3,911 字符；300 个模板名触发真实裁剪后，核心协议仍完整保留。

| Harness | 校验的 DSH 包身份数 | 最终通过场景 |
|---|---:|---:|
| 0.1.2-rc.1 | 214 | 8/8 |
| 0.1.2-alpha.5 | 214 | 8/8 |
| 0.1.2-alpha.2 | 215 | 8/8 |

三个版本各自的长会话案例均包含 30 轮普通聊天，总计 51 次模型请求，system/tools 两个哈希在本会话内始终不变。六条入口均完成规划、显式批准、任务回报、归档和重新打开。真实 Web 批准通知与成员报告分别唤醒队长；无效团队返回 404，重复批准返回 409，二者均不发成功通知。

首次完整矩阵的 Web 测试错误预期重复批准返回 400；依据既有 HTTP 契约修正为 409 后，仅重跑该场景，三个版本均通过。生产产物未变；JSON 分别保留完整批次与定向重测的 fixture 哈希和来源，未把失败批次改写为通过。

产物 SHA-256：`50d179edccfdf3b9130d991f860db4730a711152e6cdfb6acb1703e83f04aeab`。真实供应商缓存和费用仍需用户实测，不从固定 fixture usage 推断。
