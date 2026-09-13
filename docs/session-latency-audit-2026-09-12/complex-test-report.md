# 复杂真实实现与返工实测

2026-09-13。已完成用户要求的复杂真实实现、恢复及自动返工验证。最终工作流通过；历史超时和中止阶段原样保留，不改记为通过。

## 场景和执行边界

MiniFulfill 是从待实现模块开始的持久化订单服务。6 个真实成员、10 个初始任务，依次覆盖需求验收、三个并行基础模块、HTTP/CLI、单元/集成测试、独立审查和交付。随后在同一个团队追加 7 项任务：对一个明确标注的计价回归和一个自然发现的取消原子性缺陷进行双路审查、自动修复、再审及下游交付。

CLI 与 Agent cwd 均为 `/tmp`，项目位于 `/tmp/agentteams-complex-20260913-run3/candidate/workspace`。独立 profile 使用本机已配置的 `deepseek-official / deepseek-flash / max` 和现有 credential 引用。未修改用户日常 profile，也未把密钥复制到测试目录。模型自行规划、写代码和调用工具，测试器不伪造回答，不代写业务实现。

外部验收脚本放在模型项目之外，最初检查 31 组行为，包括 32 请求争抢 20 单位库存、16 个相同幂等键、并发取消、持久化重启、事务回滚、金额及输入边界、CLI 和成员编写的测试。SPEC、种子数据、package.json 和公共测试另有完整性校验。未实现种子失败 29/31 组。发现取消路径的写失败缺陷后增加第 32 组：先独立复现红灯，再要求真实成员修复，最终 32/32 通过。

## 实测发现与修复

| 发现 | 证据与修复 |
| --- | --- |
| 运行模式中，requirements 未完成时不能先规划 implementation，即使已有依赖约束 | 第一轮真实调用被拒绝。现在允许在依赖链包含 requirements 时先建图，执行仍等待依赖完成；新增红/绿回归 |
| 队长填错待执行任务依赖后陷入纠错死路 | 第二轮 `edit_plan` 拒绝运行中的团队，取消要求先接管，接管又要求依赖完成。现在允许原子修改 running 团队中 pending、attempt=0 的任务，也允许队长取消此类尚未开始的任务；活跃执行仍保留原接管规则 |
| 模型省略 kind/assignee，却声称插件改变了任务类型 | 原始模型参数证明是省略参数；插件实际遵循默认 work/shared pool。工具参数和系统协议明确默认行为，创建结果直接显示实际 kind 与负责人；本测试也明确要求显式传参 |
| 测试器曾自行把输出限制为 16,384 tokens | 第一轮 requirements 出现 max-tokens 结束。移除测试器的人工覆盖，尊重已配置上限或官方 adapter 默认值；这不是把模型截断误判为插件死锁 |
| 团队汇报之后，原生子代理结束通知再次唤醒队长 | 第三轮发现同一结果通过 Team report 和 runtime `subagent-settled` 各触发一轮。新增步骤入口去重：只处理精确识别的成功通知，且最后一次任务完成、没有正在执行的任务、对应报告已接受投递或已读；未汇报、较新的失败任务、异常结束及无关输入保留。确定性真实宿主场景断言 1 次汇报唤醒、0 次重复模型请求 |
| 漏传 attempt_id 被错误描述为资格过期，引发重复验证和重新分配 | 真实返工阶段连续省略该参数，却收到 stale 错误，队长反复重新分配。现在区分缺参和不匹配：缺参返回同一当前 ID，要求补字段重试；实际旧 ID 仍被拒绝。参数说明也明确覆盖带 findings 的失败审查。修复后的真实模型再次漏传时，一次补齐重试成功，未重新复现或重新分配 |

前两轮均在复现问题后由测试操作者中止，不计为通过，也不当成自然完成的耗时样本。原始错误及模型参数见 [探索记录](complex-verification/exploration-failures.json)。

