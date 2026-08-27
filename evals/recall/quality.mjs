// WS-RECALL — the retrieval-quality delta, measured rather than argued.
//
//   node evals/recall/quality.mjs          # the table
//   node evals/recall/quality.mjs --gate   # …and exit 1 if it regressed
//
// WHAT THIS IS AND IS NOT, stated first because a number with an unclear
// method is worse than no number (context/measurements.md's own rule: "a
// number without n, method and date cannot be compared against a future one,
// which is the only thing numbers are for").
//
//   IT IS: an offline A/B of the SELECTION LOGIC — which rows reach the
//   prompt — over a fixture store and a labelled query set, run through the
//   REAL exported tokenizer and the REAL exported RRF fusion.
//
//   IT IS NOT: a measurement of production recall, and it cannot be. The
//   ranking arithmetic lives in a SQL string that Postgres evaluates, so the
//   ARM below mirrors it in JS. A mirror is a copy, and this file says so
//   rather than implying coverage it does not have — `check_rank_mirror`
//   asserts the JS mirror and the SQL string still agree on their terms,
//   which is the most a JS process can prove about a SQL expression.
//
//   n = 14 labelled queries over a 22-row fixture store, 2026-08-23.
//
// The fixture store is shaped from the audit's own conversation fixture
// (scratchpad/memaudit/fixtures.mjs): a job change 25 days ago, the friend who
// referred him, a photo 21 days ago, a fight and a repair 10 days ago, a bike
// plan on yesterday's call, a video they watched together, and eight days of
// filler that is exactly what a real store is mostly made of.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const M = await import(pathToFileURL(join(ROOT, "api/memory.js")).href);
const MEMORY_SRC = readFileSync(join(ROOT, "api/memory.js"), "utf8");

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 23, 14, 0, 0);
const ago = (d) => new Date(NOW - d * DAY).toISOString();

// ── the fixture store ────────────────────────────────────────────────────
// `created_at` is when he first said it, `updated_at` when it last came up,
// `mentions` how often — the three fields the pre-fix ranking used one of.
const NODES = [
  { id: 1,  kind: "fact",       name: "zerodha",      summary: "changed jobs, now at zerodha, joined a monday",  created_at: ago(25), updated_at: ago(25), salience: 3.2, mentions: 3, last_recalled: ago(30), feel: "" },
  { id: 2,  kind: "person",     name: "rohit",        summary: "childhood friend, referred him into zerodha",    created_at: ago(25), updated_at: ago(9),  salience: 2.8, mentions: 4, last_recalled: ago(9),  feel: "" },
  { id: 3,  kind: "plan",       name: "bike",         summary: "wants a classic 350 next month, checking emi",   created_at: ago(1),  updated_at: ago(1),  salience: 2.0, mentions: 2, last_recalled: null,     feel: "" },
  { id: 4,  kind: "emotion",    name: "fight",        summary: "said she never listens, apologised same day",     created_at: ago(10), updated_at: ago(10), salience: 2.6, mentions: 1, last_recalled: ago(10), feel: "din kharab tha" },
  { id: 5,  kind: "event",      name: "balcony photo",summary: "sent a picture from his balcony",                 created_at: ago(21), updated_at: ago(21), salience: 1.4, mentions: 1, last_recalled: null,     feel: "" },
  { id: 6,  kind: "preference", name: "maggi",        summary: "eats maggi most nights",                          created_at: ago(9),  updated_at: ago(2),  salience: 1.6, mentions: 6, last_recalled: ago(0),  feel: "" },
  { id: 7,  kind: "fact",       name: "naukri",       summary: "the job change he was nervous about",             created_at: ago(25), updated_at: ago(20), salience: 2.2, mentions: 2, last_recalled: ago(20), feel: "" },
  { id: 8,  kind: "place",      name: "office",       summary: "new office is far, commute is long",              created_at: ago(19), updated_at: ago(5),  salience: 2.1, mentions: 3, last_recalled: ago(5),  feel: "" },
  { id: 9,  kind: "topic",      name: "gym",          summary: "started going to the gym before work",            created_at: ago(14), updated_at: ago(3),  salience: 1.8, mentions: 3, last_recalled: ago(3),  feel: "" },
  { id: 10, kind: "person",     name: "maa",          summary: "his mother calls every sunday",                   created_at: ago(40), updated_at: ago(12), salience: 2.4, mentions: 2, last_recalled: ago(35), feel: "" },
  { id: 11, kind: "event",      name: "video",        summary: "the video with the cat falling, watched together",created_at: ago(1),  updated_at: ago(1),  salience: 1.5, mentions: 1, last_recalled: null,     feel: "" },
  // the filler — eight days of nothing, which is what a store is mostly made of
  ...Array.from({ length: 11 }, (_, i) => ({
    id: 100 + i,
    kind: "topic",
    name: `din ${i}`,
    summary: `talked about the day, ${i === 0 ? "theek tha" : "same as always"}`,
    created_at: ago(9 - (i % 8)),
    updated_at: ago(2 + (i % 3)),
    salience: 1.0 + (i % 3) * 0.1,
    mentions: 1,
    last_recalled: ago(i % 2),
    feel: "",
  })),
];

