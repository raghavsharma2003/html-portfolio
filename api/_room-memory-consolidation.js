import {strictRoomConsolidationConfig} from './_consolidation-config.js';
import {isAzureOnlyServing} from './_model-serving-policy.js';
import {canonicalJson, sha256Hex} from './_provenance/contracts.js';
import {foundryBudgetConfig, reserveFoundrySpend, beginFoundrySpend, settleFoundrySpend,
  releaseFoundrySpendBeforeCall, markFoundrySpendUncertain} from './_provider-budget.js';
import {ROOM_MEMORY_CONSOLIDATION_ENABLED, ROOM_MEMORY_BATCH_SQL, ROOM_MEMORY_COMMIT_SQL,
  ROOM_MEMORY_MAX_OUTPUT_TOKENS, ROOM_MEMORY_RESPONSE_FORMAT, runRoomMemoryConsolidation,
  OWNER_MEMORY_BATCH_SQL, OWNER_MEMORY_COMMIT_SQL, OWNER_MEMORY_EXTRACTION_SYSTEM,
  ownerMemoryAuthority} from './_room-memory-authority.js';

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

function ownerSourceBinding(rows) {
  return rows.map(r=>({id:String(r.id),content:r.content,replica_id:String(r.replica_id),
    agent_id:String(r.agent_id),person_id:String(r.person_id)}));
}

const RECLASSIFICATION_SNAPSHOT_KEYS=Object.freeze(['follower_id','memory_epoch','agent_id','person_id',
  'fact_id','fact_body','fact_name','episode_id','source_id','source_content','fact_communication']);

function exactReclassificationSnapshot(rows,candidate) {
  if(!Array.isArray(rows)||rows.length>1) throw new Error('room_memory_reclassification_source_invalid');
  if(!rows.length) return null;
  const row=rows[0];
  if(!row||typeof row!=='object'||Object.keys(row).sort().join(',')!==[...RECLASSIFICATION_SNAPSHOT_KEYS].sort().join(','))
    throw new Error('room_memory_reclassification_source_invalid');
  const scalarKeys=RECLASSIFICATION_SNAPSHOT_KEYS.filter(key=>key!=='fact_communication');
  const metadata=row.fact_communication;
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)
    ||Object.keys(metadata).sort().join(',')!=='brevity,language,scope,script,state,version'
    ||metadata.version!==1||metadata.state!=='unclassified'
    ||metadata.language!==null||metadata.script!==null||metadata.brevity!==null
    ||!metadata.scope||typeof metadata.scope!=='object'||Array.isArray(metadata.scope)
    ||Object.keys(metadata.scope).sort().join(',')!=='brevity,language,script'
    ||Object.values(metadata.scope).some(value=>typeof value!=='boolean')
    ||!Object.values(metadata.scope).some(Boolean))throw new Error('room_memory_reclassification_source_invalid');
  const snapshot=Object.fromEntries(scalarKeys.map(key=>[key,String(row[key]??'')]));
  snapshot.fact_communication=JSON.parse(canonicalJson(metadata));
  Object.freeze(snapshot.fact_communication.scope);Object.freeze(snapshot.fact_communication);
  if(scalarKeys.some(key=>!snapshot[key])
    || snapshot.follower_id!==String(candidate.follower_id)||snapshot.agent_id!==String(candidate.agent_id)
    || snapshot.person_id!==String(candidate.person_id)
    || (candidate.memory_epoch!=null&&snapshot.memory_epoch!==String(candidate.memory_epoch))
    || snapshot.fact_name!=='preference'
    || snapshot.fact_body!==snapshot.source_content)
    throw new Error('room_memory_reclassification_source_invalid');
  return Object.freeze(snapshot);
}

