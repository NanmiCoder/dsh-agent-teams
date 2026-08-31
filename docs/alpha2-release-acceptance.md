# Alpha.2 发布验收记录

> 发布策略已更新：同一套 Alpha.2 适配代码以 **0.1.15** 发布到 **latest**，旧宿主用户固定安装兼容旧版。
> 这次调整没有修改运行时代码。下文保留原实测版本、真实 API / UI 过程及其证据，不把历史测试版本改写为新版本。

0.1.15 补充验证：重新完成 frozen lockfile 安装、typecheck、build、完整 `pnpm verify` 和打包，
并用 Alpha.2 CLI 实际安装。新包的 67 个运行时及资源文件与此前实测的本地 Alpha 包逐字节一致；
发布元数据为 `dist_tag=latest`、`prerelease=false`。本次没有重复整轮真实 API 业务测试。

日期：2026-08-31。目标插件：**0.1.15-alpha.1**；宿主：
`@deepseek-ai/dsh@0.1.2-alpha.2`；macOS arm64、Node.js 26.7.0、pnpm 10.33.0。
兼容修复提交：`bf50b49`。业务验收先使用该提交构建的本地 tarball，
最终发布包另做构建、安装和冷启动检查；发布准备没有改变插件运行时代码。

## 环境与方法

- 使用临时 DSH_HOME 和独立 Web profile，宿主工作目录为 `/tmp`，没有另选工作区。
- 模型为真实 `deepseek-official/deepseek-v4-flash` API，关闭 thinking，业务测试 maxTokens=8192；没有用模型桩代替业务运行。
- 测试凭据只由宿主凭据服务消费，不进入仓库、截图、报告或发布包。
- 输入是 10 条合成订单，含 paid、cancelled、refunded、partially_refunded，非客户生产数据。
- 所有交互式 UI 测试由验收操作者通过 Ego Browser 在真实 Chromium 页面完成，包含点击、聊天、编辑、截图与 DOM 布局测量。
- JSON 预期值在调用模型前由操作者独立计算；完成后直接检查文件、团队状态和输入 SHA-256，不以模型自报成功为依据。

## 真实业务交付

团队 `release-business-0831`：analyst → builder → reviewer，三个带顺序依赖的 work 任务。
人工审核前成员 ID 均为空、任务均 pending；点击批准后才创建三个真实子会话。

| 产物 | 实际结果 |
| --- | --- |
| `/tmp/dsh-agent-teams-release-0831-summary.json` | 顶层 8 个指定键、三个渠道、金额为整数分，与独立预期逐项相等。 |
| `/tmp/dsh-agent-teams-release-0831-report.html` | 离线中文 HTML，净收入卡片、渠道订单数及合计行、退款与取消口径；无外链或脚本。 |
| `/tmp/dsh-agent-teams-release-0831-review.md` | reviewer 重新读取指定文件复算，记录问题、修复和复核结论。 |

10 条订单，排除 1 条取消订单，计入 9 条；gross=93490、discount=6990、
refund=21500、net=65000 分（**¥650.00**）。渠道净收入为 web=23000、
app=22000、partner=20000 分，计入订单数分别为 4、3、2。三个任务最终均 completed，
三个成员均 idle，输入 CSV 未被修改。

外部复核 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| 输入 CSV | `c7bd433930f94309695d58aa8f42586a447b561f3fff945f4a0059478f262441` |
| 汇总 JSON | `06bc56310a2331993969fedfef234de84d6e83920f0e4d1fb604294166630b4b` |
| 修正后的 HTML | `401d4cdec13543a5a173edec336f5077b80bae933126b17f8376e820fa5142ac` |

### 发现的模型偏差与人工纠正

这不是一次无人干预的全自动成功：

1. analyst 初稿写成 `/tmp/summary.json`，且字段结构不符合约定。操作者通过正常聊天向队长指出；队长用团队消息唤醒 analyst，修正路径和 schema。操作者没有代写最终产物。
2. reviewer 反复尝试在其受限环境中启动浏览器并安装依赖，未成功，还产生了本轮辅助脚本。操作者点击“停止生成”，随后补充约束，要求停止浏览器尝试并如实完成数据复核。真实 UI 验收由操作者的 Ego Browser 独立完成，不把 reviewer 的静态分析当作浏览器测试。
3. HTML 说明文字仍有旧字段名 `net_income_cents`。人工指出后，reviewer 联系 builder；builder 改为 `net_cents`，reviewer 续跑确认旧字段残留为零，金额未变。

