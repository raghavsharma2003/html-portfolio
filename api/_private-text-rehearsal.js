import {canonicalJson,sha256Hex} from './_provenance/contracts.js';
import {validateDialogueOutput} from './_dialogue/contracts.js';
import * as spend from './_provider-budget.js';

const fail=(code,status=503)=>{throw Object.assign(new Error(code),{code,status});};
const safeCode=error=>/^[a-z][a-z0-9_]{2,100}$/.test(error?.code||'')?error.code:'private_rehearsal_failed';
function adapterReady(generator){
 if(generator?.name!=='azure-foundry-structured-output'||generator?.billing?.meter!=='azure_foundry_tokens'
   ||typeof generator.generate!=='function')fail('rehearsal_azure_unavailable');
 return generator;
}
function rehearsalOutput(value){
 let raw=value;
 if(typeof raw==='string')try{raw=JSON.parse(raw);}catch{fail('dialogue_output_invalid_json');}
 // The shared cleaner slices UTF-16 units. Refuse whole overlong/malformed
 // output here so it cannot split a surrogate pair before the answer gate.
 const malformed=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
 if(typeof raw?.reply==='string'&&(raw.reply.length>1600||malformed.test(raw.reply)))fail('rehearsal_reply_invalid');
 if(typeof raw?.delivery?.language_hint==='string'&&(raw.delivery.language_hint.length>32||malformed.test(raw.delivery.language_hint)))fail('rehearsal_delivery_invalid');
 return validateDialogueOutput(raw);
}

