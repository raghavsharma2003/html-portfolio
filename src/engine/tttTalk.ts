// The ttt → activity adapter. The ONLY place tic-tac-toe becomes words —
// same split, same reason, as `chessTalk.ts`: `src/engine/ttt/` emits enums
// and cell indices and no English at all, so the search can change without
// touching a word she might say, and the wording can be tuned without
// risking a legal move.
//
// WHAT THIS FILE MAY NOT DO, same law as chessTalk.ts: write a line she could
// SAY. `recited-prompt` measured her own example quotes recited on 4 of 5
// turns. Everything below is a fact in the third person about the board —
// telegraphic, ≤14 words, never sentence-shaped, never first-person, no
// dialogue. "arre yeh toh block ho gaya" belongs to her; "he blocked her
// line" belongs here.
//
// ── what chess has, and what this file owes it ─────────────────────────────
//
// The seams are generic and ttt rode all of them from its first day, which is
// exactly why it was possible for the game to be a second-class citizen
// without anyone deciding it should be. `dead-writers`: a system that supports
// a game but never reaches it is a system that game does not have. Chess got
// a correction ladder over two waves — threat facts, a durable record, an
// early-end distinction, an urgent poke, a result on screen — and every rung
// of it is answered here, in ttt's own vocabulary rather than in chess's with
// a key substituted in.
//
// The gate is `evals/ttt/parity.mjs`, and it asks the parity question against
// COMPILED PROMPTS rather than against this file.

import type { ActivityState } from "./activity";
import { winningCells } from "./ttt";
import type { Game, Mark, PlayedMove } from "./ttt";

// The union LANDED: `src/engine/activity.ts`'s `ActivityKind` carries `"ttt"`
// and `LABEL` names it "a game of tic tac toe". This alias is now just the
// narrowed return type — same fields, same order — and is kept only because
// callers import it by name. It is `ActivityState` with `kind` pinned, not a
// stand-in for anything, and the note it replaced (which still asked a
// coordinator to land a diff that shipped months ago) was `gates-that-live-
// nowhere` in miniature: an instruction pointing at work already done.
export type TttActivityState = Omit<ActivityState, "kind"> & { kind: "ttt" };

/** Cell names she is allowed to say. Index-matched to `src/engine/ttt`'s
 *  row-major layout. Two words each, on purpose — "the corner" is ambiguous
 *  with four of them on the board, and this is the one place that ambiguity
 *  would show up as her naming the wrong square. */
const CELL_NAME: readonly string[] = [
  "top left", "top middle", "top right",
  "middle left", "centre", "middle right",
  "bottom left", "bottom middle", "bottom right",
];

/** `ActivityState.facts` rows are ≤14 words — chessTalk.ts's own contract, and
 *  the same reason: a row over the limit fails SILENTLY at the far end of the
 *  pipe (`silent-truncation`) rather than here. */
const MAX_FACT_WORDS = 14;

const other = (m: Mark): Mark => (m === "x" ? "o" : "x");

/** "top left, centre and bottom right" — an Oxford-free list a person says. */
function nameList(cells: readonly number[]): string {
  const names = cells.map((c) => CELL_NAME[c]).filter(Boolean);
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The line a game was won on, as a thing a person says.
 *
 * Chess's record can say "won by checkmate on move 24" and that is the whole
 * memory; tic-tac-toe's equivalent memory is the SHAPE — "you got me on the
 * diagonal" is what anyone actually carries out of a game of noughts and
 * crosses, and it was the one durable fact this adapter had no word for.
 */
function lineName(line: readonly number[] | null | undefined): string {
  if (!line || line.length !== 3) return "";
  const [a, b, c] = [...line].sort((x, y) => x - y);
  if (a === 0 && b === 4 && c === 8) return "the diagonal";
  if (a === 2 && b === 4 && c === 6) return "the other diagonal";
  if (b - a === 1 && c - b === 1) return a === 0 ? "the top row" : a === 3 ? "the middle row" : "the bottom row";
  if (b - a === 3 && c - b === 3) return a === 0 ? "the left column" : a === 1 ? "the middle column" : "the right column";
  return "";
}

/**
 * Cells from which `mark` would create TWO winning squares at once — the
 * double threat, which is the only tactic tic-tac-toe HAS and the only reason
 * a game between two people who can both count is ever decided.
 *
 * A cell that already wins outright is not a fork and is excluded: it is the
 * louder fact and `tttThreats` says it first. Bounded by construction — with
 * fewer than two marks of your own on the board there is nothing to fork with,
 * so the opening produces none of these, which is the negative control.
 */
function forkCells(board: readonly (Mark | null)[], mark: Mark): number[] {
  const wins = winningCells(board, mark);
  const out: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] !== null || wins.includes(i)) continue;
    const probe = board.slice();
    probe[i] = mark;
    if (winningCells(probe, mark).length >= 2) out.push(i);
  }
  return out;
}

