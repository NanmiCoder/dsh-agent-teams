#!/usr/bin/env node
/** Focused security and compatibility verification for custom avatars. */

import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  AvatarHttpError,
  createAvatarService,
  DEFAULT_AVATAR_MAX_BYTES,
  fetchRemoteAvatar,
  isPrivateAddress,
  managedAvatarPath,
  normalizeRemoteAvatarUrl,
  resolvePublicRemote,
  validateAvatarFilename,
  validateAvatarImage,
} from '../lib/avatar.js'
import { captainArtCandidates, memberArtCandidates } from '../lib/client/artwork.js'
import { collectTeamsActivity } from '../lib/snapshot.js'
import { createTeamDir, readTeam } from '../lib/state.js'

const failures = []
function check(label, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL'
  console.log(`  ${status}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

function rejectsAvatar(operation, status) {
  try {
    operation()
    return false
  } catch (error) {
    return error instanceof AvatarHttpError && error.status === status
  }
}

async function rejectsAvatarAsync(operation, status) {
  try {
    await operation()
    return false
  } catch (error) {
    return error instanceof AvatarHttpError && error.status === status
  }
}

function remoteResponse(statusCode, headers = {}, body = Buffer.alloc(0)) {
  const response = Readable.from(body.length === 0 ? [] : [body])
  response.statusCode = statusCode
  response.headers = headers
  return response
}

console.log('dsh-agent-teams avatar verification')

const png = await readFile(new URL('../assets/agent-teams/team-lead-v2.png', import.meta.url))
const pngType = validateAvatarImage(png, 'image/png')
check('valid PNG signature and MIME are accepted', pngType.contentType === 'image/png')
check('non-image MIME is rejected', rejectsAvatar(() => validateAvatarImage(png, 'text/plain'), 415))
check('MIME/signature mismatch is rejected', rejectsAvatar(() => validateAvatarImage(png, 'image/jpeg'), 415))
check('oversized image is rejected', rejectsAvatar(() => {
  const oversized = Buffer.alloc(DEFAULT_AVATAR_MAX_BYTES + 1)
  png.copy(oversized, 0, 0, 16)
  validateAvatarImage(oversized, 'image/png')
}, 413))
check('safe filename is accepted', (() => {
  validateAvatarFilename(encodeURIComponent('鲸鱼.png'), pngType)
  return true
})())
check('path-traversal filename is rejected', rejectsAvatar(() => {
  validateAvatarFilename(encodeURIComponent('../../captain.png'), pngType)
}, 400))
check('Windows path-traversal filename is rejected', rejectsAvatar(() => {
  validateAvatarFilename(encodeURIComponent('..\\captain.png'), pngType)
}, 400))
check('managed path rejects attacker-controlled segments', rejectsAvatar(() => {
  managedAvatarPath('C:\\safe', 'team', '../../captain.png')
}, 404))
check('HTTP(S) URL is canonicalized', normalizeRemoteAvatarUrl('https://example.com/a.png#x') === 'https://example.com/a.png')
check('file URL is rejected', rejectsAvatar(() => normalizeRemoteAvatarUrl('file:///etc/passwd'), 400))
check('credential-bearing URL is rejected', rejectsAvatar(() => normalizeRemoteAvatarUrl('https://user:pass@example.com/a.png'), 400))

check('private IPv4 ranges are rejected', [
  '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1', '192.168.1.1',
  '192.88.99.1',
].every(isPrivateAddress))
check('public IPv4 addresses and IANA anycast exceptions remain eligible', [
  '93.184.216.34', '192.0.0.9', '192.0.0.10',
].every((address) => !isPrivateAddress(address)))
check('private IPv6 ranges are rejected', [
  '::', '::1', '::192.168.1.1', '64:ff9b:1::7f00:1', '100::1', '100:0:0:1::1',
  '2001:2::1', '2001:10::1', '2001:db8::1', '2002::1', '3fff::1', '5f00::1',
  'fc00::1', 'fec0::1', 'fe80::1', 'ff02::1',
].every(isPrivateAddress))
check('IPv4-mapped IPv6 cannot bypass private IPv4 validation', [
  '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1',
].every(isPrivateAddress))
check('well-known NAT64 cannot translate to a private IPv4 destination', [
  '64:ff9b::127.0.0.1', '64:ff9b::7f00:1', '64:ff9b::192.168.1.1',
].every(isPrivateAddress))
check('public IPv6 and IANA special-purpose exceptions remain eligible', [
  '2606:4700:4700::1111', '64:ff9b::5db8:d822', '2001:1::1', '2001:3::1',
  '2001:4:112::1', '2001:20::1', '2001:30::1',
].every((address) => !isPrivateAddress(address)))

let literalDnsCalls = 0
const rejectUnexpectedDns = async () => {
  literalDnsCalls += 1
  throw new Error('literal IP must not use DNS')
}
const literalV4 = await resolvePublicRemote(new URL('https://93.184.216.34/a.png'), rejectUnexpectedDns)
const literalV6 = await resolvePublicRemote(new URL('https://[2606:4700:4700::1111]/a.png'), rejectUnexpectedDns)
check('public IPv4 and IPv6 literals bypass DNS but remain pinned',
  literalDnsCalls === 0 && literalV4.family === 4 && literalV6.family === 6)
check('private IPv6 literals are rejected before any request', await rejectsAvatarAsync(
  () => resolvePublicRemote(new URL('https://[::1]/a.png'), rejectUnexpectedDns),
  403,
))
const specialIpv6 = ['fec0::1', '64:ff9b:1::7f00:1', '100::1', '2001:2::1']
check('non-public special-purpose IPv6 literals are rejected before any request', (await Promise.all(
  specialIpv6.map((address) => rejectsAvatarAsync(
    () => resolvePublicRemote(new URL(`https://[${address}]/a.png`), rejectUnexpectedDns),
    403,
  )),
)).every(Boolean))
check('non-public special-purpose IPv6 DNS answers reject the entire hostname', (await Promise.all(
  specialIpv6.map((address) => rejectsAvatarAsync(
    () => resolvePublicRemote(new URL('https://special.example/a.png'), async () => [{ address, family: 6 }]),
    403,
  )),
)).every(Boolean))
check('mixed public/private DNS answers reject the entire hostname', await rejectsAvatarAsync(
  () => resolvePublicRemote(new URL('https://mixed.example/a.png'), async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ]),
  403,
))
check('DNS lookup failures are reported as a proxy failure', await rejectsAvatarAsync(
  () => resolvePublicRemote(new URL('https://missing.example/a.png'), async () => { throw new Error('NXDOMAIN') }),
  502,
))

