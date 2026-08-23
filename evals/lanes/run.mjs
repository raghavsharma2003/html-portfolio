// ── THE LANE-PARITY GATE (WS-MEMEVAL) ─────────────────────────────────────
//
// `rejected.md#call-opens-with-amnesia-by-construction` ends with a rule and
// no mechanism:
//
//   "every context block that exists must be asserted PRESENT on every lane
//    that claims it, with a per-lane budget pin — a block that renders on one
//    lane and silently empties on another is how the same person remembers in
//    text and forgets on the phone."
//
// This is that mechanism. It is a TABLE: one row per context block, one column
// per lane, and one verdict in every cell. Two ways to fail, and the second is
// the one that makes it a gate rather than a report:
//
//   CLAIMED but 0 bytes  → the block is DARK on that lane. The defect class.
//   EXEMPT but non-zero  → the table is lying. Either the lane gained a block
//                          nobody recorded, or an exemption outlived its
//                          reason. Both are things a person must look at.
//
// Every exemption carries a written reason, in the same spirit
// `evals/teardown.mjs` demands one for a field the wipe does not touch: an
// asymmetry is allowed to exist and is not allowed to be silent.
//
// The fixtures give EVERY store content (see fixtures.mjs), so an empty render
// is always a statement about the lane and never about the data. And the lane
// inputs are not invented here — each mirrors a REAL compile site, and the
// last section reads those sites out of the source to prove the mirror still
// matches. A fixture that drifts from its call site is a gate that passes
// while the product is broken, which is the failure this whole file is about.
//
// Offline, deterministic, no model call, no database, no money.
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as F from "./fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "lanes-"));
const BUNDLE = join(tmp, "lanes.bundle.mjs");
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

const NOW = F.NOW;
const h = F.history();
const lastAt = h[h.length - 1].at;

// ── THE FOUR LANES, each mirroring its real compile site ──────────────────
//
//  chat    src/engine/brain.ts               — the full input set
//  cascade src/engine/brain.ts via think()   — chat's inputs, voice medium
//  live    useCallEngine.ts (connect)        — frozen at pickup, no cultureNote
//  watch   useCallEngine.ts (watch start)    — the tightest lane in the repo
// WS-SHARENOW's block, resolved ONCE and handed to both compositions — the
// same function on every lane, because two derivations of "what they just did"
// is how one of them drifts (`age-tier-never-realtime`'s law).
const justBlock = E.formatJustHappened(F.shares, F.ledger, h, NOW);
const chatMemories = [justBlock, E.formatActivityLedger(F.ledger, NOW), F.graphRecall]
  .filter(Boolean)
  .join("\n\n");
const callMemories = E.callMemories(
  E.callGraphBlocks(
    justBlock,
    E.formatActivityLedgerForCall(F.ledger, NOW),
    E.formatSharedHistory(h, NOW),
    F.graphRecall,
  ),
  E.formatChatTail(h, NOW),
);

// WS-HERNOW. T7 is one compiler slot carrying TWO blocks: the told ledger
// (what she has SAID, fixed between them) and her present minute (what she is
// doing, never told, expires by its own span). The two RE-COMPILING lanes
// pass the second; the two FROZEN-AT-CONNECT lanes deliberately do not — an
// elapsed baked into a prompt that never recompiles is a duration that
// becomes false as the call runs. See the herNow sub-block table.
const present = F.presentEntry(E);
const herLifeWithNow = E.formatHerLife(
  [{ text: F.herLifeText, at: NOW - 3 * 3600_000, kind: "fact" }],
  NOW,
  present,
);
const herLifeToldOnly = E.formatHerLife(
  [{ text: F.herLifeText, at: NOW - 3 * 3600_000, kind: "fact" }],
  NOW,
);

const base = {
  user: F.user,
  messageCount: h.length,
  isDirective: false,
  watching: false,
  herLife: herLifeWithNow,
  relBundle: F.relBundle,
  selfBundle: F.selfBundle,
  gapSinceLastMs: Math.max(0, NOW - lastAt),
  ageGates: undefined,
};

// her interior, resolved the way each surface really resolves it — the watch
// lane's empty thread is a RETURN VALUE here, never a hardcoded ""
const innerFor = (surface) =>
  E.innerContext(F.inner, { now: NOW, lastMsgAt: F.GAP_ENTRY_LAST_MSG_AT, surface });

