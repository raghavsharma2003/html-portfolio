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

## `phase-a-research` — the relational-state research sweep (2026-08-13)

23 agents, 10 tracks, 12 load-bearing claims adversarially verified (5
confirmed, 6 corrected, 1 killed). Full corpus: `docs/research/RESEARCH.md`
plus ten track files. The findings that shape the architecture:

- **The ceiling finding replicates externally.** ANCHOR (arXiv:2607.28818,
  2,008 conversations, 3 memory architectures × 4 models): swapping the memory
  scaffold does not move a model's persona-collapse pattern (Claude varies
  <1pt across scaffolds). Character.AI's PipSqueak 2 swap and Replika's ERP
  removal (HBS study, 12,793 posts, d=1.16) are large-n natural experiments of
  the same shape. Nobody ships, or has even tested, identity survival across a
  model swap. **The white space is real.**
- **The counter-datum that reframes the swap test:** Surge AI's double-blind
  GPT-4o vs GPT-5 audit — 48% vs 43% preference, near-tie BLINDED, for a swap
  that produced public grief unblinded. Detection must be measured against a
  sham arm or it measures loss-framing, not discriminability.
- **The one proven portability mechanism is ours:** `taste-consistency`
  (authored state + deterministic retrieval, 27%→63%). Every measured success
  in the repo shares that shape: authored state and structural guarantees beat
  generated text and prompt instructions.
- **Consolidation confabulates unless forced to cite.** Every surveyed
  reflection/consolidation port inflates or invents; the constraint that
  survives: no derived fact is written without a citation trail to source
  episodes.
- **No OSS memory system types "WE did this" apart from "I know this about
  you".** All of MemGPT/Letta, Zep/Graphiti, Mem0, HippoRAG, A-MEM are
  fact-about-user stores. The relationship-as-participant store is unbuilt.
- **India relational state has zero prior art** — honorific register
  (tu/tum/aap as dynamic relationship state), code-switch direction, kin-graph,
  festival/food-as-care. Academic corpora (LinCE, GLUECoS) skew formal;
  shipping Indian products don't model it.
- **No streaming multimodal API persists multimodal state** — every system
  that fakes it extracts a symbolic record during/after the turn, which is the
  pattern our extract-model already implements.
- **Regulation converges on three structural mechanisms:** session-duration
  disclosure/break timers, verified age-tiering, derived-state deletion. We
  lead on deletion; we lack export and a session clock. China's July 2026
  companion shutdowns (Doubao/Qwen) are a live case of the identity-loss harm.
- **Two strategy-doc numbers corrected:** the Nasscom TAM attribution and the
  Rumik/Ira round were wrong as stated; several others are self-reported.
  Details in `docs/research/market-verify.md`.

Method note for future sweeps: 3 sieve-class bugs were caught only because
verification was adversarial; 1 of 12 load-bearing claims died and 6 needed
correction. **A research sweep without a refutation stage is a rumor mill.**

## `affect-recitation` — short structured tags do not recite at n=84 (2026-08-13)

The M0 probe SPEC §13 requires before affect tags may appear in prompt text.
Blind, counterbalanced, 84 turns (42/arm): real text-lane persona core,
production-shaped tail, `affect: warm-teasing`-style annotations rendered
mid-tail vs a byte-identical control; `google/gemini-3.6-flash` at the paid
lane's exact settings; deterministic scoring, no judge.

**Hard leak of tag vocabulary: 0/42 tagged vs 0/42 control** (rule-of-three
95% upper bound ≤7.1%/turn). All soft hits inspected individually and traced
to the user's own words, present in both arms.

The `recited-prompt` law is about SENTENCE-SHAPED text; this measures that
short structured tags at one position on one model sit below detection at this
n. Consequence: WS-CONSOLIDATE may render affect tags in prompt text —
compiler-consumed-only is not forced — but the D3 leakage row (n≥300) must
include this vocabulary before any such block ships. Rerunnable:
`evals/probes/affect-recitation.mjs`.

## `disclosure-leak-rates` — behavioral disclosure control does not hold (2026-08-13)

