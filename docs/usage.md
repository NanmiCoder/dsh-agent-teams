# Usage Guide (detailed)

This document collects the detailed usage of dsh-agent-teams: how it works, Web UI behavior, tool reference, configuration, and known limits. The README keeps only the introduction and quick start.

## How it works

`dsh-agent-teams` reuses DSH capability seams instead of depending on a workflow engine:

| DSH capability | AgentTeams usage |
|---|---|
| `ctx.tools` registry | Registers 10 `agent_teams_*` tools (same registration path as `tool-workflow`) |
| `ctx.subagents.startContinuable()` | Creates members: durable continuable subagents with a member persona |
| `ctx.subagents.followup()` | Wakes the recipient member (messages enter its next turn) |
| `ctx.subagents.listChildren()` + `ctx.agents` | The former discovers durable members; the latter provides real `running / idle / ready` activity status |
| `agent/status` | After a member becomes idle, triggers automatic claims from the shared task pool and the next round of wake-ups |
| `ctx.systemPrompt.section()` | Registers the "AgentTeams usage policy" prompt section |
| Web server route registration | Activity panel data route `/plugins/dsh-agent-teams/state` + whale artwork static serving (dual-key `webServer`/`httpServer` compatibility, see below) |
| File system | Team state persists under `<workspace>/.agent-teams/<teamId>/` |

Data chain: tool execution → disk state (source of truth) → host snapshot route → floater 1s polling render; the session log also records `agent-teams/*` events (audit/replay/retrospective).

> **Beta version compatibility**: npm `latest` (`0.0.1-rc.1`) still uses the service keys `ctx.httpServer` / `ctx.workspace`; later `next` (`rc.2`) renames them to `ctx.webServer` / `ctx.workspaceRegistry`. The plugin probes both key sets (new keys first, old keys as fallback, and listens to `internal/service` events for both), so routes register on both versions.

### Web UI

- **Top-right activity panel** (body-portal floater): auto-expands after a team is created; each team shows the captain, segmented overall progress, status stats, a collapsible member tree, and a compact task DAG. The DAG connects dependencies with real SVG curves; hover or keyboard focus previews the full upstream/downstream chain, click pins, `Esc` unpins; the selected node shows its assignee, unsatisfied prerequisites, and downstream unlocks. Member rows show the role avatar, role, live status, and task chips; clicking opens the member's sub-session. The collapsed state is a small top-right badge (team count + activity pulse dot).
- **Whale mascots**: captain/member avatars are DeepSeek whale role illustrations (`assets/agent-teams/`, 8 roles + 6 actions), matched by role keywords; the status action thumbnail switches with member state and animates (working float / idle breathing / unknown thinking); unread messages add an outer glow ring around the avatar; honors `prefers-reduced-motion`.
- **Session following**: the panel only shows the **current session's** teams (matched by `captainSessionId`); a new session collapses the panel, switching back to the team session restores it.
- **Conversation card**: when a team is created, a lightweight card appears in the conversation (member overview, click to jump to a member session, "Activity panel" button re-activates a closed floater).
- **Historic review**: `agent_teams_delete` **archives** the team (`<stateRoot>/archive/<teamId>/`, keeping members, tasks, dependency graph, and mailboxes intact); when a team ends, members are marked removed, but the historic snapshot still shows the whole roster in an idle/delivered state, so tasks don't linger while members disappear. Opening the historic session and clicking the card restores the same member tree and DAG.

### Team state files

```
<workspace>/.agent-teams/<teamId>/
├── team.json            # Team record: members, tasks (with dependencies), task sequence
└── inbox/
    ├── captain.jsonl    # Captain mailbox (members → captain)
    └── <member>.jsonl   # One mailbox per member (JSONL)
```

Task state machine: `pending → claimed → in_progress → completed | failed | cancelled`. Each execution carries a monotonic `attempt` plus a unique `attemptId`; reassignment first invalidates the old attempt, then interrupts and waits for the old member to quiesce, so late updates cannot overwrite the new result. Claims validate dependencies and forbid a member from holding two unfinished tasks at once.

## Tool reference

