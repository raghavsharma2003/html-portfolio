import {createHash} from 'node:crypto';
import {canonicalJson} from './_replica-processing/contracts.js';
import {OPEN_CHATTERBOX_HINDI_PACK_COMMITMENT} from './_voice/providers/open-chatterbox-preview.js';
import {voiceLanguageConditioning,voiceScriptMode} from './_voice/language-conditioning.js';

export const PRIVATE_VOICE_SCOPE='private_voice_test';
export const PRIVATE_VOICE_STATEMENT_SET='private-own-voice/v1';
export const PRIVATE_VOICE_STATEMENT='This recording is my own voice. Use it to make this private AI voice sample for me.';
export const PRIVATE_VOICE_TEXT='आज हम इस सवाल को धीरे धीरे समझेंगे, फिर सही उत्तर निकालेंगे।';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
export function privateVoiceError(code,status=409){return Object.assign(new Error(code),{code,status});}
const fail=(code,status)=>{throw privateVoiceError(code,status);};
const id=value=>{if(typeof value!=='string'||!UUID.test(value))fail('private_voice_identifier_invalid',400);return value.toLowerCase();};
export const privateVoiceHash=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const json=value=>typeof value==='string'?JSON.parse(value):value;

// Server policy, never supplied by request JSON. Unknown language stays unknown;
// the retained owner's transcript and identity-anchor provenance do not transfer.
export function privateVoiceSampleConfig(){
  const style={exaggeration:0.2,cfgWeight:0.78,temperature:0.6};
  return {version:'private-hindi-sample/v1',scope:PRIVATE_VOICE_SCOPE,text:PRIVATE_VOICE_TEXT,
    text_sha256:createHash('sha256').update(PRIVATE_VOICE_TEXT).digest('hex'),language_id:'hi',
    model_arm:'hindi_v3',model_commitment:OPEN_CHATTERBOX_HINDI_PACK_COMMITMENT,seed:31001,style,
    conditioning:voiceLanguageConditioning({languageId:'hi',referenceLanguageMode:'unknown',referenceLanguageEvidenceScope:'unverified',
      textLanguageMode:voiceScriptMode(PRIVATE_VOICE_TEXT).mode,requestedCfgWeight:style.cfgWeight,disclosureLanguageId:'hi'}),
    text_provenance:'server_fixed_sample',reference_language_provenance:'unassessed',
    identity_scope:'account_self_attestation',identity_claim_allowed:false,release_eligible:false,training_allowed:false};
}

