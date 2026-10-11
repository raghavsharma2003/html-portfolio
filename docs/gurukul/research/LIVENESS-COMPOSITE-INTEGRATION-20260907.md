# Liveness composite integration contract, 2026-09-07

Status: proposed design only, based on local source inspection at integration checkpoint `a0e2523c`. No implementation, network requests, database queries, provider execution, calibration, or identity acceptance occurred. This report is outside the frozen integration tree. It supplements `docs/gurukul/research/FRESH-ENROLLMENT-RESOLUTION-20260907.md` and the sibling `IDENTITY-DEPLOYMENT-WIRING-20260907.md`.

## Decision

Introduce an additive `vyakti-liveness-composite/v3` policy with typed, independently attributable evidence and a new `vyakti-azure-liveness-broker/v2` wire protocol at `/v2/liveness/verify`. Keep the old policy and adapter immutable. The new endpoint can initially produce evidence and explicit inconclusive outcomes; **it cannot honestly produce accepted voice ownership with the available producers**.

The smallest truthful implementation is a versioned evidence composer, not a replacement collection of invented continuity/risk scores. Its missing requirement is a measured authority establishing that the person in the later phrase video is the document subject, is actually speaking that audio, and is not passing the relevant replay/injection/synthetic attacks. A completed earlier Face quicklink session does not establish any of these facts about the later video.

Retain the independent adult-document and official Face prerequisites. Do not let a new evidence-only result set identity/liveness timestamps or unlock artifact selection, ordinary genome builds, preview, or synthesis. The entire acceptance profile starts `servable:false`. Transport readiness and acceptance readiness are separate states.

Reversal condition: a deployed and evaluated Azure-hosted producer supplies the missing later-capture authority under the exact versioned contract and passes the preregistered acceptance campaign. An alternative single-ceremony capture is acceptable only with demonstrated official-provider support for the exact audio/video ancestry; shared session IDs or simultaneous browser recording alone are not that support. No such provider capability was verified here.

## Source facts driving the redesign

- `api/_liveness/providers/azure-composite.js` posts to the absent `/v1/liveness/verify`, using `vyakti-azure-liveness-broker/v1`. It expects `recognized_text`, `speaker_continuity_score`, `synthetic_risk_score`, `capture_binding`, `single_speaker`, and `provider_accepted`.
- `services/azure-verifier/src/server.js` implements document verification and Face session/resume/result/delete/cleanup, not the composite endpoint. Every existing authenticated route requires `broker_nonce` and `broker_issued_at`; the old composite request supplies neither. Adding a route alone would still fail freshness validation.
- `createLivenessVerdict` in `api/_replica-liveness-verification.js` uses independently supplied `challenge.officialFaceProof`, not the raw composite's nominal Face scores. Its existing policy is already **v2**, with phrase similarity 0.9, Face identity 0.9, continuity 0.85, and synthetic risk 0.02. These constants do not prove calibration or a producer exists.
- Lease/settlement require `passed_deleted`, current authentic adult document evidence, active biometric consent, matching owners/sources, and age. `src/studio/LivenessCapture.tsx` then records the phrase, with a 60-second browser timer. Official Face deletion precedes that capture. Do not retain provider media longer to disguise this gap.
- Old issue chooses a mixed Roman-Hindi/English phrase without an issued locale. The new speech-only module consumes a different, genome-bound issued contract and uses word F1 0.60, not the old phrase metric. Neither its function nor its threshold can be silently substituted into this flow.
- `services/voice-evidence/identity_audio.py` and `api/_replica-processing/providers/identity-audio-contract.js` provide bounded audio derivation/lineage primitives. The ceiling is decoded 30 seconds. They do not provide audiovisual speaker binding, calibrated synthetic risk, or proof that one embedding means one speaker.

## Required authorities and what they actually establish

