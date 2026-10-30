# AgentTeams 维护与发布流程

这套流程将社区 skills 用于真实仓库维护：记录问题和精确版本，审查贡献，实现与验证，再发布已经验收的同一份产物。先读 [skills/README.md](../skills/README.md)；上游 skill 的旧版本示例不覆盖本项目政策，已获用户授权的工作不重复确认。

## 一份支持清单

[compatibility.json](../compatibility.json) 是宿主测试矩阵的唯一来源。`scripts/compatibility.mjs` 校验精确开发依赖、生成的安装下限和依赖覆盖策略，并通过 `--github-output` 输出 CI matrix。不要在另一个脚本里维护第二份版本数组。

**测试矩阵不是安装白名单。** 发布包只在 `engines.dsh` 声明一个下限 `>=<最旧的已测宿主或源码候选>`（当前 `>=0.1.2-alpha.2`），不设上限、不枚举版本；全部 DSH peer 写 `*`，只用于列出由宿主提供的包名。原因：

- 官方安装器从 0.2.1-alpha.4 起优先读 `engines.dsh`，0.1.7-rc.1 到 0.2.1-alpha.3 读 peer，两者都用 `semver.satisfies(..., { includePrerelease: true })`，下限之后发布的 RC/Alpha/正式版都能安装。
- npm 校验 peer 时不带 includePrerelease：peer 写 `>=0.1.2-alpha.2` 会让 npm 在同一依赖树中拒绝 0.2.1-rc.3 这类已测宿主（ERESOLVE），而 npm 对 `*` 直接放行。pnpm 与官方安装器不受影响。
- 0.1.27 及以前把矩阵逐个写进 peer，导致宿主每发一个新 RC（rc.4、rc.5 成为 npm `latest` 时）插件就整体拒装，只能再发插件补救。

不要恢复这种写法，`verify:compatibility` 会拒绝 peer 范围、`engines.dsh` 列表和上限。宿主若确实破坏了插件依赖的接口，应在运行时给出明确诊断（见 `harness-compat` 能力检测），而不是在安装时预先拒绝所有未测版本。

升级前运行 `pnpm check:upstream`：只读查询官方宿主 `latest` / `next` 和插件 `latest`，分别报告已发布插件声明拒装的宿主渠道（`blockedChannels`，用户已无法安装，最紧急）、尚未进入测试矩阵的宿主（`unverifiedChannels`，可安装但待验证）与发布包尚未覆盖的已测目标。发现差距时退出 1；网络失败、缺失渠道或无法识别的声明不会被当作成功。它不自动修改清单、安装、发布，也不作为离线回归的联网前置条件。当前是按需命令，没有自动定时任务；其他渠道或未挂 tag 的版本仍须显式核对。

完成精确源码/产物审计后修改测试矩阵。新增较新的宿主只扩大 CI 矩阵，不改变发布的安装下限。下限仍取自矩阵：加入更旧的宿主或源码候选会降低它，删除当前最旧的宿主会抬高它（被删版本此后安装会被拒绝）。变化后运行 `pnpm sync:compatibility` 改写 `engines.dsh`，再运行 `pnpm verify:compatibility`。生成器不会添加宿主、改变开发基线或修复混装；后两者仍按明确迁移另行处理。

`scripts/harness-validation.mjs` 从同一清单生成执行目标并校验对应报告。新目标默认 Ubuntu + Windows，并必须通过真实 `plugin-manager-install`；无需更新脚本或 YAML 中的版本数组。旧目标的 `platforms` 与 `legacyDirectInstallReason` 显式记录历史覆盖限制，不能作为新增目标时复制的默认模板。新增例外须说明实际原因并审查。尚未列入支持清单的候选也会运行安装探针；探针通过本身不授予支持资格。

发布前源码预适配记录在同一清单的 `sourceCandidates`，包含预计版本、官方源码完整 SHA 和证据路径。源码候选只要不低于下限即自动可安装；`--github-output` 仍只输出 `supportedHosts`，不会尝试下载尚未发布的 npm 版本。doctor 将候选标为 `source-preview`，保留完整依赖闭包检查，不将文件版本检查当作正式产物验收。发布后核对最终 SHA 与分包产物，完成 npm 和桌面验收，再把该目标从 `sourceCandidates` 移入 `supportedHosts` 并按需要更新开发基线。当前工作见 [0.2.1-rc.3 适配](./harness-0.2.1-rc.3/README.md)。

