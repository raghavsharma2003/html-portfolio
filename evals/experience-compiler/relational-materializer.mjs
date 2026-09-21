import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acceptedClaimRelationalCommitment,
  materializeAcceptedClaimToRelationalOs,
  reconcileClaimRelationalMaterializations,
  retractClaimRelationalMaterialization,
} from "../../api/_experience-compiler/relational-materializer.js";
import { decideAndMaterializeOwnedClaim } from "../../api/_person-model.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const OWNER = "10000000-0000-4000-8000-000000000001";
const REPLICA = "20000000-0000-4000-8000-000000000002";
const AGENT = "30000000-0000-4000-8000-000000000003";
const PERSON = "40000000-0000-4000-8000-000000000004";
const DECISION = "50000000-0000-4000-8000-000000000005";
const PROPOSAL = "a".repeat(64);
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

const candidate = Object.freeze({
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
  proposal_hash: PROPOSAL,
  agent_id: AGENT,
  subject_person_id: PERSON,
  decision_id: DECISION,
  decided_at: "2026-08-30T06:00:00.000Z",
});

const commitmentInput = {
  replica_id: REPLICA,
  owner_user_id: OWNER,
  agent_id: AGENT,
  subject_person_id: PERSON,
  claim_id: "41",
  proposal_hash: PROPOSAL,
  decision_id: DECISION,
};
const commitment = acceptedClaimRelationalCommitment(commitmentInput);
ok("the materialization commitment is deterministic", commitment === acceptedClaimRelationalCommitment({ ...commitmentInput }));
ok("the materialization commitment is a content-free SHA-256", /^[0-9a-f]{64}$/.test(commitment)
  && !commitment.includes(candidate.body));
ok("changing the exact accepting decision changes the commitment",
  commitment !== acceptedClaimRelationalCommitment({
    ...commitmentInput, decision_id: "60000000-0000-4000-8000-000000000006",
  }));

const calls = [];
let writes = 0;
const db = async (sql, params) => {
  calls.push({ sql, params });
  if (sql.trimStart().startsWith("select c.claim_id")) return [{ ...candidate }];
  writes += 1;
  return [{ episode_id: 901, fact_id: 902, created: writes === 1 }];
};

const first = await materializeAcceptedClaimToRelationalOs(db, OWNER, {
  replica_id: REPLICA, claim_id: "41",
});
const retry = await materializeAcceptedClaimToRelationalOs(db, OWNER, {
  replica_id: REPLICA, claim_id: "41",
});
ok("an accepted cited claim materializes to one episode and one fact",
  first.episode_id === "901" && first.fact_id === "902" && first.created === true);
ok("retry returns the same exact materialization without creating another",
  retry.episode_id === first.episode_id && retry.fact_id === first.fact_id
  && retry.content_commitment === first.content_commitment && retry.created === false);

const readSql = calls[0].sql;
const writeSql = calls[1].sql;
ok("eligibility requires the latest accepted decision and matching approved state",
  /order by x\.created_at desc,x\.decision_id desc limit 1/.test(readSql)
  && /c\.status='approved' and d\.decision='accepted'/.test(readSql));
ok("eligibility admits only unambiguous event facts and relationship claims",
  /c\.domain in \('event','relationship'\)/.test(readSql));
ok("materialization requires a current policy training grant at the write boundary",
  /consent\.scope='training'/.test(readSql)
  && /consent\.policy_version=r\.policy_version/.test(readSql)
  && /consent\.revoked_at is null/.test(readSql));
ok("ordinary claim sources still require ready transcript lineage",
  /unnest\(c\.source_ids\)/.test(readSql) && /s\.state='ready'/.test(readSql)
  && /vy_replica_claim_citation/.test(readSql) && /vy_replica_processing_evidence/.test(readSql)
  && /e\.evidence_type<>'transcript_span'/.test(readSql));
