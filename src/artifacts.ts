/**
 * Workspace byte identity: the only module in this plugin that reads artifact
 * bytes off disk.
 *
 * Two plugin surfaces need it:
 *  · a quality verdict must record which revision it judged (issue #161), so
 *    delivery can refuse to advertise bytes no review ever saw;
 *  · an auto-generated work order must record the workspace it was derived
 *    from (issue #174), so it can be marked stale after a later round edits a
 *    cited file.
 *
 * Safety rules this module must never lose:
 *  · directory traversal never follows symlinks, and every explicitly named
 *    path is resolved with `realpath` and rejected when it leaves the
 *    workspace — a symlink must not become a read of arbitrary host files, and
 *    a symlink cycle must not become an infinite walk;
 *  · a scope that cannot be enumerated completely (file cap, unreadable
 *    directory, non-workspace-relative path) produces an explicit
 *    {@link ArtifactScopeGap} instead of a short list that reads as complete;
 *  · "could not be read" is recorded separately from "does not exist";
 *  · plugins and secrets never enter a broad scope by accident.
 *
 * The gate rules themselves stay pure: they receive {@link ArtifactDigest}
 * values from here and never touch the filesystem.
 * @module dsh-agent-teams/artifacts
 */

import { createHash } from 'node:crypto'
import { closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync, type BigIntStats } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { isDefaultExcludedPath, normalizeWorkspacePath } from './quality-gates.ts'
import type { ArtifactDigest, ArtifactScopeGap, ArtifactSnapshot } from './types.ts'

/**
 * Directory segments never walked when a scope pattern names a directory:
 * version control, the harness state root, plugin-private team state, and
 * installed packages. They are either huge, plugin-private, or not project
 * artifacts.
 */
const SKIPPED_SEGMENTS = new Set(['.git', '.dsh', '.agent-teams', 'node_modules'])

/**
 * Upper bound on files expanded from one scope. Verdicts are about a revision
 * and an unbounded walk of a large tree would make every gate close slow, so
 * the walk stops here — and says so with a gap, because a silently truncated
 * list would let a change outside the list pass as "unchanged".
 */
export const MAX_EXPANDED_ARTIFACTS = 200

/** Result of reading a declared scope: what was read, and what could not be. */
export interface ArtifactScopeRead {
  artifacts: ArtifactDigest[]
  gaps: ArtifactScopeGap[]
}

type PathOutcome =
  | { kind: 'file'; digest: ArtifactDigest; stamp: string }
  | { kind: 'directory' }
  | { kind: 'absent' }
  | { kind: 'unreadable'; reason: string }

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' ? code : 'EIO'
}

function workspaceRootOf(workspace: string): string | undefined {
  try {
    return realpathSync(workspace)
  } catch {
    return undefined
  }
}

/** Is `absolute` (already resolved) inside the workspace root? */
function insideRoot(root: string, absolute: string): boolean {
  const rel = relative(root, absolute)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** `true` inside, `false` escapes the workspace, `undefined` unresolvable. */
function resolvesInside(root: string, absolute: string): boolean | undefined {
  try {
    return insideRoot(root, realpathSync(absolute))
  } catch {
    return undefined
  }
}

/**
 * Chunk size for the streaming digest. The activity panel polls the audit
 * about once a second, so hashing must never read a whole artifact into
 * memory: a multi-gigabyte file would otherwise stall the host process.
 */
const HASH_CHUNK_BYTES = 64 * 1024

// These stamps only invalidate a read made in this audit. Matching timestamps
// never replace hashing, and no stamp/digest is reused by a later audit.
function fileVersion(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.mode, stats.size, stats.mtimeNs, stats.ctimeNs].join(':')
}

function changedDuringRead(): Error {
  return Object.assign(new Error('artifact changed while its bytes were being read'), { code: 'ESTALE' })
}

