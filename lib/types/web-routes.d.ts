import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HostConnectionService } from '@deepseek-ai/dsh-client-connection';
/** Public WebServer route surface used by the plugin. */
export interface WebRouteHost {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}
export type BrowserRequestGate = Pick<HostConnectionService, 'requestRejection'>;
export declare class RequestBodyError extends Error {
    readonly status: 400 | 413;
    constructor(message: string, status: 400 | 413);
}
/** Bound memory while draining oversized requests so the route can return 413. */
export declare function readJsonRequest(req: IncomingMessage, maxBytes?: number): Promise<Record<string, unknown>>;
/** Weak validator for one JSON response body. */
export declare function jsonEtag(body: string): string;
/**
 * Whether an `If-None-Match` header already accepts `etag`.
 *
 * Intermediaries (a gzip proxy in front of the host) may rewrite a validator
 * as weak, so both the weak and the strong spelling of the same tag match.
 */
export declare function ifNoneMatchAccepts(header: string | string[] | undefined, etag: string): boolean;
/**
 * Send one JSON body with a weak ETag, answering `304 Not Modified` without a
 * body when the browser already holds these exact bytes.
 *
 * The browser client keeps the validator itself: its fetch uses
 * `cache: 'no-store'`, so no shared cache will add `If-None-Match` for it.
 */
export declare function writeJsonWithEtag(req: IncomingMessage, res: ServerResponse, body: string): void;
/**
 * Drop entries whose path resolves to a directory already collected.
 *
 * Two workspace registrations can point at the same directory; without this,
 * every team under it is read and serialized twice per poll (GitHub #330).
 */
export declare function dedupeByRealPath<T>(items: readonly T[], pathOf: (item: T) => string): Promise<T[]>;
/** Raw WebServer routes do not inherit Connection's authentication fence. */
export declare function authenticatedWebRoutes(server: WebRouteHost, connection: () => BrowserRequestGate | undefined): WebRouteHost;
