# references/ · reference material loaded on demand

> `SKILL.md` keeps only the decision flow; version facts and scan patterns live here and load on demand.

## Version corridor index

Build corridors along the `from → to` directed edges in the table, never by filename
order — lexicographically, `alpha.10` sorts before `alpha.2`. When the target spans
multiple versions, read the full corridor and compute the final net state before touching
source: if a field is removed in alpha.1 and restored in alpha.2, do not delete and re-add it.

| Order | Card file | from | to | Cards | Status / coverage |
|---|---|---|---|---:|---|
| 0 | [v0.1.1-rc.1.md](v0.1.1-rc.1.md) | `dsh-v0.1.0-rc.8` | `dsh-v0.1.1-rc.1` | 9 | draft / curated (vlln plugin migrations: repository-plugins mechanism removal, `dshClient`→`dsh.client` manifest merge, client-modules scan → bundle `dsh.client`, strict inject + weak `ctx.get`, session event contract (`type` not `kind`), self-rendering client session aggregation, `tasks.peek` removal, 0812 service renames — `httpServer`→`webServer`, `tasks`→`jobs`; corridor is the closest published-tag alignment for the internal 0810–0812 snapshot window, upstream review may reassign) |
| 1 | [v0.1.1-rc.2.md](v0.1.1-rc.2.md) | `dsh-v0.1.1-rc.1` | `dsh-v0.1.1-rc.2` | 3 | reviewed / curated |
| 2 | [v0.1.2-alpha.1.md](v0.1.2-alpha.1.md) | `dsh-v0.1.1-rc.2` | `dsh-v0.1.2-alpha.1` | 28 | reviewed / curated |
| 3 | [v0.1.2-alpha.2.md](v0.1.2-alpha.2.md) | `dsh-v0.1.2-alpha.1` | `dsh-v0.1.2-alpha.2` | 8 | reviewed / curated |
| 4 | [v0.1.2-alpha.3.md](v0.1.2-alpha.3.md) | `dsh-v0.1.2-alpha.2` | `dsh-v0.1.2-alpha.3` | 1 | reviewed / curated (no breaking plugin changes; one additive capability: `settings.plugin.item` keyed-slot settings card, first real-world integrations) |
| 5 | [v0.1.2-alpha.4.md](v0.1.2-alpha.4.md) | `dsh-v0.1.2-alpha.3` | `dsh-v0.1.2-alpha.4` | 6 | reviewed / curated |
| 6 | [v0.1.2-alpha.5.md](v0.1.2-alpha.5.md) | `dsh-v0.1.2-alpha.4` | `dsh-v0.1.2-alpha.5` | 3 | reviewed / curated |
| 7 | [v0.1.2-rc.1.md](v0.1.2-rc.1.md) | `dsh-v0.1.2-alpha.5` | `dsh-v0.1.2-rc.1` | 0 | reviewed / curated |
| — | [rollup-0.1.2.md](rollup-0.1.2.md) | `dsh-v0.1.1-rc.2` → `dsh-v0.1.2-rc.1` full corridor | rollup | non-card file: corridor-level increment (cross-cohort coexistence, unpublished-cohort installation, `RemoteResult` error flow, pre-migration baseline attribution, bounded retry for boot race, base-only preset precondition, type-surface export drift, host-self safety boundary, three install-channel pitfalls, layered validation checklist); based on rc.1, subject to final-release review |

`curated` means only the identified plugin-relevant changes are included, not a complete
API diff. When a corridor edge is missing, stop the automatic migration and report the gap
to the user; one-off upstream research for the current task and adding cards to this
repository are two different activities — the latter must not become an implicit side
effect of modifying the user's plugin.

Companion material:

- [pre-flight.md](pre-flight.md): the seven-class touchpoint self-check and the migration-task summary template;
- [pre-flight-patterns.json](pre-flight-patterns.json): source of truth for the regexes used by executable checks;
- [api-migration-0.1.2-alpha.2.md](api-migration-0.1.2-alpha.2.md): the precise migration ledger for rc.2→alpha.2 when API, Remote, Settings, events, Headless, packaging, or composition interfaces are hit;
- [host-plane-probes.md](host-plane-probes.md): three ways for the host plane to run dual-cohort probes in `cordis.patch.yml`;
- [migration-hygiene.md](migration-hygiene.md): version-independent toolchain pitfalls (tsbuildinfo false positives, oxc parsing strictness, the plane a change takes effect in, pnpm interception, test syntax);
- [troubleshooting.md](troubleshooting.md): post-migration symptom → root cause → card lookup;
- [examples/legacy-plugin/](../examples/legacy-plugin/): static fixture for the seven touchpoint classes.

## Card file metadata

Each `vX.Y.Z-<suffix>.md` declares, in its frontmatter:

```yaml
---
kind: dsh-version-card-set
schema: 1
from: dsh-v0.1.2-alpha.1
to: dsh-v0.1.2-alpha.2
status: reviewed
coverage: curated
cardCount: 4
idPrefix: DSH-0.1.2-A2
verifiedAt: 2026-08-30
---
```

Version order is determined by `from`/`to`; `cardCount`, the ID prefix, and the required
fields are checked by the repository's validation scripts.

## Single-card format

```markdown
### DSH-0.1.2-A2-01 · Title

- **Type**: breaking | behavior | capability | fix | security | privacy
- **Applies to**: client / server plugin / profile wrapper / packaging, etc.
- **Touchpoints**: #1…#7, or "none (packaging/privacy surface)"
- **Action level**: required | required-if-hit | required-if-target-is-… | conditional | optional | informational
- **Symptoms**: what breaks or changes after the upgrade
- **Migration recipe**: checkable steps; old→new ledger (where applicable)
- **Verification**: how to prove the final behavior, not just that installation succeeded
- **Source**: primary source pinned to a fixed release tag / commit
- **Field note** (optional): reproducible real-world migration differences, noting date, plugin, platform, and version
```

Rules:

1. The ID must include the full host version and be unique within the repository;
2. every card cites at least one primary source; when same-version material exists, prefer pinning to the same tag;
3. when release notes give direction only, without API coordinates, the recipe must require re-checking the target tag's types — do not invent interfaces;
4. cross-version rollbacks/restores are cross-referenced by full ID;
5. when local observation conflicts with a primary source, reproduce first and record the difference side by side; never silently overwrite either side.
