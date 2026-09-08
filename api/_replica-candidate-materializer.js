import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {canonicalJson,sha256Hex} from './_provenance/contracts.js';
import {basis,authorityParams,CORRECTION_CURRENT_AUTHORITY_SQL} from './_replica-correction-candidate.js';
import {renderPrivateCorrectionCandidate} from './_replica-correction-artifact.js';
import {compileReplicaRuntimeCore} from './_replica-runtime.js';
import {compileDialoguePrompt,validateDialogueOutput,DIALOGUE_OUTPUT_SCHEMA} from './_dialogue/contracts.js';
import {prepareProviderRevisionBinding,verifyProviderRevision,assertSameReportedRevision} from './_dialogue/provider-revision.js';
import {FEEDBACK_DATASET_SCHEMA} from './_replica-feedback-dataset.js';
import {encryptEvaluationText,decryptEvaluationText,evaluationTextHash} from './_replica-candidate-eval-crypto.js';
import {buildCandidateEvaluationPackage,persistCandidateEvaluationPackage} from './_replica-candidate-eval.js';
import {reserveFoundrySpend,beginFoundrySpend,settleFoundrySpend,markFoundrySpendUncertain,releaseFoundrySpendBeforeCall} from './_provider-budget.js';

export const MATERIALIZATION_PROTOCOL='vyakti.private-text-materialization.v1';
const hash=v=>sha256Hex(canonicalJson(v));
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const fail=(code,status=409)=>{throw Object.assign(Error(code),{code,status});};
const uuid=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v))fail('materialization_id_invalid',400);return v.toLowerCase();};
function scope(input){return{replica_id:uuid(input?.replica_id),dataset_id:uuid(input?.dataset_id),candidate_id:uuid(input?.candidate_id)};}

export const MATERIALIZATION_AUTHORITY_SQL=`with reviewed as (${CORRECTION_CURRENT_AUTHORITY_SQL})
 select reviewed.dataset_id,reviewed.capability_id,c.candidate_id from reviewed
 join vy_replica_candidate c on c.dataset_id=reviewed.dataset_id and c.base_capability_id=reviewed.capability_id
 join vy_replica_correction_candidate_job j on j.candidate_id=c.candidate_id and j.dataset_id=c.dataset_id
  and j.replica_id=c.replica_id and j.owner_user_id=c.owner_user_id
 where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.candidate_id=$11::uuid
 and c.status in ('draft','evaluating') and c.kind='prompt_policy'
 and c.artifact_sha256=$12 and c.build_manifest_hash=$13 and c.base_model_commitment=$14
 and j.job_id=$15::uuid and j.state='draft' and j.artifact_sha256=c.artifact_sha256
 and j.build_manifest_hash=c.build_manifest_hash`;
const authority=b=>[...authorityParams(b,b.owner),b.candidate.candidate_id,b.candidate.artifact_sha256,
 b.candidate.build_manifest_hash,b.candidate.base_model_commitment,b.correction.job_id];
async function gated(db,b,sql,args=[]){return db(`with authority as (${MATERIALIZATION_AUTHORITY_SQL}) ${sql}`,[...authority(b),...args]);}

