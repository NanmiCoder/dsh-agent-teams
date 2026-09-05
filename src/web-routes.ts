import type { IncomingMessage, ServerResponse } from 'node:http'
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
