// The ttt rules + opponent + talk layer (src/engine/ttt/, src/engine/tttTalk.ts),
// against the CURRENT source. Standalone:  node evals/ttt.mjs
//
// Bundles the real TypeScript itself, the same way evals/chess.mjs does and
// for the same reason CLAUDE.md gives about parsetest.v2: a frozen bundle
// passes forever while the source rots. Not wired into evals/run.mjs for the
// same reason chess.mjs names at its own bottom — this workstream owns
// src/engine/ttt/, src/engine/tttTalk.ts and this file, and evals/run.mjs
// belongs to another. See this file's own note at the bottom for the one-line
// diff that wires it in.
//
// ── the weighting, and why ─────────────────────────────────────────────────
//
// Two things matter more than the rest put together:
//   1. SHE MUST NEVER PLAY AN OCCUPIED CELL, and must never be asked to move
//      once the game is over. The legality section runs her across every
//      reachable board (all ~5,478 of them fit easily), every strength, and
//      several seeds each.
//   2. THE IMPERFECTION MUST BE BOUNDED, NOT DECORATIVE. A companion that
//      never loses is not fun; a companion that plays like she's mashing
//      buttons is not a companion. The enumeration section plays her out
//      against an INDEPENDENT perfect-play referee (not the engine's own
//      minimax — a second implementation, so the measurement is not the
//      engine grading its own homework) and checks her loss rate sits
//      strictly between "never" and "about what uniform-random play would
//      lose".

import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const OUT = mkdtempSync(join(tmpdir(), "ttteval-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(join(REPO, "src/engine/ttt/index"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/engine/tttTalk"))};\n`,
);
const BUNDLE = join(OUT, "ttt.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { cwd: REPO, stdio: "inherit" },
);
const C = await import(pathToFileURL(BUNDLE).href);

// `.join("")` on a sparse board is LOSSY — `[null,"x",null].join("")` and
// `["x",null,null].join("")` both come out `"x"`, because `join` renders
// `null`/`undefined` as `""` rather than as a placeholder. Every board-derived
// cache/dedup key in this file goes through this instead, for the same
// reason `opponent.ts`'s own `rngFor`/`outcome` memo keys map null to `"."`.
const boardKey = (b) => b.map((c) => c ?? ".").join("");

// ── an INDEPENDENT referee ───────────────────────────────────────────────
//
// A second, hand-written minimax that never calls anything in the bundle.
// Sections 4 and 6 both play her out against it, so "she never loses at full
// strength" and "her loss rate is bounded" are measured against ground
// truth, not against the engine's own opinion of itself.
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
const winnerOf = (b) => {
  for (const [a, x, y] of LINES) if (b[a] && b[a] === b[x] && b[a] === b[y]) return b[a];
  return null;
};
const refMemo = new Map();
function refOutcome(board, turn) {
  if (winnerOf(board)) return -1; // terminal BEFORE turn moves: the other side just won
  if (board.every((c) => c !== null)) return 0;
  const key = boardKey(board) + turn;
  const cached = refMemo.get(key);
  if (cached !== undefined) return cached;
  const opp = turn === "x" ? "o" : "x";
  let best = -1;
  for (let i = 0; i < 9 && best !== 1; i++) {
    if (board[i]) continue;
    const nb = board.slice();
    nb[i] = turn;
    const v = refOutcome(nb, opp);
    const val = v === -1 ? 1 : v === 1 ? -1 : 0;
    if (val > best) best = val;
  }
  refMemo.set(key, best);
  return best;
}
function refBestMoves(board, turn) {
  const opp = turn === "x" ? "o" : "x";
  const scored = [];
  for (let i = 0; i < 9; i++) {
    if (board[i]) continue;
    const nb = board.slice();
    nb[i] = turn;
    const v = refOutcome(nb, opp);
    scored.push({ i, score: v === -1 ? 1 : v === 1 ? -1 : 0 });
  }
  const best = Math.max(...scored.map((s) => s.score));
  return scored.filter((s) => s.score === best).map((s) => s.i);
}

/** She plays `myMark` throughout; the referee plays the other mark and
 *  always branches over EVERY move that is truly optimal for it (never just
 *  one), so a tally is a fraction of the whole enumerated tree, not one
 *  line through it. `branchMine` lets the same walker serve a deterministic
 *  engine choice (a singleton array) or a uniform-random baseline (every
 *  legal cell). */
function tally(myMark, branchMine) {
  const t = { win: 0, draw: 0, loss: 0, leaves: 0 };
  function rec(game) {
    if (game.status.over) {
      t.leaves++;
      if (game.status.result === "draw") t.draw++;
      else if (game.status.winner === myMark) t.win++;
      else t.loss++;
      return;
    }
    if (game.status.turn === myMark) {
      for (const cell of branchMine(game)) rec(C.playTtt(game, cell));
    } else {
      for (const cell of refBestMoves(game.board, game.status.turn)) rec(C.playTtt(game, cell));
    }
  }
  rec(C.newTttGame());
  return t;
}

let fail = 0;
let count = 0;
const ok = (name, cond, extra = "") => {
  count++;
  if (!cond) {
    fail++;
    console.log(`FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};

