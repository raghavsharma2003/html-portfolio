import {randomBytes,randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
import {canonicalJson,sha256Hex} from './_provenance/contracts.js';
import {REPLICA_POLICY_VERSION as POLICY} from './_replica.js';
import {readPublicationSelection,PRIVATE_TEXT_CHOICES_SQL} from './_text-publication-source.js';
import {textPublicationKey,encryptPublicationText,decryptPublicationText,publicationTextBinding} from './_text-publication-crypto.js';
import {PUBLICATION_MEMORY_MODE,PUBLICATION_MEMORY_POLICY,PUBLICATION_MEMORY_POLICY_HASH,publicationHasMemory,publicationMemorySettings,validateMemoryChoice,decodePublicationContinuity,PUBLICATION_MEMORY_REQUEST_GUARD,EMPTY_MEMORY_REFS_HASH} from './_text-publication-memory.js';
import {PRIVATE_TEXT_EVIDENCE_BUDGET,selectPrivateTextEvidence,restorePrivateTextEvidenceSelection} from './_private-text-evidence-selection.js';

export const TEXT_PUBLICATION_STATEMENT_SET='account-material-publication/v1';
export const TEXT_PUBLICATION_STATEMENTS=Object.freeze([
 {id:'authorize_public_material',text:'Let signed-in adults receive AI text answers using this reviewed material and these teaching choices.'},
 {id:'confirm_material_rights',text:'I created this material and have permission to publish its contents. I reviewed it for private information.'},
 {id:'accept_public_ai_disclosure',text:'This publishes AI text from my account materials. It does not verify my identity or authorize voice, training or private relationship memory.'},
 {id:'accept_publication_terms',text:'I accept the displayed audience, term, question limits and budget. Visitors may copy answers. I can stop this link and erase stored content.'},
]);
export const TEXT_PUBLICATION_DISCLOSURE='AI text using material released by the publishing account. Real-world identity and voice are unverified.';
export const TEXT_PUBLICATION_V2_STATEMENT_SET='account-material-publication/v2';
export const TEXT_PUBLICATION_V2_STATEMENTS=Object.freeze(TEXT_PUBLICATION_STATEMENTS.map(s=>s.id==='accept_public_ai_disclosure'?{...s,text:'This publishes AI text from my account materials with optional private visitor continuity. It does not verify my identity or authorize voice, training or changes to my persona.'}:s));
// A person profile needs its own explicit release, never a private-question or
// teaching-choice grant. Storage version continues to describe visitor memory.
export const PERSON_PUBLICATION_STATEMENT_SET='account-person-material-publication/v1';
export const PERSON_PUBLICATION_V2_STATEMENT_SET='account-person-material-publication/v2';
const personStatements=statements=>Object.freeze(statements.map(s=>s.id==='authorize_public_material'
 ?{...s,text:'Let signed-in adults receive AI text answers using this reviewed personal profile and material. I approve sharing every profile field shown here.'}:s));
export const PERSON_PUBLICATION_STATEMENTS=personStatements(TEXT_PUBLICATION_STATEMENTS);
export const PERSON_PUBLICATION_V2_STATEMENTS=personStatements(TEXT_PUBLICATION_V2_STATEMENTS);
const publicationPolicy=(v2,person=false)=>({person,memory:v2,scope:person?(v2?PERSON_PUBLICATION_V2_STATEMENT_SET:PERSON_PUBLICATION_STATEMENT_SET):(v2?TEXT_PUBLICATION_V2_STATEMENT_SET:TEXT_PUBLICATION_STATEMENT_SET),statements:person?(v2?PERSON_PUBLICATION_V2_STATEMENTS:PERSON_PUBLICATION_STATEMENTS):(v2?TEXT_PUBLICATION_V2_STATEMENTS:TEXT_PUBLICATION_STATEMENTS)});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
const ACCESS_PASS_MODE='pass',ACCESS_PASS_CREATE_MAX=20,ACCESS_PASS_PUBLICATION_MAX=100;
const ACCESS_PASS_CODE=/^[A-Za-z0-9_-]{32}$/;
const hash=v=>sha256Hex(canonicalJson(v));
const json=v=>typeof v==='string'?JSON.parse(v):v;
const envOf=o=>o?.env||process.env;
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const uuid=v=>{if(typeof v!=='string'||v.length!==36||!UUID.test(v))fail('text_publication_id_invalid',400);return v.toLowerCase();};
const validText=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
const TEXT=['name','subjectDomain','syllabusScope','languageTextRule','technicalTermRule','explanationOrder','workedExamplePattern','firstMoveOnDoubt','notationConventions'];
const LIST=['subjectStrands','examTrack','doubtEscalationLadder','rigorFloor'];
const PERSON_TEXT=['name','identityWho','identityLife','lifeTexture','tasteTopics','curiosityTopics','personLine'];
const PERSON_LIST=['personValues','personNeverSay'];
function personPublicationProjection(draft){
 const p={sheetKind:'person'};
 for(const k of PERSON_TEXT)if(['name','identityWho'].includes(k)||draft[k]!==undefined&&draft[k]!==''){
  if(!validText(draft[k],k==='name'?200:k==='personLine'?140:4000))fail('text_publication_projection_invalid',400);p[k]=draft[k];
 }
 for(const k of PERSON_LIST)if(draft[k]!==undefined){
  if(!Array.isArray(draft[k])||draft[k].length>(k==='personValues'?7:24))fail('text_publication_projection_invalid',400);
  p[k]=Array.from(draft[k],v=>{if(!validText(v,4000))fail('text_publication_projection_invalid',400);return v;});
 }
 if(draft.personTalk!==undefined){
  const t=draft.personTalk;if(!t||typeof t!=='object'||Array.isArray(t)||!['formal','mixed','casual'].includes(t.register)||!['roman-hinglish','devanagari','english'].includes(t.scriptBaseline))fail('text_publication_projection_invalid',400);
  if(t.codeSwitchNote!==undefined&&t.codeSwitchNote!==''&&!validText(t.codeSwitchNote,4000))fail('text_publication_projection_invalid',400);
  p.personTalk={register:t.register,scriptBaseline:t.scriptBaseline,...(t.codeSwitchNote?{codeSwitchNote:t.codeSwitchNote}:{})};
 }
 if(JSON.stringify(p).length>7000)fail('text_publication_projection_invalid',400);return p;
}
export function publicationProjection(draft){
 if(!draft||typeof draft!=='object'||Array.isArray(draft)||![undefined,'teacher','person'].includes(draft.sheetKind))fail('text_publication_projection_invalid',400);
 if(draft.sheetKind==='person')return personPublicationProjection(draft);
 const p={};for(const k of TEXT)if(draft[k]!==undefined){if(!validText(draft[k],k==='name'?200:2000))fail('text_publication_projection_invalid',400);p[k]=draft[k];}
 for(const k of LIST)if(draft[k]!==undefined){if(!Array.isArray(draft[k])||draft[k].length>24||draft[k].some(v=>!validText(v,500)))fail('text_publication_projection_invalid',400);p[k]=[...draft[k]];}
 for(const k of ['warmth','strictness'])if(draft[k]!==undefined){if(!Number.isInteger(draft[k])||draft[k]<0||draft[k]>4)fail('text_publication_projection_invalid',400);p[k]=draft[k];}
 if(draft.pacePreference!==undefined){if(!['push','balanced','drill'].includes(draft.pacePreference))fail('text_publication_projection_invalid',400);p.pacePreference=draft.pacePreference;}
 if(!p.name||!['physics','chemistry','maths'].includes(p.subjectDomain)||JSON.stringify(p).length>7000)fail('text_publication_projection_invalid',400);return p;
}
function accessMode(value){if(value===undefined||value===null||value===''||value==='open')return 'open';if(value===ACCESS_PASS_MODE)return ACCESS_PASS_MODE;fail('text_publication_access_mode_invalid',400);}
function publicationAccessMode(publication){return accessMode(json(publication?.terms)?.access_mode);}
function accessPassCode(value){const code=typeof value==='string'?value.trim():'';if(!ACCESS_PASS_CODE.test(code))fail('text_publication_access_required',403);return code;}
const accessPassHash=code=>sha256Hex('vyakti.text-publication-access-pass.v1\0'+code);
const accessPassWire=row=>({pass_id:String(row.pass_id),state:String(row.state),created_at:row.created_at,expires_at:row.expires_at,
 ...(row.claimed_at?{claimed_at:row.claimed_at}:{}),...(row.revoked_at?{revoked_at:row.revoked_at}:{})});
export function textPublicationTerms(env=process.env,allowMemory=false,requestedAccessMode='open'){
 const usd=Number(env.TEXT_PUBLICATION_BUDGET_USD);if(!Number.isFinite(usd)||usd<=0||usd>10||Math.floor(usd*1e6)<1)fail('text_publication_budget_unavailable',503);
 const mode=accessMode(requestedAccessMode);
 return {audience:'signed_in_adult_attestation',publication_days:30,retention_days:30,visitor_question_limit:20,total_question_limit:200,budget_microusd:Math.floor(usd*1e6),quota_policy:'admission_counts',memory:allowMemory?PUBLICATION_MEMORY_MODE:false,voice:false,...(allowMemory?{memory_policy:PUBLICATION_MEMORY_POLICY,memory_policy_hash:PUBLICATION_MEMORY_POLICY_HASH,memory_max_exchanges:3,memory_max_units:3000}:{}),...(mode===ACCESS_PASS_MODE?{access_mode:ACCESS_PASS_MODE}:{})};
}
const reviewHash=(owner,rid,s,p,terms)=>hash({scope:publicationPolicy(terms.memory===PUBLICATION_MEMORY_MODE,p.sheetKind==='person').scope,owner_user_id:owner,replica_id:rid,snapshot:s.snapshot,projection:p,terms,disclosure:TEXT_PUBLICATION_DISCLOSURE});
export const TEXT_PUBLICATION_READ_SQL=`select * from vy_text_publication where publication_id=$1::uuid`;
async function publicationRow(db,id){const p=(await db(TEXT_PUBLICATION_READ_SQL,[uuid(id)]))[0];if(!p)fail('text_publication_not_found',404);return p;}
function summary(p,owned=false){
 if(p.state==='revoked'&&p.review_hash==null)return {public_id:p.publication_id,...(owned?{replica_id:p.replica_id}:{}),state:'revoked',version:1,publication_never_created:true,can_text:false,can_voice:false,created_at:p.created_at,expires_at:p.expires_at};
 const expired=new Date(p.expires_at).getTime()<=Date.now(),state=p.state==='revoked'?'revoked':expired?'expired':'active',projection=json(p.projection);
 const disclosure=p.disclosure||TEXT_PUBLICATION_DISCLOSURE,terms=json(p.terms);
 return {public_id:p.publication_id,...(owned?{replica_id:p.replica_id}:{}),state,version:Number(p.version),title:projection?.name||'AI text',subject_domain:projection?.subjectDomain||null,disclosure,disclosure_hash:p.disclosure_hash||sha256Hex(disclosure),terms,created_at:p.created_at,expires_at:p.expires_at,can_text:state==='active',can_voice:false};
}
async function currentPublication(db,p){
 if(p.state!=='active'||new Date(p.expires_at).getTime()<=Date.now())fail('text_publication_unavailable');
 const receipt=json(p.receipt),snapshot=json(p.snapshot),projection=json(p.projection),policy=publicationPolicy(Number(p.version)===2,projection?.sheetKind==='person');
 publicationAccessMode(p);
 if(hash(publicationProjection(projection))!==hash(projection))fail('text_publication_unavailable');
 if(![1,2].includes(Number(p.version))||(Number(p.version)===2&&!publicationHasMemory(p))||(Number(p.version)===1&&json(p.terms).memory!==false))fail('text_publication_unavailable');
 if(!receipt||receipt.scope!==policy.scope||receipt.owner_user_id!==p.owner_user_id||receipt.replica_id!==p.replica_id||receipt.publication_id!==p.publication_id||receipt.review_hash!==p.review_hash||hash(receipt)!==p.receipt_hash||policy.statements.some(s=>receipt.attestations?.[s.id]!==true)||receipt.expires_at!==new Date(p.expires_at).toISOString()||hash(projection)!==receipt.projection_hash||hash(json(p.terms))!==receipt.terms_hash||sha256Hex(p.disclosure)!==p.disclosure_hash)fail('text_publication_unavailable');
 const s=await readPublicationSelection(db,p.owner_user_id,{replica_id:p.replica_id,sheet_id:p.sheet_id,context_item_id:p.context_item_id},projection);
 if(hash(s.snapshot)!==hash(snapshot))fail('text_publication_source_changed');return s;
}
function requestIdentity(publicId,visitor,requestId,questionHash,selectionHash=null){return{
 public_id:publicId,visitor_user_id:visitor,request_id:requestId,question_hash:questionHash,...(selectionHash?{evidence_selection_hash:selectionHash}:{})};}
function bindPublishedEvidence(s,question,questionHash){
 if(s.row.body.length<=PRIVATE_TEXT_EVIDENCE_BUDGET)return{contexts:s.contexts,evidenceSelection:null};
 let selected;try{selected=selectPrivateTextEvidence(s.evidence,question,questionHash);}catch{fail('text_publication_evidence_selection_unavailable');}
 return{contexts:selected.selected.map(({body})=>({itemId:s.snapshot.context_item_id,sourceId:s.snapshot.source_id,hash:sha256Hex(body),body})),evidenceSelection:selected.commitment};
}
function publishedContextsFromRequest(s,r){
 const commitment=json(r.gate_sidecar)?.evidence_selection;
 if(!commitment){if(s.row.body.length>PRIVATE_TEXT_EVIDENCE_BUDGET)fail('text_publication_evidence_selection_unavailable');return{contexts:s.contexts,evidenceSelection:null};}
 let restored;try{restored=restorePrivateTextEvidenceSelection({commitment,questionHash:r.question_hash,evidenceRecords:s.snapshot.evidence_records,
  canonicalRecords:s.evidence,body:s.row.body,itemId:s.snapshot.context_item_id,sourceId:s.snapshot.source_id});}
 catch{fail('text_publication_evidence_selection_changed');}
 return{contexts:restored.contexts,evidenceSelection:restored.commitment};
}
// Match existing source removal and consent withdrawal lock order. A public
// projection deliberately does not depend on the private draft epoch.
export const TEXT_PUBLICATION_SOURCE_FENCE=`source_gate as materialized (
 select src.source_id from vy_replica_source src where src.source_id=$3::uuid and src.replica_id=$1::uuid and src.owner_user_id=$2::uuid
 and src.state='ready' and src.sha256=$4::jsonb->>'source_hash' for update of src
), owned as (
 update vy_replica r set updated_at=r.updated_at where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
 and r.private_text_epoch=($4::jsonb->>'fence_epoch')::bigint
 and r.subject_mode='self' and r.policy_version=$7 and r.lifecycle in ('draft','consent_pending','enrolling','calibrating','ready','active')
 and not exists(select 1 from vy_replica_runtime_capability candidate_cap where candidate_cap.replica_id=r.replica_id
  and candidate_cap.owner_user_id=r.owner_user_id and candidate_cap.state='active' and candidate_cap.candidate_binding_required)
 and exists(select 1 from source_gate)
 and exists(select 1 from vy_context_item i join vy_context_item_text t on t.item_id=i.item_id and t.replica_id=i.replica_id and t.owner_user_id=i.owner_user_id
 where i.item_id=($4::jsonb->>'context_item_id')::uuid and i.replica_id=r.replica_id and i.owner_user_id=r.owner_user_id and i.source_id=$3::uuid
 and i.content_sha256=$4::jsonb->>'source_hash' and i.authorship='mine' and i.status in ('extracted','mined') and t.body=$6)
 and not exists(select 1 from jsonb_array_elements($4::jsonb->'account_receipts') a where not exists(select 1 from vy_replica_consent c
 where c.consent_id=(a->>'consent_id')::uuid and c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id and c.scope=a->>'scope'
 and c.receipt_hash=a->>'receipt_hash' and c.method='account_attestation' and c.policy_version=$7 and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())))
 and not exists(select 1 from jsonb_array_elements($4::jsonb->'evidence_records') e where not exists(select 1 from vy_replica_processing_evidence ev
 where ev.evidence_id=(e->>'id')::uuid and ev.replica_id=r.replica_id and ev.owner_user_id=r.owner_user_id and ev.source_id=$3::uuid and ev.record_hash=e->>'hash' and ev.input_sha256=$4::jsonb->>'source_hash'))
 returning r.replica_id,r.owner_user_id
)`;
// This ephemeral epoch fences a concurrent authority writer only. It is never
// persisted in the publication snapshot, so later private draft edits remain
// compatible with the immutable reviewed public projection.
const fenceArgs=(p,s)=>[p.replica_id,p.owner_user_id,s.snapshot.source_id,JSON.stringify({...s.snapshot,fence_epoch:String(s.row.private_text_epoch)}),JSON.stringify(json(p.projection)),s.row.body,POLICY,p.publication_id,String(p.epoch)];
const PUB_LOCK=`pub as materialized(select p.* from vy_text_publication p where p.publication_id=$8::uuid and p.replica_id=$1::uuid and p.owner_user_id=$2::uuid
 and p.state='active' and p.epoch=$9::bigint and p.expires_at>now() and p.snapshot=($4::jsonb-'fence_epoch') and p.projection=$5::jsonb and exists(select 1 from owned) for update of p)`;
export const TEXT_PUBLICATION_MEMORY_SCHEMA_SQL=`select count(*)=7 as available from pg_attribute a
 where not a.attisdropped and a.attnum>0 and (
 (a.attrelid=to_regclass('vy_text_publication_visitor') and a.attname in ('memory_enabled','memory_epoch','memory_policy_hash','memory_choice_at'))
 or (a.attrelid=to_regclass('vy_text_publication_request') and a.attname in ('memory_epoch','memory_refs','memory_refs_hash')))`;
export const TEXT_PUBLICATION_ACCESS_SCHEMA_SQL=`select count(*)=7 as available from pg_attribute a
 where not a.attisdropped and a.attnum>0 and (
 (a.attrelid=to_regclass('vy_text_publication') and a.attname='access_pass_issued_count')
 or (a.attrelid=to_regclass('vy_text_publication_visitor') and a.attname='access_pass_id')
 or (a.attrelid=to_regclass('vy_text_publication_access_pass') and a.attname in ('pass_id','publication_id','code_hash','state','visitor_user_id')))`;
export async function readTextPublicationReadiness(db,owner,input,options={}){
 const rid=uuid(input.replica_id),row=(await db(PRIVATE_TEXT_CHOICES_SQL,[rid,uuid(owner)]))[0];if(!row)fail('text_publication_not_found',404);
 const blockers=[];let selected=null,terms;const allowMemory=input.allow_memory===true||input.allow_memory==='true',requestedAccessMode=accessMode(input.access_mode);let policy=publicationPolicy(allowMemory);
 if(row.active_candidate_binding_required===true)blockers.push({code:'candidate_binding_required',responsibility:'platform'});
 if(allowMemory)try{if((await db(TEXT_PUBLICATION_MEMORY_SCHEMA_SQL,[]))[0]?.available!==true)fail('text_publication_memory_schema_unavailable',503);}catch{blockers.push({code:'text_publication_memory_schema_unavailable',responsibility:'platform'});}
 if(requestedAccessMode===ACCESS_PASS_MODE)try{if((await db(TEXT_PUBLICATION_ACCESS_SCHEMA_SQL,[]))[0]?.available!==true)fail('text_publication_access_schema_unavailable',503);}catch{blockers.push({code:'text_publication_access_schema_unavailable',responsibility:'platform'});}
 try{textPublicationKey(envOf(options));terms=textPublicationTerms(envOf(options),allowMemory,requestedAccessMode);if(String(envOf(options).CRON_SECRET||'').length<24)fail('text_publication_retention_unavailable',503);}catch(e){blockers.push({code:e.code,responsibility:'platform'});}
 if(input.sheet_id&&input.context_item_id){
  if(!row.active_candidate_binding_required)try{const s=await readPublicationSelection(db,owner,input),p=publicationProjection(s.draft),long=s.row.body.length>PRIVATE_TEXT_EVIDENCE_BUDGET;
   policy=publicationPolicy(allowMemory,p.sheetKind==='person');if(terms)selected={review_hash:reviewHash(owner,rid,s,p,terms),source_name:s.row.source_name,projection:p,
    material_text:long?s.evidence[0].value.text:s.row.body,terms,...(long?{material_excerpt:true,source_chars:s.row.body.length,
     excerpt_start_char:s.evidence[0].value.locator.start_char,excerpt_end_char:s.evidence[0].value.locator.end_char}:{})};
  }catch(e){blockers.push({code:e.code||'text_publication_read_unavailable',responsibility:/saved_draft|draft_|projection_invalid|owner_text_context|account_attestation/.test(e.code||'')?'owner':'platform'});}
 }else blockers.push({code:'text_publication_selection_required',responsibility:'owner'});
 const publications=(await db(`select * from vy_text_publication where replica_id=$1::uuid and owner_user_id=$2::uuid and review_hash is not null order by created_at desc limit 20`,[rid,owner])).filter(p=>p.review_hash!=null).map(p=>summary(p,true));
 if(publications.some(p=>p.state==='active'))blockers.push({code:'text_publication_already_active',responsibility:'owner'});
 const items=(json(row.context_items)||[]).map(i=>({...i,eligible:['extracted','mined'].includes(i.status)&&i.authorship==='mine'&&i.source_ready&&['text','pdf','docx','markdown'].includes(i.format),reason:i.authorship!=='mine'?'text_publication_owner_material_required':!i.source_ready?'text_publication_source_unavailable':null}));
 return {replica_id:rid,state:blockers.some(b=>b.responsibility==='platform')?'unavailable':blockers.length?'needs_input':'ready',blockers,drafts:json(row.drafts)||[],context_items:items,selected,statement_set:policy.scope,statements:policy.statements,can_publish:!blockers.length,publications};
}
export const TEXT_PUBLICATION_PUBLISH_SQL=`with ${TEXT_PUBLICATION_SOURCE_FENCE},claimed_id as (
 insert into vy_text_publication_id_ledger(id,kind) select $8::uuid,'publication' from owned
 where $9::bigint=0 and exists(select 1 from vy_teacher_sheet s where s.sheet_id=($4::jsonb->>'sheet_id')::uuid and s.replica_id=$1::uuid and s.owner_user_id=$2::uuid and s.sheet=$18::jsonb and s.status in ('draft','validated','published'))
 on conflict do nothing returning id
)
 insert into vy_text_publication(publication_id,replica_id,owner_user_id,source_id,context_item_id,sheet_id,review_hash,request_hash,snapshot,projection,receipt,receipt_hash,disclosure,disclosure_hash,terms,expires_at,version)
 select $8::uuid,$1::uuid,$2::uuid,$3::uuid,($4::jsonb->>'context_item_id')::uuid,($4::jsonb->>'sheet_id')::uuid,$10,$11,($4::jsonb-'fence_epoch'),$5::jsonb,$12::jsonb,$13,$14,$15,$16::jsonb,$17::timestamptz,case when $12::jsonb->>'scope' in ('account-material-publication/v2','account-person-material-publication/v2') then 2 else 1 end from claimed_id
 on conflict do nothing returning publication_id`;
export async function publishTextPublication(db,owner,input,options={}){
 const rid=uuid(input.replica_id),id=uuid(input.publication_id),requestedAccessMode=accessMode(input.access_mode);uuid(owner);const policy=publicationPolicy([TEXT_PUBLICATION_V2_STATEMENT_SET,PERSON_PUBLICATION_V2_STATEMENT_SET].includes(input.statement_set),[PERSON_PUBLICATION_STATEMENT_SET,PERSON_PUBLICATION_V2_STATEMENT_SET].includes(input.statement_set));
 if(input.statement_set!==policy.scope||policy.statements.some(s=>input.attestations?.[s.id]!==true)||!HASH.test(input.expected_review_hash||''))fail('text_publication_attestation_required',400);
 if(requestedAccessMode===ACCESS_PASS_MODE){let schema;try{schema=(await db(TEXT_PUBLICATION_ACCESS_SCHEMA_SQL,[]))[0];}catch{fail('text_publication_access_schema_unavailable',503);}if(schema?.available!==true)fail('text_publication_access_schema_unavailable',503);}
 const requestHash=hash({replica_id:rid,publication_id:id,sheet_id:uuid(input.sheet_id),context_item_id:uuid(input.context_item_id),review_hash:input.expected_review_hash,statement_set:input.statement_set,attestations:Object.fromEntries(policy.statements.map(s=>[s.id,true])),...(requestedAccessMode===ACCESS_PASS_MODE?{access_mode:ACCESS_PASS_MODE}:{})});
 const existing=(await db(TEXT_PUBLICATION_READ_SQL,[id]))[0];if(existing){if(existing.owner_user_id!==owner||existing.replica_id!==rid)fail('text_publication_not_found',404);if(existing.state==='revoked')return {created:false,publication:summary(existing,true)};if(existing.request_hash!==requestHash)fail('text_publication_request_conflict');return {created:false,publication:summary(existing,true)};}
 textPublicationKey(envOf(options));if(String(envOf(options).CRON_SECRET||'').length<24)fail('text_publication_retention_unavailable',503);const terms=textPublicationTerms(envOf(options),policy.memory,requestedAccessMode),s=await readPublicationSelection(db,owner,input),projection=publicationProjection(s.draft),review=reviewHash(owner,rid,s,projection,terms);
 if(policy.person!==(projection.sheetKind==='person'))fail('text_publication_attestation_required',400);
 if(review!==input.expected_review_hash)fail('text_publication_review_changed');
 const now=new Date(),expires=new Date(now.getTime()+terms.publication_days*86400000).toISOString();
 const receipt={scope:policy.scope,owner_user_id:owner,replica_id:rid,publication_id:id,review_hash:review,projection_hash:hash(projection),terms_hash:hash(terms),granted_at:now.toISOString(),expires_at:expires,nonce:randomBytes(24).toString('hex'),attestations:Object.fromEntries(policy.statements.map(s=>[s.id,true]))};
 const p={replica_id:rid,owner_user_id:owner,publication_id:id,projection,epoch:0};
 let rows;try{rows=await db(TEXT_PUBLICATION_PUBLISH_SQL,[...fenceArgs(p,s),review,requestHash,JSON.stringify(receipt),hash(receipt),TEXT_PUBLICATION_DISCLOSURE,sha256Hex(TEXT_PUBLICATION_DISCLOSURE),JSON.stringify(terms),expires,JSON.stringify(s.draft)]);}catch{fail('text_publication_publish_uncertain',503);}
 if(!rows.length){const replay=(await db(TEXT_PUBLICATION_READ_SQL,[id]))[0];if(replay?.owner_user_id===owner&&replay.request_hash===requestHash)return {created:false,publication:summary(replay,true)};fail('text_publication_publish_blocked');}
 return {created:true,publication:await readOwnedTextPublication(db,owner,{replica_id:rid,publication_id:id},options)};
}
export async function readOwnedTextPublication(db,owner,input){const p=await publicationRow(db,input.publication_id);if(p.owner_user_id!==owner||p.replica_id!==uuid(input.replica_id))fail('text_publication_not_found',404);return summary(p,true);}
export async function openTextPublication(db,_actor,input){const p=await publicationRow(db,input.public_id);const result=summary(p);if(result.can_text)try{await currentPublication(db,p);}catch{return {...result,state:'unavailable',can_text:false};}return result;}

export const TEXT_PUBLICATION_ACCESS_PASS_CREATE_SQL=`with issued as (
 update vy_text_publication p set access_pass_issued_count=p.access_pass_issued_count+cardinality($4::uuid[])
 where p.publication_id=$1::uuid and p.owner_user_id=$2::uuid and p.replica_id=$3::uuid
 and p.state='active' and p.expires_at>now() and p.terms->>'access_mode'='pass'
 and p.access_pass_issued_count+cardinality($4::uuid[])<=$6::integer
 returning p.publication_id,p.replica_id,p.owner_user_id,p.expires_at
), inserted as (
 insert into vy_text_publication_access_pass(pass_id,publication_id,replica_id,owner_user_id,code_hash,expires_at)
 select x.pass_id,p.publication_id,p.replica_id,p.owner_user_id,x.code_hash,p.expires_at
 from issued p cross join unnest($4::uuid[],$5::text[]) x(pass_id,code_hash)
 returning pass_id,state,created_at,expires_at,claimed_at,revoked_at
) select * from inserted order by created_at,pass_id`;
async function ownedAccessPassPublication(db,owner,input,{active=false}={}){
 const publicationId=uuid(input.publication_id),replicaId=uuid(input.replica_id),p=await publicationRow(db,publicationId);uuid(owner);
 if(p.owner_user_id!==owner||p.replica_id!==replicaId)fail('text_publication_not_found',404);
 if(publicationAccessMode(p)!==ACCESS_PASS_MODE)fail('text_publication_access_pass_unavailable',409);
 if(active&&(p.state!=='active'||new Date(p.expires_at).getTime()<=Date.now()))fail('text_publication_access_pass_unavailable',409);
 return p;
}
export async function createTextPublicationAccessPasses(db,owner,input,options={}){
 const p=await ownedAccessPassPublication(db,owner,input,{active:true}),publicationId=p.publication_id,replicaId=p.replica_id;
 const count=Number(input.count);if(!Number.isSafeInteger(count)||count<1||count>ACCESS_PASS_CREATE_MAX)fail('text_publication_access_pass_count_invalid',400);
 const idFactory=options.randomUUID||randomUUID,byteFactory=options.randomBytes||randomBytes;
 const created=Array.from({length:count},()=>{const code=accessPassCode(byteFactory(24).toString('base64url'));return{passId:uuid(idFactory()),code,codeHash:accessPassHash(code)};});
 let rows;try{rows=await db(TEXT_PUBLICATION_ACCESS_PASS_CREATE_SQL,[publicationId,owner,replicaId,created.map(x=>x.passId),created.map(x=>x.codeHash),ACCESS_PASS_PUBLICATION_MAX]);}catch{fail('text_publication_access_pass_create_uncertain',503);}
 if(rows.length!==count){
  const current=await publicationRow(db,publicationId);
  if(current.owner_user_id!==owner||current.replica_id!==replicaId)fail('text_publication_not_found',404);
  if(current.state!=='active'||new Date(current.expires_at).getTime()<=Date.now()||publicationAccessMode(current)!==ACCESS_PASS_MODE)fail('text_publication_access_pass_unavailable',409);
  if(Number(current.access_pass_issued_count)+count>ACCESS_PASS_PUBLICATION_MAX)fail('text_publication_access_pass_limit_reached',409);
  fail('text_publication_access_pass_create_uncertain',503);
 }
 const byId=new Map(rows.map(row=>[String(row.pass_id),row]));
 return{passes:created.map(item=>{const row=byId.get(item.passId);if(!row)fail('text_publication_access_pass_create_uncertain',503);return{...accessPassWire(row),code:item.code};})};
}
export const TEXT_PUBLICATION_ACCESS_PASS_LIST_SQL=`select a.pass_id,a.state,a.created_at,a.expires_at,a.claimed_at,a.revoked_at
 from vy_text_publication_access_pass a join vy_text_publication p
 on p.publication_id=a.publication_id and p.replica_id=a.replica_id and p.owner_user_id=a.owner_user_id
 where a.publication_id=$1::uuid and a.owner_user_id=$2::uuid and a.replica_id=$3::uuid
 order by a.created_at,a.pass_id limit 101`;
export async function listTextPublicationAccessPasses(db,owner,input){
 const p=await ownedAccessPassPublication(db,owner,input),rows=await db(TEXT_PUBLICATION_ACCESS_PASS_LIST_SQL,[p.publication_id,uuid(owner),p.replica_id]);
 if(rows.length>ACCESS_PASS_PUBLICATION_MAX)fail('text_publication_access_pass_limit_invalid',503);
 return{passes:rows.map(accessPassWire)};
}
export const TEXT_PUBLICATION_ACCESS_PASS_REVOKE_SQL=`with locked as materialized (
 select a.* from vy_text_publication_access_pass a join vy_text_publication p
 on p.publication_id=a.publication_id and p.replica_id=a.replica_id and p.owner_user_id=a.owner_user_id
 where a.pass_id=$4::uuid and a.publication_id=$1::uuid and a.owner_user_id=$2::uuid and a.replica_id=$3::uuid
 for update of a
), revoked as (
 update vy_text_publication_access_pass a set state='revoked',revoked_at=coalesce(a.revoked_at,now())
 from locked l where a.pass_id=l.pass_id and a.state<>'revoked'
 returning a.pass_id,a.state,a.created_at,a.expires_at,a.claimed_at,a.revoked_at
), current_pass as (
 select * from revoked
 union all
 select l.pass_id,l.state,l.created_at,l.expires_at,l.claimed_at,l.revoked_at from locked l where l.state='revoked'
), invalidated as (
 update vy_text_publication_visitor v set session_epoch=v.session_epoch+1,admission=null,admission_hash=null,expires_at=null,access_pass_id=null
 from locked l where v.publication_id=l.publication_id and v.access_pass_id=l.pass_id
 and ((select count(*) from revoked)>=0) returning v.publication_id
) select c.* from current_pass c where (select count(*) from invalidated)>=0`;
export async function revokeTextPublicationAccessPass(db,owner,input){
 const p=await ownedAccessPassPublication(db,owner,input),rows=await db(TEXT_PUBLICATION_ACCESS_PASS_REVOKE_SQL,[p.publication_id,uuid(owner),p.replica_id,uuid(input.pass_id)]);
 if(!rows[0])fail('text_publication_access_pass_not_found',404);return{pass:accessPassWire(rows[0])};
}

function sessionMac(body,env){return createHmac('sha256',textPublicationKey(env).key).update('vyakti.text-publication-session.v1\0').update(body).digest('base64url');}
function sessionToken(p,v,env){const payload={public_id:p.publication_id,visitor_user_id:v.visitor_user_id,publication_epoch:String(p.epoch),session_epoch:String(v.session_epoch),admission_hash:v.admission_hash,disclosure_hash:p.disclosure_hash,expires_at:new Date(v.expires_at).toISOString(),...(publicationHasMemory(p)?{memory_epoch:String(v.memory_epoch),memory_policy_hash:v.memory_policy_hash}: {})};const body=Buffer.from(canonicalJson(payload)).toString('base64url');return body+'.'+sessionMac(body,env);}
function readSession(token,visitor,publicId,env){
 if(typeof token!=='string'||token.length>4096)fail('text_publication_session_invalid');const [body,mac,extra]=token.split('.');
 const expected=Buffer.from(sessionMac(body||'',env)),actual=Buffer.from(mac||'');if(extra||expected.length!==actual.length||!timingSafeEqual(expected,actual))fail('text_publication_session_invalid');
 let s;try{s=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));}catch{fail('text_publication_session_invalid');}
 if(s.public_id!==publicId||s.visitor_user_id!==visitor||!/^\d+$/.test(s.session_epoch)||!/^\d+$/.test(s.publication_epoch)||!HASH.test(s.admission_hash||'')||!Number.isFinite(Date.parse(s.expires_at))||Date.parse(s.expires_at)<=Date.now())fail('text_publication_session_invalid');return s;
}
const VISITOR_ACCESS_GUARD=`(coalesce(p.terms->>'access_mode','open')='open' or exists(
 select 1 from vy_text_publication_access_pass access where access.pass_id=v.access_pass_id
 and access.publication_id=v.publication_id and access.replica_id=v.replica_id and access.owner_user_id=v.owner_user_id
 and access.visitor_user_id=v.visitor_user_id and access.state='claimed' and access.expires_at>now()))`;
