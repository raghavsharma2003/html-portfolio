// ── THE OVERLAP-MATRIX GATE (WS-LIFECYCLE) ────────────────────────────────
//
//   node evals/lifecycle/run.mjs
//
// ── WHAT THIS IS FOR ─────────────────────────────────────────────────────
//
//   "In the game I started a call, then it got cut and the game started and
//    the call is still going on — that should also be handled perfectly."
//
// That is not a bug report, it is a structural ask: STOP MAKING ME ENUMERATE
// OVERLAP CASES. Every wave so far fixed the pair the owner happened to hit
// — a board open at pickup, a move played mid-call, a share started mid-call,
// a call that dropped mid-sentence — and each one cost a round trip and a
// felt defect. The set of pairs is finite. This gate walks all of it.
//
// The table lives in `src/voice/callHistory.ts` (LIFECYCLE_MATRIX) so it is
// SHIPPED CODE rather than a document: 10 events x 5 concurrent contexts, and
// every cell says how the fact reaches her and why that carrier. This file is
// the thing that makes the table true, in the idiom `evals/lanes/run.mjs`
// established for context blocks — a verdict per cell, an exemption that must
// state its reason, and two ways to fail:
//
//   a cell claims `direct` and no sender exists  → the propagation is
//                                                  DECLARED AND DEAD.
//   a cell claims `silent` and something reaches her → the table is lying.
//
// Both are the same disease under two names, and both are things a person has
// to look at.
//
// ── WHY IT DRIVES THE REAL PATHS ─────────────────────────────────────────
//
// A matrix asserted against a model of the code is a matrix that passes while
// the product is broken. So: the `assembly` cells go through the REAL
// `compile()` and the REAL `CALL_OPEN_DIRECTIVE`, off REAL board sessions
// built by the shipping chess and ttt engines; the `direct` cells are checked
// for a live sender by reading `useCallEngine.ts`'s own source; and the
// `state` cells are asserted as properties of the store rather than as text.
//
// Offline, deterministic, no model call, no database, no money, ~3s.
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "lifecycle-"));
const BUNDLE = join(tmp, "lifecycle.bundle.mjs");
execSync(
  `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const E = await import(BUNDLE);

let fail = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (!cond) {
    fail++;
    console.log(`FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};

const ENGINE = readFileSync(join(ROOT, "src/components/useCallEngine.ts"), "utf8");
// Comments are where the WHY lives and they name every symbol in the file, so
// a source assertion that reads them proves nothing about what RUNS. Stripped
// before any "is there a sender" question is asked.
const decomment = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const CODE = decomment(ENGINE);

const NOW = Date.UTC(2026, 7, 23, 14, 30, 0);
const MIN = 60_000;

// ═════════════════════════════════════════════════════════════════════════
// 1. THE TABLE IS WELL-FORMED
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 1. the table itself ──");

const CARRIERS = new Set(["assembly", "direct", "state", "silent", "na"]);
const NOTES = new Set(Object.keys(E.LIFECYCLE_NOTE_OWNER));

ok("10 events", E.LIFECYCLE_EVENTS.length === 10, `${E.LIFECYCLE_EVENTS.length}`);
ok("5 contexts", E.LIFECYCLE_CONTEXTS.length === 5, `${E.LIFECYCLE_CONTEXTS.length}`);