// ═══ 1. exhaustive legality + game-over-awareness ══════════════════════════
//
// Every reachable position, both marks, three strengths, several seeds each.
// The whole tree is ~5,478 unique boards, so "exhaustive" here really means
// exhaustive rather than a sample.
{
  let visited = 0;
  const seen = new Set();
  const strengths = [1, 2, 3, { level: 2, seed: 1 }, { level: 1, seed: 7 }, { level: 3, seed: 42 }];

  function walk(game) {
    const key = boardKey(game.board) + game.status.turn;
    if (seen.has(key)) return;
    seen.add(key);
    visited++;

    if (game.status.over) {
      for (const s of strengths) {
        ok(`no move offered on a finished game (${JSON.stringify(s)})`, C.herTttMove(game, { strength: s }) === null);
      }
      return;
    }

    for (const s of strengths) {
      const cell = C.herTttMove(game, { strength: s });
      ok(
        `her move is a real cell (${JSON.stringify(s)})`,
        Number.isInteger(cell) && cell >= 0 && cell <= 8,
        String(cell),
      );
      ok(
        `her move lands on an empty cell (${JSON.stringify(s)})`,
        cell !== null && game.board[cell] === null,
        `board=${boardKey(game.board)} cell=${cell}`,
      );
    }

    for (const cell of C.legalCells(game)) {
      const next = C.playTtt(game, cell);
      ok(`playTtt succeeds on a legal cell`, next !== null, `cell=${cell}`);
      if (next) walk(next);
    }
  }
  walk(C.newTttGame());

  ok("visited the whole reachable tree (sanity floor)", visited > 1000, String(visited));
  console.log(`  (legality: ${visited} unique board+turn states visited)`);
}

// ── playTtt refuses what it must ───────────────────────────────────────────
{
  let g = C.newTttGame();
  g = C.playTtt(g, 4);
  ok("occupied cell refused", C.playTtt(g, 4) === null);
  ok("out-of-range cell refused", C.playTtt(g, 9) === null && C.playTtt(g, -1) === null);
  ok("non-integer cell refused", C.playTtt(g, 1.5) === null);
}

// ═══ 2. determinism ═════════════════════════════════════════════════════════
{
  let g = C.newTttGame();
  for (const cell of [0, 4, 1]) g = C.playTtt(g, cell);
  const a = C.herTttMove(g, { strength: 1 });
  const b = C.herTttMove(g, { strength: 1 });
  ok("same board + same strength -> same move twice", a === b, `${a} vs ${b}`);
  const c = C.herTttMove(g, { strength: { level: 1, seed: 99 } });
  const d = C.herTttMove(g, { strength: { level: 1, seed: 99 } });
  ok("a fixed seed is reproducible", c === d, `${c} vs ${d}`);
}