/**
 * Every threat this board supports, most urgent first — ttt's `threatFacts`.
 *
 * THIS IS THE ROW THAT WAS MISSING, and its absence is most of the owner's
 * *"she dont know whats up"*. Chess hands her mate distances, hanging pieces
 * and a king under pressure; tic-tac-toe handed her a move count and whose
 * turn it was. A nine-square board has exactly two things worth knowing — who
 * is one square from winning, and who can make two threats at once — and she
 * was told neither, so there was nothing for her to be interesting ABOUT.
 *
 * Bounded exactly the way chessTalk.ts's are, and for the same stated reason:
 * a fact that fires on every move is a fact that means nothing. An opening
 * (fewer than two marks a side) returns `[]`, and the eval asserts it.
 */
export function tttThreats(game: Game, herMark: Mark): string[] {
  if (game.status.over) return [];
  const board = game.board;
  const his = other(herMark);
  const herWin = winningCells(board, herMark);
  const hisWin = winningCells(board, his);
  const toMove = game.status.turn;

  // `now` is the difference between "she wins with the next mark she places"
  // and "she wins UNLESS he takes that square" — the same square, two
  // completely different sentences, and getting it backwards is the ttt
  // version of reporting a mate against the wrong king.
  const row = (who: "she" | "he", cells: readonly number[], now: boolean): string => {
    const foe = who === "she" ? "he" : "she";
    if (cells.length > 1) return `${who} has two ways to win, ${foe} cannot block both`;
    return now
      ? `${who} can win right now, on ${CELL_NAME[cells[0]]}`
      : `${who} is one square from winning, on ${CELL_NAME[cells[0]]}`;
  };

  const urgent: string[] = [];
  const mine = toMove === herMark ? herWin : hisWin;
  const theirs = toMove === herMark ? hisWin : herWin;
  const mover: "she" | "he" = toMove === herMark ? "she" : "he";
  const waiter: "she" | "he" = mover === "she" ? "he" : "she";
  if (mine.length) urgent.push(row(mover, mine, true));
  if (theirs.length) urgent.push(row(waiter, theirs, false));

  // Forks are news only while nobody is already one square away: with a win on
  // the board the fork is a plan for a game that is about to be over, and
  // saying both is the commentator failure chessTalk.ts opens by refusing.
  const ambient: string[] = [];
  if (!herWin.length && !hisWin.length) {
    const f = forkCells(board, toMove === herMark ? herMark : his);
    if (f.length) ambient.push(`${mover} can set up a double threat on ${CELL_NAME[f[0]]}`);
  }
  return [...urgent, ...ambient].filter((r) => r.split(/\s+/).length <= MAX_FACT_WORDS);
}

/**
 * Is this board worth interrupting a conversation for — ttt's answer to
 * chess's `status.over || status.inCheck`.
 *
 * The poke's `urgent` flag crosses the rate floor and the breath pause, and it
 * was `cur.kind === "chess" && …`, so on a call a tic-tac-toe game could be
 * WON, LOST or DRAWN and she would say nothing at all: the ending fell to the
 * ordinary rate floor and was adopted silently. A result is always worth a
 * word, and so is the one move before a result — which is what "the side to
 * move can end it right now" says, and is the tightest ttt reading of `check`.
 *
 * Deliberately NOT "somebody somewhere has a threat": that is true for most of
 * a nine-square game, and an urgency that fires every move is no urgency.
 */
