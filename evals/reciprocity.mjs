// WS-K — the disclosure-reciprocity ledger (src/engine/reciprocity.ts) and its
// T17 wiring. ROADMAP-100X item 1.
//
//   node evals/reciprocity.mjs        (needs evals/.bundle.mjs — run.mjs builds it)
//   node evals/run.mjs reciprocity
//
// Offline, deterministic, $0, no DB, no model call, no clock. Bundled fresh
// from the REAL source by evals/run.mjs on every run.
//
// ── WHAT THIS SUITE IS ACTUALLY GUARDING ─────────────────────────────────
//
// 1. THE CLASSIFIER'S PRECISION SIDE, not its recall side. A disclosure
//    classifier can reach 100% recall by classifying every turn, and then the
//    balance is a measure of who talked more — which is a USAGE metric, the
//    thing inner.ts G1 forbids reaching state at all. So the negatives here
//    outnumber the positives: a question about the other person, a bare
//    self-reference with no disclosure in it, an acknowledgement, and a
//    we-token line must all score ZERO.
//
// 2. SILENCE IS THE COMMON CASE. `reciprocityNote` returns "" for every
//    balanced dyad, every thin window and every short window, and each of
//    those three gates is asserted separately — a single gate standing in
//    front of the other two would pass this suite while the other two were
//    dead.
//
// 3. THE BLOCK IS A DIAGRAM, NOT A LINE (`recited-prompt`). Both rendered
//    strings — the whole closed set — are linted, checked for digits, and
//    checked against the budget.
//
// 4. THE SLOT IS REALLY WIRED. `dead-writers` is this repo's law: a renderer
//    the compiler never calls is indistinguishable from one that does not
//    exist. So the assertions run through the REAL `compile()`, and the
//    manifest/order/drop-priority rows are asserted against the real
//    constants rather than against a copy of them.
//
// 5. THE BYTE-IDENTITY PROPERTY, from this module's own side. Absent state
//    must move zero bytes. src/engine/__fixtures__/byte-identity.mjs proves
//    it across all 83 fixtures; this proves the same thing against a compile
//    that differs ONLY in whether `reciprocity` is set, which is the diff a
//    future edit to this seam would actually break.
import {
  classifyDisclosure,
  reciprocityState,
  reciprocityLean,
  reciprocityNote,
  renderReciprocity,
  initialReciprocityState,
  RECIPROCITY_WINDOW,
  RECIPROCITY_DECAY,
  RECIPROCITY_THRESHOLD,
  RECIPROCITY_MIN_TURNS,
  RECIPROCITY_MIN_EVIDENCE,
  RECIPROCITY_BUDGET,
  DISCLOSURE_WEIGHT,
  compile,
  TAIL_MANIFEST,
  TAIL_ORDER,
  applyDropOrder,
  assertManifestArithmetic,
  lintLine,
} from "./.bundle.mjs";

