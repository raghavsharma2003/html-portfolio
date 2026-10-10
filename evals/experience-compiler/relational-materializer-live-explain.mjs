// Read-only Neon parser gate for accepted-claim materialization and reversal.
// EXPLAIN without ANALYZE plans each write and executes no mutation.
import { q } from "../../api/_db.js";
import {
  materializeAcceptedClaimToRelationalOs,
  retractClaimRelationalMaterialization,
} from "../../api/_experience-compiler/relational-materializer.js";

const OWNER = "10000000-0000-4000-8000-000000000001";
const REPLICA = "20000000-0000-4000-8000-000000000002";
const candidate = {
  claim_id: "41",
  replica_id: REPLICA,
  owner_user_id: OWNER,
  domain: "relationship",
  key: "repair_preference",
  body: "read-only parser probe",
  origin: "observed",
  confidence: 0.9,
  sensitive: false,
  t_valid_from: null,
  t_valid_to: null,
  proposal_hash: "a".repeat(64),
  agent_id: "30000000-0000-4000-8000-000000000003",
  subject_person_id: "40000000-0000-4000-8000-000000000004",
  decision_id: "50000000-0000-4000-8000-000000000005",
  decided_at: "2026-08-30T00:00:00.000Z",
};

const captured = [];
await materializeAcceptedClaimToRelationalOs(async (sql, params) => {
  captured.push([sql, params]);
  return captured.length === 1 ? [candidate] : [{ episode_id: 1, fact_id: 2, created: true }];
}, OWNER, { replica_id: REPLICA, claim_id: "41" });
for (const [sql, params] of captured) await q(`explain (format json) ${sql}`, params);

let retractSql = "";
let retractParams = [];
await retractClaimRelationalMaterialization(async (sql, params) => {
  retractSql = sql;
  retractParams = params;
  return [{ retracted_facts: 0 }];
}, OWNER, { replica_id: REPLICA, claim_id: "41" });
await q(`explain (format json) ${retractSql}`, retractParams);

console.log("ok live Neon read-only EXPLAIN parsed accepted-claim materialization and reversal SQL");
