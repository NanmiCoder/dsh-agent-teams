# 成员 agent preset 与模型配置示例

本文给出成员「真 agent preset + 指定模型」的配置写法，并说明内置默认值与覆盖优先级。适用于本 fork（`dsh-agent-teams-preset`）：成员由官方 `startActivation` 托管，`agentPreset` 会让宿主把注册预设真正 mount 到成员 scope（预设自带系统提示词、tools、skill），而不是用提示词文本模拟角色。

## 1. 内置默认值

没有在 profile 或工具参数里指定任何路由时，成员使用：

| 项 | 默认值 |
|---|---|
| LLM provider | `magpie` |
| model | `group/deepseek-v4.1-flash-1017` |
| reasoningEffort | `max` |

默认值是一条「整条路由默认」：只有工具参数、profile 成员行、插件配置 `memberModel` / `memberLlmProvider` **都没有**点名 provider 或 model 时才生效。任何一处点名了任意一半，就按原有规则（issue #189 的 owner 发现）走，内置模型让位。`reasoning_effort` 显式传入时永远优先；内置 `max` 只属于内置模型，不会强加给调用方指定的其它模型（指定模型时省略 effort = 使用该模型自己的默认档）。

## 2. 覆盖优先级

从高到低：

1. `agent_teams_add_member` 的 `provider` + `model` / `model` / `reasoning_effort` 参数（工具调用）；
2. 命名 profile 成员行的 `provider` / `model` / `reasoning_effort`；
3. 插件配置 `memberModel` / `memberLlmProvider`（全局默认覆盖）；
4. 内置默认 `magpie/group/deepseek-v4.1-flash-1017` + `max`。

`memberProvider` 是子代理运行后端（`spawn` / `fork`），不是 LLM provider，不要和 `memberLlmProvider` 混淆。

部署环境没有 `magpie` 出口时，成员创建会明确报出路由不可用；此时用 `memberLlmProvider` / `memberModel` 或 profile 成员行点名实际路由即可（也可以显式传入队长自己的 `provider` + `model` 来恢复「沿用队长路由」的效果）。

## 3. `cordis.patch.yml` 配置示例

```yaml
- id: agent-teams
  config:
    stateDir: .agent-teams
    memberProvider: spawn
    # 可选：全局成员模型默认覆盖（优先级高于内置默认）
    # memberLlmProvider: magpie
    # memberModel: group/deepseek-v4.1-flash-1017
    memberMaxDepth: 0
    maxMembers: 8
    profiles:
      preset-delivery:
        description: 真预设交付示例：分析师与实现者各挂一个注册预设
        protocol: 先确认需求，再实现与审查；未经确认不得部署。
        members:
          - name: analyst
            role: 需求分析
            agentPreset: analyst          # 注册预设名：自带系统提示词 + tools + skill
            provider: magpie
            model: group/deepseek-v4.1-flash-1017
            reasoning_effort: max
          - name: implementer
            role: 实现
            agentPreset: implementer
            # 不写 provider/model：使用内置默认 magpie/group/deepseek-v4.1-flash-1017 + max
        tasks:
          - id: design
            subject: 需求与方案
            assignee: analyst
          - id: implement
            subject: 实现方案
            assignee: implementer
            dependencies: [design]
          - id: review
            subject: 审查实现
            assignee: analyst
            dependencies: [implement]
```

`agentPreset` 的值必须是当前 DSH profile 的 agent preset 注册表里**已注册**的预设名；未注册的名字会在成员创建时明确报错，不会静默回退。省略 `agentPreset` 时保持原有 persona 文本成员的行为（向后兼容）。

## 4. 工具参数示例

一次性覆盖某个成员的预设与模型（不影响其它成员）：

```jsonc
// agent_teams_add_member
{
  "name": "reviewer",
  "role": "代码审查",
  "agentPreset": "reviewer",
  "provider": "magpie",
  "model": "group/deepseek-v4.1-flash-1017",
  "reasoning_effort": "max"
}
```

只改思考强度、保持内置模型：

```jsonc
{ "name": "reviewer", "reasoning_effort": "max" }
```

只改模型（provider 沿用队长当前路由，且该 provider 必须实际提供此模型）：

```jsonc
{ "name": "reviewer", "model": "group/deepseek-v4.1-flash-1017" }
```

`agent_teams_edit_plan` 的 `update_member` 操作同样接受 `agentPreset` 和 `provider` / `model` / `reasoning_effort`，用于在 staged 阶段调整成员（空字符串可清除 `agentPreset`，回到 persona 模式）。

## 5. 生效与校验

- `agentPreset` 需要宿主提供官方托管激活能力（`ctx.subagents.startActivation`）且成员 provider 声明支持独立预设；不满足时成员创建会明确报错，不会退化成「看起来像预设」的提示词成员。
- 解析结果在成员创建前经 `ctx.llm.resolveCallConfig` 校验；`reasoning_effort` 不属于目标模型支持的档位时会**明确失败**（例如模型不支持 `max`），不会静默降级。
- 最终生效的 `provider` / `model` / `reasoningEffort` 与 `agentPreset` 会写入 `team.json`，供 `agent_teams_status` 展示和成员冷恢复。
- 可在插件配置里声明 `fallback: {provider, model}` 作为主模型不可用时的第二选择；fallback 生效后沿用目标模型自己的默认思考强度。

## 6. 相关文档

- 使用指南：[usage.md](./usage.md)
- 验证指南：[verification-guide.md](./verification-guide.md)
