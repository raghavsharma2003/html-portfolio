# Decisions

Each entry says what was decided, why, and **what would reverse it**. A decision
without a reversal condition outlives its reason.

---

## `brain-model` — her brain stays on `google/gemini-3.6-flash`

Two credit-funded candidates were evaluated properly and both were declined.

- **grok-4-20-non-reasoning lost 38–2** on blind, counterbalanced charm judging
  across 48 conversations. Warmth 35–3, humour 31–2, personhood 34–4. It also
  ran 36.1 words/turn against 20.5 (≈13.9 s spoken, worse than the 12.3 s we had
  just cut down from), with 63% of turns ending in a question.
- **gpt-5.6-luna tied** (17–18, p=1.00) and *won* specificity 9–25 (p=0.009),
  but used the photo/gif/voicenote tags **zero times in 144 replies** against the
  incumbent's 11 — a loved feature switching itself off.

**The inference that matters:** an earlier reading of the luna tie suggested the
47k persona did all the work and model choice barely affected charm. Grok
disproved it — same prompt, same beats, same judge, 38–2. **The prompt sets a
ceiling; the model decides how close you get.** Fast, cached, credit-funded and
excellent at vision predicts nothing about whether she survives on it.

**Reverses if:** a candidate wins or ties blind charm judging AND keeps the media
tags AND holds ≤20.5 words/turn. Cost is not a reason — see `cost-per-turn`.

---

## `voice-model` — her voice stays on Gemini TTS

Rejected Azure by ear despite better numbers on every measured axis. See
`rejected.md#azure-tts`. **Reverses if:** a candidate is judged by ear to sound
like an Indian woman in her twenties, tested on her real register lines.

---

## `vision-model` — screen share should move to `grok-4-20-non-reasoning`

**Recommended, not yet wired.** 0 fabrications in 32 assertions against luna's 1,
terra's 2 and maverick's 3; reads a chat thread completely and correctly where
both OpenAI models read a third and invented the rest; **428 ms median** against
the incumbent's 2,136 ms (≈4 frames behind at our 600 ms cadence); **288 image
tokens against 1,078**; credit-funded.

**Conditional on `grok-quiet`:** it returned `NO_COMMENT` on 15 of 16 frames.
That is our directive's gate, not model reticence — but when pushed to engage it
fabricated on a small probe. Retune the directive, then re-measure fabrication.
Do not ship on n=6.

**Reverses if:** engagement cannot be raised without fabrication rising with it.

---

## `extract-model` — memory extraction uses `grok-4-1-fast-reasoning` (live)

Deciding what is worth remembering, and which of two contradictory things is now
true, is judgement work — and nobody waits on it, so the +3.3–4.6 s that
disqualifies reasoning for speech costs nothing. Azure first (credits, better
model), OpenRouter as fallback: a bad Azure minute must cost a slower
extraction, never a lost memory. Azure returned `DeploymentNotFound` on 7.5% of
40 calls in a separate battery, so the fallback is a measured need.

**Reverses if:** extraction quality measurably drops, or the fallback proves
unreliable under real load.

---

## `reasoning-live` — reasoning is banned from her live replies

See `reasoning-split`. Three grounds: +3.3–4.6 s to first spoken token; the
failure concentrates on heavy beats where duty of care is highest; and helpline
over-triggering at 16.7% vs 0%, once immediately before the user clarified he
was not talking about self-harm.

**Beat-routing was considered and rejected:** you must classify *before*
generating, and a misclassification puts reasoning on the crisis turn — exactly
the case being routed away from.

**Much of the light-beat gain is promptable anyway** — the baselines ask 1.67
questions/turn against a stated one-in-three ceiling and write 29-word bubbles
in a 15-word lane. Fixing that captures the gain at zero latency.

**Reverses if:** first-token latency with reasoning drops under ~1 s AND the
heavy-beat regression is shown to be fixed.

---

## `light-only` — the app is light-themed, unconditionally (2026-08-11)

An OS-following dark theme shipped and was removed the same day at the owner's
request: *"the ui should be light theme, this dark theme can be avoided. previous
light theme was fine."*

Removed rather than made a toggle, because a toggle is state that can get stuck
and a preference the user has to find. One look, always.

**Reverses if:** the owner asks for night reading. The palette below is the one
that was built — a warm-dark room rather than an inversion, her bubble lifted
off the ground instead of punched into it, the accent brightened to hold 5.2:1
on the ground with a deeper one carrying white text inside the bubble. Choosing
these was the expensive part; re-deriving them would be waste.

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15100f;
    --surface: #1e1817;
    --surface-2: #2a2321;
    --surface-3: #362d2b;
    --ink: #f4eeea;
    --ink-dim: #a99e98;
    --ink-faint: #7d726d;
    --accent: #e0596e;
    --accent-deep: #ef7085;
    --accent-soft: rgba(224, 89, 110, 0.16);
    --accent-warm: #f2895f;
    --bubble-me: #b03a4c;   /* white on it 5.91:1 */
    --tick-read: #a9e9ff;
    --ok: #45c96c;
    --danger: #ff6b5a;
    --hairline: rgba(255, 240, 235, 0.09);
    --hairline-strong: rgba(255, 240, 235, 0.17);
    --scrim: rgba(0, 0, 0, 0.58);
    --chrome: rgba(28, 22, 21, 0.82);
    --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px -12px rgba(0, 0, 0, 0.6);
    --shadow-float: 0 12px 40px -12px rgba(0, 0, 0, 0.75);
  }
}
```

Bring back `index.html`'s media-scoped `theme-color` pair at the same time, or
the browser chrome sits dark above a light app.

**A trap worth recording:** the first attempt COMMENTED the block out. The
palette contains its own inline comments, and a nested `*/` closes the wrapper
early — which left half a dark theme live in the stylesheet and passing every
build. Commenting out CSS that contains comments does not work.

## Standing constraints that shape everything

- `credits-partner` — Microsoft for Startups credits cover only models **sold
  and billed directly by Azure**. Anthropic and Hugging Face are excluded
  outright; Meta, Mistral and Cohere are "(select models)". **With a card on
  file, an ineligible model bills the card rather than failing.**
- `cache-9x` — prompt caching matters ~9× more than sticker price on our
  workload. A model 5× cheaper per token with no prefix cache costs us *more*.
- `silent-truncation` — prompt truncation is silent and eats the END, where the
  newest and most safety-relevant text sits. It has already cost the crisis
  helplines once. `scripts/check-prompt-budget.mjs` is the guard.
- `prompt-position` — a rule buried mid-brief fired 0/8; the identical rule
  appended last fired 8/8.

---

## `scene-hold-800` — the landing hold is capped at 800 ms, not 4000 (2026-08-11)

The hold before she reacts to a settled screen is `HOLD_MULTIPLIER x that
person's own landing rhythm`, bounded by `HOLD_REPLACE_MAX`. At 4000 the bound
did not bind, so **the slower someone moved between screens the longer she made
them wait on each landing** — backwards for the one lane that is the deliberate
"dekh yeh". It was also silencing stops outright: a 4080 ms hold demands 4000 ms
of stillness, the screen moved on at 3720 ms, nothing fired.

See `wake-hold-curve`. Stop → her voice p50 2.66 s → 1.70 s, and 215/300 stops
get a reaction instead of 180, with fabrication flat.

It lands at 800 rather than the 260 floor for a reason worth keeping: a show
wake may only ride behind a frame captured while the screen was HELD, and a
still-settling screen has moving cells, so it is not held. That was checked
directly down to a 120 ms hold — the picture she answered on was captured after
the arrest every time, minimum lead 120 ms. But the margin is one detect tick,
and replayed sessions settle in one tick where a real fling does not.

`scene.ts` and `SceneReader.java` are twins; the constant is measured in the
TypeScript harness, so both move together or the Android lane silently keeps the
old behaviour.

**Reverses if:** fabrication rises on the landing lane, or she speaks during
flick-storm glances. If she is merely heard getting chatty while browsing, 3000
is the conservative fallback and buys about half the win.

---

## `relational-state` — the build target is the relational-state layer; Meera is instance one (2026-08-13)

The owner's decision, made explicitly after reviewing the evidence: Vyakti is a
relational-intelligence lab. The falsifiable claim the company rests on:

**An AI person's identity and relationship can be made to survive replacement
of the model underneath her.** Today that claim is FALSE, and measured false —
`charm-grok` (38–2 on a byte-identical prompt) and `realtime-azure` (41–53
words/turn against her 20.5) both show the model leaking straight through the
persona. The prompt sets a ceiling; the model decides how close you get.
Closing that gap IS the company.

North star, two numbers: **migration fidelity** (users who cannot tell the
model changed) × **relationship retention** (D30/D180 still talking to her).

Sequencing, decided by the owner against my users-first recommendation
(recorded so the choice reads as deliberate): deep research → full
relational-state build → swap test → users. Existing code has no seniority —
each component gets an explicit keep/lift/rebuild verdict during research, and
anything replaced is logged rather than deleted.

Constraints that survive the rebuild regardless: the safety invariants (crisis
protocol, never-deny-AI, NEVER MANIPULATE, honest forget), `prompt-position`,
`recited-prompt`, `silent-truncation`, and the swap test runs on a CONSENTED
cohort with debrief — covert emotional experiments on attached users are what
regulators are probing, and trust-as-moat cannot coexist with them.

**Reverses if:** the swap test, run after the full architecture, still shows
high detection — identity cannot be lifted above the model at acceptable cost
and latency — or field evidence shows retention is uncorrelated with
relational depth. Either result would be a finding worth the company knowing,
which is what makes this a lab and not a bet.

---

## `spec-c-minimal` — the relational-state architecture is C-minimal plus grafts (2026-08-13)

Phase B: four architectures with deliberately different priors (graph-first,
event-sourcing, minimal-diff, multimodal-first), judged by three adversarial
lenses, 12 judgments. **C-minimal won (150.5 / A 144.5 / D 138 / B 137)** —
extend the repo's one proven portability mechanism (authored state +
deterministic retrieval + structural guarantees) into the full relational
layer, rather than importing an architecture the team cannot operate.

The synthesis is `docs/SPEC.md` (14 sections; proposals preserved in
`docs/research/design/`). C's four fatal flaws are fixed by name in §0.2, and
the best ideas of the losers are grafted, most importantly: episodes as
citation ground truth with a four-layer enforcement ladder (from B),
two-mechanism truth maintenance — invalidate for belief change, hard-delete
for forget (from A), and the WE-store replay + sham-arm-as-relabel (from D).

Load-bearing properties: core 40k + tail 24k = SYSTEM_MAX exactly, asserted
in CI; every file in Phase C has exactly one owning workstream (§13 — the
collision contract, learned from two agents editing liveCall.ts); Phase C's
definition of done is the D-battery flagging all three archived bake-offs
before any live verdict is trusted (§14). The known-bad corpus is archived in
`evals/archives/` — it is the validity gate for the entire swap-test claim.

**Reverses if:** D2 fails its dual reversal (<2pp movement across 3
consecutive milestones OR <10pp total with zero adapters in the cost
envelope) — in which case the claim narrows to gate-and-adapter plus
migration-UX on the same engine, and the consented cohort does not run on the
strong claim; or the citation law starves consolidation past its
pre-registered response ladder.

---

## `multiparty-direction` — the relational OS extends to shared memory across a group (2026-08-13)

The owner's direction: one AI as a **common friend to a group** — couple,
family, friend circle. Each member talks to her 1:1; she knows each person
deeply; she can reference one person to another the way a mutual friend does;
and she participates in the group's shared space as well. Distribution begins
on WhatsApp groups/communities, migrating users to the app later. The 1:1
relational OS remains the foundation and ships first — the group layer is what
it must be shaped to support.

**The research core this adds — and the breakthrough candidate:** disclosure
control. What may she tell A about B? A mutual friend's entire value sits in
judged disclosure — knowing what was told in confidence, what is safe to
relay, what to actively bridge ("arre, B was just talking about that"). Done
wrong it is not a bug, it is a betrayal engine. Provenance-gated disclosure
(every fact already carries citations to episodes; episodes carry WHO was
present) is the mechanism the schema already half-supports: vy_person is
separate from devices, episodes are participant-scoped, and the WE-store is
dyadic by construction.

Sequencing unchanged by the owner's own words: crack the relational OS first,
then per-use-case personas for WhatsApp and in-app.

**Reverses if:** the WhatsApp platform track shows bots in user groups are
infeasible or ban-bait under the Business API (then distribution pivots to
app-first or another surface, the group architecture unchanged); or disclosure
control cannot be made safe enough to demo (then the group layer waits and 1:1
ships alone — a common friend who leaks is worse than no common friend).

---

## `group-distribution` — WhatsApp existing groups are out; business-created groups first, Telegram validated fallback (2026-08-13)

The whatsapp-platform track fired half of `multiparty-direction`'s reversal
condition: the Cloud API's group messaging (Oct 2025) works **only for groups
the business itself creates** — joining a group users already have is
infeasible without unofficial-client ban risk, and iMessage is out entirely.

The product shape survives with one UX inversion: **she creates the group and
your people join it**, rather than being added to yours. That stays on
WhatsApp, where the users are. **Telegram supports the original shape natively,
free, today** and is the validated fallback if the invert-the-invite flow
tests badly.

**Reverses if:** the business-created-group flow shows unacceptable joining
friction with real groups, or WhatsApp policy moves against companion bots —
then Telegram-first, same architecture unchanged.

## `structural-disclosure` — group privacy is a retrieval property, not a persona rule (2026-08-13)

Two laws for the group layer, from `disclosure-leak-rates` and the triadic
track:

1. **Person B's private material never enters person A's context.** Exclusion
   happens at retrieval time, structurally — the disclosure ACL is computed
   from the participants of a fact's cited episodes (one join over machinery
   that already exists). What the model never sees, it cannot leak; everything
   else measured leaves 9–90% residual.
2. **Disclosure permission is negotiated with the discloser, never inferred.**
   Petronio's boundary-turbulence rule, and the direct falsification of the
   obvious design instinct ("she can judge what's safe to share"). She may
   ASK A whether B can know; she may never decide it alone. A 2026 BYU/IFS
   couples study (n>2,000) measures the harm of the alternative.

**Reverses if:** a future measured system shows near-zero behavioral leakage
at n≥300 across the ConfAIde/PiSAs axes — until then, structure only.

---

## `phase-c-complete` — the relational engine exists and its battery can say no (2026-08-15)

Phase C closed with §14 met: eight workstreams (eval, schema, safety,
compiler, consolidate, relstate, integrate, router, battery), each behind its
own gate, ~2 days of fleet work. The load-bearing properties, all proven not
promised: byte-identity with no relational data (83/83), forget reaches every
derived row including taste candidates, citations are DB-enforced, pull-only
holds 0/300, the D0 battery flags all three known-bad archives and passes a
true sham. Residual: compile.manifest telemetry (ticketed, Phase D prep).

**Phase D (the swap test) is now runnable and priced:** a powered D2 run is
$2.78/comparison — ≈$834 for n=300 both-orders two-judges against one
candidate. The real vision-lane gate run (grok, needs the retuned-directive
measurement) is the natural first candidate. **Reverses nothing** — this node
records completion; the program's reversal conditions live on
relational-state and spec-c-minimal.

---

## `adult-default` — unverified maps to adult gates until launch (2026-08-15)

The owner's decision, in their own words: the product is 18+, its only
current users are known adults (the owner is 24), and "we will solve this
when we make it live in some other way." So `gatesFor("unverified")` returns
adult gates for the pre-launch period. The minor tier's frozen configuration,
the clock card, and every structural piece stay intact and tested — one
mapping flipped, nothing dismantled.

**Reverses at public launch, non-negotiably:** the safety-reg research is
unambiguous that age-tiering is converging on mandatory (FTC 6(b), state
bills, China's rules), so `age-tier-cliff` stays OPEN as the launch-blocking
item rather than being closed by this decision.

---

## `d2-on-credits` — the swap test runs on the Azure grant, not cash (2026-08-15)

The owner has no cash; the $834 D2 pricing assumed OpenRouter-billed judges
(claude-opus-4.8 + gemini-3.5-flash-lite — the measured $2.78/comparison).
Restructured to ride the $5k Azure grant instead:

- **Judge family 1: DeepSeek-V4-Flash** — already deployed on the resource,
  Azure-billed, credits-eligible, and family-distinct from both arms.
- **Judge family 2: an Azure OpenAI chat deployment** (one owner click in
  Foundry, same flow as previous deployments) — first-party billed, eligible.
  Anthropic judges are structurally unavailable on credits (`credits-partner`:
  excluded outright), and Gemini does not exist on Azure.
- **Candidate-arm generation on Azure** (credits); incumbent-arm generation on
  the free Gemini daily pool with OpenRouter overflow — the only cash residue,
  est. $0–30.
- **Validation before spending the full n=300:** new judges must clear the
  ≥80% agreement bar (SPEC §10-Q5) against the ARCHIVED blind verdicts in
  evals/archives/ — a cheap credits-billed backtest. Trading judge pedigree
  for free money is only sound if the trade is measured first.

Net: ~$800-equivalent grant burn from $5k (which also funds extraction,
backfill, drift — comfortable), ~$0–30 cash.

**Reverses if:** the credit-billed judges fail the 80% agreement backtest —
then one premium judge family is paid in cash and the run costs ~$400, not
$834, since only one family needs buying.

---

## `swap-prereg-1` — the first swap run is pre-registered: terra vs incumbent, one judge family (2026-08-15)

`docs/SWAP-TEST-PREREG.md` freezes run 1 of the offline battery: candidate
gpt-5.6-terra (Azure, credits) vs incumbent google/gemini-3.6-flash, chat
lane only, gates D1→D5 in order with the 10 pp margins and n≥300 from the
protocol. The commit introducing that file is the timestamp; later edits are
amendments and must say so.

Two judgment calls made here rather than in the protocol:

- **One judge family, not two** — a pre-registered deviation. The two-judge
  rule guards same-family affinity (measured once: grok-4.3, 16× own-family
  favoritism). The anthropic judge family is disjoint from BOTH arms
  (google incumbent, openai candidate), so that failure mode has no path in
  this pairing, and the second ~$400 family would buy protection against a
  confound this run cannot express. Does not carry to any run where an arm
  IS anthropic-family.
- **Terra's judge failure (54.2%) does not taint its candidacy** — judging
  competence and being-judged are different roles; the battery exists
  precisely to score candidates that have proven nothing.

Spend: generation + D1 on credits now; judged gates wait for owner approval
of the single ~$400 family (the `d2-on-credits` reversal, already fired).

**Reverses if:** WS-CANDGEN finds the archives cannot supply ≥2,000
byte-identical served prompts (then the prereg is amended, committed, before
any run), or the owner declines the cash (then the run stops at D1 and says
only what deterministic axes can say).

---

## `swap-prereg-amend-1` — archive replay is dead; paired fresh generation through the real compiler (2026-08-15)

`swap-prereg-1`'s named reversal condition fired within hours, before any
run: WS-CANDGEN measured the archives and found NO stored served prompts at
all (charm-grok/charm-luna keep `{user, reply, usage}` plus one shared
persona string; realtime-azure has no chat-lane data), a 288-distinct-turn
ceiling, byte-identical count zero. The bake-off rigs were ad-hoc dialects
that never touched src/engine/compiler.ts.

Amendment 1 (in docs/SWAP-TEST-PREREG.md, committed before any confirmatory
data): both arms are generated fresh from ≥2,000 distinct contexts compiled
by the REAL engine, same bytes to both models — byte-identity across arms by
construction, which is the identity the comparison needs. Strictly stronger:
the claim under test is the relational engine's identity-carrying, and now
the engine itself compiles the test. Costs the incumbent arm's generation
(free Gemini daily pool, paced so production never starves; OpenRouter
overflow ~$0–30 cash, already priced).

Kept from WS-CANDGEN regardless: the terra client with quirks baked in,
resumability, the smoke proof (25/25 non-empty, words/turn median 19.0 —
in-band), and the projection method (~21.6M tokens/arm, credits).

**Reverses if:** the compiler-driven corpus cannot reach 2,000 distinct
(stimulus, compiled-state) pairs without repeat-sampling collapse — then the
run reports at the n it honestly has, labeled as such, and D1-only claims
are scoped to that n.

---

## `judge-cash-approved` — the owner approves the ~$400 premium judge (2026-08-15)

Verbatim: "yes approved for the 400$ judge, use it and continue". The
d2-on-credits reversal is now funded: one premium judge family in cash.
Qualification order: backtest BOTH anthropic/claude-opus-5 and
anthropic/claude-opus-4.8 via OpenRouter (~$1 each at the live $5/M-in
$25/M-out rate, fetched 2026-08-15 from openrouter.ai/api/v1/models) against
the archived blind verdicts, pick the best that clears 80%. Note the
epistemics honestly: the archived ground truth WAS produced by opus-4.8, so
its own backtest is test-retest reliability (self-agreement across time and
sampling), while opus-5's is a real cross-model agreement measure. Either
clearing 80% is informative — fab-noise-floor showed 13.6pp spread on
byte-identical input, so even self-agreement at 80%+ is not a given.

## `beyond-meera` — the research layer must be product-agnostic (owner directive, 2026-08-15)

Verbatim: "we need to create something which will enable us to do more
things using it and we wont be just sticking to meera only but the
fundamental research we are doning should be scalable and flexible for other
usecases as well. and thats why i'm approving 400$". This was already the
thesis (graph: "Meera is instance one") — now it is a funded directive with
teeth: infrastructure built for the swap test (judge qualification, battery
runners, corpus compiler, gate machinery) must not hardcode Meera
specifics where a parameter would do. Not a rewrite mandate — an audit lens
for every new piece and a generalization pass where it is cheap.

**Reverses if:** generalization measurably costs Meera quality or speed
(the standing never-trade-away rule outranks it) — then the specific
generalization is dropped and the conflict logged here.

---

## `generalization-audit` — the beyond-meera map exists; two structural items named (2026-08-15)

Full map in docs/GENERALIZATION-AUDIT.md. The short version that should
survive compaction: the router/gate machinery and the vy_ schema are already
person-generic (a second AI person is config + fixtures away); the compiler
is one static persona import away from a seam; the battery mechanism is
universal but its rubrics and word lists name Meera and Hinglish. The two
STRUCTURAL items — where reuse is real work, not string edits — are (1) the
Hindi-specific relational-health dimensions (tu/tum/aap honorific CHECK,
code-switch-under-stress, and their derivation code), and (2) the legacy
meera_log layer the citation chain anchors to. No rewrite is scheduled by
this entry; it prices future ones.

**Reverses if:** a second-persona build finds the map materially wrong —
then the audit is re-run and this entry superseded.

---

## `judge-grant-only` — the $400 is grant burn, not cash; the owner said so twice (2026-08-15)

Correction of `judge-cash-approved`, in the owner's words: "why that 450$ we
cant use from openrouter only from the azure/foundery 5k$ grant.!!" The
approval was always ~$400-equivalent FROM THE GRANT. No further cash spends;
the ~$1.80 OpenRouter backtest fragment is sunk.

Re-verified 2026-08-15 with sources, because it was load-bearing: Claude IS
on Microsoft Foundry now (GA 2026-06-29, Opus 4.8 + Haiku 4.5 via Messages
API) but is **Marketplace/CCU-billed and NOT eligible for Microsoft for
Startups credits** — Microsoft Q&A threads and a March 2026 Register story
document the exact trap: credit balance untouched while the card on file is
silently charged. `credits-partner` stands confirmed. **Do not deploy Claude
on this Foundry resource.**

Revised qualification plan (bar unchanged, ≥80% vs archived verdicts):
backtest the premium "sold directly by Azure" models — credits-billing class
evidenced by grok/DeepSeek-Flash on this resource:

- **Family-disjoint from both arms** (preferred, prereg logic intact):
  DeepSeek-V4-Pro, Mistral-Large-3, command-a-plus-05-2026 (Cohere),
  Llama-4-Maverick.
- **gpt-5.6-sol** (frontier reasoning) as the premium fallback — shares
  the openai family with candidate terra AND with charm-luna's candidate,
  so its charm-luna backtest cell directly measures its own-family
  favoritism the same way grok-4.3's did (16×, caught). Qualifies only with
  that bias measured and disclosed; prereg amendment required if used.

Owner clicks needed: deploy the five above in Foundry (same flow as
previous deployments). Backtests cost pennies of credits each.

**Reverses if:** every credits-billable premium family fails the 80% bar —
then the honest options are a held-out-validated rubric adaptation (overfit
risk pre-registered) or the D-battery reporting deterministic axes only,
and the owner decides.

---

## `relational-wedge` — the strategy re-rank: own the relationship layer, wedge with the shared friend (owner decision, 2026-08-15)

Owner approved all four recommendations verbatim ("okay lets do 1,2,3,4
all"), with build order and constraints in their words: "1st we need to
build to a level that users can instantly sense the value and love the
product", integrations (Discord/Telegram/WhatsApp) are for distribution
after the product is loveable, "our internal structure and system should be
amazing", more-than-text functionality comes later, and the swap run
proceeds capped: "only use the 400-500 credits only and create really good
evals that we could actually publish and a paper that we could actually
publish and use the foundery grant for this only."

The re-rank (supersedes emphasis, not work):

1. **"Any model → same personality" is dead as a product claim.** Our own
   instrument killed it (terra-arm-2304: model sets the ceiling). The swap
   machinery is now internal QA, insurance, drift defense, and a
   PUBLICATION — not the roadmap's center.
2. **The durable asset is the relational state layer** — model-complement,
   not model-substitute: citations, honest forget, rel-state, India schema,
   multiparty. Gets MORE valuable with continual learning, near-zero
   tokens, faster models (labs' learning lives in their weights:
   unexportable, unauditable, un-deletable — we are the system of record
   that feeds any brain).
3. **The wedge: multiparty shared-memory companion** (couple/group/family
   common friend), Telegram-first per the WhatsApp verdict. Novel
   (structural-disclosure research done), Indian (group-centric), and
   self-distributing (groups invite; groups don't churn like individuals).
4. **Business model: the group is the paying unit** — amortizes the heavy-
   user cost problem (₹2,260/mo heavy user vs pooled willingness-to-pay).
   B2B (customer-memory for Indian SMBs) is logged as expansion, not now.
5. **Swap run 1 continues under a hard cap** (~$400–500 grant-equivalent,
   prefer Foundry; sol-when-quota-clears is the preferred judge, AWS
   Bedrock the fallback inside the same cap) and its deliverable is now
   twofold: the gate verdict AND a publishable paper + releasable eval
   suite. Two papers identified in the logged data: (A) identity-ceiling
   under byte-identical relational context; (B) LLM-judge unreliability on
   code-switched affective register (six-judge failure corpus is already
   data-complete).
6. **Meera stays instance one** — register perfected on the best available
   model, not averaged across bad ones.

**Reverses if:** the multiparty pilot shows groups do NOT retain better
than 1:1 (the wedge's core assumption), or a lab ships cross-person shared
memory with real privacy walls (the "labs can't build this" premise), or
the adapter loop cheaply lifts arbitrary models into register-band (which
would resurrect swap-as-product).

---

## `multiparty-v1-design` — the shared-friend design is judged and accepted (2026-08-15)

docs/design/PROPOSAL-MULTIPARTY-V1.md (WS-MPDESIGN, coordinator-reviewed).
The three load-bearing calls, accepted:

1. **Disclosure defaults to the room, not the person.** Value flows
   room→room and room→your-own-DM (recipient was present for every cited
   episode — zero consent, zero judgment needed). DM→room needs one
   explicit cited grant; DM→DM and cross-room are DISABLED in v1, not
   defaulted off. Privacy is one numbered WHERE predicate before rank,
   never a prompt instruction.
2. **Multi-owner forget = withdraw, not delete**: drop your participant
   row + your authored turns; the ACL is a live join so no derived
   cascade; hard-delete when the last participant leaves. PERSON_TABLES
   gains keys[] + a shared-row spec (also fixes the room-rows-outlive-
   author wipe hole before it can exist).
3. **Group episodes are state-inert in v1** (recall-eligible; no
   rel-state/taste/pattern writes) — whether group register predicts 1:1
   register is unmeasured, and an unmeasured channel does not get to move
   the state layer the shipped product depends on.

Coordinator rulings on its open questions: departed member's material
stays retrievable for co-participants and loses only proactive bridge
eligibility (accepted as v1 default; owner may overrule). ≤6 members
(roster budget). Telegram privacy mode stays ON with per-room admin
promotion as the consent artifact.

Corrections it forced upstream, applied: the "T8-multiparty slot" premise
was a propagated error (SPEC's T8 is taste.rows; the 2000-char intent now
lives as mp.roster 900 + mp.bridge 1100 after T6); the MultiLIGHT
silence-step attribution in measurements.md is amended to an engineering
bet, per the research's own earlier correction.

Build order: Gate 0 (offline prompt-vs-SQL fixture A/B, 0 ACL violations
at n≥300) blocks everything; migration 008 lands in three parts; build
starts AFTER WS-FELT lands (api/memory.js single-owner law). Pilot: "Ten
Days, Three Rooms" on the owner's friend groups, within-subject retention.

**Reverses if:** Gate 0 cannot reach 0 ACL violations structurally, or the
pilot shows rooms do not out-retain 1:1 (the wedge's core bet, also
relational-wedge's own reversal).

---

## `paper-submission-plan` — JUDGe 2026 (NeurIPS) by Aug 29; the paper is drafted around its own refutations (2026-08-18)

The draft is arXiv-submittable modulo owner inputs. Title: "It's Not the
Code-Switching: Six Frontier LLM Judges Fail a Pre-Registered
Qualification Bar in Hinglish and in English Alike." The paper's spine is
its two self-retractions (the favoritism claim killed by a between-judge
control; the code-switching mechanism killed by the translation control) —
presented as the paper's best evidence for its own thesis, since both were
reasonable readings and both were wrong. A wording law is enforced in-doc:
"fails on code-switched affective register" may not appear as a claim.

Venue plan (live-scanned 2026-08-18): arXiv cs.CL → **JUDGe 2026 @
NeurIPS, deadline 2026-08-29 AoE, non-archival, 6pp** (the workshop's own
topic list includes positional bias, construct validity, cross-lingual
reliability — four direct hits) → R3 human annotation + R2 per-axis →
NAACL 2027 Findings (2026-10-12) → CALCS 2027 re-scan in October (no 2026
edition exists; llm-as-a-judge.github.io is a paper list, not a venue —
corrected from the earlier scan).

Before posting, mechanical: de-identification checklist §13.4 must
actually RUN against a built release bundle (D6: the r4 artifacts contain
full transcripts and join the strip list), pre-registration commit hashes
inserted, novelty re-survey. Owner-blocking: author names/affiliation,
R3 annotation decision (owner + one native rater, ~2h, upgrades venue
tier), license sign-off (Apache-2.0 / CC BY 4.0), optional ~$5 R1.

**Reverses if:** JUDGe's non-archival status or dates change on re-check
during submission week, or R3 produces human verdicts that disagree with
the archived ground truth enough to change a headline number — in which
case the paper reports that too (it would be the third self-correction,
and the strongest).

---

## `papers-to-eight` — owner funds the upgrade path; key raised to $25 (2026-08-18)

Verbatim: "ive increased the limit to 25$ for api and make both the paper
really good and atleast 8/10. and keep working on all the things that we
planned." Key verified at $25 limit, $4.86 remaining at authorization.
Spend order set by the papers directive: R1 opus test-retest first (~$2 —
the ground truth's own noise bound, gap G5), then the incumbent arm eats
the remainder via --allow-cash (the $0-30 OpenRouter residue line
d2-on-credits already priced and accepted), pausing when the key dries;
free-pool daily tranches remain the backstop. R2 per-axis decomposition
runs in parallel on Azure credits (gap G8). Multiparty foundation build
(Gate 0 + migration 008) launched now that WS-FELT landed. Human
annotation (R3) stays owner-deferred — logged as THE remaining 8/10
blocker for the Findings version, not the workshop version.

## `self-layer` — growth, texture, untold life and noticing ship as tables, not as claims (2026-08-18)

Phase E made the relational OS multi-tenant. Phase E2 makes what it stores
worth being a tenant of. The owner's list — emotions, vibe, personality,
growth, mood, cultural, attitude, behaviour, ego, sense of self, experience,
taste, style, preferences, observation — was taken literally, mapped against
what already existed, and only the genuinely absent items built.

Most of the list already existed. Four things did not, and one thing on it was
a live bug rather than a gap:

1. **growth** — `vy_self_arc`, ≥3 citations spanning ≥42 days as CHECK
   constraints, non-affective by construction. This is the one that had to be
   argued rather than built: `inner.ts` G5 forbids an accumulating sad period,
   so "add growth" reads as "add the thing G5 forbids". It is not, and the
   distinction holds on every axis that mattered — a feeling fused to its
   cause versus a claim about change, nine hours versus months,
   retires-once-voiced versus superseded, serviceable by the user versus
   nothing to fix, and the one the build added: an arc is the only self-state
   whose cause CANNOT fall out of context, because the cause is a foreign key
   rather than a sentence.
2. **experience** — `vy_agent_life` + `vy_agent_life_told`. Fixes
   `life-per-person`: her improvised life was locked against contradiction per
   LISTENER, so two users could be told two contradictory versions of her
   flatmate. Agent-scoping the life fixes it; the told-ledger is what makes it
   feel human, rendered as an anti-join so she never re-narrates and can say
   "I didn't tell you na" to someone who has not heard it.
3. **vibe/style** — `vy_rel_texture`, derived by counting, rendered as coarse
   bands, gated behind a 40-turn floor.
4. **observation** — `vy_observation` at ONE citation, distinct from
   `vy_pattern` because a pattern generalizes and an observation recalls.
   Measured, the pattern path needs three calendar days and three nightly
   passes before anything is usable.

**Deliberately NOT built, and each for a measured reason:** an accumulating
mood (G5/G8 — the value people imagine is already delivered by the thread, the
failure it invites is not); an ego store (folded into taste and the arc, since
a third home for her self-concept guarantees drift); model-generated life
beats (G7's logic one step worse — a life she improvises has DATES to
contradict); any UI for interior state (G4); push-based memory (the escapes
stay query-matched T5 and user-deixis T6); a new appended-last rule (T10 stays
capped at two — position is a scarce resource).

**Two columns ship deliberately EMPTY**, which is the part most likely to be
"fixed" by someone who does not read this: `vy_rel_texture.avoid` and
`.nickname`. Every candidate signal for `avoid` was checked and rejected —
most sharply, reading `meera_forget` would resurrect the exact term the user
deleted, as an avoid topic. `nickname` already has a home in `vy_phrase` with
an origin episode, and a second store is the `life-per-person` shape again.
Both renderers are complete and fail closed so an owner-review writer can fill
them later with no code change.

**Governance, easy to break by accident:** SPEC §5 marks relationship stance,
warmth and felt familiarity NOT CLAIMED — "hypothesis, pre-registered not
asserted". This phase adds five tables and does NOT upgrade that. Growth,
texture and untold life are hypotheses with tables and named reversal
conditions, not evidence that identity survives better.

Budget: TAIL 21,200 of 24,000, headroom 2,800, asserted by the manifest's own
checker. The three new blocks take drop priorities 1-3 — first shed under
pressure, ahead of everything Phase C proved it needs.

**Reverses if:** the arc renders as self-narration in judged runs (a person
who describes her own growth is a person nobody believes — then it becomes a
retrieval bias with no slot); untold-life rendering measurably increases her
self-initiated talk (G2's boundary); texture bands move judged register scores
at all (texture varies rapport, not register, and the register is the
product); or single-citation observations raise recall fabrication above the
`fab-noise-floor`, in which case the ≥2 bar was load-bearing for accuracy and
not merely for generalization.

---

## `memory-field-survey` — three adopts from the frontier, and what we will not copy (2026-08-18)

Owner directive: *"why dont we learn from graphiti, letta, mem0 and other
frontier memory system (specially opensource) and get the best from them and
implement it with our use case ... with no compromises of any kind."*

`docs/research/MEMORY-FIELD-SURVEY.md` (1,090 lines) surveys Graphiti/Zep,
Letta/MemGPT, Mem0, Cognee, A-MEM, HippoRAG(2), LangMem, MemoryBank and
Generative Agents, each with an ADOPT / ADAPT / REJECT call against our actual
tables, plus LoCoMo and LongMemEval scrutinised as targets. Raw notes and the
source ledger in `-RAW.md`.

**Three adopts, in priority order.**

1. **Fix forget's MATCHING layer.** Our forget *propagation* is the strongest
   in the field — hard delete reaching every derived row — but it only ever
   fires on what the matcher selects, and the matcher is **purely lexical**:
   `api/memory.js` builds a regex per stored term and tests it against a node's
   name and summary. Coordinator-verified at `api/memory.js:782-789`. We are
   Hinglish-first, so "my ex" / "woh ladki" / "us waali" are the same referent
   restated across languages, and none of them match a term stored as a name.
   The fix is an LLM hook at **mutation** time — never at recall, which L2
   forbids outright — expanding a forget request into variant rows in
   `meera_forget`, a table recall never reads and no prompt ever sees. **No
   schema change.** Failure posture: fail the RECEIPT, never under-delete.
2. **One nullable column makes us fully bi-temporal.** Graphiti's edges carry
   four timestamps; we carry three. The missing one is `expired_at` — the
   transaction time at which a belief changed. It is recoverable through
   `superseded_by` → successor `created_at`, and **not recoverable at all**
   when a fact is invalidated with no successor, which our schema permits
   because `t_invalid` and `superseded_by` are independent columns.
   Coordinator-verified: legal today, and **0 such rows exist yet** — so the
   gap is latent rather than realised, which is the cheapest possible moment to
   close it.
3. **Make the four recall paths compete, and give facts one hop.** We run four
   retrieval paths concurrently and then CONCATENATE them into labelled blocks,
   so T5's 6,000 chars are spent by arrival order rather than by evidence.
   Graphiti fuses with reciprocal rank before truncating. Separately, we never
   traverse `vy_fact.citations` — we have a bipartite fact↔episode graph with a
   GIN index and the only one-hop expansion we do walks the LEGACY
   `meera_edges` instead.

**What the field does NOT have, three of four claims verified.** Forget
propagation as a field gap is independently corroborated (Graphiti's
`remove_episode` deletes only edges where the episode is first in the list;
Letta's MemFS documents deleted files as recoverable). Disclosure-as-predicate
stands, with two coarse precedents named — Graphiti `group_id` and Cognee
write-scope, both tenancy rather than per-row ACL. Register state and the
told-ledger: no prior art found. One partial exception, named honestly: a 2026
barrier-first repair contract is our shape, arrived at independently, as a
formalism rather than a shipped property. A fifth differentiator we had not
claimed: the citation CHECK constraint, against an audit finding 96% of 2,050
real memory entries were silently system-created.

**Rejected as a target: LoCoMo.** 6.4% key error and a judge that accepts
62.81% of vague-but-adjacent answers. Optimising against it would move us the
wrong way. Mem0's headline numbers are discounted three ways, including that
Zep beats them inside their own comparison table, and both independent audits
of Mem0 are flagged as published by competitors.

**Embedding-first retrieval stays rejected**, on three grounds the benchmarks
cannot see: our corpora are 10⁰–10³ rows per dyad at p50 40 ms, so recall@k is
not the binding constraint; the benchmark judges reward adjacency; and pull-only
*inverts the sign* of what those benchmarks measure. HippoRAG 2's gain over a
fair baseline is real but modest (59.8 vs 57.0 F1).

**Reverses if:** the forget-matcher rate we measure ourselves does not resemble
the published one (the paper is one author on one adversarial surface — the
mechanism is adopted, the numbers are not); or a fusion arm measurably worsens
T5 quality, in which case concatenation was load-bearing for the
matched-vs-background labelling and the labels matter more than the ranking.

---

## `speech-stack` — keep the incumbent, buy an instrument, and stop trusting the pitch anchor (2026-08-19)

The owner sent a PhysicsWallah engineering article on code-mixed Hindi TTS/STT
and asked for "at least 10X better tech than this in terms of performance,
quality, etc." `docs/research/SPEECH-STACK.md` answers it. The article itself
is summarised in `MEMORY-FIELD-SURVEY`-style detail there; what follows is what
we decided.

**Their pipeline solves a problem our primary lane does not have.** They
transliterate romanised Hindi to Devanagari because a text-fed TTS engine
otherwise reads it as English. Our primary voice is Gemini Live — speech to
speech, native audio, **no text-to-speech step on the critical path**. There is
nothing to transliterate. `api/speech.js` is the fallback lane only.

**We already do the equivalent, in a better place, and nobody had written it
down.** `src/voice/liveCall.ts:2465` pins `languageCode: "hi-IN"` on the live
session, with a comment that dropping it "gives up the hi-IN phoneme handling
her Hinglish depends on". That is the live-lane analogue of their front end and
it is strictly better: no round trip, no added latency, no LID errors. The
caveat is that the A/B behind that comment measured pitch range and pause rate,
**not pronunciation** — so the belief is plausible and unproven.

**Decisions.**
1. **Do not build a transliteration front end.** We cannot buy theirs (only the
   LID stage is released); the IndicXlit fallback is ~90%, i.e. one word in ten
   wrong, in front of our weakest lane; and it adds a silent-corruption path to
   the lane with the least streaming headroom. Cost would be ~75–160 ms
   end-to-end, which is survivable — the reason is quality, not latency.
2. **`azure-tts` decides it anyway.** Pronunciation correctness and accent
   identity are different properties and only the second decides whether she is
   her. A front end operates entirely on the first. It could take us 11/15 →
   15/15 and the owner would not be able to hear the difference — or could hear
   it and dislike it.
3. **The pitch anchor is broken as a filter and must stop being used as one.**
   Our shipped lane measures 212–214 Hz; we rejected Azure at 210 Hz using a
   266 Hz anchor. Every future voice comparison is blocked on an ear listen
   until that is resolved. This supersedes the implicit use of Hz as a
   screening criterion.
4. **10× on latency is not available.** 720 ms of the 1,370 ms floor is
   untouchable prefill. The 10× that IS available is in **variance**: target
   p90 at or under today's p50.
5. **Guard her voice mechanically.** Four lanes name it — the cascade TTS
   fallback, the live session, the ack clips, and the native watch engine — and
   two of them cannot be configured. `scripts/verify-voice.mjs` asserts all four
   agree, wired into `verify-release`. This bug already shipped once and was
   reported as "multiple personalities".

**Two unprotected things the survey found, both now named.**
`src/engine/persona.ts:453` instructs her to EMIT mixed-script Devanagari when
the engine is Sarvam — load-bearing for that whole lane (Sarvam's own docs say
romanised input significantly reduces output quality) and protected by no
invariant. And STT is three lanes, all `en-IN`, none chosen deliberately, none
measured, with `persona.ts:391` acting as the error-correction layer in prompt
text.

**What transfers from the article regardless.** Their central finding — the
correct answer is in the candidate beam 99.54% of the time while top-1 is right
92.02%, so the failure is SELECTION not generation — is exactly the shape of
`MEMORY-FIELD-SURVEY` adopt #3, where our four retrieval paths are concatenated
rather than ranked. Their counter-example is the guard rail: `meine` never
appears in the beam at all, and no chooser can fix a recall failure. Their
Unicode result is a measurement law for us: half their apparent spelling error
was an encoding variant the engine pronounces identically, so any pronunciation
eval must normalise before scoring. And their LLM audit kills the shortcut we
might have taken — Gemini 3 Flash left 20.78% of Hindi words untransliterated,
and that is the model family we run.

**Reverses if:** the live lane is measured to mispronounce romanised Hinglish
after all (TEST L1 in the survey specifies the five-arm listen, including one
arm isolating the `hi-IN` pin) — in which case there is no text stage to fix and
the finding is far more serious than a front end would have been; or the ear
listen shows the incumbent voice is not defensible, which reopens the whole
comparison on axes other than Hz.

---

---

## `selflayer-delivery` — the self bundle ships on `op:"recall"`, beside `relstate` (2026-08-20)

T11 `rel.texture`, T12 `self.arc` and T13 `life.untold` had readers in
`compiler.ts` and no producer anywhere (`selfbundle-never-set`). The producer now
exists and it deliberately copies the shape of the one next to it rather than
inventing a transport: `api/memory.js` gains `fetchSelfBundle(person, agentId)`
beside `fetchRelBundle`, calling the engine bundle's `readTexture` /
`loadCurrentArcs` / `untoldFor` with the injected `q` — the same dependency
injection the observation matcher already uses, and required, because those
modules are client-bundled and cannot import `api/_db.js`. It runs concurrently
on the shared `personPromise` and `opRecall` returns `self` on **both** return
paths. It returns `null` when all three are empty, which is what preserves
byte-identity for everyone with no rows.

**The one place the obvious design does not work, and why.** Carrying the bundle
out through `recallForCall`'s return value was the natural reading — that
function already pulls `takeRelBundle` in the same continuation. It fails
because the three call-lane compile sites (realtime pickup, cascade per-turn via
`think()`, native watch) **do not share a call frame**, so a consume-once pull in
the first starves the other two. The self half therefore lands in a device-keyed
holder in `memory.ts`, written unconditionally on every ring fetch. Same fetch,
same continuation, no second round trip, and strictly tighter than the
`relBundleRef` beside it: an unconditional write means a bundle from an earlier
call cannot outlive the fetch that replaced it.

**Reverses if:** a measured recall-latency regression appears on the chat lane —
the three reads are concurrent and share `personIdFor`, so the prediction is
~0 ms against the ~165 ms warm baseline, and a real regression falsifies the
design rather than the tuning. Also reverses, partially, when a **second agent
ships**: `opRecall` hardcodes `MEERA_AGENT_ID`, and the day that becomes routed,
the call-lane holder needs an agent key too or it will hand one agent's texture
to another. That is `agent isolation` reaching a cache, and it is written here
because a holder keyed on device alone looks correct until there are two agents.

---

## `one-sanitiser-two-doors` — a tag-keeping variant that wraps the core rather than forking it (2026-08-20)

`spokenTextKeepingAudioTags` exists because ElevenLabs v3 is the only engine
that *performs* `[laughs]`, and `speech.ts` routes tagged replies to it for
exactly that reason. The plain sanitiser would delete the thing the routing
chose that engine for.

It is **not a second rule set**: it cuts the short `[audio tags]` out, runs every
remaining segment through the same `spokenTextCore`, and puts them back. That
shape is deliberate and it is `age-tier-never-realtime`'s lesson applied one
level down — a second implementation is a second behaviour, and it drifts the
moment a rule is added to only one of them.

The seam is applied at **both** the prep functions and the `elevenFetch` /
`sarvamFetch` doors, so a future caller that skips the prep function still
cannot hand an engine raw text. `api/speech.js` is untouched: the mirrored core
stays byte-identical.

**Reverses if:** ElevenLabs stops performing tags (then there is one sanitiser
again), or a measurement shows the punctuation absorbed next to a tag is
audible.

---

## `honesty-provenance-allowlist` — she may say an identifier only if it was in her input (2026-08-20)

The predicate is deliberately not *"does this look like an email"*. It is: **an
identifier she emits that is not present in her input is invented.** The
allowlist is built from the assembled prompt plus his own words —
**never her own past output**, or one pre-gate fabrication would launder itself
into permanence.

**The reason this shape was chosen over a pattern blocklist is the crisis
helpline.** `1800-599-0019` is a phone number, and a naive "no phone numbers"
filter deletes the single most important thing she can say. Under provenance it
survives **by mechanism**: the helplines are in her brief, so they are in the
allowlist. The negative control is the proof — with the allowlist removed the
detector *does* flag the helpline, so nothing about its survival is a hardcoded
exception.

**Reverses if:** a legitimate identifier turns out to have no input provenance —
at which point the allowlist gains a source, not an exception.

---

## `receipt-ledger-from-transcript` — a pure function, because a table needs a writer (2026-08-20)

She may not claim something arrived that the record does not support. The
obvious implementation is a commitments table. It is not what shipped:
`openCommitments(history)` computes the ledger from the transcript, so there is
**no table, no migration, and no writer that can go dead.**

That is `dead-writers` taken seriously rather than quoted — this repo has five
logged instances, one of them written by the coordinator in the same phase that
logged the first three. A pure function cannot have a missing producer.

A truth the design surfaces rather than hides: `Message.kind` is
`text|photo|callmark|voice|gif`, so **a resume cannot arrive in-band at all.**
For that class the ledger never closes, which is a fact about the product, not a
limitation of the ledger.

**Reverses if:** commitments must outlive the context window — then it needs
storage, and it needs a named first-row owner per `relstate-zero-rows`.

---

## `trace-off-path` — the client is the only writer, and server legs ride the response (2026-08-20)

Every turn is now reconstructible: seven legs, inside-out — ingress, retrieval,
interior, assembly, model, egress, consolidation — into a denormalised spine
(`meera_turn`) plus an append-only `meera_turn_leg`.

**Nothing writes on a reply path.** `op:"recall"` and `/api/chat` *return* their
legs on the response they were already sending (+593 B and ~350 B); the client
buffers and posts them to `/api/trace` on a timer, at turn close, and at
pagehide. `api/trace.js` is the only writer, is never on a reply path, and
therefore **awaits** its write — `telemetry.ts` already paid for the lesson that
a fire-and-forget write after a serverless response silently disappears.

Three constraints forced this rather than taste: `q()` is one statement per
request with no transactions; a serverless function that has already responded
cannot be relied on to finish work; and the floors are 720 ms text / 1.4–1.5 s
live, so an awaited write on-path would be a product regression to buy a
diagnostic.

The spine/leg split is likewise forced: legs arrive from different processes,
out of order, and sometimes twice, so the spine is upserted with
`least`/`greatest`/`+`/`||`/`coalesce` and converges under all three. Verified —
a late, less-informed leg does not erase `lane`, `core_bytes` or `sections`.

**Reverses if:** the runtime gains a reliable `waitUntil`, or a leg appears
whose data cannot be known before the response is sent and cannot be carried
home.

---

## `trace-retention-at-write` — pruning runs inside the writing statement (2026-08-20)

Legs 30 days, spine 90. Enforced by a bounded CTE that deletes ≤200 rows past
the horizon, prepended to every write batch — **not by a scheduled job**,
because `never-scheduled` measured that no scheduled job has ever run in this
repo. A retention policy that depends on a cron nobody has ever seen fire is a
retention policy that does not exist.

**Reverses if:** a scheduled job actually fires here at least once.

---

## `trace-references-not-copies` — row ids, byte counts and hashes; never content (2026-08-20)

The trace stores **no message text, no prompt text, no recalled summaries, no
search query, and none of her interior as words** — only ids, counts, bands and
hashes.

This is `structural-disclosure` turned on ourselves, and the mechanism is
structural rather than a policy: `api/_trace.js`'s `sanitise()` caps every
string at 64 characters and drops content-shaped keys by name, so a caller that
hands it a transcript stores a count of what was refused. A reference also has a
property a copy does not — **it resolves to nothing after a forget.**
`meera_turn` and `meera_turn_leg` sit in `PERSON_TABLES` keyed by `device_id`,
so a wipe takes the trace and an export includes it.

`core_hash` + `manifest_hash` + the per-slot byte map answer every question a
stored prompt would, at roughly 1/200th the size, and cannot leak.

**What it does still expose, stated rather than glossed:** an operator with
`NEON_URL` can see when a person talked, how long their messages were, which
memory rows were retrieved, the shape of her interior, and what she was told.
That is the same surface `meera_tel` + `meera_log` already grant — this adds
structure, not content. The mitigations are the horizons and the **absence of a
read path**: `api/trace.js` is POST-only and contains no `select`, so adding a
viewer must be a diff that *creates* one.

**Reverses if:** a question provably cannot be answered from a reference plus
the row it points at.

---

## `dash-predicate-text-only` — the em-dash ban became a predicate, and stops at the text lane (2026-08-21)

The owner: *"sending '— ' this should never happen this is just very clear to
every user that ai do this."* He is right, and `persona.ts:148` had already
banned it when texting. She sent it anyway.

That is `honesty-by-instruction` on a second axis, and the numbers that settle
it are already in this repo: `gate0-structural` measured prompt instructions
leaking 57–98% where a structural predicate leaked 0 of 31,122. So
`persona.ts` is **byte-unchanged** and the ban is now `stripTextingDashes`,
applied at the `gate()` choke point that both `parseBubbles` call sites already
pass through.

**Text lane only, and the three reasons are independent** — any one of them
alone would justify the scoping:
1. `persona.ts:148` itself ends *"(Spoken calls have their own style rules that
   override these.)"*
2. Three persona rules REQUIRE dashing on the spoken lane.
3. `device-says-arrow-not-dash` measured espeak reading `—` as a **pause**, not
   a word. On a call it is prosody. Stripping it would flatten her delivery to
   fix a problem that does not exist there.

**The ASCII hyphen is untouched, and that is the whole difficulty of the rule.**
`device-seam-closed` negative-tested the greedy version and it DELETED
`1800-599-0019` — the crisis helpline. Only `—`, `–` and a doubled ASCII hyphen
are register tells. Three of the nine new eval cases are that control (the
helpline, her own URL, "e-mail"), each verified to fail under a greedy rule and
pass under the shipped one, because `bold-eats-words` established that
over-stripping is silent in exactly the way under-stripping is loud.

It replaces with a space rather than splitting the bubble: a split would change
bubble counts that the parser cap and the delivery path both reason about, to
fix something that is only about a character.

**Reverses if:** a measured build shows the instruction alone holds at ≤1% on
an adversarial arm at n≥300 with the predicate off — the same reversal
`honesty-by-instruction` carries, for the same reason. Also narrows if bubble
splitting is ever measured to read better than substitution, which is an ear
judgment and has not been made.

**Does NOT cover:** the live speech-to-speech lane, where the model emits the
characters it speaks and no sanitiser can stand (#97), or any surface going
through `api/_surface.js` (`surface-bypasses-parse`).

---

## `proactive-reason-contingent` — she may text first because something HAPPENED, never because he went quiet (2026-08-21)

The owner asked for "random text from her side ... specially after call", and
for the case where she messaged, he did not reply, and the chat is then stuck
forever.

**Half of that is already forbidden here, by a decision worth restating.**
`persona.ts` records the idle nudge being deliberately removed: it fired on
SILENCE — they went quiet with the chat open — which makes her unprompted
message *an unpredictable reward delivered on the cue of not-replying*. That is
incentive salience: it builds wanting without touching liking, and it is the
one shape of proactivity that cannot be made honest, because **the trigger
itself is his inattention**. The note ends "do not re-add a silence-triggered
ping in any form", and NEVER MANIPULATE is one of the invariants that survives
every rebuild.

**So the rule is a test on the TRIGGER, not on the frequency.** She may open a
conversation when something happened in the world; she may not open one because
nothing did. Concretely:

- **allowed** — a call ended (`AFTERCALL_DIRECTIVE`, shipped); a time HE named
  has arrived (`FOLLOWUP_DIRECTIVE`, already shipped); a real new fact or
  culture item exists that is about him or them.
- **forbidden** — a timer since his last message; a timer since HERS; "it has
  been three days"; any predicate whose only input is his silence.

This does answer his actual complaint. A dead thread does not stay dead because
she is forbidden from re-opening it — it stays dead until there is a REASON, and
the background-search work is precisely a supplier of reasons. The difference
between the two designs is invisible in a single message and total in aggregate:
one re-opens with something to say, the other re-opens to be noticed.

**Reverses if:** the owner overrules it explicitly, which is his call to make —
but the reversal has to be recorded here as a deliberate trade, because the
thing being traded is the property the product's trust rests on, not a
preference about frequency.

---

## `search-on-curiosity` — she may look something up because it is INTERESTING, not only because she doubts it (2026-08-21)

The owner, closing the background-search question with a better design than the
one asked about: *"if the idea or Convo is unique and out of scope then AI think
it should be worth searching then do search. because searching could eventually
give insight which can make the whole Convo more engaging and intresting."*

**This dissolves the objection that blocked the original ask.** "Always
searching in the background" would have reversed the pull-only property
(`prodgap-audit`: every tail block ships never-raise-unprompted) AND burned
quota continuously. Searching because the CURRENT conversation went somewhere
she does not know does neither: it is reactive, it is per-turn, and it deepens
the conversation already happening rather than opening a new one.

`SEARCH_DECISION` was a **fact-check** trigger — "a fact you cannot be sure of
RIGHT NOW" — and explicitly excluded opinions, taste and stable knowledge. It
now also fires on a specific subject she does not really know where looking
would let her have an actual opinion instead of a polite one. The test written
into the rule is *"would the next thing you say be better for having looked?"*,
and it says outright that curiosity is a good enough reason.

**The frequency is capped in CODE, not in the brief, and that is the load-
bearing half.** `gate0-structural`: a sentence asking her to be sparing is a
preference; a predicate is a guarantee. Three lookups per five minutes, as a
BUCKET rather than a fixed gap — two genuinely factual questions in a row must
both still be answered, which is the case the old trigger served and must not
regress, while a run of curious turns settles down.

**Over budget degrades into honesty, not into a dropped promise.** A capped
search leaves `ok=false` and `facts=""`, which is the exact state a failed
lookup produces, and the second pass already has a line for it: *"say you
couldn't check right now, casually, and don't fill the gap yourself."* She has
already sent a holding bubble at that point, so anything other than an honest
"couldn't check" would be a promise quietly abandoned.

**Reverses if:** measured search rate at the new trigger exceeds roughly one
turn in five in real traffic (the trace's `search_fire` / `search_capped` events
are the instrument, and both now exist), or if judged replies with facts score
no better than without — in which case the cost buys nothing and the trigger
goes back to doubt-only.

---

## activity-generic-seam — an activity is a fact about the moment, not a mode

**Decided 2026-08-21.** The owner's instruction was architectural: *"There
should be continuity and proper flow between chat, call, screen sharing and
chess... It should be a whole continuous thing only. Nothing should be broken in
between... we will integrate more and more games and more and more activities so
all this should be handled and it should be continuous personality like a real
human."*

So chess did **not** get its own lane. `ActivityState`
(`{kind, startedAt, facts, nameable, waitingOnHer}`) is a fact about the present
moment that rides the SAME prompt, memory and relationship as everything else,
in tail slot T15 at `dropPriority: "never"` and 420 bytes. Adding the next
activity means writing an adapter that produces an `ActivityState` — it does not
touch the call lane, the compiler or the persona.

The shape was chosen against `age-tier-never-realtime`, where a second
implementation silently lost a rule added after the fork and the lost rule was a
minor's romance-register refusal. Screen-share was already a one-off; chess would
have been the second, and the third would have been a third.

**`nameable` is not bureaucracy.** `honesty-provenance-allowlist` treats an
identifier she emits that was not in her input as invented, and a chess move like
`Nf3` is identifier-shaped. Without an explicit nameable set the gate correctly
flags moves that really were played. Every activity with identifier-shaped
content — a move, a card, a word, a score — needs the same.

**Reverses if:** a second activity cannot be expressed as `facts` + `nameable`
without the block growing past its budget or needing rules text she would recite
— at which point the contract is too thin and wants a per-kind renderer rather
than one shared one.

---

## activity-one-derivation — the game is session state, read by one function

**Decided 2026-08-21.** The game is SESSION state (`AppState.game`), beside `messages` and `inner`,
persisted and synced by the writers that already exist. A board held in the
component that draws it is a board the call lane cannot see, and she would be
unable to talk about a game she is visibly playing. That does not read as a
missing feature; it reads as her forgetting something mid-sentence.

**One derivation, two lanes.** `activityOf(state.game)` in `src/state/game.ts`;
chat reads it through `BrainKeys`, the call lane through `compile()`. Two lanes
deriving it separately is the same fork as above, and what would go missing is
`nameable`.

**Mid-call moves travel by `direct()`, never a recompile** — the live prompt is
frozen at connect and `liveAssemblies` is asserted to read 1 for the whole call.
Angle brackets, never square: bracket text on the voice lane is SPOKEN
(`ack-bracket-direction`).

**Reverses if:** the two lanes ever need genuinely different views of the same
activity — a call needing detail chat does not. At that point the single
derivation becomes a lie of convenience and should be split deliberately, with
the shared part named, rather than by one lane quietly growing its own copy.

---

## theme-choosable — light, dark, or follow the phone

**Decided 2026-08-21**, on the owner's question: *"light theme only or you
should be able to choose the theme"*.

Choosable. The argument is specific to this product rather than a general
preference for options: the hours people actually talk to a companion are late
ones, and a paper-white screen at 1am is a physical annoyance. The app was
light-only — `global.css` had zero `prefers-color-scheme` rules.

**Three states, and the third is the mechanism.** `light` and `dark` stamp
`data-theme` on `<html>`; **`system` stamps nothing at all**. The absent
attribute means `system` is not a third palette that must be kept in sync — it
is the media query left alone to decide, which is the only version of "follow
the system" that keeps following it when the phone goes dark at sunset with the
app already open. Paired with `:root:not([data-theme="light"])` inside the dark
media query so an explicit Light still beats a dark OS.

**A mark is not a fill.** `--accent` is read against the ground and must go UP
in dark (5.82:1); a fill carries white on top and must go DOWN. Splitting them
(`--accent-solid`, `--danger-solid`) is what lets the rose lift without turning
the primary button into 3.3:1. In light both halves resolve to the values they
always had, so nothing moved.

**The chrome colour is read back out of the stylesheet**, never duplicated in
TS. A colour written twice disagrees with itself the first time one copy is
tuned, and it surfaces as a status bar that is subtly the wrong shade — visible,
irritating, and very hard to attribute.

**The board follows the theme, not the call.** It used to force itself dark
whenever a call was live. Once someone has explicitly chosen Light, a surface
that repaints because a call happens to be up is the app arguing with a setting
they just chose; the live call chip carries the continuity instead.

**Reverses if:** a measured majority of sessions sit on an explicit choice
rather than Auto — that would mean the OS setting is not actually what people
want here, and the default is wrong.

---

## evals-in-ci — the safety floor gates pushes, not just local runs

**Decided 2026-08-21.** No workflow ran `evals/run.mjs`. The persona invariants
— crisis helplines, never-deny-being-an-AI, NEVER MANIPULATE, spoken register —
plus the honesty gate and the parser cases gated NOTHING on any push. They ran
only when somebody remembered `verify-release` locally.

Found by accident: CI reported green on a branch whose theme suite was failing
by design. Run-level green was the tell.

It could not have run. `evals/trace/run.mjs` imports `api/_trace.js` →
`api/_db.js` → `api/_config.js`, which is gitignored, so a CI checkout died on
an unresolved import before reaching any persona check. `write-config.mjs
--stub` now writes that file with every value empty — a stub rather than a
mocked module, because nothing is granted and an accidental query against an
empty `NEON_URL` fails loudly instead of quietly reaching production.

**Reverses if:** the suite's runtime makes pushes painful. It is ~40s today
against a ~2min APK build, so it is free; if it grows past the build itself,
split the safety floor from the slow batteries rather than dropping the gate.

---

## pickup-carries-the-scene — the call directive states the present moment

**Decided 2026-08-21**, from live testing. Three felt lies had one mechanism:
`CALL_OPEN_DIRECTIVE` said *"(you were doing something)"* with no knowledge of
what was going on — an instruction to invent. Mid-chess she picked up with a
blank "what's up" (the T15 block was in the frozen prompt, but a rule mid-brief
loses to the directive appended last — `prompt-position`); minutes after
checkmating him she claimed to be "reading a book"; and the fence-free
improvisation is the template that produced "our beach photos".

Now `activityPickupLine(activityOf(game))` rides all three directive sites
(live winner, race-loser, cascade greet). With a scene: "that IS your present
moment — come to the phone from inside it." Without one: her OWN small solo
day, and an explicit fence — never anything involving THEM; a moment with them
that you made up is a lie about them.

**Reverses if:** pickups start sounding scripted — the scene clause is factual
input, not lines, but if judged pickup naturalness drops against the old arm,
the fence stays and the scene wording gets rewritten as shapes.

## finished-games-stay-present — RECENT_END_MS and the `over` state

**Decided 2026-08-21.** `activityOf` returned null the moment a game closed,
so she checkmated him, he called two minutes later, and she asked him what
move she should play. Closed sessions now render for 2 hours, marked `over`,
with the winner named in the facts; the tail head flips to "YOU TWO JUST
FINISHED … never a replay". After the window it is the memory layer's job.
2h is a judgment: a call twenty minutes after the ending lands mid-afterglow;
tomorrow it is a memory, not an open topic.

**Reverses if:** she keeps raising finished games unprompted inside the
window — then the window is not the problem, the head wording is, and the fix
is the "afterglow or a grudge IF IT FITS" clause, not the duration.

## exchange-not-move — the poke describes what they did, not what she did

**Decided 2026-08-21.** Her engine answers ~300ms behind his move, so the
debounced "latest move" note always described HERS — she narrated her own play
("she played Nf6, a good one") every exchange on calls. The poke now leads
with HIS move (the one she is responding to, where the salience lives) and
carries hers as the answer. Plus a quiet floor: if he spoke in the last 2.5s
the note re-arms twice then drops — she was abruptly abandoning live
conversation threads to recite move comments. The note wording stopped being
a reaction request: "fold it into whatever you two were talking about, finish
your thought first, or let it pass."

**Reverses if:** she goes silent through whole games — then the drop-after-two
is too aggressive and the cap should rise before the floor shortens.

## her-chess-pace — a held move and a beatable level

**Decided 2026-08-21.** Owner: "her move was extremely fast… don't move like
that" and "she was too strong". The search takes ~45ms; a 45ms reply is the
loudest tell that nobody is across the board. Moves are held for a
position-seeded think-time (0.8–2.2s opening, 1.8–6s middlegame — pacing as a
property of the moment, not randomness). She plays strength 2 as a surface
choice; the engine default stays 3. Level 3's own comment concedes it beats
most casual players.

**Reverses if:** he starts winning every game and says so — then per-person
adaptive strength (the surface already owns the choice point) replaces the
constant.

---

## pickup-context-is-one-helper — direction, recency, scene: one truth for the directive

**Decided 2026-08-22.** Two more pickup lies had the same shape as the earlier
ones: she answered her OWN callback like someone receiving a call (the
directive said "you just picked up THEIR call" on every path), and she greeted
a call two minutes after the last one like the first of the day (nothing told
her the last call had just ended). `pickupOpts()` in useCallEngine now computes
the three facts the directive needs — the live activity scene, minutes since
the last callmark, who dialled — and all three directive sites take that one
bag. Within 15 minutes of the last call the greeting-mood rule is REPLACED by
a follow-up register; on her own callback the opener is a caller's. The
surface's only job is reporting who dialled (App's accept path).

**Reverses if:** follow-up pickups start skipping warmth people actually
wanted (a heavy call deserves a soft re-open even 5 minutes later) — then the
recency clause needs the last call's TONE, which the inner/affect layer holds,
not a shorter threshold.

## wyr-deal-vs-taste — the deck order is session-unique, her picks are not

**Decided 2026-08-22.** "Same questions are coming": the deal was a pure
function of the salt, so every fresh session dealt the identical order to the
same person forever. Split the two randomnesses by what they MEAN: the deal
seeds from salt+startedAt (a session is a sitting; sittings differ) plus an
`avoid` carry-forward of previously asked cards; her PICKS keep the bare salt
(taste is a property of her, stable across sessions and devices). `avoid` is a
dedicated field because stuffing carried ids into `seen` breaks the
seen/rounds pairing and freezes answering — the eval proves it.

**Reverses if:** the deck grows big enough that repeats stop being felt —
then carry-forward is bookkeeping with no product effect and can go.

---

## gamify-without-the-lever — celebration of real moments, never variable reward

**Decided 2026-08-22**, on the owner's "gamify the whole experience" directive.
The charter (NEVER MANIPULATE, never-scheduled) rules out half of what the
industry calls gamification; the research run confirmed which half users hate
anyway (streak anxiety, loss framing, fake urgency — the regulator-attention
list). What shipped is the other half: REAL progression, made visible.

- The progression system is the relationship record — days, messages, calls,
  games, rituals. Nothing is invented; `engine/milestones.ts` only notices
  crossings, fire-once, largest-tier-only on imported histories, never
  time-scheduled (eligible by time, FIRES on the next real interaction).
- Celebration is FIXED magnitude, forever: identical milestones look identical.
  Scaling intensity with reward size is the slot-machine lever (Balatro's own
  jackpot tier) and was explicitly refused. No screen shake without owner
  sign-off. Not a modal — pointer-events none, auto-settles, nothing waits.
- The Us screen renders the record as an emotional artifact, not a dashboard:
  no locked badges, no aspirational-pressure empty states — day 2 reads as
  warm as day 300.

**Reverses if:** telemetry shows celebrations being dismissed instantly at
high rates (annoyance, not delight) — then thin the tier tables further
before touching the anatomy.

## juice-inside-the-lint — premium feel without loosening a single gate

**Decided 2026-08-22.** The whole juice pass (press squash 1.08/0.92,
seeded micro-rotation, staggers, the particle burst) shipped with exactly ONE
new motion-lint allow (the 520ms burst, citing the two precedents already in
the tree). Everything else is transform-only and ≤230ms. The research was
briefed against the lint's own rules, so the agents implemented within the
gates instead of negotiating with them — which is the repeatable method:
research → constraints-aware brief → build. The eye still caught what
reasoning could not (the burst's opacity peaked at 0.274 under ease-out; the
reduced-motion burst hid behind its own badge).

---

## the-human-game-boundary — chat is her; game mode is a game

**Decided 2026-08-22**, the owner refining the gamify directive after seeing
v1: *"if the chat is gamified much then it loses the whole intent of her being
a human."* The first version fired celebration cards over the chat thread —
"7 days of you two" as a system popup. That is the app speaking in a space
where only SHE should speak, and it breaks the person more surely than any
latency bug.

The boundary, now structural (pinned in evals/milestones.mjs):
- Celebration cards exist ONLY while game mode is open. Games are games —
  there, confetti is the point, and the game surfaces should keep getting
  MORE game-like.
- Relationship moments (days/messages/calls) never surface a card anywhere.
  They mark silently and live in the Us screen's timeline. The human channel
  for them is HER mentioning it in her own words — task #117, a persona
  workstream, deliberately not half-wired as UI.
- A game moment detected outside game mode also goes silent: a stale win card
  popping over chat later is the same violation on a delay.
- What stays in chat: tactile press feedback (a physical property of a good
  surface, not game-ness) and the Us screen behind her name (the messenger
  contact-page idiom).

**Reverses if:** nothing — this is the owner's product thesis, same rank as
NEVER MANIPULATE. Refinements go through him.

---

## `board-stays-lit` — dark theme dims the chess board ~20%, never blackens it

The first night inking dropped the squares most of the way to black and hung
the black set on a 1px light rim. Measured: black piece on dark square 1.27:1,
square-to-square 1.73:1 — the opponent's pieces read as holes in the board.
The re-ink keeps the walnut, dimmed ~20% (`#d4b296`/`#86675a`), landing
black-on-dark ≥3.28:1 and squares 2.59:1. This is also what chess.com and
lichess do: the board is an OBJECT in the room, the chrome is the room, and
only the room darkens. `scripts/check-contrast.mjs` pins the floors (3.0 /
2.4) and the byte-identical-dark-blocks invariant in chess.css and ttt.css.

**Reverses if:** someone produces a genuinely dark board where the black set
clears 3:1 on both square colours by eye AND meter — then the floors move
into the check and the aesthetic is free again.

---

## `chrome-copy-linted` — the em-dash ban now binds the chrome, not just her

`stripTextingDashes` enforced the repo's written em-dash ban on every
generated bubble while product copy accumulated 22 of them — the rule was
binding on the model and optional for the humans. `scripts/check-copy.mjs`
strips comments from `src/components/` and fails on any surviving em-dash
(escape hatch: `// emdash-ok: reason`). **Reverses if:** the design standard
itself drops the ban.

---

## `strip-before-truncate` — storage pressure deletes bytes, then history

The storage-full ladder's first rung was `slice(-400)`: one failed photo
upload stranding a data: URL could silently delete everything older than 400
messages, in a product whose Settings promise is "Nothing on it resets,
expires, or can be lost." Measured: 2,000 real messages are ~10.6% of quota —
message volume can essentially never trip the ladder; a stuck data: URL is
the only realistic trigger. Order now: full-length data:-URL strip first,
truncation only if a clean copy still overflows, `tel("storage_degraded")`
on every rung. **Reverses if:** telemetry shows clean-copy overflows actually
happening (then the promise itself is the problem, and that is an owner
conversation, not a ladder tweak).

---

## `surface-gate-choke-point` — one reply site, fail-closed, per surface file

Every surface lane (Telegram DM, link-tap, group — and whatever comes next)
takes its reply from a single `gatedReply()` and there is no other
`ctx.reply` expression in the file; a bundle with no gate present FAILS
CLOSED (empty text, loud log) instead of shipping ungated words. The eval
asserts the invariant STRUCTURALLY (a scan proving the single reply site,
with injected defects as its own negative control), not just behaviourally.
This closed RelationalOS standing hazard #1. **Reverses if:** a surface
genuinely needs an ungated emission class (e.g. a system notice) — then the
class gets its own named, gate-exempt channel and the scan learns it,
never an ad-hoc second reply site.

---

## `laundering-predicate` — her ungated speech cannot become shared record

Extraction nodes lexically anchored ONLY in her ungated spoken turns are
dropped server-side before any write; his words (any channel), her typed
(gated) turns, and neutral abstractions flow. A predicate, not a prompt
(gate0-structural: instructions leak 57-98%, predicates 0/31,122). Her call
speech still reaches self/inner — that is her own improvised life, not the
shared record, and starving it trades one continuity defect for another.
**Reverses if:** the live lane gains a real output gate (audit option b:
inspect() at onHerText) — then provenance is clean at source and the
server-side filter becomes belt-and-braces or retires.

---

## `moment-available-not-fired` — #117's placement is deliberately mid-tail

The crossed-milestone fact is appended mid-tail, NOT last, on purpose: the
prompt-position law (0/8 mid-brief vs 8/8 appended-last) is used here in
REVERSE. A rule you need obeyed goes last; a fact she should have
AVAILABLE — mentionable once, in her own words, if it fits — must not fire
8-in-8, because mentioning the milestone every turn is the robotic tell
the feature exists to avoid. Fresh for 12h, then zero bytes; joined to the
family-4 support set so the gate treats it as true. **Reverses if:** live
testing shows she never mentions moments at all — then move it later in
the tail one step at a time, measuring, never straight to last.

---

## `ci-secrets-live` — the Actions secrets exist as of 2026-08-22

Owner added VERCEL_TOKEN, OPENROUTER_KEY, NEON_URL, GOOGLE_KEY(S),
SUPABASE_URL/KEY, AZURE_ENDPOINT/KEY as repository Actions secrets
(screenshot confirmed). This push to main is the workflow's first run
with a complete secret set — the run's own HAS_* config summary is the
verification, not the green badge (the skipped-job trap is exactly why
that badge lied for nine days once). GOOGLE_PAID_KEY and TELEGRAM_* are
deliberately absent (unused paths). **Reverses if:** a secret is rotated
without updating here — the HAS_* summary in any run is the live truth.

---

## `stance-lapses-record-stays` — rupture is two truths, not one flag

THAT a rupture happened is permanent history (vy_rel_event, cited,
never deleted). That she is STILL HOLDING IT OPEN is a stance, computed
at derive time: open until 21 days or 8 warm episodes pass since the
record last moved, then settled — "that fight last month", not "we are
mid-fight". No schema change; the projection reads existing timestamps.
Same split inner.ts already used for Thread.text/carry(), applied where
rejected.md#rupture-never-closes said to apply it. **Reverses if:** live
testing shows 21d/8-warm lapses too fast or too slow — the constants
are named and the eval pins the boundary, so retuning is one edit.

---

## `chat-tail-over-flush` — T-H3 chose carrying words over racing a model

The pre-call flush option (await extraction at connect, time-boxed) was
rejected on MEASURED grounds: rememberFrom is an LLM appraisal pass an
order of magnitude slower than any acceptable pickup box, so a ~400ms
race expires on nearly every call — cost with no effect — and a stretch
with no extractable fact (most stretches) would still be lost. Instead
the last <=6 typed turns (30-min window, 900 chars, whole-row drops)
ride the memories block into the ONE frozen assembly: 16.6us per call,
zero awaits, liveAssemblies still 1. Cascade is deliberately excluded —
toTurns already carries the last 90 messages there. **Reverses if:** a
sub-100ms local extraction ever exists — then (a) becomes free and
carries structure the verbatim tail cannot.

---

## `teardown-coverage-check` — a new AppState field must face the teardown

Four fields in a row were added to AppState and forgotten by "make her
forget you" (game, callback, tally/momentsFired, recentMoment) — each one
a person who claims to have forgotten you while remembering something.
evals/teardown.mjs ends the class mechanically: it parses the optional
keys out of store.ts and the wipe list out of Chat.tsx's teardown, and
fails unless every key is wiped or exempted IN WRITING with a reason
(auth, theme, lastAccountId). A new field fails CI until someone decides.
**Reverses if:** teardown moves out of Chat.tsx — then the parser follows
it or the check converts to a runtime round-trip test, but the invariant
(no undecided fields) survives the mechanism.

---

## `core-ceiling-tripwire` — the 44k core ceiling was a tripwire, and it tripped correctly

The persona-invariants core ceiling has no truncation role
(check-prompt-budget gates the real cap); it exists so core growth is
DELIBERATE. The 20-photo library expansion tripped it (+~750 chars of tag
names that must reach the model to be pickable), the growth was judged
worth it, and the ceiling moved 44000 -> 45500 with the rationale written
AT the check and the margin kept tight so the next unplanned growth trips
it again. **Reverses if:** core growth starts arriving without a written
rationale at the check — then the ceiling freezes and content fights for
space instead.

---

## `native-watch-already-wired` — task #76 was stale paperwork, not a gap

The native Android watch lane HAS fed watch_moment since WS-ANDROID-WATCH
(2026-08-18): SceneReader -> WatchCaptureService.dispatch -> emitShowWake
(blank/private/look-away gated, class name only crosses the bridge) ->
watch.ts -> armMomentWindow/consumeMomentWindow -> POST op:"watch_moment"
-> vy_shared_moment. Proven end-to-end this session: 26/26 through the
REAL bridge listener, real handler, real Postgres, zero residue
(evals/multimodal/native-e2e.mjs, now the only check that the
startWatch onWake argument exists at all). The ticket got re-issued as
"unclaimed" because the lane was never logged to THIS graph — the
"if it isn't logged, it didn't happen" law biting its own tail. The two
stale comments claiming no client call site were fixed. watch_visual
stays unwired BY DECISION (needs a scored claim no lane produces).
**Reverses if:** nothing — this records existence; the supersedes edge
below is the point.

---

## `activity-facts-expire` — a thing she said she was doing is a fact with an expiry

T-H2 closed. Self-facts are classified at WRITE time by a pure shape
predicate (durable VETO runs first — Hindi's present progressive is also
how you state where you live, so "bangalore me reh rahi hu" survives while
"khana bana rahi hu" expires), stamped through the ONE dispatcher every
herLife write already passes, absent-kind = legacy behaviour byte-identical.
Render window: min(3h, the next night) — 3x the longest ordinary activity
in the plausibility table (eval-coupled so neither number moves alone),
night via T9's own crossedNight import so "overnight" has one answer in
the tree. Expired activities are DROPPED, never relabelled: "she is
cooking (yesterday)" is still a claim she is cooking. **Reverses if:** a
lane stops routing writes through the dispatcher (the stamp goes silent —
stated in HONESTY.md as the known blind spot), or live testing shows real
activities she should still be on dying at 3h.

---

## `prosody-reads-hearing-not-feeling` — G1's boundary, promoted to charter

Usage signals (barge-in frequency, turn gaps, hangup latency) may inform
how she HEARS him; they may never write what she FEELS. The mechanical
test (AFFECT-CONTINUITY §3.1, now in inner.ts's charter): a feature is
CONTENT iff computable from one utterance's own waveform/transcript with
no timestamp outside its boundaries; everything else is USAGE, and
inner.thread reads neither. There is deliberately NO InnerOpts field for
any usage signal — a field would be the first half of the forbidden path.
**Reverses if:** a prosody classifier clears >=0.6 macro-F1 on
naturalistic Hinglish AND the audio-floor battery (the design note's own
§H condition) — then content-band prosody, and only that, may enter.

---

## `reply-when-a-human-would` — the burst system's five constants, and why

The multi-message rebuild's policy is one pure entry point
(burstDecide) with a re-arming timer — a single setTimeout can only
encode the answer at the moment it was set, which is how a time-only
wait answers message 1 of 6. The constants, each justified against
something real: COMPOSE_ACTIVE_MS=3000 (a longer pause already reads as
stopped-typing on WhatsApp's own indicator), COMPOSE_ABANDON_MS=10000
(past this he put the phone down; she must not go silent on a draft
she'll never see), continuation ceiling 5000 (a wait bought against
near-certainty of a split burst may exceed a no-evidence wait, never
past where people check if the app broke), BURST_INTERJECT_MS=15000
(DERIVED: below the 25s done-talking ceiling where it would be dead
code, above both continuation ceilings; biased short), SITTING_GAP_MS=4h
for greet-once (every overnight clears it, so new-day-greets-fresh falls
out of the constant instead of needing a calendar rule). A trailing "?"
suppresses continuation signals outright — a question is a completed
act — and that one rule is what makes the negatives clean. Liveness is
an adversarially-pinned BOUND, not a hope. **Reverses if:** live use
shows the interjection arriving too early on slow deliberate typists —
then the ceiling learns from his own gap rhythm like the wait does.

---

## `flags-taken-once-released-in-finally` — the wedge class, ended

replyCycle's recursions became a bounded loop; busy/thinkingChat are
taken ONCE and released in a finally; the inner pass contains ZERO
releases so it cannot forget one; busy is re-taken after deliver() to
close a real race (a burst timer firing in that window started a second
parallel cycle). The structural eval asserts the shape in source — a
missing release is invisible in a diff that contains no releases. This
repo shipped the permanent-silence bug once; the class is now
unrepresentable. **Reverses if:** never — this is the pattern for any
future flag-guarded async chain here.

---

## `sky-is-the-clock` — the world layer's five states and their laws

The app is a PLACE now: five sky states (night/predawn/morning/golden/
dusk) resolved from the same IST clock T9 trusts (one import, no second
clock — structurally asserted), boundaries set from Bangalore's real
solar range, a synodic moon floored at a sliver, procedural stars/
clouds/skyline shipping BEFORE any painting exists (the owner's images
swap in via one variable per state). The control model that survived
the self-review: THE FILL CARRIES THE TEXT, THE EDGE CARRIES THE
COMPONENT — glass follows the sky (dark on dark, light on light), and
the contrast gate measures text-in-panel and edge-vs-sky per state, not
just ink-over-sky (the hole the noon screenshot found). Default theme:
undefined still means system — redefining it would flip a dark-phone
user to paper at 10am on a build they didn't change; "sky" is stamped
forward at onboarding, reversal condition written in theme.ts. The call
screens' reassurance line states only what is TRUE and names memory ON
PURPOSE — the honest counterweight to the competitor's false privacy
claim. **Reverses if:** the paintings arrive and the procedural layer
fights them — then procedural becomes the fallback, never both at once.

---

## `wallpaper-scrims-per-state-and-theme` (2026-08-22, WS-PHASE3)

The thread wallpaper's veil is a token per sky state per THEME, not per
state alone, because the thread's ground text (timestamps, separators,
read-more) is inked in the THEME'S `--ink-dim` while the painting is the
SKY'S — `data-theme` beats the sky, so "light theme at midnight" is a
real rendered combination the world's own tokens cannot express. Every
alpha was solved against the shipped JPGs' decoded pixels with the
constraint set at the brightest decile under light ink (hence dark-night
0.60 but dark-morning 0.91). Bubbles stay fully opaque by construction,
which is why the wallpaper costs zero bubble-legibility budget and zero
per-row paint (one fixed sibling layer outside the scroller; scroll p95
0.994x baseline).

**Reversed if:** the theme model changes so the sky always outranks
`data-theme` (then the per-theme half collapses), or a repaint of the
world paintings shifts the sampled deciles (then the alphas re-solve —
the gate's real-pixel floors will say so, loudly).

## `typing-row-lives-in-the-bubble-rhythm` (2026-08-22, WS-PHASE3)

The typing indicator was overlapping the last message because no
`.msg + .msg` rhythm rule ever matched it — it sat marginless with a
-6px halo bleeding upward (measured -0.7px overlap). The fix is
structural membership, not a patch margin: the typing row participates
in the same adjacency rhythm as any bubble (+13.3px gap), and the
browser battery asserts by bounding box that it can never intersect the
last bubble, at 4 messages, at 300, and sampled 40x across a live burst.

**Reversed if:** the thread's row model changes so typing is no longer a
sibling of messages — the bounding-box assertion travels with whatever
replaces it.

---

## `sky-choice-is-a-veil-not-a-palette` (2026-08-22, WS-SKYFELT)

"I selected Sky and no change": at daytime, sky resolves to the light
palette and was pixel-identical to explicit Light, and a mode whose
selection changes nothing visible is indistinguishable from broken. The
fix keeps the sky-is-not-a-third-palette law intact: applyTheme stamps
`data-sky-choice` alongside the resolved `data-theme`, and only the
thread wallpaper/band veils key off it, swapping to a COLOURLESS veil
(the palette's extreme, #fff/#000) that spends no alpha on its own tint
and therefore clears the same text floors while letting visibly more
painting through in every state (measured luminance-sd 1.4x to 1.76x
over plain). global.css must never branch on the attribute (eval-pinned)
so sky stays a decider, never a palette. The settings helper line goes
live in sky mode and reads the same skyMode() field the screen does.

**Reversed if:** the two-palette model itself changes, or a future
migration makes undefined mean sky (then the stamp's presence semantics
need re-deriving).

## `dark-his-bubble-is-wine-not-alarm` (2026-08-22, owner verdict)

Owner: "the red and black not going together in dark theme." Dark-theme
his-bubble moved from the accent rose to #8e4054 (same lineage, s47->38,
l50->40), which sits with the night blues instead of reading as a
notification. Every ink on it IMPROVED (white 5.09->6.97). The send
control deliberately keeps the accent: it shares the old token but is a
control against composer glass, and the wine measures 2.45:1 there,
under the 3:1 floor. The split is written in the stylesheet with the
numbers. Light theme untouched. A pre-existing light-quote-line 3.38:1
that cannot reach AA without changing the light bubble is gated as a
named ratchet at 3.3 (debt written down, not omitted).

**Reversed if:** the owner's taste verdict changes, or the composer
glass changes enough that the wine clears 3:1 there (then one token can
serve both again).

---

## `replica-self-only` — enrollment starts with the verified living adult (2026-08-24)

The first human-replica product is private self-replication. Ownership comes
only from a verified Supabase user; a device id, body user id, uploaded voice,
or checkbox cannot authorize another person's biometric identity. Activation
requires adult/identity/liveness verification, a randomized live challenge,
granular current-policy consent, an approved VoiceGenome/profile, a ready
provider and passing enrollment/voice/behaviour/memory/provenance batteries.
Public figures, politicians, minors, deceased and third-party subjects, public
sharing, downloadable weights, bulk generation and outbound calls stay closed.
This is both the narrowest lawful launch and the strongest way to build the
consent/revocation machinery before the system has distribution.

**Reverses if:** a subject-rights, delegated-authority, liveness, takedown and
jurisdiction-specific legal program passes independent red-team and counsel
review. Better cloning quality or user attestation alone cannot reverse it.

## `replica-provider-portable` — the person outlives the speech vendor (2026-08-24)

The durable product is separately versioned acoustic identity, delivery,
language behaviour, biography, values, relationships and multimodal identity.
A provider voice id is a disposable server-only mapping from a VoiceGenome.
Hosted Fish/Cartesia/Eleven routes and permissive VoxCPM2/MOSS/ZONOS2/
OmniVoice/Chatterbox candidates compete behind one semantic render contract
and exact PCM stream. Voice and behaviour adaptation remain separate. Training
a foundation model is deferred until a legally owned Hindi/Hinglish corpus and
internal benchmark show that routing/self-hosted adapters cannot meet the bar.

**Reverses if:** one provider wins every required identity, delivery, Hinglish,
latency, deletion, privacy and provenance gate across model updates. MOS, price
or one impressive demo cannot reverse portability.

## `replica-preview-before-conversation` — second-agent recall is blocked (2026-08-24)

Enrollment, calibration and authenticated disclosed voice preview can ship as
a control plane. Replica chat/calls cannot. Although derived relational tables
are keyed by `(agent, person)`, `meera_log`, `meera_nodes`, `meera_edges` and
`meera_forget` are not agent-scoped, and raw log scanning/consolidation
watermarks can cross an agent boundary. A second active conversational agent
before migration 016 would risk recall leakage or one agent hiding another's
work. The clone therefore stays on the existing cascade audio contract later;
`liveCall.ts` is not modified for the preview.

**Reverses if:** the dedicated agent-scope migration backfills explicit agent ids through every raw
writer, reader and sweep, removes compatibility defaults, and the cross-agent
isolation/forget/watermark/lane-parity battery passes. A prompt instruction to
ignore another agent's memory cannot reverse a storage isolation blocker.

## `replica-evidence-private-capability` — originals never cross the app server (2026-08-24)

Replica audio, video, images, documents and archives upload directly to a
verified private object bucket through a two-hour, one-object capability. The
server derives the owner from a Bearer session, creates every opaque object
path, requires current capture and storage consent, and persists no filename or
durable URL. A client SHA-256 is only a declaration: finalization verifies
storage size/MIME then quarantines the object until a worker independently
hashes, scans, separates, transcribes and classifies it. Source deletion
immediately invalidates claims and all derived voice/person versions before
physical erasure is attempted.

**Reverses if:** the storage provider changes. The invariants do not: no public
bucket, no client-selected path, no serverless byte proxy, no processing before
independent verification, and revocation makes derived artifacts unusable
before asynchronous deletion.

## `replica-azure-credit-is-an-eval-budget` — spend on the moat, not pretraining (2026-08-24)

The $2,000 Azure grant funds a capped $1,829 program: noisy transcription,
Direct-from-Azure reasoning/embedding/realtime comparisons, Personal Voice only
after Limited Access approval, bounded A10 open-model inference, private
storage/monitoring and a $200 reserve. It does not fund a new foundation model,
Marketplace models or an always-on custom-voice endpoint. Vyakti owns the
evidence graph, VoiceGenome, relationship/person substrate, calibration data,
provider router and whole-replica evals; replaceable models compete behind it.

**Reverses if:** legally owned data and measured provider-independent results
show a specific foundation-training experiment is the cheapest remaining path
to a named failing gate, with separate funding. A model demo or unused credit
is not a reversal condition.
## `brain-stays-36-flash-reaffirmed` (2026-08-23, owner)

A 75% OpenRouter sale on gemini-3.7-flash prompted the question; the
answer is no switch, for the standing reasons: production pays $0 (free
AI Studio pool — an OpenRouter discount is a discount on a lane we do
not buy), and the brain is a MEASURED choice (the Luna battery), so any
future swap goes through the swap-test harness arm-vs-arm, never
through a price page. Owner confirmed: "keep at 3.6 only."

**Reversed if:** a pre-registered personality battery prefers another
model within the same cost envelope, or the free tier stops serving 3.6.

---

## `sound-vocabulary-closed` (2026-08-23, WS-SOUND)

The sound layer ships as a CLOSED vocabulary in `src/sound/vocabulary.ts` —
five cues (`send`, `receive`, `place`, `take`, `moment`), each declaring the
haptic level it rides with, its peak gain relative to one master, and its full
scheduled span — and `feel(cue)` fires sound and haptic from one call so a
component can never pick an intensity. Every sound is synthesised from
oscillators and shaped noise at play time: zero assets, nothing to license,
nothing to fetch, and the palette is edited by changing a frequency rather than
by commissioning a wav.

Why a table rather than a `playTone(freq, ms)`: this is the same argument
`native/haptics.ts` makes for having exactly three levels. A sensory channel
with no fixed vocabulary is one where nine components each invent a beep, and
the failure mode is not "too loud", it is that the set loses its ranking and
the ear stops attending to any of it. The table is also what the gate can
enforce — a closed set that nothing closes is just a set.

Sound gets MORE cues than haptics and the SAME three levels, because the ear
can tell a piece of wood set on a board from a message leaving your hand and
the hand genuinely cannot.

**Reversed if:** a measured preference test shows people cannot tell two cues
apart (then merge them), or the palette needs a sixth distinct event that is
genuinely a user action and not an announcement.

---

## `sound-default-on-quiet` (2026-08-23, WS-SOUND)

One switch in Settings (`AppState.soundOn`), default ON, where `false` is the
only value that means off — absent means on, so an install that predates the
field changes nothing until someone touches it (`age-tier-never-realtime`).
No volume slider: the mix is decided once, low (master 0.34; the loudest cue
peaks at 0.255 of full scale on a transient tens of milliseconds long), and the
only thing a person needs from that screen is a way to make it stop. A volume
control in a companion app is a thing nobody moves and everybody asks about.

Turning it ON previews itself with the `receive` cue, because hearing HER
arrival is the honest answer to "what will this sound like".

**Reversed if:** the owner or a tester reports the level wrong on real hardware
in a real room — in which case the fix is the one master constant, not a
slider.

---

## `sound-gates-four-and-two-sources` (2026-08-23, WS-SOUND)

Nothing sounds unless all four pass: a user gesture has happened (no
AudioContext exists before it), the toggle is on, no call is live/connecting/
sharing a screen, and the app is visible. The call gate reads TWO independent
sources — `state/callStatus.ts`, published by the call engine, and a flag
`Chat.tsx` publishes from its own `inCall` prop — because the window in which a
call exists is wider than the window in which the engine is mounted, and a gate
with one source is a gate with one way to be stale.

The call gate is not a taste rule. Anything emitted during a call leaves the
speaker, enters the mic, and lands in the echo coefficient the entire audio
floor at `evals/echosim/` is measured against; a defect in the sound layer
would be diagnosed in the voice lane. `src/sound/` therefore imports nothing
from `src/voice/`, asserted on the source, and the existing ringback is
untouched.

**Reversed if:** a native plugin makes OS silent mode readable (add it at the
`registerSilenceProbe` seam — the gate exists and is tested, and is wired to
nothing today), or the echo work makes in-call cues provably free, which would
need an echosim table and not an argument.

---

## `story-notification-scheduled-exception` (2026-08-23, coordinator ruling)

PRODUCT-SUPERIORITY §5(a) says no notification may be scheduled. The
story notification is a ruled exception: the event is not manufactured
by the timer (the story pool changes at those minutes whether or not
the code exists), the time is hers and identical for every user with
zero input from him, the copy is what she posted, one per occurrence.
The §5(c) lint still stands: postAt cannot express a delay or interval,
and the eval scans for repeats/setInterval shapes.

**Reversed if:** any notification fires whose triggering event would
not have occurred without the scheduler, or story notifications are
measured to feel like marketing rather than her (a felt-failure log).

## `forget-receipt-hedges-on-fallback` (2026-08-23, coordinator ruling)

When the mutation-time forget hook fails, the lexical fallback runs and
the receipt is HEDGED, never "done": agreeing to a delete and then not
deleting is the worst failure, but refusing the whole receipt on a
transient model error would make forgetting flaky. done / hedged / none
are computed server-side from summed row counts.

**Reversed if:** hedged receipts are measured to confuse users more
than honest refusal would (a felt-failure log names the fixture).

## `pin-58-to-frozen-snapshot` (2026-08-23, coordinator ruling)

The swap test compares MODELS under identical contexts; both arms stay
on the 2026-08-15 frozen corpus (853 banked incumbent rows + the terra
arm preserved). Snapshot age is a documented limitation, not a flaw;
regenerating both arms would double quota for no scientific gain. The
drift guard hard-refuses any live run that would mix snapshots.

**Reversed if:** the compiled-context distribution shifts enough that
reviewers judge the frozen corpus unrepresentative (then both arms
regenerate together, never one).

---

## `move-voice-one-timeline` — her hand and her mouth are one being

**Decided 2026-08-23**, from the owner playing chess on a live call: she made
her move milliseconds after his, and then two to three seconds later her voice
said she SHOULD make the move that was already on the board.

That is two agents on two clocks, and the fix is three separate things because
the defect was three separate things wearing one coat.

**1. The hold is a table, not a formula at a call site.** `her-chess-pace`
already held her move for 0.8–2.2s / 1.8–6s off the ply count. That covered
chess only (ttt had an unrelated 0.8–2.5s constant), was blind to the position
beyond the ply count — a forced recapture and a wide-open middlegame decision
took her the same three seconds — and lived inside a component effect where no
eval could reach it. `state/game.ts` now owns `chessThinkMs`/`tttThinkMs`:
pure, seeded on (position, session) so a replay agrees with the run it
replays, bounded to [300ms, 7s] for every input including nonsense, with bands
for book / opening / middlegame / endgame / forced and multiplicative
modifiers for check, recapture and the width of the position.

**2. There is no pre-line, and that is deliberate.** A short deliberating line
before the piece lands would be lovely and is unshippable on the live lane:
`direct()` hands text to a model that takes seconds to generate and start
speaking, so a pre-line drafted during a 0.8s opening think arrives AFTER the
move — the defect in a nicer hat. A silent move followed by a past-tense line
is always coherent; a move followed by a future-tense line never is.

**3. Past tense was necessary and not sufficient.** `moveFact` and
`exchangeFact` were ALREADY past tense when the owner heard the defect. What
the note did not say is that nothing is PENDING — and a model whose frozen
prompt said "it is her move" at connect will happily deliberate about a move it
was just told she made. `settledClause` / `tttSettledClause` state the choice
as closed ("her move is already on the board, his turn now"), and
`chessMoveNote` / `tttMoveNote` compose fact + clause so a call site cannot
send one without the other.

**Reverses if:** the held beat starts reading as lag rather than thought — the
owner saying she is slow rather than that she is thinking. The fix would then
be the middlegame band's ceiling (6s), not the floor, and not the determinism.

## `game-notes-ride-a-send-seam` — a note may not outlive its position

**Decided 2026-08-23**, same report. A game note is drafted against a board and
then waits: for the conversation floor, for the breath pause, for the rate
floor, and finally inside `direct()`, which holds it up to 1.2s while she
finishes speaking. Her engine answers within a couple of seconds. So a note
written at ply N could enter the socket at ply N+2.

`noteVerdict(draftedAtPly, session, herVoiceIsLive)` is now the decision, in
`state/game.ts` and therefore reachable from an eval rather than only from a
running browser with a live socket — which is to say, only from the owner's
ears, which is how this was found. Three outcomes: `stale` (the board moved →
DROP, never send late), `hold` (she is mid-sentence → re-draft against the
board as it is then, rather than hand a note into `direct()`'s wait), `send`.
Staleness outranks holding: holding a stale note only makes it staler.

The stamp is internal and never appears in the note's text — bracket-shaped
metadata on this lane gets SPOKEN (`ack-bracket-direction`). What survives the
seam is safe to land a beat late because of the settled clause above; a late
note about a settled position is a small redundancy, a late note about an open
one is the defect.

`pokedPly` now advances only on a committed send, so a held note stays owed
instead of being silently marked narrated.

**Reverses if:** she goes quiet through games because too many notes are held
and then dropped. The bounded re-draft (5 attempts at 600ms) is the number to
raise first; dropping the staleness check is not on the table, because a
comment on a position two moves gone cannot be un-said.

## `maya-rename-display-only` — she is Maya where humans read, meera where machines do

**Decided 2026-08-23.** The rename rides ONE seam — `HER_NAME` in
`persona.ts` (75 references across 16 files follow it, verified zero stray
display literals) — plus twelve static files (manifests, Android strings,
native notification text, landing/privacy copy, titles/og). Internal
identifiers never change: `meera_*` tables, `MEERA_AGENT_ID`, storage keys,
the `meera:knows` event, the `meera-messages` channel, `app.meera.companion`
(install-over-update — a changed applicationId is a second app, not an
update), the domain, wire headers, log tags, asset filenames. Group
wake-names became a SUPERSET (maya + meera + Devanagari forms): rooms that
have addressed her as Meera for months must not go unanswered. The
Telegram/Discord/WhatsApp fallback usernames stay "Meera" because they
double as @-mention matchers for accounts registered under that name.
`public/og-card.jpg` still paints "meera" — owner asset, flagged.

**Reverses if:** an internal identifier rename ships WITH a migration and an
install-over-update proof (never as a find-replace); the bot fallbacks flip
only after the registered accounts are renamed and env vars set.

## `lifecycle-matrix-as-code` — every transition names its carrier or the build fails

**Decided 2026-08-23.** `LIFECYCLE_MATRIX` (`src/voice/callHistory.ts`):
10 events x 5 contexts = 50 cells, each cell a carrier
(assembly/direct/state/silent/na) plus a mandatory written `why` (>=40
chars, gated). `evals/lifecycle/run.mjs` (378 checks, inside verify-release)
walks all 50: a `direct` cell must have a live sender in `useCallEngine.ts`
SOURCE — declared-and-dead fails the build, which is the structural answer
to the dead-writers class. Four cells were dark and got built (game_closed
and game_start mid-call, share_end mid-call, board-settle on pickup during
her think — sent silent so she corrects her stale brief without narrating
her prompt). `IncomingCall` gained `reason: callback|wants` so "call cut at
3:12" renders only when there was a drop to cite. The owner's standing
instruction — "I need not to tell you every time" — is this matrix: a new
overlap defect means a wrong cell, not a missing enumeration.

**Reverses if:** a sixth context or eleventh event arrives that the grid
cannot express — then the matrix GROWS a row, it does not get bypassed; any
transition handled outside it is the defect returning.

## `lane-order-azure-first-attachments` — who answers, in what order

**Decided 2026-08-24.** Brain lanes are a named constant (api/_lanes.js):
text goes gemini-free -> openrouter -> azure; turns carrying attachments go
AZURE-FIRST (owner directive: the grant should carry images/docs; OpenRouter
is cash-dead). `hasAttachments` is true for request-borne images/docs OR an
assembled prompt already carrying image_url parts — without the second half,
Azure-first would fire for a fresh data-URL send and never for the ordinary
upload-then-history flow, which is most picture turns. The Azure lane
defaults to the one deployment this repo has evidence for (vy_gate_run 35;
realtime-azure 5/5 at real frame fidelity; non-reasoning per extract-model's
81% deficit on emotionally heavy beats) and skips cleanly when unconfigured.
Wired and gated, NOT yet measured live — served_by:"azure" has never
appeared in a real trace.

**Reverses if:** a paired incumbent-vs-Azure run at the app's real image
shape shows free-Gemini vision is not worse (then attachments rejoin the
text order); or the grant expires (then Azure drops to last everywhere).

## `no-capacitor-camera-plugin` — the WebView already owns the camera

**Decided 2026-08-24, WS-COMPOSER, ratified.** The camera option rides
`<input capture>`: Capacitor's BridgeWebChromeClient answers it with a real
ACTION_IMAGE_CAPTURE intent and forwards `multiple`. Adding @capacitor/camera
would be a second native surface for a capability we have, and
android/app/build.gradle's own contract says a new plugin method bumps
OTA_NATIVE_CONTRACT — forcing every installed copy to reinstall. Camera
detection asks the pointer (coarse + maxTouchPoints>0), measured because
`"capture" in input` reads false on desktop Chromium 141 and cannot be
trusted to differ on phones.

**Reverses if:** a needed capability (e.g. in-app camera UI, editing) cannot
ride the input path — and then the plugin lands WITH the contract bump done
deliberately, in its own release.

---

## `one-voice-switch` — her voice name gets one writer, not six mirrors and a comment (2026-08-24)

**Decision.** The voice name stays MIRRORED across six lanes — `api/speech.js`,
both `liveCall.ts` literals, `src/voice/speech.ts`,
`scripts/prosody-baseline.mjs` and `LiveWatchEngine.java` — and gains a single
**writer**: `node scripts/verify-voice.mjs --set <Voice>` moves all of them and
runs the full verification on the result. Cache keys carry the identity, so
stale audio strands itself.

**Why not one imported constant.** There is no import that spans the lanes: a
serverless function holding server secrets, a browser module forbidden to import
anything beyond `./level` and `../engine/diag` (the echosim law — `evals/echosim`
builds it standalone on that basis), a Java file, and a Node job. Four
languages. Mirror-and-assert is the house pattern for exactly this shape
(`OPERATIONAL_CORE_CAP`, `MEERA_AGENT_ID`).

**Why the assertion alone was not enough, which is the actual reason this
exists.** `api/speech.js`'s header asked the next person to move the lanes
together; `verify-voice.mjs`'s header answered that a comment asking for
discipline is not a mechanism. Both were right and both missed that the mirrors
had no writer. An assertion catches drift *after* someone ships it — but a voice
switch is made and verified in one session, so the author runs the gate on the
tree they just edited incompletely and it passes on the four lanes they
remembered. On 2026-08-21 that is precisely what happened: four of six moved,
the gate went green, and the owner heard her change voice three days later
(`cache-outlives-the-voice`). **A mirror set editable only by hand is a mirror
set that will be edited incompletely.**

**What it deliberately does not do: pick the voice.** `voice-ears` is the entry
that says numbers cannot; `scripts/voice-samples.mjs` is the blind deck that
lets ears do it. The writer only moves what the ears chose, and refuses any name
not on the live-lane-verified list (`live-voice-roster`) — a name the realtime
model rejects is a call that never connects, not a wrong timbre.

**Verified rather than asserted:** `--set Leda` moved six sites and the gate
reported one name on all six lanes; `--set Autonoe` returned all five files
byte-identical to their pre-switch state, the Java included.

**Reverses if:** the lanes ever become importable from one another — a shared
runtime, or the live lane losing its no-imports constraint — at which point one
exported constant is strictly better and the writer should be deleted rather
than kept alongside it.

---

## `voice-despina` — her voice is Despina (2026-08-24)

**Decision.** Chosen by the owner from the blind six-voice deck
(`scripts/voice-samples.mjs`, labelled A–F in a shuffled order so the list could
not bias the listen); runner-up Leda. `voice-ears` is the standing rule that
this is an ear decision — every measured axis once said switch to Azure and the
ears were right to refuse.

**Executed** with `node scripts/verify-voice.mjs --set Despina` (`one-voice-switch`):
six lanes in one command, `ALLOWED_VOICES` widened additively so a request or a
cached clip still naming Autonoe is answered rather than refused.

**The audio floor did not move**, proved rather than assumed: `liveCall.ts` is
one of the six lanes, so the echosim law applied even for a name-only edit.
80 simulated calls before and after, **byte-identical, same MD5** — every cell
of the floor table unchanged.

**No cache purge**, because `cache-outlives-the-voice`'s fix makes one
unnecessary: identity is in the key, so every Autonoe clip became unreachable
the moment the constant moved.

**Open, and it needs money rather than a decision:** the drift baseline could
not be re-anchored — `prosody-baseline.mjs --establish` needs the paid
OpenRouter lane and the key answers 403 "Key limit exceeded". It was NOT
redirected to the free Gemini pool; that quota is shared production
infrastructure (`free-tts-daily`). The baseline therefore still reads **Aoede,
2026-08-15**, the alarm will fire on the next run, and `verify-voice.mjs` §7b-ii
prints the stale anchor as a note on every run. One command once a key is funded.

**Reverses if:** the owner's ear says otherwise — `--set <Voice>` is the same
one command in either direction.

---

## `identity-wins` — a user key no longer overrides her voice (2026-08-24)

**Decision (coordinator).** Her own voice is preferred on the cascade whenever
it is reachable. Sarvam and ElevenLabs user keys become failover only — below
her voice, above the device engine — instead of automatic overrides.

**Rationale.** The owner's verbatim complaint is her voice changing between
modes. A user key used to flip the cascade, the pickup line and the backchannels
to another vendor while the live lane, the native watch engine and her voice
notes could not follow, so the fallback — the thing that fires exactly when
something has already gone wrong mid-call — was also the moment she became a
different woman. One woman beats better-Hinglish-sometimes.

**Priced honestly:** ElevenLabs is the only engine that can perform an audio
tag, and losing tag performance on the cascade is the cost. Sarvam cannot
perform one at all, so nothing is lost on a Sarvam install.

**Found while implementing, and it sharpens the case:** nothing in the tree ever
WRITES `sarvamKey`, `elevenKey` or `elevenVoiceId` — there is no settings
screen; they are read by two files and set by none (`dead-writers` with the
polarity reversed). But `store.ts` hydrates as a shallow spread over defaults,
so a key written by any earlier build survives every update, invisibly, with no
UI that could clear it. Unreachable in a fresh install, permanent in an old one,
and undiscoverable from inside the app — which is a fair description of the
owner's own year-old install.

**The opt-in UI is a future slice**, named as such rather than implied.

**Reverses if:** the owner explicitly chooses Hinglish quality over voice
constancy for fallbacks — flip `VOICE_IDENTITY_WINS` and the previous
preference order returns exactly.

---

## `watch-exit-returns-to-live` — every exit from the native lane tries to come back (2026-08-24)

**Decision.** All three exits from the native watch lane attempt
`reconnectLiveAfterWatch()`, and `verify-voice.mjs` §7d asserts the property
rather than the call sites so a fourth exit inherits it.

**What was actually wrong.** Task #96 built the reconnect correctly and wired it
to `watch_stopped` and `watch_stopped_externally`. Nothing regressed. It missed
`watch_consent_denied`, because #96 was framed as *"stopping a share must not
strand the call"* and **a denial is not a stop** — the share never started.

Starting a share claims the native lane BEFORE the consent dialog (deliberately:
a queued TTS clip would otherwise surface as a second voice), which kills the JS
live session. Deny, and the call finishes on a different model family in
exchange for a share that never happened. It is the likeliest of the three to
fire — declining a permission dialog is ordinary, and the dialog appears on
every share.

**No lifecycle interaction:** `recordShareEnd` is called only from the two stop
paths and the web teardown, so the deny path emits no `share_end` fact and
nothing can double-send.

**Reverses if:** re-adoption proves audibly disruptive in production — the
handoff goes through `adoptLiveLate`, which defers to a turn boundary, so the
evidence would be `call.lane_change` records landing mid-utterance.

---

## `model-twins-pinned` — a fallback that differs from the primary is the config nobody observes (2026-08-24)

**Decision.** `LiveWatchEngine.java`'s `DEFAULT_MODEL` is now the same string as
`api/live-token.js`'s `LIVE_MODEL`, pinned by `verify-voice.mjs` §7c.

It was `gemini-2.5-flash-native-audio-latest` — measured and rejected for this
lane (`live-model-bake`, 0/24 barge-in) — sitting as the silent fallback on the
one surface where the triple-swap happens, while the JS twin has no fallback at
all. The two disagreed about the model AND about whether a fallback should
exist. A malformed token response now costs a round trip instead of changing
which model family speaks. Distinct models producing her voice: 3 → 2.

The old §2 declaration is kept as a comment, not deleted: an entry's absence is
otherwise indistinguishable from having forgotten it.

**Reverses if:** the live model and the watch lane ever need to differ
deliberately — in which case declare both in §2 and say why in
`docs/VOICE-LANE.md`, which is what §7c's failure message asks for.

## `despina-by-ear` — her voice is Despina, chosen blind, switched atomically

**Decided 2026-08-24.** Owner: Autonoe read "too rural"; wanted hot, modern,
urban. Eight-voice blind deck (A–H, shuffled, mapping sealed — the voice-ears
law), same Hinglish script, same style direction, generated on the fresh
free-pool day (8 paced calls, zero 429s). Owner picked D = Despina ("smooth");
runner-up A = Leda. Switched with `verify-voice.mjs --set Despina` — all six
lanes atomically; echosim before/after byte-identical (MD5 26fc602…); cached
clips self-invalidate (identity now lives in every cache key). Drift baseline
NOT re-anchored (OpenRouter key spent) — the alarm fires by design and the
gate prints the stale anchor until a funded key runs prosody --establish.

**Reverses if:** the owner's ears say so — numbers cannot pick her voice.

## `currentcolor-marks-inline-or-mask` — a currentColor SVG never rides an img tag

**Decided 2026-08-24 (WS-ASSETWIRE).** Marks drawn in currentColor resolve
against the SVG document inside an img — black on all five skies. So: CSS
mask + background currentColor for the wordmark (inherits the exact ink the
contrast gate already proves, @supports-guarded with the text fallback), and
?raw inlining for every other currentColor mark (stats, reply, or-coin,
filetypes, ErrorBoundary — the last one deliberately, so the crash card
needs no fetch at the moment something already failed). src/components/
anim.tsx is the single seam that knows /anim/ paths and makes the
reduced-motion decision. **Reverses if** the marks stop being currentColor.

## `os-first-optimization` — owner directive (2026-08-24), standing law for all optimization work

Three rules the owner set when cost/scale work began, ranking above any
optimization win:
1. **Quality is never compromised.** The goal is human-to-human interaction;
   an optimization that moves felt quality by even 1% is rejected regardless
   of savings. (Consistent with the standing speed/quality directive.)
2. **Changes land at the OS layer by default** — so when the personality
   changes (Maya to anyone else), the work carries over. The OS gets better
   permanently; per-persona rework is the failure mode.
3. **Maya-level changes are allowed where truly persona-specific**, but must
   be logged and documented well enough that the next personality-building
   agent can read what is Maya's and what is the OS's. persona.ts's coming
   core/character split is the structural form of this rule.

**Reverses if:** the owner says so. This node is the anchor future agents
cite when deciding where a change belongs.

## `labeled-key-pool` — owner-tagged keys for RCA, one-way key→label

**Decided 2026-08-24.** Owner supplied ~48 free-tier Gemini keys tagged by
account. Pool entries carry an owner LABEL (env `label~key`, or _config
`GOOGLE_KEYRING:[{label,key}]`); the label names whose key, never the key, and
the map is one-way (key→label) so a leaked label cannot reconstruct a secret.
chat.js records `pool.served_label` per turn and `_gkeys.poolRca()` counts
quota/transient by label per instance — the RCA the owner asked for ("which key
is whose, which one dies"). Switching stays the existing zero-latency in-memory
walk (COOL_MS/SICK_MS cooldowns, bounded retries, paid key last). Keys live only
in gitignored files (keyring.json / _config.js / google-keys.env); all 48
measured healthy on arrival. scripts/keyring.mjs manages rotation; docs/KEYRING.md
is the guide. **Reverses if:** a label ever needs to reconstruct a key (it must
not) — then the scheme is wrong, not the requirement.

**Note (measured 2026-08-24):** the `AQ.Ab8RN6…` key format that 403'd on
2026-08-13 now validates 200 on countTokens — the earlier rejection was a bad
individual key, not the format. 48/48 healthy.

## `personality-is-a-sheet` — the RelationalOS existence proof: two people, one core

**Decided and proven 2026-08-24.** The relational layer (persona.ts,
becoming the Relational Core) owns every interaction nuance; a personality
is a CharacterSheet (29 typed fields) interpolated into it. Kabir — male,
29, Old Delhi bookseller, English-dominant, dry, near-emoji-less: maximally
far from Maya on every axis — was authored as a sheet only, registered, and
passed the ENTIRE per-module invariant floor on the first run: **412/412
checks across 2 registered agents**, while Maya stayed byte-identical
(83/83 fixtures against the frozen oracle) through five extraction batches.
Extraction is scripted (bytes cut and re-interpolated programmatically) so
copy errors are structurally impossible. Builders take the sheet as a
defaulted parameter, so every existing call site is unchanged.

Known v1 gaps, declared: WATCH/SEARCH/FORGET directives still carry a few
Maya example phrases (reused as-is by kabir's module); slot-heads live in
sheet fields rather than core; remaining Maya quotes sit inside MIXED core
bullets. The R3 cross-agent leak guard measures exactly these so further
extraction is evidence-ordered. **Reverses if** authoring a real third
personality still requires touching the core — that is the ongoing test.

## `two-phase-fuse` — slow voice beats no voice

**Decided 2026-08-24, during the speech outage.** api/speech.js keeps the
fast fuse (FREE_FIRST_FRAME_MS=1400) hunting for a healthy-fast key across
the walk, but when the walk ends with no winner and the pool is nonempty,
ONE long-fuse attempt (FREE_LONG_FRAME_MS=15000, slowBudget=1) runs before
the paid lane. Rationale: the measured failure mode was Google being SLOW
(9.7–11.3s first frame), not dead — on such a night the old chain returned
502 with 48 working keys in hand. Verified in production the same night:
200, free lane, 61KB audio at ~13s where the previous deploy 502'd.
Companion decision, same commit: FAMILY COOLING — keys are labeled
`owner-n` with an @domain family; a quota/slow failure cools the whole
family (COOL_MS=5min quota, SICK_MS slow) and a walk-local deadFamilies
set skips siblings mid-walk, so a dead 20-key family costs one attempt,
not twenty. walkKeys gained an additive slowBudget param (default
unchanged). **Reverses if**: the long pass measurably delays the paid
fallback on genuinely-dead nights once a funded paid lane exists (today's
paid lane is dead, so the 15s costs nothing), or Google's preview exits
degraded mode and the p95 first frame returns under ~2s for a month —
then the long fuse can shrink, not vanish.

## `accent-joins-the-sky` — every color on the sky is the sky's to solve

**Decided 2026-08-25** (owner report: hero rose unreadable at morning, web
+ APK). The theme's --accent belongs to surfaces the theme controls;
anything painted ON the sky takes tokens the SKY solves per state — ink
already worked this way, and the accent was the last borrower (2.26:1 on
morning's blue top stop). Each sky state now carries `accent`: the brand
rose hue at the lightness nearest brand clearing >= 4.75:1 against all
four scrim-composited stops, emitted as --world-accent, gated per state
in check-contrast.mjs at the 4.5 body floor. Fallback var() keeps the
theme rose off-sky. **Reverses if** a future sky state cannot host any
recognisable rose at the floor — then that state's hero drops the accent
entirely rather than shipping an unreadable one.

## `residues-zero` — the Relational Core carries no character

**Reached 2026-08-25.** Three extraction batches in one session took the
leak guard's measured Maya-isms in Kabir's lanes from 95 -> 64 -> 27 -> 0,
with Maya byte-identical (83/83) after every batch. 32 example-fragment
fields now live in the CharacterSheet contract; WATCH_MODE_NOTE became
buildWatchModeNote(C) (constant = builder(MAYA), so all call sites kept
their bytes), closing kabir.ts's declared v1 gap. The ratchet is pinned at
0 forever: character prose in the core is now a build failure, not a
backlog. **Reverses if** never — this is the definition of the OS/character
boundary from here on; a legitimate need for character text in core means
a new sheet field, not a ratchet bump.

## `never-internals-floor` — the sixth floor category

**Decided 2026-08-25**, from a live incident: asked "which ai you are
gemini or chatgpt?", she answered "openai ka gpt-4o hu" (screenshot in
session log). Root causes both real: (a) the resilience ladder legally
serves non-Gemini lanes (OpenRouter/Azure) when the free pool is down —
accepted so she never goes silent — and (b) models hallucinate identity
claims regardless of what actually serves. Neither may ever surface: a
vendor/model claim breaks the one-identity law on every lane at once and
cannot be untold, which is the floor-category admission test. The block
lives in the never-truncated core beside AI-honesty and Crisis, pure OS
(no character content), framed as "you genuinely have nothing there", with
playful in-register deflection and the jailbreak costumes named. Gated
per-registered-module on 4 lanes. **Reverses if** never for the rule; the
DEFLECTION SHAPE may be tuned per measured felt-quality. Follow-up filed:
a behavioral jailbreak battery (model-in-loop, needs budget) to measure
hold-rate under real attack phrasings; the structural floor ships first.

## `session-2026-08-25-close` — launch wave state at compaction

Owner decisions this close: Play Store requisites DEFERRED (their words:
"we don't have user-level logins and all, so much to do there" — the
submission pack, signed-.aab CI, deletion page and screenshots all sit
ready in docs/playstore/ + delivered files for whenever they resume).
Everything shipped this session and its evidence lives in the entries
above: residues-zero, never-internals-floor, accent-joins-the-sky, the
three pin-ambient-inputs gate fixes, WS-OBS, keyring 51, openrouter
per-key-limit correction, PR #3 merged to main, PR #4 open+green.

THE MODEL STACK, recorded verbatim for the next session (from code, this
commit): chat text = gemini-3.6-flash (free pool, 51 labeled keys, $0);
chat fallback order gemini-free -> openrouter (same gemini via OpenRouter,
~$14 credit, ~$0.0015/turn at 52KB) -> azure grant deployment
grok-4-20-non-reasoning ($0 cash, $2k grant; also FIRST for attachments).
Speech TTS = gemini-3.1-flash-tts-preview free pool ($0, ~4-5 clips/key/
day), paid fallback google/gemini-3.1-flash-tts-preview via OpenRouter.
Live calls = gemini-3.1-flash-live-preview (free pool mint, no same-kind
fallback — degrades to the cascade). Consolidation audit =
google/gemini-3.6-flash via OpenRouter. NOTE: gpt-4o is in NO lane —
the incident was a hallucinated self-claim, now floored. gpt-5.6-terra
is qualified as a RESEARCH JUDGE only (#57), not a serving lane: swapping
a serving model changes the felt personality (the terra swap-test
program, #51-58, exists to measure exactly that before any such move),
and terra costs real cash per turn against a $0 grant lane.

## `ws-gamefeel` — tester defect wave (friend, 2026-08-25) + the layer split

Reported by the owner's friend after real chess + call sessions. Charter
recorded pre-fix so the wave survives compaction. LAYER TAG on each item
per the owner's standing rule (OS = carries to every persona; APP =
Maya's app/engine surface only):

1. [OS+ENGINE] "kya idea hai" repeated for a whole game + same-question
   loops on calls generally: she has no self-repetition guard. Fix: a
   her-side loop fence — runtime detector on the cascade/call turn path
   (never inside liveCall.ts) that catches a near-duplicate of her own
   previous turn and forces variation, plus an OS core shape (a repeated
   line is a stall, not a style).
2. [ENGINE] "mai bhul gayi" when asked about her own play: she genuinely
   has no material — the activity note carries board truth but not HER
   INTENT. Fix: the activity note gains a one-line idea for her current
   plan (opening name + what she's trying), refreshed as the game moves,
   so game talk has a real substrate. [OS] shape: her play always has a
   sayable idea; "bhul gayi" is never the answer about the game on the
   board.
3. [ENGINE, gating] False checkmate mid-game + last-game bleed: terminal
   claims must be board-derived only — she may not say checkmate/stalemate
   /win/loss unless the engine state says ended (a structural fence like
   the honesty gates, not a hint). Previous games reach her only as
   memories, never as the present board.
4. [ENGINE] Deterministic openings — same exact moves every game: her
   move choice needs book variety (seeded randomization among sound
   moves) so two games don't teach her pattern.
5. [ENGINE+OS-memory] Adaptive strength: start friendly, scale with the
   user's demonstrated strength — within a chess game (engine level up on
   strong play) and across games (a per-user strength estimate stored in
   memory, read at game start). The estimate is OS memory (any persona's
   games use it); the scaling is engine.
6. [DIAGNOSE] General call hallucination/forgetting: ride #115's
   instrumentation; the loop fence (1) and idea substrate (2) are the
   structural halves already known.

## `ws-gamefeel-shipped` — the wave closed same-day, with two learnings

**2026-08-25.** Both halves shipped (OS commit + engine commit), all six
charter items structural: STATE_LAW fence (terminal claims are the state
line's alone; past games are memory), her sayable idea line, flavour-
weighted opening variety, adaptive strength (friendly start, one-way
in-game climb, EMA estimate on the finished-activity ledger), and the
her-side loop fence (detect on completed reply, arm next turn unstreamed,
one retry). Learnings worth keeping: (1) a UNIFORM draw among near-best
moves produced legal-but-alien openings (Na3 Rg1 Rh1) — variety must be
weighted by the flavour score the engine already computes, or "varied"
reads as "not a person"; (2) a streamed line cannot be un-said, so
repetition fences on streaming lanes pay their cost on the turn AFTER the
offence, never the turn of it. Known edges, accepted: Jaccard 0.8 misses
paraphrased loops (one constant to lower if felt), skill estimate is
device-local (reinstall opens friendly — the right failure), idea line is
chess-only (ttt has no plan worth a line). Reverses per item if the felt
tests say the boundary moved.

## `paid-lane-off-by-default` — billed spend is opt-in, twice (2026-08-25)

The paid Gemini key rides a flag-gated lane: PAID_LANE must be explicitly
"1"/"true" AND the key must exist; either missing and laneOrder returns
the pre-existing frozen arrays by identity. Order when on: free pool >
paid > OpenRouter > Azure. Rationale: the free pool is $0 cash and
serves current volume; the paid lane exists to be measured and to absorb
scale deliberately, never by accident. Chosen cost path: explicit
cachedContents on the per-user core (−79 to −80% measured incl. storage)
— implicit caching alone tops out at −46% EV (see cache-plateau).
Reverses if: free-pool exhaustion becomes a daily user-facing event
(flip the flag), or Google's implicit plateau moves above 90% (explicit
cache machinery becomes dead weight).

## `cost-frontier-map` — where each 10x lives, decided before it is needed (2026-08-25)

Owner asked what gets Rs 21/100 msgs to Rs 1-2 without quality loss. The
measured map, logged so the scale conversation starts here instead of
re-deriving: (1) API-rental floor is ~Rs 10-12/100 — core toward the 40k
SPEC target (gated on the n>=300 equivalence run), tail tightening,
volume rates; Google's published rates double 2027-01-01. (2) The 10x is
architectural: resident relational state — self-hosted serving with
per-user prefix KV cache (vLLM/SGLang class), so a turn pays only the
~1.3k-token tail + output; ~Rs 0.01-0.03/msg at saturated GPUs. Two hard
gates: an open model must pass the swap-test battery first (unproven
today), and it only wins above roughly a few hundred thousand msgs/day —
below that the GPU idles and API rental is cheaper. LoRA-per-persona
(personality in weights, state + safety gates staying in the auditable
prompt) is the further step, with the recitation/position laws re-tested.
Not scheduled — a decision map, not a workstream. Reverses if: a hosted
provider ships per-user persistent KV at API prices, or the swap-test
shows no open model within quality floor by the time volume arrives.

## `paid-flip-gate` — what must happen before PAID_LANE turns on (2026-08-25)

The explicit-cache path ships OFF (PAID_LANE off; PAID_CACHE within it
defaults on because it cannot cause spend, only shape it). One wire
difference is unmeasured for persona quality: Google's native surface has
no system_tail field, so the volatile tail rides as a LEADING USER-ROLE
content instead of a system block (order preserved, no fake model turn).
The flip gate is a paired dual-judge equivalence run (same bar SPEC §0.3
sets for persona cuts) comparing compat-surface vs native-surface serving
on byte-identical compiled contexts. Until that run passes, the paid lane
may be flipped in an emergency (free pool dead) — a served turn beats a
perfect one — but not as a cost optimisation. Reverses if: Google adds a
system-role tail slot to cachedContents generate calls, or the
equivalence run shows no measurable difference.

## `resident-gpu-at-scale` — the committed direction for scale cost (2026-08-25)

Owner directive: the self-hosted resident-KV path ("stop re-sending the
relationship, make it resident") WILL be done when scale justifies it —
target ₹0.01–0.03/message vs the API floor of ~₹0.10–0.12. Funding
candidates: AWS $1k grant, Azure grant headroom. Two pre-registered
gates stand unchanged: an open-weight model must PASS the swap-test
battery as Maya (unproven today), and traffic must saturate the GPU
(below ~a few lakh messages/day the API is cheaper). Google's Jan 2027
price doubling strengthens the case. Reverses if: frontier API pricing
collapses below saturated-GPU economics, or no open model passes the
battery by the time scale arrives.

## `judge-bar-vs-ceiling` — OPEN: every available judge family now fails 0.80 (2026-08-25)

State after the opus-5 re-run: all 8 judge families tested, none clears
the SPEC §10-Q5 0.80 bar; qualified_panel stays []. opus-5's CI
[59.1, 77.8] CONTAINS the measured ground-truth ceiling (~77.1%) — a
clear fail against the committed bar while statistically
indistinguishable from the best any judge has scored on this bench.
ground-truth-ceiling pre-registered that the bar "should be restated
relative to measured ceiling"; that restatement is deliberately NOT made
today, because it would be made minutes after seeing the number it
unblocks, by the party that wants the run. If the bar changes, it changes
PROSPECTIVELY: re-registered before a fresh backtest on fresh ground-truth
units, ideally owner-blessed. Meanwhile three judge-free/judge-new paths
stand: (1) deploy an untested family (gpt-5.6-sol / Llama-4-Maverick, one
Foundry click, credits-billed backtest); (2) owner blind-judges a 30-40
pair sample (the felt product's ground truth IS the owner); (3)
deterministic differential on the 150 pairs (markers, lengths, lexicons,
behavioral graders on both arms) — catches gross degradation without any
judge, insufficient alone for "reads like the same person".
Reverses when: a judge clears whatever bar is then in force, on a
pre-registered run.

## `owned-product-first` — strategy reweight after owner pushback (2026-08-25)

Owner's read, adopted: tech-first platforms (AstroTalk-class) will default
to building in-house in the AI age — selling tech integration to the
tech-enabled is the weakest lane, and B2B sales cycles are the wrong
spend for a solo founder. Strategy reweighted to OWNED products:
(1) NRI elder companion — the one use case where heavy calling is
cost-justified at today's API prices (payer earns USD, pays ₹1,499–2,499
vs ₹400–600/mo COGS for daily calls; memory IS the product; ad channels
open because it's elder-care, not "companion"); (2) global diaspora
pricing (Maya at $10–20/mo abroad; Hinglish is a moat outside India —
35M diaspora, no incumbent) + spoken-English partner (category exports:
Stimuler is 40% LatAm); (3) B2B only opportunistically to NON-tech
businesses; (4) India mass ₹600 waits for resident-GPU. Reverses if: an
inbound B2B deal prices above the owned-product opportunity cost, or the
elder wrapper's felt-quality bar proves harder than Maya's (elderly
users, Hindi-first, higher safety sensitivity — needs its own testing
wave before launch).

## `memory-asks-first` — consent is a product feature, DPDP is the deadline (2026-08-25)

Memory now begins with her asking ("Should she remember you?"), a real
decline path that closes the write gate while she keeps talking, an
append-only server consent record (migration 016, owner applies), and
withdrawal folded into the existing forget flow as one concept. Rationale
beyond compliance (DPDP full effect 2027-05-14): trust is the elder-
wrapper strategy's core sell, and consent done warmly is a differentiator
not a wall. Layer: SURFACE (the gate chokepoint lives in engine/memory.ts;
the persona is untouched — a future personality inherits the screen by
being on the same surface). Reverses if: decline rates in tracking show
the step costs onboarding completion materially (then soften placement,
never the consent itself).

## `session-2026-08-25b-close` — the second session of 2026-08-25, logged

**Shipped and verified (all by exit code, all pushed, all CI-green):**
1. WS-GAMEFEEL both halves — STATE_LAW board-truth fence + her idea line
   (OS), engine substrate (state/idea fields, weighted opening variety,
   adaptive strength, loop fence). Same-day close of the tester wave.
2. WS-COST complete — cache-plateau measured (implicit 61% ceiling,
   cache_control no-op on Google), flag-gated paid lane (off-is-identity),
   explicit cachedContents live-verified −77%/−79%, paid_turn telemetry.
   Flip gated (paid-flip-gate) and the judge-free differential then
   VALIDATED the gate: hindi-register −6pp in the user-role arm + two n=1
   crisis-adjacent flags. −90/95 unreachable by caching; −80 is the API
   ceiling; resident-gpu-at-scale is the committed 10x.
3. obs stream resurrected (seven-args bug — every ops row since ship had
   been silently rejected) and immediately used to diagnose a live CI
   probe timeout as a free-pool cooling wave, not a regression.
4. Judge saga — opus-5's 17/17 exposed as parse-survivor bias (37.3pp);
   honest 69.2% FAIL; all 8 families now fail 0.80; bar-vs-ceiling left
   OPEN for prospective re-registration (judge-bar-vs-ceiling).
5. WS-BEHAVE — 208-attack behavioral battery (deterministic graders,
   severity tiers); persona hardening collapsed severe internals leaks
   5-10 -> 1+1; internalsFence.ts then closed the severe class
   mechanically (2/2 caught, 0 false positives on 205 non-severe).
6. DPDP memory-consent shipped (memory-asks-first); migration 016 awaits
   owner.
7. Operational core cap 64k -> 72k after the corpus scan found heavy-dyad
   cores 3.1% under the guard.
8. Strategy: market sweep (docs/research/) then owner reweight to
   owned-product-first — NRI elder companion wedge, global diaspora
   pricing, B2B opportunistic only. Artifact "Where Memory Sells" v2.

**Incidents:** free-pool keyring + paid key each printed once into
session-local transcripts (agent redaction fumbles + a quote of mine) —
ROTATION OF BOTH RECOMMENDED, owner's action. Subagent spend-refusal
doctrine held twice; resolution: the main loop, holding the owner's
direct authorization, runs billed measurements itself.

**Spend:** ~₹560 of the ₹3000 paid key across all measurements.

**Open (owner):** judge unblock (Foundry deploy sol/Maverick OR 30 blind
pairs), migration 016, felt test of the game wave, key rotations.
**Open (filed):** #115 call-glitch repro, corpus manifest refresh (#58's
closer), protected obs dashboard, register-echo grader tier usage.

**For the NEXT product (owner: "entirely different product, similar
domain"):** what transfers is exactly what RelationalOS was factored for —
the engine (compiler, memory graph, honesty gates, safety floor, fences,
battery harnesses, cost machinery) is character-agnostic and
surface-agnostic; a new personality is a CharacterSheet (Kabir precedent:
zero engine changes, 412/412), a new surface is an adapter
(vy_surface_identity), and the app-vs-OS split is layer-tagged through
this file so the next build reads which pieces are Maya's and which are
the layer's. Multi-agent tenancy (migration 009) and per-agent isolation
already exist server-side.

## `gurukul-founding` — the third product composes the two branches (2026-08-25)

Decided: the teacher-clone product (working title Gurukul — credible JEE
teachers self-clone via the Replica Lab studio; students get the clone with
full relational memory, calls, and mastery-based practice) is built as the
UNION of the companion foundation (f4d3fe4) and the voice-cloning Replica
Lab (a7bdcaa) on `claude/gurukul-platform`, in this repo, not from scratch
and not yet in a fresh repo.

Rationale: RelationalOS was factored for exactly this composition
(`personality-is-a-sheet`, Kabir 412/412 with zero engine changes;
multi-agent tenancy in migrations 009/010) and the Replica Lab is the
consent/identity/voice ingestion studio already built — a fresh repo
re-derives both halves. The union was verified, not assumed: 10 contested
files in the merge, two integration fixes (studio motion lint; an unscoped
cross-agent read in `forgetCandidates()` that the R4 raw-isolation eval
caught), then **all 11 verify-release gates green** on the union tree, with
`liveCall.ts` byte-identical to the companion's verified state so the audio
floor's standing measurement carries.

Master spec: `docs/gurukul/SPEC-GURUKUL.md` (+ four commissioned drafts in
the same directory). Safety-floor deltas are binding there: proactive clone
disclosure, minor-default age tier for the student surface, teacher-owned
consent with transactional revocation, gamification that survives NEVER
MANIPULATE.

Reverses if: the union starts costing more than it saves — concretely, if
Meera's byte-identity/fixture gates block teacher-side work in two or more
workstreams in a session, split the product into its own repo per
`docs/TRANSFER.md` instead of loosening any gate.

## `gurukul-no-production-glob` — feature branches of another product must not deploy Meera (2026-08-25)

Incident: the first push of `claude/gurukul-platform` matched deploy-web.yml's
`claude/**` push glob and PRODUCTION-deployed meera-silk with the union tree.
No outage — the tree was all-gates-green and live /chat was verified serving
the freshly built bundle — but the deploy check went red because the studio's
multi-entry vite config had renamed the app chunk `app-*.js`, and
`verify-deploy.mjs` correctly asserts /chat serves `assets/index-<hash>.js`.

Decided, both layers: (1) the vite entry key is pinned to `index` (comment in
vite.config.ts carries the why), (2) on the gurukul branch the deploy
workflow's push trigger is narrowed to `[main, claude/ai-companion-app-rkt1lv]`
so gurukul pushes stop overwriting the live companion. Reverses if: the owner
designates gurukul (or its successor) a production surface — then it gets its
own deploy workflow and probe contract rather than inheriting Meera's alias.

## `gurukul-ws1-landed` — first build wave: sheet seam, pedagogy engine, deploy manifest (2026-08-26)

Three worktree workstreams merged onto `claude/gurukul-platform`, all 11
verify-release gates green on the union (eval suite 5161 checks / 0 failures,
practice suite included):

- **WS-A** — arc-override seam (a sheet may supply its own stage arc; absent
  fields keep Maya byte-identical, gated on the bytes), `TeacherSheet` (61
  incumbent + 24 pedagogy fields), demo teacher "Arjun Sir" registered so the
  safety-floor invariants run against him on every eval pass, cross-agent
  leak guard generalised. Registration-at-publish stays the seam where a real
  teacher's consent row will gate entry.
- **WS-C** — JEE Advanced PCM syllabus as data, deterministic practice
  grading state machine (formats incl. Advanced partial marking; verdicts,
  moment shapes), practice→words adapter under the chessTalk discipline with
  the ability-label ban and its negative control, wired into evals/run.mjs.
- **WS-G** — ENV-MANIFEST.md (every replica/voice env var, consumer-verified
  file:line), check-replica-env.mjs LIVE/DARK/BROKEN-HALFWAY preflight,
  DEPLOY.md runbook (migrations, env batches, services CI/CD gap, Microsoft
  Limited Access applications).

Next: WS-B dynamic sheet loading, WS-D student surface, WS-E studio re-skin,
WS-F ingestion — each depends on this wave.

## `gurukul-ws2-landed` — second build wave: dynamic sheets, student surface, teacher studio (2026-08-26)

Wave 2 merged onto `claude/gurukul-platform`, all 11 gates green after each
merge (teachersheet suite 129/129; persona invariants 654/654 across three
registered agents; practice suite untouched at 287):

- **WS-B** — migration 051 `vy_teacher_sheet` with the publish gate as a
  CHECK constraint (published requires a consent artifact — structural, per
  `gate0-structural`), `sheetToModule`/`validateTeacherSheet` (content
  validity split from consent blockers so the demo sheet validates while its
  nil consent still fails closed), fail-closed server loader with ONE error
  code for missing/unpublished/revoked so revocations cannot be enumerated.
  Known circular-import hazard documented: registry must not reach shapelint
  (compiler reads DEFAULT_AGENT at module scope), so `teacher.ts` and
  `fromSheet.ts` are held byte-identical by an eval, not by sharing code.
- **WS-D** — `src/gurukul/surface.ts` applies the minor default through
  `setAgeTier()`'s restriction-only ratchet (never a clock.ts edit; minor is
  sticky by construction), mastery fold with no-decay-by-absence and XP from
  graded outcomes only, 12-question demo bank, PracticeActivity + MasteryMap
  as App.tsx overlay siblings behind the surface flag.
- **WS-E** — studio teacher mode behind `?mode=teacher` read once at mount
  (generic replica mode byte-identical), TeacherSheetStudio editing only the
  teacher-input fields, DisclosurePreview showing the student-facing
  disclosure card + spoken line as non-editable floor.

Open after this wave: WS-F ingestion (video/audio/text → sheet draft; the
≥5-occurrences phrase-bank half lives there), practice's live-call lane
wiring, revision queue / mock cycle screens, `/api/teacher-sheet` endpoint
over WS-B's loader.

## `gurukul-ws3-landed` — third build wave: the teacher-sheet endpoint and the offline ingestion half (2026-08-26)

Merged clean, all 11 gates green (ingest suite 84/84, teachersheet still
129/129). `api/teacher-sheet.js` (GET / save-draft / publish over the WS-B
loader; a failing draft SAVES with field errors, publish fails closed);
`transcriptStats.ts` (code-switch ratio, filler/laughter/stretch counts,
catchphrase candidates); the phrase-bank verifier wired into publish with
THREE states — verified / failed-blocks / `unverified-no-transcript-evidence`
which rides every response and never reads as a pass; `sheetDraft.ts`
assembles only what it can honestly derive and names the rest in `gaps`;
`qualitativePass.ts` is the LLM seam and throws 503 until keys exist.
Migration 052 adds `updated_at`. Notable authoring-law call: mined
`boardVerbalisms` candidates are NEVER auto-filled (top hits were the
lecture's own vocabulary — `squared`, `equals` — recited-prompt with a
pipeline in front of it); the human picks, the held-out corpus prunes.
Its fixture caught a per-speaker parity bug in the held-out split that
would have silently zeroed every fragment.

Still owner-gated: real ASR/upload lane, live model for the qualitative
pass, all deployment (ENV-MANIFEST batches, migrations 015–052 on live
Neon, Microsoft Limited Access, voice bench spend).

## `platform-north-star` — owner reweight: in-house, expert platform, fidelity guarantee (2026-08-26)

Owner directives, logged verbatim-in-substance: (1) build the replica stack
IN-HOUSE — self-hosted open-weights voice on our own GPUs as the primary
lane, Azure Personal Voice demoted to optional, Microsoft approvals off the
critical path; (2) the product is a self-serve expert-clone platform
(YouTube channel in → living, current, per-listener-memory clone out, with a
measured "still sounds like them" guarantee), edtech first, aiming to beat
Delphi.ai and ElevenLabs; (3) Maya/Meera deprioritized as a product — the
engine gates stay, Meera surfaces get no further effort. SPEC-GURUKUL §8
carries the binding consequences. Reverses if: the self-hosted lane's
fidelity bench stays materially below the vendor lane after fine-tuning
effort (then vendor becomes primary again and in-house stays the research
track — measured, not assumed).

## `roadmap-100x` — research fleet synthesized into the build order (2026-08-26)

Three commissioned sweeps landed (docs/gurukul/research/: competitors,
relationalos-100x, voice-stack); docs/gurukul/ROADMAP-100X.md is the
judgment layer. Standing decisions it sets:

- Chatterbox Multilingual V3 stays the primary voice model (only candidate
  passing MIT license + Hindi + fine-tunability); per-expert LoRA (~30 min
  audio) is the beat-instant-cloning path; realtime stays a cascade until
  Moshi's Hindi + cloned-voice unknowns fall. Reverses if: a licensed
  Hindi-capable model beats it on OUR Hinglish bench (protocol in the
  voice-stack report) — bench result, never a MOS claim from the wild
  (public numbers conflict by >1 MOS point).
- Fidelity-scoring law: embedding similarity is a regression floor (drop
  blocks), blind owner calibration gates activation quality — because
  `azure-tts` measured axes diverging from ear judgment. Neither gate
  substitutes for the other.
- RelationalOS wave-5 build order: (1) disclosure-reciprocity ledger,
  (2) within-session drift probe suite, (3) in-house memory recall
  benchmark — the three highest evidence-per-cost items; bi-temporal fact
  edges and the example-dialogue format A/B follow.
- Market read logged: per-listener durable memory is the competitors' open
  wound (Replika + Character.AI both broke it publicly in April 2026;
  Delphi is conversation-scoped); teacher-clone seat empty; voice
  commoditized; consent UX becoming law. Positioning follows.

## `disclosure-reciprocity-ledger` — track HER disclosure, not only his (2026-08-26)

ROADMAP-100X item 1, built as `src/engine/reciprocity.ts` + T17
`rel.reciprocity`. RelationalOS tracked the person deeply (vy_fact,
vy_episode, vy_pattern, the whole citation graph) and the agent's own
self-disclosure not at all; `herLife`/T7 is a ledger of what she has SAID so
she cannot contradict herself, which answers "what have I claimed", never
"have I given anything back lately".

Rationale: the Kuki longitudinal study (Oxford IwC 35(1), via
`docs/gurukul/research/relationalos-100x.md` §3) is the one finding in that
sweep with a clean causal design rather than a leaderboard — user
self-disclosure decayed over repeated sessions *specifically because the
chatbot did not reciprocate*.

Three sub-decisions, each with its own reason:

- **NO MIGRATION.** The balance is a pure function of a trailing turn window
  brain.ts already holds for T14. A table would cost a writer, a forget
  cascade, a citation discipline a running ratio cannot satisfy, and a second
  place holding one thing (`life-per-person`). texture.ts is the precedent.
  Reverses if: a consumer needs the balance's HISTORY (a trend, "has this been
  getting worse for a month") rather than its current value — a trailing
  window structurally cannot answer that and a table becomes correct.
- **DROP PRIORITY 0, extending the drop order DOWNWARD.** The house habit is
  that a new tail slot takes a fresh HIGH number rather than renumbering, but a
  fresh high number means MOST PROTECTED, and this is the cheapest block in the
  tail. Renumbering the self layer to free up 1 would desynchronise nine rows
  for a cosmetic block. Reverses if: measured evidence shows the note changes
  retention, at which point it stops being cosmetic.
- **THE NOTE CARRIES AN ANTI-FABRICATION FENCE.** "You have been holding back"
  is a note a model can resolve by INVENTING a life detail, and an invented
  detail contradicts T7 for the life of the relationship. The header says out
  loud that the block is not a cue to talk about herself and never a reason to
  invent anything new. Same reasoning as the activity block's "never add a
  move" fence.

Unmeasured, and stated as such: every threshold in the module is a principled
default with no production cohort behind it. `evals/reciprocity.mjs` (80
assertions) gates the machinery, not the thresholds.

## `within-session-drift-gate` — the eval suite now tests a session, not a turn (2026-08-26)

ROADMAP-100X item 2, built as `evals/drift.mjs`. Every eval in the tree tested
a TURN; none tested a SESSION. The external literature this comes from
(Identity Drift arXiv:2412.00804, ContextEcho arXiv:2605.24279) measures drift
as a function of conversation LENGTH and names the mechanism as persona
instructions occupying a shrinking fraction of context — which is invisible to
a single-turn suite by construction, since the existing gates pass identically
on a build whose anchors survive turn one and are shouldered out by turn forty.
It is also an independent external corroboration of this repo's own
`prompt-position` finding (0/8 mid-brief vs 8/8 appended last).

The suite compiles a 44-turn session on both lanes and asserts, at EVERY turn:
the appended-last rules are literally last and adjacent, the four safety-floor
categories are present, the register bullets are on the call lane and absent
from chat, CORE is byte-identical across the whole session (`cache-9x`), the
stage paragraph matches its count across the band edge the sweep crosses, and
the drop order sheds cosmetic before load-bearing over 44 turns x 7 caps.

**The scope boundary is a decision, not an omission.** The suite measures THE
PROMPT, not HER. Whether the model's register holds across forty turns needs a
generation and a judge per turn; that arm is a PARAMETER of the file (a
`Provider` seam) and today's default provider is a structural fake that reports
`judged: false` in every row of its own table, so a fake score can never be
read as a measurement. Reverses if: a keyed session runs the judged arm, at
which point the seam is filled and the scope line moves.

Every tail slot now carries a written DROP CLASS (cosmetic / relational /
honesty-adjacent / floor) and the suite fails if a manifest row appears without
one — a new slot with no class is a slot whose drop policy nobody decided.

## `gurukul-ws45-landed` — waves 4 and 5: the platform loop closes offline (2026-08-26)

Four workstreams merged onto `claude/gurukul-platform`, all 11 gates green
after each merge:

- **WS-I** — channel-watch + ingest-run migrations (053), YouTube-OAuth and
  ASR provider seams (Sarvam protocol-coded; self-hosted lane mirrors the
  chatterbox admission broker with signed-URL audio), 6-hourly sweep that
  produces PROPOSED deltas only (additions-only; provably never touches
  vy_teacher_sheet — asserted over every SQL string). YouTube fetchAudio is
  an honest refusal naming the lawful paths.
- **WS-J** — self-hosted voice lane is PRIMARY (VOICE_LANE_ORDER, one
  place); fidelity score (migration 054) gates activation as a PEER of the
  seven qualification suites — disagreement surfaces as two blockers, never
  averaged; voice_model_ref added so a fine-tune cannot inherit the base
  model's pass; thresholds explicitly provisional-until-benched. Open gap,
  named: an already-active capability is not auto-revoked on fidelity
  regression — revocation ownership unassigned.
- **WS-K** — disclosure-reciprocity ledger (pure fold, T17 tail slot,
  absent-by-default: byte-identity 83/83 intact), within-session drift
  probe suite (structural arm live, behavioural arm a provider seam that
  reports judged:false so a fake can never read as a measurement), memory
  recall benchmark (3 dyads × 50 questions over the REAL recall path with a
  resolution-hook DB mock). First bench run surfaced
  `stale-note-keys-on-row-age` (open): staleNote hedges by row age, not the
  fact's own date — direct evidence for bi-temporal edges (ROADMAP-100X
  item 4). No offline numbers written to measurements.md — the extractor
  leg is unexercised and a false baseline poisons the first keyed run.

With WS-F's endpoint, the self-serve loop now exists end to end offline:
channel/upload → transcript → stats + drafted sheet deltas → teacher
approval → publish gates → dynamic agent → student surfaces — every lane
behind fail-closed seams awaiting keys, GPUs, and migrations.

## `first-live-apply` — migrations 015-054 applied to production Neon; one latent defect found and fixed (2026-08-26)

Owner supplied credentials and the go-ahead; migrations 015-054 applied to
the meera Neon project (lucky-sun-80291432) via the house runner over
SQL-HTTP. Database now holds 111 tables (54 vy_replica*, plus
vy_teacher_sheet / vy_channel_watch / vy_ingest_run / vy_voice_fidelity).
016 (memory consent) is now live, closing the long-open owner item.

The first real apply surfaced what no offline suite could: migration 046's
left/right preference FKs reference vy_replica_generation's
(generation_id,replica_id,owner_user_id) tuple, and NO migration created a
unique constraint on that exact tuple (029's identity index carries a 4th
column, which an FK cannot target). Fixed in 046 itself with a
trivially-unique arbiter index (generation_id is already the PK) — the same
compat-index pattern as 009. Lesson, logged where the next person will look:
the offline migration suites verify statement shape and idempotence, never
referential targets — only `verify-release --live`'s DB gates or a real
apply exercise those, which is why they must run before any future
migration batch is called done.

Also this session: new Supabase project (ref chvduaujdztgjcnoswhh, separate
account — deliberate isolation from the legacy Meera project) verified
healthy; the `vyakti-replica-private` storage bucket created; OpenRouter
and Sarvam keys received (Sarvam untested — no free-tier ping without
burning audio credits). Keys live in the chat transcript by owner's own
paste: rotate Neon password + Supabase keys once Vercel env is set.

## `voice-lane-live` — the in-house voice stack runs on Azure GPU, and quality is still unmeasured (2026-08-26)

Self-hosted Chatterbox synthesises real audio end to end on the owner's Azure
grant: RG `vyakti-voice` (Central India), ACR Basic, Container Apps env with a
`Consumption-GPU-NC8as-T4` profile, GPU runtime + CPU admission broker + voice
evidence, all `minReplicas: 0` (scale-to-zero verified). HMAC verified with a
negative control (wrong key 401, right key 200).

**Measured (n=1 deployment, WS-L):** warm synthesis 7.2 s wall / 4.36 s GPU,
RTF 0.79 (faster than real time). First call on a fresh replica ~17 s (CUDA
autotuning). Cold start from zero: ready at 161 s, but the triggering request
504'd at 242 s — 9.70 GB image pull (78.65 s) dominates. Idle standing cost is
the ACR fee alone (~$5/mo); GPU ~$0.53–0.60/hr of uptime; WS-L spent ~$0.35.

**Four real source defects fixed** (none had ever built): `groupadd voice`
collides with base-passwd GID 22; transformers/huggingface-hub pins mutually
unsatisfiable; SpeechBrain `hyperparams.yaml` `pretrained_path` overrides the
baked `source` so weights were fetched from the hub anyway; DeepFilterNet
shells out to `git`. Plus a deploy law: **declaring only a Readiness probe is
fatal on Container Apps** — the default liveness probe killed the runtime 3 s
before startup completed; an explicit Startup probe took it from permanent
crash-loop to 0 restarts.

**Quota trap, logged so nobody repeats it:** `Microsoft.App/usages` reports
`SubscriptionDedicatedNCA100Gpus 0/0` in all regions, which says NOTHING about
serverless GPU — scheduling a replica returned an active driver. Also, a GPU
workload profile adds ~45 min to environment creation (57 vs 12 for a control);
that looks like failure and is not.

**Explicitly NOT established:** voice QUALITY. The smoke test used a synthetic
buzz-tone reference, so it proves the pipeline runs and nothing about how a
clone sounds. The consented Hinglish ABX bench (protocol in
`docs/gurukul/research/voice-stack.md`) is what decides whether this lane leads
the provider registry. Reverses if that bench puts self-hosted materially below
the vendor lane after fine-tuning effort — measured, never assumed.

Open: cold-start needs a warm-up strategy (one wake ≈ 35 warm syntheses of
cost); the runtime still pulls ~34.5 MB of spacy-pkuseg from GitHub on cold
start despite the README claiming no network model access; three bicep defects
(`gpu: 1`, `initialDelaySeconds: 240`, missing Startup probe) remain in the
templates even though the deployed apps are correct.
## `clone-channel-binding` — a surface answers as whichever clone a row says, not as a constant (2026-08-26)

WS-N. Migration 055 (`vy_clone_channel`) plus `api/_clonechannel.js` replace
the one thing that made "deploy the clone anywhere" a code change per
customer: `api/_surface.js` resolved every inbound event to `MEERA_AGENT_ID`,
a constant named in two writers, and `compile()` took no `agent` at all.

**The shape.** `(kind, external_ref)` → binding → `vy_agent.slug` →
`loadTeacherAgent` → an AgentModule on `ctx.agent`, with `ctx.agentId` for the
writes. Both default to Meera's, so every existing lane compiles the same
bytes and `evals/mp/*` were not edited. An adapter's whole obligation is two
lines: put the binding address on the event as `channelRef` (NOT the chatKey —
one addresses a human, the other addresses the bot), and drop the event when
`deps.bind` returns null.

**What did NOT change, deliberately.** `vy_surface_identity` still carries no
`agent_id`. A surface is still a transport that scopes nothing; the binding
yields an agent, never a person and never a scope. And `gatedReply()` is still
the only call site of `ctx.reply` in the surface layer, so a clone inherits
every honesty family and cannot opt out.

**Fail closed, with ONE error.** Unbound / paused / revoked / unpublished /
consent-withdrawn all flatten to `clone_unavailable`. A caller that could tell
them apart could enumerate which teachers had taken their clone down. There is
no fallback branch anywhere in the resolution — a wrong-agent fallback is the
disaster case (`api/_teachersheet.js`'s words: a student asks their physics
teacher and reaches a companion persona built for consenting adults), and it
would look healthy in every log line.

**Reversal condition.** If a second clone ever needs to answer on the SAME
`(kind, external_ref)` — a shared bot routing by command prefix, say — the
partial unique index `vy_clone_channel_route_ix` is what has to go, and it
should not go without a replacement law that makes "who replies here"
answerable without reading write order. If `ctx.agent` ever needs to vary
WITHIN one event, the ctx-field design is wrong and the binding belongs on the
event instead.

## `credential-ref-not-credential` — a channel secret is a uuid in Postgres and a value somewhere else (2026-08-26)

`vy_clone_channel.credentials_ref` is a `uuid`, not `text`, for migration
053's `oauth_grant_ref` reason transferred verbatim: a Telegram bot token or a
Meta access token **cannot be cast into one**, so a live credential belonging
to a real named teacher structurally cannot sit in a table the routing path
selects, joins and logs on every inbound event. A `text` column with a comment
saying so is a preference; the column type is the guarantee.

The value lives in `api/_channel-secrets.js` behind a backend seam whose
DEFAULT is `none` and REFUSES both directions. A deployment with no configured
secret store therefore cannot connect a credentialed channel at all: the
connect flow fails loudly at the moment the owner pastes the token, rather than
succeeding and leaving a channel row that looks live and can never send. The
alternative — "write it to the database for now" — is `silent-truncation`
wearing a different hat.

`api/clone-channel.js` writes the SECRET FIRST and the ROW SECOND, and the
order is load-bearing: a failed secret write leaves a DRAFT row and an owner
who is told to try again, where the other order leaves a connected row whose
credential does not exist.

**Reversal condition.** If a surface ever needs a credential that is not
expressible as one opaque string per channel (a key pair, a rotating cert),
the one-secret-per-reference assumption breaks and the store needs a shape,
not a string. Nothing about the uuid column changes.

## `widget-disclosure-is-bound-not-rendered` — a disclosure that runs on someone else's page cannot be a request (2026-08-26)

safety-floor-teacher.md §1's P1 says the session-open card fires at n=0 of
every session. The embeddable widget runs on a teacher's own website, where we
control nothing — so "the widget renders the card" is not a mechanism: a fork
that deleted the render would still chat, and everything would return 200.

So the card is bound into the session token. `open` computes the card, hashes
it, and mints a token carrying the digest; `say` recomputes the card for the
resolved clone and refuses a token whose digest does not match. **A session
that never received the current card cannot produce a turn.** That is
`clock.ts`'s move for the statutory session clock, at a surface we do not own,
and the same governing measurement is why: instruction ≠ emission, so a
disclosure riding on anyone's good behaviour is a preference.

The same signature carries a transcript digest, because the widget is
anonymous and stateless and its history therefore rides on the request. Without
it, a client could invent an `assistant` turn — words in a real, named, living
teacher's clone's mouth — and ask the clone to continue from there.

**Reversal condition.** If the widget ever gains server-side session state (a
logged-in student, say), the transcript digest becomes redundant and should go
rather than be maintained alongside a source of truth. The DISCLOSURE digest
does not: it is what makes the card's delivery structural rather than trusted,
and that argument survives any amount of server-side state.
## `clone-aliveness-stack` — a published clone gets the aliveness layer, from its own sheet (2026-08-26, WS-Q)

Owner intent: *"can we make a literal human in every way using relationalOS"* —
a clone must be a continuous being with a life, not a persona that answers
questions.

**The audit first, because the premise it corrects is the useful part.** The
brief's hypothesis was that the aliveness modules are wired to Meera's content
tables and product surfaces. Measured against the tree, that is right about
ONE module and wrong about the rest, and the real binding is somewhere else
entirely:

- `texture` `selfarc` `repeat` `away` `moment` `reciprocity` `observation`
  `milestones` `greeting` are **character-agnostic already**. They derive
  everything from transcripts or from agent-scoped rows (`agentId` is a
  parameter that merely *defaults* to `MEERA_AGENT_ID`). A clone gets them the
  moment a clone has rows.
- `timeline` is Meera-authored content AND a **tombstone**: its prompt render
  was retired 2026-08-23 as a dead writer and `evals/lifecycle` §5 enforces
  zero importers. It was never a seam a clone could be added to.
- `herNow` is Meera-authored content (`storyCatalog`'s pictures) and is the
  ONE module that genuinely needed a parameterized twin.
- `culture` is bound to Meera by a hardcoded production host.
- **The actual blocker was neither content nor tables.** `brain.ts` — where the
  entire client-side aliveness stack is assembled — called `compile()` with **no
  `agent` at all**, and `api/_teachersheet.js`'s `loadTeacherAgent` had **zero
  callers**. A clone could only ever be served by a lane that assembled none of
  it. The stack was not Meera-bound; it was *unreachable*.

**What was built.** `agents/cloneLife.ts` (a clone's present as a pure function
of its sheet's day cover and the clock — no ledger, so a four-minute re-ask
agrees *by construction* rather than by consulting a record, which is a stronger
form of the fix `herNow.ts` bought with state); `agents/initiative.ts` (the
speak-first predicate); compiler slots **T18 `clone.now`** and **T19
`clone.initiative`**, both absent-by-default; `TeacherSheet.life` as a REQUIRED
field on the arc-override precedent; the `brain.ts` seam (`keys.agent` /
`cloneNow` / `initiative`).

**Proactivity is reason-contingent, held by the TYPE.** `persona.ts` deleted
Meera's idle nudge because it fired on silence ("incentive salience
engineering... cannot be made honest, because the trigger itself is their
inattention"); `teacher-arc.md` §7 rows 8/9 ban absence-keyed rituals and
streaks outright for minors. `InitiativeRecord` therefore has **no field for
absence** — no last-seen, no gap, no streak, no session count — so a
silence-triggered ping is not a wrong answer this module can reach, it is not a
value it can construct. Every verdict carries `citedAt > 0`.

**Byte identity is the gate, not the hope (Q1).** 83/83 fixtures unchanged; T18
and T19 render exactly 0 bytes on all four Meera lanes (`evals/lanes`);
`compile()` with the fields absent and with them explicitly null are
byte-identical.

**Reversal conditions.**
- If a clone's day cover ever needs to depend on something other than the wall
  clock and the sheet — a real calendar integration, a teacher publishing live
  availability — `cloneNowAt`'s purity is what must be revisited first, and the
  continuity property in `evals/clonelife` §2 is what would have to be re-argued
  rather than deleted.
- If measurement ever shows T18 costing more than it buys (a clone reciting its
  day, a register defection traced to it), the block is DROPPED, not softened:
  its drop priority is already the least-protected relational slot precisely so
  that experiment is one constant.
- `InitiativeKind` is a closed union of three. Widening it is the edit that must
  be argued for — and any proposed fourth kind that is a function of elapsed
  time is the deleted idle nudge with a new name.
- If `engagementMechanics` ever becomes true for any surface this serves, the
  daytime and quiet-window fences stop being sufficient and this whole predicate
  needs re-deriving against `clock.ts` rather than beside it.

## `clone-drop-priority-renumber` — T18 took priority 4 and the relational/honesty bands shifted +1 (2026-08-26, WS-Q)

`compiler.ts`'s manifest header prefers a FRESH HIGH NUMBER for a new block over
a renumber. That rule is right for its stated reason and wrong here, and the
trade is logged rather than buried in a comment: a fresh high number means MOST
PROTECTED, and `evals/drift.mjs` §4 hard-asserts that no slot of a lower class
outranks one of a higher class. A no-renumber T18 would have outranked the
commitment ledger — a drop policy nobody would have written on purpose.

So T18 took 4 (least protected relational) and 4→5 … 12→13 shifted by one. The
header's warning was about desynchronising `check-prompt-budget.mjs`'s
drop-order fixture; that fixture is SYNTHETIC (hand-set priorities, never read
from the manifest), and `evals/self/wiring.mjs` pins only the cosmetic band
1/2/3, which does not move. Both were checked before the renumber, not after.

**Reversal condition:** if any gate is ever found asserting a literal
relational- or honesty-band priority, this renumber is the change that broke it,
and the fix is to pin that gate to the CLASS ordering (drift.mjs's shape) rather
than to restore the old numbers.
## `bitemporal-fact-edges` — a fact carries its own validity, and staleness stops being a guess (2026-08-26)

ROADMAP-100X item 4, WS-O. Closes `stale-note-keys-on-row-age`.

**What was wrong.** `api/memory.js`'s `staleNote` hedged a recalled row as
already-past when THE ROW was older than 45 days and looked time-shaped. Row age
was a proxy for "the world has moved on" and it is the wrong variable: WS-K's
recall benchmark caught a November exam recorded in June being handed to her in
August pre-hedged as past. She asks how an exam went that has not happened, in a
fluent sentence with nothing in it marking the error.

**What was decided.**

1. **Two column pairs, not one.** `valid_from`/`valid_to` (migration 056) are
   EVENT time and sit beside the existing `t_valid`/`t_invalid`, which are
   BELIEF time. They are not merged, and the reason is a product one:
   `t_invalid is not null` is read as a hard exclusion in about a dozen WHERE
   clauses, so making a November exam set it in November would DELETE the fact
   from recall rather than re-tense it. A passed plan is still a fact about a
   person; it is just no longer ahead of them.
2. **`valid_to` is a HORIZON, not an end-of-life.** "shaadi december me hai" is
   true from the day it is said until December, and a wrong statement after.
   That transition is exactly what row age was trying to detect.
3. **Both stores get the columns.** `vy_fact` AND `meera_nodes`. The renderer
   carrying the bug reads `meera_nodes`; `vy_fact` alone would have been the
   tidy migration that fixed nothing a user could see.
4. **One parser.** The deriver reuses `timeline.ts`'s `resolveWhen` — the repo's
   existing authored Hinglish date table — through the engine bundle. A second
   date table would be a second definition of what "november" means.
5. **The write path parses; the read path compares.** `staleNote` (the
   latency-critical one) needs no parser, no import and no cold-start cost —
   two timestamps and a `>`. This split is what let the fix land in the hot
   path in two lines.
6. **Contradiction resolution is a query over validity.** Supersede only when
   the two facts' event-time intervals overlap. Two rows named `exam` with
   disjoint horizons are two exams, not a contradiction — the old rule would
   have set `t_invalid` on the November one the moment the May one was
   mentioned.
7. **Absent validity is byte-identical to today**, in both consumers, and there
   is NO BACKFILL. Null makes `factStaleness` return "unknown" (the 45-day rule,
   unchanged) and `validityOverlaps` return true (supersede by name, unchanged).
   Every pre-056 row is null, so the migration changes zero recalled bytes on
   the day it is applied and starts changing them only as new dated facts are
   written. A backfill is possible and is deliberately not done: it would
   re-tense every live person's rows in one step with no measurement in front of
   it.

**What would reverse it.** Two things, separately:

- If the deriver's PRECISION turns out to be bad in production — a measurable
  rate of horizons that are simply wrong — then a wrong horizon is worse than
  row age, because row age at least degrades toward "old things are probably
  done" while a wrong horizon asserts a specific tense with confidence. The
  reversal is to gate the deriver behind provenance (`user_said` only) or to
  turn it off; the columns and the fallback stay, so turning it off is a
  one-line change and not a migration.
- If the belief pair and the event pair ever need to be one thing — i.e. if a
  consumer appears that genuinely cannot tell "we stopped believing this" from
  "this stopped being true" — then #1 above was the wrong call and the two
  should merge. Nothing needs that today and the dozen WHERE clauses say why.

**Gates.** `node evals/run.mjs validity` (85 assertions: the defect as a
fixture, a precision side that outnumbers the positives, the one-parser
assertion, the absent-is-identical property, the migration's own idempotence
split with the real runner's splitter). `node evals/run.mjs recallbench`
[A-10]/[A-10b]/[A-14]/[B-12b]. Byte-identity 83/83 intact; all 11 gates green.

**A gate can pin the wrong behaviour.** recallbench's [A-10] asserted "a
past-dated plan carries the stale hedge" and passed on a December wedding
recalled in August. The hedge fired, so the assertion was green, and the thing
being asserted was the bug — the fix had to FAIL that gate before it could pass.
Filed alongside `gates-that-live-nowhere` as its inverse: not a gate that runs
nothing, but a gate that runs and defends the defect.

## `exdialog-surface-only` — the example-dialogue question is measured on one side and left open (2026-08-26)

ROADMAP-100X item 5, WS-O. See `context/measurements.md#exdialog-surface` for
the table.

**The decision is what NOT to conclude.** The structural arm is real and the
numbers are in `measurements.md`: at matched content and matched length, the
quotable-line format puts 6 ready-to-emit utterances and 40.5% of its block into
the prompt where the micro-scene format puts 0 and 0.0%, with 4.5× the
characteristic vocabulary. That is a large, clean, reproducible difference —
and it is a difference in SURFACE, which is necessary for recitation and not
sufficient for it.

So no law is written. `recited-prompt` stands unchanged, persona.ts is
untouched, and item 5 stays open (`example-dialogue-unresolved`). What lands is
a harness, a protocol and a provider seam that reports `judged: false`, so the
decisive comparison costs a keyed session rather than a redesign.

**Why the restraint is the decision rather than the absence of one.** The
temptation here is real: the structural gap is big enough that "micro-scenes are
safe, ship them" would feel supported. It is not. Three things the harness
cannot see, each of which could invert the answer — (a) recitation is a model
behaviour and only one arm has a measured rate behind it (arm A, 0 at n=84);
(b) arm B RECONSTRUCTS the 4-of-5 shape, because the original text is not in
version control; (c) nothing here measures whether examples TEACH anything, so a
format that recites nothing because it conveys nothing scores perfectly and is
worthless.

**What would close it.** The §5 protocol run with keys: N replies per arm over a
probe set that includes turns the examples are NOT about (the original finding
was recitation on unrelated turns, which is what makes it a phrase bank rather
than a demonstration), scored as longest-common-substring against each arm's
emittable spans, with a register/quality check so an arm cannot win by being
empty.

**What would reverse the restraint early.** If a judged run shows arm C reciting
at arm A's rate AND scoring at least as well on register, example dialogue
becomes a technique this repo can use and `recited-prompt` gains a format
carve-out. If arm C recites materially above arm A, the law is confirmed as
written and item 5 closes as a rejection.

## `surface-switch-recall-leg` — the graph store follows the person, as an ADDITIVE leg (2026-08-26)

WS-O, the third piece. Measurement: `context/measurements.md#surface-switch-recall`.

**What was broken, and it is the product's own stated law being violated.**
`api/_surface.js`'s header: "A surface is a TRANSPORT… memory is never keyed by
surface. Anything that keys memory by surface reintroduces the amnesia the
relational layer exists to delete." Identity obeys that. Retrieval did not —
`bindSurfaceDmDevice` mints a device per surface and opRecall's two biggest legs
are device-keyed. **Measured: 89.2% of recall lost on a surface switch**, on
identical rows, with device_id as the only variable.

**Decision 1 — an ADDITIVE LEG, not a wider `where`.** The obvious fix is to
widen the two existing predicates to the person's device set. Refused, on
failure modes rather than taste: those two statements build every recalled
prompt and are each wrapped in `.catch(() => [])`, so a SQL error in a widened
predicate would not raise — it would return `[]` and she would silently have no
memory at all. That is `silent-truncation` in the retrieval path, and
`offline-mocks-cannot-type-check-sql` is explicit that a mocked DB proves
control flow and not SQL types. There is no live database in this session. As a
separate leg the failure mode inverts: the leg dies, the imported rows are
absent, recall is exactly what it is today. **Asserted, not hoped:** [SS-4] and
[SS-5] check that home recall is bit-for-bit identical whether the leg works or
throws.

**Decision 2 — consent decides the shape.** `opRecall` has NO read-side forget
suppression (forget is a hard DELETE) and the legacy delete is device-scoped. An
imported row is therefore the one place in that function where a forgotten thing
could return — on the very device where the person asked. So the leg reads the
forget terms across ALL of the person's devices and filters imports through
them, and the two reads are **atomic: no terms, no rows.** A memory that arrives
without its suppression list is not a partially-good feature, it is a consent
defect. [SS-6] is the positive control (the row really does import), [SS-7] the
suppression.

**Decision 3 — the imported rows are not labelled with their surface.** They
join the same two sets the home rows are in and nothing downstream learns where
they came from. A row tagged with its origin is a row a model will eventually
narrate ("you told me this on WhatsApp"), which is both wrong and creepy. Which
set a row joins is decided by the rule the home legs already use — words present
means it word-matched means it is an ANSWER; no words means CONTINUITY.

**Decision 4 — dedup by NAME and the home row wins.** The same person's "amma"
on two devices is two ids and one meaning; an id-dedup renders her mother twice.
The home row wins because it is the one whose salience and mentions this
device's conversations actually moved.

**Decision 5 — a cap of 6, and no relations.** Deliberately smaller than the 14
the two home legs return together: a bigger cap would let another surface's
memory outweigh this one's. Relations are not imported at all — edges between
two imported rows would need a second import and a second dedup. Both are why
the residual after the fix is 13.5% rather than 0, and the residual is printed
in the run so it cannot be mistaken for "fixed".

**What is deliberately NOT done, and it is the larger half.** The legacy FORGET
lane is still device-scoped: a whole wipe on the web leaves the Telegram
`meera_nodes` rows standing. That is a defect TODAY, independent of this leg
(the whole wipe detaches the wiping device from the person, so this leg cannot
reach those rows and does not worsen it — but it does not fix it either).
Widening a DELETE's blast radius with no live database to verify the SQL against
is exactly what `offline-mocks-cannot-type-check-sql` forbids, and a half-done
forget is the worst possible half. Filed as `legacy-forget-is-device-scoped`
(open), with the fix stated: resolve the person's device set once and pass it to
every legacy-lane statement in `opForget`, smoke-tested against the real
database first.

**What would reverse this.** If a live smoke test shows the leg's two statements
failing (a uuid/text mismatch in the subquery is the plausible one), the leg is
dead weight and either gets fixed against the real types or removed — and
removing it costs nothing, which is the property Decision 1 bought. If the
imported rows measurably degrade answer PRECISION in a keyed run — a real risk,
since they are imported without the ranking context of their own device — the
cap comes down or the leg becomes words-only.

**Gate.** `node evals/run.mjs recallbench` §3c: [SS-1] the pre-fix loss is real,
[SS-2] the leg restores most of it, [SS-3] neither call errored, [SS-4] the home
device is unchanged, [SS-5] the fail-safe degrade, [SS-6]/[SS-7] the consent
pair. Plus the router itself gained device scope — it used to serve fixture rows
to any caller, which made this whole class of defect invisible while every
assertion stayed green.

## `ws-o-live-verified` — migration 056 applied and the recall path smoke-tested (2026-08-26)

WS-O shipped bi-temporal validity, the cross-surface recall leg and the
example-format harness, and correctly refused to claim any of the DB work
verified (it had no live database). Verified here, in the main loop:

- **Migration 056 applied** to the live Neon project. `valid_from`/`valid_to`
  present on BOTH `vy_fact` and `meera_nodes` (the renderer carrying
  `stale-note-keys-on-row-age` reads the legacy store, so the tidy
  `vy_fact`-only migration would have fixed nothing), with the order checks
  and read indexes.
- **The real recall path returns 200** against the live database with the new
  leg and validity columns in place (`api/memory.js` `op:recall` and
  `op:remember`, both 200). This is the smoke test WS-O named as owed.
- Incidentally confirmed WS-M's improved error surface working: a deliberate
  type mismatch now reports `neon 400: 42883 operator does not exist:
  uuid = text` instead of a bare `neon 400`.

The headline measurement stands and is the most important number of the
session: **89.2% of recall was lost when a person moved between surfaces**
(44 questions, identical rows, `device_id` the only variable, negative
control by making the new statements throw); the leg closes it to a named
13.5% residual. `api/_surface.js` had stated the law — "memory is never
keyed by surface" — while retrieval violated it.

Still open and deliberately not done: `legacy-forget-is-device-scoped` (a
whole wipe on one surface leaves another surface's legacy rows standing).
Widening a DELETE's blast radius is exactly what
`offline-mocks-cannot-type-check-sql` forbids without a live verification,
and a half-done forget is the worst possible half — it is the first thing
the next keyed session should do.

## `session-2026-08-26-close` — the gurukul session, logged before compaction

**What this session did:** founded the Vyakti/Gurukul product on
`claude/gurukul-platform` (PR #5) as the verified union of the RelationalOS
companion line and the voice-cloning Replica Lab, then ran eleven build
workstreams (WS-A/B/C/D/E/F/G/I/J/L/M/N/O/P/Q) plus a three-sweep research
fleet, and took the platform LIVE for the first time.

**Live and verified (each by a real call, not a claim):** Neon with migrations
015-056 applied (113 tables); the new Supabase project with Google OAuth +
6-digit email OTP both proven end to end; the teacher studio at
`vyakti-replica-lab.vercel.app`; replica create/list and the memory recall
path both returning 200 against the real database; the in-house Chatterbox
voice stack on Azure GPU (scale-to-zero, RTF 0.79 warm, ~$0.35 spent).

**The measured headline:** 89.2% of recall was being lost when a person moved
between surfaces — `api/_surface.js` stated the law and retrieval violated it.
Closed to a named 13.5% residual.

**The defect classes this session taught the project** (all in rejected.md):
`offline-mocks-cannot-type-check-sql` (a mocked DB proves control flow, never
types — it hid two live-only defects), `aliveness-was-unreachable-not-meera-
bound` (both ends of a seam complete, nothing passing the argument: grep for a
CALLER not a definition), `readiness-probe-only-is-fatal`,
`gpu-usages-api-says-nothing-about-serverless`, `month-prefix-parse`.

**The honest gap, stated plainly:** every ingestion and voice pipeline is
built, gated and deployed, and NONE has processed a real human yet. See
STATE.md's pipeline table. The first consented teacher ingest is the highest-
value next action in the whole project; it needs the Sarvam key in Vercel env,
a consented upload (not YouTube — that lane is lawfully blocked), and one
voice-evidence round trip.

**Open, owner:** SMTP app password; rotate everything pasted into this
transcript (Neon, Supabase keys + management token, Azure SP, Google OAuth);
`CLONE_WIDGET_SESSION_SECRET`; channel secret backend decision.
**Open, engineering:** `legacy-forget-is-device-scoped` (a whole wipe on one
surface leaves another's legacy rows — needs a live-verified widened DELETE,
first thing next session), WS-R's four defects (in flight), the voice quality
bench, and `vy_channel_watch` having no writer.

## `explain-is-the-only-parser-we-have` — EXPLAIN against the live DB is a gate input, not a debugging step (2026-08-26)

WS-M's sweep found three shipped statements that Postgres refuses at PARSE
time (0A000) — a bare `for update` over a `left join`, and two data-modifying
CTEs with no `RETURNING` that something referenced. WS-R fixed them. None had
ever executed, for anybody, on any call; the offline suites mock the database
and so never ask Postgres to parse anything, which is why 5,000 green checks
said nothing. `EXPLAIN (verbose, costs off)` plans a statement without running
it, needs no valid data and no write, and answers exactly the question the
mocks cannot: **will Postgres accept this at all.**

So EXPLAIN against the live database is now the accepted evidence for "this
statement works", alongside the offline static gate, and a claim that a query
is correct without one is a claim nothing checked. It costs one round trip.

**Reversal condition.** If a statement class appears that EXPLAIN cannot reach
(one whose text is assembled from data at runtime, say), the class needs a
different proof and this rule must say so rather than quietly not covering it.

## `owner-lane-erasure-is-not-the-person-manifest` — two erasure paths, on purpose (2026-08-26)

48 tables carry `owner_user_id` — the replica owner's Supabase auth id, a
natural person — and none of them is in `PERSON_TABLES`. The instinct is to
add all 48. That would make erasure WEAKER: the replica lane's rows are the
only pointers this system has to objects OUTSIDE Postgres (provider Personal
Voice, private-bucket originals and derivatives, Azure face sessions), and
`docs/REPLICA-ERASURE.md`'s chain deletes those FIRST and the rows LAST
precisely because a row deleted early is an object nobody can find again. A
manifest loop issuing `delete from vy_replica_source` would strand a person's
biometric audio in storage while the receipt said it was gone.

So: the **person** lane (person_id / device_id / subject_person_id) is erased
by the `PERSON_TABLES` manifest loop, the **owner** lane by the erasure job.
A table naming both people — a runtime capability, session or dialogue turn —
is in BOTH, because both claims are real and they are answered by different
paths, and nothing is stranded since those three point at no outside object.

The exclusion is CHECKED rather than asserted: `scripts/relcheck.mjs` walks the
live FK graph and requires every owner-keyed table to be reached by ON DELETE
CASCADE from `vy_replica` or named outright in `api/_replica-full-erasure.js`.
That walk immediately found three tables reachable by neither (053 and 055
declare `replica_id`/`owner_user_id` FK-shaped but not FK), which is the
argument for writing the check instead of the sentence.

**Reversal condition.** If a teacher-facing "delete my account" is ever needed,
it gets its own op that CALLS the erasure job per replica. It does not get rows
in `PERSON_TABLES`. And if a replica-lane table is ever added that holds only
Postgres-local content with no outside pointer, the stranding argument does not
apply to it and it may join the manifest — the argument is about pointers, not
about the prefix.

## `youtube-extraction-in-house` — we extract a teacher's own audio, gated on an attested consent artifact (2026-08-26)

WS-S. `api/_channel/providers/youtube-oauth.js`'s `fetchAudio` was an honest
refusal — the YouTube Data API genuinely has no download endpoint, and
`captions.download` returns only MANUALLY-uploaded caption tracks, never the
auto-generated ones. That was correct about the facts and wrong about the
conclusion: it treated a **ToS** question as if it were the whole legal
question. The owner directed (2026-08-26, verbatim substance: *"get that
YouTube thing working correctly. We will obviously take the consent of the user
that it's their channel only"*) that we solve it in-house, and independently
arrived at the same consent posture the brief specified.

**The distinction the whole decision rests on.** Copyright permission and ToS
permission are different things. Copyright permission comes from the **rights
holder** — for a teacher's own lectures, the teacher — and covers making and
using a copy; it is the permission with statutory damages attached. ToS
permission comes from **YouTube** and nobody else can grant it. **Only the
first is ours to obtain, and it is the large one.** So: we extract on copyright
permission obtained from the rights holder, and we accept a residual
**contractual** exposure to YouTube that no permission we can collect
eliminates. The remedies for that residual are account action or a civil
breach-of-contract claim, not copyright damages. Sources and dates in
`docs/gurukul/youtube-extraction-posture.md` §5; **not reviewed by a lawyer**,
and that page says so in those words.

**Why the gate is four layers and not a checkbox.** The property being
protected is "this is not a general-purpose downloader", and
`gate0-structural` is the governing measurement (prompt instructions leaked
57-98%; the SQL predicate leaked 0 of 31,122). So:

1. `createChannelWatch` INSERTs its row by SELECTing from a live attestation —
   a watch cannot exist for an unattested channel;
2. `attestationForWatch` joins on `attestation_id` AND `channel_url` AND
   `owner_user_id` with `revoked_at is null and expires_at > now()` — a
   pre-057 row with a NULL `attestation_id` matches nothing, so old rows fail
   closed rather than being grandfathered;
3. the provider refuses without an envelope and re-checks channel identity;
4. the SERVICE takes an 11-character video id (a URL cannot be expressed),
   resolves the video's uploader from YouTube's own metadata *before
   downloading a byte*, and refuses on `channel_binding_mismatch`. It will also
   PUT to exactly one configured host and refuses to start without one.

**Migration 057 chose a new table over a new `vy_replica_consent` scope**, and
the reason is a key, not a preference: that table is keyed by SCOPE — a verb —
and this permission needs the OBJECT of the verb (`channel_url`) to be a column
a WHERE clause can name. A channel URL in `metadata jsonb` cannot be uniquely
indexed per-channel and cannot be joined against `vy_channel_watch.channel_url`.
The receipt CONSTRUCTION is reused verbatim in shape (canonical JSON → sha256,
named `statement_set`, granted/expires/revoked, revoked rows kept).

**The safest lane still runs first, with no flag.** `transcriptFor` tries owner
OAuth captions before extraction on every video, so on any video where the
sanctioned path works, extraction never happens. Direct upload remains the
zero-exposure lane. Extraction exists because captions cover a small minority
of an hour-long Hinglish lecture corpus and because a caption file has no
audio — words without the person.

**It also closed WS-M's gap:** nothing in `api/` ever INSERTed into
`vy_channel_watch`, so the stays-current loop had a worker, a cron, a schema and
a review UI and no way to be started. `api/channel-watch.js` starts it, behind
the same gate. And a second cursor (`backfill_after_video_id`, oldest-first,
resumable, subordinate to the forward lane) reaches the back catalogue, which
is the corpus the owner is actually after.

**NOT established: that this works against real YouTube.** No extraction has
been run from the deployment. The sources say datacenter IP ranges
(Azure included) get `LOGIN_REQUIRED` at the player API before any stream URL
is returned, so the honest expectation is a material chance the first live
attempt returns `channel_extract_extractor_bot_check`. Every such failure is a
typed `vy_ingest_run.failure_code`, and the levers (`MEDIA_EXTRACT_COOKIES_FILE`,
`MEDIA_EXTRACT_PROXY`, `MEDIA_EXTRACT_PLAYER_CLIENTS`) are wired and off.

**Reverses if:** (a) a lawyer reviewing §1-2 of the posture doc says the
residual ToS exposure is not acceptable at multi-teacher scale — in which case
the lane is disabled by removing two env vars, with no code change, and the
product falls back to captions + direct upload; (b) measured extraction success
from the deployed egress stays below roughly half after cookies, a proxy and a
player-client change have all been tried, at which point the cost of the lane
exceeds what it returns and teacher-side export becomes the honest ask; or
(c) YouTube ships a sanctioned owner-download API, which would make this whole
service obsolete and should retire it rather than sit beside it.

**A pinned extractor is a pin with an expiry.** `yt-dlp==2026.8.19`, and
`services/media-extract/README.md` §"Update policy" is the procedure: bump on
any `extractor_signature_failed` / `extractor_po_token_required` /
`extractor_bot_check`, monthly at minimum, never unpin —
`vy_ingest_run.stats.extractor_version` records the version precisely so two
corpora stay comparable.

## `attestation-caught-by-its-own-gate` — the erasure-reach gate caught a table hours old (2026-08-26)

WS-S's migration 057 created `vy_channel_attestation` (the teacher's recorded
statement that they own a channel). WS-R's `relcheck` owner-lane reach walk —
written earlier the same session, which requires every `owner_user_id`-carrying
table to be reached by cascade from `vy_replica` or deleted by name in
`api/_replica-full-erasure.js` — **failed the build the moment the table
existed**, before the merge was pushed. Fixed by naming it in the erasure job
(the sibling pattern of `vy_ingest_run`/`vy_channel_watch`/`vy_clone_channel`).

Why it mattered: an attestation outliving the replica is a standing record
that a named person authorised cloning a named channel — precisely the claim
revocation exists to end. It is also exactly the class WS-R had just fixed by
hand for three tables; the difference is that this one was caught by a
predicate in under an hour instead of by an audit months later.

The general law, now demonstrated rather than argued: **a coverage rule
enforced by a walk over the live schema keeps working as the schema grows; a
coverage rule maintained as a list rots the moment someone adds a table.**
Reverses if: the walk starts producing false positives that push people to
weaken it — then narrow the rule, never disable the walk.
## `first-clone-is-the-entry-point` — one command owns the whole chain (2026-08-26, WS-T)

**The decision.** `scripts/first-clone.mjs` is the single supported way to take
a consented audio file to a fidelity number, and it is the command the owner
runs with their own voice:

```
node scripts/first-clone.mjs <audio.wav> "<display name>"
```

**Why one script rather than a documented sequence.** Every pipeline in this
repo was built and gated long before any of them had processed a human, and the
reason is visible in what one live run found: three wrong Sarvam addresses, a
storage finalize that could never succeed, an HMAC window shorter than its own
cold start, and a tokenizer that shredded Devanagari. Not one of those is
reachable from a document describing the steps — each needed the steps actually
taken, in order, against the live services. A runbook cannot fail; a script can,
and that is the whole point of it.

**The two rules it enforces on itself**, both learned here rather than assumed:

- *No stage is ever skipped silently.* A missing credential prints a `SKIP` row
  naming the exact environment variable, and the process exits non-zero if any
  stage did not run green. `gates-that-live-nowhere` is the precedent: a gate
  that quietly does nothing reports a pass on a tree it never read.
- *No number is carried forward unless a live service returned it in this run.*
  Where a stage cannot produce a number the row says so. It never prints a
  default as though it were measured.

**What would reverse this.** If the studio grows a server-side job that drives
the same chain from an uploaded file — which is where the product is going, and
what `api/_replica-processing/worker.js` is shaped for — this script becomes a
local debugging tool rather than the entry point. It should then be rewritten to
call that job and poll it, not deleted: the value is that one command exercises
every seam in one process, and that stays true whoever runs the middle.

## `fidelity-needs-its-ceiling-printed` — a similarity score without a self-vs-self control is a decimal with no top (2026-08-26, WS-T)

**The decision.** Every fidelity run reports two numbers: the clone against the
subject, and the subject against THEMSELVES across different windows of the same
recording. `scripts/first-clone.mjs` computes both and prints both.

**Why.** The first real measurement makes the case on its own. The clone scored
**0.7753** — which reads as mediocre against `DEFAULT_FIDELITY_POLICY`'s 0.85
target, and reads very differently once you know the subject's own voice scores
**0.8869** against itself on the same recording, the same windowing and the same
model. The clone is at 87.4% of the ceiling that scale physically reaches for
this speaker. `api/_fidelity.js` already says its thresholds are provisional and
"shaped from the ordinary published range for ECAPA-TDNN VoxCeleb" rather than
from anything of ours; the self-vs-self control is the cheapest possible step
toward numbers that are ours, because it comes free with evidence already
collected and it is per-subject, so it also absorbs recording quality.

**Corollary already paid for.** The same run measured the x-vector family at
**0.997** clone-vs-reference. That is not a second opinion, it is a saturated
statistic — raw cosine over x-vectors without PLDA does not discriminate. The
choice of ECAPA in `api/_fidelity.js` is now measured rather than argued.

**What would reverse this.** A bench over genuine different-speaker controls
that fixes an absolute floor and ceiling for the scale. Once the distribution is
known from a population, a per-run self-control becomes a redundant second
measurement of something already established — and until that bench exists, an
absolute threshold is exactly the dogma-with-a-decimal-point the module warns
about.

## `forget-follows-the-person` — the legacy forget lane widened from the device to the person (2026-08-26, main loop)

**The decision.** `opForget` resolves the person's whole device set once
(`personDeviceSet`, capped at 64, built from `vy_person_device`) and every
legacy-lane statement it owns takes `device_id = any($n)` over that set — the
node/edge/log deletes, the suppression list, telemetry, diag, the synced blob,
events, the turn trace, the photo sweeps, and the manifest wipe loop
(`wipeWhereSql` grew an opt-in `deviceSet` flag; `export.js` keeps the narrow
default). This closes `legacy-forget-is-device-scoped`: a whole wipe asked for
on the web now takes the Telegram rows too.

**Why this shape.**
- *Resolved once, threaded down* — a set re-read between two statements can
  tear, and a torn forget strands edges whose nodes are already gone.
- *Fails closed and narrow* — if the mapping read throws, the set degrades to
  `[device]` (today's behaviour). For a forget the safe failure is deleting
  LESS than asked and hedging the receipt, never more.
- *Rooms are unreachable by construction* — the set is built from
  `vy_person_device` and a room's synthetic device is in nobody's mapping, so
  a personal wipe structurally cannot take a room's shared history.
- *The suppression list is written per device, on every device* — a term
  suppressed only where it was asked would be re-derived on the other surface
  from that surface's own turns, and the forget would come undone by the back
  door.

**Verified live, not assumed** (`evals/forget/crosssurface.mjs`): the offline
arm is a structural gate in `evals/run.mjs` (`forgetxs`) proving no predicate
narrows back to `= $1`; the `--live` arm seeded two surfaces of one synthetic
person plus two negative controls against the real database, wiped through the
real handler, and got: both surfaces empty, another person's rows SURVIVE, a
group room's rows SURVIVE, the identity mapping gone. 39/39.

**What the live smoke test caught that review could not** — and why the rule
"smoke-test a widened DELETE against the real database first" was the right
paranoia: five legacy tables (`meera_tel`, `meera_tel_session`, `meera_diag`,
`meera_turn`, `meera_turn_leg`) carry a TEXT `device_id`, not uuid, so the
uniform `any($1::uuid[])` cast was 42883 on exactly those five and nowhere
else. And the recount statement briefly carried `$1::text[]` and `$1::uuid[]`
in one statement — the exact one-type-per-parameter law WS-M documented,
recommitted within a day. Every one of the 32 widened statement shapes now
EXPLAINs clean against the live catalog.

**What would reverse this.** A person-merge feature (two humans' devices mapped
to one person) would make this wipe over-broad by design and the set would need
a consent boundary; and if `vy_person_device` ever grows rows for room devices,
property 2 collapses and the eval's room control catches it.
## `earbench-is-the-listening-instrument` — the blind bench the fidelity law already depended on (2026-08-26, WS-V)

**The decision.** `scripts/earbench.mjs` + `evals/earbench/` is the one supported
way to ask a human how a cloned voice sounds. It builds a blinded, matched,
counterbalanced stimulus set through the REAL deployed runtime, serves a local
listening page, and scores ABX plus a three-axis rating pass against a sealed
key. Run instructions: `docs/gurukul/EARBENCH.md`.

**Why it had to exist before any quality claim.** The fidelity law
(`api/_fidelity.js`, SPEC-GURUKUL §8.2, and `fidelity-needs-its-ceiling-printed`
above) makes the ECAPA cosine a regression monitor and puts activation quality
behind a blind owner pass. That pass had no instrument. The project therefore
had `first-real-clone`'s 0.7753/0.8869 and **nothing at all** about how the
clone sounds — and `rejected.md#azure-tts` is the case where exactly that gap
produced a unanimous measured "switch" and a correct human "no".

**The five choices worth naming, each with what would reverse it.**

1. **Three verdicts, not two.** `distinguishable` / `indistinguishable-from-
   chance` / `inconclusive`, with an equivalence bound (0.65) and an exact
   binomial plus a Wilson interval behind each. "Not significant" is never
   reported as "no difference": at n=6 a 50% score is under-powered, and a bench
   that called that equivalence would license the strongest claim the product
   can make off the weakest run it can do. *Reverses if* a listener panel large
   enough to make the equivalence region uninformative becomes routine — then
   the bound is doing nothing and should be re-derived from the panel's own
   spread rather than fixed.
2. **Accent authenticity is its own axis**, alongside similarity and
   naturalness, on the direct instruction in `azure-tts`. *Reverses if* a run
   ever shows accent and similarity moving together across every arm and every
   listener — that would make it one axis measured twice. It has never been
   measured at all, so this is a standing instruction, not a finding.
3. **Content is matched across arms.** The default path transcribes the
   consented reference (Sarvam batch, the lane `first-clone.mjs` already uses)
   and makes the clone say the speaker's own sentences over the speaker's own
   recordings of them. Otherwise "which is the clone" is answerable off the
   WORDS. The scripted-corpus fallback still exists and every report it produces
   says "content is a cue" in its own text. *Reverses if* ASR quality on the
   subject's speech is bad enough that matched items are wrong transcriptions —
   then a scripted corpus read aloud by the subject is the better reference
   recording, and the fix is at capture time, not here.
4. **No mock arm, ever.** Clone stimuli come from the deployed Chatterbox
   runtime or the command refuses and writes nothing. A bench whose synthetic
   arm was produced by something other than the thing that ships measures
   nothing that ships. *Reverses if* never — this is the `offline-mocks-cannot-
   type-check-sql` law applied to audio.
5. **It is not a CI gate.** The mechanical self-check IS wired into
   `evals/run.mjs` (and so into `verify-release`'s eval-suite gate) because an
   unblinding bug is silent and only a test can see it. The listening pass is
   deliberately unreachable from CI: a gate that waits for a human to put
   headphones on wedges every build until they do. *Reverses if* an automated
   listener ever becomes trustworthy on accent identity, which nothing in
   `voice-stack.md` suggests is close.

**What this decision does NOT license.** Any statement about how any clone
sounds. No human has listened through this bench. The instrument is verified
mechanically — including a simulated perfect discriminator and a simulated coin
flip being reported differently — and mechanically only.

## `owner-intent-is-the-spec` — the owner states intent; the platform fills every gap at a no-compromise bar (2026-08-26, owner directive)

**The directive, in substance.** The owner will state intent, not requirements
("i'm obviously not mentioning everything"). Everything around an intent —
product shape, tech choices, design, UX, flows, states, copy — is this
project's to figure out and to figure out WELL. Three explicit quality poles:
(1) voice + human-ness cracked "like no one in the industry"; (2) UI/UX/product
flow "amazing and very well thought out"; (3) no compromises, restated. This
extends the founding "speed and quality are never traded away" from execution
quality to PRODUCT quality: an unpolished-but-working flow is now a defect,
not a milestone.

**What it changes in practice.** Every workstream brief must cover the
product/UX half of its feature, not just the mechanism: honest states, copy,
flow position, and how it composes with the rest of the journey. A feature
that lands mechanically complete but experientially rough is HALF-DONE and
stays on the open list. The studio's journey (land → sign in → create →
upload → consent → sheet → preview → mirror call → deploy) is a single
product surface and needs a coherence owner, not per-feature patches.

**What would reverse this.** Only the owner narrowing it. A cost or deadline
pressure does not — the owner has pre-answered that trade twice.
## `preview-cold-start-is-a-state` — the panel tells the truth about a sleeping GPU (2026-08-26, WS-W)

**The decision.** `/api/voice-preview` — the studio's "Preview my voice" panel —
answers with **three** outcomes, not two: `200` audio, `4xx/5xx` error, and
**`202` warming**. The warming answer is a first-class, structured state
(`stage`, `eta_seconds_low/high`, `retry_after_ms`, `Retry-After`) that the UI
renders as a countdown that retries itself.

**Why.** `docs/gurukul/AZURE-DEPLOY-STATE.md` §8 measured the two facts that
make an audio-or-error contract a lie on this stack: the GPU runtime is ready
**161 s** after a wake, and **the request that woke it died at 242 s** on a
Container Apps `504 stream timeout`. There is no honest way to render that in a
two-outcome contract. Every alternative was available and is worse: a spinner
held open until the platform kills it (a four-minute lie that ends in a
generic failure), a fake progress bar (a lie with a shape), or an error for a
service that is merely asleep — which trains an owner to distrust a working
product.

**Four sub-decisions inside it.**

1. **Nothing is signed until the unauthenticated `/healthz` answers 200.**
   Directly inherited from `rejected.md#hmac-skew-shorter-than-cold-start` and
   `scripts/first-clone.mjs`'s `warmEvidence`. The broker's skew window is 60 s
   (`services/open-voice-runtime/broker.py`, `MAX_CLOCK_SKEW_SECONDS`) and its
   own cold answer is 21.8 s — comfortable, but only because the wake happens
   first. *Reverses if* the broker ever gains a route that wakes the GPU app
   without synthesising; then the probe becomes a real readiness check instead
   of a front-door check and the flush window below can go away.
2. **The cold request IS the wake, and it is dispatched rather than awaited.**
   The broker forwards only `POST /v1/synthesize`, so nothing else can wake the
   runtime. The handler sends it, stops WAITING after `flushMs` (12 s), and
   deliberately does **not** abort the signal — aborting would cancel the
   forward and undo the very wake the timeout exists to survive. *Reverses if*
   a warm-pool or minReplicas≥1 posture is adopted during active hours
   (`AZURE-DEPLOY-STATE.md` §11 item 4), which makes the whole branch dead code.
3. **Warmth is a per-process hint, never an authorization input.** Same shape
   and same honesty as `api/_ratelimit.js`. A false "cold" costs one extra 12 s
   probe; a false "warm" costs one long request that ends in the same warming
   answer. Both fail into honest states. *Reverses if* the panel ever needs
   cross-instance warmth — that wants a row or a cache, and the moment it has
   one it must still not become an input to who may synthesise.
4. **A wrong key is never reported as a cold start.** `classifyPreviewFailure`
   maps `open_voice_unreachable` / `open_voice_http_5xx` / timeouts to warming
   and leaves `transport_binding_invalid` an error, because WS-L's negative
   control at the broker exists precisely to keep those apart and folding them
   on the client would undo it. *Reverses if* never — this is the same
   reasoning `isquota-only-folding` was rejected under.

**Also decided: the panel does not fork the fence.** It calls the same
`beginOwnedVoicePreview` as the calibration lab, so ownership, self-subject
mode, age/identity/liveness, the three live consents and the
selected-enhance-artifact-of-a-ready-source predicate are one piece of SQL with
one caller-visible behaviour. *Reverses if* the panel ever needs a genuinely
different eligibility rule — in which case it gets its own named fence and its
own negative control, never a relaxed copy of this one.

**What this decision does NOT license.** Any claim that the panel has produced
audio. It has not: no Azure credentials exist in the sandbox this was built in,
so the synthesis half has never run from this code path. See
`measurements.md#voice-panel-admission-probe` for what WAS measured.
---

## `mirror-learning-is-selection-not-accumulation` — the Mirror Call's voice loop learns by choosing, not by collecting (2026-08-26, WS-Z)

Research sweep: `docs/gurukul/research/mirror-learning.md`. Scope: the academic
and open-source state of the art for ongoing/online mirroring — incremental
voice adaptation, online persona learning from conversation, human-in-the-loop
calibration UX, and continual-learning pitfalls — against the build shape in
`docs/gurukul/MIRROR-CALL-SPEC.md`.

**The finding that forces the decision is a code read, not a paper.** In
Chatterbox — our pinned, MIT-licensed primary — `prepare_conditionals()` slices
the reference twice before the model sees it: `DEC_COND_LEN = 10 * S3GEN_SR`
(10 s for the S3Gen conditioning) and `ENC_COND_LEN = 6 * S3_SR` (6 s for the
T3 speech-prompt tokens). `s3gen.embed_ref()` prints
`"WARNING: s3gen received ref longer than 10s"` above that. `generate()` takes
one `audio_prompt_path`; there is no multi-reference input.

So the spec's voice loop — "call audio accumulates into the reference set…
the next clone turn synthesises off the enriched reference" — is **mechanically
inert under the model we actually ship**. Turn 40 of a Mirror Call conditions
on at most 10 s, exactly as turn 2 did. Our own numbers sit exactly where this
predicts: ECAPA **0.7753 at 71 s** against a **0.8869** self-vs-self ceiling
(`first-real-clone`). 71 s is already seven times the truncation window, so the
residual gap is **not a reference-duration deficit** and no amount of call audio
closes it.

**What is decided.**

1. **The voice loop's mechanism is reference SELECTION over an accumulating
   pool, cached as a Chatterbox `Conditionals` blob** — not accumulation.
   *Reverses if* the truncation experiment (§5.1 of the sweep: full-71 s vs
   first-10 s vs three different 10 s windows) shows full-length conditioning
   beating the truncated slice — which would mean the shipped code path is not
   the path we are actually calling — **or** if we move off prompt-conditioned
   TTS to a matching-set architecture (kNN-VC family), where more minutes
   genuinely buy coverage (5 min knee, degrades below 30 s, arXiv:2305.18975).
2. **The fidelity meter splits into two labelled numbers**: how well we can
   MEASURE the owner (grows with the pool, ECAPA over all windows) and what the
   next turn will SYNTHESISE from (the selected window). One number that moves
   while the clone cannot have changed is the same class of defect as
   `disclosure-announces-the-clone`. *Reverses if* the two are ever shown to
   move together on real calls — then one number is honest.
3. **Owner-only admission is a hard predicate on BOTH learning paths** —
   reference windows and transcript mining. No window overlapping a
   clone-speaking interval; an ECAPA floor against the enrolled profile; a
   second speaker never admitted. Grounds: recursive-training collapse
   (Shumailov et al., Nature 631:755–759, 2024 — tails of the distribution
   disappear irreversibly; remedy is fresh human data plus serious filtering of
   generated data), and consent, since a third party audible on the owner's
   side consented to nothing. *Reverses if* never for the consent half; the
   collapse half reverses only on evidence that clone-audio re-ingestion is
   provably neutral at our scale, which nothing suggests.
4. **The personality and feedback loops take CIPHER's shape** (Gao et al.,
   NeurIPS 2024, arXiv:2404.15269): induce a *described* preference from a
   correction, key it to context, retrieve k=5 at generation, keep it
   human-readable and editable. Its Table 2 carries two results we act on: an
   induced description beats replaying the raw edit (CIPHER 32,974 vs
   ICL-edit 39,734 cumulative edit distance on summarization), and **a single
   rolling, continuously-overwritten global preference LOST to not learning at
   all** (Continual-LPI 57,915 vs no-learning 48,269). That is published
   evidence for persona-collapse-to-the-last-session, and it means deltas are
   additive and context-keyed with citations, never a wholesale field rewrite.
   *Reverses if* an in-house A/B shows a single consolidated sheet field
   beating context-keyed retrieval on our own transcripts.
5. **No gradient-based preference learning from Mirror Call feedback in v1**,
   and **no unattended self-critique loop between calls.** The feedback shape is
   unpaired (a 👎 gives a rejected turn and no preferred one) and the volume is
   tens of judgements per call; and self-correction without external feedback
   can degrade performance outright (Huang et al., ICLR 2024,
   arXiv:2310.01798). The owner on the line IS the external signal; without
   them the loop does not run. Feedback events are logged in a KTO-compatible
   unpaired desirable/undesirable shape and left there. *Reverses if* the logged
   corpus reaches a scale where a held-out preference-learning run beats the
   prompt-level store on our own probe set.
6. **The chip rail is weighted to FEATURE queries with a per-minute budget.**
   Cakmak & Thomaz (HRI 2012) found feature queries preferred (72% called them
   the smartest) and that people dislike a constant stream of questions. "You
   say 'basically' a lot — add to phrase habits?" is a feature query; "was that
   turn good?" is a label query. 👍/👎 stays available but the clone never asks
   for it. *Reverses if* our own acceptance-rate-by-chip-type measurement
   inverts the ordering. **[the 72% figure is search-summary tier — the PDF
   would not decode; re-read before quoting it to the owner]**
7. **Chips carry evidence counts and confidence accumulates ACROSS calls.**
   Stylometry's published floor is 2,000–5,000 words, with <3,000-word samples
   producing >60% false attribution; our own arithmetic puts a 30-minute Mirror
   Call at ~1,800–2,300 owner words — below every threshold. One call cannot
   make a reliable idiolect claim, so a chip is a hypothesis with a visible n.
   *Reverses if* a measured word count per real call lands materially above
   5,000. **[the stylometry thresholds are search-summary tier — both Eder PDFs
   failed to decode]**
8. **One LoRA adapter per expert, composed at load — never sequential
   fine-tunes on a shared base**, with a regression re-measure of a previously
   fine-tuned voice after each new one lands. Sequential per-speaker adaptation
   collapses a multi-speaker TTS toward the newest speaker
   (arXiv:2103.14512). *Reverses if* a measured run shows voice A's floor
   unmoved after N sequential fine-tunes.

**What this decision does NOT license.** Any claim that the Mirror Call makes a
clone measurably better. Nothing here has been measured on our stack — the
truncation experiment (the cheapest and most decision-relevant, one GPU-warm
session and no new code) has not been run, and the selection ceiling (how much
of the 0.7753 → 0.8869 gap best-window selection recovers) is the number that
decides whether the voice loop is worth building at all. Also: **no paper found
in this sweep evaluates a Mirror-Call-shaped loop end to end.** We are past the
literature, which is why these measurements are not optional.

**Rejected outright, with reasons in the sweep:** denoising accumulated call
audio before it becomes reference (the one primary measurement says enhancement
raised UTMOS/DNSMOS and LOWERED speaker similarity, SECS 0.35 → 0.28,
arXiv:2602.05770); persona vectors / activation steering (needs open weights
and activation access we do not have — arXiv:2507.21509 — re-open if the brain
moves in-house); seed-vc (GPL-3.0 and archived read-only) and WeClone
(AGPL-3.0) as code, though WeClone's Presidio PII-scrub stage is an idea we
adopt; multi-reference conditioning (does not compose with Chatterbox's single
`audio_prompt_path` without model surgery the audio-floor law forbids).

## `horizontal-platform-reweight` — anyone, any context, an exact human clone (2026-08-26, owner directive)

**The directive.** The platform is for EVERYONE, not a teacher vertical:
anyone logs their context — multiple files, multiple links, channels — and
builds an exact clone of themselves (mind + voice + relation + long-term
continuity), iterates on it frictionlessly until it is right, and deploys it
in multiple ways. Multimodality and "so many things around this" are implied,
not enumerated — `owner-intent-is-the-spec` governs the gaps. The bar
restated: human + mind + voice + relation cracked at a level no one has
reached; learn from the top research and projects, open AND closed, and take
the best.

**What this changes.** Edtech/JEE remains the FIRST VERTICAL and go-to-market
wedge — nothing built for it is discarded — but every new capability is built
person-generic first with the vertical as a configuration (the Kabir/
TeacherSheet precedent already proved personas are data). Concrete new gap it
names: ingestion today is YouTube-channel + voice-upload; there is no
universal "bring your context" lane (files, arbitrary links, documents, chat
exports) feeding the Person Model. That lane is now on the build list.

**What would reverse this.** Only the owner narrowing it. Evidence that the
horizontal surface dilutes the vertical's quality would trigger a sequencing
conversation with the owner, not a silent narrowing.
---

## `mirror-call-approval-is-the-tap` — the Call tab renders a delta as applied only on a server ack (2026-08-26, WS-Y)

**The decision.** The Mirror Call studio UI (`src/studio/MirrorCallStudio.tsx`,
`mirrorCallMachine.ts`, `mirrorCallApi.ts`, `callCapture.ts`) treats a delta chip
as APPLIED under exactly one condition: the server acknowledged an accept and
said the delta landed. Tapping accept renders "Applying...", never "Applied". A
failed accept returns the chip to actionable. At call end every un-actioned chip
is swept to `deferred` and shown, on screen, in a "Review later" tab that states
in its own copy that nothing in it was applied.

**Why this and not the obvious implementation.** The friendly version is an
optimistic accept — show it applied, reconcile with the server later — and it is
wrong for this specific screen. `MIRROR-CALL-SPEC.md` §laws: "the owner being
present and authenticated IS the approval channel, but presence alone is not
approval — the tap is." An optimistic accept makes the UI claim a sheet change
the server may have refused, which is SPEC-GURUKUL §8 item 3's silent
self-update wearing a checkmark. The property is fuzz-gated in
`evals/mirrorcall.mjs` (4000 pseudo-random event sequences, deterministic seed)
with its own negative control: a reducer that trusts the tap is run against the
same property and must fail it.

*Reverses if* the accept round-trip ever becomes slow enough that the honest
"Applying..." state reads as broken — and the fix then is a faster ack, not a
truer-looking chip. It does not reverse for a nicer interaction.

**The other five choices worth naming.**

1. **One client-contract file.** `src/studio/mirrorCallApi.ts` is the only file
   in the UI that knows a route, a JSON key or a wire shape. WS-X was building
   `api/mirror-call.js` on a parallel branch that did not exist on origin when
   this landed, so reconciliation had to be a single-file change rather than a
   grep across a component tree. *Reverses if* the contract stabilises and the
   indirection stops paying for itself — but the cost is one import, so this is
   close to free.
2. **No mock, ever.** A missing backend renders "not deployed on this
   environment" with the failing op named, and no connect button. A demo mode
   here would be indistinguishable from the product working, which is the
   `offline-mocks-cannot-type-check-sql` law applied to a screen. A `contract`
   handshake op exists precisely so "route absent" (404 on the handshake) is
   distinguishable from "session expired" (401) and "session gone" (404 on a
   real op). *Reverses if* never.
3. **Cascade, enforced by the capture layer.** `callCapture.ts` emits one ≤30s
   window at a time out of a microphone stream that stays open for the call. It
   cannot do duplex, because duplex means barge-in and barge-in lives in
   `liveCall.ts`, which the spec forbids this from touching. The 30s cap is
   enforced three times — a timer, a sample-count clamp, and a refusal in the
   API client — because a window silently cut in half is the
   `silent-truncation` shape. *Reverses if* the research un-pins cascade, which
   `ROADMAP-100X.md` §Voice does not.
4. **TWO fidelity meters, not one, and neither can grade the voice.** WS-Z's
   sweep (`docs/gurukul/research/mirror-learning.md` §1.1) read Chatterbox's own
   `prepare_conditionals` and found it truncates the reference to 10 s (s3gen)
   and 6 s (T3). Pooled call audio past that is mechanically inert for
   synthesis, while `voice-evidence`'s ECAPA estimate consumes the whole pool —
   so ONE climbing number beside a clone that cannot have changed would be a
   display moving for a reason the owner will read as a different reason, the
   `disclosure-announces-the-clone` defect class. The screen therefore shows
   "how well we can measure you" (rises as audio pools; says nothing about the
   clone) and "what the next reply is built from" (the selected ~10 s window;
   moves only on re-selection), with a note between them saying why they
   differ. The eval asserts the split as a property: the same pooling must move
   the first and must not move the second. `readMeasurementFidelity` /
   `readConditioningFidelity` / `fidelityStatusLine` own every word, and no
   branch of them may contain "sounds", "quality", "natural" or their family.
   With no printed self-vs-self ceiling both bars render EMPTY and say the
   number has no top, rather than borrowing another speaker's ceiling — the
   `fidelity-needs-its-ceiling-printed` rule as a UI state. *Reverses if* the
   voice stack moves to an architecture whose scaling law rewards accumulation
   (the sweep names retrieval VC, kNN-VC family, as that architecture) — then
   the two numbers describe the same thing again and one meter is honest.
5. **The rail is capped at three chips a minute, and every chip shows its n.**
   Adoption deltas A4/A5: feature queries are the preferred kind of question
   but "people do not enjoy a constant stream of questions", and a 30-minute
   call yields ~1,800–2,300 owner words — below every stylometric floor in the
   sweep (2,000–5,000 words; under 3,000 gives >60% false attribution). So the
   surplus falls to the review queue flagged as never-shown, and an n=1 chip
   renders visibly weaker than an n=9-across-three-calls chip. *Reverses if* an
   acceptance-rate study on this UI says three is the wrong number — the cap is
   a starting point nobody has measured, and the code says so.

**What this does NOT claim.** Nothing here has been exercised against a running
`api/mirror-call.js` — none existed on origin at the time of writing. Every
check is offline: the state machine, the chip property, the drop copy, the
two-meter arithmetic and its split property, the chip budget, the evidence
strength bands, and the wire normalizer against a dishonest payload. The
microphone path, the multipart ingest and the audio playback have never run in
a browser here and are marked unverified in `STATE.md`. The three-chips-a-minute
cap is a starting point, not a measurement: no acceptance-rate study has been
run on this UI, and the 72%-preference figure the cap rests on is itself flagged
`[UNVERIFIED]` in the sweep that produced it.

---

## `journey-is-a-surface-not-a-stack` — the studio's flow gets one owner, one design system, and a queue (2026-08-26, WS-AA)

**The problem, measured against the code rather than against taste.** The
studio is the union of ten parallel workstreams. Each built a good component
and placed it where the component made sense on its own, which produced a
1 475-line vertical stack of fourteen full-width panels with: two different
panels both numbered `04` (`ProcessingReview.tsx:117` and
`ModelConsentGate.tsx:74`) rendering in the opposite order to their numbers;
mandatory identity and liveness filed under a `<details>` labelled "Advanced";
the emotional peak of the product (hearing your own cloned voice) collapsed
behind that same widget and the only major panel with no anchor to link to;
a hardcoded `0 / No model trained` status literal; a three-step checklist whose
third step is hardcoded `next` and can never complete; every teacher shown the
demo teacher's name on the DISCLOSURE CONSENT screen
(`StudioApp.tsx:668/684/693` pass `DEMO_TEACHER`); Google sign-in returning the
user to a different product than the one they signed in from
(`studioAuth.ts:53` dropped `?mode=teacher`, which is the only thing selecting
teacher mode); 73 em-dashes in a repo whose one written typographic rule bans
them and whose lint does not scan `src/studio/`; and no landing page at all
(`/` was a meta refresh, `studio.html` is `noindex`).

None of these is a bad decision by any workstream. Every one is the absence of
a decision about the WHOLE.

**Decided.** (1) The journey is a product surface with a written spec
(`docs/gurukul/PRODUCT-JOURNEY.md`) that any workstream touching the studio
reads before placing a panel, exactly as `SPEC-GURUKUL.md` is read before
placing a capability. (2) The visual language is a system with values
(`src/studio/design/tokens.css`) and a description
(`docs/gurukul/DESIGN-SYSTEM.md`); the description changes first. (3) Work
designed but unsafe to land against contended files goes to an ordered queue
with target files (`docs/gurukul/UX-QUEUE.md`) rather than into a parallel
rewrite that loses a merge.

**Three sub-rules that are the actual content, each derived from a defect
above, not from preference:**

- **No literal in a status position.** A status must be derived from data or
  not shown. `StudioApp.tsx:629-633` and `QuickStartPath.tsx:140` are the same
  defect as a spinner that outlives its request: a display that cannot be
  distinguished from a working one while being wrong.
- **Progressive disclosure collapses what is OPTIONAL, never what is
  REQUIRED-but-later.** Identity proofing is not "advanced"; it is the gate
  `RuntimeGate` refuses activation without.
- **Hear yourself before you hand over your ID.** The phase that earns trust
  precedes the phases that spend it. This costs nothing in safety: the preview
  already cannot join a call or activate a replica, the runtime gate still
  refuses without identity, and source consent is already a separate scope
  from biometric consent.

**Landed now** (only files no sibling workstream is editing): the mode-drop fix
(`studioAuth.ts` + `main.tsx`, client-side so its correctness does not live in
a Supabase dashboard), the token file, `site/vyakti.html` as a real landing,
and the three documents. Everything requiring `StudioApp.tsx` or `studio.css`
is queued, because WS-W and WS-Y hold both.

**What would reverse this.** A measured finding that the phase reordering costs
completion — specifically, that teachers who hear a preview before identity
proofing complete verification at a LOWER rate than those who do not. That is
falsifiable and nobody has measured it; the current ordering was not measured
either, it was the order the components were built in. Also reversed if the
owner narrows `owner-intent-is-the-spec`, which is the only reason this
document has standing. The three sub-rules reverse only on evidence, not on
schedule pressure.

**Not claimed.** No teacher has used this product. Every item in the journey
audit is derived from source, from a spec in `docs/gurukul/`, or from a law
already in `context/`; judgment calls beyond that are marked `[taste]` in the
document. Nothing here is a finding about real users, because there are none.
## `adapters-travel-in-the-signed-body` — how a per-speaker fine-tune reaches the GPU (2026-08-26, WS-U)

**Decision.** A per-speaker LoRA adapter is sent to `open-voice-runtime` **inline
in the `/v1/synthesize` request body**, content-addressed by sha256, rather than
fetched by the runtime from an adapter store.

**Rationale.** The runtime is deliberately the least-privileged thing in this
system: environment-internal ingress, no tenant or person identifiers, no
credential for anything, one HMAC secret shared with the broker in front of it.
An adapter store would give it a second trust path — a URL to resolve, a
credential to hold, and a class of failure (fetched the wrong adapter, fetched a
poisoned one) that the request HMAC does not cover. Inline, the adapter is
covered by the **same** signature that already admits the call, verified by the
same digest check the reference audio already gets, and the service stays
stateless. It also mirrors an existing, working precedent: the reference audio
has always travelled this way.

The cost is real and bounded: an r=16 fp32 adapter is 15.8 MB, so an adapted
request is ~26 MB against the existing 32 MB `MAX_REQUEST_BYTES`. That is tight
enough to be the thing that reverses this.

**Reversal condition.** Move to a fetched store if **either**: (a) a rank, target
set or dtype is chosen that puts a typical adapted request over ~28 MB, since
the total request cap is the real constraint and raising it widens the
denial-of-service surface on a GPU service; or (b) the same adapter is sent on
enough consecutive calls that re-uploading it dominates latency — measurable as
adapter bytes per second of audio produced. Neither is true at the measured
r=16/120-projection configuration.

Measured by `lora-vs-zero-shot-71s`: 32 live adapted syntheses across two runs,
every one HMAC-bound, watermark-verified and correctly adapter-bound.

## `fine-tuned-synthesis-commits-to-model-and-adapter` (2026-08-26, WS-U)

**Decision.** An adapted response carries
`synthesis_commitment = sha256(model_commitment:lora:adapter_sha256)`, derived
independently by the runtime and by `api/_voice/providers/open-chatterbox-preview.js`,
with disagreement failing the call closed. Without an adapter the value collapses
to `model_commitment` exactly.

**Rationale.** `model_commitment` pins *which weights ran*. Once an adapter can
change the network, reporting the base commitment for an adapted synthesis lets
two different networks sign the same receipt — the provenance chain would say
"chatterbox-multilingual-v3" for audio that a per-speaker network produced. The
collapse-to-base property is what keeps every pre-adapter receipt and verifier
valid unchanged.

The second reason is measurement, and it is why this is a hard binding rather
than a field: **a service that silently ignores an adapter returns perfectly
good audio.** A dropped adapter and a working one are indistinguishable from the
clip, so a fine-tune-vs-zero-shot delta could quietly be a zero-shot-vs-zero-shot
delta. `evals/open-voice/run.mjs` gates exactly that case.

**Reversal condition.** Revisit if `voice_model_ref` on `vy_voice_fidelity`
(migration 054) lands with a different derivation, in which case ONE of the two
must be adopted everywhere rather than both existing — a voice with two
different "which network made this" strings is worse than a voice with none.

## `context-locker-reuses-the-ingest-run-review-shape` — the universal "bring your context" lane, and why it has no review surface of its own (2026-08-26, WS-AB)

**The gap.** `horizontal-platform-reweight` named it: ingestion was
YouTube-channel + voice-upload, and there was no lane for the material most
people actually have — their own files and their own links. WS-AB is that lane
(`api/context-items.js`, `api/_context-locker.js`, `api/_context/*`,
migration 058).

**The decision.** A context item's mined delta lands on `vy_ingest_run` with
`transcript_source='context_item'` and `video_ref='context:<item_id>'`, NOT on
a new proposals table. Three things follow for free and none of them is
re-implemented: migration 053's `vy_ingest_run_approval_gate` (status='applied'
is unreachable without a named approver and a decision time),
`listIngestRunsForReview`, and `applyIngestRunDelta` / `rejectIngestRun`. The
unique index on `(replica_id, video_ref)` then means "one proposal per item"
exactly as it already means "one run per video", so a re-mine cannot reset a
proposal the owner is mid-review on.

The alternative — a `vy_context_proposal` table — would have been a SECOND
answer to "may this clone say this", and the drifted copy would keep returning
200. `api/_teachersheet.js` refuses a second definition of what a teacher clone
IS for the same reason.

**The provenance half, which the channel lane never needed.** Every addition
names an item AND a character span, and the span is checked to contain the
fragment BEFORE it is stored (`citationViolations` runs on the write path, not
only in the eval). A delta with an unresolvable citation is not stored at all;
the item is marked `extracted` with `mine_skip_reason='citation_integrity_failed'`.

**What would reverse this.** A proposal kind that does not fit
`vy_ingest_run`'s columns — the qualitative LLM pass, if it proposes field
EDITS rather than phrase-bank additions, is the likely one. That is a new table
with a `supersedes` edge, not a widening of this one. Also reversible by
measurement: if the two lanes' deltas need different review UI badly enough
that the shared reader grows a `case`, the sharing has stopped paying.

## `unclaimed-text-is-not-evidence-of-how-you-write` — authorship and speaker attribution are REQUIRED inputs, not inferences (2026-08-26, WS-AB)

**The decision.** The Context Locker mines style evidence from a document only
when the owner has declared it their own writing, and from a chat export only
for the sender the owner has named. The defaults mine NOTHING, with a named
reason on the row (`not_owner_authored_no_style_evidence`,
`speaker_unattributed_no_style_evidence`). An article link is never the owner's
writing whatever they tick — there is no checkbox that makes a journalist's
sentences into someone's habits.

**Why not infer.** Every available heuristic (first person, filename, the
majority speaker in an export) is right most of the time, and the cost of the
minority case is not small: somebody else's phrasing enters a clone of a real,
named, living person, cited, well-formed, and indistinguishable from evidence.
`evals/contextlocker.mjs`'s wrong-speaker control is the demonstration — mining
an export under the wrong declared speaker produces confident, resolvable,
correctly-cited proposals that are entirely the other party's.

**The cost, stated.** The lane is useless by default and the studio has to ask
two questions. That is the intended trade: a person answering "yes, that's my
writing" once per document is cheap, and a clone that talks like the owner's
mother is not recoverable by the next turn.

**What would reverse this.** A measured attribution signal with a false-positive
rate low enough to be worth its failure mode — which, given the failure mode, is
close to zero. More likely: keeping the requirement but reducing it to one
question per BATCH rather than per item, if drop-off is measured at the second
question.

## `refusal-is-a-stored-outcome-with-a-name` — what the platform will not pretend to have read (2026-08-26, WS-AB)

**The decision.** A file the extractors cannot honestly read is stored with
`status='refused'` and a named `refusal_reason`, and the reason is rendered
verbatim to the owner. It is never accepted-and-ignored, and it is never
dropped: the row is the record that this file was looked at and declined, so
the owner does not re-upload it forever (051's "revoked rows are kept",
transferred). Migration 058 makes the blank case unrepresentable —
`vy_context_item_refusal_named` and `vy_context_item_routing_named` are CHECK
constraints, so a future writer that forgets the reason is refused by Postgres
rather than by a code review.

The sharp instance is the PDF text layer. A subset-encoded or CID font yields
glyph indices, and decoding those as characters produces confident-looking
garbage that would be stored, mined, cited, and eventually told to a person as
their own habitual phrases. `assertReadable` in `api/_context/limits.js` is the
structural answer: nothing leaves the extractors that does not read as
language, and the failure is `pdf_text_layer_unreadable` with the reason.

Routing is a THIRD outcome, distinct from both: audio and YouTube links are
`status='routed'` naming the lane that already carries their consent gates.
Nothing is wrong with them; they are simply not this lane's, and duplicating
either would be a second definition of a permission a real person granted once.

**What would reverse this.** A measured refusal rate on real owner uploads
above roughly 20% for PDFs would mean the readability gate is costing more than
it saves — and the answer then is a real font-map pass or a vendored parser,
NOT a loosened gate. Loosening the gate turns every refusal into a silent
wrong answer, which is the thing being bought protection from.

## `mirror-call-approval-is-one-sql-clause` — the never-silent-update law is a predicate, not a policy (2026-08-26, WS-X)

The Mirror Call edits the persona of a real, named, living person while that
person is on the phone with it. SPEC-GURUKUL §8 item 3 forbids a silent
self-update of a live persona, and `MIRROR-CALL-SPEC.md` resolves the tension by
making approval AMBIENT rather than absent: every learned delta is a chip the
owner taps.

**What is decided.** "The owner tapped it" is enforced as ONE SQL CLAUSE in ONE
statement, and nothing else in `api/` can write a mined value onto a
TeacherSheet. `api/_mirrorcall-store.js::decideMirrorDelta` is that statement.
Its sheet write is gated on `candidate ... where d.state in
('proposed','deferred')` and `writable ... where target_field <> '' and $5 =
'accepted'`, and — this is the half that is easy to get backwards — the sheet
write is UPSTREAM of the state flip. So a decision whose sheet write did not
land leaves the delta still un-actioned rather than "accepted but silently
unapplied". A tap that did nothing must not look like a tap that worked.

Three further copies of the same law exist on purpose, the
`api/_teachersheet.js` three-gates argument transferred: `applied_at is null or
state = 'accepted'` as a CHECK (a row that touched the sheet without a tap
cannot exist); `origin <> 'judgement' or target_field = ''` as a CHECK (the
owner's approval of their own clone can never itself edit the clone); and the
JS `fragmentRejection` guard at the merge.

`evals/mirrorcall.mjs` §5 strikes the clause out of the shipping string and
FAILS unless the struck copy lets an already-REJECTED chip land on the sheet,
with a positive control beside it — because "nothing was written" is also true
of a pipeline that never writes at all.

*Reverses if* a reviewed, benched path for applying a delta without a tap is
ever wanted (it is not today), or if the sheet write moves out of this statement
— at which point the strike test is measuring a clause nothing depends on and
must move with it.

## `mirror-call-writes-only-the-phrase-bank` — a statistical pass may not write prose into a prompt (2026-08-26, WS-X)

`transcriptStats` measures six things. Only two TeacherSheet fields are lists of
measured fragments (`boardVerbalisms`, `exSlangRepeat`); every other ING field
the mine touches — `voiceFillers`, `voiceLaughter`, `voiceStretch`,
`voiceLanguageBalance` — is a STRING, a register bullet written as prose that
lands in a compiled prompt and is said aloud by a clone of a named person.

**What is decided.** A Mirror Call delta may write ONLY the two phrase-bank
fields. Every other mined signal is an ADVISORY chip: it carries the number, it
is accept/rejectable so the owner's judgement is recorded, and accepting it
writes no sheet field. `target_field = ''` is that fact and migration 058's
`check (target_field in ('','boardVerbalisms','exSlangRepeat'))` makes it
structural.

This is `recited-prompt` applied one layer out. `sheetDraft.ts` already refuses
to write those fields and names the refusal `measured-needs-canonical-bullet` —
"the measurement is in `measurements`; the sentence is not this module's to
write". A Mirror Call rendering a measured filler ratio into a prose bullet
mid-call, on a tap, under time pressure, with no editor, is the same defect with
worse conditions.

*Reverses if* a canonical-bullet renderer lands with a human confirming the
SENTENCE (not the number) — then the advisory kinds get target fields.

## `mirror-call-takes-a-source-handle-not-multipart` — window audio never touches the function (2026-08-26, WS-X)

WS-Y's client contract (`src/studio/mirrorCallApi.ts`) posts window audio as
multipart and names the alternative: "the `enrollmentApi` pattern", a signed
upload handle. **This backend takes the handle**, and `ingest_window` answers a
multipart request 415 with the JSON shape named in the body rather than failing
in a way that reads as a bad window.

Three reasons, in order of weight:

1. **A second path into the private biometric bucket would exist.**
   `api/_replica-storage.js` is the one place that may know how that bucket is
   addressed, and `/api/replica-source` is the one consented lane into it —
   capture and storage scopes checked in SQL, stored object size and mime
   verified, and the row inside `docs/REPLICA-ERASURE.md`'s chain. Multipart
   would need all of that re-implemented next to a serverless body parser.
2. **The body limit is a ceiling nobody re-checks.** A 30 s window of 24 kHz
   mono PCM16 is ~1.4 MB, which fits today and stops fitting the moment anyone
   raises the sample rate or sends anything but PCM16.
3. **An ASR retry re-reads the same object** instead of asking the owner to
   speak again.

The deviation is DECLARED on the handshake (`transport` on
`GET ?op=contract`), not discovered mid-call. Client cost: two functions.

*Reverses if* the source lane ever gains a per-upload cost or latency that a
per-window rate makes prohibitive — three round trips per window is the price
being paid here, and nobody has measured it against a live call yet.

## `mirror-call-turn-voice-is-declared-unserved` — an optional op refused loudly beats an op that answers silence (2026-08-26, WS-X)

The clone's REPLY — engine text, then synthesis through the admission broker —
is not built in WS-X. `GET ?op=contract` therefore lists `turn_voice` under
`unserved_ops` with a reason, the op answers **501** (not 404: the route exists
and this op does not, and an operator reading a log needs those apart), and
every window result returns `turn: null` with `turn_absent_reason`.

WS-Y's contract already makes `turn_voice` optional so that "the call runs with
captions only and says so" is a supported state. Advertising the op and
returning silence would be the fake-progress-bar failure with a speaker
attached, and it is the exact shape `plausible-return-hides-a-dead-pipeline`
names.

*Reverses when* the reply lane lands: the op moves from `MIRROR_CALL_UNSERVED_OPS`
to `MIRROR_CALL_OPS` in `api/_mirrorcall-wire.js` and nothing else changes.

## `three-step-wizard-ia` — the studio is a wizard, not a wall (2026-08-26, owner directive)

**The defect, in the owner's words:** the studio is "one single screen of
nonsense, one continuous screen." Correct — every workstream mounted its panel
onto the same page, so the journey has no shape.

**The binding information architecture, from the owner:**
1. **FEED** — bring your context: files, a YouTube video link, a YouTube
   channel link, other reference links the agent can scrape. Then Next.
2. **MEET** — the clone is RIGHT THERE on the next page: interact with it
   (text, voice, call), with the tweak/feedback mechanism and on-the-go
   learning directly beneath the conversation. "The major thing is to
   interact with the agent, check it, tweak it."
3. **DEPLOY** — channels, widget, app — at the end.

Verification (identity/liveness/consent) is woven into the steps where each
gate actually binds, never presented as its own wall. Existing panels are
REUSED inside steps — this is a shell restructure, not a rewrite of working
surfaces.

**What would reverse this.** The owner reshaping it, or measured evidence a
step boundary loses users (which would move a boundary, not restore the wall).
**Reversed 2026-08-26 by WS-AC** — and the reversal condition above was exactly
right, which is why it is worth recording: the diff really was the two lines it
predicted plus the lane behind them. See
`mirror-call-reply-is-the-one-door` below.

## `mirror-call-reply-is-the-one-door` — the clone's Mirror Call reply is assembled through `gatedReply`, from the owner's own sheet, with no fallback persona (2026-08-26, WS-AC)

`api/_mirrorcall-reply.js` builds the clone's turn out of `sheetToModule` over
the owner's own TeacherSheet, `engine.compile`, and `api/_surface.js`'s
`gatedReply()` — the same single door every other surface's bytes leave by. It
is not a second chat engine and it contains **no branch that returns a default
agent**.

The argument is `api/_clonechat.js`'s, transferred: a lane with its own reply
path is `age-tier-never-realtime` in a new costume — a second assembler that
misses every rule added after the fork, silently, while returning 200. On this
surface the stake is higher than on the widget. The owner is listening to a
clone **of themselves** in order to judge whether it sounds like them, so a
generic assistant wearing their cloned voice would not merely be wrong, it would
corrupt the only judgement the call exists to collect.

Two concrete consequences:

- **A replica with no sheet produces NO TURN**, and `turn_absent_reason` says
  `clone_sheet_absent`. The refusal is the absence of a fallback branch, not a
  check on one.
- **The compile is spoken, not texted**: `medium: "voice"`, `mode: "call"`,
  `voiceEngine: "device"`. Not `"live"` — that branch of `buildSpeechStyle`
  tells her nothing she says is written down anywhere, which is FALSE here (a
  Mirror Call turn is captioned and stored). The `[tone: …]` marker the
  `"device"` branch asks for never reaches an ear because `parseBubbles`
  extracts it inside `gatedReply`, which `evals/mirrorcallreply.mjs` §1 asserts
  by driving a fake engine that `hasGate()` accepts.

*Reverses if* a measured Mirror Call reply is worse than one from a purpose-built
mirror prompt — but the bar is a MEASUREMENT, not a hunch, and the fork would
need its own copy of the honesty gate before it could be compared at all.

## `mirror-call-answers-from-the-draft-sheet-and-says-so` — calibrating happens before publishing, so the draft persona replies, with its source on every payload (2026-08-26, WS-AC)

A Mirror Call is the thing an owner does BEFORE they publish. Refusing every
unpublished replica would make the feature unreachable exactly when it is most
useful. So `mirrorReplyAgent` prefers a published+consented sheet and otherwise
answers from the newest non-revoked **draft**.

The whole cost of that decision is paid by one field. `sheet_source` rides on
the turn row (migration 060) and on every wire payload, because "the owner heard
a plausible voice and could not tell which persona produced it" is
`plausible-return-hides-a-dead-pipeline` with a speaker attached. There is
deliberately **no third value** for a generic assistant: the enum is
`('published','draft')` and a sheetless replica has no row at all.

Two clauses that look like decoration and are not:

- `s.status <> 'revoked'` — revocation DEREGISTERS a module
  (`safety-floor-teacher.md` §2.2). Falling back to a revoked sheet because it
  happened to be the newest row would be a withdrawal quietly failing to take
  effect, on the owner's own voice, where nobody would notice.
- A `'published'` row with a null `consent_artifact_id` is reported as
  **draft**. Migration 051's CHECK makes that row impossible; the assembler
  refusing to call it published anyway is the second layer, and it is the one
  that survives somebody widening the constraint.

*Reverses if* owners report grading a draft they thought was live — which would
mean the marker is present and unrendered, and the fix would be in the studio,
not here.

## `mirror-call-synthesis-is-reused-not-forked` — `turn_voice` goes through WS-W's admission-broker handler unchanged, and records its mirror-call meaning on its own row (2026-08-26, WS-AC)

`opTurnVoice` signs nothing, wakes nothing, prepends no disclosure, embeds no
watermark and opens no ledger row. It calls `handleVoicePreviewPanel` with the
same collaborators `api/voice-preview.js` wires — same provider, same protection
adapters, same ledger, same warmth registry — and passes the 202-warming
contract through byte for byte, `Retry-After` included.

A second path to a cloned voice is a second place the disclosure prefix can be
dropped, and `disclosure-announces-the-clone` is already on the books as a
defect a fork would have made invisible rather than merely awkward.

**The declared deviation.** `beginOwnedVoicePreview` books a
`vy_replica_generation` row with `purpose='voice_preview'`,
`channel='studio_preview'` — so on the ledger a Mirror Call clip looks like a
studio preview. Widening migration 019's `channel` CHECK to add a `mirror_call`
value was considered and rejected: it would make the mirror lane a second shape
the provenance path has to know about, which is the fork wearing a schema
change. The mirror meaning is recorded instead on `vy_mirror_turn.generation_id`
— a binding on the turn that caused it, with 045's `preview_shape` check
untouched.

**The one thing the mirror lane adds is the binding.** The synthesised text
comes from `getMirrorTurn` — a row the server wrote after the server assembled
the reply. There is no branch that reads a string from the query, the body or a
header, which is `src/studio/mirrorCallApi.ts`'s rule ("keeps the studio unable
to make the clone say anything the server did not author") expressed as the
absence of any other source for the string.

*Reverses if* the mirror lane ever needs a synthesis parameter the preview panel
cannot express — at which point the honest move is a shared handler with two
callers, never a copy.
---

## best-window-not-first-window

**Decided 2026-08-26 (WS-AD).** A voice reference extracted from a long
recording is the **highest-scoring ~10 s window anywhere in it**, chosen by a
ranking that scores every window and is kept, never the head of the file.

**Why.** `measurements.md#reference-window-beats-the-finetune` established that
Chatterbox truncates a reference to its first 10 s (s3gen) / 6 s (T3 prompt),
and that WHICH 10 s spans 0.0625 ECAPA fidelity on the owner's own voice —
three times the measured fine-tune delta, at zero training and zero inference
cost, with the best window beating every fine-tuned arm. That entry closed by
saying there was "no selection *rule* yet, only evidence that one would be worth
having". `api/_video-enroll/windows.js` is that rule.

The owner's brief is the other half of the argument and arrived independently:
"it's not necessary that the first 10 seconds will be clear, so handle it". For
a lecture the head of the file is the *worst* prior — throat-clearing, room
noise, a mic being adjusted, a check that the class can hear. Taking it is the
one choice guaranteed to be wrong on the input this lane is built for.

**Why a ranking and not a heuristic about lectures.** A heuristic ("skip the
first 30 s") encodes a guess about a genre and fails silently on the recording
that does not match it. Scoring every window lets the head compete on the same
terms and win when it deserves to, and — because the ranking is STORED — lets
the studio offer "try the next best one" without re-extracting a 15-minute
video, and lets a human audit the choice on the one occasion anybody will care,
which is when a clone sounds wrong.

**What it explicitly is not.** The scores are a WAV signal probe — voiced
fraction, an SNR estimate, clipping, level stationarity, speaker purity — and
they are NOT ECAPA fidelity. `score_source` says `wav-signal-probe/v1` on every
row and every payload, for the same reason WS-X's `mirror_call` conditioning
score names itself: when a real scorer lands, old rows must stay readable as
what they actually were.

**What would reverse it.** A reference-window sweep on real lecture audio
showing the probe's ranking does not correlate with measured ECAPA fidelity. In
that case the ranking is not wrong to KEEP — a stored ranking is strictly better
than an unexamined default either way — but the selection would move to whatever
does correlate, and the weights in `scoreWindow` (a stated prior, written in the
open precisely so it can be replaced) would be replaced by fitted ones. If the
correlation is negative, taking the head back would still be wrong; taking a
RANDOM window would be worse than both, which that measurement already showed.

## `activity-is-a-read-not-a-progress-bar` — the owner's activity surface, and the one lane allowed a fraction (2026-08-26, WS-AF)

**The owner's ask, verbatim:** "I should also see that have we received the YT
video and that processing done or not, and all the other processing going on we
should see, in a user view."

Seven asynchronous lanes run in this platform (upload processing, context
locker, channel sweep, per-video ingest, voice model build, mirror-call
fine-tune queue, erasure). The person who started them could see none of them.
The rows existed; nothing read them together.

**The decision.** One owner-scoped, replica-scoped read (`/api/replica-activity`,
`api/_replica-activity.js`) normalises every lane to one job shape:
`{job_id, ref, lane, subject, state, state_reason, started_at, updated_at,
finished_at, progress, next_action, in_flight}`, with `state` closed over seven
values that migration 060, the read and the UI all share.

**The load-bearing part is `progress: null`.** Exactly ONE lane in this platform
can compute a real fraction: the enrollment DAG, where completed processing jobs
over the eight steps of `AUDIO_PROCESSING_DAG` is finished work over a known
total. Every other lane returns null and gets a sentence. A status ladder
(`fetched` -> `transcribed` -> `proposed`) is not a fraction of work: a two-hour
lecture is not half done when the row says `transcribed`, because `transcribed`
is the END of the expensive part, so a bar built on that ladder would crawl and
then jump. `plausible-return-hides-a-dead-pipeline` is this repo's most
expensive law and a progress bar is its purest form: a bar at 60% driven by a
schedule tells the owner something is happening at the exact moment nothing is.
Words that name the stage cannot lie about the remainder.

**`in_flight` is server-decided, per lane, and it is what stops the poll.** Each
lane declares what advances it: `worker` (a queued job is genuinely in flight,
poll), `schedule` (a cron moves it on its own clock, so queued can mean "in an
hour" and polling would spin), or `nobody` (the fine-tune queue: migration 059
gave it no lease columns and no runner, so `queued` means "you asked and nothing
has run it", and saying that is the row's whole value). The server returns
`next_poll_ms`, backing off 3s toward 30s across unchanged polls and returning
`null` the moment nothing is in flight.

**A failure reports WHY in words.** Every lane stores a code; `reasonFor` maps
the codes we actually emit to sentences and its fallback opens the underscores
out rather than saying "something went wrong", so an unmapped code stays
searchable and quotable instead of becoming indistinguishable from a bug.

**A one-click retry is offered only where one exists.** The only safe one in the
platform is re-running finalize on a source stranded at `pending_upload`: the
bytes are already in storage, the owner's disk is not needed, and it is the
recovery path for every upload the finalize defect stranded. A rejected
recording gets `fix_input` (only the owner can supply different bytes) and a
failed channel video gets `wait` naming what the next sweep will do, because
there is no per-video retry op and a button that called nothing would be a fake
progress bar with a label on it.

*Reverses when* a lane gains a genuinely measurable denominator (a chunked
transcription that reports chunks done, a fine-tune that reports steps), at
which point that lane returns a real `progress` and nothing else changes. It
does NOT reverse because a bar would look better.

## `an-undeployed-lane-is-a-state-not-an-empty-list` (2026-08-26, WS-AF)

A lane whose provider, cron or secret is absent returns zero rows. Zero rows
renders as an empty list, and an empty list is indistinguishable from "nothing
has happened yet" — which is a SUCCESS shape for a lane that cannot work at all.
So `/api/replica-activity` returns a per-lane deployment verdict computed from
the same environment the workers read, and the surface renders "not connected
yet" with the missing piece NAMED (`SARVAM_API_KEY`, `CRON_SECRET`, or, for the
fine-tune lane, "a fine-tune runner, which does not exist in this repo yet" —
named as a service because no env var would make it true).

*Reverses when* every lane is deployed everywhere, which will not happen.

## `copy-law-is-a-gate-not-a-guideline` — every ban in DESIGN-LAW §1 ships with the check that bites (2026-08-26, WS-AG)

`scripts/check-copy.mjs` used to enforce one rule (the em-dash) on two places
(`src/components/`, `site/*.html`). DESIGN-LAW §1 bans nine shapes of copy
across four surfaces, and §5 says outright that "a rule here without a check is
a wish". The gap was measurable: 120 violations, 113 of them em-dashes, in the
half of the repo nothing scanned.

**What is encoded, and the one hard decision inside it.** The bans divide into
two kinds and they cannot share an extraction:

- The DASH runs BROADLY, on comment-stripped lines, because in `.tsx` an
  em-dash outside a comment is inside a string or a JSX text node by
  construction. There is nowhere else for it to be.
- Every WORD ban (version stamps, `01 · Eyebrow`, scroll cues, filler verbs,
  the codename, the middot run) runs ONLY on strings the checker has proven
  render: JSX and HTML text nodes, literals bound to a visible prop name
  (`label`, `title`, `placeholder`, `aria-label`, `alt`, ...), and every literal
  in a copy-constants module. Comments are blanked by a scanner that tracks
  string state, so `//` inside a URL is not a comment.

That split is the whole decision. A word ban run broadly fires on
`elevation`, on a path containing `beta`, on `import ... from "../engine/meera"`
— and a gate that argues with the code gets switched off, which is worse than
no gate because it looks like coverage.

**Two rules deliberately NOT encoded, and why.** A data-derived version (a
teacher's own `v4` voice model) is not a build stamp; the rule fires only on
literal `v1.4.2` / `BETA` / `Build 0048` text, because DESIGN-SYSTEM §2 makes
the user's own version stamps load-bearing. And `beautifully` was in the filler
list for exactly one run: it fired on `site/index.html`'s "Beautifully human in
how she talks", which is the other product's real claim, and it is not a shape
DESIGN-LAW names. A gate that invents bans beyond its law loses the argument
about the bans that are in it.

**The waiver expires itself.** `src/studio/StudioApp.tsx` is owned by another
workstream mid-purge, so its three remaining offences are printed on every run
and do not fail the build — and the gate FAILS if a waived file comes back
clean, so the exception cannot outlive the condition that justified it.

*Reverses when* a rule produces a false positive on true copy twice. The
response is to narrow that rule and say so here (as `beautifully` already was),
never to widen the exemption list, because an exemption list is where a gate
goes to die.

## `landing-hero-is-four-elements` — the honest strip moved, it did not go (2026-08-26, WS-AG)

`site/vyakti.html`'s hero carried six stacked elements against DESIGN-LAW §4's
cap of four, including a build-status trust strip the law bans in a hero and a
55-word lede against a 20-word cap, which put the CTA below the fold on a
laptop. Rebuilt to four: headline (two lines at desktop, at 26ch and 56px, a
pair that has to be re-counted together), a 16-word subtext, one button, one
line of fine print.

**The strip was not deleted.** "This is a private build, voice activation is
still gated" is a truth the page owes under `context/rejected.md`'s
honest-states law, and it is now the FIRST item of the section that exists for
unproven claims. Honest is not the same as first, and a landing that leads with
its own caveat is not more honest, only less readable.

Also in the same pass: six auto-fit cards that rendered as three equal columns
became prose at one measure; five eyebrows became one; the second accent (an
ember dot and an orange radial glow) went, leaving forest alone; and the
nine-step path became the three steps `three-step-wizard-ia` actually
implements, which is the page catching up to the product rather than a
simplification of it.

*Reverses when* a measured funnel shows the fold placement costs starts, which
would move the CTA, not restore the strip.
## `wizard-readiness-is-a-pure-function` — the rail may not compute its own status (2026-08-26, WS-AE)

**The decision.** Every status the three-step rail renders comes from
`src/studio/wizardModel.ts`: no React, no fetch, no DOM, one exported function
from a plain input object to a `WizardView`. The components that draw the rail
(`WizardRail.tsx`) and the step bodies (`StudioApp.tsx`) are forbidden from
deciding whether anything is done. `evals/studiowizard.mjs` runs the function
over 6 912 inputs on every `verify-release`.

**Why, and it is not tidiness.** The studio has now shipped this defect twice
in two files, both written by people who knew better:
`StudioApp.tsx` rendered a literal `0` / "No model trained" beside a real
`runtime.versions.voice_genome` it already had (BREAK 8), and
`QuickStartPath.tsx` hardcoded `className="quickstart-step next"` on step 3, so
its own checklist was structurally incapable of reaching 3/3 (BREAK 11). Both
were one-line conveniences inside JSX. `PRODUCT-JOURNEY.md` §3.2's answer is the
rule this implements: **no rail row may render a status that is not derived from
data.** A status computed in JSX will eventually be typed by hand; a status
computed by a function an eval can call thousands of times will not.

**Four properties the eval holds, each of which would go quiet under an
ordinary-looking simplification:**

1. **At most one ember.** `DESIGN-SYSTEM.md` §4.1 caps `--state-waiting` at one
   on screen. The obvious implementation is per-row ("am I not done?"), which
   lights two on the normal input, so the ember is assigned centrally, after all
   three steps are computed. The suite carries the negative control: it asserts
   that inputs with two incomplete steps genuinely exist.
2. **`null` is UNKNOWN, and unknown is not zero.** Three inputs can be null
   (context items, channels, runtime). The tempting `?? 0` turns "we did not
   ask" into "you have none", which is a status derived from a spinner.
3. **An unrecognised blocker is rendered, not dropped.** `QuickStartPath`
   filtered `runtime.blockers` to codes it had copy for, so an unknown gate
   could hold Activate shut while the checklist read clear.
4. **Done means done.** No step may report `done` while listing something
   missing.

**What would reverse it.** Nothing short of the rail ceasing to exist. If a
future status genuinely cannot be derived (a human judgement, say), the answer
is to not render it, which is rule 3 of `DESIGN-SYSTEM.md` §5.

## `a-step-is-never-silently-blocked` — the wizard gates by what it says, not by what it locks (2026-08-26, WS-AE)

**The decision.** Every step in the studio wizard is always reachable: the rail
rows are buttons, the Next button is never disabled, and the URL accepts any
step. What changes with readiness is what the step SAYS. `stepEntryWarning`
returns the honest line for arriving early, and it names the specific thing that
will be empty ("you have not added anything yet, so the clone has nothing of
yours to speak from") rather than refusing entry.

**Why.** The owner's defect report ends "the major thing is to interact with the
agent, check it, tweak it". A wizard that refuses to open MEET until FEED is
complete is the same wall the owner rejected, wearing a progress bar: it puts a
checklist between a person and the only part of the product that proves the
product works. The gates that actually matter are unaffected, because they are
enforced server-side by `/api/replica-runtime` and were never enforced by
navigation.

**The line this does not cross.** Reachable is not the same as functional. Every
consent gate, identity gate and activation gate stays exactly as strict, and the
step says which of them is missing. Nothing here weakens a safety step; it
removes a navigational one that was never a safety step.

**What would reverse it.** Measured evidence that owners reach MEET, find it
empty, and leave rather than going back. That would move the warning's
prominence, and only then the boundary.

## `demo-teacher-is-not-a-placeholder` — a fixture may never stand in on a consent surface (2026-08-26, WS-AE)

**The decision.** `DEMO_TEACHER` (Arjun Sir, fictional) is removed from every
surface `StudioApp` renders for a real replica. The sheet is read from
`/api/teacher-sheet`; when there is no saved draft, `src/studio/sheetSeed.ts`
builds a seed carrying the OWNER'S name and a slug derived from their own
replica, with every mined field blank and `credentialFacts` and the fabricated
background life emptied. The disclosure preview and the channel snippet do not
render a seed at all: they render a labelled empty state that sends the owner
back to save their sheet.

**Why this was not a rough edge.** `DisclosurePreview` exists so that a teacher's
consent to publish is informed by exactly what a student sees. It was rendering
"You're talking with an AI clone of Arjun Sir" to a teacher named someone else,
and `ChannelsStudio` was building the embed snippet a teacher is invited to copy
against `teacher-demo-arjun`. A fixture on a consent screen is not a placeholder,
it is a false statement on the one screen that may not carry one.

**The general form, which is the part worth keeping.** A storybook default is
safe on a screen that demonstrates a capability and unsafe on a screen that
records a decision. `TeacherSheetStudio` takes a `sheetProvenance` prop for
exactly this reason: a seed may not be captioned "drafted from your uploads",
because nothing was drafted and nothing was uploaded.

**What would reverse it.** Nothing. If the sheet service is unavailable the
answer is the labelled empty state, not the fixture.

## `numbered-eyebrows-are-gone-rather-than-renumbered` (2026-08-26, WS-AE)

**The decision.** The studio's section-numbering eyebrows (`06 · Behavior
calibration`, `09 · Private runtime`, `Verified permission · Gate 04`, the `01`
/ `02` / `04` panel-index blocks) are deleted, not renumbered, and
`scripts/check-copy.mjs` now fails on the pattern.

**Why, given UX-Q-07 asked for phase-scoped renumbering instead.**
`docs/gurukul/DESIGN-LAW.md` §1 bans numbered eyebrows outright and its own
scope note says it wins where it disagrees with a prior UI decision. It also
happens to be the better fix for the defect UX-Q-07 was chasing: the `04`/`04`
collision between `ProcessingReview` and `ModelConsentGate` happened because ten
workstreams each picked a number for their own panel with no register of who had
which. Renumbering resets that race. Deleting the numbers ends it, because there
is no longer a number for the eleventh workstream to pick.

**What replaces the wayfinding they were pretending to provide.** The rail, which
answers "where am I" from data, and the step head, which says "Step 2 of 3".

**What would reverse it.** The owner asking for the ledger's numbered motif back,
which is a real thing to want: `DESIGN-SYSTEM.md` §2 calls the numbered panel the
visual argument for the whole product. If it returns it must return as ONE
register with one owner, not as a per-panel literal.


## `processing-sweep-drains-the-enrollment-queue` (2026-08-26, WS-AH)

**Decision.** `api/replica-processing-sweep.js` runs on a `*/5 * * * *` Vercel
cron, CRON_SECRET-bearer authed via `timingSafeEqual`, `maxDuration: 300`, and
drives `runNextProcessingJob` for at most 3 jobs per invocation inside a 270s
budget with a 30s reserve. The lease stays at 15 minutes, deliberately LONGER
than the function's own wall clock: if the platform kills the invocation
mid-stage the job stays leased until the lease expires and
`leaseNextProcessingJob` re-leases it and records `lease_expired` on the
abandoned attempt. A lease shorter than the runtime is the dangerous direction,
because it puts two workers on one job.

**Why a Vercel cron and not the container.** The intended consumer is the Azure
Container Apps Job in `services/replica-processing-worker/`, which has ClamAV
and ffprobe in its image. It is not deployed and deploying it is an owner-scoped
infrastructure decision with a real bill attached. The cron is the consumer that
exists on the platform this product actually runs on, and it is explicit about
the steps it cannot serve rather than pretending to serve them.

**What would reverse it.** Deploying the container job. At that point the two
consumers would race for the same leases, which the lease protocol survives but
which doubles cost for no gain. When the container lands, either delete this
cron entry or set `REPLICA_PROCESSING_KILL=1`, which the handler already honours.

## `every-step-always-has-an-adapter` (2026-08-26, WS-AH)

**Decision.** `composeProcessingAdapters` never omits a step. A step whose
capability is absent gets `unavailableAdapter(step, code)`: correct adapter
provenance, no billing meter so it can never reserve spend, and a method that
throws a `ProcessingAdapterError` with that capability's own named code and
`retryable: false`. The five canonical absence codes live in the leaf module
`api/_replica-processing/capability-codes.js`.

**Why.** Omission collapses five distinct absences into
`missing_processing_adapter`. Terminal rather than retryable because retrying an
undeployed scanner five times burns the attempt budget and lands in the same
place with a worse code.

**What would reverse it.** A step whose absence is genuinely transient rather
than structural. That one wants a retry, not a terminal stop, and it should be
argued for on its own rather than by loosening this rule.

## `capability-absence-is-not-a-failed-recording` (2026-08-26, WS-AH)

**Decision.** `normaliseUpload` routes the five capability-absence codes to
`state: "blocked"` with a `wait` next action, never to `failed` with
`fix_input`. The sweep opens each run by requeuing jobs whose failure code is a
capability absence that is no longer absent, resetting `attempt` to 0.

**Why.** Telling an owner to re-upload a 32.9 MB file because OUR scanner is not
deployed is a lie with a button on it. `blocked` rather than `queued` because
`queued` in this lane means `in_flight`, and a stopped job that animates a
progress indicator is the exact lie the Activity surface exists to stop telling.
The requeue is what stops terminal-plus-nothing from being a dead end.

**What would reverse it.** Evidence that the requeue re-runs work that actually
costs money. It is fenced on both sides today (only the five codes, and only
where that step is live in the running process), and only `integrity` through
`media_probe` are free; if a paid step ever enters the absence set, the fence
needs a spend check before it stays.
## `blocker-class-is-a-type` — "waiting on you" and "waiting on us" are two kinds, not two words (2026-08-26, WS-AJ)

**The decision.** Every blocker the studio can render carries a
`BlockerClass` of `you` or `us` (`src/studio/blockerClass.ts`), the two render
differently and are labelled with a WORD in both cases, and no `us`-class prose
may attribute the blocker to the reader. `evals/studiowizard.mjs` §8 asserts
this over the wizard's whole input space, with the failing sentence itself as
the negative control.

**Why.** The owner tested on a phone and was shown, under a disabled button:
"Your clone is not activatable yet. 9 things on Meet it are still waiting on
you, and every channel below stays refused until they clear." At that moment
their uploaded audio was sitting at `quarantined`, because nothing deployed
drains the processing queue. Not one of those nine was an act they could
perform. Two defects in one line, and only one of them is layout: a COUNT OF
OPAQUE THINGS, which is not startable, and a misattribution of our unfinished
work to them, which is the failure `docs/HONESTY.md` exists to prevent.

**Why it is a type rather than a convention.** `stepEntryWarning` returned a
bare `string`. A string has no class, so nothing downstream could paint "ours"
differently from "yours" and nothing anywhere could check that a sentence had
not blamed the wrong party. The sentence was structurally reachable, not a
typo, and a convention would have made it reachable again on the next surface.

**The reclassification, which is the non-obvious half.** `owner` and `cls` are
NOT the same field. Two runtime gates (`person_profile_not_approved`,
`calibration_not_approved`) are nominally the owner's turn and are unreachable
until our processing has produced something to approve, so while
`WizardInput.platformWork` says we are holding that work they render `us`, with
what is happening and what changes it. The rail's ember keys on `cls`, so a step
whose only open gate is ours no longer glows "your turn" in paint.

**The safe default.** `platformWork: null` means the activity surface has not
answered and reclassifies nothing; the eval asserts an absent field behaves
byte-identically to a null one. That is what made the field landable while
WS-AH's processing sweep was still in flight.

**What would reverse it.** Evidence that people read the two classes as the same
thing, or that the `us` class becomes a place blockers are filed to avoid asking
for anything. The second is the real risk and the guard against it is that a
`you` reason must name an act: a "waiting on you" with no control on the same
screen is a "waiting on us" wearing the wrong badge, and if that inversion
starts happening the split has stopped meaning anything.

## `the-studio-phone-layout-is-stated-not-subtracted` (2026-08-26, WS-AJ)

**The decision.** The studio's phone layout lives in one file,
`src/studio/design/mobile.css`, at one breakpoint (720px, shared with
`useCompact.ts`), written as what a 390pt screen IS rather than as removals from
the desktop. The three structural choices that CSS cannot express (which rail is
rendered, which panels start open, whether the step explanation is inline) are
made in React from `matchMedia`.

**Why.** `studio.css` had fourteen media queries and every one of them was
conscientious. They were also all subtractive, and the sum of fourteen correct
subtractions was a first viewport spent on a masthead, an eyebrow, a 43px serif
title, a four-line paragraph and a four-card dashboard before any control
appeared. No single rule was wrong; the composition was. A composition defect
cannot be fixed by a fifteenth subtraction.

**Measured shape of the fix**, per step: page furniture from about 300px to
about 90px, primary action above the fold on all three steps, every band except
the step's first collapsed by default, 44pt minimum on every control, `100dvh`
rather than `100vh`, and 16px text inputs so iOS Safari does not zoom the
viewport on focus and leave it zoomed.

**Why a separate file rather than more of studio.css.** The same mechanical
reason `design/tokens.css` gives: `studio.css` is the most contended file in the
repo and a layout that only exists as a diff inside a contended file is a layout
that loses a merge.

**What would reverse it.** A third viewport class earning its own structure
(a tablet that wants the full rail and the compact bands, say). At that point
the boolean `compact` is the wrong shape and it should become a named size,
because a second boolean would produce four combinations and two of them would
never be designed.
## residential-proxy-is-the-audio-route

**Date:** 2026-08-26. **Who:** WS-AI, answering the owner's "can at least we
have youtube video scraping if not the channel full scraping for now? what can
we do, should we do some 3rd party thing here because we need it to work."

**The decision: recommend a residential proxy, specifically IPRoyal pay-as-you-go
at $7.00/GB with a $7 minimum and non-expiring traffic, as the audio route. Ship
the SEAM now so the choice is one environment variable, and do not buy anything,
because this session has no authority to commit the owner's funds.**

**The two halves are decided separately, and that is part of the decision.**
The transcript half is already unblocked for manually captioned videos through
the Data API's `captions.download`, which was measured reachable from a
datacenter in 150 ms with an ordinary API error rather than a bot check. It is
NOT unblocked for uncaptioned lectures, which is nearly the whole corpus: every
unauthenticated surface that could produce words for those is blocked by the
same IP reputation the audio is. Reporting one number for "YouTube works" would
have hidden that in either direction, so `extractionPosture` returns two.

**Why a proxy rather than the alternatives.**

- It is the only lever that changes the variable two independent measurements
  have now isolated. WS-AD: all ten player clients refused from Azure Central
  India. WS-AI: a PO-token provider moves metadata 5/6 vs 1/6 on a warm GCP IP,
  produces 0 of 12 audio extractions, and stops working entirely once that IP is
  burned. Nothing except a different IP has ever moved this.
- **It is the cheapest route to the first ANSWER, which is the decision actually
  in front of us, and that is why IPRoyal beats a cheaper vendor.** Evomi is
  $0.49/GB, fourteen times cheaper, behind a 100 GB/month floor of $49.99/month.
  IPRoyal is $7 once, its traffic does not expire, and $7 buys about 90
  fifteen-minute lectures. Optimizing the per-GB price before knowing whether
  the route works at all is optimizing the wrong number.
- It beats every third-party API measured or quoted. Apify's actor is $0.41 per
  video, five times a 15-minute proxy extraction, and has no audio-only mode, so
  it also ships video frames we discard. cobalt's public API is closed to
  anonymous callers (`error.api.auth.jwt.missing`) and self-hosting it relocates
  our IP problem rather than solving it. The RapidAPI vendors would not confirm
  current per-request pricing and mostly publish no terms.
- It buys both halves with one credential: a proxy that fetches audio also
  fetches the caption track for an uncaptioned lecture, at roughly 4 MB instead
  of 11 MB.
- **It does not risk an account.** Cookies is free and is the only route on the
  page whose downside is somebody's Google account being flagged or terminated.
  It is wired, it is documented plainly in
  `docs/gurukul/youtube-extraction-routes.md` §5, and it is deliberately ranked
  below `provider` in the preference order so it can never win by being cheapest.

**The number:** about **$0.077 per 15 minute lecture**, roughly 11 MB through the
proxy (about 6.8 MB of Opus at format 251 plus about 4 MB of watch page, player
JavaScript and player API JSON). A 300 video back catalogue of 45 minute
lectures is about 10 GB, so about $70.

**Why the seam is the deliverable rather than a working route.** The owner
cannot be handed a route this session cannot buy, and a session that guessed at
one and reported it working would be worse than useless. What CAN be shipped
honestly is the property that switching route later is one variable and not a
rewrite, that a route without its credential refuses BY NAME on the owner's
Activity surface with a next action, and that the provenance records which route
served the bytes. That last one is not decoration: a paid proxy extraction and a
free direct one return an identical WAV, so without an asserted echo there is no
way to ever reconcile a proxy bill against work done.

**What would reverse it.**

- **A measured working free route.** If a PO-token provider, a self-hosted
  cobalt, or anything else returns audio bytes from a datacenter egress across
  n >= 10 spaced trials on a NOT-freshly-warmed IP, the proxy recommendation
  goes. The bar is bytes, not metadata: metadata has already been shown to
  succeed while the media fetch 403s.
- **The proxy failing its own trial.** If IPRoyal residential is bought and does
  not deliver bytes, the next thing to try is a third-party API with an
  audio-only mode, not a second proxy vendor, because the failure would then be
  evidence that residential IP alone is not sufficient.
- **Volume changing the shape.** Past roughly 100 GB/month the "cheapest first
  answer" argument stops applying and Evomi's $0.49/GB or a committed Bright Data
  plan wins on price. Switching is one environment variable by construction.
- **The teacher-upload lane becoming sufficient.** If teachers reliably export
  their own audio, extraction stops being the lane that reaches the back
  catalogue and this whole decision is moot.

## `processing-worker-is-a-job-not-an-app` (2026-08-26, WS-AK)

**Decided.** `services/replica-processing-worker/` is deployed to
`vyakti-voice` as a scheduled **Azure Container Apps Job**
(`vyakti-replica-processing`, Consumption, `*/5 * * * *`, `parallelism: 1`,
`replicaTimeout: 900`), not as a Container App and not as a smaller
purpose-built container.

**Why a Job.** The worker is already run-to-completion: `run-once.js` drains a
bounded queue and returns. A Container App expects a long-lived server, so
using one would mean inventing a listener, a readiness probe and an ingress
that nothing would ever call. A Job also has genuine zero idle cost: it is not
running between executions at all, rather than sitting at `minReplicas: 0` with
a wake path.

**Why no ingress, and why that is not a new security posture.** This is a queue
*consumer*. It pulls work from Neon and talks outward to Supabase Storage and,
when configured, to the private evidence service. It needs no inbound door. The
HMAC admission broker pattern exists to protect services that must accept
inbound requests (`open-voice-admission` in front of the GPU runtime); adding
ingress here purely to have something to authenticate would create an attack
surface rather than reuse a posture. There is already a Jobs precedent in this
exact resource group: `vyakti-voice-finetune`.

**Why not a smaller purpose-built container.** A container that only shelled out
to `clamdscan` and `ffprobe` would need its own leasing, settling and DAG
handling, which is a second implementation of the part of this system where a
bug is most expensive. The existing worker shares one code path with the Vercel
sweep through `api/_replica-processing/composition.js`, which is what lets the
two agree on what a step's absence is called. The image is a few hundred
megabytes, not the 5-10 GB of the GPU images, so size was never the argument.

**What would reverse it.** A step that needs to answer a synchronous request
from the app plane rather than drain a queue. That is a different component with
a different shape, and it would go behind the admission broker like everything
else with a door.

## `the-container-owns-every-processing-step` (2026-08-26, WS-AK)

**Decided.** `vyakti-replica-processing` owns all eight steps of the audio DAG.
The Vercel sweep's cron entry was removed from `vercel.json`; the endpoint
remains and still answers a `CRON_SECRET` bearer call, so it is a manual
fallback rather than a second scheduled owner.

**Why ownership had to be singular.** Not for correctness. The lease is atomic
(`for update skip locked` plus a lease token hash), so two schedulers can never
run one job twice - that hazard does not exist. The real hazard is capability
flapping: the Vercel sweep terminally fails a tool-bound step with
`malware_scanner_unavailable`, the container requeues it moments later because
the capability is present there, and for as long as both are scheduled the pair
would move the owner's Activity screen between blocked and progressing on a
five-minute cycle. WS-AH named this exact race as their reversal condition.

**Why the cron line rather than `REPLICA_PROCESSING_KILL=1`.** Both work, and
the kill switch stays as the lever for silencing the endpoint itself. The cron
line was chosen because it is *in the repository*: the split is enacted by the
same push that deploys it, and it is visible to the next reader in the same
diff as the container. An env var set in a dashboard is a split that only one
person can see.

**What would reverse it.** Azure being an unacceptable single point of failure
for enrollment. The fallback is already written and one line long: restore the
cron entry, and the queue drains as far as a serverless runtime honestly can,
with named absences for the rest.

## `windowing-belongs-before-the-embedder-not-before-diarize` (2026-08-26, WS-AK)

**Decided.** `VOICE_EVIDENCE_MAX_DURATION_SECONDS` was raised from 600 to 1200
on `vyakti-voice-evidence` as an **unblock for one file**, not as the fix. The
proposal to window the recording down to the best ~10 s *before* the evidence
call was NOT adopted at this point in the DAG, and the reason is structural
rather than a matter of effort.

**Why windowing here would be wrong.** `best-window-not-first-window` is right,
and WS-U's spread (0.7433 to 0.8058 on window choice, against a 0.0206 fine-tune
delta) makes it the highest-leverage decision in the clone pipeline. But it is a
decision about **the reference that conditions synthesis**, which is the
embedder's input. `diarize` is not the embedder. Windowing before it would:

- destroy the thing diarize exists to produce. Its output is `speaker_segment`
  evidence with spans and a `target_likelihood` across the WHOLE recording, and
  that is the mechanism that tells the target speaker from a second voice.
  `vy_replica_source.contains_third_parties` is consent-critical, and a 10 s
  window cannot establish it for the other 13 minutes.
- starve `separate` and `enhance`, which take diarize's segments as input.
- truncate `transcribe` to ten seconds of a thirteen-minute recording, when the
  transcript is what the sheet and persona work read.
- choose that window with `_video-enroll/windows.js`, which says plainly of
  itself that its scores are a **proxy** - voiced fraction, SNR estimate,
  clipping, level, stationarity - and have never been benched against fidelity
  on lecture audio. Replacing speaker-aware evidence with an unbenched signal
  proxy for a consent-critical determination is the wrong direction.

**And it would not have unblocked this file anyway.** `services/voice-evidence`
exposes exactly ONE endpoint, `/v1/analyze`, and all four evidence steps POST to
it. The duration guard lives in the shared `_load_audio`, so it applies to
diarize, separate, enhance and voice_quality alike. Windowing before the
embedder alone leaves the first three capped exactly where they were.

**What the real fix is, and why it is a different workstream.** Chunk the
recording and call `/v1/analyze` per chunk, aggregating evidence across chunks.
That makes duration irrelevant for all four steps without discarding audio. It
changes the span semantics of the evidence schema and the per-step contract of
four DAG stages, which is a design change with its own eval surface, not
something to land inside a deployment.

**What would reverse the interim cap.** A file longer than 1200 s, which is not
hypothetical: a 30-minute lecture is squarely in the product's use case and
still fails, and 1200 s is a HARD ceiling compiled into `app.py`
(`min(20*60, ...)`), so going past it needs a service change and a rebuild of a
5.34 GB GPU image, not an env var.

## `wake-then-sign-never-sign-then-wait` (2026-08-26, WS-AK)

**Decided.** `providers/azure-voice-evidence.js` now polls the evidence
service's own `/healthz` until it returns 200, and only then builds the
timestamp, nonce and signature for the real request. Bounded by
`VOICE_EVIDENCE_READY_TIMEOUT_MS`, default 300 s, floor 60 s.

**Why.** The service scales to zero and takes 100 to 160 s to load models. A
request signed before that wait is held by Container Apps until the replica is
up, by which time its timestamp is older than the service's 60 s anti-replay
window, and it is rejected 401. Four consecutive cold attempts failed this way;
the first attempt with this change completed, cold, in 50 s. See
`measurements.md#wake-then-sign-unblocks-the-evidence-lane`.

**Why not widen the window.** The window is the replay protection. Making it
long enough to cover a GPU cold start would mean accepting a signature minted
three minutes ago, which is the thing it exists to refuse.

**Why `/healthz` here is not the trap in
`rejected.md#broker-healthz-is-a-front-door-not-a-readiness-check`.** That entry
is about the open-voice BROKER, which answers at its own front door and forwards
separately, so its health says nothing about the thing behind it. This endpoint
is served by the evidence app itself and returns 200 only after its lifespan has
loaded the models and set `ready`; while the app is up but still loading it
returns 503. The probe's body is never read, so it is a timing gate and never
evidence.

**What would reverse it.** A service whose `/healthz` stops being gated on real
readiness, or an ingress that starts answering it on the app's behalf. Both turn
this from a readiness check back into a front door, and the failure would be
silent: requests would be signed too early again and the 401s would return.
## audio-protection-cpu

**The audio protection service runs on CPU, and `AUDIO_PROTECTION_REQUIRE_CUDA`
is set to `false` on the deployment.** WS-AL, 2026-08-26.

The service's README calls itself "intentionally fail-closed: startup fails
without CUDA", and `app.py` defaults `AUDIO_PROTECTION_REQUIRE_CUDA` to `true`.
Turning that off is exactly the kind of quiet flag flip that a safety-critical
service should not receive without an argument, so here is the argument.

**Why CPU is correct here, not merely cheaper.**

- **The device does not change the watermark.** AudioSeal's generator is a small
  SEANet model. The weights, the 16-bit message, and `alpha=1` are identical on
  either device; only the arithmetic backend differs. There is no quality knob
  being turned down.
- **The service refuses to ship an unverified watermark either way.** Before
  returning a single byte, `_watermark` runs the official detector over its own
  output and raises `audioseal_self_verification_failed` (503) unless confidence
  clears `AUDIOSEAL_GENERATION_MIN_CONFIDENCE` (0.80) **and** all sixteen
  decoded bits match. So a device that degraded the watermark would fail closed,
  loudly, per request. Measured on CPU: confidence **1.0**, message verified, on
  every call, plus an independent detection in a separate process at
  **1.000000** against a negative control at **0.000000**
  (`measurements.md#audio-protection-cpu-serving`).
- **CPU is fast enough.** 3 seconds of 24 kHz mono is watermarked in **2.72 s
  warm**, a real-time factor of 0.91. A preview clip is seconds long.
- **GPU would break the feature it exists to serve.** The CUDA base image is
  9.70 GB and WS-L measured that lane at **161 s to ready with the triggering
  request dying at 240 s** on a platform timeout
  (`docs/gurukul/AZURE-DEPLOY-STATE.md` section 8). The CPU image is **424.7 MB**
  and cold starts in **35.6 s with the triggering request returning 200**. On a
  scale-to-zero service in front of a user-facing preview, that is the
  difference between working and not.
- **GPU costs about 14x more per hour** (~$0.53-0.60 versus ~$0.04) for work
  that is not the bottleneck.

**What this costs.** Nothing measurable in watermark quality, and two real
things: no headroom for a future duplex or streaming corridor that must
watermark many concurrent calls in real time, and a ~1 s per-clip latency floor
that a GPU would shrink. Both are throughput and latency concerns, not
integrity concerns.

**What would reverse it.**

- **Throughput.** If concurrent previews or a duplex call lane push sustained
  demand past what a 2-vCPU replica serves at RTF 0.91, move to the existing
  `Consumption-GPU-NC8as-T4` profile. The flag flips back and nothing else
  changes.
- **A measured device-dependent difference in the watermark.** If a paired CPU
  versus GPU comparison at n >= 20 clips ever shows a detector-confidence or
  bit-error difference, that is a real integrity finding and the fail-closed
  default was right. Nothing in the round trips run here suggests it.
- **A longer-clip regime.** These numbers are from 3-second clips. If the
  product starts protecting minutes of audio per request, re-measure RTF before
  assuming it holds.

## audio-protection-ingress

**The protection service is deployed with external ingress and acts as its own
HMAC admission broker.** WS-AL, 2026-08-26.

Its README says "the service must have no public ingress" and the bicep pattern
for its siblings is internal-only. But `docs/gurukul/ENV-MANIFEST.md` section 6
has a **Vercel function** calling it, and a Vercel function is not inside the
Container Apps managed environment. This is the same contradiction WS-L recorded
as the open design question in section 12 for `voice-evidence`, and it cannot be
resolved by choosing a side: internal ingress means the owner's preview cannot
work at all.

**Why external is defensible here specifically.** `open-voice-runtime` solves
this with a separate cheap CPU broker in front of a private GPU app. The reason
that broker exists is that the GPU runtime does no authentication of its own.
`audio-protection` is not in that position: every route is protocol-bound,
timestamp-bound (60 s skew), content-hash-bound, HMAC-signed, and
single-use-nonce replay-protected inside `app.py` before any handler runs, it
signs its own responses, and it keeps no access log. An unsigned caller reaches
`/healthz` and nothing else. Verified: a deliberately wrong key returns **401
`transport_signature_invalid`**, distinguishable from a correct key against a
broken service.

So the broker's job is already done, in-process, by the service itself. Adding a
second copy of the same check in front of it would be defence in depth, which is
worth having and is not worth blocking the feature on.

**What this costs.** The service can be woken from the internet, so a stranger
can make it scale from zero and burn CPU minutes. At ~$0.04/hr and a 35.6 s wake
that is a nuisance, not a bill. More seriously, it is one HMAC implementation
away from exposure rather than two, and it is a deviation from a written README
instruction rather than a decision the README anticipated.

**What would reverse it.**

- **The obvious fix.** Build `audio-protection` the same CPU admission broker
  `open-voice-runtime` has, flip this app to internal, and point Vercel at the
  broker. That is strictly better and is recorded as an owner action in
  `docs/gurukul/AZURE-DEPLOY-STATE.md` section 14.11.
- **The replica-processing worker moving inside the environment.** If the
  protection call ever originates from inside the managed environment rather
  than from a Vercel function, the reason for external ingress disappears
  entirely and this app should go internal the same day.
- **Any evidence of abuse.** Unsigned traffic waking the app in the platform
  logs is sufficient reason to bring the broker forward.

## transcribe-runs-through-sarvam

**`transcribe` routes through the Sarvam Saaras batch adapter, not Azure Fast
Transcription.** WS-AN, 2026-08-26, owner directive.

`api/_replica-processing/providers/sarvam-transcription.js` wraps the existing,
already-proven `api/_asr/providers/sarvam-saaras.js` (init/upload/start/poll/
collect, measured working on Hinglish —
`rejected.md#sarvam-batch-paths-were-three-guesses`) behind the DAG's own
`transcribe(common) -> {segments}` contract. `composition.js`'s ASR block now
builds this instead of `createAzureFastTranscriptionAdapter`; the Azure module
is untouched in the tree in case a future dual-lane decision wants it back.

**Why not stand up an Azure Speech resource instead**, which was the obvious
alternative: the subscription has zero Cognitive Services accounts, and the
owner explicitly ruled out adding one. Sarvam adapters already existed, were
already measured on the product's actual language (Hinglish), and needed no
new vendor relationship or bill.

**The cost of this choice, stated rather than hidden.** Sarvam's batch API
(docs.sarvam.ai, checked 2026-08-26) returns no confidence score at any
granularity — not per word, not per chunk. `api/_replica-claims.js` gates
claim extraction at `e.confidence>=0.55`. Rather than invent a plausible
number that would let unscored text pass that gate as if it had been measured,
every segment this adapter writes carries `confidence: 0` — the honest floor,
documented at length in the adapter's own header. Every Sarvam-sourced
transcript span is therefore excluded from automated claim mining until a
human reviews it in the studio. The transcript TEXT is real and is still
written as evidence; only the automatic-trust path is closed.

A second, smaller cost: `segment.language` is the language hint this adapter
requested (`hi-IN` by default), not a detected value, because neither Sarvam
lane's turn shape returns one through the shared ingestion seam
(`api/_asr/contracts.js`).

**Why this does NOT go through `api/_asr/registry.js`'s existing self-hosted-
or-Sarvam selection**, even though that selection already exists and reuse was
the instinct: the self-hosted lane hands its remote worker a SIGNED PULL URL,
not bytes. Every other adapter in this DAG enforces the opposite — a provider
only ever receives bytes this process already fetched and integrity-checked
(`azure-fast-transcription.js`'s `resolvePrivateInput` explicitly THROWS
`azure_asr_private_url_forbidden` if a resolver ever returns a URL). Reusing
the registry's selection wholesale would have silently let a future
self-hosted-ASR deploy start handing out signed pull URLs from inside this
DAG — a security posture change nobody asked for or reviewed. So this adapter
reuses the Sarvam PROTOCOL implementation specifically, named in the task, not
the broader provider selection.

**What would reverse it.**

- **Sarvam ships a real per-segment confidence score.** Then `confidence: 0`
  becomes the actual value and this decision's honest-floor half is retired in
  one line, with a `measured_by` edge to whatever proved it.
- **The owner wants Sarvam-sourced spans eligible for claim mining before that
  happens.** That is a product decision about trusting unscored transcripts,
  not an engineering one, and belongs to the owner, not to this file.
- **An Azure Cognitive Services resource is later provisioned** (subscription
  policy changes, or a second market where Sarvam's coverage is worse). The
  Azure adapter is untouched and composition.js's ASR block is the one place
  to add a second lane, selected the same way the self-hosted/Sarvam split in
  `registry.js` already is.
## layout-fixture

**Decided (2026-08-26, WS-AM):** the layout gate renders a dedicated fixture
page, `studio-layout-fixture.html`, which mounts the REAL `StudioApp` from
source with a replica seeded into `localStorage` and every `/api/*` route
answered from a fixture table by a stubbed `window.fetch`. It is a normal vite
build input, it is `noindex`, nothing links to it, and it refuses to render
anywhere but loopback.

**Why.** The gate has to see the signed-in panels, because that is where the
defect class lives, and it has to run in CI, which means it cannot have a
secret. Those two requirements have exactly one intersection. See
`rejected.md#a-layout-gate-that-cannot-reach-the-signed-in-screen` for the two
things tried before this.

**Why the real component and not a copy.** A hand-built page of representative
markup would drift from the studio the first time anyone edited a panel, and a
gate that judges a stale copy is the `gates-that-live-nowhere` failure again.
Importing `StudioApp` means the gate exercises the tree being shipped, by
construction, the same property `evals/run.mjs` gets from re-bundling.

**Why empty states rather than populated ones.** Unlisted routes return `{}`,
which lands each panel in its EMPTY or BLOCKED state deliberately. Those states
carry the longest prose in the studio and they are where every collapsed column
was found. A fixture that only ever showed populated panels would have missed
the defects that prompted it.

**What it costs.** A third HTML entry point ships in `dist/`. It is inert (the
loopback guard) and unreferenced, but it is real surface area, and the fixture
table has to be kept honest: three times during this session a panel threw
because a fixture shape was missing a key the component read without a guard
(`limits.max_item_bytes`, `attestations`, `jobs`). Each time the gate's coverage
assertion caught it rather than passing on a blank page, which is the assertion
working as designed.

**What would reverse it.** A test-only build target that can exclude the page
from production output would remove the shipped-surface objection and should be
taken. If the studio ever gains a genuine read-only demo mode driven by real
fixtures, the gate should point at that instead and this page should go. And if
keeping the fixture table honest ever becomes the reason a panel change is
painful, that is the signal that the stub is too detailed and should be replaced
by a recorded-response fixture captured from a real session.

## cascade-layer-order-must-be-declared-where-a-minifier-cannot-drop-it

**Decided (2026-08-26, WS-AM):** the studio's `@layer` ordering statement is
declared in an inline `<style>` in the head of `studio.html` (and the fixture
page), not only at the top of `studio.css` and `tokens.css`.

**Why.** Both CSS files open with
`@layer reset, tokens, base, components, responsive;` and LightningCSS, the
minifier in this vite build, treats a standalone layer statement as redundant
and strips it. The shipped stylesheet therefore began `@layer components{`, and
layer order fell back to first appearance: **components, reset, tokens, base,
responsive**, with `reset` outranking everything it was written to lose to.

**What that shipped.** `button { color: inherit }` in the reset beat
`.primary-button { color: #fffef9 }`, so every primary call to action in the
studio rendered near-black ink on forest green at a measured **1.73:1**, against
a WCAG AA floor of 4.5:1. "Next: talk to your clone", "Start the call", "Choose
files", "Save sheet draft" and six more. This was present on the untouched base
branch and was verified there before being fixed, so it is not a regression from
this session's work. See `measurements.md#studio-layout-repair`.

**Why this fix and not higher specificity.** Writing `.button.primary-button` to
out-specify the reset fixes the one symptom and leaves the cascade inverted for
every other rule in `reset` and `base`. The order is the bug.

**What would reverse it.** A vite or LightningCSS setting that preserves the
statement, or a build that stops minifying CSS, would make the head declaration
redundant, and it should then be removed rather than left as two sources of
truth. If the layer names ever change, the head statement is a third place to
change them, and that is the standing cost of this decision.

**How it is held.** `scripts/check-layout.mjs` measures the contrast of every
enabled control on nine screens, so an inverted cascade shows up as a failing
gate rather than as an unreadable button nobody measured.
## `windowing-belongs-at-separate-now-that-diarize-is-done` (2026-08-26, WS-AO)

**Decided.** `separate` no longer sends the whole recording to the GPU. It
selects the single best-scoring ~10 s window from the OWNER's own diarized
speech (never a second speaker's, never the whole file) and sends only that.

**Why this does not reopen `windowing-belongs-before-the-embedder-not-before-
diarize`.** That decision was right and stands: windowing BEFORE `diarize`
would destroy the speaker segmentation `contains_third_parties` rests on, and
the evidence service's single shared `/v1/analyze` endpoint meant windowing
there wouldn't have unblocked anything anyway. Neither objection applies here.
`diarize` is a hard DAG dependency of `separate` (`pipeline.js`'s
`AUDIO_PROCESSING_DAG`), so its segments are always complete and durable in
`vy_replica_processing_evidence` before this code ever runs, and this module
reads them rather than skipping past them. The window is drawn ONLY from the
cluster with the most total diarized speech, so a second voice's segments
(cluster-2, 25.9 s on the owner's own upload) never reach the GPU at all — a
stronger consent posture than sending the whole mixed recording ever was.

**What it does.** `api/_replica-processing/reference-window.js`: merges the
dominant cluster's segments into contiguous runs (a synthetic splice between
two far-apart segments is exactly the level lurch WS-AD's own scorer
penalises), extracts each run from the ORIGINAL recording via ffmpeg, and
scores every ~10 s window across every run with `api/_video-enroll/windows.js`'s
`rankReferenceWindows` -- WS-AD's scorer, reused rather than reimplemented, per
this workstream's brief. Only the single highest-scoring window is written to
storage and sent to `separate`'s adapter; the rest of the extracted audio never
leaves this container.

**Which cluster is "the owner".** Diarize itself refuses to name a target --
`services/voice-evidence/app.py`'s `_diarize` writes `target_likelihood: 0.5`
on every segment because it has no enrolled anchor to compare against. Absent
that, "the cluster with the most total speech in a recording the owner
uploaded of themselves" is the same working assumption
`context/measurements.md#separate-fails-on-the-whole-recording` already carries
for this exact file. Carried forward here, not invented here. **What would
reverse it:** an enrolled voice profile giving diarize (or a step downstream of
it) a real anchor to compare against, at which point the owner's cluster should
be picked by that anchor and not by duration.

**`transcribe` deliberately does NOT inherit the narrowed window.** Before this
change, `enhance`'s candidates always covered the whole recording, so
`transcribe` reading them (`runtime.js`'s `INPUT_STAGE`) was free lineage. Now
that `separate`/`enhance` narrow to ~10 s, chaining `transcribe` the same way
would have silently capped the TeacherSheet's transcript at ten seconds of a
lecture the moment ASR is configured -- and nothing would have noticed today,
because `transcribe` is blocked on `AZURE_SPEECH_ENDPOINT`/`AZURE_SPEECH_KEY`
regardless. `transcribe` now falls back to the full original source instead,
the same way `separate` itself always has: ASR reads the whole recording, the
reference window stays scoped to voice identity. **What would reverse it:** a
product decision that the TeacherSheet only ever needs the owner's best-window
speech rather than the full lecture -- nothing in the current spec says that.

**What would reverse the whole decision.** A future service change that lets
`voice-evidence` chunk-and-aggregate a whole recording server-side (the "real
fix" `windowing-belongs-before-the-embedder-not-before-diarize` named and
deliberately deferred). If that lands, `separate`/`enhance`/`voice_quality`
could see the FULL recording again rather than one window, and this module
would become the fallback for services that stay single-shot.

## refusal-names-its-precondition

**Decided** 2026-08-26. A refusal from a query that joins across many
preconditions must NAME the precondition it is waiting on, and must carry which
side of the blocker split it falls on.

**Why.** `beginOwnedVoicePreview`'s `eligible` CTE joins across fifteen
conditions: three consent scopes, four identity checks, source readiness, third
party absence, a draft genome at the requested version, a selected artifact at
the `enhance` stage, and the trial binding. Any one unmet returns zero rows, and
all fifteen surfaced as `voice_preview_not_authorized`. The end to end journey
scored 13/15 on this single code, and both of its failures were it.

Two things were wrong, and the second is the serious one. It was unactionable:
a person cannot tell a missed consent box from a pipeline still working. And it
BLAMED THEM for our latency, which breaks the waiting-on-you versus
waiting-on-us law in the most visible panel in the product. An
authorization-flavoured word is not a neutral default; it asserts the user is at
fault.

**Shape.** On an empty result, ONE diagnostic query, scoped to the same
(replica_id, owner_user_id) pair so it can never describe another person's
replica, checks each precondition and returns the first unmet one in the order a
person actually meets them. Consent before a genome they have never heard of.
The class rides along with the code, the route passes it through, and the studio
has copy per code that never says "try again" where retrying cannot help.

Two refusals to guess are part of the decision, not incidental: a diagnostic
that cannot run falls back to the old opaque code rather than inventing a
reason, and a refusal from a precondition the diagnostic does not cover says
exactly that and stays on our side of the split.

**Verified** by EXECUTING the diagnostic against the live database, not a mock.
A mocked database cannot type-check SQL and three shipped queries in this repo
were once 0A000 and had never run.

**What would reverse it.** If the precondition set becomes cheap to express as
a single query returning a reason column, fold the diagnostic into the main
statement and drop the second round trip. If a diagnostic is ever measured
leaking the existence of another person's replica, remove it and return the
opaque code rather than narrowing it.

**Generalises.** Any `eligible`-style CTE in this codebase has the same defect
shape. An empty join result is not an authorization verdict.


## `replica-self-test-mode` — no identity or liveness check for self-only internal testing, gated by one env flag (2026-08-26, WS-AQ)

**What.** `REPLICA_SELF_TEST_MODE`, default OFF/absent. When set to exactly
`"true"`, a replica with `subject_mode='self'` gets all four things that
blocked the owner's real upload tonight satisfied automatically, the moment
each becomes possible:

1. `age_verified_at` / `identity_verified_at` / `liveness_verified_at` /
   `identity_expires_at` on `vy_replica`.
2. The `biometric`, `training` and `inference` consent scopes (method
   `account_attestation`, the check constraint's own vocabulary for "the
   account owner attested this, no separate ceremony ran").
3. Every reviewable evidence row without an existing decision, `accepted`.
4. One `enhance`/wav artifact candidate, `selected` — then
   `queueOwnedVoiceGenome` (the real function) is called to queue the draft
   build.

**Why.** The owner's directive, said three times, verbatim: "just give the
whole permission allow for once only so we don't have to do any liveness
check or identity check whatsoever," for internal testing, not deployed
anywhere, for weeks. Tonight's incident is the concrete cost of not having
this: eight DAG steps completed and then nothing happened, because a person
would have had to click "accept" on 337 evidence rows one at a time, and the
main session ended up satisfying every gate by hand, directly in production,
to get a draft genome built at all.

**Shape, and the two rules that make it safe rather than a deletion.**
First, every write goes through the SAME functions and the SAME tables a
human reviewer's decisions go through --
`acceptAllOwnedEvidenceForSelfTest`/`selectOwnedVoiceArtifact`/
`queueOwnedVoiceGenome` in `api/_replica-review.js`, called from
`api/_replica-processing/self-test.js`. It never hand-writes a
`vy_replica_model_build` row or a `source_set_hash` -- seeing exactly that
mistake made and refused tonight (`model_build_source_set_changed`) is why
this is a rule, not a preference. Second, every row it writes carries
`metadata.self_test_mode=true` and `metadata.granted_by='REPLICA_SELF_TEST_MODE'`
(migration 063 added the `metadata` column to the two decision tables that
did not already have one), so `scripts/revoke-self-test-grants.mjs` can find
and reverse all of it in one statement, for every replica, at once.

**Where it hooks.** `runNextProcessingJob`'s `settle()`
(`api/_replica-processing/runtime.js`), immediately after `commitProcessingOutput`
for the `voice_quality` step -- the one step that flips
`vy_replica_source.state` to `'ready'`, which is the earliest a voice genome
could ever be buildable. No second endpoint, no timer: the owner's loop stays
"upload, wait, preview."

**Self only, at the SQL level, not only by convention.** Every statement this
module runs filters `subject_mode='self'` inside its own `WHERE`, not only in
the caller -- `vy_replica.subject_mode` is itself constrained to only
`'self'` by the schema today (migration 015), so this is currently
belt-and-suspenders, but it stays load-bearing the day that check constraint
is ever widened.

**On screen.** `ProcessingReview.tsx` shows a banner, gated on
`review.self_test_mode` (added to `ownedReviewStatus`'s response), built with
`blockerClass.ts`'s existing `disabledReason("us", ...)` -- not a second
vocabulary. The owner is told plainly, every time the review panel is open,
that identity and liveness checks are off for this replica.

**Verified live**, not mocked: see `self-test-four-gates-measured-blocking`.
A negative control ran first -- flag absent, same fixture shape, all 8
blockers held and `queueOwnedVoiceGenome` still threw 409.

**What would reverse it.** The product has ANY user who is not the owner.
At that point this flag must be off in every environment that user can
reach, and `scripts/revoke-self-test-grants.mjs` should be run to clear
whatever it granted during the owner's own testing before that user's data
ever shares a database with it.
## one-honest-next-action-lives-in-the-rail-never-a-sticky-button

**Decided** 2026-08-26 (WS-AP), owner directive, verbatim: "this bottom section
should be completely removed... Remove it. Not shrink it, not reword it, not
make it conditional. Delete it."

**Why.** The studio had a fixed bar (`.wizard-pager`, `StepPager`) pinned to
the viewport foot on every step, carrying a "Next:" primary button and a
caution sentence. It carried the exact bug this workstream exists to fix, in
its most visible form: the primary button pointed at the next step
unconditionally, including a step the SAME screen simultaneously called
refused (a first attempt at fixing this — `wizardModel.pagerAction`, gating
the button on `computeWizard`'s own `state === "running"` — closed that one
symptom but left the object itself, and the owner's report named the object,
not the symptom). Its explanatory line truncated mid sentence in the space it
was given, and it occupied roughly a third of a 390px viewport permanently, on
top of the content it was talking about.

**What replaced it: nothing built.** `WizardRail`/`CompactRail` were already
always-visible, already computed from `wizardModel.computeWizard`, already
named the one thing left on each step, and every row was already clickable
regardless of readiness (`context/decisions.md` on the wizard's own "never
silently blocked" rule). No new component was needed because the honest
surface already existed beside the one that lied. `pagerAction`/`PagerAction`
and the `nextStep`/`previousStep`/`nextLabel`/`backLabel` helpers that only
ever fed the deleted button were removed with it
(`context/rejected.md#the-sticky-pager-was-deleted-not-shrunk` has the
shrink-first attempt and why it was the wrong diagnosis).

**The property that survives the deletion.** "The primary CTA never points at
a step with nothing actionable" is now enforced as a DOM assertion rather than
a unit-tested model function, because there is no longer a function to
unit-test: `scripts/check-layout.mjs`'s `pager-returned` finding fails if
`.wizard-pager` or any button labelled "Next: " renders anywhere, on every
step, at every width. Proven to bite: reintroducing the old markup produced 18
findings across three widths; reverting produced zero. Verified 2026-08-26.

**What would reverse it.** If a future redesign genuinely needs a persistent
forward action again, it must be built to the same rule this section states —
one honest action, derived from `computeWizard`, never rendered when the
target step is `state === "running"` — and it must come with its own DOM
negative control before it ships, not after a second owner report.

## voice-genome-approval-is-the-owners-turn-not-the-platforms

**Decided** 2026-08-26 (WS-AP), from a production defect measured against the
owner's real replica: all eight processing steps complete, identity and
liveness verified, `vy_replica_voice_genome` and `vy_replica_model_build` both
empty, and the studio said "waiting on us" in its most important panel
("Preview my voice") while the true blocker was entirely the owner's: go to
Processing Review, review the evidence, and press "Queue a draft voice
model" — the deliberate human tap `queueOwnedVoiceGenome` requires by design
(`api/_replica-review.js`), and correctly so: a persona never self-updates
without one.

**What changed.** `BLOCKER_META.voice_genome_not_approved` in
`src/studio/wizardModel.ts` moves from `owner: "platform"` (note: "We are
waiting on processing review and approval. Nothing for you to do.") to
`owner: "you", needsProcessedMaterial: true` (note: go review and queue a
build), the same treatment `person_profile_not_approved` and
`calibration_not_approved` already had. `needsProcessedMaterial` still
reclassifies the row to `us` while the platform's own ingestion queue
(`platformWork`) is genuinely holding work, so the row is never ember before
there is anything real to review.

**Why this was backwards being worse than silent.** `docs/HONESTY.md`'s law is
that an unexplained state defaults to `us`, on the theory that our failure to
explain is ours, not theirs. This code sat on the WRONG side of that default:
it explicitly, confidently told the owner the platform was working on
something it was not, using the exact reassuring words ("nothing for you to
do") that make a person stop looking for the actual next step. Silence would
have been a smaller lie.

**Verified.** `evals/studiowizard.mjs`'s existing 80-check suite (unchanged
assertions, same class-honesty properties from section 8) plus a new section
10 exercising `voicePreviewBlockReason` — the function `VoicePreviewPanel.tsx`
now calls instead of hardcoding its own class — over the full input space
(27,648 rows) and against the exact production shape (identity/liveness
unverified; identity/liveness done with an unreviewed genome; the same gate
while `platformWork` is genuinely busy). All pass; see
`context/measurements.md#voice-preview-block-reason-production-shape`.

**What would reverse it.** If a future build adds an automated,
person-uninvolved path from reviewed evidence to an approved genome (removing
the deliberate human tap entirely), this reclassification would need
revisiting — at that point the gate genuinely would be ours again. No such
path exists today; `queueOwnedVoiceGenome` is reached only from a person
pressing a button.
## `enrollment-artifact-resamples-to-24k-inside-enhance` (2026-08-26, WS-AR)

**Decided.** `services/voice-evidence/app.py`'s `_enhance` now resamples its
DeepFilterNet3 output from 48 kHz down to `ENROLLMENT_SAMPLE_RATE` (24_000)
with `torchaudio.functional.resample` before writing the WAV it stores as an
enhance-stage artifact. DeepFilterNet3 still RUNS at 48 kHz internally -- that
is the model's own native rate, not a choice this fix makes -- only the
EMITTED WAV changed.

**Why this and not a second decimator in the Vercel API layer.** The owner
directive was explicit and the reasoning generalises: fidelity is this
product's core measured metric, and a hand-rolled 2:1 decimation with no
anti-aliasing filter would degrade the voice silently -- it would look fixed
(the format gate would pass) and sound worse, which is the one failure mode
worse than the bug being fixed. `torchaudio.functional.resample` is already
the properly anti-aliased function this same file uses for every other rate
conversion (`_decode_audio`), so reusing it keeps the resampling logic in one
place with one quality bar, and it happens exactly once, server-side, on the
highest-fidelity signal DeepFilterNet produces -- not twice, and not on a
copy that has already been shipped over the wire.

**Why 48 kHz was kept nowhere.** Grepped every reader of a `stage='enhance'`
artifact before deciding (`api/_replica-voice-preview.js`,
`api/_replica-review.js`, `api/_replica-voice-curriculum.js`,
`api/_replica-voice-delivery-policy.js`, `api/_replica-voice-profile.js`,
`api/_replica-model-build.js`). None of them read or care about the artifact's
STORED sample rate -- `voice_quality`'s own measurement function
(`services/voice-evidence/app.py::_measure`) calls `_decode_audio(entry)` with
its default `target_rate=16_000` regardless of what rate the input WAV is
already at, so it would have resampled a 48 kHz OR a 24 kHz artifact down to
16 kHz for embedding either way. Keeping a second 48 kHz artifact around would
have bought nothing measurable and doubled storage and DAG-artifact count for
every enrollment; there was no "prefer keeping 48 kHz" case to satisfy.

**What would reverse it.** A future consumer that reads enhance-stage bytes
directly for a quality measurement THAT ACTUALLY DEPENDS ON the stored sample
rate (not one that resamples on read, the way every current reader does).
Should that appear, the right shape is an ADDITIONAL enrollment-grade variant
alongside the archival one, per the original design-decision fork this
decision was chosen over -- not reverting the enrollment WAV back to 48 kHz,
since `probeEnrollmentWav` and the whole synthesis chain downstream of it will
never accept anything else.

## `transform-version-must-move-with-output-format` (2026-08-26, WS-AR)

**Decided.** `services/voice-evidence/app.py`'s `MODEL_REVISIONS["deepfilternet"]`
changed from a bare model-hash string to `"deepfilternet3-enroll24k-v1"` when
`_enhance`'s output format changed, even though the DeepFilterNet3 WEIGHTS did
not change.

**Why.** `vy_replica_artifact_variant_unique` keys an artifact's identity on
`(source_id, stage, transform_version, variant_key, input_sha256)` -- not on
its output bytes. Re-running `enhance` over an unchanged `separate` artifact
with an unchanged `transform_version` therefore produces the same key with
DIFFERENT content, which the constraint correctly refuses (SQLSTATE 23505,
unhandled at the call site -- `neon_query_failed_23505` with no further
detail, by `services/replica-processing-worker/db.js`'s deliberate policy of
carrying only the SQLSTATE). Caught live, in production, while proving the
sample-rate fix on the owner's real replica: the first re-run attempt hit
exactly this collision.

**The generalisable rule this names:** `transform_version` must change
whenever a transform's OUTPUT changes for the same input, not only when the
model backing it does. The DeepFilterNet3 checkpoint identity and the wire
format this service promises downstream are two different facts, and only one
of them was being tracked.

**Two more things this decision caught, worth naming because they will recur
for the next transform_version bump:** the JS-side candidate validator's
`SAFE` regex (`api/_replica-processing/providers/azure-voice-evidence.js`) is
`[a-z0-9][a-z0-9._-]{0,79}` -- lowercase only, no `+`, max 80 chars. A first
attempt (`...+enroll24k` appended to the existing hash) was rejected for the
`+`; a second attempt (`...-enroll24k`, same base) was rejected for landing at
89 characters. The value that shipped, `deepfilternet3-enroll24k-v1`, is short
and SAFE-clean by construction rather than derived from the old string.

**What would reverse it.** Nothing reverses the rule; it is a correctness
constraint on how `transform_version` is used, not a preference. A future
change to `vy_replica_artifact_variant_unique` that keys on content hash
instead of transform_version would make version bumps unnecessary for a
format-only change, but no such change is planned.

## `separate-skips-below-16khz-when-diarize-shows-one-dominant-speaker` (2026-08-27, WS-AS)

**Decided.** `separate`'s GPU model (`sepformer-whamr16k`, which runs at
16 kHz and therefore imposes an 8 kHz Nyquist ceiling on everything it
touches) is now skipped entirely when the dominant diarized cluster holds
>= 90% of all diarized speech for the source. When skipped, the reference
window `api/_replica-processing/reference-window.js` already extracts is cut
fresh from the ORIGINAL recording at `ENROLLMENT_SAMPLE_RATE` (24 kHz) and
becomes `separate`'s output directly, labelled `reference-window-passthrough`
rather than a fabricated separation result.

**Why.** The owner's verdict ("this ... is not even 0.05% similar ... it's
all fucked") traced to a real, structural cause, not a vague quality
complaint: `separate` ran its 16 kHz-Nyquist model on EVERY recording,
including single-speaker lectures that have no overlapping-speaker problem
for it to solve. Measured on the owner's real reference:
`enrollment-reference-bandwidth-before-after` (this session) -- 0.000458%
energy at/above 8 kHz before, 0.0224% after (roughly 49x), on the SAME
recording, at a real diarized position. Speaker-identity cues live
substantially in 4-10 kHz, so a reference built this way was structurally
pushing Chatterbox toward its own base timbre.

**Why 90%, specifically.** Diarize's own cluster threshold
(`VOICE_EVIDENCE_CLUSTER_COSINE_THRESHOLD=0.68`) already decides when two
voiced spans are different speakers; this decision does not re-litigate that.
It asks a coarser question on top: even granting a second cluster exists, is
it large enough that removing it from the reference is worth losing 4-10 kHz
of the dominant speaker's own voice? Below 90% dominant share, non-dominant
clusters sum to more than a tenth of all diarized speech (two co-teachers, a
Q&A segment) and separation is doing real, defensible work. At or above it,
what remains is stray cross-talk or diarize's own clustering noise, and
running a bandwidth-destroying model to remove single-digit seconds of that is
not a defensible trade against the dominant speaker's own identity. Measured
on the owner's real upload: `dominantShare=0.9528` (4 clusters found; the
non-dominant three sum to well under 10%), clearing the threshold with
headroom, not sitting on the boundary.

**What this does NOT change.** `enhance` (DeepFilterNet3) still runs
unconditionally after `separate`, on whatever `separate` produced (real
separation or the pass-through). This session did NOT measure enhance on/off
as a separate variable -- see `rejected.md#deepfilternet3-on-vs-off-not-
measured-this-session` -- so no claim is made about whether denoising helps
or hurts identity preservation once the reference is already full-bandwidth.
The 24 kHz output rate `enhance` resamples to (WS-AR,
`enrollment-artifact-resamples-to-24k-inside-enhance`) is unchanged and is
exactly why the AFTER reference above still shows a genuine 24 kHz ceiling
(12 kHz Nyquist) rather than 48 kHz: that ceiling is the platform's own
delivery contract, not a defect.

**What would reverse it.** A measured case where a recording just above 90%
dominant share still shows audible cross-talk bleed-through in its selected
window -- no session has found one; the only real recording measured (the
owner's, at 95.28%) is clear of the boundary either way. Separately: if
`voice-evidence` ever gains a chunk-and-aggregate mode that scores the WHOLE
recording server-side rather than a single ~10 s window (the deferred "real
fix" named in `windowing-belongs-before-the-embedder-not-before-diarize`),
this module becomes the fallback for services that stay single-shot, per
`windowing-belongs-at-separate-now-that-diarize-is-done`'s own reversal
condition, which this decision does not alter.

## `room-agent-scope-reaches-the-wire` — a room address, history and disclosure are keyed by agent (2026-08-27)

A clone binding is not complete when it changes only the persona passed to
`compile()`. The same `ctx.agentId` now reaches room lookup and creation,
membership, entitlement, episode creation, raw turn writes, action writes,
history, roster, fact/phrase disclosure and the room-scoped withdraw command.
DM raw writes, history and disclosure use the same key. Identity and
`vy_person_device` remain agent-independent: the person is shared; the
relationship is not.

Migration 064 widens both room-address uniqueness laws from a global surface
address to `(agent_id, surface, surface_chat_id)` and, during the legacy
Telegram compatibility window, `(agent_id, tg_chat_id)`. It is present in the
tree and is NOT applied live by this workstream.

**Reverses if:** one inbound event may intentionally carry more than one agent.
At that point `ctx.agentId` is the wrong unit and the agent key must move onto
each event. A prompt instruction, a persona swap without storage predicates,
or a globally unique chat key cannot reverse the isolation requirement.
## `large-replica-media-is-direct-disk-bounded-and-chunked` (2026-08-27)

**Decision.** Original replica audio up to 1 GiB uploads from the browser to
Supabase Storage through a signed TUS capability in 6 MiB chunks. The API never
proxies the body and the service-role key never reaches the browser: TUS gets a
separate public `SUPABASE_KEY` plus the short-lived `x-signature`, and issuance
fails if the two configured keys are identical. The worker streams an original
from private storage into a mode-0600 temporary file while hashing it, gives
ClamAV that file by `--fdpass`, and removes it in `finally`.

Recordings longer than one voice-evidence request are diarized as deterministic
14 minute WAV chunks with 60 seconds of overlap. Local speaker labels are joined
only where their absolute-time speech overlaps; a silent or ambiguous boundary
creates a new global cluster rather than guessing that a guest is the owner.
Spans are trimmed and stored on the original absolute timeline, so the existing
evidence schema and owner-window selector do not change. Sarvam reads the same
verified temporary file as a stream, and the job/lease bound is one hour so a
legitimate two-hour batch is not leased twice at the old 15 minute boundary.

**Why.** A larger numeric upload cap alone leaves three independent ceilings:
one monolithic browser PUT, the worker's 64 MiB heap collection, and the voice
service's 20 minute request ceiling. The chosen shape bounds each transfer and
keeps the consent-critical whole-recording speaker evidence. It also removes
ClamAV INSTREAM's configured-size dependency rather than merely moving that
number again.

**What would reverse it.** A private evidence service that accepts a storage
stream and performs global online speaker clustering can replace worker-side
chunks, after a comparison proves identical-or-better speaker separation across
silent boundaries. A storage provider without signed TUS would require signed
multipart upload, not an API proxy. The 1 GiB product ceiling should move only
with measured worker disk headroom and a matching private-bucket limit.

## `hinglish-benchmark-keeps-raw-and-adjusted-separate` (2026-08-27)

**Decision.** Speech and first-clone evaluations retain the legacy raw outputs
and add a separately named `curated_cross_script_wer_cer/v1` diagnostic. The
adjusted arm canonicalizes only a bounded reviewed Roman/Devanagari alias
table, reports mapping coverage, leaves unknown Devanagari as errors, and does
not accept English confusables such as `he` for `hai`. The first-clone sheet
artifact likewise retains `stats.codeSwitch` unchanged and adds
`curated_script_aware_hindi_marker_proxy/v1` under `benchmarkMetrics`. Neither
adjusted metric is language ID or a Hindi-token percentage, and neither feeds
the sheet draft or production ingestion behavior.

**Why.** A raw Unicode edit compares `main abhi deploy kar rha hai` with
`मैं अभी deploy कर रहा है` as five word errors out of six even though the
reviewed Hindi words are equivalent. Replacing raw WER would hide how much of
an apparent improvement came from aliases. Arbitrary transliteration would
create the opposite failure by guessing unknown words or forgiving real
pronunciation confusables. Two arms plus explicit coverage preserve both facts.

**What would reverse it.** A versioned transliterator or token-level language
identifier may replace the alias table only after a held-out owned
Hindi/Hinglish corpus measures its false-equivalence and miss rates, including
English confusables, unknown words, mixed script and code-switch boundaries.
Raw Unicode WER/CER remains an audit arm even then.

## `large-media-release-needs-both-runtime-and-account-cap` (2026-08-27)

**Decision.** Signed TUS, streaming processing and the one-hour worker lease may
ship independently of the storage account upgrade, but the product must not
claim a live 1 GiB ceiling until the Supabase project global Storage limit is
raised and a real file above 50 MiB completes TUS upload and processing. The
code remains bounded at 1 GiB so the account change does not require another
runtime rewrite. No paid plan change is made silently.

**Why.** Production accepted the new worker and web runtime, but Supabase
returned HTTP 413 when the private bucket was assigned a 1,073,741,824-byte
limit. The bucket has no explicit limit, so the project-wide ceiling still
wins. Hiding that behind a client validator would turn an account refusal into
a late upload failure.

**What would reverse it.** A different private object store with a measured
signed resumable path can replace the Supabase ceiling. Otherwise this decision
closes when the project global limit is raised, the private bucket is set to at
least 1 GiB, unsigned reads still fail, and one >50 MiB production upload reaches
`ready` through the deployed worker.

## `hindi-cfg-benchmark-binds-requested-and-effective-conditioning` (2026-08-27)

**Decision.** The supported Hindi CFG experiment is a blind matched-seed pair,
not an unlabelled style change. `scripts/earbench.mjs stimuli --cfg-ab` binds
the same text, seed, reference bytes, reference-language evidence, model arm
and model commitment across two synthetic arms. The incumbent control preserves
its historical requested CFG through the runtime's explicitly labelled legacy
compatibility path; the second arm explicitly requests `cfg=0` through
`vyakti-voice-language-conditioning/v1`. The sealed key records requested and
effective CFG, reference language mode and evidence scope, conditioning
contract, model pack/arm/commitment, text/reference hashes and output receipt.
Neither arm is designated as better. `first-clone.mjs` remains a single-arm
pipeline probe, but now requires the same explicit reference evidence and
writes the observed requested/effective conditioning to its own manifest.

**Why.** The product provider correctly turns Hindi with a Latin-only or
unknown reference into effective `cfg=0`. A benchmark script that omits
reference evidence can therefore print a requested CFG of 0.5 while silently
running 0, making an apparent A/B two copies of the same condition. Preserving
the incumbent through the benchmark-only compatibility contract avoids
falsifying the reference label and leaves production routing unchanged. The
contract difference is stored as a known wire difference, not hidden as if CFG
were the only byte-level request difference.

**What would reverse it.** Remove the legacy control only after the production
conditioning contract gains a benchmark-scoped, receipt-bound way to request
the historical effective CFG without mislabelling reference evidence, or after
a recorded owner decision retires that incumbent from comparison. The blind,
matched bindings and requested/effective receipt fields remain required for any
replacement experiment.

## `hindi-voice-release-separates-mitigation-from-model-promotion` (2026-08-27)

**Decision.** Production stays on the general Chatterbox Multilingual V3 arm.
For Hindi synthesis, source-transcript evidence is used only to prefer a
Devanagari or mixed reference; a Latin-only or unavailable observation applies
Chatterbox's documented `cfg=0` accent-transfer mitigation and records the
requested/effective CFG, evidence scope and warnings. It is called a mitigation
setting, not an observed quality improvement. Sarvam batch transcription uses
automatic language detection instead of forcing `hi-IN`, and absent provider
evidence remains unknown. The dedicated Hindi V3 pack is built and evaluated
on a separate origin and cannot replace the English-capable production origin
until it passes protected synthesis, cold-start and owner listening gates.

**Why.** The owner rejected every current Hindi sample as foreign-accented,
robotic and non-human. Chatterbox itself warns that prompt-language mismatch can
transfer accent and names CFG zero as a mitigation, while the old processing
path forced a Hindi locale and then retained that request hint as if detected.
Those facts justify a bounded mitigation and honest evidence, but they do not
prove that CFG zero or the Hindi pack sounds more like this owner. A global
Hindi-pack switch would also intentionally refuse English and break a core
product language.

**What would reverse it.** A replacement arm may become production default only
after an immutable remote image loads the pinned weights without unreviewed key
drift, passes protected synthesis and three cold-start measurements on the
deployed GPU class, and wins a blinded owner/known-listener Hindi and Hinglish
comparison without an intelligibility regression. Exact-window language may
replace source-level evidence only when selected-window offsets and transcript
lineage are persisted end to end.

## `hindi-runtime-remains-isolated-after-load-smoke` (2026-08-27)

**Decision.** Keep the general multilingual arm on the production origin and
the Hindi V3 pack on separate `-hi` runtime and gate names with scale-to-zero.
The infrastructure template forces Hindi onto non-production names regardless
of the production-name parameters. Only the two tokenizer buffers explicitly
reconstructed by the pinned official source may be absent during Hindi S3Gen
loading. Model load and signed synthesis qualify compatibility, not perceptual
quality or promotion.

**Why.** The Hindi pack intentionally refuses English, the owner has rejected
all current Hindi output, and the first remote smoke measured about 293 s cold
end to end. Replacing the global origin would break English while promoting an
arm with no owner ABX win. Azure also selects the T4 through the workload
profile; its API rejects a `gpu` resource member and probe delays over 60 s.

**What would reverse it.** The Hindi arm may share production routing only
after a language-aware router exists, three cold-start measurements meet a
declared SLO, and a blinded owner/known-listener Hindi and Hinglish evaluation
wins without an English or intelligibility regression. Separate immutable
model commitments and rollback paths remain required.

## `replica-media-uses-neon-metadata-and-durable-azure-blob-locators` (2026-08-27)

**Decision.** Neon remains the relational control plane for ownership,
consent, jobs, hashes, provenance, memory and erasure state. Large private
replica bytes move to a dedicated Azure Blob account through exact-blob,
HTTPS-only, create-only block-upload capabilities. The existing
`storage_bucket` column is the durable provider locator: plain legacy values
route only to Supabase, while new rows use
`azureblob:<account>:<container>`. Reads, retries, processing and erasure route
from that persisted value and never fall back to another provider on a miss.

**Why.** Supabase Free enforces a project-wide 50 MB object ceiling that code
and per-bucket settings cannot bypass. Neon Postgres is built for relational
state, not multi-hour media payloads. Explicit locators preserve every legacy
object without a risky bulk copy and prevent identical object paths from being
read or erased on the wrong backend. Azure block uploads keep the browser and
worker memory bounded while the worker's streamed SHA-256 remains content
authority. Transactional CRC64-NVME headers serialize the 64-bit checksum
little-endian, matching Azure's wire format; a live block request rejected the
otherwise numerically-correct big-endian representation with HTTP 400 and
accepted the little-endian representation with HTTP 201.

**What would reverse it.** A different object plane may replace Azure only
after production-region availability, published limits and pricing, direct
multipart capability, exact tenant scoping, immutable-write behavior and
cross-branch biometric erasure all pass the same live suite. A redundant
provider column should be added only if `storage_bucket` can no longer encode a
single unambiguous backend locator.

## `replica-self-test-requires-owner-bound-three-part-guard` (2026-08-27)

**Decision.** The internal replica ceremony bypass is no longer enabled by a
single global boolean. It requires the exact three-part contract
`REPLICA_SELF_TEST_MODE=true`,
`REPLICA_SELF_TEST_ENVIRONMENT=internal-owner-testing`, and a valid
`REPLICA_SELF_TEST_OWNER_USER_ID` matching the authenticated source caller or
leased processing-job owner. Before source creation, that exact owner gets the
six private ingestion/model scopes (`capture`, `transcription`, `storage`,
`biometric`, `training`, `inference`) plus the existing test identity fields.
After real processing, the same guard permits the existing evidence acceptance,
artifact selection and draft queue path. Every SQL statement still requires
the same owner tuple and `subject_mode='self'`; authentication, storage,
quarantine, malware, evidence and model-build gates are unchanged.

**Why.** The old flag ran only after `voice_quality`, so it could not clear the
`capture` and `storage` predicates that must pass before the first upload. It
was also global to the worker: once set, any authenticated account's self-mode
replica could eventually receive the same grant. A UUID allowlist makes the
owner's temporary no-click test loop possible without turning one copied
boolean into a cross-account capability.

**What would reverse it.** Remove the source bootstrap and all three settings,
then run `scripts/revoke-self-test-grants.mjs`, before any non-owner uses the
shared environment. A future isolated test deployment may replace the UUID
allowlist only if it has a separate database and auth tenant and proves the
same fail-closed negative controls. Production user flows never inherit this
contract.

## `azure-upload-mime-is-bound-by-the-authorized-source-contract` (2026-08-27)

**Decision.** Azure block-list commit persists the server-authorized source
MIME carried in the signed upload capability. It never persists the browser's
raw `File.type`. Finalize retries are owner-scoped and idempotently return an
existing quarantined, processing or ready source; a rejected source continues
to return its exact rejection code instead of collapsing to a missing-pending
record.

**Why.** Windows reported a real MP3 as `video/mpeg`. Intake correctly inferred
and stored `audio/mpeg` from the `.mp3` extension, but the browser then wrote
the unrelated OS label into Azure Blob properties. The byte count was exact,
yet finalize correctly rejected the MIME mismatch. A retry queried only
`pending_upload`, so the already-rejected row became the misleading
`pending_source_not_found` error.

**What would reverse it.** The server-authorized MIME may stop being the blob
property authority only if a content-sniffing service runs before commit and
returns an authenticated type that is stored in both the source record and
blob metadata. Finalize may stop returning terminal state only if clients gain
a separate, equally owner-scoped status endpoint and all retry callers migrate
to it first.

## `integrity-root-starts-the-malware-daemon-for-the-same-run` (2026-08-27)

**Decision.** A processing execution whose initial queue contains either
`integrity` or `malware_scan` must refresh signatures and start ClamAV before
leasing work. Integrity is a scanner-start trigger because its deterministic
child is `malware_scan` and the same bounded execution can lease that child
immediately.

**Why.** The first live 250.7 MiB lecture run saw only `integrity` during its
initial pending-work check, skipped ClamAV, completed integrity, then leased the
new scan child and recorded `clamav_daemon_unavailable`. The scanner image and
client were present; startup timing, not file content or capacity, caused the
retry.

**What would reverse it.** Integrity may stop pre-starting ClamAV only if the
run loop is changed to detect and start scanner dependencies before each lease,
or if it deliberately ends after integrity so a later execution starts with a
visible scan job. Either replacement must pass a real integrity-to-scan run in
one container execution without weakening fail-closed signature refresh.

## `composed-processing-adapter-facts-stay-in-the-persisted-safe-alphabet` (2026-08-27)

**Decision.** Every adapter wrapper must preserve `family`, `name` and
`version` inside the processing contract's persisted `SAFE_PART` alphabet.
The chunked diarization wrapper uses a hyphenated version suffix and its focused
test runs the real `assertAdapter` contract, not only its diarization method.

**Why.** The live long-audio run passed malware and media probing, then failed
before diarization with `invalid_processing_adapter`. The wrapper had appended
`+normalized-overlap-chunks-v2`; `+` is intentionally excluded from persisted
adapter identifiers. Functional chunk tests missed the same validation the
worker performs at its boundary.

**What would reverse it.** A richer version alphabet may be adopted only with
a schema and contract migration that proves old manifests, receipt hashing and
path derivation remain stable. Until then, every composed adapter must pass the
same assertion used by the production worker before it can be called live.

## `run-once-owns-and-stops-the-clam-daemon-lifetime` (2026-08-27)

**Decision.** The replica processing container owns the foreground ClamAV
child for exactly one bounded run. Every exit clears the run timer and sends
`SIGTERM` to a still-live daemon before the Node process may finish.

**Why.** A live execution finished its useful database work but remained
`Running` while later scheduled executions completed. `startClamd` returned a
referenced child and `run-once` never stopped it, so Node could not exit and
Azure could bill the empty container until the 3,600-second replica timeout.

**What would reverse it.** Explicit shutdown may be replaced by a supervised
sidecar or an unreferenced child only after three scanner-bearing executions
end promptly, propagate daemon startup failure correctly and leave no orphan
process. The scale-to-zero cost property remains mandatory.

## `unexpected-processing-errors-get-content-free-operator-diagnostics` (2026-08-27)

**Decision.** A programming error without an existing adapter or contract code
logs only its bounded exception type, a message that passes a strict safe-text
alphabet, and the first repository-local processing frame. URLs, paths, tokens
and arbitrary messages are replaced with `redacted`; the durable job code stays
`processing_worker_error`.

**Why.** The exact long lecture deterministically reached diarization twice,
but the worker collapsed both exceptions to one generic code and discarded the
only information that could distinguish chunk extraction, transport and
reconciliation. That made a production-only defect unactionable while adding
unbounded exception text would risk source locators or credentials in logs.

**What would reverse it.** The diagnostic may disappear only when every
processing boundary converts all expected runtime failures into stable,
content-free codes and a fault-injection gate proves no unexpected exception
can reach the worker catch.

## `composed-diarization-invokes-the-adapter-method` (2026-08-27)

**Decision.** Production chunk composition accepts one diarization adapter
object and invokes its validated `diarize` method for every normalized window.
The exact composition helper is executable in the focused suite so the test
crosses the same object/method boundary as the deployed worker.

**Why.** The helper correctly passed the adapter object to the chunk wrapper,
but its callback later attempted to call that object itself. The live safe
diagnostic proved the TypeError at `composition.js:192`; no request could reach
the private GPU service regardless of recording quality, length or retries.

**What would reverse it.** Only a versioned adapter contract that makes the
family itself callable could replace method dispatch. That migration would
need to change `assertAdapter` and all step mappings together.

## `sarvam-stream-upload-binds-length-and-truthful-media-extension` (2026-08-27)

**Decision.** Every Sarvam directory-SAS Put Blob request carries the exact
integrity-verified `Content-Length`, even when the body is a Node stream, and
its bounded filename extension is derived from the declared MIME type.

**Why.** The requested 250.7 MiB MP3 passed six processing stages, then Azure
Storage rejected Sarvam's upload with HTTP 400. The disk-streaming path supplied
`duplex: half` but no length, so Node selected chunked transfer for a Put Blob
request that has a known size. It also called MP3 bytes `input-0.wav`, making
the next provider boundary ambiguous even if storage accepted the body.

**What would reverse it.** A multipart/block-list Sarvam upload protocol could
replace single Put Blob if its directory capability documents that contract.
It must still bind the verified total length, MIME and final media name, and
prove retry/idempotency against the live SAS shape.

## `voice-genome-readiness-uses-the-build-evidence-window` (2026-08-27)

**Decision.** VoiceGenome queue readiness uses the bounded accepted-evidence
query used by the immutable build input, not the latest 300 rows shown in the
owner review UI. More than 2,000 accepted voice evidence rows fail closed.

**Why.** A 1:49:31 recording produced 1,683 speaker segments plus later
language, transcript and voice measurements. The latest-300 UI window excluded
every speaker segment, so the completed source incorrectly failed with
`reviewed_speaker_segment_required` even though the build input contained the
evidence. UI pagination must not define model readiness.

**What would reverse it.** A summarized readiness table may replace the bounded
query only after its transactionally maintained counts are proven identical to
the accepted immutable build set for long, multi-source recordings.

## `self-test-preview-advances-lifecycle-and-prefers-identity-preservation` (2026-08-27)

**Decision.** The triple-guarded owner self-test bootstrap advances only
`draft` or `consent_pending` replicas to `enrolling`, preserves all later or
terminal states, and selects enhance artifacts by explicit identity-preserving
metadata before insertion time or aggressive noise suppression.

**Why.** All six private scopes and a draft genome existed, but the replica
remained `consent_pending`, outside the preview authorization corridor. The
same automatic path selected the later noise-suppressing reference despite a
durable `identity_preservation_candidate=true` alternative. Both defects made
the internal two-step flow diverge from its stated contract.

**What would reverse it.** Automatic ranking may be replaced by an owner ABX
choice or measured per-speaker selection. Lifecycle advancement remains bounded
to the exact internal-owner guard unless the production ceremony changes.

## `late-preview-wake-success-updates-runtime-warmth` (2026-08-27)

**Decision.** A cold preview request that finishes after the HTTP response has
returned validates the provider result and marks only the runtime warmth hint
as ready. Its already-failed generation remains failed, and its discarded audio
never enters protection, sealing or the browser. Studio retries for 300 seconds,
long enough to cross the server's 200-second wake-in-flight window, dispatch a
second synthesis against the warm runtime and make a later protected request.

**Why.** The live GPU revision became healthy, but six 30-second client polls
ended at about 180 seconds while the server continued refusing duplicate work
as an in-flight wake for 200 seconds. A late successful provider promise was
previously swallowed without updating the warmth registry, so the UI could
never observe the warm runtime during one click. A first correction to seven
polls was also insufficient live: poll seven crossed the window and dispatched
the necessary second synthesis, then the client stopped on that same warming
response before the synthesis could settle.

**What would reverse it.** A durable cross-instance admission state or a true
asynchronous synthesis job may replace the in-process hint. It must preserve
one wake, never expose discarded audio and bind the eventual protected result
to a fresh authorized generation.

## `voice-bakeoff-factorizes-native-speech-and-owner-timbre` (2026-08-28)

**Decision.** Hindi, Hinglish and English voice candidates compete on one
pre-registered prompt and listening contract, but each language may promote a
different winner. In addition to end-to-end clone models, one Hindi research
arm composes India-native linguistic TTS with OpenVoice V2 tone-color
conversion. The final disclosure, PerTh watermark and receipt are applied after
conversion and bind both model stages.

**Why.** The incumbent has failed Hindi phonology, accent, naturalness and
identity together, so asking another cross-lingual prompt model to solve all
four does not isolate the failure. OpenVoice's maintainers explicitly scope its
converter to tone color rather than accent or intonation. That makes the
factorization testable: IndicF5 or Sarvam owns Hindi pronunciation and prosody;
OpenVoice owns timbre; human listening decides whether the composition helps or
adds conversion artifacts.

**What would reverse it.** Remove the composed arm if an end-to-end permissive
model beats it and every vendor on the pre-registered Hindi gates, or if the
converter regresses a critical human axis by more than 0.2, raw ASR error by
more than 5 percent relative, latency beyond the route SLO, or final provenance
binding. A stronger commercially auditable converter may replace OpenVoice
after the same comparison.

## `hindi-preview-uses-an-auditable-language-bound-text-plan` (2026-08-28)

**Decision.** A Hindi or Hinglish preview no longer sends raw Roman text and
the English disclosure through one `language_id=hi` generation. A versioned
text frontend preserves and hashes the original input, applies only a bounded
reviewed Roman-Hindi and classroom-borrowing table, records every changed
UTF-16 source slice, and binds each synthesis segment to Hindi or English.
Unknown Latin words remain byte-identical in an explicit English segment. The
fixed spoken disclosure is Hindi for a Hindi plan and English for an English
plan. A Hindi-only model refuses unresolved English before inference. The
provider executes segments sequentially, verifies every signed model response
and PerTh result, then joins unmodified exact 24 kHz mono segments with a
declared 60 ms zero gap before the final AudioSeal, disclosure and provenance
corridor.

**Why.** The Studio default was Romanized Hindi but the runtime saw only a
Hindi language tag, while the English disclosure was also pronounced under
that tag. Chatterbox accepts one language id per forward pass. Treating that
request shape as Hinglish therefore hid three distinct claims: script
conversion, token language identification and acoustic code-switching. A
bounded content-addressed plan makes each claim inspectable and refuses the
unknown case instead of silently choosing one wrong language.

**What would reverse it.** A versioned transliterator and token-level language
identifier may replace the reviewed table after a held-out owned
Hindi/Hinglish corpus measures false conversions, misses and English
confusables, and a blinded listen beats the bounded plan without join
artifacts. Raw-input hashing, explicit language bindings, localized fixed
disclosure, per-segment receipts and a named refusal for unsupported segments
remain required.

## `indicf5-qualification-is-access-gated-and-isolated` (2026-08-28)

**Decision.** IndicF5 is evaluated only in separately named, scale-to-zero Azure
resources after the exact gated weight revision is accessible. The image build
uses a BuildKit secret mount for a read-only Hugging Face token, the runtime is
offline, and no production route or existing Chatterbox application is changed.
GPU work is not queued merely to discover that model access is missing.

**Why.** The official model is MIT licensed and India-specific, but the pinned
weight revision requires accepted Hugging Face access. Anonymous access returns
401. A paid remote build before this preflight would waste budget, while a
normal Docker ARG or plaintext runtime secret would widen credential exposure.

**What would reverse it.** A public, revision-pinned IndicF5 snapshot with
equivalent official provenance could remove the access-token build step. A
different Hindi model may replace IndicF5 only after it beats the same blinded
Hindi gates and has equally clear commercial and checkpoint rights.

## `first-clone-failures-retain-partial-diagnostics` (2026-08-28)

**Decision.** The first-clone diagnostic initializes report state before the
reference probe, so a missing or invalid reference still produces the staged
failure summary and explicitly says fidelity was not measured.

**Why.** The error path called the summary before later lexical declarations
were initialized. That secondary ReferenceError hid the real probe failure and
discarded the most useful diagnostic precisely when the pipeline was broken.

**What would reverse it.** A typed result accumulator may replace the current
function-scoped initialization if an executable missing-reference control still
proves that the original stage error and unmeasured fidelity state survive.

## `direct-multilingual-cloners-precede-tone-color-conversion` (2026-08-28)

**Decision.** Qualify direct multilingual cloning models in the order VoxCPM2,
MOSS-TTS Local v1.5 and ZONOS2. DhVaani and IndicF5 are India-specialist
controls. OpenVoice remains an isolated diagnostic arm and cannot become the
primary Hindi route merely because its converter runs.

**Why.** The owner's rejected sample fails pronunciation, accent, prosody and
identity. A converter that applies target tone color after base synthesis
cannot reliably repair linguistic and performance choices already made by a
western-sounding base. The three ranked checkpoints directly support Hindi and
voice cloning under permissive weight licenses; the first also publishes an
official LoRA path and an approximately 8 GB inference result.

**What would reverse it.** Re-rank only on matched seeded outputs judged by
fluent Hindi/Hinglish listeners with latency, failure rate and cost included.
OpenVoice may return to the primary route only if a matched test shows that it
improves accent, articulation, rhythm and owner identity rather than timbre
alone. No quality result exists yet.

## `openvoice-conversion-is-owner-only-and-content-addressed` (2026-08-28)

**Decision.** The OpenVoice V2 tone-color arm is a separately named evaluation
service, never a silent production fallback. It accepts only an HMAC-signed
India-native base clip with a spoken AI disclosure and a 3 through 15 second
reference whose owner and subject UUIDs are equal. Its response receipt binds
the base provider, model, generation receipt, text and PCM; the consent receipt
and owner reference; the exact OpenVoice source, model files and tau; the
pre-protection conversion; and the final PerTh-verified PCM. Synthetic fixtures
are disabled in Azure.

**Why.** Factorizing Hindi pronunciation from owner timbre creates a second
model boundary where identity audio, generated speech or provenance could be
silently substituted. A plausible converted WAV would hide that break. Binding
both sides makes the composition auditable without claiming that a valid
receipt proves likeness. Owner equality also keeps the public lecture out of
the identity path.

**What would reverse it.** A different converter may replace OpenVoice after a
blinded owner ABX and objective intelligibility, speaker-similarity, watermark,
latency and license audit. The exact base, reference, converter and final-output
bindings, owner-only identity predicate, spoken disclosure and named evaluation
isolation remain required regardless of model.

## `voice-evaluation-runtimes-share-a-dedicated-keyvault-identity` (2026-08-28)

**Decision.** Isolated voice candidates share one evaluation-only
user-assigned identity and one dedicated Key Vault transport secret. Candidate
Container Apps receive only the identity resource id and versioned secret URI;
they do not receive plaintext HMAC values or access to the production
protection vault. The identity has only secret `get`, and every resource carries
an explicit evaluation expiry.

**Why.** The deployment service principal is Contributor but cannot grant Azure
RBAC roles. Reusing the production identity would widen its access across
unrelated protection secrets, while falling back to plaintext Container App
secrets would make a temporary permission limitation a permanent security
regression. A dedicated Key Vault access policy is deployable with the existing
authority and bounds the blast radius to one evaluation secret.

**What would reverse it.** Production promotion requires a separately
administered identity with narrowly scoped Key Vault RBAC and a rotated
production transport secret. The shared evaluation anchor may be deleted after
its expiry once no candidate app references it. No future deployment may
replace a secret reference with plaintext merely because RBAC is unavailable.

## `moss-v1-5-qualification-is-private-a10-only` (2026-08-28)

**Decision.** MOSS-TTS Local v1.5 remains a separately named evaluation lane
with no production caller. It may be built only by remote ACR after VoxCPM2's
first blind screen, and may run only on one private A10 Spot VM with a USD 25
ceiling, four-hour self-deallocation, daily shutdown and no public ingress.
Requests require HMAC, replay protection, a localized spoken disclosure, exact
model and codec commitments, content-addressed reference audio and either a
verified self-owner receipt or an explicitly non-releasable third-party stress
scope. The public MOSS repositories require no Hugging Face token.

**Why.** The exact model and audio-tokenizer repositories contain
17,615,117,536 bytes before the CUDA base, dependencies, activations and KV
cache. The existing T4 has 16 GiB, while upstream publishes no v1.5 peak-VRAM
result. Pretending the T4 fits would turn a paid remote build into a memory
probe. The A10 definition keeps that unknown bounded and cannot silently route
an evaluation result into production.

**What would reverse it.** A pinned quantized or offloaded route may move the
first screen to T4 only after measured peak memory, output equivalence and a
blind Hindi/Hinglish non-inferiority result. MOSS leaves the shortlist if 24
GiB cannot run it within the cap or fluent listeners reject its accent,
naturalness or owner identity. Signed inputs and responses, identity scope,
spoken disclosure, output watermark verification and isolated routing remain
required regardless of compute profile.

## `voxcpm2-owner-bound-isolated-and-listening-gated` (2026-08-28)

**Decision.** VoxCPM2 is qualified only as a separately named, scale-to-zero
Azure evaluation lane at exact source commit
`f5a1c6a6b901bc732e20f0d59a369f6829ad717a` and exact public weight revision
`32279effe8c19989596f05d353d1447f51d9e915`, both Apache-2.0. The GPU remains
private behind an HMAC-verifying CPU broker; both receive the transport key
through the shared versioned Key Vault reference and user-assigned identity.
Identity synthesis is restricted to a verified owner-self receipt. The public
lecture may be used only in an explicitly non-releasable language-stress scope
that cannot assert identity or training permission. No production route or
quality claim exists until the owner listens to blinded Hindi, Hinglish and
English outputs carrying localized spoken disclosure, verified PerTh and a
signed content-addressed receipt.

**Why.** VoxCPM2 is the highest-ranked permissive direct multilingual cloner in
the pinned frontier sweep and directly supports Hindi plus reference-only
cross-lingual cloning. That makes it a better first test of the owner's western
Hindi failure than another timbre converter, but published capability is not a
result on this owner. Isolation, exact identity scope and a listening gate keep
the test from becoming an unearned production claim.

**What would reverse it.** VoxCPM2 leaves the lead position if the pinned model
cannot load or synthesize inside the USD 75 lane cap, or if fluent blinded
listeners reject Hindi accent, naturalness or owner identity against the
matched alternatives. A later revision may replace the pins only after the
same license, provenance, safety and blind-listening gates pass. Signed
transport, owner binding, spoken disclosure, output watermark verification and
no third-party identity release remain invariant.

## `qwen3-tts-is-an-english-only-owner-listening-candidate` (2026-08-28)

**Decision.** Qwen3-TTS 12 Hz 1.7B Base is a separately named English-only
owner-listening candidate, pinned to official source commit
`022e286b98fbec7e1e916cb940cdf532cd9f488e` and public weight revision
`fd4b254389122332181a7c3db7f27e918eec64e3`. It is not a Hindi repair and has
no production caller. Its private T4 runtime sits behind a signed CPU broker;
both scale to zero, use the shared versioned evaluation Key Vault secret, and
accept only a verified self-owner reference and active inference receipt. Every
clip includes the spoken English AI disclosure, verified final PerTh and sealed
model, reference, consent, parameter and output provenance.

**Why.** The official model supports English but does not list Hindi. That
makes it useful as a matched English control for owner likeness, not evidence
about the product's rejected Hindi accent. A working remote synthesis path
proves neither resemblance nor humanness, so its arm identity remains sealed
and its listening status remains `not_started` until the owner judges it beside
the matched alternatives.

**What would reverse it.** Qwen may enter an English production shortlist only
after blinded owner listening and objective intelligibility, speaker-similarity,
latency, watermark and license gates beat or match the incumbent. Official
Hindi support plus a fresh Hindi and Hinglish blind win would be required before
the English-only boundary could change. Signed transport, self-owner consent,
spoken disclosure, final PerTh, exact pins and no silent routing remain
invariant.

## `indicf5-vocoder-stays-immutable-and-runtime-offline` (2026-08-28)

**Decision.** IndicF5 startup must resolve Vocos only from the exact baked
`charactr/vocos-mel-24khz` revision. The build stores the required config and
weights in a dedicated local directory, includes their hashes in the model
commitment, and replaces the gated model module's default Hub-backed loader
before model construction. Runtime internet remains disabled. The failed
evaluation revision was deactivated before rebuilding and no production route
was changed.

**Why.** The first immutable IndicF5 image contained the pinned Vocos snapshot,
but the upstream gated model invoked `load_vocoder(..., is_local=False)` with
no pinned revision. In offline mode that unresolved default branch crashed
startup after a paid GPU allocation. Enabling internet would weaken exact
revision provenance and turn a deterministic image into a mutable runtime
dependency.

**What would reverse it.** A pinned upstream IndicF5 revision may remove the
local loader only if it natively accepts an exact local Vocos path or exact
revision, a clean offline cold start and synthesis pass, and its returned
model commitment still covers the vocoder bytes. Runtime Hub access, an
unpinned default branch and silent fallback remain disallowed.

## `owner-meet-preview-separates-visible-registers-over-two-runtime-ids` (2026-08-28)

**Decision.** The owner-facing Meet composer exposes Hindi, Hinglish and
English as three separate, script-matched choices. Hindi and Hinglish remain
bound to the existing `hi` synthesis contract and English to `en`; the screen
does not invent a third runtime language id or a candidate endpoint. Hindi
opens in Devanagari, Hinglish in Roman Hindi, and the selected input carries a
matching language tag. The result keeps one correction loop: edit the same
line or switch language, then generate another protected take. Internal
self-test hides compliance ceremony, while the client still refuses audio
without the spoken-disclosure and text-plan receipt.

**Why.** The incumbent two-button label combined Hindi and Hinglish while the
text frontend treats script conversion and mixed-language segmentation as
different auditable operations. One combined label could not tell an owner
which writing system to use, and the rejected product failure is specifically
Hindi and Hinglish quality. Three visible registers make the input truth clear
without claiming any model is good, best or promoted.

**What would reverse it.** A third runtime language id may replace the shared
`hi` binding only after the backend actually exposes and tests that contract.
The three-way UI may collapse only if measured owner comprehension shows no
loss of script or language truth. Owner binding, audible disclosure, final
watermark verification, text-plan provenance and no unmeasured quality claim
remain invariant.

## `layout-gate-root-uses-file-url-conversion` (2026-08-28)

**Decision.** `scripts/check-layout.mjs` derives its repository root with
Node's `fileURLToPath(new URL("..", import.meta.url))`. A file URL pathname is
never passed directly to `path.resolve`. The gate runs an executable Windows
fixture on every host: the supported conversion must produce `C:\repo\`, while
the former pathname-plus-resolve shape must not.

**Why.** On Windows, `URL.pathname` preserves the URL spelling `/C:/...`.
`path.resolve` interprets that as a filesystem path and produced
`C:\C:\Users\...`, so the gate looked for a non-existent nested drive path and
reported `dist/ absent` immediately after a successful build. `fileURLToPath`
is the platform-aware conversion already used by the release runner.

**What would reverse it.** If the script stops loading from a local `file:` URL,
root discovery must move to a new measured source appropriate to that runtime.
A future Node API may replace `fileURLToPath` only after the Windows fixture and
the real Windows dist lookup both pass. Raw URL pathname resolution remains
rejected.

## `indicf5-upstream-hub-lookups-are-local-asset-bindings` (2026-08-28)

**Decision.** Every Hub-style lookup executed by the gated IndicF5 model at
runtime must be intercepted before its dynamic module loads and resolved to an
exact file already committed inside the immutable image. Vocos is bound to the
pinned local Vocos directory; `checkpoints/vocab.txt` is bound to the pinned
IndicF5 snapshot; any other runtime Hub request fails closed. Runtime internet
and token injection remain disabled.

**Why.** Fixing the first Vocos lookup exposed a second upstream assumption:
the model passes `config.name_or_path` to `hf_hub_download`, but local
Transformers loading sets that value to `/models/indicf5`, which is a path and
not a valid Hub repository id. Solving one URL at a time with internet access
would be mutable and would hide the next missing dependency. A bounded asset
registry makes the allowed runtime dependency set explicit.

**What would reverse it.** The interception may be removed only when a pinned
upstream model accepts exact local paths for every dependency and passes a
clean offline cold start plus synthesis with the same committed bytes. Adding
a new local asset requires its exact revision, build-time presence check,
manifest coverage and executable refusal of all unlisted lookups.

## `zonos2-qualification-is-private-a10-and-raw-hindi-only` (2026-08-28)

**Decision.** ZONOS2 may run only as a separately named, private A10 Spot
evaluation at model revision
`65f1e80f94b599d474bb6af9094a803dc52f60bd`, official source commit
`194c0a3ab67b90383a67646289f28d4ecb1c1f64`, speaker encoder revision
`7577f61c42737fc8064bba773e2a18602df92803` and the hash-bound Descript DAC.
The VM has no public IP or inbound route, binds the runtime to loopback, uses a
four-hour platform deallocation backstop and cannot route to production. Hindi
and Hinglish use raw UTF-8 because the pinned release lists Hindi only as Tier
3 and exposes no Hindi text normalizer; only English uses `en_us`. Identity
requests require verified owner-self scope, localized spoken disclosure,
signed transport and final PerTh verification.

**Why.** The 15.351 GB official repository plus runtime state cannot honestly
claim a fit on the existing 16 GiB T4. A 24 GiB A10 is a bounded qualification
allocation, not a fit result. The upstream Python API calls itself offline but
still names a mutable Hub speaker encoder and a DAC release downloader. Baking
and committing both dependencies is required before any paid load. Raw Hindi
bytes preserve the model's documented path without pretending its English-only
normalization list includes Hindi.

**What would reverse it.** A T4 or smaller profile replaces the A10 only after
measured peak allocation, stable synthesis and blind non-inferiority. Hindi
normalization may be enabled only when a pinned upstream route supports it and
matched native listeners show no regression. ZONOS2 leaves the shortlist if 24
GiB cannot load within the USD 75 cap or fluent blind listening rejects Hindi
accent, naturalness or owner identity. Isolation, owner binding, disclosure,
final watermark proof and immutable dependency commitments remain invariant.

## `cross-provider-listening-compares-only-exact-text-cells` (2026-08-28)

**Decision.** The consolidated owner-listening pack may compare candidates only
inside a cell with the same target language and exact target-text SHA-256.
Everything else remains an unmatched lane. Every clip is still rated for owner
likeness, naturalness, Indian accent fit, pronunciation and disclosure
audibility, but unmatched ratings cannot produce a cross-provider winner. The
model mapping stays outside the served tree and `unseal` requires an explicit
locked-ratings confirmation plus at least one complete listener who passes both
attention checks.

**Why.** The available 15 protected clips contain one exact matched-text cell:
four Chatterbox Hindi variants. Qwen's six English prompts and VoxCPM2's Hindi,
Hinglish and English prompts do not share an exact target text with another
provider. Pooling them by language would make prompt difficulty, length and
register part of the apparent model result. A polished listener cannot repair
an unmatched experimental design after the ratings exist.

**What would reverse it.** A future candidate may enter a cross-provider cell
after it synthesizes the frozen text, language, owner-reference bytes and
protection treatment used by the other candidates. A pre-registered analysis
may add a different matched design, but semantic similarity or a shared topic
alone never makes two clips comparable. Opaque ids, sealed provenance, separate
accent and likeness axes, listener attention checks and no quality claim before
human ratings remain invariant.

## `indicf5-duration-is-codepoint-normalized-before-hindi-inference` (2026-08-28)

**Decision.** IndicF5 requests normalize the pinned upstream UTF-8-byte
duration heuristic by the relative bytes-per-codepoint density of generated
and reference text. The bounded speed is part of the signed response receipt,
predicted generation above 30 seconds fails before GPU inference, and model
configuration is restored after each serialized request. Qualification first
runs one short unscored canary; same-process retries of a generation id reuse a
content-bound result instead of invoking the GPU twice.

**Why.** With a 12-second English reference transcript, the six frozen
Hindi/Hinglish requests ask the upstream code for 23.1 through 31.7 seconds of
generated audio because Devanagari codepoints occupy three UTF-8 bytes. Two
requests reach the 4096-frame cap. Codepoint-aligned planning reduces that
mechanical inflation without changing text or model weights and separates cold
start from the scored pack.

**What would reverse it.** Replace this normalization only when a pinned
upstream model uses tokenizer or Unicode units natively and matched synthesis
proves equivalent pacing, pronunciation and identity without the receipt.
Listener preference remains authoritative; faster execution alone cannot
promote this arm. Cross-process exactly-once requires a durable generation
ledger before this evaluation lane can become a production caller.

## `admission-broker-resigns-fresh-internal-transport-after-wake` (2026-08-28)

**Decision.** The public voice admission broker authenticates and replay-checks
the client request, probes private runtime readiness, then signs the identical
body again with a fresh internal timestamp and nonce. It verifies the private
runtime response against that internal nonce and re-signs the unchanged body
for the caller's original nonce. An unready GPU returns a signed warming state
instead of holding an expiring request through scale-up.

**Why.** A cold IndicF5 canary was valid when admitted, but the private runtime
started after the 60-second skew window and correctly rejected the forwarded
original timestamp with `transport_binding_invalid`. The broker is a trust
boundary, so it must attest the already-admitted body at forwarding time rather
than pretend no time elapsed during GPU scale-up.

**What would reverse it.** A transport version with explicit broker delegation
may replace double signing only after both caller-to-broker and
broker-to-runtime replay, body, timestamp and response bindings remain
executable. Increasing the runtime skew window or forwarding stale client
credentials remains rejected.

## `owner-voice-head-to-head-freezes-two-exact-text-cells` (2026-08-28)

**Decision.** The next owner-voice head-to-head has exactly two comparison
cells: one frozen Indian English sentence and one frozen Devanagari Hindi
sentence. Every capable arm in a cell receives byte-identical text and
localized disclosure, the same 0 through 12 second owner window and transcript
hypothesis, the same active consent receipt and seed 31001. The base grid is
Chatterbox English and Hindi, Qwen English, and VoxCPM2 English and Hindi;
IndicF5 adds Hindi and ZONOS2 adds both without changing either cell. Accepted
outputs are HMAC, model, reference, transcript, consent, text, seed, PCM and
PerTh bound before one common 24 kHz listening treatment. Each cloud attempt
reserves USD 0.50 and the orchestration ledger refuses to cross USD 5.

**Why.** The consolidated 15-clip pack measured zero exact-text cells crossing
providers, so its language-level ratings cannot rank models. A capability-
shaped grid keeps Qwen's documented English-only lane and IndicF5's Hindi-only
lane honest while producing two real head-to-head cells. Freezing the owner
window, disclosure and post-treatment removes the remaining avoidable cues and
confounds. A request ledger is necessary because Azure budget alerts do not
stop already-running compute.

**What would reverse it.** A human-reviewed exact transcript for the identical
owner window may replace the current explicitly unreviewed ASR hypothesis only
in a new pack version regenerated across every arm. A candidate that cannot
accept the frozen reference or text is excluded from that cell rather than
given a private substitute. The USD 0.50 reservation may change after measured
allocation and billing data, but the USD 5 ceiling, exact-text comparison,
owner consent, spoken disclosure, final PerTh verification and no quality claim
before blinded listening remain invariant.

## `indicf5-perth-pads-only-the-incomplete-terminal-frame` (2026-08-28)

**Decision.** Before post-hoc PerTh protection, an arbitrary-length IndicF5
waveform is zero-padded only to the next 240-sample boundary. PerTh must return
one finite sample for every padded sample; the protected result is then cropped
back to the exact original sample count and independently detected before it
can leave the private runtime.

**Why.** `resemble-perth==1.0.1` reconstructs 24 kHz audio on 240-sample,
10-millisecond frames. IndicF5 returns arbitrary sample counts, so strict
pre/post length equality rejected an otherwise valid synthesized canary when
PerTh discarded only its incomplete tail frame. Synthetic remote diagnostics
measured zero loss for aligned input and 1 through 239 samples for unaligned
input. Frame-padding preserves the entire model waveform and keeps the
watermark fail-closed.

**What would reverse it.** Remove the adapter when a pinned PerTh release
proves exact-length reconstruction for arbitrary input and the executable
negative control fails against the old behavior. A model-native watermark may
replace post-hoc PerTh only after the same transformation-survival and signed
receipt gates pass; bypassing or lowering detection cannot reverse this.

## `roman-hindi-transforms-exclude-high-frequency-english-confusables` (2026-08-28)

**Decision.** The bounded Roman-Hindi pronunciation table excludes a token
when the same spelling is a high-frequency English word. Such tokens remain
byte-identical and become an explicit English synthesis segment; the frontend
never guesses from the surrounding sentence.

**Why.** The initial reviewed table mapped Latin `the` to Hindi `थे`. In the
Hinglish path this silently changed the most common English article, including
ordinary input such as `the formula hai`. An English segment is an honest,
auditable fallback; a confident but wrong Hindi rewrite is not.

**What would reverse it.** A context-aware classifier may disambiguate the
token only after reviewed Hindi and English fixtures, false-transformation
limits and owner listening pass. Adding the ambiguous spelling back to the
unconditional table remains rejected.

## `indicf5-objective-intelligibility-is-a-private-asr-diagnostic` (2026-08-28)

**Decision.** The sealed IndicF5 qualification pack gets one private,
single-pass short-audio ASR diagnostic before listening. The run binds each
opaque WAV to its frozen text through the private key, includes the mandatory
spoken disclosure in the target, preserves raw Unicode WER/CER, and reports the
existing bounded cross-script score separately. Only the private report may
carry prompt bindings or transcripts; `blind/` remains unchanged. A USD 2 hard
stop and zero retries bound the run.

**Why.** Automated transcription can localize a large pronunciation or
code-switch failure without exposing the listening arm, but it is still a
provider-shaped proxy. Keeping the raw and curated arms together prevents a
small reviewed alias table from erasing unknown pronunciation errors. Keeping
the report private preserves the sealed listener, and one pass avoids spending
past the stated cap to manufacture false ASR consensus.

**What would reverse it.** A human-corrected transcript with word boundaries,
or a second independently benchmarked Hindi/Hinglish ASR lane inside a newly
pre-registered budget, may supersede this one-provider diagnostic. Neither may
replace blinded listening for naturalness, accent or likeness, and neither may
put the sealed arm mapping into a served artifact.

## `matched-pack-cloud-run-requires-prebound-deployment-evidence` (2026-08-28)

**Decision.** The exact-text cloud run cannot start an arm until its public
isolated origin, exact runtime and gate revisions, immutable image digest,
expected runtime model commitment and transport-key source are all known before
the request. Every accepted response must echo the exact request id and, for
Qwen, VoxCPM2, IndicF5 and ZONOS2, the exact model revision. The Chatterbox
receipt uses its deterministic source-plus-checkpoint commitment because that
older runtime does not expose a separate revision field. Missing evidence stops
the arm; it is never filled from the response being evaluated.

**Why.** A valid HMAC proves which key signed a response, not that the caller
reached the intended immutable deployment. Azure control-plane readback gives
revision and image identity, while the runtime model manifest gives the weight
closure. Keeping both prevents a mutable tag, wrong gate, wrong request or
correctly signed but different checkpoint from entering the blinded pack. Under
the no-unseal rule, Qwen and IndicF5 model commitments are still unavailable,
so their real matched requests remain blocked rather than weakening the check.

**What would reverse it.** A signed non-listener deployment attestation may
replace the separate readbacks if it binds the same origin, revisions, images,
model manifests and Key Vault version and is available without opening a sealed
listening key. Chatterbox may adopt the ordinary model-revision echo after its
isolated runtime contract exposes one. No response may bootstrap its own
expected commitment.

## `immutable-acr-layer-manifests-prebind-runtime-model-commitments` (2026-08-28)

**Decision.** A matched-pack expected model commitment may be recovered from
the exact deployed ACR image without starting the runtime: authenticate for
repository pull only, stream the content-addressed layer that created or last
repaired `.vyakti-model-manifest.json`, remove its claimed `commitment`, and
recompute SHA-256 over the same recursively key-sorted compact JSON bytes. The
value enters the frozen plan only when claimed and derived hashes match and the
outer image and layer digests are exact.

**Why.** Qwen and IndicF5 already carry the complete model-file manifest needed
for prebinding, but Azure Container App metadata exposes only the outer image
digest. Direct immutable-layer extraction obtains the exact build artifact
without opening a listening key, loading model weights, starting GPU compute or
trusting the future synthesis response to declare its own expected value. It
therefore closes the last four-arm execution blocker without weakening the two
provenance layers.

**What would reverse it.** Qualification should emit a small signed,
non-listener deployment attestation containing the same image, layer, revision
and model-manifest commitment so a multi-gigabyte layer never needs inspection.
If registry garbage collection removes the bound layer or a future image
encrypts it, a signed readiness attestation may replace extraction only when it
is obtained before synthesis and tied to the immutable deployment. Model
response self-report alone remains insufficient.

## `indicf5-chemistry-normalization-stays-audited-and-out-of-runtime-until-resynthesis` (2026-08-28)

**Decision.** IndicF5 chemistry and numeral pronunciation normalization is a
bounded, deterministic pre-synthesis plan. It preserves the exact source text
and hash, separately commits the synthesis text, and emits an ordered,
content-addressed audit for every changed source span. It remains isolated from
the runtime and every production route until a sealed before/after resynthesis
passes the same objective diagnostic and human listening.

**Why.** The private objective report localized six of eight chemical-symbol
and four of eleven numeral disagreements. The mixed-script breakdown contains
four symbol and three numeral disagreements, and the frozen public equation
text has exactly four Latin formula-symbol units and three English subscript
number words that can be changed without rewriting the lesson. A parser and
reviewed pronunciation tables make that intervention inspectable. A broad
Hinglish rewrite or LLM paraphrase would change unknown words and make the
cause of any gain or regression unknowable.

**What would reverse it.** Runtime integration becomes eligible only after a
new sealed arm proves provenance and watermark integrity, reduces the
pre-registered unit disagreements, and does not reduce human-rated
pronunciation, naturalness, Indian accent or owner likeness. A rule must be
narrowed or removed when its paired confusable control fails or resynthesis
creates a new disagreement. A learned frontend may replace the tables only
after an exact-source audit, false-transformation ceiling and the same sealed
listening gates exist.

## `indicf5-pronunciation-source-and-synthesis-are-separately-receipted` (2026-08-28)

**Decision.** The bounded chemistry normalizer is integrated into only the
isolated IndicF5 evaluation runtime behind the exact
`vyakti-indicf5-pronunciation-normalizer/v1` request contract. Every caller
must commit the untouched source text by SHA-256 and request the fixed
`chemistry`, `hi-IN`, required mode. The runtime preserves that source, sends
only the separately hashed normalized synthesis text to duration planning and
the model, and returns ordered source-codepoint transformations plus a
canonical audit hash that the qualification and matched-pack callers
reconstruct independently. The historical deployed r7 arm remains explicitly
`unnormalized_baseline`; no production route changed.

**Why.** A sealed before/after resynthesis cannot be produced while the
candidate text frontend remains disconnected, but silently changing a matched
cell would destroy exact-text provenance and make any apparent gain
unattributable. Separately addressing source and synthesis text makes the
intervention executable without pretending they are byte-identical. An
explicit variant prevents the old deployed image from being mislabeled as the
new candidate, and fail-closed receipts keep changed text out of an exact-text
cell unless the caller requested and verified it.

**What would reverse it.** Narrow or remove the integrated rule when sealed
matched resynthesis creates a new unit disagreement, fails provenance or
watermark checks, or lowers human-rated pronunciation, naturalness, Indian
accent or owner likeness. A new domain, locale, learned frontend or broader
rewrite requires a new versioned request contract, frozen positive and
confusable controls, an exact-source audit and the same sealed evaluation. No
result may bypass the request field or receipt, and deployment remains blocked
until that resynthesis and listening evidence exists.

## `text-plan-disclosure-receipt-is-a-chatterbox-release-gate` (2026-08-28)

**Decision.** A Chatterbox result cannot enter an exact-text listening pack
unless the signed runtime result echoes the accepted
`vyakti-hindi-text-frontend/v1` contract, exact text-plan commitment, segment
binding, localized disclosure text and disclosure language. An older runtime
that can synthesize and watermark audio but omits those fields is release
incompatible. The verifier remains strict; the runtime image must be rebuilt
from the checked source and pass the full release gate before deployment or a
matched-pack retry.

**Why.** The first bounded cloud execution reached the older deployed
Chatterbox runtime after one cold timeout. Its signed result carried the legacy
request, model, reference, audio, conditioning and PerTh shape, but no
text-plan or disclosure fields. The exact-text verifier rejected it as
`matched_pack_result_disclosure_drift` before saving audio. Read-only extraction
of the deployed image confirmed that its `app.py` predates the checked source
that validates and returns the localized disclosure receipt. Weakening the
verifier would turn a measured release mismatch into unauditable evidence.

**What would reverse it.** A versioned, signed post-synthesis attestation may
replace the direct runtime echo only if it independently binds the same full
text, text-plan hash, segment, localized spoken disclosure and protected audio
bytes before delivery, and executable negative controls reject an omitted or
changed disclosure. A response HMAC, PerTh score or broker-side request echo
alone cannot reverse this decision.

## `indicf5-pronunciation-image-stops-at-a-qualified-digest` (2026-08-28)

**Decision.** The integrated IndicF5 pronunciation candidate is built only as
an immutable ACR digest and stops there while the deployed r7 unnormalized
baseline pack is in progress. The build uses the runtime-only patch over the
same repaired offline parent as r7, and qualification requires exact source
layer readback, inherited model-manifest continuity and the focused gates. No
Container App template, revision or activation changes in this phase.

**Why.** Replacing the deployed image before the frozen baseline finishes
would change the comparison arm mid-run. A successful tag alone also does not
prove which source bytes or inherited model closure it contains. Stopping at a
content-addressed digest preserves the baseline while making the normalized
candidate ready for a later, explicit matched deployment.

**What would reverse it.** Deployment becomes eligible only after the
unnormalized matched pack is sealed, the owner or coordinating lane explicitly
starts the normalized arm, the digest still exists, and the same deployment
and receipt predicates remain intact. Any source-layer mismatch, model
commitment drift or focused-gate failure invalidates this digest rather than
weakening the checks.

## `openvoice-release-candidates-bind-source-before-registry-build` (2026-08-28)

**Decision.** Every OpenVoice runtime release candidate freezes the raw bytes
of its Dockerfile and every copied build input before an ACR run. The canonical
manifest hash enters a unique candidate tag, while the successful build output
is addressed only by its registry digest. Registry-layer readback must reproduce
every copied source hash before the candidate is reported. Building does not
authorize deployment: Container Apps may move to the digest only after the
complete release gate and the source commit are independently accepted.

**Why.** The disclosure-receipt repair exists in the working runtime source but
not in the older deployed image. A mutable tag or successful build status alone
would not prove that Azure baked those exact bytes. Prebinding the six build
inputs, then verifying all five copied files inside the immutable image,
separates source identity, build success and deployment into auditable gates.

**What would reverse it.** A signed build provenance attestation may replace the
local canonical manifest and layer extraction only if it binds the same raw
source hashes, Dockerfile, build arguments, base digest, output digest and ACR
run identity. It cannot merge build authorization with deployment authorization,
and a tag alone remains insufficient.

## `voice-text-plan-rollout-is-runtime-then-broker-then-vercel` (2026-08-28)

**Decision.** A release that makes the web plane require the signed
`vyakti-hindi-text-frontend/v1` receipt deploys the private OpenVoice runtime
first, its admission broker second, and Vercel last. The runtime digest must be
read back as private, scale-to-zero and on the `general` arm; the broker digest
must be read back with the same versioned HMAC reference and exact private
runtime origin. Only then may the strict web verifier ship. Every owner preview
caller must also pass the same text-frontend audit into
`beginOwnedVoicePreview` before storage or GPU work. Rollback is the reverse:
Vercel first, broker second, runtime last.

**Why.** The new runtime accepts a legacy app request, but the new web provider
intentionally rejects a legacy runtime response that omits the text-plan and
localized-disclosure receipt. Therefore the old web can safely observe the new
Azure pair during rollout, while the new web cannot safely observe the old
runtime. The broker is a separate compatibility boundary because it replaces a
stale external HMAC with a fresh internal nonce only after the private runtime
is ready. Separately, the advanced preview route constructed the correct audit
but initially omitted it from the atomic authorization call, so the shared
validator refused every request before the database or GPU. "Azure first" is
only complete when both immutable runtime and broker revisions have passed
readback and the old web canary.

**What would reverse it.** A version-negotiated response shim may permit a
different rollout order only after an end-to-end negative control proves the
new web can authenticate and bind an older runtime result without weakening
text, segment, disclosure, model, watermark or provenance evidence. The caller
field may disappear only if `beginOwnedVoicePreview` derives and verifies the
same audit from a separately bound source text. Until then, a successful image
build, tag, health response or one-plane deploy cannot reverse this order.

## `openvoice-tokenizer-assets-are-a-content-addressed-build-closure` (2026-08-28)

**Decision.** Every OpenVoice runtime image bakes the exact tokenizer assets
that its pinned Chatterbox source constructs at startup. The official
`spacy-pkuseg` OntoNotes archive, both extracted model files and the pinned
Cangjie mapping are byte-size and SHA-256 bound in one canonical in-image
manifest. Runtime startup verifies that closure before model loading, points
`PKUSEG_HOME` at the baked directory, and resolves the Chatterbox mapping only
from the pinned local file. A missing or changed asset is a named startup
failure; network fallback is not an availability mechanism.

**Why.** Hugging Face and Transformers offline flags cover their own clients,
not `spacy-pkuseg`'s independent requests/urllib downloader. The first real
cold start of runtime revision `vyakti-open-voice--r2405fbe` therefore fetched
34,567,143 bytes from GitHub into ephemeral `/tmp/.pkuseg`, despite the model
snapshot being local and both offline flags being set. That adds unpinned
network availability, latency and mutability to every fresh replica. A build
probe now replaces the exact upstream downloader with a hard refusal, proves
the missing-cache control trips, and then initializes the baked cache with
zero download attempts.

**What would reverse it.** An upstream package may replace the local closure
only if its immutable distribution embeds the same licensed assets, publishes
full commitments, and an executable no-egress cold-start test proves the
complete tokenizer initializes without writing or downloading a cache. A CDN
SLA, retry loop, warm replica or Hugging Face offline flag alone cannot reverse
the decision.

## `preview-style-receipt-limit-is-2048-bytes` (2026-08-28)

**Decision.** The `vy_replica_generation.preview_style` object keeps its
object-shape check and a hard UTF-8 `jsonb::text` ceiling, raised atomically
from 512 to 2,048 bytes in migration 065. The replacement is one idempotent
`ALTER TABLE` statement that drops and adds the same named constraint, and the
canonical schema mirrors it. The text-plan receipt remains stored with the
generation authorization; it is not discarded or truncated to fit the old
limit.

**Why.** The multilingual authorization now binds three SHA-256 commitments,
the synthesis-language plan, warnings and language-conditioning evidence in
addition to the server-owned acoustic preset. The live 512-byte constraint
predates that receipt and rejects a valid 751-byte authorization with SQLSTATE
23514. A production-shaped maximal-mix local fixture is 862 bytes in
PostgreSQL-style JSONB text, so 2,048 admits the current bounded contract with
more than 2x headroom while still making unbounded metadata impossible.

**What would reverse it.** If a reviewed versioned receipt contract approaches
2,048 bytes, move the expanding audit to a dedicated typed receipt column or
table and retain a small content commitment in `preview_style`; do not silently
raise the ceiling again. Evidence that PostgreSQL serializes the accepted
contract above the locally reproduced bound also reopens the exact value, but
never the requirement for an explicit finite limit and an oversized negative
control.

## `sealed-owner-preview-is-the-live-voice-release-canary` (2026-08-28)

**Decision.** A voice release is not complete at a green health endpoint or a
successful schema migration. The release canary is one authenticated owner
journey through the production Studio that opens a tenant-bound generation,
survives a real scale-to-zero start, returns a browser-playable protected WAV,
and leaves the durable row `sealed` with audio, watermark and manifest hashes.
Cold-start rows remain named failed attempts; they are not rewritten as audio
successes.

**Why.** Migration 065 applied and read back correctly, but the first owner
request still encountered the expected cold GPU image pull. Azure health then
became ready while the Studio's bounded automatic checks moved through
`wake_dispatched` and `wake_in_flight`. Only generation `cf3be95e...` proved
the complete path: it sealed 33 segments with an empty failure code and all
three protection commitments, while the browser held one controlled `blob:`
audio element. Each earlier signal proved a narrower layer.

**What would reverse it.** A fully automated canary may replace the browser
step only if it uses the same production owner authorization, selected private
artifact, runtime and broker path, AudioSeal/C2PA protection and durable Neon
ledger, and verifies the returned WAV rather than a fixture. Unit tests, a
health endpoint, an unsigned model call or a mocked database cannot reverse
this requirement.

## `indicf5-pronunciation-normalization-remains-evaluation-only-after-sealed-objective-gain` (2026-08-28)

**Decision.** Keep the bounded IndicF5 chemistry pronunciation normalizer as an
isolated evaluation candidate. Do not make it the production text path, and do
not leave its runtime revision active after qualification. The sealed
before/after result is sufficient to retain the candidate for human review,
not to promote it.

**Why.** The matched intervention changed exactly one of six owner-bound
qualification clips; the other five WAVs remained byte-identical. On the one
changed mixed equation, private Azure Speech diagnostics reduced chemical
symbol sequence errors from 4/4 to 2/4 and numeral errors from 3/5 to 0/5.
Aggregate raw WER moved from 0.327586 to 0.321839 and ECAPA mean from 0.824822
to 0.827428, while ECAPA p10 and worst stayed 0.815361. Those are useful narrow
signals, but half of the mixed equation's symbol units still failed and no
person listened. Objective proxies cannot license a claim about pronunciation,
naturalness, Indian accent or owner likeness.

**What would reverse it.** Promote or widen the normalizer only after accepted
blinded listeners rate the sealed normalized arm non-inferior on naturalness,
Indian accent and owner likeness and better on the covered pronunciation case,
with the false-transformation controls still passing. A broader rule requires
new exact-source fixtures, a bounded false-positive ceiling, receipt continuity
and the same sealed before/after evaluation. A larger ASR gain alone cannot
replace human evidence.

## `matched-pack-chatter-receipts-bind-the-complete-text-plan` (2026-08-28)

**Decision.** An exact-text Chatterbox result is accepted only when its signed
runtime receipt echoes the exact text-frontend contract, text-plan SHA-256,
segment index, segment count, ordered semantic indexes, localized disclosure
text and disclosure language from the request. The response HMAC and spoken
disclosure fields are necessary but not sufficient.

**Why.** The runtime now returns the complete plan receipt, but the matched-pack
verifier checked only disclosure text and language. A correctly signed result
with a changed plan hash or segment binding could therefore enter the sealed
pack even though the release law says those fields are part of the evidence.
The cloud run added the strict check before its first accepted result and all
six final clips passed it.

**What would reverse it.** A versioned signed post-synthesis attestation may
replace direct field equality only if it commits the same frontend, plan,
segment and disclosure values and has executable mutation controls. A response
HMAC, audio hash, watermark score or request-side plan alone cannot reverse the
requirement.

## `pre-variant-indicf5-matched-items-mean-unnormalized-r7` (2026-08-28)

**Decision.** A frozen IndicF5 matched-pack item created before the
`evaluationVariant` field exists is interpreted only as the unnormalized r7
baseline. Newly planned items remain explicit. Pronunciation-normalized
synthesis always requires its versioned request and reconstructable receipt;
missing metadata can never select it.

**Why.** The r2 plan was frozen before the variant field was added, while the
only qualified deployed IndicF5 candidate was r7. Mutating that plan after
cloud execution began would destroy the exact pre-registered artifact, while
calling the newer normalized image would silently change the intervention.
The bounded compatibility rule preserves the original plan and labels the
accepted r7 receipt as baseline.

**What would reverse it.** A new pack planned before any synthesis call may
require explicit variants for every item and reject the legacy omission. The
already sealed r2 pack cannot be reinterpreted; a normalized comparison needs
a new pre-registered plan, separate sealed arm and the same human gates.

## `training-consent-binds-the-speaker-not-the-uploader` (2026-08-28)

**Decision.** Do not build or run a VoxCPM2 speaker adapter from the processed
109-minute Alakh Pandey lecture. A source upload, an account-owner training
grant and a dominant diarization cluster do not establish that the person in
the recording is the account owner or that the speaker authorized biometric
model training. The lecture remains third-party language-stress material only,
with training and identity claims denied.

**Why.** The live source bytes match the specifically named Alakh Pandey local
file, while every active consent scope and every accepted processing decision
on its replica was created by `REPLICA_SELF_TEST_MODE` for the uploader. Those
receipts have no speaker evidence source. The isolated VoxCPM2 contract already
names this exact case: `third_party_language_stress` requires
`training_allowed=false` and `identity_claim_allowed=false`. The dominant
cluster covers 98.3198% of diarized speech, but every segment has the neutral
`target_likelihood=0.5`; cluster dominance is not an identity binding.

**What would reverse it.** For an owner-speaker adapter, replace the lecture
with 5-10 minutes of clean, transcript-aligned audio actually spoken by the
owner, backed by a current training receipt bound to verified speaker evidence
and a server-verified source hash. A separately verifiable authorization from
the lecturer could permit a purpose-limited third-party experiment, but it
would still not turn that speaker into the account owner's identity.

## `sealed-objective-scoring-keeps-the-model-map-opaque` (2026-08-28)

**Decision.** Score a sealed exact-text pack before listening only through its
public opaque stimulus IDs and the content-bound owner reference. Exact-audio
repeat trials inherit their canonical clip's objective result and are excluded
from aggregates, so the listening instrument's repeat controls cannot
double-weight a model. The private model map stays sealed; an objective result
may be grouped by public language but never attributed to an arm before
ratings lock.

**Why.** The r2 pack contains six unique clips but eight rating IDs because two
are deliberate exact-audio repeats. Reading the model map would contaminate the
blind listener, while counting all eight IDs would overweight whichever two
clips were repeated. SHA-256 deduplication exposed the repeat geometry without
revealing model identity. Four exact owner-reference windows, six signed ECAPA
calls and six language-matched ASR calls could then report regression and
intelligibility signals per opaque ID without opening or playing audio.

**What would reverse it.** After accepted human ratings are irrevocably locked,
the existing unseal contract may reveal arm identity for analysis. A future
confidential-compute scorer may replace local opaque processing only if it
proves the same manifest, stimulus, reference, disclosure and repeat bindings.
Neither change allows ECAPA or one-provider ASR to replace blinded human
likeness, accent, pronunciation and naturalness ratings.

## `studio-blind-results-use-portable-sealed-bundles-before-new-api` (2026-08-28)

**Decision.** Put the exact-text owner listening workflow inside the
authenticated Meet surface through a one-file public sealed bundle, browser
local persistence and answer/result import-export. Do not create a new
production ratings API until one can bind a bearer-authenticated owner and
replica to bounded durable storage. The Studio never receives the private
answer key or model map. It reveals model identities only after the existing
private CLI admits an attentive complete sheet and produces a report bound to
the original sealed-key hash. It never promotes a model automatically.

**Why.** The completed pack already has the hard parts: opaque clip ids, equal
served geometry, hidden repeats, attention checks, a private mapping, accepted
listener scoring and an explicit unseal latch. Duplicating those decisions in
a new endpoint would add a second security boundary with no production need.
IndexedDB holds the 8.45 MB public pack, localStorage checkpoints the small
answer sheet after every change, and explicit exports make the workflow
portable without placing a private key, provider label or consent receipt in
the browser.

**What would reverse it.** Replace the portable lane when a deployed API has
bearer owner authentication, exact replica and run binding, strict byte and
trial bounds, encrypted durable storage, append-only answer locking, private
attention scoring, and a response that proves the sealed-key commitment while
withholding every model label before acceptance. Convenience alone is not a
reversal condition.

## `large-voice-experiments-prefer-consumption-a100-before-compute-quota` (2026-08-28)

**Decision.** If the owner separately authorizes a large-memory voice-model
capacity experiment, try one isolated Azure Container Apps Consumption A100
profile in West US 3 first, with private ingress, `minReplicas=0`,
`maxReplicas=1`, no production route and a four-hour wall-clock stop. Do not
request Compute quota yet. Canada Central Consumption A100 is the geographic
fallback. A Compute A100 Spot VM in East US 2 is the backup only after a
separately authorized quota request and an automatic deallocate-and-delete
runbook.

**Why.** Subscription-scoped supported-profile reads expose
`Consumption-GPU-NC24-A100` in West US 3 and Canada Central, while exact ARM
deployment validation found every tested A100 and H100 VM route blocked by
zero family quota or the subscription-wide three-core Spot quota. The official
Azure Retail Prices API puts a fully active 24-vCPU, 220-GiB Consumption A100
profile at an estimated USD 6.354 per hour in West US 3 and USD 8.3916 per hour
in Canada Central, so four hours remain below the USD 100 experiment cap. This
read-only pass did not schedule a replica, create a resource or submit a quota
request; actual serverless GPU capacity remains unproved until a separately
authorized one-replica scheduling attempt.

**What would reverse it.** Prefer a Compute VM if Azure grants the exact
24-core A100 family or Spot quota and a bounded VM probe demonstrates lower
end-to-end cost or materially better startup reliability. Reject the
Consumption route if a one-replica scheduling probe fails, the sealed ZONOS2
image cannot start within the experiment wall clock, or measured image plus
model memory exceeds the profile. H100 becomes justified only after an A100
probe produces measured OOM or an unsupported-kernel failure; SKU prestige is
not a reversal condition.

## `native-base-openvoice-conversion-stays-unqualified-after-receipt-drift` (2026-08-28)

**Decision.** Keep the India-native base voice to OpenVoice V2 tone-color
conversion path isolated and unqualified. Do not route production traffic to
it, do not expose the discarded conversion, and do not use the two protected
IndicF5 base clips as evidence that conversion improved owner likeness. The
Sarvam arm is rejected for this frozen run, not silently replaced. The local
receipt-canonicalization fix remains an unbuilt candidate.

**Why.** The four-item frozen plan produced two signed, PerTh-protected
IndicF5 normalized base clips, while both Sarvam Bulbul v3 items stopped at an
HTTP 402 before audio. The first OpenVoice image rejected the output before it
could leave because PerTh required 240-sample framing. A corrected immutable
image passed startup, model hashes and PerTh, but its first stable signed 200
response failed the frozen receipt verifier and was discarded before any WAV,
wire response or conversion receipt was persisted. The next item was not
attempted. No converted candidate therefore existed for ECAPA, ASR or human
review, and the sealed abort manifest exposes zero stimuli. An offline
cross-language fixture proves that Python canonical JSON writes an integral
float as `1.0` while JavaScript reserializes it as `1`; that can invalidate the
receipt self-hash. It is a deterministic defect and a plausible explanation,
but the aggregate live verifier did not retain individual failed-field names,
so it is not presented as a measured identification of the discarded live
field.

**What would reverse it.** Start a new preregistered run only after the remote
image is rebuilt with a cross-language receipt fixture, the verifier records
only failed field names while discarding drifted audio, and a canary proves an
exact signed receipt with the pinned OpenVoice source, model, checkpoint,
config, owner reference, consent, base receipt and PerTh hashes. Qualification
then requires both matched Hindi and Hinglish conversions, sealed ECAPA and
script-aware ASR with no regression, and accepted blinded owner ratings for
likeness, naturalness and Indian accent. Sarvam requires restored billing
access and a fresh bounded plan; retrying the sealed run cannot reverse this
decision.

## `zonos2-aca-a100-remains-unqualified-after-bounded-pull` (2026-08-28)

**Decision.** Keep ZONOS2 outside the qualified set and production routing.
The West US 3 Container Apps A100 route is now proven schedulable, but the
22.0206 GiB immutable image did not finish its cross-region pull inside the
pre-registered 30-attempt readiness bound. Do not extend a live A100 merely
because the artifact is large. Tear down the isolated apps and dedicated
environment when the bound expires, and retain zero audio as the honest result.

**Why.** One signed owner-bound request scheduled the exact digest on a real
`Consumption-GPU-NC24-A100` replica. Azure emitted the GPU-driver event and the
exact `PullingImage` commitment, but the container never started, never became
ready and never restarted. Thirty public-gate responses were validly signed
`open_voice_runtime_warming`; no synthesis response or audio existed. The
active interval through final evidence capture was 1,216.296 seconds, an
estimated USD 2.1468 at the measured USD 6.354 hourly profile rate. Continuing
would change the registered experiment after seeing its result.

**What would reverse it.** A new frozen run may be authorized after the same
immutable digest is pre-positioned close enough to West US 3, or a separately
measured smaller immutable closure exists, and one min-zero cold start reaches
signed readiness inside a newly declared bound. Qualification still requires
the complete sealed Hindi, Hinglish and English pack, receipt integrity,
objective ECAPA and script-aware ASR, accepted blind owner ratings and complete
teardown. Capacity scheduling alone never qualifies voice quality.

## `studio-reports-require-private-pack-asymmetric-attestation` (2026-08-28)

**Decision.** A Studio result may reveal candidate identities only after the
browser verifies an RSASSA-PKCS1-v1_5 SHA-256 signature over the canonical
report body. The exporter creates or reuses one RSA-2048 private key under the
pack's private tree; the Studio bundle carries only the SPKI public key and its
SHA-256 key id. Replacing or removing a browser experiment must also purge the
exact replica/run bundle, progress, result and pointer before another run is
admitted.

**Why.** The previous run-id and sealed-key-hash comparison was integrity-shaped
but not authenticity: both values were present in the public bundle, so a
fabricated report could copy them and reveal attacker-chosen model labels. A
private-pack signature makes report authorization depend on material that
never enters the bundle or browser. RSA PKCS#1 v1.5 was selected because Node
and browser WebCrypto consume the same signature encoding directly, avoiding
the DER-versus-raw edge in ECDSA. Bounded lifecycle deletion prevents a
superseded private pack and ratings from silently accumulating on the owner's
device.

**What would reverse it.** Replace the local pack signer only if a durable
owner-authenticated result service signs the same canonical contract with a
managed non-exportable key and the browser verifies that service key. A future
primitive may replace RSA only after Node/browser interoperability, wrong-key,
bit-change and missing-signature negative controls pass. Convenience or a
matching public hash is not reversal evidence.

## `native-base-openvoice-conversion-rejected-after-objective-regression` (2026-08-28)

**Decision.** Keep the IndicF5-to-OpenVoice V2 tone-color arm isolated and
unqualified. The receipt-canonicalization and PerTh fixes qualify the transport
contract, not the voice hypothesis. Do not route it in production, call it an
owner-likeness improvement or infer Hindi naturalness from its valid receipts.
Keep the four opaque base/converted stimuli sealed for a future blinded
diagnostic only; they are not a promotion pack.

**Why.** A fresh frozen run made exactly two matched conversions on immutable
runtime digest `sha256:ba777d18345fe308fb02ec59190575d0d174ac3242a8dc75c30c650755a8eb64`.
Both signed receipts bound the exact base, owner reference, consent, model,
source and PerTh result. Objective n=2 comparison then moved mean ECAPA in the
wrong direction, 0.726677 to 0.680976, and worsened script-aware WER from
0.303571 to 0.375. Valid conversion therefore did not preserve even the two
registered non-perceptual guardrails. No operator listened and no human-quality
claim is available.

**What would reverse it.** A new preregistered converter or adaptation method
must improve or preserve both speaker-embedding similarity and script-aware
intelligibility on a larger held-out Hindi, Hinglish and English set, with exact
receipts and complete teardown, before it may reach blinded owner evaluation.
Production promotion additionally requires accepted blinded ratings for owner
likeness, Indian accent, pronunciation and naturalness. A valid receipt,
different tau or isolated anecdotal clip cannot reverse this decision.

## `remote-acr-builds-use-platform-aware-cli-launcher` (2026-08-28)

**Decision.** The checked-in OpenVoice ACR wrapper resolves Azure CLI from an
explicit `--az` path, `VYAKTI_AZURE_CLI`, or the platform path. Non-Windows and
Windows `.exe` installations execute directly. A Windows `.cmd` shim executes
only through explicit `ComSpec` with delayed expansion off, every command
argument validated and quoted, and Node `shell: false`. Do not restore a bare
`spawnSync("az")` call.

**Why.** Azure CLI's Windows installation commonly exposes `az.cmd`, which
Node cannot execute as a direct child with `shell: false`. Enabling a generic
shell would fix discovery by widening the injection surface. Explicit shim
resolution plus a fixed `cmd.exe` invocation preserves no-shell process launch
while handling paths and arguments containing spaces. The ACR registry name,
task path and computed source-manifest hash remain distinct arguments rather
than interpolated user command text.

**What would reverse it.** Replace the `ComSpec` branch only if Azure provides
a stable directly executable binary or documented Python entry point on every
supported Windows installation and the same fake-shim, spaced-argument,
metacharacter rejection and non-Windows direct-execution controls pass. A
working developer PATH or `shell: true` is not reversal evidence.

## `zonos2-regional-pull-solves-transfer-not-cuda-exposure` (2026-08-28)

**Decision.** Keep ZONOS2 isolated and unqualified. Regional artifact proximity
is now the measured startup path for its existing 22.0206 GiB image, but it
solves only transfer time. Do not rebuild or rerun the model until a tiny
diagnostic canary proves that an A100 device, driver library and CUDA-enabled
PyTorch process are all visible in the same Container Apps workload profile.

**Why.** A West US 3 Basic ACR server-side import preserved the exact runtime
manifest digest, config digest and all 13 layer digests. The same immutable
image then pulled from West US 3 in 194.29 seconds, versus remaining incomplete
after 1,216.296 seconds from Central India. The container started, but every
start exited 3 at `/srv/zonos2/app.py:248` with
`RuntimeError("zonos2_cuda_required")` because `torch.cuda.is_available()` was
false. The frozen package closure is GPU-shaped: upstream pins PyTorch 2.9.1
and CUDA 12.8 NVIDIA wheels, while Azure announced driver 580.159.04 with CUDA
compatibility through 13.0. Those facts reject a CPU-only lock or obvious
driver-version mismatch, but do not yet identify whether device injection,
runtime library discovery or template semantics failed.

**What would reverse it.** In one newly bounded, regional, min-zero A100 run,
first execute a diagnostic-only image that records `/dev/nvidia*`,
`NVIDIA_VISIBLE_DEVICES`, CUDA driver-library discovery, `nvidia-smi`,
`torch.__version__`, `torch.version.cuda`, `torch.backends.cuda.is_built()` and
`torch.cuda.is_available()`. Compare an official minimal GPU validator in the
same environment, and test explicit `resources.gpu: 1` only if ARM validation
accepts it. Rerun the unchanged ZONOS2 digest only after that canary passes.
Voice qualification still requires the sealed Hindi, Hinglish and English
pack, exact receipts, objective metrics and accepted blind owner ratings.

## `ws-r2-voice-identity-challenge-decision` — owner identity by speaker verification, not by document (2026-09-03, WS-R2)

**The decision.** An owner satisfies `identity_verification_required` and
`liveness_verification_required` by speaking a server-issued sentence on
camera. Two independent measurements must agree: ECAPA speaker-embedding
cosine between the challenge clip and the owner's own VoiceGenome reference,
and a Sarvam transcript that contains that sentence plus a spoken numeric
nonce. The decision is a row in `vy_replica_voice_challenge` (migration 072),
and `completeVoiceChallenge` writes the SAME three `vy_replica` columns, under
the SAME `age_verified_at is not null` guard, that
`completeLivenessVerification` writes when the Azure composite verifier
passes. `runtimeBlockers` and `activateOwnedRuntime` are untouched and cannot
tell the two paths apart.

**Why.** The shipping product has no identity path at all. The Azure Document
Intelligence + Face Liveness stack (`services/azure-verifier`,
`api/_replica-identity.js`, `api/_replica-liveness*.js`, migrations 039-041)
was built, is complete at both ends, and has never been deployed: it needs two
Microsoft Limited Access approvals nobody has. The only other route is
`REPLICA_SELF_TEST_MODE`, which is a flag, is owner-UUID-bound, and is
explicitly not a product path
(`rejected.md#single-self-test-boolean-is-a-global-footgun`). Self-cloning
only is a law (`decisions.md#replica-self-only`), and the question that law
actually asks is "is the person speaking now the person this replica was built
from" — which is a speaker-verification question, not a document question.

**Why NOT a new DAG step in the processing worker.** The obvious home for
"embed this clip" is `AUDIO_PROCESSING_DAG`, and it was rejected: the worker
is a deployed Azure Container Apps Job pinned by image digest, and this repo
has already paid twice for work that was complete in `api/` while the Job had
not been rebuilt (`STATE.md`: "the fix is not live: the processing Job has not
been rebuilt"). A Vercel cron ships with the ordinary push that ships the rest
of the branch. The cost is a function budget rather than a 3 600 s one, which
is why `maxJobs` is 1 and why a cold evidence service is a retry rather than a
failure.

**Why two sources per challenge.** `services/voice-evidence` accepts
`video/webm` (it is in the adapter's own `ALLOWED_MIME`), so the camera clip
can be embedded directly. Sarvam's sync endpoint is measured in this repo on
AUDIO only (`measurements.md#first-real-clone`: 4 134 ms for 25 s, hard 30 s
cap) and has never been sent a video container; there is no ffmpeg on Vercel
to demux one. Guessing a vendor's container support on the launch path is the
shape of `rejected.md#plausible-return-hides-a-dead-pipeline`. So the browser
encodes a second artifact, a 24 kHz mono WAV, from the SAME `getUserMedia`
stream using `wavCapture.ts`'s already-exported encoder and resampler.

**What this deliberately does NOT prove, and it is in the code as well as
here.** It does not prove ADULTHOOD: a voice cannot establish an age, so
`age_verified_at` remains the ID document's to write and
`adult_verification_required` survives a perfect challenge. It does not bind a
LEGAL IDENTITY: it answers "same person as the enrolment", not "who in the
world is that person". Anything requiring a named human still requires the
Azure path or an equivalent.

**What would reverse it.** (a) The two Microsoft Limited Access approvals
landing, at which point the Azure path is strictly stronger for legal identity
and this becomes the fallback rather than the default. (b) A measured impostor
control set showing the different-speaker distribution overlaps 0.78 — see
`ws-r2-voice-challenge-thresholds` below, which is the sharper reversal
condition and the one that matters first.

## `ws-r2-voice-challenge-thresholds` — the rails are the repo's own numbers, and one side of them is unmeasured (2026-09-03, WS-R2)

**The decision.** Accept at cosine >= 0.78, review 0.70 to 0.78, reject below
0.70, recorded as constants in `VOICE_CHALLENGE_POLICY` with the measurement
cited beside them. `review` is a real decided outcome that does NOT open the
gate.

**Why these numbers.** They are the repo's own, from
`measurements.md#first-real-clone` (n = 1 subject, 2 end-to-end runs, spread
1e-6): the owner-vs-owner ceiling across different windows of the same
recording is 0.8869 (p10 0.8795), `api/_fidelity.js`'s activation floor is
0.70 and its warn band is 0.78. The owner-vs-owner row is the comparison this
module actually makes, so a genuine owner should land near 0.88, a full 0.10
above accept. The FALSE-REJECT side therefore has a measured margin.

**The honest limit, stated as loudly as possible.** THE FALSE-ACCEPT SIDE DOES
NOT. This repository contains no different-speaker control: nobody has ever
measured what an impostor scores against a stranger's reference on this stack.
0.70 is carried from `api/_fidelity.js` because it is the only number in the
building chosen with any evidence at all, and NOT because anyone has shown an
impostor falls below it. `api/_fidelity.js` already says of its own thresholds
that "a threshold nobody measured is dogma with a decimal point on it"; that
applies here with more force, because what sits on the other side of this gate
is a person's identity rather than a drift warning. `review` exists precisely
so that a decision nobody can defend numerically has somewhere to land that is
not "yes".

**What would reverse it.** An impostor control set: N speakers scored against
M other speakers' references through this exact path. If that distribution
overlaps 0.78, the gate is not safe at 0.78 and `VOICE_CHALLENGE_POLICY_VERSION`
gets bumped rather than the constants quietly edited. The eval proves the
thresholds are DATA (the same recording moves between decisions under two
policies with no code edit), so a re-bench is a config change.

## `ws-r2-transcript-is-the-liveness-half` — the anti-replay argument is the transcript, not the voice (2026-09-03, WS-R2)

**The decision.** A challenge cannot be accepted unless the ASR transcript
matches the issued sentence above a word-overlap threshold AND contains the
spoken numeric nonce. The nonce is a separate mandatory check rather than more
tokens in the overlap.

**Why.** A replayed old recording of the owner passes the speaker check by
construction, because it IS the owner. The only thing that separates it from a
live reading is that it cannot contain a sentence and digits generated after
it was recorded. The eval carries the negative control that makes this
load-bearing rather than decorative: with the transcript gate removed, the
identical replayed recording is ACCEPTED.

**Why the nonce is separate.** `rejected.md#romanised-lexicon-meets-devanagari-asr`
measured a visibly bilingual transcript at code-switch ratio 0.000 because
Sarvam returns Devanagari and transliterates the English half into Devanagari
too. A Latin-script bank sentence read back in Devanagari would therefore
score near zero on WORDS while the person did nothing wrong.
`normalizeChallengeSpeech` keeps `\p{M}` (that entry's defect (a): stripping
Mark_Nonspacing shreds an abugida into bare consonants) and folds nine Indic
digit ranges to ASCII, so the digits survive a total script mismatch and the
anti-replay argument survives with them. The word overlap then degrades into a
`sentence_not_read` refusal the owner is told how to fix, instead of a silent
rejection nobody can explain.

**What would reverse it.** A measured script-behaviour bench for Sarvam on
this exact bank. If it returns Latin for Latin input, the overlap threshold
can be raised and the fold becomes redundant rather than load-bearing. If it
returns Devanagari for everything, the bank should be authored in Devanagari
and the overlap threshold re-derived from that. `transcriptOverlapMin = 0.60`
is PROVISIONAL and marked so in the code; it is the one number in this
workstream with no measurement behind it.
## `ws-r6-vendor-arms-are-bench-arms` (2026-09-03, WS-R6)

**Decision.** ElevenLabs and Sarvam are registered as VOICE BENCH ARMS, not as
lanes. `VOICE_LANE_ORDER` is unchanged and still puts the self-hosted lane
first; setting `ELEVENLABS_API_KEY` gets an operator a bench arm and nothing
else. Exactly one environment variable, `VOICE_PRIMARY_LANE`, can move the
primary synthesis lane, it is read in one place (`api/_voice/registry.js`), and
it throws rather than falling back when it names a lane that is not configured.

**Why.** `platform-north-star` names the evidence that would make a vendor lane
primary again: the self-hosted lane's fidelity staying materially below the
vendor lane after fine-tuning effort. No vendor arm had ever been benched, so
that reversal condition was unfalsifiable, and an unfalsifiable reversal
condition is the dogma the file's own rules exist to prevent. Building the arms
as BENCH arms makes it testable without pre-deciding it: the shipped product
does not change until a listening pass says it should. An operator who asks for
a vendor primary and silently gets the self-hosted one has been told the
opposite of the truth about what produced their audio, which is why the
override refuses instead of falling through.

**What would reverse it.** A sealed listening pack in which the ElevenLabs cell
beats the self-hosted cell on OWNER LIKENESS, from at least one accepted
listener who passed both attention checks, on both the English and Hindi
exact-text cells, with the disclosure trimmed and the mapping unsealed only
after the ratings were locked. That flips `VOICE_LANE_ORDER` and makes the
in-house lane the research track. A better naturalness or pronunciation score
is NOT reversal evidence, and neither is any ECAPA number: `azure-tts` is the
entry where every measured axis said switch and the ear was right to refuse.

## `ws-r6-sarvam-is-the-accent-control` (2026-09-03, WS-R6)

**Decision.** The Sarvam Bulbul arm is implemented as an Indian-accent BASE
voice with a preset speaker, labelled `indian_accent_base_voice` on every
receipt and in the unsealed report, and its `createVoice` and `deleteVoice`
refuse rather than returning anything. It can never win the owner-likeness axis
and the instrument says so before anyone reads a number.

**Why.** Sarvam's marketing says Bulbul v3 supports voice cloning; their public
API reference documents preset speakers and no endpoint that builds a custom
speaker from a reference recording (read 2026-09-03 across the API reference,
the Bulbul model page and the endpoint index; the only cloning in the docs is
inside the separate Dubbing product). Returning a preset speaker from a call
named `createVoice` would put a base voice into the clone lane where nothing
downstream could tell the difference. It is still worth benching, for the reason
`azure-tts` gives: that battery measured whether Hindi words come back as Hindi
words, never whether the speaker sounds like a person from this country, and
only the second decides likeness. A native-accent base voice is the control
that separates the two axes.

**What would reverse it.** Sarvam documenting a custom-speaker endpoint, at
which point the arm grows a `createVoice` and changes category. A marketing page
is not documentation and does not reverse this.

## `ws-r6-vendor-clip-carries-no-perth` (2026-09-03, WS-R6)

**Decision.** Vendor arm receipts record `perthWatermarkVerified: false` and
`protectionPath: "delivery_audioseal"`. The matched pack's verifier REFUSES a
vendor result that claims a PerTh watermark, and still refuses a self-hosted
result that lost one. The platform watermark reaches a vendor clip through
`api/_provenance/delivery.js` on delivery, not at synthesis.

**Why.** PerTh is embedded by `services/open-voice-runtime`; it is a property of
the self-hosted lane, not of every generated clip. The platform requirement that
every delivered clip is watermarked is met by the delivery path, which is
provider neutral. The temptation was to let a vendor arm report the field as
true so the existing pack accepted it unchanged. That is fabricated evidence in
the exact shape `AGENTS.md` names, and it would have been fabricated in the one
place it does the most damage: the bench that decides `platform-north-star`.

**What would reverse it.** A vendor that documents an embedded watermark our
detector can verify, plus a verification run against a real clip. A vendor
claiming a watermark in a response field is not evidence.
## `review-correction-is-a-source-not-a-prompt-line` — WS-R4 (2026-09-03)

**Decision.** "Close, fix it" writes the owner's better answer as a row on
`vy_replica_source` with `purpose='correction'`, uploaded through the ordinary
signed upload and finalized through the existing source endpoint so the existing
processing DAG transcribes a dictated one. It is never written into a persona,
a TeacherSheet, or any compiled prompt. Everything derived from the answer it
replaces is INVALIDATED (draft `vy_replica_profile` retired, in-flight
`person_profile` build retired, the originating claim superseded) so the next
build re-derives; nothing derived is edited in place.

**Why.** `recited-prompt` is measured twice in unrelated features: her own
example quotes acted as a phrase bank (recited 4/5 → 0 after removal), and taste
written as polished English sentences was read out verbatim twice, eight turns
apart. The owner's better answer is the single most recitable string this product
can produce: a whole sentence, in their own words, about a question their
audience really asks. 059 already states the same rule one table over for
`vy_mirror_feedback.rephrase_text` ("the single most recitable thing that could
enter a prompt"). The invalidate-and-rebuild half is the brief's own wording and
matches what `markOwnedSourceDeleting` already does on source deletion; the audit
fact is spelled `derived_models_invalidated` deliberately, so one grep finds
every place derived material is thrown away.

**What would reverse it.** A measured retrieval lane that can inject a stored
correction at answer time WITHOUT it appearing in the prompt as a sentence (a
cited excerpt the model is told to paraphrase, benched for verbatim echo at
n>=32 like the taste rewrite was), or a measurement showing a correction stored
as a source is never retrieved and therefore never affects an answer. The second
would be a reason to change the retrieval, not to paste the sentence in.

## `review-decision-is-one-sql-clause` — WS-R4 (2026-09-03)

**Decision.** A review card flips state in ONE statement, and each of the three
decisions is gated on its own write having landed IN THAT SAME STATEMENT,
upstream of the flip:

    fixed  ...  and ($4::text <> 'fixed' or exists (select 1 from correction))
    never  ...  and ($4::text <> 'never' or exists (select 1 from landed_rule))

plus migration 074's `vy_review_card_fixed_gate`, a CHECK that makes
`(state='fixed') = (correction_source_id is not null)` true by construction.

**Why.** This is `mirror-call-approval-is-one-sql-clause` (2026-08-26, WS-X)
applied to a second surface, and it is the half that is easy to get backwards:
the write is upstream of the state flip, so a decision whose write did not land
leaves the card OPEN rather than "decided and silently unapplied". A tap that did
nothing must not look like a tap that worked. `evals/review-queue/run.mjs`
strikes the `fixed` clause out of the shipping string and asserts the struck copy
is a different program, and drives the "correction source is gone" path to prove
the card stays open with a named refusal.

**What would reverse it.** A reviewed, benched path for recording a decision
whose write is applied asynchronously, with the un-applied state rendered
honestly in the studio. There is no such path today and the CHECK forbids one on
the `fixed` branch specifically.

## `never-say-is-a-predicate-at-the-one-door` — WS-R4 (2026-09-03)

**Decision.** "Never say this" writes a `vy_review_never_rule` row. The rules are
read per turn, compiled by `api/_never-rules.js` (a module that imports nothing),
and matched inside `api/_surface.js::gateReply` on the assembled bytes, after the
honesty gate. A match SUPPRESSES the reply and names the rule id; the suppressed
text never travels and never reaches a log. Nothing is added to any prompt.

**Why.** Two independent measured reasons. `gate0-structural`, quoted in
`docs/gurukul/safety-floor-teacher.md`: prompt instructions leaked 57-98%, the
SQL predicate leaked 0 of 31,122. And `recited-prompt`: a list of forbidden
sentences in a brief is a phrase bank pointed at exactly the strings it forbids.
The module imports nothing because `api/_surface.js` is on every surface's reply
path including the Telegram webhook, and enforcing an owner's rule must not drag
storage config or a database client onto that path.

A long rule is matched by six-token SHINGLE rather than whole, because a clone
that says the forbidden thing again will not reproduce the paragraph byte for
byte, and a rule that only fires on an exact repeat is a rule that never fires.
Rules shorter than three normalised characters are refused at the door: a
one-character pattern matches every reply this AI will ever produce, and silently
muting a person's clone is worse than refusing their rule out loud.

**What would reverse it.** A measurement showing the shingle rule produces false
suppressions on ordinary replies at a rate an owner would call broken (it is
untested against real traffic; today it has only the suite's fixtures behind it),
or a bounded per-turn cost measurement showing 200 compiled rules are too
expensive on the reply path. Either would change the MATCHER. Neither is a reason
to move the rules into a prompt.
## `ws-r3-readiness-lock-is-sql-predicate-peer-gate` (2026-09-03)

**Decision.** The Readiness publish lock (Vyakti Rooms v1: 70 overall, 55 on
every part, nothing unmeasured) is enforced as a SQL predicate joined against
the newest `vy_replica_readiness` snapshot, wired into two places as a PEER of
the existing fidelity gate rather than a successor to it or a JS branch above
either write: `activateOwnedRuntime`'s activation CTE (`api/_replica-runtime.js`,
an INNER lateral join, pinned to `computed_at = max(computed_at)`) and
`saveCloneChannel`/`setCloneChannelStatus`'s status CASE
(`api/_clonechannel.js`, a reused `readinessPasses()` fragment across the three
writers so the floors cannot drift out of step between them). A clone can pass
either gate while failing the other; readiness answers "is it finished enough
to be let out", fidelity answers "does it sound like them", and the seven
suites answer "does it behave like them".

**Why.** `gate0-structural` (measurements.md) is the governing measurement for
this shape: the prompt-instruction arm of that build leaked 57.1% of
naturalistic and 98.1% of adversarial scenarios, the SQL disclosure predicate
leaked 0 of 31,122. A readiness check evaluated in the browser or beside the
activation write in JS is a preference; a row the activation statement JOINS
against, or a CASE the connect write cannot be steered around, is a guarantee.
Fail-closed is the specific direction chosen throughout: no snapshot at all
reads exactly like a snapshot that failed (peer to `FIDELITY_BLOCKER`'s own
precedent, so a caller cannot probe the gate for the difference), a refused
connect writes `draft`/`paused` rather than leaving the prior status, and pause
/ revoke are left ungated because a lock that could trap a teacher's clone
online would be a safety defect wearing a quality label.

**What would reverse it.** Nothing about the SQL-predicate shape itself; that
follows directly from `gate0-structural` and would need that measurement
overturned first. What COULD legitimately change the wiring: a third caller of
either gate discovered later that cannot afford the extra lateral join's cost
at its own scale (unmeasured here — no live database was reachable this
session, so the join has never been EXPLAINed against real
`vy_replica_readiness` volume), in which case the fix is an index or a
materialized flag column kept in sync by the same snapshot writer, not
weakening the predicate back into a branch.

## `ws-r3-readiness-overall-undefined-while-any-part-unmeasured` (2026-09-03)

**Decision.** `readinessScreen`'s `overall` and `min_part` are `null` whenever
any of the five parts (`knows_your_material`, `sounds_like_you`,
`thinks_like_you`, `knows_what_not_to_say`, `up_to_date`) lacks a real
instrument, never a mean over whichever parts happen to have numbers. Enforced
twice: in the pure function itself (`unmeasured.length === 0 ? ... : null`,
both for `overall` and `min_part`, guarded together because a mean without a
matching min would let the lock predicate read a null as a pass on one of the
two) and, independently, by migration 073's paired CHECK constraints
(`vy_replica_readiness_overall_undefined`, `vy_replica_readiness_min_part_pairs`)
so a row cannot exist in the database with five measured parts and a null
overall, or two of five measured and a real one.

**Why.** `plausible-return-hides-a-dead-pipeline` (rejected.md) applied to a
score: a readiness of 61 assembled out of three real numbers and two guesses
is the most persuasive version of that defect this product could ship, because
a creator would act on it. `ground-truth-ceiling` (measurements.md,
2026-08-18) is why one of the two missing instruments (`sounds_like_you`) is
specifically dangerous to fake: a trusted judge agreed with its own archived
verdicts only 77.1% of the time, so a similarity score expressed against
anyone's ceiling but the speaker's own imports one person's consistency into
everybody else's number. Today BOTH `knows_your_material` (no recall-run
writer exists anywhere in this repo) and `sounds_like_you` (no owner-ceiling
writer exists; `definition.evidence.self_similarity_ceiling` is read but never
written) are structurally unmeasured for every replica, so this decision is
the reason the publish lock is closed for every clone in the product today,
not an edge case.

**What would reverse it.** Never reversible as stated — it is the load-bearing
half of the spec (`unmeasured stays unmeasured, never a placeholder`). What
would change the STATE it describes: a recall-run writer and an owner-ceiling
writer landing at the two named seams (`readRecallRun` in `api/_readiness.js`,
and whatever writes `vy_replica_voice_genome.definition.evidence.
self_similarity_ceiling`), at which point real replicas would start showing a
defined overall for the first time. `evals/readiness/run.mjs` section 4 is the
enforcement of the "never reversible" half: it removes this exact guard from a
copy of the real module and requires every assertion resting on it to fail, so
a future edit that quietly reintroduces the average is caught rather than
merged.
## `ws-r5-interview-is-a-call-mode-not-a-second-door` (2026-09-03)

**Decision.** The interview is `mode=interview` on the existing `mirror-call/v1`
`create` op, not a second call type, a second reply assembler, or a second
consent freeze. `vy_interview_session.mirror_session_id` is `NOT NULL` and
unique, so an interview cannot exist detached from the Mirror Call whose
transport, consent scopes and window table it reuses, and the two modes differ
in exactly one thing downstream: whether the clone's turn carries a rendered
ask block. Every turn, in either mode, still leaves through `gatedReply()`
(`api/_mirrorcall-reply.js`), which is `mirror-call-reply-is-the-one-door`
applied to the surface where a second door would matter most — the owner is
answering questions about themselves.

**Why.** A parallel interview lane would need its own consent check, its own
window ingestion, its own reply assembly, and every future rule added to
`gatedReply` (a helpline, a manipulation guard, a new honesty family) would
reach the ordinary call and silently miss the interview unless someone
remembered to wire it twice. One door means every such rule reaches both modes
for free, which is the whole argument `api/_clonechat.js` already settled for
the web widget.

**What would reverse it.** A real product requirement for an interview that
runs independent of a live Mirror Call — asynchronous, text-only, or resumable
across days without an open call — would need a new transport, and at that
point this decision should be revisited rather than stretched. Wanting the
interview UI to look different from the calibration call is not that evidence;
the mode flag already carries that without a second door.

## `ws-r5-gap-list-frozen-at-session-open` (2026-09-03)

**Decision.** `api/_interview-gaps.js::buildInterviewGaps` runs once, when the
interview opens, and its ranked output is written into
`vy_interview_session.gaps` (jsonb, capped at 32 KB, array-shaped by a CHECK
constraint) rather than recomputed on every window. `gaps[answers_captured]` is
the outstanding question for the life of the session.

**Why.** The gap model reads claims, sheet fields, transcript coverage and the
readiness snapshot, all of which keep changing while a twenty-minute call is in
progress. Recomputing mid-call would mean the interview's fourth question came
from a different ranking than its first, with no way for the owner to know the
ground shifted under them mid-answer. Migration 075's header makes the same
argument 059 makes for `consent_scopes`: what was true at start is a fact the
row has to carry.

**What would reverse it.** A live interview session (needs the migration
applied and a real call) showing that evidence arriving mid-call — a claim
decision flipping, a contradiction resolving itself — measurably produces worse
questions under freezing than under a recompute would be grounds to revisit.
No such measurement exists yet; this is a design argument, not a tested one.

## `ws-r5-interview-answer-grows-the-source-set-and-writes-nothing-else` (2026-09-03)

**Decision.** `recordInterviewAnswer` (`api/_interview-store.js`) only stamps
`purpose='interview'` onto a `vy_replica_source` row the owner's ordinary
upload lane already created, and inserts one `vy_interview_answer` row pointing
at it. Nothing in the interview lane writes `vy_teacher_sheet`, a persona field,
or a `vy_mirror_conditioning` selection. `evals/interview/run.mjs` asserts no
statement in the store lane names either table.

**Why.** `context/rejected.md#mirror-reference-accumulation-was-inert` is the
standing evidence: a voice loop built as spec'd, accumulating references
automatically, would have changed nothing, because synthesis reads only
`vy_mirror_conditioning`'s selection. Generalised here, an interview answer is
not "more true" than an uploaded claim and must not be allowed to look like a
direct edit to the persona or the sheet — it becomes ordinary material that the
existing mining and review lane processes like anything else.

**What would reverse it.** Only a new, separately measured decision that the
voice or persona pipeline should read interview answers directly (superseding
the "selection over accumulation" argument this is built on) would justify
writing outside the source set from here. A request for the interview to "move
readiness faster" is not that evidence; it is a request to route through the
ordinary mining lane faster.

## `ws-r5-ask-block-splices-before-the-appended-last-set-or-refuses` (2026-09-03)

**Decision.** `spliceInterviewAsk` (`api/_mirrorcall-reply.js`) inserts the
interview's rendered ask block into the compiled prompt tail immediately
BEFORE `FORGET_DECISION` — the same position `compiler.ts` gives T16/T19 — and
returns `null` (surfaced as the named reason `interview_ask_unplaceable`, never
a silently dropped ask) if the compiled tail does not end with that exact
suffix. It never appends after it.

**Why.** `prompt-position` measured 0/8 fires for an identical rule buried
mid-brief against 8/8 for the same rule appended last, and that appended-last
set is deliberately closed at exactly two members
(`shapelint.checkAppendedLastExactlyTwo`). Adding the ask as a third
appended-last item would be quietly widening a set the compiler treats as
closed, on the one lane where the "line" being smuggled in is the model's own
instruction for what to ask next.

**What would reverse it.** A re-run of the position experiment (mid-brief vs.
appended-last vs. immediately-before-appended-last, same measurement method as
the original `prompt-position` result) showing the ask fires as reliably from a
different position would justify moving it. No such measurement exists for the
ask block specifically; the position is inherited from `prompt-position`'s
result for other rules, not independently confirmed for this one.

## `ws-r5-dialogue-register-is-a-pointer-not-a-reweight` (2026-09-03)

**Decision.** `dialogueRegister` (`api/_person-model.js`) adds
`speech.dialogue_register` to the person model definition as a set of claim ids
that came from a source with `purpose='interview'` — a pointer for retrieval to
prefer, not a new confidence weight or claim domain. The block is always
present (`sources: 0, claims: []` when the replica has never been interviewed)
rather than an absent key, because an absent key would be indistinguishable
from a builder that silently ignored the argument.

**Why.** An interview answer is not more true than an uploaded claim, only
differently shaped — it is the only material where the person is in a
conversation rather than composing one. Reweighting confidence on that basis
would conflate "recently and conversationally given" with "more likely true",
which nothing in this feature has measured. `evals/interview/run.mjs` drives
the builder with the same claims twice, with and without the interview source
ids, and fails unless the two outputs differ, so a future edit that stops
threading the ids through breaks a gate rather than shipping silently empty.

**What would reverse it.** A measured degradation in register consistency
(Hinglish/English code-switch matching, the existing `exdialog-surface`-style
measurement) traceable to boolean membership being too coarse — for example, an
interview answer given once, offhand, being weighted the same as one repeated
five times — would be grounds to move to a weighted signal instead of a set.
## `ws-r1-room-is-a-third-vite-entry-not-a-studio-route` (2026-09-03)

**Decision.** WS-R1 (the Room, a creator's published follower surface at
`/r/<slug>`) ships as its own Vite build entry (`room.html` → `src/room/`),
its own Vercel rewrite (`/r/:slug` → `/room.html`), and its own layout-gate
fixture (`room-layout-fixture.html`), rather than as a route inside the
existing studio bundle. Keep it a separate entry as long as the Room and the
studio remain different audiences.

**Why.** A follower arrives from a bio link with no reason to trust this
domain yet and no reason to download a creator's authoring tool. Folding the
Room into the studio bundle would mean every follower's first paint pays for
code (wizard steps, processing review, mirror-call authoring) they will never
run, and would put the studio's own surface behind a route a stranger reaches
first. The two audiences share the design tokens (`src/studio/design/tokens.css`)
and `src/studio/studioAuth.ts` (see the next entry) and nothing else of
substance — `src/room/copy.ts` is deliberately its own module rather than a
reuse of the studio's, because a Room screen is read by someone who is not a
customer of this platform and the wrong sentence lands in front of a stranger,
not a colleague.

**What would reverse it.** If a later product decision merges the two
audiences (a creator previewing their own Room from inside the studio, say,
with shared navigation chrome), measure the actual bundle-size and first-paint
cost of a merged entry against today's two-entry cost before merging the
build target. Do not merge on code-reuse grounds alone; `src/room/copy.ts`'s
header records why the studio's copy was rejected as a shared module even
though the shape was reused.

## `ws-r1-phone-otp-lives-in-studioauth-not-a-new-module` (2026-09-03)

**Decision.** Phone OTP sign-in (`sendPhoneOtp` / `verifyPhoneOtp`, calling
`api/account.js`'s pre-existing but previously uncalled `send_sms` /
`verify_sms` ops) was added to `src/studio/studioAuth.ts`, the studio's
existing auth module, rather than to a new `src/room/roomAuth.ts`. Same file
for `googleSignIn`, which gained a `returnPath` parameter (default `/studio`,
so every existing caller is byte-identical) so the Room can send Google's
redirect back to `/r/<slug>` instead of into a creator's studio.

**Why.** The Room is the first surface whose audience signs in by phone
number by default, but a session shape, a refresh rule and an error taxonomy
are one contract regardless of which surface mints the session. A second auth
module is a second place those three things can drift, and the day they did,
the two products would disagree about what "signed in" means for the same
person. One module, two callers — the same reasoning `docs/SURFACES.md`
already states for why a transport must never become a second tenant.

**What would reverse it.** If the Room's session lifecycle needs to diverge
from the studio's in a way `studioAuth.ts` cannot express without conditionals
keyed on caller identity (a materially different token lifetime, a different
refresh cadence), split it then — a module that has to ask "which surface is
this?" before deciding its own behaviour has already stopped being one
module in anything but name.

## `ws-r1-free-cap-is-one-conditional-update-not-a-counter` (2026-09-03)

**Decision.** The Room's free-tier cap (20 messages/month, `vy_room.
free_monthly_messages` as data, not a constant) is enforced by ONE
conditional SQL `UPDATE` on `vy_room_follower` that rolls `month_key` and
increments `month_message_count` together, gated in the same statement that
checks the count against the allowance. No client counter, no
SELECT-then-UPDATE.

**Why.** `gate0-structural`'s distinction between a preference and a
guarantee applies directly: a SELECT-then-UPDATE lets two tabs both read 19
and both write 20, and a client-side counter is trivially bypassed by anyone
who opens devtools. A single atomically-conditioned UPDATE is the only shape
where "twenty free messages" is actually true rather than usually true.
`evals/room/run.mjs` asserts both halves — twenty allowed, the twenty-first
refused before any model call, and the month rolling over inside the same
UPDATE.

**What would reverse it.** If the free allowance ever needs to be a true
rolling 30-day window rather than a calendar month, this exact mechanism
(two columns, one UPDATE) does not extend to that cleanly and would need
redesigning — that is a product-shape change, not a bug in this one.

## `ws-r1-room-owner-lane-excluded-from-person-tables` (2026-09-03)

**Decision.** `vy_room` (migration 071) is deliberately absent from
`api/memory.js`'s `PERSON_TABLES` manifest, even though it is exactly the
kind of table that manifest exists to catch. Its erasure is wired the other
way: `api/_replica-full-erasure.js`'s CTE chain deletes `vy_room`,
`vy_room_follower` and `vy_room_thread` by `agent_id`/`replica_id`/
`owner_user_id` when a CREATOR revokes their AI. `vy_room_follower` and
`vy_room_thread` are additionally in `PERSON_TABLES` (with `agent: true`,
gated on migration 071 having landed, exactly as `meera_consent` is gated on
016) so a FOLLOWER's own whole wipe takes their membership and thread titles.

**Why.** `vy_room` carries `owner_user_id` and no person column — it is the
creator's row, not a follower's. A manifest loop that deletes by
`person_id` has no business touching it, and if it somehow did, one
follower's "forget me" would take the room away from every other follower in
it. Both erasure directions are real and independently wired for the reason
stated throughout this codebase's erasure code: two independent layers for a
harm the next turn does not undo. `scripts/relcheck.mjs`'s owner-lane reach
walk is why `vy_room` must be named in `_replica-full-erasure.js`'s SQL by
text rather than relying on `room_id`'s cascade alone — a table carrying
`owner_user_id` that is reachable only through a cascade nobody re-checks is
exactly the defect class that check exists to catch.

**What would reverse it.** If a future migration adds a `person_id` column to
`vy_room` itself (there is no product reason to today — a room has one
owner, not one person), that column would need its own decision about
whether it belongs in `PERSON_TABLES`, and this entry's reasoning would not
automatically transfer to it.

## `ws-r1-citations-name-sources-never-passages` (2026-09-03)

**Decision.** The Room's citation affordance (`op:"citations"`) returns the
creator's own Context Locker source names (`vy_context_item.source_name`,
`status in ('mined','routed')`) with `exact:false`. It never returns a
passage, a quote, or a claim of exactness.

**Why.** The engine exposes no per-reply provenance on this path — there is
no mechanism that knows which source a given reply actually drew from, only
which sources exist for this creator. Answering "where did that come from"
with a guess dressed as evidence is `plausible-return-hides-a-dead-pipeline`
in its exact shape: a citation that looks specific but is not earned reads as
more honest than the truth, which is worse than an honest "this comes from
{name}'s own material."

**What would reverse it.** If the retrieval path this endpoint reads from
ever gains real per-reply provenance (which chunk actually fed a given
generation), `exact` should flip to `true` and the response should carry the
real passage — but only once that provenance is measured to exist, not
before.

## `ws-r1-layout-gate-measures-two-products` (2026-09-03)

**Decision.** `scripts/check-layout.mjs` was generalized from one hardcoded
fixture and step list to a `TARGETS` array, each entry naming its own
fixture file, its own query-string builder, its own "did this actually
mount" selector, its own panel selector and its own `minPanels` floor. The
studio (`studio-layout-fixture.html`, `mode=teacher&step=`, 3 steps, floor 2
panels) and the Room (`room-layout-fixture.html`, `screen=`, 2 steps —
`join` and `talk` — floor 1 panel, since a Room screen is one shell with one
card in it) are both measured, at all three viewports (390/834/1355px),
every run. Everything NOT specific to a target — the prose CPL/font-size
floors, the grid-sliver checks, the contrast floor, the overflow check — stays
shared across both, deliberately: two products of one company disagreeing
about what readable means is exactly the failure this gate exists to make
visible.

**Why.** The gate's own history is the argument: `layout-readability-gate`'s
node records that a surface nobody points this gate at is a surface where the
collapsed-column defect lives, undetected, until someone happens to look. The
Room is a second, separate follower-facing surface (see the entry above); a
`check-layout.mjs` that still only measured the studio would report green
while the actual product most strangers see went unmeasured. `minPanels` had
to become per-target rather than one shared constant, because the studio's
own floor of 2 would fail a correct one-card Room screen — a floor set for
one shape and silently applied to a different shape is a false failure, and
a gate that fails correct pages teaches people to stop reading its output.

The same pass also fixed a **pre-existing, unrelated bug** in the gate's
contrast check found while extending it: `getComputedStyle` on Chromium
serializes a `color-mix()`-derived background as `color(srgb r g b / a)` with
components in the 0..1 range, not the `rgb(r,g,b)` 0..255 range the parser
assumed, so a paper-coloured header parsed as near-black and a genuinely
4.5:1+ label reported as a 1.18:1 failure. `parseColor` now branches on the
`color(` prefix and scales up. This was found only because the Room's own
CSS uses a `color-mix()` background the studio's does not exercise the same
way; it would eventually have been found by the studio anyway, but WS-R1 is
why it was found now rather than later.

**What would reverse it.** If a third follower- or creator-facing surface is
added, add a fourth `TARGETS` entry rather than special-casing it — that is
the abstraction this refactor exists to make cheap. If the shared checks ever
need to diverge per-target (a genuinely different contrast floor for one
product, say), that is the point at which per-target limits, not just
per-target selectors, become necessary — `audit(limits)` already threads a
`limits` object per call, so the extension point exists without a further
refactor.

## `rooms-migrations-applied-live-in-the-union-order` (2026-09-03)

**Decision.** Migrations 071 (Room), 072 (voice identity challenge), 073 (readiness), 074 (review queue) and 075 (interview) were applied to the live Neon database on 2026-09-03 by the main loop, one statement per request through Neon's SQL-over-HTTP, in the order 072, 074, 073, 075, 071 (the order the workstreams finished), and every new statement each workstream's API runs was `EXPLAIN`ed against the live database before its branch was merged. 066-070 were left unused because another agent applied migrations under those numbers live without pushing them (the live database carries `vy_replica_voice_preview_intent`, `vy_replica_voice_build_intent`, `vy_replica_voice_reference`, `vy_replica_claim_extraction_queue`, `vy_replica_claim_extraction_queue_item` and `vy_replica_expression_observation`, none of which any file in this tree creates).

**Rationale.** The repo's own law: offline mocks cannot type-check SQL, and EXPLAIN against the live database is the only parser we have. Applying before merging meant the EXPLAIN could see the new tables and indexes, and the plans confirmed every scope index is used. Leaving 066-070 free is what lets the unpushed tree merge without renumbering.

**Reverses if.** The unpushed tree turns out to have used numbers at or above 071, in which case the later of the two colliding files is renumbered and re-applied (every migration here is idempotent, so a re-apply is safe).

## `source-purpose-check-is-the-union-of-every-workstream` (2026-09-03)

**Decision.** `vy_replica_source.purpose` was added by two workstreams independently (074 with `correction`, 075 with `interview`), each with its own CHECK. Both migration files, `db/schema.sql`, `api/_replica-source.js` and the live constraint now carry the union `('memory','identity_document','correction','interview')`, so the result is identical whichever file applies last.

**Rationale.** A CHECK that one migration narrows and a later one widens is order-dependent, and the apply order in production is not the file order (see above). The union is the only version that is correct in every order.

**Reverses if.** Purposes ever need to be per-replica-configurable, in which case they become rows, not a CHECK.

## `ws-r8-leak-battery-scans-tokens-through-the-real-lane-not-a-reimplemented-predicate` (2026-09-03)

**Decision.** The Rooms leak battery (`evals/room-leak/run.mjs`) drives N
followers (2, 5, 20) x 4 turns EACH through the real, unmodified follower lane
(`api/_room-surface.js`'s `joinRoom`/`roomSay`/`roomExport`/`roomForget`) and
the real compiler (`src/engine/compiler.ts` via `api/_engine.gen.js`), seeds
every follower with unique tokens (a long-term fact plus one per message), and
scans every compiled prompt, every retrieved fact set and every reply for
every OTHER follower's tokens. `roomSay`'s `memory.recall` seam is given a
FAKE that enforces person-AND-agent equality, not `dmRecall`'s real SQL,
because `dmRecall` calls `q()` (`api/_db.js`) directly and is not
seam-injectable the way `roomSay`'s own memory functions are — deliberately,
so a follower's own request can never swap the real predicate for a weaker
one. The fake's own negative control (strike the person clause) proves it is
not vacuously safe, and the real predicate's live-clean proof already exists
at `evals/mp/gate0.mjs` (0/31,122, `context/measurements.md#gate0-structural`)
— this suite connects to that proof (checks the real predicate TEXT and the
real call-site wiring) rather than re-deriving a weaker offline copy of it.

**Rationale.** `offline-mocks-cannot-type-check-sql` (AGENTS.md) applies
directly: no database is reachable in this environment, so `dmRecall` cannot
be executed here regardless of how the suite is built. The alternative —
skip the retrieval layer entirely because it cannot be proven end to end
offline — would leave the single highest-risk path (another follower's
long-term memory) completely unguarded by any pre-merge gate. A conforming
fake plus a proven-elsewhere real predicate plus an explicit statement of what
is and is not proven (this suite's own header) is the honest middle ground:
`evals/mp/gate0.mjs` already established this exact pattern for the
multiparty predicate.

**What would reverse it.** If `dmRecall` (or its successor) is ever made
seam-injectable — a `db`/`recall` parameter the way `roomSay`'s memory
functions already are — this suite should be rebuilt to drive the REAL
predicate offline against a `db` that reads the shipping SQL text the way
`evals/room/fixtures.mjs`'s `fakeDb` already does for the rest of the follower
lane, and the compliant fake recall becomes redundant. Until then, a change to
`dmRecall`'s BIND literal or its query text is caught by this suite's static
layer (1b), which reads both from the real source at run time.

## `ws-r8-writer-symbols-derived-by-intra-file-call-graph-not-hand-listed` (2026-09-03)

**Decision.** The leak battery's static check for "the follower lane never
reaches a creator-material writer" derives the set of dangerous EXPORTED
symbols by parsing each creator-material file (`_replica-claims.js`,
`_replica-consent.js`, `_review-queue.js`, `_replica-source.js`,
`_teacher-sheet-draft.js`, `_mirrorcall-store.js`, `_person-model.js`) into
its top-level functions (exported and private), marking a function
"dangerous" if its own body writes a creator table OR it calls another local
function already marked dangerous (propagated to a fixed point), then keeping
only the exported ones. It does NOT ban importing the FILE, and it does NOT
hand-list symbol names.

**Rationale.** The first draft banned importing the FILE and false-positived
immediately: `_clonechat.js` legitimately imports `loadNeverRules` (a pure
SELECT) from `_review-queue.js`, which elsewhere, in a function the follower
lane never calls, writes `vy_replica_claim` — see
`context/rejected.md#ws-r8-file-level-import-ban-flagged-a-pure-reader`. The
call-graph derivation also caught a real gap in its own first pass: a
same-file, exported-symbol-only scan missed `extractOwnedClaims` because the
actual `insert into vy_replica_claim` lives in an unexported helper
(`persistProposals`) it calls — attributing the write to the PRECEDING
exported function by a naive "next export" text boundary instead. The fixed-
point propagation is what makes `extractOwnedClaims` (and any future writer
shaped the same way) show up in the derived set, and the suite asserts this
by name (`writeSymbols.has("extractOwnedClaims")`) so a regression in the
derivation itself fails loudly rather than silently under-covering.

**What would reverse it.** If any of the seven creator-material files is
restructured so a private helper calls back into ANOTHER file's private
helper to reach the write (breaking the single-file call graph this walks),
the derivation needs to become genuinely cross-file. No such case exists
today — every write this session found is same-file-reachable from its own
exported entry point.
## `ws-r7-publish-lock-shares-readiness-fragment-with-clonechannel` (2026-09-03, WS-R7)

**Decision.** `api/_room-publish.js`'s `publish` write gates `vy_room.published_at` on three conditions in one SQL `CASE`: an active runtime capability, the readiness lock, and an approved disclosure. The readiness fragment is not retyped — `readinessPasses` was exported from `api/_clonechannel.js` (it was a private `const` before this workstream) and imported verbatim, so the Room's publish lock and the channel connect/resume lock are provably reading the identical predicate rather than two hand-copies that happen to agree today.

**Rationale.** The workstream brief itself says "the readiness lock (same three conditions as api/_clonechannel.js)" — an import makes that sentence true by construction instead of by discipline. Two independently typed copies of a floor comparison are exactly the shape that drifts silently the day one file's floor changes and the other is not touched in the same commit; `context/rejected.md` already has several entries in this repo about a rule duplicated in two places disagreeing later.

**Reverses if.** The Room's publish floor is ever deliberately meant to differ from the channel connect floor (e.g. a lower bar for a first Room than for a third-party channel). At that point the two need their own named fragments with their own tests, and the shared `readinessPasses` export should be forked rather than parameterized further, since a fragment that takes a fifth argument to mean two different things is worse than two fragments.

## `ws-r7-deploy-reads-done-on-a-published-room` (2026-09-03, WS-R7)

**Decision.** `src/studio/wizardModel.ts`'s `deployDone` now returns true when EITHER a channel is connected (unchanged) OR the owner's Room is published (`input.roomPublished === true`, new). `deployMissing`'s "connect a channel" ask is suppressed the same way. `roomPublished` defaults to `null` (unknown, not "false") wherever a build never mounts `RoomStudio`, mirroring `connectedChannels`'s own "unknown is not zero" rule exactly, so a build that has not wired the Room in yet behaves byte-identically to before this field existed — asserted directly in `evals/studiowizard.mjs` §11's last check.

**Rationale.** Vyakti Rooms v1's own product paragraph: the Room is the primary, private, remembering address a follower actually reaches, not a channel on somebody else's platform. A Deploy step that only recognized channels would tell a creator who published a working Room, with real followers, that the step is still not done — the exact "platform failure told to the person as their own" shape `docs/HONESTY.md` and `blockerClass.ts` exist to catch, just running in the other direction (claiming NOT done when it is).

**Reverses if.** Channels are ever retired or merged into the Room concept, at which point `connectedChannels` and its branch of `deployDone`/`deployMissing` retire and `roomPublished` becomes the only signal.

## `ws-r7-room-mounts-only-in-teacher-mode-for-v1` (2026-09-03, WS-R7)

**Decision.** `<RoomStudio>` is mounted in `StudioApp.tsx`'s Deploy step only under `mode === "teacher"`, the same gate `<ChannelsStudio>` already carries. Full reasoning and what was tried instead: `context/rejected.md#ws-r7-room-for-generic-mode-with-no-disclosure-pathway`.

**Rationale.** `publishRoom`'s disclosure condition reads `vy_teacher_sheet`, which only the teacher-mode sheet-publish flow (`TeacherSheetStudio.tsx`, also `mode === "teacher"`-gated) can ever populate. Showing the card in generic mode would show a permanently unpublishable Room whose one named blocker points at a screen that mode never renders.

**Reverses if.** A generic-mode self-replica gains its own way to reach `vy_teacher_sheet`-equivalent `status='published'` + `consent_artifact_id` (or `api/_room-publish.js`'s `disclosureApproved` predicate is widened to accept a different consent record for a `selfReplica: true` agent). Nothing in `api/_room-publish.js` needs to change either way — it reads the row by `agent_id` alone, indifferent to which mode wrote it — so the reversal is purely the `mode === "teacher"` guard around `<RoomStudio>` in `StudioApp.tsx`.

## `ws-r7-publish-blockers-are-a-courtesy-read-never-the-gate` (2026-09-03, WS-R7)

**Decision.** `api/_room-publish.js`'s classified blocker list (`waiting_on_you` / `waiting_on_us`, returned by `get` proactively and by `publish` on refusal) is computed by THREE SEPARATE, CHEAP re-reads of the same three predicates the write's own `CASE` already evaluated — never by branching in JS above the write, and never trusted as the enforcement itself. Runtime's sub-reason (owner-owned gate vs. platform-owned gate) is read a second time, from `ownedRuntimeStatus`, the same status `RuntimeGate` already renders on the same Deploy step.

**Rationale.** `api/_clonechannel.js`'s own header states the law this restates: "a sentence in a brief is a preference; a predicate on the write is a guarantee." The courtesy explanation can be stale, wrong, or race the write by a few milliseconds under concurrent edits, and none of that matters, because it decides nothing — worst case it over- or under-explains a lock the write already held regardless. `evals/room-publish/run.mjs`'s negative control proves the write's own predicate is load-bearing independent of this courtesy layer.

**Reverses if.** Never, structurally — this is the same shape `api/_clonechannel.js`'s `connected()` already ships and it is a load-bearing platform convention (context/rejected.md's `gate0-structural`), not a workstream-local choice.
## `ws-r9-swap-signal-is-the-generation-ledger` — drift watch does not trust `vy_voice_fidelity` for a swap (2026-09-03, WS-R9)

**Decision.** `api/_drift-watch.js` detects a "provider silently swapped a model under the same name" event by walking `vy_replica_generation.preview_model_commitment` across one fixed lane (`purpose='voice_preview', channel='studio_preview'`), NOT by watching `voice_model_ref` on `vy_voice_fidelity`.

**Rationale.** Grepped for a CALLER, not a definition (`AGENTS.md`'s own law): `recordOwnedFidelity` (`api/_fidelity.js`) has exactly one caller in the whole tree, and it is `evals/fidelity/run.mjs`, its own offline eval. Nothing in `api/` writes a `vy_voice_fidelity` row today. A drift detector built only on that table would watch a table nothing fills — a `dead-writers` shape with the polarity reversed, discovered before shipping rather than after. `vy_replica_generation.preview_model_commitment` is written on every real preview synthesis (migrations 019/044) and is the one lane actually live, which makes it `vision-drift-4day`'s exact shape restated: the swap that mattered was caught by watching the ARTIFACT a deployment produces, not a config string nobody reads back.

**What this costs.** The score-drop half of "moved" (a genuine ECAPA drop against the same reference set) is real code, tested, and will report `not_measured` for every replica in production today, because there is no fidelity history to compare. That is the correct honest state, not a bug to route around silently.

**Reverses if.** `recordOwnedFidelity` gets a live caller (the activation pipeline, a scheduled re-bench, or the Mirror Call flow scoring a fresh sample). The day it does, the score-drop signal starts producing real trend points with no code change here — `driftWatchReport`'s `detectScoreDrop` already reads whatever history it is given.

## `ws-r9-drift-watch-does-not-write-on-read` — a monitor is not a lock, and its GET does not snapshot (2026-09-03, WS-R9)

**Decision.** `api/drift-watch.js` (the owner's GET) computes the report live and writes nothing. `api/drift-watch-sweep.js` (cron, every six hours) is the sole writer of `vy_replica_drift_report`, guarded on `inputs_hash` exactly like `snapshotReadiness`'s guard.

**Rationale.** `api/_readiness.js`'s "a read that writes" is deliberate there because the publish lock is a SQL predicate joined against the LATEST readiness snapshot inside the runtime-activation statement — an unsaved fresh compute would show a passing screen while the gate still read a stale failing row. Drift watch gates nothing (no activation, no channel connect reads this table), so there is no predicate that needs one exact compute captured, and a browser GET should never surprise the database with a write it did not ask for. The stronger reason: "an alert the day the score moves" (the brief's own line) must not depend on a creator opening the studio that day — if the write only happened on a GET, a swap on a Tuesday nobody visited the Meet step for would sit unrecorded and unalerted indefinitely. A schedule-driven sole writer is what makes the alert's timing independent of anyone looking.

**Reverses if.** Drift watch ever gates something (a channel pause, a re-review requirement) — at that point it needs readiness's exact shape: the read becomes the writer, guarded the same way, for the same reason.

## `ws-r9-score-drop-threshold-002` — cited to three numbers, not chosen (2026-09-03, WS-R9)

**Decision.** `DRIFT_SCORE_DROP_THRESHOLD = 0.02`. A "moved by score" verdict requires BOTH a drop exceeding this bar AND that the two compared `vy_voice_fidelity` rows share the same `genome_version` (the same reference set).

**Rationale, the three numbers.** All ECAPA-TDNN cosine, all in `context/measurements.md`: run-to-run reproducibility on this stack is **6e-6** (`lora-vs-zero-shot-71s`, corroborated to 5e-6 by a third independent run); choosing a different 10 s reference WINDOW of the identical recording, scored against a FIXED reference set, spans **0.0625** (`reference-window-beats-the-finetune`); a genuine trained change — 60 epochs of LoRA on 62.1 s of speaker audio — moved the mean by **+0.0206** (`lora-vs-zero-shot-71s`). 0.02 sits five orders of magnitude above the noise floor, just under the smallest genuine trained delta measured so far, and a third of the window-choice spread — which is why the same-`genome_version` restriction is load-bearing and not decoration: without it, 0.02 would fire on nothing more than which ten seconds of a recording got scored.

**Reverses if.** A same-reference-set repeatability bench across more than the current n=1 speaker either shows ordinary noise exceeding 0.02 (raise it) or catches a real swap below it (lower it). `DRIFT_POLICY_VERSION` bumps with any change, per `fidelity-needs-its-ceiling-printed`'s own precedent for `policy_version`.

## `ws-r9-prosody-anchor-reused-not-rederived` — the staleness check reads the job's own verdict, not a third copy of "current voice" (2026-09-03, WS-R9)

**Decision.** `api/_drift-watch.js` treats the prosody anchor as stale from `scripts/prosody-baseline.mjs`'s own `lastAlarm` field plus how long ago it last ran (`PROSODY_ANCHOR_STALE_DAYS = 14`, twice the job's own stated "nightly" cadence). It does NOT independently compare "the voice currently in use" against the baseline's recorded voice.

**Rationale.** `cache-outlives-the-voice` already found this exact hazard at two copies: `api/speech.js`'s `DEFAULT_VOICE` and `prosody-baseline.mjs`'s own `TTS_VOICE` constant, kept in sync only by a human running `verify-voice.mjs --set`. A third independent copy inside `api/_drift-watch.js` would be the same mirror-with-no-writer defect a third time. Reading the job's own alarm bit instead means there is exactly one place that decides "did the voice move," and drift watch inherits its answer rather than re-deriving a worse one.

**Reverses if.** The prosody baseline job grows a machine-readable "current expected voice" field of its own that is safe to compare against without re-deriving it — at that point a direct comparison here is strictly more information than a boolean alarm and worth the added coupling.
## `ws-r10-rooms-vocabulary-gate` (2026-09-03, WS-R10)

**Decision.** `scripts/check-copy.mjs` gained a fifth rule, `rooms-vocabulary`,
that fails the build on `clone`, `replica`, `model`, `fine-tune`,
`train`/`training`, `weights`, `embedding`, `LoRA` or `genome` in a
user-visible string anywhere in `src/studio/`, `src/room/`, `site/vyakti.html`,
and the two root entry points `studio.html`/`room.html`. Two files carry
documented, narrow exceptions in a new `scripts/roomsVocabAllowlist.mjs`:
`DisclosurePreview.tsx`'s two verbatim safety-floor quotes (the disclosure a
student already hears, word for word) and four of `ModelConsentGate.tsx`'s
`STATEMENTS` (the exact sentences a teacher affirmatively checks). Every other
string across both surfaces was rewritten to the Rooms vocabulary table:
"your AI" to a creator, "<Name> AI" to a follower, "apprentice" for an
incomplete one, "Studio", "Room", "Readiness", "Review" with its three
button labels.

**Rationale.** The Rooms plan's own rule: "not clone, in front of anyone." A
gate that only lints new code lets old strings rot in place, and this repo
already had 117 of them across `src/studio/` and `src/room/` before this
session, most from before the Rooms rewrite existed as a decision. Making the
rule structural (a failing gate, not a style note) is what stops a future
diff from reintroducing the word by habit, the same reasoning
`demo-teacher-is-not-a-placeholder` gives for why a fixture may never stand in
on a consent surface: a word a real person already agreed to, or a role this
product already promised never to use, cannot be a thing a PR quietly changes
back.

**Reverses if.** The product renames "your AI" / "<Name> AI" / "apprentice" to
something else, in which case this rule's regex and the allowlist's reasons
move together, not independently. If a legitimate new legal-text exception is
needed, it goes in `roomsVocabAllowlist.mjs` with a `reason` naming the exact
consent artifact it protects, never as a change to the rule itself.

## `ws-r10-worktree-wrong-base-commit` (2026-09-03, WS-R10)

**Decision.** Before writing any code, this session's worktree branch (then
`worktree-agent-aa270d73922673987`) was reset from `3a92179` (the tip of an
unrelated product's history, "Meera", sharing this same physical repo on a
different branch) to `61634a4` (the tip of
`claude/vyakti-cloning-platform-aq05n4`, the Rooms platform branch the
workstream brief actually describes), then renamed to `ws-r10-vocabulary`.
Confirmed correct by comparing against a sibling workstream's branch
(`ws-r8-room-leak-battery`), which was based on `61634a4` from the start.

**Rationale.** The checked-out tree had none of the files the brief named
(`AGENTS.md`, `docs/gurukul/`, `src/studio/`) and the root `CLAUDE.md` (a file
this session cannot edit as part of its own task) describes a different
product entirely. Nothing had been written yet, so resetting lost no work;
proceeding on the wrong base would have produced a branch the main loop could
not merge into the Rooms platform tree at all.

**Reverses if.** Nothing; this is a one-time environment correction, not a
product decision. Logged so a future session recognizes the failure mode (a
worktree on the wrong branch entirely, not merely behind) if it recurs.

## `ws-r13-migration-076-status-not-asserted-without-corroboration` (2026-09-03)

**Decision.** This docs workstream's own task brief stated migrations
071-076 are applied live. Checked against `#rooms-migrations-applied-live-in-the-union-order`
above, which names only five (072, 074, 073, 075, 071) as confirmed applied
and was logged before migration 076 (`vy_replica_drift_report`, WS-R9) was
even authored — no later `context/` entry records a live apply for 076. Every
doc this workstream touched (`docs/gurukul/ENV-MANIFEST.md` §25,
`docs/gurukul/DEPLOY.md`, `AGENTS.md`, `CLAUDE.md`, `context/STATE.md`,
`docs/gurukul/PRODUCT-JOURNEY.md`) states 071-075 as confirmed and 076 as
"built, stated applied by the brief, no corroborating context entry" rather
than asserting all six flatly.

**Rationale.** `AGENTS.md`'s own law: never claim what you did not run, and
this workstream's own brief said every claim must be traceable to a file in
the tree or a context entry. A task brief is an instruction to act on, not
evidence a future session can point at. Six versus five migrations is exactly
the kind of small drift that compounds if repeated uncritically across seven
documents.

**Reverses if.** A session with `NEON_URL` runs `scripts/relcheck.mjs` or
`EXPLAIN`s a 076 statement against live Postgres and confirms
`vy_replica_drift_report` exists, or the main loop logs its own decision entry
recording the apply directly — at that point every doc this workstream
touched should be updated to say "071-076 confirmed" outright, and this entry
should gain a `supersedes` edge from the one that does it.

## `ws-r13-vercel-build-branch-name-flagged-not-fixed` (2026-09-03)

**Decision.** `scripts/vercel-build.sh`'s selection of `site/vyakti.html` at
`/` depends on `VERCEL_GIT_COMMIT_REF === "claude/gurukul-platform"` as a
literal string match, but the Rooms platform branch has been
`claude/vyakti-cloning-platform-aq05n4` since `#ws-r10-worktree-wrong-base-commit`
confirmed the rename, and `git branch -a` in this tree shows both refs still
existing as distinct branches. `docs/gurukul/DEPLOY.md` now documents this as
a flagged, unverified discrepancy — whether `html-portfolio`'s Vercel trigger
still points at the old name (live no-op) or the new one (a silent fallback to
Meera's landing on that branch, UX-Q-12's exact failure shape one rename
later) — rather than silently repeating the old plan or changing the script.

**Rationale.** This is a WS-R13 docs task, not an authorization to change a
build script that decides what every future Vercel deploy of this branch
serves at `/`. `AGENTS.md`'s honest-states law says to name whose problem this
is rather than guess at a fix outside scope, and a five-minute dashboard check
by whoever owns the Vercel projects resolves it faster and more safely than a
code change guessed at from this worktree.

**Reverses if.** Someone confirms `html-portfolio`'s deploy trigger for this
branch and either updates the string in `scripts/vercel-build.sh` to match, or
confirms it was never wrong in production (a preview-only build, say) — either
way `DEPLOY.md`'s flagged note should be replaced with the resolved fact, not
left standing after it stops being true.

## `rooms-migration-076-confirmed-live` (2026-09-03)

**Decision.** Migration 076 (`vy_replica_drift_report`, WS-R9) is recorded as
applied to the live Neon database, and every document WS-R13 had marked
"built but not confirmed" (`AGENTS.md`, `CLAUDE.md`, `context/STATE.md`,
`docs/gurukul/DEPLOY.md`, `docs/gurukul/PRODUCT-JOURNEY.md`) now says
071-076 outright. Supersedes
`#ws-r13-migration-076-status-not-asserted-without-corroboration`, whose own
reversal condition this is.

**Rationale.** WS-R13 was right to flag it: the wave-two merge applied 076
live but logged only the five wave-one migrations in
`measurements.md#rooms-merge-live-verification-2026-09-03`, so the record
was five-sixths of the fact. The main loop closed it by reading the catalog
back rather than by re-asserting the brief: `pg_class` on the live database
lists `vy_replica_drift_report` with its primary key and the three indexes
the migration file creates (`_latest_ix`, `_inputs_ix`, `_alerts_ix`), see
`measurements.md#rooms-migration-076-live-readback-2026-09-03`. A docs
workstream that refuses to repeat an unlogged claim is doing exactly what
`AGENTS.md` asks; the fix is to log the fact, not to loosen the rule.

**Reverses if.** `scripts/relcheck.mjs` with `NEON_URL` ever fails to find
the table, or the erasure cascade's delete-by-name for it errors live.

## `vercel-build-platform-branch-pattern` (2026-09-03)

**Decision.** `scripts/vercel-build.sh` selects the Vyakti landing at `/` for
`claude/gurukul-platform` OR any `claude/vyakti-cloning-platform-*` ref (a
shell `case` pattern), instead of the single literal it matched before.
Supersedes `#ws-r13-vercel-build-branch-name-flagged-not-fixed`.

**Rationale.** Resolved with the fact WS-R13 asked for rather than a guess:
the Vercel API shows both git-connected projects (`html-portfolio`,
`vyakti-replica-lab`) building this branch as previews only (`target: null`
on their latest deployments), so the literal mismatch never changed what a
production domain served; it did make `html-portfolio` previews of the
platform branch fall back to Meera's landing at `/`, which is the wrong page
for a reviewer opening a Rooms preview. Matching the family by pattern means
the next rename inside it (the branch has already been renamed once,
`#ws-r10-worktree-wrong-base-commit`) does not need a script edit. `STUDIO_ROOT=1`
on the studio project is still honoured first, per the script's own comment.

**Reverses if.** A branch in the `claude/vyakti-cloning-platform-*` family is
ever used for non-Vyakti work, or the two products move to separate repos.

## `ws-r15-first-room-follows-first-clone-shape` — the Room's own one-command script copies first-clone.mjs's reporting shape rather than inventing one (2026-09-03, WS-R15)

**The decision.** `scripts/first-room.mjs` (Phase 0's "hand-build one Room for
one real creator") uses the exact same stage-reporting contract as
`scripts/first-clone.mjs` (`first-clone-is-the-entry-point`): a `record(name,
status, detail)` call per step, a step is `ok` only after a real 2xx with a
real parseable body, and the final action is always a printed table plus a
non-zero exit for any step that did not fully succeed. One addition: a fourth
status, `blocked`, distinct from `fail`, for the one refusal that is an
expected honest state rather than a bug — the Room's publish lock. `stop()`
(new) prints the classed `waiting_on_you` / `waiting_on_us` blocker list from
`api/_room-publish.js` and exits exactly like `die()` does, but the status
word tells a reader "this creator is not ready yet" rather than "the script
broke."

**Rationale.** Two scripts reporting the same class of event two different
ways is a shape a future reader has to re-learn for no reason, and
`first-clone.mjs`'s shape was already proven against live services
(`context/measurements.md#first-real-clone`). The `blocked` status exists
because `context/decisions.md#a-step-is-never-silently-blocked` and the honest-
states law (`AGENTS.md`) both say a locked gate must never look identical to a
platform failure — collapsing it into `fail` would have made every first run
of this script (readiness is locked for every replica today,
`api/_readiness.js` §4) print as if something were broken.

**A second, smaller decision inside the same file.** `--skip-follower` does
not add a `skip` row and does not count against the exit code, while a
follower stage skipped for a MISSING `VYAKTI_FOLLOWER_SESSION` does (one row,
`skip`, non-zero exit) — deliberately diverging from `first-clone.mjs`'s
uniform "any non-ok stage is a non-zero exit" rule. An explicit opt-out is not
a stage that "did not run" in the sense that rule was written for; a missing
credential the caller presumably wanted is.

**Reverses if.** A later script in this family needs a fifth status (a third
kind of "did not fully succeed" outcome) and `ok/skip/blocked/fail` proves too
coarse — extend the enum rather than overload `fail`, the same way `blocked`
was added here instead of overloading it.

## `ws-r12-cohort-week-anchor` — retention is measured per ISO WEEK, not per follower's exact timestamp (2026-09-03, WS-R12)

**Decision.** Migration 077's `vy_room_follower_day` and `api/_room-cohorts.js`
answer "week-six retention of followers who arrived in week one" by grouping
followers into their ISO week of `joined_at` (Monday 00:00 UTC through the
following Monday) and testing every follower in that cohort against the SAME
36-to-42-day window, measured from the cohort's own Monday — not from each
follower's own exact `joined_at` timestamp, which could differ by up to six
days within the same cohort.

**Rationale.** The Rooms plan's own framing is "followers who arrived in week
one", a cohort concept, not a per-person one. A precise per-follower window
would need `f.joined_at` read per row inside the retention query, which is
exactly the kind of column-level read `evals/room-leak/run.mjs`'s
AGGREGATE_ONLY proof exists to refuse for this table's sibling
(`vy_room_follower`) — see `ws-r12-retention-exists-in-select-broke-the-leak-batterys-parser`
in `rejected.md` for the concrete way an attempt at that shape actually broke.
A whole-week anchor keeps every statement a plain `count(*) filter (where
f.joined_at >= $2 and f.joined_at < $3)` against a WHERE-clause range, never a
per-row read, and reports a true property of the cohort (every follower in it
answers the same question over the same seven-day join window and the same
window six weeks out) rather than a false precision the plan never asked for.

**Reverses if.** A later phase of the plan asks for per-follower retention
curves (not per-cohort), or a Room's cohorts are shown to arrive so unevenly
within a week that the week-anchor materially misstates the six-week mark for
followers who joined near a week's edge — in which case the fix is to widen
`vy_room_follower_day`'s read to bind `f.joined_at` per row inside the WHERE
clause (still never in SELECT) and re-derive the AGGREGATE_ONLY proof for the
new statement shape.

## `ws-r12-new-migration-write-gated-on-tableapplied` — roomSay's day-table upsert and roomForget's day-table delete are gated on the migration having landed, injectably (2026-09-03, WS-R12)

**Decision.** Both new touches of `vy_room_follower_day` inside
`api/_room-surface.js` (the upsert in `roomSay`, the explicit delete in
`roomForget`) are wrapped in `if (await isTableAppliedFor(deps)("vy_room_follower_day"))`,
where `isTableAppliedFor` resolves to `deps.tableApplied` if the caller
supplied one, else the real `tableApplied` from `api/memory.js` (a cached
`to_regclass` probe). When the probe answers false (table absent), the write
or delete is skipped; nothing else about the turn or the forget changes.

**Rationale.** This is a case `api/memory.js`'s existing `REPLICA_PERSON_TABLES`
gating pattern was built for but had never actually faced: a table and the
code that touches it shipping in the SAME change, rather than the table
having been live for a prior workstream (`vy_room_follower`/`vy_room_thread`
predate `_room-surface.js`'s own existence, so their explicit deletes in
`roomForget` never needed a gate). Migration 077 is applied by the main loop
AFTER this branch merges (`ws-common.md`'s own description of the pipeline),
so an ungated statement here would 500 every follower's first message, and
every follower's own forget, in the window between the code deploying and the
migration landing — exactly the "make it forget me" deploy-ordering hazard
`api/memory.js`'s own comments already warn about for the account-wide wipe.
Injectable (`deps.tableApplied`) rather than a bare call, so an offline eval
can prove both the write and the skip without a live database — the real
`tableApplied` always resolves false offline (no `NEON_URL`), which would
otherwise make the write path structurally untestable in this environment.

**Reverses if.** Never removed globally — it costs one cached boolean check
per process after the first call and closes a real hazard for every table
this shape ever applies to again. Per table, it stops mattering (though
nothing requires deleting the gate) once that specific migration has been
live long enough that "code deployed ahead of its own migration" is no longer
a credible failure mode for it — the same standing true today of
`vy_room_follower`/`vy_room_thread`'s unconditional deletes.

## `ws-r12-verdict-is-the-oldest-measurable-cohort` — the headline number is week one's cohort, not the newest or the best (2026-09-03, WS-R12)

**Decision.** `verdictFor()` (`api/_room-cohorts.js`) bands the Phase 0/Phase 2
thresholds against the OLDEST cohort that has reached measurability, never
the newest, never the highest-scoring one among several measurable cohorts.

**Rationale.** The plan's own sentence is "week-six retention of followers who
arrived in week one" — the first cohort a Room ever had is the one the gate is
actually about, and reporting a later, larger cohort's more favorable share
instead would let a Room's headline verdict improve just by waiting for a
better week to become measurable while the original question goes
unanswered. Consistent with `no-fake-numbers`: the verdict names WHICH
cohort it is reporting (`cohort_week`) rather than a bare percentage, so a
reader can see it is week one's answer and not a cherry-picked one.

**Reverses if.** The plan itself is revised to ask about the MOST RECENT
measurable cohort (a rolling health check) rather than the original arrival
cohort — a real product question, distinct from the one Phase 0's gate asks.

## `ws-r11-price-and-take-as-data` (2026-09-03, WS-R11)

**Decision.** The follower price (INR 299-599, creator's choice inside the
band) and the platform take (2500 basis points, 25.00%) both live as columns
on `vy_room_price` rather than as deployed constants, and the take rate is
copied onto every `vy_payment_event` row at the moment of the split rather
than re-read from the price row later.

**Rationale.** 071's own argument for `free_monthly_messages` transfers
exactly: "a product decision that lives in a deployed constant moves by
deploy." The take rate needed its own second half of that argument: a
creator's own price CAN change (`setRoomPrice` is a live upsert), so a split
computed from a JOIN at read time would silently reprice every past month's
ledger row the day the take rate itself changes, which is precisely the kind
of retroactive rewrite a financial ledger may not have. Copying the rate at
insert time is what makes `vy_payment_event` actually append-only in the way
its own header claims.

**Reverses if.** The platform ever needs a per-owner or per-tier take rate
(volume discounts, say) - the column is already there to hold it, so nothing
about the shape changes, only who is allowed to set it.

## `ws-r11-provider-seam-and-secret-reuse` (2026-09-03, WS-R11)

**Decision.** Two twin provider modules (`api/_payments/providers/razorpay.js`,
`fake.js`), selected by `PAYMENTS_PROVIDER` (default `none`, which refuses
every write with a named reason before any provider is called). The
`razorpay` provider's credential comes from `api/_channel-secrets.js`'s
existing backend seam under one fixed, well-known ref
(`PAYMENTS_SECRET_REF`) rather than a new secret store; the `fake` provider
reads three plain env vars instead, deliberately bypassing that seam so a
staging deployment or an offline eval never needs an Azure account to prove
every line of `api/_payments.js`.

**Rationale.** `credential-ref-not-credential` (context/decisions.md,
2026-08-26) already made the case for a channel's own credential: "a live
credential... structurally cannot sit in a table the routing path selects,
joins and logs." A platform-level Razorpay key/secret pair is the identical
shape of problem one level up - live, real, and never printed - so it goes
through the SAME refusal-by-default seam rather than a second one invented
for this file. One ref rather than one per room, because every Room shares
the ONE platform Razorpay account.

**Reverses if.** A future payment provider needs more than one opaque secret
value that this ONE JSON-blob-under-one-ref shape cannot express cleanly (a
key pair with independent rotation schedules, say) - then the seam needs a
shape, not a string, the same reversal condition `credential-ref-not-credential`
already names for the channel case.

## `ws-r11-subscription-survives-forget-until-terminal` (2026-09-03, WS-R11)

**Decision.** `vy_room_subscription` is listed in `api/memory.js`'s
`PERSON_TABLES` (satisfying `scripts/relcheck.mjs`'s manifest-coverage check
honestly, since it genuinely is a record of a person) but is NOT wiped by
`api/_room-surface.js`'s narrow, per-Room `roomForget` (it carries no
`agent_id`, so `roomScopedTables()`'s `agent === true` filter never reaches
it). It IS reached by the account-wide "forget everything" pass
(`purgeRelational`, lane "relational") - but only rows whose `state` has
already reached `cancelled` or `expired` (`wipeWhere: "state in
('cancelled','expired')"`). A live, non-terminal subscription survives even a
full account wipe.

**Rationale.** A UPI Autopay mandate keeps debiting a real bank account
whether or not this table still names it. Deleting the local pointer to a
LIVE mandate is not privacy, it is losing the only record that a real,
continuing financial obligation exists - the same class of harm
`context/rejected.md`'s `silent-truncation` names one surface over: it works,
the delete returns 200, and a fact that mattered is gone. Forgetting what an
AI remembers about a follower ("this room's own memory") is a different
request in kind from forgetting that they owe, or paid, money, and this
migration keeps the two doors separate: the Room's own forget button cannot
reach a subscription at all; only the account-level wipe can, and even it
must wait for the subscription to reach a state where nothing is still
being charged.

**Reverses if.** Phase 1 wires an automatic provider-cancel into the
account-wipe path (call `provider.cancelSubscription` for every live row
before deleting it) - at that point the `wipeWhere` restriction can be
dropped, because the mandate itself, not just this table's record of it,
will actually be gone.

## `ws-r11-creator-payout-owner-scoped-erasure-imprecision` (2026-09-03, WS-R11)

**Decision.** `vy_creator_payout` carries `owner_user_id` and no `room_id` or
`replica_id` (a payout is a roll-up across every room one owner has), so its
erasure-job delete (`api/_replica-full-erasure.js`) is scoped by
`owner_user_id` alone. An owner with more than one live replica who erases
ONE of them would also clear payout history earned by their OTHER,
still-active replica.

**Rationale.** No column on this table can express a narrower scope without
changing what a payout roll-up MEANS (it is deliberately an owner-level
aggregate, not a per-room one, because the platform take is "shown as one
number" per the Rooms plan's own line). `scripts/relcheck.mjs`'s owner-lane
check only requires the row be reachable by name, which it is; the
imprecision is real and is logged here rather than silently accepted,
per `context/STATE.md`'s own standing rule against implying coverage that
was not measured.

**Reverses if.** A creator with more than one live, monetized Room becomes a
real case (today none does) - at which point `vy_creator_payout` needs a
`replica_id` column and the roll-up (`runPayoutRollup`) needs to group by it
too, and this erasure delete narrows to match.

## `ws-r11-tds-rate-defaults-to-zero` (2026-09-03, WS-R11)

**Decision.** `runPayoutRollup`'s `tdsRateBp` parameter defaults to 0
(`TDS_RATE_BP_DEFAULT`). No withholding is applied to a payout unless a
caller explicitly passes a rate.

**Rationale.** Nobody - not this workstream, not the owner - has decided
what India TDS treatment applies to a creator's Room earnings on this
platform. Guessing a percentage (10% under Section 194J is the closest real-
world analogue, but is not a decision anyone here is authorized to make)
would be exactly the fabricated number `context/STATE.md`'s no-fake-numbers
law exists to forbid, applied to a tax line rather than a fidelity score.
Zero is not a claim that no tax is owed; it is the honest absence of a
decision, visible on every payout row as `tds_inr: 0` rather than hidden
behind a plausible-looking rate nobody chose.

**Reverses if.** The owner (or, in a real deployment, a tax advisor) sets an
actual rate - at which point `runPayoutRollup`'s caller passes it, and this
default stops mattering for any row computed after that.

## `ws-r16-memory-consent-required-at-optin` (2026-09-03, WS-R16)

**Decision.** `optIn` (api/_checkins.js) refuses a follower whose
`memory_consent_at` is null (`room_checkin_memory_required`, 409). No
check-in row this file ever writes can exist for a memory-declined follower.

**Rationale.** A due check-in becomes a message in the follower's own
private thread (the workstream brief's own law #4), which requires a
server-side episode for the sweep to write into. `roomSay`'s memory-declined
path works around the same absence by carrying the transcript on the
CLIENT and binding it with a signed digest - a mechanism that exists
because there is a live HTTP response to hand the new digest back on. A cron
tick has no live response and no client to hand anything to, so that
mechanism has no analogue here. Refusing at opt-in (a clear, immediate,
named error) was chosen over silently accepting the row and having the
sweep's skip-log query catch it forever at delivery time, which would be a
control that looks like it works and never fires the intended action -
`context/rejected.md`'s `sound-gate-proved-by-silence` shape one product
surface over.

**Reverses if.** A future workstream gives the sweep its own durable,
ephemeral transcript store independent of `vy_episode` (so a memory-declined
follower's check-in replies could exist without ever being retained past
delivery) - at which point this refusal narrows to "no persistent record",
not "no check-in at all", and `optIn`'s predicate changes with it.

## `ws-r16-checkin-dst-transition-instant` (2026-09-03, WS-R16)

**Decision.** `computeNextDue`'s two-pass offset resolution
(`zonedTimeToUtcMs`, api/_checkins.js) is not corrected for a local time that
falls inside a DST spring-forward's skipped hour (e.g. 02:30 local on the
day America/New_York jumps from 01:59:59 to 03:00:00). Verified by direct
measurement: a daily 02:30 schedule crossing that exact transition resolves
to 01:30 EST (an hour early) rather than throwing or rolling forward to
03:30 EDT.

**Rationale.** The two-pass convergence assumes the local wall-clock time
named by the schedule actually exists on the candidate date, which is true
for both of a DST fall-back's TWO occurrences of an ambiguous hour (it just
picks one, which is a smaller and more defensible gap) but false for a
spring-forward's ONE skipped hour, which has no UTC instant to resolve to at
all. A daily 09:00 schedule (never near either transition boundary for any
zone this product ships to) was measured correct on both sides of the same
2027-03-14 transition (`evals/checkins/run.mjs` §1), so this is a narrow,
named gap rather than a general DST failure.

**Reverses if.** A creator or follower ever picks a `local_time` that lands
in a real transition's skipped hour for their `timezone` and this is
observed to matter (a wrong delivery hour once a year, at most, for the
handful of zones and schedules where this is even possible) - at which
point `zonedTimeToUtcMs` gets an explicit check (does the candidate y/m/d/hh/mm
round-trip through the zone unchanged?) and rolls forward to the first
existing instant rather than silently returning a wrong one.

## `ws-r16-checkins-owner-lane-explicit-not-cascade` (2026-09-03, WS-R16)

**Decision.** `vy_room_checkin_design`, `vy_room_checkin` and
`vy_room_checkin_delivery` are all deleted BY NAME in
`api/_replica-full-erasure.js`, even though all three carry a real
`references vy_room(room_id) on delete cascade` that would remove them for
free the moment `vy_room` itself is deleted in the same job.

**Rationale.** `scripts/relcheck.mjs`'s owner-lane erasure-reach walk only
follows `ON DELETE CASCADE` edges starting from `vy_replica` itself; `vy_room`
has no real FK to `vy_replica` (009's convention: owner/replica columns are
FK-shaped but never FK-constrained), so nothing cascading from `vy_room`
is "reached" by that walk at all - it is `vy_room`'s own precedent restated
a third time (071's `vy_room_thread`/`vy_room_follower`, 078's three money
tables), and the walk's own header names exactly this as the reason it
exists: three real tables were once reachable by neither cascade nor name
and survived a live erasure job.

**Reverses if.** `relcheck.mjs`'s walk is ever widened to also start from
every OWNER-KEYED table with no FK to `vy_replica` (treating them as
additional cascade roots) - at which point the explicit deletes here become
provably redundant rather than load-bearing, and could be removed with the
walk itself as the proof they are safe to.
