# 选材判据：什么值得做成考题，什么不值得

dsh-benchmark-case 的 Stage 0 展开。核心问题永远是：
**这道题能测出"AI 会/不会某件事"吗？判分是机械的、无歧义的吗？**

## 强信号（×成立越多，题越值得做）

1. **迁移真实发生过**：git 历史里能找到"迁移 commit"，最好是独立 commit
   （`426e86d` whale-girl bundle 转换、`bfa0e8d` plugin-registry console 适配），
   而不是混在几十个 commit 里的一次顺手改名。迁移 commit 的 diff 就是
   fixture（迁移前）与 oracle（迁移后）的天然素材。
2. **走廊清晰**：能归属一个 from→to（如 rc.8 → rc.1），并且 references/ 有
   对应卡（或决定随题补卡）。没有卡支撑的题，AI 无从查证，等于考背诵。
3. **断裂面小（1~4 个 touchpoint）**：fixture 好构造、judge 好写、解题路径
   唯一。多于 4 个 touchpoint 的迁移拆成多道题，各自聚焦。
4. **装旧形态必有可观察故障**：pending / plugin tree failed / 静默缺行为
   （boot 图缺条目、某通道 404）。"旧形态也全绿但只是不推荐"不成题。
5. **新形态在 alpha.2 上可容器冷启动验证**：这是硬约束。无浏览器环境决定了
   client 运行时不可判，只能判宿主宣告（boot 图 / HTTP 状态 / 激活信号）。
6. **有真实坑**：迁移中"第二个 commit"修的那个问题就是坑（误导注释、
   看着无害的残留、预置红测试）。坑必须来自真实迁移，不能编。

## 反例（不成立 → 退回升级卡形态）

| 情况 | 为什么不成题 |
|---|---|
| 纯自研重构（无 host 侧变化） | 考不到"升级"，升级卡都不需要 |
| 迁移在旧 host 上才能演示 | 容器固定 alpha.2，无法还原旧宿主故障 |
| 判分取决于输出文本内容 | 无固定输出文本可依赖；必须用宿主侧信号 |
| fixture 简单到一眼看穿 | 测不到 skill 的价值，分差 ≈ 0 |
| fixture 复杂到无法在容器内还原 | oracle 1.0 过不了，交付即失败 |
| 只有一张卡、一个 touchpoint 的小事 | 拆太碎；合并进相邻题或先出卡 |

## 从一张卡出题 vs 从一个仓库出题

- **一张卡 → 一道题**：卡里 Symptoms/Migration recipe/Verification 三者都
  能在容器里机械验证时（如 R1-01 repository 移除、R1-09 服务改名）。
- **一个仓库 → 多道题**：强 case（bundle 转换链）可拆成"改 manifest 形态"、
  "删残留清单"、"client 模块化"多道独立题，各自 fixture 聚焦不同 commit 的
  迁移前形态。
- 一个仓库 → 零道题：仓库的迁移不可在容器还原（依赖特殊硬件/外部服务时）。

## 实战样本（本次经验来源）

- **whale-girl `426e86d`**：repository-plugin → bundle。1177 行 diff，核心
  断裂 = repository 机制移除（R1-01）+ client 从自执行变 `{name, apply}`
  模块（R1-01 配方）。容器可测：add → boot → `__DSH_BOOT__` 含 client。
- **plugin-registry `bfa0e8d`**：console 从 repository 行管理 → profile
  insert 行管理。断裂 = 4 个 plugin_* 工具无后端。更适合出"工具分流逻辑"
  静态题或 console 行为题，容器内更重。
- **`httpServer`→`webServer`（R1-09）**：四仓库一天内同因改名——高频低通量
  破坏，静态 grep 旧标识符即可锚定（S 类静态题理想素材）。

## 决策记录要点

Stage 0 结论写进后续的 SOLUTION.md / scoring.md 提案时，三个信息必须有：
走廊、覆盖的卡 ID 全名、容器验证路径（哪条命令证明新形态活）。