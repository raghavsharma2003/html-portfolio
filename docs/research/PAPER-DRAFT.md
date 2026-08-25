# Structural Findings from Building a Persistent AI Companion: Eight Things a Measure-First Discipline Found That Reasoning Alone Would Have Missed

**Status:** working draft (task #60). Distinct from `docs/paper/DRAFT.md` (the
LLM-judge-qualification submission targeting JUDGe 2026 / NAACL Findings,
which specializes one of this draft's findings — §7 below — into its own
paper). This draft is the broader methods paper: what a year of forcing every
claim about a production conversational agent through measurement, rather
than argument, actually found.

Every number below carries a `context/measurements.md` (or `rejected.md` /
`decisions.md`) entry id in backticks. **No number in this draft is invented
or paraphrased from memory** — each was re-read from the cited entry while
writing this section. Where an id says "n/a for n", that is the source
entry's own honesty about what it measured (a census or a source audit, not
a sample), reproduced here rather than smoothed over.

---

## Abstract

We report eight structural findings from building and operating Meera, a
production Hinglish-speaking AI companion (text, voice, and screen-share
lanes) over roughly two months of continuous, adversarially-measured
development. The findings share a shape: each began as a plausible design
instinct, was reasoned about, shipped, and only *then* falsified or
sharpened by a targeted measurement. Four are laws about what makes a large
language model's persona break character (recitation of sentence-shaped
prompt text, positional decay of instructions, the invisibility of a
correctly-measured-but-under-threshold change, and the collapse of episodic
memory into present-tense snapshots). Two are laws about what makes an agent
safe or coherent across a multi-lane product surface (structural, output-side
gates outperforming prompt-side instructions at holding an honesty
invariant; and a cross-lane parity gate as the only mechanism that reliably
finds a context block that renders on one interface and silently disappears
on another). One is a methodological finding about the discipline itself:
six frontier-adjacent LLMs, backtested as judges against a trusted human-
verified ground truth, all failed a pre-registered 80% agreement bar — and
the trusted ground truth agreed with *itself*, on retest, only 77.1% of the
time, which reframes the failure from "these judges are bad" to "this task
may not be judgeable at the precision anyone has been assuming." The eighth
finding is about the infrastructure that is supposed to keep all of the
above honest: a scheduled consolidation job that appeared to run nightly for
weeks, in fact never wrote its output, because two independent failures
(a default-true dry-run flag, and a sweep endpoint that ran one step of a
six-step chain) each hid the other. We argue that none of these eight would
have been found by code review, and that the operative discipline — measure
before shipping, keep what was tried and failed as a first-class artifact,
and pre-register a rubric before generating the data that will be judged
against it — is itself the paper's most exportable contribution.

---

## 1. Method: measure-not-reason as a methodology, not a slogan

The project's internal instruction (`CLAUDE.md`) states plainly that the
codebase's most expensive knowledge is *what was already tried and did not
work*, and mandates a `context/rejected.md` file specifically for that
class of finding, read before any other document. This is not incidental
process color; it is the independent variable this paper is actually about.
Three properties of the discipline recur across every finding below and are
stated once here rather than re-derived eight times:

