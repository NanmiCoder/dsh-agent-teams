import { describe, expect, it } from 'vitest'
import { sanitizeField } from '../src/sanitize'

describe('sanitizeField', () => {
    it('extracts <parameter=NAME>VALUE</parameter>', () => {
        const raw = 'foo</parameter>\n<parameter=name>bar</parameter>'
        expect(sanitizeField(raw, 'name')).toBe('bar')
    })

    it('cuts at first < when no parameter match', () => {
        const raw = 'sinter-phase2</parameter>\n<parameter=description>Phase 2'
        expect(sanitizeField(raw, 'name')).toBe('sinter-phase2')
    })

    it('returns clean strings unchanged', () => {
        expect(sanitizeField('sinter-phase2', 'name')).toBe('sinter-phase2')
        expect(sanitizeField('security reviewer', 'role')).toBe('security reviewer')
    })

    it('returns null / undefined as-is', () => {
        expect(sanitizeField(undefined, 'name')).toBeUndefined()
        expect(sanitizeField(null, 'name')).toBeNull()
    })

    it('handles non-string primitives', () => {
        expect(sanitizeField(42, 'name')).toBe('42')
        expect(sanitizeField(true, 'name')).toBe('true')
    })

    it('parameter match is case-insensitive', () => {
        expect(sanitizeField('<PARAMETER=NAME>x</PARAMETER>', 'name')).toBe('x')
    })
})
