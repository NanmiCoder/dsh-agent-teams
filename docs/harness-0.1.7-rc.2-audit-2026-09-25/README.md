# Harness 0.1.7-rc.2 适配与 #185 / #187 根因审查

本地候选：AgentTeams `0.1.21-rc.1`，尚未发布。基线仓库 `1487f33` / 插件 `0.1.20`，开发宿主 `0.1.5-rc.1`。本次同时同步维护 skill、迁移源码和测试、升级本机 CLI；没有修改 Harness 实现来掩盖插件不兼容。

后续已将本次适配与本地 main 的 #159 业务修复整合；**整合产物的重新验收见 [main 整合审查](./main-integration/README.md)**。下文原测试记录保留为适配阶段历史，产物摘要不同，不混用。

## 结论

不是每次上游发版都会把同一处代码破坏。**#185 是精确支持清单拦截；#187 有真实 API 不兼容。** 上游确有删除、重命名和生命周期语义变化，插件也存在直接依赖易变接口、测试只覆盖旧契约、更新支持清单滞后的问题。仅升级 Harness 不会修好插件；不带版本的安装还可能选到不同发布渠道。

查询时 npm `latest=0.1.5-rc.3`、`next=0.1.7-rc.2`、`alpha=0.1.7-alpha.2`。本机提供的源码目录 HEAD / origin/master / `dsh-v0.1.7-rc.2` 均为 `477b4f420553e8a52c2fbccc464d7561b239c443`。旧 tag 为 `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`，merge-base 等于旧 tag。区间共 3,654 个提交（2,437 非 merge）、8,961 个文件。此报告聚焦外部契约和 AgentTeams 实际触点，不声称逐条证明每个提交没有其他破坏。

## 两个 issue 的证据

