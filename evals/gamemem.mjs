// THE MEMORY CLUSTER — #113 (finished activities become graph episodes), the
// live-turn laundering window (docs/audit/2026-08-22-honesty.md), #85 (a
// forgotten photo's FILE), and a standing probe for #95 (T12 self.arc).
//
//   node evals/gamemem.mjs
//
// Offline, deterministic, db-free, network-free, model-free, ~2s. It bundles
// the REAL src/engine/memory.ts and imports the REAL api/memory.js — no
// re-implementation of either predicate, because a predicate tested through a
// copy is a copy that was tested (`gates-that-live-nowhere`).
//
// api/memory.js reaches api/_config.js, which is gitignored. CI already writes
// a stub for it (`node scripts/write-config.mjs --stub` in build-apk.yml, ahead
// of evals/run.mjs), and nothing in this suite executes a query, so the import
// is safe here in exactly the way evals/trace/run.mjs's is.
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const tmp = mkdtempSync(join(tmpdir(), "gamemem-"));
const bundlePath = join(tmp, "gamemem.bundle.mjs");
execSync(
  `npx esbuild ${join(HERE, "_gamemem-entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${bundlePath} --log-level=error ` +
    `--alias:@capacitor/core=${join(HERE, "stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const E = await import(bundlePath);
const S = await import(join(ROOT, "api/memory.js"));

let passed = 0;
let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};
const note = (s) => console.log(`  note  ${s}`);

// A fixed instant, so every expected string in this file is a literal rather
// than something recomputed from the clock the same way the code under test
// computes it (a test that derives its expectation the same way the code does
// asserts nothing).
// Built from LOCAL parts, not an ISO instant: episodeDateLabel reads the local
// calendar day (it is a memory of a day THEY had), so an instant would make
// this file's literals depend on the runner's timezone.
const CLOSED = new Date(2026, 7, 22, 15, 4).getTime();
const STARTED = CLOSED - 21 * 60_000;

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§1 the episode shape — kind-agnostic, telegraphic, budgeted");
// ═════════════════════════════════════════════════════════════════════════

const chess = {
  kind: "chess",
  startedAt: STARTED,
  closedAt: CLOSED,
  facts: ["she won, by checkmate", "she is playing white", "17 moves in"],
};
const chessLine = E.activityEpisodeSummary(chess, E.LABEL.chess);
ok(
  "a finished game reads as a memory, not a scoresheet",
  chessLine === "a game of chess together on 22 aug — she won, by checkmate; she is playing white; 17 moves in",
  chessLine,
);
ok("the date is in it", chessLine.includes("22 aug"), chessLine);

const early = E.activityEpisodeSummary(
  {
    kind: "chess",
    startedAt: STARTED,
    closedAt: CLOSED,
    // activityOf's own wording for an End-game / abandoned board: it puts this
    // row FIRST and strips the live rows, so the episode inherits the honest
    // ending rather than inventing a winner
    facts: ["he ended the game early, no result", "she is playing black", "9 moves in"],
  },
  E.LABEL.chess,
);
ok("an early ending survives into the memory", early.includes("ended the game early, no result"), early);
ok("and names no winner", !/\b(she|he) won\b/.test(early), early);

const wyr = E.activityEpisodeSummary(
  {
    kind: "wyr",
    startedAt: STARTED,
    closedAt: CLOSED,
    facts: [
      "the question: chai for life or coffee for life",
      "he picked chai, she picked coffee, that's a clash",
      "12 rounds so far",
      "7 agreed, 5 clashed so far",
    ],
  },
  E.LABEL.wyr,
);
ok("a wyr session carries its tally", wyr.includes("7 agreed, 5 clashed so far"), wyr);
ok("and drops the card that was still on screen", !wyr.includes("the question:"), wyr);

// The moment/memory boundary, one row at a time. Each of these is TRUE while
// the activity is live and FALSE the moment it is a memory.
for (const row of ["it is her move", "it is his move", "she is in check", "he is in check", "just started", "the game has just started"]) {
  const out = E.activityEpisodeSummary(
    { kind: "chess", startedAt: STARTED, closedAt: CLOSED, facts: [row, "she is playing white"] },
    E.LABEL.chess,
  );
  ok(`a present-moment row never enters the record: "${row}"`, !out.includes(row), out);
}
ok(
  "MOMENT_ROW_RE is shape-matched, not kind-matched",
  E.MOMENT_ROW_RE.test("it is her move") && !E.MOMENT_ROW_RE.test("she won, by checkmate"),
);

// KIND-AGNOSTIC. The next activity is an adapter and zero lines of this file —
// so a kind that does not exist yet must produce the same shape.
const future = E.activityEpisodeSummary(
  { kind: "antakshari", startedAt: STARTED, closedAt: CLOSED, facts: ["she ran out of songs on 'm'"] },
  "a round of antakshari",
);
ok(
  "an activity that does not exist yet needs no code here",
  future === "a round of antakshari together on 22 aug — she ran out of songs on 'm'",
  future,
);

// THE BUDGET, and the law it obeys: whole facts drop from the END, nothing is
// ever sliced (`silent-truncation`).
const longFacts = Array.from({ length: 12 }, (_, i) => `a reasonably long fact number ${i} about the game`);
const capped = E.activityEpisodeSummary({ kind: "chess", startedAt: STARTED, closedAt: CLOSED, facts: longFacts }, E.LABEL.chess);
ok("the summary respects its budget", capped.length <= E.EPISODE_SUMMARY_MAX, `${capped.length}`);
const [, tail = ""] = capped.split(" — ");
const rendered = tail ? tail.split("; ") : [];
ok(
  "and drops WHOLE facts rather than slicing one",
  rendered.every((r) => longFacts.includes(r)),
  JSON.stringify(rendered.filter((r) => !longFacts.includes(r))),
);

// THE WE-CLASSIFIER COUPLING. api/consolidate.js:209 decides participation
// from the summary's own words, and 'we' is what makes an episode reachable as
// a we-callback and as legitimate support for a shared-past claim. Restated
// here verbatim rather than imported (it is not exported) — if that regex ever
// moves, this is the line that catches the drift.
const WE_TOKEN_RE = /\b(dono|dono[nm]e|saath|sath|we|together|hum(dono)?|humne)\b/i;
for (const [name, line] of [["chess", chessLine], ["wyr", wyr], ["a future kind", future]]) {
  ok(`${name}'s episode classifies as participation='we'`, WE_TOKEN_RE.test(line), line);
}

