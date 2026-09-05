# Example 01: Simple Client Plugin

English | [简体中文](01-simple-client-plugin.md)

**Scenario**: A pure client-side UI plugin that only uses `dsh-client-runtime` to read settings.

**Touchpoints**: #3 internal service probing (client imports)

**Complexity**: ⭐

---

## Before

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

## After

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

## Migration Steps

1. **Update imports**:
   ```sh
   # replace globally
   sed -i "s/@deepseek-ai\/dsh-client-runtime\/client/@deepseek-ai\/dsh-client-ui-settings\/client/g" src/**/*.ts
   ```

2. **Add a type alias**:
   ```typescript
   import type { Context } from '@deepseek-ai/cordis'
   type ClientContext = Context
   ```

3. **Update package.json**:
   ```sh
   pnpm remove @deepseek-ai/dsh-client-runtime
   pnpm add @deepseek-ai/dsh-client-ui-settings@^0.1.2
   ```

---

## Verification

```sh
# 1. check for leftover references
grep -r "dsh-client-runtime" src/
# expected: no output

# 2. typecheck
pnpm run typecheck
# expected: no type errors

# 3. build
pnpm run build
# expected: build succeeds

# 4. start the test
pnpm dsh --profile test
# expected: plugin loads normally and settings are accessible
```

---

## Common Errors

### Error 1: `Module not found: @deepseek-ai/dsh-client-runtime/client`

**Cause**: Not all import paths were updated.

**Fix**:
```sh
# find all references
grep -r "dsh-client-runtime" .
# replace one by one
```

### Error 2: `Type 'Context' is not assignable to type 'ClientContext'`

**Cause**: The type alias was forgotten.

**Fix**:
```typescript
import type { Context } from '@deepseek-ai/cordis'
type ClientContext = Context
```

### Error 3: `useSettings is not a function`

**Cause**: Wrong import path.

**Fix**: Make sure to import from `@deepseek-ai/dsh-client-ui-settings/client`, not `/server`.
