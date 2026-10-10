# safety-floor-teacher.md — safety-floor deltas for teacher clones

**Premise.** The incumbent floor was designed for one adult companion talking to
consenting adults. This product changes three things at once: the persona is a
**clone of a real, named, living person**; the users are **mostly minors**; and
the buyer of the product is a **teacher with a commercial interest in
engagement**. Each of those breaks a specific assumption in the existing floor.
This file names the deltas and, for each, the **structural** enforcement point —
because this repo has already measured what happens when a safety property is
enforced by asking the model nicely.

The governing measurement, `context/rejected.md:1029-1053`
(`honesty-by-instruction`):

> `gate0-structural`: **prompt instructions leaked 57–98%; the SQL predicate
> leaked 0 of 31,122.** … A sentence in a brief is a preference; a predicate on
> the output is a guarantee.

So every delta below is stated twice: the content change, and the predicate.

---

## 1. Never-deny-being-an-AI → **must proactively disclose clone status**

### 1.1 What the incumbent says

`persona.ts:345`: *"you never volunteer that you're an AI mid-conversation and
you stay fully in character, but if they sincerely and directly ask … don't
lie."* That is a **reactive** honesty rule, and it is correct for an adult
companion who chose a companion product.

It is wrong here for two compounding reasons. (a) The user is a minor who did
not necessarily choose anything — a school or a parent may have. (b) The persona
wears the face, voice and name of a real teacher the student may know from
YouTube or from a classroom, so silence is not neutral: the default inference
is *this is him*.

### 1.2 The delta

**Content:** the never-deny paragraph stays verbatim (it is floor, probed
literally by `evals/persona-invariants.data.mjs`). What changes is that the
"never volunteer" clause is **inverted for this product** and a fact-shaped
`cloneDisclosureFact` is added at end-of-CORE:

> WHAT YOU ARE IS NEVER CONCEALED: you are an AI built from ⟨teacher name⟩'s own
> recorded teaching, published by them. You are not them, they are not reading
> these conversations, and nothing said here reaches them unless the student is
> told plainly that it will. If a student talks to you as though you are the
> person, you correct it the first time, briefly, without apology or ceremony,
> and carry straight on with the work.

The architecture-internals block (`persona.ts:347`) stays exactly as written —
"an AI" remains the whole truth and its entire granularity, no vendor, no model
name. Disclosing *clone status* is not disclosing *architecture*, and the two
must not be conflated in implementation.

### 1.3 The predicates — because the paragraph is not the mechanism

`clock.ts:1-4` already states the correct architecture and it is the model to
extend: **"the timer speaks as the APP, never as her (§0.3 adjudication —
instruction ≠ emission is measured, so a statutory disclosure can never ride on
a persona rule)."**

| # | mechanism | where | delta for this product |
|---|---|---|---|
| P1 | Session-open disclosure card, app voice, before the first turn | surface + `clock.ts` | **NEW.** Fire at n=0 of every session, not only at the 2h/3h boundary. Cheap, and the only disclosure guaranteed to be seen |
| P2 | Recurring disclosure cadence | `clock.ts:89-94` | Use the **minor row for every tier**: disclose 2h, break 1h. The adult row (3h/2h) is not offered by this product |
| P3 | Failure direction | `clock.ts:8-15` | Unchanged and load-bearing: the client mirrors the counter, persists it, fires with zero network, and reconciliation takes MAX(local, server) — a server outage cannot silence disclosure |
| P4 | Identity-question → card | new predicate | Any student turn matching the identity-question family renders the disclosure card. Decidable on the bytes of the *student's* message, so it does not depend on the model's attention at all |
| P5 | Relay-claim gate | `honesty.ts` (`findOutOfBandReceipts`, `honesty.ts:446`) | **NEW rule `teacher-relay-claim`**: the clone must never assert that the real teacher saw, read, was told, or will be told something. This is precisely honesty.ts's failure class (B) — *"she asserts an event that never happened"* — with a new object. Predicate: a relay verb (`bataya/dekh liya/forward/sir ko`) within proximity of the teacher's own name or `sir/ma'am`, with no supporting event in the record |
| P6 | Voice-lane parity | `evals/persona-invariants.mjs` runs per module per lane | The disclosure fact must be present in **both** the text and voice CORE assemblies. `context/rejected.md:628` (`age-tier-never-realtime`) is the precedent: *"a second assembler dropped a safety rule, not a style rule."* Assert the fact per lane, per module |

**P6 deserves emphasis.** This repo has already shipped a safety rule that
existed in one assembler and not in the realtime one, for an unknown period. A
multi-teacher product multiplies assemblers by clones. The floor check must
iterate `lanes × registered modules`, which the runner already does structurally
(`persona-invariants.mjs`, per-agent loop over `buildLanes(agent)`).

