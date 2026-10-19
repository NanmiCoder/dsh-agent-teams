/**
 * Owner-declared, reusable per-member tool policies (#59).
 *
 * A deployment owner declares reusable policies under `toolPolicies`; a member
 * *selects* one by id (`tool_policy` on `agent_teams_add_member`, an inline
 * plan member, or a profile member row). The Captain model can therefore only
 * choose an existing policy — it can never submit raw allow/deny lists or
 * invent one at runtime.
 *
 * One pure resolver turns the selection into the immutable effective filter
 * that is persisted on the member (`toolPolicy` + `toolFilter`) and handed to
 * the existing `startContinuable({ toolFilter })` seam, which hides the named
 * tools from the child's schemas and rejects their execution. This is tool
 * visibility / invocation policy for global tools, not an OS sandbox.
 *
 * Invariants (issue #59):
 * 1. the captain-only deny list always applies and cannot be undone by a
 *    policy — the host intersects `allow` and `deny`, so a denied name never
 *    becomes visible again;
 * 2. the four member coordination tools stay available, and a policy may not
 *    deny them;
 * 3. an allow-list policy explicitly includes those coordination tools;
 * 4. the effective deny list is the union of the policy deny list and the
 *    captain-only deny list.
 * @module dsh-agent-teams/tool-policies
 */

import { CAPTAIN_TOOL_NAMES, MEMBER_TOOL_NAMES, PM_EXTRA_TOOL_NAMES, isPmMemberName } from './tool-names.ts'

/** Host tools denied when member delegation is switched off (`memberMaxDepth: 0`). */
const DEPTH_DENY_TOOLS = ['subagent', 'send_message'] as const

/** The PTC presentation transport is reserved and cannot be named by a filter. */
const RESERVED_TOOL_NAME = 'run_code'

/**
 * Deny names the lenient spawn retry may drop when the host reports them
 * unknown: exactly the built-in captain-only and depth entries (#163/#164).
 * Names an owner policy declares are never relaxed — a policy that the host
 * cannot apply must fail loud instead of silently applying a different one.
 */
export const BUILTIN_DENY_TOOLS: readonly string[] = [...CAPTAIN_TOOL_NAMES, ...DEPTH_DENY_TOOLS]

/** One owner-declared reusable member tool policy. */
export interface MemberToolPolicy {
  /** Global tool names that stay visible; coordination tools are added automatically. */
  allow?: string[]
  /** Global tool names removed from visibility; captain-only tools are added automatically. */
  deny?: string[]
}

/** The immutable effective filter of one member. */
export interface MemberToolFilter {
  /** Visible global tools; absent means "no allow-list" (everything not denied stays). */
  allow?: string[]
  /** Removed global tools; never empty (the captain-only deny list is always included). */
  deny: string[]
}

/** How the running host resolves the depth entries; both fields are optional. */
export interface ToolPolicyContext {
  /** Member delegation depth cap; `0` denies the host delegation tools when they exist. */
  maxDepth?: number
  /** Names the host's `tools.restrict()` would admit, or undefined without a registry view. */
  knownTools?: ReadonlySet<string>
  /**
   * Member name this filter is being resolved for. When the name is `pm`
   * (case-insensitive), the PM scheduling proxy tools (`PM_EXTRA_TOOL_NAMES`)
   * are removed from the captain-only deny list so the PM can create, reassign,
   * amend tasks and hot-swap member models. Other members keep the default
   * captain-only deny list.
   */
  memberName?: string
}

/** Trim, drop blanks, and de-duplicate names, preserving first-seen order. */
export function dedupeToolNames(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    result.push(name)
  }
  return result
}

/**
 * Validate and normalize one declared policy. Empty policies and empty lists
 * are configuration mistakes: an `allow: []` policy would hide even the
 * coordination tools, and a policy with neither list restricts nothing.
 * Denying a required coordination tool is rejected for the same reason.
 * @param id - the policy id, used in error messages.
 * @param policy - the declared policy.
 * @returns the normalized policy (trimmed, de-duplicated, blanks dropped).
 */
export function normalizeToolPolicy(id: string, policy: MemberToolPolicy): MemberToolPolicy {
  const allow = policy.allow === undefined ? undefined : dedupeToolNames(policy.allow)
  const deny = policy.deny === undefined ? undefined : dedupeToolNames(policy.deny)
  if (allow === undefined && deny === undefined) {
    throw new Error(`tool policy "${id}" must declare "allow" and/or "deny"`)
  }
  if (allow !== undefined && allow.length === 0) {
    throw new Error(`tool policy "${id}" has an empty allow list`)
  }
  if (deny !== undefined && deny.length === 0) {
    throw new Error(`tool policy "${id}" has an empty deny list`)
  }
  const reserved = [...allow ?? [], ...deny ?? []].filter(name => name === RESERVED_TOOL_NAME)
  if (reserved.length > 0) {
    throw new Error(`tool policy "${id}" names the reserved presentation transport "${RESERVED_TOOL_NAME}"`)
  }
  const required = (deny ?? []).filter(name => MEMBER_TOOL_NAMES.includes(name))
  if (required.length > 0) {
    throw new Error(
      `tool policy "${id}" denies required member coordination tool${required.length > 1 ? 's' : ''} ${required.join(', ')}; those tools stay available to every member`,
    )
  }
  return {
    ...allow === undefined ? {} : { allow },
    ...deny === undefined ? {} : { deny },
  }
}

