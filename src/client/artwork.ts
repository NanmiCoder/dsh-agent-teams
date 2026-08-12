/**
 * Shared whale artwork lookup for the activity panel and the conversation
 * card: role keywords map to the packaged role images; the captain always
 * uses the lead whale.
 * @module dsh-agent-teams/client/artwork
 */

/** Artwork route prefix served by the plugin host half. */
export const ART_BASE = '/plugins/dsh-agent-teams/assets/'

/** Whale role artwork per role keyword. */
const ROLE_ART: ReadonlyArray<readonly [RegExp, string]> = [
  [/resear|analys|investig|explor|data|study|研究|分析|数据|调查|探索|调研/, 'researcher.png'],
  [/engineer|dev\b|server|backend|\bapi\b|runtime|watcher|contract|工程|后端|服务|接口|开发|代码|编程/, 'engineer.png'],
  [/\bqa\b|test|verif|quality|测试|质量/, 'qa-engineer.png'],
  [/design|\bui\b|\bux\b|front|theme|accessib|设计|前端|主题/, 'designer.png'],
  [/secur|audit|risk|threat|review|安全|审计|审查|风险/, 'security-reviewer.png'],
  [/docs|writer|product|spec|coordin|撰写|文案|写作|文档|协调/, 'docs-coordinator.png'],
  [/release|\bbuild\b|deploy|\bops\b|\bci\b|ship|发布|构建|部署/, 'engineer.png'],
]

/** Captain artwork (always the lead whale). */
export const LEAD_ART = `${ART_BASE}team-lead.png`

/** Status action artwork per member activity. */
export const ACTION_ART: Record<'working' | 'idle' | 'unknown', string> = {
  working: `${ART_BASE}action-working.png`,
  idle: `${ART_BASE}action-sleeping.png`,
  unknown: `${ART_BASE}action-thinking.png`,
}

/**
 * Member artwork URL, or null when no role matches (initial-letter fallback).
 * @param name - the member's display name.
 * @param role - the member's role text.
 * @returns the artwork URL, or null when unmatched.
 */
export function memberArtUrl(name: string, role: string): string | null {
  const identity = `${name} ${role}`.toLowerCase()
  for (const [pattern, art] of ROLE_ART) {
    if (pattern.test(identity)) return `${ART_BASE}${art}`
  }
  return null
}
