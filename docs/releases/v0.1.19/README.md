# v0.1.19 验收记录

基线为 npm/Git tag `v0.1.18`，本轮原始 main 为 `afef290`。逐项验证 PR #155、#167、#172、#180；真实模型为本机配置的 `deepseek-official/deepseek-flash`，精确 Harness `0.1.5-rc.1`。启动目录沿用仓库工作目录，测试业务文件与隔离 profile 位于 `/tmp`，不更改用户 profile 或复制凭据。

## 首轮结果与证据保留限制

首轮真实 API 执行已观察到以下结果，但中断期间 `/tmp/agentteams-issue-validation-20260917` 被清理，原始日志不再可用。下表来自执行时返回的结果，不能冒充可下载的原始证据。最终候选另外复验，结果另存。

| 场景 | 原版 0.1.18 | 原始 main 候选 |
| --- | --- | --- |
| 宿主委派工具改名 | 6 次队长请求，0 次成员请求，全部 unspawned | 55 次请求，39 次成员请求，三项任务与外部文件断言通过 |
| 宿主委派工具禁用 | 5 次队长请求，0 次成员请求，全部 unspawned | 49 次请求，31 次成员请求，三项任务与外部文件断言通过 |
| finding.file 与 requiredFix 目标不同 | 自动 repair 缺少 README.md 范围 | 58 次请求，26 次成员请求，自动修复及复审完成 |
| 队长修订错误范围 | 无该工具 | 17 次请求，6 次成员请求，原任务完成、修订历史持久化、成员不可见 |
| 自动 repair 继承 README.md 排除 | 未修复 | 37 次请求，21 次成员请求；真实报错 `README.md is out_of_scope`，修复任务失败、复审阻塞 |

另完成 Ego Lite Web 真实 API 冒烟：已有工作目录、计划审批、成员启动、`/tmp` 文件 `WEB_OK\n` 写入、成员会话导航与活动面板完成状态。没有文件夹选择器。截图随原 `/tmp` 清理丢失；不能将其作为最终包的新截图证据。

## 新发现与修复

- `e6a40c4`：PR #155 的两组测试未进入 `pnpm verify`；独立 worktree 修复并验证，已合回 main。
- `6cc84f6`：先提取全部修复目标，再去除生成契约中相冲突的继承排除规则；保留手工契约排除优先语义。复用 PR #177 的生成器逻辑并保留贡献者署名。新增 F_DOC、目录冲突、fallback 去重回归在原代码变红、修复后变绿。
- 旧轮次的 review acceptance 可能含陈旧判定要求，作为独立边界保留，不通过通用文本改写掩盖。

## 可复验入口

先准备精确闭包的 Harness runtime，再运行各场景；真实 API 凭据由现有配置读取。每次使用新的 report 目录。

```sh
node scripts/harness-runtime-verify.mjs --host-version 0.1.5-rc.1 --prepare-only --report-dir /tmp/agentteams-runtime
node scripts/harness-issue-verify.mjs --scenario repair-conflict --runtime-dir /tmp/agentteams-runtime/runtime --artifact /tmp/candidate.tgz --report-dir /tmp/repair-conflict-check --agent-cwd "$PWD"
```

场景为 `renamed`、`disabled`、`repair`、`repair-conflict`、`amend`。模型响应没有脚本化；断言读取真实任务状态、修订历史、成员请求和工作区文件。CI 的四宿主矩阵另外使用确定性模型 fixture，不等同真实 API。

本机 Docker daemon 不可用；Windows/Desktop GUI 和其他模型未验证。发布必须等待最终真实场景以及 GitHub Action 门禁完成。

## 最终候选复验

最终 runtime 文件逐字节一致性见 `artifact-comparison.json`；初始候选与发布包只相差新增 release notes，79 个 runtime 文件完全一致。

| 独立真实 API 场景 | 结果 | 请求数 | 证据 |
| --- | --- | --- | --- |
| 宿主工具改名 | 通过，成员写文件并完成任务 | 15 | `renamed.json`、对应 trace |
| 宿主工具禁用 | 通过，成员写文件并完成任务 | 14 | `disabled.json`、对应 trace |
| 队长修订契约 | 通过，原任务完成、修订历史落盘 | 20 | `amend.json`、对应 trace |
| requiredFix 独立修复目标 | 通过，自动 repair 与复审完成 | 47 | `repair.json`、对应 trace |
| 继承范围冲突 | 通过，原 implementation 确实排除 README，自动修复移除冲突且完成复审 | 46 | `repair-conflict.json`、对应 trace |

失败尝试保留：两次测试把“exactly 2 words”解读为 `hello world`，运行时任务完成但字面文件断言失败；改用明确字面内容后复验通过。另一次模型先建 work 占位任务，自动 repair 未继承预设排除条件；原 runner 虽报告通过，但该次不计验收，补上来源类型和原始排除断言后重新通过。

本地 typecheck/build/完整 verify 通过。最终包精确 `0.1.5-rc.1` 产品入口十项回归通过，见 `runtime-0.1.5-rc.1.json`；这十项使用模型 fixture，与上表真实 API 证据分开记录。

`0.1.2-rc.1` 的真实 DeepSeek API 工具改名场景亦通过（15 次请求，成员实际执行、文件内容和任务完成均通过），见 `legacy-renamed.json`。这覆盖 #163 所报的旧宿主核心条件，不等于完整 Desktop GUI 验证。