// All input IDs are selectors, never authority. Lock source before replica,
// matching source retirement. Snapshot comparison at admission catches changes.
export const PRIVATE_VOICE_CANDIDATE_CTES=`source_rows as materialized (
 select s.* from vy_replica_source s where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid
 and ($3::uuid is null or s.source_id=$3::uuid) order by s.source_id for update of s nowait
), owned as materialized (
 select r.* from vy_replica r where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
 and (select count(*) from source_rows)>=0 and r.subject_mode='self'
 and r.lifecycle not in ('revoked','purging') and r.policy_version='replica-self-v1' for update of r nowait
), candidates as (
 select a.*,jsonb_build_object('replica_id',r.replica_id,'owner_user_id',r.owner_user_id,
 'source_id',s.source_id,'source_sha256',s.sha256,'artifact_id',a.artifact_id,'artifact_sha256',a.sha256,
 'artifact_manifest_hash',a.manifest_hash,'byte_size',a.byte_size,'duration_ms',a.duration_ms,
 'storage_bucket',a.storage_bucket,'object_path',a.object_path,'mime',a.mime,
 'job_id',j.job_id,'job_revision',j.revision,'job_manifest_hash',j.result->>'manifest_hash',
 'authority_epoch',r.private_text_epoch::text,'capture_consent_id',cc.consent_id,
 'capture_receipt_hash',cc.receipt_hash,'storage_consent_id',st.consent_id,'storage_receipt_hash',st.receipt_hash) snapshot
 from source_rows s join owned r using(replica_id,owner_user_id)
 join vy_replica_consent cc on cc.consent_id=s.consent_id and cc.replica_id=r.replica_id and cc.owner_user_id=r.owner_user_id
 join lateral (select c.* from vy_replica_consent c where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
   and c.scope='storage' and c.policy_version=r.policy_version and c.revoked_at is null
   and (c.expires_at is null or c.expires_at>now()) order by c.granted_at desc,c.consent_id desc limit 1) st on true
 join vy_replica_processing_artifact a on a.source_id=s.source_id and a.replica_id=r.replica_id and a.owner_user_id=r.owner_user_id
 join vy_replica_processing_job j on j.job_id=a.created_by_job_id and j.source_id=s.source_id
   and j.replica_id=r.replica_id and j.owner_user_id=r.owner_user_id
 join vy_replica_processing_attempt pa on pa.job_id=j.job_id and pa.attempt=j.attempt and pa.outcome='complete'
 where s.state='ready' and s.kind in ('audio','video') and s.purpose='memory' and s.capture_mode in ('upload','import')
 and s.contains_third_parties=false and cc.scope='capture' and cc.policy_version=r.policy_version
 and cc.revoked_at is null and (cc.expires_at is null or cc.expires_at>now())
 and ($4::uuid is null or a.artifact_id=$4::uuid) and a.stage='enhance' and a.mime in ('audio/wav','audio/x-wav')
 and a.byte_size between 1 and 20971520 and a.duration_ms between 5000 and 90000
 and a.object_path like r.owner_user_id::text||'/'||r.replica_id::text||'/'||s.source_id::text||'/derived/%'
 and a.object_path !~ '://' and j.step='enhance' and j.state='complete'
 and j.revision=(select max(j2.revision) from vy_replica_processing_job j2 where j2.source_id=s.source_id
   and j2.replica_id=r.replica_id and j2.owner_user_id=r.owner_user_id and j2.step='enhance')
 and j.result->>'verified_input_sha256'=s.sha256 and j.result->>'manifest_hash'=pa.result_manifest_hash
 and (j.result->'artifact_ids') ? a.artifact_id::text
 and a.adapter_family||' '||a.adapter_name||' '||a.adapter_version !~* '(fake|fixture|mock|test)'
 and pa.adapter_version<>'' and pa.adapter_family||' '||pa.adapter_name||' '||pa.adapter_version !~* '(fake|fixture|mock|test)'
 and not exists(select 1 from unnest(array['integrity','malware_scan']::text[]) required(step)
   where not exists(select 1 from vy_replica_processing_job k join vy_replica_processing_attempt ka
     on ka.job_id=k.job_id and ka.attempt=k.attempt and ka.outcome='complete'
     where k.source_id=s.source_id and k.replica_id=r.replica_id and k.owner_user_id=r.owner_user_id
     and k.step=required.step and k.state='complete' and k.revision=(select max(k2.revision)
       from vy_replica_processing_job k2 where k2.source_id=s.source_id and k2.replica_id=r.replica_id
       and k2.owner_user_id=r.owner_user_id and k2.step=k.step)
     and k.result->>'verified_input_sha256'=s.sha256 and k.result->>'manifest_hash'=ka.result_manifest_hash
     and ka.adapter_version<>'' and ka.adapter_family||' '||ka.adapter_name||' '||ka.adapter_version !~* '(fake|fixture|mock|test)'))
)`;
export const PRIVATE_VOICE_CANDIDATES_SQL=`with ${PRIVATE_VOICE_CANDIDATE_CTES} select snapshot from candidates order by source_id,artifact_id limit 32`;
export const PRIVATE_VOICE_READ_SQL=`select h.*,l.state window_state,w.resource_released_at from vy_private_voice_run h
 left join vy_voice_app_lifecycle l using(window_id) left join vy_gpu_allocation_window w using(window_id)
 where h.replica_id=$1::uuid and h.owner_user_id=$2::uuid and ($3::uuid is null or h.run_id=$3::uuid)
 order by h.created_at desc,h.run_id desc limit 32`;
export const PRIVATE_VOICE_ADMIT_SQL=`with ${PRIVATE_VOICE_CANDIDATE_CTES}, admitted as (
 insert into vy_private_voice_run(run_id,replica_id,owner_user_id,source_id,artifact_id,request_hash,snapshot_hash,snapshot,
 receipt,receipt_hash,config,config_hash,reference_sha256,text_sha256,output_storage_bucket,output_object_path,expires_at)
 select $5::uuid,$1::uuid,$2::uuid,source_id,artifact_id,$6,$7,snapshot,$9::jsonb,$10,$11::jsonb,$12,
 snapshot->>'artifact_sha256',$11::jsonb->>'text_sha256',storage_bucket,
 $2::uuid::text||'/'||$1::uuid::text||'/'||source_id::text||'/derived/private-voice/'||$5::uuid::text||'.wav',$13::timestamptz
 from candidates where snapshot=$8::jsonb and $13::timestamptz>now()
 on conflict(run_id) do nothing returning run_id
) select run_id from admitted`;
export const PRIVATE_VOICE_REVOKE_SQL=`with revoked as (
 update vy_private_voice_run set state='revoked',revoked_at=coalesce(revoked_at,now()),updated_at=now()
 where replica_id=$1::uuid and owner_user_id=$2::uuid and run_id=$3::uuid returning window_id
), closing as (update vy_voice_app_lifecycle l set state='closing' from revoked r
 where l.window_id=r.window_id and l.state='open' returning l.window_id) select window_id from revoked`;

