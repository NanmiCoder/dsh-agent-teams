/**
 * Secure avatar storage, projection, and Web routes.
 *
 * Durable team records keep only a remote URL or a short `managed:` file
 * reference. Browser-facing URLs are always same-origin: managed files are
 * served from the owning team directory, while remote images pass through a
 * bounded, type-checked proxy so Electron CSP never needs an external origin.
 * @module dsh-agent-teams/avatar
 */

import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, SocketAddress } from 'node:net'
import { dirname, extname, join, resolve } from 'node:path'
import { readTeam, sanitizeKey, withTeamLock, writeTeam } from './state.ts'
import type { TeamMember, TeamState } from './types.ts'

/** Default and absolute upper bound for one avatar payload (2 MiB). */
export const DEFAULT_AVATAR_MAX_BYTES = 2 * 1024 * 1024
/** JSON metadata is intentionally tiny and never carries image bytes. */
const MAX_AVATAR_JSON_BYTES = 8 * 1024
const MAX_AVATAR_URL_LENGTH = 2048
const MAX_REDIRECTS = 3
const REMOTE_TIMEOUT_MS = 10_000
const MANAGED_PREFIX = 'managed:'
const AVATAR_DIR = 'avatars'
const AVATAR_BASE = '/plugins/dsh-agent-teams'

/** Configurable role-to-image override after host-side URL projection. */
export interface PublicAvatarArtwork {
  readonly captainAvatarUrl?: string
  readonly roleAvatars: Readonly<Record<string, string>>
  readonly maxUploadBytes: number
}

/** Snapshot-side avatar projection context. */
export interface AvatarProjectionContext {
  readonly stateRoot: string
  readonly teamId: string
  readonly historic: boolean
}

/** Minimal Web route registration shape used by DSH host webserver builds. */
export interface AvatarRouteHost {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Runtime configuration owned by the avatar service. */
export interface AvatarServiceOptions {
  readonly stateDir: string
  readonly captainAvatar: string
  readonly roleAvatars: Readonly<Record<string, string>>
  readonly maxUploadBytes: number
}

/** Avatar Web surface plus helpers consumed by the state snapshot route. */
export interface AvatarService {
  readonly artwork: PublicAvatarArtwork
  publicUrl(source: string, context: AvatarProjectionContext): string | undefined
  editToken(stateRoot: string, team: TeamState): string
  register(webServer: AvatarRouteHost): Array<() => void>
}

/** HTTP-shaped validation failure with a safe client-facing message. */
export class AvatarHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'AvatarHttpError'
  }
}

interface AvatarImageType {
  readonly contentType: 'image/png' | 'image/jpeg' | 'image/webp'
  readonly extension: 'png' | 'jpg' | 'webp'
}

interface EditableTeam {
  readonly stateRoot: string
  readonly state: TeamState
}

interface AvatarMutationTarget {
  readonly teamId: string
  readonly captainSessionId: string
  readonly target: 'captain' | 'member'
  readonly memberName?: string
}

/** DNS result used by the proxy's address validator. */
export interface AvatarResolvedAddress {
  readonly address: string
  readonly family: number
}

/** Resolver seam used by focused network-boundary verification. */
export type AvatarDnsResolver = (hostname: string) => Promise<readonly AvatarResolvedAddress[]>

/** Request seam used to verify redirect validation without reaching the network. */
export type AvatarPinnedRequester = (
  url: URL,
  pinned: { readonly address: string; readonly family: 4 | 6 },
) => Promise<IncomingMessage>

const PRIVATE_ADDRESSES = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) PRIVATE_ADDRESSES.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['2001:db8::', 32],
] as const) PRIVATE_ADDRESSES.addSubnet(network, prefix, 'ipv6')

/** Parse and canonicalize one user-provided remote avatar URL. */
export function normalizeRemoteAvatarUrl(input: string): string {
  const source = input.trim()
  if (source === '') throw new AvatarHttpError(400, 'avatar URL must not be empty')
  if (source.length > MAX_AVATAR_URL_LENGTH) throw new AvatarHttpError(400, 'avatar URL is too long')
  let url: URL
  try {
    url = new URL(source)
  } catch {
    throw new AvatarHttpError(400, 'avatar URL is invalid')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AvatarHttpError(400, 'avatar URL must use http or https')
  }
  if (url.username !== '' || url.password !== '') {
    throw new AvatarHttpError(400, 'avatar URL must not contain credentials')
  }
  url.hash = ''
  return url.toString()
}

