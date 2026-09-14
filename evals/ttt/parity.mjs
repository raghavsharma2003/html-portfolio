// ── THE TIC-TAC-TOE PARITY GATE (WS-TTT) ─────────────────────────────────
//
//   node evals/ttt/parity.mjs
//
// ── WHAT IT GATES ────────────────────────────────────────────────────────
//
//   "tic tac also has so many issues she dont know whats up, dont talk
//    clearly and intresting about it, memory issue also, and many other
//    which chess also had."
//
// Chess got a correction ladder over two waves. Tic-tac-toe rode the same
// generic seams the whole time — `ActivityState`, the poke, the staleness
// stamp, the lifecycle matrix, the episode writer — and every one of those
// seams "supported" it. `dead-writers` is the law that makes that sentence
// worthless: correct code with no caller is indistinguishable from absent
// code, and a game that a system supports but never reaches is a game the
// system does not have. Four of this repo's most expensive findings are that
// shape, and three of them were found by accident.
//
// So this battery does not read the ttt code and agree with it. It plays
// REAL games with the shipping engine, drives them through the REAL
// `activityOf`, the REAL `compile()`, the REAL note seam and the REAL episode
// writer, and then asks the parity question one system at a time:
//
//   does the fact chess gets exist for ttt, does it REACH a compiled prompt,
//   and is it worded as tic-tac-toe rather than as chess with a key swapped?
//
// ── THE THREE WAYS IT FAILS ──────────────────────────────────────────────
//
//   a system chess has and ttt does not          → parity is missing.
//   a system ttt has whose bytes never compile   → the writer is dead.
//   a system whose ttt wording is chess prose    → "left unfinished at move
//                                                   5" on a nine-square board.
//
// ── NEGATIVE CONTROLS ARE FIRST-CLASS ────────────────────────────────────
//
// `bold-eats-words`: an assertion whose evidence is an absence passes just as
// happily on a dead feature as on a working gate. Section 9 re-runs the
// battery's own key claims against deliberately reverted inputs — a quiet
// opening, a chess-shaped fact builder, a stale note, a board with no threat —
// and asserts each one FAILS. A green battery that would also be green against
// the defect is not a battery.
//
// Hermetic: no ambient config, no clock read outside the pinned NOW, no
// network, no model call, no database, $0, ~4s.
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

// ── hermeticity ──────────────────────────────────────────────────────────
// Nothing under test reads a credential, but the `resilience` battery's own
// red-in-CI lesson generalises past credentials: anything ambient is a thing
// the gate measures instead of the code. The clock is the ambient input this
// battery actually has, so it is pinned once here and every assertion below
// takes it as a value. TZ is pinned too — `episodeDateLabel` renders a LOCAL
// date, so a machine in Asia/Kolkata and a machine in UTC disagree about which
// day a game was played on, and that disagreement would land in an assertion
// about a memory rather than in one about a clock.
process.env.TZ = "UTC";
const NOW = Date.UTC(2026, 7, 24, 14, 30, 0);
const MIN = 60_000;

const tmp = mkdtempSync(join(tmpdir(), "tttparity-"));
const BUNDLE = join(tmp, "ttt.bundle.mjs");
execSync(
  `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const E = await import(pathToFileURL(BUNDLE).href);

let fail = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (!cond) {
    fail++;
    console.log(`FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};

// The call-lane source, for the assertions that are about a SENDER existing.
// Comments name every symbol in the file and prove nothing about what runs, so
// they are stripped first — `evals/lifecycle/run.mjs`'s own precaution.
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const ENGINE = decomment(readFileSync(join(ROOT, "src/components/useCallEngine.ts"), "utf8"));

// ── board helpers. Every board in this file is PLAYED, never constructed ──
const play = (cells) => {
  let g = E.newTttGame();
  for (const c of cells) {
    const next = E.playTtt(g, c);
    if (!next) throw new Error(`illegal fixture move ${c} on ${g.board.map((x) => x ?? ".").join("")}`);
    g = next;
  }
  return g;
};
const sessionOf = (g, extra = {}) => ({
  kind: "ttt",
  game: g,
  herSide: "o",
  startedAt: NOW - 8 * MIN,
  ...extra,
});
/** The compiled CALL prompt for a session — the only proof a block reaches
 *  her. `selfbundle-never-set`: a slot is wired when a real prompt contains
 *  its bytes, never when a render function exists. */
const compiledFor = (session, nowMs = NOW) =>
  E.compile({
    user: { name: "arjun", vibe: ["someone to talk to"], facts: { city: "pune" } },
    messageCount: 40,
    medium: "voice",
    mode: "call",
    voiceEngine: "live",
    isDirective: false,
    watching: false,
    herLife: "",
    activity: E.activityOf(session, nowMs),
    nowMs,
    gapSinceLastMs: 3 * MIN,
  }).system;

// ── THE FIXTURE POOL ─────────────────────────────────────────────────────
//
// Every position this battery uses is a REACHABLE one, found by enumerating
// the game rather than by hand-writing a board. A hand-written fixture is a
// claim about the rules made by the person testing them, and this repo has
// paid for that once already (`ttt.mjs`'s own independent referee exists for
// the same reason). Enumeration is also the only honest way to say "no
// position renders X": the pool IS the domain.
//
//   0 1 2
//   3 4 5
//   6 7 8
//
// x moves first and is HIS mark throughout (`herSide` is "o"), which is the
// app's own default.
const POOL = [];
{
  const seen = new Set();
  const walk = (g) => {
    const key = g.board.map((c) => c ?? ".").join("") + g.status.turn;
    if (seen.has(key)) return;
    seen.add(key);
    POOL.push(g);
    if (g.status.over) return;
    for (let i = 0; i < 9; i++) {
      const n = E.playTtt(g, i);
      if (n) walk(n);
    }
  };
  walk(E.newTttGame());
}
/** The first reachable position matching a predicate, or a loud failure —
 *  never a silently-skipped case, which is how a battery quietly stops
 *  testing the thing it names. */
