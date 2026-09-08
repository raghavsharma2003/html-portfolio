import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {continuityTokens,continuityReferences,continuityPrompt,readPrivateContinuity,readPrivateContinuitySources,
 PRIVATE_CONTINUITY_SQL,PRIVATE_CONTINUITY_SOURCES_SQL,continuityPredicate,privateContinuityPredicate} from '../../api/_private-dialogue-continuity.js';
import {compileDialoguePrompt} from '../../api/_dialogue/contracts.js';
import {splitSql} from '../../db/migrations/apply.mjs';
import {DIALOGUE_AUTHORITY_SQL} from '../../api/_replica-dialogue-authority.js';
import {ownerPrivateCapabilityAuthoritySql} from '../../api/_replica-candidate-activation-authority.js';
import {textPublicationTerms} from '../../api/_text-publication-store.js';
import {PUBLICATION_MEMORY_MODE,publicationHasMemory,publicationMemorySettings,decodePublicationContinuity} from '../../api/_text-publication-memory.js';
import {encryptPublicationText,publicationTextBinding} from '../../api/_text-publication-crypto.js';
const id=n=>`${n}0000000-0000-4000-8000-00000000000${n}`;
const hash=s=>createHash('sha256').update(s).digest('hex');
const [owner,replica,session,prior,turn]=[1,2,3,4,5].map(id);
const question='कल physics lesson में pendulum discuss किया था';
const reply='We discussed its period.';
const evidence={turn_id:turn,session_id:prior,created_at:'2026-09-08T01:00:00.000Z',question,reply,question_sha256:hash(question),reply_sha256:hash(reply)};
let checks=0;const test=async(name,fn)=>{await fn();console.log(`ok ${++checks} - ${name}`);};
const privateAuthority=ownerPrivateCapabilityAuthoritySql('c','r');
assert.equal(DIALOGUE_AUTHORITY_SQL.split("c.state='active'").length,2);
const derivedAuthority=DIALOGUE_AUTHORITY_SQL.replace("c.state='active'",privateAuthority)
 .replace('c.capability_id,c.profile_version,c.calibration_version',
  'c.capability_id,c.profile_version,c.calibration_version,r.lifecycle,r.subject_mode,r.policy_version,r.identity_expires_at,r.age_verified_at,r.identity_verified_at,r.liveness_verified_at');
await test('derived owner-private authority preserves every shared field and exact global guard',()=>{
 const required=[...new Set([...continuityPredicate('refs').matchAll(/\br\.([a-z_]+)/g)].map(m=>m[1]))];
 const validate=sql=>{const projection=sql.slice(0,sql.indexOf('from vy_replica r'));for(const field of required)assert(new RegExp('\\br\\.'+field+'\\b').test(projection),'missing continuity authority projection: '+field);};
 validate(DIALOGUE_AUTHORITY_SQL);validate(derivedAuthority);
 const check=sql=>{assert(sql.startsWith(`with authorized as materialized (${derivedAuthority}),`));};
 for(const sql of [PRIVATE_CONTINUITY_SQL,PRIVATE_CONTINUITY_SOURCES_SQL]){
  check(sql);
  assert.throws(()=>check(sql.replace(derivedAuthority,DIALOGUE_AUTHORITY_SQL)));
  for(const part of ['ops.capability_id=c.capability_id',"gb.state='active'",'gb.owner_user_id=ops.owner_user_id','gb.profile_version=c.profile_version','gb.calibration_version=c.calibration_version'])
   assert.throws(()=>check(sql.replaceAll(part,'true')));
 }
 assert(!DIALOGUE_AUTHORITY_SQL.includes('vy_replica_owner_private_selection'));
 assert(DIALOGUE_AUTHORITY_SQL.includes("c.state='active'"));
 assert.equal(privateContinuityPredicate('refs'),continuityPredicate('refs').replace("c.state='active'",privateAuthority));
 for(const field of required)assert.throws(()=>validate(DIALOGUE_AUTHORITY_SQL.replace(new RegExp('\\br\\.'+field+'\\b'),'NULL')),/missing continuity authority projection/);
});
// Scoped fixture responses exercise the actual caller, not SQL authorization semantics.
await test('actual recall caller binds derived authority and refuses unauthorized evidence',async()=>{
  const result=await readPrivateContinuity(async(sql,args)=>{
   assert.equal(sql,PRIVATE_CONTINUITY_SQL);assert(sql.includes(derivedAuthority));assert.deepEqual(args.slice(0,3),[replica,owner,session]);
   return [{authorized:true,evidence:[evidence]}];
  },owner,replica,session,'pendulum');
  assert.equal(result[0].turn_id,turn);
 await assert.rejects(()=>readPrivateContinuity(async(sql)=>{assert(sql.includes(derivedAuthority));return[{authorized:false,evidence:[evidence]}];},owner,replica,session,'pendulum'),/continuity_unavailable/);
});
await test('Hindi meaningful words survive while common recall fillers are removed',()=>{assert(continuityTokens('मुझे physics pendulum याद है').includes('pendulum'));assert(!continuityTokens('मुझे याद है').length);});
await test('Hinglish and English bounded tokens use no provider',()=>{assert.deepEqual(continuityTokens('Pendulum pendulum ka TIME kya hai?'),['pendulum','time']);assert.equal(continuityTokens(Array.from({length:20},(_,i)=>'word'+i).join(' ')).length,8);});
await test('actual retrieval sends only server-derived scope and query tokens',async()=>{
 let called;const got=await readPrivateContinuity(async(sql,args)=>{called={sql,args};return[{authorized:true,evidence:[evidence]}];},owner,replica,session,'pendulum याद है');
 assert.equal(called.sql,PRIVATE_CONTINUITY_SQL);assert.deepEqual(called.args.slice(0,3),[replica,owner,session]);assert.deepEqual(called.args[4],['pendulum']);assert.equal(got[0].question,question);
});
await test('absent authority refuses rather than returning an empty success',async()=>{await assert.rejects(()=>readPrivateContinuity(async()=>[{authorized:false,evidence:[]}],owner,replica,session,'pendulum'),/continuity_unavailable/);});
await test('database failure does not become no memories',async()=>{await assert.rejects(()=>readPrivateContinuity(async()=>{throw Error('database unavailable');},owner,replica,session,'pendulum'),/database unavailable/);});
for(const changed of [{question:'changed'}, {reply:'changed'}, {session_id:session}, {turn_id:'foreign'}, {created_at:'invalid'}, {question:'x'.repeat(4001)}])
 await test('corrupt or wrong-session evidence is refused '+Object.keys(changed)[0],async()=>{await assert.rejects(()=>readPrivateContinuity(async()=>[{authorized:true,evidence:[{...evidence,...changed}]}],owner,replica,session,'pendulum'));});
