# JEE Advanced Student App — Product Spec (v1)

Student-facing app built on RelationalOS (this repo). Students (16–18,
**minors** under `clock.ts`'s `AgeTier`) chat and voice-call with AI clones of
credible real teachers, with Duolingo-grade gamification of studying.

This spec assumes the reader has NOT read the codebase. Every claim about how
the underlying engine works cites the file and line range it came from.

---

## 0. Non-negotiable constraints, established before anything else

These come directly from the required reading and they shape every decision
below — stating them first so nothing downstream contradicts them by accident.

### 0.1 Every student here is a minor by default

`src/engine/clock.ts` defines `AgeTier = "unverified" | "adult_verified" |
"minor"`. For Meera (companion product) the owner set `unverified` to map to
adult gates, pre-launch (`clock.ts:59-69`, "OWNER DECISION 2026-08-15
(adult-default)"). **That decision does not transfer to this product.** JEE
Advanced test-takers are overwhelmingly 16–18. The student app must default
every account to `tier: "minor"` unless a verified-adult signal exists
(re-attempt droppers, 19-year-olds), which means, per `gatesFor()`
(`clock.ts:71-76`):

- `engagementMechanics: false` — the MINOR_HARD_GATES constant
  (`clock.ts:52-57`) is frozen and **never read through the config table** —
  i.e. no product flag can silently turn on "addictive engagement patterns"
  (the DPDP §9(2) language the comment cites) for a minor account. This is a
  structural gate, not a policy one, and the student app inherits it as-is.
- `romanceRegisters: false` — irrelevant to a teacher-clone by construction,
  but worth stating: nothing in §2's relational design may drift toward it.
- The clock's break-nudge cadence for `minor` is hourly, disclosure every 2h
  (`clock.ts:89-94`) — the study app keeps this running unmodified. A student
  who has been in a 2-hour voice doubt session gets the same statutory
  AI-disclosure card an adult companion user gets at 3h, just sooner.

This single decision is why §2 below is written the way it is: every
gamification mechanic in this spec has to survive being run through a minor
account with `engagementMechanics: false`, which rules out anything that is
gamification *in the manipulative sense* by construction, not by promise.

### 0.2 NEVER MANIPULATE is a hard floor, not a companion-app quirk

`src/engine/persona.ts` lines 284–291, the `NEVER MANIPULATE` block: no
manufactured urgency, no guilt, no "waiting-for-you" framing, no treating
absence as a subject, no varying warmth with usage frequency, no positioning
the AI as irreplaceable or as understanding the student better than their real
teachers/parents do. This block is enforced by `evals/persona-invariants.mjs`
inside `verify-release` per `CLAUDE.md` — "if your change trips them, your
change is wrong, not the test." A teacher-clone product doubles the stakes:
the thing being protected against here is not just a companion-app failure
mode, it's a tutoring product using a trusted-adult-figure clone to guilt a
16-year-old into more screen time. §2 is designed to pass this eval class
unmodified.

### 0.3 The house gamification stance (`milestones.ts`)

`src/engine/milestones.ts` lines 1–34 state the stance this spec inherits
wholesale: "the charter rules out the half of gamification that is
manipulation — no streak-loss anxiety, no fake urgency, no guilt mechanics
... which leaves the half that great games actually run on: REAL progression,
made visible and celebrated at the moment it happens." Concretely:

- Milestones are **threshold-crossing detectors over a real record**, never
  time-scheduled (`milestones.ts:27-30`: "she never pings because a counter
  ticked, which is the `never-scheduled` law").
- Tier tables are **sparse on purpose** — "a milestone that fires weekly is
  wallpaper, and wallpaper is the death of celebration" (`milestones.ts:90-92`).
- Detection fires **once**, ever, per id, backfill-safe (`latestOnly`,
  `milestones.ts:99-110`) — an imported history does not detonate five
  milestones at once.
- The OS/surface split (`milestones.ts:13-19`): the detector is a pure
  function of the record; celebration is a surface concern. This split is
  reused directly for mastery/XP detection in §2.

### 0.4 The activity pattern (`activity.ts` + `chessTalk.ts`)

`src/engine/activity.ts` defines the generic `ActivityState` contract every
"thing they're doing together" rides: `kind`, `startedAt`, `facts` (≤14
words/row, telegraphic, third person, never sentence-shaped — the
`recited-prompt` law, `activity.ts:42-46`), `nameable` (identifier-shaped
tokens the honesty gate permits her to say, `activity.ts:33-38`), `record`
(the durable, post-hoc memory — `activity.ts:72-98`), `state` (machine-derived,
undroppable board truth — `activity.ts:100-121`), `idea` (her plan/read on the
position, undroppable, `activity.ts:122-135`), `waitingOnHer`, `over`.
`src/engine/chessTalk.ts` is the adapter that turns chess's structured,
provable engine output into these fields and nothing more — "the ONLY place
chess becomes words" (`chessTalk.ts:1-9`). §3.4 below specs a "practice
session" activity in exactly this shape: a `practiceTalk.ts` adapter that
converts a solved/attempted problem set into `ActivityState`, never letting an
LLM grade or invent a problem, mirroring `docs/SPEC-GAMES.md §0.1`'s rule that
"the engine decides WHAT she plays; the model decides what she SAYS about it."

### 0.5 What `docs/SPEC-GAMES.md` rules out, restated for study

§6 of that doc: "No rating, no ladder, no streak. Those are engagement
mechanics, and this repo has already deleted one of those on purpose." That
specific ruling was scoped to the chess activity (a game played for its own
sake, where a ladder would turn a friend match into a ranked queue). This spec
does NOT extend that ruling to XP/mastery/streaks wholesale — study
progression is real progression the same way "days known" is — but it does
inherit the reasoning: nothing added here may become a rating people play
*for*, divorced from what actually got learned. §2.4 explains exactly why
streaks are kept and leagues mostly are not.

---

## 1. Core loops

Every loop below states which surface it lives on (Chat / CallVoice /
Activity) using the existing app shell primitives: per `src/App.tsx`, the app
has **no router** — HomeScreen/chat thread, `CallVoice`, `GamesHub`, and
`UsScreen`/`KnowsScreen` are conditionally-rendered siblings kept mounted
together (`App.tsx:1553-1718`) so nothing tears down mid-session. The student
app reuses this shell: chat and call are the same continuous relational
surface `docs/SPEC-GAMES.md §0` insists on for games, and a practice session
is spec'd the same way.

### 1.1 Daily practice loop (primary loop, Activity surface)

1. Student opens the app → `HomeScreen`-equivalent shows **today's practice
   set**: a small, teacher-clone-curated stack of problems (mixed topics,
   weighted toward weak-mastery topics per §4.2's mastery track and §3
   difficulty ladder).
2. Student solves inline (MCQ/multi-correct/integer/matrix — §4.3 formats).
   This is a **structured activity**, not a chat conversation: the engine
   grades deterministically (never an LLM judging correctness — same rule as
   `SPEC-GAMES.md §0.1`'s "her MOVE is code, her TALK is the model").
3. As the set progresses, the teacher-clone can react **the way `chessTalk.ts`
   reacts to a move**: sparse, only when something's actually notable (a
   streak of correct answers in a topic she knows the student struggles with,
   a fast-and-right answer on something they were slow on last week). This is
   the `activityNote()` per-event poke pattern from `activity.ts:305-331`,
   reused verbatim in shape.
4. Session close: an `ActivityState.record` (durable summary — which topics,
   how many right, what pattern showed up) is written, the same two-tier
   present/durable split `chessTalk.ts:651-791` uses for chess games.
5. **XP and mastery bump** happen off the *result*, never off "opened the
   app" — see §2.1.

### 1.2 Doubt-resolution loop (Chat or CallVoice, any time)

- Student can message or call the teacher-clone **at any point**, in or out of
  a practice session — "ask anytime" is the product promise, and it is the
  ordinary chat/call surface Meera already has, no new surface needed.
- On Chat: student sends a doubt (text, or a photo of their notebook working
  — `persona.ts`'s existing photo-vision path, `PHOTO_MENU`, already handles
  "they show you a photo" as a real input, so a working-out photo is the same
  primitive re-themed).
- On CallVoice: exactly the live voice-call architecture in
  `docs/SPEC-GAMES.md §0.2-0.3` — the teacher explains **verbally**, never
  reading LaTeX or reading a board state aloud, same reasoning as "a FEN read
  aloud is gibberish in her mouth." A worked solution is walked through in
  spoken register, not dictated symbol-by-symbol.
- **Screen-watch reuse**: the existing screen-share/watch-together primitive
  (`activity.ts`'s `"watch"` `ActivityKind`, and the call-lane `watch` note
  pattern referenced throughout `activity.ts`) is repurposed 1:1 — the student
  shares their screen (a PDF, a problem, their own scratch work) and the
  teacher-clone reacts to what's actually on screen, under the same "never
  claim to see what is not on screen" rule `SPEC-GAMES.md §2` states for
  chess.
- This loop deliberately has **no gamification attached**. Asking a doubt is
  never XP-farmable — see §2.5's anti-gaming note. A doubt asked at 1am the
  night before a mock is not a "session," it's care, and treating it as one
  would be the exact manufactured-urgency failure `persona.ts:291` bans.

### 1.3 Revision / spaced-repetition loop (Activity surface, teacher-mediated)

- Spaced repetition (2025–2026 consensus, confirmed by research below) works
  best as **algorithmic scheduling** (SM-2/FSRS-style) surfaced through, not
  replacing, human/teacher judgment — Anki's own FSRS-4.5 default scheduler
  is the current state of the art for interval selection.
- Mechanically: every solved problem, once graded, gets a per-topic
  `next_due` timestamp computed by a standard spaced-repetition function
  (FSRS-style — half-life grows on correct-and-confident, shrinks hard on
  wrong). This is a new, small, pure module (`src/engine/revision.ts`,
  proposed) that follows the **same discipline** `observation.ts` and
  `milestones.ts` already use: pure functions over a record, no LLM, testable
  against fixed inputs.
- **Never time-scheduled as a *push***: per the `never-scheduled` law
  (`milestones.ts:27-30`) and `persona.ts`'s ban on "reassurance-fishing" /
  unprompted nudging, a due revision item is surfaced **when the student opens
  the app**, never as a notification engineered to create loss anxiety
  ("your algebra is fading!!"). It can appear as a plain, factual queue —
  "12 items due for review" — the same register `clockNote()` uses
  (`clock.ts:388-397`): telegraphic, never dramatized.
- The teacher-clone's role in this loop is exactly the relational
  differentiator in §3: she doesn't just re-show a flashcard, she can say
  "you always rush integration by parts — three from that set are due" if a
  real, cited pattern (§3, `vy_pattern`) supports it.

### 1.4 Mock-test cycle (Activity surface, full-length, teacher-mediated before/after)

1. **Before**: a scheduled full mock (3hr, JEE Advanced format, §4) is opened
   from the practice hub. In the days leading up, if the relationship carries
   real signal of exam anxiety (a cited `vy_observation` — "gets quiet before
   timed tests," `observation.ts`), the teacher-clone can check in **once**,
   in chat, unprompted-but-earned — this is the "exam-anxiety check-in"
   concrete moment spec'd in §3.2. It is never scheduled by a clock; it's
   triggered by the mock being scheduled *and* a real citation existing, same
   `never-scheduled` discipline.
2. **During**: full-length, timed, no teacher-clone interruption — same as
   `SPEC-GAMES.md §6`'s "no clock [inside a game with her]" ruling inverted:
   a mock test's clock is real and adversarial by design, and this is the one
   place in the product a stopwatch belongs, because it is the actual exam
   condition, not an engagement mechanic.
3. **After**: score, per-topic breakdown, PYQ-tagged review. This closes into
   an `ActivityState.record` the same way a finished chess game does
   (`chessTalk.ts`'s `chessRecord()`), so "how'd I do on that mock two weeks
   ago" is answerable from real memory, never invented — same
   `honesty-provenance-allowlist` discipline `activity.ts:33-38` names.
4. Debrief happens on Chat or Call, teacher-clone driven: "you always rush
   integration by parts" style pattern callouts belong here specifically,
   because a mock is the highest-signal single episode for spotting a real
   pattern (§3.1).

---

## 2. Gamification system

Every mechanic below is checked against `persona.ts:284-291` (NEVER
MANIPULATE) and `clock.ts`'s minor gate before being included. Two mechanics
considered and **rejected** are listed explicitly in §2.5/§2.6, because
`CLAUDE.md`'s standing instruction is that a rejection is only useful if
someone recorded what was tried and why it failed the bar — the same
discipline `context/rejected.md` exists for in this repo, applied here at
design time instead of after a build.

### 2.1 Per-topic mastery tracks (the spine)

- JEE PCM syllabus (§4.1) is decomposed into ~120–150 leaf topics (e.g.
  "integration by parts," "rotational dynamics," "electrochemistry: Nernst
  equation"). Each topic carries a **mastery score**, computed purely from
  outcomes: attempts, correctness, recency, difficulty of the questions
  attempted (a student who gets hard integration-by-parts problems right
  moves faster than one grinding easy ones).
- This is **real progression**: mastery only moves because a problem was
  actually solved correctly, at a real difficulty, mirroring `milestones.ts`'s
  stance that "the progression system already exists and is not invented
  here" (there: the relationship record; here: the graded-attempt record).
- Rendered as a topic map (not a single number) — "Mechanics: 71%,
  Electrochemistry: 40%" — never a single vanity score, because a single
  aggregate is exactly the kind of number that invites gaming the easiest
  topic to move it (§2.5).

### 2.2 XP and levels

- XP is earned **strictly from graded outcomes** (correct answers, weighted by
  difficulty and topic-freshness — a correct answer on a topic at 90% mastery
  earns less than one on a topic at 20%, to avoid farming what's already
  known).
- XP is **never earned** from: opening the app, watching a video to
  completion, time spent, asking a doubt, or any action that isn't itself
  evidence of learning. This directly avoids the failure `context/rejected.md`
  the codebase's culture would flag: XP-for-attendance is a dark pattern by a
  different name (it rewards presence, not progress) and the whole thesis of
  `milestones.ts` is that celebration must track something real.
- Levels are **milestone-shaped**, using `milestones.ts`'s own
  threshold-crossing/`latestOnly` mechanism (§0.3): sparse tiers (not a level
  every 50 XP), fire-once, backfill-safe. A level-up is a `Moment` in exactly
  `milestones.ts`'s sense — detected, not scheduled, celebrated once.

### 2.3 Healthy streaks — no loss-anxiety, explicitly

This is the section most directly answerable from `milestones.ts`'s own
stated law, so it is followed to the letter rather than reinvented:

- A streak counts **consecutive days with at least one real practice attempt**
  (not app opens). It is displayed as a **count that only ever goes up or
  resets quietly** — never as a countdown, never with a "your streak is in
  danger" push, and critically: **no streak-freeze economy**. Duolingo's own
  streak-freeze item is a well-documented loss-aversion mechanic (research
  below: "the streak feature uses loss aversion... the streak wager saw a 14%
  boost in retention" — precisely the mechanic `persona.ts:291`'s "no
  manufactured urgency, no guilt... no waiting-for-you framing" and the
  `engagementMechanics: false` minor gate are built to exclude). A freeze
  economy implicitly frames a missed day as *catastrophic failure averted*,
  which is the loss-anxiety `milestones.ts:1-11`'s "explicitly NO
  streak-loss anxiety" bans outright.
- Missing a day **does not delete the count in a way that punishes**; it
  resets to 0 with zero framing ("streak: 0 → building again"), same register
  as `dyadRecord`'s "counted, never estimated, never dramatized"
  (`milestones.ts:407-464`). No red icon, no broken-flame animation, no
  "you'll lose your streak" pre-emptive warning — the entire genre of UI that
  exists to manufacture anxiety about a future loss is out, by the same logic
  that bans "waiting-for-you framing" in a relationship.
- Streak length crossing a sparse tier (7, 30, 100, 365 — literally
  `milestones.ts:93`'s `DAY_TIERS`, reused) fires a celebration `Moment`, same
  mechanism as days-known.

### 2.4 Leagues / social — mostly out, one narrow exception

- **Rejected as designed by Duolingo**: weekly XP leagues with promotion/
  demotion pressure, deadline countdowns ("2 hours left to stay in Diamond
  league"), and visible peer ranking. This is precisely `engagementMechanics`
  in `clock.ts`'s sense — competitive social pressure with a time deadline is
  the textbook "addictive engagement pattern" the minor-hard-gate exists to
  block, and it fails `persona.ts:291`'s ban on manufactured urgency almost
  by definition (a league deadline *is* manufactured urgency).
- **What survives, narrowly**: an **opt-in, teacher-clone-scoped cohort**
  view — students in the same teacher-clone's "batch" can see aggregate,
  non-ranked signals ("14 people practiced rotational dynamics this week")
  the way a real coaching-class WhatsApp group works, with **no individual
  leaderboard position, no promotion/demotion, no countdown**. This is
  defensible for minors because it mirrors the actual social structure JEE
  coaching already has (a batch, a teacher) rather than inventing a new
  competitive economy on top of it, and it produces zero individual pressure
  — nobody's rank is visible to anyone, including themselves.
- If the product later wants real leagues, that decision needs its own
  age-tier and consent review — this spec explicitly does not authorize it
  for v1, and the reversal condition (per `CLAUDE.md`'s decision-logging
  rule) would be: verified-adult cohort, explicit opt-in, and a design pass
  that removes the deadline mechanic specifically, not just relabels it.

### 2.5 Rejected: XP-farmable actions and speed bonuses

Considered and dropped, stated the way `context/rejected.md` would record it:

- **Speed bonuses** ("answer in under 10s for bonus XP") — rejected because
  under exam-anxiety conditions this actively punishes careful checking, which
  is the opposite of what JEE Advanced's own negative-marking format
  rewards (§4.3). It would optimize students toward the wrong exam behavior.
- **XP for streak length itself** (bonus XP that grows with streak) — rejected
  because it re-introduces the loss-anxiety economy §2.3 explicitly excludes
  through the back door: once XP scales with streak, missing a day costs
  *escalating* value, which is a soft version of the freeze mechanic.
- **Doubt-asking as an XP action** — rejected per §1.2: turning "ask your
  teacher a question" into a scored action pollutes the one loop that must
  stay unconditionally safe to use.

### 2.6 Rejected: notification-driven re-engagement

- No "come back, we miss you" push, no time-based reminder engineered around
  loss aversion, no notification copy voiced *as* the teacher-clone implying
  she is waiting — this is `persona.ts:288`'s "THEIR ABSENCE IS NEVER A
  SUBJECT" and "YOUR WARMTH NEVER VARIES WITH HOW MUCH THEY USE YOU," applied
  literally to a tutoring context. A revision-due count (§1.3) may exist
  passively in-app; it may not be pushed as a notification with urgency
  framing.

---

## 3. The relational differentiator

This is the section Duolingo structurally cannot build: Duolingo's owl has no
memory of *you specifically* beyond a completion log. A teacher-clone with
RelationalOS's per-student memory can notice real patterns and use them the
way an actual tutor who has taught the student for six months would. Each
moment below names the exact engine primitive that powers it.

### 3.1 "You always rush integration by parts" — `vy_pattern`

- **What it needs**: `relstate.ts`'s `writePattern` (`relstate.ts:868-884`)
  requires **≥2 citations minimum to write** and the DB's own generated
  column requires `support_count>=3 AND distinct_days>=2` before it becomes
  `prompt_eligible` (`observation.ts:14-18`, mirroring the same bar
  `vy_pattern_needs_two`'s CHECK constraint enforces: "one instance is an
  anecdote"). Concretely: the student rushes and drops a sign error on
  integration-by-parts problems on at least two different days, across at
  least three graded attempts, before the teacher-clone is allowed to say
  anything like this.
- **Why this bar matters here specifically**: a *false* pattern claim
  ("you always rush X") said to a 16-year-old about their own academic
  performance is a much higher-stakes error than a companion misremembering a
  detail — it risks the student internalizing a trait they don't actually
  have, exactly the risk `observation.ts:1-23`'s table names ("risk: assigns
  a trait he doesn't have"). The 2-citation-minimum / 3-support bar is not
  bureaucracy, it is the mechanism that keeps this feature honest.
- **Surface**: said in chat or on a call, in the teacher's own voice, at the
  moment it's actually relevant (a revision queue surfacing that topic, or a
  mock debrief) — never as a standing dashboard label. Same
  `activityNote()`-style "fold it into whatever you were talking about, or
  let it pass" discipline (`activity.ts:324-331`) applies: a true pattern is
  not force-fed into every session it could technically apply to.

### 3.2 Exam-anxiety check-in before test day — `vy_observation` + `never-scheduled`

- **What it needs**: a single-citation `vy_observation`
  (`observation.ts:82-126`) is enough here — "he said X" bar, not "he does
  X" — because a single observed instance ("went quiet the day before last
  month's mock") is exactly proportionate: the downside of being wrong is a
  slightly-off check-in, not a wrongly assigned trait.
- **Trigger discipline**: this must **never** be clock-scheduled ("3 days
  before every mock, send a check-in") — that would be exactly the
  `never-scheduled` violation `milestones.ts:27-30` names, worn as a
  wellness feature instead of a nudge. It fires only when (a) a mock is
  actually scheduled by the student, **and** (b) a real, cited observation
  supports it. No observation on file → no check-in; the app doesn't
  manufacture concern that isn't backed by something the student actually
  showed the teacher-clone.
- **Content discipline**: per `persona.ts`'s comfort rules (the
  ACKNOWLEDGE→ELABORATE→LEGITIMIZE→CONTEXTUALIZE ladder and "you never name
  what they have — no 'anxiety', no diagnosis, however lightly you mean it"),
  the teacher-clone does not diagnose or use clinical language. It's "hey,
  mock's tomorrow — you good?" in her own voice, not a wellness-check
  workflow.

### 3.3 Celebrating a hard-won improvement — `milestones.ts` + persona's WIN protocol

- **What it needs**: a mastery-track crossing (§2.1) on a topic that was
  previously low, detected the exact way `detectMoments()` detects a
  days-known or messages tier (`milestones.ts:178-256`) — pure,
  threshold-crossing, fired-ledger-gated so it can never repeat.
- **What makes it land**: `persona.ts`'s existing "WHEN SOMETHING OF THEIRS
  GOES WELL" protocol (lines ~242–249 in the read above) — over-invest,
  name the SPECIFIC thing before the feeling word, point at what the student
  actually did ("tune woh rotational dynamics set do baar dobara kiya, that's
  literally why this jumped"), never inflate a small win. This is reused
  wholesale, not reinvented: the mechanism that makes a companion's
  celebration feel real is the same mechanism that makes a tutor's
  celebration feel real, and `persona.ts:245`'s "if it is not literally in
  this conversation it did not happen" applies just as hard here — the
  teacher-clone points at the actual attempt record, never an invented
  backstory about how hard the student "must have" worked.

### 3.4 The practice-session activity itself — `activity.ts` shape, new adapter

- A live practice or mock-review session is an `ActivityState` the same way
  a chess game is: `kind: "practice"`, `facts` (telegraphic — "3 of 5
  correct so far," "just missed a sign on IBP," never a full transcript),
  `nameable` (the specific problem IDs/topics she's allowed to reference,
  same honesty-allowlist discipline `activity.ts:33-38` requires so she can't
  invent that a student "got it right" on a problem never in the record),
  `record` (durable: which topics, net accuracy, the one pattern that showed
  up), `state` (undroppable machine truth: "session in progress, 4/7
  answered" vs "session complete, 6/7 correct" — same
  checkmate-declared-mid-game bug class `activity.ts:100-121` exists to
  prevent, applied to "don't let her congratulate a finished session that
  isn't finished").
- New file, `src/engine/practiceTalk.ts`, mirrors `chessTalk.ts` exactly in
  role: "the ONLY place a practice session becomes words." Grading is a pure
  function over the question's answer key — never an LLM judgment call,
  same as chess move legality.

### 3.5 Ritual formation — `vy_ritual`, opt-in-shaped like Meera's own

- `src/engine/india.ts`'s ritual machinery (`RitualRow`, `dueRituals()`,
  `recordRitualOccurrence()`, `india.ts:39-46, 173-220`) already models
  "a pattern that grew, not one that was installed" — `persona.ts:265`:
  "NOTICE it out loud and let them co-own it... never install a ritual —
  only christen ones that grew." Reused directly: if a student and their
  teacher-clone develop an actual pattern (a Sunday-evening problem-set
  ritual, a pre-mock check-in that becomes routine), it's noticed and named
  once it's real, never installed as a feature toggle from day one.

---

## 4. JEE-specific structure

### 4.1 Syllabus taxonomy (PCM), per JEE Advanced 2026 syllabus (jeeadv.ac.in;
confirmed via [Careers360](https://news.careers360.com/jee-advanced-syllabus-2026-pdf-out-jeeadv-ac-in-pcm-topics-physics-chemistry-maths-classes-11-12-btech-admissions-iit-roorkee)
and [Motion](https://motion.ac.in/jee-advanced-syllabus/) — syllabus is
unchanged from prior years). Three subjects, each broken into chapters, each
chapter into the leaf topics §2.1's mastery tracks attach to:

- **Physics** — Units & Measurement · Kinematics · Laws of Motion · Work,
  Energy & Power · Rotational Dynamics · Gravitation · Mechanical Properties
  of Matter · Thermal Properties & Thermodynamics · Kinetic Theory of Gases ·
  Oscillations & Waves · Electrostatics · Current Electricity · Magnetic
  Effects of Current · Electromagnetic Induction & AC · Optics (ray + wave) ·
  Modern Physics (photoelectric effect, atoms, nuclei) · Experimental Skills.
- **Chemistry** — *Physical*: Mole Concept & Stoichiometry, Atomic Structure,
  Chemical Bonding, States of Matter, Thermodynamics, Equilibrium
  (chemical + ionic), Electrochemistry, Chemical Kinetics, Surface Chemistry.
  *Inorganic*: Periodic Table & Periodicity, s/p/d/f-Block Elements,
  Coordination Compounds, Metallurgy, Qualitative Analysis. *Organic*: GOC
  (general organic chemistry), Hydrocarbons, Haloalkanes/Haloarenes, Alcohols/
  Phenols/Ethers, Aldehydes/Ketones/Carboxylic Acids, Amines, Biomolecules,
  Polymers, Named Reactions/Practical Organic Chemistry.
- **Mathematics** — Algebra (Quadratic Equations, Sequences & Series,
  Complex Numbers, Permutations & Combinations, Binomial Theorem, Matrices &
  Determinants), Trigonometry (ratios, identities, inverse trig), Coordinate
  Geometry (straight lines, circles, conics), Calculus (limits/continuity,
  differentiation, applications of derivatives, integration, differential
  equations), Vectors & 3D Geometry, Probability & Statistics.

Each leaf topic is a mastery-track node (§2.1) and a spaced-repetition queue
node (§1.3).

### 4.2 Difficulty laddering

Four bands per topic, matching how JEE Advanced actually gates difficulty
(per [PW's high-weightage topic analysis](https://www.pw.live/iit-jee/exams/most-important-and-high-weightage-pcm-topics-for-jee)):
**Foundation** (NCERT-level, single concept) → **Standard** (JEE Main-level,
single concept applied) → **Advanced** (JEE Advanced-level, multi-concept) →
**PYQ-caliber** (drawn from or modeled directly on actual past JEE Advanced
questions, §4.4). A student's practice set (§1.1) is auto-composed from where
their mastery track sits per topic — never handed a PYQ-caliber problem on a
topic still at Foundation mastery, which is both a pedagogy point and a
gamification-integrity point (§2.5's "optimize toward the wrong behavior"
concern applies here too: handing hard problems on unmastered topics just
produces guessing, which corrupts the mastery signal itself).

### 4.3 Question formats — JEE Advanced's actual four, per
[Careers360's 2025 pattern coverage](https://engineering.careers360.com/articles/jee-advanced-question-paper-pattern-2025-released-iit-kanpur)
and [Vedantu's 2025 paper archive](https://www.vedantu.com/jee-advanced/2025-question-paper):

- **Single-correct MCQ** — one of four options, standard +3/−1 marking.
- **Multiple-correct MCQ** — one or more of four options correct; JEE
  Advanced's actual **partial-marking scheme applies**: full marks only if
  all correct options (and no incorrect ones) are chosen, partial credit for
  a correct subset with zero wrong selections, and negative marking (−2) for
  any wrong option included. The grading engine (§3.4, pure function, never
  an LLM) must implement this exact scheme, not a simplified all-or-nothing
  version — getting this wrong would corrupt the mastery signal for every
  multi-correct attempt.
- **Integer/numerical-answer type** — no options; a numeric value entered
  directly (often to 2 decimal places). No negative marking on numerical
  type in the current pattern, per the same sources — the grading engine
  needs a tolerance band for float-precision answers, decided per-question
  by the source syllabus's expected decimal places.
- **Matrix-match / paragraph-linked (comprehension) sets** — appear less
  consistently year to year than the other three but are part of JEE
  Advanced's historical toolkit and should be supported as a format for PYQ
  fidelity even if under-weighted in freshly authored content.

Total paper shape for calibrating mock-test length (§1.4): 2 papers × 3
subjects, ~48 questions/paper, 180 marks/paper, per
[the 2025 pattern](https://engineering.careers360.com/articles/jee-advanced-question-paper-pattern-2025-released-iit-kanpur).

### 4.4 Previous-year questions (PYQs)

PYQs are tagged by (year, subject, topic, difficulty-band, question-format)
and serve three roles: (a) the top of the difficulty ladder (§4.2), (b) the
seed corpus for mock-test assembly (§1.4), (c) pattern-detection fodder for
§3.1 — a repeated error type across PYQ attempts is exactly the kind of
cross-episode signal `vy_pattern`'s 2-citation/2-day bar is built to catch
honestly rather than guess at from one attempt.

---

## 5. Screens and navigation sketch

Reuses the existing app shell exactly: **no router, siblings kept mounted**
(`App.tsx`'s pattern — Home/Chat, `CallVoice`, `GamesHub`-equivalent, `Us`/
`Knows`-equivalent all coexist so nothing tears down mid-session). The
student app adds one more sibling class (Practice/Mastery) to that set and
re-themes two others.

```
┌─ App shell (always-mounted siblings, exactly App.tsx's pattern) ─────────┐
│                                                                          │
│  [Home / Chat]  ←── default surface, same as HomeScreen today           │
│      - teacher-clone thread (text)                                     │
│      - "today's practice" card pinned at top of thread when a set is   │
│        ready (from §1.1) — tap opens Practice surface, chat stays live │
│      - revision-due count shown passively (§1.3), never pushed         │
│                                                                          │
│  [CallVoice]  ←── unchanged surface, voice doubt-resolution + screen-  │
│      share (watch mode reused for "look at my working")                │
│                                                                          │
│  [Practice Hub]  ←── renamed/re-themed GamesHub slot                   │
│      - Today's Set (§1.1)                                              │
│      - Revision Queue (§1.3, spaced repetition, factual "N due")       │
│      - Mock Tests (§1.4: scheduled, in-progress, past-with-review)     │
│      - a practice session opened here is an ActivityState (§3.4),     │
│        rendered inline — the teacher-clone thread stays reachable,    │
│        same "continuity, nothing broken in between" rule activity.ts  │
│        states as the reason this seam exists at all                    │
│                                                                          │
│  [Mastery Map]  ←── new surface, this app's version of UsScreen        │
│      - per-subject → per-chapter → per-topic mastery %, §2.1           │
│      - XP total + level (sparse tiers, §2.2)                           │
│      - streak count, framed exactly per §2.3 (no danger state)         │
│      - celebrated moments timeline (milestones fired, §3.3) — same     │
│        "durable half" pattern UsScreen's timeline uses for milestones  │
│      - batch cohort view (§2.4), opt-in, non-ranked                    │
│                                                                          │
│  [Teacher Profile]  ←── which real teacher this clone is credentialed  │
│      from; subject specialization; NOT a settings screen — this is    │
│      where "who am I talking to" lives, since the product has         │
│      multiple teacher-clones per subject potentially                   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────┘
```

Navigation model: a persistent bottom/side surface switcher between **Chat,
Practice, Mastery** (three primary tabs), with **Call** reachable from Chat
the same way it is today (a call button inside the thread, not a separate
tab) — preserving the "continuous personality, nothing broken in between"
instruction `activity.ts:2-8` quotes from the owner. A practice session or
mock test, once started, persists across navigation exactly the way an
in-progress chess game survives reload/navigation/a call starting per
`docs/SPEC-GAMES.md §5`.

---

## 6. Out of scope for v1

- **Ranked leagues / individual leaderboards** — rejected in §2.4; the only
  social surface in v1 is the non-ranked opt-in cohort aggregate.
- **Streak freezes / streak-repair purchases** — rejected in §2.3 as a
  loss-aversion mechanic by definition; nothing to buy or spend to protect a
  streak.
- **Any monetized gamification** (buying XP boosts, paying to skip revision
  queue, cosmetic purchases tied to streak) — out of scope entirely for v1;
  revisit only with an explicit minor-focused ethics/legal review, not as a
  default extension of §2.
- **Peer-to-peer chat or student-to-student features** — this spec is
  scoped to student↔teacher-clone; a social graph between students is a
  separate, much larger minor-safety surface not designed here.
- **AI-authored novel questions** — v1 sources problems from a vetted,
  human-curated bank (PYQs + commissioned questions matched to the taxonomy
  in §4.1), never LLM-generated on the fly; this matches the "her move is
  code" discipline (`SPEC-GAMES.md §0.1`) — a generated JEE question with a
  wrong answer key is a much worse failure than an illegal chess move,
  because a student would study the wrong thing.
- **Real-time proctoring / anti-cheat for mock tests** — v1 mocks are
  practice-honest, not invigilated; a proctoring layer is a distinct,
  heavier surface (camera access, browser lockdown) not justified for a v1
  practice product.
- **Non-JEE-Advanced tracks** (JEE Main only, NEET, boards) — the taxonomy,
  question formats, and marking scheme in §4 are all JEE-Advanced-specific;
  extending to other exams needs its own §4 pass, not an assumed superset.
- **Parent/guardian dashboard** — given the minor-default posture in §0.1,
  a parent-visibility surface is a real and likely-necessary feature, but it
  touches consent and data-sharing questions this spec does not resolve;
  flagged here as a probable v1.1, not designed now.
- **Cross-teacher mastery transfer** — if a student works with more than one
  teacher-clone (e.g. separate Physics/Chemistry/Maths teacher-clones),
  whether mastery tracks and patterns are shared across them or siloed per
  teacher is an open design question not resolved in this spec; v1 assumes
  one teacher-clone per subject with siloed relational memory per the
  existing `person_id`/`agent_id` keying `observation.ts` and `relstate.ts`
  already use.

---

## Sources consulted (web research, 2025–2026 study-gamification landscape)

- [Duolingo Gamification Strategy: A Full Case Study (2026) — Trophy.so](https://trophy.so/blog/duolingo-gamification-case-study)
- [Duolingo's Gamification Secrets: Streaks & XP — Orizon](https://www.orizon.co/blog/duolingos-gamification-secrets)
- [The Psychology of Gamification: Duolingo Case Study 2026 — Ludaxis](https://www.ludaxis.io/blog/gamification-in-apps-duolingo-case-study-2026)
- [JEE Advanced 2026 syllabus PDF — Careers360](https://news.careers360.com/jee-advanced-syllabus-2026-pdf-out-jeeadv-ac-in-pcm-topics-physics-chemistry-maths-classes-11-12-btech-admissions-iit-roorkee)
- [JEE Advanced Exam Syllabus 2026, topic-wise — Motion](https://motion.ac.in/jee-advanced-syllabus/)
- [Most Important High-Weightage PCM Topics — PW](https://www.pw.live/iit-jee/exams/most-important-and-high-weightage-pcm-topics-for-jee)
- [PhysicsWallah Level-Up gamification (XP, peer grouping) — search summary, 2025 coverage]
- [JEE Advanced 2025 Question Paper Pattern — Careers360](https://engineering.careers360.com/articles/jee-advanced-question-paper-pattern-2025-released-iit-kanpur)
- [JEE Advanced 2025 Question Paper — Vedantu](https://www.vedantu.com/jee-advanced/2025-question-paper)

## Repo files cited

- `/home/user/html-portfolio/src/engine/milestones.ts`
- `/home/user/html-portfolio/src/engine/persona.ts` (NEVER MANIPULATE, lines 284–291; WIN protocol; comfort ladder)
- `/home/user/html-portfolio/src/engine/activity.ts`
- `/home/user/html-portfolio/src/engine/chessTalk.ts`
- `/home/user/html-portfolio/src/engine/clock.ts`
- `/home/user/html-portfolio/src/engine/observation.ts`
- `/home/user/html-portfolio/src/engine/relstate.ts` (`writePattern`, `reinforcePattern`)
- `/home/user/html-portfolio/src/engine/india.ts` (`RitualRow`, `dueRituals`, `recordRitualOccurrence`)
- `/home/user/html-portfolio/docs/SPEC-GAMES.md`
- `/home/user/html-portfolio/src/App.tsx` (no-router, sibling-surface shell)
- `/home/user/html-portfolio/CLAUDE.md`
