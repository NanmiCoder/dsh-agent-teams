#!/usr/bin/env node

import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(root, 'skills')
const mirrorRoot = resolve(root, '.dsh/skills')
const args = process.argv.slice(2)
if (args.some(arg => arg !== '--check')) {
  console.error('Usage: sync-skill.mjs [--check]')
  process.exit(1)
}
const checkOnly = args.includes('--check')

async function filesIn(directory, prefix = '') {
  const files = []
  let entries
  try {
    entries = await readdir(join(directory, prefix), { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return files
    throw error
  }

  for (const entry of entries) {
    const relativePath = join(prefix, entry.name)
    if (entry.isDirectory()) {
      files.push(...await filesIn(directory, relativePath))
    } else if (entry.isFile()) {
      files.push(relativePath)
    } else {
      throw new Error(`Unsupported skill entry: ${join(directory, relativePath)}`)
    }
  }
  return files.sort()
}

async function main() {
  const entries = await readdir(sourceRoot, { withFileTypes: true })
  let skillCount = 0
  let fileCount = 0
  let mismatchCount = 0
  const sourceSkills = new Set()
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const sourceDirectory = join(sourceRoot, entry.name)
    const sourceFiles = await filesIn(sourceDirectory)
    if (!sourceFiles.includes('SKILL.md')) continue
    skillCount++
    sourceSkills.add(entry.name)
    const mirrorDirectory = join(mirrorRoot, entry.name)
    const mirrorFiles = new Set(await filesIn(mirrorDirectory))
    for (const file of sourceFiles) {
      const sourcePath = join(sourceDirectory, file)
      const source = await readFile(sourcePath)
      const sourceMode = (await stat(sourcePath)).mode & 0o777
      const mirrorPath = join(mirrorDirectory, file)
      if (checkOnly) {
        if (!mirrorFiles.has(file) || !(await readFile(mirrorPath)).equals(source)) {
          console.error(`Missing or out-of-date skill mirror: ${mirrorPath}`)
          mismatchCount++
        } else if (process.platform !== 'win32' && ((await stat(mirrorPath)).mode & 0o111) !== (sourceMode & 0o111)) {
          console.error(`Skill mirror executable mode differs: ${mirrorPath}`)
          mismatchCount++
        }
      } else {
        await mkdir(dirname(mirrorPath), { recursive: true })
        await writeFile(mirrorPath, source)
        if (process.platform !== 'win32') await chmod(mirrorPath, sourceMode)
      }
      mirrorFiles.delete(file)
      fileCount++
    }
    for (const file of mirrorFiles) {
      console.error(`Extra skill mirror file (review before removing): ${join(mirrorDirectory, file)}`)
      mismatchCount++
    }
  }

  let mirrorEntries = []
  try {
    mirrorEntries = await readdir(mirrorRoot, { withFileTypes: true })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  for (const entry of mirrorEntries) {
    if (!entry.isDirectory() || sourceSkills.has(entry.name)) continue
    if (!(await readdir(join(mirrorRoot, entry.name))).includes('SKILL.md')) continue
    console.error(`Extra skill mirror directory (review before removing): ${join(mirrorRoot, entry.name)}`)
    mismatchCount++
  }

  if (!skillCount) throw new Error(`No skills found in ${sourceRoot}`)
  if (mismatchCount) {
    console.error('Run pnpm sync:skill for missing or changed files; review extra files separately.')
    process.exitCode = 1
  } else {
    console.log(`DSH skill mirrors ${checkOnly ? 'are up to date' : 'synced'}: ${skillCount} skills, ${fileCount} files.`)
  }
}

await main()
