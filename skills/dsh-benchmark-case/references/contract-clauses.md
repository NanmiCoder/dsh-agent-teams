# 契约条款银行（BENCHMARK-AUTH-v1）

`benchmark/scripts/validate-execution-contract.mjs` 用**正则逐条匹配**，
字面必须命中。以下措辞全部来自既有题，**照抄最稳**。双语任选其一，
但英文版已证明匹配，推荐复制。

## 完整 instruction.md 模板（mutable / hands-on）

```markdown
# <ID> · <Title>

## Unattended Benchmark Authorization (BENCHMARK-AUTH-v1)

This is an unattended benchmark run in a disposable isolated container; there will be
no follow-up user messages. This task statement is itself the user's explicit
authorization and confirmation for the solution and execution needed to complete the
task: complete the necessary analysis and planning on your own, and continue executing
immediately once the plan is formed — do not pause to wait for "confirmation" and do
not press the user with follow-up questions. That confirmation continues to apply to
the concrete plans you produce under the applicable skill, but only within the
following scope:

- You may read `/app/fixture/`, local in-container documentation, and local tools; you
  may modify `/app/fixture/` directly and write to the specified `/app/agent-output/`
  directory as instructed;
- You may create disposable local verification profiles and temporary files, and run
  local tests, builds, and dsh commands;
- You must not modify the skill, the grader, or the reference solution, and must not
  publish, push, access external services, or change resources outside the container;
- If you cannot complete the task, state the blocker honestly, but do not stop merely
  because another round of confirmation is missing.

<任务正文：旧形态是什么、host 已升级到什么、要求迁移成什么、如何验证>
```

### 五子句（校验逐条正则，缺失即失败）

| 子句 | 校验正则片段 | 模板内的字面 |
|---|---|---|
| no-follow-up | `there will be no follow-up user messages` | `there will be no follow-up user messages` |
| proceed-after-plan | `(?:as soon as\|immediately once\|once) the plan (?:is )?(?:formed\|takes shape)` | `continue executing immediately once the plan is formed` |
| no-pause | `do not pause (?:to wait\|waiting) for ["“]?confirmation["”]?` | `do not pause to wait for "confirmation"` |
| no-modify | `(?:must not\|may not) modify the skill` | `You must not modify the skill, the grader, or the reference solution` |
| no-stop | `do not stop merely because another round of confirmation is missing` | `do not stop merely because another round of confirmation is missing` |

## 边界授权句（按 mode 二选一，也做正则校验）

- **mutable / hands-on**（M/H 类）：`you may modify `/app/fixture/` directly`
  （正则：`may modify `\/app\/fixture\` directly`）
- **readonly / 静态**（S 类）：`/app/fixture/ 必须保持 零改动 | /app/fixture/
  must remain completely unchanged`
- **build-artifacts-only**（H4 tsbuildinfo-trap 类）：src 零改动 + lib/构建产物
  可清理（参考 H4 措辞）。

## task.toml 的契约字段

```toml
[metadata]
execution_contract = "BENCHMARK-AUTH-v1"   # 校验：恰好一次
[task]
version = "1.1.0"                          # 校验：必须这串
```

## 陷阱（实测踩过）

1. **mutable 题也必须有授权句**：模板第 4 行的 `you may modify` 是模式
   `may modify `\/app\/fixture\` directly` 的命中来源，删了校验直接失败。
2. **只读题不许有 "may modify"**：同段正则会抓 mutable 授权句的缺席/错配，
   边界句必须与 expectedModes 的 mode 一致。
3. **校验入口**：
   `node benchmark/scripts/validate-execution-contract.mjs`（一次校验全部
   instruction.md + task.toml，新题注册 expectedModes 后自动纳入）。
4. 新增题必须同时把 `['<task-id>', '<mode>']` 加进脚本头部 expectedModes
   Map，否则 "task has no execution-contract mode" 失败。

## 中英双语提示

校验正则同时接受中文与英文变体；仓库既有题中英都有。新题选英文即与
validate-execution-contract.mjs 的英文分支一一对应，最不易踩坑。