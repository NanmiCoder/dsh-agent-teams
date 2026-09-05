#!/usr/bin/env node
// verify-runtime.mjs — structured signature-based runtime verification for a
// DSH plugin (failure attribution in four classes: plugin-code /
// dependency-resolution / profile-config / dsh-runtime).
//
// Implements verification tier 3 of skills/plugin-upgrade/SKILL.md (real
// profile cold boot, entry activation, Cordis services not stuck pending).
//
// Method (battle-tested on a large plugin fleet): a deliberately dead model
// endpoint lets boot reach the model stage with a deterministic transport
// signature, because DSH asserts plugin-tree activation BEFORE any model call.
// A broken plugin fails activation in ~1s; a healthy one only fails later at
// the (dead) transport stage. On DSH 0.1.2 the agent retries the dead endpoint
// silently, so liveness through the probe window is the pass signal there.
//
// Usage: node skills/plugin-upgrade/scripts/verify-runtime.mjs <plugin-spec> [options] — the full
// contract (options, exit codes, the honest NOT-a-sandbox security boundary,
// verdict semantics, POSIX-only note) lives in the USAGE constant below, also
// printed by --help.
//
// No npm dependencies; requires node >= 20 and `dsh` on PATH (`git`/`npm`
// only for git-URL / npm-name specs).

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// --- Signature regexes (priority order; see diagnoseBootLog) ----------------
// The bare word "network" is deliberately NOT a transport signature — matching
// it anywhere in a stack path misfires (fleet-proven).
const TRANSPORT_RE = /TRANSPORT|STREAM_CLOSED|EMPTY_RESPONSE|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed/i
const MODULE_RESOLVE_RE = /ERR_MODULE_NOT_FOUND|esm\/loader|Cannot find module/i
const ACTIVATION_RE = /1 entry did not activate|plugin tree failed to load|did not activate|must be a top-level YAML array of loader patch entries/
// Only a wait for the webServer service means "wrong environment, re-probe
// under the web host": a plugin waiting for a REMOVED service (e.g. apiProxy,
// the #5120 signature) is an activation failure that migration must fix.
// Plural form included: a host-side wait can list several services; matching
// only the singular form missed those cases (root cause of a mass
// misjudgement batch in the original fleet).
const HOST_WAIT_RE = /waiting for services?:.*webServer/i
// A wait for any OTHER service is inconclusive, never a pass: the plugin may
// inject a service the host simply does not provide (plugin-code) or the
// environment may lack it (profile-config) — that distinction needs a human.
const GENERIC_WAIT_RE = /waiting for services?:/i
// Veto for the transport signature: an error line that is NOT itself a
// transport failure means the log cannot prove "tree loaded and only the
// model call failed" — a plugin can print a transport word itself. Matches
// Error AND its subclasses (TypeError, ReferenceError, …) plus bare ERROR:
// a word-boundary /\bError\b/ alone misses "TypeError: …" (fleet-caught by
// cross-model review with a working forge).
const ERROR_LINE_RE = /(?:^|\s)(?:[A-Za-z]*Error|ERROR)\b.*$/gm
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

const DEAD_MODEL_BASE_URL = 'http://127.0.0.1:9/v1' // port 9 (discard): nothing listens -> immediate ECONNREFUSED
const EXIT_CODES = { pass: 0, fail: 1, inconclusive: 2, skipped: 3 }
const USAGE = `Usage: node skills/plugin-upgrade/scripts/verify-runtime.mjs <plugin-spec> [options]

  <plugin-spec>       npm package name, git URL, or local plugin directory
  --profile <name>    profile name inside an isolated temp DSH_HOME (default "verify")
  --timeout <seconds> boot probe timeout (default 120; the web-host probe is
                      capped at 90s regardless)
  --json              machine-readable result on stdout
  --keep-workspace    keep the temp DSH_HOME for inspection
  -h, --help          show this help

Exit codes: 0=pass  1=fail  2=inconclusive  3=skipped

SECURITY: this is NOT a sandbox. The plugin under verification runs with your
full user permissions and your inherited environment (only DSH_HOME and the
working directory are pointed at temp locations, and the model endpoint is a
dead port). npm/git install lifecycle scripts execute BEFORE any probe. Run
it inside a throwaway Docker container (e.g. docker run --rm -it -v
"$PWD":/w -w /w node:24-bookworm sh) when verifying third-party plugins you
do not fully trust — that is the only way to get real filesystem/network/
process isolation. POSIX only — the probe relies on signals and shims not
available on Windows.

Verdict semantics: pass requires either a transport-only signature (pass-boot-
probe), a clean exit 0 (pass-exit-0), or a genuine probe timeout with neither
a failure signature nor any non-transport error line (pass-timeout-alive — on
DSH 0.1.2 the agent retries a dead model endpoint silently, so liveness
through the window is the pass signal; error noise downgrades to
inconclusive). Service waits other than webServer and mixed error signatures
are reported as inconclusive on purpose: they need human judgement.`

