# v0.1.17 发布验证

本版包含 Harness 主题适配，发布目标为 npm `latest`，推荐宿主 `0.1.5-rc.1`。保留 `0.1.2-rc.1`、`0.1.2-alpha.5`、`0.1.2-alpha.2` 三个旧目标。

主题修改与 Ego Lite 验证见[主题报告](../../theme-support-2026-09-11/README.md)。此前真实 API 团队行为验收见 [rc.1 记录](../v0.1.17-rc.1/README.md)；本次复用其会话进行界面测试，没有新增模型调用。

发布 Action 必须通过 Ubuntu / Windows 静态验证及四版本真实宿主回归，再发布同一份通过验证的 tarball。自动化模型为确定性 fixture，Windows job 覆盖静态检查，不能等同于 Windows Desktop GUI 验收。最终 Action、registry 完整性和消费者验证结果在发布完成后补充。
