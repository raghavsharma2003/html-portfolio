import {createHash} from 'node:crypto';
import {REPLICA_POLICY_VERSION} from './_replica.js';
import {canonicalJson,sha256Hex} from './_replica-processing/contracts.js';
import {referenceFromAuthority} from './_liveness/reference-evidence.js';

export const COMPARISON_REFERENCE_STATEMENT_SET='private-comparison-reference/v1';
export const COMPARISON_REFERENCE_STATEMENTS=Object.freeze([
  {id:'use_existing_voice_evidence',text:'Use the existing voice evidence from this recording for private comparison.'},
  {id:'comparison_only',text:'This permission does not allow voice generation or training.'},
  {id:'understand_reference_withdrawal',text:'Keep this choice for up to one day. I can withdraw it.'},
]);
export const COMPARISON_AUDITION_MAX_BYTES=67_108_864;
export function comparisonAudioRange(header,length) {
  if(header==null)return {start:0,end:length-1,status:200};
  const m=typeof header==='string'&&/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!m||(!m[1]&&!m[2]))return null;
  let start=m[1]?Number(m[1]):Math.max(0,length-Number(m[2]));
  let end=m[1]?(m[2]?Number(m[2]):length-1):length-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||start>=length||(!m[1]&&Number(m[2])===0))return null;
  return {start,end:Math.min(end,length-1),status:206};
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const id=v=>{if(typeof v!=='string'||v.length!==36||!UUID.test(v))fail('comparison_binding_invalid',400);return v;};
const hash=v=>{if(typeof v!=='string'||v.length!==64||!/^[0-9a-f]{64}$/.test(v))fail('comparison_binding_invalid',400);return v;};
const json=canonicalJson;
async function query(db,sql,params){try{const rows=await db(sql,params);if(!Array.isArray(rows))fail('comparison_database_result_invalid',503);return rows;}catch(e){if(e?.code==='55P03')fail('comparison_authority_busy');throw e;}}

