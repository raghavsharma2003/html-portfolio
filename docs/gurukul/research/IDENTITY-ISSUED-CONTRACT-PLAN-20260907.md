# Versioned identity challenge issuance contract

7 September 2026. Implementation plan from read-only inspection of the integration tree based on `1051ed68`. Only this document is changed by this task. No SQL, provider, decoder, model, deployment or cloud operation ran. Root owns release and context logging. Release9 results are separate evidence; this plan is not an implemented or accepted identity path.

The next implementation should make the language, bank, comparison policy and provider profile properties of the **issued challenge**, then carry that immutable contract through capture, lease, measurement and settlement. Keep Azure-only identity verification disabled until the complete path and its acceptance prerequisites pass. The new `identity_audio.derive` and Azure `transcribeBytes` components exist, but neither currently has an identity verifier caller.

## Source facts that determine the change

| Boundary | Current behavior and required consequence |
|---|---|
| `api/_replica-voice-identity.js:176-206` | One unversioned twelve-item bank randomly mixes English with Roman Hindi. Six random nonce digits are appended. No selected locale, bank version or item identifier survives issuance. Split the bank by explicit recognition locale and version its exact contents. |
| Same module, `:427-503` | Issue writes sentence/hash/nonce, global challenge policy, exact reference genome version and expiry. Latest genome must be draft or approved; a retired latest must not fall back to an older genome. Retain these properties. |
| `db/migrations/072_replica_voice_identity_challenge.sql:36` and `db/schema.sql:2726` | Challenge and attempt tables exist. There are no issued locale/profile/contract columns. Both decision JSON fields have a 4096-byte SQL limit. No new evidence table is necessary for the proposed compact manifest. |
| `api/_replica-voice-identity.js:751-859` | Lease binds the issued reference version, but neither filters nor returns `challenge_policy`. It records the verifier chosen by the current process in the attempt. A later deployment can therefore select a different policy/provider unless the new query explicitly matches the issued profile. |
| Same module, `:312-375`, `:882-954`, `:1032-1076` | Decision and sweep use the current global policy; settlement logs the current policy constant. New decisions must resolve an exact retained version, and settlement must compare it to the stored challenge. |
| Same module, `:597-733` | Intake authorizes separate video and transcript uploads and waits for both to be quarantined. New-profile intake must accept only capture video, and finalize using that actual updated source. Old two-upload semantics must not leak into the new verifier. |
| `api/_voice-identity/verifier.js:57-145` | Legacy verifier measures the video and independently transcribes a client WAV with `"unknown"`. Strict Azure mode refuses its construction and configuration. Add a distinct profile implementation; do not replace a provider name inside this method. |
| `api/replica-voice-identity.js:69`, `src/creatorStudio/voiceIdentityApi.ts:20`, `StudioApp.tsx:2290`, `VoiceIdentityChallenge.tsx:288-385` | Actual UI/API issue call has no language; recorder uploads video plus WAV. These are required caller edits, not optional UI follow-up. |
| `db/migrations/112_replica_locale.sql` | `vy_replica.locale` means creator interface language. It is not authority for a spoken challenge or recognition request. |
| `api/_replica-processing/builders.js:89-97,116` | Reference vectors retain evidence ID, vector and confidence by family, without explicit model revision fields. The older evidence adapter drops service `model_revisions`. A family name does not establish reference/candidate model revision compatibility. |

Issue and upload creation explicitly check live capture/storage consent. The current lease and settlement shapes do not independently repeat those consent predicates. Existing consent/source-erasure actions invalidate challenges, but this is not a reason to omit live predicates in the new path. Root is auditing lifecycle and lock ordering separately; this plan does not claim those races are resolved.

## Migration number and additive schema

The actual top-level SQL inventory ends at `136_room_follower_month_note.sql`; `137` is the next unused sequential number in this checkout. Proposed file: `db/migrations/137_replica_voice_challenge_issued_contract.sql`. Recheck the inventory immediately before creating it. The old AGENTS `064` claim is stale. Do not reuse apparent gaps or rename the content-addressed local-voice reconciliation SQL files; their original numbers overlap other branches. The migration runner reads top-level `.sql` files in sorted order, while the reconciliation inventory is separate.

Add these five nullable columns to `vy_replica_voice_challenge`, with **no inferred/default/backfilled values**:

