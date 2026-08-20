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

## 1. Three things have to be true, and only one of them was checked

| | property | guarded by | was it true? |
|---|---|---|---|
| **name** | every lane names the same voice | `verify-voice.mjs` §1 (pre-existing) | yes — Aoede on all four |
| **model** | which model actually produces it | `verify-voice.mjs` §2 (new) | **no — three, undeclared** |
| **text** | what the synthesiser is handed | `verify-voice.mjs` §3 (new) | **no — nothing existed** |

The name check passed and the owner still heard her change. That is not the
check failing; it is the check answering a different question. **The same voice
name on a different model is a different voice**, and nothing recorded that
three models were in play.

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
| 7 | ElevenLabs (user key) | `speech.ts elevenFetch` | **no** |
| 8 | Sarvam (user key) | `speech.ts sarvamFetch` | **no** |
| 9 | **device TTS** — Capacitor `TextToSpeech.speak` / `speechSynthesis` | `speech.ts speak()` tier 2 | **no** |

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
   voice" is exactly what a platform voice sounds like. **Not fixed — see §7.**
   *This is a hypothesis: I have not heard a device engine speak an em-dash and
   cannot without a phone.*
3. **The live lane (path 1/2).** persona.ts's own comment says the native-audio
   model "speaks the characters she emits", so a dash can surface. Only
   persona.ts can fix it. **Not fixed — not my file.**

There is no fourth path. The table above is exhaustive as of this change and
`verify-voice.mjs` §4 will notice a new one on the live lane.

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

**(b) Web: `goAway` is unhandled, so a routine rotation becomes permanent.**
The Gemini Live server announces an impending hang-up with a `goAway` message.
`LiveWatchEngine.java:1162` handles it — `rotate()`, up to `MAX_ROTATES = 6`,
opening a fresh session and **staying on the live model**. `src/voice/liveCall.ts`
does not handle it at all (`grep goAway` → zero hits before this change). The
close that follows lands in `onclose` → `teardown("closed")` → useCallEngine
answers with `claimVoice("cascade", …)` — a **permanent** lane change for the
rest of the call, out of an expected and recoverable server event. Continuous
video is exactly what shortens the time to that rotation, which is why it
surfaces during screen share. Both files set
`contextWindowCompression: { slidingWindow: {} }`, which lifts the *context*
limit; it does not stop the server rotating a session.

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

| report | explained by | confidence |
|---|---|---|
| voice changing in screen share, **Android** | (a) the designed triple-swap | **high** — provable from source, no failure needed |
| voice changing in screen share, **web** | (b) unhandled `goAway` | **medium-high** — the asymmetry with the Java engine is proven; that video shortens time-to-`goAway` is inference |
| voice changing **anywhere, right now** | (c) key exhaustion deepening the chain | **medium-high** — the exhaustion is measured, the reachability is proven from source, the audible result is inferred |
| "dash dash" | the cascade proxy (fixed) or device TTS (not fixed) or persona.ts (not fixed) | **medium** — see §5 |

Key exhaustion explains **the voice change strongly and the dash partially**: it
makes the unsanitised device tier reachable, but the dash was already emitted on
lanes that were reachable before it.

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

### Recommended, not implemented — with the reason for each

- **Handle `goAway` in `liveCall.ts` by rotating the socket**, as the Java
  engine does. This is the real fix for 6.2(b) and it would keep a screen-shared
  web call on the live model. **Not done deliberately:** rotating means tearing
  down and rebuilding the WebSocket mid-call, and the arbiter, the hold ring, the
  echo κ estimate and the barge-in watchdog all hang off that lifecycle. The Java
  version needed `wsGen` generation counters, `flushPlayback()` and a ring reset
  to do it safely. *A call that drops or a barge-in that misses is a much worse
  bug than a voice that shifts* — so this is measured first (the new `live_goaway`
  / `live_close` records are what makes it measurable) and changed second.
- **`sessionResumption: {}` in the setup block.** The protocol-level answer to
  `goAway`. Not added: this setup block is where `enableAffectiveDialog` closed
  the socket with 1007 "Unknown name", and an untested field here costs the call.
  Verify against a live endpoint before adding.
- **Android: `claimVoice("cascade", "watch_stopped")` should try to return to
  live.** Dropping to the cascade after every screen share is a guaranteed voice
  change that nothing forced. `useCallEngine.ts`, not my file.
- **`src/voice/speech.ts` should import `spokenText`** and apply it inside
  `stripForCloud` and `stripForDevice`, which closes paths 7–9. One import and
  two call sites. Not my file — and it is the *device* path that matters, because
  §6.2(c) makes it live today.
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

---

## 8. Gates

| gate | result |
|---|---|
| `node evals/voice/spoken.mjs` | **37 positive + 17 negative, 54/54 idempotent, 0 failures** |
| `node scripts/verify-voice.mjs` | **pass** — one name (Aoede), 3 declared models, one spoken-text core, 1 live text→audio path |
| `npx tsc --noEmit` / `tsc -b` | **clean** |
| `node scripts/verify-release.mjs` | see §8.2 |

### 8.1 The guards were tested by breaking them

- Making the dash rule greedy in `spokenText.ts` (`/-+/` instead of `/ +- +/`)
  turned **9 of 54** cases red, including *"a hyphenated helpline number survives
  untouched"*. The negative controls do their job.
- Changing one character of the mirrored core in `api/speech.js` produced
  `the spoken-text core has DRIFTED … first difference at line 89`, with both
  versions of the line printed.
- Adding `import { spokenText } from "./spokenText"` to `liveCall.ts` produced
  the §4 failure with the explanation of why the live lane needs nothing.

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
- **The Android lane end to end.** `LiveWatchEngine.java` was read, not run.
