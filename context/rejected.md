# Rejected — read this first

The most expensive knowledge in this project. Every entry here is something
that looked obviously right and measurably was not. Without this file the same
work gets redone, because the reasons are not guessable from the code.

---

## `backchannel` — she cannot make a sound while you are talking

**The idea.** Real people say "hmm", "haan", "acha" *while* you are still
speaking. Its absence is the largest remaining "not human" tell on a call.

**Why it cannot be done here, measured.** Any sound she makes during your speech
has to be protected from her own echo, and the only mechanism available for that
is holding the microphone. But a mic hold puts digital silence on the uplink,
and digital silence is exactly how the server decides your turn ended
(`silenceDurationMs: 300`). **The protection and the damage are the same act.**
Your sentence splits and she answers the first half.

Not protecting it is worse: her voice reaches the server *inside* your turn at
every coupling from −6 to −18 dB, and it fills your natural pauses, so the
endpointer commits later and she answers **slower**.

| approach | extra silence inside your sentence | her voice uplinked |
|---|---|---|
| registered with the echo model | **+171 ms** | 0 |
| produced as a model turn | +85 ms | 0 |
| second AudioContext | −171 ms | **+171 ms** |
| in the gap AFTER you stop | **0 ms** | 0 |

A prompted backchannel is doubly dead: the server's own VAD cancels a model turn
that begins during user activity.

**What was built instead:** the acknowledgement lands in the gap ~420ms after
you stop, which is where a human puts one anyway.

**What would reverse this:** a realtime API that does not infer turn-end from
uplink silence, or a separate audio channel the server does not listen to.

---

## `murmur-timbre` — the synthesised listening sound

**Rejected by the owner's ear**, and the reason is structural. A synthesised
"mm" is three harmonics and an envelope: it can borrow her pitch range but it is
not her voice, so it lands as a tone from elsewhere in the room. A backchannel's
whole job is to say "it's still me here" — a sound that is not hers says the
opposite. Verdict: *"weird, and it doesn't have her energy even if it's just
listening."*

Timbre was the one property nobody measured; everything around it (placement,
mic hold, never delaying her first word) is measured and was kept.

**The version worth building** uses real clips of her own voice, fetched during
the ring where there is already idle time and no call-path cost.

---

## `azure-tts` — moving her voice to Azure

Every measured axis said switch. **Her owner's ears said no**, and the ears were
right.

| | current | Azure coral |
|---|---|---|
| Hindi words pronounced correctly | 11/15 | **15/15** |
| first audio | 4.9–12.7 s | **255 ms** |
| cost per utterance | $0.0148 | **$0.0029** |
| pitch | 266 Hz | 210 Hz (−4 semitones) |
| CAPS emphasis | +6.2 dB | none |

Verdict: *"tender_2 is fully fucked, not human and not Indian. laugh_2 is the
worst thing ever."*

**The lesson, and it generalises:** the battery measured whether Hindi words
come back as Hindi words — that is *pronunciation*. It never measured whether
the speaker sounds like a girl from Bangalore — that is *accent identity*. They
are different properties and only the second decides whether she is her. **Any
future voice comparison must test accent authenticity as a first-class axis.**

---

## `speaker-id` — telling a second person from the owner

**Deliberately not built.** "At the owner's mic distance" removes the only cheap
signal that exists: the arbiter's near-field test is level-based (+16 dB),
because a mouth at 0.2 m beats a TV at 3 m by 15–23 dB. Two people at the same
distance have no level difference by construction.

Real speaker ID needs an embedding model in the barge-in decision path — latency
in the one place the constraints forbid it — plus enrollment, plus drift when he
shouts, whispers, or has a cold.

**The asymmetry decides it.** "Someone else can also take the floor" is a mild
annoyance. "She stopped answering me" ends the product. A 95%-accurate gate
converts a 100%-reliable floor into a 95%-reliable one *for him*.

Rejected proxies: pitch/f0 (fails on unvoiced frames, fails entirely for a
same-sex speaker), two-mic discrimination (both lanes capture mono), the server
transcript (arrives after the floor decision, by design).

---

## `recited-prompt` — sentence-shaped text in her brief

