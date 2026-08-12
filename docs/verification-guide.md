## 验证 DSH 插件真的可用（实战方法）

> 本文从 dsh-agent-teams 插件（多智能体团队协作 + Web UI 活动面板）的完整验证历程蒸馏而来。
> 全部命令都真实执行过；每一层都踩过坑，坑已标注在对应步骤。原则：**不碰正在运行的实例，验证在独立 profile / 独立端口 / 临时目录上进行，测完清理**。

### 验证金字塔总览

自底向上四层，每层通过再进下一层；任何一层失败都要先修再继续：

1. **离线**：双 program typecheck + 构建 + 冒烟脚本（纯逻辑、临时目录、自清理）
2. **组合**：`dsh --profile <scratch> --dump-config` 验证 bundle 补丁能组合进配置树（不 boot、不碰实例）
3. **真实端到端**：独立 headless profile + 真实 LLM 任务 + 落盘/事件检查
4. **GUI**：独立 web 实例 + ego-browser 驱动真实浏览器（名册 → 路由 → DOM 探针 → 截图）

---

### 1. 离线验证

#### 1.1 双 program typecheck

DSH 插件往往同时有 **host 侧**（Node：工具、路由）与**浏览器侧**（React 组件、Conversation Node）。两边会拉进互相冲突的类型声明（典型：host 侧 `dsh-session` 的 index 声明 `Context.sessions: SessionStore`，与浏览器 runtime 的 `ISessions` 同名冲突），**必须拆成两个独立 tsc program**：

```jsonc
// tsconfig.json（host）：include src，exclude ["src/client"]
// tsconfig.client.json：extends ./tsconfig.json + jsx react-jsx + lib DOM + types []
//     include ["src/client", "src/event-types.ts", "src/css-modules.d.ts"]
```

```sh
tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit   # 两个都要 0 错误
```

坑（都真实踩过）：
- **`.ts` 文件不解析 JSX**：客户端入口含 JSX 必须命名为 `index.tsx`（`index.ts` 会把 `<Component` 当小于号报 `TS1005 '>' expected`，且与 jsx 配置无关）。
- **`declare module` 合并需要目标模块先被加载**：`declare module '@deepseek-ai/dsh-session/types'` 扩展 `SessionEventMap` 前，该模块必须已作为模块存在于 program 中——在文件顶部加 `import type {} from '...'`（类型导入会加载模块声明，产物中被擦除）。
- **闭包内窄化失效**：`match.event.data.x` 在 `.map((m) => ...)` 回调里使用时，判别联合窄化不保留——先在守卫后提取 `const x = match.event.data.x` 再用。
- **类型链接目标**：`profiles/node_modules/@deepseek-ai/*` 的链接指向不稳定（staging 快照可能是旧构建，声明 `module 'cordis'` 而非 rescoped 的 `'@deepseek-ai/cordis'`）。开发时把 `node_modules/@deepseek-ai/<pkg>` 直接链接到 **checkout 源码包的目录**（其 `lib/types` 是声明正确的构建）；若 client 包 lib 过期（缺 `Context` 声明合并），优先链接到运行实例同版本的 staging 构建，或直接映射源码。

#### 1.2 构建（tsc + tsdown client bundle）

```jsonc
// package.json scripts
"build": "tsc -p tsconfig.json && tsc -p tsconfig.client.json && tsdown",
"typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit",
"verify": "node scripts/verify.mjs"
```

- tsc 产出 `lib/`（host 可执行 ESM）与 `lib/types/`（声明）
- `tsdown` 把 `lib/client/index.js` 打包成浏览器 bundle `lib/client.js`（协议：CJS closure-factory，`window.__ModuleLoader__.load({ id, factory })`；外部化平台模块 react / `@deepseek-ai/dsh-client-*`；CSS Modules 经 lightningcss 内联并注入 `<style data-plugin>`）
- 构建后冒烟：`node -e "import('./lib/index.js').then(m => console.log(Object.keys(m)))"` 应看到 `name/inject/Config/apply`

坑：当前 DSH preset 从 `lib/types/...` rebase 到 `src/...`；外部插件应按自己的 emitted 布局实现，不能机械写死任意 `/lib/`。tsdown 0.22 已弃用 `external/noExternal`，但当前 checkout preset 仍在使用；迁移 `deps.neverBundle/alwaysBundle` 前先验证函数匹配语义，不要只把 warning 当成永久可忽略。

#### 1.3 冒烟脚本（scripts/verify.mjs）

零依赖、临时目录自清理、纯逻辑可测。模板（直接照抄骨架）：