| 当前候选宿主 | 定位 | 安装与支持边界 |
| --- | --- | --- |
| `0.2.1-rc.3` | preview | 已发布 npm 精确目标；先进入矩阵，推荐宿主与开发基线仍为 rc.2 |
| `0.2.1-rc.2` | recommended | 已发布 npm 精确目标；RC 不是 GA |
| `0.2.1-rc.1` | legacy | 保留上一推荐 RC |
| `0.2.0-rc.2` / `0.1.7-rc.2` | legacy | 保留此前推荐版本 |
| `0.1.5-rc.3` / `0.1.5-rc.2` / `0.1.5-rc.1` | legacy | 保留旧 RC；每个精确版本独立验证完整依赖闭包 |
| `0.1.2-rc.1` | legacy | 保留旧 RC；与新版使用隔离的 profile 与会话副本 |
| `0.1.2-alpha.5` | preview | 主动选择的预览宿主；不能通过插件默认更新要求普通用户切到 Alpha |
| `0.1.2-alpha.2` | legacy | 兼容保留目标；必须检查完整依赖闭包，单独锁 CLI 仍可能混入 rc.1 分包 |

这里是当前候选代码必须通过的矩阵，不代表对应候选 npm 版本已经发布。增加或删除目标时同时调整清单、开发依赖和必要的适配，审阅解析后的锁文件，并跑完整矩阵。不在矩阵内但高于下限的宿主可以安装，doctor 将其标为 `untested`（不算失败）；“已测”与“允许安装”是两件事。

旧的 `0.1.0-*`、`0.1.1-*` 宿主不在此候选矩阵中。保留其已工作的精确插件版本，或整体迁移到验收过的宿主/插件组合；不要只更新一端。历史记录中，`0.1.1-rc.2` 配插件 `0.1.10` 的精确安装已由维护者验证，可在该旧宿主上使用：

```sh
dsh plugin --profile web add --save-exact @nanmicoder/dsh-agent-teams@0.1.10
```

这是旧组合的恢复参考，不是对所有旧 RC 或当前 Desktop 的支持承诺。Desktop 用户还要核对内置核心和实际 profile；安装全局新 CLI 不会更换桌面内核。修改 npm dist-tag 也不会撤销既有 profile 中的宽依赖范围或已安装包。

## 从报告到实现

1. 用 `plugin-workflow` 记录所选维护阶段；通过 `plugin-runtime-debug` 确认实际加载路径、profile 和失败服务。保留未修改的报错与最小复现。
2. 版本迁移使用 `plugin-upgrade` 的扫描与 `dsh-upgrade-audit` 的精确官方源码/产物对比。检查生命周期、消息、事件与会话、模型、客户端、鉴权和发布依赖；版本卡零命中不等于没有风险。
3. 按当前 PR head 审查，不以标题、旧测试记录或 GitHub 的无冲突状态代替证据。独立贡献分别验证；重叠的生命周期修复统一到适配边界，再将采用的代码和用例回链到贡献者 PR。
4. 用 `plugin-test` 选择相应测试。核心能力缺失必须得到清楚诊断，不能把失败上报、模型选择或投递静默变成 no-op。已修复的输入校验、staged 审批和权限限制必须保留。
5. 保留每位作者的署名；改写或合成补丁时记录原 PR 和相应贡献，适用时使用 `Co-authored-by`。未采用部分应说明具体原因和下一步，而不是笼统关闭为“不兼容”。

只读安装诊断可以从源码或发布包运行：

```sh
node scripts/doctor.mjs \
  --host-root "/actual/path/to/the/running/dsh/package" \
  --profile-root "/actual/path/to/the/profile" \
  --json
```

doctor 检查给定路径解析到的包版本、混装和重复身份，不执行插件、不修改配置，也不能自动证明该路径就是正在运行的进程。它的成功结果不是模型、UI 或任务完成的证明。

