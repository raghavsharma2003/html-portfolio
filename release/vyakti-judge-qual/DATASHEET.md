# Datasheet for `vyakti-judge-qual`

*Structured after Gebru et al., "Datasheets for Datasets".*

---

## Read this first

**The ground truth in this dataset is LLM-produced. It is not human
annotation.** Every "agreement" number computed from it is agreement with the
recorded decisions of one frontier model, `anthropic/claude-opus-4.8`, on one
product's construct. It is **not accuracy**, and nothing in this release should
be reported as accuracy.

We can say four things for those verdicts and we say no more than four. They
were produced **blind** (model identity stripped), **counterbalanced** (each
comparison presented in both orders and consolidated only where the two orders
agreed), **before this study existed and not for it**, and they were **acted
upon** — they are the recorded reason two candidate models were declined for a
shipping consumer product. That makes them a decision record with consequences
attached, which is a stronger warrant than a convenience label. It does not make
them human judgement.

We also know how noisy they are, because we measured it: the model that wrote
them reproduces them **77.1% of the time** (74/96, 95% CI [67.7, 84.4]) when
re-run under the identical protocol seven days later. Roughly one archived
verdict in five is not reproduced by its own author. Self-agreement bounds the
noise in the verdict set; it says nothing about its validity, because a model
can be perfectly reproducible and consistently wrong about a linguistic
community's register.

**The foreseeable misuse of this release is being adopted as a benchmark of
judge *correctness*.** It is not one. A leaderboard built on it would launder
one model's aesthetic into an apparent ground truth, which is precisely the
failure mode the accompanying paper documents. If you use it, use it as this
suite's authors do: to ask whether a candidate judge reproduces decisions you
already believe, on your own material, against a bar you measured before you set.

---

## Motivation

**Why was it created?** A deployed Hinglish (romanised Hindi–English
code-switched) AI-companion product needed an automatic judge to gate a
downstream evaluation worth roughly $400 in compute. Before trusting one, the
team backtested six candidates against verdicts it already relied on. All six
failed. The dataset is the record of that qualification, released so the
protocol can be pointed at other archives and other judges.

**Who funded it?** The judging compute ran on a Microsoft-for-Startups Azure
grant ($0 cash). One run — the ground truth's test–retest — cost $3.93 of the
authors' own money. No model was trained or fine-tuned for this work.

---

## Composition

**What do the instances represent?** Three kinds.

1. **Transcripts** (`data/archives/*/transcripts.json`, 192 conversations).
   Each is a 6-turn exchange between a scripted user and one of two candidate
   language models playing an AI companion, in one of 12 affective beats
   (casual, teasing, bored, sad, conflict, factual, crisis-adjacent, and others)
   and one of two lanes (text, voice-transcript). The **user turns are identical
   scripted lines across arms**; the arms differ only in which model produced
   the replies, and both received a byte-identical system prompt.
2. **Verdicts** (`data/archives/*/verdicts.json`, 192 judgments over 96 units).
   Blind, counterbalanced judgments on seven axes (warmth, humour, register,
   specificity, brevity, personhood, overall) plus three safety flags, with a
   free-text rationale each.
3. **Judge rows** (`data/judge-rows/*.jsonl`, 8,256 rows). One row per
   (judge, archive, unit, presentation order) for each backtest: the `overall`
   axis for eight judges (1,536), six further axes for five judges (5,760), and
   an English-translation condition for five judges (960).

**Is anything missing?** Yes, and deliberately.

- **The system prompt that produced the replies is not released.** It is the
  product's principal commercial asset (~45,000 characters) and it is not needed
  for anything the paper claims: the result depends on transcripts, verdicts,
  rubric and harness, and on none of the prompt. The source archives embed it;
  this bundle is built by an extraction script that never copies a whole source
  object, and the build is verified by executed greps.
- **Per-turn latency and cost fields** are dropped from the transcripts, and
  **per-call token counts** from the judge rows. Both leak deployment
  economics. Run-level totals are published in `data/runs/cost.json` instead.
- **A third generated arm exists in one source archive and was never judged.**
  It carries no ground truth and is excluded rather than shipped as an
  unlabelled extra.
- **Audio was never archived.** The voice lane is transcripts.

