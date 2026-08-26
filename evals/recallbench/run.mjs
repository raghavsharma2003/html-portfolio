// WS-K — the MEMORY RECALL BENCHMARK. ROADMAP-100X item 3.
//
//   node evals/recallbench/run.mjs
//   node evals/run.mjs recallbench
//
// Offline, deterministic, $0, no DB, no network, ZERO model calls, ~1s.
//
// ═════════════════════════════════════════════════════════════════════════
// §0. WHAT IS AND IS NOT EXERCISED — read this before reading a number
// ═════════════════════════════════════════════════════════════════════════
//
// ROADMAP-100X item 3, and the reason it is on the list: "the graph's recall
// accuracy is unmeasured, which contradicts the house ethos." Nobody has run
// a LoCoMo/LongMemEval-style probe against this memory graph. `measurements.md`
// requires n and method for every number in it and has none for recall.
//
// This file is the harness. It is NOT yet the measurement — see §5.
//
// ── EXERCISED (the shipping code, running unmodified) ────────────────────
//   • `api/memory.js` opRecall itself, reached through the real `handler`
//     with a real op:"recall" body. Not a re-implementation, not a copy.
//   • `recallTokens` — the Hinglish tokenizer, on every question text.
//   • the leg fan-out and its concurrency, including the ACTIVITY leg's
//     no-query-words fallback and the WATCH leg's two statements.
//   • the CO-CITATION hop's seeding: which rows become seeds, which fact ids
//     are excluded from the hop, and how many seeds it walks from.
//   • RRF fusion across the surviving legs, and which rows it drops.
//   • the name-dedup across blocks, the block ORDER, the block headings and
//     their fences, `provenanceAge`, the stale-fact note, and the T5
//     whole-block budget drop.
//
// ── EMULATED (evals/recallbench/store.mjs — a JS reading of the SQL) ──────
//   • the `~*` word-boundary match, the background leg's RANK expression and
//     its reserved slot, the co-citation intersection's ordering, every LIMIT.
//   Fixtures are sized so that MEMBERSHIP never turns on the emulated
//   ordering (every keyword question matches fewer rows than its LIMIT), so a
//   score here is a score of retrieval and rendering, not of the emulation.
//
// ── NOT EXERCISED, named rather than glossed ─────────────────────────────
//   • THE EXTRACTOR. The graph rows in `fixtures/` are AUTHORED — what a
//     correct extractor would have produced from the conversation beside
//     them. Whether the real extractor produces them from those 190 turns is
//     a SEPARATE measurement, it needs a keyed run, and this suite makes no
//     claim about it whatsoever. A benchmark that scored authored rows and
//     reported "recall accuracy" without this paragraph would be claiming
//     coverage of the half that actually fails.
//   • THE SEMANTIC (halfvec) LEG. The embedder is off (stubs/embed.mjs), so
//     the "same thing, no shared words" path contributes nothing here. Its
//     absence makes every score below a LOWER BOUND on the shipping system.
//   • THE FORGET CASCADE'S DELETES. Forget cases here assert that a deleted
//     row cannot come back through any leg; they do not assert that the
//     delete happened correctly. evals/recall/run.mjs's FATE walk owns that.
//   • LATENCY AND TOKENS/QUERY. Both are properties of Postgres and the
//     embedder, and neither is running.
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// The DB boundary is mocked BEFORE api/memory.js is imported — see loader.mjs
// for exactly which three modules are redirected and why.
register(pathToFileURL(join(HERE, "loader.mjs")));

// `handler` refuses without a configured Supabase pair (it is the gate that
// stops a misconfigured deploy answering with an empty store). Nothing in the
// recall path calls Supabase, so the pair is satisfied with obvious
// placeholders rather than the gate being edited out of the shipping file.
process.env.SUPABASE_URL = "https://recallbench.invalid";
process.env.SUPABASE_KEY = "recallbench-not-a-key";

const { loadFixture, unroutedQueries, routeCounts, setCrossSurface } = await import(pathToFileURL(join(HERE, "store.mjs")).href);
const memory = await import(pathToFileURL(join(HERE, "..", "..", "api", "memory.js")).href);
const handler = memory.default;

const DYADS = [
  (await import(pathToFileURL(join(HERE, "fixtures", "dyad-a.mjs")).href)).default,
  (await import(pathToFileURL(join(HERE, "fixtures", "dyad-b.mjs")).href)).default,
  (await import(pathToFileURL(join(HERE, "fixtures", "dyad-c.mjs")).href)).default,
];

