import assert from 'node:assert/strict';
import {createComparisonPreparationHandler} from '../../api/replica-comparison-preparation.js';
import {COMPARISON_PREPARATION_READ_SQL} from '../../api/_comparison-preparation.js';
import {stableUuid} from '../../api/_replica-processing/contracts.js';
const id=s=>stableUuid('comparison-endpoint:'+s),owner=id('owner'),rid=id('replica'),pid=id('preparation');
let calls=0;
const handler=createComparisonPreparationHandler({auth:async()=>({id:owner}),rate:()=>true,db:async(sql,p)=>{
 calls++;assert.equal(sql,COMPARISON_PREPARATION_READ_SQL);assert.equal(p[2],owner);
 if(p[1]!==rid)return[];return[{preparation_id:pid,source_id:id('source'),state:'prepared',expires_at:new Date(Date.now()-1000).toISOString(),completed_receipt_sha256:'a'.repeat(64),receipt:{secret:'private'}}];
}});
async function call(body,method='POST'){const out={headers:{}};const res={setHeader(k,v){out.headers[k]=v;},status(n){out.status=n;return this;},json(x){out.body=x;return this;}};await handler({method,body,headers:{}},res);return out;}
const r=await call({op:'status',replica_id:rid,preparation_id:pid,owner_user_id:id('spoof')});
assert.equal(r.status,200);assert.equal(r.body.preparation.state,'expired');assert.equal(r.body.preparation.completed_receipt_sha256,null);assert.equal(r.body.preparation.can_voice,false);assert(!('receipt' in r.body.preparation));assert.equal(r.headers['Cache-Control'],'no-store');
assert.equal((await call({op:'status',replica_id:id('foreign'),preparation_id:pid})).status,404);
const before=calls;assert.equal((await call({op:'readiness'})).body.readiness.can_prepare,false);assert.equal(calls,before);
assert.equal((await call({},'GET')).status,405);assert.equal(calls,before);
console.log('4 actual status/readiness endpoint controls passed with synthetic auth/SQL, including expiry and foreign-owner scope');
