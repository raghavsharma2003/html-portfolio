// WS-SELF-ARC's gate — vy_self_arc (docs/SPEC-SELF-LAYER.md §2, §9 G-S6).
//
//   node evals/self/arc.mjs             # pure gates + spy gates + LIVE db gate
//   node evals/self/arc.mjs --no-db     # pure + spy only (no NEON_URL needed)
//   node evals/self/arc.mjs --cleanup   # tear down fixture rows and exit
//
// NOT wired into evals/run.mjs, for the same reason evals/mp/gate0.mjs is not:
// every suite in that runner is db-free (it runs in build-apk.yml, which has
// no NEON_URL) and part C of this one is not. It runs the REAL deriver against
// the REAL Postgres, because the properties that matter here — a CHECK
// constraint that is actually applied, an `= any(citations)` join over a
// bigint[], a `participation` value nothing writes — are engine semantics,
// not JavaScript.
//
// WHAT THIS SUITE IS FOR, in one line each:
//
//   A  the pure gates      — the note gate, the dim classifier, the candidate
//                            builder, the renderer. No DB, no bundle of luck.
//   B  the spy gates       — the deriver with a recording QueryFn. This is
//                            where "NEVER ATTEMPTED" is proved: not "the DB
//                            rejected it", but "no INSERT statement was ever
//                            composed". G-S6's bar is exactly that difference.
//   C  the live gate       — seed, derive, assert, tear down, COUNT the
//                            residue. Also asserts the DB backstop is really
//                            applied, by trying to violate it on purpose.
//   D  the negative controls — the same batteries, run against artifacts that
//                            are illegal on purpose. A suite that has never
//                            failed has not been shown to be able to.
//
// Test data is prefixed `wsarc-test-` and lives under two fixture agent ids,
// so residue is greppable rather than trusted.

import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import {
  ARC_TAG, ARC_AGENT, ARC_OTHER_AGENT, ARC_PERSON, ARC_OTHER_PERSON,
  ARC_EPISODES, ARC_FACTS, ARC_EXPECT, ARC_BAD_NOTES, ARC_GOOD_NOTES,
  arcPureFacts, daysAgo,
} from "./_fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const NO_DB = process.argv.includes("--no-db");
const CLEANUP_ONLY = process.argv.includes("--cleanup");

// ── tiny assertion harness (house style: counts, not a framework) ──────────
let pass = 0;
const failures = [];
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const section = (s) => console.log(`\n── ${s} ──`);