function pathStamp(workspaceRoot: string, absolute: string): string {
  const resolved = realpathSync(absolute)
  if (!insideRoot(workspaceRoot, resolved)) throw changedDuringRead()
  return `${resolved}\0${fileVersion(statSync(absolute, { bigint: true }))}`
}

/**
 * sha256 one file in constant memory (one reusable chunk buffer), never
 * loading the whole artifact. Throws the underlying filesystem error so the
 * caller can distinguish "cannot read" from "absent".
 */
function hashFileConstantMemory(workspaceRoot: string, absolute: string): { sha256: string; size: number; stamp: string; mtimeMs: number } {
  const resolved = realpathSync(absolute)
  if (!insideRoot(workspaceRoot, resolved)) throw changedDuringRead()
  const expected = statSync(resolved, { bigint: true })
  const handle = openSync(resolved, 'r')
  try {
    const before = fstatSync(handle, { bigint: true })
    const stamp = `${resolved}\0${fileVersion(before)}`
    if (!before.isFile() || fileVersion(expected) !== fileVersion(before) || pathStamp(workspaceRoot, absolute) !== stamp) throw changedDuringRead()
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES)
    let size = 0
    for (;;) {
      const read = readSync(handle, buffer, 0, buffer.byteLength, null)
      if (read <= 0) break
      size += read
      // `update` consumes the bytes synchronously, so the buffer is reused.
      hash.update(read === buffer.byteLength ? buffer : buffer.subarray(0, read))
    }
    if (fileVersion(before) !== fileVersion(fstatSync(handle, { bigint: true })) || pathStamp(workspaceRoot, absolute) !== stamp) throw changedDuringRead()
    return { sha256: hash.digest('hex'), size, stamp, mtimeMs: Number(before.mtimeNs) / 1_000_000 }
  } finally {
    closeSync(handle)
  }
}
function inspectPath(workspaceRoot: string | undefined, workspace: string, normalized: string): PathOutcome {
  const absolute = join(workspace, normalized)
  let stats
  try {
    stats = lstatSync(absolute)
  } catch (error) {
    const code = errorCode(error)
    return code === 'ENOENT' || code === 'ENOTDIR'
      ? { kind: 'absent' }
      : { kind: 'unreadable', reason: `${normalized} cannot be inspected (${code})` }
  }
  if (workspaceRoot === undefined) {
    return { kind: 'unreadable', reason: `${normalized} cannot be verified against the workspace root` }
  }
  // Containment is checked on the fully resolved path, not only when the last
  // segment is a symlink: an intermediate symlinked directory would otherwise
  // let any inner path read (or walk) host files outside the workspace.
  const inside = resolvesInside(workspaceRoot, absolute)
  if (inside === undefined) return { kind: 'unreadable', reason: `${normalized} cannot be resolved (broken or cyclic link)` }
  if (!inside) return { kind: 'unreadable', reason: `${normalized} resolves outside the workspace; refusing to read it` }
  if (stats.isSymbolicLink()) {
    try {
      stats = statSync(absolute)
    } catch (error) {
      return { kind: 'unreadable', reason: `${normalized} symlink target cannot be inspected (${errorCode(error)})` }
    }
  }
  if (stats.isDirectory()) return { kind: 'directory' }
  if (!stats.isFile()) return { kind: 'unreadable', reason: `${normalized} is not a regular file` }
  try {
    const { sha256, size, stamp, mtimeMs } = hashFileConstantMemory(workspaceRoot, absolute)
    return {
      kind: 'file',
      stamp,
      digest: {
        path: normalized,
        present: true,
        sha256,
        size,
        mtimeMs,
      },
    }
  } catch (error) {
    return { kind: 'unreadable', reason: `${normalized} cannot be read (${errorCode(error)})` }
  }
}

function isSkipped(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => SKIPPED_SEGMENTS.has(segment)) || isDefaultExcludedPath(relativePath)
}

interface ScopeEntry {
  path: string
  directory: boolean
}