const VISITOR_LOCK=`visitor as materialized(select v.* from vy_text_publication_visitor v join pub p on p.publication_id=v.publication_id
 where v.visitor_user_id=$10::uuid and v.replica_id=$1::uuid and v.owner_user_id=$2::uuid and v.session_epoch=$11::bigint
 and v.admission_hash=$12 and v.admission is not null and v.expires_at>now() and ${VISITOR_ACCESS_GUARD} for update of v)`;
const authArgs=(p,s,session,visitor)=>[...fenceArgs(p,s),visitor,session.session_epoch,session.admission_hash];
export const TEXT_PUBLICATION_VISITOR_AUTH_SQL=`select v.*,a.state access_pass_state,a.visitor_user_id access_pass_visitor,a.expires_at access_pass_expires_at
 from vy_text_publication_visitor v left join vy_text_publication_access_pass a
 on a.pass_id=v.access_pass_id and a.publication_id=v.publication_id
 where v.publication_id=$1::uuid and v.visitor_user_id=$2::uuid`;
async function visitorAuthority(db,visitor,input,options){
 const id=uuid(input.public_id);uuid(visitor);const session=readSession(input.session_token,visitor,id,envOf(options)),p=await publicationRow(db,id);
 if(String(p.epoch)!==session.publication_epoch||p.disclosure_hash!==session.disclosure_hash)fail('text_publication_session_invalid');const s=await currentPublication(db,p);
 const v=(await db(TEXT_PUBLICATION_VISITOR_AUTH_SQL,[id,visitor]))[0];
 if(!v||!v.admission||String(v.session_epoch)!==session.session_epoch||v.admission_hash!==session.admission_hash||new Date(v.expires_at).getTime()<=Date.now()||hash(json(v.admission))!==v.admission_hash)fail('text_publication_session_invalid');
 if(publicationAccessMode(p)===ACCESS_PASS_MODE&&(!v.access_pass_id||v.access_pass_state!=='claimed'||v.access_pass_visitor!==visitor||new Date(v.access_pass_expires_at).getTime()<=Date.now()))fail('text_publication_access_revoked',403);
 if(publicationHasMemory(p)&&(String(v.memory_epoch)!==session.memory_epoch||v.memory_policy_hash!==session.memory_policy_hash))fail('text_publication_memory_authority_changed');
 return {p,s,v,session};
}
export const TEXT_PUBLICATION_JOIN_SQL=`with ${TEXT_PUBLICATION_SOURCE_FENCE},${PUB_LOCK}
 insert into vy_text_publication_visitor as v(publication_id,replica_id,owner_user_id,visitor_user_id,admission,admission_hash,expires_at)
 select p.publication_id,p.replica_id,p.owner_user_id,$10::uuid,$11::jsonb,$12,least($13::timestamptz,p.expires_at) from pub p
 on conflict(publication_id,visitor_user_id) do update set admission=excluded.admission,admission_hash=excluded.admission_hash,expires_at=excluded.expires_at
 returning *`;
