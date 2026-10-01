// Merge-specific controls, actual captured production SQL. Not SQL execution.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {capturePrimarySelectionSql,IDS} from './primary-selection-cas/capture.mjs';
import {splitSql} from '../db/migrations/apply.mjs';
import {decideMirrorDelta} from '../api/_mirrorcall-store.js';
import {reconcileVoiceBuildIntents} from '../api/_replica-build-intent.js';
import {assertProcessingSourceScope} from '../api/_replica-processing/source-scope.js';
globalThis.fetch=()=>{throw Error('network forbidden in merge controls');};
const root=new URL('../',import.meta.url),base='c56cadfe72a20ee02781485752d8d67fcfc6fb21';
const read=p=>readFileSync(new URL(p,root),'utf8').replaceAll('\r\n','\n');
const prior=p=>execFileSync('git',['show',`${base}:${p}`],{cwd:root,encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
let groups=0;const pass=name=>console.log(`ok ${++groups} - ${name}`);
const sql=await capturePrimarySelectionSql();
function bothEpochs(text){
 assert.equal((text.match(/update vy_replica r\b/g)||[]).length,1);
 assert.match(text,/private_text_epoch=r\.private_text_epoch\+1/);
 assert.match(text,/primary_selection_id=case/);
 assert.match(text,/where snapshot_current/);
 assert.match(text,/primary_selection_snapshot_stale/);
 assert.ok(text.indexOf('for update of s nowait')<text.indexOf('for update of r nowait'));
}
for(const name of ['withdraw','complete']){
 bothEpochs(sql[name].sql);
 assert.throws(()=>bothEpochs(sql[name].sql.replace('private_text_epoch=r.private_text_epoch+1,','')));
 assert.throws(()=>bothEpochs(sql[name].sql+' update vy_replica r set private_text_epoch=1'));
 pass(`${name}: primary CAS plus private epoch in one replica update, omission and duplicate-update mutants rejected`);
}
assert.match(sql.withdraw.sql,/delete from vy_private_text_rehearsal h using target t/);
assert.doesNotMatch(sql.complete.sql,/and \(e\.revoke_identity or e\.withdraw_primary\)/);
assert.match(sql.complete.sql,/\(select count\(\*\) from identity_replica\)>=0/);
pass('nonprimary source still invalidates private epoch; deletion depends on replica effects');
const schema=read('db/schema.sql');
assert.ok(schema.indexOf('-- 140:')<schema.indexOf('-- 141:'));
for(const file of ['140_primary_voice_selection_epoch.sql','141_private_text_rehearsal.sql'])for(const statement of splitSql(read('db/migrations/'+file))){
 const clean=text=>text.replace(/^--[^\n]*\n/gm,'').trim();assert.ok(clean(schema).includes(clean(statement)));
}
pass('both migrations mirrored in order without replacing140');
const ast=text=>ts.createSourceFile('CloneExperience.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const oldAst=ast(prior('src/studio/CloneExperience.tsx')),nextAst=ast(read('src/studio/CloneExperience.tsx'));
for(const name of ['ResonanceRecorder','voiceSagaKey','readVoiceSaga','storeVoiceSaga']){
 const get=tree=>tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)?.getText(tree);
 assert.ok(get(oldAst),name);assert.equal(get(nextAst),get(oldAst),name);
}
pass('actual recorder and persisted voice saga functions byte-identical to21');
for(const file of ['api/_replica-primary-selection.js','src/studio/wavCapture.ts','src/creatorStudio/wavCapture.ts','src/studio/QuickVoiceCapture.tsx','src/studio/VoiceEnrollmentLab.tsx'])assert.equal(read(file),prior(file),file);
pass('primary selection and physical capture leaves unchanged');
const intentPath='api/_replica-build-intent.js';
const eligible="s.capture_mode in ('upload','import','derived')";
const excluded=" and s.purpose<>'comparison_reference'";
const incumbentIntent=prior(intentPath);
assert.equal(incumbentIntent.split(eligible).length-1,2);
// b7a45f11 added the two comparison exclusions; f928c80c later approved
// source-scoped reconciliation. Preserve the historical implementation outside
// that import and the reconciler's scope/query declarations, which are executed
// below instead of freezing the whole file before the isolation improvement.
function intentParts(text){
 const tree=ts.createSourceFile(intentPath,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const isReconcile=n=>ts.isFunctionDeclaration(n)&&n.name?.text==='reconcileVoiceBuildIntents';
 const isScopeImport=n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='./_replica-processing/source-scope.js';
 const reconcile=tree.statements.find(isReconcile);assert.ok(reconcile?.body);
 const isScopeQuery=n=>ts.isVariableStatement(n)&&n.declarationList.declarations.length===1
  &&['sourceScope','rows'].includes(n.declarationList.declarations[0].name.getText(tree));
 return {
  stable:tree.statements.filter(n=>!isReconcile(n)&&!isScopeImport(n)).map(n=>n.getText(tree)),
  reconcileStable:reconcile.body.statements.filter(n=>!isScopeQuery(n)).map(n=>n.getText(tree)),
  reconcileSignature:text.slice(reconcile.getStart(tree),reconcile.body.getStart(tree)),
  scopeImports:tree.statements.filter(isScopeImport).map(n=>n.getText(tree)),
  reconcile:reconcile.getText(tree),
 };
}
const expectedIntent=intentParts(incumbentIntent.replaceAll(eligible,eligible+excluded));
const verifyIntent=text=>{
 const parts=intentParts(text);
 assert.deepEqual(parts.stable,expectedIntent.stable,'historical build-intent authority outside scoped reconciliation is preserved');
 assert.deepEqual(parts.reconcileStable,expectedIntent.reconcileStable,'reconciliation bounds, advancement and settlement are preserved');
 assert.equal(parts.reconcileSignature,expectedIntent.reconcileSignature,'historical reconciler signature is preserved');
 assert.deepEqual(parts.scopeImports,['import { assertProcessingSourceScope } from "./_replica-processing/source-scope.js";']);
};
const currentIntent=read(intentPath);verifyIntent(currentIntent);
for(const name of ['create','promote']) {
 assert.ok(sql[name]?.sql,`${name} production query captured`);
 assert.ok(sql[name].sql.includes(eligible+excluded),`${name} excludes comparison-only references`);
}
// Reject omission at either entry point independently, retaining the historical
// authority statements outside the separately checked scoped reconciliation.
for(const offset of [currentIntent.indexOf(excluded),currentIntent.lastIndexOf(excluded)]) {
 assert.ok(offset>=0);assert.throws(()=>verifyIntent(currentIntent.slice(0,offset)+currentIntent.slice(offset+excluded.length)));
}
pass('historical build-intent authority retains both comparison-reference exclusions; omission mutants rejected');
const sourceScope={ownerUserId:IDS.owner,replicaId:IDS.replica,sourceId:IDS.source};
// Evaluate only the actual declaration: there is no module entrypoint,
// database connection or provider. Captured SQL is not SQL execution proof.
const isolatedReconcile=text=>new Function('assertProcessingSourceScope',
 `${intentParts(text).reconcile.replace(/^export /,'')}\nreturn reconcileVoiceBuildIntents;`)(assertProcessingSourceScope);
const priorQueries=[];
await isolatedReconcile(incumbentIntent)(async(text,params)=>{priorQueries.push({text,params});return[];});
assert.equal(priorQueries.length,1);
const scopeFence='and ($2::uuid is null or (i.owner_user_id=$2::uuid and i.replica_id=$3::uuid and i.candidate_source_id=$4::uuid))';
const ordering='order by i.next_check_at,i.created_at limit $1::int4';
assert.equal(priorQueries[0].text.split(ordering).length-1,1);
const normalizeSql=text=>text.trim().replace(/\s+/g,' ');
const expectedScopedSql=normalizeSql(priorQueries[0].text.replace(ordering,`${scopeFence}\n${ordering}`));
async function verifyScopedReconcile(reconcile){
 for(const scope of [sourceScope,null])for(const [limit,expectedLimit] of [[undefined,12],[-5,1],[999,50]]){
  const calls=[];
  const result=await reconcile(async(text,params)=>{calls.push({text,params});return[];},{sourceScope:scope,limit});
  assert.equal(calls.length,1);
  assert.match(calls[0].text,/and \(\$2::uuid is null or \(i\.owner_user_id=\$2::uuid and i\.replica_id=\$3::uuid and i\.candidate_source_id=\$4::uuid\)\)/,'complete owner/replica/source SQL fence');
  assert.equal(normalizeSql(calls[0].text),expectedScopedSql,'all historical query guards and ordering are preserved');
  assert.deepEqual(calls[0].params,[expectedLimit,scope?.ownerUserId||null,scope?.replicaId||null,scope?.sourceId||null],'scope parameters preserve every identity and the bounded limit');
  assert.deepEqual(result,{examined:0,waiting:0,queued:0,review:0,failed:0});
 }
 for(const invalid of [{},{ownerUserId:IDS.owner},{...sourceScope,sourceId:'invalid'},{...sourceScope,extra:true},[]]){
  let calls=0;
  await assert.rejects(()=>reconcile(async()=>{calls++;return[];},{sourceScope:invalid}),/processing_source_scope_invalid/);
  assert.equal(calls,0,'invalid scope must fail before any database call');
 }
}
await verifyScopedReconcile(reconcileVoiceBuildIntents);
await verifyScopedReconcile(isolatedReconcile(currentIntent));
const reconcileSource=intentParts(currentIntent).reconcile;
const mutateReconcile=(before,after)=>{
 assert.equal(reconcileSource.split(before).length-1,1,'each mutation targets exactly one reconciler expression');
 return currentIntent.replace(reconcileSource,reconcileSource.replace(before,after));
};
const validation='assertProcessingSourceScope(options.sourceScope)';
await assert.rejects(()=>verifyScopedReconcile(isolatedReconcile(mutateReconcile(validation,'options.sourceScope || null'))),/Missing expected rejection/);
for(const [predicate,parameter] of [
 ['i.owner_user_id=$2::uuid','sourceScope?.ownerUserId || null'],
 ['i.replica_id=$3::uuid','sourceScope?.replicaId || null'],
 ['i.candidate_source_id=$4::uuid','sourceScope?.sourceId || null'],
]){
 await assert.rejects(()=>verifyScopedReconcile(isolatedReconcile(mutateReconcile(predicate,'true'))),/complete owner\/replica\/source SQL fence/);
 await assert.rejects(()=>verifyScopedReconcile(isolatedReconcile(mutateReconcile(parameter,'null'))),/scope parameters preserve/);
}
await assert.rejects(()=>verifyScopedReconcile(isolatedReconcile(mutateReconcile("r.subject_mode='self' and ",''))),/all historical query guards/);
await assert.rejects(()=>verifyScopedReconcile(isolatedReconcile(mutateReconcile(scopeFence,`${scopeFence} or true`))),/all historical query guards/);
pass('actual reconciler preserves historical guards, bounded exact scope and pre-query rejection; nine mutants rejected');
let mirrorSql='';
await decideMirrorDelta(async text=>{if(text.includes('), decided as ('))mirrorSql=text;return[];},
 '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','rejected');
const projection=text=>{
 const columns=text.match(/\), decided as \([\s\S]*?returning ([\s\S]*?)\n\s*\), audit as/)[1].split(',').map(s=>s.trim());
 assert.equal(columns.length,19);assert.ok(columns.every(s=>/^d\.[a-z_]+$/.test(s)));
 assert.ok(columns.includes('d.delta_id'));assert.ok(columns.includes('d.target_field'));
};
projection(mirrorSql);assert.throws(()=>projection(mirrorSql.replace('returning d.delta_id,','returning delta_id,')));
pass('actual Mirror decision returns only target-qualified columns; ambiguous projection mutant rejected');
console.log(`${groups} combined merge groups passed; no SQL/provider/browser execution.`);
