import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import * as store from '../../api/_comparison-reference.js';
import {createComparisonReferenceHandler,comparisonAudioRange} from '../../api/replica-comparison-reference.js';
import {sha256Hex} from '../../api/_replica-processing/contracts.js';
import {modernCaptureReadiness} from '../../api/_liveness/capture-readiness.js';
import {issueOwnedModernChallenge,MODERN_AUTHORITY_SNAPSHOT_SQL,MODERN_AUTHORITY_ISSUE_SQL,MODERN_AUTHORITY_LOAD_SQL,getOwnedModernComparisonDescriptor} from '../../api/_liveness/issued-authority.js';
import {BIOMETRIC_VERIFICATION_ATTESTATIONS} from '../../api/_replica-liveness.js';
import {uid,bytes,memoryFixture,authorize,attestations} from './fixtures.mjs';
let n=0;const check=async(name,fn)=>{await fn();console.log(`ok ${++n} - ${name}`);};
const input={replica_id:uid(1),reference_id:uid(10)};
const noWrites=f=>f.state.calls.filter(c=>[store.COMPARISON_AUTHORIZE_SQL,store.COMPARISON_AUDITION_SQL,store.COMPARISON_CONFIRM_SQL].includes(c.sql)).length;
const fetchNative=globalThis.fetch;globalThis.fetch=()=>{throw Error('outbound_forbidden');};

