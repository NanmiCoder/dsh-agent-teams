# 升级 Skill 研究与接入

2026-09-06。按用户要求暂停兼容实现，使用两个 SubAgent 分别研究 README/技能边界、benchmark/测试工具，再由主任务核对并进行只读迁移扫描。

**结论：值得复用这套社区维护工具，但它不能直接修好 #130，也不能替代 AgentTeams 的版本支持政策和产品回归。** 下一阶段宜在原治理方案中复用其审计、扫描、验收方法，集中补本项目缺少的兼容契约，不必另造一套通用升级流程。

## 已完成的接入

- 上游仓库：[dsh-plugin-upgrade-skill](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/tree/cd4d497588cdd4f16300622779b62a78fe803169)。固定 SHA：`cd4d497588cdd4f16300622779b62a78fe803169`。
- `/gmp` 无法创建：系统返回 `Read-only file system`。替代 clone：`/tmp/dsh-plugin-upgrade-skill`，包含完整 benchmark 和历史。
- 项目 `skills/` 引入 9 个完整目录、115 个原始文件，保留 MIT 许可及文件 SHA-256 清单。通过 `.dsh/skills/` 镜像和 `.agents/skills/` 链接使用。
- 同步器扩展到完整目录内容，包含脚本、引用、示例与二进制资源；不会自动删除镜像额外文件。
- 项目旧开发 skill 标注历史 API 范围，修正“无 tag、不固定版本”和复用 checkout 时 reset 的旧建议。
- 项目使用规则独立记录，9 个上游 skill 内容未改。没有升级 Harness、改动插件运行时代码或依赖、发布包、合并 PR 或运行真实模型。

入口：[项目 skills 使用说明](../../skills/README.md)。两个独立报告：[README 与接入审查](skills-review.md)、[benchmark 与测试审查](benchmark-review.md)。

## 仓库提供了什么

| 已核实内容 | 价值 | 边界 |
| --- | --- | --- |
| 9 个 skill、8 组版本卡、58 张卡 | 组织升级、审计、测试、发布流程 | 社区 curated 知识库，不是官方兼容认证 |
| 52 道 Harbor 题：19 静态、33 实操 | 衡量 AI 对迁移场景的处理能力 | 不是 AgentTeams 52 项回归；公开成绩来自历史子集 |
| 只读 migration planner | 输出版本链、文件触点、候选卡 | 启发式扫描，未覆盖全部 API |
| plugin-test tarball smoke | 隔离宿主、真实安装入口、证据记录 | 仍需完整依赖锁及 AgentTeams 功能探针 |
| 发布版本/tag 检查 | 避免插件预发布误打 latest | 未检查宿主支持矩阵；部分文档基线过时 |

公开评测不是“有 skill 就能迁移成功”的证明：例如完整真实插件 H22 题的公开 with-skill 得分仅 0.08，对照 0.11；作者披露了结果和限制。运行仓库自检也不等于执行了全部题目的真实宿主验收。

## 在 AgentTeams 主分支上的只读试用

输入为 `origin/main` 的 Git archive，commit `232a338fc9a0d393f118912386f67e7f3a6c67d6`，不是本地 `0.1.15` checkout，也不是 PR #130 分支。使用干净快照避免新安装的 skills 示例、审查文档和本地未跟踪文件污染结果。

```sh
node skills/plugin-upgrade/scripts/plan-migration.mjs \
  --root /tmp/dsh-skill-study.PvGjEI/source \
  --from dsh-v0.1.2-alpha.2 \
  --to dsh-v0.1.2-rc.1 \
  --format json
```

完整原始输出：[migration-plan.json](migration-plan.json)。扫描退出码 0，读取 44 个文件，在 7 类触点中识别 6 类、32 处模式匹配，输出 8 张候选卡和 2 张待人工审查卡；版本链经过 Alpha.3、Alpha.4、Alpha.5 到 rc.1。输出的 `gaps: []` 只代表卡片版本链可连通，不代表完整覆盖所有 API。

结果体现了它的价值，也直接暴露边界：

- 能提醒 Session 事件读取、seq/offset、工具与存储版本等迁移面。
- `src/members.ts` 没有进入触点命中列表，但这个文件正包含 `registerContinuableSetup`、旧 `session.events`、`followup` 调用和方法覆写。候选 Session 卡是因其他文件的宽泛触点被选出，不能认为扫描器找到了这一处具体缺陷。
- 全部版本卡没有 `registerContinuableSetup`、`followup`、`sendMessage` 的专项迁移规则；`report → send_message` 是模型可见工具替换，并不是 #130 的运行时消息语义。
- 一部分命中来自构建/验证脚本或锁文件，不一定要求修改业务源码。8 张候选卡也不是 8 个已确认缺陷，应逐条建立证据。

因此 #130 的 receiver 丢失、setup 被跳过后的失败处理和 reasoningEffort 问题，仍以此前 [PR 复现记录](../compatibility-audit-2026-09-05/pr-130-reproduction.md) 为依据。

## 如何修订统一方案

| 阶段 | 复用社区能力 | AgentTeams 自己维护的内容 |
| --- | --- | --- |
| 基线与契约审计 | dsh-upgrade-audit；精确 tag/产物对比 | 当前支持组合、完整解析树、API 签名与语义变化 |
| 迁移计划 | plugin-workflow + plugin-upgrade | 合并 #119/#124/#130 的重叠适配；补齐遗漏的 subagent 生命周期 |
| 源码验证 | plugin-test 七触点与测试台账 | 消息队列/receiver、初始化与失败通知、模型/effort、退出与恢复等回归 |
| 消费端验收 | plugin-test tarball smoke | 固定整个宿主依赖树，加入插件激活和关键业务探针，单独验证 UI/Windows |
| 发布与推广 | plugin-release 的产物/版本检查 | 宿主通道资格、支持矩阵、latest/next 政策、可恢复的 profile/依赖锁 |
| 长期积累 | dsh-benchmark-case | 优先提炼 1–3 个真实故障，保留已知坏实现与修复后的正例 |

下一阶段仍优先产出经完整验收的 rc.1 配套插件；这次引入工具没有改变该建议，也没有把任一旧版或 Alpha 自动提升为普通用户推荐版本。版本数据是前一日审查快照，实际实施前重查 registry。

## 已执行的验证

- 上游 9 skills / 58 cards、链接与结构校验；52 题注册表及执行契约；2 个 checkpoint manifests；2 个冻结评估快照：通过。
- runtime 用例定义检查：通过，实际为 1 case / 3 checks。
- smoke runner 与 H11/H20 评分 helper 的 29 项本地单测：全部通过。
- 安装后的 migration planner、runtime verifier、workflow planner 自检：通过。runtime verifier 自检使用本地测试替身，不是真实宿主验收。
- 项目 skills 与固定 SHA 的 115 个上游文件逐字比对、4 个上游脚本执行权限、10 个 Codex 发现链接检查：通过。
- `pnpm sync:skill`、`pnpm verify:skill`：通过，10 个 skill、116 个随附文件镜像一致。临时目录实验确认嵌套二进制资源和执行权限可复制、缺失/变更的 reference 或执行位会失败、额外文件及整个孤儿 skill 目录会保留并报告；`git diff --check` 通过。

没有运行 Docker、Harbor 模型评测、52 道题目的真实执行或 AgentTeams rc.1 验收。研究报告中的源码行号基于本次固定 SHA；临时 clone 被清理后仍可用相同 SHA 重建。
