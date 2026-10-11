// Read-only Neon parser gate for full replica erasure, including the non-FK
// TeacherSheet cleanup. EXPLAIN without ANALYZE performs no deletion.
import { q } from "../../api/_db.js";
import {
  completeReplicaErasure,
  createReplicaErasureReceipt,
} from "../../api/_replica-full-erasure.js";

const channelSchema = await q(
  `select to_regclass('public.vy_channel_extraction_object')::text channel_table`,
  [],
);
if (!channelSchema[0]?.channel_table) {
  console.log("skip full replica erasure live EXPLAIN: migration 074 is not applied");
  process.exit(0);
}

const JOB = "10000000-0000-4000-8000-000000000001";
const REPLICA = "20000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-000000000003";
const AGENT = "40000000-0000-4000-8000-000000000004";
const TOKEN = "replica-erasure-live-explain-token-more-than-thirty-two-bytes";
const receipt = createReplicaErasureReceipt(REPLICA, OWNER, {
  REPLICA_ERASURE_RECEIPT_KEY_B64: Buffer.alloc(32, 91).toString("base64"),
  REPLICA_BACKUP_RETENTION_DAYS: "30",
}, { nonce: "a".repeat(64), nowMs: 0, erasureRequestId: JOB });

let planned = 0;
await completeReplicaErasure(async (sql, params) => {
  const rows = await q(`explain (format json) ${sql}`, params);
  if (!rows?.[0]?.["QUERY PLAN"]) throw new Error("replica_erasure_live_explain_missing_plan");
  planned += 1;
  return [{ receipt_id: "50000000-0000-4000-8000-000000000005" }];
}, {
  jobId: JOB,
  replicaId: REPLICA,
  ownerUserId: OWNER,
  agentId: AGENT,
  leaseToken: TOKEN,
}, receipt);
if (planned !== 1) throw new Error("replica_erasure_live_explain_incomplete");
console.log("ok live Neon read-only EXPLAIN parsed full erasure and exact TeacherSheet cleanup SQL");

const inventory = await q(
  `select count(*)::integer sheets,
          count(*) filter (where not exists (
            select 1 from vy_replica r where r.agent_id=s.agent_id
          ))::integer orphan_sheets,
          (select count(*)::integer from vy_push_token) push_tokens,
          (select count(*)::integer from vy_push_token p where not exists (
            select 1 from vy_replica r where r.agent_id=p.agent_id
          )) orphan_push_tokens
     from vy_teacher_sheet s`,
  [],
);
console.log("live content-free TeacherSheet inventory", inventory[0]);