| Evidence | Issuer and retained binding | Accepted meaning; prohibited inference |
| --- | --- | --- |
| Adult credential | Existing authenticated document verifier plus independent authenticity review; exact case, document SHA, subject/owner/replica, policy, expiry | Current authentic adult evidence. OCR or Face score alone cannot set age. Missing review stays unavailable/pending. |
| Official Face | Existing official Face broker, retained signed result digest, reference SHA, model version, challenge/session association, completion and deletion receipt | The provider's live session matched the credential reference under its policy. Does not attest later audio or later video. |
| Phrase issue | Application-owned immutable v3 challenge row/commitment | Which phrase, six-digit nonce, exact locale, source slot, limits and policy were issued to this owner. Browser copies cannot replace issuance authority. |
| Captured bytes and ASR | Private stored-object verification, signed decoder receipt, then Azure Speech on those exact canonical bytes | Exact ancestry of recognized audio to the uploaded container and issued task. Does not prove that the device was honest, the speaker owns the voice, or the recording was live. |
| Later audiovisual ownership | New measured producer or explicitly evaluated attended process; signed exact-capture receipt | Document subject visible in this capture, responsible for its audible speech, temporal continuity and defined attack checks. Currently unavailable. A face match on one frame, lip-sync correlation, diarization count or cosine similarity alone does not supply the whole authority. |
| Final acceptance | Application settlement under pinned approved policy and current database state | All required evidence and consent remain eligible in one authorized settlement. No upstream generic `provider_accepted` may override a failed/missing facet. |

Same-speaker comparison against a separate verification reference is an optional alternative producer for a defined facet, not a substitute for binding that reference to the document subject. Two embedding families are not two independent reference windows. Any reference path must use the independent temporary authority in the fresh-enrollment report, not a fake genome or the challenge audio compared with itself.

## Minimal v3 issued and response contracts

Use a new liveness-specific issued schema, `vyakti.liveness-issued.v3`. Do not alter the existing voice-issued schema requiring a positive genome version. Persist and independently validate its canonical SHA at issue, upload/finalize, lease, every downstream dispatch and settlement.

Required immutable fields:

- `challenge_id`, `owner_user_id`, `replica_id`, `identity_case_id`, `document_sha256`, `capture_source_id`, `biometric_consent_receipt_sha256`.
- `issued_at`, `expires_at`, `issued_locale` (`hi-IN` or `en-IN` initially), exact bank/item/version, phrase SHA, exactly issued six-digit nonce, normalizer/nonce-parser/scorer versions, capture/decoder profile, acceptance profile ID and SHA. No inferred `auto`/`unknown` locale, no transliteration fallback. These are proposed locale limits, not reviewed bank approval.
- Explicit decoded duration ceiling `30000` ms, input byte ceiling, accepted container/codec/track layouts, decoder/transform versions, and the supported retry/expiry policy. Numerical resource ceilings are engineering bounds, not biometric accuracy claims.

Face results happen after issue. Preserve the original issued hash and bind the actual immutable Face result and deletion digests in a separate server-owned evidence envelope at lease; do not mutate the issued document or claim it already contained future evidence. Require reference document equality and same challenge ownership.

Wire request to `/v2/liveness/verify` includes protocol, request ID, attempt, issued commitment/envelope, source descriptor with exact SHA/bytes/MIME and short private-read capability, expected deployed verifier revision, `broker_nonce` (16 random bytes as 32 hex), and `broker_issued_at`. Reuse the broker's 120-second freshness bound. Sign exact canonical request bytes. Do not resend identity-document bytes to the ASR-only lane; only the approved later-capture identity producer may require a separately scoped document capability.

The signed response must echo protocol, request ID, attempt, issued SHA, source SHA, verifier revision, request semantic digest, and bounded issuance/expiry. It contains separate receipts:

1. `audio_lineage`: actual container SHA, full decoded audio frames/rate/channels, canonical PCM/WAV SHA and byte count, decode/transform version; exact ASR transport SHA/rate if it differs. A supplied hash without recomputation is not evidence.
2. `speech`: actual Azure ASR model/API configuration and locale, exact nonce result, phrase/scorer version and measured score, and `match|reject|inconclusive`. Raw transcript can be transient inside the trusted execution path; durable result remains content-free. The old 0.9 and detached 0.60 metrics must not be conflated. Implement a separately versioned scorer and leave its acceptance profile unapproved pending language measurement.
3. `capture_owner`: `unavailable|inconclusive|reject|pass`, producer/policy/revision, exact video/audio lineage, credential reference SHA, evidence digest, and explicit facet results for subject identity, audible-speaker binding, temporal continuity, and tested presentation/digital attacks. Missing producer returns `unavailable` with a reason. Optional real raw model outputs require named scales and revisions; no default zero risk, unit confidence or inferred probability.

The composite need not fetch official Face again. The application combines its independently verified Face envelope with these response receipts. One scalar `capture_binding:true` is forbidden because transport lineage and biometric binding are different assertions.