export function tttUrgent(game: Game, herMark: Mark): boolean {
  if (game.status.over) return true;
  void herMark;
  return winningCells(game.board, game.status.turn).length > 0;
}

/**
 * Does this exchange EARN a comment — ttt's `noteworthy`.
 *
 * Chess drops a quiet developing move without a word; ttt narrated every
 * single exchange, which on a nine-move game is her remarking on the whole
 * board out loud, one mark at a time. A tic-tac-toe move is worth saying
 * something about when it ended the game, blocked a line, made a line, or left
 * somebody one square away. An opening mark on an empty board is not.
 */
export function tttNoteworthy(game: Game, herMark: Mark): boolean {
  if (game.status.over) return true;
  if (tttThreats(game, herMark).length) return true;
  const last = game.played[game.played.length - 1];
  if (!last) return false;
  const before = game.board.slice();
  before[last.cell] = null;
  // it blocked something that was about to win
  return winningCells(before, other(last.by)).includes(last.cell);
}

/**
 * WHERE THE MARKS ARE — the row that has no chess equivalent and needs none.
 *
 * `activity.ts` refuses to put a FEN in the prompt, for a good reason: a
 * chess position is 64 squares and unspeakable, and the board is on screen
 * anyway. A tic-tac-toe position is at most nine marks and every one of them
 * has a NAME a person says out loud. So the thing that is wrong for chess is
 * exactly right here, and its absence is why she could not answer "where
 * should I go" about a game she was visibly playing.
 *
 * Two shapes, whichever is shorter, because the block's whole budget is ~113
 * bytes on a live game:
 *   - a full-ish board is described by what is LEFT ("only the corners are
 *     open"), which is also how a person thinks about one;
 *   - an early board is described by what each of them holds.
 *
 * Her MARK is deliberately not here. It rides the whose-move row instead —
 * the one row `renderActivity`'s drop policy can never take — because this row
 * is exactly the one that loses to the budget on a running game, and "she does
 * not know which mark she is" is a worse thing to lose than "she does not know
 * which corner he took".
 */
export function tttBoardFact(game: Game, herMark: Mark): string {
  const board = game.board;
  const free: number[] = [];
  const hers: number[] = [];
  const his: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] === null) free.push(i);
    else if (board[i] === herMark) hers.push(i);
    else his.push(i);
  }
  if (!free.length) return "";
  // COMMAS, NOT "and", inside this row. It is a telegraphic list rather than
  // prose, and the two words an Oxford join costs are two of the fourteen the
  // row is allowed — enough, at four marks a side, to push the whole row past
  // the limit and into the countless fallback below. `nameList`'s "and" is
  // kept for the RECORD rows, which are a memory being described rather than a
  // position being read off.
  void herMark;
  const list = (cells: readonly number[]) => cells.map((c) => CELL_NAME[c]).join(", ");
  const row =
    free.length <= 4
      ? `open squares: ${list(free)}`
      : hers.length && his.length
        ? `she has ${list(hers)}; he has ${list(his)}`
        : hers.length
          ? `she has ${list(hers)}`
          : his.length
            ? `he has ${list(his)}`
            : "the board is empty";
  return row.split(/\s+/).length <= MAX_FACT_WORDS ? row : `${free.length} squares still open`;
}

/**
 * The one-line fact for a move that was just played — ttt's `moveFact`.
 *
 * At most TWO clauses — the square, and the single most salient thing about
 * taking it. Same hard cap chess's `moveFact` enforces and for the same
 * reason: a person across a board notices ONE thing about a move and says it,
 * not a scoresheet.
 */
