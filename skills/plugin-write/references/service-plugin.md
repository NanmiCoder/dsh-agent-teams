# Service Plugin Reference

A service is a capability one plugin exposes to other plugins through `ctx`. `tools`, `llm`, and `agents` are common examples.

> Target-version guard: this document is a form reference, not version-migration authority. Verify service names, lifecycle behavior, events, and Agent scope against the exact target Harness checkout. For an upgrade, build the migration ledger from [`version-adaptation.md`](version-adaptation.md) first, then follow the observed target behavior.

## Shape

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService
  }
}

export default class MetricsService extends Service {
  static inject = ['llm']  // A service may depend on other services.

  constructor(ctx: Context) {
    super(ctx, 'metrics')  // 'metrics' is the service name.
  }

  record(event: string, value: number) { /* … */ }
}
```

After loading, consumers access the service through `ctx.metrics`. They declare `inject: ['metrics']` and use it in `apply`. Use the class form when a plugin provides a service to other plugins. A plugin that only consumes services may use the function form. Document public service methods with JSDoc `@param` and `@returns` for parameters and non-void return values. The service name is the string passed to `super(ctx, ...)`. Generated subsystem pages record the service name, public methods, and source locations; do not maintain a second static list.

## Dependencies

`inject` lists required services. When a service is missing, the plugin waits for every declared service instead of loading, so `ctx.tools` already exists and is ready inside `apply`. Do not declare optional dependencies in `inject`; query them at the use site with `ctx.get('name')` and guard a missing result. If a required service disappears at runtime because its provider unloads, the dependent plugin is disposed automatically and reloads when the service returns, avoiding calls into a vanished service. `cordis.yml` may isolate services by plugin group, for example `isolate: { bash: true }` on a group row, so separate groups see different instances of the same service and effects do not cross groups.

## Typed Events

Events are loosely coupled extension APIs between plugins. Define them through TypeScript declaration merging on the exact target Cordis `Events` interface, use `namespace/action` event names, and document dispatch mode with `@mode`:

```ts
import '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'my-plugin/ready': (payload: { id: string }) => void
    'my-plugin/check': (input: string) => boolean | undefined
    'my-plugin/transform': (input: string, next: () => Promise<string>) => Promise<string>
  }
}
```

Dispatch modes are `emit`, which broadcasts synchronously to every listener and ignores return values; `bail`, which runs listeners in order and uses the first non-`undefined` result; `serial`, which runs in order and stops after the first nonempty value; and `waterfall`, a pipeline in which each listener may wrap the downstream result but must call `next()` to delegate, with omission intentionally short-circuiting the chain. A listener registered through `ctx.on()` is an effect and is removed automatically when the plugin unloads. Harness event names use `namespace/action`, such as `agent/step`, `agent/request`, `agent/request-error`, `tools/result`, and `session/event`. `turn/*`, `step/*`, `tool/call`, `tool/result`, and `compact/*` are persisted session-event types, not same-named Cordis events. To observe them, listen to `session/event` and inspect `event.type`.

## Lifecycle

Loading is dependency-driven. Everything registered through `ctx`, including event listeners, tools, and timers, is cleaned up on plugin unload without manual `removeListener` or `clearInterval` calls. For resources that require explicit teardown, such as network connections, provide a disposer through `ctx.effect()`. When teardown order matters, keep the related work in one effect so disposal unwinds in the intended order. A configuration change hot-replaces the plugin: the framework unloads the old instance and revokes its registrations, then loads the new instance.

## Agent Scope

Every Agent has a scoped `agent.ctx`. Registrations made there enter that Agent's layer and are revoked in awaitable cleanup order when the Agent is disposed. Scoped listeners filter dispatch. Shared stores overlay their entries on the global registry while retaining domain views. `CreateAgentOptions.setup(agentCtx)` completes assembly before publication. To scope a registration to one Agent, use its `agent.ctx` instead of the root Context. Service rows that must survive inside an Agent preset require an `isolate` realm.

## Capability Seams

A replaceable capability has three roles: service definition or interface, service provider or implementation, and consumer code that exposes the service to the model or integrates it elsewhere. Split them into separate packages only when those roles evolve independently. The three-package bash group of definition, provider, and consumer is the template. Keep a single-purpose service in one package. A capability seam is complete only when all three roles exist; split packages only when the roles truly evolve independently.

## Validation

Run unit tests, including an HMR-safety test that disposes the fiber contributing a registration and asserts that the resource is removed. For a user-visible plugin, also run a non-unit real-composition test: start `cordis.yml` through the Loader and assert the model-visible request or log, persisted state, or user-visible output. In the Harness monorepo, satisfy its per-file coverage gate. In an external repository, satisfy its declared coverage gate. Add a credential-free snapshot in the same change for any model-, protocol-, or user-visible behavior change.