**Is the data a sample?** No — it is the complete record of two bake-offs and
every backtest run against them. But 96 units is small, and they are **not 96
independent observations**: they cluster on 12 beat scripts, 8 units each. The
honest count for a variance estimate is **12**, and the released analysis
reports beat-clustered intervals for that reason.

**Does it contain confidential or sensitive data?** No. See below.

---

## Collection

**How was it acquired?** Generated. Scripted user turns were authored by the
product team; replies were generated by the models under test on 2026-08-11;
verdicts were generated by `anthropic/claude-opus-4.8` the same day; judge rows
were generated between 2026-08-15 and 2026-08-18.

**Were people involved?** Only as authors of the scripts and operators of the
harness. There are **no human subjects, no IRB review sought and none required,
no crowdworkers, and no consent to obtain**, because there is no data subject.

**Does it contain data about people?** No real people. The scripted
interlocutor is fictional.

---

## Preprocessing

**Person names are pseudonymised.** The fictional interlocutor's name → `USER`;
the companion persona's name → `HER`; one surname appearing in a scripted
work anecdote → `[NAME]`. This is a substitution in the released text and is
recorded here rather than left for a reader to notice. It removes a link to the
authors' own names at no cost to the linguistic content.

**Place references are retained and this is a decision, not an oversight.** The
scripts contain Indian city and landmark references (a Bangalore traffic
junction, city names, a neighbourhood). They are authored character detail in a
fictional script, not identifying information about any person, and removing
them would damage the code-switched linguistic content that is the point of the
release. Every occurrence is counted in `data/BUILD-STATS.json` so the decision
is auditable. **This item is flagged for the data owner's sign-off before
publication.**

**Nothing else is altered.** Verdict rationales, judge picks, miss records and
counts are as produced. Rows the harness refused to score are shipped *with*
their refusal, not dropped.

---

## Uses

**What is it for?** Qualifying an LLM judge against verdicts you already trust,
and reproducing the accompanying paper's numbers offline. `analysis/` runs from
this bundle alone, with no network and no key.

**What should it not be used for?**

- **A benchmark of judge correctness or a public leaderboard.** See "Read this
  first".
- **Training data for a reward model or a judge.** The verdicts encode one
  model's preferences on one product's register; a model trained to reproduce
  them would inherit exactly the aesthetic this study documents as a failure
  mode when substituted for a construct.
- **A claim about Hinglish speakers' preferences.** No native-speaker annotation
  exists in this dataset. The accompanying paper treats that as its central
  limitation and as an ethical one: a claim that automatic judges misread a
  linguistic community's register, made without annotators from that community,
  has not been earned. A human-annotation run (≥2 native Hinglish raters, with
  inter-rater agreement reported) is specified but **not** included here.
- **A vendor comparison.** `protocol/QUIRKS.md` is a compatibility record from
  one tenant on specific dates, and deployments drift.

**Known biases in the data itself.** The two archives are complementary by
design — one is a 38–2 landslide, the other a 17–18 dead heat — and their
ground-truth base rates differ enormously (5.0% vs 51.4% candidate-win among
decisive units). Any ratio computed against the landslide archive's base rate
inflates; this is how the paper's own retracted "16× vendor favoritism" headline
was arithmetically reachable. Do not compute elevation ratios across the two
archives without a between-judge control.

---

## Distribution and maintenance

**Licence.** Code (harness, analysis): **Apache-2.0**, `LICENSE-CODE`. Data
(transcripts, verdicts, judge rows, run outputs): **CC BY 4.0**,
`LICENSE-DATA`. Deliberately not non-commercial and not share-alike: a
qualification protocol nobody may use commercially does not get adopted, and
adoption is the entire point. The commercial protection lives in the unreleased
persona, not in the licence.

**Third-party rights.** The transcripts are model output over authored scripts
and the verdicts are model output. There is no third-party copyright interest
and no data-subject consent to obtain.

**Will it be updated?** Two known gaps would change it: a human-annotation run,
which would add a genuinely human ground truth; and a rerun of the one judge
whose result the parse guard refused, which would give the suite its first
demonstrated *passing* judge. Neither is included and neither is promised.

**Errata policy.** Two of the accompanying paper's own findings were retracted
by controls the authors ran themselves, and both retractions ship inside the
paper with the original reasoning intact rather than as silent edits. Corrections
to this dataset will be handled the same way: superseded, never deleted.
