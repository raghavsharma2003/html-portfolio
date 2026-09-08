import {canonicalJson,sha256Hex} from './_provenance/contracts.js';
import {validateDialogueOutput} from './_dialogue/contracts.js';
import * as spend from './_provider-budget.js';

const refuse=(code,status=503)=>{throw Object.assign(new Error(code),{code,status});};
const safeCode=error=>/^[a-z][a-z0-9_]{2,100}$/.test(error?.code||'')?error.code:'text_publication_failed';
const statusOf=error=>Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?error.status:503;
function adapterReady(generator){
 if(generator?.name!=='azure-foundry-structured-output'||generator?.billing?.meter!=='azure_foundry_tokens'||typeof generator.generate!=='function')refuse('text_publication_azure_unavailable');
 return generator;
}
export function textPublicationOutput(value){
 let raw=value;
 if(typeof raw==='string')try{raw=JSON.parse(raw);}catch{refuse('text_publication_output_invalid');}
 const malformed=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
 if(typeof raw?.reply!=='string'||raw.reply.length>1600||malformed.test(raw.reply))refuse('text_publication_reply_invalid');
 if(typeof raw?.delivery?.language_hint==='string'&&(raw.delivery.language_hint.length>32||malformed.test(raw.delivery.language_hint)))refuse('text_publication_delivery_invalid');
 return validateDialogueOutput(raw);
}
const bodyOf=req=>{
 const input=req.method==='GET'?req.query:req.body;
 if(!input||typeof input!=='object'||Array.isArray(input))refuse('text_publication_input_invalid',400);
 return input;
};

export function createTextPublicationOwnerHandler({db,requireUser,store,resolveGenerator,engine,hasGate,budget=spend,env=process.env}){
 return async function textPublicationOwner(req,res){
  try{
   if(!['GET','POST'].includes(req.method))refuse('text_publication_method_not_allowed',405);
   const owner=(await requireUser(req)).id,input=bodyOf(req);
   if(req.method==='GET'&&input.op==='readiness'){
    const readiness=await store.readTextPublicationReadiness(db,owner,input,{env});
    if(readiness.can_publish)try{
     if(typeof engine?.compilePublishedMaterialAssistant!=='function'||typeof engine?.parseExpertAnswer!=='function'||typeof hasGate!=='function'||!hasGate(engine))refuse('text_publication_engine_unavailable');
     budget.foundryBudgetConfig(env);adapterReady(await resolveGenerator());
    }catch(error){return res.status(200).json({readiness:{...readiness,state:'unavailable',can_publish:false,blockers:[...readiness.blockers,{code:safeCode(error),responsibility:'platform'}]}});}
    return res.status(200).json({readiness});
   }
   if(req.method==='GET'&&input.op==='status')return res.status(200).json({publication:await store.readOwnedTextPublication(db,owner,input)});
   if(req.method==='POST'&&input.op==='unpublish')return res.status(200).json({publication:await store.unpublishTextPublication(db,owner,input)});
   if(req.method==='POST'&&input.op==='publish'){
    const result=await store.publishTextPublication(db,owner,input,{env});
    return res.status(result.created?201:200).json({publication:result.publication});
   }
   refuse('text_publication_unknown_op',400);
  }catch(error){return res.status(statusOf(error)).json({error:safeCode(error)});}
 };
}

