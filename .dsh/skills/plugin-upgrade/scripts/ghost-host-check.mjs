#!/usr/bin/env node
// ghost-host-check.mjs — pin the corridor's `from` to the RUNNING process, not
// the disk. Executable form of pre-flight step 1.5 (the identification side of
// rollup R-12).
//
// After an in-place source-checkout upgrade, an already-running host keeps
// executing the old code from memory while `git describe` / `package.json` on
// disk report the new version. Measured on one machine with an identical
// `git describe`: the pre-upgrade process answered unauthenticated
// `agentPreset.list` with `ok:true`, the post-upgrade process answered 401
// (see DSH-0.1.2-A1-08). The disk cannot tell the two apart; only replies can.
//
// Three checks:
//   1. process start time (`ps -o lstart=`) vs the checkout's last change
//      (`git log -1 --format=%cI`) — a process that predates the change is a
//      ghost still running the old code;
//   2. the process argv actually resolves into the checkout (symlinks
//      followed) — otherwise the comparison targets the wrong process;
//   3. optional: one unauthenticated probe to the given port, classifying the
//      wire generation by the reply — never by a version number. Unknown
//      replies stay "unknown"; the script does not guess.
//
// Usage:
//   node skills/plugin-upgrade/scripts/ghost-host-check.mjs <hostPid> <checkoutDir> [port]
//
// Exit status: 0 = process is newer than the checkout's last change;
//              1 = GHOST (process predates the checkout's last change);
//              2 = usage or environment error.
//
// Read-only on disk. The optional probe sends a single unauthenticated POST to
// the port you name — nothing else touches the network. POSIX only (`ps -o
// lstart=`).
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }

/** Parse `ps -o lstart=` output ("Mon Aug 31 16:59:06 2026", local time). */
export function parseLstart(text) {
  const m = /^\w+\s+(\w+)\s+(\d+)\s+(\d+):(\d+):(\d+)\s+(\d+)$/.exec(text.trim())
  if (m === null) return new Date(text)
  return new Date(Number(m[6]), MONTHS[m[1]], Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]))
}

/** A process started before the checkout's last change runs code that predates it. */
export function judgeGhost(processStart, checkoutLastChange) {
  return processStart.getTime() < checkoutLastChange.getTime()
}

/**
 * Classify a host's wire generation by its reply to an unauthenticated
 * `agentPreset.list` POST: 401 ⇒ new wire (0.1.2-alpha.1+ auth gate),
 * `result.ok === true` ⇒ old wire (pre-0.1.2), anything else ⇒ unknown.
 */
export function classifyProbeReply(status, body) {
  if (status === 401) return 'new-wire'
  if (body !== null && typeof body === 'object' && body.result?.ok === true) return 'old-wire'
  return 'unknown'
}

/**
 * True when any absolute path in the argv resolves (symlinks followed) into
 * the checkout. `resolvePath` is injectable so the check file can run offline.
 */
export function argvReferencesCheckout(argv, checkoutRealPath, resolvePath) {
  const paths = argv.match(/\/[^\s:]+/g) ?? []
  return paths.some((candidate) => {
    try { return resolvePath(candidate).startsWith(checkoutRealPath) } catch { return false }
  })
}

function run(cmd, args) {
  // LC_ALL=C pins `ps -o lstart=` to the English month grammar parseLstart expects —
  // localized output (e.g. French) would otherwise parse to Invalid Date (#94 review).
  return execFileSync(cmd, args, { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim()
}

async function main() {
  const [pidArg, checkoutArg, portArg] = process.argv.slice(2)
  if (pidArg === undefined || checkoutArg === undefined) {
    console.error('Usage: node skills/plugin-upgrade/scripts/ghost-host-check.mjs <hostPid> <checkoutDir> [port]')
    process.exit(2)
  }

  let lstart = ''
  try { lstart = run('ps', ['-o', 'lstart=', '-p', pidArg]) } catch { /* fall through */ }
  if (lstart === '') {
    console.error(`process ${pidArg} not found`)
    process.exit(2)
  }
  const started = parseLstart(lstart)
  if (Number.isNaN(started.getTime())) {
    // Environment error, NOT a verdict: exit 2 per the usage contract (exit 1 is
    // reserved for GHOST — a gate reading this script must never confuse the two).
    console.error(`cannot parse process start time from ps output: "${lstart}"`)
    process.exit(2)
  }
  let lastChange
  let describe
  try {
    lastChange = new Date(run('git', ['-C', checkoutArg, 'log', '-1', '--format=%cI']))
    describe = run('git', ['-C', checkoutArg, 'describe', '--tags', '--always'])
  } catch (error) {
    console.error(`cannot read the checkout at ${checkoutArg}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    process.exit(2)
  }
  if (Number.isNaN(lastChange.getTime())) {
    console.error(`cannot parse the checkout's last-change time (git log -1 --format=%cI in ${checkoutArg})`)
    process.exit(2)
  }
  // Clock-skew note: comparing committer time (%cI) with process start time can only
  // mis-classify in ONE direction (toward "ghost") when clocks disagree — a
  // conservative failure mode for a pre-flight heuristic.
  const ghost = judgeGhost(started, lastChange)

  console.log(`process ${pidArg} started at    ${started.toISOString()}`)
  console.log(`checkout last changed at  ${lastChange.toISOString()} (${describe})`)

  try {
    const argv = run('ps', ['-o', 'command=', '-p', pidArg])
    if (!argvReferencesCheckout(argv, realpathSync(checkoutArg), (p) => realpathSync(p))) {
      console.log('note: no path in the process argv resolves into this checkout — confirm the process actually runs this checkout before trusting the verdict.')
    }
  } catch { /* argv unavailable: nothing to add */ }

  console.log(ghost
    ? 'verdict: GHOST — the process predates the checkout\'s last change and is running the old code from memory. Restart the host, or pin the corridor\'s `from` to the process\'s actual generation (safety side: rollup R-12).'
    : 'verdict: process is newer than the checkout\'s last change — memory and disk agree.')

  if (portArg !== undefined) {
    try {
      const res = await fetch(`http://127.0.0.1:${portArg}/api/agentPreset.list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'ghost-host-probe', method: 'agentPreset.list', payload: {} }),
        signal: AbortSignal.timeout(8000),
      })
      let body = null
      try { body = await res.json() } catch { /* non-JSON reply */ }
      const generation = classifyProbeReply(res.status, body)
      console.log(generation === 'unknown'
        ? `probe: port ${portArg} replied HTTP ${res.status} with an unrecognized shape — treat the generation as unknown, do not guess.`
        : `probe: port ${portArg} speaks ${generation === 'new-wire' ? 'the NEW wire (401 without auth; 0.1.2-alpha.1+)' : 'the OLD wire (unauthenticated reply; pre-0.1.2)'}.`)
    } catch (error) {
      console.log(`probe: port ${portArg} unreachable (${error instanceof Error ? error.message : String(error)}) — host down, or wrong port.`)
    }
  }
  process.exit(ghost ? 1 : 0)
}

const isMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()
if (isMain) await main()