export function tttMoveFact(game: Game, whoMoved: "her" | "him", herMark?: Mark): string {
  const last: PlayedMove | undefined = game.played[game.played.length - 1];
  if (!last) return "";
  const who = whoMoved === "her" ? "she" : "he";
  const bits: string[] = [`${who} took ${CELL_NAME[last.cell]}`];

  // What the board looked like an instant before this move, so "did this
  // block a threat" is read off the record rather than a stored flag —
  // correct on replay, and correct even if this is called long after.
  const before = game.board.slice();
  before[last.cell] = null;
  const opp: Mark = other(last.by);

  // THE HEADLINE, chessTalk.ts's `moveFact` order and its reasoning: a person
  // across a board notices ONE thing about a move and says it. What was
  // missing here is the middle rung — the move that leaves somebody one
  // square from winning is the single most interesting thing that happens in
  // a game of tic-tac-toe, and it outranks "it blocked a line", which is the
  // bland true thing that can be said about half of all ttt moves.
  //
  // `herMark` is optional so every call site that predates the threat layer
  // renders exactly what it rendered before. It is passed everywhere in this
  // repo; the default is a compatibility floor, not a supported mode.
  const threat = herMark ? tttThreats(game, herMark)[0] : "";
  if (game.status.over && game.status.result === "win") {
    const line = lineName(game.status.line);
    bits.push(line ? `that wins it on ${line}` : "that wins it");
  } else if (game.status.over) {
    bits.push("that draws it");
  } else if (threat) {
    bits.push(threat);
  } else if (winningCells(before, opp).includes(last.cell)) {
    bits.push("it blocked a line");
  }
  // Same ≤14-word contract, enforced rather than hoped for: the headline is
  // the clause that goes, because the square she took is the half a late note
  // still needs to be true.
  while (bits.length > 1 && bits.join(", ").split(/\s+/).length > MAX_FACT_WORDS) bits.pop();
  return bits.join(", ");
}

/**
 * ttt's `settledClause` — read `chessTalk.ts`'s for the reasoning, which
 * applies here unchanged. A note about a move that does not also say the choice
 * is CLOSED is a note a model will deliberate against, whatever tense it is in.
 */
export function tttSettledClause(game: Game, herMark: Mark): string {
  if (game.status.over) return "";
  if (!game.played.length) return game.status.turn === herMark ? "she opens, nothing played yet" : "";
  return game.status.turn === herMark
    ? "it is her turn, her square is not taken yet"
    : "her square is already taken, his turn now";
}

/** ttt's `chessMoveNote` — read that function's header; same law, same reason
 *  the composition lives here and not at the call site. */
export function tttMoveNote(game: Game, herMark: Mark, whoMoved: "her" | "him"): string {
  return [tttMoveFact(game, whoMoved, herMark), tttSettledClause(game, herMark)].filter(Boolean).join("; ");
}

/**
 * The rows that outlive the board — ttt's `chessRecord`. Read that function's
 * header for the reasoning; it applies here unchanged.
 *
 * The tester's own sequence is the case this serves: two games of chess and
 * then tic tac toe, and when he asked about the chess she answered with the
 * tic tac toe — the only game still in the present moment. Both games needed
 * a durable record for either answer to be possible.
 */
