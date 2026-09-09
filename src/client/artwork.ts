/**
 * Shared whale artwork lookup for the activity panel and the conversation
 * card: role keywords map to the packaged role images; the captain always
 * uses the lead whale.
 * @module dsh-agent-teams/client/artwork
 */

/** Artwork route prefix served by the plugin host half. */
export const ART_BASE = '/plugins/dsh-agent-teams/assets/'

/** V2 whale role artwork per canonical category and role keyword. */
const ROLE_ART: ReadonlyArray<readonly [string, RegExp, string]> = [
  ['data', /data|analys|metric|performance|数据|分析|指标|性能/, 'member-data-v2.png'],
  ['researcher', /resear|investig|explor|study|研究|调查|探索|调研/, 'member-researcher-v2.png'],
  // Match compound QA titles (for example "QA Engineer") before the broad
  // engineer bucket, otherwise an eight-role roster repeats the engineer art.
  ['qa', /\bqa\b|test|verif|quality|测试|质量|验证/, 'member-qa-v2.png'],
  ['engineer', /engineer|dev\b|server|backend|\bapi\b|runtime|watcher|contract|工程|后端|服务|接口|开发|代码|编程/, 'member-engineer-v2.png'],
  ['designer', /design|\bui\b|\bux\b|front|theme|accessib|设计|前端|主题|无障碍/, 'member-designer-v2.png'],
  ['security', /secur|audit|risk|threat|review|安全|审计|审查|风险/, 'member-security-v2.png'],
  ['docs', /docs|writer|product|spec|撰写|文案|写作|文档|规范/, 'member-docs-v2.png'],
  ['operator', /release|\bbuild\b|deploy|\bops\b|\bci\b|ship|coordin|发布|构建|部署|运维|协调/, 'member-operator-v2.png'],
]

/** Captain artwork (always the lead whale). */
export const LEAD_ART = `${ART_BASE}team-lead-v2.png`

/** Status action artwork per member activity. */
export const ACTION_ART: Record<'working' | 'idle' | 'unknown', string> = {
  working: `${ART_BASE}action-working-v2.png`,
  idle: `${ART_BASE}action-sleeping-v2.png`,
  unknown: `${ART_BASE}action-thinking-v2.png`,
}

/**
 * Member artwork URL, or null when no role matches (initial-letter fallback).
 * @param name - the member's display name.
 * @param role - the member's role text.
 * @returns the artwork URL, or null when unmatched.
 */
export function memberArtCandidates(
  name: string,
  role: string,
  customAvatarUrl?: string,
  roleAvatars: Readonly<Record<string, string>> = {},
): string[] {
  const identity = `${name} ${role}`.toLowerCase()
  const candidates: string[] = []
  if (customAvatarUrl !== undefined && customAvatarUrl.trim() !== '') candidates.push(customAvatarUrl)
  // Arbitrary configured role keys match first; canonical defaults below also
  // let `researcher` override broad aliases such as “investigator”.
  for (const [key, url] of Object.entries(roleAvatars)) {
    if (key.trim() !== '' && identity.includes(key.trim().toLowerCase())) candidates.push(url)
  }
  for (const [category, pattern, art] of ROLE_ART) {
    if (!pattern.test(identity)) continue
    const override = roleAvatars[category]
    if (override !== undefined) candidates.push(override)
    candidates.push(`${ART_BASE}${art}`)
    break
  }
  return [...new Set(candidates.filter((url) => url.trim() !== ''))]
}

export function memberArtUrl(
  name: string,
  role: string,
  customAvatarUrl?: string,
  roleAvatars: Readonly<Record<string, string>> = {},
): string | null {
  return memberArtCandidates(name, role, customAvatarUrl, roleAvatars)[0] ?? null
}

/** Captain candidates in descending priority, ending in packaged artwork. */
export function captainArtCandidates(teamAvatarUrl?: string, configuredAvatarUrl?: string): string[] {
  return [...new Set([teamAvatarUrl, configuredAvatarUrl, LEAD_ART]
    .filter((url): url is string => typeof url === 'string' && url.trim() !== ''))]
}
