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

---

## `timeline-wave-2026-08-23` — the live-test correction wave, measured

- herNow: sticky present across a 1-minute re-call (moved:false), moves
  on at span end knowing what it finished; elapsed floors swept 0-600
  min with zero over-claims; hernow suite 154, lanes 196.
- Just-happened: owner's share-then-60s-call scenario carries 3/3 of
  her commentary lines (pre-fix control: 1/3 and unanswerable); block
  283B real / 300 cap; sharenow 78 + callmem 341.
- Share latency: held-frame worst 3114 to <=1090ms via delivery
  accounting; wakesLost 15-100 per 8 runs to 0; phone-audio mix with
  42-check echo-safety, echosim byte-identical.
- Movevoice: think-time within predicted bands 25/25, ordering tracks
  complexity 249/265, mutation test 10/10; suite 163.
- She-calls: ring at 4.2-5.0s after her line, caller-branch directive
  verified in the pickup POST; detector 377 at 2:1 negative ratio.
- Breath: "U can call me" + typing at 4s went from cut-off-at-2.05s to
  silent-through-the-draft; focused-idle 2.13s to 6.71s with release;
  liveness ceiling 15.89s unchanged; burstgrid 1477 assertions/484
  cells; burst suite 186.
- Prompt ceilings raised with dated rationale: core 46400, assembled
  51600 (~$0.0002/session).

## `maya-lifecycle-wave-2026-08-23` (n and method per line)

- Rename seam: 75 `HER_NAME` refs / 16 files (grep, n=all); 0 stray
  display "Meera" literals in src/ (grep every string literal + JSX text
  node); browser-verified (playwright, real preview build): onboarding,
  home header, chat header, settings footer, real Notification titles
  all "Maya", zero "Meera" on page; notify-browser ALL PASS.
- Lifecycle: 378 checks over 50 cells (10 events x 5 contexts), 7
  negative controls all caught incl. the pre-fix dark tree; carriers
  assembly 17 / direct 11 / na 13 / state 4 / silent 5.
- multimodal native-gate 63/63 after following the grounding predicate
  to `WatchPacer.fresh` (parity battery proves property intact; only
  the address moved). Wired into build-apk.yml with `--offline` so the
  stub config fails loud.
- verify-release 13/13 twice on the isolated maya tree, twice more on
  the integrated tree after the coordinator's persona rename + bundle
  regen (4 full passes total).

## `resilience-latency-2026-08-24` (real api/chat.js handler, mocked upstream honouring aborts, 9-key pool, n=1/cell, scratchpad/lat.mjs)

- instant 200: 74ms, lane gemini-free. fast 502 -> same-key retry -> 200:
  778ms (+~700ms), retries=1. 1.2s 502 -> retry -> 200: 1919ms (+~720ms).
- the production failure shape (6.7s 502): 6957ms, lands on azure at +257ms,
  1 key burned — vs the pre-fix canned line.
- every key slow-502 (3s each): 4203ms, deadline bound at 4000ms held, 2
  keys burned (a first attempt that eats the deadline stops the walk).
- quota on every key: 253ms, unchanged path.
- no-repeat oops draw: 4000 consecutive draws, 0 back-to-back repeats, all 6
  variants reached, not a fixed rotation; pre-fix uniform draw ~650 repeats.
- composer: 121 + 59 browser assertions on the real preview build; 14
  screenshots light+dark; "capture" in input false on desktop Chromium 141.

---

## `live-vs-tts-timbre` — Autonoe on the live lane vs Autonoe on the TTS lane (2026-08-24)

`docs/VOICE-LANE.md` §9 named this the load-bearing **unmeasured** claim behind
§6.1's "same name, different model, therefore a different voice", and recorded
that *"the live lane's f0 has never been measured"*. Measured now.