export function materializationModel(adapter,env){
 if(adapter?.family!=='dialogue'||adapter.name!=='azure-foundry-structured-output'||adapter.billing?.meter!=='azure_foundry_tokens'
  ||adapter.billing.max_output_tokens!==700||typeof adapter.generate!=='function')fail('materialization_azure_adapter_required',503);
 const pin=env.AZURE_CORRECTION_BASE_MODEL_COMMITMENT;
 if(typeof pin!=='string'||!/^[a-f0-9]{64}$/.test(pin))fail('materialization_baseline_pin_required',503);
 const binding=adapter.revision_binding;
 if(!binding||binding.baseline_snapshot_hash!==pin||binding.deployment!==adapter.model)fail('materialization_provider_revision_required',503);
 const verified=prepareProviderRevisionBinding({expectedResponseModel:binding.expected_response_model,endpoint:binding.endpoint,
  deployment:adapter.model,baselineSnapshotHash:pin});
 if(hash(verified)!==hash(binding))fail('materialization_provider_binding_changed');
 return {pin,commitment:hash({protocol:MATERIALIZATION_PROTOCOL,name:adapter.name,version:adapter.version,model:adapter.model,base_model_commitment:pin,revision_binding:binding})};
}
async function loadBasis(db,owner,input,adapter,env){
 const s=scope(input),model=materializationModel(adapter,env),b=await basis(db,owner,input);
 const candidate=(await db(`select c.*,d.source_set_hash as dataset_source_set_hash from vy_replica_candidate c
  join vy_replica_feedback_dataset d on d.dataset_id=c.dataset_id and d.replica_id=c.replica_id and d.owner_user_id=c.owner_user_id
  where c.candidate_id=$1::uuid and c.dataset_id=$2::uuid and c.replica_id=$3::uuid and c.owner_user_id=$4::uuid`,
 [s.candidate_id,s.dataset_id,s.replica_id,owner]))[0];
 const correction=(await db(`select j.* from vy_replica_correction_candidate_job j
  where j.candidate_id=$1::uuid and j.dataset_id=$2::uuid and j.replica_id=$3::uuid and j.owner_user_id=$4::uuid and j.state='draft'`,
 [s.candidate_id,s.dataset_id,s.replica_id,owner]))[0];
 if(!candidate||!correction||candidate.kind!=='prompt_policy'||!['draft','evaluating'].includes(candidate.status)
  ||candidate.base_model_commitment!==model.pin||candidate.dataset_source_set_hash!==b.dataset.source_set_hash)
  fail('materialization_candidate_changed');
 const artifact=parse(correction.artifact),manifest=parse(correction.build_manifest);
 if(hash(artifact)!==candidate.artifact_sha256||hash(manifest)!==candidate.build_manifest_hash
  ||manifest.artifact_sha256!==candidate.artifact_sha256||manifest.base_model_commitment!==model.pin
  ||manifest.source_set_hash!==b.dataset.source_set_hash)fail('materialization_artifact_changed');
 const baseline=compileReplicaRuntimeCore(b.runtime.personProfile.definition,b.runtime.calibration.definition);
 const rendered=renderPrivateCorrectionCandidate(b.runtime,artifact);
 // The shared dialogue compiler has a 6000-unit core budget, smaller than the
 // profile renderer's cap. Never silently truncate the experimental directives.
 if(baseline.length>6000||rendered.core.length>6000)fail('materialization_core_exceeds_dialogue_budget');
 if(compileDialoguePrompt({core:baseline,message:'probe'}).messages[0].content===
  compileDialoguePrompt({core:rendered.core,message:'probe'}).messages[0].content)fail('materialization_candidate_has_no_prompt_delta');
 return {...b,...s,owner,candidate,correction,model,baseline,candidateCore:rendered.core,baselineHash:hash(baseline)};
}

export function heldOutExamples(definition){
 const rows=definition.examples.filter(e=>e.split==='test');
 if(rows.length<30||rows.length>100||new Set(rows.map(e=>e.feedback_id)).size!==rows.length
  ||new Set(rows.map(e=>e.session_commitment)).size<2)fail('materialization_heldout_requirements');
 const training=new Set(definition.examples.filter(e=>e.split!=='test').map(e=>e.session_commitment));
 if(rows.some(e=>training.has(e.session_commitment)))fail('materialization_split_leakage');
 return rows;
}
export const MATERIALIZATION_QUESTION_SQL=`select u.content,t.session_id,t.turn_id from vy_replica_turn_feedback f
 join vy_replica_dialogue_turn t on t.turn_id=f.turn_id and t.replica_id=f.replica_id and t.owner_user_id=f.owner_user_id
  and t.capability_id=f.capability_id and t.profile_version=f.profile_version and t.calibration_version=f.calibration_version
  and t.response_hash=f.response_hash and t.state='complete'
 join meera_log u on u.id=t.user_log_id and u.agent_id=t.agent_id and u.device_id=t.device_id and u.role='me'
 where f.feedback_id=$1::uuid and f.replica_id=$2::uuid and f.owner_user_id=$3::uuid
 and f.revision=$4::int4 and f.response_hash=$5 and f.ratings_hash=$6 and f.correction_hash is not distinct from $7::text`;
function binding(job,item,role,digest){return{run_id:job.job_id,assignment_id:item.item_id,asset_id:item.item_id,
 replica_id:job.replica_id,owner_user_id:job.owner_user_id,example_id:item.feedback_id,role:`materializer:${role}`,output_sha256:digest};}
function seal(text,job,item,role,env){const digest=evaluationTextHash(text);return{hash:digest,...encryptEvaluationText(text,binding(job,item,role,digest),env)};}
function open(asset,job,item,role,env){asset=parse(asset);const text=decryptEvaluationText(asset,binding(job,item,role,asset.hash),env);
 if(evaluationTextHash(text)!==asset.hash)fail('materialization_asset_hash_mismatch');return text;}