// ── build the module from the REAL source (run.mjs's rule: rebuild every
//    run, never cache — a frozen bundle passes forever while the source rots)
const tmp = mkdtempSync(join(tmpdir(), "wsarc-"));
const entry = join(tmp, "entry.ts");
const bundle = join(tmp, "selfarc.bundle.mjs");
writeFileSync(entry, `export * from ${JSON.stringify(join(ROOT, "src/engine/selfarc.ts"))};\n`);
execSync(
  `npx esbuild ${entry} --bundle --format=esm --platform=node --outfile=${bundle} ` +
    `--log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const SA = await import(bundle);

// ══════════════════════════════════════════════════════════════════════════
// A — the pure gates
// ══════════════════════════════════════════════════════════════════════════
section("A. pure gates (no database)");

// A1 — the note gate: refuses every bad note, accepts every good one.
{
  let refused = 0;
  for (const bad of ARC_BAD_NOTES) {
    const r = SA.checkArcNote(bad.note);
    if (!r.ok) refused++;
    else console.log(`       (accepted a note it must refuse: ${JSON.stringify(bad.note)})`);
  }
  ok(`A1 note gate refuses ${ARC_BAD_NOTES.length}/${ARC_BAD_NOTES.length} illegal notes`,
     refused === ARC_BAD_NOTES.length, `refused ${refused}`);

  const accepted = ARC_GOOD_NOTES.filter((n) => SA.checkArcNote(n).ok).length;
  ok(`A1b note gate accepts ${ARC_GOOD_NOTES.length}/${ARC_GOOD_NOTES.length} legal notes (a gate that refuses everything is an outage)`,
     accepted === ARC_GOOD_NOTES.length, `accepted ${accepted}`);
}

// A2 — the dim classifier never guesses.
{
  const cases = [
    [`${ARC_TAG} upfront about rent split`, "directness"],
    [`${ARC_TAG} waits out a long pause`, "patience"],
    [`${ARC_TAG} teases about gym plans`, "humour"],
    [`${ARC_TAG} declines the late call`, "boundaries"],
    [`${ARC_TAG} confident about the studio move`, "confidence"],
    [`${ARC_TAG} went to the market`, null],
    [`${ARC_TAG} blunt and teases about it`, null], // tie -> never a guess
  ];
  const wrong = cases.filter(([t, want]) => SA.classifyDim(t) !== want);
  ok("A2 dim classifier: 7/7 including a tie that resolves to null", wrong.length === 0,
     wrong.map(([t]) => t).join(" | "));
}

// A3 — the candidate builder.
{
  const { candidates, refusals } = SA.buildCandidates(arcPureFacts());
  const top = candidates[0];
  ok("A3 exactly one dim is proposed first, and it is directness",
     !!top && top.dim === "directness", top ? top.dim : "no candidate");
  ok("A3b every candidate carries >=3 citations",
     candidates.every((c) => c.citations.length >= SA.MIN_CITATIONS),
     candidates.map((c) => `${c.dim}:${c.citations.length}`).join(","));
  ok("A3c every candidate spans >=42 days",
     candidates.every((c) => c.span_days >= SA.MIN_SPAN_DAYS),
     candidates.map((c) => `${c.dim}:${c.span_days}`).join(","));
  ok("A3d every candidate note AND from_note is shape-lint clean",
     candidates.every((c) => SA.checkArcNote(c.note).ok && SA.checkArcNote(c.from_note).ok));
  ok("A3e patience is refused for SPAN, by name",
     refusals.some((r) => /^patience: span .* not attempted$/.test(r)),
     refusals.join(" / "));
  ok("A3f humour is refused for CITATIONS, by name",
     refusals.some((r) => /^humour: \d+ distinct citations/.test(r)));
  ok("A3g the affect note, the narration note and the sentence-shaped note are all refused at the note gate",
     ["9", "10", "11"].every((id) => refusals.some((r) => r.startsWith(`fact ${id} `))),
     refusals.filter((r) => r.startsWith("fact ")).join(" / "));
  console.log(`       candidates: ${candidates.map((c) => `${c.dim}(${c.citations.length} cites/${c.span_days}d)`).join(", ")}`);
}

// A4 — the renderer: budget, one row, moment gate.
{
  const rows = [
    { id: 1, agent_id: ARC_AGENT, dim: "directness", note: `${ARC_TAG} upfront about rent split`,
      from_note: `${ARC_TAG} hedges the ask`, citations: [1, 2, 3, 4], span_days: 170,
      superseded_by: null, created_at: daysAgo(1) },
    { id: 2, agent_id: ARC_AGENT, dim: "confidence", note: `${ARC_TAG} confident about the studio move`,
      from_note: `${ARC_TAG} hesitates naming a price`, citations: [5, 6, 7], span_days: 140,
      superseded_by: null, created_at: daysAgo(2) },
    { id: 3, agent_id: ARC_AGENT, dim: "humour", note: `${ARC_TAG} teases about gym plans`,
      from_note: `${ARC_TAG} deadpan only with close ones`, citations: [8, 9, 10], span_days: 100,
      superseded_by: 99, created_at: daysAgo(3) },
  ];

  ok("A4 moment 'none' renders nothing", SA.renderSelfArc(rows, "none").text === "");
  ok("A4b an irrelevant moment renders nothing (silence is deliberately in no dim's set)",
     SA.renderSelfArc(rows, "silence").text === "");

  const r = SA.renderSelfArc(rows, "conflict");
  const bodyLines = r.text.split("\n").filter((l) => l.startsWith("- "));
  ok("A4c a relevant moment renders exactly ONE row", bodyLines.length <= 2 && new Set(bodyLines.map((l) => l.slice(2).split(" ")[0])).size === 1,
     JSON.stringify(bodyLines));
  ok("A4d the rendered row is the moment-matching one (directness), never the superseded one",
     /^- directness now:/.test(bodyLines[0] || ""), bodyLines[0]);
  ok("A4e render is within the 500-char budget", r.text.length <= SA.SELF_ARC_BUDGET, `${r.text.length} chars`);
  ok("A4f render is shape-lint clean", r.lint.clean && r.lint.violations === 0, JSON.stringify(r.lint));
  ok("A4g the span renders as a coarse band, never a number",
     !/\b\d+(\.\d+)?\s*(d|days)\b/.test(r.text) && /\((6w|3m|6m|1y)\+\)/.test(r.text), r.text);
  ok("A4h a superseded row is never rendered",
     SA.renderSelfArc([rows[2]], "teasing").text === "");
  ok("A4i the header carries the do-not-narrate instruction",
     /never narrate/i.test(r.text) && /never raise it yourself/i.test(r.text));
  console.log(`       T12 render (${r.text.length}/${SA.SELF_ARC_BUDGET} chars):\n${r.text.split("\n").map((l) => "         " + l).join("\n")}`);
}

// A5 — SHE MUST NEVER NARRATE HER OWN GROWTH. §11's reversal condition,
//      built as a detector rather than a promise: scan the rendered BODY
//      lines (not the instructional header) for self-narration shapes.
const NARRATION_RE =
  /\b(i (have|had|'ve) (become|changed|grown)|i used to|these days i|main (ab|pehle)|ab main|maine badal|becoming more|i am more .* than i used to be)\b/i;
{
  const rows = [{
    id: 1, agent_id: ARC_AGENT, dim: "directness", note: `${ARC_TAG} upfront about rent split`,
    from_note: `${ARC_TAG} hedges the ask`, citations: [1, 2, 3], span_days: 90,
    superseded_by: null, created_at: daysAgo(1),
  }];
  const moments = ["conflict", "vulnerable", "silence", "teasing", "stress", "planning", "celebration", "boredom", "none"];
  let narrating = 0;
  for (const m of moments) {
    for (const line of SA.renderSelfArc(rows, m).text.split("\n").filter((l) => l.startsWith("- "))) {
      if (NARRATION_RE.test(line)) narrating++;
    }
  }
  ok(`A5 0 self-narrating lines across all ${moments.length} moment shapes`, narrating === 0, `${narrating} hits`);
}

// A6 — G1 input starvation, asserted STRUCTURALLY over the shipped SQL and
//      the shipped source, not reviewed by eye (G-S4's own wording).
const USAGE_COLUMNS = [
  "ended_at", "log_from", "log_to", "recall_count", "last_recalled",
  "affect_tags", "importance", "boundary_salience", "pacing_gap_s",
  "meera_log", "last_seen", "updated_at", "gap", "latency", "session",
];
{
  const sqlHits = USAGE_COLUMNS.filter((c) => SA.EVIDENCE_SQL.includes(c));
  ok("A6 the evidence query names ZERO usage/timing columns", sqlHits.length === 0, sqlHits.join(","));

  const src = readFileSync(join(ROOT, "src/engine/selfarc.ts"), "utf8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
  const codeHits = USAGE_COLUMNS.filter((c) => new RegExp(`\\b${c}\\b`).test(code));
  ok("A6b no usage/timing column appears anywhere in the module's CODE (comments excluded)",
     codeHits.length === 0, codeHits.join(","));
  ok("A6c the module imports nothing from api/ (client bundle law + no secrets)",
     !/from\s+["'][^"']*api\//.test(code));
  ok("A6d the evidence query reads kind='meera' facts and excludes participation='meera' episodes",
     SA.EVIDENCE_SQL.includes("f.kind = 'meera'") && SA.EVIDENCE_SQL.includes("e.participation <> 'meera'"));
}

// ══════════════════════════════════════════════════════════════════════════
// B — the spy gates: NEVER ATTEMPTED, proved at the statement level
// ══════════════════════════════════════════════════════════════════════════
section("B. spy gates (recording QueryFn, no database)");

function spyQ(evidence, { current = [] } = {}) {
  const calls = [];
  const q = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/from vy_fact f/.test(sql)) return evidence;
    if (/select id, note\s+from vy_self_arc/.test(sql)) return current;
    if (/insert into vy_self_arc/.test(sql)) {
      return [{
        id: 4242, agent_id: params[0], dim: params[1], note: params[2], from_note: params[3],
        citations: params[4], span_days: params[5], superseded_by: null,
        created_at: new Date().toISOString(),
      }];
    }
    return [];
  };
  return { q, calls };
}
const inserts = (calls) => calls.filter((c) => /insert into vy_self_arc/i.test(c.sql));

// B1 — a sub-42-day evidence set. The row must not be ATTEMPTED.
{
  const shortOnly = arcPureFacts().filter((f) => [5, 6].includes(f.fact_id)); // patience, 15d
  const { q, calls } = spyQ(shortOnly);
  const res = await SA.deriveSelfArc(q, ARC_AGENT);
  ok("B1 a 15-day evidence trail composes NO insert statement (not 'rejected by the DB' — never attempted)",
     inserts(calls).length === 0 && res.attemptedInsert === false, `${inserts(calls).length} inserts`);
  ok("B1b and it says which law stopped it",
     res.refusals.some((r) => /span .* need >=42d — not attempted/.test(r)), res.refusals.join(" / "));
}

// B1c — a 2-citation evidence set, same bar.
{
  const fewCites = arcPureFacts().filter((f) => [7, 8].includes(f.fact_id)); // humour, 2 cites
  const { q, calls } = spyQ(fewCites);
  const res = await SA.deriveSelfArc(q, ARC_AGENT);
  ok("B1c a 2-citation trail composes NO insert statement",
     inserts(calls).length === 0 && res.written === null);
  ok("B1d and it says so", res.refusals.some((r) => /distinct citations, need >=3/.test(r)));
}

// B2 — the legal set: exactly one insert, with legal parameters.
{
  const { q, calls } = spyQ(arcPureFacts());
  const res = await SA.deriveSelfArc(q, ARC_AGENT);
  const ins = inserts(calls);
  ok("B2 exactly ONE insert statement per run", ins.length === 1, `${ins.length}`);
  ok("B2b the inserted row is directness, >=3 citations, >=42 days",
     res.written && res.written.dim === "directness" &&
     res.written.citations.length >= 3 && res.written.span_days >= 42,
     JSON.stringify(res.written && { dim: res.written.dim, c: res.written.citations.length, s: res.written.span_days }));
  ok("B2c the previous row on that dim is superseded, never deleted",
     calls.some((c) => /update vy_self_arc set superseded_by/.test(c.sql)) &&
     !calls.some((c) => /delete from vy_self_arc/i.test(c.sql)));
  ok("B2d the runner-up (confidence) is reported, never written",
     res.alsoRan.length === 1 && res.alsoRan[0].dim === "confidence",
     JSON.stringify(res.alsoRan.map((c) => c.dim)));
}

// B3 — idempotence: a second run the same night writes nothing.
{
  const { q, calls } = spyQ(arcPureFacts(), {
    current: [{ id: 7, note: `${ARC_TAG} upfront about rent split` }],
  });
  const res = await SA.deriveSelfArc(q, ARC_AGENT);
  ok("B3 an already-current row is not re-written (no churned created_at)",
     inserts(calls).length === 0 && res.refusals.some((r) => /already current/.test(r)));
}

// B4 — strictness at the boundary.
{
  let threw = 0;
  try { await SA.deriveSelfArc(spyQ([]).q, ""); } catch { threw++; }
  try { await SA.deriveSelfArc(spyQ([]).q, ARC_AGENT, { lookbackDays: 30 }); } catch { threw++; }
  ok("B4 missing agentId and a sub-42-day lookback both throw (strict from birth)", threw === 2, `${threw}/2`);
}

// B5 — dryRun proposes without writing.
{
  const { q, calls } = spyQ(arcPureFacts());
  const res = await SA.deriveSelfArc(q, ARC_AGENT, { dryRun: true });
  ok("B5 dryRun produces a candidate and composes no insert",
     res.candidate && res.candidate.dim === "directness" && inserts(calls).length === 0);
}

// ══════════════════════════════════════════════════════════════════════════
// D — negative controls (run BEFORE the live gate so a broken battery never
//     reaches the database). A suite that has never failed has not been
//     shown to be able to.
// ══════════════════════════════════════════════════════════════════════════

/** The battery the live gate applies to whatever was written. Returns the
 *  violations it found — so it can be pointed at a legal row (expect 0) and
 *  at an illegal one (expect >0), which is the whole negative control. */
function battery(row) {
  const v = [];
  if (!row) return ["no row"];
  if (!(row.span_days >= SA.MIN_SPAN_DAYS)) v.push(`span_days ${row.span_days} < ${SA.MIN_SPAN_DAYS}`);
  if (!row.citations || row.citations.length < SA.MIN_CITATIONS) v.push(`citations ${row.citations?.length}`);
  const n = SA.checkArcNote(row.note);
  if (!n.ok) v.push(`note: ${n.reasons.join(";")}`);
  if (row.from_note) {
    const f = SA.checkArcNote(row.from_note);
    if (!f.ok) v.push(`from_note: ${f.reasons.join(";")}`);
  }
  const rendered = SA.renderSelfArc([row], "conflict");
  if (rendered.text.length > SA.SELF_ARC_BUDGET) v.push(`render ${rendered.text.length} > ${SA.SELF_ARC_BUDGET}`);
  if (!rendered.lint.clean) v.push(`render lint ${rendered.lint.violations}`);
  for (const line of rendered.text.split("\n").filter((l) => l.startsWith("- "))) {
    if (NARRATION_RE.test(line)) v.push(`self-narration: ${line}`);
  }
  return v;
}

section("D. negative controls — the battery must FAIL on illegal artifacts");
{
  const legal = {
    id: 1, agent_id: ARC_AGENT, dim: "directness", note: `${ARC_TAG} upfront about rent split`,
    from_note: `${ARC_TAG} hedges the ask`, citations: [1, 2, 3], span_days: 90,
    superseded_by: null, created_at: daysAgo(1),
  };
  ok("D0 the battery passes a legal row (control for the controls)", battery(legal).length === 0,
     battery(legal).join(" | "));

  const controls = [
    ["D1 span_days=20", { ...legal, span_days: 20 }, /span_days 20/],
    ["D2 two citations", { ...legal, citations: [1, 2] }, /citations 2/],
    ["D3 affect-shaped note", { ...legal, note: `${ARC_TAG} patient but tired of it` }, /affect-shaped/],
    ["D4 self-narrating note", { ...legal, note: `i have become more direct` }, /note:|self-narration/],
    ["D5 over-budget note", { ...legal, note: `${ARC_TAG} ` + "x".repeat(600) }, /note:/],
  ];
  for (const [name, row, want] of controls) {
    const v = battery(row);
    ok(`${name} is caught`, v.length > 0 && v.some((s) => want.test(s)), v.join(" | ") || "battery found nothing");
  }

  // D6 — the negative control that matters most: a DELIBERATELY BROKEN
  // deriver, one with the span law removed, run through the same pipeline.
  // Implemented HERE and not as a flag on the shipping deriver, because a
  // law you can switch off from a caller is not a law.
  function brokenBuildCandidates(facts) {
    const byDim = new Map();
    for (const f of facts) {
      const dim = SA.classifyDim(f.body);
      if (!dim) continue;
      byDim.set(dim, [...(byDim.get(dim) ?? []), f]);
    }
    const out = [];
    for (const [dim, rows] of byDim) {
      if (rows.length < 2) continue;
      const times = rows.flatMap((f) => [new Date(f.first_at).getTime(), new Date(f.last_at).getTime()]);
      out.push({
        dim,
        note: rows[rows.length - 1].body,
        from_note: rows[0].body,
        citations: [...new Set(rows.flatMap((f) => f.episode_ids))],
        span_days: (Math.max(...times) - Math.min(...times)) / 86_400_000, // no >=42 gate
      });
    }
    return out;
  }
  const shortSet = arcPureFacts().filter((f) => [5, 6].includes(f.fact_id)); // patience, 15d
  const brokenCands = brokenBuildCandidates(shortSet);
  ok("D6 the broken deriver does produce an illegal candidate (control is live)",
     brokenCands.length === 1 && brokenCands[0].span_days < 42, JSON.stringify(brokenCands));
  ok("D6b assertArcLegal REFUSES it — the same call that guards the real insert",
     (() => { try { SA.assertArcLegal(brokenCands[0]); return false; } catch { return true; } })());
  ok("D6c the real builder refuses the identical input (the two disagree only about the law)",
     SA.buildCandidates(shortSet).candidates.length === 0);
}

// ══════════════════════════════════════════════════════════════════════════
// C — the live gate
// ══════════════════════════════════════════════════════════════════════════

const FIXTURE_AGENTS = [ARC_AGENT, ARC_OTHER_AGENT];

async function teardown(q) {
  let n = 0;
  for (const sql of [
    `delete from vy_self_arc where agent_id = any(($1)::uuid[])`,
    `delete from vy_fact where agent_id = any(($1)::uuid[])`,
    `delete from vy_episode where agent_id = any(($1)::uuid[])`,
  ]) {
    await q(sql, [FIXTURE_AGENTS]);
    n++;
  }
  // belt: anything carrying the text prefix, whatever agent it ended up under
  await q(`delete from vy_self_arc where note like $1 or from_note like $1`, [`${ARC_TAG}%`]);
  await q(`delete from vy_fact where body like $1`, [`${ARC_TAG}%`]);
  await q(`delete from vy_episode where summary like $1`, [`${ARC_TAG}%`]);
  return n;
}

async function residue(q) {
  const rows = await q(
    `select
       (select count(*) from vy_self_arc where agent_id = any(($1)::uuid[]) or note like $2 or from_note like $2)::int as arcs,
       (select count(*) from vy_fact     where agent_id = any(($1)::uuid[]) or body like $2)::int as facts,
       (select count(*) from vy_episode  where agent_id = any(($1)::uuid[]) or summary like $2)::int as episodes`,
    [FIXTURE_AGENTS, `${ARC_TAG}%`],
  );
  const r = rows[0] || {};
  return { arcs: Number(r.arcs ?? -1), facts: Number(r.facts ?? -1), episodes: Number(r.episodes ?? -1) };
}

if (CLEANUP_ONLY || !NO_DB) {
  const { q } = await import(join(ROOT, "api/_db.js"));

  if (CLEANUP_ONLY) {
    await teardown(q);
    console.log(`residue after cleanup: ${JSON.stringify(await residue(q))}`);
    rmSync(tmp, { recursive: true, force: true });
    process.exit(0);
  }

  section("C. live gate (real Postgres, real constraints)");
  await teardown(q);

  // seed episodes
  const epId = new Map();
  for (const e of ARC_EPISODES) {
    const rows = await q(
      `insert into vy_episode (agent_id, person_id, channel, participation, started_at, ended_at,
                               boundary_reason, summary)
       values (($1)::uuid,($2)::uuid,'chat',$3,($4)::timestamptz,($4)::timestamptz,'gap',$5)
       returning id`,
      [e.agent, e.person, e.participation, daysAgo(e.day), `${ARC_TAG}episode ${e.key}`],
    );
    epId.set(e.key, Number(rows[0].id));
  }
  // seed her self-facts
  for (const f of ARC_FACTS) {
    await q(
      `insert into vy_fact (agent_id, person_id, kind, name, body, provenance, citations)
       values (($1)::uuid,($2)::uuid,'meera',$3,$4,'extracted',($5)::bigint[])`,
      [f.agent, f.person, `${ARC_TAG}self`, f.body, f.cites.map((k) => epId.get(k))],
    );
  }
  console.log(`       seeded ${ARC_EPISODES.length} episodes, ${ARC_FACTS.length} self-facts`);

  // C1 — the DB backstop is really applied (it must never have to fire, so
  //      prove it exists by violating it on purpose, once, in both directions)
  {
    let rejected = 0;
    for (const [span, cites] of [[20, [1, 2, 3]], [90, [1, 2]]]) {
      try {
        await q(
          `insert into vy_self_arc (agent_id, dim, note, citations, span_days)
           values (($1)::uuid,'directness',$2,($3)::bigint[],$4)`,
          [ARC_AGENT, `${ARC_TAG}constraint probe`, cites, span],
        );
      } catch { rejected++; }
    }
    ok("C1 the live CHECK constraints reject span<42 and citations<3 (backstop confirmed present)",
       rejected === 2, `${rejected}/2 rejected`);
  }

  // C2 — the real deriver, against the real database.
  const res = await SA.deriveSelfArc(q, ARC_AGENT);
  ok("C2 exactly one row written", !!res.written && res.attemptedInsert === true,
     JSON.stringify(res.refusals));
  ok("C2b it is the dim the fixture declared", res.written?.dim === ARC_EXPECT.writes.dim, res.written?.dim);
  ok("C2c note and from_note are HER OWN fact bodies, verbatim (G6: every word is hers)",
     res.written?.note === ARC_EXPECT.writes.note && res.written?.from_note === ARC_EXPECT.writes.from_note,
     `${res.written?.from_note} -> ${res.written?.note}`);
  ok("C2d citations are the 4 real episode ids the two facts cite",
     JSON.stringify(res.written?.citations) ===
       JSON.stringify(ARC_EXPECT.writes.citations.map((k) => epId.get(k)).sort((a, b) => a - b)),
     JSON.stringify(res.written?.citations));
  ok("C2e span_days >= 42", (res.written?.span_days ?? 0) >= 42, String(res.written?.span_days));
  ok("C2f the battery passes the written row", battery(res.written).length === 0, battery(res.written).join(" | "));
  ok("C2g humour stayed refused — the participation='meera' episode was NOT counted",
     res.refusals.some((r) => /^humour: 2 distinct citations/.test(r)), res.refusals.join(" / "));
  ok("C2h patience stayed refused for span, and no insert was attempted for it",
     res.refusals.some((r) => /^patience: span/.test(r)));

  // C3 — agent scoping: the other agent's richer evidence was not written.
  {
    const rows = await q(`select count(*)::int as n from vy_self_arc where agent_id = ($1)::uuid`, [ARC_OTHER_AGENT]);
    ok("C3 the other agent's (richer) evidence produced no row under our run",
       Number(rows[0].n) === 0, JSON.stringify(rows[0]));
    const all = await q(`select count(*)::int as n from vy_self_arc where agent_id = ($1)::uuid`, [ARC_AGENT]);
    ok("C3b exactly one arc row exists for the fixture agent", Number(all[0].n) === 1, JSON.stringify(all[0]));
  }

  // C4 — idempotence against the real table.
  {
    const again = await SA.deriveSelfArc(q, ARC_AGENT);
    const all = await q(`select count(*)::int as n from vy_self_arc where agent_id = ($1)::uuid`, [ARC_AGENT]);
    ok("C4 a second run writes nothing and leaves one row",
       again.written === null && Number(all[0].n) === 1, JSON.stringify({ n: all[0].n, refusals: again.refusals }));
  }

  // C5 — the read path the compiler will use.
  {
    const rows = await SA.loadCurrentArcs(q, ARC_AGENT);
    const r = SA.renderSelfArc(rows, "conflict");
    ok("C5 loadCurrentArcs -> renderSelfArc round-trips within budget and lint-clean",
       rows.length === 1 && r.text.length > 0 && r.text.length <= SA.SELF_ARC_BUDGET && r.lint.clean,
       `${rows.length} rows, ${r.text.length} chars`);
    console.log(`       live T12 (${r.text.length}/${SA.SELF_ARC_BUDGET} chars):\n${r.text.split("\n").map((l) => "         " + l).join("\n")}`);
  }

  // C6 — teardown and a LIVE COUNT. Residue is proved, never assumed.
  await teardown(q);
  const left = await residue(q);
  ok("C6 zero residue after teardown (live count)",
     left.arcs === 0 && left.facts === 0 && left.episodes === 0, JSON.stringify(left));
  console.log(`       residue: ${JSON.stringify(left)}`);
} else {
  section("C. live gate SKIPPED (--no-db)");
}

rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
