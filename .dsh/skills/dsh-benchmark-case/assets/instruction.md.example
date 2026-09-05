# M13 · Repository-Plugins Removal (External Plugins Become npm Packages)

## Unattended Benchmark Authorization (BENCHMARK-AUTH-v1)

This is an unattended benchmark run in a disposable isolated container; there will be no follow-up user messages. This task statement is itself the user's explicit authorization and confirmation for the solution and execution needed to complete the task: complete the necessary analysis and planning on your own, and continue executing immediately once the plan is formed — do not pause to wait for "confirmation" and do not press the user with follow-up questions. That confirmation continues to apply to the concrete plans you produce under the applicable skill, but only within the following scope:

- You may read `/app/fixture/`, local in-container documentation, and local tools; you may modify `/app/fixture/` directly and write to the specified `/app/agent-output/` directory as instructed;
- You may create disposable local verification profiles and temporary files, and run local tests, builds, and dsh commands;
- You must not modify the skill, the grader, or the reference solution, and must not publish, push, access external services, or change resources outside the container;
- If you cannot complete the task, state the blocker honestly, but do not stop merely because another round of confirmation is missing.

I have a browser plugin (working directory: `/app/fixture/`) written in the old
**repository-plugin** shape: the Node half lives under `.dsh-plugin/`, the manifest
`.dsh-plugin/package.json` declares `dsh.entry → ./index.js`, and the browser half is a
self-executing script that the entry serves at `/pet/ui.js` and injects into the page
via `httpServer.tapIndex`. The host has already been upgraded to dsh 0.1.2-alpha.2,
which **removed the whole repository-plugins mechanism** — `vendor/loader/src/repository.ts`
is gone, `dsh-repository-plugin` is no longer a builtin, and self-executing client
scripts are no longer loaded. Migrate the plugin so it installs and activates on
0.1.2-alpha.2 through the one official path: **an npm package**, i.e. a bundle plugin
with `package.json` declaring `dsh.bundle`, plus a `dsh.client` declaration and an
`exports` map so the browser half is recognized — then `dsh plugin --profile web add`
installs it into the profile's bundle layer stack.

You may keep the Node half inside `.dsh-plugin/` or move it to the package root, as
long as the declared entry (`main` / `exports["."]`) resolves and the client half is
reachable through `exports["./client"]`. Drop the legacy loading path: the
`/pet/ui.js` route and the `httpServer.tapIndex` injection must go — the client is now
mounted by client-modules (register it with an exported `{ name, apply }` module that
renders the same `#bench-pet` element). Edit the files under `/app/fixture/` directly.

dsh 0.1.2-alpha.2 is already installed globally in the container. You may create an
isolated profile yourself and run cold boot verification with `dsh plugin
--profile … add` / `dsh --profile … --no-open`. Everything outside `/app/fixture/` is
not part of this task — leave it alone.