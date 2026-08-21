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
| **RELATIONAL OS** | `src/engine/chess/*` (rules, her move, assessment), the game tail block, the register for playing | a second personality on a second surface would need all of this unchanged |
| **SURFACE** | the board component, the games section, the route | how it is drawn and touched |
| **CALL LANE** | unchanged | see §4 |

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

An in-progress game survives a reload. It lives in `AppState` beside the rest,
as a compact record — move list plus a little metadata, not a position history:
a move list IS the history and re-deriving the position from it is free.

## 6. What is deliberately NOT in v1

- No clock. A timed game against a companion is a different product.
- No rating, no ladder, no streak. Those are engagement mechanics, and this
  repo has already deleted one of those on purpose (`persona.ts`'s note on the
  idle nudge). A game you play because it is fun is the whole feature.
- No opening book by name. She is not a coach.
- Only chess. The section is built so a second game can land beside it, but
  building two at once means shipping neither well.
