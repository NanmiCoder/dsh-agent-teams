# Harness 0.2.2-rc.2 本机兼容修复

2026-11-13，AgentTeams `0.1.29` 在官方 macOS 桌面版 Harness `0.2.2-rc.2` 中启用失败：

```text
agent-teams: unsupported Harness subagent contract (cannot install complete retired-member guard)
```

核对对象为 `/Applications/DeepSeek Harness.app` 中实际嵌入的 `dsh-subagent@0.2.2-rc.2`、同版本 npm 完整依赖闭包，以及官方 tag `dsh-v0.2.2-rc.2`（`ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`）。参考源码为 `/Users/nanmi/workspace/github/deepseek-harness`。终端默认 `/opt/homebrew/bin/dsh` 仍为 `0.1.7-rc.2`，不是故障桌面进程。

## 已核实的变化与适配

| 变化 | 影响与修复 | 证明 |
| --- | --- | --- |
| 删除 `Symbol.for('dsh.subagent.deliverPrompt')` 和 `./internal` 导出 | 插件无法安装完整退役保护、生命周期 setup 和 FIFO 投递。新分支保留 native tree manager 的 `deliverToMember`、root authority、queue/steer、来源、取消与冷恢复事务；退役保护覆盖宿主、模型和 browser prompt 的共同入口。 | 修前真实宿主出现相同错误；修后队员执行、连续消息、冷恢复、网页审批与归档通过。 |
| `startActivation` 参数由 `request.parent/prompt/agentOptions` 改为顶层字段 | 适配创建参数和创建保护，保留队员 persona、工具范围、模型与推理力度的同步恢复。 | 平铺参数回归、真实首请求与冷恢复验证。 |
| 删除 `drainChildren`，`drainDescendants` 变成整个 root tree 的关闭操作 | 按选定成员及 creation ancestry 取消并等待进行中的创建/投递，再释放对应 activation；保留无关 sibling 与 root 的运行能力。 | 等待进行中创建的定向回归；真实任务重分配、嵌套分支归档、未消费消息清理与 sibling 保留。 |
| 结算通知正文使用具名路径，新增结构化 `stopReason` | 成功通知去重改读 `stopReason`，历史通知仍按旧版精确正文判断。失败、未报告结果与未结束任务仍会通知队长。 | 修前具名通知回归失败；修后真实宿主重复报告与结算均不重复唤醒。 |

新版 FIFO 和定向释放仍依赖经过本次精确源码/产物核验的 manager 内部边界；宿主尚未提供等价公共 API。适配集中在 `src/harness-compat.ts`，不改宿主，也不将 host-authored 消息伪装成 browser/model 消息。不完整的新 manager 结构仍会明确拒绝激活。

## 验证结果与范围

开发依赖保持原有精确 `0.2.1-rc.2` 闭包；更改前的 typecheck、build、`verify:harness-contract` 通过。更改后的 typecheck、build、完整 `pnpm verify`、新增失败转成功回归和 `git diff --check` 通过。

在隔离 npm `0.2.2-rc.2` 环境中检查了 **327 个精确同版本 DSH 包**。先安装原始源码构建包，真实 CLI 启动复现截图错误（[修前报告](./baseline-0.2.2-rc.2.json)）；最终修复包通过全部 **11 项**（[最终报告](./runtime-0.2.2-rc.2.json)）：

- lifecycle、lifecycle-cold-restore、fallback、fallback-cold-restore、failure。
- captain-idle-wakeup、progressive-entry、web-approval、protocol-compatibility、stability。
- plugin-manager-install，无版本豁免。

运行环境为 macOS arm64、Node `26.7.0`。真实 Loader、Agent、模型调用管线、工具、持久化与审批接口均运行；模型响应来自确定性本地 adapter。没有调用真实模型提供方、真实付费 API 或用户历史数据迁移。以上 JSON 记录的是本机修复构建的验证，Windows/Linux 的发布验证由下述 CI 门禁单独承担。

## 0.1.30 发布准备

用户随后授权提交并发布 `0.1.30`。该候选把 `0.2.2-rc.2` 加入 preview 矩阵，推荐宿主和开发闭包保持 `0.2.1-rc.2`；发布要求全部 13 个宿主、17 个 Ubuntu/Windows 目标通过同一份候选归档的完整兼容性门禁。此处的本机 `0.1.29` 报告不替代最终版本的 CI 证据。

首次 CI 在 Linux/Windows 上暴露检查器的问题：npm lockfile 保留 `dsh-experimental-cua-macos`，但该包声明 `optional: true`、`os: [darwin]`，npm 在其他系统上正确地不安装它。原校验器在运行场景前就读取这个不存在的文件。新的 cohort 检查仅跳过被 `os`/`cpu` 明确排除的可选缺失包，并在 `cohort.json` 的 `skipped` 记录；锁文件版本仍必须一致，适用平台的可选缺失包、必需缺失包和磁盘版本混装仍拒绝通过。平台回归覆盖 Linux、Windows、macOS 和 CPU 约束。

仓库 `publish.yml` 已通过 npm OIDC trusted publishing 发布 `0.1.29`，未读取 `NPM_TOKEN`，仓库 Actions Secrets 为空。npm 通知中的 `aa` Token 已过期，但不属于这条工作流的认证依赖。本次继续使用既有可信发布关系，不创建或上传不需要的长期 Token。发布结果及最终归档摘要以对应 Actions run 和 GitHub Release 为准。

最终包 SHA-256：`2d3500f3ee3e60713cc6e4784eec7e15c644d11d9a47b0c8f0b6ba5b97970013`。可按以下命令重跑精确宿主验证，报告目录应使用新的隔离路径：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm verify
pnpm pack --out /tmp/agentteams-fixed.tgz
node scripts/harness-runtime-verify.mjs --host-version 0.2.2-rc.2 --artifact /tmp/agentteams-fixed.tgz --report-dir /tmp/agentteams-022rc2-new-check
```

## 本机恢复与回滚

使用桌面版随附 CLI carrier，在应用正常退出后安装修复 tarball，再重新启动应用。桌面插件详情由“异常 / 1 异常”变为 **“共 1 个 · 1 运行中”**，开关保持启用。实际安装的 `lib/harness-compat.js` 与工作区产物字节一致。

- 本机安装源：`/Users/nanmi/.dsh/plugin-artifacts/agentteams-0.1.29-harness-0.2.2-rc.2-local-20261113.tgz`。
- 原始插件、profile manifest/lockfile/配置备份：`/Users/nanmi/.dsh/backups/agentteams-022rc2-20261113-local-fix/`。
- 首次本机恢复时插件版本为 `0.1.29`，安装来源明确为本地 tarball；该阶段没有发布 npm 包或修改宿主安装。后续 `0.1.30` 发布是单独授权的操作。

若需恢复 registry 原包，先正常退出桌面版，再使用其 carrier：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add --save-exact @nanmicoder/dsh-agent-teams@0.1.29
```

原始 `0.1.29` 在这个宿主上会恢复已复现的启用失败。需要逐字节恢复本次涉及的 profile 文件时，从上面的备份选择对应文件，先确认本次操作后没有其他配置变更；不要覆盖整个 `.dsh` 或会话数据。
