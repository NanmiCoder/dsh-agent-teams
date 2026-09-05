# PR #130 review

Reviewed on 2026-09-05, head `620daa33c8dd813198451fb3fdfa46bd5a3b5bd6`, base `232a338fc9`.

本附件复制自隔离复现目录 `/tmp/dsh-pr130-review.uy7EDv`；下文测试命令均以该目录为工作目录。测试脚本与编译产物留在该临时目录，本附件不表示仓库业务源码已经修复。

结论：消息 API 探测方向正确，但目前不建议原样合并；这不是完整的 rc.1 兼容，也不能解决所有未来宿主升级适配。

## Findings

1. **P1 — src/members.ts:808：退役守卫丢失方法的接收对象。** 原实现使用 `followup.call(runtime, ...)`，PR 改成 `send(...)`。实际 Alpha.2 的 `SubagentRuntime.followup` 依赖 `this.requireContinuations()`。使用真实 Cordis 和 SubagentRuntime、仅替换其 continuation manager 的定向复现：安装守卫前投递 true；PR 守卫下返回 false，日志 `TypeError: Cannot read properties of undefined (reading 'requireContinuations')`；保留接收对象后恢复 true。现有测试桩的 followup 不使用 this，因此全套测试未发现。应保留 `send.call(runtime, ...)` 或等效绑定，并覆盖实际服务对象。

2. **P1 — src/members.ts:376–390：rc.1 的提前返回同时禁用了失败处理和备用模型切换。** 缺少 registerContinuableSetup 时，整个后续注册逻辑都不会执行，包括 agent/error 的任务失败落盘、队长通知和调度收尾，以及 agent/request-error 的 fallback。最近 #110 的失败处理因此在 rc.1 分支失效。把现有 lifecycle 测试的服务表面改为 sendMessage、去掉 registerContinuableSetup，并相应更新三处测试直调后，原有三个失败场景检查失败：任务失败收尾、队长邮箱通知、失败后残留消息投递。需要将这些行为迁移到 rc.1 支持的生命周期入口，而不是直接跳过。

3. **P2 — src/members.ts:376–390 / 641–644：显式 reasoningEffort 丢失。** 原 setup 用 installModelSelection 安装完整选择；rc.1 分支禁用 setup，而 spawn 的 agentOptions 只带 provider/model。指定 high 的定向探针捕获到的请求仅为 `{provider:"p",model:"m"}`。rc.1 官方 resolveChildAgentOptions 在同路由时继承父模型力度，换路由则清除未明确传入的力度；因此成员明确选择的力度可能被父设置或默认值替代。rc.1 应通过 agentOptions.reasoningEffort 传入，校验冷恢复也保留该值。

## Verification

- PR 原始代码，隔离 Alpha.2 依赖：`pnpm typecheck`、`pnpm build`、`pnpm verify` 全部通过。
- `node scripts/review-runtime.mjs`：真实 Alpha.2 服务方法接收对象问题及 rc.1 形状的力度参数探针。
- `node scripts/review-rc1-lifecycle.mjs`：沿用原有业务断言，切换宿主 API 形状，3 项失败；这是可控 fixture，不是 rc.1 真机验收。
- 读取官方 rc.1 发布说明、tag 源码及已发布 Alpha.2 / rc.1 的 dsh-subagent npm 包核对接口。
- 没有进行完整 rc.1 宿主、真实 LLM 或浏览器验收；不能将上述 fixture 结果表述为真机验收。
- 用户工作区源码与已有未跟踪文件未改动；验证代码仅在本临时目录。

## Scope

近期 `bf50b49` 的 Alpha.2 迁移涉及 client-runtime 移除、UI 事件服务、导入和包注入、Web 路由鉴权、依赖与构建共 15 个文件。#130 只修改 members.ts 和两份 README，不覆盖这些独立兼容面，也未增加 rc.1 测试矩阵。

建议修复上述问题后，作为 Alpha.2/rc.1 消息与生命周期兼容补丁合并。长期将宿主差异收敛到集中适配层，并为明确支持的宿主版本运行契约测试和基本业务流程验收；探测一个方法名不能保证未来不再需要适配。

Sources:
- https://github.com/NanmiCoder/dsh-agent-teams/pull/130
- https://github.com/NanmiCoder/dsh-agent-teams/issues/131
- https://github.com/NanmiCoder/dsh-agent-teams/commit/bf50b49e89ac92ebf6ca414221904b8cc452409b
- https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1
- https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-rc.1/packages/subagent/subagent/src/child-agent.ts
