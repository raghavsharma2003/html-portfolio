import assert from 'node:assert/strict';
import {createProcessingAdmissionObserver} from '../api/_replica-processing/canary-observer.js';
import {canonicalJson,sha256Hex} from '../api/_provenance/contracts.js';
const scope={ownerUserId:'11111111-1111-4111-8111-111111111111',replicaId:'22222222-2222-4222-8222-222222222222',sourceId:'33333333-3333-4333-8333-333333333333'};
const plan={origin:'https://fixture.internal',resource_id:'fixture',revision_sha256:'a'.repeat(64),image_sha256:'b'.repeat(64),active_revision_name:'fixture',active_revision_template_sha256:'c'.repeat(64)};
let now=1000000;const snapshot={...plan,kind:'processing-stock-canary-metadata/v1',source_sha256:'16636b6e06d0e7145fad3cab3ac5d85409f84e527c23a2189fb3c79b85738cf6',scope,observed_at_ms:now,plan_sha256:sha256Hex(canonicalJson(plan))};
const env={VYAKTI_PROCESSING_CANARY_SNAPSHOT_ENABLED:'1',REPLICA_EXPECTED_DATABASE:'vyakti_expert_integration_20260906',VYAKTI_MODEL_SERVING:'azure_only',REPLICA_PROCESSING_SOURCE_SCOPE_JSON:JSON.stringify({owner_user_id:scope.ownerUserId,replica_id:scope.replicaId,source_id:scope.sourceId}),VYAKTI_PROCESSING_CANARY_SNAPSHOT_JSON:JSON.stringify(snapshot)};
let n=0;const observer=createProcessingAdmissionObserver({env,clock:()=>now});assert.equal((await observer(plan)).valid_until_ms,1120000);n++;
now=1120001;await assert.rejects(observer(plan),/snapshot_refused/);n++;now=1000000;
for(const delta of [{source_sha256:'e'.repeat(64)},{scope:{...scope,sourceId:scope.replicaId}},{image_sha256:'e'.repeat(64)},{observed_at_ms:1000001},{active_revision_template_sha256:'e'.repeat(64)}]){
 const o=createProcessingAdmissionObserver({env:{...env,VYAKTI_PROCESSING_CANARY_SNAPSHOT_JSON:JSON.stringify({...snapshot,...delta})},clock:()=>now});await assert.rejects(o(plan),/snapshot_refused/);n++;
}
assert.throws(()=>createProcessingAdmissionObserver({env:{...env,REPLICA_PROCESSING_SOURCE_SCOPE_JSON:''}}),/snapshot_refused/);n++;
let ordinary=0;const normal=createProcessingAdmissionObserver({env:{...env,VYAKTI_PROCESSING_CANARY_SNAPSHOT_ENABLED:'0'},ordinaryObserver:async()=>{ordinary++;return 'live-metadata';}});assert.equal(await normal(plan),'live-metadata');assert.equal(ordinary,1);n++;
console.log(JSON.stringify({state:'stock_canary_snapshot_offline_pass',groups:n,cloud_calls:0}));
