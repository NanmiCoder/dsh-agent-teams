/**
 * Durable AgentTeams state types.
 *
 * A team is one directory under the state root holding `team.json` plus an
 * `inbox/` of per-agent JSONL mailboxes. Members are continuable subagents
 * whose durable child session ids are recorded in the team file, so a team
 * survives harness restarts.
 * @module dsh-agent-teams/types
 */

import type { MemberToolFilter } from './tool-policies.ts'

/** Task lifecycle statuses in progression order. */
export type TaskStatus =
  | 'pending'
  | 'claimed'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** Statuses after which a task can no longer be claimed or worked on. */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'failed', 'cancelled']

/** Structured quality-gate kind. Absent / unknown values are treated as `work`. */
export type TaskKind =
  | 'requirements'
  | 'implementation'
  | 'verification'
  | 'review'
  | 'repair'
  | 'integration'
  | 'work'

export const TASK_KINDS: readonly TaskKind[] = [
  'requirements',
  'implementation',
  'verification',
  'review',
  'repair',
  'integration',
  'work',
]

/** Review / requirements conclusion. Only `pass` may complete those kinds. */
export type ReviewVerdict = 'pass' | 'needs_revision' | 'reject'

export const REVIEW_VERDICTS: readonly ReviewVerdict[] = ['pass', 'needs_revision', 'reject']

/** Finding severity used by review / requirements output. */
export type FindingSeverity = 'low' | 'medium' | 'high' | 'blocker'

export const FINDING_SEVERITIES: readonly FindingSeverity[] = ['low', 'medium', 'high', 'blocker']

/** One structured review finding. */
export interface ReviewFinding {
  /** Stable id, for example `SEC-001`. */
  id: string
  severity: FindingSeverity
  file?: string
  line?: number
  problem: string
  requiredFix: string
  resolved?: boolean
}

/** One acceptance criterion result recorded at completion. */
export interface AcceptanceResult {
  criterion: string
  status: 'passed' | 'failed'
  evidence?: string
}

/** One verification command result recorded at completion. */
export interface CommandResult {
  command: string
  status: 'passed' | 'failed'
  exitCode?: number
  evidence?: string
}

/**
 * Identity of one workspace path at one instant. A verdict is evidence about a
 * revision, so recording the bytes it judged (not only the task id) lets the
 * delivery check refuse to advertise a revision no review ever saw.
 */
export interface ArtifactDigest {
  /** Workspace-relative POSIX path. */
  path: string
  /** Whether a regular file existed when the digest was taken. */
  present: boolean
  /** Lowercase hex sha256 of the file bytes; absent unless the file was read. */
  sha256?: string
  /** File size in bytes; absent unless the file was read. */
  size?: number
  /** File mtime in epoch ms; lets a legacy record detect a later edit. */
  mtimeMs?: number
  /**
   * The path exists but could not be read or safely resolved (permissions,
   * symlink escaping the workspace, I/O error). Never conflated with "absent":
   * unreadable bytes cannot be claimed as unchanged.
   */
  unreadable?: boolean
  /** Why the path could not be read, when `unreadable` is set. */
  reason?: string
}

/**
 * A declared scope that could not be fully enumerated (file cap reached,
 * unreadable directory, path that is not workspace-relative). Recorded so a
 * partial artifact list is never mistaken for complete coverage.
 */
export interface ArtifactScopeGap {
  /** The pattern or path that could not be fully resolved. */
  pattern: string
  reason: string
}

/** One set of artifact digests captured at a single instant. */
export interface ArtifactSnapshot {
  /** Epoch ms when these bytes were read. */
  at: number
  artifacts: ArtifactDigest[]
  /** Present when the recorded coverage is known to be incomplete. */
  gaps?: ArtifactScopeGap[]
}

/** Profile / team review-loop limits. */
export interface ReviewPolicy {
  requirementsMinRounds?: number
  requirementsMaxRounds?: number
  codeMaxRounds?: number
  maxRepairAttempts?: number
  requiredReviewers?: string[]
}

/** One captain-only contract amendment recorded on a quality task. */
export interface TaskRevision {
  /** Epoch ms when the amendment was applied. */
  at: number
  /** Identity that applied it (`captain`). */
  by: string
  /** Why the previous contract was wrong; kept for the audit trail. */
  reason: string
  /** Amended contract field names (`objective`, `acceptance`, …). */
  fields: string[]
  /** Previous values of the amended fields; fields absent before are omitted. */
  previous: Record<string, unknown>
}

/** Append-only observations; never replace the terminal verdict or unlock a gate. */
export interface TaskEvidence {
  at: number
  by: string
  attempt: number
  attemptId?: string
  note?: string
  acceptanceResults?: AcceptanceResult[]
  commandsRun?: CommandResult[]
}

