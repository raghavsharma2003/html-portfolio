# Owner-reviewed context suggestion application: read-only implementation plan

Date: 2026-09-07. Audited integration worktree:
`C:/Users/raghav.s/Desktop/build/Vyakti-platform/scratchpad/expert-integration`.
Observed integration HEAD at final source check: `7486450b`.
This is source analysis only. No SQL, provider, model, browser or test was run
for this audit. No application, publication, consent grant or reversal occurred.
The independent paired-model experiment and parser are frozen and untouched.

## Finding and exact missing caller

| Existing path | Evidence in integration | What it actually does |
|---|---|---|
| File list opens phrase review | `src/studio/ContextLockerPanel.tsx:183`, `:437` | Lazy-loads the review for the selected owned item. Source removal closes it at `:466`. |
| Review component | `src/studio/ContextProposalReview.tsx:20`, `:38`, `:41`, `:50` | GET, render cited candidates, retry/back. No selection, apply, reject or undo caller. |
| Client transport | `src/studio/contextLockerApi.ts:71`, `:89` | Typed GET `/api/teacher-sheet?op=ingest_review`. No mutation wrapper or draft CAS token. |
| HTTP dispatch | `api/teacher-sheet.js:68`, `:79`, `:95`, `:108` | GET review and existing save/validate/publish operations. No context selection apply/reverse operation. |
| Scoped review reader | `api/_context-proposal-review.js:16`, `:34`, `:40`, `:67` | Owner/replica/item/run/text joins; live item/source check; real citation validation; IDs are `sha256(JSON.stringify(delta)):index`. Historical run `applied` is honestly `historical_unconfirmed`. |
| Existing ingest approval function | `api/_channel-ingest.js:539` | Changes run status/approver/time only. Repository caller search found eval callers, no production caller. Its own documentation at `:515` explicitly delegates sheet saving elsewhere. It is not an atomic draft-application endpoint. |
| Private draft writer | `api/_teacher-sheet-draft.js:115`, `:128`, `:271` | Existing private bound/unbound draft support, owner precedence and replica locking. Saves incomplete bodies without activating or publishing. Whole-body save has no expected-body CAS. |
| Client draft save | `src/studio/teacherSheetApi.ts:29`, `src/studio/TeacherSheetStudio.tsx:144` | Sends the whole body; does not send sheet ID or expected revision. Cannot safely be composed after a separate run-status approval. |
| Runtime adoption | `api/_teacher-sheet-adoption.js:3`, `:44` | Binds an existing unbound draft only after qualified runtime activation. Reuse unchanged; suggestion application needs no agent or capability. |
| Published-snapshot CAS | `api/_teacher-sheet-draft.js:198`, `:317`, `:350` | Existing separate publication gate matches sheet/status/version/consent snapshot. Application must not call it or create consent. |
| Separate Mirror materialization | `api/_mirrorcall-store.js:1007`, `:1028`, `:1080` | Existing Mirror-only reader/write; reader is agent-bound and update CAS is sheet ID, not body. Not a safe direct reuse for new private/context selection. |
| Separate Mirror merge | `api/_mirrorcall.js:807` | Two allowed fields and 12-fragment ceiling, but normalizes/truncates through `mirrorClean(...,64)` and returns null for duplicate or full field. Do not silently shorten a 500-character review candidate or call a full field a successful save. |

The exact missing link is **a selected candidate action in ContextProposalReview,
an authenticated POST handler, and a single atomic proposal-to-private-draft
materialization receipt**. Connecting the old status writer to generic save in
two requests would be a new inconsistency, not completion of this link.

The targets are only `boardVerbalisms` and `exSlangRepeat`. The current lean
projection deliberately excludes BOTH (`src/engine/expertTextCompiler.ts:21`).
This lane can save reviewed phrase-bank content to a private TeacherSheet; it
cannot claim current lean replies or voice improved. Extending that projection
would require a separate decision and fresh quality evidence.

## Smallest coherent v1 contract

