# dsh-agent-teams · 真 Agent Preset 成员方案（fork 改造）

> 基线：`NanmiCoder/dsh-agent-teams` @ 0.1.29，本地 fork `dsh-agent-teams-preset`（clone 自 main，HEAD `369c278`）。
> 目标宿主：DSH **0.2.2-rc.1**；测试在**独立 home 的 Web 实例**，不动 live、不重启桌面。

## 1. 目标（用户红线）

成员必须是**真正的 agent preset 模式**：可指定成员的 **agent 预设**（自带系统提示词 + tools + skill）与**模型**（默认 `deepseek` + `reasoningEffort=max`），**不是通过提示词模拟角色**。

## 2. 现状（源码证据）

成员创建走 `spawnMember`（`src/members.ts:991-1074`），经 `startMember`（`src/harness-compat.ts:19-32`）优先 `subagents.startActivation`。request 里只有：

| 字段 | 内容 | 性质 |
|---|---|---|
| `persona` | `memberPersona()` 拼接的提示词文本（`members.ts:793`） | ⚠️ 提示词模拟角色 |
| `toolFilter` | deny/allow 过滤 | 工具面 |
| `agentOptions` | `{ provider, model, reasoningEffort }` | ✅ 真模型路由 |
| **`agentPreset`** | **缺失** | ❌ 不挂注册预设 |

## 3. 官方能力（asar 证据）

`@deepseek-ai/dsh-subagent/lib/index.js`：

- `:349` `selectedPreset ?? parent…composedPreset` —— 支持显式 preset 或继承父级
- `:375-378` `composition.agentPreset !== void 0 → presets.mount(childCtx, agentPreset)` —— **挂真预设**
- `:382` 无 preset 才 `composeFrom` 继承父级组合
- `:1458` `composition: { agentPreset: request.agentPreset }` —— request 直接接受

**结论：官方已支持，本插件把这条通道空着了。** 方案 = 把 `agentPreset` 接进 `spawnMember` 的 request，而不是自造运行时。

## 4. 修改方案（最小、向后兼容）

| # | 文件 | 改动 |
|---|---|---|
| M1 | `src/members.ts` `spawnMember` | request 增加 `agentPreset`（来自 member 配置）。有 preset 时不再用 `memberPersona` 文本充当身份（身份由预设提供），`agentOptions` 保留 |
| M2 | `src/harness-compat.ts` `startMember` | managed 分支当前 `const { persona, toolFilter, ...request } = spec.request` 会丢弃 persona；保留 `agentPreset` 透传（`...request` 已含），无需改签名 |
| M3 | `src/profiles.ts` | `MEMBER_KEYS` 增加 `'agentPreset'`，profile 可按成员声明预设 |
| M4 | `src/tools.ts` spawn/add_member 工具参数 | 增加可选 `agentPreset`；模型参数沿用现有 `provider/model/reasoning_effort` |
| M5 | 默认模型 | 成员缺省 `provider=magpie`、`model=group/deepseek-v4.1-flash-1017`、`reasoningEffort=max`（本机主模型），可被 profile/工具参数覆盖 |
| M6 | 类型 `src/types.ts` | `TeamMember` / spawn 输入类型补 `agentPreset?: string` |

**兼容**：`agentPreset` 缺省 → 维持现有 `persona` 文本行为，老团队/老配置不变。

## 5. 验证

- 单测：agentPreset 注入、模型指定、无 preset 时回退 persona、非法 preset 报错
- 构建：`pnpm build`（tsc）通过
- 真机：独立 home + `dsh web` 实例，装改后插件，创建成员验证「挂真预设 + deepseek max」

## 6. 回滚

fork 是独立目录，改坏了 `git checkout -- src/` 即回基线；live 用的是 npm 版 `@nanmicoder/dsh-agent-teams`，本 fork 不影响它。

## 7. 任务 DAG（并行 + 依赖）

见 `TASKS.md`。原则：最小交付房间，能并行不串行。