await check('actual signed evidence becomes an option without accepted decisions; capture stays blocked',async()=>{
 const f=memoryFixture(),v=await store.comparisonReferenceOptions(f.db,uid(2),uid(1));assert.equal(v.options.length,1);assert.equal(v.capture_ready,false);assert.equal(modernCaptureReadiness().ready,false);
 assert(!JSON.stringify(v).includes('vector'));assert(!JSON.stringify(v).includes('storage_bucket'));assert.equal(noWrites(f),0);
});
await check('unsupported or tampered evidence is unavailable, while database/epoch failure remains visible',async()=>{
 const f=memoryFixture();f.state.candidate.reference_rows[0].record_hash='0'.repeat(64);assert.equal((await store.comparisonReferenceOptions(f.db,uid(2),uid(1))).state,'unavailable');
 const g=memoryFixture();g.state.candidate.observed_epoch='invalid';await assert.rejects(()=>store.comparisonReferenceOptions(g.db,uid(2),uid(1)),{code:'comparison_epoch_invalid'});
 await assert.rejects(()=>store.comparisonReferenceOptions(async()=>{throw Error('database_failure');},uid(2),uid(1)),/database_failure/);
});
await check('all three explicit use statements are required before any database operation',async()=>{
 for(const value of [undefined,{}, {...attestations(),comparison_only:false},{...attestations(),extra:true}]){const f=memoryFixture();await assert.rejects(()=>store.authorizeComparisonReference(f.db,uid(2),{...input,artifact_id:uid(4),expected_snapshot_hash:'a'.repeat(64),attestations:value}),{code:'comparison_explicit_consent_required'});assert.equal(f.state.calls.length,0);}
 let invoked=0;const bad=attestations();Object.defineProperty(bad,'comparison_only',{get(){invoked++;return true;}});await assert.rejects(()=>store.authorizeComparisonReference(async()=>[],uid(2),{...input,artifact_id:uid(4),attestations:bad}));assert.equal(invoked,0);
});
await check('exact current snapshot required; replacement refuses before receipt insert',async()=>{
 const f=memoryFixture(),v=await store.comparisonReferenceOptions(f.db,uid(2),uid(1));f.state.candidate.observed_epoch++;
 await assert.rejects(()=>store.authorizeComparisonReference(f.db,uid(2),{...input,artifact_id:uid(4),expected_snapshot_hash:v.options[0].snapshot_hash,attestations:attestations()}),{code:'comparison_reference_changed'});assert.equal(noWrites(f),0);
});
await check('one stable request UUID replays exact authorization and cannot convert another artifact',async()=>{
 const f=memoryFixture(),request=await authorize(f);assert.equal((await store.authorizeComparisonReference(f.db,uid(2),request)).state,'review');assert.equal(f.state.calls.filter(c=>c.sql===store.COMPARISON_AUTHORIZE_SQL).length,1);
 await assert.rejects(()=>store.authorizeComparisonReference(f.db,uid(2),{...request,artifact_id:uid(44)}),{code:'comparison_request_reused'});
 const h=f.state.rows.get(uid(10));assert.equal(h.receipt_hash,sha256Hex(h.receipt_payload));assert(!JSON.stringify(h.receipt_payload).includes('vector'));
});
await check('foreign owner or replica cannot recover, audition or confirm a receipt',async()=>{
 const f=memoryFixture();await authorize(f);for(const owner of [uid(22),uid(2)]){const i={...input,replica_id:owner===uid(2)?uid(11):uid(1)};await assert.rejects(()=>store.readComparisonReference(f.db,owner,i.replica_id,i.reference_id),{status:404});await assert.rejects(()=>store.auditionComparisonReference(f.db,owner,i,()=>{throw Error('private_read_forbidden');}),{status:404});}
});
await check('actual bytes/hash/size are verified before delivery marker, mismatching audio is refused',async()=>{
 const f=memoryFixture();await authorize(f);await assert.rejects(()=>store.auditionComparisonReference(f.db,uid(2),input,async()=>({body:Buffer.from('wrong'),mime:'audio/wav'})),{code:'comparison_audition_bytes_changed'});assert(!f.state.rows.get(uid(10)).audition_response_at);
 const value=await store.auditionComparisonReference(f.db,uid(2),input,f.readPrivate);assert.deepEqual(value.body,bytes);assert(f.state.rows.get(uid(10)).audition_response_at);assert.equal(f.state.rows.get(uid(10)).state,'review');
});
await check('withdrawal during private read prevents the audition response and no marker is written',async()=>{
 const f=memoryFixture();await authorize(f);await assert.rejects(()=>store.auditionComparisonReference(f.db,uid(2),input,async()=>{await store.withdrawComparisonReference(f.db,uid(2),input);return{body:bytes,mime:'audio/wav'};}));assert.equal(f.state.calls.filter(c=>c.sql===store.COMPARISON_AUDITION_SQL).length,0);
});
await check('native AbortSignal after the private read prevents final authorization',async()=>{
 const f=memoryFixture();await authorize(f);const c=new AbortController();await assert.rejects(()=>store.auditionComparisonReference(f.db,uid(2),input,async()=>{c.abort();return{body:bytes,mime:'audio/wav'};},{signal:c.signal}),{name:'AbortError'});assert.equal(f.state.calls.filter(c=>c.sql===store.COMPARISON_AUDITION_SQL).length,0);
});
await check('abort while private read is pending propagates the supplied signal and never writes a marker',async()=>{
 const f=memoryFixture();await authorize(f);const controller=new AbortController();let started;const entered=new Promise(r=>started=r);
 const pending=store.auditionComparisonReference(f.db,uid(2),input,async(_,{signal})=>{assert.equal(signal,controller.signal);started();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));},{signal:controller.signal});
 await entered;controller.abort();await assert.rejects(()=>pending,{name:'AbortError'});assert.equal(f.state.calls.filter(c=>c.sql===store.COMPARISON_AUDITION_SQL).length,0);
});
await check('invalid or unsatisfiable range cannot produce a delivery marker or confirm authority',async()=>{
 for(const rangeHeader of ['bytes=0-1,3-4',`bytes=${bytes.length}-`,'bytes=-0']){const f=memoryFixture();await authorize(f);await assert.rejects(()=>store.auditionComparisonReference(f.db,uid(2),input,f.readPrivate,{rangeHeader}),{code:'comparison_audio_range_invalid',status:416});assert.equal(f.state.calls.filter(c=>c.sql===store.COMPARISON_AUDITION_SQL).length,0);}
});
await check('sixteen incompatible artifacts return a continuation cursor and a later valid candidate remains discoverable',async()=>{
 const f=memoryFixture(),bad=structuredClone(f.state.candidate);bad.reference_rows=[];const page=Array.from({length:16},(_,i)=>({...bad,artifact_id:uid(100+i)})).sort((a,b)=>a.artifact_id.localeCompare(b.artifact_id));let optionsCalls=0;
 const db=async(sql,p)=>{if(sql===store.COMPARISON_CURRENT_SQL)return[];assert.equal(sql,store.COMPARISON_OPTIONS_SQL);optionsCalls++;return p[3]===null?page:[f.state.candidate];};
 const first=await store.comparisonReferenceOptions(db,uid(2),uid(1));assert.equal(first.options.length,0);assert.equal(first.next_cursor,page.at(-1).artifact_id);
 const second=await store.comparisonReferenceOptions(db,uid(2),uid(1),first.next_cursor);assert.equal(second.options.length,1);assert.equal(second.next_cursor,null);assert.equal(optionsCalls,2);
});
await check('delivery is not listening or selection; owner confirmation and reviewed epoch are separate',async()=>{
 const f=memoryFixture(),request=await authorize(f);await assert.rejects(()=>store.confirmComparisonReference(f.db,uid(2),{...input,expected_snapshot_hash:request.expected_snapshot_hash,confirm_this_is_my_voice:true}),{code:'comparison_audition_required'});
 await store.auditionComparisonReference(f.db,uid(2),input,f.readPrivate);await assert.rejects(()=>store.confirmComparisonReference(f.db,uid(2),{...input,expected_snapshot_hash:request.expected_snapshot_hash}),{code:'comparison_confirmation_required'});
 const value=await store.confirmComparisonReference(f.db,uid(2),{...input,expected_snapshot_hash:request.expected_snapshot_hash,confirm_this_is_my_voice:true});assert.equal(value.state,'selected');assert.equal(f.state.candidate.observed_epoch,5);
 assert.equal((await store.readComparisonReference(f.db,uid(2),uid(1),uid(10))).can_audition,true);
});
await check('unknown withdrawal is an honest terminal tombstone, replay stays terminal, no new consent',async()=>{
 const f=memoryFixture();const h=await store.withdrawComparisonReference(f.db,uid(2),input);assert.equal(h.state,'revoked');assert.equal(h.expires_at,null);assert.equal((await store.withdrawComparisonReference(f.db,uid(2),input)).created_at,h.created_at);assert.equal(f.state.candidate.observed_epoch,4);
 const options=await store.comparisonReferenceOptions(f.db,uid(2),uid(1));assert.equal((await store.authorizeComparisonReference(f.db,uid(2),{...input,artifact_id:uid(4),expected_snapshot_hash:options.options[0].snapshot_hash,attestations:attestations()})).state,'revoked');assert.equal(noWrites(f),0);
});
await check('source/receipt replacement blocks existing review and selected permission',async()=>{
 const f=memoryFixture();await authorize(f);f.state.candidate.binding.capture_consent_id=uid(77);const value=await store.readComparisonReference(f.db,uid(2),uid(1),uid(10));assert.equal(value.changed,true);assert.equal(value.can_audition,false);assert.equal(value.can_confirm,false);
});
await check('actual modern issuer consumes purpose receipt and immutable evidence, ordinary branch retained',async()=>{
 const f=memoryFixture(),request=await authorize(f);await store.auditionComparisonReference(f.db,uid(2),input,f.readPrivate);await store.confirmComparisonReference(f.db,uid(2),{...input,expected_snapshot_hash:request.expected_snapshot_hash,confirm_this_is_my_voice:true});
 const h=f.state.rows.get(uid(10)),c=f.state.candidate;
 const b={...c.binding,subject_person_id:uid(20),identity_case_id:uid(21),identity_source_id:uid(22),identity_source_sha256:'c'.repeat(64),reference_authority_epoch:c.observed_epoch,reference_authority_kind:'private_comparison_reference',comparison_reference_id:h.reference_id,comparison_reference_receipt_hash:h.receipt_hash};
 const row={binding:b,reference_rows:c.reference_rows,comparison_receipt:h,server_now:new Date().toISOString(),issuance_fence:[]};
 const descriptor=await getOwnedModernComparisonDescriptor(async()=>[{...b,source_id:uid(3),sha256:b.primary_source_sha256,created_at:new Date().toISOString(),private_text_epoch:b.authority_epoch}],uid(2),uid(1));
 const body={expected_primary_source_id:uid(3),expected_primary_selection_id:uid(6),expected_primary_source_sha256:b.primary_source_sha256,expected_comparison_snapshot_sha256:descriptor.comparison_snapshot_sha256,locale:'en-IN',attestations:Object.fromEntries(BIOMETRIC_VERIFICATION_ATTESTATIONS.map(k=>[k,true])),comparison_attestations:{selected_reference_is_my_voice:true,compare_this_capture_to_selected_reference:true,comparison_is_private_verification_only:true}};
 let writes=0;const db=async(sql,p)=>{if(sql===MODERN_AUTHORITY_SNAPSHOT_SQL)return[row];assert.equal(sql,MODERN_AUTHORITY_ISSUE_SQL);writes++;const receipt=JSON.parse(p[5]);assert.equal(receipt.binding.comparison_reference_id,h.reference_id);return[{challenge_id:receipt.envelope.contract.challengeId,replica_id:uid(1),state:'issued',phrase:receipt.envelope.phrase,attempt:1,issued_at:row.server_now,expires_at:receipt.envelope.contract.expiresAt}];};
 assert.equal((await issueOwnedModernChallenge(db,uid(2),uid(1),body)).state,'issued');assert.equal(writes,1);
 h.receipt_payload.attestations.comparison_only=false;await assert.rejects(()=>issueOwnedModernChallenge(db,uid(2),uid(1),body),{code:'comparison_receipt_invalid'});assert.equal(writes,1);
 assert(MODERN_AUTHORITY_LOAD_SQL.includes('purpose_authority'));assert(MODERN_AUTHORITY_LOAD_SQL.includes("d.decision='accepted'"));
});
await check('SQL preparation retains source ordering, epoch CAS, unique tombstone, owner/source/artifact cascade',()=>{
 assert(store.COMPARISON_CONFIRM_SQL.includes('c.observed_epoch=$6::bigint'));assert(store.COMPARISON_WITHDRAW_SQL.includes("state<>'revoked' returning *"));assert(store.COMPARISON_WITHDRAW_SQL.includes('from cancelled where selected_epoch is not null'));assert(!store.COMPARISON_WITHDRAW_SQL.includes('from prior'));
 const migration=readFileSync(new URL('../../db/migrations/145_private_comparison_reference.sql',import.meta.url),'utf8');assert.equal((migration.match(/on delete cascade/g)||[]).length,3);assert(migration.includes('unique (active_replica_id)'));assert(readFileSync(new URL('../../db/schema.sql',import.meta.url),'utf8').replaceAll('\r\n','\n').includes(migration.replaceAll('\r\n','\n').trim()));
 const all=[store.COMPARISON_AUTHORIZE_SQL,store.COMPARISON_CONFIRM_SQL,store.COMPARISON_WITHDRAW_SQL].join('\n');assert(!/insert into vy_replica_processing_(artifact|evidence)_decision/.test(all));assert(!/\btraining\b/.test(all));
});
await check('range parser rejects multi-range, zero suffix, unsafe and out-of-bounds inputs',()=>{
 assert.deepEqual(comparisonAudioRange('bytes=2-5',10),{start:2,end:5,status:206});assert.deepEqual(comparisonAudioRange('bytes=-2',10),{start:8,end:9,status:206});for(const v of ['bytes=0-1,2-3','bytes=-0','bytes=10-','bytes=2-1','bytes=999999999999999999999-','bytes=0-1\n'])assert.equal(comparisonAudioRange(v,10),null,v);
});
await check('native localhost authenticated handler returns bounded private WAV, no-store, no reusable URL',async()=>{
 const f=memoryFixture();await authorize(f);
 const handler=createComparisonReferenceHandler({...f,requireUser:async req=>{if(req.headers.authorization!=='Bearer synthetic-owner')throw Object.assign(Error('auth'),{status:401});return{id:uid(2)};}});
 const server=createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');req.query=Object.fromEntries(u.searchParams);res.status=n=>{res.statusCode=n;return res;};res.json=d=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(d));};await handler(req,res);});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const url=`http://127.0.0.1:${server.address().port}/?op=audition&replica_id=${uid(1)}&reference_id=${uid(10)}`;
  assert.equal((await fetchNative(url)).status,401);const response=await fetchNative(url,{headers:{Authorization:'Bearer synthetic-owner',Range:'bytes=0-3'}});assert.equal(response.status,206);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('content-range'),`bytes 0-3/${bytes.length}`);assert.equal(response.headers.get('location'),null);assert.equal(Buffer.from(await response.arrayBuffer()).toString(),'RIFF');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
console.log(`comparison-reference ${n} controls passed; SQL is prepared, not parsed or executed`);
