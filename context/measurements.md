# Measurements

Every number with its n and method, so a future number can be compared against
it. A figure without those cannot be compared, which is the only thing figures
are for.

---

## `charm-grok` — grok loses to the incumbent 38–2 (2026-08-11)

Blind, counterbalanced judging by `claude-opus-4.8`. 48 conversation units, 96
judgments, every unit judged in **both** presentation orders; a unit counts as a
win only when both orders agree, and order-flips are charged as ties.

| axis | incumbent – grok |
|---|---|
| overall | **38 – 2** (p<0.001) |
| warmth | 35 – 3 |
| humour | 31 – 2 |
| personhood | 34 – 4 |

Grok's 2 wins were both `voice/bored`, and only because the incumbent's own
doubled-tone-marker bug fired there. Mechanism: 36.1 words/turn vs 20.5, 1.74
questions/turn, 63% of turns ending in a question, and in chat one turn in five
losing bubbles to the 4-bubble parser cap.

**Position bias was real** — the judge picked slot A on 61% of non-tie
judgments. That is why both orders are always run.

Tested against the **actual Foundry deployment**, which currently serves
`grok-4.20-beta-0309-non-reasoning` — a beta build that could change underneath
us.

## `charm-luna` — luna ties, and wins specificity (2026-08-11)

Same method. Overall 17–18 (p=1.00, dead heat). Warmth 18–19, humour 18–21, all
within noise. **Specificity 9–25 for luna (p=0.009)** — a clear win.

Against luna: spoken turns 37% longer (28.2 vs 20.5 words), crisis-beat collapse
into a clinical risk-assessment script, and **zero media tags in 144 replies**
against the incumbent's 11 (p=0.029).

## `reasoning-split` — reasoning helps light, harms heavy (2026-08-11)

Matched pairs, reasoning the only variable: `grok-4-20-(non-)reasoning` and
`grok-4-1-fast-(non-)reasoning`. 164 conversations, 984 turns, zero errored.
128 blind counterbalanced judgments over all 64 matched pairs.

- **Light** (casual, teasing, bored, conflict, factual, excited): **74–21,
  +55%**, significant on all seven dimensions.
- **Heavy** (sad, crisis-adjacent): **29–3 against, −81%**. Attunement and
  specificity −78% each.

Per beat, monotone: teasing 15–1, conflict 14–2, factual 14–2, casual 13–2 for
reasoning; sad 2–14, crisis 1–15 against.

**The pooled average (+21%) is deliberately not reported** — it is an artifact
of a 6:2 light:heavy beat mix, and the sign flips if heavy beats exceed ~35% of
real traffic.

**Mechanism**, measured three independent ways: on heavy beats reasoning
collapses into restate → matching anecdote → question. Mirror-echo 0–2% → 10–29%;
"mujhe bhi…" 8–10% → 35–52%. `persona.ts` explicitly bans mirroring; reasoning
follows the *stated* rules literally and breaks the one forbidding parroting.
Helplines injected into 16.7% of heavy turns vs 0%.

**Latency:** non-reasoning 626/863 ms p50; reasoning 5,212/4,205 ms p50,
8,091/6,111 ms p90. Serial and uncontended.

**Truncation was a non-event** — on xAI deployments `max_tokens` caps *visible*
output only, so 0 of 984 turns truncated at either budget even with up to 2,305
hidden reasoning tokens. **This does not transfer to GPT-5.6**, which truncated
3–5% of spoken turns at `max_tokens: 190`.

An earlier 256-conversation run was **discarded** after rate limits were found
to be hitting only the fastest arm, which would have handed reasoning an
unearned win.

## `vision-fab` — fabrication on real screenshots (2026-08-11)

12 screens captured at 390×844 DPR 3, downscaled through the app's own pipeline
to 355×768 JPEG q68 — our actual fidelity. 160 calls, 0 errors.

Decisive case: a chat thread proposing one café, **explicitly rejecting it**, and
settling on another. All 9 messages crisply legible.

| model | messages read | venue | declared illegible | fabrications /32 |
|---|---|---|---|---|
| grok-4-20-non-reasoning | 12 | Koshy's ✓ | — | **0** |
| gemini-3.6-flash | 13 | Koshy's ✓ | — | **0** |
| llama-4-maverick | 9 | Koshy's ✓ | — | 3 |
| gpt-5.6-luna | 3 | Third Wave ✗ | `[]` | 1 |
| gpt-5.6-terra | 4 | Third Wave ✗ | `[]` | 2 |

Latency: grok 428 ms median, gemini 2,136 ms. Image tokens: 288 vs 1,078.
At the full 600 ms cadence the incumbent costs ≈**$25/hour** — scene-change
gating is what keeps the real figure near $2.66, so that gating is not an
optimisation, it is viability.

