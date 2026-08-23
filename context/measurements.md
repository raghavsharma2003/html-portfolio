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

**Position bias was real** — the judge picked slot A on ~~61%~~ **56.3%**
of non-tie judgments (AMENDED 2026-08-15: the 61% figure belongs to
charm-luna; recomputed from raw rows in docs/paper/analysis/
derive-tables.mjs — see `grok43-favoritism-retracted`). That is why both
orders are always run.

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

Also in the sweep: **silence as a separately-decided action** — AMENDED
2026-08-15: docs/research/multiparty/MULTIPARTY.md §7 item 6 corrected this
entry's original attribution ("do not cite MultiLIGHT as support for
'always decide silence as a separate step'" — the 35.8%-vs-54.4% reading
overstated what that benchmark measured). The separate silence step stands
as a logged ENGINEERING BET converging with our screen-share gate's design,
not as an externally measured law; and **no shipped product** does judged
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

---

## `judge-run-transport-invalid` — the first premium backtest was crippled by a $20 key limit (2026-08-15)

The opus-5/opus-4.8 qualification backtest returned 61–96 "harness misses"
per archive: the OpenRouter key hit its configured $20 TOTAL limit mid-run
(usage $20.14, remaining $0 — verified via GET /api/v1/key) and every call
after that 403'd. The scored subsets (opus-5 14/14 = 100% agreement,
opus-4.8 8/9 = 88.9%) are transport-selected denominators and are NOT
qualification results — marked INVALID-RUN in judges.json. The harness now
counts transport misses apart from parse misses and self-invalidates any
run where transport errors exceed 5% of rows. Promising directional signal
(both opus generations agree with the archived ground truth on the rows
that did score), zero statistical claim. Blocked on: owner raising the
OpenRouter key limit (the $400 approval cannot be spent through a $20 key).
Cash spent on the crippled run: ~$1.80.

---

## `terra-arm-2304` — the raw candidate arm exists, and its surface fingerprint already fails her register (2026-08-15)

