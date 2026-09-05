# Real Sample: Host + Web Client Plugins Migrated to DSH 0.1.2-alpha.2

English | [简体中文](08-real-web-client-alpha2-migration.md)

> Completed on 2026-08-31 in an isolated worktree of `omdsh-dev/omdsh-plugin-lab`. This document records reproducible migration evidence,
> and does not misrepresent the sample's starting point as a corridor already covered by existing cards.

## Identity and Baseline

- Plugin package: `@oh-my-dsh/plugin-lab`; plugin version `0.6.4 → 0.7.0-alpha.0`.
- DSH dependency: exact `0.1.0-rc.6 → 0.1.2-alpha.2`.
- Corridor note: the skill cards start at `dsh-v0.1.1-rc.2`; from the old starting point to rc.2 is an unsupported gap. That segment is corroborated with exact-tag source code, target package declarations, compile errors, and hands-on testing — not presented as card conclusions.
- Baseline before changing dependencies: 38 client + 11 server tests pass, along with the existing plugin e2e.

## Hits and Modifications

| Surface | Old state | alpha.2 state |
|---|---|---|
| Aggregate runtime | `dsh-client-runtime/client` | Removed; types are imported from the owning packages: Cordis, session, conversation, ui-chat |
| Context facets | Incidentally provided by the aggregate package / hoisting | Type-only augmentation for the facets actually used (API/session/workspace/chat/renderer/commands, etc.), with direct type dependencies declared |
| transcript | `useSession` + flat `snapshot.nodes[]` | `useChat` + `snapshot.order` / `snapshot.nodes.get(id)` |
| Assistant final node | Old ConversationNode array | Read `data.finalNode` once the discriminant is `assistant-step` |
| Host command | `execute(agent, line, signal)` | `execute(agent, line, [], signal)` |
| client inject | Includes the deleted runtime | Remove the old service; keep only the runtime services the target host actually provides |
| Release identity | Plugin 0.6.4 | Bumped separately to 0.7.0-alpha.0 after the compatibility changes passed |

## Reproducible Failures

1. Changing only the top-level dependencies leaves the lockfile holding the rc.6 peer provider; a successful install does not mean the cohort is consistent. After the fix, a full lockfile scan shows neither rc.6 nor `dsh-client-runtime`.
2. ui-chat's declarations reference several dev-only type packages. With `skipLibCheck: true`, the missing declarations surface as implicit `any` on selectors/callbacks; run one pass with `skipLibCheck: false` to find the owning packages, then add the direct dev/peer dependencies.
3. Tests that keep constructing `nodes: []` no longer match `ChatNodeStore`; fixtures must provide `get/values` and define the ordering via `order`.
4. Host `commands.execute` fails typecheck outright when the images parameter is missing; no images means `[]`, not omission.
5. The Web e2e follows the token URL directly and then requests the manifest, getting 401: Node's `fetch` does not persist cookies. Switch to manual 303 → read `Set-Cookie` → request the clean root URL, boot manifest, and client artifact with the cookie.
6. An ENOSPC on first install is an environment failure; clean the package manager's unreferenced store and rerun — don't attribute it to the API.

## Verification Results

- `typecheck` and Host/Client builds pass; client 38/38, server 11/11.
- `pack` produces `oh-my-dsh-plugin-lab-0.7.0-alpha.0.tgz`; the packed manifest version matches.
- In the isolated profile: add/install, Web `--no-open` cold boot, token→Cookie, boot entry, host serving the client artifact with 200, and client module load and remove all completed.
- This result proves the sample runs on the target alpha.2; it does not prove that every intermediate version edge in the unsupported gap has been covered by a card.

Interface details: see [API-10](../references/api-migration-0.1.2-alpha.2.md#api-10--web-client-runtime-unbundling-keyed-chat-snapshots-and-command-attachment-parameters); Web acceptance: see [DSH-0.1.2-A1-19](../references/v0.1.2-alpha.1.md#dsh-012-a1-19--web-plugin-acceptance-now-reads-the-host-boot-manifest-and-the-auth-url).
