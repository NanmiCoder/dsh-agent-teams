# AgentTeams 维护与发布流程

这套流程将社区 skills 用于真实仓库维护：记录问题和精确版本，审查贡献，实现与验证，再发布已经验收的同一份产物。先读 [skills/README.md](../skills/README.md)；上游 skill 的旧版本示例不覆盖本项目政策，已获用户授权的工作不重复确认。

## 一份支持清单

[compatibility.json](../compatibility.json) 是宿主矩阵的唯一来源。`scripts/compatibility.mjs` 校验精确开发依赖、声明的 peer 目标和依赖覆盖策略，并通过 `--github-output` 输出 CI matrix。不要在另一个脚本里维护第二份版本数组。

| 当前候选宿主 | 定位 | 安装与支持边界 |
| --- | --- | --- |
| `0.1.2-rc.1` | recommended | 当前普通用户默认组合的验收目标；RC 不是 GA，仍须实际验证 |
| `0.1.2-alpha.5` | preview | 主动选择的预览宿主；不能通过插件默认更新要求普通用户切到 Alpha |
| `0.1.2-alpha.2` | legacy | 兼容保留目标；必须检查完整依赖闭包，单独锁 CLI 仍可能混入 rc.1 分包 |

这里是当前候选代码必须通过的矩阵，不代表对应候选 npm 版本已经发布。增加或删除目标时同时调整清单、开发/peer 依赖和必要的适配，审阅解析后的锁文件，并跑完整矩阵。未来未知版本不能因 semver 落在宽范围内就自动获得支持。

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

## CI 的可检查证据

[verify.yml](../.github/workflows/verify.yml) 同时用于 PR、main 和发布前的可复用工作流：

| 阶段 | 实际检查 | 留下的证据 |
| --- | --- | --- |
| Ubuntu / Windows 静态检查 | Node 24、pnpm 10.33.0、frozen lockfile、typecheck、build、verify | 两个平台各自的任务日志 |
| Ubuntu 打包 | `pnpm pack --out` 生成真实 tgz，只生成一份候选 | `agent-teams-candidate` artifact 与文件 SHA-256 |
| 三版本真实宿主 | 从清单生成 matrix，每个精确宿主安装同一 tgz、检查闭包并运行产品入口 | 各宿主 `result.json`、闭包清单、fixture traces 与 stdout/stderr |
| 汇总门禁 | 所有任务成功；每份报告的宿主、插件版本、摘要与候选一致 | `Complete compatibility gate` |

runner 为 `scripts/harness-runtime-verify.mjs --host-version <exact> --artifact <tgz> --report-dir <directory>`。模型适配器使用可重复 fixture，宿主 CLI、profile、插件、工具、子代理和会话是真实实现。默认运行六段：正常生命周期、生命周期冷恢复、fallback、fallback 冷恢复、最终失败，以及队长实际结束回合进入 idle 后被成员通知唤醒。测试同时检查队员执行、忙/闲消息、顺序和推理力度；改变这些能力时需增加会准确变红的场景。

CI 仅上传报告、日志和 fixture 状态，不上传 runtime 的 node_modules、缓存、隔离 HOME 或整份 profile 存储。报告保留 14 天；发布维护者应将关键版本、摘要、结果和限制归档到发布记录，不能只留下会过期的临时目录。

自动矩阵的运行时平台是 Ubuntu。Windows 目前覆盖静态检查；真实模型 API、浏览器、Windows/Desktop 产品运行和用户数据迁移需要额外证据。UI 改动按 Ego Lite 规则验证真实宿主挂载和交互；有凭据的 provider 验证记录结果，不在仓库保存凭据。跳过、不适用和失败应分别记录，不能统一写“全部通过”。

## 发布同一份验收产物

[publish.yml](../.github/workflows/publish.yml) 必须等待整个 `verify` 可复用工作流成功。发布 job 下载该 run 的候选 tgz，重新核验 SHA-256、版本和完整宿主清单，再通过现有 npm OIDC trusted publishing 发布该文件；发布 job 不重新构建，也不以 `pack --dry-run` 作为门禁。

- 预发布插件版本（alpha / beta / rc）统一进入项目的 `next` 渠道。
- 无后缀插件版本才能进入 `latest`，开发基线必须是清单中的 recommended 宿主，全部支持目标都要通过。当前 recommended 为 `0.1.2-rc.1`，不得把只在 Alpha 通过的包提升为普通用户默认版本。
- 发版 tag 必须等于 `v<package.version>`，GitHub prerelease 标志与 npm 渠道一致。稳定发布前查询 npm 当前 latest，拒绝倒退。
- 准备 PR、版本或产物不表示已经发布。发布后读取 registry 的版本、integrity 与 dist-tag，并从 registry 再安装精确版本做消费者复验，记录与候选是否一致。
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