// --- Pure helpers (exported for verify-runtime.check.mjs) -------------------

/** True when the log contains an error line that is NOT itself a transport
 * failure — the shared veto for both pass paths. The log comes from the
 * plugin's own stdout/stderr, so a plugin printing "ECONNREFUSED" (or a
 * silent hang WITH error noise) must not be readable as success. */
export function hasNonTransportError(log) {
  for (const match of log.match(ERROR_LINE_RE) ?? []) {
    if (!TRANSPORT_RE.test(match)) return true
  }
  return false
}

/** Diagnose a full boot log against the signature priority chain:
 * webServer wait > module resolve crash > activation failure > other service
 * wait (inconclusive) > non-transport Error veto (inconclusive) > transport
 * signature (= tree loaded, PASS). The activation ASSERTION outranks a plain
 * service wait because the host's own "entry did not activate" text is the
 * authoritative migration signal (#5120: waiting for a removed service IS an
 * activation failure). Returns null when nothing matches. */
export function diagnoseBootLog(log) {
  if (HOST_WAIT_RE.test(log)) return { verdict: 'env-needs-service-host', attribution: 'profile-config' }
  if (MODULE_RESOLVE_RE.test(log)) return { verdict: 'load-crash-module-resolve', attribution: 'dependency-resolution' }
  if (ACTIVATION_RE.test(log)) return { verdict: 'activation-failed', attribution: 'plugin-code' }
  if (GENERIC_WAIT_RE.test(log)) return { verdict: 'service-wait-unresolved', attribution: null }
  if (TRANSPORT_RE.test(log)) {
    if (hasNonTransportError(log)) return { verdict: 'ambiguous-error-signature', attribution: null }
    return { verdict: 'pass-boot-probe', attribution: null }
  }
  return null
}

/** Detect the plugin structure of a source directory. Multi-form probing is
 * required: checking package.json alone once rejected real skills-shaped
 * plugins. Returns the structure marker or null. */
export function detectPluginStructure(srcDir) {
  if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) return null
  if (existsSync(join(srcDir, 'package.json'))) return 'package.json'
  for (const marker of ['cordis.yml', 'cordis.yaml', 'dsh.bundle']) {
    if (existsSync(join(srcDir, marker))) return marker
  }
  if (existsSync(join(srcDir, '.claude')) || existsSync(join(srcDir, 'skills'))) return 'skills'
  return null
}

/** True when the plugin declares itself as a web-plane client plugin. Without
 * this pre-probe, client plugins were mass-reported as activation failures. */
export function isWebPlugin(srcDir) {
  const pkgPath = join(srcDir, 'package.json')
  if (!existsSync(pkgPath)) return false
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    return pkg?.dsh?.client?.platform === 'web'
  } catch {
    return false
  }
}

/** Classify a plugin spec into an install route. Anything that exists as a
 * local DIRECTORY wins first: bare relative paths ("examples/legacy-plugin"
 * or a plain "demo-old") must not be mistaken for npm names — and a same-named
 * plain FILE must not hijack an npm spec. */
export function classifySpec(spec) {
  if (/^https?:\/\/./.test(spec) || /^git@.+\.git$/.test(spec)) return 'git-url'
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('~/')) return 'directory'
  try {
    if (existsSync(spec) && statSync(spec).isDirectory()) return 'directory'
  } catch {
    /* unreadable path falls through to the name forms */
  }
  if (/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(spec)) return 'npm-name'
  if (/^[a-z0-9][a-z0-9._-]*$/i.test(spec)) return 'npm-name'
  return 'unknown'
}