// TELEGRAPHIC. Not a line she could say (`recited-prompt`: her own example
// quotes were recited on 4 of 5 turns).
ok(
  "the line is not sentence-shaped",
  !/^[A-Z]/.test(chessLine) && !/[.!?]$/.test(chessLine),
  chessLine,
);
ok("the date label is stable and lowercase", E.episodeDateLabel(CLOSED) === "22 aug", E.episodeDateLabel(CLOSED));
ok("a garbage timestamp yields no date rather than a fake one", E.episodeDateLabel(NaN) === "");

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§2 the idempotence key — the session's start, never the close");
// ═════════════════════════════════════════════════════════════════════════

const k1 = S.activityFactName("chess", STARTED);
ok("same session → same key", k1 === S.activityFactName("chess", STARTED));
ok(
  "the close time is not part of it (two devices notice a close at different ms)",
  S.activityFactName("chess", STARTED) === S.activityFactName("chess", STARTED),
);
ok("a float ms cannot fork the key", S.activityFactName("chess", STARTED + 0.4) === k1, S.activityFactName("chess", STARTED + 0.4));
ok("a different session is a different key", S.activityFactName("chess", STARTED + 1) !== k1);
ok("a different kind is a different key", S.activityFactName("ttt", STARTED) !== k1);
ok("it fits vy_fact.name's 60-char slice", S.activityFactName("antakshari", STARTED).length <= 60);
ok("and is recognisable in the table", /^activity:chess:\d+$/.test(k1), k1);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3 the reconciler's own input — activityOf at the close");
// ═════════════════════════════════════════════════════════════════════════

// A finished board, in the shape state/game.ts guards for (isGameSession).
const mated = {
  kind: "chess",
  herSide: "w",
  startedAt: STARTED,
  closedAt: CLOSED,
  game: {
    fen: "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2",
    played: Array.from({ length: 34 }, (_, i) => ({ san: `m${i}` })),
    status: { over: true, result: "checkmate", winner: "w", turn: "b" },
  },
};
const atClose = E.activityOf(mated, CLOSED + 1);
ok("the closed session still derives an activity at the instant it closed", Boolean(atClose));
ok("marked over", atClose?.over === true);
ok("carrying who won", atClose?.facts?.some((f) => f.includes("won")), JSON.stringify(atClose?.facts));
// THE REASON the reconciler passes closedAt + 1 rather than Date.now(): past
// the afterglow there is no activity left to emit, so a session that closed on
// another device and synced here hours later would silently write nothing.
ok(
  "past the afterglow the present moment is gone (why the emission does not use now())",
  E.activityOf(mated, CLOSED + E.RECENT_END_MS + 1) === null,
);
const fromReal = E.activityEpisodeSummary(
  { kind: atClose.kind, facts: atClose.facts, startedAt: mated.startedAt, closedAt: mated.closedAt },
  E.LABEL[atClose.kind],
);
ok("a real closed session produces a real episode line", /^a game of chess together on 22 aug — /.test(fromReal), fromReal);
ok("with no live rows in it", !/it is (her|his) move/.test(fromReal), fromReal);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4 the laundering window — her ungated live turns");
// ═════════════════════════════════════════════════════════════════════════

// docs/audit/2026-08-22-honesty.md: her live-lane turns are logged with no
// guardReply, reach opRemember's window, become graph nodes, come back as
// `memories`, and thereafter LICENSE the same fabrication on the chat lane
// through sharedVocabulary. The fabrication in the audit is the Goa trip.
const HIS = (content, channel = "chat") => ({ role: "me", channel, content });
const HERS = (content, channel = "chat") => ({ role: "her", channel, content });
const GOA = { name: "goa trip", summary: "they went to goa together and loved the beach" };

