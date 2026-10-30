---
name: agent-teams-delegation
description: 派活与项目归属的执行规则。当非平凡任务需要分派给专员、需要维护项目归属表、或团队名额已满时先读本 skill：给出派活判据（>2 个文件 / 改代码 / 跨仓库 / 调研上游）、一项目一专员的归属维护方法、名额满时的处理顺序。
metadata:
  version: "1.0.0"
  date: "2026-10-30"
  reference: "https://github.com/NanmiCoder/dsh-agent-teams"
---

# 派活与项目归属

> 本 skill 是队长（Lead）的常驻派活规则。两条规则的优先级高于「自己动手更快」的默认习惯：
> 非平凡任务先派专员；同一项目固定一个专员，不因新需求新开一个人。

## 1. 派活优先（Delegate first）

### 必须先派

判断「非平凡」只看下面任一条是否命中；命中就派，不要用「我先看看」把它拖成自己干：

- 要读 **超过 2 个文件**：跨文件理解、审计、重构；
- 要 **改代码 / 配置 / 脚本**：任何写操作，包括只改一行；
- 要 **跨仓库 / 跨设备**：两个以上仓库、两个以上工作区或多台机器；
- 要 **调研上游实现**：读别的仓库、对比版本、查 npm / GitHub / 官方文档；
- 要 **多轮验证**：测试、构建、复现、打包、真机挂载。

### 可以不派

- 单文件、单命令能完成的小修或查询；
- 纯问答，读一个文件就能回答；
- 用户明确说「你亲自做」或已经指定执行者；
- 派活协调成本大于任务本身（例如 5 分钟能完成的改动）。

判断顺序：先问「是不是非平凡」，再问「现有专员里有没有对口的人」；两个都「是」时，派给现有专员。

### 派活消息必须自带

1. 仓库 / 目录的**绝对路径**（不要写「那个项目」）。
2. 要解决的**判断或目标**，不是「看一下」。
3. **已知事实**：版本、现状、相关文件、报错原文、已经排除的假设。
4. **边界**：不许动什么；是否允许 push / PR / 发布（默认都不允许）。
5. **回报格式**：分支与提交 SHA、改动文件、验证命令与输出、明确写出「没做什么 / 未验证」。

### 派完怎么管

- 派出去后不要重复做同一件事；自己去推进其它独立工作面，或等完成通知。
- **专员自报不算证据**：对外汇报前，Lead 必须复跑关键命令、看 diff、读输出。
- 需要返工时发回原专员（`send_message` 唤醒），不要另开一个新人从头摸一遍。

## 2. 一个专员负责一个项目（One owner per project）

### 项目身份

项目身份用注册表 id（例如 `workspace.json` 的 `id`）或仓库 remote 判断，**不是目录名**；目录改名不换项目。

### 项目归属表

维护一张固定表，放在团队指令 / 工作区 `AGENTS.local.md`（或 `docs/delegation-ownership.md`）。至少四列：

| 项目 id | 仓库 / 路径 | 负责专员 | 状态 |
|---|---|---|---|
| example | D:/... | example-forge | active |
| old-project | D:/... | old-owner | retired |

维护规则：

- 新需求先查表：已有 `active` 负责人 → 只 `send_message` 唤醒该专员，**不新建**。
- 新项目没有负责人 → 建一个专员并在表里登记；专员名用 `<项目>-<职责>` 的 kebab-case。
- 交接时只改「负责专员」一列，**保留历史行**；不要删行。
- 项目归档 / 合并 → 状态改 `retired`，不要删除记录 —— 否则下次又会给同一项目开新人。
- 一个专员可以负责多个项目，但每个项目必须只有一个 `active` 负责人；同一项目同一时间只允许一个专员写入。需要并行时按互不重叠的写作用域拆分，并在派活消息里写清。
- 每轮团队维护时核对一次表：`active` 的专员应该真实存在；`retired` 的专员不应再被派新活。

## 3. 名额满了怎么办

`maxMembers` 默认 **8**（可在 Plugins → AgentTeams 的配置页或 profile `config` 中修改，任意正整数；它只是成员数量上限，不是并发预算）。`agent_teams_status` / `agent_teams_add_member` 报 member cap 时按顺序处理：

1. 先 `agent_teams_status` 看现有成员、状态和未完成任务。
2. 优先 `send_message` 唤醒已有 inactive 专员，复用现有成员。
3. 确实需要新专员：先收尾并用 `agent_teams_remove_member` 移除 idle 且无未完成任务的成员，再 `agent_teams_add_member`。
4. 仍满：按项目排队，向用户说明卡在哪、需要谁让位或是否提高 `maxMembers`；不要静默丢任务。
5. **不要用 `subagent` 绕过团队名额**：它不进团队面板、不占名额，也无法被 Lead 干预；跑起来只能等它自己结束。

## 4. 工具映射（AgentTeams）

- 派活：`agent_teams_add_member` / `agent_teams_send_message`
- 看状态：`agent_teams_status`
- 移除成员：`agent_teams_remove_member`
- 任务：`agent_teams_create_task` / `agent_teams_reassign_task` / `agent_teams_update_task`
- 结束团队：`agent_teams_delete`