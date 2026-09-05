# DeepSeek Harness 升级 Skill：benchmark 与测试工具研究

研究日期：2026-09-05/06（Asia/Shanghai）。研究对象为 `/tmp/dsh-plugin-upgrade-skill`，Git commit `cd4d497588cdd4f16300622779b62a78fe803169`。只做静态审查和本地工具自检；没有安装或升级 Harness，没有运行 Docker、LLM benchmark、真实模型请求或修改 AgentTeams 产品代码。

## 结论

值得采用 `plugin-test` 的迁移测试台账、七触点扫描、真实入口验收和 tarball smoke 工具；`dsh-benchmark-case` 可以把 AgentTeams 的历史故障沉淀为能重现的迁移考题。它们能补齐我们的升级流程，但现有 benchmark 并不直接证明 AgentTeams 已兼容当前 rc.1，也不能替代该项目的真实成员消息、失败上报、模型选择与恢复验证。

最重要的区别：52 道题衡量 **AI 是否能正确完成指定迁移**，并非对任意插件运行的 52 项兼容性回归。运行 `npm test` 也不等于运行这些题的真实宿主验收；顶层脚本运行资料/注册表校验和工具自身测试，`test:dsh:cases` 仅检查运行用例定义。

## 文件与 README 声称核对

本地逐目录统计和官方校验一致：

| 项目 | 实际结果 |
|---|---|
| Skills | 9 |
| 版本卡集合 / 卡片 | 8 / 58 |
| Harbor task 目录 | 52 |
| Static / Hands-on | 19 / 33 |
| 每题的 instruction.md、task.toml、Dockerfile、test.sh、judge.mjs、solve.sh | 52/52 全有 |
| validation-report-*.md | 18 份 |
| 冻结 evaluation snapshots | 2 份（23题与单题H21） |
| 可独立运行的 benchmark/runtime/cases.json | **1 case / 3 checks**，不是52题 |

