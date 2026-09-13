# AgentTeams 稳定性与启动延迟修复

用户已授权自主实现及验证。基线为当前 Git HEAD，插件 0.1.17；目标是现有四个精确支持版本，优先真实在用的 Harness 0.1.5-rc.1。原始会话与宿主边界证据见本目录 README。

| 阶段 | 状态 | 实现与验收 |
| --- | --- | --- |
| P01 调查与参考对比 | completed | 导出会话计时、真实宿主边界探针、参考仓库生命周期阅读 |
| P02 消息语义 | completed | 新任务 FIFO、纠正消息 next-step；投递与读取分离；过期 attempt 消息失效；仅确认实际展示的消息 |
| P03 生命周期 | completed | remove/delete/reassign/rollback 清空输入并递归 drain；退役身份在模型入口拒绝；失败不报告归档成功 |
| P04 按需启动 | completed | 空闲名单不启动模型；第一个模型输入包含真实任务和依赖结果；保留成员路由与恢复能力 |
| P05 完成与规划 | completed | 普通 work 阻止提前交付；任务详情随 claim 返回；说明 review 的专用语义；默认限制嵌套委派 |
| P06 静态与功能回归 | completed | pnpm build、pnpm verify，新增针对竞争/生命周期的行为回归 |
| P07 发布产物真实宿主验证 | completed | 本地 tarball + 隔离 Loader + 脚本 LLM；长轮次 steering、积压、归档、冷恢复、四个宿主版本 |
| P07b 真实 DeepSeek | completed | Harness cwd=/tmp；使用既有 API；三成员独立报告、冷恢复后续任务、流式取消 |
| P08 交付记录 | completed | 记录命令、结果、请求轮次数变化、未验证范围及回退 |
| npm 发布/真实 profile 更新 | not_applicable | 用户要求修复与验证；本次产物保留本地 |

修改范围：src/harness-compat.ts、members.ts、scheduler.ts、state.ts、types.ts、tools.ts、quality-gates.ts、index.ts，必要的状态展示及说明；scripts 下的现有验证与新增脚本模型场景。包管理使用 pnpm install --frozen-lockfile，不升级依赖。真实宿主实验通过 scripts/harness-runtime-verify.mjs 安装精确 npm 依赖闭包并使用隔离 HOME/DSH_HOME，禁用真实 LLM provider。

回退范围仅限本次 Git diff 中源文件、验证脚本和文档；原始调查材料保留。未改用户运行中的 profile、全局 DSH、会话数据和参考仓库。新增可选字段可被旧版本忽略，但按需启动允许 running 团队保存 id 为空的休眠成员，旧插件校验器不接受这一新状态。因此，未来安装后如需降级，应先结束或归档新版本创建的活动团队，再切换旧包；不要把新团队状态直接交给旧插件。旧 Harness 使用已核验契约，不涉及降级插件。
