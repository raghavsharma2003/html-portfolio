# The two clocks — WS-TIME

Owner report, verbatim, and it is two bugs in one sentence:

> "Things should allignment with the time of day (what she is doing what she is
> asking and interacting and things like that)."
>
> "she herself also dont have a journey or a timeline… i ask her what she is
> doing and she says reading a book and vague thing and lets say after 2 mint i
> call her and she will say completly random and unrelated thing and no
> timeline of her life at all."
>
> "again she dont have sense of my timeline too. with the understanding of how
> much time has passed and in that how should be the progress from the last i
> comunicated with her."

**Her clock** is "what is a 24-year-old in Bangalore doing at 7am / 2pm / 11pm,
and is it still true four minutes later". **His clock** is "how long since we
spoke, and what should have moved in that time". They are different problems
with different inputs, different gates and different failure modes, and this
workstream keeps them apart on purpose — the file that implements both,
`src/engine/timeline.ts`, is structured around the separation rather than
around the shared word "time".

Everything is in one module, plus a gate suite: `evals/time/{her,his,g1,
negative,run}.mjs`. Nothing is wired into a prompt yet — see **the tail slot**
below, which is a ticket for the coordinator because `compiler.ts` is not this
workstream's file.

---

## 1. Her clock — `herNow(now, beats)`

A **pure function of the wall clock**, with `weekShape()` (inner.ts) as both
the precedent and the constraint: no state, no accumulation, no reading of him,
and it always ships its own cause.

