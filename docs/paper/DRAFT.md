# DRAFT — Paper B: LLM judges fail on code-switched affective register

**Workstream:** WS-PAPER · **Branch:** `claude/ai-companion-app-rkt1lv` · **This workstream did not commit or push — the coordinator reviews.**
*(Note: a coordinator WIP checkpoint (`308332e`) captured an intermediate copy of
`analysis/derive-tables.mjs`. That copy is correct as far as it goes but predates
the T5 between-judge control that produced §5.5's retraction. The working-tree
version is the one the paper cites.)*
**Mandate:** `context/decisions.md` `relational-wedge` §5 — owner verbatim: *"create really good evals that we could actually publish and a paper that we could actually publish."*
**Owner identity:** Vyakti.ai. **Author list: PLACEHOLDER — the owner decides names.**

---

## STATUS

| section | state |
|---|---|
| Recommendation (which paper leads, why) | **DRAFTED** — §0 |
| Scooped-or-not verdict + citations | **DRAFTED** — §0.2, §6 |
| Title candidates | **DRAFTED** — §1 |
| Abstract | **DRAFTED** — §2 (numbers all traceable) |
| Full section outline | **DRAFTED** — §3 |
| **§4 Method** | **WRITTEN IN FULL** — every parameter from logged config |
| **§5 Results** | **WRITTEN IN FULL** — every number recomputed by `analysis/derive-tables.mjs` |
| §6 Related work | **DRAFTED as an annotated citation list**, not yet prose. Citations verified by live fetch 2026-08-18 except where marked `[VERIFY]` |
| §7 Discussion / §8 Limitations | **OUTLINED with the honest caveats enumerated**, prose pending |
| §9 Artifact release | **DRAFTED** — §9, full release plan |
| Claim → evidence → gap table | **DRAFTED** — §10 |
| Priced list of runs still needed | **DRAFTED** — §11 |
| Figures | **NOT STARTED** — §3 names the three the paper needs |
| Human-annotation validation | **NOT RUN** — the single largest gap, §10 G1, §11 R3 |

**Reproduction law for this file.** Every number below is either (a) a logged
`context/measurements.md` entry, cited by node id, or (b) printed by
`docs/paper/analysis/derive-tables.mjs`, which reads only `evals/dbattery/judges.json`
and `evals/archives/*/pb-judged*.json` and makes no network call. Numbers that
are neither appear only in §10 as gaps. Nothing here is extrapolated.

**No credits or cash were spent producing this document.**

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

**Two claims we can therefore make and defend as first reports:**

- **C1.** *No published work backtests a panel of candidate LLM judges against
  blind, counterbalanced, both-orders-agree preference verdicts on romanised
  Hinglish affective/companion register.* Verified against the eight nearest
  works above.
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

Assumed and endorsed: **arXiv (cs.CL) preprint first**, immediately on completion
of §4–§5 plus the human-annotation control (§11 R3). Then, in order of fit:

1. **CALCS** (Workshop on Computational Approaches to Linguistic Code-Switching,
   ACL-colocated) — the single best fit; code-switching is the paper's causal
   variable and CALCS reviewers are the audience who will believe it. `[VERIFY]`
   next edition's date and colocation.
2. **The LLM-as-a-Judge workshop** (`llm-as-a-judge.github.io`) — second-best
   fit, and the audience that most needs the qualification-protocol result.
3. **EMNLP / ACL Findings, Resource & Evaluation track** — reachable *after* the
   n-extension (§11 R2) and the human control. At n=96 units the paper is a
   strong workshop paper and a borderline Findings paper; the reviewer objection
   will be sample size, and it is a fair objection.
4. **NeurIPS Datasets & Benchmarks** — only if the released suite (§9) is the
   headline contribution rather than the measurement. That is a legitimate
   re-framing and worth the owner's consideration, because the *protocol* (a
   harness that refuses to certify its own run) may outlive the numbers.

