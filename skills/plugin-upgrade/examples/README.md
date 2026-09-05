# 典型迁移示例

简体中文 | [English](README.en.md)

示例必须明确运行平面、验证范围和是否可执行。Markdown 片段不能冒充真实产品验证。

| 示例 | 场景 | 验证状态 |
|---|---|---|
| [01-simple-client-plugin.md](01-simple-client-plugin.md) | 历史客户端 SDK 包迁移 | 文档示例，尚未做固定 tag 编译 |
| [02-host-side-plugin.md](02-host-side-plugin.md) | Host APIProxy → owning domain service | 控制流可执行 + alpha.2 容器实测 |
| [03-client-remote-plugin.md](03-client-remote-plugin.md) | Web Client `ctx.remote` / `RemoteResult` | 控制流可执行；产品 Web smoke 待补 |
| [face-contracts/](face-contracts/) | Host/Client 分平面回归守卫 | `node .../check.mjs` |
| [04-dual-cohort-plugin.md](04-dual-cohort-plugin.md)（[EN](04-dual-cohort-plugin.en.md)） | 真实样本：dsh-mnemon 同时兼容 rc.2 registry 与 alpha.1 source cohort | 实测记录：双 lane 完整 verify + 真实 Connection 注册回归；产品浏览器双 cohort mount 未覆盖 |
| `05-third-party-plugin-patch.md`（待补） | 第三方预构建插件 patch | 未实现 |
| [06-real-world-batch-migration.md](06-real-world-batch-migration.md)（[EN](06-real-world-batch-migration.en.md)） | 真实批量迁移实录（6 个插件，三种形态，含踩坑清单）＋后续跟随 0.1.2 列车至 rc.1 的零代码追车记录（含每边例行流程与新坑） | 实测记录：源自 6 个真实插件的实机 boot 验证 + 单测回归（非本仓库可执行夹具）；追车段截至 2026-09-04 实测 dsh-v0.1.2-rc.1（Windows） |
| [07-multi-repo-batch-migration.md](07-multi-repo-batch-migration.md) | 17 个工具插件 × 三个版本台阶的批量迁移操作手册（同步审计、批量门禁、推送与 profile 收尾） | 实测记录：三个版本台阶的连续迁移过程记录（技术触点引用卡片） |
| [08-real-web-client-alpha2-migration.md](08-real-web-client-alpha2-migration.md) | 真实样本：从更早 unsupported 走廊段迁移 Host + Web Client 插件源码到 0.1.2-alpha.2 | 实测记录：2026-08-31 在隔离工作树完成的可复现迁移证据 |

## 贡献要求

1. Host、Web Client 与普通 Cordis plugin 必须分开；
2. 可执行代码只保留一个源文件，文档链接它，不复制第二份会漂移的实现；
3. 明确区分控制流测试、固定 tag build、Loader/profile smoke 与完整产品验证；
4. 引用完整卡片 ID和固定一手来源；
5. 不能执行的扫描夹具必须明确标注“不得执行”。
