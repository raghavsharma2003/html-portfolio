# It's Not the Code-Switching: Six Frontier LLM Judges Fail a Pre-Registered Qualification Bar — and the Bar Was Above Its Own Ground Truth's Ceiling

**Raghav Sharma, Gaurav Sharma, Aryan Tiwari** · Vyakti.ai

*Submission: JUDGe 2026 — "Can We Trust the Judge?", NeurIPS 2026 (non-archival). Full paper, 6 pages + references.*

> **This file is the camera-ready.** `docs/paper/DRAFT.md` is the archive: full
> apparatus, per-cell tables, and the reasoning behind every cut made here.
> Every number below traces to `analysis/derive-tables.mjs`,
> `analysis/clustered-cis.mjs`, `analysis/r4/summary.json`,
> `analysis/r2/pooled-per-axis.json`, or a named `context/measurements.md`
> entry. The one analytic (non-measured) quantity is labelled where it appears;
> the one hand-computed figure (a dollar total) shows its arithmetic.
>
> **Length, stated rather than guessed: 5,416 words of body prose (Abstract →
> Conclusion) plus ~500 words of table content, 4 tables and 3 figures.** That
> is roughly 400 words over a comfortable 6-page two-column budget once F1–F3
> are placed, so a final trim is expected at typesetting. **The cut order is
> fixed and it is not the obvious one.** Go first: §2's self-preference and
> Indic-resource sentences (already reduced to citation lists); then §4.6's
> mechanism paragraph, keeping its table; then §3's rubric wording, keeping the
> "overall first" and no-ties clauses, which §4.2 depends on. Go LAST, and only
> under a hard limit: §4.1's ceiling paragraphs, §4.4's retraction, §4.5's
> translation control, and §6 L1. Those four are the paper.

---

## Abstract

LLM-as-a-judge is the default instrument for evaluating open-ended generation,
and its standard defences — randomised order, both-orders agreement,
cross-family panels — are assumed to make it trustworthy enough to ship on. We
report a blind, counterbalanced, pre-registered judge-qualification study in
which those defences do not save the instrument, the study's own leading
explanation does not survive its control, and the qualification bar turns out to
sit above the ground truth's own measured ceiling.

From a deployed Hinglish (romanised Hindi–English code-switched) AI-companion
product we take two archived model bake-offs whose blind, counterbalanced,
both-orders verdicts — 96 units, 192 judgments, judge `claude-opus-4.8` — had
already driven real deployment decisions, and backtest six candidate judges
against them under a pre-registered ≥80% agreement bar. **All six fail:** pooled
agreement 28.1%, 29.2%, 30.9%, 34.4%, 54.2%, the sixth disqualified for cause
(a parseable verdict on 34 of 192 calls despite an only-JSON contract). The
highest beat-clustered interval upper bound in the panel is 64.6%. Neither scale
nor cross-family selection helps: five families were tried and all five failed.

We then measure the bar. Having the model that *wrote* the ground truth re-judge
its own archive under the identical protocol yields **74/96 = 77.1% test–retest
agreement, 95% CI [67.7, 84.4]** — below the bar. The failures therefore do not
depend on where the bar was drawn: the candidates land **22.9 to 49.0 percentage
points below the measured ceiling**, and four of five recover less than half of
the archive's self-agreement.

Three mechanisms are examined and two retracted by their own controls. Position
bias **evacuates** the counterbalance rather than adding noise — a judge picking
the first slot with content-blind propensity *q* ties on *q*²+(1−*q*)² of units,
and the two most position-biased judges land on that degenerate prediction. An
apparent 16× same-vendor favoritism dies under a between-judge control. And
re-judging the same units in monolingual English moves agreement by −3.1 to
+6.6 pp, every interval overlapping its Hinglish counterpart: **it is not the
code-switching.** We release the protocol, the guarded harness, the ground-truth
verdicts and the stripped transcripts.

---

## 1 Introduction

An LLM judge is an instrument, and instruments are qualified before use. In
practice they are not. The prevailing workflow adopts a frontier model as judge,
applies the standard hedges — strip model identity, randomise order, count a
comparison only when both orders agree, prefer a vendor family disjoint from the
contestants — and proceeds to measure the system under test. Each hedge is
sensible. None is a qualification, and none tells you what happens when the
judge simply cannot do the task.

This paper reports what happens. The need was concrete: a deployed Hinglish
companion product needed an automatic judge for a downstream gate worth roughly
$400 in compute, and the model that had produced the product's historical
decision record was not billable under the grant funding the work. So we did the
thing the literature recommends and rarely reports — backtest six candidates
against verdicts we already trusted, under a bar fixed in advance — and publish
the result although every candidate failed. Three things make it worth attention
beyond the failure count.