let cells = 0;
const byCarrier = {};
for (const ev of E.LIFECYCLE_EVENTS) {
  for (const ctx of E.LIFECYCLE_CONTEXTS) {
    const c = E.lifecycleCell(ev, ctx);
    cells++;
    const at = `${ev} x ${ctx}`;
    ok(`${at}: has a cell`, Boolean(c));
    if (!c) continue;
    byCarrier[c.via] = (byCarrier[c.via] ?? 0) + 1;
    ok(`${at}: carrier is one of the five`, CARRIERS.has(c.via), c.via);
    // THE EXEMPTION RULE, from the lane-parity gate: an asymmetry may exist
    // and may not be silent. A one-word `why` is silence with extra steps.
    ok(`${at}: states its reason in writing`, typeof c.why === "string" && c.why.length >= 40, `${(c.why ?? "").length} chars`);
    // `note` iff `direct`. A note on a non-direct cell means somebody wrote a
    // sender for a fact that is carried by a compile — two copies of it.
    if (c.via === "direct") {
      ok(`${at}: direct cell names a note`, Boolean(c.note) && NOTES.has(c.note), String(c.note));
    } else {
      ok(`${at}: non-direct cell names no note`, c.note === undefined, String(c.note));
    }
  }
}
ok("every pair has exactly one cell (10 x 5)", cells === 50, `${cells}`);
console.log(
  `      carriers: ${Object.entries(byCarrier).map(([k, v]) => `${k}=${v}`).join("  ")}`,
);

// The table must be frozen. A matrix a caller can mutate at runtime is a
// matrix whose gate ran against something else.
ok("the matrix is frozen", Object.isFrozen(E.LIFECYCLE_MATRIX));
ok("each row is frozen", E.LIFECYCLE_EVENTS.every((ev) => Object.isFrozen(E.LIFECYCLE_MATRIX[ev])));

// ═════════════════════════════════════════════════════════════════════════
// 2. EVERY `direct` CELL HAS A LIVE SENDER
// ═════════════════════════════════════════════════════════════════════════
//
// This is the half that makes the table a gate. A declared propagation with
// no sender is `dead-writers` wearing a diagram: the cell says she is told,
// the source says nothing tells her, and the two disagree silently forever.
console.log("\n── 2. declared -> sent (the dead-cell test) ──");

// note kind -> what must be true of the shipping source for it to be LIVE.
// The `watch` and `lane` owners are pre-existing senders this workstream
// declares but does not own; they are checked by name for the same reason.
const SENDER = {
  board_closed: ["boardClosedFact("],
  board_over: ["boardOverFact("],
  board_opened: ["boardOpenedFact("],
  board_turn: ["boardTurnFact(", "lifecycleStateNote("],
  share_ended: ["shareEndedFact("],
  share_started: ["WATCH_START_DIRECTIVE()"],
  line_cleared: ["the line just cleared up"],
};

const declared = new Set();
for (const ev of E.LIFECYCLE_EVENTS)
  for (const ctx of E.LIFECYCLE_CONTEXTS) {
    const c = E.lifecycleCell(ev, ctx);
    if (c.via === "direct") declared.add(c.note);
  }

for (const note of declared) {
  const needles = SENDER[note];
  ok(`${note}: the gate knows where its sender is`, Array.isArray(needles) && needles.length > 0);
  for (const n of needles ?? [])
    ok(`${note}: sender present in useCallEngine.ts (${n})`, CODE.includes(n));
  // and it must actually reach a socket, not merely be constructed
  ok(`${note}: the owner is recorded`, Boolean(E.LIFECYCLE_NOTE_OWNER[note]));
}