const redirectDnsCalls = []
const redirectRequests = []
const redirected = await fetchRemoteAvatar(
  'https://redirect.example/avatar',
  DEFAULT_AVATAR_MAX_BYTES,
  async (hostname) => {
    redirectDnsCalls.push(hostname)
    return hostname === 'redirect.example'
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '2606:4700:4700::1111', family: 6 }]
  },
  async (url, pinned) => {
    redirectRequests.push({ hostname: url.hostname, pinned })
    return url.hostname === 'redirect.example'
      ? remoteResponse(302, { location: 'https://images.example/avatar.png' })
      : remoteResponse(200, { 'content-type': 'image/png', 'content-length': String(png.length) }, png)
  },
)
check('redirects re-run DNS validation and pin each IPv4/IPv6 hop',
  redirected.type.contentType === 'image/png'
    && redirectDnsCalls.join(',') === 'redirect.example,images.example'
    && redirectRequests[0]?.pinned.family === 4
    && redirectRequests[1]?.pinned.family === 6)

let privateRedirectRequests = 0
const privateRedirectRejected = await rejectsAvatarAsync(() => fetchRemoteAvatar(
  'https://redirect.example/avatar',
  DEFAULT_AVATAR_MAX_BYTES,
  async (hostname) => hostname === 'redirect.example'
    ? [{ address: '93.184.216.34', family: 4 }]
    : [{ address: '127.0.0.1', family: 4 }],
  async () => {
    privateRedirectRequests += 1
    return remoteResponse(302, { location: 'http://private.example/avatar.png' })
  },
), 403)
check('redirects to a private DNS result are rejected before the next request',
  privateRedirectRejected && privateRedirectRequests === 1)

let specialIpv6RedirectRequests = 0
const specialIpv6RedirectRejected = await rejectsAvatarAsync(() => fetchRemoteAvatar(
  'https://redirect.example/avatar',
  DEFAULT_AVATAR_MAX_BYTES,
  async (hostname) => hostname === 'redirect.example'
    ? [{ address: '93.184.216.34', family: 4 }]
    : [{ address: '64:ff9b:1::7f00:1', family: 6 }],
  async () => {
    specialIpv6RedirectRequests += 1
    return remoteResponse(302, { location: 'https://special.example/avatar.png' })
  },
), 403)
check('redirects to a non-public special-purpose IPv6 result are rejected before the next request',
  specialIpv6RedirectRejected && specialIpv6RedirectRequests === 1)