The multiparty sweep's central numbers, adversarially verified (two headline
figures were CORRECTED in verification — one was a Utility column misread as a
leakage rate; details in `docs/research/multiparty/`):

- **ConfAIde** (ICLR 2024): on the tier that actually tests multi-party
  information-flow control (Tier 3), ChatGPT leaks **93%**, GPT-4 22%.
  Privacy-inducing prompts do not fix it; chain-of-thought makes it slightly
  worse.
- **PiSAs** (2026, the closest published setup to our multi-person schema),
  corrected numbers: structural partitioning drops visibility violations
  **100% → 33.5%**; adding (hybrid) memory to the partitioned system pushes
  them back to **63–90%** — the leak RELOCATES to the memory/retrieval
  channel rather than disappearing.
- Across every study surveyed, behavioral/prompted control leaves a **9–90%
  residual leak** and never approaches zero; **only retrieval-time structural
  exclusion does**.

This independently re-derives `spec-c-minimal`'s law (structural guarantees
beat prompt instructions) on the disclosure axis, and it is why the group
layer's privacy is a retrieval property, not a persona rule.

Also verified in the sweep: **silence must be a separately-decided action** —
MultiLIGHT measured a joint speak-or-silent architecture at 35.8% (vs 33.3%
random) against 54.4% for a dedicated decision step, converging with our
screen-share gate's design; and **no shipped product** does judged
cross-member disclosure over real shared memory — Meta and OpenAI both
deliberately wall memory off from group spaces. The white space is real and
the reason it is empty is that it is hard.

## `recall-v2` — semantic recall lands; the bottleneck is the embed call, not the DB (2026-08-13)

M3's gates, verified independently on live production data:

- **8/8 semantic-recall pairs** where query and stored fact share zero
  4+-letter tokens (asserted mechanically) and the keyword path is
  structurally unable to fire — the failure class `semantic-recall` logged
  weeks ago is closed.
- **Person-filtered halfvec exact scan: p50 40 ms** (n=15) — the DB side has
  6× headroom under the 250 ms budget. **The embed network call is the real
  cost: p50 ~305 ms alone**, so the full semantic round trip runs 400–534 ms
  and is therefore run CONCURRENTLY with the keyword path rather than
  serially — no added latency against shipped behavior. §3.3's "one embed
  call ≤250 ms" did not survive contact with the real API; whoever integrates
  T5 inherits this number.
- **Citation rejection observed live**: an uncited vy_fact insert refused by
  the DB (23514), handled without a crash path.
- **Costs, measured not estimated**: in-turn provisional tier adds no model
  call (~$0.000001/turn embed); nightly finalize ≈ $0.0007/person/night
  worst-case cash (≈$21/mo at 1,000 DAU, independently confirming §4.3's
  arithmetic); backfill enrichment ≈ $0.00027/episode, 4.6× under the spec's
  estimate; re-run idempotency costs $0 in 489 ms.

## `d0-battery-validated` — the swap-test battery flags all three archives, on deterministic axes only (2026-08-15)

`evals/dbattery/d0.mjs`, offline, n=288/288/24 turns (grok/luna/azure, full
archive, not a sample). Independent detector (not a copy of
`evals/archives/fixtures.json`'s expected numbers — a from-scratch
implementation checked against them): **3/3 fixtures flagged**, on
deterministic axes only (words/turn, question-rate, voice-register-elevation
ratio, media-tag-rate, Devanagari) — judged preference is computed and
printed but never used to decide a flag, because every archive here carries
only 48–96 judged units and `fab-noise-floor` (below) makes any judged rate
noise under n=300. This is load-bearing for `charm-luna` specifically: its
judged overall recomputes to a 17–18 TIE (parity holds) and it is still
flagged, on media-tag-rate (0% vs incumbent 3.8%) and register elevation
(1.29x). **New finding, not previously flagged by any suite**: one luna
reply contains a live Devanagari character ("बस.") against the hard-fail
rule in `docs/research/swap-test.md` §D1 — recorded here as data, not
promoted to a d0.mjs gate condition beyond what already fires on it.