**(a) A claim about the system gets a number, or it does not get made.**
`context/measurements.md` requires n, method, and date on every entry
("A figure without those cannot be compared [to a future one], which is
the only thing figures are for" — file header). This is enforced
retroactively as well as prospectively: `grok43-favoritism-retracted`
(2026-08-15) is a same-project retraction of a previously-logged 16×
same-vendor judge favoritism claim, once a between-judge control the
original measurement lacked was run. The retraction is logged with the
same rigor as the original claim, including *why* the original reading was
reasonable and specifically what evidence overturned it — a discipline
that only works if being wrong in the log is not penalized more than being
wrong silently in the code.

**(b) A design instinct is worth exactly as much as its worst measured
consequence, not its best plausible one.** Every finding in §§2–5 below is
a case where an idea that reads as obviously correct on paper (give her
example lines so she has a voice; put a safety rule wherever it's easiest
to write; make a UI change proportionally more visible; store an activity's
live state so the app always has a snapshot to answer from) was shipped
first as reasoned engineering and only overturned by a targeted, adversarial
measurement — never by someone re-reading the code and reasoning harder.

**(c) A rubric, once it will be used to judge generated data, is frozen
before the data exists, and the freeze is mechanically enforced.**
`evals/feltmem/prereg.mjs` computes a hash over every judging rubric and
the fixtures it will run against, writes it to a committed
`prereg.manifest.json`, and `evals/feltmem/run.mjs` **refuses to run against
real data (`--live`) unless the recomputed hash matches the committed one**
— editing a rubric after seeing early results silently invalidates the run
rather than silently changing the bar. §7 below treats this pre-registration
discipline as a finding in its own right, because the project's swap-test
protocol (`docs/SWAP-TEST-PREREG.md`) used the identical mechanism (a
commit-timestamped document, with post-hoc changes required to declare
themselves as **amendments**) and that mechanism is what caught its own
central premise failing before a single dollar was spent (§7.2).

The rest of this paper is eight findings, each following the same shape:
the design instinct as it was reasoned, the measurement that tested it, the
number, and — where the project drew one — the generalizable rule.

---

## 2. Finding: the recited-prompt law — sentence-shaped text in a persona becomes a phrase bank

**The instinct.** If a model's persona document contains good example lines
in her voice, or a table of her tastes and opinions written out in clear
prose, the model will use them as anchors for tone and never simply repeat
them — a well-written example is guidance, not a script.

**What was measured, twice, independently.**

1. Her persona once contained example quotes in her own voice. Scored
   against her actual replies, she recited them **verbatim on 4 of 5 turns**.
   Removing the quotes took recitation to **0** (`context/rejected.md`
   `recited-prompt`).
2. Independently, her stored taste table was first authored as polished
   English sentences. She read entries back **verbatim, twice, eight turns
   apart**, and began lifting whole English clauses into otherwise-Hinglish
   replies — a register defect measured at **13 of 96 turns** with the
   sentence-form table. Rewriting every entry as a telegraphic note (a
   shape, not a line she could say) cut verbatim echo to **1/32** and the
   register defect to **0/32**, with the table's *usefulness* — measured
   separately as answer-consistency to the same question asked 6–8 turns
   apart — unchanged (`context/measurements.md` `taste-consistency`: 480
   live turns, real persona and prompt assembly, consistency rose
   **27% → 63%** across the same rewrite, 2026-08-11).

**The boundary condition, measured rather than assumed.** The law is about
*sentence-shaped* text specifically, not about structured annotation in
general: a controlled test of short, non-sentence affect tags
(`affect: warm-teasing`-style) rendered mid-tail, blind and counterbalanced
against a byte-identical control, found **0/42 tagged vs. 0/42 control**
hard leaks of tag vocabulary at n=84 (rule-of-three 95% upper bound
≤7.1%/turn) — `context/measurements.md` `affect-recitation`, 2026-08-13.
Short structured tokens sit below detectable recitation at this n; full
prose sentences do not.

**The rule, as stated in the project log:** *"Write shapes, never lines she
could say."* This generalizes past this one persona: any prompt that
contains fluent, complete, sentence-shaped exemplar text — few-shot
examples, tone samples, "here's how she'd say it" snippets — is not
guidance to a generative model, it is a phrase bank with a retrieval
probability the author never measured. `[TODO-cite: prior work on few-shot
example leakage / verbatim copying from in-context exemplars in LLMs]`

---

## 3. Finding: prompt-position — an identical rule fires 0/8 mid-brief, 8/8 appended last

**The instinct.** A persona document is one coherent brief; the model reads
all of it, so a safety or behavioral rule's *position* within an otherwise
well-written document should not materially change whether the model
follows it — clarity and correctness of the rule's wording are what matter.

**What was measured.** A rule buried mid-brief fired **0 times in 8**; the
identical rule appended **last** in the document fired **8 times in 8**
(`context/decisions.md`, standing constraint `prompt-position`). This is
why `SEARCH_DECISION` and `FORGET_DECISION` are deliberately appended last
by the assembly code rather than placed near thematically related material,
and why the position is treated in the codebase as a **scarce, capped
resource** — exactly two rules are allowed that placement, enforced in CI
by `shapelint.checkAppendedLastExactlyTwo` (`context/decisions.md`
`self-layer`).

**Reproduced at product scale, not just in a controlled probe.** An honesty
rule ("never invent a contactable detail — no email, no phone number, no
UPI id") was added at byte 35,440 of a 91,808-character brief — 38.6%
through the document, i.e. not appended-last. Driven through the real
`compile()` output and a real model call, she invented an email address,
checked an inbox she does not have, and reported a resume "arrived" in it:
*"bhej diya kya?? ek sec check karti hu --- haan aagya h mail! shaam ko
dekhti hu free ho ke 🫡"* — a receipt-family fabrication rate of **1/8
(12.5%)**, n=31 scored overall (`context/rejected.md`
`honesty-by-instruction`, 2026-08-20). The identical class of rule, in the
position `prompt-position` already knew was unreliable, failed exactly as
predicted before a single line of gating code existed.

**Why this is a position law and not a wording law, argued from the
project's own instrumented failure.** `gate0-structural`
(`context/measurements.md`, 494 disclosure scenarios, 31,122 row×scenario
checks) independently measured the same class of thing from a different
angle: a prompt-instruction arm for group-chat privacy leaked **57.1%** of
naturalistic and **98.1%** of adversarial scenarios regardless of exact
wording, while a retrieval-time SQL predicate over the identical scenario
set leaked **0**. Two unrelated safety properties, tested by two unrelated
methods, converge on the same conclusion: a sentence *anywhere* in a prompt
is a preference the model may or may not honor; a predicate over the output
bytes is a guarantee. §6 below treats this as its own finding because it
changes what a team should *build*, not only where in a document to put a
sentence.

**The rule:** position in a large prompt is a mechanism, not a style
choice, and a project that has more than a couple of rules needing the
reliable position is a project that needs to stop writing rules and start
writing gates. `[TODO-cite: positional/recency effects on instruction
following in long-context LLM prompts]`

---

## 4. Finding: measured-but-not-felt — a correctly-measured, statistically real delta can still be invisible to the person it was built for

**The instinct.** If an A/B change moves a measured quantity by a
meaningful relative amount (1.4×–1.76×) in the direction intended, and the
measurement method is sound, the change is working and can be shipped.

**What was measured.** A visual "presence of sky" veil was shipped after
ground-luminance-standard-deviation deltas of **1.4×–1.76×** were measured
in-browser, in the correct direction, with a sound method. The owner's
verdict on a real device: *"I see no sky."* The deltas were real and the
change was still imperceptible, because a ratio between two faint absolute
quantities is not a picture — a 12% show-through change rounds to
indistinguishable on a phone at daylight brightness (`context/rejected.md`
`measured-but-not-felt`, WS-SKYFELT round 1).

**The fix, and why it is the generalizable part.** The team replaced the
relative-delta metric with a **felt-assertion gated against the flat,
already-shipped baseline a real viewer would otherwise see** — a
mean-absolute-difference from the flat theme's ground, with a floor tuned
so that the *previously rejected* flat frame is a **permanent, in-run
negative control** that must itself fail the new gate (it computes 4.2
against a floor of 6.0). This closes a hole that a "did it improve"
comparison cannot close on its own: a metric can drift in the wrong
direction over time and the *relative* comparison would still show
"improvement" over an ever-worse baseline. Gating against a fixed,
adversarially-chosen absolute floor — with the rejected artifact wired in
as a standing negative control — is what makes the gate resistant to that
drift.

**The rule, stated generally rather than about pixels specifically:** *"A
relative improvement over an invisible baseline can itself be invisible."*
Any metric of the form "X% better than before" needs a companion assertion
against the threshold a real observer actually operates at, with the
previously-rejected state committed as a permanent negative control so the
absolute floor cannot itself decay unnoticed. This generalizes past UI: the
same failure shape — a real, well-measured relative delta with an
undetectable absolute effect — is a standing risk for any product metric
(latency, engagement, safety-score) reported only as a percentage change.
`[TODO-cite: minimum-detectable-effect / floor-vs-delta measurement design
in applied HCI and ML evaluation]`

---

## 5. Finding: episode-of-the-present-tense, call-opens-with-amnesia, and the lane-parity gate as the fix for both

Two independent, real-user-reported failures turned out to share one root
cause, discovered by a third-party tester (2026-08-23) on a production
build — not by internal testing.

### 5.1 Episode-of-the-present-tense

**The instinct.** An "activity" record (e.g., a chess game in progress)
should hold the current, live state of the activity, so that at any moment
the app can answer "what's happening right now" directly from the record.

**What broke, measured against the real failure.** She **denied two chess
games had happened**, then — when pressed — **invented moves**. The
activity episode stored `facts` about the *present* moment by design: a
finished game persisted as *"she is playing black; 6 moves in,"* and a rule
that suppressed the opening (which piece went where first) once it stopped
being "live news" ran at write time — deleting exactly the information a
later question ("which opening did we play?") would need. Compounding it,
the record was structurally unreachable for recall: one shared
`AppState.game` slot meant a later tic-tac-toe game overwrote the chess
game locally, the local write path wrote nothing durable, and the server's
keyword-recall leg never read the table activity writes populated
(`context/rejected.md` `episode-of-the-present-tense`). She answered from
the only game state she could see and fabricated the rest — not a retrieval
bug, an architectural guarantee that the retrievable record and the asked
question were about different tenses.

**The rule:** a memory writer must write the **past tense** — "what is
still true next week," not a snapshot of live state — and a rule that
prunes a fact because it has stopped being *news* must never run at
*archive* time. Enforcement shipped structurally rather than as a prompt
rule: honesty **family 6** (§6.4 below) blocks any shared-game-specific
claim unsupported by the record, with the tester's seven fabricated lines
kept as permanent must-fail negative fixtures.

### 5.2 Call-opens-with-amnesia-by-construction

**The instinct.** If a memory/recall system works correctly on the chat
lane, a voice call — driven by the same underlying engine — inherits the
same memory.

**What was measured.** *"kal kya baat kiya"* ("what did we talk about
yesterday") was answered correctly in chat and was **unanswerable on a
call**, on the same account, same day. Not a retrieval failure: chat sends
the last 90 messages as turns (call turns included); the **live call
session opens with zero turns**, and the one history block its system
instruction did carry excluded call turns entirely and stopped at 30
minutes. Two further context blocks (since-you-last-spoke, open promises)
were silently dark on the call lane specifically because one compile call
site never passed the current timestamp the blocks needed
(`context/rejected.md` `call-opens-with-amnesia-by-construction`) — the
same *second-hand-assembler-silently-drifts* failure shape the project had
already named once (`age-tier-never-realtime`, `realtime-recall-never`),
recurring a third time on the one lane that ships with **no output-side
gate** to catch it.

### 5.3 The lane-parity gate, as the fix for the class rather than the instance

Both 5.1 and 5.2 are instances of the same underlying hazard: **a context
block that exists is not thereby present on every interface that claims
it.** The project's fix generalizes past either bug: a context block must
be *asserted present, per lane, per turn* — never assumed from the fact
that the rendering function exists.

- `evals/continuity/parity.mjs` (`context/measurements.md`
  `call-parity-landed`, 2026-08-20) drives the real chat and call
  assemblers on the same person, same turn, and asserts **identical bytes**
  for T2/T3/T4/T6 (211/307/147/330 bytes respectively) across both lanes,
  with negative controls confirmed to fail: a call compiled with no
  relational bundle is caught on all four slots, and an *emptied* bundle
  (rows present, content stripped) is caught too — the harness checks
  content, not merely presence of the object.
- `evals/rupture-channel/` (`context/measurements.md`
  `rupture-channel-identity`, 37 assertions, $0, offline) compiles one
  ruptured relational state through **all four** real assemblies — chat,
  cascade call, live call, native watch — and asserts the stance block is
  byte-identical across all four, that a lapse (by time or by warm
  episodes) crosses all four together, and that no lane is left saying
  "(open)" while the others have moved on.
- A single production trace query (`context/measurements.md`
  `nine-dark-tail-slots`, 2026-08-20) made the general problem *queryable*
  rather than argued: a real compiled prompt showed **nine of thirteen
  declared tail slots rendering zero bytes** simultaneously, the first time
  the state of "switched off" vs. "empty" vs. "never wired" was visible in
  one place rather than the conclusion of three separate debugging
  sessions.

**The rule, stated once for the whole family:** *"Every context block that
exists must be asserted present on every lane that claims it, with a
per-lane budget pin — a block that renders on one lane and silently empties
on another is how the same person remembers in text and forgets on the
phone."* A parity gate that asserts **agreement between two required-
identical implementations** — rather than pinning either implementation's
current behavior — is the correct shape for any pair of surfaces a product
requires to stay in lockstep, because a test that pins one twin's current
behavior must be hand-edited every time that twin legitimately changes,
and drifts; a test that pins their *agreement* never needs editing and
catches exactly the failure that matters (`context/measurements.md`
`blank-guard-parity`, applying the identical shape to a geometry module
pair). `[TODO-cite: cross-modality / cross-channel state consistency
testing in multi-surface conversational systems]`

---

## 6. Finding: structural, output-side honesty gates outperform prompt-side instructions — and the honesty battery that proves it

**The instinct.** A well-written safety rule in the system prompt — "never
invent a contactable detail," "never claim a message was delivered when it
wasn't" — is the correct and sufficient mechanism for a language honesty
property, provided the wording is precise.

**What was measured, and it recurs across every honesty property tried.**
§3 above already gives one instance (`honesty-by-instruction`: a correctly
worded, correctly positioned-as-well-as-could-be-managed rule still
produced a fabricated inbox and a fabricated arrival). `gate0-structural`
gives the disclosure-control instance (57.1%/98.1% prompt-arm leakage vs.
0/31,122 for a retrieval-time predicate). The project's response was not to
write a better sentence; it was to move every honesty property that is
**decidable from the output bytes** onto the output path
(`src/engine/brain.ts` → `src/engine/honesty.ts`), gated **after**
generation and **before** delivery, and to build a battery
(`evals/honesty/run.mjs`) that tests the shipping bytes rather than a
parallel copy of the rule.

**The battery, by family, each independently gated and each with a
documented must-not-flag half (the point of the gate is precision, not
maximal suppression):**

| family | what it blocks | mechanism |
|---|---|---|
| 1 — invented identifiers | an email, phone number, or UPI id she has none of | provenance allowlist: she may say an identifier **only if it appears in her own input** (the assembled prompt or his words) — never her own past output, or a fabrication would launder itself into permanence (`context/decisions.md` `honesty-provenance-allowlist`) |
| 2 — false receipts | claiming a message/resume/payment "arrived" through a channel with no such event | `openCommitments(history)`, a **pure function over the transcript** — deliberately not a commitments table, so there is no writer that can go dead (`context/decisions.md` `receipt-ledger-from-transcript`) |
| 3 — false attribution | putting words in his mouth he never said | detector over the real conversational adapters |
| 4 — shared-past fabrication | claiming a shared event that never happened | requires a claim-term floor tuned against the graph; two co-tuned false-positive/true-positive fixtures kept in the same commit so a floor change can't silently flip the sign (`docs/audit/2026-08-22-honesty.md`) |
| 5 — channel promises | promising a delivery over a channel that can't carry it (a call promising a photo) | the one channel-aware predicate in the file — chat can send a photo, a call cannot |
| 6 — activity specifics | inventing details of a shared game/activity unsupported by the record | direct fix for §5.1, with the tester's 7 real fabricated lines as permanent negatives |

**The critical property, measured rather than assumed: the gate does not
cost content.** `honesty-pressure-1` (`context/measurements.md`,
2026-08-20) ran 22 real stimuli through the **real** compiled chat prompt
and the production model, scored in **both** the pre-gate and post-gate
arm from the same generation (never regenerated — regenerating would
reintroduce sampling noise and the exact denominator-mismatch trap
`visiongate-interim` had already been caught by): pre-gate receipt-family
fabrication was **1/8 (12.5%)**; post-gate, **0/31 overall, 0/15
identifier-family** (bound ≤20% by rule-of-three at this n, stated as a
bound rather than a false zero). **Content preservation: 29/29 clean
replies byte-identical** — the gate removed the lie, not the sentence
around it. The suite also found and closed a **second door**: the cascade
call lane streams raw model tokens to the speech synthesizer *before* the
reply finishes parsing, so a gate that only inspects the parsed reply is
walked around by audio that has already started. Both doors are now
asserted gated (2 gated / 2 call sites, mechanically checked).

**The battery's growth as its own evidence of the discipline.** Every
subsequent real-user report added checks rather than patches: 191 → 289
(family 5, channel promises, 2026-08-22) → 351 (2026-08-22 zero-gap audit)
→ 393 (family 6, activity specifics, first external tester, 2026-08-23),
each growth tied to a named report and a permanent negative fixture rather
than a silent tuning pass (`context/measurements.md`
`wave-2026-08-22-audit-round-2`, `tester-wave-1`).

**The rule, restated once for the whole finding, because it is the same
rule §3 derives from a different failure mode:** *"If a property is
decidable from the bytes, decide it on the bytes. A sentence in a brief is
a preference; a predicate on the output is a guarantee."*
`[TODO-cite: RLHF/instruction-tuning reliability vs. constrained decoding
and output-side verification for safety properties]`

---

## 7. Finding: the pre-registration discipline — and what it found when applied to the judges themselves

**The instinct.** An LLM capable enough to write good prose is capable
enough to *judge* prose reliably, especially against a rubric it is simply
asked to apply.

### 7.1 The mechanism: hash-pinned rubrics and both-orders-agree judging

Two structural protections recur across every judged comparison in this
project, and both are enforced mechanically rather than by convention:

- **Hash-pinned rubrics.** `evals/feltmem/prereg.mjs` hashes every rubric
  and its fixtures into a committed `prereg.manifest.json`;
  `evals/feltmem/run.mjs` **refuses `--live`** unless the hash it
  recomputes matches — negative-tested directly: mutating a rubric changes
  its hash, restoring the rubric restores the hash
  (`evals/feltmem/gate.mjs`). This makes "we changed the rubric after
  seeing early results" a run that **cannot execute**, not a norm that
  could be silently broken. The same shape governs
  `docs/SWAP-TEST-PREREG.md`: the commit that introduces the document *is*
  the pre-registration timestamp, and anything after it must declare
  itself an amendment and say what changed and why.
- **Both-orders-agree judging.** Every blind comparison in the project
  (`charm-grok`, `charm-luna`, and every judge-qualification backtest) is
  judged in **both presentation orders**, and a unit counts as a win only
  when both orders agree; order-flips are charged as ties. This exists
  because slot position bias is real and was measured directly: the
  judge's own pick rate for slot A ranged from **56.3%** (`charm-grok`,
  corrected in `grok43-favoritism-retracted`) up to **90.6%** for the
  worst-performing candidate judge (`mistral-judge`) — a judge picking the
  first thing it sees nine times in ten is not applying a rubric.

### 7.2 What pre-registration caught before it cost anything

`swap-prereg-1` (2026-08-15) froze a design — replaying archived
transcripts to test a candidate model — as a committed document *before*
any confirmatory data existed. Within hours, and before a single run, its
own named reversal condition fired: the archives it planned to replay
turned out to store **no full served prompt at all**
(`context/decisions.md` `swap-prereg-amend-1`). Because the reversal
condition was written down in advance, the correct response was
mechanical — amend the document, log why, before generating any data —
rather than a judgment call made under the pressure of results already in
hand. The amendment (fresh paired generation through the real compiler,
byte-identical across arms **by construction**) is strictly stronger than
the design it replaced, and the project's own log states plainly that this
is the pre-registration "doing its job," not a failure of planning.

### 7.3 The finding pre-registration made possible: six judge families fail, and the ground truth is not much better

Backtested against archived, human-verified blind verdicts (bar: **80%
pooled agreement**, both-orders-agree), every zero-cash-eligible judge
family failed, decisively (`context/measurements.md`
`judge-qualification-2026-08-23`, `judge-backtest`, `grok43-judge`,
`deepseek-pro-judge`, `mistral-judge`, `cohere-judge`):

| judge | pooled agreement | 95% CI | slot-A bias |
|---|---|---|---|
| DeepSeek-V4-Flash | 27.4–28.1% | [19.4, 37.8] | up to 80.2% |
| gpt-5.6-terra | 52.1–54.2% | [42.2, 63.8] | ~62% |
| grok-4.3 | 34.4% | [25.6, 44.3] | up to 76% (own-vendor cell) |
| DeepSeek-V4-Pro | 30.9% | [22.4, 40.8] | ~65–67% |
| Mistral-Large-3 | 29.2% | [21.0, 38.9] | 88.5–90.6% |
| command-a-plus (Cohere) | disqualified for cause | — | writes prose against a JSON-only contract, majority-unparseable |

Clustering the 96 judged units by their true unit of repetition — 12
underlying beats, not 96 independent trials — and re-deriving every CI by
a 10,000-rep beat-level cluster bootstrap moved CI widths by at most
**+3.1pp**; every scorable judge remained a clean FAIL against the 80% bar
(`context/measurements.md` `r5-clustered-cis`, 2026-08-18).

**The finding that reframes all of the above.** `ground-truth-ceiling`
(`context/measurements.md`, 2026-08-18) ran the *trusted* judge
(`claude-opus-4.8`) a second time against its own archived verdicts on the
identical 96 units, both orders: it agreed with **itself**, on retest,
**74/96 = 77.1%**, 95% CI **[67.7, 84.4]** — a confidence interval that
itself straddles the 80% bar every candidate was failing. **No candidate
judge can be expected to exceed the rate at which the ground truth agrees
with its own past self.** Every measured FAIL is not merely below an
arbitrary threshold; it sits 23–49 percentage points below the ceiling of
its own reference, which is a materially different — and harder to
dismiss — claim.

**A companion negative result, from the causal control run for the
project's separately-submitted judge paper.** The original hypothesis was
that Hinglish code-switching specifically defeats these judges. A
faithful, spot-checked machine translation of the same 96 units to
monolingual English, re-judged by the same five failed judges, recovered
**+6.6, +5.6, +3.7, +3.1, −3.1 percentage points** — every recovery **inside
the project's own 13.6pp fabrication-metric noise floor**
(`context/measurements.md` `r4-english-control`, 2026-08-18; noise floor
from `fab-noise-floor`, below). Code-switching is *not* the mechanism;
these judges fail at the underlying affective-companion judgment task in
English too.

### 7.4 The noise floor that makes n≥300 non-negotiable

`fab-noise-floor` (`context/measurements.md`, 2026-08-11): on **5 of 8**
sessions, an independent replay harness produces a **byte-identical** wake
pattern under every candidate setting — provably the setting cannot act
there — and across those 300 arm-pairs the judged fabrication rate still
spreads **13.6 percentage points** (median absolute difference 28pp, p90
75pp; one cell moved 50%→92% on **identical input**). This one number is
why every fabrication claim in this project's log at n<300 is explicitly
labeled a "rehearsal" and withheld from any headline (§8 below and
`context/measurements.md` `feltmem-rehearsal-2026-08-23` are direct
consequences), and why the swap-test protocol's judged gates are priced and
sequenced around reaching n=300 rather than around any specific dollar
figure.

**The rule:** pre-registration is not paperwork around a measurement, it
*is* the measurement's validity — a rubric that can be edited after seeing
results, a judge whose qualification is assumed rather than backtested, or
a rate reported below its own measured noise floor are three ways to
report a number that looks like evidence and is not. `[TODO-cite:
pre-registration in ML/NLP evaluation; LLM-as-judge reliability and
position bias literature]`

---

## 8. Finding: spine-that-ran-one-step-of-six — a scheduled job needs an output-side proof, not a scheduling-side one

**The instinct.** A cron job that is committed to the repository, correctly
configured, and (per its own logs) fires on schedule and reports success is
running.

**What was measured.** Two independent failures were stacked so that each
one hid the other (`context/rejected.md`
`spine-that-ran-one-step-of-six`, 2026-08-23):

1. The hourly consolidation cron fired **with `dryRun` defaulting to
   true** — every firing logged as a success while writing nothing.
2. The sweep endpoint it called invoked only the first of a **six-step**
   reference chain (relational-state derivation, patterns, phrases,
   texture, self-arc, and one more), so even correcting the flag would
   have left five of six derived tables empty while the run's own report
   showed cost and progress — because progress was measured by "the step
   that ran" rather than "the chain that was supposed to run."

The consequence, independently confirmed against production
(`context/measurements.md` `never-scheduled`, 2026-08-18): **every
relationally-derived table — rel_state, patterns, phrases, texture,
self-arc — held zero rows for all forty real users, for the entire time
the feature was believed shipped.** Every "she remembers the shape of us"
context block rendered **zero bytes**, silently, on every lane, for every
user, and every offline gate stayed green throughout, because — the
project's own recurring diagnosis, restated here because it is the load-
bearing sentence of the whole finding — **"every gate asked 'does the code
do the right thing when invoked,' and nothing invoked it."**

This is not an isolated incident; it is the fourth instance of one family
found in this codebase within roughly a week, and naming the family is
itself part of the finding: `startup-failure-is-invisible` (a GitHub
Actions job-level `if:` referencing a context GitHub does not evaluate at
that scope, silently invalidating the whole workflow file for **nine
consecutive days**, taking down even the monitor job whose sole purpose was
to announce that deploys were misconfigured), `logged-but-unindexed`
(sixteen rejected.md entries existed as prose with no corresponding graph
node — findable by a human reading the file top to bottom, unfindable by
the query tool meant to retrieve them), and `engine-bundle-check-uncalled`
(a working drift-detection guard, invoked by nothing, that had already let
a persona/compiler change ship un-regenerated to a production surface).

**The fix, stated as the general rule the project settled on:** *"A
scheduled job needs an output-side proof, not a scheduling-side one."*
Two mechanisms now enforce this specifically: a **lane-parity gate**
(§5.3) that asserts derived state is *present* rather than assuming a
writer that ran means state that landed, and a **consolidation-quality
eval that asserts the derived rows exist against real fixtures** rather
than asserting the job returned exit code 0. Separately, and generalizing
past scheduling specifically: **spend counters must count attempts, not
successes** — the same incident surfaced a run that reported "0 model
calls" while a failing provider had, in fact, been called and had failed;
a cost dashboard built from successes undercounts a systematically broken
integration by exactly the amount that matters.

**Why this belongs beside the four "measure, don't reason" findings above,
rather than in a separate infrastructure appendix.** Every finding in §§2–6
depends on a measurement pipeline that itself has this exact failure mode
available to it: a battery that reports PASS because nothing in it was
invoked, a judge run that reports agreement because it silently scored a
subset, an eval that stayed green because the code path it exercises is
not the code path production calls. §8's generalizable lesson — *the thing
that reports on the work is not automatically itself under test, and must
be, explicitly, or it will eventually be the one broken part nothing else
can see* — is the discipline's own epistemics stated as a warning about
itself. `[TODO-cite: observability / "watching the watchers" literature in
software reliability engineering]`

---

## 9. Limitations

Stated plainly, per the project's own standing rule against implying
coverage that was not measured:

- **The feltmem judged rehearsal is explicitly underpowered and is not a
  result.** `feltmem-rehearsal-2026-08-23` (`context/measurements.md`)
  landed 241 of a planned 1,320 judgments (n≈130/arm) before the run was
  truncated by a provider key limit — below the 300-per-arm floor
  `fab-noise-floor` (§7.4) establishes as this project's own noise
  threshold. The directional numbers reported there (law 1 "retold-not-
  recited" +0.89, law 7 "human-time" +0.84, a 5.4-percentage-point
  preference gap against a 10pp target at power) are logged as direction
  only, explicitly labeled a rehearsal, and are **not cited as findings
  anywhere in this paper** — they are named here solely so a reader who
  encounters the raw archive (`evals/feltmem/runs/judged-2026-08-23-
  REHEARSAL.json`) understands why this paper does not use it.
- **The swap-test's central identity-ceiling claim (model sets a ceiling
  the prompt cannot lift the character above) is real and load-bearing for
  this project's broader research direction, but is deliberately outside
  this paper's scope** — it is documented in `context/decisions.md`
  (`brain-model`, `relational-wedge`) and is the subject of the project's
  separate, larger swap-test research program rather than one of the eight
  findings selected here.
- **Several findings in §§2–6 are n=1 production incidents plus a targeted
  confirmatory harness, not large-sample studies**, and are reported as
  such rather than inflated with a sample size the underlying event does
  not have (e.g., `episode-of-the-present-tense`, `call-opens-with-
  amnesia-by-construction` are single real-user reports, root-caused and
  then defended with a permanent regression fixture — the fixture proves
  the *fix* held on re-test, it does not turn the original incident into a
  population estimate).
- **All findings come from one product, one team, and one measurement
  culture.** Every generalizable rule stated above is this project's own
  synthesis of its own failures; none has been tested against an
  independent codebase, and several (§7 specifically) are corroborated by
  the project's separate related-work survey (`context/measurements.md`
  `phase-a-research`) rather than by new data collected for this paper.