async function runMeteredRoomMemoryModel({candidate,queryFn,llm,runId,config,budget,fetchImpl,
  sourceSnapshot,rereadSnapshot,messages,maxTokens,responseFormat,adapterVersion}) {
  const adapter = {family:'consolidation',name:'azure-foundry-room-memory',
    version:`${config.expectedModel}:${adapterVersion}`,model:config.model,
    billing:{meter:'azure_foundry_tokens',max_output_tokens:maxTokens}};
  const sources=canonicalJson(sourceSnapshot);
  const requestKey=sha256Hex(canonicalJson({budget_id:budget.budget_id,run_id:runId,
    source_binding:sourceSnapshot,messages,response_format:responseFormat,
    max_tokens:maxTokens,model:config.model,expected_model:config.expectedModel,url:config.requestUrl}));
  const requestHash=sha256Hex(canonicalJson({operation:'claim_extraction',request_key:requestKey,
    provider_family:adapter.family,provider_name:adapter.name,provider_version:adapter.version,model:adapter.model}));
  const token=`room-memory:${budget.budget_id}:${requestHash}`;
  const admitted=await queryFn(ROOM_MEMORY_ADMIT_SQL,[candidate.agent_id,candidate.person_id,runId,token]);
  if(admitted.length!==1) throw new Error('room_memory_lease_changed');
  let reservation;
  try {
    reservation=await reserveFoundrySpend(queryFn,{operation:'claim_extraction',requestKey,adapter,messages,env:config.env});
  } catch(error) {
    if(error?.code==='provider_budget_reservation_denied')
      await queryFn(ROOM_MEMORY_CANCEL_ADMISSION_SQL,[candidate.agent_id,candidate.person_id,runId,token]);
    throw error;
  }
  const current=await rereadSnapshot();
  if(canonicalJson(current)!==sources) {
    const released=await releaseFoundrySpendBeforeCall(queryFn,reservation,'room_memory_authority_changed');
    if(!released) throw new Error('room_memory_release_unconfirmed');
    throw new Error('room_memory_authority_changed');
  }
  await beginFoundrySpend(queryFn,reservation);
  let payload,output,dispatchError;
  try {
    output=await llm(messages,maxTokens,{env:config.env,responseFormat,model:config.model,
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
  if(payload?.model!==config.expectedModel) throw new Error('room_memory_response_model_mismatch');
  if(dispatchError) throw dispatchError;
  if(payload?.choices?.[0]?.finish_reason!=='stop') throw new Error('room_memory_response_incomplete');
  return output;
}

// Reuses the incumbent counted llm and production spend meter. This wrapper is
// also the explicit dev canary entrypoint; scheduled discovery has its own false
// source flag. No transaction or row lock spans a provider call.
export async function runMeteredRoomMemoryConsolidation(candidate,
  {queryFn,llm,runId,env=process.env,fetchImpl=globalThis.fetch,
    batchSql=ROOM_MEMORY_BATCH_SQL,commitSql=ROOM_MEMORY_COMMIT_SQL,
    batchParams=(c)=>[c.follower_id,c.agent_id,c.person_id],authorityOf,
    sourceBindingFn=sourceBinding,extractionSystem,adapterVersion='room-memory/v1'}={}) {
  const config = strictRoomConsolidationConfig(env);
  const budget = foundryBudgetConfig(config.env);
  if (!runId || typeof queryFn !== 'function' || typeof llm !== 'function')
    throw new Error('room_memory_sweep_binding_required');
  let capturedRows;
  const scopedQuery = async(sql,params)=>{
    const rows=await queryFn(sql,params);
    if(sql===batchSql) capturedRows=rows;
    return rows;
  };
  return runRoomMemoryConsolidation(candidate,{queryFn:scopedQuery,env:config.env,
    batchSql,commitSql,batchParams,...(authorityOf?{authorityOf}:{}),
    ...(extractionSystem?{extractionSystem}:{}),
    model:async(messages,maxTokens,options)=>{
      return runMeteredRoomMemoryModel({candidate,queryFn,llm,runId,config,budget,fetchImpl,
        sourceSnapshot:sourceBindingFn(capturedRows),
        rereadSnapshot:async()=>sourceBindingFn(await queryFn(batchSql,batchParams(candidate))),
        messages,maxTokens,responseFormat:options.responseFormat,adapterVersion});
    }});
}

// Owner Meet memory uses the same lease, reservation, exact-source reread,
// usage settlement and release path as Room memory. Only its authority-bound
// source and commit statements differ.
export async function runMeteredOwnerMemoryConsolidation(candidate,
  {queryFn,llm,runId,env=process.env,fetchImpl=globalThis.fetch}={}) {
  return runMeteredRoomMemoryConsolidation(candidate,{queryFn,llm,runId,env,fetchImpl,
    batchSql:OWNER_MEMORY_BATCH_SQL,commitSql:OWNER_MEMORY_COMMIT_SQL,
    batchParams:(c)=>ownerMemoryAuthority(c),authorityOf:(_row,c)=>ownerMemoryAuthority(c),
    sourceBindingFn:ownerSourceBinding,extractionSystem:OWNER_MEMORY_EXTRACTION_SYSTEM,
    adapterVersion:'owner-memory/v1'});
}

// Reclassifies one active correction fact through the same bounded Room meter.
// The caller owns the authority read and atomic CAS; this wrapper owns the
// agent/person lease, exact snapshot comparisons and the single paid attempt.
export async function runMeteredRoomMemoryReclassification(candidate,
  {queryFn,llm,runId,readSnapshot,prepareRequest,validateProposal,commitProposal,
    env=process.env,fetchImpl=globalThis.fetch}={}) {
  if(!isAzureOnlyServing(env))throw new Error('room_memory_azure_only_required');
  const config=strictRoomConsolidationConfig(env),budget=foundryBudgetConfig(config.env);
  if(!runId||typeof queryFn!=='function'||typeof llm!=='function'||typeof readSnapshot!=='function'
    ||typeof prepareRequest!=='function'||typeof validateProposal!=='function'||typeof commitProposal!=='function')
    throw new Error('room_memory_reclassification_binding_required');
  const snapshot=exactReclassificationSnapshot(await readSnapshot(queryFn,candidate),candidate);
  if(!snapshot)return {classification:'unclassified',skipped:'no_job'};
  const claimed=await queryFn(ROOM_MEMORY_CLAIM_SQL,[candidate.agent_id,candidate.person_id,runId]);
  if(claimed.length!==1)return {classification:'unclassified',skipped:'leased'};
  let failed=null;
  try {
    const request=prepareRequest(snapshot);
    if(!request||!Array.isArray(request.messages)||!request.messages.length
      ||!Number.isSafeInteger(request.maxTokens)||request.maxTokens<1
      ||request.maxTokens>ROOM_MEMORY_MAX_OUTPUT_TOKENS
      ||canonicalJson(request.responseFormat)!==canonicalJson(ROOM_MEMORY_RESPONSE_FORMAT))
      throw new Error('room_memory_reclassification_request_invalid');
    const suppliedSources=request.messages.filter(message=>message?.role==='user');
    if(suppliedSources.length!==1||suppliedSources[0].content!==JSON.stringify([
      {id:snapshot.source_id,content:snapshot.source_content}]))
      throw new Error('room_memory_reclassification_request_invalid');
    const reread=async()=>exactReclassificationSnapshot(await readSnapshot(queryFn,candidate),candidate);
    const output=await runMeteredRoomMemoryModel({candidate,queryFn,llm,runId,config,budget,fetchImpl,
      sourceSnapshot:snapshot,rereadSnapshot:reread,messages:request.messages,maxTokens:request.maxTokens,
      responseFormat:request.responseFormat,adapterVersion:'room-memory/reclassification-v1'});
    const proposal=validateProposal(output,snapshot);
    if(canonicalJson(await reread())!==canonicalJson(snapshot))
      throw new Error('room_memory_authority_changed');
    return await commitProposal(proposal,snapshot);
  }catch(error){failed=error;throw error;}
  finally{
    try{
      const released=await queryFn(ROOM_MEMORY_RELEASE_SQL,[candidate.agent_id,candidate.person_id,runId]);
      if(!failed&&released.length!==1)throw new Error('room_memory_release_unconfirmed');
    }catch(error){if(!failed)throw error;failed.release_error_code='room_memory_release_unconfirmed';}
  }
}