// Source -> replica. Review/issue writers advance the same replica row, so
// a write uses the observed epoch as CAS in addition to immutable input pins.
export const COMPARISON_CANDIDATE_CTES=`comparison_source_rows as materialized (
 select cs.* from vy_replica_source cs where cs.replica_id=$1::uuid and cs.owner_user_id=$2::uuid
 order by cs.source_id for update of cs nowait
), owned as materialized (
 select r.* from vy_replica r where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
 and (select count(*) from comparison_source_rows)>=0 and r.subject_mode='self'
 and r.lifecycle not in ('revoked','purging') and r.policy_version='${REPLICA_POLICY_VERSION}'
 for update of r nowait
), capture as (
 select c.* from vy_replica_consent c join owned r using(replica_id,owner_user_id)
 where c.scope='capture' and c.policy_version=r.policy_version and c.revoked_at is null
 and (c.expires_at is null or c.expires_at>now()) order by c.granted_at desc,c.consent_id limit 1
), storage as (
 select c.* from vy_replica_consent c join owned r using(replica_id,owner_user_id)
 where c.scope='storage' and c.policy_version=r.policy_version and c.revoked_at is null
 and (c.expires_at is null or c.expires_at>now()) order by c.granted_at desc,c.consent_id limit 1
), primary_source as (
 select s.* from comparison_source_rows s join vy_replica_voice_reference v using(source_id,replica_id,owner_user_id)
 where s.state='ready' and s.kind in ('audio','video') and not s.contains_third_parties
 and s.capture_mode in ('upload','import','derived')
 and not(s.capture_mode='derived' and s.provenance->>'purpose'='mirror_window')
 and not exists(select 1 from unnest(array['integrity','malware_scan']::text[]) required(step)
  where not exists(select 1 from vy_replica_processing_job j join vy_replica_processing_attempt a
   on a.job_id=j.job_id and a.attempt=j.attempt and a.outcome='complete'
   where j.source_id=s.source_id and j.replica_id=s.replica_id and j.owner_user_id=s.owner_user_id
   and j.step=required.step and j.state='complete'
   and j.revision=(select max(j2.revision) from vy_replica_processing_job j2 where j2.source_id=j.source_id and j2.step=j.step)
   and j.result->>'verified_input_sha256'=s.sha256 and j.result->>'manifest_hash'=a.result_manifest_hash
   and a.adapter_version<>'' and a.adapter_family||' '||a.adapter_name||' '||a.adapter_version !~* '(fake|fixture|mock|test)'))
), current_job as (
 select j.* from vy_replica_processing_job j join primary_source s using(source_id,replica_id,owner_user_id)
 join vy_replica_processing_attempt a on a.job_id=j.job_id and a.attempt=j.attempt and a.outcome='complete'
 where j.step='voice_quality' and j.state='complete' and j.result->>'verified_input_sha256'=s.sha256
 and j.result->>'manifest_hash'=a.result_manifest_hash
 and j.revision=(select max(j2.revision) from vy_replica_processing_job j2 where j2.source_id=j.source_id and j2.step=j.step)
 and a.adapter_family='voice-analysis' and a.adapter_name='speechbrain-independent-speaker-evidence'
 and a.adapter_version='vyakti-voice-evidence-v2'
), artifacts as (
 select a.* from vy_replica_processing_artifact a join primary_source s using(source_id,replica_id,owner_user_id)
 where a.stage='enhance' and a.mime in ('audio/wav','audio/x-wav') and a.byte_size between 1 and ${COMPARISON_AUDITION_MAX_BYTES}
 and ($3::uuid is null or a.artifact_id=$3::uuid)
 and a.adapter_family||' '||a.adapter_name||' '||a.adapter_version !~* '(fake|fixture|mock|test)'
), candidates as (
 select a.*,r.reference_authority_epoch observed_epoch,
 jsonb_build_object('replica_id',r.replica_id,'owner_user_id',r.owner_user_id,'primary_source_id',s.source_id,
  'policy_version',r.policy_version,'primary_source_sha256',s.sha256,'primary_selection_id',r.primary_selection_id,'authority_epoch',r.private_text_epoch,
  'capture_consent_id',c.consent_id,'storage_consent_id',st.consent_id,'artifact_id',a.artifact_id,'artifact_sha256',a.sha256,
  'artifact_byte_size',a.byte_size,'artifact_mime',a.mime,'job_id',j.job_id,'job_revision',j.revision,
  'evidence_pins',(select jsonb_agg(jsonb_build_object('evidence_id',e.evidence_id,'record_hash',e.record_hash,'decision_id',null) order by e.evidence_id)
    from vy_replica_processing_evidence e where e.created_by_job_id=j.job_id and e.source_id=s.source_id and e.replica_id=r.replica_id and e.owner_user_id=r.owner_user_id
    and ((e.evidence_type='voice_embedding' and e.artifact_id=a.artifact_id and e.input_sha256=a.sha256)
      or(e.evidence_type='voice_measurement' and e.value->'input_set' @> jsonb_build_array(jsonb_build_object('artifact_id',a.artifact_id,'sha256',a.sha256)))))) binding,
 (select jsonb_agg(to_jsonb(e)||jsonb_build_object('decision_id',null) order by e.evidence_id)
    from vy_replica_processing_evidence e where e.created_by_job_id=j.job_id and e.source_id=s.source_id and e.replica_id=r.replica_id and e.owner_user_id=r.owner_user_id
    and ((e.evidence_type='voice_embedding' and e.artifact_id=a.artifact_id and e.input_sha256=a.sha256)
      or(e.evidence_type='voice_measurement' and e.value->'input_set' @> jsonb_build_array(jsonb_build_object('artifact_id',a.artifact_id,'sha256',a.sha256))))) reference_rows,
 s.created_at source_created_at,least(now()+interval '23 hours',coalesce(c.expires_at,'infinity'::timestamptz),coalesce(st.expires_at,'infinity'::timestamptz)) expires_at
 from artifacts a join primary_source s using(source_id,replica_id,owner_user_id) join owned r using(replica_id,owner_user_id)
 cross join capture c cross join storage st cross join current_job j
)`;
export const COMPARISON_OPTIONS_SQL=`with ${COMPARISON_CANDIDATE_CTES} select * from candidates where ($4::uuid is null or artifact_id>$4::uuid) order by artifact_id limit 16`;
export const COMPARISON_READ_SQL=`select h.* from vy_replica_comparison_reference h
 where h.replica_id=$1::uuid and h.owner_user_id=$2::uuid and ($3::uuid is null or h.reference_id=$3::uuid)
 order by h.created_at desc,h.reference_id desc limit 32`;
