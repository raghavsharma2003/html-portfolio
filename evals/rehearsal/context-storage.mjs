import assert from 'node:assert/strict';
import {freshDoorsState, rehearsalCreatorDb} from '../room-doors/fixtures.mjs';
import {grantAccountConsent} from '../../api/_replica-consent.js';
import {createStoredContextSource} from '../../api/context-items.js';
import {ensurePrivateReplicaBucket,writeImmutableReplicaSource,REPLICA_STORAGE_WRITE_BUCKET} from './stubs/replica-storage-with-fake-object.mjs';
import {createHash} from 'node:crypto';
const state=freshDoorsState();const r=state.replicas[0];const db=rehearsalCreatorDb(state);const bytes=Buffer.from('Synthetic creator source');const input={kind:'document',mime:'text/plain',bytes,contentSha256:createHash('sha256').update(bytes).digest('hex'),containsThirdParties:false};
await ensurePrivateReplicaBucket(REPLICA_STORAGE_WRITE_BUCKET);
await assert.rejects(()=>createStoredContextSource(db,r.owner_user_id,r.replica_id,input,{writeSource:writeImmutableReplicaSource}),e=>e.code==='context_source_permissions_required');
await grantAccountConsent(db,r.owner_user_id,r.replica_id,{scopes:['capture','storage','transcription'],attestations:{is_self:true,is_adult:true,has_source_rights:true,understands_synthetic_disclosure:true}});
const source=await createStoredContextSource(db,r.owner_user_id,r.replica_id,input,{writeSource:writeImmutableReplicaSource});assert.equal(source.state,'ready');assert.equal(state.sourceWriters[0].state,'released');assert.equal(source.provenance.sha256_status,'server_verified');console.log('real context lifecycle with fake transport passed, missing-consent negative passed');

await assert.rejects(()=>createStoredContextSource(db,'ffffffff-ffff-4fff-8fff-ffffffffffff',r.replica_id,input,{writeSource:writeImmutableReplicaSource}),e=>e.code==='context_source_permissions_required');
assert.equal(state.canonicalSources.length,1);
await assert.rejects(()=>writeImmutableReplicaSource({storageBucket:source.storage_bucket,objectPath:source.object_path,mime:input.mime,body:bytes,expectedSha256:input.contentSha256,ifNoneMatch:'*'}),e=>e.code==='source_storage_writer_authority_required');
console.log('cross-owner and missing-writer negatives passed');

state.sourceConsents.find(c => c.scope === 'storage').revoked_at = new Date().toISOString();
await assert.rejects(() => createStoredContextSource(db,r.owner_user_id,r.replica_id,input,{writeSource:writeImmutableReplicaSource}),e => e.code === 'context_source_permissions_required');
assert.equal(state.canonicalSources.length,1);
console.log('revoked-storage-consent negative passed');
