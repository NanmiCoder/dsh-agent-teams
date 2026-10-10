import assert from 'node:assert/strict'
import test from 'node:test'
import {
  memberRoleSlug,
  vendorSlug,
  resolveMemberArtwork,
  ROLE_LABELS,
  formatArtPreviewCaption,
} from '../lib/client/artwork.js'

/**
 * Positive role-matching cases: at least one real Chinese role description hits
 * each of the 8 member roles.
 * The match order (priority) is documented on ROLE_ART in artwork.ts:
 * data / researcher come first because their keywords (data/analysis/metrics,
 * research/survey) can overlap with roles such as engineer; qa precedes security
 * so that "code quality review" hits qa first; security follows designer so that
 * compound wording such as "design/security" is not swallowed by the wrong role.
 */
const ROLE_CASES = [
  { text: '埋点统计与报表指标开发', expected: 'data' },
  { text: '调研竞品资料与情报', expected: 'researcher' },
  { text: '代码质量审查与冒烟回归', expected: 'qa' },
  { text: '架构模块接口与运行时装配', expected: 'engineer' },
  { text: '视觉界面样式与动效', expected: 'designer' },
  { text: '安全合规风控与权限审计', expected: 'security' },
  { text: '说明手册教程与文案撰写', expected: 'docs' },
  { text: '部署发布上线与流水线编排', expected: 'operator' },
]

/** Negative cases: must not be stretched into a match, must return null. */
const NEGATIVE_CASES = [
  // Text about audio has hit the audio bucket since 2026-10-05 (it is an official
  // role word), so it is no longer a negative case.
  'BPM 主时钟',
  'Loop Pad 触发、混音总线、录音导出',
]

/** Local allowlisted routes plus T1 aliases: must resolve to the expected vendor. */
const VENDOR_CASES = [
  { provider: 'bailian-he', model: 'qwen3.7-plus', expected: 'qwen' },
  { provider: 'bailian', model: 'qwen3.8-flash', expected: 'qwen' },
  { provider: 'bailian', model: 'deepseek-v4.1-flash', expected: 'deepseek' },
  { provider: 'atria', model: 'glm-5.3', expected: 'glm' },
  { provider: 'bailian', model: 'kimi-k2.7-code', expected: 'kimi' },
  { provider: 'bailian', model: 'qwen3.8-max', expected: 'qwen' },
  { provider: 'atria', model: 'minimax-m3', expected: 'minimax' },
  { provider: 'bailian', model: 'glm-5.3', expected: 'glm' },
  { provider: 'bailian-he', model: 'qwen3.6-plus', expected: 'qwen' },
  // Additional T1 aliases
  { provider: 'tencent', model: 'hunyuan-a13b', expected: 'hunyuan' },
  { provider: 'tencent', model: 'hy-mt2-pro', expected: 'hunyuan' },
  { provider: 'zai', model: 'glm-4-9b-chat', expected: 'glm' },
  { provider: 'openai', model: 'gpt-4o', expected: 'gpt' },
  { provider: 'xai', model: 'grok-3-beta', expected: 'grok' },
  { provider: 'google', model: 'gemini-2.5-pro', expected: 'gemini' },
  // The six vendors added on 2026-10-08
  { provider: 'meta', model: 'llama-4-scout', expected: 'meta' },
  { provider: 'mistral', model: 'mistral-large-latest', expected: 'mistral' },
  { provider: 'mistral', model: 'mistralai/mixtral-8x22b', expected: 'mistral' },
  { provider: 'rwkv', model: 'rwkv-7-g1', expected: 'rwkv' },
  { provider: 'volcengine', model: 'doubao-seed-1.6', expected: 'seed' },
  { provider: 'bytedance', model: 'seed-oss-36b', expected: 'seed' },
  { provider: 'baidu', model: 'ernie-4.5-turbo', expected: 'ernie' },
  { provider: 'qianfan', model: 'wenxin-4', expected: 'ernie' },
  // 2026-10-08 fix (root cause one): a trailing \b blocks "name + digits" ids -
  // \bhunyuan\b cannot match hunyuan3/hunyuan4, \brwkv\b cannot match rwkv7,
  // \bseed\b cannot match seed1.6, \babab\b cannot match abab6.5s, and \bchatglm\b
  // cannot match chatglm3-6b.
  // Hit in production with Hunyuan: when the model id is hunyuan3 / hy3 the whole
  // team falls back to the default whale avatar.
  { provider: 'tencent', model: 'hunyuan3', expected: 'hunyuan' },
  { provider: 'tencent', model: 'hunyuan4', expected: 'hunyuan' },
  { provider: 'rwkv', model: 'rwkv7', expected: 'rwkv' },
  { provider: 'rwkv', model: 'rwkv5-world', expected: 'rwkv' },
  { provider: 'volcengine', model: 'seed1.6', expected: 'seed' },
  { provider: 'atria', model: 'abab6.5s-chat', expected: 'minimax' },
  { provider: 'atria', model: 'abab7-chat-preview', expected: 'minimax' },
  { provider: 'atria', model: 'hailuo-02', expected: 'minimax' },
  { provider: 'zai', model: 'chatglm3-6b', expected: 'glm' },
  { provider: 'bailian', model: 'qwq-32b', expected: 'qwen' },
  // The Hunyuan "hy" family: hy3 / hy-3 / hy_1.5 / hy-1.8b must all be
  // recognised (users commonly write Hunyuan as hy)
  { provider: 'tencent', model: 'hy3', expected: 'hunyuan' },
  { provider: 'tencent', model: 'hy-3-preview', expected: 'hunyuan' },
  { provider: 'tencent', model: 'hy_1.5', expected: 'hunyuan' },
  // 2026-10-08 fix (root cause two): JS \b only accepts ASCII \w, so \b混元\b and
  // the like **never hold** - every Chinese alias was a dead branch. Chinese ids
  // no longer carry a \b.
  { provider: 'tencent', model: '混元', expected: 'hunyuan' },
  { provider: 'bailian', model: '通义千问', expected: 'qwen' },
  { provider: 'zai', model: '智谱清言', expected: 'glm' },
  { provider: 'volcengine', model: '豆包', expected: 'seed' },
  { provider: 'baidu', model: '文心一言', expected: 'ernie' },
  { provider: 'baidu', model: '千帆', expected: 'ernie' },
  // Completing the mistral family: magistral / pixtral / voxtral / ministral all
  // missed before
  { provider: 'mistral', model: 'magistral-small-2509', expected: 'mistral' },
  { provider: 'mistral', model: 'pixtral-large-2411', expected: 'mistral' },
  { provider: 'mistral', model: 'voxtral-mini-2507', expected: 'mistral' },
  { provider: 'mistral', model: 'ministral-8b', expected: 'mistral' },
]

