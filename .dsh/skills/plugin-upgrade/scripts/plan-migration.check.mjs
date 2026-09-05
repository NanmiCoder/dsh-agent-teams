import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { buildMigrationPlan, partitionDatalessFiles, renderMarkdown } from './plan-migration.mjs'

async function snapshot(root) {
  const rows = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else {
        const content = await readFile(path)
        rows.push(`${path.slice(root.length + 1).replaceAll('\\', '/')}:${createHash('sha256').update(content).digest('hex')}`)
      }
    }
  }
  await visit(root)
  return rows.sort()
}

export async function runMigrationPlannerChecks() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plan-'))
  const dependencyResidue = join(root, '.node_modules-delete-pending')
  try {
    const partition = await partitionDatalessFiles(['/local.ts', '/offline.ts'], {
      platform: 'darwin',
      readFlags: async () => ['-', 'archived,compressed,dataless'],
    })
    assert.deepEqual(partition, { localFiles: ['/local.ts'], datalessFiles: ['/offline.ts'] })

    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, 'scripts'), { recursive: true })
    await mkdir(dependencyResidue, { recursive: true })
    await writeFile(join(root, 'cordis.patch.yml'), '- name: ordinary-composition\n  config: {}\n')
    await writeFile(join(root, 'src', 'plugin.ts'), "import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'\nconst proxy = ctx.get('apiProxy')\nctx.useSession((session) => session?.nodes)\n")
    await writeFile(join(root, 'src', 'channel.ts'), "createServer(() => {}).listen(3000, '127.0.0.1') // /api/private\n")
    await writeFile(join(root, 'scripts', 'run.mjs'), "import { spawn } from 'node:child_process'\nspawn('dsh', ['--profile', 'headless'])\n")
    await writeFile(join(root, '.env'), 'APIProxy=secret-must-not-leak\n')
    await writeFile(join(dependencyResidue, 'stale-plugin.ts'), "const proxy = ctx.get('apiProxy')\n")

    const before = await snapshot(root)
    await chmod(dependencyResidue, 0o000)
    let plan
    try {
      plan = await buildMigrationPlan({
        root,
        from: 'dsh-v0.1.1-rc.2',
        to: 'dsh-v0.1.2-alpha.2',
        maxHits: 5,
      })
    } finally {
      await chmod(dependencyResidue, 0o700)
    }
    const after = await snapshot(root)
    assert.deepEqual(after, before, 'Planner must not modify the target repository')
    assert.equal(plan.readOnly, true)
    assert.equal(plan.scan.scannedFiles, 4, 'Planner must skip dependency cleanup residue')
    assert.deepEqual(plan.scan.skippedDatalessFiles, [])
    assert(!plan.scan.touchpoints.some((entry) => entry.hits.some((hit) => hit.file.startsWith('.node_modules-delete-pending/'))))
    assert.equal(plan.corridor.length, 2)
    assert.deepEqual(
      plan.scan.touchpoints.filter((entry) => entry.detected).map((entry) => entry.id),
      [3, 5, 6, 7],
    )
    assert.equal(plan.scan.touchpoints.find((entry) => entry.id === 1)?.detected, false, 'Ordinary cordis.patch.yml is composition, not a source patch')
    assert(!plan.scan.touchpoints.some((entry) => entry.hits.some((hit) => hit.file === '.env')))

    const applicable = new Set(plan.cards.applicable.map((card) => card.id))
    for (const id of ['DSH-0.1.2-A1-01', 'DSH-0.1.2-A1-05', 'DSH-0.1.2-A1-08', 'DSH-0.1.2-A2-02']) {
      assert(applicable.has(id), `Expected applicable card ${id}`)
    }
    assert(applicable.has('DSH-0.1.2-A1-03'), 'Expected the removed client runtime to select A1-03')
    assert(plan.cards.review.some((card) => card.id === 'DSH-0.1.2-A1-12'))

    const markdown = renderMarkdown(plan)
    assert(markdown.includes('No target file was modified'))
    assert(!markdown.includes('secret-must-not-leak'))
    assert(!markdown.includes("ctx.get('apiProxy')"), 'Planner output must not print matched source lines')

    const datalessMarkdown = renderMarkdown({
      ...plan,
      scan: { ...plan.scan, skippedDatalessFiles: ['offline/plugin.ts'] },
    })
    assert(datalessMarkdown.includes('Skipped macOS dataless files'))
    assert(datalessMarkdown.includes('Hydrate them and rerun before making a compatibility claim.'))

    const gap = await buildMigrationPlan({
      root,
      from: 'dsh-v0.1.2-alpha.2',
      to: 'dsh-v9.9.9',
    })
    assert.equal(gap.gaps.length, 1)
    assert.equal(gap.cards.applicable.length, 0)

    if (process.platform !== 'win32' && process.getuid?.() !== 0) {
      const unreadableSource = join(root, 'protected-source')
      await mkdir(unreadableSource)
      await writeFile(join(unreadableSource, 'plugin.ts'), "ctx.get('apiProxy')\n")
      await chmod(unreadableSource, 0o000)
      try {
        await assert.rejects(
          buildMigrationPlan({
            root,
            from: 'dsh-v0.1.1-rc.2',
            to: 'dsh-v0.1.2-alpha.2',
          }),
          /EACCES|permission denied/i,
          'Planner must still fail when an ordinary source directory is unreadable',
        )
      } finally {
        await chmod(unreadableSource, 0o700)
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) {
  await runMigrationPlannerChecks()
  console.log('Migration planner checks OK: read-only scan, corridor, cards, redaction, gaps')
}
