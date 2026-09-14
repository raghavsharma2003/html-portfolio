import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from "node:assert/strict";
import { assertProcessingSourceScope, processingSourceScopeFromEnv } from "../api/_replica-processing/source-scope.js";
import { leaseNextProcessingJob } from "../api/_replica-processing/queue.js";
import { requeueRecoveredProcessingJobs } from "../api/_replica-processing/composition.js";
import { leaseNextVoiceGenomeBuild, runVoiceGenomeBuildSweep } from "../api/_replica-model-build.js";
import { reconcileVoiceBuildIntents } from "../api/_replica-build-intent.js";
import { reconcileSelfTestVoiceGenomes } from "../api/_replica-processing/self-test.js";

const scopeJson = Object.freeze({
  owner_user_id: "11111111-1111-4111-8111-111111111111",
  replica_id: "22222222-2222-4222-8222-222222222222",
  source_id: "33333333-3333-4333-8333-333333333333",
});
const scope = assertProcessingSourceScope(scopeJson);
assert.deepEqual(scope, {
  ownerUserId: scopeJson.owner_user_id,
  replicaId: scopeJson.replica_id,
  sourceId: scopeJson.source_id,
});
assert.throws(() => processingSourceScopeFromEnv({ REPLICA_PROCESSING_SOURCE_SCOPE_JSON: JSON.stringify({ owner_user_id: scopeJson.owner_user_id }) }), /processing_source_scope_invalid/);
assert.throws(() => processingSourceScopeFromEnv({ REPLICA_PROCESSING_SOURCE_SCOPE_JSON: "{" }), /processing_source_scope_invalid/);
assert.throws(() => assertProcessingSourceScope({ ...scopeJson, extra: "no" }), /processing_source_scope_invalid/);

const calls = [];
const db = async (sql, params) => { calls.push({ sql, params }); return []; };
await leaseNextProcessingJob(db, { token: "a".repeat(32), sourceScope: scope });
await requeueRecoveredProcessingJobs(db, { integrity: { available: true } }, { sourceScope: scope });
await leaseNextVoiceGenomeBuild(db, { leaseToken: "b".repeat(32), sourceScope: scope });
await reconcileVoiceBuildIntents(db, { sourceScope: scope });

assert.equal(calls.length, 4);
for (const { sql, params } of calls) {
  assert.match(sql, /\$4::uuid|\$3::uuid/);
  assert.ok(params.includes(scope.ownerUserId));
  assert.ok(params.includes(scope.replicaId));
  assert.ok(params.includes(scope.sourceId));
}
assert.match(calls[0].sql, /j\.owner_user_id=\$4::uuid and j\.replica_id=\$5::uuid and j\.source_id=\$6::uuid/);
assert.match(calls[1].sql, /owner_user_id=\$4::uuid and replica_id=\$5::uuid and source_id=\$6::uuid/);
assert.match(calls[2].sql, /scoped_intent\.owner_user_id=\$4::uuid.*scoped_intent\.candidate_source_id=\$6::uuid/s);
assert.match(calls[3].sql, /i\.owner_user_id=\$2::uuid and i\.replica_id=\$3::uuid and i\.candidate_source_id=\$4::uuid/);

// Regression: a build can have two queued intents. Before the source filter
// was also inside the projected scalar subquery, the outer EXISTS could admit
// source A while this order chose the earlier source B intent. Both places
// now bind the exact requested source.
const twoIntentSql = calls[2].sql;
assert.match(twoIntentSql,/scoped_intent\.state='queued'/);
assert.match(twoIntentSql,/scoped_intent\.replica_id=b\.replica_id and scoped_intent\.owner_user_id=b\.owner_user_id/);
const projectedIntent = twoIntentSql.match(/\(select i\.candidate_source_id[\s\S]*?order by i\.created_at,i\.intent_id limit 1\) candidate_source_id/)?.[0] || "";
assert.match(projectedIntent, /i\.owner_user_id=\$4::uuid and i\.replica_id=\$5::uuid and i\.candidate_source_id=\$6::uuid/);
const twoQueuedIntents = [
  { source_id: scope.sourceId, created_at: 2 },
  { source_id: "44444444-4444-4444-8444-444444444444", created_at: 1 },
];
const projectedUnderScope = twoQueuedIntents
  .filter((intent) => intent.source_id === scope.sourceId)
  .sort((left, right) => left.created_at - right.created_at)[0];
assert.equal(projectedUnderScope.source_id, scope.sourceId);
assert.notEqual(projectedUnderScope.source_id, twoQueuedIntents[1].source_id);

let selfTestDbCalls = 0;
const skipped = await reconcileSelfTestVoiceGenomes(async () => { selfTestDbCalls += 1; return []; }, { sourceScope: scope });
assert.equal(selfTestDbCalls, 0);
assert.equal(skipped.skipped, "source_scope_no_per_source_api");

let forwardedScope = null;
await runVoiceGenomeBuildSweep({
  db,
  maxJobs: 1,
  sourceScope: scope,
  lease: async (_db, options) => { forwardedScope = options.sourceScope; return null; },
});
assert.deepEqual(forwardedScope, scope);

console.log("processing source scope: malformed scope rejects before database use; queue, recovery, intent and model-build SQL bind exact owner/replica/source; self-test side work skips.");

if(process.argv.includes('--emit-sql')){
 const runtime=readFileSync(new URL('../services/replica-processing-worker/run-once.js',import.meta.url),'utf8');
 const pending=runtime.match(/`(select distinct step from vy_replica_processing_job j[\s\S]*?limit 20)`/)?.[1];
 assert.ok(pending&&!pending.includes('${'));
 const names=['lease','requeue','model_build','build_intent'];
 const records=calls.slice(0,4).map((c,i)=>({name:names[i],sql:c.sql,params:c.params}));
 records.push({name:'pending_work',sql:pending,params:[['diarize'],[],scope.ownerUserId,scope.replicaId,scope.sourceId],capture:'literal source extraction; main not imported'});
 for(const row of records)row.sha256=createHash('sha256').update(row.sql).digest('hex');
 writeFileSync(new URL('../services/replica-processing-worker/PROCESSING203-SCOPE-SQL.json',import.meta.url),JSON.stringify({status:'source_only_not_parsed',queries:records},null,2)+'\n');
}