test('the 8 member-role positive cases hit the right role token', () => {
  for (const { text, expected } of ROLE_CASES) {
    assert.equal(memberRoleSlug('成员', text), expected, `expected "${text}" to hit ${expected}`)
  }
})

test('"code quality review" wording hits qa because qa precedes security', () => {
  assert.equal(memberRoleSlug('成员', '代码质量审查'), 'qa')
})

test('negative cases stay unmatched and return null', () => {
  for (const text of NEGATIVE_CASES) {
    assert.equal(memberRoleSlug('成员', text), null, `"${text}" must not be stretched into a match`)
  }
})

test('author/writer, audio and video all hit their own roles (no fallback avatar)', () => {
  // Misses reproduced on a real machine: when a member name/role was written as
  // *-author the old rule only knew writer, and the whole team fell back to the
  // generic vendor art.
  assert.equal(memberRoleSlug('成员', '插件详情页写手 plugin-author'), 'docs')
  assert.equal(memberRoleSlug('成员', '首页与安装页作者 home-author'), 'docs')
  assert.equal(memberRoleSlug('成员', '音频引擎：程序化音色合成'), 'audio')
  assert.equal(memberRoleSlug('成员', '视频渲染与剪辑'), 'video')
})

test('the vendor matrix hits the right vendor (including the six added on 2026-10-08)', () => {
  for (const { provider, model, expected } of VENDOR_CASES) {
    assert.equal(vendorSlug({ provider, model }), expected, `${provider}/${model} should hit ${expected}`)
  }
})

test('the hy prefix hits Hunyuan while English words containing hy are not misread', () => {
  assert.equal(vendorSlug({ provider: 'tencent', model: 'hy-mt2-pro' }), 'hunyuan')
  // With a non-Tencent provider an English word containing hy must not be read as
  // Hunyuan.
  assert.equal(vendorSlug({ provider: 'some', model: 'hypothesis' }), undefined)
  assert.equal(vendorSlug({ provider: 'some', model: 'physics' }), undefined)
})

test('after relaxing hy / stral, unrelated words are still not swallowed (provider and model both checked)', () => {
  for (const model of ['hypothesis', 'physics', 'hybrid-1', 'hyperbolic', 'orchestral-music', 'metadata-model']) {
    assert.equal(vendorSlug({ provider: 'some', model }), undefined, `${model} must not be misidentified`)
  }
  // When the provider is hyperbolic (a real inference provider), the vendor is
  // still decided by the model.
  assert.equal(vendorSlug({ provider: 'hyperbolic', model: 'meta-llama/Llama-3.3-70B' }), 'meta')
  assert.equal(vendorSlug({ provider: 'hyperbolic', model: 'hy3' }), 'hunyuan')
})

