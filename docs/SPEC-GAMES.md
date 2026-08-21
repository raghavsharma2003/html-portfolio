# Games — playing chess with her, on a call

The owner's ask: a games section beside the chat, starting with chess. A real
board, both sides moving, live voice both ways while playing, she reacts to
moves and to the position — and she is **the same Meera**, carrying every bit of
chat memory, personality and relational state she has anywhere else.

That last clause is the whole specification. A chess app with a voice bolted on
is easy and worthless. This is Meera, who happens to be playing chess.

---

## 0. The two decisions everything else follows from

### 0.1 Her MOVE is code. Her TALK is the model.

The move she plays is chosen by a deterministic search in
`src/engine/chess/`. It is never an LLM call. Three reasons, in order of how
much they cost to learn the hard way:

1. **LLMs play illegal chess.** An illegal move from her does not degrade the
   feature, it ends it — the board is the one thing in this product that has a
   ground truth the user can check instantly.
2. **Every move would be a model call.** `both-lanes-dry` and
   `one-key-two-jobs` both bit this week. A 40-move game is 40 calls on a lane
   that has already taken production down twice.
3. **It is testable.** A search is provably legal against perft counts. A model
   is not provable against anything.

So the split is: **the engine decides WHAT she plays; the model decides what she
SAYS about it.** Everything below is downstream of that line.

### 0.2 She does not need the position. She needs what happened.

The obvious design hands her a FEN and lets her reason about the board. It is
wrong here, for a reason specific to this product: **on the voice lane she emits
the characters she speaks.** `ack-bracket-direction` measured `[laughs softly]`
coming back as laughter *plus the spoken word "Softly"*, and a `[bye]` marker
was rejected by the persona invariants for exactly this. A FEN read aloud is
gibberish in her mouth, and there is no sanitiser that can stand in the realtime
lane.

She does not need it anyway. **She is not choosing the move** — 0.1 already
took that job. What she needs is what a person across a board has: what just
happened, whether it was good, and who is winning.

So the game block carries SEMANTIC FACTS, computed by the rules layer:

- whose turn it is, and how long he has been thinking
- the last move in plain algebraic (`Nf3`, `exd5`) — speakable, and what a
  person actually says
- what that move DID: a capture, a check, a fork, a piece left hanging, a
  blunder, a good find
- material balance as a coarse band, never a decimal evaluation
- phase: opening / middlegame / endgame
- whether either king is in check, and whether the game just ended

No FEN in the prompt. No coordinate soup. No engine evaluation in centipawns —
a number she could read out is a number that makes her sound like a computer,
which is the one thing this product cannot afford.

### 0.3 The live prompt is FROZEN AT CONNECT — so moves are not prompt at all

The first draft of this spec had the board riding a tail slot. **That is
impossible on the lane this feature lives on**, and the correction is worth
stating loudly because it inverts the obvious design.

`useCallEngine.ts:575` says it plainly: *"the live prompt is frozen at connect,
so the watch note cannot ride this compile."* The realtime session is set up
once, and `liveAssemblies` (`:267`, asserted at `:609-620`) exists to enforce
that — a mid-call reassembly is *"a different person mid-sentence, and the
failure is inaudible until she contradicts herself."* Recompiling per move
would also destroy the prefix cache, which `cache-9x` measured at ~9× the
sticker price on this workload.

So there are **two channels, and they carry different things**:

| when | channel | carries |
|---|---|---|
| at connect | a tail slot | that a game is on, whose turn, the position so far |
| per move | `liveSession.direct("<context: …>")` | what just happened, once |

The per-move channel is exactly what screen-share already uses to poke her
(`useCallEngine.ts:1593`). It is a `role:"user"` turn, never her output space,
and it already solves the mid-word problem — `direct()` waits up to
`min(1200, speakingUntil − now)` ms so a move landing mid-sentence does not
guillotine her (`liveCall.ts:3098-3100`).

**Angle brackets, never square ones.** `<context: …>` is the established
out-of-band shape on this lane; a `[move: e4]` protocol would fail the live
persona invariant that permits exactly three bracket lemmas (`softly`, `tone`,
`forget`) — and would fail audibly, since bracket text on this lane gets spoken.

### 0.4 The honesty gate can flag her own chess talk

A subtle one, caught in the seam review rather than in production, which is the
cheap place to catch it.

`honesty-provenance-allowlist` says: *an identifier she emits that is not
present in her input is invented.* A move like `Nf3` is identifier-shaped. So if
she says a move that was never in the injected note or in his speech, the
predicate is right to call it a fabrication — and if the note is too thin, it
will flag moves that really were played.

The rule that follows: **the move note must name every move she is allowed to
say.** The move just played, and — when it is her turn and she is thinking out
loud about options — the candidate moves the engine actually considered. She may
name what she was given. She may not name a square nobody sent her.

