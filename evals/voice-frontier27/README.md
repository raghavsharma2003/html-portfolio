# Three-speaker voice frontier listening kit

This kit contains authored prompts and local preparation tools, not generated speech or benchmark results. It makes no provider, model, network or GPU calls. It never computes MOS or speaker likeness from audio. Raw human ratings remain raw ratings until an independently specified analysis is performed.

## Corpus and splits

`corpus.mjs` contains 36 prompts: 12 English, 12 Hindi in Devanagari, and 12 Hinglish (six Latin, six mixed Devanagari/Latin). Each language has three development and nine held-out prompts. Each item includes delivery intent, pronunciation notes, tags and an approximate duration target. Targets guide comparable generation; they are not automatic speech-quality gates. Do not time-stretch outputs to hit them.

The matching numeric suffix across languages marks related teaching concepts. Treat these as correlated concepts in analysis, not 36 unrelated topics. Development concepts 01-03 are separate from held-out concepts 04-12. Tune reference selection, normalization and model settings using development items only, then freeze them. Do not train, tune, enroll, or select a best seed using held-out text or owner readings of it.

The prompts cover explanation, encouragement, Indian names/places, numbers, time, code reading and switching within a sentence. None provides medical or legal advice. Pronunciation notes define intelligibility and semantic distinctions, not one mandatory accent. They belong to the listening rubric; feeding them to one model but not another would change the experiment.

## Three independent speakers

Copy `config.example.json` into an untracked run directory. Use three consenting speakers with their own recordings. Replace example paths and affirm the two declarations only when accurate. The tool checks declaration fields, not the truth of consent or speaker identity. Existing valid authorization need not be sought again.

Each speaker needs a clean enrollment WAV and a different natural held-out reference WAV. Use the same enrollment source across arms, recording any model-specific conversion in the private run log. The held-out reference is only for listener comparison and must never reach generation. Six distinct hashes prevent accidental exact-file reuse; they cannot prove six recordings or three different humans, so verify those facts independently. Do not substitute an unrelated voice when a reference is missing.

Expected input layout (real inference artifacts only):

```text
audio-root/
  references/speaker01/enrollment.wav
  references/speaker01/heldout.wav
  references/speaker02/enrollment.wav
  references/speaker02/heldout.wav
  references/speaker03/enrollment.wav
  references/speaker03/heldout.wav
  speaker01/baseline/en04_r1.wav
  speaker01/baseline/en04_r2.wav
  speaker01/candidate-b/en04_r1.wav
  ... every selected speaker x arm x prompt x repetition
```

The default example produces 486 held-out clips (3 speakers x 3 arms x 27 prompts x 2 repetitions), grouped into 162 blind comparisons. Development alone is 162 clips. These are workload sizes, not completed generations. Cost and authorization must cover the selected design before any separate inference run. A smaller documented run can set one repetition or two arms; the three-speaker design stays fixed. Do not pool an earlier one-owner exploratory test into this validation set.

## Commands

From the integration repository:

```powershell
node evals/voice-frontier27/prepare.mjs validate --config evals/voice-frontier27/config.example.json
node evals/voice-frontier27/verify.mjs
node evals/voice-frontier27/prepare.mjs prepare --input C:/voice-runs/run27/audio --config C:/voice-runs/run27/run.json --out C:/voice-runs/run27/listening-rater01 --seed 27 --split heldout
```

Preparation requires actual nonempty audio for the complete selected matrix. Missing, malformed, digitally silent or copied-reference candidates refuse. Supported input is mono/stereo RIFF WAV, PCM16/24/32 or float32, 8-192 kHz, 0.1-300 seconds, at most 50 MiB. Convert other codecs separately and record that conversion. Structural validation does not prove speech, reference bandwidth, intelligibility, consent, AI disclosure or watermark presence.

Output must be a new directory separate from the audio root. Seeded randomization is reproducible for the same config ordering, corpus and files. Use a different recorded seed per listener to reduce order effects. Never use the private generation repetition number as a random seed unless the generation record actually says so.