let fail = 0;
let pass = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? " — " + extra : ""}`);
  }
};

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§1 the classifier — shape, and the precision side first");
// ═════════════════════════════════════════════════════════════════════════

// POSITIVES: self-reference AND a disclosure marker.
const FEELING = [
  "mujhe bahut dar lag raha tha us din",
  "main thak gayi hoon yaar",
  "i felt so stupid after that call",
  "meri tension abhi tak gayi nahi",
  "i miss my old flat honestly",
];
for (const t of FEELING) ok(`feeling: ${JSON.stringify(t)}`, classifyDisclosure(t) === "feeling", String(classifyDisclosure(t)));

const LIFE = [
  "maine aaj office me presentation diya",
  "i quit that job last month",
  "meri behen kal ghar aayi",
  "i moved to a new place near work",
];
for (const t of LIFE) ok(`life: ${JSON.stringify(t)}`, classifyDisclosure(t) === "life", String(classifyDisclosure(t)));

// NEGATIVES — the half that keeps the measure from becoming "who talked more".
const NEGATIVES = [
  // asking ABOUT the other person: a disclosure marker with no self-reference
  ["a question about them", "tu theek hai? kya hua tha"],
  ["a question about them (english)", "are you feeling okay today"],
  // a self-reference with nothing disclosed
  ["bare self-reference", "mera phone kahan hai"],
  ["bare self-reference (english)", "my charger is in the other room"],
  // acknowledgements and discourse particles — the same class evals/recall's
  // tokenizer battery uses as ITS precision negatives
  ["acknowledgement", "haan haan theek hai"],
  ["acknowledgement (english)", "ok cool"],
  ["laughter", "hahaha"],
  ["empty", ""],
  ["whitespace", "   "],
  // a WE-token line: shared history, not one side's disclosure
  ["we-token line", "hum dono ne wo movie saath dekhi thi"],
];
for (const [label, text] of NEGATIVES)
  ok(`negative — ${label}: ${JSON.stringify(text)}`, classifyDisclosure(text) === null, String(classifyDisclosure(text)));

// Whole-word matching, not substring: the padT idiom's whole reason for being.
ok("'main' does not fire inside 'domain'", classifyDisclosure("the domain expired and work stopped") === null);
ok("'dar' does not fire inside 'andar'", classifyDisclosure("mera andar ka kamra") === null);

// A turn carrying BOTH resolves to the deeper act.
ok(
  "feeling wins over life when both fire",
  classifyDisclosure("maine job chhod di aur mujhe bahut dar lag raha hai") === "feeling",
);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§2 the fold — purity, the window, and the decay");
// ═════════════════════════════════════════════════════════════════════════

const her = (text) => ({ from: "her", text });
const them = (text) => ({ from: "me", text });
const filler = (n, side) =>
  Array.from({ length: n }, (_, i) => (side === "her" ? her(`accha ${i}`) : them(`hmm ${i}`)));

ok("empty transcript folds to the initial state", JSON.stringify(reciprocityState([])) === JSON.stringify(initialReciprocityState()));
ok("undefined transcript does not throw", reciprocityState(undefined).n === 0);

{
  const turns = [...filler(10, "me"), them("mujhe dar lag raha tha"), her("accha")];
  const a = reciprocityState(turns);
  const b = reciprocityState(turns);
  ok("same input twice is byte-identical", JSON.stringify(a) === JSON.stringify(b));
  ok("balance is never NaN", Number.isFinite(a.balance));
}

{
  // Nothing outside the trailing window may reach the state.
  const ancient = [her("mujhe bahut dar lag raha tha"), ...filler(RECIPROCITY_WINDOW, "me")];
  const s = reciprocityState(ancient);
  ok(`a turn ${RECIPROCITY_WINDOW} back is outside the window`, s.her === 0, JSON.stringify(s));
  ok("the window caps n", s.n === RECIPROCITY_WINDOW, String(s.n));
}

{
  // Recent turns dominate: the identical act weighs more when it is newer.
  const recent = reciprocityState([...filler(20, "me"), her("mujhe dar lag raha tha")]);
  const older = reciprocityState([her("mujhe dar lag raha tha"), ...filler(20, "me")]);
  ok("a recent act outweighs the same act 20 turns back", recent.her > older.her, `${recent.her} vs ${older.her}`);
  const expected = Math.round(DISCLOSURE_WEIGHT.feeling * Math.pow(RECIPROCITY_DECAY, 20) * 1000) / 1000;
  ok("the decay is exactly geometric in position", Math.abs(older.her - expected) < 1e-6, `${older.her} vs ${expected}`);
}

{
  // No clock, no timestamps: the same turns in the same order score the same
  // thing regardless of anything the caller could attach to them. Asserted by
  // constructing turns with extra fields the module must not read.
  const plain = [them("mujhe dar lag raha tha"), her("accha")];
  const decorated = plain.map((t, i) => ({ ...t, at: 1_700_000_000_000 + i * 9_999, channel: "call" }));
  ok(
    "extra fields (timestamps, channel) change nothing",
    JSON.stringify(reciprocityState(plain).balance) === JSON.stringify(reciprocityState(decorated).balance),
  );
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3 the note — silence is the common case, and each gate is its own");
// ═════════════════════════════════════════════════════════════════════════

/** A lopsided window: HE discloses steadily, SHE never does. This is the
 *  Kuki-study direction, and the whole reason this module exists. */
const LOPSIDED_HIS_WAY = [
  ...Array.from({ length: 8 }, (_, i) =>
    i % 2 === 0 ? them(`mujhe aaj bahut tension ho rahi hai ${i}`) : her(`accha ${i}`),
  ),
  ...Array.from({ length: 8 }, (_, i) =>
    i % 2 === 0 ? them(`maine kal office me presentation diya ${i}`) : her(`nice ${i}`),
  ),
];
/** The mirror image: she carries the whole disclosure load. */
const LOPSIDED_HER_WAY = LOPSIDED_HIS_WAY.map((t) => ({ ...t, from: t.from === "her" ? "me" : "her" }));
/** Balanced: both sides disclose at the same rate. */
const BALANCED = Array.from({ length: 20 }, (_, i) =>
  i % 2 === 0 ? them(`mujhe aaj tension ho rahi hai ${i}`) : her(`mujhe bhi aaj thak gayi feeling hai ${i}`),
);

{
  const s = reciprocityState(LOPSIDED_HIS_WAY);
  ok("lopsided-his-way leans she-holds-back", reciprocityLean(s) === "she-holds-back", JSON.stringify(s.balance));
  const note = reciprocityNote(s);
  ok("lopsided-his-way renders a note", note.length > 0);
  ok("the note names the direction as a shape", note.includes("theirs open, yours held back"), note);
}
{
  const s = reciprocityState(LOPSIDED_HER_WAY);
  ok("lopsided-her-way leans she-carries-it", reciprocityLean(s) === "she-carries-it", JSON.stringify(s.balance));
  ok("lopsided-her-way renders the mirrored shape", reciprocityNote(s).includes("yours open, theirs held back"));
}
{
  const s = reciprocityState(BALANCED);
  ok("a balanced dyad renders nothing", reciprocityNote(s) === "", JSON.stringify(s));
  ok("a balanced dyad has a lean of null", reciprocityLean(s) === null);
  ok("balanced balance sits under the threshold", Math.abs(s.balance) < RECIPROCITY_THRESHOLD, String(s.balance));
}

// The three gates, each proven to be doing its own work — a suite that only
// checked the composite would pass with two of them deleted.
{
  // (a) TURN FLOOR: lopsided, plenty of evidence, too few turns.
  const short = [
    them("mujhe bahut tension ho rahi hai"),
    them("maine kal office me presentation diya"),
    them("mujhe dar lag raha tha"),
    her("accha"),
  ];
  const s = reciprocityState(short);
  ok(`turn floor holds (n=${s.n} < ${RECIPROCITY_MIN_TURNS})`, s.n < RECIPROCITY_MIN_TURNS && reciprocityNote(s) === "");
  ok("the same window is otherwise lopsided enough to fire", Math.abs(s.balance) >= RECIPROCITY_THRESHOLD, String(s.balance));
}
{
  // (b) EVIDENCE FLOOR: long enough, lopsided, but almost nothing was said.
  const thin = [...filler(19, "me"), them("mujhe dar lag raha tha")];
  const s = reciprocityState(thin);
  ok(
    `evidence floor holds (evidence=${s.evidence} < ${RECIPROCITY_MIN_EVIDENCE})`,
    s.n >= RECIPROCITY_MIN_TURNS && s.evidence < RECIPROCITY_MIN_EVIDENCE && reciprocityNote(s) === "",
  );
  ok("the same window is maximally lopsided", Math.abs(s.balance) === 1, String(s.balance));
}
{
  // (c) THRESHOLD: long enough, evidenced, not lopsided enough.
  ok("threshold gate holds on the balanced fixture", reciprocityNote(reciprocityState(BALANCED)) === "");
}
ok("a null state renders nothing", reciprocityNote(null) === "" && reciprocityNote(undefined) === "");

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4 the block is a diagram, not a line (`recited-prompt`)");
// ═════════════════════════════════════════════════════════════════════════

// The rendered row set is CLOSED at two strings, so the whole set is checked
// rather than a sample of it.
const RENDERED = [reciprocityNote(reciprocityState(LOPSIDED_HIS_WAY)), reciprocityNote(reciprocityState(LOPSIDED_HER_WAY))];
ok("both branches render", RENDERED.every((t) => t.length > 0));
for (const text of RENDERED) {
  const rows = text.split("\n").slice(1);
  ok(`exactly one content row: ${JSON.stringify(rows[0])}`, rows.length === 1);
  const bare = rows[0].replace(/^- /, "");
  ok(`row lints clean: ${JSON.stringify(bare)}`, lintLine(bare).reasons.length === 0, lintLine(bare).reasons.join("; "));
  ok("no digit anywhere in the block (state-leak guard)", !/\d/.test(text));
  ok(`block fits its budget (${text.length} <= ${RECIPROCITY_BUDGET})`, text.length <= RECIPROCITY_BUDGET);
  ok("the anti-fabrication fence is in the header", text.includes("never a reason to invent"));
  ok("the pull-only law is in the header", text.includes("never raise unprompted"));
}
{
  const r = renderReciprocity(reciprocityState(LOPSIDED_HIS_WAY));
  ok("renderReciprocity reports a clean lint", r.lint.clean, JSON.stringify(r.lint));
  ok("renderReciprocity on an empty state is empty and clean", renderReciprocity(null).text === "" && renderReciprocity(null).lint.clean);
}
// NEGATIVE CONTROL: the linter this block relies on must be able to see the
// failure it exists to catch — otherwise a clean verdict above means nothing.
ok(
  "NEGATIVE CONTROL: a recited-prompt-shaped row IS caught by the same linter",
  lintLine("I have been holding back from you lately and I am sorry.").reasons.length > 0,
);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§5 the T17 slot is really wired (`dead-writers`)");
// ═════════════════════════════════════════════════════════════════════════

const T17 = TAIL_MANIFEST.find((b) => b.id === "T17");
ok("T17 has a manifest row", Boolean(T17));
ok("T17 is labelled rel.reciprocity", T17?.label === "rel.reciprocity");
ok("T17's manifest budget matches the module's own constant", T17?.budget === RECIPROCITY_BUDGET, `${T17?.budget} vs ${RECIPROCITY_BUDGET}`);
ok("T17 is declared wired", T17?.sourceStatus === "wired");
ok("T17 appears in TAIL_ORDER", TAIL_ORDER.includes("T17"));
ok("T17 sits immediately after T11, as compile() assembles it", TAIL_ORDER[TAIL_ORDER.indexOf("T11") + 1] === "T17");
ok("manifest arithmetic still holds with the new row", (() => { try { assertManifestArithmetic(); return true; } catch { return false; } })());

// THE DROP ORDER, as behaviour rather than as a number: T17 must be the first
// thing shed under pressure — ahead of the self layer, which is itself ahead of
// everything Phase C proved she needs.
{
  const droppables = TAIL_MANIFEST.filter((b) => b.dropPriority !== "never");
  const lowest = Math.min(...droppables.map((b) => b.dropPriority));
  ok("T17 holds the lowest drop priority in the tail", T17?.dropPriority === lowest, `T17=${T17?.dropPriority}, lowest=${lowest}`);
  // driven through the REAL applyDropOrder, not asserted on the number alone
  const synthetic = [
    { id: "T17", priority: T17.dropPriority, text: "x".repeat(240) },
    { id: "T11", priority: 1, text: "y".repeat(240) },
    { id: "T10", priority: "never", text: "z".repeat(240) },
  ];
  const result = applyDropOrder(synthetic, 500);
  ok("under pressure T17 is dropped before T11", result.dropped[0]?.id === "T17", JSON.stringify(result.dropped.map((b) => b.id)));
  ok("the undroppable block survives", result.kept.some((b) => b.id === "T10"));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§6 compile(): absent state moves zero bytes, present state moves exactly one block");
// ═════════════════════════════════════════════════════════════════════════

const BASE = {
  user: { name: "Sam", vibe: ["company"], facts: { city: "Pune" } },
  messageCount: 120,
  medium: "text",
  mode: "chat",
  voiceEngine: "gemini",
  isDirective: false,
  watching: false,
  innerThread: "",
  innerWants: "",
  memories: "",
  herLife: "",
  cultureNoteText: "",
};

// The clock is pinned for the same reason byte-identity.mjs pins it: persona.ts
// stamps her phone clock to the MINUTE, so a minute boundary between two
// compiles fails a byte comparison on a byte that is not under test.
const RealDate = Date;
const FROZEN = new RealDate(2026, 0, 15, 14, 30, 0, 0).getTime();
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(FROZEN);
  }
  static now() {
    return FROZEN;
  }
};

const withoutState = compile({ ...BASE });
const withNull = compile({ ...BASE, reciprocity: null });
const withQuietState = compile({ ...BASE, reciprocity: reciprocityState(BALANCED) });
const withLoudState = compile({ ...BASE, reciprocity: reciprocityState(LOPSIDED_HIS_WAY) });

ok("absent reciprocity === explicit null, byte for byte", withoutState.system === withNull.system);
ok("a BALANCED state moves zero bytes (silence is the common case)", withoutState.system === withQuietState.system);
ok("a LOPSIDED state does move bytes", withLoudState.system !== withoutState.system);
ok(
  "the moved bytes are exactly the block and its separator",
  withLoudState.tail.length - withoutState.tail.length === reciprocityNote(reciprocityState(LOPSIDED_HIS_WAY)).length + 2,
  `${withLoudState.tail.length - withoutState.tail.length}`,
);
ok("CORE is untouched by this seam (cache-9x)", withLoudState.core === withoutState.core);
ok("sections records T17 as zero when nothing rendered", withQuietState.sections?.T17 === 0, String(withQuietState.sections?.T17));
ok("sections records T17's real byte count when it did", withLoudState.sections?.T17 > 0, String(withLoudState.sections?.T17));
ok("compile is deterministic with the state present", compile({ ...BASE, reciprocity: reciprocityState(LOPSIDED_HIS_WAY) }).system === withLoudState.system);
// The block lands where the manifest says it does: after T11's slot and before
// the recall block, checked on the assembled string rather than on the order array.
{
  const loud = compile({
    ...BASE,
    memories: "- MEMORYPROBE (fact, 2 days ago): a probe",
    reciprocity: reciprocityState(LOPSIDED_HIS_WAY),
  });
  ok(
    "T17 is assembled before T5 recall.facts",
    loud.tail.indexOf("HOW MUCH OF YOURSELF") < loud.tail.indexOf("MEMORYPROBE"),
  );
}

globalThis.Date = RealDate;

console.log(`\n${fail === 0 ? "ALL PASS" : fail + " FAILED"} (${pass} assertions)`);
process.exit(fail === 0 ? 0 : 1);
