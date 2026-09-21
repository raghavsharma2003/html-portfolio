// Read-only Neon parser gate for migration 070. EXPLAIN without ANALYZE plans
// the writes but does not execute them or spend any model/provider quota.
import { q } from "../../api/_db.js";
import {
  CONTEXT_EVIDENCE_WRITE_SQL,
  CONTEXT_TEXT_EVIDENCE_CLEAR_SQL,
  createContextTextEvidence,
} from "../../api/_experience-compiler/context-evidence.js";

const schema = await q(
  `select exists(
     select 1 from information_schema.columns
      where table_schema='public' and table_name='vy_context_item' and column_name='source_id'
   ) ready`,
  [],
);
if (!schema[0]?.ready) {
  console.log("SKIP live Context canonical evidence EXPLAIN: migration 070 is not applied");
  process.exit(0);
}

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const replica = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const source = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const item = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const records = createContextTextEvidence({
  replicaId: replica,
  ownerUserId: owner,
  sourceId: source,
  itemId: item,
  inputSha256: "e".repeat(64),
  format: "text",
  extractor: "text-plain/v1",
  body: "read-only parser probe",
  authorship: "mine",
});

await q(`explain (format json) ${CONTEXT_EVIDENCE_WRITE_SQL}`, [item, replica, owner, JSON.stringify(records)]);
await q(`explain (format json) ${CONTEXT_TEXT_EVIDENCE_CLEAR_SQL}`, [item, replica, owner]);
console.log("ok live Neon read-only EXPLAIN parsed Context canonical evidence write and re-attribution clear");
