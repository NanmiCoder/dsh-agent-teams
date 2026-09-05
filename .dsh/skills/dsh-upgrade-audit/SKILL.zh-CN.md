[English](SKILL.md) | 简体中文

# dsh-upgrade-audit

审计两个 DSH 版本之间**仓库外消费者**可观察的一切变化，并写出用户期望的报告集。这个问题的固定形态是：*相对 from 而言，to 是否有更多的改动或者回滚？*——"更多改动"指外部可见的破坏（导出删除、线上错误码改名、数据格式拒读）；"回滚"指 `from` 中存在的行为在区间内被 revert 蓄意撤回。两者都要证据：commit message 和子代理摘要只是主张，只有对两棵树（源码文件或已发布包）读过之后的结论才是证据。

外部兼容 = 仓库外消费者能观察到的一切：npm 包公共 API（exports、类型、签名、依赖面）、`dsh` CLI（命令、flag、profile、配置键）、线上协议（SDK JSON-RPC、remote 网关/BFF、ACP、hooks）、会话落盘数据（JSONL 日志、SQLite 库及其版本守卫）、模型可见面（工具名/schema、系统提示词输出）、Python SDK 的预期。内部重构只是背景，不是发现——聚合计数即可。

## Phase 0 — 解析输入与模式

输入：两个版本标识（接受 `0.1.2-alpha.2`、`dsh-v0.1.2-alpha.2`、dist-tag `alpha`/`latest`/`next`）。按特异性从高到低选分析模式：

1. **上下文路径**——用户在消息里点名了 deepseek-harness 检出目录。验证：根 `package.json` + `packages/` + `AGENTS.md` 齐备。
2. **`DSH_SOURCE_PATH` 环境变量**——同样验证。（可选 `DSH_NPM_REGISTRY` 覆盖 npm registry。）
3. **CWD 启发**——当前目录本身就是 deepseek-harness 检出（同样标记）。
4. **npm 模式**——以上皆无（第三方 repo 的默认路径）：下载两个版本的已发布包做分析。

源码模式审计 git tag；npm 模式审计发布工件。审计核心（侦察面、分类、核验、报告）两者共享，物化方式和部分证据源不同。选 npm 模式前要知道它的边界：**npm 版本集 ≠ git tag 集**（如 `0.1.2-alpha.1` 打了 tag 但从未发布——物化脚本会带已发布清单退出，应把缺口摆给用户，不要自行替换版本对）；CLI 闭包不含全部可发布包（SQLite 持久化后端不是 CLI 依赖，脚本以补充包形式安装）。

## 输出契约

全部落在一个目录：`tmp/<fromNorm>-to-<toNorm>/`（规范化：去 `dsh-v`、预发布段去点——`dsh-v0.1.2-alpha.1` → `0.1.2alpha1`）。源码模式建在检出内（已 gitignore）；npm 模式建在当前项目内。目标目录已存在时多半是先前手工做的报告——先停下来问，不要覆盖。

| 工件 | 源码模式 | npm 模式 |
|---|---|---|
| `commits.txt`、`reverts.txt` | 来自 git；revert 并入 CHANGELOG | 来自 GitHub compare 富化（私有仓库则无） |
| `files.txt`、`diffstat.txt`、全量 `.diff` | git 树 diff | `manifest-diff.txt`（逐包 manifest diff）+ `a/`、`b/` 已发布包树 |
| `CHANGELOG.md` | 按类型分类，**必须有 Reverts 分节** | 有富化时生成；否则省略并明说 |
| `UPGRADE-ADAPTATION.md` | 审计报告（两模式同一骨架） | 相同；头部记录模式与版本出处 |

报告语言跟随用户语言（[examples/](examples/0.1.2alpha1-to-0.1.2alpha2/UPGRADE-ADAPTATION.md) 既有报告为英文，属历史约定不强制）。

## Phase 1 — 物化两棵树

**源码模式**——先验纯度，merge base 不是 `from` 本身意味着基漂移，必须停下报告，不能对着移动的基线做 diff：

```sh
git merge-base <from> <to>   # 必须等于 <from> 的 commit
node <skill-dir>/scripts/gen-artifacts.mjs <from> <to> tmp/<pair>
```

**npm 模式**：

```sh
node <skill-dir>/scripts/materialize-npm.mjs <from> <to> tmp/<pair>
```

