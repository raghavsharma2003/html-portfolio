// GATE 0 — the offline prompt-vs-SQL fixture A/B (PROPOSAL-MULTIPARTY-V1 §8.2,
// build gate G2 in §9). THIS GATE BLOCKS EVERYTHING. A single ACL violation is
// a build failure, not a statistic: §11 lists "any disclosure-ACL violation in
// a compiled context, ever" first among the things that falsify this design,
// and §8.3 gives it the same standing this repo already gives forget-probe
// recovery — ship-blocking, not tunable.
//
//   node evals/mp/gate0.mjs            → build, assert, tear down, prove residue
//   node evals/mp/gate0.mjs --keep     → leave the fixture schema up for probing
//   node evals/mp/gate0.mjs --cleanup  → drop the fixture schema and exit
//
// NOT wired into evals/run.mjs. Every suite in that runner is db-free (it runs
// in .github/workflows/build-apk.yml, which has no NEON_URL) and this one is
// not: it runs the REAL predicate against the REAL Postgres, because the
// failure modes that matter here — three-valued logic on a null person_id,
// array containment over an empty set, a universal quantifier that is
// vacuously true — are engine semantics, not JavaScript. A JS re-implementation
// of the predicate would pass this gate and ship a different predicate. It sits
// alongside scripts/relcheck.mjs instead, which has the same property and the
// same invocation shape.
//
// ── the two arms ───────────────────────────────────────────────────────────
//
//   SQL arm     — retrieval through api/_disclosure.js's predicate, in the
//                 WHERE clause, before any ranking.
//   PROMPT arm  — the same retrieval with the ordinary scoping a prompt-based
//                 implementation would use (this room's rows, or this person's
//                 rows) and the disclosure rule stated as an instruction.
//
// The prompt arm is measured AT THE CONTEXT LEVEL, deterministically, and that
// is a deliberate honesty limit: §8.2's metric is "A's compiled context AND
// replies", and the reply half needs a model, real money, and a judge. What
// this gate measures is the half that is decidable offline — how much
// material a prompt-based arm PUTS IN FRONT OF THE MODEL that the recipient
// has no right to. That number is a floor on the prompt arm's leak rate, not
// an estimate of it: the model cannot leak what was never retrieved, and
// everything it was handed it can leak (9-90% residual for every behavioural
// mitigation ever measured, context/measurements.md#disclosure-leak-rates).
import { q } from "../../api/_db.js";
import { disclosurePredicate, bridgeEligibilityClause, NEGATIVE_AFFECT_TAGS } from "../../api/_disclosure.js";
import {
  PERSONS, ROOMS, EPISODES, FACTS, PHRASES, GRANTS, TAG,
  policyAllows, buildScenarios,
} from "./fixtures.mjs";
import { PREFIX, ns, T, teardown, proveNoResidue, buildSchema, seed, uuidArr } from "./harness.mjs";

const KEEP = process.argv.includes("--keep");
const CLEANUP_ONLY = process.argv.includes("--cleanup");
const say = (s) => console.log(s);

if (CLEANUP_ONLY) {
  const n = await teardown();
  const res = await proveNoResidue();
  say(`dropped ${n} fixture relation(s); residue: ${JSON.stringify(res)}`);
  process.exit(res.relations.length || res.productionRows.length ? 1 : 0);
}

// ── 1. build the fixture schema from the REAL DDL, then seed it ────────────
say("── building the fixture schema from the real DDL ──");
await teardown();
const built = await buildSchema();
say(`  ok  ${built.base} base + ${built.migration} migration statements applied to the ${PREFIX}* namespace`);
say(`  ok  migration 008a/008b/008c re-applied cleanly — every statement is independently idempotent`);

const { roomId, epId, factId, phId, counts } = await seed();
say(
  `  ok  seeded ${counts.persons} persons, ${counts.rooms} rooms, ${counts.episodes} episodes, ` +
    `${counts.facts} facts, ${counts.phrases} phrases, ${counts.grants} grants`,
);