export const COMPARISON_CURRENT_SQL=`select h.* from vy_replica_comparison_reference h where h.replica_id=$1::uuid and h.owner_user_id=$2::uuid and h.state='selected'`;
export const COMPARISON_AUTHORIZE_SQL=`with ${COMPARISON_CANDIDATE_CTES}, eligible as (
 select c.* from candidates c where c.binding=$6::jsonb and c.observed_epoch=$7::bigint
 and (select count(*) from vy_replica_comparison_reference h where h.replica_id=$1::uuid and h.owner_user_id=$2::uuid and h.created_at>now()-interval '1 day')<32
), inserted as (
 insert into vy_replica_comparison_reference(reference_id,replica_id,owner_user_id,source_id,artifact_id,state,receipt_payload,receipt_hash,observed_epoch,expires_at)
 select $4::uuid,$1::uuid,$2::uuid,c.source_id,c.artifact_id,'review',$5::jsonb,$8,c.observed_epoch,least(c.expires_at,($5::jsonb->>'expires_at')::timestamptz)
 from eligible c on conflict(reference_id) do nothing returning *
) select * from inserted`;
export const COMPARISON_AUDITION_SQL=`with ${COMPARISON_CANDIDATE_CTES}, delivered as (
 update vy_replica_comparison_reference h set audition_response_at=now() from candidates c
 where h.reference_id=$4::uuid and h.replica_id=$1::uuid and h.owner_user_id=$2::uuid
 and h.artifact_id=c.artifact_id and h.receipt_hash=$5 and h.receipt_payload->'binding'=c.binding
 and h.state in ('review','selected') and h.expires_at>now()
 and (h.state='selected' or h.observed_epoch=c.observed_epoch) returning h.*
) select * from delivered`;
export const COMPARISON_CONFIRM_SQL=`with ${COMPARISON_CANDIDATE_CTES}, eligible as materialized (
 select h.reference_id,c.observed_epoch from vy_replica_comparison_reference h join candidates c on c.artifact_id=h.artifact_id
 where h.reference_id=$4::uuid and h.replica_id=$1::uuid and h.owner_user_id=$2::uuid and h.state='review'
 and h.receipt_hash=$5 and h.receipt_payload->'binding'=c.binding and h.expires_at>now()
 and h.audition_response_at is not null and h.observed_epoch=c.observed_epoch and c.observed_epoch=$6::bigint
), superseded as (
 update vy_replica_comparison_reference h set state='revoked',revoked_at=now(),receipt_payload=null,receipt_hash=null
 where h.replica_id=$1::uuid and h.owner_user_id=$2::uuid and h.state='selected' and exists(select 1 from eligible)
 returning h.reference_id
), advanced as (
 update vy_replica r set reference_authority_epoch=r.reference_authority_epoch+1
 where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.reference_authority_epoch=$6::bigint
 and exists(select 1 from eligible) and (select count(*) from superseded)>=0 returning r.reference_authority_epoch
), selected as (
 update vy_replica_comparison_reference h set state='selected',confirmed_at=now(),selected_epoch=a.reference_authority_epoch
 from advanced a where h.reference_id in(select reference_id from eligible) returning h.*
) select * from selected`;
// The permanent request key also cancels an authorize whose response is unknown.
// Only exact-scope conflicts may update a row. A late INSERT then conflicts.
export const COMPARISON_WITHDRAW_SQL=`with comparison_source_rows as materialized (
 select source_id from vy_replica_source where replica_id=$1::uuid and owner_user_id=$2::uuid order by source_id for update nowait
), owned as materialized (
 select * from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid and (select count(*) from comparison_source_rows)>=0 for update nowait
), cancelled as (
 insert into vy_replica_comparison_reference(reference_id,replica_id,owner_user_id,state,revoked_at)
 select $3::uuid,$1::uuid,$2::uuid,'revoked',now() from owned
 on conflict(reference_id) do update set state='revoked',revoked_at=coalesce(vy_replica_comparison_reference.revoked_at,now()),receipt_payload=null,receipt_hash=null
 where vy_replica_comparison_reference.replica_id=$1::uuid and vy_replica_comparison_reference.owner_user_id=$2::uuid
 and vy_replica_comparison_reference.state<>'revoked' returning *
), advanced as (
 update vy_replica r set reference_authority_epoch=r.reference_authority_epoch+1 where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
 and exists(select 1 from cancelled where selected_epoch is not null) returning r.replica_id
) select cancelled.* from cancelled where (select count(*) from advanced)>=0`;

