import assert from 'node:assert/strict';
import {authorizeVoiceAllocationRequest,VOICE_APP_SQL,voiceRequestAuthority} from '../api/_voice/allocation-boundary.js';
const id=n=>String(n).repeat(8)+'-'+String(n).repeat(4)+'-4'+String(n).repeat(3)+'-8'+String(n).repeat(3)+'-'+String(n).repeat(12);
const one={owner_user_id:id(1),replica_id:id(2),source_id:id(3),generation_id:id(4),intent_id:id(5),intent_attempt:1,lease_token_hash:'a'.repeat(64)};
const two={...one,owner_user_id:id(6),replica_id:id(7),generation_id:id(8),intent_id:id(9)};
const hi={language_id:'hi',model_arm:'general',text_sha256:'b'.repeat(64),reference_sha256:'c'.repeat(64)};
const en={...hi,language_id:'en',text_sha256:'d'.repeat(64)};
const records=[{...one,...hi},{...two,...en}];let eligible=true,calls=0;
// Independent persisted-row fixture; proves caller/refusal control flow, NOT SQL semantics.
const db=async(sql,params)=>{
 calls++;assert.equal(sql,VOICE_APP_SQL.authorize);const wanted=JSON.parse(params[0]);
 return eligible&&records.some(row=>Object.keys(wanted).every(key=>row[key]===wanted[key]))?[{generation_id:wanted.generation_id}]:[];
};
assert.equal((await authorizeVoiceAllocationRequest(db,one,hi)).owner_user_id,one.owner_user_id);
assert.equal((await authorizeVoiceAllocationRequest(db,two,en)).owner_user_id,two.owner_user_id);
for(const [authority,scope] of [[{...one,owner_user_id:two.owner_user_id},hi],[one,en],[one,{...hi,reference_sha256:'e'.repeat(64)}],[{...one,intent_attempt:2},hi],[{...one,lease_token_hash:'f'.repeat(64)},hi]]){
 await assert.rejects(authorizeVoiceAllocationRequest(db,authority,scope),/voice_allocation_authority_changed/);
}
eligible=false;await assert.rejects(authorizeVoiceAllocationRequest(db,one,hi),/voice_allocation_authority_changed/);
const before=calls;for(const scope of [{...hi,language_id:'hinglish'},{...hi,model_arm:'qwen'},{...hi,text_sha256:'bad'}])assert.throws(()=>voiceRequestAuthority(one,scope),/voice_allocation_not_configured/);assert.equal(calls,before);
for(const token of ['lease_expires_at>now()','preview_text_hash','preview_language_id','revoked_at is null','identity_expires_at>now()']){
 assert.ok(VOICE_APP_SQL.authorize.includes(token));assert.ok(VOICE_APP_SQL.bind.includes(token));assert.ok(VOICE_APP_SQL.consume.includes(token));
}
assert.ok(VOICE_APP_SQL.bind.includes('exists(select 1 from eligible)'));
console.log('voice181 two-owner/current intent/text/language/reference and withdrawn authority controls passed; SQL not executed.');
