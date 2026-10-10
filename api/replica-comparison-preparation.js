import {q} from './_db.js';
import {requireUser,AuthError} from './_auth.js';
import {allow,ipOf} from './_ratelimit.js';
import {readOwnedComparisonPreparation,withdrawOwnedComparisonPreparation,clientComparisonPreparation} from './_comparison-preparation.js';
import {comparisonPreparationReadiness} from './_replica-processing/comparison.js';
import {markOwnedSourceDeleting,getOwnedSourceByUploadIntent} from './_replica-source.js';
export function createComparisonPreparationHandler({db=q,auth=requireUser,rate=allow}={}){return async(req,res)=>{
 const requireUser=auth;
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
 if(req.method!=='POST')return res.status(405).json({error:'post_required'});
 try{if(!rate(ipOf(req),'comparison_preparation',30))return res.status(429).json({error:'slow_down'});
 const user=await requireUser(req),b=req.body||{};
 if(b.op==='readiness')return res.status(200).json({readiness:comparisonPreparationReadiness()});
 if(!['status','withdraw'].includes(b.op))return res.status(400).json({error:'unknown_op'});
 const p=b.op==='withdraw'?await withdrawOwnedComparisonPreparation(db,user.id,b.replica_id,b.preparation_id):await readOwnedComparisonPreparation(db,user.id,b.replica_id,b.preparation_id);
 if(!p)return res.status(404).json({error:'comparison_preparation_not_found'});
 if(b.op==='withdraw'){
  const pending=p.source_id?null:await getOwnedSourceByUploadIntent(db,user.id,b.replica_id,b.preparation_id);
  const sid=p.source_id||(pending?.purpose==='comparison_reference'?pending.source_id:null);
  if(sid&&!await markOwnedSourceDeleting(db,user.id,b.replica_id,sid))throw Object.assign(Error('comparison_source_withdrawal_uncertain'),{code:'comparison_source_withdrawal_uncertain',status:503});
 }
 return res.status(200).json({preparation:clientComparisonPreparation(p),readiness:comparisonPreparationReadiness()});
 }catch(e){return res.status(e instanceof AuthError?e.status:e.status||503).json({error:e.code||'comparison_preparation_unavailable'});}
};}
export default createComparisonPreparationHandler();