export const TEXT_PUBLICATION_JOIN_V2_SQL=`with ${TEXT_PUBLICATION_SOURCE_FENCE},${PUB_LOCK}
 insert into vy_text_publication_visitor as v(publication_id,replica_id,owner_user_id,visitor_user_id,admission,admission_hash,expires_at,memory_enabled,memory_epoch,memory_policy_hash,memory_choice_at)
 select p.publication_id,p.replica_id,p.owner_user_id,$10::uuid,$11::jsonb,$12,least($13::timestamptz,p.expires_at),$15::boolean,case when $15::boolean then 1 else 0 end,$16,now()
 from pub p where p.version=2 and ($14::bigint=0 or exists(select 1 from vy_text_publication_visitor known where known.publication_id=p.publication_id and known.visitor_user_id=$10::uuid)) and p.terms->>'memory_policy_hash'=$16
 on conflict(publication_id,visitor_user_id) do update set admission=excluded.admission,admission_hash=excluded.admission_hash,expires_at=excluded.expires_at,
 memory_enabled=$15::boolean,memory_epoch=v.memory_epoch+case when v.memory_enabled<>$15::boolean then 1 else 0 end,memory_policy_hash=$16,
 memory_choice_at=case when v.memory_enabled<>$15::boolean or v.memory_choice_at is null then now() else v.memory_choice_at end
 where v.memory_epoch=$14::bigint and (v.memory_policy_hash is null or v.memory_policy_hash=$16) returning *`;
