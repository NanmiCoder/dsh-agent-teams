/**
 * Shared character artwork lookup for the activity panel and the conversation
 * card: role keywords pick the role, and a member's model vendor picks which
 * character wears it. The captain always uses the lead artwork.
 *
 * Only the most specific slug is requested here. The host degrades a missing
 * combination along `vendor+role → role → vendor → packaged whale`, so a
 * vendor this list does not know still gets the role artwork instead of a
 * broken image.
 * @module dsh-agent-teams/client/artwork
 */

/** Artwork route prefix served by the plugin host half. */
export const ART_BASE = '/plugins/dsh-agent-teams/assets/'

/** Role token per role keyword, in match order.
 *
 * Priority, narrowest first:
 * 1. data / researcher come first because their keywords (埋点/统计/报表/指标 and
 *    调研/资料/情报) overlap the broad engineer bucket; matching them later would let
 *    engineer's 开发/代码 swallow them. The data bucket also claims
 *    连击/计分/得分/评分/分数, which only appear in scoring or match contexts and cannot
 *    be confused with QA's 判定 or compliance wording.
 * 2. qa precedes security so 代码质量审查 matches qa first; otherwise 审查 goes to security.
 * 3. security follows designer so compounds like 设计安全 are not taken by security.
 * 4. engineer is the broadest bucket and sits after qa/security so it cannot swallow 质量/审计.
 */
const ROLE_ART: ReadonlyArray<readonly [RegExp, string]> = [
  // audio / video are the narrowest buckets and must come first: otherwise
  // 视频渲染 is swallowed by engineer's 渲染/实现.
  [/\baudio\b|sound|\bvoice\b|music|\btts\b|音频|语音|音效|音乐|配音/, 'audio'],
  [/\bvideo\b|\bfilm\b|movie|animat|\bclip\b|视频|影片|剪辑|动画|字幕/, 'video'],
  [/data|analys|metric|performance|埋点|统计|报表|指标|数据|分析|性能|连击|计分|得分|评分|分数/, 'data'],
  [/resear|investig|explor|study|调研|研究|调查|探索|资料|情报/, 'researcher'],
  // Match compound QA titles (for example "QA Engineer") before the broad
  // engineer bucket, otherwise an eight-role roster repeats the engineer art.
  // Note: "reviewer" is deliberately NOT matched from the member name — qa precedes
  // security, so a name rule would claim "Security Reviewer" for qa and make
  // member-security artwork unreachable (the packaging contract in
  // scripts/verify.mjs catches that outright). Review-flavoured members reach qa
  // through 质量/验证 in their role text, while a pure 审查/审计 lands on security.
  [/\bqa\b|test|verif|quality|校验|核验|体检|回归|冒烟|测试|质量|验证/, 'qa'],
  [/engineer|dev\b|server|backend|\bapi\b|runtime|watcher|contract|架构|模块|接口|运行时|装配|工程|后端|服务|开发|代码|编程|实现/, 'engineer'],
  [/design|\bui\b|\bux\b|front|theme|accessib|视觉|界面|样式|皮肤|动效|设计|前端|主题|无障碍|美术|插画|立绘|出图|绘制|美工|交互/, 'designer'],
  [/secur|audit|risk|threat|review|合规|风控|权限|审计|安全|审查|风险/, 'security'],
  [/docs|writer|author|edit|readme|product|spec|说明|手册|教程|文案|撰写|写作|作者|写手|文档|规范/, 'docs'],
  [/release|\bbuild\b|deploy|\bops\b|\bci\b|ship|coordin|部署|发布|上线|流水线|调度|编排|构建|运维|协调/, 'operator'],
]

/**
 * Vendor token per provider/model id, in match order. The model id is the
 * reliable half: one provider (`bailian`) serves several vendors.
 *
 * These tokens must stay identical to `ARTWORK_VENDORS` in the host half
 * (`../artwork-source.ts`); a token the host rejects would 404 the image.
 */
