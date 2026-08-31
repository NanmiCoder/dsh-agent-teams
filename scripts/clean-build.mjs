import { rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const buildOutput = join(projectRoot, 'lib')

// Keep the destructive target explicit and scoped to this package. Stale
// compiler output otherwise survives source deletions and leaks into npm packs.
if (dirname(buildOutput) !== projectRoot || basename(buildOutput) !== 'lib') {
  throw new Error(`refusing to clean unexpected build output: ${buildOutput}`)
}

await rm(buildOutput, { recursive: true, force: true })