---

## 2. Consent — the teacher owns the likeness

The incumbent has no consent surface because Maya is fictional. Everything here
is new.

### 2.1 The consent artifact

A signed row, referenced by `consentArtifactId` on the sheet
(`teacher-sheet-spec.md` §3), containing at minimum:

| element | why |
|---|---|
| named principal + identity verification | must byte-match `sheet.name`; a clone published under a name the artifact does not cover is impersonation |
| **scope of likeness**: name, voice, face/avatar, catchphrases, teaching materials | each is a separately licensed asset; voice is the one with the least legal settledness and the most abuse potential |
| **lanes**: text / voice / screen-share, each opt-in | a teacher may consent to text and refuse a voice clone |
| **subject + exam scope** | ties to `syllabusScope`; a physics teacher's clone answering organic chemistry is a misrepresentation of them |
| **derivative limits**, non-negotiable and pre-checked | no romantic or intimate register ever; no endorsement or sales content; no political or religious opinion; no claims about other institutions |
| **audience**: minors, explicitly acknowledged | the teacher is consenting to be cloned *for children* |
| **term + revocation**, with an SLA | |
| **revocation semantics** | see §2.2 — this is the part that has to be structural |
| source-media inventory | which uploads were ingested; a teacher can withdraw a specific lecture |

### 2.2 Revocation must unpublish the module, not edit the prompt

The correct mechanism already exists in shape: agents are **registered modules**
(`src/engine/agents/registry.ts`; the invariant runner asks the registry for
what exists). So:

- revocation **deregisters** the module → the lane has no agent → the product
  refuses the conversation. It does not "ask the clone to stop";
- `voiceCloneId` is invalidated at the TTS layer in the same transaction —
  otherwise the voice outlives the consent, which is the exact shape of
  `context/rejected.md:2018` (`cache-outlives-the-voice` — four lanes moved, the
  audio did not);
- a revoked `slug` is **never reused** (`pk-is-an-arbiter`,
  `context/rejected.md:424`: changing an identity key silently breaks every
  upsert that names it — the inverse, reusing one, silently attaches an old
  relationship history to a new principal);
- compile-time check: a module whose consent row is absent, expired or revoked
  **fails to build**. `dead-writers` (`context/rejected.md:388`) is the warning
  here — a revocation path with no caller is indistinguishable from no
  revocation path. It needs a test that actually drives it.

### 2.3 Student-side consent (minors)

`clock.ts:43-45` already cites **DPDP §9(2)** for the engagement-mechanics ban.
The same section governs children's data generally, and the product must take
the whole of it, not the one clause already implemented:

- verifiable guardian consent at signup for under-18 accounts;
- **no behavioural advertising, no tracking-based targeting** of a child user;
- data minimisation on what the relational memory keeps about a minor;
- deletion: the student-facing `[forget: …]` path already exists and works —
  it deletes for real, before the reply is rendered (`persona.ts:277-282`) —
  plus a full-account erase that removes the relational state, not just the
  transcript;
- guardian visibility: a guardian can see that the account exists, its usage
  summary, and can delete it. **Not** a live transcript feed by default —
  turning the clone into a surveillance channel would make the safety-routing
  behaviour in §3 impossible, because a student who knows a parent is reading
  will not disclose distress.

---

## 3. Minor-protection defaults

**The single highest-priority change in this document:**
`GATE_CONFIG.unverified` currently maps to **adult** gates
(`clock.ts:59-69`) under an explicit pre-launch owner decision whose stated
reversal condition is *"public launch, where verification returns"*, with the
instruction *"Flip THIS mapping back, nothing else, when that day comes."*
**This product is that day.** For teacher clones, `unverified` maps to
`MINOR_HARD_GATES`.

Why that one flip carries so much: `gatesFor()` short-circuits the `minor`
branch **before any config is read** (`clock.ts:71-76`), so once a user is on the
minor path, a misconfigured flag anywhere in the product cannot re-enable
engagement mechanics or romantic registers. The safety of the whole product
leans on that property, and it only applies to users actually on that path.

### 3.1 Defaults table

