// Source-authored controls; no test execution authorized during FULL45.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
}).outputText;
const uri = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transport = uri(compile('../src/studio/replicaApi.ts'));
const {readRuntimeStatus} = await import(uri(compile('../src/studio/runtimeApi.ts').replace('"./replicaApi"', JSON.stringify(transport))));
const rid='10000000-0000-4000-8000-000000000001',cap='10000000-0000-4000-8000-000000000002';
const legacy={replica_id:rid,active:true};
const privateBaseline={...legacy,private_selection:true,private_candidate:false,can_activate:false,
  exposure:'owner_private_text',capability_id:cap,blockers:[]};
let row=legacy;const original=globalThis.fetch;
try {
  globalThis.fetch=async()=>new Response(JSON.stringify({runtime:row}));
  for(const accepted of [legacy,privateBaseline,{...privateBaseline,private_candidate:true},
    {...privateBaseline,active:false,capability_id:null,blockers:['private_selection_unavailable']}]){
    row=accepted;assert.deepEqual(await readRuntimeStatus('synthetic',rid),accepted);
  }
  for(const patch of [{exposure:'public'},{capability_id:null},{capability_id:'bad'},
    {private_candidate:undefined},{private_selection:'true'},{blockers:'unavailable'},
    {blockers:['private_selection_unavailable']},{active:false,capability_id:cap}]){
    row={...privateBaseline,...patch};await assert.rejects(readRuntimeStatus('synthetic',rid),/could not be verified/);
  }
}finally{globalThis.fetch=original;}
console.log('Private runtime client: 4 accepted shapes and 8 refusal controls (synthetic transport only)');
