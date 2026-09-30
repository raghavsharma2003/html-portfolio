// Actual adapter and loopback broker-auth controls. No provider, SQL or identity grant.
import assert from 'node:assert/strict';
import test, {mock} from 'node:test';
import {createServer} from 'node:http';
import {createHash,createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {
  createAzureCompositeLivenessVerifier,azureCompositeLivenessConfig,
  AZURE_COMPOSITE_LIVENESS_PROTOCOL as PROTOCOL,
  AZURE_COMPOSITE_LIVENESS_OPERATION as OPERATION,
} from '../api/_liveness/providers/azure-composite.js';
import {createVerifierServer} from '../services/azure-verifier/src/server.js';

const KEY=Buffer.alloc(32,41),SHA='a'.repeat(64),VERSION='transport-fixture-v2';
const ENDPOINT='https://transport-fixture.azurecontainerapps.io/v1/liveness/verify';
const env={AZURE_COMPOSITE_LIVENESS_ENABLED:'true',AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED:'true',
  AZURE_COMPOSITE_LIVENESS_ENDPOINT:ENDPOINT,AZURE_COMPOSITE_LIVENESS_HMAC_KEY_B64:KEY.toString('base64'),
  AZURE_COMPOSITE_LIVENESS_VERSION:VERSION};
const claim={challengeId:'10000000-0000-4000-8000-000000000001',replicaId:'20000000-0000-4000-8000-000000000002',
  ownerUserId:'30000000-0000-4000-8000-000000000003',sourceId:'40000000-0000-4000-8000-000000000004',attempt:2,
  phrase:'Synthetic phrase 123456',phraseHash:createHash('sha256').update('Synthetic phrase 123456').digest('hex'),
  source:{sha256:SHA,byteSize:1024,mime:'video/webm'},identityReference:{sourceId:'50000000-0000-4000-8000-000000000005',
    sha256:'b'.repeat(64),byteSize:2048,mime:'image/png'}};
const sign=body=>'sha256='+createHmac('sha256',KEY).update(body).digest('hex');
const digest=body=>createHash('sha256').update(body).digest('hex');
const signed=body=>new Response(body,{headers:{'x-vyakti-response-signature':sign(body)}});
const signRead=async()=>({url:'https://private.invalid/opaque-capability',expires_at:new Date(Date.now()+120000).toISOString()});
const make=(fetchImpl,extra={})=>createAzureCompositeLivenessVerifier({env,signRead,fetchImpl,...extra});
function responseFacts(init){
  const request=JSON.parse(init.body);
  // A transport success fixture is an explicitly rejected provider result.
  // There are deliberately no invented biometric measurement values.
  return {protocol:PROTOCOL,operation:OPERATION,request_id:request.request_id,request_nonce:request.broker_nonce,
    request_sha256:digest(init.body),verifier_version:VERSION,input_sha256:SHA,provider_accepted:false};
}

test('actual adapter issues fresh canonical authenticated dispatches after signed reads',async()=>{
  const requests=[];let reads=0;
  const adapter=make(async(url,init)=>{
    assert.equal(reads,2*(requests.length+1));assert.equal(url,ENDPOINT);assert.equal(init.redirect,'error');
    assert.equal(init.headers['X-Vyakti-Signature'],sign(init.body));assert.equal(init.headers['X-Vyakti-Protocol'],PROTOCOL);
    const payload=JSON.parse(init.body);assert.match(payload.broker_nonce,/^[0-9a-f]{32}$/);
    assert(Math.abs(Date.now()-Date.parse(payload.broker_issued_at))<2000);assert.equal(payload.operation,OPERATION);
    requests.push(payload);return signed(JSON.stringify(responseFacts(init)));
  },{signRead:async()=>{reads++;return signRead();}});
  assert.equal((await adapter.verify(claim)).providerAccepted,false);
  assert.equal((await adapter.verify(claim)).providerAccepted,false);
  assert.equal(requests[0].request_id,requests[1].request_id);assert.notEqual(requests[0].broker_nonce,requests[1].broker_nonce);
});

test('each successful-response binding is mandatory, exact and signed',async()=>{
  const changes={protocol:'vyakti-azure-liveness-broker/v1',operation:'identity.verify',verifier_version:'other-version',
    request_nonce:'0'.repeat(32),request_sha256:'0'.repeat(64),request_id:'other:2',input_sha256:'b'.repeat(64)};
  for(const [field,value] of Object.entries(changes)){
    for(const missing of [false,true]){
      const adapter=make(async(_url,init)=>{const facts=responseFacts(init);if(missing)delete facts[field];else facts[field]=value;return signed(JSON.stringify(facts));});
      await assert.rejects(()=>adapter.verify(claim),e=>e.code==='azure_liveness_response_binding_invalid',field);
    }
  }
});

test('signed response replay across a fresh dispatch of the same attempt refuses',async()=>{
  let oldBody;
  const adapter=make(async(_url,init)=>{oldBody??=JSON.stringify(responseFacts(init));return signed(oldBody);});
  await adapter.verify(claim);
  await assert.rejects(()=>adapter.verify(claim),e=>e.code==='azure_liveness_response_binding_invalid');
});

test('removing actual nonce/digest guards admits the same signed replay: load-bearing negative control',async()=>{
  const url=new URL('../api/_liveness/providers/azure-composite.js',import.meta.url);
  const original=await readFile(url,'utf8');
  const changed=original.replace('result.request_nonce !== nonce || result.request_sha256 !== requestSha256 ||','');
  assert.notEqual(changed,original);
  const source=changed.replace(/from\s+(["'])(\.[^"']+)\1/g,(_,q,p)=>`from ${q}${new URL(p,url).href}${q}`);
  const mutant=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  let oldBody;
  const adapter=mutant.createAzureCompositeLivenessVerifier({env,signRead,fetchImpl:async(_url,init)=>{
    oldBody??=JSON.stringify(responseFacts(init));return signed(oldBody);
  }});
  assert.equal((await adapter.verify(claim)).providerAccepted,false);
  assert.equal((await adapter.verify(claim)).providerAccepted,false);
});

test('malformed JSON, signature, root type and binding types never yield evidence',async()=>{
  for(const body of ['{','null','[]','"text"'])await assert.rejects(()=>make(async()=>signed(body)).verify(claim),
    e=>['azure_liveness_response_invalid','azure_liveness_response_binding_invalid'].includes(e.code));
  await assert.rejects(()=>make(async(_url,init)=>new Response(JSON.stringify(responseFacts(init)),{
    headers:{'x-vyakti-response-signature':'sha256='+'0'.repeat(64)}})).verify(claim),e=>e.code==='azure_liveness_response_signature_invalid');
  await assert.rejects(()=>make(async(_url,init)=>signed(JSON.stringify({...responseFacts(init),request_nonce:{value:JSON.parse(init.body).broker_nonce}}))).verify(claim),
    e=>e.code==='azure_liveness_response_binding_invalid');
});

test('declared and streamed response limits cancel without accepting partial JSON',async()=>{
  for(const declared of [true,false]){
    let cancelled=false;
    const body=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(65537));},cancel(){cancelled=true;}});
    await assert.rejects(()=>make(async()=>new Response(body,{headers:declared?{'content-length':'65537'}:{}})).verify(claim),
      e=>e.code==='azure_liveness_response_too_large');
    assert(cancelled);
  }
});