**Do not aim at ACL/EMNLP main.** n=96 units against a single LLM-produced
ground truth is not a main-conference sample, and claiming otherwise would fail
this program's own `fab-noise-floor` discipline in public.

---

## §1 Title candidates

1. **"The Judge Cannot Read the Room: LLM Judges Fail on Code-Switched Affective Register"**
2. "Qualify Your Judge: Six Frontier Models Fail an 80% Agreement Bar on Romanised Hinglish Companion Dialogue"
3. "Position Bias Eats the Counterbalance: Why Both-Orders Judging Collapses on Code-Switched Preference Tasks"
4. "Judging Teasing: LLM Evaluators Systematically Prefer the Register Native Speakers Reject"
5. "A Judge Qualification Protocol, and the Six Judges It Rejected"

Recommended: **#1** with #5's framing in the abstract — the failure *and* the
protocol that caught it are both contributions, and the protocol is the reusable one.

---

## §2 Abstract (draft)

> LLM-as-a-judge is now the default instrument for evaluating open-ended
> generation, and the standard defences — randomised presentation order, both-orders
> agreement, cross-family judges — are widely assumed to make it trustworthy enough
> to ship on. We report a qualification study in which those defences do not save
> the instrument. Working from a deployed Hinglish (romanised Hindi-English
> code-switched) AI-companion product, we take two archived model bake-offs whose
> blind, counterbalanced, both-orders verdicts (96 judgments over 48 conversation
> units each, judge `claude-opus-4.8`) had already driven real deployment
> decisions, and we backtest six candidate judges against them under a
> pre-registered ≥80% agreement bar: DeepSeek-V4-Flash, DeepSeek-V4-Pro,
> gpt-5.6-terra, grok-4.3, Mistral-Large-3, and Cohere command-a-plus.
>
> **All six fail.** Pooled unit-level agreement is 28.1%, 30.9%, 54.2%, 34.4% and
> 29.2% respectively, with every 95% confidence interval entirely below the bar;
> the sixth is disqualified for cause, parsing a valid verdict on fewer than half
> of 192 calls despite an only-JSON contract. Scale does not help — the full-size
> DeepSeek agrees no better than the small one (30.9% vs 28.1%).
>
> The mechanism is worse than the scores. Under a both-orders-agree rule, a judge
> that picks the first slot regardless of content converts every counterbalanced
> unit into a tie, so position bias does not merely add noise, it *evacuates* the
> comparison: slot-A pick rates run 62.0%–89.6% against a 56.3%/61.5% rate for the
> trusted judge on the same rows. Four of five scorable judges land within noise of
> a uniform-random baseline (30.5%). On the archive where the trusted verdict is a
> 38–2 landslide, judges that do return decisive verdicts pick the *rejected* arm
> most of the time — 5.0%, 10.0% and 15.0% agreement on decisive units against a
> 25% chance floor — because the rejected arm is the verbose, question-stacking,
> therapised one, and that is what a judge reaching for "supportive" rewards.
> A qualitative inspection finds one judge scoring authentic Hinglish teasing as
> "mocking/dismissive". We also report a negative result on a hypothesis we had
> ourselves logged as confirmed: an apparent 16× same-vendor favoritism does not
> survive a between-judge control, because a family-disjoint judge shows a larger
> effect on the same archive — the panel-wide register preference explains both.
>
> We release the qualification protocol, the harness (including the transport- and
> parse-validity guards that self-invalidate a crippled run), the anonymised
> transcripts, and the ground-truth verdicts. The headline practical finding is a
> negative one worth stating plainly: **any evaluation programme that adopts an
> LLM judge for a code-switched or affective task without backtesting it against
> trusted verdicts is measuring judge taste, not the system under test.**

*(Abstract numbers: all from §5. Word budget will need a cut of ~120 words for
most venues. The retraction sentence should be the LAST to go, not the first —
a paper that refutes one of its own authors' logged claims in the abstract buys
more reviewer trust than any positive result in it.)*

---

## §3 Section outline

