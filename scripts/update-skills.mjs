#!/usr/bin/env node
/** Import reviewed upstream skill blobs at an exact commit; preview by default. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(import.meta.dirname, '..')
const sha256 = data => createHash('sha256').update(data).digest('hex')

function filesIn(directory, prefix = '') {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = join(prefix, entry.name)
    if (entry.isDirectory()) return filesIn(directory, path)
    if (!entry.isFile()) throw new Error(`Unsupported entry: ${join(directory, path)}`)
    return [path]
  }).sort()
}

/** Preview or import only the existing locked skill roster, preserving local ownership. */
export function updateSkills({ source, commit, apply = false, root = projectRoot }) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Use a reviewed full 40-character commit SHA.')
  const git = (...args) => execFileSync('git', ['-C', resolve(source), ...args], { maxBuffer: 32 * 1024 * 1024 })
  if (git('rev-parse', `${commit}^{commit}`).toString().trim() !== commit) throw new Error('Commit identity mismatch.')
  const skillRoot = join(root, 'skills')
  const lockPath = join(skillRoot, 'upstream-lock.json')
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  git('merge-base', '--is-ancestor', lock.commit, commit)
  const roster = new Set(lock.skills)
  const entries = git('ls-tree', '-r', '-z', commit, '--', 'skills').toString().split('\0').filter(Boolean)
  const blobs = new Map()
  const upstreamRoster = new Set()
  for (const row of entries) {
    const [metadata, path] = row.split('\t')
    const [mode, type, oid] = metadata.split(' ')
    if (/^skills\/[^/]+\/SKILL\.md$/.test(path)) upstreamRoster.add(path.split('/')[1])
    const relative = path.slice('skills/'.length)
    if (!roster.has(relative.split('/')[0])) continue
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) throw new Error(`Unsupported upstream entry: ${path}`)
    blobs.set(relative, { data: git('cat-file', 'blob', oid), executable: mode === '100755' })
  }
  if ([...roster].some(name => !upstreamRoster.has(name)) || [...upstreamRoster].some(name => !roster.has(name))) {
    throw new Error('Skill roster changed; review additions/removals and discovery links separately.')
  }
  const removed = Object.keys(lock.files).filter(path => !blobs.has(path))
  if (removed.length) throw new Error(`Upstream removed files; review separately: ${removed.join(', ')}`)
  // Complete preflight before any writes, including both copies and discovery links.
  for (const name of roster) {
    const link = join(root, '.agents/skills', name)
    if (!lstatSync(link).isSymbolicLink() || resolve(dirname(link), readlinkSync(link)) !== join(skillRoot, name)) {
      throw new Error(`Unexpected discovery link: ${link}`)
    }
    for (const base of [skillRoot, join(root, '.dsh/skills')]) {
      const directory = join(base, name)
      if (!lstatSync(directory).isDirectory()) throw new Error(`Expected real skill directory: ${directory}`)
      const actual = filesIn(directory).map(path => `${name}/${path}`)
      const expected = Object.keys(lock.files).filter(path => path.startsWith(`${name}/`)).sort()
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Untracked or missing skill files: ${directory}`)
      for (const path of expected) {
        const target = join(base, path)
        if (sha256(readFileSync(target)) !== lock.files[path]) throw new Error(`Local skill modification: ${target}`)
        if (process.platform !== 'win32' && Boolean(lstatSync(target).mode & 0o111) !== lock.executableFiles.includes(path)) {
          throw new Error(`Local executable mode modification: ${target}`)
        }
      }
    }
  }
  const license = git('show', `${commit}:LICENSE`)
  const oldLicense = git('show', `${lock.commit}:LICENSE`)
  if (!readFileSync(join(skillRoot, lock.licenseFile)).equals(oldLicense)) throw new Error('Local license modification.')
  const added = [], changed = []
  const files = {}, executableFiles = []
  for (const [path, blob] of [...blobs].sort(([a], [b]) => a.localeCompare(b))) {
    files[path] = sha256(blob.data)
    if (blob.executable) executableFiles.push(path)
    if (!(path in lock.files)) added.push(path)
    else if (lock.files[path] !== files[path] || lock.executableFiles.includes(path) !== blob.executable) changed.push(path)
  }
  const result = { from: lock.commit, to: commit, skills: roster.size, files: blobs.size, added, changed, licenseChanged: !license.equals(oldLicense), applied: apply }
  if (!apply) return result
  if (result.licenseChanged) throw new Error('License changed; review licensing separately before importing.')
  for (const path of [...added, ...changed]) {
    const blob = blobs.get(path)
    for (const base of [skillRoot, join(root, '.dsh/skills')]) {
      const target = join(base, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, blob.data)
      if (process.platform !== 'win32') chmodSync(target, blob.executable ? 0o755 : 0o644)
    }
  }
  if (lock.commit !== commit) writeFileSync(lockPath, JSON.stringify({ ...lock, commit, importedAt: new Date().toISOString().slice(0, 10), files, executableFiles }, null, 2) + '\n')
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [source, commit, ...flags] = process.argv.slice(2)
    if (!source || flags.some(flag => flag !== '--apply') || flags.length > 1) throw new Error('Usage: update-skills.mjs <upstream-checkout> <full-commit> [--apply]')
    console.log(JSON.stringify(updateSkills({ source, commit, apply: flags.includes('--apply') }), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
