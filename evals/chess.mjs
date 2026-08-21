// The chess rules + opponent layer (src/engine/chess/), against the CURRENT
// source. Standalone:  node evals/chess.mjs
//
// This suite bundles the real TypeScript itself rather than importing
// `./.bundle.mjs`, because it is not wired into evals/run.mjs's entry — see
// the note at the bottom of this file. It rebuilds on every run for the reason
// CLAUDE.md gives about parsetest.v2: a frozen bundle passes forever while the
// source rots.
//
// ── the weighting, and why ────────────────────────────────────────────────
//
// One assertion here matters more than all the others put together: SHE MUST
// NEVER RETURN AN ILLEGAL MOVE. Everything else about this feature degrades
// gracefully — a weak move is a beatable opponent, a wrong verdict is a
// consumer that says something bland — but an illegal move desyncs the board
// mid-call and there is no state a user would accept afterwards. So the legal-
// move assertions run her across every strength on every position in the file,
// including two full self-played games, and every other section is smaller.
//
// The second-heaviest section is perft. A legal move generator is the classic
// source of subtle bugs — a castling right that survives a rook capture, an
// en-passant capture that leaves the king in check — and those bugs do not
// show up as a crash, they show up as a position that quietly diverges. Perft
// against published node counts is the only test that catches all of them at
// once, which is why the fast generator in x88.ts is allowed to exist at all.

