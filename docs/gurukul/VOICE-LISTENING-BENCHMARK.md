# Voice listening benchmark

Status on 2026-08-28: the fresh four-pack instrument, including the real
IndicF5 r7 qualification pack, is ready. No human quality result or model
winner exists yet.

## What this run contains

- 21 real protected clips from the existing Chatterbox, Qwen English, VoxCPM2,
  and IndicF5 r7 qualification packs.
- 23 rating screens because two clips are repeated under new opaque ids. The
  repeats measure listener consistency and are not extra model evidence.
- 2 simple tone checks. A listener must answer both correctly for their sheet
  to enter the report.
- 1 valid exact-text comparison cell containing four Hindi variants.
- 17 unmatched prompt lanes.
- 0 exact-text cells that cross providers.

The last point is binding. Independent quality ratings are useful for every
clip, but this pack cannot honestly name a cross-provider winner. A fair
head-to-head needs the same language, exact target text, owner reference bytes,
and protection treatment from every candidate.

## Run it

```powershell
node scripts/voice-listening-benchmark.mjs build --home scratchpad/voice-listening-benchmark-20260828-indicf5-r7 --indicf5-pack scratchpad/indicf5-20260828-r7
node scripts/voice-listening-benchmark.mjs verify --home scratchpad/voice-listening-benchmark-20260828-indicf5-r7
node scripts/voice-listening-benchmark.mjs listen --home scratchpad/voice-listening-benchmark-20260828-indicf5-r7 --port 8792
```

Open `http://127.0.0.1:8792/` in a browser. Use headphones, a quiet room, and
one fixed volume. The flow takes about 25 to 35 minutes for one careful
listener.

After every listener finishes:

```powershell
node scripts/voice-listening-benchmark.mjs score --home scratchpad/voice-listening-benchmark-20260828-indicf5-r7
```

This checks completeness, attention trials, and hidden-repeat consistency. It
does not reveal the model mapping. Only after all ratings are locked:

```powershell
node scripts/voice-listening-benchmark.mjs unseal --home scratchpad/voice-listening-benchmark-20260828-indicf5-r7 --confirm-ratings-locked
```

The unsealed report keeps exact-text matched cells and unmatched lanes in
separate sections. It always leaves `crossProviderWinner` empty when no fair
cross-provider cell exists.

## What the listener rates

Each voice clip has four independent 1 to 5 scales:

1. owner likeness
2. naturalness and humanness
3. Indian accent fit for Hindi, Hinglish, or Indian English
4. pronunciation and intelligibility

Disclosure audibility is recorded separately as full, partial or unclear, or
absent. A transport receipt that requested a disclosure does not prove a human
can hear it, so the listening pass checks it directly.

## Blinding and integrity

- A new HMAC secret generates every 24-character listener-facing id.
- Original filenames, model names, model commitments, source paths, and arm
  settings exist only in `private/sealed-key.json`.
- The local server is bound to `127.0.0.1` and serves only the page, two public
  JSON files, and 24-hex WAV paths. The private key and answers are unreachable.
- Every source WAV is checked against its source manifest or signed receipt.
- Every served WAV is canonical 24 kHz mono PCM16, RMS matched, faded through
  one treatment, padded to 13,280 ms, and exactly 637,484 bytes in this run.
- The spoken disclosure is intentionally not trimmed because its audibility is
  one of the required ratings.
- Two hidden repeat clips are byte-identical to their originals but have new
  opaque ids and are placed at least four screens away.
- Two tone checks are mixed into the sequence. Their correct answers never
  enter the served tree.

Executable checks:

```powershell
node evals/run.mjs voicelistening
node scripts/voice-listening-benchmark.mjs verify --home scratchpad/voice-listening-benchmark-20260828-indicf5-r7
node evals/voice-listening-benchmark/browser-check.mjs http://127.0.0.1:8792/
```

The focused suite passed 36 checks, the fresh source-bound pack audit passed 18
checks, and the mobile and desktop browser check passed on 2026-08-28. These
are instrument results only. They do not measure how any voice sounds.

## Adding another candidate

Do not add a WAV by hand. A candidate adapter must prove all of the following
before build time:

- exact WAV or PCM hash from the candidate's public manifest or private receipt
- 24 kHz mono PCM16 delivery
- exact target text and text hash
- target language and script
- exact model commitment and owner-reference commitment in the sealed key
- response protection and PerTh verification
- verified owner-self evaluation scope

If its text does not exactly match another candidate in the same language, it
enters an unmatched lane. Semantic similarity is not enough to create a fair
comparison cell.
