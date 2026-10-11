// Execute the actual SQL-over-HTTP q with native Response objects. No database.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';

const configUrl=new URL('../../api/_config.js',import.meta.url).href;
const priorUrl=new URL('../../api/_db-sqlstate-prior.js',import.meta.url).href;
const priorSource=readFileSync(new URL('./prior-db.js.txt',import.meta.url),'utf8');
const syntheticConnection='postgres://synthetic:synthetic@neon.invalid/synthetic';
const previousUrl=process.env.NEON_URL,previousFetch=globalThis.fetch;
let responseFactory,fetches=0,checks=0;
const ok=name=>console.log(`ok ${++checks} - ${name}`);
const hooks=registerHooks({
 resolve(specifier,context,next){
  if(specifier==='virtual:db-sqlstate-prior')return {url:priorUrl,shortCircuit:true};
  if(specifier==='./_config.js'&&new URL(specifier,context.parentURL).href===configUrl)return {url:configUrl,shortCircuit:true};
  return next(specifier,context);
 },
 load(url,context,next){
  if(url===configUrl)return {format:'module',shortCircuit:true,source:`export const NEON_URL=${JSON.stringify(syntheticConnection)};`};
  if(url===priorUrl)return {format:'module',shortCircuit:true,source:priorSource};
  return next(url,context);
 }
});
process.env.NEON_URL=syntheticConnection;
globalThis.fetch=async(url,init)=>{
 fetches++;
 assert.equal(url,'https://neon.invalid/sql');assert.equal(init.method,'POST');
 assert.equal(init.headers['Neon-Connection-String'],syntheticConnection);
 assert.equal(init.headers['Content-Type'],'application/json');
 assert.deepEqual(JSON.parse(init.body),{query:'select $1::text',params:['synthetic private parameter']});
 assert(init.signal instanceof AbortSignal);
 assert.equal(typeof responseFactory,'function','unexpected transport dispatch');
 return responseFactory();
};
try{
 const {q}=await import('../../api/_db.js');
 const {q:priorQ}=await import('virtual:db-sqlstate-prior');
 const query=driver=>driver('select $1::text',['synthetic private parameter'],900);
 async function rejected(driver){try{await query(driver);assert.fail('query should fail');}catch(error){assert(error instanceof Error);return error;}}
 const jsonError=(body,status=400)=>()=>Response.json(body,{status});
 async function compare(factory,expectedCode){
  responseFactory=factory;
  const prior=await rejected(priorQ),current=await rejected(q);
  assert.equal(current.message,prior.message,'message prefix and suffix remain byte-identical');
  assert.equal(current.code,expectedCode);
  assert.equal(Object.hasOwn(current,'code'),expectedCode!==undefined);
  assert.equal(current.status,undefined);assert.equal(current.statusCode,undefined);
  assert.deepEqual(Object.keys(current),expectedCode===undefined?[]:['code']);
  assert(!current.message.includes('synthetic private parameter'));
  return {prior,current};
 }
 const duplicate=await compare(jsonError({code:'23505',message:'duplicate key',detail:'synthetic private parameter',query:'select private',params:['synthetic private parameter']}),'23505');
 assert.equal(duplicate.current.message,'neon 400: 23505 duplicate key');assert.equal(duplicate.prior.code,undefined);ok('actual q attaches23505; retained source lacks code and message remains exact');
 responseFactory=jsonError({code:'23505',message:'duplicate key'});
 const duplicateCaller=async driver=>{try{await query(driver);}catch(error){if(error.code==='23505')return 'read_existing';throw error;}};
 assert.equal(await duplicateCaller(q),'read_existing');await assert.rejects(()=>duplicateCaller(priorQ),error=>error.code===undefined&&error.message==='neon 400: 23505 duplicate key');ok('existing exact-code duplicate recovery becomes reachable; old source fails');
 await compare(jsonError({code:'42702',message:'column reference is ambiguous'}),'42702');ok('42702 stays a database failure without user-facing HTTP400 mapping');
 await compare(jsonError({code:'22P02',message:'invalid input syntax'}),'22P02');ok('uppercase alphanumeric SQLSTATE is retained');
 for(const code of ['2350','235050','23505\n',' 23505','23505 ','22p02','２３５０５',23505,null,{},['23505']])await compare(jsonError({code,message:'synthetic provider failure'}),undefined);
 ok('eleven malformed code representations never become error.code');
 for(const body of [{message:'23505 duplicate key'},{error:{code:'23505',message:'nested'}},null,[],42,'23505'])await compare(jsonError(body),undefined);
 ok('message text, nested fields and non-object JSON do not supply SQLSTATE');
 for(const body of ['', '<html>23505</html>', '{"code":"23505"', '23505 is not JSON'])await compare(()=>new Response(body,{status:502}),undefined);
 ok('empty and malformed response bodies retain the original status-only message');
 const unreadable=()=>new Response(new ReadableStream({start(controller){controller.error(new Error('synthetic body read failure'));}}),{status:503});
 const bodyFailure=await compare(unreadable,undefined);assert.equal(bodyFailure.current.message,'neon 503');ok('native Response body-read failure cannot mask HTTP status');
 const codeOnly=await compare(jsonError({code:'23505'}),'23505');assert.equal(codeOnly.current.message,'neon 400: 23505');ok('code-only suffix remains compatible');
 responseFactory=()=>Response.json({rows:[{answer:'synthetic success'}]});assert.deepEqual(await query(q),[{answer:'synthetic success'}]);
 responseFactory=()=>Response.json({code:'23505'});assert.deepEqual(await query(q),[]);ok('successful rows and existing empty-row behavior are unchanged');
 responseFactory=()=>new Response('{malformed',{status:200});await assert.rejects(()=>query(q),SyntaxError);ok('malformed successful JSON still rejects');
 const transportFailure=new Error('synthetic transport says23505');responseFactory=()=>{throw transportFailure;};await assert.rejects(()=>query(q),error=>error===transportFailure&&!Object.hasOwn(error,'code'));ok('transport failures propagate unchanged without guessing a code');
 console.log(`PASS ${checks} actual-q groups; ${fetches} synthetic fetches; zero network/database calls`);
}finally{
 hooks.deregister();globalThis.fetch=previousFetch;
 if(previousUrl===undefined)delete process.env.NEON_URL;else process.env.NEON_URL=previousUrl;
}
