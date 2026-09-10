import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { updateSkills } from './update-skills.mjs'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'skill-update-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const source = join(dir, 'upstream'), root = join(dir, 'project')
  mkdirSync(join(source, 'skills/demo'), { recursive: true })
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init')
  git('config', 'user.name', 'Skill update test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(source, 'LICENSE'), 'MIT fixture\n')
  writeFileSync(join(source, 'skills/demo/SKILL.md'), 'original\n')
  const commit = () => { git('add', '.'); git('commit', '-m', 'fixture'); return git('rev-parse', 'HEAD') }
  const baseline = commit()
  for (const base of ['skills', '.dsh/skills']) {
    mkdirSync(join(root, base, 'demo'), { recursive: true })
    writeFileSync(join(root, base, 'demo/SKILL.md'), 'original\n')
    chmodSync(join(root, base, 'demo/SKILL.md'), 0o644)
  }
  mkdirSync(join(root, '.agents/skills'), { recursive: true })
  symlinkSync('../../skills/demo', join(root, '.agents/skills/demo'))
  writeFileSync(join(root, 'skills/LICENSE.upstream'), 'MIT fixture\n')
  writeFileSync(join(root, 'skills/upstream-lock.json'), JSON.stringify({
    repository: 'fixture', commit: baseline, skills: ['demo'], licenseFile: 'LICENSE.upstream',
    files: { 'demo/SKILL.md': createHash('sha256').update('original\n').digest('hex') }, executableFiles: [],
  }))
  writeFileSync(join(source, 'skills/demo/SKILL.md'), 'updated\n')
  writeFileSync(join(source, 'skills/demo/probe.mjs'), '// probe\n')
  chmodSync(join(source, 'skills/demo/probe.mjs'), 0o755)
  const target = commit()
  return { source, root, commit: target, save: commit }
}

test('preview is read-only; apply pins Git blobs and synchronizes content and modes', t => {
  const f = fixture(t)
  const before = readFileSync(join(f.root, 'skills/upstream-lock.json'))
  assert.deepEqual(updateSkills(f).added, ['demo/probe.mjs'])
  assert.deepEqual(readFileSync(join(f.root, 'skills/upstream-lock.json')), before)
  writeFileSync(join(f.source, 'skills/demo/SKILL.md'), 'dirty checkout must not be imported\n')
  updateSkills({ ...f, apply: true })
  for (const base of ['skills', '.dsh/skills', '.agents/skills']) {
    assert.equal(readFileSync(join(f.root, base, 'demo/SKILL.md'), 'utf8'), 'updated\n')
  }
  assert.deepEqual(updateSkills(f).changed, [])
  assert.deepEqual(updateSkills(f).added, [])
})

for (const base of ['skills', '.dsh/skills']) {
  test(`refuses local edits in ${base} before any write`, t => {
    const f = fixture(t)
    writeFileSync(join(f.root, base, 'demo/SKILL.md'), 'local edit\n')
    assert.throws(() => updateSkills({ ...f, apply: true }), /Local skill modification/)
    assert.notEqual(JSON.parse(readFileSync(join(f.root, 'skills/upstream-lock.json'))).commit, f.commit)
  })
}

test('refuses moving refs and upstream file deletion', t => {
  const f = fixture(t)
  assert.throws(() => updateSkills({ ...f, commit: 'main' }), /full 40-character/)
  updateSkills({ ...f, apply: true })
  rmSync(join(f.source, 'skills/demo/probe.mjs'))
  assert.throws(() => updateSkills({ ...f, commit: f.save(), apply: true }), /removed files/)
})

test('refuses silently adding a skill to the locked roster', t => {
  const f = fixture(t)
  mkdirSync(join(f.source, 'skills/other'))
  writeFileSync(join(f.source, 'skills/other/SKILL.md'), 'other\n')
  assert.throws(() => updateSkills({ ...f, commit: f.save(), apply: true }), /roster changed/)
})
