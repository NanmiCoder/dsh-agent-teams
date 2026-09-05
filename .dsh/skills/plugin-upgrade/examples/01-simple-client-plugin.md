# 示例 01：简单客户端插件

简体中文 | [English](01-simple-client-plugin.en.md)

**场景**: 一个纯客户端 UI 插件，只用了 `dsh-client-runtime` 获取 settings。

**影响触点**: #3 内部服务探测（客户端导入）

**复杂度**: ⭐

---

## 升级前

```typescript
// src/index.ts
import { ClientContext, useSettings } from '@deepseek-ai/dsh-client-runtime/client'

export function MyPlugin(ctx: ClientContext) {
  const settings = useSettings(ctx)
  const theme = settings.get('ui.theme')
  
  return {
    name: 'my-plugin',
    render() {
      return `<div class="theme-${theme}">Hello</div>`
    }
  }
}

// package.json
{
  "dependencies": {
    "@deepseek-ai/dsh-client-runtime": "^0.1.1",
    "@deepseek-ai/cordis": "^0.1.1"
  }
}
```

---

## 升级后

```typescript
// src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { useSettings } from '@deepseek-ai/dsh-client-ui-settings/client'

type ClientContext = Context

export function MyPlugin(ctx: ClientContext) {
  const settings = useSettings(ctx)
  const theme = settings.get('ui.theme')
  
  return {
    name: 'my-plugin',
    render() {
      return `<div class="theme-${theme}">Hello</div>`
    }
  }
}

// package.json
{
  "dependencies": {
    "@deepseek-ai/dsh-client-ui-settings": "^0.1.2",
    "@deepseek-ai/cordis": "^0.1.2"
  }
}
```

---

## 迁移步骤

1. **更新导入**:
   ```sh
   # 全局替换
   sed -i "s/@deepseek-ai\/dsh-client-runtime\/client/@deepseek-ai\/dsh-client-ui-settings\/client/g" src/**/*.ts
   ```

2. **添加类型别名**:
   ```typescript
   import type { Context } from '@deepseek-ai/cordis'
   type ClientContext = Context
   ```

3. **更新 package.json**:
   ```sh
   pnpm remove @deepseek-ai/dsh-client-runtime
   pnpm add @deepseek-ai/dsh-client-ui-settings@^0.1.2
   ```

---

## 验证

```sh
# 1. 检查无残留引用
grep -r "dsh-client-runtime" src/
# 预期：无输出

# 2. 类型检查
pnpm run typecheck
# 预期：无类型错误

# 3. 构建
pnpm run build
# 预期：构建成功

# 4. 启动测试
pnpm dsh --profile test
# 预期：插件正常加载，settings 可访问
```

---

## 常见错误

### 错误 1: `Module not found: @deepseek-ai/dsh-client-runtime/client`

**原因**: 未更新所有导入路径。

**解决**:
```sh
# 查找所有引用
grep -r "dsh-client-runtime" .
# 逐个替换
```

### 错误 2: `Type 'Context' is not assignable to type 'ClientContext'`

**原因**: 忘记添加类型别名。

**解决**:
```typescript
import type { Context } from '@deepseek-ai/cordis'
type ClientContext = Context
```

### 错误 3: `useSettings is not a function`

**原因**: 导入路径错误。

**解决**: 确保从 `@deepseek-ai/dsh-client-ui-settings/client` 导入，不是 `/server`。
