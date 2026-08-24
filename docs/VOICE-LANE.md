# The voice lane — why she says "dash", and why she changes voice

Two reports from the owner, verbatim:

> "saying Dash dash in voice call"
>
> "in the screen sharing everything changing the whole voice etc etc"

They are two different bugs with one shape: **the product has four ways of
making her voice and nothing was written down about how they differ.** This
document is that writing-down, plus the fix for the half of it that could be
fixed safely.

Enforced by `node scripts/verify-voice.mjs` (a gate inside
`scripts/verify-release.mjs`). Cases in `evals/voice/spoken.mjs`.

---

## 1. Four things have to be true, and only one of them was checked

| | property | guarded by | was it true? |
|---|---|---|---|
| **name** | every lane names the same voice | `verify-voice.mjs` §1 (pre-existing) | yes — Aoede on all four |
| **model** | which model actually produces it | `verify-voice.mjs` §2 | **no — three, undeclared** |
| **text** | what the synthesiser is handed | `verify-voice.mjs` §3 | **no — nothing existed** |
| **swap** | how often, and on whose decision, she moves between lanes that sound different | `verify-voice.mjs` §6 | **no — one lane change needed no failure at all** |

The name check passed and the owner still heard her change. That is not the
check failing; it is the check answering a different question. **The same voice
name on a different model is a different voice**, and nothing recorded that
three models were in play.

The fourth row is the one the owner's screen-share report actually turns on, and
it is a different question again: not "is any lane wrong" but "how many times per
call does the product move her, and did anything force it". §6.4 enumerates every
such point; §6.5 removes the one that needed nothing to go wrong.

---

## 2. The dash — where it comes from

### 2.1 It is not incidental style, she is instructed to do it

`src/engine/persona.ts` measured today: **91,766 chars, 307 em-dashes, 5
en-dashes, 14 arrows.** `context/rejected.md` `recited-prompt` is the law that
makes that matter — anything sentence-shaped in her brief gets recited — but
this goes further than recitation. Three separate rules *require* the dash:

- **persona.ts:135** (core, every surface) — "CATCH YOURSELF MID-SENTENCE with
  a dash, now and then: *'he said— no wait, he messaged actually'*". A worked
  example with the em-dash welded to a word: a phrase bank for the dash.
- **persona.ts:346** (`buildSpeechStyle("live")`) — "YOUR SPELLING IS YOUR
  VOICE … a dash where you cut yourself off."
- **persona.ts:376** (both call lanes) — "the mid-sentence dash".

persona.ts:148 does ban the em-dash — **for texting only**, and it explicitly
exempts calls: "(Spoken calls have their own style rules that override these.)"
So on the one surface where the punctuation becomes sound, the ban is lifted
and three rules push the other way. She is doing exactly what she was told.

### 2.2 It generalises past dashes

Anything in her text that is a WRITING convention rather than a SPEAKING one
gets read aloud somewhere in this stack: em-dashes, markdown asterisks and
underscores, bullets, arrows, brackets, pipes, emoji (some engines announce the
Unicode name), URL schemes, and the media tags this repo already uses. The
repo's own precedent is `ack-bracket-direction`: `[laughs softly]` came back as
laughter **plus the spoken word "Softly."** Bracket-shaped text is not inert
anywhere in this system, and neither is any other markup.

There was no point in the codebase where text stopped being TEXT and became
SPEECH. `src/voice/spokenText.ts` is that seam.

---

## 3. The sanitiser — per-class decisions

Applied at the point text becomes speech and **nowhere else**: the same string
is displayed in chat and handed to a synthesiser, and only the spoken copy may
be transformed.

| class | decision | why not the other decision |
|---|---|---|
| **em/en dash, `--`, ` - `** | **replace** with `, ` | It is a *pause*, not noise. Deleting it runs two clauses together breathlessly; keeping it gets "dash". A comma is the pause token every engine here honours. |
| **trailing dash** | **remove** | A cut-off ends where it ends. `…` would be a trail-off, which is a different sound. |
| **hyphen inside a word** | **untouched** | The whole trap. `well-known`, `e-mail`, `T-shirt`, `1800-599-0019`. |
| **`[...]` residue** | **drop whole segment** | Measured: performed as words. Safe only because tags are parsed upstream (§4). |
| **`<...>`, `{...}`** | **drop whole segment** | Machine framing (`direct()` sends `<context: …>`) and template residue. Never spoken content. |
| **`(...)`** | **keep words, brackets → pause** | A parenthetical is an aside a person actually says. Dropping the segment would drop real speech. |
| **markdown `*` `_` `**` backticks** | **remove markers, keep words** | `*shrugs*` is an action the caller already removed; `**sach**` is emphasis on a real word. Deleting the word loses meaning. |
| **underscore between word chars** | **untouched** | `priya_sharma@gmail.com`. "underscore" is what a person actually says there. Only word-edge underscores are markup. |
| **bullets, `#`, `>`, `1.`, `---`** | **remove marker, keep item, join with `, `** | The item is speech, the marker is layout. Ordered before the dash rule so a line-leading `- ` is read as a bullet. |
| **arrows, pipes** | **replace** with `, ` | `→` means "then" or "to" and choosing is a guess; putting a word she never wrote into her mouth is fabrication. A pause invents nothing. |
| **emoji / pictographs** | **drop** | No spoken equivalent to substitute, and her laughter is already written out as "hahaha". |
| **URLs** | **remove scheme and `www.` only, keep the address** | **A safety decision, not a style one.** The crisis-helpline block can carry an address and on a call the spoken copy is the *only* copy — dropping the URL would drop the helpline. `aasra.info` is said fine; `h-t-t-p-s colon slash slash` was the problem. |
| **ellipsis `...` / `…`** | **kept**, runs of 4+ capped | Load-bearing prosody, not markup. persona.ts uses it as her softness and `stripTagsForPlainVoice` deliberately POSTs `…` to this endpoint in place of a tag. |
| **`!!!` / `???`** | **kept** | She writes them; engines use them for prosody. No evidence they are spoken. |
| **HTML entities** | decode to the **character** | `&amp;` → `&`, never → "and". Substituting the word would be text she never wrote. |
| **nothing speakable left** | **return `""`; the caller refuses** | A reply that was only a tag/emoji/separator must be silence. `api/speech.js` answers 422 rather than billing a generation for punctuation. |

### 3.1 The ordering proof — tags first, then this

Rule B (drop a surviving bracket whole) is only safe if every bracket that
*meant* something has already been consumed. That was **verified in source, not
assumed**:

1. `src/engine/brain.ts` `parseReply()` lifts `[tone:]`, `[voicenote:]`,
   `[photo:]`, `[gif:]`, `[followup:]`, `[search:]`, `[forget:]` out of the
   reply into structured fields (brain.ts:212–335). `[forget:]` then performs a
   **real database delete** (brain.ts:1012–1026) and `[tone:]` becomes the
   `style` argument to the TTS request. In `mode === "call"` it additionally
   strips stage directions (brain.ts:1037–1041).
2. `src/voice/speech.ts` `stripForCloud` / `stripForDevice` remove protocol
   residue and emoji (speech.ts:125–152); `stripTagsForPlainVoice` turns a short
   performable tag into a pause (speech.ts:163–173).
3. Only then is text POSTed to `/api/speech`, where the sanitiser runs.

The one caller that skips step 2 — `src/components/VoiceNote.tsx` — posts
`m.spoken`, which is the payload brain.ts already lifted out of a `[voicenote:]`
tag, so step 1 still holds. **Reverse this order and rule B would eat a
`[forget: …]` before it was honoured**, which this repo calls the one
unrecoverable failure.

### 3.2 Where it is installed, and why server-side

