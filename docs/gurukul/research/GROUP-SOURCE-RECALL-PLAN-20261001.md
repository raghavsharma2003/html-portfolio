# Source-preserving group recall: bounded implementation plan

Date: 1 October 2026. Status: **design only, unimplemented and unvalidated**. No retrieval benchmark, provider experiment, live SQL, transport test, or user-quality result follows from this document. It extends [the portable-layer research](PORTABLE-GROUP-LAYER-20261001.md) and preserves every open requirement in [the GroupAI readiness ledger](GROUPAI-READINESS-20260929.md).

Continuation note: the status above records the original preregistration. A later working implementation, corrected provider-envelope accounting and the decision to keep lexical recall opt-in are described in [the implementation companion](GROUP-SOURCE-RECALL-IMPLEMENTATION-20261001.md). The [frozen comparison report](GROUP-SOURCE-RECALL-EVAL-20261001.md) records executed results, including adverse cases; it does not retroactively turn this plan into a validated quality claim.

## Objective and non-goals

Retrieve relevant older, actual human group turns beyond the current 20-turn window while retaining their source identity and disclosure authority. Reuse the existing PostgreSQL source of truth and the real group caller. The reusable component is a bounded, provider-neutral selector, not a new memory database, learned-fact writer, or parallel authorization system.

No new datastore, migration, provider, background job, automatic fact/persona update, assistant-history admission, or external code copy is proposed. Selection success would establish access to attributed historical observations, not that they are correct, current, agreed by the group, or used faithfully in a generated answer.

## Existing source and actual integration seam

| Source | Current behavior | Proposed change |
|---|---|---|
| `api/_room.js::roomHistoryEvidence` | Reads at most 40 rows; actual speak caller asks for 20. Joins logs to matching agent/group episodes and applies `disclosurePredicate("episode", BIND)` before ordering/limiting. Excludes assistant and unattributed rows. | Reuse its full authorization query shape in a separately named bounded candidate reader, without weakening existing history behavior. |
| `api/_room.js::logRoomTurn` | Writes episode-bound human text, recorded speaker, and `at = now()`; limits stored content to 4,000 UTF-16 units in JavaScript. | No writer change required. |
| `api/_room.js::roster` | SQL selects `person_id`, but its returned DTO drops it. Current display names are resolved separately from historical log text. | Retain `person_id` additively so the adapter can supply an explicit speaker-ID/current-display-name map. Do not invent historical names. |
| `api/_surface.js::onGroupMessage` | Speak path reads facts, bridge, roster, and history; binds them to the turn guard; maps historical rows into user strings, losing speaker metadata. | Replace only the speak path's history candidate read and selection/rendering seam. Reaction and DM paths remain unchanged. |
| `api/_surface.js::createGroupTurnGuard` | Binds immutable scope and source snapshots to repeated current SQL/platform checks. | Bind the entire admitted candidate pool, not only selected rows. Keep all existing authority checks. |
| `api/_surface.js::gatedReply`, `honestyContextFor`, `deliver` | Check authority around provider generation and before delivery fragments. Vocabulary currently reads whole user-message strings. | Preserve checkpoints; avoid treating packet metadata/IDs as human vocabulary. |
| `api/_group-runtime/checkpoints.js` | Dependency-free in-memory snapshot comparisons; not an atomic send or durable delivery guarantee. | Reuse unchanged limits and guarantees. Do not raise limits to accommodate unbounded recall. |

The implementation must prove the path from `onGroupMessage` through `gatedReply`, not only an independently callable selector. Event, destination, agent, room, transport methods and immutable scope remain bound as in the current checkpoint integration.

## Authoritative candidate read

Proposed host API:

```ts
roomSourceCandidates(groupId, recipients, {
  agentId,
  throughLogId,
  limit: 160
}, tableResolver)
```

Reuse the complete current `roomHistoryEvidence` join and `disclosurePredicate("episode", BIND)`, including same-agent/group joins, human-only role, non-null speaker, and unsuperseded episode. Add an explicit fixed upper source boundary:

```sql
and l.id <= $6::bigint
order by l.id desc
limit $7::integer
```

Preserve the existing typed bindings for recipients, group, negative tags and agent. Select `l.id, l.role, l.content, l.at, l.episode_id, l.speaker_person_id`. The disclosure predicate must occur before ordering and limiting; ranking never admits rows. A database error is not a valid empty result and must not activate an unrestricted fallback.

`throughLogId` is the current human log ID already written by this immutable turn. It must not be request-supplied or recalculated on subsequent reads. This prevents a later message from displacing the current question during revalidation. It also means a concurrent correction after that cutoff is outside this turn's snapshot: no claim of globally current state follows.

The candidate boundary is **the latest 160 authorized human turns**, not the complete archive. The existing `(group_id, id)` index helps ordering, but neither bounded output nor this source audit proves bounded database execution time. Hosted query evidence and latency/resource measurements are required. No index or migration is proposed before that evidence.