// ── 3. the scenarios ───────────────────────────────────────────────────────
const scenarios = buildScenarios();
await q(
  `create table ${T("scenario")} (sid int primary key, recipients uuid[] not null,
     is_group boolean not null, room_id bigint)`,
);
for (let i = 0; i < scenarios.length; i += 120) {
  const chunk = scenarios.slice(i, i + 120);
  await q(
    `insert into ${T("scenario")} (sid, recipients, is_group, room_id) values ` +
      chunk
        .map((s) => `(${s.sid}, ${uuidArr(s.recipients)}, ${s.isGroup}, ${s.room ? roomId[s.room] : "null"})`)
        .join(","),
    [],
    60_000,
  );
}
say(`  ok  ${scenarios.length} retrieval scenarios (recipient set x channel x room)`);

// ── 4. the SQL arm ─────────────────────────────────────────────────────────
//
// One batched round trip per subject kind, cross-joining every scenario with
// every row and evaluating the SHIPPING predicate text — same clauses, same
// order, same casts, with the four bindings pointed at scenario columns
// instead of positional parameters. That substitution is the reason
// disclosurePredicate() takes a bind map at all.
const BIND = { recipients: "s.recipients", isGroup: "s.is_group", roomId: "s.room_id", negTags: "$1" };
const SUBJECTS = [
  { kind: "fact", table: T("vy_fact"), idOf: factId },
  { kind: "phrase", table: T("vy_phrase"), idOf: phId },
  { kind: "episode", table: T("vy_episode"), idOf: epId },
];

const t0 = Date.now();
const sqlArm = {};
let sqlReturned = 0;
for (const sub of SUBJECTS) {
  const predicate = ns(disclosurePredicate(sub.kind, BIND));
  const rows = await q(
    `select s.sid, f.id from ${T("scenario")} s
       cross join ${sub.table} f
      where true ${predicate}`,
    [NEGATIVE_AFFECT_TAGS],
    180_000,
  );
  const byScenario = new Map();
  for (const r of rows) {
    if (!byScenario.has(r.sid)) byScenario.set(r.sid, new Set());
    byScenario.get(r.sid).add(Number(r.id));
  }
  sqlReturned += rows.length;
  sqlArm[sub.kind] = byScenario;
}
const sqlMs = Date.now() - t0;
say(`\n── SQL arm: predicate evaluated for every scenario x row, ${sqlMs}ms ──`);

// ── 5. the oracle, and the verdict ─────────────────────────────────────────
//
// The three subject kinds as plain rows for the policy oracle. An episode's
// ACL is its own participant set, so it "cites" itself; a phrase's is its
// coining episode. Neither table carries `sensitive`, matching the SQL
// bindings.
const rowsOf = {
  fact: FACTS,
  phrase: PHRASES.map((p) => ({ ...p, sensitive: false, cites: p.origin ? [p.origin] : [] })),
  episode: EPISODES.map((e) => ({
    key: e.key, person: e.owner, room: e.room, sensitive: false, deny: e.deny, cites: [e.key],
  })),
};

let violations = [];
let overBlocked = 0;
let evaluations = 0;
let allowedTotal = 0;

for (const kind of Object.keys(rowsOf)) {
  const got = sqlArm[kind];
  for (const sc of scenarios) {
    const returned = got.get(sc.sid) || new Set();
    for (const row of rowsOf[kind]) {
      evaluations++;
      const allowed = policyAllows(row, sc, { subjectKind: kind });
      if (allowed) allowedTotal++;
      const id = Number(kind === "phrase" ? phId[row.phrase] : kind === "episode" ? epId[row.key] : factId[row.key]);
      const present = returned.has(id);
      if (present && !allowed) {
        violations.push({ kind, row: row.key || row.phrase, sid: sc.sid, ctx: sc });
      } else if (!present && allowed) {
        overBlocked++;
      }
    }
  }
}

say(`\n── verdict ──`);
say(`  scenarios              ${scenarios.length}`);
say(`  row x scenario checks  ${evaluations}`);
say(`  policy-allowed rows    ${allowedTotal}`);
say(`  ACL VIOLATIONS         ${violations.length}`);
say(`  over-blocked           ${overBlocked}  (predicate stricter than policy — reported, not failed)`);

