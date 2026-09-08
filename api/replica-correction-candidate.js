// Explicit owner request; candidate construction is private and never activates.
import {q} from './_db.js';
import {requireUser,AuthError} from './_auth.js';
import {allow,ipOf} from './_ratelimit.js';
import {readOwnedCorrectionCandidate,runOwnedCorrectionCandidate} from './_replica-correction-candidate.js';
import {createAzureCorrectionStrategyAdapter} from './_correction/providers/azure-foundry.js';
export function createCorrectionCandidateHandler({db,authenticate,resolveAdapter,env=process.env}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'GET or POST only'});
  try{
   const user=await authenticate(req);
   if(!allow(user.id,'correction_candidate_owner',20))return res.status(429).json({error:'slow_down'});
   const input=req.method==='GET'?req.query:req.body;
   const job=req.method==='GET'?await readOwnedCorrectionCandidate(db,user.id,input)
    :await runOwnedCorrectionCandidate(db,user.id,input,{adapter:await resolveAdapter(),env});
   return res.status(200).json({job});
  }catch(error){
   const status=error instanceof AuthError?error.status:Number.isInteger(error?.status)?error.status:500;
   const code=status<500&&typeof error?.code==='string'?error.code:'correction_candidate_unavailable';
   return res.status(status).json({error:code});
  }
 };
}
const serve=createCorrectionCandidateHandler({db:q,authenticate:requireUser,
 resolveAdapter:()=>createAzureCorrectionStrategyAdapter({endpoint:process.env.AZURE_FOUNDRY_ENDPOINT,
  model:process.env.AZURE_FOUNDRY_DIALOGUE_MODEL,apiKey:process.env.AZURE_FOUNDRY_API_KEY,
  ...(process.env.AZURE_FOUNDRY_EXPECTED_RESPONSE_MODEL?{revisionBinding:{
   expected_response_model:process.env.AZURE_FOUNDRY_EXPECTED_RESPONSE_MODEL,
   baseline_snapshot_hash:process.env.AZURE_CORRECTION_BASE_MODEL_COMMITMENT}}:{})})});
export default async function handler(req,res){
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
 res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS')return res.status(204).end();
 if(!allow(ipOf(req),'correction_candidate_ip',12))return res.status(429).json({error:'slow_down'});
 return serve(req,res);
}