const VENDOR_ART: ReadonlyArray<readonly [RegExp, string]> = [
  // Two systematic root causes (fixed 2026-10-08; this was not merely a missing alias):
  //
  //   1. A trailing \b cannot match a name followed by a digit: `\bhunyuan\b` does not
  //      match `hunyuan3`, because `3` is a word character and there is no boundary
  //      between them. The same held for `\brwkv\b` vs `rwkv7`, `\bseed\b` vs
  //      `seed1.6`, `\babab\b` vs `abab6.5s`, and `\bchatglm\b` vs `chatglm3-6b`.
  //      Every primary vendor name therefore absorbs a suffix with `[\w.-]*` and no
  //      longer asks for a trailing boundary.
  //   2. `\b` NEVER holds next to CJK: JavaScript's `\w` is ASCII-only, so both sides
  //      of `\b混元\b` are non-word characters and no boundary exists — every Chinese
  //      alias was a dead branch. Chinese aliases never carry `\b`.
  //
  // hunyuan additionally accepts the `hy` family (users write hy for 混元): `hy3`,
  // `hy-3`, `hy_1.5` and `hy-mt2-pro` all match. It is deliberately NOT widened to a
  // bare `\bhy`, which would swallow `hypothesis`, `hybrid-1` and `hyperbolic` —
  // real inference providers.
  [/\bdeepseek[\w.-]*/, 'deepseek'],
  [/\bqwen[\w.-]*|\bqwq[\w.-]*|\btongyi\b|通义/, 'qwen'],
  [/\bglm[\w.-]*|\bchatglm[\w.-]*|\bzai\b|\bz\.ai\b|\bzhipu\b|智谱/, 'glm'],
  [/\bkimi[\w.-]*|\bmoonshot[\w.-]*/, 'kimi'],
  [/\bclaude[\w.-]*|\banthropic\b/, 'claude'],
  [/\bgemini[\w.-]*|\bgemma[\w.-]*|\bgoogle\b/, 'gemini'],
  [/\bgrok[\w.-]*|\bxai[\w.-]*|\bx\.ai\b/, 'grok'],
  [/\bgpt[\w.-]*|\bchatgpt[\w.-]*|\bopenai\b|\bcodex[\w.-]*|\bo[1-9]\b/, 'gpt'],
  [/\bhunyuan[\w.-]*|\bhy[-_.]?\d[\w.-]*|\bhy-[\w.-]+|\btencent\b|混元|腾讯/, 'hunyuan'],
  // 2026-10-08: the six vendors added by the second artwork round. Appended at the end
  // so every existing token keeps its match priority.
  [/\bminimax[\w.-]*|\bmini-max[\w.-]*|\babab[\w.-]*|\bhailuo[\w.-]*/, 'minimax'],
  [/\bmeta\b|\bllama[\w.-]*/, 'meta'],
  // The mistral family is enumerated name by name instead of a broad `\w*stral`, which
  // would swallow orchestral and friends.
  [/\bmistral[\w.-]*|\bmixtral[\w.-]*|\bmagistral[\w.-]*|\bministral[\w.-]*|\bcodestral[\w.-]*|\bdevstral[\w.-]*|\bpixtral[\w.-]*|\bvoxtral[\w.-]*/, 'mistral'],
  [/\brwkv[\w.-]*/, 'rwkv'],
  [/\bseed[\w.-]*|\bdoubao[\w.-]*|\bbytedance\b|\bvolcengine\b|\bvolces\b|豆包/, 'seed'],
  [/\bern[\w.-]*|\bwenxin[\w.-]*|\bbaidu\b|\bqianfan\b|文心|千帆/, 'ernie'],
]

/** Chinese label map for role tokens.
 * Used by tests and as a reference lookup; the UI itself uses `labelKey` + `t()` for i18n.
 */