let redirectLimitRequests = 0
const redirectLimitRejected = await rejectsAvatarAsync(() => fetchRemoteAvatar(
  'https://redirect.example/avatar',
  DEFAULT_AVATAR_MAX_BYTES,
  async () => [{ address: '93.184.216.34', family: 4 }],
  async () => {
    redirectLimitRequests += 1
    return remoteResponse(302, { location: '/again' })
  },
), 502)
check('remote proxy caps redirect hops', redirectLimitRejected && redirectLimitRequests === 4)

check('remote proxy rejects a declared oversized response before buffering', await rejectsAvatarAsync(
  () => fetchRemoteAvatar(
    'https://images.example/avatar.png',
    64,
    async () => [{ address: '93.184.216.34', family: 4 }],
    async () => remoteResponse(200, { 'content-type': 'image/png', 'content-length': '65' }),
  ),
  413,
))
check('remote proxy enforces the size limit on streamed bodies without content-length', await rejectsAvatarAsync(
  () => fetchRemoteAvatar(
    'https://images.example/avatar.png',
    64,
    async () => [{ address: '93.184.216.34', family: 4 }],
    async () => remoteResponse(200, { 'content-type': 'image/png' }, Buffer.alloc(65)),
  ),
  413,
))

const custom = '/plugins/dsh-agent-teams/avatar-file?x=1'
const override = '/plugins/dsh-agent-teams/avatar-proxy?x=2'
check('member custom avatar outranks role mapping', memberArtCandidates('alice', 'researcher', custom, { researcher: override })[0] === custom)
check('role override outranks packaged artwork', memberArtCandidates('alice', 'researcher', undefined, { researcher: override })[0] === override)
check('unconfigured role retains packaged artwork', memberArtCandidates('alice', 'researcher')[0]?.endsWith('member-researcher-v2.png') === true)
check('unmatched role retains initial fallback', memberArtCandidates('alice', 'arbiter').length === 0)
check('captain team override outranks configured and packaged artwork', captainArtCandidates(custom, override)[0] === custom)

