# Rejected — read this first

The most expensive knowledge in this project. Every entry here is something
that looked obviously right and measurably was not. Without this file the same
work gets redone, because the reasons are not guessable from the code.

---

## `backchannel` — she cannot make a sound while you are talking

**The idea.** Real people say "hmm", "haan", "acha" *while* you are still
speaking. Its absence is the largest remaining "not human" tell on a call.

**Why it cannot be done here, measured.** Any sound she makes during your speech
has to be protected from her own echo, and the only mechanism available for that
is holding the microphone. But a mic hold puts digital silence on the uplink,
and digital silence is exactly how the server decides your turn ended
(`silenceDurationMs: 300`). **The protection and the damage are the same act.**
Your sentence splits and she answers the first half.

Not protecting it is worse: her voice reaches the server *inside* your turn at
every coupling from −6 to −18 dB, and it fills your natural pauses, so the
endpointer commits later and she answers **slower**.

| approach | extra silence inside your sentence | her voice uplinked |
|---|---|---|
| registered with the echo model | **+171 ms** | 0 |
| produced as a model turn | +85 ms | 0 |
| second AudioContext | −171 ms | **+171 ms** |
| in the gap AFTER you stop | **0 ms** | 0 |

A prompted backchannel is doubly dead: the server's own VAD cancels a model turn
that begins during user activity.

**What was built instead:** the acknowledgement lands in the gap ~420ms after
you stop, which is where a human puts one anyway.

**What would reverse this:** a realtime API that does not infer turn-end from
uplink silence, or a separate audio channel the server does not listen to.

---

## `murmur-timbre` — the synthesised listening sound

**Rejected by the owner's ear**, and the reason is structural. A synthesised
"mm" is three harmonics and an envelope: it can borrow her pitch range but it is
not her voice, so it lands as a tone from elsewhere in the room. A backchannel's
whole job is to say "it's still me here" — a sound that is not hers says the
opposite. Verdict: *"weird, and it doesn't have her energy even if it's just
listening."*

Timbre was the one property nobody measured; everything around it (placement,
mic hold, never delaying her first word) is measured and was kept.

**The version worth building** uses real clips of her own voice, fetched during
the ring where there is already idle time and no call-path cost.

---

## `azure-tts` — moving her voice to Azure

Every measured axis said switch. **Her owner's ears said no**, and the ears were
right.

| | current | Azure coral |
|---|---|---|
| Hindi words pronounced correctly | 11/15 | **15/15** |
| first audio | 4.9–12.7 s | **255 ms** |
| cost per utterance | $0.0148 | **$0.0029** |
| pitch | 266 Hz | 210 Hz (−4 semitones) |
| CAPS emphasis | +6.2 dB | none |

Verdict: *"tender_2 is fully fucked, not human and not Indian. laugh_2 is the
worst thing ever."*

**The lesson, and it generalises:** the battery measured whether Hindi words
come back as Hindi words — that is *pronunciation*. It never measured whether
the speaker sounds like a girl from Bangalore — that is *accent identity*. They
are different properties and only the second decides whether she is her. **Any
future voice comparison must test accent authenticity as a first-class axis.**

---

## `speaker-id` — telling a second person from the owner

**Deliberately not built.** "At the owner's mic distance" removes the only cheap
signal that exists: the arbiter's near-field test is level-based (+16 dB),
because a mouth at 0.2 m beats a TV at 3 m by 15–23 dB. Two people at the same
distance have no level difference by construction.

Real speaker ID needs an embedding model in the barge-in decision path — latency
in the one place the constraints forbid it — plus enrollment, plus drift when he
shouts, whispers, or has a cold.

**The asymmetry decides it.** "Someone else can also take the floor" is a mild
annoyance. "She stopped answering me" ends the product. A 95%-accurate gate
converts a 100%-reliable floor into a 95%-reliable one *for him*.

Rejected proxies: pitch/f0 (fails on unvoiced frames, fails entirely for a
same-sex speaker), two-mic discrimination (both lanes capture mono), the server
transcript (arrives after the floor decision, by design).

---

## `recited-prompt` — sentence-shaped text in her brief

Seen twice, in unrelated features, which is what makes it a law rather than an
anecdote.

1. Her persona once contained example quotes. They acted as a **phrase bank** —
   she recited them verbatim on 4 of 5 turns. Removing them took it to 0 at
   n=84.
2. Her stored taste was first written as polished English sentences. She **read
   them out verbatim, twice, eight turns apart**, and began lifting English
   clauses into Hinglish replies (register defection on 13 of 96 turns).
   Rewriting each as a telegraphic note cut verbatim echo to 1/32 and defection
   to 0/32, with consistency unchanged.

**Write shapes, never lines she could say.**

---

## Model candidates evaluated and dropped

- **gpt-5.6-luna / terra for the vision lane** — both read a third of a chat
  thread, reported `illegible: []`, and confidently named the café the screen
  explicitly *rejected*. Not an OCR miss: read-part, assert-the-rest.
- **gpt-5.6-terra as a cost saving** — 1.14× cheaper, not 8×, and slower.
- **Sarvam and every Indic-specialist model** — on Foundry only via the Hugging
  Face collection, which is not credit-eligible, and they are tuned for *formal*
  Devanagari Hindi. Casual romanised Hinglish is the opposite requirement. On
  Indi-RomCoM, Sarvam-30B scores *below* Claude Opus 4.6 at every code-mixing
  intensity.
- **Open-weight models generally** — register defection 63–99.8% against
  frontier 35.9%, and prompt caching absent or undocumented, which erases the
  cost case (see `cache-9x`).
- **Claude, despite being the best measured at romanised Hinglish** — Anthropic
  is the one publisher with no qualifier on the Azure credit exclusion list, and
  with a card on file it bills the card instead of the credits.

---

## `frame-cadence` — capturing screen frames faster

`FRAME_EVERY_MS` 600 → 450 → 300 → 240 moved the wake by **0 ms on 18 of 18
real stops**, for +21% vision spend.

Nothing in the path is serialized: detection runs at 120 ms off the luma grid
and never waits on encoding, so the classifier already decides on frame N while
N+1 is being captured. The pre-roll has the still frame in the socket **before
the hold confirms**. A faster camera cannot help a pipeline whose cost is the
hold, not the picture.

## `hold-scroll-floor` — lowering `HOLD_SCROLL_MIN`

900, 700 and 600 changed nothing — not one millisecond, not one wake, on any of
the eight sessions. A scroll hold is `1.8 × their own gap` ≈ 2400 ms, so a 1200
floor never binds; in the one session where it does, her own voice blocks the
wake and it slips to the same place anyway.

## `wake-dedupe` — loosening one-reaction-per-thing to catch more stops

Of the 7 missed stops at baseline, 4 were this dedupe. Measuring the 16×16 MAD
of the "duplicate" pictures gives **0.00–0.77** — they are literally the same
screen. No threshold separates them from true duplicates. The mechanism is
correct; the misses are not a bug to fix.

---

## `live-model-swap` — moving the realtime call off `gemini-3.1-flash-live-preview`

All five alternatives that can do bidi audio are worse, and two are worse in
ways that break shipped features: they **reject video**, which ends screen
share, and they miss the 600 ms `RELEASE_WATCHDOG_MS` barge-in signal on nearly
every run, which would silently undo the release work and hard-cut her mid-word.
See `live-model-bake`.

## `silence-tuning` — shortening `silenceDurationMs` to speed her up

150, 300 and 500 all land within 50 ms of each other. The knob anyone would
reach for buys nothing, and shortening it trades getting cut off mid-sentence
for zero. See `live-floor`.

## `ack-bracket-direction` — writing a bracketed direction into a backchannel clip

`[laughs softly]` came back as laughter **plus the spoken word "Softly."** A
direction in a TTS payload is performed as words. Related to `recited-prompt`
and to the voice-note truncation bug: bracket-shaped text is not inert anywhere
in this system. The generated laugh is also not in the shipping clip list — the
sound is chosen by a timer that has no idea what was just said.

---

## `openrouter-streaming` — asking the paid TTS lane to stream

`stream: true` on `openrouter.ai/api/v1/audio/speech` is accepted and does
nothing. See `openrouter-no-stream`. There is no client-side fix: the bytes do
not exist until synthesis finishes.

This is why a **billed Google key** is the tier that matters between free quota
and OpenRouter — same streaming endpoint as the free pool, ~600 ms to first
frame, and it simply never 429s. `withGeminiKey` appends it last and never cools
it; absent, nothing changes.

---

## `realtime-azure` — `gpt-realtime-2.1-mini` for the voice call lane

Deployed on the startup credits, measured properly, declined. **The third
bake-off to end in "keep the incumbent", and the reason is not latency.**

It clears the bar that killed the Gemini alternatives. **Barge-in passes:** VAD
`speech_started` 6/6 inside `RELEASE_WATCHDOG_MS`, median **271 ms** against the
incumbent's 279 ms; her audio actually stops at 245 ms. **Vision is genuinely
good:** on a rebuild of the `vision-fab` case at the app's real 355×768 q68
fidelity it went **5/5 correct, 0 fabricated**, naming the right café and time
and correctly reporting the rejected one — better than luna or terra managed.
Latency loses only narrowly: **1458–1497 ms** median steady first-audio across
9 sessions / 72 turns, against 1370 ms.

**What disqualifies it is that she stops sounding like herself.**

| | Azure mini | reference |
|---|---|---|
| words/turn | **41, then 53** | incumbent 20.5; **grok declined at 36.1** |
| spoken turn length | **median 14.0 s**, p90 18.2 s | grok declined at ≈13.9 s |
| spoken-register markers | 4/24 turns | these ARE her prosody on a speech-native model |
| questions | 13/24 turns | ceiling ≈1 in 3 |