function promptFor(b,role,context){return compileDialoguePrompt({core:role==='baseline'?b.baseline:b.candidateCore,
 relationship:'',history:[],message:context});}

export const MATERIALIZATION_STATUS_SQL=`select j.job_id,j.replica_id,j.owner_user_id,j.dataset_id,j.candidate_id,j.state,j.total,
 count(i.item_id) filter (where i.state='complete')::int4 as completed,
 count(i.item_id)::int4 as present from vy_replica_candidate_materialization j
 left join vy_replica_candidate_materialization_item i on i.job_id=j.job_id
 where j.replica_id=$1::uuid and j.owner_user_id=$2::uuid and j.dataset_id=$3::uuid and j.candidate_id=$4::uuid
 group by j.job_id`;
export async function readOwnedMaterialization(db,owner,input){
 const s=scope(input),row=(await db(MATERIALIZATION_STATUS_SQL,[s.replica_id,owner,s.dataset_id,s.candidate_id]))[0];
 if(!row)return null;
 const intact=Number(row.present)===Number(row.total);
 return {job_id:row.job_id,replica_id:row.replica_id,dataset_id:row.dataset_id,candidate_id:row.candidate_id,
 state:!intact||['working','packing'].includes(row.state)?'held':row.state,completed:Number(row.completed),total:Number(row.total),
 active_changed:false,can_advance:intact&&row.state==='preparing'};
}

export async function startOwnedMaterialization(db,owner,input,{adapter,env=process.env,signal}={}){
 const previous=await readOwnedMaterialization(db,owner,input);if(previous)return previous;
 const b=await loadBasis(db,owner,input,adapter,env),examples=heldOutExamples(b.definition);
 const job={job_id:randomUUID(),replica_id:b.replica_id,owner_user_id:owner},items=[];
 for(const example of examples){
  signal?.throwIfAborted();
  const question=(await db(MATERIALIZATION_QUESTION_SQL,[example.feedback_id,b.replica_id,owner,example.revision,
   example.response_hash,example.ratings_hash,example.correction_hash]))[0];
  if(!question||question.turn_id!==example.turn_id||hash({schema:FEEDBACK_DATASET_SCHEMA,replica_id:b.replica_id,session_id:String(question.session_id)})!==example.session_commitment)
   fail('materialization_question_changed');
  // Held-out correction, historical answer and ratings are never sent to either model.
  for(const role of ['baseline','candidate']){
   const item={item_id:randomUUID(),feedback_id:example.feedback_id,role,sequence:items.length+1,session_commitment:example.session_commitment};
   const prompt=promptFor(b,role,question.content);
   if(!question.content||question.content.length>4000||prompt.messages.at(-1).content!==question.content)
    fail('materialization_question_requires_normalization');
   items.push({...item,prompt_hash:prompt.prompt_hash,context_asset:seal(question.content,job,item,'context',env)});
  }
 }
 await gated(db,b,` , inserted as (insert into vy_replica_candidate_materialization
  (job_id,correction_job_id,candidate_id,dataset_id,replica_id,owner_user_id,protocol,model_commitment,source_set_hash,
   baseline_hash,artifact_sha256,manifest_hash,blind_seed,total,state)
  select $16::uuid,$15::uuid,$11::uuid,$4::uuid,$1::uuid,$2::uuid,$17,$18,$5,$19,$12,$13,$20,$21::int4,'preparing'
  from authority on conflict (candidate_id) do nothing returning *)
 insert into vy_replica_candidate_materialization_item
  (item_id,job_id,replica_id,owner_user_id,feedback_id,sequence,role,session_commitment,prompt_hash,context_asset,state)
 select x.item_id,j.job_id,j.replica_id,j.owner_user_id,x.feedback_id,x.sequence,x.role,x.session_commitment,x.prompt_hash,x.context_asset,'pending'
 from inserted j cross join jsonb_to_recordset($22::jsonb) as x(item_id uuid,feedback_id uuid,sequence integer,role text,
 session_commitment text,prompt_hash text,context_asset jsonb) returning item_id`,
 [job.job_id,MATERIALIZATION_PROTOCOL,b.model.commitment,b.baselineHash,randomBytes(32).toString('hex'),items.length,JSON.stringify(items)]);
 const saved=await readOwnedMaterialization(db,owner,input);if(!saved)fail('materialization_admission_changed');return saved;
}

// Secret-seeded deterministic shuffling makes a retried package commitment
// identical without storing duplicated plaintext or drawing a second ordering.
export function blindPicker(seed){let counter=0;return max=>{
 if(!Number.isSafeInteger(max)||max<1||max>100)fail('materialization_shuffle_invalid');
 const ceiling=Math.floor(0x100000000/max)*max;
 for(;;){const n=createHmac('sha256',Buffer.from(seed,'hex')).update(String(counter++)).digest().readUInt32BE(0);if(n<ceiling)return n%max;}
};}

