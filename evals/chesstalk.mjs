// The chess → WORDS layer (src/engine/chessTalk.ts + src/engine/chess/openings.ts),
// against the CURRENT source. Standalone:  node evals/chesstalk.mjs
//
// Bundles the real TypeScript on every run, the same way evals/chess.mjs does
// and for the same reason CLAUDE.md gives about parsetest.v2: a frozen bundle
// passes forever while the source rots.
//
// ── the weighting, and why ────────────────────────────────────────────────
//
// Two assertions here matter more than the rest, and they are opposites.
//
// 1. THE BOOK MUST NOT BE WRONG. A wrong opening name is not a small defect —
//    it is her saying "this is the Caro-Kann" over a French Defence, with
//    total confidence, to someone who knows. Silence reads as her not caring;
//    a confident wrong name reads as her not knowing, and she does not get
//    that back. So every line in the book is REPLAYED through the real board
//    module here: if a move in it is not legal from the position its
//    predecessors reach, the line is a typo and this suite says so. A book
//    that is only checked against itself is checked against nothing.
//
// 2. SHE MUST NOT BECOME A COMMENTATOR. The threat facts exist so she can say
//    "your bishop is right on top of my king" instead of "a good one". The
//    failure they invite is the same one every chess engine UI has: a red
//    exclamation on every move, which means nothing on any move. So the
//    negative control below runs four ordinary opening lines, ply by ply,
//    through the real assessment and asserts that NOT ONE quiet developing
//    move produces a threat fact. That is the commentator failure wearing
//    analysis clothes, and it is the one this file is really guarding.

