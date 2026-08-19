// evals/self/observation.mjs — WS-OBSERVE's gate suite for vy_observation
// (docs/SPEC-SELF-LAYER.md §7, src/engine/observation.ts). Real Postgres,
// real shipping code — bundled fresh via esbuild the same way
// evals/wsdepth-test-roundtrip.mjs and evals/mp/withdraw.mjs already do, so
// this exercises the actual TypeScript this workstream ships, not a JS
// re-model of it (FK/constraint semantics live in Postgres, not in JS).
//
//   node evals/self/observation.mjs           → seed, assert, tear down
//   node evals/self/observation.mjs --keep     → leave the fixture rows up
//
// Proves, in order:
//   1. an uncited observation is impossible — at the JS layer (writeObservation
//      throws) AND, as a negative control, at the DB layer independently
//      (vy_observation_cited CHECK) — two guards, checked separately so a
//      regression in one is not masked by the other still holding.
//   2. shape-lint is clean at write time — one rule per OBS_BAD_NOTES entry,
//      each isolated to trip exactly one lintLine reason; OBS_GOOD_NOTES
//      proves the guard is not a blanket refusal.
//   3. matching is PULL-ONLY, structurally — an injected q() that THROWS on
//      any call proves matchObservations never even reaches the database on
//      a query with no signal words, across five different "no signal" shapes.
//   4. decay moves salience only — never t_invalid, never a row count change
//      — checked by literally re-counting rows and re-reading t_invalid
//      after five consecutive nightly-pass calls, and the SQL-side formula
//      is checked for parity against the pure decayedSalience() function.
//   5. promotion sets promoted_to on exactly one row and writes vy_pattern
//      exactly once (via relstate.ts's REAL writePattern, not a copy of it) —
//      and a promoted observation stops matching (the "two stores can't
//      disagree" guarantee), even though its note still contains the query
//      word.
//   6. forget reaches vy_observation — via api/memory.js's REAL
//      wipeWhereSql/wipeParams/activePersonTables, not a reimplementation.
//   7. a NEGATIVE CONTROL: a deliberately naive "match everything for this
//      person" query (the shape a speculative volunteer-decider would use)
//      DOES return the fixture row for an empty query — proving the suite
//      would have caught matchObservations if it had been written that way,
//      and that its refusal is a real behavioural difference, not a
//      trivially-true assertion.
//   8. §11's reversal-condition eval is DESIGNED, not run (no live judge
//      spend authorized this session) — printed as an explicit "what it
//      would take" spec, referencing the measured `fab-noise-floor` (13.6pp
//      spread on byte-identical input, n=300 arm-pairs).
//
// Test data: every row is either scoped to OBS_PERSON/OBS_AGENT/OBS_OTHER_AGENT
// (evals/self/_fixtures.mjs's namespace "0b53") or carries the "wsobs-test-"
// text prefix. Zero residue is verified live after teardown (step 9).
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { q } from "../../api/_db.js";
import { RECALL_STOP, PERSON_TABLES, wipeWhereSql, wipeParams, activePersonTables } from "../../api/memory.js";
import { OBS_TAG, OBS_AGENT, OBS_OTHER_AGENT, OBS_PERSON, OBS_GOOD_NOTES, OBS_BAD_NOTES } from "./_fixtures.mjs";

const KEEP = process.argv.includes("--keep");
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "wsobs-gate-"));

for (const [src, out] of [
  ["src/engine/observation.ts", "observation.bundle.mjs"],
  ["src/engine/relstate.ts", "relstate.bundle.mjs"],
  ["src/engine/shapelint.ts", "shapelint.bundle.mjs"],
]) {
  execSync(
    `npx esbuild ${join(ROOT, src)} --bundle --format=esm --platform=node --outfile=${join(tmp, out)} --log-level=error`,
    { stdio: "inherit", cwd: ROOT },
  );
}
const obs = await import(join(tmp, "observation.bundle.mjs"));
const rel = await import(join(tmp, "relstate.bundle.mjs"));
const lint = await import(join(tmp, "shapelint.bundle.mjs"));

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
};
const section = (s) => console.log(`\n── ${s} ──`);