async function query(db,sql,params){try{return await db(sql,params);}catch(e){if(e?.code==='55P03')fail('private_voice_source_busy');throw e;}}
function tuple(owner,input,optional=false){return [id(input.replica_id),id(owner),input.source_id?id(input.source_id):optional?null:fail('private_voice_source_required',400),input.artifact_id?id(input.artifact_id):optional?null:fail('private_voice_artifact_required',400)];}
function wire(row,now){
 const expired=Date.parse(row.expires_at)<=now;
 return {run_id:row.run_id,source_id:row.source_id,artifact_id:row.artifact_id,state:row.revoked_at?'revoked':expired?'expired':row.state,
   scope:PRIVATE_VOICE_SCOPE,identity_scope:'account_self_attestation',release_eligible:false,identity_claim_allowed:false,
   config:json(row.config),created_at:row.created_at,expires_at:row.expires_at,error_code:row.error_code||null,
   cleanup_pending:!!row.window_id&&(row.window_state!=='terminal_observed'||!row.resource_released_at),
   metrics:row.metrics||null,ratings:row.ratings||null,audio_available:!expired&&!row.revoked_at&&row.state==='ready'&&!!row.output_sha256};
}
function inputRequest(input){
 const allowed=['action','replica_id','source_id','artifact_id','run_id','expected_snapshot_hash','statement_set','attestations'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))fail('private_voice_unexpected_input',400);
 if(!HASH.test(input.expected_snapshot_hash||'')||input.statement_set!==PRIVATE_VOICE_STATEMENT_SET||
   !input.attestations||Object.keys(input.attestations).join(',')!=='own_voice_private_use'||input.attestations.own_voice_private_use!==true)
   fail('private_voice_self_use_required',400);
 return {replica_id:id(input.replica_id),source_id:id(input.source_id),artifact_id:id(input.artifact_id),run_id:id(input.run_id),
   expected_snapshot_hash:input.expected_snapshot_hash,statement_set:PRIVATE_VOICE_STATEMENT_SET,attestations:{own_voice_private_use:true}};
}
function assertReceipt(row){
 const receipt=json(row.receipt),snapshot=json(row.snapshot),config=json(row.config);
 if(privateVoiceHash(receipt)!==row.receipt_hash||privateVoiceHash(snapshot)!==row.snapshot_hash||privateVoiceHash(config)!==row.config_hash||
   receipt.scope!==PRIVATE_VOICE_SCOPE||receipt.statement_set!==PRIVATE_VOICE_STATEMENT_SET||receipt.attestations?.own_voice_private_use!==true||
   receipt.owner_user_id!==row.owner_user_id||receipt.replica_id!==row.replica_id||receipt.run_id!==row.run_id||
   receipt.snapshot_hash!==row.snapshot_hash||receipt.config_hash!==row.config_hash||receipt.expires_at!==new Date(row.expires_at).toISOString()||
   config.identity_claim_allowed!==false||config.release_eligible!==false||config.training_allowed!==false||
   snapshot.owner_user_id!==row.owner_user_id||snapshot.replica_id!==row.replica_id||
   createHash('sha256').update(config.text).digest('hex')!==row.text_sha256||
   receipt.identity_claim_allowed!==false||receipt.release_eligible!==false||receipt.training_allowed!==false||
   snapshot.artifact_sha256!==row.reference_sha256||snapshot.artifact_id!==row.artifact_id||snapshot.source_id!==row.source_id||
   config.text_sha256!==row.text_sha256)fail('private_voice_receipt_invalid',503);
 return {receipt,snapshot,config};
}
async function rowFor(db,owner,input){return (await query(db,PRIVATE_VOICE_READ_SQL,[id(input.replica_id),id(owner),id(input.run_id)]))[0]||null;}