const laundered = S.nonLaunderedNodes([GOA], [
  HIS("kaam bohot tha aaj office me"),
  HERS("yaad hai hum goa gaye the", "call"),
]);
ok(
  "a shared past she invented ALOUD never reaches the graph",
  laundered.kept.length === 0 && laundered.dropped.length === 1,
  JSON.stringify(laundered.kept),
);

ok(
  "the same node stands when HE typed the word",
  S.nonLaunderedNodes([GOA], [HIS("goa ka plan bana raha hu"), HERS("acha!", "call")]).kept.length === 1,
);
ok(
  "and when HE said it on the call — his words are ground truth on every channel",
  S.nonLaunderedNodes([GOA], [HIS("hum goa gaye the na", "call"), HERS("haan yaar", "call")]).kept.length === 1,
);
ok(
  "and when SHE typed it — the chat lane runs guardReply over her output",
  S.nonLaunderedNodes([GOA], [HERS("hum goa gaye the na", "chat"), HIS("haan")]).kept.length === 1,
);
ok(
  "a window with no spoken turn of hers is untouched",
  S.nonLaunderedNodes([GOA], [HIS("goa"), HERS("haan")]).dropped.length === 0,
);
ok(
  "an older client that sends no channel behaves exactly as today",
  S.nonLaunderedNodes([GOA], [{ role: "me", content: "kaam" }, { role: "her", content: "hum goa gaye the" }]).dropped
    .length === 0,
);
// THE OVER-DROP CONTROL, and it is the half that decides whether this ships:
// an extractor abstraction with no literal overlap anywhere is not evidence of
// laundering, and eating it would cost real memories to chase a shape this
// predicate cannot see.
ok(
  "an abstraction over HIS words is not laundering",
  S.nonLaunderedNodes([{ name: "career change", summary: "thinking about leaving the job" }], [
    HIS("yaar main job chhod raha hu shayad"),
    HERS("sach me?", "call"),
  ]).kept.length === 1,
);
ok(
  "her own life said on a call is not a shared-past node either way",
  S.nonLaunderedNodes([{ name: "sneha", summary: "her flatmate" }], [HIS("kya kar rahi hai"), HERS("sneha ke saath dinner", "call")])
    .dropped.length === 1,
);
ok(
  "devanagari counts as content",
  S.nonLaunderedNodes([{ name: "गोवा", summary: "साथ गए थे" }], [HIS("kaam"), HERS("हम गोवा गए थे", "call")]).dropped
    .length === 1,
);
ok("the tokenizer floor matches family 4's (≥3), not family 3's (≥4)", S.contentTokens("goa gym ok").join(",") === "goa,gym");
ok("nothing is mutated", (() => {
  const nodes = [GOA];
  S.nonLaunderedNodes(nodes, [HERS("goa", "call")]);
  return nodes.length === 1 && nodes[0] === GOA;
})());

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§5 a forgotten photo takes its file (#85)");
// ═════════════════════════════════════════════════════════════════════════

const DEV = "11111111-2222-3333-4444-555555555555";
const objectPath = `${DEV}/1755870000000-ab12cd.jpg`;
const publicUrl = `https://example.supabase.co/storage/v1/object/public/meera-photos/${objectPath}`;
// THE ROUND TRIP, and it is the whole mechanism: upload names the object,
// recordPhotoMemory turns that name into the fact's name, and a forget turns
// the fact's name back into the object. Every hop is the shipping function.
const factName = `photo:${S.photoIdFromUrl(publicUrl)}`;
ok("the fact name is derived from the object", factName === "photo:1755870000000-ab12cd", factName);
ok(
  "and the forget derives the object back from the fact",
  S.photoPathsFromFactNames(DEV, [factName])[0] === objectPath,
  JSON.stringify(S.photoPathsFromFactNames(DEV, [factName])),
);
ok("ordinary facts name no files", S.photoPathsFromFactNames(DEV, ["sneha", "goa trip", "meera:flat"]).length === 0);
ok(
  "a URL-tail fallback id is never pasted into a delete path",
  S.photoPathsFromFactNames(DEV, [`photo:${S.photoIdFromUrl("https://elsewhere.example/x.png")}`]).length === 0,
);
ok("duplicates collapse", S.photoPathsFromFactNames(DEV, [factName, factName]).length === 1);
ok("nothing in, nothing out", S.photoPathsFromFactNames(DEV, undefined).length === 0);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§6 #95 — is T12 self.arc reachable without a rel-state row?");
// ═════════════════════════════════════════════════════════════════════════

const USER = { name: "Arjun", vibe: ["someone to talk to"], facts: { city: "Bengaluru" } };
const ARC = [
  {
    id: 1,
    agent_id: "00000000-0000-0000-0000-000000000000",
    dim: "patience",
    note: "less quick to snap now",
    from_note: "used to go quiet instead",
    citations: [1, 2, 3],
    span_days: 200,
    superseded_by: null,
    created_at: new Date().toISOString(),
  },
];
const compileBase = {
  user: USER, messageCount: 60, medium: "text", mode: "chat", voiceEngine: "gemini",
  isDirective: false, watching: false, innerThread: "", innerWants: "", memories: "",
  herLife: "", cultureNoteText: "", ageGates: null,
  latestUserText: "tu hamesha aisa hi karta hai yaar, mujhe gussa aa raha hai",
  gapSinceLastMs: 60_000,
};
const REL = {
  relState: {
    person_id: "p", honorific: "tum", cs_ratio: null, cs_on_stress: "unknown", trust: 0.4,
    rupture_open: false, repair_state: "none", ritual_density: 0, pacing_gap_s: null,
    snapshot_ver: 1, updated_at: new Date().toISOString(),
  },
  lastHonorificMoveAt: null, patterns: [], rituals: [], homeRegion: null, currency: [],
  weEpisodes: [], phrases: [], phraseLedger: [],
};
const selfOnly = E.compile({ ...compileBase, selfBundle: { texture: null, arc: ARC, untold: [] } });
const withRel = E.compile({ ...compileBase, relBundle: REL, selfBundle: { texture: null, arc: ARC, untold: [] } });

// The MECHANISM, asserted so the diagnosis cannot rot: renderSelfArc is
// moment-gated, and compiler.ts computes the moment ONLY inside
// `if (input.relBundle)`, so a person with no vy_rel_state row hands it "".
ok("renderSelfArc renders nothing without a moment", E.renderSelfArc(ARC, "") === "" || E.renderSelfArc(ARC, "").text === "");
ok("renderSelfArc renders WITH a moment", E.renderSelfArc(ARC, "conflict").text.length > 0);
ok("T12 lights up once a rel-state row exists", withRel.sections?.T12 > 0, `${withRel.sections?.T12}`);

if (selfOnly.sections?.T12 > 0) {
  ok("T12 is reachable with no rel-state row (#95 closed)", true);
} else {
  note("#95 STILL OPEN — T12 self.arc renders 0 bytes for a person with no vy_rel_state row.");
  note("  chain: no vy_rel_state row → fetchRelBundle returns null (api/memory.js) → compile()'s");
  note("  `gate` is null (src/engine/compiler.ts, `const gate = input.relBundle ? … : null`) →");
  note("  renderSelfArc(arc, gate?.moment || \"\") → the moment gate is shut.");
  note("  T11/T13 are unaffected (they read no moment). T12 alone is coupled.");
  note("  fix, verified byte-identical for the no-selfBundle and with-relBundle shapes:");
  note("    const gate = hasTurn");
  note("      ? momentGate(input.latestUserText || \"\", input.gapSinceLastMs || 0, input.relBundle?.phraseLedger || [])");
  note("      : { moment: \"none\" as const, pulled: false };");
  note("  This suite flips to a pass the moment that lands. compiler.ts was off this batch's file list.");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§7 the record carries the FACTS — the 2026-08-23 tester report");
// ═════════════════════════════════════════════════════════════════════════
//
// THE SEQUENCE, from the screenshots. He played two games of chess, then tic
// tac toe, then asked in chat: "What did you think of my opening in the chess
// game?" She answered "arre mastermind, tic tac toe khela tha humne 💀 / konsi
// queen aur konsi opening bhai, chess kab ho gaya 😭" — a denial — and when
// pressed produced "arre d4 chal ke b2 se bishop fiancehtto kiya tha tune 😭 /
// catalan thi na woh?", of which only `d4` was true.
//
// TWO CAUSES, and this section pins both.
//
//   (1) THE RECORD HAD NO FACTS. `activityEpisodeSummary` stored `facts`, and
//       `facts` is by design the PRESENT MOMENT: "he ended the game early;
//       she is playing black; 6 moves in". No moves. No opening past ply 16,
//       because `chessActivity` suppresses that row once it stops being news.
//       There was nothing to answer from.
//
//   (2) `AppState.game` IS ONE SLOT. Game two replaced game one, tic tac toe
//       replaced game two, and everything behind the current slot lived only
//       in the server graph — reachable only through `opRecall`'s semantic leg
//       (an embedding that may never have been written), because the keyword
//       leg reads `meera_nodes` and activities are never written there, and
//       the we-episode leg needs a `vy_rel_state` row a first-day person does
//       not have. So the ONLY thing in front of her was the tic tac toe, which
//       is exactly what she answered with.
//
// The ledger below is the answer to (2) and it is deliberately the half that
// cannot fail: no device id, no network, no embedding, no consolidation.
{
  const T0 = new Date(2026, 7, 22, 0, 30).getTime();
  const mk = (moves, herSide, startedAt) => {
    let g = E.newGame();
    for (const san of moves) g = E.play(g, san) ?? g;
    return { kind: "chess", game: g, herSide, startedAt };
  };

  // ── his first game: the Catalan, abandoned on move six ────────────────
  const one = mk(["d4", "Nf6", "c4", "e6", "g3", "d5", "Bg2", "Be7", "Nf3", "O-O", "O-O", "dxc4"], "b", T0);
  const closedOne = E.settleOccupant({ game: one, tally: {} }, T0 + 20 * 60_000).closed;
  ok("an abandoned game closes as ended-early", closedOne.endedEarly === true);
  // SIGNED OUT, and it is the point of the assertion rather than an aside: no
  // device id at all, and the memory is still produced. Before this the local
  // half did not exist and `emitClosedActivity` returned early without one.
  const recOne = E.emitClosedActivity(undefined, closedOne);
  ok("a signed-out close still produces a record", Boolean(recOne && recOne.summary), JSON.stringify(recOne));
  ok(
    "the abandoned game is remembered AS abandoned, and located",
    /left it unfinished on move 6, no result/.test(recOne.summary),
    recOne.summary,
  );
  ok("and it still names no winner", !/\bwon\b/.test(recOne.summary), recOne.summary);
  ok("the OPENING MOVES are in the record", /opened d4 Nf6 c4 e6 g3 d5/.test(recOne.summary), recOne.summary);
  ok("the opening's NAME is in the record", /the catalan opening/.test(recOne.summary), recOne.summary);
  ok("which colour she had is in the record", /she had black/.test(recOne.summary), recOne.summary);
  ok("and what was captured", /she took his pawn/.test(recOne.summary), recOne.summary);
  ok("the record fits the budget", recOne.summary.length <= E.EPISODE_SUMMARY_MAX, `${recOne.summary.length}`);

  // ── his second game: a decisive one ───────────────────────────────────
  // Scholar's mate, so the ending row has a winner AND a move number.
  const two = mk(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"], "w", T0 + 30 * 60_000);
  const closedTwo = E.settleOccupant({ game: two, tally: {} }, T0 + 45 * 60_000).closed;
  const recTwo = E.emitClosedActivity(undefined, closedTwo);
  ok("a decisive game records WHO won and HOW", /she won by checkmate on move 4/.test(recTwo.summary), recTwo.summary);
  ok("…and how it opened", /opened e4 e5 Bc4 Nc6 Qh5 Nf6/.test(recTwo.summary), recTwo.summary);

  // ── then tic tac toe, which is what she answered with ─────────────────
  const ttt = {
    kind: "ttt",
    herSide: "o",
    startedAt: T0 + 60 * 60_000,
    closedAt: T0 + 70 * 60_000,
    game: {
      board: ["x", "o", "x", "o", "x", "o", "x", null, null],
      played: [0, 1, 2, 3, 4, 5, 6].map((cell, i) => ({ cell, by: i % 2 ? "o" : "x" })),
      status: { over: true, result: "win", winner: "x", turn: "o" },
    },
  };
  const recTtt = E.emitClosedActivity(undefined, ttt);
  ok("the tic tac toe is a record too", /a game of tic tac toe together/.test(recTtt.summary), recTtt.summary);

  // ── THE LEDGER: all three, in the order a person carries them ─────────
  let ledger = [];
  for (const r of [recOne, recTwo, recTtt]) ledger = E.withActivityRecord(ledger, r);
  ok("three sessions, three memories", ledger.length === 3, JSON.stringify(ledger.map((r) => r.kind)));
  ok("newest first", ledger[0].kind === "ttt" && ledger[2].kind === "chess", JSON.stringify(ledger.map((r) => r.kind)));
  ok(
    "BOTH chess games survive the tic tac toe replacing them",
    ledger.filter((r) => r.kind === "chess").length === 2,
    JSON.stringify(ledger.map((r) => r.kind)),
  );
  // the dedupe is on the SESSION, matching the server's own idempotence key,
  // so a reconciler that runs twice cannot produce two memories of one game
  ok("a re-emitted close does not double the memory", E.withActivityRecord(ledger, recOne).length === 3);
  ok("…and the re-emitted copy takes the slot", E.withActivityRecord(ledger, recOne).some((r) => r === recOne));
  ok("nothing in, nothing out", E.withActivityRecord(undefined, null).length === 0);
  // bounded, because AppState is serialised to localStorage on every write
  let big = [];
  for (let i = 0; i < E.ACTIVITY_LEDGER_MAX + 5; i++)
    big = E.withActivityRecord(big, { kind: "chess", startedAt: i, closedAt: i, summary: `game ${i}` });
  ok("the ledger is bounded", big.length === E.ACTIVITY_LEDGER_MAX, `${big.length}`);
  ok("and it keeps the NEWEST", big[0].summary === `game ${E.ACTIVITY_LEDGER_MAX + 4}`, big[0].summary);

  // ── THE ANSWER SHE NOW HAS ────────────────────────────────────────────
  // three days on, which puts every one of the three sessions in the same
  // "2 days ago" bucket — the label is relative to each session's OWN close,
  // so a NOW only two days out reads "yesterday" for all of them and asserts
  // nothing about the arithmetic.
  const NOW = T0 + 3 * 86_400_000;
  const block = E.formatActivityLedger(ledger, NOW);
  ok("the block names chess when he asks about chess", /a game of chess together/.test(block));
  ok("…and the opening he actually played", /opened d4 Nf6 c4 e6 g3 d5, the catalan opening/.test(block), block);
  ok("…and does not pretend the tic tac toe was the only thing", (block.match(/a game of chess/g) || []).length === 2);
  // the ages are relative to each session's OWN close, so the tic tac toe an
  // hour later is a day younger than the chess — which is the point of the
  // label existing rather than one stamp for the whole block
  ok(
    "…dated the way a person places it",
    (block.match(/\(2 days ago\)/g) || []).length === 3,
    block.replace(/^[^\n]*\n/, ""),
  );
  ok("…and a fresh one says so plainly", /\(today\)/.test(E.formatActivityLedger(ledger, T0 + 71 * 60_000)));
  ok("…and states the boundary the record cannot enforce by itself", /never add a move, an opening, a question or a score that is not written here/.test(block), block.slice(0, 260));
  ok("no live row leaks into the memory", !/it is (her|his) move|the question: /.test(block), block);
  ok("nothing sentence-shaped she could recite", !/^- [A-Z]/m.test(block.split("\n").slice(1).join("\n")), block);
  ok("an empty ledger renders nothing", E.formatActivityLedger([], NOW) === "" && E.formatActivityLedger(undefined, NOW) === "");
  ok("the block never carries more rows than its cap", (E.formatActivityLedger(big, NOW).match(/^- /gm) || []).length <= E.ACTIVITY_LEDGER_ROWS);

  // ── THE DENY-THEN-INVENT SEQUENCE, REPRODUCED FIXED ───────────────────
  // The gate's support set is built from the same ledger the block above
  // renders, which is the whole shape of the fix: what she may SAY is bounded
  // by what she was HANDED, and she is now handed the truth.
  const support = E.activityVocabulary([
    ...ledger.map((r) => r.summary),
    "What did you think of my opening in the chess game?",
    "Usse pehle chess bhi khele the 2",
  ]);
  const FABRICATED = [
    "arre d4 chal ke b2 se bishop fiancehtto kiya tha tune",
    "material advantage tha phir bhi draw hua na",
    "dono rook board pe ghumte rahe, finish kar nahi paya tu",
    "my queen had your pawn for breakfast, just saying",
  ];
  for (const line of FABRICATED)
    ok(`the invention does not survive: ${line.slice(0, 40)}`, E.findActivitySpecifics(line, support).length > 0);
  // and the TRUE answer he was asking for does survive, unchanged
  for (const line of [
    "catalan opening thi teri, d4 se start kiya tha tune",
    "tune game beech me chhod diya tha yaar",
    "tic tac toe bhi khela tha humne uske baad",
    "yaar exact moves yaad nhi, but tune start strong kiya tha",
  ])
    ok(`the true answer survives: ${line.slice(0, 40)}`, E.findActivitySpecifics(line, support).length === 0);
  // end to end through the shipping gate
  {
    const bad = "arre d4 chal ke b2 se bishop fiancehtto kiya tha tune";
    const g = E.guardReply({ bubbles: [bad] }, { trustedText: ["system"], openItems: [], activityVocab: support });
    ok("the gate replaces the invented move", g.reply.bubbles[0] !== bad, g.reply.bubbles[0]);
    ok("…and the replacement invents nothing itself", E.findActivitySpecifics(g.reply.bubbles[0], support).length === 0, g.reply.bubbles[0]);
  }

  // ── THE WYR HALF: the questions, not a tally ──────────────────────────
  let w = E.freshSession("tester-salt", T0);
  for (let i = 0; i < 5; i++) {
    w = E.answerCurrent(w, i % 2 ? "a" : "b");
    w = E.advance(w);
  }
  const wrec = E.emitClosedActivity(undefined, { ...w, closedAt: T0 + 40 * 60_000 });
  ok("a wyr session records the QUESTIONS", /\bon .+ or .+, (?:he|both) picked /.test(wrec.summary), wrec.summary);
  ok("…and both picks, exactly, on a clash", /he picked .+, she picked /.test(wrec.summary), wrec.summary);
  ok("…and the tally survives the budget, because it is first", /^a round of would-you-rather together on 22 aug — 5 rounds, \d agreed, \d clashed/.test(wrec.summary), wrec.summary);
  ok("the wyr record fits the budget", wrec.summary.length <= E.EPISODE_SUMMARY_MAX, `${wrec.summary.length}`);
  ok("the card on screen never enters the memory", !/the question: /.test(wrec.summary), wrec.summary);
  {
    // the invented cards from the report, against the real deal
    const wsupport = E.activityVocabulary([wrec.summary, "Mujhe wo would you rather wale game ki choices teri kuch bahot oot patang lagi"]);
    for (const line of [
      "woh 18 me se 12 choices pe hamara agreement tha, bhool gaye kya",
      "dono pineapple pizza aur early morning runs pe disagree hue the",
      "wo pizza wala tune hi toh mana kiya tha aur subah 5 baje daudne wali madness tune choose ki thi",
    ])
      ok(`the invented card does not survive: ${line.slice(0, 34)}`, E.findActivitySpecifics(line, wsupport).length > 0);
    // a REAL round, quoted back out of the record, must survive — this is the
    // half that decides whether the family ships: a gate that eats the true
    // retelling costs the feature it was built to protect.
    const round = /on ([^,]+) or ([^,]+), he picked ([^,]+), she picked ([^;]+)/.exec(wrec.summary);
    if (round) {
      const real = `${round[1]} or ${round[2]} wala? tune ${round[3]} chuna tha, maine ${round[4].trim()}`;
      ok("a real round retold from the record survives", E.findActivitySpecifics(real, wsupport).length === 0, real);
    } else {
      note("no clashed round in this deal — the retelling control did not run");
    }
  }

  // ── SIGNED-IN AND SIGNED-OUT ARE THE SAME RECORD ──────────────────────
  // `logFinishedActivity` composes the summary ONCE and returns it; the device
  // id only decides whether a POST also goes out. Two devices, one memory —
  // `warm-count-unscoped`'s lesson applied before it can bite: a reader and a
  // writer that each derive the record will eventually disagree.
  const signedIn = E.logFinishedActivity("11111111-2222-3333-4444-555555555555", { kind: "chess", facts: [], record: E.chessRecord(one.game, "b", true), startedAt: T0, closedAt: T0 + 20 * 60_000 }, E.LABEL.chess);
  const signedOut = E.logFinishedActivity("", { kind: "chess", facts: [], record: E.chessRecord(one.game, "b", true), startedAt: T0, closedAt: T0 + 20 * 60_000 }, E.LABEL.chess);
  ok("signed-out parity: the same bytes either way", signedIn.summary === signedOut.summary, `${signedIn.summary}\n      ${signedOut.summary}`);
  ok("…and it is the same string the server is sent", signedOut.summary === recOne.summary);

  // ── THE LEDGER MERGES LIKE A LEDGER ───────────────────────────────────
  // A game played on the phone must not be a game the laptop denies.
  {
    const local = { messages: [], lastSeen: 0, activities: [recOne], user: { name: "", vibe: [], facts: {} } };
    const remote = { messages: [], activities: [recTtt] };
    const merged = E.mergeStates(local, remote);
    ok("both devices' games survive the merge", merged.activities.length === 2, JSON.stringify(merged.activities.map((r) => r.kind)));
    ok("the same session on both is ONE memory", E.mergeStates({ ...local, activities: [recOne] }, { activities: [recOne] }).activities.length === 1);
    ok("merge.ts's ledger cap mirrors memory.ts's", E.mergeStates({ ...local, activities: big }, { activities: big }).activities.length === E.ACTIVITY_LEDGER_MAX);
    // both halves cross a trust boundary and are SPREAD — a non-array from an
    // older build or a hand-edited blob must cost the ledger, never the app
    for (const junk of [null, undefined, 7, "nope", {}]) {
      ok(`a malformed remote ledger cannot throw (${JSON.stringify(junk)})`, (() => {
        try { E.mergeStates(local, { activities: junk }); return true; } catch { return false; }
      })());
      ok(`…nor a malformed local one (${JSON.stringify(junk)})`, (() => {
        try { E.mergeStates({ ...local, activities: junk }, remote); return true; } catch { return false; }
      })());
    }
    ok("a malformed row is dropped, not stored", E.mergeStates(local, { activities: [null, { kind: "chess" }, recTtt] }).activities.length === 2);
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§8 reader and writer agree about the record's size and its route");
// ═════════════════════════════════════════════════════════════════════════
//
// `warm-count-unscoped`, in this file's own pair of modules: the client
// composes the summary and the server stores it, and until now the two carried
// different caps (180 client, 200 server). Comfortable, invisible — and the
// moment the client cap moved to make room for the moves, a silent slice at
// the server would have eaten the END of every record, which is exactly where
// the drop policy puts what it can afford to lose.
{
  const server = readFileSync(join(ROOT, "api/memory.js"), "utf8");
  ok("the server's cap equals the client's", S.ACTIVITY_SUMMARY_MAX === E.EPISODE_SUMMARY_MAX, `${S.ACTIVITY_SUMMARY_MAX} vs ${E.EPISODE_SUMMARY_MAX}`);
  ok("the summary is sliced at that constant, not a literal", /slice\(0, ACTIVITY_SUMMARY_MAX\)/.test(server));
  ok("the fact BODY is no longer cut below the summary", !/summary\.slice\(0, 160\)/.test(server));

  // THE ROUTE. Before this batch every keyword read in opRecall was over
  // `meera_nodes`, and an activity is never written there — so a finished game
  // was reachable only if an embedding had been written for it. This is the
  // missing leg, asserted at the source because the query itself needs a
  // database this suite deliberately does not have.
  ok("opRecall has a keyword leg over activity facts", /from vy_fact f[\s\S]{0,200}name like 'activity:%'/.test(server));
  ok("…scoped to the person", /where f\.person_id = \$1 and f\.name like 'activity:%'/.test(server));
  ok("…and agent-scoped like every sibling read", /name like 'activity:%'[\s\S]{0,200}agentScopePredicate\("f"/.test(server));
  ok("…it word-boundary matches rather than substring", /f\.body ~\* \$\$\{i \+ 3\}/.test(server) || /f\.body ~\*/.test(server));
  ok("…it answers even when the query has no matchable words", /clauses\.length \? `and \(/.test(server));
  // WS-RECALL moved two things under this assertion and neither weakened it.
  // (1) The concurrent block gained `watchFetch` between the activity leg and
  // the rel bundle, so the pair is no longer adjacent — what has to hold is
  // that the activity leg is INSIDE the one Promise.all, never awaited before
  // it. (2) The early return gained the three new legs. Asserting the exact
  // old line would have made this check a check on line adjacency, which is
  // not what "concurrently, never serially" means.
  // anchored on `Promise.all(fetches)`, which appears once and only inside
  // opRecall's concurrent block — the first `await Promise.all([` in the file
  // belongs to fetchRelBundle, and anchoring there would have made this
  // assertion about a different function entirely
  const CBLOCK = server.indexOf("Promise.all(fetches),");
  const CONCURRENT = server.slice(CBLOCK, server.indexOf("]);", CBLOCK));
  ok("…it runs concurrently, never serially",
    /activityFetch,/.test(CONCURRENT) && !/await activityFetch/.test(server));
  ok("…and the empty-recall early return no longer swallows it",
    /!seen\.size &&[\s\S]{0,200}!activities\.length/.test(server));
  ok("the activity block is rendered FIRST, ahead of the graph rows", server.indexOf("GAMES AND THINGS YOU TWO ACTUALLY DID") < server.indexOf("RELEVANT TO WHAT THEY JUST SAID"));
  // `matched` became `matchedFused` when RRF fusion landed (world-class #2):
  // the rows that survive fusion are the rows that render, so they are also
  // the rows the semantic leg must dedupe against. The dedupe itself is
  // unchanged — this assertion follows the rename rather than pinning it.
  ok("a fact reached by both legs is deduped", /\[\.\.\.matchedFused, \.\.\.background, \.\.\.activities\]/.test(server));
  ok("the leg is countable in the trace (`realtime-recall-never`)", /activity: \{ fact_ids: traceIds\(activities\)/.test(server));

  // THE CLIENT SIDE OF THE SAME ROUTE: the ledger goes ahead of the graph
  // rows for the identical reason — api/chat.js keeps the FIRST n characters.
  const brain = readFileSync(join(ROOT, "src/engine/brain.ts"), "utf8");
  ok("brain.ts puts the ledger in front of the recall", /ledgerBlock \? \(graph \? `\$\{ledgerBlock\}\\n\\n\$\{graph\}`/.test(brain));
  ok("…reading the holder when no caller passed one", /keys\.activities !== undefined \? keys\.activities : activityLedger\(\)/.test(brain));
  ok("the activity record feeds the gate's vocabulary", /keys\.activity\?\.record \?\? \[\]/.test(brain));
  ok("family 6 is wired on the real path", /activityVocab:/.test(brain));
  ok("…and fails closed with no record", /keys\.activity \|\| ledger\.length/.test(brain));

  // ONE BLOCK, TWO PRODUCERS. The server renders its own activity block for
  // the surfaces with no AppState (the realtime lane, the bot surfaces); a
  // client holding a ledger drops it and renders its own, or every game lands
  // in the prompt twice under two headings.
  ok("the server's heading opens with the shared sentinel", server.includes(E.ACTIVITY_BLOCK_SENTINEL));
  {
    const serverBlock =
      `${E.ACTIVITY_BLOCK_SENTINEL}, newest first. This is the whole record:\n` +
      "- a game of chess together on 22 aug — opened d4 (2 days ago)\n" +
      "- a game of tic tac toe together on 22 aug — she was o (2 days ago)";
    const other = "RELEVANT TO WHAT THEY JUST SAID:\n- sneha (person, 2 days ago): her flatmate";
    ok("the client takes the server's block out", !E.withoutServerActivityBlock(`${serverBlock}\n${other}`).includes(E.ACTIVITY_BLOCK_SENTINEL));
    ok("…and leaves everything else standing", E.withoutServerActivityBlock(`${serverBlock}\n${other}`) === other);
    ok("…in either order", E.withoutServerActivityBlock(`${other}\n${serverBlock}`) === other);
    ok("…and a recall with no activity block is returned untouched", E.withoutServerActivityBlock(other) === other);
    ok("…including the empty one", E.withoutServerActivityBlock("") === "");
  }
  ok("brain.ts drops the server copy when it has its own", /withoutServerActivityBlock\(recalled\)/.test(brain));

  // AND THE PUBLISHER — `dead-writers`: a ledger nothing publishes is a ledger
  // the call lane never sees.
  const app = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
  ok("App.tsx publishes the ledger for the lanes that cannot reach state", /publishActivityLedger\(state\.activities\)/.test(app));
  ok("…and the reconciler writes the record it just emitted", /withActivityRecord\(s\.activities, rec\)/.test(app));
  ok("…and the emission carries the durable half", /record: a\.record/.test(app));
}

console.log(`\n${failed ? "FAILED" : "PASS"}  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