/** Recognize PNG, JPEG, or WebP from the file signature, never the filename. */
export function detectAvatarImageType(data: Uint8Array): AvatarImageType | undefined {
  if (data.length >= 8
    && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) {
    return { contentType: 'image/png', extension: 'png' }
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' }
  }
  if (data.length >= 12
    && String.fromCharCode(...data.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...data.subarray(8, 12)) === 'WEBP') {
    return { contentType: 'image/webp', extension: 'webp' }
  }
  return undefined
}

function declaredAvatarType(value: string | undefined): AvatarImageType | undefined {
  const mime = value?.split(';', 1)[0]?.trim().toLowerCase()
  if (mime === 'image/png') return { contentType: mime, extension: 'png' }
  if (mime === 'image/jpeg') return { contentType: mime, extension: 'jpg' }
  if (mime === 'image/webp') return { contentType: mime, extension: 'webp' }
  return undefined
}

/** Enforce the declared type, payload limit, and signature as one boundary. */
export function validateAvatarImage(
  data: Uint8Array,
  contentType: string | undefined,
  maxBytes = DEFAULT_AVATAR_MAX_BYTES,
): AvatarImageType {
  if (data.length === 0) throw new AvatarHttpError(400, 'avatar file is empty')
  if (data.length > maxBytes) throw new AvatarHttpError(413, `avatar exceeds the ${maxBytes}-byte limit`)
  const declared = declaredAvatarType(contentType)
  if (declared === undefined) throw new AvatarHttpError(415, 'avatar must be PNG, JPEG, or WebP')
  const detected = detectAvatarImageType(data)
  if (detected === undefined || detected.contentType !== declared.contentType) {
    throw new AvatarHttpError(415, 'avatar content does not match its declared image type')
  }
  return detected
}

/**
 * Validate a browser filename for diagnostics only. Storage always uses a
 * generated UUID, but rejecting traversal-shaped names keeps the upload
 * boundary explicit and testable.
 */
export function validateAvatarFilename(encodedName: string | undefined, type: AvatarImageType): void {
  if (encodedName === undefined || encodedName === '') throw new AvatarHttpError(400, 'avatar filename is missing')
  let name: string
  try {
    name = decodeURIComponent(encodedName)
  } catch {
    throw new AvatarHttpError(400, 'avatar filename is invalid')
  }
  if (name.length > 128 || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new AvatarHttpError(400, 'avatar filename must be one safe path segment')
  }
  const extension = extname(name).slice(1).toLowerCase()
  const accepted = type.extension === 'jpg' ? extension === 'jpg' || extension === 'jpeg' : extension === type.extension
  if (!accepted) throw new AvatarHttpError(400, 'avatar filename extension does not match its image type')
}

/** Read a request stream while enforcing the limit before buffering fully. */
export async function readLimitedBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const header = req.headers['content-length']
  if (header !== undefined) {
    const declared = Number(Array.isArray(header) ? header[0] : header)
    if (!Number.isSafeInteger(declared) || declared < 0) throw new AvatarHttpError(400, 'invalid content-length')
    if (declared > maxBytes) throw new AvatarHttpError(413, `avatar exceeds the ${maxBytes}-byte limit`)
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    total += data.length
    if (total > maxBytes) throw new AvatarHttpError(413, `avatar exceeds the ${maxBytes}-byte limit`)
    chunks.push(data)
  }
  return Buffer.concat(chunks, total)
}

/** Resolve one generated managed filename without allowing path traversal. */
export function managedAvatarPath(stateRoot: string, teamId: string, filename: string): string {
  if (!/^[0-9a-f-]{36}\.(?:png|jpg|webp)$/u.test(filename)) {
    throw new AvatarHttpError(404, 'avatar file was not found')
  }
  const directory = resolve(stateRoot, teamId, AVATAR_DIR)
  const target = resolve(directory, filename)
  if (dirname(target) !== directory) throw new AvatarHttpError(404, 'avatar file was not found')
  return target
}