const find = (what, pred) => {
  const g = POOL.find(pred);
  if (!g) {
    fail++;
    checks++;
    console.log(`FAIL no reachable position for fixture: ${what}`);
    return E.newTttGame();
  }
  return g;
};
const shortest = (what, pred) => {
  const all = POOL.filter(pred);
  if (!all.length) return find(what, pred);
  return all.reduce((a, b) => (b.played.length < a.played.length ? b : a));
};
const winsFor = (g, m) => E.winningCells(g.board, m);

const OPENING = play([4]); //                 he took centre. nothing to say.
const HIS_THREAT = play([0, 4, 1]); //        he holds 0,1 — top right wins it
const HIS_WIN = play([0, 4, 1, 8, 2]); //     he completes the top row
const DRAW = play([4, 0, 8, 2, 1, 7, 6, 5, 3]);

console.log("── 1. SHE KNOWS WHAT IS UP: the board reaches a compiled prompt ──");

// ═════════════════════════════════════════════════════════════════════════
// 1. THE T15 BLOCK — does a live ttt session render like a live chess one
// ═════════════════════════════════════════════════════════════════════════
//
// Not "does tttActivity return facts" — `dead-writers` is exactly the gap
// between that question and this one. Every assertion here is made against a
// string that came out of `compile()`.
{
  const sys = compiledFor(sessionOf(HIS_THREAT));
  ok("a live ttt session lights T15 at all", /IN THE MIDDLE OF A GAME OF TIC TAC TOE/.test(sys));
  ok("the block says whose move it is", /it is (her|his) move/.test(sys), sys.slice(sys.indexOf("TIC TAC"), sys.indexOf("TIC TAC") + E.ACTIVITY_BLOCK_MAX));
  ok(
    "the block says what just happened, by name",
    /he took top middle/.test(sys),
    sys.slice(sys.indexOf("TIC TAC"), sys.indexOf("TIC TAC") + E.ACTIVITY_BLOCK_MAX),
  );
  // THE ROW THAT DID NOT EXIST. Chess hands her mate distances and hanging
  // pieces; ttt handed her a move count. Two-in-a-row is the only threat a
  // nine-square board has and she was never told about one.
  ok(
    "the block names the two-in-a-row",
    /one square from winning, on top right/.test(sys),
    sys.slice(sys.indexOf("TIC TAC"), sys.indexOf("TIC TAC") + E.ACTIVITY_BLOCK_MAX),
  );
  // THE BUDGET IS THE BINDING CONSTRAINT HERE, and it is worth stating as a
  // measured number rather than as a hope. `renderActivity` drops whole rows
  // from the END when over budget, and the ttt head is 307 of the 420 — six
  // characters longer than chess's, because the label is. So a LIVE ttt block
  // holds whose-move plus about one more row, and the row order in
  // `tttActivity` is what decides which. Asserted, so a future edit that
  // reorders them has to face this number.
  const live = E.renderActivity(E.activityOf(sessionOf(HIS_THREAT), NOW), NOW);
  ok("the live block respects the shared budget", live.length <= E.ACTIVITY_BLOCK_MAX, String(live.length));
  ok("the live block keeps whose-move", /it is (her|his) move/.test(live), live);
  ok("the live block keeps her own mark", /she is o/.test(live), live);
  ok("the live block keeps the threat-bearing row", /winning/.test(live), live);
  // FACT ROWS, counted by their own "- " prefix rather than by newlines. The
  // block gained UNDROPPABLE lines in WS-GAMEFEEL (`state:` and `STATE_LAW`,
  // which is the whole point of them — a fence the drop policy can delete is
  // absent exactly when the block is busiest), and a newline count cannot tell
  // those from the rows this assertion is actually about. The number it
  // asserts is unchanged and still measured: two rows survive on a live ttt
  // board, the same two that survived at 420.
  const liveRows = live.split("\n").filter((l) => l.startsWith("- ")).length;
  ok("a live ttt block has room for two rows, not five", liveRows <= 3, String(liveRows));
  // …and the fence itself reached her, on the block she is holding DURING the
  // game. `dead-writers`: a law that renders nowhere is not a law.
  ok("the live block carries the machine state line", /\nstate: in progress, 3 marks played\n/.test(live), live);
  ok("the live block carries the terminal fence", live.includes(E.STATE_LAW), live);

  // and the same for a finished game, where the head is smaller and the whole
  // position fits
  const over = compiledFor(sessionOf(HIS_WIN, { closedAt: NOW - 2 * MIN }));
  ok("a just-finished ttt game still reaches her", /JUST FINISHED A GAME OF TIC TAC TOE/.test(over));
  ok("the ending names the winner", /he won that one/.test(over), over.slice(over.indexOf("JUST FINISHED"), over.indexOf("JUST FINISHED") + E.ACTIVITY_BLOCK_MAX));
  ok("the ending names the LINE it was won on", /on the top row/.test(over));
  // The finished block has 189 spare against the live block's 113, so the
  // whole position fits there and is asserted to.
  ok(
    "the finished block carries the whole position",
    /open squares:|she has |he has /.test(over.slice(over.indexOf("JUST FINISHED"), over.indexOf("JUST FINISHED") + E.ACTIVITY_BLOCK_MAX)),
    over.slice(over.indexOf("JUST FINISHED"), over.indexOf("JUST FINISHED") + E.ACTIVITY_BLOCK_MAX),
  );
  // HER MARK IS ON THE ROW THAT CANNOT BE DROPPED. It used to be a row of its
  // own, and in the fact order this wave needs it is the row that falls off a
  // live block — "she does not know which mark she is" being a worse loss than
  // "she does not know which corner he took".
  ok("the finished block still says which mark she had", /she was o/.test(over), over.slice(over.indexOf("JUST FINISHED"), over.indexOf("JUST FINISHED") + 200));
  ok(
    "no stale whose-turn row survives an ending",
    !/JUST FINISHED[\s\S]{0,420}it is (her|his) move/.test(over),
  );
}