export function createTextPublicationVisitorHandler({db,requireUser,store,resolveGenerator,engine,
 gateReply,hasGate,honestyContextFor,loadNeverRules,compileNeverRules,budget=spend,env=process.env}){
 if([db,requireUser,resolveGenerator,gateReply,hasGate,honestyContextFor,loadNeverRules,compileNeverRules].some(f=>typeof f!=='function'))throw Error('text_publication_dependencies_required');
 const platformReady=()=>{
  if(typeof engine?.compilePublishedMaterialAssistant!=='function'||typeof engine?.parseExpertAnswer!=='function'||!hasGate(engine))refuse('text_publication_engine_unavailable');
  budget.foundryBudgetConfig(env);
 };
 return async function textPublicationVisitor(req,res){
  const aborter=new AbortController(),abort=()=>aborter.abort();
  const closed=()=>{if(!res.writableEnded)abort();};
  req.on?.('aborted',abort);res.on?.('close',closed);
  if(req.aborted||res.destroyed)abort();
  const checkAbort=()=>{if(aborter.signal.aborted)refuse('text_publication_request_aborted',409);};
  let visitor=null,input=null,admitted=null,reservation=null,claim=null,begun=false,billing='not_started';
  const options={env};
  try{
   checkAbort();
   if(!['GET','POST'].includes(req.method))refuse('text_publication_method_not_allowed',405);
   input=bodyOf(req);
   // Session credentials belong in POST bodies, including read-only result retrieval.
   if(req.method==='GET'&&input.op==='open')return res.status(200).json({publication:await store.openTextPublication(db,null,input,options)});
   if(req.method!=='POST')refuse('text_publication_unknown_op',400);
   visitor=(await requireUser(req)).id;checkAbort();
   if(input.op==='join')return res.status(200).json(await store.joinTextPublication(db,visitor,input,options));
   if(input.op==='memory_settings')return res.status(200).json(await store.readTextPublicationMemorySettings(db,visitor,input,options));
   if(input.op==='set_memory')return res.status(200).json(await store.setTextPublicationMemory(db,visitor,input,options));
   if(input.op==='forget')return res.status(200).json(await store.forgetTextPublicationVisitor(db,visitor,input,options));
   if(input.op==='result')return res.status(200).json({request:await store.readTextPublicationRequest(db,visitor,input,options)});
   if(input.op!=='ask')refuse('text_publication_unknown_op',400);
   admitted=await store.admitTextPublicationRequest(db,visitor,input,options);
   if(!admitted.created)return res.status(200).json({request:await store.readTextPublicationRequest(db,visitor,input,options)});
   input={public_id:admitted.request.public_id,request_id:admitted.request.request_id,session_token:input.session_token};
   if(admitted.failure_code)refuse(admitted.failure_code,409);
   platformReady();const generator=adapterReady(await resolveGenerator());
   const compiled=engine.compilePublishedMaterialAssistant(admitted.compilerInput);
   const prompt={schema:admitted.compilerInput.authority.basis,messages:[{role:'system',content:compiled.system},{role:'user',content:compiled.question}]};
   prompt.prompt_hash=sha256Hex(canonicalJson(prompt));
   checkAbort();
   reservation=await budget.reserveFoundrySpend(db,{operation:'dialogue',requestKey:'text-publication:'+input.request_id,adapter:generator,messages:prompt.messages,env});
   if(!reservation)refuse('text_publication_budget_unavailable');billing='reserved';
   claim=await store.claimTextPublicationRequest(db,visitor,{...input,reservation,provider:{family:generator.family,name:generator.name,version:generator.version,model:generator.model,prompt_hash:prompt.prompt_hash}},options);
   if(!claim?.dispatch_token)refuse('text_publication_dispatch_not_claimed',409);
   checkAbort();
   // Set before awaiting: an ambiguous begin may have committed and cannot be released.
   begun=true;await budget.beginFoundrySpend(db,reservation);billing='in_flight';
   checkAbort();
   const generated=await generator.generate({prompt,signal:aborter.signal});
   // Cancellation/authority refusal cannot erase usage already incurred.
   try{await budget.settleFoundrySpend(db,reservation,generated.usage);billing='settled';}
   catch(error){billing='reconcile_required';await budget.markFoundrySpendUncertain(db,reservation,error);}
   checkAbort();
   const output=textPublicationOutput(generated.output);
   const rules=compileNeverRules(await loadNeverRules(db,admitted.replica_id,admitted.owner_user_id));
   const honesty=honestyContextFor(engine,compiled,[{role:'user',content:compiled.question}],{record:compiled.privateMemoryRecord||[],nameable:[]});
   const gated=gateReply(engine,output.reply,honesty,'text-publication',rules,'expert_answer');
   if(!gated.gated||!gated.text||gated.neverRule)refuse('text_publication_answer_withheld',409);
   checkAbort();
   await store.completeTextPublicationRequest(db,visitor,{...input,dispatch_token:claim.dispatch_token,answer:gated.text,raw_output:generated.output,
    gate:{gated:true,finding_count:gated.findings?.length||0},billing_state:billing},options);
   // Readback checks current source/publication/session again and returns only visitor-safe fields.
   const request=await store.readTextPublicationRequest(db,visitor,input,options);checkAbort();
   return res.status(201).json({request});
  }catch(error){
   if(reservation&&begun&&billing!=='settled'){
    billing='reconcile_required';await budget.markFoundrySpendUncertain(db,reservation,error).catch(()=>{});
   }else if(reservation&&!begun){
    // Only the unique created:true admission handler can reserve this request.
    try{
     const released=await budget.releaseFoundrySpendBeforeCall(db,reservation,safeCode(error));
     if(!released)refuse('text_publication_release_unconfirmed');
     billing='not_started';
    }
    catch{billing='reconcile_required';await budget.markFoundrySpendUncertain(db,reservation,error).catch(()=>{});}
   }
   if(admitted?.created&&visitor&&input)await store.failTextPublicationRequest(db,visitor,{...input,dispatch_token:claim?.dispatch_token,failure_code:safeCode(error),billing_state:billing},options).catch(()=>{});
   return res.status(statusOf(error)).json({error:safeCode(error),...(admitted?.created?{request_id:admitted.request.request_id}:{})});
  }finally{req.off?.('aborted',abort);res.off?.('close',closed);}
 };
}