证据：[`benchmark/README.md:3`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/benchmark/README.md#L3)、[`package.json`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/package.json)、[`benchmark/runtime/cases.json`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/benchmark/runtime/cases.json)、[`validate-task-registry.mjs`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/benchmark/scripts/validate-task-registry.mjs)。

## 自动判分到底判什么

- **静态题**：读取 agent 报告，以正则/关键词匹配评分，兼顾 fixture 没有被修改的约束。自动判分真实存在，但不等于语义完备的代码证明。例如 S13 的五项各20分，实际正则中的“或”条件可以只匹配其中一半；英文词汇和一定距离内的关键词会影响得分。只能把它当作受控诊断能力指标。
- **常规实操题**：静态清单/源码模式检查，加隔离 profile 安装和宿主冷启动；有的以 `MISSING_CREDENTIAL` 或没有 pending/error 证明已到应用层，有的只检查 boot manifest 或 HTTP。无密钥到应用层不证明真实模型工作；manifest/HTTP 200 不证明浏览器实际激活。
- **较强实操题**：H10 用 Chromium 的 DOM 激活标记；H11/H21 用锁定的真实服务实现验证跨版本契约；H20 用真实 alpha.4 Session 对象验证事件窗口、fork继承、精确seq读取，并检查不能补回已删除API。
- **完整源码题 H22**：包含真实 dsh-data-agent 两个tag之间34个变化路径，90分语义契约检查、10分要求目标文件逐字一致；静态面达到80分之后才执行安装/测试/构建/pack/真实浏览器门禁。其满分同时度量复刻上游目标，与“任何语义等价实现都兼容”并非同一标准。

证据：[`S13 judge:26`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/benchmark/tasks/S13-peer-range-vs-runtime/tests/judge.mjs#L26)、[`H20 judge`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/benchmark/tasks/H20-session-events-ledger/tests/judge.mjs)、[`H22 README`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/benchmark/tasks/H22-dsh-data-agent-alpha2/README.md)、[`scoring.md`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/benchmark/docs/scoring.md)。

## “真实插件迁移”是否属实

属实，至少有两个具备明确来源、commit和文件清单的强样本：

| 用例 | 来源版本 | 目标版本 |
|---|---|---|
| H9 dsh-web | v0.3.8 / `fa6d2a47302a2979c79bbd52a6318c98bad0f564` | v0.3.9 / `8b0191fea221c692e71f88abc51ce8146b32aa0d` |
| H22 dsh-data-agent | v0.1.3 / `8e3ab6a3560733c11417bdf2912c9db4f09a6974` | v0.1.4 / `d1bd4381ed771d505db69f2a9065379f7d3165a0` |

H9保留Apache-2.0来源，H22保留MIT完整Git跟踪快照和生成物；普通测试fixture多数是私有的精简迁移示例。来源记录在各题 `provenance/upstream.json`。这次核对的是仓库中记录与文件结构，没有独立从两个上游重新下载全部tag逐字复核。

公开分数应保持原始范围：README有19/22/23题历史快照成绩，不能说“52题已通过”或“使用skill总能迁移成功”。例如 Terra with-skill为21个有分题0.7976，对照0.7110；H22单题Luna with-skill仅0.08、对照0.11，均未达到完整迁移成功。作者披露了verifier错误、原生skill污染、H21网络边界和不同快照等限制。较新静态报告也明确标DRAFT、18有效配对、仅一次尝试，token为估计。

证据：[`benchmark README:75`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/benchmark/README.md#L75)、[`H9 provenance`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/benchmark/tasks/H9-dsh-web-alpha2/provenance/upstream.json)、[`H22 provenance`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/benchmark/tasks/H22-dsh-data-agent-alpha2/provenance/upstream.json)、[`静态配对报告`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/benchmark/results/validation-report-2026-09-03-static-20-paired.md)。

## 版本覆盖与我们当前断点

大多数任务针对 `0.1.1-rc.2 → 0.1.2-alpha.2`；30个任务Dockerfile含精确安装 `@deepseek-ai/dsh@0.1.2-alpha.2`。H20针对 `0.1.2-alpha.3 → alpha.4` 的 Session.events 删除；S13讨论alpha.5上的peer范围与运行时错配；S12/S16讨论安装、latest路由和运行中升级。**H11/H21中的rc2是 `0.1.1-rc.2`，不是 `0.1.2-rc.2`，更不是当前 `0.1.2-rc.1`。**

对benchmark源码和报告定向搜索没有找到 AgentTeams、`registerContinuableSetup`、`sendMessage`、`conversationEvents`、`uiConversation` 的专项题。`reasoningEffort`只出现在H22的数据agent普通模型配置里，没有测试我们队员创建时是否丢失推理力度。

可借用的模块与应新增的AgentTeams断言：

| 可借用 | 本项目需要补齐的对应断言 |
|---|---|
| S7 / S8 / S12 / S13：发布版本、tag与peer范围诊断 | 精确安装组合；dist-tag策略；完整宿主依赖树；实际运行进程与磁盘版本一致 |
| H5：typecheck绿但运行时export漂移 | npm tarball的真实Node/Client导出能加载；无二份运行时singleton |
| H11 / H21：真实双版本服务实现、pass-to-pass保留 | Alpha.2 followup保留this；rc.1 sendMessage唤醒队员；去重和中断行为 |
| H20：真实session语义、负例矩阵 | 消息/任务状态持久化；失败落盘；父队长通知；恢复后的任务状态 |
| H10 / H22：真实浏览器bundle执行 | AgentTeams页面/侧栏实际激活；UI事件服务在目标宿主注册；核心可见状态更新 |
| plugin-test七触点与测试台账 | 模型选择、reasoningEffort、备用模型、失败上报、调度收尾、冷恢复逐条绑定回归 |

不能因为通过H20推断子代理生命周期正常，也不能因为通过H11推断rc.1兼容。

## Docker smoke runner的价值和缺口

可复用 `skills/plugin-test/` 整个目录：它是自包含skill，不依赖另装plugin-upgrade。配置强制精确dsh/pnpm版本、禁止image latest；使用argv调用；隔离容器/profile；记录tarball SHA-256、环境、时间、CPU/内存、失败分类与日志。会明确声明浏览器、真实模型、跨平台、多版本等未验证。

但用于我们这次发布门禁之前还要补：

1. **锁定和检查完整依赖闭包**。`container-runner.mjs:263`只读取顶层`@deepseek-ai/dsh/package.json`的版本；缓存复用也是只比pnpm/dsh两个版本。`npm install -g dsh@alpha.2`并不能阻止其内部范围解析到后来的alpha/rc包。H11/H21/H20提供了独立锁文件/精确实现测试的好范例，而大多数全局安装任务仍有同类漂移风险。
2. **明确插件激活与行为断言**。coldStart只等待配置readyPattern；示例是通用`dsh web:`，probeCommand默认为空。不能只看到Web服务启动就判AgentTeams正常。应加本项目专用激活探针与成员消息→执行→回复、失败收尾、模型配置断言，并检测插件pending/failed。
3. **目标宿主版本、真实完整入口和平台矩阵由我们维护**。修改配置到rc.1不足以证明全部接口正确；需要本项目实际探针和已知坏/好负例。browser/Windows必须另验。

证据：[`plugin-test SKILL`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/skills/plugin-test/SKILL.md)、[`迁移测试方法`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/skills/plugin-test/references/version-migration-testing.md)、[`Docker使用说明`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/skills/plugin-test/references/docker-release-smoke.md)、[`container-runner:128`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/skills/plugin-test/scripts/container-runner.mjs#L128)、[`container-runner:263`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/cd4d497588cdd4f16300622779b62a78fe803169/skills/plugin-test/scripts/container-runner.mjs#L263)。

## 这次实际执行的检查

环境为Node `v26.7.0`，未安装依赖；下面命令只用Node内置能力、仓库文件或本地git对象。全部通过，最后一次检查 `git status --short` 无变更。

```sh
cd /tmp/dsh-plugin-upgrade-skill
node scripts/validate.mjs
node benchmark/scripts/validate-task-registry.mjs
node benchmark/scripts/validate-execution-contract.mjs
node benchmark/scripts/validate-checkpoints.mjs
node benchmark/scripts/validate-evaluation-snapshots.mjs
node benchmark/runtime/verify.mjs --check
node --test skills/plugin-test/scripts/docker-release-smoke.test.mjs benchmark/tasks/H11-dual-cohort-rpc/tests/judge-utils.test.mjs benchmark/tasks/H20-session-events-ledger/tests/judge-utils.test.mjs
```

结果：9 skills / 8 card sets / 58 cards；52题注册表和契约；2 checkpoint manifests；2 evaluation snapshots；1 runtime case / 3 checks；29项工具/评分器helper单测全部通过。这些是仓库资料及工具自检，**没有实际运行52题、oracle冷启动或AgentTeams运行时验收**。

`validate-evaluation-snapshots`在浅克隆且缺历史commit时会失败并要求补齐commit；这是可复现性检查，不应改成跳过或当成skill坏了。

## 后续确切运行方式（本轮未执行）

Harbor任务：Docker Linux容器 + Harbor CLI（`uv tool install harbor`或`pip install harbor`）；agent评测另需对应模型认证，可能产生较高token成本。标准oracle不耗模型API，但仍构建容器、下载npm依赖。

```sh
cd /tmp/dsh-plugin-upgrade-skill
harbor run -p benchmark/tasks/S1-static-scan -a oracle
harbor run -p benchmark/tasks/H11-dual-cohort-rpc -a oracle
# 独立旧插件/新插件运行控制（当前只有host-api-proxy这一case）
node benchmark/runtime/verify.mjs --case host-api-proxy --report-dir /tmp/dsh-runtime-host-api-proxy-report
```

上述任务中的旧版target属于试题定义，不能为了验证rc.1直接替换版本然后继续引用原分数。正式能力比较要固定snapshot、skill commit、任务集合、相同模型和至少多次重复，并按其report协议留存边界。

AgentTeams发布前smoke的调用入口是：

```sh
node /tmp/dsh-plugin-upgrade-skill/skills/plugin-test/scripts/docker-release-smoke.mjs \
  --config /tmp/agent-teams-smoke-config.json \
  --plugin /tmp/agent-teams-candidate.tgz \
  --report-dir /tmp/agent-teams-smoke-report
```

这条命令需先有实际打包tarball和检查过的目标配置；在完整依赖锁定和专用功能probe补齐前，仅能作为窄范围启动证据，不可作为发布已全面兼容的门禁。

建议先导入plugin-test并保留版本来源，把当前方案改写为“使用社区skill的方法与工具 + AgentTeams自身兼容清单/回归矩阵”。`dsh-benchmark-case`留作后续提炼1–3个高价值真实故障的工具，无需为了此次rc.1整治先跑完52道迁移考试。