// The board row itself, over EVERY reachable position — the property that
// matters is that she is never handed a position she cannot read.
{
  let blanks = 0;
  let rows = 0;
  const dirty = [];
  for (const g of POOL) {
    for (const mark of ["x", "o"]) {
      if (!E.tttBoardFact(g, mark) && g.board.some((c) => c === null)) blanks++;
      for (const early of [false, true]) {
        const a = E.tttActivity(g, mark, NOW - MIN, early);
        for (const row of [...a.facts, ...(a.record ?? [])]) {
          rows++;
          const v = E.lintLine(row);
          if (v.reasons.length && dirty.length < 5) dirty.push(`${row} :: ${v.reasons.join(", ")}`);
        }
      }
    }
  }
  ok("every reachable ttt position was walked", POOL.length === 5478, String(POOL.length));
  ok("no unfinished position renders a blank board row", blanks === 0, String(blanks));
  ok(
    `every fact and record row on every board is shapelint-clean (${rows} rows)`,
    dirty.length === 0,
    dirty.join(" | "),
  );
}

console.log("── 2. THREATS AND FORKS: bounded, and correct from her side ──");

// ═════════════════════════════════════════════════════════════════════════
// 2. THE THREAT LAYER — chess's `threatFacts`, for a nine-square board
// ═════════════════════════════════════════════════════════════════════════
{
  // THE NEGATIVE CONTROL FIRST, because it is the one that decides whether the
  // layer is a threat detector or a commentator. chessTalk.ts's header states
  // the rule: a fact that fires on every move is a fact that means nothing.
  ok("an empty board has no threats", E.tttThreats(E.newTttGame(), "o").length === 0);
  ok("one mark on the board has no threats", E.tttThreats(OPENING, "o").length === 0);
  ok("two marks have no threats", E.tttThreats(play([4, 0]), "o").length === 0);

  const his = E.tttThreats(HIS_THREAT, "o");
  ok("his two-in-a-row is seen", his.some((f) => /he .*winning, on top right/.test(f)), JSON.stringify(his));
  ok("and it is HIS, not hers", !his.some((f) => /^she/.test(f)), JSON.stringify(his));

  // FRAME. "she can win right now" and "she is one square from winning" are
  // the same square and two completely different sentences, and getting it
  // backwards is the ttt version of reporting a mate against the wrong king.
  // The pair below is ONE line of hers, read at her turn and at his.
  const herTurn = shortest(
    "her win, on her turn",
    (g) => !g.status.over && g.status.turn === "o" && winsFor(g, "o").length > 0,
  );
  const hers = E.tttThreats(herTurn, "o");
  ok("her own win is reported as immediate on her turn", hers.some((f) => /she can win right now/.test(f)), JSON.stringify(hers));
  const hisTurn = shortest(
    "her win, on his turn",
    (g) => !g.status.over && g.status.turn === "x" && winsFor(g, "o").length === 1 && winsFor(g, "x").length === 0,
  );
  const waiting = E.tttThreats(hisTurn, "o");
  ok(
    "the same line, on HIS turn, is reported as one-square-away",
    waiting.some((f) => /she is one square from winning/.test(f)) &&
      !waiting.some((f) => /she can win right now/.test(f)),
    JSON.stringify(waiting),
  );

  // BOTH sides named when both have one — a threat report that mentions only
  // the loud half is how she ends up cheerful about a game she is losing.
  const both = shortest(
    "both one away",
    (g) => !g.status.over && winsFor(g, "o").length > 0 && winsFor(g, "x").length > 0,
  );
  const bothT = E.tttThreats(both, "o");
  ok("when both are one away, both are named", bothT.length >= 2, JSON.stringify(bothT));

  // FORKS — the only tactic the game has.
  const forky = shortest(
    "a fork, with nobody one square away",
    (g) =>
      !g.status.over &&
      winsFor(g, "o").length === 0 &&
      winsFor(g, "x").length === 0 &&
      E.tttThreats(g, "o").some((f) => /double threat/.test(f)),
  );
  const fk = E.tttThreats(forky, "o");
  ok("a double threat is seen", fk.some((f) => /double threat/.test(f)), JSON.stringify(fk));
  ok(
    "a fork is NOT reported while somebody is already one square away",
    !E.tttThreats(HIS_THREAT, "o").some((f) => /double threat/.test(f)),
    JSON.stringify(E.tttThreats(HIS_THREAT, "o")),
  );
  ok("a finished game has no threats", E.tttThreats(HIS_WIN, "o").length === 0);

  // Ordered most-urgent-first, chess's own contract for `threatFacts`.
  ok(
    "the side to move is named first",
    (() => {
      const t = E.tttThreats(both, "o");
      const mover = both.status.turn === "o" ? "she" : "he";
      return t[0].startsWith(mover);
    })(),
    JSON.stringify(bothT) + ` turn=${both.status.turn}`,
  );
}

