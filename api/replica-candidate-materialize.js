import {q} from './_db.js';
import {requireUser,AuthError} from './_auth.js';
import {allow,ipOf} from './_ratelimit.js';
import {createProductionComparisonGenerator} from './_dialogue/registry.js';
import {readOwnedMaterialization,startOwnedMaterialization,advanceOwnedMaterialization} from './_replica-candidate-materializer.js';

export function createMaterializationHandler({db=q,auth=requireUser,generator=createProductionComparisonGenerator,env=process.env}={}){
 return async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  if(!allow(ipOf(req),'candidate_materialize_ip',120))return res.status(429).json({error:'slow_down'});
  const controller=new AbortController(),cancel=()=>controller.abort(Error('materialization_client_closed'));
  req.signal?.addEventListener('abort',cancel,{once:true});
  if(req.signal?.aborted)cancel();
  const deadline=setTimeout(()=>controller.abort(Error('materialization_deadline')),75000);
  try{
   const user=await auth(req),body=req.body||{};
   if(!allow(user.id,'candidate_materialize_owner',120))return res.status(429).json({error:'slow_down'});
   if(body.op==='status')return res.status(200).json({job:await readOwnedMaterialization(db,user.id,body)});
   if(!['start','advance'].includes(body.op))return res.status(400).json({error:'unknown_op'});
   const options={adapter:generator(),env,signal:controller.signal};
   const job=body.op==='start'?await startOwnedMaterialization(db,user.id,body,options):await advanceOwnedMaterialization(db,user.id,body,options);
   return res.status(200).json({job});
  }catch(error){
   if(error instanceof AuthError)return res.status(error.status).json({error:error.code});
   const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?error.status:500;
   return res.status(status).json({error:status===500?'materialization_failed':String(error.code||error.message)});
  }finally{clearTimeout(deadline);req.signal?.removeEventListener('abort',cancel);}
 };
}
export default createMaterializationHandler();