Transport replay checks alone are insufficient across process restart or multiple replicas: persist logical `(challenge, attempt, semantic_digest)` idempotency/lease authority in the application. Identical retry may replay a retained signed result; changed inputs under the same logical attempt must refuse. Refreshing an expiring read URL must preserve the immutable locator/bytes and authority. Stale response expiry, lease token or attempt cannot settle. Existing broker replay maps are process-local; do not describe them as durable protection.

## Decision and capture behavior

Final reducer rules are conjunctive, with no replacement of unavailable by low risk:

```
invalid binding / stale authority / revoked consent -> no settlement
current adult credential absent                  -> prerequisite blocked
official Face failed                             -> reject
official Face deletion incomplete                -> waiting on platform cleanup
speech rejected                                  -> reject
speech inconclusive                              -> inconclusive, no identity
capture-owner missing or inconclusive             -> inconclusive, no identity
capture-owner rejected                           -> reject
all facets pass + profile approved + live guards  -> eligible for settlement
```

An invalid signature or provider outage is a platform failure, not evidence of an impersonating user. Review is a valid state only after a real scoped reviewer queue and authenticated decision consumer exist. No UI promise of review without that caller.

For new v3 video challenges, expose the committed duration ceiling to the UI and stop capture with tested codec headroom below it. The server enforces the full decoded frame bound; no rounding allowance, truncation, clip selection or ASR-on-first-30-seconds workaround. The exact browser stop margin requires observed supported-browser/codec measurements. Unsupported or oversized captures ask for a fresh bounded recording. Historical 60-second captures retain their old version; do not relabel them v3. If legitimate readers cannot complete reviewed phrases in the bound, revise bank wording or introduce a separately evaluated longer capture profile rather than silently cropping.

Accepted v3 identity should retain its complete receipt chain and current age/credential/consent conditions. Cancellation, withdrawal, source erasure, identity-case expiry/replacement and replica revocation must serialize against settlement. Use a shared per-replica lock discipline across every relevant mutation, then revalidate all predicates within the same transaction; a challenge-only lock plus snapshot joins is insufficient. Implement and prove the discipline rather than merely mentioning it in a SQL comment.

This outcome proves only the accepted challenge speaker. It does not establish ownership of arbitrary later training uploads or every diarized speaker in them. Preserve existing source review/consent and artifact approval gates. Any stronger claim that selected training voice belongs to this verified subject requires retained ancestry or compatible measured speaker comparison from the accepted capture to the selected source windows. Do not silently convert the challenge into a training source or a lasting reference.

## Exact evidence required before `servable:true`

The following is a measurement specification, not results. No requested n or target below has already been met.

| Campaign | Required measurements and records | Acceptance authority |
| --- | --- | --- |
| Official document/Face path | Actual authorized current adult case, exact supported document media, authentic/rejected/inconclusive paths, official result/model/reference hashes, deletion retries and receipts; vendor operating policy and applicability to this resource | Accountable identity/security reviewer and existing independent document reviewer. Generic AIServices presence is not limited-access approval. |
| Capture compatibility | For each supported browser/device/container/codec cell, count of attempts, decoded frame duration, timer overshoot distribution, track mapping, corruption/extra-track/empty/overbound rejection, CPU deadline/peak memory and derivative hashes; real camera bytes | Engineering owner approves supported matrix and headroom. Synthetic decoder fixtures supplement, not replace, actual captures. |
| Phrase recognition | Per locale and approved bank item: participants, utterances, actual transcripts, nonce exact-match false reject/false accept, wrong/extra nonce acceptance, phrase error distribution, script-inconclusive rate, recording/completion latency; actual Azure Speech configuration | Native-language reviewers approve wording/scripts; security/product owners freeze the operating point. The lexical test suite alone does not approve it. |
| Later capture subject and speaker | Speaker-disjoint genuine and impostor trials; false match/nonmatch and inconclusive rates; document-to-visible-subject error; visible-to-audible-speaker error; substitution/splice acceptance. Record raw outputs with pinned model/transform revisions | Named producer owner documents mechanism and domain; independent security reviewer approves threat coverage and measured operating point. A vendor score or a human signature without a measured process is insufficient. |
| Replay and synthetic attacks | Attack acceptance and bona-fide rejection by attack family: old genuine capture with wrong/new nonce, loudspeaker/second-person speech, subject handoff after Face, dubbed/mismatched video, splice/timeline discontinuity, virtual camera/microphone/file injection, TTS/voice conversion including nonce synthesis, and synchronized synthetic face/audio | Security/product owners explicitly approve residual risk, tested scope and exclusions. Challenge unpredictability must not be represented as synthetic detection. |
| Whole ceremony | End-to-end accepted genuine / accepted attack / rejected / inconclusive counts, participant-level independence, completion rate, retries, latency, source selection after success, and denied ordinary build/preview before complete evidence; exact provider/config/receipt revisions | Release owner signs the immutable profile only after engineering and identity-security evidence are reviewed. |
| Authority and disposal | Real PostgreSQL EXPLAIN for changed statements; disposable exact-dev state tests; concurrent settlement/revoke/expiry/source-deletion interleavings; restart/retry/replay controls; deletion receipts for abandoned and terminal captures/provider sessions, including outstanding upload writer fences | Engineering review plus release gates and owner-lane erasure coverage. Mocks only prove exercised control flow. |