export const ROLE_LABELS: Readonly<Record<string, string>> = {
  engineer: '工程师',
  qa: '测试与质量',
  security: '安全与审计',
  researcher: '调研',
  designer: '设计与前端',
  docs: '文档与文案',
  data: '数据与分析',
  operator: '运维与发布',
  audio: '音频与语音',
  video: '视频与动画',
  'team-lead': '队长',
}

type AgentTeamsLocaleKey = import('./locales.ts').AgentTeamsLocaleKey

/** Resolved artwork for one member. */
export interface ResolvedMemberArtwork {
  /** Avatar URL, or null when neither role nor vendor is known. */
  url: string | null
  /** Large preview URL, or null when neither role nor vendor is known. */
  full: string | null
  /** Matched role token, or null when no role matched. */
  role: string | null
  /** Locale key for the role's Chinese label, or null when no role matched. */
  labelKey: AgentTeamsLocaleKey | null
  /** True when the image is the vendor-generic fallback because no role matched. */
  isFallback: boolean
}

/**
 * Captain artwork. The vendor-specific name is requested first, and a custom
 * `team-lead-v2.png` still answers it through the host's degradation chain, so
 * the captain can be themed per vendor while one plain override keeps working.
 *
 * It deliberately avoids the packaged slug: that URL existed before any custom
 * directory did and had been served with a 24h cache, so a browser that already
 * held it kept replaying the packaged whale instead of asking for the override.
 * A name the browser has never seen cannot be shadowed by stale bytes.
 */
export const LEAD_ART = `${ART_BASE}team-lead-deepseek-v2.png`

/** Large-preview artwork for the captain; degrades to {@link LEAD_ART}. */
export const LEAD_FULL_ART = `${ART_BASE}team-lead-deepseek-full-v2.png`

/** Status action artwork per member activity. */
export const ACTION_ART: Record<'working' | 'idle' | 'unknown', string> = {
  working: `${ART_BASE}action-working-v2.png`,
  idle: `${ART_BASE}action-sleeping-v2.png`,
  unknown: `${ART_BASE}action-thinking-v2.png`,
}

/**
 * Vendor token behind a member's model route, when this build knows it.
 * @param member - a snapshot member carrying its `provider`/`model` route.
 * @returns the vendor token, or undefined to keep the role artwork.
 */
export function vendorSlug(
  member: { readonly provider?: string; readonly model?: string } | undefined,
): string | undefined {
  if (member === undefined) return undefined
  const route = `${member.provider ?? ''} ${member.model ?? ''}`.toLowerCase().trim()
  if (route === '') return undefined
  for (const [pattern, vendor] of VENDOR_ART) {
    if (pattern.test(route)) return vendor
  }
  return undefined
}

/**
 * Strip directory-like and file-like tokens from role text.
 * Directory names (e.g. `team-site-test/`) contain `/` or `\`; file names
 * (e.g. `verify.ps1`, `curl.exe`, `HTML/CSS/JS`) contain a dot-extension.
 * These tokens are artifacts of the member's prompt / workspace, not role
 * nouns, and must not participate in role matching.
 */
function stripPathTokens(text: string): string {
  return text
    .split(/\s+/)
    .filter((token) => !/[\/\\]/.test(token) && !/\.\w{1,6}$/.test(token))
    .join(' ')
}

/**
 * Role token for a member identity, or null when no role matches.
 * @param name - the member's display name.
 * @param role - the member's role text.
 */
export function memberRoleSlug(name: string, role: string): string | null {
  // Match only against the member's name and the cleaned role description;
  // path/file tokens in the role text are intentionally ignored so that
  // directory names and filenames do not pollute role matching.
  const identity = `${name} ${stripPathTokens(role)}`.toLowerCase()
  for (const [pattern, art] of ROLE_ART) {
    if (pattern.test(identity)) return art
  }
  return null
}