**The failure has a geometry, and part of it indicts a defence everyone uses.**
Both-orders agreement does not reduce position bias; it converts it into missing
data. Because presentation is counterbalanced, a judge picking slot A regardless
of content names a different model in each order, so every unit becomes a tie
and its agreement collapses onto the archived tie rate. Two of our judges land
on that prediction within 1.8 and 2.6 pp. Downstream those ties look like a
cautious judge, and the aggregate agreement rate — the number practitioners
report — conceals the whole phenomenon.

**We ran controls on our own explanations and two failed.** We had logged a 16×
same-vendor favoritism effect, cleanly measured, with a within-judge control
that looked adequate; a between-judge control erases it. We had also named this
paper after code-switching; a translation control removed that too. Both
retractions are reported with the original reasoning intact, because they are
the best evidence for the paper's thesis: a plausible mechanism, cleanly
measured, with a control that looks adequate, can still be wrong.

**Last, we measured the bar itself** — $3.93 to have the model that authored the
ground truth re-judge its own archive. It reproduced its own verdicts 77.1% of
the time, so the pre-registered 80% bar was unreachable: not by much, and not
detectably so beforehand. That is a correction to our method and we report it as
one. It also improves the central claim, because the candidates are then not
merely below a threshold we chose but failing to approach the reproducibility of
the verdict set itself — a quantity we measured rather than picked.

---

## 2 Background and related work

**Judge bias is well characterised in English.** Position, verbosity and
self-enhancement biases were named with MT-Bench and Chatbot Arena and
quantified since (*Justice or Prejudice?*; arXiv:2602.02219; JudgeBench);
self-preference spans −38% to +90% on ArenaHard (arXiv:2604.22891 and the line
at 2410.21819, 2506.02592, 2508.06709, 2509.26464); RAND's harness
(arXiv:2603.05399) stress-tests format invariance, paraphrase and calibration
while explicitly excluding position bias and family favoritism. All monolingual
English.

**Multilingual judging degrades, language-dependently.** Fu & Liu
(arXiv:2505.12201) report Fleiss' κ ≈ 0.3 across 25 languages, worst in
low-resource ones, unfixed by scale. Yin (arXiv:2606.14278) measures
language-switching invariance on 419 objective LLMBar items over 13,408
judgments: 10.7–14.4% preference flips, judges most accurate in English.
BabelJudge (arXiv:2606.22329) covers EN/HI/AR/SW with gold labels constructed by
controlled degradation, reporting Swahili order-consistency at 0.480 —
"near-random under slot-order swaps", the same evacuation geometry we measure,
in a different setting. Code-mixed Indic resources exist but trust their judge
rather than study it: Indi-RomCoM (arXiv:2606.30790), the first human-validated
romanised Indic-English instruction benchmark, uses GPT-4o as its instrument;
COMI-LINGUA, LinCE and GLUECoS skew formal register.

**Affective evaluation already treats the judge as an instrument to calibrate.**
EMPATH (arXiv:2606.30256) reports judge–clinician concordance of 76% (Gwet AC1
0.61) and 60% (AC1 0.20) against clinician–clinician 47% — our exact stance,
without code-switching and on a safety rather than register construct.

**The nearest work on test–retest is the closest comparison to §4.1.** Norman,
Rivera & Hughes (*Reliability without Validity*, arXiv:2606.19544) run 21 judges
from 9 providers over ~541,000 judgments, finding κ deflation of 33–41 pp
against exact match alongside **production judges with test–retest above 0.95
and position bias above 0.10**. We measure 0.771 for the model that authored our
ground truth. The quantities differ — theirs a judge re-scoring objective items,
ours a judge reproducing its own *preference* verdicts on affective dialogue
seven days later under a both-orders rule — and we report both, because the
contrast is informative: their finding is that reliability can exceed validity;
ours is the case where the reliability is not there either.

**What is new.** No published work backtests candidate judges against blind,
counterbalanced, both-orders-agree preference verdicts on romanised Hinglish
affective register; none reports a controlled refutation of the code-switching
hypothesis on an affective preference task; none reports a qualification bar
measured against its ground truth's own test–retest ceiling.

---

## 3 Method

**Ground truth.** Two model bake-offs run 2026-08-11 by the product team, before
this study was conceived, to decide which model would serve a live consumer
product: `charm-grok` (incumbent `google/gemini-3.6-flash` vs
`grok-4-20-non-reasoning`) and `charm-luna` (same incumbent vs
`openai/gpt-5.6-luna`), 48 units and 96 judgments each. A **unit** is one (lane,
beat, replicate) conversation: a 6-turn scripted exchange in one of 12 affective
beats (casual, teasing, bored, sad, conflict, factual, crisis-adjacent, …) in one
of two lanes (text, voice-transcript). User turns are **identical scripted lines
across arms** and both arms received a byte-identical system prompt, so the arms
differ only in the model that produced the replies. Every unit was judged twice,
once per presentation order, by `anthropic/claude-opus-4.8` with model identity
stripped, on seven axes plus three safety flags, with a rationale per judgment.
They count as trusted verdicts on five grounds and no more — blind;
counterbalanced; produced before this study; **acted upon**, being the recorded
reason two candidate models were declined for a shipping product; and re-derived
from the raw files on every CI run, which fails the build if a number moves.
They are not human verdicts (§6, L1).