- [#185](https://github.com/NanmiCoder/dsh-agent-teams/issues/185)：截图显示插件 `0.1.20` 声明只支持四个精确版本，宿主 `0.1.5-rc.2` 不在其中，安装界面主动阻止更新。没有队员报错堆栈。rc.1→rc.2 的 agent/subagent/llm 核心源码未发生本报告列出的生命周期变化；客户端 current、openSubagent 和旧图标也仍存在。加入实际验证过的 rc.2/rc.3 才能解除这类拦截。
- [#187](https://github.com/NanmiCoder/dsh-agent-teams/issues/187)：报告 `0.1.6-alpha.2` 面板无法正确调起、任务无法启动，后续请求 0.1.7 RC。下列两项变更正好在该区间出现：`agent/session-start` 消失，`sessions.list.current` 消失。真实用户机器没有采集到完整堆栈，因此是源码/复现支持的解释，不冒称已定位所有用户环境里的唯一原因。

## 已确认的破坏与修复

| 接口 | 首个相关版本/提交 | 对插件的影响 | 本次处理 |
| --- | --- | --- | --- |
| `agent/session-start` 删除，`agent/created` 改为 awaited serial、增加 source | `0.1.6-alpha.1` / `9b7a8ccc9f` | 队员模型、推理力度、失败恢复与权限初始化监听不再运行 | 集中 `onAgentReady` 适配；旧 created 缺少 source 时等待旧事件；新初始化失败直接拒绝创建 |
| `SessionListState.current`、sessions.open/openSubagent 移除 | `0.1.6-alpha.2` / `6830e1460d` | 面板 current 永远 undefined；旧回退调用不存在的方法 | 从 `byId` 中的 `retainedBy.mainView` 找当前会话；新宿主用 uiWorkspace 的持久子会话地址导航，旧宿主保留原路径 |
| 五个带 16/14 后缀的图标导出改名 | `0.1.7-alpha.1` / `4937343a5e` | 客户端编译/模块加载失败 | 使用插件拥有的简小 SVG，去掉对生成图标名称的依赖 |
| 通用 `MessageSourceMap.plugin` 删除 | `0.1.7-alpha.1` / `fb79a944f5` | 来源声明失效，旧测试筛选也失效 | 声明 `agent-teams` 专属来源，统一六个生产点和测试观察器 |
| `ToolResultBlock` 删除，结果改为 role:tool + 顶层 isError | `0.1.7-alpha.1` / `f4a32dbd0a` | 失败结果可能错误显示为成功团队卡片；测试读不到工具回执 | 同时识别旧嵌套与新顶层错误；固定响应模型读取两种实际消息结构 |
| codeRuntime→ptcRuntime，worker-thread 包移除 | `0.1.6-alpha.1` | 测试夹具无法加载，或等待已不存在的必需服务 | 测试挂载真实 Node PTC、文件/子进程/沙箱/投影服务；产品入口测试不再依赖旧服务名 |

主要源码证据：

- [Agent 生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/core/agent/src/runtime-types.ts) 与 [announce 的 serial 调用](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/core/agent/src/index.ts)。
- [Session 客户端契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/api/session-controller/src/client/contract/sessions.ts)、[官方 current 推导](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/client/ui-layout/src/client/DocumentTitle.tsx)、[Workspace 导航](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/client/ui-workspace/src/client/navigation.ts)。
- [消息来源和工具结果](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/llm/llm/src/message.ts)、[图标导出](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/client/ui-primitives/src/icons/index.tsx)。

### 不能误判成删除的接口

`Symbol.for('dsh.subagent.deliverPrompt')` 的签名和 queue/steer 入口保持；`sendMessage`、两个 drain API 保持。`shell.overlay`、`conversation.chat.node`、`conversation.chat.commandview`、`UsePanelInfo` 和 `uiConversation.events.register` 仍然存在。新版工具结果仍有 `source.kind=tool` 和 `source.callId`，卡片关联不需重写。

新 subagent activation 限额默认 8，idle 驻留成员仍占容量（`0.1.6-alpha.2`）；本次真实测试验证常规团队，不声称超过宿主限额的团队会被插件自动扩容。

## 回滚、数据和依赖：谁的责任

1. **上游确有方向性回滚。** `e07f41d5fd8ca172287fda0f923b4d1f69c592f3` 回滚 Cordis transactional reload：两端 `internal/update` 从允许 Promise 改为 void，fiber.update 不再返回等待链。插件没有直接调用这些接口，不能把此回滚当两个 issue 的直接原因。其余 UI revert 很多是撤回区间内新增功能，不按 commit 标题直接计为相对基线的破坏。
2. **会话 V3→V4 有迁移，不是无迁移硬断。** `session-format-catalog` 注册真实 V3→V4 转换；JSONL catalog-migration 收集历史 children evidence，生成新 immutable generation。旧 reader 拒绝未来格式；降级 CLI 不会把新写入的 V4 内容还原。实际 SQLite storage schema=1、session-query schema=8 两端未变；skill 中旧 SQLite persistence 路径已不适用。
3. **旧 npm 分包范围是上游发布风险。** `dsh@0.1.5-rc.1` 的分包使用 `^0.1.5-rc.1`，只锁 CLI 仍可能漂移。新 `dsh@0.1.7-rc.2` 已精确锁住 DSH 分包，Cordis 使用 `~4.0.4`、Schemastery 使用 `~3.18.4`；不能说上游完全没治理。
4. **插件自身的依赖对齐必须包括共享内核。** 本次只升级 DSH 分包后，旧锁文件保留 Cordis 4.0.2 和 Schemastery 3.18.2，造成多份同名服务。doctor 确实报错；改为开发依赖 Cordis 4.0.4 / Schemastery 3.18.4 后，273 个 DSH 包检查通过。没有关闭诊断器来掩盖重复实例。
5. **新宿主启动成功不等于插件成功。** compatibility-preflight 会禁用不匹配 peer 的插件；auditStartupEntries 对非 required 失败允许 warning 后继续启动。必须验证实际业务与 UI，不能拿 HTTP 200 或 dsh --version 作为兼容结论。

## Skill 更新

从 [上游](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/tree/eeff1cdcffe4013e094d94c8d9b8651a65fbc79a) 固定导入 `eeff1cdcffe4013e094d94c8d9b8651a65fbc79a`：10 个上游 skill、127 个文件，保留原文、哈希与执行位。新增 generic-migration 单独审阅并补发现链接；其余由项目更新器预览、导入。包含自有 skill 的镜像共 11 个 skill、128 个文件。镜像验证和更新器回归通过。

新卡片只覆盖到 `0.1.6-alpha.1`，后面的接口必须继续读准确源码。本次同步 skill 没有自动修好运行时；skill 是审计方法，不是保证兼容的自动补丁。

## 验证证据与边界

基线先以原 frozen lockfile 安装，build + verify 通过；没有把既有失败算成迁移回归。

- 候选 `pnpm build`、`pnpm verify`、`pnpm verify:skill`、更新器测试通过；新增 created admission、清理、主视图识别、两代导航和失败工具结果回归。
- [七版本矩阵](./matrix.json)：同一候选 tgz，7 个精确宿主 × 10 个产品入口场景全部通过。每个版本均核对整个 DSH 依赖闭包；`runtime-*.json` 保存测试脚本哈希、产物 SHA、逐项结果和边界，`cohort-*.json` 保存解析身份。固定响应只替换外部模型，CLI、Loader、会话、工具、调度、队员和 PTC 都是真实实现。
- 最新 RC 用 Ego Lite 打开真实 Web profile，输入请求，观察任务 1/1 完成与队员回报；展开完成成员并打开成员会话，刷新后仍可读取 SECOND_WAKE_OK，面板在成员视图正确隐藏。见 [面板截图](./panel.png)、[成员截图](./member.png) 和相邻 snapshot 文本。
- `skipLibCheck:false` 额外诊断发现上游公开 d.ts 引用了未提供的 lexical/mdast 类型，以及客户端 tsconfig 尚未加载 Disposable lib；详见 [原始诊断](./declarations-diagnostic.log)。正常 strict 源码检查通过，但不声称上游全部声明无错误。
- 实机为 macOS arm64 / Node 26.7.0；本次没有重跑 Windows/Linux 和 Desktop 内嵌宿主。真实用户历史数据迁移未执行；所有验证写入独立目录。

真实 DeepSeek Flash 验收另记下方，不与固定响应矩阵混算。

最终打包仅修正中英文 README 中未发布候选的安装说明；其余 99 个包内文件（含 lib、assets、manifest、兼容清单）逐字节相同。原测试产物与最终产物的 SHA 和差异见 [artifact-equivalence.json](./artifact-equivalence.json)，不把两个 tgz 冒称为相同文件。

## 真实 DeepSeek Flash：首轮与续跑分别记账

真实 provider 为 `deepseek-official`，model 为 `deepseek-flash`，使用已有凭据引用；报告不保存密钥。真实工作区 `/tmp/agent-teams-flash-017rc2/candidate/workspace`，队长及六位队员编写 MiniFulfill 的定价、库存、存储、HTTP、CLI、测试和交付文档。验收程序运行在工作区外，保护原始规格/fixtures/测试不被替换。

首轮 **未通过**：约 18.9 分钟，220 次真正 provider 请求，另两次请求尝试被测试器预算直接拒绝；10 项任务中前 9 项完成，RELEASE 因预算失败（交付文件已写出）。没有 provider API 错误。外部 32 项检查通过 30 项：库存释放后重放相同订单错误地再扣库存，确实违反规格；CLI 将 `CATALOG_JSON/LINES_JSON` 当作内联 JSON，而 oracle 传文件路径，原规格措辞存在歧义。两者是业务输出/验收规格问题，不能归咎为 Harness 生命周期不兼容。见 [首轮原始判定摘要](./flash-first-run.json)。

续跑保留原团队、成员和工作区，重启真实宿主。明确传递失败输入与 CLI 文件路径语义，要求原队员经 review→automatic repair→re-review 修复，并重试原 RELEASE。没有手工改模型生成的业务代码。由于修复需要新增质量闭环任务，临时续跑 runner 将“任务总数完全相等”改为“原任务全部保留且两个自动修复及复审完成”；原始业务 oracle、受保护文件检查和原 10 项 DAG 检查保留。这个阶段是人工诊断反馈后的续跑，不能宣称首轮自主通过。完整[追加提示](./flash-continuation-prompt.txt)和[runner 差异](./flash-continuation-runner.diff)随报告保留。

续跑 **通过**：167 次真实 provider 请求、470.5 秒，外部 **32/32** 检查全部通过，受保护文件未改变；同一团队和六位成员恢复成功、原 10 项任务保留。两项阻断审查失败后生成两个 repair 和两个独立复审，另有两项测试更新任务；所有返工、复审、验证和原 RELEASE 完成。trace 中人工调用 create_task(kind=repair) 次数为 0。期间还通过正式契约修订纠正了首轮库存任务继承的错误 verify 断言。详见 [续跑判定与来源](./flash-continuation.json)。两轮合计 387 次真正 provider 请求（首轮另两次预算拒绝不计入），无 provider API 错误。

这证明本候选在真实 Flash、真实工作区上的建队、工具执行、调度、冷恢复、自动质量闭环和业务交付能够完成；不证明一次提示就必定产出正确业务代码，也不是多轮统计成功率、旧版本 A/B 优劣或真实模型浏览器操作的证明。先前浏览器验收使用固定响应，与此真实 provider 记录分开。

## 防止重复出现

- 保留精确验收矩阵，不把 peer 改成宽 `<0.2.0` 来取消报错。每次上游发布先判定只是声明缺口还是接口变化，再增加实际验证过的精确版本。
- 将升级检查对象明确为 CLI + 全部 DSH 分包 + Cordis/Schemastery + 当前 profile + 浏览器 bundle。仓库开发依赖和用户实际 profile 不是同一个安装。
- 把生命周期、消息、会话选中/导航和内部投递收拢到少数适配边界，减少业务代码直接触碰宿主实现；小图标由插件拥有。内部 Symbol 投递仍是维护风险，当前没有擅自换成语义不同的 sendMessage。
- CI 当前只验证清单内版本，无法提前发现未纳入矩阵的上游发布。新版本验收应包含源代码差异、完整静态门禁、固定响应真实宿主、真实模型、浏览器和旧版本回归；通过后更新清单，最后发布候选。未发布的本地修复不能让 npm 用户自动获益。
- 会话升级前备份数据；回滚代码、全局 CLI、profile lockfile、已迁移数据须分别处理。

## 本机状态

全局 `/opt/homebrew/bin/dsh` 已从 `0.1.5-rc.1` 对齐到 `0.1.7-rc.2`，全局依赖检查通过。用户提供的 Harness checkout 原本就已在目标发布提交，本次仅 fetch 并审计，没有改写源文件。

用户已有多个历史 profile，其中默认 web 仍安装 AgentTeams 0.1.17，并有旧 peer 包；本次尚未改写这些用户 profile。候选在隔离 profile 中验证，不应把全局 CLI 升级说成用户所有 profile 的插件也已升级。