1. Extend the existing authenticated teacher-sheet endpoint with a read-only
   selection preview and POST `ingest_apply` / `ingest_reverse`. Use the same
   auth, IP/user quotas and no-store response handling. A small injected-DB
   helper owns the SQL; do not call the generic run approval and draft writer
   sequentially. Actor is always `requireUser(req).id`, never a client approver.
2. Apply to an existing eligible private draft, including an unbound draft.
   If none exists, return `teacher_sheet_draft_required` and route to existing
   private authoring. Do not seed DEMO_TEACHER, bind an agent, create a persona,
   grant consent, or copy a published sheet implicitly.
3. Read-only preview supplies exact candidate IDs, exact fragment/field before
   and after values, per-candidate outcome, current draft identity and a bounded
   opaque review token. No mutation occurs when opening/selecting a suggestion.
   The owner selects explicitly; default selection is empty.
4. POST carries `replica_id`, `item_id`, `run_id`, selected candidate IDs,
   expected proposal/source/draft token and one stable `request_id`. It carries
   no authoritative replacement fragment, field, owner, consent ID or agent ID.
   Selected IDs must be unique and all belong to the same reviewed run. Limit
   total selection to24 and each resulting field to12; reject the entire batch
   when any selected candidate cannot be represented exactly.
5. Re-read authoritative scoped data, repeat citation integrity and exact
   fragment shape checks, and derive the merge from those stored bytes.
   Reuse phrase-bank rules from `fromSheet.ts:519` (at most3words, no terminal
   punctuation, at most12items). Do not infer full held-out validation from
   occurrence counts alone. Preserve other draft validation errors as errors on
   an incomplete draft, consistent with existing authoring. Added fields must
   themselves pass; malformed existing target serialization needs review.
6. V1 is one final selected batch per run. Unselected candidates are explicitly
   reported as not applied; they are not implicitly approved or rejected.
   A retry with the same request/body returns the same receipt. Reusing a request
   ID with another selection, or applying another batch to a closed run, gives
   named409. Further selection/re-application is a later UX extension, not an
   automatic re-mine. Historical status-only `applied` rows stay unconfirmed.
7. Only a landed sheet write plus landed materialization/decision receipt can
   produce `saved_to_private_draft`. Already-present candidates return an exact
   no-change disposition. Return actual `changed_count`, `already_present_count`,
   application ID and post-save draft token. No count alone means applied.
8. UI shows selected-only before/after preview and a private-draft result. Undo
   operates from that application receipt, not from current source text copied
   into the browser.409 discards the stale preview and reloads for a new explicit
   decision. Existing abort/generation guards must prevent a late apply/review
   response from restoring a removed item's private text.

## Required source and draft CAS

Use the existing review scope, but the writer needs a stronger explicit live
source fence, rather than `not exists(refused item)` from the old status writer.
The committed mutation must re-assert all of:

- Authenticated owner and exact replica; non-revoked/non-purging lifecycle.
- Exact item ID/run ID/video_ref=`context:<item>`/transcript_source=context_item,
  run proposed, item mined, current ownership/authorship/owner_speaker/format.
- Source pointer unchanged; canonical source still ready and same owner/replica,
  or genuinely source-less item with its scoped text still present.
- Exact canonical text body and content hash, exact proposed_delta JSONB and
  proposal ID/hash; JS citation validation was over that same body and delta.
  Candidate IDs are not a substitute for source-body binding.
- Exact selected target sheet ID, eligible draft status, version and full body,
  with explicit owner+replica precedence; legacy fallback only when BOTH owner
  columns are null and the bound-agent relation matches. No agent-null row is
  permitted to gain authority through a guessed agent.
- Exact current draft equals the expected snapshot in the UPDATE predicate,
  not just sheet ID or updated_at. Same-version edits must conflict. Store the
  resulting body and decision/materialization rows in ONE statement/transaction;
  if any guard loses, neither status nor content nor receipt changes.

Prefer server-issued hashes for preview tokens, but use exact captured body/text
and JSONB equality again at the final SQL write; do not accidentally compare JS
JSON serialization bytes with PostgreSQL's different JSONB serialization.

