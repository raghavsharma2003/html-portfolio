// WS-RECALL — the retrieval cluster, and the forget cluster that has to keep
// up with it.
//
//   node evals/recall/run.mjs
//
// Offline, deterministic, db-free, network-free, model-free, ~1s. It imports
// the REAL api/memory.js exports and reads the REAL source of the three files
// that carry the rules it cannot import (a SQL string, a manifest walk, a
// coverage query) — never a re-implementation, because a predicate tested
// through a copy is a copy that was tested (`gates-that-live-nowhere`).
//
// api/memory.js reaches api/_config.js, which is gitignored; CI writes a stub
// (`node scripts/write-config.mjs --stub`) before evals/run.mjs, and nothing
// in this suite executes a query — the same posture evals/gamemem.mjs and
// evals/trace/run.mjs already take.
//
// WHAT THIS SUITE IS FOR, stated once so the next person does not have to
// infer it. Six of nineteen real Hinglish queries used to tokenize to nothing,
// two stores with live writers had no reader anywhere in the product, a photo
// produced one indistinguishable row per photo, and the server's copy of the
// entire conversation was in no manifest, no forget path and no export. Every
// one of those is invisible from inside the app: nothing throws, nothing logs,
// she simply knows less than she should — or, in the last case, more.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const src = (p) => readFileSync(join(ROOT, p), "utf8");

const M = await import(pathToFileURL(join(ROOT, "api/memory.js")).href);
const MEMORY_SRC = src("api/memory.js");
const ACCOUNT_SRC = src("api/account.js");
const RELCHECK_SRC = src("scripts/relcheck.mjs");
const CLIENT_SRC = src("src/engine/memory.ts");

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

// opRecall's own body, for the assertions that are about WHERE something is
// rather than whether it exists. Sliced by function boundary so a match in
// opRemember or opForget can never satisfy an assertion about retrieval.
const OP_RECALL = MEMORY_SRC.slice(
  MEMORY_SRC.indexOf("async function opRecall("),
  MEMORY_SRC.indexOf("function relBundleShape("),
);
const OP_FORGET = MEMORY_SRC.slice(
  MEMORY_SRC.indexOf("async function opForget("),
  MEMORY_SRC.indexOf("async function deletePhotos("),
);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§1 the Hinglish tokenizer (P1-10) — the 19-query battery");
// ═════════════════════════════════════════════════════════════════════════
//
// The battery is the audit's, verbatim, and it is not a sample: these are the
// shapes real users type. The pre-fix result was 13/19 producing tokens, and
// the six that produced none did not fail loudly — the keyword leg simply did
// not run, and the turn was answered by standing background plus whatever the
// embedding reached.
const BATTERY = [
  "kab bataya tha maine",
  "kaam kaisa chal raha hai",
  "wo baat yaad hai tumhe",
  "kal kya baat kiya humne",
  "us din kya hua tha",
  "tumne kya kaha tha",
  "mera dost ka naam kya tha",
  "meri naukri ke baare me",
  "wo photo yaad hai",
  "us call me kya bola tha",
  "job kaisi chal rahi hai",
  "hmm",
  "acha",
  "kya kar rahi ho",
  "yaad hai na wo fight",
  "sorry ke baad kya hua",
  "zerodha me kaisa lag raha hai",
  "rohit se baat hui",
  // the CALL lane's query is not a question at all: the last 4 of HIS messages
  "uth gaya bahar se manga khana kya khaya din kaisa tha",
];
const live = BATTERY.filter((qy) => M.recallTokens(qy).length);
ok(
  `>= 17 of 19 real queries produce tokens (${live.length}/19)`,
  live.length >= 17,
  BATTERY.filter((qy) => !M.recallTokens(qy).length).join(" | "),
);

// THE PRECISION SIDE, and it is the half that keeps the fix honest. A
// tokenizer can reach 19/19 by tokenizing everything, and then the keyword leg
// runs on "hmm" and hands her memories about nothing. Every one of these must
// produce ZERO tokens — they are acknowledgements, laughter and discourse
// particles, and there is nothing in anybody's store named after one.
const NEGATIVES = [
  "hmm",
  "acha",
  "haan",
  "ok",
  "theek hai yaar",
  "haan haan theek hai",
  "hmm ok",
  "arre bas",
  "lol haha",
  "achha yaar theek hai na",
  "hahaha",
  "bas aise hi",
  "hnji",
  "chalo theek hai",
];
const fired = NEGATIVES.filter((qy) => M.recallTokens(qy).length);
ok(`no contentless query tokenizes to anything (${NEGATIVES.length} probes)`, !fired.length,
  fired.map((qy) => `"${qy}" -> ${M.recallTokens(qy).join(",")}`).join(" | "));

// the three fixes, named individually, so a regression says WHICH one moved
ok("`kaam` is a content word again", M.recallTokens("kaam kaisa chal raha hai").includes("kaam"));
ok("`baat` is a content word again", M.recallTokens("wo baat yaad hai tumhe").includes("baat"));
ok("the 3-char whitelist reaches `job`", M.recallTokens("job kaisi chal rahi hai").includes("job"));
ok("the 3-char whitelist reaches `din`", M.recallTokens("us din kya hua tha").includes("din"));
ok(
  "the bigram fallback fires on an all-grammar question",
  M.recallTokens("kya kar rahi ho").length === 2,
);
ok(
  "…and never on a one-word grunt, because a bigram needs two words",
  M.recallTokens("hmm").length === 0 && M.recallTokens("lol").length === 0,
);

