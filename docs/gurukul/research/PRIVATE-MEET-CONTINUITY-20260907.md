# Private Meet session continuity

Prepared in `codex/expert-dialogue-continuity` from integration `68283658` on
2026-09-07. This is bounded owner-session restoration, not long-term factual
memory, client memory acceptance, correction training or improved voice.

## The source defect

`CloneExperience` conditionally mounts `ExpertConversation` for the Conversation
tab. Switching to Voice sample, Learn or Review unmounts it. Its old session
pointer lived only in the last mounted exchange; on return, the next POST omitted
`session_id`, creating a new session. The server already persisted both messages
in scoped `meera_log` rows, but prompt history reads only the supplied session's
last ten complete turns. The six relationship-table reads are not a substitute
for those factual messages.

The exact old component at `68283658` was executed against the new synthetic
mounted fixture: it made no history GET, displayed none of the existing exchange,
and sent the next question without the saved session ID. This is a UI/transport
negative control, not real-owner or database evidence.

## Current contract

- GET `/api/replica-dialogue?replica_id=...` reads the most recently active,
  currently eligible owned `private_chat` session. An optional exact `session_id`
  never falls back to another session. No GET creates or extends a session.
- The read repeats the current `loadOwnedRuntimeContext` prerequisites in its
  actual SQL: owner/person mapping, adult tier, active replica/agent/capability,
  approved and currently valid Person Model, calibration and voice versions,
  current inference/training authority and unexpired verified identity.
- Session state and the existing `last_active_at > now() - interval '12 hours'`
  rule are preserved from dialogue admission. The schema's state enum is active,
  ended, revoked, expired (`023_replica_runtime.sql`); the 12-hour cutoff is an
  existing application predicate, not a schema constraint.
- At most ten completed question/answer pairs return in ordinal order, through
  exact session/capability/owner/agent/person and raw-log device joins. Missing
  raw logs are removed by the existing dialogue FK cascade. Incomplete answers
  are not rendered; an outstanding generating turn has an explicit pending state.
- POST `{op: 'open_session', replica_id, session_id}` uses a client-generated
  UUID as the existing session primary key. Same-scope retries return that same
  session without changing its timestamps. A foreign, expired, revoked or
  differently bound collision refuses. No new table, migration, activation,
  consent action or model call is introduced.
- Meet opens/receives a stable session ID before its first model POST, restores
  history before allowing a send, and offers explicit New conversation and Check
  conversation actions. A failed GET remains visibly unavailable. New conversation
  only clears the old displayed exchange after confirmed open and readback.
- A bounded in-memory map keeps session/opening/request IDs across component
  navigation. Its key includes the current bearer token and replica ID; its values
  contain identifiers only. No browser storage or conversation copy is added.
  Page reload reads the last actual server session. A browser reload before an
  uncertain session-open commits cannot recover an unpersisted client intent.
- Ambiguous reply responses get one exact-session GET; generation is never
  automatically repeated. A client-generated trace matches a completed restored
  exchange or latest terminal request. Explicit checks can recover later completion.
- Authenticated scope/generation guards hide old exchanges and drafts immediately
  when scope changes. Pending GETs abort on navigation or replacement.

## Billing, voice and lifecycle limits

Restoration computes the existing provider-budget commitment from each retained
turn's actual provider metadata and turn UUID, then reads its content-free ledger.
Reserved/in-flight/reconciliation states keep the interface blocked. Ledger read
failure refuses restoration. This is a reader of the existing ledger, not a new
accounting writer or proof of provider usage.

`can_voice` follows the incumbent completed-turn response's eligibility semantics.
It does not claim a protected clip exists. Listen still calls the actual protected
speech endpoint, which resolves current capability/version/consent authority and
may refuse. No synthesis, voice quality or owner listening is claimed here.

No current dialogue generating-row sweeper was found. A stale generating row can
therefore keep this session pending until existing session expiry or operational
repair. This implementation does not guess that the provider stopped, mark the
turn failed, release its ledger, or silently open a replacement conversation.
The general ledger and multi-tab turn ordering are unchanged.

## Separate owner-learning lanes

Approved Person Model/calibration are the private prompt authority. Accepting a
claim materializes/retracts exact relational facts through existing reviewed claim
callers; rejection also invalidates dependent profiles, capabilities and sessions.
New profile approval does not bypass existing qualification/activation.

TeacherSheet phrase authoring and the context suggestion-apply plan remain
separate. Saved private corrections produce encrypted evidence and an explicit
evaluation dataset; they do not silently modify the next reply. This change adds
no fact extraction, correction application, undo or erasure datastore. Existing
raw-log and replica erasure cascades remain authoritative.

## Evidence and remaining acceptance

Initial helper/handler checks: 12 groups with injected SQL rows, no database or
model. Mounted actual component/client: 24 groups at 390/1440 pixels, including
remount, page reload, exact new session, malformed committed reply recovery,
pending navigation, uncertain open, restored billing block and delayed actor/
replica responses. Exact-old-component negative control passed separately.
Incumbent correction UI 12, setup UI 34 and private-dialogue 31 checks passed;
TypeScript/copy checks passed. These are focused tests, not a full release.

A repeated old-only Chromium launch failed before a page with native process
exit3221225477 after the earlier negative control had completed. A later added
billing UI assertion initially read the button before asynchronous GET completion;
it now waits for the actual enabled state, and all 24 mounted checks passed.
Neither failure is treated as a successful user journey.

Root executed the frozen SQL helper and `evals/dialogue-history-live.mjs` against
isolated development at 2026-09-07T12:13:49.665Z: all 12 groups passed, with
remainingFixtureRows=0 and cleanupErrors=[]. Frozen source hashes were unchanged.
That harness emits an ID-only manifest
before writes, includes synthetic grant/profile/capability fixtures, and separately
reports primary failure and cleanup. It explicitly deletes/recounts dialogue
turns along with sessions, raw logs, replicas and every fixture scope. Repeated
idempotent opens on one PostgreSQL client are queued calls, not an overlapping
transaction proof. This result is synthetic scoped SQL acceptance, not real owner
authentication, provider generation or long-term memory acceptance.

Full integration release, authenticated owner use, broader private memory and
voice acceptance remain separate.
