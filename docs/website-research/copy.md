# Vyakti.ai Research — copy source

Long-form copy for a research index page and per-paper pages. Written for a
site rendering directly from `content.json`; the two should never drift —
every number below also appears there with a `source` citation. This file
carries voice and structure; `content.json` carries the machine-readable
facts.

---

## Research index page

### Eyebrow

Vyakti.ai Research

### Headline

We build the layer that lets an AI companion survive a model swap. We measure
whether our own tools for judging that claim can be trusted.

### Standfirst

Vyakti.ai is a three-person team. Our research output is small by design and
every entry in it is load-bearing: pre-registered before we saw the data,
retracted in public when our own controls proved us wrong, and released with
the harness that produced it.

### Body — positioning

An AI companion that people build a relationship with cannot have that
relationship reset every time the underlying model changes. That is the
premise the company is built on, and it is a testable claim rather than a
slogan: identity and relationship history have to live in a layer that is
separate from any one model's weights, survive being read by a different
model, and be checkable by something other than the model's own say-so.

That last requirement is where most of the discipline lives. The natural way
to check whether a companion still "feels like herself" after a change is to
ask another AI model to compare the before and after — and the natural way to
check whether a memory system is behaving is to ask a model whether it
followed the rules. Both of those checks are exactly as trustworthy as the
model doing the checking, and that trustworthiness is not something the
industry currently measures before shipping it. So we measure it, on our own
systems, before we build anything on top of the answer.

### Three pillars

**Relational-state architecture.** Memory, relationship history, and honest
forgetting, authored and retrieved as structured state rather than generated
prose — so a companion's identity is a property of the state layer, not of
any single model's weights.

**Evaluation methodology.** LLM judges are instruments, and instruments get
qualified before use. We pre-register agreement bars, measure the chance
baseline for the exact scoring rule in use, and run controls against our own
explanations for a failure — not only against the failure itself.

**Structural privacy for shared memory.** In any setting where a companion
holds memory shared across more than one person, privacy is enforced as a
database-level predicate checked at retrieval time, not as an instruction
given to the model. We have measured the difference at scale, and it is not
close.

---

## Paper page — Paper B

*(id: `paper-b-judge-qualification`)*

### Status line

**Under review, NeurIPS JUDGe 2026 workshop** · submitted to *"Can We Trust
the Judge?"* (non-archival), deadline 2026-08-29 AoE · authors: Raghav
Sharma, Gaurav Sharma, Aryan Tiwari — Vyakti.ai

An arXiv preprint is planned to post before the workshop submission closes.
This page will update once notification lands (targeted 2026-09-29); nothing
here should be read as implying a review outcome that hasn't happened yet.

### Title

**It's Not the Code-Switching: Six Frontier LLM Judges Fail a Pre-Registered
Qualification Bar — and the Bar Was Above Its Own Ground Truth's Ceiling**

### Plain-language summary

Companies increasingly ask one AI model to judge another AI model's output.
Common wisdom says a few safeguards — hiding which model wrote which reply,
checking both presentation orders, using a judge from a different company —
make the result trustworthy. We tested that directly: we took real judgments
our team had already made and acted on, choosing which AI model would power
our product, and asked six well-known AI models to reproduce them. All six
failed a bar we set in advance; four did no better than random guessing. More
important: the original judge, redoing its own past judgments, agreed with
itself only 77 times out of 100 — below our own bar, unreachable from the
start, which we only learned by measuring it. We also tested and ruled out
our leading explanation (mixing Hindi and English) and a claim that one judge
favored its own company's model — both looked believable and both were
wrong. We release the test, the data, and the mistakes.

### The setup

We run a Hinglish (romanised Hindi–English) AI companion. Twice, we needed to
decide which underlying model would serve the product, so the team ran a
blind, counterbalanced bake-off: two candidate replies per turn, presentation
order randomised, judged twice each so an order-flip could be detected, with
a trusted model doing the judging. Those verdicts — 96 conversation units,
192 judgments — are not a benchmark. They are the actual record of a real
product decision, made before this study existed and acted on: two candidate
models were declined for a shipping product on the strength of them.

Later, we needed an automatic judge for a downstream evaluation gate, and the
model that had produced that decision record was not billable under the
grant funding the work. So we did what the evaluation literature recommends
and rarely actually reports: we backtested six candidate judges against
verdicts we already trusted, under a bar fixed in writing before any
candidate ran, and published the result even though every candidate failed.

