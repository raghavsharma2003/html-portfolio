// WS-R3 — READINESS: one number, five parts, one action, and the publish lock.
//
//   node evals/readiness/run.mjs
//   node evals/run.mjs readiness
//
// Offline, deterministic, $0, no database, no network, ZERO model calls, ~1s.
//
// ═════════════════════════════════════════════════════════════════════════
// §0. WHAT THIS SUITE IS ACTUALLY GUARDING
// ═════════════════════════════════════════════════════════════════════════
//
// DESIGN-LAW §1 has one clause that is easy to write down and easy to lose in
// a refactor six months from now:
//
//   the overall is UNDEFINED until every part has a value, and the publish
//   lock stays locked while any part is unmeasured.
//
// The pressure against that clause is real and it will arrive as a reasonable
// request. A screen that says "Readiness: not yet" for every creator looks
// broken to somebody who does not know why, and the smallest edit that makes
// it look fixed is to average the parts that DO have numbers. That edit is a
// one-line change, it makes every test that only checks arithmetic still pass,
// and it converts this screen into `plausible-return-hides-a-dead-pipeline`
// with a score attached: a creator would read 82, publish, and find out from
// their audience which of the five parts nobody had ever measured.
//
// So §4 below does not merely assert the clause. It REMOVES the guard from a
// copy of the real module, runs the same fixtures through it, and requires the
// assertions to fail. A guard whose removal changes nothing is not a guard.
//
// ═════════════════════════════════════════════════════════════════════════
// §0.1 WHAT THIS SUITE CANNOT SEE
// ═════════════════════════════════════════════════════════════════════════
//
// SQL types and referential integrity. `offline-mocks-cannot-type-check-sql`:
// a mocked database proves control flow, never types. The lock predicates in
// api/_replica-runtime.js and api/_clonechannel.js are asserted here as SOURCE
// SHAPES (the clauses are present, in the right joins, with the floors bound)
// and that is all an offline suite can honestly do with them. `evals/sqlcast`
// covers the parameter types, `scripts/relcheck.mjs` the erasure reach, and
// migration 073 has never been applied to any database.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MIN_MIRROR_FEEDBACK,
  MIN_NEVER_SAY_RULES,
  MIN_VALIDITY_CLAIMS,
  READINESS_ACTIONS,
  READINESS_BLOCKER,
  READINESS_OVERALL_FLOOR,
  READINESS_PART_FLOOR,
  READINESS_PARTS,
  READINESS_POLICY_VERSION,
  readOwnedReadiness,
  readinessInputsHash,
  readinessScreen,
  snapshotReadiness,
} from "../../api/_readiness.js";
import { runtimeBlockers } from "../../api/_replica-runtime.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const RID = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const NOW = Date.parse("2026-09-03T00:00:00.000Z");

let checks = 0;
function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}
function eq(actual, expected, name) {
  assert.deepEqual(actual, expected, `${name} (got ${JSON.stringify(actual)})`);
  console.log(`ok ${++checks} - ${name}`);
}

const at = (daysAgo) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const byId = (screen) => Object.fromEntries(screen.parts.map((row) => [row.id, row]));

// ═════════════════════════════════════════════════════════════════════════
// THE FIXTURES
// ═════════════════════════════════════════════════════════════════════════
//
// `PASSING` is the only fixture with all five instruments present, and it is
// worth saying out loud that NO REAL REPLICA LOOKS LIKE IT TODAY: nothing in
// this repo writes a per-replica recall run or an owner voice ceiling
// (api/_readiness.js §4 names both absences). It exists so the pass path is
// proven rather than assumed, and so the day those writers land the screen is
// already known to work. Every other fixture is a mutation of it.
const PASSING = Object.freeze({
  now: NOW,
  claims: { mined: 142, reviewed: 96, approved: 40 },
  recall: { questions: 40, correct: 34, computed_at: at(2) },
  fidelity: { mean: 0.63, windows: 12, status: "warn", computed_at: at(1) },
  owner_ceiling: { value: 0.8869, n: 8, measured_at: at(9) },
  mirror: { sounds_right: 36, fix_it: 14, latest_at: at(3) },
  safety: {
    never_say_rules: 5,
    person_model_approved: true,
    person_model_approved_at: at(5),
    escalation_route: true,
  },
  freshness: { claims_total: 40, claims_valid: 32, newest_source_at: at(11) },
});