import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Derived from this file's location, never hardcoded: a literal
// "/home/user/html-portfolio" is true of exactly one container and silently
// wrong everywhere else.
const REPO = resolve(HERE, "..");
const OUT = mkdtempSync(join(tmpdir(), "chesstalk-"));
const ENTRY = join(OUT, "entry.ts");
// openings.ts is reached directly rather than through src/engine/chess/index.ts
// because index.ts belongs to another workstream and has not re-exported it
// yet. See the report; nothing in src/ should copy this.
writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(join(REPO, "src/engine/chess/index"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/engine/chess/openings"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/engine/chessTalk"))};\n` +
    `export * from ${JSON.stringify(join(REPO, "src/engine/activity"))};\n`,
);
const BUNDLE = join(OUT, "chesstalk.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { cwd: REPO, stdio: "inherit" },
);
const C = await import(pathToFileURL(BUNDLE).href);
const {
  newGame, play, assessLast, assessMove, legalMoves,
  openingName, OPENING_NAMES,
  chessActivity, chessRecord, moveFact, exchangeFact, threatFacts,
  renderActivity, ACTIVITY_BUDGET, RECORD_OPENING_PLIES,
} = C;

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

const NOW = Date.UTC(2026, 7, 22, 12, 0);

/** Replay SANs through the REAL board module. Returns null if any is illegal. */
function replay(sans, fen) {
  let g = fen ? newGame(fen) : newGame();
  for (const san of sans) {
    const next = play(g, san);
    if (!next) return null;
    g = next;
  }
  return g;
}

// ══ 1. THE BOOK ═══════════════════════════════════════════════════════════
//
// Every line, replayed. `play` goes through chess.js, the rules authority, so
// a line that survives this is legal chess and reaches the position it claims.
//
// This table is a SECOND, independently written copy of the book rather than an
// import of it, and that is the point: the replay proves this copy is legal
// chess, and the name assertions prove the source agrees with it. A book
// checked only against itself is checked against nothing. What neither copy can
// catch is a line that is legal AND consistently misnamed in both — that is
// what the per-line source check in the report is for.

const BOOK = [
  // ── 1.e4 e5 ─────────────────────────────────────────────────────────────
  [["e4", "e5", "Nf3", "Nc6", "Bc4"], "the italian game"],
  [["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Nxd5", "Nxf7"],
    "the fried liver attack"],
  [["e4", "e5", "Nf3", "Nc6", "Bb5"], "the ruy lopez"],
  [["e4", "e5", "Nf3", "Nc6", "d4"], "the scotch game"],
  [["e4", "e5", "Nf3", "Nc6", "Nc3", "Nf6"], "the four knights game"],
  [["e4", "e5", "Nc3"], "the vienna game"],
  [["e4", "e5", "f4"], "the king's gambit"],
  // ── 1.e4, everything else ───────────────────────────────────────────────
  [["e4", "c5"], "the sicilian defence"],
  [["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"],
    "the sicilian najdorf"],
  [["e4", "e6"], "the french defence"],
  [["e4", "c6"], "the caro-kann defence"],
  [["e4", "d5"], "the scandinavian defence"],
  [["e4", "d6", "d4", "Nf6"], "the pirc defence"],
  [["e4", "Nf6"], "alekhine's defence"],
  // ── 1.d4 d5 ─────────────────────────────────────────────────────────────
  [["d4", "d5", "c4"], "the queen's gambit"],
  [["d4", "d5", "c4", "dxc4"], "the queen's gambit accepted"],
  [["d4", "d5", "c4", "e6"], "the queen's gambit declined"],
  [["d4", "d5", "c4", "c6"], "the slav defence"],
  [["d4", "d5", "c4", "e6", "g3"], "the catalan opening"],
  // ── the London, which is a setup and therefore several move orders ──────
  [["d4", "d5", "Bf4"], "the london system"],
  [["d4", "Nf6", "Bf4"], "the london system"],
  [["d4", "d5", "Nf3", "Nf6", "Bf4"], "the london system"],
  [["d4", "Nf6", "Nf3", "e6", "Bf4"], "the london system"],
  [["d4", "Nf6", "Nf3", "g6", "Bf4"], "the london system"],
  // ── 1.d4 Nf6 2.c4 ───────────────────────────────────────────────────────
  [["d4", "Nf6", "c4", "g6", "Nc3", "Bg7"], "the king's indian defence"],
  [["d4", "Nf6", "c4", "g6", "Nc3", "d5"], "the grünfeld defence"],
  [["d4", "Nf6", "c4", "e6", "Nc3", "Bb4"], "the nimzo-indian defence"],
  [["d4", "Nf6", "c4", "e6", "g3"], "the catalan opening"],
  [["d4", "f5"], "the dutch defence"],
  // ── flank ───────────────────────────────────────────────────────────────
  [["c4"], "the english opening"],
  [["Nf3", "d5", "c4"], "the réti opening"],
  [["f4"], "bird's opening"],
];

for (const [sans, name] of BOOK) {
  const line = sans.join(" ");
  const g = replay(sans);
  ok(`book line is legal chess: ${line}`, g !== null);
  if (!g) continue;
  eq(`board really played it: ${line}`, g.played.map((m) => m.san), sans);
  eq(`named at full depth: ${line}`, openingName(sans), name);
  // Every shallower prefix must be silent or a real name — never a half-name.
  for (let d = 1; d < sans.length; d++) {
    const partial = openingName(sans.slice(0, d));
    ok(`prefix d${d} of "${line}" is null or a real name`,
      partial === null || OPENING_NAMES.includes(partial), String(partial));
  }
}

// The ladders — a longer line must OVERRIDE the shorter one it grew out of.
eq("QG becomes QGD", openingName(["d4", "d5", "c4", "e6"]), "the queen's gambit declined");
eq("QG becomes QGA", openingName(["d4", "d5", "c4", "dxc4"]), "the queen's gambit accepted");
eq("QGD becomes the Catalan", openingName(["d4", "d5", "c4", "e6", "g3"]), "the catalan opening");
eq("Sicilian becomes the Najdorf",
  openingName(["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"]),
  "the sicilian najdorf");
eq("Italian becomes the Fried Liver",
  openingName(["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Nxd5", "Nxf7"]),
  "the fried liver attack");
// The KID/Grünfeld fork: same first five plies, two different openings.
eq("3...Bg7 is the King's Indian",
  openingName(["d4", "Nf6", "c4", "g6", "Nc3", "Bg7"]), "the king's indian defence");
eq("3...d5 is the Grünfeld",
  openingName(["d4", "Nf6", "c4", "g6", "Nc3", "d5"]), "the grünfeld defence");

// SAN carries "+" and "#"; the book does not. A name that vanished the moment
// a line gave check would be a name she loses exactly when it gets interesting.
eq("check marks do not break the match",
  openingName(["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Nxd5", "Nxf7"]),
  openingName(["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Nxd5", "Nxf7!?"]));

// ── null: the common and correct answer ───────────────────────────────────
eq("no moves, no name", openingName([]), null);
eq("1.e4 alone is not a named opening", openingName(["e4"]), null);
eq("1.d4 alone is not a named opening", openingName(["d4"]), null);
// LEFT BOOK: "e4 e5 Nf3 Nc6" is deliberately not an entry, so a game that
// deviates there has no name and must not be given a nearby one.
eq("left book at move three", openingName(["e4", "e5", "Nf3", "Nc6", "a3"]), null);
eq("left book stays left",
  openingName(["e4", "e5", "Nf3", "Nc6", "a3", "h6", "h3", "a6", "Rg1", "Rh7", "Rh1", "Rh8"]),
  null);
{
  // A genuine shuffle, replayed so it is real chess and not a made-up string.
  const sans = ["a3", "h6", "h3", "a6", "Ra2", "Rh7", "Ra1", "Rh8", "Nf3", "Nf6", "Ng1", "Ng8"];
  ok("nonsense sequence is legal chess", replay(sans) !== null);
  eq("nonsense sequence has no name", openingName(sans), null);
}
// A prefix match is permanent, and that is correct chess: an Italian on move
// three is still an Italian on move ten.
eq("a matched line keeps its name once out of theory",
  openingName(["e4", "e5", "Nf3", "Nc6", "Bc4", "h6", "h3", "a6", "a3", "b6", "b3", "g6"]),
  "the italian game");

// ── the four-move checkmate, recognised as an ATTEMPT ─────────────────────
{
  const a = ["e4", "e5", "Bc4", "Bc5", "Qh5", "Nf6"];
  ok("scholar's order A is legal", replay(a) !== null);
  eq("scholar's order A (2.Bc4 3.Qh5)", openingName(a), "the four-move checkmate try");
  const b = ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6"];
  ok("scholar's order B is legal", replay(b) !== null);
  eq("scholar's order B (2.Qh5 3.Bc4)", openingName(b), "the four-move checkmate try");
  const c = ["e4", "e5", "Bc4", "Nc6", "Qf3", "Nd4"];
  eq("Qf3 counts too", openingName(c), "the four-move checkmate try");
  // Mated at, not just threatened — she has to know what just happened to her.
  const done = ["e4", "e5", "Bc4", "Bc5", "Qh5", "Nf6", "Qxf7#"];
  const dg = replay(done);
  ok("scholar's mate is really mate", dg !== null && dg.status.over, dg?.fen);
  eq("she recognises being scholar's-mated at", openingName(done),
    "the four-move checkmate try");
  // Black's version, at f2.
  const bl = ["e4", "e5", "Nf3", "Bc5", "Nc3", "Qf6"];
  ok("black's version is legal", replay(bl) !== null);
  eq("black's version fires too", openingName(bl), "the four-move checkmate try");

  // NEGATIVE: an Italian where the queen wanders to h5 on move FOUR is not the
  // four-move mate, and calling it that would be her misreading an ordinary
  // game. The sortie is required on move two or three for exactly this.
  eq("a move-four queen sortie is still the Italian",
    openingName(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "Qh5", "Nf6"]), "the italian game");
  // NEGATIVE, and this one has to reach the detector rather than being caught
  // by the book on the way: an early Bc4 with NO queen sortie is just a bishop
  // on c4. (Found by injecting the loosened detector — the Italian case above
  // never reached the scholar's path, so it proved nothing about it.)
  const bishopOnly = ["e4", "e5", "Bc4", "Nc6", "Nf3", "Nf6"];
  ok("bishop-only fixture is legal chess", replay(bishopOnly) !== null);
  eq("bishop-only fixture is off book", BOOK.some(([s]) => s.join(" ") === bishopOnly.join(" ")),
    false);
  eq("Bc4 without a queen sortie is not the four-move mate",
    openingName(bishopOnly), null);
  eq("nor is an early queen without the bishop",
    openingName(["e4", "e5", "Qh5", "Nc6", "Nf3", "Nf6"]), null);
  // And it does not survive into the middlegame as a name.
  eq("the four-move mate is not a middlegame name",
    openingName(["e4", "e5", "Bc4", "Bc5", "Qh5", "Qe7", "Nf3", "Nf6", "Nc3", "d6", "d3", "Bg4"]),
    null);
}

// ── purity ────────────────────────────────────────────────────────────────
{
  const sans = ["e4", "e5", "Nf3", "Nc6", "Bc4"];
  const copy = [...sans];
  eq("same input, same answer", openingName(sans), openingName(copy));
  eq("input is not mutated", sans, copy);
}

// ══ 2. SHAPELINT ══════════════════════════════════════════════════════════
//
// The three rules that stop a fact becoming a line she recites, plus the two
// this layer adds: no square-name soup, and no engine numbers.

const SQUARE = /\b[a-h][1-8]\b/g;

function shapelint(label, f) {
  const bad = [];
  // `recited-prompt`: a capital start plus terminal punctuation IS a line.
  if (/^[A-Z][^.?!]*[.?!]$/.test(f)) bad.push("sentence-shaped");
  if (/^(i\b|i'm\b|main\b|mai\b|mujhe\b|meri\b|mera\b|maine\b)/i.test(f)) bad.push("first-person");
  if (f.trim().split(/\s+/).length > 14) bad.push(`${f.trim().split(/\s+/).length} words`);
  // Square-name soup: a row naming three squares is a scoresheet, not a
  // remark. Two — a SAN and the square it landed on — is the honest ceiling.
  if ((f.match(SQUARE) || []).length > 2) bad.push("square soup");
  // No FEN and no centipawns, ever. She speaks these characters out loud.
  if (/\/[rnbqkpRNBQKP1-8]{2,}\//.test(f)) bad.push("FEN");
  if (/\bcp\b|centipawn|[-+]?\d{3,}/.test(f)) bad.push("engine number");
  ok(`shapelint ${label}: "${f}"`, bad.length === 0, bad.join(", "));
}

/** ≤3 clauses, hard. `chess-facts-as-a-scoresheet` is what six clauses cost. */
const clauses = (f) => f.split(/,\s*/).length;

// ══ 3. THE FACTS THAT SHOULD FIRE ═════════════════════════════════════════
//
// Every one of these is a dead-writer check as much as a correctness check: a
// derived fact that no reachable position produces is a fact that does not
// exist, and it would look complete forever.

const collected = [];
const collect = (label, fs) => { for (const f of fs) { collected.push(f); shapelint(label, f); } };

// ── mate threatened against HER ───────────────────────────────────────────
{
  // 1.e4 e5 2.Bc4 Bc5 3.Qh5 Nf6?? — after Nf6, Qxf7 is mate and the search
  // sees it. She is black, so the mate is on HER king, and getting the frame
  // backwards is the single most alarming thing this layer could do.
  const g = replay(["e4", "e5", "Bc4", "Bc5", "Qh5", "Nf6"]);
  ok("mate fixture reached", g !== null);
  const a = assessLast(g);
  const t = threatFacts(a, "b");
  ok("a mate threat is reported", t.some((f) => /mate is threatened on her king in \d/.test(f)),
    JSON.stringify(t));
  ok("the mate is NOT credited to her", !t.some((f) => /she has mate/.test(f)), JSON.stringify(t));
  // `hangs` reads the opponent's best reply, and when that reply IS the mate
  // the piece it lands on is incidental. "mate is threatened on her king in 1,
  // her pawn is hanging on f7" makes her look like she missed her own report.
  ok("a mate suppresses the incidental hang",
    !t.some((f) => /is hanging on/.test(f)), JSON.stringify(t));
  const mf = moveFact(a, "b", "her");
  ok("mate outranks the verdict in the headline",
    /mate is threatened on her king/.test(mf) && !/a bad one/.test(mf), mf);
  ok("mate drops the standing clause", clauses(mf) <= 2, mf);
  collect("mate-against", t);
  shapelint("mate moveFact", mf);

  // The same position from WHITE's side: the mate is hers to deliver.
  const tw = threatFacts(a, "w");
  ok("from the other side she is the one mating", tw.some((f) => /she has mate in \d/.test(f)),
    JSON.stringify(tw));
  collect("mate-for", tw);
}

// ── a hanging piece, named ────────────────────────────────────────────────
{
  // 1.e4 e5 2.Qh5 Nc6 3.Qxf7+?? — the queen is en prise on f7 and the king has
  // two replies. Both facts, off one assessment.
  const g = replay(["e4", "e5", "Qh5", "Nc6", "Qxf7"]);
  ok("hang fixture reached", g !== null);
  const a = assessLast(g);
  const t = threatFacts(a, "w");
  ok("the hanging PIECE is named, not just the square",
    t.some((f) => f === "her queen is hanging on f7"), JSON.stringify(t));
  // Kd8 is blocked by his own queen and every other square is covered, so
  // Kxf7 is the ONLY legal move — the singular wording has to be right.
  ok("the cornered king is reported",
    t.includes("he is in check with one legal move left"), JSON.stringify(t));
  const mf = moveFact(a, "w", "her");
  ok("the hang is the headline, not 'a bad one'",
    /her queen is hanging on f7/.test(mf) && !/a bad one/.test(mf), mf);
  ok("moveFact stays at three clauses", clauses(mf) <= 3, mf);
  collect("hang", t);
  shapelint("hang moveFact", mf);

  // Whose piece it is flips with her colour, and nothing else changes.
  const tb = threatFacts(a, "b");
  ok("from black's side it is HIS queen",
    tb.some((f) => f === "his queen is hanging on f7"), JSON.stringify(tb));
  collect("hang-flipped", tb);
}

// ── a piece coming at the king ────────────────────────────────────────────
{
  // Black has castled and traded off the g7 bishop; White drops the
  // dark-squared bishop onto h6, two squares from the king, from five squares
  // away. This is the owner's example: *"the bishop has moved near the king."*
  const fen = "r1bq1rk1/ppp2p1p/2n3p1/3pp3/8/2N1BN2/PPP1PPPP/R2QK2R w KQ - 0 1";
  const g0 = newGame(fen);
  ok("near-king fixture is a legal position", legalMoves(fen).some((m) => m.san === "Bh6"));
  const g = play(g0, "Bh6");
  const a = assessLast(g);
  const t = threatFacts(a, "b");
  ok("the bishop is reported as coming at her king",
    t.includes("his bishop has come up close to her king"), JSON.stringify(t));
  const mf = moveFact(a, "b", "him");
  // The word cap in moveFact, exercised: with the standing clause this row is
  // 15 words, so the clause has to go. This is the mechanism that keeps a
  // future longer headline from silently busting the row limit.
  ok("the word cap dropped the standing clause", !/she is (better|worse)/.test(mf), mf);
  ok("near-king moveFact stays at three clauses", clauses(mf) <= 3, mf);
  shapelint("near-king moveFact", mf);
  collect("near-king", t);
  collected.push(mf);

  // NEGATIVE: the same bishop going BACKWARDS is not an attack.
  const back = play(play(g, "Re8"), "Be3");
  const ab = assessLast(back);
  ok("retreating is not 'coming at the king'",
    !threatFacts(ab, "b").some((f) => /come up close/.test(f)),
    JSON.stringify(threatFacts(ab, "b")));
}

// ── a file coming open toward the king ────────────────────────────────────
{
  // hxg6 takes the last pawn off the h-file, White's rook is already on h1,
  // and the black king is on g8 — one file over.
  const fen = "r1bq1rk1/ppp2p2/2n3p1/3pp2P/8/2N1B3/PPP1PPP1/R2QK2R w KQ - 0 1";
  ok("open-file fixture is a legal position", legalMoves(fen).some((m) => m.san === "hxg6"));
  const g = play(newGame(fen), "hxg6");
  const a = assessLast(g);
  const t = threatFacts(a, "b");
  ok("the opening file is reported",
    t.includes("the h-file is opening up toward her king"), JSON.stringify(t));
  const mf = moveFact(a, "b", "him");
  // This is the row that first broke the 14-word limit, by tacking "position
  // is about level" onto a threat — a contradiction in tone as well as a
  // length bust.
  ok("open-file moveFact does not also shrug", !/about level/.test(mf), mf);
  ok("open-file moveFact stays at three clauses", clauses(mf) <= 3, mf);
  shapelint("open-file moveFact", mf);
  collect("open-file", t);
  collected.push(mf);
}

// ══ 4. THE NEGATIVE CONTROL ═══════════════════════════════════════════════
//
// THE assertion of this file. Four ordinary opening lines, every ply assessed
// by the real search, and not one quiet developing move may produce a threat
// fact. A layer that fires on every move is a layer that means nothing on any
// move — that is the commentator failure wearing analysis clothes, and it is
// how this feature would actually fail in front of a user.

const QUIET = [
  ["italian", ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d3", "d6", "O-O", "O-O"]],
  ["ruy lopez", ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5"]],
  ["queen's gambit declined",
    ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Be7", "e3", "O-O", "Nf3", "Nbd7"]],
  ["london", ["d4", "d5", "Bf4", "Nf6", "e3", "e6", "Nf3", "Bd6", "Bg3", "O-O", "Bd3", "c5"]],
];

for (const [label, sans] of QUIET) {
  let g = newGame();
  for (let i = 0; i < sans.length; i++) {
    const next = play(g, sans[i]);
    ok(`${label} ply ${i + 1} (${sans[i]}) is legal`, next !== null);
    if (!next) break;
    g = next;
    const a = assessLast(g);
    const t = threatFacts(a, "w");
    ok(`NEGATIVE CONTROL — ${label} after ${sans[i]}: no threat fact`,
      t.length === 0, JSON.stringify(t));
    // And the move fact stays a remark, not a bulletin.
    const mf = moveFact(a, "w", i % 2 === 0 ? "her" : "him");
    ok(`${label} after ${sans[i]}: moveFact <=3 clauses`, clauses(mf) <= 3, mf);
    shapelint(`${label}/${sans[i]}`, mf);
    collected.push(mf);
  }
}

// ══ 5. THE ACTIVITY BLOCK ═════════════════════════════════════════════════

{
  // Mid-opening: the name is there, and the block still fits.
  const g = replay(["e4", "e5", "Nf3", "Nc6", "Bc4"]);
  const act = chessActivity(g, "b", NOW - 4 * 60_000, assessLast(g));
  ok("the opening is named in the facts",
    act.facts.includes("the opening is the italian game"), JSON.stringify(act.facts));
  const block = renderActivity(act, NOW);
  ok("the opening name survives the budget", /the italian game/.test(block), block);
  ok("block is inside its budget", block.length <= ACTIVITY_BUDGET, String(block.length));
  ok("whose move it is survives", /(her|his) move/.test(block), block);
  for (const f of act.facts) shapelint("italian activity", f);
  collected.push(...act.facts);
}
{
  // Past the opening the name is dropped — the budget mid-game is worth more
  // than a label neither of them is thinking about any more.
  const sans = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d3", "d6",
    "O-O", "O-O", "Re1", "a6", "Nbd2", "Ba7", "Nf1", "Ne7"];
  const g = replay(sans);
  ok("long-game fixture reached", g !== null && g.played.length === 18);
  const act = chessActivity(g, "b", NOW - 30 * 60_000, assessLast(g));
  ok("no opening row past the opening",
    !act.facts.some((f) => f.startsWith("the opening is")), JSON.stringify(act.facts));
  for (const f of act.facts) shapelint("midgame activity", f);
  collected.push(...act.facts);
}
{
  // The scholar's-mate game she is on the receiving end of: the name, the
  // mate, the move and whose turn it is all have to coexist inside 420 bytes.
  const g = replay(["e4", "e5", "Bc4", "Bc5", "Qh5", "Nf6"]);
  const act = chessActivity(g, "b", NOW - 2 * 60_000, assessLast(g));
  ok("she is told what shape this is",
    act.facts.includes("the opening is the four-move checkmate try"),
    JSON.stringify(act.facts));
  ok("she is told the mate is coming",
    act.facts.some((f) => /mate is threatened on her king/.test(f)) ||
    act.facts.some((f) => /mate is threatened on her king/.test(f)),
    JSON.stringify(act.facts));
  const block = renderActivity(act, NOW);
  ok("scholar block is inside its budget", block.length <= ACTIVITY_BUDGET, String(block.length));
  for (const f of act.facts) shapelint("scholar activity", f);
  collected.push(...act.facts);
}
{
  // A finished game keeps its ending and grows no threats.
  const g = replay(["f3", "e5", "g4", "Qh4#"]);
  ok("fool's mate fixture reached", g !== null && g.status.over);
  const a = assessLast(g);
  eq("a finished game has no threat facts", threatFacts(a, "b"), []);
  const act = chessActivity(g, "b", NOW - 5 * 60_000, a);
  ok("the ending is carried", act.facts.some((f) => /she won, by checkmate/.test(f)),
    JSON.stringify(act.facts));
  ok("no opening name on a finished game",
    !act.facts.some((f) => f.startsWith("the opening is")), JSON.stringify(act.facts));
  for (const f of act.facts) shapelint("finished activity", f);
  collected.push(...act.facts);
}

// ── exchangeFact keeps its shape with the new headlines ───────────────────
{
  const g = replay(["e4", "e5", "Nf3", "Nc6"]);
  const plies = g.played;
  const hisPly = plies[plies.length - 2];
  const his = assessMove(hisPly.fenBefore, hisPly, hisPly.fenAfter);
  const hers = assessLast(g);
  const ex = exchangeFact(his, hers, "b");
  ok("exchange still leads with his move", /^he played Nf3/.test(ex), ex);
  ok("exchange still carries her answer", /she answered Nc6/.test(ex), ex);
  ok("exchange is one line", ex.split("\n").length === 1, ex);
  ok("exchange is <=14 words", ex.trim().split(/\s+/).length <= 14, ex);
  collected.push(ex);
}

// ── no dialogue anywhere in anything this file produced ───────────────────
// A line she could say, written into this layer, is a line she would say every
// single game. `recited-prompt` measured 4 of 5.
for (const f of collected) {
  count++;
  const dialogue = ["arre", "yaar", "😭", "nice ", "wow", "oh ", "!", "?", '"', "you ", "your "];
  const hit = dialogue.find((w) => f.toLowerCase().includes(w));
  if (hit) { fail++; console.log(`FAIL dialogue leak "${hit}" in: ${f}`); }
}

// ── determinism ───────────────────────────────────────────────────────────
{
  const g = replay(["e4", "e5", "Qh5", "Nc6", "Qxf7"]);
  const a = assessLast(g);
  eq("threatFacts is deterministic", threatFacts(a, "w"), threatFacts(a, "w"));
  eq("moveFact is deterministic", moveFact(a, "w", "her"), moveFact(a, "w", "her"));
  const one = chessActivity(g, "w", NOW, a);
  const two = chessActivity(g, "w", NOW, a);
  eq("chessActivity is deterministic", one.facts, two.facts);
  eq("and its nameable set is too", one.nameable, two.nameable);
  eq("the rendered block is byte-identical",
    renderActivity(one, NOW), renderActivity(two, NOW));
  // Re-assessing the same move from scratch must give the same words.
  const again = assessLast(replay(["e4", "e5", "Qh5", "Nc6", "Qxf7"]));
  eq("a fresh assessment says the same thing",
    moveFact(again, "w", "her"), moveFact(a, "w", "her"));
}

// ══ 9. THE DURABLE RECORD — what is still true next week ══════════════════
//
// `chessRecord` is the half `facts` structurally cannot be. `facts` answers
// "where does this stand right now" and is correct to expire; this answers
// "what will he ask about on Thursday", and until it existed the answer was
// nothing — which is how the 2026-08-23 tester got made-up moves back when he
// asked about his own opening.
//
// IT IS NOT LINTED FOR SQUARE SOUP, and the exemption is the point rather than
// a loophole. That rule exists because a LIVE remark listing squares reads as
// a scoresheet being read out (`chess-facts-as-a-scoresheet`), and these rows
// are never a live remark: `renderActivity` does not render them, they reach
// only the episode she carries afterwards, and the opening of a game is the
// one thing a person genuinely does recall move by move. Every OTHER shape
// rule still applies, and is asserted below.
{
  const recordLint = (label, f) => {
    const bad = [];
    if (/^[A-Z][^.?!]*[.?!]$/.test(f)) bad.push("sentence-shaped");
    if (/^(i\b|i'm\b|main\b|mai\b|mujhe\b|meri\b|mera\b|maine\b)/i.test(f)) bad.push("first-person");
    if (f.trim().split(/\s+/).length > 14) bad.push(`${f.trim().split(/\s+/).length} words`);
    if (/\/[rnbqkpRNBQKP1-8]{2,}\//.test(f)) bad.push("FEN");
    if (/\bcp\b|centipawn|[-+]?\d{4,}/.test(f)) bad.push("engine number");
    ok(`record shapelint ${label}: "${f}"`, bad.length === 0, bad.join(", "));
  };

  // ── the abandoned Catalan he actually played ──────────────────────────
  const cat = replay(["d4", "Nf6", "c4", "e6", "g3", "d5", "Bg2", "Be7", "Nf3", "O-O", "O-O", "dxc4"]);
  const rec = chessRecord(cat, "b", true);
  for (const f of rec) recordLint("catalan", f);
  ok("the record opens with the opening MOVES", /^opened d4 Nf6 c4 e6 g3 d5/.test(rec[0]), rec[0]);
  ok("…exactly RECORD_OPENING_PLIES of them", rec[0].split(",")[0].split(/\s+/).length - 1 === RECORD_OPENING_PLIES, rec[0]);
  ok("…and names the book line", /the catalan opening/.test(rec[0]), rec[0]);
  ok("the colour is PAST tense — this is a memory, not the board", rec.includes("she had black"), JSON.stringify(rec));
  ok("an abandoned game says so, and says WHERE", rec.some((f) => /^he left it unfinished on move 6, no result$/.test(f)), JSON.stringify(rec));
  ok("…and claims no winner", !rec.some((f) => /\bwon\b/.test(f)), JSON.stringify(rec));
  ok("what was captured is in it", rec.includes("she took his pawn"), JSON.stringify(rec));
  ok("…and 'a pawn', never '1 pawns'", !rec.some((f) => /\b1 \w+s\b/.test(f)), JSON.stringify(rec));

  // ── the opening's NAME survives past the live block's ply cap ──────────
  // `chessActivity` drops the opening row after 16 plies because it stops
  // being news IN THE MOMENT. The record must not, because "which opening did
  // we play" is asked afterwards, which is precisely when the live rule has
  // already suppressed it.
  {
    const long = replay(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3", "d6", "c3", "O-O", "h3", "Nb8", "d4", "Nbd7"]);
    ok("live block has dropped the opening by ply 20", !chessActivity(long, "w", 0).facts.some((f) => /the opening is/.test(f)));
    const r = chessRecord(long, "w", true);
    ok("…and the record still has it", /ruy lopez|spanish/i.test(r[0]), r[0]);
    ok("…plus where it got to", r.some((f) => /^the last move was /.test(f)), JSON.stringify(r));
    for (const f of r) recordLint("ruy", f);
  }

  // ── every ending is its own memory ────────────────────────────────────
  {
    const mate = replay(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7"]);
    const r = chessRecord(mate, "w", false);
    ok("a checkmate records who won and on which move", r.some((f) => /^she won by checkmate on move 4$/.test(f)), JSON.stringify(r));
    for (const f of r) recordLint("mate", f);
  }
  {
    // a board that is simply still going, neither over nor abandoned
    const live = replay(["e4", "e5"]);
    const r = chessRecord(live, "b", false);
    ok("an open game says it is open, not that it ended", r.some((f) => /^still unfinished at move 1$/.test(f)), JSON.stringify(r));
    ok("…and names no result", !r.some((f) => /won|draw/.test(f)), JSON.stringify(r));
  }
  {
    const empty = newGame();
    const r = chessRecord(empty, "w", true);
    ok("a board abandoned before a move says exactly that", r.some((f) => /before a move was played/.test(f)), JSON.stringify(r));
    ok("…and invents no opening for it", !r.some((f) => /^opened/.test(f)), JSON.stringify(r));
    ok("…and no capture row either", !r.some((f) => /took|captured/.test(f)), JSON.stringify(r));
  }

  // ── the LIVE block is untouched by any of this ────────────────────────
  // The whole design rests on it: `record` rides `ActivityState` so the
  // episode writer stays kind-agnostic, and it must cost the live prompt
  // nothing. A move list in front of a board she can see IS the scoresheet
  // failure this file opens by refusing.
  {
    const act = chessActivity(cat, "b", 0, assessLast(cat), true);
    ok("the activity carries a record", Array.isArray(act.record) && act.record.length > 0);
    const rendered = renderActivity(act, 0);
    ok("…and renderActivity renders none of it", !act.record.some((f) => rendered.includes(f)), rendered);
    ok("…so the live block still fits its budget", rendered.length <= ACTIVITY_BUDGET, `${rendered.length}`);
  }
}

console.log(fail ? `${fail} FAILURES of ${count}` : `ALL ${count} PASS`);
process.exit(fail ? 1 : 0);

// ── registration ──────────────────────────────────────────────────────────
//
// `dead-writers` applies to this file until the coordinator wires it in. It is
// standalone, offline and $0, so the whole change is one line in the `suites`
// map of evals/run.mjs:
//
//     chesstalk: "chesstalk.mjs",
//
// Put it directly after `chess`, since it reads that module's output.