```js
#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { /* 被测的纯函数 */ } from '../lib/state.js'

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`)
  else { failures += 1; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

// 1) 纯规则：状态机迁移、依赖门禁、sanitize——输入输出都写成断言
// 2) 文件持久化：mkdtemp 临时根 → createTeamDir/readTeam/mailbox 往返 →
//    归档/删除 → finally { rm(stateRoot, { recursive: true, force: true }) }
// 3) 状态函数：从 lib/ 导入（如 taskVisualState/taskDepthsById），构造 fixtures 断言
// 4) 浏览器 fold：import('../lib/client/xxx.js') 直接跑纯 fold 逻辑（不依赖 React）

if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exit(1) }
console.log('\nall checks passed')
```

要求：断言 label 必须与输入和条件一致；覆盖缺失依赖、空目录、终态拒绝迁移并在 `finally` 清理临时目录。关系 UI 的纯投影还要断言 stage 顺序、自然 id 排序、非有限 depth 回退、上下游包含、sibling 排除和 cycle safety。`pnpm verify` 进 CI/提交前。

#### 1.4 组合验证：dump-config（不 boot、不碰实例）

用**独立 scratch profile** 验证 bundle 补丁能组合进配置树：

```sh
# 手动构造 scratch profile（不必走 pnpm）
mkdir -p ~/.dsh/profiles/agent-teams-check/node_modules
ln -sfn /absolute/path/to/plugin ~/.dsh/profiles/agent-teams-check/node_modules/<pkg>
cat > ~/.dsh/profiles/agent-teams-check/package.json <<'EOF'
{ "name": "dsh-profile-check", "private": true, "dependencies": {},
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "<pkg>"] } } }
EOF
printf '[]\n' > ~/.dsh/profiles/agent-teams-check/cordis.patch.yml   # 必须是顶层数组！

dsh --profile agent-teams-check --dump-config | grep -A 4 "id: agent-teams"
```

- `--dump-config` **离线组合**（`composeEntries` 应用 patch 层），不 boot 服务、不动运行实例
- 输出应看到 `- id: <插件行>` 与其 config
- 坑：`cordis.patch.yml` 不是顶层数组会报 "must be a top-level YAML array"。组合了 web-app 的自定义 profile 可直接接收 app-level `--host/--port`；`--patch` 是可审计的固化方式，但不是唯一入口。

---

### 2. 真实端到端验证（独立 profile + 真实 LLM）

#### 2.1 安装到独立 profile

```sh
# headless 模板自动初始化；pnpm link 语义 + 自动 reconcile 进 dsh.profile.bundles
dsh plugin --profile headless add /absolute/path/to/plugin
dsh --profile headless --dump-config   # 确认组合树含插件行
```

首次真实运行通常立刻暴露 **mount 时序 bug**：Loader 并发激活下，插件 apply 时兄弟插件（如 `subagent-spawn` 的 provider 注册）可能尚未完成——**mount 时的 fail-loud 校验要移到首次使用点**（如第一次 spawn 成员时再 `ctx.subagents.getProvider(name)` 校验），错误信息要可操作。

#### 2.2 真实 LLM 任务设计

```sh
mkdir -p /tmp/agent-teams-e2e && cd /tmp/agent-teams-e2e
dsh --profile headless "用 AgentTeams 完成一个小任务：创建团队'标题方案'，加 2 个成员（alice 负责研究，bob 负责撰写），创建 2 个任务（t2 依赖 t1）分配给他们，唤醒他们完成，最后汇总产出。任务要小，每个成员只做一个简单任务。"
```

设计要点（控制 token 与可判定性）：
- **任务要小**：明确写"任务要小/每个成员只做一个简单任务"（成员 spawn + 多轮工具调用会跑 1–3 分钟）
- **明确要求走插件流程**：点名要调用的工具与顺序（创建团队→加成员→建依赖任务→唤醒→汇总），否则模型可能跳过
- 在**专用工作目录**跑（`/tmp/...`），落盘产物可预期；后台运行（`run_in_background`）并 `task_output --wait` 收集
- 判定成功：任务输出包含完整流程叙述（建队/成员/任务/产出/删队），且**事件流落盘**（见 2.3）

#### 2.3 落盘检查（数据真相）

```sh
# 团队状态文件（headless 的 cwd = 调用目录；团队删除后会归档/清空）
ls -la /tmp/agent-teams-e2e/.agent-teams/

# 会话日志：每个会话一个目录，成员子会话是独立 uuid 目录
ls -lt ~/.dsh/sessions/--private-tmp-agent-teams-e2e--/