// Store admission and dispatch are separate: an HTTP retry only reads its durable request.
export function createPrivateTextRehearsalHandler({db,requireUser,store,resolveGenerator,engine,
 gateReply,hasGate,honestyContextFor,loadNeverRules,compileNeverRules,budget=spend,env=process.env}){
 if([db,requireUser,resolveGenerator,gateReply,hasGate,honestyContextFor,loadNeverRules,compileNeverRules].some(f=>typeof f!=='function'))throw Error('private_rehearsal_dependencies_required');
 const platformReady=()=>{if(typeof engine?.compilePrivateExpertRehearsal!=='function'||typeof engine?.parseExpertAnswer!=='function'||!hasGate(engine))fail('rehearsal_engine_unavailable');};
 return async function privateTextRehearsal(req,res){
  const aborter=new AbortController();const abort=()=>aborter.abort(new Error('request_aborted'));
  const closed=()=>{if(!res.writableEnded)abort();};req.on?.('aborted',abort);res.on?.('close',closed);
  if(req.aborted||res.destroyed)abort();
  let owner=null,requestInput=null,admitted=null,reservation=null,claim=null,begun=false,providerStarted=false,settlementAttempted=false,billing='not_started';
  try{
   if(aborter.signal.aborted)fail('rehearsal_request_aborted',409);
   if(!['GET','POST'].includes(req.method))fail('method_not_allowed',405);
   owner=(await requireUser(req)).id;let input=req.method==='GET'?req.query||{}:req.body||{};requestInput=input;
   const options={env};
   if(req.method==='GET'&&input.op==='readiness'){
    const readiness=await store.readPrivateTextReadiness(db,owner,input,options);
    if(readiness.can_ask)try{platformReady();const generator=adapterReady(await resolveGenerator());budget.foundryBudgetConfig(generator.billing.budget_env||env);}catch(error){return res.status(200).json({readiness:{...readiness,state:'unavailable',can_ask:false,blockers:[...readiness.blockers,{code:safeCode(error),responsibility:'platform'}]}});}
    return res.status(200).json({readiness});
   }
   if(req.method==='GET'&&input.op==='result')return res.status(200).json({rehearsal:await store.readPrivateTextRehearsal(db,owner,input,options)});
   if(req.method==='POST'&&input.op==='withdraw')return res.status(200).json(await store.withdrawPrivateTextRehearsal(db,owner,input,options));
   if(req.method!=='POST'||input.op!=='ask')fail('unknown_op',400);
   admitted=await store.admitPrivateTextRehearsal(db,owner,input,options);
   if(!admitted.created)return res.status(200).json({rehearsal:await store.readPrivateTextRehearsal(db,owner,input,options)});
   input={...input,replica_id:admitted.request.replica_id,request_id:admitted.request.request_id};requestInput=input;
   platformReady();const generator=adapterReady(await resolveGenerator());budget.foundryBudgetConfig(generator.billing.budget_env||env);
   const compiled=engine.compilePrivateExpertRehearsal(admitted.compilerInput);
   const prompt={schema:'private_text_rehearsal/v1',messages:[{role:'system',content:compiled.system},{role:'user',content:compiled.question}]};
   prompt.prompt_hash=sha256Hex(canonicalJson(prompt));
   // No scoped rule text enters the prompt or shared-past record.
   if(aborter.signal.aborted)fail('rehearsal_request_aborted',409);
   reservation=await budget.reserveFoundrySpend(db,{operation:'dialogue',requestKey:'private-text-rehearsal:'+input.request_id,adapter:generator,messages:prompt.messages,env:generator.billing.budget_env||env});
   if(!reservation)fail('rehearsal_budget_unavailable');billing='reserved';
   claim=await store.claimPrivateTextRehearsal(db,owner,{replica_id:input.replica_id,request_id:input.request_id,reservation,provider:{family:generator.family,name:generator.name,version:generator.version,model:generator.model,prompt_hash:prompt.prompt_hash}},options);
   if(!claim?.dispatch_token)fail('rehearsal_dispatch_not_claimed',409);
   // Exclusive dispatch is held and begin has not been attempted, so release is safe here only.
   if(aborter.signal.aborted){await budget.releaseFoundrySpendBeforeCall(db,reservation,'rehearsal_request_aborted');reservation=null;billing='not_started';fail('rehearsal_request_aborted',409);}
   begun=true;await budget.beginFoundrySpend(db,reservation);billing='in_flight';
   providerStarted=true;const generated=await generator.generate({prompt,signal:aborter.signal});
   // Actual provider usage is payable even when gates or current authority refuse delivery.
   settlementAttempted=true;try{await budget.settleFoundrySpend(db,reservation,generated.usage);billing='settled';}
   catch(error){billing='reconcile_required';await budget.markFoundrySpendUncertain(db,reservation,error);}
   const output=rehearsalOutput(generated.output);
   const rules=compileNeverRules(await loadNeverRules(db,input.replica_id,owner));
   const honesty=honestyContextFor(engine,compiled,[{role:'user',content:compiled.question}],{record:[],nameable:[]});
   const gated=gateReply(engine,output.reply,honesty,'private-rehearsal',rules,'expert_answer');
   if(!gated.gated||!gated.text||gated.neverRule)fail('rehearsal_answer_withheld',409);
   const rehearsal=await store.completePrivateTextRehearsal(db,owner,{replica_id:input.replica_id,request_id:input.request_id,dispatch_token:claim.dispatch_token,
    answer:gated.text,raw_output:generated.output,gate:{gated:true,finding_count:gated.findings?.length||0},billing_state:billing},options);
   return res.status(201).json({rehearsal});
  }catch(error){
   // A measured adapter refusal is payable; an unknown begin or transport is not
   // a reason to invent units. Never retry an ambiguous settlement acknowledgement.
   if(reservation&&providerStarted&&!settlementAttempted&&error?.measured_usage){
    settlementAttempted=true;
    try{await budget.settleFoundrySpend(db,reservation,error.measured_usage);billing='settled';}
    catch{billing='reconcile_required';}
   }
   if(reservation&&begun&&billing!=='settled'){
    billing='reconcile_required';await budget.markFoundrySpendUncertain(db,reservation,error).catch(()=>{});
   }
   if(admitted?.created&&owner&&requestInput)await store.failPrivateTextRehearsal(db,owner,{replica_id:requestInput.replica_id,request_id:requestInput.request_id,dispatch_token:claim?.dispatch_token,
    failure_code:safeCode(error),billing_state:billing},{env}).catch(()=>{});
   const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?error.status:503;
   return res.status(status).json({error:safeCode(error),...(admitted?.created?{request_id:admitted.request.request_id}:{} )});
  }finally{req.off?.('aborted',abort);res.off?.('close',closed);}
 };
}
