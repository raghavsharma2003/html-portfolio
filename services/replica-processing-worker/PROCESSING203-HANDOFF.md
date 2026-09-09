# Processing203 integration handoff

Source-only ordinary upload allocation; not deployed, no migration161 applied, no GPU call made. Existing preview image f1512032 remains disabled and unchanged.

- Caller: run-once creates processingAllocation; runtime admits GPU stages for the current leased upload. One147 parent spans source stages in that worker run. Migration161 atomically begins the147 parent and records source authority; stage children require current owned lease, capture/storage consent, purpose and source hash. Provider checks exact origin before private input reads, health and POST, and carries the allocation abort deadline.
- Scope: optional REPLICA_PROCESSING_SOURCE_SCOPE_JSON exact owner_user_id/replica_id/source_id limits queue leasing, recovery and model-build/intents. Default ordinary queue remains unrestricted. Scoped self-test reconciliation is skipped because that API is replica-wide. Source affinity is not authorization.
- Money:147 remains the financial ledger. Shared-evidence kind is explicitly planning_estimate. No forced shutdown and no claim of an Azure invoice bound. Closing records unknown money as held. Trusted ARM natural-zero observation may release resource availability only after all stage responses are known; unknown children retain the resource and money. Failed response recovery is not fabricated.
- Observer: gpu-observer.js issues bounded ARM GETs only, pins app configuration/template hash and image digest, rejects pagination/foreign active templates. run-once calls it before reservation. scripts/azure-processing-gpu-observe.mjs is the concrete release-only recovery caller; expiry and admission-disabled settings do not prevent recovery of the same immutable plan. It is NOT scheduled yet.

## Required runtime bindings before any execution

AZURE_PROCESSING_GPU_ENABLED=1; VYAKTI_MODEL_SERVING=azure_only; AZURE_PROCESSING_GPU_BUDGET_ID and explicit AZURE_PROCESSING_GPU_LIMIT_MICROUSD; AZURE_PROCESSING_GPU_PLAN_JSON with kind/resource/origin, image_sha256, revision_sha256=SHA256(canonicalJson({configuration,template})) from actual metadata, contract_sha256, rate_microusd_per_second, contingency_multiplier, planning_allocation_seconds, exact multiplied reservation_estimate_microusd, expires_at_ms, hard_invoice_cap=false. Rate and contingency must be reviewed against actual current pricing; tests use synthetic462 and2, not a live quote. Preserve existing138600 unknown liability and all CPU holds.

Existing evidence origin/HMAC and Azure Speech credentials remain required. Managed identity needs exact evidence App metadata Reader access for app/revision/replica GETs; no App write or stop role required. Identity endpoint is existing Container Apps managed-identity protocol. Observer CPU task requires AZURE_PROCESSING_GPU_OBSERVER_ENABLED=1 and exact REPLICA_EXPECTED_DATABASE. Independent bounded periodic observer pickup must be configured before a recurring product worker is called complete. No scheduler or role changes are included here.

## Review and verification

PROCESSING161-SQL.json contains actual emitted authority query bytes/hashes for the next rollback-only real SQL parser proof. PROCESSING-SOURCE-SCOPE-SQL.md identifies dynamic queue/build query changes; these also need real EXPLAIN. Old186/187 proofs do not validate new161 queries. Migration147 is unchanged; source161 adds private authority cascade and infrastructure-only retained receipts, mirrored schema/erasure/reach contract.

Local checks: actual147 meter with synthetic SQL23 groups, observer6 groups, source-scope controls, existing voice-evidence25 checks, existing replica-processing checks. No local mocks validate SQL types. Three CPU-window fixtures now explicitly inject synthetic no-provider authority; unexpected provider dispatch throws. Full release has not run on this source.

## Actual fixture and next ingestion

One corrected Azure stock Hindi synthesis succeeded, hi-IN-AnanyaNeural,299characters,26.6125seconds,24kmono, SHA16636b6e06d0e7145fad3cab3ac5d85409f84e527c23a2189fb3c79b85738cf6. Parent measured above8k energy1.9318934072691394%; n1 synthetic, not owner likeness. ROOT scratchpad/expert-tools/processing203-stock-fixture retains404 and corrected200 receipts plus spectrum. Cost remains unknown. No owner grants were changed.

Next: independent source review; real rollback parser161 and scoped query proof; exact current deployment/rate plan and dev budget admission; build reviewed successor processing image; synthetic authenticated upload/finalize to strict source scope; one bounded manual worker execution; inspect reference lineage/sample rate/bandwidth. Then enable bounded automatic queue pickup with independent recovery observation. GPU execution is not admitted by this document.
