---
name: generic-migration
description: Framework-agnostic methodology for migrating a plugin, extension, or integration across a breaking upstream release — inventory coupling points, classify changes, stage the migration, and verify in layers. Use when upgrading any plugin from one host-framework version to another without access to framework-specific migration notes. Not a substitute for vendor release notes; contains no framework-specific facts.
license: MIT
---

# Generic Plugin Migration Methodology

A disciplined procedure for moving a plugin across an upstream release that may
contain breaking changes. Everything here is framework-agnostic: no product
names, no version numbers, no API identifiers. Pair it with the upstream
project's own changelog and release notes whenever those exist.

## 0. Ground rules

- **Never migrate blind.** If you have not read the upstream changelog for every
  version in the corridor (start → target, inclusive), you are guessing.
- **Inventory before edits.** A written list of what the plugin touches beats
  discovering breakage one crash at a time.
- **Change one layer at a time**, and keep the old install runnable until the
  new one is proven (side-by-side installs, separate data directories).

## 1. Inventory the coupling surface

Before touching code, scan the plugin read-only and record every place it
couples to the host. A generic coupling checklist:

1. **Manifest / metadata** — declared compatibility ranges, entry points,
   permissions, capabilities the plugin requests.
2. **Host API imports** — every module, symbol, or type imported from the host
   or its SDK; note which are used at load time vs call time.
3. **Lifecycle & events** — activation hooks, event subscriptions, disposal.
4. **Services & RPC** — services the plugin consumes or exposes; inter-process
   or request/response channels and their payload shapes.
5. **UI contributions** — commands, views, panels, menus, themes, keybindings.
6. **Persistence** — files, databases, or key-value stores the plugin reads or
   writes, including schema versions and migration code.
7. **Process & I/O seams** — spawned subprocesses, sockets, pipes, parsers of
   host-generated output (logs, CLI text, serialized state).
8. **Configuration** — settings keys read/written, defaults the plugin relies
   on, user-facing documentation of those keys.
9. **Dependencies** — packages shared with the host (risk of duplicate
   instances), peer ranges, runtime version floors.

For each item record: file/line, what exactly is coupled, and how confident you
are. "No hit" is only meaningful after you state what you scanned and what you
could not rule out.

## 2. Read the corridor, not just the endpoints

Changes across a release corridor interact. Read every intermediate release's
notes and diff, and build a **net-state table**:

- A field removed in an intermediate version but restored later has zero net
  change — do not "migrate" it away.
- A rename that happened in two steps (A → B → C) is migrated straight A → C.
- Behavior changes (defaults, ordering, timing) are as breaking as API
  removals; list them explicitly.

Classify each upstream change as: **breaking** (must edit), **behavioral**
(must re-verify), **additive** (optional), or **informational**.

## 3. Map, then edit

Map every inventory hit (§1) to a corridor change (§2). Only then edit, in
dependency order:

1. Manifest and compatibility ranges first — the host may refuse to load
  anything else you fix.
2. Host API surface: renames, removals, signature changes.
3. Lifecycle/events/services.
4. Persistence migrations (never mutate the user's only copy; write-migrate on
  first run with a backup, or fail closed).
5. UI and configuration.
6. Dependency alignment: shared packages must resolve to the host's instance;
   check for duplicate copies in the installed tree.

## 4. Verify in layers

Cheap layers first; each layer must pass before the next means anything:

1. **Static**: typecheck, lint, the plugin's own unit tests.
2. **Install-time**: the host accepts the manifest and loads the plugin without
   warnings.
3. **Cold start**: a real host process boots with the plugin enabled; check
   logs for deprecation and fallback warnings, not just crashes.
4. **Functional probe**: one real end-to-end path per major feature, including
   the features you did *not* migrate (silent behavior drift hides there).
5. **Data**: migrate a copy of real persisted data; verify round-trip and
   downgrade behavior.
6. **Rollback rehearsal**: prove you can go back — reinstall the old version
   against the migrated data and confirm it still works or that you have a
   restore path.

## 5. Discipline and pitfalls

- Prefer the host's documented replacement over re-implementing removed
  behavior yourself.
- Treat "it typechecks" as the beginning of verification, not the end.
- Deprecated-but-working is a scheduled failure: record it even if out of
  scope.
- If a change's semantics are unclear, read the upstream source at the target
  tag; do not guess shapes from a one-line changelog entry.
- Keep a written migration log: what you changed, why, and what you verified.
  It is the artifact that lets someone else trust the migration.