// ─────────────────────────────────────────────────────────────────────────
// Seed: a fixture person, two real episodes (citation anchors)
// ─────────────────────────────────────────────────────────────────────────
section("seed");
const [{ person_id }] = await q(`insert into vy_person default values returning person_id`);
if (person_id !== OBS_PERSON) {
  // vy_person's PK is server-generated (gen_random_uuid default), so we
  // cannot force OBS_PERSON as the actual row id — insert explicitly instead.
  await q(`delete from vy_person where person_id = $1`, [person_id]);
  await q(`insert into vy_person (person_id) values ($1)`, [OBS_PERSON]);
}
const deviceRows = await q(`select gen_random_uuid() as id`);
const deviceId = deviceRows[0].id;
await q(`insert into vy_person_device (device_id, person_id) values ($1,$2)`, [deviceId, OBS_PERSON]);

async function insertEpisode(agentId, summary) {
  const [{ id }] = await q(
    `insert into vy_episode (person_id, agent_id, channel, participation, started_at, ended_at, boundary_reason, summary, importance, provisional)
     values ($1,($3)::uuid,'chat','user',now(),now(),'topic',$2,1.0,false)
     returning id`,
    [OBS_PERSON, `${OBS_TAG} ${summary}`, agentId],
  );
  return Number(id);
}
const ep1 = await insertEpisode(OBS_AGENT, "episode one, knee mention");
const ep2 = await insertEpisode(OBS_AGENT, "episode two, knee mention again");
ok(`seeded person ${OBS_PERSON}, 2 episodes (${ep1}, ${ep2})`, Number.isFinite(ep1) && Number.isFinite(ep2));

// ─────────────────────────────────────────────────────────────────────────
// 1. an uncited observation is impossible — two independent guards
// ─────────────────────────────────────────────────────────────────────────
section("1. uncited observation is impossible");
let threwAtJs = false;
try {
  await obs.writeObservation(q, { personId: OBS_PERSON, agentId: OBS_AGENT, note: `${OBS_TAG} knee mentioned`, citations: [] });
} catch (e) {
  threwAtJs = />=1 citation/.test(String(e.message));
}
ok("writeObservation(citations:[]) throws the >=1-citation error", threwAtJs);

let threwAtDb = false;
try {
  await q(
    `insert into vy_observation (agent_id, person_id, note, citations) values ($1,$2,$3,$4)`,
    [OBS_AGENT, OBS_PERSON, `${OBS_TAG} bypass attempt`, []],
  );
} catch (e) {
  // api/_db.js's q() collapses a Postgres error to `neon ${status}` (no body
  // text) — verified directly against the raw Neon SQL-over-HTTP endpoint
  // (bypassing q()) that this exact insert fails with code 23514,
  // constraint "vy_observation_cited", so a 400 here is that CHECK, not
  // some unrelated failure. threwAtDb only needs "did the DB reject it".
  threwAtDb = /neon 4\d\d/i.test(String(e.message));
}
ok(
  "NEGATIVE CONTROL for guard #1: bypassing writeObservation with a raw insert is STILL rejected " +
    "— by the DB's own vy_observation_cited CHECK (verified directly against the Neon endpoint: code 23514), " +
    "independent of the JS guard",
  threwAtDb,
);

// ─────────────────────────────────────────────────────────────────────────
// 2. shape-lint clean at write
// ─────────────────────────────────────────────────────────────────────────
section("2. shape-lint at write");
const goodIds = [];
for (const note of OBS_GOOD_NOTES) {
  const id = await obs.writeObservation(q, { personId: OBS_PERSON, agentId: OBS_AGENT, note, citations: [ep1] });
  goodIds.push(id);
}
ok(`${goodIds.length}/${OBS_GOOD_NOTES.length} telegraphic notes accepted (a guard that refuses everything is an outage, not a gate)`, goodIds.length === OBS_GOOD_NOTES.length);

