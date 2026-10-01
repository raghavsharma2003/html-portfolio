import assert from 'node:assert/strict';
import {createClonePublicAuthorityGuard} from '../../api/_clonechannel.js';
import {gatedReply,deliver,makeCtx} from '../../api/_surface.js';
const id=n=>`${n}0000000-0000-4000-8000-000000000001`;
const resolved={slug:'synthetic-expert',sheet:{name:'Synthetic expert'},channel:{channel_id:id(1),replica_id:id(2),owner_user_id:id(3),agent_id:id(4),kind:'telegram',external_ref:'synthetic'} };
let available=false,reads=0,calls=0,sends=0;
const db=async(sql,params)=>{reads++;assert.deepEqual(params.slice(0,4),[id(1),id(2),id(3),id(4)]);return available?[{channel_id:id(1)}]:[];};
const guard=createClonePublicAuthorityGuard(db,resolved);
const authorityError=error=>{assert.equal(error.code,'clone_unavailable');assert.equal(error.status,404);assert.equal(Object.hasOwn(error,'outcome'),false,'authority refusal is not relabeled as transport uncertainty');return true;};
const adapter={surface:'synthetic',render:()=>[{text:'one'},{text:'two'}],send:async()=>{sends++;available=false;return {ok:true};}};
const ctx=makeCtx(adapter,{assertPublicAuthority:guard,reply:async()=>{calls++;available=false;return 'withheld';}});
await assert.rejects(()=>gatedReply(ctx,{},[]),authorityError);
assert.equal(calls,0,'authority refused before model dispatch');
available=true;
await assert.rejects(()=>gatedReply(ctx,{},[]),authorityError);
assert.equal(calls,1,'one in-flight response incurred a call but is withheld after authority changes');
await assert.rejects(()=>deliver(ctx,'synthetic',{kind:'text',text:'withheld'}),authorityError);
assert.equal(sends,0,'authority refused before delivery');
available=true;
await assert.rejects(()=>deliver(ctx,'synthetic',{kind:'text',text:'two fragments'}),authorityError);
assert.equal(sends,1,'each fragment rechecks authority; already sent fragment is not claimed recalled');
await assert.rejects(()=>deliver(ctx,'synthetic',{kind:'reaction',emoji:'x'}),authorityError);
assert.equal(sends,1,'reactions cannot bypass public authority');
const ordinary=makeCtx(adapter,{send:async()=>{sends++;return {ok:true};}});
await deliver(ordinary,'synthetic',{kind:'reaction',emoji:'x'});
assert.equal(sends,2,'ordinary non-clone context has no additional authority requirement');
let groups=6;
for(const [receiptName,receipt] of [['undefined',undefined],['false',{ok:false}]]){
 for(const [lane,message,assertPublicAuthority] of [
  ['public text',{kind:'text',text:'two fragments'},guard],
  ['ordinary reaction',{kind:'reaction',emoji:'x'},undefined],
 ]){
  available=true;
  let attempts=0;
  const readsBefore=reads;
  const unconfirmed=makeCtx(adapter,{assertPublicAuthority,send:async()=>{attempts++;return receipt;}});
  await assert.rejects(()=>deliver(unconfirmed,'synthetic',message),error=>{
   assert.equal(error.code,'surface_delivery_unconfirmed');assert.equal(error.status,502);
   assert.equal(error.phase,'delivery');assert.equal(error.outcome,'unknown');assert.equal(error.reason,'send_unconfirmed');
   assert.equal(error.acceptedFragments,0);assert.equal(error.attemptedFragments,1);assert.equal(error.failedFragment,0);
   assert.equal(error.retrySafe,false);return true;
  });
  await Promise.resolve();
  assert.equal(attempts,1,`${lane} ${receiptName} receipt cannot advance to a later fragment or retry`);
  assert.equal(reads-readsBefore,assertPublicAuthority?1:0,'public authority passes once; ordinary lane has no public guard');
  assert.equal(available,true,'transport uncertainty is distinct from a revoked authority');
  console.log(`ok ${++groups} ${lane} rejects ${receiptName} receipt without implicit acceptance`);
 }
}
console.log(`${groups} shared public dispatch/delivery control groups passed; DB admission is synthetic, not actual SQL proof`);
