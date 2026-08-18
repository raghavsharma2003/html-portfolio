// wsdepth-test-llm-smoke — REAL extraction calls, on Azure credits, against
// the trust/repair and pattern-extraction prompts. Budget: exactly 2 calls
// (one eligible person per orchestrator), well under the ≤10 ceiling this
// workstream is scoped to. The gate this proves is narrow and stated
// honestly: the prompts return PARSEABLE JSON in the documented shape and,
// whatever the model judged, every WRITE that results still satisfies this
// file's own citation/shape discipline (writer-window validation, the
// >=2-citation pattern floor, the >=1-citation rel-event floor) — it does
// NOT assert the model always classifies conflict/repair/pattern correctly,
// since that is exactly the judgement call the whole design is conservative
// about ("ambiguous days write NOTHING" is a PASS, not a failure, here).
import { runTrustRepairDerivation, runPatternExtraction } from "../api/consolidate.js";
import { q } from "../api/_db.js";
import { makeFixturePerson, insertLogRow, insertEpisode, teardown, assertZeroResidue } from "./wsdepth-fixtures.mjs";

let failed = 0;
let calls = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
};

const day = (n) => new Date(Date.now() - n * 86_400_000);

// ── person A: trust/repair, one very unambiguous scenario ──
const personA = await makeFixturePerson();
console.log(`fixture person A (trust/repair) ${personA.personId}`);
let epA1, epA2;
try {
  epA1 = await insertEpisode(personA.personId, personA.deviceId, {
    logFrom: await insertLogRow(personA.deviceId, {
      content: "you promised you would not tell anyone and you told them anyway, I do not know if I can trust you the same way now",
      at: day(2),
    }),
    logTo: await insertLogRow(personA.deviceId, { content: "I am really hurt about this", at: day(2) }),
    startedAt: day(2),
    summary: "trust broken, a promise kept to someone else was broken",
    affect: [{ tag: "sad", intensity: 0.8 }],
  });
  epA2 = await insertEpisode(personA.personId, personA.deviceId, {
    logFrom: await insertLogRow(personA.deviceId, { content: "hey I just told my closest friend something I have never told anyone, not even my family", at: day(0) }),
    logTo: await insertLogRow(personA.deviceId, { content: "it felt good to finally say it out loud to someone", at: day(0) }),
    startedAt: day(0),
    summary: "shared a deeply private thing never told to anyone else",
    affect: [{ tag: "warm", intensity: 0.7 }],
  });

  const outA = await runTrustRepairDerivation({ onlyPerson: personA.personId });
  calls++;
  console.log("trust/repair result:", JSON.stringify(outA.reports?.[0]));
  ok("orchestrator returns ok:true", outA.ok === true, JSON.stringify(outA));
  ok("scanned both fixture episodes", outA.reports?.[0]?.episodes_scanned === 2, JSON.stringify(outA.reports));

  if (outA.trust_events_written > 0) {
    const rows = await q(`select dim, citations from vy_rel_event where person_id = $1 and dim = 'trust'`, [personA.personId]);
    ok("trust event has >=1 citation", rows[0]?.citations?.length >= 1, JSON.stringify(rows));
    const validIds = new Set([String(epA1), String(epA2)]);
    ok(
      "trust event cites only real fixture episodes (writer-window validation held)",
      rows.every((r) => r.citations.every((c) => validIds.has(String(c)))),
      JSON.stringify(rows),
    );
  } else {
    console.log("  --  trust: model reported no clear signal this pass (a valid, conservative outcome)");
  }
  if (outA.rupture_repair_events_written > 0) {
    const rows = await q(`select dim, citations from vy_rel_event where person_id = $1 and dim in ('rupture','repair')`, [personA.personId]);
    ok("rupture/repair event has >=1 citation", rows.every((r) => r.citations.length >= 1), JSON.stringify(rows));
  } else {
    console.log("  --  rupture/repair: model reported no clear signal this pass (a valid, conservative outcome)");
  }
} finally {
  const counts = await teardown(personA.personId);
  console.log("teardown A counts:", JSON.stringify(counts));
  ok("person A: zero residue", (await assertZeroResidue(personA.personId)) === 0);
}

// ── person B: pattern extraction, two repeats of a real regularity + noise ──
const personB = await makeFixturePerson();
console.log(`\nfixture person B (patterns) ${personB.personId}`);
const epB = [];
try {
  const specs = [
    { d: 20, content: "brutal day at work, boss was on my case, do not want to talk about it", summary: "rough workday, does not want to discuss it", affect: [{ tag: "stressed", intensity: 0.8 }] },
    { d: 20, content: "just send me something funny please, need to not think for a bit", summary: "asked for distraction, not questions, after stress" },
    { d: 12, content: "another awful shift, everything went wrong, I am so tired of this job", summary: "another rough workday, exhausted", affect: [{ tag: "stressed", intensity: 0.75 }] },
    { d: 12, content: "can we just talk about something stupid and fun, do not ask me about work", summary: "again asked for distraction, explicitly not questions", affect: [{ tag: "bored", intensity: 0.3 }] },
    { d: 6, content: "so excited, booked the goa trip for next month with everyone", summary: "excited about an upcoming trip", affect: [{ tag: "excited", intensity: 0.8 }] },
    { d: 1, content: "quiet evening, not much to report, just chilling", summary: "quiet uneventful evening" },
  ];
  for (const s of specs) {
    const from = await insertLogRow(personB.deviceId, { content: s.content, at: day(s.d) });
    epB.push(
      await insertEpisode(personB.personId, personB.deviceId, {
        logFrom: from,
        logTo: from,
        startedAt: day(s.d),
        summary: s.summary,
        affect: s.affect || [],
      }),
    );
  }

  const outB = await runPatternExtraction({ onlyPerson: personB.personId });
  calls++;
  console.log("pattern result:", JSON.stringify(outB.reports?.[0]));
  ok("orchestrator returns ok:true", outB.ok === true, JSON.stringify(outB));
  ok("scanned all 6 fixture episodes", outB.reports?.[0]?.episodes_scanned === 6, JSON.stringify(outB.reports));
  ok(`at most ${2} patterns written (nightly cap)`, outB.patterns_written <= 2, JSON.stringify(outB));

  if (outB.patterns_written > 0) {
    const rows = await q(
      `select moment, if_shape, then_note, citations, cardinality(citations) as n from vy_pattern where person_id = $1`,
      [personB.personId],
    );
    const validIds = new Set(epB.map(String));
    ok("every written pattern has >=2 citations (schema floor)", rows.every((r) => Number(r.n) >= 2), JSON.stringify(rows));
    ok(
      "every citation is a real fixture episode (writer-window validation held)",
      rows.every((r) => r.citations.every((c) => validIds.has(String(c)))),
      JSON.stringify(rows),
    );
    console.log("  --  written pattern(s):", JSON.stringify(rows.map((r) => ({ moment: r.moment, if_shape: r.if_shape, then_note: r.then_note }))));
  } else {
    console.log("  --  patterns: model proposed none this pass (a valid, expected-most-nights outcome)");
  }
} finally {
  const counts = await teardown(personB.personId);
  console.log("teardown B counts:", JSON.stringify(counts));
  ok("person B: zero residue", (await assertZeroResidue(personB.personId)) === 0);
}

console.log(`\nreal extraction calls made: ${calls} (budget: <=10)`);
console.log(failed ? `\n${failed} FAILURE(S)` : "\nall LLM-smoke checks passed");
process.exit(failed ? 1 : 0);