**Unit rule and chance baselines.** A unit yields a verdict only when both
orders name the same model; an order flip is `TIE_FLIP`, and a candidate agrees
when its consolidated verdict — including `TIE_FLIP` — equals the archived one.
Two chance baselines follow and their difference is the mechanism of §4.2: a
**uniform-random** judge (independent per presentation, p = 0.5) has expected
agreement `(decisive × 0.25 + tie × 0.5)/n` = **30.5%** pooled, while a **pure
slot-A** judge names a different model in each order, so every unit becomes
`TIE_FLIP` and its expected agreement is exactly the archived tie rate, **21.9%**
pooled. Both are computed from the archived verdict distribution, not assumed.

**Candidates, rubric, and the funding constraint that shaped both.** The
programme runs on an Azure/Microsoft-for-Startups grant covering only models
billed directly by Azure — which is why the model that produced the ground truth
could not simply be reused as the operational judge. Six candidates were
deployed on the programme's own Foundry resource, verified live before any
judging call: DeepSeek-V4-Flash, DeepSeek-V4-Pro, gpt-5.6-terra, grok-4.3,
Mistral-Large-3, Cohere command-a-plus-05-2026, all at temperature 1 (terra's
API pins it, the rest matched) with a 120-token cap, Cohere at 400. One
pre-registered family, `Llama-4-Maverick`, was unavailable on this tenant and
never ran: we say **five families tried**, never "every family". Every judge
received an identical prompt, verbatim from the harness: blind comparison of two
AI-companion replies from the same multi-turn Hinglish conversation on overall
quality (warmth, humour, natural Hinglish register, personhood, appropriate
brevity), replying with only a JSON object, `"overall"` **first** so a length cut
never loses the verdict, and **no ties permitted at the judgment level**. Ties
can therefore arise only at *unit* level, from an order flip — which is what
makes position bias and genuine indifference distinguishable in the data.

**The pre-registered bar.** ≥80% agreement with the trusted verdicts, the **95%
Wilson lower bound** required to reach it; a point estimate above 80% with a
straddling interval is not a pass. The chain is verifiable in repository
history: the methodology and the number are fixed in `2e82a0f`
(2026-08-13T12:20:22Z), **two days before any candidate ran**; the
judge-qualification instantiation is `c18b239` (2026-08-15T09:37:58Z), **25
minutes before the first backtest result was committed** (`dd0a04c`, 10:02:49Z);
the pre-registration proper is `bfeb979` (10:24:29Z), amended by `a7198a2`,
`a053019` (11:28:09Z, "qualification bar unchanged") and `d10e840`. No commit
moves the bar after a result was known, and the bar gated a real ~$400 spend, so
it had a cost attached before any result existed. **What the chain does not
show, and §4.1 corrects, is that the bar was ever checked against an achievable
ceiling.**

**Guards, leakage, scale.** Transport and parse misses are counted separately; a
run self-invalidates above a 5% transport-error rate (added after an API key
limit silently converted a run into a transport-selected subset that scored
100%) or above 50% parse misses (added after a judge answered in prose on most
calls). The guards exist to let the harness **decline to issue a number**, and
here they declined twice, both times on the most flattering results available
(§4.1, §5). The harness also verifies per archive that no judged row was produced
by a judge's own deployment (0 of 96 on both); the distinct case that is
*measured* rather than excluded is a judge whose vendor **family** is a
contestant (§4.4). 192 rows per judge × 8 judges = **1,536 judgment rows**; two
later runs extend the same units without adding conversations (English control,
1,152 calls; six-axis re-judge, 5,760 calls). Azure runs cost $0 cash on grant
credits; the single cash item is the ceiling run at ≈$3.93.

---

## 4 Results

### 4.1 Every candidate fails — and the bar was above the ground truth's ceiling

