import {canonicalJson,sha256Hex} from './_provenance/contracts.js';
import {decryptPublicationText,publicationTextBinding} from './_text-publication-crypto.js';

export const PUBLICATION_MEMORY_MODE='optional_visitor_continuity_v1';
export const PUBLICATION_MEMORY_POLICY='With your permission, this conversation can use up to three earlier exchanges with you on this link, within its 30-day term. This does not train the expert or share your conversation with other visitors. You can turn this off or delete your conversation.';
export const PUBLICATION_MEMORY_POLICY_HASH=sha256Hex(PUBLICATION_MEMORY_POLICY);
export const PUBLICATION_MEMORY_MAX_EXCHANGES=3;
export const PUBLICATION_MEMORY_MAX_UNITS=3000;
const fail=code=>{throw Object.assign(new Error(code),{code,status:409});};
const hash=value=>sha256Hex(canonicalJson(value));
const json=value=>typeof value==='string'?JSON.parse(value):value;
export const publicationHasMemory=p=>Number(p.version)===2&&json(p.terms)?.memory===PUBLICATION_MEMORY_MODE
 &&json(p.terms)?.memory_policy_hash===PUBLICATION_MEMORY_POLICY_HASH&&json(p.terms)?.memory_policy===PUBLICATION_MEMORY_POLICY
 &&json(p.terms)?.memory_max_exchanges===3&&json(p.terms)?.memory_max_units===3000;
export function publicationMemorySettings(p,v){
 const available=publicationHasMemory(p);
 return {available,enabled:available&&v?.memory_enabled===true,epoch:available?String(v?.memory_epoch??0):'0',
  policy_hash:available?PUBLICATION_MEMORY_POLICY_HASH:null,policy:available?PUBLICATION_MEMORY_POLICY:null};
}
export function validateMemoryChoice(input){
 if(typeof input.remember!=='boolean'||typeof input.expected_memory_epoch!=='string'||! /^(0|[1-9][0-9]{0,18})(?![\s\S])/.test(input.expected_memory_epoch)
  ||BigInt(input.expected_memory_epoch)>9223372036854775807n||input.expected_memory_policy_hash!==PUBLICATION_MEMORY_POLICY_HASH)fail('text_publication_memory_choice_required');
}
export const EMPTY_MEMORY_REFS_HASH=hash([]);
export function decodePublicationContinuity(rows,{publication,visitor,epoch,env}){
 if(!Array.isArray(rows)||rows.length>3)fail('text_publication_memory_invalid');
 const exchanges=[],refs=[];let units=0;
 for(const row of [...rows].reverse()){
  if(row.publication_id!==publication.publication_id||row.owner_user_id!==publication.owner_user_id||row.replica_id!==publication.replica_id
   ||row.visitor_user_id!==visitor||String(row.memory_epoch)!==String(epoch)||row.state!=='complete'
   ||!row.question_envelope||!row.answer_envelope||json(row.gate_sidecar)?.gated!==true)fail('text_publication_memory_invalid');
  const questionEnvelope=json(row.question_envelope),answerEnvelope=json(row.answer_envelope);
  if(typeof questionEnvelope?.ciphertext!=='string'||questionEnvelope.ciphertext.length>12000
   ||typeof answerEnvelope?.ciphertext!=='string'||answerEnvelope.ciphertext.length>12000)fail('text_publication_memory_invalid');
  const question=decryptPublicationText(questionEnvelope,publicationTextBinding(row,'question',row.question_hash),env);
  const answer=decryptPublicationText(answerEnvelope,publicationTextBinding(row,'answer',row.answer_hash),env);
  if(typeof question!=='string'||typeof answer!=='string'||!question.trim()||!answer.trim()
   ||sha256Hex(question)!==row.question_hash||sha256Hex(answer)!==row.answer_hash)fail('text_publication_memory_invalid');
  const nextUnits=units+question.length+answer.length;
  if(nextUnits>3000){if(exchanges.length)break;fail('text_publication_memory_budget_exceeded');}
  units=nextUnits;
  exchanges.unshift({requestId:row.request_id,questionHash:row.question_hash,answerHash:row.answer_hash,question,answer});
  refs.unshift({request_id:row.request_id,question_hash:row.question_hash,answer_hash:row.answer_hash});
 }
 return {exchanges,refs,refsHash:hash(refs)};
}

// Correlated to current request h and locked visitor v. Publication/source
// fences are supplied by the existing parent statement. No unscoped DM recall.
export const PUBLICATION_MEMORY_REQUEST_GUARD=`(
 (h.memory_epoch is null and h.memory_refs='[]'::jsonb)
 or (h.memory_epoch=v.memory_epoch and v.memory_enabled=true
 and v.memory_policy_hash='${PUBLICATION_MEMORY_POLICY_HASH}'
 and not exists(select 1 from jsonb_array_elements(h.memory_refs) ref
  left join vy_text_publication_request prior on prior.request_id=(ref->>'request_id')::uuid
   and prior.publication_id=h.publication_id and prior.replica_id=h.replica_id and prior.owner_user_id=h.owner_user_id
   and prior.visitor_user_id=h.visitor_user_id and prior.memory_epoch=h.memory_epoch and prior.publication_epoch=h.publication_epoch
   and prior.state='complete' and prior.expires_at>now() and prior.question_envelope is not null and prior.answer_envelope is not null
   and prior.question_hash=ref->>'question_hash' and prior.answer_hash=ref->>'answer_hash'
   and prior.dispatch_authority_epoch=($4::jsonb->>'fence_epoch')::bigint
   and prior.gate_sidecar->>'gated'='true' and prior.request_id<>h.request_id and prior.created_at<=h.created_at
  where prior.request_id is null)))`;
