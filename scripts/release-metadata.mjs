import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { policy, validatePackageCompatibility } from './compatibility.mjs'

// Keep prereleases away from npm's default channel, including manual publishes.
export function releaseMetadata(pkg, support = policy, workspace) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/.exec(pkg.version)
  if (!match || match[0] !== pkg.version) throw new Error(`Unsupported release version: ${pkg.version}`)
  validatePackageCompatibility(pkg, support, workspace)
  const distTag = match[4] ? support.previewTag : 'latest'
  if (pkg.publishConfig?.tag !== distTag) {
    throw new Error(`publishConfig.tag must be "${distTag}" for ${pkg.version}`)
  }
  if (!match[4] && pkg.devDependencies['@deepseek-ai/dsh'] !== support.recommendedHost) {
    throw new Error('latest must use the recommended host as its development baseline')
  }
  return { value: pkg.version, dist_tag: distTag, prerelease: Boolean(match[4]) }
}

export function assertReleaseTagTarget(version, refs, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Expected the full release commit SHA')
  const tag = `refs/tags/v${version}`
  const targets = new Map(refs.trim().split('\n').filter(Boolean).map(line => {
    const [sha, ref] = line.split('\t')
    return [ref, sha]
  }))
  const actual = targets.get(`${tag}^{}`) ?? targets.get(tag)
  if (actual !== undefined && actual !== commit) {
    throw new Error(`Release tag v${version} points to ${actual}, expected ${commit}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const metadata = releaseMetadata(pkg)
  if (process.argv[2] === '--verify-tag-target') {
    const tag = `refs/tags/v${metadata.value}`
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const refs = execFileSync('git', ['ls-remote', 'origin', tag, `${tag}^{}`], { encoding: 'utf8' })
    assertReleaseTagTarget(metadata.value, refs, commit)
  } else {
    for (const [key, value] of Object.entries(metadata)) console.log(`${key}=${value}`)
  }
}