/** Store validated bytes below the team's avatar directory. */
export async function storeManagedAvatar(
  stateRoot: string,
  teamId: string,
  data: Uint8Array,
  contentType: string | undefined,
  encodedFilename: string | undefined,
  maxBytes = DEFAULT_AVATAR_MAX_BYTES,
): Promise<string> {
  const type = validateAvatarImage(data, contentType, maxBytes)
  validateAvatarFilename(encodedFilename, type)
  const filename = `${randomUUID()}.${type.extension}`
  const target = managedAvatarPath(stateRoot, teamId, filename)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, data, { flag: 'wx' })
  return `${MANAGED_PREFIX}${filename}`
}

function managedFilename(source: string | undefined): string | undefined {
  if (source?.startsWith(MANAGED_PREFIX) !== true) return undefined
  const filename = source.slice(MANAGED_PREFIX.length)
  return /^[0-9a-f-]{36}\.(?:png|jpg|webp)$/u.test(filename) ? filename : undefined
}

function workspaceKey(stateRoot: string): string {
  return createHash('sha256').update(resolve(stateRoot)).digest('hex').slice(0, 24)
}

function publicConfiguredUrl(source: string): string | undefined {
  const value = source.trim()
  if (value === '') return undefined
  if (value.startsWith('/') && !value.startsWith('//')) return value
  try {
    return `${AVATAR_BASE}/avatar-proxy?url=${encodeURIComponent(normalizeRemoteAvatarUrl(value))}`
  } catch {
    return undefined
  }
}

function contentTypeForFilename(filename: string): string {
  if (filename.endsWith('.png')) return 'image/png'
  if (filename.endsWith('.jpg')) return 'image/jpeg'
  return 'image/webp'
}

/** Reject non-IP and non-public IPv4/IPv6 destinations, including mapped IPv4. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return PRIVATE_ADDRESSES.check(address, 'ipv4')
  if (family === 6) {
    const normalized = SocketAddress.parse(`[${address}]:0`)?.address.toLowerCase() ?? address.toLowerCase()
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1]
    return mapped !== undefined ? PRIVATE_ADDRESSES.check(mapped, 'ipv4') : PRIVATE_ADDRESSES.check(address, 'ipv6')
  }
  return true
}

const systemDnsResolver: AvatarDnsResolver = async (hostname) => lookup(hostname, { all: true, verbatim: true })

/** Resolve every DNS answer and reject the host if any answer is not public. */
export async function resolvePublicRemote(
  url: URL,
  resolveHost: AvatarDnsResolver = systemDnsResolver,
): Promise<{ address: string; family: 4 | 6 }> {
  const hostname = url.hostname.replace(/^\[|\]$/gu, '')
  const literalFamily = isIP(hostname)
  if (literalFamily !== 0) {
    if (isPrivateAddress(hostname)) throw new AvatarHttpError(403, 'private-network avatar URLs are not allowed')
    return { address: hostname, family: literalFamily === 4 ? 4 : 6 }
  }
  let addresses: readonly AvatarResolvedAddress[]
  try {
    addresses = await resolveHost(hostname)
  } catch {
    throw new AvatarHttpError(502, 'avatar host could not be resolved')
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new AvatarHttpError(403, 'private-network avatar URLs are not allowed')
  }
  const selected = addresses[0]!
  if (selected.family !== 4 && selected.family !== 6) throw new AvatarHttpError(502, 'avatar host resolved to an unsupported address')
  return { address: selected.address, family: selected.family }
}

const requestPinnedRemoteAvatar: AvatarPinnedRequester = async (url, pinned) => new Promise<IncomingMessage>((resolveResponse, reject) => {
  const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
    method: 'GET',
    signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    headers: { accept: 'image/png,image/jpeg,image/webp' },
    // Pin the already-vetted public address. TLS still validates against the
    // URL hostname, while DNS rebinding cannot swap in a private address.
    lookup: (_hostname, _options, callback) => {
      callback(null, pinned.address, pinned.family)
    },
  }, resolveResponse)
  request.once('error', reject)
  request.end()
})

async function requestRemoteAvatar(
  url: URL,
  resolveHost: AvatarDnsResolver,
  requestPinned: AvatarPinnedRequester,
): Promise<IncomingMessage> {
  const pinned = await resolvePublicRemote(url, resolveHost)
  return requestPinned(url, pinned)
}

