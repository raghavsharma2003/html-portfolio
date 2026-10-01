# Frozen source-selection comparison

Date: 1 October 2026. Initial status: corpus preregistered before executing or reading the selector implementation. Results will be appended without changing the frozen corpus. This is invented offline selection evidence, not human usefulness, model quality, privacy enforcement or a reproduced external benchmark.

## Preregistration

Corpus: `evals/group-source-recall/cases.mjs`, version `group-source-recall-48-v1-20261001`. Eight families (older evidence, speaker/subject, disagreement, corrections, role wording, dissent, audience changes, revocation/erasure), English/Hindi/Hindi-English code-switching, two cases per cell: 48 cases. The three language forms share scenario structure; they are not 48 independently sampled conversations. Every name, text and group event is invented; no external dataset or private conversation is copied.

Each case has 40 numbered source positions, with source 40 the exact current question and sources 21–40 mandatory. Privacy-sidecar cases omit prohibited source 7 before invocation, leaving 39 admitted candidates. Relevant older sources are fixed at positions 3 and, for disagreement, 7. Recent corrections are at 30. A post-cutoff correction exists only in the outside-coverage sidecar at 41 and cannot be treated as recovered. Ground truth includes exact target, correction, recent, distractor and nonadmitted IDs plus known limitations.

Variant 1 uses explicit shared topic wording. Variant 2 adds 14 irrelevant catalogue entries containing the entire query, all newer than the main old target. It deliberately pressures the 12-optional-source limit and includes paraphrase, implicit dissent, changing labels and cross-script cases. These failures must remain in the report. Shared function words are not stripped; incidental overlap is not semantic understanding.

The candidate's formula was supplied as a public contract, not inferred from implementation: NFKC, lowercase, Unicode letter/mark/number tokens, at most 32 distinct query terms, distinct-token intersection count, strictly positive older matches, descending decimal source order for ties. At most 20 mandatory recent plus 12 optional older sources, maximum 32. Older rows may be omitted to keep the exact `JSON.stringify(turns)` UTF-8 payload at or below 32,768 bytes; mandatory-overflow must refuse. The baseline uses the same input, serialization and byte ceiling but no older selection. No score tuning or corpus revision after result inspection is permitted under this version.

## Registered measurements and limits

- Exact relevant older sources selected / available, per case and by family/language/variant; case success alone hides partial disagreement coverage.
- Exact target and recent-correction coverage. Outside-coverage corrections are reported separately and are never scored as available targets.
- Mandatory recent inclusion, recorded speaker/episode/source identity, original text and full UTF-16 span preservation, current question exactly once as a source record, chronological order.
- Full final-model-turn JSON UTF-8 bytes, refusals and optional/distractor selections; no estimate of provider tokens or full application prompt size.
- Nonadmitted sidecars never enter selector input or output. This is an evaluation-harness assertion, **not** proof that the selector authorizes, discovers, erases or revokes any source. Real SQL and caller mutation tests must provide that independent evidence.

The frozen fixture artifact contains historical text, including conflicting and outdated statements. Exact preservation does not make a statement true, current, speaker-endorsed or a valid answer citation. Speaker/subject and dissent cases check preservation, not semantic resolution. Changed audience witness and revocation requirements are recorded as host requirements, not capabilities of the pure selector.

Mutation/validation/resource controls will be separate from the 48 selection cases. Offline selection performs no model call, SQL, server, transport or external write. Do not promote this comparison into a product-readiness or multilingual-understanding claim.

## Freeze receipt

The evaluator sent these hashes to root before any selector execution or implementation inspection:

- Corpus source SHA-256 (LF bytes): `db2bc977ff56a593ac5041262057cff8169f15448a6da6e7570689c5c68a0193`.
- `JSON.stringify(CASES)` SHA-256: `0abf425e092810d1ddd22addeb9ac28e7c882bf904e36043d929bb28e93872e1`.
- `JSON.stringify(CORPUS_METHOD)` SHA-256: `768f38485c01f79ae74bdfd73b7e4c6f1f6c01eaafc00263c7f9b6a4a64c2838`.
- Initial preregistration document SHA-256 before this receipt append: `bbd36ed5579773e18c0772154fb7901cbfc57a98efbd9db66c13a259a21bc29a`.