export function tttRecord(game: Game, herMark: Mark, endedEarly = false): string[] {
  const rows: string[] = [`she was ${herMark}`];
  const ply = game.played.length;
  // "1 moves" is the tell that a sentence was assembled rather than said —
  // the same one `chessTalk.ts`'s capture row had to grow out of.
  const moves = `${ply} move${ply === 1 ? "" : "s"}`;
  const open = 9 - ply;
  if (game.status.over) {
    if (game.status.result === "draw") {
      rows.push(`a draw, the board filled up after ${moves}`);
    } else {
      // THE SHAPE, not only the winner. "he won it in 5 moves" is a scoreline;
      // "he won it on the diagonal" is what a person actually carries out of a
      // game of noughts and crosses, and it is the half she had no word for.
      const line = lineName(game.status.line);
      rows.push(
        `${game.status.winner === herMark ? "she" : "he"} won it in ${moves}${line ? `, on ${line}` : ""}`,
      );
    }
  } else if (ply) {
    // A TTT FACT NAMES THE GRID. "left unfinished after 5 moves" is chess
    // prose wearing a ttt hat: a chess game has an unbounded move number and
    // that number IS the location, while a ttt board has nine squares and the
    // honest location is how many of them nobody ever took. `endedEarly` is
    // the session's own flag — only it knows the difference between "no
    // result yet" and "he stopped playing", the same distinction chessRecord
    // is passed for.
    const where = `${open} square${open === 1 ? "" : "s"} never taken`;
    rows.push(endedEarly ? `he left it unfinished, ${where}` : `left unfinished, ${where}`);
  } else {
    rows.push(endedEarly ? "he left it before a mark was played" : "left before a move was played");
  }
  // The opening square, which is the only move of a ttt game anyone recalls.
  const first = game.played[0];
  if (first) rows.push(`${first.by === herMark ? "she" : "he"} opened in ${CELL_NAME[first.cell]}`);
  // WHERE THE MARKS ENDED UP. Chess's record carries the opening line and what
  // was taken; ttt's equivalent is simply the finished grid, and it is what
  // lets her answer "where did I go?" a week later instead of inventing a
  // square. Two rows rather than one joined clause, for chessRecord's own
  // stated reason: a row at the 14-word ceiling is a row the filter below
  // deletes WHOLE, losing both halves to save one.
  const hers: number[] = [];
  const his: number[] = [];
  for (const m of game.played) (m.by === herMark ? hers : his).push(m.cell);
  if (hers.length) rows.push(`she had ${nameList(hers)}`);
  if (his.length) rows.push(`he had ${nameList(his)}`);
  // Same ≤14-word contract chessRecord enforces, and for the same reason.
  return rows.filter((r) => r.split(/\s+/).length <= MAX_FACT_WORDS);
}

/**
 * The machine-derived state line — ttt's `chessGameState`. Read off
 * `game.status`, which is `board.ts`'s own reading of the nine squares, and
 * never off a fact row. Same two shapes: live, or an ending that names its
 * winner or says there is none.
 */
export function tttGameState(game: Game, herMark: Mark, endedEarly = false): string {
  const st = game?.status;
  const marks = game?.played?.length ?? 0;
  if (st?.over) {
    if (st.result === "win") return `${st.winner === herMark ? "she" : "he"} won, three in a row`;
    return "the game ended in a draw, the board filled up, nobody won";
  }
  if (endedEarly) return `the game ended early after ${marks} marks, no result, nobody won`;
  return `in progress, ${marks} marks played`;
}

/**
 * The whole activity, for the tail block at connect — ttt's `chessActivity`.
 *
 * Short by construction. A person sitting down mid-game knows roughly where
 * it stands and whose turn it is, not the full move list.
 */
