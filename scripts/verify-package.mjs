#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises'

let failures = 0

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`)
    return
  }

  failures += 1
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('dsh-agent-teams package verification')

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const patchText = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const patchName = patchText
  .split('\n')
  .filter(line => !/^\s*#/.test(line))
  .find(line => /^\s*name:\s*\S/.test(line))
  ?.match(/^\s*name:\s*(.+?)\s*$/)?.[1]
  ?.replace(/^(['"])(.*)\1$/, '$2')

check(
  'cordis.patch.yml name matches the published package name',
  patchName === pkg.name,
  `patch has ${JSON.stringify(patchName)}, package.json has ${JSON.stringify(pkg.name)}`,
)
check(
  'files[] ships the bundle patch and lib',
  ['lib', 'cordis.patch.yml'].every(entry => pkg.files?.includes(entry)),
  `files = ${JSON.stringify(pkg.files)}`,
)
check(
  'scoped package publishes publicly',
  !pkg.name.startsWith('@') || pkg.publishConfig?.access === 'public',
  'scoped packages default to restricted without publishConfig.access = "public"',
)

for (const path of ['../lib/index.js', '../lib/client.js']) {
  try {
    await access(new URL(path, import.meta.url))
    check(`${path.slice(3)} exists`, true)
  } catch {
    check(`${path.slice(3)} exists`, false)
  }
}

const clientBundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const registeredId = clientBundle.match(/__ModuleLoader__\.load\(\{\s*id:\s*"([^"]*)"/)?.[1]
check(
  'client bundle registers under the package name',
  registeredId === pkg.name,
  `bundle registers ${JSON.stringify(registeredId)}, package.json has ${JSON.stringify(pkg.name)}`,
)

if (failures > 0) {
  console.error(`\n${failures} package verification check(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nPackage verification passed')
}