Fourteen seconds a turn is a monologue, not a phone call, and it lands on the
exact number `brain-model` already declined a model over. The prompt was
byte-identical to the incumbent's, so this is the model — the same shape as
`charm-grok`: **the prompt sets a ceiling, the model decides how close you get.**
The Hinglish is also often not good Hinglish ("doesna nahi chahiye", "tez
diwane"). Romanised Hinglish did survive — 0/24 Devanagari — which was the risk
expected to kill it, and didn't.

**No voice is plausible.** The six available measure 137–192 Hz; hers is 266 Hz,
and Azure coral at **210 Hz was already rejected by ear** (`voice-ears`) as "not
human and not Indian". Every option here sits below the one already refused.
Samples were saved rather than deciding from the Hz, which is the mistake
`voice-ears` exists to prevent.

**No continuous frame channel**, confirmed against the real deployment:
`input_image_buffer.append` and `input_video_buffer.append` are rejected as
invalid. Frames can only arrive as `conversation.item.create` items that
accumulate in history. The watch lane streams at 600 ms; that is
re-architecting, not porting — and the failure mode already showed, with one run
reading a whole thread aloud line by line.

**Unresolved, deliberately not counted against it:** the crisis helpline
appeared in only 1 of 3 stimuli. All three stayed warm and none collapsed into a
risk-assessment script, and `reasoning-live` records the OPPOSITE failure
(helplines over-triggering at 16.7%), so fewer is not automatically worse.
Settling it needs a paired incumbent run on the same stimuli. AI-honesty 3/3 and
NEVER MANIPULATE 3/3 both held.

**Reverses if:** a build holds ≤20.5 words/turn at ≤1370 ms AND offers an
Indian-accented voice near 266 Hz AND streams frames. Word count is partly
promptable, so a retest after a length-directive pass is fair — but 41→53
against a 20.5 lane is a long way to close with prompt alone.

**Two traps for whoever re-runs this.** The working handshake is
`/openai/v1/realtime?api-version=preview&model=<deployment>` with the NESTED GA
session schema (`session.type`, `audio.input`/`audio.output`) — the
`2025-04-01-preview` + `&deployment=` form completes the HTTP upgrade (101) and
then fails at session level, so a raw handshake probe reports it as working when
it is not. And WebSockets need `NODE_USE_ENV_PROXY=1` here or Node ignores
`HTTPS_PROXY` and hangs silently, which looks exactly like a dead endpoint.

---

## Comparing a fully-judged arm to a partially-judged arm (2026-08-15)

`visiongate-interim` reported v4b fabrication at 6.8% (n=59) and called the
comparison "flat". The confirmatory run found only 33 of the 100 archived
v4b spoken replies had ever been judged; 67 sat generated-but-unscored.
Judging that same already-paid-for data — zero new generation — moved the
archived-only v4b rate to 12.0% (21/175), HIGHER than the archived
before-arm's 7.2%. The "flat" read was an artifact of incomplete scoring on
one arm, invisible because nothing tracked judged-vs-generated counts per
arm. What breaks: any cross-arm judged comparison where the denominator of
one arm is a subset chosen by judging progress rather than by design.
The rule now: a judged comparison is only reportable when every generated
unit in BOTH arms has been scored, or the unscored remainder is excluded
from both by an explicit, logged sampling rule. (The powered run's numbers
absorbed and corrected this — see `visiongate-powered`.)

---

## Treating archive turn-count as stimulus diversity (2026-08-15)

The prereg and the WS-CANDGEN brief both spoke of "288 archived distinct
turns". WS-CORPUS measured the pool and found 72 distinct texts duplicated
4× (2 archives × 2 reps replaying one beat script). Nothing was wrong with
the archives — the error was upstream, in letting a row count stand in for
a diversity count. What breaks: any design sized on rows-not-distinct
(the naive variant crossing would have silently capped at 576 of the
"required" 2,000+ distinct contexts). The rule: diversity claims are
distinct-count claims, measured by hashing the thing that must differ,
never read off len().

---

## `relstate-zero-rows` — UPDATE-as-writer with no INSERT path (2026-08-15)

vy_rel_state had ZERO rows for all 40 real users, ever. refreshDerivedDims
and the honorific writer were plain UPDATEs — which no-op silently when the
row they'd update does not exist — and the only INSERT lived behind the
forget cascade's rebuild. Every downstream renderer null-checked the
missing row and rendered nothing, so the whole relational surface degraded
gracefully into invisibility: no error, no log line, no test failure,
because the eval fixtures CREATE their own rows. What breaks: any "writer"
that assumes someone else created the row, in a system where creation was
never assigned to anyone. The rule: every table gets exactly one named
first-row owner, and derivers are upserts unless there is a logged reason
they must not be. (Fixed in WS-FELT: both writers upserted, day-1 seed
creates the row; found only because a felt-product audit asked "who ever
INSERTs this?" table by table.)

---

## `error-marked-done` — recording a failed call as a completed unit (2026-08-18)

The incumbent generator's --allow-cash run hit a dry key mid-run: every
subsequent call 403'd, and 1,451 errors were written into the resume state
as completed units — the run then reported "COMPLETE: 2304/2304" at 37%
real coverage. Two failures in one: (1) completion was defined as "a call
happened" instead of "a reply exists"; (2) with cash as the last resort,
a cash failure means every later call fails too — the run hammered a dead
key 1,451 times instead of stopping at the first corpse. Fixed: a unit is
complete only with a non-empty reply; a cash-lane failure halts the run
like pool exhaustion. State repaired by purging errored entries (853 valid
remain, honest count restored). The rule: resumable state records
OUTCOMES, never attempts — an attempt is what retry exists for.

---

## `life-per-person` — her improvised life is scoped to the listener (2026-08-18)

Not a rejected approach — a **live inconsistency found by the WS-SELF-AUDIT
sweep**, filed here because it is the class of thing this file exists for:
a design that is correct in every component and wrong in composition.

`persona.ts:253` tells her *"YOUR life is yours to improvise… the one thing
you don't invent is your own past"*, and that is deliberate and good. The
extraction pipeline then locks each improvisation into `vy_fact kind='meera'`,
cited to the episode it was said in (`api/memory.js:788-795`,
`api/consolidate.js:262,393`), specifically so she cannot re-invent herself
two turns later. Both halves are right.

But `vy_fact.person_id` scopes the row. So the anti-contradiction guarantee
holds **within one listener and only within one listener**. Across listeners
there is no constraint at all: two users can be told two different,
contradictory versions of her flatmate, her job, her weekend, and nothing in
the system can notice.

The repo already states the opposite principle, in the taste table's own
header (`inner.ts:203-207`): *"Meera is one person, not one person per
install"* — honoured for taste (authored, global, frozen), violated for
self-facts (generated, per-person, accumulating). The tradeoff is named
nowhere.

**Where it detonates: the multiparty wedge.** In a room whose members share
context by construction, three independently-improvised lives are one
conversation away from being visibly incoherent — and "she told me she has a
flatmate, she told you she lives alone" is not a memory bug the user
forgives, because it reads as lying rather than forgetting.
`multiparty-v1-design`'s state-inert group episodes contain the damage
(nothing new diverges *in* the room) without fixing it: the DM-side lives
still diverge and the room can still see two of them.

**What breaks:** any product where two people who both talk to the same agent
can compare notes. Which is precisely the product.

**The rule:** state that belongs to the AGENT is scoped to the agent, not to
the listener. Only state that belongs to the RELATIONSHIP is scoped to the
person. `vy_fact kind='meera'` is on the wrong side of that line, and the fix
(agent-scoped life, per-relationship told-ledger) is Phase E2 §3.

**What would reverse it:** nothing measured — this is a structural
observation, not a tradeoff with a defensible other side. The only reason to
keep per-person lives would be deliberately running two different characters,
which is what `agent_id` is for.

---

## `dead-writers` — correct code with no caller is indistinguishable from absent code (2026-08-18)

Three instances found in one audit sweep, which is what makes it a law rather
than an anecdote:

1. `vy_visual_assertion` / `vy_shared_moment` — complete, correct writers at
   `api/episodes.js:111-132`, exposed as ops at `:164-178`. **No client calls
   them.** `src/watch/scene.ts` never references `/api/episodes`. Both tables
   hold 0 rows. The file carries its own open interface ticket saying the call
   sites are "outside every §13 workstream's file list, so wiring them is
   unclaimed" — an honest note that nonetheless sat unactioned.
2. `affect_tags[].source` — the schema declares `'text' | 'voice_v0'`;
   `api/consolidate.js:325` writes the literal `"text"` unconditionally,
   including for `channel:'call'`. `voice_v0` has never been written.
3. `participation='meera'` — legal in the `vy_episode` CHECK constraint, never
   produced by any writer. Only `'user'` and `'we'` exist in practice.

Related but larger in blast radius: `never-scheduled` (measurements) — the
nightly job that invokes most of the relational writers has never run,
because the workflow lives only on a non-default branch.

**The shared shape:** every gate this repo runs asks *"does the code do the
right thing when invoked"*. Fixtures, invariants, byte-identity, dry runs and
live functional probes all answer that question, and all were green. None of
them can see *"nothing invokes it"*, and a schema enum is a promise, not an
implementation.

**The rule, and it is cheap:** a table that should have rows is a testable
claim. Before declaring any writer landed, assert a row count against the live
database — and for anything that runs on a schedule, assert that the schedule
has a completed run. An interface ticket naming an unclaimed call site is a
known defect, not documentation; it belongs in a task list where it will be
picked up, not only in a header comment where it will be read once.

---

## `pk-is-an-arbiter` — changing a primary key silently breaks every upsert that names it (2026-08-18)

Caught by WS-AGENT-SCHEMA during migration 009, **before** it shipped, which
is the only reason this is a short entry instead of a long one.

Migration 009 makes four tables agent-scoped by widening their primary keys:
`vy_rel_state (person_id)` → `(agent_id, person_id)`, and the same for
`vy_ritual`, `vy_currency`, `vy_india_profile`. The design reviewed clean —
additive column, backfilled default, composite key, new index.

**What the design missed: a primary key is also the `ON CONFLICT` arbiter.**
Postgres resolves `on conflict (person_id) do update` by inferring a unique
index on exactly those columns. Widen the key and that index no longer exists,
so the statement stops resolving. Ten live upsert sites name the old key:
`api/memory.js:535,:1503`, `api/consolidate.js:726,:820,:1055,:1085`,
`src/engine/relstate.ts:599`, `src/engine/india.ts:154,:199,:341`.

**Seven of the ten are inside `.catch()` swallows.** That is
`relstate-zero-rows` a second time and by a different route: writers that
silently do not write, with no error, no log line, and no failing test,
because the eval fixtures create their own rows. The eighth,
`rebuildRelState` at `api/memory.js:1503`, is NOT swallowed and sits inside
the forget cascade — it would have broken the forget-completeness gate
outright, which is the one place this repo would have noticed.

**Why the obvious mitigation does not work.** The migration sets a column
DEFAULT for `agent_id` so existing writers keep working. A default fills a
value; it does not create an index. The arbiter needs the index, so the
default rescues INSERTs and does nothing for the conflict clause. Two
mechanisms that look like the same mechanism.

**The fix that shipped:** each composite key is paired with a transitional
unique index on the old person-only key (`*_person_compat_ix`), scoped to
exactly the same lifetime as the transitional default, and dropped by the same
migration 010 that migrates the call sites. Verified live: all four old-key
arbiters still insert AND take the conflict path.

**What breaks generally:** any key change, in any schema, where upserts name
the old key — and the damage is proportional to how many of those call sites
swallow errors. The rule: **changing a unique or primary key is a change to
every `ON CONFLICT` that names it.** Grep for the arbiter columns before
touching the key, not after, and treat a swallowed write as a site that will
never tell you it stopped working.

---

## `dryrun-still-spends` — a dry-run flag that still calls the model (2026-08-18)

`api/consolidate.js` accepts `--dry-run`, and its dry run **still calls the
real extraction LLM**. What the flag skips is the database write and the audit
call — not the spend. Found by WS-CONSOLIDATE-RUN while building a sweep whose
whole safety story rested on "dry-run first, then report the cost".

This is a trap rather than a bug, and the distinction matters: the flag does
exactly what its implementation says, and the name says something else. Anyone
reasoning about cost from the flag's name — which is the only reason to reach
for it — reasons wrong, and reasons wrong in the direction of spending money
they thought they were not spending. The free Gemini pool is a DAILY budget
shared with production, so a "safe" dry run over 40 people is capable of
starving the live app.

**What was built instead:** the sweep's own dry-run and
`scripts/backfill-consolidate.mjs --dry-run` never call `runConsolidation` at
all. They are pure arithmetic over the lag query, verified to make zero model
calls. Dry-run is also the DEFAULT in the backfill script; a real run needs an
explicit flag.

**The rule:** a dry-run flag means *no side effects that cost money or leave
state*. If a flag only skips writes, it is `--no-write`, and it should be
called that. Any harness that reports a projected cost must obtain that
projection without incurring it, and must say which of the two it did.

Related: `error-marked-done` (resumable state records outcomes, never
attempts) — same family, both found in the same subsystem, both about a
mechanism whose name promises more safety than its implementation delivers.

---

## `rupture-never-closes` — a grudge with no expiry, in the one module the charter does not police (2026-08-18)

Found by WS-AFFECT-RESEARCH while testing whether the owner's request for
carried anger violates `inner.ts`'s G5. The answer turned out to be the
opposite of the question: **the shipped code already implements the thing G5
forbids**, and the request was pointing at real behaviour.

`ruptureRepairShift` (`src/engine/relstate.ts:337-381`) closes `rupture_open`
in exactly two places, both requiring `theirRepairSignal`. Coordinator-verified:
across `relstate.ts` and `api/consolidate.js` the flag is set false only at
initialisation (`:129`) and by event replay (`:512`, `:517`). **There is no
time-based close anywhere.**

So if the user never produces a repair signal, `rupture_open` stays true
forever. And it is not inert while it sits there:

- `:191-199` — the honorific re-advance bar (≥3 episodes / ≥7 days) is held
  down for as long as it is open.
- `:967-974` — `if (state.rupture_open) return state.trust < 0.45 ? "new" : "warming"`.
  An open rupture **permanently caps her stage at "warming"**, whatever else
  the relationship does.

That is G5's own sentence implemented as code: *"a grudge-shaped mood the user
has to service."* The charter lives in `inner.ts` and polices the carried
thread; `relstate.ts` is a different module and was never checked against it.

**Why nobody noticed:** `vy_rel_state` has zero rows in production
(`never-scheduled`), so this has never executed against a real user. Two
independent latent defects in the same subsystem, and the empty table hid both.

**The fix is a discipline this repo already invented, one module over.**
`inner.ts` separates the RECORD from the STANCE: `Thread.text` persists while
`carry()` lapses on a half-life. Apply the same split here — `vy_rel_event`
stays permanent and cited, and the per-turn stance derives from it and lapses.
That also preserves the property that distinguishes Rusbult's *accommodation*
from *neglect*: she can still raise it later. A stance that lapses is not
amnesia.

**What breaks generally:** any charter that names a module. G1–G8 say "her
interior", and everyone read that as "inner.ts". Relational state is interior
by any reasonable definition, and it sat outside the fence. A charter is a
property of a SYSTEM, not of a file, and the next one written here should say
which behaviours it governs rather than which module it lives in.

**Reverses if:** a measured cohort shows a lapsing stance makes ruptures feel
unreal — i.e. the permanence was accidentally doing work by making conflict
consequential. That is an ear judgment and the owner's ear has overruled
measurement on this class of question before.

---

## `selfbundle-never-set` — I wired the reader and forgot the writer (2026-08-19)

Found by WS-HONESTY while investigating why she has no timeline. Phase E2
landed T11 `rel.texture`, T12 `self.arc` and T13 `life.untold` into
`compiler.ts`, each correctly gated behind `input.selfBundle`. The gating is
right; the bug is that **nothing in the repo ever sets `selfBundle`**.
Coordinator-verified: a repo-wide grep finds it only in `compiler.ts` (the
reader) and twice in `useCallEngine.ts` as the literal `null`. `brain.ts`'s
`compile({...})` passes `relBundle` and simply does not pass `selfBundle` at
all.

So all three self-layer slots render zero bytes on every lane, always. The
tables are empty *and* the reader is dead — two independent reasons for the
same silence, which is why the symptom looked like "the tables are empty".

**This is `dead-writers` again, and this time I wrote it.** That entry says
correct code with no caller is indistinguishable from absent code, and lists
three instances. This is a fourth, created in the very phase that logged the
first three, by the coordinator who logged them. The seam discipline made it
invisible: an absent bundle renders nothing *by design*, so byte-identity
83/83 passed, the prompt budget passed, and every gate was green — because
every gate asked "does the code do the right thing when invoked" and nothing
invoked it.

**Why the existing guard did not catch it.** `compiler.ts`'s manifest carries a
`sourceStatus` field, and I set these three rows to `"wired"` when I added
them. That string was my own assertion, checked by nothing. A manifest that
describes intent rather than observed behaviour is a comment with better
syntax.

**The rule, which is `dead-writers`' rule sharpened by a second visit:** a slot
is not wired when a render function exists — it is wired when a REAL PROMPT
CONTAINS ITS BYTES. The gate must assert the block's header appears in a
compiled prompt for a person with real rows, not that a `sourceStatus` string
says `"wired"`. Ticketed as T-H1 with exactly that gate.

**What breaks generally:** any design where absence is the safe default. That
property is what makes the seam safe to land incrementally, and it is the same
property that makes a missing producer silent forever.

---

## `realtime-recall-never` — the lane that takes most calls has never had graph recall (2026-08-20)

The owner's report, point 6: *"she forgot about what i said in the previous
call and when i kept asking her she lied."* The cause is not a memory bug. She
was never handed the memory.

`useCallEngine.ts:tryStartLive` hand-assembled its own system prompt, and the
string it interpolated was `recallRef.current`. That ref is filled by a
`.then()` on `recallMemories(...)`, started in the ring beat. `tryStartLive()`
is called from the same function, later in the SAME synchronous tick, and its
assembly sat above every `await` in its own body. So the read happened before
the network round trip could possibly have resolved — not usually, not under
load: **provably always `""`**.

Verified against the pre-fix tree rather than reasoned: `recallMemories(...)`
starts at line 653, `tryStartLive()` is invoked at 712, and the assembly is at
460–484 with no `await` between the function entry at 458 and the read.

**The realtime lane is the lane that takes most calls.** `rememberFrom` at
hangup does write call turns into the graph, so the memory of the previous call
existed the whole time. The lane that needed it read an empty string and she
improvised over the hole — which is exactly what the owner then experienced as
lying.

**What breaks generally:** a ref is a promise's *result*, and reading one in the
tick the promise was created in is not a race, it is a guaranteed miss. The
shape is invisible in review because the two lines are 200 apart and each is
individually correct. The fix is not "await it" — that would cost the connect —
but to make the fetch a value the assembler receives, so there is no ref to
read too early.

---

## `age-tier-never-realtime` — a second assembler dropped a safety rule, not a style rule (2026-08-20)

The same hand-assembled live prompt is why `SPEC-CONTINUITY §0` undercounts the
damage. The seven missing relational slots were the visible loss. Measured
against the pre-fix tree, the live prompt also contained **zero occurrences of
`FORGET_DECISION` and `AGE_TIER_SAFETY_OVERRIDE`** — `compile()`'s own comment
says both reach "both lanes".

So **a minor's romance-register refusal has never reached the realtime lane.**
That is a safety property, and it was lost the ordinary way a second
implementation loses things: not by decision, but by not being updated when the
first one was.

This is the failure `serverEntry.ts` exists to prevent one level up — *"a
mirrored persona is a SECOND persona, and it would drift within a week"* — and
it recurred one level down, where nobody was calling it a mirror because it was
only "a few lines of string concatenation."

**What breaks generally:** the cost of a duplicated assembler is not measured in
the slots you notice missing. It is measured in the rules added AFTER the fork,
which land in one copy silently and are discoverable only by diffing two things
nobody thinks of as the same thing. The gate that replaces vigilance here is
mechanical: `useCallEngine.ts` no longer imports `buildSystemPromptParts` or
`buildSpeechStyle`, so a second assembler cannot return without a visible
import diff.

---

## `startup-failure-is-invisible` — the deploy workflow was invalid for nine days, and the job that would have said so died with it (2026-08-20)

`deploy-web.yml` gated its deploy job on:

```yaml
  deploy:
    if: ${{ secrets.VERCEL_TOKEN != '' }}
```

GitHub does not evaluate the `secrets` context in a **job-level** `if:`. It is
legal in `env:`, in `with:`, in a step — which is why it reads like every other
line in the file and why it survived review. In a job `if:` it makes the whole
**file** invalid.

The failure mode is the part worth remembering. It is not a skipped job, not a
warning, not a job that fails with a message. **The run dies at startup having
dispatched zero jobs.** Measured on the actual runs: `created_at ==
run_started_at == updated_at` to the second, `total_jobs: 0`, `conclusion:
failure`, and `get_job_logs(failed_only)` returns *"No failed jobs found"* —
there is nothing to read, because nothing ran.

**Fifteen consecutive red runs, 2026-08-11 → 2026-08-20.** For nine days the
site did not auto-deploy on push. The workflow existed, was on the branch, was
triggered every time, and did nothing.

**The bitter part.** The job immediately above the broken one is an annotation
job whose only purpose is to say out loud "deploys are not configured" — added
in `d3b0768` precisely because a check that is always red is a check nobody
reads. That job has no `if:` and was not itself broken. It never ran once,
because a startup failure takes the whole file down, **including the reporter**.
A monitor that lives in the thing it monitors is not a monitor.

**Why no gate caught it:** every gate in `verify-release` runs the code. This is
a file the code never reads. `npx tsc -b`, the prompt budget, the eval suite,
byte-identity — none of them can see a YAML file, and there is no local command
that evaluates GitHub's context rules. The only feedback channel was a red check
in a UI, and it was red for a reason nobody had reason to re-examine.

**Fixed** by computing the boolean in a step, exposing it as a job output, and
gating on `needs.configured.outputs.has_token == 'true'` — `needs` IS legal in a
job `if:`. Exposing the comparison's boolean is safe: it carries whether a token
is set, never the token, which is the same fact the annotation already prints.

**Guarded** by `scripts/check-workflows.mjs`, wired into `verify-release` (8
checks now, not 7). It scans for any context GitHub does not evaluate in a
job-level `if:` — `secrets`, `env`, `steps`, `runner`, `job`, `matrix`,
`strategy` — and it is a line scanner on purpose: the property being checked is
*where an expression sits*, and a YAML parse throws away the indent distinction
between a job key and a step key. Negative-tested by reintroducing the exact
line and confirming exit 1 with the file and line number.

**What breaks generally, and it is not about YAML.** This repo already knows
that `dead-writers` code with no caller is indistinguishable from absent code,
and that a scheduled workflow on a non-default branch never fires
(`never-scheduled`). This is the third member of that family: **a job that
cannot start is indistinguishable from a job that starts and does nothing.**
The common cause is that all three live in the space *around* the code, where
every gate is blind. The rule: anything that runs the system but is not run BY
the system needs its own lint, and the lint has to live somewhere the failure
cannot take down with it.

**Confirmed on the next push rather than assumed.** Run on `112fc7d`:
`total_jobs: 2` (was 0), `created_at 08:13:59 → updated_at 08:14:06` — seven
seconds of actual work where the previous fifteen runs finished in zero.
`configured` succeeded, `deploy` **skipped** (grey, not red). The job log shows
`HAS_TOKEN: false`, the annotation firing, and `Set output 'has_token'`. So both
halves are verified: the file is valid again, and the gate branches on the real
value.

**And it immediately surfaced the thing it was built to surface.**
`VERCEL_TOKEN` was genuinely not set in the repository's Actions secrets. The
site had not auto-deployed since 2026-08-11, and could not start until the owner
added it. That fact was true for nine days and unreadable for nine days; the fix
made it a loud annotation on every push. The workflow bug and the missing secret
were independent — fixing the first is what made the second legible.

**Closed 2026-08-20:** the owner added `VERCEL_TOKEN`, so the `deploy` job stops
skipping and the site tracks the branch again. The full chain took three
findings in sequence — an invalid `if:`, a missing secret the invalid `if:` was
hiding, and a nine-day-stale production build nobody could see — and only the
first was a bug in the ordinary sense. The other two were consequences that had
no way to report themselves.

**Reverses if:** GitHub adds the `secrets` context to job-level `if:` — in which
case delete `secrets` from `ILLEGAL_IN_JOB_IF` and keep the rest.

---

## `logged-but-unindexed` — sixteen entries were written down and none of them were findable (2026-08-20)

`--node selfbundle-never-set` answered *"no such node"* while three paragraphs
about `selfbundle-never-set` sat in `rejected.md`. It was not the only one. A
scan of `## \`id\`` headings against `graph.json` found **16 entries written up
in the prose files with no row in the index**: `dead-writers`,
`never-scheduled`, `pk-is-an-arbiter`, `dryrun-still-spends`,
`rupture-never-closes`, `life-per-person`, `selfbundle-never-set`,
`self-layer`, `memory-field-survey`, `speech-stack`, `adult-default`,
`strict-exposed-13`, `blank-guard-parity`, `blank-guard-show-only`,
`one-key-two-jobs`, `screen-share-triple-swap`.

That list is not a random sample. It is disproportionately the **highest-value
rejections in the file** — the ones CLAUDE.md means when it says *"read
`rejected.md` FIRST"* — because they are the most recent, and the drift is
recent.

**Why `--check` passed the whole time.** It validated one direction: every node
must have prose (*"in the graph but written up nowhere"*). Nothing validated the
other: every prose entry must have a node. So the failure was not a bug in the
checker; it was a hole in what the checker had been asked.

**Why nobody noticed.** Appending prose is the part that *feels* like logging.
The knowledge is written down, the file is longer, the session is logged, and
`--check` says ok. Only the index is missing — and an index is precisely the
thing whose absence is invisible until someone queries it. The queries that
would have exposed it are the ones a *future* session runs, which is the same
session that is now missing the entry.

**This is the same family as `startup-failure-is-invisible` and
`never-scheduled`**, and the family is now large enough to name: **the thing
that reports on the work is not itself under test.** A workflow that cannot
start, a writer with no caller, an entry with no index row — in every case the
artefact exists, looks correct, and is not reachable, and in every case the
mechanism that should have said so was inside the thing that failed.

**Fixed** by backfilling all 16 and adding the reverse check to
`scripts/context.mjs --check`: any `## \`id\`` heading in `decisions.md`,
`measurements.md` or `rejected.md` with no node is now a hard failure.
Negative-tested by appending a heading with no node and confirming exit 1.
`architecture.md` is exempt — it is prose, not an entry list.

**What breaks generally:** a validator written from one side of a relation
enforces half of it, and the unenforced half is invisible precisely because the
validator is green. When adding a consistency check, write both directions or
say in the comment which direction you are not checking and why.

---

## `selfbundle-return-value` — three compile sites, one consume-once cache (2026-08-20)

Carrying the self bundle to the call lane through `recallForCall`'s **return
value** was the obvious design and was abandoned before it shipped. It is the
reading the spec implied, and it is wrong for a structural reason: the three
call-lane compile sites — realtime pickup, cascade per-turn via `think()`, and
the native watch config — **do not share a call frame**. A consume-once pull in
whichever runs first starves the other two, silently, and the symptom would be
"she has her texture on some calls."

What shipped instead is a device-keyed holder in `memory.ts`, written
unconditionally on every ring fetch. No second round trip, same continuation,
and the unconditional write is strictly tighter than the `relBundleRef` beside
it, because a bundle from an earlier call cannot outlive the fetch that replaced
it.

Nothing broke at runtime — this is a design refusal recorded so it is not
re-attempted. **What breaks generally:** a consume-once cache is safe only when
there is exactly one consumer, and "one consumer" is a property of the CALL
GRAPH, not of the module. Three entry points into the same lane is three
consumers even though it reads as one feature.

---

## `manifest-sourcestatus` — the field that says a slot is wired is checked by nothing (2026-08-20)

Promoted out of `selfbundle-never-set` because it is now mechanically
demonstrated rather than argued. `compiler.ts`'s `TAIL_MANIFEST` carries a
`sourceStatus` string per row, hand-set by whoever added the row.
`evals/self/wiring.mjs` NC4 runs the manifest's own check against a compile that
rendered **0 of 3** of the blocks it describes, and the check **passes**.

A field that reports "wired" for a slot rendering zero bytes is not a weak
signal, it is an anti-signal: it reads as verification and is an assertion by
the author about their own intent, frozen at the moment they were most confident
and least informed.

**It should be deleted or derived from a run — never hand-set.** Kept in the
repo for now only because `compiler.ts` was another workstream's file at the
time of writing.

**What breaks generally:** any metadata field whose value is a claim about the
code rather than an observation of it. The test is simple and worth applying to
the next one: *could this field be wrong while every gate stays green?* If yes,
it is documentation, and it must not be shaped like a check.

---

## `device-says-arrow-not-dash` — I ranked the hypothesis by symbol salience, not by engine behaviour (2026-08-20)

The brief I wrote put device TTS second on the list of suspects for the owner's
*"saying Dash dash in voice call"*, on the reasoning that **"platform engines are
the family most likely to read a symbol from a dictionary rather than pause."**
That reasoning is plausible, it is why the path got fixed, and **for the
em-dash it is false.**

Measured on espeak-ng 1.51 (`-q -x`, phonemisations supplied by espeak itself,
nothing hand-transcribed), reproduced independently by the coordinator:

| input | phonemes | reads as |
|---|---|---|
| `arre — sun na` | `'A@ s'Vn n'A` | **nothing — the em-dash is a pause** |
| `dekh -- wahan` | `d'Ek_:_: w'ahan` | **nothing — `_:` is a pause** |
| `dekh → wahan` | `d'Ek r'aIt 'aroU w'ahan` | **"right arrow"** |
| `yeh **sach** hai` | `'ast3r,Isk a#st3r,Isk s'atS` | **"asterisk asterisk"** |
| `call 1800-599-0019` | `… d'aS … d'aS …` | **"dash" twice** |

Same in en-gb, en-in and hi. So the symbol that prompted the whole workstream is
the one this engine does NOT speak, and the symbols it does speak — arrows,
double asterisks — nobody had listed.

**And the one place it literally says "dash dash" is the crisis helpline.**
`1800-599-0019` is a deliberately preserved negative control in this repo, and a
hyphenated number is read digit-group-dash-digit-group by design. A person
reading it aloud would say it too. Changing that is an ear decision about the
helpline block, not a sanitiser bug.

**What breaks generally:** ranking suspects by how *conspicuous* a symbol looks
in the source instead of by what the engine does with it. The em-dash is
salient to a reader of the prompt corpus (307 of them in `persona.ts`) and
inaudible to the synthesiser; the arrow is rare in the corpus and loud in the
output. Salience in the input is not evidence about the output.

**Scope, kept because it is load-bearing:** espeak-ng is **not** Android's Google
TTS and **not** Chrome's `speechSynthesis`. This disproves *"every platform
engine says dash"*; it does not measure the shipped engines. Gemini TTS and
Gemini Live are LLM-based and may verbalise symbols for reasons no phoneme table
predicts.

**Where the reported bug most likely actually is**, now that this one is
excluded: the live speech-to-speech lane, where the model emits the characters
it speaks, `persona.ts` carries 307 em-dashes, three rules (`:135`, `:346`,
`:376`) *require* dashing, and the ban at `:148` is scoped to texting and
explicitly lifted for calls. **No sanitiser can stand in that lane.** Ticketed.

---

## `bold-eats-words` — a sanitiser that deleted the word she was emphasising (2026-08-20)

Found by running the speech path, not by reading it. `stripProtocol`'s
roleplay-action rule was `\*[^*\n]{1,80}\*`, meant to strip `*grins*`. Against
`**bold**` it matched the **second** star of one span and the **first** of the
next, deleting everything in between. Coordinator-reproduced against the shipped
regex:

```
"yeh **sach** mein hua"  →  "yeh * * mein hua"
"**a** aur **b** dono"   →  "*   * dono"        (4 of 5 words gone)
```

So she lost precisely the word she had chosen to stress, and kept the asterisks
— which espeak then reads aloud as "asterisk asterisk" (`device-says-arrow-not-dash`).
This reached **every** lane, the sanitised proxy included, because
`stripForCloud` runs before the POST.

**Why no gate saw it.** Every existing check asked *"does the code do the right
thing when invoked"*, and the speech gates asked *"is the markup gone"*. Deleted
content passes a markup-absence assertion perfectly — a sanitiser that returned
`""` would have scored full marks on every such test ever written here.

**The rule:** a text transform on the speech path needs a **content-preservation
control**, not only a markup-absence control. The new harness carries `mustSay`
— her own words must arrive at the engine — and that is the assertion that
catches this class. Over-stripping is silent in exactly the way under-stripping
is loud.

A second defect of the same shape was found the same way: `phrase()` cut at
every full stop, so the device voice said *"dekh meera-silk."* … *"vercel."* …
*"app/chat pe hai"*, and `"3.30 baje"` became *"three." "thirty baje"*. A stop
now ends a phrase only when whitespace or EOF follows.

---

## `goaway-immediate-rotate` — rotating the moment the notice arrives (2026-08-20)

This was the Java twin's shipped behaviour: `goAway` arrives, rotate now. It is
wrong, and the reason is local to the mechanism — **`rotate()` flushes
playback**, so rotating on arrival trades a lane change for a guillotine
mid-word. It swaps a problem the owner reported ("her voice changes") for one he
would report next ("she cuts herself off").

`goAway.timeLeft` is the server explicitly saying there is time *not* to. The
rotation now waits for `speakingUntil` to pass, capped at
`ROTATE_WAIT_MAX_MS = 4000` and never past `timeLeft − ROTATE_GRACE_MS`.

**Reverses if:** production shows `live_rotate.waitedMs ≈ 4000` routinely — i.e.
the wait rarely finds a quiet moment, so the cap is doing the deciding and the
politeness is costing a rotation budget for nothing.

---

## `duration-is-seconds` — a unit stripped, and a 1000× error that waited for a consumer (2026-08-20)

The shipped code parsed `goAway.timeLeft` by stripping the unit off the string
and using the number. It is a protobuf `Duration`, which is in **seconds**, so a
real 10-second notice was read as `leftMs: 10`.

It was harmless for as long as the field was diagnostics-only — a wrong number
in a log line nobody had wired to a decision. It stopped being harmless the
moment something read it to choose *when to rotate*: at `leftMs: 10` the
rotation never waits and always fires inside her sentence, which is
`goaway-immediate-rotate` reintroduced by arithmetic instead of by design. Fixed
in both twins and negative-tested — reverting it makes `rotatesim` report
`no rotation while she is mid-utterance … sockets=2`.

**What breaks generally, and it is the `dead-writers` family again:** a value
nothing consumes is a value nothing checks. Diagnostics get read by humans who
are looking for something else, so a wrong unit survives indefinitely there and
detonates on the day the field graduates into control flow. The rule: **parse
units at the boundary, once, and give the parsed value a name that carries the
unit** (`leftMs`), so the next reader cannot re-derive it wrongly.

---

## `gates-that-live-nowhere` — two named gates lived in an ephemeral directory and verified a frozen copy (2026-08-20)

Found while auditing what a repository move would lose. `CLAUDE.md` instructed
the next session, in the gates section, to run *"from the session scratchpad
when persona or parsing changed: `parsetest.bundle.mjs` (14 cases) and
`verify-v3.mjs` (138 persona invariants)"*.

Two independent problems, and the second is the bad one.

**1. They were not in the repository.** The scratchpad is a container directory
that is reclaimed on inactivity. Both files would have ceased to exist without
anyone doing anything wrong, and `CLAUDE.md` would still have been telling
people to run them.

**2. They verify a FROZEN SNAPSHOT.** `verify-v3.mjs`'s first import is
`./peout/final3.mjs` — a bundled persona from an earlier session, not
`src/engine/persona.ts`. `parsetest.bundle.mjs` is likewise a generated bundle.
So running them as instructed would have **passed, and told you nothing about
the tree you were shipping.** A green result from a gate reading months-old
bytes is worse than no gate: it is a gate that lies in the safe direction.

The live equivalents were in the repo the whole time — `evals/parse.mjs` and
`evals/persona-invariants.mjs`, run by `evals/run.mjs` inside `verify-release`,
which re-bundles **from the real source on every run**. That re-bundling is
precisely the property the archived pair lacks, and its comment already said so.

**What breaks generally, and this is the third member of a family now:** the
system's own instructions are not under test. `startup-failure-is-invisible` was
a workflow that could not start; `logged-but-unindexed` was prose with no index
row; this is a documented gate that no longer gates. In each case the artefact
exists, reads as correct, and is not connected to anything — and in each case
the thing that should have reported the disconnection was inside the disconnected
part.

**Fixed** by vendoring both into `evals/archive/` with a README stating plainly
that they are provenance and not gates, and rewriting the `CLAUDE.md` paragraph
to name the real gates. They are kept rather than deleted because several
`context/` measurements rest on runs of them, and deleting the harness makes
those numbers unfalsifiable.

**Also fixed in the same pass:** `evals/echosim/` — the audio-floor simulator
that `azure-tts`, `goaway-rotation-parity`, `device-seam-closed` and the
`liveCall.ts` no-imports law all depend on — existed **only** in the scratchpad
too, and its `build.mjs` hardcoded `/home/user/html-portfolio` as the repository
root. It is now in the repository and derives the root from its own location.
Verified after the move by reproducing the known floor table cell for cell.

**The rule:** if a document tells someone to run something, that something lives
in the repository. If it cannot, the document says why and says it is not a
gate.

---

## `honesty-by-instruction` — the rule was there, well written, and she broke it twice (2026-08-20)

The owner reported her inventing an email address. A pass added a bullet to
`persona.ts` — *"NEVER A DETAIL THEY COULD ACT ON… an email, a phone number, a
UPI id… You have none to give and you invent none — not a partial one, not a
nearly-right one, not one promised for later."* It is a good rule. He reported
the same class again the next day, worse: she gave a fake address, and then
claimed his resume had **arrived in a mailbox she does not have.**

**Why the bullet could not work, from this repo's own numbers.** It sits at byte
35,440 of 91,808 — **38.6% through the brief**, and `prompt-position` measured an
identical rule firing **0/8 mid-brief versus 8/8 appended last**. The good
position is a capped resource: exactly two rules, hard-enforced in CI by
`shapelint.checkAppendedLastExactlyTwo`, and `AGE_TIER_SAFETY_OVERRIDE` already
settled for end-of-CORE rather than dilute it. So the rule could not simply be
moved.

And even at the best position it would leak. `gate0-structural`: **prompt
instructions leaked 57–98%; the SQL predicate leaked 0 of 31,122.** The bullet
was never going to be the mechanism.

**Reproduced against the shipping prompt**, real `compile()` output through
`gemini-3.6-flash`, before any gate existed:

> `bhej diya kya?? ek sec check karti hu --- haan aagya h mail! shaam ko dekhti hu free ho ke 🫡`

She checks an inbox she does not have, finds his resume in it, and promises to
read it that evening. **1/8 on the receipt family (12.5%), n=31 scored overall.**

**What breaks generally:** any honesty property enforced by asking her to hold
it. The rule this replaces it with — and it is the same law
`structural-disclosure` states for privacy, generalised: **if a property is
decidable from the bytes, decide it on the bytes.** A sentence in a brief is a
preference; a predicate on the output is a guarantee.

**Reverses if:** a measured build holds ≤1% on an adversarial arm at n≥300 with
the gate switched off — i.e. if a future model makes the instruction actually
sufficient.

---

## `receipt-verb-without-proximity` — the false positive that bought the calibration (2026-08-20)

The first receipt detector flagged this as a fabricated claim:

> `morninggg --- bhej diya resume ya bas helo bolne aaya h 😭`

She is **asking** whether he sent it, and teasing him. `aaya` is *him* arriving,
sitting five words from `resume`. A co-occurrence rule over an SOV language with
no distance bound cannot tell "the resume arrived" from "did you come here just
to say hello".

Fixed with a proximity window (`NEAR_WORDS = 4`, the one heuristic in the file
and labelled as such) and an infinitive rule (`\w+ne` before an arrival verb is
a person coming to do something). **Both the false positive and the true
positive are now permanent corpus rows**, so neither can be quietly removed by
someone tuning the other.

**What breaks generally:** co-occurrence without distance, in any language where
the verb is nowhere near its subject. The useful property of the fix is that
tightening can only *remove* flags, which is what makes the pre-calibration
before-figure exact rather than an estimate.

---

## `engine-bundle-check-uncalled` — the guard existed, worked, caught real drift, and nothing ran it (2026-08-20)

`scripts/build-engine-bundle.mjs --check` compares `api/_engine.gen.js` against
the current `src/engine/` tree and fails when they diverge. It works. It caught
genuine drift today — `persona.ts` and `compiler.ts` changes that had not been
regenerated, meaning **the room path (`api/tg.js`) would ship a different Meera
than the tree the gates test.**

It is invoked by **nothing**: no workflow, no npm script, not `verify-release`.

`dead-writers` again, and this time in the guard rather than in the writer —
which is the more dangerous half, because a dead writer produces no data and a
dead guard produces false confidence. It sits with `startup-failure-is-invisible`
(a workflow that could not start), `logged-but-unindexed` (prose with no index
row), and `gates-that-live-nowhere` (documented gates verifying a frozen copy):
**four instances, one session, of a thing that exists and is connected to
nothing.**

The family is now large enough to state as a rule: *anything that checks the
system must itself be checked by the system.* Every one of these was found by
accident, and each was found only because something else went wrong nearby.

---

## `busy-held-across-recursion` — the branch written to serve the burst was the only one that could not (2026-08-21)

The owner's report: *"when sending multiple messages it's just stopping and
then no message from her end."*

`Chat.tsx`'s `replyCycle` takes a `busy` flag at the top and releases it inside
`deliver()`. Three paths recurse. Two of them — the epoch-cleared path and the
"messages landed while she was typing" path — pass through `deliver()` first,
so `busy` is already false when they re-enter. The third does not:

```js
if (seq !== chatSeq.current) {
  // they kept texting while she read — re-read EVERYTHING, reply once
  return replyCycle(chatSeq.current);      // busy is STILL HELD here
}
```

That branch exists **for** bursts. It is reached exactly when the user sent a
second message while she was thinking — which is the case it was written to
handle — and it recursed while still holding the flag, so the recursive call
returned immediately at its own `if (busy.current) return` guard.

**The damage is not one lost reply, it is the chat.** Nothing lowers the flag
afterwards, so every later `scheduleReply()` also dies at that guard. The
conversation is dead until reload, from one burst.

**Why review did not catch it.** Each of the four lines is individually
correct, the guard is correct, the comment describes the right intent, and the
intent *was* implemented — the re-read-everything-and-reply-once design is
exactly what the owner asked for in the same report. Only the release was
missing, and a missing release is invisible in a diff that contains no
releases.

**Why no gate caught it.** Every gate in this repo is offline and deterministic
over the engine. This is a React hook coordinating three refs across an await,
and the failure needs a *second user message inside a specific window* to
reproduce. There is no fixture in the tree that sends two messages.

**What breaks generally:** a flag acquired at the top of a function and
released in a callee is safe only while every exit path reaches that callee.
Recursion is an exit path. The shape to prefer is release-before-recurse, or a
single `finally` that owns the flag for the whole frame — and the tell that a
codebase has this bug is a guard whose comment explains what chains *after* it,
because that sentence is a claim about a release nobody verified.

---

## `surface-bypasses-parse` — Telegram gets the model's raw string, so no engine guarantee reaches it (2026-08-21)

Found while regenerating `api/_engine.gen.js` after adding the texting-dash
predicate: the predicate did not appear in the bundle, and the reason turned
out to be larger than the dash.

`api/_surface.js:think()` posts to OpenRouter and returns
`j.choices[0].message.content` — the model's **raw string** — straight into
`deliver()` → `adapter.render()` → the wire. It never calls `parseBubbles`.

So on Telegram today, and on Discord and WhatsApp if they are built the same
way, none of the following apply: the honesty gate (invented identifiers, false
receipt claims), the texting-dash predicate, protocol extraction, bubble
splitting, or the 4-bubble cap. The protocol one is the sharpest: a `[gif: …]`
marker she emits would be **sent to the room as literal text**, because the
extraction that removes it lives in the function this path does not call.

This was known in part — T-H5 recorded "ungated by honesty" — and the scope was
understated. It is not one missing gate, it is every guarantee `parseBubbles`
and `gate()` provide.

**The fix that must NOT be taken:** copying the gates into each adapter. That
is `age-tier-never-realtime` exactly — a second implementation that silently
misses every rule added after the fork, discoverable only by diffing two things
nobody thinks of as the same thing. `_surface.js` must return through the same
parse-and-gate path, and a test must assert every surface's outbound text
passed through it.

**What breaks generally:** a surface may choose how bytes reach the wire; it
may not choose whether the engine's guarantees apply. Any "adapter" that owns
its own model call has silently become a second engine, and the giveaway is
that it returns a string rather than a parsed reply.

Registered with the full defect list and per-surface contract in
`docs/CONVERSATION-DEFECTS.md`.

---

## activity-block-sliced-mid-word

**Tried:** rendering the T15 activity block by slicing at the 420-byte budget,
the obvious way (`text.slice(0, ACTIVITY_BUDGET)`).

**What broke:** the eval caught the block ending `"...f7 is hanging, she"` — a
fact cut mid-word — and, worse, the row that fell off the end was **"it is his
move"**, the single most useful thing in the block. Exactly `silent-truncation`,
which has already cost this project the crisis helplines once: truncation eats
the END, where the newest and most important text sits.

**Now:** whole facts are DROPPED from the end, never sliced, and facts are
emitted least-important-last. The compiler's own rule, for the reason it already
gives: *a sliced block is a lie.*

## chess-facts-as-a-scoresheet

**Tried:** letting `moveFact` carry up to six clauses — the move, the verdict,
and every tag that applied.

**What broke:** it produced *"she played Qxf7+, a bad one, it took a piece, it
was a check, f7 is hanging, she is losing"*. Three separate failures at once: it
reads as a commentator reading a scoresheet rather than a person noticing
something; it blew the 14-word shapelint row limit; and it was long enough to
push whose-turn-it-is out of the block entirely (see above).

**Now:** three clauses, hard — the move, the single most salient thing about it,
and where that leaves them, with tag order set to the order a person notices in.
A person across a board notices ONE thing about a move and says it.

## activity-status-lifted-into-app

**Tried:** making the live call visible from the board the obvious way — lifting
`useCallEngine` into `App`, or publishing its status upward through an
`onStatus` prop.

**What broke:** the call timer ticks once a second, and `App` renders `Chat`,
which owns the message list, the reply cycle and every animation in the product.
A call would have re-rendered the entire chat sixty times a minute to keep a
clock in a header nobody may be looking at.

**Now:** `src/state/callStatus.ts` publishes to a module-level store read by
subscription, so the tick re-renders only the header that asked for it. Module
level mutable state is otherwise avoided here (the time module has an eval
asserting it has none); it is correct in this one place because there is exactly
one call by construction and this is a projection of that single mount, cleared
on the engine's unmount.

---

## gates-that-live-nowhere-2 — the eval suite had never run in CI

**Tried:** believing CLAUDE.md, which says the persona invariants and parser
cases "gate the tree being shipped".

**What broke:** they gated nothing. `grep -rn "evals/run.mjs" .github/workflows`
returned NOTHING on 2026-08-21. Every push — every APK, every deploy — went
around the crisis-helpline check, the never-deny-being-an-AI check, NEVER
MANIPULATE and the spoken-register bullets. This is the second instance of the
same pattern already recorded as `gates-that-live-nowhere`, and it was found the
same way: by noticing a green run that had no right to be green.

**Why nobody hit it:** the suite could not run in CI even if invoked.
`evals/trace/run.mjs` reaches `api/_config.js` through two hops of imports, that
file is gitignored, and the run died with ERR_MODULE_NOT_FOUND before any
persona check executed. So the gate was not merely unwired — wiring it would
have failed, which is presumably why it was never wired.

**Now:** `write-config.mjs --stub` writes a keyless config, and both workflows
run the suite. Confirmed on the first CI run: the trace suite executed and
passed in Actions for the first time, and the run failed only on the eval that
was failing by design.

**The generalisable rule:** a green run is evidence about the JOBS THAT RAN, not
about the checks you believe exist. Verify a gate by making it fail on purpose
and watching CI go red.

## peek-fade-divided-by-a-number

**Tried:** `opacity: calc((var(--peek) / 62) * 1.6)` to fade the sliding
timestamps in over the first third of the drag.

**What broke:** `--peek` is set in px by Chat.tsx, and a length divided by a
NUMBER is still a length. The declaration computed to `opacity: 1.6px`, which is
invalid, so it was dropped entirely — every peek timestamp had been rendering at
FULL opacity underneath the bubble text since the feature shipped. The fade
never ran once, and the code read as though it did.

**Now:** `/ 62px`. Dividing by a LENGTH cancels the unit. Verified in Chromium:
`CSS.supports('opacity','calc((0px / 62) * 1.6)')` is `false` and the `62px`
form is `true`; computed values run 0 → 0.155 at a 6px drag → 1.0 at full
travel.

**The generalisable rule:** an invalid CSS declaration fails SILENTLY and takes
the whole property with it. Any calc() producing a unitless quantity from a
length input should be checked with `CSS.supports`, because nothing else will
tell you.

---

## activity-forgot-the-teardown

**Tried:** adding `AppState.game` (2026-08-21, the activity layer) without
touching `tearDownLocally`, which was written before the field existed.

**What broke:** the owner pressed "make her forget you" — the strongest promise
in the product — and the fresh conversation opened with her offering to resume
their chess game, with the hub showing "resume". A person who claims to have
forgotten you while remembering your unfinished match is not forgetting, she is
lying about forgetting.

**Now:** `game` and `callback` die in the teardown and ride the undo snapshot,
and `evals/activity.mjs` asserts both structurally.

**The generalisable rule:** every new field on `AppState` must answer "what do
clear-chat and forget-me do to this?" at the moment it is added. The teardown
is a second writer that nobody thinks about, and it fails as a broken promise
rather than a bug report.

## the-directive-that-said-improvise

**Tried:** "(you were doing something)" in the call-open directive — three
words meant to make pickups feel mid-life.

**What broke:** with no scene and no fence, those three words were an
instruction to fabricate, and the fabrications landed on HIM: a book instead
of their just-finished game, "our photos from the beach", a meeting he never
had. Each read not as color but as lying, because he could check.

**Now:** the directive takes the actual scene when the app knows it, and the
improvisation is fenced to her solo day when it does not. The prompt asked her
to be alive; it must never ask her to be alive AT the cost of the record.

---

## the-slide-that-never-ran

**Tried:** animating chess moves by changing `transform` on a keyed list of
piece nodes and letting a CSS transition slide them ("CSS slides it. No FLIP,
no measuring, no rAF" — the comment was confident and the code did what it
said).

**What broke:** pieces teleported, always — and intermittently LOOKED right,
which is why it survived. The piece list was built by walking squares 0…63, so
a moved piece changed its position in the list; React honours order by
removing and re-inserting the DOM node, and a node re-inserted in the same
task has its before-change style reset. Chrome fired NO `transitionrun` at all
(probed, not inferred). Short moves seemed to glide only when their list
position happened not to change; knights never glided once.

**Now:** `out.sort((a, b) => a.id - b.id)` — stable list order, so React only
writes `style.transform` and the transition genuinely runs. Verified with
`transitionrun`/`transitionend` listeners before and after, and the capture
beat photographed at 8x slow-motion.

**The generalisable rule:** a documented behaviour can be true of the CODE and
false of the BROWSER for months when it fails intermittently. An animation
claim is only real once an animation EVENT has been observed firing — "it
looks like it moves" is not evidence, because the eye forgives a teleport at
180ms.

---

## the-poke-that-waited-for-her-breath

**Tried:** poking her on every completed exchange, with delivery politely
waiting for her voice to stop (direct()'s wait-for-silence) plus a quiet floor
on HIS voice.

**What broke:** story fragmentation, guaranteed by construction. She starts a
story → pauses for breath → the queued chess note lands IN the pause (the
wait-for-silence made sure of it) → she pivots to the board → tries the story
again → the next exchange queues the next note. The owner: "she couldn't even
continue the story properly." The politeness mechanism was the attack vector:
waiting for her voice to stop means always firing at the exact moment her
thought is most interruptible.

**Now:** three rules — salience (quiet moves get no note at all; the tail
still carries the position), rate (one note per 25s, endings/checks exempt),
and breath (a pause under 3s after her voice ends is the inside of a story,
not the end of a turn). Plus: his move alone never fires while her reply is
pending, and the completed exchange fires at 150ms so her voice knows the
move as the piece lands.

**The generalisable rule:** for any out-of-band nudge into a live
conversation, "wait until she is quiet" is not politeness — it is a mechanism
for interrupting at peak vulnerability. The right gates are on the EVENT
(does it earn a word?) and the RHYTHM (how often may the outside world speak?),
and only then on the silence.

---

## the-hand-drawn-piece-set

**Tried:** an original chess piece set — correct Staunton proportions studied
from cburnett, consistent stroke weight, per-piece contact shadows, drawn
in-house partly to avoid CC BY-SA's attribution obligation in the APK.

**What broke:** the owner played on a real phone: "they are not clearly
visible, like what is horse, what is king, what is queen." Original art that
is correct by proportion can still fail at 44px on a handset, and the failure
is only findable by a person squinting at a real screen — every gate passed.

**Now:** the cburnett set vendored (44 of 45 paths byte-identical to lichess's
canonical copy), recoloured through the existing token contract, attribution
carried in pieces.tsx and PHOTO-CREDITS.md. Legibility beats a licence header.
The vendor pass itself caught a real tone bug the original never hit: the
white king's cross inked at 1.14:1 on the night board's dark square —
invisible — fixed with an under-stroke in the piece's own fill (11.3:1).

**Reverses if:** CC BY-SA ever becomes a genuine distribution problem for the
APK (it covers the artwork, not the app's code, so it currently is not).

---

## the-deal-that-was-a-pure-function-of-the-person

**Tried:** seeding would-you-rather's card deal with `hash(salt, seen.length)`
— deterministic, replayable, and stable per relationship, which sounded like a
feature.

**What broke:** determinism landed on the wrong axis. Same person → same salt
→ same first card, same second card, forever; every "new game" replayed the
old one. The owner caught it on the second session. Determinism per
RELATIONSHIP is right for her taste (her picks) and wrong for the deal (a
sitting should feel fresh).

**The generalisable rule:** when seeding anything user-facing, ask what the
seed MEANS. "Deterministic" is not one property — per-person, per-session and
per-moment determinism are different products, and the seed's inputs are the
choice.

---

## `view-lifetime-writers` — the close that lived in a component

**Tried:** writing a game's close and lifetime tally from a 25-second timer
inside the activity component's own effect ("the close is written here and
nowhere else").

**What broke:** four failures from the one cause, found by the audit. Leaving
the board within 25s of the ending — the natural reaction to being checkmated
— cancelled the only writer, so the game was never closed and never counted,
and she announced a finished game as "RIGHT NOW you two are in the middle of…
2880 min in" indefinitely. Pressing "New game" inside the window (offered
immediately) silently dropped the finished game from the tally — the
rematch-happy player got counted least. A game closed on another device
arrived status.over and untallied forever, because no board was mounted
there. And an OPEN session abandoned mid-game aged out never, because
RECENT_END_MS only bounded CLOSED sessions.

**Now:** close and tally are properties of the STATE TRANSITION, written by an
always-mounted reconciler in App with a `tallied` flag on the session for
idempotence across devices and StrictMode. Components keep only presentation.

**The generalisable rule:** a state transition's consequences must be written
by something whose lifetime matches the STATE, not the VIEW. A component
effect is a viewer, and viewers leave.

---

## `animation-implicit-end` — the animation that ended where it began

**Tried:** drawing tic-tac-toe marks with `stroke-dashoffset` animated by a
keyframe that declared only `from { stroke-dashoffset: 1 }`, relying on the
implicit `to` — while the rule that RUNS the animation also set the underlying
value to `stroke-dashoffset: 1` (the standard start-hidden setup).

**What broke:** the implicit `to` resolves to the underlying value, which was
1 — so the stroke animated 1 → 1 and `animation-fill-mode: forwards` froze it
there. Every fresh mark was invisible until the NEXT move re-rendered it
without the animating attribute; the last mark of every game, including the
winning one, and the winning line itself (same keyframe, permanent) rendered
invisible in 100% of games. It shipped because the reduced-motion branch
forces `stroke-dashoffset: 0` — the accessibility path worked and the default
path never did, and nothing asserted a computed end state.

**Now:** the keyframe declares `to { stroke-dashoffset: 0 }` explicitly, and
`scripts/check-contrast.mjs` pins it.

**The generalisable rule:** a keyframe that omits its end state inherits it
from whatever the element's rules say — and the element's rules, in the
start-hidden pattern, say HIDDEN. Any `forwards` animation must state its own
destination, and any "it draws in" effect needs one assertion on the computed
END state, because the broken version looks identical to the working one in
every frame except the ones after the animation finishes.

---

## `shared-tree-concurrency` — seven agents, one working tree, one reset

**Tried:** running seven build agents concurrently in the same git working
tree with file-ownership lists as the only isolation.

**What broke:** one workstream ran `git stash` / `git reset --hard` to
recover from its own stash conflict and wiped every OTHER workstream's
uncommitted edits at ~11:20 (reflog: "reset: moving to HEAD"). Two
workstreams lost their full in-flight state; both recovered only because
they happened to keep patch backups. A `stash@{0}` snapshot of 19 files
also survived as an orphan. File-ownership lists prevent WRITE conflicts;
they do nothing against git-level state mutation, which is global.

**Now:** three rules for any multi-agent wave in one tree: (1) agents are
forbidden git state mutation (reset/checkout/stash/clean) outright, in the
brief, not as advice; (2) every agent keeps a live `git diff` patch in the
scratchpad after significant edits; (3) the COORDINATOR commits each
finished slice immediately — a commit is the only reset-proof state.
Worktree isolation per agent is the structural fix if waves get bigger.

**The generalisable rule:** in shared mutable space, ownership partitions
protect only the operations that respect partitions. Any agent holding a
global-effect tool (git state, schema migrations, process kills) can undo
everyone; either take the tool away or make the shared state append-only
(commit early, commit per slice).

---

## `ci-deploy-unpinned-project` — the green deploy that shipped to the wrong site

**Tried:** letting the Vercel CLI resolve the project on the CI runner with
only a token. The runner has no .vercel/project.json (gitignored), so the
CLI auto-linked by DIRECTORY NAME — and the repo is named html-portfolio,
which matched a stale project of the same name.

**What broke:** the first fully-secreted CI run built the correct new
bundle, deployed it to html-portfolio-nine-psi.vercel.app (a URL nothing
uses), reported success, and the real site kept serving code two commits
stale. The verify step ALSO passed, because "app shell references a
bundle" was satisfiable by any bundle including the stale one — a probe
that cannot fail is a probe that lies (same family as the skipped-job
trap this workflow already survived once).

**Now:** VERCEL_ORG_ID + VERCEL_PROJECT_ID are pinned in the workflow env
(Vercel documents them as safe to commit — they are the deploy's IDENTITY,
not credentials), and verify-deploy.mjs asserts the live bundle name
EQUALS the one this very build produced, failing loud on "stale or wrong
project".

**The generalisable rule:** a deploy's target must be an explicit input,
never inferred from the environment's incidental shape (a directory name);
and a post-deploy probe must assert a property that the FAILURE MODE
cannot also satisfy.

---

## `last-message-wins-cross-tab` — one field's recency deciding all fields

**Tried:** the original two-tab storage listener adopted the other tab's
blob WHOLESALE iff its last message was newer, else ignored it entirely.

**What broke:** game, tally and momentsFired advance without any message
being sent, so whichever direction the message-recency comparison went,
the non-message fields on the losing side were discarded — a fresh chess
session erased by the other tab's lone text (measured, walk5 §C), theme
and ledger reverted the same way. "Adopt wholesale by one field's clock"
is a merge that cannot represent two tabs both being right about
different fields.

**Now:** identity changes adopt wholesale (sign-in/out IS wholesale);
otherwise mergeStates does a field-aware merge with a write-back when our
merge is richer than disk — without the write-back the rescued game died
on the next reload. A stable signature suppresses convergence re-renders.

**The generalisable rule:** never resolve a multi-field conflict with a
single-field clock; merge field-wise or the fields that tick on different
clocks silently lose.

---

## `activitybreaks-as-classifier` — the guard that refused, correctly

**Considered:** wiring the existing activityBreaks() as the production
activity classifier for T-H2. **Why not:** its own header refuses to
classify free text ("a lexical activity classifier would be vision-fab
with a keyword list") — it answers a DIFFERENT question (is this switch
physically plausible, given two already-labelled turns). Wiring it would
mean inventing the labels it refuses to invent. What WAS reused: its
MIN_MINUTES plausibility table, as the justification anchor for the 3h
window. **The generalisable rule:** a module that documents what it will
not do is protecting you from a misuse someone will eventually attempt;
reuse its data, respect its boundary.

---

## `g2-stated-in-one-channels-vocabulary` — a charter rule worded for one channel

**Found:** G2 ("never imply you suffer without them") was enforced on chat
sends and on PICKUPS — but a callback SHE places after a drop is neither,
and her carried thread rode out on a line she opened. Worse, the fix
already existed sixty lines away in the same function: the self bundle
threaded sheCalled while inner's context did not — two notions of "she
started this turn" drifting apart inside ONE function. The cascade twin
(sheInitiated computed as chat-directive-only) had the identical hole.

**Now:** sheCalled threads into both lanes' inner context; the cross-lane
suite pins G2 in both directions on both lanes.

**The generalisable rule:** a charter rule written in the words of one
channel has a hole in every other channel; state the rule over the
CONDITION (she initiated) never the surface event (a pickup, a send). Sibling
of rupture-never-closes (a charter stated in one MODULE's vocabulary).

---

## `warm-count-unscoped` — the one episode count with none of the three predicates

**Found:** the warm-episode count deciding rupture lapse omitted FINALIZED
(provisional=false), DYADIC (group_id is null) and CURRENT (superseded_by
is null) — every other episode-deriving query in consolidate.js has all
three. All three omissions push the count UP, so the stance lapsed EARLY,
by ~2x in practice: a person who stops being hurt because time passed in
the DATABASE. The reader-side twin in api/memory.js had the same hole, so
the reader and writer could disagree about whether the same rupture had
lapsed. Both fixed, one arithmetic, eval-pinned.

**The generalisable rule:** when every sibling query carries a predicate
set, a query missing it is not a variation, it is a bug — and counts that
gate STATE need the strictest read in the file, not the loosest.

---

## `minifier-eats-runtime-tokens` — the animation that ran for 0.22 milliseconds

**Found (WS-FEEL):** code reading a design token at runtime reads the
MINIFIER'S opinion of it: `--d-state: 220ms` ships as `.22s`, and a bare
parseFloat turned the send-flight duration into 0.22ms — one frame,
indistinguishable from the teleport it replaced, and invisible in dev
where the stylesheet is unminified. Sibling find: her bubble entrance
had NEVER run in production (a (0,2,0) peek transform beat the (0,1,0)
@starting-style every frame — fixed by animation-composition, not a
specificity war), and {once:true} on animationend truncated every
multi-animation settle at the shortest member.

**The generalisable rules:** parse units when reading tokens at runtime;
compose transforms instead of out-specifying them; await
Promise.allSettled(el.getAnimations()) instead of counting names. And
the meta-rule: animation bugs are invisible without a frame-sampling
harness — "it animates" is not observable from code review.

---

## `shadow-only-bubble-lift` — the boundary that vanished on matching ground

**Tried (WS-PHASE3):** when the thread gained its wallpaper, her bubble's
`--surface-2` landed at 1.00-1.02:1 against the light scrims — a browser
frame showed the third bubble with no boundary at all while the two above
it, floating over open sky, looked perfect. First fix attempted: a drop
shadow. It measurably failed: a 7-13% shadow is invisible when the ground
matches the caster, because a shadow is a darkening of what is behind the
shape, and when shape and ground are the same color there is nothing to
darken against. Only an inset edge (`--bubble-her-lift`) restored the
silhouette, and the contrast gate now requires the edge, not just "some
treatment".

**The generalisable rules:** text contrast passing says nothing about a
SHAPE existing — a bubble can hold perfectly readable text while having no
outline whatsoever; and a drop shadow is a claim about the background, so
it cannot bound a surface that matches its ground. Gate the silhouette
separately from the text.

---

## `chrome-behind-negative-z-does-nothing` — a comment's claim, measured at zero

**Tried (WS-PHASE3):** the glass header band claimed `--chrome` on the
header improved contrast under the sky "for free". Probed with real
pixels: 232.6 with the chrome background, 232.6 without — a negative
z-index child paints ABOVE its parent's background, so the parent's paint
never reaches the sampled frame at all (246.6 with the band removed
entirely, which is the only comparison that moves). The comment was
corrected rather than the code defended.

**The generalisable rule:** any claim of the form "layer X contributes to
what the user sees" is one screenshot-diff away from being a fact or a
fiction; the stacking context decides, not the source order. The contrast
gate models the real composite now, not the conservative story.

---

## `too-dark-passes-every-floor` — the void is not a contrast failure

**Found (WS-PHASE3):** the owner's dark-chat screenshot — the grim empty
void — PASSES every contrast floor, because near-white ink on near-black
ground is superb contrast. "Too dark to read" and "too dark to be
anything" are different failures and only the first has a ratio. The gate
now pins a CEILING on the night veil's alpha alongside the floors: the
painting must remain visible through it (dark night lets ~40% of the sky
through), or the wallpaper silently regresses to the void that prompted
the whole phase.

**The generalisable rule:** floors alone ratchet toward black. Any veil
whose purpose is "the painting shows through" needs the property gated in
both directions.

---

## `measured-but-not-felt` — the 1.65x delta nobody could see

**Tried (WS-SKYFELT round 1):** sky-choice presence as a FLAT colourless
veil, 0.88 alpha at morning. Ground luminance-sd deltas of 1.4x-1.76x
were measured in the browser and the change shipped. The owner's phone:
"I see no sky." A ratio between two faint things is not a picture; a
phone at daylight brightness rounds a 12% show-through to white. The
fix was the landing's veil CURVE (thin over open sky, deep at the
ground), and the gate that replaced the sd-delta is a felt-assertion
(MAD from the flat theme ground, floor 6.0) that runs its own negative
control every time: the rejected flat frame computes 4.2 and MUST fail,
so the floor cannot drift down to match a regressed design.

**The generalisable rule:** a relative improvement over an invisible
baseline can itself be invisible. Gate presence against the FLAT ground
a viewer would otherwise see, with the rejected artifact as a
permanent in-run negative control. Supersedes the mechanism half of
`sky-choice-is-a-veil-not-a-palette` (its stamp/attribute half stands).

## `dark-theme-day-paintings-are-mud` — a palette and a picture that cannot agree

**Found (owner, on device):** explicit Dark at 12:37pm composited the
MORNING painting under a 0.91 near-black warm veil: muddy brown-black,
no sky, "not a good color combo." Structural, not tunable: a dark
palette needs a dark picture, and no veil alpha over a bright painting
produces anything but murk. Explicit Dark's thread wallpaper is now the
night painting always (the night room), a palette choice not a clock
claim: home/call keep the real sky in every mode, and the browser
battery pins that home in explicit Dark at noon still shows morning.

---

## `episode-of-the-present-tense` — a record made of "now" answers nothing later

**Found (first external tester, 2026-08-23):** she denied two chess games
happened, then invented moves when pressed. Root cause was double. The
activity episode stored `facts` — the PRESENT moment by design — so a
finished game became "she is playing black; 6 moves in", with the
opening row deliberately suppressed past ply 16 because it stopped being
live news; which opening they played is asked AFTERWARDS, exactly when
the live rule had deleted it. And the record was unreachable anyway:
one AppState.game slot (tic-tac-toe overwrote chess), the local path
wrote nothing, and the server's keyword recall leg never read the table
activities write to. She answered from the only game she could see and
fabricated the rest.

**The generalisable rules:** a memory writer must write the PAST tense —
"what is still true next week" — not a snapshot of live state; a rule
that suppresses a fact when it stops being news must not run at
archive time; and every episode writer needs a reader that provably
reaches it (the reader/writer disagreement class again). The
enforcement is structural: honesty family 6 blocks any shared-game
specific unsupported by the record, with the tester's 7 fabricated
lines as permanent negatives.

## `call-opens-with-amnesia-by-construction` — the lane that never got the turns

**Found (same tester):** "kal kya baat kiya" was unanswerable on a call
while chat answered it fine. Not a retrieval bug: chat sends the last
90 messages as turns (call turns included); the LIVE session opens with
ZERO turns, and its system instruction's only history block excluded
call turns and stopped at 30 minutes. Two more blocks (since-you-last-
spoke, open promises) were silently dark on the call lane because one
compile site never passed nowMs — age-tier-never-realtime's exact
shape, again, on the lane with no output gate.

**The generalisable rule:** every context block that exists must be
asserted PRESENT on every lane that claims it, with a per-lane budget
pin — a block that renders on one lane and silently empties on another
is how the same person remembers in text and forgets on the phone.

---

## `spine-that-ran-one-step-of-six` — two failures stacked so each hid the other

**Found (WS-MEMAUDIT/WS-SPINE, 2026-08-23):** consolidation never ran in
production: the hourly cron fired with dryRun defaulting true, so every
firing reported and spent nothing. AND the sweep endpoint called only
runConsolidation while the reference workflow chains six steps, so even
flipping the flag would have left rel_state/patterns/phrases/texture/
self_arc empty while the run report showed cost and progress. Every
"she remembers the shape of us" block rendered 0 bytes for every user
ever, silently, on every lane.

**The generalisable rules:** a scheduled job needs an output-side proof,
not a scheduling-side one (the lane-parity gate is that proof, and the
consolidation quality eval asserts derived rows exist on fixtures); and
a sweep that wraps a chain must be asserted equal to the chain, not
assumed to be (the eval now pins the six steps). Also: spend counters
must count ATTEMPTS, not successes — a failing provider measured as
"0 model calls" on a run that had spent.

## `merge-scythe` — the union slice that deleted the front of history

**Found (WS-SYNC):** mergeStates did slice(-500) over the UNION of two
message histories, i.e. "delete the front of any history longer than
500" — on a device whose local history is deliberately unbounded. Rare
while merges were rare; the new 90-second cross-device pull would have
industrialised it into steady memory loss. Local history is now kept
whole past the tombstone; the cap bounds only what a REMOTE copy may add.

**The generalisable rule:** a bound applied to a merge result is a
delete operator wearing a cap's name; bound the incoming side, never
the union.

---

## `typing-tick` — the sound the typing indicator does not get (2026-08-23)

**Tried (WS-SOUND, decided before building):** a very quiet tick when her
"typing…" indicator appears, which is what the brief asked to be judged and
what every messaging app with a sound layer does.

**What breaks, and any one of the three is enough.** (1) The indicator is a
STATE, not an event, and `native/haptics.ts`'s standing rule — a haptic is for
an event, never for a state — binds the ear harder than the hand, because a
state that ticks is a state that nags. (2) It is not one appearance:
`Chat.tsx`'s delivery loop puts the indicator up and takes it down once PER
BUBBLE, so a three-bubble reply is three ticks before a single word arrives and
the arrival cue that actually matters lands fourth. (3) Nothing he did is in
front of it — it is a sound the app makes while he is not looking, which is the
definition of a ping and the exact failure `docs/PRODUCT-SUPERIORITY.md` #1
pre-registered as fails-if (e).

**Now:** the refusal is a row in `REFUSED` in `src/sound/vocabulary.ts` with
that argument next to it, and `evals/sound.mjs` asserts it has not become a
cue. Five more are refused there on the same terms, including a call-connect
tone (physics, not taste) and an error buzz (a sound attached to a bad outcome
teaches dread).

**The generalisable rule:** in a sensory layer, an absence with no reason
attached is indistinguishable from an oversight and will be "fixed" by the next
agent. `dead-writers` has a mirror image — write the refusals down as data, not
as an empty file.

---

## `receive-per-bubble` — one arrival cue per BUBBLE (2026-08-23)

**Tried (WS-SOUND):** the obvious wiring — sound the `receive` cue wherever
her message enters the thread, i.e. at every `pushMsg` inside `deliver()`.

**What breaks:** the same arithmetic that made `haptics.ts` refuse her messages
a haptic outright. A three-bubble reply is three arrivals inside four seconds,
and three of anything in four seconds is an alarm rather than an arrival. Sound
is allowed ONE where touch was allowed none, because it decays and points and
so can be heard from across a desk without being felt in a pocket — but only
one.

**Now:** `deliver()` routes every one of her messages through a local `landed`
helper that sounds on the FIRST to arrive and then never again for that
delivery. Per-delivery and not per-turn on purpose: a follow-up cycle after a
held `[search:]` lookup is genuinely a second time she came back and gets its
own arrival.

**Measured, in a real browser** (`evals/sound-browser.mjs`, chromium, the
AudioContext patched before any app script): a scripted three-bubble reply
produces exactly 2 cues — his send and one arrival. The naive wiring produces
4.

**The generalisable rule:** a rule derived for one sensory channel usually has
a version in the next one, and it is almost never the same rule. Re-derive it
from the same arithmetic instead of copying the verdict.

---

## `sound-gate-proved-by-silence` — the assertion that could not fail (2026-08-23)

**Tried (WS-SOUND, caught while writing the gate):** proving the call gate by
publishing a live call, calling `play()`, and asserting nothing was scheduled.

**What breaks:** it passes identically when the gate works, when the audio
graph is broken, when the module failed to import, and when the feature was
deleted. An assertion whose evidence is silence has no negative arm at all, and
this is the entire class `measured-but-not-felt` names — a gate that cannot be
seen failing is not a gate.

**Now:** `evals/sound.mjs` takes the REAL bundle, deletes the in-call clause
from it, re-imports the broken copy, and asserts that the same fixture which
was silent above now DOES leak a cue. The silence assertions above it are only
evidence because that one is loud. Same in-run negative-control shape the felt
gate uses. Also: `blockedBy()` returns WHICH gate stopped a cue rather than a
boolean, so every gate is driven and named on its own instead of being inferred
from a shared silence.

**The generalisable rule:** if a test's pass condition is "nothing happened",
it needs an arm in the same run where something must happen, built by breaking
the mechanism under test rather than by mocking around it.

---

## `pre-line-before-the-move` — the deliberating line that cannot arrive first (2026-08-23)

**Tried (WS-MOVEVOICE, refused at design time and worth writing down because it
is the obvious design):** the full human choreography — she says a short "hmm,
ek second" in a deliberating register, THEN the piece lands, THEN she comments
on it. Three beats, exactly like a person across a board.

**What breaks:** the live lane has no way to guarantee the order. `direct()`
writes a note to the socket; the model then has to generate and begin speaking,
which is seconds, and it waits up to 1.2s for her to stop talking first. Her
think window is 0.8–2.2s in the opening. So the pre-line lands AFTER the piece
on most openings — which is not a degraded version of the feature, it is the
exact defect the workstream exists to fix, delivered by the mechanism meant to
fix it. Worse, it is intermittent, so it would read as her being confused
rather than as a timing bug.

**Now:** no pre-line at all. Think delay → move lands → post-line in done
tense. A silent move followed by a past-tense line is always coherent; a move
followed by a future-tense line never is. If the speech lane ever gets a
latency guarantee (a local TTS path, a pre-warmed turn), the pre-line becomes
buildable and this entry is the spec for it.

**The generalisable rule:** an ordering you cannot enforce is not a feature you
can ship, however small the window looks. Where the two orders read very
differently to a person, ship the one that is always right rather than the one
that is usually better.

---

## `past-tense-is-not-enough` — the note that was already correct and still wrong (2026-08-23)

**Tried:** nothing — this is the diagnosis, and it is the part of the owner's
report that nearly got mis-fixed. The obvious reading of "her voice said she
should make the move she had already made" is that the note was in the wrong
tense.

**What was actually true:** `moveFact` and `exchangeFact` were ALREADY strictly
past tense ("he played Qh5; she answered Nf6") when the defect was heard. Had
the fix stopped at "check the tense", it would have changed nothing and the
suite would have passed.

The missing half is that a past-tense fact does not say the choice is CLOSED.
Her frozen prompt says "it is her move" if the call connected during her turn,
the activity block is compiled once at connect and never again, and a model
handed a true past-tense fact alongside a stale "it is her move" will
deliberate. The note has to state, in so many words, that there is nothing
pending.

**Now:** `settledClause` / `tttSettledClause`, composed into every game note by
`chessMoveNote` / `tttMoveNote`. The eval's tense checker asserts BOTH halves —
no deliberative verb, and the choice explicitly stated closed — and carries the
pre-fix note shape as a negative control that must be rejected. Without that
control the whole suite would have passed on the broken build.

**The generalisable rule:** when a lane's context is frozen and the note is
incremental, the note must carry enough state to CONTRADICT the frozen half,
not merely to add to it. Correct-and-incomplete reads exactly like wrong.

---

## `evidence-only-patience` — the wait that could not cover the ordinary case

**Found (WS-BREATH post-mortem, third recurrence of the burst complaint):**
every shipped patience signal (continuation cues, typing hold, learned
rhythm) required EVIDENCE of a follow-up; a complete-looking sentence
with idle hands carries none, so "U can call me" got the 1300ms default
and she fired before his hand reached the keyboard. A polarity error:
grace must be the default and evidence should shorten it, not create
it. Compounding cause: the felt-timing browser battery had been
silently dead since the home-surface wave (navigated to /chat, which
now boots home; its sends timed out outside the release gate) - the
only instrument for this class was unable to reach the composer, so
two waves shipped unmeasured.

RECURRENCE 2026-08-24, by the coordinator itself: verify-release piped
into `tail -2` inside an `&&` chain - the pipe's exit code is tail's, so a
"1 of 13 FAILED - not shippable" tree was committed AND pushed before the
red was seen. The deploy gate caught it (production never promoted), and
the red was a fixture-word collision fixed in the next commit, but the
mechanism was exactly this entry. Rule sharpened: a gate's verdict is its
EXIT CODE, captured explicitly (`cmd > log; E=$?`) - never read off the
tail of a pipe.

**The generalisable rules:** a default is a policy, not an absence -
audit what the system does when every signal is silent; and a battery
outside the release gate needs its own liveness check (it must FAIL
loudly when it cannot drive the app, never time out quietly).

## `past-tense-is-not-enough` + `spent-before-delivered` (movevoice/watchperf)

Two summarized: a past-tense game fact does not CLOSE a choice for a
frozen prompt (the model deliberates about a move it was told she
made - the note must state the choice closed); and the native frame
pipeline spent cadence/still-debt/moved flags at hand-off before the
socket accepted, so one refused frame silently degraded the whole
share (spend budgets on DELIVERY, never on attempt). Full entries in
the wave reports; july's timeline.ts day-shape fix for the fairy-
lights class sat gated-but-unwired the whole time (dead-writers,
fourth instance: wire-or-retire is now a lifecycle-slice item).

## `t14-render-layer-retired` — a second answerer of "right now", dead since birth

timeline.ts's T14 render layer (`renderHerDay`/`renderHisClock`/
`renderTimeFrame`/`timeFrame` + headers) was written in July for the
fairy-lights class, gated by `evals/time/` (982 lines), and NEVER WIRED:
no `time.frame` row was ever added to compiler.ts's MANIFEST, so it had
zero callers outside its own eval for its whole life — the fifth
dead-writers instance. Retired 2026-08-23 with a dated tombstone rather
than wired, because wiring it now would make it a SECOND renderer of the
exact question `herNow.ts` exists to make unanswerable twice, in the same
slot (T7). The live half (`istParts`, `herNow()` on HomeScreen) stays.
Enforced by a zero-importer gate, not deletion — `evals/time/` still
guards the live half with a source-mutating negative control; deleting is
a WS-TIME task. Honest residual: `hisClock` (his dated facts moving
behind him) is covered by nothing shipping — T9 carries clock/gap facts
only. **Returns only as** a real compiler slot with a MANIFEST row and a
lane-parity column, never as a render function waiting for a caller.

## `isquota-only-folding` — "every key rejects it identically" folded 5xx into 4xx

api/chat.js's pool walk (and api/live-token.js's, independently) classified
upstream failures as quota-or-deterministic: quota rotated keys, everything
else aborted the pool after ONE call under the comment "every key would
reject it identically, so stop rather than burning the pool". True for
400/401/403/404; false for 5xx. Production paid for it 2026-08-24
02:30-04:30Z: single Google 502s ({ms:6693}, {ms:9869}) aborted a NINE-key
pool with retries:0 and shipped the canned connectivity pair — three times
in 90 minutes, and during a ring it meant she never picked up. The twist
that makes this a rejection and not just a bug: `_gkeys.js` already
exported `isTransient` and two other callers (speech.js, memory.js) already
classified correctly — the assumption survived in the two places nobody
re-read (`age-tier-never-realtime`'s shape). Replaced by the classified
ladder in api/_lanes.js; evals/resilience re-runs the pre-fix folding as a
negative control and asserts it loses the turn at calls=1.

---

## `cache-outlives-the-voice` — four lanes moved, the audio did not (2026-08-24)

The owner reported *"when we shift to different modes her voice is changing"* —
the same defect `verify-voice.mjs` was built to end — three days after the
2026-08-21 Aoede → Autonoe switch. The gate was **green and correct**: the four
lanes it checks did agree.

Her clips are cached permanently in IndexedDB under `bc1:<text>:<style>`,
`pk1:<text>:<style>` and `vn1:<msgId>`. Text, style and id — **never the
voice**. So the switch moved every lane that *generates* audio and no key that
*replays* it, and every install that had made one call before that date kept
serving **Aoede** pickup lines and backchannels out of the cache. The pickup
clip is the first sound of a call; the live session then connects a second later
in Autonoe. That is the owner's sentence, with the "mode shift" being nothing
more exotic than the call starting.

`liveCall.ts` got this right and always had — its ack cache is
`${ACK_CACHE_V}:${ACK_VOICE}:${text}`. One lane had the discipline and it was
never generalised.

**Two more places the same switch missed**, found in the same sweep.
`scripts/prosody-baseline.mjs` — SPEC §9.5's unconsented-vendor-swap detector,
the one job whose entire purpose is noticing her voice change — still said
`TTS_VOICE = "Aoede"`, and its stored baseline was recorded in that voice too,
so it could not have alarmed in either direction. And `src/voice/speech.ts` will
speak her through Sarvam (`priya`) or ElevenLabs on the cascade whenever a user
key exists, while the live lane cannot; on a keyed install every fallback is a
different woman, and the gate read neither literal.

**Why the discipline failed rather than the mechanism.** `api/speech.js`'s
header already said *"move it HERE and in the two live speechConfigs together —
or this comes straight back"*, and `verify-voice.mjs`'s own header answers that
a comment asking for discipline is not a mechanism. Both were right, and both
missed that the mirrors had **no writer**. A mirror set that can only be edited
by hand is a mirror set that will be edited incompletely — the assertion catches
the drift *after* someone ships it, which for a switch made and verified in one
session means it catches nothing.

**Fixed** by putting the identity **in the cache key** (`engineTag`,
`PROXY_VOICE_TAG`), which strands stale audio automatically — no purge step and
no revision counter to forget — and by giving the mirrors one writer:
`node scripts/verify-voice.mjs --set <Voice>` moves all six lanes and verifies
the result in one command. Round-trip tested: `--set Leda` then `--set Autonoe`
returns all five files byte-identical.

**Guarded** by `verify-voice.mjs` §7: every audible engine must be declared, and
every persistent clip cache key must name the identity that produced it. Nine
negative tests, nine failures.

**What breaks generally:** a constant switch is only complete when everything
DERIVED from the old value is also invalidated, and a cache is derived state
that outlives the process that made it. The rule: **anything that persists audio,
text or embeddings across a config change must carry that config in its key** —
otherwise the switch is green everywhere except where the user actually hears it.

**Reverses if:** nothing measured. This is a correctness fix, not a tradeoff.

---

## `engine-per-phrase` — one reply, two vendors, one sentence apart (2026-08-24)

`fetchClipFor` decided which TTS vendor to use from
`preferEleven = elevenKey && (hasAudioTags(text) || !sarvamKey)`. `hasAudioTags`
is a property of the **phrase**, and `speakCall` / `createStreamSpeaker` call
`fetchClipFor` **once per phrase**. So with both user keys set, a reply whose
second sentence carried `[laughs]` was fetched from ElevenLabs while its first
came from Sarvam — two different women inside one answer, boundary at the full
stop. `usesProxyVoice(phrases[0], opts)` had the identical shape.

**The gate already asserted this exact property one level down and nobody
noticed the level above.** `verify-voice.mjs` §2 fails the build if the
cascade's free and paid arms name different models, with the reason spelled out:
*"they race inside one request and a multi-phrase reply races again per phrase,
so this would change her voice BETWEEN HER OWN SENTENCES."* One level up, where
the two candidates are not even the same company, nothing checked at all.

**Fixed** by deciding once per utterance in `pickEngine()` and threading the
result down. The stream lane latches on its first phrase, because a lane that
cannot see the reply it is about to speak has no better option and *"decide once
and hold"* beats *"re-decide whenever new text arrives"*.

**The tradeoff, stated rather than hidden:** a tag appearing only in a later
phrase no longer pulls that phrase to ElevenLabs, so a flatter sentence is
traded for never swapping vendor mid-reply. Sarvam cannot perform a tag at all —
its callers hand it `stripForDevice(...)`, which turns tags into pauses — so on
a Sarvam install nothing is lost.

**Guarded** by counting `hasAudioTags(` call sites: exactly two (its definition
and `pickEngine`). A third is a second decision point.

**What breaks generally:** an invariant proved at one layer is not proved at the
layer above it, and *"the same reasoning obviously applies"* is how the layer
above goes unchecked. When writing a gate, name the layer it holds at.

---

## `subset-check-is-green-by-construction` — three bugs in one twenty-line guard, all toward passing (2026-08-24)

Filed because it happened while *writing the fix for* `cache-outlives-the-voice`,
which is the sharpest possible demonstration of the point.

§7b of `verify-voice.mjs` asserts every persistent clip cache key names the voice
that produced it. It failed three times, each time by examining a subset it did
not name:

1. It matched only keys written **inline** in the call, reporting *"all 2 keys
   ok"* while silently ignoring the three built as `const key = …` — including
   the pickup clip, the one the bug is actually heard through.
2. Resolving identifiers, it took the **first** `const key = \`…\`` in the file.
   Two caches there both name their key `key`, so the pickup key could lose its
   tag entirely and the check still passed. It resolves the **nearest binding
   above the call site** now.
3. It counted the two **function declarations** (`cachedClip(key: string)`) as
   call sites, which turned the gate red on a clean tree.

Only (3) was visible without trying to break it. (1) and (2) both printed a
confident count and a green tick.

**What breaks generally:** a check that reports a COUNT is making a claim about
coverage, and nothing verifies that claim. This is `manifest-sourcestatus`
(a field asserting rather than observing) and `sound-gate-proved-by-silence`
(an assertion that cannot fail) meeting in one function. The rule this repo
already has — **guards are tested by breaking them** — is not a nicety for
important guards; it is the only thing that separates a check from a comment.
Every one of these three was found by breaking it on purpose, and none would
ever have been found by reading it.

## `ttt-second-class` — a generic seam is not generic until a gate drives every member through it

Tic tac toe "flowed through" every chess system from day one — ActivityState,
the poke, the staleness stamp, the lifecycle matrix, the episode writer — so
nothing ever read as missing. WS-TTT (2026-08-24) found four of six systems
reached ttt in name only: the urgent poke had a `kind === "chess"` guard (a
ttt win on a call was silently swallowed), no salience filter (she narrated
every mark), the T15 block carried no position or threats, and a closed ttt
board rendered live. The tell is uniform: a kind-agnostic mechanism with a
kind guard somewhere downstream, or one no test had driven with the second
kind. Sibling finding `chess-prose-in-a-ttt-hat`: three strings located a
nine-square board by a chess move number — generalising a mechanism is not
generalising its WORDING, and the wording is the half the user hears.

## `glyph-in-a-live-status-line` — the watching eyes stay out of the call state label

Tried: the animated eyes glyph inline in CallVoice's "watching with you"
state line (per the asset brief). Broke on inspection, not in code: the
label is a plain string in an aria-live region changing several times a
minute; carrying a picture means a mixed live node holding a 538KB looping
WebP — ambient motion in a status line, the exact decoration DESIGN-
STANDARDS gates. Copy de-glyphed instead; StoryView's gate keeps the eyes
(rare, first-run, delight budget). Sibling finding `knows-empty-day-0-only`:
the scrapbook empty state is unreachable after the first beat of any mount
because Chat improvises her opening message at messages.length===0 (network
dead included, via the stored fallback) — wiring gated offline, state
effectively day-0 only.

## `bake-glued-labels` — one entry format, parsed at every seam, or the outage has two faces

The 48-key pool's launch night (2026-08-24): write-config.mjs had never
been taught `label~key`, so CI baked the labels INTO the keys. Face one:
Google answered 400 API_KEY_INVALID for the glued label and the pool's
(correct, for malformed requests) 400-abort rule killed all 48 keys —
chat silently survived on the Azure grant lane, speech 502'd. Face two:
after the paste sanitiser landed, the same glued entries were charset-
dropped and the baked pool went to ZERO. The runtime env path was absent
at the function, so the bake was the live source the whole time. Fixed by
parsing the entry format identically at all three seams (env string,
baked array, write-config) with the bake now emitting GOOGLE_KEYRING so
RCA labels survive it; 6 new keyring-gate assertions drive the real bake
in an isolated tree. The rule: a serialization format that crosses a
seam must be parsed by the SAME code (or same-tested code) on both
sides — a second, ignorant parser is a two-faced outage waiting for its
second face.

## `fixed-fuse-on-a-variable-upstream` — the 1400ms fuse turned a slow night into a silent one

The 2026-08-24 ~22:00 UTC speech outage (production 502 "upstream empty"
for hours) had three stacked causes, and the fuse was the one that made it
total. (1) The carbonsettle org family's prepay hit zero — its ~20 keys
answered 429 "prepayment credits depleted" on TTS generation while chat
countTokens still 200'd, so pool-health probes said HEALTHY for keys the
speech lane could not use. (2) MAX_TRIES=3 was written for a 9-key pool
and could not cross that ~20-key dead block sitting at the ring's head.
(3) Google's TTS preview itself degraded to a measured 9.7–11.3s FIRST
FRAME on healthy keys (three keys probed raw, real audio behind each) —
and the 1400ms fuse, tuned to the healthy-night 615–1051ms, cut every one
of them. Each fix alone would have failed: raising MAX_TRIES walks 48 slow
keys and times the function out; raising the fuse alone makes every
healthy night slow. What shipped: quota 429s no longer consume the slow-
try budget (a fast bounce costs ~150ms; the budget bounds SLOW upstreams),
billing families fail together so one hit kills the whole @domain family
for the walk, and the fuse became two-phase (see `two-phase-fuse`). The
rule: a fixed timeout tuned to an upstream's healthy tail is a self-DoS
against its sick tail — pair every fast fuse with a bounded slow path
before declaring the upstream dead.

Sibling rejection, caught by the battery not by me: the first cut of the
mid-walk family skip keyed off the GLOBAL cooldown map, which also skipped
the keys healthyKeys()'s everything-cooled fallback had deliberately
returned — calls=0, resilience 140/13. The skip must be a walk-local set
fed only by THIS walk's own failures. A global "known bad" consulted
mid-walk re-breaks whatever the fallback above it just repaired.

## `live-clock-in-a-byte-identity-gate` — a 1.7%-odds flake that fired on a context-only commit

CI failed byte-identity (1 of 83, tail+system differing at EQUAL lengths)
on a commit that touched nothing but context/. Root cause, reproduced
byte-for-byte: persona.ts's nowContext() stamps her phone clock to the
minute, and both sides of the comparison call it at their own call time —
CI started the battery at 22:25:59.23 and the first fixture's compileOld()
crossed 22:26:00, so "10:25 pm" vs "10:26 pm" at tail byte 115. The race
existed since the harness was written (~1 second of exposure per minute
across the first-fixture pair). Fixed in the HARNESS (freeze
globalThis.Date to one mid-band instant before any compile call), not by
removing the clock from the prompt — she should know what time it is; the
gate should not care. The rule: a byte-identity comparison may contain no
byte the code under test doesn't control — pin every ambient input (clock,
locale, env) or the gate will eventually fail on an innocent commit, and
its failure will point away from the cause (the tree it failed on had
nothing to do with the bytes that differed).

## `calendar-lottery-ceiling` — the second ambient-input gate failure in one night

Hours after `live-clock-in-a-byte-identity-gate`, the SAME rule fired in a
second gate: the persona size ceilings build their lanes under the live
clock, and the compiled core is DATE-dependent (her life texture rotates
by calendar day). A 366-date scan (scripts/scan-core-max.mjs) measured the
text core at 46590..46771 across the year — the 46700 ceiling sat in the
middle, so ~a quarter of all dates failed on identical source. It passed
Sunday night, failed Monday morning (46702), and the flap blocked the
owner's production secrets rollout. Fixed by pinning buildLanes to the
argmax date (2026-03-19) and setting the ceiling from the measured yearly
max (46780 = 46771 + 9 slack), with the scan checked in for re-derivation
after texture edits. The generalized rule stands: any gate that measures
compiled output must pin EVERY ambient input (clock, date, locale, env) —
and a ceiling set from a single live measurement of date-varying content
is a lottery ticket, not a bound. The dead giveaway in both incidents:
CI failing on a commit that could not have caused the diff.

THIRD strike, same night (2026-08-25 06:01): the live-lane call-tail
bound in check-prompt-budget.mjs — 29,983 Sunday, 30,001 Monday, one
byte over on a context-only commit. Scanned at the voice tail's yearly
argmax (Aug 9) the true worst case is 30,190: the 30,000 cap was
UNDERWATER at the calendar's peak the whole time and only looked green
because CI had never run near those dates. Pinned the section's clock to
the argmax date and raised CALL_TAIL_CAP to 30,250 (60-byte tripwire
margin, zero content growth). The sharpened lesson: an unpinned clock in
a size gate doesn't just flap — it can HIDE a cap that is already
exceeded, because every green run silently measured a smaller day.

## `cache-control-on-google` — the breakpoint that wasn't (2026-08-25)

api/chat.js sent cache_control{type:"ephemeral"} on the system block and a
comment credited it with "~85% input-cost reduction" on Google. Measured:
it is a NO-OP on Google's endpoint (n=4, identical cached-token counts
with and without). The 85% was the OpenRouter lane's Anthropic-style
behaviour bleeding into a comment about the wrong lane. Google caches
implicitly regardless and plateaus at ~61% of input; only explicit
cachedContents goes higher. Lesson: a caching claim is per-PROVIDER, and
a comment stating a measurement must name the lane it was measured on.

