#!/usr/bin/env node
/**
 * Generate the raw artifacts and categorized CHANGELOG for a dsh tag-pair audit.
 *
 * Usage: node gen-artifacts.mjs <from-tag> <to-tag> <out-dir>
 *
 * Writes into <out-dir>: commits.txt, files.txt, diffstat.txt,
 * <fromNorm>-to-<toNorm>.diff, CHANGELOG.md. Prints a stats JSON to stdout.
 * Read-only on the repository besides the output directory.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , from, to, out] = process.argv
if (!from || !to || !out) {
  console.error('Usage: node gen-artifacts.mjs <from-tag> <to-tag> <out-dir>')
  process.exit(2)
}

/** Run git, throwing with the command name on failure. */
function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30 })
}

/** dsh-v0.1.2-alpha.2 -> 0.1.2alpha2; dsh-v0.1.1-rc.2 -> 0.1.1rc2. */
function normalizeTag(tag) {
  const m = tag.match(/^(?:dsh-)?v?(\d+\.\d+\.\d+)(?:-(.+))?$/)
  if (!m) throw new Error(`cannot normalize tag: ${tag}`)
  return m[1] + (m[2] ? m[2].replace(/\./g, '') : '')
}

const sectionTitles = {
  release: 'Release',
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance',
  refactor: 'Refactoring',
  revert: 'Reverts',
  docs: 'Documentation',
  test: 'Tests',
  chore: 'Chores / CI',
  other: 'Other (non-conventional subjects)',
}

const commitLineRe = /^[0-9a-f]+ \(\d{4}-\d{2}-\d{2}\) (.*)$/

/** Conventional-type bucket; `Revert "…"` merge-subject lines count as reverts. */
function classify(subject) {
  if (/^Revert /.test(subject)) return 'revert'
  const m = subject.match(/^(feat|fix|perf|refactor|revert|docs|test|chore|release)(\(|:)/i)
  return m ? m[1].toLowerCase() : 'other'
}

const mergeBase = git('merge-base', from, to).trim()
const fromCommit = git('rev-parse', `${from}^{commit}`).trim()
const pure = mergeBase === fromCommit

if (!pure) {
  console.error(
    `Refusing to audit an impure corridor: merge-base ${mergeBase} != from ${fromCommit}. ` +
      'The from tag must be the merge base of the selected range.',
  )
  process.exit(3)
}

mkdirSync(out, { recursive: true })

const commitLines = git('log', '--no-merges', '--pretty=format:%h (%ad) %s', '--date=short', `${from}..${to}`)
  .split('\n')
  .filter(Boolean)

const buckets = {}
for (const key of Object.keys(sectionTitles)) buckets[key] = []
for (const line of commitLines) {
  const subject = line.match(commitLineRe)?.[1] ?? line
  buckets[classify(subject)].push(line)
}

let changelog = `# Changelog: ${from} → ${to}\n\nGenerated from \`git log ${from}..${to}\` (${commitLines.length} commits; merge commits excluded).\n\n`
for (const [key, title] of Object.entries(sectionTitles)) {
  if (!buckets[key].length) continue
  changelog += `## ${title} (${buckets[key].length})\n\n${buckets[key].map((r) => `- ${r}`).join('\n')}\n\n`
}

const diffName = `${normalizeTag(from)}-to-${normalizeTag(to)}.diff`
const files = {
  'commits.txt': commitLines.join('\n') + '\n',
  'files.txt': git('diff', '--name-status', from, to),
  'diffstat.txt': git('diff', '--stat', from, to),
  [diffName]: git('diff', from, to),
  'CHANGELOG.md': changelog,
}
for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(out, name), content.endsWith('\n') ? content : content + '\n')
}

const total = Number(git('rev-list', '--count', `${from}..${to}`).trim())
const shortstat = git('diff', '--shortstat', from, to).trim()
const stats = {
  from,
  to,
  outDir: out,
  mergeBasePurity: pure ? 'pure' : `DRIFT: merge-base ${mergeBase} != from ${fromCommit}`,
  totalCommits: total,
  nonMergeCommits: commitLines.length,
  filesChanged: Number(shortstat.match(/(\d+) files? changed/)?.[1] ?? 0),
  insertions: Number(shortstat.match(/(\d+) insertion/)?.[1] ?? 0),
  deletions: Number(shortstat.match(/(\d+) deletion/)?.[1] ?? 0),
  artifacts: Object.keys(files),
}
console.log(JSON.stringify(stats, null, 2))