Before collecting acceptance data, freeze one manifest containing corpus consent/retention, supported population/language/device/attack cells, speaker-separated development and held-out splits, exact model/image/decoder/provider revisions, thresholds, target maximum errors, confidence level, exclusion criteria, and retry accounting. Report both attempt and participant denominators, dates, n, method and uncertainty for every number. Select thresholds on development only; no tuning on the held-out acceptance set. Hard negatives must exercise the actual deployed decision path.

No defensible biometric error target or representative sample size is established by the repository. These must be explicitly approved, not borrowed from the old `0.02` synthetic score. For a preregistered independent binomial zero-error experiment, a one-sided 95% upper bound is `1 - 0.05^(1/n)`; targeting upper error `p` requires `n >= ceil(log(0.05)/log(1-p))`. This is a planning formula, not a performance claim. Repeated clips from one subject do not automatically supply independent trials; subgroup estimates and many tested attack cells need an appropriate sampling/confidence plan. Do not pool easy cells to hide an unevaluated attack.

## Bounded work that can start now

1. Implement additive pure schemas, receipt validation and reducer with every incomplete case refusing identity. Add explicit required-capability readiness reporting; missing capture-owner authority remains a platform blocker. Keep every enable/approval flag false.
2. Implement the new authenticated broker route and adapter, issued-locale/nonce authority, exact stored-byte/decoder/ASR composition, and signed typed response validation using actual-function fixtures. If audio derivation reuses `identity_audio_v1`, its issued-contract authority must be explicitly supported by a new version rather than fabricating a genome contract. No model fixture becomes an ownership verdict.
3. Add issue/source/consent/lease/settlement schema and lifecycle support after migration inventory review; mirror schema and erasure reach. Execute exact-dev SQL and concurrency tests. Route only new challenge versions to the new policy. Existing old rows never receive inferred locale, new receipt authority or fabricated history.
4. Add UI capture bounds and honest unavailable/inconclusive states only alongside reachable backend support. Run real local browser/codec tests, then the required frozen release/context gates. Do not invite a user into an unfinishable ceremony.
5. Separately establish the missing later-capture producer, independent document review, actual Face access, immutable deployment, scheduled caller delivery, and the approved real acceptance campaign. These are release prerequisites, not implementation details that can be covered by a stub.

The smallest first patch is the pure new contract/reducer and refusal controls. It makes the missing authority concrete and testable. It does not claim fresh enrollment is operational. A deployable skeleton endpoint without measured ownership remains nonservable.

## Measurement and rejected shortcuts for the parent log

Measurement: one bounded local source/design audit on 2026-09-07 at the supplied frozen checkpoint; inspected actual adapter, broker route/freshness handling, issue/lease/verdict, speech-only module and browser capture. No runtime or accuracy n exists. The requested graph lookup initially used a nonexistent guessed node; the correct `prefer-existing-independent-enrollment-bootstrap-20260907` node was then read. No context files were edited during the frozen release.

Rejected: filling `synthetic_risk_score=0` or `speaker_continuity_score=1`; treating audio embeddings as anti-spoof outputs; redirecting the old adapter to Face result; omitting broker freshness; treating same challenge/device as same audiovisual person; assuming Face deletion certifies later audio; copying a genome-dependent issued contract into fresh enrollment; replacing 0.9 phrase similarity by 0.60 word F1 without a version; silently cropping 60-second video; describing human review as present without an actual decision consumer; and accepting person identity as unlimited voice-source ownership. Each would create evidence the current pipeline has not produced.
