# Typical Migration Examples

English | [简体中文](README.md)

Every example must state its plane, verification scope, and whether it is executable. Markdown snippets cannot stand in for real product verification.

| Example | Scenario | Verification status |
|---|---|---|
| [01-simple-client-plugin.md](01-simple-client-plugin.md) ([EN](01-simple-client-plugin.en.md)) | Historical client SDK package migration | Documentation example; no fixed-tag build yet |
| [02-host-side-plugin.md](02-host-side-plugin.md) ([EN](02-host-side-plugin.en.md)) | Host APIProxy → owning domain service | Executable control flow; verified in an alpha.2 container |
| [03-client-remote-plugin.md](03-client-remote-plugin.md) ([EN](03-client-remote-plugin.en.md)) | Web Client `ctx.remote` / `RemoteResult` | Executable control flow; product Web smoke pending |
| [face-contracts/](face-contracts/) | Per-plane Host/Client regression guard | `node .../check.mjs` |
| [04-dual-cohort-plugin.md](04-dual-cohort-plugin.md) ([EN](04-dual-cohort-plugin.en.md)) | Real sample: dsh-mnemon supporting the rc.2 registry and alpha.1 source cohorts together | Field record: full verification in both lanes plus a real Connection registration regression; no dual-cohort product-browser mount |
| `05-third-party-plugin-patch.md` (TBD) | Third-party prebuilt plugin patch | Not implemented |
| [06-real-world-batch-migration.md](06-real-world-batch-migration.md) ([EN](06-real-world-batch-migration.en.md)) | Real batch-migration record (six plugins, three shapes, with a pitfall list), plus the follow-up zero-code ride of the 0.1.2 train to rc.1 (per-edge routine and new pitfalls) | Field record: real boot verification + unit-test regression from six real plugins (not an executable fixture in this repo); the follow-up verified on dsh-v0.1.2-rc.1 (Windows) as of 2026-09-04 |
| [07-multi-repo-batch-migration.md](07-multi-repo-batch-migration.md) ([EN](07-multi-repo-batch-migration.en.md)) | Batch migration runbook for 17 tool plugins across three version steps (sync audit, batch gates, push, and profile wrap-up) | Field record: the consecutive migration process across three version steps (technical touchpoints reference the cards) |
| [08-real-web-client-alpha2-migration.md](08-real-web-client-alpha2-migration.md) ([EN](08-real-web-client-alpha2-migration.en.md)) | Real sample: Host + Web Client plugin sources migrated to 0.1.2-alpha.2 from an earlier unsupported corridor segment | Field record: reproducible migration evidence completed on 2026-08-31 in an isolated worktree |

## Contribution Requirements

1. Host, Web Client, and ordinary Cordis plugins must be kept separate;
2. Keep executable code in a single source file and link to it from documents — don't copy a second implementation that will drift;
3. Clearly distinguish control-flow tests, fixed-tag builds, Loader/profile smokes, and full product verification;
4. Cite full card IDs and fixed primary sources;
5. Scan fixtures that cannot be executed must be clearly marked "do not execute".
