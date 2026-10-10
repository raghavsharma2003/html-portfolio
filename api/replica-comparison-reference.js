import {
  comparisonReferenceOptions,readComparisonReference,authorizeComparisonReference,
  auditionComparisonReference,confirmComparisonReference,withdrawComparisonReference,
} from './_comparison-reference.js';

export const config={maxDuration:60};

// A private response, never a reusable storage capability. The complete object
// is hash checked before a bounded single byte range can be returned.
export {comparisonAudioRange} from './_comparison-reference.js';

export function createComparisonReferenceHandler({db,requireUser,readPrivate,allow=()=>true}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Vary','Authorization');
    if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'method_not_allowed'});
    const controller=new AbortController();
    const abort=()=>controller.abort();
    req.once?.('aborted',abort);
    const closed=()=>{if(!res.writableEnded)abort();};
    res.once?.('close',closed);
    try{
      const user=await requireUser(req);
      if(!allow(user.id,'comparison_reference',40))return res.status(429).json({error:'slow_down'});
      const input=req.method==='GET'?req.query:req.body;
      if(!input||typeof input!=='object')return res.status(400).json({error:'comparison_binding_invalid'});
      controller.signal.throwIfAborted();
      if(req.method==='GET'){
        if(input.op==='options')return res.status(200).json(await comparisonReferenceOptions(db,user.id,input.replica_id,input.cursor??null));
        if(input.op==='status')return res.status(200).json(await readComparisonReference(db,user.id,input.replica_id,input.reference_id));
        if(input.op==='audition'){
          const audio=await auditionComparisonReference(db,user.id,input,readPrivate,{signal:controller.signal,rangeHeader:req.headers?.range});
          controller.signal.throwIfAborted();
          const range=audio.range;
          res.setHeader('Accept-Ranges','bytes');
          if(!range){res.setHeader('Content-Range',`bytes */${audio.body.length}`);return res.status(416).end();}
          if(range.status===206)res.setHeader('Content-Range',`bytes ${range.start}-${range.end}/${audio.body.length}`);
          res.setHeader('Content-Type',audio.mime);
          res.setHeader('Content-Length',String(range.end-range.start+1));
          return res.status(range.status).end(audio.body.subarray(range.start,range.end+1));
        }
      }else{
        if(input.op==='authorize')return res.status(201).json(await authorizeComparisonReference(db,user.id,input));
        if(input.op==='confirm')return res.status(200).json(await confirmComparisonReference(db,user.id,input));
        if(input.op==='withdraw')return res.status(200).json(await withdrawComparisonReference(db,user.id,input));
      }
      return res.status(400).json({error:'comparison_operation_invalid'});
    }catch(error){
      if(controller.signal.aborted||res.headersSent||res.destroyed)return;
      if(error?.code==='comparison_audio_range_invalid'&&Number.isSafeInteger(error.byteLength)){res.setHeader('Content-Range',`bytes */${error.byteLength}`);return res.status(416).end();}
      const status=error?.status===401?401:error?.status===403?403:
        String(error?.code||'').startsWith('comparison_')&&[400,404,409,503].includes(error.status)?error.status:503;
      const code=status===401?'auth_required':status===403?'not_authorized':
        String(error?.code||'').startsWith('comparison_')?error.code:'comparison_unavailable';
      return res.status(status).json({error:code});
    }finally{
      req.off?.('aborted',abort);res.off?.('close',closed);
    }
  };
}

export default async function handler(req,res){
  const [{q},{requireUser},{readPrivateReplicaObject},{allow}]=await Promise.all([
    import('./_db.js'),import('./_auth.js'),import('./_replica-storage.js'),import('./_ratelimit.js'),
  ]);
  return createComparisonReferenceHandler({db:q,requireUser,readPrivate:readPrivateReplicaObject,allow})(req,res);
}