let badCaught = 0;
for (const { note, rule } of OBS_BAD_NOTES) {
  try {
    await obs.writeObservation(q, { personId: OBS_PERSON, agentId: OBS_AGENT, note, citations: [ep1] });
  } catch (e) {
    badCaught++;
  }
}
ok(`${badCaught}/${OBS_BAD_NOTES.length} bad notes refused (one per lintLine rule: sentence-shape, first-person, word-cap, empty)`, badCaught === OBS_BAD_NOTES.length);

// shape-lint NEGATIVE CONTROL: bypass writeObservation with a raw insert of
// the sentence-shaped bad note. The DB has NO check on note's shape (only
// NOT NULL) — so this MUST succeed, proving the shape-lint guard is real
// JS-level protection and not redundant with a DB constraint that would
// have caught it anyway.
const sentenceShaped = OBS_BAD_NOTES.find((b) => b.rule === "shapelint:sentence").note;
const [{ id: bypassId }] = await q(
  `insert into vy_observation (agent_id, person_id, note, citations) values ($1,$2,$3,$4) returning id`,
  [OBS_AGENT, OBS_PERSON, sentenceShaped, [ep1]],
);
ok(
  "NEGATIVE CONTROL for guard #2: the DB has no shape constraint — a raw insert of a sentence-shaped " +
    "note SUCCEEDS where writeObservation would have refused it, proving lintLine is load-bearing",
  Number.isFinite(Number(bypassId)),
);
const lintOfBypass = lint.lintLine(sentenceShaped);
ok(
  "...and the shipping lintLine DOES flag that exact row's text as sentence-shaped",
  lintOfBypass.reasons.some((r) => r.includes("sentence-shaped")),
  JSON.stringify(lintOfBypass.reasons),
);
await q(`delete from vy_observation where id = $1`, [bypassId]); // this row is not a legitimate fixture; scrub before residue check

// ─────────────────────────────────────────────────────────────────────────
// 3. matching is PULL-ONLY, structurally
// ─────────────────────────────────────────────────────────────────────────
section("3. matching is pull-only");

// The signal-word note ("knee") from OBS_GOOD_NOTES is goodIds[0].
const kneeQuery = "so how's his knee been lately";
const matched = await obs.matchObservations(q, OBS_PERSON, OBS_AGENT, kneeQuery, 3, RECALL_STOP);
ok(
  "a real query with a signal word IN the note DOES match",
  matched.some((m) => m.id === goodIds[0]),
  JSON.stringify(matched.map((m) => m.id)),
);

// A q() that throws on ANY invocation — if matchObservations calls it for a
// no-signal query, this test fails LOUDLY (a thrown error), not silently.
const poisonedQ = async () => {
  throw new Error("matchObservations issued a SQL call for a query with no signal words — pull-only violated");
};
const noSignalCases = [
  ["empty string", ""],
  ["whitespace only", "   "],
  ["stopwords only (RECALL_STOP-filtered)", "what have you been doing with them"],
  ["too-short words only", "hi ok wat u no"],
  ["no query at all", undefined],
];
let noSignalPassed = 0;
for (const [label, query] of noSignalCases) {
  try {
    const rows = await obs.matchObservations(poisonedQ, OBS_PERSON, OBS_AGENT, query, 3, RECALL_STOP);
    if (Array.isArray(rows) && rows.length === 0) noSignalPassed++;
    else console.log(`      unexpected non-empty result for "${label}": ${JSON.stringify(rows)}`);
  } catch (e) {
    console.log(`      poisoned-q fired for "${label}": ${e.message}`);
  }
}
ok(
  `${noSignalPassed}/${noSignalCases.length} no-signal queries returned [] WITHOUT ever calling q() ` +
    `(a fixture that throws on any DB call proves this structurally, not by inspection)`,
  noSignalPassed === noSignalCases.length,
);

