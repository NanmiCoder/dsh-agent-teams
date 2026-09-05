# 真实样本：Host + Web Client 插件迁到 DSH 0.1.2-alpha.2

简体中文 | [English](08-real-web-client-alpha2-migration.en.md)

> 2026-08-31 在 `omdsh-dev/omdsh-plugin-lab` 的隔离工作树完成。本文记录可复现迁移证据，
> 不把样本起点误写成现有卡片已覆盖的走廊。

## 身份与基线

- 插件包：`@oh-my-dsh/plugin-lab`；插件自身版本 `0.6.4 → 0.7.0-alpha.0`。
- DSH 依赖：精确 `0.1.0-rc.6 → 0.1.2-alpha.2`。
- 走廊说明：skill 卡片最早从 `dsh-v0.1.1-rc.2` 起，旧起点到 rc.2 是
  unsupported gap；该段用精确 tag 源码、目标包声明、编译错误和实测补证，不冒充卡片结论。
- 改依赖前 baseline：client 38 条、server 11 条测试与原有 plugin e2e 通过。

## 命中与修改

| 面 | 旧状态 | alpha.2 状态 |
|---|---|---|
| 聚合 runtime | `dsh-client-runtime/client` | 删除；类型按 Cordis、session、conversation、ui-chat owning 包导入 |
| Context facets | 偶然由聚合包/hoist 提供 | 为实际使用的 API/session/workspace/chat/renderer/commands 等做 type-only augmentation，并声明直接类型依赖 |
| transcript | `useSession` + 平铺 `snapshot.nodes[]` | `useChat` + `snapshot.order` / `snapshot.nodes.get(id)` |
| assistant final node | 旧 ConversationNode 数组 | discriminant 为 `assistant-step` 后读 `data.finalNode` |
| Host command | `execute(agent, line, signal)` | `execute(agent, line, [], signal)` |
| client inject | 包含已删除 runtime | 删除旧 service，只保留目标宿主真实提供的 runtime services |
| 发布身份 | 插件 0.6.4 | 兼容修改通过后单独升为 0.7.0-alpha.0 |

## 能复现的失败

1. 只改顶层依赖会让 lockfile 保留 rc.6 peer provider；安装成功不代表 cohort 一致。处理后
   全 lockfile 扫描不再出现 rc.6 或 `dsh-client-runtime`。
2. ui-chat 的声明引用多个 dev-only 类型包。`skipLibCheck: true` 会把缺声明延迟成 selector/
   callback 的 implicit `any`；用一次 `skipLibCheck: false` 找到所有者，再补 direct dev/peer。
3. 测试继续构造 `nodes: []` 会与 `ChatNodeStore` 不符；夹具必须提供 `get/values` 并用
   `order` 定义顺序。
4. Host `commands.execute` 缺 images 参数直接 typecheck 失败；无图不是省略，而是 `[]`。
5. Web e2e 直接 follow token URL 后再请求 manifest 得到 401：Node `fetch` 不保存 Cookie。
   改为 manual 303 → 取 `Set-Cookie` → 带 Cookie 请求干净根 URL、boot manifest 与 client
   artifact。
6. 首次安装遇到 ENOSPC 属环境故障；清理包管理器无引用 store 后重跑，不把它归因于 API。

## 验证结果

- `typecheck`、Host/Client build 通过；client 38/38、server 11/11。
- pack 得到 `oh-my-dsh-plugin-lab-0.7.0-alpha.0.tgz`，packed manifest 版本一致。
- 隔离 profile 完成 add/install、Web `--no-open` 冷启动、token→Cookie、boot entry、宿主公告
  client artifact 200、client module load 与 remove。
- 该结果证明样本可运行于目标 alpha.2；不证明 unsupported gap 中每一条中间版本边都已补卡。

对应接口细节见 [API-10](../references/api-migration-0.1.2-alpha.2.md#api-10--web-client-runtime-unbundling-keyed-chat-snapshots-and-command-attachment-parameters)，Web 验收见
[DSH-0.1.2-A1-19](../references/v0.1.2-alpha.1.md#dsh-012-a1-19--web-plugin-acceptance-now-reads-the-host-boot-manifest-and-the-auth-url)。
