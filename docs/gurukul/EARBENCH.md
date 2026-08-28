# earbench — the blind listening bench

**Status: the instrument exists and has never been used on a human ear.**
Nothing in this repository is evidence about how any cloned voice *sounds*.

---

## Why this exists

`context/decisions.md` makes the fidelity law explicit: the ECAPA/WavLM cosine
similarity score is a **regression monitor and a floor**, and activation quality
is decided by a **blind owner-calibration pass**. The reason is
`context/rejected.md#azure-tts`: every measured axis said switch — pronunciation
11/15 → 15/15, first audio 12.7 s → 255 ms, cost 5× lower — and the owner's ear
said no. The battery had measured *pronunciation*. It had never measured
*accent identity*, and only the second decides whether the voice is theirs.

So the project has a number for the owner's own cloned voice — **ECAPA 0.7753,
p10 0.7479, against a 0.8869 self-vs-self ceiling** (`first-real-clone`) — and
had nothing at all that said how it sounds. This is the missing half.

The bench protocol is `docs/gurukul/research/voice-stack.md` §Bench. This
implements the blind, counterbalanced human half of it: ABX identity
discrimination plus a rating pass on three axes, with **accent authenticity as
its own axis**, per the `azure-tts` instruction.

---

## The command

```bash
# 1. build a blinded stimulus set from the consented reference, routed through
#    the deployed Chatterbox runtime
node scripts/earbench.mjs stimuli

# 2. sit and listen (opens a local page on 127.0.0.1)
node scripts/earbench.mjs listen

# 3. score what you answered against the sealed key
node scripts/earbench.mjs score
```

Hindi runs must state what is actually known about the conditioning reference.
The command refuses to synthesise if either field is omitted:

```bash
node scripts/earbench.mjs stimuli \
  --reference-language-mode latin_only \
  --reference-language-evidence-scope exact_reference
```

`latin_only` is script evidence, not a claim that the speaker is English. Use
`exact_reference` only when the selected prompt itself was inspected or
transcribed. Use `source_transcript` for a source-wide observation and
`unverified` when no narrower evidence exists.

For the blind matched-seed Hindi CFG comparison:

```bash
node scripts/earbench.mjs stimuli --cfg-ab \
  --reference-language-mode latin_only \
  --reference-language-evidence-scope exact_reference
```

This creates two synthetic arms with the same text, seed, reference bytes,
model arm and model commitment. One preserves the incumbent requested CFG
(default `0.5`) through the runtime's legacy compatibility contract. The other
requests the documented `cfg=0` accent-transfer mitigation through the current
conditioning contract. The contract difference is recorded as a known wire
difference in the sealed key. Neither arm is labelled as better. Only the blind
listening result can say whether listeners distinguish them or rate one higher.

Environment for step 1 (`docs/gurukul/ENV-MANIFEST.md`,
`docs/gurukul/AZURE-DEPLOY-STATE.md`):

| variable | why |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | read the consented reference from the `vyakti-replica-private` bucket (`api/_replica-storage.js`) |
| `AZURE_OPEN_VOICE_ORIGIN`, `OPEN_VOICE_HMAC_SECRET` | synthesise the clone arms on the real runtime. **There is no mock arm.** Missing these is a named refusal, not a fallback |
| `SARVAM_API_KEY` | *optional but strongly wanted*: transcribes the reference so the arms say the SAME words, and independently verifies that no spoken disclosure survived the trim |

Useful flags:

```
--reference <file.wav>   use a local 24 kHz mono PCM16 file instead of the bucket
--object <path>          a different object in vyakti-replica-private
                         (default: reference/owner-voice-20260826.wav)
--items <n>              how many sentences per arm (default 6, 4-20)
--arms real,clone-full,clone-short
--cfg-ab                 blind incumbent-requested-CFG vs explicit-cfg-zero run
--incumbent-cfg <0..1>   incumbent control value (default 0.5; must be >0)
--reference-language-mode <devanagari|mixed|latin_only|unknown>
--reference-language-evidence-scope <exact_reference|source_transcript|unverified>
--run <id>               name the run; `listen`/`score` default to the newest
--port <n>               listening page port (default 8787)
--unmatched              skip the transcript step and use the scripted corpus
```

**Cold start:** the GPU runtime scales to zero and takes ~161 s to come up, and
the request that wakes it dies first (`AZURE-DEPLOY-STATE.md` §8). `stimuli`
retries synthesis four times, 15 s apart, and says it is doing so. If the
evidence lane is ever added here it needs the `/healthz` warm-up first, because
the HMAC skew window is 60 s and a cold start is longer than that — the waking
request comes back **401, not a timeout** (`hmac-skew-shorter-than-cold-start`).

**Cost:** one synthesis call per item per clone arm. The default run is 6 items
× 2 clone arms = 12 calls, ~7 s each warm, plus one cold start.

---

## What it measures

**Part 1 — ABX, speaker identity.** You hear X, then A and B, and pick the one
that is the same *speaker* as X. A and B say the same sentence as each other; X
says a different one, so the words cannot answer it for you. Every arm pair is
tested on every item.

**Part 2 — ratings, 1-5, against a reference clip of the real speaker:**

| axis | the question |
|---|---|
| `similarity` | is this the same person as the reference? |
| `naturalness` | does it sound like a human being talking? |
| `accent` | **accent identity** — their accent, not merely correct pronunciation |

`accent` is separate on purpose and must stay separate. It is the axis
`azure-tts` proves a battery can pass on pronunciation and fail on identity.