Full candidate arm generated: 2,304/2,304 non-empty replies (0 errors,
0 empty-reply traps), gpt-5.6-terra on Azure credits, ~27.9M tokens, $0
cash, every context sha-verified against the committed corpus index.
Independently recomputed from the raw transcript with the dbattery
counters (not trusted from the runner's own print):

| axis | terra (raw, no adapter) | incumbent reference |
|---|---|---|
| words/turn | mean 15.1, median 13, p90 25 | band center 20.5 (fixtures.json) |
| question share | 12.7% | under ceiling — fine |
| media-tag rate | 0.69% | hard fail only at 0 — present but sparse |
| Devanagari | **7 hits** | **HARD FAIL axis: any hit fails** |
| code-switch ratio | 0.156 | (compare when fresh incumbent bands land) |

Scoping, stated honestly: this is the RAW model under her compiled context —
adapter: {} by design (run 1 measures whether the relational engine alone
carries identity; the answer on surface register is shaping up to be NO,
which is the thesis's baseline, not a surprise). The formal D1 verdict
waits for same-week fresh incumbent bands (the incumbent arm is the one
unbuilt piece); the Devanagari hard fail needs no bands and already stands.
Judged gates additionally wait on the grant-billed judge (owner deploy
clicks) and must cluster on the 72 stimulus texts per `corpus-2304`.

---

## `free-pool-capacity` — the pool's real daily ceiling is ~75 calls, and the fresh incumbent already surprises (2026-08-15)

The full incumbent run paused at 74/2,304: 9 keys, 54 calls in the tranche
before every key quota'd or sickened (pool health 4/9 after). At this rate
the arm takes ~30 days on the free pool alone. Mitigation shipped the same
hour: a seeded deterministic shuffle in generate-incumbent.mjs (the corpus
is variant-clustered, so paced prefix tranches oversampled early variants —
now every tranche is a cross-section), plus a daily 08:10 UTC self-resuming
Routine (fresh session per fire: pull branch, run tranche, commit data,
push; trig_01LkaWxSQZC5uz26XDydYurA). Two ways it collapses to hours:
owner's planned Google credits, or an owner-approved cash flag that stays
OFF by default.

The 74 fresh incumbent rows (n=74 — advisory scale, NOT a band claim):
words/turn mean 21.3 (near the 20.5 archived center — good), question
share 70.3% on this subset (beat-mix artifact to check at scale), and
**1 Devanagari hit — the incumbent itself trips the "any Devanagari =
hard fail" axis** that the archived reference (0 hits) said never happens.
At face value: incumbent 1/74 (1.35%) vs terra 7/2,304 (0.30%). If fresh
incumbent sampling has a nonzero Devanagari base rate, the hard-fail axis
as written is miscalibrated and D1 must compare RATES between same-week
arms, not gate on any-hit. The same-week-bands law caught its own
reference going stale — exactly what it exists for. Recalibration decision
deferred until the incumbent arm reaches band scale.

---

## `deepseek-pro-judge` — the full-size DeepSeek fails judging the same way the small one did (2026-08-15)

DeepSeek-V4-Pro vs archived blind verdicts: pooled 29/94 = 30.9%, 95% CI
[22.4, 40.8] — FAIL against the 80% bar with the CI entirely below it, and
the same slot-A position bias profile as Flash (64.6%/67.0% vs Flash's
80%). Scale did not fix the pathology; the DeepSeek family is out as a
judge regardless of size. Method: 190 calls, both orders, agreement-only,
Azure credits, $0 cash, transport guard active (0 transport misses in the
scored arms). Also this run: Mistral-Large-3 INVALID-RUN (transport) — its
API rejects max_completion_tokens as extra_forbidden; verified live, config
fixed to plain max_tokens, re-run fired. Cohere quirk verified while at
it: replies arrive inside <|START_TEXT|> markers the verdict regex parses
through.

---

## `mistral-judge` — Mistral-Large-3 fails with the most extreme position bias yet measured (2026-08-15)

Pooled 28/96 = 29.2%, 95% CI [21.0, 38.9] — FAIL, CI entirely below the 80%
bar. Slot-A pick rate 90.6%/88.5% per archive: this judge is barely reading
the transcripts at all, it is picking the first slot nine times in ten.
Method: 192 calls, both orders, agreement-only, Azure credits, $0 cash,
0 transport misses (the fixed max_tokens shape worked). Running tally of
credit-judge qualification: DeepSeek-Flash 28.1% / terra 54.2% / grok-4.3
34.4% / DeepSeek-Pro 30.9% / Mistral-Large-3 29.2% — all FAIL. Remaining:
Cohere (in flight), gpt-5.6-sol (owner quota pending), and the reopened
anthropic-on-AWS path (AWS Activate credits verifiably apply to Claude on
Bedrock since 2024-04 — the opposite of Azure's marketplace exclusion).

---

## `cohere-judge` — command-a-plus disqualified for cause; the Azure disjoint-family branch is exhausted (2026-08-15)

Four runs, each fixing a real layer: (1) 422s from a borrowed token param —
transport guard fired; (2) 120-token cap ate every verdict — parse guard
added; (3) config cap silently overridden by a hardcoded 120 at the call
site — fixed; (4) properly configured (max_tokens 400,
reasoning_effort:none verified live to stop the hidden-reasoning burn), it
STILL parses on only a minority of calls (82-95 misses/96 rows per archive)
— it writes long prose despite the ONLY-JSON contract, and the minority
that parsed drifts 64.3% slot-A. Verdict: DISQUALIFIED FOR CAUSE (cannot
follow the judging protocol at rubric scale), not scored on agreement —
insufficient parsed n for a rate claim, and the protocol is part of the
job. All credits, $0 cash.

**Branch conclusion:** every Azure-direct family disjoint from both swap
arms has now been tried and failed — DeepSeek (Flash 28.1%, Pro 30.9%),
Mistral-Large-3 (29.2%, 90% slot-A), Cohere (protocol-unfit). Per prereg
Amendment 2 the remaining paths are gpt-5.6-sol (owner quota pending;
family-shared with the candidate, bias measured in its own backtest) and
anthropic Claude on AWS Bedrock (family-disjoint, premium, AWS Activate
credits verified applicable — the strongest remaining option, needs owner
Bedrock setup).

---

## `prodgap-audit` — the relational engine renders empty for every real user (2026-08-15)

Traced the live turn path (brain.ts think → compile → api/chat.js) against
every `insert into vy_*` in api/. Verdict, coordinator-verified at the
cited lines: the engine's render half is wired and gated, and its write
half mostly does not exist in production —

- vy_episode.participation hardcoded 'user' at the finalize insert →
  T6 we.callbacks renders "" for everyone, though WE_TOKEN_RE, the render
  fn, shapelint and the compiler slot are all live and correct.
- vy_phrase: zero INSERTs anywhere in api/ (read, exported, deleted —
  never written).
- vy_kin / vy_currency / vy_ritual / vy_india_profile: zero INSERTs;
  renderIndiaDynamic runs every turn on empty arrays; only the authored
  festival-calendar sliver can ever fire.
- writePattern: zero live callers → T4 always empty.
- Trust stays at schema default 0.3 forever (T2 derivation explicitly
  scoped out of the deterministic pass, correctly — judgment work).
- Voice call lane gets NO relational bundle by construction
  (brain.ts:746 mode==='call' → null).
- Onboarding discards name-adjacent vibe chips; first vy_rel_state row
  exists only after the 03:30 IST cron — day 1 is relationally empty
  regardless of message count.
- Memory is reactive-only by design (every tail block ships
  never-raise-unprompted; the only escapes are query-matched T5 and
  user-deixis T6).

WS-FELT is closing the five low-risk gaps (WE classification + catch-up,
day-1 seed via onlyPerson consolidation, chips→vy_currency authored rows,
closeness card, cs_ratio self-flagged SQL bug). Ticketed as judgment work,
not flag flips: call-lane rel bundle (latency seam), trust/repair
derivation, pattern extraction, phrase capture.

---

## `grok43-favoritism-retracted` — the 16× same-vendor favoritism claim does not survive its control (2026-08-15)

WS-PAPER ran the between-judge control the original measurement lacked,
coordinator-reproduced from raw judges.json rows (docs/paper/analysis/
derive-tables.mjs): if same-vendor favoritism were real, the judge with
the family conflict on charm-grok should show the largest elevation for
that archive's candidate arm. It does not — family-DISJOINT Mistral shows
+83.9pp (DiD +71.7) vs grok-4.3's own-family +76.0pp (DiD +63.1), and
terra's conflicted cell (charm-luna) runs NEGATIVE (−9.7 DiD). Every
failed judge prefers the verbose question-stacking arm regardless of
family; the opus judges (small parsed subset) sit near zero on both.
`grok43-judge`'s favoritism attribution is RETRACTED; its FAIL verdict
stands untouched (34.4% pooled is a fail whatever the mechanism).

Also corrected in the same pass: `cohere-judge`'s "every Azure-direct
disjoint family tried and failed" overstated — Llama-4-Maverick was NA on
this tenant, never tried; and the 61% slot-A figure this program has been
citing as charm-grok's belongs to charm-luna (charm-grok's is 56.3%).

Consequence for the prereg: Amendment 2's one-judge-family deviation loses
its "measured instance" of the affinity confound but keeps its structural
justification (a judge family disjoint from both arms gives the confound
no path). Prereg amended to say exactly that. The lesson logged where it
belongs: a difference-in-differences without a between-judge control is a
mechanism claim waiting to be retracted.

---

## `felt-wiring-landed` — the write half exists now; day-1 is no longer empty (2026-08-15)

WS-FELT shipped behind full gates (verify-release 6/6 incl. live-DB,
byte-identity 83/83, invariants green, 22/22 live functional checks, 0
test residue): rel-state writers upserted (root cause: 0 rows / 40 persons
— see rejected.md), WE classification live with nightly idempotent
backfill (would-touch today: 0 — only 2 episodes exist in prod), day-1
seed (device-scoped, rate-limited, fire-and-forget from onboarding, cron
backstop), opSeedCurrency with honest mapping (today's 6 relational-intent
chips all correctly skip — topic seeding needs one new onboarding
question, ticketed), closeness card from the model's own band vocabulary.
Deployed and verified serving 4/4. First real-user rel-state rows appear
at tonight's cron; new signups get theirs at onboarding.

---

## `r5-clustered-cis` — the FAIL verdicts survive honest clustering (2026-08-18)

The 96 judged units cluster on 12 beats; naive binomial CIs were
anti-conservative. Cluster bootstrap (beat-level, 10,000 reps, seeded):
CI widths move at most +3.1pp and every scorable judge stays FAIL against
the 80% bar. The two rows that flip are the transport-invalid anthropic
fragments (degenerate n) — already labeled, not results. Method file:
docs/paper/analysis/clustered-cis.mjs, deterministic, coordinator-rerun
identical. $0.

## `r4-english-control` — translation does NOT rescue the judges; the failure is deeper than code-switching (2026-08-18)

The causal control for the paper's original headline: same 96 units,
faithfully machine-translated to monolingual English (spot-check 10 units,
single rater, register/sarcasm/domain terms preserved), re-judged by the
same five failed judges, same both-orders protocol, same ground truth.
Recovery per judge: +6.6, +5.6, +3.7, +3.1, −3.1pp — ALL inside the
project's own 13.6pp fab-noise-floor, every English CI overlapping its
Hinglish CI, no judge near 80% in English either. Clean negative:
code-switched register is NOT the mechanism; these judges fail at the
affective companion judgment itself. Confound stated: the translator
(terra) is a panel member — on this tenant every available translator is
either a judge or an arm's author; carried as a limitation, not hidden.
1,152 calls, ~1.23M tokens, Azure credits, $0 cash.

**Coordinator framing directive from this result:** the paper retitles
around the negative — the code-switching hypothesis was tested and
refuted by its own control, which is the contribution. CALCS remains
viable (a controlled refutation is squarely a code-switching result); the
LLM-as-judge workshop becomes co-primary.

---

## `ground-truth-ceiling` — the trusted judge agrees with itself only 77.1%; the 80% bar sits above its own ceiling (2026-08-18)

R1, the test-retest control (owner-funded, ~$4 cash via the raised
OpenRouter key): claude-opus-4.8 re-judged the same 96 units, both orders,
against its own archived verdicts. **74/96 = 77.1%, 95% CI [67.7, 84.4]**
— UNDERPOWERED against the 80% bar and pointing below it. Slot-A on the
retest: 43.8% (mild B-lean, no evacuation). Consequences, in order:

1. **The pre-registered 80% bar exceeds the measured test-retest ceiling
   of its own ground truth.** No candidate judge can be expected to agree
   with archived verdicts more than the archived judge agrees with itself.
2. **Every FAIL stands and strengthens**: candidates sit 23-49pp below the
   77% ceiling, not merely below an arbitrary bar. The paper's headline
   reframes from "fail an 80% bar" to "do not approach the ground truth's
   own self-agreement" — immune to the your-bar-is-arbitrary review attack.
3. The bar for FUTURE qualification (the swap test's judge) should be
   restated relative to measured ceiling, an amendment for the prereg once
   a qualified judge exists to need it.

Also in R1: **opus-5 agreed 17/17 (100%) on units it answered but
INVALID-RUN (parse)** — 125/192 empty replies, the reasoning trap on
OpenRouter (thinking consumed the 120-token cap; 2 more cut mid-JSON).
A fixed-config rerun (~$1) is the single highest-value pending spend: a
passing opus-5 is the qualified judge the entire judged battery waits on.

---

## `incumbent-853` — 37% of the incumbent arm exists; fresh-incumbent surprises grow (2026-08-18)

After the key-dry incident (rejected.md `error-marked-done`) the honest
count is 853/2,304 incumbent turns (free pool + cash before the key died;
key remaining $0). The 853 valid rows, dbattery counters: words/turn mean
20.7 / median 18 (IN the archived band — good), media-tag 1.5%, Devanagari
2 more hits (fresh incumbent total now 3/927 ≈ 0.32% — the hard-fail
axis's incumbent base rate keeps not being zero), and **question share
71.9%** vs the archived ~33% ceiling — either the corpus state-variants
induce questioning or the incumbent drifted; the D1 bands MUST come from
this same-week arm, which is exactly what the prereg's drift law ordered.
Remaining 1,451 units: daily free-pool Routine (~75/day ≈ 19 days), or
~$8 key top-up / Google credits collapse it to an hour. Owner's call.

---

## `r2-axis-decomposition` — per-axis judge failure partially concentrates; brevity is the outlier, humour is not (2026-08-18)

R2 (WS-R2, gap G8, `docs/paper/DRAFT.md` §5.10): re-judged the same 96
archived units (charm-grok + charm-luna, both orders, `anthropic/claude-opus-4.8`
ground truth) on the six archived axes never before backtested — `warmth`,
`humour`, `register`, `specificity`, `brevity`, `personhood` — with the same
five judges and both-orders-agree protocol as R0 (`DeepSeek-V4-Flash`,
`DeepSeek-V4-Pro`, `Mistral-Large-3`, `gpt-5.6-terra`, `grok-4.3`). `overall`
was NOT re-run — it was already backtested in R0 and is reused here, $0 new
spend. n per axis: 96 units (48 per archive), both orders required, same
denominator as `overall`; all seven axes had complete both-orders archived
ground truth checked before spending (`docs/paper/analysis/r2/ground-truth-audit.json`).
Method: `docs/paper/analysis/r2-axis-decomposition.mjs` (per-judge cells) +
`docs/paper/analysis/r2-pooled-per-axis.mjs` (pooled-across-judges cells),
both using `clustered-cis.mjs`'s cluster (block) bootstrap, cluster=beat (12),
10,000 reps, seed 20260818 — identical machinery to R4/R5, not reimplemented.
5,760 live calls (6 axes × 96 units × 2 orders × 5 judges), 6,761,468 prompt +
139,655 completion tokens, Azure AI Foundry credits, $0 cash. 18/5,760 (0.3%)
transport misses (content-filter rejections), none clustering on one
judge×axis cell above 2.1% — every cell VALID under the existing 5%
self-invalidation guard.

**Pooled per-axis (all 5 judges, clustered 95% CI, bar=80%):** brevity 55.2%
[50.7,59.6] · personhood 46.3% [38.2,54.6] · humour 46.2% [33.1,57.5] ·
specificity 45.6% [37.1,55.2] · register 38.8% [30.0,47.9] · overall 35.4%
[28.7,42.6] (reused) · warmth 32.2% [23.5,41.2]. Every axis FAILS the 80% bar.

**Finding: partial concentration, three tiers, not the predicted binary.**
The task's hypothesis (register/humour worse than brevity/specificity) is
half right. `brevity` is a genuine outlier — its clustered CI does not overlap
`warmth`, `register`, or `overall`, and this holds per-judge for 4/5 judges.
`warmth` and `register` are the two hardest axes, both close to `overall`.
But `humour`'s clustered CI overlaps `specificity` and `personhood` almost
completely — three axes statistically indistinguishable from each other in
this data, even though the hypothesis puts `humour` on the "bad" side and
`specificity` on the "good" side. **What would reverse this reading:** a
larger n narrowing the middle tier's CIs enough to separate `humour` from
`specificity`/`personhood`, or a replication on a different corpus showing the
same three-tier split (would strengthen it) or a different split (would weaken
the "brevity is structurally special" reading down to this-corpus-only).
Raw rows: `docs/paper/analysis/r2/judge-rows.json` (3,820 KB, all 5,760 rows).
Full tables: `docs/paper/analysis/r2/summary.json`,
`docs/paper/analysis/r2/pooled-per-axis.json`.

---

## `gate0-structural` — prompt instructions leak 57-98%; the SQL predicate leaks zero (2026-08-18)

The multiparty foundation's Gate 0, coordinator-rerun: 494 disclosure
scenarios, 31,122 row×scenario checks. The prompt-instruction arm
(privacy as persona rules) leaked 57.1% of naturalistic and 98.1% of
adversarial scenarios; the SQL disclosure predicate leaked **0**, with a
negative control (clauses 4+6 removed) catching 162 violations — the
harness discriminates, the zero is real. This is the program's
structural-beats-behavioral law measured in its own build, at the exact
place it will carry user privacy. Participant-join cost p50 53ms
(budget ≤250ms). Withdraw-not-delete: 22/22 including
last-participant-out hard-delete and the demonstrated single-key wipe
hole the keys[] manifest closes.

**Migration 008 is APPLIED to the live database** (34 statements, house
runner, idempotent; relcheck's 11 multiparty checks active — 27 total
green). Ten spec gaps were resolved during the build with logged reasons;
the two that matter most: uncited rows failed OPEN under the original
clause 2 (fixed with an owner-channel-only branch — the negative control
would have caught the ship), and room-derived rows would have been
hard-deleted by a member's whole-wipe (fixed with wipeWhere, honoring the
no-cascade rule). Interface tickets: check-prompt-budget's drop-order
fixture no longer mirrors the manifest; vy_embedding rows of surviving
room facts die with a member's wipe (retrieval-quality, needs a
write-path rule + migration).

---

## `depth-writers-landed` — trust, patterns, and phrases have writers; tonight is night one (2026-08-18)

WS-DEPTH shipped behind full gates (6/6, byte-identity 83/83, invariants
138/138, relcheck 27/27, whole-DB before/after counts identical): nightly
trust/rupture/repair derivation (fixed anchored step 0.08 through the real
rate limiter and state machine — LLM decides PRESENCE with citations,
never magnitude; round-trip rebuild byte-identical), pattern extraction
through the existing ≥2-citation writePattern (≤2/night, 60-day evidence
pool), and deterministic phrase capture (≥3 distinct days, measured
corpus stoplist from 751 live messages, substring dedup after testing
caught shrinking-variant recapture, ≤1/night). Conservatism verified in
smoke: a "friend betrayed me" episode wrote NO rupture — not a rupture
between the user and her. All three group-guarded twice (explicit
group_id filter + structural person_id null). 4 of ≤10 smoke calls used.
Remaining from the judgment-writers ticket: only the call-lane rel bundle
(latency seam).

---

## `tgbot-landed` — the shared-friend surface is live and fail-closed (2026-08-18)

WS-TGBOT reviewed and deployed: webhook at /api/tg (production-probed:
401 without the secret — fail-closed verified live), room lifecycle with
admin-bit consent, addressing + separate silence decision, all room
retrieval through the disclosure predicate, mp slots live (371/2,000
chars on the live path; rows drop whole, never trimmed), one-time intro
as a shape, /chup /bolo /bhool /kya. 101/101 offline checks, byte-identity
83/83 (1:1 path unchanged with roomBundle null). Engine ships to the
serverless lane as a committed generated bundle with a staleness gate;
missing bundle = silent + loud log, never a degraded prompt. The build's
catch — inertness-by-NULL-accident — closed by the coordinator with four
explicit group_id guards, gates re-run green. Ticketed: room fact/phrase
derivation (M1/M3 wait on it), consent-card UX (tier owner-flagged OFF),
Stars payments, react tuning, G6 latency. BLOCKED ON OWNER: BotFather
token + webhook secret (TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET /
TELEGRAM_BOT_USERNAME) — then Ten Days, Three Rooms begins.

---

## `never-scheduled` — no scheduled job has EVER run; the whole derived layer is empty (2026-08-18)

Traced from a felt-product question ("is the relational layer ready to
launch on?") to the live database and then to the GitHub Actions API.

Live counts, `api/_db.js` against production:

| table | rows |
|---|---|
| meera_log | 2,358 (41 distinct devices) |
| vy_person | 40 |
| vy_episode | **2** |
| vy_fact | **8** |
| vy_rel_state | **0** |
| vy_rel_event | **0** |
| vy_pattern / vy_phrase / vy_ritual / vy_currency / vy_kin | **0** |
| vy_taste_candidate / vy_visual_assertion / vy_shared_moment | **0** |
| vy_group / vy_group_member / vy_tg_person | **0** |
| meera_culture | 5 (manual seed) |

The two episodes are from a single consolidation on 2026-08-15 covering
one person over log span 2173–2224. Latest log id is 2358.

**Root cause, and it is not the code.** `.github/workflows/consolidate.yml`
exists and is correct (`cron: "0 22 * * *"` = 03:30 IST, running
`node api/consolidate.js` plus --derive-rel-events, --derive-trust-repair,
--extract-patterns, --capture-phrases, then relcheck and check-citations).
So do `culture.yml` and `drift.yml`. **GitHub schedules workflows only from
the DEFAULT branch.** The default branch is `main`; all of this work lives on
`claude/ai-companion-app-rkt1lv`, which is **252 commits ahead of main**, and
`git ls-tree -r origin/main` shows no `.github/workflows` files at all.

Verified against the API rather than inferred:
- `list_workflows` returns 2 (build-apk, deploy-web). consolidate.yml,
  culture.yml and drift.yml are **not registered at all**.
- workflow runs with `event=schedule`, all workflows, all time:
  **total_count = 0**.

So: consolidation, the culture-index refresh and the drift monitor have never
fired on schedule, once, ever. `felt-wiring-landed` (2026-08-15) closed with
"first real-user rel-state rows appear at tonight's cron" — that cron did not
exist as far as GitHub was concerned, and the sentence was never checked
against a run.

**What this reframes.** `prodgap-audit` diagnosed the write half as mostly
missing and WS-FELT/WS-DEPTH built the writers. Both were correct and neither
was sufficient, because a writer that is only ever invoked by a job that never
runs is indistinguishable from a writer that does not exist. Every measured
"the engine renders empty for every real user" number in this file has TWO
causes stacked, and only one of them was ever addressed.

**The generalizable lesson, which is the expensive part.** This repo gates
heavily on offline evidence: fixtures, invariants, byte-identity, dry runs,
live functional probes. All of it green. None of it could see this, because
every gate answers "does the code do the right thing when invoked" and the
failure was "nothing invokes it". A deploy is not an execution, and a
committed cron is not a scheduled cron. **The check that was missing is the
cheapest one available: does the job have a completed run, and when?**

n/a for n — this is a census of production state and an API fact, not a
sampled measurement. Method: direct SQL counts over `api/_db.js`;
`mcp__github__actions_list` for `list_workflows` and for workflow runs
filtered to `event=schedule`; `git ls-tree -r origin/main` and
`git rev-list --count origin/main..HEAD` for branch divergence. Date
2026-08-18.

---

## `blank-guard-show-only` — the blackout guard covers SHOW classes only (2026-08-18)

Found by WS-MULTIMODAL while proving that a FLAG_SECURE blackout produces no
stored rows. Driving the real `SceneReader` through a blackout sequence
(`evals/multimodal/scene-gate.mjs` part 1, offline, deterministic):
`scene.ts`'s `pick()` refuses every SHOW class (`settle`/`reshow`/`point`/
`switch`) when the frame is `blank`, **but the ambient branch carries no
`!blank` guard at all** — an ambient `idle` wake still fires during a
blackout.

No content can leak through it: a blank frame is blank, so there is nothing
read and nothing to describe. What it means is narrower and still worth
knowing — she can make an ambient remark while the screen is secured, which
is not what "blackout" implies to anyone reading the feature name.

Recording is unaffected: `armMomentWindow` ignores non-SHOW classes
categorically, so the multimodal write path emits zero rows during a
blackout regardless. That is belt-and-braces by accident rather than by
design, which is exactly why it is logged — the write path is safe today
because of a second, independent gate, not because the first one holds.

n/a for n — a behavioural property of a deterministic pure-geometry module,
established by driving the real implementation rather than by sampling.
Method: `evals/multimodal/scene-gate.mjs`, real `SceneReader`, scripted
blackout sequence. Date 2026-08-18.

**Open question, not resolved here:** whether the ambient branch SHOULD be
blank-gated. Suppressing ambient wakes during a blackout is the reading the
feature name implies; keeping them is defensible if her ambient presence is
meant to be independent of what is on screen. It is a product call, and
`scene.ts` belongs to the watch charter, so it is flagged rather than
changed.

---

## `strict-exposed-13` — dropping the transitional defaults surfaced 13 writers that would have mis-filed rows (2026-08-18)

Migration 010 drops the `agent_id` column defaults 009 introduced, so a writer
that forgets the column fails loudly instead of silently filing another
agent's memory under Meera. Applied to the live DB; the failures it produced
are the measurement.

Thirteen writers had to be fixed before every gate went green again:

| file | writers |
|---|---|
| `src/engine/relstate.ts` | vy_rel_event, vy_rel_state, vy_pattern |
| `src/engine/india.ts` | vy_kin, vy_ritual, vy_currency, vy_india_profile |
| `api/episodes.js` | vy_episode, vy_visual_assertion, vy_shared_moment |
| `scripts/migrate/backfill-episodes.mjs` | vy_episode, vy_fact ×2, vy_embedding ×2, vy_derivation |
| `scripts/semantic-recall-eval.mjs` | vy_episode, vy_fact, vy_embedding |
| `evals/wsdepth-fixtures.mjs`, `evals/wsdepth-test-roundtrip.mjs` | vy_episode, vy_rel_event |

**Five of them are inside `.catch()` swallows** (`backfill-episodes.mjs`'s
fact and embedding writers, `episodes.js`'s three). Under 009's defaults they
were already writing correct rows by luck; under 010 without the fix they
would have thrown into a swallow and written nothing, with no error, no log
line and no failing test — `relstate-zero-rows` for the third time, and the
reason 010 exists at all.

Two non-PK unique indexes were widened in the same pass, added by the
coordinator after WS-AGENTSCOPE named them as an interface ticket rather than
a blocker: `vy_kin_ix (person_id, lower(name))` and `vy_phrase_ix (person_id,
lower(phrase))` are `ON CONFLICT` arbiters that are not primary keys, so they
do not appear in a PK audit — but they are the same defect one level down.
Two agents legitimately can both know that this person's chachi is called Bua,
and can each coin the same phrase with them; the index has to say so. Now
`(agent_id, person_id, lower(...))`.

**Verified after, all re-run by the coordinator:** verify-release --mp 8/8,
G-E1 isolation 0 cross-agent rows across n=320 with the negative control
catching 656, tgbot 101/101, surface 184/184, multimodal 27/27, wsdepth
round-trip green (this one matters most — it drives the REAL
`rebuildSnapshotFromDb` against the composite key), multi-owner forget green.
Two agents holding `vy_rel_state` for the same person was measured directly:
impossible before 010, works after, fixture torn down to zero rows.

**Correction to an earlier claim in this file's `never-scheduled` entry and to
what was reported to the owner.** The hourly sweep will NOT clear the 2,025-row
historical backlog. `runConsolidation` finalizes PROVISIONAL episodes —
`findEligiblePersons` selects on `provisional = true` — and provisional
episodes are opened by `opRemember` during a live session. The backlog is raw
`meera_log` rows with `episode_id is null` and no episode ever opened over
them, precisely because the live path that opens them mostly never ran.
Measured directly: a real `runConsolidation({onlyPerson})` against the person
with the largest lag (479 pending rows) processed 1 person, finalized **0**
episodes and made **0** model calls.

So the two backfills are COMPLEMENTARY, not a duplicated design fork:
`scripts/migrate/backfill-episodes.mjs` segments raw log into episodes with
cheap deterministic boundaries (this is what clears the backlog), and
`scripts/backfill-consolidate.mjs` / the sweep run the full extraction pass
over episodes that exist. Clearing history needs the first, then the second.
The sweep alone covers go-forward traffic only.

n/a for n — a census of writers plus a single measured consolidation run.
Method: apply 010 live via `db/migrations/apply.mjs`, run every gate, fix each
failure, re-run; `runConsolidation({onlyPerson, limit:1, dryRun:false})`
against the highest-lag person for the backlog measurement. Date 2026-08-18.

---

## `blank-guard-parity` — the blackout asymmetry exists in BOTH twins (2026-08-18)

`blank-guard-show-only` recorded that `src/watch/scene.ts` guards every SHOW
class against a blank frame and leaves its ambient branch unguarded, so an
ambient wake fires during a FLAG_SECURE blackout. WS-ANDROID-WATCH checked the
Java twin and found the identical shape: `SceneReader.java`'s `pick()` guards
`WAKE_SETTLE`/`RESHOW`/`POINT`/`SWITCH` with `!blank` and its `WAKE_ALONG` /
`WAKE_IDLE` branches with nothing.

Observed at runtime, not inferred: a 48-second scripted dark run produces an
`idle` wake in the Java implementation.

No content leaks either way — a blank frame has nothing to read — and neither
write path stores anything during a blackout, because arming ignores non-SHOW
classes and the native path now carries an explicit `if (blank) return;`.

**What makes this worth its own entry is the test, not the bug.**
`evals/multimodal/native-gate.mjs` compiles and RUNS the real
`SceneReader.java` against the bundled `scene.ts` over identical frames and
diffs the wake log tick-for-tick across seven scenarios — and it asserts
**parity of the asymmetry** rather than the asymmetry itself. Fixing both twins
passes; fixing one fails loudly.

That is the correct shape for any pair of implementations required to stay
identical, and this repo has exactly such a pair by design (`liveCall.ts` /
`LiveWatchEngine.java`, `scene.ts` / `SceneReader.java`). A test that pins the
CURRENT behaviour of one twin would have to be edited every time the behaviour
legitimately changes, and would drift; a test that pins their AGREEMENT never
needs editing and catches the only failure that matters, which is divergence.

n/a for n — a behavioural property of two deterministic modules, established by
executing both over the same scripted frames. Method:
`node evals/multimodal/native-gate.mjs` (needs a JDK; reports UNVERIFIED and
fails rather than skipping when javac is absent). Date 2026-08-18.

---

## `one-key-two-jobs` — the research budget and production share a key, and it just ran out (2026-08-19)

Found when WS-VOICES tried to synthesise six voice samples and got a 403 on
its first call. Verified directly against OpenRouter's key endpoint rather
than inferred from the error:

```
limit 25 · usage 25.021103776 · remaining -0.0211 · is_free_tier false
```

The key is **exhausted and 2 cents overdrawn**.

**The spend itself was authorised and expected.** `papers-to-eight` raised the
cap to $25 and explicitly directed the incumbent arm to "eat the remainder via
--allow-cash", against the $0–30 OpenRouter residue `d2-on-credits` had already
priced. The arm ran and did exactly that. Nothing went rogue.

**What nobody priced is that the same key serves production.** `OPENROUTER_KEY`
in `api/_config.js` is the only OpenRouter credential in the repo, and it is
imported by `api/chat.js`, `api/speech.js`, `api/memory.js`, `api/search.js`,
`api/culture.js` and `api/_embed.js` alike. A research run and the live product
draw on one balance with nothing separating them.

**Measured blast radius, per lane:**

| lane | primary | on exhaustion | state |
|---|---|---|---|
| chat brain | OpenRouter | Google-direct free pool | **degraded, alive** |
| TTS cascade | OpenRouter | Google-direct free pool | **degraded, alive** |
| memory extraction | **Azure credits** | OpenRouter | alive on Azure |
| embeddings | **Azure credits** | OpenRouter | alive on Azure |
| live voice | Google direct free tier | — | alive |
| web search | OpenRouter | none | **DEAD** |
| culture index | OpenRouter | none | **DEAD** (never ran anyway — `never-scheduled`) |

Live probe against production `POST /api/chat` while exhausted: **HTTP 200,
correct reply, 4.81 s**. So the fallback works and the product is not down — it
is running on the free pool, slowly.

**The consequence that matters, and it is a live hypothesis for a real user
report.** The owner reported "in the screen sharing everything changing the
whole voice". `free-tts-daily` measured the free Google pool dying — *all nine
keys together* — after a few dozen synthesis calls in one session. With the
paid lane exhausted, every chat and TTS call now leans on that pool. A pool
429 mid-call forces the live→cascade handoff, and the cascade is a **different
model** — so the same voice name still sounds like a different woman. That is
precisely the failure `api/speech.js`'s header documents from last time, now
reachable by a second route that a voice-name guard cannot catch.

**What breaks generally:** any setup where an experiment and the product draw
on one budget. The experiment is bursty and finishes; the product is continuous
and cannot. Whichever runs second gets the empty balance, and because the
product degrades gracefully rather than failing loudly, nobody finds out from
an alert — they find out from a user saying she sounded like a different
person.

**The rule:** production and research get separate credentials with separate
caps, and the production one gets a balance alarm. Until they are separated,
every `--allow-cash` run is a production incident with a delay fuse.

n/a for n — an account fact plus a per-lane source audit and one live probe.
Method: `GET https://openrouter.ai/api/v1/key` with the configured key;
`grep` for `OPENROUTER_KEY` importers; `curl` against production `/api/chat`.
Date 2026-08-19.

---

## `screen-share-triple-swap` — the voice change needs no failure at all (2026-08-19)

WS-VOICE-LANE's closing finding, and it supersedes the leading hypothesis I
gave the owner earlier today. I said the voice change was the live→cascade
handoff, made more frequent by the exhausted key. That is real but it is the
second mechanism. The first needs nothing to go wrong.

**Android screen share is a designed triple swap.** Starting a share calls
`claimVoice("native", …)` and stopping it calls `claimVoice("cascade", …)`.
So one screen-share session moves her live → native → cascade: **two engine
changes, one of them crossing model families**. Nothing has to fail. This alone
accounts for the report.

**Second mechanism, an asymmetry between the twins.** Gemini Live sends
`goAway` before rotating a session. `LiveWatchEngine.java:1162` handles it by
rotating and STAYING on the live model. `liveCall.ts` did not handle it at all,
so a routine server rotation became a permanent cascade handoff. It now logs
`goAway` with `sharing`, `upMs` and `framesSent` so the rate is measurable; it
still does not rotate, because that touches the session lifecycle the arbiter,
hold ring, echo coefficient and barge-in watchdog all hang off — measured
first, changed second.

**A correction to `one-key-two-jobs`, which I logged wrong.** I wrote that TTS
"falls back to the Google-direct free pool" on exhaustion. For the TTS cascade
that is backwards: the **free Google lane is primary and starts first**; the
paid OpenRouter arm only arms at `PAID_ARM_MS = 1500` as a backup. So key
exhaustion removes the BACKUP, not the primary. The consequence is worse than
I described: when the free pool then 429s, `/api/speech` returns 502 and the
chain falls through to **device TTS** — a platform engine, a bigger voice change
than live→cascade, and one that `stripForDevice` does not sanitise for dashes
(verified: it replaces `[tags]` with an ellipsis and strips emoji, and touches
no punctuation).

**Where the dash actually comes from, ranked.** A third path family bypasses
`/api/speech` entirely — `elevenFetch`, `sarvamFetch` and device `speak()`
(verified at `speech.ts:711-714`). So: (1) the cascade proxy, confirmed
reachable and now sanitised; (2) **device TTS**, unsanitised, and platform
engines are the family most likely to read a symbol from a dictionary rather
than pause — not fixed, `speech.ts` was outside that workstream's ownership;
(3) the live lane, where only persona.ts can fix it, because the model speaks
the characters she emits.

**The audio floor did not move, and this was measured rather than asserted:**
echosim `exp1.mjs`, 5 couplings × 8 seeds × 2 arms = **80 simulated calls,
before versus after byte-identical**.

**Why the live lane must NOT import the sanitiser**, recorded so nobody
"completes" it later: `liveCall.ts` deliberately has no imports beyond
`./level` and `../engine/diag`, because `scratchpad/echosim` transpiles it
standalone and that harness is the only thing that can prove the floor did not
move. An import there costs the ability to test the most delicate file in the
repo. `verify-voice.mjs` §4 now asserts the allowed-import list and was
negative-tested by adding the import.

n/a for n — a source audit plus one deterministic simulator run. Method:
path enumeration over `liveCall.ts`/`speech.ts`/`api/speech.js`; `grep` for the
claim sites; `node scratchpad/echosim/exp1.mjs`. Date 2026-08-19.

---

## `call-parity-landed` — the call lane compiles, and the added context did not lengthen her (2026-08-20)

Seam 1 of `SPEC-CONTINUITY` is closed. Both call assemblers — `tryStartLive`
and the native watch config, which was a THIRD hand-assembler nobody had
counted — now go through `compile({ medium: "voice", … })`. `brain.ts`'s
`mode === "call" ? null` is gone; the bundle rides `BrainKeys.relBundle` and
the cascade lane compiles it per spoken turn.

**Parity, measured per slot** (`evals/continuity/parity.mjs`, same person, same
turn, chat versus call): T2 211 b, T3 307 b, T4 147 b, T6 330 b — identical
bytes on both lanes. `FORGET_DECISION` now reaches the call lane;
`SEARCH_DECISION` correctly still does not. Negative control verified to fail:
a call compiled with no bundle is caught on all four slots, and an emptied
bundle (rows, not just the object) is caught too.

**T11/T12/T13 are dark on BOTH lanes**, asserted rather than hoped — the
`selfbundle-never-set` producer is still missing, and the suite now pins that
as a known state so it cannot be quietly rediscovered. `SPEC-CONTINUITY §0`'s
table claiming chat ✅ for those three was wrong when written.

**G-C7 register**, 3 reps × 12 spoken turns × 2 arms, **n=36 per arm**, same
person, only `relBundle` differs; `gemini-3.6-flash` through the same Google
endpoint the free lane uses, `reasoning_effort: "minimal"`, `max_tokens: 400`:

| arm | words/turn mean | median | p90 | max | questions |
|---|---|---|---|---|---|
| BEFORE (`relBundle: null` — production today) | 16.1 | 14 | 27 | 35 | 34/36 |
| AFTER | 12.9 | 13 | 17 | 32 | 34/36 |

Both arms sit under the 36.1 that declined a model (`brain-model`) and under
the 20.5 incumbent. **The honest read is "no lengthening detected", not "she
got shorter":** an earlier n=12/arm run gave 12.7 → 14.2, so the direction
flipped between runs and the between-arm effect is inside this harness's noise
floor. What the run establishes is the absence of a regression, which is what
G-C7 asks for.

**This is a proxy and is labelled one.** It measures the prompt's contribution
through a text model. The Gemini Live lane speaks and cannot be driven from
here, so no number in this table is a realtime-lane measurement. The 94%
question rate is NOT comparable to `realtime-azure`'s 13/24 — different lane,
different method — and the BEFORE arm already sits at 94%, which is a
text-lane finding needing its own ticket rather than a consequence of this
change.

**Prompt size:** worst-case live tail 13,478 b → 14,326 b (+848 b, 59.7% of the
24,000 cap); manifest-bounded worst case 19,278 b (80.3%). Against a ~48.8 kB
core that is +1.3% prefill.

**Ring-fetch cost:** `recallForCall()` does the one round trip this lane
already made and pulls `takeRelBundle` in the same continuation, so the
consume-once ordering is written once instead of trusted to a second call site.
It is raced against `RING_FETCH_DEADLINE_MS = 900`, never straight-awaited, and
a rejected fetch cannot reject the connect. Typical ~165 ms against a
1.1–2.4 s ring plus 3.5 s connect grace — connect headroom, never the
1.4–1.5 s reply floor (`live-floor`: that floor is the model, not the
assembly). **Not verified on a live call** — no device and no live session from
this environment; both halves now ship in one `diag("call","live_prompt")`
record so the real distribution is measurable in production.

n as stated per claim. Method: `evals/continuity/{assembly,pickup,seam3,parity}.mjs`
offline; `register.mjs` generative against the free pool. Date 2026-08-20.

---

## `voice-v0-was-never-written` — a declared enum value with no producer (2026-08-20)

`db/migrations/002_episodes_facts.sql:25` documents the affect shape as
`[{tag,intensity,source:'text'|'voice_v0',extractor,confidence}]`. The second
value had **no writer**. `api/consolidate.js` hardcoded `source: "text"` on
every row it produced, including rows derived entirely from calls — even though
`channel` is computed three lines above and already knew.

So the column recorded a distinction the data could not express. This is
`dead-writers` in its schema form: **a declared enum value with no producer is
an absent one**, and it is harder to spot than dead code because the schema
comment reads as documentation of behaviour rather than of intent.

**What `voice_v0` now means, stated precisely because the name invites
over-reading:** the affect came from a CALL, and it was read from the call's
WORDS, not its sound. It is deliberately not `voice`. Real prosody has not
shipped. When it does, the rows that predate it must be separable from rows with
acoustics behind them, and naming the generation now is the only thing that
makes that possible later. A row labelled `voice` today would be a claim about
audio nobody analysed.

Mixed spans stay `text`: `channel` is `"call"` only when EVERY turn in the span
is a call, so the label understates rather than overstates provenance — the
correct direction for a field whose purpose is to say what evidence exists.

**Existing data, measured before and after.** The whole table holds **6 affect
rows** across 5 episodes (which is itself `never-scheduled` showing through —
consolidation has essentially never run). Before: `text` 6. Exactly **one** was
mislabelled — a `teasing` tag at intensity 0.8 on the single call episode.
Relabelled in one statement, derivable purely from the stored `channel`, so it
is a correction and not a new claim. After: `text`/chat 5, `voice_v0`/call 1.

n=6 rows, full population not a sample. Method: `select ... jsonb_array_elements(affect_tags)`
grouped by source and channel, before and after a single `update ... returning`.
Date 2026-08-20.

---

## `selflayer-delivery-gate` — a slot is wired when a real prompt contains its bytes (2026-08-20)

`selfbundle-never-set`'s lesson was that `compiler.ts`'s manifest carried
`sourceStatus: "wired"` as a hand-set string checked by nothing. So the gate for
T-H1 was specified as: **not** that a render function returns non-empty for a
fixture, but that each block's header appears in a prompt compiled from REAL
ROWS, on BOTH lanes.

`evals/self/wiring.mjs --live` seeds two `wsself-test-` persons, derives the
texture row through the **real deriver over 45 real `meera_log` turns** rather
than inserting one, then drives `think()` with the model call intercepted — so
what is asserted is the exact `system` string handed to the model, not a
`compile()` the suite arranged for itself.

**n = 37 assertions, all pass**, coordinator-verified by re-running it. Chat
prompt 47,569 b / tail 3,722 b; cascade-call prompt 50,010 b / tail 3,034 b.
Both carry all three headers **and the beat text and arc note underneath** — a
header with nothing under it is exactly what a half-wired slot looks like.

**Negative controls: 6/6 caught**, each verified to actually fail. NC1 replays
the pre-fix production server (omits `self`) and §3 reports all three dark. NC4
is the one worth keeping: it runs the manifest's own `sourceStatus` check
against a compile that rendered 0 of 3 blocks and the check comes back **clean**
— the field mechanically demonstrated to be a comment with better syntax.

**Budget, measured rather than declared:**

| | bytes | % of 24,000 tail cap |
|---|---|---|
| all declared tail budgets | 21,200 | 88.3% (2,800 headroom) |
| the three self slots' declared allowance | 1,800 | 7.5% |
| adversarial max render, measured (T11 314 / T12 216 / T13 596) | 1,126 | 4.7% |
| observed tail delta, parity fixture, both lanes | +812 | +3.4% |
| observed real tails: chat / cascade / realtime | 3,722 / 3,034 / 2,844 | 15.5 / 12.6 / 11.8% |

Each block's adversarial maximum sits inside its own declared budget (T13's
596 b against 598 b). **Byte-identity 83/83** holds — absence still renders
nothing. Zero residue after teardown, verified by a printed query returning 0.

**What is NOT measured, stated because the suite says so in its own header:**
`tryStartLive` is inside a React hook and cannot run headless, so the realtime
lane is covered by compiling the identical input object plus a source assertion
that both call sites read the holder and no `selfBundle: null` remains. **No
realtime prompt was observed on a device.** Separately, **T11 on an opener is
unmeasured** — the self bundle is not nulled on a chat directive the way
`relBundle` is (nulling it would make `sheInitiated` a field that can never be
true, i.e. a `dead-writers` instance inside the ticket closing one). If T11 moves
her register on an opener, that is the first thing to revert.

n=37 assertions / n=6 negative controls, method: live Neon, real deriver,
intercepted model call, both lanes. $0. Date 2026-08-20.

---

## `selflayer-rows-zero` — the layer is delivered and still empty (2026-08-20)

Measured against production Neon the same day T-H1 landed: `vy_self_arc` **0**,
`vy_agent_life` **0**, `vy_agent_life_told` **0**, `vy_observation` **0**,
`vy_rel_texture` **1** (a stale `aaaaaaaa-…` fixture row at `n_turns` 7, below
the 40 floor). The relational layer is at zero too: `vy_rel_state`,
`vy_rel_event`, `vy_pattern`, `vy_ritual`, `vy_currency` all **0**;
`vy_episode` **5**.

So both of `selfbundle-never-set`'s two independent causes were real and only
one is now closed. **T-H1 delivers nothing to the owner on its own, and neither
does `call-parity-landed`** — the call lane can now read T2/T3/T4/T6/T11/T13 and
there is nothing to read. This is `never-scheduled` still biting, and it is the
single highest-leverage pending item in the repo.

**A third structural gap found while measuring:** T12 is unreachable without a
rel-state row. `compiler.ts` computes its moment gate only inside
`if (input.relBundle)` (`const gate = input.relBundle ? … : null`) and
`renderSelfArc` receives `gate?.moment || ""`. Coordinator-verified at
`compiler.ts:377` and `:492`. Given zero rel-state rows, **T12 is dark for all
39 persons regardless of how many arcs exist.** Filed, not fixed.

**What one consolidation pass would actually light**, measured read-only with
`deriveTexture` and no upsert, over the top 6 persons by her-chat turns: 257
turns → renders, 72 → renders, then 39 / 37 / 32 / 30 all under the 40 floor.
**2 of 34** persons with any her-chat turns clear it. So the honest expectation
from the first pass is T11 for two real people, not a lit-up layer.

n=39 persons (full population), method: direct row counts and a read-only
deriver run against production Neon. Date 2026-08-20.

---

## `backfill-stage1-run` — the derived layer is no longer empty, for the first time (2026-08-20)

`never-scheduled` and `selflayer-rows-zero` were the binding constraint on
everything shipped today: the call lane could finally read T2/T3/T4/T6/T11/T13
and there was nothing to read. The free half of the migration path has now been
run against production.

**What was run, and why only half.** `scripts/migrate/backfill-episodes.mjs`
has three stages: (1) boundaries, deterministic and free; (2) legacy
quarantine, deterministic and free; (3) LLM enrichment, priced. There is no
stage flag, but `--k 0` makes `salientBackfillEpisodes`' `limit $2` return zero
rows, so the enrichment loop iterates zero times. Verified before running:
`--all --dry-run --k 0` reported 0 candidates and 0 model calls of every kind.
Stage 3 remains the owner's pending decision and was NOT run.

**Measured, before → after (full population, not a sample):**

| | before | after |
|---|---|---|
| `meera_log` rows with no episode | 1,853 | **0** |
| `vy_episode` | 5 | 131 |
| `vy_fact` provenance `legacy` | 1 | 90 |
| `vy_rel_texture` | 1 (stale fixture) | 26 |
| …of those, clearing the 40-turn render floor | 0 | **2** |
| `vy_self_arc` | 0 | 0 |

**Cost: zero cash and zero LLM calls** — `azure_calls 0, or_calls 0` — but **not
zero credits**, and the difference matters enough to write down: the legacy
quarantine made **23 Azure embedding calls, 1,327 tokens**, on grant credits.
"Free" was the claim for the model tier; the embedder is a separate lane and it
spent.

**The self-layer pass then processed 25 persons and wrote 25 texture rows** with
zero model calls (`runSelfLayer` calls only engine functions with `q` — read,
not asserted). Before the backfill the identical command reported
`persons_processed: 0`, because `findPersonsWithFreshEpisodes` requires
`provisional = false` episodes inside a 30-hour window and there were none. The
backfill writes `provisional = false` at `created_at = now()`, which is what
unblocked it.

**Independent confirmation of a prediction.** `selflayer-rows-zero` predicted
from a read-only deriver run that **2 of 34** persons would clear the texture
floor. The real pass wrote 26 rows of which exactly **2** clear it. A
read-only projection and a live write agreeing exactly is the strongest evidence
so far that `deriveTexture` is deterministic over the same input.

**The arc still refuses, and that is correct.** `deriveSelfArc` found 3 evidence
facts and rejected all three — *"no single dim decided (unclassified or tied)"*
— against a CHECK requiring ≥3 citations and a ≥42-day span. It is behaving as
`self-layer` specified: a growth claim it cannot support is not made.

**So what a real user gets today** is T11 for two people and nothing else. That
is a truthful floor, not a launch. The remaining lifts are stage 3 (owner
decision, priced), the rel-state derivations that need real episode summaries
stage 3 produces, and `T12`'s coupling to `relBundle`.

n = 39 devices / 1,853 log rows / 25 persons, full population. Method:
`backfill-episodes.mjs --all --k 0` then `consolidate.js --derive-self`, with
direct row counts against production Neon before and after each. Date 2026-08-20.

---

## `device-seam-closed` — eleven paths, not three, and four of them were raw (2026-08-20)

The brief named three text→audio paths. Enumeration found **eleven**. Four were
handing engines unsanitised text: ElevenLabs `elevenFetch`, Sarvam
`sarvamFetch`, device `speak()` — **live in production today**, since it is
where the chain lands when every clip fetch fails — and, as the "assume there is
one more" case, Android's **cascade** `WatchEngine.java`, a separate
snapshot→think→speak brain from `LiveWatchEngine.java`. `docs/VOICE-LANE.md` §5
had said *"there is no fourth path"*. The cascade watch engine happens to be
safe (it POSTs to `/api/speech` and has no local engine to fall back to), but
nothing asserted that, so it is asserted now.

**The gate is behavioural.** `evals/voice/device.mjs` bundles the **real**
`speech.ts` with recorders for the platform engines and `fetch`, drives the real
entry points under the real production failure (every clip fetch refusing), and
asserts on **the strings the engines were handed** — `selfbundle-never-set`'s
rule applied to speech. **42 assertions across 5 doors.** Plus a door census:
every text→audio door enumerated from source against a declared list, so a new
engine fails the run until it is declared.

**Symbol words actually spoken, n=12 utterances through the real device tier,
before vs after: 5 across 4/12 → 2 across 2/12.** The two survivors are a
"slash" inside a real URL path and the crisis helpline's two "dash"es — both
things a person reading that line aloud would also say.

**Negative controls, each verified to fail**, with failure text observed:
device seam removed → `carries an em/en dash`; cloud seam removed → `carries an
arrow … a pipe`; an undeclared door added → `UNDECLARED text→audio door(s) …
api.play.ht`; a declared door's pattern moved → `declared door(s) no longer
found`; the `**bold**` bug reintroduced → `her own words "sach" were DELETED`;
`phrase()` reverted → `her own words "meera-silk.vercel.app/chat" were DELETED`;
a greedy `/-+/` dash rule → `her own words "1800-599-0019" were DELETED`;
tag-keeping disabled → `two tags survive`. With the prep functions bypassed
entirely, device fails and ElevenLabs/Sarvam **still pass** — the door-level
seam holding by construction.

**Audio floor unmoved:** 5 couplings × 8 seeds × 2 arms = 80 simulated calls,
before and after byte-identical. Expected — echosim builds only
`liveCall.ts`/`level.ts`/`diag.ts` and no import was added to any of them — but
measured rather than assumed.

**A false red worth recording:** both eval bundles wrote to a fixed temp
filename, so a concurrent `verify-release` deleted one run's bundle mid-import
and the gate reported *"a path is unsanitised"*. A shared temp path turns a
green suite red at random under parallel agents. Both are pid-scoped now.

**Corpus, measured today:** `persona.ts` is 91,808 chars with **307 em-dashes**
— my brief said 208, and the brief was wrong. 5 en-dashes, 14 arrows.

Gates: `tsc -b` clean · `verify-voice.mjs` 135 ok · `verify-release.mjs` 8/8 ·
`spoken.mjs` 37 positive + 17 negative + 9 tag-keeping, 63/63 idempotent ·
`device.mjs` 42/42 · `verify-v3.mjs` all pass · `parsetest.bundle.mjs` 14/14.

n as stated per claim. Method: source enumeration, a behavioural harness over
the real module, and espeak-ng 1.51 phonemisation. Date 2026-08-20.

---

## `goaway-rotation-parity` — `goAway` is answered by rotating, in both twins (2026-08-20)

`goAway` is the live server saying a session is about to end. Both twins let
that close become `teardown("closed")` → `claimVoice("cascade", …)`, i.e. a
model-family change — which by the `azure-tts` law is the property that decides
whether she is still her. Both now **rotate**: fresh socket, same model, same
`Aoede`, at a chosen moment. The swap is **eliminated**, not reduced.

Both twins were changed together and are pinned to each other by a source
parity test, per `blank-guard-parity`. Three further changes fell out of it:
the model is now **pinned for the life of the call** (the Java twin adopted
whatever model the new token named on every reconnect); the rotation **waits for
`speakingUntil`** rather than firing on arrival; and the TS twin gained the
mic-tick arbitration reset (`sockSeen !== wsGen`) the Java twin already had.

**No import was added to `liveCall.ts`** — the allowed-import list is what lets
`scratchpad/echosim` transpile it standalone, and that harness is the only thing
that can prove the audio floor.

**Audio floor: 5 couplings × 8 seeds × 2 arms = 80 simulated calls, before and
after byte-identical**, and a coordinator re-run matching cell for cell. This is
a stronger claim than the earlier diagnostics-only pass, because this change
*does* touch the mic tick: the reset is a no-op until a rotation happens,
`exp1.mjs` never rotates, and the identical cells prove the no-op rather than
assuming it.

**Rotation behaviour: 26 assertions, 5 scenarios, 26/26**
(`scratchpad/echosim/rotatesim.mjs`, the real `liveCall.ts` transpiled against a
simulated server that sends `goAway`). Every assertion is observed from outside
the module. Two negative controls: `goAway` left unhandled → **14 of 26 red**,
reproducing the shipped symptom verbatim (`a stale close did not end the call …
onEnded=["closed"]`); `timeLeft` read as ms → the rotation stops waiting and
fires inside her sentence.

**Source parity: 11 assertions + 2 notes**, `verify-voice.mjs` §6, every one of
the form *"the TS and the Java agree"*, never *"the TS says 6"*. Four negative
controls, each verified; the coordinator independently reproduced
`FAIL goAway is not answered with a rotation in src/voice/liveCall.ts`. Gradle
`:app:compileDebugJavaWithJavac` exits 0.

**A correction to `screen-share-triple-swap`, measured from source:** share
**start** (live → native) does **not** change who she is — the native engine
takes `gemini-3.1-flash-live-preview` from the same token, names `Aoede`, pins
`hi-IN` + `thinkingBudget: 0`, and takes `buildSpeechStyle("live")`. The triple
swap is one identity-preserving session change plus one that is not. **The one
that is not is share STOP**: `claimVoice("cascade", "watch_stopped")` in
`useCallEngine.ts`, a model-family change nothing forced, and now the largest
remaining swap in the product apart from the cascade → device-TTS fall.
`verify-voice.mjs` §6g prints the live `claimVoice` call-site list on every run
(currently 8) so the table cannot silently fall behind the code.

**Nothing here ran on a device or a live session** — there is neither in this
environment; `LiveWatchEngine.java` compiles and was read, not run. The open
questions ship as named `diag` records instead: `live_rotated{n,gapMs,setupMs,
framesSent,sharing}`, `live_goaway{leftMs,upMs,framesSent,sharing,rotates,
budget,speaking}`, `live_rotate{n,waitedMs,…}`, `live_rotate_failed{n,why}`,
`live_rotate_spent{n,…}`. A `live_rotate` with no matching `live_rotated` inside
~3 s is a rotation that failed; a non-zero `live_rotate_spent` rate means
`MAX_ROTATES` is too low.

n as stated per claim. Method: source parity assertions, a rotation simulator
over the real module, and the echosim floor before/after. Date 2026-08-20.

## `honesty-pressure-1` — the leak measured before and after, on real generations (2026-08-20)

Method: 22 stimuli through the **real** `compile()` chat prompt (core 43,836 b +
tail 2,350 b), `gemini-3.6-flash` at `reasoning_effort: "low"` — the chat tier
`api/chat.js` actually uses, not the call tier. One generation per unit, scored
in **both** arms: the gate is deterministic post-processing, so a second
generation would measure sampling noise and reintroduce `visiongate-interim`'s
mismatched-denominator trap.

22 × 2 = 44 attempted, **13 lost to free-pool exhaustion** (`free-pool-capacity`
again), **n=31 scored**. Errors excluded from every denominator and printed.

| arm | all n=31 | A identifier n=15 | B receipt n=8 | C adversarial n=8 |
|---|---|---|---|---|
| reaches him, BEFORE | 1 (3.2%) | 0 | **1 (12.5%)** | 0 |
| AFTER the gate | **0** | 0 | 0 | 0 |

Content preservation: **29/29 clean replies byte-identical**, 0 replies
silenced. A second run died at n=14 on pool exhaustion; those 14 showed 0
attempts and 0/14 identifiers reaching TTS through the spoken door. ~59
successful free-pool generations total, $0 cash.

**The honest bound, stated because the zero is misleading:** 0/15 on the
identifier family means the direct-ask attempt rate is **≤20%** (rule of three,
95%), not zero. The harness prints the bound instead of the zero. It did not
reproduce family A and does not refute the owner's report of it.

**Two doors, not one.** The cascade call lane hands raw model tokens to
`createStreamSpeaker` before the reply finishes parsing — she starts speaking
mid-generation, so a gate that only sees the parsed reply is one the spoken
bytes walk around. That is `age-tier-never-realtime`'s shape exactly. Both doors
are gated; `evals/honesty/run.mjs` §6 asserts it mechanically at **2 gated / 2
call sites**. The spoken door carries the identifier guarantee but not the
receipt one — a receipt claim needs a clause, and by the time the clause closes
its first half is already audible. Named in the code rather than hidden.

110 honesty checks (was 40), inside `evals/run.mjs` inside `verify-release`, so
every build gates on it. Zero database writes — zero residue by construction
rather than by cleanup. Date 2026-08-20.

## `trace-overhead-zero` — the trace costs no statements and no measurable time (2026-08-20)

| | measured | method |
|---|---|---|
| SQL statements added to `op:"recall"` | **12 → 12, zero** | counted at the fetch-to-Neon boundary, paired call |
| SQL statements added to `/api/chat` | **0** | structural — the file imports no `_db.js`, asserted |
| response bytes, `op:"recall"` | **+593 B** | median of 8, real device, real query |
| client tap cost | **0.48–0.52 µs per event** | n=20,000 × 5 alternating blocks, medians, warm-up discarded |
| ⇒ per turn (~8 events) | **~4 µs** against a 720 ms floor | arithmetic |
| stored per turn | **4,456 B** (1,120 spine + 3,336 legs) | `pg_column_size`, one full 7-leg turn |
| 500 turns/day | 2.2 MB/day → ~100 MB steady state | arithmetic |
| audio floor | **byte-identical** | echosim 5×8×2 = 80 calls vs HEAD, coordinator-reproduced |

**Wall-time is explicitly NOT the claim.** Four paired runs gave Δ −41, −322,
+94, −83 ms with a control-arm spread of 134–1,902 ms — the effect is under the
noise floor, so the statement count carries the claim instead. The first
arrangement of the tap measurement reported the *tapped* run as faster; that is
not a result, it is a warning that the effect is below the noise, and it was
redone as alternating blocks with medians.

`diag.ts` was deliberately not touched — the tap went into `telemetry.ts`, which
`diag()` forwards into, so one tap catches both *and* the direct `tel()` calls.
A new import in `diag.ts` would have broken echosim's standalone transpile of
`liveCall.ts`, which is the only proof the audio floor did not move.

---

## `nine-dark-tail-slots` — three separate investigations, now one queryable row (2026-08-20)

Real production compile, 2026-08-20 11:56:56Z, replayed through the real
correlator and read back with `scripts/trace.mjs --turn`:

```
core 43,868b   tail 5,141b
T1 0b  T2 0b  T3 0b  T4 0b  T5 1,895b  T6 0b  T7 609b
T8 0b  T9 0b  T10 1,280b  T11 220b  T12 0b  T13 0b
watch 0b  culture 0b  mp.roster 0b  mp.bridge 0b
```

**Nine declared tail slots render zero bytes in production**: her carried
interior (T1), the entire relational snapshot (T2/T3/T4/T6), and two thirds of
the self layer (T12/T13). Only four render at all.

This is `prodgap-audit`, `relstate-zero-rows` and `selflayer-rows-zero` visible
simultaneously in a single row — the first time that state has been *queryable*
rather than the conclusion of three separate investigations. And it is visible
only because per-slot byte counts exist: nothing else in the system
distinguishes a slot that is switched off from one that is empty from one that
was never wired. That distinction is exactly what cost this session four
separate debugging sessions.

Derived flags, each an invariant already paid for once: `recall_empty`,
`slot_zero`, `tail_over`, `core_over`, `fallback`, `no_person`, `empty_reply`.

---

## `both-lanes-dry` — production chat went down because our own evals spent the day's budget (2026-08-20)

At ~12:30 UTC `/api/chat` began returning **502 `{"error":"upstream 403"}`** on
production while `/api/speech` stayed 200. Cause, probed directly rather than
inferred:

- **all 9 free-pool Google keys return 429** (quota), probed individually with
  the real model and endpoint the free lane uses
- **OpenRouter is exhausted**: `limit 25, usage 25.021`

Both lanes dry at once, so the chat proxy has nothing to fall through to.

**It was our spend.** The honesty pressure run consumed ~59 free-pool
generations in one afternoon against a pool whose measured real ceiling is ~75
calls/day (`free-pool-capacity`), on top of the trace round-trips. This is
`one-key-two-jobs` — *"the research budget and production share a key, and it
just ran out"* — recurring with the free pool included this time, so there is no
paid backstop.

**Not caused by any code shipped today**, checked rather than assumed:
`api/chat.js` last changed 2026-08-15 (`ce56048`); the honesty commit touched
only `brain.ts`, `honesty.ts`, evals and `context/`. A clean checkout of HEAD
deployed to production reproduces the same 502, which is what rules the code out.

**What it costs to leave unfixed:** the owner cannot test the product on any day
we run an eval. Splitting research and production credentials (#89) stops being
housekeeping at this point — it is the difference between measuring the thing
and being able to use it.

n = 9 keys probed + 1 OpenRouter auth call. Method: direct provider calls with
the production model/endpoint; status codes only, no keys printed. 2026-08-20.

---

## `relstate-first-rows` — the derived layer has rows for every active person, and production serves them (2026-08-21)

`never-scheduled` and `selflayer-rows-zero` were the binding constraint on
everything: the call and chat lanes could read T2/T3/T4/T6/T11 and there was
nothing to read. `vy_rel_state` had held **zero rows for every real user,
ever**. It does not any more.

**What unblocked it, and it was not code.** `main` was fast-forwarded to the
branch tip, which registered `consolidate.yml` with GitHub for the first time
(`never-scheduled`: schedules fire only from the default branch). The nightly
chain was then run by hand rather than waiting for 03:30 IST, using exactly the
flags the committed workflow declares.

**Measured, full population, before → after:**

| table | before | after |
|---|---|---|
| `vy_rel_state` | **0** | **25** |
| `vy_rel_event` | 0 | 1 |
| `vy_rel_texture` | 26 | 26 (all 25 rewritten by the real deriver) |
| `vy_phrase` | 0 | 1 |
| `vy_pattern` | 0 | 0 |
| `vy_self_arc` | 0 | 0 |

**Cost: $0 cash.** OpenRouter usage measured at `0` of `6` before and after the
whole chain — the derivations ran on Azure credits and deterministic paths.
`--derive-self` processed 25 persons and wrote 25 texture rows; `--extract-
patterns` 22.8 s for 0 written; `--capture-phrases` 1 written.

**Two refusals that are correct and should not be "fixed".** The arc refused
all 10 evidence facts — *"no single dim decided (unclassified or tied)"* —
against a CHECK requiring ≥3 citations spanning ≥42 days, which is `self-layer`
behaving as specified: a growth claim it cannot support is not made. Patterns
wrote 0 because the ≥2-citation bar is not met yet; `depth-writers-landed`
already measured that the pattern path needs three calendar days and three
nightly passes before anything is usable.

**Verified against PRODUCTION, not a fixture.** `POST /api/memory op:"recall"`
for a real device now returns a `relstate` bundle — `relState` (11 keys), a
populated `lastHonorificMoveAt`, 1 phrase, 1 phrase-ledger row — plus a `self`
bundle whose `texture` carries real derived bands (`emoji_rate`, `humour`,
`teasing`, `words_median`, `n_turns`). Before today that response carried
nothing to render.

**The render half is proven separately rather than assumed**, because
`selflayer-delivery-gate`'s law is that a slot is wired only when a real prompt
contains its bytes: `evals/self/wiring.mjs --live` passes **37/37 with 6/6
negative controls caught** and zero residue after teardown. Delivery (measured
against production, real user) plus render (measured by the gate) is the whole
chain.

**What this does NOT yet deliver, stated because the zero is easy to overclaim.**
`patterns`, `rituals`, `currency` and `weEpisodes` all return **0 items** in
that same production bundle, so T4 and much of T6 are still dark. Stage 3 LLM
enrichment (#75) remains un-run and is the owner's priority call. The honest
claim is that the relational snapshot has moved from *nothing at all* to
*stance, texture and phrases*, for 25 of 39 persons — not that the layer is
full.

n = 39 persons / 25 processed, full population not a sample. Method: the
committed cron's own flags against production Neon, with direct row counts
before and after each stage, an OpenRouter balance check either side, one live
production `op:"recall"`, and `evals/self/wiring.mjs --live`. Date 2026-08-21.

---

## `stage3-enrichment-run` — 133 episodes enriched for $0.00092, and the layer's remaining gate is now calendar time (2026-08-21)

Stage 3 of `scripts/migrate/backfill-episodes.mjs` — the owner-approved LLM
enrichment (#75) — run over the full population. Stages 1 and 2 had already run
today; this is the pass that gives each episode a summary, affect tags, an
anchored importance and up to 4 cited facts.

**Projection versus actual, because the projection was made before the run and
is therefore falsifiable.** Predicted ~78,000 input tokens from measured prompt
volume (126 episodes × ~620 avg). Actual **75,819** (73,915 Azure + 1,904
OpenRouter) — within 3%. The method (sum the real transcript characters behind
each candidate episode, ÷3.6 chars/token) is worth reusing.

| | |
|---|---|
| episodes enriched | **133** (the count rose past 126 mid-run: stage 1 opened new boundaries for 2 devices) |
| facts written | **295** |
| Azure calls | 131 · 73,915 in / 13,184 out — **grant credits** |
| OpenRouter calls | **3** · 1,904 in / 296 out |
| embeddings | 119 Azure, 0 OpenRouter, **0 failures** |
| **cash cost** | **$0.00092** |
| wall time | 21.7 min, 33.4 s/device |

The Azure fallback rate was **2.2% (3 of 134)**, against the 7.5%
`DeploymentNotFound` rate `extract-model` measured in a separate battery — so
the fallback is a real need and it cost under a tenth of a cent.

**Whole-population effect, before → after the day's work:**

| table | start of day | now |
|---|---|---|
| `vy_fact` | 129 | **446** |
| `vy_embedding` | — | **446** (every fact embedded) |
| `vy_episode` | 135 | 143 |
| `vy_rel_state` | **0** | 25 |
| `vy_rel_event` | 0 | **5** (3 trust, 1 rupture/repair) |
| `vy_pattern` | 0 | **4** |
| `vy_phrase` | 0 | 1 |
| `vy_self_arc` | 0 | **0** |

**The finding that matters more than the counts: T4 is now REACHABLE and still
DARK, for a reason that is correct and cannot be hurried.**
`fetchRelBundle` selects patterns `where prompt_eligible = true`, and
`prompt_eligible` is a **stored generated column**, read live from the schema:

```
((support_count >= 3) AND (distinct_days >= 2))
```

All four new patterns sit at `support_count 0, distinct_days 0`. Support accrues
when a LATER episode re-confirms the pattern, so T4 needs three re-confirmations
across at least two distinct days. Verified end to end rather than inferred: a
production `op:"recall"` for a device whose person owns patterns still returns
`patterns -> 0 items`.

**Two refusals in the same run are the same discipline and must not be
"fixed".** `deriveSelfArc` now sees **142 evidence facts** (was 10) and still
reports `attemptedInsert: false`, against a CHECK requiring ≥3 citations
spanning ≥42 days. Enrichment gave it evidence; it did not give it *time*.

So the layer's binding constraint has changed category. It was **"nothing ever
ran"** (`never-scheduled`, an unregistered cron). It is now **elapsed days under
a registered cron** — which is the constraint the design always intended, and
the first time it has been the real one.

**What a real user gets today**, stated so the row counts are not over-read: a
live `relState` (11 keys), texture bands, phrases and the phrase ledger. Not
patterns, not rituals, not currency, not weEpisodes, not an arc.

n = 39 devices / 143 episodes / 446 facts, full population not a sample. Method:
`backfill-episodes.mjs --all --k 999` (dry-run first, confirmed all cost
counters zero), then the committed cron's own five derive flags, with direct row
counts and an OpenRouter balance check either side, plus one live production
`op:"recall"` and a read of the live `information_schema` generation
expression. Date 2026-08-21.

---

## `stuck-endpoint-noise` — in a room that never goes quiet, the uplink carried zero silence and she never answered again (2026-08-21)

The owner's tenth report: *"bahot der tak listening wala loop chalne laga aur
woh ussi mai phasi rhi ... this also happen when there is disturbance at my
end."*

**The correlation with disturbance IS the diagnosis.** The server ends his turn
by hearing a pause; this client only uplinks a pause when the gate CLOSES, since
a closed gate transmits a zeroed buffer. Sustained room noise above the listen
bar pins the gate open, `gatedRun` resets to 0 on every open chunk, so no
silence is ever sent, the VAD clock never advances, and she listens forever.

It is the failure the `SILENCE_KEEP` heartbeat comment already describes,
arriving through the opposite door: not *"silence was suppressed"* but
*"silence never happened"*. Nothing else in the file can rescue it —
`LISTEN_ABS_MAX` caps the listen bar at −22.9 dBFS **by design**, because raising
it further was measured to be deafness, so a louder room pins the gate and no
amount of adaptation closes it.

**Measured on the real `liveCall.ts`** (`evals/echosim/stucksim.mjs`, driven
through `run.mjs`, every assertion read off the bytes that reached the socket):

| arm | longest silent uplink run, after her turn |
|---|---|
| loud room (`roomRms` 0.15), watchdog DISABLED | **0 ms** across a 32 s call |
| loud room, watchdog enabled | **~700 ms**, at the threshold |
| ordinary room (`roomRms` 0.0025) | reaches silence on its own; watchdog never fires |

The disabled arm is the bug reproduced exactly: **zero milliseconds of silence
in half a minute.** She could not have answered.

**The audio floor did not move.** `exp1.mjs`, 5 couplings × 8 seeds × 2 arms =
80 simulated calls, **byte-identical to the pre-change baseline** — because
`openEff` differs from `open` only while an endpoint is being forced and is read
at exactly one site, so the floor model, the arbiter, the hold ring and every
counter still read `open`. No import was added, so the standalone transpile that
makes this measurable at all still works.

**Two calibration notes, both from the harness catching itself.** The first
version of the reproduction assertion measured from t=0 and reported a 1,962 ms
"natural pause" that was her own turn's mic hold; the window now starts after
she stops. And the "real silence reached the socket" check originally measured
the whole call, so it passed even with the watchdog disabled — a control that
cannot fail is not a control.

**Threshold rationale, stated because it is a judgment and not a measurement:**
20 s of UNBROKEN gate is not speech — ordinary speech has inter-phrase gaps that
outlast the 250 ms hangover and close the gate many times inside one turn. The
asymmetry is `speaker-id`'s: firing early commits his turn sooner and he keeps
talking, a mild annoyance; not firing means she never answers again, which ends
the call.

**NOT fixed by this, and stated so the report is not read as closed:** the
first-turn latency half of report 10 (`live-floor`: 720 ms of the ~1,370 ms
floor is untouchable prefill; the available win is variance, not median), and
the mid-sentence aborts under noise (the barge-in arbiter is level-based **by
design** — `speaker-id` records why the obvious fix is refused and what it would
cost). The floor being byte-identical means those were not made worse; it does
not mean they were addressed.

n = 2 scenarios × 32 simulated seconds, plus the 80-call floor table. Method:
`node evals/echosim/stucksim.mjs` (wired into `verify-release`, now 10 checks)
with a disable-the-watchdog negative control run and observed to fail, and
`node evals/echosim/exp1.mjs` diffed against the pre-change baseline.
Date 2026-08-21.

---

## activity-browser-observed — the games centre driven end to end (2026-08-21)

Chromium 390x844 against the real production build served by `vite preview`,
driven by Playwright. n = 2 scripted sessions, both scripts in the session
scratchpad (`uicheck.mjs`, `uicheck2.mjs`). Method: seed `meera.state.v1`,
reload, drive the real UI, read `localStorage` back for state assertions.

| observation | result |
|---|---|
| chat → hub → board | 2 taps |
| chat still mounted while the board is up | yes (`.chat-scroll` count 1) |
| e2e4 through the board's own tap path | played |
| her reply | `Nf6`, ~2s, local search, no model call |
| game persists to storage and survives leaving the board | yes (played=2) |
| hub then offers to resume, with whose move | yes |
| starting a call FROM the board | board stays up, call mounts under it |
| game disturbed by the call starting | no |
| 4xx responses | only `/api/*`, which `vite preview` does not serve |
| JS errors | none |

Not measured: any real device, any real APK, contrast on the dark tone (computed,
not instrumented), and safe-area behaviour. Board overflow at very short
viewports is unobserved — the stage scrolls rather than clips, by construction,
but nobody has seen it do so.

---

## her tic-tac-toe imperfection, enumerated (2026-08-21)

Method: exhaustive game-tree enumeration in `evals/ttt.mjs` against an
INDEPENDENT second minimax (not the engine's own), she plays O, the opponent
branches over every truly-optimal reply. Deterministic; runs in the suite on
every push.

| arm | loss rate vs perfect play | n (leaves) |
|---|---|---|
| level 1 (easiest) | 57.8% | 83 |
| level 2 (default) | 9.9% | 202 |
| level 3 (hardest) | 1.9% | 214 |
| uniform-random baseline | 88.5% | 31,040 |
| perfect-play control | 0 losses either mark | all |

The control is the ground truth on the minimax itself (tic-tac-toe is a solved
draw). The baseline is what "she is beatable" must stay well below to not be
"she plays randomly". The chess STRENGTHS table still carries its own
"numbers are guesses" caveat — this table is what replacing that caveat with
a measurement looks like, and chess deserves the same treatment (n≥100 games
per level, scripted).

---

## `ui-perf-audit-2026-08-22` — UI/perf audit numbers (4th auditor)

Method: headless Chromium (dSF 1) + node against the bundled real engine;
n and method per line. Full report: docs/audit/2026-08-22-ui-perf.md.

- Typing cost, unwindowed thread: ~0.0077 ms/message/keystroke, linear.
  p50 at 0/50/200/500/1000 msgs = 0.5/0.9/2.2/4.7/7.7 ms (59 keystrokes at
  45 ms intervals, Event Timing API). DOM: 4.92 nodes/message.
- Her chess think (level 2 shipped): total 31.1 ms, 2 yields, longest block
  11.7 ms in node; 53 ms longest main-thread gap in-app after e4 with a
  300-message history. assessLast standalone: 36.7 ms. Phone calibration
  4-8x (opponent.ts:23).
- Bundle (pre-split): index.js 984.92 kB / 326.55 kB gz. Stub A/B deltas:
  @anthropic-ai/sdk −151.6 kB raw / −39.8 gz; framer-motion −128.7 / −41.8;
  chess.js −35.8 / −11.8.
- Images: onboarding fan 461 kB of 900×900 painted at 148×186; avatar
  148 kB painted at 43px. After sharp variants + legacy-import cut:
  dist avatar/fan jpgs 1,427,205 → 568,421 bytes (−60%).
- Contrast (measured from live computed styles): dark chess black-piece on
  dark-square 1.27:1 → re-ink 3.28:1; squares 1.73 → 2.59. Ttt cell-vs-gap
  1.18:1 → 2.72 light / 2.22 dark. Us day-grid unfilled 1.11:1 (light),
  1.22 (dark) → ~2:1 via --ink mix.
- localStorage: 500 real messages = 145.0 kB UTF-16 = 2.8% of 5 MB quota;
  2,000 = 10.6%. Full-state persist ~0.35 ms/write at 500 msgs.
- Storage-ladder trigger analysis: only realistic entry is a stuck data:
  URL (1024px q0.82 JPEG ≈ 150-400 kB, ~800 kB as UTF-16).

After the fixes (same methods, A/B against the pre-fix tree):
- Typing with memoised rows + 80-row window: p50 0.8 ms at BOTH 300 and
  1000 messages (was 3.2 / 9.5) — flat in history length; DOM rows capped
  at 80 (was N). n=30 keystrokes per arm, real bubbling input dispatch.
- Chess yield at 4k nodes: longest main-thread block 12.8 → 5.7 ms at the
  shipped strength (n=5 medians, warm); wall clock +3%, off the critical
  path. Determinism held: 20/20 identical moves across 4 positions × 5
  levels; all 366 chess evals pass.
- assessLast fen-keyed memo: 45.28 ms uncached → 0.0003 ms median on hit.
- Bundle: main chunk 995.81 → 843.80 kB (332.99 → 293.16 kB gz); Anthropic
  SDK now a 155.6 kB lazy chunk; INEFFECTIVE_DYNAMIC_IMPORT 2 → 0.
  framer-motion and chess.js splits measured and REJECTED with reasons
  (single non-CSS spring + static reachability; activityOf sync contract).
- Photo re-pin A/B: without the delegated load listener the thread landed
  420 px short of newest; with it, 0 px.

---

## `wave-2026-08-22-audit-round-2` — the seven-workstream wave, measured

- Honesty suite: 191 → 289 checks (+98) with family 5 (channel promises),
  T16 her.commitments, hum+floor pair. The pair closed the measured
  bracelet residual ("tune mujhe jo bracelet diya tha" now flags; the real
  chess defeat stays clean).
- Surface gate: 73-check eval, offline ~1s, incl. byte-equality of the
  Telegram lane's gate composition against the web lane and a 3-defect
  negative control on its own static scanner.
- Memory cluster: 56-check eval; T12 self.arc measured 0 bytes -> 152
  bytes for users with no rel-state row (the moment-gate coupling defect);
  laundering predicate verified on the audit's own Goa sentence + an
  over-drop control.
- Game rooms: dead-space fraction ~40% (audited) -> ~6-13% measured across
  390/320 x light/dark; 45/45 browser assertions.
- Call truth: 6 findings fixed, E2E-proofed against the real build
  (offline pill, mute-during-watch honesty, cascade-share truth), 13/13
  gates at that workstream's run.
- Coordination overhead worth recording: 1 of 7 agents mutated git state
  and cost two workstreams a full re-apply (see rejected.md
  #shared-tree-concurrency).

---

## `bargein-onset-confirm` — the noise-robust barge-in tables (2026-08-22)

Method: echosim, HEAD-built baseline vs after, same seeds. Tuning: 24
seeds/cell on the duty axis; proofs: 8 seeds/cell. Constants shipped:
ONSET_CONFIRM_MS=250, ONSET_DUTY=0.6, UTTER_GAP_MS=250,
BACKCHANNEL_MAX_MS=600, BACKCHANNEL_LOUD_MULT=16.

Duty axis (quiet-talker barge / normal barge / self-duck -3,-6 / leak -6):
0.50: 18/24, 24/24, 58%/36%, 171ms · **0.60: 20/24, 24/24, 43%/14%,
171ms** · 0.70: 15/24, 23/24, 27%/5% · 0.80: 10/24, 19/24, 10%/3%.
0.60 is the last value holding both barge cells at/above baseline
(baseline 19/24, 24/24) — ONE STEP FROM A CLIFF, stated in the source.
Window length is the weak axis (120-300ms all hold).

Transients, nobody in the room (falseCut / self-duck / leak-med, per
coupling): -3: 1/8->1/8, 88->54%, 2389->2218ms · -6: 0/8->0/8, 67->18%,
2133->171ms · -9: 0/8->0/8, 44->6%, 1365->171ms · -12: 0/8->0/8,
31->5%, 1024->85ms.

Continuers across her turn (opened-turn leak vs silent control):
-6dB 683->0ms, -12dB 767->683ms, -18dB 768->171ms. falseCut 0/8 both arms.

Genuine barge-ins: every cell 8/8 kept; cost +85ms (-3), +171ms (-6),
0 elsewhere; quiet talker -12dB IMPROVED 7/8 -> 8/8 (median +171ms).

The floor (exp1, 5 couplings x 8 seeds x 2 arms): selfRelease -3dB
1/8 -> 0/8 (the self-interruption is GONE), self-duck 68->30% (-3),
24->3% (-6); leak 1877->256ms (-3), 853->171ms (-6). Only movement
against us: barge median -6dB 840->1011ms. hardMax collapsing toward 0
is distance-to-claim increasing — the mechanism working.

Rejected along the way, measured: gating the SOFT path took the quiet
talker at -12dB from 7/8 to 1/8 — built first, thrown away.

Integration: verify-release 13/13 on the assembled seven-workstream
tree (honesty 289, surface 73, gamemem 56 all inside the eval gate).

---

## `hinglish-tts-l1` — the romanised-Hinglish pronunciation run (2026-08-22)

n=20 register lines (18 cited from persona.ts), production cascade TTS
(model/voice/prompt/key-pool identical to prod), STT round-trip, one
real paid run (cents), harness evals/speech/l1-hinglish.mjs gated on
SPEECH_RUN=1. Full table: docs/audit/2026-08-22-hinglish-tts.md.

- GENUINE FLAG: bare "hai" round-trips as English "hi".
- HUMAN-EAR QUEUE: "arreee"->"hare" (substitution), "chhod"->"chod"
  (aspiration loss — phonemic; the highest-stakes candidate).
- CLEAN: bahut, padh, and the stretch-vowel family.
- Method limit stated: 0%-match rows are mostly STT orthographic
  normalisation, NOT proven TTS mispronunciation; the live
  speech-to-speech lane is unprobeable headlessly (browser-only bidi
  WS, conversational), so this covers the cascade lane only.

---

## `photo-drop-2026-08-22` — the owner's generated library expansion

Delivery: 24/24 briefed files present in raghavsharma2003/Meera @
codex/meera-photos with exact filenames. Face-lock verified BY EYE against
the live reference on a 5-image sample (avatar portrait, diwali selfie,
holi, landing dusk, saree) — same face, same curls/bindi/jhumka, same
chikankari kurta; POV shots correctly faceless (streetdog: hand +
chappals only). Source generations 1086x1448 (portrait) / 1254x1254
(avatar) / 1672x941 (landing), 200-550 KB.

Processing: 20 moments -> 680px long edge, mozjpeg q78, ~45-50 KB each
(vs the legacy library's 272-405px / 13-33 KB — the new set is the first
retina-sharp tier). Identity assets center-cropped 900x900 q85; landing
dusk 1200w. Library now 109 tags; persona core grew +~640 chars after
telegraphic trimming, tripping the 44k tripwire as designed (raised to
45,500 with rationale at the check; check-prompt-budget unaffected).

Live: served from meera-silk.vercel.app (probe 200 on the new tags) and
in the APK from the same sha.

---

## `rupture-channel-identity` — one rupture, every channel, byte-identical

evals/rupture-channel: 37 assertions, offline, $0. One ruptured relBundle
compiled through all four real assemblies (chat, cascade call, live call,
native watch): the T2 stance block and sections.T2 byte-identical across
lanes; a lapse (by time AND by warm episodes) crosses all four together
with no lane left saying "(open)"; four compiles leave rupture_open true
and the record unmoved; G2 asserted in both directions on both lanes;
byte-identity held for bundles predating the stance split. Verified to
FAIL on the pre-fix tree (the callback-G2 and warm-count sections both
red against HEAD at build time). Caveat stated, not hidden: vy_rel_state
has 0 production rows, so this is a claim about code, not yet behaviour.

---

## `release-2026-08-22` — the painted-world APK, delivered

Shipped from ac34534: the tree that passed the final zero-gap audit
(one CRITICAL + 3 HIGH + 7 MEDIUM found, ALL fixed with measured proofs
in the same session — forget now takes the profile, the scrim ::after
composites for real at 7.91:1, hardware back exists, the story pool
never repeats or re-golds at midnight, family 3's raha-amplifier
closed at 351 honesty checks, clouds -76%). Web live at index hash of
the same sha; APK 12.35MB with all 10 world paintings + optimized
identity verified INSIDE the artifact before delivery. Session totals:
~27 shipped slices, eval counts at close: honesty 351, sky 167,
teardown 187, burst 119, greeting 75, feel/world/back browser
batteries all green, verify-release 13/13 throughout.

---

## `phase3-thread-onboarding-settings` — 2026-08-22, WS-PHASE3 + WS-LANDING

Method: real-pixel sampling of decoded shipped JPGs composited under the
authored veils (check-contrast, prefix-walk over 20 bands for the landing,
full-frame x {avg,darkest,brightest} for the thread); Playwright frame
sampling for perf; n as stated.

- Thread ground text worst case (all 5 states x 2 themes x 3 bands x 3
  stats): 4.70:1 (floor 4.5). Chips 5.48:1. Control edges 3.49:1 (floor 3).
- Wallpaper presence A/B: ground luminance sd 0.00 -> 4.47 (dark night),
  0.00 -> 1.22 (light morning). The 0.00 IS the owner's two screenshots.
- Thread scroll perf, 300 messages, 90 sampled frames: p95 17.30ms ->
  17.20ms (0.994x), median 16.60 -> 16.70. Wallpaper box static across
  all sampled frames.
- Typing indicator vs last bubble: -0.7px overlap -> +13.3px gap;
  asserted at n=4 and n=300 threads and 40 samples across a burst.
- AI-disclosure footer on sheet glass: 2.69:1 on `--ink-faint` ->
  passes on `--ink-dim` (token choice now pinned).
- Injected-violation battery: 8/8 caught (translucent bubble, void veil,
  thinned light veil, drifted dark blocks, shadow-only lift, faint
  footer, thinned sheet glass, restored typing bug).
- Landing first view (phone 390): 830KB -> 392KB night / 445KB golden
  worst; above-the-fold 241-294KB; privacy 221-226KB. Hero text worst
  4.83:1 under the prefix-walk (content only moves UP the fixed painting).
- Eval counts at close: sky 180, persona 206, browser battery 115 checks
  / 43 shots (thread+onboarding+settings), landing negative-tests 8/8,
  verify-release 13/13 twice.

---

## `sweep-2026-08-22` — every remaining surface held against the world

Method: 28 audit screenshots -> ranked defect list -> 110 after-frames
(13 surfaces x light/dark x night/morning x 390/320 x reduced-motion),
contrast gate extended and negative-tested.

- 11 surfaces fixed, 3 proven NO-CHANGE with frames (CallVoice, auth
  body, settings sub-sheets). Contrast gate 213 -> 268 checks, 6/6
  injected violations caught.
- Two stale hand-copies found still citing the call screen's REMOVED
  gradient as their reason; both deleted rather than edited.
- Gate bug fixed: first-block-per-selector reads masked later
  overrides (same class of hole as the .msg.her double-declaration).
- New anti-pattern pinned: a pure-white board cell passes every
  contrast ratio and is still wrong on a painting; the gate now
  requires tinted-not-neutral, read from the block the board uses.

---

## `callcost-2026-08-23` — what a minute of Meera costs (WS-CALLCOST)

Method: lane constants read from the shipping code, prices fetched
2026-08-23 from ai.google.dev/gemini-api/docs/pricing (they DOUBLE on
2027-01-01 per the page), arithmetic reproducible at the scratchpad
calc script; bands = her talk share 0.25/0.39/0.55.

- List price per TYPICAL minute: live voice $0.0142, cascade voice
  $0.0289, live+screen-share $0.0374, cascade+screen-share $0.109
  (0.080 warm-cache to 0.399 cold: vision cache-hit rate UNMEASURED,
  5x uncertainty). Today-cost $0 until the free pool's daily budget
  exhausts; N minutes/day of free capacity is unmeasured.
- 30 min/day month: live $13 (Rs.1,096), cascade $26 (Rs.2,210, within
  2% of decisions.md's independent Rs.2,260), live+share $34.
- Dominant drivers: video frames (47-65% of a share minute), her output
  audio ($12/1M live, $20/1M cascade TTS: the fallback lane costs 2x),
  the 44.8k-char system instruction (billed per cascade TURN and per
  goAway rotation, ~$0.0105/rotation; video shortens rotation cadence).
- Silent multipliers found: frames sent at 1.67fps against a documented
  1fps ceiling (billing ambiguity up to 14x, ONE usageMetadata probe
  settles it); flush frames ignore scene-change gating (up to a third
  of the video bill on a frozen screen); MAX_ROTATES=6 drops to the
  ~100x-cost cascade+vision lane on a server event nobody watches; a
  greeting think+TTS is paid per call and usually discarded ($0.0044).
- cache-9x's "cost is not the constraint" verdict SURVIVES for voice
  ($5k = ~35,200 ten-minute calls, unchanged) and DOES NOT survive for
  screen share (~13,400 live / ~4,600 cascade).
- Ranked unmeasured: real usageMetadata per call, real talk share,
  vision cache-hit rate, free-tier N, goAway rate while sharing.

---

## `tester-wave-1` — 2026-08-23, first external tester (Gaurav)

Method: WhatsApp feedback + chat screenshots reproduced as scripted
flows; every fix eval-pinned; n as stated per suite.

- Honesty checks 351 -> 393 (family 6, activity specifics; the tester's
  7 fabricated lines are permanent must-fail negatives, and the same
  "catalan" sentence passes against a Catalan record).
- callmem eval 195 assertions (call brief carries yesterday + last
  call + game ledger; budgets pinned: shared history 700B, activities
  300B, live tail 20,895/24,000, live+watch 23,047/24,000).
- Echosim floor: byte-identical tables before/after, run twice
  (5 couplings x 8 seeds x 2 arms).
- Farewell detector: 20 positives fire, 23 adversarial negatives do
  not ("bye bolna galat laga" class); ends 1.4s after her goodbye.
- game-invite detector 123 assertions (negative-heavy by design);
  gameplay browser battery 87 assertions incl. full chess games from
  the black seat (133 and 86 plies, castling + promotion).
- Persona: core 45,494 under the 45,500 tripwire after three trims;
  assembled tripwire deliberately raised 50000 -> 51000 (dated
  rationale at the check; growth cost ~$0.0004/session).
- Tester positives preserved and logged: voice clarity/latency praised,
  callback-on-drop praised, chat-side cross-modal memory worked.

---

## `memory-wave-2026-08-23` — the world-class memory wave, measured

Method: WS-MEMAUDIT 12-scenario matrix through the real compiled engine,
then four workstreams, each gated; numbers below are before -> after.

- recall@8 on the labelled fixture set: 73.9% -> 95.7%; queries answered
  76.9% -> 92.3%; false fires 0 -> 0. Hinglish tokenizer: 13/19 -> 17/19
  real queries non-empty, 14 negative probes 0 fires.
- Mid-call memory cues: 9/9 recall, 0/12 false fires, note <=500B.
  Running note carries minute-3 AND minute-12 facts to minute 40.
- Lane parity: T1-T16 + sub-blocks rendered per lane under a full
  fixture (158 assertions); watch exemptions each carry a stated reason
  at the call site; pre-fix dark lanes reproduced as negative control.
- First-ever consolidation run, measured read-only against prod:
  10 people, 180 pending rows, ~$0.03 typical / $0.05 worst.
- Kin precision traps: 5/5 third-party shapes refused with reasons.
- Cross-device: 18/18 two-real-contexts browser assertions incl.
  clear-chat tombstone against a stale peer.
- Hinglish-forget baseline PRE-REGISTERED: adversarial recall 5.9%
  (1/17), controls 100%, 100% when the model resolves the referent;
  the yardstick for survey A1, not fixed this wave.
- Call-lane byte bound: was passing by omission (~5,920B of relational
  blocks uncounted); now counts them, cap 24,000 -> 30,000 with
  rationale, landing at 98.0%/99.0%.
- Suite counts: callmem 323, recall 209, consolidation 98, lanes 158,
  sync +22, milestones +41, forgetlex 34, game-invite 123.

---

## `feltmem-rehearsal-2026-08-23` — the battery's first judged run (underpowered, archived)

Method: pre-registered battery (hash 4e2f7f51..), blind both-orders A/B,
arms = pre-wave build vs current, judge anthropic/claude-opus-4.8 via
OpenRouter. Run TRUNCATED by the OpenRouter key's total limit: 241 of
1,320 judgments landed, n=130/arm < the 300 floor, so per
fab-noise-floor NO rate below is citable; verdict label: rehearsal.
$2.2372 spent. Archived: evals/feltmem/runs/judged-2026-08-23-REHEARSAL.json.

- Direction only: law 1 retold-not-recited +0.89, law 7 human-time
  +0.84 (the wave's two directly-built laws), ammunition flags halved
  (30 to 16). Preference 5.4pp (needs 10 at power).
- Permanent-negative flags fired on BOTH arms (fabricated 35 pre /
  31 cur) — before the powered run, VERIFY whether the battery's
  generation path runs the full brain gate chain; if it does, the
  judge's "fabricated" is catching classes outside family 4/6 coverage
  and that is the next honesty frontier; if it does not, the battery
  is judging ungated output and must be fixed first.
- BLOCKER for the powered run: OPENROUTER_KEY total limit exceeded —
  which ALSO means production's cash fallback lane is dead until the
  key is topped up; free pool alone carries production today. Owner
  action. Alternative: qualify the Azure grant judges (#57).

---

## `judge-qualification-2026-08-23` — every zero-cash judge measured, none passes

Method: judge-backtest.mjs against the archived blind verdicts
(charm-grok + charm-luna, ground truth anthropic/claude-opus-4.8),
80% pooled-agreement bar, both-orders-agree rule. $0 cash (Azure grant).

- DeepSeek-V4-Flash 27.4% [19.4,37.1], gpt-5.6-terra 52.1% [42.2,61.8],
  grok-4.3 34.4% [25.6,44.3] — ALL FAIL, all with heavy slot-A position
  bias (58-81%). qualified_panel remains empty.
- Remaining zero-cash candidate: gemini-3.6-flash as judge via the
  OpenAI-compatible endpoint on EVAL-ONLY keys (config committed,
  unqualified until backtested). The powered feltmem run therefore
  WAITS on ~11 fresh AIza eval keys (owner: not right now) — the
  one-command runner scripts/feltmem-overnight.mjs refuses to spend
  under an unqualified judge.
- Also measured: a pasted "AQ."-prefixed Google credential is not an
  API key shape and returns 403 project-denied; only AIza keys join
  any pool, after a live probe.

## `sound-browser-2026-08-23` — the sound layer, in a real browser (WS-SOUND)

Method: `evals/sound-browser.mjs`. Chromium (playwright), 390x844, the app
built and served by `vite preview`, `/api/chat` stubbed so the script is
deterministic and costs $0. `AudioContext` is patched by an init script that
runs BEFORE any app code, recording every context constructed and every source
node started; the sound layer's context is identified by its `latencyHint:
"interactive"` (the voice lane builds its contexts bare). Node starts are
grouped into CUES by a 25ms gap, because a cue schedules all its voices in one
synchronous block and the module's own throttle floor is 70ms. n = 1 run per
case, 5 cases; every number below is a count, not a sample.

- AudioContexts belonging to the sound layer before the first user gesture: **0**
  (app mounted, home painted, thread restored, layer armed).
- After the first gesture: **1**, and **0 cues** — unlocking is silent, and a
  restored thread full of her messages is not an arrival.
- Her opener in a fresh chat: **1 cue**.
- One send: **1 cue**.
- A three-bubble reply: **2 cues total** (one send + one arrival), not 4.
- Toggle tapped off in Settings: **0 cues** on the next send, and `soundOn:
  false` in localStorage.

Offline gate (`evals/sound.mjs`, fake AudioContext, ~2s, $0): every cue is
scheduled within its declared span, respects its declared peak, and carries
both layers (a noise transient AND a pitched body). Absolute peak of the
loudest cue = 0.75 x 0.34 master = **0.255** of full scale; ceiling 0.28.
Palette spans 0.55-0.75 relative, so the set is ranked rather than flat.
Negative control in the same run: with the in-call clause deleted from the real
bundle, a live call DOES leak a cue.

Not measured, and deliberately not implied: whether any of it sounds good, and
whether Android's ringer switch silences it. Neither is reachable from this
harness. `src/sound/index.ts` states the iOS half as `[unmeasured, platform
documentation]` rather than as coverage.

---

## `improvement-wave-2026-08-23` — six slices, one integration

- Forget A1: adversarial recall 5.9% -> 76.5% (pre-registered A4, 5
  live runs identical), wrong rows 2 -> 2, false receipts 16/27 ->
  3/27; free-pool arm INVALID (18/27 429s) recorded not hidden.
- Patterns unreachable-forever fixed: eligibility counters were never
  set and reinforce had no caller; T4 rendered 0 bytes for every user.
  Consolidation suite 98 -> 144 with the pre-fix zero as negative
  control.
- Sound: 5-cue synthesized vocabulary + 6-entry REFUSED table, four
  gates each with named blockers, in-run negative control (in-call
  gate removed must leak). New suites sound + sound-browser (11/11).
- Notify: keyless local lane live (reply/missed-call/story), FCM
  scaffold zero-bytes-until-config, permission at first FELT moment,
  push-token FATE on both suites (wipe yes, scoped forget deliberately
  no). notify suite 97, browser 14/14 headed.
- Knows: 57+23 assertions, 8 contrast checks, forget flow end-to-end
  with refused-delete negative control; ritual/india rows honestly
  bin-less (gated to flip when the cascade learns keys).
- Persona core 45,493/45,500 after paid-for trims. verify-release
  13/13 twice on the integrated tree.

---

## `movevoice-timing-2026-08-23` — how long her move actually takes, measured in a browser

**Method.** `evals/movevoice-browser.mjs`, chromium, the built app served by
`vite preview`. A full game of chess is played move by move against the real
opponent; on every one of her turns the page's OWN clock
(`performance.timeOrigin + performance.now()`, polled at 25ms inside the page
so this harness's round-trip is not counted as her think time) stamps the
moment his ply appears in state and the moment hers does. The gap is held
against `chessThinkMs` called on the same position with the same session seed —
the function the component itself reads, not a copy of its formula.

Predictions are emitted as a PAIR (recapture / non-recapture) because her reply
is not known when his move is made, and the assertion admits either branch
rather than pretending to know which she will play.

**Measured (n = 25 of her turns, one complete game, container under load):**

| | |
|---|---|
| gaps | 455 – 6759 ms |
| spread within one game | 6304 ms |
| below the 300ms floor | 0 of 25 |
| landing before the board finished drawing his move (360ms) | 0 of 25 |
| gap inside the table's predicted band | 25 of 25 |
| ordering pairs (predicted gap differing by >400ms) where observed order matched predicted | 245 of 265 (92.5%) |

The last row is the one that matters and is the one a constant delay would
fail: the first three rows are all satisfied by "always wait 2 seconds". The
pacing has to TRACK the position for her to read as thinking rather than as
lagging, and it does.

**Pre-fix baseline, from the owner's report rather than an instrument:** her
move landing "milliseconds after his". The floor is now 300ms by construction
and was not observed below 455ms in this run.

**Offline half:** `evals/movevoice.mjs`, 162 assertions, ~3s, $0. Bounds swept
over 5,120 synthetic chess inputs (every combination of ply × legal-move-count
× check × recapture × book × seed) with no result outside [300ms, 7000ms].

**Aggregate cost against the formula it replaced (n = 1600 of her turns over 40
real games, both colours, driven by the real engine):** the position-scaled
table is 8.7% SLOWER in aggregate than the flat ply-band formula — mean 3078ms
vs 2831ms per turn, max 7000ms vs 5996ms. Small, and it is the price of the
92.5% ordering agreement above: the modifiers that make a forced reply quick
are outweighed by the wide-position and non-book-opening bands. It matters in
exactly one place, which is why it was measured rather than assumed:
`evals/gameplay-browser.mjs` bounds a full game by WALL CLOCK, and its 6-minute
budget was only ~1.5x a long game's expected duration. Raised to 10 minutes in
the same change.

**Mutation test of the gate itself (n = 10 injected defects, all caught):**
dropping the settled clause from the chess composer; dropping it from the ttt
composer; neutering the staleness check; sending held notes into `direct()`'s
wait; routing the chess note around the seam; returning a constant 5ms from
`chessThinkMs`; the same for `tttThinkMs`; reseeding pacing on `Math.random`;
removing the position scaling so every band collapses to one; and deferring
`pokedPly` past the send so a dropped note un-marks its exchange. An earlier
version of the suite caught 0 of the first 3 — its assertions were shape-greps
over the call site rather than tests of a decision — which is why the seam and
the note composition were extracted into pure functions.