After corpus freeze, the root approved one DTO contract addition: required `speakerLabel`, identifying a current roster label. The runner mechanically supplies `speakerLabel:null` to every candidate, identically in both modes. No frozen text, query, source identity, ground truth, rank formula or corpus file changed. Label preservation receives a separate contract case. The runner checks both semantic hashes and the source hash, normalizing only checkout CRLF to LF for the latter.

Results remain unmeasured at this preregistration receipt; measurements follow below only after the run.

## Measured offline result

Executed 1 October 2026 on Node 24.13.0 through the existing network-blocking preload. The selector's observed source SHA-256 was `a0e953461afcf411ecbf4a6039c2a9cea80c771b4e6b5553ad2e9badef7966a5`. This identifies the measured working-tree file, not a claim that a later commit or deployment ran. The evaluator imported the black-box API without reading its scoring implementation. Both arms used the same frozen admitted pools with the documented null-label schema adapter.

| Measurement across 48 cases | Recency | Lexical-recency |
|---|---:|---:|
| Relevant older source IDs recovered / available | 0 / 54 | 27 / 54 |
| Cases with every relevant older source recovered | 0 / 48 | 24 / 48 |
| All relevant source IDs, including recent corrections | 3 / 57 | 30 / 57 |
| Mandatory recent source IDs retained | 960 / 960 | 960 / 960 |
| Available recent corrections retained | 3 / 3 | 3 / 3 |
| Irrelevant catalogue distractors selected | 0 | 288 |
| Exact source/speaker/episode/text/span records checked | 960 | 1,275 |
| Selection refusals | 0 | 0 |
| Minimum / maximum serialized-turn UTF-8 bytes | 8,037 / 9,435 | 8,454 / 17,669 |

The apparent aggregate gain is narrowly explained: on the 24 explicit-wording variant-1 cases, lexical-recency recovers all 27 older targets, while recency intentionally has no access beyond its recent 20. **On all 24 adversarial variant-2 cases, lexical-recency recovers none of the 27 older targets and selects 12 irrelevant catalogue titles per case.** This is not a breakthrough retrieval-quality result. It demonstrates older-source reach and a serious lexical relevance limit under exact-query distractor pressure. Bytes remained well below the ceiling in these comparison cases, so rank/overlap, not budget overflow, caused those misses. Do not hide this result behind a pooled percentage.

Each language form has the same structured outcome: recency 0/18 older targets, lexical-recency 9/18; both preserve 320/320 recent sources and 1/1 available recent correction. Because the language forms share scenarios and the distractor design, this equality does not establish multilingual equivalence or generalization. Cross-script semantic matching is explicitly absent in a separate contract case.

| Family, six cases each | Recency older IDs | Lexical-recency older IDs |
|---|---:|---:|
| Older evidence | 0 / 6 | 3 / 6 |
| Speaker versus subject | 0 / 6 | 3 / 6 |
| Disagreement | 0 / 12 | 6 / 12 |
| Corrections | 0 / 6 | 3 / 6 |
| Role wording | 0 / 6 | 3 / 6 |
| Dissent | 0 / 6 | 3 / 6 |
| Audience changes | 0 / 6 | 3 / 6 |
| Revocation/erasure | 0 / 6 | 3 / 6 |

Attribution and original text/span checks passed for all 2,235 selected records across both arms. This establishes faithful selected-record packaging, not that an answer would distinguish quotation, reported speech, dissent, subject or consensus. The three post-cutoff corrections remain unavailable and are not in the coverage denominator. Twelve prohibited sidecar sources never enter either arm. This last observation is by construction and **does not prove authorization or erasure**; their host requirements still need real SQL/caller tests.

### Exact compact case receipts

Every baseline selects IDs `meera_log:21` through `meera_log:40`. Every variant-1 candidate adds `meera_log:3`, and disagreement variant 1 additionally adds `meera_log:7`. Every variant-2 candidate instead adds exactly IDs `6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18`, all with the `meera_log:` prefix; none is a relevant target. This repeated-ID notation specifies all 96 source selections without concealing the failed cases. Exact bytes for every case follow; cells are baseline/candidate, not text-only sizes.