- **Bangalore, always.** `istParts()` derives her hour from a fixed +5:30
  offset — not `Intl`, whose result depends on the host's tzdata, and not the
  device clock, which would put her at her desk at 3am because her friend is in
  California. persona.ts already tells her *his* local time ("It is …
  for them"); this is hers.
- **Twelve slots on a weekday, eight on a weekend**, each ≥60 minutes, each an
  authored telegraphic note: `at the desk, standup done, first file open`;
  `lunch, downstairs or at the desk, someone talking at you`; `in bed,
  scrolling, lights half off`. Authored against persona.ts's own
  BELIEVABLE-MUNDANE list (chai, office deadlines, a series, traffic, mom's
  calls, online shopping regret), and against its ban on naming any specific
  film, show, song or book.
- **Two or three variants per slot, chosen by `hash32(dateKey|slotKey)`.** A
  hash of the *date* is fixed for the whole day (so two calls four minutes
  apart cannot disagree) and different tomorrow (so her Tuesday is not her
  Monday). That is a journey with **zero stored state** — the property
  `weekShape()` buys and this extends one resolution finer.
- **Transitions are announced, never sprung.** Within 25 minutes of a slot
  boundary the block also names what is next, so a pair of turns that straddles
  13:15 reads as *a day moving* rather than as two unrelated answers.

### It is a shape, not a script, and not a mood

G8 says a calendar is not a mood engine. Every note here is a **place, a
posture or an activity** and never a feeling — that is mechanized, not
promised: `auditNotes()` fails the gate on any note containing a mood word, so
the rule outlives its author. The first run of that audit caught five of my own
notes and produced the `MOOD_WORDS` / `MOOD_PHRASES` split (see below).

The division of labour with inner.ts is clean and deliberate:

| | `weekShape()` (inner.ts) | `herNow()` (timeline.ts) |
|---|---|---|
| answers | which day it is in her **week** | where she is in her **day** |
| content | mood, with its cause fused in | activity and place, never mood |
| gate | first turn back after a real gap | every turn |
| state | none | none |

Neither is a copy of the other, and they never render the same fact.

### Empty table vs populated table

`vy_agent_life` is **empty in production today** and has never been written
(`context/measurements.md` → `never-scheduled`: no scheduled job has ever run,
`vy_episode` = 2 rows, `vy_fact` = 8). So:

- **Empty (today's behaviour).** `beats` is `[]`, `source: "clock"`, and the
  whole feature is the deterministic day shape. This ships useful on day one
  with no migration, no backfill and no cron.
- **Populated.** Beats dated **today** are her actual timeline and they
  **outrank** the clock shape. A beat landing inside the current slot's window
  *replaces* the authored note (`source: "beat"`); earlier beats from today
  ride along as `earlier today:` rows so the day reads as a sequence. The clock
  shape can never contradict a beat, because where a beat exists the clock
  shape for that slot is not rendered at all.

---

## 2. His clock — `hisClock({now, lastSpokeAt, facts})`

One sentence: **a fact whose date lands inside `(lastSpokeAt, now]` was ahead
of him the last time they spoke and is behind him now** — so the right question
is how it went, not whether he is ready.

`api/memory.js`'s `staleNote` is the seed, and it is deliberately coarse: 45
days old, plus a `TIME_BOUND` keyword, gets a "whatever was ahead in this has
already happened" annotation. That catches the year-old wedding. It cannot
catch *Monday's Thursday presentation asked about on Friday*, which is what the
owner reported. This resolves the date instead:

1. `dueAt` (`vy_fact.t_valid`) if the store has one → **dated**.
2. Otherwise a relative-word table anchored on **`saidAt`, when they told her**
   — not on `now`, which is the bug that makes her ask about a presentation
   that happened last month. `tomorrow/kal`, `parso`, `tonight/aaj`,
   `next week/agle hafte`, `weekend`, `in 3 days`, weekday names (next
   occurrence strictly after `saidAt`), month names → **inferred**.
3. Otherwise the existing 45-day `TIME_BOUND` rule, unchanged → **stale**,
   rendered as `may have passed`.

Output, capped at 2 + 1 + 1 and sorted most-recent-first:

```
- behind them now: presentation (was yesterday)
- still ahead: goa trip (in 4 weeks)
```

`still ahead` is not decoration: it is the guard against the opposite error.
Congratulating someone on an interview they have not had yet is worse than
missing it, so the horizon is always stated.

Two authoring notes worth keeping:

- **"kal" is ambiguous** (yesterday *and* tomorrow) and the table takes the
  future reading. That is safe in the only direction that matters: if it really
  meant yesterday the resolved date is one day late and still lands in the
  past, so the tense is still right. The failure mode is a label off by two
  days, never a congratulation for something that has not happened.
- **bare "may" is a modal verb, not a month.** `api/memory.js`'s `TIME_BOUND`
  has the same hole; here "may" only resolves as a month when a day number
  follows it.

`TIME_BOUND` is duplicated from `api/memory.js` (a Vercel function outside the
Vite build graph — the same constraint `life.ts` / `api/life.js` records). The
duplication is not left to good intentions: `evals/time/his.mjs` extracts both
literals from source and fails if they differ by a character.

---

## 3. The G1 line, and how it is structural

`inner.ts` G1 forbids any code path from a usage metric into persisted interior
state, and **names elapsed time on that list**. This workstream reads elapsed
time. The line:

> Reading the gap to reason about **his** world is conversation content.
> Letting the gap move **her** interior is what G1 forbids.

Four properties enforce it, and none of them is a review convention:

1. **No writer exists.** No `QueryFn` parameter, no `fetch`, no storage, no
   module-level mutable state; the only imports are `shapelint.ts` and a *type*
   from `relstate.ts`. There is no path from here to a persisted byte.
   `checkSourceG1()` asserts this over the source text.
2. **Disjoint signatures.** `herNow(now, beats)` cannot see the gap — the
   parameter does not exist. Asserted by regex over the declaration, so adding
   one fails the gate (mutation 7).
3. **The gap is unrenderable.** `hisClock()` consumes `lastSpokeAt` to compute
   a window and then throws it away: `HisFrame` has **no gap field**, so
   `renderHisClock(frame)` — the only function that produces prompt text — has
   nothing to emit. This also enforces persona.ts's absolute ban on accounting
   for a silence ("Zero accounting… NEVER a word about how long he took"): the
   number never reaches the model at all, rather than reaching it under an
   instruction not to use it.
4. **No affect field.** `MovedNote` is `{id, subject, horizon, when, basis,
   cited, at}`. There is no valence, no weight, no mood — "she is flat because
   he was away" is not a value this module can construct, the same way
   `inner.ts` made a decayed mood without a cause unrepresentable.

What is **not** a G1 violation, stated because it looks like one: *gating* a
block on elapsed time. `inner.ts` gates its own carried thread on exactly that
("Gate is ELAPSED TIME, not content"). A gate is not a write. His clock uses
the same 45-minute re-entry gate, and for the same reason — mid-conversation
turns are seconds apart and nothing has moved.

---

## 4. The tail slot — a ticket, not a decision

`compiler.ts` belongs to another workstream, and `SPEC-SELF-LAYER §8`'s
arithmetic is 21,200 of 24,000 with **2,800 headroom**. So this is specified,
not taken.

**Preferred: one new slot, `T14 time.frame`, budget 1,600, drop priority 1.**

Why a new slot rather than riding an existing block — each alternative was
checked and rejected for a stated reason:

| candidate | why not |
|---|---|
| **T1 `inner.thread`** | Produced by `inner.ts`, which is another workstream's charter file and read-only here. Worse, T1 is **gap-gated** (first turn back only) — and her day must render on *every* turn, because the bug is a mid-conversation contradiction. |
| **T5 `recall.facts`** (6,000) | The natural home for the *his-clock half only* — `staleNote` already lives there and the block already says "a memory is not a live update". But it is rendered inside `api/memory.js`, it is gated on there being memories at all, and it would leave her day homeless. Named as the fallback if a new slot is refused. |
| **T9 `session.clock`** (300, undroppable, `not-yet-modeled`) | Budget is unspent, so it looks free. It is the wrong slot: `clock.ts`'s own header says that timer "speaks as the APP, never as her", because a statutory disclosure must never ride on a persona rule. Putting persona time-of-day into the legally-required disclosure note inverts exactly that. 300 chars is also a tenth of what is needed. |
| **T3 `india.dynamic`** | Gated on `relBundle`; renders nothing for a user with no rel-state, which is currently every user. |

**Position: immediately after T1 `inner.thread` and the watch note, before T2.**
Two separate mechanisms, used for the two separate pressures: *position* buys
survival under end-of-tail truncation (`api/chat.js` keeps the first N chars and
cuts the end), and *drop priority 1* is what handles budget pressure — the
block is a pure function of the clock, reconstructible and never
safety-relevant, so it should be the first thing shed.

**Manifest row and renumber** (drop priority 1 = first dropped, so everything
droppable shifts by one and `DropPriority` widens from 10 to 11):

```
{ id: "T14", label: "time.frame", budget: 1_600, dropPriority: 1, sourceStatus: "wired" }

T11 1→2 · T12 2→3 · T13 3→4 · mp.bridge 4→5 · T7 5→6 · T5 6→7 ·
T6 7→8 · T3 8→9 · T4 9→10 · T2 10→11
```

New tail total **22,800 of 24,000, headroom 1,200**.

**The lever, if 1,200 headroom is too thin:** set `MAX_TODAY_BEATS = 1` in
`timeline.ts`. Worst case drops by 108 chars, budget becomes 1,400, headroom
stays 1,400. The cost is that her day shows one earlier beat instead of two —
and `vy_agent_life` is empty today, so the cost is currently zero.

**Byte-identity is preserved the same way every other block preserved it:** add
one optional field to `CompileInput`.

```ts
// compiler.ts
timeFrame?: string;          // from timeline.ts's renderTimeFrame().text
...
if (input.timeFrame) tail += `\n\n${input.timeFrame}`;
_track("T14");
```

Absent ⇒ zero bytes ⇒ byte-identical for all 83 fixtures, exactly as
`relBundle`, `selfBundle` and `roomBundle` do it today.

### The two data tickets that go with it

1. **`api/memory.js` (not this workstream's file).** `opRecall` already selects
   the `meera_nodes` rows `staleNote` annotates. Map them to `TimeBoundFact`:
   `{id, name, kind, summary, saidAt: updated_at}` (no citation column exists
   there, so `cited` comes out false and the row still carries its
   "told N weeks back" provenance stamp). For `vy_fact`: `{summary: body,
   saidAt: created_at, dueAt: t_valid, citations}`. Also return `lastSpokeAt` —
   the last message of the *previous* conversation — which the caller can take
   from `meera_log` or from `vy_episode.ended_at`.
2. **Today's beats.** `life.ts`'s existing anti-join returns *untold* beats,
   which is a different question. Her day needs *today's* beats regardless of
   telling: `select at, beat, kind from vy_agent_life where agent_id = $1 and
   status = 'approved' and at <= now() and at >= (now() at time zone
   'Asia/Kolkata')::date` — cheap, indexed, and returns zero rows today.

---

## 5. `clock.ts` is deliberately unchanged

`src/engine/clock.ts` is this workstream's file and nothing in it moved. It is
the statutory session clock (CA SB 243 / NY disclosure cadence, China's 2h
break trigger, the §9.4 age-tier gate) and its `clockNote()` is T9 — "DATA,
telegraphic, ≤300 chars", app-voiced. The two clocks in this document are
persona content. Fusing them would put persona text on the code path that
exists to keep a legally required disclosure alive during a server outage. Not
a change worth the coupling; recorded here so the next reader does not have to
re-derive the reason.

---

## 6. Gates

`node evals/time/run.mjs` — DB-free, network-free, model-free, ~11s. Also
registered in `evals/run.mjs` as the `time` suite, so `verify-release.mjs`
runs it: `dead-writers` is this repo's law and it does not stop being true for
gate suites. That one-line addition is the only edit this workstream made to a
file it does not own; four other agents were running concurrently, so it is
flagged here rather than assumed harmless.

| suite | checks | headline numbers |
|---|---|---|
| `her.mjs` | 11 | two-minute test 7/7; continuity sweep **10,080 pairs, 0 jumps**; determinism 2,000 samples; 4 host timezones byte-identical; render sweep 1,442 blocks, 0 lint hits; worst case 763/735 chars vs 800/800 budgets |
| `his.mjs` | 12 | 10 horizon cases; `TIME_BOUND` parity with `api/memory.js`; 626 rendered rows with 0 state leaks and 0 gap mentions |
| `g1.mjs` | 6 | 15 structural source assertions (12 banned patterns + 3 shape checks); `MovedNote` affect-free; 0 interior writers import this module |
| `negative.mjs` | 13 | 6 baseline-clean controls + **7 injected defects, 7 caught** |

Plus `npx tsc --noEmit` and `node scripts/verify-release.mjs` (7/7).

### The negative control, because a green suite proves nothing on its own

`negative.mjs` mutates a copy of `timeline.ts` — never the tree; import
specifiers are rewritten to absolute paths and the mutant is bundled from a
temp dir — and runs the *same* predicates the real suites run:

| # | injected defect | caught by |
|---|---|---|
| 1 | mood word in a day note (G8) | `auditNotes` |
| 2 | variant seed drifts to per-minute — **literally the reported bug** | two-minute + continuity |
| 3 | a day note written as a recitable sentence | audit + render-shape |
| 4 | `gapMs` added to `HisFrame` and rendered (G1) | gap-unrenderable |
| 5 | `localStorage.setItem` appears (G1) | source-G1 |
| 6 | module-level `let` counter (G1: accumulation) | source-G1 |
| 7 | `herNow()` given a `gapSinceLastMs` parameter (G1) | source-G1 |

All seven are caught, and the unmutated module is verified clean against the
same six predicates first, so the control is two-sided.

---

## 7. What this deliberately does not do

- **No stored day state.** Not one byte. The moment her day is persisted it can
  drift between devices, needs a merge rule, and can be written by something —
  which is how `weekShape()`'s design was argued and it applies unchanged.
- **No mood.** G8. Her day says what time it is in her life; `inner.ts` owns how
  she feels about it, and owns it alone.
- **No proactive anything.** Neither clock opens a conversation, fires a
  notification, or gives her a reason to send a message. His clock only exists
  on a re-entry turn; her day only describes where she already is.
- **No measured behaviour claim.** Everything above is structural and
  deterministic and is gated as such. Whether she *reads* as having a timeline
  is a judged question at n≥84 that this workstream did not run — stated
  plainly rather than implied, per CLAUDE.md.