In **`api/speech.js`, at the request path**, not in each client. Three callers
reach that endpoint (speech.ts streaming, speech.ts complete-file,
VoiceNote.tsx, plus liveCall.ts's ack prewarm) and only one strips anything
today. A server seam covers all of them, covers every future one by
construction, and **cannot be skipped by an APK that has not updated**.

`src/voice/spokenText.ts` is the source of truth; the core is **mirrored
verbatim** into `api/speech.js` because a Vercel function cannot import
TypeScript (same constraint `scripts/build-engine-bundle.mjs` documents).
`verify-voice.mjs` §3 compares the two regions **character for character** and
fails on any drift — the house MIRROR-then-assert pattern, same as
`OPERATIONAL_CORE_CAP` and `MEERA_AGENT_ID`.

---

## 4. The live lane needs no sanitiser, and must not import one

`grep spokenText src/voice/liveCall.ts` returns nothing. That looks like the
primary voice lane was forgotten. It was not. **Every** path on that lane where
text meets audio:

| path | is it text→speech? | sanitised? |
|---|---|---|
| her own voice — `serverContent.modelTurn.parts[].inlineData.data` | **no** — that field is AUDIO. `gemini-3.1-flash-live-preview` is speech-to-speech; the characters she emits become sound *inside the server* and the client never sees a string. | n/a — **there is nothing to sanitise** |
| her transcript — `outputAudioTranscription` → `onHerText` | no — this is the WRITTEN copy, for the chat log | **must not be** — sanitising it is the exact bug the module exists to avoid |
| `opts.system` (persona) | no — text *into* the model | must not be |
| `direct(contextNote)` — a `clientContent` **user** turn | no — machine framing useCallEngine deliberately writes as `<context: …>` | must not be — sanitising input would strip the framing rule B deletes on the way *out* |
| ack / backchannel clips — `prewarmAckClips` | **yes**, the only one | **yes**, via `/api/speech`, without an import |

So the honest answer is: **the live lane needs nothing on the client.** It also
must not import `spokenText`: liveCall.ts's header records that it deliberately
has no imports beyond `./level` and `../engine/diag` because
`scratchpad/echosim` transpiles it standalone to drive the audio floor, and a
new import breaks the only harness that can prove the floor did not move.

`verify-voice.mjs` §4 asserts all of this — allowed imports, exactly one
`/api/speech` call, no direct TTS provider — so the next person who greps and
finds nothing is told *why* instead of "fixing" it.

**Consequence, stated plainly: the dash cannot be fixed from this lane's
client.** If she says a dash on a live call, the only place to change it is
`persona.ts` (§7).

---

## 5. So where did the owner hear "dash dash"?

Every text→audio path in the product, and its state after this change:

| # | path | engine | sanitised now? |
|---|---|---|---|
| 1 | live call, her voice | Gemini Live (speech-to-speech) | n/a — **persona.ts is the only lever** |
| 2 | native watch engine (Android), her voice | Gemini Live | n/a — same |
| 3 | live call, ack clips | → `/api/speech` | **yes** |
| 4 | cascade call, proxy streaming | → `/api/speech` | **yes** |
| 5 | cascade call, proxy complete-file | → `/api/speech` | **yes** |
| 6 | voice notes | → `/api/speech` | **yes** |
| 7 | ElevenLabs (user key) | `speech.ts elevenFetch` | **yes** — `spokenTextKeepingAudioTags`, the one door that keeps `[laughs]` |
| 8 | Sarvam (user key) | `speech.ts sarvamFetch` | **yes** — via `stripForDevice` |
| 9 | **device TTS** — Capacitor `TextToSpeech.speak` / `speechSynthesis` | `speech.ts speak()` tier 2 | **yes** — via `stripForDevice` |
| 10 | **Android CASCADE watch engine** — `WatchEngine.java`, the lane `WatchCaptureService.startCascade()` falls back to when the live engine is unsupported or gives up | → `/api/speech` | **yes**, at the server seam — and it has no local engine to fall back to |

Ranked hypotheses for the actual report, with what each rests on:

1. **The cascade proxy lane (path 4/5).** Confirmed reachable, confirmed
   unsanitised before this change, and the lane a call falls back to. **Fixed.**
2. **Device TTS (path 9).** The deepest fallback: `speakCall` and
   `createStreamSpeaker` both end with `speak(allText, …)` when every clip fetch
   fails, and `speak()`'s tier 2 hands `stripForDevice(text)` straight to the
   platform engine. `stripForDevice` removes tags and emoji and **does not touch
   dashes**. Platform engines are also the family most likely to read a symbol
   from a dictionary rather than treat it as a pause. Given §6 this path is
   currently *reachable in production*, and "everything changing the whole
   voice" is exactly what a platform voice sounds like. **Fixed — see §10**,
   and the hypothesis in the sentence that used to sit here has now been
   MEASURED against a real platform engine, with a result that does not say
   what this section assumed.
3. **The live lane (path 1/2).** persona.ts's own comment says the native-audio
   model "speaks the characters she emits", so a dash can surface. Only
   persona.ts can fix it. **Not fixed — not my file.**

There was a fourth path, and it is row 10: the Android **cascade** watch engine
(`WatchEngine.java`) is a separate snapshot→think→speak brain from
`LiveWatchEngine.java`, reached by `WatchCaptureService.startCascade()` whenever
the live lane is unsupported or gives up. It happens to be safe — it speaks only
by POSTing to `/api/speech` — but nothing was asserting that, so `verify-voice.mjs`
§5 now does, including that it never gains a local engine. Rows 7–10 are
asserted by running the real code, not by reading it (§10).

---

## 6. The screen-share voice change

### 6.1 It is a lane change, and the lanes are different models

`verify-voice.mjs` §1 proves all four lanes say **Aoede**. §2 now records what
produces it:

| model | lanes | why it differs |
|---|---|---|
| `gemini-3.1-flash-live-preview` | live call; native watch engine | speech-to-speech; the only bidi-audio model that accepts video **and** makes the 600 ms `RELEASE_WATCHDOG_MS` barge-in signal (`live-model-swap`) |
| `gemini-3.1-flash-tts-preview` | cascade TTS, free arm (direct) and paid arm (OpenRouter) | text-to-speech; the only arm that can stream |
| `gemini-2.5-flash-native-audio-latest` | native watch engine's **last-resort default** if `/api/live-token` answers without a model | **measured and rejected** for the live lane (0/24 barge-in, `live-model-bake`). Declared so it is visible, not endorsed. |

The divergence is unavoidable — a call cannot fall back from a speech-to-speech
model to itself — so §2 does not assert equality. It asserts every model is
**declared**, so divergence is a decision someone wrote down. It also asserts
the cascade's two arms name the same model, because they race inside one request
(`PAID_ARM_MS`) and a multi-phrase reply races again per phrase: if they ever
differed, one reply could be spoken half by one voice and half by another.

**Corroboration from the repo's own docs, which I did not have to derive:**
`docs/research/SPEECH-STACK.md` §5.3 already lists "(ii) Aoede on the live lane
differs from Aoede on the TTS lane" as a live, untested reading, and
`prosody-baseline-f0-gap` measured the TTS lane at **median f0 212/214 Hz** —
while the live lane's f0 **has never been measured**. So "same name, same voice"
is not merely unproven across model families; there is a specific measured
reason to doubt it.

### 6.2 Why screen share is where it happens — three mechanisms

**(a) Android: it is not a fallback at all, it is a designed triple-swap.**
Starting screen share runs `claimVoice("native", "watch_started")`
(useCallEngine.ts:1637) — the entire audio path is handed from the JS live
session to `LiveWatchEngine.java`, a *separate* Live session with a *separate*
system prompt (`buildSpeechStyle(engine)` for `system`, `buildSpeechStyle("live")`
for `systemLive`). Stopping it runs `claimVoice("cascade", "watch_stopped")`
(useCallEngine.ts:1810) — it drops to the **cascade**, not back to live. One
screen-share episode therefore produces **live → native → cascade: two engine
changes, one of which crosses model families, with no failure required.** This
alone accounts for "in the screen sharing everything changing the whole voice".

**(b) Web: `goAway` was unhandled, so a routine rotation became permanent.
FIXED — see §6.5.** The Gemini Live server announces an impending hang-up with a
`goAway` message. `LiveWatchEngine.java` has always handled it — `rotate()`, up
to `MAX_ROTATES = 6`, opening a fresh session and **staying on the live model**.
`src/voice/liveCall.ts` did not handle it at all (`grep goAway` → zero hits
before the observability pass, and observability only after it). The close that
followed landed in `onclose` → `teardown("closed")` → useCallEngine answered with
`claimVoice("cascade", …)` — a **permanent** lane change for the rest of the
call, out of an expected and recoverable server event. Continuous video is
exactly what shortens the time to that rotation, which is why it surfaces during
screen share. Both files set `contextWindowCompression: { slidingWindow: {} }`,
which lifts the *context* limit; it does not stop the server rotating a session.

**(c) The paid lane is currently exhausted, so the fallback chain is deeper
than usual.** `one-key-two-jobs` (context/measurements.md, 2026-08-19): the
single `OPENROUTER_KEY` is at **limit 25 · usage 25.021 · remaining −0.0211**,
and six `api/` modules share it. `free-tts-daily` measured the free Google pool
dying — **all nine keys together** — after a few dozen synthesis calls in one
session.

> One refinement to that entry's table, from reading `api/speech.js`: for the
> **TTS cascade** OpenRouter is not the primary — the free Google lane starts
> first and the paid arm only arms at `PAID_ARM_MS = 1500`. So exhaustion
> removes the *backup*. When the free pool then 429s, `/api/speech` has nothing
> and returns 502, and `speakCall` / `createStreamSpeaker` fall through to
> `speak(allText, …)` → **device TTS** (path 9 above). That is a bigger voice
> change than live→cascade and it is unsanitised, which is why §5 ranks it
> second for the dash as well.

### 6.3 What this explains, honestly

| report | explained by | confidence | state |
|---|---|---|---|
| voice changing in screen share, **Android** | (a) the designed triple-swap | **high** — provable from source, no failure needed | **partly fixed.** §6.4 refines it: live → native preserves model, voice and register; **native → cascade at share-stop is the identity change**, and it lives in `useCallEngine.ts` |
| voice changing in screen share, **web** | (b) unhandled `goAway` | **medium-high** — the asymmetry with the Java engine is proven; that video shortens time-to-`goAway` is inference | **fixed** (§6.5). The lane change is gone; the *rate* claim is still inference and §9.1 names the probe |
| voice changing **anywhere, right now** | (c) key exhaustion deepening the chain | **medium-high** — the exhaustion is measured, the reachability is proven from source, the audible result is inferred | not fixed — row 10 of §6.4 |
| "dash dash" | the cascade proxy or device TTS or persona.ts | **medium** — see §5 | see §5 |

Key exhaustion explains **the voice change strongly and the dash partially**: it
makes the unsanitised device tier reachable, but the dash was already emitted on
lanes that were reachable before it.

### 6.4 Every swap point in the product, and which of them changes who she is

Enumerated from source, not from memory. `voiceOwner` in `useCallEngine.ts` is
the slot; `claimVoice` is the only thing that moves it, and
`scripts/verify-voice.mjs` §6g prints the live list of its call sites on every
run so this table cannot silently fall behind the code.

**"Identity changes" means a different MODEL produces her voice.** That is the
property `azure-tts` established as the one that decides whether she is her, and
it is exactly the property the voice-NAME check cannot see. **"Audible
mid-utterance" means the swap can land inside one of her sentences** — every
`claimVoice` to a non-cascade owner calls `stopSpeaking()`, which kills queued
and in-flight audio rather than waiting for a boundary.

| # | trigger | from → to | identity changes? | audible mid-utterance? |
|---|---|---|---|---|
| 1 | live connects at pickup (`live_connected`) | none → live | n/a, first voice | no |
| 2 | live missed the ring window (`live_missed_pickup`) | none → cascade | n/a, first voice | no |
| 3 | live arrives after the cascade adopted the call (`late_upgrade`) | cascade → live | **yes** — TTS → speech-to-speech | **no** — `adoptLiveLate` defers to a turn boundary (not speaking, not thinking, user not mid-utterance) and gives up after ~60s rather than cutting in |
| 4 | live session drops (`live_dropped:closed` / `:failed`) | live → cascade | **yes** — crosses model families | **yes** — `teardown` closes both audio contexts at once |
| 4a | …because the server sent `goAway` | live → cascade | **yes** | **yes** — **FIXED, §6.5: this is now live → live** |
| 5 | screen share STARTS on Android (`watch_started`) | live → native | **no** — see below | **yes** — claimed *before* the consent dialog, killing whatever she was saying |
| 6 | screen share STOPS (`watch_stopped`) | native → cascade | **yes** — crosses model families | at a UI moment, but her in-flight native audio is killed |
| 7 | the OS revokes capture (`watch_stopped_externally`) | native → cascade | **yes** | **yes** — arrives whenever the system decides |
| 8 | capture consent denied (`watch_consent_denied`) | native → cascade | **yes** | no — she has not spoken on native yet |
| 9 | cascade free arm ⇄ paid arm (`PAID_ARM_MS`, per phrase) | cascade → cascade | **no** — §2 asserts both arms name one model | per phrase, but same model and voice; the *delivery direction text* still differs between the arms (§7 "deliberately not done") |
| 10 | `/api/speech` 502s and the chain falls through | cascade → **device TTS** | **yes, the largest** — a platform engine, not her voice at all | **yes** — per phrase |

**Row 5 is the correction this table makes to §6.2(a).** The native watch engine
takes its model from `/api/live-token` — the same `gemini-3.1-flash-live-preview`
the JS live lane uses — names the same voice (`voiceName: "Aoede"`, asserted by
§1), pins the same `languageCode: "hi-IN"` and `thinkingBudget: 0`, and takes
`systemLive`, which is `buildSpeechStyle("live")`: the *same spoken register* as
the JS live lane. So **live → native does not change who she is.** The Android
triple swap is therefore one session change that preserves her identity followed
by one that does not, rather than two of equal weight — and the one that does is
**row 6, stopping the share**, which is the one nothing forced.

Two caveats on row 5, neither of them measured here. `LiveWatchEngine`'s
`DEFAULT_MODEL` is `gemini-2.5-flash-native-audio-latest` — a model this repo
measured and rejected (`live-model-bake`, 0/24 barge-in) — and it is reached if
`/api/live-token` ever answers without a model field. And the two engines tune
their server VAD differently (the JS lane sets nothing for start sensitivity by
measurement; the Java lane keeps the platform default and a 450 ms tail). Both
are behaviour, not timbre.

### 6.5 `goAway` is now a rotation, in both twins

The web lane rotates the socket instead of losing the call: **a fresh session,
the same model, the same voice.** `LiveWatchEngine.java` already did this; the
two are now pinned to each other by `scripts/verify-voice.mjs` §6, which asserts
the constants **and the policy** agree across the TS and the Java. That is
`blank-guard-parity`'s shape — a test that pins two implementations AGREEING
never needs editing and catches the only failure that matters, which is
divergence. Both twins were changed together; neither was "fixed independently".

| property | value | why it is what it is |
|---|---|---|
| `MAX_ROTATES` | 6 | a `goAway` storm must not spin the token endpoint. Spent → the next close falls back to the cascade exactly as it did before, and `live_rotate_spent` records that it was a budget and not a bug |
| `ROTATE_DELAY_MS` | 500 | old socket closed → new one opened |
| `ROTATE_GRACE_MS` | 1200 | a rotation that arrives after the server has already hung up gives back everything the wait bought |
| `ROTATE_WAIT_MAX_MS` | 4000 | the longest the rotation waits for her to finish a sentence |
| `ROTATE_POLL_MS` | 120 | how often "is she still speaking" is re-asked |

**The moment is chosen, not taken.** `rotate()` flushes playback, so firing it
the instant `goAway` lands trades a lane change for a guillotine. `goAway`
carries the server's own notice period, so there is a budget to spend waiting:
the rotation is held until `speakingUntil` has passed, capped at
`ROTATE_WAIT_MAX_MS` and never allowed past `timeLeft − ROTATE_GRACE_MS`. The
Java twin now waits on the same rule; it used to rotate immediately.

**The model is pinned for the life of the call.** A rotation mints a fresh
single-use token and `/api/live-token` returns a model with it — and both twins
now **discard** that model and keep the one the call started on. Taking it would
let a token-endpoint change swap model families mid-call, which is the exact bug
this mechanism exists to prevent, arriving through a door §1 and §2 cannot see.
The Java twin previously adopted the new model on every reconnect.

**A bug found while wiring it.** The observability-only version parsed
`goAway.timeLeft` by stripping the unit suffix and using the number as
milliseconds. It is a protobuf `Duration` — a string of **seconds** — so a real
10-second notice period was being recorded as `leftMs: 10`. Harmless while
nothing read it; not harmless once it decides how long a rotation may wait. Both
twins now convert seconds → ms, and the rotation simulator's first case fails if
that conversion is removed.

**What a rotation still costs, and it is not fixed.** The new session is a *new
session* and contains none of the conversation. Nothing is injected to recap it:
an unprompted turn arriving out of a socket swap is a worse failure than a lost
context window, and the recap would have to come from `useCallEngine.ts`, which
owns the transcript and is not this workstream's file. `contextWindowCompression:
{ slidingWindow: {} }` means the server was already dropping the oldest context
on its own. Proposed as a follow-up, not claimed as done.

---

## 7. Implemented vs recommended

### Implemented

1. **`src/voice/spokenText.ts`** — the sanitiser, dependency-free, side-effect
   free, mirrored into `api/speech.js`.
2. **`api/speech.js`** — the seam at the request path; `spoken` is the only
   string past that line. 422 when nothing speakable survives. New response
   headers `X-Meera-Model`, `X-Meera-Voice`, `X-Meera-Rules` alongside the
   existing `X-Meera-Lane` / `X-Meera-Pool`, so a production timbre complaint can
   name what produced it instead of staying unattributable — which is exactly how
   the Leda/Aoede incident stayed open.
3. **`scripts/verify-voice.mjs`** — §2 model registry, §3 mirror + battery, §4
   live-lane path assertions, on top of the pre-existing §1 name check.
4. **`evals/voice/spoken.mjs`** — 37 positive + 17 negative + idempotence.
5. **`src/voice/liveCall.ts` — observability only.** A `goAway` branch that
   `diag()`s and returns, a `live_close` record carrying the close code,
   `goAwayMs`, uptime and `framesSent` (the only client-side evidence that a
   screen share was up when a session ended), and one `framesSent++` in
   `sendFrame`. **Nothing reads these in the audio path.** Proof in §8.
   *(Superseded by 6 below: the branch now rotates rather than only recording.)*
6. **`goAway` is answered with a rotation, in both twins** — §6.5.
   `src/voice/liveCall.ts` gains `wsGen`/`sockReady` generation guards, a
   `flushPlayback()`, a budgeted `rotate()`/`reconnect()`, a `scheduleRotate()`
   that waits for a non-speaking moment inside the server's own notice period,
   and the mic tick's `sockSeen !== wsGen` arbitration reset that
   `LiveWatchEngine.java` already had and this twin did not.
   `LiveWatchEngine.java` gains the same wait, the same constants, and the model
   pin. New diag records: `live_goaway` (now with `sharing`, `rotates`,
   `budget`, `speaking`), `live_rotate`, `live_rotated`, `live_rotate_failed`,
   `live_rotate_spent`.
7. **`scripts/verify-voice.mjs` §6** — the TS ⇄ Java parity assertion for all of
   the above, negative-tested by reproducing the swap it prevents.

### Recommended, not implemented — with the reason for each

- **Recap the conversation after a rotation.** The new live session starts
  empty. `adoptLiveLate` already has the shape (a `<context: …>` turn listing the
  last six lines), but the transcript lives in `useCallEngine.ts`, not in the
  live lane, and injecting an unprompted turn out of a socket swap is a worse
  artefact than the missing context. **Needs its owner.**
- **`claimVoice("cascade", "watch_stopped")` should try to return to LIVE.**
  Row 6 of the §6.4 table: stopping a screen share is a guaranteed cross-family
  voice change that nothing forced, and it is now the **largest remaining swap in
  the product**. `useCallEngine.ts`, not this workstream's file.
- **`sessionResumption: {}` in the setup block.** The protocol-level answer to
  `goAway`. Not added: this setup block is where `enableAffectiveDialog` closed
  the socket with 1007 "Unknown name", and an untested field here costs the call.
  Verify against a live endpoint before adding.
- ~~**`src/voice/speech.ts` should import `spokenText`**~~ — **done, §10.** It
  was one import and two call sites, and it was also two other things nobody
  predicted: `stripProtocol` was deleting her words between two `**bold**` spans,
  and `phrase()` was cutting an utterance at every full stop including the ones
  inside `meera-silk.vercel.app`. Both found by running the code rather than
  reading it.
- **Pin the lane for a whole reply.** `api/speech.js` already returns
  `X-Meera-Lane`; `speech.ts` could read it and keep subsequent phrases on the
  same arm, so one reply is never split across two renderings. Requires a client
  change; the server is stateless per request and cannot do it alone.
- **persona.ts: reconcile the dash.** Three rules require it (§2.1) on the one
  surface where it becomes sound. Either drop the dash from the call-lane rules
  and let `"..."` carry the self-interruption, or accept it and know the live
  lane will keep producing it. **Do not do this by editing the ban at line 148**
  — it is scoped to texting on purpose. `evals/persona-invariants.mjs` must stay
  green either way.

### Deliberately not done

- No change to any floor constant, threshold, ring size, watchdog or timing.
- No change to the delivery-direction prompts in `api/speech.js`. The free and
  paid arms use *different* direction text, which is a real second-order timbre
  difference — but "direction length adds real latency (~0.6 s measured)" and the
  effect of rewording is unmeasurable from here. Unifying them is a change to how
  she sounds and should be made with an ear, not by a sanitiser ticket.
- No edits to `persona.ts`, `brain.ts`, `speech.ts`, `useCallEngine.ts`,
  `components/**` or `android/**`.

> **Amended by the goAway pass (§6.5).** The last two bullets still hold for
> `persona.ts`, `brain.ts`, `speech.ts`, `useCallEngine.ts` and `components/**`,
> and no floor constant, threshold, ring size, watchdog or timing moved — proven
> rather than asserted, in §8.2. **`android/**` IS now edited**, because the
> `goAway` fix is a parity fix and fixing one twin of a mirrored pair is the
> failure `blank-guard-parity` exists to prevent.

---

## 8. Gates

| gate | result |
|---|---|
| `node evals/voice/spoken.mjs` | **37 positive + 17 negative, 54/54 idempotent, 0 failures** |
| `node scripts/verify-voice.mjs` | **pass** — one name (Aoede), 3 declared models, one spoken-text core, 1 live text→audio path, goAway rotation at parity (§6, 11 assertions) |
| `node scripts/verify-release.mjs` | **8/8** — typecheck, prompt budget, workflow lint, one voice, web build, eval suite, zero-orphan sweep, citation discipline |
| `./gradlew --offline :app:compileDebugJavaWithJavac` | **clean** — the Java twin compiles; it was NOT run |
| `node scratchpad/echosim/rotatesim.mjs` | **26/26** — rotation keeps the model, the voice and the call |
| `npx tsc --noEmit` / `tsc -b` | **clean** |

### 8.1 The guards were tested by breaking them

- Making the dash rule greedy in `spokenText.ts` (`/-+/` instead of `/ +- +/`)
  turned **9 of 54** cases red, including *"a hyphenated helpline number survives
  untouched"*. The negative controls do their job.
- Changing one character of the mirrored core in `api/speech.js` produced
  `the spoken-text core has DRIFTED … first difference at line 89`, with both
  versions of the line printed.
- Adding `import { spokenText } from "./spokenText"` to `liveCall.ts` produced
  the §4 failure with the explanation of why the live lane needs nothing.

**The §6 parity assertions, broken one at a time** — four separate runs, each
reverting exactly one half of the fix and each restored afterwards:

| what was broken | what §6 said |
|---|---|
| `scheduleRotate(leftMs)` removed from `liveCall.ts` (i.e. the shipped bug, restored) | `goAway is not answered with a rotation in src/voice/liveCall.ts` |
| `scheduleRotate(leftMs)` removed from `LiveWatchEngine.java` | the same failure, naming the **Java** file — so the test cannot be satisfied by fixing one twin |
| `MAX_ROTATES` set to 4 in the Java only | `MAX_ROTATES disagrees: 6 in src/voice/liveCall.ts, 4 in …LiveWatchEngine.java` |
| the Java `firstConnect` model pin removed | `the live model is not pinned across a rotation in …LiveWatchEngine.java` |
| the `if (stale()) return;` removed from the TS `onclose` | `a replaced socket's close is not guarded in src/voice/liveCall.ts` |

### 8.1a The rotation itself was tested by reproducing the swap

`scratchpad/echosim/rotatesim.mjs` drives the **real** `liveCall.ts` — the same
transpile `exp1.mjs` uses — against a simulated Live server that sends `goAway`.
26 assertions across 5 scenarios, all observed from OUTSIDE the module (sockets
constructed, setup frames sent, `onEnded` calls), so none of it is the module
agreeing with itself: a rotation waits while she is mid-sentence and then takes
it; the wait is capped when she never stops; a short `timeLeft` rotates at once;
a replaced socket's close does **not** end the call while a live one still does;
and the budget stops at exactly 6.

Negative-controlled twice, by patching the transpiled build rather than the
source:

- **`goAway` left unhandled** (the state that shipped): **14 of 26 red**,
  including the two that name the bug directly — `a replacement socket was
  opened … sockets=1` and `a stale close did not end the call …
  onEnded=["closed"]`. That second line is the owner's report, reproduced: a
  routine server rotation handing the call to the cascade.
- **`timeLeft` read as milliseconds instead of seconds** (the parse bug §6.5
  describes): `no rotation while she is mid-utterance … sockets=2` — the
  rotation stops waiting and fires inside her sentence.

### 8.2 The audio floor did not move — measured, not asserted

`scratchpad/echosim/exp1.mjs` drives the **real** `liveCall.ts` through a
simulated room: 5 couplings (−3/−6/−9/−12/−18 dB) × 8 seeds × 2 arms = **80
simulated calls**, reporting self-release, self-duck %, leak ms, hard/soft claim
margins and barge-in.

Run against `git show HEAD:src/voice/liveCall.ts` (before) and the current file
(after). The two result sets are **byte-identical**:

```
couplingDb  selfRelease  selfDuckPct  leakMsMed  leakMsMax  hardMax  softMax  bargeIn  bargeMsMed
   -3          1/8           68         1877       2389     26/26    39/52     8/8       840
   -6          0/8           24          853       1109     20/26    29/52     8/8       840
   -9          0/8           10          427        768     12/26    21/52     8/8       840
  -12          0/8            2          171        256     10/26    12/52     8/8       840
  -18          0/8            0            0        256      6/26    10/52     8/8       840
```

`diff` before/after: no differences. Which is what a diagnostics-only change
should produce, and is now on the record rather than claimed.

**Re-run for the goAway rotation, which is NOT a diagnostics-only change.** Same
harness, same 5 couplings × 8 seeds × 2 arms = **80 simulated calls**, run
against the tree before the rotation work and the tree after it. The two result
sets are again **byte-identical** — the table above, unchanged in every cell.

That is a stronger claim than it looks, because this change does touch the mic
tick: it adds the `sockSeen !== wsGen` arbitration reset the Java twin already
had. The reset is a no-op until a rotation happens, `exp1.mjs` never rotates, and
the identical numbers are what proves the no-op rather than assuming it.

---

## 9. What could not be verified here

Named so nobody reads coverage into this document that it does not have.

- **Whether Aoede-on-live and Aoede-on-TTS actually sound different.** This is
  the load-bearing claim of §6.1 and it is *reasoned*, not measured. It needs the
  D6 ear test `SPEECH-STACK.md` §5.3 already asks for, plus an f0 measurement of
  the **live** lane — which needs a working key and a real session.
- **Whether a device TTS engine literally says "dash".** §5's second hypothesis.
  Needs a phone (Android `TextToSpeech`) and a desktop browser
  (`speechSynthesis`); both are one-line tests once someone has the hardware.
- **Whether screen share raises the `goAway` rate.** The *asymmetry* between the
  Java and TS handling is proven from source; the *rate* is inference. The new
  `live_goaway` / `live_close` diag records are precisely what answers it — read
  `sharing` and `upMs` off a week of production telemetry.
- **Everything downstream of a billed key.** No live probe was run: the
  OpenRouter key is exhausted (§6.2c) and the free pool is what production is
  currently leaning on. `verify-release.mjs --live` was not run and would cost
  money that is not there.
- **The Android lane end to end.** `LiveWatchEngine.java` compiles
  (`./gradlew --offline :app:compileDebugJavaWithJavac`, clean) and was read. It
  was **not run**: there is no device and no emulator in this environment, and
  simulating one would not be evidence.

### 9.1 What the `goAway` rotation still needs a real device or a live session for

Nothing below was simulated and called verified. Each is named with the exact
production record that settles it.

| open question | why it cannot be answered here | the probe that settles it |
|---|---|---|
| Does a rotation actually keep the call alive against the real server? | needs a live Gemini Live session and a real `goAway` | `live_rotated` — count it against `live_rotate`. Every `live_rotate` with no matching `live_rotated` inside ~3 s is a rotation that failed to come back up |
| Does a rotation cost an audible gap, and how long? | the same | `live_rotated.gapMs` — `goAway` → new `setupComplete`, wall clock. Read its p50/p90 against `ROTATE_WAIT_MAX_MS` |
| Does screen share raise the `goAway` rate, as §6.2(b) infers? | needs a device sharing a screen on a real session | `live_goaway.sharing` (true when any frame entered the socket) split against `live_goaway.upMs` — the rate per minute of uptime, shared vs not |
| Does the server give usable notice, or is `timeLeft` usually absent? | the same | `live_goaway.leftMs` — now in **milliseconds** and correct (§6.5). `leftMs: 0` means no notice was given; the distribution decides whether `ROTATE_GRACE_MS` is the right number |
| Does the wait for a quiet moment ever run out? | the same | `live_goaway.speaking` (was she talking when it arrived) against `live_rotate.waitedMs`. `waitedMs ≈ ROTATE_WAIT_MAX_MS` means the cap bound, i.e. the rotation still landed inside a sentence |
| Is `MAX_ROTATES = 6` enough for a long shared call? | the same | `live_rotate_spent` — every occurrence is a call that then fell to the cascade because a budget ran out. Non-zero at any real rate means raise it |
| Does the rotated session's loss of conversation show? | needs an ear on a real call | not a telemetry question. It is the ear test §6.5's last paragraph asks for |
| Does the Android triple swap sound like one voice on rows 1→5 (§6.4)? | needs a device and an ear | `azure-tts`'s rule: accent identity is not pronunciation, and it is decided by listening. Record both sides of a `watch_started` and compare |

---

## 10. The paths that never reach `/api/speech` — closed, and measured

§5 rows 7–10, added by WS-DEVICE-TTS. §3.2 put the seam in `api/speech.js`
because a server seam "covers every future caller by construction". That is true
of every caller that **is** a caller of it, and three engines in
`src/voice/speech.ts` are not: `elevenFetch` and `sarvamFetch` POST to a vendor
with the user's own key, and the device tier speaks locally. No server can stand
in front of those.

### 10.1 What changed

One import, and the same rules everywhere:

| door | sanitiser | why that one |
|---|---|---|
| device TTS (Capacitor / `speechSynthesis`) | `spokenText`, inside `stripForDevice` | the deepest fallback; `stripForDevice` already ran here, and the sanitiser is now its LAST step so a `[tag]` still becomes the "…" pause before rule B could drop it |
| Sarvam | `spokenText`, same call site | `sarvamFetch` is handed `stripForDevice(text)` already |
| ElevenLabs v3 | `spokenTextKeepingAudioTags`, inside `stripForCloud` | **the one engine that PERFORMS `[laughs]`**, and `speech.ts` routes tagged replies to it deliberately. The plain sanitiser would have deleted the exact thing the routing chose it for |
| hosted proxy | `spokenText` server-side, unchanged, plus the above | belt and braces; the core is idempotent (63/63) so passing it twice is free |

`spokenTextKeepingAudioTags` is **not a second rule set**. It cuts the tags out,
runs every remaining segment through the same `spokenTextCore`, and puts the
tags back. `age-tier-never-realtime` is the entry that makes that distinction
non-negotiable: a second copy of a rule set diverges by not being updated, and
nobody notices because nobody calls the copy a copy.

Two defects fell out of running the code rather than reading it, and both were
older than this workstream:

- **`stripProtocol` deleted her words between two `**bold**` spans.** The
  roleplay-action rule `\*[^*\n]{1,80}\*` matched the SECOND star of one bold
  span and the FIRST of the next. Measured: `"yeh **sach** mein hua"` came out
  as `"yeh * * mein hua"` — it deleted the word she was *emphasising*, and left
  two asterisks that espeak-ng reads aloud. `"**a** aur **b** dono"` lost 4 of
  its 5 words. It reached **every** lane, the proxy included, because
  `stripForCloud` runs before the POST. Fixed with lookarounds that tell a
  single-star action from a double-star emphasis.
- **`phrase()` cut an utterance at every full stop**, including the ones inside
  an address: a device voice said "dekh meera-silk." *(pause 280–520 ms)*
  "vercel." *(pause)* "app/chat pe hai", and "3.30 baje" became "three."
  "thirty baje". That is not only untidy — rule C keeps URLs *because the
  crisis-helpline block can carry one and on a call the spoken copy is the only
  copy*, and an address shattered across three utterances is most of the way to
  losing it. A full stop now ends a phrase only when whitespace or the end of
  the text follows it.

### 10.2 The gate is behavioural, not a grep

`evals/voice/device.mjs` bundles the **real** `src/voice/speech.ts` with
recorders in place of the platform engines and `fetch`, drives the **real**
entry points (`speakCall`, `speak`, `createStreamSpeaker`) under the exact
production failure of §6.2(c) — every clip fetch refusing — and asserts on the
strings the engines were handed. 42 assertions across 5 doors.

That shape is `selfbundle-never-set`'s rule applied to speech: *a slot is wired
when a real prompt contains its bytes*, so a door is sanitised when the engine
was handed clean text, never when a manifest says so.

It carries the two controls that decide whether a sanitiser is safe:

- **`mustSay`** — her own words must arrive. A sanitiser that returned `""` for
  everything would pass every markup assertion in the file. This is the control
  that caught the `**bold**` deletion.
- **the crisis helpline** — `1800-599-0019` must reach the device engine with
  its hyphens intact. Reintroducing a greedy dash rule turns it into
  "Kiran, 1800, 599, 0019" and the harness says so.

`verify-voice.mjs` §5 also runs a **door census**: every text→audio door in
`speech.ts` is enumerated from source and compared against a declared list, so a
new engine fails the run until somebody declares it and gives it a case here.
`screen-share-triple-swap` found a third path family nobody had counted and the
continuity workstream found a third prompt assembler after the spec said two —
this is the assumption "there is one more" turned into a check.

### 10.3 Whether an engine SAYS the markup — measured, n=12

The claim this workstream was handed is that a platform engine "reads a symbol
out of a dictionary rather than pausing". §9 listed it as unverified. It is now
measured for **one** engine: **espeak-ng 1.51**, extracted into the session
scratchpad, driven with the strings the real device tier produced before and
after the change, phonemised with `-q -x`, and searched for the phonemisations
of eighteen symbol words — which espeak itself supplied, so nothing is
hand-transcribed.

| symbol | what espeak-ng 1.51 does with it, en-us default |
|---|---|
| em-dash `—`, en-dash `–`, `--` | **a pause. It does NOT say "dash".** Same in en-gb, en-in and hi |
| `→` | **says "right arrow"** |
| `**` | **says "asterisk asterisk"** (a lone `*` is silent) |
| `&amp;` | **says "amp"** |
| `https://` | says "colon", and "slash" per slash |
| **a hyphen inside a number** — `1800-599-0019` | **says "dash" TWICE** |
| `•`, `\|`, `(`, `)` | pauses |

Totals across the 12 utterances: symbol words spoken **before 5, across 4 of 12
utterances; after 2, across 2 of 12**. The two that remain are a spoken "slash"
inside a real URL path and the helpline's two "dash"es — both things a person
saying that address or that number out loud would also say.

**This does not confirm the assumption; it partly contradicts it, and the
contradiction is the useful part.** On the engine actually measured, the
em-dash — the character three of persona.ts's rules ask her for — is a pause,
not a word. The one place it says **"dash dash"**, literally and in its default
configuration, is a **hyphenated phone number**, and the number in question is
the crisis helpline this repo deliberately preserves (`spoken.mjs` has it as a
negative control). Whether that should change is an ear decision with a cost on
both sides, and it belongs to whoever owns the helpline block — not to a
sanitiser ticket.

There is a second configuration that does say it: with `--punct`, the
punctuation-announcing accessibility mode, espeak renders `—` as "EMDASH". In
that mode it renders a comma as "comma" too, so the sanitiser cannot help — the
only cure would be removing punctuation, which would remove her prosody with it.

**Scope, stated so nobody reads coverage into this:** espeak-ng is not Android's
Google TTS and not Chrome's `speechSynthesis`, which are the two engines the app
actually reaches. This is evidence about the family and a disproof of "every
platform engine says dash", not a measurement of the shipped path. The Gemini
TTS and Gemini Live lanes are LLM-based and could verbalise a symbol for reasons
no phoneme table predicts; measuring them costs keys that are currently spent.

### 10.4 The dash's real home is still `persona.ts`

Unchanged by any of this, and worth repeating because §10.3 narrows it:
`persona.ts` is **91,766 chars with 307 em-dashes**, three of its rules *require*
the dash, and the ban at line 148 is scoped to texting and **explicitly lifted
for calls** — the one surface where the character becomes sound. The live lane
is speech-to-speech, so no sanitiser can stand between her tokens and the audio.
If the owner still hears "dash dash" after this ships, the live lane is where it
is coming from and `persona.ts` §7 is the only lever. Not this workstream's file.

---

# 11. The recurrence — "when we shift to different modes her voice is changing" (2026-08-24, WS-ONEVOICE)

The owner reported the same defect again, three days after the 2026-08-21
Aoede → Autonoe switch. `verify-release`'s "one voice" gate was **green**, and
it was green *correctly*: the four lanes it checked did agree. The defect was
outside its fence, in three places at once.

## 11.1 The complete mode × engine × identity table, as found

Enumerated from source. §6.4's table enumerated `claimVoice` — the lane slot in
`useCallEngine.ts`. This one enumerates **who actually synthesises the bytes**,
which is a different question, and it is the question the report is about.

*"Her voice"* means the Gemini prebuilt `Autonoe`. A user key is a Settings
value; the defaults in `store.ts` are `""`, so a fresh install hits only the
rows marked *zero-config*.

| mode | engine | identity heard | her voice? |
|---|---|---|---|
| chat voice note (`VoiceNote.tsx` → `/api/speech`) | `gemini-3.1-flash-tts-preview` | Autonoe | yes — *zero-config, and unaffected by user keys* |
| live call (`liveCall.ts`) | `gemini-3.1-flash-live-preview` | Autonoe | yes — *zero-config* |
| ack / backchannel **during** a live call (`liveCall.ts` → `/api/speech`) | `gemini-3.1-flash-tts-preview` | Autonoe | yes — *zero-config* |
| live call during screen share, Android (`LiveWatchEngine.java`) | live model from `/api/live-token` | Autonoe | yes — *zero-config* |
| watch-mode cascade commentary (`WatchEngine.java` → `/api/speech`) | `gemini-3.1-flash-tts-preview` | Autonoe | yes — *zero-config* |
| **incoming-ring pickup line** (`loadPickup`) | **whatever `pickEngine` picks** | **Autonoe / priya / an ElevenLabs id — or a clip cached under a PREVIOUS voice** | **no** |
| **cascade fallback mid-call** (`speakCall`, `createStreamSpeaker`) | **Sarvam `bulbul:v3` if a key exists, else ElevenLabs `eleven_v3`, else Gemini TTS** | **priya / an ElevenLabs id / Autonoe** | **no** |
| **backchannels on the cascade** (`prefetchBackchannels`) | same as above | same as above | **no** |
| offline / all-cloud-failed, **including mid-call** | platform `TextToSpeech` / `speechSynthesis` | the device's own voice | **no** |

**Every transition, and which engine hands off to which:** the six *zero-config*
rows are all `Autonoe`, so on an unkeyed install every mode shift is
Gemini-Live → Gemini-TTS or the reverse — one name, two model families (§6.1,
and now measured in §11.3). The three bold rows are where the **name itself**
changes, and all three live in `src/voice/speech.ts`, which §7's "deliberately
not done" list had excluded from the previous pass.

## 11.2 The five divergences, with evidence

**D1 — two whole vendors were outside the fence.** `speech.ts` speaks her
through Sarvam (`SARVAM_SPEAKER = "priya"`, `bulbul:v3`) or ElevenLabs
(`ELEVEN_DEFAULT_VOICE`, `eleven_v3`) whenever the user has set a key — on the
call cascade, the pickup line and the backchannels. The live lane, the native
watch engine and her chat voice notes have no such option and stay on Autonoe.
So a keyed install hears **one woman on a live call and a different one the
instant it falls back**, and not one character of that is visible to a check
that reads Gemini prebuilt voice names. `verify-voice.mjs` read neither literal.

**D2 — the engine was chosen PER PHRASE.** `fetchClipFor` computed
`preferEleven = elevenKey && (hasAudioTags(text) || !sarvamKey)` — and
`hasAudioTags` is a property of the **phrase**, while `speakCall` and
`createStreamSpeaker` call it once per phrase. With both keys set, a reply whose
second sentence carried `[laughs]` was fetched from ElevenLabs while its first
came from Sarvam: two vendors, one sentence apart, inside one answer.
`usesProxyVoice(phrases[0], opts)` had the same shape. §2 of the gate already
asserts exactly this cannot happen one level down — the cascade's two arms must
name one model *"because a multi-phrase reply races again per phrase"* — and
nothing asserted it one level up, where the candidates are not even the same
company.

**D3 — the clip caches were not keyed on the voice, and this is the recurrence
mechanism.** Three permanent IndexedDB caches: `bc1:<text>:<style>`,
`pk1:<text>:<style>` and `vn1:<msgId>`. Text, style and id — never the voice,
never the engine. Her voice moved Aoede → Autonoe on 2026-08-21, four lanes
moved together, the gate went green, **and the audio did not move.** Every
install that had made one call before that date kept serving **Aoede** pickup
lines and backchannels out of the cache — the pickup clip is the *first sound of
a call* — and then went Autonoe the moment the live session connected. That is
the owner's sentence, with the "mode shift" being nothing more exotic than the
call starting. `liveCall.ts` is the lane that got this right and always had:
its ack cache is `${ACK_CACHE_V}:${ACK_VOICE}:${text}`.

**D4 — the drift alarm was watching the wrong voice.**
`scripts/prosody-baseline.mjs` — SPEC §9.5's "unconsented-vendor-swap detector",
the one job in the repo whose entire purpose is noticing her voice change under
an unchanged model string — had `TTS_VOICE = "Aoede"`, and had had it since
2026-08-21. It could not have alarmed on the real voice, and it would not have
alarmed on this one either, because its stored baseline was recorded in the same
wrong voice. A green check about the wrong bytes: `gates-that-live-nowhere` in a
new costume.

**D5 — device TTS is audible MID-CALL, not only offline.** `speakCall` ends
`if (!started) return speak(text, ...)` and `createStreamSpeaker`'s tail does
`void speak(allText, ...)`; both re-enter `speak()`, whose tier 2 is the
platform engine. §6.4 row 10 has this and it is unchanged — it is the largest
identity change in the product and it is reachable in the middle of a live call
whose cloud attempts all returned nothing. **Not fixed, deliberately:** the
alternative to a wrong voice here is silence, which is worse. It is now
*declared* (§7a of the gate) so its absence from the name check cannot be
mistaken for its absence from the product.

## 11.3 The open measurement, closed: Autonoe-on-live vs Autonoe-on-TTS

§9 named this the load-bearing **unmeasured** claim of §6.1 — *"the live lane's
f0 has never been measured"*. It has now been measured. Both arms were driven
with the shipped setup blocks and the **same three Hinglish lines**, the live arm
under a diagnostic read-aloud instruction so the text is identical across arms.
**6 pool calls, n=3 per arm.**

| | median f0 | p10–p90 f0 | spectral centroid | spectral tilt (2–6k vs <1k) | duration |
|---|---|---|---|---|---|
| cascade TTS `gemini-3.1-flash-tts-preview` | **222 Hz** | 169–381 | 1358 Hz | **−13.0 dB** | 3.68 s |
| live `gemini-3.1-flash-live-preview` | **218 Hz** | 161–348 | 1413 Hz | **−8.5 dB** | 2.44 s |
| delta (live − tts) | −4 Hz (**−0.32 semitones**) | | +55 Hz | **+4.4 dB** | −1.24 s |

**Pitch is not the difference.** −0.32 semitones is far inside the per-line
spread of the TTS arm alone (186–250 Hz across three lines). The hypothesis that
the two engines render the same name at different pitches is **not supported**.

**Brightness may be, and is not established at this n.** The live arm is
consistently brighter and tighter (tilt −7.6 / −8.5 / −8.7 dB) where the TTS arm
swings wildly (−6.5 / −16.6 / −13.0 dB). The **between-arm** delta of 4.4 dB is
**smaller than the within-TTS-arm spread of 10.1 dB**, so the honest reading is:
*the cascade lane is not consistent with itself line to line*, which is a finding
in its own right, and a cross-engine timbre claim needs more than n=3.

**Duration is confounded and must not be quoted as production.** The live arm
was reading a fixed string under a diagnostic instruction; production live
improvises under `persona.ts`'s spoken register. Pace is exactly the axis that
instruction moves. The number is recorded, not relied on.

**What this changes.** §6.1's "same name, different model, therefore a different
voice" is *weaker* than it read. The two lanes are close on the one axis this
repo anchors on. The remaining candidate for the audible difference is
brightness and consistency, not pitch — and `voice-ears` is the standing rule
that this is an ear question anyway.

## 11.4 What changed, and the one-line switch

- **`src/voice/speech.ts`** — a `WHO IS SPEAKING` block: `MEERA_VOICE`
  (the client-side mirror), `pickEngine()` (**one engine per utterance**, D2),
  `engineTag()` / `PROXY_VOICE_TAG` (**identity in every cache key**, D3).
  `fetchClipFor`, `hedgedClipFor` and `usesProxyVoice` now take the *decided*
  engine instead of re-deriving one from the phrase in hand; `speak`, `speakCall`,
  `prewarmSpeech` and `createStreamSpeaker` each decide once. The stream lane
  latches on its first phrase, because it cannot see a reply it has not received.
- **`src/components/VoiceNote.tsx`** — `vn1:` keys carry `PROXY_VOICE_TAG`.
- **`scripts/prosody-baseline.mjs`** — `TTS_VOICE` is Autonoe (D4), it is now a
  §1 site so it can never drift alone again, and a **voice change alarms** rather
  than silently comparing two different women against one baseline.
- **`scripts/verify-voice.mjs`** — two new sites in §1 (six lanes now), a new
  **§7**, and the switch.

**The switch, which is the deliverable:**

```
node scripts/verify-voice.mjs --set Leda
```

moves **all six lanes at once** — `api/speech.js`, both `liveCall.ts` literals,
`speech.ts`, `prosody-baseline.mjs` and `LiveWatchEngine.java` — widens
`ALLOWED_VOICES` additively, and then runs the full verification on the result,
so the switch and its proof are one command. It refuses any name not on the
**live-lane-verified** list, because a name the realtime model rejects is a call
that never connects rather than a wrong timbre.

Verified end to end: `--set Leda` moved six sites and the gate reported *"one
name: Leda on all 6 lanes"*; `--set Autonoe` returned all five files
**byte-identical** to their pre-switch state, the Java included.

There is no import that could replace this — the lanes are a serverless
function, a browser module forbidden to import anything (the echosim law), a
Java file and a Node job. The house pattern is *mirror, then assert*; what was
missing was that the mirrors had **no writer**, and a mirror set edited by hand
is a mirror set edited incompletely. That is not a worry, it is the incident:
`api/speech.js`'s header already asked the next person to move the lanes
together, and the 2026-08-21 switch moved four of six.

**Cached clips need no purge.** The identity is *in the key*, so switching the
voice strands the old audio automatically. No revision counter, so none to forget.

## 11.5 §7 of the gate, and why each half exists

**7a — every audible engine is declared.** Sarvam, ElevenLabs and device TTS are
each listed with what they govern and **whether they are her** (none are). An
undeclared engine fails the run — the same contract §2 uses for models. It does
not *forbid* them: reachability is a user setting, and a gate cannot un-set it.

**7b — every persistent clip cache key names the identity that produced it.**
This is the half that makes the *class* impossible rather than this instance.

**Both were negative-tested, and 7b failed its own first negative test**, which
is the only reason it works. Its first version matched cache keys written inline
and reported *"all 2 keys ok"* — silently ignoring the three built as
`const key = …`, including the pickup clip, the one the bug is actually heard
through. Resolving identifiers then produced a *second* failure of the same
family: two caches in the file both name their key `key`, and a whole-file
lookup resolved both to the first binding, so the pickup key could lose its tag
entirely and the check still passed. It resolves the **nearest binding above the
call site** now. A third pass found it counting the two *function declarations*
as call sites, turning the gate red on a clean tree.

Three bugs in one 20-line check, every one of them in the direction of passing.
That is `sound-gate-proved-by-silence` and `manifest-sourcestatus` in one place:
a check that examines a subset it does not name is green by construction.

**The full negative battery — nine breaks, nine failures, exit 1 on each:**

| break | caught by |
|---|---|
| `speech.ts` mirror set to `Kore` | §1 — *voice disagrees across lanes* |
| `prosody-baseline.mjs` set back to `Aoede` | §1 — the D4 defect itself |
| pickup key loses its tag | §7b |
| backchannel key loses its tag | §7b |
| voice-note key loses its tag | §7b |
| `SARVAM_SPEAKER` renamed | §7a |
| `ELEVEN_DEFAULT_VOICE` renamed | §7a |
| `TextToSpeech.speak` renamed | §7a (and §5's door check) |
| a second `hasAudioTags` call site | §7a — *the engine is decided in one place* |

## 11.6 What this workstream did NOT fix

- **`src/components/useCallEngine.ts`** — read-only here. §6.4 row 6 stands:
  stopping a screen share drops to the **cascade**, not back to live, which is a
  cross-model-family change nothing forced. Still the largest *unforced* swap.
- **Device TTS remains audible mid-call** (D5). Declared, not removed; the
  alternative is silence.
- **Sarvam and ElevenLabs remain reachable** (D1). Declared, not removed —
  whether a user key should be allowed to override her identity at all is an
  owner decision, and the tradeoff is real: Sarvam is the measured Hinglish
  champion. What is now impossible is for that choice to be *invisible* or to
  change **mid-reply**.
- **`LiveWatchEngine.java`'s `DEFAULT_MODEL`** is still
  `gemini-2.5-flash-native-audio-latest` while `liveCall.ts` has no fallback at
  all. Declared in §2 since the last pass; the twins disagree, and reaching it
  needs a malformed `/api/live-token` response.

---

# 12. The voice wave — Despina, identity-wins, and the case #96 missed (2026-08-24)

## 12.1 Her voice is Despina

Chosen by the owner from the blind deck (`voice-samples.mjs`, labelled A–F in a
shuffled order); runner-up Leda. `voice-ears` is why this is an ear decision and
not a measured one.

Executed with the mechanism from §11.4 — `node scripts/verify-voice.mjs --set
Despina` — which moved **all six lanes in one command** and widened
`ALLOWED_VOICES` additively so a clip cached or a request in flight under
Autonoe is still answered rather than 400'd.

**The echosim law applied even though this is a name-only edit**, because
`liveCall.ts`'s two voice literals are among the six. `build.mjs` + `exp1.mjs`,
5 couplings × 8 seeds × 2 arms = 80 simulated calls, run before and after:
**byte-identical, same MD5 `26fc602117cbd832e3c7d3520627e60b`** — every cell of
the floor table unchanged. That is the intended result and it is worth having
run: the property being proved is that a change to this file did *not* move the
floor, and only a run can prove it.

**No cache purge was needed and none was performed.** Identity is in the key
(§11.4), so every Autonoe clip in every install's IndexedDB became unreachable
the moment the constant moved. §7b-i now walks that chain by name for the pickup
clip specifically — `pk1:` → `engineTag()` → `` `gm-${MEERA_VOICE}` `` — because
that clip is the first sound of a call, is served with zero network, and is
therefore the single clip most able to outlive a switch.

**The drift baseline could NOT be re-anchored.** `prosody-baseline.mjs
--establish` needs the paid OpenRouter lane and the key answers **403 "Key limit
exceeded (total limit)"** — the exhaustion §9 already recorded. It was not
redirected to the free Gemini pool: that quota is shared production
infrastructure and the script refuses it by design (`free-tts-daily`). So the
baseline remains anchored on **Aoede, from 2026-08-15** — which is D4 confirmed
from the log file rather than argued. Consequences, both intended:

- the alarm added in §11.4 **fires** the next time the job runs (verified
  hermetically, no spend: `"Aoede" !== "Despina"` → `voiceChanged` → alarm +
  `lastAlarm`), rather than silently reporting the gap as drift;
- `verify-voice.mjs` §7b-ii prints the stale anchor as a **note on every run**,
  so the fact does not need the paid job to become visible.

It is a note and not a failure on purpose: a hard failure would block every
build behind someone topping up a key, which is worse than the thing it reports.
**Needs a funded OpenRouter key**, then one command.

## 12.2 IDENTITY WINS — a user key no longer overrides her voice

Coordinator decision. Her own voice is now preferred on the cascade whenever it
is reachable; Sarvam and ElevenLabs are **failover only**, below her voice and
above the device engine. One constant, `VOICE_IDENTITY_WINS`, and flipping it
restores the previous order exactly.

**Reverses if:** the owner explicitly chooses Hinglish quality over voice
constancy for fallbacks.

**A correction to §11.2's D1, found while implementing this.** D1 said Sarvam
and ElevenLabs override her "whenever the user has set a key". Reachability is
narrower than that and the truth is stranger: **nothing in the tree ever writes
`sarvamKey`, `elevenKey` or `elevenVoiceId`.** There is no settings screen —
they are declared in `store.ts`, defaulted to `""`, read by `speech.ts` and
`useCallEngine.ts`, and set by no code that exists. `dead-writers` with the
polarity reversed: readers with no writer.

That makes the divergence *unreachable in a fresh install* and **permanent in an
old one**, because `store.ts` hydrates as `{ ...defaultState, ...JSON.parse(raw) }`
— a shallow spread over defaults. A key written by any earlier build survives
every update since, invisibly, with no UI that could clear it. For a year-old
install that is not a hypothetical path; it is the only path, and it is
undiscoverable from inside the app.

**The opt-in UI is a future slice**, stated as such rather than implied.

## 12.3 Share-stop returns to live — and what #96 actually missed

**Nothing regressed.** `reconnectLiveAfterWatch()` was built by task #96 and is
correct: it reuses `liveSystemRef.current` (never a second `compile()`, so G-C4
holds), bails on every racing lane change, and hands off through
`adoptLiveLate` — connect first, swap at a turn boundary — which is the seamless
form. It was wired to `watch_stopped` and `watch_stopped_externally`.

**The case it missed is `watch_consent_denied`.** #96 was framed as *"stopping a
share must not strand the call"*, and a **denial is not a stop** — the share
never started, so the branch did not read as one of the paths that needed it.

The sequence, from source: tapping share runs `claimVoice("native",
"watch_started")` **before** the Android consent dialog — deliberately, so a
queued TTS clip cannot surface as a second voice behind the native engine — and
that kills the JS live session. The dialog appears, the user taps Deny, and the
catch block claims cascade with no live session to return to. **The call
finishes on a different model family, in exchange for a share that never
happened.** §6.4 row 8 recorded the identity change; nothing was wired to undo
it.

It is also the **likeliest of the three to fire**: declining a permission dialog
is an ordinary thing to do, and on Android the dialog appears on every share.

**No lifecycle interaction.** `recordShareEnd` is called only from the two stop
paths and the web teardown, so the deny path records no share and emits no
`share_end` fact — there is nothing here to double-send.

**Guarded** by §7d, which asserts the *property* (every `claimVoice("cascade",
"watch_*")` exit tries to return to live) rather than the three call sites, so a
fourth exit added later inherits the check instead of the omission.

> **Separate pre-existing gap, reported not fixed.** On the NATIVE lane the
> `share_end` lifecycle note never reaches her. `recordShareEnd` sends it
> through `liveSession.current`, and on that lane the session was already killed
> by `claimVoice("native", …)` on the way in — so the note is composed and
> dropped. It fires only on the web lane. Fixing it means deciding whether a
> note about a share that ended seconds ago should arrive after a socket
> reconnect, which is a timing judgment (`pre-line-before-the-move` is the
> nearby rejection) and belongs with the coordinator.

## 12.4 The model twins, reconciled

`LiveWatchEngine.java`'s `DEFAULT_MODEL` was
`models/gemini-2.5-flash-native-audio-latest` — a model this repo **measured and
rejected** (`live-model-bake`, 0/24 barge-in, 3–5.5 s to first audio) — sitting
as the silent fallback on the one surface where the triple-swap happens. The JS
twin has *no* fallback, so the two did not merely differ: they disagreed about
whether a fallback should exist.

A fallback that differs from the primary is a second configuration reached only
when something has already gone wrong — i.e. the configuration nobody ever
observes. It is now the same string as `api/live-token.js`'s `LIVE_MODEL`, so a
malformed token response costs a round trip instead of changing who she is.
Distinct models producing her voice: **3 → 2**.

§2's declaration for the old model is **kept as a comment rather than deleted**,
because an entry's absence is otherwise indistinguishable from having forgotten
it. §7c pins the two strings and was proved non-dead: pointing the Java fallback
at the *declared* TTS model (which §2 accepts) still fails §7c.

## 12.5 A third demonstration that proximity scanning measures the prose

§7d took three attempts, and the first two failed a branch that **had** the fix:

1. a 1400-character lookahead — my own comment explaining the reconnect pushed
   the call past the window;
2. "up to the next `claimVoice(`" — the same comment *mentions*
   `claimVoice("native", "watch_started")`, and a text scan cannot tell code
   from prose about code.

It strips comments and bounds on the next *exit* now. In a file whose comments
are incident reports that quote the calls they describe, **every proximity rule
is a rule about the prose unless the prose is removed first.** Same family as
§11.5, third instance in one workstream, and each was found only by breaking the
guard on purpose.
