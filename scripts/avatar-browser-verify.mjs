#!/usr/bin/env node
/** Real-browser acceptance for the authenticated ActivityPanel avatar upload. */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import { createTeamDir } from '../lib/state.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const fixture = join(root, 'assets', 'agent-teams', 'team-lead-v2.png')
const dshEntry = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const testHome = await mkdtemp(join(tmpdir(), 'dsh-avatar-browser-home-'))
const workspace = await mkdtemp(join(tmpdir(), 'dsh-avatar-browser-workspace-'))
const teamId = 'avatar-browser-acceptance'
let browser
let server
let serverOutput = ''

function redact(value) {
  return value.replace(/\?token=[^\s]+/gu, '?token=<redacted>')
}

function dshEnvironment() {
  return {
    ...process.env,
    DSH_HOME: testHome,
    // The adaptive host seam intentionally selects its browser interaction
    // for SSH launches, making this deterministic on local Windows and CI.
    SSH_CONNECTION: 'avatar-browser-e2e',
  }
}

function initializeProfile() {
  const args = ['--profile', 'web', '--dump-config']
  const result = spawnSync(process.execPath, [dshEntry, ...args], {
    cwd: root,
    env: dshEnvironment(),
    encoding: 'utf8',
    windowsHide: true,
  })
  assert.equal(result.status, 0, `failed to initialize DSH Web profile:\n${redact(result.stderr ?? '')}`)
}

async function linkCurrentPlugin() {
  const link = join(testHome, 'profiles', 'web', 'node_modules', '@nanmicoder', 'dsh-agent-teams')
  await mkdir(dirname(link), { recursive: true })
  await symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir')
}