| Column | Proposed type and rule |
|---|---|
| `issued_locale` | `text`, exactly `hi-IN` or `en-IN` for the new contract. |
| `sentence_bank_version` | `text`, exact registered bank version. Proposed IDs: `identity-bank-hi-deva/v1`, `identity-bank-en-latn/v1`. |
| `verifier_profile` | `text`, exact registered profile ID, proposed `azure-shared-audio/v1`. |
| `issued_contract` | `jsonb`, object with the fixed schema below; bounded to 4096 bytes. |
| `issued_contract_sha256` | `text`, lowercase 64-character SHA-256 of canonical UTF-8 JSON. |

One table CHECK must enforce either all five columns are SQL NULL (legacy) or all five are present and valid (new). Check JSON types and required keys explicitly: PostgreSQL CHECK accepts UNKNOWN, so a missing JSON key must not slip through a comparison returning NULL. Require JSON locale/bank/profile/challenge ID/policy/reference version to match their row counterparts. New rows require positive `reference_genome_version`. Do not require a new contract on preexisting terminal rows.

Implement each DDL statement idempotently, without DO blocks, mirror it into `db/schema.sql`, and use explicit UUID casts in all runtime predicates. Retain the current decision/attempt 4096-byte limits. A bounded content-free receipt fits; raising the limit to store transcripts, vectors or decoder output is not a substitute for a receipt design. Existing erasure deletes these same challenge/attempt rows, so no new reach edge or table is required; nevertheless keep source/full-erasure and `scripts/relcheck.mjs` coverage proving both tables remain reachable.

## Exact issued document and server authority

Create a pure shared module, suggested `api/_voice-identity/issued-contract.js`, that owns canonicalization, strict validation, immutable bank/profile registries and their lookup. Use the existing `canonicalJson` sorted-key JSON implementation. Never hash PostgreSQL `jsonb::text` and assume it equals the application's encoding.

The proposed document has these fields, with no additional keys:

```text
schema = "vyakti.identity-issued.v1"
challenge_id, replica_id, owner_user_id = server-owned UUID strings
issued_locale = "hi-IN" | "en-IN"
sentence_bank_version, sentence_bank_sha256, sentence_item_id
sentence_hash, nonce_sha256
normalizer_version = "challenge-speech-nfkc-digitfold/v1"
decision_policy_version = "voice-identity-challenge/v2"
verifier_profile = "azure-shared-audio/v1"
verifier_profile_sha256
reference_genome_version = positive integer
```

All hash fields are SHA-256 of exact UTF-8 content or canonical JSON according to the field's documented encoding. `sentence_hash` retains the existing exact full-sentence hash, including nonce text and punctuation. `nonce_sha256` commits the exact server-generated six space-separated digits. The bank hash commits ordered item IDs, exact text, locale and expected script. The profile hash commits the entire descriptor below. Account identifiers remain in the private row; only the opaque contract hash goes to the evidence service. Do not put raw vectors, transcripts or expected sentence text into the profile or service request.

The owner explicitly selects `hi-IN` or `en-IN` before issue. UI language may preselect a visible choice, but the authenticated issue request must contain the exact selected locale. Missing, `auto`, `unknown`, mixed-case, unsupported or guessed values receive a named error before DB mutation. The server alone chooses the bank item, nonce, version and profile. Reject client attempts to set sentence, nonce, bank/profile version or contract hash. Test injection helpers stay below the HTTP boundary.

English uses a reviewed English bank. Hindi uses a separately reviewed Devanagari bank; do not relabel the existing mixed Roman bank `hi-IN`. Hindi/Hinglish recognition or preference quality remains unmeasured. Adding Roman Hindi display, transliteration or number-word normalization requires its own bank/normalizer version and test evidence, not a heuristic after recognition.

An exact genome version is selected inside the current issuing SQL. To include that version in an application-computed hash without guessing, add an owner-scoped read of the latest eligible candidate, prepare the contract, then retain a single atomic issue mutation whose latest-genome CTE also requires that prepared version and draft/approved status. If the latest version changes, return a named reissue/preparation conflict without substituting another reference or recomputing only half the document. Make supersession depend on final insert eligibility so an unsuccessful preparation does not expire an existing issued challenge. This is an optimistic issue binding, not a claim of serialized retirement protection.

The minimum contract above binds the existing issued version, not a separately hashed full reference definition. An independent reference-evidence commitment can follow a deliberately versioned contract. The ordinary writer at `api/_replica-model-build.js:208-211` permits same-version conflict updates only when source-set hash and definition are already identical; this audit does **not** demonstrate an ordinary mutable-draft writer. Source erasure can retire and rewrite the definition, and lifecycle predicates still matter.

## Profile and recognition rules

