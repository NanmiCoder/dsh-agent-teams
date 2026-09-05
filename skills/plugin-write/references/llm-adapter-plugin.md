# Large Language Model (LLM) Adapter Plugin Reference

Connect a new model provider by implementing `LlmAdapter` and registering it on `ctx.llm`. If the target version contains `packages/llm/llm-deepseek` and `packages/llm/llm-pi-ai`, use them as reference implementations.

> Target-version guard: this document is a form reference, not version-migration authority. Verify adapter interfaces, streaming vocabulary, request fields, source paths, and provider hooks against the exact target Harness checkout. For an upgrade, build the migration ledger from [`version-adaptation.md`](version-adaptation.md) first, then follow the observed target behavior.

## Shape

```ts ignore-check
class MyAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> { … }
}

export const name = 'llm-myprovider'
export const inject = ['llm']
export const Config: z<Config> = z.object({ apiKey: z.string(), … })

export function apply(ctx: Context, config: Config) {
  ctx.llm.registerAdapter(['my-provider'], new MyAdapter(…))
}
```

Registration is effect-based and HMR-safe. Only one adapter may own a provider route. Duplicate registration throws, and multi-route registration either succeeds for every route or fails for all of them. `options.provider` selects the adapter, while `options.model` is the provider model ID, so a dynamic-catalog adapter can support new models without reconfiguring its lifecycle. `registerAdapter()` returns an operation handle with a disposer and `replace(providers)`, which atomically replaces the route set for the same adapter instance. Replacement allows an empty array; initial registration does not. Calls after handle disposal throw. Handle credentials through native Cordis mechanisms: declare an environment-variable fallback in the Schemastery Config, then pass it through `cordis.yml` with `!!js process.env.MY_KEY`. Never read arbitrary credential files in code.

## Streaming Vocabulary

`stream()` emits a closed chunk union. End every switch on `type` with `assertNever` so a new variant causes a compile failure in every consumer that must handle it:

```ts
type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlockType }   // 'text' | 'reasoning' | 'image' | 'tool-call' | 'tool-result'
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: CallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason; replayState?: unknown }
```

`TokenUsage` counters do not overlap. `inputTokens` contains only uncached input. Cached input is reported separately as `cacheReadTokens` and `cacheWriteTokens`; billable input is the sum of all three. When present, `reasoningTokens` is only an informational subset already included in `outputTokens`; do not add it again when computing totals. When a provider merges cache hits into one prompt total, as DeepSeek does with `prompt_tokens`, subtract the cached portion.

## Accepted Request

`GenerateOptions` contains `provider` for the registered route that selects the adapter; `model` for the provider model ID; optional `reasoningEffort` for an adapter-owned reasoning-effort ID; `messages` in the exact order seen by the provider after the system slot; optional `system` prompt text; optional JSON Schema `tools`; optional `temperature`, `maxTokens`, and stop-sequence `stop`; optional `signal`, which must be honored; optional `sessionId`, marked by the loop for replay routing and ignored by the adapter; and optional `purpose` for auxiliary calls with `'compaction' | 'session-title'`. `BlockAssembler` in `packages/llm/llm/src/assembler.ts` folds the chunk stream back into content blocks, usage, finish reason, and replay state. Consumers should use it instead of reimplementing the fold. The adapter itself does not assemble.

## Protocol Obligations

- Emit `usage` **before** `finish`, and emit nothing after `finish`. Buffer finish and usage until the provider's end-of-stream marker arrives, then flush them together so a trailing usage-only chunk cannot break ordering.
- Keep tool-call `arguments` as the original JSON string end to end, carrying fragments through `argumentsDelta`. If the provider returns a parsed object, serialize it again at `block-end`.
- Assign each content block's `index` by first appearance in the stream and reuse the same index for every delta belonging to that block.
- There are only two allowed error paths. Transport and protocol failures throw from `stream()` as `LlmError` with a stable code. In-band provider failures end the stream with `finish { kind: 'error' | 'aborted', failure }`. Normalize both paths to the same serializable `LlmFailure`: human-readable `message`; stable provider-independent routing `code`; optional HTTP `status`; optional positive validated provider delay requirement `providerRetryAfterMs`, which is not a retry decision; and optional opaque provider-issued diagnostic `requestId`. Consumers must handle both paths. Choose and document the path by failure type. An empty completion is a retryable error, not silent success: map a terminal `stop` finish with no content blocks to `finish { kind: 'error' }` with canonical code `EMPTY_RESPONSE`.
- Honor `options.signal` and pass it to fetch or the provider SDK.
- If the provider cannot honor a `GenerateOptions` field, such as receiving a `stop` list when stop sequences are unsupported, throw `LlmError(..., 'UNSUPPORTED')` instead of silently dropping it.
- If later calls require a response ID, signature, or other native provider metadata, emit the smallest lossless JSON projection as `finish.replayState` and validate it while rebuilding history. `LlmService` passes that state only when the historical provider route and current target route belong to the same adapter instance. The adapter decides whether replay is valid across the same model, different models, or different providers. When state is absent, never infer native replay from provider or model names.
- Context overflow has one canonical error code. Classify explicit provider details with `isContextWindowExceededError()` and expose `CONTEXT_WINDOW_EXCEEDED` upstream, whether the failure is a thrown `LlmError` or an in-stream finish error.
- Keep provider-specific reasoning-mode switches in adapter Config. Expose exact model metadata through the provider-independent capability seam: implement `resolveModel()` to return the provider or model identity and optional `context` with provider-owned `contextWindow`, plus optional `reasoning` with ordered `efforts` and optional `defaultEffort`. Declare the configured `defaultEffort` only when a real default exists. Honor the resolver's optional `AbortSignal`; implementations must settle promptly after abort. Reasoning efforts are ordered opaque IDs that the adapter maps to provider requests. Preserve the adapter-authoritative optional list, including adapter-defined `off` when supported. Do not expose final wire spelling or clamp unsupported values into range.
- Send application-attribution headers on every provider HTTP request. `attributionHeaders()` must include the `User-Agent` baseline and `{ product, version, url }` read from the package manifest. Prove transmission with a wire-level test.
- One adapter call equals one provider attempt. Disable retries built into client libraries. Agent-level recovery opens another persisted numbered turn; direct `ctx.llm.stream()` callers still receive one attempt.
- Bound provider stalls in the transport layer. Expose a finite positive `streamIdleTimeoutMs`, with five minutes as the default for published adapters. Run the timer only while iterator `next()` is unresolved, use one stable signal for the whole request, map adapter-owned expiry to `TIMEOUT`, and preserve an earlier caller abort as `ABORTED`.

## Implementation Structure

Separate wire types, request serialization, transport parsing, chunk conversion, and the adapter class into distinct responsibilities. `llm-deepseek` is the reference layout. Optional surfaces include `providerRetryPolicy()` for immutable per-route policy with ordinary defaults when omitted; `providerInfo()` and asynchronous `listModels()` for advisory selector metadata, never a request allowlist; and `registerConfigurableProviders()` for dormant routes that settings pages may activate.

## Validation

Unit-test chunk conversion and error classification. Prove `attributionHeaders()` with a wire-level test. When provider credentials are available and execution is authorized, run real-API end-to-end tests; otherwise let the suite skip itself. If the package publishes a runtime entry, run a built-entry smoke test. In the Harness monorepo, satisfy its per-file coverage gate. In an external repository, satisfy its declared coverage gate and report the real-provider boundary that remains untested.
