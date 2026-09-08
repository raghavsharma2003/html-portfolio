// Source preparation only. No database, KV, provider, or environment mutation.
import {ROOM_MEMORY_CLAIM_SQL,ROOM_MEMORY_ADMIT_SQL,ROOM_MEMORY_RELEASE_SQL,ROOM_MEMORY_CANCEL_ADMISSION_SQL}
  from '../api/_room-memory-consolidation.js';

export const schemaReadinessSQL=`select table_name,column_name,data_type,character_maximum_length
  from information_schema.columns where table_schema='public' and
    ((table_name='meera_consolidate_lease' and column_name in ('agent_id','person_id','leased_at','leased_by','run_id'))
    or (table_name='vy_provider_spend' and column_name in
      ('budget_id','operation','provider_family','provider_name','request_hash','state')))
  order by table_name,column_name`;

export function proofStatements({agentId,personId,runId,budgetId,requestHash}) {
  return [
    {name:'room_lease_claim',sql:ROOM_MEMORY_CLAIM_SQL,params:[agentId,personId,runId]},
    {name:'room_spend_admission',sql:ROOM_MEMORY_ADMIT_SQL,params:[agentId,personId,runId,`room-memory:${budgetId}:${requestHash}`]},
    {name:'room_lease_release',sql:ROOM_MEMORY_RELEASE_SQL,params:[agentId,personId,runId]},
    {name:'room_spend_cancel_admission',sql:ROOM_MEMORY_CANCEL_ADMISSION_SQL,params:[agentId,personId,runId,`room-memory:${budgetId}:${requestHash}`]},
  ];
}

export const actualProofRequirements=Object.freeze([
  'These four lease statements are new and were NOT covered by the migration159 proof. Use the incumbent development rollback runner, no provider/KV call and no COMMIT.',
  'Read schema readiness: lease agent_id/person_id are UUID, leased_by is TEXT without length cap; spend comparison fields exist. EXPLAIN all four exact proofStatements with synthetic inputs.',
  'Claim absent lease -> one row, repeated claim before 10 minutes -> zero, expired plain sweep lease -> one. Wrong run_id admission/release -> zero.',
  'Admit exact budget/request_hash token before reservation. No matching ledger row -> both expired claim and release refuse, retaining the unknown reservation ACK for manual reconciliation.',
  'Matching claim_extraction/consolidation/azure-foundry-room-memory ledger states reserved, in_flight, reconcile_required each prevent expired takeover and release. Matching settled or released allows release/expired takeover.',
  'Admission identity includes existing claimed sweep run_id plus exact source generation/content/model. A confirmed before-call release permits a later run after unpause without resetting the prior audit row; same-run replay retains the same identity. Settled but uncommitted work may retry in a later run under the incumbent budgets.',
  'Wrong budget/hash/operation/family/provider name must not release a held admission, even if that unrelated row is settled. An unrelated pending spend must not block a plain sweep lease or another Room agent/person.',
  'An acknowledged provider_budget_reservation_denied invokes cancellation with exact agent/person/run_id/token and no matching ledger row. That restores sweep for release. Wrong token/run_id or any matching ledger state must refuse cancellation; unknown reserve errors never invoke it.',
  'Verify the incumbent Meera claim/release SQL branch is unchanged. No global sweep lease exists. A held Room agent/person remains skipped while another candidate can proceed under the same person/call/token/time ceilings.',
  'Two short sessions: admission versus expired claim must have one owner; once token exists, competing claim may not overwrite it before its matching ledger settles/releases. No lock may span the provider await.',
  'Rollback, independent fixture absence and closed connections required. Offline control-flow tests are not PostgreSQL proof; keep the source writer flag false pending this proof and root review.',
]);