function attest(value){if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==3||COMPARISON_REFERENCE_STATEMENTS.some(s=>!Object.hasOwn(Object.getOwnPropertyDescriptor(value,s.id)||{},'value')||value[s.id]!==true))fail('comparison_explicit_consent_required',400);return Object.fromEntries(COMPARISON_REFERENCE_STATEMENTS.map(s=>[s.id,true]));}
function candidate(row){referenceFromAuthority(row);const epoch=Number(row.observed_epoch);if(!Number.isSafeInteger(epoch)||epoch<0)fail('comparison_epoch_invalid',503);return {...row,observed_epoch:epoch,snapshot_hash:sha256Hex({binding:row.binding,observed_epoch:epoch})};}
function publicReference(h){return {reference_id:h.reference_id,replica_id:h.replica_id,state:h.state==='revoked'?'revoked':Date.parse(h.expires_at)<=Date.now()?'expired':h.state,created_at:new Date(h.created_at).toISOString(),expires_at:h.expires_at?new Date(h.expires_at).toISOString():null};}
export function validateComparisonReferenceReceipt(h){const p=h?.receipt_payload;if(!p||p.binding?.policy_version!==REPLICA_POLICY_VERSION||h.receipt_hash!==sha256Hex(p)||p.statement_set!==COMPARISON_REFERENCE_STATEMENT_SET||p.reference_id!==h.reference_id||p.binding?.replica_id!==h.replica_id||p.binding?.owner_user_id!==h.owner_user_id||p.binding?.primary_source_id!==h.source_id||p.binding?.artifact_id!==h.artifact_id)fail('comparison_receipt_invalid');attest(p.attestations);return p;}
async function currentCandidate(db,owner,rid,artifact){const rows=await query(db,COMPARISON_OPTIONS_SQL,[id(rid),id(owner),id(artifact),null]);if(rows.length!==1)fail('comparison_reference_unavailable');return candidate(rows[0]);}
async function readRow(db,owner,rid,reference){const rows=await query(db,COMPARISON_READ_SQL,[id(rid),id(owner),id(reference)]);if(rows.length!==1)fail('comparison_reference_not_found',404);return rows[0];}
async function authorized(db,owner,rid,reference){const h=await readRow(db,owner,rid,reference);const p=validateComparisonReferenceReceipt(h);if(!['review','selected'].includes(h.state)||Date.parse(h.expires_at)<=Date.now())fail('comparison_reference_withdrawn');const c=await currentCandidate(db,owner,rid,h.artifact_id);if(json(p.binding)!==json(c.binding)||(h.state==='review'&&Number(h.observed_epoch)!==c.observed_epoch))fail('comparison_reference_changed');return {h,c};}

export async function comparisonReferenceOptions(db,owner,rid,cursor=null){const rows=await query(db,COMPARISON_OPTIONS_SQL,[id(rid),id(owner),null,cursor===null?null:id(cursor)]);const options=[];for(const row of rows){try{const c=candidate(row);options.push({artifact_id:c.artifact_id,source_id:c.source_id,source_created_at:new Date(c.source_created_at).toISOString(),duration_ms:c.duration_ms==null?null:Number(c.duration_ms),mime:c.mime,snapshot_hash:c.snapshot_hash});}catch(e){if(!['reference_unavailable','reference_revision_unavailable','reference_record_mismatch','reference_input_mismatch'].some(code=>e.code===`liveness_issued_capture_${code}`))throw e;}}
 const current=await query(db,COMPARISON_CURRENT_SQL,[id(rid),id(owner)]);if(current.length>1)fail('comparison_current_ambiguous',503);return {replica_id:rid,state:options.length?'available':'unavailable',options,current_reference:current[0]?publicReference(current[0]):null,next_cursor:rows.length===16?id(rows[15].artifact_id):null,statement_set:COMPARISON_REFERENCE_STATEMENT_SET,statements:COMPARISON_REFERENCE_STATEMENTS,capture_ready:false};}
