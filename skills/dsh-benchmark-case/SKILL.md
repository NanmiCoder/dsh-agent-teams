---
name: dsh-benchmark-case
description: Use when the user hands over a dsh plugin repository (or a real migration commit / version corridor) and wants its upgrade experience extracted into one auto-graded Harbor benchmark exam task — produce tasks/<id>/ (fixture + instruction.md + task.toml + judge.mjs + solution) that harbor run can grade 0–1 and that folds into the dsh-plugin-upgrade-skill benchmark suite; also applies to turning existing version cards (references/v*.md) into executable exam tasks. Not for writing upgrade cards; not for running the benchmark.
license: MIT
---

# 从插件仓库提取 dsh 升级考题

把一个真实发生的插件迁移（git 历史里的破坏性变更 commit）变成一道
**Harbor 考题**：旧形态插件为 fixture（装上必坏，或有隐藏坑），新形态为
oracle 参考解，judge 在容器内真实冷启动判活。产出跟随
`./benchmark/`（上文：`oh-my-dsh/dsh-plugin-upgrade-skill` 的 benchmark 目录）。

> 上下文锚点：目标套件是 dsh-plugin-upgrade-skill 的 benchmark v2.4（Harbor
> 格式），host 镜像固定为 node:24-bookworm + 全局 dsh 0.1.2-alpha.2。每条考题
> 遵循 execution-contract（BENCHMARK-AUTH-v1）与固定评分模型（100 分/题）。

## 何时使用

- 用户给一个插件仓库，说"提成考题 / 做成 case / 转 benchmark task"。
- 用户拿着一条版本走廊或一个迁移 commit，要可执行的评测而不是文档。
- 现有升级卡（references/v*.md）需要测"AI 会不会照卡修"。

## 工作原理（一句话）

fixture = 迁移前形态（偶藏误导注释/预置失败），judge = 静态检查 +
容器内真实冷启动信号（pending / plugin tree failed / MISSING_CREDENTIAL /
`__DSH_BOOT__` 条目），oracle = 参考迁移，判分天然 0~1。

## Pipeline

### Stage 0 · 选材与走廊定位

**先回答三个问题，答不出就退回升级卡形态，不做题**：

1. **迁移方向**：仓库 git 历史里哪一个 commit / 哪一段走廊是"host 升级导致的
   必需改动"？（例：`426e86d` whale-girl bundle 转换，走廊 rc.8→rc.1）。
   纯自研重构、无 host 侧断裂的 commit 不成题。
2. **可测性**：迁移后形态能否在容器内"装得上 + 冷启动得到确定信号"？
   判分信号必须是宿主侧信号（见 Stage 3），**不是**"输出文本长什么样"。
   无浏览器容器 ⇒ client 运行时不可判，只能判 boot 图条目 / HTTP 状态。
3. **对应卡**：这条走廊在 references/ 里有没有卡（或需要先补卡）？
   考题与卡是一对多：一道题可以覆盖多张卡，但卡必须已存在或随题新增
   （validate.mjs 会校验卡引用存在且链接可解析）。

**选材标准（×成立越多越好）**：迁移真实发生过（有 commit 可考）；
断裂面小（1~4 个 touchpoint）；装旧形态必有可观察故障（pending / 静默缺行为）；
新形态在 alpha.2 上可冷启动验证；最好带隐藏坑（诱导注释 / 看着无辜的面上
藏着致命伤——坑要来自真实迁移的"第二个 commit"，不是编的）。

**产出**：选定的 task id（见 Stage 1 命名）+ 走廊 + 覆盖的卡 ID 清单 +
fixture 应模拟的第 N 个 commit 形态（迁移前）。Checkpoint：三者对齐才继续。

### Stage 1 · 骨架与命名

任务目录 `tasks/<id>/`，id 命名：前缀字母 S（静态只读）/ M（迁移可改）/
H（hands-on 陷阱），编号接该系列现有最大值。**编号不要凭记忆硬编码**——
动手前先 `ls benchmark/tasks/` 并对照 `benchmark/README.md` 任务表与注册表
校验脚本确认当前集合（当前 52 题：S1–S16 / M1–M14 / H1–H22，下一可用
S17 / M15 / H23），勿跳号。一个任务一个目录：

