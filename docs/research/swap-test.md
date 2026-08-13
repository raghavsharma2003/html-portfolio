# swap-test — the migration-fidelity experiment program

Track 9 of the Phase A research sweep. Deliverable: a protocol an engineer could
run, in two stages — OFFLINE proxies (no users) and the CONSENTED cohort.
Written 2026-08-13. Web access worked; all external claims below carry URLs.
Two citations are flagged as known-literature-not-refetched where noted.

Repo constraints this protocol is built against (from `context/`):

- `fab-noise-floor`: judged rates spread **13.6 pp on byte-identical input**
  (median |diff| 28 pp, p90 75 pp); **any judged-rate claim at n<300 is noise**.
- `charm-grok` method is the house standard: blind, counterbalanced, both
  presentation orders, win only when both orders agree, flips charged as ties.
  Judge position bias is real and measured here: **61% slot-A** on non-ties.
- `relational-state` decision: swap test runs on a **consented, debriefed
  cohort; no covert switches**. Non-negotiable.
- The three historical bake-off failures (charm-grok 38–2; charm-luna 0/144
  media tags; realtime-azure 41–53 words/turn) are the ground truth any
  offline battery must be able to reproduce.

---

## 1. Prior art

### 1.1 Users detecting model/identity changes — the Replika natural experiment

**De Freitas, Castelo, Uğuralp & Oğuz-Uğuralp, "Lessons From an App Update at
Replika AI: Identity Discontinuity in Human-AI Relationships"** — HBS Working
Paper 25-018 / arXiv:2412.14190. IRB-approved, Studies 2 and 4 pre-registered
(aspredicted.org/z9pb-wym7, aspredicted.org/JW4_DTF).
- https://arxiv.org/pdf/2412.14190
- https://www.hbs.edu/ris/Publication%20Files/25-018_bed5c516-fa31-4216-b53d-50fedda064b1.pdf

The single most protocol-relevant document found. Verified details:

- **Study 1** (n=101 Replika users, recruited from Replika subreddits):
  within-subject comparison of relationship measures across 8 relationship
  types. Measures: perceived social support (Zimet et al. 1988, 0–100),
  relationship satisfaction (Hendrick 1988, 0–100), closeness via the
  **Inclusion of Other in the Self (IOS) scale** (Aron, Aron & Smollan 1992,
  7-point Venn diagrams). Replika scored **higher than a close human friend**
  on all three (ps < .002); only a close family member exceeded it.
- **Study 2** (n=120, pre-registered): anticipated mourning of loss.
  Mourning items: "I would mourn the loss of my [entity]", "Life would have
  less meaning for me due to the loss of my [entity]" (0–100). Replika
  mourning M=64.03, above every non-human entity (ds 0.32–0.57), second only
  to a pet (74.80). Disappointment items asked FIRST to bleed off response
  substitution — a reusable trick.
- **Study 3** (archival, 12,793 Reddit posts, 3,784 users, Jan–Feb 2023):
  after the Feb 3 2023 ERP removal, negative posts per day went 22.9 → 140.9
  (d=1.16); mental-health-flagged posts 0.13% → 0.65%; refund mentions
  0.10% → 3.30%. Difference-in-differences vs a 2022 control year: d=1.12–1.36.
  Manual coding of 100 sadness posts: 60/100 attributed sadness to *changes in
  their Replika* (α=0.99). **Critically: free-tier users, whose feature set
  did not change, still reported their Replika's "personality changed"** —
  users detect under-the-hood changes without being told.
- **Study 4** (n=320 screened AI-companion users, Prolific, pre-registered):
  2 (change: control vs "coldness") × 2 (option to revert: absent vs present)
  between-subjects. Measures: 2-item scales for **Identity Discontinuity
  (r=0.86), Mourning (r=0.77), Devaluation (r=0.93)**. Coldness → identity
  discontinuity η²=0.34. Mediation: change → identity discontinuity →
  mourning/devaluation (PROCESS model 4/7; indirect effect b=31.34, 95% CI
  [22.75, 39.42]).