- **The related-work citations below are placeholders, by design.** Per
  this project's own rule against fabricated evidence (§6), no citation is
  invented; every claim of prior art is left as a bracketed TODO for a
  literature pass before submission, rather than filled with a plausible-
  sounding reference nobody has verified exists.

---

## 10. Related work (stubs)

- `[TODO-cite: verbatim reproduction / memorization of few-shot exemplars
  in in-context learning]` — for §2.
- `[TODO-cite: positional bias / lost-in-the-middle effects in long-context
  instruction following]` — for §3.
- `[TODO-cite: perceptual thresholds vs. statistical significance in
  applied UI/UX measurement; minimum detectable effect in HCI]` — for §4.
- `[TODO-cite: episodic vs. semantic memory representations in
  conversational/dialogue agents; temporal grounding of stored facts]` —
  for §5.
- `[TODO-cite: multi-surface / multi-modal state consistency in assistant
  systems; twin-implementation parity testing]` — for §5.3.
- `[TODO-cite: constrained decoding, output verification, and
  post-generation safety filtering vs. instruction-tuned refusal]` — for
  §6.
- `[TODO-cite: LLM-as-judge reliability, position/order bias, and
  qualification-before-use protocols]` — for §7.
- `[TODO-cite: pre-registration methodology, originally from clinical
  trials and social psychology's replication crisis, as applied to ML
  evaluation]` — for §7.