新逻辑通过构建、完整 `pnpm verify`，包括三种宿主工具交付接口下的原子失败回滚、活跃任务拒绝编辑、环路拒绝及取消未开始任务。四个精确 Harness 版本分别通过原有 10 条运行时路径，共 40 条；又分别追加真实 CLI/Loader 中的待执行任务纠正场景，全部通过。模型在这些故障注入测试中由确定性 fixture 提供，不能混称为真实 API 测试。

最终候选包 `/tmp/agentteams-complex-fixes/artifact4/nanmicoder-dsh-agent-teams-0.1.17.tgz`，SHA-256 为 `d414f645ab91ce14008202b4556ed881542a2629d6e9018a1edad365b0b6e5b0`。源码和测试包均已完成，未发布或替换日常 Web profile。

[源码与产物清单](complex-verification/source-manifest.json)记录当前未提交工作树；当前 58 个编译文件与最后真实 API 使用的包逐项哈希一致。测试器的 [8 项回归](complex-verification/benchmark-fixture-tests-final.log)全部通过。

最终包通过 [构建](complex-verification/build4.log)、[完整验证](complex-verification/verify4.log)，以及四个宿主各 10 条路径：[0.1.5-rc.1](complex-verification/0.1.5-rc.1-accepted-result.json)、[0.1.2-rc.1](complex-verification/0.1.2-rc.1-accepted-result.json)、[0.1.2-alpha.5](complex-verification/0.1.2-alpha.5-accepted-result.json)、[0.1.2-alpha.2](complex-verification/0.1.2-alpha.2-accepted-result.json)。每个版本都额外在稳定性场景内断言待执行任务纠正和重复结束通知去重。缺参回归用修复前 artifact3 重跑最新断言，只有两个缺参断言失败：[红灯](complex-verification/missing-attempt-red-final.log)；最终验证中的三个交付接口均转绿。未变更支持版本或依赖闭包。

## 实际结果

| 实际阶段 | 模型请求 | 运行时间 | 结果 |
| --- | ---: | ---: | --- |
| 首次完整开发，artifact2 | 198 | 1,201.202 秒 | 31/31 业务验收通过、9/10 任务完成；20 分钟窗口结束时交付未完成，阶段记失败 |
| 原团队恢复收尾，artifact3 | 34 | 172.847 秒 | 原 6 名成员、原 10 项任务保留并完成；50 项成员测试、31/31 外部验收通过 |
| 双缺陷返工，artifact3 | 42 | 最后事件 255.669 秒 | 复现缺参误报 stale 循环，由操作者停止；不是完成时间或通过样本 |
| 原返工流程恢复，最终 artifact4 | 79 | 291.994 秒 | 两项自动修复、两项再审通过，17 项任务收尾，32/32 外部验收通过 |

完整结果与输入/产物哈希见 [汇总](complex-verification/summary.json)、[恢复开发结果](complex-verification/candidate-finish-result.json)、[最终双返工结果](complex-verification/candidate-cold-resume-result.json)。各阶段 manifest 和 timings 同目录保留。聚合文件的 `passed=false` 保留历史失败，`workflowPassed=true` 表示原流程已在后续阶段完成，未把失败记录覆盖成绿灯。

真实返工的任务图为：t11 计价审查失败 → 自动 t16 pricing 修复 → 自动 t17 reviewer 再审通过；t12 取消原子性审查失败 → 自动 t14 api 修复 → 自动 t15 reviewer 再审通过。原先依赖 t11/t12 的 t13 自动改为依赖 t17/t15。外部检查确认下游在原审查失败前已经存在、没有模型手工创建 repair、没有手工改下游依赖，团队和全部成员 ID 不变。最后保留两个失败审查作为历史，其他任务完成。

原生持久化日志证明旧版 4 次 stale 报错的调用全部没有 attempt_id；修复后的缺参错误直接带回当前 ID：[缺参证据](complex-verification/missing-attempt-native-evidence.json)。修复源码分别由原 api/pricing 成员写入：[写入归属](complex-verification/repair-write-provenance.json)。

