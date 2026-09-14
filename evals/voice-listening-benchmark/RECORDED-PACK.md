# Recorded listening-pack prerequisite

8 September 2026. Versioned plan preparation and recorded-outcome validation only. This does not generate audio, ingest real protected voice, expose a player, verify a speaker, or produce a likeness result. Legacy August loaders/default commands stay separate.

## Explicit existing CLI

```
node scripts/voice-listening-benchmark.mjs recorded-prepare --plan PLAN.json --home NEW_DIRECTORY
node scripts/voice-listening-benchmark.mjs recorded-verify --home DIRECTORY
node scripts/voice-listening-benchmark.mjs recorded-ingest --pack PACK.json --media-root MEDIA_DIRECTORY --home DIRECTORY
```

Preparation validates the entire declared plan, records its canonical SHA-256 with a random run secret in `private/recorded-run.json`, and writes only opaque run/plan commitments and counts to `served/manifest.json`. It reads no media, signs no consent, performs no inference and stays `not_started`. The private file is integrity-sealed by hash, not encrypted. Keep it outside any public document root and use the existing allow-list server. New-directory creation is exclusive; failed or existing outputs are not overwritten. `recorded-verify` revalidates the private plan and exact public allow-list. It verifies preparation commitments, not voice evidence.

`recorded-ingest` validates the full outcome inventory, then currently fails `recorded_external_verification_unavailable` before media reads or writes. The existing app delivery/sealing APIs do not verify arbitrary imported source authority, independent listening evidence, recorded generations and required protection. No CLI flag or environment variable selects the fixture verifier. Unknown/mixed/duplicate flags are errors. The historical `listen`/score flow cannot turn a prepared directory into an instrument because no page, audio, trial file or historical sealed key is created.

## Plan contract

`vyakti-recorded-listening-plan/v1` has exactly: `contract`, canonical lowercase UUID `runId`, `corpus`, `subject`, `candidates`, `conditioningGroups`, `attempts`, and `deliveryRecipe`.

- Corpus: `{id, version, items, sha256}`. The hash is SHA-256 of canonical `{id,version,items}`. Each item is `{id,language,text,textSha256,eligibleCandidateIds}`; language is `hi`, `hi-Latn` or `en-IN`. Exact original text is kept. Candidate eligibility must match declared candidate languages before an attempt exists.
- One subject: `{id,conditioningReferences,listeningReference}`. Every reference is `{id,subjectId,purpose,audio,transcript,preprocessingSha256,authority}`. Purposes are `conditioning` and `independent_listening`; transcript is `{text,sha256}`. Audio and authority are descriptors `{path,sha256}`. Same audio cannot claim both purposes. Declared different bytes do not prove statistical independence, consent or ownership; the missing external verifier must establish those facts.
- Candidates: `{id,languages,identity}`. Identity commits `modelSha256`, `tokenizerSha256`, `vocoderSha256`, `adapterSha256` (hash or explicit `none`), `runtimeImageSha256`, `settingsSha256`. These declarations do not identify a live deployment without verified external evidence.
- Conditioning groups: `{id,comparisonRecipeId,comparisonKind,arms}`. Arms map each candidate to `{candidateId,referenceId,referenceManifestSha256,normalizationRecipeSha256}`. A reference manifest hash is SHA-256 of its full canonical object. `weights_only` requires identical reference/normalization plus tokenizer/vocoder/runtime/settings; otherwise explicitly declare `pipeline`. Different synthesis text also refuses a weights-only cell.
- Attempts: `{id,runId,subjectId,itemId,candidateId,conditioningGroupId,comparisonRecipeId,listeningReferenceManifestSha256,repeatIndex,normalization}`. Every declared generation receives exactly one terminal outcome. Duplicate IDs or duplicate candidate/item/group/repeat cells refuse. Normalization is `{sourceTextSha256,synthesisText,synthesisTextSha256,recipeSha256,reconstructedTextSha256,receipt}`. The receipt descriptor commits the exact canonical normalization object without its receipt property. An external verifier must establish semantic reconstruction; a matching hash alone cannot do that.
- Delivery recipe is currently only `preserve_exact_protected_bytes/v1`. No automatic padding, gain, trim, resampling or protection stripping occurs.

Objects reject unknown fields. IDs are bounded ASCII identifiers; references/run/subject have their separately validated shapes. Plan/pack JSON is bounded to2million characters; corpus/attempt inventory to1000, candidates/references to20, groups to30. Source/reference locators are relative local paths. Absolute, encoded, backslash and parent escapes refuse. The real file reader resolves the root and file, rejects junction/symlink escapes, checks file size before reading (50MB ceiling), verifies the complete SHA-256 and emits content-free errors.