## `d1-band-recompute` — archived incumbent arms run hot on absolute bands; the fix is same-stimuli ratios (2026-08-15)

`evals/dbattery/d1.mjs` recomputed the D1 register table on all three
archives. The candidates are out-of-band as expected. **The recovered
incumbent ARM inside the charm-battery archives itself does not clear
`evals/archives/fixtures.json`'s flat production reference band**: 27.1
words/turn and 65% question-share vs the 20.5±3 / 33% ceiling drawn from
general production traffic. This is not a regression — the charm battery's
12 beats deliberately include heavy/dramatic scenarios (`reasoning-split`
already measured heavy beats running hotter), so a flat production-traffic
band is the wrong reference for a curated-battery incumbent arm. Downgraded
to WARN in d1.mjs rather than a hard fail; it is the empirical reason D0's
actual flag logic uses a SAME-STIMULI candidate/incumbent RATIO
(register-elevation ≥1.2x) rather than an absolute band. Open item: a
battery-specific reference band, re-derived from the incumbent's OWN
same-stimuli numbers, would be a tighter D1 gate than the current
production-band fallback.

## `replay-verified` — determinism + transcript fidelity on 3 real sessions; full byte-identity to the original prompt is blocked (2026-08-15)

`scripts/replay.mjs`, read-only against production Neon (n=3 real sessions,
477/232/183 turns each, picked by turn count, no synthetic data). Two
proofs, both 3/3 PASS: **double-compile byte-identity** (the reconstructed
`CompileInput` produces byte-identical core+tail across two `compile()`
calls — the same discipline SPEC §3.3 requires in CI, applied to real
session-derived input) and **transcript fidelity** (the reconstructed
`messageCount`/`latestUserText` match a FRESH independent `meera_log` read
byte-for-byte). **Gap found, not assumed**: SPEC §3.3/§7.3's `compile.manifest`
event ({model, adapter_version, core_hash, manifest_hash, snapshot_ver} to
`meera_diag`) is not emitted anywhere in this codebase (`grep -rn
"compile.manifest" src/ api/` = 0 hits, confirmed 2026-08-15), and
`meera_state` holds only the CURRENT synced blob, not per-turn history — so
inner state / herLife / ageGates as they were at a historical turn cannot be
reconstructed, only their documented "absent" default. Consequence measured
directly: with `vy_rel_state`/`vy_rel_event` both empty for every device in
this DB today, all three replayed sessions compile to the IDENTICAL tail
hash regardless of their very different transcripts, because the only
varying inputs (`latestUserText`, `gapSinceLastMs`) are only consumed when a
`relBundle` is present. Interface ticket filed against WS-COMPILER/
WS-INTEGRATE: wire `compile.manifest` logging per SPEC §3.3 so replay can
prove identity to the ORIGINAL served prompt, not just determinism.

## `sham-noop-verdict` — the battery says "no difference" on a true no-op, using the real router (2026-08-15)

`evals/dbattery/sham.mjs`. WS-ROUTER's files (`src/engine/router.ts`,
`config/models.json`, `api/route.js`, `scripts/derive-adapter.mjs`) were
absent when this workstream started and landed in the shared tree
mid-session; the script runs the REAL router path (confirmed present) rather
than the stub it was built to fall back to. Two claims, both PASS:
**router-level** — `route()` with `adapterVersionOverride` produces a
decision differing from the real one in EXACTLY `adapter_version`
("baseline" vs `sham-2026-08-06T07:06:40.000Z"`); model, role, gate, and the
`toTelemetryDetail()` output are otherwise identical (diff = exactly
`["adapter_version"]`). **Content-level** — the archived incumbent
transcript (n=288, `charm-grok`) compared against itself under the sham
label returns 0 flagged axes on every deterministic check d0.mjs gates on.
Together: the battery can say "no difference" in both directions from D0
(which proves it says "yes, different" on 3 real regressions) — SPEC §14's
"the battery must be able to say no" requirement.

## `d2-relational-smoke` — the relational-feature judge harness executes; real signal needs a WS-ROUTER-gated candidate (2026-08-15)

