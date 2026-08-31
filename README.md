<p align="right">
  <strong>English</strong> · <a href="./README_ZH.md">简体中文</a>
</p>

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="dsh-agent-teams turns one DeepSeek Harness session into a coordinated multi-agent team">
</p>

<p align="center">
  <a href="https://dshfind.com/en/plugins/NanmiCoder/dsh-agent-teams?ref=badge"><img src="https://img.shields.io/badge/recommended%20by-dshfind-FFD700?style=flat-square" alt="Recommended by dshfind"></a>
  <a href="https://dshfind.com/en/plugins/NanmiCoder/dsh-agent-teams?ref=badge"><img src="https://dshfind.com/api/badge/NanmiCoder/dsh-agent-teams?lang=en" alt="dshfind score"></a>
  <a href="https://dshfind.com/en/plugins/NanmiCoder/dsh-agent-teams?ref=badge"><img src="https://dshfind.com/api/badge/NanmiCoder/dsh-agent-teams?metric=downloads&amp;lang=en" alt="dshfind downloads"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@nanmicoder/dsh-agent-teams"><img src="https://img.shields.io/npm/v/@nanmicoder/dsh-agent-teams?style=flat-square&amp;color=5B4CF0" alt="npm version"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-0B7285?style=flat-square" alt="MIT license"></a>
  <a href="./cordis.patch.yml"><img src="https://img.shields.io/badge/DSH-Web%20%2B%20Headless-5B4CF0?style=flat-square" alt="DSH Web and Headless"></a>
</p>

## One prompt. A working team.

`dsh-agent-teams` turns the current DeepSeek Harness session into a captain that can assemble durable sub-agents, split a goal into dependency-aware tasks, and coordinate work through direct messages.

Ask in natural language. The plugin provides the team protocol, eleven coordination tools, persistent state, an automatic shared-task scheduler, and a live Web UI—without requiring a separate workflow engine.

<p align="center">
  <img src="./assets/ui.png" width="100%" alt="DeepSeek Harness conversation with the AgentTeams live activity panel, members, tasks, dependencies, and reports">
</p>

## Releases

