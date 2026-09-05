# Changelog: dsh-v0.1.2-alpha.1 → dsh-v0.1.2-alpha.2

Generated from `git log dsh-v0.1.2-alpha.1..dsh-v0.1.2-alpha.2` (157 commits; merge commits excluded).

## Release (2)

- 3f1b46a5db (2026-08-30) release(dsh): 0.1.2-alpha.2
- 6af96785b5 (2026-08-29) release(vendor): cordis 4.0.2, cosmokit 1.8.3, group 1.0.2, hmr 1.0.17, include 1.0.7, loader 1.0.3, logger-console 1.0.2, schemastery 3.18.2, timer 1.1.4

## Features (13)

- 45455aae77 (2026-08-24) feat(release): route dsh prerelease dist-tags
- e5f36cc70f (2026-08-29) feat(plugin-inventory): carry every agent preset's composition and group the settings plugin list by scope
- 943a544899 (2026-08-26) feat: classify Host dependency exports
- c55beac34a (2026-08-26) feat: verify Host dependency export identity
- de256e8bc1 (2026-08-26) feat: enforce published dependency policy
- 19b4d7f26c (2026-08-29) feat(web): add connection recovery indicator
- 9effa0c6b3 (2026-08-28) feat(ui-chat): split turn stats into usage and time pills with dialogs
- 5ba375fd88 (2026-08-28) feat(client): hover swim morph for the hero fish
- f15078532f (2026-08-27) feat(ui-chat): reshape the usage trigger as an icon-row pill
- 10b31043ab (2026-08-26) feat(ci): assign coverage partitions by recorded file duration
- bb1df10c69 (2026-08-27) feat(ui-chat): collapse the turn tail into one clickable meta line
- e841fb6049 (2026-08-26) feat(web): surface active schedules in session views
- 2a9b940ef5 (2026-08-25) feat(web): list active reminders in the session header

## Bug Fixes (57)

- 8769d57c98 (2026-08-30) fix(web): localize permission preset labels
- b7bccd5897 (2026-08-30) fix(docs): repair reverted session note references
- 2f673e5aba (2026-08-30) fix(agent-presets): register the display subpath in tsconfig paths
- 8349cc6c73 (2026-08-29) fix(agent-presets): live-mount-first inventory, per-runtime mounts, localized shipped preset names
- 675efe73f2 (2026-08-29) fix: node 24.9 internal issue
- d5a9e5b274 (2026-08-29) fix(web): publish the drill claim before the descent edit
- 9162bc69bd (2026-08-27) fix(release): harden dependency verification
- 91b5a01980 (2026-08-26) fix: complete dependency policy generation
- 3e56eaaa0f (2026-08-29) fix(atomic-write): retry transient Windows replacement
- 7fbd33de00 (2026-08-29) fix(snapshot): keep fixture lifecycle tests source-clean
- 1f8d7b73af (2026-08-29) fix(snapshot): own fixture listener lifecycle
- 84c7ae3398 (2026-08-29) fix(web): align connection indicator labels
- 674a1e95a3 (2026-08-29) fix(api): rename the failure marker, harden cross-realm discrimination, and mark the packed-record violation
- f9e8fc8f8a (2026-08-28) fix(api): identity-stable $host facts and a whole-record host info hook
- 2f2e6d627b (2026-08-28) fix(api): resolve review findings on stream boundary, inject staleness, and ctx discipline
- 5af9eec51c (2026-08-28) fix(api): address review findings on the gateway client failure face
- d40d678b93 (2026-08-28) fix(api): repair runtime closure, gateway client bundle, and $host coverage
- 9055a8af3a (2026-08-28) fix(snapshot): bind fixture servers to OS-assigned ports
- ececf8c170 (2026-08-28) fix(web): address hero fish hover review feedback
- 84df0f11ae (2026-08-28) fix(web): use primary color for subagent setting label
- 6daed7c5aa (2026-08-28) fix(client): make trigger-menu Enter an explicit no-op while refinement pends
- 21d039be1b (2026-08-28) fix(web): label the Turn-time TTFT row as first-token latency, not an average
- 1278877d91 (2026-08-28) fix(client): dismiss stat dialogs through the shared outside-pointer hook
- f6d4f2149d (2026-08-28) fix(webworker-runtime): restore v1 title cache fixture
- aa70a737ae (2026-08-28) fix(web-search): guide users to endpoint settings
- 5c9ca1f25b (2026-08-28) fix(session-title): preserve v1 title cache schema
- d576865f76 (2026-08-28) fix(client): remove the hero glow under the new-session input
- 452013effa (2026-08-28) fix(client): web session and input UI polish
- f55c676485 (2026-08-28) fix(web-search): clarify endpoint recovery guidance
- 5a8ef5f3f5 (2026-08-28) fix(web): tighten schedule catalog evidence
- 19b215f426 (2026-08-28) fix(ui-schedule): scope Escape dismissal to catalog
- 2bcd4cc552 (2026-08-27) fix(agent-presets): treat absent turn boundary as blank
- e719eee47f (2026-08-27) fix(web): guide search endpoint recovery
- 8c67d49ca5 (2026-08-27) fix(api): simplify projection reconciliation
- c3b694312f (2026-08-27) fix(web): harden schedule catalog state handling
- beaa5638b4 (2026-08-27) fix(session): centralize projection baseline precedence
- 57d8a79bfe (2026-08-27) fix(session): validate seeded projection boundary
- 11a5bc5083 (2026-08-27) fix(api): preserve projection baseline precedence
- dd3e1c8490 (2026-08-26) fix(session): replay projection baselines in order
- 14bdba0924 (2026-08-26) fix(notices): refresh Claude SDK payload versions
- 96c1c762d5 (2026-08-26) fix(session-projection): preserve optional registrations
- cd18de61d8 (2026-08-26) fix(session-projection): close migration coverage gaps
- e296e79b18 (2026-08-26) fix(session-projection): complete mandatory compositions
- a6c7c70d4f (2026-08-26) fix(session-projection): close review findings from the fold migration
- e6bf040dc3 (2026-08-26) fix(session-query): use renamed tool call id
- 3759ea5dfe (2026-08-26) fix(agent-team): keep projection through runtime disposal
- 5521b98143 (2026-08-26) fix(session-projection): isolate host state from wire snapshots
- cdba045dfc (2026-08-25) fix(session): trust authoritative projection frames
- 5fe7dc333f (2026-08-25) fix(session): reconcile cached projection hints
- c26ca6acb6 (2026-08-20) fix(session-projection-cache): drain in-flight writes on disposal; sync stale lockfile and generated docs
- 30334322eb (2026-08-19) fix(apiproxy): crop host-only units from wire projection blocks
- 5ef3f0bd94 (2026-08-19) fix: resolve remaining review findings — explicit turnBoundary dependency and uniform missing-key handling
- 2a4f6541d6 (2026-08-19) fix: revert the projection-registration form per review
- f364d6ba37 (2026-08-19) fix: address ds-review-bot findings on the projection migration
- 3f5fc12b4c (2026-08-19) fix(web): restore settings focus after commit
- 8ac1bd64e2 (2026-08-06) fix(web): document settings focus restoration
- 0289791d5d (2026-08-06) fix(web): restore focus after closing settings

