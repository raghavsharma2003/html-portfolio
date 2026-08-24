// WS-MOVEVOICE — her hand and her mouth on ONE timeline.
//
//   node evals/movevoice.mjs
//
// ── the defect this file is the permanent record of ───────────────────────
//
// The owner, playing chess on a live call: she made her move MILLISECONDS
// after his, and then two to three seconds later her VOICE said she should
// make the move she had already made. Two agents, two clocks — the hand and
// the mouth — and the incoherence is not that either is wrong, it is that
// they are not the same person.
//
// The fix has three parts and this suite gates all three:
//
//   1. HUMAN THINK TIME. Her move is held for a beat scaled by the position,
//      deterministic per (position, session) so a replay agrees with the run
//      it replays. `state/game.ts`'s `chessThinkMs`/`tttThinkMs`.
//   2. TENSE AND ORDER. Speech about a move is generated AFTER the move is
//      chosen and speaks of it as DONE. There is no pre-line, deliberately —
//      see the choreography block in state/game.ts. `settledClause` is the
//      clause that says the CHOICE is closed, which is the half that a past-
//      tense fact alone does not carry.
//   3. STALENESS. A note drafted for move N must not be spoken after move
//      N+1 exists. `noteIsStale`, checked at the send seam in useCallEngine.
//
// ── the two assertions here that matter most ──────────────────────────────
//
// THE TENSE CHECKER, and its NEGATIVE CONTROL. A checker that only ever sees
// correct text passes just as happily on a broken one. So the pre-fix note
// shape — the move facts WITHOUT the settled clause, which is exactly what
// shipped when the owner heard the defect — is run through the same checker
// and MUST be rejected. An assertion whose evidence is the absence of a
// failure is not evidence.
//
// THE OWNER'S CASE, replayed move by move through the real engine, the real
// assessment layer and the real words layer, with the timing bounds asserted
// on the same function the component calls. Not a description of the bug: the
// bug, as a fixture, failing forever if it comes back.
//
// Offline, deterministic, $0, no browser, no network, ~3s. It re-bundles from
// the REAL source on every run — a frozen bundle passes forever while the
// source rots (`gates-that-live-nowhere`).

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const OUT = mkdtempSync(join(tmpdir(), "movevoice-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(join(REPO, "src/engine/chess/index"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/engine/chessTalk"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/engine/tttTalk"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/engine/ttt/index"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/state/game"))};\n`,
);
const BUNDLE = join(OUT, "movevoice.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { cwd: REPO, stdio: "inherit" },
);
const M = await import(pathToFileURL(BUNDLE).href);
const {
  newGame, play, assessLast, assessMove, legalMoves,
  moveFact, exchangeFact, settledClause, chessMoveNote,
  tttMoveFact, tttSettledClause, tttMoveNote, newTttGame, playTtt, herTttMove,
  chessThinkMs, tttThinkMs, THINK_BANDS, THINK_FLOOR_MS, THINK_CEIL_MS, MOVE_ANIM_MS,
  turnPhase, gamePly, noteIsStale, noteVerdict,
} = M;

let fail = 0;
let count = 0;
const ok = (name, cond, extra = "") => {
  count++;
  if (!cond) { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); }
};
const eq = (name, got, want) => {
  count++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
};

const SEED = Date.UTC(2026, 7, 23, 9, 30);

/** Replay SANs through the REAL board module. Null if any is illegal. */
function replay(sans) {
  let g = newGame();
  for (const san of sans) {
    const next = play(g, san);
    if (!next) return null;
    g = next;
  }
  return g;
}