/** One task of a team's task list. */
export interface TeamTask {
  /** Stable task id from the profile template; absent for ad-hoc tasks. */
  profileSeedId?: string
  /** Stable task id within the team (`t1`, `t2`, …). */
  id: string
  /** Brief title for the task. */
  subject: string
  /** What needs to be done. */
  description?: string
  status: TaskStatus
  /** Member name (or `captain`) the task is assigned to; unassigned tasks await a claim. */
  assignee?: string
  /** Task ids that must reach `completed` before this task can be claimed. */
  dependencies: string[]
  /** The worker's written result, set when the task completes or fails. */
  output?: string
  /** Monotonic execution generation. Reassignment/retry invalidates every older attempt. */
  attempt?: number
  /** Capability for the current claimed/in-progress attempt. Members must present it when updating. */
  attemptId?: string
  /** Opaque generation for a revocation/handoff that has not started its next attempt yet. */
  handoffId?: string
  /** Previous activation retained until a handoff drain succeeds (retryable). */
  handoffFromMemberId?: string
  /** A handoff is quiescing the old owner; the scheduler must not dispatch it yet. */
  reassigning?: boolean
  /** Quality-gate kind. Missing values are treated as `work`. */
  kind?: TaskKind
  /** Review / requirements / repair loop index, 1-based when present. */
  round?: number
  verdict?: ReviewVerdict
  findings?: ReviewFinding[]
  objective?: string
  inScope?: string[]
  outOfScope?: string[]
  acceptance?: string[]
  verify?: string[]
  deliverables?: string[]
  nonGoals?: string[]
  changedPaths?: string[]
  acceptanceResults?: AcceptanceResult[]
  commandsRun?: CommandResult[]
  /** Supplemental observations, attributed to their original execution generation. */
  supplementalEvidence?: TaskEvidence[]
  reviewedTaskId?: string
  /** Execution generation of the reviewed task at the moment of judgment. */
  reviewedAttempt?: number
  /**
   * Bytes this verdict judged, read from the workspace when the gate closed.
   * A later edit, deletion or re-attempt invalidates the verdict.
   */
  reviewedArtifacts?: ArtifactDigest[]
  /** Scope of that verdict that could not be fully enumerated, if any. */
  reviewedGaps?: ArtifactScopeGap[]
  /**
   * Scope patterns the verdict bound (e.g. `lib/`). A file that appears under
   * one of them later was never reviewed, so the verdict must not claim it.
   */
  reviewedScope?: string[]
  /**
   * Drift observed while this verdict was being formed (the workspace changed
   * between claim and close). The verdict cannot be read as binding a stable
   * revision.
   */
  reviewedDuringDrift?: string[]
  /**
   * Workspace snapshot taken when this verdict's attempt started, so a close
   * can tell whether it judged a revision that was changing underneath it.
   */
  verdictStartSnapshot?: ArtifactSnapshot
  /**
   * Workspace snapshot an auto-generated contract (acceptance / inScope /
   * verify) was derived from. When a cited artifact changes underneath it the
   * work order is marked stale instead of being read as authoritative.
   */
  contractSnapshot?: ArtifactSnapshot
  /** Repair source: the implementation / previous successful artifact. */
  sourceTaskId?: string
  /**
   * The failed gate task(s) whose findings this repair fixes. Recorded as an
   * explicit causal edge because `dependencies` cannot carry it: a failed task
   * never reaches `completed`, so a dependency on it would make the repair
   * permanently unclaimable. Delivery reads this to tell a closed loop from
   * genuinely unresolved work (issue #175A).
   */
  findingSourceTaskIds?: string[]
  sourceFindingIds?: string[]
  /** User-constraint / goal items this task claims to cover. */
  coverageOf?: string[]
  /** Captain-only contract amendments, oldest first (see amendTaskContract). */
  revisions?: TaskRevision[]
  createdAt: number
  updatedAt: number
}

/** Member lifecycle status. */
export type MemberStatus = 'idle' | 'working' | 'removed'

