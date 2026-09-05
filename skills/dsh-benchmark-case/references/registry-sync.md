# 四连注册表同步 + 校验命令

新增一道题 = 改 4 个文件 + 跑 3 个校验。任何一处漏改，校验立刻红。

## 1. `benchmark/README.md`（任务总览，6 处）

1. 顶部表格加行（Task / Type / What it tests），Type 必须
   `Static | Hands-on` 之一（H4/H6 名义 H 实为 Static，Type 列说了算）。
2. 首段：`The N plugin-upgrade tasks measure one thing: …`（N 同步为新总数，
   当前 52）。
3. 同段：`The first N₁ are written exams … the last N₂ are hands-on`
   —— 两个数都按表格 Type 列实数计数（当前 19 written / 33 hands-on）。
4. `harbor run` 示例块：`# all N tasks: pointing -p at the tasks/ …`。
5. Unattended authorization 小节：`All N instruction.md files carry …`。
6. 维护者注记：`following the layout of the existing N tasks`。

## 2. `benchmark/docs/scoring.md`（评分映射，2 处）

1. 首行：`Total <N×100> (N tasks × 100; …)`（当前 5200 = 52 × 100，每加一题 +100）。
2. 任务表加行：Checkpoint 列写**覆盖的卡/rollup**（用全 ID 如
   DSH-0.1.1-R1-01）+ Score breakdown 列逐条精确到每个 check 的分数，与
   judge.mjs 完全一致。

## 3. `benchmark/scripts/validate-execution-contract.mjs`（契约注册，1 处）

```js
const expectedModes = new Map([
  // …既有行…
  ['<task-id>', '<mode>'],   // mode: readonly | mutable | build-artifacts-only
])
```

## 4. 卡引用与链接（validate.mjs 检查）

- benchmark 内 Markdown（SOLUTION.md / README / scoring）引用卡时用
  **全 ID**（`DSH-0.1.1-R1-01`，禁写 `R1-01`），且 ID 必须已存在于
  references/v*.md，链接必须可解析。
- 如需新卡（题引用一张尚不存在的卡），先随题的同一 PR 补卡（走廊边 from
  唯一、idPrefix 前缀、Source 含 https）。

## 校验命令（Stage 6 全量）

```sh
cd dsh-plugin-upgrade-skill
node scripts/validate.mjs                        # 卡 schema/走廊/引用/链接
node benchmark/scripts/validate-task-registry.mjs     # 任务清单 ↔ README ↔ scoring 一致
node benchmark/scripts/validate-execution-contract.mjs  # BENCHMARK-AUTH-v1 五子句 + mode
node --check benchmark/tasks/<id>/tests/judge.mjs
node --check benchmark/tasks/<id>/tests/judge-utils.mjs
```

## oracle 1.0（不可跳过）

```sh
harbor run -p benchmark/tasks/<id> -a oracle     # 标准式
```

harbor 不可用时的 docker 手动等效路径（本机实测可行）：

```sh
cd benchmark/tasks/<id>
docker build -t bench-<id> environment/
docker run --rm -d --name bench-<id>-run \
  -v "$PWD/solution/plugin":/oracle -v "$PWD/tests":/tests bench-<id> sleep 1200
docker exec bench-<id>-run sh -c \
  'cp -r /oracle/. /app/fixture/ && mkdir -p /logs/verifier && node /tests/judge.mjs'
# 断言最后一行 {"score":100,"max":100,…}；跑完 docker rm -f
```

## 提交与 PR

- 一道题 + 一张/张卡：同一个 PR 主题（feat/ 分支）。
- PR 描述必须含：3 个校验命令及输出、oracle 1.0 输出、覆盖的卡 ID、未覆盖
  边界、致谢（上游事件/仓库、验证站矩阵）。
- 仓库只读（oh-my-dsh）走 fork+PR；本机工作区对应目录非 git，子目录各自
  git 仓库；贡献流程与纪律见仓库根目录 CONTRIBUTING.md。