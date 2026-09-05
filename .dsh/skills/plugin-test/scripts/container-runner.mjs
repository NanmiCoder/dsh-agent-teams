#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_LOG_BYTES = 2 * 1024 * 1024
const SETUP_TIMEOUT_MS = 8 * 60 * 1000

class SmokeFailure extends Error {
  constructor(phase, message, details = {}) {
    super(message)
    this.phase = phase
    this.exitCode = details.exitCode ?? null
    this.durationMs = details.durationMs ?? 0
  }
}

class CappedLog {
  constructor() {
    this.chunks = []
    this.bytes = 0
    this.truncated = false
  }

  add(chunk) {
    const buffer = Buffer.from(chunk)
    const remaining = MAX_LOG_BYTES - this.bytes
    if (remaining <= 0) {
      this.truncated = true
      return
    }
    const accepted = buffer.subarray(0, remaining)
    this.chunks.push(accepted)
    this.bytes += accepted.length
    if (accepted.length < buffer.length) this.truncated = true
  }

  text() {
    const suffix = this.truncated ? '\n[log truncated]\n' : ''
    return Buffer.concat(this.chunks).toString('utf8') + suffix
  }
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!['--config', '--plugin', '--output'].includes(argument)) throw new Error(`unknown argument: ${argument}`)
    const value = argv[++index]
    if (!value) throw new Error(`missing value for ${argument}`)
    options[argument.slice(2)] = value
  }
  for (const name of ['config', 'plugin', 'output']) {
    if (!options[name]) throw new Error(`--${name} is required`)
  }
  return options
}

function createCommandRunner(logs) {
  return (phase, command, args, options = {}) =>
    new Promise((resolvePromise, rejectPromise) => {
      const startedAt = Date.now()
      logs.stdout.add(`\n[${phase}] $ ${[command, ...args].join(' ')}\n`)
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
      })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? SETUP_TIMEOUT_MS)
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8')
        logs.stdout.add(chunk)
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8')
        logs.stderr.add(chunk)
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        rejectPromise(
          new SmokeFailure(phase, `${command} could not start: ${error.message}`, {
            durationMs: Date.now() - startedAt,
          }),
        )
      })
      child.once('close', (exitCode, signal) => {
        clearTimeout(timer)
        const durationMs = Date.now() - startedAt
        if (exitCode !== 0) {
          const reason = signal ? `signal ${signal}` : `exit code ${exitCode}`
          rejectPromise(new SmokeFailure(phase, `${command} failed with ${reason}`, { exitCode, durationMs }))
          return
        }
        resolvePromise({
          name: phase,
          status: 'passed',
          exitCode,
          durationMs,
          stdout,
          stderr,
        })
      })
    })
}

async function waitForExit(child, milliseconds) {
  if (child.exitCode !== null || child.signalCode !== null) return true
  return await new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      child.off('close', onClose)
      resolvePromise(false)
    }, milliseconds)
    const onClose = () => {
      clearTimeout(timer)
      resolvePromise(true)
    }
    child.once('close', onClose)
  })
}

async function coldStart(config, environment, logs) {
  const phase = 'cold-start'
  const startedAt = Date.now()
  const ready = new RegExp(config.readyPattern)
  const [command, ...args] = config.startCommand
  logs.stdout.add(`\n[${phase}] $ ${config.startCommand.join(' ')}\n`)
  const child = spawn(command, args, { env: environment, shell: false })
  let tail = ''
  let readyFound = false

  const observe = (target) => (chunk) => {
    target.add(chunk)
    tail = `${tail}${chunk.toString('utf8')}`.slice(-64 * 1024)
    if (ready.test(tail)) readyFound = true
  }
  child.stdout.on('data', observe(logs.stdout))
  child.stderr.on('data', observe(logs.stderr))

  let spawnError = null
  child.once('error', (error) => {
    spawnError = error
  })
  const deadline = Date.now() + config.timeoutSeconds * 1000
  while (!readyFound && child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  if (spawnError) {
    throw new SmokeFailure(phase, `${command} could not start: ${spawnError.message}`, {
      durationMs: Date.now() - startedAt,
    })
  }
  if (!readyFound) {
    const reason = child.exitCode === null ? `readiness timeout after ${config.timeoutSeconds}s` : `exit code ${child.exitCode}`
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      if (!(await waitForExit(child, config.shutdownGraceSeconds * 1000))) {
        child.kill('SIGKILL')
        await waitForExit(child, 5000)
      }
    }
    throw new SmokeFailure(phase, `ready pattern was not observed: ${reason}`, {
      exitCode: child.exitCode,
      durationMs: Date.now() - startedAt,
    })
  }
  return {
    child,
    step: { name: phase, status: 'passed', exitCode: null, durationMs: Date.now() - startedAt },
  }
}

async function stopServer(child, graceSeconds) {
  const startedAt = Date.now()
  if (child.exitCode !== null || child.signalCode !== null) {
    if (child.exitCode !== 0) {
      const reason = child.signalCode ? `signal ${child.signalCode}` : `exit code ${child.exitCode}`
      throw new SmokeFailure('teardown', `start process exited before teardown with ${reason}`, {
        exitCode: child.exitCode,
        durationMs: Date.now() - startedAt,
      })
    }
    return { name: 'teardown', status: 'passed', exitCode: child.exitCode, durationMs: Date.now() - startedAt }
  }
  child.kill('SIGTERM')
  if (await waitForExit(child, graceSeconds * 1000)) {
    return { name: 'teardown', status: 'passed', exitCode: child.exitCode, durationMs: Date.now() - startedAt }
  }
  child.kill('SIGKILL')
  await waitForExit(child, 5000)
  throw new SmokeFailure('teardown', `start process did not stop within ${graceSeconds}s after SIGTERM`, {
    exitCode: child.exitCode,
    durationMs: Date.now() - startedAt,
  })
}