/** One team member: a continuable subagent plus its team-side record. */
export interface TeamMember {
  /** Durable continuable subagent session id (empty until spawned). */
  id: string
  /** Unique display name inside the team. */
  name: string
  /** Role description, e.g. `researcher`, `engineer`, `reviewer`. */
  role?: string
  /** Resolved LLM provider route captured when this member was created. */
  provider?: string
  /** Resolved model captured when this member was created. */
  model?: string
  /** Resolved reasoning effort captured from the captain or target model default. */
  reasoningEffort?: string
  /** Prompt specific to this member's execution turns. */
  executionPrompt?: string
  /** Configured second-choice route. */
  fallback?: TeamModelFallback
  /** Active route after fallback, without changing the primary descriptor route. */
  activeProvider?: string
  activeModel?: string
  /** Whether the fallback route is currently active. */
  fallbackActive?: boolean
  /**
   * Owner-declared tool-policy id this member selected (`#59`), absent for a
   * member without a policy (the unchanged default behavior). The Captain
   * model may only select a configured id; it never submits raw tool lists.
   */
  toolPolicy?: string
  /**
   * The immutable effective tool filter resolved when the member was created
   * and handed to the child's `toolFilter`. `team.json` keeps it for audit,
   * status, and recovery diagnostics; the continuable descriptor remains the
   * authority that reapplies the filter to a cold-resumed child.
   */
  toolFilter?: MemberToolFilter
  /** Exact child-scoped setup restored on hosts with managed activations. */
  runtimeSetup?: { persona: string; toolFilter: MemberToolFilter }
  joinedAt: number
  status: MemberStatus
  /** Execution admission is closed while a failed/pending handoff is drained. */
  stopping?: boolean
  /**
   * Last member-start failure, recorded so the captain can see why a member
   * never acquired a session instead of observing an unexplained `unspawned`
   * member. Cleared by the next successful start.
   */
  spawnError?: string
}

/** One mailbox message. */
export interface TeamMessage {
  id: string
  /** `captain` or a member name. */
  from: string
  /** `captain` or a member name. */
  to: string
  content: string
  ts: number
  /** Process-local delivery lease; prevents fallback and direct delivery racing. */
  deliveryClaimedAt?: number
  /** Set after the durable message was accepted by the recipient's live Harness inbox. */
  deliveredAt?: number
  /** Set once the recipient has consumed or been shown the durable fallback. */
  readAt?: number
  /** Guidance is scoped to the recipient's execution generation, when present. */
  taskId?: string
  attemptId?: string
  /** Source execution generation, independent of the recipient guidance generation. */
  sourceTaskId?: string
  sourceAttemptId?: string
  sourceTaskStatus?: TaskStatus
  /** Cancelled delivery is retained for audit but must not wake the recipient. */
  discardedAt?: number
  /**
   * PM observation copy: set when this message is a read-only CC to the PM
   * of an inter-member conversation. The PM persona uses this flag to
   * distinguish observations from direct messages and avoid replying.
   */
  observation?: boolean
}

/** Snapshot of the named profile used to seed a team. */
export interface TeamModelFallback {
  provider: string
  model: string
}

export interface TeamProfileSnapshot {
  name: string
  description?: string
  protocol?: string
  executionPrompt?: string
  fallback?: TeamModelFallback
  /** Frozen planning mode: captain plans the graph; seed keeps template tasks. */
  taskPlanning?: 'captain' | 'seed'
  /** Frozen review-loop policy from the creating profile. */
  reviewPolicy?: ReviewPolicy
}

/** The full durable team record. */
export interface TeamState {
  /** Original team name. */
  name: string
  /** Sanitized directory id; the team's stable identity. */
  id: string
  /** Team purpose/goal. */
  description?: string
  /** Immutable named profile snapshot, when created from a profile. */
  profile?: TeamProfileSnapshot
  /** Session id of the captain agent that owns this team. */
  captainSessionId: string
  createdAt: number
  /** Teammates only; the captain is implicit (the owning session). */
  members: TeamMember[]
  tasks: TeamTask[]
  /** Monotonic task id counter. */
  taskSeq: number
  /**
   * Two-phase execution lifecycle. Missing means `running` for durable
   * compatibility with teams created before staging existed.
   */
  phase?: 'staged' | 'running'
  /**
   * Human-facing review sub-state while `phase` is `staged`. Missing staged
   * records are treated as `awaiting_review` for backward compatibility.
   * `awaiting_feedback` means the user returned to chat and the Captain must
   * ask what should change before editing this same draft.
   */
  planReviewState?: 'awaiting_review' | 'awaiting_feedback'
  /** Timestamp written only after a staged plan is explicitly approved. */
  approvedAt?: number
  /**
   * Human halt from the captain chat. The team remains on disk, members stay
   * available, and unfinished work is cancelled until the captain resumes.
   */
  halted?: boolean
  /** Timestamp of the latest human halt, when present. */
  haltedAt?: number
  /** Review-loop policy snapshot copied from the creating profile, when present. */
  reviewPolicy?: ReviewPolicy
  /** Set when an automatic review/repair loop hits its configured ceiling. */
  escalated?: boolean
  /**
   * Session ids explicitly authorized to lead this team in addition to the
   * original `captainSessionId` and its fork descendants. Populated by
   * `agent_teams_adopt` so a new session can take over an existing team left
   * behind by a previous captain session that is no longer live. A listed
   * session still must not be a current member session.
   */
  authorizedLeads?: string[]
}