The immutable profile descriptor should commit:

- Evidence schema `vyakti.identity-audio.v1`, operation `identity_audio_v1`, and capture-only authority; the exact supported video/container/codec and 32 MiB input bounds from the service contract.
- Canonical 24 kHz mono PCM16 WAV, maximum 720000 decoded frames, `capture-to-pcm24k-v1`, and its exact parameter hash. The descriptor cannot promise padding or cropping; service AAC padding that exceeds 30 seconds is currently rejected.
- The required speaker families and expected immutable speaker revision identifiers, verified against actual returned `model_revisions`. Preserve the actual observed revisions in the receipt. Do not infer historical reference revisions from today's pinned service constants.
- Azure Speech short REST adapter/protocol, exact issued locale, no phrase/nonce hints, 16 kHz transport and `pcm24k-to-pcm16k-windowed-sinc-v1` transform. Azure's managed recognizer does not supply an immutable acoustic-model revision here. Record that absence explicitly; adapter version, resource origin and API route are not a model revision.
- Normalizer and decision policy versions, mandatory six-digit nonce, current numerical speaker/overlap thresholds and reference-window requirement. Do not silently recalibrate those numbers while connecting transport.

For v2, a missing or wrong nonce always prevents acceptance. Provider failure, empty transcript or missing commitments is a platform failure, never voice-only success. `normalizeChallengeSpeech` preserves combining marks and folds digit scripts but does not transliterate or map spoken number words. Preserve those exact semantics under its version.

Current comments say script mismatch becomes review, but current code rejects every low-overlap result as `sentence_not_read`. Make the new v2 behavior explicit: only after reference sufficiency, mandatory nonce and minimum speaker requirements pass, a defined expected-script mismatch may return a closed `review` with `script_alignment_unverified`. Same-script low overlap keeps the existing refusal. No review outcome sets identity fields. Do not promise a human review service while no consumer is connected; the UI must say verification is incomplete and offer supported retry/reissue actions. This policy change must not reinterpret v1 verdicts.

## Caller changes in implementation order

1. Add the contract module, additive migration and pure tests. Update `clientVoiceChallenge`/`CHALLENGE_RETURNING` and `src/creatorStudio/types.ts` to expose issued locale, bank/profile IDs, contract hash and a capture-only requirement. Keep internal profile details private.
2. Wire explicit locale through `VoiceIdentityChallenge.tsx`, `StudioApp.tsx`, `voiceIdentityApi.ts` and `api/replica-voice-identity.js`. Issue stores all five fields and hashes from one server-authored contract. Existing status/cancel callers continue to work on legacy rows.
3. Branch create/finalize by stored profile. New challenges admit only `role=capture` video; a separate transcript upload is refused. Finalize marks captured using the `updated_source` CTE's returned row and current authority predicates. Do not reread the just-updated source from the base table and expect a PostgreSQL data-modifying CTE to expose its new state within the same statement. Preserve full owner/source/hash/upload-fence checks and legacy cleanup support.
4. Lease only contracts supported by the configured verifier. Add exact challenge-policy/profile/hash predicates, return every issued field, validate/recompute the contract before provider work, and record the contract hash in the attempt's bounded running result. Unknown or missing contracts receive no Azure lease. Add fresh capture/storage consent and policy predicates at lease and settlement; retain exact issued reference version and draft/approved eligibility.
5. Add a separate Azure verifier implementation in `api/_voice-identity/`, leaving the old verifier behavior explicit. It calls `identity_audio.derive` with only `lease.capture` and the issued hash, then `transcribeBytes({bytes: canonical.body,sha256: canonical.sha256,byteSize: canonical.byte_size,locale: lease.issuedLocale})`. Verify ASR `audioCommitment.inputSha256` equals canonical SHA and the speaker input SHA. The client WAV is never read or used as a fallback. No fictional storage row or locator is created.
6. Extend sweep to pass the issued policy and validated commitments into decision. Add a strict typed content-free v2 basis, not merely new keys in the permissive whitelist. Include contract hash, capture/canonical/ASR transport hashes, exact frame geometry, transform/profile/normalizer identifiers and actual model revision metadata. Do not reuse `transcript_input_sha256` to mean a different object under the v1 schema. Rehash a compact evidence manifest and bind it to the current attempt.
7. Settlement revalidates the v2 contract, basis and manifest before SQL. Compare stored contract/hash/locale/bank/profile/policy/reference version, capture SHA, attempt verifier/version and active lease token/expiry in the SQL target. Derive `verified` solely from a valid versioned `accept`; reject inconsistent caller-supplied `decision`/`verified`/basis combinations. Preserve age, consent, owner, source and lifecycle conditions and evidence cleanup. Profile routing in `configuredVoiceChallengeVerifier` and the sweep is the last connection, after gates below; it remains disabled until then.