Only distribute the `blind/` subdirectory. It contains anonymous WAV names, held-out reference clips, `manifest.json`, `listener-scores.csv` and `preferences.csv`. Ancillary WAV chunks are removed to avoid leaking model names through metadata; PCM samples are unchanged. The tool does not loudness-normalize, trim, remove disclosure, or modify pitch. Standardize playback and permitted preprocessing across arms before preparing the run.

Keep `private/` away from listeners. It contains the mapping to models, original hashes/paths, preparation seed, reference records, a summary and `latency-cost.csv`. Duplicate candidate hashes are reported, not silently relabeled as independent outputs. An interrupted write may leave an incomplete directory; do not distribute it. Choose a fresh output after addressing the error; the tool never overwrites or deletes a prior run.

## Human scorecard protocol

Give each rater a unique ID. Listen to the natural reference first, then each anonymized candidate while viewing the prompt. Use the same headphones/volume and replay allowance for all candidates. Preserve the mandatory spoken AI disclosure and watermark; score the same marked content span across arms rather than stripping protection.

Separate ratings are deliberate:

| Field | Anchors |
|---|---|
| `naturalness_1to5` | 1: severely unnatural; 3: understandable but noticeably synthetic; 5: naturally spoken |
| `speaker_likeness_1to5_or_NA` | 1: sounds like a different person; 3: some traits match; 5: closely resembles the reference person; NA if unable to judge |
| `intelligibility_1to5` | 1: much content unintelligible; 3: effort or replay needed; 5: all content clear |
| `prosody_fit_1to5` | 1: pacing/emphasis conflict with meaning; 3: acceptable but uneven; 5: fitting pauses, emphasis and emotion |
| `code_switch_quality_1to5_or_NA` | 1: switches break words/voice; 3: some awkward transitions; 5: fluid and intelligible; NA for monolingual items |

Record whether the rater knows the speaker. Keep owner/familiar-listener judgments separate from unfamiliar-listener judgments. Write the actual human-heard transcript and wrong/missing numbers or names. A high naturalness rating cannot fill a missing likeness rating. Missing values remain missing, never zero. Preference must be one available anonymous ID, TIE or NONE; never derive it from an automatic metric. No MOS, confidence interval, identity percentage or pass claim is generated by this kit.

For later analysis, preserve every attempt and failure, compare paired prompts and speakers, account for repeated concepts and raters, and report sample counts and uncertainty. Do not count 486 clips as 486 independent people. The 36-item corpus is bounded coverage, not proof of every accent or expert domain.

## Latency and cost record

`private/latency-cost.csv` pre-fills only IDs, original audio hashes and WAV duration. All timing, cache, price, quality-acceptance and billing cells stay blank. Add failed attempts as separate rows with run IDs; no audio duration is assumed for failures.

Record cold/warm state separately from cache state (`miss`, `hit`, `partial`, `unknown`), provider model snapshot, image digest, actual generation seed, reference hash, GPU/region/concurrency and timestamp. Distinguish first returned byte, first playable audio, real browser end-of-turn latency and interruption-to-silence. Do not use total WAV duration as generation time.

Record provider-billable quantity/unit and cached-billable quantity/unit separately using actual receipts. Units may be characters, tokens, seconds or requests; never sum unlike units. A cached hit is not necessarily free. GPU allocation includes warm-up and idle tails. State the allocation rule for shared compute and avoid counting a provider GPU charge again as self-hosted compute. Keep gross cost, applied credits and cash payable separate, with currency. Blank cost means unmeasured, not zero. Accepted audio minutes require explicit human acceptance; all retries and rejected generations remain in the cost numerator.

## Validation boundary

`validate` checks corpus/config shape only. `verify.mjs` uses tiny audio-byte fixtures to test parsing, metadata removal and a 54-file development preparation matrix, plus an empty directory to prove missing audio cannot produce a manifest. It verifies reproducible order and blank scores, then deletes its own temporary fixtures. These fixtures are never speech or benchmark results. Counts are offline code checks, not listening observations or model measurements. No real generation matrix is supplied or claimed.