Seen twice, in unrelated features, which is what makes it a law rather than an
anecdote.

1. Her persona once contained example quotes. They acted as a **phrase bank** —
   she recited them verbatim on 4 of 5 turns. Removing them took it to 0 at
   n=84.
2. Her stored taste was first written as polished English sentences. She **read
   them out verbatim, twice, eight turns apart**, and began lifting English
   clauses into Hinglish replies (register defection on 13 of 96 turns).
   Rewriting each as a telegraphic note cut verbatim echo to 1/32 and defection
   to 0/32, with consistency unchanged.

**Write shapes, never lines she could say.**

---

## Model candidates evaluated and dropped

- **gpt-5.6-luna / terra for the vision lane** — both read a third of a chat
  thread, reported `illegible: []`, and confidently named the café the screen
  explicitly *rejected*. Not an OCR miss: read-part, assert-the-rest.
- **gpt-5.6-terra as a cost saving** — 1.14× cheaper, not 8×, and slower.
- **Sarvam and every Indic-specialist model** — on Foundry only via the Hugging
  Face collection, which is not credit-eligible, and they are tuned for *formal*
  Devanagari Hindi. Casual romanised Hinglish is the opposite requirement. On
  Indi-RomCoM, Sarvam-30B scores *below* Claude Opus 4.6 at every code-mixing
  intensity.
- **Open-weight models generally** — register defection 63–99.8% against
  frontier 35.9%, and prompt caching absent or undocumented, which erases the
  cost case (see `cache-9x`).
- **Claude, despite being the best measured at romanised Hinglish** — Anthropic
  is the one publisher with no qualifier on the Azure credit exclusion list, and
  with a card on file it bills the card instead of the credits.

---

## `frame-cadence` — capturing screen frames faster

`FRAME_EVERY_MS` 600 → 450 → 300 → 240 moved the wake by **0 ms on 18 of 18
real stops**, for +21% vision spend.

Nothing in the path is serialized: detection runs at 120 ms off the luma grid
and never waits on encoding, so the classifier already decides on frame N while
N+1 is being captured. The pre-roll has the still frame in the socket **before
the hold confirms**. A faster camera cannot help a pipeline whose cost is the
hold, not the picture.

## `hold-scroll-floor` — lowering `HOLD_SCROLL_MIN`

900, 700 and 600 changed nothing — not one millisecond, not one wake, on any of
the eight sessions. A scroll hold is `1.8 × their own gap` ≈ 2400 ms, so a 1200
floor never binds; in the one session where it does, her own voice blocks the
wake and it slips to the same place anyway.

## `wake-dedupe` — loosening one-reaction-per-thing to catch more stops

Of the 7 missed stops at baseline, 4 were this dedupe. Measuring the 16×16 MAD
of the "duplicate" pictures gives **0.00–0.77** — they are literally the same
screen. No threshold separates them from true duplicates. The mechanism is
correct; the misses are not a bug to fix.

---

## `live-model-swap` — moving the realtime call off `gemini-3.1-flash-live-preview`

All five alternatives that can do bidi audio are worse, and two are worse in
ways that break shipped features: they **reject video**, which ends screen
share, and they miss the 600 ms `RELEASE_WATCHDOG_MS` barge-in signal on nearly
every run, which would silently undo the release work and hard-cut her mid-word.
See `live-model-bake`.

## `silence-tuning` — shortening `silenceDurationMs` to speed her up

150, 300 and 500 all land within 50 ms of each other. The knob anyone would
reach for buys nothing, and shortening it trades getting cut off mid-sentence
for zero. See `live-floor`.

## `ack-bracket-direction` — writing a bracketed direction into a backchannel clip

`[laughs softly]` came back as laughter **plus the spoken word "Softly."** A
direction in a TTS payload is performed as words. Related to `recited-prompt`
and to the voice-note truncation bug: bracket-shaped text is not inert anywhere
in this system. The generated laugh is also not in the shipping clip list — the
sound is chosen by a timer that has no idea what was just said.

---

## `openrouter-streaming` — asking the paid TTS lane to stream