### What we found

**Every candidate failed.** DeepSeek-V4-Flash, DeepSeek-V4-Pro,
Mistral-Large-3, grok-4.3 and gpt-5.6-terra scored between 28.1% and 54.2%
pooled agreement against a pre-registered ≥80% bar; a sixth candidate,
Cohere's command-a-plus, could not even be scored — it broke the required
output format on the majority of calls. Beat-clustered confidence intervals,
which correct for the fact that the 96 units are not 96 independent
observations, moved every number by at most 3.1 percentage points and
changed no verdict.

**Four of five carry no information a coin flip wouldn't.** Against the
measured chance baseline for this task's scoring rule — 30.5%, not the 50%
a naive reading would assume — four of the five scorable judges were
statistically indistinguishable from random. Only gpt-5.6-terra beat chance,
and it still failed the bar by a wide margin.

**We measured the bar itself, and it had been unreachable.** We had the
model that wrote the original ground truth re-judge its own archive under
the identical protocol, a week later. It agreed with its own past self on
74 of 96 units — 77.1%, with a 95% confidence interval of [67.7%, 84.4%] —
which sits below the 80% bar we had pre-registered two days before any
candidate ran. No candidate judge could ever have cleared a bar the ground
truth itself couldn't clear. This reframes every failure: the candidates
aren't merely below an arbitrary number we picked, they sit 23 to 49
percentage points below what the archive can even reproduce of itself.

**Position bias doesn't add noise — it deletes the measurement.** Under a
"both orders must agree" rule, a judge with a fixed preference for whichever
reply appears first will, by simple arithmetic, tie on a predictable share of
units regardless of content: a judge with slot-A propensity *q* ties on
*q*² + (1−*q*)² of units. Two of the failed judges landed almost exactly on
that predicted degenerate rate. What looks downstream like a cautious,
indecisive judge is, in these cases, a judge that has stopped reading the
replies at all.

**Two mechanisms we proposed ourselves did not survive our own controls, and
we report the retractions rather than quietly editing them out.** We had
logged a clean ~16× same-vendor favoritism effect — a judge picking its own
company's model far more often than a trusted verdict would. A
between-judge control killed it: a judge with no vendor conflict at all
showed a *larger* effect. And the paper's original hypothesis — that the
Hindi–English code-switching itself was defeating the judges — did not
survive a translation control. Re-judging the identical 96 units machine-
translated into monolingual English moved agreement by only −3.1 to +6.6
percentage points, every interval overlapping its Hinglish counterpart, and
entirely inside this programme's own measured 13.6-point noise floor for
judged ratings on byte-identical input. It is not the code-switching. The
failure is in the judgment itself, and code-switching was the setting in
which we happened to catch it, not the cause.

### What we are releasing

The full qualification harness, including the guards that make a run refuse
to report a number rather than publish a crippled result; the 192
ground-truth verdicts with their rationales, across all seven judged axes;
both arms of both source archives, stripped of anything that isn't
{reply text, model, lane, beat}; every judgment row behind every number in
the paper; and a datasheet that states, in its own first section, that the
ground truth is LLM-produced and that "agreement" here never means
"accuracy." Code under Apache-2.0, data under CC BY 4.0.

### What this doesn't show

The ground truth is a trusted AI model's judgment, not a human one — this is
the study's largest open limitation, and we say so before anyone else has
to. It is also a single product, a single language pair, and 96 units,
adequate to reject a pre-registered bar cleanly but not to finely rank the
candidates against each other. A human-annotation run — at least two native
Hinglish raters, blind and counterbalanced the same way — is the upgrade
this paper needs before we would call the underlying construct validated
rather than merely self-consistent, and it is planned, not done.

---

## Paper page — Paper A

*(id: `paper-a-identity-ceiling`)*

### Status line

**In preparation.** Working title, incomplete data. As of the last measured
checkpoint, the primary comparison arm sits at roughly 3% of its target size
(74 of a planned 2,304 calls), rate-limited on its current compute pool to
roughly 75 calls a day — full data collection is on the order of a month
out. We are publishing this status honestly rather than not mentioning the
paper at all, and nothing on this page is a finding.

### Working title

**An Externalised, Citation-Enforced Relational-State Layer Does Not Lift a
Frontier Model Into Register Band**

### Plain-language summary

