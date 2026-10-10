// Read-only Neon parser gate. EXPLAIN without ANALYZE executes no data-changing
// CTE, while still type-checking every parameter and relation used by the
// accepted-claim write and Mirror recall path.
import { q } from "../../api/_db.js";
import { approvedMirrorRecall } from "../../api/_experience-compiler/mirror-recall.js";
import { materializeAcceptedClaimToRelationalOs } from "../../api/_experience-compiler/relational-materializer.js";

const OWNER = "10000000-0000-4000-8000-000000000001";
const REPLICA = "20000000-0000-4000-8000-000000000002";
const AGENT = "30000000-0000-4000-8000-000000000003";
const PERSON = "40000000-0000-4000-8000-000000000004";
const DECISION = "50000000-0000-4000-8000-000000000005";
const candidate = {
  claim_id: "41",
  replica_id: REPLICA,
  owner_user_id: OWNER,
  domain: "relationship",
  key: "repair_preference",
  body: "Prefers direct acknowledgement after a correction",
  origin: "observed",
  confidence: 0.91,
  sensitive: true,
  t_valid_from: null,
  t_valid_to: null,
  proposal_hash: "a".repeat(64),
  agent_id: AGENT,
  subject_person_id: PERSON,
  decision_id: DECISION,
  decided_at: "2026-08-30T06:00:00.000Z",
};

let recallPlan = null;
await approvedMirrorRecall(async (sql, params) => {
  recallPlan = await q(`explain (format json) ${sql}`, params, 30_000);
  return [];
}, OWNER, REPLICA);
if (!recallPlan?.[0]?.["QUERY PLAN"]) throw new Error("mirror_recall_explain_missing");

let eligiblePlan = null;
let writePlan = null;
let call = 0;
const sentinel = Object.freeze({ code: "explain_complete" });
try {
  await materializeAcceptedClaimToRelationalOs(async (sql, params) => {
    call += 1;
    const plan = await q(`explain (format json) ${sql}`, params, 30_000);
    if (call === 1) {
      eligiblePlan = plan;
      return [candidate];
    }
    writePlan = plan;
    throw sentinel;
  }, OWNER, { replica_id: REPLICA, claim_id: "41" });
} catch (error) {
  if (error !== sentinel) throw error;
}
if (!eligiblePlan?.[0]?.["QUERY PLAN"]) throw new Error("accepted_claim_eligible_explain_missing");
if (!writePlan?.[0]?.["QUERY PLAN"]) throw new Error("accepted_claim_write_explain_missing");
console.log("ok live Neon read-only EXPLAIN parsed approved Mirror recall and accepted-claim materialization");
const [counts] = await q(
  `select count(*)::int total,
          count(*) filter (where disclosure_scope='private')::int private_rows,
          count(*) filter (where disclosure_scope='participants_1to1')::int one_to_one_rows
     from vy_episode where boundary_reason like 'replica_claim:%'`,
  [],
  30_000,
);
console.log(`live accepted materializations: total=${Number(counts?.total || 0)} private=${Number(counts?.private_rows || 0)} one_to_one=${Number(counts?.one_to_one_rows || 0)}`);