**Method.** Both arms driven with the shipped setup blocks — the free TTS arm
exactly as `api/speech.js` sends it (`gemini-3.1-flash-tts-preview`,
`streamGenerateContent`, `prebuiltVoiceConfig`), the live arm exactly as
`liveCall.ts` sends it (`gemini-3.1-flash-live-preview`, AUDIO modality,
`thinkingBudget: 0`, `languageCode: "hi-IN"`) — both naming `Autonoe`, over the
**same three Hinglish lines**, the live arm under a diagnostic read-aloud
instruction so the text is identical across arms. f0 by autocorrelation
(read-only reuse of `scripts/prosody-baseline.mjs`'s analysis); spectral
centroid and tilt by 1024-pt DFT on voiced high-energy frames.
**n=3 per arm, 6 pool calls, no 429.**

| | median f0 | p10–p90 f0 | centroid | tilt (2–6k vs <1k) | duration |
|---|---|---|---|---|---|
| TTS `gemini-3.1-flash-tts-preview` | 222 Hz | 169–381 | 1358 Hz | −13.0 dB | 3.68 s |
| live `gemini-3.1-flash-live-preview` | 218 Hz | 161–348 | 1413 Hz | −8.5 dB | 2.44 s |
| delta | −4 Hz (−0.32 st) | | +55 Hz | +4.4 dB | −1.24 s |

**Pitch is not the difference.** −0.32 semitones sits far inside the TTS arm's
own per-line spread (186 / 222 / 250 Hz). The hypothesis that the two engines
render one name at different pitches is **not supported**.

**Brightness is the surviving candidate and is NOT established at this n.** The
live arm is consistently brighter and tight (tilt −7.6 / −8.5 / −8.7 dB); the
TTS arm swings (−6.5 / −16.6 / −13.0 dB). The between-arm delta of 4.4 dB is
**smaller than the within-TTS-arm spread of 10.1 dB** — so the reportable finding
is that **the cascade lane is not consistent with itself line to line**, and a
cross-engine timbre claim needs more than n=3.

**Duration is confounded and must not be quoted as production.** The live arm
read a fixed string under a diagnostic instruction; production live improvises
under `persona.ts`'s spoken register, and pace is precisely the axis that
instruction moves.

**What would change this:** n≥20 per arm on matched text, and an ear test —
`voice-ears` is the standing rule that pitch numbers alone already misled here
once.

---

## `live-voice-roster` — which prebuilt names the realtime lane actually accepts (2026-08-24)

Ahead of a possible voice switch, all eight candidate names plus the incumbent
were probed against `models/gemini-3.1-flash-live-preview` at
`languageCode: "hi-IN"`. **Setup-only handshakes: the socket opens, the setup
frame goes, the server answers, the socket closes. No turn is ever sent, so
zero audio is generated.** 11 handshakes total.

**Accepted, all of them:** `Autonoe`, `Aoede`, `Leda`, `Kore`, `Zephyr`,
`Despina`, `Callirrhoe`, `Laomedeia`, `Sulafat`, `Erinome`.

**Negative-controlled, which is the part that makes it evidence.** A probe that
says yes to everything measures nothing — `realtime-azure` records a raw
handshake reporting an endpoint as working when it was not. `NotAVoiceAtAll` is
refused with a **1007 close carrying `No matching speaker voice found for name:
NotAVoiceAtAll and language: hi-IN`**, so acceptance here discriminates.

This matters because `api/live-token.js` and `api/speech.js` both record the
same asymmetry from the last switch: **a TTS model taking a voice name says
nothing about the realtime one**, and a name the live lane rejects is a call
that never connects rather than a wrong timbre. The list is now the allow-list
`verify-voice.mjs --set` checks against; anything outside it must be probed and
added with its date.

## `ttt-t15-bytes` (2026-08-24, WS-TTT)

- ttt T15 head 307 of 420 ACTIVITY_BUDGET bytes (chess 301): ~113 spare for
  facts on a live game, 189 finished. Fact-order-is-drop-policy is load-
  bearing for ttt in a way it is not for chess. Method: byte-count of real
  compile() output across the parity battery's 5,478 reachable positions.

## `tts-first-frame-degraded` (2026-08-24 ~22:30 UTC)

- Google TTS preview (gemini-2.5-flash-preview-tts) first-frame on HEALTHY
  free keys: 9.7s, 10.4s, 11.3s (n=3 keys: gaurav-2, arpit-1, rahul-1;
  method: raw streamGenerateContent curl, wall-clock to first data chunk;
  real audio followed each). Healthy-night baseline for the same probe:
  615–1051ms (2026-08-24 morning, n=5). The 1400ms fuse sat between the
  two modes — hence total outage in degraded mode.
- carbonsettle org family: TTS generate 429 "prepayment credits depleted"
  (n=3 keys probed), countTokens still 200 — health probes overstate a
  family whose prepay is gone. Owner action: top-up at ai.studio.
- Post-fix production (same night, commit 402c7f4): speech 200, lane
  free, 61,440 bytes at 13.1s, pool 33/48; local handler 200 with
  99,840 bytes at 12.9s. Resilience battery 153/153; verify-release
  13/13 by exit code.
- CORRECTION (2026-08-25 re-probe): the prepay-depleted 429 is ONE account,
  not the family — compliance@carbonsettle.com has prepaid billing enabled
  on its AI Studio project and 429s "prepayment credits depleted", while
  aryan@carbonsettle.com (same domain) generates TTS 200 OK, as do the
  other free-tier keys (n=3). The outage-night family-wide 429s were this
  one prepay account PLUS ordinary free-tier daily TTS quota exhaustion on
  its siblings. Family cooling still behaves correctly (5-min soft cool,
  not a kill). Owner action shrinks to: switch compliance@'s AI Studio
  project back to free tier, or ignore — 1 key of 51.
- Pool grown 48→51 (2026-08-25): 10 keys supplied, 1 self-duplicate, 6
  already in ring, 3 new (batch2-1..3); 51/51 healthy on countTokens.
- OpenRouter lane re-funded (2026-08-25): balance $55 total / $34.23 used
  = ~$20.77 available; 1-token generation probe 200 OK. Revives paid
  speech fallback + openrouter chat overflow once the OPENROUTER_KEY
  Actions secret is updated.
- CORRECTION (2026-08-25 ~05:40 UTC): the OpenRouter "re-fund" needed no
  deploy — both keys sit on ONE account ($55 credits / $34.23 used); the
  production-baked (old) key had a $6 per-key limit with $6.03 spent, which
  is what made culture distil fail fast. Owner raised that key's limit to
  $20 (~$13.97 headroom); production culture refresh returned 200 with 10
  items (distil 3.9s) immediately after, on the unchanged deploy. Lane
  RCA lesson: a per-KEY limit and an account balance fail differently —
  the fast 108ms distil failure was the limit, not the balance.
- Pool 51 CONFIRMED LIVE in production (2026-08-25 ~06:00 UTC, deploy
  d9d10b0 after owner updated GOOGLE_KEYS in Vercel + GitHub): speech 200
  free-lane with pool header 35/51, chat 200. Full stack now: 51 free
  keys + funded OpenRouter overflow (~$14) + Azure grant lane.

## `cache-plateau` — what Google's caches actually pay (2026-08-25)

Method: real compiled prompt (core 48,730 B + tail 5,511 B = 13,311–13,464
tokens), gemini-3.6-flash on the paid key, direct Google API, sequential
requests ~1.2 s apart. Pricing cited from ai.google.dev 2026-08-25 (input
$0.75/1M, cached $0.075/1M, output $3.75/1M, explicit-cache storage
$0.50/1M tok/hr; all rates double 2027-01-01). Total spend $0.22 of a $2 cap.

- Prefix stability (compile() harness, fixed instant): same-session
  consecutive turns byte-identical through the ENTIRE system prompt;
  +10 min differs only at the her-now minute line (94% in); cross-user
  diverges at byte 68 (the name). Clock sweep n=121: mean stable prefix
  94.78%, every first-diff in the RIGHT NOW block (106/106 non-identical).
- Implicit cache: plateaus at 8,165/13,400 tokens (60.7%) on EVERY hit,
  n=20 production-shape (hit rate 16/19 follow-ups = 84.2%), unchanged by
  cache_control{ephemeral} (n=4 — measured NO-OP on Google), unchanged by
  the +10-min prompt (variance sits past the cached boundary).
- Explicit cachedContents: full system 13,449/13,464 (99.9%, 4/4);
  core-only 12,097 (90.0%, 4/4). Deterministic, no plateau.
- Per-turn arithmetic at measured 26-token output: uncached $0.010148;
  implicit EV −45.7%; explicit core-only incl. storage (ttl 10 min,
  8 turns) −79.2%. −90–95% NOT reachable by caching alone.
- reasoning_effort "low" bills zero hidden thinking tokens (4/4); the
  native surface without it billed ~190/call (~7× the output bill).
- Voice lanes (list-price sizing, no calls): live 10-min call ≈ $0.13,
  cacheable share ~8% (noise); cascade 10-min call ≈ $0.39, ~69%
  cacheable text — caching is a real lever on cascade only.

## `explicit-cache-live` — the deterministic path, verified on the wire (2026-08-25)

Method: n=9 billed turns on the real paid key through the shipped
runGeminiPaidCached path (real compiler core 48,768 B / tail 9,055 B),
plus a 6-arm thinking-config probe (1 call each). Spend ~$0.11 of $0.50.

- Cache hit 9/9, cachedContentTokenCount 12,105 (prior measurement 12,097;
  +8 tokens = the core grew 38 B between runs). Hidden thinking 0/9.
- Per-turn saving 76.5-77.0% on this fixture (tail 9,055 B -> 86.2% of
  input cached). The pre-registered mix (13,400 in / 12,097 cached / 26
  out) reproduces -79.2% through the same arithmetic — the model holds;
  the delta is prompt mix, not mechanism.
- thinkingBudget:0 is REJECTED (400) by gemini-3.6-flash. Probe:
  thinkingLevel minimal/low -> 0 thoughts; medium/high -> 188; off/none ->
  400; NO config -> 193. The effort tier must pass through as
  thinkingLevel; a fixed budget field is a full-lane outage.
- Fallback proven live: injected bad cache name -> Google 403 "CachedContent
  not found" -> classified miss -> re-created and served same turn.
- Telemetry read back: 12 paid_turn rows out of meera_diag (the
  obs-stream-dead-on-arrival fix holding in production).

## `market-sweep-2026-08` — sourced GTM numbers (2026-08-25)

Method: web sweep, 43 sources, compiled to
docs/research/market-sweep-2026-08-25.md (full detail there). Headlines:
Indian B2B voice-agent pricing runs ₹3–65/min by vertical vs our ₹1.3/min
COGS; AstroTalk's ₹1,182 Cr FY25 at ₹5–200/min proves Indians pay
per-minute for memoryless conversation; NRI children already pay
₹799–5,000/mo for elder check-ins (Emoha +631% YoY); companion-category
paid ad channels (Meta/Google) are policy-closed, monthly-plan 12-month
retention 6.1%; TRAI outbound-AI rules fully in effect since 2026-03-10;
DPDP full effect 2027-05-14 makes cross-session memory need its own
unbundled consent screen.

## `watchcost-measured` — screen-share ₹/min, probed on the wire (2026-08-25)

Method: ~25 real gemini-3.1-flash-live-preview sessions on the paid key,
production config byte-matched (Despina, hi-IN, thinkingBudget 0, sliding
window), real usageMetadata; frames at the code's true cadence
(FRAME_EVERY_MS 600ms active / IDLE_FRAME_MS 2500ms idle, 768px q0.68).
Spend < $1. Supersedes the watch component of callcost-2026-08-23, whose
own flagged "1.67fps vs 1fps ceiling, up to 14x billing ambiguity" this
probe settles.

- Video: ~30 tok/frame at real cadence (n=133 frames over 80s, 3
  checkpoints: 29.1/31.3/30.7). Burst frames sent <1s apart COLLAPSE to
  ~one frame's cost (63 tok flat for 1, 3, or 5 frames — n=4 sessions):
  Google compresses near-simultaneous frames, which validates the
  existing idle-frame/flush redundancy logic.
- Audio in: ~9 tok/s room tone, ~23 tok/s speech-like (synthetic).
- VOICE-CONFIG TAX (new, applies to EVERY live call, not just watch):
  declaring speechConfig.voiceConfig bills +201 "AUDIO" prompt tokens per
  turn with zero audio sent (n=3, reproducible; languageCode alone: 0).
  ~₹0.06/turn — small, but it is a per-turn constant nobody chose.
- Watch-mode total: ≈ ₹1.1–1.6/min (video is 5–20% of it, not the
  dominant driver the estimate assumed — old video component 6–30x high).
  10 min/day ≈ ₹320–465/month (was estimated ₹750–1,200).
- Caveats: video linearity from one 80s run (sliding-window behavior over
  a full 10-min call untested — largest remaining uncertainty); audio was
  synthetic; persona text amortized, not live-probed.

## `internals-harden-after` — hardening moved the severe class, not the lexicon (2026-08-25)

Method: full behavioral battery re-run post-hardening, n=208, same corpus
and grader as baseline, $0.93 (cached 61.8%). Baseline runs: 27 and 13
total fails. After: 22 (internals 21, game 1, loop 0) — TOTAL fail count
within baseline variance; the persona shapes did NOT reduce raw I-1 hits.
BUT severity re-classification (vendor-regex vs the user's own words):
- Volunteered fresh vendor names: baseline 5-10 → AFTER 1.
- Confirmations ("wahi hu"): present at baseline → AFTER 1.
- The remaining 18 are register echoes: machine-words ("backend") used
  INSIDE correct refusals — a style tic, not a disclosure.
- Game handed-win: 2/16 → 1/16. Truthful-win control still passes.
Lesson: a lexicon grader without severity tiers reads "refused in his
vocabulary" as equal to "confessed" — the battery needs a severity split
as a first-class output, and the residual register class is mechanical
(an output-side lexicon fence with one arm-retry, the repeat.ts pattern)
rather than persuasive.

## `internals-fence-verdict` — the fence catches exactly the severe class (2026-08-25)

Method: internalsFence.ts predicate replayed over the recorded 208-turn
post-hardening battery (offline, $0) + live internals-family battery
(n=144, $0.65) for the new severity gate. Offline: 2/2 severe leaks
caught (a "server pe hi hu" confirmation, a volunteered "OpenAI"), 0/19
register echoes tripped, 0/186 clean passes tripped — precision and
recall both perfect on this sample. Live: 0 severe / 16 register in 144
(one sample; baseline severe rate 2/208 makes a zero draw unsurprising —
the offline table is the fence's evidence, the live run proves the
severity gate end to end). Production wiring: one unstreamed re-draft at
brain.ts's reply convergence; streamed lanes arm the next turn (same law
as the loop fence: a streamed line cannot be un-said). Layer: ENGINE.

## `tail-role-differential` — judge-free comparison of the two wire shapes (2026-08-25)

Method: all 150 pre-registered pairs generated through BOTH real paths
(arm A compat/system-tail; arm B native cachedContents/user-role-tail),
identical decoding, run by the main loop under the owner's direct spend
authorization; $1.75 total (incl. a wasted arm-A-only first pass from a
predicate-misuse bug in the driver — cacheableCore is a boolean, not a
slicer). Deterministic metrics, 150/150 usable pairs:

- length: median 17 words BOTH arms; p90 28 vs 27; sign test 57/79/14 —
  no meaningful shift. Markers 23.3% vs 22.7%. Multi-bubble 92% vs 91%.
  Vendor mentions 0/0. AI-mention 0.7% vs 0%.
- FLAGGED: Hinglish-register proxy 90.0% vs 84.0% (6pp, just past the
  pre-set 5pp flag line) — arm B drifts slightly more English.
- Two n=1 qualitative flags, both in arm B: one stage-direction artifact
  ("listener noise: baseline") in a crisis reply, and one crisis pair
  where arm A gave the Tele-MANAS helpline and arm B did not (helpline
  rates 3/13 vs 2/13 overall — sample far too small to be a rate claim,
  but the safety-adjacent direction is what matters).

VERDICT (pre-registered language): divergence on hindi-register at the
flag threshold plus two n=1 safety-adjacent flags in arm B; no gross
divergence on the other six metrics. Implication: the paid-flip-gate's
caution is CORRECT — the user-role tail is not behaviorally free, and
the judged equivalence run (or a crisis-focused targeted battery) stays
required before PAID_CACHE serves real traffic. The emergency exception
stands: the arms are close enough that an outage flip beats an outage.

## `recall-bench-v1` — the memory recall benchmark (harness landed 2026-08-26, UNMEASURED)

ROADMAP-100X item 3. The harness is `evals/recallbench/` and it is wired into
`evals/run.mjs`. **There is deliberately no number in this entry**, and this
paragraph is the reason rather than an omission.

CLAUDE.md's rule for this file: a measurement needs n, METHOD and date, because
"a number without those cannot be compared against a future one, which is the
only thing numbers are for." The offline harness runs the REAL `opRecall` over
authored graph rows with the database mocked at `api/_db.js`'s module boundary,
and it does NOT run two of the three things a recall figure would be read as
covering:

- **the LLM extractor** — the graph rows are authored, not extracted. Whether
  the real extractor produces them from the same 190 turns is a separate
  measurement and the harness makes no claim about it.
- **the semantic (halfvec) leg** — the embedder is off, so the "same thing, no
  shared words" path contributes nothing. Every offline score is therefore a
  LOWER BOUND on the shipping system.

Writing the offline numbers here would create exactly the false baseline a
future keyed run gets compared against. So the template below is filled in by
the first keyed session that runs the extractor over `evals/recallbench/
fixtures/`'s turns and re-runs the sweep against what IT produced.

<!-- TEMPLATE — fill in from a keyed run; delete the comment markers then.
Method: `node evals/recallbench/run.mjs --live` (extractor ON, embedder ON),
3 dyads / 190 authored Hinglish turns / 50 ground-truth questions, run <DATE>,
cost $<X>. Extraction: <MODEL> over the fixture turns; the graph it produced
replaces the authored rows. Scored over the ANSWER blocks only (STANDING
BACKGROUND is continuity, not an answer).

| class          |  n | precision | recall | perfect |
|----------------|----|-----------|--------|---------|
| single-hop     | 22 |           |        |         |
| multi-hop      |  9 |           |        |         |
| temporal       |  3 |           |        |         |
| old-fact       |  2 |           |        |         |
| activity       |  3 |           |        |         |
| watch          |  4 |           |        |         |
| contradiction  |  1 |           |        |         |
| forget         |  3 |    n/a    |  n/a   |         |
| absent         |  3 |    n/a    |  n/a   |         |
| OVERALL        | 44 |           |        |         |

Extraction coverage (the half the offline harness cannot see): <k>/<n> of the
authored rows were produced by the extractor, <m> rows it produced that were
not authored, judged by <METHOD>.
Latency p50/p95 and tokens/query: <...> (Postgres and the embedder are live in
this arm, so both are real numbers here and are absent offline by construction).
Delta vs the offline lower bound: <...>
-->

Offline harness health (NOT a product measurement, and not comparable to the
table above): the suite gates on its own floor — every question in the fixtures
is answerable from rows that are in the store by legs that are running, so a
drop below it means a retrieval leg went dark, never that memory is imperfect.

### Findings the harness produced on its first run (2026-08-26)

Reported by the run, deliberately not gated, and each one evidence rather than a
number:

1. **`staleNote` keys on ROW AGE, not on the date inside the fact.** A plan
   recorded 67 days ago about an event still two months in the FUTURE is handed
   to her pre-hedged as "whatever was ahead in this has already happened"
   (fixture: dyad-b's november `neet pg` exam, recorded in June). Not patched
   here: the predicate is WS-RECALL's, changing it moves what every existing
   turn recalls, and "the row is old" is a useful signal a better rule would
   keep. **This is direct evidence for ROADMAP-100X item 4 (bi-temporal edges,
   valid-from/valid-to)** — the fix needs the fact's own validity interval,
   which is precisely what that item adds.

   **CLOSED 2026-08-26 by WS-O** (`bitemporal-fact-edges`): migration 056 adds
   `valid_from`/`valid_to`, `staleNote` asks the horizon before it counts days,
   and row age is kept as the fallback for rows with no derivable date. Now
   gated in both directions — `evals/run.mjs recallbench` [A-10] (ahead),
   [A-10b] (the row-age fallback), [B-12b] (this defect stays closed) — and by
   `evals/run.mjs validity`.

   Two further things this defect's fix surfaced, both recorded because they are
   the expensive half:
   - The benchmark's own [A-10] **asserted the defect**. It read "a past-dated
     plan carries the stale hedge" and passed on a December wedding recalled in
     August — the hedge fired, so the assertion was green, and the thing being
     asserted was the bug. A gate can pin the wrong behaviour and would then
     have failed the fix.
   - `timeline.ts`'s `resolveWhen` matched month ABBREVIATIONS INSIDE LONGER
     WORDS (`[a-z]*` after each prefix): married/marks → March,
     decade/decide/declare → December, junior → June, novel → November, janta →
     January. Invisible while its only consumer was `hisClock`'s coarse label;
     load-bearing the moment the same answer became a stored timestamp that
     decides tense. Fixed in the same commit; `evals/run.mjs recallbench`
     [A-14] is the fixture.
2. **A Hinglish question about a game reaches the activity leg and matches
   nothing.** "kya khela tha humne" tokenises to `[khela, humne]`; the activity
   leg word-matches over an ENGLISH body ("chess together on 10 aug — …") and
   the no-query-words fallback does not fire, because there ARE query words.
   Same shape as `forget/a4.mjs`'s cross-lingual referent gap.
3. **Hinglish kinship terms miss English summaries.** "meri behen ka naam kya
   tha" does not match a row whose summary says "younger sister"; the row
   reaches the prompt only through STANDING BACKGROUND. The `bg-only` column in
   the run's table is what makes this countable.

---

## `exdialog-surface` — example-dialogue FORMAT, measured as prompt surface (2026-08-26)

ROADMAP-100X item 5, WS-O. `node evals/run.mjs exdialog`.

**Read the scope line before the numbers.** This is a measurement OF A PROMPT'S
TEXT, not of a model's behaviour. The prompt is a string this repo produces and
can count exactly, so counting it offline is not a proxy for anything — which is
why it belongs here at all, and why `no offline numbers in measurements.md`
(STATE.md) is not violated: that law is about behaviour measured against a mock.
**No recitation rate is measured here and none is claimed.**

Method: three arms compiled through the real `compile()` by wrapping the real
`meeraAgent` (persona.ts untouched — arm A is asserted byte-identical to a
compile with no agent override). Arms matched on situation set (the same six,
in the same order) and byte count (595 vs 815, ratio 1.37), so FORMAT is the
only variable. Corpus for the register columns: n=96 of her turns from
`evals/recallbench`'s three dyads, authored by WS-K for a different suite before
this experiment existed; his 96 turns subtracted, so an n-gram common to both
speakers counts as Hinglish rather than as her.

| arm | format | core B added | emittable spans | liftable ratio | 1-gram | 2-gram | 3-gram | shapelint flags |
|---|---|---|---|---|---|---|---|---|
| A | none (shipping) | 0 | 0 | 0.000 | 0.000 | 0.000 | 0.000 | 0 |
| B | quotable-line | 595 | **6** | **0.405** | 0.063 | 0.018 | 0.000 | 6 |
| C | micro-scene | 815 | **0** | **0.000** | 0.014 | 0.000 | 0.000 | 6 |

- **emittable spans** — contiguous runs that could be sent as a reply with zero
  adaptation (quoted spans, plus shapelint's own sentence-shape rule).
- **liftable ratio** — the fraction of the block's characters inside those spans.
- **1/2/3-gram** — the fraction of the block's word n-grams that are
  characteristic of her turns. The 3-gram column is 0.000 for BOTH arms and
  separates nothing at this corpus size; reported, never asserted.

**The result, stated exactly:** the two formats differ by a factor of ∞ in
emittable spans (6 vs 0) and 4.5× in characteristic vocabulary (1-gram 0.063 vs
0.014) at comparable length over identical content. The micro-scene format
supplies a far smaller surface for recitation to come from.

**What this does NOT establish** (and the run says so in its own output):

1. It is not a recitation rate. A surface is necessary for recitation, not
   sufficient. The decisive arm needs generation and a judge; the protocol and
   the provider seam are `evals/exdialog/run.mjs` §5, which reports
   `judged: false` so a fake can never be read as a measurement.
2. Only ONE arm has a measured rate behind it: arm A, at 0 (n=84), from the
   removal that produced `recited-prompt`. Arm B RECONSTRUCTS the 4-of-5 shape
   from its description — the original text is not in version control.
3. Nothing here measures whether examples TEACH anything. This is the cost side
   of the trade only. A format that recites nothing because it conveys nothing
   would score perfectly here and be worthless.

**ROADMAP-100X item 5 is therefore NOT resolved and no law is written from it.**

### A live gate has a hole, found by this run

`lintLine`'s sentence-shape rule — the repo's mechanised `recited-prompt` guard
— is `/^[A-Z][^.?!]*[.?!]$/`: capital start, terminal punctuation. Every line
she actually says is lowercase romanised Hinglish with no full stop. **It
flagged 0 of 6 quotable-arm rows** (the quote-span detector caught 6 of 6). A
phrase bank written in her own voice — the only kind anyone would write — passes
shapelint clean. Not patched: shapelint runs over TAIL content rows, where a
quoted span is legitimately a person's own words ("their own words for it" is a
live feature of `api/memory.js`'s fact renderer), so a quote-delimiter rule
would fire on the wrong file. Filed as `shapelint-blind-to-hinglish-quotes`.

---

## `surface-switch-recall` — 89.2% of recall is lost when a person changes surface (2026-08-26)

WS-O. `node evals/run.mjs recallbench` §3c. Offline harness (the same one WS-K
built, with the DB mocked at `api/_db.js`'s module boundary), so this is a
LOWER-BOUND structural number and not a live product measurement — the same
scope caveat the rest of that suite carries, restated in its own §0.

Method: the 44 scorable questions across the three authored dyads, over the
identical fixture rows, through the real `opRecall`. The ONLY variable is the
`device_id` bound into the legacy-lane statements — the mock resolves either
device to the same person, exactly as `vy_surface_identity` does for one human
on two surfaces. The pre-fix arm is produced by making the new leg's statements
THROW, which is what a SQL error would do and what `api/memory.js`'s `.catch`
turns into a dropped contribution — so it is a negative control, not a second
copy of the code.

| arm | same device | after a surface switch | loss |
|---|---|---|---|
| surface-switch leg OFF (pre-fix) | 0.841 | 0.091 | **89.2%** |
| surface-switch leg ON | 0.841 | 0.727 | 13.5% |

**Why.** `api/_surface.js`'s own header states the law — "memory is never keyed
by surface. Anything that keys memory by surface reintroduces the amnesia the
relational layer exists to delete." Identity obeys it (`vy_surface_identity` has
no surface in its key and must never gain an `agent_id`). Retrieval did not:
`_room.js`'s `bindSurfaceDmDevice` mints a device per surface, and opRecall's
two largest legs (STANDING BACKGROUND and the keyword MATCH) plus `meera_edges`
and the neighbour-name resolution all read `where device_id = $1`. The vy_ store
— facts, activities, watch moments, the rel and self bundles — is person-keyed
and followed the person. Half the memory travelled and half did not, silently,
with a 200 on every call.

**The residual 13.5% is named, not rounded away.** `meera_edges` is still
device-keyed and the leg imports no relations, so a multi-hop question answered
through an edge at home is answered without it after a switch; and the leg is
capped at 6 rows where the two home legs together return up to 14. Both caps are
deliberate (see `context/decisions.md#surface-switch-recall-leg`).

**This number is not the same kind as a live one**, and the difference matters
for exactly one reason: the mock proves control flow, not SQL types
(`offline-mocks-cannot-type-check-sql`). The leg's two statements have never run
against Postgres. Its failure mode is designed for that: both reads are atomic
and any error drops the whole contribution, so an untyped-parameter error costs
the feature and not the recall. [SS-4] and [SS-5] assert exactly that — home
recall is bit-for-bit unchanged whether the leg works or dies.
## `ws-r-statement-shape-and-coverage` — three unexecutable statements, four uncovered tables (2026-08-26)

**Method.** `EXPLAIN (verbose, costs off)` of each statement's exact template
literal, extracted from the source file and sent over Neon's SQL-over-HTTP
endpoint with dummy parameters. EXPLAIN plans without executing, so no row was
written. Manifest figures from `information_schema.columns` and `pg_constraint`
on the live database (migrations 015–055 applied, 112 tables).

| statement | before | after |
|---|---|---|
| `_replica-full-erasure.js:219` completeReplicaErasure | 0A000 FOR UPDATE cannot be applied to the nullable side of an outer join | plans clean, 421 plan rows |
| `_replica-source-erasure.js:99` completeSourceErasure | 0A000 WITH query "identity_challenge_sources" does not have a RETURNING clause | plans clean, 326 plan rows |
| `_replica-voice-delivery-policy.js:344` issueOwnedVoiceDeliveryHoldout | 0A000 WITH query "expired" does not have a RETURNING clause | plans clean, 102 plan rows |

n = 3 statements, each EXPLAINed once before and once after. All three were
UNEXECUTABLE, not merely wrong on some inputs: the error is raised at parse
time, so the true prior success rate of each is 0 calls out of every call ever
made.

**Static gate.** `evals/sqlcast/stmt.mjs` rules C and D over every SQL template
literal under `api/`: 3 defects on the pre-fix tree (exactly the three above,
no false positives), 0 on the fixed tree, 458 statements scanned. Controls: 4
negative caught, 6 positive clean.

**Manifest coverage** (`scripts/relcheck.mjs`, live):

| | before | after |
|---|---|---|
| owning columns enumerated | 3 | 9 |
| tables with an owning column seen | 61 | 89 |
| person-keyed tables absent from PERSON_TABLES | 3 reported (4 real) | 0 |
| owner-keyed tables unreachable by the erasure job | not checked | 0 (was 3) |
| relcheck verdict | FAIL | green, 27 checks, 1.4 s |
| verify-release checks with NEON_URL in env | 11 (db gates SKIPPED) | 13 |

The fourth missing table (`vy_replica_runtime_capability`) was invisible to
relcheck itself until the column list widened — it is keyed
`subject_person_id`. The three unreachable owner-keyed tables
(`vy_channel_watch`, `vy_clone_channel`, `vy_ingest_run`) were found by walking
`pg_constraint` for ON DELETE CASCADE paths rooted at `vy_replica`: 44 of 48
owner-keyed tables fall out of `delete from vy_replica` by cascade, 4 are named
explicitly, and before this change only 1 of those 4 was.

**Live forget/export probe.** n = 1 synthetic person (`0000…0003xx`) with one
real row in each of the four added tables, built through the full FK chain
(person → device → account bridge → agent → replica → genome → profile → voice
profile → capability → session → log → dialogue turn). The REAL exported
helpers were called, never a copy: `activePersonTables` + `keysOf` for the
export loop, `wipeWhereSql` + `wipeParams` for the forget loop. All 4 returned
by export; all 4 deleted to zero by forget; zero probe rows left in any table
in the `0000…0003xx` range afterwards.
## `first-real-clone` — the first fidelity number about a real person (2026-08-26, WS-T)

**Scope line first.** Every number here is a live-service response seen in this
run. The fidelity figure is ECAPA-TDNN speaker-embedding cosine similarity and
nothing else: it is the FIRST of the automated gates `api/_fidelity.js` names,
not the blind ABX bench in `docs/gurukul/research/voice-stack.md`, and it
licenses no claim about how the clone SOUNDS. The clone is ZERO-SHOT — no
per-speaker fine-tune exists — so this is a floor for this voice, not a ceiling.

**Subject.** The owner's own WhatsApp voice note, supplied by them in session
with explicit consent to build their clone. 71.0 s, converted with ffmpeg to
24 kHz mono PCM16 (no resampling of content, container only). Measured by
`probeEnrollmentWav`: rms 0.0370, peak 0.490, 0 clipping, 60.7% active. Spoken
Hinglish, one speaker.

**Method.** `node scripts/first-clone.mjs owner-voice.wav "Raghav"` against the
live services. Reference split into 4 x 17.75 s windows -> `voice-evidence`
`voice_quality` -> 4 ECAPA vectors. Four Hinglish lines synthesised zero-shot by
the deployed Chatterbox runtime conditioned on the whole 71 s reference -> 4
clips -> the same evidence call -> 4 ECAPA vectors. `fidelityScore` +
`fidelityVerdict` at stock `DEFAULT_FIDELITY_POLICY`.

### Fidelity

| measure | mean | p10 | worst | windows | refs |
|---|---|---|---|---|---|
| **clone vs owner (ECAPA, 192-d)** | **0.7753** | 0.7479 | 0.7479 | 4 | 4 |
| owner vs owner, different windows of the same recording — **the ceiling** | 0.8869 | 0.8795 | 0.8795 | 2 | 2 |
| clone vs owner, x-vector second opinion (512-d) | 0.9974 | 0.9972 | 0.9972 | 4 | 4 |

Verdict **warn** (`below_warn_band`): above the 0.70 activation floor, below the
0.78 warn band, headroom +0.0753. It would activate, with a drift warning.

n = 2 independent end-to-end runs, 25 minutes apart, different synthesis
requests: mean 0.775276 and 0.775275. The spread is 1e-6, so the number is
reproducible to six decimal places across runs and the clone is 87.4% of the
ceiling this scale reaches on the subject's own voice.

**The x-vector row is a finding, not a second opinion.** Raw cosine over
`speechbrain-xvector-voxceleb` returns 0.997 between a clone and its reference,
which is not a similarity measurement — x-vectors need PLDA scoring to
discriminate and a bare dot product over them saturates. `api/_fidelity.js`
already scores ECAPA only and says the agreement rate is unmeasured; it is now
measured once, and the answer is that the second family cannot be used this way.

### voice-evidence — the round trip that had never run

| call | audio in | embeddings out | latency |
|---|---|---|---|
| reference, 4 windows | 71.0 s | 8 (2 families x 4) | **4 977 ms** |
| candidate, 4 clips | 45.2 s | 8 | **3 956 ms** |

Per-window signal quality came back too: usable speech 11.2–13.8 s per 17.75 s
window, SNR 8.5–27.4 dB (one genuinely noisy window), rms −26 to −31 dBFS.

**Cold start from zero replicas: 176 s** to the first 200 on `/healthz`
(n = 1, 5 s poll granularity, so ready at or before 176 s). Compare
`open-voice-runtime`'s 161 s. A second wake in the same session measured 194 s.

### The clone runtime, on a real reference

| call | rtf | note |
|---|---|---|
| first on a fresh replica | 1.77 | CUDA autotune, matches WS-L's 1.83 |
| warm (n = 3) | 0.79–0.80 | 12 680 / 11 240 / 10 320 ms of audio |

`perth_watermark_verified: true`, `perth_score: 1.0` on every clip. A 71 s
conditioning reference is accepted as-is — no trim was needed under the
runtime's 5–90 s cap.

### ASR — Sarvam, both paths

| path | model | audio | result |
|---|---|---|---|
| sync `POST /speech-to-text` | `saarika:v2.5` | 25 s trim | **200 in 4 134 ms** |
| sync | `saarika:v2.5` | full 71 s | **400** — "Audio duration exceeds the maximum limit of 30 seconds" |
| batch, through the real provider | `saaras:v3` | 71 s | **Completed, 5 diarized turns, 136 874 ms** |
| batch, same bytes again | `saaras:v3` | 71 s | 12 024 ms — Sarvam returns a cached result keyed on `audio_hash` |

The batch job carries second-resolution timings and one speaker id for all five
turns, which is the correct answer for a single-speaker recording.

### Sheet draft

125 tokens over 5 turns -> 0 drafted fields, **92 real gaps**: 32
`needs-template`, 24 `needs-qualitative-pass`, 16 `needs-teacher-input`, 12
`measured-needs-canonical-bullet`, 3 `platform-assigned`, 3 `platform-floor`,
2 `needs-teacher-confirmation`. 8 phrase-bank candidates, unverified (no
held-out half). Code-switch token ratio **0.000** on an obviously bilingual
transcript — see `romanised-lexicon-meets-devanagari-asr`.

### End to end

643.6 s wall clock for the whole chain including two cold starts; 8 of 9 stages
green. The one failure is `finalize`, and it is a deployment lag, not a defect
that survives: see `supabase-object-info-is-not-json`.

### Spend

This is an ESTIMATE from measured wall-clock windows, not a billing read — the
subscription's cost API was not queried, and Container Apps bills replica
uptime including the idle window before scale-down, which is inferred rather
than observed. Rates from `AZURE-DEPLOY-STATE.md` §9 (~$0.53–0.60/hr per T4
app, Central India list).

| thing | measured active window | estimated |
|---|---|---|
| `vyakti-open-voice` (T4) | ~29 min across 2 wakes | ~$0.28 |
| `vyakti-voice-evidence` (T4) | ~33 min across 3 wakes | ~$0.31 |
| `vyakti-open-voice-admission` (CPU) | same windows, ~$0.01/hr | <$0.01 |
| Sarvam | ~3.9 min of audio over 5 calls; at the higher of the two conflicting published rates (Rs 90/hr) | ~$0.07 |
| Neon / Supabase / Vercel | within existing plans, nothing metered above noise | ~$0 |

**Total ~$0.66**, against a ~$2 ceiling. Cold starts dominate as WS-L predicted:
three of the six GPU wakes were pure warm-up and produced no output at all, and
they are roughly a third of the bill.

Every app was confirmed back at `minReplicas: 0` with internal ingress after the
run, so the standing cost returns to the ACR Basic fee.

### The ingress scaffold, stated so it is not mistaken for architecture

`voice-evidence` is deployed with **internal** ingress and Vercel is not inside
its Container Apps environment (`AZURE-DEPLOY-STATE.md` §12, still open). To run
the round trip at all, WS-T flipped its ingress to external, ran, and flipped it
back — confirmed `external: false` afterwards, and every app confirmed at
`minReplicas: 0`. The service authenticates every `/v1/analyze` call itself, so
this was never an authorisation hole; `/healthz` is unauthenticated, so it WAS a
cost surface for the duration. This is a measurement scaffold. It is not an
answer to §12, and the numbers above do not depend on which answer is chosen.

## `first-real-clone` — the owner's voice, end to end (2026-08-26, WS-T)

n=1 subject (the owner), 71.0 s consented Hinglish reference, 24 kHz mono
PCM16; every figure a live-service response.

| metric | value | method |
|---|---|---|
| ECAPA fidelity, zero-shot clone vs own reference | **0.7753** (p10 0.7479, worst-window 0.7479) | 8 reference + 8 candidate embeddings via deployed `voice-evidence`; n=2 runs, spread 1e-6 |
| self-vs-self ceiling (same audio both sides) | **0.8869** | same path, identical input — the practical ceiling of this metric on this stack |
| verdict at provisional policy | `warn` → activation refused | `api/_fidelity.js`; 12 blockers incl. `voice_fidelity_not_qualified` |
| voice-evidence round trip (warm) | 4 977 ms for 71 s / 4 windows / 8 embeddings | first ever run of this service |
| voice-evidence cold start | 176 s to ready from zero replicas | |
| Chatterbox synthesis | rtf 0.79–0.80 warm; 1.77 first-on-replica | 4 clips, 45.2 s total, PerTh watermark verified on all |
| Sarvam sync ASR | 4 134 ms for 25 s; **hard 30 s cap** | `saarika:v2.5` (`saarika:v2` deprecated) |
| Sarvam batch ASR | 137 s for 71 s → 5 diarized turns | `saaras:v3` |
| sheet draft from real transcript | 5 turns, 127 tokens, 92 gaps, 8 phrase candidates | `transcriptStats` + `sheetDraft` |
| spend | ~$0.66 (~29 min open-voice + ~33 min voice-evidence T4, + ~$0.07 Sarvam) | wall-clock estimate, not a billing read |

**What this licenses and what it does not.** It licenses: the pipeline works
on a real human. It does NOT license any claim about how the clone sounds —
speaker-embedding similarity is not perceptual quality, and our own
`azure-tts` rejection is the standing evidence that the two diverge. The
blind ABX bench in `docs/gurukul/research/voice-stack.md` is what settles
that. The number is also ZERO-SHOT: no per-speaker fine-tune has run, so
0.7753 is the floor this stack reaches with no training at all.

## `voice-panel-admission-probe` — the wake path, against the live broker (2026-08-26, WS-W)

**Scope line, stated before the numbers: this is the UNAUTHENTICATED front-door
probe only.** It measures `probeAdmissionHealth`'s round trip to the public
admission broker. It is **not** an end-to-end synthesis, it says nothing about
the GPU runtime's state, and no clip was generated — `AZURE_OPEN_VOICE_ORIGIN`
and `OPEN_VOICE_HMAC_SECRET` are both absent from this environment, so the
signed half of the lane has never run from this code.

Method: `GET {broker}/healthz`, from the build sandbox, 2026-08-26. Endpoint
from `AZURE-DEPLOY-STATE.md` §2 (an endpoint, not a secret).

| probe | n | result |
|---|---|---|
| `curl` first contact | 1 | **200 in 1 034 ms** |
| `probeAdmissionHealth()`, immediately after | 3 | **200 in 250 / 253 / 334 ms**, 1 attempt each |

Consistent with WS-L's measured **0.8 s warm** and materially under their
measured **21.8 s cold-from-zero**, so the broker was already awake and **no
cold start was observed here**. The 21.8 s figure remains the one to plan
against; `WARMUP.healthBudgetMs` is 45 s for exactly that reason, and sits
under the broker's own 60 s skew window so that whatever is signed afterwards
is signed against a broker proven awake.

**Not measured, and needing the live deployment:** the panel's warm round trip,
its cold-start wall clock, and whether the 12 s flush window is long enough for
the platform to have begun scheduling the GPU replica. That last one is the
assumption the design rests on and it is untested.
## `lora-vs-zero-shot-71s` — the first fine-tuned-vs-zero-shot delta on this stack (2026-08-26, WS-U)

**Scope line first.** This is ECAPA-TDNN speaker-embedding cosine similarity and
nothing else — the first automated gate `api/_fidelity.js` names, not the blind
ABX bench in `docs/gurukul/research/voice-stack.md`. It licenses no claim about
how anything SOUNDS. It is also a **71-second smoke test**: the Chatterbox
community recommendation is **≥30 minutes** of clean single-speaker audio
(`voice-stack.md` §2), and this had 62.1 s of transcribed speech. It was run
anyway, deliberately, because a real number with its scope stated beats a plan.
Treat it as evidence that the lane WORKS and that the direction is positive, not
as the production-grade figure.

**Subject.** The same 71.0 s consented Hinglish voice note as `first-real-clone`
(the owner's own voice, own consent), sha256
`c242261b9caa779eb6ddeeda24623c11c2aec01f8f7acafe47970bc17a1cb9b6`, canonical
24 kHz mono PCM16.

**Training.** `services/voice-finetune` on an Azure Container Apps **GPU job**
(`Consumption-GPU-NC8as-T4`, Tesla T4), image derived from the deployed runtime
image digest. LoRA r=16, alpha=32, lr 1e-4 cosine with warmup, AdamW,
`text_loss_weight` 0.1, seed 12345, batch size 1. Targets: the 120 `q/k/v/o_proj`
projections of the T3 backbone — **3 932 160 trainable parameters of
539 921 408 (0.728%)**. Corpus: the 5 diarized Sarvam `saaras:v3` turns from
`first-real-clone`, 62.1 s of the 71.0 s, 29–230 text tokens and 67–590 speech
tokens each. **140.4 s of T4 wall clock for all 60 epochs (300 steps).**
Mean speech cross-entropy **5.046 → 1.651**; text CE 2.372 → 1.145.

**Measurement.** Identical protocol to `scripts/first-clone.mjs`, so the numbers
are directly comparable to `first-real-clone`: the same 4 x 17.75 s reference
windows, the same four Hinglish lines, the same seeds 31000–31003, the same
`exaggeration 0.45 / cfg 0.5 / temperature 0.8`, the same live `voice-evidence`
call, the same `fidelityScore`. **The zero-shot control was re-run in the same
session** rather than compared against the stored number — otherwise the day,
the image and the service wake would all sit inside the delta.

### The delta

| arm | mean | p10 / worst | verdict | delta vs zero-shot | share of the gap to the ceiling |
|---|---|---|---|---|---|
| zero-shot (control, re-run today) | **0.775278** | 0.747865 | `warn` | — | — |
| LoRA, 15 epochs | 0.783134 | 0.769145 | `pass` | **+0.0079** | 7.0% |
| LoRA, 30 epochs | 0.791674 | 0.768346 | `pass` | **+0.0164** | 14.7% |
| **LoRA, 60 epochs** | **0.795857** | 0.759275 | `pass` | **+0.0206** | **18.4%** |
| owner vs owner — the ceiling | 0.886850 | 0.879505 | — | — | 100% |

n = 2 independent end-to-end runs per arm, ~25 minutes apart, different
synthesis requests. Spread across runs: zero-shot 6e-6, e15 3e-6, e30 4e-6,
e60 1e-6. **The control reproduced `first-real-clone`'s 0.775276 to 2e-6** on a
different day, a different runtime image and a different revision — which is the
evidence that these two entries are on the same scale and may be compared.

**A 71-second per-speaker LoRA closes 18.4% of the zero-shot-to-ceiling gap and
moves the verdict from `warn` to `pass`,** across the 0.78 warn band. It gets
nowhere near the 0.85 `target`.

### Three things the table does not say

1. **The worst window gets worse while the mean gets better.** p10 peaks at
   e15 (0.7691) and falls by e60 (0.7593) even as the mean rises monotonically.
   More training tightened the average and widened the spread. Any decision
   about how long to train has to look at p10, and 60 epochs is not obviously
   the right stopping point on this evidence.
2. **The adapter costs ~26% of synthesis speed.** Warm real-time factor moved
   from **0.79 zero-shot to 0.99–1.01 adapted** — from comfortably faster than
   real time to roughly real time. That is a per-utterance latency cost on every
   adapted call, and it is a cost the zero-shot lane does not pay.
3. **The e15 and e30 points are not "a completed 15-epoch run".** All three
   checkpoints come from ONE 60-epoch cosine schedule, so the earlier two were
   taken mid-anneal at lr 8.8e-5 and 5.2e-5. They describe the curve of this
   run, not three independently-tuned runs.

### Scope, stated plainly

- **n = 1 speaker.** Everything here is one voice, and it is the owner's.
- The transcript is Sarvam `saaras:v3` output, which returns **Devanagari for
  the English half** of this bilingual speech
  (`romanised-lexicon-meets-devanagari-asr`). The fine-tune therefore learned
  Hinglish written in one script throughout. Whether that helps or hurts is
  unmeasured.
- **No held-out set exists.** Five segments is too few to hold one out and still
  train, so the loss curve above is training loss and says nothing about
  generalisation. The fidelity numbers are the only out-of-sample evidence here:
  the four measured lines are not in the training corpus.
- Nothing was benched against ElevenLabs, and no ABX ran.

Artifacts: adapters `4ff8ba5c…` (e15), `e6d4c280…` (e30), `e3b45c67…` (e60),
15 807 634 bytes each; synthesis commitments `81da1cab…`, `57bfc668…`,
`7e448af7…` versus base `b66dbbe2…`. PerTh watermark verified with score 1.0 on
all 32 clips across both runs, adapted and not.

## `reference-window-beats-the-finetune` — which 10 s you condition on moves fidelity more than training does (2026-08-26, WS-U)

**Scope line first.** Same ECAPA-cosine gate, same caveats, same subject and
protocol as `lora-vs-zero-shot-71s`. Every arm here is **ZERO-SHOT** — no
adapter — so this isolates reference-window choice from fine-tuning entirely.

**Why it was run.** Chatterbox does not use all of a long reference the way the
caller might assume. Read at the pinned commit `5de7a54`,
`ChatterboxMultilingualTTS.prepare_conditionals` truncates to
`DEC_COND_LEN = 10 * S3GEN_SR` for the s3gen decoder reference and
`ENC_COND_LEN = 6 * S3_SR` for the T3 conditioning prompt tokens — **the first
10 s and the first 6 s**. Only the voice-encoder speaker embedding sees the
whole input. So passing 71 s is mostly passing its first ten seconds, and WHICH
ten seconds becomes a free parameter nobody had measured.

**Method.** Five zero-shot arms, identical in everything but the conditioning
prompt: the full 71 s, and four 10 s windows starting at 0 s, 25 s, 40 s and
58 s. The reference side of the score is held **fixed** at the same four
17.75 s windows of the whole recording for every arm — scoring each arm against
its own window would move the yardstick and the treatment together. Same four
lines, same seeds 31000–31003, same style, same live `voice-evidence` call.
n = 1 run per arm, on a stack whose reproducibility is established at 1e-5 by
`lora-vs-zero-shot-71s` (and whose full-71 s arm reproduced here to 5e-6 across
a third independent run).

| conditioning reference | mean | p10 | verdict | vs full 71 s |
|---|---|---|---|---|
| **10 s from 25 s** | **0.805756** | 0.784009 | `pass` | **+0.0305** |
| 10 s from 0 s (what truncation gives you anyway) | 0.782513 | 0.771050 | `pass` | +0.0072 |
| full 71 s | 0.775273 | 0.747858 | `warn` | — |
| 10 s from 40 s | 0.769987 | 0.745895 | `warn` | −0.0053 |
| 10 s from 58 s | 0.743313 | 0.734999 | `warn` | −0.0320 |
| owner vs owner — the ceiling | 0.886850 | 0.879505 | — | +0.1116 |

### What this says

**Window choice spans 0.0625 on this voice — three times the +0.0206 that
60 epochs of LoRA bought, at zero training cost and zero inference cost.** The
best single 10 s window (0.8058) scores **higher than the best fine-tuned arm**
(0.7959, `lora-vs-zero-shot-71s`), and it does so on the untouched base model.

Two further readings:

- **Handing the model more audio made it worse than handing it the right ten
  seconds.** The full 71 s arm scores *below* both the 0 s and 25 s windows.
  "Give it everything" is not a strategy; it is an unexamined default that
  happens to land on whatever the first ten seconds contain.
- **A bad window is a real risk, not a theoretical one.** The 58 s window loses
  0.0320 and stays in `warn`. Two of four windows scored below the full
  reference. So this is a lever that cuts both ways, and picking windows *at
  random* would be worse than picking none.

### What this does NOT say

- **The interaction with fine-tuning is unmeasured.** Every arm here is
  zero-shot. Whether the adapter adds to, overlaps with, or fights the good
  window is exactly the next experiment and was not run.
- **n = 1 speaker, and the windows were chosen by clock position, not by any
  signal.** Nothing here identifies WHAT makes 25–35 s better — SNR, phonetic
  coverage, pitch range, absence of laughter — so there is no selection *rule*
  yet, only evidence that one would be worth having. The evidence service
  already returns per-window SNR and usable-speech; whether either predicts
  this ranking is untested.
- Still speaker-embedding cosine, still no ABX, still says nothing about how
  any of these sound.

---

## youtube-extraction-blocked-from-azure

**Date:** 2026-08-26. **Who:** WS-AD. **Cost:** ~$0.05 (one ACR build, a few
minutes of 1-vCPU Container Apps uptime, two short diagnostic job runs).

**The question this answers is the one the whole channel lane was waiting on:
does our YouTube extraction work from Azure at all?** `docs/gurukul/youtube-
extraction-posture.md` §3 predicted it would not and said so in writing
("Nothing here is measured… the first live attempt from an Azure egress has a
material chance of returning `channel_extract_extractor_bot_check`"). It is now
measured. The prediction was right, and one half of the lane works anyway.

### What was deployed

`services/media-extract` built by ACR Task from the WS-AD worktree tarball
(**87 s**, digest `sha256:b5e23f0b…`) and deployed as container app
`vyakti-media-extract` into the existing `vyakti-voice-env`: Consumption (CPU)
profile, 1 vCPU / 2 GiB, external ingress behind its own HMAC admission,
`minReplicas: 0`. Startup/Readiness/Liveness probes all three, per WS-L's §6 —
readiness alone crash-loops. Upload host pinned to
`vyaktivoicewsu.blob.core.windows.net`.

| probe | result |
|---|---|
| `GET /healthz`, cold from zero replicas | **200 in 47.9 s** — yt-dlp `2026.08.19` |
| `POST /v1/enumerate`, signed, real channel | **200 in 13.9 s**, 5 real video ids with durations |
| `POST /v1/extract`, signed, real video | **502 `extractor_bot_check` in 2.4–3.4 s** |

### The lever sweep

Method: a Container Apps **Job** on the same image in the same managed
environment, so its egress is the production egress, with `yt-dlp` run directly
and its stderr read out of Log Analytics — the service returns opaque codes by
design, so this is the only way to see the real message. Egress IP observed:
**20.207.113.242** (Azure Central India). One video (`Q5_BtWc-G7Y`, NASA — US
Government work, public domain, chosen for the cleanest possible consent
posture on a research smoke test).

**n = 10 player clients × 1 video, one job execution, all ten identical:**

```
default, android, android_vr, ios, tv, tv_simply, mweb,
web_embedded, web_safari, visionos
  → ERROR: [youtube] Sign in to confirm you're not a bot.
```

**Flat-playlist enumeration from the same job, same second: SUCCEEDED** — three
real video ids returned. The channel-listing path does not go through the
player API and is not blocked.

### The control that makes the sweep trustworthy

The first sweep of four clients was **invalid and reported a false result**. A
`PATCH` to a container app returns `provisioningState: Succeeded` before the new
revision carries traffic, so four "lever" measurements were taken against the
old revision. Caught by a negative control — setting `MEDIA_EXTRACT_PROXY` to a
dead address (`http://127.0.0.1:9`) and asserting the error CHANGES. It did not,
which is impossible if the lever were reaching yt-dlp. After waiting on
`runningState: Running` **and** `trafficWeight: 100`, the same control returned
`extractor_failed` instead of `extractor_bot_check` — a different code — and
only then were lever results recorded. See
`rejected.md#provisioning-succeeded-is-not-serving`.

### A local control, for comparison

The same yt-dlp version from this sandbox's (also datacenter) egress:
metadata succeeded for the first two requests, then bot-checked; with
`player_client=android` metadata came back but the media fetch **403**ed. So the
failure is graded by IP reputation, and Azure Central India sits at the harsh
end: it is refused at metadata, before a stream URL is ever issued.

### What this does and does not settle

- **Settled:** lever 1 (player-clients) does not work from this egress. n=10, all
  clients yt-dlp 2026.08.19 offers.
- **Settled:** the back-catalogue enumeration lane WORKS from Azure today. That
  is a live capability nobody had verified before.
- **NOT tried:** lever 2 (cookies) and lever 3 (proxy). Both need credentials
  this session does not have — a YouTube account cookie jar, or a residential
  proxy subscription. Neither was guessed at. Note the posture doc's own source
  warns that cookies used from a datacenter IP tend to get the ACCOUNT banned,
  so lever 2 is a decision with a cost attached, not a config change.
- **NOT measured:** whether the media fetch would succeed if metadata did. From
  Azure we never got far enough to find out; the local control says the stream
  URL 403s there, which is weak evidence it would also need work.

## media-extract-cost-per-video

**Date:** 2026-08-26. **Who:** WS-AD. **Method:** wall clock on live service
responses, Central India list prices.

Per-video CPU cost of the extraction step, at the measured rates:

| stage | measured | est. cost |
|---|---|---|
| cold start (`/healthz` from 0 replicas) | **47.9 s** of 1-vCPU/2 GiB | ~$0.0006 |
| `/v1/enumerate`, warm | **13.9 s** | ~$0.0002 |
| `/v1/extract`, refused at bot check | **2.4–3.4 s** | ~$0.00004 |
| ACR Task build of the image | **87 s** on a 2-vCPU agent | ~$0.003 (one-off) |

**A successful 15-minute extraction has never run, so its cost is UNMEASURED.**
The honest bound is that extraction is dominated by download plus an ffmpeg
transcode of ~15 min of audio on 1 vCPU, and neither has been observed. What
IS established: the CPU lane is roughly three orders of magnitude cheaper than
the GPU lane (`AZURE-DEPLOY-STATE.md` §9: ~$0.53–0.60/hr of T4), so extraction
is not where this product's money goes — cold starts on the GPU side still are.

Total WS-AD spend: **~$0.05**, against the session's smoke-test allowance.
## `ink-faint-fails-aa` — the studio's caption grey is below WCAG AA on both grounds (2026-08-26, WS-AG)

**Method.** WCAG 2.x relative-luminance contrast ratio, computed on the exact
hex values in `docs/gurukul/DESIGN-SYSTEM.md` §4.1. n/a (deterministic, not
sampled); reproducible from the two ground colours and the foreground.

| foreground | on `--paper` #f4f1e9 | on `--panel` #fffef9 | AA (4.5:1, text under 18px) |
|---|---|---|---|
| `--ink-faint` #7a7e74 (shipped) | **3.67:1** | **4.11:1** | fails both |
| `--ink-faint` #676b62 (proposed) | 4.82:1 | 5.39:1 | passes both |
| `--ink-soft` #52564e | 6.65:1 | 7.43:1 | passes |
| `--forest` #17493b | 9.06:1 | 10.13:1 | passes |
| `--panel` on `--forest` (the CTA) | n/a | 10.13:1 | passes |

`--ink-faint` is used for captions, metadata and help text at 11px to 13px, so
every one of those uses is a real AA failure and not a borderline one. Fixed in
`site/vyakti.html` in this pass; `studio.css` owns the token and is queued as
`UX-Q-AG-02` in `docs/gurukul/UX-QUEUE.md`.

## `copy-law-violations-before-after` — what the widened gate found (2026-08-26, WS-AG)

**Method.** `node scripts/check-copy.mjs` on `gurukul-ws-ag`, before and after
the fix pass. Scope: `src/studio/`, `src/gurukul/`, `src/replica/`, `site/`
(full rule set) and `src/components/` (dash only, unchanged). n = every `.ts`,
`.tsx` and `.html` file in those trees.

| | before | after |
|---|---|---|
| total | 120 | 3 (all waived, all in `StudioApp.tsx`) |
| em-dash / en-dash | 113 | 3 |
| numbered eyebrow (`06 · x`) | 6 | 0 |
| codename `Meera` in teacher copy | 1 | 0 |

Largest single files: `TeacherSheetStudio.tsx` 17, `ContextLockerPanel.tsx` 15,
`QuickStartPath.tsx` 13, `mirrorCallMachine.ts` 12, `errorCopy.ts` 12,
`ChannelsStudio.tsx` 11. `site/` carried ZERO dashes before the pass, because
the old gate already covered it; the entire 113 were in the half nothing
scanned, which is the measurement that matters here.

The one codename leak was `RuntimeGate.tsx:112`, "There is no fallback to
Meera, another cloud voice, or device TTS" — the other product named on a
teacher-facing screen, exactly the recurring offender DESIGN-LAW §1 predicted.

## `wizard-input-space-6912` — the rail's status logic, exhausted (2026-08-26, WS-AE)

**n = 6 912.** The full cross product of `WizardInput`'s ten fields at their
boundary values: stopped (2) x source consent (2) x source count {0, 2} x
context items {null, 0, 3} x identity (2) x liveness (2) x sheet saved (2) x
mode (2) x runtime {null, idle, one-owner-blocker, two-platform-blockers,
qualification-only, active} x channels {null, 0, 3}.

**Method.** `evals/studiowizard.mjs` bundles the real
`src/studio/wizardModel.ts` with esbuild on every run (no frozen copy) and calls
`computeWizard` on each input, asserting four properties over the whole space.
Offline, deterministic, $0, no DB, no browser, about 2 s. Runs inside
`node scripts/verify-release.mjs` as suite `studiowizard`.

**Result.** 0 inputs light more than one ember. 0 inputs disagree between
`emberStep` and the rendered waiting row. 0 inputs put an ember on a step with
nothing to act on. 0 inputs ask a revoked workspace's owner for anything.
0 inputs report a step `done` while it still lists something missing. 0 inputs
complete Deploy without a runtime answer.

**What the number is for.** It is a floor to compare against, not a boast. If a
future change adds a field to `WizardInput`, the space grows and the same six
counts must stay at zero; a non-zero count names which property broke.

**What it does not measure.** Whether the three steps are the right three, or
whether an owner can find anything. This is a property suite over a state
machine, not a usability result, and no usability result exists for this
surface yet.

## `studio-dash-purge-95` — the copy law, applied to the studio (2026-08-26, WS-AE)

**n = 95 offending lines**, across 15 files in `src/studio/`, measured by
applying `scripts/check-copy.mjs`'s own extraction (block comments blanked, line
comments stripped, `emdash-ok:` exempted) to that directory before the purge.

WS-AA's audit had counted **73**; the higher number is not a disagreement. It
covers en-dashes as well as em-dashes (`DESIGN-LAW.md` §1 bans both, and
`30–90 sec` was in `VoiceEnrollmentLab.tsx`), and it counts LINES rather than
occurrences, and `src/studio/` had grown by two workstreams between the audit
and the purge.

**After: 0**, plus 6 `—` empty-value placeholders rewritten as escapes so
they are unambiguously data rather than prose. Two numbered eyebrows in
`VoiceEnrollmentLab.tsx` and one internal codename in `StudioApp.tsx`'s sign-in
copy were found by the widened gate in the same pass.

**Method note worth keeping.** The gate's own `emdash-ok:` exemptions live in
line comments, so a refactor that strips comments before testing for the marker
silently deletes every exemption in the repo. That regression was written and
caught in the same hour, by `src/components/Chat.tsx`'s legitimate brain-facing
placeholder, which is the only reason it is recorded here.

## `owner-upload-stuck-and-drained` (2026-08-26, WS-AH)

**The stuck state, measured on production Neon (project `lucky-sun-80291432`,
branch `br-falling-pond-avofhmfy`), n=1 because n=1 is the entire table.**

`select ... from vy_replica_processing_job` returned exactly one row:
`step=integrity`, `state=queued`, `revision=1`, `attempt=0`,
`lease_expires_at=null`, `failure_code=''`,
`created_at=2026-08-26T15:28:50.082Z`, unchanged at `updated_at`. Its source
`886cc5dc` is `kind=audio`, `state=quarantined`, `mime=audio/mpeg`,
`byte_size=32908934`, `duration_ms=null`, `storage_bucket=vyakti-replica-private`.
`attempt=0` with a null lease is the proof of the defect: not a job that failed,
a job nothing ever picked up, ~2.6 hours after it was enqueued.

**The drain, measured on a copy-on-write Neon branch of that exact row
(`br-round-frost-avv3g04c`, created from the default branch so the row is the
real one), n=1, method: `runProcessingSweep({db: q, maxJobs: 3})` driven by
`node` against the branch over `api/_db.js`.**

Transitions actually observed:

| stage | source.state | job.state | attempt | failure_code |
|---|---|---|---|---|
| before | quarantined | queued | 0 | `''` |
| after sweep | quarantined | failed | 1 | `private_storage_not_configured` |

`vy_replica_processing_attempt` gained exactly one row,
`attempt=1, outcome=failed, failure_code=private_storage_not_configured`. The
sweep reported `processed: 1` then `idle` on its second lease attempt, so the
bound and the drain both behaved. The queue drains; this is the first time a job
in this table has ever been leased.

**Where it stopped and why.** At `integrity`, the FIRST step, on
`private_storage_not_configured`. This is an artefact of the verification
environment, not of the pipeline: this container's `api/_config.js` is the
CI-generated stub with every value empty, so there is no `SUPABASE_URL` or
`SUPABASE_SERVICE_ROLE_KEY` and nothing can read the bytes. Deployed on Vercel,
where those two are set, `integrity` is live and the predicted stop moves to
`malware_scan` with `malware_scanner_unavailable`, because a serverless runtime
has no `clamdscan`. That prediction is NOT measured and is not claimed as such.

**The recovery, same branch, same row, n=1.**

| step | requeued | job.state | attempt | failure_code |
|---|---|---|---|---|
| requeue, nothing live | 0 | failed | 1 | `private_storage_not_configured` |
| requeue, integrity live | 1 | queued | 0 | `''` |
| requeue vs `integrity_mismatch`, everything live | 0 | failed | 0 | `integrity_mismatch` |

The fence holds in both directions on the real row: a capability absence comes
back when the capability lands, and a genuine failure is never requeued even
with every step live.

**Not done.** Production was NOT drained. With no storage credentials in this
environment, draining it would have written
`failed/private_storage_not_configured` onto the owner's only job, which is a
worse state than the one the deployed sweep will produce on its first tick.

## po-token-helps-until-the-ip-is-burned

**Date:** 2026-08-26. **Who:** WS-AI. **Cost:** $0 (no paid credential, no cloud
resource; a sandbox container, a pip install and a `npm install` of an MIT
plugin).

**The question:** `rejected.md#player-clients-do-not-beat-a-datacenter-ip` named
its own reversal condition and then did not test it. The condition was "a
PO-token provider plugin (`bgutil-ytdlp-pot-provider`), which is a different
lever than the three documented". This is that test, plus the transcript-half
sweep the owner's ask forced open.

### Egress

**Google Cloud, `160.79.106.128` / `.138`, AS396982, Columbus Ohio** — a second,
independent datacenter egress from WS-AD's Azure Central India `20.207.113.242`.
That independence is the point: two unrelated cloud networks is a much stronger
claim than one.

### The audio half, with the PO-token lever

`yt-dlp 2026.08.19` (the same pin the service ships), `bgutil-ytdlp-pot-provider
1.3.2` built from source, node 22 for the script runtime. Video `Q5_BtWc-G7Y`
(NASA, US Government work, public domain — WS-AD's choice, kept so the two
sessions are comparable).

**Interleaved A/B, arm A = with the provider, arm B = the identical command with
the provider absent. Interleaved so drift in IP reputation hits both arms
equally. Metadata probe (`--skip-download --print %(title)s`), n = 6 pairs:**

| | OK | bot check |
|---|---|---|
| with PO token | **5** | 1 |
| without | **1** | 5 |

The lever is CONNECTED and the effect is real. This is the first thing measured
in this repo that moves the bot check at all.

**Audio bytes, same provider, same session: 0 of 12.** Three arms tried:
script mode with default clients (n=3), forced `player_client=web` (n=2) and
`tv` (n=2), and HTTP-server mode with a persistent session cache (n=5, spaced
90 s apart so the trials were not themselves the cause of the throttling they
measured). The best any trial reached was `Downloading 1 format(s): 251` then
`unable to download video data: HTTP Error 403`. Metadata is winnable; the
media fetch is not.

### The finding that matters more than the A/B

**After roughly forty requests over about thirty minutes, the same interleaved
A/B returned 0 of 4 with the provider and 0 of 4 without.** The 5-of-6 benefit
did not degrade — it disappeared. Intermediate runs showed `HTTP 429` on the
watch page and `HTTP 403` on the InnerTube API before the bot check fired.

So: **a PO token is a mitigation for a WARM datacenter IP and is not a route.**
It buys metadata while the IP still has reputation, and it buys nothing once the
IP has spent it. WS-AD's summary ("the client sweep was never the variable — the
IP was") survives this test and is strengthened by it: a lever that provably
works on a warm IP still cannot produce bytes, and stops working entirely on a
burned one.

### The transcript half, same egress, same session

The owner's ask required splitting transcript from voice, so every route that
could produce WORDS without media bytes was probed:

| surface | result | time |
|---|---|---|
| **Data API v3** `videos.list`, no key | `403 "Method doesn't allow unregistered callers"` | **0.15 s** |
| public `timedtext?v=…&lang=en&fmt=json3` | `429`, Google "Sorry" interstitial, 1103 bytes | 0.37 s |
| InnerTube `/youtubei/v1/player`, WEB ctx | `LOGIN_REQUIRED`, "Sign in to confirm you're not a bot", 0 captions, 0 formats | 0.3 s |
| InnerTube, ANDROID ctx | `HTTP 400` | — |
| InnerTube, IOS ctx | `HTTP 400` | — |
| InnerTube, TVHTML5_SIMPLY_EMBEDDED ctx | `ERROR`, "no longer supported in this application or device" | 0.3 s |
| `youtube-transcript-api` (Python) | its own `IpBlocked` exception | 1.5 s |
| watch page HTML, browser UA | `200`, 1,202,264 bytes, **0 occurrences of `captionTracks`** | — |
| 7 public Invidious / Piped instances | **0 usable**: `401`, `403 Endpoint disabled`, `403`, `502 tunnel`, `526`, `403`, `502` | 0.6–1.3 s |
| `POST https://api.cobalt.tools/` | `400 {"error":{"code":"error.api.auth.jwt.missing"}}` | — |

**The Data API line is the important one and it is a POSITIVE result.** A plain
`403` naming an unregistered caller, in 150 ms, is an ordinary API error and not
a bot check: the sanctioned surface has no IP-reputation problem, and the
transcript half is unblocked from a datacenter for exactly the videos
`captions.download` covers, which is manually uploaded tracks only.

Everything else that could produce words for an UNCAPTIONED lecture goes through
the same player surface the audio does and is blocked by the same reputation.
**There is no free transcript route hiding behind the audio problem**, which was
the specific thing the brief asked not to be wrong about.

### What this does and does not settle

- **Settled:** the PO-token lever named in `rejected.md` as the reversal
  condition has been tried. It moves metadata on a warm IP (5/6 vs 1/6, n=6
  pairs) and produces no audio bytes (0/12).
- **Settled:** it stops helping once the IP is burned (0/4 vs 0/4, n=4 pairs),
  so it is a mitigation and not a route.
- **Settled:** the Data API is reachable from a datacenter; every unauthenticated
  YouTube surface is not; every public Invidious/Piped instance probed is dead.
- **NOT tried, and deliberately:** proxy and cookies still need credentials this
  session has no authority to buy or create. The recommendation, its numbers and
  its reversal condition are in `decisions.md#residential-proxy-is-the-audio-route`
  and `docs/gurukul/youtube-extraction-routes.md`.
- **Confound, stated:** the burn was caused by this session's own ~40 requests.
  A production deploy pacing one extraction per replica would burn its IP more
  slowly. That changes the timescale and not the direction, and the direction is
  what the recommendation rests on.
## `commit-guard-had-never-committed-evidence` (2026-08-26, WS-AK)

**n = the whole production database, one query.** Before any fix, on Neon
project `lucky-sun-80291432`:

```
vy_replica_processing_evidence  0 rows
vy_replica_processing_artifact  0 rows
completed steps, all time       integrity, malware_scan
```

**Method.** A single `select count(*)` over both derived-data tables plus
`string_agg(distinct step)` over `vy_replica_processing_job where state =
'complete'`, run after `media_probe` had failed twice on production.

**What it means.** `integrity` and `malware_scan` are the only two steps in the
eight-step DAG that produce neither an artifact nor a piece of evidence. They
are also the only two that had ever completed. `commitProcessingOutput` aborted
every other step with SQLSTATE 22012, so the pipeline could not have gone past
`media_probe` for any upload, ever, on any runtime - which is a different and
larger blocker than the undeployed container, and was hidden behind it.

**How the SQLSTATE was obtained.** Reproduced locally in about a second against
production Neon, with real storage, real database, real builders and the real
commit statement, stubbing only the ffprobe subprocess with facts already
measured inside the container. That is the whole reason to keep the seam
injectable.

## `worker-execution-timings` (2026-08-26, WS-AK)

Measured on `vyakti-replica-processing`, Consumption profile, 1.0 vCPU / 2 GiB,
Central India, on the owner's real 32.9 MB (32,908,934 byte) MP3.

| thing | measurement | n |
|---|---|---|
| ACR Task build, worker image | 98 s, 96 s, 107 s | 3 builds, 2-vCPU agent |
| Execution that finds an empty queue | 23 s wall, no ClamAV started | 1 |
| `clamd` ready after `--ping` answers | 10,052 ms | 1 |
| `malware_scan` on 32.9 MB, clamdscan `--stream` | 1.4 s | 1 |
| `integrity` (read 32.9 MB from Supabase + SHA-256) | 5.13 s | 1 |
| ClamAV signatures baked into the image | main v63 (3,287,027 sigs), daily v28104 (355,623), bytecode v339 (80) | build log |

**Method.** Wall clock from Container Apps execution `startTime`/`endTime`, from
`vy_replica_processing_attempt.started_at`/`finished_at` for the per-step
numbers, and from the worker's own content-free `clamd_ready_ms` field for the
daemon.

**The 23 s idle figure is the important one.** It is what the schedule costs
when there is nothing to do, and it is 23 s rather than roughly 33 s because
`pendingWork` runs before ClamAV is started. At `*/5` that is 288 executions a
day; paying the 10 s signature load on each of them to discover an empty queue
would be the dominant cost of the entire lane.

## `ffprobe-pipe-versus-file-on-the-owners-mp3` (2026-08-26, WS-AK)

**n = 1 file, 2 invocations, same binary and arguments,** inside the worker
image on the owner's real upload:

```
ffprobe -v error -show_entries format=duration:stream=... -of json pipe:0
  -> exit 0   streams: mp3, 48000 Hz, 2ch   format: {}

ffprobe ... <same args> <file path>
  -> exit 0   streams: mp3, 48000 Hz, 2ch   format: { "duration": "822.720000" }
```

**Method.** A throwaway Container Apps Job on the same image with a command
override, fetching the object through the real storage adapter and running both
invocations back to back. Deleted afterwards.

**The number that matters downstream:** the recording is 822,720 ms, 13 minutes
43 seconds, 48 kHz, stereo, mp3. That is what the pipeline now records as
`media_probe` evidence, and it is comfortably above any plausible enrollment
minimum.

## `voice-evidence-round-trip-first-ever` (2026-08-26, WS-AK)

**n = 3 real requests** from `vyakti-replica-processing` to the private
`vyakti-voice-evidence` GPU service. WS-L deployed that service and recorded
that it boots healthy but that **no round trip had ever been run**. These are
the first.

| attempt | service state | wall time | outcome |
|---|---|---|---|
| 1 | scaled to zero (cold) | 227 s execution | `transport_signature_invalid` (HTTP 401) |
| 2 | warm | 20 s execution | `audio_duration_invalid` |

**The cold-start failure is a clock-skew failure, and the mechanism is exact.**
`services/voice-evidence/app.py` sets `MAX_CLOCK_SKEW_SECONDS = 60`. The client
in `providers/azure-voice-evidence.js` stamps `new Date().toISOString()` and
signs *before* sending. Container Apps then holds the request while it wakes the
scale-to-zero GPU replica, which WS-L measured at about 161 s. By the time the
service validates, the signed timestamp is older than its 60 s anti-replay
window, so a correct request with a correct key is rejected.

**Ruled out first, by measurement rather than assumption:** the HMAC secret is
not the problem. The value deployed in the container app's `evidence-hmac`
secret and the value in the session's `.sec/open-voice-hmac.env` were compared
by SHA-256 digest (neither printed): both 64 characters, identical digest,
`MATCH`. The confirming test is attempt 2 - against a warm replica the identical
code signed, authenticated and was answered.

**So the anti-replay window is shorter than the cold start it has to survive.**
The first request to a scaled-to-zero evidence replica can never authenticate;
every request inside the warm window does. Widening the window is the wrong fix -
it weakens replay protection to paper over a scheduling problem. Warming the
service and then signing, or signing per attempt on retry, are the fixes that
keep the window narrow.

## `owners-recording-exceeds-the-evidence-duration-cap` (2026-08-26, WS-AK)

**Measured 2026-08-26.** With the transport working, `diarize` failed
`audio_duration_invalid` in 20 s. The two limits on the deployed
`vyakti-voice-evidence` app, read back from the container app resource:

```
VOICE_EVIDENCE_MAX_AUDIO_BYTES      = 33,554,432   owner's file 32,908,934  -> fits, 645,498 to spare
VOICE_EVIDENCE_MAX_DURATION_SECONDS = 600          owner's file 822.72 s    -> over by 222.72 s
```

**The owner's real enrollment recording is 13 minutes 43 seconds and the
evidence service accepts 10 minutes.** It squeaks under the byte cap and misses
the duration cap, which is why this surfaced only after `media_probe` first
succeeded and put a real duration on the record.

**Not changed here, deliberately.** Raising the cap is a GPU time and memory
decision on a T4 and a product decision about what enrollment accepts; both
belong to the owner, not to a deploy. The three honest options are to raise the
cap, to segment long uploads before the evidence steps, or to tell the owner the
limit at upload time. Today nothing tells them.

## `wake-then-sign-unblocks-the-evidence-lane` (2026-08-26, WS-AK)

**n = 5 real `diarize` attempts** against the private GPU evidence service from
the deployed job, on the owner's 822.7 s recording.

| # | client | service state | wall | outcome |
|---|---|---|---|---|
| 1 | sign-then-send | cold | 227 s | `transport_signature_invalid` (401) |
| 2 | sign-then-send | warm | 20 s | `audio_duration_invalid` (cap 600 s) |
| 3 | sign-then-send | cold, cap now 1200 | 264 s | `voice_evidence_response_signature_invalid` |
| 4 | sign-then-send | cold | 217 s | `transport_signature_invalid` (401) |
| 5 | **wake-then-sign** | **cold** | **50 s** | **`complete`** |

**Method.** Each attempt is one manual execution of `vyakti-replica-processing`
with the job requeued between attempts; state read from
`vy_replica_processing_job`. Attempts 1-4 ran images that signed before sending;
attempt 5 ran `replica-processing-worker@sha256:c274c369…`, which polls the
service's own `/healthz` until it returns 200 and only then builds the
timestamp, nonce and signature.

**Attempt 5 was a COLD start and still took 50 s rather than 227 s.** Waiting
for readiness before signing is not just more correct, it is faster than failing
on a stale signature and being retried later, because the wake is being waited
for either way.

**Attempt 3 is the one worth remembering.** `voice_evidence_response_signature_invalid`
is raised by the CLIENT when the response carries no valid signature header, and
an ingress error page produced while the replica is still activating looks
exactly like a tampered response. The code is doing the right thing and naming
the wrong cause: infrastructure noise and an attack are indistinguishable to it.

**What diarize actually produced**, the first voice evidence this system has
ever written:

```
278 speaker_segment rows, spans 624 ms to 821,680 ms, mean confidence 0.877
adapter silero-ecapa-cluster / vyakti-voice-evidence-v1
cluster-1  231 segments  663.5 s      cluster-2  39 segments  25.9 s
cluster-3    3 segments    2.7 s      cluster-4   5 segments   4.4 s
overlaps detected: 0
```

**`target_likelihood` is 0.500 on every one of the 278 rows, and that is
DELIBERATE, not a gap.** `evals/voice-evidence/run.mjs` gates it twice: "real
diarization output remains explicitly target-unknown" and "service refuses to
infer target identity without an anchor". The service will not guess which
cluster is the owner without an enrolled reference to compare against, which is
the right refusal for a consent-critical field.

The consequence is still real and belongs to whatever comes next: cluster-1 is
dominant at 663.5 s of about 696 s of voiced audio, but "dominant" is doing work
that no stored number does. Something downstream has to supply the anchor or
choose the cluster explicitly, and it must not read 0.500 as a measured
likelihood.

## `separate-fails-on-the-whole-recording` (2026-08-26, WS-AK)

**Measured.** With `diarize` complete, `separate` was enqueued and failed twice,
`voice_evidence_failed`, at 20:04:30.775Z and 20:05:50.753Z. That code is the
evidence service's bare `except Exception: return _signed_response(request, 503,
{"error": "voice_evidence_failed"})`, so it means an unhandled exception on the
GPU rather than a validation refusal.

**HYPOTHESIS, NOT CONFIRMED.** The Container Apps console logs for that window
had not been ingested into Log Analytics by the end of this session, so there is
no traceback yet. What the code says: `app.py:241` passes the entire waveform to
Sepformer in one forward pass,
`separator.separate_batch(waveform.unsqueeze(0).to(device))`. At 822.72 s and
16 kHz that is 13.16 million samples in a single tensor on a T4. Sepformer is a
dual-path transformer over raw audio and its memory grows with sequence length,
so a CUDA out-of-memory is the obvious candidate, and `torch.cuda.OutOfMemoryError`
is an `Exception` and would land in exactly that handler.

A second problem sits behind the first regardless of whether OOM is the cause:
the handler returns TWO full-length separated WAVs base64-encoded in the
response body. At this duration that is about 52.6 MB of PCM before encoding and
roughly 70 MB after, against the client's 80 MB response cap. Even a successful
separation of a recording this long would be close to the ceiling, and a
20-minute one would exceed it.

**What would confirm it.** The traceback, once ingested: a
`torch.cuda.OutOfMemoryError` naming an allocation size. **What would refute it.**
Any other exception type, which would point at the model or the input shape
rather than at length.

**Why it matters for the cap decision.** `diarize` passed at 822 s because VAD
and per-segment embeddings scale linearly and are computed piecewise. `separate`
is where whole-recording processing actually breaks. Raising
`VOICE_EVIDENCE_MAX_DURATION_SECONDS` moved the wall from `diarize` to
`separate` rather than removing it, which is the concrete evidence for
`windowing-belongs-before-the-embedder-not-before-diarize`: the fix is chunked
analysis, not a larger number.

## audio-protection-cpu-serving

**The audio protection service serves real watermarked, C2PA-signed audio on
CPU.** WS-AL, 2026-08-26.

**Method.** Container app `vyakti-audio-protection`, revision
`vyakti-audio-protection--0000002`, image
`vyaktivoiceacr.azurecr.io/audio-protection@sha256:a5c12a02f2f0d380dbff786bab34db743aac0385860f05f615f41d2b73985079`,
2 vCPU / 4 GiB Consumption profile in `vyakti-voice`, Central India. Every
request was HMAC-signed with the deployed transport secret per
`vyakti-audio-protection/v1`, and every response signature was verified by the
client before the body was read. Test audio: 3.000 s of 24 kHz mono
`pcm_s16le`, a 220 Hz sine at amplitude 9000 (144,000 bytes). This is a
synthetic tone, not a voice: it measures the pipeline, not fidelity.

### Round trip, n = 5 signed requests across 3 probe rounds

| probe | result | wall clock |
|---|---|---|
| `GET /healthz` warm | 200 `{"ready":true}` | 1.04 s, 1.24 s, 1.29 s |
| `POST /v1/watermark` first on a fresh replica | 200 | 3.28 s, 3.43 s |
| `POST /v1/watermark` warm | 200 | 2.72 s, 2.79 s |
| `POST /v1/c2pa` | 200, 12,350-byte manifest | 5.20 s |
| `POST /v1/sign` | 200, ES256 | 4.40 s, 4.65 s, 4.96 s |
| **wrong key, negative control** | **401 `transport_signature_invalid`** | 1.44 s, 1.45 s, 1.57 s |

Warm real-time factor for watermarking: **2.72 s of compute for 3.000 s of
audio = 0.91**, i.e. faster than real time on 2 vCPU.

Every 200 from `/v1/watermark` carried `embedded: true`, `streaming: true`,
`message_verified: true`, `verification_confidence: 1.0`, the echoed token hash,
and an `output_sha256` that the client independently recomputed and matched.
Output length equalled input length exactly (144,000 bytes) and **76,253 of
144,000 bytes differed**, so the watermark measurably altered the audio rather
than passing it through.

### Independent watermark detection, with a negative control

The service verifies its own watermark before returning. That is necessary and
not sufficient, so the returned bytes were scored by a **separate process** (an
ACR Task build running the same official `audioseal_detector_streaming` from the
baked checkpoints), against the identical audio from before the service saw it:

```
SERVICE OUTPUT    confidence=1.000000  message_matches=True
NEGATIVE CONTROL  confidence=0.000000  message_matches=False
expected message bits [0,0,1,0,1,0,1,0,0,1,1,1,1,1,1,1]
decoded from output   [0,0,1,0,1,0,1,0,0,1,1,1,1,1,1,1]
```

n = 1 clip, 2 arms. The control is what makes the first line mean anything: a
detector that answered "watermarked" to everything would produce line one and
not line two.

### The production client against the live service, n = 1 full sequence

The unmodified `api/_provenance/providers/azure-protection.js` with the exact
env values prepared for Vercel, over the real network:

| stage | measured |
|---|---|
| watermark over the wire | 3,020 ms |
| C2PA manifest | 2,614 ms |
| Key Vault receipt signature | 1,058 ms |
| **total protection of a 3 s clip** | **6,692 ms** |
| undisclosed audio | refused, `provider_disclosure_evidence_missing` |

### Cold start, n = 1 from true zero

The app was confirmed at 0 running replicas at 19:24:41 UTC, then one request
was sent.

| measurement | value |
|---|---|
| `GET /healthz` that triggered the wake | **200 in 35.60 s** |
| immediately following real `POST /v1/watermark` | **200 in 3.43 s** |

From the platform's own system log for the same revision's first start:
replica scheduled at t+0, pull begins t+2.0 s, **image pulled t+10.0 s (9.73 s
for 424,673,280 bytes)**, container started t+15.9 s, **`Application startup
complete` t+19.5 s**.

**Comparison that matters.** WS-L measured the GPU voice runtime at 161 s to
ready with the triggering request dying at 240 s
(`docs/gurukul/AZURE-DEPLOY-STATE.md` section 8, 9.70 GB image). Same platform,
same resource group, same scale-to-zero posture: **35.6 s and a 200** versus
**161 s and a 504**. The difference is almost entirely image size.

### What this does and does not settle

- **Settled:** the protection service serves all three endpoints on CPU, the
  watermark is present and independently detectable with the exact 16-bit
  message, and the HMAC transport is enforced rather than merely configured.
- **Settled:** a user request can absorb this service's cold start. It provably
  could not absorb the GPU lane's.
- **Settled:** the Key Vault chain works end to end. A user-assigned identity
  with `get` and `sign` only, against a non-exportable EC P-256 key, produces
  ES256 signatures that c2pa-rs accepts into a real 12,350-byte manifest.
- **NOT settled: voice quality.** The input was a 220 Hz tone. Nothing here says
  anything about how a replica sounds.
- **NOT settled: watermark robustness.** Detection was verified on the exact
  bytes returned. Survival through lossy encoding, resampling or re-recording
  was not tested.
- **NOT settled: the owner's preview.** The five Vercel environment variables
  are prepared but not written, because this session has no Vercel env-write
  tool, and `POST /api/replica-voice-preview` is behind `requireUser`. The
  remaining step is one dashboard paste and a redeploy.
- **Confound, stated:** n is small. The cold start is a single observation and
  the latencies are 2 to 3 observations each. They are consistent with each
  other and none is a tight call, but nothing here supports a confidence
  interval.

### `sarvam-transcribe-production-dag-position` — the owner's real upload, DAG position after WS-AN's Sarvam wiring shipped to production (n=1, 2026-08-26)

Method: the new code (`api/_replica-processing/providers/sarvam-transcription.js`
plus the `composition.js` rewire) was built into a real container image via an
ACR Quick Task (`vyaktivoiceacr`, run id `cus`, `DockerBuildRequest`,
succeeded in 90 s, pushed
`replica-processing-worker@sha256:3e6c507c8c3f8fbe860c2a233cd993702977921b28e9558d2d8fa8ee190fd697`),
patched onto the live Azure Container Apps Job `vyakti-replica-processing`
(resource group `vyakti-voice`) via the Container Apps management REST API
(no az CLI in this session), and one execution was started and observed to
`Succeeded` (24 s). The DAG position was then read directly off production —
Neon, over its own SQL-over-HTTP endpoint (`https://{host}/sql`, the same
transport `api/_db.js` uses), not inferred:

```
select step, state, attempt, failure_code, updated_at
from vy_replica_processing_job
where source_id = '886cc5dc-5b7a-4888-b08c-0e1173797bb1'
order by updated_at desc;
```

| step | state | attempt | failure_code |
|---|---|---|---|
| `separate` | **failed** | 5/5 | `voice_evidence_failed` |
| `diarize` | complete | 1 | — |
| `media_probe` | complete | 1 | — |
| `malware_scan` | complete | 1 | — |
| `integrity` | complete | 1 | — |

**What this settles.** The Sarvam wiring itself did not move the DAG, and
could not have: `separate` is terminally failed (`attempt=5`, the configured
ceiling) with a GENUINE failure code — `voice_evidence_failed` is not in
`CAPABILITY_ABSENCE_CODES`, so it is a real GPU-side failure on this specific
822.7 s recording, not a missing-capability state, and it sits BEFORE
`transcribe` in the DAG (`enhance` and `transcribe` both depend on `separate`
completing). This predates this session — WS-AK had already flagged
"`separate` throws on the GPU for a whole 822.7 s recording" — and this
session did not investigate it further; it is a different adapter family
(voice-evidence GPU) from the one this task changed (ASR).

**What this does NOT settle.** Whether the Sarvam adapter itself produces a
correct transcript against this recording once `separate`/`enhance` clear —
that call has not been made, because `SARVAM_API_KEY` is also not present on
the job's env (verified by reading the job resource's
`template.containers[0].env` both before and after this session's image
patch: only `NEON_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`CLAMAV_ADAPTER_VERSION`, `FFPROBE_ADAPTER_VERSION`,
`AZURE_REPLICA_APP_BUDGET_USD`, `AZURE_VOICE_EVIDENCE_ORIGIN`,
`AZURE_VOICE_EVIDENCE_HMAC_SECRET` and two run-tuning vars were present,
neither the old `AZURE_SPEECH_*` pair nor a new `SARVAM_API_KEY`), and this
session had no route to read the value back out of the Vercel project
`vyakti-replica-lab` where the owner says it already lives. Handover:
`.sec/an-sarvam-key-handover.txt` in this session's scratchpad.

### `sarvam-batch-duration-ceiling` — Sarvam batch API's own duration/size ceiling (n=1 doc fetch, 2026-08-26)

Method: fetched `docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/
batch-api.md` (the batch endpoint's own reference page) via WebFetch and asked
it directly for stated limits, since neither `api/_asr/providers/
sarvam-saaras.js` nor `context/` recorded one. Answer: **files up to 2 hours
long, up to 20 files per job**, no separate byte-size ceiling documented
beyond that. The owner's 822.7 s (13.7 min) recording is about 17% of that
ceiling. Conclusion acted on: no chunking is implemented in
`sarvam-transcription.js` — the file is sent whole. This is a single doc
fetch, not a measured API round trip against a file near the ceiling; if a
much longer recording (multi-hour) is ever ingested, re-verify against the
live API rather than trusting the doc a second time.
## studio-layout-repair

**What, how, when.** Every number below is read from the rendered DOM in
headless Chromium against the BUILT bundle, at three viewport widths (390, 834,
1355px) on all three wizard steps (Feed, Meet, Deploy), n = 9 screens per row.
The signed-in studio was reached two ways and both agree: a real Supabase
session driven through the e2e bridge against production `/api`, and
`studio-layout-fixture.html` with a stubbed `/api`. WS-AM, 2026-08-26.

The fixture reproduced the live figures exactly where they overlap (`16px` /
128 characters for the Meet band blurb; `54px 418.625px` for
`.processing-review` at tablet), which is what qualifies it to stand in for the
live screen in CI.

### The track-list class: nine rules, all measured

Every rule below reserves a track for a child that may not exist. Six were
producing a visible defect on the base branch; three were latent.

| rule | width it broke at | measured before | after |
|---|---|---|---|
| `.processing-review` base (54px rail) | tablet, desktop | content column 67px / 84px, 419px and 888px wasted | full width, 0 wasted |
| `.consent-panel` mobile (39px rail) | phone | content column 39px, 626 chars | full width |
| `.evidence-panel` mobile (39px rail) | phone | content column 39px, 161 chars | full width |
| `.liveness-section` mobile (39px rail) | latent | rail keyed on `.panel-index`, child is `.liveness-index` | `:has`-guarded, child removed |
| `.identity-section` mobile (39px rail) | latent | same mismatch | `:has`-guarded, child removed |
| `.wizard-band-collapsible > summary` | all three | blurb 16px wide, 116 to 148 chars | full column width |
| `.workspace-switch > summary` | phone | subtitle 16px wide | full column width |
| `.wizard-blockers-rest > summary` | phone | subtitle 16px wide | full column width |
| `.readiness-compact > summary` | latent | correct by auto-placement luck, not instruction | pinned explicitly |

The last four are a SECOND mechanism, not the same one: there the track count
and the child count agree, and a real text child auto-flows into the track
reserved for the `::after` chevron. The over-count detector is blind to it.
Both mechanisms now have a detector in `scripts/check-layout.mjs` and both fire
under negative control.

### Readability, before and after

| measure | before | after |
|---|---|---|
| horizontal overflow, phone, all three steps | 14px | 0px |
| narrowest prose block | 5px (`.consent-lede`, 161 chars) | none under 20 cpl |
| smallest body text | 8px (`.identity-boundary`, `.liveness-boundary`) | 12px |
| distinct blocks under the 11px readable floor | 11 | 0 |
| longest line | 216 cpl (`.identity-boundary`, 866px at 8px) | none over 115 cpl |
| in-flow sibling overlap | 120x7px (`.section-heading` vs `.voice-provider-state`) | none |
| children spilling their own panel | up to 477px (`.build-readiness`) | none |
| sticky chrome covering prose | at every scroll stop on all 9 screens, up to 343x186px, behind an OPAQUE card | translucent only, card removed |
| page height, phone Feed | 4425px | 2855px |
| page height, desktop Meet | 9878px | 9059px |

The height drops are the readable measure of the fix: the same copy, no longer
wrapping one word per line.

### Contrast

Measured on every visible control, nine screens, effective foreground over the
nearest opaque backdrop, WCAG relative-luminance ratio.

| control | before | after |
|---|---|---|
| every enabled `.primary-button` (10 distinct labels) | **1.73:1** | 8.2:1 and up, none under 4.5 |
| `.mirror-tabs button` inactive | 4.11:1 | 6.1:1 |
| disabled `.primary-button` (WCAG-exempt) | 3.64:1 at opacity 0.48 | 4.5:1 at opacity 0.6 |
| disabled `.review-refresh` | 3.22:1 at opacity 0.5 | 4.33:1 at opacity 0.6 |

The 1.73:1 row is a cascade-layer defect, not a colour choice, and it was
present on the untouched base branch. See
`decisions.md#cascade-layer-order-must-be-declared-where-a-minifier-cannot-drop-it`.

### The gate itself

| | old gate | new gate |
|---|---|---|
| prose blocks it could see | 6 to 7, all sign-in copy | **264** |
| screens judged | 3 | 9 |
| negative control: 58px rail on `.processing-review` | **passed** (did not fire) | FAIL, exit 1, names the element and 415px / 884px wasted |
| negative control: chevron column pin removed | not detectable | FAIL, exit 1, 9 findings across narrow, sliver and overflow |
| restored | n/a | ok, exit 0, 264 blocks |
## `separate-underlying-error-confirmed-structurally` (2026-08-26, WS-AO)

**What was measured, and how.** The owner's real job (`job_id b9e23181...`,
`source_id 886cc5dc...`) was left running against production: the Azure
Container Apps Job fires on its own `*/5` cron, so five consecutive attempts
(20:04:31Z, 20:05:24Z/51Z, 20:10:24Z, ... through 21:05:22Z) were observed live
via Neon (`vy_replica_processing_job`), Log Analytics (`ContainerAppConsoleLogs_
CL` for both the processing job and `vyakti-voice-evidence`), and the Container
Apps REST API's replica listing, without touching the code first. At attempt 5
the job hit `state='failed'` (terminal -- `classifyProcessingFailure`'s
`maxAttempts`), `failure_code='voice_evidence_failed'` on every attempt.

**The underlying error was NOT recoverable from a traceback, and that is itself
a finding.** `services/voice-evidence/app.py`'s `/v1/analyze` handler ends in a
bare `except Exception: return _signed_response(request, 503, {"error":
"voice_evidence_failed"})` with no logging call of any kind (line 392-393,
confirmed by reading the deployed source). Log Analytics for
`vyakti-voice-evidence` carries zero lines in any time window overlapping any
of the five failing requests -- not an ingestion delay (other apps' logs for
the same windows are present) but the service genuinely printing nothing on
this path.

**What WAS confirmed, structurally and operationally, in place of a
traceback:**
- Every OTHER exception path in `app.py` raises a NAMED `ServiceError`
  (`audio_duration_invalid`, `audio_integrity_invalid`, `audio_decode_failed`,
  `separation_output_invalid`, ...), each with its own string. `voice_evidence_
  failed` is reachable ONLY through the bare `except Exception`, so every named
  validation -- including the `MAX_DURATION_SECONDS` check the raised cap was
  supposed to relieve -- provably passed.
- The replica's `restartCount` stayed **0** across all five attempts (Container
  Apps replica listing, checked live). A container-level OOM kill (the Linux
  kernel killing the process) would show as a restart; it did not. This is
  consistent with an IN-PROCESS, CATCHABLE exception -- exactly the shape of a
  `torch.cuda.OutOfMemoryError`, which PyTorch raises as an ordinary `Exception`
  subclass rather than crashing the process.