This paper is in preparation and its data is incomplete, so no results are
published yet. The question it is built to answer: if you give a different
underlying AI model the exact same compiled memory, relationship history and
context as an existing one — byte-for-byte identical input — does the
companion still feel like the same person? Early, partial data suggests the
answer is no by default: swapping the model changes surface behaviour even
when every other input is held fixed. A larger independent study published
elsewhere in 2026 found a similar pattern, so this paper's contribution is
now narrower and sharper than originally planned: whether a specific
engineering approach — externalised memory enforced by citations rather than
free text — narrows that gap. We will publish honestly whichever way the
data comes out.

### Why the scope changed

The original framing was broader: that a swapped model, given the right
context, would land inside an acceptable behavioural range regardless of
which model it was. Our own earlier measurement had already made that claim
harder to defend — an incumbent-vs-candidate bake-off on this exact product
found the incumbent winning 38 judged comparisons to 2. Then a larger,
independently published study (2,008 conversations, three memory
architectures crossed with four models) found the same shape of result: the
underlying model, not the memory scaffold around it, sets the ceiling on
whether a companion's persona survives. That result is a bigger, better-
resourced version of a claim we had already measured, which means we no
longer get to publish it as a first report.

What survives, and what has not been scooped, is a narrower and more
specific claim: whether a context that is *compiled byte-identically into
both arms by our production engine*, rather than a generated memory
narrative fed to the model, changes the picture. That is an engineering
claim about a specific architecture, not a claim about model swapping in
general, and it is the paper we are now building.

### What exists today

A compiled-context corpus of 2,304 distinct, hash-verified contexts, built
so that both the incumbent and candidate model are served byte-identical
input by construction. The candidate arm is fully generated against that
corpus — 2,304 of 2,304 replies, no errors. One early, unadjudicated
observation from that raw generation: seven instances of native-script
(Devanagari) characters against an axis this product treats as a hard
failure at any occurrence, in a model given no memory-layer mitigation by
design — this run measures the swap with nothing added yet, which is the
paper's baseline condition, not its test condition.

What's missing is the matched incumbent-side data at the same scale, and a
qualified judge for the relational-preference axes of the comparison — the
second gap is, concretely, blocked on Paper B's own subject matter: no
credit-billed candidate judge has yet cleared qualification for this kind of
task.

---

## How we work

Three practices, all measured against our own record rather than asserted
about it.

### We fix the bar before we see the data

A qualification threshold decided after looking at results is not a bar, it
is a description of whatever happened to pass. For the judge-qualification
study, the ≥80% agreement threshold and the method for computing it were
committed to our internal history two days before any candidate judge ran;
the instantiation of that bar for this specific study was committed 25
minutes before the first backtest result existed. We cite the commit hashes
rather than assert the sequence, because a claim about pre-registration that
can't be checked isn't one.

### We retract our own findings when our own controls refute them

Two logged results in this programme's history did not survive controls we
ran on ourselves, and both are written into the paper rather than quietly
corrected out of it. A same-vendor judge favoritism effect, cleanly measured
at roughly sixteen times the base rate, did not survive a between-judge
control — a judge with no vendor conflict at all showed a larger effect,
which is the opposite of what the favoritism explanation predicts. And the
paper's own original hypothesis, that Hindi–English code-switching was
defeating the judges, was refuted by translating the same material into
English and re-running the identical protocol. We treat both retractions as
the strongest evidence for the paper's broader argument, not as a mark
against it: a plausible mechanism, cleanly measured, with a control that
looked adequate at the time, can still be wrong — which is exactly the
failure mode the paper is about.

### Every number carries n, method, and date

A statistic without a sample size, a stated method, and a date attached
cannot be compared against a future re-measurement of the same thing, which
is the only reason to record a number at all. This is not a style
preference; it is enforced because we have already been burned by its
absence. One internal metric was reported once without enough data to
distinguish a real effect from measurement noise, and a later, properly
powered re-run of the identical setup found the "effect" moved by up to 75
percentage points on byte-identical input with nothing changed. Any claim
from that instrument below the sample size that produced that swing is now
treated as noise by policy, not by judgment call.

### Releases ship with their limits stated first

