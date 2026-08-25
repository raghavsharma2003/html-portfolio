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
