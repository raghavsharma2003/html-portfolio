// Fixture harness for evals/multimodal/ (WS-MULTIMODAL, SPEC-SELF-LAYER §4).
// Real rows in the REAL tables, isolated by ROW IDENTITY — same approach as
// evals/wsdepth-fixtures.mjs and for the same reason: vy_episode,
// vy_visual_assertion and vy_shared_moment carry real user data, so a
// separate wsmpb_test_*-style namespace is unnecessary ceremony here.
// Isolation is by person_id/device_id, tracked and deleted by exact id in
// teardown() — "zero residue" is provable by counting rows for this
// person_id before and after, not by dropping a namespace.
//
// Content this suite writes (reactions, claims) is ALSO tagged with the
// MARKER prefix below, per the task's own naming convention — belt and
// braces on top of row-identity isolation, never a substitute for it
// (wsdepth-fixtures.mjs's own history: a content marker prefix once became
// the "genuine" thing under test, so identity isolation stays the real
// guarantee and the marker is only for greppability).
import { q } from "../../api/_db.js";

export const MARKER = "wsmm-test-";

export async function makeFixturePerson() {
  const [{ person_id }] = await q(`insert into vy_person default values returning person_id`);
  const deviceRows = await q(`select gen_random_uuid() as id`);
  const deviceId = deviceRows[0].id;
  await q(`insert into vy_person_device (device_id, person_id) values ($1,$2)`, [deviceId, person_id]);
  return { personId: person_id, deviceId };
}

/** Deletes every row this fixture could have created, by person_id, across
 *  every table WS-MULTIMODAL's writers touch. Returns per-table counts so a
 *  test can print/assert on them. */
export async function teardown(personId) {
  const counts = {};
  const del = async (label, sql) => {
    const rows = await q(sql, [personId]).catch(() => []);
    counts[label] = rows.length;
  };
  // shared_moment and visual_assertion also cascade off vy_episode's FK, but
  // deleting them explicitly first means a partial failure never leaves an
  // orphan hanging off an episode this loop is about to remove anyway.
  await del("vy_shared_moment", `delete from vy_shared_moment where person_id = $1 returning 1`);
  await del("vy_visual_assertion", `delete from vy_visual_assertion where person_id = $1 returning 1`);
  await del("vy_episode", `delete from vy_episode where person_id = $1 returning 1`);
  await del(
    "meera_log",
    `delete from meera_log where device_id in (select device_id from vy_person_device where person_id = $1) returning 1`,
  );
  await del("vy_person_device", `delete from vy_person_device where person_id = $1 returning 1`);
  await del("vy_person", `delete from vy_person where person_id = $1 returning 1`);
  return counts;
}

/** Asserts every table WS-MULTIMODAL touches is back to zero for this
 *  person_id — call AFTER teardown() to prove residue is actually zero, not
 *  just that deletes ran without erroring. */
export async function assertZeroResidue(personId) {
  const rows = await q(
    `select
       (select count(*) from vy_person where person_id = $1) +
       (select count(*) from vy_person_device where person_id = $1) +
       (select count(*) from vy_episode where person_id = $1) +
       (select count(*) from vy_visual_assertion where person_id = $1) +
       (select count(*) from vy_shared_moment where person_id = $1) +
       (select count(*) from meera_log where device_id in (select device_id from vy_person_device where person_id = $1))
       as n`,
    [personId],
  );
  return Number(rows[0]?.n ?? -1);
}

/** Minimal req/res mock for api/episodes.js's HTTP handler, matching what
 *  ipOf()/allow() need and nothing more — the handler's own rate limiter is
 *  exercised for real (in-memory bucket), not bypassed. */
export function mockReqRes(body) {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader() {},
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(v) {
      this.body = v;
      return this;
    },
    end() {
      return this;
    },
  };
  const req = { method: "POST", headers: {}, body };
  return { req, res };
}