Maverick broke the "seeing it for the first time" rule twice in 16 frames.
Luna and terra gave the **best privacy responses** in the set — naming a medical
notification's kind without quoting it.

**Untested:** everything here is single-frame. The real lane has 600 ms
continuity and a scene detector.

## `voice-ears` — Azure TTS rejected by ear (2026-08-11)

See `rejected.md#azure-tts` for the table. Judged on 9 lines pulled verbatim
from her register rules, 4 arms each, delivered as WAVs.

**A trap worth recording:** aggregate speech-recognition recall reads coral 0.93
vs control 0.71, and that is **not** a quality ranking — expressive delivery
*lowers* ASR recall. The control scores 0.0 on the laughter line precisely
because it laughs over its own words.

## `cache-9x` / `cost-per-turn` (2026-08-11)

Real API calls with the real persona, usage reported by the provider.

| lane | input tokens | cached | cost/turn |
|---|---|---|---|
| chat | 10,613 | 99.8% | $0.0019 |
| call | 11,047 | 99.9% | $0.0029 |

Same turn with caching disabled: **$0.0160 vs $0.0017 — 9.2× cheaper with it.**

At these rates $5,000 buys ≈2.7M chat turns or ≈35,000 ten-minute calls.
**Cost is not this project's constraint; quality is.**

## `taste-consistency` — 27% → 63% (2026-08-11)

480 live turns, real persona, real prompt assembly. Same position asked twice,
6–8 turns apart: agreed with herself 13/48 before, **30/48 after**. Words on
turns with no taste block unchanged at 7.4. Register defect on taste turns
13/96 → 0/32 text. Offline: 0 false fires in 60 ordinary messages, 20/20
relevant hits, identical output over 100 calls.

Remaining 37% inconsistency is on topics with no table row — the fix is more
rows, not more prompt.

## Audio floor, at controlled speaker-to-mic coupling (2026-08-11)

Simulator driving the **real** `liveCall.ts` with her voice played through a room
impulse response. n=8 seeds per cell.

| coupling | self-duck before → after | her voice uplinked before → after |
|---|---|---|
| −6 dB | 91% → **14%** | 6,996 ms → **1,280 ms** |
| −9 dB | 33% → 5% | 4,778 ms → 512 ms |
| −12 dB | 2% → 1% | 2,474 ms → 341 ms |

Self-interruption now breaks at about **−3 dB** (simulator figure, read as
approximate). Side effect: a distant television stopping her went **8/8 → 2/8**.
Cost, stated: a *quiet* talker at −6 dB now gets ignored — at those levels a
quiet person and a distant TV are not separable by level, and the baseline only
"heard" them by also hearing itself 91% of the time.

## `wake-hold-curve` — screen-share wake latency vs the landing hold ceiling (2026-08-11)

`HOLD_REPLACE_MAX` swept on 8 captured sessions, graded, real model at every
wake. 48 sessions/arm, then 90/arm on the 3 sessions where the ceiling can act.

| ceiling | stops reacted | wake p50 | p90 | fabrication | talk |
|---|---|---|---|---|---|
| 4000 (was) | 180/300 | 1920 ms | 4200 ms | 35.0% (112/320) | 53% |
| 1200 | 211/300 | 1320 ms | 2760 ms | 35.5% (128/361) | 60% |
| **800 (shipped)** | **215/300** | **960 ms** | **2760 ms** | 37.8% (138/365) | 60% |

Stop → her voice end to end: p50 **2.66 s → 1.70 s**, p90 **4.94 s → 3.50 s**.
Fabrication pooled across both fast ceilings **+1.6 pp, 95% CI [−4.7, +7.9],
p=0.61** — it did not rise. Costs: `narrates_transition` +2.2 pp (p=0.016),
repeats +4.7 pp (p=0.089), talk share +4 pp.

2000 is dominated — full wake-rate cost, no latency win. In `scenesim` a
browse-8-products pattern goes 4.4 → 10.9 wakes/min with the knee between 3000
and 2000; that pattern is not in the captured sessions, so **3000 is the
conservative fallback** if she is heard getting chatty while browsing.

## `her-reaction-736` — her own reaction time on a screen wake (2026-08-11)

**736 ms median, p90 1104 ms**, n=134, pooled from live poke logs. The 1.5 s
this was previously budgeted at is near the p99. More of the wake budget is
ours than was assumed.

## `fab-noise-floor` — the fabrication metric's noise floor in the replay harness (2026-08-11)

5 of 8 sessions produce a **byte-identical** wake pattern under every candidate
— same class, same time, same frame index — so the setting provably cannot act
there. Across those 300 arm-pairs the judged fabrication rate still spreads
**13.6 pp**, median |difference| 28 pp, p90 75 pp; one cell moved 50% → 92% on
identical input.