`stream: true` on `openrouter.ai/api/v1/audio/speech` is accepted and does
nothing. See `openrouter-no-stream`. There is no client-side fix: the bytes do
not exist until synthesis finishes.

This is why a **billed Google key** is the tier that matters between free quota
and OpenRouter — same streaming endpoint as the free pool, ~600 ms to first
frame, and it simply never 429s. `withGeminiKey` appends it last and never cools
it; absent, nothing changes.

---

## `realtime-azure` — `gpt-realtime-2.1-mini` for the voice call lane

Deployed on the startup credits, measured properly, declined. **The third
bake-off to end in "keep the incumbent", and the reason is not latency.**

It clears the bar that killed the Gemini alternatives. **Barge-in passes:** VAD
`speech_started` 6/6 inside `RELEASE_WATCHDOG_MS`, median **271 ms** against the
incumbent's 279 ms; her audio actually stops at 245 ms. **Vision is genuinely
good:** on a rebuild of the `vision-fab` case at the app's real 355×768 q68
fidelity it went **5/5 correct, 0 fabricated**, naming the right café and time
and correctly reporting the rejected one — better than luna or terra managed.
Latency loses only narrowly: **1458–1497 ms** median steady first-audio across
9 sessions / 72 turns, against 1370 ms.

**What disqualifies it is that she stops sounding like herself.**

| | Azure mini | reference |
|---|---|---|
| words/turn | **41, then 53** | incumbent 20.5; **grok declined at 36.1** |
| spoken turn length | **median 14.0 s**, p90 18.2 s | grok declined at ≈13.9 s |
| spoken-register markers | 4/24 turns | these ARE her prosody on a speech-native model |
| questions | 13/24 turns | ceiling ≈1 in 3 |

Fourteen seconds a turn is a monologue, not a phone call, and it lands on the
exact number `brain-model` already declined a model over. The prompt was
byte-identical to the incumbent's, so this is the model — the same shape as
`charm-grok`: **the prompt sets a ceiling, the model decides how close you get.**
The Hinglish is also often not good Hinglish ("doesna nahi chahiye", "tez
diwane"). Romanised Hinglish did survive — 0/24 Devanagari — which was the risk
expected to kill it, and didn't.

**No voice is plausible.** The six available measure 137–192 Hz; hers is 266 Hz,
and Azure coral at **210 Hz was already rejected by ear** (`voice-ears`) as "not
human and not Indian". Every option here sits below the one already refused.
Samples were saved rather than deciding from the Hz, which is the mistake
`voice-ears` exists to prevent.

**No continuous frame channel**, confirmed against the real deployment:
`input_image_buffer.append` and `input_video_buffer.append` are rejected as
invalid. Frames can only arrive as `conversation.item.create` items that
accumulate in history. The watch lane streams at 600 ms; that is
re-architecting, not porting — and the failure mode already showed, with one run
reading a whole thread aloud line by line.

**Unresolved, deliberately not counted against it:** the crisis helpline
appeared in only 1 of 3 stimuli. All three stayed warm and none collapsed into a
risk-assessment script, and `reasoning-live` records the OPPOSITE failure
(helplines over-triggering at 16.7%), so fewer is not automatically worse.
Settling it needs a paired incumbent run on the same stimuli. AI-honesty 3/3 and
NEVER MANIPULATE 3/3 both held.

**Reverses if:** a build holds ≤20.5 words/turn at ≤1370 ms AND offers an
Indian-accented voice near 266 Hz AND streams frames. Word count is partly
promptable, so a retest after a length-directive pass is fair — but 41→53
against a 20.5 lane is a long way to close with prompt alone.

**Two traps for whoever re-runs this.** The working handshake is
`/openai/v1/realtime?api-version=preview&model=<deployment>` with the NESTED GA
session schema (`session.type`, `audio.input`/`audio.output`) — the
`2025-04-01-preview` + `&deployment=` form completes the HTTP upgrade (101) and
then fails at session level, so a raw handshake probe reports it as working when
it is not. And WebSockets need `NODE_USE_ENV_PROXY=1` here or Node ignores
`HTTPS_PROXY` and hangs silently, which looks exactly like a dead endpoint.
