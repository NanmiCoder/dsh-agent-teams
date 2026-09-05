// Source-backed control-flow fixture for the alpha.2 Web Client plane.
export async function listClientProviders(ctx) {
  const result = await ctx.remote.llm.listProviders()
  if (result.ok) return { status: 'ok', value: result.value }

  if (result.error.code === 'gateway/cancelled') {
    return { status: 'cancelled' }
  }

  // Preserve the typed Remote failure. Do not infer retryability.
  throw result.error
}
