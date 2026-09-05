# DeepSeek Harness 发布渠道与兼容契约审计

观测日期：2026-09-05。官方 npm 元数据采集完成于 2026-09-05 15:48:52 UTC（北京时间 23:48:52）；后续源码与解析核对见本文末。此报告只读上游源码、GitHub 和 registry；没有升级用户 Harness、修改 profile、修改 npm dist-tag 或发布内容。

## 结论

1. 普通用户应该使用项目明确验收、可复现的“宿主版本 + 插件版本 + 依赖闭包”组合。当前没有证据支持声称某个现有插件版本已完整兼容官方默认的 Harness `0.1.2-rc.1`。建议将 rc.1 全套运行时作为下一普通通道的验收目标，验收通过后再推荐，不要直接把源码 `0.1.3-alpha.1` 当默认宿主。
2. 截至观测时，Harness 的 npm CLI `latest` 与 `next` 都是 `0.1.2-rc.1`，`alpha` 是 `0.1.2-alpha.5`。CLI 尚未发布任何无 prerelease 后缀的稳定版本。GitHub 已发布 `0.1.3-alpha.1` release，本地 HEAD 也已标记该版本，但官方 npm 的 CLI 和本次检查的关键包尚无该版本。GitHub release、源码 version、npm version、npm tag 必须分开记录。
3. 默认渠道不应自动吸收 Alpha。npm 技术上允许 `latest` 指向任何版本，`latest` 不是质量认证；这是维护者必须制定和执行的政策。Harness 官方脚本已经采用 alpha→`alpha`、canary→`canary`、rc→`next`、无后缀→默认 `latest`。当前 CLI 的 `latest=rc.1` 是实际 registry 状态，不能据脚本猜测它由谁、何时提升。
4. “把 CLI 固定在 Alpha.2”仍不足以锁住实际宿主。已发布的 `dsh@0.1.2-alpha.2` 依赖 `dsh-base@^0.1.2-alpha.2`，base 又依赖同范围的 subagent/agent；npm SemVer 实测允许该范围解析到 `0.1.2-rc.1`。最终完成的独立锁文件解析也确认：精确 Alpha.2 CLI 解析出了 rc.1 的 base/agent/subagent/session/web-app/UI，同时部分其他包仍为 Alpha.2。需要完整锁文件/经验证发行产物，而不只是 README 写一个 CLI 版本号；这项验证不等于已启动或验收该混合运行时。
5. 不能期待永久兼容所有 Alpha。上游明确将 API 定义为 pre-stable；应提供集中适配层、明确支持矩阵、完整安装验收、升级检测和过期政策。它们可把故障从用户运行时转移到 CI 和发布环节，但不会消除上游未来所有破坏性变更。

## npm 与 GitHub 的实际状态

主机默认 registry 为 `https://registry.npmmirror.com`；为排除镜像延迟，已显式查询 `https://registry.npmjs.org` 并保存完整版本、时间与所选 manifest。两个 registry 对 CLI 当前 tags 的结果一致。

| npm 包 | latest | next | alpha |
|---|---|---|---|
| `@deepseek-ai/dsh` | `0.1.2-rc.1` | `0.1.2-rc.1` | `0.1.2-alpha.5` |
| `@deepseek-ai/dsh-base` | `0.0.1-rc.1` | `0.1.2-rc.1` | `0.1.2-alpha.5` |
| `@deepseek-ai/dsh-app-boot` | `0.1.0-rc.6` | `0.1.2-rc.1` | `0.1.2-alpha.5` |
| `@deepseek-ai/dsh-subagent` | `0.0.1-rc.1` | `0.1.2-rc.1` | `0.1.2-alpha.5` |
| `@deepseek-ai/dsh-subagent-spawn-in-process` | `0.0.1-rc.3` | `0.1.2-rc.1` | `0.1.2-alpha.5` |
| `@deepseek-ai/dsh-subagent-fork-in-process` | `0.0.1-rc.3` | `0.1.2-rc.1` | `0.1.2-alpha.5` |
| `@deepseek-ai/dsh-agent` | `0.1.0-rc.6` | `0.1.2-rc.1` | `0.1.2-alpha.5` |
| `@deepseek-ai/dsh-session` | `0.0.1-rc.1` | `0.1.2-rc.1` | `0.1.2-alpha.5` |
| `@deepseek-ai/dsh-client-ui-chat` | `0.1.2-alpha.2` | `0.1.2-rc.1` | `0.1.2-alpha.5` |
| `@deepseek-ai/dsh-client-ui-conversation` | `0.0.1-rc.1` | `0.1.2-rc.1` | `0.1.2-alpha.5` |
| `@deepseek-ai/dsh-web-frontend` | `0.0.1-rc.5` | `0.1.2-rc.1` | `0.1.2-alpha.5` |
| `@deepseek-ai/cordis` | `4.0.2` | `4.0.1-rc.4` | 无 |