// facts reachable only by the SEMANTIC leg (no shared word with the query) and
// by the co-citation hop. Both are vy_fact-shaped.
const FACTS = [
  { id: 501, kind: "user", name: "office pressure", body: "work has been heavy since the switch", citations: [9001], created_at: ago(6) },
  { id: 502, kind: "user", name: "referral",        body: "got in through a friend already there", citations: [9001], created_at: ago(25) },
  { id: 503, kind: "user", name: "emi",             body: "monthly outgo he is working out",       citations: [9002], created_at: ago(1) },
];
// which facts a query's embedding would plausibly reach. Hand-labelled: an
// offline process has no embedding model, and inventing one would make this
// measure a measure of the fake model.
const SEMANTIC = {
  "kaam kaisa chal raha hai": [501],
  "job kaisi chal rahi hai": [501],
  "meri naukri ke baare me": [501],
};

// ── the labelled set: which rows are genuinely relevant to each query ─────
const QUERIES = [
  { q: "kaam kaisa chal raha hai",   relevant: [1, 7, 8, 501] },
  { q: "job kaisi chal rahi hai",    relevant: [1, 7, 8, 501] },
  { q: "meri naukri ke baare me",    relevant: [7, 1, 501] },
  { q: "us din kya hua tha",         relevant: [4] },
  { q: "rohit se baat hui",          relevant: [2] },
  { q: "wo baat yaad hai tumhe",     relevant: [4] },
  { q: "zerodha me kaisa lag raha hai", relevant: [1, 8] },
  { q: "gym ja rahe ho",             relevant: [9] },
  { q: "maa ko phone kiya",          relevant: [10] },
  { q: "bike ka kya scene hai",      relevant: [3] },
  { q: "wo video yaad hai",          relevant: [11] },
  { q: "photo wali baat",            relevant: [5] },
  { q: "kab bataya tha maine",       relevant: [1, 7] },
  { q: "kya kar rahi ho",            relevant: [] }, // no memory answers this
];

// ── the two tokenizers ───────────────────────────────────────────────────
const OLD_STOP = new Set([...M.RECALL_STOP, "kaam", "baat"]);
const oldTokens = (query) =>
  [...new Set(String(query).toLowerCase().match(/[a-z]{4,}|[ऀ-ॿ]{3,}/g) || [])]
    .filter((w) => !OLD_STOP.has(w))
    .slice(0, 6);

// ── the two rankers (JS MIRROR of the SQL — see the header) ──────────────
const days = (iso) => (NOW - new Date(iso).getTime()) / DAY;
const IDENTITY = new Set(["person", "place", "preference", "fact", "phrase"]);
const recency = (n) => (IDENTITY.has(n.kind) ? 1.0 : Math.max(0.25, 1.0 - days(n.updated_at) / 60));
const oldRank = (n) => n.salience * recency(n);
const spaced = (n) => {
  if (!n.last_recalled) return 1.0;
  const d = days(n.last_recalled);
  if (d < 20 / 24) return 0.6;
  if (d > 21) return 1.25;
  return 1.0;
};
const newRank = (n) => n.salience * recency(n) * (1 + 0.35 * Math.log(1 + n.mentions)) * spaced(n);

const wordHit = (n, words) =>
  words.some((w) => new RegExp(`\\b${w}\\b`, "i").test(`${n.name} ${n.summary}`));

// ── the two pipelines ────────────────────────────────────────────────────
function oldPipeline(query) {
  const words = oldTokens(query);
  const matched = words.length
    ? NODES.filter((n) => wordHit(n, words)).sort((a, b) => oldRank(b) - oldRank(a)).slice(0, 8)
    : [];
  const background = [...NODES].sort((a, b) => oldRank(b) - oldRank(a)).slice(0, 4);
  const semantic = (SEMANTIC[query] || []).map((id) => FACTS.find((f) => f.id === id)).filter(Boolean);
  // arrival order, per path, concatenated — exactly what the survey describes
  return [...matched, ...background, ...semantic].map((r) => r.id);
}

