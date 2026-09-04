/**
 * Harness-native artwork boundary.
 *
 * Agent identity is represented by names, roles, and status colors. The plugin deliberately
 * ships no character, whale, or decorative image mapping; callers retain their text fallback.
 */

export const ART_BASE = "";

export const LEAD_ART = "";

/** Decorative artwork is intentionally disabled in the engineering console. */
export const ACTION_ART: Record<'working' | 'idle' | 'unknown', string> = {
  working: '',
  idle: '',
  unknown: '',
}

/** Compatibility helper retained for callers; role artwork is disabled. */
export function memberArtUrl(_name: string, _role: string): string | null {
  return null
}

export function getMemberArtwork(..._args: unknown[]): string | undefined {
  return undefined;
}