# 事件流（zstd 压缩，用 zstdcat 解压后数 agent-teams/* 事件）
zstdcat ~/.dsh/sessions/<ws>/session-<id>/session.jsonl.zstd \
  | grep -o '"type":"agent-teams/[^"]*"' | sort | uniq -c
# 预期：team-created ×1, member-added ×2, task-created ×2, task-updated ×N,
#       message-sent ×N, team-deleted ×1（数量与流程一一对应）
```

事件流是 UI 与重放的数据源——**事件数量与流程步骤对不上就是 bug**（如成员没走 `update_task` 仪式时事件缺失，要与磁盘真相区分）。

---

### 3. GUI 验证（ego-browser + 独立 web 实例）

#### 3.1 启动独立 web 实例（不触碰用户指定的运行实例）

```sh
# 从零安装（内测 npm 流程，peer 从内测 registry 解析）：
npx -p @deepseek-ai/dsh@0.0.1-rc.1 dsh plugin --profile agent-teams-beta add @deepseek-ai/dsh-base
npx -p @deepseek-ai/dsh@0.0.1-rc.1 dsh plugin --profile agent-teams-beta add @deepseek-ai/dsh-web-app
npx -p @deepseek-ai/dsh@0.0.1-rc.1 dsh plugin --profile agent-teams-beta add /abs/path/to/dsh-agent-teams
# 启动（managed background task，保存 task id；CLI 与 bundle 同通道）：
npx -p @deepseek-ai/dsh@0.0.1-rc.1 dsh --profile agent-teams-beta --host 127.0.0.1 --port 3081
# 看到精确 URL 后再 curl
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3081/
```

- 组合了 web-app 的自定义 profile 可直接传 app-level `--host/--port`；也可用 `--patch` 固化 webserver config。
- **版本对齐坑**：npx 默认 CLI 是 rc.2（next 通道），`dsh plugin add` 默认装 latest（rc.1）——混装时 rc.2 独有的 `ui-plugin-config` 等待 rc.2 才提供的 `settingsScope`，页面报 "Failed to load plugins"。固定 CLI 为 `@0.0.1-rc.1`（与 latest bundle 对齐），或全部升级 `next`。
- 内测 registry 的 `latest`（rc.1）与 `next`（rc.2）服务键不同（`httpServer` vs `webServer`）——插件双键兼容，两个通道都要抽验。
- client HMR 需要 watcher 持续重建 `lib/client.js`；否则 `pnpm build` 后刷新页面。host/package manifest/profile bundles 改动才重启。
- apps/web shell/普通 packages 不走 client-plugin HMR；不要启动独立 Vite server 替代 DSH GUI。

#### 3.2 名册与路由探活

```sh
# 浏览器名册必须包含插件（client-modules 扫描组合树中声明 dsh.client 的包）
curl -s http://127.0.0.1:3081/ | python3 -c "
import sys, json, re
html = sys.stdin.read()
m = re.search(r'window.__DSH_BOOT__ = (.*?)</script>', html, re.S)
g = json.loads(m.group(1))
print(any('agent-teams' in e['id'] for e in g.get('entries', [])))
"
# client bundle 与自定义数据路由
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3081/plugins/<pkg>/client.js
curl -s http://127.0.0.1:3081/plugins/<pkg>/state
curl -s "http://127.0.0.1:3081/plugins/<pkg>/state?archived=1"
```

坑：当前源码读取 package.json `dsh.client`，并要求合法的 `exports["./client"]` 与实际 bundle；声明畸形或 bundle 缺失会 fail loud。包元数据负结论不自动过期，修正 manifest/export 后重启 host。

#### 3.3 DOM 探针（ego-browser）

```js
// 每个 heredoc 先复用任务空间 + 打开/复用 tab
const task = await useOrCreateTaskSpace('agent-teams webui test')
await openOrReuseTab('http://127.0.0.1:3081', { wait: true, timeout: 30 })