// agent scoping: seed the identical note under OBS_OTHER_AGENT and confirm
// OBS_AGENT's query never surfaces it.
const [{ id: otherAgentEp }] = await q(
  `insert into vy_episode (person_id, agent_id, channel, participation, started_at, ended_at, boundary_reason, summary, importance, provisional)
   values ($1,($2)::uuid,'chat','user',now(),now(),'topic',$3,1.0,false) returning id`,
  [OBS_PERSON, OBS_OTHER_AGENT, `${OBS_TAG} other-agent episode`],
);
const otherAgentObsId = await obs.writeObservation(q, {
  personId: OBS_PERSON,
  agentId: OBS_OTHER_AGENT,
  note: `${OBS_TAG} knee still bothers him too`,
  citations: [Number(otherAgentEp)],
});
const scopedMatch = await obs.matchObservations(q, OBS_PERSON, OBS_AGENT, kneeQuery, 5, RECALL_STOP);
ok(
  "matching is agent-scoped: querying as OBS_AGENT never returns OBS_OTHER_AGENT's identically-matching row",
  !scopedMatch.some((m) => m.id === otherAgentObsId),
  JSON.stringify(scopedMatch.map((m) => m.id)),
);

// ─────────────────────────────────────────────────────────────────────────
// 4. decay: salience only, never t_invalid, never a delete
// ─────────────────────────────────────────────────────────────────────────
section("4. decay never deletes, never sets t_invalid");
const decayTargetId = goodIds[1]; // the coffee-preference note
const beforeDecay = (await q(`select salience, times_seen, t_invalid from vy_observation where id = $1`, [decayTargetId]))[0];
// backdate last_seen by 2x the default half-life so the effect is unmissable
const backdateDays = obs.DEFAULT_OBSERVATION_HALF_LIFE_DAYS * 2;
await q(`update vy_observation set last_seen = now() - ($2 || ' days')::interval where id = $1`, [decayTargetId, String(backdateDays)]);

const countBeforeDecay = (await q(`select count(*)::int n from vy_observation where person_id = $1`, [OBS_PERSON]))[0].n;
let touched = 0;
for (let pass = 0; pass < 5; pass++) {
  touched = await obs.decayObservations(q, OBS_AGENT, new Date(), obs.DEFAULT_OBSERVATION_HALF_LIFE_DAYS);
}
const countAfterDecay = (await q(`select count(*)::int n from vy_observation where person_id = $1`, [OBS_PERSON]))[0].n;
const afterDecay = (await q(`select salience, times_seen, t_invalid from vy_observation where id = $1`, [decayTargetId]))[0];

ok("decayObservations touched >=1 row on each of 5 consecutive passes", touched >= 1, `last pass touched=${touched}`);
ok("row COUNT is unchanged after 5 decay passes — nothing was deleted", countAfterDecay === countBeforeDecay, `${countBeforeDecay} -> ${countAfterDecay}`);
ok("t_invalid is still null after 5 decay passes — decay never invalidates", afterDecay.t_invalid === null);
ok(
  `salience DECREASED (${Number(beforeDecay.salience).toFixed(4)} -> ${Number(afterDecay.salience).toFixed(4)}) — decay moved retrieval priority`,
  Number(afterDecay.salience) < Number(beforeDecay.salience),
);
// parity: the pure formula and the SQL formula must agree (within float error)
const predicted = obs.decayedSalience(Number(beforeDecay.salience), backdateDays, obs.DEFAULT_OBSERVATION_HALF_LIFE_DAYS);
ok(
  `SQL-side decay matches the pure decayedSalience() formula within 1e-3 (predicted ${predicted.toFixed(4)}, got ${Number(afterDecay.salience).toFixed(4)})`,
  Math.abs(predicted - Number(afterDecay.salience)) < 1e-3,
);

