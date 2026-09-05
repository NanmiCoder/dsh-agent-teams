# 宿主考古：从 dsh 源码挖出的地面真相

这些知识**不在文档里**，是 2026-08/09 通过读 alpha.2 宿主源码 + 容器实测
得到的。写题前先扫一遍，能避开一半的"看起来对但 boot 失败"。

## 1. client-modules 的 manifest 定位：最近 package.json 遮蔽（最高频深坑）

源码：`@deepseek-ai/dsh-client-modules/lib/index.js` 的 `locatePkgJson` /
`nearestPackage`。

**机制**：client-modules 从 **Node entry 文件所在目录向上**找最近的
package.json，作为该包的 manifest（包身份），然后读它的 `dsh.client` +
`exports["./client"]` 决定是否进入 `__DSH_BOOT__` 浏览器表。

**后果**：如果迁移后的 Node half 留在 `.dsh-plugin/` 等子目录，且那里有一个
**残留的、无 `dsh.client` 的 package.json**（repository 时代清单），它就会
遮蔽根清单 → 包被判定为"非 client 包" → **浏览器半静默消失**，Node half
照常 apply，boot 无 pending——考试里这就是"装上了、激活了、但 boot 图没有
它"的隐蔽失败态。

**写题启示（方法级）**：
- 可以利用这个机制布坑：fixture 的旧布局里留一个会遮蔽根清单的残留
  manifest，"只补根清单、不清残留"的解法就会静默漏掉浏览器半；
- judge 的 boot 图条目检查（`html.includes('<pkg>/client.js')`）自然抓到
  这类坑——**不用专门 judge**，真实失败态就是 boot 图缺条目。
  （具体某道在线题怎么布这个坑、参考解如何收尾，不在此展开。）

## 2. boot URL 与真实文件路径无关（按 exports key 拼）

`__DSH_BOOT__.entries[].url` 是 `/plugins/??<pkg>/client.js&rev=…` 形态——
**按 exports 的 key**（`"./client"` → `<pkg>/client.js`）拼，不是目标文件路径。
实测：H9 的 `exports["./client"] = "./lib/client.js"`，boot URL 仍是
`@linxin666/dsh-web-all/client.js`；M13 的 `"./client": "./.dsh-plugin/client.js"`，
boot URL 仍是 `@demo/dsh-bench-repo/client.js`。

判 boot 图时匹配 `<pkg>/client.js` 即可，勿匹配真实路径。

## 3. 服务名随走廊变（写 fixture/参考解前先验证）

- `httpServer` → `webServer`（R1-09，0812）：alpha.2 只认 `webServer`，
  继续 inject `httpServer` 会 `pending (waiting for service: httpServer)`。
- `tasks` → `jobs`（R1-09）：`tasks.read` → `jobs.read`。
- 旧形态 fixture 用旧名（还原"当时坏"），参考解用新名（或让该题与服务
  完全无耦合——避免把 R1-09 混进 R1-01 主题）。
- **动手前先容器冷启动验证**哪个名能解析，别凭卡名猜。

## 4. `dsh plugin add` 的安装语义

- bundle 插件（声明 `dsh.bundle.patch`）：进 profile `dsh.profile.bundles`
  层栈，**web 重启生效**。
- 纯 cordis 插件（无 bundle 声明）：写 profile `cordis.patch.yml` insert 行，
  **配置 HMR 实时生效**（0811 保留）。
- add 用 `link:` 安装（profile package.json 依赖 `"@demo/x": "link:/app/fixture"`），
  所以 judge 里 profile 依赖图能看到 fixture。

## 5. headless 冷启动激活信号

无 API key 配置时，插件树整体激活的标志是到达 `MISSING_CREDENTIAL` /
`no API key` / `dsh: AUTH`——**不是 exit code**（无 key 成功也 exit 1）。
判"插件树活了"看这个信号，别读退出码。

## 6. profile 生命周期（judge-utils 已封装）

- profile 目录 = `~/.dsh/profiles/<name>/`，含 package.json（bundles 层栈 +
  依赖）、cordis.patch.yml、cordis.yml。
- web 冷启动组合：`['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']`。
- 独立 DSH_HOME 或 profile 隔离，**绝不复用会话 GUI 的 3080 与共享 ~/.dsh**。

## 7. pkill 自杀（运维坑，实测）

清理 dsh 进程时 pkill 的 pidpattern 用 `[x]` 括首字母（`pkill -f "dsh --profile
bench-[t]ask"`），否则 pkill 会匹配到**你自己 sh -c 命令行里的同样字符串**，
把自己杀了（exit 143，docker exec 直接断）。

**`[x]` 只防"模式文本自身"**：若同一 sh -c 命令行的别处还有明文 profile 名
（例如 `dsh plugin --profile bench-probe add …` 与 `pkill -f "dsh --profile
bench-[p]robe"` 在同一 exec 里），pkill 会匹配同行里 `--profile bench-probe`
的明文而自杀。**把 pkill 拆成独立 exec**，或者让 add/boot 命令也走变量拼接。
M14 实战实录：手测时把两者放同一条 sh -c，exit 143 全挂；judge-utils 的
cleanupProfile 之所以安全，是因为那条命令里没有明文 profile 名。

## 8. 参考解源码注释别含 judge 要 grep 的字面 token

如果 judge 用正则 grep 旧标识符判"已删除"，参考解的注释里**不能**出现
这些字面值——"某路由 / 某注入已删除"这类说明性注释本身会命中 grep、自伤
扣分（实战教训：某题 solution 首版注释复述了被要求删除的路由与注入标识符
字面，judge grep 到注释判未删）。

## 8b. sh 引号吞内嵌脚本（judge routeSmoke 新坑，M14 实测）

judge 里用 `node --input-type=module -e '<script>'` 做 HTTP 冒烟时，内嵌脚本
若含单引号（如 `text.includes('"ok":true')`），单引号会在 sh 单引号包裹内
**提前闭合** → node 收到残缺程序 → SyntaxError，且 stderr 只有 node 栈尾，
表现为"路由冒烟 no response / parse failed"而非 fetch 失败——排查时极易误判
为网络问题。

**修法**：内嵌脚本零单引号。断言改为 `JSON.parse(text).ok === true &&
typeof open === 'number'`（正则/变量对比即可，不写字符串字面量 if 比较）。
M14 首版中招、已改，judge 头注释含警告。

## 9. Dockerfile 版本钉死

`node:24-bookworm` + `pnpm@11.24.0` + `@deepseek-ai/dsh@0.1.2-alpha.2`，与全部
现有题一致。改版本 = 换题环境，oracle 1.0 全部作废重验。

## 证据索引（想深挖读这些）

- 容器内：`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js`（1、2）
- 既有 judge-utils：`benchmark/tasks/H3-client-plane/tests/judge-utils.mjs`（5、6）
- 既有题实测：`M13-repository-plugins-removal`（1、4、8）、
  `M5-token-auth-smoke` / `H8-fire-drill` judge（3）