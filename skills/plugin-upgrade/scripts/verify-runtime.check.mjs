// verify-runtime.check.mjs — offline self-check for verify-runtime.mjs.
// Runs the diagnosis signatures against representative log fixtures and the
// spec/structure helpers against temp directories; exercises the CLI surface
// including argument validation. No dsh environment required:
// `node scripts/verify-runtime.check.mjs` (also wired into `npm test`).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifySpec, detectPluginStructure, diagnoseBootLog, hasNonTransportError, isWebPlugin, listKeyFor } from './verify-runtime.mjs'

const here = dirname(fileURLToPath(import.meta.url))

export function runVerifyRuntimeChecks() {
  // --- diagnoseBootLog: signature priority + fixtures ------------------------

  const BOOT_FIXTURES = [
    {
      name: 'activation failure (pending on a removed service — the #5120 migration signal)',
      log: 'Error: dsh: plugin tree failed to load: dsh: 1 entry did not activate\n@demo/p: pending (waiting for service: apiProxy)',
      verdict: 'activation-failed',
      attribution: 'plugin-code',
    },
    {
      name: 'activation assertion outranks a plain service wait (order regression guard)',
      log: '[warn] entry @demo/p waiting for service: database\nError: dsh: 1 entry did not activate',
      verdict: 'activation-failed',
      attribution: 'plugin-code',
    },
    {
      name: 'plain service wait WITHOUT the activation assertion is inconclusive, never a pass',
      log: '[warn] entry @demo/p pending (waiting for service: database)',
      verdict: 'service-wait-unresolved',
      attribution: null,
    },
    {
      name: 'host wait for webServer, plural service list (fleet regression shape)',
      log: '[warn] entry @demo/p waiting for services: webServer, sessionTitle',
      verdict: 'env-needs-service-host',
      attribution: 'profile-config',
    },
    {
      name: 'malformed plugin overlay (loader patch parse failure) is plugin-code',
      log: 'Error: dsh: overlay /x/node_modules/@demo/p/cordis.patch.yml must be a top-level YAML array of loader patch entries',
      verdict: 'activation-failed',
      attribution: 'plugin-code',
    },
    {
      name: 'module resolve crash',
      log: "node:internal/process/esm_loader:404\nError [ERR_MODULE_NOT_FOUND]: Cannot find module '@demo/missing'",
      verdict: 'load-crash-module-resolve',
      attribution: 'dependency-resolution',
    },
    {
      name: 'transport signature = tree loaded (pass)',
      log: '[agent] TRANSPORT: connect ECONNREFUSED 127.0.0.1:9 — model endpoint unreachable',
      verdict: 'pass-boot-probe',
      attribution: null,
    },
    {
      name: 'transport error line itself carries Error: and still passes (no veto)',
      log: 'Error: fetch failed\n    at node:internal/deps/undici/...',
      verdict: 'pass-boot-probe',
      attribution: null,
    },
    {
      name: 'a NON-transport Error line vetoes the transport signature (forged-pass guard)',
      log: 'TRANSPORT ECONNREFUSED 127.0.0.1:9\nError: plugin internal invariant broken',
      verdict: 'ambiguous-error-signature',
      attribution: null,
    },
    {
      name: 'Error SUBCLASSES also veto (TypeError forge — cross-model caught)',
      log: 'TRANSPORT ECONNREFUSED 127.0.0.1:9\nTypeError: plugin activation exploded',
      verdict: 'ambiguous-error-signature',
      attribution: null,
    },
    {
      name: 'bare ERROR marker also vetoes (uppercase form)',
      log: 'fetch failed somewhere\nERROR plugin crashed during init',
      verdict: 'ambiguous-error-signature',
      attribution: null,
    },
  ]

  for (const fx of BOOT_FIXTURES) {
    const got = diagnoseBootLog(fx.log)
    assert.deepEqual(got, { verdict: fx.verdict, attribution: fx.attribution }, `fixture: ${fx.name}`)
  }

  // Priority: a host wait must outrank a transport line appearing later in the log.
  assert.equal(
    diagnoseBootLog('later: TRANSPORT ECONNREFUSED\nfirst: waiting for services: webServer')?.verdict,
    'env-needs-service-host',
    'host wait outranks transport signature',
  )
  // Priority: module crash outranks activation text in the same log.
  assert.equal(
    diagnoseBootLog('x: 1 entry did not activate\ny: Error: Cannot find module')?.verdict,
    'load-crash-module-resolve',
    'module crash outranks activation failure',
  )
  // A plugin waiting for a REMOVED service (apiProxy, the #5120 signature) is an
  // activation failure that migration must fix — only webServer means "wrong env".
  assert.equal(
    diagnoseBootLog('Error: plugin tree failed to load\n@demo/old: pending (waiting for service: apiProxy)')?.verdict,
    'activation-failed',
    'removed-service wait is not an environment issue',
  )

  // The bare word "network" must NOT count as a transport signature.
  assert.equal(
    diagnoseBootLog('[plugin] network features initialised — no error'),
    null,
    'bare "network" is not a pass signature',
  )
  // No signature at all -> null (caller falls back to timeout / exit code).
  assert.equal(diagnoseBootLog('dsh booted fine, quiet log'), null, 'quiet log -> no diagnosis')

  // Timeout-alive veto cross (user decision after three independent reviews):
  // a fully silent hang stays a timeout-pass candidate; error noise disqualifies.
  assert.equal(hasNonTransportError('[mig] routes: 0'), false, 'silent log has no non-transport error')
  assert.equal(hasNonTransportError('[mig] routes: 0\nTypeError: boom'), true, 'subclass error disqualifies timeout-pass')
  assert.equal(hasNonTransportError('Error: fetch failed (retrying)'), false, 'transport-only error does not disqualify')

  // --- classifySpec -----------------------------------------------------------

  assert.equal(classifySpec('@deepseek-ai/dsh-some-plugin'), 'npm-name')
  assert.equal(classifySpec('dsh-better-sidebar'), 'npm-name')
  assert.equal(classifySpec('https://github.com/user/plugin.git'), 'git-url')
  assert.equal(classifySpec('git@github.com:user/plugin.git'), 'git-url')
  assert.equal(classifySpec('./examples/legacy-plugin'), 'directory')
  assert.equal(classifySpec('/abs/path/plugin'), 'directory')
  // A bare relative path that exists on disk is a directory, not a scoped npm name.
  assert.equal(classifySpec(join(here, '..')), 'directory')
  // A slashy token that is NOT an existing path and NOT scoped is unknown.
  assert.equal(classifySpec('no-such-dir/nor-npm'), 'unknown')
  assert.equal(classifySpec('not a spec!!'), 'unknown')

  // --- detectPluginStructure / isWebPlugin / listKeyFor (temp dirs) ------------

  const root = mkdtempSync(join(tmpdir(), 'verify-check-'))
  try {
    const pkgDir = join(root, 'pkg')
    mkdirSync(pkgDir)
    writeFileSync(join(pkgDir, 'package.json'), '{"name":"@demo/pkg"}')
    assert.equal(detectPluginStructure(pkgDir), 'package.json')
    assert.equal(isWebPlugin(pkgDir), false)
    assert.equal(listKeyFor(pkgDir, 'directory'), '@demo/pkg')
    // Corrupted package.json falls back to the ORIGINAL directory name, never
    // the temp copy name (which is always plugin-src).
    const brokenDir = join(root, 'broken-pkg')
    mkdirSync(brokenDir)
    writeFileSync(join(brokenDir, 'package.json'), 'not-json{')
    assert.equal(listKeyFor(join(root, 'copy-dest'), 'directory', brokenDir), 'broken-pkg')
    assert.equal(isWebPlugin(brokenDir), false)

    // git-url keys are repo names without .git, never the full URL.
    assert.equal(listKeyFor('https://github.com/user/plugin.git', 'git-url'), 'plugin')
    assert.equal(listKeyFor('git@github.com:user/plugin.git', 'git-url'), 'plugin')
    // npm-name keys are the package name itself.
    assert.equal(listKeyFor('@demo/pkg', 'npm-name'), '@demo/pkg')

    const webDir = join(root, 'web')
    mkdirSync(webDir)
    writeFileSync(join(webDir, 'package.json'), '{"name":"web-p","dsh":{"client":{"platform":"web"}}}')
    assert.equal(isWebPlugin(webDir), true)

    const cordisDir = join(root, 'cordis')
    mkdirSync(cordisDir)
    writeFileSync(join(cordisDir, 'cordis.yml'), '[]')
    assert.equal(detectPluginStructure(cordisDir), 'cordis.yml')
    assert.equal(listKeyFor(cordisDir, 'directory'), 'cordis', 'no package.json -> basename')

    const skillsDir = join(root, 'sk')
    mkdirSync(join(skillsDir, 'skills'), { recursive: true })
    assert.equal(detectPluginStructure(skillsDir), 'skills')

    const emptyDir = join(root, 'empty')
    mkdirSync(emptyDir)
    assert.equal(detectPluginStructure(emptyDir), null)
    assert.equal(detectPluginStructure(join(root, 'no-such-dir')), null)

    // A bare directory name with no slash must also resolve as a directory
    // (fleet-caught: "demo-old" was once mistaken for an npm name and 404'd).
    const bareDir = join(root, 'demo-old')
    mkdirSync(bareDir)
    assert.equal(classifySpec(bareDir), 'directory')

    // A same-named plain FILE must not hijack an npm spec into the directory route.
    writeFileSync(join(root, 'dsh-better-sidebar'), 'report content')
    const savedCwd = process.cwd()
    process.chdir(root)
    try {
      assert.equal(classifySpec('dsh-better-sidebar'), 'npm-name', 'file on disk does not hijack npm name')
    } finally {
      process.chdir(savedCwd)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function cliCheck(scriptPath) {
  const run = (args) => spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', timeout: 30_000 })

  const help = run(['--help'])
  assert.equal(help.status, 0, '--help exits 0')
  assert.match(help.stdout, /Exit codes: 0=pass\s+1=fail\s+2=inconclusive\s+3=skipped/)
  assert.match(help.stdout, /NOT a sandbox/, 'security boundary is stated in help')

  const noArgs = run([])
  assert.equal(noArgs.status, 2, 'no spec exits 2 (inconclusive)')

  // Argument validation: usage errors exit 2, never conflated with FAIL (1).
  for (const args of [['--timeout'], ['--timeout', 'abc', 'x'], ['--timeout', '0', 'x'], ['--bogus', 'x'], ['--profile'], ['--profile', '../escape', 'x'], ['x', 'extra']]) {
    const bad = run(args)
    assert.equal(bad.status, 2, `usage error exits 2: ${args.join(' ')}`)
    assert.match(bad.stderr, /verify-runtime:|Usage:/, `usage error is explained: ${args.join(' ')}`)
  }
}

const isMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

if (isMain) {
  runVerifyRuntimeChecks()
  cliCheck(join(here, 'verify-runtime.mjs'))
  console.log('verify-runtime.check: all assertions passed')
}