自然发现的 F1 最初被模型审查评为 medium 并放行。独立补测证明：数据文件 rename 失败后，订单仍 confirmed，但库存被错误释放；原 31 组没有覆盖这个组合。新增 [第 32 组红灯](complex-verification/atomicity-red.json) 后，测试控制者明确要求把可复现的数据一致性错误作为阻断处理，再由真实 reviewer 复现、api 成员修复。这是外部验收纠正模型误判的实例，不是声称模型首次审查就没有漏判。

首次开发与恢复收尾的模型运行时间合计 22 分 54.049 秒，不含中间诊断和修改测试器的间隔。不能据此宣称复杂任务已普遍变快：没有同任务多轮统计对照。首次阶段首内容块中位数 766.5 ms、完整响应中位数 2.688 秒，但累计输出 413,168 tokens，其中 reasoningTokens 为 242,417；requirements 输出扩展到 98 条、约 2.1 万字符，成员又多次读取完整清单。模型生成、重复组织证据和串行依赖仍有明显成本。插件本轮消除的是已证实的规划死路、重复唤醒和错误重试方向，不能把模型速度只归结为“DeepSeek 应该快”。

## 测试操作边界及限制

恢复收尾时，成员执行过 `cd 项目 && (...) &`，这会把前面的 cd 也放入后台子 shell，之后的 `rm -rf .verify data` 仍在 Harness 的 `/tmp` cwd 执行。还使用过按名称匹配的 pkill。测试后确认 `/tmp/.verify`、`/tmp/data` 不存在，且所查 3000 端口临时服务已停止；没有操作前快照，因此不能用事后不存在证明此前没有内容，也不能独立保证此前进程未受影响。模型自报“没有其他目录受影响”不作为事实结论。

后续双返工测试器在工具执行前拒绝缺少项目 cd 前缀、shell 后台运算符及 pkill/killall 的命令；要求使用项目内临时数据、随机端口以及同一 Node 进程中的 start/fetch/close。这些限制是测试器的保守约束，不是通用 shell 沙箱，也没有改写用户日常 Harness 的权限设置。[原始越界命令记录](complex-verification/scope-incident.json)、[约束回归](complex-verification/benchmark-fixture-tests-latest.log)包含实际出错命令及最小复现；最后阶段没有触发这些拒绝，32 组外部验收及成员临时服务正常关闭。

验证覆盖当前 macOS/Node、四个精确 Harness 宿主和真实 DeepSeek 配置；没有声称测过其他系统、供应商、随机多轮成功率，或完整 Web UI 下的所有路径。关于“归档后仍处理”的确定性真实宿主场景继续覆盖 32 条未消费消息、活动后代、无关兄弟及退休身份拒绝恢复，不能替代未提供的评论者现场日志。

## 复跑

测试源为 `scripts/fixtures/harness-complex-case.mjs` 和 `harness-complex-oracle.mjs`。准备精确 runtime 后运行：

```sh
node scripts/harness-model-benchmark.mjs --case complex \
  --runtime-dir /tmp/agentteams-stability/runtime-0.1.5-rc.1 \
  --baseline-artifact /tmp/agentteams-stability/baseline-source/nanmicoder-dsh-agent-teams-0.1.17.tgz \
  --candidate-artifact /tmp/agentteams-complex-fixes/artifact4/nanmicoder-dsh-agent-teams-0.1.17.tgz \
  --report-dir /tmp/agentteams-complex-fresh --agent-cwd /tmp \
  --only candidate --timeout-ms 1200000 --max-requests 240
```

首次通过后，同目录用 `--only candidate-cold` 执行已标注的故障注入及真实返工。测试器先做外部检查：只有独立复现幻影库存才启用自然缺陷分支，正确实现只验证受控计价回归，其他未解决失败拒绝注入。此自适应选择另有单元测试；本次执行的是双缺陷分支，最终代码对已执行的双缺陷提示和所有验收判定保持一致：[复核](complex-verification/final-fixture-recheck.json)，没有额外冒称执行过仅计价分支的真实模型试验。

开发因窗口中断时，可用 `--only candidate-finish` 恢复原任务；返工因诊断中止时，可用 `--only candidate-cold-resume` 恢复，不再次注入或创建同名任务。每阶段拒绝覆盖原证据。这些命令会实际调用当前配置的 DeepSeek API。
