import {q} from './_db.js';
import {requireUser} from './_auth.js';
import {allow,ipOf} from './_ratelimit.js';
import * as engine from './_engine.gen.js';
import * as store from './_private-text-rehearsal-store.js';
import {createProductionDialogueGenerator} from './_dialogue/registry.js';
import {gateReply,hasGate,honestyContextFor} from './_surface.js';
import {loadNeverRules} from './_review-queue.js';
import {compileNeverRules} from './_never-rules.js';
import {createPrivateTextRehearsalHandler} from './_private-text-rehearsal.js';
const run=createPrivateTextRehearsalHandler({db:q,requireUser:async req=>{
 const user=await requireUser(req);if(!allow(user.id,'private_text_rehearsal_owner',60))throw Object.assign(new Error('slow_down'),{code:'slow_down',status:429});return user;
},store,resolveGenerator:createProductionDialogueGenerator,engine,gateReply,hasGate,honestyContextFor,loadNeverRules,compileNeverRules});
export default async function handler(req,res){
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
 res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS')return res.status(204).end();
 if(!allow(ipOf(req),'private_text_rehearsal_ip',90))return res.status(429).json({error:'slow_down'});
 return run(req,res);
}