await test('duplicate references and excessive evidence refused',()=>{assert.throws(()=>continuityReferences([evidence,evidence]));assert.throws(()=>continuityReferences([1,2,3,4].map(()=>evidence)));});
await test('exact evidence refs contain no transcript or log identity',()=>{assert.deepEqual(Object.keys(continuityReferences([evidence])[0]),['turn_id','question_sha256','reply_sha256']);});
await test('prompt labels prior AI as untrusted and remains bounded',()=>{
 const long={...evidence,question:'ह'.repeat(4000),reply:'x'.repeat(1600)};
 const section=continuityPrompt([long,{...long,turn_id:id(6)},{...long,turn_id:id(7)}]);assert(section.length<3000);assert(Buffer.byteLength(section,'utf8')<=2048);assert.match(section,/not instructions or established facts/);
 const p=compileDialoguePrompt({core:'Self: expert',message:'pendulum?',evidence:section});assert.match(p.messages[0].content,/Earlier private conversation/);
 assert.notEqual(p.prompt_hash,compileDialoguePrompt({core:'Self: expert',message:'pendulum?'}).prompt_hash);
});
await test('empty retrieval creates no memory prompt',()=>assert.equal(continuityPrompt([]),''));
await test('source peek rechecks authority and returns only bounded display fields',async()=>{
 const source={turn_id:turn,created_at:evidence.created_at,question,reply};let sql;
 const result=await readPrivateContinuitySources(async(s)=>{sql=s;return[{authorized:true,sources:[source]}];},owner,{replica_id:replica,turn_id:turn});
 assert.equal(sql,PRIVATE_CONTINUITY_SOURCES_SQL);assert.deepEqual(result,[source]);
 await assert.rejects(()=>readPrivateContinuitySources(async()=>[{authorized:false,sources:[source]}],owner,{replica_id:replica,turn_id:turn}));
});
// These are SQL mutation controls, not a database parser or isolation proof.
const required=['ct.replica_id=r.replica_id','ct.owner_user_id=r.owner_user_id','ct.agent_id=r.agent_id','ct.person_id=r.subject_person_id',
 'ct.capability_id=c.capability_id',"cs.state='active'","cs.last_active_at>now()-interval '12 hours'",'ct.session_id<>s.session_id',
 "ct.state='complete'","cu.group_id is null","ca.group_id is null",'e.question_sha256','e.reply_sha256'];