async function finishPackage(db,b,job,env){
 const rows=await db(`select * from vy_replica_candidate_materialization_item where job_id=$1::uuid
  and replica_id=$2::uuid and owner_user_id=$3::uuid order by sequence`,[job.job_id,b.replica_id,b.owner]);
 if(rows.length!==job.total||rows.some(r=>r.state!=='complete'))fail('materialization_outputs_incomplete');
 for(const row of rows)assertSameReportedRevision(parse(rows[0].provider_identity),parse(row.provider_identity));
 const examples=heldOutExamples(b.definition).map(example=>{
  const pair=rows.filter(r=>r.feedback_id===example.feedback_id),baseline=pair.find(r=>r.role==='baseline'),candidate=pair.find(r=>r.role==='candidate');
  if(pair.length!==2||!baseline||!candidate)fail('materialization_pair_incomplete');
  const context=open(baseline.context_asset,job,baseline,'context',env);
  if(context!==open(candidate.context_asset,job,candidate,'context',env))fail('materialization_context_changed');
  return{feedback_id:example.feedback_id,split:'test',session_commitment:example.session_commitment,context,
   baseline:open(baseline.output_asset,job,baseline,'output',env),candidate:open(candidate.output_asset,job,candidate,'output',env)};
 });
 const pack=buildCandidateEvaluationPackage({candidate:b.candidate,dataset:{...b.definition,dataset_id:b.dataset_id,source_set_hash:b.dataset.source_set_hash},examples},env,{pick:blindPicker(job.blind_seed)});
 const held=await gated(db,b,`update vy_replica_candidate_materialization j set state='packing',package=$17::jsonb,updated_at=now()
  from authority where j.job_id=$16::uuid and j.replica_id=$1::uuid and j.owner_user_id=$2::uuid and j.state='working' returning j.job_id`,
 [job.job_id,JSON.stringify({eval_run_id:pack.eval_run_id,run_commitment:pack.run_commitment})]);
 if(!held[0])fail('materialization_package_authority_changed');
 const result=await persistCandidateEvaluationPackage(db,b.owner,pack,{sql:MATERIALIZATION_AUTHORITY_SQL,params:authority(b)});
 const saved=await gated(db,b,`update vy_replica_candidate_materialization j set state='ready',eval_run_id=$17::uuid,updated_at=now()
  from authority where j.job_id=$16::uuid and j.replica_id=$1::uuid and j.owner_user_id=$2::uuid and j.state='packing'
  and j.package->>'eval_run_id'=$17::text returning j.job_id`,[job.job_id,result.eval_run_id]);
 if(!saved[0])fail('materialization_package_completion_unknown');
}