任务完整描述包含约定路径；这些是模型执行偏差，不能仅靠依赖升级保证消失。
本轮验证了发现偏差后的消息投递、成员续跑和实际修复，也说明真实业务仍需要产物验收。
work 任务的文字约束不是文件写入沙箱，不应把它当作强制访问控制。

## 真实 UI 验收

| 人的操作 | 观察结果 |
| --- | --- |
| 输入 `/agent-teams` 创建业务计划 | 对话卡片、成员、三个任务和两条依赖可见；批准前没有子成员执行。 |
| “返回对话修改”，补充卡片、合计行和手机宽度要求 | 修改同一计划，保留三名成员和三个任务，未另建团队。 |
| 打开成员模型选择 | 使用宿主真实模型目录，显示 Flash / Pro / Flash Vision Exp 与推理选项。 |
| 把 t2 依赖设为自身后保存 | 显示自依赖错误，磁盘计划未被污染；修正为 t1 后可以保存。 |
| 保存任务标题，再“确认并启动团队” | 编辑内容持久化，成员真正启动，依赖按 t1 → t2 → t3 推进。 |
| 浮动 / 停靠、收起 / 重开面板、选中 DAG 任务 | 控件可操作，任务详情与进度可读。 |
| 从成员卡片进入子会话，再返回队长 | 能查看实际成员工具调用和产物；未丢失队长会话。 |
| 成员“停止生成”及后续聊天 | 运行中的工具调用被中断，后续队长消息和人工指令能继续处理。 |
| “停止团队”确认框选择继续运行 | 弹框关闭，任务保持运行，未误取消。 |
| 浏览器强制刷新后重开活动面板 | 团队、成员、DAG、编辑后的标题和完成进度恢复。 |
| 宿主中英文、深浅色切换 | 插件状态、按钮、无障碍名称跟随变化；截图可读。 |
| 插件面板 390px 视口 | 面板位于 x=12..378，宽 366px，控制项和成员列表可用。 |
| HTML 报表桌面 / 390px 视口 | 金额和表格正确；手机 innerWidth=390、documentElement.scrollWidth=390，表格各自在容器内滚动。 |
| 另建 `release-cancel-0831`，确认“放弃本次计划” | 归档视图标注未创建 / 未执行；磁盘归档成员 ID 为空、任务仍 pending，原业务团队不受影响。 |
| 匿名请求 state / plan / halt | 均返回 401；同一浏览器的认证 state 请求返回 200。 |

观察期间未收集到 `Runtime.exceptionThrown` 事件。截图和原始检查结果保存在本地临时验收目录，
不发布包含会话信息的完整日志。

## 自动检查与边界

发布前运行 frozen lockfile 安装、typecheck、build、完整 `pnpm verify`、pack 和实际插件安装。
完整检查包含真实 Alpha.2 Connection + HTTP 的认证与生命周期回归，以及发布渠道保护测试。
GitHub Actions 使用 Node.js 24，在 Linux 上重新构建、检查并发布。

最终本地发布包 `nanmicoder-dsh-agent-teams-0.1.15-alpha.1.tgz` 的 67 个运行时及资源文件，
与真实业务测试包逐字节一致。使用 Alpha.2 CLI 将最终包安装到 Web profile，确认安装版本为
0.1.15-alpha.1，50 个安装后的 lib 文件与 tarball 一致。冷启动后打开业务历史会话，
活动面板恢复 3 名成员、3/3 完成和 DAG，认证 state 接口返回 200。

本地 tarball SHA-256：`c892ec02e64cd0b4fabb9c4eba263eeca483cab19f75cfd555e464e7fa469971`。
CI 在 Linux 上重新构建并发布，不能把这个本地 tarball 哈希当作 npm 包的 registry integrity。

本机 Docker daemon 未启动，**未进行 Docker 运行验证**。真实业务 / UI 结果限定于上述 macOS、
Alpha.2 和 DeepSeek Flash 组合；没有声称验证 Windows、其他模型供应商、所有旧版本或未来 Alpha。
Linux CI 构建检查不等同于 Linux 上的真实 API / UI 验收。