| judge | agree / n | agreement | Wilson 95% CI | clustered 95% CI | verdict | slot-A (rows) | transport / parse |
|---|---|---|---|---|---|---|---|
| DeepSeek-V4-Flash | 27 / 96 | **28.1%** | [20.1, 37.8] | [18.8, 39.6] | **FAIL** | 80.2% (192) | 0 / 0 |
| Mistral-Large-3 | 28 / 96 | **29.2%** | [21.0, 38.9] | [20.8, 38.5] | **FAIL** | 89.6% (192) | 0 / 0 |
| DeepSeek-V4-Pro | 29 / 94 | **30.9%** | [22.4, 40.8] | [20.7, 41.5] | **FAIL** | 65.8% (190) | 2 / 0 |
| grok-4.3 | 33 / 96 | **34.4%** | [25.6, 44.3] | [25.0, 43.8] | **FAIL** | 73.4% (192) | 0 / 0 |
| gpt-5.6-terra | 52 / 96 | **54.2%** | [44.2, 63.8] | [43.8, 64.6] | **FAIL** | 62.0% (192) | 0 / 0 |
| command-a-plus | 0 / 0 | — | — | — | **DISQUALIFIED** | 61.8% (34 parsed) | 0 / **158** |
| *claude-opus-4.8* | *74 / 96* | ***77.1%*** | *[67.7, 84.4]* | *[69.8, 85.4]* | ***CEILING*** | *45.3% (192)* | *0 / 0* |
| *claude-opus-5* | *17 / 17* | *100.0%* | *[81.6, 100]* | *[100, 100]* | ***INVALID (parse)*** | *46.9% (64)* | *0 / **128*** |

*`derive-tables.mjs` T3 and `clustered-cis.mjs` (beat-clustered bootstrap, 12
clusters, 10,000 reps, seed 20260818). **Figure F1** plots this table.*

No candidate interval touches the bar, and clustering — which can only widen an
interval, estimating the same point from 12 effectively independent clusters
rather than 96 nominal trials — moves each by −0.2 to +3.1 pp and changes no
verdict. These are clean failures, not underpowered ones.

**The last two rows are not candidates.** `claude-opus-4.8` is the model that
*wrote* the ground truth, re-run over the same 96 units under the identical
protocol and scored against its own archived verdicts. Its 77.1% is a
**test–retest ceiling**: per archive it reproduces 41/48 = 85.4% [72.8, 92.8] of
the landslide archive and 33/48 = 68.8% [54.7, 80.1] of the coin-toss archive,
with decisive-unit accuracy 84.0% (n = 75) and slot-A 45.3% — a mild B-lean, no
evacuation. Three consequences.

*(i) The bar sits above the measured ceiling.* Under the study's own rule the
ground truth would not have qualified as a judge of its own archive. That is a
finding about the bar, not a defect in its provenance: it was fixed before anyone
had measured what was achievable — both the condition under which
pre-registration is worth something and the condition under which a bar can turn
out unreachable. A bar chosen *after* this measurement would have been ≈77%, and
would have been worse for having been chosen to be reachable.

*(ii) Every FAIL stands and stops depending on the bar.* The candidates sit 22.9,
42.7, 46.2, 47.9 and 49.0 pp below the ceiling; the best recovers barely
two-thirds of the archive's self-agreement and four of five recover less than
half. **This is the form of the claim that survives the "your bar was arbitrary"
objection.**

*(iii) It bounds the ground truth's noise, not its validity.* One archived
verdict in five is not reproduced by its own author — but a model can be
perfectly self-consistent and consistently wrong about a community's register.
This narrows the central limitation without closing it (§6).

**`claude-opus-5` is not a result.** Its rerun was clean on transport and then
failed the parse guard: at the panel's 120-token cap, 125 of 192 calls returned
an empty completion because reasoning consumed the budget and 2 more were cut
mid-JSON — 128 unparseable, far past the 50% threshold. Its 17/17 is a
self-selected denominator of exactly the kind the harness exists to refuse. The
honest description is **a plausible qualified judge pending a rerun with a token
cap that fits a reasoning model** (≈$1). We report it because omitting it would
itself be a selection, and decline to count it because the harness did.

### 4.2 Four of five carry no more information than a coin, and position bias is why

Against the 30.5% uniform-random baseline, by exact two-sided binomial test:
DeepSeek-V4-Flash p = 0.66, DeepSeek-V4-Pro p = 0.91, Mistral-Large-3 p = 0.83,
grok-4.3 p = 0.44. **Four frontier-class models, all competent conversational
agents, carry no more information about a native-speaker-aligned preference on
this task than a coin does.** Only `gpt-5.6-terra` is reliably above chance
(54.2%, p = 1.9 × 10⁻⁶), and it agrees barely more often than it disagrees. The
uniform-random model is a *baseline*, not a description: none of these judges is
random, and their slot-A rates prove it — Mistral-Large-3 **89.6%**
(p = 2.5 × 10⁻³¹), DeepSeek-V4-Flash **80.2%** (9.2 × 10⁻¹⁸), grok-4.3 **73.4%**
(5.9 × 10⁻¹¹), DeepSeek-V4-Pro **65.8%** (1.6 × 10⁻⁵), gpt-5.6-terra **62.0%**
(0.0011), against the trusted judge's 58.9% on identical rows.