```
tasks/<id>/
├── instruction.md        # 给 agent 的 prompt（含 BENCHMARK-AUTH-v1 契约）
├── task.toml             # Harbor 配置（见 assets/task.toml.example）
├── environment/
│   ├── Dockerfile        # node:24-bookworm + git + pnpm + dsh alpha.2 + git 基线
│   └── fixture/          # 旧形态插件（private:true，README 声明 exam material）
├── tests/
│   ├── test.sh           # verifier 入口：跑 judge，score→reward 写 /logs/verifier/
│   ├── judge.mjs         # 判分逻辑（全部在这）
│   └── judge-utils.mjs   # 共享判分库：profile 生命周期、冷启动信号、清理
└── solution/
    ├── solve.sh          # oracle：把参考解拷进 fixture
    ├── SOLUTION.md       # 参考解说明 + The Point + Grading Boundary
    └── plugin/           # 参考迁移后的完整文件
```

模板在 `$_S/assets/`：task.toml.example、instruction.md.example、
judge-utils.mjs（整库直接复制）、test.sh.example、Dockerfile.example、
solve.sh.example、judge.mjs.example（骨架）。

**装 dsh 的 Dockerfile 必须**（与现有任务一致，勿改版本）：
`FROM node:24-bookworm`；装 git；`npm install -g pnpm@11.24.0
@deepseek-ai/dsh@0.1.2-alpha.2`；COPY fixture → /app/fixture；git init + 基线
commit（judge 靠 `git status --porcelain -- fixture` 判"fixture 是否被改"，
只读题 0 分门禁，可变题 0 分门禁的相同实现）。Checkpoint：目录 6 块齐全。

### Stage 2 · fixture 构造

按"迁移前第 N 个 commit"的真实形态写 fixture，三个纪律：

1. **必须私有**：package.json `"private": true`；README 首行
   "exam material only, do not publish"。源头切片除外（见 4）。
2. **坑要用真坑**：误导注释要像真话——来自真实迁移决策记录里"当时为什么
   这样做/为什么别改"的措辞；预置失败测试要确实预先失败且与升级无关
   （测诚实报告，不测静默修复）。
3. **坏必须可观察**：旧形态要么装上 pending / plugin tree failed，要么
   静默缺行为但 judge 有对应锚（如 boot 图没有该插件的 client 条目）。
   判分锚必须能在容器里拿到，拿不到的 feature 不出现在 judge 里。
4. **上游切片保留原元数据**（Apache-2.0 真实仓库切片如 dsh-web）：保留
   license/original package.json，读 provenance/ 惯例（见基准
   `tasks/H9-dsh-web-alpha2/provenance/`）。

**fixture 放哪、可以留什么**：Node half 可留在 `.dsh-plugin/` 子目录等
旧布局位置——但这类布局有深坑可挖：host 的 client-modules 从 Node entry
文件向上找最近 package.json 作为包身份（机制见
`$_S/references/host-archaeology.md` 的"manifest 遮蔽"条目）。设计 fixture
时可利用这类机制布坑：让旧布局残留文件影响包识别，浏览器半静默消失；
判分侧的 boot 图条目检查会自然抓到。具体某道在线题怎么布、参考解怎么收
尾，不在此展开——方法级不讲答案。

Checkpoint：`dsh plugin add` 旧 fixture 在容器里真的坏 / 有静默缺陷；
新 fixture（参考解）全绿。两态都必须先本地 docker 验证，不许只靠想象。

### Stage 3 · judge 设计（判分心法）

固定评分模型：100 分/题，`emit(score, reasons)` 最后一行输出
`{"score":0-100,"max":100,"reasons":[...]}`，test.sh 归一化到 0~1 写
`/logs/verifier/reward.txt`。线性叠加 checkpoints，禁止加权魔法。

**通用三段式**：

| 段 | 内容 | 分数惯例 |
|---|---|---|
| Gate | `fixtureChanges()`：fixture 必须被改（静态题 0 分；可变题 0 分） | 0 或整体继续 |
| 静态 | manifest 字段 / exports / patch insert 行 / 源码模式（grep）| 40~70 |
| 运行时 | `dsh plugin add` + 冷启动信号 + boot 图条目/HTTP | 30~60 |

**判分锚必须是宿主侧信号**（从 judge-utils.mjs 输出获取）：

- `NEGATIVE_SIGNAL`：`plugin tree failed` / `did not activate` /
  `pending (waiting for service: …)` / `FAILED fiber` /
  `ClientPackageCompositionError` = 失败带（通常 40 或该 check 0 分）。
- headless 冷启动：无 API key 时到达 `MISSING_CREDENTIAL` / `no API key` /
  `dsh: AUTH` = 插件树整体激活，通过。**出口码不算**——无 key 成功也 exit 1。
- web 冷启动 + GET `/`：`__DSH_BOOT__.entries` 包含 `<pkg>/client.js`
  （**注意**：boot 图 URL 按 exports 的 key 拼 `${pkg}/client.js`，与文件
  真实路径无关）或该插件的 HTTP 通道 401/200 冒烟。

