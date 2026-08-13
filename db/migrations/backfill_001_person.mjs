// Person-layer backfill (SPEC.md §2.2), bounded and resumable.
//
//   node db/migrations/backfill_001_person.mjs
//
// One person per distinct device_id seen in user data, with
// person_id := device_id (the §2.1 anonymous cast — one code path for
// anonymous and signed-in). Merges happen ONLY on signed-in account
// evidence (meera_state.user_id spanning devices), never heuristics: a
// wrong merge is a privacy defect. Note that meera_state as it stands
// keys one device_id per user_id, so a multi-device account cannot even
// be represented yet — the merge step is a guarded no-op until it can.
//
// Bounded: batches of K=200 devices per statement (§0.3 bounded-backfill
// ruling), each batch one idempotent CTE insert (person + mapping land
// atomically, `on conflict do nothing` both sides), so an interrupted run
// resumes by running again. Pure SQL — no LLM anywhere in the person
// layer; the priced K=200 LLM consolidation of §2.7 is the episode
// backfill and belongs to WS-CONSOLIDATE.
//
// Devices are drawn from meera_log AND meera_nodes: §2.2 names meera_log,
// but a device that only ever wrote graph memory still owns user data and
// must be reachable through the mapping for forget/export. Superset is the
// safe direction; the count difference is logged.
import { q } from "../../api/_db.js";

const K = 200;

const t0 = Date.now();
const [pre] = await q(`
  select
    (select count(distinct device_id) from meera_log)   as log_devices,
    (select count(distinct device_id) from meera_nodes) as node_devices,
    (select count(*) from vy_person_device)             as mapped
`);
console.log(`before: ${JSON.stringify(pre)}`);

let total = 0;
let batches = 0;
for (;;) {
  const rows = await q(
    `with pending as (
       select d.device_id
       from (select device_id from meera_log
             union
             select device_id from meera_nodes) d
       left join vy_person_device m on m.device_id = d.device_id
       where m.device_id is null
       order by d.device_id
       limit ${K}
     ),
     p as (
       insert into vy_person (person_id)
       select device_id from pending
       on conflict (person_id) do nothing
     )
     insert into vy_person_device (device_id, person_id)
     select device_id, device_id from pending
     on conflict (device_id) do nothing
     returning device_id`,
    [],
    60_000,
  );
  batches++;
  total += rows.length;
  console.log(`batch ${batches}: mapped ${rows.length}`);
  if (rows.length < K) break;
}

// Signed-in merge evidence: meera_state rows carrying both user_id and
// device_id. With one device column per account nothing can span devices,
// so this only reports; the merge op ships when the evidence can exist.
const merges = await q(
  `select user_id, count(distinct device_id) devices
   from meera_state where device_id is not null
   group by user_id having count(distinct device_id) > 1`,
).catch(() => []);
if (merges.length) {
  console.log(`MERGE EVIDENCE FOUND for ${merges.length} account(s) — merge op not implemented; do NOT merge heuristically`);
  process.exit(1);
}

const [post] = await q(
  `select (select count(*) from vy_person) persons,
          (select count(*) from vy_person_device) mapped`,
);
console.log(`after: ${JSON.stringify(post)}`);
console.log(
  `backfilled ${total} device(s) in ${batches} batch(es), ${Date.now() - t0}ms, LLM cost $0 (pure SQL)`,
);