**The counterbalance does not absorb this; it is absorbed by it.** Let *q* be a
slot-A propensity applied independently of content. Presentation is
counterbalanced, so the judge names the same model twice only by picking slot A
in one order and slot B in the other:

> P(decisive unit) = 2*q*(1−*q*)  P(`TIE_FLIP`) = *q*² + (1−*q*)²

**This curve is analytic, not measured — the only non-measured quantity in the
paper**; every point plotted against it is measured. At *q* = 1 agreement
collapses onto the archived tie rate exactly, and on the landslide archive both
extreme judges land on that degenerate prediction: Mistral-Large-3 and
DeepSeek-V4-Flash each agree on **16.7% (8/48)** against an archived tie rate of
**8/48 = 16.7%**. Mistral sits 1.8 and 2.6 pp off the content-blind prediction on
the two archives; `gpt-5.6-terra` sits 23.6 and 30.6 pp *below* it and the
trusted judge 34.1 and 25.5 pp below, because content is doing work for them
(**Figure F2**). Mistral returned `TIE_FLIP` on 39 of 48 and 37 of 48 units.
Downstream, those ties read as caution.

### 4.3 The error has a direction, and it is the assistant aesthetic

Restricting to decisive units — where the trusted judge named the same model in
both orders — a uniform-random judge is right 25% of the time. On `charm-grok`,
where the trusted judge chose the incumbent on **38 of 40** decisive units:
Mistral-Large-3 **5.0%** (2/40), grok-4.3 **10.0%** (4/40), DeepSeek-V4-Flash
**15.0%** (6/40), DeepSeek-V4-Pro 30.0%, gpt-5.6-terra 57.5%. Three judges score
below the chance floor on the archive with the least ambiguous ground truth.
Below-chance is not incompetence, it is **anti-correlation**, and it has a
direction: among their own decisive verdicts these judges pick the arm the
trusted judge rejected (Mistral 1 vs 6, grok 3 vs 13, DeepSeek-Flash 5 vs 8).

**What the rejected arm is, is the finding.** It was declined at the time for
measured, register-level reasons: 36.1 words per turn against the incumbent's
20.5, **1.74 questions per turn**, 63% of turns ending in a question. The
trusted judge's rationales name the mechanism — *"piles on multiple questions per
reply and generic neediness"*, *"does therapist-style feeling-summaries"* —
against an incumbent that *"remembers shared history … and teases like a real
friend"*. The arm these judges prefer is the longer, more interrogative, more
explicitly supportive, more assistant-shaped one: exactly what verbosity bias
and helpfulness tuning reward, and exactly what a native-register companion
evaluation must reject. A spot-check of the best candidate finds it *"repeatedly
scores authentic Hinglish teasing as 'mocking/dismissive' and prefers generic
supportive replies."* **These judges are not indifferent. They have a confident
preference and it is inverted relative to the register the task is about.**

*Multiplicity, stated honestly:* Mistral's below-chance result at p = 0.022 does
not survive Bonferroni over the ten tests in §4.1–§4.3 (α = 0.005). We report the
**pattern** — three of five below the chance floor on the landslide, same
direction, with an independently recorded qualitative mechanism — not a p-value.

### 4.4 A retraction: same-vendor favoritism does not survive a between-judge control

`charm-grok`'s candidate arm is an xAI model and `grok-4.3` is an xAI judge. On
that archive it picked the xAI arm on **81.0%** of its non-tie units (17/21)
against a ground truth of **5.0%** (2/40) — a ~16× preference for its own
vendor's output — and its **within-judge** control looked clean: +12.9 pp
over-picking where no xAI arm exists, against +76.0 pp where the conflict does.
We logged this as a confirmed finding. The **between-judge** control kills it:

| judge | family conflict | elevation, `charm-grok` | elevation, `charm-luna` | difference-in-differences |
|---|---|---|---|---|
| Mistral-Large-3 | **none** | +83.9 pp | +12.2 pp | **+71.7 pp** |
| grok-4.3 | **`charm-grok`** | +76.0 pp | +12.9 pp | +63.1 pp |
| DeepSeek-V4-Flash | none | +47.6 pp | +1.5 pp | +46.1 pp |
| DeepSeek-V4-Pro | none | +33.5 pp | −8.0 pp | +41.4 pp |
| gpt-5.6-terra | **`charm-luna`** | +28.3 pp | +38.0 pp | **−9.7 pp** |

*(elevation = judge's non-tie candidate pick rate minus the ground truth's;
`derive-tables.mjs` T4/T5.)*

