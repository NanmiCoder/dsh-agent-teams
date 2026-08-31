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