export async function advanceOwnedMaterialization(db,owner,input,{adapter,env=process.env,signal}={}){
 const b=await loadBasis(db,owner,input,adapter,env);
 const claimed=await gated(db,b,`update vy_replica_candidate_materialization j set state='working',updated_at=now()
  from authority where j.candidate_id=$11::uuid and j.replica_id=$1::uuid and j.owner_user_id=$2::uuid
  and j.dataset_id=$4::uuid and j.state='preparing' and j.protocol=$16 and j.model_commitment=$17
  and j.source_set_hash=$5 and j.baseline_hash=$18 and j.artifact_sha256=$12 and j.manifest_hash=$13
  and (select count(*) from vy_replica_candidate_materialization_item intact where intact.job_id=j.job_id
   and intact.replica_id=j.replica_id and intact.owner_user_id=j.owner_user_id)=j.total returning j.*`,
 [MATERIALIZATION_PROTOCOL,b.model.commitment,b.baselineHash]);
 if(!claimed[0])return readOwnedMaterialization(db,owner,input);
 const job=claimed[0];let item=null,reservation=null,started=false,settled=false;
 try{
  item=(await db(`update vy_replica_candidate_materialization_item set state='claimed',updated_at=now()
   where item_id=(select item_id from vy_replica_candidate_materialization_item
    where job_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and state='pending' order by sequence limit 1)
   and state='pending' returning *`,[job.job_id,b.replica_id,owner]))[0];
  if(!item){await finishPackage(db,b,job,env);return readOwnedMaterialization(db,owner,input);}
  const prompt=promptFor(b,item.role,open(item.context_asset,job,item,'context',env));
  if(prompt.prompt_hash!==item.prompt_hash)fail('materialization_prompt_changed');
  signal?.throwIfAborted();
  reservation=await reserveFoundrySpend(db,{operation:'dialogue',requestKey:`materialization:${item.item_id}`,adapter,
   messages:[...prompt.messages,{role:'system',content:JSON.stringify(DIALOGUE_OUTPUT_SCHEMA)}],env});
  if(!reservation)fail('materialization_budget_required',503);
  const running=await gated(db,b,`update vy_replica_candidate_materialization_item i set state='running',reservation_id=$18::uuid,updated_at=now()
   from authority where i.item_id=$16::uuid and i.job_id=$17::uuid and i.replica_id=$1::uuid and i.owner_user_id=$2::uuid
   and i.state='claimed' returning i.item_id`,[item.item_id,job.job_id,reservation.reservation_id]);
  if(!running[0])fail('materialization_dispatch_changed');
  await beginFoundrySpend(db,reservation);
  if(!(await db(MATERIALIZATION_AUTHORITY_SQL,authority(b)))[0])fail('materialization_dispatch_authority_changed');
  signal?.throwIfAborted();started=true;
  const generated=await adapter.generate({prompt,signal});
  // Measured usage is settled even if the returned answer fails semantic checks.
  const recorded=await db(`update vy_replica_candidate_materialization_item set state='response_recorded',usage=$4::jsonb,provider_identity=$5::jsonb,updated_at=now()
   where item_id=$1::uuid and job_id=$2::uuid and owner_user_id=$3::uuid and state='running' returning item_id`,
  [item.item_id,job.job_id,owner,JSON.stringify(generated.usage),JSON.stringify(generated.provider_identity || null)]);
  await settleFoundrySpend(db,reservation,generated.usage);settled=true;
  if(!recorded[0])fail('materialization_response_record_unknown');
  const identity=verifyProviderRevision({model:generated.provider_identity?.response_model,
   system_fingerprint:generated.provider_identity?.system_fingerprint},adapter.revision_binding,generated.usage);
  assertSameReportedRevision(identity,generated.provider_identity);
  const previous=(await db(`select provider_identity from vy_replica_candidate_materialization_item
   where job_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and state='complete' order by sequence limit 1`,
  [job.job_id,b.replica_id,owner]))[0];
  if(previous)assertSameReportedRevision(parse(previous.provider_identity),identity);
  const output=validateDialogueOutput(generated.output);
  const completed=await gated(db,b,`update vy_replica_candidate_materialization_item i set state='complete',output_asset=$18::jsonb,updated_at=now()
   from authority where i.item_id=$16::uuid and i.job_id=$17::uuid and i.replica_id=$1::uuid and i.owner_user_id=$2::uuid
   and i.state='response_recorded' returning i.item_id`,[item.item_id,job.job_id,JSON.stringify(seal(output.reply,job,item,'output',env))]);
  if(!completed[0])fail('materialization_response_authority_changed');
  await gated(db,b,`update vy_replica_candidate_materialization j set state='preparing',updated_at=now()
   from authority where j.job_id=$16::uuid and j.replica_id=$1::uuid and j.owner_user_id=$2::uuid and j.state='working'`,[job.job_id]);
  return readOwnedMaterialization(db,owner,input);
 }catch(error){
  if(reservation&&started&&!settled&&error?.measured_usage){
   try{
    if(item)await db(`update vy_replica_candidate_materialization_item set usage=$4::jsonb,updated_at=now()
     where item_id=$1::uuid and job_id=$2::uuid and owner_user_id=$3::uuid`,[item.item_id,job.job_id,owner,JSON.stringify(error.measured_usage)]);
    await settleFoundrySpend(db,reservation,error.measured_usage);settled=true;
   }catch{/* Unknown accounting remains held below; never regenerate. */}
  }
  if(reservation&&!settled){
   if(started)await markFoundrySpendUncertain(db,reservation,error).catch(()=>null);
   else await releaseFoundrySpendBeforeCall(db,reservation,error).catch(()=>null);
  }
  const state=started&&!settled?'held':'failed';
  if(item)await db(`update vy_replica_candidate_materialization_item set state=$4,updated_at=now()
   where item_id=$1::uuid and job_id=$2::uuid and owner_user_id=$3::uuid and state<>'complete'`,[item.item_id,job.job_id,owner,state]).catch(()=>null);
  await db(`update vy_replica_candidate_materialization set state=$4,updated_at=now()
   where job_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and state<>'ready'`,[job.job_id,b.replica_id,owner,state]).catch(()=>null);
  throw error;
 }
}
