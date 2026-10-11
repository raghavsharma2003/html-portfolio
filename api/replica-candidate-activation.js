import {q} from './_db.js';
import {requireUser,AuthError} from './_auth.js';
import {allow,ipOf} from './_ratelimit.js';
import {readOwnedCandidateActivation,changeOwnedCandidateActivation} from './_replica-candidate-activation.js';
export function createCandidateActivationHandler({db=q,auth=requireUser}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
  try{
   const user=await auth(req),body=req.body||{};
   if(!allow(user.id,'candidate-activation-owner',30)||!allow(ipOf(req),'candidate-activation-ip',60))return res.status(429).json({error:'rate_limited'});
   if(!['status','activate','experiment','rollback','reset'].includes(body.op))return res.status(400).json({error:'candidate_activation_op_invalid'});
   // Only explicit identifiers cross into the server-owned receipt builder.
   const input={op:body.op,replica_id:body.replica_id,candidate_id:body.candidate_id,
    expected_capability_id:body.expected_capability_id,qualification_id:body.qualification_id,target_capability_id:body.target_capability_id};
   const status=body.op==='status'?await readOwnedCandidateActivation(db,user.id,input):await changeOwnedCandidateActivation(db,user.id,input);
   return res.status(200).json(status);
  }catch(error){
   if(error instanceof AuthError)return res.status(error.status).json({error:error.code});
   const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?error.status:500;
   return res.status(status).json({error:status===500?'candidate_activation_failed':String(error.code||'candidate_activation_failed')});
  }
 };
}
export default createCandidateActivationHandler();
