#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

// This script lives inside the skill so installers that copy only skills/<name>/ still ship it.
const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const referencesRoot = join(skillRoot, 'references')
const ignoredDirectories = new Set([
  '.git',
  '.node_modules-delete-pending',
  'node_modules',
  'vendor',
  'lib',
  'dist',
  'build',
  'coverage',
])
const sensitiveNames = new Set(['.env', '.npmrc', '.yarnrc', '.pypirc', 'credentials.json'])
// Markdown is deliberately not scanned: prose about a touchpoint is not a touchpoint.
const allowedExtensions = new Set(['.cjs', '.js', '.jsx', '.json', '.mjs', '.toml', '.ts', '.tsx', '.yaml', '.yml'])
const codeExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'])
const alwaysReadNames = new Set(['Dockerfile', 'Makefile', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb'])
const maxFileBytes = 1024 * 1024
const execFileAsync = promisify(execFile)
const darwinStatBatchSize = 256

function relativePath(root, file) {
  return relative(root, file).replaceAll('\\', '/')
}

function parseFrontmatter(text, file) {
  const normalized = text.replaceAll('\r\n', '\n')
  if (!normalized.startsWith('---\n')) throw new Error(`${file}: missing frontmatter`)
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) throw new Error(`${file}: unterminated frontmatter`)
  const meta = {}
  for (const line of normalized.slice(4, end).split('\n')) {
    if (!line.trim()) continue
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line)
    if (!match) throw new Error(`${file}: unsupported frontmatter line: ${line}`)
    const value = match[2].replace(/^['"]|['"]$/g, '')
    meta[match[1]] = /^\d+$/.test(value) ? Number(value) : value
  }
  return { meta, body: normalized.slice(end + 5) }
}

async function readDarwinFileFlags(files) {
  const flags = []
  for (let index = 0; index < files.length; index += darwinStatBatchSize) {
    const batch = files.slice(index, index + darwinStatBatchSize)
    const { stdout } = await execFileAsync('/usr/bin/stat', ['-f', '%Sf', ...batch], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
    const rows = stdout.replace(/\n$/, '').split('\n')
    if (rows.length !== batch.length) throw new Error('macOS stat returned an unexpected file count')
    flags.push(...rows)
  }
  return flags
}

export async function partitionDatalessFiles(
  files,
  { platform = process.platform, readFlags = readDarwinFileFlags } = {},
) {
  if (platform !== 'darwin' || files.length === 0) return { localFiles: files, datalessFiles: [] }
  const flags = await readFlags(files)
  if (flags.length !== files.length) throw new Error('macOS stat flags do not match the candidate file count')
  const localFiles = []
  const datalessFiles = []
  for (let index = 0; index < files.length; index += 1) {
    const flagSet = new Set(flags[index].split(','))
    if (flagSet.has('dataless')) datalessFiles.push(files[index])
    else localFiles.push(files[index])
  }
  return { localFiles, datalessFiles }
}

async function walkReadableFiles(root) {
  const files = []
  const skippedLargeFiles = []

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(path)
        continue
      }
      if (!entry.isFile()) continue
      if (sensitiveNames.has(entry.name) || entry.name.startsWith('.env.')) continue
      if (!allowedExtensions.has(extname(entry.name)) && !alwaysReadNames.has(entry.name)) continue
      const info = await stat(path)
      if (info.size > maxFileBytes) {
        skippedLargeFiles.push(relativePath(root, path))
        continue
      }
      files.push(path)
    }
  }

  await visit(root)
  files.sort()
  skippedLargeFiles.sort()
  const { localFiles, datalessFiles } = await partitionDatalessFiles(files)
  return {
    files: localFiles,
    skippedLargeFiles,
    skippedDatalessFiles: datalessFiles.map((file) => relativePath(root, file)),
  }
}

function matchingLine(text, source) {
  const expression = new RegExp(source)
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    expression.lastIndex = 0
    if (expression.test(lines[index])) return index + 1
  }
  return undefined
}