async function run() {
  const options = parseArguments(process.argv.slice(2))
  const outputDirectory = resolve(options.output)
  await mkdir(outputDirectory, { recursive: true })
  const config = JSON.parse(await readFile(resolve(options.config), 'utf8'))
  const pluginPath = resolve(options.plugin)
  const home = process.env.HOME || '/workspace/home'
  await mkdir(home, { recursive: true })
  const environment = {
    ...process.env,
    HOME: home,
    PATH: process.env.NPM_CONFIG_PREFIX
      ? `${join(process.env.NPM_CONFIG_PREFIX, 'bin')}:${process.env.PATH ?? ''}`
      : process.env.PATH,
    NPM_CONFIG_MAXSOCKETS: process.env.NPM_CONFIG_MAXSOCKETS ?? '12',
    NPM_CONFIG_FETCH_RETRIES: process.env.NPM_CONFIG_FETCH_RETRIES ?? '3',
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT: process.env.NPM_CONFIG_FETCH_RETRY_MINTIMEOUT ?? '1000',
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT: process.env.NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT ?? '10000',
    NPM_CONFIG_FETCH_TIMEOUT: process.env.NPM_CONFIG_FETCH_TIMEOUT ?? '300000',
    CI: '1',
    NO_COLOR: '1',
  }
  const logs = { stdout: new CappedLog(), stderr: new CappedLog() }
  const steps = []
  const runCommand = createCommandRunner(logs)
  let server = null
  let failure = null

  try {
    const prefix = environment.NPM_CONFIG_PREFIX
    const cachedPnpmVersion = prefix
      ? await readPackageVersion(join(prefix, 'lib', 'node_modules', 'pnpm', 'package.json'))
      : null
    const cachedDshVersion = prefix
      ? await readPackageVersion(join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
      : null
    if (cachedPnpmVersion === config.pnpmVersion && cachedDshVersion === config.dshVersion) {
      steps.push({
        name: 'install-toolchain',
        status: 'passed',
        exitCode: 0,
        durationMs: 0,
        message: 'reused exact-version toolchain volume',
      })
    } else {
      const toolchain = await runCommand(
        'install-toolchain',
        'npm',
        ['install', '--global', `pnpm@${config.pnpmVersion}`, `@deepseek-ai/dsh@${config.dshVersion}`],
        { env: environment },
      )
      steps.push(stripOutput(toolchain))
    }

    const pnpmVersion = await runCommand('verify-pnpm-version', 'pnpm', ['--version'], { env: environment })
    if (pnpmVersion.stdout.trim() !== config.pnpmVersion) {
      throw new SmokeFailure(
        'verify-pnpm-version',
        `resolved pnpm ${pnpmVersion.stdout.trim() || 'unknown'}, expected ${config.pnpmVersion}`,
      )
    }
    steps.push(stripOutput(pnpmVersion))

    const npmRoot = await runCommand('verify-dsh-version', 'npm', ['root', '--global'], { env: environment })
    const packagePath = join(npmRoot.stdout.trim(), '@deepseek-ai', 'dsh', 'package.json')
    const installedPackage = JSON.parse(await readFile(packagePath, 'utf8'))
    if (installedPackage.version !== config.dshVersion) {
      throw new SmokeFailure(
        'verify-dsh-version',
        `resolved DSH ${installedPackage.version}, expected ${config.dshVersion}`,
      )
    }
    steps.push(stripOutput(npmRoot))

    const pluginInstall = await runCommand(
      'install-plugin',
      'dsh',
      ['plugin', '--profile', config.profile, 'add', pluginPath],
      { env: environment },
    )
    steps.push(stripOutput(pluginInstall))

    const started = await coldStart(config, environment, logs)
    server = started.child
    steps.push(started.step)

    if (config.probeCommand.length) {
      const [probe, ...probeArgs] = config.probeCommand
      const probeStep = await runCommand('probe', probe, probeArgs, {
        env: environment,
        timeoutMs: Math.min(config.timeoutSeconds, 60) * 1000,
      })
      steps.push(stripOutput(probeStep))
    }

    steps.push(await stopServer(server, config.shutdownGraceSeconds))
    server = null
  } catch (error) {
    failure = {
      phase: error.phase ?? 'container',
      message: error.message,
    }
    steps.push({
      name: failure.phase,
      status: 'failed',
      exitCode: error.exitCode ?? null,
      durationMs: error.durationMs ?? 0,
      message: failure.message,
    })
    if (server) {
      try {
        steps.push(await stopServer(server, config.shutdownGraceSeconds))
      } catch (teardownError) {
        steps.push({
          name: 'teardown',
          status: 'failed',
          exitCode: null,
          durationMs: 0,
          message: teardownError.message,
        })
      }
    }
  } finally {
    await writeFile(join(outputDirectory, 'stdout.log'), logs.stdout.text(), 'utf8')
    await writeFile(join(outputDirectory, 'stderr.log'), logs.stderr.text(), 'utf8')
    await writeFile(
      join(outputDirectory, 'result.json'),
      `${JSON.stringify({ schema: 1, status: failure ? 'failed' : 'passed', failure, steps }, null, 2)}\n`,
      'utf8',
    )
  }
  return failure ? 1 : 0
}

function stripOutput(step) {
  const { stdout: _stdout, stderr: _stderr, ...result } = step
  return result
}

async function readPackageVersion(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8')).version ?? null
  } catch {
    return null
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run().then(
    (exitCode) => {
      process.exitCode = exitCode
    },
    (error) => {
      console.error(`container runner failed: ${error.message}`)
      process.exitCode = 2
    },
  )
}