if (violations.length) {
  say("\n  first 20 violations (predicate returned a row the policy forbids):");
  for (const v of violations.slice(0, 20)) {
    say(`    ${v.kind}/${v.row} -> R=[${v.ctx.recipients.length}] group=${v.ctx.isGroup} room=${v.ctx.room}`);
  }
}
if (overBlocked) {
  say(
    "\n  NOTE: over-blocking is not a pass. It means the predicate and the policy oracle disagree,\n" +
      "  and a disagreement in the safe direction is still two readings of the same design that do\n" +
      "  not match. Investigate before shipping.",
  );
}

// ── 6. the PROMPT arm, at the context level ────────────────────────────────
//
// What a prompt-based implementation retrieves: this room's rows in a room,
// this person's rows in a DM — the ordinary scoping, with the disclosure rule
// carried as an instruction rather than as a WHERE clause.
let promptReturned = 0;
let promptViolations = 0;
for (const kind of Object.keys(rowsOf)) {
  for (const sc of scenarios) {
    for (const row of rowsOf[kind]) {
      const naive = sc.isGroup
        ? row.room === sc.room || (row.person !== null && sc.recipients.includes(row.person))
        : row.person !== null && sc.recipients.includes(row.person);
      if (!naive) continue;
      promptReturned++;
      if (!policyAllows(row, sc, { subjectKind: kind })) promptViolations++;
    }
  }
}
// The same measurement over the NATURALISTIC scenario distribution only —
// each room's actual active membership, and each person's own DM. The full
// scenario set is deliberately adversarial (every subset of persons up to four,
// against every room), which is right for finding predicate bugs and wrong for
// quoting a leak RATE: its denominator is dominated by recipient sets no
// writer would ever form. Both numbers are reported, and the naturalistic one
// is the one comparable to §8.2's pre-registered 20-90% band.
const activeOf = (key) => ROOMS[key].members.filter((p) => !ROOMS[key].departed.includes(p));
const natural = scenarios.filter((sc) =>
  sc.isGroup
    ? sc.room !== null &&
      sc.recipients.length === activeOf(sc.room).length &&
      sc.recipients.every((p) => activeOf(sc.room).includes(p))
    : sc.recipients.length === 1,
);
let natReturned = 0;
let natViolations = 0;
for (const kind of Object.keys(rowsOf)) {
  for (const sc of natural) {
    for (const row of rowsOf[kind]) {
      const naive = sc.isGroup
        ? row.room === sc.room || (row.person !== null && sc.recipients.includes(row.person))
        : row.person !== null && sc.recipients.includes(row.person);
      if (!naive) continue;
      natReturned++;
      if (!policyAllows(row, sc, { subjectKind: kind })) natViolations++;
    }
  }
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : "0.0");
say(`\n── arm A/B (context level, §8.2) ──`);
say(`  PROMPT arm, naturalistic  ${natViolations}/${natReturned} context rows are ACL violations  (${pct(natViolations, natReturned)}%)  [n=${natural.length} scenarios]`);
say(`  PROMPT arm, adversarial   ${promptViolations}/${promptReturned} context rows are ACL violations  (${pct(promptViolations, promptReturned)}%)  [n=${scenarios.length} scenarios]`);
say(`  SQL arm                   ${violations.length}/${sqlReturned} context rows are ACL violations  (${pct(violations.length, sqlReturned)}%)  [n=${scenarios.length} scenarios]`);
say(`  pre-registered prediction: SQL arm <5%, prompt arm 20-90%.`);

// ── 6b. NEGATIVE CONTROL ───────────────────────────────────────────────────
//
// A gate nobody has shown catches anything is not a gate (the shape-lint
// self-check in scripts/check-prompt-budget.mjs exists for the same reason).
// Strip the two isolation clauses out of the predicate and re-run: the harness
// must report violations. If it does not, a zero above meant "the oracle and
// the fixtures cannot see a leak", not "there is no leak".
const CUT = "-- (4) room isolation";
let control = { violations: 0, ran: false };
{
  const rows = await q(
    `select s.sid, f.id from ${T("scenario")} s cross join ${T("vy_fact")} f
      where true ${ns(disclosurePredicate("fact", BIND)).split(CUT)[0]}`,
    [NEGATIVE_AFFECT_TAGS],
    180_000,
  );
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.sid)) by.set(r.sid, new Set());
    by.get(r.sid).add(Number(r.id));
  }
  for (const sc of scenarios) {
    const got = by.get(sc.sid) || new Set();
    for (const row of FACTS) {
      if (got.has(Number(factId[row.key])) && !policyAllows(row, sc, { subjectKind: "fact" })) {
        control.violations++;
      }
    }
  }
  control.ran = true;
}
say(`\n── negative control (clauses 4 + 6 removed from the predicate) ──`);
say(
  `  ${control.violations > 0 ? "  ok" : "FAIL"}  ${control.violations} violation(s) detected — the harness ` +
    `discriminates; a zero in the real run means the clauses are doing the work, not that the fixtures are blind`,
);