// The following CPU batch must call this before byte reads, activation,
// child consumption and playback; do not treat a past admission as current.
export async function requirePrivateVoiceRun(db,owner,input,{now=Date.now}={}){
 const row=await rowFor(db,owner,input);
 if(!row||row.revoked_at||row.state==='revoked'||Date.parse(row.expires_at)<=now())fail('private_voice_request_unavailable',404);
 const {snapshot}=assertReceipt(row);
 const current=await query(db,PRIVATE_VOICE_CANDIDATES_SQL,[row.replica_id,row.owner_user_id,row.source_id,row.artifact_id]);
 if(current.length!==1||privateVoiceHash(json(current[0].snapshot))!==row.snapshot_hash)fail('private_voice_authority_changed');
 // Re-read after material authority: withdrawal between the reads wins.
 const latest=await rowFor(db,owner,input);
 if(!latest||latest.revoked_at||Date.parse(latest.expires_at)<=now()||latest.receipt_hash!==row.receipt_hash)fail('private_voice_request_unavailable',404);
 assertReceipt(latest);
 return {...latest,reference:{storageBucket:snapshot.storage_bucket,objectPath:snapshot.object_path,sha256:row.reference_sha256,
   byteSize:Number(snapshot.byte_size),durationMs:Number(snapshot.duration_ms),mime:snapshot.mime}};
}
export function createPrivateVoiceStore({db,now=Date.now}={}){
 if(typeof db!=='function')throw new TypeError('private_voice_database_required');
 return {
   async candidates(owner,input){
     const rows=await query(db,PRIVATE_VOICE_CANDIDATES_SQL,tuple(owner,input,true));
     return {scope:PRIVATE_VOICE_SCOPE,statement_set:PRIVATE_VOICE_STATEMENT_SET,statement:PRIVATE_VOICE_STATEMENT,config:privateVoiceSampleConfig(),
       candidates:rows.map(row=>{const s=json(row.snapshot);return {source_id:s.source_id,artifact_id:s.artifact_id,reference_sha256:s.artifact_sha256,
         duration_ms:Number(s.duration_ms),snapshot_hash:privateVoiceHash(s)};})};
   },
   async admit(owner,input){
     const normalized=inputRequest(input),args=tuple(owner,normalized),requestHash=privateVoiceHash(normalized);
     const prior=await rowFor(db,owner,normalized);
     if(prior){if(prior.request_hash!==requestHash)fail('private_voice_request_conflict');return {created:false,run:wire(await requirePrivateVoiceRun(db,owner,normalized,{now}),now())};}
     const rows=await query(db,PRIVATE_VOICE_CANDIDATES_SQL,args);
     if(rows.length!==1)fail('private_voice_reference_unavailable');
     const snapshot=json(rows[0].snapshot),snapshotHash=privateVoiceHash(snapshot);
     if(snapshotHash!==normalized.expected_snapshot_hash)fail('private_voice_inputs_changed');
     const config=privateVoiceSampleConfig(),configHash=privateVoiceHash(config),expires=new Date(now()+86400000).toISOString();
     const receipt={scope:PRIVATE_VOICE_SCOPE,statement_set:PRIVATE_VOICE_STATEMENT_SET,method:'account_attestation',
       owner_user_id:args[1],replica_id:args[0],run_id:normalized.run_id,attestations:normalized.attestations,
       snapshot_hash:snapshotHash,config_hash:configHash,granted_at:new Date(now()).toISOString(),expires_at:expires,
       identity_claim_allowed:false,release_eligible:false,training_allowed:false};
     const inserted=await query(db,PRIVATE_VOICE_ADMIT_SQL,[...args,normalized.run_id,requestHash,snapshotHash,JSON.stringify(snapshot),
       JSON.stringify(receipt),privateVoiceHash(receipt),JSON.stringify(config),configHash,expires]);
     const confirmed=await rowFor(db,owner,normalized);
     if(!confirmed)fail('private_voice_admission_changed');
     if(confirmed.request_hash!==requestHash)fail('private_voice_request_conflict');
     return {created:inserted.length===1,run:wire(await requirePrivateVoiceRun(db,owner,normalized,{now}),now())};
   },
   async status(owner,input){
     const row=await rowFor(db,owner,input);if(!row)fail('private_voice_request_unavailable',404);
     if(row.revoked_at||row.state==='revoked'||Date.parse(row.expires_at)<=now())return wire(row,now());
     return wire(await requirePrivateVoiceRun(db,owner,input,{now}),now());
   },
   async revoke(owner,input){
     const changed=await query(db,PRIVATE_VOICE_REVOKE_SQL,[id(input.replica_id),id(owner),id(input.run_id)]);
     if(!changed.length)fail('private_voice_request_unavailable',404);
     return this.status(owner,input);
   },
 };
}