export function tttActivity(
  game: Game,
  herMark: Mark,
  startedAt: number,
  /** the session's own `endedEarly`, exactly as chessActivity takes it — only
   *  the session knows "no result yet" from "he stopped playing", and the
   *  record's ending row is the one place that difference has to be right. */
  endedEarly = false,
): TttActivityState {
  const facts: string[] = [];
  const nameable: string[] = [];
  const ply = game.played.length;

  // ORDER IS THE DROP POLICY, and on this block it is nearly the whole design.
  // `renderActivity` pops whole facts off the END when the block is over
  // budget, and the ttt head alone is 307 of the 420 bytes (the label is six
  // characters longer than chess's) — so a LIVE game has room for whose-move
  // plus about one more row, and everything below it is written for the
  // finished block, which has 189. Measured, not guessed; the eval asserts
  // both survivals rather than trusting this comment.
  //
  // Least important LAST. The order changed in this wave: "N moves in" used to
  // LEAD, which meant the single most useless row in the block was the one row
  // guaranteed to survive, and the threat that decides the game was not in the
  // block at all.
  //
  // HER MARK RIDES THIS ROW. It used to be a row of its own ("she is playing
  // x") and, in the order this block shipped with, that row happened to
  // survive; in the order it needs — the threat and the position ahead of the
  // move count — it is the row that falls off. So it is folded into the one
  // row the drop policy cannot take. Six words either way, and the fact she
  // most obviously must never lose is the one she is now guaranteed.
  if (game.status.over) {
    facts.push(
      game.status.result === "draw"
        ? `the board filled up, nobody won, she was ${herMark}`
        : game.status.winner === herMark
          ? `she won that one, she was ${herMark}`
          : `he won that one, she was ${herMark}`,
    );
  } else if (endedEarly) {
    // A board he put away mid-game. HEAD row, because it is the one that stops
    // her inventing a winner — `state/game.ts`'s facts rewrite does the same
    // job for a session that reaches it through the closed-game window.
    facts.push(`he ended the game early, no result, she was ${herMark}`);
  } else {
    facts.push(
      game.status.turn === herMark
        ? `it is her move, she is ${herMark}`
        : `it is his move, she is ${herMark}`,
    );
  }

  // The last move, with the live threat folded into it as its headline — the
  // one row that carries both what just happened and what it means. This is
  // chessTalk.ts's `moveFact` shape and it is here for the budget reason
  // above: two separate rows would cost one of them.
  //
  // NO THREATS ON AN ABANDONED BOARD. The rules layer suppresses them for a
  // FINISHED game (`tttThreats` returns [] when `status.over`), but a board he
  // put away is not finished — it simply stopped — so without this the block
  // read "he ended the game early, no result" directly above "he is one square
  // from winning", which is a live threat on a dead board and reads as her not
  // having noticed the game was over. Passing no `herMark` is exactly the
  // "render what you rendered before the threat layer" mode.
  const last = game.played[game.played.length - 1];
  let told = "";
  if (last) {
    const whoMoved: "her" | "him" = last.by === herMark ? "her" : "him";
    told = tttMoveFact(game, whoMoved, endedEarly ? undefined : herMark);
    if (told) facts.push(told);
  }

  // WHERE THE MARKS ARE. A nine-square board is speakable, unlike a FEN, and
  // without this row she was talking about a game whose position she had never
  // been shown (see `tttBoardFact`).
  const board = tttBoardFact(game, herMark);
  if (board) facts.push(board);

  // ONE threat row, and only one the move fact did not already carry — chess's
  // own rule, for chess's own reason: two rows saying the same thing in
  // different words is the commentator failure with extra steps.
  const spare = endedEarly ? undefined : tttThreats(game, herMark).find((f) => !told.includes(f));
  if (spare) facts.push(spare);

  facts.push(ply === 0 ? "the board is empty" : `${ply} move${ply === 1 ? "" : "s"} in`);

  // Every cell ever played is nameable — she may refer back to the game, and
  // the record is the ground truth she is allowed to cite. Mirrors chess's
  // "every move ever played is nameable" for the honesty allowlist. The
  // winning line joins it: `record` now names the shape a game was won on, and
  // a name in the record she is not allowed to say is a record she cannot use.
  for (const m of game.played) nameable.push(CELL_NAME[m.cell]);
  const won = lineName(game.status.line);
  if (won) nameable.push(won);

  return {
    kind: "ttt",
    startedAt,
    facts: facts.filter((f) => f.split(/\s+/).length <= MAX_FACT_WORDS),
    nameable,
    record: tttRecord(game, herMark, endedEarly),
    // BOARD TRUTH, machine-derived — parity with chess's own, and here for the
    // same reason it is there: `activity.ts`'s `STATE_LAW` is a fence about a
    // line, so a board that does not emit the line has no fence. A ttt game
    // cannot be checkmated, but it can absolutely be declared won mid-board,
    // and `dead-writers` is the law that says a seam ttt merely "supports"
    // is a seam ttt does not have.
    state: tttGameState(game, herMark, endedEarly),
    waitingOnHer: !game.status.over && game.status.turn === herMark,
    // Same contract chessActivity honours: without this, a finished-but-
    // unclosed ttt game rendered "RIGHT NOW YOU TWO ARE IN THE MIDDLE OF"
    // directly above a fact announcing the winner — one block contradicting
    // itself on the lane she speaks from.
    over: game.status.over,
  };
}
