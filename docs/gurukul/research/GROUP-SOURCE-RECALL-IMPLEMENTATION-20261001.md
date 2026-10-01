# Source-preserving group recall: implementation and activation boundary

Date: 1 October 2026. This is the implementation companion to the [preregistered design](GROUP-SOURCE-RECALL-PLAN-20261001.md) and [frozen comparison](GROUP-SOURCE-RECALL-EVAL-20261001.md). At this initial receipt, the working integration has not passed its new combined hosted release or actual PostgreSQL run. The previous `3e036e7d` result cannot verify these changes. Whole Group AI readiness remains open.

## What the actual path does

The speak branch of `api/_surface.js::onGroupMessage` reads through `api/_room.js::roomSourceCandidates`. It preserves the existing episode disclosure predicate before ordering and limiting, excludes assistant/unattributed sources, and fixes its upper log ID to the human turn just stored. The complete admitted pool, current roster, facts and bridge remain bound to the existing authority/source checkpoints. The reaction and direct-message paths retain their incumbent history behavior.

`api/_group-recall/selection.js` is a private dependency-free local package, `@vyakti/source-turn-selection`. It copies and freezes inert source DTOs, retains the current question exactly once inside its source-bearing model turns, and separates stable recorded speaker/source/episode identity from an optional current roster label. Source text and UTF-16 spans stay exact. Unavailable event time, source revision, reply ancestry and inferred subject IDs stay null. A storage timestamp is normalized to UTC milliseconds; it is not verified event time or a source revision. Packet coverage is only `host_supplied_candidate_pool`, not a claim that the portable function independently established authorization or searched the full archive.

The model receives an explicit current record and chronological historical records. The honesty gate receives original selected human text separately: JSON keys, IDs and roster labels are not human vocabulary or commitments. Selected current labels use the existing explicit nameable channel. Existing shared-past support already unions human and retrieved vocabularies; this is a lexical safeguard, not proof that a generated answer correctly attributes speakers, subjects, events or current beliefs.

## Default and experimental mode

Only the server environment selects `GROUP_SOURCE_RECALL_MODE`:

| Value | Actual group behavior |
|---|---|
| Absent or `recency` | Read at most 20 currently authorized human turns; preserve them as attributed required context. |
| `lexical_recency` | Read at most 160 authorized human turns; preserve the latest 20 and add up to 12 older positive lexical matches. |
| Any other value | Refuse the speak path before generation; do not silently select another mode. |

The mode and query limit are captured once before the candidate read and reused throughout the turn. Message text, request fields and model output cannot choose the mode. This setting is not a new credential and does not authorize a provider call, deployment or private-data trial.

**Lexical recall is not enabled by default.** The frozen comparison recovered 27 of 54 older targets versus zero for recency, but missed all older targets in the 24 deliberately adversarial cases and selected 288 irrelevant catalogue distractors. The corpus and scoring formula were not tuned after that observation. This proves bounded older-source reach, not a breakthrough in relevance or answer quality. Default recency avoids paying the larger candidate-read cost or injecting those additional distractors. An opt-in can support separately authorized evaluation; it is not a recommendation to activate the mode for users now.

## Resource boundaries and failure behavior

- At most 160 candidate DTOs, 4,000 UTF-16 units per source/query, 32 selected records, and 524,288 UTF-8 bytes for the normalized candidate pool.
- Lexical mode accepts at most 32 distinct normalized query terms. Recency does not tokenize or apply that unused scoring limit, so an ordinary longer paragraph is not refused merely for having many words.
- The entire `JSON.stringify(selection.turns)` must fit 32,768 UTF-8 bytes, including metadata, labels, JSON escaping and role/content wrappers. Optional older rows can be omitted; required recent sources cannot be silently truncated or removed. Oversized required context refuses generation.
- Immediately before provider dispatch, the group path checks a second envelope: `JSON.stringify({ compiled: { core, tail }, turns })`, at most 98,304 UTF-8 bytes. Both providers actually consume `core`, `tail` and turns. Duplicate compiler `system` and diagnostic fields are excluded because neither adapter sends them. This is not a provider-token or complete HTTP-body accounting claim.
- Core and tail additionally must fit the existing provider adapters' 64,000 and 24,000 UTF-16 segment caps. Refuse before their slices, preserving complete required safety/personality text.

Two real integration defects were found before acceptance. The first byte check counted the compiler's duplicate `system`, making an ordinary compiled result 111,236 bytes and suppressing a short group reply. The provider-relevant empty-turn envelope was 55,541 bytes; the explicit projection above removes that double counting without removing prompt content. A separate probe showed that a 65,000-character core could fit the byte budget but be truncated downstream; the segment checks close that gap. Exact boundary and ordinary real-compiler tests are required independently of the selector's unit checks.

The previous unconditional 32-term validation also rejected long recency queries without doing useful work. That was corrected only for recency. The comparison corpus remains byte-identical; the report preserves initial and final selector hashes and the serialization-size changes caused by corrected coverage metadata.

## Verification and limits

Local verification is network-blocked and starts no server or database. The portable unit, frozen comparison, actual group caller, source-only SQL harness and existing surface/audience suites are separate evidence. Actual captured-query SQL must execute on the existing synthetic GitHub-hosted PostgreSQL workflow, and the integrated candidate must pass hosted release and APK checks. Final run identities belong in the canonical context and [readiness ledger](GROUPAI-READINESS-20260929.md), not an assumed result here.

No external implementation or dataset was copied, package published, framework/store installed, migration applied, provider called or deployment performed. Required-context refusals can reduce availability and need real task measurement. Checkpoints are not atomic external sends; selected sources are not validated answer citations. Durable effects, dependency-safe derived forgetting, group media, native shared-group UI and consented live usefulness remain separate work.