const lanes = {
  chat: {
    ...base, medium: "text", mode: "chat", voiceEngine: "device",
    innerThread: innerFor("chat").thread, innerWants: innerFor("chat").wants,
    cultureNoteText: F.cultureNoteText,
    memories: chatMemories, latestUserText: F.latestUserText, nowMs: NOW,
    recentTurns: h, herCommitments: E.herCommitments(h, NOW), activity: E.activityOf(F.game, NOW),
  },
  cascade: {
    ...base, medium: "voice", mode: "call", voiceEngine: "gemini",
    innerThread: innerFor("pickup").thread, innerWants: innerFor("pickup").wants,
    cultureNoteText: F.cultureNoteText,
    memories: chatMemories, latestUserText: F.latestUserText, nowMs: NOW,
    recentTurns: h, herCommitments: E.herCommitments(h, NOW), activity: E.activityOf(F.game, NOW),
  },
  live: {
    ...base, medium: "voice", mode: "call", voiceEngine: "live",
    // the told ledger only — frozen at connect; see the herNow sub-block table
    herLife: herLifeToldOnly,
    innerThread: innerFor("pickup").thread, innerWants: innerFor("pickup").wants,
    cultureNoteText: "",
    memories: callMemories, latestUserText: F.latestUserText, nowMs: NOW,
    recentTurns: h, herCommitments: E.herCommitments(h, NOW), activity: E.activityOf(F.game, NOW),
  },
  watch: {
    ...base, medium: "voice", mode: "call", voiceEngine: "live",
    // the told ledger only — the herNow sub-block table below states why
    herLife: herLifeToldOnly,
    innerThread: innerFor("watch").thread, innerWants: innerFor("watch").wants,
    cultureNoteText: "",
    memories: callMemories, latestUserText: "", nowMs: NOW,
    recentTurns: h, herCommitments: E.herCommitments(h, NOW),
    /* activity: deliberately absent — see the table */
  },
};

const LANES = Object.keys(lanes);
const out = {};
for (const [name, input] of Object.entries(lanes)) {
  const c = E.compile(input);
  out[name] = c;
}

// ── THE TABLE ─────────────────────────────────────────────────────────────
//
// "on" = the lane claims this block and must render it.
// A string = the lane deliberately does not, and this is why. The reason is
// the assertion: an exemption without one cannot be written down here.
const P = "on";
const BLOCKS = [
  { id: "T1", what: "inner thread", chat: P, cascade: P, live: P,
    watch: "innerContext returns thread:\"\" for surface 'watch' BY CONSTRUCTION (allowThread = … && surface !== 'watch'); check-prompt-budget reclaims it as WATCH_NO_THREAD" },
  { id: "T2", what: "rel.snapshot", chat: P, cascade: P, live: P, watch: P },
  { id: "T3", what: "india.dynamic", chat: P, cascade: P, live: P, watch: P },
  { id: "T4", what: "dyadic.active", chat: P, cascade: P, live: P,
    watch: "latestUserText is \"\" here: a BUDGET decision, stated at the call site with the arithmetic (T4+T12 = 2,100 bound bytes against 221 spare, measured 2026-08-23). A share also starts mid-call, so the freshest turn is a spoken one and the pull-only law would refuse it anyway" },
  { id: "T5", what: "memories", chat: P, cascade: P, live: P, watch: P },
  { id: "T6", what: "we.callbacks", chat: P, cascade: P, live: P, watch: P },
  { id: "T7", what: "herLife", chat: P, cascade: P, live: P, watch: P },
  { id: "T8", what: "wants/taste", chat: P, cascade: P, live: P, watch: P },
  { id: "T9", what: "session.clock (away)", chat: P, cascade: P, live: P, watch: P },
  { id: "T10", what: "forget/search decisions", chat: P, cascade: P, live: P, watch: P },
  { id: "T11", what: "rel.texture", chat: P, cascade: P, live: P, watch: P },
  { id: "T12", what: "self.arc", chat: P, cascade: P, live: P,
    watch: "the same latestUserText:\"\" budget decision as T4 — renderSelfArc returns \"\" on moment 'none'" },
  { id: "T13", what: "life.untold", chat: P, cascade: P, live: P, watch: P },
  { id: "T14", what: "rel.raised", chat: P, cascade: P, live: P, watch: P },
  { id: "T15", what: "session.activity", chat: P, cascade: P, live: P,
    watch: "the watch compile passes no `activity`. A share starts MID-CALL and this prompt is frozen when it starts, so a board opened later cannot ride it either way; mid-call state travels by direct(). NOT stated at the call site — WS-SYNC+MEMEVAL flagged it for whoever owns useCallEngine.ts" },
  { id: "T16", what: "her.commitments", chat: P, cascade: P, live: P, watch: P },
  { id: "mp.roster", what: "multiparty roster", chat: "no roomBundle on a dyadic lane: the room layer is a separate surface (WS-TGBOT) and every dyadic fixture must render it as exactly zero bytes — gate G1",
    cascade: "no roomBundle on a dyadic lane — same G1 zero-byte property",
    live: "no roomBundle on a dyadic lane — same G1 zero-byte property",
    watch: "no roomBundle on a dyadic lane — same G1 zero-byte property" },
  { id: "mp.bridge", what: "multiparty bridge rows", chat: "no roomBundle on a dyadic lane: disclosure-filtered bridge rows exist only for a room, and a dyadic compile must be byte-identical without them",
    cascade: "no roomBundle on a dyadic lane — same G1 zero-byte property",
    live: "no roomBundle on a dyadic lane — same G1 zero-byte property",
    watch: "no roomBundle on a dyadic lane — same G1 zero-byte property" },
  { id: "culture", what: "culture note", chat: P,
    cascade: "compile() gates it on `mode === \"chat\"`: a cascade turn is mode 'call', so this is chat-only BY CONSTRUCTION rather than by a caller's omission",
    live: "chat-only by construction inside compile() (mode 'call'); the call site also passes \"\" for clarity",
    watch: "chat-only by construction inside compile() (mode 'call'); the call site also passes \"\" for clarity" },
  { id: "watch", what: "WATCH note",
    chat: "there is no screen being shared on a text lane — the note describes a frame she is looking at, and this lane has none",
    cascade: "there is no shared screen on the cascade voice lane either; the note belongs to the surfaces that carry frames",
    live: "the web share starts mid-call and the live prompt is frozen at connect, so the note cannot ride this compile — the native lane passes it per frame that carries a picture",
    watch: "handed to the native side SEPARATELY, per frame, precisely so it can be withheld on a frameless turn — so compile() must not bake it into the tail" },
];

