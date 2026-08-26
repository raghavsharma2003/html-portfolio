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
