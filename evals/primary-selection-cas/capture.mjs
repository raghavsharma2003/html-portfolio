import { requestOwnedVoiceGenomeBuild, advanceOwnedVoiceBuildIntent } from '../../api/_replica-build-intent.js';
import { setOwnedPrimaryVoiceSource, markOwnedSourceDeleting } from '../../api/_replica-source.js';
import { completeSourceErasure } from '../../api/_replica-source-erasure.js';

export const IDS = Object.freeze({owner:'10000000-0000-4000-8000-000000000001',
  replica:'20000000-0000-4000-8000-000000000002',source:'30000000-0000-4000-8000-000000000003',
  intent:'40000000-0000-4000-8000-000000000004',build:'50000000-0000-4000-8000-000000000005',
  epoch:'60000000-0000-4000-8000-000000000006'});
export const LEASE_TOKEN='synthetic-primary-selection-erasure-token-with-thirty-two-bytes';
export function intentRow(extra={}) { return {intent_id:IDS.intent,replica_id:IDS.replica,
  owner_user_id:IDS.owner,candidate_source_id:IDS.source,state:'queued',build_id:IDS.build,
  build_state:'review',candidate_state:'ready',expected_primary_selection_id:IDS.epoch,...extra}; }
export async function capturePrimarySelectionSql() {
  const captured={};
  for(const [name,run] of [['set',setOwnedPrimaryVoiceSource],['withdraw',markOwnedSourceDeleting]]) {
    await run(async(sql,params)=>{captured[name]={sql,params};return[];},IDS.owner,IDS.replica,IDS.source);
  }
  await completeSourceErasure(async(sql,params)=>{captured.complete={sql,params};return[{source_id:IDS.source}];},
    {source:{sourceId:IDS.source,replicaId:IDS.replica,ownerUserId:IDS.owner},leaseToken:LEASE_TOKEN});
  await requestOwnedVoiceGenomeBuild(async(sql,params)=>{
    if(sql.includes('insert into vy_replica_voice_build_intent'))captured.create={sql,params};
    return[intentRow({state:'failed',build_id:null})];
  },IDS.owner,{replica_id:IDS.replica,build_intent_id:IDS.intent,candidate_source_id:IDS.source});
  let promoted=false;
  await advanceOwnedVoiceBuildIntent(async(sql,params)=>{
    if(sql.includes('source.primary_voice.promote_after_build')){captured.promote={sql,params};promoted=true;}
    return[intentRow(promoted?{state:'review'}:{})];
  },IDS.owner,{replica_id:IDS.replica,build_intent_id:IDS.intent});
  return captured;
}
