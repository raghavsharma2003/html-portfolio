# Exact-text owner voice pack

Status on 2026-08-28: the local instrument and guarded orchestration are ready.
No cloud synthesis for this pack has run. No listener has scored it, and no
quality winner exists.

## Frozen comparison

Every arm in a language receives the same 12-second owner-reference WAV, the
same transcript hypothesis bytes, active owner-consent receipt hash, seed
`31001`, localized spoken disclosure and target sentence.

English target:

> Today we will learn why balancing a chemical equation changes the coefficients but never the subscripts.

Hindi target:

> रासायनिक अभिक्रिया में पुराने बंध टूटते हैं और नए बंध बनते हैं। इसे केवल रंग बदलने से मत पहचानो।

The base pack has five requests:

- Chatterbox: English and Hindi
- Qwen3-TTS: English only
- VoxCPM2: English and Hindi

Optional adapters are already registered for IndicF5 in Hindi and ZONOS2 in
English and Hindi. Adding both creates eight requests, four per language,
without changing either comparison cell.

## Integrity contract

Each accepted source receipt binds the request and response HMAC, immutable
model commitment, exact owner source and reference hashes, transcript hash and
evidence scope, consent receipt, seed, body, disclosure and full-text hashes,
24 kHz mono PCM16 output hash, and final PerTh verification.

The listening seal applies one RMS, fade and silence-pad treatment to every
candidate and the real owner reference. It never trims the disclosure. All
served WAVs have the same bytes, duration and geometry. The browser sees only
24-character opaque ids, the exact target text and score controls. Model names,
receipts, consent hashes, commitments, attention answers and the randomization
key remain outside the served tree.

Ratings are separate 1 to 5 axes for owner likeness, naturalness, Indian accent
fit, and pronunciation. Disclosure audibility is recorded separately. One
hidden byte-identical repeat per language and two tone checks gate listener
acceptance. Descriptive means never become a production-quality claim by
themselves.

## Local checks

```powershell
node evals/run.mjs voicematched
```

This synthetic suite performs no network, database, model or cloud call. It
checks the provider capability matrix, exact matched fields, all receipt
bindings, negative controls, common output geometry, sealed randomization,
private-route isolation, explicit unseal gate and the cloud spend stop.

## Guarded run sequence

Planning is local. It needs the active owner consent receipt hash and owner
replica id but no transport secret:

```powershell
node scripts/voice-matched-pack.mjs plan `
  --consent-receipt <active-owner-consent-sha256> `
  --replica-id <owner-replica-uuid>
```

Cloud synthesis cannot start from `plan`, `seal`, `verify`, `listen`, `score`
or `unseal`. The only network-capable command requires the exact confirmation,
a caller-selected limit no greater than USD 5, and per-arm origin, HMAC and
expected-model-commitment environment values:

```powershell
node scripts/voice-matched-pack.mjs run `
  --confirm-cloud exact-text-matched-pack `
  --max-usd 5 `
  --only chatterbox
```

Each attempted request permanently reserves USD 0.50 in the private ledger
before network execution. The eleventh attempt is refused, so the orchestration
ledger cannot cross USD 5 even after failures. This is a software request-lane
stop, not a claim about delayed Azure billing ingestion or a runaway platform
allocation. Keep the isolated apps at scale to zero and verify replica teardown
separately.

After every planned source exists:

```powershell
node scripts/voice-matched-pack.mjs seal
node scripts/voice-matched-pack.mjs verify
node scripts/voice-matched-pack.mjs listen
node scripts/voice-matched-pack.mjs score
node scripts/voice-matched-pack.mjs unseal --confirm-ratings-locked
```

`unseal` refuses until at least one complete listener passes both attention
checks. English and Hindi remain separate exact-text cells in the final report.