// ═══ 3. forced tactics are taken, concretely ════════════════════════════════
{
  // o _ x / o _ _ / _ x _  — x to move (x played 3, then 7; o played 0, then
  // 1). o threatens cell 2 (completing the top row); x's own cells 3 and 7
  // share no line, so x has NO win of its own here — this is a pure block,
  // unlike a naive "o o _ / x x _" fixture where x would also have its own
  // immediate win and should take THAT instead (tier 1 beats tier 2 on
  // purpose — see opponent.ts).
  let g = C.newTttGame();
  for (const cell of [3, 0, 7, 1]) g = C.playTtt(g, cell); // x:3,7  o:0,1
  ok("setup: x to move", g.status.turn === "x");
  ok("setup: x has no win of its own", C.winningCells(g.board, "x").length === 0);
  ok("setup: o threatens cell 2", C.winningCells(g.board, "o").includes(2));
  for (const level of [1, 2, 3]) {
    // level 1 has a small missBlockChance; force it off for this determinism
    // check with an explicit override, then check the level-1 DEFAULT
    // separately via the enumeration section instead of here.
    const cell = C.herTttMove(g, { strength: { level, missBlockChance: 0 } });
    ok(`L${level} blocks the only threat`, cell === 2, String(cell));
  }
}
{
  // x x _ / o o _ / _ _ _  — x to move, x can win at cell 2 immediately.
  let g = C.newTttGame();
  for (const cell of [0, 3, 1, 4]) g = C.playTtt(g, cell); // x:0,1  o:3,4
  ok("setup: x can win at 2", C.winningCells(g.board, "x").includes(2));
  for (const level of [1, 2, 3]) {
    const cell = C.herTttMove(g, { strength: { level, missWinChance: 0 } });
    ok(`L${level} takes the immediate win`, cell === 2, String(cell));
  }
}

// ═══ 4. a fully-optimal her never loses, exhaustively ═══════════════════════
//
// Tic-tac-toe is a SOLVED game: with optimal play by both sides the result is
// always a draw, from any legal position, regardless of who opens or which
// square they open on. So a `herTttMove` forced to the "optimal" tier every
// time it isn't already forced by an immediate tactic (`optimalChance: 1`,
// `missWinChance`/`missBlockChance: 0`) must never lose a single enumerated
// leaf against the independent referee's every optimal reply, from either
// side of the board. This is ground truth (a documented property of the
// game itself, not of this codebase) and it is exhaustive, not sampled.
{
  const forced = { optimalChance: 1, missWinChance: 0, missBlockChance: 0 };
  const asX = tally("x", (game) => [C.herTttMove(game, { strength: { level: 3, seed: 1, ...forced } })]);
  const asO = tally("o", (game) => [C.herTttMove(game, { strength: { level: 3, seed: 2, ...forced } })]);
  ok("a fully-optimal her never loses as x", asX.leaves > 0 && asX.loss === 0, JSON.stringify(asX));
  ok("a fully-optimal her never loses as o", asO.leaves > 0 && asO.loss === 0, JSON.stringify(asO));
}

