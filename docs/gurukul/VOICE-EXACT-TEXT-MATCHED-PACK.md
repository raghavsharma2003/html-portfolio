# Exact-text owner voice pack

Status on 2026-08-28: the r2 pack has six accepted protected clips and is
sealed for listening. Its mapping remains private. No listener has scored it,
no model identity has been unlocked, and no quality winner exists.

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

## Owner Studio workflow

The authenticated Meet surface can run the same instrument without serving a
private key or model label to the browser. Export the already-sealed public
tree as one bounded file:

```powershell
node scripts/voice-matched-pack.mjs studio-bundle `
  --home scratchpad/voice-matched-pack-20260828-r2 `
  --out scratchpad/voice-matched-pack-20260828-r2/reports/owner-studio-bundle.json
```

Import that file under **Blind voice experiment** in Meet. The browser stores
the pack in IndexedDB and checkpoints the small answer sheet in localStorage.
Progress can also be exported and imported explicitly. **Replace pack** first
purges the current run's IndexedDB bundle, progress, imported result and
replica pointer. **Remove private experiment** does the same after confirmation
and leaves files already exported to the owner's computer untouched. Both
operations are scoped to the exact replica and run.

The Studio never has the private attention answers, so a completed sheet must
pass the existing private gate:

```powershell
node scripts/voice-matched-pack.mjs import-studio-answers `
  --file <owner-studio-ratings.json> `
  --home scratchpad/voice-matched-pack-20260828-r2

node scripts/voice-matched-pack.mjs unseal `
  --confirm-ratings-locked `
  --home scratchpad/voice-matched-pack-20260828-r2
```

Then import `reports/unsealed-report.json` into the same Studio panel. The UI
requires an accepted-listener count and exact run binding, then verifies a
private-pack signature before it displays identities. `studio-bundle` creates
or reuses a 2048-bit RSA signing key only at
`private/studio-report-signing-key.pem`, requesting mode `0600` on systems that
enforce POSIX file modes. The bundle
contains only the SPKI public key, its SHA-256 key id and the verification
algorithm. `unseal` signs the canonical report body with
RSASSA-PKCS1-v1_5 and SHA-256; the browser verifies that signature with
WebCrypto and refuses a missing signature, changed report or different key.
RSA PKCS#1 v1.5 was selected here because Node and WebCrypto use the same
signature encoding directly, avoiding the DER-versus-raw interoperability
edge of ECDSA. The 20 MiB pack and 1 MiB answer/report caps remain enforced.
The UI reports descriptive means only and never auto-promotes a model.