## 从源码安装与测试 Alpha

在插件 checkout 中构建同一份待验收产物：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm verify
pnpm pack --out ./agent-teams-candidate.tgz
```

准备一个已配置 Web 入口的独立测试 profile（以下为 `agent-teams-preview`），检查实际宿主后安装：

```sh
node scripts/doctor.mjs --host-root "/actual/host/package/directory" --json
dsh plugin --profile agent-teams-preview add --save-exact /absolute/path/agent-teams-candidate.tgz
node scripts/doctor.mjs --host-root "/actual/host/package/directory" --profile-root "/actual/test/profile/directory" --json
dsh --profile agent-teams-preview --dump-config
dsh --profile agent-teams-preview
```

源码更改后需要重新构建、打包和重启。`doctor` 通过不替代建队、任务与 UI 验收。

Alpha 测试必须锁定整组宿主依赖；`^0.1.2-alpha.2` 不表示只接受 Alpha.2，精确 CLI 版本的间接依赖仍可能解析到 rc.1。本仓库使用精确开发依赖、整组 `pnpm.overrides` 和 frozen lockfile。以下命令创建独立临时安装、profile 和工作区，安装同一份 tgz 并核对解析结果：

```sh
node scripts/harness-runtime-verify.mjs \
  --host-version 0.1.2-alpha.2 \
  --artifact ./agent-teams-candidate.tgz \
  --report-dir /tmp/agent-teams-alpha2-check
