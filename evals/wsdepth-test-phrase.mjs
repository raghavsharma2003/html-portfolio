// wsdepth-test-phrase — phrase capture (deterministic, no LLM) against a
// real fixture person. Proves the true-positive case (a genuine recurring
// 2-5 word phrase, >=3 distinct days) AND the false-positive rejections the
// mandate calls out by name: a common/stoplisted phrase, a too-short
// recurrence (<3 days), and an all-stopword n-gram. Live DB writes, scoped
// to one fixture person_id, zero-residue proven at the end.
import { runPhraseCapture } from "../api/consolidate.js";
import { q } from "../api/_db.js";
import { makeFixturePerson, insertLogRow, insertEpisode, teardown, assertZeroResidue } from "./wsdepth-fixtures.mjs";

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
};

const { personId, deviceId } = await makeFixturePerson();
console.log(`fixture person ${personId}`);

try {
  // A genuine distinctive phrase, said on 4 distinct days — should be captured.
  const GENUINE = "chai pe scene set karo";
  // A common phrase from the measured corpus stoplist — must NEVER be captured.
  const COMMON = "photo bhejo na apni";
  // A short, all-stopword n-gram — must never even be considered a candidate
  // ("kuch" and "bhi" are both in RECALL_STOP).
  const ALL_STOP = "kuch bhi";

  const days = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13"];
  let lastId = 0;
  for (const [i, day] of days.entries()) {
    const at = new Date(`${day}T10:00:00Z`);
    const from = await insertLogRow(deviceId, { content: GENUINE, at });
    await insertLogRow(deviceId, { content: COMMON, at: new Date(`${day}T10:05:00Z`) });
    if (i < 2) await insertLogRow(deviceId, { content: ALL_STOP, at: new Date(`${day}T10:10:00Z`) });
    const to = from + (i < 2 ? 2 : 1);
    await insertEpisode(personId, deviceId, {
      logFrom: from,
      logTo: to,
      startedAt: at,
      summary: `talked about plans day ${i}`,
    });
    lastId = to;
  }
  void lastId;

  const out = await runPhraseCapture({ dryRun: false, onlyPerson: personId });
  ok("orchestrator returns ok:true", out.ok === true, JSON.stringify(out));
  ok("exactly 1 phrase written (cap enforced)", out.phrases_written === 1, JSON.stringify(out));

  const rows = await q(`select phrase, origin_episode from vy_phrase where person_id = $1`, [personId]);
  ok("exactly 1 vy_phrase row exists", rows.length === 1, JSON.stringify(rows));
  ok(
    `the genuine phrase was captured, not the common one (got ${JSON.stringify(rows.map((r) => r.phrase))})`,
    rows.length === 1 && rows[0].phrase.includes("chai pe scene set karo"),
  );
  ok(
    "the common (stoplisted) phrase was never written",
    !rows.some((r) => r.phrase.includes(COMMON)),
  );
  ok(
    "the all-stopword n-gram was never written",
    !rows.some((r) => r.phrase.includes(ALL_STOP)),
  );
  ok(
    "origin_episode is a real, citable episode id",
    rows.length === 1 && Number.isInteger(Number(rows[0].origin_episode)),
  );

  // Re-run: the phrase already exists, must not be re-proposed or duplicated
  // (unique index + the existingPhrases in-memory filter both guard this).
  const again = await runPhraseCapture({ dryRun: false, onlyPerson: personId });
  ok("re-run writes nothing new (existing phrase excluded)", again.phrases_written === 0, JSON.stringify(again));
  const rows2 = await q(`select count(*)::int n from vy_phrase where person_id = $1`, [personId]);
  ok("still exactly 1 phrase row after re-run", Number(rows2[0].n) === 1);
} finally {
  const counts = await teardown(personId);
  console.log("teardown counts:", JSON.stringify(counts));
  const residue = await assertZeroResidue(personId);
  ok("zero residue after teardown", residue === 0, `residue=${residue}`);
}

console.log(failed ? `\n${failed} FAILURE(S)` : "\nall phrase-capture checks passed");
process.exit(failed ? 1 : 0);
