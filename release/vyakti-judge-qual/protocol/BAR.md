# The bar, and the mistake we made setting it

## The rule

A candidate judge **passes** only when the **95% Wilson lower bound** of its
unit-level agreement with the trusted verdict set reaches the bar. A point
estimate above the bar with an interval that straddles it is `UNDERPOWERED`, not
a pass. Ours was **≥80%**.

Two things made that bar credible and one thing made it wrong.

## What made it credible

**It was fixed before any candidate ran, in a document with a cost attached.**
The ≥80% methodology was committed on 2026-08-13; the first candidate result was
committed on 2026-08-15. The bar gated a downstream spend of roughly $400, so
somebody had a real incentive to argue it down, and it held. A bar nobody could
have been tempted to move is not evidence about anything.

**Its escape hatch was pre-registered too, and it fired.** The programme wrote
down in advance what would happen if no judge cleared the bar. Every candidate
failed and the stated consequence was executed. A threshold that has never bound
is not a threshold.

## What made it wrong

**Nobody measured whether 80% was achievable.** Late in the work we ran the
protocol on the ground truth itself — the model that produced the archived
verdicts, re-judging its own archive, same units, same both-orders rule, same
harness. It agreed with itself on **74 of 96 units: 77.1%, 95% CI
[67.7, 84.4]**, beat-clustered [69.8, 85.4].

The bar sat above the ceiling. Under our own rule, the ground truth would not
have qualified as a judge of its own archive.

This cost 192 calls and about four dollars — a rounding error against the $400
the bar was gating.

## The rule that follows

**Measure the ceiling first. Then pre-register a bar as a stated fraction of
it. Then run candidates.** In that order.

And report failures against the ceiling, not only against the bar. An agreement
rate against a bar is a statement about a threshold somebody chose; an agreement
rate against a measured ceiling is a statement about the instrument. Our five
scorable candidates were 22.9 to 49.0 percentage points below the ceiling, and
that sentence survives any argument about where 80% came from.

A bar chosen *after* seeing the ceiling is fine. A bar chosen after seeing
candidate results is not a bar.

## The minimal qualification report

Eight numbers, all of which this harness already computes. Each exists because
its absence produced a wrong reading somewhere:

1. **Agreement with the trusted verdicts, with an interval, against a stated
   bar.**
2. **The chance baseline for the aggregation rule actually in use** — derived
   from the archived verdict distribution, never assumed. Under a
   both-orders-agree rule it is not 50%. Ours was 30.5% for a uniform-random
   judge and 21.9% for a judge that always picks the first slot.
3. **The judge's slot-A pick rate, beside the trusted judge's rate on the
   identical rows.**
4. **The tie rate, beside its content-blind prediction.** If a judge picks the
   first slot with content-blind propensity *q*, counterbalancing means it names
   the same side twice only by accident, so it ties on *q*² + (1−*q*)² of units.
   A judge sitting on that curve has stopped carrying content, and the harness
   prints the gap for you (`contentSignalGapPp`). Two of our judges sat within
   2.6 points of it.
5. **Transport misses.**
6. **Parse misses.** Separately from (5) — see `harness/guards.mjs` for why the
   distinction is not recoverable after the fact.
7. **A family-conflict cell where one exists, and a BETWEEN-JUDGE control for
   it.** A within-judge control alone manufactured a 16× vendor-favoritism
   effect for us that a between-judge control erased. Where the treatment is a
   property of the judge and the conditions are archives that differ in many
   ways, the between-judge control is not a robustness check — it is the
   identification.
8. **The ground truth's own test–retest ceiling.**

## What this bar does not measure

Agreement with a trusted judge is not accuracy. If the trusted verdicts are
themselves model output — ours are — then a judge clearing the bar has
reproduced one model's taste, which is a useful and limited thing. Self-agreement
bounds the *noise* in a verdict set; it says nothing about its *validity*. A
model can be perfectly reproducible and consistently wrong.
