import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const original=readFileSync(new URL('../../src/studio/publication/publicationApi.ts',import.meta.url),'utf8');
const fixture={public_id:'10000000-0000-4000-8000-000000000001',request_id:'20000000-0000-4000-8000-000000000001',state:'complete',billing_state:'settled',answer:'Synthetic answer.',can_voice:false};
async function load(source){
 const stub=`export const calls=[];const AbortSignal={timeout(ms){return {fixtureTimeout:ms}}};const replicaRequest=async(token,path,init)=>{const op=JSON.parse(init.body).op;const timeout=init.signal?.fixtureTimeout??20000;calls.push({op,timeout});if(op==='ask'&&timeout<30000)throw Error('simulated_client_timeout_before_service_response');return {request:${JSON.stringify(fixture)}};};`;
 const body=source.replace('import { replicaRequest } from "../replicaApi";',stub);
 assert.notEqual(body,source);return import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
}
const current=await load(original);
await current.askPublication('synthetic',fixture.public_id,'synthetic-session',fixture.request_id,'Question');
assert.deepEqual(current.calls,[{op:'ask',timeout:90000}]);
console.log('ok1 actual ask deadline covers bounded service envelope without retry');
await current.readPublicationAnswer('synthetic',fixture.public_id,'synthetic-session',fixture.request_id);
assert.deepEqual(current.calls[1],{op:'result',timeout:20000});
console.log('ok2 status retains short read deadline');
const old=original.replace(', AbortSignal.timeout(90_000))',')');assert.notEqual(old,original);
const previous=await load(old);
await assert.rejects(()=>previous.askPublication('synthetic',fixture.public_id,'synthetic-session',fixture.request_id,'Question'),/simulated_client_timeout/);
assert.deepEqual(previous.calls,[{op:'ask',timeout:20000}]);
console.log('ok3 removed dedicated deadline reproduces early timeout; no actual clock or provider claim');
