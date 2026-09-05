# External Plugin Naming Compatibility

This is a community compatibility profile, not an official DeepSeek Harness naming standard. It was verified on 2026-08-31 against [`dsh-v0.1.2-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/tree/0a53fb55bea101816fa226bb964ae2bed71c343b). Recheck the exact target Harness version before treating an upstream grammar or collision rule as current.

The profile has two layers:

- **Compatibility errors** identify malformed declarations or names rejected by the verified Harness or npm grammar.
- **Collision recommendations** add publisher-aware prefixes for a new community plugin. They are warnings because official short names such as `greet`, `metrics`, `hello`, and `my-plugin` remain valid.

Do not rename an existing public name merely to clear a recommendation. A tool, command, service, Skill, settings namespace, event, or route rename is a compatibility change.

## Official baseline and community additions

Official Harness uses several independent identities rather than one universal plugin ID:

| Surface | Verified Harness behavior | This profile adds |
|---|---|---|
| Package | A bundle is declared by `package.json#dsh.bundle`; the official tutorial uses `dsh-hello-plugin` | Accept unscoped `dsh-*` and scoped `@scope/dsh-*` packages |
| Plugin module name | A plugin exports `name`, for example `hello-plugin` | Declare every exported plugin name in `pluginNames` |
| Loader row ID | The row `id` is a stable composition key; later patch layers may intentionally override it | Declare IDs, but never treat every duplicate as a global conflict |
| Service key | A service is a `ctx` key; Cordis isolation can host multiple instances in separate realms | Recommend a publisher-aware lower-camel prefix |
| Tool name | Same-scope duplicates fail; an Agent scope can provide a nearer definition | Recommend a publisher-aware snake-case prefix |
| Command name | Official grammar is `^[a-z][a-z0-9_-]*$`; same-scope duplicates fail and an Agent scope can shadow a global | Recommend a publisher-aware lowercase prefix |
| Skill name | Official grammar is kebab-case; scopes, rank, provider order, and local order select a winner | Recommend a publisher-aware kebab prefix |
| Skill provider | Same-scope provider names must be unique; `runtime` is officially reserved | Declare providers separately from Skill names |
| Event | Official custom events follow `namespace/action`; events are shared channels, not exclusive registrations | Recommend a publisher-aware namespace without claiming ownership of the channel |
| Settings namespace | Official grammar is `^[a-z][a-z0-9-]*$`; duplicate registration fails | Recommend a publisher-aware kebab prefix |
| Web route | HTTP routes collide only for the same `kind` and `path`; exact, prefix, and upgrade registrations are distinct | Record `{ kind, path }` instead of losing the route kind |

Primary sources: [first plugin](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/docs/user/develop/basic/index.zh.md), [bundle publishing and Loader layers](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/docs/user/develop/basic/publish.zh.md), [services and isolation](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/docs/user/develop/framework/service.zh.md), [commands](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/interaction/commands/README.zh.md), [Skills](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/skill/skill/README.zh.md), [settings](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/settings/settings/src/index.ts), and [Web routes](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/host/webserver/src/index.ts).

## Community coordinate and recommendations

Choose a publisher namespace and plugin name in kebab-case. The community coordinate is `<namespace>/<plugin>`. It is the lookup key used by the optional community registry and does not replace any official Harness field.

For namespace `alice` and plugin `web-search`, the collision-resistant projections are:

| Surface | Recommendation | Example |
|---|---|---|
| Coordinate | `<namespace>/<plugin>` | `alice/web-search` |
| npm package | Official unscoped or npm-scoped DSH package | `@alice/dsh-web-search` |
| Plugin module name | Stable kebab name | `web-search` |
| Loader row | Coordinate base, optional suffix | `alice-web-search` |
| Cordis service | Lower-camel coordinate base, optional suffix | `aliceWebSearchIndex` |
| Tool | Snake coordinate base, optional suffix | `alice_web_search_query` |
| Command | Kebab coordinate base, optional suffix | `alice-web-search-refresh` |
| Skill | Kebab coordinate base, optional suffix | `alice-web-search` |
| Skill provider | Kebab coordinate base, provider suffix | `alice-web-search-filesystem` |
| Event | Coordinate base plus action | `alice-web-search/ready` |
| Settings namespace | Coordinate base, optional suffix | `alice-web-search` |
| HTTP route | Coordinate-owned subtree | `/api/plugins/alice-web-search/query` |

The prefix rules are recommendations because long model-visible tool names and user-facing commands have a usability and token cost. The local validator reports them as warnings; `--strict` turns those warnings into a nonzero result for teams that choose the collision-resistant profile.

## Local declaration

Create `dsh-plugin.naming.json` at the external plugin repository root:

```json
{
  "schemaVersion": 1,
  "policy": "dsh-plugin-naming/v1",
  "plugin": {
    "namespace": "alice",
    "name": "web-search",
    "coordinate": "alice/web-search",
    "packageName": "@alice/dsh-web-search"
  },
  "names": {
    "pluginNames": ["web-search"],
    "loaderIds": ["alice-web-search"],
    "services": ["aliceWebSearchIndex"],
    "tools": ["alice_web_search_query"],
    "commands": ["alice-web-search-refresh"],
    "skills": ["alice-web-search"],
    "skillProviders": ["alice-web-search-filesystem"],
    "events": ["alice-web-search/ready"],
    "settingsNamespaces": ["alice-web-search"],
    "routes": [
      { "kind": "exact", "path": "/api/plugins/alice-web-search/query" }
    ]
  }
}
```

Keep every array, including empty arrays, and declare at least one plugin module name and Loader row ID. The optional `$schema` field may point to a resolvable local copy of `plugin-naming.schema.json`. This declaration supplements `package.json`, bundle patches, and Profile composition; it neither proves source usage nor reserves a name.

## Validate

Run the bundled read-only validator with Node 20 or newer:

```sh
node <plugin-write-skill>/scripts/validate-names.mjs \
  --manifest ./dsh-plugin.naming.json
```

For a new plugin that adopts every community recommendation, add `--strict`. Use `--format json` for CI. Exit status `0` means compatible, `1` means errors or strict-mode warnings, and `2` means invalid arguments, unreadable input, or malformed JSON. The validator performs no network requests and writes no files.

## Registry boundary

The optional central registry uses the local declaration only as phase-one source evidence. Its v2 entry separately records the target Harness range, registration scope, Loader patch layer and override intent, Skill provider/rank, event publisher/schema, and Web route kind. Events remain shared channels and are checked for incompatible publisher schemas instead of being rejected merely for the same name. Ports remain deployment configuration and require a composition-time check rather than a naming reservation.

Read [`registry-check.md`](registry-check.md) after this offline validator passes. Keep a missing central match, an unavailable query, an automated discovery candidate, and a reviewed formal registration as four distinct states.
