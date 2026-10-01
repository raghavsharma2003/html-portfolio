# Source turn selection

Private `@vyakti/source-turn-selection` 0.1.0 is a dependency-free, synchronous
ESM source selector with TypeScript declarations. It has no imports, I/O, clocks,
provider, database or framework dependencies. It is UNLICENSED and not published;
the manifest does not grant an external redistribution license. Use the files
directly or a local `file:` dependency in projects where their use is authorized.

```js
import { selectSourceTurns } from "./api/_group-recall/selection.js";

// The host must first authorize and normalize these records. These two synthetic
// domains illustrate the adapter boundary, not provided authorization adapters.
const documentComments = [{ sourceId: "comment:9", order: "9", episodeId: "review:2",
  speakerId: "editor:ivy", speakerLabel: "Ivy", recordedAt: null, text: "Keep the blue cover." }];
const result = selectSourceTurns({ query: "Keep the blue cover.",
  currentSourceId: "comment:9", currentSpeakerId: "editor:ivy",
  candidates: documentComments, mode: "lexical_recency" });
// Send result.turns directly as the source-bearing model turns. Do not append
// the current question again. Use result.rawTexts for raw-human vocabulary.

const warehouseApprovals = [{ sourceId: "approval:18", order: "18", episodeId: "shipment:4",
  speakerId: "inspector:lee", speakerLabel: null, recordedAt: "2026-10-01T09:00:00.000Z", text: "Hold pallet C." }];
const approval = selectSourceTurns({ query: "Hold pallet C.",
  currentSourceId: "approval:18", currentSpeakerId: "inspector:lee",
  candidates: warehouseApprovals, mode: "recency" });
```

## Frozen version 1 contract

Input has exactly five own enumerable data properties: `query`,
`currentSourceId`, `currentSpeakerId`, `candidates`, `mode`. Each candidate has
exactly `sourceId`, `order`, `episodeId`, `speakerId`, `speakerLabel`, `recordedAt`, `text`.
Identity fields are generic nonempty strings, at most 160 UTF-16 units, with no
leading/trailing whitespace or control characters. Order is a unique canonical
unsigned decimal string of at most 40 digits; comparisons do not lose precision
through Number. Duplicate source IDs or order values are refused. `recordedAt`
is null or a canonical valid UTC `YYYY-MM-DDTHH:mm:ss.sssZ` string. The host must
not relabel recording time as transport event time. Current source must have the
greatest order and exactly match `query` and `currentSpeakerId`.

`speakerLabel` is null or a string with the same bounds as identity fields. It
describes only the current roster label, never an authenticated identity or
historical name. Output explicitly marks `speakerLabelKind` as
`current_roster_label` (or null). Labels count toward the complete source budget
but never enter `rawTexts`; the host must independently decide which labels are
nameable. This root-requested schema addition preceded selector execution but
followed the independent evaluation corpus freeze. That evaluation adds only
`speakerLabel:null` mechanically in its runner, preserving frozen corpus bytes,
texts, queries, expected sources and scoring.

Inputs must be inert plain/null-prototype records and dense native arrays. The
selector copies using own data-property descriptors; accessors, symbols, extra
fields, sparse arrays and exotic objects are refused without invoking ordinary
getters or `toJSON`. Cross-realm plain records and native arrays are supported.
Executable Proxies and modified JavaScript built-ins are outside the contract:
JavaScript cannot identify hostile Proxies without invoking their traps. No
claim of a sandbox against executable caller objects is made.

Limits are exported as `SOURCE_SELECTION_LIMITS` and are not caller-overridable:

| Boundary | Limit |
| --- | --- |
| Admitted candidates | 160 |
| Exact source text and query | 4,000 UTF-16 units each |
| Unique normalized query tokens | 32 in lexical_recency only; excess is refused |
| Mandatory context | Latest 20 sources, including current; all if fewer |
| Optional older context | Up to 12 sources; no more than 32 total |
| Serialized candidate pool | 524,288 UTF-8 bytes |
| Complete serialized source turns | 32,768 UTF-8 bytes |

