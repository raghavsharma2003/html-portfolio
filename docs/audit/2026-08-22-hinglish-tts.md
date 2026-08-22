# #88 TEST L1 — Hinglish TTS/STT round-trip audit — 2026-08-22

Method: cascade TTS lane only (api/speech.js's free/direct-Google leg, model `gemini-3.1-flash-tts-preview`, voice `Autonoe`) — the LIVE speech-to-speech lane (`src/voice/liveCall.ts`) cannot be driven headlessly for a pronunciation probe (see evals/speech/l1-hinglish.mjs's header for the two independent reasons: no STT step in the existing acoustic-floor harness, and no way to force a verbatim utterance out of a conversational model without confounding engine mispronunciation with model paraphrase). n=20, real paid Google calls, run once on 2026-08-22. Round-trip: each line synthesised, then sent back through Gemini multimodal transcription (romanised output requested). Scored by word-level token match against the source line, plus a curated confusable-word flag for the specific ambiguous romanisations this ticket named (hai/he, kal/call, main/man, kya/kaya, padh|pad, bahut/bohot).

**Summary: 20/20 scored, 0 errored, 1 flagged as likely mispronunciations.**

## Worst offenders (lowest word-match ratio)

- **"hai"** (persona.ts:141) -> STT: "hi" — 0% match, FLAGGED: "hai" -> read as English ("hi")
- **"nahiii"** (persona.ts:131) -> STT: "nahi" — 0% match
- **"acchhaaa"** (persona.ts:131) -> STT: "achha" — 0% match
- **"arreee"** (persona.ts:131) -> STT: "hare" — 0% match
- **"yaaar"** (persona.ts:131) -> STT: "yaar" — 0% match

## Full per-line results

| # | line | source | STT transcript | match | flagged mispronunciation |
|---|------|--------|-----------------|-------|---------------------------|
| 1 | `nahi` | persona.ts:141 | `nahi` | 100% | — |
| 2 | `hai` | persona.ts:141 | `hi` | 0% | "hai" -> read as English ("hi") |
| 3 | `abhi` | persona.ts:141 | `abhi` | 100% | — |
| 4 | `matlab` | persona.ts:141 | `matlab` | 100% | — |
| 5 | `pata nahi` | persona.ts:141 | `pata nahi` | 100% | — |
| 6 | `kal` | persona.ts:141 | `kal` | 100% | — |
| 7 | `nahiii` | persona.ts:131 | `nahi` | 0% | — |
| 8 | `acchhaaa` | persona.ts:131 | `achha` | 0% | — |
| 9 | `arreee` | persona.ts:131 | `hare` | 0% | — |
| 10 | `yaaar` | persona.ts:131 | `yaar` | 0% | — |
| 11 | `chhod, tum batao` | persona.ts:135 | `chod tum batao` | 67% | — |
| 12 | `no wait, he messaged actually` | persona.ts:135 | `no wait he messaged actually` | 100% | — |
| 13 | `kya kar rha` | persona.ts:147 | `kya kar raha hoga` | 67% | — |
| 14 | `scene kya h` | persona.ts:144 | `seen kya hai` | 33% | — |
| 15 | `acha` | persona.ts:151 | `accha` | 0% | — |
| 16 | `thik h` | persona.ts:151 | `theek hai` | 0% | — |
| 17 | `arre kya hua` | persona.ts:316 | `are kya hua` | 67% | — |
| 18 | `main abhi hasi jab tu serious tha` | persona.ts:238 | `main abhi hansi jab tu serious tha` | 86% | — |
| 19 | `bahut` | task-specified | `bahut` | 100% | — |
| 20 | `padh` | task-specified | `padh` | 100% | — |

STT model used: gemini-3.1-flash-lite.

## Analysis — reading the ratio metric honestly

The automated token-match ratio is a blunt instrument and 5 of the 20 "0%"
rows are **not** evidence of mispronunciation on inspection — they need a
human read before being treated as findings, in the same spirit as
`rejected.md`'s `voice-ears`: a transcript is not an ear, and this suite has
no ear in it.

**The one clean, automated finding — genuine, matches the ticket exactly:**
- line 2, `hai` alone → STT `hi`. The curated confusable-flag caught this
  itself: a bare Hindi "hai" round-tripped as the English greeting "hi". This
  is the hai/he family the ticket named, materialising as hai/hi instead —
  same failure class (an isolated function word landing as a short English
  word). Worth a real-ear listen before deciding whether it is the TTS
  clipping the vowel or the STT over-fitting a one-syllable clip to the most
  common English word that shape can make.

**Likely STT orthographic normalization, not TTS mispronunciation (ratio
noise, not a finding):**
- lines 7/8/10 (`nahiii`→nahi, `acchhaaa`→achha, `yaaar`→yaar): an STT model
  routinely renormalizes a stretched spelling back to standard spelling
  regardless of what the audio's prosody actually did — this suite cannot
  tell "the TTS did not stretch the vowel" apart from "the STT heard a
  stretch and wrote it in standard orthography anyway". Text round-trip
  structurally cannot settle this; it needs a human listening pass against
  the actual clips.
- lines 13/14/16/17 (`kya kar rha`→"kya kar raha hoga", `scene kya h`→"seen
  kya hai", `thik h`→"theek hai", `arre kya hua`→"are kya hua"): these read
  as the STT model (itself an LLM, not a pure acoustic transcriber)
  expanding shortform spelling to full spoken forms and, in one case
  (`rha`→"raha **hoga**"), adding a word that changes the tense/meaning of
  what was said. That addition is an STT over-completion artifact worth
  naming on its own — an LLM-based STT can hallucinate a more grammatical
  finish to a short, ambiguous clip, which contaminates the signal this
  suite is trying to isolate. None of these four are treated as TTS
  mispronunciations.

**Two NOT caught by the automated confusable list, worth a human ear before
being dismissed as normalization:**
- line 9, `arreee` → STT `hare`. Not a spelling normalization of "arre" —
  "hare" is a different word entirely (rhymes, but is not a shortform of
  it). Flagged here by hand; the automated CONFUSABLES map did not cover
  "arre" and should gain an entry if a listen confirms this is real.
- line 11, `chhod, tum batao` → STT `chod tum batao`. "chhod" (aspirated,
  "leave/drop") collapsing to "chod" (unaspirated, a different and much
  cruder word) is the single highest-stakes possible miss in this whole
  corpus if it reflects the TTS actually dropping the aspiration — Hindi
  chh/ch is phonemic, not a spelling nicety. This is a genuine open flag,
  not resolved by this suite, and should be the first candidate for a human
  listen.

**No evidence of mispronunciation:** lines 1, 3-6, 12, 18-20 — including
both task-specified additions (`bahut`, `padh`), which round-tripped clean.

**What this suite does and does not prove.** It proves the cascade lane's
round-trip is legible enough that an isolated `hai` can misread as `hi`, and
it surfaces two candidates (`arreee`→hare, chhod→chod) worth a human ear.
It does NOT prove or disprove anything about the stretched-vowel register
specifically, because STT normalization and TTS non-production are
indistinguishable from transcript text alone — that gap needs a listening
pass, not a bigger n of this same method.

