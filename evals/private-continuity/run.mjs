import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {continuityTokens,continuityReferences,continuityPrompt,readPrivateContinuity,readPrivateContinuitySources,
 PRIVATE_CONTINUITY_SQL,PRIVATE_CONTINUITY_SOURCES_SQL,continuityPredicate} from '../../api/_private-dialogue-continuity.js';
import {compileDialoguePrompt} from '../../api/_dialogue/contracts.js';
import {splitSql} from '../../db/migrations/apply.mjs';
const id=n=>`${n}0000000-0000-4000-8000-00000000000${n}`;
const hash=s=>createHash('sha256').update(s).digest('hex');
const [owner,replica,session,prior,turn]=[1,2,3,4,5].map(id);
const question='कल physics lesson में pendulum discuss किया था';
const reply='We discussed its period.';
const evidence={turn_id:turn,session_id:prior,created_at:'2026-09-08T01:00:00.000Z',question,reply,question_sha256:hash(question),reply_sha256:hash(reply)};
let checks=0;const test=async(name,fn)=>{await fn();console.log(`ok ${++checks} - ${name}`);};
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
await test('real dialogue caller opts in and fences admission completion history and voice',()=>{
 const dialogue=read('api/_replica-dialogue.js');assert.match(dialogue,/rawInput.recall_previous === true/);assert.match(dialogue,/readPrivateContinuity\(db, ownerUserId/);
 assert(dialogue.includes("continuityPredicate('$14::jsonb')"));assert(dialogue.includes("continuityPredicate('t.continuity_refs')"));assert.match(dialogue,/can_voice: evidence.length === 0/);
 assert(read('api/_replica-dialogue-history.js').includes("continuityPredicate('t.continuity_refs','r','c','t.session_id')"));
 assert(read('src/studio/ExpertConversation.tsx').includes('traceId, recallPrevious)'));
});
await test('public publication remains explicitly without memory',()=>{assert(read('api/_text-publication-store.js').includes('memory:false,voice:false'));assert(!read('api/_text-publication-runtime.js').includes('readPrivateContinuity'));});
console.log(`${checks} offline controls; SQL parsing, erasure execution, browser and model quality not run`);