/** Enumeration and revalidation must apply the same scope boundaries. */
function listScopeEntries(absolute: string, prefix: string): ScopeEntry[] {
  const entries: ScopeEntry[] = []
  for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    // Traversal never follows symlinks: a symlinked directory can point
    // outside the workspace or form a cycle.
    if (entry.isSymbolicLink() || isSkipped(path)) continue
    if (entry.isDirectory()) entries.push({ path, directory: true })
    else if (entry.isFile()) entries.push({ path, directory: false })
  }
  return entries
}

function directorySignature(absolute: string, entries: readonly ScopeEntry[]): string {
  return `${realpathSync(absolute)}\0${JSON.stringify(entries)}`
}

function walkDirectory(input: {
  workspace: string
  workspaceRoot: string | undefined
  pattern: string
  prefix: string
  push: (path: string) => void
  gap: (reason: string) => void
  full: () => boolean
  observe: (prefix: string, signature: string) => void
}): void {
  // The prefix itself must be inside the workspace before it is enumerated:
  // `escape/` may be a symlink to an outside directory, and readdir would
  // happily list host names through it. Nested prefixes come from
  // non-symlink directory entries of an already-verified parent.
  if (input.prefix !== '') {
    if (input.workspaceRoot === undefined) {
      input.gap(`${input.pattern}: the workspace root cannot be resolved, so it is not enumerated`)
      return
    }
    let inside: boolean | undefined
    try {
      inside = insideRoot(input.workspaceRoot, realpathSync(join(input.workspace, input.prefix)))
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') {
        input.gap(`${input.pattern}: ${input.prefix} does not exist, so the scope could not be enumerated`)
        return
      }
      inside = undefined
    }
    if (inside === undefined) {
      input.gap(`${input.pattern}: ${input.prefix} cannot be resolved (broken or cyclic link); refusing to enumerate it`)
      return
    }
    if (!inside) {
      input.gap(`${input.pattern}: ${input.prefix} resolves outside the workspace; refusing to enumerate it`)
      return
    }
  }
  const queue = input.prefix === '' ? [''] : [input.prefix]
  while (queue.length > 0) {
    const current = queue.shift() as string
    let entries: ScopeEntry[]
    try {
      const absolute = join(input.workspace, current)
      // A queued child may have been replaced after its parent was listed.
      // Recheck containment before enumeration and never follow a new nested
      // symlink (an explicitly declared, in-workspace prefix remains allowed).
      if (input.workspaceRoot === undefined || resolvesInside(input.workspaceRoot, absolute) !== true
        || (current !== input.prefix && lstatSync(absolute).isSymbolicLink())) {
        input.gap(`${input.pattern}: ${current || '.'} changed or cannot be resolved inside the workspace; refusing to enumerate it`)
        continue
      }
      entries = listScopeEntries(absolute, current)
      if (resolvesInside(input.workspaceRoot, absolute) !== true) {
        input.gap(`${input.pattern}: ${current || '.'} changed during enumeration; refusing to use its entries`)
        continue
      }
      input.observe(current, directorySignature(absolute, entries))
    } catch (error) {
      input.gap(`${input.pattern}: cannot list ${current === '' ? '.' : current} (${errorCode(error)})`)
      continue
    }
    for (const entry of entries) {
      if (entry.directory) {
        queue.push(entry.path)
        continue
      }
      if (input.full()) {
        input.gap(`${input.pattern}: stopped at the ${MAX_EXPANDED_ARTIFACTS}-file cap, so its contents are only partially recorded`)
        return
      }
      input.push(entry.path)
    }
  }
}

/**
 * Read a declared scope: expand directory patterns to their current files,
 * keep explicitly named paths even when they do not exist (a later creation is
 * drift too), and report every part that could not be fully resolved.
 */