const mutate = (patch) => ({ ...PASSING, ...patch });

// ═════════════════════════════════════════════════════════════════════════
// §1. ALL MEASURED, ABOVE BOTH FLOORS: THE SCREEN OPENS
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 1. all measured, publishing unlocked ──");

const pass = readinessScreen(PASSING);
const passParts = byId(pass);

eq(pass.parts.map((row) => row.id), [...READINESS_PARTS], "the five parts render in the fixed policy order");
eq(pass.unmeasured_count, 0, "every part has an instrument in this fixture");
eq(passParts.knows_your_material.value, 85, "recall is scored answers over held-out questions");
eq(passParts.sounds_like_you.value, 71, "similarity is expressed as a share of the owner's OWN ceiling");
eq(passParts.thinks_like_you.value, 72, "the correction ratio is sounds-right over every tap");
eq(passParts.knows_what_not_to_say.value, 100, "three configured protections, all three in place");
eq(passParts.up_to_date.value, 80, "validity is unexpired approved claims over approved claims");
eq(pass.overall, 82, "the overall is the mean of the five parts, rounded");
eq(pass.min_part, 71, "min_part is the weakest measured part");
eq(pass.publish_locked, false, "above 70 overall and 55 on every part, publishing is open");
eq(pass.blockers, [], "an open screen carries no blockers");
eq(pass.suggested_action, null, "an open screen suggests nothing, because there is nothing to do");
eq(pass.policy_version, READINESS_POLICY_VERSION, "the screen stamps the policy that computed it");

// The denominator is never invisible. §2 of api/_readiness.js: a similarity
// score expressed against somebody else's ceiling is the `ground-truth-ceiling`
// defect, so the sentence under the number has to name whose 100 it is.
ok("the voice part says whose hundred it is being scored out of",
  /71 of your own 100/.test(passParts.sounds_like_you.detail));
ok("every measured part carries its own n, method and date",
  pass.parts.every((row) => !row.measured || (row.n !== null && row.method && row.measured_at)));

// ═════════════════════════════════════════════════════════════════════════
// §2. ONE PART BELOW THE PART FLOOR: LOCKED EVEN WITH A HEALTHY OVERALL
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 2. one low part locks a healthy overall ──");

const low = readinessScreen(mutate({ mirror: { sounds_right: 25, fix_it: 25, latest_at: at(3) } }));
eq(byId(low).thinks_like_you.value, 50, "half the turns corrected is a 50");
eq(low.unmeasured_count, 0, "nothing became unmeasured, only worse");
ok("the overall is still comfortably above its own floor", low.overall >= READINESS_OVERALL_FLOOR);
eq(low.publish_locked, true, "one part under 55 locks publishing regardless of the overall");
eq(low.blockers, [{ part: "thinks_like_you", code: "below_part_floor" }],
  "the blocker names the part, not just the fact of being blocked");
eq(low.weakest_part, "thinks_like_you", "the weakest part is the lowest measured one");
eq(low.suggested_action?.code, "long_mirror_call",
  "a low correction ratio suggests the interview that would move it");

// The overall floor bites on its own too, with every part above 55.
const flat = readinessScreen(mutate({
  recall: { questions: 40, correct: 24, computed_at: at(2) },
  mirror: { sounds_right: 30, fix_it: 20, latest_at: at(3) },
  freshness: { claims_total: 40, claims_valid: 24, newest_source_at: at(11) },
  safety: { ...PASSING.safety, escalation_route: false },
}));
ok("every part clears the part floor in the flat fixture",
  flat.parts.every((row) => row.measured && row.value >= READINESS_PART_FLOOR));
ok("the flat fixture's overall sits below the overall floor", flat.overall < READINESS_OVERALL_FLOOR);
eq(flat.publish_locked, true, "a mediocre clone with no single failing part is still locked");
ok("the overall floor reports itself as its own blocker",
  flat.blockers.some((row) => row.part === null && row.code === "below_overall_floor"));

// ═════════════════════════════════════════════════════════════════════════
// §3. ONE PART UNMEASURED: THE OVERALL IS UNDEFINED AND THE LOCK HOLDS
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 3. an unmeasured part has no number and no overall ──");


