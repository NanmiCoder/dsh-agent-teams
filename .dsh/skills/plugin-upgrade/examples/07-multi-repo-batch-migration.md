# 示例 07：17 个工具插件 × 三个版本台阶的批量迁移操作手册

简体中文 | [English](07-multi-repo-batch-migration.en.md)

**场景**: omdsh-dev 组织 17 个工具/诊断插件仓库（calculator/json/time/encoding/diff/stat/schema/markdown/
csv/regex、security-audit、session-health、plugin-check、plugin-dev、tariff、sandbox-micro、toolkit）连续
三个版本台阶的宿主升级批量适配：`0.1.0-rc.8 → 0.1.1-rc.2 → 0.1.2-alpha.1 → 0.1.2-alpha.2`。与
[示例 06](06-real-world-batch-migration.md)（6 个 Web Client 插件的技术迁移实录）互补：本示例聚焦
**N 仓库的过程管理**——同步审计、批量门禁、提交推送、profile 收尾，技术触点一律引用走廊卡片与
[migration-hygiene](../references/migration-hygiene.md)，不在此重复。

**运行平面**: Host 工具插件为主；含 1 个自建 RPC 通道插件（tariff）和 profile 依赖管理。
**复杂度**: ⭐⭐⭐（过程管理）＋ ⭐（代码触点，见卡片）

## 流程总览

| 阶段 | 动作 | 依据 |
|---|---|---|
| 1 盘点 | 逐仓记录 HEAD/remote/基线；fetch + `--ff-only` 审计 | 下文常见错误 1 |
| 2 基线 | devDependencies 用 npm 发布线、peer 宽范围、代码双兼容 | [publish-playbook](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/skills/plugin-release/references/publish-playbook.md) 双兼容节 |
| 3 批量修改 | 逐仓最小 diff：版本 bump / 文档基线 / 触点代码 | 走廊卡片 + 批量 check 循环 |
| 4 提交推送 | 统一消息模板；逐仓 push；失败 rebase 后 `--force-with-lease` | 常见错误 2/3 |
| 5 profile 收尾 | `pnpm update` 重解析 github 轨、改名三处同步 | [profile-dependency-management](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/skills/plugin-release/references/profile-dependency-management.md) |
| 6 真实验证 | 目标 tag 冷启动 + 清单全 active + 一条真实行为 | 分层验证清单 |

## 1. 盘点：同步状态审计

```sh
for d in plugins/*; do
  (cd "$d" && git fetch origin && \
   git rev-parse HEAD > /tmp/before && \
   git pull --ff-only origin main && \
   git rev-parse HEAD > /tmp/after && \
   printf '%s %s\n' "$d" "$(diff -q /tmp/before /tmp/after >/dev/null && echo same || echo UPDATED)")
done
```

**常见错误 1——`same` 不等于作者已更新**：pull 显示 `same` 只说明本地已是最新，不代表远端仓库
有/没有该轮的适配提交。实战：一轮迁移中 `dsh-tool-diff` 显示 `same`，其实是它的适配提交**迟于**其他
仓库推送；如果按“已全量更新”直接开跑，就会漏掉这个仓库。审计结论必须以「每仓最后一笔提交是否
属于本轮适配」为准，而不是 pull 输出。

## 2. 基线：npm 发布线类型 + 本地 harness 验证

alpha 系不在 npm 上，公开仓库的 devDependencies 保持 npm 发布线（当时为 `^0.1.1-rc.2`），peer 用
宽范围（`<0.2.0`）覆盖未发布 cohort；代码对签名漂移的 API 用双兼容写法（例见
[publish-playbook](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/skills/plugin-release/references/publish-playbook.md) 的 `rpc.handle` 案例），保证
任意机器 `npm install` 后 typecheck 可用、alpha 运行时行为不变。

## 3. 批量修改与批量门禁

- 版本/文档基线类改动用脚本批量替换 + 逐仓 diff 复核（禁止无脑全局替换 `code` 一类语义词，见
  [A1-06 卡片](../references/v0.1.2-alpha.1.md)）；
- 逐仓跑完整门禁循环（typecheck + test + build）。**Windows 注意**：批量脚本里调用 npm 用
  `npm.cmd`，PowerShell 5.1 解析 `npm` 到 `npm.ps1` 会把参数打乱（`Unknown command: "pm"`）；
- 批量脚本里不要用 `& $数组 @另一数组` 这种调用方式（PowerShell 5.1 会把数组拼成单个命令名），按分支直接写命令。

## 4. 提交与推送

- 消息模板与历史一致：`chore(dsh): align devDependencies with dsh <v> and rebuild lib` /
  `fix(dsh): <触点描述> for harness <v>` / `docs(dsh): note harness <v> validation`；
- 逐仓 `git push origin main`；失败时：

```sh
git pull --rebase origin main          # GIT_EDITOR=true 防编辑器挂起
git push --force-with-lease origin main
```

- **常见错误 2——rebase 冲突的取舍**：本轮适配与远端迟到提交同文件冲突时，以“本轮基线为最终态”
  解冲突（实战：alpha.2 文档基线覆盖迟到的 alpha.1 提交）。解完逐仓验证再推。
- **常见错误 3——两点比较（`git diff a b`） 误读他人改动**：判断某 PR/提交“删除/回退了什么”必须用三点比较
  （`git diff main...branch`）；两点比较（`git diff a b`） 会把“分支没跟上 main 的新增”显示成删除。实战误报两例：
  把“未删除的 skill”读成删除、把“未回退的卡片措辞”读成回退——均因两点比较（`git diff a b`） 方向误读。

## 5. profile 收尾

按 [profile-dependency-management](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/skills/plugin-release/references/profile-dependency-management.md)：
`pnpm update` 重解析 github 安装轨依赖并核对锁文件 commit；包改名时三处同步、清理残留目录联接。

## 6. 真实验证（每个版本台阶都跑）

1. 目标 tag 冷启动，`pluginInventory/list` 全部本插件 entry `active`、无 `pending`；
2. 自建通道冒烟：无认证 401 / 消费 token 后 200（[DSH-0.1.2-A1-08 · Web/API 通道认证](../references/v0.1.2-alpha.1.md)）；
3. 一条真实行为：headless 任务让模型调用本插件工具（如 calculator 计算），核对 stdout 最终文本与
   stderr reasoning 归属（[DSH-0.1.2-A1-05 · headless 输出语义](../references/v0.1.2-alpha.1.md)）；
4. 结果归档：每个版本台阶留存「版本 → 各仓提交 → 验证结果」记录，作为下一个版本台阶的盘点基线。

## 与本仓库其他材料的关系

- 技术触点与卡片：见 [v0.1.1-rc.2](../references/v0.1.1-rc.2.md)、[alpha.1](../references/v0.1.2-alpha.1.md)、
  [alpha.2](../references/v0.1.2-alpha.2.md) 与 [rollup](../references/rollup-0.1.2.md)；
- 工具链坑：[migration-hygiene](../references/migration-hygiene.md)（本文不重复）；
- 发布/分发面：[publish-playbook](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/skills/plugin-release/references/publish-playbook.md) 与
  [profile-dependency-management](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/skills/plugin-release/references/profile-dependency-management.md)。
