# Central Registry Check

Use this optional phase-two check only after `dsh-plugin.naming.json` passes the offline validator. The
central registry is a reviewed coordination service, not an official DeepSeek Harness authority and not
a global lock.

## Query

Run the bundled read-only client and supply the exact target Harness version when known:

```sh
node <plugin-write-skill>/scripts/query-registry.mjs \
  --manifest ./dsh-plugin.naming.json \
  --harness-version 0.1.2-alpha.2
```

The default index is:

```text
https://raw.githubusercontent.com/oh-my-dsh/dsh-plugin-registry/main/registry/index.json
```

Use `--format json` for automation, `--strict` to fail on contextual warnings, `--registry-url` for an
approved mirror, or `--index` for an offline snapshot. The client accepts only
`dsh-plugin-registry/v2`, limits the response to 5 MiB, times out after 10 seconds, performs no writes,
and never executes registry or plugin code.

Exit status `0` means the query completed and no always-blocking registration mismatch was found.
Ordinary contextual matches remain advisory unless `--strict` is used. Status `1` means a registered
identity mismatch or strict-mode warning. Status `2` means invalid local input, unsupported index,
unreadable data, timeout, or network failure. Treat `2` as **unknown/not checked**, never as available.

## Interpret Results

- No match means only that the reviewed index has no matching declaration. It is not a global uniqueness
  proof and does not cover unregistered or dynamic plugins.
- A Plugin module name match is informational because module metadata is not a global registry.
- A Loader match needs composition, patch layer, and replacement intent.
- Service, Tool, Command, provider, settings, and route matches need runtime scope.
- A Skill match needs scope, provider, rank, and local order.
- An event match is informational until publisher roles and schemas are incompatible; events are shared
  channels, not exclusive registrations.
- Ports are deployment-composition concerns and are absent from the central naming registry.

Do not rename an already published surface automatically. Report the match, determine the actual target
composition, and request explicit authorization before a compatibility-breaking rename.

## Register

The local naming declaration does not reserve anything. To request a formal registration:

1. Commit the validated `dsh-plugin.naming.json` to the public plugin repository.
2. Open the central registry example and v2 Schema from
   `https://github.com/oh-my-dsh/dsh-plugin-registry`.
3. Pin `source.commit` to the 40-character plugin repository commit containing the naming declaration.
4. Add Harness `min`/`maxExclusive`, per-surface scope, Loader layer/intent, Skill provider/rank, event
   role/schema, and route kind/path.
5. Submit `registry/entries/<github-owner>/<plugin-slug>.json` through a reviewed PR.

GitHub discovery candidates in that repository never reserve IDs. Only a reviewed entry merged to
`main` participates in conflict checks.