const sec = (lane, id) => out[lane].sections[id] ?? 0;

console.log("\nblock                       " + LANES.map((l) => l.padStart(9)).join("") + "   verdict");
for (const row of BLOCKS) {
  const cells = LANES.map((l) => {
    const n = sec(l, row.id);
    const claimed = row[l] === P;
    if (claimed) return String(n).padStart(9);
    return (n === 0 ? "—" : `!${n}`).padStart(9);
  });
  const bad = LANES.filter((l) => (row[l] === P ? sec(l, row.id) === 0 : sec(l, row.id) > 0));
  console.log(`${(row.id + " " + row.what).padEnd(28)}${cells.join("")}   ${bad.length ? "BROKEN " + bad.join(",") : "ok"}`);
  for (const l of LANES) {
    if (row[l] === P) {
      ok(`${row.id} (${row.what}) renders on ${l}`, sec(l, row.id) > 0,
        "DARK — the lane claims this block and rendered 0 bytes");
    } else {
      ok(`${row.id} (${row.what}) is exempt on ${l} and stays empty`, sec(l, row.id) === 0,
        `rendered ${sec(l, row.id)}B while the table says: ${row[l]}`);
      ok(`${row.id} exemption on ${l} states a reason`, typeof row[l] === "string" && row[l].length > 40);
    }
  }
}

// EVERY tracked section is in the table. A slot that compile() reports and
// this file has never heard of is the next dark block, unclaimed by anyone.
{
  const known = new Set(BLOCKS.map((b) => b.id));
  const seen = new Set(LANES.flatMap((l) => Object.keys(out[l].sections)));
  for (const id of seen)
    ok(`the table knows about section ${id}`, known.has(id),
      "compile() tracks a slot the parity table has never declared");
}