All writers must use an explicit consistent lock order: canonical source(s) in
ID order, replica, item/text/run, then target sheet and materialization rows.
Source-less paths still serialize on the live item. Existing producer ordering
is source -> replica -> item (`_context-locker.js:550`). Direct removal currently
locks source -> item (`:794`) and uses a provenance-scoped run UPSERT tombstone.
Extend participants deliberately and prove actual overlaps; CTE textual order
alone is not a concurrency proof. Keep the tested tombstone, not UPDATE-only
scrubbing, because a statement may have waited with an older snapshot.

## Materialization and copied lineage are activation prerequisites

Current context lineage ends at run -> item. Direct removal scrubs the run and
deletes text/item (`api/_context-locker.js:794`); canonical erasure captures the
item and scrubs copied proposal text (`api/_replica-source-erasure.js:256`).
Neither knows a context phrase was copied into a TeacherSheet. Existing sheet
reversal at `api/_replica-source-erasure.js:293` is for Mirror deltas only.

A minimal auditable design needs two new bounded relations, not a full sheet
history archive:

- **Application receipt:** owner/replica, application/request ID, run/item/source
  identity, proposal/body hashes, selected candidate IDs, before/after sheet
  hashes, authenticated approver/time, result counts and applied/reversed/erased
  state. Unique owner/replica/request key and one final application per run.
  No full before/after draft or citation excerpt copies.
- **Materialization rows:** application/candidate, exact destination sheet ID,
  owner/replica, allowed field, exact fragment plus fragment hash, source/item
  references, active/removed state and origin disposition. This is the necessary
  copied content and must be an explicit erasure target. Track whether content
  existed independently before any managed insertion versus was introduced by
  a tracked application. Another approved source can support the same fragment
  without a second insertion. Do not confuse no-change with newly-owned content.

Do not choose an assumed free migration number. Follow current migration
allocation; mirror schema, exact owner FKs/checks/indexes and erasure wiring.
Add the tables to `api/_creator-export.js:142` and the owner-lane reach walk in
`scripts/relcheck.mjs:334`; include full-replica deletion alongside current ingest
and context deletions (`api/_replica-full-erasure.js:527`, `:549`) and sheet
deletion (`:1068`). The existing teacher-sheet owner export remains unchanged.

The ordinary save/copy path must not strip these associations. Small v1 boundary:

- Saving unrelated fields of the same tracked draft keeps all materializations.
- Direct edits to a tracked phrase-bank field require the lineage-aware remove
  action first, or fail with a named conflict. Do not silently label rewritten
  source text as independent owner material.
- A new draft copied from a tracked published/validated sheet requires explicit
  base-sheet ID + body CAS and atomically copies its active materializations.
  No origin metadata must mean refusal in that tracked-copy case, not a clean
  untracked draft. A genuinely empty new target may still use ordinary private
  authoring. No content-matching scan substitutes for explicit copy provenance.
- Generic whole-body saves that contain stale removed fragments must be refused
  by the same lineage/body CAS after source removal. Otherwise an old browser
  draft can recreate bytes after successful erasure.
- Mirror writes into a tracked target need the same field-CAS/lineage boundary.
  Existing independently supported Mirror fragments remain independent support;
  do not delete them because an identical context candidate was also approved.

These small write seams are necessary scope, not optional future cleanup. Do
not enable a UI that creates source-derived copies while a normal save can erase
their lineage. Reuse private draft/adoption and Mirror policy; do not replace
their independent consent or authority rules.

## Undo and source withdrawal

**Explicit undo:** prepare against the current private destination snapshot, then
POST application ID + expected draft token. Remove only still-present fragments
introduced by this application and unsupported by another active application,
an independently present owner value or an independently valid Mirror delta.
Retire this application's support even when text stays because another origin
supports it. Preserve every unrelated field/value. Never restore a full old
draft, since that would overwrite subsequent owner work or resurrect erased
sources. Repeated undo returns the same content-free receipt. Changed target
field, missing lineage or newly published destination yields a named409 and no
partial reversal. Public copies require their separate explicit withdrawal/
publication workflow; private undo must not claim to reverse a still-live copy.