| § | title | state |
|---|---|---|
| 1 | Introduction — the judge you did not qualify | outline |
| 2 | Background: LLM-as-judge defences and where they were validated (all monolingual English) | outline, citations in §6 |
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
| 6 | Related work | annotated list, §6 |
| 7 | Discussion: what a qualification protocol has to do | outline, §7 |
| 8 | Limitations and threats to validity | enumerated, §8 |
| 9 | Artifact release | written, §9 |
| 10 | Conclusion | outline |
| A | Appendix: full per-cell tables, rubric text, judge configs, quirk log | derivable from `analysis/derive-tables.mjs --json` |

**Figures the paper needs (none drawn yet):**
- **F1** — The evacuation diagram: for each judge, a stacked bar of its 48 units
  into {agrees with a decisive ground-truth verdict, disagrees decisively,
  returned TIE_FLIP}, with the trusted judge's own bar as the leftmost reference.
  This is the paper's one indispensable figure.
- **F2** — Slot-A pick rate per judge with exact binomial CIs, against the
  trusted judge's 56.3%/61.5% and a 50% line.
- **F3** — Decisive-unit accuracy vs. the 25% chance floor, per judge per
  archive, showing the charm-grok cells falling *below* the floor.

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
They are *not* human verdicts. §8 treats that as the study's principal threat to
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
| *(reference)* anthropic/claude-opus-4.8 | anthropic | OpenRouter | — | — | — | 120 |

*(Source: `evals/dbattery/judges.json.judge_configs`. The two anthropic rows are
reference runs, both **INVALID** — §4.6.)*

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
   403'd. The scored subsets (opus-5 14/14, opus-4.8 8/9) are
   **transport-selected denominators**, are marked `INVALID-RUN (transport)` in
   `judges.json`, and are **not** qualification results
   (`measurements.md` `judge-run-transport-invalid`). We report them in §5 only
   as a labelled non-result, because omitting them would itself be selective.
2. **Runs self-invalidate above a 5% transport-error rate.** Added in response
   to (1).
3. **Parse misses invalidate too.** Added after `command-a-plus` returned
   long prose on the majority of calls despite the only-JSON contract; a judge
   scored on the minority of calls that happened to parse is the same biased
   denominator in a different costume.

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
the exact length of `judges.json.raw_rows`. Five judges produced a complete
scorable set (94–96 units); one produced none (parse); two are transport-invalid
references. All Azure-billed runs cost **$0 cash** (`judges.json.cost.cashCostUsd = 0`);
the invalid OpenRouter reference run cost **~$1.80** and is sunk
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
| *(invalid ref.)* claude-opus-5 | 14 / 14 | *100.0%* | *[78.5, 100]* | **INVALID (transport)** | 64.2% (53) | 139 unclassified † |
| *(invalid ref.)* claude-opus-4.8 | 8 / 9 | *88.9%* | *[56.5, 98.0]* | **INVALID (transport)** | 50.0% (18) | 174 unclassified † |

† The miss/kind classifier was added *after* these runs, in response to them. In
the stored rows opus-4.8's misses carry an `error:` prefix (403 bodies) while
opus-5's carry `unparseable:` (empty bodies from the same 403s), so a naive
classifier reports 174 transport / 0 parse and 0 transport / 139 parse
respectively. Both are the **same** root cause — a $20 key limit — and neither is
a judge property. The paper reports them as unclassified rather than letting a
post-hoc classifier impute a distinction the data cannot carry.

Not one confidence interval touches the bar. These are **clean failures, not
underpowered ones** — the study is adequately powered to reject at 80% even
though it is underpowered for fine distinctions among the failures.

The italicised anthropic rows are reported for completeness and are **not**
results: their denominators were selected by which calls happened to succeed
before a $20 key limit was hit (§4.6). They are directionally promising and
statistically worthless, and the paper says exactly that.

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