- `[TODO-cite: sycophancy and self-consistency of LLM judges under
  test-retest]` — for §7.3's ground-truth-ceiling finding specifically.
- `[TODO-cite: production incident analysis / postmortem literature on
  silent failures in scheduled/background job infrastructure]` — for §8.

---

## Appendix: source-entry index

For a reader auditing this draft against the primary log, every finding's
source entries in one place:

| section | primary `context/` entries |
|---|---|
| §2 recited-prompt | `rejected.md#recited-prompt`, `measurements.md#taste-consistency`, `measurements.md#affect-recitation` |
| §3 prompt-position | `decisions.md` (standing constraint `prompt-position`), `rejected.md#honesty-by-instruction`, `measurements.md#gate0-structural` |
| §4 measured-but-not-felt | `rejected.md#measured-but-not-felt` |
| §5.1 episode-of-the-present-tense | `rejected.md#episode-of-the-present-tense` |
| §5.2 call-opens-with-amnesia | `rejected.md#call-opens-with-amnesia-by-construction`, `rejected.md#age-tier-never-realtime`, `rejected.md#realtime-recall-never` |
| §5.3 lane-parity gate | `measurements.md#call-parity-landed`, `measurements.md#rupture-channel-identity`, `measurements.md#nine-dark-tail-slots`, `rejected.md#blank-guard-parity` |
| §6 structural honesty gates | `decisions.md#honesty-provenance-allowlist`, `decisions.md#receipt-ledger-from-transcript`, `measurements.md#honesty-pressure-1`, `measurements.md#gate0-structural`, `measurements.md#wave-2026-08-22-audit-round-2`, `measurements.md#tester-wave-1` |
| §7 pre-registration discipline | `measurements.md#judge-qualification-2026-08-23`, `measurements.md#judge-backtest`, `measurements.md#grok43-judge`, `measurements.md#deepseek-pro-judge`, `measurements.md#mistral-judge`, `measurements.md#cohere-judge`, `measurements.md#r5-clustered-cis`, `measurements.md#ground-truth-ceiling`, `measurements.md#r4-english-control`, `measurements.md#fab-noise-floor`, `decisions.md#swap-prereg-1`, `decisions.md#swap-prereg-amend-1` |
| §8 spine-that-ran-one-step-of-six | `rejected.md#spine-that-ran-one-step-of-six`, `measurements.md#never-scheduled`, `rejected.md#startup-failure-is-invisible`, `rejected.md#logged-but-unindexed`, `rejected.md#engine-bundle-check-uncalled` |
| §9 limitations | `measurements.md#feltmem-rehearsal-2026-08-23`, `decisions.md#brain-model`, `decisions.md#relational-wedge`, `measurements.md#phase-a-research` |
