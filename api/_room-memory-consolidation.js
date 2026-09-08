import {strictRoomConsolidationConfig} from './_consolidation-config.js';
import {canonicalJson, sha256Hex} from './_provenance/contracts.js';
import {foundryBudgetConfig, reserveFoundrySpend, beginFoundrySpend, settleFoundrySpend,
  releaseFoundrySpendBeforeCall, markFoundrySpendUncertain} from './_provider-budget.js';
import {ROOM_MEMORY_CONSOLIDATION_ENABLED, ROOM_MEMORY_BATCH_SQL, ROOM_MEMORY_MAX_OUTPUT_TOKENS,
  runRoomMemoryConsolidation} from './_room-memory-authority.js';

export function roomMemorySweepEnabled(env = process.env) {
  return ROOM_MEMORY_CONSOLIDATION_ENABLED && env.CONSOLIDATE_SWEEP_MODE === 'room_only'
    && env.CONSOLIDATE_ROOM_DEV === '1';
}

export function roomMemoryPersonLimit(env = process.env) {
  const raw=String(env.CONSOLIDATE_ROOM_PERSON_LIMIT || '1').trim();
  const limit=Number(raw);
  if(!/^\d+$/.test(raw)||!Number.isSafeInteger(limit)||limit<1||limit>10)
    throw Object.assign(new Error('room_memory_person_limit_invalid'),
      {code:'room_memory_person_limit_invalid',status:503});
  return limit;
}

// Read-only cold-start admission. This prevents an unattended Room run from
// relying on the legacy endpoint's caught CREATE TABLE or silently creating a
// new provider budget. The actual claim and reserve statements retain their
// own atomic checks after this early readiness snapshot.
export const ROOM_MEMORY_SWEEP_READINESS_SQL=`select
 (select count(*)=10 from (values
   ('vy_room_follower','memory_epoch','bigint','NO'),
   ('meera_log','room_memory_follower_id','uuid','YES'),('meera_log','room_memory_epoch','bigint','YES'),
   ('vy_episode','room_memory_follower_id','uuid','YES'),('vy_episode','room_memory_epoch','bigint','YES'),
   ('meera_consolidate_lease','agent_id','uuid','NO'),('meera_consolidate_lease','person_id','uuid','NO'),
   ('meera_consolidate_lease','leased_at','timestamp with time zone','NO'),
   ('meera_consolidate_lease','leased_by','text','NO'),('meera_consolidate_lease','run_id','text','YES')
 ) expected(table_name,column_name,data_type,is_nullable)
 join information_schema.columns actual using(table_name,column_name,data_type,is_nullable)
 where actual.table_schema='public')
 and (select count(*)=2 from pg_trigger where tgrelid=to_regclass('public.vy_room_follower')
   and tgname in ('vy_room_memory_epoch_change','vy_room_memory_follower_erasure') and tgenabled in ('O','A'))
 and (select count(*)=2 from pg_constraint where contype='f' and confdeltype='c'
   and confrelid=to_regclass('public.vy_room_follower')
   and conrelid in (to_regclass('public.meera_log'),to_regclass('public.vy_episode')))
 as schema_ready,
 exists(select 1 from vy_provider_budget where budget_id=$1 and limit_microusd=$2
   and state='active' and spent_microusd+reserved_microusd<limit_microusd) as budget_ready`;

export async function assertRoomMemorySweepReady(queryFn,env=process.env) {
  const config=strictRoomConsolidationConfig(env);
  const budget=foundryBudgetConfig(config.env);
  const rows=await queryFn(ROOM_MEMORY_SWEEP_READINESS_SQL,[budget.budget_id,budget.limit_microusd]);
  if(rows?.length!==1||rows[0].schema_ready!==true)
    throw Object.assign(new Error('room_memory_schema_unavailable'),{code:'room_memory_schema_unavailable',status:503});
  if(rows[0].budget_ready!==true)
    throw Object.assign(new Error('room_memory_budget_unavailable'),{code:'room_memory_budget_unavailable',status:503});
  return {config,budget};
}

// leased_by is existing unrestricted TEXT. Only this Room lane writes this
// prefix. An unresolved admission (including a lost reserve ACK/no ledger row)
// holds this agent/person, never the global sweep or a legacy Meera lease.
const ROOM_LEASE_RELEASABLE = `(l.leased_by not like 'room-memory:%' or exists (
  select 1 from vy_provider_spend s
   where s.operation='claim_extraction' and s.provider_family='consolidation'
     and s.provider_name='azure-foundry-room-memory'
     and l.leased_by='room-memory:' || s.budget_id || ':' || s.request_hash
     and s.state in ('settled','released'))) `;

export const ROOM_MEMORY_CLAIM_SQL = `insert into meera_consolidate_lease as l
  (agent_id,person_id,leased_at,leased_by,run_id)
  values ($1::uuid,$2::uuid,now(),'sweep',$3)
  on conflict (agent_id,person_id) do update
    set leased_at=now(),leased_by='sweep',run_id=$3
    where l.leased_at < now() - interval '10 minutes' and ${ROOM_LEASE_RELEASABLE}
  returning agent_id,person_id`;
export const ROOM_MEMORY_RELEASE_SQL = `delete from meera_consolidate_lease l
  where l.agent_id=$1::uuid and l.person_id=$2::uuid and l.run_id=$3
    and ${ROOM_LEASE_RELEASABLE} returning l.person_id`;
export const ROOM_MEMORY_ADMIT_SQL = `update meera_consolidate_lease
  set leased_by=$4,leased_at=now()
  where agent_id=$1::uuid and person_id=$2::uuid and run_id=$3 and leased_by='sweep'
  returning person_id`;