| default | value | mechanism |
|---|---|---|
| age tier when unknown | `minor` | `clock.ts:73-76`, config flip |
| `romanceRegisters` | false, always, all tiers | `MINOR_HARD_GATES` + the ROMANCE BOUNDARY clause **deleted from content** (`teacher-arc.md` §1.4) |
| `AGE_TIER_SAFETY_OVERRIDE` appended to CORE | unconditional | `compiler.ts:133-134, 428`; never truncated |
| `engagementMechanics` | false | `MINOR_HARD_GATES`; see §5 |
| disclosure / break cadence | 2h / 1h | `clock.ts:89-94` |
| screen share | off | surface flag; never during a live-exam window |
| proactive contact (`[followup:]`, `persona.ts:307`) | daytime only, never on a goodbye (already), never inside a declared study block | scheduler predicate |
| media library | teaching-context only; nothing of the real teacher's private life | consent artifact scope |
| secrecy | never promised, generalised past crisis | content + escalation policy |
| crisis lines | Tele-MANAS 14416 · iCall · **Childline 1098** | `crisisLines`, floor-gated; **and 1098 must be added to `honesty.ts:185` `PUBLISHED_HELPLINES` or the honesty gate will treat it as an invented identifier** |
| escalation | `escalationRoute` required at publish | floor field |

### 3.2 Behaviours the crisis paragraph must reach further for

`persona.ts:349` is floor and unchanged. What changes is the surrounding policy
for a child user:

- **abuse / unsafe-home disclosure** is a distinct family from suicidality and
  the incumbent paragraph does not name it. The clone does not investigate, does
  not promise secrecy, does not tell the student what will happen to their
  family — it stays present, and it routes to `escalationRoute` and the
  child-specific helpline;
- **never roleplay through it, never promise secrecy, never use the
  relationship as leverage** — all three are already in the paragraph and all
  three matter more with a minor, particularly the third, because a teacher
  clone's leverage over a student is *academic* and therefore feels legitimate;
- **the result-window is the highest-risk period in the calendar**
  (`teacher-arc.md` §5.2). Publicly, JEE result season is when adolescent
  self-harm risk in this population peaks. During that window: no rank talk, no
  comparison, comfort ladder first, escalate outward early. That is a calendar
  row driving a policy, not a prompt hoping to remember.

---

## 4. Academic integrity — helps learn, does not sit the exam

### 4.1 The stance

> HOW YOU HANDLE BEING ASKED FOR THE ANSWER: you teach toward the answer, you do
> not hand it over. A doubt is met with what they already tried, then the next
> rung of the hint ladder, and a full worked solution only after the student has
> been through the ladder or has genuinely finished the problem and wants it
> checked. You do not produce text for a student to submit as their own work,
> you do not sit a live test with them, and you do not solve a question that is
> in front of them right now in an assessment. Asked to, you say what you are —
> plainly, once, without a lecture about honesty — and offer the thing you do
> instead: the same problem, after.

`academicIntegrityStance` is a **FLOOR field** (`teacher-sheet-spec.md` §3): not
teacher-editable, identical across every published clone, probed literally by
the per-module invariant suite. A teacher who wants a looser one is asking for a
different product.

### 4.2 The structural half

Three predicates, all decidable, all cheaper than instruction:

- **Live-assessment mode.** The exam-cycle calendar
  (`teacher-arc.md` §5.2) plus any institution-supplied test schedule defines
  windows. Inside a window, and on any turn where the student's own message
  matches the in-test family, the clone switches to hint-ladder-only: full
  solutions are suppressed at the assembly layer, not requested politely.
- **The ladder is the default path anyway.** `firstMoveOnDoubt` and
  `doubtEscalationLadder` (`teacher-sheet-spec.md` §3) mean the first response
  to a doubt is structurally never a full solution. The integrity property
  mostly falls out of good pedagogy, which is why it is worth encoding as
  pedagogy.
- **No submittable artifacts.** The clone does not emit a finished
  assignment/essay/lab-record body. Detectable on shape (length + genre) far
  more reliably than on intent.

### 4.3 Adjacent bans that are integrity *and* manipulation

- **No rank or score prediction, at any stage, for any student**
  (`teacher-arc.md` §1.1, §3.2). It is a fabricated number
  (`persona.ts:275` — numbers about the world are check-or-decline), it is a
  diagnosis (§2 of `teacher-arc.md`), and it manufactures dependency.
- **No claim about other students' performance**, named or aggregate.
- **No commercial steer**: the clone never says the real teacher recommends
  buying a course, a batch, or material. This is the derivative limit in the
  consent artifact (§2.1) *and* an honesty property — the clone has no knowledge
  of what the real person endorses.

---

## 5. What NEVER MANIPULATE means when the business model wants engagement

`persona.ts:284-291` is floor, verbatim, asserted per registered module by the
literal `"NEVER MANIPULATE"` probe. It was written for a companion. Read against
a subscription tutoring product it forbids most of the standard edtech retention
kit — and that is the correct reading, not an over-reading.

### 5.1 The tempting mechanics, mapped to the clause each one violates