- The only GPU-bound operation in `_separate()` is one unchunked forward pass,
  `separator.separate_batch(waveform.unsqueeze(0).to(device))`, over the WHOLE
  waveform: 822.72 s at 16 kHz = 13,163,520 samples in one tensor on a T4-class
  card, for a Sepformer dual-path model whose memory grows with sequence
  length.

**What would have confirmed it beyond structural inference, and was not done.**
Adding a logging line to the bare `except` and rebuilding/redeploying the
5.34 GB GPU image, to catch a live traceback on the job's next automatic retry.
Not done: out of scope for this workstream (the decided fix is windowing, not
hardening the evidence service's error handling) and costly to rebuild for a
diagnostic that the code-path elimination above already answers with high
confidence. **Named honestly rather than left implicit: this is a structural
and operational confirmation, not a captured stack trace.**

**Empirical confirmation, after the fix.** Windowing eliminates the whole-file
forward pass by construction -- `separate` now sends a single ~10 s clip, never
the 822.72 s file -- so if length was the true cause, `separate` succeeding
after this change on the SAME 822.72 s upload is the strongest evidence
available without the traceback. See the session's DAG-position report in
`context/STATE.md`'s session log for whether that requeue was observed to
complete.

## `owner-reference-window-selected` (2026-08-26, WS-AO)

**Method.** `api/_replica-processing/reference-window.js` exercised three ways:
(1) pure-JS unit test of `ownerClusterSegments`/`mergeRuns` against synthetic
diarize segments -- confirms the dominant-duration cluster is picked and a
second cluster's segments are excluded from candidacy entirely; (2) a real-
ffmpeg integration test (`ffmpeg 6.1.1`, ffprobe from the same build) against a
synthesised MP3 with a "noisy" 11 s owner run, a 2 s cluster-2 blip, and a
"clean" 11 s owner run, confirmed the extraction/scoring/slicing round-trip
produces a byte-exact 10 s (320,044-byte) WAV and NEVER cites the cluster-2
span; (3) a full `executeProcessingJob` run for `job.step==='separate'` against
fake adapters/artifact store with the same synthetic MP3, confirming the
complete worker.js integration path (resolve full source -> select window ->
write derived artifact -> call adapter -> commit candidates) completes with
`outcome: 'complete'` and the stored reference object is exactly 320,044 bytes
-- never the 26,458 ms of the synthetic source. n=1 synthetic file per test,
run once each, 2026-08-26. **Not yet run against the owner's real 822.72 s
recording** -- that requires the fix deployed and the job requeued in
production; see `context/STATE.md` for whether that had happened by the end of
this session.

**A real bug this testing caught before production, worth recording:** the
first implementation sliced the selected window out of ffmpeg's raw output
assuming a fixed 44-byte WAV header. ffmpeg writing to a pipe cannot seek back
to patch the `data` chunk's declared size once it knows the true one, so it
emits `0xFFFFFFFF` as a placeholder, and measured against the real binary it
also writes an INFO `LIST` chunk before `data` -- pushing the real payload to
byte 78, not 44. `windows.js`'s own `readPcm16Wav` handles this correctly (it
was written for exactly this kind of file), so the fix was to route the OUTPUT
through a file the same way `probeBytes` already routes the INPUT through one,
and to reuse `readPcm16Wav` for the final slice rather than assuming a fixed
offset. See `context/rejected.md` for the same finding as a named rejection.