// ── THE SUB-BLOCKS INSIDE T5 ──────────────────────────────────────────────
// T5 is one compiler slot carrying four different memories, assembled by the
// CALLER — so "T5 rendered" is not enough. `call-opens-with-amnesia` was
// exactly this: T5 was non-empty on the call lane and the history inside it
// was not. Each of these is asserted on the lane that claims it, in the string
// that lane really builds.
{
  const sub = [
    { what: "activity ledger", chat: /GAMES AND THINGS YOU TWO ACTUALLY DID/, call: /GAMES AND THINGS YOU TWO ACTUALLY DID/ },
    { what: "graph recall", chat: /RELEVANT TO WHAT THEY JUST SAID/, call: /RELEVANT TO WHAT THEY JUST SAID/ },
  ];
  for (const s of sub) {
    ok(`T5 carries the ${s.what} on the chat lanes`, s.chat.test(chatMemories), chatMemories.slice(0, 120));
    ok(`T5 carries the ${s.what} on the call lanes`, s.call.test(callMemories), callMemories.slice(0, 120));
  }
  // the two blocks that exist ONLY on the call lanes, because chat has the
  // turns themselves and needs neither
  ok("T5 carries the shared history on the call lanes", /\b/.test(callMemories) && E.formatSharedHistory(h, NOW).length > 0);
  const tail = E.formatChatTail(h, NOW);
  ok("the chat tail has something to carry", tail.length > 0, String(tail.length));
  ok("T5 carries the chat tail on the call lanes", callMemories.includes(tail),
    `tail ${tail.length}B, memories ${callMemories.length}B`);
  // …and the call lane's ledger row is the COMPACT view of the same record,
  // never a second rendering of it
  ok("the call ledger row comes from the same summary the chat one does",
    E.formatActivityLedgerForCall(F.ledger, NOW).includes("a game of chess together"));

  // ── THE FOURTH SUB-BLOCK: what they JUST did (WS-SHARENOW) ─────────────
  // The owner screen-shared, hung up, called back one minute later and asked
  // what they had watched — and nothing in the brief could say. This block is
  // the answer, and it is the SAME defect class the table above exists for, so
  // it is asserted the same way: present on every lane that claims it, with a
  // budget pin, and with an exemption nowhere. There is no lane on which "what
  // the two of you did eighteen minutes ago" is not the present moment.
  ok("the just-happened block has something to carry", justBlock.length > 0, String(justBlock.length));
  for (const [name, str] of [["chat lanes", chatMemories], ["call lanes", callMemories]]) {
    ok(`T5 carries the just-happened block on the ${name}`, str.includes("JUST NOW"), str.slice(0, 120));
    ok(
      `…including her own lines over the screen, on the ${name}`,
      F.shares[0].said.every((l) => str.includes(l)),
    );
    ok(
      `…ahead of every other memory block on the ${name} (truncation cuts the END)`,
      str.indexOf("JUST NOW") <
        Math.min(
          ...[E.ACTIVITY_BLOCK_SENTINEL, "BEFORE TODAY", "RELEVANT TO WHAT THEY JUST SAID"]
            .map((k) => str.indexOf(k))
            .filter((i) => i >= 0),
        ),
      str.slice(0, 200),
    );
  }

// ── THE SUB-BLOCKS INSIDE T7 (WS-HERNOW) ──────────────────────────────────
//
// T7 is the second slot in this table that carries more than one thing, and
// it arrived that way for T5's reason: the block is assembled by the CALLER
// (`brain.ts:formatHerLife`), so "T7 rendered" says nothing about whether her
// PRESENT MINUTE is in it. The told ledger and the present moment are
// different claims — one is what she has said and is fixed between them, the
// other is where she is and expires — and a lane can carry either without the
// other. Both get a verdict, per lane, like everything else here.
{
  const NOW_ROWS = [
    { id: "herNow.told", what: "T7 told ledger", chat: P, cascade: P, live: P, watch: P,
      probe: (text) => text.includes(F.herLifeText) },
    { id: "herNow.present", what: "T7 present minute",
      chat: P, cascade: P,
      live: "THIS PROMPT IS FROZEN AT CONNECT (liveAssemblies reads 1 for the whole call) and " +
        "the block carries an ELAPSED: \"going on: about 20 min\" baked in at pickup is false " +
        "forty minutes later, and a duration she cannot recompute is exactly what herNow.ts " +
        "exists to make impossible. Her present reaches this lane through direct() instead — " +
        "CALL_OPEN_DIRECTIVE's `scene`, worded from the SAME ledger row at the instant it is " +
        "true. Asserted below rather than assumed.",
      watch: "the same frozen-prompt reason as `live`, plus two of its own: the watch compile " +
        "happens when the SHARE starts, which is always mid-call, so the pickup that opened " +
        "the call already carried her present moment; and a share IS app truth, which outranks " +
        "the ledger by the scene fence and renders no present-minute block at all.",
      probe: (text) => text.includes(E.HER_NOW_HEADER) },
  ];
  const t7 = (lane) => lanes[lane].herLife;
  for (const row of NOW_ROWS) {
    for (const l of LANES) {
      const hit = row.probe(t7(l));
      if (row[l] === P) {
        ok(`${row.id} (${row.what}) renders on ${l}`, hit,
          "DARK — the lane claims this half of T7 and does not carry it");
      } else {
        ok(`${row.id} is exempt on ${l} and stays absent`, !hit,
          `present while the table says: ${row[l]}`);
        ok(`${row.id} exemption on ${l} states a reason`,
          typeof row[l] === "string" && row[l].length > 40);
      }
    }
  }
  // …and T7 itself is non-empty on every lane, so the exemption above is a
  // statement about ONE HALF and never a lane quietly losing the whole slot
  for (const l of LANES) ok(`T7 is non-empty on ${l}`, sec(l, "T7") > 0, String(sec(l, "T7")));

  // ONE LEDGER, not three renderings of it. The pickup directive's scene and
  // the prompt block are two views of the SAME entry, and the thing that
  // makes the one-minute re-call safe is that neither view can re-draw it.
  const scene = E.herNowScene(present, NOW);
  ok("the pickup scene names the same activity the re-compiling lanes' block does",
    scene.includes(present.activity) && t7("cascade").includes(present.activity), scene);
  ok("the scene is never empty for a lane with no board on screen", scene.length > 0,
    "an empty scene is what fell through to the directive's improv clause");
  // THE LIVE LANE'S EXEMPTION IS NOT A HOLE. Its present moment travels by
  // direct(), and the string that travels names the same activity — so the
  // exemption above costs the lane nothing, which is the thing an exemption
  // has to be able to show rather than claim.
  ok("the live lane still receives her present moment, through the directive",
    scene.includes(present.activity) && scene.length > 0);
}

  // The chat tail is the ONE thing in front of it on the call lanes, and that
  // is `callMemories`' own rule rather than an accident: the pre-call stretch
  // is what he typed seconds ago, and this block is what they did minutes ago.
  ok(
    "on the call lanes only the pre-call chat tail precedes it",
    callMemories.indexOf("JUST NOW") <= E.formatChatTail(h, NOW).length + 4,
    `at ${callMemories.indexOf("JUST NOW")}, tail is ${E.formatChatTail(h, NOW).length}B`,
  );
  // …and in the COMPILED prompt of every one of the four lanes, which is the
  // only thing that proves a lane really carries it.
  for (const l of LANES) {
    ok(`${l} lane's compiled prompt carries the just-happened block`,
      out[l].tail.includes("JUST NOW"),
      "DARK — the lane claims this block and rendered none of it");
    ok(`${l} lane carries her actual words from the share`,
      out[l].tail.includes(F.shares[0].said[0]));
    ok(`${l} lane never carries a claim about what was ON the screen`,
      !/what was on their screen|on his screen there|the screen showed/i.test(out[l].tail));
  }
  ok(`the block is within JUST_HAPPENED_BUDGET (${justBlock.length} <= ${E.JUST_HAPPENED_BUDGET})`,
    justBlock.length <= E.JUST_HAPPENED_BUDGET);
}

