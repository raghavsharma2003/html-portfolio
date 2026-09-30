import assert from 'node:assert/strict';
import {createMaterializationHandler} from '../api/replica-candidate-materialize.js';
import {AuthError} from '../api/_auth.js';
import {loadOwnedCandidateEvaluation} from '../api/_replica-candidate-eval.js';
import {MATERIALIZATION_STATUS_SQL} from '../api/_replica-candidate-materializer.js';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),replica=id(2),dataset=id(3),candidate=id(4);
const body={op:'status',replica_id:replica,dataset_id:dataset,candidate_id:candidate,owner_user_id:id(9),admission:{sql:'malicious'}};
function res(){return{statusCode:0,setHeader(){},status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}};}
let groups=0;
async function test(name,fn){await fn();console.log(`ok ${++groups} - ${name}`);}
await test('status derives owner only from authenticated session and never creates an adapter',async()=>{
 let calls=0;const handler=createMaterializationHandler({auth:async()=>({id:owner}),generator:()=>{throw Error('unexpected model');},db:async(sql,p)=>{
  calls++;assert.equal(sql,MATERIALIZATION_STATUS_SQL);assert.deepEqual(p,[replica,owner,dataset,candidate]);return[];
 }}),r=res();await handler({method:'POST',headers:{},body},r);assert.equal(r.statusCode,200);assert.deepEqual(r.body,{job:null});assert.equal(calls,1);
});
await test('unauthenticated action cannot reach data or generation',async()=>{
 const handler=createMaterializationHandler({auth:async()=>{throw new AuthError('unauthorized',401);},db:()=>{throw Error('unexpected SQL');},generator:()=>{throw Error('unexpected model');}}),r=res();
 await handler({method:'POST',headers:{},body:{...body,op:'advance'}},r);assert.equal(r.statusCode,401);
});
await test('unknown operation and malformed IDs refuse before SQL',async()=>{
 for(const patch of [{op:'activate'},{replica_id:'bad'}]){
  let calls=0;const handler=createMaterializationHandler({auth:async()=>({id:owner}),db:()=>{calls++;throw Error('unexpected SQL');}}),r=res();
  await handler({method:'POST',headers:{},body:{...body,...patch}},r);assert.equal(r.statusCode,400);assert.equal(calls,0);
 }
});
await test('blind reader filters exact owner candidate without exposing identity in response',async()=>{
 const output=await loadOwnedCandidateEvaluation(async(sql,p)=>{assert.match(sql,/and c\.candidate_id=\$3::uuid/);assert.deepEqual(p,[replica,owner,candidate]);return[];},owner,replica,{},candidate);
 assert.deepEqual(output,{available:false,replica_id:replica});
 await assert.rejects(()=>loadOwnedCandidateEvaluation(()=>{throw Error('unexpected SQL');},owner,replica,{},'invalid'),{code:'candidate_id_invalid'});
});
console.log(`${groups} materializer route groups, synthetic auth and SQL only`);