export const ROOM_MEMORY_CANCEL_ADMISSION_SQL = `update meera_consolidate_lease l
  set leased_by='sweep'
  where l.agent_id=$1::uuid and l.person_id=$2::uuid and l.run_id=$3 and l.leased_by=$4
    and not exists (select 1 from vy_provider_spend s
      where s.operation='claim_extraction'
        and l.leased_by='room-memory:' || s.budget_id || ':' || s.request_hash)
  returning l.person_id`;

function sourceBinding(rows) {
  return rows.map(r=>({id:String(r.id),content:r.content,follower_id:String(r.follower_id),
    memory_epoch:String(r.memory_epoch),agent_id:String(r.agent_id),person_id:String(r.person_id)}));
}

// Reuses the incumbent counted llm and production spend meter. This wrapper is
// also the explicit dev canary entrypoint; scheduled discovery has its own false
// source flag. No transaction or row lock spans a provider call.
export async function runMeteredRoomMemoryConsolidation(candidate,
  {queryFn,llm,runId,env=process.env,fetchImpl=globalThis.fetch}={}) {
  const config = strictRoomConsolidationConfig(env);
  const budget = foundryBudgetConfig(config.env);
  if (!runId || typeof queryFn !== 'function' || typeof llm !== 'function')
    throw new Error('room_memory_sweep_binding_required');
  const adapter = {family:'consolidation',name:'azure-foundry-room-memory',
    version:`${config.expectedModel}:room-memory/v1`,model:config.model,
    billing:{meter:'azure_foundry_tokens',max_output_tokens:ROOM_MEMORY_MAX_OUTPUT_TOKENS}};
  let capturedRows;
  const scopedQuery = async(sql,params)=>{
    const rows=await queryFn(sql,params);
    if(sql===ROOM_MEMORY_BATCH_SQL) capturedRows=rows;
    return rows;
  };
  return runRoomMemoryConsolidation(candidate,{queryFn:scopedQuery,env:config.env,
    model:async(messages,maxTokens,options)=>{
      const sources=canonicalJson(sourceBinding(capturedRows));
      // A new, separately claimed sweep can retry a known completed attempt
      // (including a before-call release). Unknown attempts retain the old
      // lease and therefore cannot acquire a new run identity. Preserve every
      // old spend row; never reset a released/settled ledger state.
      const requestKey=sha256Hex(canonicalJson({budget_id:budget.budget_id,run_id:runId,
        source_binding:sourceBinding(capturedRows),messages,response_format:options.responseFormat,
        max_tokens:maxTokens,model:config.model,expected_model:config.expectedModel,url:config.requestUrl}));
      // Exact same hash shape as reserveFoundrySpend. Persist BEFORE asking the
      // meter, so a lost reservation ACK remains addressable without its row ID.
      const requestHash=sha256Hex(canonicalJson({operation:'claim_extraction',request_key:requestKey,
        provider_family:adapter.family,provider_name:adapter.name,provider_version:adapter.version,model:adapter.model}));
      const token=`room-memory:${budget.budget_id}:${requestHash}`;
      const admitted=await queryFn(ROOM_MEMORY_ADMIT_SQL,[candidate.agent_id,candidate.person_id,runId,token]);
      if(admitted.length!==1) throw new Error('room_memory_lease_changed');
      let reservation;
      try {
        reservation=await reserveFoundrySpend(queryFn,{operation:'claim_extraction',requestKey,adapter,messages,env:config.env});
      } catch(error) {
        // Only an acknowledged empty reservation result proves no spend began.
        // Transport errors/unknown ACKs keep their token for reconciliation.
        if(error?.code==='provider_budget_reservation_denied')
          await queryFn(ROOM_MEMORY_CANCEL_ADMISSION_SQL,[candidate.agent_id,candidate.person_id,runId,token]);
        throw error;
      }
      const current=await queryFn(ROOM_MEMORY_BATCH_SQL,[candidate.follower_id,candidate.agent_id,candidate.person_id]);
      if(canonicalJson(sourceBinding(current))!==sources) {
        const released=await releaseFoundrySpendBeforeCall(queryFn,reservation,'room_memory_authority_changed');
        if(!released) throw new Error('room_memory_release_unconfirmed');
        throw new Error('room_memory_authority_changed');
      }
      await beginFoundrySpend(queryFn,reservation);
      let payload,output,dispatchError;
      try {
        output=await llm(messages,maxTokens,{...options,env:config.env,model:config.model,
          fetchImpl:async(url,init)=>{
            if(String(url)!==config.url) throw new Error('room_memory_dispatch_binding_changed');
            const response=await fetchImpl(config.requestUrl,init);
            payload=await response.clone().json();
            return response;
          }});
      } catch(error) { dispatchError=error; }
      const input=payload?.usage?.prompt_tokens, out=payload?.usage?.completion_tokens;
      if(!Number.isSafeInteger(input)||input<0||!Number.isSafeInteger(out)||out<0||input+out===0) {
        await markFoundrySpendUncertain(queryFn,reservation,'room_memory_usage_unknown');
        throw new Error('room_memory_usage_unknown');
      }
      try { await settleFoundrySpend(queryFn,reservation,{input_tokens:input,output_tokens:out}); }
      catch(error) {
        await markFoundrySpendUncertain(queryFn,reservation,error);
        throw error;
      }
      // Bill measured usage even when the provider returns the wrong revision,
      // incomplete output, or invalid content. None may reach the memory commit.
      if(payload?.model!==config.expectedModel) throw new Error('room_memory_response_model_mismatch');
      if(dispatchError) throw dispatchError;
      if(payload?.choices?.[0]?.finish_reason!=='stop') throw new Error('room_memory_response_incomplete');
      return output;
    }});
}
