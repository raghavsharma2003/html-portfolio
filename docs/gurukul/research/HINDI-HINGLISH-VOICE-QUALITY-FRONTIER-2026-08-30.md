# Hindi and Hinglish voice quality frontier

Date: 2026-08-30

Status: implementation and qualification plan. The local release candidate
fixes a measured acoustic boundary defect. It is not yet a human listening
result and is not yet deployed.

## The owner report

The current clone has four related failures:

1. speech becomes choppy and robotic at Hindi and English boundaries;
2. emphasis and emotional movement are too flat;
3. words are stretched, substituted, or pronounced incorrectly;
4. switch-adjacent words fail often enough that code switching is not usable.

This report overrides any earlier implication that a speaker-embedding score
made the current voice acceptable. Speaker similarity, intelligibility,
naturalness, accent, pronunciation, switch smoothness, and expressive delivery
are separate gates.

## What was actually wrong in Vyakti

The Hindi text frontend identified Hindi and English at token level. The
provider then turned those semantic segments into separate Chatterbox calls.
Each call received a fresh request id, a derived seed, a new reference
conditioning pass, and a new prosody start. The provider joined the resulting
PCM with 60 milliseconds of digital silence.

That is not code switching. It is several independent voices placed next to
one another.

Saved owner-reference artifacts make the failure visible without a subjective
claim:

| arm | duration | near-silence frames |
|---|---:|---:|
| old token-fragmented Hinglish | 25.98 s | 65.47% |
| one-pass continuous Hinglish | 7.72 s | 24.58% |

The one-pass clip also recovered the existing ECAPA proxy from 0.433967 to
0.825082. These numbers explain the boundary damage. They do not say that the
new pronunciation, expression, or likeness is good.

The second local defect was the default delivery preset. `identity_anchor`
used exaggeration 0.2, CFG 0.78, and temperature 0.6. That preset was designed
to suppress variation while testing identity. The owner consistently heard
the result as flat and robotic. The release candidate therefore starts at
Chatterbox's neutral defaults, 0.5 exaggeration, 0.5 CFG, and 0.8 temperature.
The old anchor remains a blind calibration condition rather than the ordinary
product default.

## The immediate correction

The release candidate now enforces these invariants:

- one Hindi or Hinglish preview is one acoustic model call;
- there is no synthesized segment gap and no PCM join;
- the exact token-language audit remains in the signed text-plan receipt;
- known Roman Hindi, classroom borrowings, initialisms, and uppercase symbols
  receive deterministic Devanagari pronunciation forms;
- unknown Latin words remain visible and byte-identical in the audit;
- a future multi-call text plan fails closed before audio delivery;
- ordinary preview uses the neutral delivery preset, while stronger expression
  remains a measured owner preference rather than a hidden global change.

This removes Vyakti's self-inflicted choppiness. It does not give Chatterbox a
native mixed-language phonology that the model does not expose.

## Why arbitrary code switching remains a model problem