不要对整个宿主逐包安装 `@latest`：上表会拼成跨代运行时。Cordis 属于独立发布序列，不应硬套 dsh 版本号。本次检查的所有 dsh 包都没有无后缀稳定版本，也都没有 npm `0.1.3-alpha.1`。

CLI 关键发布时间：

| CLI 版本 | npm 发布时间 UTC | GitHub release 发布时间 UTC |
|---|---|---|
| `0.1.2-alpha.2` | 2026-08-30 14:10:52 | 2026-08-30 13:52:14 |
| `0.1.2-alpha.3` | 2026-08-31 16:20:52 | 2026-08-31 16:03:39 |
| `0.1.2-alpha.4` | 2026-09-01 16:01:23 | 2026-09-01 15:45:07 |
| `0.1.2-alpha.5` | 2026-09-02 08:38:34 | 2026-09-02 10:02:56 |
| `0.1.2-rc.1` | 2026-09-03 06:21:52 | 2026-09-03 06:06:07 |
| `0.1.3-alpha.1` | 本次查询不存在 | 2026-09-04 11:34:32 |

来源：[官方 CLI registry](https://registry.npmjs.org/@deepseek-ai%2Fdsh)、[官方 subagent registry](https://registry.npmjs.org/@deepseek-ai%2Fdsh-subagent)、[官方 ui-chat registry](https://registry.npmjs.org/@deepseek-ai%2Fdsh-client-ui-chat)、[GitHub rc.1 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1)、[GitHub 0.1.3-alpha.1 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.3-alpha.1)。完整采集：[registry 快照](./harness-npm-snapshot.json)。

本地源码：`/Users/nanmi/workspace/github/deepseek-harness`，HEAD `d347e703908d0406b7a7ef80e3a0e594d86b2215`，`package.json` 为 `0.1.3-alpha.1`；开始和复核时工作区干净。已读取根、packages、scripts、docs、.github 对应 AGENTS。上游根 [AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/AGENTS.md) 明确说明 API 尚未稳定；这不是我们可以通过扩大 peer range 改掉的承诺。

## 渠道规则：版本号和 tag 是两件事

`alpha` 通常用于开发探索，`rc` 表示候选发布；两者都是 prerelease。对一个预稳定宿主，rc 不能自动等同于插件兼容或稳定 API。`latest`、`next`、`alpha` 是 registry 中可移动的别名。无版本的 `npm install <pkg>` 默认取 `latest`；发布方可显式指定别名。参考 [npm dist-tag 官方文档](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/)。

当前上游源码的 [DshFamily.distTagForVersion](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/scripts/release/families.ts#L351) 与 [发布调用](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/scripts/release/publish.ts#L103) 将 alpha/canary 独立发布，rc 进入 next。政策与额外 tag promotion 应单独审计，不能因为 version 包含 rc 就假定 latest 不会指向它。

建议插件渠道由“插件成熟度 + 目标宿主通道 + 验收结果”共同控制：

| 插件渠道 | 用户 | 准入和承诺 |
|---|---|---|
| `latest` | 普通用户 | 只发布已完成整套验收的默认组合；当前宿主仍是 rc 时明确写“推荐组合”，不声称上游已稳定；禁止自动跟随 alpha |
| `next` | 愿意反馈的用户 | 明确目标宿主精确版本与已知缺口，显式安装；验收后可将同一已验证产物提升或重新发布适当非 prerelease 版本 |
| `alpha`（若保留） | 开发者 | 保留现有入口以减少破坏，但作为历史/实验通道，要求显式选定宿主与插件；不承诺所有 Alpha 都被支持 |
| Git SHA/source | 维护者 | 独立测试环境；不在普通用户支持范围 |

不要仅以“插件 version 没有 alpha 后缀”就准许它推 latest。也不要现在把插件 latest 盲目退到某旧插件号；如果普通用户的宿主仍是 rc.1，旧插件同样可能不兼容。

## 最隐蔽的风险：精确 CLI 仍会解析出另一代依赖

已发布 manifest 原文关系：

```text
@deepseek-ai/dsh@0.1.2-alpha.2
  dependencies @deepseek-ai/dsh-base: ^0.1.2-alpha.2
               @deepseek-ai/dsh-web-app: ^0.1.2-alpha.2
               @deepseek-ai/cordis: ^4.0.2
@deepseek-ai/dsh-base@0.1.2-alpha.2
  dependencies @deepseek-ai/dsh-agent: ^0.1.2-alpha.2
               @deepseek-ai/dsh-subagent: ^0.1.2-alpha.2
@deepseek-ai/dsh-subagent@0.1.2-alpha.2
  peerDependencies @deepseek-ai/dsh-agent/session/llm/...: ^0.1.2-alpha.2
```

用本机 npm 11.19.0 自带 node-semver 实测：

```text
satisfies(0.1.2-rc.1, ^0.1.2-alpha.2) = true
satisfies(0.1.2-rc.1, >=0.1.0)       = false
satisfies(0.1.3-alpha.1, ^0.1.2-alpha.2) = false
satisfies(0.1.3, ^0.1.2-alpha.2)     = true
```

含 prerelease 的范围并非“只接收这个 Alpha”，普通宽范围也并非默认接收所有 prerelease。参考 [npm/node-semver 的 prerelease 规则](https://github.com/npm/node-semver#prerelease-tags)。插件 peer 应使用已验证版本的显式集合或有限范围，并另有运行时能力/版本准入；仅修改 `>=0.1.0` 或加上 `-0` 并不能证明兼容。

官方发布脚本要求同一次 dsh 发布包版本一致，但 published `workspace:^` 转换出的 caret 依赖与用户后来重新解析的结果是另一回事。“发布时同号”不等于“以后安装时永远同号”。推荐普通通道交付锁定的 dependency closure；必要时为 dsh 家族逐包生成精确 overrides，vendor 按其真实独立版本锁定，然后在空目录验证解析树与实际启动。不要手改零散几个宿主包。

## Profile 与实际加载版本

在检查的 Alpha.2 和当前源码中，内置 web profile 的 bundle 名单为 `dsh-base` 和 `dsh-web-app`。profile 初始化的 dependencies 为空，使用 `nodeLinker: hoisted`、`autoInstallPeers: false`。

关键行为：

- [resolveBundleDir](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/boot/app-boot/src/profile.ts#L767) 优先从当前 CLI 安装目录解析 bundle，其次才是 profile；内置 base/web-app 不会因为 profile 写了另一版就安全切换成另一套完整宿主。
- [healProfilesModuleFallback](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/boot/app-boot/src/profile.ts#L568) 将 CLI 安装的依赖闭包链接到 `$DSH_HOME/profiles/node_modules`；缺失的 selected bundle 依赖进入 profile 自己的 fallback；pnpm 管理的已安装条目保留优先权。
- [dsh plugin](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/apps/cli/src/plugin.ts#L117) 将参数转交 profile 目录下的 pnpm 并更新 bundle 列表。CLI `--version` 只是 launcher manifest，不是实际 loaded runtime 的完整指纹。

所以诊断必须记录 CLI 版本、CLI 路径、profile 路径、包管理器/registry、关键包的 version 和 realpath、Cordis 是否出现多个实例，以及启用的 bundle 列表。源码 clone / 全局 npm / npx / standalone artifact / profile-local 不能只用一个“DSH 版本”字段合并。

## API 断点图

| 版本 | 消息入口 | 初始化扩展 | 其他重要变化 |
|---|---|---|---|
| `0.1.1-rc.2` | `followup` | 有 `registerContinuableSetup` | 旧前端/Remote 代际，仅供历史迁移分析 |
| `0.1.2-alpha.2`、`alpha.3` | `followup` | 有 | `agentOptions` 可指定模型/推理力度；alpha.1 起前端已拆包、APIProxy 移除 |
| `0.1.2-alpha.4`、`alpha.5`、`rc.1` | `sendMessage` | 已删除 | 同时替换 Session.events API、区分 seq/log offset；需要整族适配 |
| `0.1.3-alpha.1` 源码/GitHub | `sendMessage` | 无 | SessionHandle 持久化、async agentLoop.create、session format v2、宿主内部消息适配变化；本次 npm 未发布 |

由逐 tag 的 `packages/subagent/subagent/src/index.ts` 读取确认，消息/setup 的断点是 **Alpha.4**，不能把问题仅称为“rc.1 的一个方法改名”。变更可见 [Alpha.2→rc.1 diff](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.2-alpha.2...dsh-v0.1.2-rc.1)、[消息整合提交](https://github.com/deepseek-ai/deepseek-harness/commit/ec493c2db8)、[删除 setup 的跟进提交](https://github.com/deepseek-ai/deepseek-harness/commit/3091bdc257)。

`followup` 接受调用方 source，保证 FIFO 新轮次；`sendMessage` 从确切 live sender 派生归属，限制直接父子关系，运行中的目标在 step 边界 steer，空闲目标唤醒，缺席子代理冷恢复。它们不能仅用 `runtime.sendMessage ?? runtime.followup` 就视为行为等价；队伍内部 sibling 或宿主 mailbox 协议需要显式决定发送者和调度语义。运行时方法还必须保留对象 receiver。

rc.1 的 `/internal` 确切导出名是 `queueHostSubagentPrompt`，底层 `queueSubagentPrompt` 的 symbol 值为 `dsh.subagent.queuePrompt`；0.1.3-alpha.1 把底层改为带 `queue | steer` 的 `deliverSubagentPrompt`（symbol 值 `dsh.subagent.deliverPrompt`）。这是 internal 子路径，不能作为无需后续适配的长期公共保证。参见 [rc.1 导出](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-rc.1/packages/subagent/subagent/src/internal.ts#L64)。

`subagent/start` 和 `subagent/end` 的公开观察 payload 在 Alpha.2→rc.1 保持相同：以 `runId` 对应一次运行/activation，end 包含 `stopReason` 和可选最终输出。可把失败落盘、通知、重试决策和调度收尾从旧 setup 功能拆出来，让它们根据公开生命周期运行；端到端测试必须涵盖基础设施拒绝、模型失败、取消、空输出、cold resume 和重复通知，不能仅验证回调注册成功。生命周期是观察出口，不能假定它等同于可在发布前修改 child 的 setup 时机。

`startContinuable.request.agentOptions` 已能携带 provider/model/reasoningEffort/maxTokens。源码的 [resolveChildAgentOptions](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-rc.1/packages/subagent/subagent/src/child-agent.ts#L89) 以父会话最后请求配置继承，切路由且未显式指定力度时清除旧力度，使用新模型默认值。这应是成员初始模型配置的首选入口；不应因旧 setup 消失而同时禁用推理力度或失败处理。自动 fallback 是否需要重建、如何保留任务状态应由独立行为测试确认，不在本审计中冒称已实现。

下一源码版已引入 [Session persistence / format 的明确 breaking changes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.3-alpha.1)。版本回退需要数据策略：新代码读取旧会话可能持久生成更高 generation；保留旧文件不等于支持自动降级。见 [上游 migration 决策](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/.agents/notes/implemented/architecture/2026-08-31-released-session-format-migrations.md)。预览与普通通道应使用独立 DSH_HOME/会话副本，升级前快照，回退恢复匹配版本的数据，不复用已迁移生产会话做试验。

## 可执行支持政策（建议，尚未生效）

1. 当前普通通道目标：完整 `0.1.2-rc.1` 运行时 + 待完成并验收的插件修复版。当前插件 latest 是否通过，由主审计汇总，不能在 release 文案写成已通过。
2. 一次最多维护两个已验证宿主 API 代际：当前推荐代与上一个推荐代。新推荐代上线后，上一代保留 30 天迁移窗口，只修阻塞运行/数据问题；之后显式结束支持。若上游节奏快于维护能力，减少受支持版本，不扩大无验证承诺。
3. Alpha.2 可作为已有用户的临时 legacy 组合，仅在真实依赖闭包锁定且回归通过后宣布支持；Alpha.3/4/5 不因名字相邻自动进入矩阵。Alpha.4/5 可作为 rc.1 适配族的探测样本，但正式支持仍需实际验收。
4. 预览只追一个精确已发布版本；源码 HEAD 是非阻塞 canary。每日/上游 release 后检查官方 npm 及 GitHub 差异，进入维护任务；不得自动升级生产默认。
5. 发布 gate 同时检查插件 version、目标宿主渠道、兼容 manifest、完整锁文件和 CI 结果。仅支持 Alpha/Canary 或将其作为默认目标的产物只能进 preview；默认目标为已验收 rc.1、额外保留 Alpha.2 兼容的包仍可进入 latest。允许升级推荐 rc 的政策必须在兼容 manifest 显式声明并通过完整验收。

最低验收：空目录安装 npm tarball、Host ESM/插件注册、真实 Loader/profile 启动、浏览器客户端模块加载、成员创建与模型/力度、运行/空闲消息、cold resume、完成/失败/取消与 fallback、任务终态与通知、retire 后不可复活、重启持久化。macOS/Linux/Windows 的安装与启动至少覆盖；契约行为测试使用可控 LLM，另有最小真实模型 smoke。不要以源码 typecheck 或 mock 出来的 API 对象替代发布产物验收。

## doctor 与准入必须放在 import/inject 之前

单在 `apply()` 内判断版本来不及：ESM 缺少 named export 会在模块链接时失败，Cordis required injection 缺失可能让 apply 根本不执行；浏览器端静态 import 也会先于 UI 友好提示失败。

建议两层：

- 独立 doctor/preflight CLI 用 Node 文件读取和模块解析获取 manifests/realpath，不执行宿主 JS，先报告实际依赖闭包、混装、版本支持状态和具体修复命令。它应能在主插件 import 已坏时独立运行；启动不能依赖实时访问 registry。
- 插件入口保持尽可能少的公共依赖；先选取已验证适配族，再动态加载该族 host/client 实现。版本特有服务不要列为所有版本共同的 required inject。方法能力检查验证“能否做”，支持矩阵决定“是否已经验收”；两者都需要。未知版本在开始创建成员/分配任务之前阻止 Teams 功能，并显示下一步，保持宿主其他功能可用。

关键禁止：不要以某能力缺失为由静默关掉失败上报/任务终态；不要用无限 catch + method name fallback 覆盖语义差异；不要把整个插件和 UI 永久绑定到 runtime internal 路径；不要靠 peerDependencies 警告充当完整准入。

## 验证与限制

已完成：官方/镜像 CLI tags 交叉查询；12 个关键 npm 包完整元数据与版本时间查询；7 个 GitHub release 查询；逐 tag 公开 subagent API 检查；Alpha.2→rc.1 和 rc.1→本地新源码 diff；公开 lifecycle payload 与模型 options 检查；profile bundle/fallback 源码检查；npm 自带 semver 4 条实测。

另在 `/tmp/dsh-resolution-0.1.2-alpha.2-20260905` 和 `/tmp/dsh-resolution-0.1.2-rc.1-20260905` 执行 `npm install --ignore-scripts --package-lock-only --no-audit --no-fund --registry=https://registry.npmjs.org`。两个命令均退出 0，输出 `up to date in 6m`，并写出 package-lock.json；于 2026-09-05 15:55 UTC 完成。该操作只解析/锁定依赖，没有将运行时安装到用户宿主、没有执行 lifecycle scripts，也没有启动 Harness。

完成的锁文件结果：

| 精确请求 CLI | 锁定 base/agent/subagent/session/app-boot/web-app/web-frontend/ui-chat/ui-conversation | 锁定 acp-app/sdk-app/sdk-minimal | Cordis |
|---|---|---|---|
| `0.1.2-alpha.2` | 全部 `0.1.2-rc.1` | 全部 `0.1.2-alpha.2` | `4.0.2` |
| `0.1.2-rc.1` | 全部 `0.1.2-rc.1` | 全部 `0.1.2-rc.1` | `4.0.2` |

该实验已证明 npm 在本次 registry 状态下的真实解析结果，尚未证明此混合树能够成功安装/启动或具有任何运行时兼容性。证据：[完整结果摘要](./dependency-resolution-evidence.json)、[Alpha.2 请求的锁文件解析记录](./dependency-resolution-evidence.json)、[rc.1 请求的锁文件解析记录](./dependency-resolution-evidence.json)。这也不代表精确 rc.1 在未来 registry 增长后仍自动解析出今天的树；复现应使用已冻结锁文件。

本审计没有执行真实 Harness UI/模型运行、没有验证任何候选插件发行版、没有执行 session migration。故推荐矩阵均为方案，不能作为已通过兼容认证。核心结论中的版本/tag/API 和 SemVer 行为是已观测事实，未来发布及支持周期是建议。