test('timeout covers fetch and a stalled response body; body cancellation cannot hang refusal',async()=>{
  for(const bodyStall of [false,true]){
    const keepAlive=setTimeout(()=>{},1000);let cancelled=false;
    try{
      const adapter=make(async(_url,init)=>bodyStall?
        new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;return new Promise(()=>{});}})):
        new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true})),{timeoutMs:20});
      await assert.rejects(()=>adapter.verify(claim),e=>e.code==='azure_liveness_timeout');
      if(bodyStall)assert(cancelled);
    }finally{clearTimeout(keepAlive);}
  }
});

test('native fetch body abort is normalized after headers; removing normalization reproduces the native error', {timeout:10000}, async()=>{
  const sourceUrl=new URL('../api/_liveness/providers/azure-composite.js',import.meta.url);
  const original=await readFile(sourceUrl,'utf8');
  const start=original.indexOf('      let body;\n      try { body = await boundedResponseText(response, signal); }');
  const end=original.indexOf('      if (response.status === 404',start);
  assert(start>=0&&end>start);
  const changed=original.slice(0,start)+'      const body = await boundedResponseText(response, signal);\n'+original.slice(end);
  const absolute=changed.replace(/from\s+(["'])(\.[^"']+)\1/g,(_,q,p)=>`from ${q}${new URL(p,sourceUrl).href}${q}`);
  const mutant=await import('data:text/javascript;base64,'+Buffer.from(absolute).toString('base64'));
  for(const [factory,corrected]of [[createAzureCompositeLivenessVerifier,true],[mutant.createAzureCompositeLivenessVerifier,false]]){
    const controller=new AbortController();let nativeReads=0;
    const server=createServer((_req,res)=>{res.writeHead(200);res.flushHeaders();});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const deadline=mock.method(AbortSignal,'timeout',()=>controller.signal);
    try{
      const adapter=factory({env,signRead,fetchImpl:async(_url,init)=>{
        // Only the destination is bridged to localhost. This remains the
        // native Fetch stream and abort behavior, with no elapsed-time race.
        const response=await fetch(`http://127.0.0.1:${server.address().port}`,init);
        const nativeGetReader=response.body.getReader.bind(response.body);
        Object.defineProperty(response.body,'getReader',{value:()=>{
          const reader=nativeGetReader();
          return {read(){const pending=reader.read();nativeReads++;controller.abort(new DOMException('Controlled native body deadline','TimeoutError'));return pending;},cancel:()=>reader.cancel()};
        }});
        return new Response(response.body,{status:response.status,headers:response.headers});
      }});
      await assert.rejects(()=>adapter.verify(claim),error=>corrected
        ? error.code==='azure_liveness_timeout'&&error.status===503
        : error.name==='TimeoutError'&&error.code===23&&error.status===undefined);
      assert.equal(nativeReads,1);
    }finally{deadline.mock.restore();controller.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }
});

test('redirects and response-origin substitution refuse even when the body is signed',async()=>{
  for(const kind of ['status','followed','url']){
    const adapter=make(async(_url,init)=>{
      if(kind==='status')return new Response('',{status:302,headers:{location:'https://other.invalid'}});
      const response=signed(JSON.stringify(responseFacts(init)));
      Object.defineProperty(response,kind==='followed'?'redirected':'url',{value:kind==='followed'?true:'https://other.invalid/v1/liveness/verify'});
      return response;
    });
    await assert.rejects(()=>adapter.verify(claim),e=>e.code==='azure_liveness_redirect_refused');
  }
  for(const endpoint of ['http://host.azurecontainerapps.io/v1/liveness/verify','https://attacker.invalid/v1/liveness/verify',
    'https://host.azurecontainerapps.io/v1/liveness/verify?redirect=x','https://user:pass@host.azurecontainerapps.io/v1/liveness/verify']){
    assert.throws(()=>azureCompositeLivenessConfig({...env,AZURE_COMPOSITE_LIVENESS_ENDPOINT:endpoint}),e=>e.code==='azure_liveness_endpoint_invalid');
  }
});

async function withAuthServer(run){
  let calls=0;
  // Existing identity route is used ONLY to exercise the existing common auth
  // admission with an injected rejected response. No composite route is added.
  const server=createVerifierServer({protocol:PROTOCOL,version:VERSION,hmacKey:KEY,liveness:{enabled:false},
    limits:{requestBytes:65536,totalDeadlineMs:2000,concurrency:4}},
    {verify:async()=>{calls++;return {provider_accepted:false};}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{await run(`http://127.0.0.1:${server.address().port}`,()=>calls);}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
const bridgeResponse=response=>new Response(response.body,{status:response.status,headers:response.headers});

test('new request passes actual common broker authentication; its old response is correctly incompatible',async()=>{
  await withAuthServer(async(origin,calls)=>{
    const adapter=make(async(_url,init)=>bridgeResponse(await fetch(origin+'/v1/identity/verify',init)));
    await assert.rejects(()=>adapter.verify(claim),e=>e.code==='azure_liveness_response_binding_invalid');assert.equal(calls(),1);
  });
});

test('actual broker rejects missing/malformed/stale transport freshness and bad HMAC before handler',async()=>{
  for(const kind of ['missing','malformed','stale','hmac'])await withAuthServer(async(origin,calls)=>{
    const adapter=make(async(_url,init)=>{
      const p=JSON.parse(init.body);if(kind==='missing')delete p.broker_nonce;
      if(kind==='malformed')p.broker_nonce='bad';if(kind==='stale')p.broker_issued_at='2000-01-01T00:00:00.000Z';
      const body=JSON.stringify(p),headers={...init.headers,'X-Vyakti-Signature':kind==='hmac'?'sha256='+'0'.repeat(64):sign(body)};
      return bridgeResponse(await fetch(origin+'/v1/identity/verify',{...init,body,headers}));
    });
    await assert.rejects(()=>adapter.verify(claim),e=>e.code==='azure_liveness_http_401');assert.equal(calls(),0);
  });
});

test('actual broker rejects exact request replay independently of adapter response binding',async()=>{
  await withAuthServer(async(origin,calls)=>{
    let first;
    const adapter=make(async(_url,init)=>{first??=init;return bridgeResponse(await fetch(origin+'/v1/identity/verify',first));});
    await assert.rejects(()=>adapter.verify(claim),e=>e.code==='azure_liveness_response_binding_invalid');
    await assert.rejects(()=>adapter.verify(claim),e=>e.code==='azure_liveness_http_409');assert.equal(calls(),1);
  });
});

test('real composite route remains absent and cannot claim biometric completion',async()=>{
  await withAuthServer(async(origin,calls)=>{
    const adapter=make(async(_url,init)=>bridgeResponse(await fetch(origin+'/v1/liveness/verify',init)));
    await assert.rejects(()=>adapter.verify(claim),e=>e.code==='azure_liveness_operation_unavailable'&&e.status===503);assert.equal(calls(),0);
  });
});