**Any fabrication claim from this harness at n<300 is noise.** This is why the
sweep above spent its budget on n rather than on more arms.

## `live-model-bake` — every model that can serve the realtime call (2026-08-11)

Exactly **six** models in the catalogue support `bidiGenerateContent`. Three
disqualify themselves outright: `gemini-omni-flash-preview` has no bidi at all
(`1008`), robotics-streaming refuses AUDIO (`1007`), and live-translate
**translated instead of answering**, at 7559 ms.

| model | steady med | IQR | silent | video | barge-in signal |
|---|---|---|---|---|---|
| **3.1-flash-live (incumbent)** | **1370 ms** | **231 ms** | 0/24 | **accepted** | **5/5 @ 279 ms** |
| 2.5-native-audio-latest | 2449 ms | 1548 ms | 0/24 | rejected | 4/5 @ 1323 ms |
| 2.5-native-audio-09-2025 | 2272 ms | 2009 ms | 1/22 | rejected | — |

The barge-in column is the disqualifier, not the median: `RELEASE_WATCHDOG_MS`
is 600 ms, and the alternatives miss it on nearly every run. Swapping would
silently undo the release work and hard-cut her mid-word. They also reject
video, which ends screen share.

## `live-floor` — where the 1.4 s live reply actually goes (2026-08-11)

A **text** turn with no VAD wait is **720 ms** (n=15): prefill of the 48k system
instruction, first token, network. Untouchable from the client. The audio path
adds ~745 ms on top.

**`silenceDurationMs` is not what you are paying for it.** 150 / 300 / 500 all
land within **50 ms** of each other. ~1.4–1.5 s is the floor; the remaining
levers are a shorter system instruction and *hiding* the wait.

## `free-tts-daily` — the free TTS tier is a DAILY budget, and it runs out (2026-08-11)

All 9 keys returned 429 "You exceeded your current quota" **together**, after a
few dozen synthesis calls across a session of testing. Two hours earlier the
same keys measured: 6 healthy at 615–1051 ms first frame, one 429, two 503.

This is not per-minute throttling that clears in seconds. Planning that assumed
"free serves TTS" was measuring an empty budget, not a sustainable one.

## `openrouter-no-stream` — the paid lane cannot stream (2026-08-11)

Tested directly against `openrouter.ai/api/v1/audio/speech` with the same model,
with and without `stream: true`:

| | first byte | complete | chunks |
|---|---|---|---|
| `stream: true` | 2267 ms | 2283 ms | 15 |
| baseline | 1742 ms | 1768 ms | 13 |

Chunked transfer-encoding, but the whole clip lands ~20 ms after the first byte
— it buffers the synthesis and then flushes. **`stream: true` is a no-op here.**

Consequence, measured in production the same day: with free quota gone, 10 of 12
requests were served by this lane. **Free-served first audio p50 886 ms;
paid-served p50 2476 ms.** That gap *is* the p90.

## `azure-realtime-shape` — what an Azure realtime session requires (2026-08-11)

Established while trying to evaluate `gpt-realtime-2.1-mini`. The model itself
is **not measured** — see `realtime-azure`, still open — but these two are
properties of the Azure realtime protocol and hold regardless of the verdict.

**Input audio below 24 kHz is refused outright:**
`{"code":"integer_below_min_value", "message":"Invalid
'session.audio.input.format.rate' ... Expected a value >= 24000, but got
16000"}`. `liveCall.ts` uplinks 16 kHz PCM, so a swap means changing the
resample rate and carrying **1.5× the uplink bytes** — which lands in the
congestion path that reads `bufferedAmount` troughs.

**There is no continuous frame channel.** The server's supported-event enum is
`session.update`, `session.close`, `transcription_session.update`,
`input_audio_buffer.{append,commit,clear}`,
`conversation.item.{create,truncate,delete,retrieve}`,
`response.{create,cancel}`. `input_image_buffer.append` and
`input_video_buffer.append` are rejected as invalid. The only route for a frame
is a discrete `conversation.item.create` carrying an `input_image` part, which
was accepted.

**Caveat, and it is load-bearing:** that enum came from `gpt-4o-mini-tts`, the
only deployment on the resource that would open a socket. Whether a real
realtime deployment widens it is exactly what could not be tested. Treat it as
a strong prior that screen share would need re-architecting from "stream frames
into the session" to "inject frames as conversation items" — not as a measured
answer.

**Also note the barge-in signal is structurally different.** Azure's nearest
event is `input_audio_buffer.speech_started`, a VAD ONSET — not
`serverContent.interrupted`, which is a semantic "your turn was cut off" and is
what `RELEASE_WATCHDOG_MS` is written against. That is a reason to measure the
port rather than assume it is mechanical.