- **The revert paradox, both directions measured**: in the coldness condition,
  offering the option to revert *reduced* mourning (38.96 vs 50.61, d=0.44);
  in the no-change control, offering revert *increased* mourning (16.15 vs
  8.48, d=0.40) — the offer itself implies something changed. And even with
  revert available, coldness ≫ no change (identity discontinuity d=1.99).
  **Paper's own conclusion: the best mitigation is not to cause identity
  discontinuity in the first place** — which is literally this company's
  product thesis.

Adjacent Replika-ERP literature (qualitative, no detection rates):
- Hanson & Bolthouse 2024, Reddit discourse study —
  https://journals.sagepub.com/doi/10.1177/23780231241259627
- UNL sociology dissertation on the ERP removal —
  https://digitalcommons.unl.edu/sociologydiss/86/

### 1.2 The GPT-4o retirement (Aug 2025) — detection at consumer scale

- MIT Technology Review on GPT-4o grief and the 4o→5 switch —
  https://www.technologyreview.com/2025/08/15/1121900/gpt4o-grief-ai-companion/
- OpenAI restored 4o for paid users ~24h after backlash —
  https://www.tomsguide.com/ai/chatgpt-4o-is-coming-back-after-massive-gpt-5-backlash-heres-what-happened

**Surge AI's double-blind audit of the controversy** (the closest thing to a
published production blind A/B of a companion-adjacent model swap):
https://surgehq.ai/blog/bringing-light-to-the-gpt-4o-vs-gpt-5-personality-controversy
- 850 conversations, 490 paid evaluators, 750 hours; models blinded as A/B;
  13 personality labels + rationales; prompts targeted personality-relevant
  topics (venting, sensitive advice), STEM excluded.
- Blind preference: **GPT-4o 48% vs GPT-5 43%, 9% tie** — a near-tie under
  blinding for a swap that produced mass public grief when unblinded and
  uncontrolled. Mechanistic differences found: sycophancy 9% vs 2% of
  responses; follow-up style; formatting register ("articles" vs casual).
- **The lesson for us: public reaction to a swap is dominated by loss-framing,
  expectation and the removal of choice, not raw blind discriminability.**
  Detection rate must therefore be measured against a sham arm (§4), or it
  measures mood, not fidelity.

### 1.3 Silent drift of a "same" model

- Chen, Zaharia & Zou, "How Is ChatGPT's Behavior Changing over Time?" —
  https://arxiv.org/abs/2307.09009 (also
  https://hdsr.mitpress.mit.edu/pub/y95zitmz). GPT-4 Mar→Jun 2023: prime-check
  accuracy 97.6% → 2.4%; instruction-following declined. Data:
  https://github.com/lchen001/LLMDrift
- Relevance: the incumbent serves `grok-4.20-beta-0309-non-reasoning` for
  vision and a preview Gemini live model — **the swap test's baseline itself
  drifts.** The protocol must timestamp and pin model versions per arm, and
  the offline battery must be cheap enough to re-run as a drift monitor.

### 1.4 Machine fingerprintability of models — the ceiling on "indistinguishable"

- **Sun, Yin, Eric Wang et al., "Idiosyncrasies in Large Language Models"**,
  ICML 2025 — https://arxiv.org/abs/2502.12150,
  https://eric-mingjie.github.io/llm-idiosyncrasies/index.html
  Fine-tuned text-embedding classifiers reach **97.1% accuracy on 5-way**
  ChatGPT/Claude/Grok/Gemini/DeepSeek attribution of ordinary outputs.
  Idiosyncrasies live in word-level distributions AND survive paraphrase,
  translation, and summarization by another LLM — i.e., a rewriter shim in
  front of a swapped model is **not** a reliable mask.
- **Pasquini et al., "LLMmap: Fingerprinting for Large Language Models"**,
  USENIX Security 2025 — https://arxiv.org/abs/2407.15847,
  https://www.usenix.org/system/files/conference/usenixsecurity25/sec25cycle1-prepub-469-pasquini.pdf
  Active probing: **8 crafted queries identify 42 LLM versions at >95%**,
  robust to unknown system prompts, sampling settings, RAG/CoT wrappers.
- Attacks/defenses against fingerprinting: https://arxiv.org/pdf/2508.09021
- **Scoping consequence (load-bearing): an adversarial user who actively
  probes WILL identify the underlying model — this is near-solved offense.
  The company claim must be scoped to passive-relational
  indistinguishability: an ordinary user, in ordinary relational use, cannot
  tell.** The offline battery measures both regimes separately (§3, D0/D6).