test('resolveMemberArtwork: role and vendor both hit -> the combined role+vendor art', () => {
  const result = resolveMemberArtwork({ name: '成员', role: '架构与接口设计', vendor: 'deepseek' })
  assert.equal(result.url, '/plugins/dsh-agent-teams/assets/member-deepseek-engineer-v2.png')
  assert.equal(result.full, '/plugins/dsh-agent-teams/assets/member-deepseek-engineer-full-v2.png')
  assert.equal(result.role, 'engineer')
  assert.equal(result.labelKey, 'member.role.engineer')
  assert.equal(result.isFallback, false)
})

test('resolveMemberArtwork: role hit but vendor unknown -> the generic role art', () => {
  const result = resolveMemberArtwork({ name: '测试', role: '代码审查与冒烟', vendor: undefined })
  assert.equal(result.url, '/plugins/dsh-agent-teams/assets/member-qa-v2.png')
  assert.equal(result.full, '/plugins/dsh-agent-teams/assets/member-qa-full-v2.png')
  assert.equal(result.role, 'qa')
  assert.equal(result.isFallback, false)
})

test('resolveMemberArtwork: no role hit but vendor known -> the generic vendor art as fallback', () => {
  const result = resolveMemberArtwork({ name: '节拍', role: 'BPM 主时钟', vendor: 'qwen' })
  assert.equal(result.url, '/plugins/dsh-agent-teams/assets/member-qwen-v2.png')
  assert.equal(result.full, '/plugins/dsh-agent-teams/assets/member-qwen-full-v2.png')
  assert.equal(result.role, null)
  assert.equal(result.labelKey, null)
  assert.equal(result.isFallback, true)
})

test('resolveMemberArtwork: neither role nor vendor hit -> null (initial-letter fallback)', () => {
  const result = resolveMemberArtwork({ name: '节拍', role: 'BPM 主时钟', vendor: undefined })
  assert.equal(result.url, null)
  assert.equal(result.full, null)
  assert.equal(result.role, null)
  assert.equal(result.labelKey, null)
  assert.equal(result.isFallback, false)
})

test('the 9 role tokens have matching Chinese labels and labelKeys', () => {
  const expected = {
    engineer: '工程师',
    qa: '测试与质量',
    security: '安全与审计',
    researcher: '调研',
    designer: '设计与前端',
    docs: '文档与文案',
    data: '数据与分析',
    operator: '运维与发布',
    'team-lead': '队长',
  }
  for (const [token, label] of Object.entries(expected)) {
    assert.equal(ROLE_LABELS[token], label, `${token} should have the Chinese label ${label}`)
    const result = resolveMemberArtwork({ name: 'x', role: token === 'team-lead' ? 'captain' : label, vendor: 'deepseek' })
    if (token !== 'team-lead') {
      assert.equal(result.labelKey, `member.role.${token}`)
    }
  }
})

test('zhipu provider variants hit glm while non-zhipu strings do not match by mistake', () => {
  assert.equal(vendorSlug({ provider: 'zhipu', model: 'chatglm-4' }), 'glm')
  assert.equal(vendorSlug({ provider: 'zhipu', model: 'glm-4' }), 'glm')
  assert.equal(vendorSlug({ provider: 'some', model: 'zhipu-chat' }), 'glm')
  assert.equal(vendorSlug({ provider: 'other', model: 'physics' }), undefined)
})

const mockT = (key) => {
  const map = {
    'member.art.rolePrefix': '岗位：',
    'member.art.fallbackLabel': '该岗位形象作者正在尽快适配',
    'member.role.engineer': '工程师',
  }
  return map[key] ?? key
}

test('formatArtPreviewCaption: a captain preview shows only the captain name, not the fallback text', () => {
  assert.equal(formatArtPreviewCaption({ name: '队长', labelKey: null, kind: 'captain', t: mockT }), '队长')
})

test('formatArtPreviewCaption: a member with a matched role shows the role prefix', () => {
  assert.equal(formatArtPreviewCaption({ name: '成员', labelKey: 'member.role.engineer', kind: 'member', t: mockT }), '成员 · 岗位：工程师')
})

test('formatArtPreviewCaption: a member without a matched role shows the fallback text', () => {
  assert.equal(formatArtPreviewCaption({ name: '音频', labelKey: null, kind: 'member', t: mockT }), '音频 · 该岗位形象作者正在尽快适配')
})

