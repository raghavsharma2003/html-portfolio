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
import { mkdtempSync } from "node:fs";
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

console.log(`\n${failed ? "FAILED" : "PASS"}  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