/**
 * Validate every configured policy once, at plugin mount, so a malformed
 * deployment config fails loud instead of at the first member creation.
 * @param raw - the configured `toolPolicies` map.
 * @returns normalized policies keyed by trimmed id.
 */
export function parseToolPolicies(raw: Record<string, MemberToolPolicy> | undefined | null): Record<string, MemberToolPolicy> {
  // Null-prototype: a policy id is data, so `constructor`, `toString`, or
  // `__proto__` must never resolve through the object prototype.
  const policies: Record<string, MemberToolPolicy> = Object.create(null) as Record<string, MemberToolPolicy>
  for (const [rawId, policy] of Object.entries(raw ?? {})) {
    const id = rawId.trim()
    if (id === '') throw new Error('configured toolPolicies include an empty policy id')
    if (Object.hasOwn(policies, id)) throw new Error(`configured toolPolicies include duplicate policy id "${id}"`)
    policies[id] = normalizeToolPolicy(id, policy)
  }
  return policies
}

/**
 * The policy behind one selected id, or `undefined` when this deployment no
 * longer declares it (a config change after the member was created). Used on
 * paths that must not fail a durable record merely because the owner edited
 * configuration; selection itself uses {@link requireToolPolicy}.
 * @param policies - normalized configured policies.
 * @param id - the selected policy id.
 * @returns the declared policy, or undefined.
 */
export function optionalToolPolicy(policies: Record<string, MemberToolPolicy>, id: string): MemberToolPolicy | undefined {
  return Object.hasOwn(policies, id) ? policies[id] : undefined
}

/**
 * The deny names one spawn may relax for a member that selected a policy.
 *
 * The built-in captain/depth entries keep the #163/#164 recovery path, but a
 * name the owner explicitly declared in the policy's own `deny` list is never
 * relaxable — even when it is also a built-in entry (`send_message` and
 * `subagent` are depth entries, and every captain-only name is a built-in
 * deny). Dropping such a name would spawn the member under a different policy
 * than the owner declared, which is contract drift rather than recovery.
 * @param policy - the member's selected policy, or undefined when the member
 *   selected none (or the id is no longer configured).
 * @param policySelected - whether the member selected a policy at all. A
 *   selected id whose policy is no longer configured relaxes nothing, so the
 *   member fails loud instead of spawning under an unknown filter.
 * @returns the deny names the lenient retry may drop.
 */
export function memberSpawnRelaxableDeny(policy: MemberToolPolicy | undefined, policySelected = policy !== undefined): readonly string[] {
  if (!policySelected) return BUILTIN_DENY_TOOLS
  if (policy === undefined) return []
  const ownerDeny = new Set(policy.deny ?? [])
  return BUILTIN_DENY_TOOLS.filter(name => !ownerDeny.has(name))
}

/**
 * The policy behind one selected id. A model-facing selection may only name a
 * policy the deployment owner declared, so an unknown id is an error raised
 * before any member is persisted.
 * @param policies - normalized configured policies.
 * @param id - the selected policy id.
 * @returns the declared policy.
 */
export function requireToolPolicy(policies: Record<string, MemberToolPolicy>, id: string): MemberToolPolicy {
  // Own-property lookup only: `constructor`, `toString`, and `__proto__` are
  // unknown ids, not accidentally inherited functions.
  const policy = Object.hasOwn(policies, id) ? policies[id] : undefined
  if (policy === undefined) {
    const available = Object.keys(policies).sort()
    throw new Error(
      `unknown tool policy "${id}"${available.length === 0
        ? ' (no toolPolicies are configured in this deployment)'
        : ` (configured: ${available.join(', ')})`}`,
    )
  }
  return policy
}

/**
 * Turn a selected policy (or no policy) into the immutable effective filter.
 *
 * Without `knownTools` the host's delegation names are forwarded verbatim, as
 * before #163: the spawn retry drops whatever the host reports unknown.
 * @param policy - the normalized policy, or undefined for the legacy behavior.
 * @param context - depth cap and the host's restrictable-name view.
 * @returns the effective filter handed to `startContinuable`.
 */
export function resolveMemberToolFilter(policy: MemberToolPolicy | undefined, context: ToolPolicyContext = {}): MemberToolFilter {
  if (policy !== undefined && policy.allow === undefined && policy.deny === undefined) {
    throw new Error('a tool policy must declare "allow" and/or "deny"')
  }
  const depthDeny = context.maxDepth === 0
    ? DEPTH_DENY_TOOLS.filter(name => context.knownTools === undefined || context.knownTools.has(name))
    : []
  // The PM scheduling proxy keeps the captain-only deny list minus the PM
  // scheduling tools, so it can create/reassign/amend tasks and hot-swap
  // member models. Other members keep the full captain-only deny list.
  const captainDeny = isPmMemberName(context.memberName)
    ? CAPTAIN_TOOL_NAMES.filter(name => !PM_EXTRA_TOOL_NAMES.includes(name))
    : CAPTAIN_TOOL_NAMES
  const deny = dedupeToolNames([...(policy?.deny ?? []), ...captainDeny, ...depthDeny])
  if (policy?.allow === undefined) return { deny }
  // A denied name can never be re-admitted: allow and deny intersect in the
  // host, and the snapshot must say the same thing the host will enforce.
  const allow = dedupeToolNames([...policy.allow, ...MEMBER_TOOL_NAMES]).filter(name => !deny.includes(name))
  if (allow.length === 0) throw new Error('a tool policy allow list cannot be empty once captain-only tools are removed')
  return { allow, deny }
}
