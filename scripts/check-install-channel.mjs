/** Probe real pnpm selection in a fresh profile; metadata visibility alone is insufficient. */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const packageName = '@nanmicoder/dsh-agent-teams'
export async function checkInstallChannel({ pnpmCli, registry, expectedVersion }) {
  const url = new URL(registry)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) throw Error('Use HTTPS or a loopback fixture registry')
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(expectedVersion)) throw Error('Expected an exact plugin version')
  const root = mkdtempSync(join(tmpdir(), 'agentteams-channel-'))
  const home = join(root, 'home'), project = join(root, 'profile')
  mkdirSync(home); mkdirSync(project)
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'agentteams-channel-probe', private: true }))
  writeFileSync(join(project, 'pnpm-workspace.yaml'), 'packages:\n  - .\nautoInstallPeers: false\n')
  const userConfig = join(home, '.npmrc')
  writeFileSync(userConfig, '')
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:npm_config_|pnpm_config_|node_auth_token$)/i.test(key)))
  Object.assign(env, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'), PNPM_HOME: join(home, 'pnpm'), npm_config_userconfig: userConfig })
  async function run(args) {
    return new Promise((accept, reject) => {
      const child = spawn(process.execPath, [resolve(pnpmCli), ...args], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = '', timedOut = false
      const append = data => { output = (output + data).slice(-16384) }
      child.stdout.on('data', append); child.stderr.on('data', append)
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 120000)
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('close', code => { clearTimeout(timer); accept({ code, timedOut, output }) })
    })
  }
  try {
    const version = await run(['--version'])
    if (version.code !== 0 || version.timedOut) throw Error('Cannot identify pnpm: ' + version.output)
    const selected = await run(['add', `${packageName}@latest`, '--save-exact', '--lockfile-only', '--ignore-scripts', `--registry=${registry}`, '--config.fetch-retries=0'])
    if (selected.code !== 0 || selected.timedOut) throw Error('Package resolution failed: ' + selected.output)
    const resolvedVersion = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')).dependencies?.[packageName]
    if (!resolvedVersion || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(resolvedVersion)) throw Error('pnpm did not save an exact selected version')
    return { registry, pnpmVersion: version.output.trim(), requested: `${packageName}@latest`, expectedVersion, resolvedVersion, ready: resolvedVersion === expectedVersion, scope: 'Fresh-profile version resolution only; does not prove host activation or native Desktop UI.' }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = new Map()
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1]
    if (!['--pnpm-cli', '--registry', '--expected-version'].includes(key) || !value || flags.has(key)) throw Error('Invalid arguments')
    flags.set(key, value)
  }
  if (flags.size !== 3) throw Error('Required: --pnpm-cli <pnpm.mjs> --registry <url> --expected-version <version>')
  const result = await checkInstallChannel({ pnpmCli: flags.get('--pnpm-cli'), registry: flags.get('--registry'), expectedVersion: flags.get('--expected-version') })
  console.log(JSON.stringify(result, null, 2))
  process.exitCode = result.ready ? 0 : 1
}
