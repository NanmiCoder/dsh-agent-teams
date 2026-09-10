# v0.1.17-rc.1 发布记录

2026-09-10 发布完成。

- npm：`@nanmicoder/dsh-agent-teams@0.1.17-rc.1`，渠道 `next`；`latest` 保持 `0.1.15`。
- 推荐宿主：`@deepseek-ai/dsh@0.1.5-rc.1`。
- Git tag：`v0.1.17-rc.1`，提交 `2e59da17918558cfa3bf91d30d40f737509cca0c`。
- [发布 Action #34488258594](https://github.com/NanmiCoder/dsh-agent-teams/actions/runs/34488258594) 全部成功：Ubuntu、Windows、四版本宿主回归、完整兼容 gate、npm publish、GitHub Release。
- [GitHub Release](https://github.com/NanmiCoder/dsh-agent-teams/releases/tag/v0.1.17-rc.1) 已发布，prerelease=true、draft=false。

## 最终发布产物

SHA-256：`efe4989adaed00b7b29b82767c2d916e98541e6b7fefbd0732a35053ffb19302`。

从 npm 通过精确版本下载的 tarball 与 Action 的 candidate.tgz 逐字节相同；registry SHA-512 integrity 也与下载文件一致。[npm 元数据](npm-metadata.json)、[渠道快照](npm-dist-tags.json)、[Action 结果](publication-action.json)、[Release 元数据](github-release.json)。

这是更新发布文档后由 CI 构建并发布的产物，区别于发布前本地候选包。56 个运行文件中，55 个与本地构建逐字节相同；client.js 差异仅为构建路径生成的 CSS 模块类名与虚拟 source region 注释，归一化后完全相同。见 [构建比较](ci-local-runtime-comparison.json)。本地真实 API 与 Ego Lite 交互验收参见 [功能记录](README.md)。

| CI 宿主 | 同一最终 tarball 的真实宿主/确定性模型回归 |
| --- | --- |
| `0.1.5-rc.1` | [9/9 通过](ci-runtime-0.1.5-rc.1.json) |
| `0.1.2-rc.1` | [9/9 通过](ci-runtime-0.1.2-rc.1.json) |
| `0.1.2-alpha.5` | [9/9 通过](ci-runtime-0.1.2-alpha.5.json) |
| `0.1.2-alpha.2` | [9/9 通过](ci-runtime-0.1.2-alpha.2.json) |

发布后又安装了从 npm 下载的 tarball：`0.1.5-rc.1` 完整 231 包闭包核验、lifecycle、cold restore 均通过，见 [消费者验证](npm-consumer.json)。第一次本地依赖元数据查询发生 ETIMEDOUT；重试使用之前已验证的依赖缓存离线安装，同一 npm 下载插件包、真实 CLI 与行为用例均未替换。该消费者测试使用确定性模型，真实 API 证据另见功能记录。

## 用户安装

```sh
npm install --global @deepseek-ai/dsh@0.1.5-rc.1
dsh plugin --profile web add --save-exact @nanmicoder/dsh-agent-teams@0.1.17-rc.1
```

安装后重启该 profile 的 Harness，再刷新浏览器。中英文 README 已更新上述宿主/插件配对及精确安装命令。早期删除且未保留团队归档的历史会话不在本次重建范围内。