**Source removal:** extend BOTH existing direct removal and canonical completion
to enumerate all exact owner-scoped destination materializations before source
or item deletion. Invalidate the support, remove only exclusively source-derived
values from every tracked copy, and scrub the new fragment/citation payloads.
Preserve a content-free decision receipt and existing run tombstone. Source-less
context removal needs the same effect synchronously; it cannot rely on a later
canonical-source worker that will never run. A withdrawn/erased application can
never be undone into a restored phrase, and re-mining cannot recreate it.

Never leave an affected published copy servable pending a background cleanup.
Source withdrawal is already a separate authority action. Affected public copies
must be made unavailable and scrubbed under that erasure policy, with their
publication receipt cleared; private application itself never writes consent.
Choose a non-draft retired/revoked state for those old published rows and retain
the current explicit private draft. Existing Mirror erasure demotes to draft at
`_replica-source-erasure.js:382`; blindly copying that choice risks the one-draft
partial unique index (`db/schema.sql:5533`) when a private draft already exists.
This is a source-derived design constraint, not an observed SQL failure here.
Revoked/old copies still need data scrubbing even though they are not servable.

## Required proof before enabling apply

Reuse existing tests, especially `evals/context-proposal-review-live.mjs`,
`evals/teacher-sheet-private-live.mjs`, `evals/teacher-sheet-adoption-live.mjs`,
`evals/source-erasure/context-proposals-live.mjs` and the actual blocking-witness
negative control in `evals/source-erasure/context-proposals-overlap-live.mjs:17`.
Do not rerun providers. Add these bounded proofs:

1. Pure selection/merge: selected-only, Unicode/citation integrity, field and
   byte ceilings, exact no-change, unsafe/overlong fragments rejected without
   truncation, malformed target serialization, no hidden published write.
2. Actual UI -> transport -> authenticated handler -> materializer -> response:
   no selection no write; exact one selected batch; double click/idempotent
   retry; wrong user/run/item/candidate; stale preview; late response after
   removal; no false success or implicit runtime activation.
3. Exact runtime SQL EXPLAIN plus real execution on the isolated dev database,
   two synthetic owners and bound/unbound drafts. Test foreign explicit owner,
   legacy both-null ownership, absent draft, published/revoked target, changed
   same-version body, changed canonical text/owner speaker/proposal/source
   pointer, removed/refused item and source deleting. Verify zero partial writes.
4. Apply -> read actual draft -> undo -> actual draft equality for unaffected
   content. Duplicates, unrelated later edits, another source supporting the
   same phrase, independent owner value, Mirror support and conflict controls.
5. Apply -> copy via actual private-save path -> remove direct source-less item
   or canonical source -> verify ALL copies and new payload rows scrubbed;
   preserve unrelated owner data. Include published+existing-private-draft
   index case, revoked copies and a stale browser-save attempt after removal.
6. Interactive two-session overlaps, witnessed using pg_blocking_pids:
   apply-first/remove-second and reverse order; apply/save, copy/remove,
   apply/re-mine, apply/undo. Retain an old status-then-save or unfenced mutation
   as a negative control that really fails the intended invariant. Do not call
   sequential mocked requests a concurrency proof.
7. Exact EXPLAIN/execution of the owner export and full-erasure additions;
   idempotent migration; schema/check parity; source and full cascade reach.

For all dev SQL: require exact current_database before writes, generate and
record every fixture ID first, never call publication/consent/provider APIs,
cleanup explicit non-FK rows as well as cascade rows, and return remaining0
with individual cleanup failures. Root performs authorized protected execution.

## Decision boundaries to keep explicit

- This is phrase-bank authoring, not general fact/behavior/never-rule editing.
- One final selected batch/run and conflict-first undo are the bounded v1 UX.
- Private application does not alter lean_v1 prompts, publish a sheet, bind a
  runtime, verify a consent grant, or establish better answers/voice.
- Copied-lineage and erasure integration must land before apply is enabled.
- Current evidence is source tracing only. Reversal conditions: measured safer
  materialization or a broader provenance-aware editor may replace the bounded
  restrictions once actual copy/overlap/erasure proofs remain green.