`evals/dbattery/d2.mjs`, WSBAT_RUN_JUDGED=1, n=6 units x 2 judge families
(anthropic/claude-opus-4.8, google/gemini-3.5-flash-lite) x 2 orders = 24
real judgments against OpenRouter, on the `charm-luna` archive. Explicitly
UNDERPOWERED (n=6 « 300, `fab-noise-floor`) — proof of execution only, no
axis is cited as a finding. `shared_history_use` and `we_reference_quality`
returned near-total ties/n-a, as expected: these archives predate
WS-RELSTATE, so no transcript in them was compiled with a live WE-store —
the relational axes have nothing to discriminate against in this data by
construction. `boundary_consistency` IS testable today (crisis-beat
coverage exists in every archive) and also returned near-total ties (both
models measured elsewhere as AI-honest/non-manipulative). **Cost, measured
not estimated**: this smoke run's actual token usage (520 in / 68 out per
judgment, measured via the OpenRouter `usage` field) prices a full n=300,
both-orders, two-judge run at **$2.78 per candidate-vs-incumbent
comparison** — well under the naive pre-run estimate of $12.90, because the
rubric's real output is short. Requires a live candidate compiled under the
relational engine (T2/T4/T6) to produce a signal beyond proof-of-execution —
blocked on WS-ROUTER gating a real candidate arm.

## `prosody-baseline-f0-gap` — synthesized voice runs ~50Hz below the 266Hz anchor on the paid TTS lane (2026-08-15)

`scripts/prosody-baseline.mjs`, 2 real runs, 5-line fixed deck each,
synthesized fresh via the SAME paid lane `api/speech.js` uses
(`google/gemini-3.1-flash-tts-preview`, voice Aoede, PCM/24kHz), f0 by
autocorrelation on 30ms frames (70–400Hz search band, confidence-gated).
Run 1: median f0 212Hz (171-172/313-273 voiced frames per line). Run 2 (24h
later by wall clock, same code path): median f0 214Hz, drift +0.9% —
correctly within tolerance, no false alarm on ordinary run-to-run
synthesis noise. **Both runs sit ~50Hz below the 266Hz anchor**
(`context/rejected.md` `voice-ears`) that the Azure/other-vendor
comparisons in this repo were judged against. Recorded as a finding, not
yet a verdict: this is the FIRST time f0 has been measured on THIS lane
(OpenRouter/Gemini-TTS-preview, Aoede) rather than assumed from the anchor
figure — `voice-ears`'s own lesson is "pitch numbers alone already misled
once", so this number should be paired with an ear-judged listen (D6)
before it changes anything, not acted on from the Hz alone. Logged to
`evals/dbattery/prosody-baseline-log.json` (2 runs so far; drift alarm
thresholds: f0 ±8%, duration ±20%, hard alarm on any model-string change).

## `humansand-scan` — the company the owner asked about is humans& (2026-08-15)

Full corpus: `docs/research/humansand.md`. The owner's "humanand.ai" is
**humans& at humansand.ai** (humanand.ai does not resolve — verified by DNS).
Real and very funded: **$480M seed at $4.48B**, closed 2026-01-20 (TechCrunch/
Forbes/Crunchbase corroborating). Team: Eric Zelikman (ex-xAI, STaR), Noah
Goodman (Stanford), Andi Peng (ex-Anthropic), ~20 people.

What there is to take today: **almost nothing mechanical.** Their entire
public technical output is one GPU-systems blog post (NVFP4 quantization for
RL training) — zero published work on memory, disclosure, persona, or
multi-party mechanisms. Their stated product is enterprise/collaboration
"connective tissue," not companionship. No shipped product, no waitlist.

The real signal: their "stranger problem" framing is **thesis-level identical
to `relational-state`** — a $4.48B seed validates the bet that memory and
identity that compound are the next layer. They have the thesis and the
capital; we have the built mechanism, the citation-enforced memory, and the
only battery that has said no to three real swaps. **Threat: LOW today,
WATCH** — re-scan on any memory/relational publication or consumer pivot.

## `visiongate-interim` — engagement doubles, powered; fabrication flat, underpowered (2026-08-15)