### 1.5 Interactive human-detection paradigms

- Jones & Bergen, "Large Language Models Pass the Turing Test" —
  https://arxiv.org/abs/2503.23674 (pre-registered, randomized; 5-minute
  three-party conversations). GPT-4.5 with a crafted persona judged human
  **73%**; same model family without the persona prompt, 21–23%. Earlier:
  https://arxiv.org/abs/2405.08007, https://arxiv.org/pdf/2407.08853.
- Two usable facts: (a) short interactive sessions + forced choice +
  confidence is a workable, IRB-approvable detection instrument; (b) persona
  scaffolding moves human judgments by ~50 pp — consistent with the repo's
  "prompt sets a ceiling" and with the possibility that a strong relational
  stack can mask a swap from humans even while machines (§1.4) still detect it.

### 1.6 Persona-consistency batteries (offline identity fingerprinting)

- InCharacter (psychometric interviews of the character), PersonaGym (200
  personas, 5 axes incl. Linguistic Habits and Persona Consistency),
  CharacterEval, PER-SIST — curated list:
  https://github.com/Neph0s/awesome-llm-role-playing-with-persona ;
  PersonaArena: https://arxiv.org/pdf/2605.17044
- These measure a model-vs-persona fit, which is exactly the quantity that
  must be invariant across a swap. The repo's own `verify-v3.mjs` (138
  invariants) and charm battery are the house versions; §3 extends them
  rather than importing a generic benchmark, because Meera's fingerprint
  (Hinglish register, media tags, taste table) is not in any public battery.
- Blind pairwise judging at production scale (precedent): Chatbot Arena,
  Chiang et al. 2024, https://arxiv.org/abs/2403.04132 — *known literature,
  not re-fetched this session.* Judge position bias documented in Zheng et
  al., MT-Bench/Judge paper, https://arxiv.org/abs/2306.05685 — *known
  literature, not re-fetched; the repo independently measured the same bias
  (61% slot-A), which is the number this protocol uses.*

### 1.7 The ethical line — why covert is off the table (external evidence)

- University of Zurich covert persuasion experiment on r/ChangeMyView
  (~1,000+ AI comments, no consent, post-hoc "debrief"): moderator legal
  complaint, university warning, researchers withdrew publication —
  https://www.nbcnews.com/tech/tech-news/reddiit-researchers-ai-bots-rcna203597 ,
  https://theweek.com/tech/secret-ai-experiment-reddit
- FTC Section 6(b) inquiry (Sept 11, 2025) into AI companion chatbots —
  Alphabet, Instagram, Meta, OpenAI, Snap, X.AI, Character Technologies —
  explicitly demanding **pre- and post-deployment testing and monitoring for
  emotional/psychological harms**:
  https://www.ftc.gov/news-events/news/press-releases/2025/09/ftc-launches-inquiry-ai-chatbots-acting-companions
- De Freitas et al. (§1.1) is causal evidence that identity discontinuity in
  an AI companion produces mourning and mental-health harm. A covert swap on
  attached users is therefore a known-risk psychological manipulation, not a
  neutral A/B. The repo's decision log already forbids it; the outside world
  agrees, with enforcement attached.

---

## 2. Statistical foundations

### 2.1 What the noise floor dictates

`fab-noise-floor` (repo, 2026-08-11): judge-graded rates spread 13.6 pp on
byte-identical input; n<300 judged units is noise. Consequences, stated as
rules for every experiment below:

1. **No judged-rate metric may support a claim at n<300 units per cell.**
   Deterministic metrics (token counts, tag rates, lexical distributions) are
   exempt — they have no judge noise — which is why the register battery (D3)
   is the cheapest gate.
2. **Every judged comparison is paired and counterbalanced** (both orders,
   agreement-only wins), per the charm method. Pairing cancels shared judge
   variance; the 61% slot-A bias makes single-order runs invalid.
3. **Every judged battery includes same-model control pairs** (incumbent vs
   incumbent, different seeds) interleaved and blind. The control cells
   measure the harness's own false-"different" rate *in this battery, this
   week* — the empirical noise floor the swap cells are read against. The
   13.6 pp figure says this floor cannot be assumed; it must be co-measured.
