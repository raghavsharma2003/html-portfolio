import {q} from './_db.js';
import {requireUser} from './_auth.js';
import {allow,ipOf} from './_ratelimit.js';
import * as store from './_text-publication-store.js';
import * as engine from './_engine.gen.js';
import {hasGate} from './_surface.js';
import {createProductionDialogueGenerator} from './_dialogue/registry.js';
import {createTextPublicationOwnerHandler} from './_text-publication-runtime.js';

const run=createTextPublicationOwnerHandler({db:q,store,engine,hasGate,resolveGenerator:createProductionDialogueGenerator,requireUser:async req=>{
 const user=await requireUser(req);
 if(!allow(user.id,'text_publication_owner',60))throw Object.assign(new Error('slow_down'),{code:'slow_down',status:429});
 return user;
}});
export default async function handler(req,res){
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
 res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS')return res.status(204).end();
 if(!allow(ipOf(req),'text_publication_owner_ip',90))return res.status(429).json({error:'slow_down'});
 return run(req,res);
}