function readScope(
  workspace: string,
  patterns: readonly string[],
  inspect: (normalized: string) => PathOutcome,
  observe: (prefix: string, signature: string) => void,
): ArtifactScopeRead {
  const workspaceRoot = workspaceRootOf(workspace)
  const gaps: ArtifactScopeGap[] = []
  const concrete: string[] = []
  const seen = new Set<string>()
  const full = (): boolean => concrete.length >= MAX_EXPANDED_ARTIFACTS
  const push = (path: string): void => {
    if (seen.has(path)) return
    seen.add(path)
    concrete.push(path)
  }
  const gap = (pattern: string, reason: string): void => {
    if (gaps.some((item) => item.pattern === pattern && item.reason === reason)) return
    gaps.push({ pattern, reason })
  }
  for (const raw of patterns) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    const posix = trimmed.replaceAll('\\', '/')
    const directory = posix.endsWith('/') || posix === '.'
    const normalized = normalizeWorkspacePath(raw)
    if (normalized === undefined) {
      // Absolute paths, `..`, `~`, drive letters: illegal, and never a reason
      // to fall back to the workspace root.
      gap(trimmed, 'not a workspace-relative path (absolute paths and ".." can never match scope)')
      continue
    }
    if (!directory) {
      if (normalized === '') {
        gap(trimmed, 'empty path is not a file; use "." for the whole workspace')
        continue
      }
      if (full()) {
        gap(trimmed, `stopped at the ${MAX_EXPANDED_ARTIFACTS}-path cap, so the scope is only partially recorded`)
        continue
      }
      push(normalized)
      continue
    }
    // Only an explicitly root-anchored pattern means the workspace root.
    const rootAnchored = posix === '.' || posix === './' || posix.startsWith('./')
    if (normalized === '' && !rootAnchored) {
      gap(trimmed, 'unresolved directory pattern; use "./" explicitly for the workspace root')
      continue
    }
    if (full()) {
      gap(trimmed, `stopped at the ${MAX_EXPANDED_ARTIFACTS}-path cap, so its contents are only partially recorded`)
      continue
    }
    walkDirectory({ workspace, workspaceRoot, pattern: trimmed, prefix: normalized, push, gap: (reason) => gap(trimmed, reason), full, observe })
  }
  const artifacts: ArtifactDigest[] = []
  // Index-based: expanding an explicitly named directory appends its files to
  // `concrete`, and those must be digested in the same pass.
  for (let index = 0; index < concrete.length; index += 1) {
    const normalized = concrete[index] as string
    const outcome = inspect(normalized)
    if (outcome.kind === 'file') {
      artifacts.push(outcome.digest)
      continue
    }
    if (outcome.kind === 'directory') {
      // An explicitly named directory is expanded instead of being reported as
      // unreadable: `src/lib` and `src/lib/` must behave the same.
      walkDirectory({ workspace, workspaceRoot, pattern: normalized, prefix: normalized, push, gap: (reason) => gap(normalized, reason), full, observe })
      continue
    }
    if (outcome.kind === 'absent') {
      artifacts.push({ path: normalized, present: false })
      continue
    }
    artifacts.push({ path: normalized, present: false, unreadable: true, reason: outcome.reason })
  }
  return { artifacts: artifacts.sort((a, b) => a.path.localeCompare(b.path)), gaps }
}

/**
 * Read related scopes in one audit. Each scope retains its own expansion cap
 * and gaps, but overlapping paths hash only once. A final revalidation rejects
 * changed file identities and changed directory membership instead of handing
 * out a mixture of revisions as complete evidence.
 */