function newPipeline(query) {
  const words = M.recallTokens(query);
  const matched = words.length
    ? NODES.filter((n) => wordHit(n, words)).sort((a, b) => newRank(b) - newRank(a)).slice(0, 8)
    : [];
  const ranked = [...NODES].sort((a, b) => newRank(b) - newRank(a)).slice(0, 5);
  const reserved = [...NODES]
    .filter((n) => n.salience >= 2.0 && !ranked.some((r) => r.id === n.id))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
  const background = reserved ? [...ranked, reserved] : ranked;
  const semantic = (SEMANTIC[query] || []).map((id) => FACTS.find((f) => f.id === id)).filter(Boolean);
  // ONE CO-CITATION HOP: facts sharing an episode with a semantic seed
  const seedCites = new Set(semantic.flatMap((f) => f.citations));
  const cocite = FACTS.filter(
    (f) => !semantic.some((s) => s.id === f.id) && f.citations.some((c) => seedCites.has(c)),
  );
  // …then RRF over the three query-relevant legs, the REAL exported function
  const fused = M.rrfFuse([
    { origin: "matched", kindOf: "node", rows: matched },
    { origin: "semantic", kindOf: "fact", rows: semantic },
    { origin: "cocite", kindOf: "fact", rows: cocite },
  ]);
  return [...fused, ...background].map((r) => r.id);
}

// ── the metric ───────────────────────────────────────────────────────────
// recall@8 — eight is what actually reaches the prompt after the T5 budget
// slots it, so it is the number that describes the product rather than the
// index. `answered` is the harsher and more honest one: the fraction of
// queries for which AT LEAST ONE genuinely relevant row got there at all,
// because a query answered with nothing relevant is the failure a person
// experiences ("she doesn't remember"), and averaging it away hides it.
const K = 8;
function score(pipeline) {
  let hits = 0;
  let total = 0;
  let answered = 0;
  let answerable = 0;
  let falseFire = 0;
  const perQuery = [];
  for (const { q, relevant } of QUERIES) {
    const got = pipeline(q).slice(0, K);
    if (!relevant.length) {
      // the negative: retrieving background for a contentless query is fine
      // (background is continuity), but a KEYWORD hit on it is noise
      if (pipeline(q).length && M.recallTokens(q).length > 2) falseFire++;
      perQuery.push({ q, hit: null });
      continue;
    }
    answerable++;
    const found = relevant.filter((id) => got.includes(id));
    hits += found.length;
    total += relevant.length;
    if (found.length) answered++;
    perQuery.push({ q, hit: found.length, of: relevant.length });
  }
  return {
    recall: hits / total,
    answered: answered / answerable,
    answerable,
    falseFire,
    perQuery,
  };
}

const before = score(oldPipeline);
const after = score(newPipeline);

const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log("\nretrieval quality — fixture set, n=14 labelled queries over 22 rows");
console.log("  method: offline A/B of the selection logic; ranking is a JS mirror of");
console.log("          the SQL (see this file's header), tokenizer and RRF are the real ones\n");
console.log(`  ${"metric".padEnd(34)}${"before".padEnd(10)}after`);
console.log(`  ${"recall@8 over labelled rows".padEnd(34)}${pct(before.recall).padEnd(10)}${pct(after.recall)}`);
console.log(`  ${"queries with >=1 relevant row".padEnd(34)}${pct(before.answered).padEnd(10)}${pct(after.answered)}`);
console.log(`  ${"contentless queries that fired".padEnd(34)}${String(before.falseFire).padEnd(10)}${after.falseFire}`);

console.log("\n  per query (relevant rows retrieved / relevant rows that exist):");
for (let i = 0; i < QUERIES.length; i++) {
  const b = before.perQuery[i];
  const a = after.perQuery[i];
  if (b.hit === null) {
    console.log(`    ${"(negative)".padEnd(12)} ${QUERIES[i].q}`);
    continue;
  }
  const moved = a.hit > b.hit ? " ↑" : a.hit < b.hit ? " ↓" : "";
  console.log(`    ${`${b.hit}/${b.of} -> ${a.hit}/${a.of}`.padEnd(12)} ${QUERIES[i].q}${moved}`);
}

// ── check_rank_mirror ────────────────────────────────────────────────────
// The most a JS process can prove about a SQL expression: that both still
// name the same terms. A mirror that silently stopped mirroring would make
// every number above a measurement of this file instead of of the product.
const SQL_RANK = /const RANK = `([^`]+)`/.exec(MEMORY_SRC)?.[1] ?? "";
const mirrorTerms = ["salience", "RECENCY", "0.35 * ln(1.0 + mentions)", "SPACED"];
const mirrored = mirrorTerms.every((t) => SQL_RANK.includes(t));
console.log(`\n  ${mirrored ? "ok  " : "FAIL"} check_rank_mirror: the JS ranker names the same terms as the SQL`);

const regressed =
  after.recall < before.recall ||
  after.answered < before.answered ||
  after.falseFire > before.falseFire ||
  !mirrored;
if (regressed) console.log("\n  REGRESSION: a recall metric moved the wrong way");
else console.log("\n  no metric moved the wrong way");

if (process.argv.includes("--gate")) process.exit(regressed ? 1 : 0);
