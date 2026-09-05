# plugin-heavy-dep

Integrating heavyweight browser dependencies (mermaid and friends) into
lightweight DSH Web plugins: lazy single-file chunks served through a
host-scoped route, verdict caching with graceful fallback, SVG whitelist
sanitization, and interaction ownership under a fullscreen modal. Born from
the real 2026-09-01 dsh-file-trace mermaid integration (v0.2.3/v0.2.4),
including its live pitfalls: split-chunk relative imports, a Windows
drive-letter-case containment guard answering 403, and a Ctrl+wheel modal
conflict. The companion benchmark task
`benchmark/tasks/S11-mermaid-lazyload-trap/` grades the concrete diagnosis.

- `SKILL.md` — the seven-point integration checklist (decide lazy, one file,
  host route + containment, lazy import + fallback, sanitization, modal
  ownership, shipping).
