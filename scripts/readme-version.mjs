import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

// npm writes a package's README into the tarball at publish time and offers no way
// to update it afterwards, so a README that still names an older plugin version is
// only fixable by cutting another release. Catch it before the tag is pushed.

const README_FILES = ['README.md', 'README_ZH.md']

// A README may name only the version being released. Older plugin versions stay
// reachable through their own release-notes links, which every check strips first.
function stripReleaseNoteLinks(markdown) {
  return markdown.replace(/\[[^\]]*\]\([^)]*release-notes\/v[0-9A-Za-z.-]+\.md[^)]*\)/g, '')
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function publishedVersions(notesDirectory) {
  return readdirSync(notesDirectory)
    .map(name => /^v(.+)\.md$/.exec(name)?.[1])
    .filter(Boolean)
    .sort()
}

export function findStaleVersionReferences(markdown, version, known) {
  const body = stripReleaseNoteLinks(markdown)
  const stale = []
  for (const candidate of known) {
    if (candidate === version) continue
    // Match whole versions only: `0.1.5` must not be found inside `0.1.5-rc.1`.
    const pattern = new RegExp(`(?<![0-9A-Za-z.-])${escapeForRegExp(candidate)}(?![0-9A-Za-z.-])`, 'g')
    for (const match of body.matchAll(pattern)) {
      stale.push({ version: candidate, index: match.index })
    }
  }
  return stale
}

export function findPinnedInstallVersions(markdown) {
  return [...markdown.matchAll(/@nanmicoder\/dsh-agent-teams@([0-9A-Za-z.-]+)/g)].map(match => match[1])
}

export function checkReadmeVersions({ version, known, files }) {
  const problems = []
  for (const [name, markdown] of Object.entries(files)) {
    for (const stale of findStaleVersionReferences(markdown, version, known)) {
      problems.push(`${name} still names ${stale.version} outside a release-notes link`)
    }
    for (const pinned of findPinnedInstallVersions(markdown)) {
      if (pinned !== version) {
        problems.push(`${name} pins @nanmicoder/dsh-agent-teams@${pinned} but the package is ${version}`)
      }
    }
  }
  return problems
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const notesDirectory = fileURLToPath(new URL('../release-notes', import.meta.url))
  const files = Object.fromEntries(
    README_FILES.map(name => [name, readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')])
  )
  const problems = checkReadmeVersions({
    version: pkg.version,
    known: publishedVersions(notesDirectory),
    files
  })
  if (problems.length > 0) {
    console.error(`README version check failed for ${pkg.version}:`)
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error('Sync the README version references with package.json, or move old versions into release-notes links.')
    process.exit(1)
  }
  console.log(`README version references match ${pkg.version}`)
}