const PASS_ACCESS_CTES=codeParam=>`pass_claim as (
 update vy_text_publication_access_pass a set state='claimed',visitor_user_id=$10::uuid,claimed_at=now()
 from pub p where a.publication_id=p.publication_id and a.replica_id=p.replica_id and a.owner_user_id=p.owner_user_id
 and p.terms->>'access_mode'='pass' and a.code_hash=${codeParam} and a.state='available' and a.visitor_user_id is null and a.expires_at>now()
 and not exists(select 1 from vy_text_publication_access_pass existing where existing.publication_id=p.publication_id
  and existing.visitor_user_id=$10::uuid and existing.state='claimed' and existing.expires_at>now())
 returning a.pass_id,a.publication_id
), bound_pass as (
 select a.pass_id,a.publication_id from vy_text_publication_access_pass a join pub p using(publication_id)
 where a.replica_id=p.replica_id and a.owner_user_id=p.owner_user_id and a.visitor_user_id=$10::uuid
 and a.state='claimed' and a.expires_at>now()
 union all select c.pass_id,c.publication_id from pass_claim c
 where not exists(select 1 from vy_text_publication_access_pass existing where existing.publication_id=c.publication_id
  and existing.visitor_user_id=$10::uuid and existing.state='claimed' and existing.pass_id<>c.pass_id and existing.expires_at>now())
)`;
export const TEXT_PUBLICATION_JOIN_PASS_SQL=`with ${TEXT_PUBLICATION_SOURCE_FENCE},${PUB_LOCK},${PASS_ACCESS_CTES('$14')}
 insert into vy_text_publication_visitor as v(publication_id,replica_id,owner_user_id,visitor_user_id,admission,admission_hash,expires_at,access_pass_id)
 select p.publication_id,p.replica_id,p.owner_user_id,$10::uuid,$11::jsonb,$12,least($13::timestamptz,p.expires_at),a.pass_id
 from pub p join bound_pass a on a.publication_id=p.publication_id
 on conflict(publication_id,visitor_user_id) do update set admission=excluded.admission,admission_hash=excluded.admission_hash,
 expires_at=excluded.expires_at,access_pass_id=excluded.access_pass_id returning *`;
