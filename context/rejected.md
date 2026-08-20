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