---

## 1. What she must NOT become

The failure mode is not "she plays badly". It is **she stops being Meera and
becomes a chess commentator.** Named here because it is the thing every
implementation detail below is defending against:

- She does not narrate every move. A friend across a board is quiet for whole
  minutes. `WATCH_MODE_NOTE` already learned this on the screen-share lane —
  "say something whenever something genuinely strikes you; when nothing does,
  you're quiet, and that's completely normal" — and the same contract applies.
- She does not evaluate the position out loud like an engine.
- She does not teach unless asked. Unsolicited coaching is the single fastest
  way to make a game with a friend feel like a lesson.
- She still has her own day, her own mood, and the whole relationship. The
  conversation is allowed to wander off chess entirely and come back. A game is
  something two people do WHILE talking, not the only thing they talk about.

## 2. What she must NOT be allowed to do

- **Never claim to see the board.** She has the facts the engine gives her.
  Same family as the screen-share rule against naming what is not on screen.
- **Never invent a move that was not played.** The move list is ground truth and
  the honesty gate's provenance principle applies: a move she says was played
  that is not in the record is a fabrication.
- **Never take a move back for him silently.** Undo, if it exists, is his.

---

## 3. Layering — which layer owns what

| layer | owns | why |
|---|---|---|
| **RELATIONAL OS** | `src/engine/activity.ts` (the kind-agnostic seam), `src/engine/chessTalk.ts` (the only place chess becomes words), `src/engine/chess/*` (rules, her move, assessment), T15 `session.activity` | a second personality on a second surface would need all of this unchanged |
| **SESSION STATE** | `AppState.game`, `src/state/game.ts`'s `activityOf` | the one derivation both lanes read; see §5 |
| **SURFACE** | `GamesHub`, `ActivityShell`, `ChessBoard`, `ChessActivity`, the route | how it is drawn and touched |
| **CALL LANE** | unchanged except one debounced `direct()` poke | see §4 |

**As built, this went one level more generic than this spec originally
described.** The tail block is not "the game tail block" — it is
`ActivityState`, which answers three questions (what are we doing and since
when, where does it stand, what may she name out loud) and knows nothing about
chess. Chess reaches it through an adapter. That was not gold-plating: it is
the shape `age-tier-never-realtime` argues for, where a second implementation
silently lost a rule added after the fork. Screen-share was already a one-off;
chess would have been the second.

The surface contract for other platforms is written up in
`docs/SURFACES.md` §2b.

Per `docs/CONVERSATION-DEFECTS.md`'s test: would a *different personality* on a
*different surface* need this? For the rules and the assessment, yes. For the
board, no.

## 4. `liveCall.ts` is not touched

The audio floor is the most delicate thing in this repo and it is measurable
only because `liveCall.ts` imports nothing beyond `./level` and
`../engine/diag`, which lets `evals/echosim` transpile it standalone. A game
mode must reach the call lane through `useCallEngine` and the compiler, exactly
as watch mode does — never by adding an import there.

If the floor has to be re-measured for any change in this feature, the change
is in the wrong file.

---

## 5. Persistence

An in-progress game survives a reload, a navigation, a call starting, and the
tab closing. It lives in `AppState` beside `messages` and `inner`, persisted and
synced by the writers that already exist.

**Correction to this section as originally written.** It said the record is a
move list "not a position history", on the reasoning that a move list IS the
history and re-deriving positions from it is free. The first half is right and
the conclusion was wrong: `Game` carries `positions` as well, and it has to.
Threefold repetition is counted from it, and it is held in the VALUE rather
than in a module-level Map precisely so that two games in two tabs cannot share
a repetition counter. Re-deriving it per check would be free-ish; sharing it
across games would be a correctness bug.

Two other pieces of state that were not in the original spec and turned out to
be necessary:

- `herSide` — which colour she has is a real choice, not derivable from the
  board.
- `closedAt` — set once she has reacted to the ending. Without it `activityOf`
  keeps returning a live activity and the tail announces "the game has
  finished" on every turn for the rest of the relationship, which is a fact
  that was true once being re-asserted as news. The move list is NOT deleted:
  "you beat me yesterday" is memory.

A board opened and left without a move is discarded on exit. It is not a game,
and leaving it would have her carrying a fact about the present moment that is
not true.

## 6. What is deliberately NOT in v1

- No clock. A timed game against a companion is a different product.
- No rating, no ladder, no streak. Those are engagement mechanics, and this
  repo has already deleted one of those on purpose (`persona.ts`'s note on the
  idle nudge). A game you play because it is fun is the whole feature.
- No opening book by name. She is not a coach.
- Only chess. The section is built so a second game can land beside it, but
  building two at once means shipping neither well.
