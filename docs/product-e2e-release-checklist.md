# Product-flow E2E release checklist

The command pnpm verify:product-e2e is repeatable local evidence for the long-lived project product flow. It uses a recorded deterministic model, the real project tools, a temporary workspace, a deterministic host-confirmation adapter, a persisted AgentTeams-shaped DAG, the read-only project UI projection, and a fresh Node process for cold-start recovery.

The suite covers Greenfield discovery, Brownfield baseline discovery, clarification ask/answer persistence, requirement draft and explicit confirmation, design draft and explicit approval, the implementation gate, dependency-ordered DAG execution, Review needs_revision, repair and re-review, separate accept and deliver transitions, UI projection, and cold-start tool/UI restoration.

This is local protocol evidence, not general natural-language or production-host evidence. Release remains fail-closed for these boundaries until separately rerun in the target environment:

| Evidence boundary | Local result | Release requirement |
| --- | --- | --- |
| Deterministic project and tool flow | PASS via verify:product-e2e | Required regression gate |
| Deterministic Harness task lifecycle and cold restart | PASS via lifecycle-verify and stress-verify | Required regression gate |
| Real host user-confirmation event/token | NOT PROVEN | Host adapter must verify trusted user events, binding, expiry, and single-use consumption |
| Real external LLM natural-language understanding | NOT PROVEN | Run recorded prompts against the target model and inspect tool traces; otherwise do not claim NL E2E |
| Real browser UI interaction | NOT PROVEN | Run the target Harness browser flow; projection tests do not prove clicks, dialogs, reload, or accessibility |
| Clean checkout, tarball, and real Harness installation | NOT PROVEN here | Keep package, release metadata, and real-install evidence gates separate |

The deterministic adapter is intentionally not a substitute for the host trust boundary. It only proves that valid claims can pass through the project tools. Existing capability tests remain responsible for forged, mismatched, expired, and replayed claims. The exact host contract and evidence checklist are in docs/host-user-confirmation-capability.md.

Required commands:

    pnpm typecheck
    pnpm build
    pnpm verify:product-e2e
    pnpm verify

Never convert a NOT PROVEN row into release approval because a local deterministic script passed. Formal production release still requires the real Harness confirmation adapter and real UI/model evidence.