The [latest release](https://github.com/NanmiCoder/dsh-agent-teams/releases/latest), [v0.1.15](https://github.com/NanmiCoder/dsh-agent-teams/releases/tag/v0.1.15), supports Harness **0.1.2-alpha.2**. Older hosts must use a pinned compatible plugin version. Browse the [complete release history](https://github.com/NanmiCoder/dsh-agent-teams/releases); the same notes ship in the npm package under `release-notes/`.

## Why AgentTeams?

| Capability | What it changes |
| --- | --- |
| **Captain-led delegation** | The current session creates the team, assigns roles, and consolidates the final result. |
| **Durable members** | Members are continuable DSH sub-agents that can be woken for focused follow-up turns. |
| **Dependency-aware tasks** | Tasks move through explicit states and cannot be claimed before their dependencies finish. |
| **Automatic reuse and safe takeover** | Idle members claim the next ready task; reassignment revokes stale attempts before new work starts, and cold recovery retries stranded open attempts. |
| **Direct messaging** | Members send durable mailbox messages directly to teammates or the captain—no relay required. |
| **Live activity panel** | The Web UI combines segmented progress, a collapsible roster, and an interactive task DAG; running tasks show the member's model, and completed archives retain their full member and task history. |
| **Plan before execution** | Normal `/agent-teams` runs stage an unspawned roster and DAG first. The Web panel uses the host model catalog for member routes. Returning to chat stops the planning turn, asks what should change, and revises the same draft; discarding archives the draft, aborts the turn, and explicitly prevents automatic recreation. Only **Approve & Run** creates members and starts scheduling. |
| **Quality gates** | Opt-in quality tasks support requirements → implementation → verification → review → integration contracts, automatic repair/re-review, and explicit resume. Scope control is a completion-time audit, not host write interception. See [docs/quality-gates.md](./docs/quality-gates.md). |

The conversation card and activity panel use Harness's official locale service. They follow live language changes between English and Simplified Chinese—including status labels, dynamic summaries, controls, archive markers, and accessibility text—without a page reload or a separate plugin setting.

## Install

> [!IMPORTANT]
> **Plugin 0.1.15 (`@latest`) requires DeepSeek Harness 0.1.2-alpha.2.** Updating this plugin does not update Harness. This release has no adapter for the old RC host APIs. Check the version of the instance you actually launch with `dsh --version` before installing.

| Harness host | Plugin to use | Compatibility status |
| --- | --- | --- |
| **0.1.2-alpha.2** | **0.1.15** (`@latest`) | Recommended current pair; real API and Web UI verified on macOS arm64. |
| **0.1.0-rc.8** | **0.1.14** | Previous dependency baseline; keep this pair if you are not upgrading Harness. |
| Other older RC / unchanged source checkout | Pin your working plugin version; do not follow `@latest` | Do not assume every older host works with 0.1.14. |
| Alpha.1, later Alpha versions, or other source revisions | Not verified | Match the documented host version or validate separately. |

**The default plugin release follows the current supported Harness developer preview: `latest=0.1.15`, for Harness Alpha.2.** The host's Alpha version does not require a separate Alpha plugin channel. Users staying on an older host must install an explicit compatible plugin version instead of `@latest`. Optional peer dependencies are not a runtime version check: a successful install on an incompatible host does not mean the plugin can activate.

See the [compatibility details](./docs/alpha2-compatibility.md) and [real business / UI acceptance report](./docs/alpha2-release-acceptance.md).

### npm: Harness Alpha.2

If you install Harness through npm, upgrade the host first, then install the matching plugin:

```sh
npm install --global @deepseek-ai/dsh@0.1.2-alpha.2
dsh --version
dsh plugin --profile web add @nanmicoder/dsh-agent-teams@latest
```

To pin this release, replace `@latest` with `@0.1.15`. Check the required host version in the release notes when updating. These examples target the `web` profile; use your actual profile if different. Stop and restart the running Harness process after changing either host or plugin, then refresh the browser.

### Staying on an older host / rolling back

If you are keeping the previous RC host, **do not install the plugin's `@latest`**. For Harness 0.1.0-rc.8, keep or reinstall the pinned 0.1.14 plugin:

```sh
dsh plugin --profile web add @nanmicoder/dsh-agent-teams@0.1.14
```

Restart the old host and refresh the browser. If you also upgraded Harness, restore the matching older host before using 0.1.14; rolling back only the plugin is not a supported Alpha.2 configuration. Do not delete credentials or `.agent-teams` data to fix a version mismatch.

**Harness built from source:** updating this plugin repository, rebuilding it, or installing a global CLI does not upgrade a separately launched Harness checkout. Preserve your local changes, update the actual host checkout to [dsh-v0.1.2-alpha.2](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.2), follow its build instructions, and restart that host. If its source must stay old, keep the old plugin too; for a source-linked plugin use tag `v0.1.14` and its matching dependencies/build, not the current `main` branch.

### Build the Alpha.2 plugin from source

```sh
git clone --branch v0.1.15 https://github.com/NanmiCoder/dsh-agent-teams.git
cd dsh-agent-teams
pnpm install --frozen-lockfile
pnpm build
dsh plugin --profile web add .
```

This requires the Alpha.2 host above. Run `pnpm build` again after changing the source. The local plugin install remains linked to this checkout; pulling source alone does not rebuild that linked plugin.

Validate the composed profile, restart DSH, and refresh the Web UI:

```sh
dsh --profile web --dump-config
dsh web
```

Then ask for a team directly:

> Use AgentTeams to review the commits after v0.5.3 from performance, security, and product perspectives. Return one consolidated report.

## How it works

1. The current session creates a team and becomes its captain.
2. The captain adds role-specific members backed by continuable sub-agents.
3. The goal becomes tasks with owners and explicit dependencies.
4. The shared scheduler uses real `running / idle / ready` state to atomically claim one ready task per idle member and wake it. An interrupted resident attempt stays parked and can resume through a direct message without losing its capability; after a cold process restart, the scheduler retries stranded open work with a fresh attempt.
5. Members update with the current `attempt_id`; reassignment or captain takeover revokes the old attempt and waits for the old worker to quiesce before a new attempt starts.
6. The captain presents the combined result, then archives the complete team record.

Team state is stored under `<workspace>/.agent-teams/`; the Web panel reads that disk truth and combines it with live sub-agent activity.

Member creation is zero-interaction by default: a member on the captain's current LLM route snapshots that provider, model, and reasoning effort, while a member on a requested alternative route snapshots the target model's default effort; later continuations restore the resolved snapshot. Only an explicit heterogeneous-team request (for example, “backend on provider A/model X, frontend on provider B/model Y”) supplies a member-specific `provider` + `model`; there is no per-member model or reasoning prompt.

## Slash command

No “use AgentTeams” phrasing required. The plugin registers the
closed-namespace `/agent-teams` host command, so the Web GUI slash menu shows
an `agent-teams` placeholder with an input hint: pick it (or type the
command), describe the goal, and press Enter.

```
/agent-teams research the pricing pages of three competitors
```

The command pipeline claims the line, then preserves that exact input as an
ordinary user follow-up so it remains visible in the main chat. The gesture
boundary adds the deterministic activation directive at pre-step, so the
captain protocol still starts immediately. The invocation is also durably
logged (`command/run` / `command/done`).

Surfaces without command adjudication (for example the headless CLI) get the
same deterministic activation through a gesture boundary: any genuine user
message starting with `/agent-teams` activates the protocol for the rest of
the text. Mid-sentence mentions stay ordinary prose.

## Configuration

Defaults work without extra setup. A trusted profile can override member behavior:

```yaml
- id: agent-teams
  config:
    stateDir: .agent-teams
    memberProvider: spawn
    memberModel: deepseek-v4
    memberMaxDepth: 1
    maxMembers: 8
```

`memberProvider` is the sub-agent runtime backend (`spawn` / `fork`), not an LLM provider. Cross-LLM-provider routing uses the optional `provider` + `model` fields of `agent_teams_add_member`; `memberModel` is only a model default for all members. A member on the captain's current provider/model inherits the captain's reasoning effort, while a changed provider or model automatically uses the target model's default. To request a particular effort, pass the optional `reasoning_effort` field — one of the target model's supported effort ids, or `"default"` to force the model's own default.

`slashCommand: false` disables the deterministic `/agent-teams` activation surfaces (slash command and gesture boundary), leaving the natural-language trigger as the only entry point.

## Boundaries

- One captain leads one active team at a time.
- Idle members with no open task are automatically reused for ready work. An idle member that still owns an open attempt is parked until messaged or explicitly reassigned; messages that cannot be delivered live remain durable and are retried at a later status boundary.
- State is file-backed and serialized within one DSH process; concurrent processes editing the same team are not coordinated.
- The activity panel reports persisted state as-is. Models may occasionally finish work without performing the expected task-state update.

See [docs/usage.md](./docs/usage.md) for the full tool reference, state model, Web UI behavior, configuration, and known limits.

## Plugin development Skill

The repository also ships the open Agent Skills package [`dsh-plugin-development`](./skills/dsh-plugin-development/SKILL.md):

```sh
npx skills add NanmiCoder/dsh-agent-teams --skill dsh-plugin-development
```

## Documentation

| Guide | Covers |
| --- | --- |
| [Usage](./docs/usage.md) | Architecture, UI behavior, tools, configuration, limits, and validation |
| [Verification](./docs/verification-guide.md) | Offline, composition, real e2e, and GUI verification |
| [Plugin development](./docs/developing-dsh-plugins.md) | Human-readable guide built from this plugin |
| [README writing](./docs/readme-writing-guide.md) | Repository documentation conventions |

## Development

```sh
pnpm install
pnpm build
pnpm verify
```

## Named multi-role profiles

Configure one or more complete team profiles in `cordis.patch.yml`. A profile always supplies the roster (independent provider/model/role/reasoning effort). Set `taskPlanning: captain` when the Captain should derive the DAG from the user's goal; omit it or set `taskPlanning: seed` to keep a fixed template workflow:

```yaml
profiles:
  demo-delivery:
    description: Ship a small feature
    protocol: Discuss requirements, review, test, then prepare release; do not deploy automatically.
    members:
      - name: analyst
        model: gpt-5.6-sol
        role: Analyze requirements
      - name: implementer
        model: gpt-5.6-terra
        role: Implement the approved solution
    tasks:
      - id: requirements
        subject: Requirements discussion
        assignee: analyst
      - id: implementation
        subject: Implement solution
        assignee: implementer
        dependencies: [requirements]
```

Use an explicit profile flag: `/agent-teams --profile demo-delivery implement the feature`. The first ordinary token is never treated as an implicit profile. Normal command runs call `agent_teams_create({ profile, approval: "required" })`: the roster and seed/Captain-designed DAG remain staged, no child session is created, and no task is claimed. Edit the plan in the activity panel using the host model catalog, return to chat so the Captain asks what to revise and then atomically updates the same draft, discard it, or click **Approve & Run**. Return/discard actions cancel any planning turn still running; discard also parks model-facing context that forbids silently creating a replacement team. Approval resolves the final provider/model/reasoning choices, atomically spawns the roster, and starts only ready tasks. A running team is stopped from its own panel header through a confirmation dialog rather than from the composer. Direct tool clients may pass `approval: "automatic"` for the legacy immediate path. Failed review/test tasks do not unlock downstream work; automatic repair/review tasks do not depend on the failed review.

## License

[MIT](./LICENSE)