**边界声明**：judge 头注释与 SOLUTION.md 的 Grading Boundary 必须写明"容器
内没有浏览器 → client 运行时行为不判，只判宿主宣告的 boot 图条目"这类边界；
未覆盖面同样写进 scoring.md。

**分数带设计提醒**：给"半对"留带（关键声明完整给满分、缺字段给半分、
完全缺失 0 分）；陷阱跟随者给封顶（如误导注释说别改 X，留着 X = 该
check 上限）。判分必须能区分"真迁移"与"看起来绿但绕开了迁移"——绕道
路径 boot 也能绿，要用静态检查（grep 特定字段/模式）封顶才抓得住。

**运行纪律**：judge 只建 `bench-<task>` profile 与 `/tmp/bench-<task>`，
finally 里清理（pkill 用 `[x]` 自逃逸模式防止自杀）。timeout 充足（add 180s /
boot 60s / web 150s，真实 workspace 题 verifier 900s）。judge 永远 exit 0，
test.sh 解析不了 JSON 时按 0 计。

### Stage 4 · oracle（参考解）

`solution/plugin/` 是完整迁移后的 fixture；`solve.sh` 逐文件覆盖进
`/app/fixture/`，并显式删除该题迁移要求删除的残留文件。
SOLUTION.md 三节必备：

1. **Reference Changes**：每条改动对应卡 ID 全名（如 DSH-0.1.1-R1-01，
   **不要**写 R1-01 简写——validate.mjs 校验全 ID 存在）。
2. **The Point (one sentence)**：这道题真正测的一招。
3. **Grading Boundary**：与 Stage 3 的边界一致。
4. **Warning**：如果 judge 是 grep 源码模式判"已删除"，参考解源码注释里
   **不得出现被 grep 的字面 token**（实战教训：solution 注释复述了被判
   "已删除"的旧标识符字面，judge grep 命中注释导致自伤扣分）。

Checkpoint：oracle 在容器里跑出 **100/100**（reward 1.0，下一步做）。

### Stage 5 · 契约与注册表同步（四连）

**instruction.md 契约**（validate-execution-contract.mjs 用正则逐条匹配，
字面必须命中，双语任选其一）：

- 恰好一处 `BENCHMARK-AUTH-v1`；契约五子句：
  no-follow-up（"there will be no follow-up user messages"）、
  proceed-after-plan（"continue executing immediately once the plan is formed"）、
  no-pause（"do not pause to wait for confirmation"）、
  no-modify（"must not modify the skill"）、
  no-stop（"do not stop merely because another round of confirmation is missing"）。
- 边界授权句按 mode：可变题 "you may modify `/app/fixture/` directly"；
  只读题 "`/app/fixture/` must remain completely unchanged"；
  build-artifacts 题 src 零改动 + lib 可清理（照抄现有任务的措辞最稳）。
- task.toml：`execution_contract = "BENCHMARK-AUTH-v1"` 恰好一次、
  `version = "1.1.0"`。

**四连注册表（全部必须同步，否则校验失败）**：

1. `benchmark/README.md`：任务表加行（Task/Type/What it tests）；顶部
   "The N plugin-upgrade tasks measure"；"The first N are written exams …
   the last M are hands-on"（按 Type 列计数）；`# all N tasks` 注释；
   "All N `instruction.md` files carry"；"existing N tasks" 维护者注记。
2. `benchmark/docs/scoring.md`：`Total <N×100> (N tasks × 100; …)`；
   任务表加行（Checkpoint 卡引用 + Score breakdown 精确到每条）。
3. `benchmark/scripts/validate-execution-contract.mjs`：expectedModes
   Map 加 `['<task-id>', '<mode>']`（mode ∈ readonly | mutable |
   build-artifacts-only）。
4. benchmark 的卡引用：全 ID + 链接可解析（validate.mjs 会查）。

### Stage 6 · 校验与 oracle 自检（门禁）

```sh
cd dsh-plugin-upgrade-skill
node scripts/validate.mjs                       # 卡 + 链接 + 引用全绿
node benchmark/scripts/validate-task-registry.mjs    # 任务清单/计数注册表一致
node benchmark/scripts/validate-execution-contract.mjs  # 契约五子句 + mode
# oracle 自检（must be 1.0）：
harbor run -p benchmark/tasks/<id> -a oracle
# harbor 不可用时（本机 pip/uv 受限），用 docker 手动走通等价值：
#   docker build -t bench-<id> environment/ && docker run ... 复制 oracle →
#   fixture → node tests/judge.mjs → 断言 {"score":100}
node --check tests/judge.mjs && node --check tests/judge-utils.mjs
```

