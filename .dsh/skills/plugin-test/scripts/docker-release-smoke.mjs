#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { access, copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const containerRunner = join(scriptDirectory, 'container-runner.mjs')
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const profileName = /^[A-Za-z0-9._-]+$/
const volumeName = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
const proxyEnvironmentNames = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
]

export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('config must be a JSON object')
  if (input.schema !== 1) throw new Error('config.schema must be 1')

  const config = {
    schema: 1,
    image: requireString(input.image, 'config.image'),
    dshVersion: requireString(input.dshVersion, 'config.dshVersion'),
    pnpmVersion: requireString(input.pnpmVersion, 'config.pnpmVersion'),
    profile: requireString(input.profile, 'config.profile'),
    startCommand: requireCommand(input.startCommand, 'config.startCommand', false),
    readyPattern: requireString(input.readyPattern, 'config.readyPattern'),
    timeoutSeconds: requireInteger(input.timeoutSeconds, 'config.timeoutSeconds', 1, 1800),
    shutdownGraceSeconds: requireInteger(
      input.shutdownGraceSeconds,
      'config.shutdownGraceSeconds',
      1,
      60,
    ),
    probeCommand: requireCommand(input.probeCommand ?? [], 'config.probeCommand', true),
  }

  if (!exactVersion.test(config.dshVersion)) throw new Error('config.dshVersion must be an exact version')
  if (!exactVersion.test(config.pnpmVersion)) throw new Error('config.pnpmVersion must be an exact version')
  if (!profileName.test(config.profile)) throw new Error('config.profile contains unsupported characters')
  if (config.readyPattern.length > 512) throw new Error('config.readyPattern must be at most 512 characters')
  try {
    new RegExp(config.readyPattern)
  } catch (error) {
    throw new Error(`config.readyPattern is not a valid regular expression: ${error.message}`)
  }

  const imageTail = config.image.slice(config.image.lastIndexOf('/') + 1)
  if (!imageTail.includes(':') && !config.image.includes('@sha256:')) {
    throw new Error('config.image must include a tag or sha256 digest')
  }
  if (/:latest$/i.test(config.image)) throw new Error('config.image must not use the mutable latest tag')
  return config
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`)
  if (value.includes('\0')) throw new Error(`${name} must not contain NUL characters`)
  return value
}

function requireCommand(value, name, allowEmpty) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${name} must be ${allowEmpty ? 'an' : 'a non-empty'} argv array`)
  }
  return value.map((part, index) => requireString(part, `${name}[${index}]`))
}

