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

## owner-ab-reference-quality-audible

**Date** 2026-08-27. **n = 1 listener (the owner, the subject of the clone),
2 clips, same text, same seed, same replica, only the enrollment reference
differs.** Method: informal A/B, clips delivered directly, owner asked which is
closer to their own voice.

**Result.** The owner reports `q1-direct-AFTER.wav` (full-bandwidth reference,
0.0224% energy at or above 8 kHz) is BETTER than `my-clone.wav` (the broken
8 kHz reference, 0.000458%), and that both are still far from acceptable:
"we obviously need to do way better".

**Why this is recorded despite n=1 and no instrument.** It is the only likeness
judgement that exists for this clone, and it comes from the one listener who
cannot be wrong about whether a voice is theirs. It CONFIRMS the direction of
`reference-bandwidth-was-the-fault` by ear, independently of the FFT. It does
NOT establish how much better, and must not be quoted as a fidelity figure.

**What would supersede it.** A real speaker-embedding cosine similarity for
both arms against the 0.8869 ceiling. That number still does not exist; see
STATE.md's START HERE block for why.

**What it does NOT explain.** The owner's separate complaint that the base
voice is "very western and not indian" survives this fix. Reference quality
cannot account for a model's own accent prior, so that is a distinct cause and
probably a MODEL SELECTION question rather than a pipeline one.

## `two-agent-room-dm-dispatch-local` — two agents persist and recall without crossing (2026-08-27)

**n = 22 deterministic assertions, 4 real dispatches, 8 persisted raw turns.**
Method: `node evals/run.mjs agentroom` redirects only `api/_db.js` at the
module boundary to an in-memory SQL-shaped store, then drives the shipping
`dispatch()` path twice in DM and twice in a room. Both agents share the same
person and the same `(surface, chatKey)`. The fixture seeds two agent-specific
DM facts, two agent-specific room facts and two independent room ids.

Result: 22/22 passed. Each DM compile received only its agent's two facts;
each room compile received only its own room fact; raw DM persistence split
2/2 by agent; room turn/reply persistence split into the two correct
`(agent_id, group_id)` pairs; episode and action writers carried the same
agent; the same surface/chat address resolved to different room ids. Migration
064 parsed as four independently rerunnable statements and both unique indexes
include `agent_id`.

Scope: offline, deterministic, no model, network, filesystem write or live
database. It proves dispatch control flow and query shape, not PostgreSQL types
or migration applicability. The updated `evals/mp/binding.mjs` is the real
Postgres fixture for that second half and was not run in this workstream
because live database writes were explicitly out of scope.

## `large-media-local-evals-2026-08-27`

**Measured 2026-08-27, offline, n = 4 deterministic boundary fixtures.** The
processing-worker suite ran: one two-chunk label-swap fixture preserved the
owner cluster; one no-overlap guest fixture remained a distinct cluster; one
130 second source fanned out as 60 s, 60 s and 30 s chunks with 10 s overlap in
the small test configuration and ended at the exact original 130,000 ms; one
private-storage fixture materialized byte-identical content under mode 0600 and
proved the path absent immediately after the callback. These are contract
measurements, not audio-quality or production-latency measurements.

The enrollment boundary suite additionally executed signed-capability checks:
the TUS descriptor used the direct Storage hostname, a 6 MiB chunk size, the
public anon key, and no value equal to the service-role key; an intentionally
identical public/service key was refused. The targeted processing-worker,
replica-enrollment, replica-processing, and voice-evidence suites passed. No
container was built or deployed and no live database or bucket was mutated.

## `hinglish-script-score-local-2026-08-27`

**Measured 2026-08-27, offline, n = 14 deterministic assertions.** Method:
`node evals/speech/hinglish-script-score.test.mjs` and the registered runner
form `node evals/run.mjs hinglishscore` both executed the same evaluation-only
module. Result: 14/14 passed in both invocations. The fixture proves raw WER
retains a 5/6 Latin-vs-Devanagari mismatch while the reviewed alias arm scores
the equivalent mixed-script sentence at 0 WER; unknown `नमस्ते` stays an error;
`he` is not accepted as `hai`; repeated-token order is charged; Devanagari
combining marks survive; Roman and Devanagari reviewed markers count equally;
ambiguous English `the` is not a Hindi marker; and >8,000-character input fails
by a named bound rather than truncating.

Scope: no TTS, ASR, model, network, database or human listening ran. This
measures evaluator mechanics only, not voice quality, ASR quality,
transliteration accuracy or a production code-switch ratio. `node --check`
passed for the scorer, paid speech probe and first-clone runner; focused
`oxlint` and `git diff --check` also passed.

## `production-long-media-and-agent-isolation-release-2026-08-27`

**Measured 2026-08-27 against production.** ACR build `cu13` produced immutable
worker digest `sha256:192e7372d74617f22b0c77c29bd434d4112f62a7762dacaa951b02e2551a91a1`.
Azure read-back showed that exact digest, `replicaTimeout=3600`,
`PROCESSING_RUN_BUDGET_MS=3300000`, five-minute schedule, and both Sarvam and
voice-evidence secret references still present. Manual execution
`vyakti-replica-processing-963k8dw` ran from 06:32:46Z to 06:33:15Z and
succeeded: n=1 deployed-worker smoke, 29 seconds, no synthetic result.

Vercel production deployment `dpl_H7HER7j3odQ8mDH4m4SYA7YBCkfQ` reached
`READY` and was aliased to `vyakti-replica-lab.vercel.app`. Root, privacy,
delete-account and Studio returned HTTP 200; the unauthenticated replica-source
route returned its expected HTTP 405 to GET. Migration 064 applied four live
statements after the runtime deployment. Real Postgres gates then passed:
relcheck 34/34, room binding 62/62, Telegram handler 101/101, with fixture
teardown reporting zero residue.

The owner's live state read-back was one `ready` source, eight `complete`
processing jobs and VoiceGenome v2 `draft` (created 04:40:35Z). Its selected
reference is one 10,000 ms, 480,044-byte `audio/wav` artifact from
`deepfilternet3-enroll24k-v1` (`input-1-noise-suppressing`), which is exactly
24 kHz mono PCM16 by WAV byte geometry. A direct same-text Hindi synthesis from
that bound artifact first timed out during the scale-to-zero cold start, then
the warm retry returned in 29,547 ms: 263,084-byte 24 kHz mono WAV, PerTh
verified with score 1, RTF 3.216058. n=1 preview; no likeness score and no
human preference claim are inferred from transport success.

## `hindi-cfg-benchmark-contract-local-2026-08-27`

**Measured 2026-08-27, offline.** `node evals/run.mjs earbench` passed 104/104
deterministic assertions. Fourteen focused assertions cover the new conditioning
surface: omitted reference evidence refuses; the pair binds model/reference
fields; requested/effective CFG and both contracts are recorded; preference
language is absent; model or effective-CFG drift refuses; both scripts pass
explicit evidence; and `first-clone.mjs` writes its conditioning manifest. One
of those assertions drives the benchmark-only legacy control through a signed
mock transport and verifies request CFG 0.5, truthful `latin_only` /
`exact_reference` evidence, legacy-contract labelling, model commitment, PerTh
receipt and effective CFG 0.5.

An additional CLI self-test, `node scripts/earbench.mjs selftest --cfg-ab
--items 6`, passed over 18 synthetic stimuli plus one anchor, 18 ABX trials and
3 catch trials. It verified equal on-disk stimulus size, opaque ids, served-tree
separation and disclosure trimming for 12 synthetic-arm clips. `node --check`
also passed for `scripts/earbench.mjs`, `scripts/first-clone.mjs` and
`evals/earbench/cfg-conditioning.mjs`; `git diff --check` reported no whitespace
errors.

Scope: no Azure/Supabase call, GPU, TTS model, database or human listening ran.
The mock and synthetic tones measure benchmark mechanics only. They provide no
voice-quality, accent, similarity or arm-preference result.

## `hindi-conditioning-release-candidate-local-2026-08-27`

**Measured 2026-08-27, local and read-only against live SQL planning.** Open
voice passed 53/53 checks; replica enrollment/storage passed 70/70; replica
processing passed all registered checks; Studio enrollment quality passed 9/9;
voice panel passed 85/85; channel ingestion passed 54/54; voice curriculum,
delivery holdout and preference passed 25/25, 22/22 and 24/24. `npm run build`
completed TypeScript and the production Vite build. A parameterized production
Neon `EXPLAIN (FORMAT JSON)` of the changed atomic preview statement succeeded
without executing its write; an initial PostgreSQL 42703 alias error was found
and corrected by separating candidate and selected CTEs.

The fixtures cover the real processing lineage where transcript evidence has
`artifact_id=NULL`, a source with zero transcript spans remaining `unverified`,
Sarvam's documented automatic-language request, nullable probability and no
invented code-switch claim. The storage suite covers both legacy service-role
JWT headers and new `sb_secret_` API-key-only headers, including raw immutable
object write/read. The production web build was exercised, but no release in
this measurement was deployed.

Scope: no Hindi checkpoint was remotely built or loaded, no GPU synthesis or
cold start ran, and no person listened to a generated clip. These are contract,
SQL-shape and UI/runtime regression measurements, not evidence that accent,
naturalness or owner likeness improved.

## `hindi-voice-production-release-2026-08-27`

**Measured 2026-08-27 against production and an isolated Azure evaluation
origin.** Commit `6f7bff219df1a5b79a47993c5493dd7bcee32d0e` was remotely built in
Azure Container Registry without local Docker. Worker build `cu14` produced
digest `sha256:31dd84744551abb2a6038bdd5005f30ff87411ea3ba76ac147fe1244ae802086`;
manual executions before and after rotating the worker to the new Supabase
secret-key header contract succeeded in 29 s and 27 s. General runtime build
`cu15` produced digest
`sha256:d63717334b5a3c638dc19d4e2d18eb6f1c4fa46535e469347220d1e2b2391178`
and is deployed with `OPEN_VOICE_MODEL_ARM=general`.

Vercel deployment `dpl_BVLNhau69HTj29EbGSQ9UpSE44Uw` reached ready and is
aliased to `vyakti-replica-lab.vercel.app`. The production Supabase service
credential is stored as a hidden Vercel secret. A direct API-key-only read with
the new secret authenticated to the private, non-public replica bucket; no
credential value was logged or committed.

Hindi build `cu16` produced isolated digest
`sha256:0004ec8b90c0ac0c43bd4493762f50c813775d9ebe20856110672de2343228dc`.
The first load failed closed on exactly `tokenizer._mel_filters` and
`tokenizer.window`; the pinned official source declares those two buffers as
reconstructed missing state. Allowing only those exact keys yielded a healthy
separate scale-to-zero app. Its signed cold synthesis returned 24 kHz mono,
11,040 ms output, RTF 2.050181, verified PerTh, output hash and response HMAC in
293.478 s. Both isolated Hindi apps later read back at zero replicas.

A signed cold smoke against the deployed production general arm returned a
24 kHz, 13,800 ms output with RTF 1.642101, verified PerTh, expected immutable
model commitment, output hash and response HMAC in 542.696 s. This is n=1 per
arm and proves transport, model load and synthesis only. It provides no human
listening, owner likeness, accent, Hindi naturalness or comparative quality
result; both cold latencies are unacceptable for an interactive path.

## `azure-blob-platform-and-contract-local-2026-08-27`

**Measured 2026-08-27 against one new Azure resource and deterministic local
contracts.** One dedicated `StorageV2 Standard_LRS` account in Central India
reached `Succeeded`; readback showed HTTPS-only true, TLS 1.2, public blob
access false, one private container, soft deletion false, container soft
deletion false and versioning false. One production-origin CORS preflight
returned 200 with PUT allowed; one hostile-origin preflight returned 403 with
no access-control grant.

The focused Azure storage suite passed 23 deterministic checks after adding
infrastructure coverage. It executes the CRC64-NVME `123456789` check vector,
verifies exact `sr=b`, `sp=c`, `spr=https`, `sv=2026-04-06` capability shape,
provider-specific routing with no fallback, mixed-provider erasure, and
frontend/server protocol agreement. Replica enrollment, source erasure,
voice enrollment and TypeScript checks also passed locally; source erasure
contains 28 checks including a 24-hour, 25-row bounded abandoned-upload sweep.

The production rollout then remotely built worker ACR run `cu17` from commit
`d137607`; it produced immutable digest
`sha256:a40a2c099115fe90c4657c020c45d279c97f3b755d64fe3c97ad6e5bfa9f3f0c`.
The Container Apps Job read back `Succeeded` with that exact digest, a 3,600 s
replica timeout, a 3,300,000 ms run budget and all four Azure locator/key env
bindings. Manual execution `vyakti-replica-processing-g1bppkq` then pulled the
new image and completed successfully in 30 s with no queued source. Vercel
deployment `dpl_F4CVELLPWusvT83bXXKbKsvev7s6` reached READY
and was aliased to `vyakti-replica-lab.vercel.app`.

The first live staged block exposed a test-vector blind spot: the browser
encoded the CRC64 integer big-endian, and Azure returned HTTP 400. The same
one-byte request without a checksum returned 201; the documented little-endian
checksum returned 201. After correcting that wire encoding, a live 54,526,075
byte upload completed in seven deterministic blocks, committed once under an
exact `sp=c`, `sr=b`, `sv=2026-04-06` capability, and read back with the exact
byte count, MIME and ETag. An unsigned read returned 409, commit replay returned
403, a same-SAS path mutation returned 403, and authenticated deletion was
observed as a subsequent 404. The synthetic object was erased in the same run.
The corrected browser encoding then passed the complete 16-check release gate,
and follow-up deployment `dpl_8mGdZm7rWA8U2LcpaFnFXtZPuDJu` reached READY
and replaced the production alias.

Scope: this proves the deployed Azure account, capability shape, >50 MiB block
transport, metadata read and physical erasure. It did not create a consent row,
process a person's voice, or run the eight-stage worker DAG, so it is not yet a
claim that a one- or two-hour source reached `ready`. The account key remains a
temporary service-SAS bridge because the available Contributor principal cannot
grant managed-identity Blob roles.

## `replica-self-test-owner-guard-focused-2026-08-27`

**Measured 2026-08-27, offline and deterministic.** The new
`replicaselftestmode` suite passed 15/15 assertions through the central eval
runner. Its negative controls cover absent env, the legacy single `true` flag,
truthy/case aliases, a wrong environment marker, malformed UUID, cross-owner
UUID, invalid replica ids before SQL, zero database calls on a rejected owner, and a correctly configured but
unowned/non-self replica. Positive contract checks cover the exact allowlisted
owner, all six source/model scopes in the SQL, revocable metadata, the leased
owner at the processing caller, and bootstrap ordering before
`createPendingSource`. The existing replica-review suite passed 35/35, Node
syntax checks passed for all three changed API modules, and oxlint reported no
findings on the changed JavaScript/eval files.

n=15 new guard assertions plus n=35 existing review assertions, one local run
on 2026-08-27. `git diff --check` and `node scripts/context.mjs --check` also
passed before these context entries were appended. A portable Bicep 0.46.1
compiler was then run against the worker template. Its first compile caught a
missing `: []` false branch in the Azure-storage secrets `concat`; after that
syntax defect was corrected, the same template compiled successfully. The full
release runner then passed all 16 checks, including the live relational gates,
in one run. No live source upload, model build or generated voice was used as
evidence by these checks.

The release was then applied to both live planes. Vercel production deployment
`dpl_5j6gAQ8mxs8FsJHLhZq2QGnBoSWy` reached `READY` and the production alias
returned HTTP 200; its served JavaScript contained both exact test-mode copy
and the five source-type guide. A no-credential source request still returned
401 with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Azure ACR
run `cu18` remotely built commit `930c98f` without local Docker and produced
immutable worker digest
`sha256:51663ce8782d5a998d4ccb66cb92d2a12ec123e5a9e6a06698483e337d9200a8`.
The Container Apps Job read back `Succeeded` with that exact digest, all three
owner guards exact, every required processing/storage/provider env name still
present, a 3,600 s replica timeout, a 3,300,000 ms run budget and its existing
five-minute schedule. Scheduled execution `vyakti-replica-processing-29797260`
then pulled the new digest and succeeded. This is deployment and image-pull
evidence, not a claim that the owner's 1 h 44 m source has been uploaded or
finished; that live end-to-end result still requires the owner to retry it.

## `azure-mp3-mime-mismatch-live-2026-08-27`

**Measured 2026-08-27, production plus focused local regression.** One live
source row declared `audio/mpeg`, 32,908,934 bytes and ended `rejected` with
`mime_mismatch`. An authenticated HEAD of its exact Azure Blob locator returned
the same 32,908,934 bytes and `BlockBlob`, but `Content-Type: video/mpeg`.
Therefore byte transport succeeded and the MIME property alone caused the
rejection. The source owner differed from the then-configured internal-test
allowlist, which is separately relevant to ceremony bypass but not to this
storage verdict.

After replacing raw `File.type` with signed-capability `contentType`, the
focused Azure suite passed 25 checks, including an explicit negative control
that rejects `file.type` as commit authority. Replica enrollment, TypeScript,
targeted lint, whitespace and the Impeccable detector also passed locally.
Production Neon accepted `EXPLAIN (FORMAT JSON)` for the exact new
owner/replica/source lookup shape with all returned source columns.
This entry does not claim the requested 262,879,879-byte lecture has completed
upload or processing; that end-to-end run follows deployment.

## `long-lecture-integrity-to-clamav-live-2026-08-27`

**Measured 2026-08-27, production source plus focused local regression.** The
requested 262,879,879-byte, 1:49:31 MP3 uploaded through the production browser
in about 47 seconds from source creation to verified quarantine. Source and
Azure both read `audio/mpeg` and 262,879,879 bytes, with no rejection. The first
worker execution completed `integrity` on attempt 1, then placed
`malware_scan` in retry on attempt 1 with `clamav_daemon_unavailable` about four
seconds later.

Inspection proved the run's initial pending-work test started ClamAV only when
`malware_scan` already existed, while its four-job loop could create and lease
that step after completing `integrity`. After making both steps scanner-start
triggers, the processing-worker suite passed 28/28 checks, syntax, targeted
lint and whitespace checks. This is not yet the completed eight-stage result;
the immutable worker rebuild and live retry remain required.

## `long-lecture-diarize-adapter-contract-live-2026-08-27`

**Measured 2026-08-27, production source plus focused local regression.** The
same lecture's second scan attempt completed, media probing completed on attempt
1, and diarization then failed on attempt 1 with
`invalid_processing_adapter`. Source inspection isolated the invalid value to
the chunk wrapper version's `+` character; all other adapter facts and the
method were present.

After changing the suffix to the contract-safe hyphen form, the processing
worker suite passed 29/29 checks, including a direct `assertAdapter` call, and
the complete replica-processing suite passed. Targeted lint and whitespace
checks passed. A cached remote build without this second fix completed as
`cu19` but was not deployed. A new immutable build and one scoped retry of the
failed diarize row remain required before this is an end-to-end result.

## `clamav-child-kept-finished-job-running-live-2026-08-27`

**Measured 2026-08-27, live Azure execution plus focused local regression.**
Execution `vyakti-replica-processing-29797310` started at 13:50 UTC and still
reported `Running` after the source's scan, probe and failed diarize work had
settled, while the 13:55, 14:00 and 14:05 scheduled executions each reached
`Succeeded`. Source inspection showed no outstanding lease from that run.

The worker now retains the Clam child and terminates it in `finally`. The
processing-worker suite passed 30/30 checks, including the startup precursor,
adapter-contract and child-lifecycle regressions; syntax, targeted lint and
whitespace checks passed. The old running execution still needs an operator
stop and the revised immutable image still needs deployment and a measured
prompt exit.

## `long-lecture-generic-diarize-failure-live-2026-08-27`

**Measured 2026-08-27, production exact-source retry.** The immutable worker
digest containing the safe adapter suffix retried the requested 262,879,879
byte, 1:49:31 MP3. It loaded the queued diarization job and failed in about
eight seconds of container runtime with `processing_worker_error`; no GPU
service console record was emitted. This proves the former adapter identifier
defect was removed, but exposes a second deterministic error before a durable
speaker segment exists.

The focused worker suite now has 32 passing checks after adding a bounded
diagnostic seam. A safe TypeError retains its type, message and repository
frame; a URL-bearing negative control is redacted. This measurement is not an
eight-stage pass and does not make a voice-quality claim.

## `long-lecture-composed-diarize-root-cause-live-2026-08-27`

**Measured 2026-08-27, production diagnostic retry plus focused regression.**
The diagnostic image reproduced the exact source failure and emitted only:
TypeError, safe message `evidence.value.diarize is not a function`, and the
repository frame `api/_replica-processing/composition.js:192:37`. The source
never reached the GPU service because composition called the adapter object
instead of its `diarize` method.

After extracting the production composition helper and dispatching through the
method, the processing-worker suite passed 33 checks. The new executable check
creates the same adapter-object shape, normalizes one chunk, and proves exactly
one method invocation and one returned speaker segment. The complete
replica-processing suite also passed. Live eight-stage proof remains pending
the corrected immutable image.

## `long-lecture-sarvam-stream-upload-400-live-2026-08-27`

**Measured 2026-08-27, production exact source.** The corrected worker completed
diarization at 14:33:58Z, selected and persisted the reference-window/separation
result at 14:34:07Z, and completed enhancement at 14:34:10Z. Sarvam transcription
then entered retry with `asr_sarvam_upload_http_400` at 14:34:14Z, before a batch
job could start. Six of eight stages are durable; the source remains processing.

The production path uses a Node file stream for the 262,879,879-byte MP3. After
binding its verified byte count as `Content-Length` and choosing `.mp3` from
`audio/mpeg`, the full replica-processing suite passes, including an executable
Readable-stream fixture that asserts length, MIME, extension and `duplex: half`.
The 33-check worker suite also passes. Live retry remains required.

## `long-lecture-eight-stage-draft-live-2026-08-27`

**Measured 2026-08-27, one exact production source.** The 262,879,879-byte
(250.7 MiB), 1:49:31 MP3 uploaded in about 47 seconds with matching
`audio/mpeg` metadata and completed all eight processing stages. The durable
result contains 1 media probe, 1,683 speaker segments, 288 transcript spans,
288 language spans, 4 voice embeddings, 1 voice measurement and 1 quality
measurement. The transcript evidence contains 72,921 Devanagari characters
and 555 Latin characters.

After selecting the 10-second, 24 kHz identity-preserving WAV, the bounded
build completed on attempt 1 in 21 seconds and produced VoiceGenome v1 as a
draft with 1,683 target segments and one enrollment artifact. The focused
self-test, review, model-build, open-voice, voice-panel and SQL-cast gates pass.
The private preview reached the real GPU wake corridor; no perceptual result is
claimed until protected audio exists and a human listens.

## `long-lecture-preview-warmup-window-live-2026-08-27`

**Measured 2026-08-27, one live draft and focused deterministic regression.**
The private preview authorized the exact selected reference and dispatched a
GPU wake. Six automatic retries produced one `voice_preview_wake_dispatched`
followed by five `voice_preview_wake_in_flight` rows, then the browser stopped
at roughly 180 seconds with no sealed generation while Azure reported the
active revision healthy with one replica.

The first correction to seven polls was disproved by one live production run.
The first synthesis dispatched after the cold broker at 15:25:36; requests
continued to receive `voice_preview_wake_in_flight` through 15:29:14. Poll seven
at 15:29:46 crossed the 200-second window and dispatched the necessary second
synthesis against the now-warm runtime, but the client stopped on that same
warming response because `attempt >= 7`. No protected generation reached the
browser in that run.

The corrected focused suite passes 95/95 checks. Its asynchronous control proves
a provider result arriving after the flush changes the runtime hint from
warming to warm, while protection calls remain zero and the discarded
generation stays failed. Its client timeline now permits ten polls over 300
seconds: poll seven can dispatch the second synthesis, a 60-second conservative
settle window can elapse, and poll ten can start a fresh protected request. The
server and client copy now report 2 to 5 minutes.

Production deployment `dpl_A4DWpWNZLmbBS5jdWmSN1ovQYN5R` reached `READY` and
the same-click browser trace then completed in about 4 minutes 50 seconds. The
Studio panel showed a playable `0:00 / 0:08` protected result with receipt
prefix `50e1882e`. The downloaded object is a valid 389,804-byte RIFF/WAVE:
PCM 16-bit, mono, 24 kHz, 8.12 seconds, peak -0.67 dBFS, RMS -19.32 dBFS and
zero clipped samples. This proves upload-to-protected-playback control flow and
signal validity only. No likeness, Hindi accent or human-naturalness claim is
made until the owner listens blindly.

## `voice-bakeoff-plan-local-2026-08-28`

**Measured 2026-08-28, local planner plus one official retail-price query.**
`node evals/voice-bakeoff/plan.mjs` passed over 24 exact prompts, six
meaning-matched Hindi/Hinglish script groups, three fixed seeds and nine model
arms. It validates unique ids, matched Devanagari/Latin/mixed treatments,
same-reference fail-closed policy and its own price arithmetic. No synthesis,
provider call, model load, deployment or purchase ran.

The Azure Retail Prices API returned Central India Container Apps list meters
of USD 0.000102 per T4-second, USD 0.000024 per active vCPU-second and USD
0.000003 per active GiB-second. At the deployed 8-vCPU, 56-GiB allocation the
derived fully active retail rate is USD 1.6632 per hour before contract
discounts or monthly CPU/memory grants. The pre-registered nine-arm bake-off
estimate is USD 25.98 plus INR 22.56 with a USD 35 stop. The adapter phase has a
USD 100 stop; measured-time linear projections are USD 1.88 for one 30-minute
corpus run and USD 3.76 for one 60-minute run. The 116-T4-hour Hindi adaptation
plan estimates USD 192.93 and has a USD 250 stop. These are cost-plan outputs,
not bills or quality results.

## `hindi-text-frontend-local-2026-08-28`

**Measured 2026-08-28, local deterministic and mocked-boundary execution.**
`node evals/run.mjs hinditextfrontend` passed 14 checks. Its exact fixture is
the current Studio default, 90 input characters: `Namaste! Main aapka apna AI
version hoon. Aaj kya padhna hai, physics, chemistry ya maths?`. The output is
one Hindi synthesis segment with a fixed Hindi disclosure and reviewed
Devanagari renderings for every Roman-Hindi or classroom-borrowing token. A
mixed unknown-English fixture produces the ordered language sequence
`hi,en,hi`; an English `he` negative control remains distinct from Hindi
`hai`; all transformations point to exact UTF-16 input slices; an alternating
17-plus-segment fixture refuses; and a Hindi-only model refuses unresolved
English.

The signed-provider suite passed 59 checks and executes the actual provider
segment loop against HMAC-signed mock runtime responses. It verifies localized
disclosure binding, per-segment language and text hashes, sequential PCM joined
with a declared 60 ms zero gap, model/reference/adapter commitments and PerTh evidence. The
voice-panel suite passed 95 checks, production-protection passed 44, the full
web build passed, and `node scripts/verify-release.mjs` passed all 16 release
checks including the 253,858 ms full eval suite and both relational database
gates. Python runtime sources compiled. No GPU synthesis, deployment, human
listen, pronunciation score, identity score or quality win was measured by
this workstream.

## `chatterbox-matched-blind-pack-live-2026-08-28`

**Measured 2026-08-28, five new Azure syntheses plus one existing rejected
control.** Six protected, opaque 24 kHz mono WAVs were prepared from the same
selected reference and seed. The five new calls passed response HMAC,
model/reference/CFG bindings and PerTh verification at 1.0. General Devanagari
CFG 0.5 measured 7.68 seconds and RTF 2.481; general CFG 0 measured 10.80 seconds
and RTF 0.781; Hindi-pack CFG 0.5 measured 8.88 seconds and RTF 2.287;
Hindi-pack CFG 0 measured 9.88 seconds and RTF 0.824; general English measured
6.80 seconds and RTF 0.833. The Hindi pack refused the English request without
a provider call.

Log-measured active windows were 876.23 GPU-seconds for general, 574.99 for
Hindi and 1,514.07 broker-seconds. At the recorded Azure retail meters the
conservative list-price estimate is USD 0.6818. Cost Management had not ingested
the run, so this is not a billing read. All four applications returned to zero
replicas. Arm identities remain sealed pending owner ratings; no sound-quality
winner is claimed.

## `indicf5-candidate-local-2026-08-28`

**Measured 2026-08-28, local contract, credentialed access preflight and two
failed remote-build controls.** The isolated IndicF5 suite passed 16 of 16
checks over immutable source/model/vocoder pins, offline loading, BuildKit token
handling, a dependency-resolver compatibility assertion, signed Hindi-only
requests, content-addressed reference audio and transcript, consent receipt
binding, post-synthesis PerTh verification, private scale-to-zero
infrastructure, expiry and a USD 40 parameter ceiling. Python sources compiled
and diff checks passed. Credentialed access to pinned revision
`ba85abedf18dc479a447eaa0eccbd76ab78a47d5` succeeded; a secret-pattern scan of
the worktree found no persisted Hugging Face token.

Remote ACR run `cu1j` failed after about two seconds because the task declared
a top-level secret without a Key Vault source. Run `cu1k` failed after about
157 seconds because `huggingface-hub==0.29.3` conflicted with
`cached-path==1.6.7`, which requires a version below 0.28. Both shapes now have
executable negative controls; the corrected run `cu1n` was still building when
this measurement was written. No IndicF5 image was deployed and no GPU ran.

## `first-clone-failure-path-local-2026-08-28`

**Measured 2026-08-28, one deterministic missing-reference control.** The
first-clone process exited 1, printed the failed probe, retained `FIDELITY not
measured in this run`, and emitted no ReferenceError. The complete earbench
mechanical suite passed 108 checks after adding this negative control. This is
diagnostic reliability only and is not clone-quality evidence.

## `voice-frontier-plan-local-2026-08-28`

**Measured 2026-08-28, primary-source plan validation only.** The centrally
wired `voicefrontier` suite passed 88 checks over five immutable model pins,
five exact parameter/repository-size records, three compute profiles, four
commercial anchors, five budget stages, 24 frozen prompts and three seeds per
prompt. The ranked build order is VoxCPM2, MOSS-TTS Local v1.5 and ZONOS2.
Official checkpoint metadata and repositories were read at their named pins;
upstream peak VRAM is published only for VoxCPM2 at approximately 8 GB. The
24 GB MOSS and ZONOS allocations are qualification ceilings, not measured fit
claims. Azure retail planning inputs were USD 1.6632/hour for the recorded
Container Apps T4 allocation, USD 4.48/hour for Central India A10 and USD
20.569/hour for Central India A100. Expected staged compute is USD 640 and all
hard stops sum to the owner-approved USD 1,000. No model ran, no listener rated
audio, no deployment changed and no money was spent.

## `openvoice-converter-candidate-local-2026-08-28`

**Measured 2026-08-28, local deterministic contract execution plus one public
access preflight.** `node evals/run.mjs openvoiceconverter` passed 18 of 18
checks over immutable OpenVoice source and official V2 model pins, startup file
rehashing, runtime-offline loading, signed transport, owner and consent
predicates, spoken disclosure, content-addressed base and reference audio,
conversion and PerTh receipt binding, cold-start re-signing, remote-build-only
definitions, private scale-to-zero GPU infrastructure, expiry and a USD 40
parameter ceiling. Four Python sources compiled. The official pinned checkpoint
answered the zero-byte HEAD preflight and the 838-byte config matched its fixed
SHA-256.

No image was built, no model was loaded, no GPU or vendor synthesis ran, no
Azure resource was deployed and Azure spend was USD 0. Bicep compilation was
not run because neither Azure CLI nor a standalone Bicep compiler is installed
in this workspace. No pronunciation, naturalness, speaker similarity, latency,
PerTh robustness after delivery protection or human preference was measured.

## `voice-eval-security-anchor-live-2026-08-28`

**Measured 2026-08-28, two ARM deployments plus live control-plane readback.**
The first deployment failed before creating a usable vault because Azure
rejects an explicit `enablePurgeProtection: false`. The corrected deployment
`voice-eval-security-20260828-r2` reached `Succeeded`. Live readback found one
dedicated identity, one matching vault access policy, secret permissions exactly
`get`, and zero key, certificate or storage permissions. The versioned
`transport-hmac` secret URI was present as a deployment output; the secret value
was neither output nor readable by the deployment service principal. The vault
and identity expire on 2026-09-01 and are tagged evaluation-only.

The standalone security suite passed 8 of 8 checks and both Bicep templates
compiled with Azure Bicep 0.46.1. This proves resource shape and deployment, not
that any candidate runtime has successfully fetched the secret; every candidate
must still pass its own identity/secretRef/startup readback.

## `moss-v1-5-candidate-local-2026-08-28`

**Measured 2026-08-28, local contract execution plus public access and size
preflight.** `node evals/run.mjs moss_tts` passed 22 of 22 checks over exact
model, codec, source and CUDA-base pins; four large-weight byte and SHA-256
commitments; offline runtime loading; signed Hindi, mixed Hinglish and English
requests; verified owner versus non-releasable third-party scopes; upstream
language tags and decoding controls; 48 kHz stereo downmix to matched 24 kHz
mono; post-synthesis PerTh verification; private A10 infrastructure; secret-file
transport; expiry; and USD 25 plus four-hour rails. Three Python sources
compiled. Bicep 0.46.1 compiled the remote-only template successfully.

One network preflight read the exact Hugging Face and GitHub metadata and the
pinned Docker Registry manifest. The public ungated model repository measured
9,116,898,371 bytes; its public codec measured 8,498,219,165 bytes; the pinned
CUDA base measured 4,448,715,237 compressed bytes. With a 4 GiB dependency
reserve, the conservative compressed-image ceiling is 26,358,800,069 bytes,
below the pre-registered 30 GiB stop. All four large-file linked hashes and the
verified source commit matched.

No ACR build, VM, GPU, model load, synthesis or deployment ran. Azure spend was
USD 0 and there is no run id. The runtime deliberately rejects a GPU below 22
GiB, so the existing 16 GiB T4 was not used. No VRAM-fit, latency, pronunciation,
naturalness, speaker similarity, watermark robustness after browser delivery or
human preference result exists.

## `voxcpm2-candidate-remote-2026-08-28`

**Measured 2026-08-28, one local contract suite, one exact ARM validation, four
remote build attempts, one isolated deployment and three owner-bound
syntheses.** The centrally wired VoxCPM2 suite passed 22 of 22 checks over immutable public
source and weight pins, Apache-2.0 provenance, runtime-offline loading,
Devanagari Hindi and localized disclosure, owner-self versus non-releasable
third-party stress scopes, content-addressed source/window/transcript fields,
post-synthesis PerTh detection, explicit 48 to 24 kHz delivery conversion,
signed response provenance, private scale-to-zero GPU infrastructure, a USD 75
ceiling, non-root runtime and avoidance of a duplicate recursive ownership
layer. Three Python sources compiled and Bicep compiled. ARM deployment
validation passed with the exact shared user-assigned identity and exact
versioned Key Vault URI; no real registry password or HMAC value was used by
that validation.

The verified owner source is 70.997 s, 24 kHz mono PCM16, SHA-256
`c242261b9caa779eb6ddeeda24623c11c2aec01f8f7acafe47970bc17a1cb9b6`.
Its measured-best existing 25 through 35 s window is exactly 10.000 s, has RMS
0.038094 and peak 0.269470, and the canonical 480,044-byte window WAV hashes to
`264597691155e7f3bcaca85cc497246a340ab3f48acd2eb263d4d3d7b8da067c`.
The stored ASR has only coarse spans and no word times, so no exact transcript
was claimed or fabricated.

ACR run `cu1p` failed after 193.558 s before image creation because setuptools
75.8 rejected the upstream PEP 639 SPDX license string. The corrected pin is
80.9.0. Run `cu1q` succeeded in 830.032 s at digest
`sha256:7e138843369e98343203d32976c5a937107dbed34e6db3320225a9870c732e09`,
but recursive `chown` made its compressed image 11,592,564,532 bytes.
Optimized run `cu1r` retained UID 10009 without that layer and succeeded in
500.669 s at digest
`sha256:40df335c38bf98b2eee6bf496c2f7ac9285c6bd572014abc7d7662134436f697`,
7,660,847,810 bytes. Including canceled `cu1m`, the four lane runs consumed
3,299.526 vCPU-seconds. The Central India retail meter is USD 0 through the
registry's daily 6,000-vCPU-second tier and USD 0.0001 per later vCPU-second;
because other workstreams share the registry, the conservative all-overage
upper bound for this lane is USD 0.329953 rather than a claimed bill.

The first ARM create correctly provisioned the private runtime but failed the
public gate because a stale supplied broker digest did not exist. Registry and
live production readback agreed on the replacement immutable broker digest
`sha256:3229c6479f83a0864faa0a2f81d43402b115341bbac318209d5b97c8463ceeb1`.
The corrected idempotent deployment succeeded. Readback found both isolated
apps on the shared user-assigned identity and exact versioned Key Vault secret,
with production routing disabled and min 0, max 1; the runtime is private and
the HMAC broker is public. No existing production image or route changed.

Three signed owner-self requests produced opaque Hindi, Hinglish and English
clips of 7,360, 6,720 and 7,520 ms. Model elapsed times were 29,034, 14,557 and
15,930 ms, real-time factors 3.944837, 2.166220 and 2.118351. Every receipt
bound the exact model, source, 25 through 35 s reference window, consent, text,
localized disclosure and 48 to 24 kHz conversion; response HMAC and PerTh
verified, with PerTh score 1.0 on all three.

The independent ECAPA-TDNN identity gate measured mean 0.766255 and p10/worst
0.756532 over n=3 candidate clips against n=4 owner windows, dimension 192.
The provisional policy returned `warn` for `below_warn_band`; target is 0.85.
This is below the prior Chatterbox selected-window mean 0.805756, but the text,
languages and model differ, and ECAPA does not measure accent, pronunciation or
humanness. The VoxCPM2 T4 replica was active from 20:03:45Z until KEDA
deactivation at 20:16:15.680Z, 750.680 s. At the recorded USD 1.6632/hour T4
meter, its conservative list-price estimate is USD 0.346814. Both VoxCPM2 apps
were observed back at zero replicas. Human listening is not started; no quality
winner, production readiness or deployment recommendation is claimed.

The shared voice-evidence T4 replica used for the identity check was active
from 20:13:36Z until 20:22:30.192Z, 534.192 s, then KEDA returned it to zero.
At the same recorded T4 meter that is USD 0.246797. Treating every ACR second
as overage gives a deliberately conservative lane upper estimate of USD
0.923564 for ACR plus both GPU windows, before sub-cent CPU broker activity.
The lower retail-tier estimate is USD 0.593611 because the first 6,000 shared
ACR vCPU-seconds are USD 0. Cost Management had not ingested the run, so neither
is represented as the eventual invoice amount. At final readback the VoxCPM2
runtime and gate were empty and the evidence replica was `NotRunning`.

## `qwen3-tts-english-candidate-live-2026-08-28`

**Measured 2026-08-28, one remote build, one isolated deployment and six
owner-bound English synthesis requests.** The focused suite passed 21 of 21
checks over exact official source and model pins, offline loading, English-only
refusal, active self-owner consent, signed replay-resistant transport, spoken
disclosure request enforcement, final PerTh detection, complete returned
provenance, Key Vault secret references, private scale-to-zero GPU shape,
evaluation expiry and the USD 60 lane ceiling. All Python sources compiled,
Bicep compiled with Azure CLI 2.89.1, and the context graph passed after this
entry was added.

Remote ACR run `cu1h` succeeded from 2026-08-27 19:28:47Z through 19:43:24Z,
14 minutes 37 seconds, and produced immutable image
`vyaktivoiceacr.azurecr.io/vyakti/qwen3-tts-en-eval@sha256:e6ee1143498b495c76d99e5748452a8bc3cf942a8ae1f9268559a919ad26a988`.
The event stream measured a pulled image size of 11,002,707,968 bytes. Live
readback found `vyakti-qwen3-tts-en-eval` private and
`vyakti-qwen3-tts-en-gate` public, both min 0, max 1, on the exact shared
user-assigned identity and exact versioned Key Vault secret reference. The
broker health endpoint returned HTTP 200. No local Docker command or Docker
Desktop was used.

The verified owner source hash was
`c242261b9caa779eb6ddeeda24623c11c2aec01f8f7acafe47970bc17a1cb9b6`.
The deterministic max-RMS selector chose offset 0 for 12,000 ms at 24 kHz; the
window hash was
`8f3b4182178bb84e673266ceffbba83567a8bc34c4eac459365c375fadc69d46`.
Azure Speech supplied only an unreviewed ASR hypothesis, committed by hash and
never described as exact. Six of six signed requests succeeded and produced
50,960 ms of blinded audio. Reported model elapsed time totaled 110,992 ms;
mean real-time factor was 2.2082, range 1.9429 through 3.5231. All six returned
`perth_watermark_verified: true` with score 1.0 and passed output hash binding.
The disclosure text was enforced on every request, but whether it is audibly
spoken remains pending listener verification. Human listening is `not_started`;
no pronunciation, naturalness, speaker-similarity or quality win is claimed,
and production routing was not changed.

The GPU replica began at 2026-08-27 19:55:11Z and KEDA deactivated it at
20:08:30Z; the measured allocation wall was 799 seconds. At the pre-registered
Central India allocation rate of USD 1.6632/hour, that is a USD 0.3691 GPU
estimate. The CPU gate deactivated at 20:08:18Z, and live replica readback then
showed both replicas `NotRunning`. Azure Cost Management returned HTTP 429 and
had not supplied ingested GPU, CPU-gate or ACR-task line items, so USD 0.3691 is
explicitly an estimate rather than an exact bill. The 14-minute 37-second ACR
build and small broker charge remain pending provider reconciliation. The lane
is at zero compute and remains below its USD 60 hard ceiling.

## `indicf5-first-live-startup-and-offline-vocoder-fix-2026-08-28`

**Measured 2026-08-28, one isolated Azure revision and one focused local
regression suite.** The first live IndicF5 revision scheduled after T4 quota
became available, pulled the 6,603,931,648-byte image in 72.74 seconds, then
failed before health readiness. Its console trace showed the gated model
calling the upstream Vocos loader with `is_local=False`; that loader attempted
to resolve `charactr/vocos-mel-24khz/config.yaml` while `HF_HUB_OFFLINE=1` and
raised `LocalEntryNotFoundError`. No synthesis completed and no perceptual
quality result exists. The exact revision was deactivated; replica readback
then reported `NotRunning`.

The corrected local contract suite passed 26 of 26 checks. Its executable
negative control calls the wrapper with a remote path and cache, then proves
the upstream loader receives only `is_local=True`, the resolved baked path and
no Hub cache; an unexpected vocoder name fails closed. Python compilation and
the focused diff check passed. No corrected ACR build, model load, GPU
synthesis or human listening had run when this measurement was recorded.

## `owner-meet-preview-responsive-local-2026-08-28`

**Measured 2026-08-28, n=2 viewport classes and n=3 reachable UI states.** The
real signed-in Studio layout fixture was run with the exact two-variable owner
self-test guard and the real `VoicePreviewPanel`. At 1440 by 1000 and 390 by
844 CSS pixels, the idle composer, 202 warm-up and protected-result states were
inspected in the in-app browser. At the 390-pixel viewport the document
measured 375 client pixels and 375 scroll pixels, so horizontal overflow was
zero. Hindi, Hinglish and English controls each measured about 87.66 by 44 CSS
pixels. The result correction action moved focus to textarea
`hear-voice-text`; the browser console reported zero errors or warnings on the
final mobile pass.

The focused `voicepreviewui` suite passed 9 of 9 checks, including eight
executable negative controls for language loss, a wrong runtime binding,
pointer-only activation, fake progress, a missing correction path, weakened
receipt verification, returned self-test ceremony and missing mobile layout.
TypeScript, focused lint and the production build passed. The build retained
the existing Vite large-chunk warning. The Impeccable detector reported seven
pre-existing global stylesheet warnings outside this panel and no finding in
the new Meet rules. No model quality, speaker similarity, pronunciation win or
production deployment was measured.

## `layout-root-portability-windows-2026-08-28`

**Measured 2026-08-28, n=2 real gate executions plus one executable path
negative control on Windows.** Before the fix, the workspace had both `dist/`
and `dist/studio-layout-fixture.html`, but `node scripts/check-layout.mjs`
printed `dist/ absent` and exited zero. The raw file URL pathname was
`/C:/Users/raghav.s/Desktop/build/Vyakti-platform/`; resolving it produced
`C:\C:\Users\raghav.s\Desktop\build\Vyakti-platform`.

After replacing raw pathname resolution with `fileURLToPath`, the same command
advanced through both dist checks and stopped only at the independently honest
`no chromium binary available` capability skip. `node --check` passed. The
always-run synthetic Windows fixture measured the rejected shape as
`C:\C:\repo` and the supported conversion as `C:\repo\`, so this failure can
be caught on Linux CI as well as Windows. No browser layout dimensions or
readability verdict were measured in this focused run.

One full `node scripts/verify-release.mjs` run then passed the layout gate and
14 other gates but finished 15 of 16 overall. The eval suite reported that
`api/_engine.gen.js` became stale even though the earlier engine-freshness gate
had passed in the same run; concurrent work was still changing the shared tree.
No engine source or generated bundle was changed by this portability fix, and
the unrelated eval failure is not represented as a clean release result.

## `indicf5-second-offline-startup-and-local-asset-fix-2026-08-28`

**Measured 2026-08-28, one corrected immutable image, one isolated Azure
startup and one focused local suite.** ACR run `cu1s` completed in 183.17
seconds and produced digest
`sha256:1d5f15d6d3a6b2fe6624a3a1d9f8348ceb8d6d7d8dacb4fc9ae477478ed0aa55`.
The image was 6,654,263,296 bytes at Azure pull. It cleared the prior Vocos
lookup, then exited before readiness when the gated model called
`hf_hub_download('/models/indicf5', filename='checkpoints/vocab.txt')` and Hub
validation rejected the local path as a repository id. No synthesis completed
and no quality result exists. The request was stopped and all IndicF5 runtime
revisions were deactivated; replica readback was empty.

The expanded local suite passed 30 of 30 checks. Executable controls prove the
exact local vocabulary path is returned for the two allowed model identifiers
and that an alternate repository or filename raises
`indicf5_runtime_hub_access_denied`. Vocos remains local-only, the repair uses
no token or network fetch, all Python files compile, and the qualification
script parses. A second no-token remote repair build `cu1t` was running when
this measurement was written.

## `zonos2-candidate-preflight-local-2026-08-28`

**Measured 2026-08-28, n=2 public model repositories, n=1 official source
commit, n=1 DAC release and one focused executable suite.** The exact ZONOS2
repository contained 15,351,094,251 bytes; `model.pth` was 15,336,390,655 bytes
with LFS SHA-256
`5f6aa0fff9036ee44ccbc625d40aa6bdd8ea223480a5447e9f6aad70c38b6ecd`.
The exact public speaker repository contained 24,043,365 bytes; its 24,010,000
byte weight SHA-256 was
`df60a638e7f4a29331c0af2bd2984ee5b992fee9d5923c776f7e4bdc3dedea48`.
The 306,717,287 byte official DAC 0.0.1 asset was downloaded once for hashing
and measured SHA-256
`a88eed82a7024ccc1facdb1e605c4c2f99281c8118c22c9895ffa846d8fb61aa`.
Hugging Face metadata reported Apache-2.0 for both model repositories; the
official source and DAC are MIT. The exact source commit exists but is unsigned,
which is recorded rather than promoted to verified-signature evidence.

The pinned PyTorch base compressed layers measured 4,448,715,237 bytes through
the Docker Registry manifest. Source inspection then proved the official
runtime JIT-compiles CUDA and NCCL kernels. NVIDIA package
`cuda-nvcc-12-8=12.8.93-1` measured 36,043,452 compressed bytes. Its official
4,332 byte repository keyring measured SHA-256
`d93190d50b98ad4699ff40f4f7af50f16a76dac3bb8da1eaaf366d47898ff8df`.
Model,
speaker, DAC, base, compiler and a 7 GiB dependency reserve produced a
conservative compressed ceiling of 27,682,810,692 bytes,
below the pre-registered 30 GiB build stop. The focused suite passed 27 of 27
checks before the compiler discovery, 28 of 28 after the fail-closed
compiler/linker gate and 29 of 29 after the bounded executable JIT cache and
non-root secret-mount controls, including executable Hindi, Hinglish, English, owner/third-party and
bad-HMAC controls. All three Python sources compiled, Bicep compiled with the
portable Azure CLI and the access/license/size preflight passed. No Docker or
Docker Desktop command ran locally.

ACR run `cu1w` used the compiler-less runtime base and was cancelled before
dependency installation or any image push. Run `cu1y` then proved that base
does not configure NVIDIA's apt repository and failed before installing CUDA.
Run `cu20` completed all 16 Dockerfile steps, then its separate push step hit
ACR's implicit 600-second timeout while the single 15.3 GB checkpoint layer was
still uploading. Smaller layers reached the registry, but no manifest or
deployable image digest was created.
No A10 allocation, model load, synthesis, GPU peak,
latency, pronunciation, naturalness, speaker similarity or human listening was
measured in this phase. GPU spend for this phase was USD 0; ACR task cost was
not available from the run API at measurement time.

The repository-wide release runner passed 15 of 16 gates. Its only failure was
the shared eval suite reporting `api/_engine.gen.js` stale while concurrent
engine work was active; typecheck, prompt/workflow/motion, board/layout/copy,
sample-rate/bandwidth, engine freshness at the earlier static check, stuck-turn,
one-voice, web build, zero-orphan and citation gates passed. This is not
reported as a clean release and the shared generated bundle was not overwritten
from the isolated ZONOS2 lane.

## `zonos2-cu24-manifest-layer-audit-2026-08-28`

**Measured 2026-08-28, n=1 immutable ACR image manifest with 14 compressed
layers.** Remote ACR run `cu24` completed both build and push. The resulting
digest was
`sha256:e4bd14a4e2171d99778fadb36ef1855ef9626b62b501ce877afe7abcd6f0cfcc`
and ACR reported an image size of 42,449,801,367 bytes, or 39.53 GiB. This
exceeded the pre-registered 30 GiB stop by 10,237,546,647 bytes, or 9.53 GiB,
so no VM or A10 was created.

Manifest inspection attributed 18,805,403,267 compressed bytes to the final
recursive ownership-change layer. The preceding model-asset layer measured
12,478,139,651 bytes, the Python dependency layer 6,336,213,829 bytes and the
pinned base layers 4,448,715,237 bytes. Removing only the recursive `chown -R`
layer projects 23,644,398,100 bytes, or 22.02 GiB, without changing the pinned
model, source, speaker encoder, DAC, compiler, Python lock or non-root runtime.
This projection authorizes one bounded remote rebuild, not a GPU allocation or
a size claim about the rebuilt image.

The bounded optimized run `cu26` then completed with immutable digest
`sha256:7d1f97efffe35e23a356a12494e0333cdfb586c5a1dfcd8f06165a27abdb301b`.
ACR reported 23,644,395,155 bytes, or 22.0206 GiB, which is 7.9794 GiB below
the 30 GiB stop and 2,945 bytes below the layer-subtraction projection. The
image-size gate therefore passed. This still did not establish A10 fit, model
load, synthesis, latency, pronunciation, naturalness, speaker likeness or
human preference. No VM or GPU had been created when this measurement was
updated.

The post-image focused suite passed 30 of 30 checks; source syntax, Bicep and
the context graph also passed. ARM deployment validation then measured the
Southeast Asia `LowPriorityCores` limit at 3, current use at 0 and the full A10
requirement at 36. Validation failed before resource creation. A single Quota
API request asked for 40 low-priority cores and failed before request creation
with HTTP 429 `RequestThrottled`, correlation
`ce6a18f6-c22c-4eff-987e-34f9fa2f24d8`, and a 3,600-second retry-after from
2026-08-27T23:00:41Z. The quota request-status collection remained empty and
the CLI automatic retry loop was stopped. The scoped ACR token was disabled,
the tagged resource list was empty and the evaluation VM was absent. A10
allocated time and GPU spend remained zero.

After the mandated boundary, the request-status collection was still empty,
no quota-create process existed, the pull token was disabled and both the
tagged resource and VM lists were empty. One raw Quota REST `PUT`, deliberately
without an automatic retry client, was sent at 2026-08-28T05:34:49.5163449
IST. Azure again returned HTTP 429 `RequestThrottled` with `Retry-After: 3600`
and no `Location`, `Azure-AsyncOperation` or request id. Verification at
05:35:24 IST measured zero request-status records, zero quota-create processes,
zero tagged resources, zero VMs, zero GPU seconds and USD 0 GPU spend.

## `consolidated-voice-listening-pack-local-2026-08-28`

**Measured 2026-08-28, n=15 protected candidate clips from n=3 existing packs.**
The reproducible builder bound six Chatterbox, six Qwen English and three
VoxCPM2 source WAVs to their existing manifests, sealed keys or signed receipts.
It produced 17 opaque rating screens, including two byte-identical hidden
repeats, plus two tone attention checks and one real-owner reference. All 20
served WAVs were canonical 24 kHz mono PCM16, exactly 518,444 bytes and 10,800
ms, after one common RMS, fade and silence-pad treatment. No disclosure was
trimmed because disclosure audibility is a required human rating.

Exact language and target-text SHA-256 grouping measured one matched cell with
four Hindi variants, 11 unmatched lanes and zero cross-provider matched cells.
The scorer therefore leaves `crossProviderWinner` empty by construction. The
source-bound `verify` command passed 18 of 18 checks. The centrally wired
`voicelistening` suite passed 36 of 36 checks, including source-map leakage,
equal wire geometry, key traversal, hidden-repeat binding, attention exclusion,
explicit-unseal refusal, repeat exclusion from model evidence and the
unmatched-lane negative control.

The local page was rendered in installed Chrome at 390 by 844 and 1440 by 1000
CSS pixels. Both intro renders measured zero horizontal overflow and zero
console warnings or errors. The first 390-pixel rating screen also measured
zero horizontal overflow and zero console warnings or errors. This was a visual
and mechanical inspection only. No person rated a voice, no model mapping was
unsealed, and no pronunciation, accent, naturalness, likeness or winner result
exists. IndicF5 was not in the available pack at measurement time.

## `indicf5-cross-script-duration-diagnosis-2026-08-28`

**Measured 2026-08-28, six frozen requests, one 12-second owner reference and
one focused local suite.** The exact reference hypothesis has 134 Latin
characters/bytes. Under the pinned upstream F5 byte-length formula, the six
Hindi/Hinglish requests plan 23.1 through 31.7 seconds of generated audio and
two reach the 4096-frame maximum. Unicode-aligned planning yields approximately
11.1 through 13.9 seconds instead. The clean offline image reached ready state;
no logged synthesis exception or completed WAV existed before the requests
were manually stopped, so a lazy CUDA or `torch.compile` failure was not
claimed.

The implemented duration, canary and same-process generation-binding suite
passed 35 of 35 checks. Its executable controls cover Devanagari density,
Latin stability, a 30-second refusal, exact local Vocos and vocabulary assets,
content-bound cached generations and an unscored canary before six blind
items. All Python sources compiled and the qualification script parsed. No
post-fix remote image, synthesis, perceptual result or winner existed when this
measurement was written.

## `indicf5-cold-start-transport-expiry-2026-08-28`

**Measured 2026-08-28, one signed canary after one scale-to-zero deployment.**
The immutable duration-fixed IndicF5 image started, loaded local Vocos and
vocabulary, and reached application readiness. The canary then returned signed
HTTP 401 `transport_binding_invalid` before model inference. The broker had
validated the request at public ingress and forwarded the same timestamp after
the private cold start exceeded the runtime's 60-second skew bound. No WAV or
quality result was produced, and the runtime was returned to zero replicas.

The corrected broker source passed all 59 open-voice checks and all 35 IndicF5
checks, plus Python compilation. Static and executable contracts require a
fresh internal nonce and timestamp, runtime readiness before forwarding,
verification of the private response against the internal nonce, and a
caller-facing signature against the original nonce. Remote broker build `cu22`
was running when this entry was written.

## `owner-exact-text-matched-pack-local-2026-08-28`

**Measured 2026-08-28, n=5 base planned requests, n=8 with both optional arms,
n=2 comparison cells and n=32 executable local checks.** The base grid contains
three English clips from three providers and two Hindi clips from two
providers. Adding IndicF5 and ZONOS2 yields four providers in each language.
Every item in a language shared one body hash, disclosure hash and full-text
hash; every item in the pack shared seed 31001, the same 12,000 ms 24 kHz mono
owner-window commitment, transcript commitment and consent commitment.

Synthetic signed-result fixtures for all five adapters were normalized through
one receipt contract. Negative controls rejected a missing response HMAC,
wrong model commitment, reference, seed or consent, missing PerTh verification,
48 kHz output and wrong PCM hash. Two independently sealed fixture packs used
different random secrets, produced different opaque sequences, retained two
exact-text cross-provider cells, exposed no model or consent mapping and served
one common WAV geometry. Unseal refused with no accepted listener. Ten USD 0.50
attempt reservations reached exactly USD 5; the eleventh and a caller-supplied
USD 5.01 limit were refused.

`node evals/run.mjs voicematched` passed 32 of 32 checks. Node syntax checks and
the focused diff check passed. The suite and guarded command negative control
made zero network, database, cloud or model calls. No candidate WAV was created
by this work, no listener score exists, and no accent, naturalness, likeness,
pronunciation or provider winner is claimed.

## `indicf5-owner-qualification-remote-2026-08-28`

**Measured 2026-08-28, one unscored canary and six sealed owner-bound
Hindi/Hinglish clips.** ACR run `cu23` built the bounded runtime-only repair in
189.18 seconds and produced immutable digest
`sha256:3b88af8804d64d4be224c38fdfc4b68739cdf384b2ce1e7c1d271404c4a1a28f`.
The isolated runtime reached the canary after seven cold-start checks. The
canary and all six scored requests passed request/response HMAC, exact model,
owner-reference, ASR-hypothesis and consent commitments, codepoint-duration
receipts and post-hoc PerTh detection.

The six WAVs are 24 kHz mono and total 71.069 seconds. Model elapsed time totals
204.197 seconds; mean RTF is 2.8705 with range 2.125527 through 4.159047. All
warm requests completed on attempt one. PerTh score minimum is 0.99807614 and
the other five scores are 1.0. The served manifest and private sealed key are
under `scratchpad/indicf5-20260828-r7`; human listening remains `not_started`.
Against the exact same four owner-reference windows used for VoxCPM2, the six
opaque candidates produced 192-dimensional ECAPA mean 0.824822, p10/worst
0.815361 and combined candidate confidence 0.959. The provisional
`voice-fidelity/v1` policy returned pass. The signed evidence report is
`scratchpad/indicf5-20260828-r7/fidelity.json`, SHA-256
`a1b8197e057f9ee03ea2cbc425d003a95518fd5d04194239f8780d129954a342`.
No raw embedding was persisted.

These numbers establish transport, execution, duration, provenance and one
speaker-embedding identity signal only. They do not establish Hindi
naturalness, accent, intelligibility, perceived likeness or a model winner.

## `consolidated-voice-listening-pack-indicf5-r7-local-2026-08-28`

**Measured 2026-08-28, n=21 protected candidate clips from n=4 existing packs,
including n=6 real IndicF5 r7 clips.** The fresh builder matched the IndicF5
public manifest and private key on contract, creation time, listening state,
evaluation and disclosure flags, canary, owner-reference SHA-256, reference
transcript SHA-256, and all six item ids. All six blind WAV byte hashes,
manifest durations, 24 kHz sample rates and PerTh flags matched. The private
evidence also bound every item to one pinned model revision, one model
commitment, one owner reference, one transcript commitment and one
consent-receipt SHA-256; minimum stored PerTh score was 0.99807614. The pack
does not carry the original consent receipt body, so this audit proves the
six-item receipt commitment is consistent but cannot independently recompute
that commitment from its source body.

The consolidated output contains 23 rating screens, including two
byte-identical hidden repeats, plus two attention checks and one real-owner
reference. All 26 served WAVs are canonical 24 kHz mono PCM16, 13,280 ms and
637,484 bytes after the common treatment. Exact language and target-text
grouping measured one matched cell, 17 unmatched lanes and zero cross-provider
matched cells. The source-bound audit passed 18 of 18 checks and the focused
suite passed 36 of 36 checks.

Installed Chrome rendered and exercised the intro and first rating screen at
390 by 844 and 1440 by 1000 CSS pixels. Both widths had zero horizontal
overflow, zero console warnings or errors, and a disabled Next control until
the required ratings were complete. No answer was submitted, no person rated
a voice, no mapping was unsealed, and no accent, pronunciation, naturalness,
owner-likeness or winner result exists.

## `hindi-text-frontend-confusable-control-local-2026-08-28`

**Measured 2026-08-28, one focused confusable fixture and two offline suites.**
The input `the formula hai` now produces ordered language segments `hi`, `en`,
`hi`: the English article remains exactly `the`, while the reviewed classroom
borrowing and Hindi verb become `फ़ॉर्मूला है`. The existing `he hai` control
also continues to preserve English `he` rather than rewrite it as Hindi `hai`.

The Hindi text-frontend suite passed 15 of 15 checks and the open-voice suite
passed 59 of 59 checks. No GPU, cloud synthesis or listener was used, so this
measurement proves deterministic text planning only, not pronunciation or
perceptual quality.

## `indicf5-objective-intelligibility-azure-speech-2026-08-28`

**Measured 2026-08-28, n=6 sealed clips totaling 71.069 seconds, one Azure
Speech short-audio pass with no retries.** The existing eastus2 Azure AI
Services resource accepted all six 16 kHz mono PCM WAVs after deterministic
windowed-sinc conversion from the immutable 24 kHz pack. Recognition used one
`hi-IN` conversation hint and the default base model. The scored target was the
mandatory spoken disclosure plus each frozen prompt. The private report is
`scratchpad/indicf5-20260828-r7/private/objective-intelligibility.json`, 34,370
bytes, SHA-256
`c642533ec2693c167c4e641a311e6c6b4b6d7e55dc6fa87045940600aa63c61f`.
It contains no credential, raw embedding or candidate model identity, and the
served `blind/` directory was not changed.

Micro-averaged raw Unicode WER/CER was **0.327586 / 0.277350** over 174 words
and 649 non-space characters. The separately labeled bounded cross-script
WER/CER was **0.327586 / 0.270191**. For the three Devanagari prompts, raw was
**0.204545 / 0.100324** and curated was **0.204545 / 0.099379**. For the three
mixed-script Hinglish prompts, raw was **0.453488 / 0.438235** and curated was
**0.453488 / 0.423398**. The unchanged WER shows that this v1 alias table did
not erase any word error in this pack.

The equation prompts contained eight chemical-symbol target units and eleven
spoken-numeral target units. Extracted sequence error was **6/8** for chemical
symbols and **4/11** for numerals. Devanagari contributed **2/4** symbol and
**1/6** numeral errors; mixed script contributed **4/4** and **3/5**. The six
selected prompts contained zero proper-name, place-name or acronym target
units, so named-entity error is unmeasured rather than zero.

One rejected Sarvam request plus the six Azure calls reserved 105 seconds at an
intentionally conservative USD 1 per minute and 15-second rounding, a USD 1.75
ceiling under the USD 2 stop. Actual provider billing is unavailable and is not
reported as USD 1.75. These are ASR disagreements, not human intelligibility:
one provider, one language hint, repeated disclosure in every denominator and
no word timing mean provider bias and prompt-only WER are unmeasured. No audio
was played, and no naturalness, accent, prosody, likeness or winner claim exists.

## `matched-pack-real-contract-and-cloud-preflight-2026-08-28`

**Measured 2026-08-28, n=8 real provider request-contract validations, n=34
offline matched-pack checks, n=4 deployed candidate stacks and n=1 absent
candidate stack.** One-use local validation fed the frozen real owner plan into
the checked-in Qwen English, VoxCPM2 English and Hindi, IndicF5 Hindi and ZONOS2
English and Hindi Python validators; both Chatterbox language payloads were
bound to the deployed source contract. All eight passed after forcing UTF-8 on
the Windows Python subprocess. `node evals/run.mjs voicematched` then passed 34
of 34 checks, including new wrong-request-id and wrong-model-revision negative
controls. These checks made zero model or synthesis calls.

Read-only Azure control-plane queries found immutable, scale-to-zero stacks for
Chatterbox, Qwen, VoxCPM2 and IndicF5. Chatterbox, Qwen and VoxCPM2 revisions
were active with zero replicas. IndicF5 runtime revision
`vyakti-indicf5-eval--0000005`, image
`sha256:3b88af8804d64d4be224c38fdfc4b68739cdf384b2ce1e7c1d271404c4a1a28f`,
and gate revision `vyakti-indicf5-eval-gate--0000002`, image
`sha256:f07baa8fc0ccc4eab72151b51ad84c57f0504a08bc981bdd7fb0b9c236fdca2a`,
were healthy but inactive with zero replicas. No ZONOS2 Container App,
deployment or ACR manifest existed. No resource was activated or changed.

The shared Qwen, VoxCPM2 and IndicF5 secret references all resolved to exact
Key Vault version URI
`https://vyakti-vceval-kv1729.vault.azure.net/secrets/transport-hmac/43fcfef0be9342dab7ca228d444a56a3`;
the value was not read or printed. Its live metadata was enabled but had no
expiry, contrary to the intended temporary lifecycle. Chatterbox remained on
its legacy Container App secret reference. Exact expected model commitments
were available for Chatterbox
`b66dbbe202313119f616f8afe7d9a938d483ae3f8136d8d52e6f4c7560469b36`
and VoxCPM2
`1db180e1170e617297f9d005a3ad1c8555e23eada0e7d6cb47ca773e65b9fa9c`.
Qwen and IndicF5 commitments were not present in Azure resource metadata and
were not taken from their sealed listening keys. The real six-request local
plan therefore remains `planned_no_cloud_calls`, with USD 3 of successful-call
reservations under the USD 5 hard stop and no accepted output.

## `matched-pack-acr-model-commitment-derivation-2026-08-28`

**Measured 2026-08-28, n=2 immutable deployed model manifests and n=35 local
matched-pack checks.** A read-only ACR Registry API session streamed the exact
content-addressed layer from each deployed image and extracted only
`.vyakti-model-manifest.json`. No Docker daemon, ACR task, model process,
Container App activation, synthesis endpoint, sealed mapping or key file was
used. The short-lived repository-pull token remained in process memory and was
neither printed nor persisted.

Qwen image
`sha256:e6ee1143498b495c76d99e5748452a8bc3cf942a8ae1f9268559a919ad26a988`,
layer
`sha256:b700a9d00d69684cae6343984304ceff2cd298245b24dbea04af65683ae362b5`,
contained 40 committed files. Removing the claimed field and hashing the exact
recursively sorted compact JSON produced
`4b14752ab88a5d74ed160d7766e1802ab5890540802a1d829ab946214b75e8c5`,
byte-equal to the manifest claim. IndicF5 r7 image
`sha256:3b88af8804d64d4be224c38fdfc4b68739cdf384b2ce1e7c1d271404c4a1a28f`,
repair layer
`sha256:5b1d03f81ce7188e231671e0aeaac21646478c414fb44859120b1f0675f63e70`,
contained 229 model files and two repaired Vocos files. The same independent
algorithm produced
`58394168701f51bd8b509470fe62f5db08cc5ded42b193ce4c08154db42795fa`,
again byte-equal to the manifest claim.

The Qwen, VoxCPM2 and IndicF5 commitments are now static matched-pack contract
values beside Chatterbox. `node evals/run.mjs voicematched` passed 35 of 35
checks, including a new assertion that every deployed four-arm candidate is
prebound while undeployed ZONOS2 remains unresolved. A fresh local plan at
`scratchpad/voice-matched-pack-20260828-r2/private/plan.json` binds all four
model commitments across six requests and remains
`planned_no_cloud_calls`. No output WAV or quality result exists.

## `indicf5-pronunciation-normalizer-local-2026-08-28`

**Measured 2026-08-28, n=2 frozen equation fixtures, n=5 retained-input
confusable fixtures, n=6 named-refusal controls and one 10-check offline
suite.** The isolated deterministic normalizer transformed exactly four
chemical-symbol units and three subscript-numeral units in the frozen
mixed-script equation text. The already-Devanagari sister text remained
byte-identical. Formula coefficients and reaction operators, explicit caret
and superscript charge, oxidation state, ISO date, decimal, standalone numeral,
idempotence, exact source-span reconstruction and every content hash passed.

Pure English; element-like English words; `IP`, `AI` and `IIT`; a single
`vitamin B two` phrase; slash dates; semantic versions; IP addresses;
non-chemical arrows; and ambiguous `Fe3+` stayed outside the chemical rewrite.
Input, output, transformation-count and expansion hard stops returned named
refusals. `node evals/indicf5-pronunciation/run.mjs` passed 10 of 10 checks;
both Python files compiled and the focused diff check passed.

Against the already-recorded aggregate errors, the exact conditional
pre-registration is chemical symbols 6/8 to 2/8 and numerals 4/11 to 1/11 if
every covered unit resolves and no other unit regresses. No synthesis, GPU,
cloud, ASR, listening or model call ran. Therefore those figures are expected
text coverage only, not measured pronunciation, intelligibility, naturalness,
accent, likeness or audio gain. The normalizer is not imported by the runtime
or contract and no production route changed.

One direct readback of the private objective report measured 27,358 bytes and
SHA-256 `aacea25fd17a63cc2b9a68bc70572f920ccd91c3de29f381b14939c19c4e41af`.
Its contract, six-item aggregate, script breakdown and unit counts match the
inputs above. The earlier objective-report entry records 34,370 bytes and a
different hash for this path; the reason for that byte-level discrepancy is
unmeasured. This pre-registration binds the current readback hash and does not
represent the older hash as current file identity.

## `indicf5-pronunciation-runtime-integration-local-2026-08-28`

**Measured 2026-08-28, n=3 focused offline suites, n=1 central-runner
registration execution, n=3 JavaScript syntax checks and n=3 Python compile
checks.** `node evals/indicf5-pronunciation/run.mjs` passed 10 of 10,
`node evals/indicf5-runtime/run.mjs` passed 41 of 41, and
`node evals/voice-matched-pack/run.mjs` passed 40 of 40. The registered
`node evals/run.mjs indicf5pronunciation` path independently invoked the
focused suite and passed 10 of 10. Node parsed the runtime qualifier and both
matched-pack modules; Python compiled the normalizer, request contract and
runtime app. The focused diff check was clean.

The executable controls require an exact source-text hash and explicit
normalization request, prove that only audited synthesis text reaches duration
planning and inference, validate the real Python request contract from the
matched provider payload, reconstruct every changed source span and canonical
audit, preserve the historical r7 unnormalized baseline as a distinct variant,
and fail closed for a missing request contract or tampered audit. No cloud,
model, GPU, Docker, deployment, ASR, audio generation or human listening call
ran. There is therefore no measured pronunciation, intelligibility,
naturalness, accent, likeness or audio gain. The exact remaining blocker is an
immutable isolated image build and deployment followed by sealed matched
before/after resynthesis, the same objective diagnostic and human listening.

## `matched-pack-older-chatter-runtime-disclosure-drift-2026-08-28`

**Measured 2026-08-28, n=2 bounded Chatterbox cloud attempts, n=1 immutable
deployed-image source inspection and n=41 focused offline controls.** Attempt
one reached the 240-second client timeout during the isolated Chatterbox cold
path. After read-only control-plane health showed one ready runtime and one
ready admission replica, attempt two returned a signed result but the exact-text
verifier rejected it as `matched_pack_result_disclosure_drift`. The run stopped
immediately at two of ten allowed attempts and USD 1.00 of the USD 5.00
reservation ceiling. No output WAV or receipt entered the pack, no other model
arm ran and no audio was listened to.

The attempted English request bound the exact disclosure
`This is an AI-generated voice replica.`: 38 Unicode code points, 38 UTF-8
bytes and SHA-256
`be278bc82cf3201a5006d5d2a0ef0db9cef8bdfe5f5faeb2637266b74561cf05`.
The returned result omitted `disclosure_text` entirely, so a returned
disclosure length or hash does not exist. The returned legacy shape contained
request, model, reference, audio, conditioning and PerTh fields; it contained
neither `text_frontend_contract`, `disclosure_text`,
`disclosure_language_id` nor `spoken_disclosure`.

Read-only ACR Registry API inspection bound the deployed Chatterbox image
`sha256:d63717334b5a3c638dc19d4e2d18eb6f1c4fa46535e469347220d1e2b2391178`
and its `app.py` layer
`sha256:1162026953ebd519ae66ae9985eb093a33637d5f0b5e11fcd4d1be8a53ea84e7`.
That source contains no text-frontend contract and returns none of the missing
fields. The checked runtime source does. `node evals/run.mjs voicematched`
passed 41 of 41 offline checks including the deterministic negative control
that an otherwise valid Chatterbox response without text-plan disclosure fields
fails closed. This measures a deployment/source contract drift, not voice
quality, disclosure audibility or model failure.

## `indicf5-pronunciation-acr-qualified-image-2026-08-28`

**Measured 2026-08-28, n=1 successful remote ACR build, n=4 bounded source
files, n=23 registry layers and n=3 focused offline suites.** ACR quick run
`cu27` used one 2-vCPU agent from 22:24:46Z through 22:27:47Z and produced tag
`vyakti/indicf5-eval:pronorm-20260828-r1` at immutable digest
`sha256:367927911d20b52e55e7e908602b0c4105895b3e1f6def3f4714eca234036729`.
Its compressed layers total 6,654,615,008 bytes. The lane authorized at most
USD 20 of build activity; one three-minute quick build ran. Cost Management
has not ingested an exact charge, so no invoice amount is claimed.

The source context contained only `Dockerfile.patch`, `contract.py`,
`pronunciation_normalizer.py` and `app.py`, totaling 43,287 bytes. Their
canonical path, length and SHA-256 manifest is
`cc468f31e0bfa6ce3ec266e9f4dc8a59932fae4cbe4f1b4cc1845a2f5c4454b7`;
the independent 14,009-byte evidence ZIP is SHA-256
`c00bad162affcbf2eb584c66361c8fcedb367ce677c46e07fcec35a627472df0`.
The CLI uploaded a 12.848 KiB tar from that frozen directory. Registry
extraction proved the three runtime file hashes exactly matched the source
snapshot after the build.

The first 19 of 23 layers exactly match repaired offline parent
`sha256:22c4477cb70fdb3d3c43feab7b70e36a6948ed8c1933da63b13a829b4289e71c`.
The four new source and ownership layers total 26,502 compressed bytes. The
inherited 50,356,649-byte layer
`sha256:5b1d03f81ce7188e231671e0aeaac21646478c414fb44859120b1f0675f63e70`
passed a direct blob hash. Its 36,380-byte, 229-file IndicF5 model manifest is
SHA-256 `29ede8a77f4fc45b891bd8804f62407a3566691bdc1acdee37725f1de83655cd`;
the claimed and independently re-derived commitment both equal
`58394168701f51bd8b509470fe62f5db08cc5ded42b193ce4c08154db42795fa`.

Post-build suites passed 10 of 10 pronunciation checks, 41 of 41 runtime
checks and 41 of 41 matched-pack checks; the frozen source still matched the
workspace 4 of 4 and the focused diff check was clean. The runtime and gate
remained inactive with zero replicas and still pointed to r7 digest
`sha256:3b88af8804d64d4be224c38fdfc4b68739cdf384b2ce1e7c1d271404c4a1a28f`
and gate digest
`sha256:f07baa8fc0ccc4eab72151b51ad84c57f0504a08bc981bdd7fb0b9c236fdca2a`.
No local Docker, deployment, revision activation, GPU, synthesis, ASR or
listening ran, and no audio-quality gain is claimed.

## `openvoice-text-plan-runtime-acr-build-2026-08-28`

**Measured 2026-08-28, n=1 remote ACR build, n=6 frozen build inputs, n=5
registry-extracted copied source files and n=3 focused offline suites.** Before
the build, `node evals/run.mjs openvoice` passed 59 of 59 checks,
`node evals/run.mjs hinditextfrontend` passed 15 of 15 and
`node evals/run.mjs voicematched` passed 41 of 41 with zero cloud or model
calls. After the build and concurrent gate additions, the same frozen runtime
source still matched six of six manifest entries and the focused suites passed
61 of 61, 15 of 15 and 41 of 41 respectively. The canonical source manifest
commits the Dockerfile, requirements,
model-fetch source, LoRA source, Hindi-pack source and runtime source as
`45c9e0cf59f068c97a55d623dff564d4e812dcbdeb95e7dfd158d3875f9141d4`.

Remote ACR run `cu28` started at `2026-08-27T22:28:24.844882Z`, succeeded at
`2026-08-27T22:39:47.201166Z` after 682.356 seconds and produced tag
`open-voice-runtime:matched-disclosure-45c9e0cf59f068c9`, immutable digest
`sha256:f331a4b327a7eb89b2fdb3877a5875fdb18fb4a6ddc24e3b7506941db2e0e369`
and config digest
`sha256:ee9a64377d765a3f47104dfa68183f981c82467bc47486ce1dfaa35d2be8536e`.
Read-only Registry API extraction independently matched the byte length and
SHA-256 of all five files copied into `/srv/open-voice`, including the
28,152-byte `app.py` hash
`dc3a7034f5ab16e0ab743ddc2b296bf0cf3e6c10d2bc2b9e16c2095bef9006dd`.
The exact Chatterbox commit and `general` model arm were also present in image
history or environment.

No local Docker daemon, model inference, synthesis, listener or deployment was
used. The live Container App remained on the older digest
`sha256:d63717334b5a3c638dc19d4e2d18eb6f1c4fa46535e469347220d1e2b2391178`;
the runtime and admission apps both returned to zero replicas. Only one ACR run
was submitted and no retry was used. Azure billing was not read, so an exact
dollar cost is unavailable; this does not claim an audio, accent, likeness or
pronunciation improvement.

## `voice-text-plan-release-audit-local-2026-08-28`

**Measured 2026-08-28, n=2 owner preview callers, n=1 reproduced caller
omission, n=1 corrected caller and n=4 focused offline suites.** Read-only
inspection found that `api/replica-voice-preview.js` constructed a valid
text-frontend audit but passed it only to the optional trial resolver, while
`beginOwnedVoicePreview` required it for every authorization. A direct local
call with an otherwise valid authorization shape returned the named
`voice_preview_text_frontend_invalid` refusal before its database callback.
The Meet-step panel and Mirror Call already used the shared panel path and
carried the audit. After the advanced caller forwarded the same audit and its
source mutation control was corrected, `node evals/run.mjs openvoice` passed 61
of 61 checks.

The independent focused runs passed `productionprotection` 44 of 44,
`voicepanel` 95 of 95 and `hinditextfrontend` 15 of 15. `git diff --check`
passed, `node scripts/build-engine-bundle.mjs --check` reported a fresh
321,750-byte bundle, and the pre-entry context graph passed at 689 nodes and
803 edges. A bounded scan of every changed or untracked file found no real HF,
Supabase, JWT, Azure connection-string or literal credential pattern; the only
secret-shaped match was the explicit offline fake-provider test secret.

This audit made no cloud, model, GPU, Docker, deployment, database or audio
call and spent nothing. It proves local caller coverage, fail-closed protection
contracts and the asymmetric rollout requirement only. It does not prove the
full release runner, a live Azure revision, a sealed Hindi disclosure canary,
voice quality, accent, likeness or intelligibility.

## `openvoice-admission-broker-acr-build-2026-08-28`

**Measured 2026-08-28, n=1 remote ACR broker build, n=3 frozen build inputs,
n=2 registry-extracted copied source files and n=1 focused suite.** The
canonical broker source manifest binds `Dockerfile.broker`,
`broker-requirements.txt` and `broker.py` as
`60d44032e71fc9f306aec9c6038f05d5c19022a8920c2cc4379728c300a618e6`.
Python compilation passed and `node evals/run.mjs openvoice` passed 61 of 61
checks both before and after the build.

Remote ACR run `cu29` started at `2026-08-27T22:44:14.247279Z`, succeeded at
`2026-08-27T22:44:59.787073Z` after 45.540 seconds and produced tag
`open-voice-admission:matched-disclosure-60d44032e71fc9f3`, immutable digest
`sha256:214a6baa15eeb4c87e06fc098c19206aad40e8e898005e6b8a948c88fc379f80`
with compressed registry size 60,723,927 bytes, and config digest
`sha256:88e5767e94cc2261c27c6dfc5e6c0b1dbd2823dcaf2f88398190917da73c556f`.
Read-only registry extraction matched the exact 7,785-byte `broker.py` hash
`fa338ec87ef45c1a2201e76a3310a2299ff41189753229c34bc56c3205f75520`
and 60-byte requirements hash
`b95a133a4da8ba54ebd8fbb034ddd1a461d8f3bef522c60713b1c383b07c02ba`.
The frozen 885-byte Dockerfile hash
`669cd934884e0bf1f9552d213833f292feb2341025fe3b44bf7bed7b4b5f84cf`
still matched the workspace and its user, install and ownership instructions
matched the immutable image history.

No local Docker, model, synthesis, GPU, deployment or listener ran. The live
admission app remained on its previous digest
`sha256:3229c6479f83a0864faa0a2f81d43402b115341bbac318209d5b97c8463ceeb1`,
and both admission and runtime apps had zero replicas. Only one broker ACR run
was submitted and no retry was used. Azure billing was not read, so exact
dollar cost is unavailable; no voice-quality improvement is claimed.

## `openvoice-offline-tokenizer-image-2026-08-28`

**Measured 2026-08-28, n=1 observed deployed cold start, n=1 remote ACR build,
n=9 frozen build inputs, n=12 registry-extracted image files and n=64 focused
offline checks.** Console logs from real runtime revision
`vyakti-open-voice--r2405fbe` recorded, in order, a failed local Cangjie lookup
and `Downloading: "https://github.com/explosion/spacy-pkuseg/releases/download/v0.0.26/spacy_ontonotes.zip" to /tmp/.pkuseg/spacy_ontonotes.zip`.
The official package config publishes archive SHA-256
`b216e7f92de7ae285aeab8feba2faa8ea8216e5995ff6fb3d391cc8356db1bfe`;
an independent download measured 34,567,143 bytes and the same digest. Its
exact two entries measured 22,685,181-byte `features.msgpack` at SHA-256
`fd4322482a7018b9bce9216173ae9d2848efe6d310b468bbb4383fb55c874a18`
and 37,508,754-byte `weights.npz` at SHA-256
`5ada075eb25a854f71d6e6fa4e7d55e7be0ae049255b1f8f19d05c13b1b68c9e`.

The nine copied build inputs are frozen by canonical source-manifest SHA-256
`c6fcc275bd669ed293215cc1f76486ac7c310913ad9d16b3e12aff0783816f51`.
`node evals/run.mjs openvoice` passed 64 of 64 checks before the build. ACR
quick run `cu2a` used one 2-vCPU agent from `2026-08-27T23:00:22.305789Z` to
`2026-08-27T23:09:38.645944Z`, 556.340 seconds, and produced tag
`open-voice-runtime:offline-pkuseg-c6fcc275bd669ed2` at immutable digest
`sha256:625edc223f7063e744d6463dd7443daeaa7097552997a7a4e47c99888cfa86d8`.
Its config digest is
`sha256:6ab326b0c56853bf96f78c7f338d8363eab98deaecc35630557c98a6f1c3398f`;
compressed registry layers total 9,843,509,364 bytes, or 9.167482 GiB.

The build log bound runtime-asset manifest SHA-256
`b6fd6bf1d3e592043b69b03bfbb6afe8b49c7a51ba6b5f28038f6128f7d40ca6`,
then recorded `OPEN_VOICE_OFFLINE_STARTUP_PROBE_OK` with that same digest and
`network_attempts=0`. That probe first ran a missing-cache negative control
which succeeded only by reaching the hard-blocked upstream downloader, then
initialized the real baked `spacy_ontonotes` model with the blocker still
installed. Read-only Registry API extraction independently verified all eight
files copied into `/srv/open-voice`, the archive, both extracted files and the
canonical runtime-asset manifest: 12 of 12 exact image files. The immutable
config carried both offline flags, `/models/pkuseg`, the manifest path,
non-root UID and the probe command in history.

No Container App revision referenced the new digest at readback; the runtime
and admission apps remained on their preceding immutable images with zero
replicas. No deployment, synthesis, model inference, GPU, listener or local
Docker operation ran. Azure billing had not ingested an exact charge; one
9.27-minute 2-vCPU build is reported instead of an invented dollar figure.
This proves the exact tokenizer portion of cold startup no longer needs its
observed download. It does not measure full GPU cold-start latency, voice
quality, accent, likeness, pronunciation or human preference.

## `preview-style-receipt-limit-local-2026-08-28`

**Measured 2026-08-28, n=1 live authorization reproduction, n=1
production-shaped local receipt, n=1 oversized negative control and n=29
focused offline checks.** Readback of the live named constraint found
`octet_length(preview_style::text)<=512`. The coordinating lane reproduced the
same owner authorization with an exact 751-byte receipt-bearing style; the
insert failed SQLSTATE 23514 on
`vy_replica_generation_preview_style_check`. Existing stored generations had
a measured maximum of 347 bytes, so the failure is caused by the newly bound
receipt rather than historical oversized data.

The focused fixture uses the real Hindi text frontend, text-plan audit builder
and server-owned `balanced` preset, then adds the exact language-conditioning
fields written by `beginOwnedVoicePreview`. Its PostgreSQL-style `jsonb::text`
serialization is 862 UTF-8 bytes: greater than 512 and no greater than 2,048.
Adding a 2,048-character padding field makes the same object exceed the new
ceiling and the executable control rejects it. Migration 065 splits into one
statement, contains `drop constraint if exists` and the replacement named
check in that same statement, and contains no DO block.

`node evals/run.mjs voicepreference` passed 29 of 29 checks, `node --check
evals/voice-preference/run.mjs`, `git diff --check` and the pre-entry context
graph check passed. No migration, database write, deployment, Docker, cloud,
model, audio or GPU call ran in this lane. This proves the local migration and
boundary contract only; it does not claim migration 065 is live.

## `preview-style-migration-live-canary-2026-08-28`

**Measured 2026-08-28, n=1 live Neon migration, n=1 production deployment,
n=4 production owner preview authorizations and n=1 sealed result.** Migration
065 applied through the repository SQL-over-HTTP runner as one statement in
1,011 ms. A read-only catalog query immediately returned the named constraint
as validated with `octet_length(preview_style::text) <= 2048`. Commit
`6746796` auto-deployed to Vercel production as Ready deployment
`dpl_Ed5qHd8DRUyFSYf77P9FHVHXhLZq`; the main production alias pointed at it.

The authenticated owner then retried the exact Hinglish Studio line against
replica `c5b868e4...`. The first authorization recorded
`open_voice_runtime_warming`; Azure readback showed the new immutable runtime
replica pulling its 9.84 GB image with zero restarts. The container started at
23:52:13Z, application startup completed at 23:52:38Z and the readiness probe
subsequently returned true. The Studio's bounded checks recorded one
`voice_preview_wake_dispatched` row and one `voice_preview_wake_in_flight` row
before the final authorization at 23:56:04Z sealed at 23:56:59Z.

Final generation `cf3be95e-a2e6-4f14-8f69-09c6bbc39e5e` is `sealed`, has an
empty failure code, 33 segment receipts, and non-null audio, watermark and
manifest hashes. Its PostgreSQL JSONB preview receipt is 789 bytes and binds
Hindi synthesis. The production browser exposed one controlled `blob:` audio
element and the Studio displayed the short receipt and model commitments.
Before release, `node scripts/verify-release.mjs` passed all 16 checks and the
focused voice-preference suite passed 29 of 29. No local Docker operation ran.

This proves upload-to-draft-to-protected-preview transport and provenance for
one owner line. No person listened in this measurement, so it does not prove
naturalness, accent, Hindi pronunciation, owner likeness or superiority over
another model.

## `indicf5-pronunciation-normalized-sealed-before-after-2026-08-28`

**Measured 2026-08-28, n=1 unscored canary, n=6 normalized owner-bound clips,
n=6 retained r7 controls, n=3 signed ECAPA evidence calls and n=6 Azure Speech
short-audio calls with zero provider retries.** The isolated runtime revision
`vyakti-indicf5-eval--pronormr1` ran immutable image
`sha256:367927911d20b52e55e7e908602b0c4105895b3e1f6def3f4714eca234036729`.
Every scored response carried exact model commitment
`58394168701f51bd8b509470fe62f5db08cc5ded42b193ce4c08154db42795fa`,
model revision `ba85abedf18dc479a447eaa0eccbd76ab78a47d5`, a valid response HMAC
from the existing versioned Key Vault secret, the same consent receipt and the
same 12-second owner reference and unreviewed transcript hashes as r7.

The old and normalized packs had the same six prompt hashes and caller seed
schedule. Five prompt WAVs were byte-identical across the two packs. Only
`equation-reading-code-switch` changed: its receipt recorded four exact source
transformations covering four chemical-symbol units and three numeral units.
All six outputs were 24 kHz mono PCM16 and PerTh-verified; normalized minimum
PerTh score was 0.99355. The normalized blind manifest is 3,278 bytes at
SHA-256 `e8d0051f5b6c63c0688f142e540df34f25692fe31d3dc5939167e54f6c63d883`;
its private key is 13,511 bytes at SHA-256
`f960f99466ef77b2895c865700225a40ddc2904fd33b4af8939dbc5e08ceab88`.
The served arm stayed sealed and human listening stayed `not_started`.

Against the same four held-out owner windows, ECAPA mean moved from 0.824822
to 0.827428, an absolute increase of 0.002606. P10 and worst both remained
0.815361. The normalized fidelity report is 6,147 bytes at SHA-256
`4ca01aa3d9c9eedfece07c42f2a6e610febfa5c001fc77d371e67f2c1b39f71b`.
This is a speaker-embedding regression signal, not a perceptual identity score.

One private Azure Speech `hi-IN` pass measured aggregate raw WER/CER changing
from 0.327586/0.277350 to 0.321839/0.272727 and the separately labeled curated
script-aware WER/CER from 0.327586/0.270191 to 0.321839/0.267254. The three
Devanagari controls were unchanged. Across the three mixed prompts, raw WER/CER
moved from 0.453488/0.438235 to 0.441860/0.429412 and curated WER/CER from
0.453488/0.423398 to 0.441860/0.417827. On the changed equation alone, chemical
symbol errors fell from 4/4 to 2/4 and numeral errors from 3/5 to 0/5; aggregate
unit errors therefore moved from 6/8 to 4/8 and from 4/11 to 1/11. The private
normalized objective report is 27,344 bytes at SHA-256
`cc55d5ab514a2ae0e8224a1e0e41307289577d937095847f4ecb950fa712f16f`.

The Azure Speech pass reserved a conservative USD 1.50 ceiling; actual
provider billing and GPU invoice amounts were unavailable. The normalized GPU
revision existed from 00:04:15Z through last activity at 00:14:54Z and recorded
222,855 ms of model work across the canary and six scored calls. No local
Docker, production route, listener or unsealing action was used. At final
readback the eval app template was restored to r7 digest
`sha256:3b88af8804d64d4be224c38fdfc4b68739cdf384b2ce1e7c1d271404c4a1a28f`;
the normalized, restore and original r7 revisions and the gate were inactive
with zero replicas, and the shared evidence service had scaled to zero.

Before deployment, the pronunciation suite passed 10 of 10, the isolated
runtime suite 41 of 41 and the matched-pack suite 41 of 41. These measurements
show a narrow objective gain and complete receipt integrity. They do not prove
human pronunciation, naturalness, accent, likeness or a winner.

## `owner-exact-text-matched-pack-sealed-cloud-2026-08-28`

**Measured 2026-08-28, n=4 immutable model stacks, n=8 bounded cloud attempts,
n=6 accepted clips, n=2 named no-audio readiness attempts and n=0 listeners.**
The frozen r2 plan SHA-256 is
`a75b1c080ecf8a0ef06f33fce05d48b6d39788154b410da8ea08ec6589013397`.
All six requested provider-language cells used seed 31001, owner-reference
SHA-256 `8f3b4182...9d46`, transcript commitment `c02d014c...7a83`, consent
commitment `fe1d038e...4992`, and one exact English or Hindi full-text hash.

Every accepted result passed response HMAC, prebound model and immutable-image
evidence, exact request and reference binding, 24 kHz mono PCM16 geometry,
output hash and PerTh verification. Chatterbox additionally passed the exact
frontend, plan, segment and localized-disclosure receipt. The accepted clips
total 54,424 ms of audio and 137,345 ms of reported model work; all six PerTh
scores were 1.0. No audio was opened or played.

The Chatterbox calls used production runtime revision
`vyakti-open-voice--r5b4f0c5` at digest `sha256:625edc22...86d8` and admission
revision `vyakti-open-voice-admission--r2405fbe` at digest
`sha256:214a6baa...9f80`, without changing their templates or traffic. Qwen,
VoxCPM2 and IndicF5 used temporary min-one copies of only their isolated
qualified digests `sha256:e6ee1143...a988`, `sha256:40df335c...f697` and r7
`sha256:3b88af88...a28f`; their public gates remained on exact qualified broker
digests. The shared isolated transport secret stayed at versioned Key Vault URI
ending `43fcfef0be9342dab7ca228d444a56a3` and was read only in process memory.
No production route and no local Docker resource changed.

Two Chatterbox attempts stopped before audio with signed
`open_voice_runtime_warming`; the first coincided with Azure `WorkLoad Profile
Full` while another isolated qualification occupied capacity. They remain in
the append-only ledger. Eight USD 0.50 reservations total USD 4.00 under the
USD 5 stop: six successes and two no-audio attempts. This is a conservative
software reservation, not an Azure invoice; exact provider billing was not
available.

The seal produced six base stimuli, eight rating screens and two exact-text
cross-provider cells with one common served geometry: 576,044 bytes, 288,000
samples, 24 kHz mono PCM16. `seal` and `verify` passed 18 of 18 core checks plus
private-route isolation. Served manifest SHA-256 is
`29bc85c8951f158d31bde49bcb2eaa6505c0eae059391a3a76054e937283d4a0`;
trials SHA-256 is
`820912d04813cf02d93a6373b3514abe938fc7a7e31e6c74939c883493d208ec`.
The model mapping remains sealed and listening is `not_started`. The focused
suite passed 43 of 43 after adding the text-plan drift and frozen-legacy
controls. Final readback found Chatterbox, Qwen, VoxCPM2, IndicF5, their gates
and voice evidence at zero replicas; all runtime templates were min zero.
This proves a fair, protected instrument, not naturalness, accent, likeness,
pronunciation or a winner.

## `voxcpm2-alakh-adapter-preflight-stop-2026-08-28`

**Measured 2026-08-28, n=1 live source, n=6 active consent scopes, n=1,683
speaker segments, n=288 transcript spans, n=1 pinned upstream source commit,
n=1 pinned model revision and n=0 training or synthesis calls.** Read-only Neon
queries bound source `1ecb89fc-b12d-4d84-a714-ffca2d5b021c` to replica
`c5b868e4-156e-417d-b39b-5c5f72beb92c`: 6,571,992 ms, 262,879,879 bytes and
SHA-256 `632c30c9099f219f5655f709ebb88f6f0d19d0497d6eb72c46aeb6dcaa89df9d`.
PowerShell `Get-FileHash` over the named local Alakh Pandey MP3 returned that
same digest and the same byte count. The database source provenance still says
`sha256_status=pending_server_verification`.

All six active scopes, including biometric and training, use
`account_attestation`, have `evidence_source_id=null` and carry
`granted_by=REPLICA_SELF_TEST_MODE`, `self_test_mode=true` and the
`owner-only-internal-testing/v1` guard. The latest decisions accepted 1,683
speaker segments plus the other evidence under the same self-test metadata.
They therefore prove an internal account bypass, not consent from the person
whose speech is in the recording.

Diarization produced 17 cluster labels over 6,165.096 seconds of speech. The
dominant `cluster-1` contributes 6,061.512 seconds, or 98.3198%, with no overlap,
but every speaker segment reports the same neutral target likelihood of 0.5.
The 288 transcript spans cover 6,505.600 seconds; their stored evidence-level
confidence is 0.0 and all 288 language rows are labeled `hi-IN` at 0.997. This
is enough to show extensive speech and transcript coverage, but not enough to
identify the dominant voice as the owner or to select clean owner-only training
examples.

The official source was read at exact commit
`f5a1c6a6b901bc732e20f0d59a369f6829ad717a`; the model remains pinned to
revision `32279effe8c19989596f05d353d1447f51d9e915`, and both are Apache-2.0.
The pinned official LoRA recipe requires 16 kHz manifests, batch size 2,
gradient accumulation 8, 1,000 iterations, 8,192 maximum batch tokens and LoRA
r=32/alpha=32 over both LM and DiT. Upstream recommends 5-10 minutes of audio
and publishes about 8 GB for inference, not a measured training-VRAM bound.

The consent/data gate failed before Azure build, VRAM allocation, manifest
split, adapter training or comparison synthesis. New reserved and measured
spend is USD 0.00 under the USD 100 cap. No production route, local Docker,
audio playback, mapping unseal or quality claim occurred. At readback the
isolated VoxCPM2 runtime and gate were min zero with zero replicas. The shared
voice-evidence service was temporarily occupied by the separate sealed matched
pack objective lane and was not touched by this preflight.

## `owner-exact-text-matched-pack-objective-opaque-2026-08-28`

**Measured 2026-08-28, n=1 sealed pack, n=6 unique opaque clips, n=8 public
rating IDs, n=4 exact owner-reference windows, n=7 signed evidence calls, n=6
Azure Speech calls, n=0 retries and n=0 listeners.** Before scoring,
`voice-matched-pack verify` passed 18 of 18 core checks plus private-route
isolation. Served manifest SHA-256 remained
`29bc85c8951f158d31bde49bcb2eaa6505c0eae059391a3a76054e937283d4a0`,
trials SHA-256 remained
`820912d04813cf02d93a6373b3514abe938fc7a7e31e6c74939c883493d208ec`
and the sealed-key bytes still matched the manifest commitment. The scorer did
not read the model map, open an audio player or attribute any opaque ID to an
arm. SHA-256 found two exact-audio repeat IDs, so the aggregate used the six
unique clips once each.

The signed evidence service embedded four contiguous 3,000 ms windows cut from
the exact 12,000 ms owner reference and each opaque served clip with
SpeechBrain ECAPA. Aggregate cosine similarity was mean 0.665601, nearest-rank
p10 0.585457 and worst 0.585457 over six candidate windows and four references.
Under the repository's explicitly provisional `voice-fidelity/v1` rails this
is a fail: mean is below the 0.70 activation floor and p10 is below 0.62. The
per-opaque unique values, in lexical opaque-ID order, were 0.585457, 0.713760,
0.726461, 0.673798, 0.674378 and 0.619752. Reference evidence confidence was
0.2132; each reference window is only three seconds while service confidence
is normalized to ten seconds, so this value is reported rather than treated as
a perceptual quality score.

One zero-retry Azure Speech short-audio pass used the default base model with
the public en-IN or hi-IN tag and scored the mandatory localized disclosure
plus exact frozen prompt. Aggregate raw WER/CER was 24/153 = 0.156863 and
35/678 = 0.051622. Curated script-aware WER/CER was 24/153 = 0.156863 and
36/693 = 0.051948. The three en-IN clips measured raw and script-aware WER
2/69 = 0.028986 and CER 4/357 = 0.011204. The three hi-IN clips measured raw
WER 22/84 = 0.261905, raw CER 31/321 = 0.096573, script-aware WER 22/84 =
0.261905 and script-aware CER 32/336 = 0.095238.

Per unique opaque clip, ECAPA/raw WER/script-aware WER were:
`1a26600429c277ffd0d01417` 0.585457/0.043478/0.043478;
`5a201d1de3aeb9d71a383edb` 0.713760/0.285714/0.285714;
`a11b318cebabc21c37fda095` 0.726461/0.214286/0.214286;
`ac418889292a12d54889a9e1` 0.673798/0/0;
`ac7bf0d8ed44612d5fa33346` 0.674378/0.285714/0.285714; and
`c4e9b8ca1c90a69912471dc8` 0.619752/0.043478/0.043478. Public repeats
`c0e74a2de7c1c7641f6b2a76` and `fffc4b65f0b431c1ec398ab5` were byte-exact
copies of opaque canonical clips and inherited their results without another
provider call.

The private opaque report is SHA-256
`ff6529053cb1d6b01a4d134e121cecd48dd0e988279fb1ed89f353df98f55b1e`;
its bounded scratchpad scorer is SHA-256
`09a01bd53160c64457718169ab21e18b1517d2e18718d50596aa6047d98b9f3e`.
Six 15-second billing quanta reserve a deliberately conservative USD 1.50
under the USD 2 stop; actual Azure Speech and evidence-runtime invoice amounts
were unavailable. No local Docker, production routing, synthesis, model-map
unseal or audio playback occurred. ECAPA is a speaker-embedding regression
signal and one-provider ASR is an intelligibility proxy; neither proves
naturalness, Indian accent, pronunciation, owner likeness or a winner.
Final Azure readback found `vyakti-voice-evidence`, the Qwen eval and gate,
the IndicF5 eval and gate, and the VoxCPM2 eval and gate at min zero with zero
replicas. No ZONOS2 eval app existed in the resource-group inventory.

## `owner-studio-blind-experiment-fixture-2026-08-28`

**Measured 2026-08-28, n=1 completed sealed r2 pack, n=1 Studio bundle, n=11
opaque served WAVs, n=2 browser viewports, n=0 listeners and n=0 model calls.**
The existing pack integrity command passed 18 of 18 checks plus private-route
isolation before export. Its one-file Studio bundle is 8,454,928 bytes with
SHA-256 `2b37260ac99142489fabe4382d3e06b7cdb5715e0c6401708c75008ba5192d06`.
It contains six base stimuli, two byte-identical repeat stimuli, two attention
stimuli and one real-owner reference. Every WAV is 576,044 bytes, 288,000
samples, 24 kHz mono PCM16. Listener-facing metadata contains no registered
provider, model commitment, consent receipt, source item, answer key or private
run secret.

The synthetic exact-text suite passed 46 of 46 checks after adding bundle
export, accepted-answer import, sealed-key result binding and no-promotion
controls. The internal-owner Studio suite passed all 26 checks. TypeScript,
copy and focused lint checks passed. A real r2 bundle was imported into the
actual React component in headless Chrome. At 1,440 by 1,000 and 390 by 844
CSS pixels the rating surface had no horizontal overflow or browser error;
the 390-pixel controls had a 44-pixel minimum height. After one rating was
saved, reload restored the same run and answer locally but required the clip
to be played again before continuation. Screenshots are
`.impeccable/review/voice-experiment-desktop.png` and
`.impeccable/review/voice-experiment-mobile.png`.

The complete release runner passed all 16 checks after one full rerun. The
first run stopped on the progress meter's CSS width transition; removing that
nonessential layout animation cleared motion lint. The successful run included
typecheck, prompt budget, rendered board legibility, one-voice, web build,
signed-in layout readability, the 423,440 ms offline eval suite, the live
zero-orphan sweep and citation discipline. The post-fix desktop/mobile browser
pass again produced zero console errors and zero horizontal overflow.

No audio was listened to, no rating sheet was accepted, no model mapping was
unsealed, and no quality result or winner was created. No network API, cloud
model, GPU, database, production deployment or local Docker operation ran.

## `personal-subscription-large-gpu-capacity-inventory-2026-08-28`

**Measured 2026-08-28, n=28 Azure regions queried through ARM Compute SKU
inventory, n=30 read-only ARM deployment validations, n=6 Container Apps
supported-profile reads, n=4 quota-request-list reads and n=12
decision-relevant official Retail Prices API meter rows.** The personal
subscription was selected explicitly by id. No Microsoft browser, local
Docker, VM, Container Apps environment, GPU replica, registry token, quota
request or production route was created.

`Standard_NC24ads_A100_v4` was SKU-unrestricted in 13 queried regions. Exact
template validation still rejected Spot in 12 usable regions because
`LowPriorityCores` had limit 3, usage 0 and needed 24 more cores; PAYG was
rejected because `StandardNCADSA100v4Family Cores` had limit 0, usage 0 and
needed 24. West Europe rejected both priorities because the region was not
accepting new customers. Canada Central `Standard_NC40ads_H100_v5` and East US
2 `Standard_NCC40ads_H100_v5` likewise needed 40 Spot cores from limit 3 or 40
family cores from limit 0. Full `Standard_NV36ads_A10_v5` was marked
`NotAvailableForSubscription` wherever it appeared. No SKU with `L40` in its
name appeared in the 28-region inventory. The final resource inventory showed
no virtual machine.

Container Apps exposed `Consumption-GPU-NC24-A100`, one GPU with 24 vCPU and
220 GiB host memory, in West US 3 and Canada Central. Central India and
Southeast Asia exposed only the 16-GiB T4 Consumption GPU profile; East US 2
exposed no GPU profile in the returned supported list. The subscription-level
supported list is not scheduling proof: no replica was scheduled in this
read-only lane.

Official USD Consumption meters from `prices.azure.com` were, per second in
West US 3, GPU 0.000529, vCPU 0.000024 and GiB-memory 0.000003; at a fully
active 24-vCPU and 220-GiB profile that is USD 6.354 per hour and USD 25.416
for four hours. Canada Central meters were 0.000635, 0.000034 and 0.000004,
respectively, or USD 8.3916 per hour and USD 33.5664 for four hours. Linux East
US 2 A100 VM list price was USD 0.67877 Spot and USD 3.673 PAYG per hour; H100
was USD 1.289904 Spot and USD 6.98 PAYG per hour, but all four routes failed
quota validation. Prices exclude storage, egress, requests and tax.

The 2025-09-01 Quota API returned zero quota-request records in East US 2,
West US 3, Canada Central and Southeast Asia. Its operation-status collection
is not a list surface and returned caller-verification errors without an
operation id. Together with the previously measured throttled request attempt,
there was no correct unthrottled request path with an immediately verifiable
request id, so this pass submitted none and spent USD 0.

## `owner-native-base-openvoice-conversion-aborted-2026-08-28`

**Measured 2026-08-28, n=1 four-item preregistered plan, n=1 Sarvam job
execution, n=2 verified IndicF5 base clips, n=3 bounded OpenVoice requests on
the first matched item, n=0 saved conversions, n=0 objective model calls and
n=0 listeners.** The frozen plan SHA-256 was
`cb33737cbd776bb316700ca1b11a9d70e3f1e0d40d51e68373487fa422219f41`.
It bound the exact 12-second owner reference
`8f3b4182178bb84e673266ceffbba83567a8bc34c4eac459365c375fadc69d46`,
source, transcript and consent hashes, seed 31001, matched Hindi/Hinglish text,
and OpenVoice tau 0.3. No third-party lecture audio was used as the identity
reference.

Official OpenVoice source commit
`74a1d147b17a8c3092dd5430504bd83ef6c7eb23`, model revision
`fd981100305a0e4291f93a9ad169c6d9f7bed54a`, checkpoint
`9652c27e92b6b2a91632590ac9962ef7ae2b712e5c5b7f4c34ec55ee2b37ab9e`
and config
`9dfff60350b8c63f2c664efd92a61b2516efb22671466960f0e5dfebd881fa47`
were verified before spend. Azure ACR remote build `cu2b` produced runtime
digest `sha256:dadb03b32b0822d369729464940ad2aba6c96d34fce18bbb6fa9a156bf4b1a42`
and gate digest
`sha256:ee3c3a8b0192ebc4524c8cb38551f4346906206cf2b6acbdc735d0823c36b100`.
After the measured PerTh framing failure, remote build `cu2c` produced corrected
runtime digest
`sha256:e0453eedbd5a740ce8137e836611c8b59c7f3f4799b40d217c26c2c56acdef03`.
The corrected runtime loaded the exact checkpoint with missing and unexpected
key lists both empty, loaded PerTh, and reached application readiness. No local
Docker operation ran.

The existing Sarvam secret was used only inside one overridden execution of
the already deployed processing-job image. Its first Bulbul v3 request returned
HTTP 402 before audio; no retry or output occurred. Both preregistered Sarvam
items were rejected with `audioGenerated=false` and provider spend claim USD 0.
The two IndicF5 normalized items both passed response HMAC, model revision and
commitment, exact reference/transcript/consent/text/seed and PerTh protection.
Their WAV durations were 11,744 ms and 13,280 ms, request wall times 37,500 ms
and 29,404 ms, generation RTF 3.109673 and 2.104217, and PerTh scores both 1.

OpenVoice request one returned signed HTTP 503
`perth_watermark_application_failed` before audio could leave; the input length
was not a multiple of PerTh's 240-sample frame. Request two used the corrected
digest but returned signed HTTP 503 `openvoice_converter_warming` after the
min-zero runtime scaled down between readiness inspection and admission. After
one stable min-one window, request three returned signed HTTP 200 but failed
the frozen aggregate receipt verifier. The runner discarded the response in
memory before writing a WAV, wire response or conversion receipt and did not
attempt the second Indic item. Because the old verifier reported one aggregate
error and deliberately retained no drifted response, the exact failed live
field is unavailable. Static comparison shows the service and verifier agree
on every named base, reference, converter, output and protection binding. A
separate n=1 cross-language fixture proves the remaining interoperability
hazard: Python hashes `{"score":1.0}` while JavaScript parses and reserializes
it as `{"score":1}`, producing a different SHA-256. The local deterministic
normalization plus integral-score regression passes the focused 20 of 20
converter checks, but that code was not remotely built or called.

The conservative ledger reserved USD 20 of the USD 60 hard cap across 16 state
entries; actual Azure invoice cost is unavailable. The abort manifest SHA-256
is `d81a22c04946e9859f0b563d5c93d683622ccf030fbe34eba1eef3a8a576cf0e`.
It exposes zero stimuli, records four rejections and commits sealed mapping
SHA-256 `4a4f91050c65dfd1581ab6ffff849df1015f3c6750762e2ec0f7e1ec28f0e70f`;
the AES-256-GCM key was destroyed after sealing. The not-run objective report
SHA-256 is `9a1c196708e80fe5852ffcedd50c594ad348a7c198791a29193d21423e48cd08`,
with zero ECAPA and zero Speech calls. Final Azure readback found the converter
runtime and gate plus the IndicF5 runtime and gate at min zero, no active
revisions and zero replicas. No production route changed, no audio was played,
no mapping was unsealed and no quality or winner claim was made.

## `zonos2-aca-a100-scheduling-pull-bound-2026-08-28`

**Measured 2026-08-28, n=1 dedicated Container Apps environment, n=1 serverless
A100 profile, n=1 private immutable runtime, n=1 signed public CPU gate, n=1
scheduled A100 replica, n=30 signed readiness attempts and n=0 synthesis or
audio results.** The personal subscription was selected explicitly by id.
West US 3 returned `Consumption-GPU-NC24-A100` with one GPU, 24 vCPU and 220
GiB. The lane created `vyakti-z2-a100-wus3-eval` with no log workspace and a
four-hour expiry, then deployed private runtime `vyakti-z2-a100-eval` at exact
digest `sha256:7d1f97efffe35e23a356a12494e0333cdfb586c5a1dfcd8f06165a27abdb301b`
and public gate `vyakti-z2-a100-eval-gate` at broker digest
`sha256:214a6baa15eeb4c87e06fc098c19206aad40e8e898005e6b8a948c88fc379f80`.
Both templates were min zero, max one and tagged evaluation-only with
production routing disabled.

The first gate deployment failed closed because the repository-read-only ACR
token covered ZONOS2 but not the broker repository. Adding only
`repositories/open-voice-admission/content/read` and regenerating its one-day
credential allowed the exact deployment. That action changed no image or
production route. The scope was removed again and the token disabled during
teardown.

The signed owner-bound request scheduled replica
`vyakti-z2-a100-eval--cv8jkv8-7794f6f7bd-g67b4` at 09:47:53Z. At
09:47:55.7038998Z Azure reported the GPU environment active with driver
580.159.04, CUDA compatibility through 13.0 and the exact immutable image in
`PullingImage`. At the final 10:08:12Z capture, after 30 valid-HMAC
`open_voice_runtime_warming` responses, the container remained unstarted and
unready with zero restarts. No deterministic model, kernel, OOM or application
failure was logged. No response audio, PerTh output, ECAPA, ASR, listener,
unseal or winner result existed.

The measured active interval through evidence capture was 1,216.296 seconds.
At the official measured fully active profile estimate of USD 6.354 per hour,
that is USD 2.1468 before storage, cross-region transfer, CPU admission,
requests, tax or rounding; the Azure invoice value was unavailable. The run
stopped inside the USD 75 and four-hour ceilings. Both exact apps were deleted
and read back absent before environment deletion; the dedicated environment
delete was accepted by Azure and was still in control-plane deletion while this
entry was first written. No local Docker, Microsoft browser or production
resource was used.

## `studio-signed-report-and-lifecycle-fixture-2026-08-28`

**Measured 2026-08-28, n=51 offline matched-pack checks, n=1 real r2 Studio
bundle import journey, n=4 browser WebCrypto attestation cases, n=1 replacement
and n=1 confirmed removal.** The offline pack suite passed 51 of 51 without a
network, cloud or model call. It generated a reusable RSA-2048 private key only
under the temporary private pack tree, re-exported the same public key id,
signed the canonical unsealed report, accepted the unchanged body, and refused
a changed listener count and a different pack key. Browser Chromium accepted
one valid signed result and refused a bit-changed body, wrong public key and
missing signature before returning model labels. The same browser journey
replaced the 8,455,625-byte r2 bundle, found the superseded IndexedDB bundle,
progress and injected result absent, then confirmed removal and found the
replacement bundle, progress, result and pointer absent. A sentinel bundle and
three sentinel localStorage records for another replica/run survived both
operations. Desktop 1440 by 1000 and mobile 390 by 844 had zero console errors
and zero horizontal overflow; every visible mobile experiment action measured
at least 44 CSS pixels. No mapping was unsealed and no audio was judged.
Two deterministic IndexedDB-delete failure injections, one during replacement
and one during confirmed removal, kept the current panel and replica pointer
unchanged and showed browser-storage failure copy; a valid replacement was not
misreported as an invalid pack.

## `owner-openvoice-receiptcanon-objective-2026-08-28`

**Measured 2026-08-28, n=1 frozen two-item retry plan, n=1 remote ACR build,
n=2 reused protected IndicF5 bases, n=2 signed OpenVoice conversions, n=4
objective artifacts, n=5 signed ECAPA service calls, n=4 Azure Speech calls
and n=0 listeners.** Plan SHA-256 was
`66a9b1ddded23216846d5eb9b8428497dd93805cfb5c05a5aa494952f0599496`.
It reused the same exact owner reference, transcript, consent, Hindi/Hinglish
texts and seed 31001 as the failed predecessor. Runtime source manifest
`9e4044ad65d09ba576fdc8b5b65f041504625f895d6e131ffac10ce2a83305c1`
bound the integral-float receipt canonicalizer and PerTh pad, apply, trim,
detect and hash order.

Remote ACR run `cu2d` received that source hash explicitly and produced runtime
digest
`sha256:ba777d18345fe308fb02ec59190575d0d174ac3242a8dc75c30c650755a8eb64`,
OCI config
`sha256:0dc38ed74fef109a1baba4652a4cffa18c4a69ebd271c7401ffd1cf8293c784a`
with 14 layers, and registry evidence SHA-256
`87ab7bf7f0bb11bf97af708cd0fa7d48f19a9c7cc7392a6d9b9e16dd2f2a9891`.
Live container rehashing matched all four Docker-copied runtime files and the
baked source hash. Startup reverified OpenVoice source commit, model revision,
checkpoint and config, and independently reproduced model commitment
`bd3c6932685166b20face14b9ecd08d5e5f4ef3ff74ae78caf824a9c1553e8ca`.
The runtime and gate were ready with zero restarts before calls.

The canary and the one permitted second conversion both returned signed HTTP
200. Their verifier matched output geometry and hash, receipt self-hash, base
provider/model/commitment/generation receipt/audio/text, owner reference,
consent, converter pins/source hash/tau/native-watermark state, and final PerTh
verification. There were exactly two conversion calls and zero retries.
Conversion elapsed times were 11,683 ms and 467 ms; mean was 6,075 ms. Both
reused bases and both conversions reported PerTh verified.

Against four 3-second owner-reference windows, protected base n=2 ECAPA mean
was 0.726677 and converted n=2 mean was 0.680976, a decrease of 0.045701.
Azure Speech `hi-IN` raw WER worsened from 17/56, 0.303571, to 21/56, 0.375.
The curated cross-script WER was the same 0.303571 to 0.375 change; its CER
worsened from 62/242, 0.256198, to 72/242, 0.297521. These are regression and
intelligibility signals, not human likeness, accent or naturalness scores.

Objective report SHA-256 is
`b53a1845e4a69df547bc1662202b92866185e7edcbe41d2391351ffb010c4c0b`.
Peak-safe offline sealing produced four opaque 13,280 ms stimuli at common RMS
0.0973137; manifest SHA-256 is
`650a90e1775d03c8a87dc9167e092619a3289808c74852dca59dadcfd699c5e1`,
encrypted mapping receipt SHA-256 is
`f03ccf3f971847644e77db0948aaaa819497afb7a8cd59537fb1d699a05e09a8`,
and the AES-256-GCM key was overwritten and never written. Frozen verification
reported base 2, converted 2, rejected 0. The retry reserved USD 22 of USD 30;
combined with the predecessor it reserved USD 42, while actual invoice cost is
unavailable. Final Azure readback found converter runtime, converter gate and
voice-evidence apps min zero with no active revisions and zero replicas. No
audio was opened, no mapping unsealed, no local Docker or production route was
used, and no winner was claimed.

## `openvoice-windows-acr-wrapper-fixture-2026-08-28`

**Measured 2026-08-28, n=1 Windows `.cmd` shim in a path containing spaces,
n=1 argument containing spaces, n=1 old direct-spawn negative, n=1 non-Windows
injected direct-execution control and n=22 focused OpenVoice checks.** The old
`spawnSync(<absolute-cmd>, args, { shell: false })` control failed on this
Windows host. The platform-aware launcher resolved the same absolute shim,
invoked it through the existing absolute `ComSpec` with `/d`, `/q`, `/v:off`,
`/s`, `/c`, `windowsVerbatimArguments: true` and `shell: false`, then captured
every original argument exactly, including `path with spaces/task.yaml` and the
64-character source-manifest assignment. A metacharacter-bearing argument was
rejected before spawn. An injected non-Windows run called executable `az`
directly with the unchanged argument array and `shell: false`.

The offline plan bound exactly the four Docker-copied runtime files and emitted
canonical source-manifest SHA-256
`717b20e3b11a65ead273664c0bbe5efe0b5a6a51ed0a96a5b434938a356d157e`
as the distinct Azure argument
`SOURCE_MANIFEST_SHA256=717b20e3b11a65ead273664c0bbe5efe0b5a6a51ed0a96a5b434938a356d157e`.
It reported `localDockerInvoked=false`. The focused converter suite passed 22
of 22. No Azure, registry, model, Docker or production call ran in this check.

## `zonos2-wus3-regional-acr-pull-and-cuda-stop-2026-08-28`

**Measured 2026-08-28, n=1 West US 3 Basic registry, n=1 server-side immutable
runtime import, n=1 regional broker import, n=1 dedicated Container Apps A100
environment, n=1 private runtime, n=1 signed public gate, n=1 scheduled replica,
n=8 signed readiness responses and n=0 synthesis or audio results.** Azure's
current control-plane price data listed Basic ACR at USD 0.1666 per registry-day
and stored data at USD 0.10 per GB-month. Basic includes 10 GiB, permits 40 TiB
and a 195 GiB layer, so it was the cheapest tier that fit this image. Registry
`vyaktiz2w3a8281729` was created in West US 3 with admin credentials disabled.
Server-side import took approximately 20 minutes and reproduced runtime digest
`sha256:7d1f97efffe35e23a356a12494e0333cdfb586c5a1dfcd8f06165a27abdb301b`,
config digest
`sha256:0959dac55edf74ddb5c5a3c26584801a2dfaad11f470721594cd264597db8ec1`,
13 identical source and target layer digests and 23,644,395,155 compressed layer
bytes. The broker digest was
`sha256:214a6baa15eeb4c87e06fc098c19206aad40e8e898005e6b8a948c88fc379f80`.

The frozen signed request bound owner replica
`6aff3202-abbd-4ca6-976b-4009ed5af028`, source SHA-256 beginning `c242261b`,
reference SHA-256 beginning `26459769`, consent SHA-256 beginning `fe1d038e`,
the exact 25,000 to 35,000 ms source window, and Hindi, Hinglish and English
texts. Azure scheduled `vyakti-z2-reg-a100-eval`. At
11:03:46.5448134Z its system event reported `PulledImage` for the exact runtime
digest with image size 23,644,340,224 bytes. Elapsed pull time was 194.29
seconds. The prior Central India pull remained incomplete after 1,216.296
seconds, so regional proximity improved completed-pull latency by at least
6.26 times relative to that prior lower bound; it is not an end-to-end startup
ratio.

At 11:05:05Z the container was created and started, then its exact application
failure was `/srv/zonos2/app.py`, line 248,
`RuntimeError("zonos2_cuda_required")`; the process exited code 3 because
`torch.cuda.is_available()` was false. Azure restarted it and cached repulls
took 17, 48 and 18 ms before the same deterministic failure. Eight frozen
canary attempts returned valid-HMAC `open_voice_runtime_warming`; the run was
stopped immediately instead of consuming the 18-attempt bound. No response
audio, disclosure, PerTh result, ECAPA, ASR, listening, unseal or winner claim
existed.

The conservative billable interval from revision creation at 11:00:30Z through
final app-absence readback at 11:10:18.0542017Z was 588.0542017 seconds. At USD
6.354 per fully active GPU hour, GPU exposure was at most USD 1.037916. Adding
one full Basic registry-day and one full day of storage above the included 10
GiB gives a conservative lane estimate of USD 1.2446 before negligible CPU,
requests, transfer, tax and rounding; the Azure invoice value is unavailable.
Both apps were deleted and read back absent, the temporary registry and its
token and scope map were deleted and read back absent, and the dedicated
environment was `ScheduledForDelete` with no apps. The source ACR token remained
disabled and repository-scoped. No local Docker, Microsoft browser or
production route was used.

Offline source inspection found official ZONOS2 based on
`pytorch/pytorch:2.9.1-cuda12.8-cudnn9-runtime`; its exact upstream lock selects
PyTorch 2.9.1 and the CUDA 12.8 runtime, cuDNN, cuBLAS, cuFFT, cuSOLVER,
cuSPARSE, NCCL, NVTX and Triton packages on x86_64. Azure's A100 event announced
driver 580.159.04 compatible through CUDA 13.0. This narrows the failure away
from a CPU-only lock or an obvious CUDA-version mismatch, but it does not prove
the missing device-exposure mechanism. No diagnostic image was built or run.
## `studio-owner-journey-responsive-local-2026-08-28` — focused clone status and one-link video metadata pass local executable and browser checks (2026-08-28)

- **n / method:** one real `StudioApp` layout fixture at 1440x1000 desktop,
  390x844 phone, and 844x390 landscape; scenarios `empty`, `processing`, and
  `voice-ready`; controlled in the in-app browser against the local Vite
  server. Measured document scroll width equalled client width at all three
  sizes. No visible button was below 44 CSS px after the final pass.
- **Status truth:** the processing fixture rendered setup progress 33% from
  one of three completed setup facts and current-work progress 63% from the
  job's real 5/8 counters. The no-source fixture rendered 0%. No interval,
  remaining-time guess, or quality percentage exists in the new status path.
- **Lineage:** the voice-ready fixture displayed Voice draft v2, one bounded
  source ID, its 10-second selected reference, source type/date, and a working
  Manage sources action. The review response exposes no storage locator or
  transcript content.
- **Lifecycle actions:** the local browser reached the explicit DELETE dialog
  from the first viewport and reached the create-new-workspace screen without
  erasing the existing clone. Test UI displays Building/Ready to test rather
  than the production consent lifecycle label.
- **YouTube metadata:** `evals/videoenroll.mjs` passed 84 checks, including a
  validated-id oEmbed URL, valid title/channel response, invalid channel
  refusal, and 404 refusal. The browser one-link fixture displayed the found
  video and channel with no second channel field in the immediate video form,
  then offered file upload because live extraction is unconfigured.
- **Focused gates:** TypeScript build; replica review 37/37; self-test UI all
  checks; voice preview UI 10/10; scoped lint and diff checks passed before the
  final release phase.
- **Limit:** this is local product-flow and contract evidence, not a successful
  live YouTube audio extraction and not a voice-quality result.
- **Release and live readback:** `node scripts/verify-release.mjs` passed all
  16 checks, including the 850,141 ms broad eval and both live relational
  gates. Vercel production deployment `5K3iACm9xeKrxqRc2KCi1r57qmUT` reached
  Ready and aliased `vyakti-replica-lab.vercel.app`. An authenticated owner
  readback showed 100% setup for the ready clone, visible start-new/delete
  actions, Voice draft v1 bound to one source and its 10-second reference, and
  no `consent pending` test label. A live one-link metadata request resolved a
  real YouTube title/channel, hid the second channel field, and offered file
  upload because extraction remained unconfigured.

## `production-front-end-lecture-clone-journey-2026-08-28` — the real owner UI reaches protected replay but cold-start recovery needs two manual retries (2026-08-28)

- **n / method:** one authenticated production browser journey at
  `vyakti-replica-lab.vercel.app`, driven only through visible Studio controls,
  using the existing `Hinglish Lecture Test` whose two 251 MiB source rows
  correspond to the supplied 262,879,879-byte lecture.
- **Source and build:** Source `1ECB89` showed Ready and 8/8 processing steps;
  duplicate Source `B9AA12` showed Stopped at 3/8 with `Voice evidence not
  ready`. Setup showed 100%. Voice draft v1 named Source `1ECB89` and a
  10-second selected reference.
- **Preview:** the first Hinglish request stopped after about one minute with
  `open voice runtime warming`. One manual retry entered automatic checks but
  returned the same terminal error. A second manual retry completed the cold
  start, rendered a 7.92-second protected clip, and showed receipt prefix
  `bf61f537`, model commitment prefix `b66dbbe202`, and 15 reviewed Hindi
  pronunciation changes.
- **Replay:** the native audio control loaded at readyState 4, playback moved
  from 0 to 7.92 seconds, and finished with `ended=true`, `paused=true`.
- **Journey verdict:** source upload history, setup progress, lineage,
  generation state and replay are understandable. The cold-start experience
  is not yet acceptable because a user must press `Try again` twice before the
  successful automatic cycle. This is one run and not a voice-likeness or
  naturalness result.

## `guided-voice-capture-local-2026-08-28`

**Measured 2026-08-28, n=1 real StudioApp loopback fixture, n=1 deterministic
local microphone stream, n=1 completed Hinglish recording, n=1 review, n=1
queue admission, desktop plus 390 by 844 phone viewport.** Microphone
initialization occurred only after Start recording. The live state exposed a
timer, real sample level and 30-second target. Stop and review produced a 24
kHz WAV. Use this recording created a timestamped
`vyakti-hinglish-voice-*.wav`; the existing selected-file queue showed its
duration, Hinglish label and enabled private-upload action.

Phone document scroll width and client width were both 375 CSS pixels. Browser
console and warning logs were empty. All three language controls and primary
actions were at least 44 CSS pixels high. `quickvoicecapture` passed 10 of 10
checks with an eager-microphone negative control. `studioselftestui`,
`replicaenrollment`, TypeScript, copy and targeted lint passed in the same
source state. This fixture proves browser capture, PCM/WAV handling, cleanup,
review and queue integration. It is not a live production upload, model run,
speaker-similarity result, or proof that the selected reference is optimal.

## `primary-voice-pointer-local-and-live-schema-2026-08-29`

**Measured 2026-08-29.** In one real Studio loopback browser session, two
separate Hinglish recordings cleared the 12-second minimum, reviewed locally,
uploaded through the real create/PUT/finalize UI sequence and reached the
processing state without a blank page. The first recording was auto-starred
after finalize. The second recording then became primary and the first became
supporting. An explicit "Use for voice" action switched the star back. At every
point the ledger showed exactly one "Primary voice" badge and retained both
sources.

Migration 066 applied live as three independently repeatable Neon requests.
Readback found its primary key, unique source constraint, and both owner and
source `ON DELETE CASCADE` foreign keys. Its selected-artifact backfill created
four existing replica pointers; two of those pointers cover the two owner test
projects repaired from the 38-percent processing failure. Focused gates were
13/13 primary-source checks, 12/12 browser-capture checks, the full enrollment
suite, OpenVoice 64/64, TypeScript and targeted lint. This is selection and
journey evidence, not a speaker-likeness result.

## `azure-fast-transcription-long-source-repair-2026-08-29`

**Measured 2026-08-29, n=3 live source jobs across two owner test replicas.**
The sources were 351,480 ms, 377,928 ms and 377,928 ms. After the exact worker
adapter accepted Azure's structurally empty sentinel phrase and derived spans
only from positive word evidence, all three transcription jobs completed, all
three voice-quality jobs completed on their first attempt, and all three source
rows reached `ready` with empty rejection and failure codes. The two replicas
then held draft VoiceGenome builds in review.

Azure provider-budget readback was 332,400 micro-USD spent and zero reserved,
or USD 0.3324 settled for the worker attempts. A direct adapter check against
the exact 6 minute 18 second WAV produced 19 spans and 738 words without
printing transcript content. This cost is the internal reservation ledger, not
an ingested Azure invoice.

## `primary-recording-production-journey-2026-08-29`

**Measured 2026-08-29, n=1 authenticated production desktop journey, n=1
375-CSS-pixel phone viewport, n=1 real scale-to-zero protected Hinglish
preview.** Vercel deployment `GRxpUwY83thixTLhChXyFEjnhZCR` reached Ready and
aliased `vyakti-replica-lab.vercel.app`. The signed-in Studio showed the guided
12-to-60-second recorder first, retained file/audio/video/document/context
options, and identified one exact primary source plus its selected 10-second
voice reference. The phone source screen had document scroll width 375 and
client width 375, zero visible sub-44-pixel controls, and no console warnings
or errors.

The first post-deploy request proved the previous defect: the signed broker
code `open_voice_runtime_warming` rendered as terminal Preview stopped. After
the bounded classifier fix and redeploy, the identical path stayed on Warming
up and completed automatic checks without a user click. Ready was first
observed 418 seconds after the click, outside the displayed 120-to-300-second
estimate. The measured result moved the server and Studio range to 120-to-480
seconds and expanded the automatic client retry budget to the same 480-second
ceiling; the former five-minute ceiling is now an executable negative control.
It then exposed a nine-second WAV, receipt prefix `d45d9285`, model
commitment prefix `b66dbbe202`, and 15 reviewed Hindi pronunciation changes.
Native playback advanced and completed at 0:09 of 0:09. This proves delivery,
receipt rendering, playback and retry recovery. It does not prove likeness,
naturalness, a one-to-five-minute cold start, or a winner over another model.

## `production-meet-phone-target-audit-2026-08-29`

**Measured 2026-08-29, n=1 authenticated production Meet page at a 390 by 844
viewport.** The page measured inner width 390, document client width 375 and
document scroll width 375, so there was no horizontal overflow. The final
deployment showed the corrected two-to-eight-minute cold-start copy. A
whole-page interactive-element scan found the logo at 26 pixels high and the
Mirror Call tabs at 35 pixels high; the transparent file input was excluded
because its visible 48-pixel label is the real control. The final mobile CSS
gives the logo and both tabs a 44-pixel minimum, and the focused Meet UI suite
passes 12/12 including the old 35-pixel negative control. After deployment
`dpl_Fe1PSBYbASm7JRz1eNYurJvZfjKM`, the same authenticated 390 by 844 page
remeasured 375 client and scroll width, showed the two-to-eight-minute copy and
the exact primary-source lineage, and returned zero visible opaque interactive
elements below 44 pixels.

## `vercel-self-test-backend-flags-empty-2026-08-29`

**Measured 2026-08-29, n=1 production environment read before correction,
n=1 read after correction, n=24 active self replicas, n=1 exact upload
authorization canary, and n=1 Azure worker execution.** A production
`vercel env pull` showed both Vite
test markers populated, while `REPLICA_SELF_TEST_MODE`,
`REPLICA_SELF_TEST_ENVIRONMENT`, and `REPLICA_SELF_TEST_OWNER_USER_ID` were
empty. That exact split made the browser say Internal test workspace while the
upload API skipped its bootstrap and returned
`capture_and_storage_consent_required`. After replacing the three backend
settings with exact non-sensitive values, a second production read returned
`true`, `internal-owner-testing`, and `all-authenticated`.

The all-account bootstrap then evaluated every active self replica through the
production function: 24 of 24 applied, 118 missing scope rows were inserted,
and the live readback found all 24 fully granted. An exact one-byte private
source authorization canary on the signed-in `Ashutosh 2` replica entered
`pending_upload` without the consent error and was immediately moved to
`deleting`; no blob was uploaded. Vercel deployment
`GbibmXP1QeSgoiPYj2NuYZLdVkbr` reached Ready on
`vyakti-replica-lab.vercel.app`. Remote ACR run `cu2n` produced worker digest
`sha256:2776f1d8e866011afd7de55eb6d1a5010105dc44fa7dd334047776e451528c23`,
and manual job execution `vyakti-replica-processing-wdb1znv` pulled that exact
digest and succeeded in 25 seconds. A final authenticated production browser
reload exposed recording and file intake with no consent ceremony or consent
error. Focused guard checks pass 25/25. No local Docker was used.

## `fd4006-processing-recovery-2026-08-29`

**Measured 2026-08-29, n=1 production browser recording, n=2 failed scheduled
executions, n=1 remote image build, n=2 recovery executions.** The signed-in
`Me` replica's 1,978,412-byte, 41,216-millisecond Hinglish source `FD4006`
finalized successfully but remained `quarantined` at `integrity/queued`, attempt
zero. Scheduled executions at 22:10Z and 22:15Z failed before leasing it. The
surviving 22:15Z replica log contained exactly
`{"error":"clamd_exited_during_startup"}`; its processor exited 1.

The Windows source copy contained carriage-return line endings in
`clamd.conf`, while the image normalized only `freshclam.conf`. Focused worker
checks passed 37/37 after the second path was added. Remote ACR run `cu2p`
succeeded in 98.727 seconds and produced immutable worker digest
`sha256:dc8829be70c6c8aa8fdf53460aec8a1725d7897ed4f095c7a79a7a3207bee4bd`.
The job readback preserved 21 environment bindings, seven secret bindings and
the five-minute schedule. Recovery executions `y0vefkv` and `ptxtqbg` pulled
that exact digest and both succeeded. All eight source steps completed on
their first attempt with empty failure codes; the source reached `ready` at
22:28:47Z. VoiceGenome build v1 then reached `review` with a draft genome and
no failure code at 22:31:27Z. The four following scheduled executions at
22:30Z, 22:35Z, 22:40Z and 22:45Z also pulled the corrected digest and
succeeded. The final release runner passed all 16 gates, including the live
relational checks. This is processing and build-delivery evidence, not a
voice-likeness result. No local Docker was used.

## `pipeline-reliability-live-release-2026-08-29`

**Measured 2026-08-29, n=1 remote worker build, n=1 deployment, n=1 bounded
manual recovery execution, n=1 retired-draft replica and n=1 live alert.** ACR
run `cu2r` succeeded in 95.4 seconds and produced immutable worker digest
`sha256:605b8921b675ce4307fdb75c08b4948da6ebba69ef4cb81c6caa30d757cb62b0`.
Live readback preserved 21 environment bindings, seven configured secrets, the
3,300,000-millisecond run budget and 3,600-second timeout while changing the
schedule from five to two minutes, container startup retry from zero to one,
and jobs per run from four to twelve. Manual execution
`vyakti-replica-processing-bm3hbuz` succeeded from 23:27:01Z to 23:33:48Z.

The `Ashutosh 2` replica had only retired build v1 before this release. The
level-triggered reconciliation created v2 and brought it to `review` with an
empty failure code at 23:28:20Z without a new upload or owner action. At
readback there were zero overdue jobs. One older 262,879,879-byte lecture had
instead reached a new, separately diagnosed Azure transcription input
boundary; its retry was paused before attempt exhaustion and is not counted as
repaired by this measurement.

Azure action group `vyakti-replica-ops` is enabled with the owner's email, and
severity-one metric alert `vyakti-replica-processing-execution-failed` is
enabled on failed Container Apps Job executions at a five-minute evaluation
frequency. Focused worker, queue, recovery, model-build, activity and watchdog
gates passed; the release runner passed all 16 checks. No local Docker was
used. This proves scheduling and recovery delivery, not voice quality.

## `voice-preview-stale-warmth-baseline-2026-08-29`

**Measured 2026-08-29, n=1 authenticated production Hinglish preview from a
zero-replica start.** Generation authorization began at 22:56:55.712Z. The
private runtime completed application startup at 22:59:14.500Z, 138.788
seconds later, but the next synthesis was not authorized until 23:05:38.273Z.
The protected generation sealed at 23:06:43.305Z, 587.593 seconds after the
first authorization. Thus the runtime was already ready for 383.773 seconds
while independent Vercel processes continued returning local warming state.
The browser ultimately rendered a playable seven-second protected WAV with
receipt, model commitment and pronunciation plan.

Remote ACR run `cu2q` then produced admission-broker digest
`sha256:30fd5c6157db558c1a2fcf0d24f3f2ffe7d24a374966c688efa7379628212f5c`,
which is live with min replicas zero and max replicas two. The private runtime
remained on digest
`sha256:625edc223f7063e744d6463dd7443daeaa7097552997a7a4e47c99888cfa86d8`
with external ingress false. This measurement establishes the old latency and
the broker deployment; it does not yet claim the post-web-deploy latency or
speaker likeness.

## `long-source-private-asr-recovery-live-2026-08-29`

**Measured 2026-08-29, n=1 exact production source, n=4 transcription
attempts, n=1 successful paid provider call.** Source `B9AA12` is the owner's
duplicate of the supplied 262,879,879-byte, 6,571,992-millisecond lecture.
Attempts one through three stopped before a provider result while the
large-input transport was absent. A mistaken operator recovery reset exposed a
released-reservation collision on attempt one; no duplicate paid result was
accepted. The corrected monotonic recovery leased attempt four at 00:08:58Z,
settled transcription at 00:11:14Z, completed voice quality at 00:14:04Z, and
left the source `ready` with all eight jobs complete and empty failure codes.
Manual execution `vyakti-replica-processing-pxdbpu4` succeeded at 00:14:24Z.

ACR run `cu2t` produced immutable worker digest
`sha256:61b43aa71be78bf8ae1be412b4e1b056a89bb3021ea6434085a57434a14f990d`.
The live job readback preserved the two-minute schedule, retry limit one,
3,600-second timeout, 3,300,000-millisecond run budget, twelve jobs per run,
21 environment bindings and seven secret bindings. The completion receipt
binds original SHA `632c30c9...9df9d` to a 103,191,942-byte FLAC transport SHA
`5ad5491c...e987e` using transform `azure-asr-flac-16k-mono-v1`; the durable
source bytes were not replaced. The internal provider ledger settled
6,572,000 audio milliseconds for 657,200 micro-USD, or USD 0.6572. This is the
application budget ledger, not an ingested Azure invoice, and it is pipeline
delivery evidence rather than transcription-accuracy or voice-likeness
evidence.

## `primary-voice-isolation-and-preview-live-2026-08-29`

**Measured 2026-08-29, n=1 production replica with two ready duplicate audio
sources, n=1 rebuilt worker, n=1 VoiceGenome build and n=1 authenticated cold
preview.** Before the isolation fix, level-triggered self-test reconciliation
could replace an existing valid selected enhancement with a later candidate,
and the review/build query could admit accepted artifact-independent evidence
from both ready sources. The aggregate exceeded 2,000 accepted evidence rows,
so the primary star shown in Studio did not fully constrain the built voice.

Remote ACR run `cu2u` produced the final worker digest
`sha256:bc56c1cf0172ed33f6aeec2bc92bb97989a55f2a7c5cc5124b40b5f9da37b40f`.
The live `Hinglish Lecture Test` readback then produced VoiceGenome v2 in
`review` with an empty failure code, exactly one enrollment artifact
`c6759c8d-1c65-53e9-a75d-a6770f769f39`, exactly one source
`1ecb89fc-b12d-4d84-a714-ffca2d5b021c`, and 1,683 target-speaker evidence
segments. The second ready duplicate remained supporting material and did not
enter the voice build. The due processing queue read zero.

Production Vercel deployment `dpl_GD9DMfUvSDz18rtuH52LvAFAVHLB` reached
Ready. From a zero-replica start, the authenticated browser stayed in a
nonterminal warming/generating state and rendered protected audio after 342
seconds. Generation `ab5741b0-7818-43f3-9b9e-7f02bf6b3e16` sealed against
genome v2 and the exact selected artifact with model
`open_chatterbox_multilingual_v3`; the browser loaded the 8.72-second WAV and
native playback completed at 8.72 of 8.72 seconds with no media error. The
unauthenticated watchdog probe returned 401 as expected. The final release
runner passed all 16 checks. This proves source isolation, processing,
protected delivery and replay. It does not prove speaker likeness,
naturalness, accent quality or a winning model. No local Docker was used.

## `mirror-call-dead-path-audit-local-2026-08-29`

**Measured on 2026-08-29.** The live database contained n=1 Mirror Call
session and n=0 windows, turns, deltas, conditioning selections and fine-tune
jobs. Static tracing found two independent dead seams: the browser sent
multipart audio while the server required a JSON source handle, and call create
and status read process-local warmth without waking or probing the private
runtime. After the bounded local fix, production-shaped suites passed 120/120
reply checks, 464 API/store checks and 67 client/state checks; the client test
executed hash, private upload, finalize and JSON ingest. Three read-only live
Neon EXPLAIN statements parsed at total costs 10.65, 9.48 and 16.65.

**Boundary.** No deployment or real call window occurred in this measurement.
Owner-speaker ECAPA production scoring remains absent, so voice adaptation is
correctly blocked and no likeness or call-quality improvement is claimed.

## `mirror-call-production-call-window-and-gpu-canary-2026-08-29`

**Measured 2026-08-29, n=1 dedicated production account, n=1 replica, n=1
open call session, n=1 successful 7,650-millisecond synthetic call window and
n=1 private T4 cold start.** Vercel deployment
`dpl_9zgrwUbGNMukFnx4gT5Tc82NWqUN` reached Ready after the final standard
encrypted Azure Speech bindings were attached. The public Studio path created
an owned session, authorized a signed private upload, finalized an exact
24 kHz mono PCM16 derived source, and ingested it through the deployed Mirror
Call endpoint. Azure Speech returned a 77-character transcript in 6,618
milliseconds. The database settled sequence 6 as `transcribed` with provider
`azure-speech-short`, model `azure-speech-short-v1`, purpose
`mirror_window`, capture mode `derived`, zero ordinary processing jobs and
zero fine-tune jobs. The ordinary source-list endpoint hid every canary call
window.

The first signed runtime status was cold/unreachable, the next was warming
with a 480-second server estimate, and the same private T4 reached
`live`/`warm` after 291 seconds. The session ended successfully with model
training not connected, searchable relational memory not connected, emotion
not measured, and voice adaptation blocked because production owner-speaker
scoring is absent. The replica was revoked, an erasure request was created,
and the dedicated auth user returned 404 after deletion. Both full release
runs passed all 16 gates; the final broad eval took 613,690 milliseconds.

**Boundary.** The canary audio was Windows synthetic speech, not the owner's
microphone, and no audio was listened to. This proves deployed transport,
ASR, isolation, truthful readiness and cleanup. It does not prove call
naturalness, owner likeness, Hindi/Hinglish accuracy, relational learning,
emotion understanding, expressive voice adaptation or a winning voice model.

## `roman-hinglish-overflow-frontend-local-2026-08-29`

**Measured locally on 2026-08-29.** One production owner attempt with a full
280-character Roman Hinglish preview returned
`hindi_text_frontend_too_many_language_switches` before inference. A
production-shaped 280-character regression paragraph with alternating Hindi
function words and English technical terms now produces one Hindi-conditioned
synthesis segment, retains every UTF-16 transformation source span and carries
the explicit bounded-coalescing warning in its content-addressed plan. A
separate n=1 alternating Devanagari/Latin negative control still returns the
named 413 refusal.

The focused text frontend passed 18/18 checks, OpenVoice 70/70 and the voice
panel 101/101. TypeScript, the user-visible copy gate and the Impeccable
detector also passed; the detector reported zero findings for the changed error
surface.

**Boundary.** This is parser, receipt and UI-copy evidence. It does not yet
prove a deployed preview, audible pronunciation, naturalness, owner likeness
or a model-quality win.

## `roman-hinglish-overflow-production-canary-2026-08-29`

**Measured on production on 2026-08-29, n=1 protected output.** Vercel
deployment `dpl_EZg65L18aXHLHxB5mN3pveefmqUX` reached Ready after all 16
release checks passed. The owner-bound preview API accepted the exact
280-character Roman Hinglish regression at the Studio limit, returned honest
202 cold-GPU responses, then returned generation
`16b179e9-4200-42f9-8d3b-23f2ed592cbd` as a 985,004-byte `audio/wav`. The
response carried a valid 64-hex text-plan binding and reported 12 reviewed
pronunciation transformations. The old language-switch refusal did not recur.

**Boundary.** The browser's existing session expired during the deployment
reload, so the terminal canary used the same owner-authenticated production API
contract rather than claiming an authenticated browser completion. The WAV was
not played or judged. This proves deployed parsing, cold-start progression,
protected delivery and receipt binding, not pronunciation quality,
naturalness, likeness or a winning model.

## `short-primary-reference-fragmentation-production-2026-08-29`

**Measured on production on 2026-08-29, n=2 independent authenticated
replicas.** The `dad` primary WAV was 20,992 ms with 10,640 ms of measured
non-overlapping speech; the `Aryan` primary WAV was 32,683 ms with 19,835 ms of
measured non-overlapping speech. Both completed integrity, malware scan, media
probe and diarization, then failed once at `separate` with
`reference_window_no_candidate`. At the readback there were zero due jobs and
zero live leases, so shared-user queue contention did not cause either stop.
The local production-shaped eligibility function accepted exactly these two
primary/self/no-third-party WAVs. Focused processing passed, the worker suite
passed 40/40, the processing sweep passed 44/44, live Neon parsed the expanded
owner-scoped source query, TypeScript passed and the full release runner passed
all 16 gates.

**Boundary.** This is failure diagnosis and pre-deploy contract evidence. At
this checkpoint the corrected worker image had not yet been built or deployed,
the two stopped jobs had not been requeued, and no recovered reference audio or
voice-quality result existed.

**Production recovery, same date.** Remote ACR build `cu2w` succeeded in
109.798 seconds and produced immutable worker digest
`sha256:ebd9fd8bdf49a7300d6cee565dfc3b729626ebeff38833d30b3f5096bd211cd6`.
Image-only deployment preserved the two-minute schedule, parallelism one,
twelve jobs per run, retry limit one, 3,600-second timeout, 21 environment
bindings, six secret references and 1 CPU/2 GiB. The exact `dad` recovery
execution succeeded in 94 seconds. A friend replaced the first `Aryan` source
during the build; the final audit found its new 21,419 ms source had failed on
the old image one minute before deployment, and its separately guarded
recovery execution succeeded in 91 seconds. Both sources reached `ready` with
8/8 complete jobs, one 10,000 ms `primary_self_capture` pass-through reference,
an identity-preserving selected enhancement, VoiceGenome v1 `draft` and model
build `review`. Final global readback found zero queued, retry, leased, blocked
or failed processing jobs. No local Docker command ran.

**Quality boundary.** This proves deployed completion, lineage and isolation.
The recovered audio was not played or compared with either owner, so it does
not prove likeness, naturalness, pronunciation or a winning voice model.

## `clone-and-call-unit-economics-live-2026-08-29`

**Measured 2026-08-29 from live Azure resource readback, n=2 production T4
apps, n=1 processing Job, n=98 recent scheduled executions and n=94 bounded
idle-shaped executions.** Both `vyakti-voice-evidence` and
`vyakti-open-voice` use the Central India `Consumption-GPU-NC8as-T4` profile
at 8 vCPU and 56 GiB, with min replicas zero and max replicas one. The worker
runs every two minutes, one execution replica at a time, at 1 vCPU and 2 GiB,
and admits up to twelve sequential processing jobs per execution. The durable
queue read zero queued, retry, leased or failed processing jobs. In the last
two hours, three ordinary sources were ready and three VoiceGenome builds were
in review.

The official Azure Retail Prices API returned Central India meters of USD
0.000102 per T4 GPU-second, USD 0.000024 per active vCPU-second and USD
0.000003 per active GiB-second. The fully active deployed T4 profile is
therefore USD 1.6632 per hour. Azure Speech returned USD 1.00 per audio hour
for S1 real-time speech-to-text and USD 0.36 per audio hour for Fast
Transcription. The live Basic ACR returned USD 0.1666 per day plus USD 0.10
per stored GB-month above its included 10 GB. Live ACR usage was
144,368,004,482 bytes.

Among 94 recent scheduled executions lasting no more than 40 seconds, mean
wall time was 24.064 seconds, p50 24 seconds and p90 28 seconds. At 720
executions per day, that shape costs an estimated USD 15.59 per 30-day month
before the Container Apps monthly CPU/memory grants, or USD 10.19 if those
grants are otherwise unused. The current ACR list estimate is about USD 18.5
per month including overage storage. These are shared fixed Azure costs;
Vercel, Neon and Supabase plan charges are not attributed here.

**Derived unit estimates, not invoice line items.** A clean 30-second primary
recording uses about USD 0.003 of Fast Transcription and about USD 0.009 of
five-minute worker CPU/memory. Applying the previously measured 489 to 534
second evidence-T4 allocation window adds USD 0.226 to USD 0.247, so one
isolated cold short clone is budgeted at USD 0.24 to USD 0.30. Five short
clones sharing one warm allocation are budgeted at roughly USD 0.06 to USD
0.10 each, with queueing rather than five-way GPU parallelism. A long upload
adds USD 0.006 per source-audio minute for Fast Transcription; the already
measured 109.5-minute production lecture settled USD 0.6572 in the internal
provider ledger.

For a one-minute web/app conversation assumed to contain 30 seconds of user
speech, 30 seconds of clone speech and two model replies: Azure real-time STT
is USD 0.0083; Chatterbox at the measured warm RTF 0.79 consumes about 23.7
T4 seconds or USD 0.0109; the current Gemini 3.6 Flash reasoning lane is about
USD 0.0092 to USD 0.0202 for two measured cached-to-uncached turns; CPU audio
protection and request/storage overhead stay below about USD 0.002. The warm
marginal estimate is therefore USD 0.030 to USD 0.042 per conversation minute.
One full minute of clone speech, rather than a half-duplex 30 seconds, consumes
about USD 0.0219 of warm T4 synthesis before reasoning and STT.

A first scale-from-zero call can additionally pay roughly USD 0.23 to USD 0.35
of T4 allocation, consistent with measured 291 to 418 second production cold
readiness plus cooldown. Keeping one replica always available is estimated at
USD 1.0584 per idle-classified hour to USD 1.6632 per active hour, or about USD
773 to USD 1,214 for 730 hours. This is why the current min-zero deployment is
cheap while idle but is not yet an instant-answer telephony service. PSTN or
SIP carrier charges are excluded because no carrier is connected and rates are
destination-specific.

**Boundary.** The arithmetic uses public retail meters, live resource shapes,
recent execution walls and dated internal provider measurements. It is not an
ingested Azure invoice, does not allocate shared free grants across products,
and does not prove five-way latency or call quality. Actual agreement pricing,
tax, foreign exchange, carrier charges, Vercel, Neon and Supabase plans can
change the billed total.
## `voice-preview-and-worker-reliability-production-2026-08-29`

**Measured 2026-08-29, production read-only audit plus one bounded worker deployment.** The prior 12-hour preview ledger contained n=58 generations: n=13 sealed and n=45 marked failed. All 45 failure codes were scale-to-zero lifecycle states: 32 `open_voice_runtime_warming`, 12 `voice_preview_wake_in_flight`, and one `voice_preview_wake_dispatched`. Recent sealed outputs bound distinct selected owner-scoped 10,000 ms PCM references, so the reference wire was connected even though likeness remained unproved.

Remote ACR run `cu2x` built the combined processing worker in 114.172 seconds at 2 CPU. Registry readback resolved immutable digest `sha256:1a72cbe44822743bde71893201d0b3dd046206d163dea054b82518874564ae25`, 386,937,008 compressed bytes. Image-only deployment preserved schedule `*/2 * * * *`, retry limit one, timeout 3,600 seconds, parallelism one, twelve jobs per run, 21 environment bindings, seven secret references, and 1 CPU / 2 GiB. Manual execution `vyakti-replica-processing-6d022t6` ran the exact digest and succeeded in 26 seconds. A live Neon readback found 88 complete jobs and zero jobs in every other state.

The isolated Hindi admission app was updated from broker digest `sha256:3229c647...` to already-qualified digest `sha256:e6539e6975eff9dd90db570cdf735c2ad245ead8da74269d6b69d111e3cadde9`; the HMAC secret reference, private runtime origin, min replicas zero, max replicas two, and Hindi runtime digest were preserved. This removed a signed text-plan receipt mismatch; it is not a Hindi model-quality result.

**Boundary.** The worker canary was idle-shaped because the durable queue was already complete. It proves the new image starts, reconciles, and exits successfully, not a fresh long-audio provider run. The selected voice references and protected clips were not listened to in this measurement.

## `phonellm-official-closure-review-2026-08-29`

**Measured 2026-08-29, n=1 exact public model revision and n=34 repository files, using the official Hugging Face model card and unauthenticated model API.** Revision `8e76aaa6e8ce4765ac943ba3fb339494d4d48dca` was public and ungated. The LFS closure totalled 63,174,634,906 bytes. The official card specifies English, a 30B-total and 3.5B-active hybrid Mamba-Transformer mixture-of-experts architecture, 262,144-token context, BF16 weights, `temperature=0`, thinking disabled, and vLLM or SGLang serving. The modifications are BSD-2-Clause while the underlying Nemotron work retains NVIDIA license and attribution obligations.

The model card's sub-100 ms single-request TTFT and high-concurrency sub-600 ms target are reported on B200 or an optimized Modal configuration. The card lists no deployed inference provider and no Hindi or Hinglish evaluation. These are official vendor measurements, not Vyakti latency, cost, language, or quality evidence.

PhoneBench Alpha 1, a separate official Pipecat source, reports PhoneLLM at 72.3%, 331 ms P50 and about 600 ms P95 time to first answer token, and an estimated USD 0.0025 per conversation minute for the LLM. Its scoring axes include telephone speaking style, tool-call accuracy, say/do consistency, factual grounding, conversation coherence, authentication discipline, escalation discipline and caller outcome. These remain vendor results.

**Boundary.** No weights were downloaded, no endpoint was deployed, no GPU was scheduled, and no PhoneLLM response was generated. The executable continuous-human-clone manifest passed with eight stages, eight hard gates, nine negative controls, and 37 primary sources after the official benchmark source was added.

## `continuous-human-clone-frontier-contract-2026-08-29`

**Measured 2026-08-29, n=1 executable architecture manifest, using local deterministic contract checks.** The manifest passed eight ordered stages, eight hard gates, nine deliberate negative controls and 37 primary sources. It preregisters call interaction, memory, persona, expression, voice, safety/provenance and operations/status protocols. The production-shaped Mirror Call suites separately passed 120/120 reply checks, 464 API checks and 67 client/state checks.

**Boundary.** These are architecture and control-flow checks. They are not a deployed always-available call, a PhoneLLM response, a human voice-quality result, a calibrated expression model, or proof that durable relational retrieval improves conversations.

## `mirror-call-window-contract-local-2026-08-29`

**Measured 2026-08-29, n=1 live database audit plus three production-shaped local suites.** Before the fix, the live database contained one Mirror Call session and zero windows, turns, deltas, conditioning selections or fine-tune jobs. Static tracing found that the browser sent multipart audio while the server required a finalized JSON source handle, and create/status relied on process-local warmth. After the fix, reply checks passed 120/120, API checks passed 464, and client/state checks passed 67, including an executed hash, private upload, finalize and JSON ingest journey. Live Neon `EXPLAIN` parsed the session source, window insert and end-call statements at total costs 10.65, 9.48 and 16.65.

**Boundary.** The tests prove contract and SQL shape. A deployed authenticated multi-turn canary is still required. Real call windows remain unverified for voice adaptation because no production caller supplies server-side owner-speaker similarity.

## `studio-owner-timing-and-auth-continuity-frontend-2026-08-29`

**Measured 2026-08-29, n=5 focused frontend suites.** Journey timing passed 10/10, activity resilience 17/17, voice preview 13/13, authentication continuity 10/10 and Mirror Call 67/67. TypeScript, Vite production build and the final 16-check release runner passed. The release runner included a 466,773 ms eval suite and both live relational gates.

The UI binds existing timing evidence separately: source preparation about 5 to 15 minutes after worker pickup, VoiceGenome build about 1 to 3 minutes after pickup, and preview/call cold GPU readiness about 2 to 8 minutes. It does not treat a shorter server estimate as the observed ceiling.

One final in-app-browser pass mounted the real local Studio `voice-warming` fixture. After Preview, it rendered the separate 30-second next check, 2-to-5-minute server estimate, 2-to-8-minute observed cold range, useful return time and leave-or-return guidance. At a 390 by 844 viewport, document and client width were both 375 CSS pixels, every visible button was at least 44 by 44 CSS pixels, Preview remained visible, the old capture-consent error string was absent, and the browser recorded zero warning or error console entries.

**Boundary.** This verifies local frontend behavior and rendered-copy contracts, not a newly measured deployment latency distribution. The current Vercel production project did not receive this release because its team ownership is unresolved.

## `owner-current-reference-general-hindi-hinglish-2026-08-29`

**Measured 2026-08-29, one exact owner-selected 10,000 ms reference, two fixed Hindi prompts per arm and one fixed Roman Hinglish prompt per arm, using signed protected Azure synthesis and the same 192-dimensional ECAPA evidence service.** General Chatterbox Hindi scored mean 0.858449, p10/worst 0.838685, n=2. Hindi-pack Hindi scored mean 0.832045, p10/worst 0.826045, n=2. The old general fragmented Hinglish clip lasted 25,980 ms and scored 0.433967. One-pass coalesced general Hinglish lasted 7,720 ms and scored 0.825082. One-pass Hindi-pack Hinglish lasted 9,240 ms and scored 0.826010. Every new output was HMAC-bound to the same reference and seed and had PerTh score 1.0.

Azure Speech short-audio ASR made three zero-retry calls. Raw and curated script-aware WER were both 0.652174 for the old fragmented clip and 0.434783 for each coalesced clip. The equal raw/script-aware values show that the bounded alias lexicon did not remove the Roman-to-Devanagari disagreement for this prompt.

The isolated Hindi image was rebuilt remotely after the first image omitted the shared Cangjie tokenizer file. Accepted ACR run `cu30` produced digest `sha256:9dc374366a6ac9c1d2569e4e824faca12321679e24941e4e345319aca8576b83`, 9,843,276,760 compressed bytes. The Hindi evaluation runtime returned to inactive zero replicas. The evidence service remains active at min zero and read back zero replicas after scoring.

**Boundary.** ECAPA is a speaker-identity proxy and Azure Speech disagreement is one-provider ASR evidence. Neither measures naturalness, Indian accent, expression or human preference. No listening occurred and no cross-language winner is claimed.

## `open-voice-readiness-broker-production-2026-08-29`

**Measured 2026-08-29, n=1 remote ACR build, n=1 production broker deployment and n=1 signed cold-status probe.** ACR run `cu31` completed in 32.105 seconds from source-manifest SHA-256 `41c6314475de8f494a04a0835d9d506aabc4ec04b30dcdecdd326ad3e43b054e`. Production admission now runs immutable digest `sha256:b6786b4d3c99bf6731cc4d0059233f363a910c93406dfa54d3d26fbe4d47b64e`, with the prior HMAC secret reference, private runtime origin, public ingress, min replicas zero and max replicas two preserved. Health returned 200. The first authenticated `/v1/runtime-status` request returned a valid signed `ready:false` while waking the zero-replica runtime.

**Boundary.** The probe verifies remote readiness truth and HMAC response integrity, not synthesis quality. It intentionally did not wait for or request audio.

**Final scale audit.** Read-only Azure CLI readback after the cooldown found zero Running replicas on production general runtime and admission, isolated Hindi runtime, voice evidence, Qwen runtime and gate, VoxCPM2 runtime and gate, and IndicF5 runtime and gate. Every listed app retains `minReplicas=0`; no GPU was left warm. The isolated Hindi revision list had no active revision, while production general, production admission and evidence retained their required active scale-to-zero revisions.

## `production-owner-clone-canary-2026-08-29`

**Measured 2026-08-29, n=1 fresh authenticated production clone, using the deployed Vercel APIs and personal Azure services.** The canary privately uploaded one exact 480,044-byte, 10,000 ms, 24 kHz mono PCM16 WAV and selected it as the primary voice. The source advanced from quarantine through all eight durable checks to ready, and VoiceGenome v1 draft was built, in about 4 minutes 7 seconds from replica creation. No re-upload was used.

The first runtime revision loaded Chatterbox and PerTh but remained outside routing after Azure reported a blank-status HTTP startup-probe failure. After the probe contract was changed to delayed TCP startup and readiness on port 8080, revision `tcp45` reported `Running`, `started=true`, `ready=true` and zero restarts. The signed broker continued to check the private application's `/healthz` before synthesis.

The authenticated preview then returned HTTP 200 with a 337,964-byte, 7.04-second, 24 kHz mono PCM16 WAV. The response carried a protected generation ID, `audible-prefix-v1`, the exact 64-hex general-model commitment, a 64-hex text-plan commitment, spoken-text receipt, `model_arm=general`, and `quality_state=script_match_observed`. Focused OpenVoice checks passed 70/70 after the infrastructure change.

**Boundary.** The in-app browser created the real production replica and rendered the released Studio, but browser file-chooser automation stopped before transmission. The same authenticated production endpoints were then driven directly for the private upload and preview; this does not replace a real phone microphone canary. Receipt and geometry evidence prove the deployed clone path works, not that owner likeness or naturalness is acceptable before listening.

**Final validation.** The production runtime and admission broker each read back zero replicas with min replicas zero after cooldown. The final Bicep template compiled, the context graph passed at 830 nodes and 1,032 edges, OpenVoice passed 70/70, and `node scripts/verify-release.mjs` passed all 16 gates. The central eval phase took 872,253 ms and both live relational database gates passed.

## `production-phone-clone-readiness-audit-2026-08-29`

**Measured 2026-08-29, one live phone-width signed-out surface, one separate
authenticated production surface, eight recent worker executions and one
content-free live queue audit.** At a 390 by 844 viewport, the deployed sign-in
page had document and client widths of 375 CSS pixels, two 48-pixel actions,
the primary magic-link action and optional-code guidance. A separate live
authenticated session rendered the Create workspace state at the same phone
width with no horizontal overflow.

The personal Azure processing Job read `Succeeded`, schedule `*/2 * * * *`,
retry limit one, twelve jobs per run and immutable image
`sha256:1a72cbe44822743bde71893201d0b3dd046206d163dea054b82518874564ae25`.
Its eight most recent scheduled executions all succeeded in 21 to 25 seconds.
The live watchdog reported zero due jobs and zero live leases in both source
processing and model build. Production voice runtime and admission read
`Succeeded`, `Healthy`, `ScaledToZero`, zero replicas and min zero; their exact
runtime and broker digests remained `625edc...86d8` and `b6786b...7b64e`.

Four focused local contract suites also passed on the current shared source:
authentication continuity 10/10, guided quick capture 12/12, pipeline watchdog
13/13 and OpenVoice 70/70.

**Boundary.** This is a current readiness and mobile-layout audit layered on
the earlier fresh production canary. It did not send another sign-in email,
record through physical phone microphone hardware, create another clone or
generate another audio clip. Five simultaneous preview requests were not load
tested; the production GPU remains max one and serializes synthesis, so
concurrent previews may queue even though account-owned clone state remains
isolated.

## `overnight-multi-account-clone-audit-2026-08-30`

**Measured 2026-08-30, read-only production audit of n=3 user clones created
overnight, plus current Azure and queue state.** `Me` reached source ready with
8/8 complete jobs in 5 minutes 40 seconds and VoiceGenome v2 review with no
failure. `Aryan` reached ready 8/8 in 4 minutes 39 seconds and v1 review. `2`
reached ready 8/8 in 4 minutes 2 seconds and v1 review. There were zero source
processing failures, zero stopped jobs and zero model-build failure codes.

Preview told a different operational story. From first request to first sealed
audio, `Me` took 3 minutes 56 seconds with three aborted warming rows and two
sealed outputs; `Aryan` took 4 minutes 24 seconds with six warming rows and
three sealed outputs; `2` took 5 minutes 37 seconds with four warming rows and
six sealed outputs. Across these three clones that is n=13 normal warming
aborts, n=11 sealed outputs and n=0 real generation failures. The six outputs
for `2` shared one text hash and one seed but had six audio hashes, proving
duplicate synthesis rather than one result being polled.

At the 08:14 IST follow-up, both durable lanes reported zero due work and zero
live leases. Eleven preceding scheduled worker executions had succeeded in 20
to 29 seconds and the current two-minute execution was running normally.
Production runtime and admission were provisioned, healthy and scaled to zero
with zero replicas.

**Boundary.** No audio was played and no signed-in overnight browser session
was available, so this does not measure likeness, naturalness or the exact copy
the owner saw. It distinguishes durable source/build outcomes from generation
outcomes and proves duplicate work from database commitments; it does not yet
prove which combination of manual taps, tabs or automatic retries initiated
each duplicate.

## `durable-preview-release-gate-2026-08-30`

**Measured 2026-08-30, local contract suites plus read-only/live Neon parser
checks and one complete release run.** Migrations 065, 066 and 067 applied as
18 independently repeatable SQL-over-HTTP statements; the amended 067 replay
added one cleanup-claim column and reapplied 15 statements without error. Live
constraint readback found the exact-intent uniqueness, owner cascade and
generation cascade present. Live `EXPLAIN (format json)` parsed the full intent
claim, cleanup claim and deletion-acknowledgement statements without executing
them.

Focused results on the settled source were: durable intent 35/35, five-client
concurrency red team 53/53, preview panel 121/121, OpenVoice 73/73, result
cleanup 12/12, Studio preview UI 23/23 and real Chrome phone fixture 13/13. The
full `node scripts/verify-release.mjs` run passed all 16 checks; its central eval
ran for 352,966 ms and both live relational gates passed.

Production infrastructure readback before the web release showed the exact
existing runtime image `sha256:625edc223f7063e744d6463dd7443daeaa7097552997a7a4e47c99888cfa86d8`
at min zero, max two, one concurrent request per replica. The corrected
processing worker image
`sha256:be1288fb73c3d0c2f3e489c05a691ca3147b22f1e91be7091d17f7e18f398115`
completed one manual execution; the live queue then read zero due jobs, zero
live leases and zero failed jobs.

**Boundary.** This proves database shape, SQL parsing, local concurrency
semantics, a real browser fixture, the full release gate and worker deployment.
At this measurement point the new web/API bundle had not yet been deployed and
no production concurrent preview canary had run. It makes no owner-likeness,
naturalness or model-winner claim.

## `production-preview-concurrency-and-call-canary-2026-08-30`

**Measured 2026-08-30, deployed production API and signed-in phone browser.**
Vercel deployment `dpl_7sGpb1SEArF2nAzgtKW5sTzSeX7G` reached Ready and the
production alias. Five clients replaying one semantic preview intent made 50
HTTP requests across ten bounded rounds. Every response named one intent; one
generation sealed and all final clients replayed the same 329,324-byte
protected WAV with SHA-256
`296b03c543345e181e9fe29242700e572c9a98094023737b09c65698cd040aa1`.

Five genuinely distinct owner preview intents were then submitted concurrently.
All five returned signed HTTP 200 results on their first synthesis attempt in
29.656, 31.621, 33.359, 36.014 and 41.202 seconds. Every result had a distinct
intent, generation and protected-audio hash, with exactly one sealed generation
per intent. Azure scheduled a second bounded runtime replica during this burst;
runtime and admission later read zero Running replicas with min replicas zero.

At a 390 by 844 viewport, the signed-in production Studio rendered at 375 CSS
pixels with zero horizontal overflow, no console warning or error, and no
visible button below 44 pixels. The selected canary showed 3 of 3 setup
milestones complete, exact primary-source lineage, the observed 2 to 8 minute
cold-start range, and both preview and Mirror Call controls.

The first call-start canary exposed an independent UI sequencing bug: production
logged HTTP 201 while the page stayed on Opening because microphone permission
was awaited before the session was rendered. After the bounded fix and final
deployment, Start call reached Call ready now in 18 seconds while the microphone
remained off; End call saved a clean end receipt. The temporary auth session was
globally revoked. The final release runner passed all 16 gates; the central eval
phase took 378,944 ms and both relational gates passed.

**Boundary.** The call canary did not capture or transmit microphone audio, so
it proves deployed session creation, signed GPU readiness, honest UI state and
clean termination, not transcription, reply quality, relational learning,
emotion inference or voice adaptation. Preview WAVs were not listened to, so
these results do not claim owner likeness, naturalness or a model winner.

## `human-experience-compiler-first-slice-2026-08-30`

**Measured 2026-08-30, local deterministic suites plus live Neon DDL and
read-only parser checks.** The compiler contract passed 82 named checks and
1,000 deterministic property trials. The expiring expression ledger passed
39 checks; the collect-only Mirror producer passed 29; canonical Mirror
evidence and live-consent behavior passed 25; the accepted-claim RelationalOS
materializer passed 23; claim extraction passed 26; and the production-shaped
Mirror Call API suite passed 475. Migration 068 applied as nine independently
idempotent SQL-over-HTTP statements and a complete second application also
passed. Live `EXPLAIN (FORMAT JSON)` parsed the six-parameter pre-ASR consent
query and the 12-parameter atomic settlement without `ANALYZE` or writes.

The four collected features are turn duration, token count, speech rate and
adjacent Latin/Devanagari script-transition ratio. All are rule-derived,
source-audio-hash bound, tied to a real current consent row, capped at 24-hour
retention and unused by response generation. Accepted event or relationship
claims write one private dyad-bound episode and cited fact; retries return the
same materialization.

**Boundary.** These numbers prove contracts, database shape and SQL parsing,
not expression accuracy, emotion recognition, human similarity, reply quality
or deployment. No microphone-audio production canary, expression consumer,
owner-speaker scorer, automatic claim worker or voice fine-tune ran in this
measurement.

## `human-experience-compiler-production-release-2026-08-30`

**Measured 2026-08-30, full release runner, Vercel control-plane readback,
deployed browser and unauthenticated route controls.** The stable source passed
all 16 release gates. Its aggregate eval phase took 619,749 ms; live zero-
orphan and citation gates passed in 9,519 ms and 2,776 ms. The gate exposed and
then verified two privacy repairs: `vy_replica_expression_observation` is now a
44th person-table manifest entry for export/whole wipe, and Recall assigns it
the written `forget-only` fate because scoped text deletion cannot match its
numeric mechanics. Person Tables passed and Recall passed 230 assertions.

Vercel deployment `dpl_6NqnWzJDpMcdBAh4iFa6g29oinNa` reached Ready and was
aliased to `https://vyakti-replica-lab.vercel.app`. Team readback showed one
member, the authenticated account, with OWNER role. At a 390 by 844 deployed
viewport, the signed-out Studio had document width 375, no horizontal overflow,
two 48-pixel actions and zero browser warnings/errors. Unauthenticated reads of
the expression sweep, claim sweep and Mirror Call routes each returned HTTP
401.

**Boundary.** The available browser session was signed out. No JWT was copied,
no login link or OTP was requested, no microphone audio was transmitted and no
owner decision was created. This release proves deployment, privacy reach,
route authentication and signed-out responsive rendering; it does not prove a
deployed call transcript, learned relationship, expression usefulness or
human-perceived clone quality.

## `human-experience-compiler-reversal-production-release-2026-08-30`

**Measured 2026-08-30, canonical release runner, Vercel production readback,
protected-route controls and deployed responsive browser inspection.** The
final integrated source passed all 16 release checks. The aggregate eval suite
took 645,868 ms; live zero-orphan and citation-discipline gates passed in
11,602 ms and 2,820 ms. The same source also passed the independent settled
audit, including 48/48 source-erasure checks, 23/23 full-erasure checks, 75/75
Mirror state checks, 46/46 runtime-authority checks and the SQL cast scan over
576 statements with zero conflicts, uncast parameters or unparseable shapes.

Vercel deployment `dpl_HApDX7dozFx99DzTMJiNfEGQJPm8` reached Ready and was
aliased to `https://vyakti-replica-lab.vercel.app`. Unauthenticated production
requests to the claim sweep, expression sweep, pipeline watchdog and preview
result cleanup each returned HTTP 401, proving that the four newly deployed
routes exist and fail closed without their scheduler authority. At a 390 by
844 deployed viewport the signed-out Studio had document width 375, no
horizontal overflow, two 48-pixel actions and zero browser warnings or errors.

**Boundary.** The available in-app browser session was signed out. No sign-in
link, OTP, microphone recording, private source, provider request, owner
speaker decision or claim materialization was created. Automatic claim
extraction remains intentionally disabled because the existing OpenRouter key
must be rotated before the model, rates and shared budget are enabled.
Production also remains an explicitly internal self-test workspace; its tagged
automatic grants are not real consent and must be reversed before public use.
This release proves code, database boundaries, deployment, route authentication
and signed-out responsive behavior, not a signed-in call-learning result,
five-account capacity, expression quality or owner-perceived voice likeness.

## `human-experience-compiler-reversal-gate-2026-08-30`

**Measured 2026-08-30, deterministic local suites plus read-only live Neon
parser checks.** The integrated source passed: compiler 82 named checks plus
1,000 property trials; exact-session owner-speaker attestation 37/37;
canonical Mirror evidence and consent 25/25; expression producer 37/37;
expression storage and erasure 41/41; nearline claim queue 30/30; claim
extraction 41/41; provider budget 41/41; Person Model 43/43; protected runtime
authority 46/46; accepted-claim RelationalOS materialization 31/31; Mirror
relational recall 15/15; Context Locker 91/91; Mirror Call state 75/75; and
same-tab ended-session recovery 16/16. TypeScript and the scoped whitespace
gate passed.

Read-only `EXPLAIN (FORMAT JSON)` against live Neon parsed Context canonical
evidence write and re-attribution cleanup plus all 12 current Person
Model/runtime authority statements: claim decision and invalidation, unsafe
profile reconciliation, build, approval, runtime status, activation, context
load, session open, training-consent closure, protected stream open, per-segment
append and seal. No modifying statement was executed by those checks.

**Boundary.** This is integration and database-parser evidence, not a deployed
call-learning canary. No claim-extraction provider request, microphone-audio
production run, inner-emotion inference, profile auto-acceptance, perceptual
voice test or model-winner experiment ran. The production OpenRouter claim lane
remains intentionally fail closed until its exposed credential is rotated and
the model, price and shared budget settings are installed. Production also
remains an explicitly internal self-test workspace; the tagged automatic test
grants have not been represented as real consent or as a public release.

## `mirror-source-erasure-repair-2026-08-30`

**Measured 2026-08-30, local negative controls, live Neon migration and
read-only parser/inventory checks, followed by bounded historical cleanup.**
Migration 071 applied as six independently idempotent SQL-over-HTTP statements
and added exact `vy_mirror_delta.applied_sheet_id` lineage. Source erasure
passed 48/48, full replica erasure 23/23, Mirror state 75/75 and the
production-shaped Mirror API 475 checks. Live `EXPLAIN (FORMAT JSON)` parsed
the final atomic source/Mirror erasure transaction, bounded historical cleanup,
full replica erasure, TeacherSheet cleanup and push-token cleanup without
executing them.

The pre-cleanup content-free inventory found eight Mirror windows whose source
foreign key was already null. Three rows across two owners, replicas and
sessions still held transcript/provider/model data; all three had zero turns,
deltas, conditioning selections or expression observations. The owner-scoped,
maximum-25 repair was dry-run first, then permanently deleted exactly one and
two rows for the two exact replicas. Readback found five content-empty legacy
windows, zero private-content orphan windows and zero eligible cleanup targets.
Live TeacherSheet and push-token inventories were also zero rows and zero
orphans.

**Boundary.** The three deleted rows are intentionally unrecoverable. No raw
transcript, provider response, model output, sheet body or credential was read
or returned by the inventory and cleanup tools. This proves erasure reach and
historical repair, not a production call-learning result or perceptual quality.

## `mobile-studio-minimum-click-journey-2026-08-30`

**Measured 2026-08-30, source inspection, deterministic focused suites and real
Chromium against the signed-in Studio fixture.** The clean microphone path has
two intentional product actions after entering Create: Start recording and
Finish and build. The quick-capture suite passed 16/16, including automatic
private upload, primary-voice selection, direct navigation to Preview, weak
sample rejection, failed-authorization retry and discard/retake recovery, one
selected Meet task and an in-flow rather than fixed wait surface. The final
quick-capture suite passed 20/20. The phone preview suite passed 14/14 twice at
375 CSS pixels after its offline event and server shutdown were made
deterministic. The wizard
suite passed 83/83, including exact clone URL serialization and an invalid-id
negative control. TypeScript, the production Vite build, copy check and
targeted lint passed before the finish review.

At the inspected 1280 by 720 fixture, Review was the only selected Meet task,
the blind comparison was available inside Review, the document did not
overflow horizontally and browser logs contained no error. Earlier focused
phone fixture inspection at 390 by 844 also found no horizontal overflow. The
independent finish review measured the 375 by 812 Meet tabs at y=477 and the
active Voice chat task at y=547, both in the first viewport, with no console
warning or error. It found no remaining product P0 or P1 after the upload
recovery, true-peak clipping, live-region and above-the-fold fixes.

Vercel production deployment `dpl_BeZ5XwaLidy8sUWiitUcjnExNXMq` reached Ready
and was aliased to `https://vyakti-replica-lab.vercel.app`. A read-only
post-deploy Chromium pass at 1280 by 720 loaded the expected protected Studio
sign-in shell with zero horizontal overflow and zero console errors attributed
to the production origin. The browser was signed out, so the authenticated
workspace was not mutated during this final readback.

**Boundary.** This is interface, deployment-control-plane and signed-out
production browser evidence, not a physical-phone microphone canary,
voice-similarity result, GPU wait measurement or five-account capacity test.
The observed ranges displayed by the UI come from the existing measured
activity contracts, not from this UI suite.

The final canonical `node scripts/verify-release.mjs` run on the settled source
passed all 16 checks. Typecheck took 63,947 ms; the web build 21,158 ms; signed-in
layout readability 8,317 ms; the combined eval suite 1,067,469 ms; live Neon
zero-orphan 10,300 ms; and live citation discipline 2,939 ms. This final gate
adds integrated release and live relational evidence, but it still does not add
a microphone, synthesis, listening-quality or multi-account load result.

## `hinglish-continuity-release-candidate-2026-08-30`

**Measured 2026-08-30, local contract tests plus read-only analysis of existing
owner-bound WAV artifacts.** Hindi text frontend passed 25/25, OpenVoice passed
73/73, the durable preview panel passed 121/121, and the new 16-prompt stress
corpus passed seven named gates plus 128 prompt assertions. The corpus covers
Roman Hinglish, mixed script, dense switches, confusable English tokens,
questions, emphasis, repairs, proper names, numbers, technical terms,
initialisms and single-letter symbols. Every prompt produced one deterministic
Hindi-conditioned synthesis segment with complete semantic coverage and exact
UTF-16 transformation spans. The provider contains no digital segment-gap path
and rejects any future multi-call plan.

The artifact analysis compared n=2 exact prior outputs for the same owner
reference and Hinglish passage shape. Method: 40 ms PCM16 frames, 10 ms hop,
near-silence defined as frame RMS below 0.008. The old token-fragmented output
was 25.98 seconds with 65.47% near-silence; the already-generated continuous
output was 7.72 seconds with 24.58% near-silence. Existing sealed evaluation
reported ECAPA 0.433967 and 0.825082 respectively. The continuous output's
pitch coefficient of variation was 0.3072 versus 0.2291 for the fragmented
output under one bounded autocorrelation probe, but that probe is not a
perceptual expressiveness metric.

**Boundary.** No new TTS, ASR, cloud, GPU or human listening call ran. The tests
prove text-plan continuity, deterministic reviewed pronunciation transforms and
receipt binding. They do not prove correct arbitrary-word pronunciation,
naturalness, emotional delivery, owner likeness or a model winner. The release
candidate is not production until deployment and an authenticated canary are
explicitly authorized.

The final canonical `node scripts/verify-release.mjs` run on the same settled
source passed all 16 checks. The integrated eval suite took 672,892 ms; live
Neon zero-orphan took 9,828 ms and citation discipline took 2,855 ms. This adds
release and database-integrity evidence, not perceptual audio evidence.

## `studio-mobile-hardening-and-entry-bundle-2026-08-30`

**Measured 2026-08-30, local production and internal-test builds in real system
Chrome.** The layout gate rendered Feed, Meet and Deploy at 360 by 640, 390 by
844, 844 by 390, 834 by 1112 and 1355 by 800. The production fixture judged 226
visible prose/control blocks and the internal-test fixture judged 196, with
zero final readability, overflow, contrast or visible touch-target findings.
The protected-preview journey passed 14/14 at 375 by 812, including first-
viewport task access, durable intent recovery, one live region, 44-pixel main
action, offline return guidance, terminal regeneration and protected replay.

The measured initial Studio JavaScript module-preload set changed from about
639.60 kB raw and 186.22 kB gzip before the split to about 417.98 kB raw and
129.39 kB gzip after it. Method: Vite production build output plus the exact
modulepreload entries emitted in `dist/studio.html`; this is a 34.7% raw and
30.5% gzip reduction. Recording, enrollment recovery and simple preview stayed
eager; advanced task chunks remain available on demand.

Focused checks on the settled UI passed: quick voice capture 21/21, wizard
83/83, journey timing 10/10, Studio self-test 36/36, recovery 16/16 and preview
UI 24/24. TypeScript and the production build passed. The Impeccable detector
was run once and found only two incumbent, untouched warnings: the existing
Inter declaration and decorative grid background.

**Boundary.** These measurements cover deterministic browser rendering and
local bundle transfer size, not a physical-phone network trace, authenticated
production microphone upload, production GPU synthesis, perceptual voice
quality or deployed Core Web Vitals. The source was not deployed in this phase.

The final canonical `node scripts/verify-release.mjs` run on the same settled
source passed all 16 checks. The five-viewport signed-in layout gate took
41,855 ms, the combined eval suite took 836,477 ms, live Neon zero-orphan took
10,111 ms and citation discipline took 2,921 ms. This adds integrated release
and database-integrity evidence, not a deployed phone or listening result.

## `mobile-studio-public-safety-release-2026-08-30`

**Measured 2026-08-30, Vercel production control plane, live Neon tagged-row
rollback and signed-out production browser.** Seven production environment
entries were removed without printing values: the six server/client self-test
authority entries and the exposed, disabled OpenRouter credential. Deployment
`dpl_B2oNUR5XnCPnshhXhP86eFDi4Daq` reached Ready and was aliased to
`https://vyakti-replica-lab.vercel.app` with the measured lazy Studio bundle.

The dry-run inventory before rollback found 171 active tagged consents, 33
self-test-verified replicas, 5,009 currently accepted tagged evidence rows and
13 tagged selected artifacts. One idempotent append-only reversal statement
revoked or reversed exactly those counts. Immediate readback and a second
dry-run found zero in all four categories. Human-granted rows were outside the
tag predicate. The four deployed maintenance routes for claim extraction,
expression expiry, pipeline watchdog and preview-result cleanup each returned
HTTP 401 without the cron credential.

The deployed sign-in shell had zero horizontal overflow at 1,280 CSS pixels,
two 48-pixel actions, no Internal test workspace marker and the explicit
recorded-consent boundary. Live read-only EXPLAIN parsed the nearline queue,
Context canonical-evidence and source-erasure SQL; the content-free nearline
inventory was zero queues, zero items and zero linked Context rows.

The first Vercel-scheduled executions on the new immutable deployment returned
HTTP 200 for pipeline watchdog, claim extraction, expression expiry,
preview-result cleanup, model-build sweep, erasure sweep and face-session
sweep. Separate unauthenticated requests to the four newly protected routes
returned HTTP 401. This proves production cron admission and route availability;
it does not prove a configured claim provider or a nonempty learning job.

**Boundary.** The selected browser had no authenticated session and no Chrome
extension connection was available, so this phase did not mutate a user
workspace, record from a physical phone or synthesize/listen to a production
voice. Automatic claim extraction remains deliberately unavailable until a
fresh provider credential plus model/rate/budget configuration is qualified.

## `clone-creation-saga-live-release-2026-09-02`

**Measured 2026-09-02 with deterministic local suites, live Neon migration and
read-only SQL parsing, one remote image build, one Azure worker execution,
tagged self-test rollback, and production Vercel control-plane/API readback.**
The clone-creation saga passed 28/28 focused checks. The expanded source-erasure
suite passed 51/51, including a three-build delete-old/build-new interleaving:
the pre-request old build and the post-request old-source settlement were
retired, while the post-request replacement with a different source-set hash
survived. Clone verification passed 29/29 and the integrated experience
recovery surface passed 12/12.

Migration 072 applied live as ten independently idempotent SQL-over-HTTP
statements. Live `EXPLAIN (FORMAT JSON)` parsed the owner-scoped replica-create
replay, source-create replay, build-intent and atomic promotion shapes without
`ANALYZE` or writes. The live relational check counted 109 owner-keyed tables,
68 owner-lane-reachable tables and passed its 34 assertions.

The processing worker was built remotely from 237 files and 3,670,709 bytes,
bound to source-manifest SHA-256
`7ddac066f69f56c7b22b8f587fe720f855dca1e83ac5adc4f747b4c3e5d056fc`.
ACR run `cu34` produced a Linux/amd64 image at immutable digest
`sha256:e521b8f38c7bcf4401927c6f264c5b6fb728277a7a6136169a4a3c1fa723b63c`.
Image-only deployment preserved schedule `*/2 * * * *`, timeout 3,600 seconds,
retry limit one, parallelism one, 1 CPU and 2 GiB, and read back zero self-test
environment entries. Execution `vyakti-replica-processing-fpjd66u` pulled that
digest and succeeded; its content-free log reported zero build intents to
examine. The prior digest
`sha256:be1288fb73c3d0c2f3e489c05a691ca3147b22f1e91be7091d17f7e18f398115`
is the recorded image rollback point.

A final tagged self-test inventory found three active automatic consents, one
test-verified replica, 20 automatically accepted evidence rows and one
automatically selected artifact. The exact revocation path reversed 3, 1, 20
and 1 respectively. Immediate readback and a second dry run returned zero in
all four categories.

The sanitized Vercel deployment
`dpl_6BivhdGGQwVf9PtRcARSSDxocZb9` reached Ready and owns
`https://vyakti-replica-lab.vercel.app`. Its build generated runtime
configuration from the Vercel environment rather than the local ignored
configuration file. A dedicated content-free authenticated canary returned
HTTP 200 from replica list, review and activity, and the one-time auth exchange
and logout returned 200, 200 and 204. The settled source before the deployment-
payload exclusion patch passed all 16 canonical release gates; its aggregate
eval took 816,193 ms, live zero-orphan 10,114 ms and citation discipline 2,855
ms. That run is not represented as post-patch evidence for the new exclusion
itself.

The pre-sanitization deployment whose identifier begins `dpl_9zGsf` was first
verified as distinct from current deployment `dpl_6BivhdGGQwVf9PtRcARSSDxocZb9`.
Only that exact old deployment was then removed. Its immutable deployment URL
returned HTTP 404 after removal, while the public alias remained HTTP 200 on
the sanitized deployment. No project-wide or alias deletion was performed.

The post-incident upload-boundary gate passed five required credential-path
rules with zero re-inclusions and zero tracked credential-shaped paths. Its
negative controls independently removed each rule and explicitly re-included
`api/_config.js`. The environment-independent `/vyakti-release.json` source
commitment and deploy verifier passed six Vyakti and three companion positive
checks, two stale/wrong-project negative controls and 25 fixture HTTP requests;
it made zero legacy `/api/chat` or `/api/speech` requests. Workflow validation
passed all five workflow files. Two consecutive deterministic release-identity
runs hashed the same 717 inputs and 21,773,110 bytes.

A local invocation of `scripts/vercel-build.sh` reached and passed the Vite
build over 805 modules in 10.60 seconds, then stopped in the pre-existing
Windows OTA step because `ota-bundle.mjs` resolved a malformed `C:\C:\...`
path. Bash and Node syntax checks, scoped lint and diff checks passed. This is
not recorded as a complete Vercel build or canonical release pass; the full
settled-tree release gate remains a separate root workstream.

**Boundary.** The worker canary had no due source or build intent and therefore
proves image startup, scheduler shape and reconciler availability, not a new
phone recording through all eight stages. No five-account end-to-end clone load
was run; parallelism one remains a queueing design, not five simultaneous
processing replicas. Production has no fresh configured OpenRouter or Foundry
conversation/claim-extraction credential, so the conversational brain and
nearline claim extraction remain fail-closed. No provider request, microphone
capture, protected synthesis, playback or human listening ran in this release
measurement.

## `generic-personal-clone-experience-and-mobile-qa-2026-09-02`

**Measured 2026-09-02 by source-derived contract suites, a current first-party
desk review and real system-Chrome layout inspection.** The generic entry suite
passed 25/25, the integrated clone-experience recovery suite passed 12/12 and
the verification journey passed 29/29. These checks cover personal-clone-first
copy, no teacher framing in the entry surface, natural free-speech capture,
exact candidate recovery, finalized upload replay, old-draft rejection,
server-backed verification, one mobile scroll owner, 48-pixel primary actions,
reduced motion, visible focus and malformed video/context response recovery.

The research brief is 741 text lines and contains 53 linked citations across
52 unique URLs. Method: PowerShell line count and link-regex count over
`PERSONAL-CLONE-ONBOARDING-AND-EVOLUTION-UX-2026-09-01.md`. It compares the
current official documentation, policies or primary research for Fish Audio,
ElevenLabs, Cartesia, PlayAI, Resemble, Hume, Tavus, Delphi, HeyGen, Synthesia,
Web Content Accessibility Guidelines, Apple interface guidance and supporting
voice/memory research. No competitor account or signed-in competitor flow was
used.

The final local Chrome pass covered five layouts: 375 by 812, 390 by 844, 844
by 390, 1,440 by 900 and 720 by 450 CSS pixels. The inspected generic capture,
candidate-ready verification and Add-room states had no horizontal overflow,
header collision or visible action below the 44-pixel product floor. Short
landscape moved overflow into the active verification or room panel rather
than clipping the fixed navigation. The retained screenshots include the 390
by 844 candidate-ready state and the 844 by 390 contained-files state.

**Boundary.** These are local UI contracts and rendered-layout measurements.
They do not prove that a first-time person understands the latched recording
gesture, that a physical phone microphone uploads successfully, that the
deployed authenticated screen matches every local state, or that a clone
finishes or sounds acceptable. The 85-percent gesture-comprehension, first-run
completion, keyboard-open and 200-percent text-zoom targets remain future
moderated and device tests.

## `hindi-hinglish-code-switch-frontier-2026-09-02`

**Measured 2026-09-02 with deterministic text-plan/runtime suites and
read-only analysis of two already generated owner-bound artifacts.** The Hindi
text frontend passed 26/26 checks and the Open Voice contract passed 73/73.
The code-switch frontier passed 18 named checks and verified 29 adversarial
prompt plans across structural and exact-span invariants. The corpus covers
Roman Hinglish, mixed script, technical terms, English/Hindi confusables,
questions, repairs, proper names, emphasis, initialisms, switch-adjacent word
errors, repeated switch words, abnormal dragging, synthetic switch pauses and
observable prosody fixtures. The active orthography contract is
`vyakti-curated-hi-in-orthography/v2`; an unknown uppercase token remains
unchanged and explicitly unresolved instead of receiving a guessed spelling.

The n=2 artifact comparison reused the same prior owner-reference passage
shape. Method: 40 ms PCM16 frames, 10 ms hop, near-silence at frame RMS below
0.008. The old token-fragmented output lasted 25.98 seconds, spent 65.47 percent
of frames near silence and had existing ECAPA 0.433967. The existing one-pass
output lasted 7.72 seconds, spent 24.58 percent near silence and had existing
ECAPA 0.825082. The current provider contract rejects more than one acoustic
call for a Hindi/Hinglish preview and inserts no digital language-boundary gap.

**Boundary.** No new TTS, ASR, GPU call or listening test ran. ECAPA is a
speaker-identity proxy, silence is not naturalness and deterministic
orthography does not prove that an arbitrary word is pronounced correctly.
Chatterbox still receives one language condition for the entire utterance, so
one Hindi-conditioned call removes Vyakti's fragmentation defect but does not
certify native code-switch phonology, Indian accent, emotion, emphasis,
naturalness or owner likeness. Chatterbox remains a fallback incumbent;
VoxCPM2 and MOSS-TTS remain challenger paths pending same-reference, same-text,
blinded listening. No model-quality winner or perceptual improvement is
claimed.

## `guarded-personal-clone-production-release-2026-09-02`

**Measured 2026-09-02 with two rejected remote-build identity probes, one
guarded client-side deployment, immutable Vercel readback, deterministic
release suites and live read-only production checks.** Both rejected in-build
commitment probes observed the same uploaded path set as the deploy client but
measured byte deltas of -369 and -200 respectively. The final guarded wrapper
computed and the install marker accepted
`sha256:63358f56b36ade8911e2cf096abe1641771013c8f2791fc6f27f1690a48122e8`
over 719 deployment inputs before upload.

Vercel deployment `dpl_8c9E4CYSZ7AgdMTjDDUBZVQ2sqww` reached Ready and owns
the production alias. The immutable deployment passed all 6 post-deploy checks.
The canonical release runner passed all 19 gates on the released source. Its
aggregate eval took 461,696 ms, live zero-orphan took 9,886 ms and citation
discipline took 2,736 ms. The replica pipeline watchdog passed 20/20 focused
checks, and its live Neon `EXPLAIN` parsed without `ANALYZE` or writes. Final
pipeline readback was healthy with due count zero in processing, model-build
and erasure lanes. The tagged self-test inventory was 0 active automatic
consents, 0 test-verified replicas, 0 automatically accepted evidence rows and
0 automatically selected artifacts. The live relational check passed all 34
assertions.

The first-run reveal now has one deterministic 420 ms Web Audio signature
created inside the explicit Agree gesture, a persisted visible mute choice,
no audio under Reduce Motion and visual equivalence when audio is unavailable.
The fake-AudioContext test proved mute/reduced-motion silence, one-shot
scheduling and idempotent cleanup; focused lint, copy, module typecheck and the
production bundle passed.

**Boundary.** No OpenRouter or Foundry conversation provider is configured, so
Mirror Call replies and nearline claim learning remain fail-closed. No new
audio was generated or listened to, and the 420 ms mark was not feel-checked on
a physical device. This release did not run an authenticated physical-phone
microphone-to-playback clone journey and did not measure five-account clone
capacity. It therefore licenses no new claim about voice likeness, naturalness,
phone capture success, sonic preference, call learning or five-user latency.

## `legacy-self-test-reset-recovery-2026-09-02`

**Measured 2026-09-02 with one read-only production row inspection, focused
deterministic suites and local system Chrome.** Replica
`cb59648c-ede1-40c8-b5fa-4db586d2db1f` was `enrolling` with its historical
self-test marker still true, all three identity/liveness timestamps false,
zero active self-test consents, zero currently accepted evidence rows and zero
currently selected artifacts. It still had one draft and one retired
VoiceGenome. Three active non-self-test source consents remained. This explains
why the global tagged-state inventory was 0/0/0/0 while the review API still
returned `self_test_mode=true`: the inventory measures current authority; the
review field preserves historical draft provenance.

The clone-verification suite passed 31/31 and clone-experience QA passed 12/12.
Application TypeScript, focused oxlint and the copy gate passed. A local Chrome
run covered 360 by 640, 375 by 812 and 844 by 390 verification layouts plus the
390 by 844 legacy-reset layout. All four had no horizontal overflow, visible
actions were at least 44 pixels high, the first reset tap caused no mutation,
and only the second explicit `Erase and start again` tap invoked the fixture's
revoke callback.

**Boundary.** The database inspection was read-only. No production replica was
revoked or erased, no deployment ran and no new clone was created. The browser
callback was a deterministic fixture, so these checks prove the guarded UI
wiring and existing full-erasure API path, not completion of a production
erasure worker or an authenticated fresh-clone phone journey.

## `functional-voice-field-and-premium-recorder-qa-2026-09-02`

**Measured 2026-09-02 with deterministic UI suites, the Impeccable static
detector and real system-Chrome layout inspection.** The settled clone
experience suite passed 19/19 and the verification journey passed 31/31. The
detector returned an empty finding set. The recorder, upload, reveal and build
states share one 96-ray SVG VoiceField; recording rays consume the exact live
microphone analyser history and level, while non-recording states do not
fabricate analyser activity. The official Vyakti wordmark and website-derived
light tokens replace the prior lab mark.

The browser pass covered n=3 base viewports, 390 by 844, 844 by 390 and 1,440
by 900 CSS pixels, plus one 200-percent reflow condition. At 390 by 844 the
wordmark measured 117.4 by 44 CSS pixels. At 844 by 390 the recorder subtitle
remained 13 CSS pixels and the page had no horizontal overflow. Contrast and
Capacitor web/native asset synchronization checks passed. Reduced Motion
froze the field rays and removed drawer and room travel without removing the
state or its actions.

**Boundary.** These are local deterministic and rendered-browser results, not
an authenticated production microphone-to-clone run, a physical-device motion
review or a deployment result. No generated voice was listened to and no
claim about likeness, pronunciation, emotion or expression follows from the
visual work.

## `frontend-dependency-remediation-2026-09-02`

**Measured 2026-09-02 with package reach inspection, package-manager security
audit and the existing mobile synchronization checks.** The unused
`@capacitor/assets` development package was removed and `sharp` was upgraded
to 0.35.4. The settled audit reported n=0 critical findings, n=0 high findings
and n=3 moderate findings. The contrast gate and Capacitor synchronization
gate passed after the dependency change.

**Boundary.** An Android APK was not built because this machine has no JDK.
The audit and synchronization checks establish the JavaScript dependency and
web-to-native asset state; they do not establish that Gradle compiles or that
the experience works on a physical Android device.

## `erasure-retention-and-stale-branch-preflight-2026-09-02`

**Measured 2026-09-02 with provider control-plane readback, exact Neon branch
comparison and Vercel environment-name readback.** Across n=3 persistence
planes, Neon exposed one day of current branch history while its provider
backup boundary is up to 30 days; Supabase reported zero retained backups with
point-in-time recovery off; and every checked Azure recovery feature was off.
Production Vercel now has an erasure-receipt integrity key and
`REPLICA_BACKUP_RETENTION_DAYS=30`; the secret value was neither printed nor
recorded.

The exact stale Neon child branch
`br-round-frost-avv3g04c` (`ws-ah-processing-drain-verify`) was a one-off WS-AH
verification branch. Before deletion it contained n=13 target rows belonging
to exactly n=1 target replica, and the primary-to-child comparison found n=0
non-target branch-specific writes. That exact branch was deleted before the
main erasure. A fresh branch list found n=0 matching child branches and n=1
remaining branch, the primary.

**Boundary.** This measurement includes deletion of that exact stale child
branch and configuration of the two erasure environment entries. It does not
claim that any main-branch clone has been revoked or erased, that an erasure
receipt has been issued, or that the current application source has been
deployed.


## `expert-publication27-freeze-receipt` (2026-09-07)

At 2026-09-07T20:50:10.262Z, the guarded freeze produced commit c3cae7ddbb6992ed9311d46f88d89b31f3fee8b0 covering n=60 files. Receipt: scratchpad/expert-tools/publication27-native-candidate-freeze.json. Before freezing, n=5 new JS/MJS files had only trailing blank lines normalized; TypeScript emitted output was byte-identical before and after for all five, and the store suite passed n=26 controls afterward. Corresponding live-acceptance source hashes were updated. No native provider call or full release acceptance is implied.


## `expert-publication27-preparation-and-access` (2026-09-07)

Release preparation receipt release27-preparation-1788814589583.json inspected 2796 tracked files, 24 gates and 348 registered suites; no full gate ran. Native prepared options pin 520 source files,25 query expectations and7 helper files. Root separately inspected n=2 mobile screenshots (early-share and visitor at390px): functional control evidence does not establish target clone UX; publication permission review remains tall and visitor view is a simple single-answer surface. Targeted Vercel replica-lab project read returned403 again; git ls-remote succeeded, handover61385c57 present and codex/expert-unified absent. No push/deploy or model call is claimed in this entry.


## `expert-publication27-one-real-azure-answer` (2026-09-07)

One actual Azure gpt-4.1-mini call returned925input/310outputtokens and settled866microUSD. The existing ledger moved129006→129872microUSD with0reserved. Actual owner create/account attestations/upload/draft/review/publication and visitor join/answer/replay/forget/unpublish completed the helper's10flow checks. T2.5seconds and f0.4Hz were correct; the answer then asserted lengthabout1.55metres despite missing measurement/model assumptions. Root preregistered rubric therefore fails grounding. Native artifact native-text-publication-run-checkpoint27.json and separate QUALITY-REVIEW retain the evidence. At this entry physical blob deletion returned202 followedbyHEAD404; final private-row/auth cleanup was still running on exec91371 and is not claimed complete.


## `expert-publication27-connected-cleanup-final` (2026-09-07)

Native exec91371 completed exit0 at2026-09-07T21:03:01.109Z after164330ms. Artifact SHA2564b891bb8ad9e2f86215ddae2c87eb556f31024952d0c8a6c5403dfee728b0430. Ten actual owner/visitor flow checks passed with exactly1Azure call. Physical erasure has1source receipt;145private count scopes all0;2synthetic auth accounts absent;2content-free retired IDs retained; cleanup_required=false; ledger preserved; cleanup errors0. Settled text cost866microUSD. The separate preregistered semantic review FAILED unsupported length inference, so this is not full release or product acceptance. Result: scratchpad/expert-tools/publication27-connected-result.json. Subsequent work remains isolated, candidate27 unchanged.


## `expert-grounding28-paired-preparation-v2` (2026-09-07)

Prepared8 cases×2 frozen compilers at c3cae7dd/c10e63e1,16 calls, conservative reservation50534microUSD.14 offline helper groups and6 launcher groups reported passed with0 SQL/modelcalls. Root and independent checkpoint reviewer inspected reserve/begin/in-flight/settle/raw capture and no-retry paths. Root separately reviewed Pythonc8e95be200b73a16d337c14224fd597cee5092fa1f603d086c3843f39ffa2642 and Nodee96dfdb1acbabbf488b83fdbf4e7a0d41f828d497afdf5132183a282de9b1ef8. Real provider/SQL acceptance remains pending. Candidate28 fullrelease started separately on exec19235 at21:18:08.160Z, sourcef027349a unchanged.


## `expert-grounding28-sixteen-settled-results` (2026-09-07)

On 2026-09-07T21:22:31.330Z, n=16 actual Azure calls completed and settled for11659microUSD; ledger141531microUSD spent,0reserved. Eight cases per arm, one sample each. All numerical results and requested languages passed independent descriptive review; baseline median uncertainty omission and candidate median/provenance errors remain. Candidate delivery lost four correct equation lines. Review: GROUNDING28-INDEPENDENT-REVIEW-20260908.md. No broad quality, native owner, voice or statistical superiority claim.


## `expert-candidate29-preparation` (2026-09-07)

On 2026-09-07, created codex/expert-29-combined at f027349a in a separate worktree. Copied only the hash-verified empty config stub, linked existing dependencies without modifying them, retained independent grounding review artifacts, and appended six grounding context entries. Graph check passed with2520nodes/2410edges. No production change integrated or live call performed by this preparation. Release28 exec19235 remains live; layout reported151findings over108loads while performance passed117106ms.


## `expert-candidate29-integrated-repairs` (2026-09-07)

On2026-09-07 integrated JourneyV2 3b0d3e73, mathgate aeecc546 and creatorfixture f005c974 into candidate29 basedf027. Root graph2532nodes/2416edges passed, source-only old/new journey caller check passed, and all11 actual common-gate math regression groups passed against integrated source/generated engine. Agent fixture repair passed24 rendered groups. Root math-render isolate installed158packages in3minutes with its own node_modules; shared dependencies unchanged. ForcedTypeScript4498 passed before final small refusal/bounds/fallback edits. Final mounted rendering acceptance and complete release29 remain pending.


## `expert-release28-terminal-failure` (2026-09-07)

Actual exec19235 exited1 at2026-09-07T21:46:16.836Z after28m08.676s.24checks ran:21passed, layout/readability, eval suite and accessibility failed. Six failing suites:persontables,ops,probe-live,creator-export,self-check,day-one. Accessibility reports two ops language buttons with1.73contrast. Guard receipt release28-1788815888159-completion.json verifies HEAD/source/clean-tree/config/dependencies unchanged; its process_completed:false denotes nonsuccessful exit, not a running process. Two relational gates were skipped, not passed.


## `expert-math-render29-final-mounted` (2026-09-07)

Renderer frozen3c8db8120bf66eb280540d3c742bbea6f299f89d. Root final TypeScript/copy7scopes21negatives/diff passed exec31660. Independent realKaTeX Chromium44controls at320/390/1440 passed unchanged7source/package hashes, zero external/unexpected routes/errors, rawfallback on denied/malformed/macrocommands,64equation cap, keyboard local scrolling and held-import replacement/unmount. Receipt155eac9b33e9e7976924af0f030ee5c093d25feeb73e7dc2cf09f92712f6b1ff; root separately inspected retained320image. Thirteen noncontext files integrated into29 via math-render29-merged.json. Actual full consumer incumbent checks and full release remain pending; no Safari/screenreader/model/voice acceptance.


## `expert-candidate29-consumer-and-preparation` (2026-09-07)

2026-09-07: agent incumbent actual consumer suites passed24dialogue-history,12feedback-dataset,34conversation-setup and30publication (28prior plus2encoding controls). Ops extension passed8 real layout/axe controls in addition to prior24, not yet one combined32run. Six release suites passed on frozen42a01d025148ceec85a2b64a858266d4528bbd1c and13files integrated. Encoding2file delta8571dd408e53ad75027042e020f0b34f43a1fe58 integrated. Fresh detached expert-29-release at renderer3c8db812 installed158packages with npm ci in36seconds; its exact package and lock hashes equal candidateassembly. Separate realSQL EXPLAIN preparation is pending, no new DB outcome claimed here.


## `expert-publication29-four-real-sql-shapes` (2026-09-07)

At2026-09-07T21:54:13.482Z, n=4 actual export/heartbeat shapes passed EXPLAIN in BEGIN READ ONLY on vyakti_expert_integration_20260906. Negative invalid-column control returned42703. No ANALYZE, writes, private rows, real export or expiry executed. Source42a01d02 and2811tracked hashes unchanged; root verified3sourcepins equal merged29 and retained receiptSHA5f32d096fcd158f8f4b189c5e8fc35d9cc8aaafc68782c8e8e3ad276048f1334. This proves parser/type acceptance for these query bytes, not whole-product execution.


## `expert-release29-started` (2026-09-07)

At2026-09-07T21:56:00.821Z, actual exec70263/PID32704 started scripts/verify-release.mjs under guardV2. Prep release29-preparation-1788818134936.json recorded2832trackedfiles,24gates,356suites,34browser suites, source digest835112ea2a365f6541f1860cca948e6379fd1b4e4ab93ec9dd56ae5e68b062b3, emptyconfig and privateKaTeX0.18.7 install. Logrelease29-1788818160820.log; completionreceipt sameprefix-completion.json. No terminal result yet. Separate SQL4shape EXPLAIN plus42703negative passed and exact3sourcepins match mergedcommit. No native29 modelcall/push/deploy.


## `expert-native29-proposal-and-hosting-inventory` (2026-09-07)

On2026-09-07 root preparer --check and --write-proposal passed:522native sources,25queries, noquerydelta, frozenf4235c68, fourlauncher files emitted. NodeSHAcf6d94c7a10b2f33bb6c95d46c046e772751a386f6f881f36b03ca02a384a1d7; PythonSHA3081a5df3e88ceae5d8e37c3ac87ec22f33bfcf8914f245c0ea33fe7abad7d0c. No new livecall yet. Read-only Vercel listteams returned[]; bounded Azure ARM inventory21:59:50Z found33resources and15hosting-type resources, all namedvoice ContainerApps, no separate Web/sites or staticSites. Zero writes/keyreads; this is resource inventory, not deploy capability or readiness.


## `expert-native29-execution-start` (2026-09-07)

On 2026-09-07 root offline check exec29789 exited0:522sources,25queries,7helpers,blankconfig,max1,servicesfalse. Independent review also passed; computed conservative reservation3493microUSD is an estimate, not billing. Root launched exactly one --execute at exec97514; protected readiness confirmed Azure gpt-4.1-mini2025-04-14 GlobalStandard eastus2, publication cap0.01USD and existing global1USD. No response or cleanup outcome yet. Release29 exec70263 remains running; its log reports layout readability251563ms and performance budgets109469ms passed.


## `expert-native29-failed-before-dispatch-cleaned` (2026-09-07)

Actual exec97514 exited1. Run22:09:41.269Z to22:13:57.115Z on2026-09-07: publication readiness200/can_publish true, then generic FEED_PROBE_FAILED before any answer. Model attempts0, no quality result. Cleanup complete, errors0, all145 scoped private counts0, both synthetic auth absent, ledger preserved. Blob delete202 and subsequent HEAD404 recorded. Artifact native-text-publication-run-checkpoint29.json SHA750230779a6633283a5e90c8aaabca988a00e2dc17aa7ab670b8bf379fe38a02. Failure diagnosis pending; no restart.


## `expert-separator30-eight-controls` (2026-09-07)

On2026-09-08 root isolated expert-separator30 atf4235c68 and committed2d0d936a: twofiles, no production edits. Actual eight retained parser/shared-gate groups passed, including ghost-bubble negative and recovered timing/label. First run missing ignored config was environmental; exact pinned all-empty config installed, no service calls. Release29 full eval reports failures creator-cascade-order and explicit-action-focus browser timeouts plus the repaired separator setup assertion; run70263 still pending remaining gates. Local deploy plan only succeeded: vyakti-clone source sha256:6cac3f84b74836c7480060910310cc0605b12de695014e0677a81a7d4b4d1142,1061inputs,29172399bytes; no deployment.


## `expert-release29-terminal-23-of-24` (2026-09-07)

Actual exec70263 exited1 at2026-09-07T22:19:56.167Z, started21:56:00.821Z.23of24gates passed including layout, performance, accessibility and securityheaders. Eval suite failed creator-cascade-order locator timeout after25checks, explicit-action-focus navigation timeout after45checks, and parse-separator-runs global regex-count assertion. Completionreceipt release29-1788818160820-completion.json proves source/head/config/dependencies unchanged and terminalprocess. Two relational gates skipped, not passed. Isolated parser repair2d0d936a already passes8focused controls, not integrated or a replacement fullgate.


## `expert-native-diagnostic30-started` (2026-09-07)

On2026-09-08 local, root launched diagnostic30 --execute at exec28215 after defaultoffline passed522sources/25queries/21helperartifacts. New output native-text-publication-run-diagnostic30.json, no outcome yet. Root design31 worktree based UI42e19f51 installed158packages privately in52s; twofiles simplify permission row presentation and plain wording while preserving8choices. Impeccable detector[]; mounted check exec93385 started and first unavailable-state check passed. No completed visual acceptance claimed.


## `expert-verification-design31-focused-pass` (2026-09-07)

2026-09-08: root design31 commita72cf570 based UI42e19f51 changes3files.24mounted groups at390/1440 passed, root viewed both permission screenshots, independent source review found all8choices/callers/bindings intact. ForcedTypeScript/copy7scopes21negatives/diff/detector passed. Receipt expert-verification-design31/scratchpad/selected-reference-comparison/1788819932994/result.json. This is synthetic connected UI coverage, not real verification/provider acceptance.


## `expert-native-diagnostic30-answer-cleanup-pending` (2026-09-07)

Root exec28215 terminal exit1 at2026-09-07T22:29:16.061Z. All10actual flow checks passed, one settled Azure call1150input179output747microUSD. Raw/delivered Hindi gives2.5seconds/0.4Hz, corrects frequency misconception, length explicitly unknown; independent original8rubric checks passed, delivered only normalizes blanklines. Ledger141531to142278microUSD,reserved0,preserved. Cleanup stopped EPERM; source delete202/HEAD404 recorded, final145scope counts/auth absence not yet proven. Terminalartifact native-text-publication-run-diagnostic30.json SHAd2ba959c8b0c7b7a67c353b9fffa9960ccafcbdbc031c290f48f34eda057f2d8. No further modelcall authorized by cleanup.


## `expert-candidate30-assembled-focused` (2026-09-07)

Root assembled33noncontext paths from UI42e19f51/designa72cf570/parser2d0d936a/creator-auditef65dd8e/authority3462b1f6 into expert-30-combined basedf4235c68. Exact commit/predecessor hashes checked before writes. Agent added2UI test registrations and9contextnodes6edges; graph2555/2424 passed. Root private npmci158packages40s, forcedTypeScript passed, actual41authority and8separator groups passed on combinedsource. SQL144 and fullrelease remain pending; no accepted integration/push/deploy.


## `expert-cleanup30-complete` (2026-09-07)

Actual exec59006 exited0; run2026-09-07T22:34:54.800Z to22:36:16.923Z. cleanup_complete,0modelcalls,0errors,145scope counts all0,both authabsent,2content-free IDledgers retained, billingpreserved142278microUSDspent/0reserved. Receipt native-text-publication-cleanup-diagnostic30.json SHA00253dc01f3a94f0b7b56bd5057fe9ff27fb29482e8de9b9d0d3a4177bfe2310. Original diagnostic30 answer/10flow checks passed but its EPERM terminalreport remains unchanged; this separate receipt closes cleanup only.


## `expert-authority30-real-parser` (2026-09-07)

Root exec29059 exited0. On2026-09-07T22:39:39.298Z to22:39:48.888Z, exact devdatabase vyakti_expert_integration_20260906 initially lacked reference_authority_epoch; applied reviewed one-statement144, catalog confirms bigint/notnull/default0. All8actual exported/caller-captured SQL EXPLAIN shapes passed plus42703negative in READONLY transaction, noANALYZE/no fixturewrites/providers. Receipt modern-authority30-migrate-explain-1788820779297.json SHA2dfe7ef082efa5f480c06ab32123e93538ce333b9183bc45c4ce1fb4ff86e2bb. Frozenproduction pins checked before/after.


## `authority30-launcher-controls` (2026-09-07)

2026-09-08: n=16 offline control groups passed in modern-authority30-launcher-offline-1788821179157.json. Root separately inspected launcher, guards and runtime harness and ran default check against37 source closure files,23 SQL runtime files and8queries. These are preparation checks, not SQL runtime evidence.


## `authority30-runtime-absence-failed` (2026-09-07)

n=1 run, 2026-09-07T22:47:00.349Z through22:47:05.488Z, terminalexit1. Receipt modern-authority30-sql-1788821220349-e4912018-94d8-40f1-b035-c0e0ba8c86c1-result.json records absence42883,checks0,races0,seeded0,provider0 and no session errors. Follow-up READONLY information_schema returned298 IDcolumns in authority30-column-types-1788821271651.json. Actual artifact decision_id isbigint, whereas fixture absence casts shared IDs to uuid[].


## `gpu-arm-accounting31` (2026-09-07)

2026-09-08: n=2 current ARM resource configurations and2 metric-definition catalogues, zero writes/model calls. Receipt azure-gpu-accounting31-1788821425015.json: evidence/openvoice T4Consumption,8CPU/56Gi,min0,max1/max2;31metrics each, Replicas and GPU utilization minPT1M. Scoped cost queryn=1 returnedHTTP429 in azure-gpu-cost31-1788821475434.json; no charge values acquired and no immediate retry. Official documentation consulted https://learn.microsoft.com/en-us/azure/container-apps/billing and https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/understand-cost-mgt-data .


## `gpu-retail-window-estimate31` (2026-09-07)

2026-09-08: one Azure public retail query,16 CentralIndia Consumption meters,nottruncated. Receipt azure-gpu-retail31-1788821549547.json and exactDecimal arithmetic gpu-window-retail-estimate31.json: T4 .000102USD/s +8CPU*.000024 +56GiB*.000003=.000462USD/s per allocatedreplica. Illustrative300s=.1386USD,900s=.4158USD; not measured usage, invoice or enforcedcap. Readable rationale GPU-ALLOCATION-COST31-20260908.md.


## `authority30-v3-offline-ready` (2026-09-07)

2026-09-08: Root default--check passed45sourceclosure/23runtime/8production/42fixture querypins. Agent source14+fixture7+launcher17controlgroups passed. These results do not prove realSQL execution; nextrootrun must supply that evidence.


## `authority30-v3-transactions` (2026-09-07)

n=1 V3run22:55:17.119Z to22:56:29.922Z September7UTC;282queries/5sessions.8production+42fixture EXPLAINs,3retainednegatives and6issuance/replacement/duplicate checks passed. valid-load22007; races0. Cleanup3ownerfixturesx16tablecounts allzero,sessionerrors0,provider0. Receipt modern-authority30-sql-v3-1788821717119-359235fa-fd41-4685-8ddd-9aa5e3fc076d-result.json SHAb71b32fed39ec5333264170cd3e246a6c6c7442b2b09b131d862c104658ad4d3.


## `authority30-v4-offline` (2026-09-07)

2026-09-08: root V4defaultcheck passed45source/23runtime/8production/42fixture. Agent14harness+9fixture+17launcher controls passed. Actual installedClient timestamp parser reproduces Date canonical{} and .123456 to .123 millisecondloss offline. Runtime stillpending.


## `authority30-v4-loader-passed` (2026-09-07)

V4exec49690 terminalexit1,2026-09-07T22:59:40.742Z to23:01:01.726Z,315queries/7sessions.63checks inclvalid-load and3batchreviewchecks passed; review-writer-epochs ERR_ASSERTION; races0.48cleanupcounts0,sessionerrors0,provider0. Receipt modern-authority30-sql-v4-1788821980742-70ef65eb-0706-475b-a38e-e27988274ff0-result.json SHA23dced3c2f51b0d02a45639a78ec61352ff7a6fd776b9c403b0a60956300c611. Agent reproduced unchanged actualartifactquery refusal in frozenlauncher guardoffline.


## `authority30-v5-offline-ready` (2026-09-07)

2026-09-08: Root inspectedcecc71e5 and V5guard exactreviewhash allowance. Root--check passed45source/23runtime/8production/45fixture. Agent14harness+9schema+13actualqueryguard+17launcher controls passed; final54fixturecounts expected across3owners. V5executionnext, noSQLclaim fromoffline.


## `comparison31-visual-review` (2026-09-07)

2026-09-08: Root viewed audition390/1440 in comparison-reference-mounted/1788822058287. Panel typography/spacing improved and blank unavailable captureframe removed. Firstfixture26functional controls retained; visualreviewdoesnotprove actualSQL/voice or fullproductquality. Existing verificationjargon remainsfollow-up.


## `gpu-cost31-delayed-retry` (2026-09-07)

2026-09-08: one delayedsecond read-only scopedCostManagementquery, receipt azure-gpu-cost31-1788822252669.json,HTTP429. No usage/charges obtained, no modelcalls/writes. Two attempts total; keepplanningestimate separate.


## `authority30-v5-real-sql-passed` (2026-09-07)

n=1 V5run2026-09-07T23:05:29.258Z to23:07:43.131Z;500queries,17sessions,80checks including53EXPLAINshapes+3parsernegatives,3actualblockedPIDwitnessraces with returnedrows0/1/0. Retainednoepochnegative permits1row; guardedcasesreturn0.54scopedcleanupcounts0,sessionerrors0,providers0. Receipt modern-authority30-sql-v5-1788822329258-961ce76b-3929-4e70-9a4d-41e3aaf75b57-result.json SHAf5fedd793c09f0cda0507329fe68e8475da47f76b9656c81412ba4804707431b. Sourcececc71e5, production3462unchanged.


## `candidate30-integration-final` (2026-09-07)

2026-09-08: candidate30-runtime-integration.json records8newfiles andsourcececc71e5. Graph2618/2430 afterharnessunion. Priorcombined41authority+8parser+11client+24mounted+forcedTS passed; realSQL80/races3/cleanup54 passed separately andcandidate8actualSQL hashesequal. Fullrelease30 notyetstarted.


## `release30-running` (2026-09-07)

2026-09-08T02:14:24.533Z: exec57122live child28728,24gates/359suites/35browsersuites; source252bb4005d19d40fcc3337f887809faa26d0b956c631e8854fe3614c5e1a81a8,2860trackedfiles. Preparation release30-preparation-1788833648965.json. Completion targetrelease30-1788833664532-completion.json, logfilematchingprefix. No resultyet; pollsameexec, neverrestartfromtimeout.


## `release30-terminal-results` (2026-09-07)

n=1 fullrelease02:14:24.533Z to02:34:22.675Z;23/24pass; source/config/dependencies unchanged. Failedtext-publication-store schema.includes,modern-capture-readiness-ui missingRequestlivephrase,conversation-setup-ui browserlaunch exit3221225477 beforechecks. Raw143migrationCRLF95/schemaCRLF0; normalizedexactSQLmatches. NarrowEOL-onlymirror repair innewisolate passes26storegroups including alteredDDLnegative. No providerorSQLexecution.


## `release31-focused-regression-results` (2026-09-07)

2026-09-08: Store runner passes26 controls with changed-DDL negative. Mounted capture final run exec15698 terminal0 passes30 groups including old-media, old-start and old-lifecycle negatives; synthetic media only. Unchanged conversation suite terminal0 passes34 controls at390/1440, receipt1788844435205, SHA da61d48743054a8ae771291e335c5f55db452a614eadff30b9fb1d07376554cc. No provider or real SQL in these checks. Full release31 pending.


## `release31-started` (2026-09-07)

2026-09-08T05:20:50.857Z: exec49368 child4448 launched24gates/359suites/35browser suites. Source digest5f02227e8f83e59deb31ffcf233b65fae57160620bf594f69d4e867fbcc24d5d with2862trackedfiles. Preparation release31-preparation-1788844827101.json; log release31-1788844850856.log and matchingcompletion target. No terminal result yet; relational checks explicitly separate.


## `relational31-v2-connection-failed` (2026-09-08)

2026-09-08T05:27:56.743Z to05:27:58.285Z, n=1 actualexecute, terminalexit1. Connection SQLSTATE08P01,0gatequeries,0gates,0provider calls,0schema/datawrites,0sessionerrors,0cleanuperrors. Receipt relational31-v2-run-1788845276742-c28c3385-e696-4bbb-b63d-f808ac6ba0b0-result.json. No timeout and no relational success. Agent assigned startup compatibility diagnosis with prior working V5 client.


## `relational31-v3-real-gates-pass` (2026-09-08)

2026-09-08T05:34:10.917Z to05:34:27.131Z, n=1 actualexecute, exec24303 terminal0,44gatequeries. relcheck exit0/skips0:34checks includingmultiparty,156ownedtables and98ownerlane tables (77cascade/21nameddelete). Citationdiscipline exit0/skips0 with requiredconstraint/index/data checks. Sessionerrors0,cleanuperrors0,timeoutfalse,0modelcalls/schema/datawrites. Source01a7b6f2. Receipt relational31-v3-run-1788845650914-a357d54c-151d-4564-8549-cbc19b6ec1e7-result.json SHAed14fdf00484ffc488f773796de1e47675330a3553de07c8fb97c1c17f4a654a. Original gate source ran unchanged with actualClient q and staticmanifest injection; productionHTTPtransport not exercised.


## `release31-full-terminal` (2026-09-08)

2026-09-08T05:20:50.857Z to06:15:21.306Z, n=1,exec49368terminalexit1,22/24gates passed. Head/source/config/dependencyfingerprintsunchanged,all48gatelogspresent. Performance10LCP/TBT/HindiDOMfindings. Evals failedcreator-cascade-order after11groups at15s shellvisibilitywait andfirst-use-private-flow-ui after13groups at12s Bringyourcontextwait. Store/capture/conversationsetup pass. Relationalgates skippedinthisofflineprocess butseparateactualV3bothpassed44queries/noskips. Receipt release31-1788844850856-completion.json.


## `gpu-control33-readonly-metadata` (2026-09-08)

2026-09-08T06:16:56Z, n=1 readonlymetadata pass,0ARMwrites/cloudkeyreads/modelcalls. Existingvoiceevidenceimmutableimage b2e2b74349ee8d1e2f3d346ea5bf070a5dcf4808ca8b4cd39845ae20dbd83914, CentralIndiaT4profileexists; proposedvyakti-gpu-control-20260908 jobabsent. CPUjobGET exposesadditionalnull/defaultfieldnames, notyetnormalizationproof. Receipt azure-gpu-control33-1788848221256.json. NoGPUstart/billingclaim.


## `performance31-controlled32-result` (2026-09-08)

2026-09-08: n=9targets x3runs, same frozen01a7b6f2. Controlledexec87009 child15484 exit1 at06:23:00.029Z; sole finding /vyakti TBT392ms >300 (runs651,392,0). Original10findings retained. Source2862/dist301/binaries/config/gate unchanged.14host samples; median aggregate process CPU5.812percent, free memory3745.4-4117.4MiB; coarse sampling cannot attribute renderer spikes.


## `performance31-profile32-attribution` (2026-09-08)

2026-09-08: n=2routes x3profiled runs. /vyakti exec87313 terminal0 TBT0/472/0, staticabout exec23191 terminal0 TBT84/0/103. Captured522ms task at310.5ms self/window/unknown. All source/assets/browser/config/gate fingerprints unchanged. Native(program) pseudo-frame dominates active sampling; no application JS function attributes full task. Profile passes do not replace ordinary failed gate.


## `comparison32-final-mounted` (2026-09-08)

2026-09-08: Agent-reported actual Chromium mounted n=34 parent groups and n=6 uploader groups at390/1440px, terminal0 receipts1788849093326 and1788849077454. Clean final sourcec4130b832c3aced7d334e975bb468a570d5ac941; manifest SHA4971c759c45769fa7571cdaf2da7e82e688cc50dca91729e04c5fe37c1a2d5c4. These are fixture/browser proofs, not real SQL, provider, identity or likeness acceptance.


## `gpu33-concrete-probe-preparation` (2026-09-08)

2026-09-08: n=1 local preparation generated exact ARM template and reviewed input from actual read-only Azure receipt1788848221256. Job vyakti-gpu-control-20260908, pinned evidence imageb2e2b743,120second timeout, zero retries, one replica; proposed separate250000microUSD ledger and138600microUSD reservation estimate. Canonical template SHA56b8a7ce71967c77ad3d77ff7dab14b47545b63c018b15da27898f5092727623. No ledger created, cloud writes or GPU/model execution; not an absolute invoice cap.


## `performance-trace33-runtime` (2026-09-08)

2026-09-08: One /vyakti diagnostic exec68212 exited0 at06:39:49.296Z. Three traces4940/5372/5400 events complete without data loss. Largest renderer wall/thread ms275.856/48.419,483.427/76.839,385.430/50.884; nested layout202.657/372.905/239.342ms. Source/dist/browser/config unchanged. Diagnostic not acceptance.


## `gpu33-v3-actual-preflight-refusal` (2026-09-08)

2026-09-08: n=1 root V3 migration attempt after55offlinecontrols and independent review. Started06:47:14.036Z, finished06:47:19.204Z, terminalexit1. Actual developmentDB vyakti_expert_integration_20260906 verified; migration_preflight ERR_ASSERTION, zero migration statements, rolled_back_before_commit, migration_committedfalse, sessionerrors0/cleanuperrors0. Receipt relational31-gpu-2d6d4770671fc28f394fd835-result.json. No runtime, provider/model, or ARM calls followed.


## `release31-two-unchanged-browser-passes` (2026-09-08)

2026-09-08: n=1 first-use run18/18groups at390/1440, original12s waits, terminal0 session5784; result1788849911962 SHA c4b718aea67030309663995e9683988762c2b4142d604fbb0e2a1f8e009bc957. n=1 creator run32/32groups at390/1440 en/hi, original15s waits, terminal0 session80729; result1788850019091 SHA565e42855aa09b2d4f25ecd01921e4899f1ceb555b5f77db6c34e6b00d03253b. Frozen31 clean. Synthetic local data, no model/SQL/provider proof.


## `gpu34-v4-migration-committed` (2026-09-08)

2026-09-08: n=1 V4 migration,57offlinecontrols plus independent review,37DDL committed06:55:51.748Z. Receipt relational31-gpu-db1bd93181f69843884e35f8-result.json, exactdevelopmentDB, fixturewrites0/sessionerrors0/cleanuperrors0. PriorV3refusal resolved from actual catalog receipt1788850349042: NAME[] decodedstring; explicit attname::text producedTEXT[]. This commits146147149150 only, not145148 orproduction.


## `gpu34-runtime-overrun-constraint-failure` (2026-09-08)

2026-09-08: n=1 separate runtime exec26006 terminal1,23514 on reconcile SQLSHA70e508ab34a70ce037829ea54e8eed38fef6f38e9673576d8b8d7b2ea2ef8037 after9checks. Receipt relational31-gpu-7b970e03007605871dc43cdb-result.json; declaredfixturebudgets/windows absentaftercleanup, sessions/cleanup errors0; threeconcurrencywitnesses not reached. No provider/GPUcall.


## `gpu-probe33-protected-deploy-controls` (2026-09-08)

2026-09-08: n=10 unittest controls with fake HTTP passed in 0.080 seconds. Tested raw input pins, forbidden start, missing secret, exact one Incremental PUT, separate validation POST, held claim after unknown write, pre-existing target refusal, safe redaction, non-following response links and arbitrary URL refusal. Independent source reviewer found no blocker; cloud deployment and real SQL correctness unmeasured.


## `acr-build34-offline-package-proof` (2026-09-08)

2026-09-08: n=9 offline unittest groups passed in0.105seconds. Actual positive package frozen2dbf57b1 prepared offline:11 files,18981 compressed bytes, archive SHA2566854eb4f4ff67cd3e6ccea6fa56610260945d4a20dd153aa1b7bd24079bfde9a; external manifest SHA25653185d88dd37e662c8d5974ed1ebda5a603774a5c34f399fad4bfa68a7bffeed. Zero Azure calls, uploads, builds or model runs. These are transport/package controls, not Azure compatibility or quality proof. Final reviewed revision:10 offline groups passed in0.084seconds; launcher SHA2568828282856149b0d5ec0868a2d18a0e866521ad9e6648c7e075c031c58ccb942.


## `prose-pair36-runtime` (2026-09-08)

2026-09-08: exec15865 terminal0 at07:03:26.854Z. Baseline LCP744/632/840ms and TBT0/300/444ms; candidate LCP600/724/760ms and TBT178/0/0ms. Medians LCP744 to724, TBT300 to0; CLS0 all6. Both target gates pass unchanged budgets. Source, 301 dist assets, blank config and browser fingerprints unchanged. Geometry6views passed; actual boundary viewport screenshots390/768/1440 rendered. See scratchpad/expert-tools/PROSE-PAIR36-RESULT-20260908.md.


## `gpu151-v6-actual-and-release34-progress38` (2026-09-08)

2026-09-08: development database vyakti_expert_integration_20260906 only. Migration151 committed one exact obsolete CHECK removal; receipt relational31-gpu-231afa171afc3e6709e22831-result.json. Runtime V6 receipt relational31-gpu-c9a20c73670007f6233e2690-result.json completed 07:23:27.485Z: n=15 checks, 3 actual PostgreSQL blocking witnesses, fixture budgets/windows remaining0, session/cleanup errors0, foreign debt unchanged. Usage verifier was synthetic; no Azure GPU execution or invoice proof. Fullrelease34 started07:26:35.529Z, exec78888; observed layout255132ms and performance114192ms gates passed, full suite still pending.


## `product37-caller-audits38` (2026-09-08)

2026-09-08 source-only audits, n=2 product paths: saved owner feedback reaches dataset preparation but no production candidate construction caller was found for registerOwnedCandidate/loadOwnedFeedbackLearningExample. Room logDmTurn catches SQL failure, allowing a saved preference to coexist with unconfirmed current-turn persistence. Separate correction37 and room-memory-write37 source work is prepared; no runtime or quality result claimed. Independent continuity148 review also identified missing projected authority columns referenced by sources/history CTEs; PostgreSQL failure is predicted, not yet observed.


## `release34-terminal38` (2026-09-08)

2026-09-08 full node scripts/verify-release.mjs via frozen guard, n=24 gates, terminal1 at07:52:01.723Z after start07:26:35.529Z. Frozen5ade4ea95209b15b0268338128514401be41b710 source/config/dependency fingerprints unchanged.23gates passed including performance, layout, accessibility, security headers and Room batteries. Eval suite failed verification-knowledge, private-rehearsal-combined, dialogue-unicode, modern-capture-readiness, clonecreationsaga. Relational gates skipped in blank-config runner, not passed. No push/deploy acceptance; preserve full logs and completion release34-1788852395528-completion.json. Focused repairs are separate isolates.


## `gpu-arm-actual-deploy38` (2026-09-08)

2026-09-08 actual ARM validation HTTP200 at07:48:48Z, one deploymentPUT via separately pinned wrapper, then fixed GET at07:51:22Z. Target vyakti-gpu-control-20260908 provisioning Succeeded, enclosing deployment still Running at that observation. Image, command, environment, timeout120, retry0, Manual parallelism1 match. resources_match false with observed empty ephemeralStorage; exact numeric resources await projected diagnosis. No start or ledger write. Receipts gpu-validate-wrapper-705b4283-2a24-499b-8258-9872b645fe8c.jsonl, gpu-deploy-wrapper-82224758-4dc2-4729-a52b-e212ac40cc44.jsonl and gpu-readback-12fdad4c-4f48-493a-9a83-0d9cb42a4365.jsonl under gpu-probe33-protected-receipts. Existing ACR credential passed in memory only, never logged. No voice or invoice result.


## `dialogue38-focused-controls` (2026-09-08)

2026-09-08, n=2 focused Node suites in expert-dialogue38 based on frozen release34 5ade4ea95209b15b0268338128514401be41b710. dialogue-unicode passed 13 groups, exit 0, 2.221 seconds; private-rehearsal-combined passed 8 groups, exit 0, 3.864 seconds. Includes four spend/continuity negative mutations and independent removal of each comparison-reference exclusion. No production files changed, no SQL/model/browser calls. These are offline source and dependency-seam controls, not full release acceptance.


## `release34-regressions38-offline` (2026-09-08)

2026-09-08, n=16 capture readiness groups and30 clone creation saga checks, all passed in exec cb6088; verification knowledge source-only guard also passed. Source758f8018, inert blank release34 config, ancestor ROOT dependency resolution for these offline checks. No actual auth, SQL, provider execution or browser in these results. Full release34 remains23/24 and failed; focused results do not replace it.


## `release34-regressions38-browser` (2026-09-08)

2026-09-08: exec32524 terminal0,14/14 mounted groups at396px and1440px using original15s timeouts and private copied node_modules. Receipt expert-release34-regressions38/scratchpad/verification-knowledge/1788854111932/result.json. Both old-caller trapping negative controls remain; current keyboard navigation preserves source, intent, locale, reload state and makes no mutations; private text and publication stay honestly blocked. No real auth/provider calls, errors0, unexpected fixture routes0. This is a focused regression pass, not full release acceptance.


## `acr-cu37-scheduled-after-ua-evidence39` (2026-09-08)

2026-09-08 cu36 bounded4734-byte log confirms HTTPError403 at resolve.py fetch during full wheel loop, not identity model execution. Ten HEAD metadata requests show exact two pinned r2 CUDA URLs reject default Python urllib but accept truthful Vyakti client identifier; HEAD is not Azure GET acceptance. Newstage36 frozen44b0dd7bfa04c76942939396bec10c681546439f changes client header and typed diagnostics only, preserves hashes/URLs/caps,12 controls passed. Root reviewed and scheduled once as cu37 at1788854791.3254483, CPU2/600s, manifest43725d6d3c5e5227862c274a3d4856bfe20fcc59b84a733ee1eb528224a61ef1,20188-byte archivedc4e01156a03cf3398fe6e079fd17e47c240f7d454ce04004ea2e1ad21a945dc. Pending actual build outcome, no model/quality claim.


## `gpu-target-inspection-and-preview-material39` (2026-09-08)

2026-09-08 fixed deployment GET now Succeeded; target CPU8 and memory56Gi confirmed. Exact production controller inspectJobSnapshot passed against actual job/environment API snapshots at07:58:08Z, receipt gpu-actual-inspect35-2fd49240-1959-4252-8008-b9759dc5276e.jsonl. No starts/ledger writes; activation_availablefalse and billing_bound_verifiedfalse preserved. Separate Azure web preview credential material prepared in Windows DPAPI storage using existing authorized config/API reads; no values printed or packaged. Isolated web identity/vault template compiled and targets absent, but root rejected initial write helper pending durable intent/unknown-result and validation binding repairs. No web resource writes.


## `continuity148154-v4-real53-40` (2026-09-08)

2026-09-08 V4 actual rollback-only PostgreSQL proof n=53 sequential runtime checks plus7 production EXPLAINs,08:11:19.618 to08:12:25.582Z. Exact source72b7db223222079aaaccb6beb3496161976c1fe5, freeze85840cdbe7b07e1836fae911f7ce25137a822981c30dae1f544314096d0993ba. Receipt continuity148-v4-1725ecb32ec6834e7acd0515-result.json: passed_rollback_proof, rollbackconfirmed, fixture replicas/persons/agents/logs0, session/cleanup errors0. Device/replica cascades remove derived raw replies while foreign replies survive. Source deletion blocks pending completion, authority/expiry/hash checks and text-only derived response preserved.148+154 DDL rolled back, not committed; concurrent erase/complete and representative-cardinality GIN performance still unmeasured.


## `cu37-dependency-stage-passed-not-terminal40` (2026-09-08)

2026-09-08 same cu37 build, sanitized14654-byte log SHAca4327f2f6bccde808617c8c77d9fc5d75557fbeeeb2b9ffcb648638dfcd700e reports dependency_stage_passed,70-wheel closure4058779632bytes, runtime lock SHA4c475588f8487ff5c882e7d0b0d18c3a6d718c0f13336ce7be4fcba848026834. Script order includes offline install, pipcheck, no-model imports, MFCC/array controls and base inventory. Models staged0/executed0. ARM stillRunning at1788855246; imagepush/terminalbuild not yet accepted, no voice quality claim.


## `comparison145-v4-real31-pass41` (2026-09-08)

2026-09-08 V4 exact developmentDB rollback proof08:14:52.112 to08:17:25.993Z,31groups ordinary+fresh selection/consent/audition/immutable binding/actual issuer-loader/erasure, all production and fixture EXPLAINs passed. Receipt comparison32-runtime-c080d945605c1c41ea65169b-result.json, statepassed/rolled_back/sessioncleanup0. Synthetic identity receipts only; no processing/voice quality and no multiparty race acceptance.145notcommitted. Protected commit preparation requested separately.


## `gpu-first-real-start-and-terminal-failure41` (2026-09-08)

2026-09-08 actual operatorinspect and budgetadmit passed, dedicated250000microUSD budgetcreated,foreigntextledgerunchanged. Exactly one startPOST acknowledged08:19:08.492Z, executionvyakti-gpu-control-20260908-qnhua6w/windowd78bb973-8fc7-49e7-b464-21ab7b46c079,138600microUSD reserved; actualusageunknown/spent0pendingverification. Startreceiptprefixrelational31-gpu-probe-7080adc7521e475ea478102a. Independentwatch exec98109 pid25880 active with exactDBdeadline1788856081383. Exact providerGET08:22:39.958Z shows Failed, matching image/command/CPU8/memory56Gi/windowmarker; receiptgpu-execution-diagnosis36-7346cc20-53f2-4ed8-9126-17a4a7f75dad.jsonl. Rootsent one exactknownexecutionstop safetyrequestHTTP200, receiptgpu-exact-stop35-d66995aa-e40a-4e13-be45-6a44c5184a34.jsonl. No secondstart. GPU/CUDAmarker and failurecause notobserved; no qualityclaim. Fundsheld until actual usageverification.


## `web-preview-bindings-provision41` (2026-09-08)

2026-09-08 supported existingregistrycredential alternative removed unauthorizedroleAssignment, retainednewpreviewidentity+vaultonly. ActualV3validationHTTP200 and13offlinecontrols; rootsource reviewedminimaldiff thenonePUT returned201, receiptazure-web37-v3-provision-1788855831722034400.json,writeAttempts1/response_received_requires_readback. No subscriptionrolechange/noappdeployment. Actualresource/policy/deploymentreadback pending, eight protectedsecret writes stillunperformed. ExistingcredentialDPAPIexcludedfromsource/build; do notclaimwebpreviewlive.


## `continuity154-actual-commit42` (2026-09-08)

2026-09-08 n=1 actual commit operation08:32:12.472 to08:32:31.903Z, exec91714 terminal0, receipt continuity154-commit-f880f3f8d54e310855c767cb-result.json state committed_verified. Exact six DDL applied after53runtime checks and7 production EXPLAINs passed in separate rollback proof. Session cleanup0; two budget rows and one GPU window hashes unchanged. Development database vyakti_expert_integration_20260906 only; production untouched.145152153 remain unapplied.


## `azure-preview-eight-secret-versions42` (2026-09-08)

2026-09-08 n=1 readback azure-web38-readback-1788855912296104000.json verifies deploymentSucceeded and exact two scoped policies. Root exec95412 terminal0 uploaded exactly8 new versioned secrets into dedicated preview vault, receipt azure-web38-secret-upload-1788856478005998000.json state eight_versions_confirmed,8attempts. Values not logged or packaged. No web app deployed; auth redirect allowlist not read because management credential unavailable. Existing service-role is not a Management API credential.


## `gpu-terminal-persist42` (2026-09-08)

2026-09-08 root exec21041 terminal0 uses reviewed execution-defaults36 source c06b8d3c56972e01b02b43506574bd842524bca5. Receipt prefix relational31-gpu-probe-f04082a728e1efdf609be931 records terminal_observed Failed, end_time_presentfalse, accounting_pending, accountedfalse, arm_posts0. Original watch98109 and start13942 are closed; do not restart them.138600microUSD remains reserved pending attributable usage evidence.


## `gpu-completion37-actual-logs` (2026-09-08)

2026-09-08: Scoped completion query in gpu-completion-diagnosis37-8c2c16ec-8a58-4d6f-85a7-a3178afc354c.jsonl returned10system records with deadline1/termination1, plus1console CUDApass at08:20:41.4437853Z. System range08:19:07.7838311Z to08:21:08.6137805Z. Exact job executionqnhua6w only, fixed08:18-08:30time interval, counts/timestamps only, no rawlogs persisted. ReplicaGET200returned0aftercleanup. This agent made3read-only diagnostic attempts; first2KQL requests400, thirdpassed. No start/stop/SQL/ledger changes; root full39 CPUhold preserved.


## `source-integration40-prepared43` (2026-09-08)

2026-09-08 source assembly n=1, expert-release40-candidate head9797b16d19a964338c50b1b01e8acaeed174ac10, mutable/notfrozen.63paths over39;380 unique suites retain all372 incumbent entries and add8. Context/schema union and graph2715nodes2432edges checked. Exact manifest RELEASE40-SOURCE-ASSEMBLY-PLAN.json. Correction37, publication37, Room memory acknowledgement37 and GPU execution36 integrated; no dependencies/build/tests/SQL/provider run,152153 unapplied. Full39 remains independent and active.


## `performance39-identical-assets43` (2026-09-08)

2026-09-08 independent source/artifact inspection n=301 shared dist files found identical SHA256 bytes between34 and39. Six actual median findings: studioTBT309ms; HindiLCP3760/TBT677/DOM1299.6; room-aboutTBT434; suites-aboutTBT436. All3 Hindi39 runs count0 completed fonttransfer bytes versus84148 in34; absent lifecycle telemetry prevents assigning cause. Late host sample31.678percent CPU cannot reconstruct failed-run conditions. Preserve failure and prepare one bounded three-context Hindi diagnostic after39 terminal. PERFORMANCE39-DIAGNOSIS-20260908.md contains evidence and limits.


## `gpu-process38-actual-lifecycle` (2026-09-08)

2026-09-08, n=1 execution. Two bounded read-only exact-execution system-log aggregates: image pull08:19:09.5921371 to08:20:30.7189919 (~81.13s), container start08:20:38.6406212, exit0at08:20:40.6048604, DeadlineExceeded08:21:08.6137805. CUDA console timestamp08:20:41.4437853 follows termination, so cross-stream timing cannot establish a hung process. Replica list200returned0. These are log intervals, not GPU billing duration. Source and receipts pinned in GPU-COST-PROCESS38-EVIDENCE-20260908.json.


## `gpu-cost38-actual-api` (2026-09-08)

2026-09-08, n=1 subscription GET and1CostManagement query. Safe metadata returned quota Sponsored_2016-01-01 and spendingLimitOff. Exact job resource, UTC2026-09-08 query returned HTTP429. No raw responses or secrets saved, no retries, no costs known, no ledger mutations. Receipt gpu-cost-read38-649074c8-e374-4ea7-91ab-3f47a4c7231e.jsonl.


## `release39-terminal21of24-44` (2026-09-08)

2026-09-08 n=1 fullrun08:30:31.104 to09:01:14.296Z, frozenb534fa930d7675c340bf37fcd586b1882f9b5b0a, exec69986terminal1.21/24 gates passed; performance sixfindings, eval onlycreator-cascade-order failed after7groups at15s primary-button colorread, accessibility room:join coverage didnotmount. Completion release39-1788856231102-completion.json verifies exactsource/config/dependencies unchanged and gate logs present. Relational gates skipped, not passed. Five prior34 evalregressions passed.39 is not shippable.


## `creator39-instrumented32-pass44` (2026-09-08)

2026-09-08 n=1 instrumented32group run, exec78980terminal0, artifact creator39-instrumented/1788858546468. Exact39 head/fivesourcefiles/302distfiles unchanged. Original390 Hindi feed colorread108ms and1440 211ms in thisrun; finalops pages visible/focused, earlierpagepassivebuffers reset so no per-Hindi RAF conclusion. Browserflags unavailable. Originaltimeout remains unexplained; pass is diagnostic not replacement fullrelease acceptance. Root152SQLproof was concurrent light network activity.


## `correction152-real-catalog-mismatch44` (2026-09-08)

2026-09-08 n=1 catalog-only rollback09:14:11.018 to09:14:31.469Z, exec7369terminal0; receipt correction152-catalog-fa3241a6214ce0f1879cb266-result.json structural_mismatch_captured, checkpoint152.constraint.vy_replica_correction_candidate_job_pkey, strictEqual actualtrue expectedfalse. Exact dedicated catalog retained, rollbackconfirmed and sessioncleanup0. No fixture/model/COMMIT. V2 must use type-specific actual evidence and replay full captured catalog before another SQL run; V1 preserved.


## `correction152-committed-lock45` (2026-09-08)

2026-09-08 n=1 development152 COMMIT receipt correction152-commit-0670cbba62efc29cd3145027-result.json committed_verified09:44:23 to09:44:41Z; exact COMMIT tag and three ledger hashes unchanged. Subsequent n=1 applied-schema runtime/three-session lock proof exec40494 terminal0, receipt correction152-v2-619f20ee5c5eca6939b253f0-result.json passed_rollback_runtime_and_lock, started09:47:38Z. No provider calls; production untouched. Independent detailed metrics review follows.


## `comparison145-publication15345` (2026-09-08)

2026-09-08 n=1 comparison145 migration commit passed receipt comparison32-migration-b8cd6025694e54b0eb3cf9b4-result.json. n=1 publication153 rollback receipt publication153-rollback-1788859077348-result.json SHA177b31ea1eee176e4f6d8820993750cd1660f8592a07efeb04c9d4ae9382f5a2 passed11runtime groups/22productionEXPLAIN/234SQL with both rollback acknowledgements and restoration.153 remains unapplied, commit helpers under review.


## `cu38-linux-dependency45` (2026-09-08)

2026-09-08 n=1 cu38 CPU2/900s scheduled run. Read-only log observation1788861079.888109 records all5Linux cleanup controls passed and dependency_stage_passed70wheels/4058779632bytes, runtime lock4c475588f8487ff5c882e7d0b0d18c3a6d718c0f13336ce7be4fcba848026834. Log15903bytes SHA34961d2bd144b16f5aab153033b6c7387a61c7dc58bd3e8b33575f801e1aad64. No models/calibration; terminal push and digest pending.


## `correction152-applied-independent-acceptance` (2026-09-08)

2026-09-08: Independent read-only receipt/source review of correction152-v2-619f20ee5c5eca6939b253f0-result.json SHA c7d5b8124e21d601644f02426da159642b242577b78fc0b7cc47ec771a64ec48.42/42 assertions;325 SQL attempts,324 completed and1 expected loser23503;21 EXPLAIN completed. Three distinct PostgreSQL backends32041,414,418; observer verified winner blocking loser on transactionid before winner rollback, then loser foreign-key refusal. Real worker/dynamic registration/replay/withdrawal/dataset and source erasure remain exercised with2 synthetic adapters,0 provider calls. Exact152 schema persisted before/after fixture rollback, fixture final/cleanup counts0, no session/cleanup errors. All552 product+42 support hashes rechecked without mismatch against frozen1a4f34f. Reviewer made no DB/provider/test calls.


## `acr-cu38-real-linux-and-dependency-stage-pass` (2026-09-08)

2026-09-08 actual ARM runcu38 Succeeded at1788861398.9098358 with exact registryvyaktivoiceacr.azurecr.io/repositoryvyakti/active-speaker-stage34/tagstage34-45f0833ef618/digestsha256:fdad90ee266ba38d42887df77888d8f6a9cb054ab7f0d18e3303ef41ea95f64f. Terminal receiptacr-stage37-v2-poll-1788861398909838200.json. Azure logs: five Linux cleanup controls allok, Ran5, dependency_stage_passed70wheels4058779632bytes, runtime_lock_sha2564c475588f8487ff5c882e7d0b0d18c3a6d718c0f13336ce7be4fcba848026834, models_executed0/staged0/calibrationfalse. Latestlog15925bytes SHA c4633e24a8b135920919f8216c568399ebbbb4768b1e7d934b2a0c08cdc5a214; raw logsnotpersisted. Four projection controls passed0.001seconds. No independent registry manifest GET, image extraction, GPU model run or calibration was performed by this observer.


## `publication153-commit-verified46` (2026-09-08)

2026-09-08 n=1 root protected commit exec92824 terminal0, packet212c58db8db6bf8dd57a8e9f02990db946d763e2758a916f5e8d9e84017dbe23 after independent review and6offline controls. Receipt publication153-commit-a64f338bbfd847d1f1a7d50b-result.json committed_verified, migration_outcome committed, cleanupUncertainfalse, provider0. Actual committed-fixture withdrawal races still pending. Production untouched.


## `comparison145-fresh-readback46` (2026-09-08)

2026-09-08 n=1 actual fresh development read-only session, packetbcfd31113de8f9a3d977cd1c3cfed7b30c7d8e67488ca35d015be92a7067223f, receipt comparison145-readback-dd9158b04ecde2d3105ed208-result.json committed_schema_observed; terminal0 in4.75s. Checked BEGIN READ ONLY, exact identity/settings, existing16column/9constraint validator and ROLLBACK acknowledgement. NoDDL/COMMIT/provider. Does not strengthen historical validator to fullCHECKexpression/indexparity.


## `cu38-independent-registry-manifest-pass` (2026-09-08)

2026-09-08 actualregistry at1788861547.240442: HTTP200,2410manifestbytes; requested fdad90ee266ba38d42887df77888d8f6a9cb054ab7f0d18e3303ef41ea95f64f matchesDocker-Content-Digest andbodySHA256. Tenlayers8465771723compressedbytes; final6a23125f3a9fbb7b70a4affee75d0f3f3f28f9b94bd13e6ffe9a291ae50e9e67 is4177490423bytes. ConfigGET307notfollowed. No layersdownloaded, builds/jobs/GPU/modelcalls/resourcewrites0. Embeddedruntimeproofs notyetextracted/verified.


## `a11y-readiness42-delayed-entry-controls` (2026-09-08)

2026-09-08 one focused browser invocation exec61001 using frozen39 built room fixture. Delayed-entry old1200ms snapshot false; new shared readiness mounted438ms after scheduling entry250ms later, actual axe zero violations and injected image-alt negative detected. Never-mount timed out30017ms, critical coverage, no axe scan. Non-timeout errors propagated. Root152V2SQL72400 was concurrent network-only activity. No full accessibility or release rerun; original39 failure preserved. Receipt scratchpad/a11y-readiness/1788859621123/result.json.


## `materializer41-focused-offline` (2026-09-08)

2026-09-08: actual worker/AES/renderer/ledger/package10fixturegroups passed4bad89; providerrevision7passedabcf20; UItransportcontractpassedf27b77; owner-eval31passed39e391; qualification27passedfe5f32; incumbentAzureadapter54passed08d251; route4passed5b9739; copy7scopes/21negativecontrols passed45680. Private-dependency semanticTS89331 terminal0.29exactproductionSQLshapes retained in expert-candidate-materializer41/scratchpad/materializer41-proof/sql-inventory.json with synthetic params. Mountedbrowser,155actualSQL,Azu generation andowner preference not run at this entry.


## `materializer41-mounted` (2026-09-08)

2026-09-08: immutable48adf0b1baf7d7decb77ff4bd590ab3f41eae161, exec47376 terminal0,12groups at390/1440 passed. One keyboard action runs60serial synthetic response advances; noinitialstatusmutation, exactcandidate review, lostresponse stops untilread+explicitresume, accountingholdstop, finalsamecountcompletion, account/unmountcancel. No pageerrors or horizontaloverflow. Original12group terminal output retained in task; sharedpath artifact replaced bylater14group run, no originalfile survivalclaim. Inspected390PNG; inheritedcloservoicecopy flagged as misleading intextlane. This is focusedfixture usability, notfullstudio visual/realmodel acceptance.


## `materializer41-text-copy` (2026-09-08)

2026-09-08: source6261b392 follow-up, exec28993 terminal0,14groups390/1440 includingHindi writtenreplyheading andaccurate unchanged-AI completion. Inspectedready-hi-390PNG. Receipt expert-tools/materializer41-ui-6261b392-20260908.json SHAe7584bd937c0fcd29e4a219babe157f53ce0f933abeb47285895920df3be4a7a. Legacy en/hi TEXTpaneltables updatedequivalently; voice listening paneluntouched. Original48source preserved. Futureharnessartifactdirectories nowunique timestamps, no extra modelcallsorSQL.


## `personal-auth-hindi41-focused-pass` (2026-09-08)

2026-09-08: Sequential offline checks passed46 personal-auth,16 Hindi probe,10 magic-link,95 locale,31 performance-measurement and9 prerequisites controls. tsc -b --force passed26.231s at09:50:33.103Z–09:50:59.335Z. Mounted exec63993 passed8 en/hi x390/1440 xgeneral/test actualAuthGate views in21.493s at09:51:05.080Z–09:51:26.575Z and11 realDOM probe controls in1.856s. Selector88–89x44px,contrast18.203:1,focus/headeroverflow checked. Actual source/CSS with mock account responses; dictionary preload and font wait are fixture-only, not live-provider/performance proof. Copy7scopes/21negatives pass; scoped Impeccable detector once returned[]. Raw scratchpad/focused-1788861065078 and personal-auth-locale-browser-1788861065537. No production build or full release.


## `personal-auth-visual42-eight-views` (2026-09-08)

2026-09-08: exec6562 terminal0,09:59:12.827Z–09:59:33.815Z,20.986s. Eight en/hi x390/1440 xgeneral/test actualAuthGate views; four test views add hero/form non-overlap, whole scene overflow and visible active text contrast>=4.5. Selector44px/focus and email/code/cross-tab failure flows still pass. Actual eager CSS/mocked account responses; no liveprovider or performance claim. Screenshots/metrics scratchpad/personal-auth-locale-browser-1788861553569, correctedHindi390/1440 visually inspected. Scoped Impeccable once returned[].


## `performance40-hindi-runtime` (2026-09-08)

2026-09-08: exec76194 terminal1 at09:03:43.024Z. Exact fixed3 studio-hi LCP3216/2332/2408, TBT292/143/236, HindiDOM836/711.1/786.4. Trace1 complete19173;2/3 capped20000 and incomplete. All source/dist/config/browser fingerprints unchanged, no rerun. Native Layout1212/596/544ms retained, partial2/3. Report PERFORMANCE40-HINDI-RESULT-20260908.md.


## `qualification44-offline` (2026-09-08)

2026-09-08: n32owner eval checks, n28qualification checks, n11service and actual HTTP-wrapper groups, plus UI response/transport contract passed with strict fixtureSQL. Exact same-vote interrupted-write replay reconciles, foreign owner and fake evidence cannot pass, mutated session/artifact/core/model/coverage refuse. These runs use inert config SHA728dc5821336bed9c5ad851b3e837a54d342674923de81454ce11b0a2d48a432. No actualSQL, Azure, concurrency, semanticTS, mountedqualification UI or fullrelease claim at this phase.


## `materializer155-v2-offline` (2026-09-08)

2026-09-08: n32V2controls passed including badtransactiontags, failed/unacknowledgedclose, harddeadline durableunknown, directlaunchrefusal. Prepare and bootstrap --check passed freeze705d219bc39f1ff336df7695028c0290782683acb5e69b620eba9bcc4a820ba6. Original n34 query guards also passed beforeV1review. All are offline; actual155SQL/runtime remains unproved. IndependentV2review requested before root serializedrollback.


## `qualification47-analytic-bounds-zero-observations` (2026-09-08)

2026-09-08 analytic calculation only, n_observed_model_trials=0, PostgreSQL/runtime tests=0, provider calls=0, cloud mutations=0. Hypothetical zero-failure one-sided exact95 upper bound formula 1-0.05^(1/n) yields 0.993608% for n=300 and 2.951305% for n=100. For one failure, solving (1-p)^n+n*p*(1-p)^(n-1)=0.05 yields 4.655981% at n=100. A <=1% bound needs299 zero-failure trials or473 trials with one failure; this does not reduce the existing300 critical floor. Wilson z=1.96 lower endpoint for18wins/30decisive is42.320052%. Assumptions: independent representative Bernoulli trials; repeated/clustered/handpicked adversarial cases do not automatically satisfy them. Source inspection at materializer41 HEAD a4bf870fd3b8fffa5862081f03c32abba2ffaac5 found relationship empty and history empty. Primary method source https://itl.nist.gov/div898/software/dataplot/refman2/auxillar/exacbino.htm; readable source links and interpretation in QUALIFICATION47-PROTOCOL-REVIEW.md.


## `materializer155-actual-parser48` (2026-09-08)

2026-09-08 n=1 exactV2freeze705d219bc39f1ff336df7695028c0290782683acb5e69b620eba9bcc4a820ba6 actualrootexec96967 terminal0. Receipt materializer155-v2-38754c4b-d73e-4d1f-b052-275532ee69be-result.json passed_rollback_ddl_and_29_explain_runtime_unproved. Four DDL and29productionEXPLAIN tested with rollback/restoration; migration_committedfalse/provider0/runtime_provenfalse. Actual materializer behavior/erasure/concurrency follow-on required.


## `cu39-cpu-reader-scheduled48` (2026-09-08)

2026-09-08 n=1 scheduleRun actualcu39 at1788862389.7444232, durableacr-cu38-receipt-run-intent.json run_recorded. Exactimagefdad90ee266ba38d42887df77888d8f6a9cb054ab7f0d18e3303ef41ea95f64f; reader677cc21b675af8a055c60b484fae33685b72e82a5ed8346bedaac37936559e68. CPU2/600sbound is resource request bound, not invoice cap. Terminal/bundle verification pending; no qualityclaim.


## `release45-initial-prechecks48` (2026-09-08)

2026-09-08 n=1 serialized14command runexec68314 terminal0 at10:11:37.841Z, source060eb54f unchanged. ForcedsemanticTS,copy,actualVitebuild+11offline checks passed; receipt release45-scoped-1788862192312/result.json. Lateraccounting46 andincominginfra/correctionrevision changes require corresponding integrated verification; nofullrelease accepted orappdeployed.


## `cu39-receipt-run-terminal-failed` (2026-09-08)

2026-09-08 actualcu39 terminalFailed observed1788862579.6553578; root scheduledonce1788862389.7444232 CPU2/run600/step120. Final2296byteAzurelog SHA41a7e1e8ad6c195a536992f186b0238cda9a94966747455a0efb871c85ddd780; no receiptchunks/bundle/readerfailureJSON. Sanitizedsignatures literal timed out, step+timeout, timeout+120, exitcode1, pullstarted/stepstarted. Noacceptedruntimefiles extracted; publishedcu38unchanged; observerwrites/builds/schedules/GPU/modelcalls0.


## `continuity-audio40-mounted-result` (2026-09-08)

2026-09-08 one real mounted synthetic-HTTP browser invocation exec95828 passed46 groups:34 original controls plus12 locale/width/state cases. Hindi and English at390/1440, continuity-disabled, unrelated-disabled and ordinary voice states preserve authorization and exact described-by binding. Receipt scratchpad/meet-setup-ui/1788861717206. Hindi390 and English1440 screenshots visually inspected: note readable without clipping. Semantic TypeScript emitted no diagnostics and copy passed7 scopes/21 negative controls in exec87253 terminal0. No model/voice generation, cloud calls or full gate run; this verifies explanation only, not continuity audio capability.


## `performance-accounting46-twelve-controls` (2026-09-08)

2026-09-08: Root source cleared light controls while integration45 retained heavyCPU lane. node evals/performance-network-accounting.mjs passed12 in0.884s command; copy passed7scopes/21negatives in4.744s command. Durations include shell overhead, exactUTC notcaptured. Cases cover late font/request/Hindi events, deep-enough frozen snapshot, old live-object negative, actual subset counted once, nonHindi accounting and realcaller/return wiring. No browser/TS/build/fullperformance run. Eval registry addition preserves all existing entries; prerequisite fixture imports new helper.


## `qualification44-mounted` (2026-09-08)

2026-09-08: exec65294 terminal0, n28 groups390/1440 English/Hindi on actual CandidateEvaluationLab and API client with synthetic HTTP. Explicit Check results, missing-safety inconclusive, malformedactive receipt, lostresponse statusonly recovery, duplicateclick/account/candidate/unmount abort and late receipt rejection passed. Applicationf84b763f unchanged, harnessf36f7ab9792f76a64fa3e03cfc28c55d01365b0a. Receipt qualification44/scratchpad/candidate-qualification-ui/1788862547058/result.json SHAe61b09ab820e5945ed7d60c3e73befee199efc87cae36de595723dfe5652b4ae. Inspected390HindiPNG. Minimal fixture, not whole-studio design or safety proof. SemanticTS80075terminal0; copy7scopes21negativecontrols passed. Robocopy34104exit1 means successful privatecopy.


## `candidate-vote44-v2-offline` (2026-09-08)

2026-09-08: n32 protected lifecycle/bootstrap controls passed after replacing V1 uncheckedcommandtags and uncertainclose patterns. Preparation and builtinbootstrap --check passed freeze384a790ea6e0c14cf5ba50d944b59a03f1bf54869af9c36f63dfbff3a99889f3, zeroSQL/providercalls. Source binds baselinea4bf870 and repairf84b763fae4ade1474d084ca77201659ce34359b. Packet is ready for independent review, not executed; actual concurrency remains unproved.


## `qualification44-recovery-offline` (2026-09-08)

2026-09-08: n13 service groups passed, including collecting/allvotes status availablefalse with0writes, one explicit owner qualify reconciliation, repeat without second repair, lost authority and pending/missing assignment refusal. API/UI source unchanged from28mountedgroups. Additive SQL not executed yet; requires156. This is control flow evidence, not concurrent PostgreSQL proof.


## `candidate-vote44-actual` (2026-09-08)

2026-09-08: root exec25337terminal0, candidate-vote44-v2-aa272e89b9c4f26eeabf457e-result.json passed_actual_vote_rollback_concurrency_unproved. Exact baselinea4bf870 reports29of30/incomplete after storing30votes; frozenrepairf84b763fae4ade1474d084ca77201659ce34359b immediately reports30of30complete. Actual identical/conflicting replay, foreign-owner refusal and unchanged runtime assertions passed. Confirmed rollback, cleanupUncertainfalse, no session/cleanup errors, externalprovider0. Separate actual transaction concurrency and later305recoverySQL are not proved by this receipt.


## `release45-full-start49` (2026-09-08)

2026-09-08 n=1 fullgate rootexec57429/child14220 started10:25:42.009Z. Source71663c5d173ed0ffe49b86639567cf83e9b7cd16, digest7c8a0cc5ece79313b404612d6f6aabde711497a1860bbe4fdeb58bc034612c6d, preparationrelease45-preparation-1788863025716.json; logrelease45-1788863142008.log andexpectedcompletionrelease45-1788863142008-completion.json. Outcome pending. Actuallightweight network/SQL153races alreadyactive separately; AzureCPUreceipt remote. No competinglocalheavywork. Relational gates skipunderblankconfig, neverreportedpassed.


## `publication153-committed-races-start49` (2026-09-08)

2026-09-08 n=1 rootexec74582 startedexactnewpacket697bb3ef1b94017ed5134f0720e23d253a726025bb408aab746767dfa6ece3ba via protectedbootstrap.450soft/495hardseconds, intendedfourcommittedorderings+foreignfixturecleanup in DEVELOPMENT only, provider0. Original25c4packetunexecuted; fixedenvelopebased944estimatedSQL andactual234SQL68.583s n1, notpercentileguarantee. DB lane rootexclusiveuntilterminal. No acceptanceyet.


## `cu3a-single-bounded-recovery49` (2026-09-08)

2026-09-08 n=1 actualcu3a at1788862977.183851, acr-cu39-recovery-intent.json run_recorded. Newpacket065d135cbe16b855a12694cac173620cb2e01a66fc0adf45b54366fac877285f pinsoriginalcu39Failed/120sstepdeadlineevidence. Exacttask changesonlystepTimeout/steptimeout120to450; CPU2/overall600/Python30s/256MiB/image/readerunchanged. No rebuild/model/GPU. Same-runreadonlyobservation ongoing; no furtherretries implied.


## `cu3a-runtime-receipts-verified` (2026-09-08)

2026-09-08 actualcu3aSucceeded1788863256.0163672; bundleaccepted1788863264.1700466. Fourteenfiles68758bytes, manifestSHAae6dcb28cd816cd74d0ab3e644c08ceaf40c037392c396453616d1db086f9c4e inexpert-tools/acr-cu39-recovery-logs-1788863264170016800-verified-files. Runtime.lock4c475588f8487ff5c882e7d0b0d18c3a6d718c0f13336ce7be4fcba848026834;70wheels4058779632bytes,71installedincludingbootstrap;2MFCCvectors maxerrors1.2706882990447978e-12/4.074240944618168e-13. Cleanupwheelhouse4058779632/buildvenv96788076/source38062bytes removed;runtime/base retained. NestedMFCC5898bytes hashb150638847ab8fdb6fa41bee158a1eba9ef7b64f509d753beaf83fb1b5d6d33d remote-onlybytecheck pluslocalcrossreceiptcheck. Models0/calibrationfalse; noobserverbuild/GPU/modelcall.


## `publication153-actual-accepted50` (2026-09-08)

2026-09-08 n=1 actual four-ordering run10:24:32.027 to10:28:17.878Z; publication153-committed-fc284ad2c0bcfb2bdce42ab5-result.json SHA3ef674e2a084d93cf987bacb841d481c9b3829c6c703cac32c769487106735b9.599pins verified,47linked durable events,14exact COMMITacks,944SQL/provider0. Four transactionid blocking witnesses,5fixtures cleaned/70zero privatecounts,15foreign digests unchanged;12opaque retirementIDs intentionally retained. No errors/recovery. Scope controlledsyntheticDEV orderings, not load/real-auth/Azure/quality proof.

## `materializer-background50-source-inspection` (2026-09-08)

2026-09-08 n=1 source inspection across materializer41a4bf870, activation44af69cd08 and release45 candidate.155 already has preparing-to-working atomic claim and60-200 response slots; observed only browser calls start/advance, no scheduled candidate caller. Existing Azure web cron runner and independent-disabled schedule pattern available.48 draft lacks expected-response-model/basecommitment/evaluationKEK configuration. Historical media-worker Bicep defaultsUSD1500 and no explicit budgetID. Tests0/build0/SQL0/cloud0/provider0 during FULL45 CPU/browser hold; not runtime evidence. Graph validation deferred to root lane release.


## `release45-terminal-result51` (2026-09-08)

2026-09-08 n=1 full gate10:25:42.009Z to10:51:41.628Z, exit1. Exact71663c5d source/config/dependencies unchanged per release45-1788863142008-completion.json.21/24 checks passed; performance/eval/security failed. Accessibility passed63301ms; relational gates skipped not passed. Four performance findings, seven named failing suites, one unallowlisted esbuild0.28.2 installation script. No new deployed release.


## `materializer155-runtime-start52` (2026-09-08)

2026-09-08 n=1 root childsession88833 launched exact155runtimeV3. Durable start materializer155-runtime-v3-7372ada2-d6cc-45ad-a165-53cccaaea64b-start.json.32offline controls/preparation/check passed beforehand; actual SQL outcome pending.1200soft/1240hard bounds. Source48adf0b1baf7d7decb77ff4bd590ab3f41eae161, production functions with synthetic provider response do not prove Azure inference quality.


## `materializer155-runtime-failed53` (2026-09-08)

2026-09-08 n=1 actualV3 from11:10:01.428Z to11:12:12.166Z.37assertions passed before all initial contexts are encrypted failed;29EXPLAIN completed. Exact15a91freeze, result7372ada2-d6cc-45ad-a165-53cccaaea64b. Rollback confirmed_after_failure, cleanup_restoration verified, close_confirmedtrue, empty session/cleanup errors, cleanupUncertainfalse.0externalprovider/COMMIT; runtime_provenfalse. No actual model quality claim.


## `azure-web50-focused-source-controls` (2026-09-08)

2026-09-08: n=10 deployment and n=19 publication controls; Local Python offline caller controls; actual JavaScript publication runtime/reservation with explicitly mocked SQL/store/model transport and source predicate mutations against release45. No actual SQL, provider, deployment or browser. Result: 10/10 and 19/19 pass; publication first attempt failed after15 because first-only string mutation left duplicate predicate. Corrected harness removes every exact occurrence and verifies absence. Source: 71663c5d173ed0ffe49b86639567cf83e9b7cd16; publication script SHA256 a4b3ca8fae13283aa00b9a7f181d8e64f18f22a2cfa4bb30fd6948d5a86bcd8b


## `asd40-cu3b-start54` (2026-09-08)

2026-09-08 n=1 root12369terminal0 schedule returnedcu3b at1788866264.5370405. Exact archive7187bytes SHAa44e0bfdb39b92623072c2ca218d12d511ee140751527f36cfb0c3ab6f28ab6e; preflight404 receipt571c7c5b0c2750fc3a0f4d9f8e319071608c43d91e011ec98844a0d7628ae20f. CPU2/900overall,stager180,8assets4419705bytes, no additional start/retry. Actual build/publish still pending.


## `auth-loading47-source-hypothesis` (2026-09-08)

2026-09-08: Six45 studio runs font113718 at namedimmutableboundary; delta29570 againstprior84148 matches builtGeistLatin29400+known170responseoverhead. Source initialloading usesGeist then finalgeneral usesInstrument. No perrequest45 lifecycle or nativeDOM attribution exists. No newtests/browser/build duringfull45hold. Plan fixed3 coldcontexts peren/hi perbaseline/candidate unchangedworkload with passiveboundedlocalfontinitiators.


## `auth-loading47-pair-complete-failed` (2026-09-08)

2026-09-08: exec62351 child33656 started11:17:55.655Z terminal1 11:19:18.489Z,noexpiry/kill. n3 eachrevision/lang counterbalanced coldcontexts actualgate. English baselineLCP2456/TBT100 vs candidate2240/166; Hindi baseline3792/1341/DOM2286.1 vs candidate3976/1791/2404.3,bothHindi fail3limits. Candidate6of6noGeist,84148font; baseline5of6Geist29570,median113718 (oneHindi2pendingfonts). Actualsanitizedinitiators parser CSSdevanagari-600 forGeist/Noto andstudioAuth forInstrument. Immutableboundary/source/dist/package/config hashesstable. Sourceaf625abc, rawexpert-tools/loading47-pair-20260908-once. No releaseacceptance.


## `native49-current-layout-captured` (2026-09-08)

2026-09-08: exec54481 child26720 11:31:45.212Z–11:32:00.018Z terminal0,noexpiry/kill. One sample LCP3564/TBT1127/visibleHindi1847.9 alloverlimits,diagnosticnotacceptance. Trace9508records1379956bytes26579filtered,no loss/cap. MainRunTask1012.169ms wall195.804thread includesFunctionCall959.661,UpdateLayoutTree135.885,Layout816.474;22nestedshape spans234.488inclusive,max62.484. Observer1010mstaskalignsdominanttask. Instrument/Noto200completed84148,noGeist. Source/dist/config/packageunchanged. Selectedpowerwindowqueriesavailableempty. Rawexpert-tools/native49-once-20260908.


## `cu3b-asd-artifact-bytes-and-registry-verified` (2026-09-08)

2026-09-08 actualcu3bSucceeded observed1788866687.9644134. Exactdigest+tagregistryHTTP200/bodySHAchecks at1788866707.9975293 verifyvyaktivoiceacr.azurecr.io/vyakti/asd-artifacts@sha256:f45508ab18a827b34f06bda245fd0ebf4690362bfbac668ad50a33eb373aa3ea,3036manifestbytes. Stageproof8artifacts4419705bytes,includingreal232589byteYuNetONNX8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4 and4175289byteLightASDcheckpointSHA/Gitblobchecks; bothlicenses/sourcehashesmatch. Log8210bytes SHA5f59d14edf84e6cf164c5daf61cbbeb134e004145d323297a6b4cd132da05b4b, rawnotpersisted. Models0,onnxparserfalse,execution/calibrationfalse. Observernoadditionalbuild/retry/GPU/modelcall.


## `azure-web50-evaluation-key-independent-readback` (2026-09-08)

2026-09-08: n=10 successful GETs for complete9-name collection/version metadata, plus n=1 exact evaluation version collection GET for returned version94838e0aaf0d4bf09049197b1be5a64c/enabled/contenttype/exact4tags. Secret-value GETs0, authorwrites0. Metadata SHA235a48ff268ab23b2f9add1ad7fe863c23eacd489721b1bc5cad297e6f7a18b2; exactversion receipt SHA97f29270140c3ced0e2ae08ff5e97702672b73bb476e5094712499e2f0edac7c. Focused equality control preserved all17 prior public settings,8applicationrefs and registryref; added3publicsettings+1evalref, deploy/schedulesfalse. No model/database/deployment acceptance.


## `azure-web50-preview-key-metadata-read` (2026-09-08)

2026-09-08: n=9 successful GETs, complete exact preview vault secret collection plus eight version collections, all HTTP200, no pagination. Exactly eight old names, one enabled version each, consistent with existing preview bindings; no dedicated evaluation key. Receipt azure-web50-eval-key-metadata-1788866383640087000.json SHA256d0019b2c47ff3c55f01d2caf9b43af1e1c8f528e66a27cd73d3ec000b3fbb876. Secret value reads0, secret writes0, model calls0. Scope is this vault only.


## `materializer155-v4-start56` (2026-09-08)

2026-09-08 n=1 rootchild12478 running V4 exactfreezeecb25c429737fab81da56d49aef9811cf8a7cf8c6372f25c4a552b7e7cb52d80. Independent1729pins verified;41offlinecontrols/preparation/bootstrapcheck passed. Actual durablestart materializer155-runtime-v4-7d49eafd-40e5-414a-af8d-0538d2a99e37-start.json. Productunchanged, exactjobenvelope roundtrip/tamper/crossbinding and savepointrestoration replacefailedfieldproxy. No actualoutcomeyet/COMMIT/provider.


## `asd41-cu3c-start56` (2026-09-08)

2026-09-08 n=1 rootcommandterminal0, actualcu3c at1788867929.9624543; exactpacketf2d124d6f6a0d783d998d930beab944a3b35f66e88b90f299c84b555e10746d9 andreader7107c6f12b54bf2fced7184729eed1e048115da7988a5663cb6a3ed07d3f0056. CPU2/600/450, builds0/pushes0/GPU0. Observerreadonly same-run, actual semantic outcome pending.


## `azure-web50-feedback-independent-readback` (2026-09-08)

2026-09-08: n=11 successful GETs for complete10-name/version inventory plus n=1 exact feedback version collection GET verifying versionc6fd8aead5e846bca25c19e049d81c52,enabled,contenttype and exact4tags. Previous9names/versionmetadata compare equal. Collection receipt SHA70483a1c8c11e4e0fa32a6389d05485ce0cd8880a14149ac6a9ea886950391fe; version receipt SHA5593c5419de93d5d6c180ffad695abc21af1ba29b145d24884775b5be6acc0ba. Draft SHA7a656ee07da59a1c96eace580d9c2153cf66543c6dc7e83b4289cfe6342a6082. Focused equality control preserves17settings/8refs/registry and confirms4publicsettings+2refs, deployment/schedulesfalse. Authorsecretvalue reads0,writes0; rootwrites separately receipted. No SQL/model/deployment proof.


## `probe52-forced-layout-attributed` (2026-09-08)

2026-09-08: exec11675 child25852 11:36:34.465Z–11:36:48.221Z terminal0,noretry/kill.10calls0overflow;first9~1.7ms,totaltruecall1868.9–2545.9=677ms,marker2546.2. Observer690mstask1860;nativeFunctionCall677.247 wall150.233thread containsStyle129.629/Layout544.104. Trace9116records1325936bytes25755filtered,no cap/loss. LCP3232/TBT895/DOM1646.2 stillfail,diagnosticnotacceptance. Source/dist/configunchanged,selectedpowerwindowempty. Rawexpert-tools/probe52-once-20260908.


## `materializer155-v4-erasure-failure57` (2026-09-08)

2026-09-08 n=1 actualV4child12478 exit1,11:43:15.564 to11:50:31.526Z; result7d49eafd-40e5-414a-af8d-0538d2a99e37.1723SQL,115assertions:114pass/1sourceerasurefailure including successfulsavepointrestorationafterfailure.64pairedoutput/authenticatedenvelope/package/replay/meterchecks passed; rollbackconfirmed_after_failure/restorationverified/closeconfirmed/0uncertainty/errors/provider/COMMIT. This is scopedactualruntimeevidence, notoverallpass or realmodelquality.


## `release56-prechecks-stale-authority57` (2026-09-08)

2026-09-08 exactfd6cb49ded6ec7d260ee9202079ac8c87fa08979,402suites, release56-prechecks-1788868250664/result.json. First18of29commands passedincludingsemanticTS/copy/graph/activationpositive-private-publiccontrols;19thprivate-continuity literalglobalSQL assertionfailed againstintentional156derivedownerprivateauthority.10remainingcommandsnotrun, sourceunchanged. Eval-onlyrepair0750909a passed26continuity/8privatepointer/9deniedgroups; productunchanged, pendingintegration.


## `cu3c-actual-asd-cpu-semantics` (2026-09-08)

2026-09-08 actual cu3c Succeeded at 1788868184.2180102; typed receipt at1788868193.1899347. n=1 deterministic synthetic probe per model path. Light-ASD192keys/4104704tensorbytes strictCPUload, finite logits[25,2] from audio[1,100,13]/visual[1,25,112,112]. YuNet actual OpenCV ONNX parse and12finiteboundedoutputs. Process2.241s, loopback-only network verified. CPU2/run600/step450/processCPU120wall150AS8GiB. Receipt0e376f5efa28313ed9f0d3e356dc0b9766f311fa22fc4356d88227e1b57d7da0. No GPU/retry/build/private media.


## `pilot-estimate-uncertainty60` (2026-09-08)

2026-09-08: Planning estimate, NOT measured velocity: deployed pilot3–7 focused engineering days conditional on Azure/model viability; reliable multilingual pilot2–4weeks total. Competitor superiority has no defensible completion date. Last actual fullrelease45 passed21/24; no latest fullrelease acceptance or real voice-likeness evidence. No percentage-complete claim.


## `release60-scoped-fourteen-pass` (2026-09-08)

2026-09-08 n=1 admitted14commands12:16:09.174Z to12:16:26.752Z all exit0, receipt release60-prechecks-1788869769159/result.json. Exact876cf2fe4d36a050ebc184dbffbaa79a2d70eea1 source unchanged. Failed continuity+10previouslyunrun suites, observer29lightcontrols, copy and graph passed. Registry402 unchanged. Privatebytecopy177.651s,18emptyconfigexports, no network/junction. No18unaffectedcontrols repeated; no browser/build/SQL/provider/fullrelease. Stopped at parent-requested checkpoint; Hindi LCP/visible timing and creator cascade/fullgate acceptance remain unproved.


## `hindi-observer53-fixed-six-comparison` (2026-09-08)

2026-09-08T12:03:31.221Z to12:04:13.770Z: exactly6 cold contexts AB/BA/AB,n3 each, exec55281 terminal1, no timeout/kill. Baseline LCP3360/TBT1034/Hindi1861.5; candidate2732/99/1710.9ms. Candidate TBTpasses300, LCP/Hindifail2500/800. Product/dist and measurement helpers/collectors before/after unchanged. Candidate all3 renderer observed. Raw expert-tools/observer53-pair-20260908-once. No rerun or acceptance claim.


## `pilot61-release-keys-and-sql-start` (2026-09-08)

2026-09-08: Release60 876cf2fe passed14 scoped commands12:16:09.174 to12:16:26.752Z,402 suites preserved, no fullgate claim. RootV5c SQL session63726 started12:17:22.999Z exactfreeze1ffd865fbed7179f200f4b5999ad0e5b6013204dad0086bab49c2577e4170246, result pending. HMACcopy terminal0 receiptazure-voice53-hmac-copy-1788869885134252300.json:4app-wide listSecrets returned8entries,3PUTs receivedversions,0runtime calls. Values processed in memory only. Independent metadata collection1788869974242981200 confirms13names/versions; prior10preserved. Tags not retained in that collection, claim requires separate evidence.


## `azure-voice53-metadata-readback` (2026-09-08)

2026-09-08: n=1 complete collection/version metadata readback plus n=3 target-version metadata projections. Prior10 names remained present and their version metadata was byte-equivalent to azure-web50-eval-key-metadata-1788867527824162600.json. New3 versions were enabled and tagged scope=isolated-web-preview, purpose=voice53-hmac-copy. Secret-value reads0, writes0, runtime/app/deploy calls0.


## `materializer155-v5c-terminal62` (2026-09-08)

2026-09-08: n=1 rootexec63726,12:17:22.999 to12:24:54.324Z, receiptmaterializer155-runtime-v5c-d70b195a-a270-49dc-bfbb-497cc3927671-result.json.1740queries:1710work27cleanup3rollback, no failedqueryrecord; trackedassertionspassed, terminalCHECK_FAILED atactual_materializer_runtime. runtime_provenfalse,rollbackconfirmed_after_failure,restorationverified,closeconfirmed,0cleanup/sessionerrors/uncertainty/provider/COMMIT. Positivebeforecounts affected1job64items1run32assignments96assets1qualification; unaffected/foreign each1run1qualification. Aftercountsnotreached; no erasurepass claim.


## `materializer155-v5c-erasure-correction62` (2026-09-08)

2026-09-08: Rootdirectlyread finalV5c result.erasure_proof. Beforeaffected1job64items1run32assignments96assets0judgments1qualification; afterall7counts0. Unaffected andforeign eachretain1run1qualification andothercounts0 exactlymatchingbefore. Thus actualerasureSQL ran. Earlier runtime62 claim aftercountsnotreached/querynotexecuted was incorrect, basedonlystandalonebeforefile andabsencefailedSQLrecord. Terminal remainsFAILED because journalcollision preventslaterassertions; rollback/restoration/close confirmed.


## `materializer155-committed63` (2026-09-08)

2026-09-08: n=1 rootexec82436 exactfreeze3fb8c7e8eaad0d1b5eb8999dd7efcfe4f3393eeee33fd9a793252b2cf680e107,12:35:06.119 to12:35:37.689Z. Receiptmaterializer155-commit-v2-d13a32b5-0aed-4ad2-a919-ab0496f7dccf-result.json statecommitted_verified/migration_committedtrue/cleanupUncertainfalse/closeconfirmed.54work56readback2rollback plusrawCOMMITack, separatepreflight/writer/observer; syntheticreplicas/agents/logs/budgets/spends0, ledgersunchanged,provider0. Productionuntouched.156 packet preparation resumed againstactual155 and release62source.


## `preview-provenance-keys-created63` (2026-09-08)

2026-09-08: Enabledv4SHA07d7f9f12c272444637bb05b166189df180b771ed273b719ed202c97fbe9b0a5 actualterminal0,2PUTacks receiptazure-web50-protection-keys-create-v2-1788871075533494100.json. Newwatermarktoken version62643b03ef1c49cab928f11804495c6d andcommitmentversionc643781105ba4c6e9e3c2f8f46deb06a. Independent16metadataGETs receipt1788871096854339900,0valueGETs/writes; old13versions exactunchanged. V4draft5additivesecretrefs preservesprior10apprefs/runtimeSettings,deployfalse, SHA4baaa428c129e5da4c5e40325a00648d13adb2f260cafcfab02e27f5d3936e2f. Noapp/GPUcall.


## `candidate156-v3-actual-failure64` (2026-09-08)

2026-09-08: n=1 root22186,12:44:54.358 to12:47:03.632Z. Receiptcandidate156v3-301bde55470c153614a90fd6-result.json;496queries,48/48trackedassertionspassed,14DDL,29EXPLAIN includingfailedOWNED_PRIVATE_RUNTIME_CONTEXT_SQL hashb563a9eda463ac64aced0b3be35a22a1b7ee8e057e4c6521798193a14568d3c1 SQLSTATE42601. Rollbackconfirmed_after_failure/independentrestorationconfirmed/closeconfirmed/0cleanupuncertainty/sessionerrors/provider/COMMIT.156NOTapplied; privateactivationselection provedscoped, subsequentservingnotworking.


## `web64-context-prepared` (2026-09-08)

2026-09-08: n=1 prepare from62c230e992,1115files/sourcecommitmentsha256:a7d409bc6c296a23496c55172a70160662ebee1fb58102bcae0e913b811ca823 inexpert-web64-build-context. Rootprepareexec4724terminal0 andnode services/azure-web/build.mjs --verify-context terminal0. No npm/build/cloud/provider; workhorseSol agentpreparesboundedACRpacket only. RealbuildheldforprivateSQLsourcefix, no releaseacceptance.


## `voice64-production-aggregate-read` (2026-09-08)

2026-09-08: n=1 aggregateSQL inproductionneondb at12:48:20.472 to12:48:23.277Z; expectedhost/database+transactionreadonly verified. Active replicas0, activeowners0,nonterminalgenerations0,recent1hnonterminal0,generationowners30d5. Receiptvoice64-owner-counts-1788871703277.json. Rollback/closeconfirmed,0SQLwrites/provider/runtimecalls. Noidentity/textvaluesreturned. This doesnotprove otherdeploymentsidle or currentownerreferenceauthority.


## `private-sql-literal65-fixed-size` (2026-09-08)

2026-09-08: Rootimportedactualfixed OWNED_PRIVATE_RUNTIME_CONTEXT_SQL andcomparedV3frozenquery:177334bytes before,26730after;0SQL/provider. Authorfocusedliteralregression plus8pointer26continuity12history passed; no performance/voicequalityclaim. Fixedsource548d now403evals. Azurecontext65 prepared1115files sourcecommitmentsha256:651eb54933aace57f8b094d7d1e225793a445ed29f0372dbc89656a0aa86b916, localbuild.mjs --verify-context passed; actualACRbuildheldfornextprojectionfix.


## `candidate156-v4-history-ambiguity65` (2026-09-08)

2026-09-08: Rootexec80105 terminalFAILED12:57:16.128Z,start12:54:56.229Z, freeze7eed936bbf8c224c6a5dae5af5a665413852002d1ae936da29bb9fa19f3cfe99. Receiptcandidate156v4-6ea6d026b9a36b382f2ef829-result.json:562queries58/58trackedassertionspassed; privatecontextloading/reset/rollback progressedpastprevioussyntaxfailure. EXPLAIN DIALOGUE_HISTORY_SQL failed42702 hash4917f421818777e685f75d607068be68d2aec6d11bc1b0a1160480509a593435. Rollback/independentrestoration/closeconfirmed,0cleanupuncertainty/errors/provider/COMMIT.156NOTapplied.


## `candidate156-v5-result66` (2026-09-08)

2026-09-08: One actual rollback run, source 7af59b3083e7ffafd062e3537987e6317196f263, freeze 1bbcf176d43e71c3ea2dbc9cfdc744375de4c0608bd95d7ff3fdee11daff160f. Receipt candidate156v5-2ff32a1a6ff54bb84280d42d-result.json started 13:02:30.890Z and finished 13:05:17.741Z. Failed assertion in actual_qualification_recovery; runtime_proven false. Earlier affected SQL parsing and activation passed. Rollback, independent restoration and close confirmed; cleanup uncertainty false; provider calls zero; migration not committed. No product quality or concurrency claim.


## `azure-web66-cu3d-failed` (2026-09-08)

2026-09-08: Context has 1115 files, source commitment sha256:5e9af616da3be7c94255600ccdc6b5ffa563ac707f251b9eb06ace04e7fed45e. Packet 3b1ea3c5788fabf6eb09dc0be4bd71e51f1f4674980883c3656cc8f5426d8334; archive 17157485 bytes. Azure acknowledged one upload and schedule, run cu3d. Subsequent actual read returned Failed in azure-web65-poll-1788873289524982400.json. Image not accepted; no deployment or GPU call. Build author assigned bounded log diagnosis, no reschedule.


## `candidate156-v6-pass66` (2026-09-08)

2026-09-08: One run, 13:15:58.870Z to 13:19:29.413Z, 847 queries and 106 assertions. Receipt candidate156v6-33103c4b716e2bb28cde57a6-result.json reports passed_actual156_rollback_synthetic_qualification_CAS_fault_cross_session_unproved and runtime_proven true. Rollback, independent restoration and close confirmed; cleanup uncertainty false and cleanup errors empty. Actual qualification available/inconclusive, failures empty, five missing safety evidence codes. Provider calls zero; migration not committed. No actual model, voice quality, deployed route or cross-session concurrency claim.


## `active-context67-bytes` (2026-09-08)

2026-09-08: One rewrite by refresh-active-state67.mjs, previous active prelude15920bytes, replacement4869bytes. Archive context/archive/STATE-ACTIVE-PRELUDE-20260908-1325.md written exclusively. Remaining historical STATE suffix preserved byte-for-byte by the script. This is a context size measurement, not a billed-token saving estimate.


## `candidate156-committed67` (2026-09-08)

2026-09-08: Actual root process71169 terminal0. Receipt candidate156-commit-f85face7-a00b-4649-90b3-70bfc4fae93e-result.json, freeze e4da1ea2f2aea479351b54d1db0dc613ecc0623524b6042974eb8b312fdd4597. Started13:25:44.409Z, finished13:26:19.869Z. State committed_verified, migration_committed true;122 recorded queries plus actual COMMIT acknowledgement,64work/56readback/2rollback. Nine parent ledger digests unchanged, exact created schema observed independently, close confirmed, cleanup uncertainty false, cleanup errors empty, provider calls zero.


## `azure-web67-cu3e-scheduled` (2026-09-08)

2026-09-08: Root reviewed source9e590a05e67f0cd07f7dadd069b5770a5fce34a7 central deploymentInputs additions and focused verification. Author14 package groups passed. New context1117files/source sha256:18b227ea215ee2f06ac91be9cf8f3336e434b3f85b58e89d2a1d3ff518f97e8c. Packet2088adc33f40ef595e359100b285a7433d2a7351e6bef41f7733102bfc03cb72. Root actual Azure acknowledged one upload and schedule for cu3e. No app deployment/GPU call; image acceptance pending terminal status and exact registry digest.


## `text-canary67-source-reuse` (2026-09-08)

2026-09-08: Sol agent source-only comparison found strict47 adapter/worker/route already integrated in9e590a, and candidate156v6-seed.mjs reuses proven12sessions x16feedback rows. Retained V5c actual builder evidence yields32held-out examples/64materialization items. Preview bindings SHA4baaa428c129e5da4c5e40325a00648d13adb2f260cafcfab02e27f5d3936e2f supplies named public settings and versioned secret references. This review made0SQL/cloud/provider calls; actual model quality remains unmeasured.


## `azure-web68-deploy-controls` (2026-09-08)

2026-09-08: Four pure Python controls passed once: current settings accepted, dropped setting rejected, raised budget rejected, duplicate setting rejected. Source preparation also verified unique substitutions and retained disabled template/release checks. No authentication, cloud call or deployment occurred. Files prepare-web68-deploy.mjs, azure-web68-deploy.py and azure-web68-deploy-controls.py.


## `azure-cu3f-published69` (2026-09-08)

2026-09-08: Actual cu3f status Succeeded. Registry readback azure-web65-verify-registry-1788876308990089500.json confirms exact manifest and tag both sha256:58798ecca2c39e814cdedeced7744f85745231dada8a86643102b08bf8db31ca in vyakti/expert-web. Source de84da660c8a0e5c04c1ad133b9b7c54a6f025f4, commitment sha256:18a3ac2346243aff592489a38cc952278d68d88f4324f87e3fb68da15bff2a58. No app deployment or GPU call. This image is not full release acceptance.


## `browser69-entry` (2026-09-08)

2026-09-08: Root started Vite on127.0.0.1:5181 at source de84 using a node_modules junction to lock-identical release60 dependencies. Actual in-app browser inspected English desktop, English390x844 and Hindi390x844. English entry console error query returned zero entries. Hindi locale switch displayed loading then complete form. Mobile email and Google actions fit the viewport; no auth submission/model/backend flow executed. Hindi heading computed fontFamily Instrument Sans Variable,sans-serif with38px/39.52px lineheight; source omits explicit Devanagari fallback on this heading. Screenshot expert-entry69-hi-mobile.png saved; viewport reset and tab marked for handoff.


## `canary71-actual-azure-rejection` (2026-09-08)

2026-09-08: n=1 actual canary, 14:23:07.291Z to14:23:49.451Z, source7af59b3083e7ffafd062e3537987e6317196f263. Receipt canary67-af8dd25b7d7d054d99e9364c-result.json reports failed correction_candidate_not_completed, provider_calls1, retained fixture. Independent read-only receipt canary67-failure-readonly-1788877540767.json confirms job cd688642-7bec-4c44-be9e-83e540703778 failed correction_proposal_support_invalid and reservation122dab6f-c564-40db-bb9e-3028e969439b settled2657microUSD, reserved8325. Read-only rollback and close confirmed. Baseline/candidate comparison calls did not run. Aggregate budget total has not been reread.


## `integration71-voice-entry` (2026-09-08)

2026-09-08: Agent integrated reviewed voice79530eb and authcopybd150a product changes into5a0e1aa978a9109d06227846fb586a9a3e32062f at web-context70. Author actual tsc,132voicepanel checks,copy gate,syntax and graph passed. Preflight now verifies required voice adapters before a billable wake; it does not prove voice likeness. Memory successor f0762772 is awaiting integration, with28author mounted UI checks. No new image, deployed app or owner voice request.


## `infra71-actual-compile` (2026-09-08)

2026-09-08: n=1 local Bicep build of web-context70/services/azure-web/infra/main.bicep succeeded, exec76139 exit0. Output release71-infra-compiled.json SHA ff43e07163b09db9637fdd326a951430d308fd603c9e7b009157b15370da73c8 exactly matches retained reviewed release45-infra48-compiled.json. Six existing ARM shape controls passed; four preview-setting controls passed after replacing stale unset-pin assertion with actual compiled hash and disabled bridge check. No ARM validation or writes. Helper compilepin set, but root release and artifact acceptance still required.


## `ui71-integrated-memory` (2026-09-08)

2026-09-08: Integration f5f63af7af2f3ff648f437b5647b983711831180 includes actual memory UI successor f0762772. Author ran28mounted tests across390/1440 andEN/HI, copy gate andcontext. Root source review confirmed native details closed by default, plain outcome labels and explicit platform responsibility. No deployed owner journey verified.


## `canary72-existing-fixture-semantic-audit` (2026-09-08)

2026-09-08 source-only audit, n=3 fixture families: V6 uses path-tag rejected replies and one numbered synthetic preferred sentence; correction-strategy-request uses 30 numbered placeholders; replica-feedback contains one generic realistic pair. None supplies 30 to 120 coherent train preferences across six groups for an evidence-based catalog choice. The authored voice bakeoff corpus contains six chemistry/teaching mixed-language replies reusable as synthetic preferred source material. No SQL, Key Vault, provider, or network call ran.


## `memory73-real-postgres` (2026-09-08)

2026-09-08: One successful readonly run in development vyakti_expert_integration_20260906, receipt memory73-readonly-v2-1788879605193.json. Seven exact production statements passed EXPLAIN without ANALYZE, including recall, source read, session history, admission, completion, speech refusal and history. Nine synthetic CTE cases actually executed in PostgreSQL: no feedback, off wording, close-only, voice-only, foreign owner, different response, newer exact supersession, newer correction and wrong-fact reason. All16 checks passed; rollback and close confirmed;0stored writes/provider calls. Source hashes597d132e9b54c5c6b02926d7d804265b75069c7fa7f4ff379cbe6b333c081e0a andef2d27b8e1c551301d88c7e73d8ec515d83481c4fa2d0986ab39d09d655f7ce2 match commit01ce63f6d311b65f109b8c9ad0ad568718435c3e. This proves query parsing and predicate behavior, not the deployed returning-user journey.


## `voice73-issued-sentence` (2026-09-08)

2026-09-08: Astra commitb7c6239c0324162b494adbdd0936b5dd617f66d2 connects existing speech-v2 lexical scorer to validated modern capture contract and real composer. Author60modern,34legacy and91nonce controls passed. Correct nonce with unrelated sentence rejects; mixed-script and digit-only recognition stay inconclusive. No new biometric cutoff, accepted liveness, bank review, readiness, cloud/media/SQL/provider/GPU result. Root reviewed source; new integrationpending.


## `release72-current-performance` (2026-09-08)

2026-09-08: Frozen9dd fullrelease runner currentlyactive exec8805. Its performance step failed:3runs,390x844,150mslatency,209715.2Bpsdownload,4xCPU; /studio LCP2680ms>2500, studio-hi LCP3252ms>2500, HindiDOM2388ms>800. Actual stdout at web-context70/scratchpad/release-logs/2026-09-08T14-45-25-822Z-33624/performance-budgets.stdout.log. Layoutreadabilitypassed. Otherrelease steps stillrunning; nofullpass/image/deploymentclaim.


## `release74-final9dd` (2026-09-08)

2026-09-08: Root fullrelease exec8805 terminal1. Logs web-context70/scratchpad/release-logs/2026-09-08T14-45-25-822Z-33624.22of24checks passed; performance and evalsuite failed. Eval failures: dialogue-unicode, room-knowledge, clonechannel, candidate-materializer-ui. Accessibility/security passed. Relational gates explicitlyskipped becauseblankconfig/noNEONenv; independent actualSQLreceipts do not turn those skips into release passes. No image/deployment/push.


## `correction74-real-sql` (2026-09-08)

2026-09-08: One readonly run, receipt correction74-readonly-1788880734127.json,3exact production EXPLAINs for datasetreview/build andinternallearningreader. Packet SHA5cd850c3a0ee71427caaae2f5b67c6281fafc6d76ff293263094345a4f6aaf0c matched039c333b exports beforeconnection. Passed3, rollback+closeconfirmed0writes/provider. Current owner-authored learner bytes participate in source_set_hash, buildracefingerprint andpair/versionbinding; no third-party learner content. No new Azure model call or quality outcome.


## `release74-root-unicode-controls` (2026-09-08)

2026-09-08: n=1 run of node evals/run.mjs dialogue-unicode after root repair,13groupspassed including actual service spend ordering and four source mutations refused by verify. Offline seams only; noSQL/provider/cloud/fullrelease.


## `core75-current-source-and-budget` (2026-09-08)

2026-09-08: Integrated68a includes corrected recall and owner learner context plus four repaired suites. Source-focused tests are not a full release. One actual readonly budget query receipt text75-budget-readonly-1788881542103.json reports cap1000000microUSD,spent144935,reserved0,active; prior2657settled. Rollback/close confirmed. Voice775 author34planner/77provider/132panel and29prompt plans pass, no audio rendering.


## `memory75-postgres-rollback95` (2026-09-08)

2026-09-08: Sol executed reviewed354c8b4a on development DB; root inspected receipt room-memory159-rollback-1788882730973-result.json SHA4e7a5d8b49eac4389934f0b756057df48454538858d814ea01fe458e1205c646. 95 SQL calls,11DDL twice,8exactEXPLAIN,31-day synthetic learner source produced cited fact/observation/episode/cursor and returning recall/history. Revocation blocked stale writes and exact forget counts1/1/1; actual shipped RoomForget predicates executed. Rollback, independent schema equality/fixture absence and close confirmed. Zero COMMIT/provider. Deferred-model withdrawal and other-Room survival still require semantic negative proof; true two-session not run.


## `canary76-actual-three-calls` (2026-09-08)

2026-09-08: n=1actualrun, exec14660 terminal1, receipt canary75-fcfa7810fcb99cd3fd6aebe4-result.json.3Azurecalls, draftcompact_observation8supporting trainIDs,2/64materializeditems. Settled3150+447+355=3952microUSD; no pending providerreservation shown. Raw synthetic baseline/candidate answers retained. Root qualitativeinspection: candidate shorter but generic, lacks concrete useful chemistry instruction; not qualitywin. Cleanup23503, closeconfirmed, no session errors; fixture cleanup remains uncertain. Claimconsumed, no replay.


## `memory76-semantic-negative59` (2026-09-08)

2026-09-08: n=1developmentrollbackrun59SQLcalls, receipt room-memory159-semantic-negatives-1788883015202-result.json SHA39660f550bd6ac0f4e46a5c958b5f68475123fb73ad587390c83200585e77ebd. Actual deferredmodelawait→same-sessionrevoke→modelresolve producedmemory_authority_changed andzero derived/cursor writes. DirectSQLduplicate/inventedquote rejected. Same-agent secondRoom unreachable under actualuniques23505, not survivalproof.0COMMIT/provider, rollback/absence/closeconfirmed;true2sessionnotrun.


## `clone76-context-wire` (2026-09-08)

2026-09-08: Authoreddc56dd identified acceptedidentity.home/culture survived PersonModel but compileReplicaRuntimeCore droppedthem.2bounded160characterfields added; actualcallerseam failedbefore/passedafter. Authorclaim41/person44/dialogue33offlinecontrols. Integratedwithvoice775andmemory159sourcein84c29e8626b315a6329e63b46a840ac93ad68e34;tscandfocusedcontrols passed. No159apply/fullrelease/image/deploy.


## `canary75-fixture-cleanup-v2` (2026-09-08)

2026-09-08: n=1 exact candidate-first cleanup transaction after a prior guarded draft-status attempt rolled back. Candidate status retired was independently proven as the source-erasure transition. V2 deleted exactly one candidate,replica,account-person,person-device,agent and person; COMMIT acknowledged and primary close confirmed. Independent read-only observer found replica,source,candidate,dataset,capability,account-person,person-device,agent,person,correction jobs,materializations and items all0. Three provider spends remained settled at3150+447+355=3952 microUSD; budget active limit1000000 spent148887 reserved0. Provider calls0. Commit receipt SHA256 4f48d2b0a66fe4e328dfc5e93fc823819aa6ae9d754cc7a4e4385705b97a84d9; observer receipt SHA256 d9c6cf305b1b46632893ef961717cf35b3917a212818910c7a2ace6c0783c4d9.


## `memory77-schema159-committed` (2026-09-08)

2026-09-08: Rootexec36624terminal0, receipt room-memory159-commit-5e3a81e0-9916-4215-91c7-f782a9674377-result.json. Reviewedfreeze2379cefa465d2f90783f8851e4cb943b7c07f89ab4a55d4dda0f3b9204919086, source84c/product354c. Exact11DDL appliedtwiceidempotently withinonecommit, COMMITack, independentcatalog+5unchangedrowcounts andcloseconfirmed.52trackedqueries plusCOMMIT,0provider, nofixtures; developmentonlyproductionunchanged. Writerfalse, actualtwo-sessionproofSolactive. Neverreplay159claim.


## `core78-config-integration` (2026-09-08)

2026-09-08: Cleanfb1395c797f6c577b3221d5d23a3f0c424f7dec2 siblingconsolidation-config161 integratesreviewed524sharedconfig atopf326knowledge160. Author7config/20authority/145consolidation+tsc/contextpassed. All8memorySQLexports and159/160DDLunchanged. NoactualAzurememorycall/migration160apply/fullrelease/deploy. Branchsuffix161doesnotreserveamigration.


## `memory79-real-concurrent-withdrawal` (2026-09-08)

2026-09-08: Actual v2 proof receipt room-memory159-two-session-v2-7a229746-479d-43cb-8eb0-0d6bd474743f-result.json SHA4919a58d61b6904e3b27eca0223e89ceb1161569c5704361547660127322e258.103SQLcalls,7syntheticCOMMITacknowledgements,0provider,writerflagfalse. Bothorders recorded waitingtransactionlocks and exact pg_blocking_pids. Revoke-first stale commit returnedzero; writer-first shippedRoomForget removed1fact/1observation/1episode andscopedrawdata. Independentallfixtureabsence,spend86rows/digestunchanged,4connectionsclosed/noerrors. ScopeoneRoom/follower,notmodelquality.


## `knowledge80-schema160-development` (2026-09-08)

2026-09-08: Actual rollback v3 receipt knowledge160-rollback-1788885807972-result.json passed 6 checks, 43 SQL, one DDL twice, actual claim approval to PersonModel/runtime, invalid domain and provenance refusals, independent original schema/row fingerprint/fixture absence, rollback and close. Root then reviewed and executed freeze5917df9e9e583cb24dba97e67c6f950f664e9c7156b956de9bc32fdf08ff65ea. Commit receipt knowledge160-commit-c1935a73-60a7-46fa-b683-ca354f210bb1-result.json committed_verified, two DDL passes, exact COMMIT acknowledgement, independent constraint and unchanged claim fingerprint, all connections closed, no cleanup uncertainty or provider calls. Development only; production unchanged. Claim160 consumed, never replay.


## `core80-question-integration` (2026-09-08)

2026-09-08: Isolated f66d6700c65190e17ee6d5dec8fee13292c9b747 integrates cd3a52a and test9f6541b atop fb1395; SQL and migrations unchanged. Agent actual runs: dialogue42, PersonModel49, candidate runtime17 groups, copy, tsc and context checks passed. Four known C0 corruptions repaired only in the new candidate. No new model call or expert quality result. Lexical ranking across at most24 approved claims, not full-document retrieval; dense candidates may refuse over6000 characters.


## `memory81-actual-azure-enum-failure` (2026-09-08)

2026-09-08: One root-executed canary79v2 at frozenfb1395, enabled envelopeb795615d41eae17f828775e33fde65c1d5fa722ab5f55d96e79635b9aa7dbb0f. Receipt room-memory79-v2-d369d87f8a6d708956351d36-result.json, actual response gpt-4.1-mini-2025-04-14 HTTP200 stop, usage208input/126output,285microUSD settled. All3authored stable preference quotes selected exactly, including full negated fast-English-only clause, but model invented invalid kind/name enum values, so shipped validator refused and zero derived memories persisted. Actual forget0/0/0, independent synthetic absence all10counts0, primary/observercloseconfirmed, zero sessionerrors. Budget149172spent/0reserved/1000000limit active. Claim79v2consumed neverreplay. This is bounded selection evidence and a real schema adherence failure, not full memory quality or ownerhuman result.


## `erasure82-actual-postgres` (2026-09-08)

2026-09-08: Root ran source-erasure164-readonly.mjs against development database with frozen d9937a4f03a1ef4e3ec7db1325a5ed5149f1d107. Receipt source-erasure164-readonly-1788887485832-result.json passed exact completeSourceErasure EXPLAIN without ANALYZE and six actual PostgreSQL CTE predicate cases: current and legacy lineage selected, malformed object/overflow claim ID/other owner/other source excluded. Read-only transaction, rollback and connection close acknowledged, zero writes/providers/session errors. This proves SQL parsing and predicate behavior, not a persisted end-to-end source deletion run.


## `design82-bounded-preview` (2026-09-08)

2026-09-08: Built f66d frontend-only preview started127.0.0.1:5183/studio.html, rootprocess33390. Actual desktop1280x720 signed-out screen displayed educator illustration, named email field and Google option; noauthsubmission. Inspected current release-generated390px Hindi Room conversation screenshot, including visibly dense header/disclosure area; this is a fixture, not live modelconversation. Impeccable detector returnedempty findings for actual creatorStudio/AuthGate.tsx androom/RoomApp.tsx. First guessedstudio/AuthGate path absent and wascorrected; no UI files edited. Current release layoutpassed249226ms; performancefailedHindiDOM1277ms/800, othergatesongoing. No world-class UX or fulljourneyclaim.


## `memory83-actual-azure-recall-forget` (2026-09-08)

2026-09-08: One actual run80 on frozen61a823c4fde9d8754b39cda8d0b127ca9f4f2114, rootexec48572terminal0. Receiptroom-memory80-4e72d11fd36521488fd3477a-result.json passed_actual_azure_room_memory_synthetic. Exact returnedgpt-4.1-mini-2025-04-14, HTTP200stop,298input/119outputtokens,310microUSDsettled. Three authored Hinglish preferences selected verbatim with valid user/preference enums, including complete rejection of fast English-only explanation. Actual atomic commit3facts/1episode/1sourceconsumed; actualrecall3exactquotes, revoke recall/historyempty, forget3facts/1episode. Independent10fixtureabsencecountsall0,primary/observercloseconfirmed,cleanupconfirmedspendpreserved. Budget149482spent/0reserved/1000000limitactive. 79+80combined595microUSD. Syntheticn1, not ownerhuman quality/PMF/competitor claim. 80claimconsumedneverreplay.


## `core83-reviewed-source-integration` (2026-09-08)

2026-09-08: Clean0e5392aea8da036d4e90c64b68fc82c0e774d45c in siblingVyakti-platform-source-erasure-schema164 integrates c1e3/d993erasure and61astrictschema atopf66d. Agentroom22/config7/erasure62/tsc/context/diffpassed. Noforeigncontextgraphsimported. Fullrelease continues onf66d, not thislatestsource; no image/deploy/push. Frozen61a proofcheckoutpreserved.


## `release-regressions165-five-focused` (2026-09-08)

2026-09-08, n=5 focused suites in new expert-release-regressions165: dialogue-unicode13 groups, feedback-dataset-client20, candidate-qualification-service13, feedback-dataset-ui12 groups at390/1440, and unchanged candidate-qualification-ui28 groups at390/1440 in English/Hindi. All terminal exit0. Synthetic browser/API/SQL fixtures only; no real SQL, email, auth or provider calls and no full-release run. The first feedback UI attempt failed before browser on missing katex in ROOT ancestor dependencies. An absent-path node_modules junction to the original sibling163 dependency tree fixed that environment; both package-lock hashes were 6cd79d2d783a6b56548ee323ef19ebdfa2f3c98f131557102ce81d9091ff40dc. No dependency install/deletion/move occurred. The original full-release qualification-UI Chromium launch crash remains historical evidence; one unchanged focused pass does not establish its cause or reliability.


## `release84-full-terminal` (2026-09-08)

2026-09-08: Frozenf66d fullrelease successor session10479 terminal1 after about30m20s, noforcedtermination.20/24checks passed. Failures performanceHindiDOM1277ms/800, evalsuite12, Roomleak333pass5fail, Roomdoors2193pass2fail. Layout249226ms, accessibility215827ms,security111421ms passed. RelationalDBgatesSKIPPED(noNEON), noSQL/provider. Log siblingquestion-selection163/scratchpad/release163-successor.stdout.log SHAbbfd318b3d27e7929b08ad8da6ae287a2bf7fc1d88d98cbb1afda2df59e387d2; fullgatefolder2026-09-08T17-00-17-500Z-35228. Source/configcleanunchanged. Targeted repairs afterward do not change this failed receipt.


## `memory84-caller-sql-parse` (2026-09-08)

2026-09-08: memory_flow70 actualreadonly receipt room-memory-caller80-readonly-1788888577614-result.json SHA11e0a5b7950e65e2117030e1bc75019421d6cff7f820608966d9842cdf5165cf pins4efd08da98cdc987e686f2f2e9bbd4e58b505384.6checks/11SQL, asserts11lease/spend columns thenEXPLAIN(noANALYZE)fourexactclaim/admit/release/cancelstatements. Readonlyrollback+closeack,zeroDDL/COMMIT/writes/providers/KV/errors. No CTE/runtime/concurrency behavior proved. Astraindependent18offlinecallercontrols passed; sourceflagfalse, runtimeenablementpending.


## `core85-auth-split-and-gpu-read` (2026-09-08)

2026-09-08, auth split745fcb43: one targeted studio-hi measurement, three page runs. DOM 1408.4/1695.7/1610.8 ms, median1610.8 versus800 budget; LCP2332/2568/2524 ms, median2524 versus2500; TBT115ms. Agent reports TSC/build/copy,49 personal session checks,10 link checks and8 mounted responsive auth cases passed. No owner sign-in. Config provenance source-erasure-schema164 allBlank=true. Independent two-read GPU billing attempt17:34UTC returned subscription Sponsored_2016-01-01 and CostManagement429, no cost rows. Receipt gpu-cost-read38-0f1a7db6-9056-41d5-a230-64b824cbd36d.jsonl SHA dfb354591f5925615bbff7e637bd9aa00a0d0c8464bd1cb09290908d9a29547a. GPU hold138600 unchanged. No new provider call; text spent149482 reserved0.


## `core86-grounding-and-room-fixtures` (2026-09-08)

2026-09-08: Read-only local reproduction n1 on544a with12 geometry facts and SN1 at13: baselineHasSn1=true, candidateHasSn1=false, candidateHasGeometry0=true, both knowledge count12. Candidate runtime test explicitly asserted static behavior. No SQL/model. Accepted Room fixture successor d2787827 after correcting duplicated revoke matcher and matching unconditional159 UPDATE trigger; schema FKs independently verified follower to subscription to payment event to receipt cascade. Agent focused locale54,Telegram64,doors2195,leak338 passed. Imported four eval paths only as clean09beb0c75a117f9596d1e6935915962dbd5addad in siblingcaller-lease165; syntax4/diff passed. No new full release.


## `core87-follower-and-lease-review` (2026-09-08)

2026-09-08: One actual rehearsal-follower browser run44598 on isolated fixture successor,49.684s,62pass2fail. Earlier memory-authority failure gone; remaining session-worked offer missing. Agent traced shared room-doors fake decoding guarded seven-parameter memory log as legacy five-parameter insert, corrupting synthetic role/agent fields; repair assigned. This is simulated service browser evidence, not live owner/cloud. Lease rollback v1 prepared45SQL but not executed: root found unknown-token release tests used wrong run IDs and ADMIT was never executed. Successor requested;0DB/provider calls for this packet.


## `core88-actual-lease-and-follower` (2026-09-08)

2026-09-08 root execution28721 terminal0: room-memory-caller80-rollback-1788890334453-result.json SHA1db37490e3deb7d59eaa9f550dcede91f5751daa7e53be205f44714f5aa915a0. Frozen4efd production lease SQL,51calls20rolledbackwrites17product executions11checks,0COMMIT/DDL/provider/KV. Exact run admission and uncertain/settled/released token outcomes verified, main rollback and fresh read-only absence, both connections closed, no errors. Agent changed-source rehearsal-follower80217 terminal0:22 guarded log fixture controls and64/64 journey assertions in49.402s. Earlier62/2 failure preserved. Browser uses simulated services, no owner auth/cloud. Source freeze pending review.


## `core89-copy-integration-and-canary-preparation` (2026-09-08)

2026-09-08: Latest clean integration475d31025c7dd4a5e02a679e3c06459bc5d70632 includes neutral Before sharing labels in EN/HI, removes unconditional preview availability claim, imports reviewed follower fixture repair and evidence. TSC, copy7scopes/21negativecontrols, syntax/diff passed. knowledge86 six offline builder/compiler/adapter controls passed; proposed two-call max6000microUSD uses existing ledger149482/0 and twelve distractors plus three expert chemistry claims. ActualSQL/provider/KV for86 remain0. Current two-session lease v1 also unexecuted; review found guard/journal/target-assertion defects and requested preserved-v1 corrected-v2.


## `core90-actual-competition-and-knowledge-parser-failure` (2026-09-08)

2026-09-08 root92010 terminal0: room-memory-caller80-two-session-9168e4d0-d836-48ac-9fe7-206d775b7845-result.json SHA70d4ae5915843a4f25b59a935068109fa8a8c605dc363037531cc058277a30e7. 51SQL,5leaseDML,one actual transactionid Lock with expected blocker/ungranted lock, loser refused, three syntheticCOMMITs acknowledged, fixture absent, both budget/spend digests unchanged,3connectionsclosed,0provider/KV/spend writes. Rootknowledge86 proof20084 terminal1: receiptknowledge86-proof-2a906cc4cd092f27b31e4cb3-result.json,83SQL,42601 on first history EXPLAIN,0COMMIT/provider/KV; primary rollback and close confirmed, independent observer not reached. Baseline approval/profile/core/session progressed. LastSQLSHA d84792999dab044f9814999e47a22ab2e70b246df8d5358624e912621143c818 maps exact EXPLAIN PRIVATE_SESSION_HISTORY_SQL. Proof claim consumed, never replay.


## `core91-parser-repair-and-integrated-source` (2026-09-08)

2026-09-08: Actual readonly successor knowledge86-readonly-v2-b63b44c153184ce32a298f9a-result.json SHA1828be353df750e01256847a60b50534e94e692ac459e25ecf878b47ce3ea237 independently verified prior fixture absence and unchanged149482/0 budget plus88spend fingerprint. Original history EXPLAIN42601 atposition25684 literalclosingbrace; one-character-fixed query accepted with identical synthetic parameters; rollback/closeconfirmed,0COMMIT/provider/KV. Fixfcc integrated as03f5c5aef56b2d641022ea9a6774e747c08be471 after reviewed billing and candidate-grounding source. Root then executed new release parser script against development:3/3 actual history/admission/completion EXPLAINs passed,0underlyingDML. Frozen knowledge87 uses03f5; new gate changes only scripts.


## `core92-real-knowledge87-two-replies` (2026-09-08)

2026-09-08 root run46895: knowledge87-445dce04650b48f79c790865-result.json on frozen03f5c5aef56b2d641022ea9a6774e747c08be471. Two synthetic Azure calls, baseline615 input/144 output and expert761/133, total995microUSD settled. Budget150477 spent/0reserved of1000000. Same reported model, fingerprints fp_8d7b600b57 and fp_51ebab882d; pair state failed/provider_pair_revision_mismatch. Actual approved claims, question-selected PersonModel context, dialogue storage and erasure ran. Both independent15-table fixture absence maps zero, both connections closed, no session errors. Expert answer states4H/2O and coefficient-only balancing but omits supplied three-box A/B/C convention. Baseline omits totals and incorrectly describes oxygen count as differing. Synthetic n1 each, no human rating or controlled quality win. Prior knowledge87 rollback proof ran204SQL/12EXPLAIN with0COMMIT/provider, rollback plus independent absence and unchanged budget confirmed. Fresh Azure metadata made2ARMGETs,0writes/model calls. Full release169 currently running on frozen72624e47fe95a75a3f8ac1b93b00b06c1712b69a; layout passed, remaining gates pending.


## `core93-prompt-trace-and-performance` (2026-09-08)

2026-09-09: azure_text_canary47 reconstructed actual expert core hash exactly:281-character method ranked first, system offset569, core2028/system2617characters. It was neither truncated nor missed. Voice pipeline diff f66d..72624 empty for audited paths,34 existing synthetic Hindi frontend controls passed; no acoustic measurement or source change. Full release169 current source72624 performance failed Hindi DOM1819ms/800 and LCP2688ms/2500, remaining evals running. Separate root HTTP DB-gate preflight failed ERR_ASSERTION before either gate: release169-db-gates-1788893084284-result.json, gates empty,0writes/provider. Explicit WS read-only successor assigned; do not claim DB gate success.


## `core94-release169-actual-db-pass` (2026-09-08)

2026-09-09: release169-db-gates-ws-1788893435202-result.json SHA4bd47f4056b77706d56087dc078cc58b65f35ee8abee5a49ca336fdaa074e009 binds frozen72624e47fe95a75a3f8ac1b93b00b06c1712b69a. relcheck exit0,37 checks incl multiparty, manifest165 owned tables and107 owner-lane; citation gate exit0 with4constraints/4GIN/4data checks,legacy0.47enumerated exact queries,62SQL calls across2READ ONLY transactions,0writes/COMMIT/DDL/provider/KV. Both rollbacks and WS close acknowledged, no session errors. Original HTTP failed receipt preserved. Runtime resource snapshot during evals:8logicalcores100% CPU,719020KB free of16509728KB; not a retrospective cause for earlier performance failure. Candidate stale browser PIDs20508/4880 had exited on later read, remaining top Chrome34800/28196 traced to user desktop, not stopped. Current release subtree actively progressing, no process killed.


## `core95-current-caller-source-evidence` (2026-09-08)

2026-09-09 source audit on72624: evals/consolidation/room-caller.mjs SHAbb491360ffbc8fa57471da668d5a0927f5be1681cb477f965100931c4d356626 imports real cron handler and metered wrapper with process-local source flag injection. Historical18 controls cover admission,reservation,begin,one strict-schema fake POST,settlement,commit and lease release plus uncertain paths. Not rerun by root here and not real service proof. Independent runner audit found shared2browser-slot budget across main/port lanes and reviewed browser-finally cleanup; no demonstrated unbounded process leak. Root did not stop any process. Full release169 remains active with previously recorded performance failure.


## `core96-release169-terminal-22-of-24` (2026-09-08)

2026-09-09: Frozen72624e47fe95a75a3f8ac1b93b00b06c1712b69a full release169 terminal1,22/24 gates passed,18:33:28.761Z to19:05:17.560Z (~31m49s), no interruption/retry. Full logSHA2759f48685a857876221b5f1bab949ba3b76361f2e2dd8b1515a641eba71fc9f at siblingrelease169-proof/scratchpad/release169-full.stdout.log. Performance failedHindiLCP2688/2500ms andDOM1819/800ms. Eval faileddialogue-unicode (actualsettle vs expecteduncertain after measured refusal) andincidents119pass1fail (remote-fetch inventory missingnewRoomwrapper). Layout249868ms,roomleak62001,export4254,doors10042,a11y142032,security20190passed. MainDBskipped; separate actual37-checkrelcheck/citations proof remains separate. FrozenHEAD/blankconfig/lock unchanged,clean; session70908closed,browserlane released then assigned to combined-entry candidate only.


## `core97-reviewed-focused-regressions` (2026-09-08)

2026-09-09: Unicode final910e focused13groups passed; incidents finalb365 focused129passed0failed. Root inspected exact final diff against72624 and admission-only successor. No provider/DB/browser calls. Root rejected earlierUnicode789 (removed equality checks) and b486 (hashed onlyreply rather than full validatedoutput parity), then accepted restored original first9groups. Incident241e initially checked exportedSQL name offset; b365 now checks actual awaitqueryFn admission call and negative removes onlythatcall. Integration/focusedcombined verification assigned, no new fullrelease yet.


## `core98-combined-auth-and-final-fixture-integration` (2026-09-08)

2026-09-09: Clean integrated20a84e3e83d018c236d026da305cb8406acd6e53 contains two finalevalfixtures pluscontext, APIunchanged; integratedUnicode13/incidents129/context/diffpassed. Isolatedcombinedauth1708109e780ddbd0980c1cff0f6308d18e79d6e5132 on72624: rawinitialworkspacechunk116501->10390bytes withStudioApp106760lazy; locale105482->4030; Hindi11721->6090. Build/tsc/copy/personal51/studio95/recovery10passed. One n3 under prospectively admitted moderate load failedLCP2920/2500,TBT333/300,DOM2018/800; CLS0.0842,JS72857,font84148,Hindileafwait1.7ms. Receipt siblingcombined-auth170/scratchpad/combined-auth-locale170/studio-hi-performance.json SHA9a8fba57e2f3df44081cf8ea1b48514ee805d7cdf36dd5d23b1bc4753903ef2d. No causal comparison to prior unmeasured host load. Scheduled86 v1 source pins checked0SQL/KV/provider, then root+independent review rejected2 deterministic execution blockers beforeenablement.


## `core99-actual-scheduled-memory-passed` (2026-09-08)

2026-09-09 root46881 terminal0: room-memory-scheduled86-v2-4b3d3c971ae75d89ec93021a-result.json SHA36c213dce855e5236e608c7c66513af7107626ff38d09d92e1f6d9e8cb00ef53. Frozen72624 exacthandler->discovery->claim->meteredwrapper->Azurev1->guardedcommit. OnePOST,298input/118outputtokens,2954microUSDreserved,308settled; budget150785spent/0reserved of1000000active. HTTP200,processed1,errored0,3facts/1sourceconsumed,6774ms handlerduration (not UI/voice latency). Three exactsource quotes recalled, withdrawal removedrecall/history, erasure and11independentfixture/leaseabsencecounts0; bothclosesconfirmed,no sessionerrors. ExactclaimrunId acknowledged,leaseknownabsent. Suppressed3heartbeat statements,2legacydiscoveries,1existingDDL; no schedulerdelivery/deploymentclaim. V2claimconsumedNEVERREPLAY. Current startupcandidate8109 remainsisolatedfailed; currentintegration20a84clean.


## `core100-disabled-packets-reviewed` (2026-09-08)

2026-09-09: Root read Performance172 V4 review and Quality88 adapter/runner diffs. Quality88 author reports17 offline groups,8 synthetic attempts,96793microUSD prospective reserve; no actual inference. Performance172 public pricing evidence supports2CPU*1200seconds*0.0001USD=0.24USD compute estimate. Neither packet dispatched. Root corrected obsolete graph-count placeholder in STATE; historical active prelude retained in context/archive/STATE-ACTIVE-PRELUDE-20260909-continuation99.md.


## `performance172-public-price-and-source-pins` (2026-09-08)

2026-09-09 unauthenticated HTTP200 centralindia Task vCPU Duration USD1Second tier6000 at0.0001, tier0 at0; SKU Basic/Standard/Premium. Conservative2*1200*0.0001=0.24USD compute proposal, reservation stillnull; overhead/grant not verified. Actual Microsoft image amd64 c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac/browser1234Chrome151.0.7922.34 pins. ExactGit context1115files29923789bytes,archive17185243; path/hash/archive/link checks passed. No model/browser/build/authenticatedcloudcalls.


## `core101-model-and-budget-inventory` (2026-09-08)

2026-09-09 local voice metadata audit: deployed Chatterbox outputs and historical300step ownerLoRA exist; IndicF5 published weights ba85abed/source13f7c4d and Qwen3-TTS1.7BBase fd4b2543/source022e286 exist, no verified custom-trained IndicF5 or ownerQwen artifact. Qwen adapter rejects Hindi/Hinglish. Retained r2 matched listening pack manifest/trials/plan hashes match and0answers; metadata only so far. Root actual text75-budget-readonly-1788897334180.json confirms150785spent/0reserved/1000000active, readonlyrollback/close,0writes/provider.

## Retained voice listening session (2026-09-09)
Existing CLI verify ran on original r2 and separate session copy: each passed18/18 core checks plus local route isolation;6 stimuli,2 exact-text cells, common24kHz mono16bit/288000samples. Original metadata hashes match prior commitments, original answers0. Existing CLI listener launched at127.0.0.1:5193, session7227; separate output home scratchpad/voice-owner-listening-20260909/voice-matched-pack-20260828-r2. No human ratings, audio playback, provider/GPU call, upload or grant mutation by agent. File integrity reads are not quality evidence.



## `core102-cpu-executor-reviewed` (2026-09-08)

Root read exact200line executor and runnable review; independent reviewer found no concrete blocker. Author reported five synthetic adapter controls passed. Admission file created locally; upload/build/performance not yet run at this entry. Existing Windows failed measurements preserved.


## `core103-ready-listener-and-cpu-run` (2026-09-08)

2026-09-09 private loopback listener http://127.0.0.1:5193 on session7227. Originalr2 and separate sessioncopy both18/18integrity+routeisolation passed; sixsourceclips/twoHindi-Englishcells/fourhiddenmodelstacks, no independentHinglishcell and0ownerratings. No synthesis/upload/grantmutation. CPU172 actually uploaded/scheduled once as ACRcu3g, intentdurable; all500000microUSDhold retained, source20a84. No performance result yet. Quality88 author18offlinegroups passed; actualcomparison notrun at admission.


## `cu3g-linux-performance-one-budget-failed` (2026-09-08)

2026-09-09 actualcu3g terminalFailed, exact20a84source nine targets*n3. OnlyHindiDOM813.7/800ms failed; samples771.4,813.7,831.2. HindiLCP2172/TBT144/CLS0.09504/JS147047 passed; install/static passed. Node24.18.1 Chrome151.0.7922.34 Linuxx64 twoCPUXeon8573C loopbackonly. Gate86853ms exit1; notwholecloudbillingduration. Artifact3df3d8476def1c97bcc02eb1b7631c83f0fa34c1a9b5c41f7f8794180db19bc0.


## `core104-two-real-quality88-replies` (2026-09-08)

Root session2282 terminal1. quality88-0254a122c5b94f4ba45eebe4-result.json: mini1518input/174output/886microUSD, Terra1517/204/5482, total6368settled; actualfinalledger157153spent/0reserved/1000000active. Mini delivered through gates; Terra rawreply stopped at optionalfingerprint check beforedelivery. Both reject coefficient/subscript substitution. Terra explicitlyacknowledges equalatomtotals/differentchemicalspecies; mini leavesN2O4sideimplicit. Neitherexplicitlystates oneN2O4molecule; bothmissstrictfullrubric. Syntheticn1each, noqualitywinner orownerlikeness claim. Latestcleanintegration6ad4eaf includesprompttaxonomy anddirectcorrectionentry,23+12focusedchecks/tsc/copy/context passed.


## `core105-fresh-budget-and-reviewed-successor` (2026-09-08)

Root text75-budget-readonly-1788898321657.json actual157153spent/0reserved/1000000active, readonlyrollbackandcloseconfirmed,0writes/provider. Quality89author19offlinegroupspassed, independentreviewverifiedalladmission/manifestpins and exactremainingcorpus. No actualremainingcalls at this entry. PublicAPIprimarydocs independentlyread byroot supportoptional fingerprint. Private listening remains available with0ratedanswers.


## `core106-eight-real-responses-and-blind-review` (2026-09-08)

Quality89 sixactualPOSTs,18398microUSDsettled; final175551spent/0reserved. ReceiptSHAe6450d0fb1951346e86ea9726f2a282c5fc69774ddc0e919839919086cb6d6c5. Across88+89 eightcalls cost24766microUSD: mini4134/Terra20632. Mini3of4complete, Terra4of4complete; delivered3of4each becauseTerrafirstoptionalmetadatarefusal versusminilastlength400truncation. Fullsystemwire8of8 reconstructed; blindedAstra106 reviewedpacket8bf09c924add796dc10f2f3d68cfb5ce981a52bbb528f1936826b8ea62557dad withoutlabels andpreferredmappedTerra in4cases, withn1/celllimitations/Hindidefectretained. Currentproduct175df70 includesfocusedcorrectionmode12+36controls/tsc/copy passed; nofullreleaseyet.


## `core107-room-readiness-real-sql` (2026-09-08)

Root read actual room-memory170-readiness-1788899627621-result.json: exact af5d258, development DB identity/read-only/search_path verified; schema_ready and budget_ready true, readiness/start/finish/prune EXPLAINs4 accepted,12SQL/0writes/0provider/0KV, rollback and close acknowledged. This measures database parsing/readiness, not a persisted heartbeat or complete writer execution.


## `core108-current-caller-and-local-health` (2026-09-08)

Read-only agent trace found eight-response Quality88/89 uses src/engine/expertTextCompiler.ts; actual Meet uses api/_replica-dialogue.js then candidateRuntimeCore and compileDialoguePrompt. This limits benchmark transfer. Root HTTP GET on local174 studio5177 and private listener5193 both returned200; studio-root exists. No sign-in, inference, synthesis or owner rating. Startup178 clean4acb4180 has author-reported auth51/browser8/recovery/build/tsc passes; no measured performance result.


## `core109-integrated-source-and-document-gap` (2026-09-08)

Product175 clean9da851c9 integrates reviewed Room/heartbeat/env/Terra source and safe inline rendering. Author combined TypeScript/copy/env/Room/reply/heartbeat plus inline/math checks passed, with original blank-config import failures retained. Source audit directly reproduced canonical own-writing SN1 text becoming text_span excluded by ELIGIBLE_TRANSCRIPTS_SQL; context evidence37 and claim extraction43 pass separately but do not cross this seam. No actual SQL/provider proof for document repair yet.


## `core110-cpu178-source-preflight` (2026-09-08)

Root read executor diff and independently verified actual performancegate003f4fd9. Reviewer verified all1119 archive entries against source/disk/manifest, exact archivee144351e and unchanged Dockerfile/measurement metrics/n9targets*3. Root prepare returned disabled_prepared,0uploads/0schedules, separateallocation recorded. No performance result at admission.


## `cu3h-startup178-linux-performance-passed` (2026-09-08)

2026-09-09 actualcu3h Succeeded, source4acb4180d10fbb04ad93efb79ae27f4e38eb70a3, nine targets*n3 unchangedbudgets/throttle. HindiDOM681.1ms/800(samples705,487.4,681.1),LCP1876,TBT75,CLS0.09504,JS73337; allfindings/install/staticempty. Gate85.050s. Node24.18.1Chrome151.0.7922.34Linuxx64twoCPU8370C,loopbackverified. Artifact1fcf4a915846115f5b383196ff8a7f4a20e5e0825945aabd43ee2698654ff536.


## `core111-fresh-ledger-and-startup-pass` (2026-09-08)

Actual read-only text75-budget-readonly-1788900951851.json SHA c21a2f1d confirms175551spent/0reserved/1000000active with rollback/close,0writes/provider. CPU178cu3h terminalSucceeded, complete exact4acb gatepassed nine targets*n3; HindiDOM681.1/800,LCP1876,TBT75,JS73337. Receipt1fcf4a915846115f5b383196ff8a7f4a20e5e0825945aabd43ee2698654ff536. Both500000CPUholds remain, GPUhold unchanged.


## `core112-actual-roomonly-with-heartbeat` (2026-09-08)

Root session88054 exit0: room-memory-roomonly170-v2-c4736f4ca4828f649edade5d-result.json SHA2e23122bd3e1f0b31cc1b565ead13e81135bfef23b25a844d98c5431dd05154e. Exactly1AzurePOST402input/119output,352microUSDsettled; actualfinal175903spent/0reserved. Three exactquotes classifiedpreference and recalled, negationretained; withdrawal/forget/11absencecounts0, primaryandobservercloseconfirmed, persistedheartbeatok processed1/errored0. Actualretentionprune executed; affectedcountnotreported. Syntheticn1, notcron delivery or general memoryquality.


## `core113-reviewed-meet-runtime-evidence` (2026-09-08)

Reviewer verified426 pins, source7501218 and seven reported offline groups including two-request stale-response negative. Root confirmed no source diff from prior actual knowledge87 on person-model/dialogue/runtime/budget/provider/registry SQL-bearing files. Knowledge87 cleanup and bothcloses were confirmed despite comparisonfailure. Existing ARM metadata6fa6abc2 records mini2025-04-14; actualreturnedidentity will be checked after settlement. No Meet182 calls at admission.


## `core114-meet-three-actual-replies-and-unicode-sql` (2026-09-08)

Root session85120 completed3 ordinary Meet calls on7501218, receipt meet182-497659f55f02112f6006b2df-result.json SHAece36d495dc23e31841a3e0f46d650b387cbae7918fa089ede6477993eb8c013.1809microUSD total, final177712spent/0reserved, cleanup and bothclosesconfirmed. Language followed all3requests, but root found Roman overbroad diagnosis of correct oxygen count, English omitted corrected totals, Hindi omitted explicit simple/small-angle model assumptions; independent review pending. Root separately executed frozen386d UTF16 helper:20semanticcases passed in actual PostgreSQL,27readonlySQL includingEXPLAIN/identity/rollback,0writes/provider,closeconfirmed; receipt63eb648cd2b8980c971be96f2ceaa891926a31eced9b758035f4a9839370dd9b.


## `product175-teach-scoped-pass` (2026-09-08)

2026-09-09 local n=1 sixcommandbatch21:32:18–21:33:03UTC: tscbuild,newTeach,callbacks,copy passed; minedCTA globaloccurrenceassert failed3vs2. Boundedtest-onlyscope repair rerunpassed15ReactCTAbranchgroups including exactoldnegative. Receipt product175-integrated-1788903138660/result.json preserved. Product4files exactb081, no browser/SQL/provider/fullrelease.


## `room186-structural-checks` (2026-09-08)

2026-09-09: actual source/generated compiler 21 checks, Room runtime 21 checks, private rehearsal 17 groups, TypeScript build, engine freshness, environment manifest freshness and copy checks passed. These are offline structural and caller checks, not model adherence or deployed quality.


## `product175-room186-eight-pass` (2026-09-08)

2026-09-09 local n=1 eightcommands21:43:00–21:43:41UTC allpassed enginebuild,tsc-b,compiler21,Room21,private17,copy,bundlefreshness,envfreshness. Receipt product175-integrated-1788903780357/result.json. No configflag/provider/SQL/browser/fullrelease/deploy. Teach/Meetv2/reply/inline preserved.


## `core115-composed-claims-sql-pass` (2026-09-08)

2026-09-09 root actual readonly v5 on87cd4ffe: six EXPLAINs including discovery/open/persist/preview/acceptance and actual private runtime serving passed,13SQL/0writes/provider, exact development DB identity/search_path and rollback/close acknowledged. Receipt context-claims179-readonly-v5-1788903929189-result.json. Missing-field semantics and clear/accept concurrency remain unproved. Fresh actual ledger177712/0 confirmed separately in text75-budget-readonly-1788903889469.json.


## `core116-meet-terra-admission-evidence` (2026-09-08)

2026-09-09: independent review verified428 pins; same three182 prompt/core hashes, isolated dialogue2/12 rates. Root verified selected SQL-bearing source unchanged except captured budget_env pass. Actual fresh read-only budget177712/0 acknowledged rollback/close. Session98533 dispatched reviewed launcher; no terminal result at this entry.

## Voice158 SQL proof186 packet (2026-09-09)
Offline preparation only:7source+4helper pins,21parameter-count-checked composedqueries,8exact158DDLstatements, syntaxpassed. PacketSHA5897b7c2ff1d95e3460cf7c766505eb2e552c700193b43fe5b94b86bbb7f6bf2.0credentialreads/DBconnections/provider/GPU. Runtimeoneuseclaim/max70SQL/240ssoft/260shard/2slocktimeout/ROLLBACKrequired. No SQLparser or concurrency result yet.



## `core117-actual-meet-terra-three-replies` (2026-09-08)

2026-09-09 root session98533 exit0. Receipt meet184-94a0c4f82e08d0079e811a8d-result.json SHA4e07ea6382dcfa51cf0f064b35275c30f6b1f8757b24b487334d27799b163a77. Three real Azure replies, costs4262/3534/3504microUSD, total11300; final189012spent/0reserved/1000000active. All45synthetic absence counts0 and bothclosesconfirmed. Root saw added pendulum assumptions, correct isolated sulfur diagnosis and explicit English totals. Blind quality review pending, n1 percase not generalranking. Consumed184 claim neverreplay.


## `product175-terra-nine-pass` (2026-09-08)

2026-09-09 local n=1 ninecommands21:57:50–21:58:36UTC allpassed manifestregeneration,adapter74,owned47,candidate19,publication33,rehearsal21,tsc-b,copy,envfreshness. Receipt product175-integrated-1788904670705/result.json. No newtestsuitefile orregistrations;410unique retained. NoSQL/provider/browser/fullrelease/deploy.


## Voice158 parser186v2 offline preparation (2026-09-09)

Node syntax passed; n=8 exact SQL/parameter allowlist negative controls passed; n=1 invalid packet-hash invocation refused before dynamic imports/claims. Prepared21 queries and8 DDL statements against frozen voice185 c85d1ed0e08dbebf59e162a2f0cd39972909682c. No credentials read, DB connections, provider calls, or actual SQL parser proof. Artifacts scratchpad/expert-tools/voice158-proof186-v2.mjs and VOICE158-PROOF186-V2-REVIEW.json. Independent review pending.


## `core118-claim-authority-negatives-actual` (2026-09-08)

2026-09-09 session22250 actual dev DB: two fixtures current, all four metadata omissions refused acceptance and invalidated current profile. Clear-first observed exact waiting transaction/blocking PID, then generic assertion failure before full recorded outcome. Receipt context-claims179-clear-accept-race-v3-1788904776376-result.json. All26absencecounts0, all4connection closes acknowledged,0provider. Concurrent pass not claimed.


## Voice158 parser186v3 offline controls (2026-09-09)

Syntax plus n=8 exact-allowlist negatives and n=1 production hostname-assertion foreign-Neon negative passed. One protected configuration hostname commitment derived in memory; no credential printed. DB connections0, SQL0, provider calls0. Independent review requested.


## `core119-actual-claims-races-and-voice-parser` (2026-09-08)

2026-09-09 actual claims v4 a8e33d8dd7b7f8124f7c13961c619e23213ca11cf341c2f6fecc6d5de317afdf: both exact blocking PIDs observed; clear-first accepted0, accept-first clearremoved1; both status superseded/evidence0/citations0/currentprofilefalse;26absencecounts0/fourclosesack. Actual voice186v3 session46473:21EXPLAINs plus8transactionalDDL,49SQL/noCOMMIT, independent catalogrestoredtrue,bothrollback/closesack. Receipt voice158-proof186-v3-1788905234288-result.json. Public158 remains unapplied; runtime races unproved.


## Voice race187 preparation (2026-09-09)

Existing root-executed186v3 receipt aa3ae886d40d3ca5bdde290146ba8bbebc53a2d9466f6d493982cd9438a2cde9:21 EXPLAINs/8 DDL/49 SQL, catalog restored and both rollback/close acknowledged. Race187 source syntax and exact-packet check passed; five cases prepared, four prospective lock witnesses,0 new DB connections. Independent review pending; no concurrency outcome measured.


## `core120-actual-voice-allocation-races` (2026-09-08)

2026-09-09 local root executed packetf080c171940aff6031230ee01247febfce6556edb8a7b25b889fd8f749448cb3 once. Receiptvoice158-race187-1788906346553-result.json:243SQL,fivecase summaries,four real concurrent lock witnesses,allfive connections closed,disposable namespace absent,public before/after hash identical. Zero provider/Azure calls,no public158 migration,no real hold mutation. This proves limited resource SQL concurrency,not audible likeness or deployed activation.


## `voice187-actual-disposable-allocation-races` (2026-09-08)

2026-09-09 local: root executed voice158-race187 once. Independently inspected receipt voice158-race187-1788906346553-result.json SHA256 7a6a6c7b56aa1707e3df1e2ecc4636e36cda6ac6f7850930582e2d2b33b06ba2:243SQL,5case summaries,4actual overlapping-backend lock witnesses,11acknowledged commits,5closed sessions,errors0,provider0. Exact disposable namespace absent; public budget/window/catalog hash unchanged. Successful cases retain old180000 uncertain liability and fixture held498600; pending-stop retains318600. All amounts are synthetic. Public158 unapplied and real GPU138600 hold unchanged. No rerun.


## `core121-ui-source-checks-only` (2026-09-08)

2026-09-09 local author-reported auth17652 source controls passed, Share1874 source/readiness controls plus copy passed, clean isolated commits. Browser/tsc/build/performance not run for successors. Retention postrelease1033810b preserves disabled4 passes and owned-child2s admission failure under concurrent full release; no shutdown conclusion. Main6201 unchanged.


## `core122-full-release-and-share-sql` (2026-09-08)

2026-09-09 local unchanged fullrelease6201 ran22:15:18–22:43:34UTC,20/24pass. Failedperformance1472.3ms Hindi/800,evalsuite7failures(verification-knowledge,creator-cascade-order,first-use-activity-abort-ui,studio-entry-css,room-leak,quickvoicecapture,sound),roomleak337/338,securityheaders high @xmldom/xmldom. ThreeDBgates skipped,no liveprovider. Actual Share0fde readonlyEXPLAIN passed8SQL/0writes/rollback+closeack,receipttext-publication-candidate-readonly-v1-1788907299467-result.json. This is parserproof,not candidatefixture/browserproof.


## `core123-targeted-repair-evidence` (2026-09-08)

2026-09-09 author receipts: Roomleakff27e504341/341,336323retrieval+586boundary; sound058e540c focusedpass with production70ms unchanged; CSS8/quickvoice29; verification source4negativecontrols. Xmldomdad6 exactone lockentry0.9.10→0.9.12, freshnpm audit0high/critical3moderate, installedruntimepending. Auth176performance PID34592 started then disappeared, but stdout/exitstatus NOT retained; no metric/passclaim. TSC likewise lacks terminalexitreceipt, Vite printed built7.14s. Root confirmed no matching process/8932listener. Integration33 now owns isolated freshinstall lane.


## `core124-own-install-and-captured-build` (2026-09-08)

2026-09-09 local installreceipt postrelease188-install-1788907886173/result.json terminal0:private npmci updatedlock, installedxmldom0.9.12,plistUnicode/array/bool/introundtrip,audit0high/critical3moderate. Rootfocusedbatch50990 logfolderpostrelease188-focused-1788908027902:tsc26s exit0,build5.35s exit0; performancerunningfrom22:54:19UTC,no resultyet. Eightplannedsteps,noDB/providercredentials.


## `core125-focused-combined-seven-pass` (2026-09-08)

2026-09-09 root50990 terminal1,ab50source3076filesunchanged; receiptpostrelease188-focused-1788908027902/result.json. tsc/build,verificationknowledge,creatorcascade,activityabort,candidaterecovery,retentionloop all exit0. PerformancefailedHindi1552/800andLCP2524/2500; source061startupguessdidnotshowimprovement. Root assignsone scopeddiagnosticprofile unchangedab50. FreshAzuremini metadata+ledgerreceipt ed776bc2c191814ece6e8511971fc916ae6b7d0523bb1043780e7e934c22c2de confirmsmini2025-04-14,Succeeded,189012/0/1000000active,rollback/close,0inference/writes.


## `voice188-current-owner-runtime-pricing` (2026-09-08)

2026-09-09: readonly DB receipts show3production/0dev replicas for same verified owner; all3 inference/biometric/training revoked, age/identity/liveness false. Only2sameowner sources, readyoriginal28.075s SHAde67a2e0a96e3aee2584247068db2bdda574ac1659e903d1bd3e128bd57bc53b. Alltransaction rollback/close ACK; no sourcebytes fetched. ARM GET8voice-related apps: general625edc min0max2activezero, isolatedhi9dc374 min0max1allinactive, protectionCPU2/4Gi max3. Fresh16ContainerAppretailmeters confirm462microUSD/replica-second; registry/vault/blob/bandwidth prices fetched withouttruncation. Receipt hashes in VOICE-OWNER-PAIR188-ACTUAL-BINDINGS.json. No DB/cloudwrites,inference.


## `core126-claims-sql-v3-failure` (2026-09-08)

2026-09-09 local: root session52986 terminal1; context-claims187-sql-v3-1788909522138-result.json records49primary SQL,29mutations,0commits/provider/KV, failure private_runtime_load with learner_memory_sql_forbidden BEFORE next SQL dispatch. Independent observer8SQL confirms12fixtureabsencecounts0, rollback and both connections closed. Composed proof and complete cleanup path remain false. v3 consumed, never replay. Diagnose exact composed query before successor.


## `core127-hindi-wrap-rejected` (2026-09-08)

2026-09-09 local: root81119 terminal1 on clean hindi-wrap190610123; build exit0, three-sample unchanged Hindi performance gate failed. Median Hindi DOM1923.7ms/800, LCP2904ms/2500,TBT281ms; receipt hindi190-focused-1788909880740/result.json confirms source unchanged. Subsequent ab50 CDP trace by173 recorded671.127ms root layout and body :has(.auth-page) selection-rule subtree invalidation on MAIN insertion. Remote font updates followed layout and took0.02-1.9ms. Trace is diagnostic, not acceptance.


## `core128-actual-claims-sql-cross-seam` (2026-09-08)

2026-09-09 root session12326 terminal0 on85fb: receipt context-claims187-sql-v4-1788910245637-result.json SHA57e11ee2efe337cba88ff5842410f6739a6d156797006f59e40cb725478e958b.59primarySQL/8observer/36mutations/0repair/0COMMIT/provider/KV. Actual Context Locker, deterministic extractor service, owner preview/accept, profile build/approve, private runtime load and compiled question core contained knowledge. Actual erasure path passed; rollback acknowledged,12independent absencecounts0,bothclosesack. Synthetic extractor and runtime identity/qualification fixtures mean this is not Azure extraction or authenticated owner proof.


## `core129-dependency-incident-observed` (2026-09-08)

2026-09-09 root npmci through marker191 junction failed EPERM on loaded rolldown binary. Resolved chain caller165 -> schema164 -> ROOT/scratchpad/expert-release60-candidate/node_modules. Agent33 verified caller and resolvedtarget package/lock bytes identical, before snapshot1207residualfiles and262missingpackage manifests; staging npmci terminal0 at23:39:08UTC, repair still running. Both local URLs returnedHTTP200 after incident. This is shell liveness only, not full runtime integrity. Producttrackedsource and database untouched.


## `core130-marker-and-dependency-results` (2026-09-08)

2026-09-09 root marker191 session96185 terminal1 atbc4ca888: typecheck andbuild passed, Hindi median1562.5/800ms,LCP2496,TBT194,sourceunchanged. Receipt marker191-focused-1788910939552/result.json. No demonstrated improvement over ab50Hindi1552. Shared dependency repair33 terminal0:5287files restored,1207identicalpreserved,6494stagedfilesverified,0mismatches,lockednativebinary preserved; receipt caller165-repair-1788910723016/result.json SHAff5b376e22bf7ee5565bf6f742c8f3b41747aa99e3c1e04b77d8be8f652603a5. Original package/lock provenance and listenerPIDs unchanged.

## `core131-dev193-local-preview-check` (2026-09-09)

`node scratchpad/expert-tools/dev193-local-launch.mjs --check` completed once. Result: source `C:/Users/raghav.s/Desktop/build/Vyakti-platform-combined-linux193`, HEAD `77f9066d407e1fb631af63289eee1778db8190a0`, port5178, `credentialCalls:0`, `serverStarted:false`, `runScopePrepared:true`. No smoke, server, build, browser, SQL, provider or cloud operation was run.


## `core132-focused194-and-preview193` (2026-09-09)

2026-09-09: root88791 terminal0, combined194-voice-focused-1788912491357/result.json:9/9 steps passed including typecheck, admission, allocation, authority, resource, close, supervisor, voicepanel and open-voice;3098tracked files unchanged,0provider calls, inert database configuration. Separate combined193-focused-1788911734364 passed5/5 including18 mounted desktop/mobile first-use cases with synthetic HTTP/provider responses. Actual193 localhost5178 listener root3008 child20800 is running; browser English/Hindi signed-out screens inspected and language restoredEnglish. No email/OTP or authenticated owner journey was performed. Earlier131 was check-only preparation, superseded by separately reviewed actual launch.


## `combined194-broker-sql-parity` (2026-09-09)

2026-09-09: actual combined1949ab683b existing broker Python suite passed11tests/0failures/0errors in1.785s using retained isolated.venv-voice179 and inherited credential clearing plus loopback-only socket/DNS guard.11loopback connections were asyncio plumbing;0external/cloud/owner reads. Durable exact command/stdout/stderr receipt combined194-broker-1788912800320658600-result.json. Runtime-generated21SQLstrings exactly equal reviewed186v3;8migration statements exact;187reserve/release exact. Eight relevant files LF-normalized equal185,7raw equal; CRLF-only difference api/_voice/allocation-boundary.js. Parityreceipt combined194-voice-sql-parity-1788912854998.json.0SQLcalls, no repeat of root9passedchecks.


## `core133-actual-azure-extraction-failed` (2026-09-09)

2026-09-09 00:14:35-00:15:01UTC:191 on737a made1Azure extractionPOST,0dialoguePOST. Actual receipt context-claims191-ec0282132e098d0f6566d47b-result.json under claims-azure-v1-body192 SHA19be2b73b623dd6ff3ef8889c88bfa0c24aed8c51782f50be3e707a7c5f91426. Failed topical_sn1_rate_law_claim_required before proposed output details were persisted. Reserved6827microusd, settled1016; ledger189012->190028, reserved0. Fixture commit/cleanup commit, observer proof and both closes acknowledged;12fixture absence counts0. Transport and accounting executed; no completed Azure-grounded knowledge-to-answer proof.


## `fullrelease194-cu3j-scheduled` (2026-09-09)

n=1 actual authorized ACR scheduling through fixed registry Azure API at1788913041.5711718 returned cu3j; durable intent SHA7c3e310f151182f9ec577e46060bfa1d327d155a7cedca41013d36d37c8b6b54. First read-only poll1788913072.0338051 reports Running. Offline restored real HEAD/index clean with3098 exact file hashes,22 historical show bytes and10 negative missing shows. Packet-only local excludes additionally verified default git status empty. This is not a release pass; no billing settlement or quality claim.

## `core132-combined194-azure-readiness-audit` (2026-09-09)

Read-only audit n=1: combined194 worktree is clean on `codex/combined-linux194` at `9ab683b8831b362d6c73a3b92e40df0a3bb36880`; source commitment computed from the exact checkout is `sha256:46c43256baccc20800c5dcf169c4c9de75665b10910bbc9f5a5a17ba0a6521f3`. Full-release run `cu3j` remains `Running`. Existing published image is older `de84da...`/`sha256:58798e...`; no build, push, cloud call, secret read or health request was made.


## `voice158-readiness195-actual-catalog` (2026-09-09)

2026-09-09 n=1 actual READ ONLY session finished00:23:09.933Z,15SQL,0DDL/COMMIT/provider/cloud/grant actions. Receipt voice158-readiness195-1788913384809-result.json SHAe5b95a7e09f892fffc85f7ac49d52008a08a28e32e2c2af36a97b283b8c85206. Exactdev identity/RO,three parents/UUID owner unique keys,old valid exclusion/no dependents,fournewtables/twonewcolumns/newindex absent. One in_flight allocation138600 held,duplicateheldresources0. ROLLBACK/closeacknowledged,errors0. Source1949ab683b has exact8 reviewed186 statements/schema mirror andrelcheck reach. No freshDDL/application/owner voiceclaim.

## `core133-combined194-offline-packet` (2026-09-09)

Prepared secret-free final194 ACR build metadata from the existing web65 transport: source HEAD `9ab683b8831b362d6c73a3b92e40df0a3bb36880`, commitment `sha256:46c43256baccc20800c5dcf169c4c9de75665b10910bbc9f5a5a17ba0a6521f3`, 1,142 archive files, archive SHA `5f3071c6772afe10a7bb27240b0934c5d52896fc38f2eef1dd98773a9b408deb`, schedules disabled and release-gate-pending. The immutable deployment bridge keeps the future image digest unresolved, requires Bicep recompilation, and preserves old cu3f digest rollback. No cloud call or secret read.

## `core134-combined194-bicep-offline-compile` (2026-09-09)

The existing local compiler `C:/Users/raghav.s/.azure/bin/bicep.exe` compiled the reviewed web Bicep offline with no Azure calls. Source SHA256 is `54f8b498104dea13324532c69eafdaf334ab0ab6424680883962d2c4b99be6fe`; output `scratchpad/expert-tools/azure-web194-infra-compiled.json` SHA256 is `ff43e07163b09db9637fdd326a951430d308fd603c9e7b009157b15370da73c8`, matching the existing reviewed helper output. The final194 bridge now pins this output, while image and release acceptance remain unresolved.


## `voice158-apply196-actual-commit` (2026-09-09)

2026-09-09 actual one transaction00:31:17.265Z to00:31:30.600Z on ONLY vyakti_expert_integration_20260906, source9ab683b8831b362d6c73a3b92e40df0a3bb36880.49SQL,8DDL acknowledged,oneCOMMIT attempt/ack; exact under-lock preconditions and precommit catalog passed. Independent fresh read-only session validated4newtables39columns24constraints,newGPUCHECK,old28columns plus2nullable columns,newvalidpartialuniqueindex/oldindexabsent,empty158tables and nullresource-receipts. Onein_flight row138600held and old-column projectionMD5cd8e366f89744cb169dc31c0d61223d6 unchanged. Bothclosesack,observerROLLBACKack,errors0,exit0. Receipt voice158-apply196-1788913877204-result.json SHAbdb9db6e33d2e44f6498a8aada958b8679d68117eb9243b78738b65aa72c715a; executorSHA2dc522d0f45baf1a2ce9bcfeb7256973d5c54ba9ba78cfbfaf10cd142dd6dd51.0row/grant/provider/cloud writes/calls.


## `core135-actual195-extraction-localized` (2026-09-09)

2026-09-09: diagnostic195 run87dbb9daaa1f90ed553986e1 on737a made1AzurePOST,0dialogue. Receipt body192/context-claims195-87dbb9daaa1f90ed553986e1-result.json SHA4e384c35fe09116f64a0a3f04f4c7bc966a0962524b9dcd2e782e9a8ba4767c4. Adapter-reported426input/527outputtokens,1014microusdsettled; ledger190028->191042,0reserved.4validatedproposals/persistedclaims/ownerpreviews: name,privacy,English,shortanswers.1invalid_claim_shape rejection,0SN1topicclaims. Failed unchangedtopicalassert. All12fixtureabsencecounts0,cleanup+observer+closesack. Postvalidatedoutput retained, rawrejectedproposal unavailable. Consumed195 mustnotreplay.


## `core136-full194-release23of24` (2026-09-09)

2026-09-09 actualAzurecu3j final1949ab683: unchangedfullrelease exit1,1071487ms,Node24/Linux2CPU,23of24gatespassed. Performance/layout/accessibility/security passed. Eval suite lists17failedsuites. All48outergate files captured in fullrelease193-logs-1788914226435555700.gate.json SHA5a9a9bd384a10bbd61fd74271c4e03bc05b44288cd7e474d7ac3eb34b053944c. Confirmed azureweb getter-onlyIncomingMessage.signal assignment error, first-use-refresh-ui boundedHTTPbarrier failure and missing c56cadfe:api/_replica-build-intent.js historicalGitcontent.14failure details absent fromactualnested stdout; no completecauseclassification yet. RelationalDBgates skippedincredentialfreepacket. No invoice settlement/deploy.


## `core137-linux-performance-and-focused-repairs` (2026-09-09)

cu3jexact194LinuxNode24.18.1/Chromium151/2CPU/390x844/4xCPU150msnetwork,n3per9targets, allperformancebudgets passed. Hindi studioLCP1648ms,firstHindiPaint430.2ms,TBT14ms,CLS0.0950403. firstHindiPaint is DOM-observed Hindi readiness, NOT interactionlatency; rootcorrectedearliercommentary. SummaryCU3J-PERFORMANCE194-SUMMARY.json. LocalNode24.13nativegetterfixture29azurewebgroups passed60c03195; notactual24.18execution.5a487c34pipechecks passedexplicitasyncstreamloss/fixeddelivery, nativeWindows4MiB didnotreproduceloss. Claimsf3e54offlinechecks passed; noactualqualityresult.


## `cu3j-fullrelease194-terminal` (2026-09-09)

2026-09-09 n=1 actual Azure CPU run cu3j on9ab683b8831b362d6c73a3b92e40df0a3bb36880. Terminal Failed; fullrunner exit1 after1071487ms. All48outer gate logs captured; artifactSHA5a9a9bd384a10bbd61fd74271c4e03bc05b44288cd7e474d7ac3eb34b053944c. Only eval suite gate failed, listing17 suites. Nested stdout stopped early, so14detailed failures were not preserved by evals/run itself. Node24.18.1, Chromium151.0.7922.34 Linux2CPU Xeon8370C. DB gates explicitly skipped. No retry. EntireUSD1 accounting hold remains; earlier twoCPUholds untouched.


## `cu3j-fullrelease194-performance` (2026-09-09)

2026-09-09 actual unchanged performance gate within cu3j: n=3 per9targets,390x844,4xCPU,150ms network. LCPmediansms1000/356/1100/1276/1708/1648/280/268/272 in registryorder. HindiDOM430.2ms,TBT14ms,CLS0.09504028,JS73444B,font84148B,chunkwait1.9ms. All budgets,install,static checks passed. FullsummarySHAa0217a481b27d6fbf62b5816e40685bfbc88cd0ee331a769e25052c8901f9cf0. Does not prove fullrelease,SQL,voicequality ordeployment.


## `core138-focused-fixes-and-union` (2026-09-09)

2026-09-09 combined19817changedpaths(13code/test+4context),414suites,clean79c9d9a1; manifestCOMBINED198-FREEZE.json SHA f8394de0fdcbeb4629e183d9a6e24730c5df46455b016dec3e123d5b71995527. Individualfocusedchecks: Azureweb29,claims54,creatorvoice109,azure-only20,incidents131,portablecopy9; first-use-refresh12names/24outcomes390+1440 actualWindowspass afteroptionalGET-count barrier removed withouttimeoutincrease.33originalGitshowsverified forsuccessorhistory. No combinedruntime/fullgate rerun yet. Frozenf3 actualofflinecallerproof62a598 confirms1040reservation==wire units and10SQLbyteequal; noactualSQLcall.


## `core139-actual196-knowledge-success` (2026-09-09)

2026-09-09 actual196run31ebe95beb2cf6e1136f9719 onf3e822:1AzurePOST,5raw/5valid/5persisted/5ownerpreviewclaims,0rejected,1SN1topic. Rootreadactualselectedbody/citation: substrate-onlydependence andcarbocation slow-stepcause preserved, onlypunctuationdifference. Approvedprofilev1, exactknowledgein622charMeetcore SHAd60e232a23cbc8f91eb2b6f2dc679f0d07c4f66aa4a6cac299ff30911d5dca1c.487input/548output adapterreportedtokens,6912reserved/1072microusdsettled; current192114spent/0reserved. Bothcommits/cleanup/observer/closesack,12absencecounts0. ReceiptSHA7f9ef660cca3a6da2f10021d3e4f5cc35c84ee649d39f42bac0c2de71aed2efe; ROOTobservationCONTEXT-CLAIMS196-ACTUAL-OBSERVATION.json SHA9ec021fcdb6266929a93170a80a7f3d99360afb08a666dab9edfc1ff09bbc4f6. No generatedMeetreply oractualownerjourney; consumed196neverreplay.

## `core135-combined198-offline-build-packet` (2026-09-09)

Prepared the next source-only Azure web packet for clean `codex/combined-release198` HEAD `79c9d9a1ee92eb617bd6cc56b5727088293e1b4c`. Its commitment is `sha256:31061ffc99a5c6c3c970a60c7dc1b1c299e59dfcb026407ee91fd7576a9fae14`; the verified 1,142-file archive SHA is `d6c94e360e751dab65184a9f09740cad5c195b642e79b82c5f9ef745fb62f12c`. Existing compiled Bicep output SHA `ff43e07163b09db9637fdd326a951430d308fd603c9e7b009157b15370da73c8` matches the unchanged source Bicep hash. The bridge keeps Azure-only serving and all voice, Room, retention and schedules disabled; no image digest or release acceptance is asserted.


## `core140-git-and-deployment-readiness` (2026-09-09)

2026-09-09 n=1 actual noninteractive Git credential availability check and dry-run push succeeded for codex/combined-release198; no secret printed and no actual push. GitHub connector confirms repository access. PR6 remains open at61385c57d515b0c0fbcb8a58409f1bc135a4b529 against claude/gurukul-platform; actual local merge-base of198 and handover is exactly61385. Prepared198 web archive1142files SHA d6c94e360e751dab65184a9f09740cad5c195b642e79b82c5f9ef745fb62f12c, source commitment31061ffc99a5c6c3c970a60c7dc1b1c299e59dfcb026407ee91fd7576a9fae14. Image digest absent, no build/deployment. cu3k still Running at1788917040.9597473.


## `core140-cu3k-terminal-and-voice-provenance` (2026-09-09)

2026-09-09 cu3k terminal Failed at1788917304.2237103; observer read227717logbytes but no structured receipt. Same-run bounded log recovery pending. Voice agent recovered two small source layers1.03MB+15KB, verified manifest/config/layer hashes, no execution; deployed reference-window.js and run-once LF-normalized match198, original24k extraction and separation pass-through present. Receipt processing198-image-source-1788917324748604300.json; remaining source deltas under review.


## `core141-cu3k-truncated-wrapper-evidence` (2026-09-09)

2026-09-09 samecu3k sanitized artifact227717bytes SHA a19e43ec42ef6c90138027df3fbd53733d4c1df0529ca65e62c6f4a9e71c87df. Only chunks0-26 of76 emitted, compressed receipt452028bytes expected, completion marker absent. Root read wrapper final console.log loop followed by process.exit. Agent34 prepares output-drain fix and partial-gzip diagnosis, no retry. Actual Python3.12.3 preflight passed, alias created, no package installation. Complete release result remains unavailable.


## `core141-preview-processing-db-mismatch` (2026-09-09)

2026-09-09 actual processing Job GET/listSecrets projected database name only: neondb vs preview vyakti_expert_integration_20260906. Receipt processing200-db-binding-1788917513132460800.json; credentials retained only in memory, no SQL/writes. Existing worker cannot drain preview queue. Curie prepares separate preview worker, production consumer unchanged. Partial cu3k gzip prefix reports23/24 and azureweb failure at native-abort fixture; full receipt remains unverified.


## `core142-wrapper-drain-proof` (2026-09-09)

2026-09-09 six actual bounded child-pipe cases passed, actual fixed footer SHA d1a713caba8a996bb799429161dcc8d0f0d91bceaca99ffb6142420a8c3aab24. Explicit async adapter reproduces legacy loss; fixed175chunks/1048576payload bytes/completion preserved for exit0 and1; broken pipe refuses success. Native Windows behavior separately recorded, not Linux reproduction. FULLRELEASE199-OUTER-DRAIN-CONTROLS.json. No full rerun. Hindi199 actual dispatch running session21263 under enabled2b91a959d70c7905311bc0665138e224d7ef42ec424bb2fec4b18e441aaf0d4a/admission21be67208f09e3417fb0fcf93eff4122619799c4ff21d8d94c58d3f976404fb2, agent75 owns same-session observation.


## `core142-native-fix-and-hindi-environment-failure` (2026-09-09)

2026-09-09 native19931focused loopback groups pass on localNode24.13 with24.18-equivalent lifecycle, including beforefix reproduction, completedPOST, partialupload, postbodydisconnect, deadline/raw/stream. Actual24.18 still pending. Hindi199 runf304aa9386cdffdfe8dddfde session21263 exit1 beforeprovider/reservation, missing api/_config.js via api/_db.js. ReceiptSHA1523d4cb2a1eb12300275b9ca8523a7d750e871575fda435e7482078d66f61c6;0calls,192114/0unchanged,observercomplete/all12absence0. Consumed199 neverreplay.


## `core143-native-version-proof-and-freeze` (2026-09-09)

2026-09-09 n1 actual official Node24.18.1 Windows x64 run31focused groups passed session34337exit0 on33c73053. BinarySHAac51903c4c111815d52280b1fdcc8da067cbb37e2fe1a765097b85c3292c8582 verified against officialSHASUMS; nativegettertrue/setterfalse. Receipt azure-native-signal199-actual-node24-18-1.json. Combined200 clean41c5f0d0f9acc0848b70c7a9b073e68ae48e26e5,2code/test+4context files,414suites unchanged,noaddedhistoryrefs. ManifestCOMBINED200-FREEZE.json SHA14454b954c2e519d12cd8b53ea08ed4effed6085bc4ac3cc38a01eb4bb3a411a. NoLinux/fullgate yet.


## `core143-preview-startup-controls` (2026-09-09)

Nine actual-entry/DB-adapter offlinecontrols passed wrongtarget/mode/selftest/returnedDB/disabled/writerfailure/order; receiptSHA1df9b3fc7109fd71d38cb78e26bb493d1f8d3834d5127502d759e80a76e90baa. Existing configwriter accepts retainedFoundrysettings withsynthetickey. Fullrelease201 closureactualfreshrestore passed3100files/33historicalshows/10negatives, packdcd0d9f2fbb6267c23362e43728a5c0804fc9c04b7025b7c9f99a1d3fbc9d6ac,manifestc564f719e5763bf8bc608a1e8af5009f06e2239b13fdb764ec298aa402612077. No releaseexecution yet.


## `core144-processing-build-start` (2026-09-09)

2026-09-09 actual ACRcu3m scheduled exactlyonce byCurie, enabledpacketSHA1df906e6701aeb09bc631668561b2a02a24252c8c0589de867b74db760a2b7f9 onlytwoadmissionflagschanged. Separate0.50USDaccountingrecordprecedesschedule, tagabsencechecked,upload/scheduleACK. NoJobdeployment/GPU/modelcalls. SameIDobservation/digestverificationpending.


## `core144-cpu-build-success-release-running` (2026-09-09)

2026-09-09 actualcu3mSucceeded,exactregistrytag+immutablemanifestHTTP200/SHAverified. Imagef1512032b6ca6825a3ca2c134f7c12ab8701b58f0afc9e9d613289c62d16e396; receiptprocessing200-verify-registry-1788918485993473800.json SHAc1c98e2ecebc138345e36870e36570f0e9d579be1eee06ccb334b21090c4d4f7.0.50holdretained,actualcostunknown. Fullrelease201cu3nscheduledonce at1788918495.1993585,session73679terminal0, newreservation43c15d1e6e8490e1996273c4226066048e4aa2e2441c3fbcce46314a1680207e/admission29391000f3a41b8a92faf52c7bb5f7e1fb3ce8305f62cc37071de06f9ad0b9d2. Hindi200session2961running correctedcd13bc4baaeee1de74df6240160c07aecfb04672eb50789aebc2b6dd0b42d29a,admissiona94704b37a26634ff3e20d8d7dd716ffc576da74619370adfdbc2a4babbabb7a.


## `core144-hindi-document-evidence-failure` (2026-09-09)

2026-09-09 correctedHindi200runa2ca8f99a0cf3d80de991863 session2961exit1 atfixtures199line41 evidence.length expected1 actual0 afteraddContextFile returneditem. ReceiptSHAbcb721851ef39333b07772575f32a09f1925672a55b1674d6a84c3574e7ad26c.0provider/reservation, budget192114/0, fixturetransactionrollback/observercomplete/all12absence0/closeconfirmed. Consumed200neverreplay.75diagnosesoffline exactHindiContextLockerpath, no newmodel/SQLtrial.


## `core145-hindi-ingestion-cause-and-controls` (2026-09-09)

2026-09-09 offlineexactHindi fixtureletters/numbers145,marks105,length322, oldratio0.450below0.5 =>text_unreadable storedrefusal, explaining0evidence. Minimalfix5f60 passes contextlocker100 andcanonicalevidence39, actualofflineaddContextFile retainsfullHindi body/exactUTF16locator. NoSQL/provider/KV. Memorycompilerfixsource24/generated25checks passed withint8range/duplicatecontrols; frozencommitpending. Noactualgeneratedmemoryreplyyet.


## `core145-correction-source-complete` (2026-09-09)

2026-09-09 agentcorrection200reportsclean8b4d8187 explicitlist/correct/retract,bearer+Roomsession,English/HindiEditForget UI. tscforcedpassed,correction4controls,roomaccount42,doors2237/copygraphdiffpassed. ExactSQL935/3053/1534bytes requiresactualEXPLAIN andbothlockorder races; noDB/provider/cloud. Compiler94f3af source24/generated25passed withint8rangeandfreshbundle. Nointegratedreleaseyet.


## `core146-hindi201-actual-success` (2026-09-09)

2026-09-09 Hindi20191433aa482ea1a072fab97c1 session63363success,receiptSHAaf275caaab00b3e77c6f99e3f0b5f9eabab43e7b46967fd0ce8db0da45a84295.1AzurePOST0dialogue,537input530outputknownadapterusage,7134reserved1063microUSDsettled.4raw/valid/persisted/preview0rejected,acceptedohms_law_temperature_condition. ExactHindicitationandfaithfulEnglishclaimin748charMeetcoreSHAeabe5cc9a3f3f0de4ba0bdc9a05fd601f78b9a5dcb8dfc077fdf289b81cae462. Budget193177/0. Cleanupcommit/observer/bothclosesconfirmed,12absence0. Consumedneverreplay.


## `core147-preview-job-verified` (2026-09-09)

2026-09-09 processing202deployment+JobSucceeded; receiptprocessing202-deployed-readback-1788919456319608900.json SHA34541dbc6ca6615a8ad34b0fd42302025a9f9617c49fe11e90eb017cfa7a1ea1. f151image,voice-envConsumption1CPU2Gi,Manualretry0parallel1,devDBguard,flag0,eightversionrefs/registry/UAMImatch,executions0. Initialoptionalregistryfieldfalse-negativepreserved, positiveprojectionreadbackpassed. Hinglish202session14996running enabled e9a430c7c8bcdeaeebe274578631a42b8e71c75d204c4cf9325f1b55121c0611/admission268429494d4a8550d9783fb1311489738680f4fbc9ab405e03f185f24b32c7c1.


## `core147-hinglish202-actual-success` (2026-09-09)

2026-09-09 da247fd13208ee01e7bfdd24 session14996success,receiptSHA1d1f5de1415b79608dc7d5461aa8ecf5fbf0352b74b133cde6ee958b3e8e41db.1POST0dialogue,522in521out,6953reserve1043microUSDsettled,current194220/0.4rawvalidpersistedpreview0reject;rootread37C,pHnear7,20minutes,negated50Cdoublingwithdenaturationreasonfaithful, exactRomanHinglishcitein713charMeetcoreSHA83b59491c1edadb138a1f7b8570b6295db2b8f6ccc0ce8736622103009bba3d0. Cleanupobserverbothcloses12absence0confirmed;consumedneverreplay.


## `core147-cu3n-complete-23of24` (2026-09-09)

Actualcu3n996047ms LinuxNode24.18.1,23/24gates;48logscomplete,receipt2078032bytesSHA249869bfe027870c81743921aa49cbbaeb14539bef5838e25964c98a3266e72d pathfullrelease201-logs-1788919593054330800.gate.json. Onlyevalfailed: comparison-reference-ui after21desktopactual3expected0;first-use-refresh after9desktopHTTPbarrier;explicit-action-focus after46desktopEnterBODYvsheading. Nativeazurewebpassed. Performance9targets*n3passed;HindistudioLCP1736ms,TBT6,CLS0.095377,firstHindiPaint644.3ms (notinteractionlatency). USD1holdretained,noretry.


## `core148-correction-freeze-and-ui-baseline` (2026-09-09)

2026-09-09 rootreadcorrectiona442fcc2bff1fa3bb068b9bb2fca83e80c4694ebdiff;Astrafinalconfirmsmatchesreviewedworkingfix,nofurtherdefinitefindings.57prepares3EXPLAIN+singlefixturefirst, actualDBpending. Comparisonreset203heldoptionsresponse reproducesbaseline3checkedvs0 session20254exit1 after4groups; fixedrun97682passespriorfailingdesktopcheck22 andcontinues, notterminalyet. Creator70preparesactualAccountPage mountedproof forEditfocus andfalseemptyerrorstate hypotheses, noUIedit/proofyet.


## `core149-refresh-isolated-pass` (2026-09-09)

74actualsame41c5sourcefirst-use refresh12/12checks passed including1440pendinglistbothsuccess/error. No sourcereproductionorcommit. RootreadbackgroundRefresh99 has2opaqueHTTPbarriers;74nowlocatesfailedcolumn/optionalGETmechanismoraddsboundedfixture-onlydiagnostics, nottimeoutloosening/unchangedfullrerun. Comparisonfixintegratedworking202e2176fb6c58fd4eabeae61b92ecd6ae75ac19572,clean notfinal.


## `core150-mounted-focus-defects` (2026-09-09)

2026-09-09: creator70 tested AccountPage a442 at390/1440 in English/Hindi,16 baseline flow/fit checks. Memory list failure falsely displayed an empty state in all4 cells; Edit/Save/Cancel lost focus in12 checks. First fix bc0 failed the first EN390 Save focus check because the stored Edit node had been detached. Separate PrivateTextRehearsal08e2 desktop1440 native Enter/delayed real save POST fixture passed, receipt0b8d0673a612e87e7aa918d26c2eef926fc2d322db2daaf128ef5b4a7b3a2dd8. Synthetic mounted evidence only, no real owner sign-in.


## `core150-action-focus-full-pass` (2026-09-09)

2026-09-09: exact08e2 source, actual existing explicit-action-focus suite58/58 checks at390 and1440, including native Enter, typing/away/token/replica/hide/failure cancellation. Receipt bcb4f13674588a7616f5d2b52c0bd519925b58979694d3e2af13bbbca124f18d. No full release rerun. Working202c410 integrates exact fix and refresh diagnostics.


## `core150-correction-real-parser` (2026-09-09)

Single admitted correction202 run exit1: all3 public EXPLAINs passed,20SQL acknowledged,0DDL/DML/COMMIT/provider. Catalog guard rejected qualified pg_catalog.gen_random_uuid; both read-only rollbacks and closes acknowledged. Reused pooled backend PID then rejected observer before namespace query. Receipt879886727f6d04564043cc070011a67684a0bc16be301a19a5d7c4d4216d6566. This proves parsing only, not correction lineage.


## `core150-correction-lineage-verified` (2026-09-09)

2026-09-09T02:35:36.699Z to02:35:57.698Z, one development PostgreSQL203 run passed77/77SQL,3 public EXPLAINs,15 private DDL,0COMMIT/provider/errors. Old fact9007199254740993 replaced by9007199254740995 with exactly one linked consumed log/episode9007199254740994. Sibling unchanged; duplicate correction0rows; targeted retract only replacement; consumed-source replay0rows/no resurrection. Writer rollback and independent active observer namespace absence plus both closes acknowledged. Receipt504c983ce4f25ffd1ac2e11d802eeaddb3765f2bb7269ddaca2ea3abc964282d. No concurrent race or real HTTP authority claim.


## `core150-memory-controls-mounted-verified` (2026-09-09)

2026-09-09, actual AccountPage/copy/CSS source57a38e256a39aefe6871077aba08c3be5130c606,16/16 synthetic localhost checks across English/Hindi and390/1440. Distinct replacement-ID Save, re-edit/Cancel, targeted Forget with sibling retained and heading focus, loading/empty/errorRetry, touch and overflow passed. Sixteen screenshots; receipt3583308825d020e9be2444e06edc3dfb57a0d1eb3828dc298bcbfe9fa71d4af7. Root approved precise feature integration into working202; inherited azure-web eval must be excluded to preserve newer native lifecycle fix.


## `core150-integrated-typescript-pass` (2026-09-09)

2026-09-09: working202 product91aada0f8c69474ad3382f381a28e1f77dd17d8f passed one actual tsc-b-force exit0, stdout/stderr empty; receipt dce52aebac9398868d94c17eeeccc4570c3a338f91736b10f861094375960dd2. Private194 dependencies copied to private202 with6496files/237656288bytes, exact lock412f958e, no npm/shared writes. Evidence-only checkpoint39ea86a46397b9a08e47ecf9aa1779ef207d601a. Full release415 suites not rerun.


## `core150-stock-hindi-audio` (2026-09-09)

2026-09-09: corrected Azure resource-host /tts/cognitiveservices/v1 one POST200/no retries/GPU. WAV SHA16636b6e06d0e7145fad3cab3ac5d85409f84e527c23a2189fb3c79b85738cf6,1277444bytes,638700samples,26.6125seconds,24kHzmonoPCM16. Root Python wave/numpy whole-clip demeaned FFT n=1 gives1.9318934072691394percent energy above8kHz; raw clipping0,peak19951. Cost unknown. Saved spectrum-corrected.json alongside WAV. Synthetic stock voice only, not human owner likeness.


## `core151-refresh-barrier-fixed` (2026-09-09)

2026-09-09: agent74 actual existing browser suite12/12 passed with e2ad3a6e barrier change. Root read diff: replaces incidental replica-source GET wait with actual same-owner fresh persisted token at unchanged10000ms, retaining stale-result rejection and fresh-token retry. Source read establishes source pane can be unmounted during pending-list, so that GET is not guaranteed. Integration must preserve newer named-wait diagnostics missing from donor base. Full Linux gate pending.


## `core151-connected-memory-actual` (2026-09-09)

2026-09-09: Room202 run d12009d0e6703614167d422a completed3 Terra replies+1mini extraction. Exact learner preference retained in fact18, next-thread compilation received it, Room forget removed it and next compilation private memory empty. All synthetic owner12/fixture11 absence counts0,leases0,bothclosesconfirmed; all4 reservations67521 settled to15102 microUSD actual, budget209322spent/0reserved. Fullreceipt9476a0e6c10e5545178c20cc7492dffa41fdf398f7740fe04681155cfb37df5c. Root read actual3 replies and recall bodies. This proves narrow synthetic composed plumbing, not owner UI or voice.


## `core151-linux-release-started` (2026-09-09)

Actual ACRcu3p run_recorded1788923001.5213985, schedule session54692 exit0. Sourcecb2939d,415suites,CPU2/3600,packetb01c6e2b/executorfc35827a/archive53c4a31e. NewUSD1hold reservationf60fad72d67eceffb6fb620a99a89b69a3b716d85b2495c3e13403fc13db19c1 admission7121153aa3ae09340e8eb70ffe720c310c1ed8975d1e2c1a37beacb5182cd106. PreviousUSD4releaseholds preserved; no provider/DBsecrets/GPU/deploy.34observes samecu3p atmostonceperminute; terminalpending.


## `core151-account-readability-integrated` (2026-09-09)

Creator70 actual fullRoomApp synthetic screenshots/computedstyles English/Hindi390/1440, noerrors/overflow,28heading14body15section hierarchy, mobile48pxtargets, desktoprows, stickyheaderclearance. Root visually inspected English390 and readCSSdiff; modest readability improvement, not worldclass/fulljourney proof. Exact082496feCSS integrated NEWworking204b3c2c3472aa3b86cb442769150a8d19b7fbcd8b7, frozen202untouched. Owncontextgraph passes; noTSrerun CSSonly.


## `voice106-existing-assets-official-review` (2026-09-09)

2026-09-09: n=3 candidate runtime/readme and official model-card reviews (VoxCPM2, IndicF5, Qwen3-TTS); n=0 new synthesis, GPU/cloud calls, training, listening or quality scores. Historical Azure measurements and September 6 branch/provenance artifacts read only. Current Qwen card excludes Hindi; IndicF5 lists 11 Indian languages excluding English; VoxCPM2 lists Hindi/English, while its local Hindi wrapper rejects all-Roman text. Existing Indic/Qwen deployments are pretrained evaluation artifacts; historical owner Chatterbox LoRA exists but current ordinary preview adapter selection remains unproved. The retained synthetic stock receipt/FFT were inspected, not remeasured.


## `core152-typed-intermediate-source` (2026-09-09)

2026-09-09, b176dc9389361579c18b4f1f89aaa42455e144eb source reviewed77. Generated compiler28, actual Room caller/runtime22, authority24 and correction6 offline groups passed, bundlefresh369400bytes. Same-episode/current-epoch role=me source projection and closed fields preserve existing ownership/consent/forget predicates by review. Real changed recall SQL and provider obedience remain unmeasured. Strong false negatives include natural Hindi and many sentence forms; this cannot substitute for the requested multilingual product.


## `processing161-proof206-actual-20260909` (2026-09-09)

2026-09-09T03:15:35.189Z–03:15:57.296Z, n=1 admitted development run/one authored private fixture, actual exit0.80/80SQL acknowledged,14non-ANALYZE EXPLAINs(5scope+8authority+1erasureprojection),15privateDDL,errors0,0COMMIT/publicDML/provider/GPU. Existing147parent bind→in_flight; explicit authority delete and actual sourceFKcascade retain1lifecycle/1claimedchild/windowheld138600/budgetheld138600/spent0. Sourcecascade removes source/job/authority and pollrefuses; close/due/release0 preserve resourcehold. FixtureROLLBACK, independent namespaceabsence and bothROLLBACK/closesack. ReceiptSHA38656f4ec3915544220bbb796c1fbaaf8ee193554d9bd0bdd0d52d1c34f54a58.


## `core152-linux-gate-terminal` (2026-09-09)

Actualcu3p finished FAILED after980090ms on LinuxNode24.18.1/Chromium151.0.7922.34/twoCPU, complete2085998byte receipt9cbc05c32a190e72fde9e7b47672606887b31a420ee38497d0647a3e976fde04 and48complete logs.23/24gates pass; evalsuite selectedreferencecomparison and explicit-action-focus fail. Previous comparison-reference-ui and first-use-refresh-ui nowpass.9performance targets*n3passed, HindiLCP1756ms/firstpaint617.5ms/TBT4ms/CLS0.095377/JS73446bytes. No latency/likeness claim.34observer stoppedterminal, no rerun orsettlement; allholds preserved.


## `core152-auth-readiness-scope` (2026-09-09)

173 source audit ofcb2939d: SupabaseAuth via POST/api/account ops send_otp/verify_otp/refresh, server-only URL+key, persistentNeonrate table beforeOTP, service-role for subsequentprivate storage. SourceboundAzurewebrevision remainsundeployed, and real emaildelivery/verification/restore hasnotrun. No OTP/email/accountcreation performed. MissingAzureCLI is not an APIavailability blocker; existingAPIhelpers alreadyreachAzure. Beforefullfirst-useracceptance need actualboundapp/settings/storage/rate-table and ownercontrolledemail smoke, without claiming fixturebearer proves it.


## `processing161-apply207-actual-20260909` (2026-09-09)

2026-09-09T03:29:54.465Z–03:30:08.253Z, n=1 root-admitted application, actual exit0. Devvyakti_expert_integration_20260906 only. Underadvisorylock all3absent;50/50SQLack,3CREATEack,1COMMITattempt/ack. Independentreadback3tables24columns19constraints4indexes,all3empty. Parentcatalog and allocation/referencedbudgetdigests unchanged;1window/138600microUSDheld. WindowMD5 1cb8c12e4c18243465d8c3d844d8ffb2;budgetMD5 6a47dfa110696263dd7d88a791e2da26. PrimaryCOMMIT/close andobserverROLLBACK/closeack,errors0. ReceiptSHAa05bd2f4a605e23a1892168f619e02980f0ba2cb90c873e5153ccf2dc63ff7f2.


## `processing204-cu3q-registry-20260909` (2026-09-09)

2026-09-09, n=1 CPU build cu3q, terminal Succeeded. Exact digest and tag independently returned HTTP200 for f4a6111013334dc4a86e80ea2c181a4c8a9ca7e53a958fccb281e002677e5f7b. Receipt processing204-verify-registry-1788924642950915200.json read by root. USD0.50 accounting hold retained, actual invoice unknown. Existing preview Job still uses previous image and remains disabled; no new Job or GPU execution follows from build success.


## `postrelease204-oracle-fixes-20260909` (2026-09-09)

2026-09-09, n=2 focused eval repairs integrated in clean working7bfa08d417ef0b02fcff9bd60621d4aea1faa271 with Account CSS. Action-focus58 checks passed after waiting for actual editor closure, captured exit absent. Selected-reference24 checks passed exit0 after actual second permission receipt adoption; old witness negative reproduces eight stale checks. Frozen cb release remains23of24 gates; no full successor run yet.


## `processing204-parser209-actual-20260909` (2026-09-09)

2026-09-09T04:11:18.519Z to04:11:26.317Z, n=1 root execution, session30507 exit0. Exact reviewed packetf213b3ca355aa4a3faa52556b3afdab19faf81d7b4cb73292c7161f93c131fc8:19 EXPLAIN without ANALYZE,27of27 SQL acknowledgements, readonly dev database, public161 presence confirmed. Zero DDL/DML/COMMIT/provider. ROLLBACK and connection close acknowledged, errors empty. Receipt processing204-parser209-1788927078498-result.json SHA0c8ebdd32ec366a590606334d89fb098a15c2702e90981b58ee451795986f6d7. Consumed209, no replay.


## `processing204-ingestion-actual154-20260909` (2026-09-09)

2026-09-09, n=1 root execution session72462 exit0; enabledpacket86c5b2a00f5e1759a09339804068ff2e65c73678cdcbe305cd200331ae8e1e8f. Actual create-only Azure PUT HTTP201,1277444bytes, sourceSHA16636b6e06d0e7145fad3cab3ac5d85409f84e527c23a2189fb3c79b85738cf6. Fenced SAS, PUT and HEAD acknowledged. SeedCOMMIT acknowledged; independent quarantined source and primary selection observed; primary and observer closes acknowledged. HandoffSHA351978de2086a1893f90e8cec6e763a0ec0744c8c94e1353375acad82d8bb93d. Report finished2026-09-09T04:15:44.461Z. SQLcounter21 tracks wrapper calls, not a guaranteed count of every observer setup statement. Zero model/worker/GPU calls.


## `room-correction-reclassification208-offline` (2026-09-09)

2026-09-09: actual generated compiler30, Room runtime24, metered caller27, correction7, authority28 focused controls passed; narrow compiler TypeScript check passed; generated bundle fresh373030 bytes. DB/HTTP doubles only, no live SQL/provider calls or semantic obedience claim. Initial new test failed because it read sizes rather than actual sections; corrected test property then terminal0. Real reverse-order SQL and pressure fixture pending57.


## `communication162-proof208-measured` (2026-09-09)

n=1 admitted run,2026-09-09T04:23:52.190Z to04:24:23.685Z, actual terminal exit0(root session40274).124 SQL calls,119 command acknowledgements and5 expected23514 constraint rejections;20 private DDL,5 non-ANALYZE EXPLAIN plans,0 COMMIT/provider/public writes. Both transactions rolled back and both connections closed with acknowledgements; independent namespace absence verified. Receipt communication162-proof208-1788927832182-result.json SHA858e11ae268f6b104155cd7599004a39b2b48c05719b5ded9eabe401e5dce89a.


## `communication162-apply210-measured` (2026-09-09)

n=1 actual application,2026-09-09T04:35:34.297Z to04:35:42.367Z; root terminal exit0.23 SQL calls/23 acknowledgements,1 ALTER,1 COMMIT acknowledgement. Full independent catalog matched precommit; existing-fact count was0 and the old-column projection digest remained e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 before/after. Primary commit+close and observer rollback+close acknowledged; errors0. Receipt communication162-apply210-1788928534286-result.json SHAb5ba1ba5fc4c7c075c39621fd4ba77d8f6be01fd88ea9d385d0648127c9cde23. No fact DML/backfill/financial query/provider call.


## `processing204-actual-reference` (2026-09-09)

n=1 synthetic stock source, actual Azure execution vyakti-replica-preview-oqni2gz Succeeded, eight stages complete at attempt1. Consumed v2 diagnostic4b28167b03f05fb88622869935f1e04e67b00d633ab4877113435b9c4ad01d9b:16 comparisons true, one blob GET,10 SQL calls, 480078bytes/240000samples/10000ms/mono24000Hz PCM16; energy at or above8kHz fraction0.014086665212671509. Reference SHA2b24ed0bfa2e496e6640788a67c336f38ae640fa1f5d19a156ae27107871cc3a. This measures processing integrity/bandwidth, not speaker likeness. Rollback and close acknowledged.


## `processing204-terminal-resource-read` (2026-09-09)

2026-09-09 fresh readonly receipt processing204-terminal-readonly-1788929509237.json: all12 revisions zero replicas, zero claimed children, lifecycle natural_zero_observed. Resource release timestamp04:29:12.274299Z. Ledger limit1000000/reserved970200/spent0 microUSD; old138600 plus831600 unresolved hold. Zero writes, release calls or model calls. Availability release is not monetary settlement.


## `voice106-overlays-actual` (2026-09-09)

2026-09-09 n=2 Azure ACR CPU builds cu3r/cu3s Succeeded, exact parent layers and final registry digests verified. Chatterbox19b990e606e08a3434ca0d4b64f24fe26d78f6652b61948d1988aae0254f1885; VoxCPM26117bb89a4eb32508f39834ba6a7841a8a667c67d31a8ba78e68794e5defcd5c. Each CPU2/1200s and USD0.50 reservation retained; actual invoice unknown. Zero synthesis/GPU comparison calls. ROOT VOICE-OVERLAY106-ACTUAL-BUILDS.json.


## `postrelease204-integrated-ts` (2026-09-09)

2026-09-09 n=1 integrated TypeScript run session72556 exit0 on product e5a4622f, clean context checkpoint2795a462. Private exact-lock dependencies6496files/237656288bytes. Result180ddf4262767c597ee83cf5fcadda1197ba70f23aa27467c8f0ba9f1a7e0c9e. This is not the pending full release gate or full authenticated journey.


## `processing204-scoped-reader-measurement` (2026-09-09)

Actual n=3 metadata GETs returned200: exact voice-evidence App caller permissions, built-in Reader, preview UAMI. Current caller has Microsoft.Authorization/*/Write excluded, no alternative permitting row; principal a3d98efb verified. Zero resource/runtime writes, session close acknowledged. Receipt processing204-scoped-reader-1788927975739604300.json.


## `room-semantic211-actual` (2026-09-09)

2026-09-09 n=1 admitted run, session92529 exit1, four POSTs: two Terra replies/two mini classification calls. One natural Hindi quote became one Hinglish/roman/short fact; fresh EnglishSN1 question got concise Roman Hinglish. Actual correction generated a new fact Hindi/devanagari, brevitynull despite explicit विस्तार से, so three later cases unrun. All four settled8863microUSD, final220885spent/0reserved/1Mlimit;11fixture and12owner absence counts zero, leases0, primary and observer close confirmed. ResultSHA47311a14293525f8ae69ea9cb01e0db741438750c5d08d20d9815b99e2b417da; full prompt/raw/delivered packetSHA50f5394f2819bc80d10c5afa15b37e53ce872367e73b4a3343d4840b93ca4142.


## `preview204-mounted-signin` (2026-09-09)

2026-09-09 n=1 current preview launch,PID35496/session59558, receiptDEV204-LOCAL-PREVIEW-RECEIPT.json SHAa1d02b484295d58045740c891f8c3a4ea53fd47cbe4bef71ca0f38bb1c67ea3c. HTTP200 then root in-app DOM and1280x720 screenshot verified branding, educator image, email form and Google option. Signed-out desktop only, no mobile/full-flow or delivered OTP claim.


## `processing204-hindi-transcript-content` (2026-09-09)

2026-09-09 n=1 synthetic source/twohi-IN spans. Actual readonly7SQL, no model/blob, rollback/closeACK; receipt50f3aa105206cb198224e9aad1021641f5b83d1bf6b7335e17ac8d63898fbcd1. Authored58tokens versus57ASR: one joined repetition plus two Hindi spelling variants. Exact unordered token recall54/58; after explicitly normalizing only these variants token multisets58/58. No lexical omission/invention identified for this sample. Not general ASR quality or likeness.


## `voice106-actual-job-start` (2026-09-09)

2026-09-09 n=2 provisioning PUTs HTTP201 followed exactbothconfiguration inspect; actual KQL/workspace read passed with0rows, not logdeliveryproof. CAS1M→2.5M acknowledged, old970200/0 and textledger preserved. ROOTsession28195 started Chatterbox execution vyakti-stock106-chatterbox-u5wgkm7, windowe5b58f2d-b5e0-4556-b718-6db1654b0b0a,582120reserved. runner.jsonl currently Running, no outputs scored yet. Observe sameexecution only.


## `communication-depth212-offline` (2026-09-09)

2026-09-09: inspected actual211 call4 full prompt/raw response from room-semantic211-actual-dialogue-review.json SHA50f5394f2819bc80d10c5afa15b37e53ce872367e73b4a3343d4840b93ca4142. Observed one depth omission; schema had enum names but no semantic descriptions, so underspecification is a causal hypothesis, not proved sole cause. Offline authority29, actual metered caller27, generated compiler30 passed.20 human-authored held-out expectations cover English/Hindi/Hinglish paraphrases, negations, quoted/third-party/current-turn cases; only expected-output transport/normalization tested, not model understanding. Bundle374290 bytes fresh. No model/DB calls.


## `scientific-brackets212-measurement` (2026-09-09)

Offline math13, list15, Room19 checks pass; bundle regenerated and freshness passes. Real roomSay fixture confirms exact brackets in returned bubbles and remembered assistant answer. No SQL/model/browser/full release.


## `transcript-chronology213-caller-control` (2026-09-09)

One actual synthetic Hindi source produced two complete transcript spans whose creation/UUID readback moved the final two sentences before the opening sentence. Source review found the same ordering in `ELIGIBLE_TRANSCRIPTS_SQL`, and `createExtractionBatch` preserves returned row order for the claim-extraction provider. After changing the query to source creation plus `span_start_ms`/`span_end_ms`, the focused existing replica claim-extraction suite passed 55/55, including a new exact SQL-order control. No SQL, blob, or model call was made for this source change.


## `transcript-chronology213-parser-measured` (2026-09-09)

n=1,2026-09-09T05:12:26.786Z to05:12:29.863Z,terminal exit0.8SQL/8ACK,1EXPLAIN; database vyakti_expert_integration_20260906,read_only=on. ROLLBACK+close acknowledged,errors0,writes0,provider calls0. Receipt transcript-chronology213-parser-1788930746778-result.json SHAb7ac93e7a60247ec53c195f07e5621230b78f1ad40b11be5db2f408edf117782; EXPLAIN SQL SHA73993cfaad8e1b147ca857ba4d1a6257e73c898f031e3c669f28319131a984fa.


## `room-semantic213-actual` (2026-09-09)

2026-09-09 n=1 admitted run session83271 exit0.7POST:5Terra+2mini, allstop/allsettled25595microUSD; actualreserved119811; final246480spent/0reserved/1Mlimit. Natural Hindi request classified Hinglish/roman/short and fresh EnglishSN1 got Roman Hinglish. Correction classified Hindi/devanagari/detailed and actual compiled prompt projected all3, but next reply English. ExplicitEnglish/afterwholeforget repliesEnglish; savedfact unchanged by override, oldrecall empty/newfollower/privatecontextempty afterforget. All11fixture+12owner absence counts0,leases0,bothclosesack. ResultSHA50de4a2a9838498ec1dc1cf3e02ffe38bf1157164571abc602c4dcc34af4d7c7; fullreviewSHA114abe8bf25b3dec65aba82c3ac80c4208d26d0beccd7043e2f6059f9624e7e7.


## `voice106-twelve-actual-clips` (2026-09-09)

2026-09-09 n=12 held-out synthetic clips,6 permodel,2Hindi/2mixedscriptHinglish/2English each. Actual runner28195 exit0,bothJobsSucceeded,eachcapture1read and6verifiedartifacts. Chatterbox total67920ms audio andVox64800ms,all24k. Chatterbox model-call elapsed7556–22470ms,Vox20060–36234ms; these are local model-call timings, not end-to-end conversational latency. Captures18d3378021c69d065bb7577afb37e233d87d72f5ea7d732627f42d1f935d8c83 and77df03be06632a114b178125634284f74a3908b20882e1b584ff719ad08c5fd4. Accountingheld, qualityunscored, Chatterboxlanguagequalificationwarnings retained.


## `voice106-listening-mounted` (2026-09-09)

2026-09-09 n=1pack,PID12896/server5194.12nativePCM-toWAVhash/geometrychecks,12HTTP206rangechecks,privateURL404; rootbrowserDOM and1280x720screenshotshowactual6pairs/referenceaudio/manualratings.0humanratings. Screenshot revealed longform/stickyfooterfriction;creator70 improvesonepairnavigationwithoutrepackingrandomlabels. No perceptual rating from visualinspection.
