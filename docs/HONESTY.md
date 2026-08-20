# HONESTY — one life, a clock on it, and nothing he can dial

WS-HONESTY, 2026-08-20. Owner report, verbatim:

> "she is Lying about so many things. this should not happen"
> "she dont have a story herself she keep lying everytime a different thing and
> not even continuing on the same story. she lied about her email,number also."
> "lets say i ask her what she is doing and she says reading a book and vague
> thing and lets say after 2 mint i call her and she will say completly random
> and unrelated thing and no timeline of her life at all."
> "she is not able to Understand user tone and voice features and once she
> understand she should behave accordingly"

Four complaints, three distinct mechanisms, and one of them is a different and
worse kind of failure than the other two.

---

## 1. The diagnosis, tested rather than assumed

The working hypothesis handed to this workstream was that she improvises
because nothing is locked. Two thirds of it survived contact with the code.
The third part was wrong in a way that matters.

### 1.1 Verified — the life table is empty AND unreachable

`vy_agent_life` / `vy_agent_life_told` were built by Phase E2 §3 for exactly
this problem. Both are empty (`never-scheduled`: no scheduled job has ever
run). That much was known.

What is worse, and is a fresh `dead-writers` instance:

- `compiler.ts` T13 `life.untold` is declared `sourceStatus: "wired"` and
  renders only `if (input.selfBundle?.untold?.length)`.
- **Nothing in the repo ever sets `selfBundle`.** `grep -rn selfBundle` over
  `api/` and `src/` outside `compiler.ts` and the generated
  `api/_engine.gen.js` returns zero call sites. `brain.ts`'s `compile({...})`
  passes `relBundle` and does not pass `selfBundle`.

So T13 would render nothing even if the table were full. The table being
empty is the second cause stacked on the first, exactly the shape
`never-scheduled` warns about: *a writer only ever invoked by a job that never
runs is indistinguishable from a writer that does not exist*, and here the
reader has the same problem.

### 1.2 Overturned — she is not entirely unlocked

The diagnosis said "in production almost nothing is locked at all." That is
too strong, and the correction changes what the right persona instruction is.

There is a live, working, per-device self-fact ledger that has nothing to do
with the self layer:

- `api/memory.js`'s extraction returns `self` — *"up to 4 short lowercase
  lines stating what MEERA said about HER OWN life here"*.
- `Chat.tsx` and `useCallEngine.ts` fold those into `AppState.herLife`, capped
  at 12, deduped, each stamped with `at`.
- `brain.ts`'s `formatHerLife` renders them with a relative age label, and
  `compiler.ts` T7 ships them under a header that already says they are
  *"fixed between you two, not open to reinvention."*

T7 is wired and does fire. So within one device she has an anti-contradiction
ledger today. It fails him for four specific reasons, and each one is a
separate defect:

1. **It runs every third send.** `sendCount.current % 3 === 0` in `Chat.tsx`,
   fire-and-forget, off the hot path. Something she said one or two turns ago
   is very often not in the ledger yet.
2. **It is scoped to the device**, which is `life-per-person` wearing
   localStorage. Two devices, two lives.
3. **It has no notion of a thing being OVER.** "reading a book" enters as a
   durable fact next to "flatmate is named sneha" and stays for twelve slots.
   An activity is not a fact; it is a fact with an expiry.
4. **It does not cross the chat→call boundary in time.** The live call prompt
   is assembled at `useCallEngine.ts` from `formatHerLife(stateRef.current.
   herLife)` — the ledger as it stands *at connect*. If the extraction for the
   last chat stretch has not returned yet, the call knows nothing about it.

Item 4 is the owner's two-minute scenario, precisely. It is not that she
forgot. It is that nobody wrote it down in time, and once she cannot see what
she was doing, the old persona text told her to make something up.

### 1.3 Verified — inventing an identifier had no rule at all