`recency` selects only mandatory context and does not tokenize the query: its
`queryTermCount` is zero, and longer paragraphs within the exact text/payload
limits are not refused because of a ranking limit it does not use.
`lexical_recency` tokenizes copies with
NFKC, lowercase and Unicode letter/mark/number runs. Its frozen score is the
number of distinct query tokens also present in each older source. Repetition
does not add score. Positive scores rank descending, then descending numeric
order. In that order, an optional source is included if the complete serialized
turns still fit; oversized optional records are skipped, then later ranked
records may fit. Final source history is chronological by order. This simple
formula was frozen before the separate 48-case comparison; it has no stemming,
stop words, transliteration, semantic similarity or correction resolution.
An independent integration review subsequently found that applying the lexical
query-term cap to recency unnecessarily refused ordinary longer paragraphs.
That availability defect was fixed after the initial evaluation, without changing
lexical scoring, its term cap, corpus bytes, expected answers or other bounds.
The packet's coverage is `host_supplied_candidate_pool`: the portable selector
cannot establish that a pool is authorized, human-only, or the latest archive
window. Its actual `candidateCount` and fixed maximum of 160 are distinct from
that host responsibility. This metadata correction was also made after the
initial evaluation; final byte measurements must use the corrected packet.

The current source lives only in `packet.current`; other selected sources live
in `packet.history` in ascending order. Every record retains its exact original
text, source/episode/speaker/order/recording identity, and a complete UTF-16 span.
Unestablished source revision, occurrence time, reply ancestry and subject IDs
remain null. A mention does not turn the mentioned person into the speaker.
Repeated matching text in distinct historical records remains distinct evidence;
"current once" means its source record is emitted once, not global text dedup.

The immutable result contains `packet`, `turns`, `serializedTurns`, `rawTexts`,
`selectedSourceIds` and content-free `metadata`. `turns` is one user turn whose
content is `JSON.stringify(packet)`. `serializedTurns` is `JSON.stringify(turns)`.
The 32 KiB check counts the latter's actual UTF-8 bytes, including both JSON
escaping layers, attribution fields, limits, wrappers and current text. Equality
at the limit is accepted. Original evidence is never truncated or normalized.
`rawTexts` and `selectedSourceIds` are in chronological source order, current
last. Neither metadata keys nor speaker IDs enter `rawTexts`.

The detached canonical candidate pool has an independent 512 KiB serialized
UTF-8 cap, below the turn-checkpoint kernel's 1 MiB serialized-character cap.
This does not guarantee a larger combined checkpoint DTO fits; the host must
enforce its complete read-set limit. The source-turn cap also excludes compiled
system/safety/persona prompts and provider transport overhead. The host must
bound the complete model input separately. Bytes are not model tokens.

## Refusals and authority

Failures throw a frozen, content-free `SourceSelectionError` with
`code = "source_selection_unavailable"` and one reason:

- `invalid_input`: malformed/oversized fields or excessive lexical-mode query tokens.
- `current_source_mismatch`: latest source does not match current ID, speaker or text.
- `candidate_context_over_budget`: serialized complete pool exceeds 512 KiB.
- `required_context_over_budget`: mandatory context exceeds 32 KiB.

The caller must not generate or send after refusal. Errors contain no input
values or nested causes. Packet limitations always say `historical_observations`
and `currentStateEstablished: false`: retrieval is not a current fact, consensus,
answer citation or answer-quality guarantee. Coverage is only the supplied pool,
not the whole archive or an independently verified authorization boundary. The
host must authorize and choose that pool, which may contain fewer than 160
sources. Relevant corrections may be outside it or have no lexical overlap.

Authorization, human-only admission, stable source cutoff, complete audience,
revocation, erasure and consent belong to the host. Bind the entire admitted
candidate read set to the turn checkpoint, not only selected records. Never
fall back to an unrestricted read after a database failure. Selection does not
resolve concurrent changes or make a later external send atomic, durable or
exactly once. There are no learned/derived memories or dependent-forgetting
claims in this package.

Run offline contract tests from the repository root:
`node evals/source-turn-selection/run.mjs`.
