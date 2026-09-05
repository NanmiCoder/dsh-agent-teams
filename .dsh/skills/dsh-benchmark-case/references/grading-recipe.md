# 判分配方（judge 三段式 + 分数带 + caps）

Stage 3 的展开。目标：判分**机械、无歧义、能区分真迁移与绕道**。

## judge.mjs 固定契约（所有题一致）

```js
import { /* H3 同款导入 */ } from './judge-utils.mjs'
const TASK = '<task-id>'
const PKG = '<npm 包名，如 @demo/dsh-bench-repo>'
main().catch((error) => emit(0, [`judge error: ${error.message}`]))
```

- 最后一行 stdout：`{"score":0-100,"max":100,"reasons":[...]}`（emit 保证
  try/finally 后 exit 0）。
- `tests/test.sh` 解析最后一行 JSON，写 `score/100` 到 `/logs/verifier/reward.txt`
  （或按既有 test.sh 原样复制）。

## 三段式模板（评分惯例：Gate 0 分 / 静态 40-70 / 运行时 30-60）

```js
// 0. Gate — 只读题：fixture 必须未被改（改了 = 0 分，测诚实报告）
//          可变题：fixture 必须被改（没改 = 0 分，测真的在动手）
const gate = await fixtureChanges('fixture')
if (gate.changed !== true) emit(0, [`fixture unchanged (${gate.detail}), graded as 0`])

// 1. 静态段 — manifest 字段 / exports / patch / 源码 grep
//    每 check: score += N; reasons.push(具体原因)
//    manifest 用 JSON.parse；patch 用文本 regex；源码模式用正则
//    半对给半带（如关键声明缺字段 → 给半分而非满分）
//    陷阱跟随封顶：误导注释说"别改 X"，留着 X → 该 check 上限

// 2. 运行时段 — 容器真实执行
if (!(await dshAvailable())) emit(score, [...reasons, 'dsh unavailable; treated as failed'])
const profile = 'bench-<task>'
const tmp = '/tmp/bench-<task>'
try {
  const created = await createProfile(profile, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  // 或 headless 类 profile（看参考题）
  const added = await addPlugin(profile, FIXTURE_DIR)   // +10
  const boot = await bootWebAndFetchIndex(profile, PKG) // 无 pending +10/+payload
  // boot.html.includes(`${PKG}/client.js`) → +20~40  ← boot URL 按 exports key
  // 或 headless 冷启动 signal（MISSING_CREDENTIAL = 激活）
} finally {
  await cleanupProfile(profile, tmp)  // finally 必须，进程永不 exit(1)
}
emit(score, reasons)
```

## 判分锚必须是宿主侧信号

| 锚 | 来源 | 判定 |
|---|---|---|
| `NEGATIVE_SIGNAL` | judge-utils（正则匹配 boot/激活输出） | `pending (waiting for service: …)` / `plugin tree failed` / `FAILED fiber` / `ClientPackageCompositionError` = 失败带 |
| headless 激活 | 冷启动无 key 到 `MISSING_CREDENTIAL` | 树整体激活 = 通过；**出口码不可信**（成功也 exit 1） |
| `__DSH_BOOT__` 条目 | web 冷启动 GET `/` | `html.includes('<pkg>/client.js')` |
| HTTP 冒烟 | token/cookie 通道 | 401（未保护→扣）/ 200（保护→得） |
| git 基线 | `git status --porcelain -- fixture` | 门禁两类题复用 |

**禁止**：判输出文本内容、判 stdout 文案、判"AI 是否提到了卡"（那是另一种
评测，不在 Harbor 判分里）。

## 分数带设计原则

1. **给半对留带**：关键声明完整给满分 / 缺字段给半分 / 完全缺失 0 分。
2. **陷阱封顶**：跟随误导 = 该 check 上限。误导注释把 agent 引向"看起来对
   其实致命"的改法，跟着改的解必须拿不到该 check 满分。
3. **绕道封顶**：看似全绿但用"钉旧依赖版本 / 手写兼容层"等方式绕开迁移 →
   上限。封顶要有静态引擎（grep 特定字段/模式），因为这些绕道 boot 也绿。
4. **100 = 完全正确路径**：oracle 只走合法路径拿到 100；任何绕道拿不到满分。
5. **分数差即评测点**：装 skill vs 不装的分差 = 该题测的能力。0 分差愚蠢题。
6. **判别力验证（交付前必跑负例矩阵）**：oracle=100 只是下限——还要验证
   judge 不是"什么都给高分"。每个陷阱/半迁移态跑一版：
   - 未动 fixture → 必须 0（gate）；
   - 跟随误导注释 → 该 check 上限（静态丢对应点）；
   - 半迁移（如标识符只改了一部分、漏改其余引用）→ 落在预期带（静态
     失分 + 运行时负信号）；
   - `dsh plugin add` 失败 → 低分带。
   负例分数矩阵记录进 SOLUTION.md / 交付报告；既有题的交付记录里都附了
   这类矩阵，可参照其格式（各题具体分值与落带以该题 judge 为准，本 skill
   不展开——方法级不讲答案）。

## 运行纪律

- 只建 `bench-<task>` profile 与 `/tmp/bench-<task>`，不碰共享 ~/.dsh 与 3080
  会话服务。随机端口 + 独立 DSH_HOME。
- finally 里清理（pkill 的 pidpattern 用 `[x]` 括首字母防自杀——实测
  pkill 匹配到自身 sh -c 会 exit 143 全挂）。
- 超时充裕：add 180s / boot 60s / web 150s；真 workspace（H9）verifier 900s，
  常规 600s。
- judge 异常路径 emit(0) 收尾，绝不裸 throw 到 test.sh。

## 边界声明（写进 judge 头注释 + SOLUTION.md + scoring.md）

必须声明容器边界：无浏览器 ⇒ client 运行时（DOM/__ModuleLoader__ 挂载、
渲染）不判，只判宿主宣告的 boot 图条目 / HTTP 状态；静态题明确"只读域"。

## 参考实现

读既有任务的 `tests/judge.mjs` 学结构与惯例（如 `tasks/H3-client-plane`、
`tasks/M13-repository-plugins-removal`、`tasks/M5-token-auth-smoke`）——
三段式怎么排、静态 caps 引擎怎么写、reasons 文案什么风格，照它们对齐。
各题的具体分值与封顶线以该题 judge 为准，本 skill 不展开。