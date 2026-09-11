# v0.1.17 发布验证

2026-09-11 发布完成。本版包含 Harness 主题适配，已发布到 npm `latest`，推荐宿主 `0.1.5-rc.1`。保留 `0.1.2-rc.1`、`0.1.2-alpha.5`、`0.1.2-alpha.2` 三个旧目标。

主题修改与 Ego Lite 验证见[主题报告](../../theme-support-2026-09-11/README.md)。此前真实 API 团队行为验收见 [rc.1 记录](../v0.1.17-rc.1/README.md)；本次复用其会话进行界面测试，没有新增模型调用。

发布 Action 必须通过 Ubuntu / Windows 静态验证及四版本真实宿主回归，再发布同一份通过验证的 tarball。自动化模型为确定性 fixture，Windows job 覆盖静态检查，不能等同于 Windows Desktop GUI 验收。最终结果如下。

## 发布结果

- [发布 Action](https://github.com/NanmiCoder/dsh-agent-teams/actions/runs/34585430540) 成功，源码提交 `ca86dfca0b8d5031c34b6823252852b3f6ac0443`。见 [Action 元数据](action.json)。
- [GitHub Release v0.1.17](https://github.com/NanmiCoder/dsh-agent-teams/releases/tag/v0.1.17) 已公开发布，非草稿、非预发布。见 [Release 元数据](github-release.json)。
- npm `latest=0.1.17`，`next` 保持 `0.1.17-rc.1`，`alpha` 保持 `0.1.15-alpha.1`。见 [npm 元数据](npm-metadata.json)。
- 从不带版本号的 npm 默认入口下载的 tarball 与 CI candidate 逐字节相同，SHA-256 为 `ff7a5fc24cda7232538b5646dfd72865f3911de28c1888a44ee1ba376b1b4b1a`。本地候选记录用于发布前验证，不能替代这个最终 CI/npm 摘要。

| 精确宿主 | 最终产物回归 |
| --- | --- |
| `0.1.5-rc.1` | [9/9 通过](ci-runtime-0.1.5-rc.1.json) |
| `0.1.2-rc.1` | [9/9 通过](ci-runtime-0.1.2-rc.1.json) |
| `0.1.2-alpha.5` | [9/9 通过](ci-runtime-0.1.2-alpha.5.json) |
| `0.1.2-alpha.2` | [9/9 通过](ci-runtime-0.1.2-alpha.2.json) |

首轮 alpha.2 的 `messagesSentWhileBusy` 时间窗口断言失败：fixture 将成员首个响应延迟 1 秒，但队长观测到发送结果的时间晚于该响应 900 ms。该轮成员执行、任务完成、FIFO 与再次唤醒断言都通过。未改代码、包或断言，重跑失败 job 后全部通过；首次失败原始结果保留在 [first-attempt-alpha2.json](first-attempt-alpha2.json)，记录这个既存定时测试的不稳定性。

发布后将实际 npm tarball 安装到 `0.1.5-rc.1` 完整宿主依赖组，生命周期和冷恢复通过，见 [npm-consumer.json](npm-consumer.json)。Ego Lite 又加载该安装包，验证深色模式下卡片、活动面板和标签正常挂载及配色，见 [computed styles](npm-browser.json) 与[截图](npm-dark.png)。复用了此前真实 API 会话，没有新增模型请求。测试实例和浏览器 Space 已关闭。

安装或升级：

```sh
dsh plugin --profile web add --save-exact @nanmicoder/dsh-agent-teams@0.1.17
```

重启对应 Harness 进程，再刷新页面。普通新安装可省略插件版本号；实际宿主仍应使用兼容清单中的版本。