const workspace = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-avatar-'))
const stateRoot = join(workspace, '.agent-teams')
const team = {
  name: 'Avatar Team',
  id: 'avatar-team',
  captainSessionId: 'captain-session',
  createdAt: Date.now(),
  members: [{ id: 'member-session', name: 'alice', role: 'researcher', joinedAt: Date.now(), status: 'idle' }],
  tasks: [],
  taskSeq: 0,
}
const routes = new Map()
const routeHost = {
  register(route) {
    routes.set(route.path, route.handler)
    return () => { routes.delete(route.path) }
  },
}
const ctx = { logger: { warn() {}, debug() {} }, agents: { get() { return undefined } } }
const workspaceRegistry = { list: () => [{ path: workspace, title: 'Avatar Test' }] }
let server
try {
  // This intentionally starts from a legacy state shape with no avatar fields.
  await createTeamDir(stateRoot, team)
  check('legacy team.json without avatar fields still loads', (await readTeam(stateRoot, team.id))?.members[0]?.avatar === undefined)
  const legacySnapshot = (await collectTeamsActivity(ctx, [{ workspace: 'Avatar Test', stateRoot }]))[0]
  check('legacy state without avatar fields still projects for the current UI',
    legacySnapshot?.captainAvatarUrl === undefined && legacySnapshot?.members[0]?.avatarUrl === undefined)

  const service = createAvatarService(ctx, workspaceRegistry, {
    stateDir: '.agent-teams',
    captainAvatar: '',
    roleAvatars: {},
    maxUploadBytes: DEFAULT_AVATAR_MAX_BYTES,
  })
  service.register(routeHost)
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    const handler = routes.get(path)
    if (handler === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    void Promise.resolve(handler(req, res)).catch((error) => {
      res.writeHead(500)
      res.end(String(error))
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('test server did not expose an address')
  const base = `http://127.0.0.1:${address.port}`
  const token = service.editToken(stateRoot, team)
  const query = new URLSearchParams({
    team_id: team.id,
    captain_session_id: team.captainSessionId,
    target: 'captain',
  })
  const headers = {
    'x-agent-teams-request': 'avatar-v1',
    'x-agent-teams-avatar-token': token,
  }
  const upload = await fetch(`${base}/plugins/dsh-agent-teams/avatar?${query}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'image/png', 'x-agent-teams-file-name': encodeURIComponent('captain.png') },
    body: png,
  })
  const uploadBody = await upload.json()
  const uploadedState = await readTeam(stateRoot, team.id)
  check('valid upload endpoint stores only a managed reference', upload.ok && uploadedState?.captainAvatar?.startsWith('managed:') === true)
  check('managed upload never serializes image bytes', JSON.stringify(uploadedState).length < 4096)
  const storedFilename = uploadedState?.captainAvatar?.slice('managed:'.length) ?? ''
  check('managed upload file exists below the team directory', (await stat(managedAvatarPath(stateRoot, team.id, storedFilename))).isFile())
  const served = await fetch(`${base}${uploadBody.avatarUrl}`)
  check('managed avatar is served with a locked image MIME', served.ok && served.headers.get('content-type') === 'image/png')
  const uploadedSnapshot = (await collectTeamsActivity(ctx, [{ workspace: 'Avatar Test', stateRoot }], {
    avatarUrl: service.publicUrl,
    avatarEditToken: service.editToken,
  }))[0]
  check('live snapshot projects captain URL and edit capability for both UIs',
    uploadedSnapshot?.captainAvatarUrl === uploadBody.avatarUrl
      && typeof uploadedSnapshot.avatarEditToken === 'string')

  const badMime = await fetch(`${base}/plugins/dsh-agent-teams/avatar?${query}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'text/plain', 'x-agent-teams-file-name': encodeURIComponent('captain.png') },
    body: png,
  })
  check('upload endpoint rejects non-image MIME', badMime.status === 415)
  const badName = await fetch(`${base}/plugins/dsh-agent-teams/avatar?${query}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'image/png', 'x-agent-teams-file-name': encodeURIComponent('../../captain.png') },
    body: png,
  })
  check('upload endpoint rejects malicious filename', badName.status === 400)
  const tooLarge = Buffer.alloc(DEFAULT_AVATAR_MAX_BYTES + 1)
  png.copy(tooLarge, 0, 0, 16)
  const oversized = await fetch(`${base}/plugins/dsh-agent-teams/avatar?${query}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'image/png', 'x-agent-teams-file-name': encodeURIComponent('large.png') },
    body: tooLarge,
  })
  check('upload endpoint rejects oversized body', oversized.status === 413)
  const missingMarker = await fetch(`${base}/plugins/dsh-agent-teams/avatar?${query}`, {
    method: 'DELETE',
    headers: { 'x-agent-teams-avatar-token': token },
  })
  check('mutation endpoint rejects missing CSRF marker', missingMarker.status === 403)

  const memberQuery = new URLSearchParams({
    team_id: team.id,
    captain_session_id: team.captainSessionId,
    target: 'member',
    member: 'alice',
  })
  const remoteUrl = 'https://example.com/alice.webp'
  const setMember = await fetch(`${base}/plugins/dsh-agent-teams/avatar?${memberQuery}`, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ url: remoteUrl }),
  })
  check('URL endpoint persists member-specific URL', setMember.ok && (await readTeam(stateRoot, team.id))?.members[0]?.avatar === remoteUrl)
  const memberSnapshot = (await collectTeamsActivity(ctx, [{ workspace: 'Avatar Test', stateRoot }], {
    avatarUrl: service.publicUrl,
    avatarEditToken: service.editToken,
  }))[0]
  check('live snapshot projects member override ahead of role fallback',
    memberSnapshot?.members[0]?.avatarUrl?.startsWith('/plugins/dsh-agent-teams/avatar-proxy?') === true
      && memberArtCandidates('alice', 'researcher', memberSnapshot.members[0].avatarUrl)[0]
        === memberSnapshot.members[0].avatarUrl)
  const privateProxyStatuses = await Promise.all([
    `${base}/secret.png`,
    'http://[::1]/secret.png',
    'http://[::ffff:7f00:1]/secret.png',
  ].map(async (url) => (await fetch(`${base}/plugins/dsh-agent-teams/avatar-proxy?url=${encodeURIComponent(url)}`)).status))
  check('remote proxy rejects IPv4, IPv6, and mapped-IPv4 loopback targets',
    privateProxyStatuses.every((status) => status === 403))

  const cleared = await fetch(`${base}/plugins/dsh-agent-teams/avatar?${query}`, { method: 'DELETE', headers })
  check('captain override can be cleared to default', cleared.ok && (await readTeam(stateRoot, team.id))?.captainAvatar === undefined)
} finally {
  if (server !== undefined) await new Promise((resolve) => { server.close(resolve) })
  await rm(workspace, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n${failures.length} avatar check(s) FAILED: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nall avatar checks passed')
