import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { projectRootOf } from '../lib/project-tools.js'

let passed = 0
function check(name, condition) {
  if (!condition) throw new Error('FAIL: ' + name)
  passed += 1
}
function rejects(name, fn) {
  try {
    fn()
  } catch {
    passed += 1
    console.log('PASS ' + name)
    return
  }
  throw new Error('FAIL: ' + name + ' was accepted')
}
function context(cwd) {
  return { agent: { session: { header: { cwd } } } }
}

const root = await mkdtemp(join(tmpdir(), 'dsh-project-root-boundary-'))
const workspace = join(root, 'workspace')
const sibling = join(root, 'sibling')
const child = join(workspace, 'nested')
await mkdir(workspace)
await mkdir(sibling)
await mkdir(child)

try {
  const workspaceCanonical = await realpath(workspace)
  const siblingName = basename(sibling)
  const workspaceContext = context(workspace)

  check('omitted project_root resolves to canonical session workspace', projectRootOf(undefined, workspaceContext) === workspaceCanonical)
  check('workspace root is accepted', projectRootOf(workspace, workspaceContext) === workspaceCanonical)
  check('existing descendant is accepted', projectRootOf(child, workspaceContext) === await realpath(child))
  rejects('sibling directory is rejected', () => projectRootOf(sibling, workspaceContext))
  rejects('parent directory is rejected', () => projectRootOf(root, workspaceContext))
  rejects('POSIX parent traversal is rejected', () => projectRootOf(workspace + '/../' + siblingName, workspaceContext))
  rejects('Windows parent traversal is rejected', () => projectRootOf(workspace + '\\..\\' + siblingName, workspaceContext))
  rejects('drive-relative path is rejected', () => projectRootOf('C:relative-project', workspaceContext))
  rejects('missing session workspace fails closed', () => projectRootOf(workspace, {}))
  rejects('empty session workspace fails closed', () => projectRootOf(workspace, context('')))

  if (process.platform === 'win32') {
    const driveCaseVariant = workspace.replace(/^([A-Za-z]):/u, (drive) => drive === drive.toUpperCase() ? drive.toLowerCase() : drive.toUpperCase())
    check('drive-letter case variant remains inside canonical workspace', projectRootOf(driveCaseVariant, workspaceContext) === workspaceCanonical)
    const siblingBackslashVariant = sibling.replaceAll('/', '\\')
    rejects('Windows separator absolute sibling is rejected', () => projectRootOf(siblingBackslashVariant, workspaceContext))
  } else {
    console.log('SKIP Windows drive/separator cases: host platform is ' + process.platform)
  }

  for (const [kind, linkType] of [['symlink', 'dir'], ['junction', 'junction']]) {
    if (kind === 'junction' && process.platform !== 'win32') {
      console.log('SKIP junction case: junctions are only supported on Windows')
      continue
    }
    const link = join(workspace, 'escape-' + kind)
    try {
      await symlink(sibling, link, linkType)
      rejects(kind + ' escape is rejected after canonicalization', () => projectRootOf(link, workspaceContext))
    } catch (error) {
      console.log('SKIP ' + kind + ' case: ' + String(error))
    } finally {
      await rm(link, { force: true, recursive: true }).catch(() => undefined)
    }
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('project-root-boundary-verify: ' + passed + ' assertions passed')
