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
approved mirror, or `--index` for an offline snapshot. The client accepts only the complete
`dsh-plugin-registry/v2` index and entry contract, limits both remote and local input to 5 MiB, stops a
streamed response as soon as it crosses that limit, times out after 10 seconds, performs no writes, and
never executes registry or plugin code. A malformed entry invalidates the whole lookup instead of being
silently skipped. If a custom `fetch` implementation exposes neither a Web stream reader nor an async
byte iterator, the client rejects the response instead of falling back to an unbounded `response.text()`.

The official index may declare this exact Schema:

```text
https://raw.githubusercontent.com/oh-my-dsh/dsh-plugin-registry/main/registry/schema/plugin-index.schema.json
```

The field remains optional for older v2 mirrors. When `$schema` is present, the client requires that
exact value. Successful JSON and text results include the SHA-256 of the original index bytes; preserve
it with the URL and query time as reproducibility evidence.

Exit status `0` means the query completed and no always-blocking registration mismatch was found.
Ordinary contextual matches remain advisory unless `--strict` is used. Status `1` means a registered
identity mismatch or strict-mode warning. Status `2` means invalid local input, unsupported index,
unreadable data, timeout, or network failure. Treat `2` as **unknown/not checked**, never as available.

Node's built-in `fetch` does not consistently consume `HTTP_PROXY`/`HTTPS_PROXY` across the supported
Node 20+ range. When a proxy is required, run Node 24+ with the runtime flag before the script:

```sh
node --use-env-proxy <plugin-write-skill>/scripts/query-registry.mjs \
  --manifest ./dsh-plugin.naming.json \
  --harness-version 0.1.2-alpha.2
```

The client reports this hint when it detects proxy variables after a failed request. It does not claim
automatic proxy support on Node 20-23; use an approved mirror or a captured `--index` snapshot there.

## Interpret Results

- No match means only that the reviewed index has no matching declaration. It is not a global uniqueness
  proof and does not cover unregistered or dynamic plugins.
- A matching coordinate outside the requested Harness version remains a registered identity, but it is
  not compatibility evidence for that target. JSON reports mark this as `appliesToHarnessVersion: false`
  and text reports state that the requested version is outside the registered range.
- An empty, valid index is a completed check with no reviewed match; an empty response, malformed index,
  duplicate coordinate, or duplicate `manifestPath` is unknown/not checked.
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
2. Clone or update `https://github.com/oh-my-dsh/dsh-plugin-registry`, then copy its
   `registry/examples/plugin-registration.example.json` as a candidate `dsh-plugin.registry.json`.
3. Pin `source.commit` to the 40-character plugin repository commit containing the naming declaration.
4. Add Harness `min`/`maxExclusive`, per-surface scope, Loader layer/intent, Skill provider/rank, event
   role/schema, and route kind/path.
5. Run the central repository's authoritative preflight against a current index:

   ```sh
   node <registry-repo>/scripts/plugin-registry.mjs check \
     --manifest ./dsh-plugin.registry.json \
     --index <registry-repo>/registry/index.json \
     --strict
   node <registry-repo>/scripts/plugin-registry.mjs verify-source \
     --manifest ./dsh-plugin.registry.json
   ```

   `check` validates the full v2 entry and contextual conflicts; `verify-source` fetches the manifest at
   the pinned commit and proves that its coordinate, package, and declared names match. Any nonzero result
   blocks registration preparation. Network failure is not source verification.
6. Copy the preflighted entry to
   `<registry-repo>/registry/entries/<github-owner>/<plugin-slug>.json`, generate the index, and run the
   central repository's full gates before preparing the reviewed PR:

   ```sh
   npm run build:index
   npm test
   npm run validate
   npm run validate:sources
   ```

GitHub discovery candidates in that repository never reserve IDs. Only a reviewed entry merged to
`main` participates in conflict checks. Creating or validating the entry is a local repository write;
submitting the PR is a separate external-publication action and still requires explicit authorization.