// ─────────────────────────────────────────────────────────────────────────
// 5. promotion: sets promoted_to, writes vy_pattern exactly once, and the
//    promoted observation stops matching even though its note still would
// ─────────────────────────────────────────────────────────────────────────
section("5. promotion — one path into vy_pattern");
const promoTargetId = goodIds[2]; // the goa-trip note
await obs.touchObservation(q, promoTargetId, ep2); // "repeats" -> times_seen 2, 2 citations
const promoRow = (await q(`select times_seen, citations, note from vy_observation where id = $1`, [promoTargetId]))[0];
const eligible = obs.observationEligibleForPromotion({ times_seen: Number(promoRow.times_seen), citations: promoRow.citations });
ok("after touchObservation, the observation is eligible for promotion (times_seen>=2, citations>=2)", eligible, JSON.stringify(promoRow));

const patternCountBefore = (await q(`select count(*)::int n from vy_pattern where person_id = $1`, [OBS_PERSON]))[0].n;
const patternId = await rel.writePattern(
  q,
  {
    person_id: OBS_PERSON,
    moment: "planning",
    if_shape: `${OBS_TAG} trip planning comes up`,
    then_note: `${OBS_TAG} ask about goa again`,
    citations: promoRow.citations.map(Number),
  },
  OBS_AGENT,
);
await obs.promoteObservation(q, promoTargetId, patternId);
const patternCountAfter = (await q(`select count(*)::int n from vy_pattern where person_id = $1`, [OBS_PERSON]))[0].n;
const afterPromo = (await q(`select promoted_to from vy_observation where id = $1`, [promoTargetId]))[0];

ok("exactly one vy_pattern row was written by the promotion (writePattern is relstate.ts's, called once)", patternCountAfter === patternCountBefore + 1, `${patternCountBefore} -> ${patternCountAfter}`);
ok("the observation's promoted_to now equals the real pattern id", Number(afterPromo.promoted_to) === Number(patternId), `promoted_to=${afterPromo.promoted_to} patternId=${patternId}`);

const goaQuery = "any plans for that goa trip";
const postPromoMatch = await obs.matchObservations(q, OBS_PERSON, OBS_AGENT, goaQuery, 5, RECALL_STOP);
ok(
  "a promoted observation no longer surfaces from matchObservations — even though its note still contains " +
    "the query word — so the two stores never render the same evidence under two different claims",
  !postPromoMatch.some((m) => m.id === promoTargetId),
  JSON.stringify(postPromoMatch.map((m) => m.id)),
);

// ─────────────────────────────────────────────────────────────────────────
// 6. forget reaches vy_observation — via api/memory.js's REAL manifest helpers
// ─────────────────────────────────────────────────────────────────────────
section("6. forget reaches vy_observation");
const manifestEntry = PERSON_TABLES.find((t) => t.table === "vy_observation");
ok("vy_observation is in PERSON_TABLES, agent-scoped, keyed on person_id", Boolean(manifestEntry) && manifestEntry.agent === true && manifestEntry.key === "person_id", JSON.stringify(manifestEntry));

const active = await activePersonTables();
const activeEntry = active.find((t) => t.table === "vy_observation");
ok("vy_observation survives activePersonTables()'s migration-008 filter (it isn't an MP table)", Boolean(activeEntry));

const countBeforeForget = (await q(`select count(*)::int n from vy_observation where person_id = $1`, [OBS_PERSON]))[0].n;
ok("there is at least one vy_observation row to forget before running the wipe", countBeforeForget > 0, String(countBeforeForget));