export const TEXT_PUBLICATION_JOIN_PASS_V2_SQL=`with ${TEXT_PUBLICATION_SOURCE_FENCE},${PUB_LOCK},${PASS_ACCESS_CTES('$17')}
 insert into vy_text_publication_visitor as v(publication_id,replica_id,owner_user_id,visitor_user_id,admission,admission_hash,expires_at,memory_enabled,memory_epoch,memory_policy_hash,memory_choice_at,access_pass_id)
 select p.publication_id,p.replica_id,p.owner_user_id,$10::uuid,$11::jsonb,$12,least($13::timestamptz,p.expires_at),$15::boolean,
 case when $15::boolean then 1 else 0 end,$16,now(),a.pass_id from pub p join bound_pass a on a.publication_id=p.publication_id
 where p.version=2 and ($14::bigint=0 or exists(select 1 from vy_text_publication_visitor known where known.publication_id=p.publication_id and known.visitor_user_id=$10::uuid))
 and p.terms->>'memory_policy_hash'=$16
 on conflict(publication_id,visitor_user_id) do update set admission=excluded.admission,admission_hash=excluded.admission_hash,expires_at=excluded.expires_at,
 memory_enabled=$15::boolean,memory_epoch=v.memory_epoch+case when v.memory_enabled<>$15::boolean then 1 else 0 end,memory_policy_hash=$16,
 memory_choice_at=case when v.memory_enabled<>$15::boolean or v.memory_choice_at is null then now() else v.memory_choice_at end,
 access_pass_id=excluded.access_pass_id where v.memory_epoch=$14::bigint and (v.memory_policy_hash is null or v.memory_policy_hash=$16) returning *`;
export const TEXT_PUBLICATION_MEMORY_SETTINGS_SQL=`select * from vy_text_publication_visitor where publication_id=$1::uuid and visitor_user_id=$2::uuid`;
export async function readTextPublicationMemorySettings(db,visitor,input){
 const p=await publicationRow(db,input.public_id);uuid(visitor);await currentPublication(db,p);
 const v=(await db(TEXT_PUBLICATION_MEMORY_SETTINGS_SQL,[p.publication_id,visitor]))[0];
 return {memory:publicationMemorySettings(p,v)};
}
export const TEXT_PUBLICATION_SET_MEMORY_SQL=`with ${TEXT_PUBLICATION_SOURCE_FENCE},${PUB_LOCK},${VISITOR_LOCK}
 update vy_text_publication_visitor target set memory_enabled=$14::boolean,memory_epoch=target.memory_epoch+1,memory_policy_hash=$15,memory_choice_at=now(),admission=null,admission_hash=null,expires_at=null
 from visitor v,pub p where target.publication_id=v.publication_id and target.visitor_user_id=v.visitor_user_id
 and target.memory_epoch=$13::bigint and p.version=2 and p.terms->>'memory_policy_hash'=$15 returning target.*`;
export async function setTextPublicationMemory(db,visitor,input,options){
 validateMemoryChoice(input);const {p,s,session}=await visitorAuthority(db,visitor,input,options);
 if(!publicationHasMemory(p))fail('text_publication_memory_unavailable');
 const v=(await db(TEXT_PUBLICATION_SET_MEMORY_SQL,[...authArgs(p,s,session,visitor),input.expected_memory_epoch,input.remember,PUBLICATION_MEMORY_POLICY_HASH]))[0];
 if(!v)fail('text_publication_memory_choice_changed');
 return {memory:publicationMemorySettings(p,v),rejoin_required:true};
}
export async function joinTextPublication(db,visitor,input,options={}){
 uuid(visitor);if(input.is_adult!==true||input.accept_ai_disclosure!==true||input.accept_retention!==true)fail('text_publication_visitor_attestation_required',400);
 const p=await publicationRow(db,input.public_id),s=await currentPublication(db,p);textPublicationKey(envOf(options));if(input.expected_disclosure_hash!==p.disclosure_hash)fail('text_publication_disclosure_changed');
 const expires=new Date(Math.min(Date.now()+12*3600000,new Date(p.expires_at).getTime())).toISOString();
 const admission={scope:'account-material-visitor/v1',publication_id:p.publication_id,visitor_user_id:visitor,disclosure_hash:p.disclosure_hash,is_adult:true,accept_ai_disclosure:true,accept_retention:true,nonce:randomBytes(24).toString('hex'),created_at:new Date().toISOString(),expires_at:expires};
 const memory=publicationHasMemory(p),passMode=publicationAccessMode(p)===ACCESS_PASS_MODE;
 if(memory){validateMemoryChoice(input);admission.memory_choice={remember:input.remember,expected_epoch:input.expected_memory_epoch,policy_hash:PUBLICATION_MEMORY_POLICY_HASH};}
 const args=[...fenceArgs(p,s),visitor,JSON.stringify(admission),hash(admission),expires];
 const suppliedCode=input.access_pass===undefined||input.access_pass===null||input.access_pass===''?null:accessPassHash(accessPassCode(input.access_pass));
 const sql=passMode?(memory?TEXT_PUBLICATION_JOIN_PASS_V2_SQL:TEXT_PUBLICATION_JOIN_PASS_SQL):(memory?TEXT_PUBLICATION_JOIN_V2_SQL:TEXT_PUBLICATION_JOIN_SQL);
 const params=memory?[...args,input.expected_memory_epoch,input.remember,PUBLICATION_MEMORY_POLICY_HASH,...(passMode?[suppliedCode]:[])]:[...args,...(passMode?[suppliedCode]:[])];
 const v=(await db(sql,params))[0];if(!v)fail(passMode?'text_publication_access_required':'text_publication_join_blocked',passMode?403:409);
 return {publication:summary(p),session_token:sessionToken(p,v,envOf(options)),expires_at:v.expires_at,remaining_questions:Math.max(0,json(p.terms).visitor_question_limit-Number(v.question_count)),...(memory?{memory:publicationMemorySettings(p,v)}:{})};
}
export const TEXT_PUBLICATION_REQUEST_READ_SQL=`select h.*,sp.state spend_state from vy_text_publication_request h left join vy_provider_spend sp
 on sp.reservation_id=h.reservation_id and sp.budget_id=h.budget_id and sp.request_hash=h.spend_request_hash
 where h.publication_id=$1::uuid and h.visitor_user_id=$2::uuid and h.request_id=$3::uuid`;