/** The key expected to appear in `dsh plugin list` output after install.
 * npm-name: the package name itself. git-url: the repo name without ".git"
 * (the list never shows the full URL). directory: the package name from
 * package.json, or the ORIGINAL directory name (not the temp copy — the copy
 * is always named plugin-src, which would collide across runs). */
export function listKeyFor(spec, route, originalSpec = spec) {
  if (route === 'npm-name') return spec
  if (route === 'git-url') {
    const pathPart = spec.replace(/^[a-z]+:\/\/[^/]+\//i, '').replace(/^git@[^:]+:/, '')
    return pathPart.replace(/\.git$/, '').split('/').pop() || spec
  }
  const pkgPath = join(originalSpec, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const name = JSON.parse(readFileSync(pkgPath, 'utf8'))?.name
      if (name) return name
    } catch {
      /* fall through to basename */
    }
  }
  return basename(originalSpec)
}

// --- Process helpers ---------------------------------------------------------

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: (options.timeoutSeconds ?? 120) * 1000,
    killSignal: 'SIGKILL',
    // Close stdin immediately: a booted profile reads the prompt stream and
    // blocks forever on an open pipe (only surfaces on healthy plugins —
    // broken ones fail activation long before reaching stdin).
    input: options.stdin ?? '',
    env: { ...process.env, ...(options.env ?? {}) },
    cwd: options.cwd,
  })
}

function toolMissing(cmd) {
  const probe = run(cmd, ['--version'], { timeoutSeconds: 30 })
  return probe.error !== undefined
}

function tail(text, maxBytes = 500) {
  // Strip ANSI/OSC escape sequences first: evidence is echoed into terminals
  // and reports, and plugin-controlled bytes must not reach the clipboard.
  const flat = String(text ?? '').replaceAll(ANSI_RE, '').replaceAll('\n', ' ')
  return flat.length > maxBytes ? `…${flat.slice(-maxBytes)}` : flat
}

/** Minimal headless profile patch layer: declare a REAL model name served
 * behind the dead endpoint (an invented model id makes the agent hang on
 * invalid metadata instead of reaching the transport stage — fleet-proven)
 * and disable the HMR plugin (it assumes a dev tree). */
function writeProfilePatches(profileDir) {
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(
    join(profileDir, 'cordis.patch.yml'),
    [
      '# generated by verify-runtime.mjs — real model name behind a dead endpoint (no secrets)',
      '- id: llm-verify',
      '  config:',
      '    models:',
      '      - id: Qwen3.6-35B',
      '        contextWindow: 262144',
      '        maxTokens: 8192',
      '- id: agent-default-model',
      '  config:',
      '    provider: deepseek-official',
      '    model: Qwen3.6-35B',
      '- id: "@deepseek-ai/cordis-plugin-hmr"',
      '  disabled: true',
      '',
    ].join('\n'),
  )
}

/** Resolve the authoritative dist-tag latest from the official registry and
 * install pinned. Registry mirrors can lag behind on dist-tags metadata.
 * The `pinned` flag is surfaced in the result: a silent fallback to the
 * caller's mirror means the verdict was reached on a possibly-stale version. */