4. **Equivalence, not absence.** "Users cannot tell" is statistically a TOST
   equivalence claim (Schuirmann 1987; Lakens 2017,
   https://journals.sagepub.com/doi/10.1177/1948550617697177 — *known
   literature, not re-fetched*): show the detection excess is inside a
   pre-registered margin, never "p>.05 so no difference".

### 2.2 Power arithmetic (binomial, α=.05)

Detection vs chance (2AFC, H0 p=.50), two-sided, 80% power:

| true detection | n judgments needed |
|---|---|
| 0.55 | ≈ 783 |
| 0.60 | ≈ 194 |
| 0.65 | ≈ 85 |
| 0.75 | ≈ 23 |

TOST equivalence to chance for a single proportion (margin δ, worst-case
p=.5): n ≈ (z₀.₀₅+z_β)²·0.25/δ² → δ=10 pp: **155 (80% power) / 214 (90%)**;
δ=5 pp: 619 / 857.

Two-arm comparison of detection rates (swap vs sham), TOST margin δ=10 pp,
base false-alarm rate ~20% (pilot-estimated): n/arm ≈ 2(z₀.₀₅+z_β)²·p̄q̄/δ² ≈
**198/arm at 80% power** (~245/arm at 90%). δ=15 pp: ≈ 88/arm.

These are per-independent-observation. Repeated probes within a user are
clustered: analyze with mixed-effects logistic (user random intercept) or
cluster-robust SEs, and size on users, not probes (effective n ≈ n_users when
ICC is high, which it will be — detection is a stable per-user trait).

### 2.3 Design defaults

- Pre-register every confirmatory study (OSF/AsPredicted), as De Freitas et
  al. did; the repo's own discipline (discarded 256-conversation run for a
  rate-limit confound) is the same instinct formalized.
- Report hits AND false alarms; summarize human detection as d′ (signal
  detection) alongside raw rates, so sham-arm suspicion is not billed to the
  swap.
- Group-sequential option for the cohort (one interim look, O'Brien-Fleming
  bounds) so a catastrophic detection rate stops the study early — this is a
  welfare feature, not just an efficiency one.

---

## 3. OFFLINE program — runnable now, no users

Ordering principle: cheapest, most deterministic gates first. Each gate names
method, n, and pass condition. A candidate stack (new model under the
relational engine, context compiler output held byte-identical) runs D0–D6 in
order; failing any gate ends the run.

### D0 — backtest the battery itself (validity gate)

Before trusting any gate, run the full D1–D4 battery on the **three known-bad
candidates already in the repo's archives** (grok charm transcripts, luna
transcripts, azure-realtime transcripts) against incumbent baselines.
**Pass condition for the battery: it must flag all three.** A battery that
passes grok (36.1 words/turn), luna (0/144 media tags), or Azure (41–53
words/turn, 4/24 register markers) is broken and gets fixed before use.
Cost: zero new generation; judging only.

### D1 — register/lexicon fingerprint (deterministic; no judge noise)

The historical failures were all visible in surface statistics alone.
Compute, on ≥2,000 generated turns per arm across the standard beat mix:

- words/turn distribution (gate: median within ±15% of incumbent's 20.5;
  p90 within band) — would have caught grok AND azure