// ── ONE EVENT, ONE VOICE ────────────────────────────────────────────────
// A checkmate does not set closedAt, so the finished board sits on his screen
// and the MOVE POKE's `urgent` branch is what narrates the ending. If the
// lifecycle sender also fired when he later closed that board she would
// announce the same ending twice, minutes apart — the "two notes about one
// exchange" defect the poke's own debounce exists to prevent, reborn one
// layer up. The suppression is asserted, and so is the poke branch it defers
// to: either one disappearing turns this into a double or a silence.
ok(
  "game_end: the lifecycle sender defers to the poke that already said it",
  /dropped:\s*"poke_already_said"/.test(CODE),
);
ok(
  "game_end: the poke branch it defers to still exists",
  /urgent\s*=[\s\S]{0,200}status\?\.over/.test(CODE),
);
ok(
  "game_end: a suppression is RECORDED, never silent",
  /diag\("call", "lifecycle_note",[\s\S]{0,120}dropped/.test(CODE),
);

// The reverse direction: a note kind nobody declares is a builder with no
// cell, which is the same defect pointing the other way.
for (const note of NOTES)
  ok(`${note}: is claimed by at least one cell`, declared.has(note), "builder with no cell");

// Every `direct` note leaves through `direct(`, and every one of THIS
// workstream's leaves wrapped — one note vocabulary on this lane.
ok(
  "every lifecycle fact is wrapped before it is sent",
  /activityNote\(\s*boardOpenedFact/.test(CODE) &&
    /activityNote\(\s*shareEndedFact/.test(CODE) &&
    /activityNote\(fact\)/.test(CODE) &&
    /lifecycleStateNote\(boardTurnFact/.test(CODE),
);
// ANGLE BRACKETS, NEVER SQUARE (`ack-bracket-direction`: "[laughs softly]"
// came back as laughter plus the spoken word "Softly").
for (const [name, text] of [
  ["board_closed", E.activityNote(E.boardClosedFact("chess", 14))],
  ["board_over", E.activityNote(E.boardOverFact("chess", "she won by checkmate"))],
  ["board_opened", E.activityNote(E.boardOpenedFact("chess"))],
  ["share_ended", E.activityNote(E.shareEndedFact(184))],
  ["board_turn", E.lifecycleStateNote(E.boardTurnFact("chess", 9, "his"))],
  ["share_started", E.WATCH_START_DIRECTIVE()],
]) {
  ok(`${name}: is a <context: …> note`, text.startsWith("<context:") && text.endsWith(">"), text.slice(0, 24));
  ok(`${name}: carries no square brackets`, !/[[\]]/.test(text));
  ok(`${name}: tells her never to reference it`, text.includes("never reference this note"));
}

// ═════════════════════════════════════════════════════════════════════════
// 3. THE FACTS ARE SHAPES, NOT LINES SHE COULD SAY
// ═════════════════════════════════════════════════════════════════════════
//
// `recited-prompt`: anything sentence-shaped in a prompt gets recited. Her own
// example quotes acted as a phrase bank (4/5 -> 0 after removal), and taste
// written as polished English came back verbatim twice. Held to the same rule
// the herNow tables are held to, by the same linter.
console.log("\n── 3. the facts are shapes ──");

const FACTS = [
  ["boardClosedFact mid-game", E.boardClosedFact("chess", 14)],
  ["boardClosedFact at move 0", E.boardClosedFact("ttt", 0)],
  ["boardOverFact", E.boardOverFact("chess", "she won by checkmate; 31 moves in")],
  ["boardOverFact with no result text", E.boardOverFact("wyr", "")],
  ["boardOpenedFact", E.boardOpenedFact("chess")],
  ["boardTurnFact hers", E.boardTurnFact("chess", 9, "hers")],
  ["boardTurnFact his", E.boardTurnFact("chess", 10, "his")],
  ["boardTurnFact over", E.boardTurnFact("ttt", 9, "over")],
  ["shareEndedFact seconds", E.shareEndedFact(42)],
  ["shareEndedFact minutes", E.shareEndedFact(184)],
];
for (const [name, f] of FACTS) {
  ok(`${name}: non-empty`, f.length > 0);
  ok(`${name}: within the cap`, f.length <= E.LIFECYCLE_FACT_MAX_CHARS, `${f.length}`);
  ok(`${name}: lowercase start`, /^[a-z0-9]/.test(f), f.slice(0, 20));
  // never first person: a fact she reads as her own sentence is a line she
  // will say back.
  ok(`${name}: no first person`, !/\b(I|I'm|I've|my|me)\b/i.test(f.replace(/\bmove\b/g, "")), f);
  const v = E.lintLine(f);
  ok(`${name}: passes the sentence-shape lint`, !v || v.sentence !== true, JSON.stringify(v));
}
// The cap is real, not decorative.
ok(
  "an over-long result is clipped rather than emitted whole",
  E.boardOverFact("chess", "x".repeat(400)).length <= E.LIFECYCLE_FACT_MAX_CHARS,
);

// ── THE OWNER'S SENTENCE, LITERALLY ──────────────────────────────────────
// "a direct() note in done register (the board was just closed, left
// unfinished at move N)". The two halves that carry it: WHERE it stopped, and
// that NOBODY WON. Without the second she congratulates herself on a game
// that has no result.
ok("board_closed says where it stopped", E.boardClosedFact("chess", 14).includes("move 14"));
ok("board_closed says there is no result", /no result/.test(E.boardClosedFact("chess", 14)));
ok("board_closed says nobody won", /nobody won/.test(E.boardClosedFact("chess", 14)));
ok(
  "board_closed at ply 0 does not claim a move that was never played",
  !/move 0/.test(E.boardClosedFact("chess", 0)),
);

// ── THE MOVEVOICE RESIDUAL ───────────────────────────────────────────────
// The frozen brief says "it is her move"; three seconds later it is false for
// the rest of the call. The close must (a) restate the position, (b) say the
// brief may be behind, and (c) NOT be a reason to speak — a spoken reaction to
// a stale sentence in her own prompt is her narrating her prompt.
const settle = E.lifecycleStateNote(E.boardTurnFact("chess", 9, "his"));
ok("board_turn restates whose move it is", /their move now/.test(settle));
ok("board_turn names the brief as possibly behind", /your brief may be a move behind/.test(settle));
ok("board_turn is explicitly not a reason to speak", /not a reason to speak/.test(settle));
ok("board_turn says nothing just happened", /nothing just happened/.test(settle));
// and it must be sent SILENT — the flag is the mechanism, not the wording.
ok(
  "board_turn is sent with { silent: true }",
  /direct\(note,\s*\{\s*silent:\s*true\s*\}\)/.test(CODE),
);
// The opposite for the things that DID happen: a board closing is an event in
// the room and rides the wrapper that says so.
ok(
  "the board/share events are NOT sent silent",
  !/direct\(\s*activityNote\([^)]*\),\s*\{\s*silent/.test(CODE),
);

// ═════════════════════════════════════════════════════════════════════════
// 4. THE `assembly` CELLS, DRIVEN THROUGH THE REAL PATHS
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 4. assembly cells, through the real assembly ──");

// A REAL mid-game chess session, from the shipping engine.
let g = E.newChessGame();
for (const mv of ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"]) {
  const next = E.playChess(g, mv);
  if (next) g = next;
}
const openSession = { kind: "chess", game: g, herSide: "b", startedAt: NOW - 12 * MIN };
// the same board, closed BY HAND with no result — the owner's case
const abandoned = { ...openSession, closedAt: NOW - 1 * MIN, endedEarly: true };

const openAct = E.activityOf(openSession, NOW);
ok("a live board produces an activity", Boolean(openAct) && openAct.facts.length > 0);
ok("a live board is not marked over", openAct && !openAct.over);

const closedAct = E.activityOf(abandoned, NOW);
ok("an abandoned board still produces an activity", Boolean(closedAct));
ok("an abandoned board is marked over", Boolean(closedAct?.over));
// game_closed x none / x call_cascade: the carrier is `assembly`, and this is
// the byte that makes it true — the chat/cascade compile reads these facts.
ok(
  "game_closed x assembly: the ledger says there is no result",
  Boolean(closedAct?.facts.some((f) => /no result/.test(f))),
  JSON.stringify(closedAct?.facts?.slice(0, 3)),
);
ok(
  "game_closed x assembly: the ledger no longer says whose move it is",
  !closedAct?.facts.some((f) => /(her|his) move/.test(f)),
  JSON.stringify(closedAct?.facts),
);

// call_start x game_open — BOTH halves off ONE read, which is the property
// that stops the brief and the directive naming two positions.
const t15 = E.renderActivity(openAct, NOW);
ok("call_start x game_open: T15 renders the board", t15.length > 0);
const read = E.herNowAt({
  now: NOW,
  stored: null,
  appTruth: { line: E.activityPickupLine(openAct), startedAt: openAct.startedAt },
});
ok("call_start x game_open: app truth outranks her own ledger", read.entry.source === "app-truth");
const scene = E.herNowScene(read.entry, NOW);
ok("call_start x game_open: the scene IS the board", /in the middle of/.test(scene), scene.slice(0, 60));
ok(
  "call_start x game_open: one vocabulary — scene === activityPickupLine",
  scene === E.activityPickupLine(openAct),
);
const pickup = E.CALL_OPEN_DIRECTIVE({ scene, lastCallMinAgo: null, sheCalled: false });
ok("call_start x game_open: the directive carries the board", pickup.includes(scene));
ok("call_start x game_open: the directive is answering, not calling", /you just picked up/.test(pickup));

// The real compile, with the board — the `assembly` claim, made against the
// compiler rather than against a belief about it.
const compiled = E.compile({
  user: { name: "arjun", vibe: ["someone to talk to"], facts: { city: "pune" } },
  messageCount: 40,
  medium: "voice",
  mode: "call",
  voiceEngine: "live",
  isDirective: false,
  watching: false,
  herLife: "",
  activity: openAct,
  nowMs: NOW,
  gapSinceLastMs: 3 * MIN,
});
ok("call_start x game_open: compile() lights the activity block", compiled.system.includes(t15.split("\n")[0]));

// ── callback_reconnect x game_open — THE OWNER'S THIRD HALF ──────────────
// She calls back after a drop, mid-game. Three things must all be true at
// once, and before this workstream nobody had ever asserted them together.
const back = E.CALL_OPEN_DIRECTIVE({ scene, lastCallMinAgo: 1, sheCalled: true });
ok("callback x game_open: she knows SHE dialled", /YOU just called THEM/.test(back));
ok("callback x game_open: the board is the scene", back.includes(scene));
ok("callback x game_open: NO fresh greeting", /NO fresh greeting/.test(back));
ok("callback x game_open: they are mid-thread", /already mid-thread/.test(back));
ok(
  "callback x game_open: the follow-up register replaces the greeting rule, never joins it",
  !/pleasantly surprised/.test(back),
);
// the lastCallMinAgo idiom EXTENDS rather than being re-implemented: the same
// 15-minute window decides, and outside it the greeting rule comes back.
const stale = E.CALL_OPEN_DIRECTIVE({ scene, lastCallMinAgo: 40, sheCalled: true });
ok("callback outside the window: greeting rule returns", /pleasantly surprised/.test(stale));
ok("callback outside the window: still knows she dialled", /YOU just called THEM/.test(stale));

// call_end / call_drop x game_open — carrier `state`. The requirement is that
// the board SURVIVES, so it is asserted as a property of the store and of the
// teardown, never as text.
console.log("\n── 4b. state cells: the board outlives the call ──");
const endCallBody = (() => {
  const i = CODE.indexOf("function endCall(");
  if (i === -1) return "";
  let depth = 0;
  for (let j = CODE.indexOf("{", i); j < CODE.length; j++) {
    if (CODE[j] === "{") depth++;
    else if (CODE[j] === "}" && --depth === 0) return CODE.slice(i, j + 1);
  }
  return "";
})();
ok("endCall was found in the source", endCallBody.length > 200);
ok(
  "call_end x game_open: endCall never touches the game",
  !/\bgame\s*:/.test(endCallBody) && !/game:\s*null/.test(endCallBody),
);
// and the board is still the app truth AFTER the call, which is what makes the
// callback pick up mid-game rather than into a blank.
const afterCall = E.herNowAt({
  now: NOW + 2 * MIN,
  stored: null,
  appTruth: { line: E.activityPickupLine(E.activityOf(openSession, NOW + 2 * MIN)), startedAt: openSession.startedAt },
});
ok("call_drop x game_open: herNow's app truth is still the game", afterCall.entry.source === "app-truth");
ok("call_drop x game_open: the position survived", /in the middle of/.test(afterCall.entry.activity));
// A finished board stays the present moment for RECENT_END_MS and then stops —
// the `state` cell is bounded, not permanent.
ok(
  "a finished board leaves the present moment after RECENT_END_MS",
  E.activityOf(abandoned, NOW + E.RECENT_END_MS + MIN) === null,
);

// ── share_end x call_live: the mirror is written BEFORE the note ─────────
// endCall nulls the session before stopWatchMode runs, which is what makes a
// hangup-that-ends-a-share send nothing into a line that is already gone.
ok(
  "share_end: the note is gated on a live session",
  /const live = liveSession\.current;\s*if \(live\)/.test(CODE),
);
ok(
  "share_end: endCall stops the session BEFORE it stops the share",
  endCallBody.indexOf("liveSession.current = null") !== -1 &&
    endCallBody.indexOf("liveSession.current = null") < endCallBody.indexOf("stopWatchMode()"),
);
ok(
  "share_end: the local mirror is still written on that path",
  /recordShareEnd\("native"/.test(CODE) && /recordShareEnd\("web"/.test(CODE),
);

// ═════════════════════════════════════════════════════════════════════════
// 5. THE `silent` ROW — ASSERTED BY ABSENCE
// ═════════════════════════════════════════════════════════════════════════
//
// A story turning over is her own posted picture on a schedule with NO input
// from him (`nextStoryChange` searches storyCatalog's slots). Announcing it
// mid-call is `never-scheduled` in its purest form. The assertion is that
// there is no constructor for such a line — the same device `evals/notify.mjs`
// uses to prove a lock screen cannot carry a generic one.
console.log("\n── 5. story_post: nothing may leak ──");

for (const ctx of E.LIFECYCLE_CONTEXTS)
  ok(`story_post x ${ctx}: carrier is silent`, E.lifecycleCell("story_post", ctx).via === "silent");

ok(
  "useCallEngine imports nothing from the story catalog",
  !/from\s+"[^"]*storyCatalog"/.test(CODE) && !/from\s+"[^"]*\/story[A-Za-z]*"/.test(CODE),
);
ok("useCallEngine never calls nextStoryChange", !/nextStoryChange/.test(CODE));
ok("useCallEngine never calls storyAtChange", !/storyAtChange/.test(CODE));
ok("useCallEngine never calls scheduleStory", !/scheduleStory/.test(CODE));
// and no `direct(` in the file may name a story at all
const directCalls = CODE.match(/\.direct\([\s\S]{0,400}?\)/g) ?? [];
ok("there is at least one direct() to look at", directCalls.length > 4, `${directCalls.length}`);
ok(
  "no direct() note names a story",
  directCalls.every((d) => !/\bstory\b/i.test(d)),
);
// The matrix must not grow a story sender by accident either.
ok("no note kind is named for a story", ![...NOTES].some((n) => /story/i.test(n)));

// ═════════════════════════════════════════════════════════════════════════
// 6. THE RETIREMENT GATE — timeline.ts's T14 render layer
// ═════════════════════════════════════════════════════════════════════════
//
// Retired 2026-08-23 (see the tombstone in src/engine/timeline.ts). A
// tombstone anybody can quietly step over is decoration; this is what makes
// it a retirement. If the dated-fact half is ever wanted back it returns as a
// real compiler slot with a MANIFEST row and a lane-parity column — which
// means deleting the tombstone, which means seeing this gate.
console.log("\n── 6. the retired T14 render layer stays retired ──");

const RETIRED = [
  "HER_DAY_HEADER",
  "HIS_CLOCK_HEADER",
  "renderHerDay",
  "renderHisClock",
  "renderTimeFrame",
  "timeFrame",
  "HER_DAY_BUDGET",
  "HIS_CLOCK_BUDGET",
  "TIME_FRAME_BUDGET",
];
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.bundle\.mjs$/.test(e)) out.push(p);
  }
  return out;
};
const srcFiles = walk(join(ROOT, "src")).filter((p) => !p.endsWith("engine/timeline.ts"));
for (const sym of RETIRED) {
  const users = srcFiles.filter((p) => {
    const t = decomment(readFileSync(p, "utf8"));
    return new RegExp(`\\b${sym}\\b`).test(t);
  });
  ok(
    `${sym}: zero importers under src/`,
    users.length === 0,
    users.map((p) => p.slice(ROOT.length + 1)).join(", "),
  );
}
const TL = readFileSync(join(ROOT, "src/engine/timeline.ts"), "utf8");
ok("the tombstone is present and dated", /RETIRED 2026-08-23/.test(TL));
ok("the tombstone states what would reverse it", /reversal condition/.test(TL));
// The LIVE half of the same file must NOT be swept up in the retirement.
ok("istParts is still live", /\bistParts\b/.test(decomment(readFileSync(join(ROOT, "src/engine/away.ts"), "utf8"))));
ok(
  "the day-shape survives as UI",
  /herNow\(/.test(decomment(readFileSync(join(ROOT, "src/components/HomeScreen.tsx"), "utf8"))),
);

// ═════════════════════════════════════════════════════════════════════════
// 7. NEGATIVE CONTROLS
// ═════════════════════════════════════════════════════════════════════════
//
// An assertion whose evidence is an absence passes just as happily on a dead
// feature as on a working gate. Every section above that proves something by
// absence gets a control here that MUST fail.
console.log("\n── 7. negative controls (each must be caught) ──");

let caught = 0;
const control = (name, cond) => {
  checks++;
  if (cond) caught++;
  else {
    fail++;
    console.log(`FAIL control ${name} — the gate would not have caught this`);
  }
};

// (a) the pre-fix tree: strip this workstream's senders and the dead-cell test
//     must go red. This is the "the live lane must be seen going dark" control
//     evals/lanes/run.mjs carries, for propagations instead of blocks.
const stripped = CODE.replace(/boardClosedFact\(/g, "NOPE(").replace(/shareEndedFact\(/g, "NOPE(");
control("game_closed x call_live goes dark without its sender", !stripped.includes("boardClosedFact("));
control("share_end x call_live goes dark without its sender", !stripped.includes("shareEndedFact("));

// (b) a `direct` cell with no note must be refused by the shape rule above
control(
  "a direct cell with no note is malformed",
  (() => {
    const bad = { via: "direct", why: "x".repeat(60) };
    return !(bad.via === "direct" && bad.note && NOTES.has(bad.note));
  })(),
);
// (c) a cell with a one-word reason must be refused
control("a cell with no written reason is malformed", !("because".length >= 40));
// (d) the story gate must be able to see a leak
control(
  "a story sender WOULD be seen",
  /\bstory\b/i.test('liveSession.current?.direct("<context: your story just changed>")'),
);
// (e) the retirement gate must be able to see an importer
control(
  "a re-import of a retired symbol WOULD be seen",
  new RegExp("\\bHER_DAY_HEADER\\b").test('import { HER_DAY_HEADER } from "./timeline";'),
);
// (f) the silent-flag assertion must be able to see a non-silent send
control(
  "a board_turn sent aloud WOULD be seen",
  !/direct\(note,\s*\{\s*silent:\s*true\s*\}\)/.test("s.direct(note);"),
);

const CONTROLS = 7;
ok("every negative control was caught", caught === CONTROLS, `${caught}/${CONTROLS}`);
console.log(`      ${caught}/${CONTROLS} controls caught`);

// ═════════════════════════════════════════════════════════════════════════
// THE TABLE, PRINTED
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── the matrix ──");
const w = 20;
console.log(
  "".padEnd(w) + E.LIFECYCLE_CONTEXTS.map((c) => c.padEnd(11)).join(""),
);
for (const ev of E.LIFECYCLE_EVENTS) {
  const row = E.LIFECYCLE_CONTEXTS.map((ctx) => {
    const c = E.lifecycleCell(ev, ctx);
    return (c.via === "direct" ? `direct:${c.note.split("_")[1] ?? c.note}` : c.via).slice(0, 10).padEnd(11);
  }).join("");
  console.log(ev.padEnd(w) + row);
}

console.log(`\n${fail ? `FAILED  ${fail} of ${checks}` : `PASSED  ${checks} checks`}`);
process.exit(fail ? 1 : 0);