export function readArtifactScopes(workspace: string, scopes: readonly (readonly string[])[]): ArtifactScopeRead[] {
  const root = workspaceRootOf(workspace)
  const paths = new Map<string, PathOutcome>()
  const directories = new Map<string, string>()
  const changedDirectories = new Set<string>()
  const inspect = (normalized: string): PathOutcome => {
    let outcome = paths.get(normalized)
    if (outcome === undefined) {
      outcome = inspectPath(root, workspace, normalized)
      paths.set(normalized, outcome)
    }
    return outcome
  }
  const observe = (prefix: string, signature: string): void => {
    const prior = directories.get(prefix)
    if (prior !== undefined && prior !== signature) changedDirectories.add(prefix)
    directories.set(prefix, signature)
  }
  const reads = scopes.map(patterns => readScope(workspace, patterns, inspect, observe))
  const changed = new Map<string, string>()
  for (const [path, outcome] of paths) {
    try {
      if (outcome.kind === 'file' && (root === undefined || pathStamp(root, join(workspace, path)) !== outcome.stamp)) {
        changed.set(path, `${path} changed during the workspace audit; retry a stable revision`)
      } else if (outcome.kind === 'absent') {
        try {
          lstatSync(join(workspace, path))
          changed.set(path, `${path} appeared during the workspace audit; retry a stable revision`)
        } catch (error) {
          if (errorCode(error) !== 'ENOENT' && errorCode(error) !== 'ENOTDIR') throw error
        }
      }
    } catch {
      changed.set(path, `${path} could not be revalidated after reading; the workspace audit is incomplete`)
    }
  }
  const gaps: ArtifactScopeGap[] = []
  for (const [prefix, signature] of directories) {
    try {
      const absolute = join(workspace, prefix)
      if (root === undefined || resolvesInside(root, absolute) !== true
        || directorySignature(absolute, listScopeEntries(absolute, prefix)) !== signature) changedDirectories.add(prefix)
    } catch {
      changedDirectories.add(prefix)
    }
  }
  for (const prefix of changedDirectories) gaps.push({ pattern: prefix || '.', reason: 'directory membership changed or could not be revalidated during the workspace audit; retry a stable revision' })
  for (const [path, reason] of changed) gaps.push({ pattern: path, reason })
  for (const read of reads) {
    read.artifacts = read.artifacts.map(artifact => changed.has(artifact.path)
      ? { path: artifact.path, present: false, unreadable: true, reason: changed.get(artifact.path) as string }
      : artifact)
    read.gaps.push(...gaps)
  }
  return reads
}

/** Read one scope without retaining byte identities for the next request. */
export function readArtifactScope(workspace: string, patterns: readonly string[]): ArtifactScopeRead {
  return readArtifactScopes(workspace, [patterns])[0] as ArtifactScopeRead
}

/**
 * Read the current bytes of workspace-relative paths (directories expand).
 * Illegal and unreadable paths are reported, never silently dropped.
 */
export function digestWorkspacePaths(workspace: string, paths: readonly string[]): ArtifactDigest[] {
  return readArtifactScope(workspace, paths).artifacts
}

/**
 * Does this workspace-relative path currently exist as a file or directory?
 * Uses the same containment rules as the digest reader: a symlink that leaves
 * the workspace is not "an existing workspace path".
 */
export function workspacePathExists(workspace: string, path: string): boolean {
  const normalized = normalizeWorkspacePath(path)
  if (normalized === undefined) return false
  const outcome = inspectPath(workspaceRootOf(workspace), workspace, normalized)
  return outcome.kind === 'file' || outcome.kind === 'directory'
}

/** Expand scope patterns to the concrete files they currently cover. */
export function expandScopePaths(workspace: string, patterns: readonly string[]): string[] {
  return readArtifactScope(workspace, patterns)
    .artifacts
    .filter((artifact) => artifact.present)
    .map((artifact) => artifact.path)
    .sort()
}

/**
 * Read one coherent snapshot of the given scope patterns. Directory patterns
 * expand to the files they currently contain; a pattern naming a path that
 * does not exist is recorded as `present: false` so a later creation or
 * deletion is visible as drift, and any incomplete coverage is carried in
 * `gaps`.
 */
export function snapshotWorkspacePaths(workspace: string, patterns: readonly string[]): ArtifactSnapshot {
  const at = Date.now()
  const { artifacts, gaps } = readArtifactScope(workspace, patterns)
  return { at, artifacts, ...gaps.length === 0 ? {} : { gaps } }
}
