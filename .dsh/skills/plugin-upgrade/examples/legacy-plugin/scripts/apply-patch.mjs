// Static fixture for touchpoints #1 and #7. Do not execute.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const sourceRoot = process.env.DSH_HARNESS_SOURCE_ROOT
if (!sourceRoot) throw new Error('DSH_HARNESS_SOURCE_ROOT is required')

const surface = readFileSync('patch.yml', 'utf8')
console.log('[legacy] applying patch surface:\n', surface)

// Deliberately wrong expectation: target headless stdout is final text, not JSONL.
const output = execFileSync('dsh', ['--profile', 'headless', 'ping'], {
  encoding: 'utf8',
})
for (const line of output.split('\n')) {
  if (!line.trim()) continue
  const event = JSON.parse(line)
  if (event.type === 'final') console.log('[legacy] headless ok:', event.text)
}