A family-disjoint judge shows a *larger* differential than the conflicted one,
and the panel's other conflicted cell runs negative. Family conflict does not
order the data. **The parsimonious explanation is §4.3 and it explains both:**
every judge over-picks that archive's candidate because it is the verbose,
question-stacking, assistant-shaped arm; grok-4.3's 81% is the panel-wide
register preference expressed by a judge that happens to share a vendor with the
arm that preference favours. One mechanism, not two. The 81%-vs-5% figure
survives as an agreement failure and is counted in §4.3; only the causal
attribution is withdrawn. We report **no evidence of same-vendor favoritism in
this data**, and note the design could not have detected a moderate one: two
conflict cells with ground-truth base rates of 5.0% and 51.4% — a mismatch which
is also how a "16×" headline was arithmetically reachable at all.

### 4.5 The translation control: it is not the code-switching

The paper was named for a hypothesis: romanised code-switching defeating the
judges' register model. We tested it. The same 96 units, both transcripts each,
machine-translated to faithful monolingual English by `gpt-5.6-terra` and
re-judged by the same five judges — identical protocol, same archived ground
truth, exactly two words changed in the rubric ("Hinglish" → "English", twice),
no other parameter differing.

| judge | Hinglish | clustered CI | English | clustered CI | recovery |
|---|---|---|---|---|---|
| DeepSeek-V4-Pro | 30.9% | [20.7, 41.5] | 37.5% | [28.1, 47.9] | **+6.6 pp** |
| Mistral-Large-3 | 29.2% | [20.8, 38.5] | 34.7% | [26.3, 45.3] | +5.6 pp |
| DeepSeek-V4-Flash | 28.1% | [18.8, 39.6] | 31.9% | [19.4, 45.2] | +3.7 pp |
| grok-4.3 | 34.4% | [25.0, 43.8] | 37.5% | [29.2, 45.8] | +3.1 pp |
| gpt-5.6-terra | 54.2% | [43.8, 64.6] | 51.0% | [38.5, 63.5] | **−3.1 pp** |

*`analysis/r4/summary.json`; all five English runs VALID under the same guards.
1,152 calls, ≈1.23 M tokens, $0 cash. **Figure F3** draws it.*

**Register causality is not established.** Every recovery is small (−3.1 to
+6.6 pp, mean +3.2), every English interval overlaps its Hinglish counterpart,
no English point estimate approaches the bar or the ceiling, and the best judge
in both conditions moves the *wrong* way. Measured against this programme's own
noise floor — a 13.6 pp spread in judged rates across 300 arm-pairs whose input
was provably byte-identical — **every recovery sits inside the floor**. This is
not an underpowered null: the same design cleanly rejects an 80% bar in §4.1.
Removing code-switching does not rescue judge performance, so the failure is
deeper than register; read with §4.3, the parsimonious interpretation is that
this is the judges' baseline taste and a Hinglish-to-English swap does not change
it. **Code-switching was the setting in which we caught it, not the cause.** The
supported claim is *"fails on affective/companion register, tested here on a
code-switched corpus and, under a translation control, on its monolingual
English translation as well"*.

### 4.6 Per-axis: a three-tier failure, not the predicted binary

The archived ground truth carries seven axes; only `overall` had been
backtested. We re-judged all 96 units on the six others with the same five
judges (5,760 calls, $0 cash, 18 transport misses at 0.3%, every cell VALID),
pooled across judges with clustered CIs:

| axis | n | agree | pooled | clustered 95% CI |
|---|---|---|---|---|
| **brevity** | 478 | 264 | **55.2%** | **[50.7, 59.6]** |
| personhood | 477 | 221 | 46.3% | [38.2, 54.6] |
| humour | 476 | 220 | 46.2% | [33.1, 57.5] |
| specificity | 478 | 218 | 45.6% | [37.1, 55.2] |
| register | 474 | 184 | 38.8% | [30.0, 47.9] |
| overall *(reused)* | 478 | 169 | 35.4% | [28.7, 42.6] |
| warmth | 479 | 154 | 32.2% | [23.5, 41.2] |

**Every axis fails the bar and the ceiling**, and our hypothesis — register and
humour worse than the structural axes — is **half right**. `brevity` is a
genuine, clustered-CI-distinguishable outlier whose interval does not overlap
`warmth`, `register` or `overall`, holding per-judge for 4 of 5; `warmth` and
`register` are the hardest axes and sit close to `overall`. **But `humour` is not
one of the hard axes**: it is statistically indistinguishable from `specificity`
and `personhood`, three axes whose intervals overlap almost completely, though
the hypothesis puts humour on the affective side and specificity on the
structural side. Three tiers, not two. This converts the mechanism claim from
inferred to measured — the judges' worst axis is the one richest in
code-switched affective texture, their best the one closest to a checkable
structural property (one thought, stopped, at most one question), the dimension
§4.3 measures directly. It adds no independent conversations: 96 units scored on
7 axes rather than 1 is not a diversity claim.

---

## 5 Discussion: three rules a practitioner can reuse