| Family | Language | Variant 1 bytes | Variant 2 bytes |
|---|---|---:|---:|
| Older evidence | English | 8,140 / 8,541 | 8,140 / 13,906 |
| Older evidence | Hindi | 9,053 / 9,563 | 9,053 / 16,823 |
| Older evidence | Code-switching | 8,053 / 8,454 | 8,053 / 13,963 |
| Speaker/subject | English | 8,142 / 8,538 | 8,144 / 13,958 |
| Speaker/subject | Hindi | 9,083 / 9,612 | 9,074 / 17,084 |
| Speaker/subject | Code-switching | 8,054 / 8,454 | 8,053 / 13,963 |
| Disagreement | English | 8,158 / 8,962 | 8,158 / 14,128 |
| Disagreement | Hindi | 9,103 / 10,110 | 9,103 / 17,461 |
| Disagreement | Code-switching | 8,065 / 8,874 | 8,065 / 14,119 |
| Corrections | English | 8,205 / 8,606 | 8,152 / 14,062 |
| Corrections | Hindi | 9,208 / 9,707 | 9,072 / 17,070 |
| Corrections | Code-switching | 8,109 / 8,499 | 8,057 / 14,015 |
| Role wording | English | 8,144 / 8,549 | 8,139 / 13,893 |
| Role wording | Hindi | 9,080 / 9,612 | 9,061 / 16,927 |
| Role wording | Code-switching | 8,052 / 8,463 | 8,037 / 13,767 |
| Dissent | English | 8,216 / 8,624 | 8,216 / 13,994 |
| Dissent | Hindi | 9,435 / 9,978 | 9,435 / 17,433 |
| Dissent | Code-switching | 8,174 / 8,593 | 8,174 / 14,000 |
| Audience changes | English | 8,145 / 8,580 | 8,145 / 13,971 |
| Audience changes | Hindi | 9,119 / 9,719 | 9,119 / 17,669 |
| Audience changes | Code-switching | 8,067 / 8,505 | 8,067 / 14,145 |
| Revocation/erasure | English | 8,145 / 8,580 | 8,145 / 13,971 |
| Revocation/erasure | Hindi | 9,119 / 9,719 | 9,119 / 17,669 |
| Revocation/erasure | Code-switching | 8,067 / 8,505 | 8,067 / 14,145 |

### Separate contract evidence and preserved setup failure

The independent runner passes 22 additional contract groups. These cover frozen hashes/matrix, original CRLF/emoji/combining-mark spans and labels, normalization without source rewriting, no cross-script match, empty-query recency, repeated-keyword scoring, duplicate/sparse/accessor DTO refusal, current identity/speaker/text mismatch, unknown assistant-role field rejection, oversized labels, candidate/query-term limits, mandatory overflow, JSON-escape overhead, exact 32,768-byte acceptance followed by one-byte-over refusal, and three rejecting output-integrity mutants. The role-field refusal is schema validation, not an independent human/assistant classifier. The three mutants validate the evaluator's oracle, not production authorization.

During boundary-test authoring, the first synthetic filler range topped out at 32,665 bytes and therefore failed the test's expectation of reaching 32,768. Increasing only that separate contract fixture's base filler from 1,200 to 1,210 ASCII characters made the binary search span the boundary. The corrected case accepts exactly 32,768 and refuses the additional byte. The selector and the 48-case frozen corpus were unchanged; preserve this as a test-fixture setup failure, not a product defect or hidden retrieval tuning.

No cloud/provider cost, model invocation, SQL, HTTP server, live group transport or human task was incurred. This work establishes a reproducible lower-level boundary and reveals a failure class worth improving. A successor relevance method must have a separately versioned hypothesis and fresh held-out cases; changing weights against these known answers and rerunning them cannot be reported as independent progress. Whole Group AI, semantic correction resolution and answer usefulness remain unestablished.

## Final contract-correction rerun

On 1 October 2026 the frozen corpus was rerun against selector source SHA-256 `87afbb37eed8bf5e3a19fdccdc5c6d7a11aa531fd594bb40b2d13ad13f427acc`, through the same network-blocking preload. The first measured hash, original results, byte table and setup failure above are preserved. Neither the frozen corpus/ground truth nor the lexical scoring formula changed.

Two independent integration findings required contract corrections, not relevance tuning:

1. Recency mode no longer tokenizes a question or rejects more than 32 distinct query words. Its `queryTermCount` is zero because it does not score terms. The unused lexical cap previously created a normal-paragraph availability regression. Lexical-recency retains its original 32-distinct-term cap and formula.
2. The pure unit's coverage label is now `host_supplied_candidate_pool`. It cannot prove that its input is the latest 160 authorized human turns. Admission, authorization and pool choice remain the host's responsibility. The frozen comparison still supplies the same 39/40 admitted candidates to both modes; the application's chosen default pool is a separate integration decision.

The runner's coverage assertion was aligned with that explicit contract. A 23rd separate contract group now verifies that a 33-distinct-word question succeeds in recency while the existing lexical refusal control remains. All 23 pass, including the unchanged exact 32,768-byte acceptance/one-extra-byte refusal control. The runner verifies the same corpus source and semantic hashes on every invocation.

Selection outcomes are unchanged: recency 0/54 older targets, lexical-recency 27/54; both 960/960 recent sources, 3/3 available corrections, zero refusals, and exact preservation of 960/1,275 selected records respectively. Every variant-2 case still misses its relevant older targets and selects 12 distractors, for 288 total. Family and language coverage counts and all 96 selection-ID patterns above remain exact. Revised metadata reduces serialized sizes: recency 8,032–9,430 bytes; lexical-recency 8,449–17,664 bytes.

Root's integration decision is to keep **recency as the default** and retain lexical-recency only behind server-owned `GROUP_SOURCE_RECALL_MODE` opt-in, rather than promote the failed adversarial method as generally better. This selector-only comparison does not verify that application switch, its SQL pool or provider routing; those require the separate real-caller/SQL evidence. The new default can preserve attributed recent context without claiming that older lexical recall is ready for broad use.

### Final exact byte receipts

Cells below are baseline/candidate `JSON.stringify(turns)` UTF-8 bytes for the final measured selector hash. The earlier table belongs only to the first hash.

| Family | Language | Variant 1 bytes | Variant 2 bytes |
|---|---|---:|---:|
| Older evidence | English | 8,135 / 8,536 | 8,135 / 13,901 |
| Older evidence | Hindi | 9,048 / 9,558 | 9,048 / 16,818 |
| Older evidence | Code-switching | 8,047 / 8,449 | 8,047 / 13,958 |
| Speaker/subject | English | 8,136 / 8,533 | 8,139 / 13,953 |
| Speaker/subject | Hindi | 9,077 / 9,607 | 9,068 / 17,079 |
| Speaker/subject | Code-switching | 8,048 / 8,449 | 8,047 / 13,958 |
| Disagreement | English | 8,152 / 8,957 | 8,152 / 14,123 |
| Disagreement | Hindi | 9,097 / 10,105 | 9,097 / 17,456 |
| Disagreement | Code-switching | 8,059 / 8,869 | 8,059 / 14,114 |
| Corrections | English | 8,200 / 8,601 | 8,147 / 14,057 |
| Corrections | Hindi | 9,203 / 9,702 | 9,067 / 17,065 |
| Corrections | Code-switching | 8,103 / 8,494 | 8,051 / 14,010 |
| Role wording | English | 8,138 / 8,544 | 8,134 / 13,888 |
| Role wording | Hindi | 9,074 / 9,607 | 9,056 / 16,922 |
| Role wording | Code-switching | 8,046 / 8,458 | 8,032 / 13,762 |
| Dissent | English | 8,211 / 8,619 | 8,211 / 13,989 |
| Dissent | Hindi | 9,430 / 9,973 | 9,430 / 17,428 |
| Dissent | Code-switching | 8,169 / 8,588 | 8,169 / 13,995 |
| Audience changes | English | 8,140 / 8,575 | 8,140 / 13,966 |
| Audience changes | Hindi | 9,113 / 9,714 | 9,113 / 17,664 |
| Audience changes | Code-switching | 8,061 / 8,500 | 8,061 / 14,140 |
| Revocation/erasure | English | 8,140 / 8,575 | 8,140 / 13,966 |
| Revocation/erasure | Hindi | 9,113 / 9,714 | 9,113 / 17,664 |
| Revocation/erasure | Code-switching | 8,061 / 8,500 | 8,061 / 14,140 |
