# Modern issued authority V5: independent terminal review

8 September 2026. Read-only inspection of root's completed SQL run; reviewer made no database, provider or deployment call.

**Outcome: the bounded SQL acceptance suite passed.** Receipt `modern-authority30-sql-v5-1788822329258-961ce76b-3929-4e70-9a4d-41e3aaf75b57-result.json`, SHA256 `f5fedd793c09f0cda0507329fe68e8475da47f76b9656c81412ba4804707431b`, records 2026-09-07T23:05:29.258Z through 23:07:43.131Z against `vyakti_expert_integration_20260906`.

## Verified evidence

- 80 checks: 8 production EXPLAINs, 45 fixture EXPLAINs, 3 retained parser negatives and 24 lifecycle/concurrency checks. These include actual issue/replay, two insertion rollback controls, replacement, duplicate-primary refusal, exact lease load, review epoch behavior, six altered-binding refusals, revoked/expired refusal and contention.
- Three real lock witnesses used dedicated reader/holder PIDs and fixture-specific leading SQL markers. Observed activity was truncated to 1023 bytes of a 1024-byte capacity; the harness validates the visible submitted prefix and retains complete local SQL hashes. It does not claim the server exposed the full query.
- Held old-snapshot load returned 0 rows after the real evidence-review writer advanced authority; the retained no-epoch writer mutant returned 1; competing issuance returned 0 for the stale issuer. The no-epoch negative commits only its synthetic writer to make the visibility schedule real, then uses exact cleanup. It is not a rolled-back negative.
- All 54 final scoped counts (3 fixtures x 18 tables) are zero, including model-build, voice-genome, audit and person. Result errors, session errors and session-cleanup errors are empty. 17 sessions were opened, 500 queries recorded, timeout false, provider calls zero.
- `migration_applied:false` means this launcher applied no migration. Root had already applied migration144 and separately checked its catalog and parser before this run.

## Exact pins

- Clean inspected source HEAD: `cecc71e56e8a87548da51cf96b741066f5da8a35` in `scratchpad/expert-issued-authority30`.
- Production base: `3462b1f6575731c18379088d79cd5e919a45cc87`; `git diff --name-only BASE HEAD -- api db` is empty. V2-V5 corrections changed harness/guards and evidence, not production authority SQL.
- Source freeze: `9a293d0ca413928e5ecaf22591c704180d3b03c3a0d6d3d6407ffa83add3176e` (45 source closure files).
- Runtime freeze: `d02389690829a1b70a4dc9a5834fb4525c7b8912058855173848855c1499df62` (23 runtime files).
- Launcher: `91f8a14f6c98c5ef9a40a8604e2f8a2ffc42cdf9d76c1a127a3d75136e323c9d`.
- Guard: `2f2a0f8c766d28bb00205cd2bb058089d015d0b98bf6aa9ba4a198e65eb82cfc`.
- Final launcher manifest: `90a960c1cdf8b4f3b5408f292b12ca74af576b31d33a4e30af5f6c46a4894bc0`.

## Acceptance boundary and retained failures

This proves the enumerated PostgreSQL types, scoped lifecycle predicates and three witnessed schedules with synthetic prerequisites. It does not prove every interleaving or actual consent/source/account erasure callers, full-release acceptance, deployed routing, Azure Face entitlement, a real capture's identity, calibrated continuity/synthetic risk, owner voice likeness or enrollment readiness. The artifact-review fixture deliberately creates transaction-local existing-enrollment prerequisites; that is no new-owner authority grant or producer.

Keep the initial42883, V3 timestamp22007 and V4 launcher refusal receipts. Their repairs separate database-generated bigint IDs, exact timestamp text preserving microseconds, and a production-query-hash-specific guard allowance. No weaker reference +1/private-epoch unchanged assertion was substituted.

Decision: accept this bounded SQL evidence for candidate30 integration, while keeping calibrated composite acceptance closed. Reverse that acceptance if a replay of these source pins fails or a new real counterexample defeats an authority/cleanup predicate. Continue with the frozen full release and a separately specified calibrated producer; do not repeat successful SQL merely to seek broader claims.
