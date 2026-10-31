import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
export class RequestBodyError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
/** Bound memory while draining oversized requests so the route can return 413. */
export async function readJsonRequest(req, maxBytes = 1_000_000) {
    const raw = await new Promise((resolve, reject) => {
        let size = 0;
        let settled = false;
        const chunks = [];
        const finish = (error) => {
            if (settled)
                return;
            settled = true;
            req.off('data', onData);
            req.off('end', onEnd);
            req.off('aborted', onAborted);
            req.off('error', onError);
            if (error) {
                chunks.length = 0;
                // IncomingMessage may still receive data; discard it without buffering.
                req.once('error', () => { });
                req.resume();
                reject(error);
            }
            else {
                resolve(Buffer.concat(chunks).toString('utf8'));
            }
        };
        const onData = (chunk) => {
            const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += part.length;
            if (size > maxBytes)
                finish(new RequestBodyError('request body is too large', 413));
            else
                chunks.push(part);
        };
        const onEnd = () => finish();
        const onAborted = () => finish(new RequestBodyError('request body was aborted', 400));
        const onError = () => finish(new RequestBodyError('invalid request body', 400));
        req.on('data', onData);
        req.once('end', onEnd);
        req.once('aborted', onAborted);
        req.once('error', onError);
    });
    let value;
    try {
        value = raw.trim() === '' ? {} : JSON.parse(raw);
    }
    catch {
        throw new RequestBodyError('invalid JSON', 400);
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new RequestBodyError('body must be an object', 400);
    }
    return value;
}
/** Weak validator for one JSON response body. */
export function jsonEtag(body) {
    return `W/"${createHash('sha1').update(body).digest('base64url')}"`;
}
/**
 * Whether an `If-None-Match` header already accepts `etag`.
 *
 * Intermediaries (a gzip proxy in front of the host) may rewrite a validator
 * as weak, so both the weak and the strong spelling of the same tag match.
 */
export function ifNoneMatchAccepts(header, etag) {
    if (header === undefined)
        return false;
    const value = Array.isArray(header) ? header.join(',') : header;
    const target = etag.replace(/^W\//, '');
    return value.split(',').some((part) => {
        const candidate = part.trim();
        if (candidate === '*')
            return true;
        return candidate.replace(/^W\//, '') === target;
    });
}
/**
 * Send one JSON body with a weak ETag, answering `304 Not Modified` without a
 * body when the browser already holds these exact bytes.
 *
 * The browser client keeps the validator itself: its fetch uses
 * `cache: 'no-store'`, so no shared cache will add `If-None-Match` for it.
 */
export function writeJsonWithEtag(req, res, body) {
    const etag = jsonEtag(body);
    const common = {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        etag,
    };
    if (ifNoneMatchAccepts(req.headers['if-none-match'], etag)) {
        res.writeHead(304, common);
        res.end();
        return;
    }
    res.writeHead(200, common);
    res.end(body);
}
/**
 * Drop entries whose path resolves to a directory already collected.
 *
 * Two workspace registrations can point at the same directory; without this,
 * every team under it is read and serialized twice per poll (GitHub #330).
 */
export async function dedupeByRealPath(items, pathOf) {
    const seen = new Set();
    const unique = [];
    for (const item of items) {
        const path = pathOf(item);
        let key;
        try {
            key = await realpath(path);
        }
        catch {
            // A missing directory still has to be deduped against an identical string.
            key = resolve(path);
        }
        if (seen.has(key))
            continue;
        seen.add(key);
        unique.push(item);
    }
    return unique;
}
/** Raw WebServer routes do not inherit Connection's authentication fence. */
export function authenticatedWebRoutes(server, connection) {
    return {
        register(route) {
            return server.register({
                ...route,
                async handler(req, res) {
                    const gate = connection();
                    // Missing/disposing Connection is an assembly failure, never an
                    // invitation to expose workspace state or accept plan mutations.
                    const rejection = gate === undefined ? 503 : gate.requestRejection(req);
                    if (rejection !== undefined) {
                        res.writeHead(rejection, {
                            'content-type': 'application/json; charset=utf-8',
                            'cache-control': 'no-store',
                        });
                        res.end(JSON.stringify({ error: rejection === 503 ? 'authentication unavailable'
                                : rejection === 401 ? 'unauthorized' : 'forbidden' }));
                        return;
                    }
                    await route.handler(req, res);
                },
            });
        },
    };
}
