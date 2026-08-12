# dsh-agent-teams

DeepSeek Harness 的 AgentTeams 插件：安装后，任何会话只需一句自然语言（例如"用 AgentTeams 调研一下 XX"），即可驱动一个**多智能体团队**协作完成目标，并在 Web GUI 右上角实时看到团队活动面板。

核心语义移植自 Claude Code 的 AgentTeams：**创建团队**（队长 = 当前会话 agent）→ **拉成员**（可续聊子代理）→ **拆任务并声明依赖** → **成员间直接收发消息**（邮箱直达 + 唤醒，无队长中转）。

## 界面预览

![AgentTeams 活动面板](assets/ui.png)

## 安装

```sh
# 从 npm 安装（构建产物随包发布，无需 build）：
dsh plugin --profile web add dsh-agent-teams

# 或从 git 源码安装（需先构建）：
cd /path/to/dsh-agent-teams
pnpm install          # 公开依赖（tsdown/typescript/react…）；@deepseek-ai/* 为 DSH 环境提供的私有 peer，见 .npmrc
pnpm build            # 产出 lib/ 与 lib/client.js
dsh plugin --profile web add /absolute/path/to/dsh-agent-teams
```

`dsh plugin` 安装包并加入 profile 的 bundle 层；工具注册进全局 `tools` 注册表、使用策略进全局 system prompt、浏览器入口进 `window.__DSH_BOOT__` 名册——该 profile 下所有会话可用。发布到 npm 后直接 `dsh plugin --profile web add dsh-agent-teams`。

> **重启生效**：新增插件行在启动时组合，需重启 dsh 服务。

## 使用

安装并重启后，直接对助手说：

> 用 AgentTeams 帮我调研一下开源 RAG 框架的选型，输出对比报告

插件内置提示段会指导模型按协议执行：建团队 → 按角色拉成员 → 拆任务声明依赖 → 领取并唤醒成员 → 轮询收集产出 → 汇报后删除（归档保留）。

## 开发 Skill

仓库按开放 Agent Skills 规范提供 [`dsh-plugin-development`](skills/dsh-plugin-development/SKILL.md)。当前私有内测阶段，只有拥有仓库访问权限的用户才能安装；仓库公开后可直接运行：

```sh
npx skills add NanmiCoder/dsh-agent-teams --skill dsh-plugin-development
```

`skills/dsh-plugin-development/` 是唯一权威源码；`.dsh/skills/` 中的相对链接让 DSH 在本仓库作为 cwd 时自动发现同一份 Skill，同时避免占用 `npx skills` 的 `.agents/skills/` 安装目标。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/usage.md](docs/usage.md) | 工作原理、Web UI 行为、工具一览、配置、已知限制、验证 |
| [docs/verification-guide.md](docs/verification-guide.md) | 四层验证方法（离线 / 组合 / 真实 e2e / ego-browser GUI） |
| [skills/dsh-plugin-development/SKILL.md](skills/dsh-plugin-development/SKILL.md) | 可通过 `npx skills` 安装的 DSH 插件开发 Skill |
| [docs/developing-dsh-plugins.md](docs/developing-dsh-plugins.md) | 面向人类阅读的开发指南（本插件为样例） |

## License

MIT
