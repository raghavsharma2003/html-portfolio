# Replica Platform — architecture and first build

Status: accepted build direction for the `voice-cloning` branch, 2026-08-24.
Research record: `docs/research/REPLICA-FRONTIER-2026.md`.

## 0. Product claim

A verified adult can create a private AI replica of themself from a live voice
challenge plus noisy multimodal evidence, then calibrate how it sounds, speaks,
remembers, behaves, and relates. The replica stays recognisable when its voice,
brain, avatar, or transport provider changes.

The first product is deliberately **self-replication**, not "clone anyone." A
technically excellent impersonation product without structural consent,
disclosure, provenance, revocation and deletion is a failed product.

North star:

```text
whole-replica fidelity
  = voice identity
  × delivery identity
  × behavioural fidelity
  × autobiographical fidelity
  × relational fidelity
  × consent/provenance integrity
```

This is multiplicative on purpose. A zero on consent or provenance is not made
acceptable by a beautiful voice. A perfect voice with the wrong memories is
not the person. A correct biography with generic behaviour is an archive, not
a replica.

## 1. Laws

### R1 — a replica is layers, never one prompt

Acoustic identity, delivery, linguistic behaviour, biography, values,
relationships, and multimodal identity are separate versioned records with
separate evaluators. The prompt compiler receives bounded rendered views; it
does not become their system of record.

The first concrete identity record is the evidence-backed Person Model. Its
deterministic builder consumes only accepted, currently valid, cited claims;
retains uncertainty; and binds an approved profile to the exact source-set
commitment. See `docs/PERSON-MODEL.md`.

### R2 — evidence and inference are different types

Raw sources are immutable and encrypted. Derived segments cite the raw source
and transform. Claims cite segments. Inferred traits can be proposed but never
silently promoted to approved biography or belief. Uncertainty survives every
transform and appears in the runtime when relevant.

### R3 — the base person and the relationship are different

The replica's identity is global to the replica. Shared history, trust,
rupture/repair, register, phrases, rituals, disclosure and rapport live at
`(agent × person)`, exactly as RelationalOS already requires. A replica does
not speak identically to everyone, and one relationship cannot read another.

### R4 — models and providers are replaceable

The durable voice record is a VoiceGenome plus accepted private references,
not a Fish/ElevenLabs/Cartesia voice id. Provider ids are disposable adapters.
The durable personality is structured data plus evaluations, not a model's
hidden weights alone.

### R5 — consent is a capability, not a checkbox

Capture, transcription, biometric derivation, training, inference, storage,
sharing, API use, telephony and model improvement are separate scopes. Every
operation proves its required active scopes server-side. Withdrawal makes the
capability unreachable before asynchronous deletion begins.

### R6 — every output declares itself

Every audio output begins with a non-disableable synthetic disclosure on the
initial India launch path, carries a robust watermark and signed provenance,
and creates a content-free audit record. Realtime protected PCM is committed
as a signed segment hash chain before each segment is released, then sealed by
a final C2PA asset credential. Provider output without these is not deliverable
output. See `docs/REPLICA-PROVENANCE.md`.

### R7 — noisy input is never cleaned into false certainty

Enhancement produces candidates beside the raw source. It never overwrites the
raw source. Target-speaker selection, diarization, transcription and inferred
memories retain confidence and are reviewable. When identity cannot be
recovered, the system asks for better evidence instead of inventing it.

### R8 — calibration produces preferences, not prompt accretion

"That did not sound/feel like me" becomes a versioned preference pair tied to
the layer it evaluates: voice, delivery, language, behaviour, memory or
relationship. Fine-tuning/adapters may consume the corpus later; the immediate
system can rerank candidates. The system prompt does not grow one correction at
a time.

The first implementation uses server-owned safe contrast pairs, append-only
owner revisions and a deterministic calibration policy bound to the exact
Person Model version. Only registered strategy ids compile at runtime. See
`docs/CALIBRATION.md`.

### R9 — activation freezes a capability, never a moving `latest`

An active runtime binds one owner, self subject, agent, Person Model version,
calibration-policy version, VoiceGenome version, disposable provider voice and exact seven-suite
qualification commitment. New drafts or retrains cannot alter a live session.
They earn a new capability and explicitly supersede the old one. The browser
supplies only an opaque replica id and bearer token; agent ids, person ids,
provider ids and profile definitions remain server-side.

### R10 — extraction proposes; only the owner disposes