// ── THE PER-LANE BUDGET PIN ───────────────────────────────────────────────
// The other half of the rule. A block that renders on every lane and pushes
// the tightest one over its cap is the same defect arriving from the other
// side. These are the bounds check-prompt-budget.mjs owns; what is asserted
// here is that the FIXTURE — a rich, everything-present relationship — stays
// inside them, since that is the case the caps were sized for.
{
  ok("the compiler still declares the caps this gate reads",
    E.OPERATIONAL_CORE_CAP > 0 && E.OPERATIONAL_TAIL_CAP > 0);
  for (const l of LANES) {
    const core = out[l].core.length;
    const tail = out[l].tail.length;
    console.log(
      `   ${l.padEnd(8)} core ${String(core).padStart(6)}/${E.OPERATIONAL_CORE_CAP}` +
        `   tail ${String(tail).padStart(5)}/${E.OPERATIONAL_TAIL_CAP}`,
    );
    ok(`${l} lane's core fits the operational cap`, core <= E.OPERATIONAL_CORE_CAP, `${core}`);
    ok(`${l} lane's tail fits the operational cap`, tail <= E.OPERATIONAL_TAIL_CAP, `${tail}`);
  }
}

// ── THE MIRROR CHECK ──────────────────────────────────────────────────────
// The fixtures above claim to mirror four real compile sites. If a call site
// stops passing something this file assumes it passes, the table would keep
// passing while the lane went dark — the exact failure mode the gate exists
// to end. So the sites are read out of the source.
{
  const call = readFileSync(join(ROOT, "src/components/useCallEngine.ts"), "utf8");
  const brain = readFileSync(join(ROOT, "src/engine/brain.ts"), "utf8");
  const liveSite = call.slice(call.indexOf("const compiled = compile({"), call.indexOf("const watchLastAt"));
  const watchSite = call.slice(call.indexOf("const watchInput = {"), call.indexOf("const cascadeCompiled"));
  ok("the live compile site was found", liveSite.length > 200);
  ok("the watch compile site was found", watchSite.length > 200);

  for (const [key, site, name] of [
    ["nowMs", liveSite, "live"], ["herCommitments", liveSite, "live"],
    ["recentTurns", liveSite, "live"], ["activity", liveSite, "live"],
    ["relBundle", liveSite, "live"], ["selfBundle", liveSite, "live"],
    ["nowMs", watchSite, "watch"], ["herCommitments", watchSite, "watch"],
    ["recentTurns", watchSite, "watch"], ["relBundle", watchSite, "watch"],
    ["selfBundle", watchSite, "watch"],
  ]) {
    ok(`the ${name} compile site passes ${key}`, new RegExp(`\\b${key}:`).test(site),
      "the fixture assumes it does — one of the two is now wrong");
  }
  // the exemptions, pinned against the source rather than trusted
  ok("the watch site really does pass latestUserText: \"\" (T4/T12 exemption)",
    /latestUserText: ""/.test(watchSite));
  ok("the watch site really does omit `activity` (T15 exemption)",
    !/\bactivity:/.test(watchSite));
  ok("both call sites pass an empty cultureNoteText (culture exemption)",
    /cultureNoteText: ""/.test(liveSite) && /cultureNoteText: ""/.test(watchSite));
  ok("the chat lane is the one that passes a culture note",
    /cultureNoteText/.test(brain));
  ok("the live site passes watching: false (WATCH-note exemption)", /watching: false/.test(liveSite));
}