// 组件必须挂 data-* 探针属性（data-agent-teams-activity / data-task-state / data-member-running ...）
const probe = await js(String.raw`(() => {
  const panel = document.querySelector('[data-agent-teams-activity]')
  if (!panel) return { panel: false }
  return {
    panel: true,
    teamName: panel.querySelector('[class*="teamName"]')?.textContent ?? '',
    delegationMap: !!panel.querySelector('[data-delegation-map]'),
    dependencyMap: !!panel.querySelector('[data-dependency-map]'),
    focusedTasks: [...panel.querySelectorAll('[data-task-id][data-focused="true"]')].map(n => n.getAttribute('data-task-id')),
    pinnedTasks: [...panel.querySelectorAll('[data-task-id][aria-pressed="true"]')].map(n => n.getAttribute('data-task-id')),
    artLoaded: [...panel.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0),
    mainShift: getComputedStyle(document.querySelector('[data-phase="active"]')).paddingRight,
  }
})()`)
cliLog(JSON.stringify(probe, null, 1))
```

坑：
- **snapshotText 的 `@N` ref 每次快照都会失效**：填输入框/点按钮前先重新 `snapshotText()` 取 ref；找不到精确 ref 用 `aria-label` 或按钮文本兜底（`.match(/\[ref=(\d+), loc=[^\]]*发送[^\]]*\]/)`）
- **composer 选择器会变**：placeholder 可能从"描述你想要构建的内容"变成"给智能体发消息"——先列出所有 textbox 再精确定位
- CSS module 子串选择器容易过宽；探针优先使用稳定 `data-*`、role 和 aria 属性。
- 验证 hover preview、click pin、第二次 click/`Escape` unpin；`aria-pressed` 只落在 pin 源任务，focused chain 排除 sibling。
- 宽屏断言 main padding 非 0 且 panel/composer overlap 为 0；≤960px padding 回 0、无 body 横向溢出；关闭时采样中间帧确认不是瞬移。
- 卡片激活事件可用 CustomEvent 模拟，但至少保留一次真实按钮路径。轮询状态用 browser wait/re-probe，不用 shell sleep 忙等。

#### 3.4 截图存档

```js
await captureScreenshot('/tmp/agent-teams-panel.png')   // 返回文件路径
```

每轮关键状态各存一张（运行中 / 终态 / 归档复盘），供人类核对视觉；DOM 探针的文本证据与截图互补（探针是断言，截图是人工目检）。

---

### 4. 验证纪律

- **不碰用户指定的运行实例**：先明确其 profile/URL；用户说“不要管某实例”时，不做 curl、重启或旁路检查。
- **全链路重跑**：typecheck → build → verify → diff check；按 HMR 条件决定热换或 page reload，host/package manifest/profile bundles 改动才重启。
- **后台任务可追踪**：用 managed background task 启动并保存 task id；若用户未要求保留，用该 id 精确停止，避免宽泛 `pkill -f`。
- ego-browser task space 按目标复用，完成后关闭；仅删除本任务创建的精确临时路径。
- commit/push 按用户授权；用户要求 commit 就报告 hash，未要求 push 就不 push。

---

### 5. 验证清单模板（可复制）

```markdown
## 验证清单：<插件名>

### 构建与离线
- [ ] pnpm typecheck        # host + client 双 program 均 0 错误
- [ ] pnpm build             # lib/ + lib/client.js（closure-factory）产出
- [ ] node -e "import('./lib/index.js')..."  # 导出 name/inject/Config/apply
- [ ] pnpm verify            # 冒烟全 PASS（纯规则/持久化/状态函数/fold）
- [ ] dsh --profile agent-teams-check --dump-config | grep "id: <插件>"   # 组合树含插件行

### 真实端到端（独立 headless profile）
- [ ] dsh plugin --profile headless add /abs/path/<pkg>
- [ ] dsh --profile headless "<小任务，明确要求走插件流程>"
- [ ] 任务输出含完整流程叙述（建队/成员/任务/产出/删队）
- [ ] 落盘：.agent-teams 状态文件存在（或按预期归档）
- [ ] zstdcat 会话日志：agent-teams/* 事件数量与流程一一对应

### GUI（独立 web 实例 3081 + ego-browser）
- [ ] dsh --profile agent-teams-web --patch port.patch.yml 启动，index 200
- [ ] window.__DSH_BOOT__ 名册含插件（无则查 dsh.client + ./client export + bundle）
- [ ] /plugins/<pkg>/client.js 200；自定义路由（state/assets）200 且内容正确
- [ ] 新建会话跑任务 → 面板/卡片出现（DOM 探针 data-* 断言通过）
- [ ] 关键交互闭环（跳转隐藏/会话跟随/归档复盘）逐项探针验证
- [ ] 截图存档（运行中/终态/复盘）

### 清理与收尾
- [ ] 用保存的 background task id 停止独立实例（若用户未要求保留）
- [ ] completeTaskSpace(keep: false)；仅删除本任务创建的临时路径
- [ ] 未操作用户指定的其他运行实例
- [ ] 按用户授权 commit；未要求则未 push
```