**Arms.** `real` (the consented speaker), `clone-full` (zero-shot Chatterbox on
up to 90 s of reference), `clone-short` (the same runtime on 12 s). The second
synthetic arm is nearly free and answers the cheapest real question the lane
has: how much reference audio fidelity actually needs.

With `--cfg-ab`, the synthetic arms are `clone-cfg-incumbent` and
`clone-cfg-zero`. Their requested and effective CFG, reference language mode,
evidence scope, conditioning contract, model arm, model pack, model commitment,
seed, text hash and reference hash are stored in the sealed key. None of those
fields are served to the listening page.

---

## What the scorer says

Three verdicts, and the distinction between the last two is the whole point:

- **DISTINGUISHABLE** — one-sided exact binomial p < 0.025 *and* the Wilson 95%
  lower bound above chance. The listener can reliably tell the arms apart.
- **INDISTINGUISHABLE** — the Wilson 95% interval sits entirely below the
  equivalence bound (0.65). A positive claim, not the absence of one.
- **INCONCLUSIVE** — neither. The report says how many more trials, at the
  observed rate, would settle equivalence.

"Not statistically significant" is never reported as "no difference". A run of
six trials at 50% is under-powered, and a bench that called that
"indistinguishable" would license a claim nobody measured.

Also reported: n and chance level on every ABX line, per-arm and **paired**
(same listener, same sentence, two arms) rating means with 95% t intervals — a
t interval, not a normal one, because this bench runs at one to three
listeners — and a **catch-trial** pass rate. Catch trials are trivially
answerable; a sheet below 90% on them is reported INVALID and contributes to
no number.

---

## How the blinding works

Everything below is asserted in `evals/earbench/run.mjs` and re-checked on
every run of the eval suite.

- **The spoken disclosure is removed.** Every synthesis through
  `api/_voice/providers/open-chatterbox-preview.js` is rendered as
  `"This is an AI-generated voice replica." + your text`
  (`api/_voice/contracts.js`), and the runtime **speaks it**. Uncorrected, the
  synthetic arm announces itself in the first two seconds of every trial. The
  bench cuts at the pause after it and puts the real arm through the identical
  trim/normalise/fade path so the treatment is a constant. Two checks stand
  behind the cut — a length-plausibility rail that **fails closed**, and, when
  `SARVAM_API_KEY` is set, an ASR pass that refuses to write a bench if any
  trimmed clip still transcribes the disclosure.
- **Filenames** are HMACs under a per-run secret that exists only in the key.
- **File size and duration** are identical for every stimulus — trailing digital
  silence plus a RIFF `JUNK` chunk — because both `ls -l` and a player's
  scrubber leak clip length, and clip length differs by arm.
- **Loudness** is RMS-equalised across arms.
- **Order** is shuffled; A/B side and the arm X is drawn from are counterbalanced
  in a four-cell cycle, reset per arm pair.
- **The listener-facing files** (`trials.json`, `manifest.json`) carry no arm, no
  item text, no correct answer and no catch flag.
- **The key lives outside the served tree** (`earbench-out/keys/`), and the local
  server is a whitelist router that serves four shapes and 404s everything else,
  including traversal.
- **Nothing leaves the machine.** The page has no fonts, no CDN, no analytics.

### Checking the trim without unblinding yourself

You are the listener, so you cannot spot-check the stimuli. Instead:

```bash
node scripts/earbench.mjs verify-trim
```

It points at one WAV containing **only the audio removed from the front of the
clone clips**, shuffled and unlabelled. Every segment should be the disclosure
sentence and nothing else. It names no file and contains no stimulus, so
hearing it tells you nothing about which clip is which.

---

## The self-test

```bash
node scripts/earbench.mjs selftest       # or: node evals/run.mjs earbench
```

Drives every mechanism end to end with locally generated tones and two
simulated listeners — one who can always tell the arms apart, one who is
guessing — and asserts the scorer says different things about them. It needs no
credentials, spends nothing, and touches no network beyond loopback.

Its output is stamped `SELF-TEST — NOT A BENCH RESULT` in the key, in the
manifest and in every printed report. **It is not evidence about any voice.**

---

## Running the listening pass properly

1. Headphones, quiet room, one sitting. Do not change the volume partway.
2. Do not open the key file. Do not open `earbench-out/keys/` at all.
3. Answer every trial, guessing when you must — a guess is a measurable answer
   here and the statistics are built to absorb it.
4. Ideally ≥3 listeners, per the bench protocol. With one listener the ABX
   result is still valid; the rating intervals are just wide, and the report
   says so rather than hiding it.
5. `score` after each listener finishes. The report is written to
   `earbench-out/reports/<run>.report.json`.

---

## What is NOT true yet

- **No human has listened through this bench.** There is no MOS, no similarity
  score, no accent-authenticity number, and no ABX result for any voice.
- The `stimuli` path has never run against the live Azure runtime or the live
  Supabase bucket — the workstream that built it had no credentials. Everything
  downstream of "bytes arrive" is verified; the two network reads are not.
- The disclosure trimmer has never been run on real Chatterbox output. It is
  verified on constructed audio with a known pause, and it fails closed when it
  cannot find one, so the first real run either works or refuses.
- The bench does not measure latency or cost; those are separate rows in the
  protocol and `first-clone.mjs` already reports RTF per clip.
- Romanised-Hinglish word-level pronunciation accuracy (the `hinglish-tts-l1`
  methodology) is **not** implemented here. It is a transcription task, not a
  rating task, and folding it into a slider would have made it incomparable to
  the existing baseline.
