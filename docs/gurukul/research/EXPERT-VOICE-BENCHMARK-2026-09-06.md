# Expert voice: a measured comparison before promotion

Research checked 2026-09-06. No cloud/model calls, new audio, human listening,
owner-quality verdict or deployment occurred in this work.

## What to retain

Retain the protected Chatterbox synthesis lane, private source processing,
24 kHz reference checks, source commitments, owner approval, exact-text matched
packs and blinded listening harness. The current runtime returns complete
signed synthesis results under a GPU lock; it is not streaming TTS. Call
latency must therefore include the whole ASR, reply, synthesis and playback
path. The latest recorded provider configuration is not a live readback today.

The ordinary preview currently uses neutral Chatterbox defaults; the previous
identity anchor is a reversible calibration alternative. A speaker-embedding
score cannot settle the owner's reported robotic delivery or wrong switches.

## Candidate arms and current published prices

| Candidate | Official evidence | Cost boundary |
|---|---|---|
| Existing Chatterbox | Open multilingual cloning; reference-language conditioning affects accent and pacing | Measure GPU execution, warm idle allocation, cold starts and retries. There is no justified universal per-minute rate. |
| Cartesia Sonic 3.6 | Hindi and expanded Roman Hindi/Hinglish; snapshot `sonic-3.6-2026-08-27` permits repeatable comparison | Pro lists $5/month, 100K shared credits, approximately 133 TTS minutes and instant cloning. Startup lists $49/month and professional cloning. Allowances, concurrency and actual usage determine effective cost. |
| ElevenLabs Flash/Turbo and v3 Conversational | Fast synthesis models, with different latency/expression tradeoffs | Both list $0.05 per 1K characters. At an assumed 900 characters per generated minute, synthesis alone is $0.045/minute; input transcription, brain, retries and platform costs are additional. |

Sources: [Chatterbox official repository](https://github.com/resemble-ai/chatterbox),
[Cartesia model documentation](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest),
[Cartesia pricing](https://www.cartesia.ai/pricing),
[ElevenLabs API pricing](https://elevenlabs.io/pricing/api),
[ElevenLabs latency explanation](https://elevenlabs.io/docs/eleven-api/concepts/latency).
Capability and latency statements here are vendor claims, not a Vyakti result.
Advertised inference latency is not India end-to-end conversation latency.

## Bounded first comparison

Proposed design: three consenting speakers, 12 utterances per speaker and
three model arms, for 108 generations before retries. Select Hindi, Roman
Hinglish, mixed script, Indian names, numbers, expert terminology, questions
and corrective explanations. Keep reference audio and full text identical;
record exact model snapshots and seeds where supported. A model without seed
control must declare that limitation. Record provider-specific preprocessing
instead of silently changing the matched cell.

Use the existing sealed listening workflow. Ask the owner and independent
native Hindi/Hinglish listeners to rate likeness, naturalness, accent and
pronunciation separately. Record expert pacing, emphasis and correction
delivery in a separate qualitative note until a versioned fifth-axis form is
introduced. Do not silently add a required score to existing sealed four-axis
packs or treat old incomplete sheets as comparable new evidence.

Measure objective word errors, repetition, switch-adjacent errors and abnormal
pauses. Measure end-of-user-speech to first playable audio, failures and full
turn completion; report warm/cold conditions separately. Include the source
reference, protection path, text and processing versions in every receipt.

Proposed promotion condition: owner acceptance plus native-listener preference
without worse intelligibility, acceptable measured end-to-end delay and a
recorded cost budget. These thresholds require calibration with actual users.
No provider is promoted by this document or by automated cosine scores.

## Roman Hinglish annotations

`scoreSwitchAdjacentErrors(reference, observed, radius, options)` now accepts
`options.languageAnnotation`. Its versioned shape is:

```json
{
  "contract": "vyakti-reviewed-language-spans/v1",
  "referenceText": "Aaj hum voice test karenge",
  "reviewedBy": "reviewer-id",
  "spans": [
    { "startToken": 0, "endToken": 2, "language": "hi" },
    { "startToken": 2, "endToken": 4, "language": "en" },
    { "startToken": 4, "endToken": 5, "language": "hi" }
  ]
}
```

Offsets count `scoreTokens(referenceText)` tokens, with an exclusive end.
Annotations must bind the exact reference text, name a reviewer and cover each
token exactly once in order, using `hi`, `en` or `neutral`. Stale, partial,
overlapping, empty or invalid spans throw rather than reverting to guesses.
Reviewer identity records provenance; it does not prove linguistic accuracy.
Real corpus annotations still require native-speaker review. The example and
tests are fixtures, not completed corpus annotation work.

Without an annotation, existing behavior is retained and labeled
`script_heuristic`. All-Roman text then has no inferred language switches and
its switch error rate remains null. Timing-boundary measurements also label
their existing script heuristic; annotation-driven timing is not implemented.
No phonetic quality follows from either boundary method alone.

## Verification

On 2026-09-06 the focused frontier runner passed 22 named checks over 29 prompt
plans. New checks exercise annotated all-Roman switches, errors outside the
selected boundary radius, ten invalid-annotation cases and unchanged ordinary
mixed-script results. The existing listening harness passed 36 checks and the
matched-pack harness passed 51 checks before this change; neither was changed.
These are deterministic benchmark-mechanics tests, not generated-audio tests.