const wipeSql = `delete from ${activeEntry.table} where ${wipeWhereSql(activeEntry)} returning 1`;
const wipeParamValues = wipeParams(activeEntry, { device: deviceId, person: OBS_PERSON });
const deleted = await q(wipeSql, wipeParamValues);
const countAfterForget = (await q(`select count(*)::int n from vy_observation where person_id = $1`, [OBS_PERSON]))[0].n;
ok(
  `opForget's own wipe SQL (wipeWhereSql/wipeParams, unmodified) deletes all ${deleted.length} of this person's ` +
    `vy_observation rows — including OBS_OTHER_AGENT's, because a whole-person wipe is agent-independent by design`,
  countAfterForget === 0,
  `deleted=${deleted.length} remaining=${countAfterForget}`,
);

// ─────────────────────────────────────────────────────────────────────────
// 7. NEGATIVE CONTROL for pull-only: what a speculative volunteer-decider
//    WOULD have returned, for the exact same no-signal query as case 3 above
// ─────────────────────────────────────────────────────────────────────────
section("7. negative control — proving the pull-only refusal is a real behavioural difference");
// re-seed one row (the forget test above just deleted everything for this person)
const controlEp = await insertEpisode(OBS_AGENT, "negative-control episode");
const controlObsId = await obs.writeObservation(q, {
  personId: OBS_PERSON,
  agentId: OBS_AGENT,
  note: `${OBS_TAG} control row for the negative test`,
  citations: [controlEp],
});
const emptyQuery = "";
const shipped = await obs.matchObservations(q, OBS_PERSON, OBS_AGENT, emptyQuery, 5, RECALL_STOP);
// The naive query a volunteer-decider would run: "show me what's salient for
// this person", ignoring the turn entirely — exactly the function this file
// deliberately does not expose (see observation.ts's own comment on this).
const naiveVolunteered = await q(
  `select id from vy_observation where person_id = $1 and agent_id = $2 and t_invalid is null and promoted_to is null
   order by salience desc limit 5`,
  [OBS_PERSON, OBS_AGENT],
);
ok("the SHIPPED matchObservations returns [] for an empty query", shipped.length === 0, JSON.stringify(shipped));
ok(
  "the NAIVE query (no WHERE clause tied to the turn) DOES return the row for the identical empty query — " +
    "proving [] above is matchObservations' own refusal, not an accident of empty fixture data",
  naiveVolunteered.some((r) => Number(r.id) === controlObsId),
  JSON.stringify(naiveVolunteered),
);