function startServer() {
  server = spawn(process.execPath, [dshEntry,
    '--profile', 'web',
    '--patch', join(root, 'cordis.patch.yml'),
    '--no-open',
    '--host', '127.0.0.1',
    '--port', '0',
  ], {
    cwd: root,
    env: dshEnvironment(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.setEncoding('utf8')
  server.stderr.setEncoding('utf8')
  server.stdout.on('data', (chunk) => { serverOutput += chunk })
  server.stderr.on('data', (chunk) => { serverOutput += chunk })
}

async function waitForServerUrl() {
  const deadline = Date.now() + 30_000
  for (;;) {
    const match = serverOutput.match(/https?:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/u)
    if (match !== null) return match[0]
    if (server?.exitCode !== null) {
      throw new Error(`DSH Web exited before listening:\n${redact(serverOutput)}`)
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for DSH Web:\n${redact(serverOutput)}`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
}

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === '') continue
    try {
      await access(candidate)
      return candidate
    } catch {}
  }
  throw new Error('Chrome/Edge was not found; set CHROME_PATH to a Chromium-family browser executable')
}

async function browserExecutable() {
  const localAppData = process.env.LOCALAPPDATA
  return firstExecutable([
    process.env.CHROME_PATH,
    process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' : undefined,
    process.platform === 'win32' ? 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' : undefined,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : undefined,
    process.platform === 'win32' && localAppData !== undefined
      ? join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : undefined,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined,
    process.platform === 'darwin' ? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' : undefined,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ])
}

async function finishOnboarding(page) {
  const workspaceButton = page.getByRole('button', { name: /^(Add workspace|添加工作区)$/iu })
  const welcome = page.getByRole('button', { name: /^(Continue|继续)$/iu })
  const configureLater = page.getByRole('button', { name: /^(Configure later|稍后配置)$/iu })
  // The shell renders before persisted settings arrive, so let the optional
  // welcome/API-key modals mount before treating the visible shell as ready.
  await page.waitForTimeout(1_000)
  for (let attempts = 0; attempts < 40; attempts += 1) {
    if (await welcome.isVisible().catch(() => false)) {
      if (await welcome.isEnabled({ timeout: 250 }).catch(() => false)) await welcome.click()
      await page.waitForTimeout(250)
      continue
    }
    if (await configureLater.isVisible().catch(() => false)) {
      await configureLater.click()
      continue
    }
    if (await workspaceButton.isVisible().catch(() => false)) return workspaceButton
    await page.waitForTimeout(250)
  }
  throw new Error(`could not finish DSH onboarding:\n${(await page.locator('body').innerText()).slice(0, 2_000)}`)
}

async function addWorkspace(page, workspaceButton) {
  await workspaceButton.click()
  const editPath = page.getByRole('button', { name: /Edit path|编辑路径/iu })
  await editPath.waitFor({ state: 'visible', timeout: 10_000 })
  await editPath.click()
  const pathInput = page.getByRole('textbox', { name: /Edit path|编辑路径/iu })
  await pathInput.fill(workspace)
  await pathInput.press('Enter')
  const open = page.getByRole('button', { name: /^(Open|打开)$/iu })
  await open.waitFor({ state: 'visible', timeout: 10_000 })
  await assertEventually(async () => await open.isEnabled(), 'workspace Open button stayed disabled')
  await open.click()
}

async function assertEventually(operation, message, timeout = 10_000) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      if (await operation()) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`${message}${lastError === undefined ? '' : `: ${String(lastError)}`}`)
}

async function createdSessionId() {
  const registryPath = join(testHome, 'storages', 'workspace.json')
  let result
  await assertEventually(async () => {
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    const workspaces = Object.values(registry.tables?.workspaces ?? {})
    result = workspaces.find((entry) => entry.path === workspace)?.sessionIds?.[0]
    return typeof result === 'string' && result !== ''
  }, 'workspace registry did not create a blank session')
  return result
}

async function persistFixtureSession(sessionId) {
  const path = join(testHome, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
  const snapshot = JSON.parse(await readFile(path, 'utf8'))
  snapshot.record.rows.title.val = 'Avatar Browser Acceptance'
  snapshot.record.rows.sessionListMetadata.val = {
    blank: false,
    lastPromptAt: Date.now(),
  }
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
}

async function seedTeam(sessionId) {
  const now = Date.now()
  await createTeamDir(join(workspace, '.agent-teams'), {
    name: 'Avatar Browser Acceptance',
    id: teamId,
    captainSessionId: sessionId,
    createdAt: now,
    members: [{
      id: 'avatar-browser-member',
      name: 'alice',
      role: 'researcher',
      joinedAt: now,
      status: 'idle',
    }],
    tasks: [],
    taskSeq: 0,
  })
}

async function waitForTeamPanel(page) {
  await assertEventually(async () => {
    const state = await page.evaluate(async (expectedTeamId) => {
      const response = await fetch('/plugins/dsh-agent-teams/state', { cache: 'no-store' })
      if (!response.ok) return { status: response.status, found: false }
      const body = await response.json()
      return {
        status: response.status,
        found: Array.isArray(body.teams) && body.teams.some((team) => team.teamId === expectedTeamId),
      }
    }, teamId)
    return state.status === 200 && state.found
  }, 'authenticated state route did not project the seeded team', 15_000)

  const panel = page.getByRole('complementary', { name: /AgentTeams/iu })
  if (!await panel.isVisible().catch(() => false)) {
    const blankSession = page.getByRole('treeitem', {
      name: /Avatar Browser Acceptance|New (?:session|chat)|新会话/iu,
    }).last()
    if (await blankSession.isVisible().catch(() => false)) await blankSession.click()
  }
  const collapsed = page.locator('button[data-agent-teams-collapsed]')
  await assertEventually(
    async () => await panel.isVisible().catch(() => false) || await collapsed.isVisible().catch(() => false),
    'neither the AgentTeams panel nor its collapsed badge appeared',
    30_000,
  )
  if (await collapsed.isVisible().catch(() => false)) await collapsed.click()
  try {
    await panel.waitFor({ state: 'visible', timeout: 30_000 })
  } catch (error) {
    const rows = await page.getByRole('treeitem').allTextContents()
    const body = (await page.locator('body').innerText()).slice(0, 2_000)
    throw new Error(`team panel did not mount: ${String(error)}\ntreeitems=${JSON.stringify(rows)}\n${body}`)
  }
  return panel
}

function digest(data) {
  return createHash('sha256').update(data).digest('hex')
}

async function terminateServer() {
  if (server === undefined || server.exitCode !== null) return
  server.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveExit) => server.once('exit', resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ])
  if (server.exitCode === null) server.kill('SIGKILL')
}

try {
  initializeProfile()
  await linkCurrentPlugin()
  startServer()
  const authenticatedUrl = await waitForServerUrl()
  const base = new URL(authenticatedUrl)
  base.search = ''

  const unauthenticated = await fetch(new URL('/plugins/dsh-agent-teams/state', base), { redirect: 'manual' })
  assert.equal(unauthenticated.status, 401, 'avatar browser surface must retain Web authentication')

  browser = await chromium.launch({
    executablePath: await browserExecutable(),
    headless: true,
    args: ['--disable-gpu', '--no-sandbox'],
  })
  const context = await browser.newContext({ locale: 'en-US' })
  const page = await context.newPage()
  await page.goto(authenticatedUrl, { waitUntil: 'domcontentloaded' })
  const workspaceButton = await finishOnboarding(page)
  await addWorkspace(page, workspaceButton)
  const sessionId = await createdSessionId()
  await seedTeam(sessionId)

  const panel = await waitForTeamPanel(page)
  await panel.getByRole('button', { name: /^(Avatar|头像)$/iu }).click()
  const editor = panel.locator('[data-avatar-editor]')
  await editor.waitFor({ state: 'visible' })

  const chooserPromise = page.waitForEvent('filechooser')
  await editor.locator('input[type="file"]').click({ force: true })
  const chooser = await chooserPromise
  await chooser.setFiles(fixture)
  await editor.locator('[data-kind="success"]').waitFor({ state: 'visible', timeout: 10_000 })

  const statePath = join(workspace, '.agent-teams', teamId, 'team.json')
  let managedName
  await assertEventually(async () => {
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    if (!state.captainAvatar?.startsWith('managed:')) return false
    managedName = state.captainAvatar.slice('managed:'.length)
    return true
  }, 'upload did not persist a managed avatar reference')
  assert.match(managedName, /^[0-9a-f-]+\.(?:png|jpg|webp)$/u)

  const stored = await readFile(join(workspace, '.agent-teams', teamId, 'avatars', managedName))
  const source = await readFile(fixture)
  assert.equal(digest(stored), digest(source), 'stored avatar bytes differ from the selected browser file')

  const avatar = panel.locator(`section[data-team-id="${teamId}"] img[src*="avatar-file"]`).first()
  await avatar.waitFor({ state: 'visible', timeout: 10_000 })
  const rendered = await avatar.evaluate((image) => ({
    complete: image.complete,
    width: image.naturalWidth,
    height: image.naturalHeight,
    src: image.getAttribute('src'),
  }))
  assert.deepEqual(
    { complete: rendered.complete, width: rendered.width, height: rendered.height },
    { complete: true, width: 256, height: 256 },
    'browser did not decode the uploaded avatar',
  )
  assert.match(rendered.src ?? '', /\/plugins\/dsh-agent-teams\/avatar-file\?/u)

  // Restart the real host so both the session and avatar are reconstructed
  // from disk rather than retained client or service memory.
  await terminateServer()
  await persistFixtureSession(sessionId)
  serverOutput = ''
  startServer()
  const restoredAuthenticatedUrl = await waitForServerUrl()
  await page.goto(restoredAuthenticatedUrl, { waitUntil: 'domcontentloaded' })
  await finishOnboarding(page)
  await waitForTeamPanel(page)
  const restored = page.locator(`section[data-team-id="${teamId}"] img[src*="${managedName}"]`).first()
  try {
    await restored.waitFor({ state: 'visible', timeout: 15_000 })
  } catch (error) {
    const images = await page.locator('img').evaluateAll((elements) => elements.map((image) => image.getAttribute('src')))
    const body = (await page.locator('body').innerText()).slice(0, 2_000)
    throw new Error(`avatar was not restored after reload: ${String(error)}\nimages=${JSON.stringify(images)}\n${body}`)
  }
  const restoredSize = await restored.evaluate((image) => [image.naturalWidth, image.naturalHeight])
  assert.deepEqual(restoredSize, [256, 256], 'avatar did not survive a full browser reload')

  console.log('avatar browser verification passed')
  console.log(`  authenticated route: 401 without cookie, accepted with browser token`)
  console.log(`  upload: managed:${managedName} (${stored.length} bytes, sha256 ${digest(stored)})`)
  console.log('  render: 256x256 before and after host restart/browser reload')
} catch (error) {
  console.error(error)
  if (serverOutput !== '') console.error(`DSH output:\n${redact(serverOutput)}`)
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  await terminateServer()
  await rm(testHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