Model-assisted memory and behaviour extraction receives the smallest redacted
evidence view that can support its task. Every output must cite an exact
immutable evidence span, pass independent server validation and enter as a
proposal. A model cannot create self-declared provenance, accept its own claim
or silently change an approved Person Model. The first audio-transcript lane is
specified in `docs/CLAIM-EXTRACTION.md`.

## 2. Domain model

```text
auth user
  └─ owns replica
       ├─ consent receipts (scoped, versioned, revocable)
       ├─ source artifacts (private immutable originals)
       │    └─ derived segments/transcripts/features
       │         └─ cited claims
       ├─ VoiceGenome + provider voice profiles
       ├─ versioned person profile
       ├─ preference/calibration corpus
       ├─ evaluation runs
       └─ vy_agent activation
             └─ RelationalOS state per interacting person
```

`vy_agent` remains the runtime tenant. `vy_replica` is the ownership,
enrollment, training, lifecycle and deletion object that can create one agent
only after its gates pass. Meera remains a static, code-authored agent and is
unchanged.

### Source and claim states

Source artifacts move through:

```text
pending_upload -> uploaded -> quarantined -> processing -> ready
                                      \-> rejected
ready -> deleting -> deleted
```

Claims move through:

```text
proposed -> approved -> superseded
         \-> rejected
```

Self-declared facts from the verified subject may be approved under a declared
policy. Model-inferred beliefs, relationships, health facts, sensitive traits
and facts about third parties require review and can remain quarantined. Every
active claim has at least one source citation.

### Replica lifecycle

```text
draft -> consent_pending -> enrolling -> calibrating -> ready -> active
   \                                                 -> paused
    -------------------------------------------------> revoked -> purging
```

There is no recoverable `deleted` content state. A content-free deletion
receipt may remain separately where law/security requires it, but it cannot be
used to reconstruct voice, identity, memories or relationships.

## 3. Voice architecture

### VoiceGenome

The provider-neutral voice record contains:

- accepted source/segment ids and their transform lineage;
- multiple speaker-embedding families and their distributions;
- language, accent and code-switch coverage;
- pitch, energy, speaking-rate, rhythm, pause and phrase-boundary distributions;
- paralinguistic event distribution: laughter, breath, fillers, hesitation,
  whisper, effort and repair;
- scenario-conditioned delivery styles with confidence and sample counts;
- quality/noise ranges and excluded segments;
- human ABX/SMOS calibration results;
- version and source-set hash.

No provider id appears in the VoiceGenome. `vy_replica_voice_profile` maps one
VoiceGenome version to a disposable provider/model reference.

### Provider contract

Server adapters implement:

```ts
createVoice(enrollment): provider reference
deleteVoice(provider reference): deletion receipt
synthesizeStream(plan): PCM s16le, 24 kHz, mono stream + provenance facts
```

`plan` contains a replica id, VoiceGenome version, text, delivery plan,
language, deadline and trace id. It never contains a client-supplied provider
id or secret. The registry chooses an adapter by measured capability and
policy. Provider output is not exposed until disclosure, watermark and signed
provenance are applied.

### Call-lane boundary

The current Gemini Live lane generates its own native audio and cannot speak an
external clone. It remains untouched during the first build. Replica preview
and initial calls are cascade-only through the existing streaming speaker,
barge-in, abort, audio analyser and device fallback machinery. A second audio
player or a modification to `liveCall.ts` would move the measured audio floor
before the clone itself has a baseline and is rejected.

Later options are measured, not assumed:

1. STT -> brain -> cloned streaming TTS on the existing cascade floor;
2. a realtime provider that natively carries the enrolled voice;
3. speech-to-speech content generation followed by safe voice conversion;
4. an owned duplex audio model after the dataset and eval justify it.

## 4. Multimodal ingestion

Accepted source classes are live audio, uploaded audio/video, text, chat
exports, documents and images. Each uploader declares rights and whether the
source contains other people. Third-party private communications and voices are
quarantined for separate authorization/redaction rather than becoming training
data by default.

The pipeline is asynchronous and resumable:

```text
private signed upload
 -> malware/type/size quarantine
 -> immutable hash + metadata verification
 -> modality-specific extraction
 -> diarization/OCR/ASR/alignment/entity-time resolution
 -> candidate claims + uncertainty
 -> owner review
 -> approved profile and RelationalOS writers
```

Object storage paths are chosen server-side:

```text
<owner_user_id>/<replica_id>/<source_id>/original
<owner_user_id>/<replica_id>/<source_id>/derived/<transform-version>/<part>
```

The bucket is private. The database stores bucket and object path, never a
durable URL. Reads and writes use short-lived signed capabilities after server-
side ownership checks. Vercel JSON/base64 upload is not a biometric storage
path.

