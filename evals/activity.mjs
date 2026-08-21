// The activity layer (src/engine/activity.ts + chessTalk.ts).
//
// The owner's instruction was architectural: "There should not be any
// discreteness in this... it should be continuous personality like a real
// human." So the assertions below are mostly about what does NOT happen —
// absence rendering nothing, dialogue never appearing, and identifiers being
// declared so the honesty gate does not flag her own game talk.
import {
  renderActivity,
  activityNote,
  ACTIVITY_BUDGET,
  chessActivity,
  moveFact,
  newGame,
  play,
  assessLast,
} from "./.bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const NOW = Date.UTC(2026, 7, 21, 12, 0);

// ── absence is the common case and must cost nothing ──────────────────────
// Every existing caller passes no activity, and all 83 byte-identity fixtures
// are in that state. If this renders anything, byte-identity breaks.
ok("null renders nothing", renderActivity(null, NOW) === "");
ok("undefined renders nothing", renderActivity(undefined, NOW) === "");
ok("no facts renders nothing",
  renderActivity({ kind: "chess", startedAt: NOW, facts: [], nameable: [] }, NOW) === "");

// ── a real game renders, and stays inside its budget ──────────────────────
let g = newGame();
for (const m of ["e4", "e5", "Qh5", "Nc6", "Qxf7"]) g = play(g, m) ?? g;
const last = assessLast(g);
const act = chessActivity(g, "w", NOW - 8 * 60_000, last);
const block = renderActivity(act, NOW);

ok("a live game renders", block.length > 0);
ok("budget respected", block.length <= ACTIVITY_BUDGET, String(block.length));
ok("says how long they have been at it", /min in/.test(block), block.slice(0, 80));
ok("names the last move", /Qxf7/.test(block), block);
ok("carries whose turn it is", /(her|his) move/.test(block), block);

// ── the failure mode named in the spec: she must not become a commentator ──
// The block explicitly frames the game as something happening WHILE they talk.
ok("frames the game as not the only topic", /wander off it/.test(block));
ok("licenses silence", /quiet when nothing does/.test(block));

// ── NEGATIVE CONTROL: no line she could say ───────────────────────────────
// `recited-prompt` is the most expensive law here — her own example quotes were
// recited on 4 of 5 turns. Facts are third-person and telegraphic; anything
// that reads as dialogue would come back verbatim.
const FACT_ROWS = act.facts;
for (const f of FACT_ROWS) {
  ok(`fact is not sentence-shaped: "${f.slice(0, 40)}"`, !/^[A-Z][^.?!]*[.?!]$/.test(f));
  ok(`fact is not first-person: "${f.slice(0, 40)}"`,
    !/^(i\b|i'm\b|main\b|mai\b|mujhe\b|meri\b|mera\b|maine\b)/i.test(f));
  ok(`fact is <=14 words: "${f.slice(0, 40)}"`, f.trim().split(/\s+/).length <= 14);
}
// Hinglish dialogue must never appear — this is what a lazy implementation
// would put here, and it is exactly what she would then recite every game.
for (const w of ["arre", "yaar", "😭", "blunder tha", "nice move", "good luck"]) {
  ok(`no dialogue: "${w}"`, !block.toLowerCase().includes(w.toLowerCase()), block);
}

// ── no FEN, no centipawns ─────────────────────────────────────────────────
// She emits the characters she speaks on the live lane. A FEN read aloud is
// gibberish; a centipawn number makes her sound like a computer.
ok("no FEN in the block", !/\/[rnbqkpRNBQKP1-8]{2,}\//.test(block), block);
ok("no centipawn number", !/\bcp\b|centipawn|[-+]\d{3,}/.test(block), block);

// ── the honesty allowlist feed ────────────────────────────────────────────
// `honesty-provenance-allowlist` treats an identifier she emits that was not in
// her input as invented, and a move is identifier-shaped. Every move played has
// to be nameable or the gate flags moves that really happened.
for (const m of g.played) {
  if (m.san) ok(`played move is nameable: ${m.san}`, act.nameable.includes(m.san));
}
ok("nameable is not empty mid-game", act.nameable.length > 0);

// ── the per-move poke ─────────────────────────────────────────────────────
const note = activityNote(moveFact(last, "w", "her"));
ok("note uses ANGLE brackets", note.startsWith("<context:"), note);
ok("note has NO square brackets", !/[[\]]/.test(note), note);
ok("note tells her she may stay quiet", /only if it's worth/.test(note), note);
ok("note forbids referencing itself", /never reference this note/.test(note), note);
ok("empty fact yields no note", activityNote("") === "");
ok("whitespace fact yields no note", activityNote("   ") === "");

// ── determinism — compile() must stay a pure function of its input ────────
ok("same input twice is byte-identical", renderActivity(act, NOW) === renderActivity(act, NOW));

// ── WIRING — both lanes must actually ASK for it ──────────────────────────
// `dead-writers` is a law here because this repo has shipped, more than once, a
// writer that nothing invoked: T11/T12/T13 rendered zero bytes everywhere for
// weeks because nothing ever set `selfBundle`, and the module looked complete
// the whole time. An activity layer that no lane passes is exactly that shape,
// and it would fail as silence — she would simply never mention the game.
//
// Structural, on the real source, for the reason `gate0-structural` records:
// an instruction not to forget leaked 57–98% of the time, a SQL predicate
// leaked 0 times in 31,122. This is the predicate version.
import { readFileSync } from "node:fs";
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

const chat = src("components/Chat.tsx");
ok("chat lane passes activity", /activity:\s*activityOf\(/.test(chat));
ok("chat lane imports the single derivation", /from "\.\.\/state\/game"/.test(chat));

const call = src("components/useCallEngine.ts");
ok("call lane passes activity at connect", /activity:\s*activityOf\(/.test(call));
ok("call lane pokes per move", /activityNote\(moveFact\(/.test(call));
// The live prompt is frozen at connect, so a mid-call move CANNOT ride a
// recompile. If this ever becomes a second compile() the `liveAssemblies === 1`
// invariant breaks and the call gets a fresh prompt mid-sentence.
ok("the poke goes through direct(), not a recompile",
  /liveSession\.current\.direct\(note\)/.test(call));

// Both lanes must read the SAME derivation. Two lanes computing this
// separately is the `age-tier-never-realtime` fork, where the copy nobody
// updated silently lost a rule — here it would be `nameable`, and losing it
// makes the honesty gate flag moves that really were played.
const game = src("state/game.ts");
ok("there is exactly one derivation", /export function activityOf/.test(game));
for (const f of ["components/Chat.tsx", "components/useCallEngine.ts"]) {
  ok(`${f} does not build an ActivityState itself`, !/chessActivity\(/.test(src(f)));
}

// The game must be SESSION state, not component state — a board the call lane
// cannot see is the discreteness the whole layer exists to remove.
ok("the game is persisted on AppState", /game\?:\s*GameSession/.test(src("state/store.ts")));

console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
