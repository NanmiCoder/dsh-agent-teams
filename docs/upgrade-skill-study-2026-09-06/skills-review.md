# DSH 升级技能仓库研究：README、技能边界与项目接入

研究时间：2026-09-06（会话于 2026-09-05 开始）。只读研究，未修改 AgentTeams 源码、安装依赖、升级宿主或外部发布。

## 结论

这个仓库值得引入，最有价值的是 **精确版本证据 → 迁移触点 → 真实宿主验收 → 发布产物验收** 这一整套流程。它是 `oh-my-dsh` 社区维护的迁移知识库，**不是 DeepSeek 官方兼容认证**，也不是安装以后就能自动兼容未来 Harness 的运行时适配层。

建议保留整套 9 个 skill 文件夹及 MIT 授权、来源 SHA；按需调用其中 7 个生命周期能力，`plugin-heavy-dep` 和 `dsh-benchmark-case` 作为可选参考。由于完整 skills 约 1.2 MB，拆散省不了多少空间，却会增加缺引用或技能路由失败的机会。`benchmark/` 整套不应复制进应用目录；继续在独立 clone 里研究/运行，上游考题也不能代替 AgentTeams 自己的兼容测试。

关键限制：它的迁移卡明确标注 `coverage: curated`，不是完整 API diff。此次搜索全部 `skills/`，没有发现 `registerContinuableSetup`、`sendMessage`、`followup` 这些 API 名的迁移记录；有的是 `report` 工具 → `send_message` 工具卡。因此 **没有现成覆盖 #130 涉及的成员初始化、唤醒、失败处理生命周期迁移**。这部分仍需从我们提供的官方 checkout 对比精确 tag，并形成项目契约测试。

## 来源身份

- URL：<https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill>
- 本地 clone：`/tmp/dsh-plugin-upgrade-skill`
- 审阅 SHA：`cd4d497588cdd4f16300622779b62a78fe803169`
- HEAD 日期/标题：2026-09-05T23:31:35+08:00，`Merge pull request #157 from lhh010/docs/plugin-release-baked-version`
- `README.md` 自述“社区共建”；官方来源是链接到的 `deepseek-ai/deepseek-harness` 与 Discussion #5120。
- `LICENSE`：MIT，版权为 `2026 dsh-plugin-upgrade-skill contributors`，复制技能必须同时保留版权及许可。

## 九个技能的实际职责和依赖

所有路径相对于社区仓库根目录。

| Skill | 已核实能力 | 对 AgentTeams 的用法 | 必须随技能保留 |
|---|---|---|---|
| `skills/plugin-workflow/` | 七种流程、十二项能力选择；只读 planner 输出阶段账本、依赖顺序和状态，不执行阶段 | 作为兼容修复/发布审核入口，记录完成、跳过和未覆盖边界 | `SKILL.md`、`scripts/plan-workflow.mjs`、`references/workflow-selection.schema.json`；另依赖下方五个 owning skill |
| `skills/plugin-upgrade/` | 区分只读检查、已安装插件更新、作者源码迁移；识别版本链最终状态、七类触点、来源/安装身份、依赖 cohort、真实启动 | 最直接对应 #107/#113/#120/#123/#127 和 #130；通用流程可复用，缺失 API 必须补源证据 | 完整 `references/`、`scripts/`、`examples/`，不能只复制 `SKILL.md` |
| `skills/dsh-upgrade-audit/` | 有源码时对比精确 git tag，无源码时隔离下载 npm 产物；检查 API、CLI、wire、数据格式、模型可见面；要求复核 subagent 报告 | 用户给出的 `/Users/nanmi/workspace/github/deepseek-harness` 是 source mode 的第一优先输入；产出边界签名表补上遗漏 | `scripts/gen-artifacts.mjs`、`scripts/materialize-npm.mjs`、`references/audit-playbook.md`、引用的 `examples/` |
| `skills/plugin-test/` | 七触点测试矩阵、真实 Loader/产品入口、打包产物验收；Docker runner 精确指定 dsh、pnpm 和 Node 镜像，可追加功能 probe | 可借用 runner 框架，但 AgentTeams 必須增加发送→唤醒→执行→回报、失败落盘/队长通知、模型/effort、恢复等项目 probe | `references/`、`scripts/docker-release-smoke.mjs`、`scripts/container-runner.mjs` 及测试文件 |
| `skills/plugin-release/` | 打包文件闭包、安装消费验收、GitHub/npm/hub 轨道区分、prerelease/dist-tag 检查和 rollback 记录 | 发布门禁层级适合采纳；其部分版本基线和 rollback 配方陈旧，见下一节 | `references/publish-playbook.md`、`references/profile-dependency-management.md`、双语 SKILL |
| `skills/plugin-write/` | 外部插件/官方 monorepo 分流；精确目标契约，工具/LLM/hook/service/config 模板；本地命名校验及社区 registry 查询 | `plugin-workflow` 的 owner 之一，适合未来实现阶段；不要对已发布 AgentTeams 自动改名或强加社区 manifest | 完整 `references/`、`scripts/validate-names.mjs`、`scripts/query-registry.mjs`，尤其 `naming-policy.v1.json` 等 JSON |
| `skills/plugin-runtime-debug/` | 从宿主实现反查 API 语义、坐标/投影错配、返回 false 被忽略、状态缓存、slot 错误边界、GUI 仍跑旧代码 | 有益于 UI 消失、状态停滞、链接安装和缓存诊断；其重点是 Web client，并未直接实现 subagent runtime 兼容 | `SKILL.md` 和 `README.md`（没有执行脚本） |
| `skills/plugin-heavy-dep/` | Web 重依赖懒加载、独立 chunk 路由、路径 containment、SVG 清洗、交互所有权 | 当前版本兼容问题无需启用，可保留备用 | 完整目录；不要因为存在此 skill 就重构现有 bundle |
| `skills/dsh-benchmark-case/` | 将真实迁移做成 Harbor 的 fixture/instruction/judge/solution；要求 oracle、未修改和半迁移负例可区分 | 可把 AgentTeams 的真实故障做成未来回归题；不是运行 benchmark 的 skill，也不是我们的产品兼容套件 | `assets/`、`references/`；执行该流程还需要上游 `benchmark/` 和其注册脚本/清单，单复制 skill 不包含 52 道题 |