export async function readComparisonReference(db,owner,rid,reference){const h=await readRow(db,owner,rid,reference);const pub=publicReference(h);if(['revoked','expired'].includes(pub.state))return {...pub,can_audition:false,can_confirm:false};try{const {c}=await authorized(db,owner,rid,reference);return {...pub,artifact_id:h.artifact_id,source_id:h.source_id,source_created_at:new Date(c.source_created_at).toISOString(),duration_ms:c.duration_ms==null?null:Number(c.duration_ms),snapshot_hash:c.snapshot_hash,can_audition:true,can_confirm:h.state==='review'&&!!h.audition_response_at};}catch(e){if(e.status===409)return {...pub,can_audition:false,can_confirm:false,changed:true};throw e;}}
export async function authorizeComparisonReference(db,owner,input){const rid=id(input.replica_id),reference=id(input.reference_id),artifact=id(input.artifact_id);const choices=attest(input.attestations);hash(input.expected_snapshot_hash);
 const prior=await query(db,COMPARISON_READ_SQL,[rid,id(owner),reference]);if(prior.length){const h=prior[0];if(h.state==='revoked')return publicReference(h);const p=validateComparisonReferenceReceipt(h);if(p.artifact_id!==artifact||p.preview_hash!==input.expected_snapshot_hash)fail('comparison_request_reused');return readComparisonReference(db,owner,rid,reference);}
 const c=await currentCandidate(db,owner,rid,artifact);if(c.snapshot_hash!==input.expected_snapshot_hash)fail('comparison_reference_changed');const payload={statement_set:COMPARISON_REFERENCE_STATEMENT_SET,reference_id:reference,artifact_id:artifact,binding:c.binding,preview_hash:c.snapshot_hash,attestations:choices,expires_at:new Date(c.expires_at).toISOString()};
 const rows=await query(db,COMPARISON_AUTHORIZE_SQL,[rid,owner,artifact,reference,json(payload),json(c.binding),c.observed_epoch,sha256Hex(payload)]);if(!rows[0])fail('comparison_authorize_conflict');return publicReference(rows[0]);}
export async function auditionComparisonReference(db,owner,input,readPrivate,{signal,rangeHeader}={}){const rid=id(input.replica_id),reference=id(input.reference_id);const {h,c}=await authorized(db,owner,rid,reference);signal?.throwIfAborted();const value=await readPrivate({storageBucket:c.storage_bucket,objectPath:c.object_path},{maxBytes:COMPARISON_AUDITION_MAX_BYTES,signal});signal?.throwIfAborted();const bytes=Buffer.from(value.body);
 if(bytes.length!==Number(c.byte_size)||bytes.length>COMPARISON_AUDITION_MAX_BYTES||createHash('sha256').update(bytes).digest('hex')!==c.sha256||!['audio/wav','audio/x-wav'].includes(value.mime))fail('comparison_audition_bytes_changed');
 const range=comparisonAudioRange(rangeHeader,bytes.length);if(!range)throw Object.assign(new Error('comparison_audio_range_invalid'),{code:'comparison_audio_range_invalid',status:416,byteLength:bytes.length});
 const fresh=await authorized(db,owner,rid,reference);if(fresh.h.receipt_hash!==h.receipt_hash||fresh.c.snapshot_hash!==c.snapshot_hash)fail('comparison_reference_changed');
 signal?.throwIfAborted();const rows=await query(db,COMPARISON_AUDITION_SQL,[rid,owner,h.artifact_id,reference,h.receipt_hash]);if(!rows[0])fail('comparison_reference_changed');signal?.throwIfAborted();return {body:bytes,mime:c.mime,reference_id:reference,range};}
export async function confirmComparisonReference(db,owner,input){if(input.confirm_this_is_my_voice!==true)fail('comparison_confirmation_required',400);const rid=id(input.replica_id),reference=id(input.reference_id);hash(input.expected_snapshot_hash);const {h,c}=await authorized(db,owner,rid,reference);if(c.snapshot_hash!==input.expected_snapshot_hash)fail('comparison_reference_changed');if(h.state==='selected')return publicReference(h);if(!h.audition_response_at)fail('comparison_audition_required');const rows=await query(db,COMPARISON_CONFIRM_SQL,[rid,owner,h.artifact_id,reference,h.receipt_hash,c.observed_epoch]);if(!rows[0])fail('comparison_confirmation_conflict');return publicReference(rows[0]);}
export async function withdrawComparisonReference(db,owner,input){const rows=await query(db,COMPARISON_WITHDRAW_SQL,[id(input.replica_id),id(owner),id(input.reference_id)]);if(rows[0])return publicReference(rows[0]);const h=await readRow(db,owner,input.replica_id,input.reference_id);if(h.state!=='revoked')fail('comparison_withdraw_conflict');return publicReference(h);}