// ── THE NEGATIVE CONTROL ──────────────────────────────────────────────────
// A parity gate that cannot fail is a green light with no wiring behind it,
// and this repo has shipped one of those before. So the gate is pointed at the
// exact state production was in when the tester found it: a live lane that
// passes no nowMs, no herCommitments, no recentTurns, no activity. Every one
// of those slots must go dark, and this suite must SEE it — if this section
// ever reports "0 dark", the table above is decorative.
{
  const { nowMs, herCommitments, recentTurns, activity, ...amnesiac } = lanes.live;
  const before = E.compile(amnesiac);
  const wentDark = ["T9", "T14", "T15", "T16"].filter(
    (id) => (out.live.sections[id] ?? 0) > 0 && (before.sections[id] ?? 0) === 0,
  );
  ok("the gate can actually fail: the pre-fix live lane goes dark on 4 slots",
    wentDark.length === 4, `caught ${wentDark.join(",") || "nothing"}`);
  console.log(`   negative control — the pre-fix live compile loses: ${wentDark.join(", ")}`);
}

// ── THE FIXTURES ARE OS-LAYER, NOT PERSONA ────────────────────────────────
// Second-agent dimension, kept cheap on purpose: this gate asserts WHICH
// BLOCKS A LANE CARRIES, which is a property of the operating system and not
// of whoever is running on it. A fixture that hardcodes one agent's name or
// voice would quietly turn a structural gate into a personality test, and the
// deep second-agent parity lives in WS-SPINE's eval rather than here.
{
  const fx = readFileSync(join(HERE, "fixtures.mjs"), "utf8");
  const code = fx.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const name of ["meera", "silk"]) {
    ok(`the parity fixtures never name the agent ("${name}")`, !code.toLowerCase().includes(name));
  }
  ok("the parity fixtures pass no agent module (the default is the point)",
    !/\bagent:/.test(code));
}

console.log(fail ? `\n${fail} of ${checks} FAILED` : `\nALL PASS (${checks} assertions)`);
process.exit(fail ? 1 : 0);
