import {PRIVATE_VOICE_CANDIDATES_SQL,PRIVATE_VOICE_READ_SQL,PRIVATE_VOICE_ADMIT_SQL,PRIVATE_VOICE_REVOKE_SQL,privateVoiceHash} from '../../api/_private-voice-store.js';
export const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const RID='11111111-1111-4111-8111-111111111111',SID='22222222-2222-4222-8222-222222222222';
export const AID='33333333-3333-4333-8333-333333333333',RUN='44444444-4444-4444-8444-444444444444';
export const NOW=Date.parse('2026-09-14T12:00:00.000Z');
export function fixture(){
 const snapshot={replica_id:RID,owner_user_id:OWNER,source_id:SID,source_sha256:'a'.repeat(64),artifact_id:AID,artifact_sha256:'b'.repeat(64),
 artifact_manifest_hash:'c'.repeat(64),byte_size:480044,duration_ms:10000,storage_bucket:'replica-private',
 object_path:`${OWNER}/${RID}/${SID}/derived/reference.wav`,mime:'audio/wav',job_id:'55555555-5555-4555-8555-555555555555',
 job_revision:1,job_manifest_hash:'d'.repeat(64),authority_epoch:'0',capture_consent_id:'66666666-6666-4666-8666-666666666666',
 capture_receipt_hash:'e'.repeat(64),storage_consent_id:'77777777-7777-4777-8777-777777777777',storage_receipt_hash:'f'.repeat(64)};
 const input={action:'generate',replica_id:RID,source_id:SID,artifact_id:AID,run_id:RUN,expected_snapshot_hash:privateVoiceHash(snapshot),
 statement_set:'private-own-voice/v1',attestations:{own_voice_private_use:true}};
 const state={snapshot,rows:new Map(),calls:[],live:true,beforeQuery:null};
 const db=async(sql,params)=>{
   state.calls.push({sql,params:structuredClone(params)});await state.beforeQuery?.(sql,params);
   if(sql===PRIVATE_VOICE_CANDIDATES_SQL)return state.live&&params[0]===RID&&params[1]===OWNER&&(!params[2]||params[2]===SID)&&(!params[3]||params[3]===AID)?[{snapshot:structuredClone(state.snapshot)}]:[];
   if(sql===PRIVATE_VOICE_READ_SQL){const row=state.rows.get(params[2]);return row&&row.replica_id===params[0]&&row.owner_user_id===params[1]?[structuredClone(row)]:[];}
   if(sql===PRIVATE_VOICE_ADMIT_SQL){
     if(!state.live||state.rows.has(params[4])||params[1]!==OWNER||privateVoiceHash(JSON.parse(params[7]))!==privateVoiceHash(state.snapshot))return [];
     state.rows.set(params[4],{run_id:params[4],replica_id:params[0],owner_user_id:params[1],source_id:params[2],artifact_id:params[3],
       request_hash:params[5],snapshot_hash:params[6],snapshot:JSON.parse(params[7]),receipt:JSON.parse(params[8]),receipt_hash:params[9],
       config:JSON.parse(params[10]),config_hash:params[11],expires_at:params[12],reference_sha256:state.snapshot.artifact_sha256,
       text_sha256:JSON.parse(params[10]).text_sha256,state:'queued',created_at:new Date(NOW).toISOString(),revoked_at:null,
       output_storage_bucket:state.snapshot.storage_bucket,output_object_path:`${OWNER}/${RID}/${SID}/derived/private-voice/${params[4]}.wav`});return [{run_id:params[4]}];
   }
   if(sql===PRIVATE_VOICE_REVOKE_SQL){const row=state.rows.get(params[2]);if(!row||row.replica_id!==params[0]||row.owner_user_id!==params[1])return [];row.state='revoked';row.revoked_at=new Date(NOW).toISOString();return [{window_id:row.window_id||null}];}
   throw Error('unexpected_sql');
 };
 return {state,db,input};
}
