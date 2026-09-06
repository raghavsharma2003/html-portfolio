import { q } from "../../api/_db.js";
import {
  acknowledgeClaimExtractionEvidence,
  deferClaimExtractionJob,
  leaseNextClaimExtractionJob,
} from "../../api/_replica-claim-queue.js";

const ZERO = "00000000-0000-4000-8000-000000000000";
let statements = 0;

async function explain(sql, params) {
  const rows = await q(`explain (format json) ${sql}`, params);
  if (!rows?.[0]?.["QUERY PLAN"]) throw new Error("nearline_live_explain_missing_plan");
  statements += 1;
  return rows;
}

await leaseNextClaimExtractionJob(explain, {
  token: "live-explain-claim-queue-token-000000000000000000000000",
});

await deferClaimExtractionJob(explain, {
  jobId: ZERO,
  leaseToken: "live-explain-claim-queue-token-000000000000000000000000",
}, { failureCode: "live_explain", waiting: true });

await acknowledgeClaimExtractionEvidence(explain, {
  jobId: ZERO,
  replicaId: ZERO,
  ownerUserId: ZERO,
  evidenceIds: [ZERO],
  leaseToken: "live-explain-claim-queue-token-000000000000000000000000",
});

if (statements !== 3) throw new Error("nearline_live_explain_incomplete");
console.log("ok live Neon read-only EXPLAIN parsed nearline lease, defer, and acknowledgement SQL");

const audit = await q(
  `select (select count(*)::int from vy_replica_claim_extraction_queue) queues,
          (select count(*)::int from vy_replica_claim_extraction_queue_item) items,
          (select count(*)::int from vy_context_item where source_id is not null) linked_context`,
  [],
);
console.log(`live content-free inventory: queues=${Number(audit[0]?.queues || 0)} items=${Number(audit[0]?.items || 0)} linked_context=${Number(audit[0]?.linked_context || 0)}`);