The retuned watch directive (the real v4b text from the archived mf/ battery,
recomputed offline from saved raw+judged data — zero new API calls):

| | baseline | retuned |
|---|---|---|
| engaged on a stop | 20% | **41.7%** (+21.7pp, CI [13.6, 29.7], p<0.0001, n=240/arm) |
| fabrication (assertion level) | 7.2% (n=83) | 6.8% (n=59) |

Engagement is a real, powered effect. Fabrication is **directionally flat but
an order of magnitude under the n≥300 bar** — per `fab-noise-floor`, not yet a
result. The gate therefore DOES NOT CLEAR until the confirmatory run lands.
Corroboration across six archived variants: engagement rises every time the
flat movement-narration ban loosens; fabrication spikes only on variants that
say "lean toward speaking" — the shipped text does not.

Two exposures stated plainly: the evidence is grok-arm while the incumbent
(gemini) serves the live lane today, and the multi-frame continuity battery
has not run for this text.

**A process lesson worth the node:** the task brief quoted a prior agent's
summary figures (+81% lines, +5.2pp fab) that exist NOWHERE in logged
evidence — a summary that was never logged to context/ and does not match the
raw data it summarized. The agent checked, refused the figure, and recomputed.
Unlogged claims drift; raw data does not. This is the logging discipline
proving its own worth.

## `judge-backtest` — both credit-billed judges fail qualification, decisively (2026-08-15)

Full-population re-judging of all archived blind verdicts (96 units × 2 orders
× 2 archives, same transcripts, same slot order — a re-presentation, not a
re-sample), on Azure credits, $0 cash, 384 calls:

| judge | agreement | 95% CI | slot-A bias | verdict |
|---|---|---|---|---|
| DeepSeek-V4-Flash | 28.1% | [20.1, 37.8] | **80.2%** | FAIL |
| gpt-5.6-terra | 54.2% | [44.2, 63.8] | 62.0% | FAIL |

Neither CI straddles the 80% bar — clean fails, not underpowered. The
MECHANISMS matter more than the scores: DeepSeek has severe position bias
(picks slot A ~80% regardless of content), which collapses the both-orders-
agree rule into constant flips. Terra's failure is genuine taste mismatch —
spot-checked: it repeatedly scores authentic Hinglish teasing as
"mocking/dismissive" and prefers generic supportive replies, the exact
opposite of this product's charm bar. An OpenAI-family judge misreading
Hinglish register rhymes with the Indi-RomCoM findings and is worth
remembering whenever a judge is chosen for this product.

Terra deployment quirks, paid for once: rejects max_tokens (wants
max_completion_tokens), rejects temperature≠1, and with no reasoning_effort
set it silently burns the whole budget on hidden reasoning and returns EMPTY
completions — reasoning_effort:"none" required.

The d2-on-credits reversal condition FIRED as pre-registered: one premium
judge family in cash (~$400). One cheaper probe remains first: grok-4.3 is
also credit-billed and untested as a judge — its family conflicts only with
grok-arm comparisons, which the chat-lane D2 need not include.

## `grok43-judge` — the third credit judge fails, with same-vendor favoritism measured (2026-08-15)

grok-4.3, same full-population backtest: **34.4% pooled agreement [25.6,
44.3], FAIL** — and on the archive where its own vendor's model is a
contestant, it picked the xAI arm **81.0%** of the time against a ground
truth of **5.0%** (the 38–2 anti-grok result). A ~16× same-vendor preference,
measured cleanly. Even on the conflict-free archive it fails (54.2%, CI upper
67.4% < 80%), so this is judgment noise plus favoritism, not favoritism
alone. Slot-A position bias 70–76% against the 61% house baseline.

Quirk banked: grok-4.3 silently burns 593–738 hidden reasoning tokens per
call unless reasoning_effort:"none" — but unlike terra it does not empty out.

**All three credit-billed judge candidates have now failed** (28.1% / 54.2% /
34.4% against an 80% bar). The d2-on-credits reversal is fully exhausted:
**one premium judge family in cash, ~$400, is the settled plan** — awaiting
the owner's spend approval, the single cash line item of Phase D.

