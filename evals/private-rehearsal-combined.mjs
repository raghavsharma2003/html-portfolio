// Merge-specific controls, actual captured production SQL. Not SQL execution.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {capturePrimarySelectionSql} from './primary-selection-cas/capture.mjs';
import {splitSql} from '../db/migrations/apply.mjs';
import {decideMirrorDelta} from '../api/_mirrorcall-store.js';
globalThis.fetch=()=>{throw Error('network forbidden in merge controls');};
const root=new URL('../',import.meta.url),base='c56cadfe72a20ee02781485752d8d67fcfc6fb21';
const read=p=>readFileSync(new URL(p,root),'utf8').replaceAll('\r\n','\n');
// blobs from commit `base`, moved to committed fixtures
// (context/rejected.md#ci-shallow-checkout-starved-the-history-reading-suites).
const prior=p=>readFileSync(new URL(`evals/private-rehearsal-combined/fixtures/${base.slice(0,8)}/${p.replaceAll('/','__')}`,root),'utf8').replaceAll('\r\n','\n');
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
// WS-R166 (wave twenty-two) moved the recorder's user-visible strings into the
// personal studio's copy registry, so the control now freezes the PROPERTY it
// was written for: every line that carries no user-visible string (no quote,
// no copy-registry read) is byte-identical to the base, in the same order;
// only string-bearing lines may differ (context/rejected.md#frozen-file-merge-controls-break-on-the-next-change).
const logicLines=text=>text.split('\n').filter(l=>!/["'`]/.test(l)&&!/\bcopy\b|useStudioLocale/.test(l));
for(const name of ['ResonanceRecorder','voiceSagaKey','readVoiceSaga','storeVoiceSaga']){
 const get=tree=>tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)?.getText(tree);
 assert.ok(get(oldAst),name);assert.deepEqual(logicLines(get(nextAst)),logicLines(get(oldAst)),name);
}
assert.notEqual((()=>{const get=tree=>tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ResonanceRecorder')?.getText(tree);return get(nextAst)===get(oldAst);})(),undefined);
pass('actual recorder and persisted voice saga functions: every logic line byte-identical to21, only user-visible strings moved to the registry');
// WS-R159 (2026-09-13) reviewed and intentionally changed
// src/studio/QuickVoiceCapture.tsx: every literal English string moved into
// src/studio/copy.ts (t.quickVoiceCapture), zero logic/control-flow change
// -- proven separately and exhaustively by evals/quick-voice-capture and
// evals/studio-locale-personal (zero literal English JSX text remains, the
// component's own structural assertions in evals/quick-voice-capture
// updated to read copy.ts instead, the established
// evals/studio-locale/run.mjs pattern for a literal that moves file). Left
// out of this file-immutability list rather than silently broken by an
// unrelated, reviewed conversion.
// The physical capture leaves are byte-identical to the base EXCEPT the studio
// recorder's loopback MOCK microphone seam (`installLoopbackMockMicrophone`,
// test-only, `?mockMic=1`), which WS-R157 repaired after this control was
// frozen (context/rejected.md#ws-r157-loopback-mock-microphone-context-never-resumed):
// the control freezes the real capture path, never the mock, so that one
// function is cut from both sides before the comparison rather than the whole
// file being re-frozen (context/rejected.md#frozen-file-merge-controls-break-on-the-next-change).
const withoutMockSeam=text=>{const tree=ts.createSourceFile('wavCapture.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='installLoopbackMockMicrophone');assert.ok(fn,'installLoopbackMockMicrophone present');return text.slice(0,fn.getStart(tree))+text.slice(fn.end);};
for(const file of ['api/_replica-primary-selection.js','src/creatorStudio/wavCapture.ts','src/studio/VoiceEnrollmentLab.tsx'])assert.equal(read(file),prior(file),file);
assert.equal(withoutMockSeam(read('src/studio/wavCapture.ts')),withoutMockSeam(prior('src/studio/wavCapture.ts')),'src/studio/wavCapture.ts outside the mock microphone seam');
assert.notEqual(read('src/studio/wavCapture.ts'),prior('src/studio/wavCapture.ts'),'the mock seam did change (the cut is not vacuous)');
pass('primary selection and physical capture leaves unchanged');
const intentPath='api/_replica-build-intent.js';
const eligible="s.capture_mode in ('upload','import','derived')";
const excluded=" and s.purpose<>'comparison_reference'";
const incumbentIntent=prior(intentPath);
assert.equal(incumbentIntent.split(eligible).length-1,2);
// The control is the PROPERTY (every eligible clause carries the exclusion,
// at both entry points), not byte-equality to the historical file: the file
// has since gained the processing source-scope import (processing204) and
// will change again. A bare eligible clause anywhere is the omission mutant.
const verifyIntent=text=>{
 assert.equal(text.split(eligible+excluded).length-1,2,'both entry points exclude comparison-only references');
 assert.equal(text.split(eligible).length-1,2,'no eligible clause without the exclusion');
};
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
