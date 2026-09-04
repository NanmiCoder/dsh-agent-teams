# Host user-confirmation capability contract

This is the P0-4 integration contract for long-lived project decisions. It is an executable acceptance checklist for the Harness adapter. The plugin owns validation and durable consumption; the host owns the trust root and the real user event.

## Contract boundary

ProjectDecisionCapabilityProvider.verify(request, execution) must verify a host-issued opaque user-confirmation event or token and return claims only after host authentication and authorization succeed. Returning undefined means no trusted confirmation is available. The provider must never derive a claim from Captain metadata, a prompt, a model argument, decision.source, target_version, rationale, or any other ordinary tool parameter.

The request and returned claims are bound to the exact decision:

| Field | Required rule |
| --- | --- |
| userId | Authenticated human who confirmed the decision; not the Captain or model identity |
| sessionId | Exact Harness session that presented or received the confirmation |
| projectId | Exact durable project id |
| decisionType | requirement_approve, design_approve, work_item_accept, or work_item_deliver |
| targetVersion | Exact requirement, design, or Work Item version being confirmed |
| contentHash | SHA-256 hash of the canonical decision payload; host and plugin must hash the same payload |
| capabilityId | Opaque unique id for this confirmation; never reusable |
| issuedAt | Must not be in the future relative to the verification clock |
| expiresAt | Must be in the future at verification and later than issuedAt |

The plugin checks session, project, decision type, version, payload hash, time window and a durable single-use record. Consumed capability ids survive project persistence and restart and cannot be replayed.

## Required event sequence

1. Captain presents the current requirement, design, or Work Item evidence to the user.
2. Harness renders a real confirmation affordance and records the authenticated user action. A normal chat acknowledgement is not sufficient unless the host turns it into the trusted event described here.
3. Host creates, signs, or durably records an opaque capability bound to user, session, project, decision type, version, canonical payload hash, issued time and expiry time.
4. Host invokes the project tool with the host execution context out-of-band. Do not place the token in ordinary model-controlled arguments.
5. Provider authenticates the event or token, checks all bindings and timestamps, and returns claims or undefined.
6. Plugin performs project and quality gates, then consumes the capability atomically with the state transition.
7. Host marks the event consumed, or the provider makes a second consume attempt fail. A retry after a successful transition must not create another approval, acceptance, or delivery.

If any step is missing or ambiguous, production must fail closed. Legacy compatibility records are not confirmation evidence and must remain explicitly marked legacy_compat.

## Executable acceptance checklist

Run:

    pnpm verify:approval-delivery
    pnpm verify:project-phase4
    pnpm verify:project-gate
    pnpm verify:project-link-plan
    pnpm typecheck
    pnpm build

The capability suite must show PASS for all of the following:

- valid host capability for requirement approval;
- forged user or token claims rejected;
- wrong session rejected;
- wrong project rejected;
- wrong decision type rejected;
- wrong requirement, design, or Work Item version rejected;
- payload hash mismatch rejected;
- future-issued capability rejected;
- expired capability rejected;
- missing provider rejected for production-linked decisions;
- member or non-Captain execution cannot perform project acceptance;
- accept cannot bypass the linked Team quality and delivery gate;
- deliver cannot precede accept;
- replay of accept capability rejected;
- replay of deliver capability rejected;
- consumed capability id is durably recorded and remains unavailable after restart;
- Legacy unlinked Work Item behavior is visibly marked compatibility-only and is not counted as production confirmation.

## Minimum real Harness adapter interface

The host must provide the existing adapter seam:

    verify(request, execution) -> claims | undefined

The implementation must obtain the confirmation from the host's trusted user-event/token subsystem, authenticate its issuer, bind the event to every request field above, enforce expiry with a trusted clock, and atomically or idempotently consume capabilityId. It must not accept a token copied from a model-visible argument. If the host has no trusted confirmation event, it must return undefined so the plugin fails closed.

## Evidence required from the real host

The local deterministic adapter proves plugin-side validation only. Before production approval, attach a redacted evidence bundle containing:

- Harness event type and schema version;
- authenticated user and session binding, redacted but cross-referenceable;
- project id, decision type, target version and canonical payload hash;
- capability id, issued and expiry timestamps, and trusted clock source;
- proof that the event came from a real user confirmation affordance rather than model text;
- provider verification and single-consumption audit records;
- a failed replay attempt;
- failed cross-session and cross-project attempts;
- clean restart or reload evidence showing consumed ids remain unavailable;
- exact plugin and Harness versions used.

Do not publish raw tokens, cookies, authorization headers or unredacted acceptance logs. Invalidate any token that appeared in a log before sharing evidence. A local fake token, Captain field, Prompt transcript or deterministic test adapter cannot satisfy this host evidence requirement.

## Release decision

Without the real host event or token adapter and the evidence bundle above, controlled Alpha integration testing may continue, but requirement/design approval and accept/deliver are not release-grade user-confirmation evidence. Formal production remains fail closed.
