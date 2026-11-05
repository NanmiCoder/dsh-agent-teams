import { createHash } from 'node:crypto';
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
function matchesEntityTagList(header, tag) {
    if (header === undefined)
        return false;
    if (header.trim() === '*')
        return true;
    // A comma can be part of the quoted opaque tag. Consume whole list entries
    // and compare their quoted values, accepting either weak or strong spelling.
    const entry = /[ \t]*(?:(?:W\/)?("[\x21\x23-\x7e\x80-\xff]*"))?[ \t]*(?:,|$)/y;
    let matched = false;
    while (entry.lastIndex < header.length) {
        const parsed = entry.exec(header);
        if (parsed === null)
            return false;
        matched ||= parsed[1] === tag;
    }
    return matched;
}
/** Revalidate a current JSON representation across both identity and gzip delivery. */
export function writeJsonWithEtag(req, res, body) {
    const tag = `"${createHash('sha256').update(body).digest('base64url')}"`;
    const headers = { 'cache-control': 'no-store', etag: `W/${tag}` };
    if ((req.method === 'GET' || req.method === 'HEAD')
        && matchesEntityTagList(req.headers['if-none-match'], tag)) {
        res.writeHead(304, headers);
        res.end();
        return;
    }
    res.writeHead(200, { ...headers, 'content-type': 'application/json; charset=utf-8' });
    res.end(body);
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
