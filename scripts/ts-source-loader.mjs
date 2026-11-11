import { registerHooks } from 'node:module'
import ts from 'typescript'

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.ts')) return nextLoad(url, context)
    const result = nextLoad(url, { ...context, format: 'module' })
    if (result.source === undefined) return result
    return {
      ...result,
      format: 'module',
      source: ts.transpileModule(String(result.source), {
        fileName: new URL(url).pathname,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          verbatimModuleSyntax: true,
        },
      }).outputText,
    }
  },
})
