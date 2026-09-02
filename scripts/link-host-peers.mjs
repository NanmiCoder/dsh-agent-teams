#!/usr/bin/env node
/**
 * Point this checkout's @deepseek-ai packages at the running Harness tree.
 *
 * A `link:` profile install loads lib/ from this repo. Node then resolves
 * `@deepseek-ai/*` from *this* node_modules, which would otherwise be a
 * second npm copy of the same version — duplicate Agent/SubagentError
 * instances and a forced `pnpm install --force` after every build.
 *
 * Harness already maintains `$DSH_HOME/profiles/node_modules` as one
 * symlink per host package. Reusing those targets keeps `pnpm build` live
 * without recopying the plugin into the profile.
 *
 * No-op when the host fallback is absent (CI, pack, a machine without DSH).
 */
import { existsSync, lstatSync, readdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const pluginScope = join(pluginRoot, 'node_modules', '@deepseek-ai')
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const hostScope = join(dshHome, 'profiles', 'node_modules', '@deepseek-ai')

if (!existsSync(pluginScope) || !existsSync(hostScope)) process.exit(0)

let linked = 0
for (const name of readdirSync(pluginScope)) {
  if (name.startsWith('.')) continue
  const dest = join(pluginScope, name)
  const host = join(hostScope, name)
  if (!existsSync(host)) continue
  try {
    if (lstatSync(dest).isSymbolicLink() && readlinkSync(dest) === host) continue
  } catch {
    // dest missing or unreadable — replace it.
  }
  rmSync(dest, { recursive: true, force: true })
  symlinkSync(host, dest)
  linked += 1
}

if (linked > 0 && process.stderr.isTTY) {
  process.stderr.write(`[link-host-peers] ${String(linked)} @deepseek-ai packages now share ${hostScope}\n`)
}