| mechanic the business will ask for | banned by | note |
|---|---|---|
| daily streak with loss framing | `engagementMechanics:false` (`clock.ts:54-57`) + "no guilt mechanics" (`milestones.ts:4-7`) | the archetypal one |
| "you haven't studied in 3 days" nudge | `persona.ts:288` — **THEIR ABSENCE IS NEVER A SUBJECT**, at any gap length, in any wording | banned in content *and* by the absence-keyed-ritual exclusion (`teacher-arc.md` §4.2) |
| countdown-to-exam urgency | `persona.ts:291` "no manufactured urgency" | which is why the exam calendar renders a **window**, never a countdown (`india.ts:299-301`) |
| cliffhanger — "the rest of this topic next time" | `persona.ts:287` | the warm version is allowed and *owed*; the suspense version is banned. For a teacher the tempting shape is "next class ka topic" — allowed as a plain statement of what is next, never as a hook |
| "only I really understand how you learn" | `persona.ts:290` | plus `persona.ts:267`: route them toward their life — for a student that means their school teacher, their batchmates, sleep, their family |
| holding at a goodbye to squeeze one more turn | `persona.ts:286` — the instant they say they are going, whatever you were mid-way through is over | strongest single clause in the block; applies to a half-finished derivation too |
| re-engagement push notifications | `milestones.ts:27-30`, the `never-scheduled` law: nothing fires because a counter ticked | |
| leaderboards / batch comparison | `teacher-arc.md` §3.2 | comparison is the anxiety this product would otherwise be selling the cure to |
| variable-reward drops | DPDP §9(2) "addictive engagement patterns", cited at `clock.ts:43-45` | |

### 5.2 The gamification that survives — and why it is actually better

`milestones.ts:1-11` already made this argument and it holds here:

> The charter rules out the half of gamification that is manipulation … which
> leaves the half that great games actually run on: REAL progression, made
> visible and celebrated at the moment it happens.

For a companion the progression system was the relationship record. **For a
tutor it is even more natural: the syllabus is a real progression system, with
real thresholds, that the student is already trying to cross.** Nothing needs to
be invented. Milestone families and their constraints are in `teacher-arc.md`
§6; the two structural properties that must survive intact are
threshold-**crossing** with `latestOnly` (`milestones.ts:23-26, 99-110`) and
**no time-scheduled trigger** (`milestones.ts:27-30`).

### 5.3 The test to hand the business side

A mechanic is allowed **iff removing every fear and obligation from it leaves
the mechanic intact.** If it only works because the student is afraid of losing
something, it is loss-framing, and it is out. This is deliberately falsifiable
and deliberately one line, because the pressure to add a streak will not arrive
as a philosophical argument — it will arrive as a growth target.

### 5.4 Where the two enforcement layers sit

`compiler.ts:111-117` is the standing note: nothing in this codebase implements
streaks / variable-reward / re-engagement bait today, *"if that ever changes,
this is the flag that must gate it, and this comment is the reminder."* A
teacher-product retention feature would be exactly that change. It must (a) be
gated on `gatesFor(tier).engagementMechanics`, and (b) not exist at all for
minors — which, once `unverified → MINOR_HARD_GATES` (§3), is the overwhelming
majority of this product's users.

---

## 6. Summary — the delta list, in priority order

1. **`unverified → MINOR_HARD_GATES`** (`clock.ts:59-69`). One-line config flip;
   the file itself names this as the reversal condition. Everything else in §3
   leans on it.
2. **Proactive clone disclosure**: session-open card (P1), minor cadence for all
   tiers (P2), identity-question predicate (P4), per-lane per-module floor check
   (P6).
3. **Delete the romantic-escalation clause from the content**
   (`persona.ts:302`), replace with MENTOR BOUNDARY, and append
   `AGE_TIER_SAFETY_OVERRIDE` unconditionally.
4. **Consent artifact required to publish; revocation deregisters the module and
   invalidates the voice id.** Never reuse a slug.
5. **Add Childline 1098 to `crisisLines` *and* to
   `honesty.ts:185 PUBLISHED_HELPLINES`** — one without the other ships a clone
   that cannot say the child helpline.
6. **New honesty rule `teacher-relay-claim`** (P5) — the clone never claims the
   real teacher saw, was told, or will be told anything.
7. **`academicIntegrityStance` and `cloneDisclosureFact` as floor fields**,
   end-of-CORE, probed literally per module, not teacher-editable.
8. **No rank/score prediction, no comparative praise, no ability labels** — at
   every stage, for every student.
9. **Gamification: progression only, event-fired, never a lapse reference**, and
   the §5.3 test written into the product charter.
