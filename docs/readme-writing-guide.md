## DSH plugin README writing guide

> Section templates and writing rules to follow when a coding agent writes a DeepSeek Harness plugin README.
> Distilled from the multi-round iteration of the `dsh-agent-teams` production README (complete structure: features/how-it-works/UI/tools/install/config/usage/verification/limits), cross-checked against the style of package READMEs inside the DSH repo (`packages/preset`, `packages/bundle`, `packages/client/ui-workflow-run`: concise, tabular).

### 0. Language and length strategy

- **Standalone plugin projects** (aimed at install users, e.g. `dsh-agent-teams`): English-first, with commands, tool names, identifiers, and field names kept in English; explanatory sentences in English.
- **DSH in-repo packages** (`packages/*/README.md`): English-first, one-paragraph intro + sections + tables, each section no more than a few paragraphs; in-repo READMEs are for maintainers/contributors, no "install/usage" tutorial needed.
- This template is isomorphic across both scenarios: same structure order, switch language and detail by audience.
- Length: standalone plugin READMEs cap at 200–400 lines; anything longer means a section is piling up implementation detail (see the §2 avoidance list).

### 1. Structure template (H1 section order)

| Order | Section | Write | Don't write |
|---|---|---|---|
| 1 | Intro (paragraph under the title) | One-sentence value (what users can do after installing) + 3–5 core features (bold keywords) | Version history, Roadmap, acknowledgments |
| 2 | `## How it works` | Capability-seam table + one-sentence data flow + one-sentence state machine (see §2) | Architecture diagrams, pasted source code, implementation-detail piles |
| 3 | `## Web UI` (if any) | Panel shape, mount location, interaction points, data chain | Every CSS class, animation parameter, one by one |
| 4 | `## Tool reference` | Table: tool name | purpose (one sentence, including key semantics/boundaries) | full tool parameter schemas |
| 5 | `## Install` | Commands + when they take effect (restart/HMR) + alternatives | Internal build-chain mechanics |
| 6 | `## Configuration` | Config item table + one YAML example | Source provenance of each config |
| 7 | `## Usage` | One paragraph + 1 copy-pasteable example instruction | Full conversation scripts |
| 8 | `## Verification` | Three layers: 0 real verified records / 1 offline / 2 e2e (see §4) | Writing "not verified" as "verified" |
| 9 | `## Known limits` | Each item = symptom + cause/impact + mitigation (see §5) | Self-criticism, complaints without mitigation |
| 10 | `## License` | License name | — |

### 2. How to write "How it works"

**Open with a capability-seam table** (this is the architectural language of DSH plugins — everything is a plugin, capabilities are seams):

```markdown
`<plugin name>` reuses DSH capability seams instead of reinventing them:

| DSH capability | Plugin usage |
|---|---|
| `ctx.tools` registry | Registers N `xxx_*` tools (same registration path as `tool-workflow`) |
| `ctx.subagents.startContinuable()` | Creates members: durable continuable subagents |
| `ctx.systemPrompt.section()` | Registers the usage-policy prompt section |
| `ctx.httpServer.register()` | Serves the panel data route `/plugins/xxx/state` |
| File system | State persists under `<workspace>/.xxx/<id>/` |
```

- The table lists the capabilities **actually used**, one line "DSH capability → plugin usage" each; it is the fastest way for readers to judge "how does this plugin fit into DSH".
- After the table, add a **one-sentence data flow**: "tool execution → disk state (source of truth) → host snapshot route → floater polling render. Session log events keep being written (replay/audit)." (One directional chain — no ASCII art diagrams.)
- **One-sentence state machine**: "Task state machine: `pending → claimed → in_progress → completed | failed | cancelled`, transitions validated against a whitelist." (Any state machine that fits in one sentence must not take multiple paragraphs.)
- When referencing files, give only **entry paths** (e.g. `src/snapshot.ts`), don't paste code.
- **Avoid**: architecture diagrams (ASCII/plantuml), implementation-detail piles (locks, queues, retry strategies), re-explaining generic mechanisms already covered by the repo's AGENTS.md.

### 3. Install and configuration

**Install commands must be copy-pasteable** (absolute paths/explicit cd):

```markdown
```sh
cd /path/to/<plugin>
pnpm build            # produces lib/
dsh plugin --profile web add /absolute/path/to/<plugin>
```
```

- Say in one sentence what happens after install (`dsh plugin` installs into the profile and adds it to the `dsh.profile.bundles` layer list; the bundle patch mounts the host composition row).
- **Must state when it takes effect**: "> Note: `dsh plugin` modifies the profile's `package.json`/manifest; the plugin only loads **after restarting the dsh service**."
- The configuration section uses a **table + one YAML example**:

```markdown
| Field | Default | Description |
|---|---|---|
| `stateDir` | `.agent-teams` | State directory name (under the workspace) |
| `memberProvider` | `spawn` | Member subagent provider |
| `memberMaxDepth` | `1` | Member re-delegation depth cap (`0` = forbidden) |
```

- **Compatibility/deployment differences go in a blockquote note** (reusable pattern ④), but must be based on the target deployment's source:

```markdown
> Compatibility note: the DSH checkout this plugin targets discovers the browser bundle
> via package.json `dsh.client` and `exports["./client"]`; if the deployed version differs,
> check its client-modules implementation first.
```

### 4. Verification section rules (three layers)

The verification section is the core of a plugin README's credibility — it must be **layered + honestly labeled "verified/pending"**:

| Layer | Title | Content | Prerequisites |
|---|---|---|---|
| 0 | `### 0. Actually verified on a standalone instance` | A checklist of verification that really ran (model names, commands, artifact evidence), **every item is something that actually happened** | Actually executed |
| 1 | `### 1. Offline verification (no services needed)` | Copy-pasteable build/smoke/composition verification commands | None |
| 2 | `### 2. E2E verification (needs a service restart; schedule it yourself)` | GUI/headless verification steps for the user | User schedules the timing |

- **Layer-0 record checklist template** (record at this granularity):
  - headless profile e2e: `dsh --profile headless "…"` (real LLM runs the full flow)
  - on-disk/log verification: session log contains the complete event stream (list event names and counts, e.g. `team-created ×1, member-added ×2…`)
  - UI load chain: browser roster contains the plugin, `GET /plugins/xxx/client.js → 200`, data route response shape
  - GUI e2e: panel behavior after driving a real browser (auto-expand, status updates, collapse), with screenshot paths
- **Command rules**: all directly copy-pasteable (`cd /path/…` prefix, comments annotating expected output like "should see xxx lines"); verifications that declare "won't touch a running profile / won't boot services" must say so explicitly.
- **Principle**: layer 0 only records what really happened; layer 1 is the developer's self-check entry point; layer 2 is left for users to reproduce on their own instances — all three layers are required, and mixing them destroys trust.

### 5. How to write "Known limits"

- Each limit = **symptom + cause/impact + mitigation**, all in one bullet. Example:
  - "Members only act when they receive a message (wake-up); there is no resident polling; …when the captain is offline, messages stay in the mailbox and are delivered at the captain's next operation." (symptom → impact → mitigation path)
  - "Members (models) don't always strictly follow the tool 'ritual' (e.g. not calling `update_task` when done) — the panel truthfully reflects the event flow, which may briefly deviate from disk truth; the captain consolidates from `agent_teams_status`/files."
- **Why it matters**: the limits section is the "negative space of the behavior contract" — it answers in advance the questions users will inevitably hit ("why does the task still show as not completed?"), prevents design trade-offs from being misread as bugs, and is the source of the TODO list for later iterations.
- Write **real limits**, not boilerplate: design trade-offs (file-level persistence, one captain/one team), environment dependencies (when no global corner slot exists, the portal manages its own geometry; wide screens yield space, narrow screens overlay), model behavior (not following the ritual), boundaries (old sessions have no historical events).
- Give every item a **mitigation or pointer** ("treat `status` as authoritative", "delivered at the captain's next operation"), never an unsolvable complaint.

### 6. Five reusable patterns (distilled from `dsh-agent-teams`)

1. **Open with the capability-seam table**: architecture explanations always start from a "DSH capability | plugin usage" table — it builds the "how does this fit into DSH" mental model faster than any prose.
2. **All verification commands copy-pasteable**: `cd /path/to/…` + absolute paths + comments annotating expected output; users can paste and run instead of "reading diagrams".
3. **Compatibility/deployment differences in blockquote notes** (`> Compatibility note: …`): isolate one-off background like "how the target version discovers the client bundle" and "which changes require restart" from the body, keeping the body clean.
4. **Compress state machines and data flows into one sentence**: state transitions in one line, data chain in one arrow chain — any state machine expressible in one sentence must not take multiple paragraphs; details that need expansion go in code/file references.
5. **Put "actually verified" first in the verification section and grade honestly**: layer 0 (I verified, with evidence) → layer 1 (offline self-check) → layer 2 (you verify yourself) — trust comes from distinguishing "I ran it" from "you run it".

### 7. Completion checklist

- [ ] The intro answers in one sentence what the user can do after installing the plugin
- [ ] "How it works" opens with the capability-seam table, with one-sentence data flow/state machine
- [ ] Install commands are directly copy-pasteable and state when they take effect (restart)
- [ ] Configuration has a field/default/description table
- [ ] Verification is in three layers, layer 0 only contains verification that really happened (with commands and evidence)
- [ ] Every known limit includes a mitigation path
- [ ] No pasted source code, no architecture diagrams, no implementation details sold as features