| Tool | Purpose |
|---|---|
| `agent_teams_create` | Creates the team; the caller becomes captain (one captain leads one team at a time) |
| `agent_teams_add_member` | Adds a member (spawn continuable subagent + member persona) |
| `agent_teams_remove_member` | Safely removes a member: revokes attempts, reclaims unfinished tasks, waits for interruption to converge, then reschedules |
| `agent_teams_create_task` | Creates a task with optional `dependencies` and `assignee` |
| `agent_teams_reassign_task` | Atomically retries/reassigns a task; `assignee=captain` means safe captain takeover |
| `agent_teams_claim_task` | Claims a task (validates dependencies; the captain can claim on behalf of others, members can only claim their own or unassigned work) |
| `agent_teams_update_task` | Advances a task carrying the current `attempt_id`; rejects stale attempts and terminal-result overwrites |
| `agent_teams_send_message` | Any member → any member/captain: messages land directly in the recipient's mailbox and wake them (no captain relay; impersonated `from` is rejected) |
| `agent_teams_status` | Full team overview: member activity, task list, captain mailbox, unread messages per member |
| `agent_teams_delete` | Ends the team: interrupts members, the team directory is **archived** (tasks, dependency graph, and mailboxes fully preserved) |

`agent_teams_add_member` needs no model parameters by default: when a member follows the captain's current LLM provider/model, it snapshots the captain's current reasoning effort. When the user explicitly asks for a different model for a role, the optional `provider` + `model` can be passed together; overriding only `model` keeps the captain's current LLM provider. When either provider or model changes, the reasoning effort automatically uses the target model's default; when the user explicitly asks for a specific effort for a member, the optional `reasoning_effort` can be passed (a supported effort id of the target model, or `"default"` to force the model's own default). The plugin never prompts per-member or shows dialogs.

## Configuration

Override in the profile's `cordis.patch.yml`:

```yaml
- id: agent-teams
  config:
    stateDir: .agent-teams        # Team state directory name (under the workspace)
    memberProvider: spawn         # Subagent runtime backend (spawn / fork), not an LLM provider
    memberModel: deepseek-v4      # Optional: member model override
    memberMaxDepth: 1             # Member delegation depth cap (0 = forbidden)
    maxMembers: 8                 # Team size cap
```

Final precedence: explicit member `provider` + `model` / `model` → `memberModel` → captain's current route. Members following the captain's current provider/model inherit the captain's reasoning effort; changing either provider or model automatically uses the target model's default. An explicit `reasoning_effort` (a supported effort id of the target model, or `"default"`) wins and is validated before creation on the target provider/model; incompatible values fail member creation explicitly. The resolved provider/model/reasoning effort is written to `team.json`, used by status queries and member cold recovery.

## Usage protocol

The plugin's prompt section guides the model to follow the protocol: build the team → add members by role → break down tasks and declare dependencies → the shared scheduler automatically claims and wakes idle members → the captain monitors/guides → when blocked, safely reassign or take over first → report, then `agent_teams_delete`. Members can message each other directly without captain relay. If a member becomes `idle/ready` after an interruption, abnormal exit, or process restart while still holding a `claimed/in_progress` task on disk, the scheduler revokes the old capability, generates a new attempt, and wakes the same member again.

## Known limits

- Scheduling is event-driven, not resident polling; while the captain is offline, members cannot be cold-recovered, tasks and messages stay on disk and are delivered once the captain recovers or calls a status tool.
- One captain leads one team at a time (consistent with Claude Code AgentTeams).
- The member persona replaces the deployment default persona; members still have the full toolset (bash/fs/web etc.).
- Team state is file-level persistence; multiple processes operating on the same team are not guaranteed consistent (serialized with locks inside one dsh process).
- The activity panel reads disk truth (1s polling), independent of the session log event stream.
- The top-right floater mounts through a body portal; on wide screens the main conversation column smoothly yields space to the left, narrow screens fall back to overlay mode, and the left navigation stays put.
- Members (models) do not always strictly follow the tool "ritual" (e.g. not calling `agent_teams_update_task` when done) — the panel truthfully reflects disk state, and the captain consolidates from `agent_teams_status`/files.

## Verification

- Offline and lifecycle: `pnpm build && pnpm typecheck && pnpm verify`. Besides the basic checks, this includes a failure matrix on an 8-member, 31-node multi-layer DAG (expanding to 38 tasks at runtime): concurrent takeover/removal, 50 late writes, 4 open tasks cold-restarted, 7-way claim contention, 40 terminal overwrites, 42-message bursts, and final archiving; composition check `dsh --profile agent-teams-check --dump-config`
- Real e2e: `dsh plugin --profile headless add <path>` then `dsh --profile headless "Use AgentTeams …"`, then verify `.agent-teams/` state files and the session log event stream
- GUI: standalone instance + ego-browser (see `verification-guide.md`)