`plugin-workflow/SKILL.md:102–127` 的五个阶段 owner 是 `plugin-upgrade`、`plugin-write`、`plugin-test`、`plugin-release`、`dsh-upgrade-audit`；找不到 owner 时其流程要求标记 blocked，不能按记忆重建。其余三个扩展技能不在该路由表内，可按任务调用。

脚本依赖核查：主要 runner 使用 Node built-ins；migration planner 用相对 skill 根目录读取版本卡及 patterns；workflow planner 用相对路径读取 JSON schema；Docker runner 通过同目录 `container-runner.mjs` 执行；命名查询依赖同目录校验器及 reference policy。这些都是必须保留目录结构的原因。

## 需要隔离或纠正的旧指导

### 1. 社区 release 文档内部已不一致

- `skills/plugin-release/SKILL.md:21` 已说明 alpha.1 未发布、alpha.2–alpha.4 有 npm 发布。
- 但 `skills/plugin-release/references/publish-playbook.md:10` 仍笼统声称 `0.1.2-alpha.*` 只在 GitHub、npm 404，并给 alpha.2 本地构建配方。这是同一个 SHA 内部的冲突。
- `skills/plugin-release/SKILL.md:32–34` 和 playbook 的 dual compatibility 段仍写“npm 当前基线 0.1.1-rc.2”，建议宽 peer `<0.2.0`。与此同时 `skills/plugin-upgrade/references/rollup-0.1.2.md:3` 已记录 2026-09-04 `@deepseek-ai/dsh latest` 到 rc.1。不要拿历史基线作为现在的开发依赖政策。
- `<0.2.0` 不是经过验证的兼容承诺，也不能仅凭字面断言包含所有 prerelease。AgentTeams 应由实测支持矩阵生成允许范围，并核验安装后的实际解析树。
- `skills/plugin-release/SKILL.md:49` 的“插件 prerelease 不能进 latest”很有价值；但它只检查插件自己的版本号，**没有防止一个无后缀插件把 latest 推给未验收的 Alpha 宿主**。此前的发布生命周期问题仍需项目新增门禁。
- `skills/plugin-release/SKILL.md:56` 的“删 tag / 重指向旧 commit”不应成为 npm 包的通用回滚策略。Git tag、GitHub release、npm tarball、npm dist-tag、已安装用户 profile 是不同对象；项目必须显式区分。
- `plugin-test` 的 Docker 自述只验证指定 artifact/host/probe。不能把 “CLI 精确版本” 推断成整个依赖闭包已锁定，也不能把启动 ready 推断成多 agent 业务可用。

建议：vendored 原文保持来源可核对，通过项目级使用说明/兼容策略明确覆盖以上陈旧建议；未来上游更新时看差异再提升 SHA。不要静默追随 main，也不要为引入 skill 改动应用 package.json/锁文件。