export async function scanRepository(targetRoot, { maxHits = 20, manualTouchpoints = [] } = {}) {
  const root = resolve(targetRoot)
  if (!existsSync(root)) throw new Error(`target root does not exist: ${root}`)
  const patternFile = join(referencesRoot, 'pre-flight-patterns.json')
  const patternData = JSON.parse(await readFile(patternFile, 'utf8'))
  const { files, skippedLargeFiles, skippedDatalessFiles } = await walkReadableFiles(root)
  const texts = new Map()
  for (const file of files) texts.set(file, await readFile(file, 'utf8'))

  const manual = new Set(manualTouchpoints)
  const touchpoints = []
  // Rank src/ code first, other code next, config last, so a small --max-hits window
  // is not filled by whichever directory sorts first alphabetically.
  const rank = (file) => (codeExtensions.has(extname(file)) ? (/(^|\/)src\//.test(file) ? 0 : 1) : 2)
  for (const entry of patternData.classes) {
    const found = []
    for (const file of files) {
      const text = texts.get(file)
      for (let patternIndex = 0; patternIndex < entry.patterns.length; patternIndex += 1) {
        const line = matchingLine(text, entry.patterns[patternIndex])
        if (line === undefined) continue
        found.push({ file: relativePath(root, file), line, pattern: patternIndex + 1 })
        break
      }
    }
    found.sort((a, b) => rank(a.file) - rank(b.file) || a.file.localeCompare(b.file))
    touchpoints.push({
      id: entry.id,
      slug: entry.slug,
      name: entry.name,
      detected: found.length > 0,
      manual: manual.has(entry.id),
      totalHits: found.length,
      hits: found.slice(0, maxHits),
    })
  }

  return {
    root,
    scannedFiles: files.length,
    skippedLargeFiles,
    skippedDatalessFiles,
    touchpoints,
  }
}

async function loadCardSets() {
  const names = (await readdir(referencesRoot)).filter((name) => /^v.*\.md$/.test(name)).sort()
  const sets = []
  for (const name of names) {
    const file = join(referencesRoot, name)
    const text = await readFile(file, 'utf8')
    const { meta, body } = parseFrontmatter(text, name)
    const headings = [...body.matchAll(/^###\s+([A-Za-z0-9.-]+)\s+·\s+(.+)$/gm)]
    const cards = headings.map((heading, index) => {
      const end = headings[index + 1]?.index ?? body.length
      const card = body.slice(heading.index, end)
      const field = (name) => new RegExp(`^- \\*\\*${name}\\*\\*:\\s*([^\\r\\n]+)`, 'm').exec(card)?.[1]?.trim()
      const impact = field('Touchpoints') ?? ''
      return {
        id: heading[1],
        title: heading[2].trim(),
        type: field('Type'),
        action: field('Action level'),
        impact,
        touchpoints: [...new Set([...impact.matchAll(/#([1-7])/g)].map((match) => Number(match[1])))].sort(),
        sourceFile: name,
      }
    })
    sets.push({ file: name, from: meta.from, to: meta.to, coverage: meta.coverage, cards })
  }
  return sets
}

export function resolveCorridor(cardSets, from, to) {
  if (from === to) return { sets: [], gaps: [] }
  const queue = [{ tag: from, path: [] }]
  const visited = new Set([from])
  while (queue.length) {
    const current = queue.shift()
    for (const set of cardSets.filter((candidate) => candidate.from === current.tag)) {
      const path = [...current.path, set]
      if (set.to === to) return { sets: path, gaps: [] }
      if (!visited.has(set.to)) {
        visited.add(set.to)
        queue.push({ tag: set.to, path })
      }
    }
  }
  return { sets: [], gaps: [`no card-set corridor from ${from} to ${to}`] }
}

export async function buildMigrationPlan({ root, from, to, maxHits = 20, manualTouchpoints = [] }) {
  if (!/^dsh-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(from ?? '')) {
    throw new Error('--from must be an exact dsh-vX.Y.Z[-suffix] tag')
  }
  if (!/^dsh-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(to ?? '')) {
    throw new Error('--to must be an exact dsh-vX.Y.Z[-suffix] tag')
  }
  const scan = await scanRepository(root, { maxHits, manualTouchpoints })
  const cardSets = await loadCardSets()
  const corridor = resolveCorridor(cardSets, from, to)
  const active = new Set(scan.touchpoints.filter((entry) => entry.detected || entry.manual).map((entry) => entry.id))
  const applicable = []
  const review = []
  const skipped = []

  for (const set of corridor.sets) {
    for (const card of set.cards) {
      if (card.touchpoints.length === 0) review.push(card)
      else if (card.touchpoints.some((id) => active.has(id))) applicable.push(card)
      else skipped.push(card)
    }
  }

  return {
    schema: 1,
    readOnly: true,
    from,
    to,
    scan,
    corridor: corridor.sets.map(({ file, from: setFrom, to: setTo, coverage }) => ({ file, from: setFrom, to: setTo, coverage })),
    gaps: corridor.gaps,
    cards: { applicable, review, skipped },
  }
}

export function renderMarkdown(plan) {
  const lines = [
    '# DSH plugin migration plan (read-only)',
    '',
    `- Corridor: \`${plan.from}\` → \`${plan.to}\``,
    `- Target: \`${plan.scan.root}\``,
    `- Scanned files: ${plan.scan.scannedFiles}`,
    '- This is a heuristic plan, not compatibility proof. No target file was modified.',
    '- Scanned code and config files only (no Markdown); hits list src/ code first, other code next, config last.',
    '',
    '## Touchpoints',
    '',
    '| ID | Name | Source | Hits (shown/total) |',
    '|---:|---|---|---:|',
  ]
  for (const entry of plan.scan.touchpoints) {
    const source = [entry.detected ? 'detected' : undefined, entry.manual ? 'manual' : undefined].filter(Boolean).join('+') || 'none'
    lines.push(`| #${entry.id} | ${entry.name} | ${source} | ${entry.hits.length}/${entry.totalHits ?? entry.hits.length} |`)
  }
  lines.push('', '## Hit locations', '')
  const hits = plan.scan.touchpoints.flatMap((entry) => entry.hits.map((hit) => ({ id: entry.id, ...hit })))
  if (!hits.length) lines.push('- None detected.')
  for (const hit of hits) lines.push(`- #${hit.id} \`${hit.file}:${hit.line}\` (pattern ${hit.pattern})`)
  lines.push('', '## Corridor card sets', '')
  if (!plan.corridor.length) lines.push('- None resolved.')
  for (const set of plan.corridor) lines.push(`- \`${set.from}\` → \`${set.to}\`: \`${set.file}\` (${set.coverage})`)
  lines.push('', '## Applicable cards', '')
  if (!plan.cards.applicable.length) lines.push('- None detected.')
  for (const card of plan.cards.applicable) lines.push(`- **${card.id}** (${card.type}/${card.action}, \`${card.sourceFile}\`) — ${card.title}`)
  lines.push('', '## Manual review cards', '')
  if (!plan.cards.review.length) lines.push('- None.')
  for (const card of plan.cards.review) lines.push(`- **${card.id}** (${card.type}/${card.action}) — ${card.title}`)
  if (plan.gaps.length) lines.push('', '## Unsupported corridor gaps', '', ...plan.gaps.map((gap) => `- ${gap}`))
  if (plan.scan.skippedLargeFiles.length) {
    lines.push('', '## Skipped large files', '', ...plan.scan.skippedLargeFiles.map((file) => `- \`${file}\``))
  }
  if (plan.scan.skippedDatalessFiles.length) {
    lines.push(
      '',
      '## Skipped macOS dataless files',
      '',
      '- These files are not stored locally. Hydrate them and rerun before making a compatibility claim.',
      ...plan.scan.skippedDatalessFiles.map((file) => `- \`${file}\``),
    )
  }
  return `${lines.join('\n')}\n`
}

function usage() {
  return `Usage: node skills/plugin-upgrade/scripts/plan-migration.mjs --root <plugin-repo> --from <exact-tag> --to <exact-tag> [--touchpoints 1,3] [--format markdown|json] [--max-hits N]\n\nThe command is read-only and never accepts an output/write option.\n`
}

function parseArgs(argv) {
  const options = { root: process.cwd(), format: 'markdown', maxHits: 20, manualTouchpoints: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') return { help: true }
    const value = argv[++index]
    if (value === undefined) throw new Error(`missing value for ${arg}`)
    if (arg === '--root') options.root = value
    else if (arg === '--from') options.from = value
    else if (arg === '--to') options.to = value
    else if (arg === '--format') options.format = value
    else if (arg === '--max-hits') options.maxHits = Number(value)
    else if (arg === '--touchpoints') options.manualTouchpoints = value.split(',').filter(Boolean).map(Number)
    else throw new Error(`unknown option: ${arg}`)
  }
  if (!['json', 'markdown'].includes(options.format)) throw new Error('--format must be markdown or json')
  if (!Number.isSafeInteger(options.maxHits) || options.maxHits < 1 || options.maxHits > 100) {
    throw new Error('--max-hits must be an integer from 1 to 100')
  }
  if (options.manualTouchpoints.some((id) => !Number.isInteger(id) || id < 1 || id > 7)) {
    throw new Error('--touchpoints accepts comma-separated IDs from 1 to 7')
  }
  return options
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      process.stdout.write(usage())
    } else {
      const plan = await buildMigrationPlan(options)
      process.stdout.write(options.format === 'json' ? `${JSON.stringify(plan, null, 2)}\n` : renderMarkdown(plan))
      if (plan.gaps.length) process.exitCode = 2
    }
  } catch (error) {
    process.stderr.write(`plan-migration: ${error.message}\n${usage()}`)
    process.exitCode = 1
  }
}