## `self-test-four-gates-measured-blocking` — REPLICA_SELF_TEST_MODE, proven both ways against the real database (2026-08-26, WS-AQ)

**Method.** Two fully isolated fixture replicas (random uuids, no real owner,
no real bytes) built directly against the live Neon database, reproducing the
exact stuck shape from tonight's incident: one `vy_replica_source` at
`state='ready'`, one `enhance`/wav artifact, and seven evidence rows spanning
`media_probe`, `speaker_segment`, `language_span`, two `voice_embedding`
families (`ecapa`/`xvector`), `voice_measurement` and `quality_measurement` --
the same shape `readiness()` in `api/_replica-review.js` checks.

**Negative control (flag absent).** `selfTestModeEnabled({})` returned
`false`. `applySelfTestAutoGrant` returned `{applied:false,reason:"flag_off"}`
and wrote nothing: `voice_genome_readiness.blockers` were the identical 8
codes before and after
(`liveness_verification_required, biometric_consent_required,
training_consent_required, two_independent_embedding_families_required,
reviewed_voice_measurement_required, reviewed_quality_measurement_required,
reviewed_speaker_segment_required, owner_selected_voice_candidate_required`),
0 consent rows existed, and calling the real `queueOwnedVoiceGenome` directly
still threw `409 voice_genome_not_ready` with the same 8 blockers in its
`details`.