/** Fetch an avatar while revalidating and pinning every redirect hop. */
export async function fetchRemoteAvatar(
  source: string,
  maxBytes: number,
  resolveHost: AvatarDnsResolver = systemDnsResolver,
  requestPinned: AvatarPinnedRequester = requestPinnedRemoteAvatar,
): Promise<{ data: Buffer; type: AvatarImageType }> {
  let url = new URL(normalizeRemoteAvatarUrl(source))
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response: IncomingMessage
    try {
      response = await requestRemoteAvatar(url, resolveHost, requestPinned)
    } catch (error: unknown) {
      if (error instanceof AvatarHttpError) throw error
      throw new AvatarHttpError(502, 'remote avatar could not be loaded')
    }
    const status = response.statusCode ?? 502
    if (status >= 300 && status < 400) {
      const location = response.headers.location
      response.destroy()
      if (location === undefined || redirects === MAX_REDIRECTS) throw new AvatarHttpError(502, 'remote avatar redirect was rejected')
      url = new URL(location, url)
      normalizeRemoteAvatarUrl(url.toString())
      continue
    }
    if (status < 200 || status >= 300) {
      response.destroy()
      throw new AvatarHttpError(502, `remote avatar returned HTTP ${status}`)
    }
    const data = await readLimitedBody(response, maxBytes)
    const header = response.headers['content-type']
    const contentType = Array.isArray(header) ? header[0] : header
    return { data, type: validateAvatarImage(data, contentType, maxBytes) }
  }
  throw new AvatarHttpError(502, 'remote avatar redirect was rejected')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

function sendError(res: ServerResponse, error: unknown): void {
  const status = error instanceof AvatarHttpError ? error.status : 500
  const message = error instanceof AvatarHttpError ? error.message : 'avatar request failed'
  sendJson(res, status, { error: message })
}

function requireSameOriginMutation(req: IncomingMessage): void {
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    throw new AvatarHttpError(403, 'cross-site avatar changes are not allowed')
  }
  const marker = req.headers['x-agent-teams-request']
  if (marker !== 'avatar-v1') throw new AvatarHttpError(403, 'avatar request marker is missing')
}

function parseMutationTarget(req: IncomingMessage): AvatarMutationTarget {
  const url = new URL(req.url ?? '/', 'http://x')
  const teamId = url.searchParams.get('team_id')?.trim() ?? ''
  const captainSessionId = url.searchParams.get('captain_session_id')?.trim() ?? ''
  const target = url.searchParams.get('target')
  const memberName = url.searchParams.get('member')?.trim()
  if (teamId === '' || sanitizeKey(teamId) !== teamId || captainSessionId === '') {
    throw new AvatarHttpError(400, 'invalid team identity')
  }
  if (target !== 'captain' && target !== 'member') throw new AvatarHttpError(400, 'invalid avatar target')
  if (target === 'member' && (memberName === undefined || memberName === '')) {
    throw new AvatarHttpError(400, 'member avatar target is missing')
  }
  return { teamId, captainSessionId, target, ...memberName === undefined ? {} : { memberName } }
}

function avatarOf(state: TeamState, target: AvatarMutationTarget): string | undefined {
  if (target.target === 'captain') return state.captainAvatar
  return state.members.find((member) => member.name === target.memberName)?.avatar
}

function assignAvatar(state: TeamState, target: AvatarMutationTarget, source: string | undefined): void {
  if (target.target === 'captain') {
    state.captainAvatar = source
    return
  }
  const member = state.members.find((candidate) => candidate.name === target.memberName && candidate.status !== 'removed')
  if (member === undefined) throw new AvatarHttpError(404, 'active team member was not found')
  member.avatar = source
}

async function removeManagedAvatar(stateRoot: string, teamId: string, source: string | undefined): Promise<void> {
  const filename = managedFilename(source)
  if (filename === undefined) return
  await rm(managedAvatarPath(stateRoot, teamId, filename), { force: true }).catch(() => undefined)
}

