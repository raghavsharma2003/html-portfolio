# Public expert knowledge into Room replies, 2026-09-07

Status: bounded local source audit and proposed implementation, not implemented. No provider calls, database execution, deployments, or code changes. Inspected the active expert-integration tree after the prior frozen checkpoint; other agents were editing unrelated files. All paths below are relative to that integration tree.

## Recommendation

Connect the **existing explicitly published Room showcase Q&A** to ordinary `roomSay` as a small, separately labelled knowledge block. There are at most five active answers per Room. They already have an authenticated authoring operation, owner/Room scope, removal semantics, a public page, and an erasure cascade. Load all five rather than introduce embeddings or a retrieval-ranking experiment for five rows.

This is a useful complete public-Q&A slice with no new publication database. It gives a visitor answers grounded in material the expert deliberately chose to publish. It does **not** make the entire Context Locker or accepted private Mirror knowledge public. It also does not establish sentence-level provenance for generated prose; describe supplied evidence honestly.

Reversal condition: measured supported-query coverage proves five published answers insufficient for the intended launch. That would justify a separately reviewed broader publication scope, not silently widening the query to private claims.

## Actual current path

1. `api/room.js:305-322`, authenticated-session `op:"say"`, invokes `roomSay` from `api/_room-surface.js:1758`. The Telegram and WhatsApp adapters also call that function (`api/_room-telegram.js:889`, `_room-whatsapp-chat.js:857`). Integrating this seam reaches those ordinary text replies too; this does not authorize sending any messages during implementation.
2. `resolveRoom` (`_room-surface.js:530`) resolves a published, unpaused Room and loads its published TeacherSheet through `loadTeacherAgent`. The Room/session/agent, disclosure digest, follower eligibility, selected thread ownership and quotas are checked before reply work. The published sheet already supplies owner-approved persona/teaching-style material through `src/engine/agents/fromSheet.ts`. Therefore the accurate finding is **no retrieved public Q&A/source knowledge**, not “no owner context at all.”
3. At `_room-surface.js:1910-1926`, a consenting follower gets their own history and `dmRecall(person, {agentId})`. Without memory consent, the code uses bounded, digest-checked request history and performs no private memory retrieval/write. `dmRecall` in `_room.js:458` uses the shared disclosure SQL predicate, exact agent/recipient scope and priority/recency. It is not a corpus of published expert knowledge.
4. The compiler receives `memories: facts.map(f => f.body)` at `_room-surface.js:1970`. There is no showcase or accepted-claim knowledge input. The final door is `gatedReply` (`:1982`) with follower facts as the shared-past record and the owner's current never-rules.
5. Default `ctx.reply` calls `think` in `_surface.js:290`. With `VYAKTI_MODEL_SERVING=azure_only`, `_model-serving-policy.js:25` selects Azure Foundry and refuses an explicitly incompatible provider. `think` calls `_azure-surface-reply.js`, which validates the exact Foundry endpoint family, configured deployment/model and budget, then sends compiled prompts to `/models/chat/completions`. Its model comes from `AZURE_FOUNDRY_REPLY_MODEL`; do not label a specific model as currently active without reading runtime evidence. This audit read no credentials/config values. Outside strict mode, the shared path still defaults to OpenRouter. Source capability is not evidence that a deployed Room has strict mode or a working Azure model.
6. Replies retain the existing honesty/never-rule gate, follower quota/memory behavior and protected voice path. `roomSpeak` speaks the hash-bound output of `roomSay`; it does not provide another knowledge-answering path.

Anonymous `roomTaste` is a separate caller in `_room-taste.js`; it currently retrieves nothing. Keep this first slice on ordinary `roomSay`, and state that limitation. Broadening the taste or proactive check-in lanes requires their own explicit tests; do not imply a shared compiler field alone connects those callers.

## Publication and privacy authority already present

