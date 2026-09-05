# Pre-flight · touchpoint self-check before a host upgrade

> This is a heuristic scan, not proof of compatibility. Zero hits across the seven classes
> only means "not detected by the current patterns"; you must still check
> dependencies/configuration and run a build, a real mount, and functional smoke tests.

The first six classes follow the classification of the [dsh-community-standard migration guide](https://github.com/oh-my-dsh/dsh-community-standard/blob/main/guides/migration.md);
this skill adds #7, subprocess/output parsing. Executable checks read
[pre-flight-patterns.json](pre-flight-patterns.json). The `rg` commands below are examples
only; an Agent should prefer the content-search tools provided by the current environment.

## Table of contents

- 0. Configuration and dependency inventory first
- 1. Build the version corridor
- 1.5 Ghost host: pin `from` to the running process
- #1 source patch / monkey patch
- #2 internal event names and persistent events
- #3 internal service probes / Remote
- #4 direct host directory reads/writes
- #5 internal UI / commands / tool registration
- #6 custom HTTP / WS / RPC / DOM / CSS channels
- #7 subprocess / stdout / stderr parsing
- Special surfaces
- Summary template
- Touchpoint checkup (<plugin>, <from> → <to>)

## 0. Configuration and dependency inventory first

Scan all tracked source, tests, scripts, CI, and root configuration, excluding generated
artifacts, vendor, and `node_modules`. Record at least:

- the plugin version, `peerDependencies`, `engines`, and `@deepseek-ai/*` imports in `package.json`;
- the resolved version and lockfile (trust only the package manager the repository actually uses);
- the standard manifest `dsh-plugin.json` (if present);
- profile composition: `cordis.patch.yml`, `agent.cordis.yml`, legacy `cordis.yml`;
- the actual install track: registry package, Git checkout, workspace/junction, or copied install.

These files have different ownership, so they cannot all be called manifests, and unknown
fields must not be rewritten whole-object.

## 1. Build the version corridor

1. Confirm from/to with exact tags;
2. connect edges by the `from → to` entries in the [version corridor index](README.md#version-corridor-index) — never by filename lexicographic order;
3. read the full corridor first and fold net changes such as "removed then restored" before producing the change plan;
4. when cards are missing, report an unsupported gap and research primary sources first; do not change the plugin from memory.

## 1.5 Ghost host: pin `from` to the running process

After an **in-place** upgrade of a source checkout (`git pull` / tag switch), an
already-running host keeps executing the old code from memory, while `git describe`,
`package.json`, and the directory name on disk all report the new version. Deriving
`from` from the disk then mis-pins the corridor by a whole generation: the static
checkup reads the new code while its conclusions get applied to an old process (or the
reverse) — auth and compatibility findings come out inverted.

Measured (2026-08-31, macOS, same machine, same checkout): a host started before the
upgrade answered unauthenticated `POST /api/agentPreset.list` with `ok:true` (old-wire
generation); a host started after it answered 401 to the identical request (new-wire
generation, `DSH-0.1.2-A1-08`). Both processes sat on an identical `git describe` —
the disk cannot tell them apart; only their replies can.

Two checks, before any touchpoint scan:

1. **Ask the process, not the disk** — a process started before the checkout's last
   change is a ghost:

   ```sh
   ps -o lstart= -p <hostPid>
   git -C <checkout> log -1 --format=%cI
   ```

2. **Probe, don't read version numbers** — send the target host one request whose
   behavior is known to diverge between generations and classify it by the reply. The
   unauthenticated `agentPreset.list` `ok`/401 fork above is a ready-made probe
   (loopback is not exempt, see [DSH-0.1.2-A1-08](v0.1.2-alpha.1.md)); for the
   composition-layer equivalent see [host-plane-probes.md](host-plane-probes.md).

Both checks plus the probe are packaged as
[`scripts/ghost-host-check.mjs`](../scripts/ghost-host-check.mjs)
(`node skills/plugin-upgrade/scripts/ghost-host-check.mjs <hostPid> <checkoutDir> [port]`;
exit 1 = ghost, so shell gates can consume the verdict directly).

When a ghost is confirmed: restart the host and re-run the checkup, or explicitly pin
the corridor's `from` to the process's actual generation and record it in the report.
Do not explain an old process's 401s or compat behavior against the new on-disk code.
Restarting may take down your own runtime — the safety side of that decision is
[rollup R-12](rollup-0.1.2.md) (the upgrade target may be the currently running host);
this step is its identification side.

## #1 source patch / monkey patch

```sh
rg -n "(^|[^.])patch\.yml|patchedDependencies|patch-package" .
rg -n "DSH_HARNESS_SOURCE_ROOT|patch-surface|monkeypatch|monkey-patch" .
```

For each hit, record the host target path and the replacement intent; when no equivalent
owning module exists in the target tag, mark it "pending confirmation" — do not guess
paths. An ordinary `cordis.patch.yml` is profile composition and must be classified per
[API-08](api-migration-0.1.2-alpha.2.md#api-08--cordispatchyml-is-composition-not-a-source-patch);
a filename containing `patch` alone is not a hit for this class.

**Related cards**: `DSH-0.1.2-A1-03`

## #2 internal event names and persistent events

```sh
rg -n "SessionEvent|session/event|ctx\.on\(|subscribe\(" .
rg -n "tool/code-dispatch|tools-code-mode|connection/reset" .
```

Distinguish producer, persistence, reload, transport, and plain observer roles; an unknown
required event must not slip through just because it is on a whitelist.

**Related cards**: `DSH-0.1.2-A1-02`, `DSH-0.1.2-A1-06`, `DSH-0.1.2-A2-01`

## #3 internal service probes / Remote

```sh
rg -n "APIProxy|apiProxy|ctx\.get\(|ctx\.remote|@Remote" .
rg -n "@deepseek-ai/dsh-api-.+/client|/internal" .
```

Also record the face the call lives in (Host, Web Client, ordinary Cordis plugin) and the
package entry point; an internal architecture migration must not be passed off as a
public-API recommendation for every plugin.

**Related cards**: `DSH-0.1.2-A1-01`, `DSH-0.1.2-A1-06`, `DSH-0.1.2-A1-11`, `DSH-0.1.2-A1-20`, `DSH-0.1.2-A1-21`, `DSH-0.1.2-A1-22`, `DSH-0.1.2-A1-25`, `DSH-0.1.2-A1-27`, `DSH-0.1.2-A1-30`, `DSH-0.1.2-A1-31`, `DSH-0.1.2-A1-32`, `DSH-0.1.2-A2-02`, `DSH-0.1.2-A2-05`, `DSH-0.1.2-A2-06`, `DSH-0.1.2-A2-08`, `DSH-0.1.2-A2-10`

## #4 direct host directory reads/writes

```sh
rg -n "DSH_HOME|\.dsh[/\\]|profiles[/\\]|homedir\(" .
rg -n "readFile|writeFile|mkdir|openPath" .
```

A line-level search cannot reveal data flow; once a path-construction call is hit, keep
tracing where the variables come from and where output is written. Never print
configuration contents, tokens, `.npmrc`, or session logs.

**Related cards**: `DSH-0.1.2-A1-04`, `DSH-0.1.2-A1-13`, `DSH-0.1.2-A1-21`

## #5 internal UI / commands / tool registration

```sh
rg -n "registerCommand|registerView|contributes|ctx\.tools|commands\.execute" .
rg -n "dsh-client-runtime|PropsRuntime|ctx\.slots|useSession|useChat|/internal" .
rg -n "__ModuleLoader__|PLUGIN_ID" .
```

Separate public seams from internal paths; when an old client runtime, a session/chat
selector, or a slot augmentation is hit, keep checking `dsh.client.inject`, direct type
dependencies, keyed snapshot shape, and type-only Context augmentation. Opportunistic
capabilities are suggestions only — never adopt them automatically.

**Related cards**: `DSH-0.1.2-A1-03`, `DSH-0.1.2-A1-06`, `DSH-0.1.2-A1-09`, `DSH-0.1.2-A1-10`, `DSH-0.1.2-A1-11`, `DSH-0.1.2-A1-26`, `DSH-0.1.2-A1-28`, `DSH-0.1.2-A1-29`; detailed interface mapping in [API-10](api-migration-0.1.2-alpha.2.md#api-10--web-client-runtime-unbundling-keyed-chat-snapshots-and-command-attachment-parameters)

## #6 custom HTTP / WS / RPC / DOM / CSS channels

```sh
rg -n "createServer\(|WebSocket|MutationObserver|insertRule" .
rg -n "127\.0\.0\.1|localhost|router\.(get|post|put|delete)\(|/api/" .
rg -n "contenteditable|setSelectionRange|data-input-scroll" .
```

Check authentication, Host/Origin, port lifecycle, and teardown; "listening on loopback
only" is not a reason to skip authentication.

**Related cards**: `DSH-0.1.2-A1-08`, `DSH-0.1.2-A1-28`

## #7 subprocess / stdout / stderr parsing

```sh
rg -n "node:child_process|spawn\(|exec(File)?Sync\(|execa|Bun\.spawn" .
rg -n "headless|--profile" .
```

Record argv, cwd, env, cancellation, exit codes, and stdout/stderr ownership; verifying
that the process can start is not enough.

**Related cards**: `DSH-0.1.2-A1-04`, `DSH-0.1.2-A1-05`, `DSH-0.1.2-A1-06`, `DSH-0.1.2-A1-13`, `DSH-0.1.2-A2-04`

## Special surfaces

- Permissions/approval: see also `DSH-0.1.2-A1-07`;
- Packaging/dependencies: see also `DSH-0.1.2-A1-24`, `DSH-0.1.2-A2-03`;
- Privacy/cross-border data: see also `DSH-0.1.2-A1-12`, `DSH-0.1.2-A1-14`, `DSH-0.1.2-A1-23`.

## Summary template

```markdown
## Touchpoint checkup (<plugin>, <from> → <to>)

| Touchpoint | Hit | File/line | Applicable card | Confidence note |
|---|---:|---|---|---|
| #1 patch | | | | |
| #2 events | | | | |
| #3 services/Remote | | | | |
| #4 filesystem | | | | |
| #5 UI/commands/tools | | | | |
| #6 custom channel | | | | |
| #7 subprocess/output | | | | |

No-hit notes: <scan scope, excluded directories, dependency/configuration checked separately>
Must verify: <build/typecheck, real profile mount, functional path>
```
