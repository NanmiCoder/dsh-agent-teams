# AgentTeams 在 DeepSeek Harness 0.1.5-rc.2 上的验收记录

日期：2026-09-18。结论：**AgentTeams 0.1.20 在 Harness 0.1.5-rc.2 上实测可用**，建议将 `0.1.5-rc.2` 纳入支持矩阵（本 PR 以 `preview` 轨道加入）。

## 宿主差异评估

官方 [dsh-v0.1.5-rc.2 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2)显示 rc.1 → rc.2 仅含两项 UI 体验改动（反馈提交弹窗、交付文件卡片排版），无子代理、会话、工具注册等运行时契约变更。完整 diff：
https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.5-rc.1...dsh-v0.1.5-rc.2

## 实测证据（真实运行，非静态推断）

环境：macOS（darwin-arm64），`@deepseek-ai/dsh@0.1.5-rc.2`（npm 全局安装，`dsh web` 模式），`@nanmicoder/dsh-agent-teams@0.1.20`（pnpm 安装于 web profile）。

1. **成员 spawn 恢复**：0.1.18 在该宿主上每个成员均 spawn 失败（`unspawned`、attempt 空转、错误仅入 `logger.warn`，即 #164/#166）；升级到含 #167/#172 修复的 0.1.20 并重启宿主后，同一团队的 3 个成员全部成功 spawn 并进入 `working`。
2. **任务派发与认领**：`pending → claimed → in_progress → completed` 全链路实测通过；两个研究类任务（work 类）由成员自主 claim 并完成，`attempt_id` 更新被正确接受。
3. **邮箱与唤醒**：captain → member 消息以 `wake` 模式送达并触发成员新轮次；member → captain 报告正常送达。
4. **静态检查**：`node scripts/doctor.mjs --host-root <dsh 0.1.5-rc.2 安装目录>` 通过（231 个 DSH 包身份与依赖检查）；`node scripts/compatibility.mjs && node --test scripts/compatibility.test.mjs` 通过。

## 范围声明

- 本次验收覆盖 web profile 下的团队创建（approval=required）、成员 spawn、任务派发/认领/完成、邮箱唤醒；未覆盖 cold resume、shutdown 恢复、HMR 重载与多团队并发。
- `0.1.5-rc.1` 仍为推荐宿主（`recommendedHost` 未变）；rc.2 以 `preview` 轨道加入，是否提升为推荐由维护者决定。
