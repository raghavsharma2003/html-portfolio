import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const root=new URL('../../',import.meta.url),source=readFileSync(new URL('src/studio/StudioApp.tsx',root),'utf8');
const old=JSON.parse(readFileSync(new URL('evals/first-use-private-flow/fixtures/pending-refresh-old.json',root),'utf8'));
const tree=ts.createSourceFile('actual.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),current={};
function visit(n){const name=ts.isVariableDeclaration(n)?n.name.getText(tree):ts.isFunctionDeclaration(n)?n.name?.text:null;if(old.functions[name])current[name]=n.getText(tree);ts.forEachChild(n,visit);}visit(tree);
let checks=0;
for(const method of ['loadReplicas','selectReplica','handleBeginClone'])for(const outcome of ['success','error'])for(const change of ['refresh','account','operation'])for(const variant of change==='refresh'?['old','current']:['current']){
 let started;const began=new Promise(yes=>started=yes);let resolve,reject;const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});const owner={userId:'owner',accessToken:'old'},fresh={userId:'owner',accessToken:'fresh'},states=[],busy=[],errors=[],adopted=[];
 const scope={useCallback:fn=>fn,session:owner,activeSessionRef:{current:owner},accountRevision:{current:1},replicaLoadRevision:{current:0},creationRevision:{current:0},selectedIdRef:{current:null},replicas:[],authResumeContext:{current:{}},step:'feed',setLoadState:s=>states.push(s),setCreating:s=>busy.push(s),setError:()=>{},setShowCreate:()=>{},refreshForRequest:async()=>owner,listReplicas:()=>{started();return pending;},readReplica:()=>{started();return pending;},createReplica:()=>{started();return pending;},durableCreationIntent:()=> 'intent',handleApiError:e=>errors.push(e.message),setSelected:r=>adopted.push(r)};
 scope.isCurrentSession=s=>scope.activeSessionRef.current.userId===s.userId&&scope.activeSessionRef.current.accessToken===s.accessToken;
 let code=(variant==='old'?old.functions:current)[method];if(method==='loadReplicas')code='const '+code+';';runInNewContext(ts.transpileModule(code+';globalThis.run='+method+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,scope);
 const task=scope.run(method==='loadReplicas'?owner:method==='selectReplica'?'replica':undefined);await began;states.length=0;busy.length=0;
 scope.activeSessionRef.current=change==='account'?{userId:'other',accessToken:'other'}:fresh;if(change==='account')scope.accountRevision.current++;if(change==='operation'){scope.replicaLoadRevision.current++;scope.creationRevision.current++;}
 if(outcome==='error')reject(Object.assign(Error('old_token_rejected'),{status:401}));else resolve(method==='loadReplicas'?[{replica_id:'old'}]:{replica_id:'old'});
 if(method==='handleBeginClone')await assert.rejects(task);else await task;
 assert.deepEqual(adopted,[]);assert.deepEqual(errors,[],'old-token failures never sign out refreshed/current account');
 if(variant==='current'&&change==='refresh'){assert.deepEqual(states,['error']);assert.deepEqual(busy,method==='handleBeginClone'?[false]:[]);}else{assert.deepEqual(states,[]);assert.deepEqual(busy,[]);}
 checks++;
}
console.log(`${checks} actual deferred-operation controls passed: exact old/current create/list/select refresh settlement, account and newer-operation refusal; no payload adoption or auth side effects`);