/** Build the process-local avatar service for one plugin instance. */
export function createAvatarService(
  ctx: Context,
  workspaceRegistry: WorkspaceRegistry,
  options: AvatarServiceOptions,
): AvatarService {
  const tokenSecret = randomBytes(32)
  const configuredRoles: Record<string, string> = {}
  for (const [role, source] of Object.entries(options.roleAvatars)) {
    const key = role.trim().toLowerCase()
    const url = publicConfiguredUrl(source)
    if (key !== '' && url !== undefined) configuredRoles[key] = url
    else if (source.trim() !== '') ctx.logger.warn(`agent-teams: ignored invalid avatar mapping for role "${role}"`)
  }
  const artwork: PublicAvatarArtwork = {
    ...publicConfiguredUrl(options.captainAvatar) === undefined
      ? {}
      : { captainAvatarUrl: publicConfiguredUrl(options.captainAvatar) },
    roleAvatars: configuredRoles,
    maxUploadBytes: options.maxUploadBytes,
  }
  const stateRoots = (): string[] => workspaceRegistry.list().map((workspace) => join(workspace.path, options.stateDir))
  const tokenFor = (stateRoot: string, team: TeamState): string => createHmac('sha256', tokenSecret)
    .update(`${resolve(stateRoot)}\0${team.id}\0${team.captainSessionId}`)
    .digest('base64url')
  const publicUrl = (source: string, context: AvatarProjectionContext): string | undefined => {
    const filename = managedFilename(source)
    if (filename !== undefined) {
      const root = context.historic ? dirname(context.stateRoot) : context.stateRoot
      const query = new URLSearchParams({ root: workspaceKey(root), team: context.teamId, file: filename })
      if (context.historic) query.set('archived', '1')
      return `${AVATAR_BASE}/avatar-file?${query.toString()}`
    }
    try {
      return `${AVATAR_BASE}/avatar-proxy?url=${encodeURIComponent(normalizeRemoteAvatarUrl(source))}`
    } catch {
      return undefined
    }
  }
  const findEditableTeam = async (target: AvatarMutationTarget): Promise<EditableTeam> => {
    const matches: EditableTeam[] = []
    for (const stateRoot of stateRoots()) {
      const state = await readTeam(stateRoot, target.teamId)
      if (state?.captainSessionId === target.captainSessionId) matches.push({ stateRoot, state })
    }
    if (matches.length === 0) throw new AvatarHttpError(404, 'captain team was not found')
    if (matches.length > 1) throw new AvatarHttpError(409, 'captain team identity is ambiguous')
    return matches[0]!
  }
  const authorize = (req: IncomingMessage, editable: EditableTeam): void => {
    const supplied = req.headers['x-agent-teams-avatar-token']
    const actual = tokenFor(editable.stateRoot, editable.state)
    if (typeof supplied !== 'string') throw new AvatarHttpError(403, 'avatar edit token is missing')
    const suppliedBytes = Buffer.from(supplied)
    const actualBytes = Buffer.from(actual)
    if (suppliedBytes.length !== actualBytes.length || !timingSafeEqual(suppliedBytes, actualBytes)) {
      throw new AvatarHttpError(403, 'avatar edit token is invalid')
    }
  }
  const mutationHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      requireSameOriginMutation(req)
      if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE') {
        res.writeHead(405, { allow: 'POST, PUT, DELETE' })
        res.end()
        return
      }
      const target = parseMutationTarget(req)
      const located = await findEditableTeam(target)
      authorize(req, located)
      let upload: { data: Buffer; contentType: string | undefined; filename: string | undefined } | undefined
      let next: string | undefined
      if (req.method === 'POST') {
        const data = await readLimitedBody(req, options.maxUploadBytes)
        const contentType = Array.isArray(req.headers['content-type'])
          ? req.headers['content-type'][0]
          : req.headers['content-type']
        const filename = Array.isArray(req.headers['x-agent-teams-file-name'])
          ? req.headers['x-agent-teams-file-name'][0]
          : req.headers['x-agent-teams-file-name']
        const type = validateAvatarImage(data, contentType, options.maxUploadBytes)
        validateAvatarFilename(filename, type)
        upload = { data, contentType, filename }
      } else if (req.method === 'PUT') {
        const data = await readLimitedBody(req, MAX_AVATAR_JSON_BYTES)
        let parsed: unknown
        try {
          parsed = JSON.parse(data.toString('utf8'))
        } catch {
          throw new AvatarHttpError(400, 'avatar URL payload is invalid JSON')
        }
        const url = typeof parsed === 'object' && parsed !== null && 'url' in parsed
          ? (parsed as { url?: unknown }).url
          : undefined
        if (typeof url !== 'string') throw new AvatarHttpError(400, 'avatar URL is missing')
        next = normalizeRemoteAvatarUrl(url)
      }
      let uploaded: string | undefined
      try {
        const changed = await withTeamLock(`team:${located.stateRoot}:${target.teamId}`, async () => {
          const fresh = await readTeam(located.stateRoot, target.teamId)
          if (fresh?.captainSessionId !== target.captainSessionId) {
            throw new AvatarHttpError(409, 'captain team changed while editing its avatar')
          }
          const old = avatarOf(fresh, target)
          if (upload !== undefined) {
            uploaded = await storeManagedAvatar(
              located.stateRoot,
              target.teamId,
              upload.data,
              upload.contentType,
              upload.filename,
              options.maxUploadBytes,
            )
            next = uploaded
          }
          try {
            assignAvatar(fresh, target, next)
            await writeTeam(located.stateRoot, fresh)
          } catch (error: unknown) {
            if (uploaded !== undefined) await removeManagedAvatar(located.stateRoot, target.teamId, uploaded)
            throw error
          }
          return { old, next }
        })
        await removeManagedAvatar(located.stateRoot, target.teamId, changed.old)
        next = changed.next
      } catch (error: unknown) {
        if (uploaded !== undefined) await removeManagedAvatar(located.stateRoot, target.teamId, uploaded)
        throw error
      }
      sendJson(res, 200, { avatarUrl: next === undefined ? null : publicUrl(next, {
        stateRoot: located.stateRoot,
        teamId: target.teamId,
        historic: false,
      }) })
    } catch (error: unknown) {
      if (!(error instanceof AvatarHttpError)) ctx.logger.warn(`agent-teams: avatar mutation failed: ${String(error)}`)
      sendError(res, error)
    }
  }
  const fileHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new AvatarHttpError(405, 'method not allowed')
      const url = new URL(req.url ?? '/', 'http://x')
      const rootKey = url.searchParams.get('root') ?? ''
      const teamId = url.searchParams.get('team') ?? ''
      const filename = url.searchParams.get('file') ?? ''
      const archived = url.searchParams.get('archived') === '1'
      if (!/^[0-9a-f]{24}$/u.test(rootKey) || teamId === '' || sanitizeKey(teamId) !== teamId) {
        throw new AvatarHttpError(404, 'avatar file was not found')
      }
      const baseRoot = stateRoots().find((candidate) => workspaceKey(candidate) === rootKey)
      if (baseRoot === undefined) throw new AvatarHttpError(404, 'avatar file was not found')
      const stateRoot = archived ? join(baseRoot, 'archive') : baseRoot
      const data = await readFile(managedAvatarPath(stateRoot, teamId, filename))
      res.writeHead(200, {
        'content-type': contentTypeForFilename(filename),
        'content-length': data.length,
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      })
      res.end(req.method === 'HEAD' ? undefined : data)
    } catch (error: unknown) {
      if (error instanceof AvatarHttpError && error.status === 405) {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }
      if (!(error instanceof AvatarHttpError))
        ctx.logger.warn(`agent-teams: managed avatar read failed: ${String(error)}`)
      res.writeHead(error instanceof AvatarHttpError ? error.status : 404)
      res.end()
    }
  }
  const proxyHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new AvatarHttpError(405, 'method not allowed')
      const source = new URL(req.url ?? '/', 'http://x').searchParams.get('url') ?? ''
      const { data, type } = await fetchRemoteAvatar(source, options.maxUploadBytes)
      res.writeHead(200, {
        'content-type': type.contentType,
        'content-length': data.length,
        'cache-control': 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
      })
      res.end(req.method === 'HEAD' ? undefined : data)
    } catch (error: unknown) {
      if (error instanceof AvatarHttpError && error.status === 405) {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }
      if (!(error instanceof AvatarHttpError)) ctx.logger.warn(`agent-teams: remote avatar proxy failed: ${String(error)}`)
      res.writeHead(error instanceof AvatarHttpError ? error.status : 502, {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      res.end()
    }
  }
  return {
    artwork,
    publicUrl,
    editToken: tokenFor,
    register: (webServer) => [
      webServer.register({ kind: 'exact', path: `${AVATAR_BASE}/avatar`, handler: mutationHandler }),
      webServer.register({ kind: 'exact', path: `${AVATAR_BASE}/avatar-file`, handler: fileHandler }),
      webServer.register({ kind: 'exact', path: `${AVATAR_BASE}/avatar-proxy`, handler: proxyHandler }),
    ],
  }
}

/** Return the writable avatar slot of a member, used only by focused tests. */
export function memberAvatarTarget(state: TeamState, name: string): TeamMember | undefined {
  return state.members.find((member) => member.name === name && member.status !== 'removed')
}