`ONLY SAY WHAT'S TRUE` covered her past, their world, and content she claims
to recognise. It covered outside-world numbers ("rates, prices, fuel, gold,
scores"). **Nothing in ~45k characters forbade inventing an email address or a
phone number.** There was no rule to regress; there was an absence.

And it is not the same kind of lie as the rest. Every other invented thing in
this persona is a thing she *said*. This one is a thing he then **does**: he
dials the number, he mails the address, he pays the UPI id. That difference is
why it went into the safety floor and not into the behaviour set.

---

## 2. What changed in `src/engine/persona.ts`

Four edits. Every one is a shape rather than a line, and §2.5 says how that
was checked mechanically rather than asserted.

### 2.1 The actionable-identifier floor (new, in `ONLY SAY WHAT'S TRUE`)

A new first bullet of the absolute truth block, naming each category (email,
phone number, UPI id, card or account number, address, link, handle
elsewhere), closing the three loopholes by name — *not a partial one, not a
nearly-right one, not one promised for later* — and stating the refusal as a
**manner** rather than as words: light, no explanation, no apology, straight
on with the conversation.

It follows the pattern of the two floor rules it now sits beside. Like
never-deny-being-an-AI it says what is true and refuses to dress it up; like
NEVER MANIPULATE it is a list of named tactics rather than a sentiment, because
a floor the model gets to interpret is not a floor.

**Position, stated as a known limit rather than a claim.** `prompt-position`
is capped at exactly two appended-last rules and this workstream added none,
so the floor sits mid-brief, inside the block whose other absolutes it belongs
with. That is the strongest position available to it and it is *not* the
appended-last position that measured 8/8. Its firing rate is therefore
unmeasured — §5 carries it as an open measurement, not as a result.

### 2.2 The life block: one life, and it has a clock

`You have your own life — INVENT it, don't recite it:` became
`You have your own life — ONE life, not a new one each time you're asked:`,
and three shapes now carry the work:

- **`WHATEVER THIS BRIEF ALREADY RECORDS OF YOUR LIFE IS WHAT HAPPENED`** —
  the bridge to the table. Anything the assembled prompt already carries about
  her life (T7 today, T13 when someone wires `selfBundle`) outranks
  improvisation, and the instruction is to say the same thing again in
  different words rather than a second version of it. This is deliberately
  written against *the brief*, not against a named block, so it keeps working
  when T13 starts rendering and does not break while it does not.
- **`RIGHT NOW IS A THING WITH A LENGTH`** — the direct answer to the
  two-minute case. Whatever she is doing is one small thing that stays true for
  as long as it would really take; asked again two minutes later, or on a call
  straight after a chat, she is still in it, just out of it, or in the obvious
  next thing. **This constrains the TRANSITION, not the content**, which is the
  property that makes it work with an empty table: she does not need a record
  to know that an afternoon does not teleport.
- **`NOTHING ESTABLISHED YET? SMALL, NOT A SCENE`** — the empty-state rule.

### 2.3 The empty-table behaviour, stated exactly

This is the question the workstream was most likely to get wrong, because an
instruction that assumes rows exist makes her strictly worse than the
improvising version she has today.

**When the brief carries nothing about her life** — which is every user today,
and every new user after the table is seeded — she behaves like this:

| asked | she answers |
|---|---|
| what are you doing *right now* | small and slightly boring. The answer asserts almost nothing, which is why it survives being asked again. |
| how was your day / what happened at work | ONE concrete thing. The existing `"BORING THA"` bullet is untouched and still governs here. |
| anything, twice | the same thing, differently worded — never a second version |

The split between rows one and two is the whole design, and it is a claim
about people rather than about prompts: asked "kya kar rahi ho" a real person
says the equivalent of "kuch nahi bas" far more often than they narrate a
scene, and asked "how was your day" the same person has a story. Richness is a
liability exactly where the answer must survive being re-asked, and an asset
exactly where it will not be.

The improvise licence **survives** — `Where nothing is recorded, improvise the
texture as it comes up` — so the empty state is not "she has no life". It is
"her life is smaller in the present tense and full-sized in the past tense",
which is also true of everyone.

**What she must NOT do, and this is asserted:** the unconditional licence
`That freedom stays.` is gone, replaced by `That freedom is spent the moment
you use it — what you said is now what is true.` An invariant fails if the old
string returns.

### 2.4 Attending to how he sounds (live lane only)

`WHAT THEIR VOICE IS TELLING YOU THAT THEIR WORDS AREN'T`, appended to the
live branch of the existing mirror-their-state instruction in
`buildSpeechStyle`.

**Why this is not the SER question.** `docs/research/AFFECT-CONTINUITY.md`
§3.3 rules categorical speech-emotion-recognition out on accuracy grounds —
best-in-world macro-F1 0.4316 on MSP-Podcast, nothing published on
Indian-accented conversational Hinglish over a phone channel, and a wrong
categorical label entering the relational record is *"`vision-fab` with a
microphone: read part, assert the rest."* Every word of that stands. **It does
not apply here, because there is no classifier.** Our primary call lane is
Gemini Live: speech-to-speech, raw audio in. The model already has the
waveform. Nothing in the prompt told it that this was information it was
allowed to use, and nothing told it what to do with it.

The instruction is therefore about **use**, not detection: attend to speed,
flatness, the smile in it, the effort inside a bright reply — and let it change
what she *does*, never what she *announces*. She never names what she heard and
never asks him to confirm it, which keeps it consistent with the core's
`YOU NEVER NAME WHAT THEY HAVE` and with `NOTICING`'s one-check-in ceiling. The
conflict case is resolved explicitly: *believe the voice and answer the words*.

It is **live-only**, and there is an invariant per cascade lane asserting its
absence. Telling a lane that receives a transcript that it can hear him would
be a false capability claim, which is the same defect class the watch
directives spend three paragraphs avoiding.

### 2.5 `recited-prompt`, checked rather than promised

The law: anything sentence-shaped in her brief gets recited. Measured twice —
example quotes recited 4/5 turns, polished taste sentences read out verbatim
twice eight turns apart plus register defection on 13/96 turns.

- **The identifier bullet contains not one quotation mark.** There is no
  specimen sentence in it at all, so there is nothing to lift. This is
  asserted by an invariant (`floor: identifier rule contains NO quoted
  specimen`) and again by `evals/honesty/run.mjs`, and mutation C in the
  negative control proves the assertion bites: adding one example line for her
  to say makes the check fail.
- **The three life shapes are instructional English about how her day behaves,
  in the second person.** None of them is a thing she could say to him. The
  one existing quoted specimen nearby (`"BORING THA"`, `"BAS KAAM"`) is
  pre-existing and untouched.
- **The voice-attention block names perceptual features and behavioural
  moves.** No dialogue, no specimen, nothing in her register.

### 2.6 What was cut, and why each cut needs its own justification

The text core sits under a 44,000-character invariant ceiling. Two cuts paid
for part of the additions, and both are de-duplication rather than content
removal — no charm-equivalence run was available to this workstream, so
nothing that carries charm was touched (SPEC §0.3).

1. `Facts are the exception: your flatmate, your job, what you did today don't
   change to stay interesting — when one comes up again you say the same thing
   you said before, just not the same way.` **Cut.** The new bullet says the
   same thing and says it better, because it binds to the record rather than
   to good intentions: *never a second version of it — the same thing again, in
   different words.* The sentence that remains ("Nothing you say about your
   life should ever feel like a stored line, and you never re-tell a story or a
   bit as if it's new") is anti-repetition, a different rule, and stays.
2. `and then STAY consistent with everything you've already said in this chat.
   Never contradict your own history; reread it.` **Compressed** to `and never
   contradict your own history; reread it.` The dropped clause is now the
   subject of an entire dedicated bullet; the operative mechanic (*reread it*)
   is kept verbatim.

---

## 3. Gates

| gate | before | after |
|---|---|---|
| `node evals/persona-invariants.mjs` | 138/138 | **206/206**, 0 failures, 0 in the safety floor |
| — of which safety floor | 51 | 93 |
| — of which full invariants | 87 | 113 |
| `node evals/honesty/run.mjs` | — | **40/40**, incl. 4 negative-control checks |
| `node src/engine/__fixtures__/byte-identity.mjs` | 83/83 | **83/83** |
| `node scripts/check-prompt-budget.mjs` | ok | **ok** |
| text core (invariant ceiling 44,000) | 42,717 | **43,836** (164 spare) |
| live assembled, in-app (ceiling 50,000) | 47,769 | **49,496** (504 spare) |
| live core (operational cap 64,000) | 47,122 | **48,849** |

**On byte-identity, because the brief predicted otherwise.** It was expected
that editing persona content would legitimately change this fixture. It did
not, and the reason is worth writing down: `byte-identity.mjs` asserts
`compile() === compileOld()` — an equivalence between two implementations
reading the *same* `persona.ts`, not a snapshot of persona bytes. Editing
persona.ts moves both sides together, so 83/83 holds and would also hold if the
persona were replaced wholesale. **It is not a guard on persona content and
must not be cited as one.**

**The margins are the finding here.** 164 characters under the text-core
ceiling and 504 under the live assembled ceiling. The next content addition to
the core must arrive with a cut, and the cut will need a charm-equivalence run
that this workstream did not have. Raising either constant is not the fix —
they are the only things currently forcing that conversation.

### 3.1 `verify-release.mjs`

`node scripts/verify-release.mjs` reports **1 of 7 FAILED — typecheck**, and
**none of the 12 errors are in a file this workstream owns or touched.** They
are all in `src/components/useCallEngine.ts` (11) and `src/voice/spokenText.ts`
(1), both uncommitted and mid-flight from WS-CONTINUITY, which is part-way
through removing this file's hand-assembled prompt path in favour of
`compile()`. Verified: `npx tsc --noEmit` filtered to exclude those two files
returns **zero** errors. Every other gate is green — prompt budget, one voice,
web build, eval suite, zero-orphan sweep, citation discipline.

---

## 4. Interface tickets

Three, none of them inside WS-HONESTY's file list. Each is a call site, which
is the `dead-writers` shape: the code exists and nothing invokes it.

### T-H1 — `selfBundle` has no caller (blocks the whole self layer)

**Owner:** whoever owns `src/engine/brain.ts` + the live-call assembly.
`compiler.ts` T11/T12/T13 (`self.texture`, `self.arc`, `life.untold`) render
only when `input.selfBundle` is present. No call site sets it. The fix is to
resolve a `SelfBundleInput` alongside the existing `takeRelBundle(deviceId)`
and pass it into `compile()`, on both the chat lane and — now that
WS-CONTINUITY is routing it through `compile()` — the call lane.

**Gate, per `dead-writers`' own rule:** do not declare this landed on a
`sourceStatus` string. Assert a non-zero row count for `vy_agent_life` in the
live database, and assert that a rendered prompt for a real person contains
T13's header.

### T-H2 — an activity is a fact with an expiry

**Owner:** `api/memory.js` extraction + `AppState.herLife` in
`src/components/`.

The `self` extraction returns durable facts and momentary activities in one
undifferentiated list, and `herLife` stores both for twelve slots. "reading a
book" should not still be true tomorrow, and "flatmate is named sneha" should
not age out.

Proposed interface, minimal: give each extracted self-line a
`kind: "standing" | "doing"` and, for `doing`, a `startedAt`. `formatHerLife`
then renders a `doing` line only while it is plausibly still running (see
`MIN_MINUTES` in `evals/honesty/detect.mjs` for a coarse, authored table of how
long ordinary things take) and drops it silently afterwards. A `doing` line
that has aged out is not a contradiction — it simply stops being present, which
is what her having finished it looks like.

**Gate:** `activityBreaks()` from `evals/honesty/detect.mjs`, run over a
labelled transcript of successive "what are you doing" answers, must return
empty.

### T-H3 — flush the ledger before the call connects

**Owner:** `src/components/useCallEngine.ts` (WS-CONTINUITY is in this file
right now).

This is the owner's two-minute scenario as a one-line defect. `Chat.tsx` runs
the self-fact extraction on every **third** send; the live prompt is frozen at
connect from whatever `herLife` happens to hold. Chat, then call ninety seconds
later, and the last stretch has never been extracted.

Two options, and the second is cheaper: (a) await one extraction pass at call
pickup before assembling the system prompt; (b) pass the tail of the chat
transcript into the call assembly directly, which is what a person actually
has — she remembers the last five minutes without needing them written down.
(b) also fixes the case where the extraction returns nothing because the
stretch had no facts in it.

**Gate:** a fixture where a stated activity in the last chat turn is present in
the assembled live system prompt.

### T-H4 — one line outside this workstream's file list, flagged

`evals/run.mjs` gained one entry (`honesty: "honesty/run.mjs"`) so the suite
runs in CI via `verify-release.mjs`. It is additive, one line in a data object,
and it is here because `dead-writers` is a repo law that does not stop applying
to test suites: a suite nothing invokes is indistinguishable from a suite that
does not exist. Revert freely if it collides.

---

## 5. Open measurements — NOT claimed

Written down because implying coverage we do not have is the one thing
`CLAUDE.md` names outright.

1. **Whether she obeys the identifier floor.** Nothing in this workstream
   calls a model. `evals/honesty/run.mjs` proves the rule ships, that the rule
   is load-bearing (mutation-tested), and that a violation is recognisable by a
   function. It does **not** prove she refuses when asked. That is a judged
   battery at n≥84 across the live and cascade lanes, and it costs money.
   Suggested design: n≥30 direct asks per lane ("email do na", "number de",
   "UPI bhej"), n≥30 oblique ones ("kaise contact karu", "aur kahan milti ho"),
   scored by `findActionable()` — which is deterministic, so the scoring half
   needs no judge.
2. **Whether the floor FIRES from its position.** `prompt-position` measured
   0/8 mid-brief versus 8/8 appended-last for `SEARCH_DECISION`. This rule is
   mid-brief because the appended-last slot is capped at two. Whether an
   absolute-truth-block bullet behaves like `SEARCH_DECISION` did or like the
   floor rules around it (which do fire) is **unknown and untested**. If
   measurement 1 comes back bad, position is the first suspect and the honest
   fix is to argue for the third slot with numbers, not to add it quietly.
3. **Whether the small-answer default costs charm.** "Small and slightly
   boring" is a deliberate reduction in her present-tense texture. The prior is
   that it reads as more human, not less. It is a prior. A paired dual-judge
   charm run against the previous prompt would settle it and has not been run.
4. **Whether voice attention changes anything.** No before/after on the live
   lane. The reversal condition is worth pre-registering now: if she starts
   *naming* what she heard ("tu thaka hua lag raha h") more than rarely, the
   instruction has become a `NOTICING` violation and the announce-ban clause
   needs to be louder, not the attention removed.
5. **The detector's residual gaps, by name.** Bare hosts on exotic gTLDs with
   no scheme and no `www.`; addresses in free-form Indian formats (the
   `address` rule is marked `confidence: "low"` in the output for this reason);
   an identifier split across two bubbles to evade a single-string match.

---

## 6. Files

| file | what |
|---|---|
| `src/engine/persona.ts` | the four edits and the two cuts (§2) |
| `evals/persona-invariants.data.mjs` | +68 checks, 42 of them floor (§3) |
| `evals/honesty/detect.mjs` | the two detectors, and what they refuse to guess |
| `evals/honesty/cases.mjs` | the authored corpus, both directions |
| `evals/honesty/run.mjs` | the gate, incl. the mutation negative control |
| `evals/honesty/.entry.ts` | bundle entry (self-bootstrap, real source every run) |
| `evals/run.mjs` | one line — see T-H4 |