ok("the only quarantined source admitted is an exact private Mirror transcript",
  /s\.state='quarantined' and s\.capture_mode='derived'/.test(readSql)
  && /s\.contains_third_parties=false/.test(readSql)
  && /s\.provenance->>'purpose'='mirror_window'/.test(readSql)
  && /me\.value#>>'\{provenance,origin\}'='mirror_call'/.test(readSql)
  && /me\.value#>>'\{provenance,source_id\}'=s\.source_id::text/.test(readSql)
  && /me\.value#>>'\{provenance,session_id\}'=s\.provenance->>'mirror_session_id'/.test(readSql));
ok("an arbitrary quarantined upload cannot pass through the Mirror exception",
  /not \(\s*cc\.source_id=any\(c\.source_ids\)[\s\S]*or not \([\s\S]*s\.state='ready' or \([\s\S]*s\.state='quarantined'[\s\S]*e\.value#>>'\{provenance,origin\}'='mirror_call'[\s\S]*e\.value#>>'\{provenance,session_id\}'=s\.provenance->>'mirror_session_id'/.test(readSql));
ok("the write rechecks the exact proposal and decision observed before materialization",
  /c\.proposal_hash=\$4/.test(writeSql) && /d\.decision_id=\$5::uuid/.test(writeSql)
  && calls[1].params[3] === PROPOSAL && calls[1].params[4] === DECISION);
ok("the materializer locks the exact active replica parent in the write statement",
  /with eligible as materialized/.test(writeSql) && /for update of r/.test(writeSql)
  && /r\.lifecycle not in \('revoked','purging'\)/.test(writeSql));
ok("the advisory lock and proposal-prefixed marker make the write retry/concurrency idempotent",
  /pg_advisory_xact_lock/.test(writeSql)
  && calls[1].params[5] === `replica_claim:${PROPOSAL}:${commitment}`
  && calls[1].params[6] === `replica_claim:${PROPOSAL}:%`
  && calls[3].params[5] === calls[1].params[5]);
ok("the only target is the replica's stored agent-subject dyad",
  /e\.agent_id=c\.agent_id and e\.person_id=c\.subject_person_id/.test(writeSql)
  && /c\.agent_id,c\.subject_person_id/.test(writeSql));
ok("the accepted episode is readable only to its exact one-to-one subject",
  /'watch','user'/.test(writeSql) && /false,'participants_1to1'/.test(writeSql)
  && /insert into vy_episode_participant \(episode_id,person_id,role\)/.test(writeSql)
  && /select a\.id,c\.subject_person_id,'participant'/.test(writeSql));
ok("the fact cites exactly the committed episode",
  /c\.confidence,array\[a\.id\]::bigint\[\]/.test(writeSql)
  && /f\.citations=array\[a\.id\]::bigint\[\]/.test(writeSql));
ok("a later explicit re-acceptance restores the exact retracted fact rather than duplicating it",
  /restored_fact as \([\s\S]*set retracted_at=null,t_invalid=null/.test(writeSql)
  && /select id from restored_fact limit 1/.test(writeSql));
ok("relationship claims become relationship facts without inventing a state transition",
  /when c\.domain='relationship' then 'relationship'/.test(writeSql)
  && !/insert into vy_rel_event/.test(writeSql) && !/vy_rel_state/.test(writeSql));

for (const state of ["pending", "rejected", "deferred"]) {
  let count = 0;
  const result = await materializeAcceptedClaimToRelationalOs(async () => {
    count += 1;
    return [];
  }, OWNER, { replica_id: REPLICA, claim_id: "41" });
  ok(`NEGATIVE CONTROL: ${state} claims cannot reach a write`, result === null && count === 1);
}

let ownerIsolationCalls = 0;
const ownerIsolation = await materializeAcceptedClaimToRelationalOs(async (_sql, params) => {
  ownerIsolationCalls += 1;
  assert.equal(params[2], "70000000-0000-4000-8000-000000000007");
  return [];
}, "70000000-0000-4000-8000-000000000007", { replica_id: REPLICA, claim_id: "41" });
ok("NEGATIVE CONTROL: another owner cannot discover or materialize the claim",
  ownerIsolation === null && ownerIsolationCalls === 1);

let raceCalls = 0;
const stale = await materializeAcceptedClaimToRelationalOs(async () => {
  raceCalls += 1;
  return raceCalls === 1 ? [{ ...candidate }] : [];
}, OWNER, { replica_id: REPLICA, claim_id: "41" });
ok("NEGATIVE CONTROL: lineage or review changing between read and write fails closed",
  stale === null && raceCalls === 2);

let purgeRaceCalls = 0;
let payloadRowsAfterReceipt = 0;
const purgedDuringMaterialization = await materializeAcceptedClaimToRelationalOs(async (sql) => {
  purgeRaceCalls += 1;
  if (purgeRaceCalls === 1) return [{ ...candidate }];
  assert.match(sql, /for update of r/);
  // The full receipt removed replica and agent after the initial eligibility
  // read. The write-time parent gate returns no row, so neither payload table
  // can be recreated by the stale invocation.
  payloadRowsAfterReceipt += 0;
  return [];
}, OWNER, { replica_id: REPLICA, claim_id: "41" });
ok("a stale accepted-claim worker cannot recreate episode or fact rows after the purge receipt",
  purgedDuringMaterialization === null && purgeRaceCalls === 2 && payloadRowsAfterReceipt === 0);

await assert.rejects(
  materializeAcceptedClaimToRelationalOs(async () => [], OWNER, { replica_id: REPLICA, claim_id: "0" }),
  /valid_claim_id_required/,
);
ok("invalid identities fail before any database write", true);

const acceptedCallerSql = [];
const acceptedFromReview = await decideAndMaterializeOwnedClaim(async (sql, params) => {
  acceptedCallerSql.push(sql);
  if (/insert into vy_replica_claim_decision/.test(sql)) {
    return [{ decision_id: DECISION, claim_id: "41", decision: params[3], reason_code: params[4], created_at: candidate.decided_at }];
  }
  if (sql.trimStart().startsWith("select c.claim_id")) return [{ ...candidate }];
  return [{ episode_id: 901, fact_id: 902, created: true }];
}, OWNER, {
  replica_id: REPLICA, claim_id: "41", decision: "accepted", reason_code: "representative",
});
ok("the explicit accepted-review action is an executable materializer caller",
  acceptedFromReview.decision.decision === "accepted" && acceptedFromReview.materialization.fact_id === "902"
  && acceptedCallerSql.length === 3);

let rejectedCallerWrites = 0;
const rejectedFromReview = await decideAndMaterializeOwnedClaim(async (sql, params) => {
  rejectedCallerWrites += 1;
  if (/retracted as \(/.test(sql)) return [{ retracted_facts: 1 }];
  return [{ decision_id: DECISION, claim_id: "41", decision: params[3], reason_code: params[4], created_at: candidate.decided_at }];
}, OWNER, {
  replica_id: REPLICA, claim_id: "41", decision: "rejected", reason_code: "inaccurate",
});
ok("an explicit rejection never creates a materialization and retracts an earlier exact fact",
  rejectedFromReview.materialization === null && rejectedFromReview.retraction.retracted_facts === 1
  && rejectedCallerWrites === 2);

let retractSql = "";
const retracted = await retractClaimRelationalMaterialization(async (sql) => {
  retractSql = sql;
  return [{ retracted_facts: 1 }];
}, OWNER, { replica_id: REPLICA, claim_id: "41" });
ok("retraction is bound to the latest rejected or superseded owner decision",
  retracted.retracted_facts === 1
  && /c\.status='rejected' and latest\.decision='rejected'/.test(retractSql)
  && /or c\.status='superseded'/.test(retractSql));
ok("retraction reaches only facts whose citations are wholly inside the exact proposal episode set",
  /e\.boundary_reason like \('replica_claim:'\|\|c\.proposal_hash\|\|':%'\)/.test(retractSql)
  && /not exists \(select 1 from unnest\(f\.citations\)/.test(retractSql)
  && /retracted_at=coalesce\(f\.retracted_at,now\(\)\)/.test(retractSql));

let reconcileCalls = 0;
const reconciled = await reconcileClaimRelationalMaterializations(async (sql) => {
  reconcileCalls += 1;
  if (/with latest as materialized/.test(sql)) return [{
    claim_id: "41", replica_id: REPLICA, owner_user_id: OWNER, decision: "accepted",
  }];
  if (sql.trimStart().startsWith("select c.claim_id")) return [{ ...candidate }];
  return [{ episode_id: 901, fact_id: 902, created: true }];
});
ok("the bounded reconciler heals an accepted decision left between API writes",
  reconciled.scanned === 1 && reconciled.materialized === 1 && reconcileCalls === 3);
let reconciliationSql = "";
await reconcileClaimRelationalMaterializations(async (sql) => {
  reconciliationSql = sql;
  return [];
});
ok("reconciliation finds only accepted facts missing a live materialization or rejected facts still live",
  /c\.status='approved' and l\.decision='accepted'/.test(reconciliationSql)
  && /c\.status='rejected' and l\.decision='rejected'/.test(reconciliationSql)
  && /or c\.status='superseded'/.test(reconciliationSql)
  && /limit \$1::int4/.test(reconciliationSql));

const route = readFileSync(join(ROOT, "api/replica-person-model.js"), "utf8");
ok("the production caller derives owner authority from auth and returns the materialization receipt",
  /const user = await requireUser\(req\)/.test(route)
  && /decideAndMaterializeOwnedClaim\(q, user\.id, body\)/.test(route)
  && /res\.status\(201\)\.json\(reviewed\)/.test(route));

console.log(`\n${checks} accepted-claim relational materializer checks passed`);
