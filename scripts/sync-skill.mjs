#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sourcePath = resolve(root, 'skills/dsh-plugin-development/SKILL.md')
const mirrorPath = resolve(root, '.dsh/skills/dsh-plugin-development/SKILL.md')
const args = process.argv.slice(2)
if (args.some(a => !['--check'].includes(a))) {
  console.error('Usage: sync-skill.mjs [--check]')
  process.exit(1)
}
const checkOnly = args.includes('--check')

async function main() {
  const source = await readFile(sourcePath, 'utf8')

  if (checkOnly) {
    let mirror
    try {
      mirror = await readFile(mirrorPath, 'utf8')
    } catch {
      console.error(`DSH skill mirror is missing: ${mirrorPath}`)
      console.error('Run: pnpm sync:skill')
      process.exitCode = 1
      return
    }

    if (mirror !== source) {
      console.error('DSH skill mirror is out of date.')
      console.error('Run: pnpm sync:skill')
      process.exitCode = 1
      return
    }

    console.log('DSH skill mirror is up to date.')
    return
  }

  await writeFile(mirrorPath, source, 'utf8')
  console.log(`Synced ${mirrorPath}`)
}

await main()