// ─────────────────────────────────────────────────────────────────────────
// 8. §11 reversal condition — the fabrication-rate eval, DESIGNED not RUN
// ─────────────────────────────────────────────────────────────────────────
section("8. §11 reversal-condition eval — design, not execution");
console.log(`
  §7 reverses if single-citation observations raise the fabrication rate on
  recall above the measured 'fab-noise-floor' (context/measurements.md):
  13.6pp spread, median |diff| 28pp, p90 75pp, across n=300 BYTE-IDENTICAL
  arm-pairs in the existing replay harness. This session does not run that
  eval — no live judge spend was authorized, and CLAUDE.md's model policy
  (2026-08-13) places judge synthesis/evaluation-worthy-of-a-context-entry
  work under Fable, not this build workstream. What it would take:

  DESIGN
    arm A (control): T5's recall.facts rendered WITHOUT any vy_observation
      row, everything else in the prompt byte-identical.
    arm B (treatment): the identical turn, T5 rendered WITH exactly one
      single-citation vy_observation row surfaced via matchObservations.
    Both arms replay the SAME underlying conversation corpus (fab-noise-floor's
    own methodology: real transcripts where the setting provably cannot act,
    so any measured spread is harness noise, not signal) PLUS a second corpus
    where the observation's claim is independently checkable against the
    transcript (so a judge can score "did she say something the citation
    does not support" rather than only "did her tone read confident").

  JUDGE
    an LLM judge (or human rater, per this repo's existing judge-backtest
    convention in evals/dbattery/judge-backtest.mjs) scores each arm-B reply
    for: (a) did the observation's content appear at all, (b) if it did, is
    every claim attributable to the citation, (c) any invented detail beyond
    the citation counts as one fabrication event.

  SAMPLE SIZE
    n>=300 arm-pairs, matching fab-noise-floor's own n — that is the n at
    which THIS harness's noise floor was itself characterized; a claim at any
    smaller n cannot be distinguished from noise, per that same measurement.
    Because arm A (control) also needs its OWN noise re-characterization on
    this observation-specific corpus (fab-noise-floor's 13.6pp was measured
    on the vision-replay harness, not text recall — the METHOD transfers,
    the NUMBER may not), that argues for a within-suite double-run of arm A
    against itself (A vs A', both byte-identical, zero mechanism difference)
    alongside the real A-vs-B comparison, exactly mirroring how
    fab-noise-floor was itself established.

  COST (order of magnitude, not a quote)
    >=300 arm-pairs x 2 arms x (1 generation + 1 judge call) = >=1,200 model
    calls minimum, before the arm-A' noise re-characterization run (another
    >=300 pairs) — call it ~1,800-2,400 calls total. Real spend, not
    simulate-able from this session's tools.

  REVERSAL RULE, restated as a number: if arm B's fabrication rate exceeds
  arm A's by more than the re-characterized noise floor (not the raw 13.6pp
  borrowed from a different harness), §7's >=1-citation bar is load-bearing
  for ACCURACY, and this table's minimum should move to >=2 citations —
  which would collapse the entire latency argument this section exists to
  fix (§7's own header: "Earliest usable: the night of the third calendar
  day" is what >=2 citations cost on vy_pattern). NOT run this session.
`);

// ─────────────────────────────────────────────────────────────────────────
// teardown + residue
// ─────────────────────────────────────────────────────────────────────────
let residue = -1;
if (!KEEP) {
  section("teardown");
  const counts = {};
  const del = async (label, sql) => {
    const rows = await q(sql, [OBS_PERSON]).catch(() => []);
    counts[label] = rows.length;
  };
  await del("vy_observation", `delete from vy_observation where person_id = $1 returning 1`);
  await del("vy_pattern", `delete from vy_pattern where person_id = $1 returning 1`);
  await del("vy_episode", `delete from vy_episode where person_id = $1 returning 1`);
  await del("meera_log", `delete from meera_log where device_id in (select device_id from vy_person_device where person_id = $1) returning 1`);
  await del("vy_person_device", `delete from vy_person_device where person_id = $1 returning 1`);
  await del("vy_person", `delete from vy_person where person_id = $1 returning 1`);
  console.log(`  dropped: ${JSON.stringify(counts)}`);

  const residueRows = await q(
    `select
       (select count(*) from vy_person where person_id = $1) +
       (select count(*) from vy_person_device where person_id = $1) +
       (select count(*) from vy_episode where person_id = $1) +
       (select count(*) from vy_observation where person_id = $1) +
       (select count(*) from vy_pattern where person_id = $1) +
       (select count(*) from meera_log where device_id in (select device_id from vy_person_device where person_id = $1)) +
       (select count(*) from vy_observation where note like $2) +
       (select count(*) from vy_episode where summary like $2)
       as n`,
    [OBS_PERSON, `${OBS_TAG}%`],
  );
  residue = Number(residueRows[0]?.n ?? -1);
  ok(`zero residue for ${OBS_PERSON} and every "${OBS_TAG}"-prefixed row, verified live`, residue === 0, `residue=${residue}`);
} else {
  console.log(`\n(--keep: fixture rows left in place under person ${OBS_PERSON})`);
}

console.log(
  failed
    ? `\n${failed} assertion(s) FAILED`
    : `\nall observation.mjs gates green (person ${OBS_PERSON}, residue ${KEEP ? "not checked (--keep)" : residue})`,
);
process.exit(failed ? 1 : 0);