### 2. 项目现有技能明显落后于已迁移代码

项目 canonical 文件 `skills/dsh-plugin-development/SKILL.md` 的 metadata 是 v3.1.0 / 2026-08-13。

- L58、L76：写“无 release tag，不 pin 版本”。本地官方 clone `git tag -l dsh-v0.1.2*` 已确认 alpha.1–alpha.5、rc.1 六个 tag；新 `plugin-release` 又要求 exact tag。这条旧指导必须失效。
- L61：复用临时 clone 的更新例子包含 `reset --hard origin/master`，与精确版本证据及保留已有工作不一致，不应按旧例执行。
- L105、L220、L301：仍使用 `@deepseek-ai/dsh-client-runtime`；alpha.2 的 `packages/client` tree 已无 runtime，项目 package.json 也已改为 connection/UI 包。
- L245：`conversationEvents.register` 仍作为当前推荐；项目版本 issue 正好涉及它与新 `uiConversation` 的错配。必须由 exact tag 的 API ledger 选用，不能继续作为全版本模板。
- 多处“当前正式版”没有固定版本/日期，无法作为支持基线。

现有通用原则（effect 清理、真实组合、打包闭包、host/client 隔离）仍有用。适合加上历史版本标识，并把版本敏感问题路由到新技能；不需要删除整个文件。

项目 `scripts/sync-skill.mjs:7–8` 只同步这一份 canonical SKILL 到 `.dsh/skills/dsh-plugin-development/SKILL.md`。引入新目录不会自动镜像；如果修改旧技能入口，应维持现有镜像一致。README:177–180 已公开提供旧 skill 的安装命令，不能无声覆盖其身份。

## 放进项目的可维护方式

1. 选择 **项目维护技能**，而不是作为应用运行时依赖。推荐 canonical vendoring 到 `skills/<upstream-name>/`，与现有 `skills/dsh-plugin-development/` 并列；也可放 `.agents/skills/` 自动发现，README 本身给的是此布局。
2. 记录来源 URL、上游 commit、取入日期和保留的 skill 目录。将完整 MIT LICENSE 放同一 vendor 来源范围下，并说明本地是否有改动。
3. 加一份项目使用说明，指定“精确 tag + published artifact + 项目测试证据”高于陈旧示例、社区名称规范不是官方要求、版本卡非完整 diff、项目用户授权及 Ego Lite 浏览器偏好优先。
4. 若希望 Codex 自动加载，使用 `.agents/skills/` 项目入口（可以是相对引用到 canonical 的方式，具体发现机制需根任务验证）；只存在普通 `skills/` 是可分享内容，不等于当前会话已经自动加载。
5. 与用户已安装的同名全局 `plugin-upgrade`、`plugin-test` 明确来源优先级：本次研究源以 SHA `cd4d497…` 为准，后续调用用精确本地路径，避免误读全局旧版。
6. 不拷 benchmark 全部 fixtures、宿主源码快照、运行日志和 examples 执行产物到应用包；技能自己引用的只读 examples 应保留。保留 clone 作为 benchmark 研究区即可。
7. 只执行文档/文件闭包与 planner 自检；真实 npm 安装、容器、发版是下一阶段动作。根任务可在已授权范围内自行执行，但本子任务没有运行这些动作。

## 对统一解决方案的增量

它能减少重复摸索，并提供可维护的升级“流程”和版本变更“知识”；不能替代我们自己的“版本支持政策”和“产品回归证据”。合理落地链条是：

`上游 exact tags + npm cohort → dsh-upgrade-audit → 项目支持矩阵/边界签名 → plugin-upgrade → 项目契约和产品回归 → plugin-test artifact smoke → plugin-release 门禁 → 明确渠道发布`

项目优先增加的针对性证据仍是：成员创建/模型/推理力度；消息投递与唤醒；失败落盘、备用模型及队长通知；退役守卫；冷恢复；Web activation。社区仓库测试的是“agent 使用 skill 做迁移的能力”，这些才是“AgentTeams 在配套宿主实际可用”的证据。

## 本次证据范围

已读取 README、skills README、9 个 SKILL 入口（`dsh-benchmark-case` 阅读入口与依赖/校验段，未审其全部判分参考）、主技能引用目录、关键脚本路径、alpha.4/rc.1 版本卡、release 历史配方、项目旧技能和同步器。对旧技能 tag/client-runtime 失效点做了本地官方 git tree 核查。未运行 benchmark、未执行升级、未测试社区 Docker runner、未声称现有 58 张卡已全部逐条核实。
