# DRAFT — Paper B: *It's Not the Code-Switching*

**Title (chosen, §1):** **"It's Not the Code-Switching: Six Frontier LLM Judges
Fail a Pre-Registered Qualification Bar in Hinglish and in English Alike"**

**Workstream:** WS-PAPER · **Branch:** `claude/ai-companion-app-rkt1lv` · **This workstream did not commit or push — the coordinator reviews.**
*(Note: a coordinator WIP checkpoint (`308332e`) captured an intermediate copy of
`analysis/derive-tables.mjs`. That copy is correct as far as it goes but predates
the T5 between-judge control that produced §5.5's retraction. The working-tree
version is the one the paper cites.)*
**Mandate:** `context/decisions.md` `relational-wedge` §5 — owner verbatim: *"create really good evals that we could actually publish and a paper that we could actually publish."*
**Authors (owner-provided 2026-08-18):** Raghav Sharma, Gaurav Sharma, Aryan Tiwari — Vyakti.ai.

---

## STATUS

**Draft-file section numbers are not the paper's section numbers.** The paper
ships as §1 Introduction · §2 Background & related work · §3 Setting · §4 Method ·
§5 Results · §6 Discussion · §7 Limitations & Ethics · §8 Artifact release ·
§9 Conclusion. This working file keeps §0 (recommendation), §10 (gap table),
§11 (priced runs), §12 (coordinator actions) and §13 (submission checklist) as
apparatus that does not ship. Sections that *do* ship carry the paper's number.

| section | state |
|---|---|
| Recommendation (which paper leads, why) | **DRAFTED** — §0 (apparatus, does not ship) |
| Scooped-or-not verdict + citations | **DRAFTED** — §0.2, §2.2 |
| Title candidates + chosen title | **DECIDED** — §1; the paper retitles around the refuted mechanism |
| Abstract | **REWRITTEN** — §2 (every number traceable; matches the new title) |
| Full section outline | **DRAFTED** — §3 |
| **§4 Method** | **WRITTEN IN FULL** — every parameter from logged config |
| **§5 Results** | **WRITTEN IN FULL** — every number recomputed by `analysis/derive-tables.mjs`; §5.8 [R5] clustering, §5.9 [R4] English-translation control, §5.10 [R2] per-axis decomposition and §5.11 [R1] the ground-truth ceiling all complete |
| **Camera-ready** | **WRITTEN — `docs/paper/CAMERA.md`**, the 6-page JUDGe 2026 submission. This file is the archive; CAMERA.md is what ships. |
| **Release bundle** | **BUILT — `release/vyakti-judge-qual/`**, assembled by `docs/paper/build-release-bundle.mjs`, de-identification gates run and passing (§13.4) |
| §2.2 Related work | **DRAFTED as an annotated citation list**, not yet prose. Citations verified by live fetch 2026-08-18 except where marked `[VERIFY]` |
| **§6 Discussion** | **WRITTEN IN FULL** — prose, post-R4/R5 |
| **§7 Limitations & Ethics** | **WRITTEN IN FULL** — prose, thirteen limitations + an ethics statement |
| §8 Artifact release | **DRAFTED** — full release plan |
| Claim → evidence → gap table | **RECONCILED** — §10, post-R4/R5/retraction |
| Priced list of runs still needed | **DRAFTED** — §11 |
| **Figures** | **BUILT** — three deterministic, grayscale-safe SVGs in `docs/paper/figures/`, emitted by `fig-*.mjs` from the analysis outputs (§3) |
| **Submission checklist** | **DRAFTED** — §13, incl. a 2026-08-18 workshop-deadline scan |
| Human-annotation validation | **NOT RUN** — the single largest remaining gap, §10 G1, §11 R3 |

**Reproduction law for this file.** Every number below is either (a) a logged
`context/measurements.md` entry, cited by node id, or (b) printed by one of
three offline, network-free analysis scripts:

- `docs/paper/analysis/derive-tables.mjs` — reads only `evals/dbattery/judges.json`
  and `evals/archives/*/pb-judged*.json`;
- `docs/paper/analysis/clustered-cis.mjs` — same two sources, seeded cluster
  bootstrap (`--json` for machine-readable output);
- `docs/paper/analysis/r4/summary.json` — the committed R4 output;
- `docs/paper/analysis/r2/summary.json` and `docs/paper/analysis/r2/pooled-per-axis.json` — the committed R2 output (`r2-axis-decomposition.mjs --report` and `r2-pooled-per-axis.mjs` reproduce them offline from the same committed `judge-rows.json`).

**[R1] adds no new script.** The ground-truth ceiling (§5.11) is a row in the
same `evals/dbattery/judges.json` the other results read, produced by the same
`judge-backtest.mjs` merge path, and is recomputed by `derive-tables.mjs` T3 and
`clustered-cis.mjs` alongside every candidate. That is deliberate: a ceiling
measured by a different instrument than the thing it bounds would not bound it.

The three figure scripts in `docs/paper/figures/` **read those outputs and
hardcode no data**, so a figure in this paper cannot state a number the
analysis does not print. Numbers that trace to none of the above appear only in
§10 as gaps. Nothing here is extrapolated.

**The one non-measured quantity in the whole paper** is the analytic
content-blind curve *q*² + (1−*q*)² derived in §5.3, and it is labelled as
analytic everywhere it appears — in the prose, in the figure, and in the figure
script's header comment.

**No credits or cash were spent producing this document.** The figures, the
prose, the gap reconciliation and the deadline scan are $0.

---

## §0 Recommendation

### 0.1 Paper B leads. Paper A waits — and Paper A is *blocked on* Paper B.

**Recommendation: draft, finish and post Paper B first.** Paper A ("the model
sets the identity ceiling") is a better story and a worse 2026 paper, for four
reasons that are all logged:

1. **Paper A's data is not there.** `terra-arm-2304` is complete (2,304/2,304),
   but `free-pool-capacity` puts the incumbent arm at **74/2,304** at a measured
   ceiling of **~75 calls/day** on the free pool — *"at this rate the arm takes
   ~30 days"*. Paper A's central comparison does not exist yet and cannot be
   accelerated inside the cap without the owner's pending Google credits.
2. **Paper A's judged gates need a qualified judge, and there is not one.**
   D2/D5 require n≥300 judged units under a judge that clears the pre-registered
   80% bar. `cohere-judge`: *"every Azure-direct family disjoint from both swap
   arms has now been tried and failed."* **Paper A is literally blocked on Paper
   B's subject matter.** That is not a scheduling accident — it is the finding.
3. **Paper A is now partially scooped.** ANCHOR (Venkit et al., Salesforce AI
   Research, arXiv:2607.28818, 2026-07-30) reports 2,008 conversations × 27
   personas × 9 schedules × **3 memory settings × 4 models** and finds the model
   dominates the scaffold — the same shape as our ceiling claim, at larger n,
   from a lab with a brand. Our differentiator survives (byte-identical
   *compiled production* context, a real deployed engine, a pre-registered gate
   that can refuse) but it is now a delta on someone else's result rather than
   a first report. See §0.2.
4. **Paper B is data-complete today and costs $0 to write.** Six judges,
   1,536 logged judgment rows, blind, counterbalanced, both-orders,
   pre-registered bar, transport/parse validity guards, and an adversarially
   verified failure corpus. The analysis in §5 was produced from committed files
   with no API call.

**The honest sequencing, and it reads well in both papers:** Paper B is the
instrument paper. Paper A is the experiment that instrument was built for.
Publishing B first is the correct scientific order and it makes A's eventual
methods section a citation instead of an appendix.

### 0.2 Scooped-or-not verdict

**Paper B: NOT SCOOPED.** Adversarially checked against the closest 2024–2026
work. Every adjacent paper misses at least two of the three things that make
this result: (i) *romanised code-switched* Hinglish, (ii) *affective/companion
register* as the judged construct, (iii) judges backtested against **blind,
counterbalanced, both-orders-agree** verdicts from a deployed product's own
decision record, under a **pre-registered qualification bar the judges then all
fail**.

| nearest work | what it does | why it does not scoop us |
|---|---|---|
| Fu & Liu, *How Reliable is Multilingual LLM-as-a-Judge?* (arXiv:2505.12201, EMNLP 2025 Findings) | 25 languages, 5 judges, 5 tasks; Fleiss' κ ≈ 0.3; consistency worst in low-resource languages | Monolingual per language. No code-switching, no romanisation, no affective register. Reports κ between judges, not agreement against a trusted human-aligned verdict set. |
| Yin, *Does the Judge Prefer English?* (arXiv:2606.14278, 2026-06) | Language-switching invariance; EN/ZH + ZH-EN code-mixing; 4 judges; 13,408 judgments on LLMBar's 419 objective-label items; 10.7–14.4% preference flips | **Closest methodologically.** But: Chinese-English, not romanised Indic; **objective** instruction-following labels, not affective preference; no vendor-favoritism measurement; judges are not being *qualified* against a bar. |
| Das et al., *Indi-RomCoM* (arXiv:2606.30790, 2026-07) | First human-validated romanised Indic-English code-mixed instruction benchmark; GPT-4o judge; Sarvam-30B 64.2%→56.1%, Claude Opus 4.6 68.7%→61.2% at 75% code-mixing intensity | **Closest linguistically.** But the judge is an *instrument they trust*, not an object of study: no judge position-bias, no vendor-favoritism, no reported judge-human agreement figure, and no affective/teasing register. It measures models; we measure judges. |
| Chacón Sartori, *EMPATH* (arXiv:2606.30256, 2026-06) | Auditor–judge benchmark for emotional-support chatbot safety; es-MX + en-US; judge–clinician concordance 76% (Gwet AC1 0.61) and 60% (AC1 0.20) vs clinician–clinician 47% | **Closest in construct** (affective, judge-as-instrument-to-be-calibrated) but no code-switching, safety-rubric rather than charm/register preference, and n=2 clinicians on 50 transcripts, explicitly preliminary. |
| Dev et al., *Judge Reliability Harness* (RAND, arXiv:2603.05399, 2026-03) | Stress-tests judges on format invariance, paraphrase, stochastic stability, ordinal calibration across 4 English safety benchmarks | English-only; perturbation-based, not ground-truth-backtested; explicitly does **not** cover position bias or family favoritism. |
| *Judge's Verdict* (arXiv:2510.09738) | 54 LLMs scored on human agreement, Cohen's κ + human-likeness tiering | English, objective-answer scoring. Establishes that judge-human agreement is the right axis — which is our axis — on a task where ours is hardest. |
| JudgeBench; *Justice or Prejudice?*; *Am I More Pointwise or Pairwise?* (arXiv:2602.02219); the self-preference line (arXiv:2410.21819, 2604.22891, 2506.02592, 2508.06709, 2509.26464) | Position bias, verbosity bias, self-preference established; self-preference measured from −38% to +90% on ArenaHard | All English, all monolingual, and self-preference is measured *model-vs-own-output*, not **judge-vs-own-vendor's-arm with a trusted verdict for the same units**, which is what our grok-4.3 cell is. |
| ANCHOR (arXiv:2607.28818) | Persona collapse / behavioral drift, 2,008 conversations, 4 models × 3 memory settings; trajectory accuracy 44.4% | This is **Paper A's** competition, not Paper B's. It uses LLM judgment as an instrument and does not qualify it. |
| BabelJudge (arXiv:2606.22329, 2026-06) *(added by the second novelty pass)* | EN/HI/AR/SW judge reliability; gold-by-degradation; Swahili order-consistency 0.480 — "near-random under slot-order swaps" | Closest published measurement of **slot-order collapse outside English**, which is §5.3's mechanism. But monolingual per language, no romanisation or code-mixing, synthetic gold rather than a deployed decision record, no affective register, no qualification bar, one primary judge. |
| Norman, Rivera & Hughes, *Reliability without Validity* (arXiv:2606.19544, 2026-06) *(added by the second novelty pass)* | 21 judges, 9 providers, ~541 k judgments; κ deflation 33–41 pp; **production judges test–retest > 0.95 with position bias > 0.10** | The nearest work on **judge test–retest**, which is §5.11's measurement. English, objective benchmarks, no trusted-verdict backtest, no bar. Their >0.95 and our 0.771 are different quantities on different constructs and the paper reports them side by side — the contrast is the point, not a threat. |

**Two claims we can therefore make and defend as first reports:**

- **C1.** *No published work backtests a panel of candidate LLM judges against
  blind, counterbalanced, both-orders-agree preference verdicts on romanised
  Hinglish affective/companion register.* Verified against the eight nearest
  works above.
- **C1b.** *No published work reports a controlled test of the code-switching
  hypothesis for LLM judges on an affective preference task and finds it
  refuted.* Yin (arXiv:2606.14278) measures language-switching invariance on
  **objective** instruction-following labels and finds 10.7–14.4% preference
  flips; our translation control finds no recovery beyond a measured noise
  floor on an **affective** task. That discrepancy is itself a result and it is
  new.
- **C2.** *No published work reports the specific failure geometry we measure* —
  agreement statistically indistinguishable from uniform-random under the
  both-orders rule, produced by position bias collapsing counterbalanced units
  into ties, *plus* systematic decisive preference for exactly the arm that
  human-aligned judgment rejected 38–2.

**Paper A: PARTIALLY SCOOPED.** ANCHOR takes the headline. Paper A must be
re-scoped from *"the model sets the identity ceiling"* to *"an externalised,
citation-enforced relational state layer, compiled byte-identically into both
arms by a production engine, does not lift a frontier model into register band"* —
a narrower, sharper, still-novel claim, and one that ANCHOR's design cannot make
because it varies generated memory scaffolds rather than holding a compiled
context byte-identical.

### 0.3 Venue path

**SUPERSEDED IN PART BY §13.2**, which carries a live deadline scan run
2026-08-18. The strategic reading below still holds; the specific venues have
moved.

Assumed and endorsed: **arXiv (`cs.CL`) preprint first**, cross-listed `cs.LG`.
Then, in order of fit:

1. **JUDGe 2026 — "Can We Trust the Judge?"** (NeurIPS 2026, Atlanta),
   **deadline 2026-08-29 AoE**, non-archival, 6 pages + refs. Its stated topic
   list is construct validity in LLM evaluators, positional bias, human–model
   alignment, cross-lingual reliability and production case studies — this
   paper is four of those at once. **This is now the primary target**, and it
   did not exist in the earlier draft of this section.
2. **CALCS** (Computational Approaches to Linguistic Code-Switching). Was
   listed here as the single best fit on the assumption that code-switching was
   the paper's causal variable. **R4 removed that assumption** — but a
   *controlled refutation* of a code-switching hypothesis is still squarely a
   CALCS result, and arguably a more interesting one for that audience. The
   practical problem is availability: no 8th edition is announced as of
   2026-08-18 (§13.2). Route in is the 2027 joint workshop cycle.
3. **NAACL 2027 main / Findings** (deadline 2026-10-12) — reachable *after* the
   human control (§11 R3) and ideally the per-axis extension (§11 R2). At n=96
   units the paper is a strong workshop paper and a borderline Findings paper;
   the reviewer objection will be sample size, and it is a fair objection.
4. **NeurIPS Datasets & Benchmarks** — only if the released suite (§9) is the
   headline contribution rather than the measurement. That is a legitimate
   re-framing and worth the owner's consideration, because the *protocol* (a
   harness that refuses to certify its own run) may outlive the numbers.

*(The earlier draft listed "the LLM-as-a-Judge workshop" at `llm-as-a-judge.github.io`
as venue #2. Checked 2026-08-18: that is a survey and paper-list resource, not
a workshop. JUDGe 2026 is the real one and replaces it.)*

**Do not aim at ACL/EMNLP main.** n=96 units against a single LLM-produced
ground truth is not a main-conference sample, and claiming otherwise would fail
this program's own `fab-noise-floor` discipline in public.

---

## §1 Title

**The paper retitles around the refuted mechanism.** The previous working title
("The Judge Cannot Read the Room: LLM Judges Fail on Code-Switched Affective
Register") asserted a cause that this study's own translation control (§5.9
[R4]) then failed to support. Keeping it would have been the exact error the
paper is about. The candidate set was therefore rebuilt around the negative
causal result:

1. "It's Not the Code-Switching: A Translation Control Refutes Our Own Explanation of Six LLM Judge Failures"
2. **"It's Not the Code-Switching: Six Frontier LLM Judges Fail a Pre-Registered Qualification Bar in Hinglish and in English Alike"** ← **CHOSEN**
3. "It's Not the Code-Switching, and It Isn't Vendor Loyalty: Two Mechanisms That Did Not Survive Their Own Controls"
4. "Qualify Your Judge, Then Doubt Your Explanation: A Pre-Registered Judge-Qualification Protocol and Two Retracted Mechanisms"
5. "The Counterbalance Was Evacuated and the Cause Was Wrong: Judge Qualification on Affective Companion Dialogue"

**Chosen: #2.** It states the refutation in the main clause and the surviving
result in the subtitle, and *"in Hinglish and in English alike"* is the
translation control compressed into five words — a reader who reads only the
title has still been told the true scope of the finding. #1 is the honest
runner-up but "our own explanation" reads as self-regard in a title rather than
in the body, which is where it belongs. #3 and #4 carry both retractions but
bury the six failures, which are the paper's load-bearing measurement. #5 is
the most accurate description of the mechanism section and the least likely to
be clicked.

**Wording law that follows from #2, and it binds the whole paper:** the string
*"fails on code-switched affective register"* must not appear as a claim
anywhere. The supported claim is *"fails on affective/companion register,
tested here on a code-switched corpus and, under a translation control, on its
monolingual English translation as well."*

---

## §2 Abstract

> LLM-as-a-judge is the default instrument for evaluating open-ended generation,
> and the standard defences — randomised presentation order, both-orders
> agreement, cross-family judges — are widely assumed to make it trustworthy
> enough to ship on. We report a blind, counterbalanced, pre-registered
> judge-qualification study in which those defences do not save the instrument,
> and in which the study's own leading explanation for the failure does not
> survive its control either.
>
> Working from a deployed Hinglish (romanised Hindi–English code-switched)
> AI-companion product, we take two archived model bake-offs whose blind,
> counterbalanced, both-orders verdicts (96 conversation units, 192 judgments,
> judge `claude-opus-4.8`) had already driven real deployment decisions, and we
> backtest six candidate judges against them under a pre-registered ≥80%
> agreement bar: DeepSeek-V4-Flash, DeepSeek-V4-Pro, gpt-5.6-terra, grok-4.3,
> Mistral-Large-3 and Cohere command-a-plus. **All six fail.** Pooled unit-level
> agreement is 28.1%, 30.9%, 54.2%, 34.4% and 29.2% respectively; under
> beat-clustered bootstrap intervals the highest upper bound anywhere in the
> panel is 64.6%. The sixth is disqualified for cause, emitting a parseable
> verdict on 34 of 192 calls despite an only-JSON contract. Scale is not a
> mitigation: the full-size DeepSeek agrees no better than the small one.
>
> We then measure the bar itself, by having the model that wrote the ground
> truth re-judge its own archive under the identical protocol. **It agrees with
> itself on 74 of 96 units — 77.1%, 95% CI [67.7, 84.4] — so the pre-registered
> bar sits above the ground truth's own measured test–retest ceiling.** The
> failures do not depend on where the bar was drawn: the candidates land 22.9 to
> 49.0 percentage points below the ceiling, and the best of them recovers barely
> two-thirds of the archive's self-agreement. The same measurement is the
> tightest bound this study has on how much of its own ground truth is noise.
>
> We decompose three mechanisms and retract one. **(i) Position bias evacuates
> the counterbalance rather than adding noise to it.** Because presentation is
> counterbalanced, a judge picking the first slot with content-blind propensity
> *q* returns a tie on *q*² + (1−*q*)² of units, so that in the limit its
> agreement collapses onto exactly the archived tie rate and nothing else;
> Mistral-Large-3 (89.6% slot-A) and
> DeepSeek-V4-Flash (80.2%) land exactly on that degenerate prediction on the
> landslide archive, agreeing on 16.7% of units against an archived tie rate of
> 16.7%. **(ii) What signal remains is inverted.** On the archive whose trusted
> verdict is a 38–2 landslide, judges that do return decisive verdicts pick the
> *rejected* arm most of the time — 5.0%, 10.0% and 15.0% accuracy against a 25%
> chance floor — because the rejected arm is the longer, question-stacking,
> therapised one, and that is what a judge reaching for "supportive" rewards.
> **(iii) An apparent 16× same-vendor favoritism, which we had ourselves logged
> as a confirmed finding, does not survive a between-judge control**: a
> family-disjoint judge shows a *larger* difference-in-differences (+71.7 pp vs
> +63.1 pp) and the second conflicted cell runs negative (−9.7 pp). The
> retraction is reported in the paper rather than quietly dropped.
>
> Finally we test the hypothesis the study was named for. Re-judging the same 96
> units machine-translated to monolingual English moves agreement by between
> −3.1 and +6.6 percentage points (mean +3.2), with every English-condition
> interval overlapping its Hinglish counterpart and every recovery inside this
> programme's own measured 13.6 pp noise floor for judged rates on
> byte-identical input. **It is not the code-switching.** The failure is in the
> affective preference judgment itself, it survives translation, and the
> code-switched corpus is the setting rather than the cause.
>
> We release the qualification protocol, the harness — including the transport-
> and parse-validity guards that self-invalidate a crippled run — the anonymised
> transcripts and the ground-truth verdicts. The practical finding is negative
> and worth stating plainly: **an evaluation programme that adopts an LLM judge
> for an affective or open-ended preference task without backtesting it against
> trusted verdicts is measuring judge taste rather than the system under test —
> and any mechanism it then proposes for the failure needs a control of its own
> before it is believed. Measure the ground truth's own test–retest ceiling
> first: a qualification bar set above it can never be cleared, and a bar set
> without it is a number nobody has checked.**