Gap **G4** (§8 L4, §10 C19): the 96 pooled units are not 96 independent trials.
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
| *(invalid ref.)* anthropic/claude-opus-5 | 14 | 8 | [78.5%, 100.0%] | [100.0%, 100.0%] | −21.5pp | UNDERPOWERED | *PASS* | **YES** |
| *(invalid ref.)* anthropic/claude-opus-4.8 | 9 | 9 | [56.5%, 98.0%] | [66.7%, 100.0%] | −8.2pp | UNDERPOWERED | UNDERPOWERED | no |

**Verdict-change answer, stated plainly: no substantive verdict changes.**
Every one of the five scorable, valid-run candidate judges — the entire set
the paper's FAIL claim (C1) rests on — stays **FAIL** under an honestly
clustered interval; clustering widens each interval by roughly 1–3
percentage points (it can only ever widen, since it estimates the same point
from fewer effectively-independent clusters) and every widened interval still
sits far below the 80% bar (clustered interval highs run 38.5%–64.6% against
an 80% bar). The two rows that *do* flip are both the **anthropic reference
runs already marked `INVALID (transport)`** in §5.1/§4.6 — their denominators
(14/14 and 8/9) were selected by which calls beat a $20 OpenRouter key limit,
not by the qualification protocol, and were never real qualification results
to begin with. A transport-crippled n of 14 producing a degenerate
all-agree cluster bootstrap (every resample is 100% because every observed
unit already agrees) is exactly the kind of noise those rows already carry a
warning label for — it is not a new finding, and the paper must not cite it
as one.

**What this run buys and does not buy.** It converts §8 L4 from an
acknowledged-but-unaddressed limitation into a closed one: the paper's central
quantitative claim (all five judges FAIL) now has an interval that is honest
about clustering, not merely binomial. It does **not** change the paper's
n — 96 units is still 96 units, clustered into 12 beats, and a reviewer
asking "how many *effectively independent* observations is this?" gets a
franker answer post-R5 than pre-R5 (12, not 96, for the purpose of the
variance estimate) even though the point estimates and the substantive
verdicts are unchanged. `[R5]`

---

## §6 Related work — annotated citation list

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

---

## §7 Discussion — outline

1. **Both-orders agreement is a diagnostic, not a debias.** §5.3's exact
   degenerate prediction is the reusable result. Recommend that any paper
   reporting both-orders-agree rates also report the tie rate and the slot-A
   rate, because the three together identify the evacuation failure and the
   agreement rate alone conceals it.
2. **Qualification must precede use, and the bar must have cost attached.** Our
   bar gated a real spend; that is what kept it honest. Propose the minimal
   qualification report: agreement + Wilson CI vs a stated bar, chance baseline
   for the aggregation rule in use, slot-A rate vs the trusted judge's, tie rate,
   transport misses, parse misses, and a family-conflict cell where one exists.
3. **The failure is a taste failure, not a capability failure.** All six judges
   are competent conversational models. What they lack is the register model
   under which teasing is warmth and a stacked question is neediness. §5.4's
   direction-of-error result and the "mocking/dismissive" reading are the same
   fact seen twice.
4. **Why this bites hardest exactly where automatic evaluation is most tempting.**
   Code-switched and affective tasks are where human annotators are scarcest and
   the pull toward LLM judging is strongest — the same observation
   arXiv:2607.02235 makes for low-resource languages.
5. **The protocol that refuses.** The harness self-invalidates its own runs
   (§4.6). A measurement protocol that cannot decline to issue a verdict is not a
   protocol. Connect to the programme's broader discipline (`fab-noise-floor`:
   *"any fabrication claim from this harness at n<300 is noise"*).

## §8 Limitations and threats to validity — enumerated

Each of these must appear in the paper in the paper's own voice. None is
optional; several are fatal to over-claiming and are the reason §0.3 aims at a
workshop first.

- **L1 — The ground truth is an LLM.** `claude-opus-4.8`, not human raters. Every
  agreement figure is *agreement with a specific frontier model's verdict*. The
  mitigations that exist (blind, counterbalanced, pre-dating this study, acted
  upon commercially, CI-verified) reduce but do not remove this. **This is the
  study's single largest threat; §11 R3 prices the fix.**
