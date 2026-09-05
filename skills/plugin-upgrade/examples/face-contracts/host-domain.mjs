// Source-backed control-flow fixture for the alpha.2 Host plane.
// Full product validation is recorded separately in benchmark/validation-report-2026-08-30.md.
export const inject = ['llm']

export function listHostProviders(ctx) {
  if (!ctx?.llm || typeof ctx.llm.listProviders !== 'function') {
    throw new TypeError('Host fixture requires the llm domain service')
  }
  return ctx.llm.listProviders()
}
