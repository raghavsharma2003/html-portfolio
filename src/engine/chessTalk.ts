// The chess → activity adapter. The ONLY place chess becomes words.
//
// `src/engine/chess/` deliberately emits enums and numbers and no English at
// all — it has an eval asserting that. This file is where its structured
// verdict becomes the handful of facts she is given, and it is separate for a
// reason worth stating: the rules module has to be provable, and prose is not
// provable. Keeping them apart means the search can be rewritten without
// touching a word she might say, and the wording can be tuned without risking
// a single legal move.
//
// WHAT THIS FILE MAY NOT DO, and the eval enforces it: write a line she could
// SAY. `recited-prompt` measured her own example quotes recited on 4 of 5
// turns. Everything below is a fact in the third person about the position —
// telegraphic, ≤14 words, never sentence-shaped, never first-person. "arre
// blunder tha yeh" belongs to her; "he hung the queen on f7" belongs here.

import type { ActivityState } from "./activity";
import type { Game, MoveAssessment, Side } from "./chess";

/** Coarse bands, never a centipawn number she could read out loud. */
function standingFact(a: MoveAssessment, herSide: Side): string {
  // `standing` is in the MOVER's frame; flip it when the mover was him.
  const moverIsHer = a.move && a.fenBefore.split(" ")[1] === herSide;
  const s = a.standing;
  const flip: Record<string, string> = {
    winning: "losing",
    better: "worse",
    level: "level",
    worse: "better",
    losing: "winning",
  };
  const fromHer = moverIsHer ? s : (flip[s] ?? s);
  if (fromHer === "level") return "position is about level";
  return `she is ${fromHer}`;
}

const TAG_FACT: Partial<Record<string, string>> = {
  checkmate: "that is checkmate",
  check: "it was a check",
  capture: "it took a piece",
  en_passant: "it was an en passant",
  promotion: "a pawn promoted",
  castle: "they castled",
  hangs_piece: "it left a piece hanging",
  punishes_hang: "it punished a hanging piece",
  sacrifice: "it was a sacrifice",
  wins_material: "it won material",
  loses_material: "it gave material away",
  early_queen: "the queen came out early",
  develops: "it developed a piece",
  forced: "there was nothing else to play",
};

const VERDICT_FACT: Partial<Record<string, string>> = {
  blunder: "a bad one",
  mistake: "a mistake",
  inaccuracy: "slightly off",
  best: "the best move there",
  good: "a good one",
};

/**
 * The one-line fact for a move that was just played — the per-move poke.
 *
 * Names the move in algebraic, which is BOTH what a person says out loud and
 * what the honesty allowlist needs: an identifier she emits that was not in
 * her input is treated as invented, so a move she is expected to discuss has
 * to be a move she was handed.
 */
export function moveFact(a: MoveAssessment, herSide: Side, whoMoved: "her" | "him"): string {
  const who = whoMoved === "her" ? "she" : "he";
  // THREE clauses, hard. The first version allowed six and produced "she played
  // Qxf7+, a bad one, it took a piece, it was a check, f7 is hanging, she is
  // losing" — which is a scoresheet being read out, blew the 14-word row limit,
  // and overflowed the block so that whose-turn-it-is fell off the end.
  //
  // A person across a board notices ONE thing about a move and says it. So:
  // the move, the single most salient thing about it, and where that leaves
  // them. Tag order below is the order a human would notice in.
  const bits: string[] = [`${who} played ${a.move.san ?? a.move.uci ?? ""}`.trim()];
  const headline =
    (a.statusAfter?.over ? "that ends it" : null) ??
    (a.hangs?.square ? `${a.hangs.square} is hanging now` : null) ??
    VERDICT_FACT[a.verdict] ??
    a.tags.map((t) => TAG_FACT[t]).find(Boolean) ??
    null;
  if (headline) bits.push(headline);
  if (!a.statusAfter?.over) bits.push(standingFact(a, herSide));
  return bits.join(", ");
}

/**
 * One line for a COMPLETED exchange: his move and her answer together.
 *
 * The per-move poke used to describe only the latest move — which, after her
 * engine answers ~300ms behind his, was always HER move. The debounce meant
 * the one note that survived described her own play, so on calls she narrated
 * herself ("she played Nf6, a good one") every single exchange, which reads
 * exactly as robotic as it sounds. A person talks about the exchange: what he
 * did, and what she did about it — with HIS move carrying the salience,
 * because his move is the one she is actually responding to.
 */
export function exchangeFact(
  his: MoveAssessment,
  hers: MoveAssessment | null,
  herSide: Side,
): string {
  const base = moveFact(his, herSide, "him");
  if (!hers?.move?.san) return base;
  if (hers.statusAfter?.over) return `${base}; she answered ${hers.move.san} and that ends it`;
  return `${base}; she answered ${hers.move.san}`;
}

/**
 * The whole activity, for the tail block at connect.
 *
 * Short by construction. A person sitting down mid-game knows roughly where it
 * stands and whose turn it is — not the move list.
 */
export function chessActivity(
  game: Game,
  herSide: Side,
  startedAt: number,
  last?: MoveAssessment | null,
): ActivityState {
  const facts: string[] = [];
  const nameable: string[] = [];
  const ply = game.played.length;

  facts.push(ply === 0 ? "the game has just started" : `${Math.ceil(ply / 2)} moves in`);
  facts.push(`she is playing ${herSide === "w" ? "white" : "black"}`);

  if (last) {
    const whoMoved = last.fenBefore.split(" ")[1] === herSide ? "her" : "him";
    facts.push(moveFact(last, herSide, whoMoved));
    if (last.move?.san) nameable.push(last.move.san);
    if (last.better) nameable.push(last.better);
  }

  const turn = game.status?.turn;
  if (game.status?.over) {
    // The ending, concretely — who won and how. "the game has finished" alone
    // left her congratulating nobody: she had checkmated him minutes earlier
    // and picked up the phone not knowing there was anything to gloat about.
    const r = game.status.result;
    if (r === "checkmate") {
      facts.push(game.status.winner === herSide ? "she won, by checkmate" : "he won, by checkmate");
    } else {
      facts.push("it ended in a draw");
    }
  } else if (turn) {
    facts.push(turn === herSide ? "it is her move" : "it is his move");
  }
  if (!game.status?.over && game.status?.inCheck) facts.push("someone is in check");

  // Every move ever played is nameable — she may refer back to the game, and
  // the record is the ground truth she is allowed to cite.
  for (const m of game.played) if (m.san) nameable.push(m.san);

  return {
    kind: "chess",
    startedAt,
    facts,
    nameable,
    waitingOnHer: !game.status?.over && turn === herSide,
    over: Boolean(game.status?.over),
  };
}