- **L2 — n = 96 units** (48 per archive), 192 rows per judge. Adequate to reject
  an 80% bar; inadequate for fine discrimination among failures, and inadequate
  for the below-chance claim after multiplicity correction (§5.4).
- **L3 — Two archives, one product, one persona, one language pair.** Whether
  this generalises beyond romanised Hinglish companion register is untested. The
  Indi-RomCoM and multilingual-judge results make it plausible; plausible is not
  measured.
- **L4 — Clustering.** Units share 12 beat scripts and 2 replicates, so units are
  not fully independent; a mixed-effects treatment clustering on beat is the
  correct analysis and has **not** been run (§11 R5). Reported CIs are binomial
  and therefore anti-conservative.
- **L5 — Overall axis only.** Six further archived axes are unexploited (§11 R2).
  The per-axis result would let us distinguish register-specific failure from
  general failure — the mechanism claim in §5.4 is currently inferential.
- **L6 — No causal manipulation of code-switching.** We argue the failure is
  register-driven from direction-of-error plus a qualitative reading. The
  decisive experiment — re-judging the same units machine-translated to
  monolingual English — has **not** been run (§11 R4). Until it is, "fail on
  code-switched affective register" is a *setting*, not an *established cause*,
  and the title must be defensible on that basis.
- **L7 — Judge decoding parameters were not swept.** All judges ran at
  temperature 1 (terra's API pins it, and the others were matched to it for
  comparability). Lower temperature might reduce position bias. Untested.
- **L8 — Deployment drift.** The programme has measured a Foundry deployment's
  behaviour shifting materially in four days (`measurements.md`
  `vision-drift-4day`). Judge results are **date-stamped evidence**: all runs
  2026-08-15.
- **L9 — One named candidate family was never tested.** `Llama-4-Maverick` was
  pre-registered as a qualification candidate (`judge-grant-only`,
  `SWAP-TEST-PREREG.md` Amendment 2 option 1) and never deployed or run. The
  paper's "five families tried" must not become "every family tried" (§10 GAP-C6).
- **L11 — The favoritism null is a weak null.** §5.5 reports no evidence of
  same-vendor favoritism, but the design could not detect a moderate effect if
  one existed: two conflict cells total, and the two archives have grossly
  mismatched ground-truth base rates (5.0% vs 51.4% candidate-win rate), which
  makes the elevation metric incomparable across them in an uncontrolled way.
  The paper must present this as *"our data do not support the claim we
  previously logged"*, never as *"vendor favoritism does not occur"*.
- **L10 — Self-application.** This paper's own claims are subject to its own
  rules: `fab-noise-floor` (13.6 pp judged-rate spread on byte-identical input at
  n<300) means we must not report any judged *rate difference* below that
  magnitude as a finding, and we do not. The one place the paper approaches its
  own floor is §5.7's 30.9% vs 28.1% — which we report as *"no difference
  detected"*, never as equivalence.

---

