/**
 * Extract `<parameter=NAME>VALUE</parameter>` from a string when a parameter
 * name is given; otherwise truncate at the first `<`. Used to clean fields
 * that may carry the raw argument blob from a malformed tool call.
 *
 * Returns the input unchanged for null/undefined so callers can chain.
 */
export function sanitizeField<T>(value: T, param?: string): T | string {
    if (value === undefined || value === null) return value as T
    const raw = String(value)
    if (param) {
        const m = raw.match(new RegExp(`<parameter=${param}>([\\s\\S]*?)</parameter>`, 'i'))
        if (m && m[1] !== undefined) return m[1].trim()
    }
    const c = raw.indexOf('<')
    return (c !== -1 ? raw.slice(0, c) : raw).trim()
}