When we release a dataset, its datasheet says what the data is not before it
says what it is. The judge-qualification release states, in its own opening
section and its own voice, that the ground truth in it was produced by an AI
model rather than human annotators, and that every "agreement" figure in the
release means agreement with that one trusted judge — never "accuracy"
against some independent truth. Before anything ships, the release also runs
through a 22-point de-identification sweep against the actual built package,
not the source tree it was built from; on the first run, that sweep caught
and forced a fix for a real leak — a provider error message that had
silently embedded a full cloud-tenant hostname three layers away from
anywhere a person would have thought to check by hand.

---

## Standalone results

Measured findings that stand on their own, outside either paper — cited with
the same discipline: n, method, date, source.

### Structural privacy beats instructed privacy, completely

In a shared-memory setting where a companion holds context across more than
one person, telling the model *"don't share this with people who shouldn't
see it"* as a prompt instruction leaked in 57.1% of naturalistic test
scenarios and 98.1% of adversarial ones. Replacing the instruction with a
database-level predicate — the model is structurally never shown the
disqualifying rows in the first place — leaked zero times across 494
disclosure scenarios and 31,122 row-by-scenario checks. A negative control,
built to catch a broken harness rather than a broken predicate, correctly
flagged 162 violations when the rule was deliberately weakened, which is how
we know the zero is real and not an artifact of an insensitive test.
*(n = 494 scenarios / 31,122 checks, measured 2026-08-18.)*

### Doubling engagement without a detectable rise in fabrication

Tuning how a companion comments on a screen shared with her roughly doubled
how often people engaged when she paused — 20.4% to 41.7% — on a matched
stimulus set. A properly powered confirmatory run, at a sample size large
enough to separate signal from this metric's own known noise floor, found no
statistically detectable rise in how often she described something that
wasn't actually on screen (10.2% to 11.2%, a difference whose 95% confidence
interval spans −3.1 to +5.1 points). We state that as "no difference
detected," not "no difference exists" — a true rise of up to five points is
still consistent with the data. *(n = 3,201 new calls, confirmatory
comparison at n = 313 and n = 695 judged assertions, measured 2026-08-15.)*

### The ground truth's own reliability ceiling

Before treating any archived AI-judged decision as ground truth for a
downstream evaluation, we measured how reproducible that judge's own
verdicts are by having it re-judge the same material, blind and
counterbalanced, under the identical protocol a week later. It reproduced
itself on 74 of 96 units — 77.1%, 95% CI [67.7%, 84.4%] — below the 80%
qualification bar we had set for replacement judges before this measurement
existed. Any future qualification bar on this programme is now set relative
to a measured ceiling, not a round number. *(n = 96 units / 192 judgments,
measured 2026-08-18.)*

### Caching makes the unit economics work

For a companion product that re-sends a large, mostly static context on
every turn, prompt caching cut real, measured serving cost by roughly 9×
on an identical turn ($0.0017 cached vs. $0.0160 uncached), with a measured
production cache-hit rate of 99.8–99.9%. At those rates, $5,000 of inference
buys on the order of 2.7 million chat turns or 35,000 ten-minute voice
calls. Compute cost is a solved constraint for this product's shape; we
spend our attention on quality instead. *(Live production API calls,
measured 2026-08-11.)*

---

## The release: `vyakti-judge-qual`

A generalised judge-qualification harness and dataset, released so other
teams evaluating LLM judges on affective or open-ended preference tasks can
run a real backtest of their own rather than assuming a judge is trustworthy
because it's a frontier model.

**In the release:** the qualification harness itself, including the
transport- and parse-validity guards that make a run self-invalidate rather
than report a result computed on a crippled subset; 192 ground-truth
verdicts with free-text rationales across all seven judged axes — the
scarcest thing in the release; both arms of both source archives, stripped
to reply text plus {model, lane, beat, replicate}; every judgment row behind
every number in the paper, more than 8,000 rows in total across the primary
run and two extensions; a per-vendor deployment quirk log (token-parameter
naming differences, silent hidden-reasoning token burn, output-format
violations) that practitioners will likely use more than the headline
results; and a datasheet, in the Gebru style, that states its own
limitations in its own first section before anything else.

**Not in the release:** the product's persona prompt. It is not needed for
any claim the paper makes, and archived files that embedded it were run
through an extraction script rather than copied directly — the built bundle
passes a 22-point de-identification sweep before anything ships, including a
literal check that the persona text is absent.

**Licenses:** Apache-2.0 for the code, CC BY 4.0 for the data.

**Status:** built and internally gated; the public repository URL will post
alongside the paper's arXiv preprint.
