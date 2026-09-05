# plugin-test Reference Index

| File | When to read it |
|---|---|
| [version-migration-testing.md](version-migration-testing.md) | Test plugin compatibility with a new Harness version |
| [docker-release-smoke.md](docker-release-smoke.md) | Run a packaged plugin against one exact DSH version in Docker before release |

For ordinary plugin changes, select test levels directly from `SKILL.md`. Read
`version-migration-testing.md` only when the task involves a Harness version migration.
Read `docker-release-smoke.md` when Docker is available and the change needs repeatable
published-artifact proof in an isolated Profile.