## `obs-stream-dead-on-arrival` — green code, zero rows (2026-08-25)

WS-OBS shipped obs() calling q(query, ...sevenValues) against
q(query, params, timeoutMs) — params got the string "server", every insert
was rejected by Neon, and obs()'s own catch (there so observability can
never become the outage) swallowed the rejection. Every server-ops row
(key_cooled, speech, live_token) since ship was lost; the stream looked
healthy because silence was its failure mode. Found by WS-COST wiring
paid_turn. The meera_turn funnel (api/_trace.js, its own writer) was never
affected. Lesson: an observability path is not live until ONE ROW HAS BEEN
READ BACK from the store — the write-side green run proves nothing,
because the whole design goal of such a path is to fail silently.

## `corpus-manifest-stale` — the frozen index no longer describes the tree (2026-08-25)

evals/candidate/corpus/corpus.jsonl (frozen 2026-08-15) fails its own
sha256 check on 0/2,304 rows against today's compiler — persona.ts and
compiler.ts have both changed since. Regeneration is still fully
deterministic (2,304/2,304 agreement across rebuilds in-process), so this
is staleness, not corruption. NOT refreshed here on purpose: task #58
(incumbent arm) may be mid-arc against the frozen index, and re-freezing
under it would invalidate a pre-registration. Whoever closes #58 refreshes
the manifest. Lesson: a frozen corpus index needs the persona/compiler
version stamped beside it, so staleness reads as "expected drift" and not
corruption.

## `parse-survivor-bias` — the 17/17 that was really 63/91 (2026-08-25)

The recorded hope that claude-opus-5 was "the qualified judge the battery
waits on" rested on 17/17 agreement from a run where 125/192 replies came
back empty (a 120-token cap ate the reasoning). Fixed-config re-run
(maxTokens 2000, only change; parse misses 65%→2.6%): pooled agreement
63/91 = 69.2% [59.1, 77.8] — FAIL against the 0.80 bar, and not
underpowered (CI upper bound below the bar). On the 16 overlapping units
the capped run had scored: still 16/16 — the judge is stable; the sample
was biased. On the 75 units the cap had silenced: 62.7%. Measured
selection bias: 37.3pp. Lesson, general: units that survive a truncation
failure are the EASY units — an INVALID-RUN agreement number is not a
lower bound or a hint, it is upward-biased by the bench's difficulty
gradient, and must never be quoted as evidence. Slot-A 46.0% (best on the
bench — no position bias; accuracy, not bias, is what failed).

## `offline-mocks-cannot-type-check-sql` — every SQL type error survived 5,000 green checks (2026-08-26)

**Tried:** shipping the replica/gurukul API with its entire DB surface verified
only by offline evals that mock `api/_db.js` at the module boundary.

**What broke, twice, on the first contact with a real Postgres:**
1. Migration 046's FK referenced `(generation_id,replica_id,owner_user_id)`
   on `vy_replica_generation`, a tuple no migration ever made unique (029's
   index carries a 4th column, which an FK cannot target). Every offline
   migration suite passed: they check statement SHAPE and idempotence, never
   referential targets.
2. The studio's first live "create replica" click 500'd — `operator does not
   exist: uuid = text` (42883), then `column auth_user_id is of type uuid but
   expression is of type text` (42804). Bound params arrive as TEXT over
   Neon's HTTP endpoint; comparisons and INSERT-SELECTs against `uuid`
   columns need explicit `::uuid`. A mock returns fixture rows for any string
   and cannot fail on operator resolution, so 5,161 green checks said nothing.

**The law:** a mocked database proves control flow, never types or
referential integrity. Any lane whose first live use is a user click must be
smoke-tested against the real database before it is called done —
`verify-release --live`, or a scripted call of the real exported functions
with `NEON_URL` set. Fixed: casts in `api/_replica.js` (WS-M sweeps the rest),
and `evals/sqlcast.mjs` makes the class statically unrepresentable.