Chatterbox Multilingual accepts one `language_id` for a generation. A public
upstream issue describes the same failure shape: foreign words under one
language tag get the wrong phonetics, while manual segmentation creates
prosody, pause, and identity discontinuities. That matches Vyakti's measured
failure, but the issue is field evidence rather than a maintainer guarantee.
See the [official Chatterbox source](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/mtl_tts.py)
and [native code-switch issue](https://github.com/resemble-ai/chatterbox/issues/346).

Hindi-English synthesis research identifies three necessary text layers:
language identification, spelling normalization, and pronunciation modeling.
Listeners significantly prefer systems that identify and pronounce each
language correctly. See [Sitaram and Black, Speech Synthesis of Code-Mixed
Text](https://aclanthology.org/L16-1546/).

AI4Bharat's [IndicOOV benchmark](https://github.com/AI4Bharat/IndicOOV)
specifically covers abbreviations, brands, code-mixed terms, company names,
government schemes, and proper nouns. It reports that carefully curated OOV
data can improve pronunciation without degrading in-domain voice quality.
AI4Bharat's [IndicXlit](https://github.com/AI4Bharat/IndicXlit) is an 11M
parameter transliteration model trained from 26 million word pairs and supports
Roman-to-Hindi conversion. It is a candidate normalization component, not a
license to rewrite every Latin word. An English word and a Roman Hindi word can
share the same surface shape, so automatic rewrites need confidence, an audit,
and a fail-open original-text path.

## Candidate model decision

The current Chatterbox route is now a protected incumbent and transport
fallback. It is not a quality winner.

| candidate | relevant capability | measured Vyakti evidence | decision |
|---|---|---|---|
| Chatterbox Multilingual V3 | short-reference cloning, Hindi, global delivery controls | owner rejected current sound; continuous Hinglish repaired a major boundary defect | keep as incumbent control, not certified |
| VoxCPM2 | Hindi among 30 languages, controllable emotion and pace, continuation cloning, 48 kHz | three owner-bound clips succeeded on T4; ECAPA mean 0.766255; no owner listening result | matched blind challenger |
| MOSS-TTS Local v1.5 | explicit multilingual and code-switched synthesis, language tags, IPA pronunciation control, token duration control, 48 kHz | contract and access preflight only; no model load or audio yet | highest-priority code-switch qualification |
| IndicF5 | Hindi-specialist reference-conditioned TTS | bounded equation normalization improved symbols 4/4 to 2/4 and numerals 3/5 to 0/5; not a broad winner | specialist control |
| Sarvam Bulbul v3 | India-native code-mixed TTS and pronunciation dictionaries | managed model, not an owner voice clone | pronunciation anchor only |
| Fish Audio S2 | multilingual expressive tags and cloning | public weights require a separate commercial license and large GPU; no Vyakti result | vendor shadow only |

Primary candidate sources:

- [VoxCPM official repository](https://github.com/OpenBMB/VoxCPM)
- [MOSS-TTS official model card](https://github.com/OpenMOSS/MOSS-TTS/blob/main/docs/moss_tts_model_card.md)
- [Fish Speech official repository](https://github.com/fishaudio/fish-speech)
- [IndicF5 official repository](https://github.com/AI4Bharat/IndicF5)

MOSS v1.5 is the most direct answer to the reported switch problem because its
documented control surface includes native code switching and IPA. VoxCPM2 is
the lower-compute challenger because it already fits the existing T4 and can
separate timbre from style instructions. Neither can be promoted from a model
card.

## Frontier architecture

### 1. Pronunciation planner

Every utterance produces an immutable plan containing:

- exact input and output hashes;
- token spans in UTF-16 coordinates;
- observed script and bounded language hypotheses;
- transformations with source, replacement, reason, and version;
- unresolved words that remained untouched;
- pronunciation-dictionary and model commitments;
- a one-utterance acoustic strategy.

The planner has four ordered authorities:

1. owner-approved per-clone pronunciation;
2. reviewed product and domain dictionary;
3. confidence-bounded IndicXlit or phoneme candidate;
4. original text unchanged.

The first three are reversible and auditable. An uncertain model output never
silently replaces the original word.

### 2. Switch-local evaluation

Whole-utterance WER can hide the exact defect the owner reported. The scorer
must separately measure:

- every token within two tokens of a language switch;
- abbreviations and single-letter symbols;
- English technical borrowings in Hindi syntax;
- Roman Hindi spelling variants;
- proper names and Indian place names;
- numbers, units, equations, and chemical notation;
- repeated, omitted, inserted, or abnormally prolonged words.

The primary content metric is switch-adjacent word error rate. Raw WER,
script-aware WER, and character error rate remain secondary views. At least two
different ASR families must agree before best-of-N selection is considered,
because an ASR can favor a TTS system with similar training or tokenization.

### 3. Prosody and expression plan

Emotion is not a single global slider. The synthesis plan carries bounded
observable delivery intentions:

- statement, question, correction, encouragement, surprise, or emphasis;
- phrase boundaries and explicit pauses;
- local emphasis spans;
- pace range;
- energy and pitch movement targets;
- reference role: neutral, explanatory, energetic, or empathetic.

These are speech-delivery controls, not claims about a person's inner emotion.
The clone never converts an observed moment into a permanent personality trait
without owner review.

### 4. Reference bank

One clean ten-second reference can preserve timbre, but it cannot represent
every delivery mode. The production target is a small owner-verified bank:

- neutral conversational;
- explanatory classroom;
- energetic emphasis;
- calm correction or empathy.

Each role uses a bounded clean window with exact speaker verification,
transcript alignment, consent, source provenance, bandwidth, clipping, SNR,
and duration checks. The model receives one selected role for an utterance,
not a concatenation of references. More audio is useful only when it adds a
new verified role or improves a selected window.

### 5. Model routing

Routing is by measured capability, not by brand:

- English uses the winning owner-identity arm;
- Hindi uses the winning native-Hindi arm;
- Hinglish requires a single-utterance code-switch winner;
- equations and named technical domains may use a specialist pronunciation
  plan, but not a different speaker;
- no route is changed while an owner is mid-call;
- every response records model, text plan, pronunciation plan, reference role,
  seed, protection, and output commitments.

### 6. Owner correction loop

After playback the smallest useful correction is: select the wrong word, hear
two or three pronunciation candidates, and accept one. That acceptance creates
a private, source-cited pronunciation rule for this replica. It does not
fine-tune on the hot path. It is immediately reversible and it expires from
active use if the source or consent is removed.

Delivery feedback stays equally concrete: too flat, too dramatic, too fast,
wrong emphasis, wrong pause, or voice no longer sounds like me. It updates a
versioned delivery policy only after matched blind evidence.

## Release qualification

The frozen corpus contains Hindi, Roman Hinglish, mixed script, dense switches,
technical borrowings, equations, names, abbreviations, corrections,
encouragement, questions, and long explanatory arcs. Run every eligible model
with the same owner reference, prompt, seed schedule, disclosure, and output
protection.

Proposed minimum evidence before model promotion:

1. 24 frozen prompts, 3 seeds, and no provider retries hidden as samples;
2. zero artificial joins and zero unplanned language resets;
3. switch-adjacent word error at most 5% on the reviewed corpus;
4. no repeated or prolonged-word failure in the held-out corpus;
5. speaker similarity non-inferior to the incumbent within 0.02 mean ECAPA;
6. at least 20 fluent Hindi/Hinglish listeners and 800 valid judgments;
7. at least 90% catch accuracy per accepted listener;
8. blinded wins on pronunciation, switch smoothness, naturalness, owner
   likeness, Indian accent, and teaching delivery;
9. p95 warm latency and cold return guidance measured on the deployment shape;
10. exact license, consent, erasure, disclosure, watermark, cost, and rollback
    evidence.

The numeric thresholds above are proposed release rails. They are not achieved
results.

## Build order

1. Ship the one-utterance and neutral-default correction after full release
   gates and an authenticated production canary.
2. Run the 12-cell Chatterbox style pack on the exact owner reference. Do not
   promote `warm_expressive` from parameter intuition.
3. Add an owner pronunciation dictionary and a shadow IndicXlit candidate with
   confidence and negative controls.
4. Qualify MOSS v1.5 on private GPU infrastructure using the frozen corpus and
   exact owner reference.
5. Re-run VoxCPM2 with exact matched prompts, including style instructions and
   ultimate-cloning mode where an exact reference transcript exists.
6. Build the blinded owner pack. Listening, not ECAPA, chooses the quality
   winner.
7. Route only the winning language lane. Preserve immediate rollback to the
   protected incumbent.
8. Add word-level correction and reference-role capture to the Studio after
   the underlying model wins, so the interface improves a good engine rather
   than hiding a bad one.

## What is not claimed

- The local structural tests do not prove that a word sounds correct.
- ECAPA does not measure pronunciation, naturalness, or emotional delivery.
- A model card does not prove Hindi accent or this owner's likeness.
- Transliteration is not pronunciation unless listeners and ASR confirm it.
- More source duration is not automatically better reference conditioning.
- A crossfade cannot recover co-articulation or prosody lost by independent
  model calls.
- The current production site does not contain this release candidate until a
  deployment is explicitly authorized and read back.

