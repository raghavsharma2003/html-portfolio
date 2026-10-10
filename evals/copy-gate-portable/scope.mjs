import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {scanScopedSource,scanSource} from '../../scripts/check-copy.mjs';
import {ROOM_VOCAB_PATH,ROOM_COPY_SECTIONS,roomCopySectionSource} from '../../scripts/copy-room-scope.mjs';
const root=new URL('../../',import.meta.url),read=path=>readFileSync(new URL(path,root),'utf8');
let groups=0;const pass=name=>console.log(`ok ${++groups} - ${name}`);
const opts={rules:'full',codename:true};
for(const path of ['src/room/AccountPage.tsx','src/creatorStudio/RoomStudio.tsx','src/studio/RoomStudio.tsx','site/vyakti.html','site/creators.html','site/suites.html','room.html']){
 assert.ok(ROOM_VOCAB_PATH.test(path));assert.ok((await scanScopedSource(path,'const x = <p>Your clone</p>;',opts)).some(h=>h.rule==='rooms-vocabulary'),path);
}
pass('Room recipient, dedicated publishing components and public distribution pages retain vocabulary rule');
for(const path of ['src/studio/CloneExperience.tsx','src/creatorStudio/VoicePreviewLab.tsx','studio.html']){
 assert.ok(!ROOM_VOCAB_PATH.test(path));assert.deepEqual(await scanScopedSource(path,'const x = <p>Your clone and voice model</p>;',opts),[],path);
}
pass('private expert preparation permits current owner clone/model terminology');
for(const [rule,source]of [['dash','const x=<p>Your clone — privately</p>;'],['filler-verb','const x=<p>Unleash your clone</p>;'],['codename','const x=<p>Meera is your clone</p>;']]){
 const hits=await scanScopedSource('src/studio/CloneExperience.tsx',source,opts);
 assert.ok(hits.some(h=>h.rule===rule),JSON.stringify({rule,hits}));
}
pass('private pages retain dash, filler and internal codename rules');
for(const [path,variable]of [['src/creatorStudio/copy.ts','EN'],['src/creatorStudio/hiCopy.ts','HI']]){
 const source=read(path),ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const declaration=ast.statements.filter(ts.isVariableStatement).flatMap(s=>[...s.declarationList.declarations]).find(d=>d.name.getText(ast)===variable);
 const section=key=>declaration.initializer.properties.find(p=>p.name.text===key);
 const mutate=(key,text)=>{
  let value;function visit(n){if(!value&&ts.isStringLiteralLike(n)&&!(ts.isPropertyAssignment(n.parent)&&n.parent.name===n))value=n;ts.forEachChild(n,visit);}visit(section(key).initializer);assert.ok(value,key);
  return source.slice(0,value.getStart(ast))+JSON.stringify(text)+source.slice(value.end);
 };
 assert.deepEqual(await scanScopedSource(path,source,opts),[]);
 for(const key of ROOM_COPY_SECTIONS){const changed=mutate(key,'Your clone');assert.ok((await scanScopedSource(path,changed,opts)).some(h=>h.rule==='rooms-vocabulary'),path+'.'+key);}
 pass(`${path}: all16actual Room section keys refuse banned text, current table clean`);
 const changed=mutate('roomStudio','यह आपका क्लोन है।');const hits=await scanScopedSource(path,changed,opts);assert.ok(hits.some(h=>h.rule==='rooms-vocabulary'));
 const masked=await roomCopySectionSource(path,changed);assert.equal(masked.length,changed.length);assert.equal(masked.split('\n').length,changed.split('\n').length);
 pass(`${path}: actual Hindi Room key refuses; source offsets and line counts retained`);
 assert.deepEqual(await scanScopedSource(path,mutate('voicePreviewLab','Your private clone and voice model'),opts),[]);
 assert.ok((await scanScopedSource(path,mutate('voicePreviewLab','Your private clone — here'),opts)).some(h=>h.rule==='dash'));
 pass(`${path}: actual private copy key permits owner terms while retaining dash refusal`);
 const object=declaration.initializer;const first=object.getStart(ast)+1;
 for(const [name,changed,code]of [
  ['spread',source.slice(0,first)+' ...other,'+source.slice(first),'copy_room_table_property_invalid'],
  ['computed',source.slice(0,first)+' [other]: {},'+source.slice(first),'copy_room_table_property_invalid'],
  ['duplicate',source.slice(0,first)+' roomStudio: {},'+source.slice(first),'copy_room_table_duplicate_key'],
  ['missing',source.slice(0,section('roomStudio').name.getStart(ast))+'renamedRoom'+source.slice(section('roomStudio').name.end),'copy_room_section_missing'],
  ['nonliteral',source.slice(0,section('roomStudio').initializer.getStart(ast))+'other'+source.slice(section('roomStudio').initializer.end),'copy_room_section_shape_invalid'],
 ])await assert.rejects(()=>roomCopySectionSource(path,changed),new RegExp(code),name);
 pass(`${path}: spread/computed/duplicate/missing/nonliteral table forms fail named`);
}
assert.ok(scanSource('src/studio/ModelConsentGate.tsx','const x=<p>I authorize private training or adaptation of a voice model</p>;', {...opts,roomsVocab:true}).every(h=>h.rule!=='rooms-vocabulary'));
pass('existing exact legal exception remains effective without consent rewriting');
console.log(`PASS ${groups} scoped-copy groups including32actual Room section mutants; no locale module execution`);