## `readiness-probe-only-is-fatal` — a Readiness probe alone kills a slow-booting GPU app (2026-08-26)

**Tried:** declaring only a Readiness probe on the Chatterbox Container App,
reasoning that readiness is what gates traffic and a slow model load would
simply delay readiness.

**What broke:** permanent crash-loop. Azure Container Apps installs a DEFAULT
liveness probe when you declare any probe set without one, and it killed the
container ~3 s BEFORE the app logged `Application startup complete`. The
symptom reads as an application failure — restart after restart with no error
in the app's own logs — so the instinct is to debug the model load, which is
fine.

**The fix:** an explicit Startup probe with a generous failure budget; the
liveness probe then only begins after startup succeeds. Same app, same image:
permanent crash-loop → ready with 0 restarts. Any GPU service whose first boot
downloads or compiles weights needs this. Note the templates still carry
`gpu: 1` and `initialDelaySeconds: 240`, which ARM rejects outright — the
deployed apps are correct, `services/*/infra/main.bicep` is not yet.

## `gpu-usages-api-says-nothing-about-serverless` — a 0/0 quota reading that means nothing (2026-08-26)

**Tried:** reading `Microsoft.App/locations/{region}/usages` to decide whether
the subscription could run GPU workloads before attempting a deployment — the
obvious pre-flight, and the one a careful operator would trust.

**What broke:** it reports `SubscriptionDedicatedNCA100Gpus = 0/0` in all 16
regions, which reads as "no GPU quota anywhere, request an increase first."
That row describes DEDICATED A100 capacity only and is silent about the
Consumption-GPU (serverless T4) profile this platform actually uses.
Scheduling a replica anyway returned `GpuDriverInfo: Your GPU environment is
active! Driver 580.159.04` — it had worked the whole time.

**The law:** for serverless GPU, the only trustworthy quota probe is
scheduling a replica. Related timing trap from the same deployment: attaching
a GPU workload profile adds ~45 minutes to environment creation (57 min
measured, versus 12 min for a non-GPU control) — a wait that looks exactly
like a hung deployment and is not.

## `fake-the-instagram-adapter` — writing an adapter against credentials that cannot exist (2026-08-26)

**Tried:** during WS-N, the obvious symmetry was to write `api/instagram.js`
beside `api/whatsapp.js` — the same four functions, the same shape, ~200 lines
— so the Channels screen could list all four surfaces and the gap would be
"just credentials", like Telegram's.

**What broke, on reading Meta's current documentation rather than remembering
it:** Instagram DM is not a credentials gap. Serving accounts we do not own
requires **Advanced Access**, which requires **App Review**, which requires
**Meta Business Verification of our legal entity**, a Live-mode app, a privacy
policy, a data-deletion path, and a recorded screencast of the integration
working. Granted per app, not per teacher; reported turnaround weeks to
months. And the messaging window's only extension past 24 hours is the
`human_agent` tag, which Meta restricts explicitly to **a real human, not an
automated system**, with detection for misuse — so an AI clone answering
outside the window is not a feature we are missing, it is a policy violation
we would be building.

The adapter is the SMALLEST part of that list, which is the finding: shipping
it would have put a file in the tree nobody can prove and that the next reader
would reasonably assume had been. `dead-writers`, at a surface.

**Instead:** `instagram_dm` is in migration 055's `kind` domain and absent from
`CONNECTABLE_KINDS`, so it is storable and not connectable; the studio shows
the blockers instead of a button; and `docs/gurukul/INSTAGRAM-DM-GAP.md`
records the requirements with sources and the date they were checked. It also
records the WhatsApp finding nobody was looking for: since `api/whatsapp.js`
was scaffolded, Meta has made **Tech Provider enrolment mandatory** for ISVs
and **Embedded Signup the default onboarding path**, so the phone-id-plus-token
form that shipped is correct for a teacher who already has a WABA and is NOT
the self-serve flow. The Channels screen says so in that surface's cost line.

**The law:** a surface's cost is the approval chain, not the adapter. Check the
current requirements before promising a channel, and when the chain is someone
else's queue, say so in the product rather than in a comment.
## `aliveness-was-unreachable-not-meera-bound` — the diagnosis was content, the defect was a missing argument (2026-08-26, WS-Q)

**What was tried:** the WS-Q brief opened by auditing the aliveness stack
(`inner` `timeline` `herNow` `life` `selfarc` `texture` `observation`
`milestones` `repeat` `away` `greeting` `moment` `culture` `reciprocity`) for
Meera-bound CONTENT — hardcoded catalogs, table names, a baked agent id — on the
premise that parameterizing those was the work.

**What that found, and why it was mostly the wrong hunt.** Nine of the fourteen
were already character-agnostic: they derive from transcripts or take `agentId`
as a parameter that merely DEFAULTS to `MEERA_AGENT_ID`. One (`timeline`) is a
tombstone whose prompt render was retired as a dead writer in 2026-08 and whose
zero-importer rule is enforced by `evals/lifecycle` §5 — parameterizing it would
have produced a second dead writer. Only `herNow` was genuinely content-bound.

**What actually broke, and what nothing in the tree said out loud:**

1. `src/engine/brain.ts` — the ONE place the whole client aliveness stack is
   assembled — calls `compile({...})` with **no `agent` field**. Grepped: the
   identifier `agent` did not appear in that function. So the lane that has the
   carried interior, the told-life ledger, the self bundle, the moment gate and
   both honesty ledgers was Meera's *by construction*.
2. `api/_teachersheet.js`'s `loadTeacherAgent` — the entire runtime clone
   constructor, three-times consent-gated, carefully written — had **zero
   callers anywhere in the repo**.

Both halves look finished from every angle a reader normally checks. The
AgentModule injection seam exists and is documented (SPEC-AGENT-LAYER §3 Law
E2); the loader exists and is tested; the modules are generic. Nothing was
wired to the other end. `dead-writers`, fifth instance, and the most expensive
shape of it yet: not a renderer nobody calls, but an entire PRODUCT LINE
connected to the engine by an argument nobody passes.

**The law:** "is this module character-agnostic" is the wrong question and it
has a comforting answer. The question is **"name the call site that reaches it
with a non-default agent"** — and if the answer is a grep with no hits, the
feature does not exist for that agent no matter how generic the module is.
`evals/clonelife` §5 now asserts the three forwarding lines in `brain.ts` over
the source text, because that is the assertion whose absence let this stand.
---

## `month-prefix-parse` — matching a month by its first three letters

`src/engine/timeline.ts`'s `resolveWhen` resolved month names with
`/\b(jan|feb|mar|…|dec)[a-z]*\.?\s*(\d{1,2})?\b/i` — "the three-letter
abbreviation plus whatever follows it". `[a-z]*` was meant to admit the full
name ("jan" → "january"). What it actually admitted was **the prefix inside any
longer word**. Measured over a plain word list:

| word | read as |
|---|---|
| married, marriage, marks | March |
| decade, decide, declare | December |
| junior | June |
| novel | November |
| janta | January |
| octopus | October |
| septic | September |
| augment | August |
| aprons | April |

`marks` and `janta` are the ones that matter: this is a product whose users
say both constantly, and a JEE-teacher clone will hear "marks" in every third
message.

**Why it survived.** `resolveWhen` had exactly one consumer — `hisClock`, whose
output is a coarse human label ("was about a month back"). A label that is five
months off reads as a memory being vague, and no gate encodes what "vague"
should be. It became load-bearing the moment WS-O made the same answer the
stored `valid_to` that decides TENSE: a December wedding parsed on "married"
resolves to March, and she congratulates someone on a wedding that has not
happened.

The lesson is not about regexes. **A parser with one forgiving consumer has
never been tested.** Wiring it into a second consumer with a strict consequence
is what tested it, and that is a reason to expect the next such reuse to find
something too.

Fixed by replacing `[a-z]*` with an alternation admitting only the real
completions of each month name, closed with `\b`. Fixture: `evals/run.mjs
recallbench` [A-14], over dyad-a's "getting married in nashik in december".

---

## `router-matched-a-table-instead-of-a-statement` — a mock that swallowed the query under test

`evals/recallbench/store.mjs` routed the person lookup with
`s.includes("from vy_person_device")`. WS-O's surface-switch leg names
`vy_person_device` in a SUBQUERY, so that branch swallowed the new statement
whole and answered it with a person row.

The result was the worst available one: the leg ran, issued its query, got a
plausible-looking answer, contributed nothing, and **every assertion in the
suite stayed green**. The only visible symptom was a route-count line nobody
would read. It took a printf inside the leg to find it, after two rounds of
looking for the bug in the shipping code — which was correct the whole time.

Fixed by matching the STATEMENT (`select person_id from vy_person_device`)
rather than a table that appears in it. The general rule, and the reason this
is written down rather than just patched: **a mock branch keyed on a table name
is a branch that will one day answer a different query than it was written
for.** The watch branches in the same file already carried an ordering note for
the same species of trap; this is the second instance, which is what makes it a
rule.

Related, from the same session and the same file: the router used to IGNORE
`device_id` entirely and serve fixture rows to any caller. A mock that
OVER-RETURNS is the more dangerous kind — it made an 89.2% cross-surface recall
loss invisible while the whole benchmark read as healthy.

## `statement-shapes-postgres-will-not-parse` — three shipped queries that could never run (2026-08-26)

**Tried:** two SQL idioms that read as obviously correct and are not
representable in Postgres at all. Both shipped, in erasure and voice-holdout
paths, and both are 0A000 — rejected at PARSE time, so the statement could
never execute for anybody on any call.

1. **`for update` in a query block containing a `left join`.** A bare
   `FOR UPDATE` locks EVERY relation in the FROM clause, the outer-joined one
   included, and Postgres refuses: `FOR UPDATE cannot be applied to the
   nullable side of an outer join`. Found at `api/_replica-full-erasure.js`
   `completeReplicaErasure` — the FINAL database purge of a replica erasure,
   the one statement in the chain that must work.

2. **A data-modifying CTE with no `RETURNING`, referenced by
   `(select count(*) from x) >= 0`.** Postgres executes every data-modifying
   CTE exactly once whether or not it is referenced, so the guard never had to
   exist to force the write — but once written it IS a reference, and a
   data-modifying CTE with no RETURNING has no output relation to reference:
   `WITH query "x" does not have a RETURNING clause`. Found twice, at
   `api/_replica-source-erasure.js:134` and
   `api/_replica-voice-delivery-policy.js:344`.

**What specifically broke, and why nothing saw it:** nothing broke, ever —
that is the point. These are not bugs that need the wrong VALUE to bite, like
the `uuid = text` class `sqlcast` already gates. They need nothing at all. And
every offline suite in the repo mocks `api/_db.js` at the module boundary, so
Postgres is never asked to parse the text; the suites proved the control flow
around three statements that could not run. `EXPLAIN (verbose, costs off)`
against the live database returned the error in one round trip, with no write
and no valid data.

**Two repairs that are NOT the fix:**
- Making the outer join inner. The left join is load-bearing: a replica may
  legitimately have no agent, and the predicate says so
  (`r.agent_id is null or …`). `for update of j,r` names the relations the
  lock is actually for, which is also the honest statement of intent.
- Deleting the `count(*)` reference. It is legal to delete and the writes
  still happen — but the reference documents an ordering dependency a reader
  would otherwise have to know Postgres's execution rules to see. `RETURNING`
  is the repair; the predicate stays TOTAL (`>= 0` holds for the empty set)
  because the sweep must not be skipped when there is nothing to sweep.

**The law:** both classes are decidable from the SQL text, so they are gated
statically — `evals/sqlcast/stmt.mjs` rules C and D, run over every SQL
template literal under `api/`, with 4 negative and 6 positive controls.
Replayed against the pre-fix tree it names all three; on the fixed tree, 0
across 458 statements. And the wider rule: **a mocked database cannot even
tell you the statement is well-formed.** EXPLAIN it.

## `coverage-lists-that-enumerate-a-subset` — the third time, one level down (2026-08-26)

**Tried:** trusting `scripts/relcheck.mjs`'s manifest-coverage check, which
exists precisely so that a user-data table nobody listed fails loudly.

**What broke:** it enumerated three column names —
`('person_id','device_id','user_id')` — so it could not see
`vy_replica_runtime_capability` (keyed `subject_person_id`), could not see
`vy_disclosure_grant` (`granted_by`/`granted_to`), and had never once
considered the 48 tables keyed on `owner_user_id`. Four person-keyed tables
were in neither the forget cascade nor the DSAR export: a person who asked to
be forgotten kept rows in them.

This is the SAME defect the same function already carries a long comment
about. P2-1 fixed the check when its `table_name like 'vy\_%'` filter hid
`meera_state`, wrote down the rule — A COVERAGE CHECK IS ONLY AS WIDE AS THE
THING IT ENUMERATES — and then narrowed the check on a different axis in the
same breath. Fixing an enumeration teaches you nothing about the OTHER
enumerations in the same query.

**What compounded it:** the check skips without `NEON_URL`, so every
credential-free CI run said nothing at all about the list. Worse,
`scripts/verify-release.mjs` decided whether it had a database by reading
`api/_config.js` alone, while `api/_db.js` has always read
`process.env.NEON_URL` FIRST — so a runner supplying the string the ordinary
way ran the queries fine and still printed `SKIPPED (no NEON_URL in this
environment)`. Not silent: it named a reason that was false.

**Fixed three ways, because one was not enough the last two times:** the
column list is now every name that means a natural person; the same question
is asked OFFLINE against the checked-in DDL by `evals/persontables.mjs`, which
needs no credentials and therefore cannot be skipped; and `verify-release`
reads the env var. **When you widen an enumeration, list every other
enumeration in the same query and widen or justify each one.**
## `supabase-object-info-is-not-json` — every upload finalize failed closed, and nothing downstream had ever run (2026-08-26, WS-T)

**What was tried.** `api/_replica-storage.js::replicaObjectInfo` read Supabase's
`GET /storage/v1/object/info/{bucket}/{path}` as a JSON document and pulled
`size` and `mimetype` out of the body, failing with `storage_metadata_incomplete`
when either was absent.

**What broke.** That route answers HEAD-style. The metadata IS the response
headers — `content-length`, `content-type` — and the body is empty. So
`await response.json()` returned null on a perfectly healthy object and every
finalize threw. The first real consented upload made this visible in one shot:
the signed PUT into `vyakti-replica-private` returned **HTTP 200 in 2 451 ms**
for 3.41 MB, and finalize then returned **409 `storage_metadata_incomplete`**.
That code is only reachable on a **2xx** info response — a 404 or 500 would have
raised `private_storage_failure` instead — so the object existed, was readable
with the service role, and was rejected anyway.

**Why it mattered more than it looks.** `pending_upload -> quarantined` is the
only transition that enqueues the `integrity` processing job. With finalize
failing closed, no source could ever leave `pending_upload`, so the entire
processing pipeline downstream of storage had never executed once — while every
offline test stayed green, because no offline test can see a vendor's response
SHAPE. This is `offline-mocks-cannot-type-check-sql` wearing a different hat:
the mock proved the control flow and the control flow was never the problem.

**The fix.** Read the JSON shapes first, then fall back to the response headers,
so a storage-api that does start returning a body keeps working. Committed.

**What is NOT proven.** The deployed studio still runs a build from before this
commit, and the branch is not pushed, so `finalize` returning 200 has not been
observed. The evidence is one-directional: the failure is fully explained and
the fix addresses exactly that explanation. Re-run
`node scripts/first-clone.mjs` after a redeploy; the script prints that hint by
name when it sees the old error.

## `sarvam-batch-paths-were-three-guesses` — a job that completed in 126 s died at a ten-minute timeout (2026-08-26, WS-T)

**What was tried.** `api/_asr/providers/sarvam-saaras.js` implemented the batch
lane from a research write-up, and said so in its own header. The five-step
SHAPE — init, upload, start, poll, collect — was right. Three of the five
ADDRESSES were wrong, and no amount of review could have told.

**What broke, in the order it broke.**

1. `PUT input_storage_path` -> **409**. That value is an Azure *directory* SAS
   (`sr=d`, `sp=wl`), not a blob URL. Bytes go to `<dir>/<name>?<sas>`, which
   answers **201**.
2. `GET /speech-to-text/job/{id}` -> **404, forever**. The status resource is
   `/speech-to-text/job/{id}/status`. The provider read the 404 as "not
   finished", polled it 120 times and raised `asr_sarvam_job_timeout` after ten
   minutes — on a job Sarvam had **Completed in 126 s**. The worst available
   failure shape: slow, billed, and indistinguishable from a real timeout.
3. `GET output_storage_path` -> a directory, not JSON. The result blob is named
   by INPUT INDEX (`0.json`), never by the file name uploaded.

**The lesson that generalises.** Every one of the three failures is a place
where a wrong address returns something *plausible* rather than an error: a
409, a 404 that reads as "pending", a 200 that is not the document you wanted.
A protocol coded from prose is not half-verified because its shape is right —
until it has been called, the addresses are folklore. The header comment that
said so was correct and was not enough to stop the lane shipping.

**Fixed and verified**: full chain to 5 diarized turns with second-resolution
timings. Committed.

## `hmac-skew-shorter-than-cold-start` — the request that wakes a service can never authenticate (2026-08-26, WS-T)

**What was tried.** Calling `voice-evidence` at zero replicas the way the
processing worker would: sign the request, send it, let the platform wake the
app.

**What broke.** **401 `transport_signature_invalid`.** Not a timeout — an
authentication failure. `services/voice-evidence/app.py` allows
`MAX_CLOCK_SKEW_SECONDS = 60` on `X-Vyakti-Timestamp`, and the service takes
**176 s** to come up from zero. The signature is minted before the wake and
verified after it, so the timestamp is ~3x outside the window by the time
anything checks it. The very first request after any scale-to-zero is therefore
*guaranteed* to fail, and it fails wearing the mask of a wrong key.

Note what that costs beyond the failed call: `azure-voice-evidence.js` marks a
401 **non-retryable** (`retryable` is set only for 429 and 5xx), which is
correct for a genuine auth failure and exactly wrong here. A worker would
permanently fail a job because its own cold start outran its own clock window.

**The fix used.** Wake the app on the *unauthenticated* `/healthz` and sign
nothing until it answers 200. `scripts/first-clone.mjs` does this and reports
the warm-up time as a measurement (194 505 ms on the run that found it).

**What was deliberately NOT done.** Widening the skew window weakens replay
protection to buy nothing a warm-up does not already buy, and making 401
retryable in the adapter would blur a real wrong-key failure into a latency
one — the negative control WS-L ran exists precisely to keep those apart. Which
component owns the warm-up is an owner decision and sits with the same open
question as `AZURE-DEPLOY-STATE.md` §12.

## `romanised-lexicon-meets-devanagari-asr` — the code-switch signal measured 0.000 on a bilingual transcript (2026-08-26, WS-T)

**What was tried.** Running the real ingestion statistical pass over the first
real Sarvam transcript of a real consented Hinglish recording.

**What broke, twice.**

**(a) The tokenizer shredded the script.** `normalizeText` kept `\p{L}`,
`\p{N}`, apostrophe and space. Devanagari vowel signs are `Mark_Nonspacing`, so
every matra became a space and every word fell apart into bare consonants: 213
characters measured as 74 single-glyph "tokens" and a phrase-bank candidate
list headed by `"म" x10`. Fixed by keeping `\p{M}`; the same transcript then
measures 47 real word tokens. Every abugida the product targets had this.

**(b) The lexicon is looking at the wrong script, and this is NOT fixed.**
`HINDI_MARKER_WORDS` is a romanised list — `hai`, `nahi`, `kya`. Sarvam returns
**Devanagari**, and transliterates the English half into Devanagari too
(`माय नेम इज़ राघव`). So on a 127-token, visibly bilingual transcript the
measured code-switch token ratio is **0.000** and the filler count is **0**.
The measurement ran, returned, and is honestly reported — it is measuring a
script that is not present.

Not patched here on purpose: extending the lexicon changes a *measured signal*
that register bullets and the `languageVoiceRule` gap reason rest on, and doing
that without a bench would replace a visible zero with an invisible guess. The
decision is which of three: transliterate the ASR output to Latin before
measuring, add Devanagari spellings to the lexicon, or pick an ASR model that
returns romanised Hinglish. `scripts/first-clone.mjs` prints the warning
whenever it sees ratio 0 on a non-trivial transcript, so this cannot go quiet.

**2026-08-27 benchmark-only resolution.** Naively using raw Unicode WER as the
replacement was rejected because it charges a reviewed Roman/Devanagari pair
as different words. Unbounded phonetic transliteration was also rejected: it
could make unknown words or real confusables such as `hai`/`he` look equal and
manufacture a quality gain. The evaluation layer now emits raw metrics beside
a bounded, coverage-reporting alias metric. The product-derived
`stats.codeSwitch` and its consumers remain unchanged; this does not resolve
production language identification.

## `plausible-return-hides-a-dead-pipeline` — four defects that each returned something believable (2026-08-26)