const unmeasured = readinessScreen(mutate({ recall: null }));
const unmeasuredParts = byId(unmeasured);

eq(unmeasuredParts.knows_your_material.value, null,
  "a part with no instrument has NO value, and specifically not zero");
eq(unmeasuredParts.knows_your_material.measured, false, "...and says so in its own flag");
eq(unmeasuredParts.knows_your_material.reason, "no_recall_run",
  "...naming which instrument is missing, in a code a screen can map");
ok("...and rendering the counts it does have as detail rather than as the number",
  /142 claims mined from what you gave us, 96 reviewed by you/.test(unmeasuredParts.knows_your_material.detail));
eq(unmeasured.overall, null, "ONE unmeasured part leaves the overall UNDEFINED");
eq(unmeasured.min_part, null, "...and min_part with it, so no gate can read half a verdict");
eq(unmeasured.unmeasured_count, 1, "the count of missing instruments is reported, not hidden");
eq(unmeasured.publish_locked, true, "an unmeasured part locks publishing");
eq(unmeasured.blockers, [{ part: "knows_your_material", code: "not_measured_yet" }],
  "the blocker distinguishes a missing instrument from a failing score");
eq(unmeasured.weakest_part, "knows_your_material",
  "an absent instrument outranks any number as the weakest part");

// The state EVERY replica is in today: two instruments do not exist. This
// fixture is the honest one, and the suite asserts on it so the day somebody
// makes the screen "look finished" the diff is visible here.
const today = readinessScreen(mutate({ recall: null, owner_ceiling: null }));
eq(today.unmeasured_count, 2, "with no recall run and no owner ceiling, two parts are unmeasured");
eq(today.overall, null, "...so there is no overall to show a creator");
eq(today.publish_locked, true, "...and the publish lock is closed for every replica in that state");
ok("the voice part still reports the similarity it DOES have, and refuses to score it",
  /Similarity 0\.630 over 12 windows/.test(byId(today).sounds_like_you.detail)
  && byId(today).sounds_like_you.reason === "no_owner_ceiling");

// ═════════════════════════════════════════════════════════════════════════
// §4. THE NEGATIVE CONTROL: REMOVING THE GUARD MUST FAIL THIS SUITE
// ═════════════════════════════════════════════════════════════════════════
//
// The real module, with the unmeasured guard cut out and replaced by the
// tempting version (average whatever has a number), imported and run against
// the same fixtures. If §3's assertions still hold against it, §3 is decoration.
//
// The copy is written to a temp directory with its relative imports rewritten
// to absolute file URLs, so nothing is ever written inside api/ — a mutated
// module left behind in the source tree is a `gates-that-live-nowhere` in the
// making, and worse, one that could be deployed.
console.log("\n── 4. negative control: the guard is load-bearing ──");

function loadPatched(patch) {
  const source = readFileSync(join(ROOT, "api/_readiness.js"), "utf8");
  const rewritten = patch(source).replace(
    /from "\.\/([^"]+)"/g,
    (_match, rel) => `from "${pathToFileURL(join(ROOT, "api", rel)).href}"`,
  );
  assert.notEqual(rewritten, source, "the negative-control patch must actually change the source");
  const dir = mkdtempSync(join(tmpdir(), "readiness-nc-"));
  const file = join(dir, "patched.mjs");
  writeFileSync(file, rewritten);
  return import(pathToFileURL(file).href);
}

// The two halves of the guard, removed together, because "make the screen
// look finished" is one edit and not two: an overall computed over three of
// five parts needs a min_part computed the same way or the lock predicate
// reads a null and refuses anyway.
const GUARDS = [
  [`  const overall = unmeasured.length === 0
    ? Math.round(measured.reduce((sum, row) => sum + row.value, 0) / measured.length)
    : null;`,
   `  const overall = measured.length
    ? Math.round(measured.reduce((sum, row) => sum + row.value, 0) / measured.length)
    : null;`],
  [`  const minPart = unmeasured.length === 0
    ? measured.reduce((low, row) => Math.min(low, row.value), 100)
    : null;`,
   `  const minPart = measured.length
    ? measured.reduce((low, row) => Math.min(low, row.value), 100)
    : null;`],
];