## §9 Artifact release — the publishable eval suite

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
| C2 | Every 95% CI lies entirely below the bar | `derive-tables.mjs` T3 (Wilson) | **SUPPORTED** |
| C3 | Four of five scorable judges are indistinguishable from uniform-random | `derive-tables.mjs` T3 (exact binomial vs 30.5%) | **SUPPORTED** (baseline derived from the archived verdict distribution, not assumed) |
| C4 | Position bias evacuates the counterbalance; two judges land exactly on the pure-slot-A prediction | `derive-tables.mjs` T1 (16.7% prediction) + T2 (16.7% observed, twice) | **SUPPORTED** |
| C5 | Three judges fall below the 25% chance floor on the landslide archive | `derive-tables.mjs` T2 decisive accuracy | **SUPPORTED as a pattern**; the single-judge significance (Mistral p=0.022) does **not** survive Bonferroni over 10 tests — stated in §5.4 |
| C6 | The judges' error has a *direction*: they prefer the rejected arm | `derive-tables.mjs` T2 `decisiveFreshPicks` | **SUPPORTED** |
| C7 | The rejected arm is longer, more interrogative, more assistant-shaped | `measurements.md` `charm-grok` (36.1 w/t, 1.74 q/t, 63% question-final); `personality-battery.md` | **SUPPORTED** |
| C8 | **Therefore** the failure is caused by code-switched *affective register* | direction-of-error (C6+C7) + one qualitative reading (`judge-backtest`: terra scores teasing as "mocking") | **GAP-G2 — INFERENTIAL, NOT CAUSAL.** Needs the English-translation control (§11 R4) and/or the per-axis breakdown (§11 R2). Until then the title claims a *setting*, and §8 L6 must say so. |
| C9 | grok-4.3 shows ~16× same-vendor favoritism | `judges.json` `familyConflict` (81.0% vs 5.0%) + within-judge control (+12.9 pp on the conflict-free archive) | **RETRACTED — GAP-C9.** The *between-judge* control refutes it: family-disjoint `Mistral-Large-3` shows a **larger** difference-in-differences (+71.7 pp vs grok's +63.1 pp) on the same archive, and the other conflicted cell (terra) is negative (−9.7 pp). `derive-tables.mjs` T5. The 81%-vs-5% number is real as an agreement failure; the causal attribution to vendor family is not supported. **Correct `measurements.md` `grok43-judge` upstream.** |
| C10 | terra shows same-vendor favoritism on charm-luna | `derive-tables.mjs` T4 (89.5% vs 51.4%) | **NOT SUPPORTED.** Subsumed by C9's retraction; terra's DiD is negative. |
| C10b | **No** same-vendor favoritism is detectable in this data | `derive-tables.mjs` T5 | **SUPPORTED as a null**, and the paper must say why the design could not detect one even if present: the two archives have grossly mismatched ground-truth base rates (5.0% vs 51.4%) |
| C11 | Scale does not fix the DeepSeek pathology | `deepseek-pro-judge`; T3 | **SUPPORTED** as "no difference detected"; **must not** be stated as equivalence (`fab-noise-floor`) |
| C12 | Cohere is protocol-unfit (158/192 parse misses) | `cohere-judge`; `judges.json.per_archive` | **SUPPORTED** |
| C13 | The bar was pre-registered before any candidate ran | `SPEC.md` §10-Q5; `decisions.md` `d2-on-credits` (2026-08-15); `SWAP-TEST-PREREG.md` Amendment 2 | **SUPPORTED**; the paper should cite the **commit timestamps**, which have not yet been extracted — **GAP-G6** |
| C14 | The anthropic reference runs are invalid, not results | `judge-run-transport-invalid`; harness self-invalidation | **SUPPORTED** |
| C15 | No published work does this backtest on romanised Hinglish affective register | §0.2 survey, 8 nearest works fetched 2026-08-18 | **SUPPORTED as of 2026-08-18**; re-run the survey immediately before posting — **GAP-G7** |
| C16 | "Every Azure-direct family disjoint from both arms has been tried" | `cohere-judge` branch conclusion | **GAP-C6 — OVERSTATED.** `Llama-4-Maverick` was pre-registered and never deployed or run. Either run it (§11 R6, credits) or reword to "five families". |
| C17 | The trusted judge's slot-A rate is 61% | `measurements.md` `charm-grok` | **GAP-C7 — MISATTRIBUTED.** Recomputes to 56.3% for `charm-grok`; 61.5% is `charm-luna`. Correct in the paper and log the correction upstream. |
| C18 | Judge agreement generalises beyond this persona/product | — | **GAP-G3 — NO EVIDENCE.** Must be framed as an open question, never claimed. |
| C19 | Units are independent | — | **GAP-G4 — FALSE AS STATED.** Units cluster on 12 beats × 2 replicates. Binomial CIs are anti-conservative. Needs the mixed-effects re-analysis (§11 R5, $0). |
| C20 | A judge that clears the bar exists | opus-5 14/14 and opus-4.8 8/9 — **both INVALID** | **GAP-G5 — UNPROVEN.** The paper currently cannot show any judge passing, which weakens "the bar is achievable". §11 R1 is the fix and is the highest-value paid run. |
| C21 | The ground truth reflects native-speaker judgement | — | **GAP-G1 — THE CENTRAL GAP.** No human annotation exists. §11 R3. |
| C22 | Per-axis: judges fail worse on register/humour than on brevity | — | **GAP-G8 — NOT MEASURED.** Would be the strongest mechanism evidence in the paper. §11 R2. |
| C23 | Judge results are stable over time | `vision-drift-4day` shows a Foundry deployment drifting in 4 days | **GAP-G9 — UNMEASURED FOR JUDGES.** Date-stamp everything; a re-run at +30 days is §11 R7. |

### Gap summary, by severity

| gap | what it blocks | cheapest fix |
|---|---|---|
| **G1** ground truth is an LLM, not humans | the paper's headline interpretation | R3 — human annotation of ≥48 units, 2+ raters, κ reported |
| **G2** causality of "code-switched register" | the title | R4 — English-translation control (credits, ~576 calls) |
| **G5** no judge has been shown to pass | "the bar is achievable" | R1 — re-run opus-5/4.8 with a working key (~$5) |
| **G8** per-axis mechanism | §5.4's mechanism claim | R2 — 7-axis re-judge (credits, ~960 calls) |
| **G4** clustering | CI validity | R5 — re-analysis, $0 |
| **C9** a logged finding is refuted by its own between-judge control | `measurements.md` `grok43-judge`, **and `SWAP-TEST-PREREG.md`'s one-judge-family deviation, which rests on it** | $0 — the refutation is already computed (T5); what it needs is an upstream `supersedes` entry and a re-read of the prereg's reasoning |
| **C6/G6/G7/C7** overstatement, timestamps, survey freshness, misattribution | correctness | free edits + R6 |

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
| **R5** | Mixed-effects re-analysis clustering on beat (12 clusters) | fixes G4; correct CIs | **$0** (compute only) | nothing — do this next |
| **R2** | **7-axis re-judge**: same 96 units × 2 orders × 5 scorable judges with the full archived axis set | fixes G8; the mechanism claim; separates register/humour failure from brevity failure | credits; **960 calls**, ≈1.2 M prompt tokens (benchmark: 192 calls ≈ 239 k prompt tokens, `judges.json.cost_by_run`); **$0 cash** | judge deployments (all live) |
| **R4** | **English-translation control**: same 48 units machine-translated to monolingual English preserving content, re-judged by 3 judges | fixes G2 — turns the paper from correlational to causal. **Highest scientific value per credit in this list.** | credits; translation ≈ 96 calls + **576 judging calls**; **$0 cash** | a translation pass that must itself be validated (do not let the translator normalise register) |
| **R3** | **Human annotation**: ≥48 units (ideally all 96), blind, both orders, ≥2 native Hinglish raters, report Cohen's/Krippendorff's κ against the trusted judge | fixes G1 — the central gap; without it the paper is a workshop paper permanently | **$0 if the owner + one native-speaker friend annotate** (recommended); ~$96 cash at $0.50/unit × 96 × 2 raters if outsourced | owner time; a blind annotation UI (a static HTML page, half a day) |
| **R1** | **Re-run the two anthropic reference judges** with a raised OpenRouter key limit | fixes G5 — demonstrates the bar is achievable; opus-4.8's run is a **test-retest** measure that bounds the ground truth's own noise (the single most valuable control in the paper) | **~$5 cash.** Measured: 210 calls = 353 k prompt + 22 k completion tokens; at the fetched 2026-08-15 rate ($5/M in, $25/M out) that is ≈$2.31, so a full 384-call two-model run is ≈$4.2. **Re-fetch the rate before running.** | **OWNER DECISION** — `judge-grant-only` says grant-only, no further cash. ~$5 against a ~$450 cap. Recommend approving. |
| **R6** | `Llama-4-Maverick` backtest | fixes C16 — makes "every disjoint family" honest, or lets us reword instead | credits; **192 calls**; **$0 cash** | one owner deploy click in Foundry |
| **R7** | Judge-drift re-run at +30 days (identical protocol, 2 judges) | fixes G9; `vision-drift-4day` makes this a live risk | credits; **384 calls**; **$0 cash** | calendar |
| **R8** | *(Paper A only)* incumbent arm to band scale | Paper A's D1 verdict | ~30 days on the free pool, or the owner's pending Google credits | not Paper B's blocker |

**Total for a publishable Paper B: $0 credits-cash + ~$5 cash (R1, optional) +
owner annotation time (R3).** Every other item rides the grant at a few hundred
to a thousand calls — a rounding error against the runs already spent (1,536
judgment rows, 3,201 calls in the vision battery alone).

**Recommended order:** R5 (free, today) → R2 (credits) → R4 (credits, the causal
control) → R3 (owner time, the credibility control) → R1 (owner's ~$5 call) →
R6/R7 as tidy-up.

### An honest answer to "can we extend n cheaply from the archives?"

**Partly, and not in the way that would help most.** Checked directly:

- **More ground-truth verdicts do not exist.** The archives hold exactly 96 + 96
  blind verdicts. `charm-luna` contains a **third generated arm** (`gpt-5.6-terra`)
  that *"ran but was never judged"* (`fixtures.json.gaps`), and
  `realtime-azure` has no incumbent arm at all. Judging the terra arm would
  create *new* verdicts, not recover trusted ones — and the only qualified judge
  for that job is the anthropic family (cash, R1's blocker).
- **The real cheap extension is per-axis, not per-unit** (R2): the archived
  verdicts carry **seven axes**, and only `overall` has been backtested. That is
  a ~7× increase in scored observations on ground truth **already paid for**, at
  the cost of new judge calls on credits. It does *not* increase the number of
  independent conversations, and the paper must say so (`corpus-2304`'s own
  lesson: *"diversity claims are distinct-count claims … never read off len()"*).
- `evals/archives/visiongate-confirm/` holds 1,008 judged assertions, but on a
  **different task** (vision fabrication, not preference) with a single judge and
  no counterbalancing. It is not n-extension for this paper.

---

## §12 Immediate next actions for the coordinator

1. **Log five corrections upstream** (they are findings, not edits):
   - **`grok43-judge`'s 16× same-vendor favoritism does not survive a
     between-judge control** and should be superseded, not deleted — a
     family-disjoint judge (`Mistral-Large-3`) shows a larger
     difference-in-differences (+71.7 pp vs +63.1 pp) on the same archive, and
     the second conflicted cell (terra) is negative (−9.7 pp). This is the
     highest-value correction in the list: the claim is currently cited in
     `SWAP-TEST-PREREG.md` as the *justification for the one-judge-family
     deviation*, so the prereg's reasoning needs re-examination too. **§5.5.**
   - `measurements.md` `charm-grok`'s "61% slot-A" is `charm-luna`'s number;
     `charm-grok` recomputes to **56.3%**, matching the archive's own report.
   - `cohere-judge`'s "every Azure-direct disjoint family has been tried" omits
     `Llama-4-Maverick`, which was pre-registered and never deployed.
   - The chance-baseline decomposition (**30.5% uniform-random / 21.9%
     pure-slot-A** under the both-orders rule) is new, is what makes four of the
     five failures interpretable, and belongs in `measurements.md`.
   - The judged-per-axis reserve: the archives carry **seven** axes and only
     `overall` has ever been backtested — worth a line so the next workstream
     does not re-derive it.
2. **Decide Paper B's author list and the CC BY 4.0 / Apache-2.0 licensing** (§9.3).
3. **Approve or decline R1's ~$5** (§11).
4. **Schedule R3** — the human annotation is the difference between a workshop
   paper and a Findings paper, and it costs owner time rather than money.
