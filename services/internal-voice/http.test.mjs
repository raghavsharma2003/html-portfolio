import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHmac} from 'node:crypto';
import {createInternalVoiceProxy} from '../../api/_internal-voice-proxy.js';
import {createInternalVoiceHandler} from './http.mjs';
import {createVoiceAllocationAdmissionHandler} from '../../api/_voice/allocation-admission-handler.js';
import {sha} from './contract.mjs';
const owner='11111111-1111-4111-8111-111111111111',replica='22222222-2222-4222-8222-222222222222';
const env={VYAKTI_INTERNAL_VOICE_MODE:'owner-only',VYAKTI_MODEL_SERVING:'azure_only',VYAKTI_INTERNAL_VOICE_OWNER_USER_ID:owner,VYAKTI_INTERNAL_VOICE_REPLICA_ID:replica,VYAKTI_INTERNAL_VOICE_ORIGIN:'https://cpu.test.azurecontainerapps.io'};
function response(){return{headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;}};}
test('proxy authorizes exact owner before fetch and forwards only configured Azure endpoint',async()=>{
  let calls=0;const req={method:'GET',url:`/api/internal-voice?replica_id=${replica}`,headers:{authorization:'Bearer synthetic-session'}};
  const denied=response();await createInternalVoiceProxy({env,requireUser:async()=>({id:replica}),fetchImpl:async()=>{calls++;}})(req,denied);assert.equal(denied.code,404);assert.equal(calls,0);
  const accepted=response();await createInternalVoiceProxy({env,requireUser:async()=>({id:owner}),fetchImpl:async(url,init)=>{calls++;assert.equal(url.origin,env.VYAKTI_INTERNAL_VOICE_ORIGIN);assert.equal(init.headers.Authorization,req.headers.authorization);assert.equal(init.redirect,'error');return Response.json({enabled:true});}})(req,accepted);
  assert.equal(accepted.code,200);assert.equal(calls,1);assert.equal(accepted.headers['Cache-Control'],'private, no-store');
});
test('CPU API returns queued run and authenticated binary playback through the same runtime seam',async()=>{
  let called=0;const handler=createInternalVoiceHandler({env,requireUser:async()=>({id:owner}),runtime:{generate:async(user,r,id)=>{called++;assert.equal(user.id,owner);assert.equal(r,replica);return{run:{run_id:id,state:'queued'}};},audio:async()=>Buffer.from('WAVE')}});
  const start=response();await handler({method:'POST',url:'/api/internal-voice',body:{action:'generate',replica_id:replica,run_id:owner}},start);assert.equal(start.code,202);assert.equal(called,1);
  const audio=response();await handler({method:'GET',url:`/api/internal-voice?action=audio&replica_id=${replica}&run_id=${owner}`},audio);assert.equal(audio.headers['Content-Type'],'audio/wav');assert.equal(audio.body.toString(),'WAVE');
});
test('existing signed admission handler delegates exact six fields and signs response; tampering cannot consume',async()=>{
  const key=Buffer.alloc(32,171),nonce='123456789012345678901234',timestamp=new Date().toISOString(),path='/api/voice-allocation-admission',protocol='vyakti-open-voice/v1';
  const input={window_id:owner,child_id:replica,operation:'status',body_sha256:'b'.repeat(64),broker_origin:'https://broker.test.azurecontainerapps.io',runtime_origin:'https://runtime.internal.test.azurecontainerapps.io'},bytes=Buffer.from(JSON.stringify(input));
  const sign=parts=>createHmac('sha256',key).update(parts.join('\n')).digest('base64url');let calls=0;
  const handler=createVoiceAllocationAdmissionHandler({env:{AZURE_VOICE_APP_ENABLED:'true',OPEN_VOICE_HMAC_SECRET:key.toString('hex')},consume:async value=>{calls++;assert.deepEqual(value,input);return{authorized:true};}});
  const headers={'x-vyakti-protocol':protocol,'x-vyakti-nonce':nonce,'x-vyakti-timestamp':timestamp,'x-vyakti-content-sha256':sha(bytes),'x-vyakti-signature':sign([protocol,'POST',path,timestamp,nonce,sha(bytes)])};
  const request=()=>Object.assign(Readable.from([bytes]),{method:'POST',headers:{...headers}});
  const good=response();await handler(request(),good);assert.equal(good.code,200);assert.equal(good.headers['X-Vyakti-Response-Signature'],sign([protocol,'response',path,nonce,'200',sha(good.body)]));
  const bad=request();bad.headers['x-vyakti-signature']='tampered';const denied=response();await handler(bad,denied);assert.equal(denied.code,401);assert.equal(calls,1);
});
