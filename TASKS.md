# 任务表（DAG · 并行 + 依赖排序）

> 原则：**最小交付房间**——每个任务只交付一个可验收产物；能并行不串行。
> 成员统一：真 agent preset + `magpie/group/deepseek-v4.1-flash-1017` + `reasoningEffort=max`。

| id | 目标 | 交付物 | 依赖 | 可并行 | 验收 |
|---|---|---|---|---|---|
| **T1** | 环境基线：装依赖、build/verify 跑绿 | 基线日志 | — | ∥ T2 | `pnpm install` + `pnpm build` + `pnpm verify` exit 0（**注意：本项目无 `test` 脚本，`pnpm test` 是空跑，门禁用 `pnpm verify`**） |
| **T2** | 契约定稿：官方 startActivation preset 契约 + spawnMember 注入点 | 契约注记（PLAN.md 已含） | — | ∥ T1 | 注入点逐行确认 |
| **T3** | `spawnMember` 支持 `agentPreset` | `src/members.ts`、`src/harness-compat.ts` | T1,T2 | ∥ T4,T5 | 有 preset 走 mount，无 preset 回退 persona |
| **T4** | 配置扩展：`profiles.ts` MEMBER_KEYS + `tools.ts` 参数 + `types.ts` | 三文件改动 | T1,T2 | ∥ T3,T5 | profile/工具可声明 agentPreset |
| **T5** | 默认模型 deepseek max | llmSelection 默认值 + 文档示例 | T1,T2 | ∥ T3,T4 | 缺省即 deepseek/max，可覆盖 |
| **T6** | 单元测试 | `tests/` 新增 preset/model 用例 | T3,T4,T5 | ∥ T7 | 新增用例全绿、不削弱旧断言 |
| **T7** | 隔离 home Web 真机验证 | 独立 home 实例验证记录 | T3,T4,T5 | ∥ T6 | 成员挂真预设 + deepseek max 实测通过 |
| **T8** | 构建 + 全量 + 文档 + PR 草稿 | build 日志、PR 草稿 | T6,T7 | — | build exit 0、全量绿、PR 草稿待授权 |

## 并行编排

```
T1 ─┐            ┌─ T3 ─┐
    ├─→ 阶段1 ───┼─ T4 ─┼─→ 阶段2 ── T6 ─┐
T2 ─┘            └─ T5 ─┘        └─ T7 ─┴──→ T8
```

- **阶段0**：T1 ∥ T2 同时启动
- **阶段1**：T3 ∥ T4 ∥ T5 三个并行（同一批成员，各自独立文件）
- **阶段2**：T6 ∥ T7 并行（单测与真机互不依赖）
- **阶段3**：T8 收尾（等全部绿）

## 同文件单写者约束

- `members.ts` / `harness-compat.ts` → T3 独占
- `profiles.ts` / `tools.ts` / `types.ts` → T4 独占
- 默认模型与文档 → T5 独占
- 测试 → T6 独占；真机 → T7 独占；集成由 Lead 复验