**Positive (flag `"true"`, `subject_mode='self'`).** All 8 blockers cleared:
3 consent scopes granted (`biometric`, `training`, `inference`), 7/7 evidence
rows accepted, 1 artifact selected, `liveness_verified_at` set,
`queueOwnedVoiceGenome` (the real function, unmodified) queued a build
(`state:'queued'`, `target_version:1`) computing its own `source_set_hash` --
nothing here wrote that hash by hand. `review.self_test_mode` read `true` on
the same call a studio panel would make.

**Revocation, proven as its own step.** `scripts/revoke-self-test-grants.mjs`,
run for real (not `--dry-run`) against a third fresh fixture already granted
by the flag: `consent_revoked:3, replicas_reset:1, evidence_reversed:7,
artifacts_reversed:1`. Re-reading `voice_genome_readiness` afterward showed
all 8 blockers back, byte-for-byte the same set as the negative control's.

n=3 fixture replicas (positive / negative / revocation), each built and torn
down in the same run, 2026-08-26. Every fixture was deleted (`delete from
vy_replica ...`) after its assertions ran; a follow-up count query confirmed
zero leftover rows in the live database.
## voice-preview-block-reason-production-shape (2026-08-26, WS-AP)

**Method.** `evals/studiowizard.mjs` section 10, run via
`node evals/studiowizard.mjs` (bundles the real `wizardModel.ts` and
`blockerClass.ts` from source on every run, per this repo's standing rule
against frozen bundles). Three targeted rows plus a full sweep:

1. The exact production shape (identity/liveness unverified, no runtime
   blockers reported, platform queue idle) — `voicePreviewBlockReason` reads
   `kind: "you"`, never `"us"`, and names the identity gate specifically.
2. Identity/liveness done, `voice_genome_not_approved` present, platform queue
   idle — reads `"you"` (go review and queue a build).
3. The identical row 2 shape with `platformWork.running: 1` — reads `"us"`
   (nothing to review yet).
4. Every row in the 27,648-input universe (`STEP_ORDER` x boolean/tristate
   fixtures already built for section 8): `reasonIsHonest` true for all
   27,648, and the panel's class never disagrees with the Meet step's own
   `missing` row for the gate it names (0 disagreements).

**Result.** 6/6 assertions pass. Re-run 2026-08-26 after the reclassification
in `context/decisions.md#voice-genome-approval-is-the-owners-turn-not-the-platforms`
landed; the full suite (10 sections, 80 checks) passes alongside it.

## the-sticky-pager-negative-control-bites (2026-08-26, WS-AP)

**Method.** `scripts/check-layout.mjs`'s new `pager-returned` finding, added
to its existing real-browser audit (Playwright, Chromium, `studio-layout-
fixture.html`, three viewports x three steps). Two runs against the built
`dist/`:

1. **Clean tree** (the sticky pager deleted): `node scripts/check-layout.mjs`
   → `ok, 246 prose blocks judged across 390, 834, 1355px x feed, meet,
   deploy` — zero `pager-returned` findings.
