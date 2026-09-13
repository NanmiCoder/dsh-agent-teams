# 复杂任务真实 DeepSeek 验证（2026-09-13）

用户指出三文件只读审查不足以证明复杂协作，因此追加真实实现、质量门禁及回归修复场景。继续使用已授权 API；CLI 与 Agent cwd 均为 `/tmp`，项目、profile、状态及验收数据在测试专属子目录。保留前一轮通过与失败记录。

| 阶段 | 状态 | 验收 |
| --- | --- | --- |
| C01 构造业务与外部验收 | completed | 初始 31 组；未实现种子失败 29 组。追加第 32 组，独立复现取消持久化失败后的幻影库存 |
| C02 真实并行实现 | completed after resume | 6 成员、10 初始任务；20 分钟窗口内业务 31/31 通过，但收尾未完成；原团队冷恢复后再用 172.847 秒完成交付，50 项成员测试通过 |
| C03 受控回归与自动返工 | completed after fix/resume | 修正缺参误报 stale 后，原流程 291.994 秒、79 次请求完成双自动 repair/再审；既有下游自动重连，32/32 外部验收通过 |
| C04 复查与交付证据 | completed | 最终包四宿主 40 路径、完整构建/验证通过；历史失败、清理越界记录、模型用量和未覆盖边界见复杂测试报告 |

项目行为包括金额精度、重复 SKU 归一化、库存原子扣减、幂等与冲突、事务回滚、持久化重启、HTTP 输入和错误处理、并发超卖防护、重复取消、CLI 与成员编写的测试。

测试代码：`scripts/fixtures/harness-complex-case.mjs`、`harness-complex-oracle.mjs`；复用真实 CLI/Loader runner 的 `--case complex`。LLM 无脚本替身，外部 oracle 不依赖模型自报通过。受控回归是明确记录的测试注入，不冒充模型自然产生的缺陷。

最终证据：[复杂测试报告](complex-test-report.md)、[阶段汇总](complex-verification/summary.json)。