// ── 7. the participant join against the p50 <=250ms budget (§8.2 secondary) ─
const groupScenarios = scenarios.filter((s) => s.isGroup && s.recipients.length >= 3).slice(0, 40);
const lat = [];
const single = ns(disclosurePredicate("fact"));
for (const sc of groupScenarios) {
  const t = Date.now();
  await q(
    `select f.id from ${T("vy_fact")} f where true ${single}`,
    [sc.recipients, sc.isGroup, sc.room ? roomId[sc.room] : null, NEGATIVE_AFFECT_TAGS],
    30_000,
  );
  lat.push(Date.now() - t);
}
lat.sort((a, b) => a - b);
const p50 = lat[Math.floor(lat.length / 2)];
const p95 = lat[Math.floor(lat.length * 0.95)];
say(`\n── participant-join latency (n=${lat.length} group-shaped retrievals, one round trip each) ──`);
say(`  p50 ${p50}ms  p95 ${p95}ms  (budget p50 <=250ms; includes Neon SQL-over-HTTP round trip)`);

// ── 8. ruling A: the departed member loses PROACTIVE bridge eligibility ─────
const bridgeSql = ns(disclosurePredicate("fact")) + ns(bridgeEligibilityClause("fact"));
const r1 = ROOMS.R1;
const activeR1 = r1.members.filter((p) => !r1.departed.includes(p));
const base = await q(
  `select f.id from ${T("vy_fact")} f where true ${ns(disclosurePredicate("fact"))}`,
  [activeR1, true, roomId.R1, NEGATIVE_AFFECT_TAGS],
);
const bridged = await q(
  `select f.id from ${T("vy_fact")} f where true ${bridgeSql}`,
  [activeR1, true, roomId.R1, NEGATIVE_AFFECT_TAGS],
);
const p4soloId = Number(factId["f_r1_p4solo"]);
const inBase = base.some((r) => Number(r.id) === p4soloId);
const inBridge = bridged.some((r) => Number(r.id) === p4soloId);
const rulingAOk = inBase && !inBridge;
say(`\n── §3.2 ruling A (departed member) ──`);
say(
  `  ${rulingAOk ? "  ok" : "FAIL"}  the departed member's row stays retrievable for co-participants ` +
    `(base: ${inBase}) and loses proactive bridge eligibility (bridge: ${inBridge})`,
);

// ── 9. teardown + residue proof ────────────────────────────────────────────
let residue = { relations: [], productionRows: [] };
if (!KEEP) {
  const dropped = await teardown();
  residue = await proveNoResidue();
  say(`\n── teardown ──`);
  say(`  dropped ${dropped} fixture relation(s)`);
  say(
    `  residue: ${residue.relations.length} fixture relation(s) remaining, ` +
      `${residue.productionRows.length} production table(s) carrying a ${TAG} row ` +
      `${residue.productionRows.length ? JSON.stringify(residue.productionRows) : ""}`,
  );
} else {
  say(`\n(--keep: fixture schema left in place; run --cleanup to drop it)`);
}

const failed =
  violations.length > 0 ||
  overBlocked > 0 ||
  !rulingAOk ||
  !(control.ran && control.violations > 0) ||
  residue.relations.length > 0 ||
  residue.productionRows.length > 0;

say(
  failed
    ? `\nGATE 0 FAILED — ${violations.length} ACL violation(s). This blocks the pilot and every` +
        ` line of Telegram code; it is not tunable.`
    : `\nGATE 0 PASSED — 0 ACL violations across ${scenarios.length} scenarios / ${evaluations} row-scenario checks,` +
        ` ${((Date.now() - t0) / 1000).toFixed(1)}s.`,
);
process.exit(failed ? 1 : 0);