| Material | Existing authority | Safe scope for this patch |
| --- | --- | --- |
| Published TeacherSheet | `status='published'`, non-null consent artifact; schema/read/load validation in `_teachersheet.js`; Room publish also requires runtime/readiness/disclosure | Existing persona and teaching-style context only. Do not mutate the sheet when retrieving Q&A. |
| Room showcase | Authenticated `api/room-publish.js` `showcase_set`; `_room-publish.js:1144` resolves owned Room, checks content, and inserts an active `vy_room_showcase` row. `showcase_remove` has owner/replica predicates in the write | Explicit public question/answer copy. The public creator page already renders this copy through `readRoomShowcase`. |
| Review card | Owner's `sounds_right` approval; copy-to-showcase requires exact owner/replica plus `kind <> 'follower_declined'` | A reviewed card is eligible for a deliberate publication action, not automatically published. Read the resulting showcase row, never all approved cards. |
| Accepted cited claim | `vy_replica_claim` + latest accepting decision; source/citation lineage; private materializer/recall | Private owner evidence, not a Room publication grant. Exclude entirely from this patch. |
| Context Locker | Owner/capture/storage/own-context or own-turns scope; mined/routed processing status | Processing completion is not public approval. Do not read raw excerpts, filenames, links or titles for Room knowledge. |
| Follower memory | Current follower consent plus recipient/agent/episode disclosure predicate | Keep existing private dyad. Never use one follower's information to augment shared expert knowledge. |

`api/_experience-compiler/relational-materializer.js` is a valuable reusable authority example but is the wrong reader here. It accepts only event/relationship claims and materializes into the owner's agent/person dyad. `approvedMirrorRecall` has a real caller in `mirror-call.js:423`, and still applies the owner-person disclosure predicate. Passing the owner person ID to ordinary Room recall would retrieve private facts and feed them to a different recipient.

The existing disclosure grant system is recipient-specific, with cited grants, denies and sensitive-data floors. It is not a shortcut for making arbitrary owner evidence public to all present and future Room visitors. No grant changes are needed for showcase content already deliberately published.

Showcase publication currently copies text into an independent public row; it does not retain the source review-card ID, claim citation graph or original file locator. Consequently its provenance is **the expert's published answer**, not a verified citation to an original uploaded document. Later claim edits/removal do not automatically prove the public copied answer was removed. The owner must remove/update that showcase row under the existing behavior; do not pretend a source-cascade exists for a relationship the schema never stored.

## Exact minimal implementation

### 1. A scoped public-material reader, with existing schema

Add `api/_room-knowledge.js` containing the small read and pure normalization/commitment functions. Avoid importing `_room-publish.js` into `_room-surface.js`: `_room-publish.js` already imports from `_room-surface.js`, so that creates a cycle. Either move the existing generic showcase reader/constants into a dependency-light module and re-export from `_room-publish.js` for compatibility, or keep the owner/page reader and give the new reply reader its stricter scope. Do not duplicate the full publishing implementation.

The new retrieval SELECT should join `vy_room_showcase k` to `vy_room r`, and bind **all four resolved authority values** in SQL:

```
r.room_id = $1::uuid
r.replica_id = $2::uuid
r.owner_user_id = $3::uuid
r.agent_id = $4::uuid
r.published_at is not null
r.paused_at is null
k.room_id = r.room_id
k.removed_at is null
```

Return only `k.id, k.question, k.answer, k.position`, ordered by position and ID, `limit 5`. The values come from `resolveRoom`, never browser-submitted owner/replica/agent IDs. Keep the existing live Room runtime/sheet checks; a showcase query is not their replacement. Invalid/missing scope refuses before DB/model work. A genuine empty result means no published Q&A; a query failure must be a named platform failure, not an empty-success result or a private-source fallback.

Normalize exact returned strings with strict types and bounds matching the existing schema: question 1..200 characters, answer 1..1200, valid ID, unique positions 1..5. Do not silently shorten an answer and then call it the complete published text. SQL returns the whole bounded set, so there is no lexical recall miss or unmeasured cross-script ranking in this slice.

Create a per-item content commitment from canonical `{schema:"room-public-qa/v1", room_id, item_id, question, answer}`. It detects source copy changes; it does not make an item public or prove factual correctness. Capture a bounded set digest for the exact block sent to the model.

### 2. One labelled compiler input, separate from follower memories

Add an optional typed `publicKnowledge` input to the real `src/engine/compiler.ts`; absent/empty must produce byte-identical compiled prompts. Pass validated public Q&A data from `roomSay` after session/follower/thread/disclosure admission, independently of `memory_consent_at`. Public knowledge can be used when private memory is off without logging a follower episode.

Do not append Q&A to `memories` or `gatedReply`'s `record`: those mean what this follower and AI actually experienced. Expert source facts must not license claims like “you told me” or a fabricated shared past. The same division applies to response metadata.