/** The think input the component builds, assembled here from the same reads. */
function thinkFor(g, herSide, toSquare, seed = SEED) {
  const ply = g.played.length;
  const lastPlayed = ply ? g.played[ply - 1] : null;
  return chessThinkMs({
    fen: g.fen,
    ply,
    legalMoveCount: g.status.legalMoveCount,
    inCheck: g.status.inCheck,
    recapture: Boolean(lastPlayed?.captured && toSquare && lastPlayed.to === toSquare),
    book: M.openingName(g.played.map((m) => m.san)) !== null,
    seed,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 1. THE TENSE CHECKER
//
// Small on purpose. It answers one question about a note that is about to be
// handed to the live model: can this text make her deliberate about a move
// that is already played?
//
// Two halves, and the second is the one the shipped code was missing.
//   (a) NO DELIBERATIVE VERB. "chalungi", "should", "thinking of" — the future
//       and the conditional. A move that is on the board cannot be considered.
//   (b) THE CHOICE MUST BE STATED CLOSED. A past-tense fact alone does not do
//       this: "she answered Nf6" is true and still leaves an open question if
//       something else in her context says it is her move. So the note has to
//       carry, explicitly, that there is nothing pending.
// ══════════════════════════════════════════════════════════════════════════

// Deliberative markers, English and Hinglish. `-ungi`/`-oongi` is the Hindi
// first-person feminine FUTURE, which is the exact form the owner heard.
const DELIBERATIVE = [
  /\b(chalungi|chaloongi|karungi|karoongi|khelungi|kheloongi|lagaungi|maarungi)\b/i,
  /\bshould\s+(i|she|we)\b/i,
  /\b(i|she)\s+should\b/i,
  /\bshould\s+(play|move|take|go|make)\b/i,
  /\bthinking\s+(of|about)\b/i,
  /\b(going|about)\s+to\s+(play|move|take)\b/i,
  /\b(i|she)\s+(will|'ll)\s+(play|move|take|go)\b/i,
  /\blet\s+me\s+(play|think|see|take)\b/i,
  /\bkya\s+(khelu|chalu|karu|khelun|chalun)\b/i,
  /\bmaybe\s+(i|she)\b/i,
  /\bconsidering\b/i,
  /\b(her|his)\s+move\s+is\s+not\s+played\b/i,
];

/** The note says, in so many words, that nothing is pending. */
const CLOSED = [
  /already\s+on\s+the\s+board/i,
  /already\s+taken/i,
  /his\s+turn\s+now/i,
  /that\s+ends\s+it/i,
  /\bwon\b|\bdraw\b|checkmate/i,
];

/** Past/present forms that are always fine — the allow half of the checker. */
const DONE = [/\b(played|answered|took|blocked|opened|captured|wins|ends|won)\b/i];

/** Source with `//` and block comments removed — see the Math.random lint. */
const decomment = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const usesRandom = (src) => /Math\.random\s*\(/.test(decomment(src));

function tenseCheck(text) {
  const problems = [];
  for (const re of DELIBERATIVE) if (re.test(text)) problems.push(`deliberative: ${re}`);
  if (!DONE.some((re) => re.test(text))) problems.push("no done/present form");
  if (!CLOSED.some((re) => re.test(text))) problems.push("choice not stated closed");
  return problems;
}

// The checker must be able to SEE a defect. Three synthetic lines that are
// exactly the failure the owner reported, in the registers he would hear it in.
{
  ok("checker rejects the reported line (english)",
    tenseCheck("she played Nf6; she should play Nf6 next").length > 0);
  ok("checker rejects the reported line (hinglish)",
    tenseCheck("she played Nf6; ab main knight chalungi").length > 0);
  ok("checker rejects a deliberative note about an open choice",
    tenseCheck("he played e4; it is her turn, her move is not played yet").length > 0);
  ok("checker accepts a settled note",
    tenseCheck("he played e4; she answered Nf6; her move is already on the board, his turn now").length === 0,
    JSON.stringify(tenseCheck("he played e4; she answered Nf6; her move is already on the board, his turn now")));
}

// ══════════════════════════════════════════════════════════════════════════
// 2. THE THINK-TIME TABLE
// ══════════════════════════════════════════════════════════════════════════

{
  // Bounded for EVERY input, including nonsense — the floor is the assertion
  // the owner's "milliseconds after his" turns on, and it may not be reachable
  // by any combination of modifiers.
  let lo = Infinity, hi = -Infinity;
  for (const ply of [0, 1, 4, 7, 8, 20, 29, 30, 60, 200]) {
    for (const lmc of [0, 1, 2, 12, 13, 30, 38, 60]) {
      for (const inCheck of [true, false]) {
        for (const recapture of [true, false]) {
          for (const book of [true, false]) {
            for (const seed of [0, SEED, -1, 2 ** 31]) {
              const ms = chessThinkMs({ fen: `f${ply}${lmc}${seed}`, ply, legalMoveCount: lmc, inCheck, recapture, book, seed });
              lo = Math.min(lo, ms); hi = Math.max(hi, ms);
            }
          }
        }
      }
    }
  }
  ok("no chess think time is ever below the floor", lo >= THINK_FLOOR_MS, `min ${lo}`);
  ok("…nor above the ceiling", hi <= THINK_CEIL_MS, `max ${hi}`);
  ok("…and the floor is a real human beat, not a token one", THINK_FLOOR_MS >= 300, `${THINK_FLOOR_MS}`);

  let tlo = Infinity, thi = -Infinity;
  for (const key of ["........." , "x.o.x.o.x", "xxoo.....", "xoxoxoxo."]) {
    for (const ply of [0, 1, 5, 8]) {
      for (const obvious of [true, false]) {
        for (const seed of [0, SEED, 7]) {
          const ms = tttThinkMs({ key, ply, obvious, seed });
          tlo = Math.min(tlo, ms); thi = Math.max(thi, ms);
        }
      }
    }
  }
  ok("ttt think time is bounded too", tlo >= THINK_FLOOR_MS && thi <= THINK_CEIL_MS, `${tlo}..${thi}`);
  ok("ttt covers the asked 0.5–2s band", THINK_BANDS.ttt[0] === 500 && THINK_BANDS.ttt[1] === 2000);

  // DETERMINISM, not randomness. The same moment twice is the same beat; a
  // different session is a different beat, so she is not a metronome.
  const a = { fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", ply: 1, legalMoveCount: 20, inCheck: false, recapture: false, book: true, seed: SEED };
  eq("same position + same session = same beat", chessThinkMs(a), chessThinkMs(a));
  ok("a different session is not the same metronome",
    new Set([SEED, SEED + 1, SEED + 2, SEED + 3, SEED + 4].map((s) => chessThinkMs({ ...a, seed: s }))).size > 1);
  // Comments in this repo NAME `Math.random` to say why it is not used, so the
  // lint has to read code rather than prose — a grep that cannot tell the two
  // apart would fail on the correct file and pass on a minified wrong one.
  ok("nothing here is Math.random", !usesRandom(readFileSync(join(REPO, "src/state/game.ts"), "utf8")));

  // THE BANDS, as the table declares them. Sampled across many positions so
  // the assertion is about the band and not about one lucky hash.
  const sample = (over) => {
    const out = [];
    for (let i = 0; i < 400; i++) out.push(chessThinkMs({ fen: `p${i}`, seed: SEED + i, ...over }));
    return { min: Math.min(...out), max: Math.max(...out), mean: out.reduce((x, y) => x + y, 0) / out.length };
  };
  const book = sample({ ply: 2, legalMoveCount: 20, inCheck: false, recapture: false, book: true });
  ok("opening book moves are quick", book.min >= THINK_BANDS.chess_book[0] && book.max <= THINK_BANDS.chess_book[1], JSON.stringify(book));
  const mid = sample({ ply: 16, legalMoveCount: 30, inCheck: false, recapture: false, book: false });
  ok("the middlegame costs real time", mid.min >= THINK_BANDS.chess_middle[0] && mid.max <= THINK_BANDS.chess_middle[1], JSON.stringify(mid));
  ok("…and the middlegame is slower than the book", mid.mean > book.mean * 1.5, `${mid.mean} vs ${book.mean}`);
  const forced = sample({ ply: 16, legalMoveCount: 1, inCheck: true, recapture: false, book: false });
  ok("a forced reply is nearly instant", forced.max <= THINK_BANDS.chess_forced[1], JSON.stringify(forced));
  ok("…but still not instant", forced.min >= THINK_FLOOR_MS, JSON.stringify(forced));
  const check = sample({ ply: 16, legalMoveCount: 6, inCheck: true, recapture: false, book: false });
  ok("answering a check is faster than a free middlegame move", check.mean < mid.mean, `${check.mean} vs ${mid.mean}`);
  const recap = sample({ ply: 16, legalMoveCount: 30, inCheck: false, recapture: true, book: false });
  ok("a recapture is faster than a decision", recap.mean < mid.mean, `${recap.mean} vs ${mid.mean}`);
  const wide = sample({ ply: 16, legalMoveCount: 42, inCheck: false, recapture: false, book: false });
  ok("a wide-open position takes longer", wide.mean > mid.mean, `${wide.mean} vs ${mid.mean}`);
  const tttObv = Array.from({ length: 200 }, (_, i) => tttThinkMs({ key: `k${i}`, ply: 4, obvious: true, seed: SEED + i }));
  const tttOpen = Array.from({ length: 200 }, (_, i) => tttThinkMs({ key: `k${i}`, ply: 4, obvious: false, seed: SEED + i }));
  const mean = (xs) => xs.reduce((a2, b) => a2 + b, 0) / xs.length;
  ok("a forced ttt block is seen instantly", mean(tttObv) < mean(tttOpen), `${mean(tttObv)} vs ${mean(tttOpen)}`);
}

// ══════════════════════════════════════════════════════════════════════════
// 3. THE OWNER'S CASE, AS A PERMANENT FIXTURE
//
// "Playing chess on a call, she made her move milliseconds after his, then
// 2-3 seconds later her voice said she SHOULD make the move she had already
// made."
//
// Replayed through the real engine: he opens e4, she is black. Three claims,
// in the order they have to be true in.
// ══════════════════════════════════════════════════════════════════════════

{
  const herSide = "b";
  // ── his move lands ──────────────────────────────────────────────────────
  const afterHis = replay(["e4"]);
  ok("owner-case: his move is on the board", !!afterHis && afterHis.played.length === 1);
  eq("owner-case: it is now her turn", turnPhase({ kind: "chess", game: afterHis, herSide, startedAt: SEED }), "thinking");

  // ── SHE THINKS. The bound is asserted on the same function the component
  //    calls, not on a copy of its formula.
  const think = thinkFor(afterHis, herSide, "f6");
  ok("owner-case: her move is HELD, never instant", think >= THINK_FLOOR_MS, `${think}ms`);
  ok("owner-case: …and inside the opening band", think >= THINK_BANDS.chess_book[0] && think <= THINK_BANDS.chess_book[1], `${think}ms`);
  ok("owner-case: …which is a beat a person would read as thinking", think >= 700, `${think}ms`);
  // The board must have finished DRAWING his move before she can be thinking
  // about it, and her hold clears that on its own.
  ok("owner-case: her hold outlasts the board animation", think > MOVE_ANIM_MS, `${think} vs ${MOVE_ANIM_MS}`);

  // ── her move lands ──────────────────────────────────────────────────────
  const afterHers = play(afterHis, "Nf6");
  ok("owner-case: her move landed", !!afterHers && afterHers.played.length === 2);
  eq("owner-case: the choice is now closed", turnPhase({ kind: "chess", game: afterHers, herSide, startedAt: SEED }), "his_turn");

  // ── and only THEN does anything speak ───────────────────────────────────
  // Exactly the note the call lane builds at the seam: the exchange, then the
  // state of the choice, both read off the position AFTER her move.
  const hisPly = afterHers.played[0];
  const his = assessMove(hisPly.fenBefore, hisPly, hisPly.fenAfter);
  const hers = assessLast(afterHers);
  // THE REAL COMPOSER — the same function the call lane sends through, not a
  // re-assembly of its parts here. A fixture that rebuilds the note itself
  // proves the eval can spell, not that the product can.
  const note = chessMoveNote(afterHers, herSide, his, hers, "her");
  const fact = exchangeFact(his, hers, herSide);

  eq("owner-case: the line is tense-clean", tenseCheck(note), []);
  ok("owner-case: it names her move as DONE", /she answered Nf6/.test(note), note);
  ok("owner-case: it says the choice is closed", /already on the board/.test(note), note);
  ok("owner-case: it never says she should play anything", !/should/i.test(note), note);

  // ── THE NEGATIVE CONTROL ────────────────────────────────────────────────
  // The pre-fix note is the same text without the settled clause. It is past
  // tense and it is exactly what shipped when the owner heard the defect, so
  // the checker MUST reject it — otherwise this whole file is asserting
  // nothing and would pass on the broken build.
  ok("negative control: the pre-fix note is REJECTED", tenseCheck(fact).length > 0, fact);
  ok("…for the right reason", tenseCheck(fact).includes("choice not stated closed"), JSON.stringify(tenseCheck(fact)));
}

// ══════════════════════════════════════════════════════════════════════════
// 4. STALENESS: a line drafted at ply N, delivered at ply N+2
// ══════════════════════════════════════════════════════════════════════════

{
  const herSide = "b";
  const atN = replay(["e4", "e5"]);                       // ply 2
  const atN1 = play(atN, "Nf3");                          // ply 3
  const atN2 = play(atN1, "Nc6");                         // ply 4
  const sess = (g) => ({ kind: "chess", game: g, herSide, startedAt: SEED });

  eq("the stamp is the ply", gamePly(sess(atN)), 2);
  ok("a note delivered at its own ply is fresh", !noteIsStale(2, sess(atN)));
  ok("a note drafted at N is STALE at N+1", noteIsStale(2, sess(atN1)));
  ok("…and at N+2", noteIsStale(2, sess(atN2)));
  ok("a note is stale against no game at all", noteIsStale(2, null));
  ok("…and against a game that closed under it", noteIsStale(2, { ...sess(atN), closedAt: SEED + 1000 }));
  // A takeback moves the count BACKWARDS, which is also not the position the
  // note was written for.
  ok("a note is stale against a rewound board", noteIsStale(4, sess(atN)));

  // ttt and wyr ride the same stamp — one seam, every activity kind.
  let t = newTttGame();
  t = playTtt(t, 4);
  eq("ttt stamps its own plies", gamePly({ kind: "ttt", game: t, herSide: "o", startedAt: SEED }), 1);
  const t2 = playTtt(t, 0);
  ok("ttt notes go stale the same way", noteIsStale(1, { kind: "ttt", game: t2, herSide: "o", startedAt: SEED }));
  eq("wyr stamps answered rounds", gamePly({ kind: "wyr", rounds: [1, 2, 3], seen: [], salt: "s", startedAt: SEED }), 3);
}

// ══════════════════════════════════════════════════════════════════════════
// 5. THE LIVE LANE'S NOTE — carries the current board and her move as done
// ══════════════════════════════════════════════════════════════════════════

{
  const herSide = "b";
  // Every position in a real game where she has just moved: the note must be
  // settled, tense-clean, and never mention a pending choice of hers.
  const line = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Nxd5", "Nxf7", "Kxf7"];
  let g = newGame();
  let checked = 0;
  for (const san of line) {
    g = play(g, san);
    const mover = g.played[g.played.length - 1].by;
    const s = settledClause(g, herSide);
    if (mover === herSide) {
      // she just moved — the choice is closed and the note says so
      ok(`settled after her ${san}`, /already on the board/.test(s), s);
      const hers = assessLast(g);
      const hisPly = g.played[g.played.length - 2];
      const fact = hisPly
        ? exchangeFact(assessMove(hisPly.fenBefore, hisPly, hisPly.fenAfter), hers, herSide)
        : moveFact(hers, herSide, "her");
      const note = [fact, s].filter(Boolean).join("; ");
      eq(`tense-clean after her ${san}`, tenseCheck(note), []);
      checked++;
    } else {
      // his move: the open branch is REACHABLE in the type but must never be
      // what the call lane sends — the poke fires on a completed exchange.
      ok(`open after his ${san}`, /her move is not played yet/.test(s), s);
    }
  }
  ok("every one of her moves in the line was checked", checked === 6, `${checked}`);

  // A finished game closes the choice by itself and must not also carry the
  // turn clause — "her move is already on the board" over a checkmate is a
  // board contradicting its own result.
  const mated = replay(["f3", "e5", "g4", "Qh4"]);
  ok("a finished game needs no turn clause", settledClause(mated, "w") === "", settledClause(mated, "w"));
  const endNote = moveFact(assessLast(mated), "w", "him");
  eq("…and the ending note is tense-clean on its own", tenseCheck(endNote), [], endNote);

  // No bracket-shaped metadata may reach this lane: bracket text on the live
  // socket gets SPOKEN (`ack-bracket-direction`). The ply stamp is therefore
  // internal, and this asserts the words layer never smuggles one in.
  const g2 = replay(["e4", "c5"]);
  const n2 = [exchangeFact(assessMove(g2.played[0].fenBefore, g2.played[0], g2.played[0].fenAfter), assessLast(g2), "b"), settledClause(g2, "b")].join("; ");
  ok("the note carries no square brackets", !/[[\]]/.test(n2), n2);
  ok("…and no ply number", !/\bply\b/i.test(n2), n2);
}

// ══════════════════════════════════════════════════════════════════════════
// 6. A WHOLE GAME — timing and tense on EVERY one of her turns
//
// Her real moves, from the real opponent at the strength the surface picks,
// against a legal opponent. Every turn of hers gets both assertions, so this
// is a walk over the actual distribution rather than four hand-picked spots.
// ══════════════════════════════════════════════════════════════════════════

{
  const herSide = "b";
  let g = newGame();
  let herTurns = 0;
  let fastest = Infinity;
  let slowest = 0;
  let staleFound = 0;
  for (let i = 0; i < 60 && !g.status.over; i++) {
    if (g.status.turn === herSide) {
      // HER TURN: the hold is computed BEFORE the move is chosen, from the
      // position she is thinking in — which is the ordering the component
      // uses and the ordering the whole fix depends on.
      const moves = legalMoves(g.fen);
      const pick = moves[(i * 7 + 3) % moves.length];
      const ms = thinkFor(g, herSide, pick.to);
      ok(`her-turn ${herTurns}: held`, ms >= THINK_FLOOR_MS && ms <= THINK_CEIL_MS, `${ms}ms`);
      fastest = Math.min(fastest, ms); slowest = Math.max(slowest, ms);
      const before = gamePly({ kind: "chess", game: g, herSide, startedAt: SEED });
      g = play(g, pick.uci ?? { from: pick.from, to: pick.to, promotion: pick.promotion });
      herTurns++;
      // the note, drafted after the move — tense-checked every single turn
      const hers = assessLast(g);
      const hisPly = g.played.length >= 2 ? g.played[g.played.length - 2] : null;
      const fact = hisPly
        ? exchangeFact(assessMove(hisPly.fenBefore, hisPly, hisPly.fenAfter), hers, herSide)
        : moveFact(hers, herSide, "her");
      const note = [fact, settledClause(g, herSide)].filter(Boolean).join("; ");
      if (!g.status.over) eq(`her-turn ${herTurns}: tense-clean`, tenseCheck(note), [], note);
      // and the stamp taken before her move is stale the instant it lands
      if (noteIsStale(before, { kind: "chess", game: g, herSide, startedAt: SEED })) staleFound++;
    } else {
      const moves = legalMoves(g.fen);
      const pick = moves[(i * 5 + 1) % moves.length];
      g = play(g, pick.uci ?? { from: pick.from, to: pick.to, promotion: pick.promotion });
    }
  }
  ok("the game walk covered real turns", herTurns >= 20, `${herTurns}`);
  ok("…across a real spread of think times", slowest - fastest > 1000, `${fastest}..${slowest}`);
  ok("…and every pre-move stamp was stale after the move", staleFound === herTurns, `${staleFound}/${herTurns}`);

  // ttt, the same walk. Her real opponent, the real hold.
  let t = newTttGame();
  let tTurns = 0;
  const herMark = "o";
  for (let i = 0; i < 9 && !t.status.over; i++) {
    if (t.status.turn === herMark) {
      const key = t.board.map((c) => c ?? ".").join("");
      const empties = t.board.filter((c) => !c).length;
      const ms = tttThinkMs({ key, ply: t.played.length, obvious: empties <= 1, seed: SEED });
      ok(`ttt her-turn ${tTurns}: held`, ms >= THINK_FLOOR_MS && ms <= THINK_CEIL_MS, `${ms}ms`);
      const cell = herTttMove(t);
      t = playTtt(t, cell);
      tTurns++;
      // THE REAL COMPOSER, same as chess above — a walk that rebuilds the note
      // by hand would keep passing after the product stopped composing it.
      const note = tttMoveNote(t, herMark, "her");
      if (!t.status.over) {
        eq(`ttt her-turn ${tTurns}: tense-clean`, tenseCheck(note), [], note);
        ok(`ttt her-turn ${tTurns}: says the choice is closed`, /already taken/.test(note), note);
        // and the negative control, every turn: the bare fact must be rejected
        ok(`ttt her-turn ${tTurns}: bare fact would be rejected`,
          tenseCheck(tttMoveFact(t, "her")).includes("choice not stated closed"), note);
      }
    } else {
      const free = t.board.map((c, ix) => (c ? -1 : ix)).filter((ix) => ix >= 0);
      t = playTtt(t, free[0]);
    }
  }
  ok("the ttt walk covered real turns", tTurns >= 2, `${tTurns}`);
}

// ══════════════════════════════════════════════════════════════════════════
// 7. THE SEND SEAM, as a decision
//
// `noteVerdict` is the seam. It is a pure function precisely so that its three
// outcomes are reachable from here instead of only from a running browser with
// a live socket and a game in progress — which is to say, only from the owner's
// ears, which is how this defect was found in the first place.
// ══════════════════════════════════════════════════════════════════════════

{
  const herSide = "b";
  const atN = replay(["e4", "e5", "Nf3"]);
  const atN1 = play(atN, "Nc6");
  const sess = (g) => ({ kind: "chess", game: g, herSide, startedAt: SEED });

  eq("seam: current board, quiet room → send", noteVerdict(3, sess(atN), false), "send");
  eq("seam: board moved → STALE, dropped not delayed", noteVerdict(3, sess(atN1), false), "stale");
  eq("seam: she is mid-sentence → hold and re-draft", noteVerdict(3, sess(atN), true), "hold");
  // Order matters and it is not arbitrary: a stale note is dropped even while
  // she is speaking. Holding it would only make it staler, and it describes a
  // position that no longer exists either way.
  eq("seam: stale beats hold", noteVerdict(3, sess(atN1), true), "stale");
  eq("seam: no game at all is stale", noteVerdict(3, null, false), "stale");
  eq("seam: a closed game is stale", noteVerdict(3, { ...sess(atN), closedAt: SEED + 1 }, false), "stale");
}

// ══════════════════════════════════════════════════════════════════════════
// 8. THE WIRING, asserted over the SOURCE
//
// Everything above is behavioural. What no test that runs today's code can
// see is a FUTURE edit that routes around it — the same reasoning
// evals/notify.mjs states for its call-site lint. Four properties:
//
//   (a) the game-note path reaches the socket ONLY through the stamped seam,
//       so a fourth activity kind cannot get a raw `direct()` by copying its
//       neighbour;
//   (b) the seam's decision is the pure function above, not a re-implementation
//       of it at the call site;
//   (c) the note text is composed by the words layer, so the closed-choice
//       clause cannot be dropped by an edit to this file;
//   (d) the debounce clears the board animation, and no board component holds a
//       move on an unseeded random.
// ══════════════════════════════════════════════════════════════════════════

{
  const engine = decomment(readFileSync(join(REPO, "src/components/useCallEngine.ts"), "utf8"));
  const seamAt = engine.indexOf("const sendGameNote =");
  const start = engine.indexOf("useEffect(() => {", seamAt);
  const end = engine.indexOf("const mmss =", start);
  ok("the send seam exists", seamAt > 0 && start > seamAt && end > start);
  const helper = engine.slice(seamAt, start);
  const region = engine.slice(start, end);

  ok("(a) the poke effect never reaches the socket itself",
    !/liveSession\.current\.direct\(/.test(region), region.match(/liveSession\.current\.direct\([^)]*\)/g)?.join(" | "));
  ok("…and every note it sends goes through the seam",
    (region.match(/sendGameNote\(/g) || []).length >= 3);

  ok("(b) the seam decides with the pure verdict",
    /noteVerdict\(\s*draftedAtPly,\s*stateRef\.current\.game,\s*speakingRef\.current\s*\)/.test(helper), helper);
  ok("…and sends on nothing but a clean verdict",
    /if \(verdict !== "send"\)/.test(helper) && /if \(verdict === "hold"\) retry\(\)/.test(helper), helper);
  ok("…and the drop reason reaches diag, so a silent seam is visible",
    /dropped: verdict/.test(helper), helper);

  ok("(c) chess notes are composed by the words layer",
    /sendGameNote\(\s*cur\.kind,\s*plies,\s*chessMoveNote\(/.test(region), region);
  ok("…and ttt notes too",
    /sendGameNote\(cur\.kind, at, tttMoveNote\(/.test(region), region);
  ok("…so this file cannot compose a note without the closed-choice clause",
    !/settledClause\(/.test(region) && !/exchangeFact\(/.test(region) && !/moveFact\(/.test(region), region);
  // NEVER REPLAYS survives the seam. `pokedPly` marks an exchange CONSIDERED
  // where it always did — before the salience drop, not at the send — because
  // the seam's re-draft re-arms the timer and reads the live board when it
  // fires, so it never consults the counter. Deferring the counter to the send
  // (which this workstream tried) leaves it behind whenever a note is dropped,
  // and any later state write then walks her back through an exchange she has
  // already seen. Asserted on every kind, since each has its own branch.
  ok("…and every kind still marks its exchange considered",
    (region.match(/pokedPly\.current = (plies|at);/g) || []).length >= 3,
    region.match(/pokedPly\.current = [^;]*;/g)?.join(" | "));
  // WS-TTT gave ttt its own salience gate, so there are now TWO `quiet_move`
  // drops in this region and a single `indexOf` compares the chess counter
  // against the ttt drop — a true property, asserted by an expression that
  // stopped meaning it. Checked per drop instead: every branch that can pass
  // on a move must already have marked its exchange considered.
  ok("…and does so before the salience drop, not at the send",
    (() => {
      const quiet = [...region.matchAll(/dropped: "quiet_move"/g)].map((m) => m.index);
      return (
        quiet.length >= 2 &&
        quiet.every((i) => /pokedPly\.current = (plies|at);/.test(region.slice(0, i)))
      );
    })(),
    `${(region.match(/dropped: "quiet_move"/g) || []).length} salience drops`);

  const pokeMs = Number(/const MOVE_POKE_MS = (\d+)/.exec(engine)?.[1]);
  ok("(d) the poke waits out the board animation", pokeMs >= MOVE_ANIM_MS, `${pokeMs} vs ${MOVE_ANIM_MS}`);

  for (const f of ["src/components/ChessActivity.tsx", "src/components/TicTacToeActivity.tsx"]) {
    const src = readFileSync(join(REPO, f), "utf8");
    ok(`${f} holds her move on a seeded beat`, /ThinkMs\(/.test(src), f);
    ok(`…and never on Math.random`, !usesRandom(src), f);
  }
}

console.log(fail ? `${fail} FAILURES of ${count}` : `ALL ${count} PASS`);
process.exit(fail ? 1 : 0);
