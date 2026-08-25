# Exact-version turn fidelity feedback

Status: implemented control-plane and Studio slice on `voice-cloning`,
2026-08-24. Migration 029 is not deployed. No feedback has trained or modified
a production replica.

## Why this is not a thumbs-up button

A whole-reply score cannot explain whether a miss came from acoustic identity,
delivery, wording, behavior, memory or relationship fit. The owner can grade
only the layers they actually noticed:

- overall fit;
- wording and turn shape;
- behavioral response;
- relationship-specific fit;
- memory and uncertainty handling;
- delivery plan;
- voice identity, only after protected audio was generated and heard.

Each append-only revision binds the exact dialogue turn, response hash, runtime
capability, approved Person Model version and calibration version. Voice
identity ratings additionally bind the exact sealed generation. An unplayed or
unsealed voice cannot receive a voice rating.

Controlled reason codes make aggregate analysis possible without converting
private conversation text into analytics columns. Unknown dimensions, ratings
and reasons fail closed. The Studio hides irrelevant reason choices and permits
an owner to leave any unobserved layer unrated.

## Owner-authored correction exemplar

When a text-bearing layer is close, off or unsafe, the owner may provide the
reply they would actually use. That text is not concatenated into a prompt and
does not mutate the active replica. It becomes a candidate preference pair:

```text
exact rejected response + exact version binding
  versus
owner-authored preferred response
  -> private judged eval / future adapter-training candidate
```

The database never receives correction plaintext as a parameter. The server
creates a random 256-bit data-encryption key for each exemplar, encrypts with
AES-256-GCM under evidence-bound AAD, and wraps that data key with the configured
KEK using a second independent AES-256-GCM nonce and tag. Only ciphertext,
wrapped key material and hashes are persisted. Altering the feedback, replica,
turn or content hash breaks authentication.

Server-only configuration:

```text
REPLICA_FEEDBACK_KEK_ID=<managed key version identifier>
REPLICA_FEEDBACK_KEK_B64=<exactly 32 random bytes, base64>
```

The environment-key adapter is the deployable first seam, not the final vault.
Production requires a managed Azure Key Vault or HSM-backed wrapper, access
logging, dual-control recovery, a rewrap-only rotation job, restore drills and
proof that replica erasure removes ciphertext and wrapped DEKs. Old key
material must not be dropped until every live row has been rewrapped and
verified.

## Learning boundary

`loadOwnedFeedbackLearningExample` reconstructs a preference pair only on an
internal owner-bound read and rechecks the correction hash after authenticated
decryption. It is not exposed by the public route. A future dataset builder
must additionally:

1. select only the latest unsuperseded feedback revision;
2. split train/eval by scenario and conversation, never by individual turn;
3. keep exact Person Model, calibration and generation version strata;
4. exclude unsafe, contradictory, erased and policy-ineligible examples;
5. require an offline candidate to beat the frozen baseline without increasing
   privacy leakage, false memories, policy violations or other-layer regressions;
6. create a new reviewable calibration/adapter version rather than editing the
   active one.

The active runtime never learns silently from a single correction. Promotion
remains explicit, versioned, reversible and qualification-gated.

Migration 030 and the [feedback dataset compiler](FEEDBACK-DATASET.md) turn
latest revisions into content-free, whole-conversation split manifests. A
structurally ready manifest is still only a draft; semantic deduplication,
poisoning review, deletion reconciliation and layer-specific qualification are
separate required gates.

Offline gate:

```bash
node evals/run.mjs replicafeedback
```