## Portable selector contract

Proposed pure API, with no imports or ambient I/O:

```ts
selectSourceTurns({
  query,
  candidates,
  currentSourceId,
  mode: "recency" | "lexical_recency",
  recentCount: 20,
  maxSelected: 32,
  maxPayloadUtf8Bytes: 32768
})
```

This function accepts already-authorized inert DTOs; accepting a DTO grants no permission. It should:

1. Validate bounded input and require the exact current source, recorded speaker and current text expected by the adapter.
2. Preserve the most recent 20 admitted human turns, including the current turn, as mandatory context. When fewer exist, preserve them all.
3. For the candidate mode, add up to 12 older lexical matches, for no more than 32 selected sources total.
4. Rank normalized copies only: NFKC, lowercase and Unicode letter/mark/number tokens. Keep original text unchanged. Bound query terms to 32 unique tokens; use distinct-token overlap with deterministic inverse-frequency weighting or a preregistered simpler overlap baseline. Do not reward repeated keyword stuffing.
5. Break ties with descending numeric source/log ID, not an invented event timestamp. Render selected records in source order, not relevance order.
6. Drop only optional older records when the whole payload budget is exceeded. Never truncate a source or silently drop mandatory recent context.
7. Fail closed with a content-free `required_context_over_budget` outcome if the mandatory context cannot fit. No provider or delivery operation follows that refusal.

The final scoring formula and serialization must be frozen before evaluating the 48 cases. Do not tune them on the evaluation answers and then report the same cases as held out.

### Attribution and available coordinates

A normalized source record can carry:

```ts
{
  sourceId: "meera_log:123",
  episodeId: "91",
  speakerId: "recorded-person-id",
  sourceRevision: null,
  recordedAt: "database-recording-timestamp",
  occurredAt: null,
  replyToSourceId: null,
  subjectIds: null,
  text: "exact original text",
  span: { unit: "utf16", start: 0, end: text.length }
}
```

`l.at` records storage time (`now()`), not verified transport event time. Current schema does not establish a source revision, provider message ID, reply ancestry, subject IDs or correction relationship. Keep unavailable fields null, never infer them from adjacency. A later content fingerprint must be labeled a snapshot fingerprint, not a database revision or authorization token. Do not substitute the current display name into historical text.

Speaker identity is the recorded author. A saying something about B does not make B the speaker, nor does a mention establish an inferred subject identity. Current display names can be an explicit map from retained roster person IDs; unknown or departed labels must stay unknown instead of being guessed.

The packet must disclose its limitations, for example:

```ts
{
  interpretation: "historical_observations",
  currentStateEstablished: false,
  coverage: "latest_160_authorized_human_turns",
  replyAncestryAvailable: false
}
```

Recent mandatory context helps retain recent corrections. It does not prove that every relevant correction is included or that conflicting statements have been resolved. Corrections outside the candidate window, later concurrent corrections, and paraphrased or cross-script corrections without lexical overlap remain unsupported. Hindi Romanization-to-Devanagari matching is not a capability of this proposed lexical selector.

## Whole-payload resource contract

The proposed selected-source ceiling is **32 KiB = 32,768 UTF-8 bytes**, measured on the complete serialized payload, including metadata, source/speaker IDs, labels, coordinate fields, limits and wrappers. Text-only size, UTF-16 length, character estimates or approximate token counts cannot satisfy that gate.

The adapter must measure the final source-bearing representation after embedding/escaping, not only a smaller inner JSON object. Represent the current question exactly once in the final model turns; its metadata and content count toward the source payload budget even if emitted separately as the final question. An actual serialization format and exact byte-boundary tests are prerequisites to acceptance, not details to defer until after measuring the corpus.

Independently bound the full application model input after compilation and final turn assembly, for example at a separately reviewed 96 KiB ceiling for `JSON.stringify({ compiled, turns })`. This second proposed ceiling includes non-source prompt material and prevents a compliant evidence packet from implying a bounded request. Neither ceiling claims to measure provider-specific HTTP overhead or exact model tokens. Refuse rather than silently cut required compiled safety material.

Additional input bounds: at most 160 candidates, 4,000 UTF-16 units per stored source and query, 32 query terms, 32 selected records, bounded metadata fields, and an explicit serialized candidate cap below the existing checkpoint snapshot limit. Reject duplicate source IDs, sparse or inherited array entries, accessor-bearing DTOs, malformed dates/IDs, oversized metadata and missing current-source identity. Worst-case JSON escaping must count against the candidate bound; ordinary text size alone is not sufficient. Return content-free counts/errors, not source text in telemetry.

## Binding, privacy and revocation

