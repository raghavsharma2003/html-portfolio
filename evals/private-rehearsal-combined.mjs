// Merge-specific controls, actual captured production SQL. Not SQL execution.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {capturePrimarySelectionSql} from './primary-selection-cas/capture.mjs';
import {splitSql} from '../db/migrations/apply.mjs';
import {decideMirrorDelta} from '../api/_mirrorcall-store.js';
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
const verifyIntent=text=>assert.equal(text,incumbentIntent.replaceAll(eligible,eligible+excluded));
const currentIntent=read(intentPath);verifyIntent(currentIntent);
for(const name of ['create','promote']) {
 assert.ok(sql[name]?.sql,`${name} production query captured`);
 assert.ok(sql[name].sql.includes(eligible+excluded),`${name} excludes comparison-only references`);
}
// Reject omission at either entry point independently, retaining every other
// byte of the incumbent build-intent implementation.
for(const offset of [currentIntent.indexOf(excluded),currentIntent.lastIndexOf(excluded)]) {
 assert.ok(offset>=0);assert.throws(()=>verifyIntent(currentIntent.slice(0,offset)+currentIntent.slice(offset+excluded.length)));
}
pass('build intent only adds comparison-reference exclusions at creation and promotion; both omission mutants rejected');
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
