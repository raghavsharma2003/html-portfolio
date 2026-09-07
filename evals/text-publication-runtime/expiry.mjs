import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {authorizedTextPublicationExpiry,createTextPublicationExpiryHandler,drainTextPublicationExpiry} from '../../api/text-publication-expire.js';
import {expireTextPublications,TEXT_PUBLICATION_EXPIRE_SQL,TEXT_PUBLICATION_CLEANUP_SQL} from '../../api/_text-publication-store.js';
globalThis.fetch=async()=>{throw Error('unexpected_network_refused');};
const secret='synthetic-retention-secret-1234567890';
const req=(authorization='Bearer '+secret,method='GET')=>({method,headers:{authorization},query:{limit:999999},body:{limit:999999}});
const res=()=>({status(n){this.code=n;return this;},json(body){this.body=body;return this;},setHeader(k,v){this[k]=v;}});
const checks=[];async function check(name,fn){await fn();checks.push(name);console.log(`ok ${checks.length} - ${name}`);}
await check('strict cron bearer, minimum length and timing-safe equality reject bypasses',async()=>{
 assert(authorizedTextPublicationExpiry(req(),{CRON_SECRET:secret}));
 for(const authorization of [undefined,'',secret,'Basic '+secret,'Bearer '+secret+'x','Bearer '+secret+' ',['Bearer '+secret],'Bearer '+secret+'\n'])assert(!authorizedTextPublicationExpiry({headers:{authorization}},{CRON_SECRET:secret}));
 assert(!authorizedTextPublicationExpiry(req(),{}));assert(!authorizedTextPublicationExpiry(req('Bearer short'),{CRON_SECRET:'short'}));
});
await check('unauthorized/default-unconfigured and wrong method never execute cleanup',async()=>{
 let calls=0;for(const [input,env] of [[req('Bearer wrong'),{CRON_SECRET:secret}],[req(),{}],[req(undefined,'DELETE'),{CRON_SECRET:secret}]]){
  const response=res();await createTextPublicationExpiryHandler({db:async()=>{},env,expire:async()=>{calls++;}})(input,response);assert([401,405].includes(response.code));assert.equal(response['Cache-Control'],'no-store');
 }assert.equal(calls,0);
});
await check('actual caller executes exact expiry store SQL at fixed50 despite client batch override',async()=>{
 const queries=[],ids=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'];
 const db=async(sql,args)=>{queries.push({sql,args});if(sql===TEXT_PUBLICATION_EXPIRE_SQL)return[{publications:2,requests:7,publication_ids:ids}];assert.equal(sql,TEXT_PUBLICATION_CLEANUP_SQL);return[{requests:1}];};
 const response=res();await createTextPublicationExpiryHandler({db,env:{CRON_SECRET:secret}})(req(),response);
 assert.equal(response.code,200);assert.deepEqual(queries,[{sql:TEXT_PUBLICATION_EXPIRE_SQL,args:[50]},{sql:TEXT_PUBLICATION_CLEANUP_SQL,args:[ids,null]}]);assert.deepEqual(response.body,{ok:true,publications:2,requests:8,batches:1,more_possible:false});
});
await check('full batches drain at most four and return503 backlog rather than complete retention',async()=>{
 let calls=0;const response=res();await createTextPublicationExpiryHandler({env:{CRON_SECRET:secret},clock:()=>0,expire:async(db,{limit})=>{calls++;assert.equal(limit,50);return{publications:50,requests:100};}})(req(),response);
 assert.equal(calls,4);assert.equal(response.code,503);assert.equal(response.body.error,'text_publication_retention_backlog');assert.equal(response.body.publications,200);
});
await check('between-query clock bound stops another full page and preserves backlog signal',async()=>{
 let calls=0;const times=[0,8001];const result=await drainTextPublicationExpiry(async()=>{},{clock:()=>times.shift()??8001,expire:async()=>{calls++;return{publications:50,requests:1};}});assert.equal(calls,1);assert.equal(result.more_possible,true);
});
await check('short later page reports cumulative actual scrub counts',async()=>{
 const pages=[{publications:50,requests:200},{publications:3,requests:9}];const result=await drainTextPublicationExpiry(async()=>{},{clock:()=>0,expire:async()=>pages.shift()});assert.deepEqual(result,{publications:53,requests:209,batches:2,more_possible:false});
});
await check('SQL failure and invalid result cannot look like empty successful expiry or expose details',async()=>{
 for(const expire of [async()=>{throw Error('secret source and SQL');},async()=>({}),async()=>({publications:51,requests:0}),async()=>({publications:0,requests:-1})]){
  const response=res();await createTextPublicationExpiryHandler({env:{CRON_SECRET:secret},expire})(req(),response);assert.equal(response.code,503);assert.deepEqual(response.body,{error:'text_publication_expiry_failed'});
 }
});
await check('store limit validator prevents unbounded direct callers before SQL',async()=>{
 for(const limit of [0,101,-1,1.5,NaN])await assert.rejects(()=>expireTextPublications(async()=>{throw Error('unexpected SQL');},{limit}),/text_publication_sweep_limit_invalid/);
});
await check('actual store refuses missing aggregate and missing fresh cleanup confirmation',async()=>{
 await assert.rejects(()=>expireTextPublications(async()=>[]),/text_publication_expiry_unconfirmed/);
 await assert.rejects(()=>expireTextPublications(async sql=>sql===TEXT_PUBLICATION_EXPIRE_SQL?[{publications:1,requests:0,publication_ids:['20000000-0000-4000-8000-000000000001']}]:[]),/text_publication_cleanup_unconfirmed/);
});
await check('actual scheduler registry adds exactly one ten-minute caller and preserves every previous cron',async()=>{
 const current=JSON.parse(readFileSync(new URL('../../vercel.json',import.meta.url),'utf8'));
 const oldBytes=readFileSync(new URL('./fixtures/vercel-before.json',import.meta.url));
 assert.equal(createHash('sha256').update(oldBytes).digest('hex'),'4d78e5c8873e7b01e57293f62ea546fa81820c6b4092b017483eefed24f39a2e');
 const old=JSON.parse(oldBytes);
 assert.equal(old.crons.filter(c=>c.path==='/api/text-publication-expire').length,0,'old code negative: no expiry caller');
 for(const previous of old.crons)assert.deepEqual(current.crons.filter(c=>c.path===previous.path),[previous]);
 assert.deepEqual(current.crons.filter(c=>c.path==='/api/text-publication-expire'),[{path:'/api/text-publication-expire',schedule:'*/10 * * * *'}]);
});
const root=new URL('../../',import.meta.url),files=['api/text-publication-expire.js','api/_text-publication-store.js','vercel.json'];
const receipt={at:new Date().toISOString(),passed:checks.length,checks,method:'actual expiry HTTP/store caller with injected SQL result; no PostgreSQL parser/cleanup execution or live cron claim',source_hashes:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(new URL(f,root))).digest('hex')]))};
const folder=new URL('scratchpad/text-publication-runtime/',root);mkdirSync(folder,{recursive:true});const out=new URL('expiry-'+Date.now()+'.json',folder);writeFileSync(out,JSON.stringify(receipt,null,2)+'\n');console.log(`${checks.length} expiry groups passed. Receipt: ${fileURLToPath(out)}`);