**Rule 1 — Both-orders agreement is a diagnostic, not a debiasing method, so
report the tie rate and the slot-A rate beside it.** The rule has no floor: a
content-blind judge produces a decisive unit only by accident, at rate
2*q*(1−*q*), and its ties are the absence of a measurement, indistinguishable in
the output format from a judge that read both replies and found them equal. The
failure is *evacuation*, not noise — noise widens an interval around a real
quantity; evacuation removes the quantity and leaves the interval. A
practitioner reading Mistral's 16.7% concludes the judge is bad; the more
alarming fact is that 16.7% is exactly what a content-blind judge with Mistral's
propensity would score. The fix costs nothing: report agreement, tie rate and
slot-A rate together, and better still the gap between the observed tie rate and
*q*²+(1−*q*)², a one-line calculation from numbers every harness already has and
a usable index of how much content a judge's verdicts carry.

**Rule 2 — Measure the ground truth's ceiling before setting the bar, and attach
a cost to the bar.** We pre-registered ≥80% with a real ~$400 spend behind it,
which is what makes the bar credible, and never checked whether 80% was
achievable, which is what makes it wrong. The ceiling cost 192 calls and $3.93 —
a rounding error against what the bar gated — and showed the ground truth
reproduces itself only 77.1% of the time. The correct order is: measure the
ceiling, pre-register a bar as a stated fraction of it, then run candidates. It
also changes what a FAIL is reported *against*: against a bar it is a statement
about a threshold somebody chose; against a measured ceiling it is a statement
about the instrument. We therefore propose a **minimal qualification report** —
eight numbers a backtest harness already computes: (1) agreement with an
interval against a stated bar; (2) the chance baseline **for the aggregation rule
actually in use**, derived not assumed — ours is 30.5%, not 50%; (3) slot-A rate
beside the trusted judge's on identical rows; (4) tie rate beside its
content-blind prediction; (5) transport misses; (6) parse misses; (7) a
family-conflict cell **with a between-judge control**; (8) the ground truth's own
test–retest ceiling.

**Rule 3 — A within-subject-only difference-in-differences is a mechanism claim
waiting to be retracted.** We proposed two mechanisms and lost both. The
favoritism claim's within-judge control established that the conditions differ
without establishing that the proposed cause is what differs; where the
"treatment" is a property of the judge and the "conditions" are archives
differing in many other ways — including base rates of 5.0% and 51.4% — the
between-judge control is not a robustness check, it is the identification. The
code-switching mechanism had direction-of-error evidence plus a qualitative
reading, and a translation control removed it. Both were reasonable readings of
the data available at the time; both were wrong. The generalisable form is a
cheap question worth asking of any mechanism claim, including ones we still
believe: *what control did this survive, and could that control have refuted
it?*

**Where this bites, and why the harness must be able to refuse.** The pull
toward LLM judging is strongest exactly where this failure is worst: affective,
culturally-loaded tasks are the ones for which qualified annotators are
scarcest, and also the ones on which the judge's own aesthetic has most room to
substitute itself for the construct. The same has been observed for low-resource
languages; our contribution is that it holds for an affective construct in a
*high*-resource language too, so the usual mitigation — evaluate in English — is
not one. Meanwhile, the two best numbers in this paper are both ones the harness
refused: a 100%/88.9% pair on transport-selected denominators of 14 and 9, and —
three days later, key limit raised, run repeated in full — `claude-opus-5` at 17
of 17 with 128 of 192 replies empty. Both refusals cost us our most flattering
results. That is what the guards are for.

---

## 6 Limitations and ethics

**L1 — The ground truth is an LLM, not a human.** The study's largest threat,
unmitigated by anything else here. Every agreement figure is agreement with one
frontier model's verdicts; we claim four things for them and no more — blind,
counterbalanced, produced before this study, and **acted upon** as a deployment
decision record. §4.1 bounds their *noise* at 77.1% self-agreement, a real
narrowing, but self-agreement is not validity: a model can be perfectly
reproducible and consistently wrong about a community's register. Read every
number here as "agreement with a specific trusted judge", never as "accuracy";
the artifact's datasheet enforces that reading.

**L2 — n = 96 units, clustered on 12 beats.** Adequate to reject an 80% bar,
inadequate for fine discrimination among the failures. Each beat script
contributes 8 units, and a judge's error on the *teasing* beat is a fact about
how it reads teasing, not eight coin flips: the honest answer to "how many
effectively independent observations?" is **12, not 96**, and §4.1's clustered
intervals report it that way. **L3 — Single persona, product, language pair; two
archives.** Generalisation is an open question, never claimed.

