# The 100X roadmap — synthesis of the three research sweeps (2026-08-26)

Sources: `research/competitors.md`, `research/relationalos-100x.md`,
`research/voice-stack.md` — each carries its own citations and its own
unverified-claim flags. This file is the judgment layer: what we build, in
what order, and why. Where a research claim conflicted, the resolution is
stated here, not papered over.

## What the market just told us (and how it maps to what we have)

1. **Durable per-listener memory is the open wound.** Replika and
   Character.AI both publicly broke user memory in April 2026 (migration
   wipe; persona regression with ~21% fact retention by turn 40). Delphi —
   the closest competitor — is conversation-scoped, not per-listener. Our
   memory graph with citation-enforced consolidation IS the differentiator;
   the roadmap hardens and *proves* it rather than adding features first.
2. **Voice is commoditized; fidelity-as-a-guarantee is not.** ElevenLabs/
   Tavus/HeyGen are "swappable plugins" by their own framing. Nobody ships
   a measured, continuously re-evaluated "still sounds like them / still
   acts like them" property. We do (WS-J + the calibration machinery).
3. **The teacher-clone seat is empty** — globally and in India (Khanmigo/
   Praktika are fictional personas; PhysicsWallah is building a generic
   tutor, explicitly not a clone).
4. **Consent/provenance UX is becoming law** (NO FAKES Act, EU AI Act,
   China watermarking). We built it before it was required; it goes on the
   label, not just in the code.

## Voice: the standing decision

- **Chatterbox Multilingual V3 stays primary** — nothing beat it on
  license (MIT) + Hindi + fine-tunability. Re-check the field in 3–6
  months; do not churn providers on vibes.
- **Per-expert LoRA fine-tuning** is the "better than instant cloning"
  path: ~30 min clean audio for production grade, 5–10 min as smoke test.
  No paper quantifies the zero-shot→fine-tuned delta for Chatterbox; we
  measure it ourselves — it is the first experiment on the GPU when one
  exists.
- **Stay a cascade for realtime.** Moshi is the only true full-duplex
  option (~200 ms practical) but is unverified on Hindi AND on accepting a
  cloned voice in its realtime loop; both unknowns must fall before any
  migration. Sesame CSM is turn-aware TTS usable inside the cascade, not a
  replacement.
- **ASR:** AI4Bharat IndicConformer (MIT, 22 languages) is the self-hosted
  base candidate; a concrete Interspeech 2025 code-mixing fine-tune recipe
  exists. FIRST, measure the three `en-IN` STT lanes already in production
  that `measurements.md` says were never measured — cheapest signal in the
  whole voice program.
- **Fidelity scoring law** (binds WS-J's merge): the WavLM/ECAPA similarity
  score is a REGRESSION MONITOR and floor — a drop blocks — but activation
  quality is gated by the blind owner-calibration pass, because our own
  `azure-tts` rejection is the strongest evidence anywhere that measured
  axes diverge from ear judgment. Two gates, different jobs, neither
  substitutes for the other.
- **Bench before believing:** public open-vs-ElevenLabs MOS claims
  conflict (4.7-vs-4.8 in one source; 2.1–2.4-vs-3.1–3.3 in a rigorous
  one). The in-house Hinglish bench protocol in `research/voice-stack.md`
  (accent authenticity as its own axis) is the only number we repeat.
- **GPU economics:** serverless (RunPod A100 ~$1.59/hr on-demand class)
  beats reserved below ~50–60% utilization; the one number that gates a
  real budget — GPU-seconds per call — does not exist publicly and comes
  from our own load test.

## RelationalOS 100X — build order

Ranked by (evidence strength × leverage ÷ cost). 1–3 are offline-buildable
now and are **wave 5**; 4–5 follow; the rest wait for measurements.

1. **Disclosure-reciprocity ledger** — measured longitudinal evidence that
   users stop opening up when the agent doesn't reciprocate; we track the
   user deeply and the clone's own disclosure not at all. New engine
   module + T-slot note + eval.
2. **Within-session drift probe suite** — drift worsens with session
   length (externally measured, and it independently corroborates our
   position-is-mechanism finding); our evals test turns, not decay. A
   long-session harness that scores register/persona anchors across 40+
   turns, wired as a gate.
3. **Memory recall benchmark (LoCoMo-style, ours)** — the graph's recall
   accuracy is unmeasured, which contradicts the house ethos. Fixture
   dyads + question sets over the REAL recall path, scored, tracked in
   measurements.md.
4. **Bi-temporal fact edges** (valid-from/valid-to, Graphiti's idea) —
   contradiction resolution becomes a query, not an LLM call. Migration +
   consolidation change; touches the citation chain, so it lands alone.
   **SHIPPED (WS-O, 2026-08-26)** — migration 056, `src/engine/validity.ts`
   over timeline.ts's existing date table, `staleNote` and contradiction
   resolution both queries over validity, absent-is-byte-identical with no
   backfill. Closes `stale-note-keys-on-row-age`. See
   `context/decisions.md#bitemporal-fact-edges`.
5. **Example-dialogue format experiment** — community consensus says
   example dialogues are the strongest persona lever; our `recited-prompt`
   rejection says quotable sentences get recited. Likely reconciled by
   format (micro-scene vs quotable line). One cheap A/B, then law.
   **HALF-DONE, DELIBERATELY (WS-O, 2026-08-26)** — the structural arm is
   built and measured (`evals/run.mjs exdialog`; quotable 6 emittable spans /
   0.405 liftable vs micro-scene 0 / 0.000 at matched length), and it measures
   a SURFACE rather than a recitation rate. **No law is written and the item
   stays open.** The decisive arm needs generation and a judge and sits behind
   a provider seam reporting `judged: false`. See
   `context/decisions.md#exdialog-surface-only`.

### 6 — added by WS-O, out of the audit rather than the sweep

**Continuity across surfaces.** Not on the original list because the research
sweep looked outward and this one is ours. `api/_surface.js` states the law
("memory is never keyed by surface") and retrieval violated it: **89.2% of
recall was lost when a person moved from one surface to another**, measured on
identical rows with `device_id` as the only variable. Closed for the READ path
by an additive, consent-atomic leg (13.5% residual, named). The FORGET path
followed on 2026-08-26 (`forget-follows-the-person`): the widened DELETEs were
EXPLAINed and then run against the live database, which caught five TEXT-keyed
device columns the uuid cast would have broken. Both halves of §4 now hold.

Later, evidence-gated: hallucination-taxonomy split in the honesty gates,
sycophancy audit, procedural "what worked with this student" memory,
numeric drift score with auto-repair (weakest sourcing — last).

## Sequencing note

Wave 4 (in flight): channel ingestion + stays-current loop (WS-I),
in-house-primary voice + fidelity gate (WS-J). Wave 5 (next): items 1–3
above. Deployment track runs in parallel and is owner-gated: Vercel env
batches, migrations 015+, GPU box, Sarvam key, key rotation — see
`DEPLOY.md`/`ENV-MANIFEST.md` and the owner list in the session log.
