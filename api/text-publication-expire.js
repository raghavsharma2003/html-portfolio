import {timingSafeEqual} from 'node:crypto';
import {q} from './_db.js';
import {expireTextPublications} from './_text-publication-store.js';
import {withSweepRun} from './_sweep-run.js';

export function authorizedTextPublicationExpiry(req,env=process.env){
 const header=req?.headers?.authorization;
 const match=typeof header==='string'?/^Bearer ([^\s]+)$/i.exec(header):null;
 if(!match)return false;
 const expected=Buffer.from(String(env.CRON_SECRET||'')),actual=Buffer.from(match[1]);
 return expected.length>=24&&expected.length===actual.length&&timingSafeEqual(expected,actual);
}

// The time bound is checked between queries; maxDuration bounds the HTTP task.
// A full last page is a backlog signal, not proof that retention is caught up.
export async function drainTextPublicationExpiry(db,{expire=expireTextPublications,clock=Date.now}={}){
 const limit=50,started=clock();let publications=0,requests=0,batches=0,last=0;
 do{
  const result=await expire(db,{limit});
  if(!Number.isInteger(result?.publications)||result.publications<0||result.publications>limit||!Number.isInteger(result?.requests)||result.requests<0)throw Error('text_publication_expiry_result_invalid');
  last=result.publications;publications+=last;requests+=result.requests;batches++;
 }while(last===limit&&batches<4&&clock()-started<8000);
 return{publications,requests,batches,more_possible:last===limit};
}

export function createTextPublicationExpiryHandler({db=q,expire=expireTextPublications,env=process.env,clock=Date.now}={}){
 return async function textPublicationExpiry(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'&&req.method!=='POST')return res.status(405).json({error:'text_publication_method_not_allowed'});
  if(!authorizedTextPublicationExpiry(req,env))return res.status(401).json({error:'unauthorized'});
  try{
   // The actual authorized caller records start/final state. A bounded full
   // page is partial work, not a successful retention completion heartbeat.
   const {halted,...result}=await withSweepRun(db,'text-publication-expire',async()=>{
    const summary=await drainTextPublicationExpiry(db,{expire,clock});
    return {...summary,halted:summary.more_possible};
   });
   if(result.more_possible)return res.status(503).json({error:'text_publication_retention_backlog',...result});
   return res.status(200).json({ok:true,...result});
  }catch{return res.status(503).json({error:'text_publication_expiry_failed'});}
 };
}
export default createTextPublicationExpiryHandler();
export const config={maxDuration:60};