**L4 — The code-switching refutation used a machine translator at n = 96**, and
shows no recovery beyond this programme's noise floor on *these* units with
*this* pipeline; it does not establish that code-switching never matters for LLM
judges. **L5 — The translator is a panel member**: the credits-billed resource
offered exactly two models suitable for translation and both were judges, so no
family-disjoint translator existed at $0. terra's own number cannot rule out
self-familiarity, though its score moved *down* — the opposite of what
self-familiarity predicts — and the other four judges are not subject to the
confound. **L6 — The fidelity check is a single non-independent rater** on ten
of 96 units: a spot check, not verification.

**L7 — Parameters unswept, results date-stamped.** All judges ran at temperature
1; lower temperature might reduce position bias. This programme has separately
measured an Azure deployment shifting behaviour materially over four days, so
judge results are date-stamped evidence (2026-08-15, 2026-08-18), not properties
of a model name. **L8 — One pre-registered family never ran**
(`Llama-4-Maverick`, unavailable on this tenant). **L9 — The favoritism null is
weak**, from two conflict cells with mismatched base rates; the claim is "our
data do not support the claim we previously logged", never "vendor favoritism
does not occur". **L10 — We are bound by our own noise floor** and may not
report a judged rate difference below 13.6 pp as a finding: DeepSeek Pro vs
Flash is "no difference detected", and §4.5's recoveries are *inside the floor*.

**Ethics.** No human subjects: every conversation is a scripted battery with
identical scripted user turns addressed to a fictional interlocutor, and no real
user conversations, production rows or personal data enter the corpus, analysis
or release, which is stripped and verified by executed checks rather than
asserted. The principal misuse risk is adoption as a benchmark of judge
*correctness* — it is not one; it measures agreement with one trusted judge's
decisions on one product's construct, and a leaderboard built on it would
launder an LLM's aesthetic into an apparent ground truth, the failure mode this
paper documents. On positionality: the authors are the product team whose
decisions produced the ground truth, and the incentive ran *toward* a judge
passing — a qualified credits-billed judge would have avoided a ~$400 cash spend
— yet every candidate failed, which is the direction of bias arguing against a
manufactured result. Finally, a paper asserting that automatic judges misread a
linguistic community's register, without annotators from that community in the
loop, asserts something it has not earned. We treat that as an ethical
limitation, not only a methodological one, and will not submit to an archival
venue without a human-annotation run (≥2 native Hinglish raters, inter-rater
agreement reported).

---

## 7 Artifact release

We release `vyakti-judge-qual` under Apache-2.0 (code) and CC BY 4.0 (data): the
generalised qualification harness with the transport- and parse-validity guards
intact — a contribution, not plumbing; the analysis that reproduces every number
here offline; the **192 ground-truth verdicts with rationales across seven
axes**, the scarce asset; both arms of both archives stripped to `{user, reply}`
plus `{model, lane, beat, rep}`; the 1,536 R0 judgment rows plus 5,760 R2 and
960 R4 rows; a per-vendor deployment quirk log, which practitioners will use
more than the results; and a Gebru-style datasheet stating in its own voice and
first section that **the ground truth is LLM-produced, not human-annotated**.
The product's persona prompt is not released and is not needed for anything this
paper claims. Because the archived files embed it at 44,002 and 47,094
characters, the bundle is built by an extraction script rather than copied, and
seven de-identification checks are executed against the built bundle with their
output recorded.

---

## 8 Conclusion

Six frontier judges were qualified against a decision record from a live
product, and all six failed. Four carry no more information about the construct
than a coin; three prefer, on the archive with the least ambiguous ground truth,
exactly the register that record rejected. The standard defence — counterbalance
and count both-orders agreement — converts position bias into ties that look like
caution. Both our explanations for the failure died under controls we ran
ourselves, and the bar we pre-registered turned out to sit above the ground
truth's own 77.1% test–retest ceiling, which we discovered only because we
finally measured it.

**An evaluation programme that adopts an LLM judge for an affective or
open-ended preference task without backtesting it against trusted verdicts is
measuring judge taste rather than the system under test. Any mechanism it then
proposes for a failure needs a control that could have refuted it. And the
ceiling of the thing being agreed with should be measured before the bar is
drawn — otherwise the bar is a number nobody has checked.**

---

## References

Full annotated citation list in `docs/paper/DRAFT.md` §2.2. Principal works:
arXiv:2505.12201 (Fu & Liu) · arXiv:2606.14278 (Yin) · arXiv:2606.22329
(BabelJudge) · arXiv:2606.19544 (Norman, Rivera & Hughes) · arXiv:2606.30790
(Indi-RomCoM) · arXiv:2606.30256 (EMPATH) · arXiv:2603.05399 (RAND) ·
arXiv:2602.02219 · arXiv:2510.09738 · arXiv:2607.28818 (ANCHOR) ·
arXiv:2410.21819, 2604.22891, 2506.02592, 2508.06709, 2509.26464
(self-preference line) · arXiv:2607.02235 · arXiv:2503.21670 (COMI-LINGUA).