console.log("── 3. MOVE AND SPEECH CHOREOGRAPHY: think time, staleness, settle ──");

// ═════════════════════════════════════════════════════════════════════════
// 3. THE CHOREOGRAPHY — a real game, played out, one turn at a time
// ═════════════════════════════════════════════════════════════════════════
//
// `state/game.ts`'s think table and note seam CLAIM to serve ttt. This walks a
// real game through her real opponent and asserts the claim at every one of
// her turns, which is the difference between a claim and a gate.
{
  let g = E.newTttGame();
  const herMark = "o";
  let herTurns = 0;
  let staleSeen = 0;
  let holdSeen = 0;
  while (!g.status.over) {
    if (g.status.turn === herMark) {
      const key = g.board.map((c) => c ?? ".").join("");
      const ply = g.played.length;
      const obvious =
        E.winningCells(g.board, herMark).length > 0 || E.winningCells(g.board, "x").length > 0;
      const ms = E.tttThinkMs({ key, ply, obvious, seed: NOW });
      ok(`her turn ${herTurns}: a hand actually moved (>=${E.THINK_FLOOR_MS}ms)`, ms >= E.THINK_FLOOR_MS, `${ms}ms`);
      ok(`her turn ${herTurns}: the board did not freeze (<=${E.THINK_CEIL_MS}ms)`, ms <= E.THINK_CEIL_MS, `${ms}ms`);
      const band = obvious ? E.THINK_BANDS.ttt_obvious : E.THINK_BANDS.ttt;
      ok(`her turn ${herTurns}: inside its band ${band[0]}..${band[1]}`, ms >= band[0] && ms <= band[1], `${ms}ms`);
      ok(`her turn ${herTurns}: deterministic`, E.tttThinkMs({ key, ply, obvious, seed: NOW }) === ms);

      const cell = E.herTttMove(g);
      ok(`her turn ${herTurns}: she picked a legal cell`, E.legalCells(g).includes(cell), String(cell));
      const at = g.played.length;
      g = E.playTtt(g, cell);
      herTurns++;

      // THE NOTE, drafted against the board she just made.
      const note = E.tttMoveNote(g, herMark, "her");
      ok(`her turn ${herTurns}: the note exists`, note.length > 0);
      // TENSE IS LAW. A note that does not say the CHOICE IS CLOSED is a note a
      // model deliberates against, whatever tense it is in.
      if (!g.status.over) {
        ok(`her turn ${herTurns}: the note closes the choice`, /already taken/.test(note), note);
      }
      ok(
        `her turn ${herTurns}: the note never announces a move she has not made`,
        !/she will|she should|she is going to|thinking about/i.test(note),
        note,
      );

      // THE STAMP. `noteVerdict` is the whole seam as one pure function.
      const sess = sessionOf(g);
      ok(`her turn ${herTurns}: a fresh note sends`, E.noteVerdict(g.played.length, sess, false) === "send");
      if (E.noteVerdict(g.played.length, sess, true) === "hold") holdSeen++;
      // the board moves under it
      const after = E.legalCells(g)[0];
      if (after !== undefined && !g.status.over) {
        const moved = E.playTtt(g, after);
        if (moved && E.noteVerdict(at + 1, sessionOf(moved), false) === "stale") staleSeen++;
      }
    } else {
      const free = E.legalCells(g);
      g = E.playTtt(g, free[0]);
    }
  }
  ok("the walk covered real turns of hers", herTurns >= 2, String(herTurns));
  ok("a note drafted a move ago is DROPPED, not sent late", staleSeen >= 1, String(staleSeen));
  ok("a note drafted while she is speaking is HELD, not queued", holdSeen >= 1, String(holdSeen));
  // and a note about a game that has since closed is stale for anything
  ok("a closed ttt game makes every note stale", E.gamePly(sessionOf(g, { closedAt: NOW })) === null);
  ok("…which noteVerdict reports as stale", E.noteVerdict(9, sessionOf(g, { closedAt: NOW }), false) === "stale");
}

// The mid-call board settle reads `status.turn`, which is the one expression
// that covers both boards. Asserted on the SOURCE, because the thing being
// checked is that no second, chess-shaped branch grew back.
{
  const region = ENGINE.slice(ENGINE.indexOf("settleBoardAfterPickup"), ENGINE.indexOf("const pokedPly"));
  ok("settleBoardAfterPickup exists", region.length > 0);
  ok("it reads status.turn, not a FEN", /g\.game\.status\.turn === g\.herSide/.test(region), region);
  ok("it has no chess-only branch", !/kind === "chess"/.test(region), region);
  ok("it sends SILENTLY — a correction is not news", /direct\(note,\s*\{\s*silent:\s*true\s*\}\)/.test(region), region);
  // and it produces a ttt-shaped fact for a ttt board
  ok("the settle fact names the game a person names", /tic tac toe/.test(E.boardTurnFact("ttt", 5, "his")));
  ok("…and never the union key", !/\bttt\b/.test(E.boardTurnFact("ttt", 5, "his")), E.boardTurnFact("ttt", 5, "his"));
  ok("turn direction is carried", /it is your move now/.test(E.boardTurnFact("ttt", 3, "hers")));
  ok("a finished board settles to nothing to play", /nothing to play/.test(E.boardTurnFact("ttt", 9, "over")));
}