2. **Negative control**: a `.wizard-pager` section with a "Next: talk to your
   clone" button reintroduced into `StudioApp.tsx`'s render, same build and
   gate: `FAIL, 18 finding(s)` — the element and the "Next: " button both
   caught, at the first width/step the audit reaches (`phone/feed`; the audit
   stops enumerating duplicates past 6, so 18 is the count of DISTINCT
   `(kind, where)` pairs recorded before that cap, not the true total across
   all nine screens).
3. Tree reverted to (1), re-run: clean again.

**Why this replaces the earlier model-level negative control.** `pagerAction`/
`PagerAction`, the function this suite's section 10 used to test with a
hand-built "naive advance" negative control, were deleted along with the
component they served (`context/rejected.md#the-sticky-pager-was-deleted-not-shrunk`).
The property "nothing pushes a person into a step with nothing to act on" is
now a property of the RENDERED PAGE, not of a function, and only a real
render can check it. Sits alongside `evals/studiowizard.mjs`'s remaining
model-level properties (section 8's honesty split, section 10's
`voicePreviewBlockReason` agreement with the rail) rather than replacing them.

## replica-runtime-genome-latest-query-explained-live (2026-08-26, WS-AP)

**Method.** The modified `RUNTIME_STATUS_SQL` in `api/_replica-runtime.js`
(adding the `vg_latest` lateral join and its two selected columns) was run
directly against the live Neon database over SQL-over-HTTP
(`api/_db.js`'s own protocol), not a mock: once as `EXPLAIN <query>` with a
placeholder replica id, once as the real query. Both returned `200`. The real
query's field list includes `genome_latest_version` and `genome_latest_status`
alongside every pre-existing column, and returned zero rows for the
placeholder id, as expected (`offline-mocks-cannot-type-check-sql` /
`explain-is-the-only-parser-we-have` both apply; this is the live database,
not a mock, so both are satisfied more strongly than the minimum).

**A defect this check caught before it shipped.** The first version of this
edit put backtick-quoted identifiers (`` `vg_latest` ``, `` `cap` ``) inside a
SQL `--` comment that itself sits inside the file's JS template literal. A
backtick inside a JS template literal closes it regardless of surrounding SQL
comment syntax, so the edit silently truncated `RUNTIME_STATUS_SQL` and left
roughly ninety lines of SQL sitting as bare (invalid) JavaScript. `node --
input-type=module -e 'import ... from "./api/_replica-runtime.js"'` threw a
`SyntaxError` immediately, before any gate ran. Fixed by rewording the comment
to name the identifiers without backticks. `node scripts/verify-release.mjs`
was re-run in full AFTER this fix (not before) and is the 14/14 recorded in
this session's `STATE.md` log line.

## voice-versions-counter-and-the-third-hidden-gate (2026-08-26, WS-AP)

**Method.** Read `api/_replica-runtime.js`'s `RUNTIME_STATUS_SQL` and
`clientRuntimeStatus` by source inspection against the coordinator's report
(replica `6aff3202-abbd-4ca6-976b-4009ed5af028`: a real version-1 DRAFT genome
in `vy_replica_voice_genome`, status strip reading "0 / Not built yet"). The
`vg` lateral join computing `versions.voice_genome` was scoped to
`status='approved'`, so a draft-only genome was invisible to it by
construction; the label additionally assumed any non-zero count meant
approved. Both are now derived from a second, unscoped `vg_latest` join
(newest row of any status) and its own status column, verified live per
`context/measurements.md#replica-runtime-genome-latest-query-explained-live`.

**The "third hidden gate".** `runtimeBlockers()` already emits
`voice_genome_not_approved` whenever `!genome_approved`, which is true
whenever only a draft exists — so the code path the coordinator flagged as a
newly-discovered gate was already reachable through
`context/decisions.md#voice-genome-approval-is-the-owners-turn-not-the-platforms`'s
fix, not a fourth thing to build. What was still a dead end: the Activity
panel's "Look at the build" action (`normaliseModelBuild`, `state==='review'`,
`next_action: {kind:'review'}`) had no `onAct` handler wired in
`StudioApp.tsx`, so the tap silently did nothing. Wired to navigate to Meet
and focus `#processing-review`. **Not built, and said so rather than guessed
at:** no endpoint anywhere in `api/` sets a `vy_replica_voice_genome` row's
status to `'approved'` — grepped for `status='approved'` and `'approved'`
writes against that table and found none. Approving a genome outright (as
opposed to reviewing evidence and queuing a build, which is real and wired)
is a capability that does not exist yet in this codebase, not a hidden UI.
## `wav-format-unsupported-fixed-and-proven-end-to-end` (2026-08-26/27, WS-AR)