Reuse the existing creator-material boundary discipline (`renderCreatorMaterial`, exported by `src/engine/serverEntry.ts:41`), but give retrieved teaching content its own unambiguous public-Q&A data label. The current renderer's introductory “know about yourself” wording is persona-specific; do not blindly call an arbitrary document excerpt autobiography. Keep one shared compiler path and platform-owned safety instructions. Encode Q&A as bounded data with platform-created labels/IDs, not creator-supplied role names or raw instruction paragraphs. Escape line breaks/control delimiters and hostile material-boundary strings consistently; JSON encoding alone does not stop semantic prompt injection. Never-rules and output gates remain mandatory, with adversarial model tests separate from fixture checks.

The maximum five Q&As are at most 7,000 source characters before encoding. Apply an explicit total encoded block bound and select whole entries deterministically if a prompt budget requires fewer. Do not split a source mid-answer. More importantly, test the **actual provider-bound `compiled.core`/`compiled.tail` after the Azure adapter's 64,000/24,000-character slicing**. A sidecar may list only whole items actually preserved in the sent prompt. Reserve compiler budget for the block or fail explicitly if an unusually large prompt cannot carry it; a retrieved-but-truncated item was not supplied evidence.

Continue through existing `engine.compile -> gatedReply -> think -> Azure Foundry -> gateReply -> deliver`. No new direct model call, raw provider SDK, alternate uncensored answer path or embedding service is needed. No code changes to ordinary persona publication or private Mirror recall are needed.

### 3. Honest source references, without invented per-reply citations

Add a small `knowledge` sidecar to the immediate successful `roomSay` response:

```
{
  scope: "public_room_qa",
  relation: "provided_to_model",
  exact: false,
  reply_sha256: <hash of final delivered reply>,
  evidence_set_sha256: <actual supplied set>,
  sources: [{ id, question, content_sha256, href }]
}
```

This means “These published answers were available for this response,” not “These sources prove every sentence” or “The model used all of them.” Produce it server-side from the actual supplied set and final gated output, never model-invented source IDs. No prose answer/transcript needs an additional persistent table. If the reply is suppressed or empty, do not label evidence as supporting a delivered answer. The source list must not come from a broad query run after generation.

Give each existing public creator-page Q&A a stable escaped anchor based on its real item UUID, then return a verified public-page link to that anchor. Confirm the actual route/base-url builder in `_creator-page.js`; do not invent a document URL or expose a signed private-storage capability. UI should render the expert's published question title as the source label. Telegram/WhatsApp continue to use the grounded reply; adding visible source-link chrome to those adapters is separate unless explicitly included in the patch.

`roomCitations` currently returns `vy_context_item.source_name` where status is mined/routed (`_room-surface.js:3842-3874`), explicitly `exact:false`. Those titles are not per-reply evidence, and the inspected query has no separate publication predicate. For this slice replace its catalog read with the same current public-Q&A reader and label the result as published Room material, still `exact:false`. This avoids exposing private locker titles while supplying a real public catalog. Preserve old callers' expected shape where necessary and add typed metadata rather than falsely changing `exact` to true.

Do not add a durable per-turn citation database for this patch. An immediate response sidecar can establish what was supplied during that call. A later generic `citations` request can report only current published material, not reconstruct historical model use. If the UI wants a last-answer evidence panel it should retain the immediate sidecar in its existing in-memory/message state. Historical exact provenance requires a separate deliberate feature.

### 4. Removal, stale state and privacy limits

Read public material on every turn, without a process-global content cache. Before provider dispatch revalidate the chosen IDs/content hashes and Room eligibility; before delivery confirm they remain active, along with current Room eligibility. Changed/removed evidence must not silently retain an “available source” citation. A changed set should abort the bounded reply or rerun under an explicitly budgeted new attempt; do not automatically pay for retries.

These checks bound observed races but do not promise atomic revocation of an already dispatched model request. A removed Q&A was already public and cannot be recalled from prior readers. Do not hold a database transaction open across a provider call merely to claim instantaneous cancellation. Describe the actual boundary: no new retrieval after observed removal, final pre-delivery revalidation, no guarantee to retract already transmitted data. Test these interleavings explicitly.

