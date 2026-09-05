# 项目维护 Skills

本目录是 canonical source。`.dsh/skills/` 是完整文件镜像，`.agents/skills/` 通过相对符号链接供 Codex 发现。修改本项目自己的 skill 后运行 `pnpm sync:skill`；`pnpm verify:skill` 检查每个 skill 的正文、references、scripts、examples 和其他随附文件。

## 来源与更新

新增 9 个 skill 来自 [oh-my-dsh/dsh-plugin-upgrade-skill](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/tree/cd4d497588cdd4f16300622779b62a78fe803169)，固定 commit `cd4d497588cdd4f16300622779b62a78fe803169`，取入日期 2026-09-06。115 个上游文件保持原样。来源清单及每个文件的 SHA-256 见 [upstream-lock.json](upstream-lock.json)，MIT 许可见 [LICENSE.dsh-plugin-upgrade-skill](LICENSE.dsh-plugin-upgrade-skill)。

项目原有 `dsh-plugin-development` 单独维护；其历史 API 示例已加适用范围说明，不包含在上游 hash 清单中。

更新时先审阅明确 commit 的差异，再更新 skill 目录、来源清单和镜像，并保留清单中 4 个上游脚本的执行权限。不要自动追随上游 `main`。同步器会报告额外镜像文件和已从 canonical 删除的旧 skill 目录，不会自动删除；须审阅来源后单独处理。新增或删除 skill 时也要同步 `.agents/skills/` 的发现链接。

这批资料是开发维护工具，不是运行时依赖；当前 npm `files` 清单不包含这些目录。上游完整 benchmark 保留在独立 clone，不复制进应用。此次 clone 位于 `/tmp/dsh-plugin-upgrade-skill`；用户指定的 `/gmp` 因 macOS 根文件系统只读而不可创建。临时目录丢失后，可按以上固定 SHA 重新克隆。

## 使用入口

| 任务 | 项目内 skill | 用法 |
| --- | --- | --- |
| 统一编排 | [plugin-workflow](plugin-workflow/SKILL.md) | 组织阶段、验收项和状态；不凭空推定阶段已通过 |
| 版本影响与迁移 | [plugin-upgrade](plugin-upgrade/SKILL.md) | 版本变更链、只读扫描、迁移计划和实现验证 |
| 官方契约核对 | [dsh-upgrade-audit](dsh-upgrade-audit/SKILL.md) | 精确 tag/源码或 npm 产物对比，补全版本卡遗漏 |
| 产品与包测试 | [plugin-test](plugin-test/SKILL.md) | 七类触点、真实宿主加载、tarball smoke 和自定义功能探针 |
| 打包发布 | [plugin-release](plugin-release/SKILL.md) | 产物闭包、发布一致性检查；必须遵守下方项目规则 |
| 编写插件 | [plugin-write](plugin-write/SKILL.md) | 目标接口、命名、配置与开发模板 |
| 运行问题 | [plugin-runtime-debug](plugin-runtime-debug/SKILL.md) | 实际加载版本、服务、UI 和状态诊断 |
| 大型前端依赖 | [plugin-heavy-dep](plugin-heavy-dep/SKILL.md) | 按需处理分包、加载与交互边界 |
| 构造迁移评测 | [dsh-benchmark-case](dsh-benchmark-case/SKILL.md) | 将真实故障整理为 Harbor 题；执行还需上游完整 benchmark 仓库 |

同名全局 skill 可能来自其他来源或版本；本项目任务明确读取上表的项目路径。用户当前已授权的任务不需要因为上游通用模板再重复征求确认；新增超出任务范围的发布等动作按会话指令处理。交互式浏览器操作使用 Ego Lite，遵守项目 `AGENTS.md`。

## 本项目的适用规则

1. **版本卡是线索，不是完整 API 差异。** 当前库没有 `registerContinuableSetup`、`followup`、`sendMessage` 的专项迁移指导。`report → send_message` 工具卡不等同于子代理 runtime API 迁移。#130 必须继续用精确官方实现和本项目生命周期测试核验。
2. **宿主、插件、发布渠道分别记录。** GitHub tag 不代表 npm 已发布；宿主 `latest` 与插件 `latest` 不保证兼容。普通用户默认组合只能来自 AgentTeams 验收矩阵；Alpha 预览须显式选择。
3. **精确 CLI 版本还不够。** 固定并检查完整宿主依赖闭包和实际 profile。不要将 `npm install -g @deepseek-ai/dsh@<exact>` 视为所有分包已固定，也不要把宽 peer 范围当作支持承诺。
4. **发布文档中的历史基线不直接采用。** 当前导入版本仍出现“npm 基线 0.1.1-rc.2”“所有 0.1.2-alpha.* 未发布”和宽 peer `<0.2.0` 的陈旧或矛盾说明。以当次 registry 查询、精确产物和实测矩阵为准。
5. **发布校验需包含宿主支持证据。** 上游 `verify-release` 只校验插件自身版本/标签；无后缀插件可能仍然只支持 Alpha 宿主。通过该脚本不能直接进入 `latest`。它还强制无后缀版本使用 `latest`，因此并不支持所有候选包推广流程。
6. **回退要区分对象。** Git tag、GitHub release、npm tarball、dist-tag、用户 profile 和持久化数据是不同对象。不要套用“删除/重指向 Git tag”来回滚 npm 包或用户安装。
7. **测试通过要说明范围。** 52 道 Harbor 题测 AI 的迁移能力，不是 AgentTeams 的 52 项回归。Docker ready 或 HTTP 200 只证明特定启动条件；发布需要插件激活、队员唤醒/执行/回报、模型与推理力度、失败收尾、恢复和 UI 的项目探针。
8. **只读扫描避开维护资料本身。** planner 会扫描代码、配置和脚本，也会命中 vendored skills 的示例。分析生产仓库时使用清楚标识的源码快照，或逐条排除这些维护资料带来的结果；零命中不等于没有风险。

统一治理方案见 [兼容性与发布生命周期审查](../docs/compatibility-audit-2026-09-05/README.md)，本次研究与扫描证据见 [升级 skill 接入研究](../docs/upgrade-skill-study-2026-09-06/README.md)。二者均为审查/方案，不能视为已完成兼容修复或渠道发布。