## Performance (7)

- 51a6eabb27 (2026-08-28) perf(api): replace shift-backed stream queues
- a12e9de5f7 (2026-08-28) perf(session): stat the probe parent only on Windows
- 722d9f016b (2026-08-27) perf(goal): avoid copying open-turn event suffix
- ba4bd08bc3 (2026-08-27) perf(llm-retry): reset state without scanning keys
- 6c4bbf7300 (2026-08-21) perf(goal): read durable state from session projection
- 6def839f56 (2026-08-21) perf(team): project durable state incrementally
- 89b5bc276f (2026-08-21) perf(session-projection): skip history reads for in-order events

## Refactoring (21)

- 9135a13a8b (2026-08-30) refactor(consumers): remove cross-package runtime relays
- f4e49ccf8f (2026-08-30) refactor(services): move shared values behind service APIs
- 6c53fe6e2a (2026-08-30) refactor(values): make shared primitives duplicate-install safe
- cebd0a2031 (2026-08-29) refactor(plugin-inventory): match group title and switcher pill to the General-settings row idiom
- 0f06f973c4 (2026-08-29) refactor(plugin-inventory): settings-row style group headers
- 5eb7195f9d (2026-08-29) refactor(plugin-inventory): menu-pill preset switcher, collapsible groups, inline preset-provided rows
- ccfbbb443a (2026-08-29) refactor(connection): centralize websocket recovery
- 804b1ffbfc (2026-08-28) refactor(api): converge the Remote failure vocabulary and client surface
- d25ace0f22 (2026-08-28) refactor(api): require the session projection registry
- 8645053ca0 (2026-08-28) refactor(goal, permission, plan): require the projection registry
- 6f16d5868c (2026-08-28) refactor(ui-chat): drop the flat usage-variant debug switch and square narrow pills
- 6717cb8d19 (2026-08-27) refactor(session): trim projection migration diff
- 1c2acd9157 (2026-08-27) refactor(permission): project the seed boundary
- 42e0781cda (2026-08-27) refactor(agent-team): name the Team projection explicitly
- 85bf796a95 (2026-08-27) refactor(subagent): retain identity projection state
- 212df86cf8 (2026-08-26) refactor(session): migrate simple folds to projections
- c7abeb23bf (2026-08-26) refactor(session): keep approval outside projection migration
- 3d05fdfbfb (2026-08-26) refactor(session): keep instruction and skill scans on event log
- 5ddbc6e71f (2026-08-19) refactor(session-projection): checkpoint every projection unit (migration side)
- b0c2e2bf01 (2026-08-19) refactor(session-title): keep title input as an O(1) projection
- 1a72ae202a (2026-08-19) refactor(session): migrate host state reads to projections

## Reverts (2)

- 2c6ff296af (2026-08-30) Revert "Merge pull request #3087 from deepseek-harness/worktree/remove-ignorable-session-events"
- 842f42d7ea (2026-08-19) Revert "fix: resolve remaining review findings — explicit turnBoundary dependency and uniform missing-key handling"

