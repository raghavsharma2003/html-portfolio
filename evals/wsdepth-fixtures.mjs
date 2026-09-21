// Shared fixture harness for the wsdepth-test-*.mjs suites (WS-DEPTH).
//
// Builds real rows in the REAL tables (vy_person, vy_person_device,
// meera_log, vy_episode) rather than a separate schema/namespace — unlike
// evals/mp/'s wsmpb_test_* fixture tables (which exist because migration
// 008 was not yet applied when that harness was built), the tables this
// suite needs are live and already carry real user data, so isolation here
// is by ROW IDENTITY: every fixture creates its own vy_person row and only
// ever touches rows scoped to that person_id, tracked and deleted by exact
// id in teardown() — "zero residue" is provable by counting rows for this
// person_id before and after, not by dropping a namespace.
import { q } from "../api/_db.js";

// Meera's agent id — mirrored, asserted by scripts/verify-agent-id.mjs.
// Migration 010 dropped the transitional column defaults, so every writer
// into an agent-scoped table must name it explicitly or fail loudly.
const MEERA_AGENT_ID = "a0000000-0000-4000-8000-000000000001";


const MARKER = "wsdepth-test";

export async function makeFixturePerson() {
  const [{ person_id }] = await q(`insert into vy_person default values returning person_id`);
  const deviceRows = await q(`select gen_random_uuid() as id`);
  const deviceId = deviceRows[0].id;
  await q(`insert into vy_person_device (device_id, person_id) values ($1,$2)`, [deviceId, person_id]);
  return { personId: person_id, deviceId };
}

/** Inserts one meera_log row (role 'me' = the user, matching this repo's
 *  own convention — see api/consolidate.js's GAP-5 comment) and returns its
 *  id, so a caller can build vy_episode.log_from/log_to spans over real rows.
 *  Content is stored VERBATIM, with no marker prefix — the phrase-capture
 *  writer under test scans this exact text for n-grams, so decorating it
 *  would corrupt the thing being measured (found live: an earlier version
 *  prefixed "wsdepth-test: " here and that prefix itself became the
 *  "genuine" captured phrase). Isolation is by device_id/person_id, not by
 *  a content marker — see teardown()/assertZeroResidue(). */
export async function insertLogRow(deviceId, { content, at, role = "me" }) {
  const [{ id }] = await q(
    `insert into meera_log (device_id, role, channel, kind, content, at, agent_id) values ($1,$2,'chat','text',$3,$4,($5)::uuid) returning id`,
    [deviceId, role, content, at.toISOString(), MEERA_AGENT_ID],
  );
  return id;
}

/** Inserts one FINAL (non-provisional) episode citing a real log span,
 *  marking every log row in that span with episode_id (mirrors what
 *  finalizePerson itself does). */
export async function insertEpisode(personId, deviceId, { logFrom, logTo, startedAt, summary, affect = [], importance = 1.0 }) {
  const [{ id }] = await q(
    `insert into vy_episode (person_id, agent_id, device_id, channel, participation, started_at, ended_at,
       boundary_reason, log_from, log_to, summary, affect_tags, importance, provisional)
     values ($1,($9)::uuid,$2,'chat','user',$3,$3,'topic',$4,$5,$6,$7::jsonb,$8,false)
     returning id`,
    [personId, deviceId, startedAt.toISOString(), logFrom, logTo, `${MARKER}: ${summary}`, JSON.stringify(affect), importance, MEERA_AGENT_ID],
  );
  await q(`update meera_log set episode_id = $1 where device_id = $2 and id between $3 and $4 and agent_id = ($5)::uuid`, [id, deviceId, logFrom, logTo, MEERA_AGENT_ID]);
  return id;
}

/** Deletes every row this fixture could have created, by person_id, across
 *  every table the WS-DEPTH writers touch — the zero-residue proof. Returns
 *  the count deleted from each table so a test can print/assert on it. */
export async function teardown(personId) {
  const counts = {};
  const del = async (label, sql) => {
    const rows = await q(sql, [personId]).catch(() => []);
    counts[label] = rows.length;
  };
  await del("vy_derivation", `delete from vy_derivation where person_id = $1 returning 1`);
  await del("vy_rel_event", `delete from vy_rel_event where person_id = $1 returning 1`);
  await del("vy_rel_state", `delete from vy_rel_state where person_id = $1 returning 1`);
  await del("vy_pattern", `delete from vy_pattern where person_id = $1 returning 1`);
  await del("vy_phrase", `delete from vy_phrase where person_id = $1 returning 1`);
  await del("vy_episode", `delete from vy_episode where person_id = $1 returning 1`);
  await del(
    "meera_log",
    `delete from meera_log where device_id in (select device_id from vy_person_device where person_id = $1) returning 1`,
  );
  await del("vy_person_device", `delete from vy_person_device where person_id = $1 returning 1`);
  await del("vy_person", `delete from vy_person where person_id = $1 returning 1`);
  return counts;
}

/** Asserts every table is back to zero rows for this person_id — call AFTER
 *  teardown() to prove residue is actually zero, not just that deletes ran. */
export async function assertZeroResidue(personId) {
  const rows = await q(
    `select
       (select count(*) from vy_person where person_id = $1) +
       (select count(*) from vy_person_device where person_id = $1) +
       (select count(*) from vy_episode where person_id = $1) +
       (select count(*) from vy_rel_event where person_id = $1) +
       (select count(*) from vy_rel_state where person_id = $1) +
       (select count(*) from vy_pattern where person_id = $1) +
       (select count(*) from vy_phrase where person_id = $1) +
       (select count(*) from vy_derivation where person_id = $1) +
       (select count(*) from meera_log where device_id in (select device_id from vy_person_device where person_id = $1))
       as n`,
    [personId],
  );
  return Number(rows[0]?.n ?? -1);
}
