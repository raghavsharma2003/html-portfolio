# Modern composite transport patch, 2026-09-07

Frozen review candidate in `scratchpad/modern-composite-transport`, branch `codex/modern-composite-transport`, base `2c2e5b2ccce6e3ef101b7251e83efdb09d554376`. Integration was not edited.

## Implemented boundary

The actual modern Azure composite adapter now sends protocol `vyakti-azure-liveness-broker/v2`, operation `liveness.verify`, random 128-bit lowercase-hex `broker_nonce`, and ISO `broker_issued_at`. Freshness is generated only after both signed private-read capabilities resolve. The request HMAC covers the exact canonical request bytes. This follows the existing broker common authentication convention without creating a composite route.

A successful signed response must echo exactly `protocol`, `operation`, configured `verifier_version`, `request_nonce`, `request_sha256` (SHA256 of the exact raw received request body), existing `request_id`, and capture `input_sha256`. It cannot reuse an earlier response from the same challenge/attempt. Old v1 responses intentionally fail; service protocol matching is not assumed.

Azure endpoint restrictions and redirect:error remain. The adapter also rejects redirect metadata, 3xx and differing response URL, bounds declared/streamed response bodies to65536 bytes, and explicitly covers fetch and body reads with a120-second timeout. Cancellation itself cannot indefinitely delay refusal. Signed capability issuance precedes this timeout; this is not a total end-to-end deadline. HTTP404/501 maps to `azure_liveness_operation_unavailable`; no error response becomes evidence.

## Manifest

Tracked modifications:
- `api/_liveness/providers/azure-composite.js`
- `evals/liveness-verification/run.mjs`
- `evals/run.mjs`
- `services/azure-verifier/README.md`
- `context/decisions.md`
- `context/measurements.md`
- `context/rejected.md`
- `context/graph.json`

New file:
- `evals/liveness-composite-transport.mjs`

No production service handler, registry enablement flag, schema, DB predicate, measurement producer, settlement decision or grant writer changed.

## Actual checks

- Direct `node evals/liveness-composite-transport.mjs`:12/12 passed.
- Registered `node evals/run.mjs liveness-composite-transport`:12/12 passed, no skip.
- Existing `node evals/liveness-verification/run.mjs`:22 checks passed.
- `node --test services/azure-verifier/test/*.test.mjs`:93/93 passed, no skip.
- `node scripts/context.mjs --check`:2237nodes,2363edges,4documents passed.
- `git diff --check`:passed.

The new controls execute the actual adapter, a source mutant removing nonce/digest comparisons (which admits signed same-attempt replay), and the real broker common auth over local loopback. The auth-only seam mounts an injected rejected handler on the existing identity route with the test protocol: it does not create `/v1/liveness/verify`. All successful transport fixtures explicitly return provider_accepted:false without invented biometric scores. Separate actual-route control proves the composite route is absent and refuses.

Covered malformed/root types/signature; altered or missing binding fields; cross-dispatch replay; existing broker request replay/missing/malformed/stale freshness; fetch and stalled-body timeout; over-limit cancellation; redirects and Azure-origin restrictions; missing service route. These are transport/control-flow proofs, not SQL, scanner, Face, speaker, calibration or visual evidence.

## Next staged work and blockers

Keep the larger roadmap in `MODERN-COMPOSITE-IMPLEMENTATION-PLAN-20260907.md`. A future real service must implement this exact v2 envelope and dispatch binding before its outputs are eligible for adapter consumption. It still needs measured same-recording and exact primary-reference voice ownership composition, current source-bound consent, and real Face recording continuity or a separately validated continuity component. Current Face session completion precedes separate phrase capture; it does not bind later audio. No calibrated continuity/synthetic-risk producer was supplied by this patch. Provider remains unavailable; no cloud, model, deployment, SQL or identity mutation was run.
