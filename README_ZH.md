<p align="right">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="dsh-agent-teams 把一个 DeepSeek Harness 会话变成可协作的多智能体团队">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@nanmicoder/dsh-agent-teams"><img src="https://img.shields.io/npm/v/@nanmicoder/dsh-agent-teams.svg" alt="npm 版本"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@nanmicoder/dsh-agent-teams.svg" alt="MIT 许可证"></a>
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-202724" alt="DeepSeek Harness 插件">
</p>

## 一句话，拉起一支真正协作的团队

`dsh-agent-teams` 让当前 DeepSeek Harness 会话成为队长：创建可续聊的子 Agent、把目标拆成有依赖的任务，并通过直达消息协调成员工作。

你只需用自然语言提出目标。插件会提供团队协议、10 个协作工具、持久化状态、自动共享任务调度和实时 Web UI，不需要额外的 Workflow 引擎。

<p align="center">
  <img src="./assets/ui.png" width="100%" alt="DeepSeek Harness 对话与 AgentTeams 实时活动面板，展示成员、任务依赖和回报">
</p>

## 为什么需要 AgentTeams？

| 能力 | 带来的变化 |
| --- | --- |
| **队长式委派** | 当前会话负责建队、分配角色并汇总最终结果。 |
| **可续聊成员** | 成员是可持续唤醒的 DSH 子 Agent，可以继续执行聚焦的后续轮次。 |
| **带依赖的任务** | 任务有明确状态；依赖未完成时不能领取。 |
| **自动续领与安全接管** | 成员空闲后自动领取下一项就绪任务；转派会撤销旧 attempt，冷恢复会重试遗留任务，迟到结果无法覆盖。 |
| **成员直达消息** | 成员通过持久化邮箱直接联系队友或队长，不需要队长中转。 |
| **实时活动面板** | Web UI 展示角色、当前工作、未读消息、任务依赖和归档历史。 |

## 安装

> [!NOTE]
> 使用前请确保已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

### npm

```sh
dsh plugin --profile web add @nanmicoder/dsh-agent-teams
```

### 从源码构建

```sh
git clone https://github.com/NanmiCoder/dsh-agent-teams.git
cd dsh-agent-teams
pnpm install
pnpm build
dsh plugin --profile web add .
```

修改源码后请重新执行 `pnpm build`。本地安装会继续链接到当前源码目录。

检查组合配置、重启 DSH，然后刷新 Web UI：

```sh
dsh --profile web --dump-config
dsh web
```

接着直接用自然语言拉团队：

> 使用 AgentTeams 审查 v0.5.3 之后的提交，分别从性能、安全和产品角度分工，最后输出一份汇总报告。

## 工作方式

1. 当前会话创建团队并成为队长。
2. 队长按角色添加由可续聊子 Agent 驱动的成员。
3. 目标被拆成有负责人和显式依赖的任务。
4. 共享调度器依据真实 `running / idle / ready` 状态，为每个空闲成员原子领取一项就绪任务并唤醒它；成员在中断或进程重启后仍持有开放任务时，会以新 attempt 自动恢复执行。
5. 成员携带当前 `attempt_id` 更新任务；转派或队长接管会先撤销旧 attempt、等待原成员安静，再启动新 attempt。
6. 队长汇总结果，随后归档完整团队记录。

团队状态保存在 `<workspace>/.agent-teams/`；Web 面板读取这份磁盘真相，并与实时子 Agent 活动合并展示。

成员创建默认零交互：插件会快照队长**当前这一步**实际使用的 LLM provider、model 与思考强度，成员后续续跑仍使用这份快照。只有当用户明确提出异构分工（例如“后端用 provider A/model X，前端用 provider B/model Y”）时，队长才会把对应的 `provider` + `model` 传给该成员；不会逐个弹出模型或思考强度选择。

## 配置

默认配置可以直接使用。受信任的 Profile 可以覆盖成员行为：

```yaml
- id: agent-teams
  config:
    stateDir: .agent-teams
    memberProvider: spawn
    memberModel: deepseek-v4
    memberMaxDepth: 1
    maxMembers: 8
```

这里的 `memberProvider` 指子 Agent 的运行后端（`spawn` / `fork`），不是 LLM provider。跨 LLM provider 由 `agent_teams_add_member` 的可选 `provider` + `model` 参数表达；`memberModel` 只是所有成员的模型默认覆盖。

## 使用边界

- 一个队长同一时间只能带一个活动团队。
- 成员空闲后由共享调度器自动续领就绪任务；中断/冷重启遗留的开放任务会生成新 attempt 并重新唤醒原成员；暂时无法实时投递的消息会持久保存在邮箱中并在后续状态边界重投。
- 状态使用文件持久化，并在单个 DSH 进程内串行操作；多个进程同时修改同一团队不保证一致。
- 活动面板如实展示持久化状态；模型偶尔可能完成工作却没有按协议更新任务状态。

完整工具列表、状态模型、Web UI 行为、配置与已知限制见 [docs/usage.md](./docs/usage.md)。

## 插件开发 Skill

仓库同时提供开放 Agent Skills 包 [`dsh-plugin-development`](./skills/dsh-plugin-development/SKILL.md)：

```sh
npx skills add NanmiCoder/dsh-agent-teams --skill dsh-plugin-development
```

## 文档

| 指南 | 内容 |
| --- | --- |
| [使用指南](./docs/usage.md) | 架构、UI 行为、工具、配置、限制与验证 |
| [验证指南](./docs/verification-guide.md) | 离线、组合、真实 e2e 与 GUI 验证 |
| [插件开发](./docs/developing-dsh-plugins.md) | 基于本插件整理的人类可读开发指南 |
| [README 写作](./docs/readme-writing-guide.md) | 仓库文档约定 |

## 开发

```sh
pnpm install
pnpm build
pnpm verify
```

## 许可证

[MIT](./LICENSE)
