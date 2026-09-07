// Injected rows test actual encrypted helper behavior; separate real SQL harness.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { CURRENT_TURN_FEEDBACK_SQL as READ, readOwnedTurnFeedback as read, recordOwnedTurnFeedback as write } from '../api/_replica-feedback.js';
import { encryptTurnExemplar, exemplarTextHash, decryptTurnExemplar } from '../api/_replica-feedback-crypto.js';
const rid=randomUUID(),owner=randomUUID(),turn=randomUUID(),fid=randomUUID();
const env={REPLICA_FEEDBACK_KEK_ID:'synthetic-reopen-key',REPLICA_FEEDBACK_KEK_B64:Buffer.alloc(32,43).toString('base64')};
const input={replica_id:rid,turn_id:turn},wording='Synthetic saved statement';
const base={feedback_id:fid,replica_id:rid,owner_user_id:owner,turn_id:turn,revision:1,ratings:{wording:'off'},reason_codes:['wrong_wording'],correction_hash:exemplarTextHash(wording),created_at:'2026-09-07T00:00:00Z'};
const row={...base,...encryptTurnExemplar(wording,{feedback_id:fid,replica_id:rid,turn_id:turn,text_sha256:base.correction_hash},env)};
let checks=0;const ok=label=>console.log(`ok ${++checks} - ${label}`);
assert.equal((await read(async(sql,p)=>{assert.equal(sql,READ);assert.deepEqual(p.slice(0,3),[rid,owner,turn]);return [{feedback_id:null}];},owner,input,env)).feedback,null);
await assert.rejects(()=>read(async()=>[],owner,input,env),e=>e.code==='feedback_turn_not_available');ok('empty eligible turn differs from unavailable turn');
const current=await read(async()=>[row],owner,input,env);assert.equal(current.correction,wording);assert.deepEqual(current.feedback.ratings,{wording:'off'});assert(!JSON.stringify(current).includes('ciphertext'));ok('current decryption returns only scoped client fields');
await assert.rejects(()=>read(async()=>[{...row,aad_sha256:'a'.repeat(64)}],owner,input,env),e=>e.code==='feedback_exemplar_binding_invalid');
await assert.rejects(()=>read(async()=>[row],owner,input,{}),e=>e.code==='feedback_encryption_key_id_required');ok('invalid envelope and missing key fail visibly');
const mutations=[];const db=async(sql,p)=>{if(sql===READ)return [row];mutations.push({sql,p});return [{...row,feedback_id:p[3],revision:2,ratings:JSON.parse(p[4]),reason_codes:p[6],correction_hash:p[7],exemplar_written:!!p[7]}];};
await write(db,owner,{...input,ratings:{wording:'close'},expected_revision:1},env);
const mutation=mutations.at(-1),p=mutation.p;assert(!p.includes(wording));assert.equal(p[19],1);assert.match(mutation.sql,/coalesce\(p.revision,0\)=\$20::integer/);assert.match(mutation.sql,/on conflict \(turn_id,revision\) do nothing/);
assert.equal(decryptTurnExemplar({algorithm:p[10],key_id:p[11],nonce_b64:p[12],ciphertext_b64:p[13],auth_tag_b64:p[14],aad_sha256:p[15],wrapped_dek_b64:p[16],wrap_nonce_b64:p[17],wrap_auth_tag_b64:p[18]},{feedback_id:p[3],replica_id:rid,turn_id:turn,text_sha256:p[7]},env),wording);ok('absent wording re-encrypts retained statement with revision CAS');
await write(db,owner,{...input,ratings:{overall:'exact'},expected_revision:1,clear_correction:true},env);assert.equal(mutations.at(-1).p[7],null);
for(const extra of [{correction:''},{correction:'replacement',clear_correction:true},{clear_correction:'yes'}])await assert.rejects(()=>write(db,owner,{...input,ratings:{wording:'off'},expected_revision:1,...extra},env));ok('clear is distinct from absence and ambiguous actions');
const before=mutations.length;for(const extra of [{},{expected_revision:0},{expected_revision:2},{expected_revision:-1}])await assert.rejects(()=>write(db,owner,{...input,ratings:{wording:'off'},...extra},env));assert.equal(mutations.length,before);ok('unreviewed and stale revisions never mutate');
let reads=0;await assert.rejects(()=>write(async sql=>sql===READ?[++reads===1?row:{...row,revision:2}]:[],owner,{...input,ratings:{wording:'off'},expected_revision:1},env),e=>e.code==='feedback_revision_conflict');ok('mutation conflict checks current revision without retry');
const hook=registerHooks({load(url,context,next){
 if(url===new URL('../api/_db.js',import.meta.url).href)return {format:'module',shortCircuit:true,source:'export const q=(...args)=>globalThis.__feedbackTestDb(...args)'};
 if(url===new URL('../api/_auth.js',import.meta.url).href)return {format:'module',shortCircuit:true,source:"export class AuthError extends Error{};export async function requireUser(req){if(!req.headers?.authorization)throw Object.assign(new AuthError(),{status:401,code:'auth_required'});return {id:globalThis.__feedbackTestOwner}}"};
 if(url===new URL('../api/_ratelimit.js',import.meta.url).href)return {format:'module',shortCircuit:true,source:"export const allow=()=>true;export const ipOf=()=> 'synthetic'"};return next(url,context);
}});
let handler;try{handler=(await import('../api/replica-feedback.js')).default;}finally{hook.deregister();}
globalThis.__feedbackTestOwner=owner;let routeReads=0;globalThis.__feedbackTestDb=async(sql,p)=>{routeReads++;assert.equal(sql,READ);assert.equal(p[1],owner);return [{feedback_id:null}];};
async function route(req){const response={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},end(){return this;}};await handler(req,response);return response;}
assert.equal((await route({method:'GET',query:input})).statusCode,401);assert.equal(routeReads,0);
const response=await route({method:'GET',headers:{authorization:'Bearer synthetic'},query:{...input,owner_user_id:randomUUID()}});assert.equal(response.statusCode,200);assert.equal(response.headers['Cache-Control'],'no-store');assert.equal(response.body.current.feedback,null);ok('actual GET derives owner from authentication and refuses unauthenticated reads');
assert.equal((await route({method:'DELETE',query:input})).statusCode,405);assert.equal((await route({method:'OPTIONS'})).statusCode,204);ok('route method boundary and no-store headers remain explicit');
delete globalThis.__feedbackTestDb;delete globalThis.__feedbackTestOwner;
console.log(`${checks} feedback reopen checks passed`);