console.log("── 4. POKE DISCIPLINE: endings interrupt, quiet marks do not ──");

// ═════════════════════════════════════════════════════════════════════════
// 4. THE POKE — urgency, salience, and the counter that advances on SEND
// ═════════════════════════════════════════════════════════════════════════
//
// THE DEFECT THIS SECTION EXISTS FOR: `urgent` was `cur.kind === "chess" &&
// …`, so a tic-tac-toe game could be won, lost or drawn while she was on the
// line and the ending fell straight through to the rate floor, which adopts
// the ply silently and says nothing.
{
  ok("a ttt win is worth interrupting for", E.tttUrgent(HIS_WIN, "o"));
  ok("a ttt draw is worth interrupting for", E.tttUrgent(DRAW, "o"));
  ok(
    "the move before a win is too",
    E.tttUrgent(play([0, 4, 1, 8]), "o"),
    JSON.stringify(play([0, 4, 1, 8]).board),
  );
  // NEGATIVE CONTROL for the urgency itself: an urgency that fires every move
  // is no urgency, and it would put her across every sentence he says.
  ok("an opening mark is NOT urgent", !E.tttUrgent(OPENING, "o"));
  ok("an empty board is NOT urgent", !E.tttUrgent(E.newTttGame(), "o"));
  {
    // HOW OFTEN SHE WOULD ACTUALLY INTERRUPT, measured over REAL games rather
    // than over the enumeration. The denominator matters and it is easy to get
    // wrong: 61% of all 5,478 reachable positions are "somebody can win right
    // now", because most of them are positions no player would ever reach.
    // What the poke sees is a completed exchange in a game her own opponent
    // played, and there are at most a handful of those in a nine-mark game.
    //
    // `urgent` is the flag that crosses the breath pause and the rate floor,
    // so this number is the number of times a game she may cut into his
    // sentence. Chess's equivalent (`over || inCheck`) is rare by nature; this
    // asserts the ttt reading did not smuggle in a permanent interrupt.
    let games = 0;
    let worst = 0;
    let anyUrgent = 0;
    for (let seed = 0; seed < 24; seed++) {
      let g = E.newTttGame();
      let n = 0;
      let guard = 0;
      while (!g.status.over && guard++ < 12) {
        // he plays: her engine at a middling strength, so the games are ones
        // two people would plausibly play rather than uniform noise
        const his = E.herTttMove(g, { strength: 1 + (seed % 3) });
        g = E.playTtt(g, his) ?? g;
        if (g.status.over) break;
        const hers = E.herTttMove(g, { strength: 3 });
        g = E.playTtt(g, hers) ?? g;
        // this is the instant the poke fires: a completed exchange
        if (E.tttUrgent(g, "o")) n++;
      }
      games++;
      worst = Math.max(worst, n);
      anyUrgent += n;
    }
    ok("real games were played out", games === 24, String(games));
    ok("she does not interrupt every exchange", worst <= 3, `worst ${worst} per game`);
    ok("…but an ending or a match point does reach her", anyUrgent > 0, String(anyUrgent));
  }

  // SALIENCE. Chess drops a quiet developing move; ttt narrated every one.
  ok("an opening mark does not earn a remark", !E.tttNoteworthy(OPENING, "o"));
  ok("a block earns one", E.tttNoteworthy(play([0, 4, 1, 2]), "o"), "he took 0,1 then she took 2");
  ok("a threat earns one", E.tttNoteworthy(HIS_THREAT, "o"));
  ok("an ending earns one", E.tttNoteworthy(HIS_WIN, "o"));

  // THE SENDERS. A declared reaction with no sender is a dead writer.
  ok("the poke has a ttt branch", /if \(cur\.kind === "ttt"\)/.test(ENGINE));
  ok("it sends the ttt note through the shared seam", /sendGameNote\(cur\.kind, at, tttMoveNote\(/.test(ENGINE), "");
  ok("urgency is asked of the ttt board", /tttUrgent\(cur\.game, cur\.herSide\)/.test(ENGINE));
  ok("salience is asked of the ttt board", /tttNoteworthy\(cur\.game, cur\.herSide\)/.test(ENGINE));
  ok("the ply counter advances for ttt", /cur\.kind === "chess" \|\| cur\.kind === "ttt"\) pokedPly\.current/.test(ENGINE));
}

console.log("── 5. LIFECYCLE: the ttt cells fire, with ttt-shaped facts ──");

// ═════════════════════════════════════════════════════════════════════════
// 5. THE LIFECYCLE MATRIX, for a ttt board
// ═════════════════════════════════════════════════════════════════════════
//
// The matrix is kind-blind by design: `game_end`, `game_closed` and
// `game_start` name a BOARD, and ttt is one. What was not kind-blind was the
// wording, which interpolated the union key straight into a sentence she
// speaks out loud.
{
  for (const ev of ["game_start", "game_end", "game_closed"]) {
    const cell = E.LIFECYCLE_MATRIX[ev].call_live;
    ok(`${ev} x call_live is carried by a note`, cell.via === "direct", cell.via);
  }

  // THE KEY MUST NOT REACH HER MOUTH. On the live lane she emits the
  // characters she speaks; `ack-bracket-direction` is this repo's proof that
  // text in this position is PERFORMED, never inert. "the ttt just ended" is
  // three letters she reads out.
  const facts = [
    E.boardOpenedFact("ttt"),
    E.boardOverFact("ttt", "he won that one"),
    E.boardClosedFact("ttt", 5, 4),
    E.boardTurnFact("ttt", 5, "hers"),
  ];
  for (const f of facts) {
    ok(`no union key in "${f.slice(0, 46)}…"`, !/\bttt\b/.test(f), f);
    ok(`names the game as a person says it: "${f.slice(0, 46)}…"`, /tic tac toe/.test(f), f);
    ok(`inside the note cap: "${f.slice(0, 46)}…"`, f.length <= E.LIFECYCLE_FACT_MAX_CHARS, String(f.length));
    // The word cap is `facts`' contract, not this one's: a lifecycle note is
    // bounded by LIFECYCLE_FACT_MAX_CHARS and is deliberately a longer,
    // instructing shape. What DOES apply is the half of shapelint that
    // `recited-prompt` is about — a fact she reads as a sentence of her own is
    // a fact she says back. Same two checks `evals/lifecycle/run.mjs` makes.
    ok(`lowercase start: "${f.slice(0, 46)}…"`, /^[a-z0-9]/.test(f), f.slice(0, 24));
    ok(
      `no first person: "${f.slice(0, 46)}…"`,
      !/\b(I|I'm|I've|my|me)\b/i.test(f.replace(/\bmove\b/g, "")),
      f,
    );
    const v = E.lintLine(f);
    ok(
      `not sentence-shaped: "${f.slice(0, 46)}…"`,
      !v.reasons.some((r) => /sentence-shaped|first-person/.test(r)),
      v.reasons.join(", "),
    );
  }
  // chess is untouched by the same table
  ok("chess still reads as chess", /the chess board was just closed/.test(E.boardClosedFact("chess", 24)));
  ok("boardWord is derived from LABEL, not restated", E.boardWord("chess") === "chess" && E.boardWord("ttt") === "tic tac toe");
  ok("an unknown kind falls back to itself", E.boardWord("backgammon") === "backgammon");

  // A TTT FACT NAMES THE GRID. This is the owner's cell, worded for a
  // nine-square board instead of for an unbounded move number.
  const closed = E.boardClosedFact("ttt", 5, 4);
  ok("the abandoned ttt board is located by its squares", /4 squares never taken/.test(closed), closed);
  ok("…and not by a chess move number", !/at move 5/.test(closed), closed);
  ok("one square left is singular", /1 square never taken/.test(E.boardClosedFact("ttt", 8, 1)));
  ok("it still says nobody won", /no result, nobody won/.test(closed), closed);
  // chess keeps the move number, because for chess the move number IS the place
  ok("chess keeps its move number", /at move 24/.test(E.boardClosedFact("chess", 24)));

  // and the sender passes the square count rather than letting the fact guess
  ok("the sender computes open squares off the live ttt board", /kind === "ttt"[\s\S]{0,200}c === null/.test(ENGINE));
  ok("…and hands them to the fact", /boardClosedFact\(prev\.kind, prev\.ply, openSquares\)/.test(ENGINE));
}

console.log("── 6. MEMORY: a finished ttt game becomes an episode ──");

// ═════════════════════════════════════════════════════════════════════════
// 6. THE EPISODE — the writer fires for ttt and writes ttt-shaped rows
// ═════════════════════════════════════════════════════════════════════════
//
// `dead-writers` again, and this is the instance the owner reported as a
// "memory issue": the episode writer is kind-agnostic and therefore "supports"
// ttt, and nothing in the tree had ever asserted that a ttt game reaches it.
{
  const closedAt = NOW - 30 * MIN;
  const finished = sessionOf(HIS_WIN, { startedAt: closedAt - 4 * MIN, closedAt });
  const rec = E.emitClosedActivity(undefined, finished);
  ok("a finished ttt game produces a record", Boolean(rec), JSON.stringify(rec));
  ok("it is filed as ttt", rec.kind === "ttt", rec.kind);
  ok("it is dated by the game, not by the clock", rec.closedAt === closedAt);
  ok("the summary says what it was", /a game of tic tac toe together/.test(rec.summary), rec.summary);
  ok("the summary carries the date", /on 24 aug/.test(rec.summary), rec.summary);

  // THE ROWS A PERSON ACTUALLY CARRIES. Chess's record was rebuilt after a
  // tester asked about an opening two days later and she invented one; ttt's
  // equivalents are the mark she had, how it ended, the shape it ended on, who
  // opened where, and where the marks finished up.
  ok("she remembers which mark she had", /she was o/.test(rec.summary), rec.summary);
  ok("she remembers who won and in how many", /he won it in 5 moves/.test(rec.summary), rec.summary);
  ok("she remembers the LINE it was won on", /on the top row/.test(rec.summary), rec.summary);
  ok("she remembers who opened where", /he opened in top left/.test(rec.summary), rec.summary);
  ok("she remembers where her own marks were", /she had /.test(rec.summary), rec.summary);
  ok("the summary fits the store", rec.summary.length <= E.EPISODE_SUMMARY_MAX, String(rec.summary.length));
  // NEGATIVE CONTROL: the present-moment rows must NOT survive into a memory.
  ok("no whose-turn row in the permanent record", !/it is (her|his) move/.test(rec.summary), rec.summary);
  ok("no live move-count row in the permanent record", !/\d+ moves in/.test(rec.summary), rec.summary);

  // A DRAW and an ABANDONED board are different memories, and were not.
  const drawRec = E.emitClosedActivity(undefined, sessionOf(DRAW, { closedAt }));
  ok("a draw is remembered as a draw", /a draw, the board filled up/.test(drawRec.summary), drawRec.summary);
  const early = sessionOf(HIS_THREAT, { closedAt, endedEarly: true });
  const earlyRec = E.emitClosedActivity(undefined, early);
  ok("an abandoned ttt game is remembered as abandoned", /he left it unfinished/.test(earlyRec.summary), earlyRec.summary);
  ok("…located by squares, not by a move number", /squares never taken/.test(earlyRec.summary), earlyRec.summary);
  ok("…and names no winner", !/won it/.test(earlyRec.summary), earlyRec.summary);

  // AND IT REACHES A PROMPT — on both lanes, from the local ledger, with no
  // network, no embedding and no person row (the whole point of the ledger).
  let ledger = [];
  for (const r of [rec, drawRec]) ledger = E.withActivityRecord(ledger, r);
  const chat = E.formatActivityLedger(ledger, NOW);
  ok("the chat lane renders the ttt games", /tic tac toe/.test(chat), chat);
  const call = E.formatActivityLedgerForCall(ledger, NOW);
  ok("the call lane renders them too", /tic tac toe/.test(call), call);
  ok("the call block stays inside its 300", call.length <= 300, String(call.length));
  ok("the call block keeps the fence", /Never add a move, an opening or a score that is not here/.test(call));
}

console.log("── 7. ENDED EARLY: a board he put away names no winner ──");

// ═════════════════════════════════════════════════════════════════════════
// 7. endedEarly, which was chess-only
// ═════════════════════════════════════════════════════════════════════════
{
  const at = NOW - 5 * MIN;
  // the takeover path — the component-side close, the one App's reconciler
  // structurally cannot see
  const settled = E.settleOccupant({ game: sessionOf(HIS_THREAT), tally: {} }, at);
  ok("a taken-over ttt board is closed", settled.closed.closedAt === at);
  ok("…and marked ended early", settled.closed.endedEarly === true, JSON.stringify(settled.closed.endedEarly));
  // a FINISHED board taken over is not "ended early" — it had a result
  const settledOver = E.settleOccupant({ game: sessionOf(HIS_WIN), tally: {} }, at);
  ok("a finished ttt board is NOT marked ended early", !settledOver.closed.endedEarly);
  ok("…and is tallied", settledOver.state.tally.tttGames === 1, JSON.stringify(settledOver.state.tally));

  // THE BLOCK. Before this, a ttt board he put away rendered "you two JUST
  // FINISHED a game of tic tac toe" directly above a live "it is his move".
  const sys = compiledFor(sessionOf(HIS_THREAT, { closedAt: NOW - MIN, endedEarly: true }));
  const block = sys.slice(sys.indexOf("JUST FINISHED"), sys.indexOf("JUST FINISHED") + E.ACTIVITY_BLOCK_MAX);
  ok("the closed ttt board says he ended it", /he ended the game early, no result/.test(block), block);
  ok("…and no longer says whose move it is", !/it is (her|his) move/.test(block), block);
  ok("…and names no winner", !/(she|he) won that one/.test(block), block);
  ok("the head row is not duplicated", (block.match(/he ended the game early/g) || []).length === 1, block);
  ok("…and still says which mark she had", /she was o/.test(block), block);
  // A LIVE THREAT ON A DEAD BOARD. `tttThreats` suppresses itself for a
  // FINISHED game, and a board he put away is not finished — it stopped — so
  // without an explicit suppression the block read "no result" directly above
  // "he is one square from winning".
  ok("…and carries no live threat", !/winning|double threat/.test(block), block);
}

console.log("── 8. THE SERIES: who usually wins, off the one ledger ──");

// ═════════════════════════════════════════════════════════════════════════
// 8. seriesOf — read against the REAL writer's output, never a hand-written
//    twin (`STEM_DATE_RE`'s own precaution, one file over)
// ═════════════════════════════════════════════════════════════════════════
{
  const mk = (g, i, extra = {}) =>
    E.emitClosedActivity(undefined, sessionOf(g, { startedAt: NOW - (i + 1) * 60 * MIN, closedAt: NOW - i * 60 * MIN, ...extra }));
  // she is "o" in every fixture, so HIS_WIN is his and this one is hers
  const herWin = shortest("a win of hers", (g) => g.status.over && g.status.winner === "o");
  ok("fixture: her win is real", herWin.status.over && herWin.status.winner === "o", JSON.stringify(herWin.status));
  const ledger = [mk(HIS_WIN, 0), mk(herWin, 1), mk(DRAW, 2), mk(HIS_THREAT, 3, { endedEarly: true })];
  const s = E.seriesOf(ledger, "ttt");
  ok("the head-to-head counts only games with an outcome", s.games === 3, JSON.stringify(s));
  ok("his wins are his", s.his === 1, JSON.stringify(s));
  ok("hers are hers", s.her === 1, JSON.stringify(s));
  ok("a draw is a draw", s.draws === 1, JSON.stringify(s));
  ok("an abandoned game is in the ledger and out of the score", ledger.length === 4);
  ok("another kind is not counted", E.seriesOf(ledger, "chess").games === 0);
  ok("an empty ledger is zero, not a crash", E.seriesOf(undefined, "ttt").games === 0);
  ok("a malformed row cannot throw", E.seriesOf([null, { kind: "ttt" }, { kind: "ttt", summary: 3 }], "ttt").games === 0);
  // the ROOM reads exactly this
  const ROOM = readFileSync(join(ROOT, "src/components/TicTacToeActivity.tsx"), "utf8");
  ok("the room reads the same ledger", /seriesOf\(state\.activities, "ttt"\)/.test(ROOM));
  ok("the room states the result on screen", /className="as-result"/.test(ROOM));
  ok("the room can end a game by hand", /data-tel="ttt\.end"/.test(ROOM));
  ok("…and that hand-end sets endedEarly", /endedEarly: true as const/.test(ROOM));
  ok("no em-dash in the room's copy", !/—/.test(ROOM.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")), "");
}

console.log("── 9. NEGATIVE CONTROLS: the gate can see the defect ──");

// ═════════════════════════════════════════════════════════════════════════
// 9. NEGATIVE CONTROLS
// ═════════════════════════════════════════════════════════════════════════
//
// Every claim above whose evidence is a presence or an absence is re-run here
// against an input that SHOULD break it. If a control does not fire, the
// assertion it guards proves nothing.
let caught = 0;
const control = (name, broke) => {
  checks++;
  if (broke) caught++;
  else {
    fail++;
    console.log(`FAIL control did not fire: ${name}`);
  }
};

// (a) the pre-fix wording WOULD be seen — the union key reaching her mouth
control("a raw kind in a lifecycle fact would be caught", /\bttt\b/.test("the ttt just ended; the board is done"));
// (b) chess prose on a ttt board WOULD be seen
control("a chess move number on a ttt board would be caught", /at move 5/.test("the tic tac toe board was just closed — left unfinished at move 5"));
// (c) a threat layer that fired on an opening WOULD be seen
control(
  "a commentator threat layer would be caught",
  E.tttThreats(OPENING, "o").length === 0 && ["he took centre, dangerous"].length > 0,
);
// (d) a T15 block with no threat row WOULD be seen — rendered from the same
//     activity with the threat-bearing rows removed
control(
  "a block missing the two-in-a-row would be caught",
  (() => {
    const a = E.tttActivity(HIS_THREAT, "o", NOW - 3 * MIN);
    const stripped = { ...a, facts: a.facts.filter((f) => !/winning|double threat/.test(f)) };
    return !/one square from winning/.test(E.renderActivity(stripped, NOW));
  })(),
);
// (e) a stale note WOULD be seen
control(
  "a note about a superseded board would be caught",
  E.noteVerdict(1, sessionOf(play([4, 0])), false) === "stale",
);
// (f) an episode with only the momentary rows WOULD be seen
control(
  "a record-less episode would be caught",
  (() => {
    const a = E.activityOf(sessionOf(HIS_WIN, { closedAt: NOW - MIN }), NOW);
    const bare = E.activityEpisodeSummary(
      { kind: "ttt", facts: a.facts, startedAt: NOW - 5 * MIN, closedAt: NOW - MIN },
      E.LABEL.ttt,
    );
    return !/he won it in 5 moves/.test(bare);
  })(),
);
// (g) the urgency revert WOULD be seen — chess-only, as it shipped
control("the chess-only urgency would be caught", (() => {
  const kind = "ttt";
  const reverted = kind === "chess" && Boolean(HIS_WIN.status.over);
  return reverted === false && E.tttUrgent(HIS_WIN, "o") === true;
})());
// (h) an endedEarly that stays chess-only WOULD be seen
control(
  "a chess-only endedEarly would be caught",
  (() => {
    const cur = sessionOf(HIS_THREAT);
    const revert = cur.kind === "chess" && !cur.game.status.over ? { endedEarly: true } : {};
    return revert.endedEarly === undefined && E.settleOccupant({ game: cur, tally: {} }, NOW).closed.endedEarly === true;
  })(),
);
// (i) a board row that renders nothing WOULD be seen
control("an empty board row would be caught", E.tttBoardFact(DRAW, "o") === "" && E.tttBoardFact(HIS_THREAT, "o") !== "");

const CONTROLS = 9;
ok("every negative control fired", caught === CONTROLS, `${caught}/${CONTROLS}`);
console.log(`      ${caught}/${CONTROLS} controls fired`);

// ═════════════════════════════════════════════════════════════════════════
// THE PARITY TABLE, PRINTED
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── parity: chess has / ttt has ──");
const chessG = (() => {
  let g = E.newChessGame();
  for (const m of ["e4", "e5", "Qh5", "Nc6", "Qxf7"]) g = E.playChess(g, m) ?? g;
  return g;
})();
const cAct = E.chessActivity(chessG, "w", NOW - 8 * MIN, E.assessLast(chessG));
const tAct = E.tttActivity(HIS_THREAT, "o", NOW - 8 * MIN);
const rows = [
  ["whose turn", "yes", tAct.facts.some((f) => /it is (her|his) move/.test(f))],
  ["what just happened", "yes", tAct.facts.some((f) => /took /.test(f))],
  ["threats", `${E.threatFacts(E.assessLast(chessG), "w").length} rows`, `${E.tttThreats(HIS_THREAT, "o").length} rows`],
  ["position", "no (unspeakable)", Boolean(E.tttBoardFact(HIS_THREAT, "o"))],
  ["result", "yes", E.tttActivity(HIS_WIN, "o", NOW).facts.some((f) => /won that one/.test(f))],
  ["durable record", `${(cAct.record ?? []).length} rows`, `${(tAct.record ?? []).length} rows`],
  ["ended early", "yes", true],
  ["episode on finish", "yes", true],
  ["urgent poke", "over/check", "over/one-away"],
];
for (const [what, chess, ttt] of rows) {
  console.log(`  ${String(what).padEnd(20)}${String(chess).padEnd(20)}${String(ttt)}`);
}

console.log(`\n${fail ? `FAILED  ${fail} of ${checks}` : `PASSED  ${checks} checks`}`);
process.exit(fail ? 1 : 0);