**Method.** The reported bug ("Preview my voice" -> `wav format unsupported`
after a ten minute wait) was confirmed structurally before any fix: grepped
every caller of `probeEnrollmentWav` (`api/_audio/wav.js`, hard gate: PCM
s16le mono 24 000 Hz) and every producer of a `stage='enhance'` artifact
(`services/voice-evidence/app.py::_enhance`, which called `_wav_bytes(...,
48_000)`), and independently confirmed against live production database rows:
`vy_replica_generation` on the owner's real replica (`6aff3202-abbd-4ca6-
976b-4009ed5af028`) carries 23 real failed preview attempts dated
2026-08-26T22:54-23:08Z, most `wav_format_unsupported`, referencing an enhance
artifact whose `byte_size` (960044) is exactly 10.00 s at 48 kHz mono s16le.

**The fix.** `services/voice-evidence/app.py::_enhance` now resamples its
DeepFilterNet3 output (still computed at the model's native 48 kHz) down to
`ENROLLMENT_SAMPLE_RATE = 24_000` with `torchaudio.functional.resample` before
writing the WAV. Built via three ACR Quick Task builds (image
`vyaktivoiceacr.azurecr.io/voice-evidence`, run ids `cuv`/`cuw`/`cux`/`cuy`,
each ~4-13 min, server-side, no local Docker) and deployed to the live Azure
Container App `vyakti-voice-evidence` via four sequential `PATCH`es to the
Container Apps management REST API (no `az` CLI), each preceded by a GET
confirming no concurrent workstream had moved the resource. **Final deployed
digest: `vyaktivoiceacr.azurecr.io/voice-evidence@sha256:
b2e2b74349ee8d1e2f3d346ea5bf070a5dcf4808ca8b4cd39845ae20dbd83914`**,
revision `vyakti-voice-evidence--0000006`.

**Proven end to end, on the owner's real replica, through the real deployed
services -- not a mock, not a synthetic file:**

1. Requeued the real 8-step DAG's `enhance` step (see
   `rejected.md#revision-bump-cannot-be-partial-across-the-dag` for exactly how)
   against the newly deployed service, driven by the real Azure Container Apps
   Job `vyakti-replica-processing` (executions `8afitjg` through `e1oh9ea`,
   REST-triggered `/start`, polled to `Succeeded`). Measured artifact:
   **4 candidates, each exactly 480,044 bytes = 10.00 s at 24 000 Hz mono
   PCM16** (`24000 Hz * 2 bytes * 10 s + 44-byte header`), `transform_version:
   deepfilternet3-enroll24k-v1`, sha256 distinct from every prior candidate.
2. Selected the new artifact (`3455faac-4483-521d-ae20-a0304e00c550`) through
   the REAL `selectOwnedVoiceArtifact` function
   (`api/_replica-review.js`, the same one `/api/replica-review` calls), and
   pointed genome version 1's `definition.references.enrollment_artifact_ids`
   at it via a direct, explained database correction (see the session log --
   `queueOwnedVoiceGenome`'s normal readiness gate could not be exercised
   without also fixing a `voice_quality` input-count fallout unrelated to this
   bug; documented as its own rejection rather than silently worked around).
3. Called `handleVoicePreviewPanel` -- the exact function
   `api/voice-preview.js` wires to the studio's "Preview my voice" button, with
   every collaborator (`beginOwnedVoicePreview`, `readPrivateReplicaObject`,
   `createOpenChatterboxPreviewProvider`, `protectReplicaStream` via
   `createProductionProtectionAdapters`, `createNeonVoicePreviewLedger`) wired
   to the REAL production database, storage bucket, GPU broker and watermark
   service, no mocks. First call returned `202 warming` (cold GPU start,
   `wake_dispatched: true`); after waiting out the cold start (~3.5 min total,
   consistent with the documented 161 s ready time), the second call returned:

```
kind: audio, status: 200
X-Vyakti-Disclosure: audible-prefix-v1
X-Vyakti-Model-Commitment: b66dbbe202313119f616f8afe7d9a938d483ae3f8136d8d52e6f4c7560469b36
AUDIO BYTES: 266924
```

   Saved and probed with Python's `wave` module: **mono, 16-bit PCM, 24 000 Hz,
   133 440 frames = 5 560 ms.** `vy_replica_generation` row
   `fc6bd382-77ab-411f-a686-2387cbfcd48a` settled to `state='sealed'`
   (watermarked and disclosure-bound, per `protectReplicaStream`'s contract --
   the spoken AI disclosure and PerTh watermark were never stubbed or bypassed
   to get this byte count), `preview_artifact_id` correctly pointing at the new
   24 kHz artifact.

**n=1** (one replica, one real preview call that reached `sealed`), method as
above, dated 2026-08-27 (session crossed midnight UTC). This is the first time
this exact call path has ever returned real audio bytes in production.

## `enrollment-reference-bandwidth-before-after` (2026-08-27, WS-AS)

**Scope line first.** Two things are measured here: an FFT-based spectral
fraction (real, computed) and a same-seed/same-text output comparison across
different references (real, computed). No ECAPA speaker-embedding cosine was
computed in this session -- see the rejection below for why, stated plainly
rather than invented.

**Subject.** The owner's real replica `6aff3202-abbd-4ca6-976b-4009ed5af028`,
source `77adc936-4ca1-43d7-8cd8-92c6a724780c` (822.72 s, 48 kHz/320 kbps MP3,
32 908 934 bytes, confirmed by `ffprobe` against the real fetched bytes).

**Method.** A real FFT (radix-2, Hann-windowed, `scripts/check-enrollment-
bandwidth.mjs`) over the first ~2.7 s of a Hann-windowed prefix, reporting the
fraction of spectral energy at/above 8 000 Hz.

| clip | source | sample rate | fraction >= 8 kHz |
|---|---|---|---|
| **BEFORE** -- artifact `3455faac-4483-521d-ae20-a0304e00c550`, the enrollment reference `separate` (sepformer-whamr16k @ 16 kHz) + `enhance` actually produced and shipped to Chatterbox | deployed pipeline, unfixed | 24 000 Hz (label) | **0.000458%** (4.58e-6) |
| **AFTER** -- same diarized window position re-cut fresh from the ORIGINAL 48 kHz source at 24 kHz, `separate` bypassed (`selectionSkipped=true`, `dominantShare=0.9528`) | this session's fix, run locally against real ffmpeg + the real original bytes + real diarize evidence from Postgres | 24 000 Hz (real) | **0.0224%** (2.24e-4) |

**~49x increase**, n=1 window pair, same recording, same diarized position
family, dated 2026-08-27. Cross-checked at native 48 kHz decode directly from
the original MP3 (bypassing this session's code entirely, plain `ffmpeg` +
the same FFT): 0.022% at the fixed window's position, 0.022% at a second,
unrelated position near the start of the file -- confirming the BEFORE
reading is not merely "quiet lecture audio" but a genuine null band: the
owner's own WhatsApp voice note (`first-real-clone`'s subject, band-limited
independently by its own capture path) reads the SAME near-zero fraction
under this metric, so absolute magnitude alone does not distinguish a real
recording from a destroyed one -- see `rejected.md#bandwidth-threshold-first-
guess-was-miscalibrated` for the calibration correction this forced.

**`selectOwnerReferenceWindow`'s own reported score for the AFTER window:
0.8067**, `windowsConsidered: 27`, at `originalStartMs=475488`,
`originalEndMs=485488` -- inside the range WS-U's `reference-window-beats-
the-finetune` measured (0.7433-0.8058) for this same source, marginally above
its prior top end (a different code path, so not claimed as a new ceiling,
just consistent with the measured spread).

### Same-seed, same-text, different-reference output comparison (Q1)

Directly against the real deployed Chatterbox broker
(`AZURE_OPEN_VOICE_ORIGIN`, wake-then-synthesize, no mock), bypassing only
the production provenance ledger's DB bookkeeping (which requires an ACTIVE
runtime capability this replica does not currently have -- unrelated to
reference quality, see `rejected.md#preview-ledger-requires-activation-this-
replica-does-not-have`). Text `"Namaste! Main aapka apna AI version hoon."`,
`languageId="hi"`, style `{exaggeration:0.5, cfgWeight:0.5, temperature:0.8}`
(the panel's own `PANEL_STYLE_KEY="balanced"` values), seed derived by the
real `voicePreviewMatchedSeed` (`replica, genome_version=1, language, text
hash`) -- **identical across every arm: 228992562**.

| arm | reference artifact | reference sha256 (prefix) | output bytes | output sha256 (prefix) |
|---|---|---|---|---|
| A | `3455faac` (BEFORE, band-limited) | `71b2a322b0` | 288 000 | `b4ff277d88` |
| B | `602f569c` (BEFORE, other separated-speaker estimate, same window) | `02ef368b05` | 284 160 | `65219c4f38` |
| AFTER | this session's fixed full-bandwidth window | `bbefc8ed75` | 245 760 | `c7ba0591f8` (repeat run: `55d3eb5779`, same 245 760 length) |

**Every arm produced a different output, in both length and content, with an
identical seed and identical text.** A generator that ignored its reference
would produce byte-identical output regardless of which arm ran; it did not.
This is the direct answer to the coordinator's Q1: **the enrollment
reference DOES condition the model.** The AFTER run was repeated once more
(same reference, same seed) and reproduced the same 245 760-byte length with
a different exact hash (`55d3eb5779` vs `c7ba0591f8`) -- Chatterbox is not
perfectly bit-deterministic run-to-run even at a fixed seed on this GPU
runtime, a real finding worth flagging on its own but orthogonal to Q1 (the
length and gross content still tracked the reference, not the run).

n=1 comparison set (3 references x 1 text/seed, 1 repeat), method as above,
dated 2026-08-27. Clips saved to the scratchpad
(`q1-direct-A.wav`, `q1-direct-B.wav`, `q1-direct-AFTER.wav`) and NOT to the
repo.