const patched = await loadPatched((source) => {
  let out = source;
  for (const [guard, without] of GUARDS) {
    ok("the negative control finds the exact guard it means to remove", out.includes(guard));
    out = out.split(guard).join(without);
  }
  return out;
});

const cheated = patched.readinessScreen(mutate({ recall: null, owner_ceiling: null }));
ok("negative control: without the guard the same two-unmeasured fixture DOES produce an overall",
  cheated.overall !== null);
ok("negative control: and that overall is a plausible, publishable-looking number",
  cheated.overall >= READINESS_OVERALL_FLOOR);

// The assertions §3 makes, run against the patched module. Every one of them
// must now FAIL, or §3 was not testing what it claims.
const guardAssertions = [
  ["the overall stays undefined", (screen) => screen.overall === null],
  ["min_part stays undefined", (screen) => screen.min_part === null],
];
for (const [label, holds] of guardAssertions) {
  ok(`...and the real module's property (${label}) is violated by the patched one`,
    holds(today) === true && holds(cheated) === false);
}

// The SECOND, independent layer. The blocker list is built from the parts
// themselves rather than from the overall, so even the patched module still
// reports the lock — which is the shape a gate for a harm the next turn does
// not undo is supposed to have. It is asserted here so the layer is known to
// be independent rather than assumed to be.
ok("the lock has a second reason to hold that the patched module cannot remove",
  cheated.publish_locked === true
  && cheated.blockers.some((row) => row.code === "not_measured_yet"));

// ═════════════════════════════════════════════════════════════════════════
// §5. WEAKEST PART AND THE ACTION TABLE
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 5. weakest part, and one action from a fixed table ──");

// Ties and ordering. Two unmeasured parts: the earlier one in the fixed policy
// order wins, so the same clone always gets the same advice.
eq(today.weakest_part, "knows_your_material",
  "with two instruments missing, the earlier part in the fixed order is the weakest");
eq(readinessScreen(mutate({ owner_ceiling: null })).weakest_part, "sounds_like_you",
  "...and with only the later one missing, it is that one");

// Lowest measured wins when everything is measured, ties broken by the order.
const tied = readinessScreen(mutate({
  recall: { questions: 40, correct: 24, computed_at: at(2) },
  mirror: { sounds_right: 30, fix_it: 20, latest_at: at(3) },
}));
eq(byId(tied).knows_your_material.value, 60, "the tie fixture puts two parts on 60");
eq(byId(tied).thinks_like_you.value, 60, "...both of them");
eq(tied.weakest_part, "knows_your_material", "a tie is broken by the fixed policy order, not by chance");

// EVERY action a part can emit is in the table, and every entry in the table is
// reachable. A label nobody can reach is copy that will drift out of date with
// nothing to catch it; an action outside the table is a button pointing at an
// anchor nobody checked exists.
const emitted = new Set();
const permutations = [
  PASSING,
  mutate({ recall: null }),
  mutate({ recall: null, claims: { mined: 0, reviewed: 0, approved: 0 } }),
  mutate({ recall: { questions: 40, correct: 8, computed_at: at(2) } }),
  mutate({ fidelity: null }),
  mutate({ owner_ceiling: null }),
  mutate({ owner_ceiling: { value: 0.9, n: 4, measured_at: at(9) } }),
  mutate({ mirror: { sounds_right: 2, fix_it: 1, latest_at: at(3) } }),
  mutate({ mirror: { sounds_right: 10, fix_it: 40, latest_at: at(3) } }),
  mutate({ safety: { ...PASSING.safety, never_say_rules: 1 } }),
  mutate({ safety: { ...PASSING.safety, escalation_route: false } }),
  mutate({ safety: { ...PASSING.safety, person_model_approved: false } }),
  mutate({ freshness: { claims_total: 2, claims_valid: 2, newest_source_at: at(11) } }),
  mutate({ freshness: { claims_total: 40, claims_valid: 8, newest_source_at: at(11) } }),
  mutate({ freshness: { claims_total: 40, claims_valid: 40, newest_source_at: at(400) } }),
];
for (const input of permutations) {
  for (const row of readinessScreen(input).parts) if (row.action) emitted.add(row.action.code);
}
ok("every action a part emits exists in the fixed action table",
  [...emitted].every((code) => Boolean(READINESS_ACTIONS[code])));
eq([...emitted].sort(), Object.keys(READINESS_ACTIONS).sort(),
  "and every entry in the action table is reachable by some real clone state");