Checkpoint：三个校验全绿 + oracle 100/100 + 文件权限（solve.sh / test.sh
755，与现有任务一致）。**不绿不交付**。

## 交付

- `tasks/<id>/` 完整任务 + 四连注册表改动，与升级卡（如有）同一 PR 主题。
- PR 描述声明验证命令与结果（validate × 3 + oracle 1.0）、覆盖的卡、
  未覆盖边界、致谢（本次实战致谢脚本 `$_S/` 无，按仓库惯例）。

## Gotchas（实战教训，新增题前先扫）

1. **注释会自伤**：solution 源码注释不得含 judge 要 grep 的"已删除"字面 token。
2. **manifest 遮蔽**：client-modules 从 Node entry 向上找最近 package.json；
   残留旧清单（无 dsh.client）让浏览器半静默消失——参考解要删，
   这是合法题点不是 bug。
3. **boot URL ≠ 文件路径**：`__DSH_BOOT__` 条目按 exports key 拼
   `${pkg}/client.js`；判 boot 图别去匹配真实路径。
4. **服务名随走廊变**：`httpServer`→`webServer`（R1-09）、`tasks`→`jobs`；
   fixture 用旧名、参考解用新名之前，先在容器冷启动验证哪个名能解析。
5. **profile 组合**：web 冷启动 profile 用
   `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']`；headless 用
   headless 预设。别复用共享 ~/.dsh。
6. **版本钉死**：Dockerfile 的 pnpm/dsh 版本与现有全部任务完全一致
   （pnpm@11.24.0 / dsh@0.1.2-alpha.2）；改了等于换题。
7. **pkill 自杀**：judge 清理命令 pidpattern 用 `[x]` 括号技巧，否则匹配到
   自己执行的 sh -c 会杀自己（本次实测 exit 143）。**注意 `[x]` 只防"模式
   文本自身"**：同一 sh -c 命令行的其他位置若还有明文 profile 名（如 add/boot
   命令），pkill 依然自杀——把 pkill 拆成独立 exec。
8. **sh 引号吞内嵌脚本**：judge 里用 `node --input-type=module -e 'script'`
   做路由冒烟时，内嵌脚本中的单引号会在 sh 单引号内提前闭合 → node 收残缺
   程序 → SyntaxError 伪装成"路由失败"（stderr 只有 node 栈尾）。修法：
   内嵌脚本零单引号（断言用 `JSON.parse(text).ok === true` 而非
   `text.includes('"ok":true')`）。已写进 M14 judge 头注释。
9. **harbor 可用性**：本机 harbor CLI 因 uv/pip 沙箱装不上；oracle 验证可用
   docker 手动等价路径，README 说明跑法（harbor run -a oracle 为标准式）。
10. **一个走廊多题**：强 case（如 bundle 转换、服务改名）可出多道独立题，
    各自 fixture 聚焦不同 touchpoint；不要一道题塞所有。
11. **判别力验证**：交付前不只要 oracle=100，还要跑**负例矩阵**——未动
    fixture 必须 0（gate）、陷阱跟随为该 check 上限、半迁移（如只改服务名
    不改事件名）落在预期带。judge 要是"什么都得高分"就没有评测价值。

## references（按需读）

- `$_S/references/case-selection.md` — 选材判据细节与反例。
- `$_S/references/harbor-task-spec.md` — 目录规范、task.toml 字段、
  环境镜像、判分信号表（详细版）。
- `$_S/references/contract-clauses.md` — 契约五子句与授权句的全量字面
  （照抄最稳）。
- `$_S/references/grading-recipe.md` — judge 三段式、分数带、caps 设计。
- `$_S/references/host-archaeology.md` — 宿主源码考古出的坑与证据
  （client-modules 解析、boot URL、服务改名）。
- `$_S/references/registry-sync.md` — 四连同步全量清单 + 校验命令。
- `$_S/assets/` — task.toml.example / instruction.md.example /
  judge-utils.mjs（完整库）/ judge.mjs.example / test.sh.example /
  Dockerfile.example / solve.sh.example。

## 校验清单（交付前逐项自查）

- [ ] Stage 0 三问：真实迁移 / 容器可测 / 卡存在或随题新增
- [ ] fixture `private: true` + "exam material only"；旧形态容器实测会坏
- [ ] judge 全部锚是宿主侧信号；gate/静态/运行时三段齐全；边界声明齐全
- [ ] oracle 100/100（harbor 或 docker 手动）
- [ ] solution 注释无 judge grep token；残留清单已删
- [ ] 四连注册表同步（README × 6 计数、scoring Total+行、expectedModes）
- [ ] validate.mjs + validate-task-registry + validate-execution-contract 全绿
- [ ] solve.sh / test.sh 755