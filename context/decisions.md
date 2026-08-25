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