async function requestRow(db,visitor,input){return (await db(TEXT_PUBLICATION_REQUEST_READ_SQL,[uuid(input.public_id),uuid(visitor),uuid(input.request_id)]))[0]||null;}
const requestWire=(r,answer)=>({public_id:r.publication_id,request_id:r.request_id,state:['admitted','dispatched'].includes(r.state)?'pending':r.state,billing_state:r.spend_state==='released'?'not_started':r.spend_state||r.billing_state,...(r.failure_code?{failure_code:r.failure_code}:{}),...(answer===undefined?{}:{answer}),can_voice:false,created_at:r.created_at});
const binding=publicationTextBinding;
async function currentRequest(db,visitor,input,options){
 const auth=await visitorAuthority(db,visitor,input,options),r=(await db(TEXT_PUBLICATION_AUTHORIZED_READ_SQL,[...authArgs(auth.p,auth.s,auth.session,visitor),uuid(input.request_id)]))[0];if(!r)fail('text_publication_request_unavailable');
 if(String(r.publication_epoch)!==String(auth.p.epoch)||String(r.session_epoch)!==String(auth.v.session_epoch)||new Date(r.expires_at).getTime()<=Date.now())fail('text_publication_request_unavailable');
 if(r.memory_epoch!=null&&hash(json(r.memory_refs))!==r.memory_refs_hash)fail('text_publication_memory_provenance_invalid');
 const bound=publishedContextsFromRequest(auth.s,r),selectionHash=bound.evidenceSelection?.selection_hash||null;
 if(r.request_hash!==hash(requestIdentity(r.publication_id,r.visitor_user_id,r.request_id,r.question_hash,selectionHash)))fail('text_publication_request_unavailable');
 return {...auth,r,contexts:bound.contexts,evidenceSelection:bound.evidenceSelection};
}
export const TEXT_PUBLICATION_AUTHORIZED_READ_SQL=`with ${TEXT_PUBLICATION_SOURCE_FENCE},${PUB_LOCK},${VISITOR_LOCK}
 select h.*,sp.state spend_state from vy_text_publication_request h join visitor v on v.publication_id=h.publication_id and v.visitor_user_id=h.visitor_user_id
 left join vy_provider_spend sp on sp.reservation_id=h.reservation_id and sp.budget_id=h.budget_id and sp.request_hash=h.spend_request_hash
 where h.request_id=$13::uuid and h.replica_id=$1::uuid and h.owner_user_id=$2::uuid and h.publication_epoch=$9::bigint and h.session_epoch=$11::bigint and h.expires_at>now() and ${PUBLICATION_MEMORY_REQUEST_GUARD} for update of h`;
export async function readTextPublicationRequest(db,visitor,input,options={}){
 // A fresh authenticated admission may acknowledge an old revoked-memory
 // operation without redelivering its text or buying another provider call.
 // This branch returns no content; authoritative plaintext reads stay below.
 const authority=await visitorAuthority(db,visitor,input,options);
 if(publicationHasMemory(authority.p)){
  const prior=await requestRow(db,visitor,input);
  if(prior&&prior.replica_id===authority.p.replica_id&&prior.owner_user_id===authority.p.owner_user_id
   &&prior.memory_epoch!=null&&String(prior.memory_epoch)!==String(authority.v.memory_epoch))
   return requestWire({...prior,state:'withdrawn',failure_code:'text_publication_memory_epoch_revoked'});
 }
 const {r,s}=await currentRequest(db,visitor,input,options);
 if(r.state==='complete'&&String(r.dispatch_authority_epoch)!==String(s.row.private_text_epoch))fail('text_publication_output_authority_changed');
 return requestWire(r,r.state==='complete'?decryptPublicationText(json(r.answer_envelope),binding(r,'answer',r.answer_hash),envOf(options)):undefined);
}
export const TEXT_PUBLICATION_MEMORY_HISTORY_SQL=`with ${TEXT_PUBLICATION_SOURCE_FENCE},${PUB_LOCK},${VISITOR_LOCK}
 select v.publication_id,coalesce((select jsonb_agg(to_jsonb(history) order by history.created_at,history.request_id) from (
 select h.* from vy_text_publication_request h
 where h.publication_id=v.publication_id and h.visitor_user_id=v.visitor_user_id
 and h.replica_id=$1::uuid and h.owner_user_id=$2::uuid and h.publication_epoch=$9::bigint and h.session_epoch=$11::bigint
 and h.memory_epoch=v.memory_epoch and v.memory_enabled=true and h.state='complete' and h.expires_at>now()
 and h.dispatch_authority_epoch=($4::jsonb->>'fence_epoch')::bigint and ${PUBLICATION_MEMORY_REQUEST_GUARD}
 order by h.created_at desc,h.request_id desc limit 3) history),'[]'::jsonb) exchanges from visitor v`;
export const TEXT_PUBLICATION_ADMIT_SQL=`with ${TEXT_PUBLICATION_SOURCE_FENCE},${PUB_LOCK},${VISITOR_LOCK},claimed_request_id as (
 insert into vy_text_publication_id_ledger(id,kind) select $13::uuid,'request' from pub p join visitor v on v.publication_id=p.publication_id
 where p.question_count<(p.terms->>'total_question_limit')::integer and v.question_count<(p.terms->>'visitor_question_limit')::integer
 on conflict do nothing returning id
),admitted as (
 insert into vy_text_publication_request(request_id,publication_id,replica_id,owner_user_id,visitor_user_id,publication_epoch,session_epoch,request_hash,question_hash,question_envelope,expires_at,memory_epoch,memory_refs,memory_refs_hash,gate_sidecar)
 select $13::uuid,p.publication_id,p.replica_id,p.owner_user_id,v.visitor_user_id,p.epoch,v.session_epoch,$14,$15,$16::jsonb,least(p.expires_at,now()+interval '30 days'),$17::bigint,$18::jsonb,$19,$20::jsonb from pub p join visitor v on v.publication_id=p.publication_id
 where exists(select 1 from claimed_request_id)
 on conflict do nothing returning *
),pub_count as (update vy_text_publication p set question_count=p.question_count+1 from admitted a where p.publication_id=a.publication_id returning p.publication_id),
visitor_count as (update vy_text_publication_visitor v set question_count=v.question_count+1 from admitted a where v.publication_id=a.publication_id and v.visitor_user_id=a.visitor_user_id returning v.publication_id)
 select a.* from admitted a where exists(select 1 from pub_count) and exists(select 1 from visitor_count)`;
export async function admitTextPublicationRequest(db,visitor,input,options={}){
 const publicId=uuid(input.public_id),id=uuid(input.request_id);uuid(visitor);if(!validText(input.question,2000))fail('text_publication_question_invalid',400);
 const qh=sha256Hex(input.question),existing=await requestRow(db,visitor,input);
 if(existing){const selectionHash=json(existing.gate_sidecar)?.evidence_selection?.selection_hash||null;
  if(existing.request_hash!==hash(requestIdentity(publicId,visitor,id,qh,selectionHash)))fail('text_publication_request_conflict');
  return {created:false,request:await readTextPublicationRequest(db,visitor,input,options),compilerInput:null};}
 textPublicationKey(envOf(options));const {p,s,v,session}=await visitorAuthority(db,visitor,input,options);
 const bound=bindPublishedEvidence(s,input.question,qh),selectionHash=bound.evidenceSelection?.selection_hash||null;
 const requestHash=hash(requestIdentity(publicId,visitor,id,qh,selectionHash)),gateSidecar=bound.evidenceSelection?{evidence_selection:bound.evidenceSelection}:{};
 const remembers=publicationHasMemory(p)&&v.memory_enabled===true;
 let memory={exchanges:[],refs:[],refsHash:EMPTY_MEMORY_REFS_HASH},memoryFailure=null;
 if(remembers){const result=(await db(TEXT_PUBLICATION_MEMORY_HISTORY_SQL,authArgs(p,s,session,visitor)))[0];
  if(!result||result.publication_id!==p.publication_id)fail('text_publication_memory_authority_changed');
  try{memory=decodePublicationContinuity(json(result.exchanges),{publication:p,visitor,epoch:v.memory_epoch,env:envOf(options)});}
  catch(error){
   if(!['text_publication_memory_invalid','text_publication_memory_budget_exceeded','text_publication_decryption_failed','text_publication_encryption_binding_invalid','text_publication_content_hash_mismatch'].includes(error?.code))throw error;
   // Admit the submitted operation as a durable, non-dispatched failure. The
   // caller can then read its terminal status rather than becoming stuck with
   // a local pending id that was never persisted. It still counts under the
   // existing admission-count policy; it buys no provider call.
   memoryFailure=error.code;
  }
 }
 const row={publication_id:publicId,request_id:id,replica_id:p.replica_id,owner_user_id:p.owner_user_id,visitor_user_id:visitor};
 let rows;try{rows=await db(TEXT_PUBLICATION_ADMIT_SQL,[...authArgs(p,s,session,visitor),id,requestHash,qh,JSON.stringify(encryptPublicationText(input.question,binding(row,'question',qh),envOf(options))),remembers?String(v.memory_epoch):null,JSON.stringify(memory.refs),memory.refsHash,JSON.stringify(gateSidecar)]);}catch{fail('text_publication_admission_uncertain',503);}
 if(!rows.length){const replay=await requestRow(db,visitor,input);if(replay){if(replay.request_hash!==requestHash)fail('text_publication_request_conflict');return {created:false,request:await readTextPublicationRequest(db,visitor,input,options),compilerInput:null};}fail('text_publication_admission_blocked',Number(p.question_count)>=json(p.terms).total_question_limit||Number(v.question_count)>=json(p.terms).visitor_question_limit?429:409);}
 return {created:true,request:requestWire(rows[0]),owner_user_id:p.owner_user_id,replica_id:p.replica_id,...(memoryFailure?{failure_code:memoryFailure,compilerInput:null}:{compilerInput:{authority:{scope:'account_material_publication',basis:(json(p.projection).sheetKind==='person'?'account_person_material_publication/v':'account_material_publication/v')+(Number(p.version)===2?'2':'1'),ownerId:p.owner_user_id,replicaId:p.replica_id,publicationId:publicId,requestId:id,visitorId:visitor,projectionHash:hash(json(p.projection)),receiptHash:p.receipt_hash,sourceHash:s.snapshot.source_hash},projection:json(p.projection),contexts:bound.contexts,question:input.question,...(publicationHasMemory(p)?{privateContinuity:{enabled:remembers,memoryEpoch:String(v.memory_epoch),policyHash:PUBLICATION_MEMORY_POLICY_HASH,exchanges:memory.exchanges}}:{})}})};
}
export const TEXT_PUBLICATION_CLAIM_SQL=`with ${TEXT_PUBLICATION_SOURCE_FENCE},${PUB_LOCK},${VISITOR_LOCK},claimed as (
 update vy_text_publication_request h set state='dispatched',dispatch_token_hash=$14,dispatch_authority_epoch=($4::jsonb->>'fence_epoch')::bigint,reservation_id=$15::uuid,budget_id=$16,spend_request_hash=$17,provider=$18::jsonb,billing_state='reserved'
 from visitor v,pub p where h.request_id=$13::uuid and h.publication_id=p.publication_id and h.publication_id=v.publication_id and h.visitor_user_id=v.visitor_user_id
 and h.replica_id=$1::uuid and h.owner_user_id=$2::uuid and h.publication_epoch=$9::bigint and h.session_epoch=$11::bigint and h.expires_at>now() and h.state='admitted'
 and ${PUBLICATION_MEMORY_REQUEST_GUARD}
 and p.committed_microusd+$19::bigint<=(p.terms->>'budget_microusd')::bigint
 and exists(select 1 from vy_provider_spend sp where sp.reservation_id=$15::uuid and sp.budget_id=$16 and sp.request_hash=$17 and sp.operation='dialogue' and sp.unit_kind='tokens' and sp.state='reserved' and sp.reserved_microusd=$19::bigint
 and sp.provider_family=$18::jsonb->>'family' and sp.provider_name=$18::jsonb->>'name' and sp.provider_version=$18::jsonb->>'version' and sp.model=$18::jsonb->>'model')
 returning h.*
), charged as (update vy_text_publication p set committed_microusd=p.committed_microusd+$19::bigint from claimed h where p.publication_id=h.publication_id returning p.publication_id)
 select h.* from claimed h where exists(select 1 from charged)`;