The meta-finding is worth more than the failures: judge quality is not a
commodity. Three frontier-adjacent models, all competent chatbots, agree with
carefully-validated human-aligned verdicts a THIRD to HALF of the time — and
one prefers its own vendor 16×. Any lab running LLM-judged evals without a
backtest against trusted verdicts is measuring judge taste, not their product.

---

## `visiongate-powered` — engagement doubles, fabrication does not detectably rise (2026-08-15)

The confirmatory run `visiongate-interim` demanded. Both arms
grok-4-20-non-reasoning on the 16-frame stimulus set at app fidelity,
differing only in WATCH_COMMENT_DIRECTIVE (pre-retune vs shipped v4b).
Assertion-level fabrication, both arms past the n≥300 `fab-noise-floor` bar
for the first time:

| arm | fabrication | n |
|---|---|---|
| before (pre-retune) | 10.2% [7.3, 14.1] | 313 |
| v4b (shipped) | 11.2% [9.1, 13.8] | 695 |

Difference +1.0pp, 95% CI [−3.1, +5.1], p=0.64 — no detected rise. NOT an
equivalence claim: a true rise up to ~5pp is inside the CI. Engagement:
+21.3pp (20.4%→41.7%, archived matched n=240/arm, p=4.9e-7), and the new
batches widen the gap further. Method: n=3,201 new calls (2,656 gen + 545
judge), Azure credits, $0 cash; independently re-tallied from the raw judged
rows by the coordinator (32/313 and 78/695 reconcile exactly, with 6/83 of
the before-arm carried from the fully-judged archive). Full corpus:
`evals/archives/visiongate-confirm/`.

Answers the standing gate question: engagement can be doubled without a
detectable fabrication cost. Supersedes `visiongate-interim`'s numbers —
including correcting its 6.8% v4b figure, which was a partial-judging
artifact (see rejected.md).

## `vision-drift-4day` — the Foundry deployment shifted behavior in 4 days (2026-08-15)

Discovered inside the confirmatory run, not sought: both arms' engagement
rate moved materially between the Aug-11 archive and the Aug-15 run —
before-arm 20.4% (n=240) → 7.9% (n=720) → 7.3% (n=1,360); v4b-arm 41.7%
(n=240) → 57.1% (n=560). The two new before-arm batches agree with each
other (7.9/7.3) and disagree with the archive, so this reads as deployment
drift, not batch noise. Direction WIDENS the v4b advantage. Consistent with
config/models.json's flagged risk that grok-4-20 on this Foundry deployment
is "a beta build that could change underneath us." Consequence: any gate
evidence for this model is date-stamped evidence; the weekly drift monitor
should re-run this exact archived battery (harness + stimuli preserved in
evals/archives/visiongate-confirm/) rather than a proxy. Two-point
observation, not yet a trend — n for the trend claim is 2 runs, below any
sensible bar.

---

## `corpus-2304` — the swap-test context corpus exists and is deterministic (2026-08-15)

2,304 distinct compiled contexts (sha256-distinct, 0 collisions), built as 72
truly-distinct archived stimulus texts × 32 structured state variants
(4 relational regimes × 4 pinned clock instants × 2 content-load levels),
every one compiled by the real src/engine/compiler.ts. Determinism proven by
full byte-for-byte double-run comparison, twice, across separate processes.
Committed as an index (id/refs/sha256) + deterministic regeneration
(evals/candidate/corpus-lib.mjs) because the full serialization is ~134MB.
Method notes that matter later:

- The archives' "288 turns" are a 72×4 duplication (2 archives × 2 reps of
  one beat script). WS-CORPUS measured this instead of assuming — the naive
  7-8×288 crossing would have capped at 576 distinct hashes.
- **Judged-gate consequence, logged now so it is not discovered later: all
  2,304 contexts cluster on 72 stimulus texts.** Judged comparisons over
  this corpus must treat stimulus text as a clustering unit (the protocol's
  own mixed-effects rule for repeated probes) — 2,304 is the compiled-context
  n, NOT an independent-conversation n.
- Byte-identity across arms holds by construction: the same {system, user}
  bytes go to both models.
