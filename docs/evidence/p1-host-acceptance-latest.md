# P1 真实宿主验收证据

生成时间：2026-09-04T07:26:28.460Z
工作区：D:\dsh-agent-teams-ddb

本报告由 scripts/p1-host-acceptance.mjs 生成。它不替代真实宿主证据，不调用 scripts/release-verification.mjs，也不删除 acceptance 日志。未在当前环境验证的能力保持 BLOCKED。

## 本地 deterministic Harness

| 检查 | 退出码 | 状态 |
| --- | ---: | --- |
| deterministic verify:product-e2e | 0 | PASS |
| deterministic verify:project-persistence | 0 | PASS |
| deterministic verify:project-route | 0 | PASS |
| deterministic verify:project-gate-materialization | 0 | PASS |

deterministic 结果只证明当前 fixture/本地 Harness 的行为，不推导真实浏览器、真实模型、真实宿主确认或升级/回滚已经通过。

## 真实宿主证据

| 能力 | 状态 | 覆盖场景 | 证据 |
| --- | --- | --- | --- |
| 真实 Harness | BLOCKED | Greenfield；Brownfield dirty/clean；澄清；需求/设计确认；DAG；Review needs_revision → repair/re-review；accept/deliver；冷启动；迁移/回滚 | 未启用真实宿主执行；必须显式设置 P1_RUN_REAL_HOST=1。 |
| 真实浏览器 UI | BLOCKED | 真实 Captain 交互、用户确认、门禁展示、进度和交付结果；需要浏览器 trace 或录屏 | 未启用真实宿主执行；必须显式设置 P1_RUN_REAL_HOST=1。 |
| 真实模型 | BLOCKED | 自然语言目标理解、关键歧义提问、需求/设计产出、Review 修复；需要请求/响应审计和模型版本 | 未启用真实宿主执行；必须显式设置 P1_RUN_REAL_HOST=1。 |
| 升级/回滚 | BLOCKED | 旧 project/team schema 迁移、备份、迁移失败隔离、恢复、回滚后冷启动和再次读写 | 未启用真实宿主执行；必须显式设置 P1_RUN_REAL_HOST=1。 |

## 发布判定

- deterministic Harness：PASS
- 真实宿主证据：BLOCKED
- P1 总体：BLOCKED / NO-GO

真实宿主执行必须提供受控 Harness、浏览器 trace/录屏、模型请求与响应审计、迁移前后快照及回滚后冷启动日志；缺任一项不得改写为 PASS。