export async function claimTextPublicationRequest(db,visitor,input,options={}){
 const {p,s,session,r}=await currentRequest(db,visitor,input,options);if(r.state!=='admitted')fail('text_publication_dispatch_unavailable');const provider=input.provider,v=input.reservation;
 if(!provider||['family','name','version','model'].some(k=>!validText(provider[k],300))||!HASH.test(provider.prompt_hash||''))fail('text_publication_provider_invalid',503);
 const spendHash=hash({operation:'dialogue',request_key:`text-publication:${r.request_id}`,provider_family:provider.family,provider_name:provider.name,provider_version:provider.version,model:provider.model});
 if(!v||v.state!=='reserved'||v.request_hash!==spendHash||!UUID.test(v.reservation_id||'')||typeof v.budget_id!=='string'||!Number.isSafeInteger(v.reserved_microusd)||v.reserved_microusd<=0)fail('text_publication_reservation_invalid',503);
 const token=randomBytes(32).toString('hex');let rows;try{rows=await db(TEXT_PUBLICATION_CLAIM_SQL,[...authArgs(p,s,session,visitor),r.request_id,sha256Hex(token),v.reservation_id,v.budget_id,v.request_hash,JSON.stringify(provider),v.reserved_microusd]);}catch{fail('text_publication_dispatch_uncertain',503);}
 if(!rows.length)fail('text_publication_dispatch_blocked');return {dispatch_token:token,request:requestWire(rows[0])};
}
export const TEXT_PUBLICATION_COMPLETE_SQL=`with ${TEXT_PUBLICATION_SOURCE_FENCE},${PUB_LOCK},${VISITOR_LOCK}
 update vy_text_publication_request h set state='complete',answer_envelope=$15::jsonb,answer_hash=$16,raw_envelope=$17::jsonb,raw_hash=$18,gate_sidecar=h.gate_sidecar||$19::jsonb,billing_state=$20
 from visitor v where h.request_id=$13::uuid and h.publication_id=v.publication_id and h.visitor_user_id=v.visitor_user_id and h.replica_id=$1::uuid and h.owner_user_id=$2::uuid
 and h.publication_epoch=$9::bigint and h.session_epoch=$11::bigint and h.expires_at>now() and h.state='dispatched' and h.dispatch_token_hash=$14
 and ${PUBLICATION_MEMORY_REQUEST_GUARD}
 and h.dispatch_authority_epoch=($4::jsonb->>'fence_epoch')::bigint
 and exists(select 1 from vy_provider_spend sp where sp.reservation_id=h.reservation_id and sp.budget_id=h.budget_id and sp.request_hash=h.spend_request_hash and sp.operation='dialogue' and sp.state=$20 and sp.state in ('settled','reconcile_required')) returning h.request_id`;
export async function completeTextPublicationRequest(db,visitor,input,options={}){
 const {p,s,session,r}=await currentRequest(db,visitor,input,options),raw=typeof input.raw_output==='string'?input.raw_output:JSON.stringify(input.raw_output);
 if(r.state!=='dispatched'||sha256Hex(String(input.dispatch_token||''))!==r.dispatch_token_hash)fail('text_publication_dispatch_unavailable');
 if(String(r.dispatch_authority_epoch)!==String(s.row.private_text_epoch))fail('text_publication_output_authority_changed');
 if(!validText(input.answer,4000)||!validText(raw,32000)||input.gate?.gated!==true||!['settled','reconcile_required'].includes(input.billing_state))fail('text_publication_output_invalid',503);
 const ah=sha256Hex(input.answer),rh=sha256Hex(raw),gate={version:'account-material-output/v1',gated:true,finding_count:Number.isSafeInteger(input.gate.finding_count)?Math.max(0,input.gate.finding_count):0};
 const rows=await db(TEXT_PUBLICATION_COMPLETE_SQL,[...authArgs(p,s,session,visitor),r.request_id,r.dispatch_token_hash,JSON.stringify(encryptPublicationText(input.answer,binding(r,'answer',ah),envOf(options))),ah,JSON.stringify(encryptPublicationText(raw,binding(r,'raw',rh),envOf(options))),rh,JSON.stringify(gate),input.billing_state]);
 if(!rows.length)fail('text_publication_delivery_blocked');return readTextPublicationRequest(db,visitor,input,options);
}
export const TEXT_PUBLICATION_FAIL_SQL=`update vy_text_publication_request h set state=$5,billing_state=$6,failure_code=$7
 where h.publication_id=$1::uuid and h.visitor_user_id=$2::uuid and h.request_id=$3::uuid and ((h.state='admitted' and $4::text is null) or (h.state='dispatched' and h.dispatch_token_hash=$4)
 or (h.state='dispatched' and $4::text is null and exists(select 1 from vy_provider_spend sp where sp.reservation_id=h.reservation_id and sp.budget_id=h.budget_id and sp.request_hash=h.spend_request_hash and sp.operation='dialogue' and sp.state='released'))) returning h.*`;
export async function failTextPublicationRequest(db,visitor,input){
 const billing=['not_started','reserved','in_flight','settled','reconcile_required'].includes(input.billing_state)?input.billing_state:'reconcile_required';
 const code=/^[a-z][a-z0-9_]{0,100}$/.test(input.failure_code||'')?input.failure_code:'text_publication_failed',state=['in_flight','reconcile_required'].includes(billing)||code.includes('uncertain')?'uncertain':'blocked';
 const rows=await db(TEXT_PUBLICATION_FAIL_SQL,[uuid(input.public_id),uuid(visitor),uuid(input.request_id),input.dispatch_token?sha256Hex(input.dispatch_token):null,state,billing,code]);
 return rows[0]?requestWire(rows[0]):{public_id:input.public_id,request_id:input.request_id,state:'withdrawn',billing_state:billing,can_voice:false};
}
// The replica lock serializes against source-fenced admission; a terminal row
// handles late claims. Revocation is permanent and erases publication payloads.
export const TEXT_PUBLICATION_UNPUBLISH_SQL=`with source_gate as materialized(select src.source_id from vy_replica_source src where src.replica_id=$1::uuid and src.owner_user_id=$2::uuid order by src.source_id for update of src),
 owned as(update vy_replica r set updated_at=r.updated_at where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and (select count(*) from source_gate)>=0 returning r.replica_id),
 stopped as(insert into vy_text_publication as p(publication_id,replica_id,owner_user_id,state,revoked_at)
 select $3::uuid,$1::uuid,$2::uuid,'revoked',now() from owned on conflict(publication_id) do update
 set state='revoked',epoch=p.epoch+1,projection=null,receipt=null,revoked_at=coalesce(p.revoked_at,now())
 where p.replica_id=excluded.replica_id and p.owner_user_id=excluded.owner_user_id returning p.publication_id),
 retired as(insert into vy_text_publication_id_ledger(id,kind) select publication_id,'publication' from stopped on conflict do nothing returning id),
 passes as(update vy_text_publication_access_pass a set state='revoked',revoked_at=coalesce(a.revoked_at,now())
 where a.publication_id in(select publication_id from stopped) and a.state<>'revoked' and (select count(*) from retired)>=0 returning a.publication_id),
 visitors as(update vy_text_publication_visitor v set session_epoch=v.session_epoch+1,memory_enabled=false,memory_epoch=v.memory_epoch+1,memory_policy_hash=null,memory_choice_at=null,admission=null,admission_hash=null,expires_at=null,access_pass_id=null where v.publication_id in(select publication_id from stopped) and (select count(*) from passes)>=0 returning v.publication_id),
 erased as(update vy_text_publication_request h set state='withdrawn',question_envelope=null,answer_envelope=null,raw_envelope=null,gate_sidecar='{}'::jsonb,memory_refs='[]'::jsonb,memory_refs_hash=null,memory_epoch=null,failure_code='text_publication_revoked' where h.publication_id in(select publication_id from stopped) and (select count(*) from visitors)>=0 returning h.request_id)
 select publication_id from stopped where (select count(*) from erased)>=0`;