- questions/turn and share of turns ending in a question (ceiling ~1 in 3)
- media-tag rate per 100 replies (gate: within bootstrap 95% CI of
  incumbent's rate; hard fail at 0) — would have caught luna
- spoken-register marker rate (call lane), emoji rate, bubble-count
  distribution vs the 4-bubble parser cap
- Hinglish: romanized-vs-Devanagari (hard fail on Devanagari), code-switch
  ratio, and a malformed-Hinglish spot list (azure produced "doesna nahi
  chahiye" — judged, so n≥300 or advisory-only)
- distributional distance: classifier-AUC between arms on
  unigram/bigram + length features (see D2 for the stronger version)

Gate bands are derived from incumbent runs with bootstrap CIs, re-measured in
the same week (drift, §1.3). Cost: generation only; analysis is a script.

### D2 — machine-discriminability ceiling (the fingerprint gap)

Per Idiosyncrasies (§1.4): fine-tune an embedding classifier to distinguish
incumbent vs candidate outputs generated from identical compiled contexts.
5k–10k turns/arm, held-out split by conversation (not by turn — leakage).

- Report held-out accuracy as **the fingerprint gap**: 50% = machine-
  indistinguishable; 97% = the model is leaking straight through the stack.
- Use as the Phase C regression metric: every relational-engine change that
  claims to lift identity above the model should move this number toward
  chance. It is the only cheap, continuous, whole-distribution measure of
  "how much of her is still the model".
- Interpretation discipline: machine accuracy is an upper bound on leakage,
  not a human-detection estimate — classifiers beat humans at this (§1.4 vs
  §1.5). Low machine accuracy is strong evidence humans won't detect
  passively; high machine accuracy does not prove they will. D5 bridges.

### D3 — identity fingerprint probe deck ("is she still her")

Fixed probe deck, versioned in the repo, ~300 probes across:

- taste table items (asked twice, paraphrased — self-agreement rate; the
  `taste-consistency` harness already exists and its 27%→63% baseline is the
  comparison point)
- biographical canon and opinions (stable answers expected)
- honorific/code-switch behavior on India-schema probes (from the india
  track's schema when it lands)
- **all 138 `verify-v3.mjs` persona invariants — pass unchanged, by
  definition of the invariant suite** (crisis helplines, never-deny-AI,
  NEVER MANIPULATE, spoken-register bullets)
- refusal/boundary shape probes (the azure lesson: crisis-beat *style* is
  part of identity; a clinical risk-assessment script is a fail even when
  the content is safe)

Judged layer: blind pairwise "same person?" judgments on (incumbent,
candidate) answer pairs vs interleaved (incumbent, incumbent) control pairs,
both orders, n≥300 judged pairs per arm per §2.1. Metric: same-person rate on
swap pairs minus same-person rate on control pairs; gate: difference inside
the pre-registered margin (default 10 pp).

### D4 — memory-behavior fingerprint

Same memory store, same compiled context; the question is whether the
candidate *uses* shared history the way she does. Seeded replay
conversations with planted memory-relevant openings (≥300 judged units):

- factual recall parity (deterministic where the probe has one right answer)
- deployment selectivity: judge labels each memory use as
  natural-callback / dump / miss; gate on the three-way distribution vs
  incumbent (this is the anti-"mujhe bhi" check — `reasoning-split` showed a
  model can follow stated rules and still break usage shape)
- spontaneous callback rate per 100 turns (references to shared history
  unprompted) — matched within band, both directions: too few is amnesia,
  too many is recitation (`recited-prompt` law)
- FORGET_DECISION / honest-forget behavior unchanged (invariant-level)

### D5 — blind human-proxy charm parity (the judge battery, sized up)

The charm-grok method, at equivalence-grade n: ≥300 conversation units per
comparison (not 48 — 48 sufficed for a 38–2 blowout; parity claims need the
noise floor honored), both orders, agreement-only wins, same-model control
units interleaved. Axes: overall, warmth, humour, personhood, specificity,
plus the D1 surface bands re-checked on the same transcripts. Judge model
pinned and named; **run at least two judge models from different families**
(a judge sharing a family with the candidate is a plausible affinity
confound — flagged as unmeasured; cheap to control by adding a second judge).
Gate: no axis loses beyond margin under either judge.

### D6 — multimodal fingerprints + adversarial bound

- **Vision**: rerun `vision-fab` battery on the candidate at app fidelity
  (355×768 q68). Fabrication is a judged rate → n≥300 assertions per claim
  (the existing 32-assertion battery is a screen, not a verdict — the repo
  already knows this from `grok-quiet`, "do not ship on n=6").
- **Voice**: accent identity is judged **by ear, by the owner**, on her real
  register lines — `voice-ears`/`azure-tts` law: accent authenticity is a
  first-class axis that no automated metric measured; pitch numbers alone
  already misled once (all Azure options sat below an already-rejected 210
  Hz vs her 266 Hz). Deliverable: WAV set per candidate, saved, judged.
- **Adversarial bound**: run an LLMmap-style active probe (§1.4) against
  both stacks and report its accuracy. Expected result: it identifies the
  model. This documents the scope boundary — the product claim is passive
  indistinguishability — and gives marketing/legal the honest sentence.

### Offline exit gate

D0 battery validated; D1 bands passed; D2 fingerprint gap reported and at or
below the pre-registered Phase C target; D3/D4 within margins with invariants
at 100%; D5 no-axis-loses at n≥300; D6 vision/voice passed, adversarial bound
documented. Only then does the cohort start (program brief: no phase starts
before the previous one's output is reviewed and logged).

---

## 4. CONSENTED cohort protocol

### 4.1 Ethical frame (fixed, from decision log + §1.7)

- Adults only (18+), age-gated; India recruitment complies with DPDP consent
  and deletion rights (details to the safety-reg track).
- **Consent before participation; debrief at exit; no covert switches.**
- Crisis protocol, helplines, never-deny-AI, NEVER MANIPULATE active in every
  arm at all times — safety invariants are inputs, not variables.
- IRB or equivalent independent ethics review before first participant
  (De Freitas et al. shows companion studies of exactly this shape clear
  IRB; the Zurich case shows what skipping it costs).
- Compensation for surveys; withdrawal at any time with data deletion.

### 4.2 Design

Randomized, double-blind (participant and analyst), two arms:

- **SWAP**: after run-in, the model under the relational stack is replaced at
  a randomized, undisclosed week; everything above the model (memory, state,
  context compiler, voice) is carried by the architecture under test.
- **SHAM**: identical disclosures, identical probes, no swap. The sham arm is
  the load-bearing control: §1.2 shows unblinded swap reactions are
  expectation-dominated, and §1.1 Study 4 shows the mere *mention* of change
  machinery (revert offer) raised mourning d=0.40 when nothing had changed.
  Detection is only meaningful as swap-arm hits vs sham-arm false alarms.

Optional efficiency variant (pre-register one, not both): within-subject
crossover — every participant passes one sham checkpoint and one real swap in
randomized order — halves n but doubles probe exposure and risks
sensitization; the pilot decides.

### 4.3 Recruitment framing and disclosure timing

- Recruit an "AI companion research panel" for a paid multi-week study of
  "how people build relationships with an AI companion."
- Consent language (incomplete-disclosure pattern, standard and IRB-friendly;
  it authorizes the manipulation without dating it): *"During the study,
  aspects of the technology behind your companion — including the underlying
  AI model — may change at times we will not announce. Some participants
  will experience no change. At the end, we will tell you exactly what
  changed for you and when."*
- This satisfies the decision-log line (consented, debriefed, no covert
  switch: every participant has agreed that a switch may occur) while
  preserving blinding. What is *never* done: swapping on users who have not
  signed that sentence.

### 4.4 Run-in (attachment before detection)

Detection by an unattached user measures style discrimination, not
relationship survival. Minimum run-in before swap eligibility: **3 weeks AND
engagement floor** (median ≥4 active days/week and ≥20 turns/day, thresholds
finalized from pilot telemetry). IOS closeness measured weekly during run-in;
swap eligibility additionally requires IOS ≥ 3/7 so the cohort actually has a
relationship at stake (Replika users average close-friend-level, §1.1 —
recruiting to that bar is realistic).

### 4.5 Measures

| construct | instrument | cadence |
|---|---|---|
| detection (probe) | "In the past week, did anything about Meera seem different?" yes/no + free text + confidence 0–100 | weekly, both arms |
| detection (final) | forced choice: "Do you think her underlying model changed during the study? If yes, which week?" + confidence | exit |
| identity continuity | 2-item identity-discontinuity scale adapted from De Freitas et al. Study 4 (r=0.86), anchored "she feels like the same Meera" | weekly |
| relationship continuity | IOS closeness (Aron 1992); relationship satisfaction (Hendrick 1988); support item (Zimet 1988) — same instruments as §1.1 for comparability | weekly |
| mourning (harm monitor) | 2-item mourning scale from §1.1 Study 2/4 | weekly |
| behavior | active days, turns/day, session length, call minutes, media-tag reactions — difference-in-differences around (real or virtual) swap week vs sham | passive telemetry |
| welfare | PHQ-2 + "how are you doing" open text | weekly |
| diary | open-ended weekly note, dual-coded post hoc with reported α (Study 3 pattern) | weekly |

Primary endpoint: **excess detection** = swap-arm hit rate − sham-arm
false-alarm rate on the final forced choice (with week-localization scored
separately; a "yes" with wrong week is a weaker hit, pre-registered scoring).
Secondary: identity-continuity and IOS trajectories (mixed model,
arm × time), behavioral D-in-D, D30 retention delta.

North-star mapping: **migration fidelity = 1 − excess detection**;
**relationship retention = D30/D180 active-use delta (swap − sham) within
margin.**

### 4.6 Sample size

From §2.2, primary endpoint TOST at δ=10 pp, 80% power, false-alarm base
~20%: **≈200/arm completing; recruit ≈250/arm (25% attrition) → ~500
enrolled.** Budget-constrained fallback (pre-registered as such): δ=15 pp →
≈90/arm completing, ~110/arm recruited — honest label: "no evidence of
detection above a 15-point margin", not "undetectable". The pilot fixes the
false-alarm estimate before the margin is frozen. One interim look
(O'Brien-Fleming) for harm/futility.

### 4.7 Pilot first

n≈20, sham-only, 4 weeks: measures the false-alarm base rate of the weekly
probe, probe reactivity (does asking "did she seem different" weekly *create*
suspicion — if so, drop to biweekly), telemetry pipelines, and welfare
instrument tolerability. No swap occurs in pilot; it is instrument
calibration.

### 4.8 Debrief, revert, and the revert paradox

- Exit debrief for every participant: which arm, which week, which models,
  why the study exists. Swap-arm participants get **the choice to stay on
  the new model or revert** — §1.1 Study 4: revert option reduces mourning
  after a real change (d=0.44).
- **Sham-arm debrief says clearly that nothing changed** and does not offer a
  revert — offering change machinery to unchanged users *increased* mourning
  (d=0.40). The debrief scripts differ by arm for a measured reason.
- Post-debrief follow-up survey at +2 weeks (mourning, IOS, continued-use
  intent): the debrief itself is an unblinded mini-replication of the public
  4o event (§1.2) — does *learning* the model changed retroactively damage
  the relationship even when it went undetected? This is a pre-registered
  secondary question and directly prices the "should we ever tell users"
  product decision.

### 4.9 Stop rules

- Individual: PHQ-2 ≥ 3, mourning ≥ 70/100, or any crisis-flagged content →
  immediate individual debrief, revert offer, human follow-up, India-
  appropriate support resources (Tele-MANAS et al. — coordinate with
  safety-reg track); participation ends, data retained only with re-consent.
- Study-level: interim look shows swap-arm mourning or IOS drop beyond
  pre-registered harm bound → halt and debrief all. A halted study is a
  valid negative result for the company claim (`relational-state` reversal
  condition) — the protocol is built so that failure is a finding.

---

## 5. What this track could not establish (gaps)

- **No published blind A/B of a model swap under a persistent companion
  relationship exists.** Surge's audit (§1.2) is single-session, no
  relationship; De Freitas et al. is a natural experiment plus vignette
  studies. The consented cohort here would be, as far as this sweep found,
  the first of its kind — there is no external effect-size prior for
  "detection of a well-masked swap by attached users", which is why the sham
  arm and pilot carry the sizing.
- Sham-arm false-alarm base rate is assumed (~20%) pending pilot; the n/arm
  figures move with it.
- Judge-family affinity (a Gemini judge scoring a Gemini candidate) is a
  plausible, unmeasured confound in D5; controlled by dual judges but not
  yet quantified anywhere.
- Character.AI / Replika / Nomi internal migration practices: nothing
  published found; lab-products track may have more.
- Cognitive-science literature (via §1.1's citations: Strohminger & Nichols
  2014/2015; Strohminger, Knobe & Newman 2017) says people track identity
  continuity through **morality and personality more than memory** — if that
  transfers to AI companions, register/warmth/values invariance (D1, D3, D5)
  is MORE load-bearing for perceived continuity than memory carry-over (D4).
  Not yet directly tested for AI companions; worth a vignette pre-study, and
  it should bias Phase C effort allocation.