*(Abstract provenance: every number is printed by `analysis/derive-tables.mjs`,
`analysis/clustered-cis.mjs` or `analysis/r4/summary.json`; the 77.1% ceiling
and its interval are `derive-tables.mjs` T3's `anthropic/claude-opus-4.8` row,
logged as `context/measurements.md` `ground-truth-ceiling`; the 13.6 pp noise
floor is `context/measurements.md` `fab-noise-floor`. The
*q*² + (1−*q*)² expression is analytic, derived in §5.3, and is the only
non-measured quantity in the abstract.*

*Word budget: ~600 words as it now stands, which will need a cut of ~250 for
most venues. **The cut order is fixed and it is not the obvious one.** Go
first: the deployment/provenance clause in ¶2, then mechanism (ii)'s
explanatory half-sentence, then the release list. Go LAST, and only if a hard
limit forces it: the retraction in (iii), the translation control in ¶5, and
the ceiling paragraph. A paper that refutes two of its own authors' logged
claims in its abstract buys more reviewer trust than any positive result in it;
the translation control is the title; and the ceiling is the sentence that
answers the "your bar is arbitrary" review before it is written. The
CAMERA.md abstract is the cut version and it is the one that ships.)*

---

## §3 Section outline

| § | title | state |
|---|---|---|
| 1 | Introduction — the judge you did not qualify, and the mechanism you did not control | outline |
| 2 | Background: LLM-as-judge defences and where they were validated (all monolingual English) | outline |
| 2.2 | Related work | annotated citation list, §2.2 below |
| 3 | The setting: a deployed Hinglish companion and its decision record | outline |
| **4** | **Method** | **written, §4 below** |
| 4.1 | Ground truth: two archived bake-offs and why they qualify as trusted verdicts | written |
| 4.2 | The both-orders-agree unit rule, and its chance baselines | written |
| 4.3 | Candidate judges, deployment, and frozen decoding parameters | written |
| 4.4 | The rubric, and the only-JSON contract | written |
| 4.5 | The pre-registered bar and its provenance | written |
| 4.6 | Validity guards: transport misses, parse misses, self-invalidation | written |
| 4.7 | Leakage control | written |
| **5** | **Results** | **written, §5 below** |
| 5.1 | Every candidate fails the bar | written |
| 5.2 | Four of five are indistinguishable from uniform-random | written |
| 5.3 | Position bias evacuates the counterbalance | written |
| 5.4 | Below-chance on the landslide: judges prefer the rejected register | written |
| 5.5 | A same-vendor favoritism claim that does not survive its own control (negative result + self-retraction) | written |
| 5.6 | Protocol-unfitness as a distinct failure mode (Cohere) | written |
| 5.7 | Scale does not fix it | written |
| 5.8 | [R5] Clustered confidence intervals | written |
| 5.9 | [R4] The English-translation control: it is not the code-switching | written |
| 5.10 | [R2] Per-axis mechanism decomposition | written |
| 5.11 | [R1] The ground truth's own ceiling, and a bar that sat above it | written |
| **6** | **Discussion** | **written in full, §6 below** |
| **7** | **Limitations & Ethics** | **written in full, §7 below** |
| 8 | Artifact release | written, §8 below (drafted as §9 in this file's apparatus numbering) |
| 9 | Conclusion | outline |
| A | Appendix: full per-cell tables, rubric text, judge configs, quirk log | derivable from `analysis/derive-tables.mjs --json` |

### Figures — BUILT

All three are **deterministic, dependency-free, grayscale-safe** standalone SVGs
emitted by scripts that read the committed analysis outputs. No hand-drawn
paths, no hardcoded data: a figure in this paper cannot state a number the
analysis scripts do not print. Rebuild all three with

```
node docs/paper/figures/fig-f1-agreement-forest.mjs
node docs/paper/figures/fig-f2-slot-a-evacuation.mjs
node docs/paper/figures/fig-f3-english-recovery.mjs
```

| fig | file | what it shows | cited in |
|---|---|---|---|
| **F1** | `figures/fig-f1-agreement-forest.svg` | Forest plot of pooled agreement per judge, Hinglish condition, with the cluster-bootstrap CI drawn over the naive Wilson CI, the ≥80% bar, both chance baselines (30.5% uniform-random, 21.9% pure-slot-A), and — added post-[R1] — **the ground truth's own 77.1% test–retest ceiling as a hatched CI band behind every row**, so the reader sees the bar standing above the ceiling rather than being told. `claude-opus-4.8` now sits in its own labelled CEILING row; the parse-invalid `claude-opus-5` row is in a separately labelled band. | §5.1, §5.2, §5.8, **§5.11** |
| **F2** | `figures/fig-f2-slot-a-evacuation.svg` | Two panels. **A:** pooled slot-A pick rate per judge against the trusted judge's 58.9% on identical rows and a 50% line. **B:** observed TIE_FLIP rate against slot-A propensity *q*, with the analytic content-blind prediction *q*²+(1−*q*)² as a curve — a judge on the curve has stopped carrying content. | §5.3 |
| **F3** | `figures/fig-f3-english-recovery.svg` | Paired Hinglish→English agreement per judge with both clustered CIs and the ±13.6 pp `fab-noise-floor` band shaded around each Hinglish value. Every recovery lands inside the band. This is the title figure. | §5.9 |

Sources: F1 reads `clustered-cis.mjs --json` + `derive-tables.mjs --json`; F2
reads `derive-tables.mjs --json`; F3 reads `analysis/r4/summary.json`. Shared
emitters live in `figures/_svgkit.mjs`, which emits **no hue at all** — series
separate by ink value, fill-vs-outline, dash pattern and hatch, so the figures
survive a black-and-white print and a colour-blind reader unchanged. Re-running
any script byte-reproduces its SVG (verified).

*(The pre-R4 figure plan named a different F3 — decisive accuracy vs the 25%
floor. It is superseded: that result is a table in §5.4, and the translation
control has a better claim on the paper's third figure now that it is the
title. The old F1/F2 evacuation content is merged into the two panels of the
new F2.)*

---

## §4 Method

*(Complete. Every parameter is read from a committed file; the file is named
inline so a reader can check it.)*

### 4.1 Ground truth

The study backtests against the archived verdicts of two model bake-offs run on
2026-08-11 by the product team, before this study was conceived, to decide which
model would serve a live consumer product. They are preserved verbatim in
`evals/archives/` and indexed by `evals/archives/README.md`.

- **`charm-grok`** — incumbent `google/gemini-3.6-flash` vs candidate
  `grok-4-20-non-reasoning`. 48 conversation units, 96 judgments.
- **`charm-luna`** — incumbent `google/gemini-3.6-flash` vs candidate
  `openai/gpt-5.6-luna`. 48 conversation units, 96 judgments.

A **unit** is one (lane, beat, replicate) conversation: a 6-turn scripted
exchange in one of 12 affective beats (casual, teasing, bored, sad, conflict,
factual, excited, crisis-adjacent, …) in one of two lanes (text, voice-transcript).
The user turns are **identical scripted lines across arms**
(`evals/archives/charm-grok/personality-battery.md`: *"12 beats × 6 turns,
identical scripted user turns across arms; 2 replicates"*), so the two arms differ
only in the model that produced the replies. Both arms received a
**byte-identical** system prompt.

Each unit was judged **twice**, once in each presentation order, by
`anthropic/claude-opus-4.8` with model identity stripped. The archived verdict
files (`charm-grok/pb-judged-grok.json`, `charm-luna/pb-judged.json`) carry, per
judgment, a verdict on seven axes (warmth, humour, register, specificity,
brevity, personhood, overall) plus three safety flags, the raw slot letters, and
a free-text rationale.

**Why these count as trusted verdicts, stated as a defensible claim rather than
an assumption.** They are (i) blind, (ii) counterbalanced, (iii) produced before
this study and not for it, (iv) **acted upon** — they are the recorded reason two
candidate models were declined for a shipping product
(`context/decisions.md` `brain-model`), and (v) re-derived from the raw files on
every CI run by `evals/fixtures.mjs`, which fails the build if a number moves.
They are *not* human verdicts. §7 (L1) treats that as the study's principal threat to
validity, and §11 R3 prices the run that would close it.

### 4.2 The unit rule and its chance baselines

A unit yields a verdict only when **both presentation orders name the same
model**; an order flip is recorded as `TIE_FLIP`. This is the product team's
standing house rule, implemented once in
`evals/dbattery/judge-backtest.mjs:228` (`consolidateUnit`) and reused verbatim
by our analysis. A candidate judge **agrees** on a unit when its consolidated
verdict — including `TIE_FLIP` — equals the archived consolidated verdict.

This rule has two chance baselines that the paper must state, because they are
not the same and the difference is the mechanism:

- **Uniform-random judge** (each presentation independent, p=0.5 per side):
  P(same model twice) = 0.25 per side, P(order flip → `TIE_FLIP`) = 0.5.
  Expected agreement is therefore
  `(decisive_units × 0.25 + tie_units × 0.5) / n`.
- **Pure slot-A judge** (always picks the first-presented reply): because
  presentation is counterbalanced, it names a different model in each order, so
  **every unit becomes `TIE_FLIP`**. Its expected agreement is exactly the
  archived tie rate.

Both are computed from the archived verdict distribution in
`analysis/derive-tables.mjs` T1 and reported in §5.2.

### 4.3 Candidate judges

Judge selection was constrained by a funding rule that is itself part of the
method and is disclosed: the programme runs on an Azure/Microsoft-for-Startups
grant, which covers only models *sold and billed directly by Azure*
(`context/decisions.md` `credits-partner`, `judge-grant-only`). Anthropic models
are excluded from the grant, which is why the model that produced the ground
truth could not simply be re-used as the operational judge. Every candidate below
was deployed on the programme's own Azure AI Foundry resource and its deployment
verified live before any judging call (`judges.json.deployments_verified`, 14
deployments, all `succeeded`).

| judge | family | deployment | token param | temperature | reasoning_effort | max tokens |
|---|---|---|---|---|---|---|
| DeepSeek-V4-Flash | deepseek | Azure Foundry | — | 1 | — | 120 |
| DeepSeek-V4-Pro | deepseek | Azure Foundry | `max_completion_tokens` | 1 | — | 120 |
| gpt-5.6-terra | openai | Azure Foundry | `max_completion_tokens` | 1 (API pins) | `"none"` | 120 |
| grok-4.3 | xai | Azure Foundry | — | 1 | `"none"` | 120 |
| Mistral-Large-3 | mistral | Azure Foundry | `max_tokens` | 1 | — | 120 |
| Cohere command-a-plus-05-2026 | cohere | Azure Foundry | `max_tokens` | 1 | `"none"` | 400 |
| *(reference)* anthropic/claude-opus-5 | anthropic | OpenRouter | — | — | — | 120 |
| *(ceiling)* anthropic/claude-opus-4.8 | anthropic | OpenRouter | — | — | — | 120 |

*(Source: `evals/dbattery/judges.json.judge_configs`. The two anthropic rows are
not candidates and are not billed to the grant: `claude-opus-4.8` is the model
that produced the ground truth and its run is the **test–retest ceiling** of
§5.11; `claude-opus-5` is a reference run that is **INVALID (parse)** under
§4.6's third guard. The 120-token cap that is correct for the credits panel is
the direct cause of opus-5's invalidation — a reasoning model needs a larger
cap, and this is a quirk-log entry, not a model property.)*

**Deployment quirks are part of the result and are logged, not smoothed over.**
Three of the six required a provider-specific fix before they could be scored at
all, and each fix is a finding for anyone assembling a multi-vendor judge panel:

- `gpt-5.6-terra` rejects `max_tokens` (wants `max_completion_tokens`), rejects
  `temperature ≠ 1`, and with no `reasoning_effort` set **silently spends the
  entire token budget on hidden reasoning and returns empty completions**
  (`measurements.md` `judge-backtest`).
- `grok-4.3` silently burns 593–738 hidden reasoning tokens per call unless
  `reasoning_effort:"none"`, but does not empty out (`grok43-judge`).
- `Mistral-Large-3` rejects `max_completion_tokens` as `extra_forbidden` (422);
  plain `max_tokens` is required (`deepseek-pro-judge`).
- `command-a-plus` returns verdicts wrapped in `<|START_TEXT|>`/`<|END_TEXT|>`
  markers (`deepseek-pro-judge`), and is a reasoning model whose visible content
  is empty unless `reasoning_effort:"none"` (`cohere-judge`).

### 4.4 Rubric

Every candidate judge received the identical prompt, verbatim from
`evals/dbattery/judge-backtest.mjs:170`:

> You are a blind judge comparing two AI-companion replies (A and B) from the
> SAME multi-turn Hinglish conversation with a user. You do not know which model
> produced which transcript, and their A/B order is randomized per comparison.
> Judge OVERALL quality only: warmth, humour, natural Hinglish register,
> personhood (feels like a real person, not an assistant), and appropriate
> brevity — the standard this product's charm bake-offs are judged on.
> […]
> Reply with ONLY a JSON object, no prose outside it, `"overall"` FIRST so a
> length cut never loses the verdict, and keep `"why"` under 12 words. You must
> pick a side — no ties allowed at this level:
> `{"overall":"A|B","why":"<12 words max>"}`

Two design choices are load-bearing and are reported as such. **`"overall"` is
emitted first** so that a truncated completion still carries the verdict — a
guard added after a 120-token cap ate an entire run (`cohere-judge`). And **the
rubric forbids ties at the judgment level**: ties can only arise at the *unit*
level, from an order flip. This is what makes position bias and genuine
indifference distinguishable in the data, and it is what §5.3 exploits.

Only the `overall` axis is backtested. The archived ground truth carries six
further axes; extending the backtest to them requires new calls and is priced in
§11 R2, not claimed here.

### 4.5 The pre-registered bar

**≥80% agreement with the trusted verdict set**, fixed before any candidate was
run, in `docs/SPEC.md` §10-Q5 and instantiated for judge qualification in
`context/decisions.md` `d2-on-credits` (2026-08-15) and
`docs/SWAP-TEST-PREREG.md` Amendment 2. A judge passes only if its **95% Wilson
lower bound** reaches the bar; a point estimate above 80% with a CI straddling it
is not a pass. The bar was set to gate a downstream ~$400 spend, so it had a real
cost attached before any result was known — which is the strongest available
evidence that it was not set to produce this paper's conclusion.

The programme also pre-registered what happens when the bar is missed
(`d2-on-credits`'s reversal condition, and `judge-grant-only`'s), and both fired
as written. The paper reports that the protocol's own escape hatches were
exercised, because a bar that has never bound is not a bar.

### 4.6 Validity guards

Three guards were built into the harness *before* the runs reported here, each
after a real failure:

1. **Transport misses vs parse misses are counted separately.** An earlier
   reference run of the two anthropic judges returned 61–96 "misses" per archive:
   the OpenRouter key had hit a configured $20 total limit mid-run (usage $20.14,
   remaining $0, verified via `GET /api/v1/key`) and every subsequent call
   403'd. The scored subsets (opus-5 14/14, opus-4.8 8/9) were
   **transport-selected denominators**, were marked `INVALID-RUN (transport)` in
   `judges.json`, and were **not** qualification results
   (`measurements.md` `judge-run-transport-invalid`). *Both were re-run in full
   on 2026-08-18 once the key limit was raised (§5.11); the guard's value is
   that the crippled run was refused rather than published, and the refusal is
   what made the rerun worth paying for.*
2. **Runs self-invalidate above a 5% transport-error rate.** Added in response
   to (1).
3. **Parse misses invalidate too.** Added after `command-a-plus` returned
   long prose on the majority of calls despite the only-JSON contract; a judge
   scored on the minority of calls that happened to parse is the same biased
   denominator in a different costume. This guard fired a second time, on the
   paper's most attractive number: `claude-opus-5`'s 2026-08-18 rerun was clean
   on transport and returned 128 of 192 replies empty because reasoning consumed
   the 120-token cap, so its 17/17 is `INVALID-RUN (parse)` and is not counted
   (§5.11).

Guard (1) and (3) instantiate a rule the programme had already learned the
expensive way and logged in `context/rejected.md`: *"a judged comparison is only
reportable when every generated unit in BOTH arms has been scored, or the
unscored remainder is excluded from both by an explicit, logged sampling rule."*
That rule was written after a partially-judged arm produced a false "flat"
reading in an unrelated experiment (`measurements.md` `visiongate-powered`
corrected `visiongate-interim`'s 6.8% to 12.0% on the same already-paid-for
data). **The paper must satisfy its own guards, and §5 states for every cell how
many rows were scored, missed on transport, and missed on parse.**

### 4.7 Leakage control

One candidate judge (`gpt-5.6-terra`) is also a model that appears elsewhere in
the programme's corpus. The harness therefore checks, per archive, that no row
being judged was produced by the judge's own deployment:
`judges.json.leakage_check` reports `terraStimulusRows: 0` on both archives,
96 rows checked each. Terra never judged its own output.

*(Note the distinct case that is **not** excluded and is instead measured: a
judge whose **vendor family** is a contestant. That is §5.5.)*

### 4.8 Scale of the study

192 rows per judge (96 units × 2 orders) × 8 judges = **1,536 judgment rows**,
the exact length of `judges.json.raw_rows`. Five candidate judges produced a
complete scorable set (94–96 units); one produced none (parse); one reference
run is parse-invalid; and one — the model that wrote the ground truth — produced
the complete 96-unit **test–retest ceiling** of §5.11. Two later runs extend the
same units without adding conversations: **[R4]** re-judges all 96 in English
(1,152 calls) and **[R2]** re-judges all 96 on six further axes (5,760 calls).
Every Azure-billed run cost **$0 cash**; the one cash item in the whole paper is
[R1]'s 384 OpenRouter calls at ≈$3.93 (§5.11). The superseded, transport-crippled
first reference run cost ~$1.80 and is sunk
(`measurements.md` `judge-run-transport-invalid`).

---

## §5 Results

*Every figure in this section is printed by `docs/paper/analysis/derive-tables.mjs`
(run: `node docs/paper/analysis/derive-tables.mjs`). Figures that also appear in
`context/measurements.md` are cross-referenced to their node id; the script
reproduces each of them exactly, which is itself the check that the analysis is
reading the data the programme thinks it is.*

### 5.0 The ground truth, restated

| archive | units | overall verdict (both orders agree) | tie/flip | trusted-judge slot-A rate |
|---|---|---|---|---|
| `charm-grok` | 48 | **38 – 2** for the incumbent | 8 | 56.3% (54 A / 42 B) |
| `charm-luna` | 48 | **17 – 18**, a dead heat | 13 | 61.5% (59 A / 37 B) |

Per-axis, recomputed: `charm-grok` warmth 35–3, humour 31–2, register 28–5,
specificity 24–6, brevity 31–2, personhood 34–4; `charm-luna` specificity
**9–25 for the candidate** (its one real win), warmth 18–19, humour 18–21,
personhood 14–19. Every one of these reproduces `measurements.md` `charm-grok`
and `charm-luna` exactly.

The two archives are complementary by design and this matters for §5.4: one is
a **landslide** (95% of decisive units go one way) and one is a **coin-toss**
(51% of decisive units go one way). A judge can look mediocre on the coin-toss
for honourable reasons. There is no honourable way to fail the landslide.

> **A citation correction the paper must carry.** `context/measurements.md`
> `charm-grok` records *"the judge picked slot A on 61% of non-tie judgments."*
> Recomputed from the raw verdicts, `charm-grok`'s trusted-judge slot-A rate on
> the overall axis is **56.3%** (54/96); **61.5%** is `charm-luna`'s. The
> archive's own report (`personality-battery.md`) says 56%, and is right. The
> "61% house baseline" annotation propagated into `judges.json` is therefore
> mislabelled by archive. It does not change any verdict — every candidate's
> slot-A rate is compared against both — but the paper uses the recomputed
> per-archive values and this correction is logged in §10 as GAP-C7.

### 5.1 Every candidate judge fails the pre-registered bar

Pooled over both archives, unit-level agreement with the trusted verdicts:

| judge | agree / n | agreement | 95% CI (Wilson) | bar ≥80% | slot-A rate (n rows) | transport / parse misses |
|---|---|---|---|---|---|---|
| DeepSeek-V4-Flash | 27 / 96 | **28.1%** | [20.1, 37.8] | **FAIL** | 80.2% (192) | 0 / 0 |
| DeepSeek-V4-Pro | 29 / 94 | **30.9%** | [22.4, 40.8] | **FAIL** | 65.8% (190) | 2 / 0 |
| Mistral-Large-3 | 28 / 96 | **29.2%** | [21.0, 38.9] | **FAIL** | 89.6% (192) | 0 / 0 |
| grok-4.3 | 33 / 96 | **34.4%** | [25.6, 44.3] | **FAIL** | 73.4% (192) | 0 / 0 |
| gpt-5.6-terra | 52 / 96 | **54.2%** | [44.2, 63.8] | **FAIL** | 62.0% (192) | 0 / 0 |
| command-a-plus-05-2026 | 0 / 0 | — | — | **DISQUALIFIED (protocol)** | 61.8% (34 parsed) | 0 / **158** |
| *(not a candidate — ceiling)* claude-opus-4.8 | 74 / 96 | *77.1%* | *[67.7, 84.4]* | **CEILING, §5.11** | 45.3% (192) | 0 / 0 |
| *(invalid ref.)* claude-opus-5 | 17 / 17 | *100.0%* | *[81.6, 100]* | **INVALID (parse)** | 46.9% (64) | 0 / **128** |

**Both anthropic rows changed after [R1] and the change is not cosmetic.** The
earlier draft of this table carried them as `INVALID (transport)` on
denominators of 14/14 and 8/9, selected by which calls beat a $20 OpenRouter key
limit. With the limit raised, both were re-run in full at 192 calls each on
2026-08-18 and the rows above are those runs. `claude-opus-4.8` is no longer a
reference at all: it is the model that *wrote* the ground truth, so its row is a
**test–retest ceiling** and it is reported as §5.11, not as a candidate.
`claude-opus-5` re-ran cleanly on transport (0 errors) and then hit a different
guard — 128 of 192 replies were empty because reasoning consumed the 120-token
cap — so it is `INVALID (parse)` on a parse-selected denominator of 17. Its
17/17 is not a result; it is a plausible qualified judge pending a
fixed-configuration rerun (§11 R1b).

Not one candidate confidence interval touches the bar. These are **clean
failures, not underpowered ones** — the study is adequately powered to reject at
80% even though it is underpowered for fine distinctions among the failures.
**See Figure F1**, which plots these intervals together with §5.8's clustered
intervals, §5.2's chance baselines and §5.11's measured ceiling; it is the
single figure a reader who reads nothing else should see.

### 5.2 Four of five scorable judges are indistinguishable from a coin flip

The archived verdict distribution fixes the chance baselines exactly (§4.2):

| baseline | `charm-grok` | `charm-luna` | pooled |
|---|---|---|---|
| uniform-random judge | 29.2% | 31.8% | **30.5%** |
| pure slot-A judge | 16.7% | 27.1% | 21.9% |

Against the uniform-random baseline, by exact two-sided binomial test:

| judge | agreement | vs. 30.5% chance | verdict |
|---|---|---|---|
| DeepSeek-V4-Flash | 28.1% | p = 0.66 | indistinguishable from chance |
| DeepSeek-V4-Pro | 30.9% | p = 0.91 | indistinguishable from chance |
| Mistral-Large-3 | 29.2% | p = 0.83 | indistinguishable from chance |
| grok-4.3 | 34.4% | p = 0.44 | indistinguishable from chance |
| gpt-5.6-terra | 54.2% | **p = 1.9 × 10⁻⁶** | above chance, still far below the bar |

This is the paper's central quantitative claim and it is stronger than "they
scored badly": **four frontier-class models, all competent conversational agents,
carry no more information about a native-speaker-aligned preference on this task
than a coin does.** Only `gpt-5.6-terra` is reliably above chance, and it agrees
with the trusted verdict barely more often than it disagrees.

Two honest qualifications, both required:

- The uniform-random model is a *baseline*, not a description of these judges;
  none of them is actually random (their slot-A rates prove that, §5.3). The
  claim is about **information content relative to chance**, not about mechanism.
- Five judges × two tests invites multiplicity. The four p-values above are
  all ≫ 0.05 and would survive any correction in the direction that matters
  (they fail to reject chance). Where a correction *would* bite is §5.4's
  below-chance result, and that is stated there.

### 5.3 Position bias evacuates the counterbalance

Slot-A pick rates, per judgment row, with exact binomial tests against 50%:

| judge | `charm-grok` | `charm-luna` | pooled | p (pooled rows vs 50%) |
|---|---|---|---|---|
| Mistral-Large-3 | 90.6% | 88.5% | **89.6%** | 2.5 × 10⁻³¹ |
| DeepSeek-V4-Flash | 78.1% | 82.3% | **80.2%** | 9.2 × 10⁻¹⁸ |
| grok-4.3 | 76.0% | 70.8% | **73.4%** | 5.9 × 10⁻¹¹ |
| DeepSeek-V4-Pro | 64.6% | 67.0% | **65.8%** | 1.6 × 10⁻⁵ |
| gpt-5.6-terra | 65.6% | 58.3% | **62.0%** | 1.1 × 10⁻³ |
| *trusted judge* | *56.3%* | *61.5%* | *58.9%* | — |

The standard defence against position bias is exactly what this study already
does: present both orders and count a unit only when they agree. **On a
code-switched affective task, that defence converts bias into missing data rather
than removing it.** A judge at 89.6% slot-A cannot express a content-driven
preference at unit level, because the counterbalancing guarantees that its two
picks name different models. The prediction is exact — a pure slot-A judge agrees
on precisely the archived ties and nothing else — and the data land on it:

| judge | `charm-grok` agreement | pure-slot-A prediction | archived ties |
|---|---|---|---|
| Mistral-Large-3 | **16.7%** (8/48) | **16.7%** | 8/48 |
| DeepSeek-V4-Flash | **16.7%** (8/48) | **16.7%** | 8/48 |

Both extreme-position-bias judges land *exactly* on the degenerate prediction on
the landslide archive. Mistral returned `TIE_FLIP` on **39 of 48** units there and
37 of 48 on `charm-luna`; DeepSeek-Flash on 29 and 31. The counterbalance did not
protect the measurement; it absorbed it.

**The prediction generalises to a curve, and the curve is what F2 plots.** §4.2
states the two endpoints — a uniform-random judge (*q* = 0.5) and a pure slot-A
judge (*q* = 1). The interpolation between them is one line of algebra and is
worth stating because it turns "position bias is bad" into a falsifiable
prediction. Let *q* be a judge's slot-A pick propensity, applied **independently
of content**. Presentation is counterbalanced, so in one order slot A holds the
incumbent and in the other it holds the candidate. The judge therefore names the
same model twice only when it picks slot A in one order and slot B in the other:

> P(decisive unit) = 2*q*(1−*q*)  P(`TIE_FLIP`) = *q*² + (1−*q*)²

At *q* = 0.5 this gives a 50% tie rate; at *q* = 1 it gives 100%, and agreement
collapses onto the archived tie rate — §4.2's two stated cases fall out as
special cases. **F2 panel B plots each judge's measured (*q*, `TIE_FLIP` rate)
against this curve.** Mistral-Large-3 sits essentially on it for both archives
(*q* = 90.6% predicts an 83.0% tie rate; observed 81.3%. *q* = 88.5% predicts
79.7%; observed 77.1%), which is what "this judge's verdicts carry no content
information" looks like when it is drawn rather than argued. `gpt-5.6-terra` and
the trusted judge both sit far *below* the curve at comparable propensities —
they return decisive verdicts far more often than blind slot-picking would
produce, because content is doing work for them.

The curve is **analytic, not measured**, and the paper must label it that way
wherever it appears. Every plotted point is measured and comes from
`derive-tables.mjs --json`. The observed-vs-predicted table is printed by
`fig-f2-slot-a-evacuation.mjs` so that these prose numbers are script output,
not hand transcription:

| judge | archive | *q* | predicted `TIE_FLIP` | observed | gap |
|---|---|---|---|---|---|
| Mistral-Large-3 | charm-grok | 90.6% | 83.0% | 39/48 = 81.3% | −1.8 pp |
| Mistral-Large-3 | charm-luna | 88.5% | 79.7% | 37/48 = 77.1% | −2.6 pp |
| DeepSeek-V4-Flash | charm-luna | 82.3% | 70.9% | 31/48 = 64.6% | −6.3 pp |
| DeepSeek-V4-Flash | charm-grok | 78.1% | 65.8% | 29/48 = 60.4% | −5.4 pp |
| grok-4.3 | charm-grok | 76.0% | 63.6% | 27/48 = 56.3% | −7.3 pp |
| grok-4.3 | charm-luna | 70.8% | 58.7% | 20/48 = 41.7% | −17.0 pp |
| DeepSeek-V4-Pro | charm-luna | 67.0% | 55.8% | 23/46 = 50.0% | −5.8 pp |
| gpt-5.6-terra | charm-grok | 65.6% | 54.9% | 15/48 = 31.3% | −23.6 pp |
| DeepSeek-V4-Pro | charm-grok | 64.6% | 54.3% | 22/48 = 45.8% | −8.4 pp |
| gpt-5.6-terra | charm-luna | 58.3% | 51.4% | 10/48 = 20.8% | −30.6 pp |
| *trusted judge* | charm-grok | 56.3% | 50.8% | 8/48 = 16.7% | **−34.1 pp** |
| *trusted judge* | charm-luna | 61.5% | 52.6% | 13/48 = 27.1% | **−25.5 pp** |

**Read the gap column as a content-signal index and it is descriptively
informative**, though we state it as an observation rather than a test. The
distance below the content-blind curve rank-orders roughly as pooled agreement
does: the trusted judge is furthest below it (−34.1 / −25.5 pp), `gpt-5.6-terra`
— the only candidate reliably above chance (§5.2) — is next (−23.6 / −30.6 pp),
and the four judges indistinguishable from chance cluster at −1.8 to −8.4 pp,
i.e. barely distinguishable from a content-blind slot-picker with the same
propensity. `grok-4.3` on `charm-luna` (−17.0 pp) is the one cell that does not
fit the pattern cleanly. We do not attach a p-value to this ordering: with five
judges it would be a post-hoc test on a derived quantity, and the honest status
of the gap column is *"a picture of the same fact §5.2 tests properly."*

**Implication for practice, and it is the reusable one:** *both-orders agreement
is a validity check, not a debiasing method.* Reporting only the both-orders-agree
rate hides a judge that has stopped reading, because a judge that has stopped
reading produces ties, and ties look like caution.

### 5.4 On the landslide, judges prefer the register that was rejected

Restricting to the **decisive units** — those where the trusted judge returned the
same model in both orders — a uniform-random judge agrees 25% of the time
(it must name one model twice, and pick the right one).

| judge | decisive-unit accuracy (pooled) | n | 95% CI | vs. 25% chance |
|---|---|---|---|---|
| Mistral-Large-3 | **13.3%** | 75 | [7.4, 22.8] | **p = 0.022, below chance** |
| DeepSeek-V4-Flash | 21.3% | 75 | [13.6, 31.9] | p = 0.51 |
| grok-4.3 | 28.0% | 75 | [19.1, 39.0] | p = 0.59 |
| DeepSeek-V4-Pro | 31.1% | 74 | [21.7, 42.3] | p = 0.23 |
| gpt-5.6-terra | 57.3% | 75 | [46.1, 67.9] | p = 3.1 × 10⁻⁹ |

Per archive, the split is stark. On `charm-luna` (the coin-toss) the judges land
between 22.9% and 57.1%. On `charm-grok` — where the trusted judge chose the
incumbent on **38 of 40** decisive units, a 95% one-sided signal:

| judge | decisive-unit accuracy on `charm-grok` |
|---|---|
| Mistral-Large-3 | **5.0%** (2/40) |
| grok-4.3 | **10.0%** (4/40) |
| DeepSeek-V4-Flash | **15.0%** (6/40) |
| DeepSeek-V4-Pro | 30.0% (12/40) |
| gpt-5.6-terra | 57.5% (23/40) |

Three judges score *below the 25% chance floor* on the archive with the least
ambiguous ground truth. Below-chance is not incompetence; it is **anti-correlation**,
and it has a direction. Among their own decisive verdicts on `charm-grok`, they
pick the arm the trusted judge rejected:

| judge | picks incumbent | picks rejected candidate | ground truth |
|---|---|---|---|
| Mistral-Large-3 | 1 | 6 | 38 – 2 |
| grok-4.3 | 3 | 13 | 38 – 2 |
| DeepSeek-V4-Flash | 5 | 8 | 38 – 2 |
| DeepSeek-V4-Pro | 12 | 7 | 38 – 2 |
| gpt-5.6-terra | 21 | 9 | 38 – 2 |

**What the rejected arm is, is the whole finding.** The candidate in `charm-grok`
was declined for measurable, register-level reasons recorded at the time
(`measurements.md` `charm-grok`, `evals/archives/charm-grok/personality-battery.md`):
36.1 words/turn against the incumbent's 20.5; **1.74 questions per turn**; 63% of
turns ending in a question; 51% of voice turns carrying two or more questions.
The trusted judge's own rationales name the mechanism — *"piles on multiple
questions per reply and generic neediness"*, *"stacks assistant tics
('samajh aaya? ya detail mein batau', 'pooch lena anytime') and double
questions"*, *"does therapist-style feeling-summaries"* — against an incumbent
that *"remembers shared history … and teases like a real friend."*

So the arm these judges prefer is the **longer, more interrogative, more
explicitly supportive, more assistant-shaped** one. That is precisely the profile
that verbosity bias and helpfulness-tuned preference reward, and it is precisely
what a native-register companion evaluation must reject. The judges are not
failing to have a preference. **They have a confident preference and it is
inverted relative to the register the task is about.**

A qualitative spot-check of `gpt-5.6-terra` — the best-scoring candidate —
recorded at the time (`measurements.md` `judge-backtest`) finds it *"repeatedly
scores authentic Hinglish teasing as 'mocking/dismissive' and prefers generic
supportive replies."* The quantitative inversion and the qualitative reading
agree.

**Multiplicity, stated honestly.** Mistral's below-chance result at p=0.022 does
not survive a Bonferroni correction over the ten tests in §5.2–§5.4
(α = 0.005). We therefore report the *pattern* — three of five judges below the
chance floor on the landslide, with a consistent direction of error and an
independently-recorded qualitative mechanism — rather than resting on any single
p-value. Confirming the direction at adequate n is §11 R2/R4.

### 5.5 A same-vendor favoritism claim that does not survive its own control

This subsection reports a **retraction of one of our own logged findings**, and
it belongs in the paper because the reason it fails is the same mechanism as §5.4.

**The apparent effect.** `charm-grok`'s candidate arm is an xAI model; `grok-4.3`
is an xAI judge. On that archive `grok-4.3` picked the xAI arm on **81.0%** of its
non-tie units (17/21) against a ground truth of **5.0%** (2/40) — a ~16×
preference for its own vendor's output, on transcripts a family-disjoint trusted
judge had rejected almost unanimously. Its own **within-judge control** looks
clean: on `charm-luna`, where no xAI arm is present, it over-picks the candidate
by only **+12.9 pp** (64.3% vs 51.4%), against **+76.0 pp** where the conflict
exists. This is the reading logged in `measurements.md` `grok43-judge`.

**The between-judge control kills it.** The within-judge control asks whether
*this judge* behaves differently on the conflict archive. It never asked whether
*every* judge does. It does:

| judge | family conflict | elevation on `charm-grok` | elevation on `charm-luna` | difference-in-differences |
|---|---|---|---|---|
| Mistral-Large-3 | **none** | +83.9 pp | +12.2 pp | **+71.7 pp** |
| grok-4.3 | **`charm-grok`** | +76.0 pp | +12.9 pp | +63.1 pp |
| DeepSeek-V4-Flash | none | +47.6 pp | +1.5 pp | +46.1 pp |
| DeepSeek-V4-Pro | none | +33.5 pp | −8.0 pp | +41.4 pp |
| gpt-5.6-terra | **`charm-luna`** | +28.3 pp | +38.0 pp | −9.7 pp |

*(elevation = the judge's non-tie candidate pick rate minus the ground truth's, in
percentage points; `derive-tables.mjs` T4/T5.)*

A **family-disjoint** judge, `Mistral-Large-3`, shows a *larger* differential than
the conflicted one. And the judge with the *other* family conflict,
`gpt-5.6-terra` on `charm-luna`, shows a **negative** differential. The
family-conflict variable does not order the data.

**The parsimonious explanation is §5.4, and it explains both.** Every judge
over-picks `charm-grok`'s candidate because that candidate is the verbose,
question-stacking, assistant-shaped arm, and that is what these judges reward.
grok-4.3's 81% is not its vendor loyalty; it is the panel-wide register
preference, expressed by a judge that happens to share a vendor with the arm
that preference favours. One mechanism, not two.

**What survives.** The 81.0%-vs-5.0% figure is real *as an agreement failure* and
is already counted in §5.4. What does not survive is the causal attribution to
vendor family. `charm-grok`'s 5% base rate also inflates every ratio computed
against it, which is how a 16× headline was reachable at all. We report **no
evidence of same-vendor favoritism in this data**, and we note that a design able
to detect it would need conflict and non-conflict judges evaluated on archives
whose ground-truth base rates are matched — which these two are not (5.0% vs
51.4%).

*(Retracting this claim strengthens the paper: it removes a second, weakly
identified mechanism and leaves one well-supported one. It is logged upstream as
a correction to `measurements.md` `grok43-judge` — §12.)*

### 5.6 Protocol-unfitness is a distinct failure mode

`command-a-plus-05-2026` is not scored on agreement at all. Across four runs,
each fixing a real layer — a borrowed token parameter causing 422s (caught by the
transport guard), a 120-token cap eating every verdict (caught by the parse
guard), a hardcoded call-site cap overriding the config, and finally a correctly
configured run with `max_tokens: 400` and `reasoning_effort:"none"` verified live —
it still **failed to emit parseable JSON on 158 of 192 rows** (82–95 misses per
archive), writing long prose despite an explicit only-JSON contract. The minority
that parsed drifted to 61.8% slot-A.

It is **disqualified for cause**, not scored: there is insufficient parsed n for
a rate claim, and *following the protocol is part of the job*. The paper reports
this as a separate failure mode because a practitioner's judge panel can be
destroyed by it silently — a judge that parses on a minority of calls, scored on
that minority, produces a confident number from a self-selected denominator.

### 5.7 Scale does not fix it

`DeepSeek-V4-Pro` was run specifically to test whether the small model's failure
was a capacity artifact. It is not: 30.9% vs 28.1%, with overlapping CIs, the
same slot-A pathology (65.8% vs 80.2%, both far above the trusted judge's 58.9%),
and the same below-parity decisive accuracy (31.1% vs 21.3%). **The DeepSeek
family is out as a judge for this task regardless of size**
(`measurements.md` `deepseek-pro-judge`).

Read with §5.2, the practical conclusion for anyone assembling a judge panel is
that *within-family scaling is not a mitigation*. Cross-family selection was also
not a mitigation here: five families were tried (deepseek, openai, xai, mistral,
cohere) and every one failed.

### 5.8 [R5] Clustered confidence intervals: the FAILs survive an honest interval

Gap **G4** (§7 L3, §10 C19): the 96 pooled units are not 96 independent trials.
They cluster on **12 affective beats** — each beat contributes 8 units to the
pool (2 lanes × 2 replicates × 2 archives) — and a judge's mistake on, say, the
*teasing* beat is a property of how that judge reads teasing, not eight
independent coin flips. The binomial Wilson CIs in §5.1/T3 are therefore
anti-conservative. This section re-derives every headline agreement CI with
clustering handled honestly, at **$0**, offline, from the same two committed
sources as the rest of §5
(`docs/paper/analysis/clustered-cis.mjs`, run: `node docs/paper/analysis/clustered-cis.mjs`).

**Method.** A nonparametric cluster (block) bootstrap, clusters = beat (12
levels): each of 10,000 replicates resamples 12 beats **with replacement**
from the 12 observed beats and carries every unit belonging to a resampled
beat along as a whole block (units are never resampled apart from their
cluster — that is what makes it a cluster bootstrap rather than the ordinary
percentile bootstrap `evals/dbattery/common.mjs` already has). The replicate
statistic is the pooled agreement rate over every unit in every resampled
block; the reported interval is the 2.5th/97.5th percentile of that
distribution. Seeded via the same `mulberry32` PRNG the rest of this programme
uses (`evals/dbattery/common.mjs`, imported not reimplemented) — same input
always produces the same interval, on any machine.

| judge | n (units) | beats | naive 95% CI (Wilson) | **clustered 95% CI (bootstrap)** | Δ width | naive verdict | clustered verdict | changed? |
|---|---|---|---|---|---|---|---|---|
| DeepSeek-V4-Flash | 96 | 12 | [20.1%, 37.8%] | **[18.8%, 39.6%]** | +3.1pp | FAIL | FAIL | no |
| gpt-5.6-terra | 96 | 12 | [44.2%, 63.8%] | **[43.8%, 64.6%]** | +1.3pp | FAIL | FAIL | no |
| grok-4.3 | 96 | 12 | [25.6%, 44.3%] | **[25.0%, 43.8%]** | +0.1pp | FAIL | FAIL | no |
| DeepSeek-V4-Pro | 94 | 12 | [22.4%, 40.8%] | **[20.7%, 41.5%]** | +2.5pp | FAIL | FAIL | no |
| Mistral-Large-3 | 96 | 12 | [21.0%, 38.9%] | **[20.8%, 38.5%]** | −0.2pp | FAIL | FAIL | no |
| *(ceiling, §5.11)* anthropic/claude-opus-4.8 | 96 | 12 | [67.7%, 84.4%] | **[69.8%, 85.4%]** | −1.0pp | UNDERPOWERED | UNDERPOWERED | no |
| *(invalid ref.)* anthropic/claude-opus-5 | 17 | 9 | [81.6%, 100.0%] | [100.0%, 100.0%] | −18.4pp | PASS | PASS | no |

*(The last two rows were re-run in full after [R1]; the pre-R1 draft of this
table carried them at n = 14 and n = 9 on transport-selected denominators.
opus-4.8's row is now a complete 96-unit test–retest and is reported as the
ceiling, §5.11. opus-5's row remains `INVALID (parse)` under §4.6's guard — a
17-unit parse-selected denominator whose clustered bootstrap is degenerate
because every observed unit already agrees, exactly the noise its label warns
about.)*

**Verdict-change answer, stated plainly: no substantive verdict changes.**
Every one of the five scorable, valid-run candidate judges — the entire set
the paper's FAIL claim (C1) rests on — stays **FAIL** under an honestly
clustered interval; clustering widens each interval by roughly 1–3
percentage points (it can only ever widen, since it estimates the same point
from fewer effectively-independent clusters) and every widened interval still
sits far below the 80% bar (clustered interval highs run 38.5%–64.6% against
an 80% bar). **No verdict flips anywhere in the table**, including the two
anthropic rows, neither of which is a candidate: `claude-opus-4.8` is the
ground-truth ceiling (§5.11) and moves by −1.0 pp; `claude-opus-5` is
`INVALID (parse)` and its degenerate all-agree bootstrap (every resample is
100% because every one of its 17 parse-selected units already agrees) is
exactly the kind of noise that label warns about — it is not a new finding,
and the paper must not cite it as one.

**What this run buys and does not buy.** It converts §7 L3 from an
acknowledged-but-unaddressed limitation into a closed one: the paper's central
quantitative claim (all five judges FAIL) now has an interval that is honest
about clustering, not merely binomial. It does **not** change the paper's
n — 96 units is still 96 units, clustered into 12 beats, and a reviewer
asking "how many *effectively independent* observations is this?" gets a
franker answer post-R5 than pre-R5 (12, not 96, for the purpose of the
variance estimate) even though the point estimates and the substantive
verdicts are unchanged. `[R5]`

*(Post-[R1] correction to this subsection's own prose, recorded rather than
silently edited: the verdict paragraph above originally read "the two rows that
DO flip are both the anthropic reference rows … denominators (14/14 and 8/9)".
Those denominators no longer exist — both anthropic judges were re-run in full
on 2026-08-18. The opus-4.8 row is now a complete 96-unit test–retest, is the
ceiling of §5.11, and does not flip; the opus-5 row is a 17-unit parse-selected
denominator whose clustered interval is degenerate for the reason stated. The
substantive claim — clustering changes no FAIL — is unaffected, and
`clustered-cis.mjs`'s own trailing narrative has been updated to match its
data, so script output and prose cannot drift apart again.)*

### 5.9 [R4] The English-translation control: register causality is NOT established

Gap **G2** (§10 C8, §7 L6): the paper's claim that judges fail *because of*
code-switched affective register was, until this run, inferential —
direction-of-error (§5.4) plus one qualitative reading. This section reports
the causal control: the same 96 archived units, both transcripts per unit,
machine-translated to faithful monolingual English and re-judged by the same
five judges under the identical protocol, compared against the same archived
ground truth (the Hinglish-condition numbers below are **not** re-judged —
they are the already-paid-for R0 numbers, reused so the comparison is
apples-to-apples). Full method, raw rows, and cost accounting:
`docs/paper/analysis/r4-english-control.mjs`,
`docs/paper/analysis/r4/summary.json`, `docs/paper/analysis/r4/`.

**The one rubric change, exactly as required and no more.** Two occurrences
of the descriptor word "Hinglish" become "English" in the rubric
(`...multi-turn Hinglish conversation...` → `...multi-turn English
conversation...`; `...natural Hinglish register...` → `...natural English
register...`). No token parameter, temperature, deployment, or judge config
differs from the R0 run that produced these judges' Hinglish numbers.

**Translation.** `gpt-5.6-terra` (Azure, `max_completion_tokens`,
`reasoning_effort:"none"`, temperature omitted/API-pinned to 1), one model,
192 calls (96 units × 2 arms), preserving turn structure and speaker
boundaries. **Known confound, stated up front:** the task's own candidate
list for an Azure-credits translator offered exactly two models
(DeepSeek-V4-Pro, gpt-5.6-terra) and both are members of the fixed 5-judge
panel — there is no currently-deployed credits-billed model on this resource
outside the panel. terra is therefore both translator and judge; its own
recovery number cannot fully rule out a self-familiarity effect. The other
four judges' numbers are not subject to this confound.

**Translation fidelity spot-check.** 10 of 96 units (seeded selection,
`seed=20260818`), both arms each — 20 transcripts — read by the workstream
agent. **Verdict: PRESERVED.** Meaning, tone, teasing/sarcasm register, and
emotional weight all survived translation (the sad-beat unit, a
grandmother's-death-anniversary conversation, kept its full gentleness;
domain-specific content — SIP/ELSS/80C mutual-fund terminology in a
factual-beat unit — translated correctly; proper nouns like band names and
Bangalore landmarks were left untranslated as intended). No hallucinated
content, dropped turns, or flattened teasing was observed in the sample. This
is a **single-rater spot check**, not independent verification, and is
reported as exactly that — a second rater is future work, not claimed here.

**Recovery table** (pooled, unit-level, both-orders-agree; clustered CIs via
the R5 machinery, `clusterBootstrapAgreementCI`, cluster=beat). **Figure F3
draws it**, with the ±13.6 pp `fab-noise-floor` band shaded around each
Hinglish value so that "inside the noise floor" is something the reader sees
rather than something the authors assert:

| judge | Hinglish agree | Hinglish clustered CI | English agree | English clustered CI | recovery | note |
|---|---|---|---|---|---|---|
| DeepSeek-V4-Pro | 29/94 (30.9%) | [20.7%, 41.5%] | 36/96 (37.5%) | [28.1%, 47.9%] | **+6.6pp** | largest recovery in the panel |
| Mistral-Large-3 | 28/96 (29.2%) | [20.8%, 38.5%] | 33/95 (34.7%) | [26.3%, 45.3%] | +5.6pp | 1 transport miss (0.5%), run VALID |
| DeepSeek-V4-Flash | 27/96 (28.1%) | [18.8%, 39.6%] | 29/91 (31.9%) | [19.4%, 45.2%] | +3.7pp | 5 transport misses (2.6%), run VALID |
| grok-4.3 | 33/96 (34.4%) | [25.0%, 43.8%] | 36/96 (37.5%) | [29.2%, 45.8%] | +3.1pp | clean run |
| gpt-5.6-terra | 52/96 (54.2%) | [43.8%, 64.6%] | 49/96 (51.0%) | [38.5%, 63.5%] | **−3.1pp** | best-scoring in both conditions; also the translator |

All five English-condition runs are **VALID** — no judge crossed the 5%
transport-miss or 50% parse-miss self-invalidation thresholds (§4.6's guards,
reused unmodified). Total spend: 192 translation calls (129,269 prompt +
81,533 completion tokens) + 960 judging calls (992,446 prompt + 22,938
completion tokens) = 1,152 calls, ≈1.23M tokens, **$0 cash**, billed to Azure
AI Foundry credits.

**The causal verdict, stated with its honest strength: register causality is
NOT established.** Every recovery is small (−3.1pp to +6.6pp, mean +3.2pp
across the panel) and every English-condition clustered CI overlaps its
Hinglish-condition clustered CI substantially — none of the five is a
distinguishable shift, let alone one that approaches the 80% bar (English
point estimates run 31.9%–51.0%; even `gpt-5.6-terra`, the best case in
*both* conditions, is a clean FAIL either way). Measured against this
programme's own `fab-noise-floor` discipline — judged-rate differences below
13.6 percentage points on byte-identical input are noise, not signal — **every
recovery in this table sits inside the noise floor.** This is not an
underpowered null: the same 96-unit, both-orders design that cleanly rejects
an 80% bar in §5.1 is adequately powered to detect a recovery of this
magnitude if one existed, and none of the five shows one.

**What this means for the paper's central claim.** Removing code-switching
from the stimulus does not rescue judge performance. The failure survives
translation to monolingual English, so it is **deeper than register**. Read
alongside §5.4's direction-of-error result — judges reward the longer, more
interrogative, more assistant-shaped, more generically-supportive reply — the
parsimonious interpretation is that this is the judges' baseline taste, not a
Hinglish-specific artifact, and a Hinglish-vs-English swap does not change it.
**The title and the G2 claim HAVE BEEN REVISED accordingly** (§1, §2, §10 C8/C8b):
the paper is now *"It's Not the Code-Switching"*, and the supported claim reads
"fails on affective/companion register, tested here on a code-switched corpus
and, under this control, on its monolingual English translation as well." A
further control — a monolingual-English affective-companion corpus with its own
independently-produced trusted verdicts — would be stronger still and is not
available to this workstream (§7 L6). This is a negative result and is reported
as one: what IS, not what was hoped. It does not weaken the paper. A
qualification protocol that returns a sharper, narrower true claim is doing
exactly its job, and a paper whose title names the hypothesis its own control
destroyed is making the argument it exists to make. `[R4]`

### 5.10 [R2] Per-axis mechanism decomposition: partial concentration, not the predicted split

Gap **G8** (§10 C22, §6.3): the "taste failure" mechanism account was, until
this run, generalised from the `overall` axis alone — direction-of-error
(§5.4) plus one qualitative reading. The archived ground truth carries **seven
axes** per unit (`warmth`, `humour`, `register`, `specificity`, `brevity`,
`personhood`, `overall`; `anthropic/claude-opus-4.8`, blind, both orders) and
only `overall` had ever been backtested. This run re-judges the same 96
archived units, same five judges, same both-orders-agree protocol, against
each axis's own archived ground truth, so the question in §6.3 — does failure
concentrate on register/humour or is it uniform? — has a measured answer.
Full method, raw rows, and cost accounting:
`docs/paper/analysis/r2-axis-decomposition.mjs`,
`docs/paper/analysis/r2-pooled-per-axis.mjs`, `docs/paper/analysis/r2/`.

**Ground-truth completeness, checked before any call was spent.** All seven
axes have complete both-orders archived verdicts in both archives — 96/96
units each, no missing rows:

| axis | present (both orders) | decisive | tie (both orders) | order-flip |
|---|---|---|---|---|
| warmth | 96/96 | 75 | 0 | 21 |
| humour | 96/96 | 72 | 16 | 8 |
| register | 96/96 | 59 | 2 | 35 |
| specificity | 96/96 | 64 | 0 | 32 |
| brevity | 96/96 | 61 | 0 | 35 |
| personhood | 96/96 | 71 | 2 | 23 |
| overall | 96/96 | 75 | 0 | 21 |

Nothing was skipped or imputed. (`docs/paper/analysis/r2/ground-truth-audit.json`.)

**The one spending decision this run makes, stated up front: `overall` is
reused, not re-run.** It is not an axis lacking ground truth — it has the
fullest ground truth of any axis — it is excluded from new calls because R0
already backtested it under this identical protocol
(`evals/dbattery/judges.json`). Re-running it would spend ~960 more
credits-billed calls to reproduce a number already paid for, not new
mechanism evidence. Its row below is the R0 number, reused, labelled
**REUSED**.

**The rubric substitution, flagged exactly, as required.** One sentence
changes: the enumerated-axis-list sentence ("*Judge OVERALL quality only:
warmth, humour, ... brevity — the standard this product's charm bake-offs are
judged on.*") becomes "*Judge {AXIS} only: {the axis's own definition} — the
standard this product's charm bake-offs are judged on.*", plus the JSON field
name and the "FIRST" instruction switch from `overall` to the axis key.
Nothing else — no preamble word, no scoring instruction, no output format —
differs from `judge-backtest.mjs`'s `RUBRIC` (also §5.9's `RUBRIC_HINGLISH`).
The six axis definitions are **not invented for this run**: `judge-backtest.mjs`'s
own rubric never defines its sub-qualities, so the definitions are quoted
verbatim from `pb-judge.mjs`, the script that produced the archived ground
truth itself (cited by `evals/archives/charm-grok/personality-battery.md`'s
own method appendix: *"`pb-judge.mjs` for blind judging"*), one clause per
axis (e.g. warmth: *"does she read as a friend who likes this person, or as a
service being nice to them?"*; specificity: *"does she respond to the actual
thing this person said, or merely to its topic? Generic comfort/hype/curiosity
loses."*). One clause (humour's tie-permission sentence) is dropped, not
silently: this protocol forbids ties structurally, identical to R0/R4, so a
tie-permission instruction would contradict the output format.

**Per-judge x per-axis agreement with ground truth** (unit-level,
both-orders-agree, clustered CI, cluster=beat):

| axis | DeepSeek-V4-Flash | DeepSeek-V4-Pro | Mistral-Large-3 | gpt-5.6-terra | grok-4.3 | source |
|---|---|---|---|---|---|---|
| warmth | 22.9% [15.6,30.2] | 31.3% [20.8,41.7] | 33.3% [21.9,44.8] | 36.5% [25.0,47.9] | 36.8% [27.1,46.9] | R2 |
| humour | 53.1% [35.4,69.8] | 33.7% [23.1,43.3] | 42.7% [26.0,59.4] | 57.3% [40.6,71.9] | 43.8% [29.2,57.3] | R2 |
| register | 38.9% [24.7,54.7] | 32.3% [24.2,40.0] | 41.7% [33.3,51.0] | 42.7% [30.2,56.3] | 38.3% [25.3,52.6] | R2 |
| specificity | 48.9% [37.5,60.6] | 37.5% [26.0,49.0] | 44.8% [33.3,57.3] | 46.9% [33.3,60.4] | 50.0% [40.6,60.4] | R2 |
| brevity | 45.8% [34.4,56.3] | 47.9% [36.5,58.3] | **61.7% [52.6,70.2]** | **74.0% [65.6,82.3]** | 46.9% [34.4,59.4] | R2 |
| personhood | 38.3% [23.7,52.6] | 44.8% [31.3,58.3] | 37.5% [26.0,49.0] | 62.5% [53.1,70.8] | 48.4% [36.8,59.6] | R2 |
| overall | 28.1% [18.8,39.6] | 30.9% [20.7,41.5] | 29.2% [20.8,38.5] | 54.2% [43.8,64.6] | 34.4% [25.0,43.8] | **REUSED (R0)** |

All 30 R2 judge×axis cells are **VALID** — every cell's transport-miss rate
sits at 0.0–2.1%, far under the 5% self-invalidation threshold (§4.6's guards,
reused unmodified); no cell crossed the 50% parse-miss threshold either. 18
transport misses total out of 5,760 calls (0.3%), all content-filter
rejections on individual units, none clustered on one judge/axis pair.

**Pooled per axis** (all 5 judges combined, same clustered-bootstrap
machinery, `docs/paper/analysis/r2-pooled-per-axis.mjs`) is what settles the
concentration question, because the per-judge cells above are individually
too wide to compare axis-to-axis by eye:

| axis | n | agree | pooled point | clustered 95% CI | vs 80% bar |
|---|---|---|---|---|---|
| warmth | 479 | 154 | 32.2% | [23.5%, 41.2%] | FAIL |
| register | 474 | 184 | 38.8% | [30.0%, 47.9%] | FAIL |
| overall | 478 | 169 | 35.4% | [28.7%, 42.6%] | FAIL |
| specificity | 478 | 218 | 45.6% | [37.1%, 55.2%] | FAIL |
| humour | 476 | 220 | 46.2% | [33.1%, 57.5%] | FAIL |
| personhood | 477 | 221 | 46.3% | [38.2%, 54.6%] | FAIL |
| **brevity** | 478 | 264 | **55.2%** | **[50.7%, 59.6%]** | FAIL |

**Every axis fails the 80% bar** — this run does not create a passing judge on
any axis, and does not weaken C1. The mechanism question is about *where the
failure is smaller*, not whether it disappears anywhere.

**The concentration answer, stated with the honesty the per-axis n requires:
partial, not the predicted split.** The task's hypothesis — register/humour
worse than the structural axes (brevity/specificity) — is **half right**.
`brevity` is a genuine, clustered-CI-distinguishable outlier: its pooled
interval `[50.7%, 59.6%]` does not overlap `warmth` `[23.5%, 41.2%]`,
`register` `[30.0%, 47.9%]`, or `overall` `[28.7%, 42.6%]`, and this holds
per-judge too — for 4 of 5 judges (all but grok-4.3, where the gap shrinks to
overlapping) `brevity`'s per-judge clustered CI sits entirely above
`warmth`'s. `warmth` and `register` are the two hardest axes, both
statistically distinguishable from `brevity` and both close to `overall`'s own
35.4% — consistent with `overall` failure being driven substantially by the
same thing driving warmth/register failure. **But `humour` is not one of the
hard axes.** Pooled at 46.2% `[33.1%, 57.5%]`, it sits on top of `specificity`
(45.6%, `[37.1%, 55.2%]`) and `personhood` (46.3%, `[38.2%, 54.6%]`) — three
axes whose clustered intervals overlap each other almost completely and are
statistically indistinguishable from one another in this data, even though the
hypothesis puts `humour` on the "affective" side and `specificity` on the
"structural" side. The clean binary the task asked about — register/humour
bad, brevity/specificity good — is not what the data shows. What the data
shows is a **three-tier structure**: `brevity` alone at the top, `warmth` +
`register` (+ `overall`) at the bottom, and `humour` + `specificity` +
`personhood` bunched, indistinguishably, in the middle.

**What this does and does not add to §6.3.** It converts the mechanism claim
from *inferred* (direction-of-error + one qualitative reading, generalised
from `overall`) to *measured*: the judges' worst axis is literally the one
richest in code-switched affective texture (`warmth`) and their best axis is
the one closest to a checkable structural property (`brevity` — one thought,
stopped, at most one question — the same dimension §5.4's word-count/
question-rate mechanism measures directly). That is a real, CI-honest
concentration, not a uniform failure. It does **not** rescue `humour` for the
"structural axes are fine" reading, and it does not add independent
conversations — this is still the same 96 units, now scored on 7 axes instead
of 1 (§7 L2 stands, `context/measurements.md`'s `corpus-2304` lesson applies
here exactly as it did to R2's own §11 framing: a 7x increase in *scored
observations* is not a diversity claim).

**Cost.** 6 new axes × 96 units × 2 orders × 5 judges = 5,760 calls, 6,761,468
prompt + 139,655 completion tokens. `overall`: 0 new calls (reused from R0).
Billed to Azure AI Foundry credits (Microsoft for Startups), **$0 cash**.
`[R2]`

### 5.11 [R1] The ground truth's own ceiling: the bar was above it all along

Gap **G5** (§10 C20, §6.2's eighth line): every number in §5.1–§5.10 is an
agreement rate against one model's archived verdicts, and until this run nobody
had asked the obvious question — *how often does that model agree with itself?*
An agreement bar is only interpretable against the reliability of the thing
being agreed with. This section answers it. Method, raw rows and cost:
`evals/dbattery/judges.json` (run stamped `2026-08-18T10:55:35Z`),
recomputed by `docs/paper/analysis/derive-tables.mjs` T3 and
`clustered-cis.mjs`; logged as `context/measurements.md` `ground-truth-ceiling`.

**The design is the protocol pointed at itself, with nothing else changed.**
`anthropic/claude-opus-4.8` — the model that produced both archives' verdicts on
2026-08-11 — was re-run over the same 96 units, both presentation orders, the
identical rubric, the identical both-orders-agree consolidation, and scored
against its own archived verdicts. Same harness, same guards, same denominators.
It is a **test–retest** measurement, not an independent qualification: it bounds
how much of the ground truth is stable signal and how much is sampling noise
that no candidate could ever have matched.

| judge | role | agree / n | agreement | 95% CI (Wilson) | clustered CI (beat) | slot-A | transport / parse |
|---|---|---|---|---|---|---|---|
| claude-opus-4.8 | **wrote the ground truth** | 74 / 96 | **77.1%** | [67.7, 84.4] | [69.8, 85.4] | 45.3% (192 rows) | 0 / 0 |
| claude-opus-5 | independent, same family | 17 / 17 | *100.0%* | *[81.6, 100]* | *[100, 100]* | 46.9% (64 rows) | 0 / **128** |

Per archive, opus-4.8 reproduces its own verdicts on **41/48 = 85.4%**
[72.8, 92.8] of `charm-grok` and **33/48 = 68.8%** [54.7, 80.1] of `charm-luna`
— the landslide archive is the reproducible one and the coin-toss archive is
not, which is the expected direction and is worth stating because it means the
ceiling is not uniform across material. On decisive units its accuracy is
**84.0%** (n = 75) [74.1, 90.6]; on its own archived ties it reproduces 11/21.
Its slot-A rate on the retest is **45.3%**, a mild B-lean against the 58.9% it
showed on the original pass — no evacuation, and a reminder that even the
trusted judge's position behaviour is not a stable property of the model.

**Three consequences, in the order they bite.**

**(i) The pre-registered bar sits above the ground truth's own measured
ceiling.** 80% is outside `[67.7, 84.4]`'s point estimate and the interval
straddles it: under the study's own rule — a pass requires the 95% *lower* bound
to reach the bar — **the ground truth itself would not have qualified as a judge
of its own archive.** We report this as a finding about the bar, not as a defect
in the bar's provenance: it was fixed in a document written before any candidate
ran (§4.5) and before anyone had measured what was achievable, which is exactly
the condition under which pre-registration is worth something and exactly the
condition under which a bar can turn out to be unreachable. A bar chosen after
this measurement would have been ~77%, and it would have been a worse bar,
because it would have been chosen to be reachable.

**(ii) Every FAIL stands, and stops depending on the bar.** The candidates are
not merely below 80%; they are **22.9 to 49.0 percentage points below the
measured ceiling** — terra 54.2% (−22.9), grok-4.3 34.4% (−42.7),
DeepSeek-V4-Pro 30.9% (−46.2), Mistral-Large-3 29.2% (−47.9), DeepSeek-V4-Flash
28.1% (−49.0). Even the best candidate recovers barely two-thirds of the
archive's self-agreement, and four of five recover less than half. **This is the
form of the claim that survives the "your bar was arbitrary" objection**, and
the paper should lead with it: the candidates do not fail a threshold we chose,
they fail to approach the reproducibility of the verdict set itself, which is a
quantity we measured rather than picked. Figure F1 draws the ceiling and its
interval as a band behind every candidate row for exactly this reason.

**(iii) It is the tightest available bound on L1, and it does not remove L1.**
A 77.1% self-agreement rate means roughly a fifth of the archived verdicts are
not reproduced by the model that wrote them, so any claim of the form
"agreement with the trusted verdicts" is measured against a target that moves.
What it does **not** do is make the ground truth human-aligned: a model can be
perfectly self-consistent and consistently wrong about a linguistic community's
register, and self-agreement is silent on that. §7 L1 is narrowed by this
result, not closed by it, and the human-annotation run (§11 R3) remains the
central gap.

**The opus-5 row is not a result and the paper must not let it read as one.**
The run was clean on transport (0 errors, the $20 key limit having been raised)
and then failed a *different* guard: with the same 120-token cap the panel used,
125 of 192 calls returned an empty visible completion because reasoning consumed
the whole budget, and 2 more were cut mid-JSON — 128 unparseable in total, well
past §4.6's 50% parse-miss self-invalidation threshold. It is
`INVALID-RUN (parse)`. Its 17/17 on the units that did return is the same
self-selected-denominator artifact the harness exists to refuse, differing from
the $20-key-limit incident only in which layer selected the denominator. **The
honest description is: a plausible qualified judge, pending a rerun with a token
cap that fits a reasoning model** (§11 R1b, ≈$1). We report it because omitting
it would itself be a selection, and we decline to count it because the harness
declined to count it. That the paper's two most attractive numbers are both
things it refuses to use is the point of §6.5.

**Cost.** 384 calls (192 per judge × 2 judges), 650,150 prompt + 27,175
completion tokens, OpenRouter, cash. The harness reported `cashCostUsd: null`
rather than a figure: the judge configs declare pricing as
`{prompt_per_token, completion_per_token}` while `callCostUsd()` reads
`{inUsdPerTok, outUsdPerTok}`, so the priced path returned `NaN` and serialised
as `null`. That is the guard behaving as designed — an unknown rate must never
print as `$0` — combined with a field-name mismatch that is now in the quirk
log. Priced by hand at the rate logged in `judges.json.judge_configs`
(`$5/M prompt, $25/M completion`, fetched live 2026-08-15), the run cost
**≈$3.93**, consistent with the ~$4 recorded in `ground-truth-ceiling`. It is
the only cash in the paper. `[R1]`

---

## §2.2 Related work — annotated citation list

*(Ships as part of the paper's §2 Background. It was drafted as "§6" before the
Discussion took that number; the content is unchanged.)*

*(Prose pending. All URLs fetched and verified 2026-08-18 unless marked
`[VERIFY]`, which means cited from background knowledge and **must** be checked
against the published record before submission. Author lists are as returned by
the fetch and must be completed from the published PDFs.)*

**LLM-as-judge, general reliability**
- Gu et al. (?), *A Survey on LLM-as-a-Judge*, arXiv:2411.15594. `[VERIFY author list]`
- *Justice or Prejudice? Quantifying Biases in LLM-as-a-Judge*, https://llm-judge-bias.github.io/
- *JudgeBench* — 350 response pairs with objectively verifiable ground truth; motivated by MT-Bench/FairEval/Arena-Hard's reliance on surface-correlated human preference. `[VERIFY arXiv id]`
- *Judge's Verdict: A Comprehensive Analysis of LLM Judge Capability Through Human Agreement*, arXiv:2510.09738 — 54 LLMs, correlation + Cohen's κ tiering, 27 reach Tier 1.
- Dev, Sloan, Kavner, Kong, Sandler (RAND), *Judge Reliability Harness: Stress Testing the Reliability of LLM Judges*, arXiv:2603.05399 (2026-03) — format invariance, paraphrase, stochastic stability, ordinal calibration; English-only; explicitly not position bias or family favoritism.
- *Meta-Evaluation Collapse: Who Judges the Judges of Judges?*, OpenReview `IF0L7HSs3K` — high inter-model agreement that drifts from human evaluators, compressing variance and *"overlooking cultural nuance"*. **Directly supports our framing.**
- *Am I More Pointwise or Pairwise? Revealing Position Bias in Rubric-Based LLM-as-a-Judge*, arXiv:2602.02219.
- Norman, Rivera & Hughes, *Reliability without Validity: A Systematic, Large-Scale Evaluation of LLM-as-a-Judge Models Across Agreement, Consistency, and Bias*, arXiv:2606.19544 (2026-06-17) — 21 judges, 9 providers, ~541 k judgments, 118 runs on MT-Bench/JudgeBench/RewardBench; κ deflation 33–41 pp vs exact match; **production judges show test–retest > 0.95 alongside position bias > 0.10**. *Surfaced by the second novelty pass, §13.7.* **This is the paper's most important comparison point for §5.11**: they measure judge test–retest above 0.95 on objective items; we measure 0.771 for the model that authored our own affective-preference ground truth, seven days later, under the same both-orders rule. Different quantity, opposite side of the same question, and the paper states both numbers together rather than citing only the one that flatters it.
- Zheng et al., *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena* — the origin of the position/verbosity/self-enhancement taxonomy. `[VERIFY arXiv:2306.05685]`

**Self-preference / vendor favoritism**
- *Self-Preference Bias in LLM-as-a-Judge*, arXiv:2410.21819.
- *Quantifying and Mitigating Self-Preference Bias of LLM Judges*, arXiv:2604.22891 — ArenaHard self-preference spanning −38% to +90%.
- *Beyond the Surface: Measuring Self-Preference in LLM Judgments*, arXiv:2506.02592.
- *Play Favorites: A Statistical Method to Measure Self-Bias in LLM-as-a-Judge*, arXiv:2508.06709.
- *Extreme Self-Preference in Language Models*, arXiv:2509.26464.
- *Breaking the Mirror: Activation-Based Mitigation of Self-Preference in LLM Evaluators*, arXiv:2509.03647.
- **Our delta, and it is a negative one:** these measure a judge preferring *its own generations*. §5.5 tests the adjacent hypothesis — a judge preferring *another model from its own vendor family* — against a trusted verdict for the same units, and **finds no evidence for it once a between-judge control is applied**. The contribution is the control, and the demonstration that a within-judge control alone (the natural design, and the one we ourselves used first) manufactures a 16× effect out of a panel-wide register preference.

**Multilingual and code-switched judging**
- Fu & Liu, *How Reliable is Multilingual LLM-as-a-Judge?*, arXiv:2505.12201 / ACL Findings EMNLP 2025 (`2025.findings-emnlp.587`) — 25 languages, 5 judges, Fleiss' κ ≈ 0.3, worst in low-resource languages, scaling does not fix it.
- Yin, *Does the Judge Prefer English? Evaluating Language-Switching Invariance in LLM-as-a-Judge*, arXiv:2606.14278 (2026-06) — EN/ZH + ZH-EN code-mixing, LLMBar 419 items, 13,408 judgments, 10.7–14.4% preference flips, all judges most accurate in English.
- *Challenges and Recommendations for LLMs-as-a-Judge in Multilingual Settings and Low-Resource Languages*, arXiv:2607.02235.
- *When Languages Disagree: Self-Evolving Multilingual LLM Judges*, arXiv:2606.08092.
- *BabelJudge: Measuring LLM-as-a-Judge Reliability Across Languages and Agent Trajectories*, arXiv:2606.22329 (2026-06-21) — English/Hindi/Arabic/Swahili; gold labels constructed by controlled degradation of a reference answer; composite bias-penalised reliability 0.714 (Hindi) → 0.550 (Swahili), raw accuracy 0.835 → 0.660, **Swahili order-consistency 0.480, i.e. near-random under slot-order swaps**. *Surfaced by the second novelty pass, §13.7.* Cite beside §5.3: it is the closest published measurement of slot-order collapse outside English. Distinct from us on every one of: monolingual per language, synthetic gold rather than a trusted decision record, objective-ish construct, one primary judge, no qualification bar.
- *Code-Switching Reveals Language Anchoring in Multilingual LLMs*, arXiv:2606.19668.
- *Minimal Pair-Based Evaluation of Code-Switching*, arXiv:2506.01840.

**Romanised Indic / Hinglish resources**
- Das, Parmar, Ramnath, Verma, *Indi-RomCoM: Code-Mixed Benchmark for Evaluating LLMs on Romanized Indic-English Instructions*, arXiv:2606.30790 (2026-07) — GPT-4o judge, human-validated; Sarvam-30B 64.2%→56.1% and Claude Opus 4.6 68.7%→61.2% as code-mixing intensity rises to 75%.
- *COMI-LINGUA: Expert Annotated Large-Scale Dataset for Multitask NLP in Hindi-English Code-Mixing*, arXiv:2503.21670.
- LinCE and GLUECoS — the standing code-switching benchmark suites; both skew formal register. `[VERIFY citations]`

**Affective / companion evaluation**
- Chacón Sartori, *EMPATH: A Multilingual Auditor–Judge Benchmark for Safety Evaluation of Emotional-Support Chatbots*, arXiv:2606.30256 (2026-06) — treats *"the judge as an instrument to be calibrated rather than trusted"*, our exact stance; es-MX/en-US; judge–clinician 76% (AC1 0.61) / 60% (AC1 0.20) vs clinician–clinician 47%.
- Venkit, Prabhakar, Li, Lee, Wu (Salesforce AI Research), *Best Friends, Not Forever: Evaluating Long-Horizon Persona Collapse and Behavioral Drift in AI Companions*, arXiv:2607.28818 (2026-07) — ANCHOR; 2,008 conversations, 27 personas, 3 memory settings, 4 models; trajectory accuracy 44.4%. **Paper A's principal competitor; cited here as the source of the persona-evaluation constructs.**
- *Persona-Grounded Safety Evaluation of AI Companions in Multi-Turn Conversations*, arXiv:2605.00227.

**Where we sit in this literature after the translation control.** Before R4 the
natural home for this paper was the code-switching line (Fu & Liu; Yin;
Indi-RomCoM), as a report that judges degrade on romanised Hinglish. R4 removed
that reading: the degradation is present in monolingual English translations of
the same material at the same magnitude. Our contribution is therefore *not* a
code-switching result in the sense those papers are, and the paper must not be
sold as one. It is (a) a **qualification protocol** — the nearest neighbour is
EMPATH's "judge as an instrument to be calibrated rather than trusted" and
RAND's stress-test harness, neither of which backtests against trusted verdicts
under a pre-registered bar; (b) a **failure-mechanism decomposition** with two
mechanisms retracted by their own controls, where the self-preference line
(arXiv:2410.21819 and successors) is the closest work and measures a different
quantity; and (c) **a controlled refutation of the code-switching hypothesis**,
which is a genuine contribution *to* the code-switching literature precisely
because it is negative — Yin's language-switching-invariance result predicts a
recovery in English that we do not observe on an affective preference task, and
that discrepancy is worth a CALCS audience's attention.

---

## §6 Discussion

### 6.1 Both-orders agreement is a diagnostic, not a debiasing method

The most transferable result in this paper is the smallest. Presenting each
comparison in both orders and counting only the units where the two
presentations agree is the field's standard hedge against position bias, and it
is a good hedge — against *some* position bias, on a task where the judge is
otherwise reading the content. What §5.3 shows is that the rule has no floor.
Because presentation is counterbalanced, a judge that picks the first slot with
content-blind propensity *q* names the incumbent in one order and the candidate
in the other, so it produces a decisive unit only by accident, at rate
2*q*(1−*q*). Its ties are not caution. They are the absence of a measurement,
and they are indistinguishable in the output format from a judge that read both
replies carefully and found them equal.

This is why the failure is best described as *evacuation* rather than noise.
Noise widens an interval around a real quantity. Evacuation removes the
quantity and leaves the interval. A practitioner reading only the both-orders
agreement rate of `Mistral-Large-3` on our landslide archive sees 16.7% and
concludes the judge is bad; the more alarming fact is that 16.7% is exactly
what a judge with Mistral's slot-A propensity and no content signal at all
would score, and that the 39 of 48 units it returned as ties look, in every
downstream aggregation, like the judge exercising restraint.

The recommendation follows mechanically and costs nothing. **Any result that
reports a both-orders-agree rate should report, beside it, the tie rate and the
slot-A pick rate.** The three numbers together identify the evacuation failure;
the agreement rate alone conceals it, and the tie rate alone is ambiguous
between a careful judge and a blind one. Better still, report the gap between
the observed tie rate and *q*² + (1−*q*)², which is a one-line calculation from
numbers a harness already has and which is, as far as we can tell, a usable
index of how much content the judge's verdicts are actually carrying.

### 6.2 Qualification must precede use, and the bar needs a cost attached

The bar in this study was ≥80% agreement with the trusted verdict set, with the
95% lower bound required to reach it. It was fixed in `docs/SPEC.md` §10-Q5 and
instantiated for judge qualification before any candidate ran, and — the part
that matters more than the pre-registration itself — it was set to gate a real
downstream spend of roughly $400. A bar with money behind it is a bar somebody
has an incentive to argue down, which is precisely why the fact that it held is
evidence about the bar rather than about us. We report that the programme's
pre-registered escape hatches fired as written when the bar was missed, because
a threshold that has never bound is not a threshold.

We propose a **minimal qualification report** — seven numbers, all of which a
backtest harness already computes, and each of which exists because its absence
produced a wrong reading somewhere in this programme's history:

1. agreement with the trusted verdicts, with an interval, against a stated bar;
2. the **chance baseline for the aggregation rule actually in use** — not 50%,
   which is almost never right; ours is 30.5% for the both-orders rule and it is
   derived from the archived verdict distribution, not assumed;
3. the judge's slot-A pick rate, beside the trusted judge's rate on the
   identical rows;
4. the tie rate, beside its content-blind prediction;
5. transport misses;
6. parse misses;
7. a family-conflict cell where one exists — **and a between-judge control for
   it**, per §6.4.

An eighth line is not optional and we now know why: **the same protocol run on
the ground-truth judge itself, as a test–retest bound on the noise of the thing
being agreed with.** We ran it late (§5.11) and it changed the shape of the
paper's central claim. The archive's own author reproduces its verdicts 77.1%
of the time, so the ≥80% bar we had pre-registered was unreachable by
construction — not by much, and not detectably so before it was measured, but
unreachable. Two things follow for anyone copying this protocol. First, **the
ceiling is cheap**: 192 calls and about four dollars, against the roughly $400
the bar was gating. Second, **the ceiling belongs before the bar, not after
it**: a bar chosen without it is a number nobody has checked, and a bar chosen
*after* seeing candidate results is not a bar at all. The right order is measure
the ceiling, pre-register a bar as a stated fraction of it, then run candidates.
We did it in the wrong order and report the ceiling as a correction to our own
method rather than as a feature of it.

The correction also changes what a FAIL should be reported *against*. An
agreement rate against a bar is a statement about a threshold somebody chose; an
agreement rate against a measured ceiling is a statement about the instrument.
Our candidates are 22.9–49.0 pp below the ceiling, and that sentence survives
any argument about where 80% came from.

### 6.3 The failure is a taste failure — and not a code-switching failure

All six judges are competent conversational models. Several of them would be
perfectly acceptable companions in the product this study is drawn from. What
they lack is not fluency and not, in the end, Hinglish. §5.4 shows the residual
signal is not merely weak but *inverted* on the archive with the least
ambiguous ground truth: the arm they prefer is the longer one (36.1 words/turn
vs 20.5), the more interrogative one (1.74 questions per turn, 63% of turns
ending in a question), the more explicitly supportive one. The trusted judge's
own rationales name it — *"piles on multiple questions per reply and generic
neediness"*, *"does therapist-style feeling-summaries"* — and a qualitative
spot-check finds the best-scoring candidate scoring authentic teasing as
*"mocking/dismissive"*. These judges are not indifferent. They have a confident
aesthetic and it is the assistant aesthetic: helpful, thorough, checking in.

Our first explanation for this was that romanised code-switching was defeating
the judges' register model, and we wrote it down. §5.9 tested it and it did not
survive. Translated to monolingual English, the same 96 units produce
recoveries of −3.1 to +6.6 percentage points — inside this programme's own
measured 13.6 pp noise floor for judged rates on byte-identical input, with
every English-condition interval overlapping its Hinglish counterpart, and with
the best judge in both conditions moving the *wrong* way. The correct
conclusion is narrower and, we think, more useful than the one we wanted:
**what these judges cannot do is the affective preference judgment, in either
language.** Code-switching was the setting in which we happened to catch it.

This narrowing has a real cost to the paper and we do not want to pretend
otherwise. It removes the claim that would have made this a code-switching
result and made the venue choice obvious. It also removes a mechanism that we
would have had no way to falsify from within the original design — which is the
argument for running the control.

### 6.4 Two mechanisms proposed, one retracted: the between-judge control

§5.5 retracts a favoritism claim this programme had already logged as measured.
The design that produced it was the natural one and, we suspect, the common
one: take the judge whose vendor family is a contestant, measure how much it
over-picks that arm relative to the ground truth, and control it against the
same judge on an archive where the conflict is absent. `grok-4.3` over-picked
the xAI arm on 81.0% of its non-tie units against a ground truth of 5.0%, and
its own within-judge control looked clean (+76.0 pp on the conflict archive
against +12.9 pp on the conflict-free one). A 16× effect, cleanly measured, on a
plausible mechanism.

The between-judge control kills it in one table. A **family-disjoint** judge,
`Mistral-Large-3`, shows a *larger* difference-in-differences on the same
archives (+71.7 pp vs grok's +63.1 pp), and the panel's other conflicted cell,
`gpt-5.6-terra` on `charm-luna`, runs *negative* (−9.7 pp). Family conflict does
not order the data. The parsimonious account is §6.3's: every judge over-picks
that archive's candidate because that candidate is the verbose,
question-stacking arm, and grok-4.3 happens to share a vendor with the arm the
panel-wide preference already favours. One mechanism, not two.

The general lesson is worth more than the retracted finding. **A
difference-in-differences with only a within-subject control is a mechanism
claim waiting to be retracted**, because it establishes that the conditions
differ without establishing that the proposed cause is what differs. Where the
"treatment" is a property of the judge (its family) and the "conditions" are
archives that differ in many other ways — including, here, ground-truth base
rates of 5.0% and 51.4%, which inflate every ratio computed against the
former — a between-judge control is not a robustness check. It is the
identification.

We also note what this retraction does *not* establish. It is a null from two
conflict cells with grossly mismatched base rates, and it cannot rule out a
moderate same-vendor effect. The honest statement is *"our data do not support
the claim we previously logged"*, and never *"vendor favoritism does not
occur"*.

### 6.5 Where this bites, and the protocol that refuses

The pull toward LLM judging is strongest exactly where this failure is worst.
Affective, open-ended, culturally-loaded tasks are the ones for which qualified
human annotators are scarcest and slowest, which is why teams reach for an
automatic judge; they are also the ones on which the judge's own aesthetic has
the most room to substitute itself for the construct. The same observation has
been made for low-resource languages (arXiv:2607.02235); our contribution is
that it holds for an affective construct in a *high*-resource language too, so
the usual mitigation — evaluate in English — is not one.

The last piece is the harness itself. Three validity guards in this study —
transport-miss counting, parse-miss counting, and self-invalidation above a
threshold — exist because each of them had already failed in production
somewhere in this programme's history: a $20 key limit silently converting a
qualification run into a transport-selected subset that scored 100%, a
120-token cap eating every verdict, a judge that answered a minority of calls
in prose and would have been scored on that minority. Each guard's job is to
let the harness **decline to issue a number**. A measurement protocol that
cannot refuse is not a protocol, it is a formatter.

The case that makes this concrete happened twice, on the two best numbers in
the paper, through two different guards. In August the OpenRouter key hit a $20
limit mid-run and the two anthropic reference judges came back at 100% and
88.9% on transport-selected denominators of 14 and 9; the transport guard
refused them. Three days later, with the limit raised and the run repeated in
full, `claude-opus-5` returned 17 of 17 — and the parse guard refused *that*,
because 128 of its 192 replies were empty: a 120-token cap, correct for the
rest of the panel, is not correct for a reasoning model, and a judge scored on
the 17 calls that survived is the same self-selected denominator wearing a
different failure. **Both refusals cost us the most flattering results we had.**
The second one still stands: the paper's honest statement about `claude-opus-5`
is *"a plausible qualified judge pending a rerun"*, and the reason we can say
that instead of "a judge that passed at 100%" is that the harness counted its
own misses and declined.

## §7 Limitations & Ethics

*(Ships as the paper's §7. Written in the paper's own voice. **The L-numbers
were re-sequenced** when the R4/R5 results folded in — clustering moved L4→L3,
the favoritism null L11→L12, self-application L10→L13 — and two new ones (L7
translator confound, L8 single-rater fidelity check) were added. Every
cross-reference in this file has been updated to the new numbers; upstream
`context/` entries cite results, not L-numbers, so nothing there breaks.)*

### 7.1 Limitations and threats to validity

**L1 — The ground truth is an LLM, not a human.** This is the study's single
largest threat and it is not mitigated away by anything else we did. Every
agreement figure in this paper is *agreement with the verdicts of one frontier
model*, `claude-opus-4.8`, on the `overall` axis. We claim four things for those
verdicts and no more: they were produced blind, with model identity stripped;
they were counterbalanced across presentation order and consolidated only where
both orders agreed; they were produced before this study existed and not for it;
and they were **acted upon** — they are the recorded reason two candidate models
were declined for a shipping consumer product. That makes them a decision record
with real consequences attached, which is a stronger warrant than a convenience
label, and it is still not a human annotation. A reader who does not accept
`claude-opus-4.8`'s taste as a proxy for native-speaker judgement should read
every number here as *"agreement with a specific trusted judge"* and not as
*"accuracy"*. We think that reading is the correct one and we have written the
artifact's datasheet to enforce it. §11 R3 prices the human-annotation run that
would close the gap; it is not run, and until it is, this is a workshop paper.

**L1 is now partially quantified, and the quantity is not reassuring.** §5.11
measures the ground truth's own test–retest reliability under the identical
protocol: `claude-opus-4.8` reproduces its own archived verdicts on **77.1%**
of units, 95% CI [67.7, 84.4]. Roughly one archived verdict in five is not
reproduced by the model that wrote it, so every agreement figure in this paper
is measured against a target with its own measurable instability, and the
pre-registered 80% bar sits above that ceiling. Two limits on how much this
buys. First, self-agreement is **not** validity: a judge can be perfectly
reproducible and consistently wrong about a linguistic community's register,
and this measurement is silent on that — it bounds the noise in the ground
truth, not its correctness. Second, it is a single retest at n = 96, seven days
after the original pass, on one deployment route, so it inherits L10's
drift caveat. What it does establish is that a reviewer asking *"how good is
your ground truth?"* now gets a number instead of an argument, and that the
number is low enough that the paper's claims are stated against it rather than
against the bar.

**L2 — n = 96 units.** Forty-eight per archive, 192 judgment rows per judge.
This is adequate to reject an 80% bar — every interval in §5.1 sits far below
it, and §5.8 shows that clustering does not change that — and inadequate for
fine discrimination among the failures. It is also inadequate for §5.4's
below-chance result once multiplicity is handled: Mistral's p = 0.022 does not
survive Bonferroni over the ten tests in §5.2–§5.4, which is why we report a
*pattern* (three of five judges below the chance floor on the landslide, all in
the same direction, with a matching qualitative reading) rather than resting on
a single p-value.

**L3 — Units are clustered on 12 beats.** The 96 units are not 96 independent
trials: each of the 12 affective beat scripts contributes 8 units to the pool
(2 lanes × 2 replicates × 2 archives), and a judge's error on the *teasing*
beat is a fact about how that judge reads teasing rather than eight coin flips.
§5.8 handles this with a beat-level cluster bootstrap and reports the clustered
intervals beside the naive ones. The honest answer to *"how many effectively
independent observations is this?"* is **12, not 96**, for the purpose of the
variance estimate. No FAIL verdict changed, but the reviewer who asks the
question deserves the franker number and now gets it.

**L4 — Single persona, single product, single language pair, two archives.**
Everything here comes from one deployed companion product with one persona, and
the two archives share the same 12-beat battery and the same scripted user
turns. Whether these judges fail the same way on a different affective product,
a different persona, or a different language pair is untested. The adjacent
literature makes it plausible; plausible is not measured, and the paper must
frame generalisation as an open question rather than a claim.

**L5 — The `overall` axis only.** The archived ground truth carries six further
axes (warmth, humour, register, specificity, brevity, personhood) and none of
them has been backtested. This is the most valuable cheap extension available
(§11 R2) and its absence is what keeps §6.3's mechanism account *inferential*:
a per-axis result would show directly whether the failure concentrates on
register and humour rather than on brevity, which is the strongest mechanism
evidence the existing data could yield.

**L6 — The code-switching hypothesis was tested, and refuted, at n = 96 with a
machine translator.** This limitation has been rewritten: it previously read
*"no causal manipulation of code-switching has been run"*. The manipulation has
now been run (§5.9) and it did not support the hypothesis. The limitation that
remains is about the strength of that negative: the control shows no recovery
*beyond this programme's own noise floor* on *these* 96 units with *this*
translation pipeline. It does not establish that code-switching never matters
for LLM judges, and a monolingual-English affective-companion corpus with its
own independently-produced trusted verdicts — which we do not have — would be a
stronger test than translating ours.

**L7 — The translator is a member of the judge panel, and this is a real
confound.** The English condition was produced by `gpt-5.6-terra`, which is also
one of the five judges under test. This was not a design choice we would defend
in the abstract: the credits-billed resource this programme runs on offered
exactly two deployed models suitable for the translation, and both are panel
members, so there was no family-disjoint translator available at $0. The
consequence is that terra's own recovery number cannot rule out a
self-familiarity effect. Two things bound the damage and neither removes it.
First, terra's score moved *down* (−3.1 pp), which is the opposite of what
self-familiarity predicts — weak evidence against a large effect, not proof at
n = 96. Second, the other four judges' numbers are not subject to the confound
at all, and the paper's conclusion rests on the whole panel rather than on
terra. A replication with a translator disjoint from the panel is the obvious
next control.

**L8 — The translation fidelity check is a single rater, and that rater is an
author.** Ten of 96 units (seeded selection, `seed=20260818`), both arms each,
twenty transcripts, read by the agent that executed the run. The verdict was
that meaning, tone, teasing and sarcasm register, emotional weight and
domain-specific content all survived translation, with no hallucinated content,
dropped turns or flattened teasing observed. We report that as what it is: a
**single-rater spot check by a non-independent rater on 10% of the corpus**, not
verification. A second, independent rater is future work and is not claimed.

**L9 — Judge decoding parameters were not swept.** Every judge ran at
temperature 1 — terra's API pins it, and the others were matched to it so the
panel would be comparable. Lower temperature might reduce position bias, which
would change §5.3's magnitudes though not obviously its mechanism. Untested.

**L10 — Deployment drift, and the date stamp that follows from it.** This
programme has measured an Azure Foundry deployment's behaviour shifting
materially over four days. Judge results are therefore **date-stamped
evidence**, not properties of a model name: the R0 runs are 2026-08-15 and the
R4 runs 2026-08-18. A re-run at +30 days (§11 R7) is the cheap way to bound
this and has not been done.

**L11 — One pre-registered candidate family was never tested.**
`Llama-4-Maverick` was named as a qualification candidate in the
pre-registration and was never deployed or run — it was unavailable on this
tenant. The paper says "five families tried" and must never say "every family
tried". This correction has already been logged upstream against the
`cohere-judge` entry that overstated it.

**L12 — The favoritism null is a weak null.** §5.5 reports no evidence of
same-vendor favoritism, from a design that could not have detected a moderate
effect: two conflict cells in total, and two archives whose ground-truth
candidate-win base rates are 5.0% and 51.4%, which makes the elevation metric
incomparable across them in an uncontrolled way — and which is also how a "16×"
headline was arithmetically reachable in the first place. The claim is *"our
data do not support the claim we previously logged"*, never *"vendor favoritism
does not occur"*.

**L13 — Self-application: the paper is bound by its own noise floor.** This
programme measured a 13.6 pp spread in judged rates across 300 arm-pairs whose
input was provably byte-identical, i.e. where the setting under test could not
act. We therefore may not report any judged *rate difference* below 13.6 pp as
a finding, and we do not. Two places in the paper approach the floor and both
are stated as nulls rather than equivalences: §5.7's 30.9% vs 28.1% for
DeepSeek Pro vs Flash is reported as *"no difference detected"*, and §5.9's
recoveries of −3.1 to +6.6 pp are reported as *inside the floor* rather than as
evidence of a small real effect. If a future run at larger n resolves either,
the finding changes and this paper's null does not become wrong — it becomes
underpowered, which is a different thing and is why the distinction is worth
keeping.

### 7.2 On carrying our own retraction in the paper

Two claims in this paper are refutations of findings this programme had already
logged as measured: the same-vendor favoritism attribution (§5.5) and the
code-switching mechanism (§5.9). We have kept both in the paper, with the
original reasoning shown, rather than quietly reporting only the corrected
state.

We think this is a strength and we want to say why without dressing it up. It
is not that we are unusually scrupulous; it is that **the two retractions are
the paper's best evidence for its own central argument.** The paper's claim is
that a plausible mechanism, cleanly measured, with a control that looks
adequate, can still be wrong — and that the only reliable defence is a control
that could have come out the other way. We are able to make that argument
concretely because it happened to us twice, in the space of one study, with the
numbers preserved. A within-judge control produced a 16× effect that a
between-judge control erased. A direction-of-error result plus a qualitative
reading produced a register hypothesis that a translation control did not
support. Both were reasonable readings of the data available at the time. Both
were wrong.

The generalisable form is a question worth asking of any mechanism claim,
including the ones we still believe: *what control did this survive, and could
that control have refuted it?* Where the answer is that the control varied only
the thing already assumed to matter, the claim has not been tested. That is a
cheap question and it would have caught both of ours earlier.

### 7.3 Ethics statement

**Human subjects.** None. Every conversation in this study is a scripted
battery: 12 affective beats × 6 turns, with **identical scripted user turns
across arms**, addressed to a fictional interlocutor. No real user
conversations, no production database rows, and no personal data of any kind
enter the corpus, the analysis, or the proposed release. No IRB review was
sought because there are no human participants; the human labour in the study
is the authors' own.

**Personal data and de-identification.** The release bundle (§9.2) is stripped
before publication, not asserted to be clean: the checklist in §9.2 greps for
the persona text, pseudonymises the scripted fictional interlocutor's name, and
verifies that no key, endpoint, deployment name or resource identifier survives.
The scripted material contains Indian place references (a Bangalore landmark,
festival calendar entries) that are character detail rather than identifying
information; the owner confirms them before release. §13 records the checklist
as a gate rather than an intention.

**Cultural representation, and who is qualified to judge it.** This paper makes
claims about what counts as natural Hinglish companion register and about
judges misreading teasing as dismissiveness. Those claims currently rest on an
LLM's verdicts and on a product team's judgement, not on native-speaker
annotation (L1). We regard that as an ethical limitation and not only a
methodological one: a paper asserting that automatic judges misread a
linguistic community's register, without that community's annotators in the
loop, is asserting something it has not earned. The human-annotation run (§11
R3) is specified as **≥2 native Hinglish raters with inter-rater agreement
reported**, and the paper should not be submitted to an archival venue without
it.

**Dual use and foreseeable misuse.** The principal misuse risk is the release
itself being adopted as a benchmark of judge *correctness*. It is not one: it
measures agreement with one trusted judge's decisions on one product's
construct. A leaderboard built on it would launder an LLM's aesthetic into an
apparent ground truth, which is the failure mode this paper exists to document.
The datasheet must state this in its own voice and in its first section, not in
a footnote. A second, milder risk is that the per-vendor quirk log reads as
comparative vendor criticism; it is a deployment-compatibility record from one
tenant on specific dates, and it is labelled as such.

**Conflicts of interest and positionality.** The authors are the product team
whose deployment decisions produced the ground-truth verdicts, and the study
evaluates candidate judges the same team intended to use for its own downstream
gates. The incentive that matters ran *toward* a judge passing — a qualified
credits-billed judge would have avoided a roughly $400 cash spend — and every
candidate failed, which is the direction of bias that argues against the result
being manufactured. The pre-registration of the bar, and its provenance in a
document written before any candidate ran, is the structural mitigation. We
state the conflict rather than relying on the mitigation alone.

**Compute and environmental cost.** Disclosed in full and it is small: the R0
backtest is 1,536 judgment rows; the R4 control is 1,152 calls and ≈1.23 M
tokens. All candidate-judge runs were billed to an Azure AI Foundry
startup-credits grant at **$0 cash**; one invalid OpenRouter reference run cost
≈$1.80 and is reported as sunk. No model was trained or fine-tuned for this
work.

**Licensing and consent to release.** The transcripts are model output over
authored scripts; the verdicts are model output. There is no third-party
copyright interest and no data-subject consent to obtain. The proposed licences
(Apache-2.0 code, CC BY 4.0 data) are the owner's decision and are pending at
the time of writing (§13).

---

## §9 Artifact release — the publishable eval suite

*(Ships as the paper's **§8**. Kept at §9 here so the §9.x sub-numbers cited
throughout this file and in `context/` still resolve.)*

### 9.1 What can be released, and the hard constraint

The persona is the product. `src/engine/persona.ts` (~45k characters) is the
company's principal asset and is **not** releasable. The constraint is sharper
than it first appears: the archived bake-off files **embed the full persona
string** — `pb-merged1.json` carries `personaText` at **44,002 characters** and
`personaVoice` at **47,094 characters**. Releasing the raw archives as they sit
would publish the product.

The good news is that the persona is not needed for anything the paper claims.
The judge-qualification result depends on (transcripts, verdicts, rubric,
harness) and on none of the prompt that produced the transcripts.

### 9.2 Proposed release: `vyakti-judge-qual` (a standalone repo)

| component | source | released? | treatment |
|---|---|---|---|
| **Judge-qualification harness** | `evals/dbattery/judge-backtest.mjs` | **YES** | Generalised per `beyond-meera`: rubric, bar, archive adapter and judge configs become parameters. Ships with the transport/parse guards intact — they are a contribution. |
| **Analysis / table derivation** | `docs/paper/analysis/derive-tables.mjs` | **YES** | As-is. Reproduces every paper number offline. |
| **Ground-truth verdicts** | `pb-judged-grok.json`, `pb-judged.json` | **YES** | 192 verdicts, 7 axes each, with rationales. This is the scarce asset. |
| **Transcripts (both arms, both archives)** | `pb-merged1/2.json`, `pb-raw/pb-raw2.json` | **YES, stripped** | Extract only `results[].turns[].{user, reply}` + `{model, lane, beat, rep}`. **Drop `personaText`/`personaVoice` entirely.** Drop `cost`, `in`, `out`, `ms` (they leak deployment economics; keep them only if the owner wants the cost transparency). |
| **Scripted user turns** | same | **YES** | Authored battery scripts, not user data (`personality-battery.md`: *"identical scripted user turns across arms"*). Confirmed no real conversation logs are involved. |
| **The 1,536 raw judgment rows** | `judges.json.raw_rows` | **YES** | Already contains no persona text. Keep `judge_configs` (quirk log is a genuine contribution); strip `deployment` names and any endpoint hints. |
| **Judge quirk log** | `judges.json._quirks_note`, `measurements.md` | **YES** | Reformatted as a table. Practitioners will use this more than the results. |
| `src/engine/persona.ts` | — | **NO** | Product IP. |
| `evals/candidate/corpus*` (2,304 compiled contexts) | — | **NO** | Regenerating them requires the compiler and the persona. Out of scope for Paper B; revisit for Paper A. |
| `evals/dbattery/d0–d2`, `sham.mjs`, `fixtures.json` | — | **DEFER** | Valuable (a battery that can say "no difference" on a true no-op) but Meera-specific in its rubrics and word lists (`generalization-audit`). Release with Paper A. |
| `evals/archives/visiongate-confirm/` | — | **NO** (this paper) | Different task (vision fabrication). Its 16 stimuli are screenshots and need a separate privacy review. |
| `realtime-azure/` | — | **NO** | n=24, no incumbent arm in-archive; adds nothing here. |

**De-identification checklist (must run before release, not asserted):**
1. Grep the release tree for the first 200 characters of `personaText` and of
   `personaVoice` — zero hits required.
2. Grep for the fictional user's name (`Raghav`) and decide: keep (it is a
   scripted fictional interlocutor) or pseudonymise to `USER`. Recommend
   pseudonymise — it costs nothing and removes the question.
3. Grep for any real place/person that could identify the owner. The scripts
   contain Bangalore landmarks (`Silk Board`) and a design job; these are
   character details, not PII, but the owner should confirm.
4. Confirm no API key, endpoint, deployment name or resource id survives
   (`api/_config.js` is gitignored and must stay out).
5. Confirm no `meera_log` / production DB row is present. The archives are
   battery outputs; none should be. **Verify, don't assume.**

### 9.3 License and repo shape

```
vyakti-judge-qual/
  README.md                 # protocol, bar, how to add a judge, what a FAIL means
  LICENSE-CODE              # Apache-2.0  (harness + analysis)
  LICENSE-DATA              # CC BY 4.0   (transcripts, verdicts, raw rows)
  DATASHEET.md              # Gebru-style datasheet: provenance, scripted-not-real,
                            #   LLM-produced ground truth stated up front, known biases
  protocol/
    RUBRIC.md               # verbatim judge prompt + the "overall first" rationale
    BAR.md                  # the >=80% Wilson-lower-bound rule and its pre-registration
    QUIRKS.md               # per-vendor deployment quirk table
  harness/
    judge-backtest.mjs      # generalised; --judge, --archive, --rubric, --bar
    providers/              # azure.mjs, openrouter.mjs  (keys via env only)
    guards.mjs              # transport/parse miss classification + self-invalidation
  analysis/
    derive-tables.mjs       # every paper number, offline
  data/
    archives/charm-A/{transcripts.json, verdicts.json}   # charm-grok, renamed
    archives/charm-B/{transcripts.json, verdicts.json}   # charm-luna, renamed
    raw_rows.jsonl          # 1,536 candidate-judge rows
  CITATION.cff
```

**Licensing rationale.** Apache-2.0 on code (permissive, patent grant, the
default the ML tooling ecosystem expects). **CC BY 4.0** on data — deliberately
*not* a non-commercial or share-alike license, because a benchmark nobody may use
commercially does not get adopted, and adoption is the entire point of releasing
a qualification protocol. The persona stays proprietary and unreleased, which is
where the commercial protection actually lives. `[OWNER DECISION REQUIRED]`

**Repo naming and framing.** Name it for the protocol, not the product:
practitioners should be able to point their own judge panel at their own archive.
That directly serves the `beyond-meera` directive (*"the fundamental research we
are doing should be scalable and flexible for other use cases"*) — the release
shape **is** the generalisation pass.

### 9.5 BUILT — what actually shipped, and where it deviates from the plan above

**The bundle exists: `release/vyakti-judge-qual/`, 34 files, 3.4 MB**, produced
by `docs/paper/build-release-bundle.mjs` (offline, deterministic, $0) and
verified by `docs/paper/verify-release-bundle.mjs` (§13.4, 22 gates, all pass).
Everything authored for it — README, datasheet, licences, protocol docs, the
generalised harness — lives in `docs/paper/release-src/` and is copied verbatim,
so it can be reviewed in this repository before it is published anywhere.

The plan above was written before the bundle was built. Five deviations, each
with its reason:

1. **The archives keep their real names** (`charm-grok`, `charm-luna`) rather
   than being renamed `charm-A`/`charm-B` as §9.3 proposed. The paper now names
   both archives and both arm models openly, and the judge rows key on the
   archive id, so renaming would break traceability between paper and bundle and
   buy nothing.
2. **Per-call `usage` is stripped from the released judge rows**, not just
   per-turn cost from the transcripts. Run-level call and token totals are
   published in `data/runs/cost.json` instead. Same reason §9.2 gives for
   dropping per-turn cost, applied consistently.
3. **`harnessMiss` strings are redacted to kind, HTTP status and a coarse reason
   class.** This was not in the plan and it is the most important change: the raw
   provider bodies carried the tenant's endpoint hostname and request ids
   (§13.4). The miss *kind* and *count* are what the guards use and both are
   preserved, so no analysis result changes. The judges' own prose replies —
   the `unparseable:` bodies — are kept, pseudonymised and truncated, because
   they are the evidence for §5.6.
4. **`clustered-cis.mjs` ships too**, not only `derive-tables.mjs`. Without it
   the clustered intervals in §5.8/§5.9/§5.10 are unreproducible from the
   bundle, which would break the release's own reproduction claim. Its seeded
   PRNG is extracted to `harness/rng.mjs` so the bundle has no dependency on
   this repository.
5. **The harness is a rewrite, not a copy.** `evals/dbattery/judge-backtest.mjs`
   is Meera-specific in its paths, its default panel and most of its comments.
   The released `harness/judge-backtest.mjs` takes archive, axis, bar, rubric and
   judge configs as parameters, reads the rubric from `protocol/RUBRIC.md` at run
   time, refuses on leakage, and prints the four position-bias numbers (`slot-A`,
   observed tie rate, content-blind prediction, and the gap between them) on
   every cell so a user cannot report the agreement rate alone by accident. It
   runs end to end offline under `--dry-run`; this was smoke-tested and the
   deterministic mock judge scores 28/96, which is what a content-blind judge
   should score.

**Reproduction from the bundle alone is verified.** `node
analysis/derive-tables.mjs` and `node analysis/clustered-cis.mjs`, run inside
`release/vyakti-judge-qual/` with no network and no key, print every headline
number in §5 — including §5.11's 74/96 = 77.1% [67.7, 84.4] ceiling and its
clustered [69.8, 85.4] — identically to the private-repo versions.

### 9.4 What the release deliberately does not claim

The datasheet must state, in its own voice and not in a footnote, that the
ground-truth verdicts are **LLM-produced, not human-annotated**, and that the
suite therefore measures *agreement with a specific trusted judge's decisions*,
not *correctness*. A benchmark that lets its users forget that will be misused
within a month.

---

## §10 Claim → evidence → gap table

Every claim the draft makes or wants to make. **Rows marked GAP are not currently
supported and either need a run (§11) or must be cut.**

| # | claim | evidence | status / gap |
|---|---|---|---|
| C1 | All six credit-billed candidate judges fail the ≥80% bar | `judges.json.pooled`; `measurements.md` `judge-backtest`, `grok43-judge`, `deepseek-pro-judge`, `mistral-judge`, `cohere-judge`; reproduced by `derive-tables.mjs` T3 | **SUPPORTED** |
| C2 | Every 95% CI lies entirely below the bar | `derive-tables.mjs` T3 (Wilson) **and** `clustered-cis.mjs` (beat-clustered bootstrap) | **SUPPORTED, twice.** Naive interval highs run 37.8%–63.8%; clustered interval highs run 38.5%–64.6%. Both far below 80%. Drawn as **Figure F1**. |
| C3 | Four of five scorable judges are indistinguishable from uniform-random | `derive-tables.mjs` T3 (exact binomial vs 30.5%) | **SUPPORTED** (baseline derived from the archived verdict distribution, not assumed) |
| C4 | Position bias evacuates the counterbalance; two judges land exactly on the pure-slot-A prediction | `derive-tables.mjs` T1 (16.7% prediction) + T2 (16.7% observed, twice); generalised to the curve *q*²+(1−*q*)² in §5.3 and plotted in **Figure F2** | **SUPPORTED.** The curve is analytic and labelled as such; every plotted point is measured. Mistral-Large-3 sits 1.8–2.6 pp off the content-blind prediction on both archives. |
| C5 | Three judges fall below the 25% chance floor on the landslide archive | `derive-tables.mjs` T2 decisive accuracy | **SUPPORTED as a pattern**; the single-judge significance (Mistral p=0.022) does **not** survive Bonferroni over 10 tests — stated in §5.4 |
| C6 | The judges' error has a *direction*: they prefer the rejected arm | `derive-tables.mjs` T2 `decisiveFreshPicks` | **SUPPORTED** |
| C7 | The rejected arm is longer, more interrogative, more assistant-shaped | `measurements.md` `charm-grok` (36.1 w/t, 1.74 q/t, 63% question-final); `personality-battery.md` | **SUPPORTED** |
| C8 | **Therefore** the failure is caused by code-switched *affective register* | direction-of-error (C6+C7) + one qualitative reading | **REFUTED. G2 IS CLOSED BY REFUTATION, NOT BY CONFIRMATION — the claim inverted.** §5.9 [R4] re-judged the same 96 units machine-translated to monolingual English: recoveries of −3.1 to +6.6 pp (mean +3.2), every English clustered CI overlapping its Hinglish counterpart, every recovery inside `fab-noise-floor`'s 13.6 pp band, and the best judge in both conditions moving the *wrong* way. Code-switching is **not** the cause. C8 is withdrawn and replaced by C8b. The paper is retitled around this (§1); the string "fails on code-switched affective register" is banned from the text. |
| C8b | The failure is in the **affective/companion preference judgment itself**, and it survives translation to monolingual English | §5.9 [R4] recovery table; `analysis/r4/summary.json`; **Figure F3** | **SUPPORTED as a bounded negative.** What is established: no recovery beyond this programme's own noise floor, on these 96 units, with this translation pipeline. What is *not* established: that code-switching never matters for LLM judges. Two confounds carried openly — the translator is a panel member (§7 L7) and the fidelity check is single-rater (§7 L8). |
| C9 | grok-4.3 shows ~16× same-vendor favoritism | `judges.json` `familyConflict` (81.0% vs 5.0%) + within-judge control (+12.9 pp on the conflict-free archive) | **RETRACTED, AND THE RETRACTION IS CLOSED — it is *in* the paper.** The between-judge control refutes it: family-disjoint `Mistral-Large-3` shows a **larger** DiD (+71.7 pp vs grok's +63.1 pp) and the second conflicted cell (terra) is negative (−9.7 pp); `derive-tables.mjs` T5. It ships as §5.5 (the result), §6.4 (the general lesson: a within-subject-only DiD is a mechanism claim waiting to be retracted) and §7.2 (why carrying it is a strength). Logged upstream as `measurements.md` `grok43-favoritism-retracted`. The 81%-vs-5% figure survives as an agreement failure and is counted in §5.4; only the causal attribution is withdrawn. |
| C10 | terra shows same-vendor favoritism on charm-luna | `derive-tables.mjs` T4 (89.5% vs 51.4%) | **NOT SUPPORTED.** Subsumed by C9's retraction; terra's DiD is negative. |
| C10b | **No** same-vendor favoritism is detectable in this data | `derive-tables.mjs` T5 | **SUPPORTED as a null**, and the paper must say why the design could not detect one even if present: the two archives have grossly mismatched ground-truth base rates (5.0% vs 51.4%) |
| C11 | Scale does not fix the DeepSeek pathology | `deepseek-pro-judge`; T3 | **SUPPORTED** as "no difference detected"; **must not** be stated as equivalence (`fab-noise-floor`) |
| C12 | Cohere is protocol-unfit (158/192 parse misses) | `cohere-judge`; `judges.json.per_archive` | **SUPPORTED** |
| C13 | The bar was pre-registered before any candidate ran | `SPEC.md` §10-Q5; `decisions.md` `d2-on-credits` (2026-08-15); `SWAP-TEST-PREREG.md` Amendment 2 | **SUPPORTED**; the paper should cite the **commit timestamps**, which have not yet been extracted — **GAP-G6** |
| C14 | The anthropic reference runs are invalid, not results | `judge-run-transport-invalid`; harness self-invalidation; post-[R1] the surviving invalid row is opus-5 at 17/17 with 128/192 parse misses | **SUPPORTED**, and now demonstrated twice on two different guards (transport 2026-08-15, parse 2026-08-18) |
| C24 | The ground truth's own test–retest ceiling is 77.1%, and the pre-registered bar sits above it | §5.11 [R1]; `derive-tables.mjs` T3 + `clustered-cis.mjs` opus-4.8 row; `measurements.md` `ground-truth-ceiling` | **SUPPORTED.** 74/96, Wilson [67.7, 84.4], clustered [69.8, 85.4], 0 transport / 0 parse misses, slot-A 45.3%. Per archive 85.4% / 68.8%. Drawn as F1's ceiling band. |
| C25 | The candidates fail to approach the ceiling, not merely a chosen bar | §5.11; T3 point estimates against C24 | **SUPPORTED.** 22.9–49.0 pp below the measured ceiling; the best candidate recovers ~two-thirds of the archive's self-agreement, four of five recover less than half. This is the bar-independent form of C1 and the paper leads with it. |
| C26 | A judge exists that passes the bar | opus-5 17/17 — **INVALID (parse)** | **GAP-G5 STILL OPEN, but now measured rather than blocked.** The run happened; it self-invalidated on a 120-token cap against a reasoning model. What can be said: *a plausible qualified judge pending a fixed-config rerun* (§11 R1b, ≈$1). What may **not** be said: that any judge has been shown to pass. |
| C15 | No published work does this backtest on romanised Hinglish affective register | §0.2 survey, 8 nearest works fetched 2026-08-18 | **SUPPORTED as of 2026-08-18**; re-run the survey immediately before posting — **GAP-G7** |
| C16 | "Every Azure-direct family disjoint from both arms has been tried" | `cohere-judge` branch conclusion | **CLOSED BY REWORDING.** `Llama-4-Maverick` was pre-registered and was NA on this tenant, never deployed or run. The paper says **"five families tried"** and carries it as §7 L11. Corrected upstream in `grok43-favoritism-retracted`. R6 would let us say "six"; it is not needed for correctness. |
| C17 | The trusted judge's slot-A rate is 61% | `measurements.md` `charm-grok` | **CLOSED.** Misattributed by archive: `charm-grok` recomputes to **56.3%**, `charm-luna` is **61.5%**, pooled **58.9%**. The paper uses the recomputed per-archive values throughout and Figure F2 plots the pooled 58.9%. Correction logged upstream in `grok43-favoritism-retracted`. |
| C18 | Judge agreement generalises beyond this persona/product | — | **GAP-G3 — NO EVIDENCE.** Must be framed as an open question, never claimed. |
| C19 | Units are independent | — | **G4 CLOSED.** §5.8 [R5]: beat-level cluster bootstrap (12 clusters, 10,000 reps, seeded) reported beside the naive Wilson intervals. Clustering widens each FAIL interval by −0.2 to +3.1 pp and **no FAIL verdict changes**; the two rows that flip are both already-INVALID transport-crippled references. The binomial CIs were anti-conservative as the draft said, and the paper now carries the honest ones. The paper also now answers the harder question plainly: **12 effectively independent clusters, not 96 trials** (§7 L3). |
| C20 | A judge that clears the bar exists | superseded by C26 | **GAP-G5 — PARTIALLY CLOSED BY MEASUREMENT, still unproven by demonstration.** [R1] ran. It produced the ceiling (C24) and one parse-invalid 17/17 (C26). The paper can now say the bar was above the achievable ceiling; it still cannot say any judge passed. |
| C21 | The ground truth reflects native-speaker judgement | — | **GAP-G1 — THE CENTRAL GAP.** No human annotation exists. §11 R3. **Narrowed, not closed, by C24**: the ground truth's noise is now bounded (77.1% self-agreement) but its validity is not addressed — self-consistency is not correctness. |
| C22 | Per-axis: judges fail worse on register/humour than on brevity | §5.10 [R2] pooled-per-axis clustered CIs; `analysis/r2/summary.json`, `analysis/r2/pooled-per-axis.json` | **G8 CLOSED, PARTIALLY CONFIRMED.** `brevity` is a genuine outlier (pooled 55.2%, clustered CI does not overlap `warmth`/`register`/`overall`) and `warmth`+`register` are the two hardest axes — but `humour` is NOT worse than `specificity`; the two are statistically indistinguishable (46.2% vs 45.6%, overlapping CIs) alongside `personhood`. Three-tier structure, not the predicted binary: `brevity` alone on top, `warmth`+`register`(+`overall`) on bottom, `humour`+`specificity`+`personhood` bunched in the middle. Every axis still FAILS the 80% bar. |
| C23 | Judge results are stable over time | `vision-drift-4day` shows a Foundry deployment drifting in 4 days | **GAP-G9 — UNMEASURED FOR JUDGES.** Date-stamp everything; a re-run at +30 days is §11 R7. |

### Gap summary — reconciled

#### CLOSED

| gap | how it closed | where it lives in the paper |
|---|---|---|
| **G2** — causality of "code-switched register" | **CLOSED BY REFUTATION.** R4 ran, and the hypothesis did not survive it. This is not a gap that was filled; it is a claim that inverted. The paper's contribution here is the controlled negative, and the title carries it. | §5.9, §6.3, §7 L6–L8, Figure F3, C8/C8b |
| **G4** — unit independence / CI validity | **CLOSED BY R5.** Beat-level cluster bootstrap replaces the assumption with a measurement. Intervals widen by up to 3.1 pp; no FAIL verdict changes; the paper now states 12 effective clusters rather than 96 trials. | §5.8, §7 L3, Figure F1, C19 |
| **C9** — the same-vendor favoritism claim | **CLOSED BY RETRACTION, IN THE PAPER.** The between-judge control refutes our own logged finding, and the refutation is a section rather than a silent edit. Upstream supersession logged as `grok43-favoritism-retracted`; `SWAP-TEST-PREREG.md` Amendment 2 re-read and amended to rest on the structural justification rather than the retracted measured instance. | §5.5, §6.4, §7.2, §7 L12, C9/C10/C10b |
| **C16** — "every disjoint family tried" | closed by rewording to "five families"; `Llama-4-Maverick` was NA on this tenant | §7 L11 |
| **C17** — the "61% slot-A" figure | closed; misattributed by archive, recomputed to 56.3% / 61.5% / 58.9% pooled | §5.0 correction note, Figure F2 |
| **G5** (in part) — is the bar achievable? | **MEASURED, NOT DEMONSTRATED.** [R1] ran the ground truth against its own archive: 77.1% [67.7, 84.4], so the ≥80% bar was above the measured ceiling and the FAILs are restated against the ceiling instead. The remaining half of G5 — *showing* a judge that passes — is still open: opus-5's rerun self-invalidated on parse. | §5.11, §6.2, §7 L1, Figure F1, C24/C25/C26 |
| **G6** — pre-registration commit hashes | **CLOSED.** Extracted and cited: `2e82a0f` (2026-08-13T12:20:22Z, `docs/SPEC.md` §10-Q5, the ≥80% methodology), `c18b239` (2026-08-15T09:37:58Z, `decisions.md` `d2-on-credits`, the judge-qualification instantiation — 25 minutes before the first backtest result was committed), `bfeb979` (2026-08-15T10:24:29Z, the pre-registration), `a7198a2` (Amendment 1), `a053019` (2026-08-15T11:28:09Z, Amendment 2, *"qualification bar unchanged"*), `d10e840` (2026-08-18T09:27:19Z, Amendment 2a, the favoritism retraction). | §4.5, §13.5 P1 |
| **G7** — novelty survey freshness | **RE-RUN, and it must be run once more.** Second live pass 2026-08-18 (late, after the first): nothing newly published scoops C1/C1b/C2, but the pass surfaced **two adjacent works the first scan missed**, both pre-dating it, and both are now cited in §2.2 — `BabelJudge` (arXiv:2606.22329) and `Reliability without Validity` (arXiv:2606.19544). Because the second pass found misses rather than new arrivals, the honest state is *the survey has a recall problem, not a freshness problem*. **Re-run once more on the submission day (2026-08-29).** | §0.2, §2.2, §13.5 P2 |
| **G8** — per-axis mechanism | **CLOSED, PARTIALLY CONFIRMED.** R2 ran all six not-yet-backtested axes (96 units × 2 orders × 5 judges each, 5,760 calls); `overall` reused from R0. The predicted binary (register/humour bad, brevity/specificity good) is half right: `brevity` is a genuine clustered-CI-distinguishable outlier (55.2% pooled, does not overlap `warmth`/`register`/`overall`), but `humour` is statistically indistinguishable from `specificity` and `personhood` — a three-tier structure, not two. Every axis still fails the 80% bar; the mechanism claim is now measured, not inferred. | §5.10, §6.3, C22 |

#### OPEN — and what each would upgrade

| gap | what it currently blocks | cheapest fix | what closing it upgrades |
|---|---|---|---|
| **G1** — the ground truth is an LLM, not humans | the paper's **headline interpretation**, and its venue class | **R3** — blind, both-orders annotation of ≥48 units (ideally all 96) by **≥2 native Hinglish raters**, with Cohen's/Krippendorff's κ reported against the trusted judge. $0 if the owner plus one native speaker annotate; ~$96 outsourced. Needs a small static blind-annotation page (half a day). | Converts every "agreement with a trusted judge" claim into a claim about human-aligned judgement. This is the difference between a **workshop paper** and a plausible **Findings** submission, and it is also the ethics gap in §7.3 — a paper about judges misreading a community's register with no annotators from that community. **Highest value item on the list.** |
| **G5b** — no judge has ever been *shown* to pass the bar | the claim that a qualified judge is reachable; a reviewer can still say "you never produced one" | **R1b** — re-run `claude-opus-5` with a token cap that fits a reasoning model (the 120-cap emptied 128/192 replies). ≈$1 cash at the logged OpenRouter rate, 192 calls. | Turns "six judges failed and the ceiling is 77%" into "…and here is one that reaches it", which is what makes the protocol a *qualification* protocol rather than a rejection log. The ceiling half of the old G5 is already closed (§5.11). |
| **G3** — generalisation beyond this persona/product | any claim that the result transfers | no cheap fix; a second affective corpus with its own trusted verdicts | Would move §7 L4 from "untested" to "tested once elsewhere". Out of scope for this paper; framed as an open question, never claimed. |
| **G9** — judge-result stability over time | nothing in the paper as written (results are date-stamped) | **R7** — identical protocol, 2 judges, +30 days. Credits, 384 calls, $0 cash. | Would bound the deployment-drift risk in §7 L10 rather than merely disclosing it. |

---

## §11 Runs still needed, priced

**Cap discipline.** `relational-wedge` §5 caps the whole swap+paper programme at
**~$400–500 grant-equivalent**, most of it reserved for the judged gates. The
list below is ordered so that everything genuinely needed for Paper B is either
**$0** or **credits**, with exactly one small cash item flagged for an owner
decision.

**A pricing honesty note that must not be smoothed over:** `judges.json` carries
an open ticket — *"no per-token Azure credit-consumption rate exists in-repo for
credits-billed judges."* Credit-billed runs below are therefore priced in
**calls and tokens**, benchmarked against measured runs, **not in dollars**.
Estimating a dollar figure would be fabricating a rate.

| # | run | what it buys | cost | blocked on |
|---|---|---|---|---|
| **R0** | The analysis in §5 | the entire results section | **$0, already spent** | done |
| **R5** | Mixed-effects re-analysis clustering on beat (12 clusters) | fixes G4; correct CIs | **$0, DONE — §5.8 [R5]** | done |
| **R2** | **6-axis re-judge** (`overall` reused from R0): same 96 units × 2 orders × 5 scorable judges | fixed G8. **DONE — §5.10 [R2].** Outcome: partial concentration — `brevity` a genuine outlier (pooled 55.2%, clustered CI clear of `warmth`/`register`/`overall`), but `humour` statistically indistinguishable from `specificity`/`personhood`; every axis still fails the 80% bar. | credits, **spent**: 5,760 calls, 6,761,468 prompt + 139,655 completion tokens; **$0 cash** | done |
| **R4** | **English-translation control**: same 96 units machine-translated to monolingual English preserving content, re-judged by all 5 scorable judges | tested G2. **DONE — §5.9 [R4].** Outcome: register causality NOT established (every recovery inside the fab-noise-floor band); this is a completed negative result, not a pending item — the title/G2 claim need rewording, not a further run. | credits, **spent**: 192 translation + 960 judging = 1,152 calls, ≈1.23M tokens; **$0 cash** | done |
| **R3** | **Human annotation**: ≥48 units (ideally all 96), blind, both orders, ≥2 native Hinglish raters, report Cohen's/Krippendorff's κ against the trusted judge | fixes G1 — the central gap; without it the paper is a workshop paper permanently | **$0 if the owner + one native-speaker friend annotate** (recommended); ~$96 cash at $0.50/unit × 96 × 2 raters if outsourced | owner time; a blind annotation UI (a static HTML page, half a day) |
| **R1** | **Re-run the two anthropic reference judges** with a raised OpenRouter key limit | fixed the ceiling half of G5. **DONE — §5.11 [R1].** Outcome: the ground truth's own test–retest is **77.1% [67.7, 84.4]**, below the pre-registered bar, so the bar exceeded its own ceiling; every FAIL is restated as 22.9–49.0 pp below the measured ceiling. opus-5's half self-invalidated on parse (128/192 empty at a 120-token cap). | cash, **spent**: 384 calls, 650,150 prompt + 27,175 completion tokens, ≈**$3.93** at the logged rate | done |
| **R1b** | **Re-run `claude-opus-5` only**, token cap raised to fit a reasoning model | fixes G5b — would be the paper's first demonstrated *passing* judge, and the qualified judge the whole judged battery waits on | ≈**$1 cash**, 192 calls at the logged rate. **Re-fetch the rate before running.** | **OWNER DECISION.** Highest value-per-dollar item remaining; not required for JUDGe. |
| **R6** | `Llama-4-Maverick` backtest | fixes C16 — makes "every disjoint family" honest, or lets us reword instead | credits; **192 calls**; **$0 cash** | one owner deploy click in Foundry |
| **R7** | Judge-drift re-run at +30 days (identical protocol, 2 judges) | fixes G9; `vision-drift-4day` makes this a live risk | credits; **384 calls**; **$0 cash** | calendar |
| **R8** | *(Paper A only)* incumbent arm to band scale | Paper A's D1 verdict | ~30 days on the free pool, or the owner's pending Google credits | not Paper B's blocker |

**Total for a publishable Paper B: $0 credits-cash + ~$5 cash (R1, optional) +
owner annotation time (R3).** Every other item rides the grant at a few hundred
to a thousand calls — a rounding error against the runs already spent (1,536
judgment rows, 3,201 calls in the vision battery alone).

**Recommended order:** ~~R5 (free, today)~~ **DONE** → ~~R2 (credits, the
mechanism decomposition)~~ **DONE — partial concentration, §5.10** →
~~R4 (credits, the causal control)~~ **DONE — register causality NOT
established, §5.9** → ~~R1 (the ~$4 ceiling)~~ **DONE — the bar exceeded its own
ceiling, §5.11** → R1b (owner's ~$1 call, the first passing judge) → R3 (owner
time, the credibility control) → R6/R7 as tidy-up.

### An honest answer to "can we extend n cheaply from the archives?"

**Partly, and not in the way that would help most.** Checked directly:

- **More ground-truth verdicts do not exist.** The archives hold exactly 96 + 96
  blind verdicts. `charm-luna` contains a **third generated arm** (`gpt-5.6-terra`)
  that *"ran but was never judged"* (`fixtures.json.gaps`), and
  `realtime-azure` has no incumbent arm at all. Judging the terra arm would
  create *new* verdicts, not recover trusted ones — and the only qualified judge
  for that job is the anthropic family (cash, R1's blocker).
- **The real cheap extension was per-axis, not per-unit — R2 spent it.** The
  archived verdicts carry **seven axes**; `overall` was the only one backtested
  before this workstream, and the other six are now done (§5.10, 5,760 calls,
  $0 cash). That was a ~7× increase in scored observations on ground truth
  **already paid for**, at the cost of new judge calls on credits. It did
  **not** increase the number of independent conversations, and the paper says
  so (§5.10, `corpus-2304`'s own lesson: *"diversity claims are distinct-count
  claims … never read off len()"*).
- `evals/archives/visiongate-confirm/` holds 1,008 judged assertions, but on a
  **different task** (vision fabrication, not preference) with a single judge and
  no counterbalancing. It is not n-extension for this paper.

---

## §12 Immediate next actions for the coordinator

**Status of the five upstream corrections this workstream requested.** Three are
**LOGGED** (`context/measurements.md` `grok43-favoritism-retracted`, 2026-08-15):
the favoritism retraction with its `supersedes` relationship to `grok43-judge`;
the `charm-grok` 56.3% slot-A misattribution; and the `cohere-judge`
"every disjoint family" overstatement. `SWAP-TEST-PREREG.md` Amendment 2 was
re-read and amended to rest on the structural justification rather than the
retracted measured instance. Two remain **UNLOGGED** and are still worth an
entry:

1. **The chance-baseline decomposition** — 30.5% uniform-random and 21.9%
   pure-slot-A under the both-orders-agree rule, derived from the archived
   verdict distribution rather than assumed. It is what makes four of the five
   failures interpretable, and §5.3 now generalises it to
   *q*² + (1−*q*)² for arbitrary slot propensity. Belongs in
   `measurements.md`.
2. **The per-axis reserve — now spent, still unlogged upstream.** R2 (§5.10)
   backtested the six axes that were not `overall`: 5,760 calls, partial
   concentration found (`brevity` a genuine outlier; `humour` statistically
   indistinguishable from `specificity`/`personhood`). This belongs in
   `context/measurements.md` as its own entry (n, method, date, per the
   CLAUDE.md logging rule) — not yet written there; this draft is the only
   place the result currently lives.

**Owner decisions still blocking submission** (each is also a line in §13):

3. **Author list and affiliation.** The paper cannot be posted without them and
   this workstream will not invent them.
4. **Licensing sign-off**: Apache-2.0 on code, **CC BY 4.0 on data**. The
   recommendation and its rationale are in §9.3; the decision is the owner's.
5. **Approve or decline R1's ~$5** (§11) — it closes G5 and gives the paper a
   test–retest bound on its own ground truth.
6. **Decide R3, the human annotation** — the difference between a workshop
   paper and a Findings paper, and between an ethics statement that is honest
   about a gap and one that does not have the gap. Costs owner time, not money.

---

## §13 Submission checklist

*(Apparatus. Nothing here ships in the paper; everything here must be true
before the paper is posted.)*

### 13.1 Venue and category

**arXiv primary category: `cs.CL`** (Computation and Language). This is not a
judgement call — the paper is an evaluation-methodology result about language
models judging natural-language text, and cs.CL is where every work in §2.2's
related-work list sits.

**Cross-list: `cs.LG`** (Machine Learning) as secondary. `cs.AI` is available
as a third but adds little; do not cross-list to `cs.HC` — there are no human
subjects and no interface claim, and listing there invites the reviewer question
the paper cannot yet answer (§7.3).

**Licence on the arXiv posting itself:** recommend **CC BY 4.0**, matching the
data licence, so the preprint and the artifact carry one story. arXiv's
default (`arXiv.org perpetual non-exclusive license`) is acceptable but weaker.
`[OWNER DECISION]`

**Submission order.** Post the arXiv preprint **first**, then submit to a
non-archival workshop that permits preprints. Both venues below do.

### 13.2 Workshop-deadline scan — run 2026-08-18 (live web)

| venue | edition / colocation | dates | fit | verdict |
|---|---|---|---|---|
| **JUDGe 2026 — "Can We Trust the Judge?"** (`judge2026.github.io`) | Full-day workshop, **NeurIPS 2026, Atlanta** | CFP opened **2026-08-01**; **submission deadline 2026-08-29, 11:59 PM AoE**; notification **2026-09-29**; camera-ready **2026-10-15** | **Bullseye.** Its stated topics include construct validity in LLM evaluators, calibration, human–model alignment, **positional bias**, benchmark design, production case studies and **cross-lingual reliability** — this paper is four of those at once. **Non-archival**, papers posted on the workshop site with an opt-out, so an arXiv preprint is compatible. Full papers **6 pages + references**; short **4 pages + refs**; junior spotlight 2 pages. | **PRIMARY TARGET. Eleven days out.** A 6-page full paper is achievable from the current draft: §4 Method compresses hard, §5 keeps F1/F2/F3 and the two headline tables, and §6/§7 are already written. **This is the deadline the schedule should be built around.** |
| **CALCS** (Computational Approaches to Linguistic Code-Switching) | 7th edition was at **NAACL 2025**; series cadence 2020, 2021, 2023, 2025 | **No 8th edition announced as of 2026-08-18.** ACL Anthology's most recent CALCS proceedings is 2025. Neither EMNLP 2026 (Budapest, Oct 24–29) nor AACL 2026 (Hengqin/Zhuhai, Nov 6–10) surfaced a CALCS instance in this scan. | Was the best fit under the *old* title. Under the new one it is a **controlled refutation** of a code-switching hypothesis, which is still squarely a CALCS result and arguably a more interesting one for that audience — Yin's language-switching-invariance line predicts an English recovery we do not observe. | **NOT AVAILABLE THIS CYCLE.** The route in is the joint 2027 workshop cycle: **workshop proposals due 2026-09-04**, acceptance **2026-10-02**, first CFP **~2026-10-26**, attached to NAACL 2027 (San Francisco, Jun 1–5, 2027) or EACL 2027 (Athens, Mar 9–14, 2027). Re-scan in October. |
| **NAACL 2027 main / Findings** | San Francisco, **Jun 1–5, 2027** | **Paper deadline 2026-10-12 (23:59:59 UTC-12) / 2026-10-13 UTC** | Reachable *only after* R3 (human annotation) and ideally R2 (per-axis). At n = 96 units against LLM-produced ground truth the reviewer objection is sample size and it is a fair objection. | **CONDITIONAL, and it is a good target date.** Eight weeks after JUDGe, which is enough time to run R3 and fold it in. Do not submit without R3. |
| **EMNLP 2026 / AACL 2026** | Budapest Oct 24–29 / Hengqin Nov 6–10, 2026 | main-track deadlines already passed for this cycle | — | **CLOSED for this cycle.** Workshop slates are assigned; no code-switching or judge-reliability workshop surfaced in this scan. |
| *(checked, not viable)* `llm-as-a-judge.github.io` | a survey/paper-list resource, **not a workshop** | — | — | The §0.3 draft listed this as a venue. It is not one. JUDGe 2026 is the actual workshop and supersedes that line. |

**Recommended plan:** arXiv (cs.CL) → **JUDGe 2026 by 2026-08-29** (non-archival,
so it costs nothing later) → run R3 and R2 → NAACL 2027 Findings by 2026-10-12
→ re-scan for CALCS 2027 in October.

*(Scan method: live web search and fetch, 2026-08-18. Deadlines move. **Re-verify
every date on the venue's own site before relying on it**, and re-run the
novelty survey at the same time — §10 G7.)*

### 13.3 Blocking on the owner — must be resolved before posting

| # | item | why it blocks | state |
|---|---|---|---|
| B1 | **Author names and affiliation** | Raghav Sharma, Gaurav Sharma, Aryan Tiwari — Vyakti.ai (owner-provided 2026-08-18). | **RESOLVED** |
| B2 | **Human-annotation decision (R3)** | Not a hard blocker for a *workshop* posting, but it is a hard blocker for any archival venue and it is the ethics gap named in §7.3. Owner must decide: run it before JUDGe (tight), before NAACL 2027 (comfortable), or declare the paper workshop-only. | **PENDING OWNER** |
| B3 | **Licence sign-off** — Apache-2.0 (code) + **CC BY 4.0** (data) + the arXiv posting licence | Owner approved 2026-08-18 ("okay whatever u choose in license") — Apache-2.0 code, CC BY 4.0 data per §9.3's recommendation. | **RESOLVED** |
| B4 | **R1's ~$5 cash** | Owner authorized 2026-08-18; the key limit was raised and the run executed the same day at ≈$3.93. Result: §5.11, the ground truth's 77.1% test–retest ceiling. | **RESOLVED — RUN, §5.11** |
| B5 | **R1b's ≈$1 cash** — re-run `claude-opus-5` with a reasoning-sized token cap | Not a blocker for JUDGe. It is the cheapest remaining upgrade in the whole programme: it would give the paper its first demonstrated passing judge (G5b) and give the swap-test battery the qualified judge it has been blocked on since 2026-08-15. | **PENDING OWNER** |
| B6 | **D3 sign-off** — the release bundle retains Indian city and landmark references from the scripted battery (`Silk Board` 52, `silk board` 35, `Bangalore` 50, `Bandra` 2 occurrences, counted by the gate run) | §13.4 D3 requires the owner to confirm these are character detail rather than anything identifying. They are authored fiction and identify no person; stripping them would damage the code-switched content that is the released asset. This workstream retained them and recorded the decision rather than asserting the confirmation. **One yes/no from the owner clears it.** | **PENDING OWNER — the only open de-identification item** |

### 13.4 De-identification checklist — run against the release bundle

**Run this, do not assert it.** Every line is a command with a required result,
and the whole thing must be re-run against the *built bundle*, not the source
tree, because the bundle is what gets published.

**RUN 2026-08-18 against the built bundle. 22 gates, all pass.** The bundle is
`release/vyakti-judge-qual/`, assembled by `docs/paper/build-release-bundle.mjs`;
the gates are `docs/paper/verify-release-bundle.mjs`, which exits non-zero on any
hit and writes its output into the bundle as `de-identification-report.txt`.
Rebuilding the bundle deletes that report on purpose — a stale gate report is
worse than none.

| # | check | required result | state |
|---|---|---|---|
| D1a/D1b | First 200 characters of `personaText` **and** `personaVoice` | zero hits | **PASS** |
| D1c | **Five persona spot-signatures**, chosen by reading the persona itself — one from its opening doctrine and four from widely separated regions (≈4k, ≈12k, ≈25k, ≈43k characters in), each long and specific enough that a coincidental transcript match is implausible | zero hits | **PASS ×5** |
| D2a | The scripted fictional interlocutor's given name, any case | zero hits outside `CITATION.cff` — pseudonymised to `USER` | **PASS** |
| D2b | The companion persona's name, any case | zero hits — pseudonymised to `HER` | **PASS** |
| D2c | The surname that also appears in the author list | zero hits outside `CITATION.cff` — pseudonymised to `[NAME]` | **PASS** |
| D3 | Real place references that could identify the owner | character detail, not PII — **recorded for owner confirmation, not auto-failed** | **RECORDED: `Silk Board` 52, `silk board` 35, `Bangalore` 50, `Bandra` 2. Retained deliberately; flagged for owner sign-off.** |
| D4a–e | API-key-shaped strings; cloud endpoint hostnames; Azure subscription/resource-group ids; the gitignored secrets module; env vars carrying values rather than names | zero hits | **PASS ×5 — and D4b/D5b CAUGHT A REAL LEAK on the first build, see below** |
| D5a–c | Production log/DB references; device and installation identifiers (UUIDs, tokens); email addresses and phone numbers | zero hits | **PASS ×3** |
| D6 | The R4 artifacts (translations, judge rows, summary) covered by D1–D5 **and** stripped of `usage` and the redundant `sourceText` | zero hits | **PASS — 3 files checked** |
| D7 | Datasheet states, in its own voice and in its **first** section, that the ground truth is LLM-produced, not human-annotated, and that agreement is not accuracy | present | **PASS** |
| INV | No file outside the declared bundle shape | zero hits | **PASS** |

**The gates earned their keep on the first build, and this is worth recording
because it is the same lesson as §6.5.** D4b and D5b failed: ten R2 judge rows
carried a raw provider error body inside `harnessMiss`, and that body contained
the tenant's **full Azure endpoint hostname — which embeds the owner's own
name** — plus request UUIDs. Nobody had put them there; they arrived as the
verbatim text of a content-filter rejection, three layers away from anything a
person would have thought to check. Two more gates failed for a self-inflicted
reason: the pseudonymisation *note* the builder wrote into each transcripts file
spelled out the very names it was substituting. All four were fixed — miss
strings are now redacted to kind, HTTP status and a coarse reason class, which
is all the guards use — and the gates re-run clean.

**Two scoping decisions in the gates, stated so they are not silent
exemptions.** `CITATION.cff` is exempt from the person-name gates, because a
citation file is supposed to name its authors; the exemption is one named file,
not a pattern. And D3 is **advisory**: it records place references rather than
failing on them, because they are authored character detail in a fictional
script that identifies no person, and stripping them would damage the
code-switched linguistic content that is the released asset. §13.4 as originally
written required owner confirmation for D3 and that is still outstanding — it is
the one open item in this table.

### 13.5 Pre-post correctness sweep

| # | item | state |
|---|---|---|
| P1 | Extract pre-registration **commit hashes and timestamps** for `docs/SPEC.md` §10-Q5 and `SWAP-TEST-PREREG.md` Amendment 2, and cite them (§10 G6) | **DONE 2026-08-18 — see the chain below** |
| P2 | Re-run the eight-work adversarial novelty survey; §0.2's claims are dated 2026-08-18 (§10 G7) | **DONE (second pass, 2026-08-18) — verdict below; run once more on submission day** |
| P3 | Resolve every `[VERIFY]` marker in §2.2 (author lists, arXiv ids for JudgeBench, Zheng et al., LinCE/GLUECoS) against the published record | **NOT DONE** |
| P4 | Confirm the string *"fails on code-switched affective register"* appears nowhere as a claim (§1's wording law) | **HOLDS in this draft — re-check after every edit** |
| P5 | Rebuild all three figures and confirm byte-identical output (`fig-f1`, `fig-f2`, `fig-f3`) | **VERIFIED 2026-08-18 — reruns reproduce byte-for-byte** |
| P6 | Confirm every number in the abstract and §5 traces to `derive-tables.mjs`, `clustered-cis.mjs`, `analysis/r4/summary.json`, `analysis/r2/*.json`, or a `measurements.md` node id | **HOLDS.** The only non-measured quantity in the paper is the analytic curve *q*²+(1−*q*)², labelled as such wherever it appears. §5.11's numbers are `derive-tables.mjs` T3 + `clustered-cis.mjs`, both re-run 2026-08-18 against the post-[R1] `judges.json`. The one hand-computed figure in the paper is [R1]'s ≈$3.93, arithmetic from `judges.json.cost_by_run` tokens × `judge_configs` pricing, shown in §5.11 because the harness returned `null` (field-name mismatch, now in the quirk log). |
| P7 | Rebuild **F1** after [R1] and confirm determinism | **DONE 2026-08-18.** F1 now carries the ceiling line and its hatched CI band, and drops opus-4.8 from the "invalid" band into a labelled CEILING row. Three consecutive rebuilds are byte-identical (`md5 850f08b9…`). F2 and F3 rebuild byte-identical to their committed versions and are unaffected. |

### 13.6 Pre-registration chain — extracted, with hashes (P1, §10 G6)

Verifiable with `git log` on this branch. The claim the paper makes is that the
≥80% figure was fixed before any candidate judge was run, and it holds with room
to spare:

| # | commit | timestamp (UTC) | file | what it fixed |
|---|---|---|---|---|
| 1 | `2e82a0f` | 2026-08-13T12:20:22 | `docs/SPEC.md` §10-Q5 | The methodology and the number: a judge panel is *"trusted only after **≥80% agreement with the owner's historical accept/reject verdicts on held-out pairs**"*. **Two days before any candidate judge ran.** |
| 2 | `c18b239` | 2026-08-15T09:37:58 | `context/decisions.md` `d2-on-credits` | Instantiates that bar for judge qualification on this programme's credits. **25 minutes before the first backtest result was committed** (`dd0a04c`, 2026-08-15T10:02:49). |
| 3 | `bfeb979` | 2026-08-15T10:24:29 | `docs/SWAP-TEST-PREREG.md` | The pre-registration proper — swap run 1's design, frozen before confirmatory data. |
| 4 | `a7198a2` | 2026-08-15T10:33:12 | same | Amendment 1 — the context premise, measured and failed. |
| 5 | `a053019` | 2026-08-15T11:28:09 | same | Amendment 2 — the judge is grant-billed, anthropic is out, *"qualification bar unchanged (≥80% vs archived blind verdicts)"*. |
| 6 | `d10e840` | 2026-08-18T09:27:19 | same | Amendment 2a — folds in the favoritism retraction; the disjoint-family preference is re-grounded on structure rather than the retracted measured instance. |

**The honest reading, and the paper states it this way.** The *number* (≥80%)
and its *method* are commit 1, two days ahead of every candidate. The
*application to judge qualification* is commit 2, twenty-five minutes ahead of
the first result. Commits 3–6 restate it without changing its value — Amendment
2's own words are "qualification bar unchanged". No commit anywhere in this
chain moves the bar after a result was known, which is the property that
matters. **What the chain cannot claim, and the paper does not:** that the bar
was validated against an achievable ceiling before it was set. §5.11 shows it
was not, and the paper reports that as a method correction (§6.2).

### 13.7 Novelty re-scan — second pass, 2026-08-18 (P2, §10 G7)

**Verdict: C1, C1b and C2 stand. Nothing published after the first pass scoops
them.** But the second pass is not a clean confirmation, and reporting it as one
would be the exact error this paper is about:

**Two adjacent works the first scan missed** (both published *before* it, so
this is a recall failure in the first survey, not a new arrival):

- **`BabelJudge: Measuring LLM-as-a-Judge Reliability Across Languages and Agent
  Trajectories`, arXiv:2606.22329 (2026-06-21).** English, Hindi, Arabic,
  Swahili; composite bias-penalised reliability 0.714 (Hindi) → 0.550 (Swahili);
  raw accuracy 0.835 → 0.660; Swahili order-consistency collapses to 0.480,
  described as *"near-random under slot-order swaps"* — the same evacuation
  geometry as §5.3, measured on a different axis. **Does not scoop us:**
  monolingual per language (no code-mixing, no romanisation), gold labels
  produced *by construction* through controlled degradation of a reference
  answer rather than by a trusted human-aligned verdict set, one primary judge
  model, no affective/companion register, no qualification bar. It is the
  closest published work on *slot-order collapse in a non-English language* and
  must be cited beside §5.3.
- **`Reliability without Validity: A Systematic, Large-Scale Evaluation of
  LLM-as-a-Judge Models Across Agreement, Consistency, and Bias`, Norman,
  Rivera & Hughes, arXiv:2606.19544 (2026-06-17).** 21 judges, 9 providers,
  ~541,000 judgments, 118 runs, on MT-Bench / JudgeBench / RewardBench.
  Headline: κ deflation of 33–41 pp against exact match, and **production
  judges showing test–retest reliability > 0.95 alongside position bias > 0.10**.
  **Does not scoop us** — English, objective benchmarks, no code-switching, no
  affective register, no pre-registered qualification bar, no backtest against a
  deployed decision record. **But it is now the single most important citation
  in the paper**, because it is the prior a reviewer will raise against §5.11:
  it reports judge test–retest above 0.95, and we measure 0.771 for the model
  that wrote our own ground truth. Those are different quantities — theirs is
  stability of a judge re-scoring the same objective items, ours is a judge
  reproducing its own *preference* verdicts on affective companion dialogue
  seven days later — and the paper must say so explicitly and put the two
  numbers side by side. The contrast is a result, not an embarrassment: their
  title is *"reliability without validity"*, and ours is the case where even
  the reliability is not there.

**Also re-confirmed live in this pass:** JUDGe 2026 (`judge2026.github.io`) is
real, is a NeurIPS 2026 workshop, and its deadline remains **2026-08-29,
11:59 PM AoE**, with all notifications preceding NeurIPS's mandatory
2026-09-29 date.

**Standing instruction: run the survey a third time on submission day.** Two
passes found two misses; the failure mode is recall, not staleness, so the third
pass should query the *mechanisms* (slot-order collapse, test–retest of judges,
qualification bars) rather than the *setting* (Hinglish, code-switching), which
is what the first pass over-weighted.