## Legacy, lifecycle and rollback

Legacy rows stay NULL in the new columns. Never infer their locale from sentence text, current replica locale, transcript script or current provider settings. Never synthesize a v2 contract during lease, retry, settlement or migration. A new challenge needs a new nonce, item and issue authority. Old terminal rows and their v1 bases remain readable historical evidence, without being relabeled as Azure results.

In strict Azure mode, old active rows must not be leased by the new verifier. Preserve cancellation and bounded expiry/reissue cleanup that respects upload capability and writer fences. Captured/verifying legacy rows can otherwise block new issuance indefinitely; root's lifecycle work must provide an explicit safe transition before enablement. Do not delete evidence early or mark identity accepted to unblock the UI. Non-strict legacy behavior may remain only behind its exact old profile; no Azure failure can fall back into it.

Rollback means stop new-profile issuance/leasing and retain rows/columns/version registries so status, cancellation and erasure still work. Never route v2 rows to v1 or drop the schema while rows depend on it. Existing accepted identity claims are a separate lifecycle matter; a transport migration must neither renew nor silently revoke them.

Plain `FOR UPDATE OF ch` and snapshot predicates do not serialize every concurrent consent revocation, genome retirement or source deletion. Require the parent lifecycle/lock-order review and bounded real interleaving tests before claiming that protection. This plan does not expand lock ordering speculatively.

## Gates and reversal evidence

The following are required tests to implement, not results of this audit:

- Pure contract tests: stable canonical hash with object-key reordering; different challenge/nonce/sentence/locale/bank/profile/policy/reference changes hash; unknown keys and partial/null field sets fail. Exact Hindi/English banks match their locale/script; profile and bank hashes change when semantics change.
- HTTP/UI tests: missing or unsupported locale cannot issue; request-controlled sentence/profile/hash cannot override server values; locale changes after issue have no effect. New capture-only flow reaches captured; transcript-role requests fail before upload; old rows remain readable/cancellable.
- Meaningful negative controls: remove the stored locale/profile/contract predicate and demonstrate an old or swapped row escapes; remove parent/canonical binding and demonstrate signed derivative substitution; remove nonce enforcement and demonstrate replay acceptance; remove the script-mismatch branch and demonstrate the claimed review becomes rejection. A fixture that merely matches a SQL substring is not SQL validation.
- Actual verifier-to-sweep tests with injected signed transport: capture A drives both embeddings and ASR; independently valid client WAV B cannot influence the transcript; altered canonical/transport/contract SHA fails before decision; bad locale/unknown profile/revisions cause zero provider dispatch. Missing nonce, same-speaker old recording and provider failure never open identity. Real PCM contract tests remain separate from model accuracy.
- Settlement tests: contract/locale/reference/profile/version mismatch, stale lease, wrong attempt, inconsistent verdict, missing/revoked consent, erased source and retired reference all leave identity closed. Terminal cleanup and legacy reissue preserve storage-writer fences and erasure reach.
- Apply the idempotent migration twice only in the explicitly authorized isolated development DB. Extend the existing actual-function EXPLAIN harness for every changed issue/preflight/create/finalize/lease/complete/retry/expiry SQL shape. EXPLAIN checks parsing/types only; bounded real row lifecycle/interleaving tests are separately required, with exact-created data cleanup.
- Run affected suites, SQL cast/relcheck/context checks and a frozen full release. No offline fixture or successful EXPLAIN establishes Hindi/Hinglish recognition quality, nonce reliability, false acceptance, reference revision compatibility, visual liveness or resistance to synthetic challenge response.

Enablement still requires deployed immutable service provenance, compatible reference-model evidence, bounded authorized Azure captures in each supported locale, replay/impostor controls and honest review handling. The managed Speech acoustic revision remains unavailable and must not be invented. Until these exist, a complete transport/contract implementation is a prerequisite, not completed identity verification.

Reversal condition: use a different schema, provider profile or language mechanism only when it demonstrates equivalent issue-time language/reference/nonce authority, same-recording ancestry, typed settlement and erasure/revocation behavior with fewer moving parts. Any bank, normalization, transform or decision behavior change requires a new immutable version and fresh issue; current environment settings cannot rewrite an existing challenge's meaning.