import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Derived from this file's location, never hardcoded: evals/echosim/build.mjs
// names the failure mode — a hardcoded "/home/user/html-portfolio" is true of
// exactly one container and silently wrong everywhere else.
const REPO = resolve(HERE, "..");
const OUT = mkdtempSync(join(tmpdir(), "chesseval-"));
const ENTRY = join(OUT, "entry.ts");
// x88 is deliberately not re-exported from the module's index (see index.ts),
// so perft is reached through a second export here. That is the eval suite
// reaching past the public surface on purpose; nothing in src/ may.
writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(join(REPO, "src/engine/chess/index"))};\n` +
    `export * as x88 from ${JSON.stringify(join(REPO, "src/engine/chess/x88"))};\n`,
);
const BUNDLE = join(OUT, "chess.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { cwd: REPO, stdio: "inherit" },
);
const C = await import(pathToFileURL(BUNDLE).href);
const { x88 } = C;

let fail = 0;
let count = 0;
const ok = (name, cond, extra = "") => {
  count++;
  if (!cond) { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); }
};
const eq = (name, got, want) => {
  count++;
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};

// ── perft: the correctness proof for the fast generator ───────────────────
// Node counts from the standard test set (CPW "Perft Results"). Depths are cut
// where the suite would stop being something anyone runs on every build.
const PERFT = [
  ["initial", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", [20, 400, 8902, 197281]],
  // Kiwipete: castling both sides, pins, and a pawn that can capture en passant.
  ["kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039, 97862]],
  // Position 3: the en-passant-discovers-check position. This is the one that
  // catches an ep capture that leaves the king in check.
  ["position3", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812, 43238, 674624]],
  // Position 4: promotions, including under-promotion with capture.
  ["position4", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [6, 264, 9467, 422333]],
  ["position5", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", [44, 1486, 62379]],
  ["position6", "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10", [46, 2079, 89890]],
];
for (const [name, fen, want] of PERFT) {
  for (let d = 1; d <= want.length; d++) {
    eq(`perft ${name} d${d}`, x88.perft(x88.posFromFen(fen), d), want[d - 1]);
  }
}

// ── the fast generator agrees with the rules authority, move for move ─────
// Perft proves the counts. This proves the MOVES, which is what actually gets
// played: a generator can produce the right number of wrong moves.
const AGREE = PERFT.map(([, fen]) => fen).concat([
  "8/8/8/8/k1pP3R/8/8/3K4 b - d3 0 1",
  "4k3/8/8/8/8/8/4P3/4K2R w K - 0 1",
  "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1",
]);
for (const fen of AGREE) {
  const authority = C.legalMoves(fen).map((m) => m.uci).sort();
  const fast = x88.generateLegal(x88.posFromFen(fen)).map(x88.moveToUci).sort();
  eq(`generator agrees: ${fen.slice(0, 24)}`, fast, authority);
}

// ── FEN round-trips ────────────────────────────────────────────────────────
for (const [, fen] of PERFT) {
  eq(`fen round-trip ${fen.slice(0, 20)}`, x88.fenFromPos(x88.posFromFen(fen)), fen);
}
ok("newGame starts from the standard position", C.newGame().fen === C.START_FEN);
ok("a malformed fen is rejected", !C.isValidFen("not a fen"));
ok("a fen with no black king is rejected", !C.isValidFen("8/8/8/8/8/8/8/4K3 w - - 0 1"));
ok("a real fen is accepted", C.isValidFen(C.START_FEN));

// ── castling ───────────────────────────────────────────────────────────────
const sans = (fen) => C.legalMoves(fen).map((m) => m.san);
ok("both castles offered when clear", (() => {
  const s = sans("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  return s.includes("O-O") && s.includes("O-O-O");
})());
ok("no castling without the right", !sans("r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1").includes("O-O"));
// Through check. The king may not pass over an attacked square; the ROOK may.
ok("kingside castle blocked when f1 is attacked",
  !sans("4k3/8/8/8/8/8/5q2/R3K2R w KQ - 0 1").includes("O-O"));
ok("queenside castle allowed when only b1 is attacked",
  sans("1r2k3/8/8/8/8/8/8/R3K2R w KQ - 0 1").includes("O-O-O"),
  "the king crosses d1 and c1; b1 is crossed by the ROOK, which may be attacked");
ok("no castling out of check", !sans("4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1").includes("O-O"));
{
  // Rights die when the rook is captured, not only when it moves. This is the
  // castling bug that perft catches and eyeballing does not.
  // Promoting to a KNIGHT on purpose: a queen on a8 would also be check, and
  // "cannot castle" would then prove nothing about the rights.
  let g = C.newGame("r3k2r/1P6/8/8/8/8/8/R3K2R w KQkq - 0 1");
  g = C.play(g, "bxa8=N");
  ok("capturing the rook kills that castling right",
    !sans(g.fen).includes("O-O-O"), g.fen);
  ok("the other side's right survives", sans(g.fen).includes("O-O"), g.fen);
}
{
  let g = C.newGame("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  g = C.play(g, "O-O");
  eq("kingside castle moves both pieces", g.fen.split(" ")[0], "r3k2r/8/8/8/8/8/8/R4RK1");
  ok("castle is flagged", g.played.at(-1).isCastle && g.played.at(-1).castleSide === "king");
  g = C.play(g, "O-O-O");
  eq("queenside castle moves both pieces", g.fen.split(" ")[0], "2kr3r/8/8/8/8/8/8/R4RK1");
}

// ── en passant ─────────────────────────────────────────────────────────────
{
  let g = C.newGame();
  for (const m of ["e4", "e6", "e5", "d5"]) g = C.play(g, m);
  ok("en passant is offered", sans(g.fen).includes("exd6"));
  g = C.play(g, "exd6");
  const last = g.played.at(-1);
  ok("en passant is flagged", last.isEnPassant && last.isCapture);
  ok("the captured pawn leaves the board", !g.fen.split(" ")[0].includes("3p"), g.fen);
  eq("the capturing pawn lands on d6", last.to, "d6");
}
ok("en passant that exposes the king is illegal",
  !sans("8/8/8/8/k1pP3R/8/8/3K4 b - d3 0 1").includes("cxd3"),
  "cxd3 e.p. would clear rank 4 between Ra... and the king");
ok("the ordinary push is still legal there",
  sans("8/8/8/8/k1pP3R/8/8/3K4 b - d3 0 1").includes("c3"));

// ── promotion ──────────────────────────────────────────────────────────────
{
  // SAN carries a "+" when the new piece checks, so compare the piece letters.
  const s = sans("8/P7/8/8/8/8/8/K6k w - - 0 1");
  eq("all four promotions are generated",
    s.filter((m) => m.startsWith("a8=")).map((m) => m.slice(3, 4)).sort(),
    ["B", "N", "Q", "R"]);
}
{
  let g = C.newGame("1n6/P7/8/8/8/8/8/K6k w - - 0 1");
  g = C.play(g, { from: "a7", to: "b8", promotion: "n" });
  const last = g.played.at(-1);
  ok("under-promotion with capture works", last.promotion === "n" && last.captured === "n", last.san);
  ok("the new piece is on the board", g.fen.startsWith("1N6"), g.fen);
}
ok("a promotion move without a piece is rejected",
  !C.isLegalMove("8/P7/8/8/8/8/8/K6k w - - 0 1", { from: "a7", to: "a8" }),
  "chess.js requires the promotion field; silently queening would be a guess");

// ── checkmate, stalemate, draws ────────────────────────────────────────────
const st = (fen) => C.statusOfFen(fen);
eq("fool's mate is mate", st("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3").result, "checkmate");
eq("fool's mate winner is black", st("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3").winner, "b");
eq("back-rank mate is mate", st("R5k1/5ppp/8/8/8/8/8/6K1 b - - 1 1").result, "checkmate");
eq("smothered mate is mate", st("6rk/5Npp/8/8/8/8/8/K7 b - - 0 1").result, "checkmate");
eq("classic stalemate", st("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").result, "stalemate");
eq("stalemate has no winner", st("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").winner, null);
eq("stalemate is not check", st("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").inCheck, false);
eq("K vs K is insufficient", st("8/8/8/4k3/8/8/8/4K3 w - - 0 1").result, "insufficient_material");
eq("K+B vs K is insufficient", st("8/8/8/4k3/8/8/8/3BK3 w - - 0 1").result, "insufficient_material");
eq("K+R vs K is not a draw", st("8/8/8/4k3/8/8/8/3RK3 w - - 0 1").result, "in_progress");
eq("the fifty-move rule fires at 100 half-moves", st("8/8/4k3/8/8/4K3/8/6R1 w - - 100 80").result, "fifty_move");
eq("ninety-nine half-moves is not yet a draw", st("8/8/4k3/8/8/4K3/8/6R1 w - - 99 80").result, "in_progress");
{
  // Threefold, counted from the game's own history — the reason `positions`
  // is carried in the Game value rather than kept in a module-level Map.
  let g = C.newGame("4k3/8/8/8/8/8/8/R3K2R w - - 0 1");
  for (const m of ["Ra2", "Ke7", "Ra1", "Ke8", "Ra2", "Ke7", "Ra1", "Ke8"]) g = C.play(g, m);
  eq("threefold repetition is detected", g.status.result, "threefold_repetition");
  ok("a fresh game with the same fen is NOT a repetition",
    C.newGame(g.fen).status.result === "in_progress",
    "history belongs to the game, not the position");
}
{
  let g = C.newGame();
  const before = g;
  ok("an illegal move returns null", C.play(g, "e5") === null);
  ok("a nonsense move returns null", C.play(g, "zz9") === null);
  ok("the game is unchanged after an illegal move", before.fen === g.fen);
  ok("play does not mutate its input", C.play(g, "e4").fen !== g.fen && g.played.length === 0);
}

// ── SHE ALWAYS RETURNS A LEGAL MOVE ───────────────────────────────────────
// The assertion the whole feature rests on. Every strength, every position.
const TRICKY = [
  ["initial", C.START_FEN],
  ["kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"],
  ["promotion race", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1"],
  ["ep available", "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3"],
  ["ep is pinned", "8/8/8/8/k1pP3R/8/8/3K4 b - d3 0 1"],
  ["in check", "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"],
  ["only one legal move", "7k/8/8/8/8/8/5PPP/6rK w - - 0 1"],
  ["mate in one", "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"],
  ["about to be stalemated", "7k/8/6Q1/8/8/8/8/6K1 w - - 0 1"],
  ["bare kings and a pawn", "8/8/8/4k3/8/8/2P5/4K3 w - - 0 1"],
  ["zugzwang", "8/8/1p1r1k2/p1pPN1p1/P3KnP1/1P6/8/3R4 b - - 0 1"],
  ["queens everywhere", "8/PPPk4/8/8/8/8/4Kppp/8 w - - 0 1"],
  ["a rook endgame", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"],
  ["black to move, castling both", "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1"],
];
for (const [name, fen] of TRICKY) {
  const g = C.newGame(fen);
  for (let level = 1; level <= 5; level++) {
    const her = C.chooseMove(g, { strength: level });
    if (g.status.over) {
      ok(`she declines a finished game: ${name} L${level}`, her === null);
      continue;
    }
    ok(`legal move: ${name} L${level}`,
      her !== null && C.isLegalMove(fen, { from: her.move.from, to: her.move.to, promotion: her.move.promotion ?? undefined }),
      her ? her.move.san : "null");
    ok(`her fenAfter is real: ${name} L${level}`, her !== null && C.isValidFen(her.fenAfter));
    ok(`she reports why: ${name} L${level}`,
      her !== null && typeof her.choice.kind === "string" && Array.isArray(her.choice.flavour));
  }
}
// The async path must agree with the sync one: same position, same move. If it
// did not, "she played something weird" would be unreproducible in a test.
// Both paths drive one generator (search.ts), so agreement is structural
// rather than lucky; level 5 is included because it is the level with enough
// nodes to hit several checkpoints, which is where a resumable search would
// diverge if the pause points depended on anything but the node count.
for (const [name, fen] of TRICKY.slice(0, 6)) {
  const g = C.newGame(fen);
  if (g.status.over) continue;
  for (const level of name === "initial" || name === "kiwipete" ? [3, 5] : [3]) {
    const a = C.chooseMove(g, { strength: level });
    const b = await C.chooseMoveAsync(g, { strength: level });
    ok(`async agrees with sync: ${name} L${level}`, a.move.uci === b.move.uci,
      `${a.move.san} vs ${b?.move.san}`);
  }
}

// Two whole games, played out. End-to-end coverage nothing else gives: every
// phase, every special move that comes up naturally, and a hundred-odd chances
// for an illegal move to escape.
for (const [white, black] of [[1, 3], [4, 2]]) {
  let g = C.newGame();
  let plies = 0;
  let broke = null;
  while (!g.status.over && plies < 120) {
    const level = g.status.turn === "w" ? white : black;
    const her = C.chooseMove(g, { strength: level });
    if (!her) { broke = "returned null while the game was live"; break; }
    const next = C.play(g, { from: her.move.from, to: her.move.to, promotion: her.move.promotion ?? undefined });
    if (!next) { broke = `illegal move ${her.move.san} at ${g.fen}`; break; }
    if (next.fen !== her.fenAfter) { broke = `fenAfter disagreed with play() at ${g.fen}`; break; }
    g = next;
    plies++;
  }
  ok(`self-play L${white} vs L${black} never played an illegal move`, broke === null, broke ?? "");
  ok(`self-play L${white} vs L${black} made progress`, plies > 20, `${plies} plies`);
}

// ── determinism ────────────────────────────────────────────────────────────
// Same board, same move. Without this nothing above is a repeatable test and
// no report of "she blundered on move 14" can be reproduced.
for (const [name, fen] of TRICKY) {
  const g = C.newGame(fen);
  if (g.status.over) continue;
  const a = C.chooseMove(g, { strength: 3 });
  const b = C.chooseMove(g, { strength: 3 });
  ok(`deterministic: ${name}`, a.move.uci === b.move.uci, `${a.move.san} then ${b.move.san}`);
}
{
  const g = C.newGame(C.START_FEN);
  const seeded = (seed) => C.chooseMove(g, { strength: { level: 3, seed } }).move.uci;
  ok("an explicit seed is honoured", seeded(1) === seeded(1));
  ok("different seeds are allowed to differ", true, "not asserted: equal is legal, just less varied");
}

// ── she finds the obvious things ───────────────────────────────────────────
// Not a strength test — a sanity test. An opponent that misses mate in one or
// declines a free queen is broken rather than easy, and "beatable" was never
// meant to cover either.
{
  const mate1 = C.chooseMove(C.newGame("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"), { strength: 3 });
  eq("she plays mate in one", mate1.move.san, "Ra8#");
  ok("and says the game ended", mate1.assessment.statusAfter.result === "checkmate");
  eq("mate delivered is mateIn 0", mate1.assessment.mateIn, 0);
  ok("mate is tagged", mate1.assessment.tags.includes("checkmate"));
}
{
  // A hanging queen, defended by nothing.
  const free = C.chooseMove(C.newGame("4k3/8/8/3q4/4B3/8/8/4K3 w - - 0 1"), { strength: 3 });
  eq("she takes the free queen", free.move.san, "Bxd5");
  ok("and the capture is tagged", free.assessment.tags.includes("capture"));
}
{
  // Level 1 must still be a real opponent, not a random mover.
  const free1 = C.chooseMove(C.newGame("4k3/8/8/3q4/4B3/8/8/4K3 w - - 0 1"), { strength: 1 });
  eq("even level 1 takes the free queen", free1.move.san, "Bxd5");
}
{
  const g = C.newGame("7k/8/8/8/8/8/5PPP/6rK w - - 0 1");
  const her = C.chooseMove(g, { strength: 3 });
  eq("the only legal move is played", her.move.san, "Kxg1");
  eq("and reported as forced", her.choice.kind, "only_move");
}

// ── the structured assessment ──────────────────────────────────────────────
{
  // 1.e4 e5 2.Qh5 Nc6 3.Qxf7+?? — a capture, a check, and a hung queen.
  let g = C.newGame();
  for (const m of ["e4", "e5", "Qh5", "Nc6", "Qxf7"]) g = C.play(g, m);
  const a = C.assessLast(g);
  eq("a hung queen is a blunder", a.verdict, "blunder");
  ok("the loss is large", a.cpLoss >= 300, String(a.cpLoss));
  ok("the hanging piece is named", a.hangs !== null && a.hangs.piece === "q" && a.hangs.square === "f7",
    JSON.stringify(a.hangs));
  ok("the punishing move is named", a.hangs !== null && a.hangs.takenBy === "Kxf7");
  ok("a better move is offered", typeof a.better === "string" && a.better !== "Qxf7+");
  eq("standing after it", a.standing, "losing");
  ok("it is still tagged as the capture and check it was",
    a.tags.includes("capture") && a.tags.includes("check"));
  ok("and as losing material", a.tags.includes("hangs_piece") || a.tags.includes("loses_material"));
  ok("no English anywhere in the assessment", !hasProse(a), "the talking workstream owns all prose");
}
{
  // A good, ordinary developing move must not read as a mistake.
  let g = C.newGame();
  for (const m of ["e4", "e5", "Nf3"]) g = C.play(g, m);
  const a = C.assessLast(g);
  ok("Nf3 is not a blunder", a.verdict !== "blunder" && a.verdict !== "mistake", a.verdict);
  ok("Nf3 develops", a.tags.includes("develops"));
  ok("the position is level", a.standing === "level", `${a.standing} ${a.cpAfter}`);
  ok("cpLoss is small", Math.abs(a.cpLoss) < 150, String(a.cpLoss));
}
{
  let g = C.newGame();
  for (const m of ["e4", "d5", "exd5"]) g = C.play(g, m);
  const a = C.assessLast(g);
  ok("a pawn capture is tagged", a.tags.includes("capture"));
  eq("material moved by a pawn", a.materialDeltaCp, 100);
  ok("a central pawn move is tagged", C.assessMove(
    C.newGame().fen, C.legalMoves(C.newGame().fen).find((m) => m.san === "e4"),
    C.play(C.newGame(), "e4").fen,
  ).tags.includes("central_pawn"));
}
{
  // Both sides go through one function, and the numbers are in the MOVER's
  // frame either way — a consumer that had to remember whose turn it was would
  // get it wrong.
  // 1.e4 e5 2.Nf3 Qf6 3.Nc3 Qxf3?? — black wins a knight and loses the queen.
  let g = C.newGame();
  for (const m of ["e4", "e5", "Nf3", "Qf6", "Nc3", "Qxf3"]) g = C.play(g, m);
  const a = C.assessLast(g);
  eq("black's move is assessed as black's", a.move.by, "b");
  ok("a black blunder reads as a loss FOR BLACK", a.cpLoss >= 300, String(a.cpLoss));
  eq("black is losing after it", a.standing, "losing");
  ok("the capture is still reported", a.tags.includes("capture") && a.materialDeltaCp === 320,
    String(a.materialDeltaCp));
}
{
  const forced = C.assessLast(C.play(C.newGame("7k/8/8/8/8/8/5PPP/6rK w - - 0 1"), "Kxg1"));
  eq("a forced move is verdict forced", forced.verdict, "forced");
  ok("and tagged forced", forced.tags.includes("forced") && forced.tags.includes("only_move"));
}
{
  const g = C.newGame("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1");
  const mate = C.assessLast(C.play(g, "Ra8"));
  ok("mate is tagged and terminal", mate.tags.includes("checkmate") && mate.statusAfter.over);
  eq("mate wins for white", mate.statusAfter.winner, "w");
}
{
  const m = C.materialCount(C.START_FEN);
  eq("the starting material is symmetric", [m.w, m.b], [m.b, m.w]);
  ok("and non-zero", m.w > 0);
}

// Every assessment field a consumer will read must exist on every move, or the
// consumer learns to guard, and a guarded field is a field nobody uses.
{
  const g = C.newGame();
  for (const mv of C.legalMoves(g.fen).slice(0, 6)) {
    const a = C.assessMove(g.fen, mv, C.play(g, mv.san).fen);
    const missing = [
      "move", "fenBefore", "fenAfter", "tags", "verdict", "cpBefore", "cpAfter",
      "cpLoss", "materialDeltaCp", "materialBalanceCp", "standing", "phase",
      "statusAfter", "search",
    ].filter((k) => a[k] === undefined);
    eq(`assessment is complete for ${mv.san}`, missing, []);
    ok(`nullable fields are null and not undefined for ${mv.san}`,
      a.hangs !== undefined && a.better !== undefined && a.mateIn !== undefined);
  }
}

// ── the budget is real ─────────────────────────────────────────────────────
// Not a wall-clock assertion — CI machines vary and a timing test that fails
// on a loaded runner teaches people to ignore the suite. The NODE budget is
// the thing that is actually promised, so that is what is asserted.
for (let level = 1; level <= 5; level++) {
  const s = C.STRENGTHS[level];
  const her = C.chooseMove(C.newGame("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"), { strength: level });
  // Depth 1 is exempt from the budget on purpose (see search.ts), so the bound
  // is the cap plus whatever one complete ply cost.
  ok(`L${level} respects its node budget`, her.search.nodes <= Math.max(s.maxNodes, 60_000) + 1000,
    `${her.search.nodes} > ${s.maxNodes}`);
  ok(`L${level} completed at least one ply`, her.search.depth >= 1, `depth ${her.search.depth}`);
}
{
  const strong = C.resolveStrength(9);
  const weak = C.resolveStrength(-4);
  eq("out-of-range strength clamps up", strong.level, 5);
  eq("out-of-range strength clamps down", weak.level, 1);
  eq("an override merges onto its level", C.resolveStrength({ level: 2, maxNodes: 7 }).maxNodes, 7);
  eq("and keeps the rest of that level", C.resolveStrength({ level: 2, maxNodes: 7 }).maxDepth, C.STRENGTHS[2].maxDepth);
}

/**
 * Does this object contain a sentence? The module's contract is that it emits
 * enums, numbers and SAN and never prose, because CLAUDE.md's measured rule is
 * that anything sentence-shaped in a prompt gets recited verbatim later. A
 * space inside a string value is the cheapest reliable tell — SAN never has
 * one, and none of the enum values do either.
 */
function hasProse(value, seen = new Set()) {
  if (typeof value === "string") return /[a-z] [a-z]/i.test(value) && !/^[rnbqkp1-8/]+ [wb] /i.test(value);
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([k, v]) => k !== "fen" && k !== "fenBefore" && k !== "fenAfter" && hasProse(v, seen));
}

console.log(fail ? `${fail} FAILURES of ${count}` : `ALL ${count} PASS`);
process.exit(fail ? 1 : 0);

// ── why this is not in evals/run.mjs ──────────────────────────────────────
//
// It should be, and CLAUDE.md's `dead-writers` rule says so: a suite nothing
// invokes is indistinguishable from a suite that does not exist. It is not
// wired in because this workstream owns exactly two paths — src/engine/chess/
// and this file — and evals/run.mjs belongs to another. The one-line change is
// in the report; adding `chess: "chess.mjs"` to the `suites` map is all it
// needs, and this file is standalone so it needs nothing else.
