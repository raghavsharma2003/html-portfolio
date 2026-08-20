# Voice samples — pick her new voice

## Status: not yet generated — read "Why there's no audio yet" before anything else

This doc and `scripts/voice-samples.mjs` are both finished and ready to run.
**No audio exists yet.** The single OpenRouter call the script made before
stopping came back `403 Key limit exceeded (total limit)` — the shared
`OPENROUTER_KEY` in `api/_config.js` (the same key `api/chat.js`, `api/memory.js`,
`api/speech.js` and several others all use) is currently at its account-level
spend cap. That is not something this workstream caused or can fix — it is a
finding, and a more urgent one than the voice task itself: if that key is
really at zero, every OpenRouter-backed lane in production, not just TTS,
is degraded right now. Worth checking today regardless of what happens with
this doc.

**Why the script didn't fall back to the free Google pool instead:** it
could — `api/speech.js`'s own free lane is exactly that pool, and it's a
different budget from OpenRouter. But `context/measurements.md`
`free-tts-daily` records that pool dying (all 9 keys, together, 429) after a
few dozen calls in one session, and it is the **same** pool production
depends on for real conversations. With the paid fallback already confirmed
dead, the free pool is currently the *only* thing giving her a voice at all —
spending it on a voice-shopping demo, right when there is no fallback left if
it runs out, is the exact compound failure `api/speech.js`'s own header
describes already happening once ("the paid account is empty she has NO
VOICE AT ALL"). That call is the owner's to make, not this workstream's to
make silently by just trying it.

**To actually get the six samples**, either:
1. Raise the spend cap on the OpenRouter key (the 403 body includes a direct
   link to the workspace's key management page) and re-run:
   ```
   node scripts/voice-samples.mjs
   ```
   6 API calls total, a few cents, ~2 minutes.
2. Or say the word to spend free-tier Google quota instead — the script would
   need a small edit to point at the direct Google endpoint (same shape
   `api/speech.js`'s free lane already uses) rather than OpenRouter. Not done
   here on purpose, for the reason above.

Everything below describes what running it produces.

---

## How to listen

- **Headphones, not a laptop speaker.** A laptop speaker EQs out exactly the
  low-mid warmth that separates "warm young woman" from "thin and robotic" —
  the whole point of this comparison.
- Listen to all six once through, in order, before rereading anything. Don't
  peek at the mapping at the bottom first — a name changes what you hear.
- Each file is ~15-20s: the same five lines, spoken by a different voice.
  Only the voice changes.

## What to listen for, in this order

1. **Does she sound like a real young Indian woman, full stop** — not "an AI
   voice with an accent applied," not a generic assistant voice. This is the
   filter everything else has to pass first.
2. **Is the Hinglish pronounced right** — the code-switch line ("bug fix",
   "deploy pending") should sound like someone who thinks in English
   dropping into Hindi, not a translation being read aloud.
3. **Would you believe this is the same person across all five lines** — the
   greeting, the tease, the soft one, the tired one, and the code-switch
   line all have to read as one woman's range, not five different
   deliveries stitched together.
4. **Which one would you want texting/calling you** — the actually-decisive
   question, after the first three have filtered out anything that fails on
   basics.

One honest caveat up front: **every option here is a prebuilt vendor voice,
not a bespoke one built for her.** This comparison finds the best available
starting point, the way `Aoede` (her current voice) was itself once a
starting point — it does not produce a voice grown specifically for Meera.
That would be a different, much larger project.

---

## The deck (same five lines, every voice)

1. *greeting* — "heyyy kya kar rha hai, mai abhi free hui yaar"
2. *tease* — "arre tu phir se late? sochti hu kya karu tera hahaha"
3. *warm* — "hey sab thik hoga na, mai hu na yaha, chill kar thoda"
4. *tired* — "uff aaj itna busy tha, bas ab so jana hai yaar"
5. *code-switch* — "wait tumne wo bug fix kiya ya still deploy pending hai?"

Delivery direction sent to the model is held identical across every voice
("relaxed, natural, casual" mood, same framing sentence `api/speech.js`
already uses) so voice identity is the only thing that changes between files.

---

## Where the candidate list comes from

Gemini TTS exposes 30 prebuilt voices, each with a one-word style tag, per
Google's own docs:

- Full voice list + style tags: [Gemini API — Speech generation](https://ai.google.dev/gemini-api/docs/speech-generation)
- Gender per voice (not labelled on the page above): [Google Cloud — Gemini-TTS voices](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts)

The prebuilt voice set is shared across the Gemini TTS model family — it is
**not separately confirmed by name** for `gemini-3.1-flash-tts-preview`
specifically (the model `api/speech.js` calls); if a voice below gets
rejected by that exact model when the script runs, that itself is worth
noting back here.

`ALLOWED_VOICES` in `api/speech.js` today is `Leda, Kore, Aoede, Zephyr` —
those four are already choosable in the app, so they're not "a completely
new voice" even though they're technically candidates too. This list
deliberately picks five *other* voices, plus `Aoede` (her current voice)
included once, unlabelled, as the fair reference point — an unlabelled
comparison is the only fair one, per the brief.

## Candidates picked, and why

| style tag (Google's word) | why it's here |
|---|---|
| Warm | the one voice Google's own docs describe with that literal word |
| Breezy | **Aoede — her current voice, the reference point** |
| Bright | energetic, reads modern rather than formal |
| Soft | a gentler, quieter register — the other end of the range from Bright |
| Easy-going | documented as suited to friendly/amused delivery — good for the tease line specifically |
| Upbeat | lively, younger-reading |

All six are documented as female voices in Google's Cloud TTS reference.

---

## A → voice mapping

Only look at this after you've listened to all six and formed an opinion.

| file | voice | style tag |
|---|---|---|
| voice-A.wav | **Aoede — her current voice** | Breezy |
| voice-B.wav | Callirrhoe | Easy-going |
| voice-C.wav | Sulafat | Warm |
| voice-D.wav | Laomedeia | Upbeat |
| voice-E.wav | Autonoe | Bright |
| voice-F.wav | Achernar | Soft |

*(This table is generated by the script into `_manifest.json` alongside the
audio — treat the manifest as the source of truth if the two ever disagree,
since the letters here were assigned by hand before a single file existed.)*
