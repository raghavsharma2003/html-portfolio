import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHmac,createHash} from 'node:crypto';
import {createVoiceAllocationAdmissionHandler} from '../api/_voice/allocation-admission-handler.js';
const secret='a'.repeat(64),key=Buffer.from(secret,'hex'),path='/api/voice-allocation-admission',proto='vyakti-open-voice/v1';
const hash=b=>createHash('sha256').update(b).digest('hex'),sign=a=>createHmac('sha256',key).update(a.join('\n')).digest('base64url');
const input={window_id:'11111111-1111-4111-8111-111111111111',child_id:'22222222-2222-4222-8222-222222222222',operation:'status',body_sha256:'a'.repeat(64),broker_origin:'https://broker.azurecontainerapps.io',runtime_origin:'https://gpu.internal.azurecontainerapps.io'};
let dbCalls=0,used=false;
const handler=createVoiceAllocationAdmissionHandler({env:{AZURE_VOICE_APP_ENABLED:'true',OPEN_VOICE_HMAC_SECRET:secret},db:async()=>{dbCalls++;if(used)return[];used=true;return[{child_id:input.child_id,dispatch_not_after:'2099-01-01T00:00:00.000Z'}]}});
async function invoke({payload=input,tamper=false,method='POST'}={}){
 const bytes=Buffer.from(JSON.stringify(payload)),stamp=new Date().toISOString(),nonce='a'.repeat(24);
 const req=Readable.from([bytes]);req.method=method;req.headers={'x-vyakti-protocol':proto,'x-vyakti-nonce':nonce,'x-vyakti-timestamp':stamp,'x-vyakti-content-sha256':hash(bytes),'x-vyakti-signature':tamper?'bad':sign([proto,'POST',path,stamp,nonce,hash(bytes)])};
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},send(b){this.bytes=b;return this;}};
 await handler(req,res);assert.equal(res.headers['X-Vyakti-Response-Signature'],sign([proto,'response',path,nonce,String(res.code),hash(res.bytes)]));return res;
}
assert.equal((await invoke({tamper:true})).code,401);assert.equal(dbCalls,0);
assert.equal((await invoke({payload:{...input,extra:true}})).code,400);assert.equal(dbCalls,0);
const first=await invoke();assert.equal(first.code,200);assert.deepEqual(JSON.parse(first.bytes),{authorized:true,window_id:input.window_id,child_id:input.child_id,operation:'status',body_sha256:input.body_sha256,dispatch_not_after:'2099-01-01T00:00:00.000Z'});
assert.equal((await invoke()).code,409);assert.equal(dbCalls,2);
assert.equal((await invoke({method:'GET'})).code,405);
console.log('voice53 admission: signed request/response, exact binding, replayCAS and unauthenticated noSQL controls passed (synthetic DB).');