export async function unpublishTextPublication(db,owner,input){
 const rows=await db(TEXT_PUBLICATION_UNPUBLISH_SQL,[uuid(input.replica_id),uuid(owner),uuid(input.publication_id)]);if(!rows.length)fail('text_publication_not_found',404);await cleanupTextPublicationPayloads(db,[input.publication_id]);return readOwnedTextPublication(db,owner,input);
}
export const TEXT_PUBLICATION_FORGET_SQL=`with locked as materialized(select p.publication_id from vy_text_publication p where p.publication_id=$1::uuid for update of p),
 stopped as(insert into vy_text_publication_visitor as v(publication_id,replica_id,owner_user_id,visitor_user_id,session_epoch)
 select p.publication_id,p.replica_id,p.owner_user_id,$2::uuid,1 from vy_text_publication p join locked l on l.publication_id=p.publication_id
 on conflict(publication_id,visitor_user_id) do update set session_epoch=v.session_epoch+1,memory_enabled=false,memory_epoch=v.memory_epoch+1,memory_policy_hash=null,memory_choice_at=null,admission=null,admission_hash=null,expires_at=null returning v.publication_id),
 erased as(update vy_text_publication_request h set state='withdrawn',question_envelope=null,answer_envelope=null,raw_envelope=null,gate_sidecar='{}'::jsonb,memory_refs='[]'::jsonb,memory_refs_hash=null,memory_epoch=null,failure_code='text_publication_visitor_forgotten' where h.publication_id in(select publication_id from stopped) and h.visitor_user_id=$2::uuid returning h.request_id)
 select count(*) from erased`;
export async function forgetTextPublicationVisitor(db,visitor,input){await db(TEXT_PUBLICATION_FORGET_SQL,[uuid(input.public_id),uuid(visitor)]);await cleanupTextPublicationPayloads(db,[input.public_id],visitor);return {forgotten:true,private_payload_erased:true};}

// A new statement is essential after a lock wait/UPSERT: the first statement
// snapshot may not see a request that committed during that wait. The terminal
// publication/session epoch already prevents further old-authority admission.
export const TEXT_PUBLICATION_CLEANUP_SQL=`with locked as materialized(select p.publication_id,p.state from vy_text_publication p where p.publication_id=any($1::uuid[]) order by p.publication_id for update of p),
visitors as(update vy_text_publication_visitor v set
 session_epoch=case when p.state='revoked' and v.admission is not null then v.session_epoch+1 else v.session_epoch end,
 admission=case when p.state='revoked' then null else v.admission end,
 admission_hash=case when p.state='revoked' then null else v.admission_hash end,
 expires_at=case when p.state='revoked' then null else v.expires_at end,
 memory_enabled=case when p.state='revoked' then false else v.memory_enabled end,
 memory_epoch=case when p.state='revoked' and v.memory_enabled then v.memory_epoch+1 else v.memory_epoch end,
 memory_policy_hash=case when p.state='revoked' then null else v.memory_policy_hash end,
 memory_choice_at=case when p.state='revoked' then null else v.memory_choice_at end
 from locked p where v.publication_id=p.publication_id and ($2::uuid is null or v.visitor_user_id=$2::uuid)
 returning v.publication_id,v.visitor_user_id,v.session_epoch,p.state publication_state),
erased as(update vy_text_publication_request h set state='withdrawn',question_envelope=null,answer_envelope=null,raw_envelope=null,gate_sidecar='{}'::jsonb,memory_refs='[]'::jsonb,memory_refs_hash=null,memory_epoch=null,failure_code='text_publication_authority_withdrawn'
 from visitors v where h.publication_id=v.publication_id and h.visitor_user_id=v.visitor_user_id
 and (v.publication_state='revoked' or h.session_epoch<v.session_epoch)
 and (h.state<>'withdrawn' or h.question_envelope is not null or h.answer_envelope is not null or h.raw_envelope is not null) returning h.request_id)
select count(*)::integer requests from erased`;
function dbCount(value,code){if(!((typeof value==='number'&&Number.isSafeInteger(value))||(typeof value==='string'&&/^\d+$/.test(value)))||!Number.isSafeInteger(Number(value))||Number(value)<0)fail(code,503);return Number(value);}
async function cleanupTextPublicationPayloads(db,ids,visitor=null){const row=(await db(TEXT_PUBLICATION_CLEANUP_SQL,[ids.map(uuid),visitor===null?null:uuid(visitor)]))[0];if(!row)fail('text_publication_cleanup_unconfirmed',503);return dbCount(row.requests,'text_publication_cleanup_unconfirmed');}

// wipe_state forget is conversation forgetting, not Supabase account deletion.
// Preserve operational quota counters while erasing content and old sessions.
export const TEXT_PUBLICATION_ACCOUNT_FORGET_SQL=`with locked as materialized (
 select p.publication_id from vy_text_publication p join vy_text_publication_visitor v on v.publication_id=p.publication_id
 where v.visitor_user_id=$1::uuid order by p.publication_id for update of p
), passes as (
 update vy_text_publication_access_pass a set state='revoked',visitor_user_id=null,revoked_at=coalesce(a.revoked_at,now())
 where a.visitor_user_id=$1::uuid and a.publication_id in(select publication_id from locked) returning a.publication_id
), visitors as (
 update vy_text_publication_visitor v set session_epoch=v.session_epoch+1,memory_enabled=false,memory_epoch=v.memory_epoch+1,memory_policy_hash=null,memory_choice_at=null,admission=null,admission_hash=null,expires_at=null,access_pass_id=null
 where v.visitor_user_id=$1::uuid and v.publication_id in(select publication_id from locked) and (select count(*) from passes)>=0 returning v.publication_id
) select distinct publication_id from (select publication_id from passes union all select publication_id from visitors) reached`;
export async function forgetTextPublicationAccount(db,visitor){const rows=await db(TEXT_PUBLICATION_ACCOUNT_FORGET_SQL,[uuid(visitor)]);if(rows.length)await cleanupTextPublicationPayloads(db,rows.map(r=>r.publication_id),visitor);return {forgotten:true};}

export const TEXT_PUBLICATION_WITHDRAWN_ACCOUNT_SQL=`select p.publication_id from vy_text_publication p
 where p.replica_id=$1::uuid and p.owner_user_id=$2::uuid
 and ((p.state='active' and exists(select 1 from vy_replica_source src where src.source_id=p.source_id and src.replica_id=p.replica_id and src.owner_user_id=p.owner_user_id and src.state='deleting'))
 or (p.state='revoked' and (exists(select 1 from vy_text_publication_visitor v where v.publication_id=p.publication_id and v.admission is not null)
 or exists(select 1 from vy_text_publication_request h where h.publication_id=p.publication_id and (h.question_envelope is not null or h.answer_envelope is not null or h.raw_envelope is not null)))))
 order by p.publication_id limit 101`;
export async function cleanupWithdrawnTextPublicationAccount(db,owner,rid){
 const rows=await db(TEXT_PUBLICATION_WITHDRAWN_ACCOUNT_SQL,[uuid(rid),uuid(owner)]);
 if(rows.length>100)fail('text_publication_cleanup_backlog',503);
 for(const p of rows)await unpublishTextPublication(db,owner,{replica_id:rid,publication_id:p.publication_id});
 return {publications:rows.length};
}

// Expiry erases content on a bounded real sweep, independent of a visitor read.
// No source/replica writes: taking publication then visitor locks cannot form a
// cycle with source -> replica -> publication -> visitor admission.
export const TEXT_PUBLICATION_EXPIRE_SQL=`with expired as materialized (
 select p.publication_id from vy_text_publication p where (p.state='active' and p.expires_at<=now())
 or (p.state='revoked' and (exists(select 1 from vy_text_publication_visitor v where v.publication_id=p.publication_id and v.admission is not null)
 or exists(select 1 from vy_text_publication_request h where h.publication_id=p.publication_id and (h.question_envelope is not null or h.answer_envelope is not null or h.raw_envelope is not null))))
 order by p.expires_at,p.publication_id limit $1::integer for update of p skip locked
),stopped as(update vy_text_publication p set state='revoked',epoch=p.epoch+1,projection=null,receipt=null,revoked_at=coalesce(p.revoked_at,now())
 where p.publication_id in(select publication_id from expired) returning p.publication_id),
retired as(insert into vy_text_publication_id_ledger(id,kind) select publication_id,'publication' from stopped on conflict do nothing returning id),
passes as(update vy_text_publication_access_pass a set state='revoked',revoked_at=coalesce(a.revoked_at,now())
 where a.publication_id in(select publication_id from stopped) and a.state<>'revoked' and (select count(*) from retired)>=0 returning a.publication_id),
visitors as(update vy_text_publication_visitor v set session_epoch=v.session_epoch+1,memory_enabled=false,memory_epoch=v.memory_epoch+1,memory_policy_hash=null,memory_choice_at=null,admission=null,admission_hash=null,expires_at=null,access_pass_id=null where v.publication_id in(select publication_id from stopped) and (select count(*) from passes)>=0 returning v.publication_id),
erased as(update vy_text_publication_request h set state='withdrawn',question_envelope=null,answer_envelope=null,raw_envelope=null,gate_sidecar='{}'::jsonb,memory_refs='[]'::jsonb,memory_refs_hash=null,memory_epoch=null,failure_code='text_publication_expired' where h.publication_id in(select publication_id from stopped) and (select count(*) from visitors)>=0 returning h.request_id)
select (select count(*) from stopped)::integer publications,(select count(*) from erased)::integer requests,coalesce((select jsonb_agg(publication_id) from stopped),'[]'::jsonb) publication_ids`;
export async function expireTextPublications(db,{limit=50}={}){
 if(!Number.isInteger(limit)||limit<1||limit>100)fail('text_publication_sweep_limit_invalid',400);
 const row=(await db(TEXT_PUBLICATION_EXPIRE_SQL,[limit]))[0];
 if(!row)fail('text_publication_expiry_unconfirmed',503);const publications=dbCount(row.publications,'text_publication_expiry_unconfirmed'),requests=dbCount(row.requests,'text_publication_expiry_unconfirmed');let ids;try{ids=json(row.publication_ids);}catch{fail('text_publication_expiry_unconfirmed',503);}
 if(publications>limit||!Array.isArray(ids)||ids.length!==publications||ids.some(id=>typeof id!=='string'||!UUID.test(id)))fail('text_publication_expiry_unconfirmed',503);
 const additional=publications?await cleanupTextPublicationPayloads(db,ids):0;return {publications,requests:requests+additional};
}