## 5. Runtime integration with RelationalOS

The existing `AgentModule` is code and synchronous, while user replicas are
private data loaded after authentication. The integration therefore has two
stages:

1. A server-side data compiler turns an approved profile version into the same
   bounded `AgentModule` capabilities: identity shapes, behaviour constraints,
   speech style, register and safety constants. Safety constants remain owned
   by the OS, not by the replica.
2. The existing context compiler receives that runtime module plus the same
   relational/self bundles. Every lane keeps one assembly path and the current
   prompt budget/drop-order laws.

User memories imported while building the replica describe the replica's own
past and belong to its global person profile. Memories created while somebody
interacts with the activated replica belong to that `(agent × person)`
relationship. The two stores may cite each other but do not collapse.

### Authenticated replica binding to the isolated substrate

Migration 018 adds and backfills `agent_id` on `meera_log`, `meera_nodes`,
`meera_edges` and `meera_forget`. Meera's public memory path now writes it
explicitly and filters it before ranking; consolidation, texture, episode-span
and sweep reads carry the same binding. The consolidation watermark and lease
are keyed by `(agent_id, person_id)`. `evals/agent/raw-isolation.mjs` guards the
canonical schema and these call sites offline, with cross-agent negatives.

Migration 023 adds the server-authenticated `replica_id -> capability ->
agent_id/person_id` binding; request-body agent ids are never authority.
Migration 027 adds version-bound private sessions and dialogue turns whose raw
content lives once in the agent-scoped log. Every completion and subsequent
speech authorization rechecks lifecycle, inference consent and the exact
frozen profile/calibration capability. This is implemented and tested offline,
not deployed or fidelity-qualified.

Relationship forget still needs its own `(agent, person)` cascade. The existing
full-person erase is intentionally all-agent and also removes person-global
synchronized state, telemetry and room participation, so reusing it for one
replica would be both over-broad and stale for other agents' rebuilt snapshots.

Before a replica can be released, the binding, dialogue and
relationship-forget paths must pass a live isolation battery proving:

- replica A cannot retrieve replica B's logs, nodes, edges or suppressions;
- one agent's consolidation watermark cannot hide another agent's work;
- forgetting a relationship removes only that `(agent, person)` state;
- deleting the creator's conversant record does not delete their owned
  `vy_replica`, while revoking the replica follows its separate erasure path.

Until that passes, the code may exercise an offline private dialogue fixture,
but production activation remains closed.

## 6. Calibration Studio

The Studio is a separate Vite entry at `/studio`, not another mode inside the
monolithic Meera `App.tsx`. Its first loop is:

1. sign in and verify adult self-enrollment;
2. grant granular consent;
3. record a randomized live challenge;
4. upload optional noisy evidence;
5. see processing/provenance state;
6. hear blinded voice candidates saying held-out text;
7. label voice identity and delivery separately;
8. add text/memory sources and approve/reject extracted claims;
9. run behavioural scenario pairs and choose which is more like them;
10. activate only after voice, identity, safety and deletion drills pass.

The Studio never exposes a provider model id, raw embedding, training weight,
or permanent source URL.

## 7. Evaluation gates

### Enrollment

- self-only, adult and liveness gates cannot be bypassed by request fields;
- replayed/deepfake/public-figure/duplicate samples exercise a closed failure
  vocabulary and manual-review path;
- no training or synthesis without required active consent scopes;
- source ownership is enforced from the authenticated user id, with IDOR
  negatives for every operation.

### Voice

- held-out text and emotion; no reference transcript leakage;
- speaker identity ensemble plus blinded human ABX/SMOS;
- Hinglish, Hindi, English and code-switch coverage;
- clean, severe-noise, re-recorded and multi-speaker inputs;
- p50/p95 time-to-first-audio, RTF, WER/CER/MER, artifacts and identity drift;
- provider/model swap has a sham arm and can be refused.

### Behaviour and relationship

- persona invariants on every replica module;
- no authored example becomes a recited phrase bank;
- scenario preference, value/boundary consistency and contradiction rate;
- memory citation/uncertainty, appropriate recall and deletion completeness;
- zero cross-agent, cross-person and cross-relationship rows retrieved;
- lane parity for every context block the replica claims.

### Provenance and abuse

- audible disclosure is the first delivered audio and cannot be disabled;
- watermark survives codec, resampling, crop, noise, speed/pitch and room
  re-recording attacks at a published operating point;
