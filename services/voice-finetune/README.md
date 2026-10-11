# voice-finetune — per-speaker LoRA adapters for the in-house voice lane

A batch GPU job. In: one consented speaker's reference audio plus its
transcript. Out: LoRA adapter weights that `services/open-voice-runtime` loads
at synthesis time, and a JSON report of what training actually did.

This is the lane that answers "how much better than zero-shot can we get on a
voice we are allowed to train on". `context/measurements.md#first-real-clone`
fixed the zero-shot floor for the owner's own voice at **0.7753** ECAPA cosine
against a **0.8869** self-vs-self ceiling. Everything here exists to move that
number and to say honestly by how much.

---

## The shape of it

```
consented WAV + transcript ──► bundle.json (blob)
                                    │
                       Container Apps Job, GPU profile
                       image = runtime image + train.py
                                    │
                        adapter-e{N}.pt  +  report.json
                                    │
      POST /v1/synthesize { …, adapter_id, adapter_sha256, adapter_base64 }
                                    │
                     admission broker (HMAC, unchanged)
                                    │
                  runtime: load LoRA → generate → verify PerTh → remove
```

**The training image derives FROM the runtime image.** Not "is built the same
way" — is the same bytes plus one small layer. That is what guarantees the
pinned Chatterbox commit, the baked checkpoints and `lora.py` cannot drift
between the thing that produces adapters and the thing that consumes them. It
also makes the build about a minute instead of the runtime image's 12m55s.

## One adapter per expert — never a sequential fine-tune

**The base checkpoint is never written.** `train.py` freezes every T3 parameter
*before* injecting LoRA, so a bug in the injection can only produce an adapter
that does nothing — it can never produce a quietly-modified base checkpoint
escaping as if it were a small adapter. Each expert gets their own adapter file,
composed onto the frozen base at load time and removed after the request.

This is a binding, not a convenience. Published evidence (`docs/gurukul/research/
mirror-learning.md`, WS-Z) is that **sequential per-speaker adaptation of a
shared multi-speaker TTS collapses it toward the newest speaker**: train A, then
train B on the result, and A degrades. Composed-at-load adapters cannot do that
to each other, because no expert's training ever sees another expert's weights.
`evals/fidelity/run.mjs` gates the freeze-and-serialize shape so this cannot
quietly become a checkpoint pipeline later.

A **regression check across speakers** — re-measure an older voice after a new
speaker's fine-tune — is what would catch it if this reasoning were ever wrong.
The harness supports it today (point `measure` at a second reference and a
second adapter), but with **one real consented speaker it has not been run**, so
nothing here is a measured claim about cross-speaker interference.

## What the adapter may touch

`lora.TARGET_SUFFIXES` — the `q_proj`/`k_proj`/`v_proj`/`o_proj` projections of
the T3 backbone, and nothing else. An adapter naming any other module is
rejected at parse time, on both sides.

Three exclusions are deliberate and load-bearing:

- **`s3gen`** is the vocoder and sits on the PerTh watermark's path. Adapting it
  is how you produce audio the runtime's own watermark verifier refuses to
  return — a self-inflicted 503 at best, a silently unwatermarked clip at worst.
- **`ve`**, the voice encoder, is architecturally the same family as the ECAPA
  encoder fidelity is scored with. Fine-tuning it would raise the fidelity
  number by fitting the grader. That is the one result that would be worth less
  than no result, because it would look like success.
- **The output heads.** The speech-token vocabulary is not speaker-specific.

## Invariants this lane does not get to relax

An adapted synthesis goes through the **same** admission broker, the **same**
request HMAC, the **same** disclosure-prefix check and the **same** PerTh
verification as a zero-shot one. `app.py` gained no branch that skips any of
them. Concretely:

- the adapter travels **inside the signed body**, so it is covered by the HMAC
  that already admits the call — no second trust path, no credential in the GPU
  container, no store to be poisoned;
- `text` must still start with the disclosure prefix, checked before an adapter
  is looked at;
- the watermark is still verified after generation and audio that fails is still
  refused;
- the adapter is applied around one `generate()` and removed in a `finally`. The
  model is shared across requests behind `gpu_lock`; a leaked adapter would
  colour the *next* caller's voice while sounding perfectly fine, which is the
  worst failure available in a replica lane.

And the receipt tells the truth about what ran: responses carry
`synthesis_commitment = sha256(model_commitment:lora:adapter_sha256)`. Reporting
the base model's commitment for an adapted network would let two different
networks sign the same receipt. Without an adapter the value collapses to the
base commitment exactly, so nothing that existed before changes.

## Running one

```
FT_BUNDLE_URL     pre-signed GET  — bundle.json
FT_ADAPTER_URLS   {"15": <PUT url>, "30": …, "60": …}
FT_REPORT_URL     pre-signed PUT  — report.json
```

Pre-signed URLs only: the job holds no long-lived credential, uses them, exits.
Multiple checkpoint destinations are the norm, not a nicety — a GPU wake costs
about 35 warm syntheses (`AZURE-DEPLOY-STATE.md` §9), so taking one point on the
curve per run pays the expensive part of the experiment repeatedly to learn
less.

`bundle.json`:

| field | meaning |
|---|---|
| `reference_wav_base64` | canonical 24 kHz mono PCM16 WAV |
| `segments` | `[{t0, t1, text}]` — ms offsets into the reference |
| `consent` | must carry `is_self` and `has_source_rights`, or the job exits |
| `rank`, `alpha`, `learning_rate`, `text_loss_weight`, `exaggeration`, `seed` | hyperparameters |

Consent is checked here as a **backstop**. The studio's consent row is the gate.
But a training job is the last place a mis-scoped recording can be stopped
before it becomes weights, and weights cannot be un-trained.

## Two upstream details worth knowing

1. **`T3.loss` is not used, on purpose.** Upstream's own training loss does not
   shift for next-token prediction, and calls `F.cross_entropy` with
   `(B, seq, vocab)` logits against `(B, seq)` targets, which does not even
   broadcast. `train.py` computes the loss directly: `speech_logits[:, :-1]`
   transposed to `(B, vocab, seq)` against `speech_tokens[:, 1:]`.
2. **Conditioning is computed once, from the whole reference, exactly as the
   runtime computes it per request.** Training under different conditioning than
   inference supplies is the classic way to get an adapter that improves the
   loss curve and nothing else.

## What this does NOT establish

The fidelity number an adapter earns is **speaker-embedding cosine similarity**,
the same automated gate `api/_fidelity.js` describes itself as. It is not the
blind ABX bench in `docs/gurukul/research/voice-stack.md`, and no adapter may be
described in terms of how it *sounds* until that bench runs.

The community recommendation for Chatterbox is **≥30 minutes** of clean
single-speaker audio (`docs/gurukul/research/voice-stack.md` §2). Any run on
substantially less than that is a smoke test and must be labelled as one
wherever its number appears.