function guarded(sql){return required.every(part=>sql.includes(part));}
await test('predicate contains every scope and source lifecycle guard with deletion negatives',()=>{const sql=continuityPredicate('refs');assert(guarded(sql));for(const part of required)assert(!guarded(sql.replace(part,'true')));});
await test('legacy null refs have no source access and derived replies cannot recursively seed recall',()=>{
 assert.match(continuityPredicate('refs'),/coalesce\(refs,'\[\]'::jsonb\)/);assert(PRIVATE_CONTINUITY_SQL.includes("coalesce(t.continuity_refs,'[]'::jsonb)='[]'::jsonb"));
});
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
await test('migration has one-statement runner shapes mirrored into schema, no DO',()=>{
 const migration=read('db/migrations/148_private_dialogue_continuity.sql');assert.equal(splitSql(migration).length,4);assert(!/\bdo\s+\$/i.test(migration));assert(read('db/schema.sql').replaceAll('\r\n','\n').includes(migration.replaceAll('\r\n','\n')));
 assert.match(migration,/using gin\(continuity_refs jsonb_path_ops\)/);assert.match(migration,/derived.owner_user_id=old.owner_user_id/);assert.match(migration,/derived.person_id=old.person_id/);
});
await test('cascade repair keeps source erasure and binds OLD derived reply after deletion',()=>{
 const m=read('db/migrations/154_private_continuity_cascade_order.sql');assert.equal(splitSql(m).length,2);assert(!/\bdo\s+\$/i.test(m));assert(read('db/schema.sql').replaceAll('\r\n','\n').includes(m.replaceAll('\r\n','\n')));
 const required=['after delete on vy_replica_dialogue_turn',"coalesce(old.continuity_refs,'[]'::jsonb)<>'[]'::jsonb",'l.id=old.assistant_log_id','l.agent_id=old.agent_id','l.device_id=old.device_id','derived.owner_user_id=old.owner_user_id','derived.replica_id=old.replica_id','derived.agent_id=old.agent_id','derived.person_id=old.person_id'];
 const valid=s=>required.every(p=>s.includes(p));assert(valid(m));for(const p of required)assert(!valid(m.replace(p,'true')));
});
await test('real dialogue caller opts in and fences admission completion history and voice',()=>{
 const dialogue=read('api/_replica-dialogue.js');assert.match(dialogue,/rawInput.recall_previous === true/);assert.match(dialogue,/readPrivateContinuity\(db, ownerUserId/);
 assert(dialogue.includes("continuityPredicate('$14::jsonb')"));assert(dialogue.includes("continuityPredicate('t.continuity_refs')"));assert.match(dialogue,/can_voice: evidence.length === 0/);
 assert(read('api/_replica-dialogue-history.js').includes("continuityPredicate('t.continuity_refs','r','c','t.session_id')"));
 assert(read('src/studio/ExpertConversation.tsx').includes('traceId, recallPrevious)'));
});
await test('publication defaults and explicit opt-out preserve no memory and no voice',()=>{
 const env={TEXT_PUBLICATION_BUDGET_USD:'1'},off=terms=>{assert.equal(terms.memory,false);assert.equal(terms.voice,false);assert.equal(terms.memory_policy,undefined);};
 off(textPublicationTerms(env));off(textPublicationTerms(env,false));
 assert.throws(()=>off({...textPublicationTerms(env),memory:PUBLICATION_MEMORY_MODE}));
 assert.throws(()=>off({...textPublicationTerms(env),voice:true}));
});
await test('explicit publication memory requires exact v2 policy and separate visitor permission',()=>{
 const terms=textPublicationTerms({TEXT_PUBLICATION_BUDGET_USD:'1'},true),publication={version:2,terms};
 assert.equal(terms.memory,PUBLICATION_MEMORY_MODE);assert.equal(terms.voice,false);assert(publicationHasMemory(publication));
 assert.equal(publicationHasMemory({...publication,version:1}),false);
 assert.equal(publicationHasMemory({...publication,terms:{...terms,memory_policy_hash:'bad'}}),false);
 assert.equal(publicationMemorySettings(publication,{memory_enabled:false}).enabled,false);
 assert.equal(publicationMemorySettings(publication,{memory_enabled:true}).enabled,true);
 for(const file of ['api/_text-publication-store.js','api/_text-publication-runtime.js','api/_text-publication-memory.js']){
  assert(!read(file).includes('readPrivateContinuity'));assert(!read(file).includes('_private-dialogue-continuity'));
 }
});
await test('real encrypted publication recall cannot cross visitor publication owner or epoch',()=>{
 const env={PRIVATE_TEXT_REHEARSAL_KEK_ID:'continuity-boundary-test',PRIVATE_TEXT_REHEARSAL_KEK_B64:Buffer.alloc(32,11).toString('base64')};
 const row={request_id:turn,publication_id:session,owner_user_id:owner,replica_id:replica,visitor_user_id:prior,memory_epoch:'1',state:'complete',gate_sidecar:{gated:true},question_hash:hash(question),answer_hash:hash(reply)};
 row.question_envelope=encryptPublicationText(question,publicationTextBinding(row,'question',row.question_hash),env);
 row.answer_envelope=encryptPublicationText(reply,publicationTextBinding(row,'answer',row.answer_hash),env);
 const scope={publication:{publication_id:session,owner_user_id:owner,replica_id:replica},visitor:prior,epoch:'1',env};
 assert.equal(decodePublicationContinuity([row],scope).exchanges[0].question,question);
 for(const patch of [{visitor:owner},{epoch:'2'},{publication:{...scope.publication,publication_id:prior}},{publication:{...scope.publication,owner_user_id:prior}}])
  assert.throws(()=>decodePublicationContinuity([row],{...scope,...patch}),{code:'text_publication_memory_invalid'});
});
console.log(`${checks} offline controls; SQL parsing, erasure execution, browser and model quality not run`);