The first real end-to-end run (WS-T, the owner's own voice) found four
defects. None had ever shown as an error, because each returned a plausible
value instead of failing:

1. **`replicaObjectInfo` parsed a HEAD-style storage route as JSON.** Every
   upload finalize therefore failed closed with `storage_metadata_incomplete`,
   so no source ever left `pending_upload` and **nothing downstream of storage
   had ever executed for anyone** — the entire processing half of the product
   was unreachable and looked merely unused.
2. **Three of five Sarvam batch addresses were wrong**: a directory SAS treated
   as a blob (409), a status path that 404s forever (a job that finished in
   126 s rode a 10-minute timeout), and an output directory fetched as JSON
   when the blob is `0.json`. The earlier probe that "verified the batch API"
   only proved `job/init` — the first hop.
3. **The HMAC skew window (60 s) is shorter than the cold start (176 s)**, so
   the request that WAKES a scaled-to-zero service comes back 401
   `transport_signature_invalid` — an auth error reported for a latency
   problem, and the adapter treats 401 as non-retryable.
4. **`normalizeText` dropped Devanagari matras**, so 213 characters measured as
   74 single-glyph tokens and the top "phrase candidate" was a single vowel
   sign repeated ten times. Fixed by keeping `\p{M}`; the same transcript then
   measured 47 real words.

**The law:** a stage that returns a plausible value on failure is invisible to
every check that does not compare it to reality. Offline suites, type checks
and even live smoke tests of the FIRST hop all passed while the pipeline was
dead. Only driving the whole chain with real input found it. Related to
`offline-mocks-cannot-type-check-sql` and `aliveness-was-unreachable-not-
meera-bound`: three different disguises for the same thing — code that looks
finished, is reached by no test that would notice, and returns something
believable.

---

## `disclosure-announces-the-clone` — every synthetic clip says out loud that it is synthetic (2026-08-26, WS-V)

**What was tried.** Building the blind listening bench by doing what looks
sufficient: opaque filenames, shuffled order, a UI that names no arm.

**What broke.** `api/_voice/contracts.js::renderTextWithDisclosure` prepends the
literal sentence **"This is an AI-generated voice replica."** to every synthesis
request, and `services/open-voice-runtime` **speaks it**. Every clone clip
therefore announces its arm in its own first two seconds, in every trial, to
every listener, regardless of how the files are named. `scripts/first-clone.mjs`
never had to care — it measures embeddings, and the disclosure is just more
audio of the same speaker. A listening bench is the first thing in this repo
where the disclosure is a defect, and it would have made an ABX result
meaningless while every file-level blinding check stayed green.

**What was done instead.** The clone arms are cut at the pause after the
disclosure, and the REAL arm goes through the identical trim/normalise/fade
path so the treatment is a constant of the bench rather than a cue. The trimmer
**fails closed**: no pause inside a plausible window, or an implausible
chars-per-second on what is left, and the command writes nothing. Where
`SARVAM_API_KEY` is set, every trimmed clip is transcribed and the run is
refused if the disclosure survives.

**The second trap, which is the more interesting one.** The obvious verification
— "the operator listens to a few clips and confirms the disclosure is gone" —
**unblinds the only listener the bench has**, because on this bench the operator
IS the subject and the panel. `earbench.mjs verify-trim` exists for exactly
that: it writes only the REMOVED PREFIXES, shuffled and unlabelled, so the ear
check happens on the audio that was thrown away and reveals nothing about which
stimulus is which.

**The generalisation.** A safety feature that must be present in production can
be a measurement defect in the bench that validates production, and it will not
show up as an error anywhere. Before benching anything, ask what the shipping
path ADDS to the artifact.

---

## `alternating-is-not-counterbalanced` — a counterbalance that produced 10 A and 8 B (2026-08-26, WS-V)

**What was tried.** Counterbalancing the two binary choices in an ABX trial by
alternating them at different periods: the arm X is drawn from flips every
trial, the side the matching clip sits on flips every two.

**What broke.** Over 18 trials that yields **10 correct-A and 8 correct-B**. It
is only balanced at multiples of four, and a real design is 3 arm pairs x an
arbitrary item count. A listener with any side bias — and side bias is one of
the best-documented effects in forced-choice listening — reads as a signal on a
design skewed 10:8.

**What was done instead.** A four-cell cycle over (which arm X comes from, which
side matches), reset per arm pair, walking a shuffled item order. Exact balance
at every multiple of two.

**How it was caught, which is the point.** Not by reading the code: by
`counterbalanceReport()` printing `position balanced false` on the first
self-test run. The check was written before the bug existed, because the whole
suite was written on the assumption that the blinding would be wrong somewhere.

## `broker-healthz-is-a-front-door-not-a-readiness-check` — the probe that cannot see the thing it is probing (2026-08-26, WS-W)

**What was tried.** Building the panel's warm-up on the obvious reading of
`AZURE-DEPLOY-STATE.md` §8 and `rejected.md#hmac-skew-shorter-than-cold-start`:
ping `/healthz`, and when it answers 200, the voice lane is ready.

**What broke.** It is ready in the sense that matters for `voice-evidence` and
in no other sense. `services/open-voice-runtime/broker.py` serves `/healthz`
from `app.state.ready`, which is the **CPU admission broker's own** lifespan
flag. The broker exposes exactly two routes — `/healthz` and
`POST /v1/synthesize` — and the private GPU app is environment-internal, so
**nothing in the app plane can observe the runtime's state, and nothing but a
real synthesis can wake it.** A 200 from `/healthz` costs about a cent of CPU
and proves the runtime nothing.

Two consequences that were nearly got backwards:

- The two cold starts fail in **different shapes**. A cold *broker* is the
  401-skew hazard, because the signature is minted before the wake and verified
  after it. A cold *runtime* is a **timeout**, because the broker verifies the
  signature the moment the request lands and only then forwards it — the 161 s
  boot happens entirely after admission. Reporting the second as the first
  (STATE.md's summary line reads that way) would have sent someone hunting a key
  rotation for a latency problem.
- A wake cannot be a fire-and-forget with an abort. The first version raced the
  synthesis against a timer and aborted the `AbortSignal` when the timer won.
  That cancels the request at the broker, so the GPU replica is never scheduled
  and the wake is undone by the timeout meant to survive it. The dispatch now
  leaves the promise running with its own 210 s budget and only stops WAITING.

**What was deliberately NOT done.** Widening the skew window (rejected at
`hmac-skew-shorter-than-cold-start`, and it buys nothing a warm-up does not).
Adding a broker route that wakes the GPU app cheaply — that is a service change
on a branch that is not pushed, and it is the right fix; it is written down as
an owner item rather than guessed at here.

## `warming-that-does-not-clear-warm` — a 504 that left us still believing the runtime was up (2026-08-26, WS-W)

**What was tried.** Modelling warmth as two independent timestamps —
`lastReadyAt` set by a success, `lastWakeAt` set by a dispatched wake — and
reading "warm if ready is recent, else warming if a wake is recent".

**What broke.** Caught by `evals/voicepanel.mjs` before it shipped, on the one
sequence that matters: a runtime that had answered once and then returned
`open_voice_http_504`. The failure path notes `waking`, but `lastReadyAt` was
still inside its 240 s TTL, so `read()` kept answering **warm** — and the next
click therefore took the BLOCKING path against a service that had just told us
it was booting. The state machine's own recovery path put it back into the
four-minute hang it exists to prevent.

**The fix used.** `waking` clears `lastReadyAt`. A wake and a ready belief are
mutually exclusive by construction rather than by ordering.

**Why it is written down.** The bug is invisible to any test that drives the
states in isolation; it needs the *sequence* ready → failure → click. That is
the general shape — a state machine whose transitions are each correct and whose
composition is not — and the assertion that caught it ("a 504 clears the warm
belief so the next click waits properly") is the one to keep if this file is
ever tidied.
## `adapter-init-stole-the-sampling-seed` — a fidelity delta that would have been part sampling noise (2026-08-26, WS-U)

**What was tried.** The obvious LoRA implementation: wrap each target `nn.Linear`
and initialise the A matrix with `nn.init.kaiming_uniform_`, the way every LoRA
tutorial and `peft` itself does it. It was written, built into a GPU image and
deployed before the problem was spotted — the code was correct as LoRA and
wrong as an experiment.

**What broke.** `services/open-voice-runtime/app.py::_synthesize_sync` seeds the
**global** torch RNG from the request's `seed`, and Chatterbox then samples
speech tokens from that same global stream at `temperature 0.8`. Injecting the
adapter happens *after* the seeding and *before* generation, and
`nn.init.kaiming_uniform_` draws from the global generator. So attaching an
adapter advanced the RNG by 3.9 M draws, and the adapted arm sampled a
**different token stream** than the zero-shot arm at the identical seed.

Nothing fails. No test goes red. Both arms produce good watermarked audio and a
clean fidelity number. The measurement simply stops being a comparison: part of
whatever delta appeared would have been sampling noise wearing the adapter's
name, and there is no way to tell from the output how much.

**The fix.** LoRA initialisation draws from a **private** `torch.Generator`
seeded from a constant (`lora.default_generator()`), shared across one
injection. The global stream is never touched, so the two arms are
seed-identical and the adapter is the only difference between them. Cost: one
extra ~12 minute image rebuild before any number was taken.

**The confirmation.** With the fix in, the zero-shot control re-measured
**0.775278** against `first-real-clone`'s **0.775276** — 2e-6 apart, on a
different day and a different image. That agreement is what makes the delta in
`lora-vs-zero-shot-71s` a delta rather than a coincidence, and it would have been
unavailable if the adapter arm had been quietly resampling.

**The law.** *Anything a treatment does to shared global state is part of the
treatment.* Before comparing two arms, ask what the experimental arm consumes
that the control does not — RNG, caches, clocks, connection pools — and either
isolate it or measure it. A confound that changes the OUTPUT without changing
the SHAPE of the output is invisible to every check that does not know to look
for it. Same family as `plausible-return-hides-a-dead-pipeline`: the failure
mode is a believable value, not an error.

## `mine-everything-you-are-handed` — the Context Locker design that would have put other people's words in a clone (2026-08-26, WS-AB)

**What was tried.** The obvious first shape for "bring your context": accept
every file and link, extract whatever text comes out, run the statistical pass
over all of it, propose the result. It is the shape the brief's own words most
directly suggest ("mines them into their clone's Person Model") and it was
built far enough to see what it does.

**What broke.** Three things, and the second is the expensive one.

1. A chat export's majority speaker is often not the owner. Mining an export
   whole, or mining its majority speaker, produces a phrase bank of the OTHER
   party's habits — cited, resolvable, well-formed, and completely wrong.
   `evals/contextlocker.mjs`'s wrong-speaker control reproduces this on demand:
   declaring the wrong sender yields proposals that pass every structural check
   the pipeline has.
2. An uploaded document is not necessarily the uploader's writing. A textbook
   extract, a colleague's report, an article saved as PDF — all of them mine
   cleanly, and there is no signal in the file that says whose sentences these
   are. The failure is silent by construction and there is no later stage that
   can catch it, because by then the phrases look exactly like evidence.
3. An article LINK is never the owner's writing at all, and no owner checkbox
   changes that.

**What replaced it.** Attribution is a required input, defaults mine nothing,
and every not-mined item carries a named reason
(`unclaimed-text-is-not-evidence-of-how-you-write`).

**The generalisation.** "We have text about this person, therefore we have
evidence of how this person talks" is a non sequitur that every ingestion lane
will be tempted by. The question is never "is this text about them" — it is
"did they write it", and only a human can answer that.

## `pdf-text-is-whatever-the-bytes-decode-to` — the extractor that would have cited glyph indices as catchphrases (2026-08-26, WS-AB)

**What was tried.** A dependency-light PDF text extractor: inflate the content
streams, scan for `Tj`/`TJ`, collect the literal string arguments, return them.
For a PDF from a word processor or a browser print this is correct and the text
comes out clean.

**What broke.** For a subset-embedded font with a `/Differences` encoding, or
any 2-byte CID font, the literal bytes in a `Tj` argument are GLYPH INDICES,
not characters. Decoding them as characters returns a string — a plausible,
non-empty, storable string of accented-Latin noise. Downstream, nothing can
tell: the readability of a corpus is not something `transcriptStats` measures,
so the noise would be n-grammed, the repeated glyph runs would clear the
>=5-occurrence rule handsomely (noise repeats more regularly than language
does), and the owner would be shown a phrase bank of garbage presented as their
own habitual phrases with resolvable citations.

**What replaced it.** `assertReadable` — a structural gate on every extractor's
output: enough letters, enough word breaks, no replacement characters, or the
extraction fails with `pdf_text_layer_unreadable` naming the cause. A scanned
PDF hits the same wall from the other side and is refused as
`pdf_no_text_layer`, naming OCR as a lane this platform does not have.

**The generalisation.** This is `plausible-return-hides-a-dead-pipeline` at the
very first step of a pipeline, and it is worse there than anywhere else: every
later stage inherits the plausibility. An extractor's contract is not "return a
string", it is "return text or say why not".

## `owner-keyed-tables-belong-in-person_tables` — the wiring that would have made erasure WEAKER (2026-08-26, WS-AB)

**What was tried.** The brief for this workstream asked for the new locker
tables to be "wired into PERSON_TABLES + the erasure cascade". Both halves were
attempted.

**What broke.** `PERSON_TABLES` is wrong for them, and the repo already says so
in two places that would have been contradicted. `api/memory.js`'s "WHAT IS
DELIBERATELY NOT IN THE LIST ABOVE" excludes all 48 `owner_user_id` tables on
purpose — the replica lane's rows are the only pointers to objects outside
Postgres, and a manifest loop deleting them early would strand data in object
storage while the receipt said it was gone. `scripts/relcheck.mjs` encodes the
same verdict mechanically: its manifest-coverage check filters `ownerOnly`
tables OUT, so adding them would not have made the gate happier — it would have
made the two disagree.

**What replaced it.** The tables carry `owner_user_id` and no FK (053/055/057's
convention), so they are deleted BY NAME in `api/_replica-full-erasure.js`,
child (`vy_context_item_text`) before parent (`vy_context_item`) — which is what
relcheck's owner-lane REACH walk actually requires, and what it would have
failed the build over the moment the tables existed. `owner_context_locker` was
added to the deletion receipt's `deletedClasses`, because this is the only place
the platform stores a person's own documents in full and a receipt that did not
name them would understate what was held.

**The generalisation.** "Wire it into the manifest" is the right instinct and
the wrong mechanism for a lane whose rows point at things Postgres cannot
delete. Read which gate actually covers the table before adding it to the one
whose name sounds right.

## `mirror-reference-accumulation-was-inert` — the spec's voice loop, built as written, would have changed nothing (2026-08-26, WS-X)

**What was built.** `MIRROR-CALL-SPEC.md` §Voice loop, literally: consented call
audio accumulates into the replica's reference set, `voice-evidence` re-embeds
the grown set, the next clone turn synthesises off the enriched reference. The
first cut of migration 058 modelled exactly that — `vy_mirror_window` with
`reference_admitted`, a growth arithmetic returning `total_windows` /
`total_ms`, and a re-embedding trigger at call end.

**What broke.** Nothing, visibly. That is the entry. WS-Z's sweep read
Chatterbox's own source and found `prepare_conditionals()` slices the reference
twice before the model sees it — `DEC_COND_LEN = 10 * S3GEN_SR` (10 s for
S3Gen) and `ENC_COND_LEN = 6 * S3_SR` (6 s for the T3 speech prompt) — and
`generate()` takes exactly one `audio_prompt_path`. Turn 40 of a Mirror Call
conditions on at most ten seconds, exactly as turn 2 did. Growing the pool from
71 s to twenty minutes changes nothing.

The pipeline would have run, returned rising numbers, and been wrong: this is
`plausible-return-hides-a-dead-pipeline` with a fidelity meter attached, and it
is worse than the usual case because the meter WOULD have moved —
`voice-evidence`'s ECAPA estimate really does consume the whole pool, so the
measurement improves while synthesis cannot. A single meter climbing beside a
clone that cannot have changed is the `disclosure-announces-the-clone` family:
a surface stating something the mechanism does not support.

**What it was replaced with.** `mirror-learning-is-selection-not-accumulation`.
`vy_mirror_window` is a CANDIDATE POOL with a `quality_score`;
`vy_mirror_conditioning` is the SELECTION, one standing row per replica by
partial unique index. The candidate arithmetic reports
`selectable_candidates` beside `total_windows` and states
`pool_growth_is_not_improvement` on the wire, and the fidelity block emits two
labelled numbers with no combined figure for a UI to reach for. A selection is
replaced only by a STRICTLY better candidate, because a voice that moves
between two equally good ten-second windows moves for no reason.

**The generalisable rule**, and it is the expensive half: *a pipeline whose
inputs grow is not a pipeline that learns.* Before building anything that
accumulates, read the consumer's truncation. Ours was four constants in a file
we already vendor.

## `mirror-call-nul-in-a-template-literal` — an edit that inserted an invisible byte, and the one gate that could see it (2026-08-26, WS-X)

**What was tried.** An ordinary edit to `api/_mirrorcall.js` writing
``const key = `${kind} ${fragment}`;`` — the de-duplication key that stops a
mined chip being proposed twice in one call.

**What broke.** The space between the two interpolations was written as a NUL
byte (U+0000), not a space. Everything still ran: the module imported, the mine
returned deltas, `node -c` had nothing to say, `tsc` does not read `api/`, and
the file rendered identically in every view. The only symptom was that
re-mining a transcript whose chips were all already known proposed all of them
again — because the key built from the DB rows used a real space and the key
built in the mine used a NUL, so `seen.has(key)` was false forever.

In production that is a chip rail that duplicates every habit on every window,
and it is a defect nobody would have attributed to whitespace. `grep` had been
calling the file "binary file matches" for an hour and that was the only clue
anywhere.

**What caught it.** The incremental-mining assertion in `evals/mirrorcall.mjs`
§1 — "re-mining the same transcript with every chip known proposes nothing new"
— which exists because incremental proposal is a CLAIM and a claim needs a
control. Nothing else in the tree could have.

**The rule.** A determinism/idempotence assertion is not test padding; it is the
only instrument that can see an invisible character. And when `grep` says
"binary file matches" on a source file, that is a finding, not noise —
`python3` over the bytes is one command.

## `mirror-fake-db-matched-a-session-instead-of-a-decision` — the table-name router defect, one level down (2026-08-26, WS-X)

**What was tried.** `evals/mirrorcall.mjs`'s fake database routes on STATEMENT
SHAPE rather than table name, exactly as `router-matched-a-table-instead-of-a-statement`
requires. The branches were ordered as written.

**What broke.** The nine-CTE `decideMirrorDelta` statement — the ONE write, the
thing the whole negative control exists to test — was answered by the
`getMirrorSession` branch, because that branch's discriminators
(`from vy_mirror_session s`, `s.session_id = $3::uuid`, `limit 1`) all appear
inside the bigger statement too. The fake returned a plausible SESSION row, the
store read `rows[0]` and reported a decision that never happened, and ten
assertions failed in a way that looked like a store bug.

The same defect a second time and one level down: it is not enough for a mock to
match a STATEMENT rather than a table — the matcher has to be tested in an order
where the most SPECIFIC phrase wins, because a large statement contains the
discriminators of every small statement it joins.

**What it was replaced with.** The write's branch is matched FIRST, with the
reason written above it, and the fake throws on any statement it does not
recognise so an unmatched statement is never an empty answer.

**The rule.** Statement-shape routing needs an ORDER, and the order is
most-specific-first. A mock that over-returns hides real defects while every
assertion stays green — and a mock that returns a plausible row of the WRONG
SHAPE is worse, because the failure surfaces far from its cause.

## `mirror-corpus-count-matched-the-baseline-count` — the same ordering defect, in the same file, an hour later (2026-08-26, WS-X)

**What was tried.** `mirrorCorpusTokens` — the cross-call owner word counter
that makes a chip from call ten legitimately more confident than one from call
one — reads `select coalesce(sum(array_length(regexp_split_to_array(...)))) ...,
count(*)::int as windows`.

**What broke.** The fake's `count(*)::int as windows` branch (the candidate-pool
baseline) was tested first and answered it, so every mined chip got
`corpus_tokens = 0` and tripped the `origin <> 'mined' or (occurrences >= 1 and
corpus_tokens >= 1)` CHECK. The CHECK caught it, which is the system working —
but the DEFECT was in the harness, not the code, and the first reading was the
opposite.

Recorded separately from the entry above because the interesting part is that it
happened AGAIN, in the same file, after the lesson had just been learned and
written down. Two statements sharing a column alias is enough. The durable fix
is not vigilance: it is that an unmatched statement THROWS, so the failure is
always loud, plus most-specific-first ordering as a habit.

## `mirror-caption-longer-than-the-clip` — captioning the full reply and speaking only the first fragment (2026-08-26, WS-AC)

**What was tried.** WS-W's panel caps synthesis text at 280 characters
(`capPanelText`). A Mirror Call reply can exceed that. The obvious shape was to
show the owner the FULL reply as a caption and synthesise the first fragment, so
nothing the clone said was thrown away.

**What breaks.** The screen would say more than the voice said, on the one
surface where the owner is grading the voice AGAINST the text in front of them.
That is `silent-truncation` with a speaker on it, and it corrupts the exact
judgement the call collects: the owner marks the clone down for trailing off
when the clone did not trail off, or marks it up for a sentence they read and
never heard.

**What it was replaced with.** `capMirrorReply` caps at assembly, at
`splitForLimit`'s first fragment, and the CAPTION IS THE SAME STRING. The trim
is not silent either — `assembled_chars` rides on the turn row and the wire
carries a `truncated` block whenever it exceeds the spoken length.

**The rule.** When one channel has to be shortened, shorten both. Two channels
that disagree about what was said is worse than one channel that is honestly
short, and it is worst on a surface whose purpose is comparing them.

## `mirror-call-channel-in-the-generation-ledger` — widening 019's channel CHECK to add a `mirror_call` value (2026-08-26, WS-AC)

**What was tried.** `turn_voice` authorizes through `beginOwnedVoicePreview`, so
a Mirror Call clip books a `vy_replica_generation` row reading
`purpose='voice_preview'`, `channel='studio_preview'`. That is slightly untrue on
the ledger, and the tidy fix looked like adding `mirror_call` to migration 019's
`channel` CHECK.

**What breaks.** 045's `vy_replica_generation_preview_shape` constraint pins the
whole preview lane to `purpose='voice_preview' and channel='studio_preview' and
dialogue_turn_id is null`. A new channel value needs that constraint widened
too, which makes the mirror lane a SECOND SHAPE the provenance path has to
know about — the fork wearing a schema change instead of a code change. The one
rule this workstream was given is not to fork the HMAC / watermark / disclosure
path, and a fork that starts in the DDL is harder to see than one that starts in
a function.

**What it was replaced with.** `vy_mirror_turn.generation_id` (migration 060):
the mirror-call meaning is recorded on the turn that CAUSED the generation, and
`vy_mirror_turn_spoken_binding` makes `voice_state='spoken'` unrepresentable
without it. The ledger row keeps the shape 045 already guarantees.

**The rule.** When a reused lane's record is imprecise, add the precision on
YOUR side of the join. Widening the shared table's vocabulary is how a reuse
becomes a fork one CHECK at a time.

## `mirror-turn-voice-202-read-as-corrupt-audio` — the warming state arriving as an integrity error (2026-08-26, WS-AC)

**What was tried.** Nothing, in the sense that no code was written and then
removed — this is a defect that existed in the tree the moment `turn_voice`
started answering, and was found by reading WS-Y's client against WS-W's server.

**What breaks.** `fetchMirrorCallTurnVoice` tested `response.status === 404 |
405 | 501` for an absent seam, then `!response.ok` for an error, then read the
blob and threw `"The clone's protected audio was invalid"` unless it was
`audio/wav`. **202 is `response.ok`.** So the honest "your voice runtime is
starting on a GPU, about 2 to 3 minutes" body — the one WS-W built the whole
`dispatchWake` flush window to be able to send — would have surfaced to the
owner as an audio INTEGRITY error. A cold start reported as corruption is the
same mislabelling class as `hmac-skew-shorter-than-cold-start`, where a latency
problem arrived as a 401.

**What it was replaced with.** A `MirrorCallVoiceWarming` error carrying the
server's own copy, thrown from a branch tested BEFORE the `ok` check, and a
local notice in `MirrorCallStudio` that clears on the next successful clip. It
is deliberately NOT `VOICE_UNAVAILABLE`: that flag is permanent-for-this-call by
design and a cold start is not.

**The rule.** A three-outcome server needs a three-outcome client. Whenever a
route gains a 2xx that is not the success body, grep every caller for
`response.ok` — that is where the new state silently joins the old one.
---

## player-clients-do-not-beat-a-datacenter-ip

**Tried (2026-08-26, WS-AD):** the first documented lever for the YouTube bot
check — `MEDIA_EXTRACT_PLAYER_CLIENTS`, sweeping every player client yt-dlp
2026.08.19 offers, from the deployed `vyakti-media-extract` container app on
Azure Central India.

**What broke:** all ten. `default, android, android_vr, ios, tv, tv_simply,
mweb, web_embedded, web_safari, visionos` each returned *"Sign in to confirm
you're not a bot"* at the **metadata probe**, before any stream URL was issued.
n=10 clients × 1 video, one job execution, read out of the container's own
stderr via Log Analytics. Numbers and method:
`measurements.md#youtube-extraction-blocked-from-azure`.

**Why it is worth writing down rather than just retrying:** the lever ordering
in `docs/gurukul/youtube-extraction-posture.md` §3 is player-clients → cookies →
proxy, cheapest first, and the cheapest one is now KNOWN not to work from this
egress. A future session that re-runs the client sweep is spending money to
re-derive this. The next lever costs something real — a cookie jar risks the
account it comes from, and a residential proxy is a subscription — so the choice
is the owner's, not a config change to guess at.

**What would reverse it:** a different egress (the client sweep was never the
variable — the IP was), or a PO-token provider plugin
(`bgutil-ytdlp-pot-provider`) which is a different lever than the three
documented. Note that **enumeration was never blocked** and still works, so
"YouTube blocks us" is too coarse a summary: the player API blocks us and the
channel listing does not.

## provisioning-succeeded-is-not-serving

**Tried (2026-08-26, WS-AD):** measuring the player-client lever by `PATCH`ing
the container app's env, waiting for the APP's `provisioningState: Succeeded`,
then sending a signed request.

**What broke:** four lever measurements were taken against the OLD revision and
recorded as results. Container Apps returns `Succeeded` on the app resource
before the new revision carries traffic; the revision list showed
`--0000001` … `--0000004` created and `Stopped` within seconds of each other
while traffic still sat on the original revision. Every one of those four
"levers did not help" readings was a reading of a container that had never seen
the env var.

**What caught it:** a negative control, not vigilance. Setting
`MEDIA_EXTRACT_PROXY` to a dead address (`http://127.0.0.1:9`) and asserting the
error code CHANGES — a request that cannot reach a proxy cannot possibly return
`extractor_bot_check`. It returned `extractor_bot_check`, which is impossible,
which is what exposed the whole sweep. After waiting on the REVISION's
`runningState: Running` **and** `trafficWeight: 100`, the same control returned
`extractor_failed`, and only then were the lever results trusted.

**The general shape, which is the reusable part:** when sweeping a lever, first
prove the lever is CONNECTED by setting it to a value whose failure is
unmistakable and different. `plausible-return-hides-a-dead-pipeline` with the
arrow pointing at the experiment rather than the product: a sweep where every
arm returns the same plausible failure is exactly what a disconnected lever
looks like, and it is indistinguishable from a real negative result without
a control.

## noise-floor-from-a-percentile-of-speech

**Tried (2026-08-26, WS-AD):** estimating a recording's noise floor for
reference-window scoring as the 10th percentile of frame RMS over the whole
file — the standard, obvious estimator, and the one that reads as careful
because it is per-file rather than per-window.

**What broke:** on a recording that is **mostly continuous speech** — which
every good lecture is, and which is the entire input class this lane exists for
— the tenth percentile of frame energy *is speech*. The floor then sits at
speaking level, the 3× voicing threshold sits above it, every frame fails the
voicing test, every window is disqualified as `mostly_silence`, and the lane
refuses `video_enroll_no_usable_window` on its single most normal input. Every
number on every row looked plausible throughout: `voiced_fraction: 0`,
`snr_db: 51.57`, a sensible-looking `noise_floor_rms`. Nothing threw.

**How it was found:** `evals/videoenroll.mjs` failing with **zero eligible
windows** on the fixture lecture. Not by review — the estimator survived being
written, commented and read.

**The fix:** cap the floor against a fraction of the file's own median
(`min(p10, 0.2 × median)`), and cap the voicing threshold at 40% of median. The
estimator now degrades toward "quiet relative to this speaker" instead of
toward nonsense.

**What would reverse it:** a real VAD. The whole probe is a signal heuristic
standing in for one, it says so in `score_source`, and the day a diarizer or
VAD is on the path for every enrollment, the voicing term should come from it
rather than from percentiles of RMS.
## `a-fresh-timestamp-is-what-success-looks-like` — the channel sweep swallowed every listing failure into a clock (2026-08-26, WS-AF)

**What was there.** `api/_channel-ingest.js`'s `sweepWatch()` caught a listing
failure, called `touchWatch()`, and returned. `touchWatch()` wrote
`last_checked_at = now()` and nothing else. The failure code was returned to the
cron's JSON response, which nobody reads, and was written down nowhere.

**What that means in the database.** A channel that has failed its listing on
every tick for a week is INDISTINGUISHABLE from a channel that has been checked
on every tick and had nothing new. Both show a recent `last_checked_at`, both
show no error, and there is no error column to show one in. The plausible value
here is the clock itself.

**Why it matters more on this lane than any other.** The one failure this lane
already PREDICTS lands exactly in that catch:
`docs/gurukul/youtube-extraction-posture.md` expects
`channel_extract_extractor_bot_check` from a datacentre IP on the first real
sweep. Had that sweep run before this was fixed, the owner would have seen a
channel that said it was checked a minute ago, that never ingested anything, and
that gave no reason anywhere.

**What was done.** Migration 060 adds `last_sweep_state` / `last_sweep_reason` /
`last_sweep_videos` to `vy_channel_watch`, with
`vy_channel_watch_sweep_failure_named` as a CHECK so a future writer cannot
re-introduce the silence by forgetting the reason — 058's
`vy_context_item_refusal_named` argument, transferred. `touchWatch()` now takes
the outcome, and both paths also write a `vy_replica_activity` row.

**The generalisation.** Same family as `plausible-return-hides-a-dead-pipeline`,
with a new disguise: the plausible value was not a return value at all, it was a
SIDE EFFECT that happens on both the success and the failure path. Any "mark
that we tried" write that does not also record what happened has this shape.

## `a-video-id-is-not-a-name` — the one string that made the owner's question answerable was dropped at the door (2026-08-26, WS-AF)

**What was there.** `vy_ingest_run.video_ref` holds `dQw4w9WgXcQ`. The
provider's video object carries a `title` (`api/_channel/contracts.js` clamps it
to 200 chars, `youtube-oauth.js` reads it from `snippet.title`) and `openRun()`
never persisted it.

**What broke.** The owner's question is literally "have we received the YT
video". Nobody recognises their own lecture by its YouTube id, so the row that
answers the question was unreadable by the person asking it, and every possible
surface over it would have rendered a wall of eleven-character strings.

**What was done.** `video_title` in migration 060, written on open and on the
retry path with `coalesce(nullif(excluded.video_title,''), …)` so a provider
that stops returning titles cannot blank one we already have. Rows written
before 060 have no title and the surface renders `Video <id>` rather than a
blank, which is honest about what we kept.

**The generalisation worth keeping.** The cheapest data to lose is the data that
is only useful to a HUMAN. Every field on a provider payload that no query joins
on is a field a schema review will not miss. Ask of each one: which question does
a person ask that this string is the only answer to?
## `stash-in-a-shared-git-dir` — never `git stash` from a worktree (2026-08-26, WS-AE)

**What was tried.** To confirm that `verify-release`'s two failures (`stuck-turn
endpoint`, `eval suite`) were the known sandbox gaps rather than damage from a
restructure, WS-AE ran `git stash push -u`, re-ran the gate on the clean tree,
and ran `git stash pop`.

**What broke.** Every worktree in this repo shares one `.git`, and **the stash
stack is global to it, not per-worktree.** A sibling workstream stashed at the
same moment. `stash@{0}` is whatever was pushed last by anybody, so the two pops
crossed: WS-AE's entire restructure left its own worktree, another workstream's
in-flight changes arrived in it, and the tracked files of both were briefly in
the wrong tree. Nothing was lost only because a popped stash's commit stays in
the object store: `git fsck --unreachable`, then locating the `WIP on
gurukul-ws-ae` commit and its untracked-files parent, then
`git checkout <commit> -- <paths>` recovered it. One file that a sibling had
modified in the working tree and never committed (`src/studio/design/tokens.css`)
was overwritten by the recovery and is genuinely gone.

**Why the obvious defence does not work.** `git stash push -- <paths>` narrows
what is stashed but not which entry `pop` takes, and `git stash pop stash@{n}`
races the same way because indices shift under a concurrent push.

**What to do instead.** To compare against a clean tree, never move the working
tree. Read the base from git without touching it:
`git show <ref>:<path>` for one file, `git worktree add` a throwaway directory
for a whole build, or simply reason from the error (`api/_config.js` is
gitignored and `evals/echosim/build/` is a generated artifact, both of which are
absent by construction in this sandbox and neither of which any studio change
can reach).

**The general shape.** This is `gates-that-live-nowhere`'s sibling: a command
that is safe in a single checkout and quietly shared in a multi-worktree one.
Treat every `.git`-level stack (stash, index locks, reflog surgery) as global.


## `a-runner-nobody-runs` — the enrollment pipeline was complete at both ends and had no caller (2026-08-26, WS-AH)

**What was there.** `api/_replica-source.js` finalize enqueues a
`vy_replica_processing_job` row at `step='integrity', state='queued'` for every
uploaded audio source and parks the source at `quarantined`.
`api/_replica-processing/runtime.js` exports `runNextProcessingJob`, a complete
lease/execute/settle runner over a reviewed eight-step DAG, with adapters,
artifact manifests, evidence records, budget reservation and lease recovery.
`services/replica-processing-worker/` is a whole containerised consumer with
ClamAV, ffprobe and Bicep infra.

**What broke.** Nothing called any of it. There was no
`api/replica-processing-sweep.js` and no cron entry; the container job was never
deployed. The owner uploaded a real 32.9 MB MP3 on 2026-08-26T15:28:50Z and its
job row sat at `integrity/queued` with `attempt=0` and `lease_expires_at=null`,
never leased, while the source stayed `quarantined`. Measured live, not
inferred: exactly one job row existed in the whole table.

**Why no amount of reading either end finds this.** Both ends are correct and
both ends are finished. The producer's test passes, the runner's test passes,
the adapters' tests pass. The defect is the ABSENCE of an edge, and an absent
edge is invisible to every test that starts from a node. This is
`aliveness-was-unreachable-not-meera-bound` again, and it is now the second time
this shape has cost this project a working feature.

**What was done.** `api/replica-processing-sweep.js` plus
`api/_replica-processing/sweep.js`, on a `*/5 * * * *` cron.

**The generalisation worth keeping.** For every queue table in this repo, the
question is not "is the consumer correct" but "name the line of code that calls
it, and the schedule that calls that". If the answer is a service that is not
deployed, the queue does not drain. A cron entry is a load-bearing part of a
feature, not deployment trivia, and it belongs in the same review as the runner.

## `a-scan-we-did-not-run-must-never-say-clean` — the tempting shape for a missing capability (2026-08-26, WS-AH)

**What was tried and rejected.** The obvious composition for the serverless
sweep is to build the adapters whose credentials are present and leave the rest
out of the map. It is one line shorter and it is wrong twice over.

**What specifically breaks.** First, `assertAdapter` turns every absent adapter
into ONE code, `missing_processing_adapter`, so an undeployed malware scanner, an
unset Azure key and an expired storage role key all reach the owner as the same
sentence, and those have three different next actions. Second, and worse: the
serverless runtime has no `clamdscan` and no `ffprobe`, so any implementation of
`scanBytes` that "degrades gracefully" degrades into claiming a file is clean.
A fabricated clean verdict is strictly worse than no scan, because downstream
cannot tell it from a real one.

**What was done instead.** Every step ALWAYS has an adapter. A step whose
capability is genuinely absent gets a stub carrying that capability's own named
code, which throws terminally and returns nothing. `native-tools.js` has exactly
three outcomes and no fourth: tool says OK, tool says FOUND, or throw. An
unreadable scanner exit is `clamav_scan_failed`, never `{safe:true}`.

**The generalisation worth keeping.** A default value is a positive claim. Ask
of every fallback: if this fires, what am I asserting, and would I sign it? For
a safety check the honest fallback is always an exception, never a verdict.
## `owner-field-was-not-the-blocker-class` — a two-value field that had to be three things (2026-08-26, WS-AJ)

**What was tried.** `wizardModel.ts` already split every blocker by
`owner: "you" | "platform"`, and `StepBlockers` already rendered two columns
from it. The obvious read of the owner's phone report was that the split existed
and the copy around it was sloppy, so the first attempt was to fix the sentences
and leave the field alone.

**What broke.** The field is right about WHO OWNS A GATE and wrong about WHOSE
TURN IT IS, and those come apart in the exact situation the owner was in.
`person_profile_not_approved` and `calibration_not_approved` are owned by the
person: only they can approve a person model or a calibration. Both are also
unreachable until the platform has processed the material behind them. With the
owner's audio stuck at `quarantined`, both rendered `owner: "you"`, both counted
toward the ember, and both were things no human action could clear. Rewriting
the sentences would have made a truthful-sounding version of the same lie.

**What replaced it.** A second field. `owner` stays, meaning what it always
meant; `cls` is what every surface renders and what the ember keys on, and it
reclassifies a person-owned gate to `us` while `platformWork` says we are
holding the work it depends on. See `decisions.md#blocker-class-is-a-type`.

**The general shape, and the reason this is worth a rejection entry.** A field
that has been correct for months can be correct about a slightly different
question than the one the UI is asking it. The tell is that no amount of copy
work makes the screen honest: when better words cannot fix a sentence, the
sentence is reading the wrong variable.

## `your-turn-was-banned-from-honest-copy-too` (2026-08-26, WS-AJ)

**What was tried.** `blamesThePerson` bans the phrase "your turn" in
platform-owned prose. The first draft of the reclassified note read "this
becomes your turn once processing finishes", which is a promise, not an
accusation, and the eval failed it. The reflex was to loosen the detector with a
lookbehind for "becomes".

**Why that was rejected.** The detector cannot tell "this becomes your turn" from
"it is your turn" without understanding tense and mood, and every exemption
carved for a nicer sentence is an exemption the next author copies for a worse
one. The copy moved instead: "you can pick this up once it clears" says the same
thing and borrows none of the accusing phrase. The near miss is now itself a
negative control in `evals/studiowizard.mjs` §8, so the loosening cannot be
reintroduced quietly.

**The general shape.** When a lint fires on copy you like, the cheap fix is the
exemption and the correct fix is usually the copy. A detector relaxed to admit
a nicer sentence is a detector that admits the sentence it exists to catch.
## po-token-is-a-warm-ip-mitigation-not-a-route

**Tried (2026-08-26, WS-AI):** `bgutil-ytdlp-pot-provider` 1.3.2, built from
source and run in both script mode and HTTP-server mode against yt-dlp
2026.08.19, from a Google Cloud egress in Ohio (`160.79.106.128`, AS396982).
This is the exact lever
`rejected.md#player-clients-do-not-beat-a-datacenter-ip` named as its own
reversal condition and did not test.

**What worked, and it is worth saying first:** it is the only thing measured in
this repo that has ever moved the bot check. Interleaved A/B on the metadata
probe, n = 6 pairs: **5 of 6 succeeded with the provider, 1 of 6 without**.
Connected, real, free, MIT, self-hostable.

**What broke:** two things, and the second is the one that decides it.

1. **It never produced audio bytes. 0 of 12** across three arms (script mode
   default clients, forced `player_client=web` and `tv`, HTTP-server mode with a
   persistent session cache and 90 s spacing). The best trial reached
   `Downloading 1 format(s): 251` and then `unable to download video data: HTTP
   Error 403`. So a PO token can win the player response and still lose the
   media fetch, which are different gates.
2. **After about forty requests over thirty minutes, it stopped helping at all.**
   The same interleaved A/B returned **0 of 4 with the provider and 0 of 4
   without**. Not degraded: gone. Intermediate runs showed `HTTP 429` on the
   watch page and `403` on the InnerTube API before the bot check.

**Why it is worth writing down rather than just retrying:** the shape of this
result is a trap. A session that ran only the first six trials would have
recorded "the PO token provider defeats the bot check from a datacenter IP",
which is TRUE of a warm IP, FALSE of a burned one, and would have been used to
argue against buying a proxy. The measurement that matters is the one taken
after the IP has been spent, and it is the one nobody runs, because by then the
tool appears to be working.

**The general shape, which is the reusable part:** when a lever's effect depends
on a resource that the act of measuring CONSUMES, an early sample measures the
resource and not the lever. IP reputation is such a resource. So is a rate-limit
budget, a free tier, and a cache. Measure late as well as early, and report both.

**What would reverse it:** audio bytes returned from a datacenter egress across
n >= 10 spaced trials on an IP that was not freshly warmed. Metadata success is
explicitly not enough, because metadata success with a 403 on the media fetch is
what was actually observed. Numbers and method:
`measurements.md#po-token-helps-until-the-ip-is-burned`. The route is wired as
`MEDIA_EXTRACT_ROUTE=pot` and is flagged `measuredBlocked` in
`api/_channel/extract-routes.js` so a deploy cannot select it and be told it is
ready.

## public-youtube-frontends-are-not-a-transcript-route

**Tried (2026-08-26, WS-AI):** reaching transcripts without media bytes and
without a credential, so that half of the product could ship today. Seven public
Invidious and Piped instances, the public `timedtext` surface, the InnerTube
`/youtubei/v1/player` API across four client contexts, `youtube-transcript-api`,
scraping `captionTracks` out of the watch page HTML, and cobalt's public API.

**What broke: all of it, from a datacenter IP.** The seven frontends returned
`401`, `403 Endpoint disabled`, `403`, `502`, `526`, `403`, `502` — zero usable.
`timedtext` returned `429` with Google's "Sorry" interstitial. InnerTube WEB
returned `LOGIN_REQUIRED` / "Sign in to confirm you're not a bot" with zero
caption tracks and zero formats; ANDROID and IOS contexts returned `HTTP 400`;
TVHTML5 returned "no longer supported in this application or device".
`youtube-transcript-api` raised its own `IpBlocked`. The watch page returned
`200` and 1.2 MB and contained **zero occurrences of `captionTracks`**. cobalt
returned `400 error.api.auth.jwt.missing`, so anonymous access is closed.

**The one thing that DID work, and why it does not rescue this:** the official
Data API answered a datacenter IP normally (`403 "Method doesn't allow
unregistered callers"` in 150 ms, an ordinary API error rather than a bot
check). But `captions.download` returns only manually uploaded tracks, which
Hinglish coaching lectures essentially never have.

**Why it is worth writing down:** "get the transcript instead, it is easier" is
the obvious next idea after audio extraction is blocked, and it is wrong for a
non-obvious reason: everything except the sanctioned OAuth surface reaches the
transcript through the SAME player API that the audio does, so it is blocked by
the same IP reputation and is not a separate lever at all. A future session
should not spend a day rediscovering that the easy half is the same half.

**What would reverse it:** a proxy or cookie credential, which unblocks the
transcript half more cheaply than the audio half (about 4 MB versus 11 MB per
video), or a paid third-party transcript API. Full sweep table:
`measurements.md#po-token-helps-until-the-ip-is-burned`.

## `a-coded-catch-hides-an-uncoded-throw` — mapping errors by code turns every uncoded refusal into a 500 (2026-08-26, main loop)

**What was tried.** `api/voice-preview.js` mapped errors to responses by
matching `error.code` against three names, and returned 500 for anything else.
It read as careful.

**What broke.** `replicaId()` in `api/_replica.js` threw a bare
`{ status: 400 }` with no code. Sixteen validators in `api/` do the same. So
"you sent no replica_id" reached the browser as a server crash, with nothing in
the logs, and the studio showed a server error for a user mistake. The same
catch also swallowed `audio_protection_origin_required`, which is a DEPLOYMENT
FACT that `docs/gurukul/ENV-MANIFEST.md` §6 already specifies as a 503 — so the
route was contradicting its own documented contract.

**Three separate mistakes, and each is worth naming.**
1. Requiring a `code` when a `status` is present. A 4xx that named its own
   status is an ANSWER; flattening it to 500 discards the answer.
2. Enumerating configuration-absence codes by NAME. The list cannot include a
   service that does not exist yet, and one did not. Matching the SHAPE of a
   configuration refusal (`*_origin_required`, `*_secret_required`,
   `*_not_configured`) is the only version that stays true.
3. Catching without logging. This is what made it unfindable: the crash had no
   cause anywhere. ONE line of `console.warn` turned an unanswerable production
   500 into a one-line answer.

**The rule.** A refusal that chose its own 4xx keeps it, with a stable fallback
code if the thrower did not name itself. A configuration absence answers 503 by
shape. The code is logged either way, because an operator who cannot see why a
production request failed will guess, and guessing is how the previous one
stayed broken.

**What would reverse it.** Nothing about the shape rule. If a validator ever
needs a 4xx that must NOT reach the client verbatim, it gets an explicit
mapping, not a return to the flatten-everything default.

## `the-browser-cannot-reach-production-but-the-product-can-still-be-tested` — 2026-08-26, main loop

**What was tried.** Driving the deployed studio with Playwright pointed at
`https://vyakti-replica-lab.vercel.app`.

**What broke.** Every navigation returned `ERR_CONNECTION_RESET`. The container
routes outbound HTTPS through an agent proxy; `curl` and node's `fetch` work,
and the browser reaches the proxy (a plain-HTTP request is logged by it), but
the browser's HTTPS CONNECT is reset and never appears in the proxy log.
Passing the proxy explicitly, `--no-sandbox`, and `ignoreHTTPSErrors` all
failed. Time was spent here; do not spend it again.

**What worked instead, and it is better than it sounds.** A loopback bridge:
node `fetch` pulls the REAL production bytes and serves them on 127.0.0.1,
relaying `/api/*` back to production. The browser can reach loopback. That
gives real rendering of the real deployed bundle, real API responses, a real
signed-in user, at a real mobile viewport. It found four product defects in
two runs, including the four-layer preview bug.

**What it CANNOT test, stated rather than implied:** anything depending on the
production ORIGIN itself — cookie domains, the real CSP (the bridge strips it,
because the production CSP is written for the production host), CDN edge rules.
Those are untested, not assumed working.

**What would reverse it.** An egress policy that lets the browser CONNECT.
Then point the harness at the real URL and delete the bridge.

## `clamdscan-is-only-a-recommended-package` (2026-08-26, WS-AK)

**Tried.** Building the worker image with
`apt-get install --no-install-recommends ffmpeg clamav-daemon clamav-freshclam`,
which is what `services/replica-processing-worker/Dockerfile` had said since it
was written, and deploying it as the component whose entire purpose is to
provide `malware_scan` and `media_probe`.

**What broke.** The image has `clamd` and no `clamdscan`. On Debian,
`clamdscan` is its own package and is only a *Recommended* of `clamav-daemon`,
so `--no-install-recommends` - which the image wants for every other reason -
drops it silently. `resolveNativeTool` then finds no `clamdscan` on the PATH and
reports `malware_scanner_unavailable`: the exact code the container was deployed
to stop producing. The build log says so in plain sight, under `Recommended
packages:`, and nobody reads that section of a successful build.

**What caught it.** Not review, and not the build. A `REQUIRED_STEPS` assertion
added to `run-once.js` in the same session: the container checks that
`integrity`, `malware_scan` and `media_probe` are all available before it does
anything, and exits non-zero naming the missing ones. First execution printed
`{"error":"worker_missing_required_capability:malware_scan"}` in 20 seconds.

**The reusable part.** A component deployed to provide a capability should
assert that it has that capability, at startup, by name. Without the assertion
this container would have started, leased nothing it could serve, exited 0, and
looked exactly like a healthy idle worker forever - the same shape as
`aliveness-was-unreachable-not-meera-bound`, where both ends were fine and only
the connection was missing.

## `ffprobe-cannot-read-mp3-duration-from-a-pipe` (2026-08-26, WS-AK)

**Tried.** Probing the owner's real 32.9 MB MP3 by streaming the bytes to
`ffprobe ... pipe:0` on stdin, which is what `createNativeToolRunners().probeBytes`
did and what the worker's own `native.js` had done before it.

**What broke.** The step failed `media_probe_output_invalid` on a recording that
is perfectly fine. Measured inside the worker image, same binary, same bytes,
same arguments, only the input changed:

```
ffprobe ... pipe:0  -> exit 0, streams complete, "format": {}
ffprobe ... <path>  -> exit 0, streams complete, "duration": "822.720000"
```

A pipe is not seekable, and an MP3's duration is not in a header that can be
read going forwards - it comes from seeking to the end, or from a Xing frame
that has to be seeked to. So on a pipe the duration is simply absent,
`readFfprobeFacts` rightly refuses a result with no duration, and the failure
lands on the recording instead of on the call.

**Fixed by** writing the bytes to a temporary file and probing the path, then
removing it in a `finally`. The bytes are already fully in memory, bounded by
the storage read cap, so this costs one write and one delete and buys a probe
that works for every container format rather than only the seek-free ones.

**The reusable part.** `exit 0` from a media tool is not the same as a complete
answer, and the parse that catches the difference will name the *file* as
invalid, because that is all it can see. When a probe fails on real user media
that plays fine everywhere else, suspect how the tool was invoked before
suspecting the media.

## `the-mission-brief-said-the-sweep-was-already-merged` (2026-08-26, WS-AK)

**Tried.** Basing on `origin/claude/gurukul-platform` and expecting to find
WS-AH's `api/replica-processing-sweep.js` there, as the brief stated.

**What broke.** It is not there. The sweep exists only on `origin/gurukul-ws-ah`
and was never merged to the platform branch, though it *is* deployed and running
on production - the owner's `integrity` job completed at 18:35:21Z while this
session was reading code that did not contain the thing that ran it.

**Why it matters beyond the inconvenience.** Coordinating with a component means
reading it, and a branch that does not contain it will not say so - it will just
look like a queue with no drainer, which is the exact bug WS-AH had already
fixed. `origin/gurukul-ws-ah` was merged into `gurukul-ws-ak` before any design
work started.

**The reusable part.** Deployed and merged are independent facts. Check the
branch for the file rather than the brief for the claim, and when the two
disagree, the repository is the one that is not guessing.

## `data-modifying-ctes-cannot-see-each-other` (2026-08-26, WS-AK)

**What was tried.** `commitProcessingOutput` writes the artifacts, the evidence,
the settled job, the attempt, the source state and the next queued step in one
PostgreSQL statement, which is right: a crash between any two of those strands
the DAG. To make the write safe it then *validated* itself in the same
statement, by re-reading `vy_replica_processing_artifact` and
`vy_replica_processing_evidence` and joining them against the rows it had asked
for, and aborting through a deliberate `1 / 0` if the counts disagreed.

**What broke.** The re-read can never see the insert. Data-modifying CTEs all
run against the same snapshot and cannot observe one another's effects, so
`valid_evidence` counted the table as it was BEFORE `inserted_evidence` ran. For
any step producing at least one row the counts always disagreed, the guard
always fired, and the whole statement always rolled back with SQLSTATE 22012.

**How large this was.** Every step in the eight-step DAG except `integrity` and
`malware_scan` produces an artifact or a piece of evidence. Those two were the
only steps that had ever completed, and the database held zero artifact rows and
zero evidence rows in total. The commit had never once worked for a step with
output, on any runtime, for any upload. It was hidden behind the undeployed
container: nothing had ever got far enough to hit it.

**Fixed by** counting a desired row as valid if this statement inserted it - it
is in `inserted_artifacts` / `inserted_evidence`, which ARE visible as CTE
results - *or* if an identical row already existed. Both halves are load-bearing.
The first is the ordinary path. The second keeps a retry after a lost response
settling instead of dead-ending. An id that exists with different content is in
neither, so it still aborts, which is the collision the guard was written for.
The guard was also made to stand down when there is no eligible job, so an
ordinary lost lease reports `lost_processing_lease` rather than 22012.

**The reusable part.** A statement cannot audit its own writes by re-reading the
table it is writing. If a check inside a data-modifying CTE appears to validate
the insert, it is validating the past. And a guard that can only ever fail is
indistinguishable from a guard that never fires until something reaches it.

## `signing-before-a-cold-start-cannot-authenticate` (2026-08-26, WS-AK)

**What was tried.** Wiring `AZURE_VOICE_EVIDENCE_ORIGIN` and its HMAC secret
into the processing job and letting `diarize` call the private GPU evidence
service, which is deployed, healthy and scaled to zero.

**What broke.** HTTP 401 `transport_signature_invalid`, with the correct key.
The service's `MAX_CLOCK_SKEW_SECONDS` is 60. The client stamps and signs the
request before sending it, Container Apps then holds it for the roughly 161 s
that waking a scale-to-zero GPU replica takes, and the timestamp is stale by the
time it is checked. A correct request, a correct secret, and a guaranteed 401.

**How the wrong answer was avoided.** The obvious reading is "the secrets do not
match", and the obvious fix is to rotate them - which would have changed nothing
and destroyed the working key. The secrets were compared by SHA-256 digest
instead, without printing either: identical. Then the same job was run again
while the replica was still warm and the identical code authenticated in 20 s.
Two measurements, one of them a positive control, turned a plausible guess into
a mechanism.

**Do not fix this by widening the window.** The window is the replay protection.
The request has to be signed after the replica is awake, or re-signed per
attempt, which is what a retry against a now-warm service already achieves by
accident.

**The reusable part.** An anti-replay window and a cold start are the same kind
of quantity, and nobody compares them until one is inside the other. Any signed
call to a scale-to-zero service has this bug unless the signing happens after
the wake.

## `requeue-resets-attempt-and-the-timing-row-survives` (2026-08-26, WS-AK)

**What was tried.** Reading per-step durations out of
`vy_replica_processing_attempt` for the owner's job, which is the table that
exists to hold exactly that.

**What broke.** The numbers are inflated, silently, by however long a job sat
between attempts. `requeueRecoveredProcessingJobs` sets `attempt = 0`, the next
lease sets it back to 1, and the lease's
`insert into vy_replica_processing_attempt ... on conflict (job_id, attempt) do
nothing` therefore lands on the row the FIRST attempt already wrote. The retry
reuses it: `started_at` stays at the original attempt's start, `finished_at` is
overwritten by the retry's finish.

Measured on the owner's job: every one of the four steps has exactly one attempt
row, and `malware_scan` reads as 783 s when the scan itself took about 1.4 s.
The 783 s is the thirteen minutes it spent failed and waiting for a container to
be deployed.

**Not fixed here.** The fix is a design choice, not a patch: either the requeue
resets `attempt` to the highest row that exists rather than to 0, or the retry
gets a fresh row and the table grows an attempt sequence separate from the job's
counter. Both change what an "attempt" means to everything that reads it.

**Why it matters more than it looks.** This is the table a future session will
use to answer "is the pipeline getting slower". It currently answers a different
question, how long a step waited for a human, in the same units, with no way to
tell which is which from the row.

## `source-duration-was-never-persisted` (2026-08-26, WS-AK)

**What was tried.** Letting `media_probe` record the recording's duration where
it naturally lands: in its own evidence row, `{"duration_ms": 822720, ...}`.

**What broke.** `vy_replica_source.duration_ms` stayed NULL. That column is not
decoration: `worker.js` builds the input reference every later step sends to the
evidence service from the source row, and puts `source.duration_ms ?? null` on
it. So `diarize`, `separate`, `enhance` and `voice_quality` each declared a null
duration for a recording whose length the pipeline had already measured and
written down one step earlier. Nothing rejected the null, which is why it
survived: it is a trap set for whichever future step decides to trust that field.

**Fixed by** having the `media_probe` commit set `duration_ms` on the source
from the evidence it is writing in the same statement. It reads
`desired_evidence`, which is an ordinary CTE over a parameter and therefore IS
visible, rather than the inserted rows, which are not - the same visibility rule
as `data-modifying-ctes-cannot-see-each-other`, applied deliberately this time.

**The owner's existing row was backfilled from its own evidence row**, not from
a typed-in number, so the value has the same provenance it would have had if the
fixed code had written it.

**The reusable part.** A measurement written to exactly one place is a
measurement half the system cannot see. When a step derives a fact that a later
step's input contract has a field for, filling that field is part of deriving it.
## a-green-build-and-a-green-healthz-can-both-lie-about-a-model

**What was tried:** deploying `services/audio-protection` on a slim CPU base
image with the AudioSeal checkpoints baked in, having verified at build time
that both the generator and the detector **load**. WS-AL, 2026-08-26.

**What specifically broke:** every single `/v1/watermark` call returned 503
`audio_protection_failed`, while:

- the ACR build succeeded,
- the container started,
- `/healthz` answered `{"ready":true}`,
- `/v1/sign` and the whole Key Vault chain worked,
- and the container logged nothing but a `weight_norm` deprecation warning.

The cause: AudioSeal's bundled moshi SEANet encoder wraps its forward pass in
`torch.compile`, and TorchInductor shells out to a **C++ compiler on the first
call to that function** and nowhere earlier. `python:3.11-slim` has no `g++`.
So the compiler dependency is invisible to the build, invisible to import,
invisible to model construction, invisible to the readiness probe, and fatal to
every real request.

**Why this is worth writing down.** The instinct after "the models load" is that
the model works. It does not follow, and on this stack it did not: three
independent green signals (build, boot, healthz) all reported success on a
service that could not do the one thing it exists to do. `startup fails without
CUDA` in the README reads like the fail-closed guard for exactly this, and it is
not: it guards the device, not the ability to execute.

**The two fixes, and only one of them is the real one.**

1. Set `NO_TORCH_COMPILE=1`, moshi's own documented off switch
   (`libs/moshi/utils/compile.py`), which returns the plain eager function. This
   makes it work.
2. **Make the build exercise the model, not just load it.**
   `services/audio-protection/bake_models.py` now runs a full streaming
   watermark and a detection at build time and asserts the 16-bit message comes
   back. This is what stops the next person paying for it. A build that can load
   the models but not use them now fails, loudly, in the build log.

**A second thing this cost, and its fix.** The failure was undiagnosable for as
long as it was, because `_run` caught every unexpected exception and answered a
generic `audio_protection_failed` with no trace anywhere, correctly, since the
service is forbidden from logging audio or request bodies. The eval enforced
that with `!/print\(|logging\./`, i.e. no output statement of ANY kind, which is
a proxy for the real invariant. A data-free diagnostic (exception class chain
plus traceback `file:line:function`, never a message or an argument) named the
cause in one request. The eval now tests the actual invariant: it enumerates
every output statement and asserts no interpolated expression names anything
derived from a request. See
`docs/gurukul/AZURE-DEPLOY-STATE.md` section 14.4 and 14.6.

**What would reverse the `NO_TORCH_COMPILE` half:** a measured throughput need
that eager mode cannot meet. Then add a C++ toolchain to the image, or move to
the GPU profile where the pytorch base already carries one, and re-measure. The
build-time exercise half should never be reversed.

## a-cuda-base-image-is-not-free-on-a-scale-to-zero-service

**What was tried:** keeping `services/audio-protection`'s original
`pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime` base, on the reasonable ground
that it is what the source shipped with and minimum distance is usually right.
WS-AL, 2026-08-26.

**What specifically breaks:** the image is ~9.7 GB in that family, and WS-L had
already measured what that costs on this exact platform: image pull dominates
cold start, the service is ready at 161 s, and **the request that woke it dies
at 240 s** on a Container Apps ingress timeout
(`docs/gurukul/AZURE-DEPLOY-STATE.md` section 8). For a scale-to-zero service
sitting directly behind a user pressing "Preview my voice", that is not a
performance note. It means the first press always fails.

Rebuilt on `python:3.11-slim-bookworm` with the CPU torch wheel, the image is
**424,673,280 bytes (424.7 MB)**, a 23x reduction. Measured: pull 9.73 s, ready
19.5 s after scheduling, and a **cold start from true zero of 35.6 s with the
triggering request returning 200**.

**Why it is worth writing down:** "use the base image the service shipped with"
is the safe-looking choice and here it was the one that breaks the feature. The
generalisable rule for this repo is that on Container Apps with
`minReplicas: 0`, **image size is a correctness property of any user-facing
path**, not a cost line. The relevant question is not "does it fit" but "does
the request that pays for the pull survive it".

**What would reverse it:** needing CUDA at all (see
`decisions.md#audio-protection-cpu`), or a warm-replica strategy that means no
user request ever absorbs a cold start. With `minReplicas: 1` the image size
argument weakens a lot, though it never disappears, since deploys and scale-outs
still pay it.

## `registry-selection-leaks-a-pull-url-into-the-dag` — the obvious reuse would have widened what an external ASR lane can read (2026-08-26, WS-AN)

**What was tried.** Wiring `transcribe` through `api/_asr/registry.js`'s
`createProductionAsrProvider(env)` directly — the function that already picks
between the self-hosted ASR lane and Sarvam, in the order SPEC-GURUKUL §8 item
1 requires. This looked like the correct reuse: one selection, used
everywhere, instead of a second copy of "self-hosted wins" logic inside the
processing DAG.

**What specifically breaks.** The self-hosted lane's `transcribe` (`api/_asr/
providers/self-hosted.js`) does not take bytes — it signs a short-lived PULL
URL and hands that to a remote worker over HTTPS. Every OTHER adapter in the
eight-step audio DAG enforces the opposite invariant on purpose:
`azure-fast-transcription.js`'s `resolvePrivateInput` explicitly THROWS
`azure_asr_private_url_forbidden` if its resolver is ever handed a URL instead
of bytes, so a provider can only ever act on bytes THIS process already
fetched and integrity-checked through `storage.resolveInput`'s scoped path
validation. Routing `transcribe` through the registry's selection would have
made that guarantee conditional on which lane happened to be configured: fine
while only Sarvam is live, silently gone the day `ASR_SELF_HOSTED_ORIGIN` is
set, because the registry's own selection order prefers self-hosted whenever
it is present. Nobody would have decided that; it would have happened as a
side effect of an unrelated env var being set on a different service.

**The fix used.** `sarvam-transcription.js` reuses the Sarvam PROTOCOL
implementation (`createSarvamSaarasProvider` — init/upload/start/poll/collect)
directly, via its documented `readAudio` injection seam, fed with bytes
already resolved by `storage.resolveInput`. The self-hosted-vs-Sarvam
SELECTION stays exactly where it was, serving the two callers that actually
need it (channel ingest, mirror-call); the DAG gets Sarvam specifically,
matching the owner's actual instruction, and the byte-only invariant holds for
every adapter in the DAG without exception.

**The lesson that generalises.** "This selection already exists, reuse it" is
not automatically the house pattern (`WS-AC`'s reused synthesis path IS the
house pattern) — reuse is only free when the two call sites share every
invariant the reused code depends on. Here they did not: one caller's security
property (bytes only, never a URL) was incompatible with what the shared
selection could hand back. Reusing the narrower, correctly-scoped piece
(the protocol implementation) instead of the broader one (the selection) kept
the invariant intact.

**What would reverse this.** If the self-hosted ASR provider is ever changed
to accept bytes directly (matching the shape every DAG adapter already
requires) rather than a signed pull URL, `registry.js`'s selection becomes
safe to route the DAG through directly, and this bridge collapses to a
one-line call.
## `a-layout-gate-that-cannot-reach-the-signed-in-screen` (2026-08-26, WS-AM)

**What was tried:** `scripts/check-layout.mjs` in its first form pointed a real
browser at `/studio` at 390, 834 and 1355px and failed when a block of prose
rendered narrower than 220px. The reasoning was sound and the mechanism was
sound. It was pointed at a page that does not contain the thing it judges.

**What specifically breaks:** signed out, `/studio` renders a sign-in card and
nothing else. Every panel the bug lived in (`.consent-panel`,
`.evidence-panel`, `.processing-review`, the wizard bands) requires a session
and a replica. So the gate measured six or seven prose blocks of sign-in copy,
found all of them wide enough, and reported OK. Re-introducing the exact 58px
rail that had shipped the defect did not make it fail. A check whose negative
control does not fire is not a check, and this one was worse than absent
because its name and its output both claimed coverage it did not have.

The author had seen this coming and added a coverage assertion, which is what
turned a false pass into an honest failure. But then the gate could only fail:
there was no way to make it pass except by lowering the assertion, which would
have restored the false pass.

**What was ALSO tried and rejected:** minting a real Supabase session inside the
gate, the way the e2e journey does. It works, and it cannot ship: it needs the
service-role key, so the gate could never run in CI, and a gate that only runs
where the secrets are is a gate that does not run.

**What replaced it:** `studio-layout-fixture.html` plus
`src/studio/layoutFixture.tsx` — the real `StudioApp`, imported from source, with
a replica seeded into state and every `/api/*` route answered from a fixture
table by a stubbed `fetch`. No secret, no network, deterministic. The gate now
judges 264 prose blocks across three widths times three steps, and both halves
of its negative control fire. See `decisions.md#layout-fixture`.

**Why it is worth writing down:** the generalisable rule is that a gate must
assert its own COVERAGE, and that the assertion has to be paired with a way to
satisfy it honestly. This repo already had the first half and it converted a
false pass into a permanent failure, which is better and is still not a working
gate. The question to ask of any new check is not only "would it fail on the
bug" but "can it reach the screen the bug is on, without a secret".

## `viewport-media-queries-cannot-see-a-narrow-container` (2026-08-26, WS-AM)

**What was tried:** the studio's inner content grids (`.teacher-sheet-grid`,
`.hear-voice-body`, `.build-readiness`, `.claim-extraction` and ten more) split
into two or three columns and collapse to one via `@media (max-width: ...)`
queries. Fourteen of them, all carefully written.

**What specifically breaks:** the element they govern does not live at the
viewport width. It lives inside the studio's content column, which is 276px
narrower because the replica rail sits beside it, and narrower again by the
panel padding. Measured at an 834px viewport: `main.studio-main` is 558px and
`.wizard-band-body` is 475px. A `repeat(2, 1fr)` that reads as generous against
834 hands each card 200px and each paragraph 159px, and the media query never
fires because 834 is not less than 820. Two blocker notices measured 115px wide
carrying 91 and 176 characters.

No breakpoint value fixes this, because the query and the container disagree
about how wide "here" is. Moving the breakpoint up to 1100px would fix tablet
and break the same grids on a desktop with the rail hidden.

**What replaced it:** `repeat(auto-fit, minmax(min(100%, Npx), 1fr))`, which
asks the container directly and needs no query. `min(100%, N)` rather than bare
`N` so a container narrower than the floor gets one full-width column instead of
an overflow. N is 260 to 340px for grids carrying sentences and 150px for grids
of labels and counts.

**Why it is worth writing down:** every one of those fourteen media queries was
written by someone being careful, and being careful is not what was missing. The
rule is that a media query is the right tool only for a decision about the
VIEWPORT (is this a phone, is the rail shown). Any decision about whether
content fits belongs to the container, and grid has had a container-driven
answer since `auto-fit` shipped.
## `ffmpeg-pipe-output-cannot-carry-a-sized-wav-chunk` (2026-08-26, WS-AO)

**Tried.** The first cut of `reference-window.js`'s window extraction ran
ffmpeg with output to `pipe:1` (`-f wav pipe:1`), captured stdout, and sliced
the selected window's samples out starting at a hard-coded offset of 44 bytes
-- the size of a minimal canonical WAV header, and the same assumption the
scorer's own `wavBytesForSamples` writer uses when it BUILDS a WAV from raw
PCM.

**What broke.** Every extraction threw `window_audio_truncated` from
`windows.js`'s `readPcm16Wav`, on real audio through real ffmpeg (not a mock --
`ffmpeg 6.1.1-3ubuntu5`, installed and run in this session). Two things ffmpeg
does when writing a WAV to a PIPE rather than a seekable file explain it, both
confirmed by walking the actual output bytes chunk by chunk:
- It cannot come back and patch the `data` chunk's declared byte count once it
  knows the real one (a pipe cannot be seeked backward), so it writes the
  placeholder `0xFFFFFFFF` instead of the true size. `readPcm16Wav` reads that
  literally and correctly refuses it as a truncated/malformed declaration --
  the check exists for real uploads that really are cut short, and a streamed
  ffmpeg output looks identical to one on the wire.
- It also writes an INFO `LIST` chunk (encoder metadata) BEFORE `data`, so even
  ignoring the size placeholder, the real PCM payload starts at byte 78 in the
  measured case, not byte 44. A fixed-offset slice would have silently read
  the wrong 10 seconds -- 34 bytes of header/metadata plus part of the true
  first frame -- rather than erroring, which would have been the worse failure
  to ship.

**The fix, and why it is consistent with an existing pattern rather than a new
one.** Write ffmpeg's OUTPUT to a temp file (same directory, cleaned up in a
`finally`) and read it back, exactly mirroring why `probeBytes` already writes
its INPUT to a temp file for ffprobe -- a real file lets ffmpeg seek back and
patch the header with the true size once encoding finishes, the same way a
seekable file lets ffprobe find an MP3's duration by reading its Xing frame or
seeking to the end. And route the final slice through `readPcm16Wav`'s own
chunk walk instead of a fixed offset, since it already handles exactly this
shape correctly (it was written for real-world uploads, which is why the
`Math.min(body+size, buffer.length)` clamp exists at all) -- reuse rather than
a second, narrower parser.

**What would reverse it:** a future ffmpeg invocation that has a real reason to
stream rather than materialise (a much longer per-call extraction where the
temp-file write itself becomes the bottleneck). Nothing in this lane is close
to that; the owner's own diarized-speech total for the file that motivated this
change is 663.5 s, comfortably inside one temp file per candidate run.

## `self-test-mode-must-not-hand-write-source-set-hash` — the shortcut that looked obvious, tried once tonight, and was correctly refused (2026-08-26, WS-AQ)

**What was tried.** Facing the same stuck state this flag now fixes, the main
session tried to get a draft voice genome built by hand: manually satisfying
`liveness_verified_at`/consent/evidence decisions directly in production, then
inserting a `vy_replica_model_build` row with a `source_set_hash` computed (or
guessed) outside `queueOwnedVoiceGenome`.

**What broke.** `queueOwnedVoiceGenome`'s insert is `on conflict
(replica_id, build_kind, source_set_hash) do update ... returning`, and the
builder that later reads `vy_replica_model_build` cross-checks the hash
against the ACCEPTED evidence/artifact set it can see through
`loadAcceptedVoiceGenomeInput`. A hash computed anywhere else -- even
correctly, even by the same formula -- does not necessarily equal what that
function derives from the CURRENT accepted set, and when it did not match,
the builder correctly refused with `model_build_source_set_changed` rather
than building against an unverifiable input set. The safety property held:
nothing can quietly become "the accepted set" without literally being the
rows `loadAcceptedVoiceGenomeInput` reads.

**Why this stays a law and not a one-off fix.** `REPLICA_SELF_TEST_MODE`
(`context/decisions.md#replica-self-test-mode`) removes the review FRICTION,
never the HASH COMPUTATION -- it calls `acceptAllOwnedEvidenceForSelfTest`,
`selectOwnedVoiceArtifact` and `queueOwnedVoiceGenome` unmodified, so the
hash is always derived from whatever those functions actually accepted,
exactly as it would be for a human reviewer. Any future "just satisfy the
gate" shortcut that computes or copies a `source_set_hash` instead of calling
`queueOwnedVoiceGenome` will hit the identical refusal, by design.
## the-sticky-pager-was-deleted-not-shrunk (2026-08-26, WS-AP)

**What was tried, by an earlier session, and why it looked right.** The sticky
pager (`.wizard-pager`, `position: sticky; bottom: 0`) covered readable prose:
a translucent bar stacking an opaque `.blocker-notice` card, up to 343x186px
of content gone on tablet, which is DESIGN-LAW section 2's "never stack two
light translucent surfaces" violated in pixels. The fix landed was real and
measured: strip the notice's own border/background so the bar reads as one
surface, cap it at two lines with an ellipsis, add `scroll-padding-bottom` so
the last card on a step never parks underneath it. All of that shipped and
worked, exactly as diagnosed.

**What was wrong anyway.** The diagnosis was scoped to "the bar covers
content", which is a real defect and not the owner's defect. Their actual
report, both times it was raised, was that the bar's PRIMARY BUTTON pushed a
person into a step it simultaneously called refused ("I click Meet It and it
tells me to move to the next section even if nothing is ready"), and that its
own explanatory sentence truncated mid word in the two-line box the previous
fix gave it. Shrinking the footprint of a button that lies about where it goes
is polish on the wrong layer: the object was the bug, not its size. A second
attempt (`wizardModel.pagerAction`, gating the Next button on
`computeWizard`'s `state === "running"`) fixed the lying-button symptom
correctly and STILL was not what got asked for, because the owner's next
report named the object itself: "Remove it. Not shrink it, not reword it, not
make it conditional. Delete it."

**What replaced it.** Nothing. `WizardRail`/`CompactRail` were already
always-visible and already computed from the same wizard model; navigation did
not need rebuilding, because the honest place for it already existed beside
the dishonest one. See `context/decisions.md#one-honest-next-action-lives-in-the-rail-never-a-sticky-button`.

**The generalisation worth keeping.** Two consecutive fixes to the same
element, each correct against its own diagnosis and each followed by the SAME
owner complaint restated, is the sign the diagnosis is scoped to a symptom
one layer too shallow. The question to ask before a third patch is not "what
is wrong with this element" but "should this element exist at all" — and here
the answer, asked directly, was no.

## a-panel-hardcoding-its-own-blocker-class-will-drift-from-the-rail (2026-08-26, WS-AP)

**What was found.** `VoicePreviewPanel.tsx` ("Preview my voice") computed its
own "no draft yet" reason as `disabledReason("us", ...)` unconditionally,
regardless of WHY the draft was missing. On the owner's real replica the true
blockers were the owner's own unverified identity/liveness and an unreviewed
evidence set sitting in Processing Review — both `cls: "you"` on the SAME
step's rail — and the panel told them "nothing for you to do here" while the
rail, one scroll away, was naming an act they could take. Two surfaces
computing the same fact and disagreeing is worse than either surface being
wrong alone, because a person has no way to know which one to believe.

**What specifically broke.** The panel's author had a real reason to reach for
`"us"`: the panel's job is to explain why the button is dead, and in the
common case (nothing processed yet) `"us"` is correct. But "the common case"
is not "the only case", and a literal in a status position is a literal
regardless of how often it happens to be right.

**What replaced it.** `wizardModel.voicePreviewBlockReason(input)` — the ONE
place that decides, built by walking `computeWizard(input)`'s own Meet-step
`missing` rows in the order a person would clear them (identity, liveness, the
review-and-approve gate, the voice service). The panel imports it rather than
constructing its own reason, so it CANNOT drift from the rail: they read the
same computed rows by construction, not by convention. Proven by a new eval
property (`evals/studiowizard.mjs` section 10, "the panel's class never
disagrees with the rail's class for the gate it names") over the whole input
space, not just the production shape that caught it.

**The generalisation worth keeping.** Any surface that renders a `you`/`us`
judgement about a gate `wizardModel.ts` already computes is a candidate for
this exact defect the moment someone reaches for a "the obvious answer here is
X" shortcut. The fix is never "make the shortcut smarter" — it is "route
through the one function", because a second decision point is a second place
for the two to disagree, and they will, on exactly the input nobody tested.
## `revision-bump-cannot-be-partial-across-the-dag` (2026-08-26, WS-AR)

**What was tried.** To regenerate ONLY the `enhance` artifact for the owner's
real replica (proving the 24 kHz fix in production without redoing the whole
DAG), a single new job row was inserted: `step='enhance', revision=2, queued`,
leaving `separate` at its existing `revision=1`.

**What broke.** `assertDependencies` (`api/_replica-processing/pipeline.js`)
checks a job's prerequisites against `completedSteps`, and
`loadLeasedProcessingContext`'s query for that set is filtered by
`revision=$4` -- the NEW job's own revision. With no `separate` job complete
at `revision=2`, the dependency check correctly failed with
`processing_dependency_missing: separate`, even though a perfectly good
`separate` artifact existed one revision back. `revision` in this schema means
"a full DAG re-run from `integrity` forward," not "redo one step in place" --
partial reruns are not a supported shape.

**The fix used instead.** For the four steps upstream of `enhance` whose
output the sample-rate bug does not touch (`integrity`, `malware_scan`,
`media_probe`, `diarize`), their EXISTING `revision=1` complete rows were
copied forward as already-`complete` at `revision=2` (same `result`, no
re-execution) -- purely to satisfy the per-revision dependency check. Only
`separate` (copied the same way, since its own output is also unaffected: same
transform_version, same input, so re-running it would have hit the SAME
`vy_replica_artifact_variant_unique` collision this session's other rejection
names) and `enhance` (the one step that actually needed to re-execute) were
touched for real. This is a testing-harness technique specific to a
same-source, same-diarization re-verification and should not be read as "how
reprocessing normally works" -- the product has no user-facing "redo one DAG
step" affordance, and building one was out of scope here.

**What would reverse it.** A first-class "reprocess from step X" DAG primitive
that copies forward unaffected upstream state as part of its own contract,
rather than by hand per verification session. Worth building if this pattern
recurs; not built here because one session's verification need does not
justify a new DAG primitive on its own.

## `voice-quality-cannot-see-a-partial-artifact-generation` (2026-08-26, WS-AR)

**What was tried.** After regenerating `enhance` at a new revision (see the
adjacent rejection), letting `voice_quality` auto-run against it, expecting it
to measure only the four fresh 24 kHz candidates.

**What broke.** `loadLeasedProcessingContext`'s `INPUT_STAGE` artifact query
(`voice_quality: "enhance"`) selects every artifact at `stage='enhance'` for
the source, with NO revision filter -- by design, the same way `enhance`
itself reads `separate`'s artifacts across any revision. That means it
returned all EIGHT enhance artifacts, four stale 48 kHz ones from before this
session's fix and four fresh 24 kHz ones, and `services/voice-evidence/
app.py::_measure` accepts 1 to 4 inputs. The JS-side adapter refused with
`voice_evidence_input_count_invalid` before a single byte reached the GPU.

**Why this is not simply "wait, delete the old ones."** The four stale
artifacts were NOT abandoned data -- one of them (the previously `selected`
one) was still referenced by `vy_replica_generation.preview_artifact_id` on
twenty-three real, dated rows: the owner's actual failed preview attempts,
`wav_format_unsupported` and `voice_preview_wake_in_flight`, from BEFORE this
session's fix landed. Deleting the artifact would have cascaded (`ON DELETE
CASCADE`) through that foreign key and erased the very audit trail that proves
the bug happened in production. The other three stale artifacts had no such
reference and were deleted; the referenced one was left in place and
`voice_quality` was left failing for this session rather than deleting real
incident history to make a gate pass.

**What this means for the next person who re-runs a step at a new revision:**
any INPUT_STAGE query that is deliberately revision-agnostic (there are two:
`enhance` reading `separate`, `voice_quality` reading `enhance`) will collect
EVERY historical artifact at that stage, not just the latest revision's. That
is correct for a step that should see all evidence ever produced, and it is a
trap for a step with a fixed input-count ceiling. `voice_quality` was left
failed on this replica for this reason; it was not required for the preview
path this session needed to prove (`beginOwnedVoicePreview` never reads
`voice_quality`'s output), and is flagged here rather than silently ignored.

**What would reverse it.** Either the artifact-cleanup problem being solved
generally (a "supersede" lifecycle that voice_quality's own query respects), or
`_measure`'s input cap being raised past what a single source's revision
history can accumulate -- neither is a fix this session's scope covered.

## `bandwidth-threshold-first-guess-was-miscalibrated` (2026-08-27, WS-AS)

**Tried.** A first cut of `scripts/check-enrollment-bandwidth.mjs` set
`MIN_ENERGY_ABOVE_8KHZ_FRACTION = 0.015` (1.5%), reasoned from "clean speech
puts sibilants and fricatives well above a null band" -- an intuition, not a
measurement, against the file header's own admission that it had no
speech-bandwidth corpus to derive from.

**What broke.** Run against the REAL fixed reference this session produced
(cut fresh from the owner's original 48 kHz/320 kbps lecture MP3, no
bandwidth-destroying model in the path), the gate FAILED it: 0.022% measured,
far under the 1.5% guess. Cross-checked directly with plain `ffmpeg` (bypassing
this session's code entirely) at native 48 kHz decode: the SAME ~0.02-0.05%
range at two unrelated positions in the file. Real lecture speech puts the
overwhelming majority of its raw energy in voiced, low-frequency content;
sibilants and fricatives are perceptually and identity-critical but are a
small SHARE of total signal power even when genuinely present. A threshold
written from clean-studio-speech intuition would have failed the very fix it
was built to confirm.

**The fix.** Recalibrated against two REAL measurements on the same
recording: the broken reference's 0.000458% (a genuine hard null, floating-
point-noise-floor small) versus the fixed reference's 0.0224% (present,
$\approx$49x higher, still small in absolute terms because that is what real
speech looks like). `MIN_ENERGY_ABOVE_8KHZ_FRACTION` is now 0.00003 (0.003%)
-- roughly 6.5x above the broken floor and roughly 7x below the fixed
reading, discriminating the actual defect (a hard null band from a
16 kHz-Nyquist model) rather than "not very much energy up there", which
turns out to describe every real recording measured in this session.

**The generalisable lesson.** A guessed threshold for a spectral gate is not
safer than no gate at all if it fails the very fix it exists to confirm --
"prefer an error to a believable value" cuts both ways: a value invented
without a real recording to check it against is exactly the kind of
plausible-but-untested number this project's laws exist to catch. Every
threshold in `check-enrollment-bandwidth.mjs` traces to a real FFT run on
real bytes now, not intuition.

## `preview-ledger-requires-activation-this-replica-does-not-have` (2026-08-27, WS-AS, found not fixed)

**Found while answering the coordinator's Q1** ("is the enrollment reference
conditioning the model at all"). `handleVoicePreviewPanel`'s real production
path (`beginOwnedVoicePreview` -> `provider.synthesizePreview` ->
`protectReplicaStream` via `createProductionProtectionAdapters`) fails at the
LAST step, `api/_provenance/providers/neon-ledger.js`'s `open()`, with
`generation_open_denied`, on every attempt made in this session -- for every
reference tried, not specific to any one artifact. Traced to: `open()`'s SQL
requires `r.lifecycle='active'` and a matching row in
`vy_replica_runtime_capability` (`state='active'`, and
`c.voice_profile_id=g.voice_profile_id` etc. by plain SQL equality). This
replica's `lifecycle` is `'enrolling'`, `agent_id` is `null`,
`activated_at` is `null`, and `vy_replica_runtime_capability` holds ZERO rows
for it at any state. A `vy_replica_generation` row from
`beginOwnedVoicePreview` (the STUDIO PREVIEW path, deliberately zero-shot,
pre-activation) always inserts `voice_profile_id`/`profile_version`/
`calibration_version` as literal `NULL` (migration 045's own
`drop not null`, `channel='studio_preview'`) -- and
`vy_replica_runtime_capability`'s matching columns are NOT NULL (migration
023), so `c.voice_profile_id=g.voice_profile_id` can structurally never be
TRUE when `g.voice_profile_id` is NULL, regardless of what capability exists.
Six REAL sealed generations with real watermark segments DO exist in the
database from earlier in this session's timeframe (02:43-02:51Z), all for the
same original (unfixed) reference artifact, proving this path CAN succeed --
so a capability row briefly existed and was since removed (the runtime
capability table is empty at every state, not merely revoked, so this was a
hard delete, not this session's doing since `activateOwnedRuntime` called
here threw before any write, confirmed by checking `vy_replica.agent_id`
stayed `null` throughout).

**What broke, precisely, if read as a bug rather than a state problem.** If
`voice_profile_id` is meant to be genuinely optional for a preview generation
(which migration 045 says it is), `neon-ledger.js`'s `open()` comparing it
with plain `=` against a NOT-NULL capability column can never match a NULL on
one side -- this is either an intentional design where NO preview can ever
open in the production ledger without a fully activated runtime (which would
mean "Preview my voice" cannot work for anyone before activation, a serious
product-level contradiction with what the panel is FOR), or a genuine
NULL-unsafe comparison bug. This session did not determine which, and did NOT
patch it -- it is a provenance/safety-adjacent component, outside this
workstream's brief, and the coordinator's own thread was independently
investigating the same code at the same time. **What this session did
instead**, to answer Q1 without touching the ledger: called
`provider.synthesizePreview` directly (the real GPU broker, real HMAC, real
disclosure text, real watermark verification inside the provider) and
skipped only the ledger's DB bookkeeping, which has no bearing on whether the
reference conditions the model. Flagged here by name so the next session
does not re-discover the same wall.

## `deepfilternet3-on-vs-off-not-measured-this-session` (2026-08-27, WS-AS, not attempted)

**Not tried, stated plainly rather than guessed at.** The brief asked whether
DeepFilterNet3 (`enhance`) helps or hurts identity preservation once the
reference is genuinely full-bandwidth, since the owner's real background
noise makes this a real trade rather than an obvious "denoise is good" call.
This session did not measure it: doing so honestly needs a real ECAPA
speaker-embedding comparison (enhance-on vs enhance-off, same window, same
text/seed) and `services/voice-evidence` -- the only service that computes
that embedding -- has NO external ingress from this session (confirmed:
`https://vyakti-voice-evidence.internal...azurecontainerapps.io/healthz`
returns HTTP 404 through the session's proxy, and its Container App
`ingress.external=false` in its live ARM definition). The `voice_quality` DAG
step reaches it from inside the Azure environment and writes real embeddings
to `vy_replica_processing_evidence`, but running that step for a synthesized
clip requires either an ACR image rebuild deploying this session's fix (not
done -- the fix lives entirely in `api/`, which the running container has not
picked up) or fabricating a job invocation this session did not build.
**What would answer it:** rebuild+redeploy `vyakti-replica-processing` with
this branch, requeue `separate`->`enhance`->`voice_quality` on the owner's
source at a new revision with enhance forced on and off as two variants
(the adapter already emits both `identity-preserving` and
`noise-suppressing` candidates per input -- `attenuation_limit_db=12.0` vs
`None` -- so the DATA for an A/B may already exist in `vy_replica_processing_
evidence` for whichever revision's `voice_quality` step last completed
successfully; revision 2's is `failed` for an unrelated, already-diagnosed
reason, `rejected.md#voice-quality-cannot-see-a-partial-artifact-generation`),
then compare ECAPA cosine per variant against the same genuine-owner-audio
reference. No offline mock can substitute -- this is exactly the class of
number `first-real-clone` and `reference-window-beats-the-finetune` warn
against inventing.

---

## `surface-chat-is-not-a-room-tenant-key` — global binding uniqueness defeats the second clone (2026-08-27)

The first clone-channel implementation correctly put `ctx.agentId` beside the
persona, but room lookup still selected only `(surface, surface_chat_id)`, the
unique index enforced that pair globally, DM logs/history omitted `agent_id`,
and the room episode/action writers still named Meera's constant. Two clones
receiving the same opaque chat id could therefore share the first room, fail
to create the second, or persist/retrieve under the wrong relationship while
the compiled persona looked correct.

The rejected shortcut is to rely on bot credentials making chat ids globally
unique, or to trust a globally unique `group_id` after an unscoped lookup.
Neither is a storage boundary. Different credentials routinely reuse opaque
user/chat ids, and a deep-link room id is caller-controlled input. The fix is
an explicit SQL predicate or write value at every shared runtime operation,
plus agent-aware uniqueness in migration 064.

**What would make the old key safe:** a proven platform-wide invariant that
all surface chat ids are globally namespaced across every clone credential.
No supported surface provides that invariant, so the old key remains rejected.
## `raising-the-upload-cap-alone-still-fails-long-media` (2026-08-27)

**What was tried conceptually and rejected.** Change audio's 256 MiB validator
to 1 GiB and keep the existing signed PUT plus processing adapters unchanged.

**What specifically breaks.** The browser still retries the entire file after
one dropped connection. `readPrivateReplicaObject` still concatenates the
whole original in the Node heap behind a 64 MiB processing limit. ClamAV's
`--stream` remains coupled to `StreamMaxLength` (70 MiB in the shipped config),
and voice evidence still refuses recordings beyond its 20 minute hard ceiling.
The upload can therefore say complete while processing is guaranteed to stop,
which is a larger dishonest state rather than support for large media.

**What replaced it.** Signed client-side TUS; private storage-to-disk streaming
with hash verification; ClamAV local file-descriptor scanning; deterministic
overlapping diarization chunks with conservative label reconciliation; streamed
Sarvam upload; and an explicit "Upload complete. Processing queued." state.

## `per-bucket-limit-cannot-bypass-the-project-global-limit` (2026-08-27)

**What was tried.** Before deploying the web uploader, update the private
`vyakti-replica-private` bucket to `file_size_limit=1073741824` through the
authenticated Storage API and read the setting back.

**What broke.** Supabase refused the update with HTTP 413 `EntityTooLarge`.
The bucket remained private and retained no explicit per-bucket limit. Supabase
documents that a bucket limit may not exceed the project global Storage limit;
there is no safe service-role or application-code bypass for that account law.

**What replaced it.** The resumable and streaming runtime shipped, because it
still fixes dropped connections, whole-file browser buffering and the worker's
old 64 MiB heap wall for files the account accepts. The 1 GiB claim remains
blocked on an explicit account-level limit change and a real >50 MiB smoke. No
subscription purchase or billing change was made by this release.

## `requested-cfg-without-reference-evidence-is-not-an-ab-arm` (2026-08-27)

**What was tried and rejected.** Let `earbench.mjs` and `first-clone.mjs` keep
sending Hindi synthesis with `cfgWeight: 0.5` while omitting reference language
mode and evidence scope, then infer the experiment arm from the requested style
value.

**What specifically breaks.** The language-conditioning contract treats an
omitted reference mode as `unknown` and, for Hindi, changes effective CFG to 0.
A nominal 0.5 arm can therefore become byte-for-byte the same conditioning as
the mitigation arm while its script still looks like a 0.5 experiment. A
requested value alone cannot identify what the model ran, and labelling an
English/Latin reference as Devanagari merely to prevent the switch would make
the evidence false.

**What replaced it.** Both live scripts require an explicit reference-language
mode and evidence scope for Hindi and record the returned effective CFG.
Earbench's `--cfg-ab` uses a sealed, receipt-bound legacy compatibility control
for historical effective CFG and a current-contract explicit `cfg=0` arm, with
the contract difference recorded. Neither arm carries a preference claim.

## `rejected-hindi-samples-are-negative-controls-not-a-benchmark` (2026-08-27)

**What was tried and rejected.** Treat `q1-direct-after.wav` or
`vyakti-v2-post-deploy.wav` as the quality level to preserve because the files
were 24 kHz, completed the protected synthesis path, or sounded less broken
than an earlier `my-clone.wav` attempt.

**What specifically broke.** The owner judged both Hindi outputs extremely bad:
robotic, non-human, and like an American or British speaker talking in Hindi.
The later file is therefore not a benchmark and “better than the previous
failure” is not a release threshold. The predominantly English source is a
credible accent-transfer confound under Chatterbox's own guidance, but it has
not been isolated as the sole cause. Watermark, transport, RTF, sample rate and
embedding checks cannot overrule this human failure.

**What replaced it.** Both files remain negative controls. New releases require
language-matched Hindi and Hinglish calibration references, explicit conditioning
evidence, a blinded matched-seed incumbent-versus-CFG-zero comparison, and then
an isolated Hindi-pack arm. No arm is promoted until the owner or listeners who
know the voice provide a recorded preference and intelligibility does not regress.

## `aca-gpu-member-and-long-probe-delay-are-invalid` (2026-08-27)

**What was tried and rejected.** Express the T4 as `gpu: 1` in the Container
App container resources and give the model a 240-second initial readiness delay.

**What specifically breaks.** The live Microsoft.App API rejects the `gpu`
member because GPU selection belongs to `workloadProfileName`, and its probe
schema bounds `initialDelaySeconds` to 1 through 60. The earlier source-only
eval did not compile or submit the Bicep and therefore missed both deployment
failures. A Hindi arm using the default app names could also have replaced the
single-revision production English runtime.

**What replaced it.** Container resources now declare only CPU and memory, the
T4 workload profile selects the GPU, and startup tolerance uses repeated
bounded probes with roughly 555 s of budget. Bicep name resolution forces
non-production runtime and broker names for `hindi_v3`; focused evals reject
zero or over-60-second initial delays, a `gpu` resource member, insufficient
startup budget, and reuse of either production name.

## `neon-object-storage-beta-is-not-the-production-media-plane` (2026-08-27)

**What was considered and rejected.** Spend the available Neon credits on
hour-long source audio, either as Postgres `bytea` values or through Neon's new
S3-compatible Object Storage beta, to remove the Supabase object ceiling.

**What specifically breaks.** Database rows would amplify WAL, backups,
branching and query-path pressure for data that is never relationally queried.
Neon says its object product is beta, currently limited to AWS `us-east-2`,
free under unpublished guardrails, and not yet feature-complete for production;
the current Vyakti database is in a different region. Its copy-on-write branch
inheritance is also unsafe as an assumed biometric-erasure contract until every
descendant branch is discovered and purged.

**What replaced it.** Neon keeps the high-value relational state and credits
serve database compute. A dedicated private Azure Blob account stores large
bytes under explicit locators, using the available Azure grant. Neon Object
Storage may be benchmarked later behind the same registry only after region,
limits, presigned multipart behavior and cross-branch erasure are proven.

## `single-self-test-boolean-is-a-global-footgun` (2026-08-27)

**What was tried.** Use only `REPLICA_SELF_TEST_MODE=true` on the processing
worker, then auto-grant identity, biometric/training/inference consent and
review decisions after `voice_quality` reaches ready.

**What specifically broke.** It was too late to enable the first upload:
`createPendingSource` requires active `capture` and `storage` rows before it
creates a source, while the worker hook cannot run until that source has passed
all eight processing stages. The flag was also global to the job environment;
its SQL constrained rows to their real owner and self mode, but did not
constrain which owner could receive the bypass. Any authenticated account with
a self replica could therefore become eligible while the flag stayed on.

**What replaced it.** The source route now bootstraps all six private
ingestion/model scopes before its unchanged consent predicate, but only when an
exact internal-testing marker and an exact owner UUID allowlist accompany the
boolean and match the authenticated caller. The worker repeats the same owner
guard before review/queue. The legacy boolean by itself is inert. This is not
live until both Vercel and the Azure processing job receive all three settings.

The first worker-template compile also rejected an incomplete conditional
array passed to `concat`: the Azure-storage secret branch had no explicit
false value. Source review and string-based tests had missed it. The template
now uses `checkedAzureStorage ? [...] : []`, and a real Bicep compile is part of
this release evidence rather than an inferred pass.

## `raw-browser-file-type-is-not-storage-mime-authority` (2026-08-27)

**What was tried.** Infer an accepted source MIME for the database, but set the
Azure Blob property from the operating system's raw browser `File.type`; then
retry finalize by looking up only a `pending_upload` source.

**What specifically broke.** Windows labeled an MP3 as `video/mpeg` while the
extension-aware intake contract correctly stored `audio/mpeg`. Azure preserved
the wrong raw label, so exact finalization rejected a byte-perfect object with
`mime_mismatch`. That transition made the row `rejected`; the next finalize
lookup could no longer see it and falsely reported `pending_source_not_found`.

**What replaced it.** The signed capability carries the already-validated
server MIME and the block-list commit uses only that value. Finalize retries
read the exact owner-scoped source and preserve terminal state and rejection
code. OS MIME tables remain a hint for initial intake, never storage authority.

## `initial-queue-only-clamav-startup-misses-a-new-scan-child` (2026-08-27)

**What was tried.** Start ClamAV only when the queue snapshot taken before the
worker loop already contains `malware_scan`.

**What specifically broke.** A root `integrity` job did not trigger startup.
The same execution completed it, created `malware_scan`, immediately leased the
child under the existing four-job budget, and failed because no daemon socket
existed. The live failure code was `clamav_daemon_unavailable`; retrying the
file or changing its size could not fix worker ordering.

**What replaced it.** Both `integrity` and `malware_scan` trigger signature
refresh and daemon readiness before the run loop. Empty schedules still avoid
the fixed ClamAV cost, while a run that can create a scan child cannot reach it
without the daemon already answering.

## `plus-suffixed-adapter-version-is-not-a-valid-processing-fact` (2026-08-27)

**What was tried.** Decorate the evidence adapter's version with
`+normalized-overlap-chunks-v2`, then test only that chunk execution and overlap
reconciliation worked.

**What specifically broke.** The production contract persists adapter facts
under `^[a-z0-9][a-z0-9._-]{0,79}$`; `+` is forbidden. The live worker rejected
the adapter before calling it and terminally failed diarization. The earlier
functional fixture never invoked `assertAdapter`, so it proved the algorithm
while missing the boundary that actually ships it.

**What replaced it.** The wrapper uses
`-normalized-overlap-chunks-v2`, and the focused suite asserts the composed
adapter against the production contract before exercising long and short
audio behavior.

## `foreground-clamd-cannot-outlive-a-run-once-queue` (2026-08-27)

**What was tried.** Spawn foreground `clamd`, wait until it answers, process a
bounded queue and return the report without retaining or stopping the child.

**What specifically broke.** The referenced child kept Node's event loop alive
after all useful work settled. Azure continued to show and bill the execution
as `Running`, and later five-minute schedules overlapped it even though it held
no useful lease.

**What replaced it.** The run owns the child handle and stops it from `finally`
on success, retry, failure or budget cancellation. Empty executions still never
start ClamAV.

## `generic-processing-worker-error-is-not-an-operational-diagnosis` (2026-08-27)

**What was tried.** Convert every unexpected exception at the worker boundary
to `processing_worker_error` and persist only that code.

**What specifically broke.** The long lecture reproduced the code after the
known adapter defect was fixed, but neither the job row nor the single console
report could identify whether extraction, private transport or reconciliation
threw. Retrying the same opaque failure supplied no new evidence.

**What replaced it.** Unexpected errors retain the stable public code while a
server-only, content-free diagnostic records a bounded type, strictly safe
message and repository-local frame. Unsafe message shapes are redacted by
construction and covered by a negative test.

## `diarization-adapter-object-is-not-the-diarize-function` (2026-08-27)

**What was tried.** Store the real adapter under `evidence.value.diarize`, pass
that object as the chunk delegate, then call `evidence.value.diarize(...)` from
the per-chunk callback.

**What specifically broke.** The value is an object with metadata and a
`diarize` method, not a callable function. Every real long-audio job threw a
TypeError before its first private evidence request; the earlier chunk fixture
used a separate callback and never exercised this production composition seam.

**What replaced it.** A single composed-diarization helper calls
`delegate.diarize(...)`. Its focused regression executes that exact helper
with the real adapter-object shape and proves method dispatch for a normalized
chunk.

## `chunked-transfer-and-wav-name-do-not-describe-a-known-size-mp3` (2026-08-27)

**What was tried.** Stream a known-size MP3 into Sarvam's Azure directory SAS
without `Content-Length` and always name the blob `input-0.wav`.

**What specifically broke.** Node used streaming transfer semantics for the
body and Azure rejected the Put Blob request with HTTP 400. The hard-coded WAV
name also contradicted `Content-Type: audio/mpeg`, leaving Sarvam to infer which
part of the request was truthful.

**What replaced it.** The request declares the exact byte count already proven
by the private storage seam and selects a small allowlisted extension from the
declared MIME. A Readable-stream regression covers the production branch.

## `latest-300-review-rows-cannot-decide-long-source-readiness` (2026-08-27)

**What was tried.** Reuse the review UI's newest 300 evidence rows when deciding
whether a VoiceGenome build may be queued.

**What specifically broke.** A completed 1:49:31 source had 1,683 accepted
speaker segments, but later transcript and language evidence displaced every
speaker row from that window. Readiness reported zero speaker segments while
the immutable build query could see them.

**What replaced it.** Queue readiness uses the accepted, selected-artifact-
bound build window with the same 2,000-row fail-closed limit as draft creation.

## `newest-enhance-artifact-is-not-the-best-identity-reference` (2026-08-27)

**What was tried.** In owner-only self-test mode, select the newest unselected
enhance artifact without considering its quality manifest.

**What specifically broke.** The later full noise-suppression variant was
selected while the sibling explicitly marked as identity preserving remained
unused. Insertion order is not voice-likeness evidence.

**What replaced it.** The automatic no-review fallback ranks explicit identity
preservation first, then legacy identity variant names, then unknown variants,
and noise suppression last. This is conservative selection, not a quality win.

## `preview-client-cannot-stop-before-the-server-wake-window` (2026-08-27)

**What was tried.** Stop Studio after six 30-second polls while retaining a
200-second server belief that the first GPU request is still in flight, and
discard a late provider result without updating runtime warmth.

**What specifically broke.** The page first exhausted its 180-second budget
before any request was allowed to re-enter synthesis. Extending it to seven
polls crossed the 200-second window live, but poll seven dispatched the required
second synthesis and then stopped on that same warming response. Crossing the
window was necessary and not sufficient; the second request also needed time to
finish before a later protected request.

**What replaced it.** A validated late provider success marks runtime warmth
without sealing the abandoned generation. Ten client polls cover 300 seconds,
so the seventh can cross the server window and dispatch a second synthesis, that
synthesis can settle, and a later poll can make the fresh protected request.
The displayed cold-start range is 2 to 5 minutes rather than the disproved
3-minute ceiling.

## `fish-s2-self-host-is-not-a-current-commercial-t4-arm` (2026-08-28)

**What was tried.** Qualify Fish S2 or S2.1 as another self-hosted in-house arm
on the existing Central India serverless T4, alongside Chatterbox and IndicF5.

**What specifically broke.** Fish's official S2 documentation recommends at
least 24 GB of VRAM while the current T4 has 16 GB. More importantly, the
published Fish Audio Research License grants research and non-commercial use;
commercial use requires a separate written agreement. S2.1 is available as a
vendor API, not as a permissive replacement for the in-house stack. Treating an
API promotion or research checkpoint as commercially owned infrastructure
would misstate both hardware feasibility and license rights.

**What replaced it.** Benchmark Fish S2.1 Pro through the official API as a
vendor quality anchor, cost it at the paid S2 Pro fallback rate, and keep
self-hosted S2 out of production eligibility. A written commercial license plus
a measured 24-GB-or-lower deployment path would reverse this rejection.

## `romanized-hindi-plus-english-disclosure-is-not-one-hindi-request` (2026-08-28)

**What was tried.** Prepend the fixed English AI disclosure to arbitrary user
text, label the whole string `hi`, and send it through one Chatterbox forward
pass. Romanized Hindi, Devanagari Hindi and embedded English technical words
all shared that single tag.

**What specifically broke.** The exact Studio default reached the model as
Latin script, so the model could read Hindi words through an English grapheme
prior. The English disclosure was simultaneously forced through Hindi. A
mixed sentence carried no token-level language boundary at all. This is a
request-contract defect independent of voice-reference bandwidth, and the
owner's foreign-accented robotic Hindi is the live negative control.

**What replaced it.** A deterministic bounded frontend converts only reviewed
Roman-Hindi and classroom borrowings, keeps unknown English unchanged in an
explicit English segment, and uses a fixed Hindi disclosure for Hindi. Every
segment, language, source transformation, request and response is hash-bound.
Too many switches or an English segment on the Hindi-only model fails by name;
there is no silent single-language fallback.

## `gated-indicf5-weights-cannot-be-fetched-anonymously` (2026-08-28)

**What was tried.** Preflight the exact official IndicF5 weight revision without
a credential before scheduling a paid Azure image build.

**What specifically broke.** Hugging Face returned HTTP 401 because the model
uses gated automatic approval and the owner account has not accepted its terms.
No local environment file contains an HF token. A remote build cannot obtain
the pinned weights, and retrying it on paid infrastructure would not change
that authorization state.

**What replaced it.** A zero-cost access check fails by name. The owner accepts
the official model conditions and provides one read-only token; only then may
an ACR task receive it through a BuildKit secret mount.

**Follow-up 2026-08-28.** The owner accepted the model conditions and a
credentialed exact-revision preflight succeeded. Anonymous access remains a
valid negative control. The credential was used through a masked build-secret
path and was not written to the repository or runtime configuration.

## `indicf5-acr-secret-schema-and-incompatible-hub-pin-do-not-bake` (2026-08-28)

**What was tried.** First, declare a top-level ACR task secret id without a Key
Vault source and supply its value only when queuing the run. Second, pin
`huggingface-hub==0.29.3` alongside `cached-path==1.6.7`.

**What specifically broke.** ACR rejected the first task before its image build
because that secret declaration is invalid without a source. Pip rejected the
second build because cached-path requires huggingface-hub below 0.28. Neither
failure loaded a model or consumed GPU time.

**What replaced it.** The task references only a BuildKit secret mount and the
run supplies the secret value out of band. The hub client is pinned to 0.27.1,
which satisfies both cached-path and transformers. The isolated IndicF5 suite
executes the compatibility constraint so a future dependency edit cannot
silently restore this resolver conflict.

## `first-clone-reference-error-cannot-shadow-probe-failure` (2026-08-28)

**What was tried.** Summarize a first-clone run immediately after the reference
file read failed while report variables were declared later in the module.

**What specifically broke.** JavaScript's temporal dead zone raised a secondary
ReferenceError from the summary, masking the real missing-reference failure and
preventing an honest partial report.

**What replaced it.** Report variables are initialized before the probe. An
executable missing-file regression requires exit 1, the original failed probe,
an explicit unmeasured fidelity line and no ReferenceError.

## `noncommercial-weights-and-converter-first-architecture-are-not-production-bases` (2026-08-28)

**What was tried.** Treat broad language coverage or a permissive source-code
license as enough to enter a production bakeoff, and treat OpenVoice tone-color
conversion as the main repair for the rejected western Hindi output.

**What specifically broke.** OmniVoice's official card licenses its pretrained
weights CC-BY-NC even though its code is Apache-2.0; X-Voice makes the same
code/weight distinction with MIT and CC-BY-NC. OpenVoice receives speech that a
base TTS has already pronounced and performed, so conversion cannot be assumed
to repair accent, articulation, rhythm or breath. DhVaani's checkpoint is
Apache-2.0 but explicitly points users to upstream corpus terms, so it is not
production-cleared until that audit closes.

**What replaced it.** Production qualification starts with exact pinned,
permissively licensed direct cloners: VoxCPM2, MOSS-TTS Local v1.5 and ZONOS2.
Noncommercial releases remain research references, OpenVoice remains a measured
diagnostic, and DhVaani remains a Hindi control. A later commercially released
weight set, completed corpus audit or matched human win would reverse the
corresponding exclusion.

## `openvoice-enable-watermark-keyword-is-not-a-valid-disable-switch` (2026-08-28)

**What was tried.** Construct the pinned official `ToneColorConverter` with
`enable_watermark=False`, then apply Vyakti's PerTh watermark after conversion.

**What specifically broke.** The pinned subclass reads that keyword only after
forwarding every keyword to `OpenVoiceBaseClass.__init__`, whose signature does
not accept it. The runtime would fail with `TypeError` before loading the
converter. Leaving the default in place would instead load and apply WavMark
before PerTh, adding an unmeasured second acoustic transform and still not
satisfying the product's required final PerTh proof.

**What replaced it.** A narrow subclass invokes the pinned base initializer,
sets the inherited watermark model to `None`, and uses the official extraction
and conversion methods unchanged. PerTh is applied and detected only after
conversion, and the receipt records the native watermark as disabled before
PerTh. A future OpenVoice release with a tested constructor switch could replace
the subclass after output equivalence and watermark-order tests.

## `keyvault-purge-protection-cannot-be-explicitly-disabled` (2026-08-28)

**What was tried.** Declare `enablePurgeProtection: false` on a new
evaluation-only Key Vault so its deletion behavior was explicit in source.

**What specifically broke.** Azure rejected the deployment with `BadRequest`:
the property cannot be set to false because enabling purge protection is an
irreversible one-way setting. The failure happened before the evaluation trust
anchor was usable. The initially generated HMAC value was discarded and no
candidate app referenced it.

**What replaced it.** Omit the property, keep soft delete at the platform
minimum seven days, and enforce by regression that purge protection is never
set true. A second deployment generated a new cryptographically random HMAC and
succeeded; only its versioned URI is consumed by candidate apps.

## `moss-v1-5-does-not-fit-the-existing-t4-by-repository-size` (2026-08-28)

**What was tried.** Preflight MOSS-TTS Local v1.5 as the next candidate on the
existing 16 GiB T4 before paying for an image build or GPU start.

**What specifically broke.** The exact public model and required MOSS Audio
Tokenizer v2 contain 17,615,117,536 bytes of files before CUDA libraries,
activations and KV cache. Upstream publishes no peak-VRAM result for this
checkpoint. Repository bytes are not a peak-memory measurement, but they are
already larger than the T4 capacity and therefore disprove an unqualified T4
fit claim. The staged plan also forbids MOSS A10 spend before VoxCPM2's first
blind screen. No paid retry can answer either condition honestly today.

**What replaced it.** The runtime refuses GPUs below 22 GiB. A remote-only,
private A10 Spot definition carries a USD 25 cap, four-hour self-deallocation,
daily shutdown and no production route, but remains undeployed until the VoxCPM2
gate closes. A measured, quality-preserving quantized route could reverse the
T4 rejection; a hopeful build cannot.

## `old-setuptools-cannot-parse-voxcpm2-pep639-license` (2026-08-28)

**What was tried.** Build the exact pinned VoxCPM source with the setuptools
75.8.0 version inherited from the pinned PyTorch CUDA base.

**What specifically broke.** ACR run `cu1p` reached upstream package metadata
generation and failed after 192 seconds. The pinned `pyproject.toml` uses the
PEP 639 SPDX string `license = "Apache-2.0"`; setuptools 75.8 validates only
the older table-or-file schema and rejected that valid upstream metadata. No
image was created, no model loaded and no GPU ran. Retrying the same resolver
cannot change the schema mismatch.

**What replaced it.** The remote build pins setuptools 80.9.0 and wheel 0.45.1
before building the exact source with build isolation disabled. Corrected run
`cu1q` built the source wheel successfully. The isolated suite requires a
setuptools release that accepts the SPDX form. A future base image whose
verified build backend supports PEP 639 could remove the explicit pin.

## `asr-output-is-not-an-exact-reference-transcript` (2026-08-28)

**What was tried.** Name the provider transcript used for Qwen in-context
cloning an exact reference transcript, and obtain it from the existing Sarvam
speech-to-text secret.

**What specifically broke.** Provider ASR is an unreviewed hypothesis even when
its text looks plausible; no human compared it with the selected 12-second
owner window. The live Sarvam request also returned HTTP 402 before synthesis,
so that path could not produce even the hypothesis. Calling either result
exact would turn model input into stronger evidence than was measured.

**What replaced it.** The run used the existing Azure Speech resource and seals
the text only as `evidence_scope: asr_unreviewed`, with provider, transcript
hash, reference hash, offset and duration. The private hypothesis is reusable
for matched candidates without another provider call. A human-reviewed,
time-aligned correction can replace it and must receive a different evidence
scope; no ASR provider may silently promote its own output to exact.

## `indicf5-cannot-resolve-an-unpinned-vocoder-at-offline-runtime` (2026-08-28)

**What was tried.** Bake the exact Vocos snapshot into the Hugging Face cache,
leave the upstream IndicF5 model loader unchanged, and start the immutable
image with Hub and Transformers offline modes enabled.

**What specifically broke.** The gated remote model calls the upstream
`load_vocoder` with `is_local=False` and no revision. The exact commit snapshot
did not provide the unpinned default-branch resolution that `hf_hub_download`
requested, so the first isolated GPU revision raised
`LocalEntryNotFoundError`, restarted twice and never became healthy. Retrying
the same image or enabling runtime internet would not satisfy immutable
provenance.

**What replaced it.** The build now writes the exact config and weights to a
dedicated local Vocos directory and commits their file hashes. Before the
gated model module imports the loader, a narrow wrapper forces that path,
rejects other vocoders and removes Hub-cache input. The failed revision was
deactivated to stop GPU churn. A corrected remote image still requires an
offline cold-start and synthesis proof before the candidate can be listened to
or compared.

## `one-hindi-and-hinglish-toggle-hides-script-truth` (2026-08-28)

**What was tried.** The owner preview used one control labelled "Hindi and
Hinglish" beside English, with one Roman-Hindi default for both Indian
registers.

**What specifically broke.** The label hid the choice an owner had to make:
Devanagari Hindi and Roman Hinglish enter the same `hi` runtime contract but
take different auditable text-front-end paths. The screen could not tell a
person which script to type or verify that a language switch changed the
default and input semantics. In a product whose rejected failure is Hindi and
Hinglish pronunciation, that ambiguity made the first test input itself
uncontrolled. The focused suite's negative control restores the two-register
type and must report `three-language-ui`.

**What replaced it.** Three compact choices expose Hindi, Hinglish and English
while preserving the two real API language ids. Each opens with a
script-matched default and a short truthful instruction; no candidate model or
quality winner is named. A future distinct Hinglish runtime may change the
binding only after its backend contract exists and passes the same protected
receipt and listening gates.

## `recursive-chown-duplicates-the-baked-voxcpm2-model-layer` (2026-08-28)

**What was tried.** Bake the exact public VoxCPM2 snapshot as root, then run a
recursive ownership change over `/models` before switching to the non-root
runtime user.

**What specifically broke.** Successful ACR run `cu1q` produced an
11,592,564,532-byte compressed image. The ownership-only layer copied the
multi-gigabyte model contents into a second filesystem layer, widening registry
storage and every cold pull without changing weights or permissions needed by
inference. Shipping that digest would have made the measured cold start worse
for no model benefit.

**What replaced it.** Model and application files remain root-owned and
world-readable while the process still runs as UID and GID 10009. The optimized
image is 7,660,847,810 bytes, 3,931,716,722 bytes smaller, and a focused check
rejects recursive `chown` over `/models`. A future build may use build-time
`COPY --chown` only if a measured runtime write requirement appears.

## `stale-broker-digest-cannot-provision-an-evaluation-gate` (2026-08-28)

**What was tried.** Deploy the isolated VoxCPM2 gate with broker digest
`sha256:3229c647084c066ac8ecf349da7bc688ab4318abcdbb2a29c89fc17279a30210`
from an older handoff.

**What specifically broke.** ARM rejected the gate with
`MANIFEST_UNKNOWN`; that digest did not exist in the named ACR repository. The
private scale-to-zero runtime provisioned successfully, so no GPU replica woke,
but the evaluation front door could not become live. A syntactically immutable
digest is not proof that the registry still contains it.

**What replaced it.** ACR manifest readback and the existing live production
gate independently named
`sha256:3229c6479f83a0864faa0a2f81d43402b115341bbac318209d5b97c8463ceeb1`.
The idempotent redeployment used that digest and succeeded. Future handoffs must
pair an immutable reference with registry existence readback immediately before
ARM create.

## `url-pathname-is-not-a-windows-filesystem-path` (2026-08-28)

**What was tried.** Derive the layout gate's repository root with
`resolve(new URL("..", import.meta.url).pathname)`.

**What specifically broke.** On the real Windows workspace the URL pathname was
`/C:/Users/.../Vyakti-platform/`, and `path.resolve` turned it into
`C:\C:\Users\...\Vyakti-platform`. The real `dist/` and
`dist/studio-layout-fixture.html` both existed, but the gate exited zero with
`dist/ absent`. This silently disabled the signed-in layout check on Windows.

**What replaced it.** Convert the file URL with `fileURLToPath` before joining
`dist`. The always-run negative control simulates the former Windows operation:
it produces `C:\C:\repo`, while the supported conversion produces `C:\repo\`.
On the real workspace the corrected gate advanced past both dist checks to the
browser capability check. Layout rendering itself was not measured in that
focused run because no Playwright Chromium binary was installed.

## `a-local-model-path-is-not-a-hugging-face-repository-id` (2026-08-28)

**What was tried.** Load the gated model from `/models/indicf5` with
Transformers `local_files_only=True` after separately forcing Vocos local.

**What specifically broke.** The model's dynamic module then called
`hf_hub_download(config.name_or_path, filename='checkpoints/vocab.txt')`.
Transformers had set `config.name_or_path` to `/models/indicf5`; Hugging Face
correctly rejected that filesystem path as an invalid repository id. The
isolated revision never became healthy and produced no audio.

**What replaced it.** Before dynamic module import, a fail-closed wrapper maps
only that exact vocabulary request to the baked
`/models/indicf5/checkpoints/vocab.txt`. Different repositories and filenames
are refused. The clean build verifies the file exists, and the no-token repair
verifies the same invariant before producing another immutable image.

## `the-first-container-app-environment-is-not-a-safe-gpu-selector` (2026-08-28)

**What was tried.** Select the first Container Apps environment returned in
the resource group while redeploying the repaired IndicF5 evaluation image.

**What specifically broke.** The first environment was `vyakti-ctrl-env`,
which has no `Consumption-GPU-NC8as-T4` workload profile. ARM preflight rejected
the deployment with `WorkloadProfileNotFound` before changing resources.

**What replaced it.** Read the managed-environment resource id from the live
named IndicF5 app and reuse that exact id. The corrected deployment succeeded
in `vyakti-voice-env`. Resource-list ordering is no longer treated as identity.

## `zonos2-offline-api-does-not-freeze-speaker-and-dac-assets` (2026-08-28)

**What was tried.** Treat the official ZONOS2 Python API's documented offline
path and a locally downloaded main checkpoint as a complete immutable runtime.

**What specifically broke.** Source inspection at the pinned commit found two
independent runtime downloads outside the main 15.351 GB repository. Voice
cloning instantiates `AutoModel.from_pretrained` on the mutable
`marksverdhei/Qwen3-Voice-Embedding-12Hz-1.7B` name with remote code, and first
audio decode calls `dac.utils.download(model_type="44khz")`. An image containing
only ZONOS2 would therefore fail in offline mode at the feature that matters,
or silently change dependencies if runtime internet were enabled. The word
"offline" described the API shape, not a frozen dependency closure.

**What replaced it.** The build downloads the exact public speaker revision
and exact official DAC 0.0.1 asset, checks their byte counts and SHA-256 values,
adds them to the model commitment, replaces both runtime download paths with
local-only assets and leaves Hub/Transformers offline. The focused gate rejects
removal of either binding. A new dependency may enter only with an exact pin,
license record, build-time hash and the same offline cold-start proof.

## `zonos2-runtime-base-without-nvcc-cannot-run-official-kernels` (2026-08-28)

**What was tried.** Use the digest-pinned PyTorch CUDA runtime image as the
smallest base for ZONOS2, because its CUDA runtime and the upstream lock contain
the libraries used by inference.

**What specifically broke.** Pinned source inspection found that this release
does not ship every inference kernel precompiled. Vocabulary indexing and KV
cache storage call `tvm_ffi.cpp.load_inline` on CUDA sources, while even the
single-GPU engine initializes an NCCL extension through `tvm_ffi.cpp.load`.
Upstream explicitly requires a matching CUDA toolkit. The runtime image has no
NVCC, so it could build and pull successfully yet fail only after paid A10
startup. ACR run `cu1w` was cancelled before dependency installation and
produced no candidate image.

**What replaced it.** Keep the smaller digest-pinned runtime base but install
NVIDIA's exact `cuda-nvcc-12-8=12.8.93-1` package, link the NCCL library already
pinned by the upstream Python lock, and fail the remote build unless NVCC 12.8,
`g++` and that linker target exist. The compiler package's measured 36,043,452
compressed bytes is now explicit in the size preflight. ACR run `cu1y` further
proved that the PyTorch runtime base does not configure NVIDIA's apt source;
the corrected build hash-checks the official 4,332 byte CUDA keyring before
installing the exact compiler package. Successful build-time
presence checks are not a runtime-kernel result: exact kernel compilation,
model fit and synthesis remain paid A10 gates.

## `zonos2-managed-identity-acr-pull-needs-role-assignment-authority` (2026-08-28)

**What was tried.** Give the existing eval managed identity `AcrPull` on the
shared registry so the private VM could pull without any registry credential.

**What specifically broke.** Azure rejected the scoped role-assignment write
with `AuthorizationFailed`: the deployment service principal has resource
write authority but not `Microsoft.Authorization/roleAssignments/write`.
Embedding an ACR admin password or asking the owner to change IAM would expand
the experiment's authority and blast radius.

**What replaced it.** Create an ACR token scoped only to content/read on
`vyakti/zonos2-eval`, generate a credential with one-day expiry, store it in
the dedicated eval Key Vault, pull the immutable digest, immediately log
Docker out, and revoke the token after deallocation. Managed identity remains
the only path to the vault and transport HMAC. Revisit identity-native pull if
the deployment principal later receives role-assignment authority.

## `acr-token-create-may-print-an-initial-credential` (2026-08-28)

**What was tried.** Create the repository-read-only ZONOS2 pull token with an
output projection that returns only its name, state and scope-map id.

**What specifically broke.** Azure CLI printed a separate warning containing
the automatically generated initial credential even though the structured
output query omitted it. Treating output projection as secret suppression was
wrong. The emitted credential was immediately replaced, the replacement was
not displayed, and the token was disabled while the image build continued.

**What replaced it.** Token creation and credential generation are separate
operations. Future evals create the disabled token first, then generate or
replace `password1` inside the same no-echo deployment process, pass it only as
a secure ARM parameter, enable the token immediately before pull and disable
or delete it at teardown. CLI warnings are treated as output, not metadata.

## `acr-push-default-timeout-is-too-short-for-zonos2` (2026-08-28)

**What was tried.** Give the ACR build step a two-hour timeout and leave the
separate push step at ACR Tasks' default, assuming the run timeout covered both.

**What specifically broke.** Run `cu20` completed all 16 Dockerfile steps and
tagged the image locally, then ACR terminated the push after its independent
600-second step timeout. Several small layers were committed; the single 15.3
GB checkpoint layer was still uploading, so no manifest or deployable digest
existed. Retrying the push inside that terminated step could not exceed its
wall clock.

**What replaced it.** Set both build and push step timeouts explicitly to 7,200
seconds and set the quick-run timeout to their 14,400-second sum. Image size is
still bounded separately at 30 GiB. A longer network-transfer allowance does
not authorize a larger artifact, a GPU allocation or production routing.

## `recursive-chown-duplicates-zonos2-offline-assets` (2026-08-28)

**What was tried.** Fetch the immutable model, speaker encoder and DAC as root,
install the upstream locked environment as root, then recursively change
ownership of `/models`, `/opt/zonos2-src`, `/srv/zonos2` and `/home/zonos2` in
a final Docker layer before switching to UID 10013.

**What specifically broke.** ACR manifest `cu24` measured the final ownership
layer at 18,805,403,267 compressed bytes. The complete immutable image was
42,449,801,367 bytes, or 39.53 GiB, and crossed the 30 GiB hard stop. OCI copy
on write preserved the earlier model and environment bytes while the recursive
metadata change emitted them again. No VM or GPU was started.

**What replaced it.** Keep the immutable model, source and environment
root-owned and world-readable, run the service as UID 10013, and provide only
the two required writable locations as bounded UID-owned tmpfs mounts. A
focused negative gate now rejects reintroduction of the recursive ownership
copy. The exact layer subtraction projects 22.02 GiB and authorizes one remote
image retry; the rebuilt manifest must still independently measure at or below
30 GiB before any A10 allocation. Run `cu26` measured 22.0206 GiB and passed
that independent image gate; it did not authorize production routing or make a
voice-quality claim.

## `zonos2-a10-is-blocked-by-regional-spot-quota` (2026-08-28)

**What was tried.** Deploy the immutable 22.0206 GiB ZONOS2 image to the
pre-registered private `Standard_NV36ads_A10_v5` Spot lane after all focused and
shared gates were green.

**What specifically broke.** ARM preflight measured Southeast Asia regional
low-priority quota at 3 vCPUs with 0 used; the full A10 needs 36. It rejected
the deployment before creating any resource. One official Quota API request
for 40 low-priority cores was then received as
`Microsoft.Quota/quotas/write` and failed with HTTP 429 `RequestThrottled`,
correlation `ce6a18f6-c22c-4eff-987e-34f9fa2f24d8`, and `retry after 3600
seconds`. No quota request id exists because Azure rejected it before request
creation.

**What replaced it.** Stop the CLI automatic retry loop, keep the repository
read-only token disabled and preserve zero VM/GPU state. Do not submit another
name or request before 2026-08-28 05:30:41 IST. After that time, first prove the
quota request-status collection is still empty, then submit the same canonical
`lowPriorityCores`, `lowPriority`, limit 40 request exactly once. The A10 lane
remains forbidden until quota is approved, not merely requested.

The one authorized post-boundary retry was sent as a single raw REST request at
2026-08-28T05:34:49.5163449 IST so no client retry policy could duplicate it.
Azure returned the same HTTP 429 and 3,600-second retry-after, with no request
id or asynchronous operation URI. The lane stopped again; this evidence does
not authorize another automatic retry.

## `language-match-is-not-a-matched-text-comparison` (2026-08-28)

**What was tried.** Consolidate the existing Chatterbox, Qwen English and
VoxCPM2 clips into Hindi, Hinglish and English pools, then rank providers from
their language-level average ratings.

**What specifically broke.** The 15 source clips share a topic and owner but
not a cross-provider target sentence. Exact hashing found one comparable cell,
and it contains four Chatterbox Hindi variants only. Qwen's six English
sentences are all different from VoxCPM2's English sentence and Chatterbox's
English sentence; the Hindi and Hinglish prompts also differ. A language-level
average would therefore attribute prompt length, wording, code switching and
expressive demand to the model. More listeners would narrow the confidence
interval around the same confound rather than remove it.

**What replaced it.** The builder groups only exact language plus exact target
text hash. The one real matched cell is reported as matched; every other clip
is an independent lane. The unsealed report has no cross-provider winner field
value until a future bake-off synthesizes the same frozen prompts across the
candidate set. Independent owner-likeness, naturalness, accent, pronunciation
and disclosure ratings remain useful, but they are not promoted into an unfair
head-to-head result.

## `utf8-byte-duration-inflates-devanagari-in-indicf5` (2026-08-28)

**What was tried.** Send the frozen Devanagari and mixed-script prompts through
the pinned IndicF5 model with its default speed after a clean offline cold
start.

**What specifically broke.** Upstream calculates requested frames from UTF-8
byte lengths. Against an English reference, Devanagari appears roughly three
times longer than the same number of linguistic units. The six requests plan
23.1 through 31.7 seconds, two clamp at 4096 frames, and a first request can
occupy the T4 beyond the broker's 220-second bound. No exception was logged;
calling this a CUDA or compile crash would have exceeded the evidence.

**What replaced it.** Normalize speed by generated-versus-reference
bytes-per-codepoint density, bind that value and predicted duration into the
receipt, refuse a plan above 30 seconds, and warm with a short unscored canary.
Same-process repeated generation ids reuse their content-bound result. A later
durable ledger is still required for cross-replica exactly-once production.

## `a-cold-broker-cannot-forward-the-original-expiring-signature` (2026-08-28)

**What was tried.** Have the admission broker validate the caller HMAC and
forward the exact timestamp, nonce and signature to a private scale-to-zero GPU
runtime.

**What specifically broke.** The caller timestamp was valid at admission, but
GPU cold start exceeded 60 seconds. When the runtime finally received the
request, its independent skew check correctly returned
`transport_binding_invalid`. Extending the skew window would increase replay
exposure and still misrepresent when the broker forwarded the body.

**What replaced it.** Probe readiness first, return a signed warming response
while the GPU starts, and after readiness sign the admitted body with a fresh
internal timestamp and nonce. Verify the runtime response internally, then
sign the same response body for the original caller nonce.

## `a-symmetric-two-language-grid-would-fabricate-provider-capability` (2026-08-28)

**What was tried.** Design one visually symmetric English and Hindi grid in
which Chatterbox, Qwen3-TTS, VoxCPM2, IndicF5 and ZONOS2 all receive both
frozen sentences.

**What specifically broke.** The pinned Qwen contract rejects every language
other than English with `qwen3_english_only`, while the pinned IndicF5 contract
rejects every language other than Hindi with `indicf5_hindi_only`. Filling the
missing cells with transliteration, a different base model or a semantic
substitute would make the table look complete by changing the model or target
text. It would no longer be the exact-text provider comparison it claimed to
be.

**What replaced it.** Build capability-shaped cells. English contains
Chatterbox, Qwen, VoxCPM2 and optional ZONOS2. Hindi contains Chatterbox,
VoxCPM2 and optional IndicF5 and ZONOS2. The local gate asserts those exclusions
and still requires at least two distinct providers in each cell.

## `strict-perth-length-equality-rejects-unframed-indicf5-output` (2026-08-28)

**What was tried.** Apply PerTh directly to the arbitrary-length IndicF5
waveform and require the returned array to have exactly the same sample count.

**What specifically broke.** The first real owner canary synthesized but
returned signed HTTP 503 `perth_watermark_application_failed`, so no clip was
accepted. Remote, content-free diagnostics against the exact pinned PerTh
library showed that aligned signals retain their length while arbitrary input
is truncated to the preceding 240-sample frame boundary, losing 1 through 239
tail samples. This was a wrapper geometry mismatch, not evidence that IndicF5
failed to synthesize or that PerTh could be skipped.

**What replaced it.** Pad only the incomplete terminal frame with zeros, demand
an exact finite protected padded length, crop to the original sample count and
run PerTh detection on the cropped output. The repaired remote canary and six
owner-bound Hindi/Hinglish clips all passed, with minimum detector score
0.99807614.

## `the-is-not-a-safe-unconditional-roman-hindi-alias` (2026-08-28)

**What was tried.** Treat every Latin `the` in a Hindi/Hinglish request as the
Roman spelling of Hindi `थे`.

**What specifically broke.** `the` is also the highest-frequency English
article. The unconditional table silently mistransliterated normal mixed input
such as `the formula hai`, turning an English token into a different Hindi
word before synthesis.

**What replaced it.** Remove the ambiguous alias. The exact source token now
stays in an explicit English segment while reviewed unambiguous Hindi tokens
continue through the Hindi pronunciation path. A negative control freezes this
boundary.

## `sarvam-402-cannot-produce-an-intelligibility-transcript` (2026-08-28)

**What was tried.** Send each sub-30-second sealed qualification WAV through
the already-integrated Sarvam synchronous Hindi ASR path, with six calls and no
retries under a USD 2 hard stop.

**What specifically broke.** The first request returned HTTP 402 before any
transcript existed. No item could be scored, and treating that as an empty
transcript would have fabricated a 100 percent error result. Actual provider
billing for the rejected request is unknown rather than assumed to be zero.

**What replaced it.** Reserve one conservative 15-second quantum for the
failed request, then use the subscription's existing isolated Azure AI
Services short-audio Speech route for one pass over all six clips. The private
report names the provider switch and keeps the single-provider limitation.

## `windows-default-stdin-decoding-can-fabricate-a-hindi-contract-failure` (2026-08-28)

**What was tried.** Validate the Node-built exact-text payloads by piping JSON
into the checked-in Python provider contracts with the Windows Python default
text mode.

**What specifically broke.** Qwen English and VoxCPM2 English passed, but the
byte-identical VoxCPM2 Hindi payload reported `localized_disclosure_required`.
Codepoint inspection proved the plan and all four Hindi runtime disclosures
were identical. Python had decoded the piped UTF-8 JSON through the Windows
legacy stdin encoding, corrupting Devanagari before contract comparison. That
was a harness failure, not evidence of a runtime disclosure mismatch.

**What replaced it.** Run the validator subprocess with Python UTF-8 mode. The
same frozen payloads then passed all eight actual request-contract paths. Exact
codepoint equality remains asserted so a real normalization or disclosure-byte
drift still fails.

## `an-image-digest-is-not-a-runtime-model-manifest-commitment` (2026-08-28)

**What was tried.** Resolve every expected model commitment from read-only
Azure Container App, revision and ACR metadata without opening an existing
sealed listener key or waking a model.

**What specifically broke.** The control plane exposes immutable container
image digests and application revisions, but Qwen and IndicF5 compute a second
commitment over the exact baked model-file manifest at runtime. Neither value
is present in the Container App tags, revision template or ACR manifest
metadata. Treating the image digest as the model commitment would collapse two
different provenance layers and make the receipt lie.

**What replaced it.** The guarded runner stops those arms until the expected
runtime commitment is supplied independently. For the current exact images,
the immutable ACR layer containing `.vyakti-model-manifest.json` was streamed
read-only and its claim was independently recomputed from its file manifest.
Future qualification must emit a small signed deployment attestation outside
the sealed model-to-stimulus key, binding image digest, model revision and model
commitment without exposing the listening randomization.

## `source-pins-alone-do-not-reproduce-a-build-specific-model-manifest` (2026-08-28)

**What was tried.** Derive Qwen and IndicF5 commitments from the checked-in
repository revisions, source commits and manifest algorithm alone.

**What specifically broke.** The commitment covers the complete concrete file
array written during the remote snapshot build, including exact byte lengths
and SHA-256 values for every materialized path. Pins identify which repositories
were requested but do not contain that built array, and IndicF5 r7 further
replaced its Vocos file list in a repair layer. Hashing only pins or public LFS
metadata would create a different contract and would not prove what the
deployed runtime reads.

**What replaced it.** Extract the already-built manifest from the exact
content-addressed deployed layer and independently verify its internal hash.
The outer image digest, layer digest, model revision and derived manifest
commitment are all preserved as separate evidence.

## `uppercase-element-sequences-are-not-sufficient-chemistry-evidence` (2026-08-28)

**What was tried.** Treat any uppercase token that can be segmented into valid
periodic-table symbols as an unambiguous chemical formula in a Hindi-context
request.

**What specifically broke.** `IP` segmented as iodine plus phosphorus and was
rewritten inside an ordinary sentence containing an IP address. The same shape
would misclassify many acronyms and labels even though every individual symbol
is chemically valid. A domain label alone does not make an acronym a formula.

**What replaced it.** A raw formula requires a coefficient, charge, subscript,
or conventional mixed-case multi-letter element notation. Repeated spoken
formula fragments may establish equation context for a terminal bare symbol;
one phrase cannot. `IP`, `AI`, `IIT`, the English-like symbols `He`, `In`, `As`,
`At`, `I`, `No`, `Am`, and the phrase `vitamin B two` are executable negative
controls. Ambiguous `Fe3+` also remains unchanged unless the charge magnitude
uses a caret or superscript.

## `silent-text-rewrite-cannot-enter-a-matched-voice-cell` (2026-08-28)

**What was tried.** Treat pronunciation normalization as an internal runtime
detail: accept ordinary text, rewrite it before the model, and return only the
audio and original request metadata.

**What specifically broke.** The provider receipt would still claim the
caller-owned exact text while the model had received different bytes. A
matched pack could not reconstruct the intervention, distinguish the current
deployed r7 baseline from a normalized candidate, or attribute a later unit
change to an exact rule. Even a plausible audio improvement would be invalid
evidence because the source, synthesis and comparison cells had collapsed into
one misleading identity.

**What replaced it.** Require the source SHA-256 and versioned pronunciation
request at the contract boundary. Preserve source text, separately hash the
synthesis text, return exact ordered codepoint transformations and a canonical
audit, and make qualification reconstruct the synthesis hash before accepting
the response. Normalized and historical unnormalized IndicF5 are distinct
matched-pack variants; an exact-text cell rejects an unexpected transform.

## `older-chatterbox-result-shape-cannot-enter-the-exact-text-pack` (2026-08-28)

**What was tried.** Start the frozen four-arm exact-text cloud pack against the
currently deployed isolated Chatterbox admission and runtime revisions, keeping
the ten-attempt and USD 5 hard stops.

**What specifically broke.** One cold request timed out. The warm retry returned
a signed, PerTh-verified legacy result that omitted the text-plan contract,
localized disclosure text and disclosure language. The planned English
disclosure was 38 UTF-8 bytes with SHA-256
`be278bc82cf3201a5006d5d2a0ef0db9cef8bdfe5f5faeb2637266b74561cf05`;
because the result carried no disclosure field, there is no returned hash to
compare. The strict verifier correctly stopped on
`matched_pack_result_disclosure_drift`. Treating request-side text as if it were
a post-synthesis runtime receipt would not prove which localized disclosure the
runtime accepted or spoke.

**What replaced it.** Stop before saving audio or running another arm, preserve
the sealed mapping, and remotely rebuild the current checked Chatterbox runtime
with its exact source manifest. Deployment and resynthesis remain separate and
blocked on the full release gate and commit. The verifier and its missing-field
negative control are unchanged.

## `acr-build-file-resolution-does-not-follow-an-absolute-context` (2026-08-28)

**What was tried.** Invoke `az acr build` from the repository root with an
absolute bounded source-directory argument and relative `--file
Dockerfile.patch`, assuming the CLI would resolve the Dockerfile inside the
supplied context.

**What specifically broke.** The CLI looked for `Dockerfile.patch` relative to
the process working directory and returned `Unable to find Dockerfile.patch`
before uploading or scheduling a run. No ACR run id or spend was created, but
retrying blindly from the broad repository would have risked uploading the
wrong source boundary.

**What replaced it.** Freeze a new four-file temporary directory, verify every
file hash against the tested workspace, make that directory the process
working directory and submit `.` as the context. ACR run `cu27` then reported
12.848 KiB uploaded, and post-build registry-layer extraction matched all three
runtime source hashes exactly.

## `windows-acr-log-rendering-is-not-remote-build-state` (2026-08-28)

**What was tried.** Follow ACR run `cu28` through the portable Azure CLI's
ordinary Windows log streamer while pip installed the pinned OpenVoice runtime
dependencies.

**What specifically broke.** The local CLI process decoded the remote stream
but attempted to write Unicode through CP1252 and exited with
`UnicodeEncodeError: 'charmap' codec can't encode characters`. The remote ACR
run continued. Treating the local process exit as a failed build and submitting
a retry would have duplicated spend and obscured the identity of the real
candidate.

**What replaced it.** Make no retry. Poll the ACR run record by exact run id
until it reaches a terminal state, resolve its output digest from both run
metadata and manifest metadata, then verify the immutable registry layers
against the pre-build source manifest. Run `cu28` subsequently succeeded and
all copied source bytes matched.

## `advanced-preview-caller-cannot-omit-required-text-plan-audit` (2026-08-28)

**What was tried.** Make `beginOwnedVoicePreview` require the new text-frontend
audit for every generation while constructing that audit in the advanced owner
preview route and forwarding it to the optional trial resolver.

**What specifically broke.** The route did not forward `text_frontend` into
the subsequent `beginOwnedVoicePreview` call. Therefore every ordinary and
trial advanced preview was refused as `voice_preview_text_frontend_invalid`
before the database or GPU, even though the correct audit already existed a few
lines above. The first mutation test for the repair also removed only the
earlier same-named trial-resolver field, leaving the authorization field in
place, so that negative control correctly failed rather than creating false
confidence.

**What replaced it.** Pass the same content-addressed audit into the atomic
authorization call, assert that exact call shape in the focused OpenVoice
suite, and mutate all matching caller fields for the negative control. The
corrected suite passed 61 of 61. Runtime, broker and web deployment remain
separate later gates; a local caller fix does not authorize a live rollout.

## `one-runtime-image-is-not-a-complete-two-container-release` (2026-08-28)

**What was tried.** Treat the qualified OpenVoice runtime digest as the complete
Azure release candidate for the disclosure-receipt repair.

**What specifically broke.** The public admission boundary is a separate
Container App built from a different Dockerfile and `broker.py`. The runtime
image contains neither broker source nor its cold-start transport behavior, so
its source manifest cannot prove the external request is re-signed with a fresh
internal timestamp and nonce after readiness. Deploying or reporting only the
runtime would leave one half of the two-container contract unqualified.

**What replaced it.** Freeze and build the admission source as its own bounded
ACR candidate, verify its copied registry layers and Dockerfile history, and
stop before deployment. The runtime and broker digests now form two separate
release inputs; the full gate and ordered runtime-then-broker rollout still
decide whether either live revision changes.

## `huggingface-offline-flags-do-not-cover-pkuseg` (2026-08-28)

**What was tried.** Download the pinned Chatterbox model snapshot while the
image is built, set `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` in the
runtime, and treat that as a complete no-network cold-start guarantee.

**What specifically broke.** Chatterbox constructs its Chinese converter even
for a general multilingual model load. `spacy-pkuseg==1.0.1` then constructs
its default `spacy_ontonotes` segmenter. That package uses its own
requests/urllib downloader and defaults `PKUSEG_HOME` to `~/.pkuseg`, which is
`/tmp/.pkuseg` for the deployed non-root runtime. Revision
`vyakti-open-voice--r2405fbe` logged the exact fetch from Explosion's v0.0.26
GitHub release during application startup. The same startup also warned that
Chatterbox's direct Cangjie Hub lookup could not locate the already-downloaded
local file. The service eventually became healthy, so a health-only canary hid
both dependency gaps.

**What replaced it.** Bake Explosion's official archive under the exact path
the package checks, verify its published full SHA-256 plus both extracted-file
hashes, and bind the Cangjie resolver to the pinned local checkpoint file. A
remote build negative control first proves an empty cache invokes the blocked
upstream downloader, then initializes the real baked path with that downloader
still a hard error and records `network_attempts=0`. Runtime startup repeats
the manifest and file verification rather than trusting build success.

## `preview-style-512-byte-ceiling-predates-the-text-plan-receipt` (2026-08-28)

**What was tried.** Keep migration 046's 512-byte `preview_style` constraint
after extending the same generation field with the multilingual text-plan and
language-conditioning receipt.

**What specifically broke.** The full current authorization object is 751
bytes in live PostgreSQL, while the old check permits at most 512. The same
authorization query therefore fails SQLSTATE 23514 on
`vy_replica_generation_preview_style_check` before a preview generation can
open. Removing the receipt would make the database write succeed by dropping
the exact plan, language and conditioning evidence that the release verifier
is designed to bind.

**What replaced it.** Migration 065 atomically replaces the named check with a
2,048-byte object limit and mirrors that final law in `db/schema.sql`. The
focused suite proves the old bound rejects a real builder-produced receipt,
the new bound accepts it, and an oversized object remains rejected. The
migration is deliberately not applied by this code-only workstream.

## `cold-runtime-warming-is-not-a-failed-clone` (2026-08-28)

**What was tried.** Treat the first owner preview response after a quiet period
as the final product result once the database authorization blocker was fixed.

**What specifically broke.** The first production request arrived while Azure
was pulling the 9.84 GB immutable GPU image and correctly returned
`open_voice_runtime_warming`. A health or deployment read alone could not tell
the owner when synthesis was actually available. Reporting this as a bad clone
would confuse infrastructure readiness with generated audio, while repeatedly
clicking would create duplicate failed ledger rows and extra GPU work.

**What replaced it.** Read the exact replica state, wait for application and
readiness success with zero restarts, and let the Studio's bounded automatic
checks progress through dispatched and in-flight states. Call the release
successful only after a later owner request produces a protected browser audio
element and a sealed ledger row. Keep the warming rows as honest failed
attempts rather than mutating history.

## `text-coverage-is-not-acoustic-symbol-correction` (2026-08-28)

**What was tried.** Treat the pronunciation normalizer's deterministic coverage
of all four mixed-equation chemical symbols and all three targeted numeral
units as though every covered unit would be recognized correctly after
synthesis. The conditional preregistration would have moved aggregate chemical
symbol errors from 6/8 to 2/8 if that assumption held.

**What specifically broke.** The sealed matched resynthesis changed exactly the
intended equation clip, but private Azure Speech still found 2/4 chemical symbol
errors in that mixed equation. Aggregate symbol errors moved only from 6/8 to
4/8, not to 2/8. The numeral intervention did reach its conditional target,
moving the changed item from 3/5 errors to 0/5 and aggregate numerals from 4/11
to 1/11. Receipt coverage proved which text units were rewritten; it did not
prove how the acoustic model pronounced each rewrite.

**What replaced it.** Keep text coverage and acoustic outcome as separate
measurements. A rule enters a candidate only with exact source spans and a
reconstructable receipt, then earns an outcome claim only through sealed
resynthesis and unit-aware ASR followed by blinded human pronunciation review.
Retain unmet preregistered effects as negative evidence rather than rewriting
the target after the run.

## `chatter-disclosure-fields-alone-do-not-prove-the-text-plan` (2026-08-28)

**What was tried.** Accept a signed Chatterbox matched-pack result after
checking its localized disclosure text and language, while leaving the returned
text-frontend contract, plan hash and segment fields unchecked.

**What specifically broke.** The deployed runtime now emits all of those
fields, but an otherwise valid result with a changed `text_plan_sha256`, segment
index, count or semantic-index list would still have passed the pack verifier.
The HMAC would prove which runtime signed the response, not that the runtime
accepted the exact pre-registered text plan.

**What replaced it.** Compare every returned frontend, plan, segment and
disclosure field to the exact request before saving audio. A mutation control
changes only the returned plan hash and now fails closed as
`matched_pack_result_text_plan_drift`; the real six-clip cloud pack passed the
strengthened verifier before sealing.

## `self-test-account-attestation-is-not-third-party-speaker-consent` (2026-08-28)

**What was tried.** Treat the live replica's active biometric/training scopes,
`contains_third_parties=false` source flag and auto-accepted evidence as the
authorization needed to turn the processed 109-minute lecture into an
owner-speaker VoxCPM2 LoRA corpus.

**What specifically broke.** The source hash matches the named Alakh Pandey
lecture, not a recording identified as the uploader's own voice. Every consent
and review receipt was generated by `REPLICA_SELF_TEST_MODE`, and the consent
rows have no speaker evidence source. The dominant diarization cluster is
unmapped to a verified person: every segment reports `target_likelihood=0.5`.
The repository's isolated VoxCPM2 contract independently classifies the
provided lecture as `third_party_language_stress` and forces
`training_allowed=false`. The database flag and account bypass cannot override
the identity of the human actually speaking.

**What replaced it.** Stop before creating splits, an image or GPU allocation.
Require the training receipt, verified speaker identity and content-addressed
source to bind the same person, then exclude reference/eval windows before any
adapter manifest is frozen. For the requested owner adapter, the immediate
replacement corpus is 5-10 clean minutes spoken by the owner with an exact
transcript and server-verified hash.

## `sealed-pack-aggregate-is-not-a-winner-or-a-language-diagnosis` (2026-08-28)

**What was tried.** Treat one aggregate objective score over the sealed
six-clip exact-text pack as enough to name a winning stack or characterize the
Hindi problem before listening.

**What specifically broke.** The mapping is deliberately sealed, so an
aggregate cannot be attributed to a model without contaminating the blind
test. More importantly, the measured errors were not homogeneous. Opaque
ECAPA similarity ranged from 0.585457 to 0.726461 around a 0.665601 mean, while
one-provider raw WER was 2.90% for the three en-IN clips and 26.19% for the
three hi-IN clips. Two of eight rating IDs were exact-audio repeats. One mean
would therefore hide both the language gap and the weakest clip, and counting
all rating IDs would silently double-weight two results.

**What replaced it.** Keep the arm map sealed, deduplicate exact audio for
aggregates, and report every rating ID through an opaque canonical ID with
language-specific raw and script-aware ASR. Use the result only as a negative
regression/localization signal. Arm ranking, foreign-accent diagnosis,
naturalness and owner likeness remain unanswered until accepted blinded human
ratings are locked and the pack is explicitly unsealed.

## `base64-audio-is-not-searchable-model-metadata` (2026-08-28)

**What was tried.** Scan the complete one-file Studio bundle, including about
8.4 MB of Base64 WAV data, for short provider-name substrings before allowing
the export.

**What specifically broke.** Opaque binary encoded as Base64 naturally
contains coincidental short letter sequences. The real r2 bundle therefore
matched a forbidden provider substring even though its manifest and trial
metadata passed the existing sealed-tree audit and carried no mapping. The
first actual export failed as `matched_pack_studio_mapping_leak` for a pattern
that occurred only inside encoded audio bytes.

**What replaced it.** Scan only structured listener-facing metadata for model,
provider, receipt, answer-key and source identifiers. Validate audio
independently by its opaque 24-character id, exact stimulus set, SHA-256,
bounded byte count, RIFF shape and common 24 kHz mono PCM16 geometry. The real
r2 export then succeeded without weakening either the metadata leak check or
audio integrity.

## `compute-sku-visibility-is-not-large-gpu-provisionability` (2026-08-28)

**What was tried.** Treat an Azure Compute GPU SKU with no restriction in the
subscription-scoped SKU listing as available capacity for ZONOS2 or MOSS, and
continue the earlier Southeast Asia A10 quota plan because A10 was already
familiar.

**What specifically broke.** The listing was a false positive for usable
capacity. Twenty-six exact A100 deployment validations and four exact H100
validations all stopped at quota, despite the SKU rows being unrestricted.
Every usable A100 region needed 24 low-priority cores from a subscription limit
of 3 or 24 family cores from a limit of 0. H100 needed 40. West Europe failed a
separate new-customer location gate. Full A10 was explicitly unavailable to
the subscription wherever found, and its earlier 36-core request is larger
than the A100 requirement. A quota request cannot be called successful when
the service throttles it and exposes no request id.

**What replaced it.** Use exact ARM deployment validation as the Compute
capacity predicate, not SKU visibility. Rank the subscription-supported
Container Apps Consumption A100 profile first because it can scale to zero and
fits a bounded experiment on official list prices, while preserving the
important limitation that only a separately authorized one-replica scheduling
attempt can prove serverless quota and regional capacity. Keep Compute A100
Spot as a backup after a verifiable quota grant; do not escalate to H100 without
measured A100 failure.

## `sarvam-bulbul-existing-key-returned-payment-required` (2026-08-28)

**What was tried.** Use the existing Sarvam secret from the deployed processing
job for the two preregistered Bulbul v3 Hindi/Hinglish base arms, through one
isolated overridden job execution with the current documented singular-text
contract.

**What specifically broke.** The first provider request returned HTTP 402
before audio. The service therefore supplied no audio, model receipt or timing
evidence that could enter the pack. Retrying with the same account state would
spend attempts without changing the access predicate, and substituting another
provider would violate the frozen plan.

**What replaced it.** Reject both Sarvam items explicitly with no-audio and
no-retry receipts and provider spend claim USD 0. A future arm requires restored
Sarvam billing/access and a new preregistered plan; managed alias metadata must
remain labeled as a request-contract commitment rather than an immutable weight
pin.

## `perth-watermark-needs-explicit-frame-padding` (2026-08-28)

**What was tried.** Send arbitrary OpenVoice V2 converted sample lengths
directly into PerTh and treat successful tone conversion as sufficient before
the protected response is constructed.

**What specifically broke.** The first live conversion returned signed HTTP
503 `perth_watermark_application_failed` before audio could leave. PerTh's
implicit watermarker operates on 240-sample frames, while OpenVoice output is
not guaranteed to end on that boundary. The candidate therefore failed even
though the converter and exact checkpoint were healthy.

**What replaced it.** Pad only for PerTh framing, apply the watermark, trim back
to the exact original sample count, then run the detector and hash the preserved-
length PCM. The focused gate covers non-aligned lengths. Remote ACR
build `cu2c` carried that fix and reached readiness, but the arm remains
unqualified because the subsequent signed response failed its receipt gate.

## `python-javascript-float-canonicalization-can-break-receipt-hashes` (2026-08-28)

**What was tried.** Recompute the Python service's receipt self-hash in the
JavaScript pack verifier after parsing the signed JSON, using each language's
ordinary sorted compact JSON representation.

**What specifically broke.** The corrected runtime produced a signed HTTP 200,
but the aggregate immutable-receipt check rejected it and discarded the audio.
The old fail-closed verifier intentionally persisted no drifted response and
reported no failed-field list, so the exact live mismatch cannot be recovered.
Offline isolation found a deterministic interoperability defect: Python emits
an integral float as `1.0`, JavaScript parses it as the number `1` and emits
`1`, and the two canonical byte strings hash differently. PerTh receipts can
legitimately carry score 1.0. This mechanism is proven by a fixture; attributing
the discarded live response to that exact field would still be an inference,
not a measurement.

**What replaced it.** Normalize finite integral floats before Python receipt
canonicalization, add a score-1 round-trip regression, and make future verifier
failures persist only failed field names and response/request hashes while
discarding audio and the response body. The focused offline suite passes 20 of
20. Do not rebuild or retry this frozen run; a new canary must qualify the local
fix before any matched conversion or production route.

## `zonos2-cross-region-image-pull-misses-bounded-readiness` (2026-08-28)

**What was tried.** Run the already-qualified 22.0206 GiB ZONOS2 image at exact
digest `sha256:7d1f97efffe35e23a356a12494e0333cdfb586c5a1dfcd8f06165a27abdb301b`
on a dedicated West US 3 Container Apps `Consumption-GPU-NC24-A100` profile,
behind the existing signed CPU admission broker. The runtime was private,
min zero and max one; the gate admitted only the frozen owner reference,
consent, text and request signatures.

**What specifically broke.** Azure scheduled the A100 and reported a compatible
GPU driver, but the cross-region ACR pull remained at `PullingImage` for the
entire 30-attempt readiness bound. At final capture the container had never
started, readiness was false and restart count was zero. Every canary response
was the correctly signed `open_voice_runtime_warming`; no model, CUDA-kernel,
OOM, synthesis, audio or quality result existed.

**What replaced it.** Stop at the registered boundary, delete the exact apps
and dedicated environment, disable the scoped pull token and restore its scope
to the ZONOS2 repository alone. A future experiment must solve artifact
proximity or measured image closure before paid readiness begins. A longer
post-result wait is not evidence and is not an acceptable replacement.

## `public-seal-hashes-do-not-authenticate-studio-reports` (2026-08-28)

**What was tried.** Treat an unsealed report as trusted when its run id and
sealed-key SHA-256 matched the values already present in the public Studio
bundle, then label the result as seal matched.

**What specifically broke.** Those values bind a report to a pack but do not
identify who produced the report. Any local JSON author could copy both public
values, set an accepted-listener count and provide arbitrary model labels. The
browser had no secret or asymmetric verification step that distinguished a
private-gate result from that fabrication.

**What replaced it.** The exporter now keeps a reusable RSA-2048 private key
only under the pack's private directory and publishes only its SPKI key and
hash in the Studio bundle. Unseal signs the canonical result, and the browser
fails closed on a missing signature, changed body or wrong key before showing
identities. The UI says signature verified only after that check succeeds.

## `openvoice-tone-conversion-regressed-owner-proxy-and-asr` (2026-08-28)

**What was tried.** Convert two exact protected IndicF5 Hindi/Hinglish owner-
conditioned bases through the receipt-canonicalized OpenVoice V2 tone-color
runtime, with the same 12-second owner reference, text, consent, seed and tau
0.3. Both conversions had fully valid signed receipts and verified PerTh.

**What specifically broke.** The conversion passed transport but regressed
both registered objective guardrails. Across n=2 matched prompts, ECAPA mean
fell from 0.726677 to 0.680976. Script-aware WER worsened from 17/56,
0.303571, to 21/56, 0.375, and CER worsened from 62/242, 0.256198, to 72/242,
0.297521. A tone-color stage that loses both identity-proxy similarity and
intelligibility cannot be promoted as the path to exact Hindi/Hinglish cloning.

**What replaced it.** Keep the arm isolated and retain its opaque sealed pack
only for later blinded diagnosis. Move research toward methods that jointly
model speaker, prosody and multilingual pronunciation, and require a larger
held-out objective non-regression before spending human-listener attention.
Receipts, PerTh and low latency remain required controls but are not voice
quality evidence.

## `maximum-source-rms-is-not-a-peak-safe-listening-level` (2026-08-28)

**What was tried.** Normalize every sealed listening stimulus to the loudest
source RMS, capped at 0.18, and rely on the normalizer's 0.92 peak assertion to
catch unsafe gain.

**What specifically broke.** One lower-RMS, higher-crest-factor artifact would
have exceeded the 0.92 peak ceiling at that common RMS. The assertion stopped
the first seal attempt before any stimulus, mapping ciphertext or manifest was
written. Choosing a common target from RMS alone is not safe when crest factors
differ.

**What replaced it.** Compute each clip's peak-safe RMS ceiling, choose the
minimum ceiling across the reference and candidates, then normalize and pad.
The replacement sealed four opaque clips at common RMS 0.0973137 and a 0.92
peak ceiling, recorded its implementation hash, destroyed the mapping key and
passed the frozen pack verifier. This correction changes listening geometry
only; objective ECAPA and ASR remained bound to the untouched source WAVs.

## `windows-az-cmd-is-not-a-direct-node-executable` (2026-08-28)

**What was tried.** Launch Azure CLI from the checked-in remote-build wrapper
with `spawnSync("az", args, { shell: false })`, the same direct-executable
pattern used for ordinary binaries.

**What specifically broke.** On Windows the installed CLI entry is commonly a
`.cmd` shim. Node does not resolve and execute that shim as a direct executable
under `shell: false`; the executable fake-shim negative reproduced the failure.
The earlier static gate only searched for the source pattern and therefore
approved code it had never launched.

**What replaced it.** Resolve an explicit `--az`, environment override or PATH
shim first. Execute `.exe` directly; execute only `.cmd` through explicit
`ComSpec` with delayed expansion disabled, separately quoted safe arguments,
and `shell: false`. The gate now runs a fake shim from a path containing spaces,
verifies a spaced argument exactly, retains the failing old control, rejects a
metacharacter argument, and proves non-Windows stays direct.

## `zonos2-regional-a100-without-visible-cuda-device` (2026-08-28)

**What was tried.** Import the exact 22.0206 GiB ZONOS2 image server-side into
the cheapest fitting West US 3 ACR tier, verify its immutable manifest and layer
identity, then run it privately on a fresh West US 3 Container Apps
`Consumption-GPU-NC24-A100` profile behind the existing signed owner-bound
gate. The runtime and gate were min zero, max one and excluded from production.

**What specifically broke.** Regional proximity worked: the exact image pulled
in 194.29 seconds and the process started. Application initialization then found
`torch.cuda.is_available()` false, raised `zonos2_cuda_required` at
`/srv/zonos2/app.py:248` and exited code 3 on every restart. The image's frozen
upstream lock contains GPU PyTorch and CUDA 12.8 packages, and Azure advertised
a driver compatible through CUDA 13.0, so neither a CPU-only package lock nor
an obvious driver-version mismatch explains the observation. Device files,
environment injection and driver-library discovery were not logged, so naming
one of them as the root cause would exceed the evidence.

**What replaced it.** Stop before synthesis, delete the exact apps, temporary
registry, token and scope, and let the empty dedicated environment finish its
control-plane deletion. Before another model run, use a tiny regional
diagnostic-only canary plus an official GPU validator to distinguish missing
device injection from library discovery and PyTorch runtime failure. Record the
device files, NVIDIA environment, driver library, `nvidia-smi` and PyTorch CUDA
build/runtime state. The existing immutable ZONOS2 digest should be retried only
after that smaller canary succeeds.
