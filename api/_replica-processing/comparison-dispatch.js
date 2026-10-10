import {sha256Hex} from './contracts.js';
import {leaseTokenHash} from './queue.js';
import {COMPARISON_MODEL_STEPS,comparisonAuthoritySql,comparisonError,assertComparisonVoiceEvidence} from './comparison.js';
import {requireCurrentComparisonPreparation} from '../_comparison-preparation.js';

export const COMPARISON_DISPATCH_CLAIM_SQL=`with source as materialized (
 select s.* from vy_replica_source s where s.source_id=$1::uuid and s.replica_id=$2::uuid and s.owner_user_id=$3::uuid
 and ${comparisonAuthoritySql('s')} for update of s nowait
), owned as materialized (select r.replica_id from vy_replica r where r.replica_id=$2::uuid and r.owner_user_id=$3::uuid
 and exists(select 1 from source) and r.private_text_epoch=(select (cp.receipt->>'authority_epoch')::bigint
 from vy_replica_comparison_preparation cp where cp.preparation_id=$4::uuid and cp.replica_id=$2::uuid and cp.owner_user_id=$3::uuid)
 for update of r nowait), eligible as materialized (
 select p.* from vy_replica_comparison_preparation p join source s using(source_id,replica_id,owner_user_id)
 join vy_replica_processing_job j on j.comparison_preparation_id=p.preparation_id and j.source_id=s.source_id
 and j.replica_id=p.replica_id and j.owner_user_id=p.owner_user_id
 where p.preparation_id=$4::uuid and j.job_id=$5::uuid and j.step=$6 and j.state='leased'
 and j.lease_token_hash=$7 and j.lease_expires_at>now() and p.state in ('authorized','queued','running')
 and p.expires_at>now() and exists(select 1 from owned)
 and (select count(*) from vy_replica_comparison_dispatch d where d.preparation_id=p.preparation_id)<p.max_evidence_dispatches
 for update of p nowait
), inserted as (insert into vy_replica_comparison_dispatch(preparation_id,source_id,replica_id,owner_user_id,job_id,step,request_sha256,meter_receipt_sha256,state)
 select preparation_id,source_id,replica_id,owner_user_id,$5::uuid,$6,$8,$9,'started' from eligible on conflict do nothing returning *) select * from inserted`;

export function createComparisonDispatch({db,leased,source,preparation,meter}){
 let dispatched=false,responseRecorded=false,reservation=null;
 const job=leased.job,model=COMPARISON_MODEL_STEPS.includes(job.step);
 const requireAuthority=()=>requireCurrentComparisonPreparation(db,source);
 const meterReady=()=>meter?.kind==='azure-container-infrastructure/v1'&&['assertReady','reserve','begin','recordResponse','markUncertain','releaseBeforeBegin'].every(k=>typeof meter[k]==='function');
 const key={preparation_id:preparation.preparation_id,job_id:job.job_id,step:job.step};
 return Object.freeze({preparationId:preparation.preparation_id,receiptSha256:preparation.receipt_sha256,
  async beforeStage(){await requireAuthority();if(model){if(!meterReady())throw comparisonError('comparison_gpu_accounting_unavailable',503);await meter.assertReady();}},
  billing:Object.freeze({
   async beforePrivateRead(){await requireAuthority();},
   async beforeProviderRequest({operation,requestSha256}){
    if(!model||operation!==job.step||dispatched)throw comparisonError('comparison_dispatch_limit');
    if(!meterReady())throw comparisonError('comparison_gpu_accounting_unavailable',503);
    await requireAuthority();
    reservation=await meter.reserve({...key,request_sha256:requestSha256,max_dispatches:1});
    if(reservation?.recovered===true){reservation=null;throw comparisonError('comparison_dispatch_already_claimed');}
    if(!reservation||!/^[0-9a-f]{64}$/.test(reservation.receipt_sha256||''))throw comparisonError('comparison_meter_receipt_invalid',503);
    const rows=await db(COMPARISON_DISPATCH_CLAIM_SQL,[source.source_id,source.replica_id,source.owner_user_id,preparation.preparation_id,job.job_id,job.step,leaseTokenHash(leased.leaseToken),requestSha256,reservation.receipt_sha256]);
    if(rows.length!==1){await meter.releaseBeforeBegin(reservation);reservation=null;throw comparisonError('comparison_dispatch_already_claimed');}
    // Durable claim precedes begin. A lost begin acknowledgement remains
    // uncertain and can never acquire another claim for this step.
    dispatched=true;await meter.begin(reservation);await requireAuthority();
   },
   async afterProviderResponse(response){if(!dispatched)throw comparisonError('comparison_dispatch_missing');
    const receipt=await meter.recordResponse(reservation,response);
    if(!receipt||receipt.response_recorded!==true||receipt.accounting_state!=='accounting_pending'||receipt.accounted!==false||!/^[0-9a-f]{64}$/.test(receipt.receipt_sha256||''))throw comparisonError('comparison_meter_response_unavailable',503);
    const rows=await db(`update vy_replica_comparison_dispatch set state='response_recorded',result_sha256=$4,response_recorded_at=now()
     where preparation_id=$1::uuid and job_id=$2::uuid and request_sha256=$3 and state='started' returning step`,[preparation.preparation_id,job.job_id,response.request_sha256,receipt.receipt_sha256]);
    if(rows.length!==1)throw comparisonError('comparison_meter_response_uncertain',503);responseRecorded=true;
   },
  }),
  async completeStage(output){await requireAuthority();
   if(job.step==='voice_quality')assertComparisonVoiceEvidence(output.evidence);
   if(job.step==='media_probe'){const duration=output.evidence.find(e=>e.evidence_type==='media_probe')?.value?.duration_ms;
    if(!Number.isSafeInteger(duration)||duration<1||duration>60000)throw comparisonError('comparison_duration_out_of_bounds');}
   // Separate may perform the existing honest CPU passthrough and never call
   // a model; every actual remote call must have a durable response receipt; allocation funds remain held.
   if(model&&job.step!=='separate'&&!responseRecorded)throw comparisonError('comparison_meter_response_required',503);
  },
  async failStage(error){
   if(dispatched&&!responseRecorded){try{await meter.markUncertain(reservation);}catch{}
    await db(`with marked as (update vy_replica_comparison_preparation set state='reconciliation_required',updated_at=now()
     where preparation_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and state not in ('revoked','expired') returning preparation_id)
     update vy_replica_comparison_dispatch set state='reconciliation_required' where preparation_id=$1::uuid and job_id=$4::uuid and state='started'`,[preparation.preparation_id,source.replica_id,source.owner_user_id,job.job_id]);
    return comparisonError('comparison_dispatch_reconciliation_required',503);}
   if(reservation&&!dispatched)await meter.releaseBeforeBegin(reservation).catch(()=>null);
   return Object.assign(error,{retryable:false});
  },
 });
}
