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
  exchangeFact,
  chessMoveNote,
  newGame,
  play,
  assessLast,
  assessMove,
  activityOf,
  activityPickupLine,
  RECENT_END_MS,
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
// silence stays licensed — the wording moved from "react only if worth it"
// to "let it pass", because the old framing made the note a REACTION REQUEST
// and she was abandoning live conversation threads to obey it
ok("note tells her she may stay quiet", /let it pass/.test(note), note);
ok("note tells her to finish her thought first", /finish your thought first/.test(note), note);
ok("note forbids referencing itself", /never reference this note/.test(note), note);
ok("empty fact yields no note", activityNote("") === "");
ok("whitespace fact yields no note", activityNote("   ") === "");

// ── the ending stays part of the present ──────────────────────────────────
// The owner's live test: she checkmated him, he called two minutes later, and
// she asked him what move she should play. Three layers close that: the facts
// carry WHO WON, the closed session stays visible for RECENT_END_MS, and the
// pickup line says "just finished".
{
  // Fool's mate — the fastest checkmate; she (black) wins.
  let fg = newGame();
  for (const m of ["f3", "e5", "g4", "Qh4#"]) fg = play(fg, m) ?? fg;
  ok("fixture reached mate", Boolean(fg.status?.over), fg.fen);
  const fa = chessActivity(fg, "b", NOW - 10 * 60_000, assessLast(fg));
  ok("finished game is marked over", fa.over === true);
  ok("the ending names the winner", fa.facts.some((f) => /she won, by checkmate/.test(f)),
    JSON.stringify(fa.facts));
  ok("no stale whose-turn fact on a finished game",
    !fa.facts.some((f) => /(her|his) move/.test(f)), JSON.stringify(fa.facts));
  const fblock = renderActivity(fa, NOW);
  ok("finished block says JUST FINISHED", /JUST FINISHED/.test(fblock), fblock.slice(0, 90));
  ok("finished block does not claim mid-game", !/IN THE MIDDLE/.test(fblock));
  ok("finished block licenses letting it go", /never a replay/.test(fblock));

  // The session-level window: closed recently → still present; closed long
  // ago → gone (the memory layer's job, not the present moment's).
  const closedNow = { kind: "chess", game: fg, herSide: "b", startedAt: NOW - 30 * 60_000, closedAt: NOW - 5 * 60_000 };
  const aNow = activityOf(closedNow, NOW);
  ok("recently-closed game is still present", aNow !== null && aNow.over === true);
  const closedOld = { ...closedNow, closedAt: NOW - RECENT_END_MS - 60_000 };
  ok("long-closed game is gone", activityOf(closedOld, NOW) === null);
  ok("null session is still null", activityOf(null, NOW) === null);

  // The pickup line — what she carries INTO "hello".
  const line = activityPickupLine(aNow);
  ok("pickup line says just finished", /JUST finished/.test(line), line);
  ok("pickup line carries the ending", /she won, by checkmate/.test(line), line);
  const mid = activityPickupLine(chessActivity(g, "w", NOW - 8 * 60_000, last));
  ok("mid-game pickup line says mid-game", /in the middle of/.test(mid), mid);
  ok("no activity, no line", activityPickupLine(null) === "");
}