function requireInteger(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

export function parseMemoryBytes(value) {
  if (typeof value !== 'string') return null
  const firstValue = value.split('/', 1)[0].trim()
  const match = /^(\d+(?:\.\d+)?)\s*([KMGT]?i?B)$/i.exec(firstValue)
  if (!match) return null
  const units = {
    B: 1,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    TB: 1000 ** 4,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
  }
  return Math.round(Number(match[1]) * units[match[2].toUpperCase()])
}

export function redactLogs(value) {
  let text = String(value ?? '')
  let redactions = 0
  const replace = (pattern, replacement) => {
    text = text.replace(pattern, (...args) => {
      redactions += 1
      return typeof replacement === 'function' ? replacement(...args) : replacement
    })
  }

  replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
  replace(
    /(["']?(?:_authToken|(?=[A-Za-z_][A-Za-z0-9_]*["']?\s*[:=])(?=[A-Za-z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD))[A-Za-z_][A-Za-z0-9_]*)["']?\s*[:=]\s*)(["']?)([^\s,"';}]+)(\2)/gi,
    (_match, prefix, quote) => `${prefix}${quote}[REDACTED]${quote}`,
  )
  replace(/((?:--?(?:token|api-key|secret|password))\s+)([^\s]+)/gi, '$1[REDACTED]')
  return { text, redactions }
}

export function classifyFailure(containerResult, containerExitCode, infrastructureError) {
  if (infrastructureError) return 'infrastructure'
  if (!containerResult) return containerExitCode === 0 ? 'result' : 'container'
  if (containerResult.status === 'passed' && containerExitCode === 0) return null
  const phase = containerResult.failure?.phase
  if (['install-toolchain', 'verify-pnpm-version', 'verify-dsh-version'].includes(phase)) {
    return 'host-setup'
  }
  if (phase === 'install-plugin') return 'plugin-install'
  if (phase === 'cold-start') return 'startup'
  if (phase === 'probe') return 'probe'
  if (phase === 'teardown') return 'teardown'
  return 'container'
}

export function buildReport(input) {
  const stdout = redactLogs(input.stdout)
  const stderr = redactLogs(input.stderr)
  const classification = classifyFailure(
    input.containerResult,
    input.containerExitCode,
    input.infrastructureError,
  )
  const passed = classification === null
  const failureMessage = input.infrastructureError?.message ?? input.containerResult?.failure?.message ?? 'Smoke test failed'
  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    status: passed ? 'passed' : 'failed',
    failureClassification: classification,
    failureMessage: passed ? null : redactLogs(failureMessage).text,
    target: {
      image: input.config.image,
      dshVersion: input.config.dshVersion,
      pnpmVersion: input.config.pnpmVersion,
      profile: input.config.profile,
      startCommand: redactCommand(input.config.startCommand),
      readyPattern: input.config.readyPattern,
      probeCommand: redactCommand(input.config.probeCommand),
    },
    artifact: input.artifact,
    runtime: {
      dockerServerVersion: input.dockerServerVersion ?? null,
      containerImageId: input.containerImageId ?? null,
      containerExitCode: input.containerExitCode ?? null,
    },
    measurements: {
      elapsedMs: input.elapsedMs,
      peakMemoryBytes: input.peakMemoryBytes,
      peakCpuPercent: input.peakCpuPercent,
      resourceSamples: input.resourceSamples,
    },
    steps: (input.containerResult?.steps ?? []).map((step) => ({
      ...step,
      ...(step.message ? { message: redactLogs(step.message).text } : {}),
    })),
    logs: {
      stdout: stdout.text,
      stderr: stderr.text,
      redactionCount: stdout.redactions + stderr.redactions,
    },
    unverifiedBoundaries: [
      'provider-backed flows unless the optional probe covers them',
      'browser behavior',
      'comprehensive security scanning',
      'cross-platform and multi-version compatibility',
    ],
  }
}

function redactCommand(command) {
  return command.map((part, index) => {
    if (index > 0 && /^--?(?:token|api-key|secret|password)$/i.test(command[index - 1])) return '[REDACTED]'
    return redactLogs(part).text
  })
}

export function renderMarkdown(report) {
  const result = report.status === 'passed' ? 'PASS' : 'FAIL'
  const lines = [
    '# DSH Plugin Docker Release Smoke Report',
    '',
    `- Result: **${result}**`,
    `- DSH: \`${report.target.dshVersion}\``,
    `- Image: \`${report.target.image}\``,
    `- Profile: \`${report.target.profile}\``,
    `- Artifact: \`${report.artifact.name}\` (SHA-256 \`${report.artifact.sha256}\`)`,
    `- Elapsed: ${report.measurements.elapsedMs} ms`,
    `- Peak memory: ${formatBytes(report.measurements.peakMemoryBytes)}`,
    `- Peak CPU sample: ${report.measurements.peakCpuPercent ?? 'not sampled'}${report.measurements.peakCpuPercent == null ? '' : '%'}`,
  ]
  if (report.failureClassification) {
    lines.push(`- Failure class: \`${report.failureClassification}\``, `- Failure: ${escapeMarkdown(report.failureMessage)}`)
  }
  lines.push('', '## Steps', '')
  if (report.steps.length === 0) lines.push('_No container step result was produced._')
  else {
    lines.push('| Step | Status | Exit | Duration |', '|---|---|---:|---:|')
    for (const step of report.steps) {
      lines.push(
        `| ${escapeTable(step.name)} | ${escapeTable(step.status)} | ${step.exitCode ?? ''} | ${step.durationMs} ms |`,
      )
    }
  }
  lines.push('', '## Redacted Logs', '', `Redactions applied: ${report.logs.redactionCount}.`)
  lines.push('', '### stdout', '', fencedText(report.logs.stdout || '(empty)'))
  lines.push('', '### stderr', '', fencedText(report.logs.stderr || '(empty)'))
  lines.push('', '## Unverified Boundaries', '')
  for (const boundary of report.unverifiedBoundaries) lines.push(`- ${boundary}`)
  lines.push('')
  return lines.join('\n')
}

function formatBytes(value) {
  if (value == null) return 'not sampled'
  return `${(value / 1024 / 1024).toFixed(2)} MiB (${value} bytes)`
}

function escapeMarkdown(value) {
  return String(value ?? '').replaceAll('\n', ' ')
}

function escapeTable(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function fencedText(value) {
  const longest = Math.max(2, ...[...String(value).matchAll(/`+/g)].map((match) => match[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}text\n${value}\n${fence}`
}

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function runProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    shell: false,
  })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })
  const done = new Promise((resolvePromise) => {
    child.once('error', (error) => resolvePromise({ exitCode: null, stdout, stderr, error }))
    child.once('close', (exitCode, signal) => resolvePromise({ exitCode, signal, stdout, stderr }))
  })
  return { child, done }
}

async function checkedProcess(command, args) {
  const result = await runProcess(command, args).done
  if (result.error) throw result.error
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`
    throw new Error(`${command} ${args[0] ?? ''} failed: ${detail}`)
  }
  return result
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function sampleContainer(name) {
  const result = await runProcess('docker', ['stats', '--no-stream', '--format', '{{json .}}', name]).done
  if (result.exitCode !== 0) return null
  try {
    const data = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1))
    return {
      capturedAt: new Date().toISOString(),
      memoryBytes: parseMemoryBytes(data.MemUsage),
      cpuPercent: Number.parseFloat(String(data.CPUPerc ?? '').replace('%', '')) || 0,
    }
  } catch {
    return null
  }
}

async function loadContainerResult(directory) {
  try {
    return JSON.parse(await readFile(join(directory, 'result.json'), 'utf8'))
  } catch {
    return null
  }
}

async function loadRawLog(directory, name) {
  try {
    return await readFile(join(directory, name), 'utf8')
  } catch {
    return ''
  }
}

function bindMount(source, target, readOnly = false) {
  if (source.includes(',')) throw new Error(`Docker bind source must not contain a comma: ${source}`)
  return `type=bind,source=${source},target=${target}${readOnly ? ',readonly' : ''}`
}

function inheritedDockerEnvironment(names) {
  return names.flatMap((name) => (process.env[name] ? ['--env', name] : []))
}

export async function runDockerSmoke({ config, pluginPath, reportDirectory, cacheVolume, toolchainVolume }) {
  const validatedConfig = validateConfig(config)
  const artifactPath = await realpath(resolve(pluginPath))
  await access(artifactPath)
  const artifactStat = await stat(artifactPath)
  if (!artifactStat.isFile()) throw new Error('plugin path must point to a packaged artifact file')
  if (cacheVolume && !volumeName.test(cacheVolume)) throw new Error('cache volume has an invalid name')
  if (toolchainVolume && !volumeName.test(toolchainVolume)) throw new Error('toolchain volume has an invalid name')

  // Keep bind-mounted control files below the caller's working directory.
  // Colima and some Docker Desktop setups do not share the host's system temp
  // directory with their VM, while the checkout is already expected to be
  // available to Docker.
  const runDirectory = await mkdtemp(join(process.cwd(), '.dsh-plugin-smoke-run-'))
  const outputDirectory = join(runDirectory, 'output')
  const finalReportDirectory = reportDirectory
    ? resolve(reportDirectory)
    : await mkdtemp(join(tmpdir(), 'dsh-plugin-smoke-report-'))
  await mkdir(outputDirectory, { recursive: true })
  await mkdir(finalReportDirectory, { recursive: true })
  const stagedArtifactPath = join(runDirectory, 'plugin.tgz')
  await copyFile(artifactPath, stagedArtifactPath)
  const configPath = join(runDirectory, 'config.json')
  await writeFile(configPath, `${JSON.stringify(validatedConfig, null, 2)}\n`, 'utf8')

  const artifact = {
    name: basename(artifactPath),
    sizeBytes: artifactStat.size,
    sha256: await hashFile(artifactPath),
  }
  const containerName = `dsh-plugin-smoke-${process.pid}-${Date.now()}`
  const startedAt = Date.now()
  const samples = []
  let containerCreated = false
  let dockerServerVersion = null
  let containerImageId = null
  let containerExitCode = null
  let attachedStdout = ''
  let attachedStderr = ''
  let infrastructureError = null
  let containerResult = null

  try {
    dockerServerVersion = (
      await checkedProcess('docker', ['version', '--format', '{{.Server.Version}}'])
    ).stdout.trim()
    const dockerArguments = [
      'create',
      '--name',
      containerName,
      '--init',
      '--workdir',
      '/workspace',
      '--env',
      'HOME=/workspace/home',
      ...inheritedDockerEnvironment(proxyEnvironmentNames),
      ...(cacheVolume
        ? [
            '--env',
            'NPM_CONFIG_CACHE=/workspace/package-cache/npm',
            '--mount',
            `type=volume,source=${cacheVolume},target=/workspace/package-cache`,
          ]
        : []),
      ...(toolchainVolume
        ? [
            '--env',
            'NPM_CONFIG_PREFIX=/workspace/toolchain',
            '--mount',
            `type=volume,source=${toolchainVolume},target=/workspace/toolchain`,
          ]
        : []),
      '--mount',
      bindMount(stagedArtifactPath, '/workspace/plugin.tgz', true),
      '--mount',
      bindMount(configPath, '/workspace/config.json', true),
      '--mount',
      bindMount(await realpath(containerRunner), '/runner/container-runner.mjs', true),
      '--mount',
      bindMount(outputDirectory, '/workspace/output'),
      validatedConfig.image,
      'node',
      '/runner/container-runner.mjs',
      '--config',
      '/workspace/config.json',
      '--plugin',
      '/workspace/plugin.tgz',
      '--output',
      '/workspace/output',
    ]
    await checkedProcess('docker', dockerArguments)
    containerCreated = true
    const inspectImage = await checkedProcess('docker', ['inspect', '--format', '{{.Image}}', containerName])
    containerImageId = inspectImage.stdout.trim()

    const attached = runProcess('docker', ['start', '--attach', containerName])
    let finished = false
    attached.done.then(() => {
      finished = true
    })
    while (!finished) {
      await delay(750)
      if (finished) break
      const sample = await sampleContainer(containerName)
      if (sample) samples.push(sample)
    }
    const attachResult = await attached.done
    attachedStdout = attachResult.stdout
    attachedStderr = attachResult.stderr
    const inspectState = await checkedProcess('docker', [
      'inspect',
      '--format',
      '{{.State.ExitCode}}',
      containerName,
    ])
    containerExitCode = Number.parseInt(inspectState.stdout.trim(), 10)
    containerResult = await loadContainerResult(outputDirectory)
  } catch (error) {
    infrastructureError = error
  } finally {
    if (containerCreated) {
      await runProcess('docker', ['rm', '--force', containerName]).done
    }
  }

  const rawStdout = `${await loadRawLog(outputDirectory, 'stdout.log')}${attachedStdout}`
  const rawStderr = `${await loadRawLog(outputDirectory, 'stderr.log')}${attachedStderr}`
  const report = buildReport({
    config: validatedConfig,
    artifact,
    dockerServerVersion,
    containerImageId,
    containerExitCode,
    containerResult,
    infrastructureError,
    elapsedMs: Date.now() - startedAt,
    peakMemoryBytes: samples.reduce((peak, sample) => Math.max(peak, sample.memoryBytes ?? 0), 0) || null,
    peakCpuPercent: samples.length ? Math.max(...samples.map((sample) => sample.cpuPercent)) : null,
    resourceSamples: samples.length,
    stdout: rawStdout,
    stderr: rawStderr,
  })

  const jsonPath = join(finalReportDirectory, 'report.json')
  const markdownPath = join(finalReportDirectory, 'report.md')
  try {
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await writeFile(markdownPath, renderMarkdown(report), 'utf8')
  } finally {
    await rm(runDirectory, { recursive: true, force: true })
  }
  return { report, jsonPath, markdownPath }
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') return { help: true }
    if (!['--config', '--plugin', '--report-dir'].includes(argument)) throw new Error(`unknown argument: ${argument}`)
    const value = argv[++index]
    if (!value) throw new Error(`missing value for ${argument}`)
    options[argument.slice(2)] = value
  }
  if (!options.config || !options.plugin) throw new Error('--config and --plugin are required')
  return options
}

function printUsage() {
  console.log('Usage: node docker-release-smoke.mjs --config <config.json> --plugin <plugin.tgz> [--report-dir <dir>]')
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv)
  if (options.help) {
    printUsage()
    return 0
  }
  const config = JSON.parse(await readFile(resolve(options.config), 'utf8'))
  const result = await runDockerSmoke({
    config,
    pluginPath: options.plugin,
    reportDirectory: options['report-dir'],
  })
  console.log(`JSON report: ${result.jsonPath}`)
  console.log(`Markdown report: ${result.markdownPath}`)
  console.log(`Result: ${result.report.status.toUpperCase()}`)
  return result.report.status === 'passed' ? 0 : 1
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode
    },
    (error) => {
      console.error(`Docker release smoke failed: ${error.message}`)
      process.exitCode = 2
    },
  )
}