Keep follower histories, relationship facts, episode IDs, private source names and raw excerpts out of shared knowledge/citation caches. With memory off, this read and transient sidecar must not create conversation-memory writes. Existing quota, incident and spend accounting remain their present separate responsibilities.

## Required verification before calling the slice complete

No tests below were run in this audit.

1. **Actual reader fixtures and negative controls:** two owners, two Rooms under one owner, wrong replica, wrong agent, paused/unpublished Room, removed/replaced items, empty corpus, DB failure, malformed/overbound rows. Removing each key SQL scope must make its corresponding negative control fail. No private claims/context/follower table read belongs in this reader.
2. **Actual `roomSay` seam:** both memory-consented and memory-off followers receive the correct public Q&A block; only the former invokes existing memory writes/recall. Another follower's facts, owner's private Mirror facts and unpublished review cards never enter compile, provider request or source sidecar. Existing disclosure, stale token, follower age, thread scope, quota and never-rule refusals still precede dispatch. Feed fake Azure transport only to verify emitted request bytes and origin, not answer quality.
3. **Compiler/provider boundary:** absent block preserves prior bytes; actual engine bundle includes the field; labels and limits hold for Hindi/English/Unicode/control-marker payloads. Verify hostile “system prompt,” role markers and instructions cannot break structural boundaries; actual output never-rules still apply. Verify every sidecar item survived actual adapter slicing. Tests must remove the real insertion/validation guard to prove sensitivity.
4. **Citation behavior:** sidecar hashes final gated/delivered text; supplied references come solely from this exact prompt set; no `exact:true` or fabricated document attribution. Generic citation catalog contains only active published Q&As. Public anchor resolves; removed item no longer renders. Exercise old response/UI callers and empty/suppressed turns. No-memory client history does not gain a hidden persistent evidence transcript.
5. **Real PostgreSQL:** EXPLAIN the exact new scoped retrieval/revalidation statements with real UUID casts. Execute disposable exact-development fixtures proving returned rows for every cross-owner/Room/replica/agent/removed case, empty/five-row order, and removal/replacement between read, dispatch and delivery. Also inspect the existing showcase setter's retire-then-insert behavior; it is two statements and must not be misreported as an atomic replacement. No migration is needed for this recommended slice; existing `vy_room_showcase` FK cascade and room index already exist. Run relcheck with actual development URL and verify existing owner erasure reach; mocks cannot certify this SQL.
6. **Regression/release:** existing Room and Room-door/leak suites, public showcase/creator-page suites, compiler byte-identity and adversarial-creator suites, Azure-only/shared-reply suites, typecheck/copy/build and required frozen release/context gates. Update parser expectations for the new reader without dropping an old privacy assertion merely to green the suite. The new public source field is not permission to broaden private disclosure.
7. **Real usefulness acceptance, separately authorized:** on real Azure at a pinned model/config, compare existing Room versus this slice with owner-reviewed questions answerable by the five Q&As, related but unsupported questions, Hindi/English/Roman-to-Devanagari phrasing, conflicting user claims and malicious Q&A payloads. Record n, date, actual supplied hashes, correctness/support, unsupported expert attribution, abstention/uncertainty, private leakage, latency and spend. Fixture success proves connection, not grounded-answer quality. No claim of comprehensive expert knowledge follows from five public answers.

## Reusable modules and rejected shortcuts

Reuse the showcase writer/public page, real compiler material boundary, existing Room session/ACL path, shared `gatedReply` and never-rules, Azure reply/budget adapter, canonical hashing and existing test harnesses. Preserve `approvedMirrorRecall` and materializer in their private scope. Existing generic embedding/halfvec code can rank some personal memories, but is unnecessary for five Q&As and does not supply a published-expert corpus or grant.

Rejected: reading all approved claims under the creator ID; turning training consent into publication; passing the owner's person ID to follower recall; treating mined/routed item names as public citations; putting expertise in the follower's shared-past record; importing `_room-publish.js` back into `_room-surface.js` and creating a cycle; inferring per-sentence citations from a supplied prompt; adding a new knowledge-publication database before using the public Q&A authority already present; and claiming Azure production acceptance from source configuration alone.

Measurement for parent log: one read-only source audit on 2026-09-07 identified the real ordinary reply caller, private recall boundary, published Q&A authority and missing retrieval edge. No database, runtime/provider, user-data inspection or accuracy measurements occurred. Report written only to ROOT `scratchpad/expert-tools`.