/**
 * Unified artwork resolver. Implements the client-side degradation chain:
 * role+vendor → role → vendor → initial-letter fallback.
 *
 * - If a role matches, request `member-<vendor>-<role>-v2.png` (or the generic
 *   role image when the vendor is unknown).
 * - If no role matches but the vendor is known, request the vendor-generic
 *   `member-<vendor>-v2.png` and mark it as a fallback.
 * - If neither role nor vendor is known, return null so the caller can fall back
 *   to the initial-letter badge.
 * @param options - member display name, role text, and optional vendor token.
 */
export function resolveMemberArtwork({
  name: _name,
  role,
  vendor,
}: {
  name: string
  role: string
  vendor?: string
}): ResolvedMemberArtwork {
  const slug = memberRoleSlug(_name, role)
  if (slug !== null) {
    return {
      url: vendor === undefined
        ? `${ART_BASE}member-${slug}-v2.png`
        : `${ART_BASE}member-${vendor}-${slug}-v2.png`,
      full: vendor === undefined
        ? `${ART_BASE}member-${slug}-full-v2.png`
        : `${ART_BASE}member-${vendor}-${slug}-full-v2.png`,
      role: slug,
      labelKey: `member.role.${slug}` as AgentTeamsLocaleKey,
      isFallback: false,
    }
  }
  if (vendor !== undefined) {
    return {
      url: `${ART_BASE}member-${vendor}-v2.png`,
      full: `${ART_BASE}member-${vendor}-full-v2.png`,
      role: null,
      labelKey: null,
      isFallback: true,
    }
  }
  return {
    url: null,
    full: null,
    role: null,
    labelKey: null,
    isFallback: false,
  }
}

/** Format the caption under the enlarged member/leader artwork preview. */
export function formatArtPreviewCaption({
  name,
  labelKey,
  kind,
  t,
}: {
  name: string
  labelKey: AgentTeamsLocaleKey | null
  kind: 'captain' | 'member'
  t: import('./locales.ts').AgentTeamsTranslate
}): string {
  if (kind === 'captain') return name
  if (labelKey !== null) return `${name} · ${t('member.art.rolePrefix')}${t(labelKey)}`
  return `${name} · ${t('member.art.fallbackLabel')}`
}

/**
 * Member artwork URL, or null when no role matches (initial-letter fallback).
 * @param name - the member's display name.
 * @param role - the member's role text.
 * @param vendor - optional vendor token from {@link vendorSlug}.
 * @returns the artwork URL, or null when unmatched.
 */
export function memberArtUrl(name: string, role: string, vendor?: string): string | null {
  const slug = memberRoleSlug(name, role)
  if (slug === null) return null
  return vendor === undefined
    ? `${ART_BASE}member-${slug}-v2.png`
    : `${ART_BASE}member-${vendor}-${slug}-v2.png`
}

/**
 * Vendor brand mark URL for the state badge, or null when the vendor is
 * unknown (the badge then keeps the packaged activity art). A missing file is
 * not fatal: the caller falls back on the image's error event.
 * @param vendor - vendor token from {@link vendorSlug}.
 */
export function brandArtUrl(vendor: string | undefined): string | null {
  return vendor === undefined ? null : `${ART_BASE}brand-${vendor}.svg`
}

/**
 * Large-preview artwork URL for the same member. Safe to request even when no
 * `-full` file exists: the host degrades to the avatar art.
 * @param name - the member's display name.
 * @param role - the member's role text.
 * @param vendor - optional vendor token from {@link vendorSlug}.
 * @returns the large-preview URL, or null when no role matched.
 */
export function memberFullArtUrl(name: string, role: string, vendor?: string): string | null {
  const slug = memberRoleSlug(name, role)
  if (slug === null) return null
  return vendor === undefined
    ? `${ART_BASE}member-${slug}-full-v2.png`
    : `${ART_BASE}member-${vendor}-${slug}-full-v2.png`
}