ok("every action names a step and an anchor a creator can actually be sent to",
  Object.values(READINESS_ACTIONS).every((row) =>
    ["feed", "meet", "deploy"].includes(row.step) && /^#[a-z-]+$/.test(row.anchor) && row.label));
ok("no action label carries an em-dash or an en-dash (the copy gate, restated here)",
  !Object.values(READINESS_ACTIONS).some((row) => /[–—]/.test(row.label)));

// The screen suggests exactly ONE action, and it is the weakest part's.
for (const input of permutations) {
  const screen = readinessScreen(input);
  const weakest = screen.parts.find((row) => row.id === screen.weakest_part);
  assert.equal(screen.suggested_action, weakest?.action ?? null,
    "the one suggested action is always the weakest part's own");
}
console.log(`ok ${++checks} - the one suggested action is always the weakest part's own`);

// ═════════════════════════════════════════════════════════════════════════
// §6. THE SAMPLE FLOORS: A SMALL SAMPLE IS NOT A SMALL SCORE
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 6. below n, a part is unmeasured rather than low ──");

const thin = readinessScreen(mutate({
  mirror: { sounds_right: 0, fix_it: MIN_MIRROR_FEEDBACK - 1, latest_at: at(3) },
}));
eq(byId(thin).thinks_like_you.value, null,
  "19 corrections, all of them negative, is NOT a zero: it is not measured yet");
eq(byId(thin).thinks_like_you.reason, "too_few_corrections", "...and the reason names the sample");
eq(byId(thin).thinks_like_you.n, MIN_MIRROR_FEEDBACK - 1, "...while still reporting the n it has");
eq(byId(thin).thinks_like_you.action?.code, "run_mirror_call", "...and the action that would reach n");

const thinClaims = readinessScreen(mutate({
  freshness: { claims_total: MIN_VALIDITY_CLAIMS - 1, claims_valid: 0, newest_source_at: at(11) },
}));
eq(byId(thinClaims).up_to_date.value, null, "four expired claims out of four is not a zero either");
eq(byId(thinClaims).up_to_date.reason, "too_few_claims", "...and it names the sample floor it missed");

const fewRules = readinessScreen(mutate({
  safety: { ...PASSING.safety, never_say_rules: MIN_NEVER_SAY_RULES - 1 },
}));
eq(byId(fewRules).knows_what_not_to_say.value, 67,
  "two of three protections in place is a real two-thirds, because all three are checkable");
eq(byId(fewRules).knows_what_not_to_say.action?.code, "add_never_say",
  "...and the missing one names its own action");

// ═════════════════════════════════════════════════════════════════════════
// §7. THE READ, THE SNAPSHOT, AND THE HASH
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 7. the read, the snapshot and the input hash ──");

const calls = [];
function fakeDb(rows) {
  return async (sql, params) => {
    calls.push({ sql, params });
    if (/insert into vy_replica_readiness/i.test(sql)) return [{ readiness_id: "r1", computed_at: at(0) }];
    if (/from vy_replica_claim/i.test(sql)) return [rows.ledger];
    if (/from vy_voice_fidelity/i.test(sql)) return rows.fidelity ? [rows.fidelity] : [];
    if (/from vy_replica_voice_genome/i.test(sql)) return rows.ceiling ? [rows.ceiling] : [];
    if (/from vy_mirror_feedback/i.test(sql)) return [rows.mirror];
    if (/vy_teacher_sheet/i.test(sql)) return [rows.safety];
    if (/newest_source_at/i.test(sql)) return [rows.freshness];
    if (/lifecycle <> 'purging'/.test(sql)) return [{ replica_id: RID }];
    throw new Error(`unexpected SQL ${sql.slice(0, 70)}`);
  };
}

const db = fakeDb({
  ledger: { mined: 142, reviewed: 96, approved: 40, never_say_rules: 5, claims_valid: 32 },
  fidelity: { score: { mean: 0.63, p10: 0.6, worst: 0.55, windows: 12 }, status: "warn", computed_at: at(1) },
  ceiling: null,
  mirror: { sounds_right: 36, fix_it: 14, latest_at: at(3) },
  safety: { person_model_approved: true, person_model_approved_at: at(5), escalation_route: true },
  freshness: { newest_source_at: at(11) },
});
const read = await readOwnedReadiness(db, OWNER, RID);
eq(read.unmeasured_count, 2, "the live read reproduces today's honest state from real row shapes");
eq(read.overall, null, "...with no overall");
ok("the read binds the replica in every statement it issues",
  calls.every((call) => call.params.includes(RID)));
ok("the read snapshots what it computed, so the lock and the screen see one row",
  calls.some((call) => /insert into vy_replica_readiness/i.test(call.sql)));
ok("the snapshot insert is guarded against the newest row's own inputs hash",
  calls.find((call) => /insert into vy_replica_readiness/i.test(call.sql)).sql
    .includes("x.inputs_hash=$10"));
ok("the read returns the inputs hash it stored", /^[0-9a-f]{64}$/.test(read.inputs_hash));

// A GET with `snapshot: false` reads without writing. The screen has one
// writer; a caller that only wants a picture must be able to say so.
const quietCalls = [];
const quietRows = fakeDb({
  ledger: { mined: 0, reviewed: 0, approved: 0, never_say_rules: 0, claims_valid: 0 },
  fidelity: null, ceiling: null,
  mirror: { sounds_right: 0, fix_it: 0, latest_at: null },
  safety: { person_model_approved: false, person_model_approved_at: null, escalation_route: false },
  freshness: { newest_source_at: null },
});
const quietDb = async (sql, params) => { quietCalls.push(sql); return quietRows(sql, params); };
const quiet = await readOwnedReadiness(quietDb, OWNER, RID, { snapshot: false });
eq(quiet.unmeasured_count, 4, "an empty replica has four unmeasured parts and one real zero");
eq(byId(quiet).knows_what_not_to_say.value, 0,
  "the one part with a live instrument reports a true zero rather than hiding");
ok("...and a read asked not to snapshot writes nothing",
  !quietCalls.some((sql) => /insert into vy_replica_readiness/i.test(sql)));

// The 'epoch' sentinel from greatest() must never reach a part as a real date.
ok("no source in either intake lane reads as no source, never as a 1970 upload",
  /No source has landed yet/.test(byId(quiet).up_to_date.detail));

// A replica that is not the caller's is indistinguishable from one that does
// not exist, and the decision is the SQL predicate rather than a branch.
eq(await readOwnedReadiness(async () => [], OWNER, RID), null,
  "a replica the owner predicate does not match returns null");

// The hash covers the numbers and nothing else, so a poll that changes nothing
// writes nothing and the history stays a record of changes.
const hashA = readinessInputsHash(PASSING);
eq(readinessInputsHash({ ...PASSING, now: NOW + 60_000 }), hashA,
  "the inputs hash ignores the clock, so polling does not manufacture history");
ok("the inputs hash moves when a measurement moves",
  readinessInputsHash(mutate({ mirror: { sounds_right: 37, fix_it: 14, latest_at: at(3) } })) !== hashA);

const snapshotCalls = [];
await snapshotReadiness(async (sql, params) => { snapshotCalls.push({ sql, params }); return [{}]; },
  OWNER, RID, pass, hashA);
const snap = snapshotCalls[0];
eq(snap.params[3], 82, "the snapshot stores the overall it computed");
eq(snap.params[4], 71, "...its min_part");
eq(snap.params[5], 0, "...and its unmeasured count, which is what the lock predicate reads");
ok("the snapshot stores per-part n, method, date and reason, not just the numbers",
  /"method"/.test(snap.params[6]) && /"measured_at"/.test(snap.params[6]) && /"reason"/.test(snap.params[6]));

// ═════════════════════════════════════════════════════════════════════════
// §8. THE LOCK IS A SQL PREDICATE, NOT A CLIENT CHECK
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 8. the publish lock, in SQL, in both gates ──");

const runtimeSrc = readFileSync(join(ROOT, "api/_replica-runtime.js"), "utf8");
const channelSrc = readFileSync(join(ROOT, "api/_clonechannel.js"), "utf8");

ok("readiness is a runtime blocker beside fidelity, not instead of it",
  runtimeBlockers({ readiness_qualified: true }).includes(READINESS_BLOCKER) === false
  && runtimeBlockers({ readiness_qualified: false }).includes(READINESS_BLOCKER));
ok("a row with every other gate open but no readiness snapshot is still blocked",
  runtimeBlockers({
    subject_mode: "self", lifecycle: "ready", subject_person_id: "p", account_person_matches: true,
    person_age_tier: "adult_verified", age_verified_at: at(1), identity_verified_at: at(1),
    liveness_verified_at: at(1), identity_expires_at: at(-400), inference_consent: true,
    profile_approved: true, calibration_approved: true, genome_approved: true, voice_ready: true,
    qualification_passed: 7, fidelity_qualified: true, readiness_qualified: false,
  }).join(",") === READINESS_BLOCKER);
ok("the status read joins the LATEST snapshot rather than the best one",
  /from vy_replica_readiness x[\s\S]{0,200}order by x\.computed_at desc limit 1/.test(runtimeSrc));
ok("the status read evaluates all three lock conditions in SQL",
  /rdy\.unmeasured_count = 0 and rdy\.overall >= \$6::int4 and rdy\.min_part >= \$7::int4/.test(runtimeSrc));
ok("activation JOINS readiness, so no qualifying row means no capability",
  /join lateral \(\s*\n\s*select x\.readiness_id from vy_replica_readiness x/.test(runtimeSrc));
ok("activation's readiness join is pinned to the newest snapshot",
  /x\.computed_at=\(select max\(y\.computed_at\) from vy_replica_readiness y/.test(runtimeSrc));
ok("channel connect decides status with a SQL CASE rather than a JS branch",
  /status = case when \$6 = 'connected' and \$\{readinessPasses/.test(channelSrc)
  && /case when \$10 = 'connected' and \$\{readinessPasses/.test(channelSrc));
ok("resuming a paused channel carries the same lock",
  /case when \$6 = 'connected' and not \$\{readinessPasses/.test(channelSrc));
ok("a refused connect lands as a non-connected row and names the reason to the owner",
  /then 'connected' else 'draft' end/.test(channelSrc)
  && /CHANNEL_READINESS_BLOCKER = "clone_channel_readiness_locked"/.test(channelSrc));

// ═════════════════════════════════════════════════════════════════════════
// §9. MIGRATION 073 AND THE ERASURE REACH
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 9. migration 073, the schema mirror and erasure ──");

const migration = readFileSync(join(ROOT, "db/migrations/073_replica_readiness.sql"), "utf8");
eq(splitSql(migration).length, 17, "migration 073 is one-statement-runner safe");
ok("no DO block and no function, per apply.mjs's splitter",
  !/\bdo \$/i.test(migration) && !/create (or replace )?function/i.test(migration));
ok("every constraint uses the idempotent drop-then-add pair",
  (migration.match(/drop constraint if exists/g) || []).length
    === (migration.match(/add constraint/g) || []).length);
ok("the no-fake-numbers law is a CHECK, in both directions",
  /unmeasured_count > 0 and overall is null/.test(migration)
  && /unmeasured_count = 0 and overall is not null/.test(migration));

const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
ok("the table is mirrored into db/schema.sql", /create table if not exists vy_replica_readiness/.test(schema));
ok("...carrying the same overall-undefined constraint the migration adds",
  /vy_replica_readiness_overall_undefined/.test(schema));

const erasure = readFileSync(join(ROOT, "api/_replica-full-erasure.js"), "utf8");
ok("the readiness history is deleted by name in the erasure cascade",
  /delete from vy_replica_readiness x using target t/.test(erasure));
ok("...scoped by BOTH replica and owner, like every other line in that CTE",
  /delete from vy_replica_readiness x using target t\s*\n\s*where x\.replica_id=t\.replica_id and x\.owner_user_id=t\.owner_user_id/.test(erasure));

// -------------------------------------------------------------------------
// SECTION 10. THE SCREEN: NO FAKE NUMBERS, AND EVERY ACTION LANDS SOMEWHERE
// -------------------------------------------------------------------------
//
// A source-and-shape test, deliberately, in evals/voice-preview-ui.mjs's idiom.
// What is being guarded is not rendering, it is the two things a component can
// silently do to this screen: invent a number where the server sent null, and
// offer a button that scrolls to an element nobody added.
console.log("\n\u2500\u2500 10. the screen \u2500\u2500");

const panel = readFileSync(join(ROOT, "src/studio/ReadinessPanel.tsx"), "utf8");
const panelCss = readFileSync(join(ROOT, "src/studio/readiness.css"), "utf8");
const app = readFileSync(join(ROOT, "src/studio/StudioApp.tsx"), "utf8");

ok("the panel renders words, not a zero, when a part is unmeasured",
  /Not measured yet/.test(panel));
ok("the panel never substitutes a default for a null value",
  !/value\s*\?\?\s*0/.test(panel) && !/Number\(part\.value\)\s*\|\|\s*0/.test(panel));
ok("the panel computes no score of its own",
  !/reduce\(/.test(panel) && !/Math\.round/.test(panel));
ok("there is no progress bar on this screen, in the markup or in the stylesheet",
  !/<progress\b|role="progressbar"|progress-track/.test(panel)
  && !/progress|scaleX/.test(panelCss));
ok("an absent measurement is typeset smaller than a score, so it cannot read as one",
  /vy-readiness__part-absent \{[^}]*--text-body/.test(panelCss)
  && /vy-readiness__part-value \{[^}]*--text-heading/.test(panelCss));
ok("press feedback is on pointer-down through :active, not on release",
  /summary:active \{ transform: scale\(0\.97\); \}/.test(panelCss));
ok("only transform and opacity animate",
  !/transition:[^;]*(width|height|top|left|background)/.test(panelCss));
ok("reduced motion stops the loop rather than shortening it",
  /prefers-reduced-motion[\s\S]{0,160}animation: none/.test(panelCss));
ok("the five parts are two columns on a phone and five from 760 up",
  /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(panelCss)
  && /min-width: 760px[\s\S]{0,200}repeat\(5, minmax\(0, 1fr\)\)/.test(panelCss));
ok("no ad-hoc pixel or hex value in the stylesheet outside the media queries",
  !/:\s*#[0-9a-f]{3,8}\b/i.test(panelCss)
  && (panelCss.match(/\b\d+px\b/g) || []).every((v) => v === "760px" || v === "92px"));

// The word for an incomplete AI, and the words that are banned.
ok("an incomplete AI is an apprentice, never broken", /Still an apprentice/.test(panel));
// Checked on the RENDERED text only. Import paths, prop names and comments are
// not user-visible and are stripped first, which is the same distinction
// scripts/check-copy.mjs draws for its own rules ("code comments are
// unaffected; this is a user-visible-string rule"). The words themselves are
// the common brief's: an AI version of a person is "your AI", never a clone,
// a replica, a model or a fine-tune.
const renderedText = [
  ...(panel.match(/>[^<>{}]{3,}</g) || []),
  ...(panel.match(/: "[^"]{6,}"/g) || []),
  ...(panel.match(/`[^`]{6,}`/g) || []),
].join(" ");
ok("no banned product word enters the text this panel renders",
  !/\b(clone|replica|fine-?tune)s?\b/i.test(renderedText));
ok("the readiness copy also carries no banned product word from the server",
  !/\b(clone|replica|fine-?tune)s?\b/i.test(
    (readFileSync(join(ROOT, "api/_readiness.js"), "utf8")
      .split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n")
      .match(/(?:detail|method|label): [`"][^`"]{6,}[`"]/g) || []).join(" "),
  ));

// EVERY anchor in the action table must exist in a studio component. `jumpTo`
// returns silently on a missing target, so this is the only thing standing
// between the action table and a button that does nothing quietly.
const studioSources = ["StudioApp.tsx", "MirrorCallStudio.tsx", "PersonModelStudio.tsx",
  "ContextLockerPanel.tsx", "VoiceEnrollmentLab.tsx"]
  .map((name) => readFileSync(join(ROOT, "src/studio", name), "utf8")).join("\n");
for (const row of Object.values(READINESS_ACTIONS)) {
  ok(`the anchor for "${row.label}" exists in the studio (${row.anchor})`,
    studioSources.includes(`id="${row.anchor.slice(1)}"`));
}

ok("the panel is mounted on the Meet step and nowhere else",
  /step === "meet" && <ReadinessPanel/.test(app)
  && (app.match(/<ReadinessPanel/g) || []).length === 1);
ok("the strip it replaced is gone rather than left beside it",
  !/ReadinessStrip/.test(app.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")));

console.log(`\n${checks} readiness checks passed`);