// ── the exchange, not her own move ────────────────────────────────────────
// After his move her engine answers ~300ms later, so a debounced "latest
// move" note always described HER move — she narrated her own play every
// exchange. The poke now describes the exchange: his move first (that is the
// one she is responding to), hers as the answer.
{
  let eg = newGame();
  for (const m of ["e4", "e5", "Nf3", "Nc6"]) eg = play(eg, m) ?? eg;
  const plies = eg.played;
  const hisPly = plies[plies.length - 2]; // Nf3 (white = him here)
  const his = assessMove(hisPly.fenBefore, hisPly, hisPly.fenAfter);
  const hers = assessLast(eg); // Nc6 (black = her)
  const ex = exchangeFact(his, hers, "b");
  ok("exchange leads with HIS move", /^he played Nf3/.test(ex), ex);
  ok("exchange carries her answer", /she answered Nc6/.test(ex), ex);
  ok("exchange is one line, no dialogue", !/["“”]/.test(ex) && ex.split("\n").length === 1, ex);
  // and the call lane actually uses it
  const call = readFileSync(new URL("../src/components/useCallEngine.ts", import.meta.url), "utf8");
  // WS-MOVEVOICE moved the COMPOSITION one layer down, into chessTalk's
  // `chessMoveNote`, so that the clause stating the choice is closed cannot be
  // dropped by an edit to the call lane (evals/movevoice.mjs gates that half).
  // The property this line guards is unchanged — the poke describes the
  // EXCHANGE and hands the composer both assessments, his first.
  ok("poke builds the exchange fact", /chessMoveNote\(cur\.game, cur\.herSide, his, hers/.test(call));
  ok("…and the composer leads with his move", /^he played Nf3/.test(chessMoveNote(eg, "b", his, hers, "her")));
  ok("poke has a quiet floor on HIS voice", /lastHeardAt\.current < 2500/.test(call));
  // ── batch-2 discipline: she comments when the board EARNS it ───────────
  // The owner watched the alternative: a note landing in every breath-pause
  // of her own story, so she never finished the story. These are the three
  // rules that make her a person at the table instead of a commentary feed.
  ok("poke has a salience gate", /noteworthy/.test(call) && /dropped: "quiet_move"/.test(call));
  ok("poke has a rate floor", /POKE_FLOOR_MS/.test(call) && /dropped: "rate_floor"/.test(call));
  ok("poke waits out her breath pauses", /HER_BREATH_MS/.test(call) && /her_story_held_floor/.test(call));
  ok("endings and checks bypass the floors", /const urgent =/.test(call) && /!urgent/.test(call));
  // one exchange, one note — his move alone must NOT fire while her reply is
  // pending (her think-time would split the exchange into two notes)
  ok("his move alone waits for her reply", /!exchangeComplete && !boardGameOver/.test(call));
  // and the note goes out AS her piece lands, not a debounce later — the
  // compounding-lag defect ("she is calling the previous move only")
  ok("completed exchange fires fast", /exchangeComplete \? 150 : MOVE_POKE_MS/.test(call));
  // The directive now takes ONE options bag built by pickupOpts(), which is
  // the single place the scene, the last-call recency, and who-dialled are
  // computed — three directive sites, one truth.
  ok("pickup carries the context on every lane",
    (call.match(/CALL_OPEN_DIRECTIVE\(pickupOpts\(\)\)/g) || []).length >= 3, "want 3 sites");
  // WS-HERNOW moved this one line. The scene used to be the app truth ALONE
  // — `activityPickupLine(activityOf(state.game))` — which is "" on every
  // call with no board on screen, and an empty scene fell through to the
  // directive's improv clause, which re-rolled her present moment at each
  // pickup (the fairy-lights report). The app truth is still the FIRST term
  // and still comes from this file's single derivation; what changed is that
  // there is now a second term underneath it instead of an empty string.
  ok("pickupOpts still derives app truth from the single derivation",
    /activityOf\(stateRef\.current\.game, now\)/.test(call) &&
      /line: activityPickupLine\(act\)/.test(call));
  ok("pickupOpts derives the scene from the herNow ledger",
    /scene: herNowScene\(presentNow\(now\)\.entry, now\)/.test(call),
    "see evals/hernow.mjs for the two fixtures this line exists for");
  ok("pickupOpts derives last-call recency from callmarks",
    /kind === "callmark"/.test(call) && /lastCallMinAgo/.test(call));
  ok("the caller direction reaches the engine", /sheCalled = false/.test(call));
  // and the directive itself has all three modes
  {
    const persona = readFileSync(new URL("../src/engine/persona.ts", import.meta.url), "utf8");
    ok("directive has a she-called opener", /YOU just called THEM/.test(persona));
    ok("directive has a follow-up register", /NO fresh greeting/.test(persona));
    ok("recent threshold is minutes, not hours", /lastCallMinAgo <= 15/.test(persona));
    // the anti-fabrication fence rides EVERY pickup — its first version lived
    // only in the no-scene branch, and the beach lie happened on a scened call
    ok("the fence is unconditional",
      (persona.match(/never invent anything involving THEM/g) || []).length >= 1 &&
        /\$\{fence\}/.test(persona) &&
        (persona.match(/\$\{fence\}/g) || []).length === 2);
    // no sentence-shaped promise specimen on the call lane — it was a phrase
    // bank teaching her an unkeepable promise (recited-prompt, 4/5)
    ok("no send-promise specimen in the call register", !/bhejti hu"\)/.test(persona));
  }
}

// ── ending a game by hand is a fact, not a fabricated result ─────────────
{
  let mg = newGame();
  for (const m of ["e4", "e5"]) mg = play(mg, m) ?? mg;
  const endedNow = { kind: "chess", game: mg, herSide: "b", startedAt: NOW - 10 * 60_000, closedAt: NOW - 60_000, endedEarly: true };
  const ea = activityOf(endedNow, NOW);
  ok("ended-early session still present", ea !== null && ea.over === true);
  ok("ended-early names the truth", ea.facts.some((f) => /ended the game early, no result/.test(f)), JSON.stringify(ea.facts));
  ok("ended-early has no winner claim", !ea.facts.some((f) => /won/.test(f)), JSON.stringify(ea.facts));
  ok("ended-early drops live-game rows", !ea.facts.some((f) => /(her|his) move/.test(f)), JSON.stringify(ea.facts));
}

// ── the spoken-vs-typed boundary carries its own rule ─────────────────────
// The owner: she asked why he'd said something "in text" when he said it on
// the call — the bare marker was in the window and she still misattributed.
{
  const brain = readFileSync(new URL("../src/engine/brain.ts", import.meta.url), "utf8");
  ok("call boundary states SPOKEN aloud", /SPOKEN aloud, not typed/.test(brain));
  ok("call-end boundary states typed", /back to typed texting/.test(brain));
}

// ── forgetting forgets the game ───────────────────────────────────────────
// He pressed "make her forget you"; the fresh conversation opened with her
// asking whether they should continue the chess game. The teardown now kills
// the game and any armed callback with the conversation.
{
  const chat = readFileSync(new URL("../src/components/Chat.tsx", import.meta.url), "utf8");
  ok("teardown clears the game", /clearedAt: Date\.now\(\),[\s\S]{0,900}game: null/.test(chat));
  // The three now sit together and the assertion no longer demands they be
  // ADJACENT: `activities` (the ledger of games already finished) joined them,
  // and a check that pins line order is a check that fails on the next correct
  // addition. What it pins is that all three are cleared in the same wipe.
  ok("teardown clears the callback", /game: null,[\s\S]{0,900}callback: null/.test(chat));
  ok(
    "teardown clears the finished-game ledger too",
    /game: null,[\s\S]{0,900}activities: \[\]/.test(chat),
  );
  ok("undo restores the game too", /game: snap\.game/.test(chat));
}

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
ok("call lane pokes per move", /activityNote\(fact\)/.test(call));
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
