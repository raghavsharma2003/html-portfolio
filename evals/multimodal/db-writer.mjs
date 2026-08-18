// WS-MULTIMODAL — real-DB proofs against the REAL Postgres (same rationale
// as evals/mp/gate0.mjs and evals/wsdepth-test-roundtrip.mjs: FK cascades,
// column defaults and constraint checks are engine semantics, not
// JavaScript, and a JS re-model of them would pass this gate having tested
// a different thing). Exercises the actual exported writers and the actual
// HTTP handler in api/episodes.js — the same code useCallEngine.ts's
// postWatchMoment() calls over the wire.
//
// Proves:
//   1. the exact call useCallEngine.ts now makes (op:"watch_moment", no
//      assertionId) produces exactly one vy_shared_moment row, with
//      assertion_id null and agent_id defaulted — never a vy_visual_assertion
//      row, because nothing in this workstream's wiring ever calls that op.
//   2. the server-side writer is deliberately NOT idempotent on its own (no
//      unique constraint) — documented here so nobody mistakes that for a
//      bug. The actual "one write per wake" guarantee is entirely the
//      client's job and is proven separately in scene-gate.mjs.
//   3. no vy_fact row cites only a vy_visual_assertion, checked two ways:
//      against the fixture data actually written here, AND statically
//      across every api/*.js source file, so a future writer that tried to
//      add that path would fail this gate even before touching a database.
//   4. zero residue after teardown.
//
// node evals/multimodal/db-writer.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { q } from "../../api/_db.js";
import handler, { writeVisualAssertion, writeSharedMoment, openOrExtendEpisode } from "../../api/episodes.js";
import { MARKER, makeFixturePerson, teardown, assertZeroResidue, mockReqRes } from "./fixtures.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

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
  // ── 1. the exact HTTP call postWatchMoment() makes ──────────────────
  const reaction = `${MARKER}omg no way she actually did that`;
  const { req, res } = mockReqRes({ op: "watch_moment", device: deviceId, reaction });
  await handler(req, res);
  ok("watch_moment: handler responds 200", res.statusCode === 200, `status=${res.statusCode}`);
  ok("watch_moment: handler reports ok:true", res.body?.ok === true, JSON.stringify(res.body));
  const episodeId = res.body?.episode_id;
  ok("watch_moment: an episode id came back", Boolean(episodeId), JSON.stringify(res.body));

  const moments = await q(`select * from vy_shared_moment where person_id = $1`, [personId]);
  ok("exactly one vy_shared_moment row exists", moments.length === 1, `n=${moments.length}`);
  ok("the row's reaction is exactly what she said", moments[0]?.reaction === reaction, moments[0]?.reaction);
  ok("the row carries no assertion (this lane never invents one)", moments[0]?.assertion_id === null, String(moments[0]?.assertion_id));
  ok("the row is tied to the episode the handler opened", String(moments[0]?.episode_id) === String(episodeId));

  const episodeRows = await q(`select channel, provisional from vy_episode where id = $1`, [episodeId]);
  ok("the episode is on the watch channel", episodeRows[0]?.channel === "watch", JSON.stringify(episodeRows[0]));

  const assertionsAfterMoment = await q(`select * from vy_visual_assertion where person_id = $1`, [personId]);
  ok(
    "watch_moment alone never produces a vy_visual_assertion row",
    assertionsAfterMoment.length === 0,
    `n=${assertionsAfterMoment.length}`,
  );

  // ── 2. server-side writer is NOT idempotent — documented, not a bug ──
  const dupeId = await writeSharedMoment(personId, episodeId, { reaction: `${MARKER}same line twice` });
  ok("writeSharedMoment has no dedup key — a second call succeeds", Boolean(dupeId));
  const afterDupe = await q(`select count(*)::int as n from vy_shared_moment where person_id = $1`, [personId]);
  ok(
    "...and therefore DOES create a second row — idempotency is the CLIENT's job (see scene-gate.mjs), not this writer's",
    afterDupe[0]?.n === 2,
    `n=${afterDupe[0]?.n}`,
  );

  // ── 3a. even when a real vy_visual_assertion row exists, nothing
  //        promotes it into vy_fact — exercised against fixture data ──
  const assertionId = await writeVisualAssertion(personId, episodeId, {
    claim: `${MARKER}screen showed a cricket score`,
    extractorModel: "wsmm-test-model",
    confidence: 0.42,
    illegible: false,
  });
  ok("writeVisualAssertion (the existing, correct writer) still works when called directly", Boolean(assertionId));
  const factsCiting = await q(
    `select * from vy_fact where person_id = $1 and citations && array[$2]::bigint[]`,
    [personId, assertionId],
  );
  ok("no vy_fact row cites this assertion", factsCiting.length === 0, `n=${factsCiting.length}`);
  const factsForPerson = await q(`select count(*)::int as n from vy_fact where person_id = $1`, [personId]);
  ok("no vy_fact row exists for this fixture person at all", factsForPerson[0]?.n === 0, `n=${factsForPerson[0]?.n}`);

  // ── 3b. static check across the whole api/ tree: no vy_fact INSERT
  //        statement anywhere mentions a visual assertion in its own
  //        statement — a structural net against this regressing later ──
  const apiFiles = readdirSync(join(ROOT, "api")).filter((f) => f.endsWith(".js"));
  const offenders = [];
  for (const f of apiFiles) {
    const src = readFileSync(join(ROOT, "api", f), "utf8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      if (!/insert\s+into\s+["'`]?vy_fact/i.test(line)) return;
      // look at the statement itself: from this line to the next blank-ish
      // terminator or ~12 lines, whichever comes first — generous enough to
      // cover a multi-line `insert into vy_fact (...) values (...)`
      const window = lines.slice(i, i + 12).join("\n");
      if (/visual_assertion/i.test(window)) offenders.push(`${f}:${i + 1}`);
    });
  }
  ok(
    "no vy_fact INSERT statement in api/*.js references vy_visual_assertion",
    offenders.length === 0,
    JSON.stringify(offenders),
  );

  // ── openOrExtendEpisode sanity: watch_visual's op still works too (it is
  // simply never called by this workstream's client wiring) ──
  const ep2 = await openOrExtendEpisode(personId, deviceId, "watch");
  ok("openOrExtendEpisode extends the same open watch episode", ep2?.extended === true, JSON.stringify(ep2));
} finally {
  const counts = await teardown(personId);
  const residue = await assertZeroResidue(personId);
  console.log(`teardown: ${JSON.stringify(counts)}`);
  ok("zero residue after teardown", residue === 0, `residue=${residue}`);
}

console.log(failed ? `\nFAILED (${failed})` : "\nPASSED");
process.exit(failed ? 1 : 0);