## Documentation (23)

- f46e4a8ada (2026-08-24) docs(release): define dsh prerelease channels
- 5fae1d02f5 (2026-08-30) docs(web): describe localized permission labels
- 089e044e5b (2026-08-30) docs(session): clarify external event compatibility
- 29b65af60b (2026-08-30) docs(session): retain ignorable events for external plugins
- 795d8ec985 (2026-08-30) docs: describe runtime dependency ownership
- cc5173f4cf (2026-08-29) docs(testing): state the concurrent execution model where tests are written
- 1d81fc7540 (2026-08-29) docs(testing): give the review checklist its own test-reliability entry
- e440634456 (2026-08-26) docs: define published dependency faces
- 596a13d1cb (2026-08-29) docs(testing): add platform-semantics and lane-budget rules to the skill
- 73a723f37f (2026-08-29) docs(api): correct the api-gateway reference codes and the failure-vocabulary note
- a4f7193d24 (2026-08-28) docs: drop the Remote-failure bullet from packages/AGENTS.md
- 2b750cfb51 (2026-08-28) docs(api): document the converged ctx.remote programming surface
- 94c714d813 (2026-08-28) docs(testing): add CI test reliability skill
- 5156226cb9 (2026-08-28) docs(notes): record the hero glow removal, consolidating the one-axis-scroll note
- f14f50416e (2026-08-28) docs(notes): record the turn-tail stat pill decision
- b36f3d323a (2026-08-27) docs(session): align projection hint ordering
- 68c48109e3 (2026-08-27) docs(session): align projection replay criteria
- 650e96cb4d (2026-08-27) docs(session-projection): correct initialization contract
- ef4dde9fe2 (2026-08-26) docs: reconcile projection catalogs after master merge
- 73a1dae665 (2026-08-21) docs(session-projection): sync generated catalog translations
- 54d5d92c08 (2026-08-21) docs(session-projection): refresh generated catalogs
- 58ebaa63d0 (2026-08-19) docs(notes): refresh superseded projection notes for the mandatory seam
- 86831ea9a2 (2026-08-19) docs(notes): date the mandatory projection-seam note 2026-08-19

## Tests (25)

- 19c3a270fa (2026-08-30) test(agent-presets): key mounted-row assertions by entry id
- 34bdc81b47 (2026-08-30) test(deps): enforce runtime dependency ownership
- 1e3ca1a4b3 (2026-08-29) test(ci): tolerate reaped timeout descendants
- 08bfeda7e8 (2026-08-29) test(e2e): use Flash for live adapter coverage
- 4d92a61e00 (2026-08-29) test(e2e): reserve pro for adapter coverage
- b46d36d3bf (2026-08-27) test(release): verify dual-version npm layout
- 18480ff902 (2026-08-29) test(connection): verify and document recovery behavior
- 90505636cd (2026-08-29) test(ci): carry the hook budget and raise the Lefthook suite to the lane value
- 41cd24f3f6 (2026-08-28) test(api): cover the non-Error terminal escape in RemoteStream
- 143748bae9 (2026-08-28) test(deque): pin storage release behavior
- f2b9875c47 (2026-08-28) test(session): await projection cache write-back
- 66d0bbd5b5 (2026-08-28) test(web): align e2e suite with the hero-glow removal and menu retention
- 00f2a701bd (2026-08-28) test(scripts): align the translation-pairing-merge budget with the coverage lane
- bc88e152c5 (2026-08-27) test(ui-chat): restore turn-tail assertions lost in the rebase merge
- 3a34b7870e (2026-08-27) test(agent-team): cover failed projection reads
- 9e184cde37 (2026-08-27) test(python): restore strict live response smoke
- b2071a50b9 (2026-08-27) test(api): complete session manager coverage
- dfb9b9475f (2026-08-27) test(web): close schedule catalog review gaps
- 8042ac94a3 (2026-08-27) test(web): make schedule locale assertion deterministic
- 48f79a52d8 (2026-08-26) test(session-query): model non-error rejection
- f3d6433d9d (2026-08-26) test(agent-presets): mount projection seam in baseless harness
- c3468623ea (2026-08-26) test(python-sdk): accept explanatory live responses
- 4d34d59733 (2026-08-26) test(webworker-runtime): refresh title projection fixture
- 9cd9c7f634 (2026-08-26) test(web): complete schedule catalog validation
- cf06f10229 (2026-08-26) test(session-controller): cover cold host-only projection cache

## Chores / CI (5)

- b27c8fbc02 (2026-08-30) chore(deps): refresh package manifests
- a3207a758b (2026-08-29) chore: package.json update
- 02a542f49f (2026-08-28) chore(docs): regenerate the slot catalog for the hostInfo hook rename
- 39a5a1d7e4 (2026-08-28) chore(docs): regenerate catalogs, graphs, and the message-feedback golden
- 5fe390dc8b (2026-08-26) chore: keep generated notices current

## Other (non-conventional subjects) (2)

- 46a8e83094 (2026-08-28) ci: refresh checks before merge
- 907c6334c1 (2026-08-19) Remove Knip from repository tooling