let fail = 0;
let pass = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? " — " + extra : ""}`);
  }
};

/** A mock req/res in api/*'s handler shape, same idiom as
 *  evals/multimodal/fixtures.mjs's `mockReqRes`. */
function mockReqRes(body) {
  const res = {
    statusCode: 0,
    body: null,
    setHeader() {},
    status(c) {
      res.statusCode = c;
      return res;
    },
    json(b) {
      res.body = b;
      return res;
    },
    end() {
      return res;
    },
  };
  return { req: { method: "POST", headers: {}, socket: {}, body }, res };
}

async function recall(dyad, query) {
  const { req, res } = mockReqRes({ op: "recall", device: dyad.deviceId, query });
  await handler(req, res);
  if (res.statusCode !== 200) throw new Error(`recall returned ${res.statusCode}: ${JSON.stringify(res.body)}`);
  return String(res.body?.memories ?? "");
}

// ═════════════════════════════════════════════════════════════════════════
// SCORING
// ═════════════════════════════════════════════════════════════════════════
//
// RETRIEVED = the set of fixture row keys whose key text appears in the
// rendered memories block. The row key is the row's `name` for a node or a
// fact, and a distinctive fragment of the claim for a visual row. Matching on
// the RENDERED STRING rather than on an internal row list is deliberate: what
// reaches the model is the string, and a row that is fetched and then dropped
// by the T5 budget has not been recalled by any definition that matters.
//
// precision = |retrieved ∩ expected| / |retrieved|
// recall    = |retrieved ∩ expected| / |expected|
//
// For a question with no expected rows (the forget and absent classes)
// precision and recall are undefined and the question is scored as a BOOLEAN
// instead: correct iff nothing forbidden appears. Those are reported in their
// own rows of the table and never averaged into the others — a forget case
// folded into a precision mean is a forget case nobody can see.

// ── THE ANSWER / BACKGROUND SPLIT, and why precision is measured on one ──
//
// opRecall renders labelled blocks and the labels carry meaning that a flat
// string match would throw away. STANDING BACKGROUND is CONTINUITY — the big
// standing things about a person, deliberately present on every turn whatever
// was asked, and api/memory.js says so in its own words ("it is continuity,
// not an answer to this turn"). Counting those five or six rows as retrievals
// would put precision at ~0.12 for a perfect answer and would make the number
// a measure of how many standing facts the person has.
//
// So: RECALL and PRECISION are computed over the ANSWER blocks, and whether an
// expected row ALSO appeared in background is reported separately. It is not
// nothing — a row reached only by background was not retrieved by the query,
// it was already going to be there — so the table carries that column too.
const ANSWER_HEADINGS = [
  "GAMES AND THINGS YOU TWO ACTUALLY DID",
  "THINGS YOU TWO LOOKED AT TOGETHER",
  "RELEVANT TO WHAT THEY JUST SAID:",
  "ALSO RELEVANT",
  "FROM THE SAME CONVERSATION",
  "THINGS YOU NOTICED THEM SAY",
];
const BACKGROUND_HEADING = "STANDING BACKGROUND";
const ALL_HEADINGS = [...ANSWER_HEADINGS, BACKGROUND_HEADING];

/** Partitions a rendered memories string into { answer, background }. Blocks
 *  are joined with "\n" and each begins with one of the headings above, so the
 *  split is on heading-initial lines and never on content. */
function splitBlocks(memories) {
  const lines = String(memories).split("\n");
  let current = null;
  const out = { answer: [], background: [] };
  for (const line of lines) {
    const heading = ALL_HEADINGS.find((h) => line.startsWith(h));
    if (heading) current = heading === BACKGROUND_HEADING ? "background" : "answer";
    if (current) out[current].push(line);
  }
  return { answer: out.answer.join("\n"), background: out.background.join("\n") };
}

/** The key a row RENDERS as. Not always its `name`: an `activity:` fact is
 *  rendered as its BODY alone (`- ${f.body} (${age})`), while every other fact
 *  renders name-first. A benchmark that matched on `name` for both would score
 *  every activity question as a miss and call it a recall failure. */
function keysOf(dyad) {
  return [
    ...dyad.nodes.map((n) => n.name),
    ...(dyad.facts || []).map((f) => (String(f.name).startsWith("activity:") ? f.body : f.name)),
    ...(dyad.moments || []).map((m) => m.claim),
    ...(dyad.photos || []).map((p) => p.claim),
  ];
}

function retrievedFrom(memories, keys) {
  const hay = memories.toLowerCase();
  return keys.filter((k) => hay.includes(String(k).toLowerCase()));
}

const CLASSES = ["single-hop", "multi-hop", "temporal", "old-fact", "activity", "watch", "contradiction", "forget", "absent"];
const BOOLEAN_CLASSES = new Set(["forget", "absent"]);

const perClass = new Map();
const bump = (cls, patch) => {
  const c = perClass.get(cls) || { n: 0, p: 0, r: 0, bg: 0, hit: 0, miss: [] };
  c.n++;
  if (patch.p !== undefined) c.p += patch.p;
  if (patch.r !== undefined) c.r += patch.r;
  if (patch.bg !== undefined) c.bg += patch.bg;
  if (patch.hit) c.hit++;
  if (patch.miss) c.miss.push(patch.miss);
  perClass.set(cls, c);
};

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§1 the fixtures themselves (a benchmark's fixtures are part of the gate)");
// ═════════════════════════════════════════════════════════════════════════
for (const d of DYADS) {
  ok(`[${d.id}] has 60+ turns of conversation (${d.turns.length})`, d.turns.length >= 60, String(d.turns.length));
  ok(`[${d.id}] has 15+ ground-truth questions (${d.questions.length})`, d.questions.length >= 15, String(d.questions.length));
  ok(`[${d.id}] every question declares a known class`, d.questions.every((q) => CLASSES.includes(q.cls)), d.questions.filter((q) => !CLASSES.includes(q.cls)).map((q) => `${q.id}:${q.cls}`).join(", "));
  ok(`[${d.id}] every expected row exists in the store`, d.questions.every((q) => (q.expect || []).every((e) => keysOf(d).some((k) => String(k).toLowerCase().includes(String(e).toLowerCase())))), "an expected answer names a row the fixture does not contain");
  ok(`[${d.id}] carries at least one temporal and one forget/absent question`, d.questions.some((q) => q.cls === "temporal" || q.cls === "old-fact") && d.questions.some((q) => BOOLEAN_CLASSES.has(q.cls)));
  // The FORGET cases must be truthful about themselves: a forbidden name that
  // is still in the store is a fixture claiming a delete that did not happen,
  // and the question would then pass for the wrong reason.
  //
  // The ABSENT cases are the opposite by design — their forbidden rows ARE in
  // the store, because the claim under test is "this real row is not offered
  // as the ANSWER to a question it does not answer". So the check is scoped to
  // forget, deliberately, rather than applied to both and then relaxed.
  const leaked = d.questions.filter((q) => q.cls === "forget" && (q.forbid || []).some((f) => keysOf(d).some((k) => String(k).toLowerCase().includes(f.toLowerCase()))));
  ok(`[${d.id}] no forget-case name is still present in the store`, leaked.length === 0, leaked.map((q) => q.id).join(", "));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§2 the sweep — every question through the REAL opRecall");
// ═════════════════════════════════════════════════════════════════════════
const rows = [];
for (const d of DYADS) {
  loadFixture(d);
  const keys = keysOf(d);
  for (const question of d.questions) {
    let memories = "";
    let threw = null;
    try {
      memories = await recall(d, question.q);
    } catch (e) {
      threw = String(e?.message || e);
    }
    ok(`[${question.id}] recall completed`, threw === null, threw || "");
    const { answer, background } = splitBlocks(memories);
    const retrieved = retrievedFrom(answer, keys);
    const expected = question.expect || [];

    // WHERE a forbidden row may not appear differs by class, and the
    // difference is the product's own design rather than a convenience:
    //   forget  — the row was DELETED. It may not appear ANYWHERE, by any
    //             leg, including through a neighbour's edge rendering.
    //   absent  — the row EXISTS and is simply not the answer. Standing
    //             background carries it on every turn by design ("continuity,
    //             not an answer to this turn"), so the assertion is that it
    //             is not offered AS AN ANSWER.
    const forbidScope = question.cls === "forget" ? memories : answer;
    const forbidden = (question.forbid || []).filter((f) => forbidScope.toLowerCase().includes(f.toLowerCase()));

    if (BOOLEAN_CLASSES.has(question.cls)) {
      const correct = forbidden.length === 0;
      bump(question.cls, { hit: correct, miss: correct ? null : `${question.id}: leaked ${forbidden.join(", ")}` });
      rows.push({ id: question.id, cls: question.cls, p: null, r: null, correct, memories });
      ok(`[${question.id}] nothing forbidden returned`, correct, forbidden.join(", "));
      continue;
    }

    const hits = expected.filter((e) => retrieved.some((k) => String(k).toLowerCase().includes(String(e).toLowerCase())));
    const bgOnly = expected.filter((e) => !hits.includes(e) && background.toLowerCase().includes(String(e).toLowerCase()));
    const p = retrieved.length ? hits.length / retrieved.length : 0;
    const r = expected.length ? hits.length / expected.length : 0;
    bump(question.cls, {
      p,
      r,
      bg: bgOnly.length,
      hit: r === 1,
      miss: r === 1 ? null : `${question.id}: missed ${expected.filter((e) => !hits.includes(e)).join(", ")}${bgOnly.length ? ` (${bgOnly.length} reached background only)` : ""}`,
    });
    rows.push({ id: question.id, cls: question.cls, p, r, correct: r === 1, memories });
    ok(`[${question.id}] nothing forbidden returned`, forbidden.length === 0, forbidden.join(", "));
  }

  // THE UNROUTED-QUERY RULE (store.mjs's header): a statement the router did
  // not recognise returned [] and would look exactly like an empty store.
  const un = unroutedQueries();
  ok(`[${d.id}] every SQL statement was routed or declared empty`, un.length === 0, un.slice(0, 2).join(" || "));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3 the specific behaviours the classes are named for");
// ═════════════════════════════════════════════════════════════════════════
{
  loadFixture(DYADS[0]);
  // ── TEMPORAL: the hedge, in BOTH directions ────────────────────────────
  //
  // WHAT THIS ASSERTION USED TO SAY, AND WHY IT WAS WRONG. It read "a
  // past-dated plan carries the stale hedge" and passed on dyad-a's December
  // wedding — recalled in AUGUST of the same year, i.e. four months BEFORE it
  // happens. It passed because `staleNote` keyed on ROW AGE, so a row written
  // in March was hedged as already-past whatever its own date said. The
  // benchmark had the defect it went on to discover baked into its own
  // expectation: the hedge fired, so the assertion was green, and the thing
  // being asserted was the bug.
  //
  // That is the shape `gates-that-live-nowhere` warns about from the other
  // side — not a gate that runs nothing, but a gate that pins the wrong
  // behaviour and would have failed the fix. Bi-temporal fact edges
  // (ROADMAP-100X item 4, migration 056) close it, so the expectation flips
  // and the OTHER direction becomes an assertion rather than an assumption.
  //
  // The hedge is the difference between "shaadi december me hai" and "us
  // december wali shaadi ho gayi na?", and getting it backwards is worse than
  // not hedging at all: she congratulates someone on a wedding that has not
  // happened, fluently, with nothing in the output marking it as wrong.
  const ahead = await recall(DYADS[0], "meghna ki shaadi kab hai");
  ok(
    "[A-10] a plan whose own date is still AHEAD is NOT hedged as past",
    !ahead.includes("already happened"),
    ahead.slice(0, 260),
  );
  // The row-age FALLBACK, still live and still gated: `case presentation` is
  // four months old, kind `event`, and carries no date any parser can resolve.
  // Absent validity must behave exactly as it did before 056 — that property
  // is what lets the migration land with no backfill, and it is silent when it
  // breaks.
  loadFixture(DYADS[1]);
  const fallback = await recall(DYADS[1], "case presentation wala kya hua tha");
  ok(
    "[A-10b] an OLD, UNDATED, time-shaped row still gets the row-age hedge",
    fallback.includes("already happened"),
    fallback.slice(0, 260),
  );
  loadFixture(DYADS[0]);
  // PROVENANCE: the age travels with the row, or "kab bataya tha maine" is
  // unanswerable from a row the function already had in hand (P1-6).
  const prov = await recall(DYADS[0], "kab bataya tha maine zenith ke baare me");
  ok("[A-11] the row arrives with an age on it", /\b(days?|weeks?|months?|ago|abhi)\b/i.test(prov), prov.slice(0, 200));
  // ACTIVITY: the block is FIRST in the render, and that position is the drop
  // policy rather than an opinion — api/chat.js keeps the first n characters.
  const act = await recall(DYADS[0], "chess me kya hua tha");
  ok("[A-12] the activity block is present and first", act.startsWith("GAMES AND THINGS YOU TWO ACTUALLY DID"), act.slice(0, 80));
  ok("[A-12] the activity block carries its no-inventing fence", act.includes("never add a move"));
  // WATCH: the visual claim must arrive WITH its hedge, never as a thing she saw.
  const watch = await recall(DYADS[0], "us din jo trailer dekha tha");
  ok("[A-13] a visual claim is hedged as a machine's guess", watch.includes("machine's guess") || watch.includes("model's read"), watch.slice(0, 240));
}
{
  loadFixture(DYADS[2]);
  // THE RESERVED SLOT: a thirteen-month-old, high-salience row that no
  // ranking can reach. If this ever fails, the reserved slot is dead.
  const old = await recall(DYADS[2], "aaj kaisa din tha");
  ok(
    "[C-3] the reserved slot surfaces an old high-salience row with no query words",
    old.toLowerCase().includes("ammi diabetes") || old.toLowerCase().includes("twenty years"),
    old.slice(0, 300),
  );
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3b KNOWN RETRIEVAL GAPS — measured, deliberately NOT gated");
// ═════════════════════════════════════════════════════════════════════════
//
// Same posture as evals/forget/a4.mjs, and for its reason: a gate that fails
// on a known-unfixed thing is noise, and noise is how a suite stops being
// read. These are real queries whose answer is in the store and does not come
// back, with the mechanism named. They are printed every run so the number is
// visible, and they fail nothing.
{
  const GAPS = [
    {
      dyad: DYADS[0],
      q: "kya khela tha humne",
      want: "chess together on 10 aug",
      why: "tokenises to [khela, humne]; the activity leg's word match is over an ENGLISH body, and the no-words fallback does not fire because there ARE words. A Hinglish-only question about a game reaches nothing.",
    },
    {
      dyad: DYADS[1],
      q: "wo naya wala test kab hai",
      want: "neet pg",
      why: "no shared surface word with the stored row; this is precisely what the semantic leg exists for, and the semantic leg is off in this harness (stubs/embed.mjs).",
    },
  ];
  for (const g of GAPS) {
    loadFixture(g.dyad);
    const memories = await recall(g.dyad, g.q);
    const { answer } = splitBlocks(memories);
    const found = answer.toLowerCase().includes(g.want.toLowerCase());
    console.log(`  [${g.dyad.id}] ${JSON.stringify(g.q)} -> ${found ? "FOUND (gap closed — update this list)" : "not found"}`);
    console.log(`      wanted: ${JSON.stringify(g.want)}`);
    console.log(`      why:    ${g.why}`);
  }

  // ── A DEFECT THIS BENCHMARK FOUND ON ITS FIRST RUN — NOW CLOSED ───────
  //
  // WHAT IT WAS. `staleNote` in api/memory.js hedges a plan with "whatever was
  // ahead in this has already happened" when the ROW is more than 45 days old
  // and its kind is plan/event or its summary looks time-bound. It keyed on
  // the AGE OF THE ROW, never on the date INSIDE the fact — so a plan told 67
  // days ago about something still two months in the FUTURE was handed to her
  // pre-hedged as past. dyad-b's `neet pg` (a November exam, recorded in June)
  // is that case exactly, and it is the fixture the finding was filed against.
  //
  // WHAT CLOSED IT. WS-O, ROADMAP-100X item 4: bi-temporal fact edges. The
  // fact now carries its own `valid_from`/`valid_to` (migration 056), derived
  // at write time from timeline.ts's date table, and `staleNote` asks the
  // horizon before it counts days. Row age is KEPT as the fallback for rows
  // with no derivable date, which is most rows and every row written before
  // 056 — so absence behaves exactly as before, which is what let the fix land
  // without a backfill.
  //
  // It is now a GATE, in both directions, and it is asserted in §3 ([A-10] the
  // ahead case, [A-10b] the row-age fallback) rather than printed here. This
  // block stays as the ASSERTION THAT THE FIX IS STILL IN, because the failure
  // mode is silent: she asks how an exam went, in August, in a fluent sentence
  // that nothing about the output marks as wrong.
  {
    loadFixture(DYADS[1]);
    const fresh = await recall(DYADS[1], "exam kab hai");
    const hedged = fresh.includes("already happened");
    ok(
      "[B-12b] `stale-note-keys-on-row-age` stays closed — a November exam is not past in August",
      !hedged,
      fresh.slice(0, 260),
    );
    console.log(
      `\n  CLOSED (was: DEFECT, reported not gated): a FUTURE plan recorded 67 days ago is ${hedged ? "STILL hedged as already-past — THE FIX IS GONE" : "no longer hedged as already-past"}` +
        `\n      staleNote now asks the fact's own valid_to (migration 056) and falls back to row age only when there is none.` +
        `\n      ROADMAP-100X item 4, shipped by WS-O; gated in §3 [A-10]/[A-10b] and by evals/run.mjs validity.`,
    );
  }

  // ── A SECOND DEFECT THIS BENCHMARK SURFACED, in the parser ────────────
  //
  // Wiring `resolveWhen` into a stored `valid_to` made a latent bug in it
  // visible for the first time. Its month pattern ended each abbreviation with
  // `[a-z]*` — the three-letter prefix plus anything — so it matched the
  // prefix INSIDE A LONGER WORD: married→March, marks→March, decade→December,
  // junior→June, novel→November, janta→January. dyad-a's row "younger sister,
  // getting married in nashik in december" resolved on "married" and landed in
  // MARCH, five months behind the December it says.
  //
  // Invisible while `resolveWhen` had one consumer (hisClock, whose output is
  // a coarse label a reader would forgive); load-bearing the moment the same
  // answer became the timestamp that decides tense. Fixed in timeline.ts (the
  // alternation now admits only real completions of each month name and closes
  // with `\b`); the assertion lives here because this fixture is the evidence.
  {
    loadFixture(DYADS[0]);
    const m = await recall(DYADS[0], "meghna ki shaadi kab hai");
    ok(
      "[A-14] a december wedding is not parsed as march by a month-prefix match",
      !m.includes("already happened"),
      m.slice(0, 260),
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3c THE SURFACE SWITCH — the same person, a different device (WS-O)");
// ═════════════════════════════════════════════════════════════════════════
//
// ── THE LAW, AS THE PRODUCT ALREADY STATES IT ──────────────────────────
// `api/_surface.js`'s own header: "A surface is a TRANSPORT... The same human
// on Telegram and on the web is the same relationship, so identity resolution
// here is AGENT-INDEPENDENT and memory is never keyed by surface. Anything
// that keys memory by surface reintroduces the amnesia the relational layer
// exists to delete."
//
// ── WHAT THE ENGINE ACTUALLY DOES ───────────────────────────────────────
// Identity IS shared: `vy_surface_identity` maps (surface, surface_user_id) to
// ONE person_id, with no agent and no surface in the key. But `_room.js`'s
// `bindSurfaceDmDevice` mints a device per surface (`surfaceDmDeviceId(surface,
// surfaceUserId)`), and opRecall's two largest legs — the keyword MATCHED leg
// and the STANDING BACKGROUND leg — read `meera_nodes ... where device_id =
// $1`, as do `meera_edges` and the neighbour-name resolution. The vy_ store
// (facts, activities, watch moments, rel/self bundles) is person-keyed and
// follows the person.
//
// So a person who says something on the web app and then opens WhatsApp keeps
// half of her memory and loses the other half, silently, with no error and a
// 200 on every call.
//
// ── HOW THIS IS MEASURED ────────────────────────────────────────────────
// The identical 50 questions, over the identical fixture rows, from a device
// the fixture's person also owns — which is what `personIdFor` returns for
// both, because the mock resolves any device to the fixture's person exactly
// as `vy_surface_identity` would. The only variable is the device_id bound
// into the legacy-lane statements. Nothing about the store changes.
//
// REPORTED, NOT GATED, and the reason is the one §3b gives: the fix is a
// coordinated change to recall AND to the legacy forget lane, and half of it
// is a consent regression (see the note under the table).
{
  let threw = null;
  const arm = async (crossOn) => {
    setCrossSurface(crossOn);
    const home = [];
    const away = [];
    for (const d of DYADS) {
      loadFixture(d);
      const keys = keysOf(d);
      // A DIFFERENT, VALID uuid. It must be valid: `opRecall` 400s on a
      // malformed device before it reads anything, and a 400 would look exactly
      // like total recall loss — which is the number this section reports, so
      // getting it by accident would be the worst available outcome. [SS-3]
      // asserts both calls actually returned a prompt.
      const suffix = DYADS.indexOf(d).toString(16).repeat(12).slice(0, 12);
      const other = { ...d, deviceId: `ffffffff-9999-4999-8999-${suffix}` };
      for (const question of d.questions) {
        const expected = question.expect || [];
        if (!expected.length) continue; // forget/absent are boolean, not recall
        const h = await recall(d, question.q).catch((e) => `THREW ${e.message}`);
        const a = await recall(other, question.q).catch((e) => `THREW ${e.message}`);
        threw = threw || (h.startsWith("THREW") ? h : a.startsWith("THREW") ? a : null);
        const hit = (str) => retrievedFrom(str, keys).filter((k) => expected.includes(k)).length / expected.length;
        home.push(hit(h));
        away.push(hit(a));
      }
    }
    return { home, away };
  };
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  // The PRE-FIX arm first: the leg's two statements throw, exactly as a SQL
  // error would, so `api/memory.js`'s catch drops the whole contribution.
  const off = await arm(false);
  const on = await arm(true);
  setCrossSurface(true);
  const pct = (x, y) => (x > 0 ? (((x - y) / x) * 100).toFixed(1) : "0.0");
  console.log(
    `  n = ${on.home.length} recall questions (the scorable ones, across all three dyads)` +
      `\n` +
      `\n                                   | same device | after a surface switch | loss` +
      `\n  --------------------------------+-------------+------------------------+------` +
      `\n  surface-switch leg OFF (pre-fix) |    ${mean(off.home).toFixed(3)}    |         ${mean(off.away).toFixed(3)}          | ${pct(mean(off.home), mean(off.away))}%` +
      `\n  surface-switch leg ON            |    ${mean(on.home).toFixed(3)}    |         ${mean(on.away).toFixed(3)}          | ${pct(mean(on.home), mean(on.away))}%` +
      `\n` +
      `\n  What survived the switch WITHOUT the leg: the vy_ store only — facts,` +
      `\n    activities, watch moments, and the rel/self bundles. All person-keyed.` +
      `\n  What was lost: meera_nodes (the MATCHED and STANDING BACKGROUND legs),` +
      `\n    meera_edges, and the neighbour-name resolution. All device-keyed.` +
      `\n` +
      `\n  THE RESIDUAL is real and is not a rounding error. \`meera_edges\` is still` +
      `\n  device-keyed and the leg does not import relations, so a multi-hop question` +
      `\n  answered through an edge on the home device is still answered without it` +
      `\n  after a switch; and the leg is capped at 6 rows where the two home legs` +
      `\n  together return up to 14. Both are deliberate: relations between two` +
      `\n  imported rows would need a second import and a second dedup, and a cap` +
      `\n  bigger than the home legs would let another surface's memory outweigh this` +
      `\n  one\'s. Named here so the number is not mistaken for "fixed".`,
  );
  // GATES ON THE MEASUREMENT ITSELF, not on the defect.
  ok("[SS-1] the pre-fix arm really loses most of recall (the defect is real)", mean(off.home) - mean(off.away) > 0.5, `${mean(off.home).toFixed(3)} -> ${mean(off.away).toFixed(3)}`);
  ok("[SS-2] the leg restores most of it (the fix works)", mean(on.away) > mean(off.away) + 0.4, `${mean(off.away).toFixed(3)} -> ${mean(on.away).toFixed(3)}`);
  // THE BYTE-IDENTITY PROPERTY, from this leg's own side: on the device the
  // rows live on, a person with no other devices must recall EXACTLY what they
  // recalled before the leg existed. If this ever fails, the leg is not
  // absent-by-default and every existing fixture is at risk.
  ok("[SS-4] on the home device the leg changes NOTHING", Math.abs(mean(on.home) - mean(off.home)) < 1e-9, `${mean(off.home).toFixed(6)} vs ${mean(on.home).toFixed(6)}`);
  // THE FAIL-SAFE DEGRADE PATH, proved rather than asserted: the OFF arm above
  // IS the leg failing the way a SQL error would, and the home column is
  // unchanged in it. A feature that takes the product down with it when it
  // breaks is not additive.
  ok("[SS-5] when the leg fails, home recall is untouched (fail-safe degrade)", Math.abs(mean(off.home) - mean(on.home)) < 1e-9);

  // ── THE CONSENT HALF, which decides whether this leg may exist at all ──
  //
  // `opRecall` has NO read-side forget suppression: forget is a hard DELETE and
  // the legacy lane's delete is device-scoped. So an imported row is the one
  // place in this function where a thing the person asked her to forget could
  // come back — on the very device where they asked. The leg reads the forget
  // terms across ALL of the person's devices and filters imported rows through
  // them, and the two reads are ATOMIC: no terms, no rows.
  //
  // Both halves are tested. A suppression test with no positive control passes
  // on a leg that imports nothing.
  {
    setCrossSurface(true);
    const d = DYADS[0];
    const suffix = "0".repeat(12);
    const other = { ...d, deviceId: `ffffffff-9999-4999-8999-${suffix}` };

    loadFixture(d);
    const beforeForget = await recall(other, "meghna ki shaadi kab hai").catch(() => "");
    ok("[SS-6] positive control: the row DOES import across the switch", beforeForget.toLowerCase().includes("meghna"), beforeForget.slice(0, 160));

    loadFixture({ ...d, forgetTerms: ["meghna"] });
    const afterForget = await recall(other, "meghna ki shaadi kab hai").catch(() => "");
    ok("[SS-7] a forget term on ANY of the person's devices suppresses the imported row", !afterForget.toLowerCase().includes("meghna"), afterForget.slice(0, 240));

    loadFixture(d);
  }
  ok("[SS-3] neither the home nor the away call errored — the loss is retrieval, not a rejected request", threw === null, String(threw));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4 the scores");
// ═════════════════════════════════════════════════════════════════════════
console.log("  n dyads: 3   n questions: " + rows.length + "   method: real opRecall over authored graph rows, DB mocked at api/_db.js");
console.log("  NOT exercised: the LLM extractor, the semantic/halfvec leg, forget's DELETEs, latency, tokens/query. See §0.\n");
console.log("  precision/recall are over the ANSWER blocks; STANDING BACKGROUND is continuity, not an answer (see the split above).\n");
console.log("  class          |  n | precision |  recall | perfect | bg-only");
console.log("  ---------------+----+-----------+---------+---------+--------");
for (const cls of CLASSES) {
  const c = perClass.get(cls);
  if (!c) continue;
  const boolean = BOOLEAN_CLASSES.has(cls);
  console.log(
    `  ${cls.padEnd(14)} | ${String(c.n).padStart(2)} | ` +
      `${boolean ? "     n/a " : (c.p / c.n).toFixed(3).padStart(9)} | ` +
      `${boolean ? "    n/a " : (c.r / c.n).toFixed(3).padStart(7)} | ${String(c.hit).padStart(2)}/${String(c.n).padEnd(4)} | ` +
      `${boolean ? "    n/a" : String(c.bg).padStart(7)}`,
  );
}
{
  const scored = [...perClass.entries()].filter(([cls]) => !BOOLEAN_CLASSES.has(cls));
  const n = scored.reduce((s, [, c]) => s + c.n, 0);
  const p = scored.reduce((s, [, c]) => s + c.p, 0) / n;
  const r = scored.reduce((s, [, c]) => s + c.r, 0) / n;
  console.log(`  ${"OVERALL".padEnd(14)} | ${String(n).padStart(2)} | ${p.toFixed(3).padStart(9)} | ${r.toFixed(3).padStart(7)} |`);
  const misses = [...perClass.values()].flatMap((c) => c.miss);
  if (misses.length) {
    console.log("\n  misses:");
    for (const m of misses) console.log(`    ${m}`);
  }
  console.log("\n  routed statements: " + JSON.stringify(routeCounts()));

  // THE GATE. This suite is a gate and not a report, so it has a floor — but
  // the floor is a RATCHET on the harness's own health, not a quality claim
  // about the product. It is deliberately set where it is: every question in
  // these fixtures is answerable from rows that are in the store, by legs that
  // are running, so anything below this means the HARNESS or the RETRIEVAL
  // PATH broke, not that memory is merely imperfect. Raise it when a real
  // keyed run establishes what the product actually scores.
  const FLOOR_RECALL = 0.9;
  ok(`overall recall ${r.toFixed(3)} >= harness floor ${FLOOR_RECALL}`, r >= FLOOR_RECALL, "a drop here means a leg went dark, not that memory is imperfect");
  const boolClasses = [...perClass.entries()].filter(([cls]) => BOOLEAN_CLASSES.has(cls));
  const boolTotal = boolClasses.reduce((s, [, c]) => s + c.n, 0);
  const boolHit = boolClasses.reduce((s, [, c]) => s + c.hit, 0);
  ok(`every forget/absent case is clean (${boolHit}/${boolTotal})`, boolHit === boolTotal);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§5 what does NOT get written to measurements.md");
// ═════════════════════════════════════════════════════════════════════════
console.log(
  [
    "  These numbers are NOT appended to context/measurements.md by this run, and",
    "  the entry that file carries for this benchmark is a COMMENTED TEMPLATE with",
    "  no numbers in it. The reason is the same one CLAUDE.md gives for everything",
    "  else in that file: a measurement needs n, METHOD and date, and this method",
    "  does not include the extractor or the semantic leg. Writing a recall figure",
    "  here would create exactly the false comparison a future keyed run would then",
    "  be measured against. The first real numbers come from a keyed session that",
    "  runs the extractor over these same 190 turns and re-runs this sweep against",
    "  what IT produced — at which point the template gets filled in and this",
    "  paragraph gets replaced by a delta.",
  ].join("\n"),
);

console.log(`\n${fail === 0 ? "ALL PASS" : fail + " FAILED"} (${pass} assertions, ${rows.length} questions across ${DYADS.length} dyads)`);
process.exit(fail === 0 ? 0 : 1);