// ═══ 5. tttTalk: facts pass shapelint ═══════════════════════════════════════
{
  let g = C.newTttGame();
  for (const cell of [4, 0, 1, 3, 7]) g = C.playTtt(g, cell); // x wins column-ish
  const act = C.tttActivity(g, "x", Date.UTC(2026, 7, 21, 12, 0));
  ok("kind is ttt", act.kind === "ttt");
  ok("facts is non-empty", act.facts.length > 0);
  for (const f of act.facts) {
    ok(`fact <=14 words: "${f}"`, f.trim().split(/\s+/).length <= 14);
    ok(`fact not sentence-shaped: "${f}"`, !/^[A-Z][^.?!]*[.?!]$/.test(f));
    ok(
      `fact not first-person: "${f}"`,
      !/^(i\b|i'm\b|main\b|mai\b|mujhe\b|meri\b|mera\b|maine\b)/i.test(f),
    );
  }
  for (const w of ["arre", "yaar", "😭", "nice move", "good luck", "gg"]) {
    ok(`no dialogue: "${w}"`, !act.facts.join(" ").toLowerCase().includes(w));
  }
  // honesty allowlist feed: every played cell's name must be nameable.
  const CELL_NAME = [
    "top left", "top middle", "top right",
    "middle left", "centre", "middle right",
    "bottom left", "bottom middle", "bottom right",
  ];
  for (const m of g.played) {
    ok(`played cell is nameable: ${CELL_NAME[m.cell]}`, act.nameable.includes(CELL_NAME[m.cell]));
  }

  // the per-move fact clause cap
  const mf = C.tttMoveFact(g, "her");
  ok("moveFact is <=3 clauses", mf.split(",").length <= 3, mf);
  ok("moveFact names the cell", /top left|top middle|top right|middle left|centre|middle right|bottom left|bottom middle|bottom right/.test(mf), mf);
}
{
  // draw board: x o x / x o o / o x x
  const board = ["x", "o", "x", "x", "o", "o", "o", "x", "x"];
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  // Built directly rather than via playTtt, since the fixture's mark pattern
  // is not itself a legal alternating sequence — this exercises tttActivity
  // against a HAND-BUILT terminal Game, not a played one.
  const status = C.statusOfBoard(board, "x");
  ok("fixture board is a draw", status.result === "draw", JSON.stringify(status));
  const played = order.map((cell, i) => ({ cell, by: i % 2 === 0 ? "x" : "o" }));
  const drawGame = { board, played, status };
  const act = C.tttActivity(drawGame, "o", Date.UTC(2026, 7, 21, 12, 0));
  ok("draw is reported", act.facts.some((f) => /nobody won/.test(f)), JSON.stringify(act.facts));
}

// ═══ 5b. tttTalk: the DURABLE record ═══════════════════════════════════════
//
// `facts` is the present moment and expires with it; this is what is still
// true next week. Before it existed a finished board left "3 moves in; she is
// playing x; it is his move" in her memory, and the tester's report turned on
// exactly this: he played chess and then tic tac toe, and the only game she
// could still see was the one in the slot.
{
  let g = C.newTttGame();
  for (const cell of [4, 0, 1, 3, 7]) g = C.playTtt(g, cell);
  const rec = C.tttRecord(g, "x");
  ok("the record exists", rec.length > 0, JSON.stringify(rec));
  ok("it says which mark she had, in the PAST", rec.includes("she was x"), JSON.stringify(rec));
  ok("it says who won and in how many", rec.some((f) => /^(she|he) won it in 5 moves$/.test(f)), JSON.stringify(rec));
  ok("and where it opened — the one move anyone recalls", rec.some((f) => /^(she|he) opened in centre$/.test(f)), JSON.stringify(rec));
  for (const f of rec) {
    ok(`record row <=14 words: "${f}"`, f.trim().split(/\s+/).length <= 14);
    ok(`record row not sentence-shaped: "${f}"`, !/^[A-Z][^.?!]*[.?!]$/.test(f));
    ok(`record row not first-person: "${f}"`, !/^(i\b|main\b|mai\b|mujhe\b|maine\b)/i.test(f));
  }
  // the live block must not carry it — a move list in front of a visible board
  const act2 = C.tttActivity(g, "x", 0);
  ok("the activity carries a record", Array.isArray(act2.record) && act2.record.length === rec.length);
  ok("…and the facts are still just the moment", act2.facts.every((f) => !rec.includes(f)), JSON.stringify(act2.facts));
  // an abandoned board says so rather than naming a winner
  let open2 = C.newTttGame();
  open2 = C.playTtt(open2, 0);
  const openRec = C.tttRecord(open2, "o");
  ok("an unfinished board is remembered as unfinished", openRec.some((f) => /^left unfinished after 1 move$/.test(f)), JSON.stringify(openRec));
  ok("…in English, not '1 moves'", !openRec.some((f) => /\b1 moves\b/.test(f)), JSON.stringify(openRec));
  ok("…and names no winner", !openRec.some((f) => /won/.test(f)), JSON.stringify(openRec));
  ok("an untouched board says nothing was played", C.tttRecord(C.newTttGame(), "x").some((f) => /before a move was played/.test(f)));
}

// ═══ 6. the imperfection is bounded — enumerated against the same referee ═══
//
// Reuses the referee and `tally` defined above §1. "She loses SOME of the
// time, but far less than random play would" is measured against ground
// truth, not against the engine's own opinion of itself — and each level's
// leaf count is logged rather than assumed equal: her own choices steer the
// game into different continuations at different levels, so the enumerated
// trees are legitimately different sizes, not a bug to assert away.
{
  const her = (level) => tally("o", (game) => [C.herTttMove(game, { strength: level })]);
  const random = tally("o", (game) => C.legalCells(game));

  const L1 = her(1);
  const L2 = her(2);
  const L3 = her(3);
  const rate = (t) => t.loss / t.leaves;

  console.log(
    `  (loss rate vs a perfect opponent — L1: ${(rate(L1) * 100).toFixed(1)}% (n=${L1.leaves}), ` +
      `L2: ${(rate(L2) * 100).toFixed(1)}% (n=${L2.leaves}), L3: ${(rate(L3) * 100).toFixed(1)}% (n=${L3.leaves}), ` +
      `uniform-random: ${(rate(random) * 100).toFixed(1)}% (n=${random.leaves}))`,
  );

  ok("every level's tree was actually enumerated", L1.leaves > 0 && L2.leaves > 0 && L3.leaves > 0 && random.leaves > 0);

  // She is beatable at the easiest level — never zero losses...
  ok("L1 loses SOME enumerable fraction to a perfect player", L1.loss > 0);
  // ...but bounded, not collapsed: meaningfully better than ignoring the
  // board entirely. This is the "never at 'plays randomly' level"
  // requirement, checked as a real inequality against a real random
  // baseline — measured at ~58% vs ~89% (2026-08-21, n above) — rather than
  // asserted as a number nobody re-derived.
  ok("L1 loses meaningfully less than uniform-random play", rate(L1) < rate(random) * 0.8, `${rate(L1)} vs ${rate(random)}`);
  // Higher levels must not be WORSE than lower ones.
  ok("L2 is no worse than L1", rate(L2) <= rate(L1) + 1e-9, `${rate(L2)} vs ${rate(L1)}`);
  ok("L3 is no worse than L2", rate(L3) <= rate(L2) + 1e-9, `${rate(L3)} vs ${rate(L2)}`);
  // The top level should be well past halfway to solid, without the brief
  // demanding literal perfection from it (that is §4's job, at optimalChance 1).
  ok("L3 loses well under half as often as L1", rate(L3) < rate(L1) * 0.5, `${rate(L3)} vs ${rate(L1)}`);
  // Random play must actually be bad, or the comparison above is vacuous.
  ok("uniform-random play is clearly the worst of the four", rate(random) > rate(L1), `${rate(random)} vs ${rate(L1)}`);
}

console.log(fail ? `${fail} FAILURES of ${count}` : `ALL ${count} PASS`);
process.exit(fail ? 1 : 0);

// ── why this is not in evals/run.mjs ────────────────────────────────────────
//
// Same reason chess.mjs gives at its own bottom: this workstream owns exactly
// src/engine/ttt/, src/engine/tttTalk.ts and this file, and evals/run.mjs
// belongs to the coordinator. The one-line change is in the report
// (`ttt: "ttt.mjs"` in the `suites` map); this file is standalone and needs
// nothing else to run in CI once that lands.
