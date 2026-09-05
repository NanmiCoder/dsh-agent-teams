import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = resolve(fileURLToPath(new URL('./gen-artifacts.mjs', import.meta.url)))

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-artifacts-check-'))
  git(root, 'init', '--quiet')
  git(root, 'config', 'user.email', 'dsh-artifacts-check@example.invalid')
  git(root, 'config', 'user.name', 'dsh-artifacts-check')
  writeFileSync(join(root, 'file.txt'), 'root\n')
  git(root, 'add', 'file.txt')
  git(root, 'commit', '--quiet', '-m', 'root')
  git(root, 'tag', 'dsh-v0.0.0')

  writeFileSync(join(root, 'file.txt'), 'from\n')
  git(root, 'commit', '--quiet', '-am', 'from')
  git(root, 'tag', 'dsh-v1.0.0')

  git(root, 'checkout', '--quiet', 'dsh-v0.0.0')
  writeFileSync(join(root, 'file.txt'), 'to\n')
  git(root, 'commit', '--quiet', '-am', 'to')
  git(root, 'tag', 'dsh-v1.0.1')
  return root
}

function run(root, from, to, output) {
  return spawnSync(process.execPath, [script, from, to, output], {
    cwd: root,
    encoding: 'utf8',
  })
}

const root = createRepository()
try {
  const impureOutput = join(root, 'impure-output')
  const impure = run(root, 'dsh-v1.0.0', 'dsh-v1.0.1', impureOutput)
  assert.equal(impure.status, 3)
  assert.match(impure.stderr, /Refusing to audit an impure corridor/)
  assert.equal(existsSync(impureOutput), false)

  const pureOutput = join(root, 'pure-output')
  const pure = run(root, 'dsh-v0.0.0', 'dsh-v1.0.0', pureOutput)
  assert.equal(pure.status, 0, pure.stderr)
  assert.equal(JSON.parse(pure.stdout).mergeBasePurity, 'pure')
  assert.equal(readFileSync(join(pureOutput, 'files.txt'), 'utf8').includes('file.txt'), true)
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('gen-artifacts checks OK: impure corridors fail closed; pure corridors generate artifacts')