- signed provenance verifies without exposing subject identity;
- prohibited scam/OTP/payment/public-figure/election/sexual/minor content is
  blocked before synthesis;
- revocation makes inference fail immediately, then provider/object/memory
  deletion produces receipts and passes a full store manifest walk.

## 8. Delivered foundation slices

This branch contains the pieces whose absence would make every later demo
unsafe or disposable:

1. Migration 015: replica, consent, private-source manifest, claim,
   VoiceGenome/provider-profile, profile/evaluation, audit and erasure records.
2. A pure replica domain module encoding lifecycle, consent capabilities,
   source/claim provenance and activation readiness.
3. An offline suite wired into `evals/run.mjs`, including negative controls.
4. Shared authenticated ownership plus owner-only create/list/read/revoke API;
   no endpoint trusts a request-supplied owner id or device uuid.
5. A provider-neutral voice contract and fake provider that prove create,
   status, disclosed PCM streaming, cancellation and idempotent deletion.
6. Research and architecture logged before a real provider is selected.
7. A separate `/studio` entry with authenticated consent, private source
   upload, local microphone/video challenge capture, review and revocation.
8. Immutable noisy-audio processing contracts for integrity, malware scan,
   media probe, diarization, target separation, multiple enhancement
   candidates, ASR, multi-family voice analysis and draft-only VoiceGenome
   construction. The included provider is a deterministic fake.
9. Migration 018 and offline negatives that isolate raw RelationalOS logs,
   graph rows, suppression tombstones and consolidation cursors by agent.
10. Immutable runtime capabilities and protected streamed PCM delivery bound to
    exact profile, calibration, VoiceGenome, provider and qualification
    versions.
11. Append-only Person Model review, deterministic typed profiles and
    owner-calibrated behavioural preference policies.
12. Owner-only cited claim extraction from accepted target-speaker transcripts,
    with direct-identifier redaction, strict Azure Foundry structured output,
    exact citation verification and no automatic approval.
13. Version-bound private dialogue that consumes the typed Person Model,
    calibration and isolated relationship state, writes erasable raw turns and
    binds protected speech to the exact server-generated reply.
14. A content-free, atomic Azure Foundry spend governor that reserves a
    conservative maximum before provider I/O, settles measured usage, prevents
    duplicate allocation and quarantines ambiguous outcomes for reconciliation.
15. Exact-version turn feedback that separates wording, behavior,
    relationship, memory, delivery and heard voice; owner correction exemplars
    use per-row envelope encryption and remain reviewable training/eval evidence
    instead of silently mutating the active runtime.
16. A content-free dataset compiler with immutable whole-session split
    assignments, latest-revision mutation rechecks, unsafe-session holdout and
    minimum cross-layer depth gates; output remains draft-only.
17. A blind paired candidate-qualification gate with statistically supported
    target improvement, cross-layer noninferiority, critical-safety and
    false-memory ceilings, exact artifact lineage and no automatic activation.
18. A replay-safe owner blind-evaluation lab for dialogue and prompt candidates
    with balanced committed A/B order, per-asset envelope encryption, neutral
    browser payloads, exact-layer atomic judgments and internal-only unblinding.

These slices do not touch `liveCall.ts`. Azure Speech and Foundry adapters have
only mocked protocol coverage; real voice models, independent liveness
verification, sealed blind voice evaluation and live behavioural dialogue
qualification remain gated. Paid
Speech, voice, liveness, watermark and GPU paths also remain disabled until
they have native-unit meters under the same application ceiling.

## 9. Deliberately not active yet

- training a speech foundation model;
- arbitrary third-party/public-figure/deceased/minor cloning;
- public voice discovery or downloadable weights;
- outbound phone calls;
- visual avatar generation;
- provider-specific ids in the client or durable person model;
- end-to-end live speech changes;
- automatic approval of inferred memories or personality traits.

## 10. Reversal conditions

- Self-only launch widens only after a jurisdiction-specific rights,
  authorization and takedown system passes red team and counsel review.
- Cascade-only replica voice widens only when another lane meets the existing
  audio-floor, interruption, continuity, honesty and voice-identity gates.
- Provider routing narrows to one provider only if it wins all required
  languages/styles and has equivalent commercial, privacy, deletion and
  provenance guarantees; price or MOS alone cannot do it.
- Structured profile rendering changes only if a measured alternative improves
  behavioural fidelity without increasing recitation, contradiction, leakage
  or prompt-budget pressure.
- Raw-plus-derivatives retention changes only if an enhancement process proves
  speaker-identity preservation and reversible provenance across the owned
  severe-noise battery.