脚本向 registry 解析两个版本（缺失则 exit 1 并带已发布清单——把缺口摆给用户），以 `--ignore-scripts` 把 `@deepseek-ai/dsh` 依赖闭包加 SQLite 补充包装进 `a/` 与 `b/`，对每个 `@deepseek-ai/*` 包做 manifest diff 生成 `manifest-diff.txt`，并从公开 GitHub 仓库富化（`commits.txt`、`reverts.txt`）——所以没有源码检出也能做回滚检测。

按 stats 输出定侦察规模：≤40 个非合并 commit → 按侦察面清单单跑内联；40–250 → 合并 3–4 个面；更多 → 全量六面。密度对比要翻上一对的 `commits.txt`——按**时间序**取紧邻前一对，永远不要只抓 `tmp/` 里最新的目录。

## Phase 2 — 先立共享事实

跑一次，喂给每个子代理，免得各自重复推导：

- **格式守卫**——源码模式读两个 tag 上的 `SESSION_FORMAT_VERSION`（`packages/core/session/src/types.ts`）与 SQLite `SCHEMA_VERSION`（`packages/session/session-persistence-sqlite/src/schema.ts`）；npm 模式从 `dsh-session` 与补充包的已发布 `lib/*.js` 里 grep 同名常量。守卫跳号且无迁移路径 = 硬数据破坏，放报告最前面。
- **回滚清单**——源码模式：`git log --grep='[Rr]evert' <from>..<to>`；npm 模式：富化的 `reverts.txt`（没有 → 回滚*意图*不可检测，明说，只做 from→to 差量审计）。
- **Python SDK**——源码模式：diff `python/`；npm 模式：超出 npm 工件范围，一句话说明即可。

## Phase 3 — 并行面扫描

一批并行派发每面一个只读侦察代理，带 Phase 2 共享事实和 [references/audit-playbook.md](references/audit-playbook.md) 的输出契约：分节 **REMOVED**（最前——候选破坏/回滚）、**CHANGED**（before → after）、**ADDED**、**RENAMED**；每条带 包/路径、符号或字段、影响面类别（SDK 消费者 / CLI 用户 / 配置作者 / 会话数据 / 模型可见 / 协议对端 / web UI / npm 安装者）；结尾一行判定。面的目标路径清单（分模式）在 playbook。

## Phase 4 — 发布前核验

侦察输出是线索，不是发现。每条 REMOVED、回滚和线上声明都要亲自复核：源码模式用 `git show <tag>:<path>` / `git ls-tree` 对两个 tag；npm 模式读两棵已发布树（`a/node_modules/...` vs `b/node_modules/...`）。这一步有真实教训：侦察代理曾把 alpha.1 里就存在的包报成"alpha.2 新增"。无法核验的内容要么标 `[INFERENCE]`，要么删掉。

## Phase 5 — 写 UPGRADE-ADAPTATION.md

按 [references/audit-playbook.md](references/audit-playbook.md) 骨架：头部（区间、统计、模式与出处、源码模式的纯性说明）、**Verdict**（直接回答比较性问题）、§1 回滚、按消费者影响排序的破坏分节（删除项在前，每条标注谁会被破坏，配 **Adapt:** 行）、**Confirmed unchanged**（兼容性成立的部分与破坏同等重要）、边界签名表 `[API surface | from | to | changed?]`、编号迁移清单。完整实例见 [examples/0.1.2alpha1-to-0.1.2alpha2/](examples/0.1.2alpha1-to-0.1.2alpha2/UPGRADE-ADAPTATION.md)（源码模式真实审计）。对话回复跟随用户语言。

## 护栏

- 只读：源码模式不动 `tmp/<pair>/` 之外的任何东西；npm 模式只写自己的 `tmp/<pair>/` 且以 `--ignore-scripts` 装进该目录——绝不把 dsh 包装进宿主项目的 `node_modules`。
- 优先树级事实（已发布文件、双 tag 读取），不信日志推导的叙事。
- 内部无关 churn（测试、notes、i18n、样式）聚合成一个计数，不逐条列。
- npm 模式如实记录局限：无富化就没有 git 历史；CLI tarball 只发 `lib/`（配置组成通过各 bundle 包的 `cordis.patch.yml` + manifest 审计）；Python SDK 超范围。
- 20 个 commit 的区间不要全量扇出；500 个 commit 的区间不要内联。规模判错是审计变陈旧或变浅的主因。

## 与 plugin-upgrade 的关系

本 skill 产出**宿主版本间的兼容性证据**（报告 + 边界签名表）；[plugin-upgrade](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/skills/plugin-upgrade/) 消费这类证据（版本变更卡片）执行单个插件的迁移。审计发现可直接供给卡片「实战批注」；给 `plugin-upgrade` 补卡时引用本 skill 的报告目录而非凭记忆转述。
