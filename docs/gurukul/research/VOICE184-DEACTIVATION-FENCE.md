# Voice184: stop mutation cannot outlive resource release

Source-only successor of fcac153c; no SQL/cloud/GPU calls.147 migration unchanged.

158 records deactivation_state and deactivation_dispatched_at. close claims stop authority durably before any identity/token wait. After token retrieval it consumes once-only dispatch authority only while its allocation still has unreleased resource ownership. Documented synchronous Azure deactivate200 is required before durable acknowledgement. Claimed/unknown/failed acknowledgement cannot release resource, even if ARM currently reports inactive/zero. No retry fabricates completion. Late unknown activation remains a separate explicit operator-recovery case.

Release SQL requires acknowledged deactivation and dispatched timestamp in addition to known activation and exact persisted shutdown evidence. Concurrent close without the claim can observe, but cannot report terminal while the pending stop can still dispatch. Terminal lifecycle observation is monotonic: a stale overlapping read cannot overwrite terminal with observation_unknown and reintroduce an old supervisor into a newer window. Crash recovery between terminal observation and resource release uses the persisted terminal observation, never a fresh unmatched replacement.

Deterministic offline test scripts/check-voice-close184.mjs exercises production controller, production lifecycle store, production boundary and shared147meter against independent simulated DB and ARM transports. First stop pauses at token acquisition; concurrent close observes inactive/zero but cannot terminal/release; second owner allocation is refused. Only after first stop200+ack+observedshutdown does next allocation activate. Recorded order activate/deactivate/activate/deactivate; held498600 (138600 initial+2*180000) remains charged, statesuncertain. Stale observer cannot regress terminal. This is logical scheduling evidence, not PostgreSQL concurrency execution. Existing28controller controls pass in same run.

Official200contract: https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/container-apps-revisions/deactivate-revision?view=rest-resource-manager-containerapps-2025-07-01

Source-only158 schema/lock/release/dispatch SQL still requires actual DB parser and concurrent-session validation before deployment. No operational completion or likeness claim.

## Successor185 scheduled release recovery

Scoped due now includes terminal_observed rows whose147 resource_released_at is null. supervisorTick takes a release-only branch using the immutable persisted observation through the existing lifecycle store; it makes no ARM request and cannot issue another shutdown. Unknown activation/deactivation remains ineligible for release under SQL predicates. Once released, the terminal row disappears from the scoped due inventory.

Injected DB failure after terminal persistence but before release was exercised through the actual shared boundary/meter/controller/store. The actual scoped due loader discovered the stranded row, supervisorTick recovered it, no ARM calls/stops occurred, and fixture held678600 remainedunchanged. This is synthetic DB scheduling evidence, not actual PostgreSQL concurrency proof. No source schema change or cloud operation in185.