function pinNpmSpec(pkgName) {
  const view = run('npm', ['view', pkgName, 'dist-tags.latest', '--registry=https://registry.npmjs.org'], { timeoutSeconds: 60 })
  const latest = (view.stdout ?? '').trim().replace(/^["']|["']$/g, '')
  return view.status === 0 && latest ? { installSpec: `${pkgName}@${latest}`, pinned: true } : { installSpec: pkgName, pinned: false }
}

/** Shared probe environment. Placeholder key: without one the agent stalls
 * waiting for credentials (fleet-proven). Full-access mode: headless
 * permission prompts can never be approved and stall the agent.
 * SECURITY BOUNDARY (honest): this is NOT a sandbox — the child inherits the
 * caller's user, environment and filesystem permissions. Only run this
 * against plugin code you would install anyway. */
function probeEnv(dshHome) {
  return {
    DSH_HOME: dshHome,
    DEEPSEEK_BASE_URL: DEAD_MODEL_BASE_URL,
    DEEPSEEK_API_KEY: 'sk-verify-local-0000000000000000000000000',
    DSH_PERMISSION_MODE: 'danger-full-access',
  }
}

/** Shape a finished probe child into {status, timedOut, logOverflow, log}.
 * Only a spawnSync ETIMEDOUT counts as "alive through the window": a SIGKILL
 * may equally be maxBuffer truncation (ENOBUFS) or an external/OOM kill, and
 * must not be read as liveness. */
function shapeProbe(child) {
  return {
    status: child.status,
    timedOut: child.error?.code === 'ETIMEDOUT',
    logOverflow: child.error?.code === 'ENOBUFS',
    log: `${child.stdout ?? ''}\n${child.stderr ?? ''}`,
  }
}

function probeHeadless(dshHome, profile, cwd, timeoutSeconds) {
  return shapeProbe(
    run('dsh', ['--profile', profile, 'ok'], { timeoutSeconds, env: probeEnv(dshHome), cwd }),
  )
}

/** Web-plane plugins need the web host: headless profiles expose no webServer
 * service, so the plugin would wait forever. `dsh web` is a FIXED alias for
 * --profile web (it rejects --profile itself), so the caller must install the
 * plugin into the 'web' profile first (see ensureWebProfileInstall). Boot for
 * a bounded window (hard cap 90s — a web host needing longer to boot is not
 * verifiable this way), then scan the full log (the process is expected to be
 * killed by the timeout — the verdict comes from the log, not the exit
 * code). */
function probeWebHost(dshHome, cwd, timeoutSeconds) {
  const port = 18080 + Math.floor(Math.random() * 1000)
  return shapeProbe(
    run('dsh', ['web', '--no-open', '--port', String(port)], {
      timeoutSeconds: Math.min(timeoutSeconds, 90),
      env: probeEnv(dshHome),
      cwd,
    }),
  )
}

/** Install the plugin into the fixed 'web' profile so `dsh web` boots it.
 * Same allow-build retry as the primary install. Returns true on success. */
function ensureWebProfileInstall(dshHome, installSpec, cwd) {
  const env = { DSH_HOME: dshHome }
  let add = run('dsh', ['plugin', '--profile', 'web', 'add', installSpec], { timeoutSeconds: 300, env, cwd })
  if (add.status !== 0) {
    const blocked = parseBlockedBuilds(`${add.stdout ?? ''}\n${add.stderr ?? ''}`)
    if (blocked.length > 0) {
      add = run('dsh', ['plugin', '--profile', 'web', 'add', installSpec, ...blocked.map((name) => `--allow-build=${name}`)], { timeoutSeconds: 300, env, cwd })
    }
  }
  return add.status === 0
}

/** pnpm v10+ blocks dependency build scripts headlessly ("Ignored build
 * scripts: node-pty@1.1.0 ... Run pnpm approve-builds"). A real user approves
 * them interactively; headless we retry once with --allow-build for exactly
 * the blocked packages, parsed from the failure log. */
function parseBlockedBuilds(log) {
  const match = /Ignored build scripts:\s*(.+)/.exec(log)
  if (!match) return []
  return [...new Set(
    match[1]
      .split(/,\s*/)
      .map((entry) => entry.trim().split('@').slice(0, -1).join('@') || entry.trim())
      .filter((name) => /^[^@\s]/.test(name) || name.startsWith('@')),
  )]
}

/** Git-hosted plugins build via their prepare script, which pnpm gates behind
 * an "allowBuilds" map in the profile's pnpm-workspace.yaml (the error prints
 * the exact key). Parse that key and hand it back for the retry write. */
function parseGitAllowBuildsKey(log) {
  const match = /allowBuilds:\s*\n\s+(\S+@\S+?):\s*true/.exec(log)
  return match ? match[1] : null
}

function writeAllowBuilds(profileDir, key) {
  const yamlPath = join(profileDir, 'pnpm-workspace.yaml')
  const existing = existsSync(yamlPath) ? readFileSync(yamlPath, 'utf8') : ''
  if (existing.includes(key)) return
  // Quoted: a leading @ is reserved in YAML and an unquoted key silently
  // fails to match the allowlist (fleet-verified).
  writeFileSync(yamlPath, `${existing}allowBuilds:\n  "${key}": true\n`)
}

// --- Verification pipeline ---------------------------------------------------

export async function verifyRuntime(rawSpec, options = {}) {
  const timeoutSeconds = options.timeoutSeconds ?? 120
  const stages = []
  const result = { spec: rawSpec, status: 'inconclusive', verdict: '', attribution: null, stages, startedAt: new Date().toISOString() }
  const stage = (name, ok, durationMs, error = '') => stages.push({ stage: name, ok, durationMs, error })

  const route = classifySpec(rawSpec)
  if (route === 'unknown') {
    result.status = 'skipped'
    result.verdict = `unrecognized-spec:${rawSpec}`
    return result
  }

  const missing = ['dsh', ...(route === 'git-url' ? ['git'] : []), ...(route === 'npm-name' ? ['npm'] : [])].filter(toolMissing)
  if (missing.length > 0) {
    result.verdict = `missing-tools:${missing.join(',')}`
    return result
  }

  // Isolated DSH_HOME: the caller's $DSH_HOME and profiles are never touched.
  const keep = options.keepWorkspace === true
  const home = mkdtempSync(join(tmpdir(), 'dsh-verify-'))
  const dshHome = join(home, '.dsh')
  const profile = options.profile ?? 'verify'
  try {
    writeProfilePatches(join(dshHome, 'profiles', profile))
    const dshEnv = { DSH_HOME: dshHome }

    let spec = rawSpec
    let originalSpec = rawSpec // for list keys: the temp copy is always plugin-src
    let webPlugin = false
    if (route === 'directory') {
      // Expand ~ BEFORE using the path for package.json reads — an unexpanded
      // "~/..." makes listKeyFor fall back to the wrong basename.
      originalSpec = rawSpec.startsWith('~/') ? join(process.env.HOME ?? '', rawSpec.slice(2)) : rawSpec
      const structure = detectPluginStructure(originalSpec)
      if (!structure) {
        result.status = 'skipped'
        result.verdict = 'no-plugin-structure'
        return result
      }
      webPlugin = isWebPlugin(originalSpec)
      // Install from a copy: verification must not mutate the original tree.
      const srcCopy = join(home, 'plugin-src')
      cpSync(originalSpec, srcCopy, { recursive: true })
      spec = srcCopy
    }

    // ---- L1: install (npm specs pin the authoritative latest first) ----
    let t0 = Date.now()
    const pin = route === 'npm-name' ? pinNpmSpec(spec) : { installSpec: spec, pinned: false }
    result.npmPinned = pin.pinned // surfaced even on later failure: provenance of the verdict
    let add = run('dsh', ['plugin', '--profile', profile, 'add', pin.installSpec], { timeoutSeconds: 300, env: dshEnv, cwd: home })
    let l1Log = `${add.stdout ?? ''}\n${add.stderr ?? ''}`
    if (add.status !== 0) {
      // pnpm v10+ build-script gates. Registry deps: retry with --allow-build
      // for exactly the blocked packages (the headless equivalent of
      // `pnpm approve-builds`). Note the = form: dsh's pnpm forwarder drops a
      // detached flag value (fleet-verified).
      const blocked = parseBlockedBuilds(l1Log)
      if (blocked.length > 0) {
        add = run('dsh', ['plugin', '--profile', profile, 'add', pin.installSpec, ...blocked.map((name) => `--allow-build=${name}`)], { timeoutSeconds: 300, env: dshEnv, cwd: home })
        l1Log = `${add.stdout ?? ''}\n${add.stderr ?? ''}`
      } else {
        // Git-hosted deps: the gate is an allowBuilds map key in the profile
        // pnpm-workspace.yaml (the error prints the exact key).
        const gitKey = parseGitAllowBuildsKey(l1Log)
        if (gitKey) {
          writeAllowBuilds(join(dshHome, 'profiles', profile), gitKey)
          add = run('dsh', ['plugin', '--profile', profile, 'add', pin.installSpec], { timeoutSeconds: 300, env: dshEnv, cwd: home })
          l1Log = `${add.stdout ?? ''}\n${add.stderr ?? ''}`
        }
      }
    }
    const l1Ms = Date.now() - t0 // real elapsed time (fleet bug this fixes: was always 0)
    stage('l1-install', add.status === 0, l1Ms, add.status === 0 ? '' : tail(l1Log))
    if (add.status !== 0) {
      result.status = 'fail'
      result.verdict = 'install-failed'
      result.attribution = 'dependency-resolution'
      result.evidence = tail(l1Log)
      return result
    }

    // ---- L2: listed (key computed from the ORIGINAL spec — the temp copy
    // is always named plugin-src and would collide across runs) ------------
    t0 = Date.now()
    const list = run('dsh', ['plugin', '--profile', profile, 'list'], { timeoutSeconds: 60, env: dshEnv, cwd: home })
    const l2Ms = Date.now() - t0
    const l2Log = `${list.stdout ?? ''}\n${list.stderr ?? ''}`
    // npm/git-installed plugins declare their plane in the installed copy —
    // read it now that node_modules exists (directory route already probed).
    // Git installs land under the repo name, npm installs under the spec.
    if ((route === 'npm-name' || route === 'git-url') && !webPlugin) {
      const installedName = route === 'git-url' ? listKeyFor(spec, 'git-url') : spec
      webPlugin = isWebPlugin(join(dshHome, 'profiles', profile, 'node_modules', installedName))
    }
    const listed = list.status === 0 && list.stdout.includes(listKeyFor(spec, route, originalSpec))
    stage('l2-listed', listed, l2Ms, listed ? '' : tail(l2Log))
    if (!listed) {
      result.status = 'fail'
      result.verdict = 'not-listed-after-install'
      result.attribution = 'dsh-runtime'
      result.evidence = tail(l2Log)
      return result
    }

    // ---- L3: boot probe — decide the verdict FIRST, then record the stage,
    // so the human output never labels a skip as FAIL --------------------------
    t0 = Date.now()
    let boot
    if (webPlugin) {
      if (!ensureWebProfileInstall(dshHome, pin.installSpec, home)) {
        result.status = 'fail'
        result.verdict = 'web-profile-install-failed'
        result.attribution = 'dependency-resolution'
        return result
      }
      boot = probeWebHost(dshHome, home, timeoutSeconds)
    } else {
      boot = probeHeadless(dshHome, profile, home, timeoutSeconds)
    }
    const l3Ms = Date.now() - t0
    // Diagnose against the FULL log: scanning only a short tail once let long
    // activation stack traces push the error headline out of the window.
    const diagnosis = diagnoseBootLog(boot.log)

    let outcome
    if (boot.logOverflow) {
      // Checked BEFORE any signature: when output exceeded maxBuffer only the
      // head survives — a forged transport line up front plus 16 MiB of noise
      // would otherwise hide the truncated failure tail and pass.
      outcome = { status: 'inconclusive', verdict: 'log-overflow' }
    } else if (diagnosis?.verdict === 'pass-boot-probe') {
      outcome = { status: 'pass', verdict: 'pass-boot-probe' }
    } else if (diagnosis?.verdict === 'env-needs-service-host') {
      outcome = { status: 'skipped', verdict: 'env-needs-service-host', attribution: diagnosis.attribution }
    } else if (diagnosis && (diagnosis.verdict === 'service-wait-unresolved' || diagnosis.verdict === 'ambiguous-error-signature')) {
      // Honest inconclusives: a non-webServer service wait or a mixed error
      // signature cannot be attributed automatically — do NOT let these fall
      // through to the liveness pass.
      outcome = { status: 'inconclusive', verdict: diagnosis.verdict, attribution: null }
    } else if (diagnosis) {
      outcome = { status: 'fail', verdict: diagnosis.verdict, attribution: diagnosis.attribution }
    } else if (!boot.timedOut && boot.status === 0) {
      outcome = { status: 'pass', verdict: 'pass-exit-0' }
    } else if (boot.timedOut && !hasNonTransportError(boot.log)) {
      // A spawnSync ETIMEDOUT with no failure signature AND no non-transport
      // error line: the host booted, the activation assertion passed (broken
      // plugins fail it loudly in ~1s) and the session stayed alive until the
      // probe window closed. On 0.1.2 the agent retries a dead model endpoint
      // silently instead of printing TRANSPORT (error-stream contract
      // change), so liveness-through-the-window IS the pass signal. A timeout
      // WITH unrelated error noise is inconclusive, not a pass (cross-model
      // review decision: three independent reviewers flagged the noise-free
      // requirement).
      outcome = { status: 'pass', verdict: 'pass-timeout-alive' }
    } else if (boot.timedOut) {
      outcome = { status: 'inconclusive', verdict: 'timeout-with-error-signature' }
    } else {
      outcome = { status: 'inconclusive', verdict: 'boot-probe-no-signature' }
    }

    const l3Ok = outcome.status === 'pass' || outcome.status === 'skipped'
    stage('l3-boot-probe', l3Ok, l3Ms, l3Ok ? '' : tail(boot.log))
    Object.assign(result, outcome)
    if (outcome.status !== 'pass') result.evidence = tail(boot.log)
    return result
  } finally {
    if (keep) result.workspace = home
    else {
      try {
        rmSync(home, { recursive: true, force: true })
      } catch {
        // Cleanup must never mask the verdict with an exception — but a
        // residue must be REPORTED (path surfaced), never silently dropped.
        result.workspace = home
        console.error(`verify-runtime: workspace cleanup failed, residue left at ${home}`)
      }
    }
  }
}

// --- CLI ---------------------------------------------------------------------

const PROFILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/ // no separators, no ".."

function optionValue(argv, i, name) {
  const value = argv[i + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`missing value for ${name}`)
  }
  return value
}

function parseArgs(argv) {
  const options = { positional: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--profile') options.profile = optionValue(argv, i++, '--profile')
    else if (arg === '--timeout') options.timeoutSeconds = Number(optionValue(argv, i++, '--timeout'))
    else if (arg === '--json') options.json = true
    else if (arg === '--keep-workspace') options.keepWorkspace = true
    else if (arg === '-h' || arg === '--help') options.help = true
    else if (arg.startsWith('--')) throw new Error(`unknown option: ${arg}`)
    else options.positional.push(arg)
  }
  if (options.timeoutSeconds !== undefined && (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0)) {
    throw new Error(`invalid value for --timeout: ${argv.includes('--timeout') ? 'must be a positive number of seconds' : options.timeoutSeconds}`)
  }
  if (options.profile !== undefined && !PROFILE_NAME_RE.test(options.profile)) {
    throw new Error(`invalid value for --profile: ${options.profile} (letters, digits, dots, dashes, underscores only)`)
  }
  if (options.positional.length > 1) throw new Error(`unexpected extra argument: ${options.positional[1]}`)
  return options
}

function renderHuman(result) {
  const lines = [`verify-runtime: ${result.spec}`]
  for (const s of result.stages) {
    // Keep the TAIL of error strings: the newest, most relevant lines are at
    // the end (slice from the front once showed stale mid-log content).
    lines.push(`  ${s.ok ? 'PASS' : 'FAIL'}  ${s.stage}  ${(s.durationMs / 1000).toFixed(1)}s${s.error ? `  ${s.error.slice(-200)}` : ''}`)
  }
  lines.push(`verdict: ${result.verdict}  status: ${result.status}${result.attribution ? `  attribution: ${result.attribution}` : ''}`)
  if (result.evidence) lines.push(`evidence: ${result.evidence.slice(-300)}`)
  if (result.workspace) lines.push(`workspace kept: ${result.workspace}`)
  return lines.join('\n')
}

const isMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

if (isMain) {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`verify-runtime: ${err.message}\n`)
    console.error(USAGE)
    process.exit(2) // usage errors are inconclusive, never conflated with FAIL
  }
  if (options.help) {
    console.log(USAGE)
    process.exit(0)
  }
  if (options.positional.length === 0) {
    console.error(USAGE)
    process.exit(2)
  }
  verifyRuntime(options.positional[0], options)
    .then((result) => {
      if (options.json) console.log(JSON.stringify(result, null, 2))
      else console.log(renderHuman(result))
      process.exit(EXIT_CODES[result.status] ?? 2)
    })
    .catch((err) => {
      // Internal errors must surface as structured inconclusive (exit 2), not
      // as an unhandled rejection that CI would misread as FAIL (exit 1).
      if (options.json) console.log(JSON.stringify({ spec: options.positional[0], status: 'inconclusive', verdict: 'internal-error', error: String(err?.message ?? err) }, null, 2))
      else console.error(`verify-runtime: internal error: ${err?.message ?? err}`)
      process.exit(2)
    })
}