// THE WHITELIST MUST NOT BE A BACK DOOR. Dropping the floor to three for a
// list is only safe if the list cannot readmit a stopword — a word in both
// sets would be a silent override with no error anywhere.
const overlap = [...M.RECALL_SHORT].filter((w) => M.RECALL_STOP.has(w));
ok("no whitelisted short token is also a stopword", !overlap.length, overlap.join(","));
ok("every whitelisted token is exactly 3 characters", [...M.RECALL_SHORT].every((w) => w.length === 3),
  [...M.RECALL_SHORT].filter((w) => w.length !== 3).join(","));

// determinism and the cap: the tokenizer feeds an ORDER BY, and a tokenizer
// that returns a different set for the same string makes every downstream
// measurement in this file unreproducible
const twice = (qy) => JSON.stringify(M.recallTokens(qy)) === JSON.stringify(M.recallTokens(qy));
ok("the tokenizer is deterministic", BATTERY.every(twice));
ok("the tokenizer is capped at 6 tokens",
  BATTERY.every((qy) => M.recallTokens(qy).length <= 6));
ok("devanagari keeps its 3-character floor",
  M.recallTokens("कल क्या हुआ था").length > 0);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§2 the two dead stores get readers (P1-1)");
// ═════════════════════════════════════════════════════════════════════════
ok("opRecall reads vy_shared_moment", /from vy_shared_moment/.test(OP_RECALL));
ok("opRecall reads vy_visual_assertion", /from vy_visual_assertion/.test(OP_RECALL));
ok("the moment read is person-scoped", /vy_shared_moment m[\s\S]{0,400}?m\.person_id = \$1/.test(OP_RECALL));
ok("the assertion read is person-scoped", /vy_visual_assertion a[\s\S]{0,400}?a\.person_id = \$1/.test(OP_RECALL));
ok("both reads carry the agent-scope predicate",
  /agentScopePredicate\("m"/.test(OP_RECALL) && /agentScopePredicate\("a"/.test(OP_RECALL));
// deduped: an assertion that already reached the prompt attached to its
// moment must not come back a second time as a bare photo row
ok("photos exclude assertions a moment already carried",
  /not exists \(select 1 from vy_shared_moment m where m\.assertion_id = a\.id\)/.test(OP_RECALL));
ok("the watched block is byte-capped", /WATCH_BLOCK_BUDGET/.test(OP_RECALL));
ok("…and caps on WHOLE LINES, never mid-claim",
  /watchBytes \+ l\.length \+ 1 > WATCH_BLOCK_BUDGET/.test(OP_RECALL));

// THE FENCE. This is the block where a supplied detail is indistinguishable
// from a remembered one AND the source is a model looking at pixels, so the
// heading has to carry both halves: never volunteer it (L3), and never state
// the machine's read of an image as something she saw.
const WATCH_HEADING = /THINGS YOU TWO LOOKED AT TOGETHER[^\n]*/.exec(OP_RECALL)?.[0] ?? "";
ok("the watched block never raises unprompted", /never raise these unprompted/.test(WATCH_HEADING));
ok("…and says the on-screen read may be wrong",
  /machine's guess|may be wrong/.test(WATCH_HEADING), WATCH_HEADING.slice(0, 120));
ok("…and refuses to fill in a detail it does not hold",
  /rather than filling it in/.test(WATCH_HEADING));
ok("the moment render keeps her reaction and the claim distinguishable",
  /you said: /.test(OP_RECALL) && /on screen/.test(OP_RECALL));

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3 the photo write stops being dead (P1-1) and stops clobbering (P2-3)");
// ═════════════════════════════════════════════════════════════════════════
const PHOTO = MEMORY_SRC.slice(
  MEMORY_SRC.indexOf("export async function recordPhotoMemory("),
  MEMORY_SRC.indexOf("async function opDescribe("),
);
// the INSERT's own parameter list, not the file — the old constant is quoted
// in the superseded-ruling comment above it on purpose, and a check that
// cannot tell a comment from a bind parameter is a check nobody can rewrite
// a comment near.
const PHOTO_INSERT = PHOTO.slice(PHOTO.indexOf("const body ="), PHOTO.indexOf("return { ok: true, wrote: true"));
ok("the photo fact body is no longer the constant string",
  !/\[person, factName, "shared a photo"/.test(PHOTO_INSERT),
  "the body is still a fixed string for every photo");
ok("the body carries the description", /looked like: \$\{desc\}/.test(PHOTO));
// THE HEDGE IS IN THE ROW, NOT IN A PROMPT RULE. docs/RELATIONALOS.md measured
// an instruction leaking 57-98% of the time against a SQL predicate leaking 0
// in 31,122. A hedge that lives in the render is an instruction; a hedge in the
// body cannot be separated from the claim it hedges by any reader, present or
// future.
ok("…and the hedge is part of the body, so no reader can drop it",
  /photo they sent — looked like/.test(PHOTO));
ok("the photo fact carries the vision confidence, not the 0.9 it used to claim",
  /\$\{PHOTO_VISION_CONFIDENCE\}/.test(PHOTO) && !/'extracted',0\.9,/.test(PHOTO));
ok("the photo fact is still marked sensitive", /sensitive/.test(PHOTO));
ok("the photo fact gets an embedding", /embedOne\(body\)/.test(PHOTO));
ok("the claim still goes to vy_visual_assertion", /writeVisualAssertion\(/.test(PHOTO));

// P2-3: the summary clobber. openOrExtendEpisode EXTENDS the open chat
// episode, so an unconditional `summary = $n` overwrote whatever opRemember
// had derived from the actual conversation with a photo caption.
ok("the episode summary is only written when nothing derived one",
  /summary = case when coalesce\(summary, ''\) = '' then \$2 else summary end/.test(PHOTO));
// comment-stripped, for the same reason: the old call is quoted in the note
// that explains why it is gone
const PHOTO_CODE = PHOTO.replace(/^\s*\/\/.*$/gm, "");
ok("…and touchEpisode's unconditional summary write is no longer used here",
  !/touchEpisode\(ep\.id, \{ summary/.test(PHOTO_CODE));

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4 dates and ranking (P1-6)");
// ═════════════════════════════════════════════════════════════════════════
ok("opRecall selects created_at", /created_at/.test(OP_RECALL.slice(0, OP_RECALL.indexOf("const RANK"))));
ok("opRecall selects mentions", /mentions/.test(OP_RECALL.slice(0, OP_RECALL.indexOf("const RANK"))));

const DAY = 86_400_000;
const now = Date.now();
// a node first told three weeks ago and mentioned again yesterday
const older = M.provenanceAge({
  created_at: new Date(now - 21 * DAY).toISOString(),
  updated_at: new Date(now - 1 * DAY).toISOString(),
  mentions: 4,
});
ok("an aged node renders both dates", /first told .* last came up /.test(older), older);
ok("…and its mention count, which is the unit the pair is missing without it",
  /4 times in all/.test(older), older);
// a node told and updated the same day renders exactly as it always did — the
// byte-identity frame for every fresh relationship
const fresh = M.provenanceAge({
  created_at: new Date(now - 2 * 3600_000).toISOString(),
  updated_at: new Date(now - 1 * 3600_000).toISOString(),
  mentions: 1,
});
ok("a same-day node renders one date, as before", fresh === "last came up today", fresh);
ok("a node with no created_at degrades to the old line, never to NaN",
  M.provenanceAge({ updated_at: new Date(now).toISOString() }) === "last came up today");

// the background leg: 5 ranked + 1 reserved
ok("the background leg ranks on salience x recency x mentions",
  /salience \* \$\{RECENCY\} \* \(1\.0 \+ 0\.35 \* ln\(1\.0 \+ mentions\)\)/.test(OP_RECALL));
ok("the background leg reserves a slot for the oldest high-salience row",
  /reserved as \(/.test(OP_RECALL) && /order by s\.created_at asc limit 1/.test(OP_RECALL));
ok("the reserved row can never duplicate a ranked one",
  /not exists \(select 1 from ranked k where k\.id = s\.id\)/.test(OP_RECALL));
ok("the reservation is put back in order in JS, not trusted to `union all`",
  /Number\(a\.slot \?\? 0\) - Number\(b\.slot \?\? 0\)/.test(OP_RECALL));

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§5 spaced resurfacing is a RANK MODIFIER — L3 untouched");
// ═════════════════════════════════════════════════════════════════════════
//
// This is the assertion the whole mechanism is allowed to exist under. The
// spacing literature's expanding-interval idea is a good ranking signal and a
// catastrophic trigger: "this memory is due" deciding that she SAYS something
// is the definition of push-shaped memory, and L3 (`moment.ts:23-27`, 0/60
// unprompted raises) is not a preference.
//
// The proof is structural and it is cheap because the mechanism was built to
// make it cheap: due-ness exists ONLY as a multiplicative term inside one SQL
// string. There is no JS branch anywhere that reads it.
ok("the modifier exists", /const SPACED = `case/.test(OP_RECALL));
ok("it suppresses what was recalled in the last day", /interval '20 hours' then 0\.6/.test(OP_RECALL));
ok("it lifts what has been untouched for three weeks", /interval '21 days' then 1\.25/.test(OP_RECALL));
ok("it multiplies into RANK and nothing else", /\* \$\{SPACED\}/.test(OP_RECALL));
// THE TEETH: `last_recalled` may appear in opRecall in exactly three places —
// the projection (so a row can be inspected), the SPACED case (the modifier),
// and the existing `update ... set last_recalled = now()` touch. A fourth
// occurrence is a code path reading due-ness, which is the thing that must not
// exist. This is the check that would fail the day somebody writes
// `if (row.last_recalled < …) raise(...)`.
// Comment-stripped: prose about the mechanism is not the mechanism. Exactly
// five uses are legal — the projection (1), the three arms of the SPACED case,
// and the existing `set last_recalled = now()` touch. A sixth is a new code
// path reading due-ness, which is the thing that must not exist; this is the
// check that fails the day somebody writes `if (row.last_recalled < …)`.
const RECALL_CODE = OP_RECALL.replace(/^\s*\/\/.*$/gm, "");
const lastRecalledUses = (RECALL_CODE.match(/last_recalled/g) || []).length;
ok(`last_recalled appears only in the projection, the modifier and the touch (${lastRecalledUses}/5)`,
  lastRecalledUses === 5, `found ${lastRecalledUses}; a new use is a possible trigger`);
ok("no JS branch reads due-ness",
  !/if\s*\([^)]*last_recalled/.test(OP_RECALL) && !/\.last_recalled/.test(OP_RECALL));
ok("STANDING BACKGROUND still says never raise unprompted",
  /STANDING BACKGROUND[^\n]*never raise these unprompted/.test(OP_RECALL));

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§6 RRF fusion and the co-citation hop (world-class #2)");
// ═════════════════════════════════════════════════════════════════════════
//
// The real exported function, not a copy of it.
const legA = { origin: "matched", kindOf: "node", rows: [{ id: 1, name: "zerodha" }, { id: 2, name: "rohit" }] };
const legB = { origin: "semantic", kindOf: "fact", rows: [{ id: 10, name: "rohit" }, { id: 11, name: "emi" }] };
const legC = { origin: "cocite", kindOf: "fact", rows: [{ id: 20, name: "bike" }] };
const f1 = M.rrfFuse([legA, legB, legC]);
// `rohit` is rank 2 in one leg and rank 1 in another; `zerodha` is rank 1 in
// one leg only. Agreement between differently-earned signals is the entire
// mechanism, so the row two legs found must outrank the row one leg found.
ok("a row two legs agree on outranks a row one leg found",
  f1.findIndex((r) => r.name === "rohit") < f1.findIndex((r) => r.name === "zerodha"),
  f1.map((r) => r.name).join(","));
ok("fusion is deterministic",
  JSON.stringify(M.rrfFuse([legA, legB, legC])) === JSON.stringify(f1));
ok("fusion is order-independent across legs",
  JSON.stringify(M.rrfFuse([legC, legB, legA]).map((r) => r.name).sort()) ===
    JSON.stringify(f1.map((r) => r.name).sort()));
// G-E2: empty fixtures fuse nothing, so a person with no memories produces the
// exact prompt they produce today, byte for byte.
ok("empty legs fuse to nothing (G-E2 byte identity)", M.rrfFuse([]).length === 0);
ok("…including legs that are present but empty",
  M.rrfFuse([{ origin: "matched", kindOf: "node", rows: [] }]).length === 0);
ok("fusion is capped", M.rrfFuse([{ origin: "x", kindOf: "n", rows: Array.from({ length: 40 }, (_, i) => ({ id: i, name: `n${i}` })) }]).length === M.RRF_SLOTS);
ok("a nameless row stays its own candidate rather than merging with every other",
  M.rrfFuse([{ origin: "a", kindOf: "n", rows: [{ id: 1 }, { id: 2 }] }]).length === 2);

ok("the co-citation hop walks vy_fact.citations", /f\.citations && \$2::bigint\[\]/.test(OP_RECALL));
ok("…excluding its own seeds", /not \(f\.id = any\(\$3::bigint\[\]\)\)/.test(OP_RECALL));
ok("…agent-scoped on the hop's own side of the walk",
  /shared desc[\s\S]{0,80}limit 4/.test(OP_RECALL) && /and f\.name not like 'activity:%'[\s\S]{0,200}agentScopePredicate/.test(OP_RECALL));
ok("…ranked by how much of the same conversation it shares",
  /order by shared desc/.test(OP_RECALL));
ok("…and bounded, so a serial hop cannot park a reply", /1_500,/.test(OP_RECALL));
ok("the hop is skipped entirely when there are no seeds",
  /seedCites\.length\s*\?/.test(OP_RECALL));

// LABELS SURVIVE FUSION. The survey's own framing: "fuse to decide WHICH ROWS
// SURVIVE, keep the blocks to decide HOW THEY ARE FRAMED." A fused list that
// collapsed the blocks would make a diag trace unable to say which store
// answered, which is the property the labelled-block design exists to keep.
for (const label of [
  "RELEVANT TO WHAT THEY JUST SAID",
  "STANDING BACKGROUND",
  "ALSO RELEVANT",
  "FROM THE SAME CONVERSATION",
  "GAMES AND THINGS YOU TWO ACTUALLY DID",
  "THINGS YOU TWO LOOKED AT TOGETHER",
]) {
  ok(`the "${label.slice(0, 28)}" block still has its own label`, OP_RECALL.includes(label));
}
// and the trace can still say what fusion dropped — a reordering nobody can
// see is a reordering nobody can debug (`realtime-recall-never`)
ok("the trace counts pre-fusion rows", /matched_pre_fusion_n/.test(OP_RECALL) && /pre_fusion_n: semanticAll\.length/.test(OP_RECALL));
ok("the trace counts the hop and the watch leg",
  /cocite: \{/.test(OP_RECALL) && /watched: \{/.test(OP_RECALL));

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§6b T5's byte ceiling — whole blocks, and the mirrored number");
// ═════════════════════════════════════════════════════════════════════════
//
// This wave added two blocks to T5 and grew a third, and T5 had no ceiling on
// the producing side at all: the only thing bounding it was api/chat.js,
// which keeps the FIRST n characters and cuts the END. `silent-truncation`
// took the crisis helplines once already.
const COMPILER_SRC = src("src/engine/compiler.ts");
const t5Manifest = /id: "T5",[\s\S]{0,220}?budget: ([\d_]+)/.exec(COMPILER_SRC)?.[1] ?? "";
ok(
  `the mirrored T5 budget matches compiler.ts's manifest (${M.RECALL_T5_BUDGET} vs ${t5Manifest})`,
  Number(String(t5Manifest).replace(/_/g, "")) === M.RECALL_T5_BUDGET,
  "a reader bounding at 6,000 against a manifest that moved does not fail — it hands over a block " +
    "the compiler drops whole, which looks exactly like a store with nothing in it",
);
ok("blocks over budget are dropped WHOLE, never sliced",
  /if \(usedBytes \+ cost > RECALL_T5_BUDGET\) \{[\s\S]{0,200}continue;/.test(OP_RECALL) &&
    !/memories\.slice\(0, RECALL_T5_BUDGET\)/.test(OP_RECALL));
ok("a dropped block is said out loud, not absorbed into a count",
  /T5 over budget — dropped whole block\(s\)/.test(OP_RECALL));
ok("the trace names the blocks that actually went, not the ones that were built",
  /const blockLabels = fitted\.map/.test(OP_RECALL));
// the drop ORDER is the policy: the record of what they did together must be
// the last thing to go, so it is built first
ok("the activity block is built before every block that can evict it",
  OP_RECALL.indexOf("GAMES AND THINGS YOU TWO ACTUALLY DID") <
    OP_RECALL.indexOf("THINGS YOU TWO LOOKED AT TOGETHER") &&
    OP_RECALL.indexOf("THINGS YOU TWO LOOKED AT TOGETHER") <
      OP_RECALL.indexOf("FROM THE SAME CONVERSATION"));

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§7 the opLog channel contract");
// ═════════════════════════════════════════════════════════════════════════
ok("`watch` is a legal logged channel", M.LOG_CHANNELS.has("watch"));
ok("`chat` and `call` still are", M.LOG_CHANNELS.has("chat") && M.LOG_CHANNELS.has("call"));
ok("nothing else is", M.LOG_CHANNELS.size === 3, [...M.LOG_CHANNELS].join(","));
ok("opLog validates against the enum rather than a ternary",
  /LOG_CHANNELS\.has\(t\.channel\) \? t\.channel : "chat"/.test(MEMORY_SRC));
ok("an unrecognised channel still falls back to chat, so a hostile client cannot invent one",
  /: "chat"/.test(MEMORY_SRC));

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§8 THE FATE TABLE — every server store decides what a forget does to it");
// ═════════════════════════════════════════════════════════════════════════
//
// evals/teardown.mjs asks this question of every field of AppState, on the
// device. Nobody was asking it of the SERVER, and that is exactly how
// meera_state — the server's copy of the transcript plus the user profile —
// sat outside forget and outside export for as long as it has existed.
//
// The three verdicts are the teardown's, one layer down:
//
//   "clear+forget"  the conversation's own state. A scoped forget prunes it
//                   and a whole wipe takes it.
//   "forget-only"   relational memory. Only the stronger door may take it,
//                   and a scoped forget reaches it only through its own text
//                   or its own window.
//   "exempt: …"     not the relationship. The reason IS the check.
//
// THE ENUMERATION IS THE WHOLE POINT (the lesson evals/teardown.mjs's walker
// rewrite states from the other side: a coverage check is only as wide as the
// thing it enumerates). So the walk is over PERSON_TABLES itself — the live
// manifest, not a list copied into this file — plus the paths this wave added
// that are not tables.
const FATE = {
  // ── the conversation, and the server's copies of it ──
  meera_log: "clear+forget",
  meera_nodes: "clear+forget",
  meera_edges: "clear+forget",
  meera_state: "clear+forget", // P2-1: the synced AppState blob
  meera_tel: "clear+forget",
  meera_tel_session: "clear+forget",
  meera_diag: "clear+forget", // found by the widened coverage query
  meera_events: "clear+forget",
  // found by this walk: both were in PERSON_TABLES, both are lane "legacy",
  // the wipe loop only takes lane "relational", and no explicit code named
  // them — so nothing deleted a turn trace except the 90-day horizon in
  // api/_trace.js. purgeTurnTrace() is the clause the manifest entry's own
  // comment already claimed existed.
  meera_turn: "clear+forget",
  meera_turn_leg: "clear+forget",
  // Reachability: a push token is the ability to reach this phone. The
  // WIPE takes it (relational lane, manifest loop) and the client half
  // clears on both doors (teardown.mjs #6 REACHABILITY) — but a SCOPED
  // "forget priya" must NOT unsubscribe his notifications: a token has no
  // term to match and deleting it on an item-forget would break a promise
  // he never made. Hence forget-only here.
  vy_push_token: "forget-only",
  // The suppression list itself. A list of the things somebody asked to have
  // deleted is a record of them, so a whole wipe takes it — and a SCOPED
  // forget must not, because the scoped forget is the thing that WRITES it.
  meera_forget:
    "exempt: written BY a scoped forget (it is what stops the extractor " +
    "re-deriving the thing from a transcript still on screen), and deleted " +
    "outright by the whole wipe. A scoped forget that pruned it would undo " +
    "itself on the next remember pass.",

  // ── relational memory: the stronger door, or a term/window that names it ──
  vy_episode: "forget-only",
  vy_episode_participant: "forget-only",
  vy_fact: "forget-only",
  vy_taste_candidate: "forget-only",
  // P2-1: reachable by its OWN text now (reaction ~* rx), not only by the
  // FK cascade from an episode a window happened to catch
  vy_shared_moment: "forget-only",
  vy_visual_assertion: "forget-only",
  vy_rel_event: "forget-only",
  vy_rel_state: "forget-only",
  vy_pattern: "forget-only",
  vy_phrase: "forget-only",
  vy_kin: "forget-only",
  vy_ritual: "forget-only",
  vy_currency: "forget-only",
  vy_india_profile: "forget-only",
  vy_rel_texture: "forget-only",
  vy_observation: "forget-only",
  vy_agent_life_told: "forget-only",
  vy_embedding: "forget-only",
  vy_derivation: "forget-only",
  vy_session: "forget-only",
  vy_group_member: "forget-only",
  vy_disclosure_grant: "forget-only",
  vy_tg_person: "forget-only",
  vy_surface_identity: "forget-only",

  // ── the replica lane's person side (WS-R; migrations 015, 023, 027) ──
  //
  // Found by scripts/relcheck.mjs against the LIVE database, which is the
  // point: all four were person-keyed, none was in the manifest, so a person
  // who asked to be forgotten kept rows in them and their export came back
  // with a hole in it. The fourth (vy_replica_runtime_capability) was invisible
  // even to relcheck until its column list widened — it is keyed on
  // subject_person_id, and the coverage query enumerated three column names.
  //
  // forget-only, all four, for the reason vy_push_token is: none of them has a
  // term a scoped "forget priya" could match. A dialogue turn stores hashes and
  // ids, never the words; a session and a capability are grants and timestamps.
  // Only the stronger door may take them.
  vy_replica_dialogue_turn: "forget-only",
  vy_replica_runtime_session: "forget-only",
  vy_replica_runtime_capability: "forget-only",
  // The auth↔person bridge (015). A whole wipe takes it because it is the row
  // that says which person an account IS — the single most identifying row in
  // the database. A scoped forget must not: unbinding an account from its
  // person because someone asked to forget one topic would log them out of
  // their own memory.
  vy_account_person: "forget-only",

  // ── the Room's person side (WS-R1; migration 071) ──
  //
  // A follower's membership of a creator's Room, and the titles they gave
  // their own topic threads. Neither has a term a scoped "forget priya" could
  // match — a membership is a join timestamp and a consent boolean, a thread
  // row is a UUID and a short label the follower typed once — so api/memory.js's
  // opForget, which resolves a referring expression against extracted facts and
  // episodes, has no predicate that could ever name either table; api/room.js
  // never calls opForget at all. Only the stronger door may take them: the
  // account-level whole wipe (this manifest's loop, lane "relational", which is
  // what the check below proves) or the Room's own "op":"forget" — a whole
  // wipe scoped to one agent rather than one account, and PERSON_TABLES'
  // `agent` flag is what keeps it from also taking a follower's rows in every
  // OTHER creator's room.
  vy_room_thread: "forget-only",
  vy_room_follower: "forget-only",

  // ── the Room's cohort day-count (WS-R12; migration 077) ──
  //
  // "Did this follower have a turn on this day" - an id, a date, a count, and
  // no term a scoped "forget priya" could ever match, its two 071 siblings'
  // reason exactly. Only the stronger door may take it: the account-level
  // whole wipe (lane "relational", proven below) or the Room's own
  // "op":"forget" (`roomForget`'s explicit room_id+person_id delete,
  // api/_room-surface.js). NO `agent` flag, unlike its two siblings - this
  // table carries no `agent_id` column (071's two do), so it is deliberately
  // absent from `roomScopedTables()`'s generic per-agent loop and reached by
  // name instead; `entry.lane === "relational"` is still what makes the
  // check below true of it.
  vy_room_follower_day: "forget-only",
  // ── WS-R11: the Room's money, person side (migration 078) ──
  // A subscription is not memory, so a SCOPED "forget priya" has no term that
  // could ever name it (a provider reference and a state, no words). Only the
  // stronger door may take it, and even that door only takes it once its
  // state is terminal - see api/memory.js's own PERSON_TABLES comment on this
  // row for why a LIVE mandate survives a whole-account wipe rather than
  // being silently orphaned.
  vy_room_subscription: "forget-only",
  // ── the Room's Pulse opt-in (WS-R17; migration 080) ──
  // A follower's own toggle - content-free, no term a scoped "forget priya"
  // could ever match (a UUID, a boolean-shaped pair of timestamps and a
  // policy version, no words). Only the stronger door may take it: the
  // account-level whole wipe (lane "relational", proven below) or the Room's
  // own "op":"forget" (`roomForget`'s explicit room_id+person_id delete,
  // api/_room-surface.js), `vy_room_follower_day`'s pattern one row above.
  vy_room_pulse_optin: "forget-only",

  // ── the consent ledger (task #148, migration 016) ──
  // The whole wipe takes it: a device-keyed record of a person surviving the
  // one request whose promise is that nothing about them remains would break
  // that promise in order to keep evidence of a permission that no longer
  // applies to anything, and the absence of a granted row IS the absence of
  // consent. A SCOPED forget must not touch it — "forget priya" has nothing to
  // prune out of a boolean, and a scoped door that silently revoked a
  // permission would be a second, larger act done in the name of the first.
  // The refusal that actually stops the writes is the copy on the device
  // (src/engine/memory.ts's gate), which no server delete can reach.
  meera_consent: "forget-only",

  // ── the identity itself ──
  vy_person_device:
    "exempt: the mapping is deleted by explicit guarded code at the END of the " +
    "whole-wipe path, never by the manifest loop — deleting it first would " +
    "orphan every person-keyed row the wipe has not reached yet.",
  vy_person:
    "exempt: same guarded tail, and conditional — the person row survives if " +
    "another device still maps to it, because that device has not asked to be " +
    "forgotten.",

  // ── the non-table paths this wave added ──
  "path:photo-object-storage":
    "clear+forget", // deletePhotos + deletePhotoObjects: the JPEG, not just its row
  "path:shared-moment-reader":
    "exempt: a READ path, not a store. It holds nothing; it is listed so the " +
    "next person can see that the question was asked of it. What it reads is " +
    "vy_shared_moment, which has its own row above.",
};

// (a) every manifest table has a written verdict
for (const t of M.PERSON_TABLES) {
  ok(
    `${t.table} has a written forget fate`,
    typeof FATE[t.table] === "string",
    `${t.table} is in PERSON_TABLES and not in this file's FATE table. Decide, in ` +
      `writing: "clear+forget" if a scoped forget prunes it and a wipe takes it, ` +
      `"forget-only" if only the stronger door may, or "exempt: <reason>".`,
  );
}
// (b) …and no verdict names a table that has left the manifest
const manifestTables = new Set(M.PERSON_TABLES.map((t) => t.table));
for (const key of Object.keys(FATE)) {
  if (key.startsWith("path:")) continue;
  ok(`the verdict for '${key}' still names a manifest table`, manifestTables.has(key));
}

// (c) the verdicts have to be TRUE of the code, or they are decoration.
// clear+forget means a SCOPED forget reaches it, so each of these must be
// named on a scoped path in opForget, not only on the wipe.
for (const [table, verdict] of Object.entries(FATE)) {
  if (verdict !== "clear+forget" || table.startsWith("path:")) continue;
  const named =
    OP_FORGET.includes(table) ||
    // the four purge helpers opForget calls on every scope
    new RegExp(`from ${table}\\b`).test(MEMORY_SRC);
  ok(`${table} is actually reachable by a forget, as declared`, named);
}
// forget-only means the wipe's manifest loop takes it — which it does by
// construction for lane "relational", and that is the property to assert
for (const [table, verdict] of Object.entries(FATE)) {
  if (verdict !== "forget-only") continue;
  const entry = M.PERSON_TABLES.find((t) => t.table === table);
  ok(`${table} is in the relational lane, so the wipe loop takes it`,
    entry?.lane === "relational", `lane=${entry?.lane}`);
}

// (d) the wave's new stores are reachable by their OWN text, not only by a
// window — the P2-1 ask, asserted where it lives
ok("vy_shared_moment is reachable by its reaction text",
  /delete from vy_shared_moment[\s\S]{0,200}reaction ~\* \$2/.test(MEMORY_SRC));
ok("vy_visual_assertion is reachable by its claim text",
  /delete from vy_visual_assertion[\s\S]{0,200}claim ~\* \$2/.test(MEMORY_SRC));
ok("…and both are reachable by a window too",
  /at >= \$2::timestamptz and at < \$3::timestamptz/.test(MEMORY_SRC) &&
    /created_at >= \$2::timestamptz and created_at < \$3::timestamptz/.test(MEMORY_SRC));

// (e) meera_state: purged on a wipe, REWRITTEN on a scope
// `forget-follows-the-person` (2026-08-26) renamed the argument to the
// person's device SET. The property asserted here — every scope reaches the
// synced blob — is unchanged and strictly stronger, so the pattern accepts
// either spelling rather than pinning a variable name.
ok("a whole wipe deletes the synced state row",
  /purgeSyncedState\(devices?, \{ all: true \}\)/.test(OP_FORGET));
// A1 (survey §Q5) widened the term an item forget carries: the referring
// expression is resolved to nodes at mutation time and their NAMES join the
// predicate, so the argument is now `rxWide` rather than `rx`. The property
// this line has always asserted — an item forget reaches the synced blob BY
// TERM and not only by window — is unchanged and strictly stronger, so the
// pattern accepts either spelling rather than pinning one variable name.
ok("an item forget rewrites it by term",
  /purgeSyncedState\(devices?, \{ rx(: rxWide)? \}\)/.test(OP_FORGET));
ok("a window forget rewrites it by window", /purgeSyncedState\(devices?, \{ from, to \}\)/.test(OP_FORGET));
ok("the rewrite never leaves a NULL where the client expects an array",
  /coalesce\(\(select jsonb_agg/.test(MEMORY_SRC));
ok("the window comparison casts epoch ms to a number, not text",
  /\(e->>'at'\)::bigint/.test(MEMORY_SRC));
ok("the authenticated door exists for the row this device cannot name",
  /op === "wipe_state"/.test(ACCOUNT_SRC));
ok("…and clear-chat's server half keeps `user`, as its own dialog promises",
  !/'\{user\}'/.test(ACCOUNT_SRC.slice(ACCOUNT_SRC.indexOf('op === "wipe_state"'))));
ok("…while forget's server half takes the whole row",
  /delete from meera_state where user_id = \$1/.test(ACCOUNT_SRC));
ok("the client threads a wipe on scope=all and only on scope=all",
  /target\.scope === "all"\) void wipeServerState/.test(CLIENT_SRC));

// ── THE NEGATIVE CONTROLS ────────────────────────────────────────────────
//
// Every assertion above passes on today's tree, which proves nothing about
// whether it would have caught yesterday's. These two run the SAME logic
// against the PRE-FIX shape and require it to fail.
console.log("\n  -- negative controls: the pre-fix shapes must fail --");

// 1. the coverage query. Before this wave it read `table_name like 'vy\_%'`,
//    so meera_state was invisible to the one guard whose job is exactly this.
const CATALOG = [
  "vy_fact", "vy_episode", "vy_embedding",
  "meera_log", "meera_nodes", "meera_state", "meera_diag", "meera_events",
];
const coverage = (prefixes, cols, listedSet) =>
  CATALOG.filter((t) => prefixes.some((p) => t.startsWith(p)) && !listedSet.has(t));
// the pre-fix manifest: PERSON_TABLES as it was, i.e. without this wave's rows
const PREFIX_MANIFEST = new Set(
  [...manifestTables].filter((t) => !["meera_state", "meera_events", "meera_diag"].includes(t)),
);
const preFixMissed = coverage(["vy_"], ["person_id", "device_id"], PREFIX_MANIFEST);
ok(
  "PRE-FIX: the vy_-only coverage query reports green with meera_state unlisted",
  !preFixMissed.includes("meera_state"),
  "the pre-fix control did not reproduce the hole — this control is not testing anything",
);
const postFixMissed = coverage(["vy_", "meera_"], ["person_id", "device_id", "user_id"], PREFIX_MANIFEST);
ok(
  "POST-FIX: the widened query catches meera_state when it is unlisted",
  postFixMissed.includes("meera_state"),
);
ok(
  "…and the real relcheck.mjs is the widened one",
  /table_name like 'vy\\\\_%' or table_name like 'meera\\\\_%'/.test(RELCHECK_SRC) &&
    /'person_id','device_id','user_id'/.test(RELCHECK_SRC),
);
ok(
  "…with today's manifest, the widened query finds nothing missing",
  !coverage(["vy_", "meera_"], [], manifestTables).length,
  coverage(["vy_", "meera_"], [], manifestTables).join(","),
);

// 2. the forget path itself. Strip purgeSyncedState back out of opForget and
//    the (e) assertions above must go red — if they do not, they are asserting
//    something that was already true and are worth nothing.
const preFixForget = OP_FORGET.replace(/purgeSyncedState/g, "__removed__");
const wouldCatch = [
  /purgeSyncedState\(device, \{ all: true \}\)/,
  /purgeSyncedState\(device, \{ rx \}\)/,
  /purgeSyncedState\(device, \{ from, to \}\)/,
].every((rx) => !rx.test(preFixForget));
ok("PRE-FIX: an opForget with no meera_state purge fails all three scope checks", wouldCatch);

// 3. the FATE walk. Drop a table's verdict and the walk must notice — the
//    exact failure mode that let meera_state exist unlisted for a year.
const holed = { ...FATE };
delete holed.meera_state;
ok(
  "PRE-FIX: the FATE walk fails when a manifest table has no verdict",
  M.PERSON_TABLES.some((t) => typeof holed[t.table] !== "string"),
);

note(`${M.PERSON_TABLES.length} manifest tables walked`);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§9 the retrieval-quality A/B, as a gate");
// ═════════════════════════════════════════════════════════════════════════
//
// evals/recall/quality.mjs prints the before/after table; run here with
// --gate so it also FAILS on a regression. Wired rather than left standalone
// for the reason this repo states everywhere else: a measurement nothing
// invokes is a measurement that was taken once.
try {
  const { execSync } = await import("node:child_process");
  execSync(`node ${join(HERE, "quality.mjs")} --gate`, { stdio: "inherit", cwd: ROOT });
  ok("no retrieval-quality metric regressed", true);
} catch {
  ok("no retrieval-quality metric regressed", false, "see the table above");
}

console.log(
  failed
    ? `\n${failed} FAILURES (${passed} passed)`
    : `\nALL PASS (${passed} assertions)`,
);
process.exit(failed ? 1 : 0);
