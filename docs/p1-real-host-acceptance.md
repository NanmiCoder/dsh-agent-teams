# P1 真实宿主验收准备

本清单准备真实 Harness、真实浏览器 UI、真实模型和升级/回滚的可执行证据路径。它不把 deterministic fixture 的成功伪装成生产宿主通过，不调用或修改 P0-3 的 scripts/release-verification.mjs，也不删除 acceptance 日志。

## 运行方式

在仓库根目录执行：

~~~powershell
node scripts/p1-host-acceptance.mjs
~~~

运行器会顺序执行 package.json 中已存在的 deterministic 检查（优先包括 verify:product-e2e），并把每个退出码和状态写入 docs/evidence/p1-host-acceptance-latest.md。真实宿主默认不执行；当前未提供宿主适配器或证据文件时明确输出 BLOCKED 并以退出码 2 结束。

退出码含义：0 表示 deterministic 检查与已提供的宿主命令/证据均成功，但仍需人工审阅；1 表示 deterministic 或宿主命令失败；2 表示尚有宿主能力无法在当前环境证明。

## 宿主适配器契约

只有在宿主已准备好并显式设置 P1_RUN_REAL_HOST=1 时，运行器才执行下列命令。每个命令必须配套一个非空证据文件；命令退出码不能单独构成发布证据。

| 能力 | 执行命令变量 | 证据文件变量 | 必须覆盖 |
| --- | --- | --- | --- |
| 真实 Harness | P1_REAL_HARNESS_CMD | P1_REAL_HARNESS_EVIDENCE | Greenfield、Brownfield dirty/clean、澄清、需求/设计确认、DAG、Review needs_revision → repair/re-review、accept/deliver、冷启动、迁移/回滚 |
| 真实浏览器 UI | P1_REAL_BROWSER_CMD | P1_REAL_BROWSER_EVIDENCE | Captain 交互、用户确认、门禁展示、进度和交付结果；需 trace 或录屏 |
| 真实模型 | P1_REAL_MODEL_CMD | P1_REAL_MODEL_EVIDENCE | 自然语言目标、关键歧义提问、需求/设计、Review 修复；需 provider/model、请求与响应关联 ID 及脱敏审计 |
| 升级/回滚 | P1_UPGRADE_ROLLBACK_CMD | P1_UPGRADE_ROLLBACK_EVIDENCE | 旧 schema、迁移备份、迁移失败隔离、恢复、回滚后冷启动和再次读写 |

PowerShell 示例（占位命令不会被当作通过）：

~~~powershell
$env:P1_RUN_REAL_HOST = '1'
$env:P1_REAL_HARNESS_CMD = '<controlled-harness-command>'
$env:P1_REAL_HARNESS_EVIDENCE = '<absolute-path-to-harness-evidence>'
$env:P1_REAL_BROWSER_CMD = '<controlled-browser-command>'
$env:P1_REAL_BROWSER_EVIDENCE = '<absolute-path-to-browser-trace>'
$env:P1_REAL_MODEL_CMD = '<controlled-model-command>'
$env:P1_REAL_MODEL_EVIDENCE = '<absolute-path-to-model-audit>'
$env:P1_UPGRADE_ROLLBACK_CMD = '<controlled-migration-rollback-command>'
$env:P1_UPGRADE_ROLLBACK_EVIDENCE = '<absolute-path-to-migration-evidence>'
node scripts/p1-host-acceptance.mjs
~~~

宿主证据文件至少应包含：运行版本、提交或工作区快照、开始/结束时间、场景结果、失败日志位置和人工核验人。浏览器还需 trace/录屏；真实模型还需 provider/model、请求与响应关联 ID 及脱敏审计；迁移/回滚还需迁移前备份、失败隔离目录、回滚后 schema/status 快照和冷启动日志。不要把 token、密钥或未经脱敏的用户数据写入仓库。

## deterministic 覆盖矩阵

本地 deterministic Harness 必须逐项留下可复现结果：

1. Greenfield 初始化、Captain 澄清和用户确认需求/设计。
2. 实施计划的 DAG 调度与依赖顺序。
3. Review needs_revision 后只能按顺序进入 repair，再进入 re-review，不能由 fixture 直接写最终状态。
4. accept/deliver、冷启动恢复和 Brownfield dirty/clean 基线处理。
5. 旧 project/team schema 的迁移、损坏状态隔离、备份与恢复路径。

本地结果见 docs/evidence/p1-host-acceptance-latest.md。如果某项没有对应 deterministic 入口，必须保持 BLOCKED，不得用手工观察代替可复现证据。

## 人工 Go/No-Go 清单

- [ ] 宿主适配器固定工作区、版本、配置和隔离临时目录。
- [ ] dirty Brownfield 的未提交修改被识别、保护，并留下基线快照。
- [ ] clean Brownfield 的 manifest、构建和测试入口可审计。
- [ ] 澄清和需求/设计确认确实由用户/宿主确认完成，而不是 fixture 注入。
- [ ] DAG 的依赖、Review → repair → re-review 顺序有宿主 trace。
- [ ] accept/deliver 结果和冷启动后状态可由独立进程复核。
- [ ] 迁移失败被隔离，备份可读取，回滚后可以冷启动并再次读写。
- [ ] 真实浏览器、真实模型、真实 Harness 的证据与当前版本绑定。
- [ ] 所有 BLOCKED 项均有责任人、所需环境和下一步，不得标记为通过。

在清单全部完成并由人工审阅证据前，结论保持 BLOCKED / NO-GO。本文件只准备 P1 证据路径，不修改核心门禁源码。
