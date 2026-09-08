import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const src=read('src/studio/StudioApp.tsx'),clone=read('src/studio/CloneExperience.tsx');
const ast=text=>ts.createSourceFile('actual.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function find(text,name,callback=false){const tree=ast(text);let result;function visit(n){if(callback&&ts.isVariableDeclaration(n)&&n.name.getText(tree)===name)result=n.initializer.arguments[0].getText(tree);else if(!callback&&ts.isFunctionDeclaration(n)&&n.name?.text===name)result=n.getText(tree);ts.forEachChild(n,visit);}visit(tree);assert(result,name);return result;}
function compile(text,context){runInNewContext(ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);return context;}
let checks=0;const ok=()=>checks++;
const owner={userId:'owner',accessToken:'old'},fresh={userId:'owner',accessToken:'fresh'};
for(const method of ['loadReplicas','selectReplica'])for(const mutant of [false,true]){
 let active=owner,states=[];const activeSessionRef={current:owner};const scope={accountRevision:{current:1},activeSessionRef,activeSession:owner,session:owner,replicaLoadRevision:{current:0},setLoadState:s=>states.push(s),setError:()=>{},setShowCreate:()=>{},isCurrentSession:s=>s===active,refreshForRequest:async()=>{active=fresh;activeSessionRef.current=fresh;return fresh;},listReplicas:async()=>{throw Error('fixture_read_failed');},readReplica:async()=>{throw Error('fixture_read_failed');},handleApiError:()=>{},authResumeContext:{current:{}},replicas:[],step:'feed'};
 let code=find(src,method,method==='loadReplicas');if(mutant)code=code.replaceAll('if (!ownsRead()) return;',`if (!isCurrentSession(${method==='loadReplicas'?'activeSession':'session'}) || !ownsRead()) return;`);
 compile(method==='loadReplicas'?`globalThis.run=${code};`:`${code};globalThis.run=${method};`,scope);
 await scope.run(method==='loadReplicas'?owner:'replica');assert.equal(states.at(-1),mutant?'loading':'error');ok();
}
for(const mounted of [false,true])for(const mutant of [false,true]){
 let release;const pending=new Promise(resolve=>release=resolve);const writes=[];let code=find(clone,'continueAgreement');if(mutant)code=code.replace('reissueMounted.current && ','');
 const props={identity:'owner',accessToken:'token',selected:{replica_id:'replica'}};
 const scope={...props,accountScope:undefined,creatingNew:true,agreementLockedRef:{current:false},reissueMounted:{current:mounted},reissueCurrent:{current:props},revealSoundRef:{current:null},createBrandRevealSoundSession:()=>null,revealMuted:true,reduceMotion:true,setAgreementBusy:()=>{},setAgreementError:()=>{},onBeginClone:()=>pending,onGrantConsent:async()=>{},firstSourceAgreement:{current:null},routeFocus:{current:null},document:{activeElement:null},setEnrichView:()=>{},setRoom:()=>{},setReveal:()=>{},REVEAL_KEY:'fixture-reveal',URLSearchParams,window:{location:{search:'?replica=replica'},sessionStorage:{setItem:()=>writes.push('receipt')},history:{replaceState:()=>writes.push('history')}}};
 compile(code+';globalThis.run=continueAgreement;',scope);const task=scope.run();release(props.selected);await task;assert.deepEqual(writes,mounted||mutant?['history']:[]);ok();
}
// A successful owner-scoped refresh may finish; sign-out/re-entry may not.
for(const changedAccount of [false,true]) {
 let release;const pending=new Promise(resolve=>release=resolve);const writes=[];const props={identity:'owner',accessToken:'fresh',accountScope:changedAccount?'owner:3':'owner:1',selected:{replica_id:'replica'}};
 const scope={identity:'owner',accessToken:'old',accountScope:'owner:1',selected:props.selected,creatingNew:true,agreementLockedRef:{current:false},reissueMounted:{current:true},reissueCurrent:{current:props},revealSoundRef:{current:null},createBrandRevealSoundSession:()=>null,revealMuted:true,reduceMotion:true,setAgreementBusy:()=>{},setAgreementError:()=>{},onBeginClone:()=>pending,onGrantConsent:async()=>{},firstSourceAgreement:{current:null},routeFocus:{current:null},document:{activeElement:null},setEnrichView:()=>{},setRoom:()=>{},setReveal:()=>{},REVEAL_KEY:'fixture',URLSearchParams,window:{location:{search:'?replica=replica'},sessionStorage:{setItem:()=>writes.push('receipt')},history:{replaceState:()=>writes.push('history')}}};
 compile(find(clone,'continueAgreement')+';globalThis.run=continueAgreement;',scope);const task=scope.run();release(props.selected);await task;assert.deepEqual(writes,changedAccount?[]:['history']);ok();
}
for(const mutant of [false,true]) {
 let reject;const pending=new Promise((_,no)=>reject=no);let current=true;const errors=[];const scope={activeSessionRef:{current:owner},creationRevision:{current:0},setLoadState:()=>{},session:owner,replicas:[],selectedIdRef:{current:null},accountRevision:{current:1},setCreating:()=>{},setError:()=>{},refreshForRequest:async()=>owner,createReplica:()=>pending,durableCreationIntent:()=> 'intent',isCurrentSession:()=>current,handleApiError:e=>errors.push(e.message)};
 let code=find(src,'handleBeginClone');if(mutant)code=code.replace('if (ownsCreation() && selectedIdRef.current === requestReplicaId) {','if (true) {').replace('if (isCurrentSession(requestSession)) handleApiError','handleApiError');compile(code+';globalThis.run=handleBeginClone;',scope);const task=scope.run();await Promise.resolve();current=false;scope.accountRevision.current=3;reject(Error('old_401'));await assert.rejects(task,/old_401/);assert.equal(errors.length,mutant?1:0);ok();
}
// Same credentials after sign-out/re-entry still belong to another account generation.
for(const mutant of [false,true]) {
 let release;const pending=new Promise(resolve=>release=resolve);const selected=[];const scope={activeSessionRef:{current:owner},creationRevision:{current:0},setLoadState:()=>{},session:owner,replicas:[],selectedIdRef:{current:null},accountRevision:{current:1},replicaLoadRevision:{current:0},setCreating:()=>{},setError:()=>{},setNotice:()=>{},setSources:()=>{},setRuntimeStatus:()=>{},setActivityView:()=>{},setShowCreate:()=>{},setReplicas:()=>{},setSelected:v=>selected.push(v),refreshForRequest:async()=>owner,createReplica:()=>pending,durableCreationIntent:()=> 'intent',clearCreationIntent:()=>{},isCurrentSession:()=>true,handleApiError:()=>{},queryForReplica:()=>'?replica=replica',queryForStep:()=>'',window:{location:{search:''},history:{replaceState:()=>{}}},beginConsentMutation:()=>1,settleConsentMutation:()=>true,grantEnrollmentConsent:async()=>[]};
 let code=find(src,'handleBeginClone');if(mutant)code=code.replace('accountRevision.current !== operationAccount || ','');compile(code+';globalThis.run=handleBeginClone;',scope);const task=scope.run();await Promise.resolve();scope.accountRevision.current=3;release({replica_id:'replica'});if(mutant)await task;else await assert.rejects(task,/workspace changed/);assert.equal(selected.length,mutant?1:0);ok();
}
// Exact actual mutation settlement refuses other actors/replicas and stale revisions.
for(const refusal of ['none','actor','replica','revision']){
 const results=[];const scope={isCurrentSession:()=>refusal!=='actor',selectedIdRef:{current:refusal==='replica'?'other':'replica'},consentRevision:{current:refusal==='revision'?3:2},consentMutation:{current:'scope'},consentScope:()=> 'scope',setConsents:v=>results.push(v),setConsentRead:()=>{}};
 compile(find(src,'settleConsentMutation')+';globalThis.run=settleConsentMutation;',scope);assert.equal(scope.run(fresh,'replica',2,[]),refusal==='none');assert.equal(results.length,refusal==='none'?1:0);ok();
}
console.log(`${checks} actual function controls passed: refresh failure, old spinner predicates, mounted/unmounted continuation and old global-history negative, receipt scope/revision`);
