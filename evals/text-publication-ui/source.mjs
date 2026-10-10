import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../../src/studio/publication/publicationApi.ts',import.meta.url),'utf8')
 .replace('import { replicaRequest } from "../replicaApi";','const replicaRequest=async()=>globalThis.__publicationApiFixture;');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const api=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const publication={public_id:'10000000-0000-4000-8000-000000000001',version:1,state:'active',title:'Synthetic teaching material',disclosure:'AI using published material',disclosure_hash:'a'.repeat(64),can_text:true,can_voice:false,
 terms:{audience:'signed_in_adult_attestation',memory:false,voice:false,quota_policy:'admission_counts',publication_days:30,retention_days:30,visitor_question_limit:20,total_question_limit:200,budget_microusd:100000}};
let passed=0;
function check(name,fn){fn();passed++;console.log('ok '+passed+' - '+name);}
async function checkAsync(name,fn){await fn();passed++;console.log('ok '+passed+' - '+name);}
check('current explicit text capability accepted',()=>assert.equal(api.validatePublication(publication,publication.public_id),publication));
for(const [name,change]of [
 ['foreign publication',p=>p.public_id='other'],['voice escalation',p=>p.can_voice=true],['unknown authority version',p=>p.version=2],
 ['missing terms',p=>delete p.terms],['hidden retention change',p=>p.terms.retention_days=365],['memory escalation',p=>p.terms.memory=true],
 ['missing budget',p=>delete p.terms.budget_microusd],['negative budget',p=>p.terms.budget_microusd=-1],
])check(name+' refused',()=>{const p=structuredClone(publication);change(p);assert.throws(()=>api.validatePublication(p,publication.public_id));});
const answer={public_id:publication.public_id,request_id:'20000000-0000-4000-8000-000000000001',state:'complete',billing_state:'settled',answer:'Two seconds.',can_voice:false};
check('bound complete answer accepted',()=>assert.equal(api.validatePublicationRequest(answer,publication.public_id,answer.request_id),answer));
for(const [name,change]of [['foreign request',r=>r.request_id='other'],['foreign public scope',r=>r.public_id='other'],['voice bit',r=>r.can_voice=true],['empty answer',r=>r.answer=''],['withdrawn content',r=>r.state='withdrawn'],['unknown state',r=>r.state='success']])
 check(name+' refused',()=>{const r=structuredClone(answer);change(r);assert.throws(()=>api.validatePublicationRequest(r,publication.public_id,answer.request_id));});
check('withdrawn receipt without content accepted',()=>{const r={...answer,state:'withdrawn'};delete r.answer;assert.equal(api.validatePublicationRequest(r,publication.public_id,r.request_id),r);});
const tombstone={public_id:publication.public_id,state:'revoked',version:1,publication_never_created:true,can_text:false,can_voice:false,created_at:'2026-09-08T00:00:00Z',expires_at:'2026-09-08T00:00:00Z'};
check('full publication validator rejects minimal tombstone',()=>assert.throws(()=>api.validatePublication(tombstone,publication.public_id)));
check('owner accepts persisted never-published terminal receipt',()=>assert.equal(api.validateOwnedPublication(tombstone,publication.public_id),tombstone));
check('tombstone cannot become text authority',()=>assert.throws(()=>api.validateOwnedPublication({...tombstone,can_text:true},publication.public_id)));
check('tombstone must not invent published terms',()=>assert.throws(()=>api.validateOwnedPublication({...tombstone,terms:publication.terms},publication.public_id)));
const readiness={replica_id:publication.public_id,state:'ready',blockers:[],drafts:[],context_items:[],selected:{review_hash:'b'.repeat(64),source_name:'Long lesson.pdf',projection:{name:'Synthetic',subjectDomain:'physics'},material_text:'x'.repeat(8000),terms:publication.terms,material_excerpt:true,source_chars:12000,excerpt_start_char:0,excerpt_end_char:8000},statement_set:'account-material-publication/v1',statements:[],can_publish:true,publications:[]};
await checkAsync('owner readiness accepts an explicitly bounded long-source excerpt',async()=>{globalThis.__publicationApiFixture={readiness};assert.equal((await api.publicationReadiness('token',publication.public_id)).selected.material_excerpt,true);});
for(const [name,change]of [['missing full length',r=>delete r.selected.source_chars],['false excerpt marker',r=>r.selected.material_excerpt=false],['range mismatch',r=>r.selected.excerpt_end_char=7999],['hidden metadata on full source',r=>{delete r.selected.material_excerpt;r.selected.source_chars=12000;}]])
 await checkAsync(name+' excerpt response refused',async()=>{const value=structuredClone(readiness);change(value);globalThis.__publicationApiFixture={readiness:value};await assert.rejects(()=>api.publicationReadiness('token',publication.public_id));});
console.log(`${passed} actual client-boundary controls passed; no browser, SQL, auth or provider proof.`);
