import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const current=readFileSync(join(root,'scripts/check-copy.mjs'),'utf8');
const prior=readFileSync(new URL('./prior-check-copy.mjs.txt',import.meta.url),'utf8');
const dir=mkdtempSync(join(tmpdir(),'copy-gate-portable-'));
const fixture=join(dir,'space # percent % हिन्दी');
let groups=0;const pass=name=>console.log(`ok ${++groups} - ${name}`);
function run(args,cwd=fixture){const r=spawnSync(process.execPath,args,{cwd,encoding:'utf8',windowsHide:true,timeout:20000});if(r.error)throw r.error;return {...r,output:r.stdout+r.stderr};}
try{
 const scanner=text=>text.slice(text.indexOf('const RULES ='),text.indexOf('/* ═══ 5.')).replaceAll('\r\n','\n');
 assert.equal(scanner(current),scanner(prior));
 assert.match(current,/const ROOT = fileURLToPath/);assert.match(current,/process\.argv\[1\] && import\.meta\.url === pathToFileURL/);
 pass('original rule definitions and scanner bytes unchanged; portable root and guarded entry retained');
 for(const part of ['scripts','src/studio','src/creatorStudio','src/room','src/gurukul','src/replica','site','src/components'])mkdirSync(join(fixture,part),{recursive:true});
 for(const part of ['studio.html','room.html'])writeFileSync(join(fixture,part),'<p>Your AI</p>');
 writeFileSync(join(fixture,'scripts/check-copy.mjs'),current);
 writeFileSync(join(fixture,'scripts/prior-check-copy.mjs'),prior);
 writeFileSync(join(fixture,'scripts/roomsVocabAllowlist.mjs'),readFileSync(join(root,'scripts/roomsVocabAllowlist.mjs')));
 writeFileSync(join(fixture,'scripts/copy-room-scope.mjs'),readFileSync(join(root,'scripts/copy-room-scope.mjs')));
 const clean=run(['scripts/check-copy.mjs']);assert.equal(clean.status,0,clean.output);assert.match(clean.output,/scopes clean, 21 negative controls bit/);
 pass('relative CLI runs full scanner and21negative controls through encoded characters in real filesystem path');
 const absolute=run([join(fixture,'scripts/check-copy.mjs')],dir);assert.equal(absolute.status,0,absolute.output);assert.equal(absolute.output,clean.output);
 pass('absolute CLI from unrelated cwd scans its own root');
 const imported=run(['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(join(fixture,'scripts/check-copy.mjs')).href)}); console.log('import-only');`]);
 assert.equal(imported.status,0,imported.output);assert.equal(imported.stdout.trim(),'import-only');
 pass('import without argv target does not run gate or throw');
 writeFileSync(join(fixture,'src/studio/Invalid.tsx'),'export const Invalid = () => <p>A lesson — privately</p>;');
 const bad=run(['scripts/check-copy.mjs']);assert.equal(bad.status,1);assert.match(bad.output,/\[dash\]/);assert.match(bad.output,/src\/studio\/Invalid.tsx/);assert.doesNotMatch(bad.output,/ENOENT/);
 pass('actual CLI exits1 on a real fixture violation without a filesystem error');
 const old=run(['scripts/prior-check-copy.mjs']);
 if(process.platform==='win32'){assert.equal(old.status,0);assert.equal(old.output,'');pass('retained old CLI exits0 silently on Windows despite the same violation');}
 else {assert.notEqual(old.status,0);assert.match(old.output,/ENOENT/);pass('retained old CLI fails encoded filesystem root before scanning');}
 writeFileSync(join(fixture,'scripts/forced-prior.mjs'),prior.replace('if (import.meta.url === `file://${process.argv[1]}`) {','if (true) {'));
 const forced=run(['scripts/forced-prior.mjs']);assert.notEqual(forced.status,0);assert.match(forced.output,/ENOENT/);assert.doesNotMatch(forced.output,/\[dash\]/);
 pass('old entry forced open still fails pathname filesystem conversion; no false scan acceptance');
 writeFileSync(join(fixture,'src/studio/Invalid.tsx'),'export const Valid = () => <p>Your clone</p>;');
 writeFileSync(join(fixture,'src/room/Invalid.tsx'),'export const Invalid = () => <p>Your clone</p>;');
 const vocab=run(['scripts/check-copy.mjs']);assert.equal(vocab.status,1);assert.match(vocab.output,/\[rooms-vocabulary\]/);
 pass('existing vocabulary rule still rejects a real visible fixture');
 writeFileSync(join(fixture,'src/room/Invalid.tsx'),'export const Valid = () => <p>Your AI</p>;');
 assert.equal(run(['scripts/check-copy.mjs']).status,0);
 pass('removing actual fixture violation restores a passing gate');
}finally{
 const target=realpathSync(dir);assert.equal(dirname(target),realpathSync(tmpdir()));assert.ok(basename(target).startsWith('copy-gate-portable-'));rmSync(target,{recursive:true,force:true});
}
console.log(`PASS ${groups} actual process/filesystem groups; no browser/database/provider calls`);