/** t9 fix: art/interaction wording should hit designer */
test('art pipeline, illustrations and drawing wording hit designer', () => {
  assert.equal(memberRoleSlug('artisan', '美术管线：把 9 张厂商原版大图抠图落盘'), 'designer')
  assert.equal(memberRoleSlug('art-pipeline', '美术管线：把 9 张厂商原版大图抠图落盘'), 'designer')
  assert.equal(memberRoleSlug('artist', '插画立绘与海报出图'), 'designer')
  assert.equal(memberRoleSlug('ui-art', '绘制皮肤、图标与界面素材'), 'designer')
})

test('interaction-layer and interaction-design wording hit designer', () => {
  assert.equal(memberRoleSlug('deckui', '交互层：双 Deck、黑胶搓碟、Hot Cue'), 'designer')
  assert.equal(memberRoleSlug('ux', '负责整体交互与原型'), 'designer')
})

/** t9 fix: path/file-name noise must not cause a misclassification */
test('an implementer role with a team-site-test/ directory and HTML/CSS/JS file names still hits engineer, not qa', () => {
  assert.equal(memberRoleSlug('implementer', '实现者：产出 team-site-test/ 全部站点文件（HTML/CSS/JS）'), 'engineer')
})

test('a kimi-engineer role with a team-site-test/ directory hits engineer', () => {
  assert.equal(memberRoleSlug('kimi-engineer', '实现者 engineer：产出 team-site-test/ 全部站点文件（HTML/CSS/JS），零外部依赖'), 'engineer')
})

test('a qwen-security role with a verify.ps1 file name and a security/audit self-description hits security, not qa', () => {
  assert.equal(memberRoleSlug('qwen-security', '评审者 security/audit：独立复核交付物与 verify.ps1 真实性，给出 pass / needs_revision 与问题清单'), 'security')
})

/** t9 kept as a miss: audio must not be stretched into a match */
test('an audio engine hits the audio role (it has had its own role since 2026-10-05, so no fallback art)', () => {
  assert.equal(memberRoleSlug('audio', '音频引擎：程序化音色合成、BPM 主时钟、Loop Pad 触发、混音总线、录音导出'), 'audio')
  assert.equal(memberRoleSlug('synth', '音频引擎：程序化音色合成、BPM 主时钟、Loop Pad 触发、混音总线、录音导出'), 'audio')
})

/** t9 negative case: guard against over-broadening */
test('English words containing the substring art must not hit designer by mistake', () => {
  assert.equal(memberRoleSlug('party', '聚会活动策划'), null)
  assert.equal(memberRoleSlug('cart', '购物车逻辑'), null)
  assert.equal(memberRoleSlug('chart', '图表组件库'), null)
  assert.equal(memberRoleSlug('start', '启动流程优化'), null)
})

test('a path-like or file-like token on its own never triggers a role match', () => {
  assert.equal(memberRoleSlug('foo', 'team-site-test/ verify.ps1 curl.exe HTML/CSS/JS'), null)
})

test('a test platform / quality report hits data by the established priority (report precedes qa)', () => {
  assert.equal(memberRoleSlug('plat-qa', '测试平台与质量报表开发'), 'data')
})

/** t11 matching wrap-up: battle/scoring go into data, audio stays unmatched */
test('battle-layer wording such as combo, scoring and accuracy hits data', () => {
  assert.equal(memberRoleSlug('battle', '战局层：节拍准确度判定、连击加分、每 16 拍欢呼与中心结算飞向右上角'), 'data')
  assert.equal(memberRoleSlug('scorer', '战局层：节拍准确度判定、连击加分、每 16 拍欢呼与中心结算飞向右上角'), 'data')
})

test('video and animation hit the video role (they do not compete with the designer motion wording)', () => {
  assert.equal(memberRoleSlug('video', '视频渲染与剪辑'), 'video')
  assert.equal(memberRoleSlug('anim', '逐帧动画与字幕'), 'video')
})

/** t11 counter-negative cases: the new data words must not be over-broadened */
test('test wording such as judging pass/fail still lands on qa and is not taken over by data', () => {
  assert.equal(memberRoleSlug('tester', '判定 pass/fail 的测试用例'), 'qa')
})

test('wording about assessing risk still lands on security and is not taken over by data', () => {
  assert.equal(memberRoleSlug('risk', '评估风险与威胁'), 'security')
})

test('settlement-report wording hits data by the established priority (the report keyword)', () => {
  assert.equal(memberRoleSlug('accounting', '结算报表开发'), 'data')
})
