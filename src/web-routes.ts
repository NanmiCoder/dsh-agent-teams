import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { HostConnectionService } from '@deepseek-ai/dsh-client-connection'

/** Public WebServer route surface used by the plugin. */
export interface WebRouteHost {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

export type BrowserRequestGate = Pick<HostConnectionService, 'requestRejection'>

export class RequestBodyError extends Error {
  constructor(message: string, readonly status: 400 | 413) {
    super(message)
  }
}

/** Bound memory while draining oversized requests so the route can return 413. */
export async function readJsonRequest(req: IncomingMessage, maxBytes = 1_000_000): Promise<Record<string, unknown>> {
  const raw = await new Promise<string>((resolve, reject) => {
    let size = 0
    let settled = false
    const chunks: Buffer[] = []
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('aborted', onAborted)
      req.off('error', onError)
      if (error) {
        chunks.length = 0
        // IncomingMessage may still receive data; discard it without buffering.
        req.once('error', () => {})
        req.resume()
        reject(error)
      } else {
        resolve(Buffer.concat(chunks).toString('utf8'))
      }
    }
    const onData = (chunk: Buffer | string): void => {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += part.length
      if (size > maxBytes) finish(new RequestBodyError('request body is too large', 413))
      else chunks.push(part)
    }
    const onEnd = (): void => finish()
    const onAborted = (): void => finish(new RequestBodyError('request body was aborted', 400))
    const onError = (): void => finish(new RequestBodyError('invalid request body', 400))
    req.on('data', onData)
    req.once('end', onEnd)
    req.once('aborted', onAborted)
    req.once('error', onError)
  })
  let value: unknown
  try {
    value = raw.trim() === '' ? {} : JSON.parse(raw)
  } catch {
    throw new RequestBodyError('invalid JSON', 400)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestBodyError('body must be an object', 400)
  }
  return value as Record<string, unknown>
}

/** Weak validator for one JSON response body. */
export function jsonEtag(body: string): string {
  return `W/"${createHash('sha1').update(body).digest('base64url')}"`
}

/**
 * Whether an `If-None-Match` header already accepts `etag`.
 *
 * Intermediaries (a gzip proxy in front of the host) may rewrite a validator
 * as weak, so both the weak and the strong spelling of the same tag match.
 */
export function ifNoneMatchAccepts(header: string | string[] | undefined, etag: string): boolean {
  if (header === undefined) return false
  const value = Array.isArray(header) ? header.join(',') : header
  const target = etag.replace(/^W\//, '')
  return value.split(',').some((part) => {
    const candidate = part.trim()
    if (candidate === '*') return true
    return candidate.replace(/^W\//, '') === target
  })
}

/**
 * Send one JSON body with a weak ETag, answering `304 Not Modified` without a
 * body when the browser already holds these exact bytes.
 *
 * The browser client keeps the validator itself: its fetch uses
 * `cache: 'no-store'`, so no shared cache will add `If-None-Match` for it.
 */
export function writeJsonWithEtag(
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
): void {
  const etag = jsonEtag(body)
  const common = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    etag,
  }
  if (ifNoneMatchAccepts(req.headers['if-none-match'], etag)) {
    res.writeHead(304, common)
    res.end()
    return
  }
  res.writeHead(200, common)
  res.end(body)
}

/**
 * Drop entries whose path resolves to a directory already collected.
 *
 * Two workspace registrations can point at the same directory; without this,
 * every team under it is read and serialized twice per poll (GitHub #330).
 */
export async function dedupeByRealPath<T>(
  items: readonly T[],
  pathOf: (item: T) => string,
): Promise<T[]> {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    const path = pathOf(item)
    let key: string
    try {
      key = await realpath(path)
    } catch {
      // A missing directory still has to be deduped against an identical string.
      key = resolve(path)
    }
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }
  return unique
}

/** Raw WebServer routes do not inherit Connection's authentication fence. */
export function authenticatedWebRoutes(
  server: WebRouteHost,
  connection: () => BrowserRequestGate | undefined,
): WebRouteHost {
  return {
    register(route) {
      return server.register({
        ...route,
        async handler(req, res) {
          const gate = connection()
          // Missing/disposing Connection is an assembly failure, never an
          // invitation to expose workspace state or accept plan mutations.
          const rejection = gate === undefined ? 503 : gate.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify({ error: rejection === 503 ? 'authentication unavailable'
              : rejection === 401 ? 'unauthorized' : 'forbidden' }))
            return
          }
          await route.handler(req, res)
        },
      })
    },
  }
}