The speak path reads its candidate pool alongside existing facts, bridge and roster, then binds that entire read set to `guard.bindSources`. Selection uses a detached immutable copy. Every repeated read uses the same group, agent, recipients, current-log cutoff and limits. A changed candidate, changed attribution, failed read, removed episode/participant, changed deny/grant, or changed transport audience must invalidate the turn according to the existing authority/source comparison contract.

Binding only selected rows is rejected for this first design: changing an omitted candidate could change which evidence should have been selected. Do not silently rerank and reauthorize a new snapshot halfway through a turn. Conservative invalidation may reduce availability and should be measured honestly.

Preserve current assistant exclusion: a past assistant paraphrase has no complete durable dependency lineage. Preserve the distinction between ordinary member departure and explicit withdrawal/erasure under the existing disclosure policy; benchmark expectations never override that policy. No raw private turn becomes group-shareable through lexical relevance.

Rechecking authority before provider and delivery is still checkpointed, not an atomic external-send transaction. It cannot retract an already completed disclosure or guarantee exactly-once delivery. No source read-set item is thereby a validated answer citation.

## Raw-text-only vocabulary and rendering

`honestyContextFor` currently treats each entire non-assistant message string as human text. Wrapping historical turns as JSON without adapting this input would put IDs, metadata keys and formatting labels into `hisVocabulary` and other human-history derivations.

The implementation should provide an explicit bounded raw-source-text input for the group path while retaining the full attributed packet for the provider. At minimum, human vocabulary must use only exact source text; derived commitment/history processing must not mistake metadata for human utterances. Preserve existing non-group behavior and separately review which labels are trusted/nameable. Do not fix attribution by laundering a metadata packet into a person's speech.

## Preregistered 48-case comparison

Eight families, three language forms (English, Hindi, code-switching), two cases per cell: **48 invented selection cases**. Compare recency and lexical-recency on identical admitted pools, authority rules and serialized budgets.

| Family | Two cases in every language form |
|---|---|
| Older evidence | Relevant source beyond 20 turns; high-overlap but irrelevant distractor. |
| Speaker versus subject | A speaks about B; B quotes A without becoming A. |
| Disagreement | Conflicting attributed statements; no invented consensus. |
| Corrections | Correction inside mandatory recent context; correction outside coverage with no current-state claim. |
| Role-specific wording | Different honorifics; current display label differs from historical text. |
| Dissent | One explicit dissent remains attributable; a majority does not erase author identity. |
| Audience changes | A late joiner cannot read an old source; changed audience witness blocks effects. |
| Revocation/erasure | Selected source removed; participant/deny/grant change removes eligibility. |

Report source-selection recall, speaker/subject attribution integrity, contradiction/correction coverage, full serialized bytes and refusal counts. Do not turn selection scores into answer-quality, multilingual-understanding, user-value or superiority claims. Record unsupported language/script cases as limitations rather than relabeling misses as success.

Separate adversarial contract cases cover empty query, no-match older sources, repeated keywords, combining marks, CRLF/emoji spans, exact byte boundaries, oversized metadata, sparse/duplicate rows, assistant rows, missing current source, SQL failure and unavailable cross-script matching.

## Required gates and acceptance order

1. Pure selector tests, declarations and two unrelated inert adapters demonstrate portable selection/resource behavior without Vyakti SQL or provider assumptions.
2. Hosted `evals/group-sql-authority/run.mjs --hosted-postgres` executes the actual captured candidate query against canonical synthetic PostgreSQL. Verify cutoff/order/limit, same-room/agent, late join, explicit withdrawal, deny/grant revocation, erased/superseded episodes and assistant/legacy-unattributed exclusions. Source-only tests are not SQL proof.
3. Extend `evals/group-turn-authority/run.mjs` through the real `onGroupMessage` caller: an older source reaches the provider with attribution; current question occurs once; source/authority changes block provider and send; budget refusals have zero provider/send effects.
4. Add rejecting mutations for every load-bearing SQL predicate, fixed cutoff, speaker mapping, mandatory recent inclusion, full-payload byte check and complete candidate-source binding.
5. Register the suite in the actual eval registry and run relevant source, type, copy, packaging and integrated hosted release gates. Preserve existing Room/DM/reaction behavior and all previous failure receipts.
6. Evaluate the frozen 48-case comparison and log exact source, methods, outcomes, costs and limitations. Promotion requires an observed improvement under identical authority/resource budgets with no boundary regression. It is not automatic because a new selector exists.
7. A separately authorized, consenting human group task remains necessary for usefulness and answer-quality acceptance. No local server/database, live provider, real transport or new spend is authorized by this design.

The first useful acceptance claim, if these gates pass, would be **bounded, attributed retrieval of older currently authorized human source turns**. Durable derived memory, semantic correction resolution, dependent forgetting, group media, native shared UI, durable effects and whole-layer readiness remain separate work.
