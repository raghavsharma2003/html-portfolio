import assert from 'node:assert/strict';
import {createCandidateActivationHandler} from '../api/replica-candidate-activation.js';
import {ACTIVATION_CURRENT_SQL} from '../api/_replica-candidate-activation.js';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const req=(body={},method='POST',ip='192.0.2.156')=>({method,body,headers:{'x-forwarded-for':ip}});
const res=()=>({headers:{},statusCode:null,body:null,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}});
let authCalls=0,dbCalls=0;
const forbidden=createCandidateActivationHandler({auth:async()=>{authCalls++;throw Object.assign(Error('authentication_required'),{status:401,code:'authentication_required'});},db:async()=>{dbCalls++;throw Error('unexpected_database');}});
let response=res();await forbidden(req({},'GET'),response);
assert.equal(response.statusCode,405);assert.equal(authCalls,0);assert.equal(dbCalls,0);
response=res();await forbidden(req({op:'reset',replica_id:id(1)}),response);
assert.equal(response.statusCode,401);assert.equal(dbCalls,0);assert.equal(response.headers['Cache-Control'],'no-store');

const seen=[];
const owned=createCandidateActivationHandler({auth:async()=>({id:id(2)}),db:async(sql,args)=>{seen.push({sql,args});assert.equal(sql,ACTIVATION_CURRENT_SQL);return[];}});
response=res();await owned(req({op:'status',replica_id:id(1),owner_user_id:id(99),candidate_id:id(3),artifact:{injected:true},sql:'select unsafe',qualification:{verdict:'pass'}}),response);
assert.equal(response.statusCode,200);assert.deepEqual(seen[0].args,[id(1),id(2)]);
assert.equal(response.body.can_activate,false);assert.equal(response.body.can_reset,false);
assert.equal(JSON.stringify(seen).includes('unsafe'),false);assert.equal(response.headers['Cache-Control'],'no-store');
response=res();await owned(req({op:'status',replica_id:id(1)}),response);
assert.equal(response.statusCode,200);assert.equal(response.body.candidate_id,null);

let rateDbCalls=0;
const limited=createCandidateActivationHandler({auth:async()=>({id:id(70)}),db:async()=>{rateDbCalls++;return[];}});
for(let n=0;n<31;n++){
 response=res();await limited(req({op:'status',replica_id:id(1)},'POST',`198.51.100.${n+1}`),response);
 assert.equal(response.statusCode,n<30?200:429);
}
assert.equal(rateDbCalls,30,'changing IP must not bypass the authenticated owner bucket');
console.log('4 activation HTTP controls passed: method/auth refusal, verified owner and proof whitelist, candidate-free status, actual owner rate bucket; no SQL/network');
