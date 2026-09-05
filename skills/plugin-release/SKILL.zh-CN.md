[English](SKILL.md) | 简体中文

# plugin-release

把已开发、已测试的插件安全地发出去。发布是单向外发动作，**任何实际发布或推 tag 前必须先展示计划并确认**；本 Skill 不替你决定版本号，也不自动 bump 版本。

## 第 0 步：确认目标版本与发布轨

| 发布轨 | 适用 | 关键事实 |
|---|---|---|
| GitHub 直装 | `dsh plugin --profile <p> add github:owner/repo` | 消费者解析默认分支 HEAD；发布=推送到 main，**推前必须跑完整门禁** |
| npm registry | `npm publish` | 仅正式发布线可用；`@deepseek-ai/*` 的 alpha/rc 前缀版本**不一定**在 npm 上，发布前先 `npm view <pkg> versions` 核实 |
| hub 收录 | 在 hub catalog 登记 | 登记是独立动作，不代替打包验证 |
| collection | 把成员插件 vendored 成 pack artifact | 见所属 collection 仓库的自有流程 |

未发布 cohort（例如某个 cohort 版本从未发到 npm——alpha.1 只有 GitHub 来源；alpha.2 到 alpha.4 已通过 `alpha` 通道标签发布）走 [references/publish-playbook.md](references/publish-playbook.md) 的 overrides 流程，**不要**在 npm 上找不存在的版本，也不要因此切换包管理器。

## 第 1 步：打包与产物校验

1. 用仓库唯一的包管理器与 lockfile（有 `package-lock.json` 用 npm，有 `pnpm-lock.yaml` 用 pnpm）；
2. 跑完整门禁（见第 3 步），再 `npm pack` / `pnpm pack`；
3. 解包校验：`files` 覆盖全部运行时相对导入与资产；产物里没有 `.ts` 残留；`cordis.patch.yml`/`dsh.plugin.json`/`SKILL.md` 等形态文件齐全；
4. tarball 装入隔离 profile 做消费验证（`dsh --profile compat --dump-config` 出现本插件 row → 工具真实注册与执行）。

## 第 2 步：版本依赖基线（alpha 时代）

- devDependencies 使用 **npm 发布线**（当前 0.1.1-rc.2）作为类型基线，保证公开仓库在任何机器上 `npm install` 后 typecheck 可用；
- peer 范围用宽范围（如 `<0.2.0`）覆盖未发布的 alpha/rc；
- 代码需要兼容本地 harness（GitHub tag）与 npm 发布线两侧时，用**双兼容写法**：保留 npm 发布线类型要求的形态，同时在 alpha 运行时语义不变（见 playbook 的“双兼容写法”节）；
- 不要把本机绝对路径（junction/file:）写进提交的 package.json。

## 第 3 步：发布门禁（逐层，前层不过不进后层）

1. 依赖解析：lockfile 只发生预期变化；无混合 cohort；
2. 静态：typecheck + 插件测试 + build；
3. 真实挂载：在**锁定精确 DSH tag**（禁止用可变的 master/main 冒名验收）的隔离 profile 上冷启动目标宿主，entry active、服务不停 pending。Web Client 插件还要验证：宿主公告资源（启动图/boot 名单中的 bundle 入口）可访问、bundle 注册成功、DOM 挂载完成、无 page error——只看 `--dump-config` 不算完成本层；
4. 行为：一条核心路径真实执行（工具插件=一次消息→工具→回复；或等价专用流程）；
5. 包装器：核对退出码与 stdout/stderr 归属。

## 第 4 步：发布语义门禁（任一不满足即停止发布）

1. GitHub Release tag 必须等于 `v${package.json.version}`；
2. 版本号是否含 prerelease 后缀（`-` 之后、`+` build metadata 之前的段），必须与 GitHub Release 的 prerelease 状态一致；
3. prerelease 只能发布到**项目声明的非 latest dist-tag**（名称由项目自定，如 `next`、`alpha`——不写死具体名字）；无后缀的 stable 版本才进入 `latest`；
4. stable 发布前查询现有 `latest`（`npm view <pkg> dist-tags.latest`），semver 低于现有 latest 时拒绝发布，防止把 latest 回退到更低版本。

## 第 5 步：发布与回滚

- 发布前：干净提交 + 打 tag；记录 lockfile 与 composition 基线 hash；
- 发布后：以消费者身份重装一次并冒烟；
- 回滚：优先回退发布（删 tag/重新指向旧 commit），不发布“兼容两边”的补丁掩盖问题；
- 未发布 cohort 的 CI 见 playbook 的“CI 与发布门禁”节（缓存 cohort store、`NPM_PUBLISH_ENABLED` 开关）。

## 安全边界

- 发布/推 tag/写 hub 登记前必须展示计划并确认；不自动 bump 版本；
- 不发布含凭据、`.npmrc` 内容、会话日志或私有路径的产物；
- 不切换包管理器、不重写另一套 lockfile；失败时只回滚本次拥有的路径并报告残留。

## 参考材料

| 文件 | 内容 |
|---|---|
| [references/publish-playbook.md](references/publish-playbook.md) | 未发布 cohort 安装、双兼容写法、CI/发布门禁、真实坑位清单与回滚配方 |
| [references/profile-dependency-management.md](references/profile-dependency-management.md) | profile 安装/更新配方：github 依赖锁缓存、包改名三处同步、junction 清理与宿主升级联动 |
