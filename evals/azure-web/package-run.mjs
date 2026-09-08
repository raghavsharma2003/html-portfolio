import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { prepareContext,verifyContext,assembleRuntime,walk,sha } from '../../services/azure-web/package.mjs';
const root=resolve(import.meta.dirname,'../..'),temp=mkdtempSync(join(tmpdir(),'vyakti-package33-'));
let checks=0;
const test=(name,fn)=>{fn();checks++;console.log(`ok package ${checks} ${name}`);};
try{
 const prepared=join(temp,'context'),out=join(temp,'runtime');
 let context;
 test('actual source allowlist prepares and verifies without npm or build',()=>{context=prepareContext(root,prepared);assert.equal(verifyContext(prepared).release.source_commitment,context.release.source_commitment);});
 test('context includes bootstrap and transitive publication helpers',()=>{for(const p of ['services/azure-web/server.mjs','services/azure-web/Dockerfile','scripts/check-copy.mjs','scripts/roomsVocabAllowlist.mjs','scripts/copy-room-scope.mjs','evals/dbattery/prosody-baseline-log.json'])assert(context.files.some(f=>f.path===p),p);});
 test('local secrets private data and weights absent from context',()=>{assert(!context.files.some(f=>/(?:^|\/)(?:_config\.js|scratchpad|\.env)/.test(f.path)));assert(!context.files.some(f=>/\.(?:wav|mp3|m4a|pem|key|pt|safetensors)$/.test(f.path)));});
 test('existing output never overwritten',()=>assert.throws(()=>prepareContext(root,prepared),/must_be_new/));
 test('extra context secret file refuses verification',()=>{const p=join(prepared,'.env');writeFileSync(p,'synthetic_only');try{assert.throws(()=>verifyContext(prepared),/extra_or_missing/);}finally{rmSync(p);}});
 test('source mutation refuses verification',()=>{const p=join(prepared,'package.json'),before=readFileSync(p);writeFileSync(p,Buffer.concat([before,Buffer.from(' ')]));try{assert.throws(()=>verifyContext(prepared),/changed/);}finally{writeFileSync(p,before);}});
 // Synthetic dist is intentionally not a production build. It tests the real
 // final-stage copier against the actual API source and explicit data closure.
 mkdirSync(join(prepared,'dist'));for(const [p,b]of Object.entries({'index.html':'Vyakti','studio.html':'Studio','room.html':'Room','vyakti-release.json':JSON.stringify(context.release),'studio-layout-fixture.html':'never public','private.json':'never public'}))writeFileSync(join(prepared,'dist',p),b);
 writeFileSync(join(prepared,'api/_config.js'),'synthetic private runtime exclusion');
 let manifest;
 test('final assembly excludes inert config and fixture assets',()=>{manifest=assembleRuntime(prepared,out,context.release);assert(!existsSync(join(out,'api/_config.js')));assert(!existsSync(join(out,'dist/studio-layout-fixture.html')));assert(!existsSync(join(out,'dist/private.json')));});
 test('every copied runtime source and asset hash is committed',()=>{for(const f of manifest.runtimeFiles)assert.equal(sha(readFileSync(join(out,f.path))),f.sha256);for(const f of manifest.assets)assert.equal(sha(readFileSync(join(out,'dist',f.path))),f.sha256);});
 test('only explicit private prosody data survives eval exclusion',()=>assert.deepEqual(walk(join(out,'evals')),['dbattery/prosody-baseline-log.json']));
 test('final runtime has no development server source or Docker build input',()=>{for(const p of ['services/azure-web/Dockerfile','services/azure-web/build.mjs','scripts/dev-expert.mjs','src','context','scratchpad'])assert(!existsSync(join(out,p)),p);});
 test('Dockerfile is pinned secret-free and does not invoke local Docker',()=>{const source=readFileSync(join(root,'services/azure-web/Dockerfile'),'utf8');assert.equal((source.match(/FROM node:[^\n]+@sha256:[0-9a-f]{64}/g)||[]).length,2);assert(!/ARG .*?(?:KEY|SECRET|TOKEN)/.test(source));assert.match(source,/USER node/);assert.match(source,/test ! -e \/app\/api\/_config.js/);});
 test('entrypoint explicitly requires product Azure serving and database identity',()=>{const source=readFileSync(join(root,'services/azure-web/entrypoint.mjs'),'utf8');for(const token of ['STUDIO_ROOT','VYAKTI_MODEL_SERVING','VYAKTI_REPLY_PROVIDER','VYAKTI_DATABASE_NAME','current_database()','createAzureOnlyFetch'])assert(source.includes(token));assert(!source.includes("from 'vite'"));});
}finally{assert.equal(resolve(temp),temp);assert(temp.startsWith(join(tmpdir(),'vyakti-package33-')));rmSync(temp,{recursive:true,force:true});}
console.log(`azure web packaging: ${checks} groups passed; source copy and synthetic dist only; no container build or deployment`);