## Recorded outcomes and comparison scope

`vyakti-recorded-listening-pack/v1`: `{contract,runId,runPlanSha256,corpusSha256,outcomes}`. Every outcome has `{attemptId,runId,state,generationId,timing,cost}`. Timing records `startedAt`/`endedAt`; only uncertain completion may use a null end. Cost is `{status:'unknown',microUsd:null}` or `{status:'recorded',microUsd:<nonnegative safe integer>}`. Recording a number is not invoice reconciliation.

`success` additionally requires `output`, `protection` descriptors and `delivery:{recipe,originalSha256,deliveredSha256,history:[]}`. Failed/uncertain outcomes require a bounded `failureCode` and must have no audio/delivery/protection entry. All attempted generations stay in the denominator. Failed and uncertain attempts create no rating row. A lone successful arm cannot become a matched comparison or winner.

New cell scope includes `(runId,planSha256,subjectId,conditioningGroupId,listeningReferenceManifestSha256,comparisonRecipeId,language,exactSourceTextSha256)`. Candidate is intentionally outside the key. A revised plan cannot reuse the former cell even if run/group IDs are reused. The explicit new scope mode rejects missing fields; the legacy default keeps its old keys and rejects accidental recorded-scope input.

Pure `ingestRecordedPack` accepts explicit verifier/reader dependencies for later integration and offline tests. Every reference, original output, normalization receipt and protection receipt is re-read and checked; verification decisions must bind the complete corresponding commitment. Test signatures are public, visibly synthetic fixtures, and can return only a recorded `synthetic_fixture_only` assurance in the fixture helper. They are not production authority and are never imported by the CLI. Even the pure successful result remains `playbackStatus:unavailable_prerequisite_only` and `humanListeningStatus:not_rated`.

Every reference and successful output is independently validated as24kHz monoPCM16, with its exact original bytes/hash/receipt. Independent reference and output durations may differ. No common-duration restriction, padding or volume transform is imposed. A future optional transformed delivery recipe needs its own protection-preservation proof and sealed history. The UI currently has one reference player, so multi-subject or multiple listening-reference plans are refused rather than taking the first.

## Executed checks and limits

`node evals/voice-listening-benchmark/recorded-run.mjs`:71 focused groups passed, synthetic tones/signatures only, with actual functions, real CLI invocations and five loopback requests. Zero outbound requests, model generations or human listeners. Exact old loader/grouping snapshots are portable committed fixtures with SHA-256: unknown-new-pack refusal and cross-subject legacy merging execute before new controls. Other checks cover each scope field (including plan hash), substitutions, receipt drift, duplicates/missing attempts, failure/uncertainty retention, signed fixture binding, root/junction escapes, size bound, unknown verifier and actual CLI exposure/overwrite guards. Final artifact `scratchpad/recorded-pack-1788808528648/result.json`; initial66/70control passes retained separately. The initial fixture-capture command had an incorrect relative import and failed before producing fixtures; it was corrected and no passing result was inferred from that error.

`node evals/voice-listening-benchmark/run.mjs`:35 existing mechanics passed. Historical private scratchpad audio was absent and explicitly skipped; no historic owner pack was opened. Syntax checks passed. No browser, Docker, cloud, provider, build or second full release ran. No arbitrary new rubric, pairwise preference field or model ranking was added. Astra bounded review found no present CLI authority bypass and identified the cross-plan hash requirement, now implemented and tested.

Decision: freeze declarations and comparison scope before any new voice spend. Reverse if an equivalent tested generic adapter exists, the owner declines comparison, or actual authority/protection integration contradicts these contracts. Rejected: repurposing dated August IDs/counts; merging same text across subject/reference/plan scopes; turning fixture signatures or `protectionVerified:true` into authority; transforming protected bytes without evidence. Root owns release registration and future external verification/admission work.

Root/Astra correction before freeze: the first candidate unnecessarily required reference/output duration equality. The actual signed170ms reference and70/120ms outputs reproduced that old refusal against sourceSHA4bca531fe7b4735312bc53f687ee03610ca23347ff35d83a5831a45ea8080a2a, retained in scratchpad/recorded-unequal-old-negative.json. That requirement was removed. Final actual success checks independently signed unequal durations and byte-for-byte verifier inputs, while wrong-format/hash/signature failures remain. No real media became available.