```

该命令会下载宿主，使用固定模型响应和真实 CLI、插件、会话、工具与子代理，不修改已有用户 profile。升级时保留已验证的锁文件；不要通过删除凭据或 `.agent-teams` 处理版本错配。

历史 `0.1.0-rc.8` + 插件 `0.1.14` 组合需固定两端。历史 [Alpha.2 兼容记录](./alpha2-compatibility.md)与[验收报告](./alpha2-release-acceptance.md)只描述当时版本，不覆盖当前清单。

## CI 的可检查证据

[verify.yml](../.github/workflows/verify.yml) 同时用于 PR、main 和发布前的可复用工作流：

| 阶段 | 实际检查 | 留下的证据 |
| --- | --- | --- |
| Ubuntu / Windows 静态检查 | Node 24、pnpm 10.33.0、frozen lockfile、typecheck、build、verify | 两个平台各自的任务日志 |
| Ubuntu 打包 | `pnpm pack --out` 生成真实 tgz，只生成一份候选 | `agent-teams-candidate` artifact 与文件 SHA-256 |
| 清单内全部真实宿主 | 从清单生成 matrix，每个精确宿主安装同一 tgz、检查闭包并运行产品入口 | 各宿主 `result.json`、闭包清单、fixture traces 与 stdout/stderr |
| 汇总门禁 | 所有任务成功；每份报告的宿主、插件版本、摘要与候选一致 | `Complete compatibility gate` |

runner 为 `scripts/harness-runtime-verify.mjs --host-version <exact> --artifact <tgz> --report-dir <directory>`。模型适配器使用可重复 fixture，宿主 CLI、profile、插件、工具、子代理和会话是真实实现。当前运行十个场景：正常生命周期及冷恢复、fallback 及冷恢复、最终失败、队长 idle 唤醒、渐进入口、Web 审批、协议兼容和稳定性。测试同时检查队员执行、忙/闲消息、顺序和推理力度；改变这些能力时需增加会准确变红的场景。

CI 仅上传报告、日志和 fixture 状态，不上传 runtime 的 node_modules、缓存、隔离 HOME 或整份 profile 存储。报告保留 14 天；发布维护者应将关键版本、摘要、结果和限制归档到发布记录，不能只留下会过期的临时目录。

当前自动矩阵包括全部 11 个目标的 Ubuntu runtime，以及 rc.2 / rc.3 的 Windows runtime，共 13 个宿主/平台目标。真实模型 API、原生 Desktop 交互和用户数据迁移仍需要额外证据。UI 改动按 Ego Lite 规则验证真实宿主挂载和交互；有凭据的 provider 验证记录结果，不在仓库保存凭据。跳过、不适用和失败应分别记录，不能统一写“全部通过”。

## 发布同一份验收产物

[publish.yml](../.github/workflows/publish.yml) 必须等待整个 `verify` 可复用工作流成功。发布 job 下载该 run 的候选 tgz，重新核验 SHA-256、版本和完整宿主清单，再通过现有 npm OIDC trusted publishing 发布该文件；发布 job 不重新构建，也不以 `pack --dry-run` 作为门禁。

- 新的预发布插件版本（alpha / beta / rc）首次发布进入项目的 `next` 渠道；已验收的 RC 产物可经维护者明确决定，用 `npm dist-tag add` 将同一不可变版本提升为 `latest`，不重新打包。
- 无后缀插件首次发布及 RC 产物提升到 `latest` 时，开发基线必须是清单中的 recommended 宿主，全部支持目标都要通过。当前 recommended 为 `0.2.1-rc.2`，不得把只在 Alpha 通过的包提升为普通用户默认版本。
- 发版 tag 必须等于 `v<package.version>`，GitHub prerelease 标志与插件版本后缀一致；将 RC 提升到 npm `latest` 不会改变其 GitHub 预发布身份。稳定发布前查询 npm 当前 latest，拒绝倒退。
- 准备 PR、版本或产物不表示已经发布。发布后读取 registry 的版本、integrity 与 dist-tag，并从 registry 再安装精确版本做消费者复验，记录与候选是否一致。
- **已发布不等于桌面端 npm 入口已就绪。** 桌面端实际观察到 pnpm 11.28.5；默认 `minimumReleaseAge=1440` 分钟可能把 `@latest` 解析为旧版。精确版本、tgz 和 pnpm 10 的成功不能代替这个入口。CI 在 Ubuntu/Windows 用真实 pnpm 11 和临时 registry 验证“新发布回退旧版 / 满等待期选择新版 / registry 错误不能报成功”。
- 正式发布后用 `node scripts/check-install-channel.mjs --pnpm-cli <pnpm-11.28.5/bin/pnpm.mjs> --registry https://registry.npmjs.org --expected-version <本次版本>` 检查默认等待期下实际选择；大陆镜像再跑一次。返回 1 表示选择的版本不是本次发布，不能宣称 npm 桌面安装已就绪；网络或工具异常同样不能算通过。该探针只验证包管理器解析，实际宿主加载仍由 runtime/桌面验证承担。
- 首日 npm 渠道未就绪时，在 Release 中明确状态，提供已验收的 `github:NanmiCoder/dsh-agent-teams` 入口（需要 GitHub 网络），或等待 npm 版本满 24 小时。不要让用户逐次改版本例外，也不要关闭全局等待期或兼容检查。插件还没安装时无法替宿主改变这些策略。
- 回退分别处理 npm dist-tag、用户 profile/锁文件和数据；保留不可变版本及 Git 历史。不通过删除或重指向 Git tag 来冒充 npm 回滚。

当前 GitHub workflow 的 OIDC 写权限只授予 publish job；PR 和验收任务仅有仓库读取权限，无须真实模型密钥。新增的 GitHub artifact actions 固定到已审阅的 commit：upload `ea165f8d65b6e75b540449e92b4886f43607fa02`、download `d3f86a106a0bac45b974a628896c90dbdf5c8093`。下载 action 对摘要不符只发 warning，因此本工作流另外对候选文件做强制 SHA-256 校验。

## Issue 与 PR 的结束条件

每次跟进分别写清：

| 状态 | 必须能够链接的事实 |
| --- | --- |
| 已合并 | 当前 main 的 commit/PR；不暗示 npm 已更新 |
| 已发布 | 精确插件版本、npm 渠道与发布产物 |
| 已验证 | 精确宿主/插件/平台/profile、运行结果和未覆盖范围 |

已复现故障在对应修复与验收完成后关闭；若要等发布，明确说明仍在等待发布。重复报告可以关闭并指向主跟踪，但保留其独有平台或触发步骤。功能提议、证据不足和外部邀请分别处理，不能将所有“版本相关”问题批量标成 resolved。#125 的 claim/dispatch、#106 的请求上限和资源/并发问题各有独立行为边界，不会因为宿主能启动就自动消失。
