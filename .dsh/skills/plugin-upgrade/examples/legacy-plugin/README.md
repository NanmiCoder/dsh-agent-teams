# legacy-plugin · 七类触点静态夹具

简体中文 | [English](README.en.md)

这是一个故意包含旧耦合与错误假设的静态夹具，用来验证
[pre-flight.md](../../references/pre-flight.md) 能检出七类触点。它不是可安装插件，
不得执行、不得发布、不能编译是设计使然。

运行仓库 `node scripts/validate.mjs` 时，校验器会使用
[pre-flight-patterns.json](../../references/pre-flight-patterns.json) 扫描本目录（排除本
README），七类都必须至少命中一次。

| 触点 | 命中位置 |
|---|---|
| #1 源码 patch | [patch.yml](patch.yml) · [apply-patch.mjs](scripts/apply-patch.mjs)；`cordis.patch.yml` 自身是 composition negative control |
| #2 内部/持久事件 | [src/index.ts](src/index.ts) · 外部 informational SessionEvent producer |
| #3 内部服务/Remote | [src/index.ts](src/index.ts) · `ctx.get('apiProxy')` |
| #4 宿主文件系统 | [src/index.ts](src/index.ts) · 固定 `~/.dsh/profiles/default` |
| #5 内部 UI/命令 | [src/index.ts](src/index.ts) · internal import + `registerCommand` |
| #6 自建通道 | [src/index.ts](src/index.ts) · loopback HTTP `/api/legacy` |
| #7 子进程/输出 | [src/index.ts](src/index.ts) · [apply-patch.mjs](scripts/apply-patch.mjs) · 错误假设 stdout 是 JSONL |

相关卡使用完整 ID（如 `DSH-0.1.2-A1-01`、`DSH-0.1.2-A2-02`）。该夹具只证明扫描
模式有已知正样本，不证明扫描零命中时没有宿主耦合。
